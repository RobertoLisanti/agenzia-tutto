/* Configurazione Supabase.
   La chiave "publishable" e' pensata per stare nel client (la sicurezza la fa
   la RLS, non il nascondere la chiave): puo' vivere nel repo pubblico. */
window.AGENZIA_CONFIG = {
  SUPABASE_URL: 'https://ynjfdirqypnzmktothce.supabase.co',
  SUPABASE_KEY: 'sb_publishable_9lVilkgBsxyzj04MeS69ng_KhqVBo2f',
  // URL pubblico del sito (link di conferma email)
  APP_URL: 'https://robertolisanti.github.io/agenzia-tutto/',
  // mostrato al cliente dopo l'ordine, per accordarsi sul ritiro
  CONTATTO_RITIRO: 'Ti contattiamo noi per il ritiro e il pagamento.',
};
