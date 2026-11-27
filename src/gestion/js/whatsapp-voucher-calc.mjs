// Voucher envoyé en image dans la conversation WhatsApp du client, depuis Gestion (21.11.2026, demande de Jérémy). Logique pure de l'écran :
// quelle conversation, numéro masqué, légende, messages d'erreur. Le serveur refait tout (supabase/functions/whatsapp-envoi/voucher.js).
// Tests : tests/gestion-whatsapp-voucher.test.js.
import { N_ } from "./i18n.mjs";
import { ERREURS_ENVOI, envoiIncertain } from "./whatsapp-calc.mjs";

export const LEGENDE_MAX_OCTETS = 1024;

// L'envoi direct du voucher depuis Gestion ne passe que si le client a écrit le dernier, il y a moins de 24 h (fenêtre WhatsApp).
// Sinon le bouton s'ouvrirait sur un « Envoyer » grisé : on ne le met pas en avant (relecture de la PR 362).
const FENETRE_24H = 24 * 60 * 60 * 1000;
export function envoiDirectOuvert(conv, maintenant = Date.now()) {
  if (!conv || conv.dernier_sens !== "entrant") return false;
  const t = Date.parse(conv.dernier_message_le || "");
  return Number.isFinite(t) && t + FENETRE_24H > maintenant;
}
export const octets = (t) => new TextEncoder().encode(String(t || "")).length;
export const legendeValide = (t) => octets(String(t || "").trim()) <= LEGENDE_MAX_OCTETS;

// Seule la conversation du client du dossier : rangée dans l'entreprise du voucher ou à trier, reliée au dossier ou au client du dossier,
// de type « client » ou pas encore typée, jamais un contact personnel. Même règle que contactVoucher de whatsapp-envoi/calc.js (un test
// compare les deux).
export function contactVoucher(conv, dossier, entiteVoucher = null) {
  if (!conv || !dossier || !dossier.id) return { ok: false, erreur: "conversation_autre_dossier" };
  if (conv.entite_id && conv.entite_id !== (entiteVoucher || dossier.entite_id)) return { ok: false, erreur: "conversation_autre_entreprise" };
  const memeClient = !!conv.client_id && !!dossier.client_id && conv.client_id === dossier.client_id;
  const memeDossier = !!conv.dossier_id && conv.dossier_id === dossier.id && (!conv.client_id || memeClient);
  if (!memeClient && !memeDossier) return { ok: false, erreur: "conversation_autre_dossier" };
  const type = conv.type_contact ?? null;
  if (type === null && conv.reponses === "jamais") return { ok: false, erreur: "contact_personnel" };
  if (type !== null && type !== "client") return { ok: false, erreur: "contact_non_client" };
  return { ok: true };
}

// La conversation où envoyer le voucher, ou null (le bouton ne s'affiche pas, l'envoi habituel reste).
//   conversations : celles que la personne lit (etat.brut.whatsapp_conversations) ;
//   admins : les entreprises du numéro qu'elle administre (Secret, Taxi) ; entiteVoucher : l'entreprise de la réservation.
// L'entreprise du voucher doit en faire partie (ni ZTP ni Mook) et la personne doit pouvoir écrire dans la conversation (une conversation
// rangée dans l'autre entreprise, lue seulement, ne sert pas). Reliée au dossier d'abord, puis la plus récente.
export function conversationDuVoucher({ conversations = [], dossier = null, admins = [], entiteVoucher = null } = {}) {
  if (!dossier || !entiteVoucher || !admins.includes(entiteVoucher)) return null;
  const ecrit = (c) => (c.entite_id ? admins.includes(c.entite_id) : admins.length > 0);
  const possibles = (conversations || []).filter((c) => c && ecrit(c) && contactVoucher(c, dossier, entiteVoucher).ok);
  possibles.sort((a, b) => (b.dossier_id === dossier.id) - (a.dossier_id === dossier.id) || Date.parse(b.dernier_message_le || 0) - Date.parse(a.dernier_message_le || 0));
  return possibles[0] || null;
}

