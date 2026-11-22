// Filtre « Prêt à réserver » de l'écran WhatsApp (migration 85, 22.11.2026). Calculs sans écran, partagés par l'écran, la démonstration
// et les tests. La décision vient de la fonction « whatsapp » (supabase/functions/whatsapp/pret.js, sans IA), gardée dans
// whatsapp_conversations.pret_reserver. Ici, l'écran décide seulement si la conversation est encore à montrer :
//   - entre : la décision dit « prêt » (le client a dit oui après un prix, ou Nani a annoncé ou envoyé la confirmation) ;
//   - sort : un dossier relié à la conversation, un service créé depuis le prix dans un dossier du client (22.11.2026), ou Nani qui l'enlève (« Retirer ») ; elle revient seulement sur un signal plus récent que
//     le retrait. Un dossier du même client (fiche reliée ou même numéro) créé depuis le prix donné, mais pas relié, ne la fait pas sortir :
//     la carte propose « Relier au dossier » (cas réel C36 : dossier créé, conversation restée à trier sans lien).
//   - jamais : un Contact personnel, un partenaire (posé par Nani ou déduit, migration 110), un apporteur, une fiche partenaire reliée, ou un tri
//     « personnel », « publicite » ou « contact_jamais » (plus « partenaire » depuis la migration 110). Mêmes listes que la fonction, un test les compare.
import { N_ } from "./i18n.mjs";
import { memeNumero } from "./demandes-whatsapp-calc.mjs";

export const FILTRE_PRET = { valeur: "pret", libelle: N_("Prêt à réserver") };
export const TYPES_EXCLUS = ["partenaire", "apporteur"];
// Relecture finale du 22.11.2026 (migration 110) : plus « partenaire ». Le motif d'un seul tri ne sort pas une conversation des listes de
// clients : seul un type posé par Nani ou déduit le fait (type-contact.js, traiterEnPartenaire).
export const MOTIFS_TRI_EXCLUS = ["personnel", "publicite", "contact_jamais"];

// La décision « prêt » lisible, ou null (colonne absente, décision « pas prêt », valeur abîmée).
export function decisionPret(c) {
  const p = c && c.pret_reserver;
  if (!p || typeof p !== "object" || p.pret !== true || typeof p.le !== "string" || Number.isNaN(Date.parse(p.le))) return null;
  return p;
}

// Les dossiers qui comptent : seulement ceux de Secret ou de Taxi (`marqueDe(entite_id)` rend « secret », « taxi » ou null). ZTP ne se mélange
// jamais : un dossier ZTP n'est ni proposé à la liaison, ni pris pour le dossier de cette réservation.
const dansBoite = (d, marqueDe) => !!d && !d.annule && ["secret", "taxi"].includes(marqueDe(d.entite_id));
// Les fiches du même client : la fiche reliée et celles du même numéro.
function fichesDuClient(c, clients = []) {
  const siens = new Set(clients.filter((x) => x && ((c.client_id && x.id === c.client_id) || memeNumero(x.telephone, c.telephone))).map((x) => x.id));
  if (c.client_id) siens.add(c.client_id);
  return siens;
}
const depuisDe = (p) => {
  const le = Date.parse(p.le);
  return Number.isNaN(Date.parse(p.depuis || "")) ? le : Date.parse(p.depuis);
};

// Le service de cette réservation déjà créé (relecture du 22.11.2026) : un service non annulé d'un dossier de Secret ou de Taxi du
// client (dossier relié, fiche reliée ou même numéro), créé depuis le prix donné. La carte de l'Assistant crée souvent le service dans un
// dossier plus ancien (client qui revient) : le dossier est d'avant le prix, le service non. Même règle que la fonction (pret.js, reserveDepuis).
export function serviceCree(c, { dossiers = [], clients = [], reservations = null, marqueDe = () => null } = {}) {
  const p = decisionPret(c);
  if (!p || !Array.isArray(reservations)) return null;
  const depuis = depuisDe(p);
  const siens = fichesDuClient(c, clients);
  // L'entreprise du signal (avancee.pret.entreprise, etapes.js) : un service de l'autre entreprise ne répond pas à cette demande (relecture
  // de la PR 329). Inconnue : les deux comptent.
  const ent = c.avancee && c.avancee.pret && ["secret", "taxi"].includes(c.avancee.pret.entreprise) ? c.avancee.pret.entreprise : null;
  const ids = new Set(dossiers.filter((d) => dansBoite(d, marqueDe) && (!ent || marqueDe(d.entite_id) === ent) && (d.id === c.dossier_id || siens.has(d.client_id))).map((d) => d.id));
  return reservations.filter((r) => r && r.statut !== "annule" && ids.has(r.dossier_id) && Date.parse(r.created_at || "") >= depuis).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
}

