// Fonction « whatsapp-envoi » : envoie depuis Gestion la réponse à un client WhatsApp (usage secondaire : Nani répond surtout depuis l'app).
// Appelée par l'outil avec la session de la personne (verify_jwt = true). La conversation se lit avec cette session : seul un administrateur
// de Secret ou de Taxi la voit (RLS, migration 58). L'envoi passe par Telnyx (TELNYX_API_KEY), dans la fenêtre de 24 h de Meta seulement.
// Le message est rangé dans la conversation AVANT l'appel à Telnyx (origine « gestion », statut « envoi », migration 64), puis complété avec
// l'id Telnyx (« envoye ») : un délai dépassé ne fait plus disparaître un message parti. La proposition passe « traitee ».
// Sans réponse sûre, le message reste « envoi » : l'écran demande de vérifier dans WhatsApp après 30 secondes (whatsapp_confirmer_envoi),
// la reprise de la fonction « whatsapp » le passe en échec visible après 5 minutes. Les statuts de Telnyx (remis, lu, échec) arrivent
// ensuite sur la fonction « whatsapp » (webhook_url de l'envoi).
// Voucher en image (21.11.2026) : une demande en multipart (conversation_id, reservation_id, legende, fichier) part dans la conversation du
// client par voucher.js, avec les mêmes garde-fous (session, whatsapp_peut_ecrire, fenêtre, contenuInterne, verrou, résultat incertain)
// et en plus la coexistence et la fenêtre relues chez Telnyx. Même fonction que le texte : mêmes secrets, mêmes origines, un seul déploiement.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { lireEnvoi, corpsTelnyx, lireReponseTelnyx, lireEnvoiVoucher, imageAcceptee, controleEnvoi, refusEnvoi, IMAGE_MAX_OCTETS, CORPS_MAX_OCTETS } from "./calc.js";
import { envoyerVoucherImage } from "./voucher.js";
import { fenetreOuverte, servicesDeProposition } from "../whatsapp/proposer.js";
import { dossierPourControle, netsPourControle } from "../agent/outils.js";
import { contactApporteur, fichesDuContact, nomsABloquer, nomsContactsTypes } from "../agent/apporteur.js";

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
  if ((req.headers.get("content-type") || "").startsWith("multipart/form-data")) return json(...(await voucher(req, autorisation)));
  const demande = lireEnvoi(await req.json().catch(() => null));
  if ("erreur" in demande) return json({ erreur: demande.erreur }, 400);

  const URL_SB = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: autorisation } }, auth: { persistSession: false } });
  const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: qui } = await sb.auth.getUser();
  if (!qui?.user) return json({ erreur: "non_connecte" }, 401);

  // Lue avec la session : une conversation que la personne ne peut pas lire n'existe pas pour elle.
  // type_contact et partenaire_id (migration 68) : une réponse à un apporteur peut porter son propre nom. Sans les colonnes, la lecture d'avant.
  // dossier_id : le dossier relié, dont les nets bloquent (contenuInterne).
  let lue: any = await sb.from("whatsapp_conversations").select("id, organisation_id, telephone, entite_id, dossier_id, reponses, type_contact, partenaire_id").eq("id", demande.conversation_id).maybeSingle();
  if (lue.error && lue.error.code === "42703") lue = await sb.from("whatsapp_conversations").select("id, organisation_id, telephone, entite_id, dossier_id").eq("id", demande.conversation_id).maybeSingle();
  const { data: conv, error } = lue;
  if (error) return json({ erreur: "base" }, 500);
  if (!conv) return json({ erreur: "droit_manquant" }, 403);
  // Lire ne suffit pas (migration 63 : WhatsApp commun en lecture) : envoyer demande d'être administrateur de l'entreprise de la conversation.
  const peut = await sb.rpc("whatsapp_peut_ecrire", { p_conversation: conv.id });
  // Toute erreur ferme (audit sécurité n° 7) : la migration 63 est en production, le repli « fonction absente » ne sert plus.
  if (peut.error || peut.data !== true) return json({ erreur: "droit_manquant" }, 403);
  const { data: msgs, error: errM } = await sb.from("whatsapp_messages").select("sens, envoye_le").eq("conversation_id", conv.id).eq("sens", "entrant").order("envoye_le", { ascending: false }).limit(1);
  // Une lecture en échec n'est pas une fenêtre fermée (audit M4).
  if (errM) return json({ erreur: "base" }, 500);
  if (!fenetreOuverte(msgs || [])) return json({ erreur: "fenetre_fermee" }, 409);
  // Garde-fou de la PR 278, aussi côté serveur : jamais un net, une commission ni un nom de partenaire vers le client, même si l'écran a été
  // contourné. Lu avec la clé de service dans l'entreprise de la conversation (les deux si elle est à trier). Un montant égal au net d'un
  // autre service du catalogue : 409 « montant_a_confirmer », la personne confirme et l'écran renvoie la même liste (refusEnvoi).
  const refus = refusEnvoi(await contenuInterne(admin, conv, demande.texte, { sb, propositionId: demande.proposition_id }), demande.montants_confirmes);
  if (refus) return json(refus.corps, refus.status);
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

  // 1. Le message est rangé avant l'appel (audit I1) : s'il ne peut pas l'être, rien ne part.
  const { data: range, error: errR } = await admin.rpc("whatsapp_ranger", { org: conv.organisation_id, tel: conv.telephone, nom_profil: null, m: { sens: "sortant", origine: "gestion", type: "text", texte: demande.texte, medias: [], envoye_le: new Date().toISOString(), statut_envoi: "envoi" } });
  const messageId: string | null = range?.message_id || null;
  if (errR || !messageId) {
    await relacher();
    console.error("whatsapp-envoi : message non rangé, rien n'est parti", errR?.message || "sans id");
    return json({ erreur: "base" }, 500);
  }
  // Refus sûr de Telnyx : le message sort du fil (rien n'est parti) et la proposition redevient à faire.
  const retirer = async () => {
    const { error } = await admin.rpc("whatsapp_retirer_envoi", { p_message: messageId });
    if (error) console.error("whatsapp-envoi : envoi refusé mais message non retiré", error.message);
    await relacher();
  };

  // 2. L'appel. webhook_url : les statuts de ce message (envoyé, remis, lu, échec) reviennent à la fonction « whatsapp ».
  let rep: Response;
  try {
    rep = await fetch("https://api.telnyx.com/v2/messages/whatsapp", {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpsTelnyx({ de: regl.numero, vers: conv.telephone, texte: demande.texte, webhook: `${URL_SB}/functions/v1/whatsapp` })),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Délai dépassé ou coupure : Telnyx a peut-être envoyé. Le message reste « envoi » dans le fil et la proposition « envoi » : après
    // 30 secondes, l'écran propose « C'est parti » ou « Pas parti » ; après 5 minutes, il passe en échec visible.
    return json({ erreur: "verifier_whatsapp", message_id: messageId }, 504);
  }
  const lu = lireReponseTelnyx(rep.status, await rep.json().catch(() => null));
  if (!lu.ok) {
    // Un 5xx de Telnyx, ou un 2xx illisible, ne prouve pas que rien n'est parti : même doute qu'un délai dépassé.
    if (lu.statut >= 500 || (lu.statut >= 200 && lu.statut < 300)) return json({ erreur: "verifier_whatsapp", message_id: messageId }, 504);
    await retirer();
    console.error("whatsapp-envoi : refus Telnyx", lu.statut, lu.code);
    return json({ erreur: "telnyx_refuse", code: lu.code }, 502);
  }

  // 3. Parti : le message est complété avec l'id Telnyx (les statuts s'y accrochent). Deux essais ; sinon il reste « envoi » et Nani confirme.
  const maintenant = new Date().toISOString();
  let complete = false;
  for (let i = 0; i < 2 && !complete; i++) {
    const { data: maj, error } = await admin.from("whatsapp_messages").update({ telnyx_id: lu.id, statut_envoi: "envoye", statut_le: maintenant }).eq("id", messageId).in("statut_envoi", ["envoi", "echec"]).select("id");
    if (error) {
      console.error("whatsapp-envoi : message parti, id Telnyx non noté", error.message);
      continue;
    }
    complete = true;
    // Plus de ligne à compléter : retiré entre-temps par « Pas parti » (appel très lent). Il est pourtant parti : on le range de nouveau.
    if (!maj || !maj.length) {
      const { error: errN } = await admin.rpc("whatsapp_ranger", { org: conv.organisation_id, tel: conv.telephone, nom_profil: null, m: { telnyx_id: lu.id, sens: "sortant", origine: "gestion", type: "text", texte: demande.texte, medias: [], envoye_le: maintenant, statut_envoi: "envoye" } });
      if (errN) console.error("whatsapp-envoi : message parti mais non rangé de nouveau", errN.message);
    }
  }
  // Toutes les propositions ouvertes de la conversation sont soldées, comme pour une réponse depuis l'app.
  const { error: errP2 } = await admin.from("whatsapp_propositions").update({ statut: "traitee", traitee_le: maintenant, traitee_par: qui.user.id, traitee_par_quoi: "gestion" }).eq("conversation_id", conv.id).in("statut", ["a_faire", "en_cours", "envoi"]);
  if (errP2) console.error("whatsapp-envoi : propositions non soldées", errP2.message);
  return json({ ok: true, message_id: messageId, complet: complete });
});

