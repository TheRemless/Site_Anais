import { CONFIG } from "./config.mjs";

// Supabase si la configuration est renseignée, sinon mode démo local.
export async function creerStore() {
  const reel = CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY;
  const module = await import(reel ? "./store-supabase.mjs" : "./store-local.mjs");
  return module.creer(CONFIG);
}
