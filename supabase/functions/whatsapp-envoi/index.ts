// Fonction « whatsapp-envoi » : envoie depuis Gestion la réponse à un client WhatsApp (usage secondaire : Nani répond surtout depuis l'app).
// Appelée par l'outil avec la session de la personne (verify_jwt = true). La conversation se lit avec cette session : seul un administrateur
// de Secret ou de Taxi la voit (RLS, migration 58). L'envoi passe par Telnyx (TELNYX_API_KEY), dans la fenêtre de 24 h de Meta seulement.
// Le message envoyé est rangé dans la conversation (origine « gestion ») et la proposition passe « traitee ».
import { createClient } from "jsr:@supabase/supabase-js@2";
import { lireEnvoi, corpsTelnyx, lireReponseTelnyx } from "./calc.js";
import { fenetreOuverte } from "../whatsapp/proposer.js";

const ORIGINES = (Deno.env.get("ASSISTANT_ORIGINES") || "https://gestion.zwaldtravelplanner.com").split(",").map((x) => x.trim());
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

Deno.serve(async (req) => {
  const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: entetes(req) });
  if (req.method === "OPTIONS") return new Response("ok", { headers: entetes(req) });
  if (req.method !== "POST") return json({ erreur: "methode" }, 405);
  const autorisation = req.headers.get("authorization") || "";
  if (!/^Bearer .+/.test(autorisation)) return json({ erreur: "non_connecte" }, 401);
  const demande = lireEnvoi(await req.json().catch(() => null));
  if ("erreur" in demande) return json({ erreur: demande.erreur }, 400);

  const URL_SB = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: autorisation } }, auth: { persistSession: false } });
  const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: qui } = await sb.auth.getUser();
  if (!qui?.user) return json({ erreur: "non_connecte" }, 401);

  // Lue avec la session : une conversation que la personne ne peut pas lire n'existe pas pour elle.
  const { data: conv, error } = await sb.from("whatsapp_conversations").select("id, organisation_id, telephone").eq("id", demande.conversation_id).maybeSingle();
  if (error) return json({ erreur: "base" }, 500);
  if (!conv) return json({ erreur: "droit_manquant" }, 403);
  const { data: msgs } = await sb.from("whatsapp_messages").select("sens, envoye_le").eq("conversation_id", conv.id).eq("sens", "entrant").order("envoye_le", { ascending: false }).limit(1);
  if (!fenetreOuverte(msgs || [])) return json({ erreur: "fenetre_fermee" }, 409);
  const cle = Deno.env.get("TELNYX_API_KEY");
  if (!cle) return json({ erreur: "non_configure" }, 503);
  const { data: regl } = await admin.from("whatsapp_reglages").select("numero").eq("organisation_id", conv.organisation_id).maybeSingle();
  if (!regl?.numero) return json({ erreur: "numero_inconnu" }, 503);

  let rep: Response;
  try {
    rep = await fetch("https://api.telnyx.com/v2/messages/whatsapp", {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpsTelnyx({ de: regl.numero, vers: conv.telephone, texte: demande.texte })),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return json({ erreur: "telnyx_injoignable" }, 502);
  }
  const lu = lireReponseTelnyx(rep.status, await rep.json().catch(() => null));
  if (!lu.ok) {
    console.error("whatsapp-envoi : refus Telnyx", lu.statut, lu.code);
    return json({ erreur: "telnyx_refuse", code: lu.code }, 502);
  }
  const maintenant = new Date().toISOString();
  const { data: range, error: errR } = await admin.rpc("whatsapp_ranger", { org: conv.organisation_id, tel: conv.telephone, nom_profil: null, m: { telnyx_id: lu.id, sens: "sortant", origine: "gestion", type: "text", texte: demande.texte, medias: [], envoye_le: maintenant } });
  if (errR) console.error("whatsapp-envoi : message envoyé mais non rangé", errR.message);
  const filtre = admin.from("whatsapp_propositions").update({ statut: "traitee", traitee_le: maintenant, traitee_par: qui.user.id, traitee_par_quoi: "gestion" }).eq("conversation_id", conv.id).in("statut", ["a_faire", "en_cours"]);
  await (demande.proposition_id ? filtre.eq("id", demande.proposition_id) : filtre);
  return json({ ok: true, message_id: range?.message_id || null });
});
