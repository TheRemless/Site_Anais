// L'Assistant en équipe (migration 133, demande de Jérémy du 27.11.2026) : l'administration d'une entreprise voit les conversations de
// l'Assistant de toute l'équipe et y écrit comme la propriétaire, pour reprendre son travail. Logique pure, testée par node --test
// (tests/gestion-agent-equipe.test.js) ; la base tient la même règle (agent_voit_equipe, politiques de la migration 133).
import { prenomDe } from "./noms-calc.mjs";

// Qui voit l'équipe : « reglages.ecrire » et « dossiers.ecrire » dans l'entreprise de la conversation, avec la portée « toute » (comme
// agent_voit_equipe et whatsapp_admin ; super_admin : toutes les permissions et toute l'entreprise). `toute` : voit_tout de l'entreprise.
export const voitEquipe = (permissions = [], toute = true) => !!toute && Array.isArray(permissions) && permissions.includes("reglages.ecrire") && permissions.includes("dossiers.ecrire");

// Le filtre de la liste : « miennes » (par défaut, la liste d'avant) ou « equipe ». Gardé dans le navigateur pour le retour sur l'écran.
export const CLE_FILTRE_EQUIPE = "gestion-agent-filtre";
export const FILTRES_EQUIPE = ["miennes", "equipe"];
export const filtreLu = (brut) => (FILTRES_EQUIPE.includes(brut) ? brut : "miennes");

// Une conversation est-elle à moi ? Une ligne sans propriétaire (base d'avant la migration, démonstration ancienne) est comptée comme mienne :
// la base ne rendait alors que les miennes.
export const aMoi = (c, moi) => !c || !c.user_id || c.user_id === moi;

// Les conversations montrées : toutes pour « equipe » (la base n'a rendu que ce que la personne peut lire), sinon les miennes.
export function conversationsFiltrees(conversations = [], { moi = "", filtre = "miennes", equipe = false } = {}) {
  const liste = Array.isArray(conversations) ? conversations : [];
  if (equipe && filtre === "equipe") return liste;
  return liste.filter((c) => aMoi(c, moi));
}

// Le prénom d'une personne de l'équipe (equipe_de : user_id, nom, email), ou "" si elle n'est pas connue (jamais un nom deviné).
export function prenomEquipe(equipe = [], userId = "") {
  if (!userId) return "";
  const p = (equipe || []).find((x) => x && x.user_id === userId);
  return p ? prenomDe(p) : "";
}

// La propriétaire affichée sur une ligne de la liste « Toute l'équipe » : son prénom, ou rien pour mes conversations.
// Une propriétaire hors de la liste de l'équipe : « une personne de l'équipe », écrit par l'écran (FALLBACK).
export const proprietaireAffichee = (c, { moi = "", equipe = [], inconnue = "" } = {}) => (aMoi(c, moi) ? "" : prenomEquipe(equipe, c.user_id) || inconnue);

// « écrit par Jérémy » sous un message : seulement quand l'auteur réel n'est pas la propriétaire de la conversation. Un message sans auteur
// (écrit avant la migration 133) est celui de la propriétaire. `vous` : le mot pour la personne connectée (« vous »).
export function auteurAffiche(auteurId, conv, { moi = "", equipe = [] } = {}) {
  if (!auteurId || !conv || !conv.user_id || auteurId === conv.user_id) return "";
  if (auteurId === moi) return { moi: true, prenom: "" };
  return { moi: false, prenom: prenomEquipe(equipe, auteurId) };
}

// Une réponse en cours dans la conversation (verrou de la migration 133) : par qui. La base le dit à son heure (reponse_en_cours, lu par
// agent_reponses_en_cours) ; sans elle, moins de 3 minutes à l'heure du poste. `maintenant` : pour les tests.
export const VERROU_MS = 3 * 60 * 1000;
export function reponseEnCours(conv, { maintenant = Date.now() } = {}) {
  if (conv && typeof conv.reponse_en_cours === "boolean") return conv.reponse_en_cours ? { par: conv.reponse_par || "" } : null;
  if (!conv || !conv.reponse_le) return null;
  const t = Date.parse(conv.reponse_le);
  if (!Number.isFinite(t) || maintenant - t > VERROU_MS) return null;
  return { par: conv.reponse_par || "" };
}
