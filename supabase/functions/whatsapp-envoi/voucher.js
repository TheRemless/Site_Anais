// Fonction « whatsapp-envoi », envoi du voucher en image dans la conversation WhatsApp du client (21.11.2026, demande de Jérémy).
// Appelée par index.ts quand la demande arrive en multipart (champs conversation_id, reservation_id, legende, fichier image).
// Les dépendances sont passées par l'appelant (clients Supabase, fetch, horloge) : la logique se teste sous Node
// (tests/gestion-whatsapp-voucher.test.js) sans réseau ni base.
//
// Ordre des contrôles, du moins cher au plus cher. Tout refus arrive AVANT que le fichier soit déposé : rien ne traîne pour un envoi refusé.
//   1. conversation lue avec la session, whatsapp_peut_ecrire (comme le texte) ;
//   2. réservation et dossier lus avec la session ; whatsapp_admin de l'entreprise de la réservation (Secret ou Taxi seulement : ni ZTP ni Mook) ;
//   3. la conversation est celle du client du dossier (contactVoucher : jamais un prestataire ni un contact personnel) ;
//   4. fenêtre de 24 h vue par la base (fenetreOuverte, comme le texte) ;
//   5. légende contrôlée comme un texte (contenuInterne : nets, commissions, noms de partenaires et de contacts typés) ;
//   6. coexistence du numéro de l'entreprise lue chez Telnyx (cache de 3 minutes) : seul « active » envoie ;
//   7. fenêtre de 24 h relue chez Telnyx (conversation_window) : en cas de doute, rien ne part ;
//   8. verrou : le même voucher vers la même conversation depuis moins de 2 minutes ne repart pas (lecture, puis clé unique en base).
// Puis : fichier déposé dans le bucket privé « whatsapp-sortant » (clé de service), message rangé « envoi » (whatsapp_ranger, origine
// « gestion », type image), URL signée de 15 minutes, appel à Telnyx, message complété avec l'id Telnyx.
// Effacement du fichier : tout de suite sur un refus sûr ; sinon quand Telnyx annonce « remis », « lu » ou « échec » (fonction « whatsapp »),
// et au plus tard par la purge de la fonction « whatsapp » après une heure. Pas d'effacement juste après le 200 de Telnyx : Telnyx ne dit pas
// quand il télécharge le lien, l'effacer trop tôt ferait partir un message sans image.
import { fenetreOuverte } from "../whatsapp/proposer.js";
import {
  lireReponseTelnyx, contactVoucher, corpsTelnyxImage, lienAvecVersion, lireCoexistence, lireFenetreTelnyx, adresseCoexistence, adresseFenetre,
  cheminSortant, mediaVoucher, voucherRecent, cleVerrouVoucher, BUCKET_SORTANT, URL_SIGNEE_S, COEXISTENCE_CACHE_MS, VERROU_VOUCHER_MS,
} from "./calc.js";

const UNIFIEES = ["secret", "taxi"];
// État de coexistence par numéro, relu au plus toutes les 3 minutes par instance. Une lecture en échec n'est jamais gardée.
const cacheCoexistence = new Map();
export const viderCacheCoexistence = () => cacheCoexistence.clear();

async function coexistence(ctx, numero) {
  const deja = cacheCoexistence.get(numero);
  if (deja && ctx.maintenant() - deja.quand < COEXISTENCE_CACHE_MS) return deja;
  let rep;
  try {
    rep = await ctx.fetch(adresseCoexistence(numero), { headers: { Authorization: `Bearer ${ctx.cle}` }, redirect: "error", signal: AbortSignal.timeout(8_000) });
  } catch {
    return { etat: null, active: false };
  }
  const lu = lireCoexistence(rep.status, await rep.json().catch(() => null));
  if (lu.etat) cacheCoexistence.set(numero, { ...lu, quand: ctx.maintenant() });
  return lu;
}

async function fenetreTelnyx(ctx, numero, client) {
  try {
    const rep = await ctx.fetch(adresseFenetre(numero, client), { headers: { Authorization: `Bearer ${ctx.cle}` }, redirect: "error", signal: AbortSignal.timeout(8_000) });
    return lireFenetreTelnyx(rep.status, await rep.json().catch(() => null), ctx.maintenant());
  } catch {
    return false;
  }
}

