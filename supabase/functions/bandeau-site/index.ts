// Fonction publique « bandeau-site » : renvoie au site secrettravelandtour.com les bandeaux d'information en ligne (JSON, lecture seule).
// Aucun nom de client ni donnée interne : texte anglais, type, lien, pages visées, dates. Mise en cache courte (une minute) pour que
// « éteindre » dans Gestion se voie vite sur le site sans appeler la base à chaque visite. Contrat : docs/gestion/bandeau-site.md.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { reponsePublique } from "./calc.js";

const ENTETES = {
  "Content-Type": "application/json; charset=utf-8",
  // Données publiques sans cookie ni jeton : lisibles de partout, le site les lit côté navigateur.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
  "X-Content-Type-Options": "nosniff",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ENTETES });
  if (req.method !== "GET" && req.method !== "HEAD") return new Response(JSON.stringify({ error: "method" }), { status: 405, headers: ENTETES });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const maintenant = new Date().toISOString();
  // Seulement les bandeaux des entreprises de l'organisation propriétaire du site (Zwald par défaut) qui publient sur le site.
  const organisation = Deno.env.get("SITE_ORGANISATION") || "00000000-0000-0000-0000-00000000a000";
  const ent = await db.from("entites").select("id").eq("organisation_id", organisation).eq("publie_site", true);
  const ids = (ent.data || []).map((e) => e.id);
  const { data, error } = await db
    .from("bandeaux_site")
    .select("id, marques, type, texte, valeurs, lien, lien_page, cible, sections, produits, debut, fin, fermable, priorite, actif")
    .eq("actif", true)
    .in("entite_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
    .lte("debut", maintenant)
    .or(`fin.is.null,fin.gt.${maintenant}`)
    .limit(50);
  if (error || ent.error) {
    console.error("bandeaux non lus :", (error || ent.error)!.message);
    // Le site n'affiche rien plutôt qu'une erreur : liste vide, cache très court.
    return new Response(JSON.stringify({ version: 1, generated_at: maintenant, banners: [] }), { status: 200, headers: { ...ENTETES, "Cache-Control": "public, max-age=15" } });
  }
  return new Response(req.method === "HEAD" ? null : JSON.stringify(reponsePublique(data || [])), { status: 200, headers: ENTETES });
});
