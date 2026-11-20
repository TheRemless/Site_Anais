// Fonction « whatsapp » : la logique pure de la fiabilité (lot 3 des audits du 20.11.2026, migration 64).
//   * statuts d'envoi de Telnyx (message.sent, message.finalized, message.read) d'un message envoyé depuis Gestion ;
//   * délais d'un envoi au résultat inconnu ;
//   * événement à reprendre plus tard (modification ou statut arrivé avant son message).
// Aucune dépendance : sert à la fonction, à whatsapp-envoi et aux tests (tests/gestion-whatsapp-fiabilite.test.js).
// Doc Telnyx lue le 20.11.2026 : developers.telnyx.com/docs/messaging/whatsapp/quickstart (exemple message.sent) et
// developers.telnyx.com/docs/messaging/messages/receiving-webhooks (états : queued, sending, sent, delivered, sending_failed, delivery_failed,
// delivery_unconfirmed ; read en RCS et WhatsApp). La doc WhatsApp cite aussi « failed » et « undeliverable » : tout état inconnu est un échec.

// Un envoi depuis Gestion sans réponse sûre de Telnyx : à vérifier dans WhatsApp après 30 secondes, en échec visible après 5 minutes.
export const ENVOI_A_VERIFIER_MS = 30_000;
export const ENVOI_EXPIRE_MS = 5 * 60_000;
// Une modification dont le message n'est pas (encore) rangé est reprise pendant 30 minutes, puis classée. Un statut d'envoi, 10 minutes
// seulement : il n'attend que l'id Telnyx noté par whatsapp-envoi (quelques secondes), et un statut d'un message inconnu ne doit pas traîner.
export const REPRISE_FENETRE_MS = 30 * 60_000;
export const STATUT_FENETRE_MS = 10 * 60_000;
// Préfixe de l'erreur d'un événement qui attend sa cible : ce n'est pas une panne, le compteur de Réglages ne le compte pas.
export const ATTENTE = "attente: ";
export const ESSAIS_MAX = 5;

const TYPES_STATUT = new Set(["message.sent", "message.finalized", "message.read"]);
const EN_FILE = new Set(["queued", "sending", "delivery_unconfirmed"]);
const ETATS = { sent: "envoye", delivered: "remis", read: "lu" };
// Ordre d'un statut : un statut plus ancien arrivé en retard n'en écrase jamais un plus avancé (Telnyx n'ordonne pas ses webhooks).
const RANG = { envoi: 0, envoye: 1, echec: 2, remis: 3, lu: 4 };

const texteCourt = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// Statut d'envoi d'un événement Telnyx, ou null si ce n'en est pas un. Rend
//   { action: "statut", telnyx_id, meta_id, statut: envoye | remis | lu | echec, erreur, quand }
//   { action: "ignorer", raison } pour un statut sans intérêt (en file, en cours) ou mal formé.
export function interpreterStatut(ev) {
  if (!ev || !TYPES_STATUT.has(ev.type)) return null;
  const p = ev.payload || {};
  if (p.type && String(p.type).toUpperCase() !== "WHATSAPP") return { action: "ignorer", raison: "canal" };
  if (p.direction && p.direction !== "outbound") return { action: "ignorer", raison: "direction" };
  const telnyxId = typeof p.id === "string" && p.id ? p.id.slice(0, 100) : null;
  const metaId = typeof p.body?.foreign_id === "string" && p.body.foreign_id ? p.body.foreign_id.slice(0, 200) : null;
  if (!telnyxId && !metaId) return { action: "ignorer", raison: "statut_sans_id" };
  const dest = Array.isArray(p.to) ? p.to[0] : p.to;
  const brut = String((dest && typeof dest === "object" ? dest.status : null) || "").toLowerCase();
  let statut;
  if (ev.type === "message.read" || brut === "read") statut = "lu";
  else if (ETATS[brut]) statut = ETATS[brut];
  else if (!brut || EN_FILE.has(brut)) return { action: "ignorer", raison: "statut_attente" };
  else statut = "echec";
  const erreurs = Array.isArray(p.errors) ? p.errors : [];
  const e = erreurs[0] && typeof erreurs[0] === "object" ? erreurs[0] : null;
  const erreur = statut === "echec" ? texteCourt(e ? [e.code, e.title, e.detail].filter(Boolean).join(" ") : brut, 200) || brut : null;
  return { action: "statut", telnyx_id: telnyxId, meta_id: metaId, statut, erreur, quand: ev.survenu_le || null };
}

// Statuts qu'un nouveau statut peut remplacer (mise à jour conditionnelle en base). null = message de l'app ou ancien message, sans statut.
export function statutsRemplacables(statut) {
  const rang = RANG[statut];
  if (rang === undefined) return [];
  return Object.keys(RANG).filter((s) => RANG[s] < rang);
}

// Un événement dont la cible manque encore (statut arrivé avant que l'id Telnyx soit noté, modification d'un message pas encore rangé) :
// on le reprend tant qu'il est récent, sinon on le classe avec une raison (il ne compte plus comme une erreur).
export function aReprendre(recuLe, maintenant = Date.now(), fenetre = REPRISE_FENETRE_MS) {
  const t = Date.parse(recuLe || "");
  return !Number.isFinite(t) || maintenant - t < fenetre;
}

// Seuil des envois « envoi » à passer en échec (date ISO).
export const limiteEnvoi = (maintenant = Date.now()) => new Date(maintenant - ENVOI_EXPIRE_MS).toISOString();