// ctx : { sb (session), admin (clé de service), fetch, cle (TELNYX_API_KEY ou ""), webhook, contenuInterne(admin, conv, texte), uuid(),
//         maintenant(), journal(...) }
// demande : { conversation_id, reservation_id, legende, octets (Uint8Array), mime, nom, utilisateur }
// Rend { status, corps }.
export async function envoyerVoucherImage(ctx, demande) {
  const rep = (status, corps) => ({ status, corps });
  const journal = ctx.journal || (() => {});
  const { sb, admin } = ctx;

  // 1. La conversation, lue avec la session, et le droit d'y écrire.
  const lue = await sb.from("whatsapp_conversations").select("id, organisation_id, telephone, entite_id, client_id, dossier_id, reponses, type_contact, partenaire_id").eq("id", demande.conversation_id).maybeSingle();
  if (lue.error) return rep(500, { erreur: "base" });
  const conv = lue.data;
  if (!conv) return rep(403, { erreur: "droit_manquant" });
  const peut = await sb.rpc("whatsapp_peut_ecrire", { p_conversation: conv.id });
  if (peut.error || peut.data !== true) return rep(403, { erreur: "droit_manquant" });

  // 2. La réservation et son dossier, lus avec la session : la personne voit ce voucher. Administrer l'entreprise de la réservation
  //    (whatsapp_admin : Secret ou Taxi, réglages et toute l'entreprise) écarte ZTP et Mook.
  const r = await sb.from("reservations").select("id, entite_id, dossier_id, statut").eq("id", demande.reservation_id).maybeSingle();
  if (r.error) return rep(500, { erreur: "base" });
  if (!r.data) return rep(403, { erreur: "droit_manquant" });
  const adm = await sb.rpc("whatsapp_admin", { e: r.data.entite_id });
  if (adm.error || adm.data !== true) return rep(403, { erreur: "droit_manquant" });
  if (r.data.statut === "annule") return rep(409, { erreur: "reservation_annulee" });
  const d = await sb.from("dossiers").select("id, client_id, entite_id, annule").eq("id", r.data.dossier_id).maybeSingle();
  if (d.error) return rep(500, { erreur: "base" });
  if (!d.data) return rep(403, { erreur: "droit_manquant" });
  if (d.data.annule) return rep(409, { erreur: "reservation_annulee" });
  const ent = await admin.from("entites").select("id, organisation_id, slug").eq("id", r.data.entite_id).maybeSingle();
  if (ent.error) return rep(500, { erreur: "base" });
  if (!ent.data || !UNIFIEES.includes(ent.data.slug) || ent.data.organisation_id !== conv.organisation_id) return rep(403, { erreur: "droit_manquant" });

  // 3. Seulement la conversation du client du dossier.
  const contact = contactVoucher(conv, d.data);
  if (!contact.ok) return rep(403, { erreur: contact.erreur });

  // 4. Fenêtre de 24 h vue par la base. Une lecture en échec n'est pas une fenêtre fermée (audit M4) : erreur de base.
  const msgs = await sb.from("whatsapp_messages").select("sens, envoye_le").eq("conversation_id", conv.id).eq("sens", "entrant").order("envoye_le", { ascending: false }).limit(1);
  if (msgs.error) return rep(500, { erreur: "base" });
  if (!fenetreOuverte(msgs.data || [], ctx.maintenant())) return rep(409, { erreur: "fenetre_fermee" });

  // 5. La légende passe le même contrôle que le texte.
  if (demande.legende) {
    const bloque = await ctx.contenuInterne(admin, conv, demande.legende);
    if (bloque.length) return rep(422, { erreur: "contenu_interne", a_retirer: bloque });
  }

  // 6 et 7. Configuration, coexistence et fenêtre chez Telnyx.
  if (!ctx.cle) return rep(503, { erreur: "non_configure" });
  const regl = await admin.from("whatsapp_reglages").select("numero").eq("organisation_id", conv.organisation_id).maybeSingle();
  if (regl.error) return rep(500, { erreur: "base" });
  const numero = regl.data && regl.data.numero;
  if (!numero) return rep(503, { erreur: "numero_inconnu" });
  const co = await coexistence(ctx, numero);
  if (!co.active) return rep(409, { erreur: "coexistence_inactive", etat: co.etat });
  if (!(await fenetreTelnyx(ctx, numero, conv.telephone))) return rep(409, { erreur: "fenetre_fermee" });

  // 8. Verrou, d'abord en lecture : le même voucher parti de Gestion dans cette conversation depuis moins de 2 minutes.
  const depuis = new Date(ctx.maintenant() - VERROU_VOUCHER_MS).toISOString();
  const recents = await admin.from("whatsapp_messages").select("id, medias").eq("conversation_id", conv.id).eq("origine", "gestion").eq("type", "image").gte("envoye_le", depuis).limit(20);
  if (recents.error) return rep(500, { erreur: "base" });
  if (voucherRecent(recents.data, r.data.id)) return rep(409, { erreur: "deja_traitee" });

  // Le fichier, dans le bucket privé (aucune politique pour les personnes : seule la clé de service y lit et écrit).
  const stockage = admin.storage.from(BUCKET_SORTANT);
  const chemin = cheminSortant(conv.organisation_id, ctx.uuid(), demande.mime, ctx.maintenant());
  const effacer = async () => {
    const { error } = await stockage.remove([chemin]);
    if (error) journal("whatsapp-envoi : fichier temporaire non effacé, la purge s'en charge", error.message);
  };
  const depot = await stockage.upload(chemin, demande.octets, { contentType: demande.mime, upsert: false, cacheControl: "0" });
  if (depot.error) {
    journal("whatsapp-envoi : image non déposée, rien n'est parti", depot.error.message);
    return rep(500, { erreur: "base" });
  }

  // Le message est rangé avant l'appel (audit I1), avec une clé unique (evenement_id, index unique de la migration 64) : deux demandes
  // simultanées du même voucher n'en rangent qu'un, l'autre s'arrête là.
  const envoyeLe = new Date(ctx.maintenant()).toISOString();
  const media = mediaVoucher({ nom: demande.nom, taille: demande.octets.length, mime: demande.mime, chemin, reservation_id: r.data.id });
  const range = await admin.rpc("whatsapp_ranger", { org: conv.organisation_id, tel: conv.telephone, nom_profil: null, m: { evenement_id: cleVerrouVoucher(r.data.id, ctx.maintenant()), sens: "sortant", origine: "gestion", type: "image", texte: demande.legende || null, medias: [media], envoye_le: envoyeLe, statut_envoi: "envoi" } });
  const messageId = (range.data && range.data.message_id) || null;
  if (range.error || !messageId) {
    await effacer();
    journal("whatsapp-envoi : voucher non rangé, rien n'est parti", (range.error && range.error.message) || "sans id");
    return rep(500, { erreur: "base" });
  }
  if (range.data.nouveau === false) {
    await effacer();
    return rep(409, { erreur: "deja_traitee" });
  }
  // Refus sûr : le message sort du fil et le fichier est effacé tout de suite.
  const retirer = async () => {
    const { error } = await admin.rpc("whatsapp_retirer_envoi", { p_message: messageId });
    if (error) journal("whatsapp-envoi : voucher refusé mais message non retiré", error.message);
    await effacer();
  };

  // URL signée courte : seule voie que Telnyx documente. « v » contre le cache de 10 minutes de Meta.
  const signe = await stockage.createSignedUrl(chemin, URL_SIGNEE_S);
  if (signe.error || !signe.data || !signe.data.signedUrl) {
    await retirer();
    return rep(500, { erreur: "base" });
  }
  const lien = lienAvecVersion(signe.data.signedUrl, ctx.maintenant());

  let reponse;
  try {
    reponse = await ctx.fetch("https://api.telnyx.com/v2/messages/whatsapp", {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.cle}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpsTelnyxImage({ de: numero, vers: conv.telephone, lien, legende: demande.legende, webhook: ctx.webhook })),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Délai dépassé ou coupure : Telnyx a peut-être envoyé. Le message reste « envoi », le fichier reste pour que Telnyx puisse le lire ;
    // la purge l'efface après une heure. L'écran dit de vérifier dans WhatsApp, comme pour le texte.
    return rep(504, { erreur: "verifier_whatsapp", message_id: messageId });
  }
  const lu = lireReponseTelnyx(reponse.status, await reponse.json().catch(() => null));
  if (!lu.ok) {
    if (lu.statut >= 500 || (lu.statut >= 200 && lu.statut < 300)) return rep(504, { erreur: "verifier_whatsapp", message_id: messageId });
    await retirer();
    journal("whatsapp-envoi : voucher refusé par Telnyx", lu.statut, lu.code);
    return rep(502, { erreur: "telnyx_refuse", code: lu.code });
  }

  // Parti : le message est complété avec l'id Telnyx (les statuts s'y accrochent et effacent le fichier). Deux essais, comme le texte.
  const maintenant = new Date(ctx.maintenant()).toISOString();
  let complet = false;
  for (let i = 0; i < 2 && !complet; i++) {
    const { data: maj, error } = await admin.from("whatsapp_messages").update({ telnyx_id: lu.id, statut_envoi: "envoye", statut_le: maintenant }).eq("id", messageId).in("statut_envoi", ["envoi", "echec"]).select("id");
    if (error) {
      journal("whatsapp-envoi : voucher parti, id Telnyx non noté", error.message);
      continue;
    }
    complet = true;
    // Retiré entre-temps par « Pas parti » (appel très lent) : il est pourtant parti, on le range de nouveau.
    if (!maj || !maj.length) {
      const { error: errN } = await admin.rpc("whatsapp_ranger", { org: conv.organisation_id, tel: conv.telephone, nom_profil: null, m: { telnyx_id: lu.id, sens: "sortant", origine: "gestion", type: "image", texte: demande.legende || null, medias: [media], envoye_le: maintenant, statut_envoi: "envoye" } });
      if (errN) journal("whatsapp-envoi : voucher parti mais non rangé de nouveau", errN.message);
    }
  }
  return rep(200, { ok: true, message_id: messageId, complet });
}