// Le téléphone de la fiche client en E.164 (« +… » ou « 00… »), sinon null. Même règle que whatsapp-envoi/calc.js.
export function e164(tel) {
  const t = String(tel || "").trim();
  const chiffres = t.replace(/\D/g, "");
  if (/^\+/.test(t)) return chiffres ? `+${chiffres}` : null;
  if (/^00/.test(t)) return chiffres.length > 2 ? `+${chiffres.slice(2)}` : null;
  return null;
}
// La conversation est-elle sur un autre numéro que la fiche client ? Alors la confirmation montre le numéro complet et la personne le confirme.
export function numeroDifferent(telConversation, telFiche) {
  if (!String(telFiche || "").trim()) return false;
  const e = e164(telFiche);
  return !e || e !== telConversation;
}

// Numéro masqué en partie dans la confirmation : l'indicatif et les trois derniers chiffres, de quoi reconnaître le client sans tout afficher.
export function numeroMasque(tel) {
  const d = String(tel || "").replace(/\D/g, "");
  if (d.length < 7) return d ? "•••" : "";
  return `+${d.slice(0, 2)} ${"•".repeat(Math.max(3, d.length - 5))} ${d.slice(-3)}`;
}

// Messages de l'écran : ceux de l'envoi d'un texte, plus ceux propres au voucher.
export const ERREURS_VOUCHER = {
  ...ERREURS_ENVOI,
  fenetre_fermee: N_("Le client n'a pas écrit depuis plus de 24 h : WhatsApp refuse alors une image envoyée par Gestion. Envoyez depuis votre téléphone."),
  coexistence_inactive: N_("Le numéro n'est pas prêt pour l'envoi depuis Gestion. Envoyez depuis votre téléphone."),
  contact_non_client: N_("Cette conversation n'est pas celle d'un client. Rien n'est parti."),
  contact_personnel: N_("Contact personnel : rien ne part depuis Gestion. Envoyez depuis votre téléphone."),
  conversation_autre_dossier: N_("Cette conversation n'est pas reliée au client de ce dossier. Rien n'est parti."),
  conversation_autre_entreprise: N_("Cette conversation est rangée dans l'autre entreprise. Rien n'est parti."),
  numero_a_confirmer: N_("Le numéro de la conversation n'est pas celui de la fiche client : confirmez-le avant d'envoyer."),
  image_trop_grande: N_("L'image dépasse 4096 pixels de côté. Envoyez depuis votre téléphone."),
  reservation_annulee: N_("Le service est annulé : le voucher ne part pas."),
  legende_trop_longue: N_("Le message sous l'image est trop long pour WhatsApp. Raccourcissez-le."),
  image_invalide: N_("L'image n'a pas pu être lue. Rien n'est parti."),
  image_trop_grosse: N_("L'image fait plus de 5 Mo. Envoyez depuis votre téléphone."),
  deja_traitee: N_("Ce voucher vient de partir dans cette conversation. Rien n'est reparti."),
  // Un envoi précédent au résultat inconnu : seuls « C'est parti » ou « Pas parti » dans l'écran WhatsApp lèvent le verrou.
  a_verifier: N_("Un envoi précédent de ce voucher est à vérifier dans WhatsApp. Touchez « C'est parti » ou « Pas parti » dans la conversation de Gestion. Rien n'est reparti."),
};
// Rien n'est parti à coup sûr pour ces codes ; sinon (délai dépassé, connexion coupée pendant l'envoi, réponse illisible), l'écran dit de
// vérifier dans WhatsApp, comme pour un texte.
const RIEN_PARTI_VOUCHER = new Set(["coexistence_inactive", "contact_non_client", "contact_personnel", "conversation_autre_dossier", "conversation_autre_entreprise", "numero_a_confirmer", "reservation_annulee", "legende_trop_longue", "image_invalide", "image_trop_grosse", "image_trop_grande", "demande_invalide", "conversation_invalide", "reservation_invalide"]);
export const voucherIncertain = (code) => !RIEN_PARTI_VOUCHER.has(code) && envoiIncertain(code);
// `aVerifier` : le refus « deja_traitee » vient d'un envoi précédent au résultat inconnu, pas d'un envoi réussi.
export const erreurVoucher = (code, { aVerifier = false } = {}) =>
  code === "deja_traitee" && aVerifier ? ERREURS_VOUCHER.a_verifier : voucherIncertain(code) ? ERREURS_ENVOI.verifier_whatsapp : ERREURS_VOUCHER[code] || ERREURS_ENVOI.base;