// Voucher en image : session d'abord, puis le corps lu en flux (6 Mo au plus), puis voucher.js. Rend [corps, statut].
// Revue de sécurité de la PR 304 : aucune lecture du corps sans session valide ; toute exception avant le rangement rend « base » en JSON
// (voucher.js prend lui-même celles d'après le rangement).
async function voucher(req: Request, autorisation: string): Promise<[unknown, number]> {
  try {
    if (Number(req.headers.get("content-length") || 0) > CORPS_MAX_OCTETS) return [{ erreur: "image_trop_grosse" }, 413];
    const URL_SB = Deno.env.get("SUPABASE_URL")!;
    const sb = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: autorisation } }, auth: { persistSession: false } });
    const { data: qui } = await sb.auth.getUser();
    if (!qui?.user) {
      await req.body?.cancel();
      return [{ erreur: "non_connecte" }, 401];
    }
    const brut = await lireBorne(req, CORPS_MAX_OCTETS);
    if (!brut) return [{ erreur: "image_trop_grosse" }, 413];
    const form = await new Response(brut, { headers: { "content-type": req.headers.get("content-type") || "" } }).formData().catch(() => null);
    if (!form) return [{ erreur: "demande_invalide" }, 400];
    const champ = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : undefined);
    const demande = lireEnvoiVoucher({ conversation_id: champ("conversation_id"), reservation_id: champ("reservation_id"), essai_id: champ("essai_id"), legende: champ("legende"), numero_confirme: champ("numero_confirme"), montants_confirmes: champ("montants_confirmes") });
    if ("erreur" in demande) return [{ erreur: demande.erreur }, 400];
    const fichier = form.get("fichier");
    if (!(fichier instanceof File)) return [{ erreur: "image_invalide" }, 400];
    if (fichier.size > IMAGE_MAX_OCTETS) return [{ erreur: "image_trop_grosse" }, 413];
    const octets = new Uint8Array(await fichier.arrayBuffer());
    const image = imageAcceptee(octets);
    if (!("ok" in image)) return [{ erreur: image.erreur }, 400];

    const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const r = await envoyerVoucherImage(
      {
        sb, admin, fetch, cle: Deno.env.get("TELNYX_API_KEY") || "", webhook: `${URL_SB}/functions/v1/whatsapp`, contenuInterne,
        // L'organisation servie par la fonction « whatsapp » (même secret, même défaut) : sa purge ne parcourt que ce dossier du bucket.
        organisation: Deno.env.get("WHATSAPP_ORGANISATION") || "00000000-0000-0000-0000-00000000a000",
        uuid: () => crypto.randomUUID(), maintenant: () => Date.now(), journal: console.error,
      },
      { ...demande, octets, mime: image.mime, nom: String(fichier.name || "voucher.png").replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 120) }
    );
    return [r.corps, r.status];
  } catch (err) {
    console.error("whatsapp-envoi : voucher, erreur avant le rangement, rien n'est parti", String((err as Error)?.message || err).slice(0, 200));
    return [{ erreur: "base" }, 500];
  }
}

