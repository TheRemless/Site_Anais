// Voucher envoyé en image dans la conversation WhatsApp du client, depuis Gestion (21.11.2026, demande de Jérémy). Logique pure de l'écran :
// quelle conversation, numéro masqué, légende, messages d'erreur. Le serveur refait tout (supabase/functions/whatsapp-envoi/voucher.js).
// Tests : tests/gestion-whatsapp-voucher.test.js.
import { N_ } from "./i18n.mjs";
import { ERREURS_ENVOI, envoiIncertain } from "./whatsapp-calc.mjs";

export const LEGENDE_MAX_OCTETS = 1024;
export const octets = (t) => new TextEncoder().encode(String(t || "")).length;
export const legendeValide = (t) => octets(String(t || "").trim()) <= LEGENDE_MAX_OCTETS;

// Seule la conversation du client du dossier : reliée au dossier ou au client du dossier, de type « client » ou pas encore typée, jamais un
// contact personnel. Même règle que contactVoucher de whatsapp-envoi/calc.js (un test compare les deux).
export function contactVoucher(conv, dossier) {
  if (!conv || !dossier || !dossier.id) return { ok: false, erreur: "conversation_autre_dossier" };
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
  const possibles = (conversations || []).filter((c) => c && ecrit(c) && contactVoucher(c, dossier).ok);
  possibles.sort((a, b) => (b.dossier_id === dossier.id) - (a.dossier_id === dossier.id) || Date.parse(b.dernier_message_le || 0) - Date.parse(a.dernier_message_le || 0));
  return possibles[0] || null;
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
  reservation_annulee: N_("Le service est annulé : le voucher ne part pas."),
  legende_trop_longue: N_("Le message sous l'image est trop long pour WhatsApp. Raccourcissez-le."),
  image_invalide: N_("L'image n'a pas pu être lue. Rien n'est parti."),
  image_trop_grosse: N_("L'image fait plus de 5 Mo. Envoyez depuis votre téléphone."),
  deja_traitee: N_("Ce voucher vient de partir dans cette conversation. Rien n'est reparti."),
};
// Rien n'est parti à coup sûr pour ces codes ; sinon (délai dépassé, connexion coupée pendant l'envoi, réponse illisible), l'écran dit de
// vérifier dans WhatsApp, comme pour un texte.
const RIEN_PARTI_VOUCHER = new Set(["coexistence_inactive", "contact_non_client", "contact_personnel", "conversation_autre_dossier", "reservation_annulee", "legende_trop_longue", "image_invalide", "image_trop_grosse", "demande_invalide", "conversation_invalide", "reservation_invalide"]);
export const voucherIncertain = (code) => !RIEN_PARTI_VOUCHER.has(code) && envoiIncertain(code);
export const erreurVoucher = (code) => (voucherIncertain(code) ? ERREURS_ENVOI.verifier_whatsapp : ERREURS_VOUCHER[code] || ERREURS_ENVOI.base);
