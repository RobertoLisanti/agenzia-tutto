# agenzia-tutto (Agenzia TUTTO)

Portale di servizi dell'Agenzia. Due tipi di servizio:

- **catalogo** (oggi: Magliette, collezioni Beer&VIP e Beer&FILM) - l'utente si iscrive,
  sceglie la maglia, taglia e quantita', riempie il carrello e conferma l'ordine.
  **Nessuno stock**: si raccolgono gli ordini e poi si manda in stampa. **Pagamento a mano
  al ritiro**, nessun pagamento online (i campi per Stripe ci sono gia' nello schema, spenti).
- **scheda** (oggi: Serramenti, Eventi) - la pagina di chi fa quel mestiere, con i bottoni
  per scrivergli su WhatsApp o chiamarlo. Niente acquisto dal sito.

Repo **pubblico** `RobertoLisanti/agenzia-tutto`, live su
https://robertolisanti.github.io/agenzia-tutto/ (GitHub Pages da `main`, auto-deploy al push).

**Architettura (come)** -> skill `sito-web-statico` + `backend-supabase` (nel repo di
config, `.claude\skills\`).

## Struttura

- `index.html` + `app.js` (router hash + tutte le viste) + `auth.js` (iscrizione/accesso)
  + `styles.css` + `config.js` (URL e chiave publishable Supabase).
- `vendor/supabase.js` (copia locale della libreria), `img/prodotti/` (foto maglie),
  `icons/` + `manifest.webmanifest`.
- `devserver/` mini server statico C# per i test locali (porta 5501).

Rotte: `#/` home servizi, `#/<servizio>` collezioni, `#/<servizio>/<collezione>` maglie,
`#/<servizio>/<collezione>/<slug>` dettaglio, `#/carrello`, `#/checkout`, `#/ordini`,
`#/ordini/<numero>`, `#/account`.

## Amministrazione

Non c'e' pannello admin: catalogo, prezzi e stati degli ordini si gestiscono dalla chat
con Claude (MCP Supabase + commit delle immagini).

Questo repo e' **pubblico**: i fatti specifici (ref Supabase, schema, utenti, query di
servizio) e lo stato "fatto / da fare" NON stanno qui ma in un file locale mai committato
(vedi `.gitignore`):

@.claude/local.md
