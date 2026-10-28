import { CONFIG } from "./config.mjs";

// Supabase si la configuration est renseignée, sinon mode démo local.
// L'adresse /gestion/?demo force la démonstration, avec de faux clients, sans rien lire de la vraie base.
export async function creerStore() {
  const reel = CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && !new URLSearchParams(location.search).has("demo");
  const module = await import(reel ? "./store-supabase.mjs" : "./store-local.mjs");
  return module.creer(CONFIG);
}
