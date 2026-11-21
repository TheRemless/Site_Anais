// Contacts WhatsApp typés et apporteurs d'affaires (migration 68, décisions de Jérémy du 21.11.2026). Logique pure, sans navigateur,
// testée dans tests/gestion-apporteurs.test.js. Le cas de départ : une travel planner envoie des clients à Nani, sans aucun accord.
//   * Type d'une conversation : client, apporteur, partenaire, chauffeur, hôtel, personnel. « Personnel » n'est pas stocké dans type_contact :
//     c'est reponses = 'jamais' sans type (migration 60). Typer ne rouvre jamais l'IA : en base, type et réponses sont indépendants ; l'écran
//     les couple au tap (patchType). Nani change toujours le réglage des réponses à part.
//   * Apporteur : une fiche partenaire de catégorie « apporteur », dans Secret ou Taxi. Aucune rémunération : personne n'est payé en commission
//     aujourd'hui (Jérémy, 21.11.2026).
//   * Jamais de nom d'apporteur sur un document client : ce module ne sert qu'aux écrans internes.
import { arrondi } from "./calc.mjs";
import { N_ } from "./i18n.mjs";

export const CATEGORIE_APPORTEUR = "apporteur";

// L'ordre des puces dans l'écran WhatsApp.
export const TYPES_CONTACT = [
  ["client", N_("Client")],
  ["apporteur", N_("Apporteur")],
  ["partenaire", N_("Partenaire")],
  ["chauffeur", N_("Chauffeur")],
  ["hotel", N_("Hôtel")],
  ["personnel", N_("Personnel")],
];
const TYPES_STOCKES = new Set(["client", "apporteur", "partenaire", "chauffeur", "hotel"]);

export const estTypeStocke = (t) => TYPES_STOCKES.has(t);
// Le type affiché d'une conversation : type_contact s'il est posé, sinon « personnel » pour reponses = 'jamais'. null = pas encore typé.
export function typeContact(conv) {
  if (!conv) return null;
  if (TYPES_STOCKES.has(conv.type_contact)) return conv.type_contact;
  return conv.reponses === "jamais" ? "personnel" : null;
}

// Les contacts qui parlent de nets et de commissions : l'IA ne lit pas leurs messages.
const SANS_IA = new Set(["partenaire", "chauffeur", "hotel", "personnel"]);
// Ce que l'écran écrit au tap d'un type : client et apporteur ouvrent l'assistant (« auto ») ; partenaire, chauffeur et hôtel le ferment
// (« jamais ») ; personnel ferme et vide le type.
export function patchType(type) {
  if (type === "personnel") return { reponses: "jamais", type_contact: null };
  if (!TYPES_STOCKES.has(type)) throw new Error(`type de contact inconnu : ${type}`);
  return { type_contact: type, reponses: SANS_IA.has(type) ? "jamais" : "auto" };
}
// Le message du toast après un tap : ce que l'IA lit désormais.
export const toastType = (type) => (patchType(type).reponses === "jamais" ? N_("Contact noté : rien envoyé à l'IA") : N_("Contact noté : l'assistant peut lire"));

export const estApporteur = (p) => !!p && p.categorie === CATEGORIE_APPORTEUR;
// Les prestataires seulement : une fiche apporteur n'est jamais proposée pour un service, un tarif, une course ni comme chauffeur.
export const prestataires = (partenaires) => (partenaires || []).filter((p) => !estApporteur(p));
// Les fiches apporteur proposées pour une entreprise : actives, ou celle déjà choisie (même masquée, elle reste lisible sur le dossier).
export const apporteursDe = (partenaires, entiteId, garder = null) =>
  (partenaires || []).filter((p) => estApporteur(p) && p.entite_id === entiteId && (p.actif !== false || p.id === garder)).sort((a, b) => String(a.nom).localeCompare(String(b.nom)));

// Statistiques, « Clients envoyés par apporteur » : les lignes « vendu » (stats-calc) groupées par apporteur. `apporteurDe(dossierId)`.
// Rend [{ id, dossiers, clients, montant }] (le plus de dossiers d'abord) et ce qui est venu sans apporteur, pour situer.
export function parApporteur(rows, apporteurDe) {
  const m = new Map();
  let sans = 0;
  let sansMontant = 0;
  for (const l of rows || []) {
    const id = apporteurDe(l.dossier_id || l.id);
    if (!id) {
      sans++;
      sansMontant = arrondi(sansMontant + (Number(l.montant) || 0));
      continue;
    }
    const g = m.get(id) || { id, dossiers: 0, clients: new Set(), montant: 0 };
    g.dossiers++;
    g.clients.add(l.src && l.src.client_id ? l.src.client_id : l.client || l.id);
    g.montant = arrondi(g.montant + (Number(l.montant) || 0));
    m.set(id, g);
  }
  const groupes = [...m.values()].map((g) => ({ ...g, clients: g.clients.size })).sort((a, b) => b.dossiers - a.dossiers || b.montant - a.montant);
  return { groupes, sans: { dossiers: sans, montant: sansMontant } };
}

// ---- Cartes « dossier » de l'Assistant pour un apporteur (PR D du 21.11.2026) --------------------------------------------------------
// La carte porte `apporteur` : { nom, fiches: { [entite_id]: partenaire_id } } (agent/apporteur.js, apporteurDeCarte). À la validation,
// chaque dossier créé reçoit la fiche de SA propre entreprise, ou rien. `partenaires` : les fiches que la personne voit (etat.brut) ; une
// fiche absente, d'une autre entreprise ou qui n'est pas un apporteur n'est jamais posée (le déclencheur controler_apporteur_dossier la
// refuserait de toute façon).
export function apporteurDuDossier(apporteur, entiteId, partenaires = []) {
  const id = apporteur && apporteur.fiches && typeof apporteur.fiches === "object" && entiteId ? apporteur.fiches[entiteId] : null;
  if (!id || typeof id !== "string") return null;
  const p = (partenaires || []).find((x) => x && x.id === id);
  return p && p.entite_id === entiteId && estApporteur(p) ? id : null;
}
// Les entreprises de la carte où l'apporteur n'a pas de fiche : la carte le dit (« Apporteur : pas de fiche chez Taxi »), sans rien bloquer.
export const entreprisesSansFiche = (apporteur, entiteIds = []) => (apporteur && apporteur.fiches ? [...new Set((entiteIds || []).filter(Boolean))].filter((id) => !apporteur.fiches[id]) : []);
// Les dossiers créés par une carte et la fiche à poser sur chacun : [{ dossier, apporteur_id }], seulement ceux qui en ont une.
export const poseApporteur = (apporteur, dossiers = [], partenaires = []) =>
  (dossiers || []).filter((d) => d && d.id).map((d) => ({ dossier: d, apporteur_id: apporteurDuDossier(apporteur, d.entite_id, partenaires) })).filter((x) => x.apporteur_id && x.dossier.apporteur_id !== x.apporteur_id);
