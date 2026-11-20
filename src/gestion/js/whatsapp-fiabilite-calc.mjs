// Boîte WhatsApp, fiabilité (lot 3 des audits du 20.11.2026, migration 64) : la logique pure de l'écran.
//   * statut d'envoi d'un message sortant (envoi, envoyé, remis, lu, échec), affiché discrètement sous la bulle ;
//   * envoi depuis Gestion au résultat inconnu : « Vérifiez dans WhatsApp » après 30 secondes, échec visible après 5 minutes ;
//   * état de la réception pour Réglages > WhatsApp (événements en erreur, abandonnés, en retard).
// Mêmes seuils que la fonction (supabase/functions/whatsapp/fiabilite.js), gardés égaux par tests/gestion-whatsapp-fiabilite.test.js.
import { N_ } from "./i18n.mjs";

export const ENVOI_A_VERIFIER_MS = 30_000;
export const ENVOI_EXPIRE_MS = 5 * 60_000;

// Un message envoyé depuis Gestion dont le résultat n'est pas sûr : « attente » (moins de 30 s, l'appel est peut-être encore en cours),
// « verifier » (30 s à 5 min), « expire » (plus de 5 min, ou passé en échec « sans_confirmation » par la reprise). null sinon.
export function envoiAVerifier(m, maintenant = Date.now()) {
  if (!m || m.origine !== "gestion") return null;
  if (m.statut_envoi === "echec" && m.erreur_envoi === "sans_confirmation") return "expire";
  if (m.statut_envoi !== "envoi") return null;
  const depuis = maintenant - Date.parse(m.envoye_le || "");
  if (!Number.isFinite(depuis)) return "verifier";
  if (depuis < ENVOI_A_VERIFIER_MS) return "attente";
  return depuis < ENVOI_EXPIRE_MS ? "verifier" : "expire";
}

// Dans combien de millisecondes l'état d'un envoi change (pour redessiner au bon moment). null si plus rien ne change.
export function prochainChangement(messages, maintenant = Date.now()) {
  let min = null;
  for (const m of messages || []) {
    const etat = envoiAVerifier(m, maintenant);
    if (etat !== "attente" && etat !== "verifier") continue;
    const seuil = Date.parse(m.envoye_le) + (etat === "attente" ? ENVOI_A_VERIFIER_MS : ENVOI_EXPIRE_MS) - maintenant;
    if (Number.isFinite(seuil)) min = min === null ? seuil : Math.min(min, seuil);
  }
  return min === null ? null : Math.max(500, min + 250);
}

// Le message de la conversation à vérifier (le plus récent), ou null.
export function envoiEnDoute(messages, maintenant = Date.now()) {
  const liste = (messages || []).filter((m) => {
    const e = envoiAVerifier(m, maintenant);
    return e === "verifier" || e === "expire";
  });
  return liste.length ? liste[liste.length - 1] : null;
}

// Libellé discret du statut d'un message sortant, sous la bulle. Rien pour un message du client ou sans statut connu.
export function statutEnvoi(m, maintenant = Date.now()) {
  if (!m || m.sens !== "sortant") return null;
  const doute = envoiAVerifier(m, maintenant);
  if (doute === "attente") return { cle: "envoi", libelle: N_("envoi…") };
  if (doute === "verifier") return { cle: "doute", libelle: N_("envoi non confirmé") };
  if (doute === "expire") return { cle: "echec", libelle: N_("pas de confirmation") };
  switch (m.statut_envoi) {
    case "envoye":
      return { cle: "envoye", libelle: N_("envoyé") };
    case "remis":
      return { cle: "remis", libelle: N_("remis") };
    case "lu":
      return { cle: "lu", libelle: N_("lu") };
    case "echec":
      return { cle: "echec", libelle: N_("non remis"), detail: libelleErreurEnvoi(m.erreur_envoi) };
    default:
      return null;
  }
}

// Les erreurs de Meta les plus courantes, en clair. Les autres restent telles que Telnyx les donne (code et titre).
const ERREURS_META = [
  [/131047|re-?engagement|24 ?h/i, N_("Plus de 24 h depuis le dernier message du client : WhatsApp refuse un texte libre.")],
  [/131026|undeliverable|not.*whatsapp/i, N_("Ce numéro ne reçoit pas les messages WhatsApp.")],
  [/131049|ecosystem|marketing/i, N_("WhatsApp a retenu le message pour ce client.")],
  [/130429|40011|rate|throughput/i, N_("Trop de messages d'un coup : WhatsApp a refusé celui-ci.")],
];
export function libelleErreurEnvoi(erreur) {
  if (!erreur) return null;
  for (const [motif, libelle] of ERREURS_META) if (motif.test(erreur)) return libelle;
  return null;
}

// Réglages > WhatsApp : la ligne « Réception » à partir de whatsapp_etat_reception(). niveau : ok | attention | alerte.
export function resumeReception(e) {
  if (!e) return null;
  const n = (k) => Math.max(0, Number(e[k]) || 0);
  const abandonnes = n("abandonnes");
  const enErreur = n("en_erreur");
  const enRetard = n("en_retard");
  const envois = n("envois_a_verifier");
  if (abandonnes) return { niveau: "alerte", texte: N_("{n} message(s) jamais rangé(s) après 5 essais."), vars: { n: abandonnes }, relancer: true, envois };
  if (enErreur) return { niveau: "attention", texte: N_("{n} message(s) en erreur, repris toutes les 5 minutes."), vars: { n: enErreur }, relancer: false, envois };
  if (enRetard) return { niveau: "attention", texte: N_("{n} message(s) en attente depuis plus de 10 minutes."), vars: { n: enRetard }, relancer: false, envois };
  return { niveau: "ok", texte: N_("Tous les messages reçus sont rangés."), vars: {}, relancer: false, envois };
}