// Lit un corps sans jamais garder plus de `max` octets en mémoire (un Content-Length peut manquer ou mentir). null si c'est plus gros.
async function lireBorne(req: Request, max: number) {
  const lecteur = req.body?.getReader();
  if (!lecteur) return new Uint8Array();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await lecteur.cancel();
      return null;
    }
    morceaux.push(value);
  }
  const tout = new Uint8Array(total);
  let i = 0;
  for (const m of morceaux) (tout.set(m, i), (i += m.length));
  return tout;
}

// Ce que le texte contient de bloquant ou d'à confirmer (controleEnvoi, calc.js) : { a_retirer, a_confirmer }.
//   - bloquent : le net d'un service du dossier relié à la conversation, les nets, marges et commissions de ce dossier, les noms de
//     partenaires ; un montant égal à un prix de vente du catalogue ou du dossier ne bloque pas ;
//   - à confirmer : un montant égal au net d'un autre service du catalogue (faux blocage du 21.11.2026 : « 10,000 THB » pour deux minivans,
//     égal au net d'une prestation sans rapport).
// Les services de la proposition envoyée (références gardées par la préparation, servicesDeProposition) bloquent aussi, même sans dossier
// relié (revue de sécurité de la PR 306). Sans dossier ni proposition, chaque net du catalogue est à confirmer (« net du catalogue »).
// Nets illisibles : controle_impossible, rien ne part. Sans le droit de voir les nets (permissions_dans, session de la personne) dans
// chaque entreprise contrôlée, le 409 ne dit pas la valeur. Le contact est un apporteur : ses
// propres fiches sortent de la liste des noms (agent/apporteur.js, fichesDuContact), la réponse lui est adressée ; tout autre nom reste
// bloqué. Revue de sécurité de la PR 299 : aussi les noms des conversations typées de l'organisation (partenaire, chauffeur, hôtel,
// apporteur), sauf celui de l'apporteur à qui l'on répond. Chaque nom se compare aussi sans « co, ltd, company, tour, travel »
// (partenairesCites, agent/outils.js).
// deno-lint-ignore no-explicit-any
async function contenuInterne(admin: any, conv: { id?: string; organisation_id: string; entite_id: string | null; dossier_id?: string | null; telephone?: string; reponses?: string; type_contact?: string | null; partenaire_id?: string | null }, texte: string, { sb = null, propositionId = null }: { sb?: any; propositionId?: string | null } = {}) {
  const ferme = { a_retirer: ["nom_prestataire:lecture_impossible"], a_confirmer: [] as number[] };
  let ids: string[] = conv.entite_id ? [conv.entite_id] : [];
  // Conversation à trier : le texte est contrôlé dans Secret et Taxi ensemble. Sans cette liste, rien n'est contrôlable : on ferme
  // (revue de sécurité de la PR 304).
  if (!ids.length) {
    const { data, error } = await admin.from("entites").select("id").eq("organisation_id", conv.organisation_id).in("slug", ["secret", "taxi"]);
    if (error) return ferme;
    ids = (data || []).map((e: { id: string }) => e.id);
  }
  if (!ids.length) return { a_retirer: [], a_confirmer: [] };
  const [lusNets, relie, pr, tr, pa, prop, droits] = await Promise.all([
    netsPourControle(admin, ids),
    dossierPourControle(admin, conv.dossier_id || null, ids),
    admin.from("prestations").select("prix_vente").in("entite_id", ids).limit(5000),
    admin.from("trajets").select("prix_adulte, prix_enfant").in("entite_id", ids).limit(5000),
    admin.from("partenaires").select("id, nom, categorie, contact").in("entite_id", ids).limit(2000),
    propositionId && conv.id ? admin.from("whatsapp_propositions").select("avertissements").eq("id", propositionId).eq("conversation_id", conv.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    Promise.all(ids.map((e) => (sb ? sb.rpc("permissions_dans", { e }) : Promise.resolve({ data: [], error: null })))),
  ]);
  const refs = servicesDeProposition(prop.data ? prop.data.avertissements : []);
  // deno-lint-ignore no-explicit-any
  const masquer = droits.some((d: any) => d.error || !Array.isArray(d.data) || !d.data.includes("partenaires.lire") || !d.data.includes("partenaires.nets"));
  // Revue de la PR 298 : sans les fiches partenaires, aucun nom ne peut être contrôlé. On ferme : rien ne part. Même chose sans les noms
  // des conversations typées (revue de la PR 299).
  if (pa.error) return ferme;
  const types = await nomsContactsTypes(admin, conv.organisation_id, { sauf: contactApporteur(conv) ? (conv as { id?: string }).id || null : null });
  if (types.erreur) return ferme;
  const nombres = (lignes: Record<string, unknown>[] | null, cles: string[]) => new Set((lignes || []).flatMap((l) => cles.map((k) => Number(l[k]))).filter((n) => Number.isFinite(n) && n > 0));
  const ventes = new Set([...nombres(pr.data, ["prix_vente"]), ...nombres(tr.data, ["prix_adulte", "prix_enfant"])]);
  const prestataires = [...new Set([...nomsABloquer(pa.data || [], fichesDuContact(conv, pa.data || [])), ...types.noms])];
  return controleEnvoi(texte, { nets: lusNets.nets, refs, servicesEnCours: relie.services, internes: relie.internes, ventes, ventesDossier: relie.ventes, prestataires, masquer, controleImpossible: lusNets.erreur || !!prop.error });
}
