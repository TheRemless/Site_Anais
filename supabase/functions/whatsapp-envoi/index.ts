// Fonction « whatsapp-envoi » : envoie depuis Gestion la réponse à un client WhatsApp (usage secondaire : Nani répond surtout depuis l'app).
// Appelée par l'outil avec la session de la personne (verify_jwt = true). La conversation se lit avec cette session : seul un administrateur
// de Secret ou de Taxi la voit (RLS, migration 58). L'envoi passe par Telnyx (TELNYX_API_KEY), dans la fenêtre de 24 h de Meta seulement.
// Le message envoyé est rangé dans la conversation (origine « gestion ») et la proposition passe « traitee ».
import { createClient } from "jsr:@supabase/supabase-js@2";
import { lireEnvoi, corpsTelnyx, lireReponseTelnyx } from "./calc.js";
import { fenetreOuverte } from "../whatsapp/proposer.js";
import { controlerReponse } from "../agent/outils.js";

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
  const { data: conv, error } = await sb.from("whatsapp_conversations").select("id, organisation_id, telephone, entite_id").eq("id", demande.conversation_id).maybeSingle();
  if (error) return json({ erreur: "base" }, 500);
  if (!conv) return json({ erreur: "droit_manquant" }, 403);
  const { data: msgs } = await sb.from("whatsapp_messages").select("sens, envoye_le").eq("conversation_id", conv.id).eq("sens", "entrant").order("envoye_le", { ascending: false }).limit(1);
  if (!fenetreOuverte(msgs || [])) return json({ erreur: "fenetre_fermee" }, 409);
  // Garde-fou de la PR 278, aussi côté serveur : jamais un net, une commission ni un nom de partenaire vers le client, même si l'écran a été
  // contourné. Lu avec la clé de service dans l'entreprise de la conversation (les deux si elle est à trier).
  const bloque = await contenuInterne(admin, conv, demande.texte);
  if (bloque.length) return json({ erreur: "contenu_interne", a_retirer: bloque }, 422);
  const cle = Deno.env.get("TELNYX_API_KEY");
  if (!cle) return json({ erreur: "non_configure" }, 503);
  const { data: regl } = await admin.from("whatsapp_reglages").select("numero").eq("organisation_id", conv.organisation_id).maybeSingle();
  if (!regl?.numero) return json({ erreur: "numero_inconnu" }, 503);

  // Verrou contre le double envoi (double tap, nouvel essai après un délai) :
  //  - avec une proposition, elle passe de « a_faire » à « envoi » en une écriture ; si elle n'est plus à faire, rien ne part ;
  //  - sans proposition, le même texte envoyé depuis Gestion dans la dernière minute ne repart pas.
  if (demande.proposition_id) {
    const { data: pris, error: errP } = await admin.from("whatsapp_propositions").update({ statut: "envoi" }).eq("id", demande.proposition_id).eq("conversation_id", conv.id).eq("statut", "a_faire").select("id");
    if (errP) return json({ erreur: "base" }, 500);
    if (!pris || !pris.length) return json({ erreur: "deja_traitee" }, 409);
  } else {
    const { data: recent } = await admin.from("whatsapp_messages").select("id").eq("conversation_id", conv.id).eq("origine", "gestion").eq("texte", demande.texte).gte("envoye_le", new Date(Date.now() - 60_000).toISOString()).limit(1);
    if (recent && recent.length) return json({ erreur: "deja_traitee" }, 409);
  }
  // En cas d'échec sûr (rien n'est parti), la proposition redevient « a_faire ».
  const relacher = () => (demande.proposition_id ? admin.from("whatsapp_propositions").update({ statut: "a_faire" }).eq("id", demande.proposition_id).eq("statut", "envoi") : Promise.resolve());

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
    // Délai dépassé : Telnyx a peut-être envoyé. La proposition reste « envoi » (pas de nouvel essai possible depuis Gestion) : Nani vérifie
    // dans WhatsApp, puis la marque traitée ou répond depuis l'app (l'écho la soldera).
    return json({ erreur: "verifier_whatsapp" }, 504);
  }
  const lu = lireReponseTelnyx(rep.status, await rep.json().catch(() => null));
  if (!lu.ok) {
    await relacher();
    console.error("whatsapp-envoi : refus Telnyx", lu.statut, lu.code);
    return json({ erreur: "telnyx_refuse", code: lu.code }, 502);
  }
  const maintenant = new Date().toISOString();
  const { data: range, error: errR } = await admin.rpc("whatsapp_ranger", { org: conv.organisation_id, tel: conv.telephone, nom_profil: null, m: { telnyx_id: lu.id, sens: "sortant", origine: "gestion", type: "text", texte: demande.texte, medias: [], envoye_le: maintenant } });
  if (errR) console.error("whatsapp-envoi : message envoyé mais non rangé", errR.message);
  // Toutes les propositions ouvertes de la conversation sont soldées, comme pour une réponse depuis l'app.
  await admin.from("whatsapp_propositions").update({ statut: "traitee", traitee_le: maintenant, traitee_par: qui.user.id, traitee_par_quoi: "gestion" }).eq("conversation_id", conv.id).in("statut", ["a_faire", "en_cours", "envoi"]);
  return json({ ok: true, message_id: range?.message_id || null });
});

// Montants égaux à un net (et à aucun prix de vente) et noms de partenaires présents dans le texte.
// deno-lint-ignore no-explicit-any
async function contenuInterne(admin: any, conv: { organisation_id: string; entite_id: string | null }, texte: string) {
  let ids: string[] = conv.entite_id ? [conv.entite_id] : [];
  if (!ids.length) {
    const { data } = await admin.from("entites").select("id").eq("organisation_id", conv.organisation_id).in("slug", ["secret", "taxi"]);
    ids = (data || []).map((e: { id: string }) => e.id);
  }
  if (!ids.length) return [];
  const [pn, tn, pr, tr, pa] = await Promise.all([
    admin.from("prestations_nets").select("net, net_enfant").in("entite_id", ids).limit(5000),
    admin.from("trajets_nets").select("net_adulte, net_enfant").in("entite_id", ids).limit(5000),
    admin.from("prestations").select("prix_vente").in("entite_id", ids).limit(5000),
    admin.from("trajets").select("prix_adulte, prix_enfant").in("entite_id", ids).limit(5000),
    admin.from("partenaires").select("nom").in("entite_id", ids).limit(2000),
  ]);
  const nombres = (lignes: Record<string, unknown>[] | null, cles: string[]) => new Set((lignes || []).flatMap((l) => cles.map((k) => Number(l[k]))).filter((n) => Number.isFinite(n) && n > 0));
  const internes = new Set([...nombres(pn.data, ["net", "net_enfant"]), ...nombres(tn.data, ["net_adulte", "net_enfant"])]);
  const ventes = new Set([...nombres(pr.data, ["prix_vente"]), ...nombres(tr.data, ["prix_adulte", "prix_enfant"])]);
  const prestataires = (pa.data || []).map((p: { nom: string }) => String(p.nom || "").trim()).filter((x: string) => x.length > 2);
  const c = controlerReponse(texte, { signer: true, internes, ventes, prestataires });
  return (c.avertissements || []).filter((a: string) => a.startsWith("montant_interne") || a.startsWith("nom_prestataire"));
}
