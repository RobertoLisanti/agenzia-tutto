/* ============================================================
   Agenzia TUTTO - applicazione (router + viste)

   Il client Supabase (window.sb) lo crea auth.js, che carica DOPO
   questo file: qui dentro non si tocca sb prima di App.boot().

   Rotte (hash, refresh-safe):
     #/                              home agenzia (griglia servizi)
     #/<servizio>                    collezioni del servizio
     #/<servizio>/<collezione>       maglie della collezione
     #/<servizio>/<collezione>/<slug> dettaglio maglia
     #/carrello  #/checkout  #/ordini  #/ordini/<numero>  #/account
   ============================================================ */
'use strict';

window.App = (function () {
  const APP_VER = 'v12';
  const AP = String.fromCharCode(39);   // apostrofo, per non litigare con le virgolette
  const NET_TIMEOUT = 15000;

  const viewEl = document.getElementById('view');
  const toastEl = document.getElementById('toast');
  const overlayEl = document.getElementById('overlay');
  const backBtn = document.getElementById('backBtn');
  const cartBadge = document.getElementById('cartBadge');
  const topSub = document.getElementById('topSub');

  const state = {
    booted: false,
    uid: null,
    profile: null,
    servizi: [],
    collezioni: {},      // servizio_id -> [collezioni]
    conteggi: {},        // collezione_id -> n prodotti
    prodotti: {},        // collezione_id -> [prodotti]
    cart: [],
    ordini: null,
    ordineInSospeso: false,   // stava ordinando quando gli abbiamo chiesto l'account
  };

  // stato locale della vista dettaglio (taglia/quantita' scelte)
  let pick = { taglia: null, qta: 1 };

  /* ---------------- utilita' ---------------- */

  const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
  const euro = (cent) => eur.format((cent || 0) / 100);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // rete lenta: meglio un errore che una UI impallata per sempre
  function withTimeout(promise, ms = NET_TIMEOUT) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Connessione lenta o assente. Riprova.')), ms)),
    ]);
  }

  let toastTimer = null;
  function toast(msg, isErr = false) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('err', !!isErr);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function confirmModal(titolo, testo, okLabel = 'Conferma', danger = false) {
    return new Promise((resolve) => {
      overlayEl.innerHTML = `
        <div class="modal">
          <h3>${esc(titolo)}</h3>
          <p>${esc(testo)}</p>
          <div class="row">
            <button class="btn ghost" data-modal="no">Annulla</button>
            <button class="btn ${danger ? 'danger' : ''}" data-modal="si">${esc(okLabel)}</button>
          </div>
        </div>`;
      overlayEl.hidden = false;
      const close = (val) => { overlayEl.hidden = true; overlayEl.innerHTML = ''; resolve(val); };
      overlayEl.onclick = (e) => {
        if (e.target === overlayEl) return close(false);
        const b = e.target.closest('[data-modal]');
        if (b) close(b.dataset.modal === 'si');
      };
    });
  }

  function skeletonGrid(n = 6) {
    let h = '<div class="grid">';
    for (let i = 0; i < n; i++) h += '<div class="skel"><div class="box"></div><div class="bar"></div><div class="bar short"></div></div>';
    return h + '</div>';
  }

  function emptyState(icona, titolo, testo, cta) {
    return `
      <div class="empty">
        <div class="ico">${icona}</div>
        <h3>${esc(titolo)}</h3>
        <p>${esc(testo)}</p>
        ${cta || ''}
      </div>`;
  }

  const ICO = {
    tshirt: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 3 5 4.8 3 9l3 1.6V21h12V10.6L21 9l-2-4.2L15.5 3a3.5 3.5 0 0 1-7 0Z"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    gift: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="12" rx="2"/><path d="M3 13h18M12 9v12"/><path d="M12 9S10.5 4 8 4a2.2 2.2 0 0 0 0 5h4Zm0 0s1.5-5 4-5a2.2 2.2 0 0 1 0 5h-4Z"/></svg>',
    cart: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.2a2 2 0 0 0 2-1.55L21 8H6.2"/><circle cx="10" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>',
    box: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l1 4H5l1-4Z"/><path d="M5 7v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7"/><path d="M9 11h6"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    scudo: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7.5 3v6c0 4.3-3 8.2-7.5 9.5C7.5 20.2 4.5 16.3 4.5 12V6z"/><path d="M9.2 12.2l2 2 3.6-4"/></svg>',
    esterno: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18 14v4.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H10"/></svg>',
    codice: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/></svg>',
    cronometro: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.2 2.2M9.5 2.5h5M12 2.5V6"/></svg>',
    manubrio: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9v6M17.5 9v6M3.5 10.5v3M20.5 10.5v3M6.5 12h11"/></svg>',
    finestra: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M12 3.5v17M3.5 12h17"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.5 5.5L20 6.5"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12.04 2C6.6 2 2.2 6.4 2.2 11.84c0 1.74.46 3.44 1.32 4.94L2 22l5.36-1.4a9.8 9.8 0 0 0 4.68 1.2h.01c5.43 0 9.84-4.4 9.84-9.84C21.89 6.4 17.48 2 12.04 2zm5.72 14.02c-.24.68-1.4 1.3-1.94 1.34-.5.05-.98.23-3.3-.69-2.78-1.1-4.55-3.94-4.69-4.12-.13-.18-1.12-1.49-1.12-2.84 0-1.35.7-2.02.95-2.29.25-.27.55-.34.73-.34.18 0 .37 0 .53.01.17.01.4-.06.62.48.24.57.8 1.98.87 2.12.07.14.12.3.02.48-.09.18-.14.3-.28.46-.14.16-.3.36-.42.48-.14.14-.29.29-.12.57.16.27.73 1.2 1.56 1.95 1.07.95 1.98 1.25 2.26 1.39.27.14.43.12.59-.07.16-.18.68-.79.86-1.07.18-.27.36-.22.6-.13.25.09 1.57.74 1.84.87.27.14.45.2.51.32.07.11.07.64-.17 1.32z"/></svg>',
    utente: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
    telefono: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3h3l1.5 4-2 1.5a12.5 12.5 0 0 0 6.5 6.5L17 13l4 1.5v3a2 2 0 0 1-2.2 2C10.4 18.8 5.2 13.6 4.5 5.2A2 2 0 0 1 6.5 3z"/></svg>',
  };

  function immagine(p, cls = '') {
    const src = Array.isArray(p.immagini) && p.immagini.length ? p.immagini[0] : null;
    if (src) return `<img src="${esc(src)}" alt="${esc(p.nome)}" loading="lazy" />`;
    return `<div class="shot-ph ${cls}"><span>${esc(p.nome)}</span></div>`;
  }

  /* ---------------- accesso ai dati ---------------- */

  async function q(builder) {
    const { data, error } = await withTimeout(builder);
    if (error) throw new Error(error.message || 'Errore di rete');
    return data;
  }

  async function loadServizi() {
    if (state.servizi.length) return state.servizi;
    state.servizi = await q(window.sb.from('servizi').select('*').order('ordine')) || [];
    return state.servizi;
  }

  async function loadCollezioni(servizioId) {
    if (state.collezioni[servizioId]) return state.collezioni[servizioId];
    const coll = await q(window.sb.from('collezioni').select('*').eq('servizio_id', servizioId).order('ordine')) || [];
    state.collezioni[servizioId] = coll;
    // conteggio maglie per collezione: il catalogo e' piccolo, una query sola basta
    if (coll.length) {
      const righe = await q(window.sb.from('prodotti').select('id, collezione_id')
        .in('collezione_id', coll.map((c) => c.id))) || [];
      state.conteggi = {};
      righe.forEach((r) => { state.conteggi[r.collezione_id] = (state.conteggi[r.collezione_id] || 0) + 1; });
    }
    return coll;
  }

  async function loadProdotti(collezioneId) {
    if (state.prodotti[collezioneId]) return state.prodotti[collezioneId];
    const p = await q(window.sb.from('prodotti').select('*').eq('collezione_id', collezioneId).order('ordine')) || [];
    state.prodotti[collezioneId] = p;
    return p;
  }

  /* Carrello: chi ha l'account ce l'ha sul server (lo ritrova su ogni
     dispositivo), chi non ce l'ha ancora lo tiene nel browser. Al primo
     accesso il secondo si travasa nel primo. */
  const CART_KEY = 'agenzia.carrello';

  function cartLocale() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch (_) { return []; }
  }
  function salvaCartLocale(righe) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(righe)); } catch (_) { /* modalita' privata */ }
  }
  const idLocale = (prodottoId, taglia) => 'loc:' + prodottoId + ':' + taglia;

  async function loadCart() {
    if (loggato()) {
      state.cart = await q(window.sb.from('carrello_righe')
        .select('id, prodotto_id, taglia, quantita, prodotti(id, slug, nome, prezzo_cent, immagini, collezione_id)')
        .order('created_at')) || [];
    } else {
      const righe = cartLocale();
      if (!righe.length) {
        state.cart = [];
      } else {
        const prodotti = await q(window.sb.from('prodotti')
          .select('id, slug, nome, prezzo_cent, immagini, collezione_id')
          .in('id', righe.map((r) => r.prodotto_id))) || [];
        const perId = Object.fromEntries(prodotti.map((p) => [p.id, p]));
        // se una maglia e' sparita dal catalogo, la riga sparisce dal carrello
        state.cart = righe.filter((r) => perId[r.prodotto_id]).map((r) => ({
          id: idLocale(r.prodotto_id, r.taglia),
          prodotto_id: r.prodotto_id,
          taglia: r.taglia,
          quantita: r.quantita,
          prodotti: perId[r.prodotto_id],
        }));
      }
    }
    aggiornaBadge();
    return state.cart;
  }

  // all'accesso il carrello del browser diventa quello dell'account
  async function unisciCarrelloLocale() {
    const righe = cartLocale();
    if (!righe.length) return;
    const esistenti = await q(window.sb.from('carrello_righe').select('id, prodotto_id, taglia, quantita')) || [];
    for (const r of righe) {
      const gia = esistenti.find((e) => e.prodotto_id === r.prodotto_id && e.taglia === r.taglia);
      try {
        if (gia) {
          await q(window.sb.from('carrello_righe')
            .update({ quantita: Math.min(99, gia.quantita + r.quantita), updated_at: new Date().toISOString() })
            .eq('id', gia.id));
        } else {
          await q(window.sb.from('carrello_righe')
            .insert({ user_id: state.uid, prodotto_id: r.prodotto_id, taglia: r.taglia, quantita: r.quantita }));
        }
      } catch (_) { /* una riga persa non deve bloccare l'accesso */ }
    }
    salvaCartLocale([]);
  }

  function aggiornaBadge() {
    const n = state.cart.reduce((s, r) => s + r.quantita, 0);
    cartBadge.textContent = String(n);
    cartBadge.hidden = n === 0;
  }

  const loggato = () => !!state.uid;

  // chiede l'accesso solo quando serve davvero (carrello, ordini, profilo)
  function chiediAccesso(motivo) {
    if (window.Auth && window.Auth.apri) window.Auth.apri(motivo);
  }

  function invitoAccesso(titolo, testo) {
    return emptyState(ICO.utente, titolo, testo,
      '<button class="btn" data-action="accedi">Accedi o iscriviti</button>');
  }

  const totaleCarrello = () =>
    state.cart.reduce((s, r) => s + r.quantita * ((r.prodotti && r.prodotti.prezzo_cent) || 0), 0);

  async function aggiungiAlCarrello(prodottoId, taglia, qta) {
    if (!loggato()) {
      const righe = cartLocale();
      const gia = righe.find((r) => r.prodotto_id === prodottoId && r.taglia === taglia);
      if (gia) gia.quantita = Math.min(99, gia.quantita + qta);
      else righe.push({ prodotto_id: prodottoId, taglia, quantita: qta });
      salvaCartLocale(righe);
      await loadCart();
      return;
    }
    const esistente = state.cart.find((r) => r.prodotto_id === prodottoId && r.taglia === taglia);
    if (esistente) {
      const nuova = Math.min(99, esistente.quantita + qta);
      await q(window.sb.from('carrello_righe')
        .update({ quantita: nuova, updated_at: new Date().toISOString() }).eq('id', esistente.id));
    } else {
      await q(window.sb.from('carrello_righe')
        .insert({ user_id: state.uid, prodotto_id: prodottoId, taglia, quantita: qta }));
    }
    await loadCart();
  }

  async function cambiaQuantita(rigaId, delta) {
    const riga = state.cart.find((r) => r.id === rigaId);
    if (!riga) return;
    const nuova = riga.quantita + delta;
    if (nuova <= 0) return rimuoviRiga(rigaId, true);
    if (nuova > 99) return;
    if (!loggato()) {
      const righe = cartLocale();
      const l = righe.find((r) => r.prodotto_id === riga.prodotto_id && r.taglia === riga.taglia);
      if (l) l.quantita = nuova;
      salvaCartLocale(righe);
      await loadCart();
      renderCarrello();
      return;
    }
    await q(window.sb.from('carrello_righe')
      .update({ quantita: nuova, updated_at: new Date().toISOString() }).eq('id', rigaId));
    await loadCart();
    renderCarrello();
  }

  async function rimuoviRiga(rigaId, silenzioso = false) {
    if (!silenzioso) {
      const ok = await confirmModal('Togliere la maglia?', 'La riga sparisce dal carrello.', 'Togli', true);
      if (!ok) return;
    }
    const riga = state.cart.find((r) => r.id === rigaId);
    if (!loggato()) {
      salvaCartLocale(cartLocale().filter((r) => !(riga && r.prodotto_id === riga.prodotto_id && r.taglia === riga.taglia)));
    } else {
      await q(window.sb.from('carrello_righe').delete().eq('id', rigaId));
    }
    await loadCart();
    renderCarrello();
  }

  async function loadOrdini(force = false) {
    if (state.ordini && !force) return state.ordini;
    state.ordini = await q(window.sb.from('ordini')
      .select('*, ordini_righe(*)')
      .order('created_at', { ascending: false })) || [];
    return state.ordini;
  }

  /* ---------------- stati ordine ---------------- */

  const STATI = [
    ['in_attesa_pagamento', 'Da pagare'],
    ['pagato', 'Pagato'],
    ['in_stampa', 'In stampa'],
    ['pronto', 'Pronto per il ritiro'],
    ['consegnato', 'Consegnato'],
  ];
  const etichettaStato = (s) => (s === 'annullato' ? 'Annullato' : (STATI.find((x) => x[0] === s) || [, s])[1]);

  const dataIt = (iso) => new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });

  /* ---------------- router ---------------- */

  const RISERVATE = ['carrello', 'checkout', 'ordini', 'account'];

  function segmenti() {
    const h = location.hash.replace(/^#\/?/, '');
    return h.split('/').filter(Boolean).map(decodeURIComponent);
  }

  function vai(hash) { location.hash = hash; }

  async function route() {
    if (!state.booted) return;
    const s = segmenti();
    window.scrollTo(0, 0);
    aggiornaNav(s);

    try {
      if (!s.length) return await renderHome();
      if (s[0] === 'carrello') return await vistaCarrello();
      if (s[0] === 'checkout') return await renderCheckout();
      if (s[0] === 'ordini') return s[1] ? await renderOrdine(s[1]) : await renderOrdini();
      if (s[0] === 'account') return renderAccount();
      if (s.length === 1) return await renderServizio(s[0]);
      if (s.length === 2) return await renderCollezione(s[0], s[1]);
      return await renderProdotto(s[0], s[1], s[2]);
    } catch (err) {
      viewEl.innerHTML = emptyState(ICO.box, 'Qualcosa non ha funzionato', err.message || 'Riprova tra un momento.',
        '<button class="btn ghost" data-action="ricarica">Riprova</button>');
    }
  }

  function aggiornaNav(s) {
    const primo = s[0] || '';
    backBtn.hidden = s.length === 0;
    document.querySelectorAll('.menu-item').forEach((t) => {
      const g = (t.dataset.goto || '').replace(/^#\/?/, '');
      const attivo = (g === '' && s.length === 0) || (g !== '' && primo === g);
      t.classList.toggle('is-active', attivo);
      if (t.dataset.solo === 'loggato') t.hidden = !loggato();
      if (t.dataset.solo === 'visitatore') t.hidden = loggato();
    });
    const sub = {
      '': 'Facciamo tutto', carrello: 'Il tuo carrello', checkout: 'Conferma ordine',
      ordini: 'I tuoi ordini', account: 'Il tuo profilo',
    };
    if (sub[primo] !== undefined) {
      topSub.textContent = sub[primo];
    } else {
      const sv = state.servizi.find((x) => x.id === primo);
      topSub.textContent = sv ? 'Servizio ' + sv.nome.toLowerCase() : 'Agenzia TUTTO';
    }
  }

  function indietro() {
    const s = segmenti();
    if (s.length <= 1) return vai('#/');
    vai('#/' + s.slice(0, s.length - 1).map(encodeURIComponent).join('/'));
  }

  /* ---------------- viste ---------------- */

  async function renderHome() {
    viewEl.innerHTML = `
      <section class="hero">
        <p class="kicker">Agenzia TUTTO</p>
        <h2>Facciamo tutto.</h2>
        <p>Scegli il servizio, il resto lo mettiamo noi.</p>
      </section>
      <div class="section-title"><h2>I nostri servizi</h2></div>
      <div class="servizi" id="servizi">${skeletonGrid(4)}</div>`;

    const servizi = await loadServizi();
    const box = document.getElementById('servizi');
    if (!servizi.length) {
      box.outerHTML = emptyState(ICO.box, 'Ancora nessun servizio', 'Torna tra poco: stiamo preparando le cose.');
      return;
    }

    box.innerHTML = servizi.map((sv) => {
      const ico = ICO[sv.icona] || ICO.box;
      const chi = (sv.scheda && sv.scheda.persona) || '';
      const iniz = (sv.scheda && sv.scheda.iniziali) || '';
      const inArrivo = sv.stato !== 'attivo';
      const catalogo = sv.tipo !== 'scheda';

      const piede = catalogo
        ? '<span class="azione">Vedi il catalogo</span>'
        : (chi ? `<span class="chi"><span class="chi-avatar">${esc(iniz)}</span>${esc(chi)}</span>` : '');

      const corpo = `
        <div class="serv-top">
          <span class="serv-ico">${ico}</span>
          ${inArrivo ? '<span class="pill-soon">In arrivo</span>' : ''}
        </div>
        <h3>${esc(sv.nome)}</h3>
        <p>${esc(sv.descrizione || '')}</p>
        <div class="serv-piede">${piede}${inArrivo ? '' : ICO.chev}</div>`;

      return inArrivo
        ? `<div class="card serv soon">${corpo}</div>`
        : `<a class="card serv${catalogo ? ' serv-hero' : ''}" href="#/${esc(sv.id)}">${corpo}</a>`;
    }).join('');
  }

  /* Servizio "scheda": non un catalogo ma una persona che fa un mestiere,
     con i bottoni per contattarla. */
  function renderSchedaServizio(sv) {
    const s = sv.scheda || {};
    const wa = s.whatsapp
      ? 'https://wa.me/' + s.whatsapp + (s.messaggio ? '?text=' + encodeURIComponent(s.messaggio) : '')
      : null;
    const cose = Array.isArray(s.cosa_fa) ? s.cosa_fa : [];

    viewEl.innerHTML = `
      <p class="crumb">Agenzia TUTTO</p>
      <div class="persona">
        <div class="persona-avatar">${esc(s.iniziali || (s.persona || '?').charAt(0))}</div>
        <div>
          <h2>${esc(s.persona || sv.nome)}</h2>
          <p class="ruolo">${esc(s.ruolo || sv.nome)}</p>
        </div>
      </div>

      ${s.intro ? `<p class="descr">${esc(s.intro)}</p>` : ''}

      ${cose.length ? `
        <div class="section-title"><h2>Cosa fa</h2></div>
        <ul class="lista-spunta">
          ${cose.map((c) => `<li><span class="tick">${ICO.check}</span><span>${esc(c)}</span></li>`).join('')}
        </ul>` : ''}

      ${s.come_lavora ? `
        <div class="section-title"><h2>Come si parte</h2></div>
        <p class="descr" style="margin-top:0">${esc(s.come_lavora)}</p>` : ''}

      ${s.link_url ? `
        <a class="link-esterno" href="${esc(s.link_url)}" target="_blank" rel="noopener noreferrer">
          <span>${esc(s.link_testo || 'Vai al sito')}</span>${ICO.esterno}
        </a>` : ''}

      ${wa ? `
        <div class="contatti">
          <a class="wa-btn" href="${esc(wa)}" target="_blank" rel="noopener">
            ${ICO.whatsapp}<span>Scrivigli su WhatsApp</span>
          </a>
        </div>
        <p class="muted" style="margin:12px 0 0;font-size:12.5px;line-height:1.5">
          Questo servizio si tratta direttamente con ${esc((s.persona || '').split(' ')[0] || 'lui')}:
          preventivo e pagamento non passano dal sito.
        </p>` : ''}`;
  }

  async function renderServizio(servizioId) {
    const servizi = await loadServizi();
    const sv = servizi.find((x) => x.id === servizioId);
    if (!sv || sv.stato !== 'attivo') {
      viewEl.innerHTML = emptyState(ICO.box, 'Servizio non disponibile', 'Questo servizio non è ancora aperto.',
        '<a class="btn ghost" href="#/">Torna alla home</a>');
      return;
    }
    if (sv.tipo === 'scheda') return renderSchedaServizio(sv);
    viewEl.innerHTML = `
      <p class="crumb">Agenzia TUTTO</p>
      <div class="section-title"><h2>${esc(sv.nome)}</h2></div>
      <p class="muted" style="margin:0 0 18px;font-size:14.5px;line-height:1.5">${esc(sv.descrizione || '')}</p>
      <div class="section-title"><h2>Collezioni</h2></div>
      <div class="grid wide" id="coll">${skeletonGrid(2)}</div>`;

    const coll = await loadCollezioni(servizioId);
    const box = document.getElementById('coll');
    if (!coll.length) {
      box.outerHTML = emptyState(ICO.tshirt, 'Nessuna collezione', 'Le maglie arrivano presto.');
      return;
    }
    box.innerHTML = coll.map((c) => {
      const n = state.conteggi[c.id] || 0;
      const cover = c.cover
        ? `<img src="${esc(c.cover)}" alt="${esc(c.nome)}" loading="lazy" />`
        : `<span class="anno">${esc(c.anno || '')}</span>`;
      return `
        <a class="card collezione" href="#/${esc(servizioId)}/${esc(c.slug)}">
          <div class="cover">${cover}</div>
          <div class="body">
            <h3>${esc(c.nome)}</h3>
            <p>${esc(c.descrizione || '')}</p>
            <p class="meta">${n} ${n === 1 ? 'maglia' : 'maglie'}</p>
          </div>
        </a>`;
    }).join('');
  }

  async function renderCollezione(servizioId, collSlug) {
    const coll = await loadCollezioni(servizioId);
    const c = coll.find((x) => x.slug === collSlug);
    if (!c) {
      viewEl.innerHTML = emptyState(ICO.tshirt, 'Collezione non trovata', 'Forse il link è vecchio.',
        `<a class="btn ghost" href="#/${esc(servizioId)}">Vedi le collezioni</a>`);
      return;
    }
    viewEl.innerHTML = `
      <p class="crumb">${esc(c.nome)}</p>
      <div class="section-title"><h2>Le maglie</h2></div>
      <p class="muted" style="margin:0 0 16px;font-size:14.5px;line-height:1.5">${esc(c.descrizione || '')}</p>
      <div class="grid" id="prod" style="--shot-ratio: ${esc(c.formato || '2 / 3')}">${skeletonGrid(4)}</div>`;

    const prodotti = await loadProdotti(c.id);
    const box = document.getElementById('prod');
    if (!prodotti.length) {
      box.outerHTML = emptyState(ICO.tshirt, 'Collezione in preparazione', 'Le maglie di questa collezione non sono ancora online.');
      return;
    }
    box.innerHTML = prodotti.map((p) => `
      <a class="card prodotto" href="#/${esc(servizioId)}/${esc(collSlug)}/${esc(p.slug)}">
        <div class="shot">${immagine(p)}</div>
        <div class="body">
          <h3>${esc(p.nome)}</h3>
          ${p.riferimento ? `<p class="rif">${esc(p.riferimento)}</p>` : ''}
          <p class="prezzo">${euro(p.prezzo_cent)}</p>
        </div>
      </a>`).join('');
  }

  async function renderProdotto(servizioId, collSlug, prodSlug) {
    const coll = await loadCollezioni(servizioId);
    const c = coll.find((x) => x.slug === collSlug);
    if (!c) return renderCollezione(servizioId, collSlug);
    const prodotti = await loadProdotti(c.id);
    const p = prodotti.find((x) => x.slug === prodSlug);
    if (!p) {
      viewEl.innerHTML = emptyState(ICO.tshirt, 'Maglia non trovata', 'Questa maglia non è più disponibile.',
        `<a class="btn ghost" href="#/${esc(servizioId)}/${esc(collSlug)}">Vedi la collezione</a>`);
      return;
    }

    pick = { taglia: null, qta: 1 };
    const taglie = Array.isArray(p.taglie) ? p.taglie : [];

    viewEl.innerHTML = `
      <div class="detail">
        <div class="gallery" style="--shot-ratio: ${esc(c.formato || '2 / 3')}">${immagine(p)}</div>
        <div>
          <p class="crumb">${esc(c.nome)}</p>
          <h2>${esc(p.nome)}</h2>
          ${p.riferimento ? `<p class="rif">da ${esc(p.riferimento)}</p>` : ''}
          ${p.descrizione ? `<p class="descr">${esc(p.descrizione)}</p>` : ''}
          <p class="prezzo-big">${euro(p.prezzo_cent)}</p>

          <div class="field-label"><span>Taglia</span><span class="hint" id="tagliaHint">Scegli la taglia</span></div>
          <div class="sizes" id="taglie">
            ${taglie.map((t) => `<button class="size" data-action="taglia" data-taglia="${esc(t)}">${esc(t)}</button>`).join('')}
          </div>

          <div class="field-label"><span>Quantità</span></div>
          <div class="qty">
            <button data-action="qta-meno" aria-label="Meno">-</button>
            <span class="val" id="qtaVal">1</span>
            <button data-action="qta-piu" aria-label="Piu">+</button>
          </div>

          <div style="margin-top:22px">
            <button class="btn block" id="addBtn" data-action="aggiungi" data-id="${esc(p.id)}" disabled>
              <span class="lbl">Aggiungi al carrello</span>
            </button>
          </div>
          <p class="muted" style="margin:12px 0 0;font-size:12.5px;line-height:1.5">
            Si stampa dopo aver raccolto gli ordini: nessuna taglia va esaurita.
            Paghi al ritiro, in contanti o come vi mettete d'accordo.
          </p>
        </div>
      </div>`;
  }

  function aggiornaPick() {
    const val = document.getElementById('qtaVal');
    if (val) val.textContent = String(pick.qta);
    const hint = document.getElementById('tagliaHint');
    if (hint) hint.textContent = pick.taglia ? 'Taglia ' + pick.taglia : 'Scegli la taglia';
    const add = document.getElementById('addBtn');
    if (add) add.disabled = !pick.taglia;
    document.querySelectorAll('.size').forEach((b) => b.classList.toggle('is-active', b.dataset.taglia === pick.taglia));
  }

  async function vistaCarrello() {
    viewEl.innerHTML = `<div class="section-title"><h2>Carrello</h2></div>${skeletonGrid(2)}`;
    await loadCart();
    renderCarrello();
  }

  function renderCarrello() {
    if (!state.cart.length) {
      viewEl.innerHTML = `
        <div class="section-title"><h2>Carrello</h2></div>
        ${emptyState(ICO.cart, 'Il carrello è vuoto', 'Scegli una maglia dalle collezioni e torna qui.',
          '<a class="btn" href="#/magliette">Vai alle maglie</a>')}`;
      return;
    }
    const righe = state.cart.map((r) => {
      const p = r.prodotti || {};
      const tot = r.quantita * (p.prezzo_cent || 0);
      return `
        <div class="cart-row">
          <div class="thumb">${immagine(p)}</div>
          <div class="info">
            <h3>${esc(p.nome)}</h3>
            <p class="sub">Taglia ${esc(r.taglia)} - ${euro(p.prezzo_cent)} cad.</p>
            <p class="riga-tot">${euro(tot)}</p>
            <div class="azioni">
              <div class="qty">
                <button data-action="riga-meno" data-id="${esc(r.id)}" aria-label="Meno">-</button>
                <span class="val">${r.quantita}</span>
                <button data-action="riga-piu" data-id="${esc(r.id)}" aria-label="Piu">+</button>
              </div>
              <button class="link-danger" data-action="riga-togli" data-id="${esc(r.id)}">Togli</button>
            </div>
          </div>
        </div>`;
    }).join('');

    const capi = state.cart.reduce((s, r) => s + r.quantita, 0);
    viewEl.innerHTML = `
      <div class="section-title"><h2>Carrello</h2><span class="count">${capi} ${capi === 1 ? 'capo' : 'capi'}</span></div>
      ${righe}
      <div class="riepilogo">
        <div class="r"><span>Ritiro a mano</span><span>Gratis</span></div>
        <div class="r tot"><span>Totale</span><span class="v">${euro(totaleCarrello())}</span></div>
      </div>
      <div class="sticky-cta">
        <a class="btn block" href="#/checkout">Vai all'ordine</a>
      </div>`;
  }

  async function renderCheckout() {
    await loadCart();
    if (!state.cart.length) return vai('#/carrello');

    const pr = state.profile || {};
    const nome = [pr.nome, pr.cognome].filter(Boolean).join(' ') || pr.username || '';
    const capi = state.cart.reduce((s, r) => s + r.quantita, 0);

    viewEl.innerHTML = `
      <p class="crumb">Ultimo passo</p>
      <div class="section-title"><h2>Conferma ordine</h2></div>

      <div class="riepilogo" style="margin-top:0">
        ${state.cart.map((r) => `
          <div class="riga-ordine">
            <div>
              <div>${esc((r.prodotti || {}).nome)}</div>
              <div class="q">Taglia ${esc(r.taglia)} - quantità ${r.quantita}</div>
            </div>
            <div class="p">${euro(r.quantita * ((r.prodotti || {}).prezzo_cent || 0))}</div>
          </div>`).join('')}
        <div class="r tot"><span>Totale (${capi})</span><span class="v">${euro(totaleCarrello())}</span></div>
      </div>

      <form id="checkoutForm" novalidate style="margin-top:20px">
        <label class="field">
          <span>Nome e cognome</span>
          <input id="ckNome" type="text" autocomplete="name" value="${esc(nome)}" required />
        </label>
        <label class="field">
          <span>Telefono</span>
          <input id="ckTel" type="tel" inputmode="tel" autocomplete="tel" value="${esc(pr.telefono || '')}" placeholder="es. 333 1234567" required />
        </label>
        <label class="field">
          <span>Note (facoltative)</span>
          <textarea id="ckNote" placeholder="Quando passi a ritirare, richieste particolari..."></textarea>
        </label>
        <p class="form-msg" id="ckMsg" hidden></p>
        <button class="btn block" id="ckBtn" type="submit"><span class="lbl">${loggato() ? 'Invia ordine' : "Accedi e invia l'ordine"}</span></button>
      </form>
      <p class="muted" style="margin:14px 0 0;font-size:12.5px;line-height:1.5">
        Nessun pagamento online: l'ordine resta da pagare finché non ci vediamo. Ritiro a mano.
      </p>`;
  }

  async function inviaOrdine() {
    if (!loggato()) {
      // il carrello resta dov'e': dopo l'accesso si travasa nell'account
      state.ordineInSospeso = true;
      chiediAccesso("Ultimo passo: accedi o iscriviti per inviare l'ordine. Il carrello resta com'è.");
      return;
    }
    const btn = document.getElementById('ckBtn');
    const msg = document.getElementById('ckMsg');
    const nome = document.getElementById('ckNome').value.trim();
    const tel = document.getElementById('ckTel').value.trim();
    const note = document.getElementById('ckNote').value.trim();

    msg.hidden = true;
    if (!nome || !tel) {
      msg.textContent = 'Servono nome e telefono per accordarci sul ritiro.';
      msg.hidden = false;
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="lbl">Invio...</span><span class="spin-dot"></span>';
    try {
      const { data, error } = await withTimeout(
        window.sb.rpc('crea_ordine', { p_nome: nome, p_telefono: tel, p_note: note || null })
      );
      if (error) throw new Error(error.message || 'Ordine non riuscito');

      // il telefono lo teniamo sul profilo: al prossimo ordine e' gia' li'
      if (!state.profile || state.profile.telefono !== tel) {
        try {
          await withTimeout(window.sb.from('profiles').update({ telefono: tel }).eq('id', state.uid));
          if (state.profile) state.profile.telefono = tel;
        } catch (_) { /* non e' un motivo per bloccare l'ordine */ }
      }

      state.ordini = null;
      await loadCart();
      toast('Ordine ' + data.numero + ' inviato!');
      vai('#/ordini/' + encodeURIComponent(data.numero));
    } catch (err) {
      msg.textContent = err.message || 'Ordine non riuscito. Riprova.';
      msg.hidden = false;
      btn.disabled = false;
      btn.innerHTML = '<span class="lbl">Invia ordine</span>';
    }
  }

  async function renderOrdini() {
    if (!loggato()) {
      viewEl.innerHTML = '<div class="section-title"><h2>I tuoi ordini</h2></div>' +
        invitoAccesso('Qui finiscono i tuoi ordini', 'Accedi per vedere cosa hai ordinato e a che punto è.');
      return;
    }
    viewEl.innerHTML = `<div class="section-title"><h2>I tuoi ordini</h2></div>${skeletonGrid(2)}`;
    const ordini = await loadOrdini(true);
    if (!ordini.length) {
      viewEl.innerHTML = `
        <div class="section-title"><h2>I tuoi ordini</h2></div>
        ${emptyState(ICO.box, 'Nessun ordine', 'Quando ordini una maglia la trovi qui, con il suo stato.',
          '<a class="btn" href="#/magliette">Vai alle maglie</a>')}`;
      return;
    }
    viewEl.innerHTML = `
      <div class="section-title"><h2>I tuoi ordini</h2><span class="count">${ordini.length}</span></div>
      ${ordini.map((o) => {
        const capi = (o.ordini_righe || []).reduce((s, r) => s + r.quantita, 0);
        return `
        <a class="ordine-card" href="#/ordini/${esc(o.numero)}">
          <div class="head">
            <span class="num">${esc(o.numero)}</span>
            <span class="stato s-${esc(o.stato)}">${esc(etichettaStato(o.stato))}</span>
          </div>
          <p class="data">${esc(dataIt(o.created_at))} - ${capi} ${capi === 1 ? 'capo' : 'capi'}</p>
          <p class="tot">${euro(o.totale_cent)}</p>
        </a>`;
      }).join('')}`;
  }

  async function renderOrdine(numero) {
    if (!loggato()) return renderOrdini();
    const ordini = await loadOrdini();
    const o = ordini.find((x) => x.numero === numero);
    if (!o) {
      viewEl.innerHTML = emptyState(ICO.box, 'Ordine non trovato', 'Controlla nella lista dei tuoi ordini.',
        '<a class="btn ghost" href="#/ordini">I tuoi ordini</a>');
      return;
    }
    const idx = STATI.findIndex((s) => s[0] === o.stato);
    const timeline = o.stato === 'annullato'
      ? '<li class="now"><span class="dot"></span>Ordine annullato</li>'
      : STATI.map((s, i) => {
          const cls = i < idx ? 'done' : (i === idx ? 'now' : '');
          return `<li class="${cls}"><span class="dot"></span>${esc(s[1])}</li>`;
        }).join('');

    viewEl.innerHTML = `
      <p class="crumb">Ordine</p>
      <div class="section-title"><h2>${esc(o.numero)}</h2><span class="stato s-${esc(o.stato)}">${esc(etichettaStato(o.stato))}</span></div>
      <p class="muted" style="margin:0;font-size:13.5px">${esc(dataIt(o.created_at))}</p>

      <div class="riepilogo">
        ${(o.ordini_righe || []).map((r) => `
          <div class="riga-ordine">
            <div>
              <div>${esc(r.nome_prodotto)}</div>
              <div class="q">Taglia ${esc(r.taglia)} - quantità ${r.quantita}${r.collezione_nome ? ' - ' + esc(r.collezione_nome) : ''}</div>
            </div>
            <div class="p">${euro(r.quantita * r.prezzo_unit_cent)}</div>
          </div>`).join('')}
        <div class="r tot"><span>Totale</span><span class="v">${euro(o.totale_cent)}</span></div>
      </div>

      <div class="section-title"><h2>A che punto siamo</h2></div>
      <ul class="timeline">${timeline}</ul>

      <div class="riepilogo">
        <div class="r"><span>Ritiro</span><span>A mano</span></div>
        <div class="r"><span>Contatto</span><span>${esc(o.nome_contatto)}</span></div>
        <div class="r"><span>Telefono</span><span>${esc(o.telefono)}</span></div>
        ${o.note ? `<div class="r"><span>Note</span><span>${esc(o.note)}</span></div>` : ''}
      </div>
      <p class="muted" style="margin:14px 0 0;font-size:12.5px;line-height:1.5">${esc(window.AGENZIA_CONFIG.CONTATTO_RITIRO || '')}</p>`;
  }

  function renderAccount() {
    if (!loggato()) {
      viewEl.innerHTML = invitoAccesso('Nessun account',
        'Accedi o iscriviti per ordinare le maglie e seguire i tuoi ordini.');
      return;
    }
    const p = state.profile || {};
    const iniziale = (p.nome || p.username || '?').trim().charAt(0).toUpperCase();
    const nomeCompleto = [p.nome, p.cognome].filter(Boolean).join(' ');
    viewEl.innerHTML = `
      <div class="acc-head">
        <div class="acc-avatar">${esc(iniziale)}</div>
        <div>
          <h2>${esc(nomeCompleto || p.username || '')}</h2>
          <p>@${esc(p.username || '')}</p>
        </div>
      </div>

      <a class="list-link" href="#/ordini"><span>I tuoi ordini</span>${ICO.chev}</a>
      <a class="list-link" href="#/carrello"><span>Carrello</span>${ICO.chev}</a>

      <div class="riepilogo">
        ${p.email ? `<div class="r"><span>Email</span><span>${esc(p.email)}</span></div>` : ''}
        <div class="r"><span>Telefono</span><span>${esc(p.telefono || 'non indicato')}</span></div>
        <div class="r"><span>Versione</span><span>${APP_VER}</span></div>
      </div>

      <div style="margin-top:18px">
        <button class="btn ghost block" data-action="logout">Esci</button>
      </div>`;
  }

  /* ---------------- eventi ---------------- */

  viewEl.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const a = t.dataset.action;

    if (a === 'taglia') { pick.taglia = t.dataset.taglia; aggiornaPick(); return; }
    if (a === 'qta-meno') { pick.qta = Math.max(1, pick.qta - 1); aggiornaPick(); return; }
    if (a === 'qta-piu') { pick.qta = Math.min(99, pick.qta + 1); aggiornaPick(); return; }
    if (a === 'ricarica') { route(); return; }
    if (a === 'logout') { window.Auth && window.Auth.logout(); return; }

    if (a === 'accedi') { chiediAccesso(); return; }

    if (a === 'aggiungi') {
      if (!pick.taglia) return;
      t.disabled = true;
      const lbl = t.querySelector('.lbl');
      const testo = lbl.textContent;
      lbl.textContent = 'Aggiungo...';
      try {
        await aggiungiAlCarrello(t.dataset.id, pick.taglia, pick.qta);
        toast('Aggiunta al carrello: taglia ' + pick.taglia + ' x' + pick.qta);
        lbl.textContent = testo;
        t.disabled = false;
      } catch (err) {
        toast(err.message || 'Non sono riuscito ad aggiungerla', true);
        lbl.textContent = testo;
        t.disabled = false;
      }
      return;
    }

    if (a === 'riga-piu' || a === 'riga-meno') {
      t.disabled = true;
      try { await cambiaQuantita(t.dataset.id, a === 'riga-piu' ? 1 : -1); }
      catch (err) { toast(err.message || 'Modifica non riuscita', true); t.disabled = false; }
      return;
    }
    if (a === 'riga-togli') {
      try { await rimuoviRiga(t.dataset.id); }
      catch (err) { toast(err.message || 'Non sono riuscito a toglierla', true); }
    }
  });

  viewEl.addEventListener('submit', (e) => {
    if (e.target.id === 'checkoutForm') { e.preventDefault(); inviaOrdine(); }
  });

  backBtn.addEventListener('click', indietro);
  window.addEventListener('hashchange', route);

  /* menu in alto a destra: si apre col bottone, si chiude con Esc,
     con un clic fuori o scegliendo una voce */
  const menuBtn = document.getElementById('menuBtn');
  const menuEl = document.getElementById('menu');

  function apriMenu(apri) {
    menuEl.hidden = !apri;
    menuBtn.setAttribute('aria-expanded', apri ? 'true' : 'false');
  }

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    apriMenu(menuEl.hidden);
  });
  menuEl.addEventListener('click', (e) => {
    const voce = e.target.closest('.menu-item');
    if (!voce) return;
    apriMenu(false);
    if (voce.dataset.azione === 'accedi') return chiediAccesso();
    vai(voce.dataset.goto);
  });
  document.addEventListener('click', (e) => {
    if (!menuEl.hidden && !menuEl.contains(e.target)) apriMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menuEl.hidden) apriMenu(false);
  });

  /* ---------------- avvio ---------------- */

  // uid null = visitatore: il catalogo si guarda lo stesso, l'account serve
  // solo per carrello e ordini.
  async function boot(uid) {
    state.uid = uid || null;
    state.booted = true;
    state.profile = null;
    state.ordini = null;
    state.cart = [];

    if (state.uid) {
      try {
        const prof = await q(window.sb.from('profiles').select('*').eq('id', state.uid).maybeSingle());
        state.profile = prof || null;
      } catch (_) { state.profile = null; }
      try { await unisciCarrelloLocale(); } catch (_) { /* si riprova al prossimo accesso */ }
      try { await loadCart(); } catch (_) { /* il badge riprova al prossimo giro */ }
    } else {
      await loadCart().catch(() => { state.cart = []; aggiornaBadge(); });
    }

    // se stava ordinando quando gli abbiamo chiesto l'account, lo riportiamo li'
    if (state.uid && state.ordineInSospeso) {
      state.ordineInSospeso = false;
      if (state.cart.length) {
        toast("Bentornato: ora puoi inviare l'ordine");
        if (location.hash !== '#/checkout') return vai('#/checkout');
      }
    }
    await route();
  }

  function reset() {
    state.booted = false;
    state.uid = null;
    state.profile = null;
    state.servizi = [];
    state.collezioni = {};
    state.conteggi = {};
    state.prodotti = {};
    state.cart = [];
    state.ordini = null;
    viewEl.innerHTML = '';
    cartBadge.hidden = true;
  }

  return { boot, reset, route, toast, state, APP_VER };
})();