// La conversation est-elle à montrer dans « Prêt à réserver » ? Rend la décision, ou null.
// Elle sort quand le dossier de CETTE réservation est relié : le dossier relié a été créé depuis le prix donné. Un dossier relié plus ancien
// (client qui revient, arrivée puis transfert retour) ne l'exclut pas. Sans les dossiers chargés, un dossier relié compte comme celui-ci.
// `retrait` à false : sans compter le retrait de Nani (pour lui proposer « Remettre »).
// `reservations` (et `clients`) : un service créé depuis le prix la fait sortir aussi (serviceCree), elle revient sur un nouveau prix.
export function pretAReserver(c, { dossiers = null, clients = [], reservations = null, marqueDe = () => null, retrait = true } = {}) {
  const p = decisionPret(c);
  if (!p) return null;
  if (c.reponses === "jamais" || c.partenaire_id || TYPES_EXCLUS.includes(String(c.type_contact || ""))) return null;
  if (c.tri && typeof c.tri === "object" && MOTIFS_TRI_EXCLUS.includes(c.tri.motif)) return null;
  const le = Date.parse(p.le);
  const retire = c.pret_retire_le ? Date.parse(c.pret_retire_le) : NaN;
  if (retrait && !Number.isNaN(retire) && retire >= le) return null;
  if (c.dossier_id) {
    if (!dossiers) return null;
    const relie = dossiers.find((d) => d && d.id === c.dossier_id);
    if (relie && dansBoite(relie, marqueDe) && Date.parse(relie.created_at || "") >= depuisDe(p)) return null;
  }
  if (dossiers && serviceCree(c, { dossiers, clients, reservations, marqueDe })) return null;
  return p;
}

// Le dossier déjà créé pour cette réservation mais pas relié à la conversation, ou null : un dossier de Secret ou de Taxi, non annulé, du
// même client (fiche reliée ou même numéro), créé depuis le prix donné, autre que le dossier déjà relié. Nani crée souvent le dossier avant
// d'envoyer la confirmation (deux minutes avant, cas réel C36). Le plus récent.
export function dossierARelier(c, { dossiers = [], clients = [], marqueDe = () => null } = {}) {
  const p = decisionPret(c);
  if (!p) return null;
  const depuis = depuisDe(p);
  const siens = fichesDuClient(c, clients);
  const trouves = dossiers.filter((d) => dansBoite(d, marqueDe) && d.id !== c.dossier_id && siens.has(d.client_id) && Date.parse(d.created_at || "") >= depuis);
  return trouves.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
}
// La conversation d'un client appartient à Secret et à Taxi : relier un dossier ne la range jamais dans une seule entreprise. Le lien vaut
// pour un dossier de Secret comme de Taxi (whatsapp_reclasser, migration 85) ; une conversation déjà rangée dans l'autre entreprise redevient
// commune. Pour un contact qui n'est pas un client, rien (le filtre ne le montre pas).
export const clientCommun = (c) => !!c && (!c.type_contact || c.type_contact === "client") && !c.partenaire_id && c.reponses !== "jamais";
export function patchRelier(c, d) {
  if (!c || !d || !clientCommun(c)) return null;
  return { ...(c.entite_id && c.entite_id !== d.entite_id ? { entite_id: null } : {}), client_id: d.client_id, dossier_id: d.id };
}
export const conversationsPretes = (conversations = [], ctx = {}) => conversations.filter((c) => pretAReserver(c, ctx));
// Retirée par Nani, et sinon toujours prête : la conversation ouverte propose « Remettre ».
export const pretRetire = (c, ctx = {}) => !pretAReserver(c, ctx) && !!pretAReserver(c, { ...ctx, retrait: false });

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
