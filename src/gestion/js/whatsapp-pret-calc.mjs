// Filtre « Prêt à réserver » de l'écran WhatsApp (migration 85, 22.11.2026). Calculs sans écran, partagés par l'écran, la démonstration
// et les tests. La décision vient de la fonction « whatsapp » (supabase/functions/whatsapp/pret.js, sans IA), gardée dans
// whatsapp_conversations.pret_reserver. Ici, l'écran décide seulement si la conversation est encore à montrer :
//   - entre : la décision dit « prêt » (le client a dit oui après un prix, ou Nani a annoncé ou envoyé la confirmation) ;
//   - sort : un dossier relié à la conversation, ou Nani qui l'enlève (« Retirer ») ; elle revient seulement sur un signal plus récent que
//     le retrait. Un dossier du même client (fiche reliée ou même numéro) créé depuis le prix donné, mais pas relié, ne la fait pas sortir :
//     la carte propose « Relier au dossier » (cas réel C36 : dossier créé, conversation restée à trier sans lien).
//   - jamais : un Contact personnel, un partenaire, un chauffeur, un hôtel, un apporteur, une fiche partenaire reliée, ou un tri
//     « personnel », « partenaire » ou « publicite ». Mêmes listes que la fonction, un test les compare.
import { N_ } from "./i18n.mjs";
import { memeNumero } from "./demandes-whatsapp-calc.mjs";

export const FILTRE_PRET = { valeur: "pret", libelle: N_("Prêt à réserver") };
export const TYPES_EXCLUS = ["partenaire", "chauffeur", "hotel", "apporteur"];
export const MOTIFS_TRI_EXCLUS = ["personnel", "partenaire", "publicite", "contact_jamais"];

// La décision « prêt » lisible, ou null (colonne absente, décision « pas prêt », valeur abîmée).
export function decisionPret(c) {
  const p = c && c.pret_reserver;
  if (!p || typeof p !== "object" || p.pret !== true || typeof p.le !== "string" || Number.isNaN(Date.parse(p.le))) return null;
  return p;
}

// La conversation est-elle à montrer dans « Prêt à réserver » ? Rend la décision, ou null.
// `retrait` à false : sans compter le retrait de Nani (pour lui proposer « Remettre »).
export function pretAReserver(c, { retrait = true } = {}) {
  const p = decisionPret(c);
  if (!p) return null;
  if (c.reponses === "jamais" || c.partenaire_id || TYPES_EXCLUS.includes(String(c.type_contact || ""))) return null;
  if (c.tri && typeof c.tri === "object" && MOTIFS_TRI_EXCLUS.includes(c.tri.motif)) return null;
  if (c.dossier_id) return null;
  const le = Date.parse(p.le);
  const retire = c.pret_retire_le ? Date.parse(c.pret_retire_le) : NaN;
  if (retrait && !Number.isNaN(retire) && retire >= le) return null;
  return p;
}

// Le dossier déjà créé pour cette réservation mais pas relié à la conversation, ou null. Nani crée souvent le dossier avant d'envoyer la
// confirmation (deux minutes avant, cas réel C36) : un dossier non annulé du client (fiche reliée ou même numéro) créé depuis le prix donné.
// Le plus récent. `dossiers` et `clients` : ceux des entreprises de la boîte (Secret et Taxi).
export function dossierARelier(c, { dossiers = [], clients = [] } = {}) {
  const p = decisionPret(c);
  if (!p || c.dossier_id) return null;
  const le = Date.parse(p.le);
  const depuis = Number.isNaN(Date.parse(p.depuis || "")) ? le : Date.parse(p.depuis);
  const siens = new Set(clients.filter((x) => x && ((c.client_id && x.id === c.client_id) || memeNumero(x.telephone, c.telephone))).map((x) => x.id));
  if (c.client_id) siens.add(c.client_id);
  const trouves = dossiers.filter((d) => d && !d.annule && siens.has(d.client_id) && Date.parse(d.created_at || "") >= depuis);
  return trouves.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
}
// Le patch qui relie : une conversation à trier est rangée dans l'entreprise du dossier en même temps (whatsapp_reclasser, migration 59,
// garde la fiche et le dossier seulement s'ils sont de cette entreprise). Une conversation rangée ailleurs n'est pas déplacée : null.
export function patchRelier(c, d) {
  if (!c || !d || (c.entite_id && c.entite_id !== d.entite_id)) return null;
  return { ...(c.entite_id ? {} : { entite_id: d.entite_id }), client_id: d.client_id, dossier_id: d.id };
}
export const conversationsPretes = (conversations = []) => conversations.filter((c) => pretAReserver(c));
// Retirée par Nani, et sinon toujours prête : la conversation ouverte propose « Remettre ».
export const pretRetire = (c) => !pretAReserver(c) && !!pretAReserver(c, { retrait: false });

// La carte pré-remplie, dans l'ordre d'une fiche de réservation. Seulement des textes courts écrits dans la conversation.
export const CHAMPS_CARTE = [
  ["nom", N_("Nom")],
  ["date", N_("Date")],
  ["heure", N_("Heure")],
  ["depart", N_("Départ")],
  ["arrivee", N_("Arrivée")],
  ["personnes", N_("Personnes")],
  ["vol", N_("Vol")],
  ["prix", N_("Prix donné")],
];
const propre = (v) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) : "");
export function lignesCarte(carte) {
  if (!carte || typeof carte !== "object") return [];
  return CHAMPS_CARTE.map(([cle, libelle]) => ({ cle, libelle, valeur: propre(carte[cle]) })).filter((x) => x.valeur);
}
// Une ligne sous le nom dans la liste : la date, le prix donné, puis le trajet (coupé en premier sur un téléphone).
export function resumeCarte(carte) {
  if (!carte || typeof carte !== "object") return "";
  const trajet = [propre(carte.depart), propre(carte.arrivee)].filter(Boolean).join(" → ");
  return [propre(carte.date), propre(carte.prix), trajet].filter(Boolean).join(" · ");
}
// Pourquoi elle est là (une phrase, pour que Nani juge vite).
export const MOTIFS_PRET = {
  accord: N_("Le client a dit oui après le prix."),
  details: N_("Le client a donné son nom et l'heure après le prix."),
  confirmation: N_("Vous avez annoncé ou envoyé la confirmation."),
  recapitulatif: N_("Vous avez envoyé un récapitulatif."),
};
export const motifPret = (p) => MOTIFS_PRET[p && p.motif] || MOTIFS_PRET.confirmation;
// Le patch du retrait (l'heure exacte est posée par la base) et celui de l'annulation.
export const patchRetirer = () => ({ pret_retire_le: new Date().toISOString() });
export const patchRemettre = () => ({ pret_retire_le: null });
