// Temps réel fiable (Jérémy, 20.11.2026 : « réactif en temps réel comme si c'était WhatsApp Web »). Logique pure, testée par
// tests/gestion-whatsapp-boite.test.js : quand se réabonner après une coupure du canal Realtime, quand relire seulement la boîte WhatsApp,
// à quel rythme relire tant que le direct est coupé.

// Statuts de supabase-js qui veulent dire « le canal ne reçoit plus rien » : on le retire, on rafraîchit le jeton, on se réabonne.
const COUPURES = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);
export const estCoupure = (statut) => COUPURES.has(statut);

// Délai avant chaque nouvel essai de réabonnement : 1, 2, 5, 10 puis 30 s. Remis à zéro dès que le canal repasse SUBSCRIBED.
export const DELAIS_REABONNEMENT = [1000, 2000, 5000, 10000, 30000];
export const delaiReabonnement = (essai) => DELAIS_REABONNEMENT[Math.min(Math.max(0, Number(essai) || 0), DELAIS_REABONNEMENT.length - 1)];

// Un canal qui n'est pas « joined » (fermé, en erreur, jamais rejoint) se refait au retour sur l'onglet, au retour du réseau, à pageshow.
export const doitReabonner = (etatCanal) => etatCanal !== "joined";

// Un événement WhatsApp attend un court instant (plusieurs lignes changent ensemble : message, conversation, proposition), puis seule la
// boîte WhatsApp est relue. Les autres tables gardent leur relecture complète (demandes du site : 800 ms, voir app.mjs).
export const ATTENTE_WHATSAPP_MS = 200;
const TABLES_WHATSAPP = new Set(["whatsapp_conversations", "whatsapp_messages", "whatsapp_propositions", "whatsapp_reglages"]);
export const relectureCiblee = (tables = []) => tables.length > 0 && tables.every((t) => TABLES_WHATSAPP.has(t));

// Repli tant que le canal WhatsApp n'est pas SUBSCRIBED : relecture ciblée toutes les 5 s sur l'écran WhatsApp, toutes les 20 s ailleurs
// (pour le badge). null : pas de relecture (direct en marche, ou personne qui ne lit pas la boîte).
export const REPLI_ECRAN_MS = 5000;
export const REPLI_AILLEURS_MS = 20000;
export function intervalleRepli({ abonne = false, ecranWhatsApp = false, actif = true } = {}) {
  if (!actif || abonne) return null;
  return ecranWhatsApp ? REPLI_ECRAN_MS : REPLI_AILLEURS_MS;
}

// Ce qui compte pour l'écran WhatsApp dans une relecture ciblée : sans changement, rien n'est redessiné (une relecture de repli ne fait pas
// clignoter l'écran toutes les 5 s).
export function signatureWhatsApp(brut) {
  if (!brut) return "";
  const lignes = (t) => (brut[t] || []).map((r) => JSON.stringify(r)).sort();
  return JSON.stringify([lignes("whatsapp_conversations"), lignes("whatsapp_propositions"), lignes("whatsapp_reglages")]);
}

// La pastille « Direct coupé » : seulement après une vraie coupure, pas pendant la première connexion.
export const directCoupe = (etatWhatsApp) => etatWhatsApp === "coupe";
