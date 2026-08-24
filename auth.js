/* ============================================================
   Agenzia TUTTO - autenticazione

   - Iscrizione: username + email + password (+ nome, cognome, telefono)
   - Accesso: username + password. L'email la risolve la edge function
     "login" lato server con il service role: al client non arriva mai.
   - Sessione in localStorage: chi compra resta dentro finche' non esce.

   La protezione dei dati e' la RLS su Supabase, non questo file.
   ============================================================ */
'use strict';

window.Auth = (function () {
  const cfg = window.AGENZIA_CONFIG;
  const FN = cfg.SUPABASE_URL + '/functions/v1';

  const client = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
    },
  });
  window.sb = client;

  const appEl = document.getElementById('app');

  /* ---------------- schermata ---------------- */

  const overlay = document.createElement('div');
  overlay.id = 'auth';
  overlay.className = 'auth-screen';
  overlay.innerHTML = `
    <div class="auth-card">
      <div class="auth-brand">
        <span class="brand-mark"></span>
        <div><h1>Agenzia TUTTO</h1><p class="muted">Facciamo tutto</p></div>
      </div>

      <div class="auth-tabs">
        <button class="auth-tab is-active" data-mode="login">Accedi</button>
        <button class="auth-tab" data-mode="signup">Iscriviti</button>
      </div>

      <form id="authForm" autocomplete="on" novalidate>
        <label class="field" id="emailField" hidden>
          <span>Email</span>
          <input id="authEmail" type="email" inputmode="email" autocomplete="email" placeholder="tu@email.it" />
        </label>
        <label class="field" id="nameField" hidden>
          <span>Nome</span>
          <input id="authName" type="text" autocomplete="given-name" placeholder="Il tuo nome" />
        </label>
        <label class="field" id="surnameField" hidden>
          <span>Cognome</span>
          <input id="authSurname" type="text" autocomplete="family-name" placeholder="Il tuo cognome" />
        </label>
        <label class="field" id="phoneField" hidden>
          <span>Telefono</span>
          <input id="authPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Per accordarci sul ritiro" />
        </label>
        <label class="field">
          <span>Username</span>
          <input id="authUser" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="il_tuo_username" required />
        </label>
        <label class="field">
          <span>Password</span>
          <input id="authPass" type="password" autocomplete="current-password" placeholder="almeno 6 caratteri" minlength="6" required />
        </label>

        <p class="auth-msg" id="authMsg" hidden></p>

        <button class="auth-submit" id="authSubmit" type="submit">
          <span class="lbl">Accedi</span><span class="spin-dot" hidden></span>
        </button>
      </form>

      <p class="auth-hint" id="authHint">Non hai un account? <a data-goto="signup">Iscriviti</a></p>
    </div>`;
  document.body.appendChild(overlay);

  const $ = (s) => overlay.querySelector(s);
  const tabs = overlay.querySelectorAll('.auth-tab');
  const form = $('#authForm');
  const emailField = $('#emailField'), nameField = $('#nameField');
  const surnameField = $('#surnameField'), phoneField = $('#phoneField');
  const emailEl = $('#authEmail'), nameEl = $('#authName'), surnameEl = $('#authSurname');
  const phoneEl = $('#authPhone'), userEl = $('#authUser'), passEl = $('#authPass');
  const msgEl = $('#authMsg'), submitBtn = $('#authSubmit');
  const submitLbl = submitBtn.querySelector('.lbl'), submitSpin = submitBtn.querySelector('.spin-dot');
  const hintEl = $('#authHint');

  let mode = 'login';
  let busy = false;

  function setMode(m) {
    mode = m;
    const iscrizione = m === 'signup';
    tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.mode === m));
    emailField.hidden = !iscrizione;
    nameField.hidden = !iscrizione;
    surnameField.hidden = !iscrizione;
    phoneField.hidden = !iscrizione;
    passEl.autocomplete = iscrizione ? 'new-password' : 'current-password';
    submitLbl.textContent = iscrizione ? 'Crea account' : 'Accedi';
    hintEl.innerHTML = iscrizione
      ? 'Hai gia un account? <a data-goto="login">Accedi</a>'
      : 'Non hai un account? <a data-goto="signup">Iscriviti</a>';
    messaggio('');
  }

  function messaggio(testo, ok = false) {
    msgEl.textContent = testo;
    msgEl.classList.toggle('ok', ok);
    msgEl.hidden = !testo;
  }

  function caricamento(on) {
    busy = on;
    submitBtn.disabled = on;
    submitSpin.hidden = !on;
  }

  function mostraSchermata() {
    overlay.hidden = false;
    appEl.style.visibility = 'hidden';
  }
  function nascondiSchermata() {
    overlay.hidden = true;
    appEl.style.visibility = '';
  }

  /* ---------------- azioni ---------------- */

  const USERNAME_OK = /^[a-z0-9._]{3,20}$/;

  async function iscriviti(username, password) {
    const email = emailEl.value.trim();
    if (!email) throw new Error('Serve una email: la usiamo per recuperare la password.');
    if (!USERNAME_OK.test(username)) {
      throw new Error('Username: da 3 a 20 caratteri, solo minuscole, numeri, punto e underscore.');
    }
    if (password.length < 6) throw new Error('La password deve avere almeno 6 caratteri.');

    const { data: libero, error: eDisp } = await client.rpc('username_available', { uname: username });
    if (eDisp) throw new Error('Non riesco a verificare lo username. Riprova.');
    if (!libero) throw new Error('Questo username e gia preso.');

    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: cfg.APP_URL,
        data: {
          username,
          nome: nameEl.value.trim(),
          cognome: surnameEl.value.trim(),
          telefono: phoneEl.value.trim(),
        },
      },
    });
    if (error) {
      const m = (error.message || '').toLowerCase();
      if (m.includes('already registered') || m.includes('already been registered')) {
        throw new Error('Questa email e gia registrata: prova ad accedere.');
      }
      throw new Error(error.message || 'Iscrizione non riuscita.');
    }

    // con la conferma email attiva la sessione non arriva subito
    if (!data.session) {
      setMode('login');
      messaggio('Account creato. Conferma la email, poi accedi.', true);
      return null;
    }
    return data.session.user.id;
  }

  async function accedi(username, password) {
    const res = await fetch(FN + '/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.SUPABASE_KEY,
        Authorization: 'Bearer ' + cfg.SUPABASE_KEY,
      },
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Accesso non riuscito.');

    const { data, error } = await client.auth.setSession({
      access_token: body.access_token,
      refresh_token: body.refresh_token,
    });
    if (error || !data.session) throw new Error('Accesso non riuscito. Riprova.');
    return data.session.user.id;
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    messaggio('');

    const username = userEl.value.trim().toLowerCase();
    const password = passEl.value;
    if (!username || !password) return messaggio('Inserisci username e password.');

    caricamento(true);
    try {
      const uid = mode === 'signup'
        ? await iscriviti(username, password)
        : await accedi(username, password);
      if (uid) {
        passEl.value = '';
        nascondiSchermata();
        await window.App.boot(uid);
      }
    } catch (err) {
      messaggio(err.message || 'Qualcosa non ha funzionato.');
    } finally {
      caricamento(false);
    }
  }

  async function logout() {
    try { await client.auth.signOut(); } catch (_) { /* la sessione locale la buttiamo comunque */ }
    window.App.reset();
    location.hash = '#/';
    setMode('login');
    mostraSchermata();
  }

  /* ---------------- eventi ---------------- */

  tabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));
  hintEl.addEventListener('click', (e) => {
    const a = e.target.closest('[data-goto]');
    if (a) setMode(a.dataset.goto);
  });
  form.addEventListener('submit', submit);

  // sessione scaduta o revocata mentre l'app e' aperta
  client.auth.onAuthStateChange((evt) => {
    if (evt === 'SIGNED_OUT') {
      window.App.reset();
      mostraSchermata();
    }
  });

  /* ---------------- avvio ---------------- */

  (async function start() {
    mostraSchermata();
    setMode('login');
    try {
      const { data } = await client.auth.getSession();
      if (data && data.session) {
        nascondiSchermata();
        await window.App.boot(data.session.user.id);
      }
    } catch (_) { /* si resta sulla schermata di accesso */ }
  })();

  return { logout, client };
})();
