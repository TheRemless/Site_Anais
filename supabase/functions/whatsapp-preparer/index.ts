// Fonction « whatsapp-preparer » : « Préparer une réponse » touché par Nani dans la boîte WhatsApp, pour un message que le tri a laissé de
// côté (message jugé personnel, partenaire, réponses sur demande) ou après une panne. Jamais pour un Contact personnel (reponses = 'jamais') :
// rien de lui ne part chez Anthropic, la fonction répond contact_personnel (403, revue de sécurité de la PR 299). Appelée avec la session de la personne (verify_jwt) :
// la conversation se lit avec cette session, donc seulement par un administrateur de Secret ou de Taxi (RLS, migrations 58 et 59).
// Répond 202 tout de suite ; la proposition « en_cours » apparaît par Realtime, puis « a_faire ». Mêmes limites de budget que le tri
// automatique (whatsapp/reponse.ts, preparerALaDemande).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { preparerALaDemande } from "../whatsapp/reponse.ts";

const ORIGINES = (Deno.env.get("ASSISTANT_ORIGINES") || "https://gestion.zwaldtravelplanner.com").split(",").map((x) => x.trim());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function entetes(req: Request) {
  const origine = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINES.includes(origine) ? origine : ORIGINES[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
    "Content-Type": "application/json",
  };
}
const STATUTS: Record<string, number> = { droit_manquant: 403, contact_personnel: 403, rien_a_repondre: 409, a_trier: 409, limite: 429, agent_eteint: 403, non_configure: 503 };

Deno.serve(async (req) => {
  const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: entetes(req) });
  if (req.method === "OPTIONS") return new Response("ok", { headers: entetes(req) });
  if (req.method !== "POST") return json({ erreur: "methode" }, 405);
  const autorisation = req.headers.get("authorization") || "";
  if (!/^Bearer .+/.test(autorisation)) return json({ erreur: "non_connecte" }, 401);
  const demande = await req.json().catch(() => null);
  const id = demande && typeof demande.conversation_id === "string" && UUID.test(demande.conversation_id) ? demande.conversation_id : null;
  if (!id) return json({ erreur: "conversation_invalide" }, 400);

  const URL_SB = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: autorisation } }, auth: { persistSession: false } });
  const { data: qui } = await sb.auth.getUser();
  if (!qui?.user) return json({ erreur: "non_connecte" }, 401);
  // Lue avec la session : une conversation que la personne ne peut pas lire n'existe pas pour elle.
  const { data: conv, error } = await sb.from("whatsapp_conversations").select("id").eq("id", id).maybeSingle();
  if (error) return json({ erreur: "base" }, 500);
  if (!conv) return json({ erreur: "droit_manquant" }, 403);
  // Lire ne suffit pas (migration 63 : WhatsApp commun en lecture) : préparer demande d'être administrateur de l'entreprise de la conversation.
  const peut = await sb.rpc("whatsapp_peut_ecrire", { p_conversation: conv.id });
  // Toute erreur ferme (audit sécurité n° 7) : la migration 63 est en production, le repli « fonction absente » ne sert plus.
  if (peut.error || peut.data !== true) return json({ erreur: "droit_manquant" }, 403);

  const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const r = await preparerALaDemande(admin, conv.id);
  if ("erreur" in r && r.erreur) return json({ erreur: r.erreur }, STATUTS[r.erreur] || 400);
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(r.tache);
  else await r.tache;
  return json({ ok: true }, 202);
});
