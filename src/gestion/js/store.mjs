import { CONFIG } from "./config.mjs";

// Supabase si la configuration est renseignée, sinon mode démo local.
// L'adresse /gestion/?demo force la démonstration, avec de faux clients, sans rien lire de la vraie base.
export async function creerStore() {
  const reel = CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && !new URLSearchParams(location.search).has("demo");
  // Deux imports écrits en entier : le regroupement du build (scripts/regrouper-gestion.cjs) les suit, une adresse calculée lui échapperait.
  const module = reel ? await import("./store-supabase.mjs") : await import("./store-local.mjs");
  return module.creer(CONFIG);
}
