// Contacts WhatsApp typés et apporteurs d'affaires (migration 68, décisions de Jérémy du 21.11.2026). Logique pure, sans navigateur,
// testée dans tests/gestion-apporteurs.test.js. Le cas de départ : une travel planner envoie des clients à Nani, sans aucun accord.
//   * Type d'une conversation : client, apporteur, partenaire, personnel. « Personnel » n'est pas stocké dans type_contact : c'est
//     reponses = 'jamais' sans type (migration 60). Plus de « chauffeur » ni d'« hôtel » (migration 110, Jérémy, 22.11.2026 : nos chauffeurs
//     sont des partenaires, on ne parle pas avec les hôtels), la migration convertit les anciennes valeurs. Le type ne coupe plus l'IA (demande
//     de Jérémy du 21.11.2026, migration 69) : partenaire et apporteur se lisent comme un client. Seul « Personnel » ferme (patchType). Nani change toujours le
//     réglage des réponses à part, dans le menu « … ».
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
  ["personnel", N_("Personnel")],
];
const TYPES_STOCKES = new Set(["client", "apporteur", "partenaire"]);

export const estTypeStocke = (t) => TYPES_STOCKES.has(t);
// Le type affiché d'une conversation : type_contact s'il est posé, sinon « personnel » pour reponses = 'jamais'. null = pas encore typé.
export function typeContact(conv) {
  if (!conv) return null;
  if (TYPES_STOCKES.has(conv.type_contact)) return conv.type_contact;
  return conv.reponses === "jamais" ? "personnel" : null;
}

// Ce que l'écran écrit au tap d'un type (migration 69). Personnel ferme l'IA et vide le type. Un autre type ne touche pas aux réponses : il
// écrit seulement type_contact. Seule exception, quitter la puce « Personnel » (reponses = 'jamais' sans type) : c'est cette puce qui avait
// fermé l'IA, la quitter la rouvre (« auto »). Un contact typé que Nani a réglé « rien envoyé à l'IA » dans le menu « … » le reste.
export function patchType(type, conv = null) {
  if (type === "personnel") return { reponses: "jamais", type_contact: null };
  if (!TYPES_STOCKES.has(type)) throw new Error(`type de contact inconnu : ${type}`);
  return typeContact(conv) === "personnel" ? { type_contact: type, reponses: "auto" } : { type_contact: type };
}
// Le message du toast après un tap : ce que l'IA lit désormais (les réponses après le tap, sinon celles du contact).
export function toastType(type, conv = null) {
  const p = patchType(type, conv);
  const reponses = "reponses" in p ? p.reponses : conv && conv.reponses === "jamais" ? "jamais" : "auto";
  return reponses === "jamais" ? N_("Contact noté : rien envoyé à l'IA") : N_("Contact noté : l'assistant peut lire");
}

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

// ---- Revue de la PR 298 ------------------------------------------------------------------------------------------------------------
// Avant de poser l'apporteur : le contact de la conversation WhatsApp liée, relu en base, est toujours de type « apporteur ». Retypé
// (client, partenaire, personnel) ou illisible : rien n'est posé.
export const apporteurConfirme = (wc) => !!wc && typeof wc === "object" && wc.type_contact === CATEGORIE_APPORTEUR;
// La conversation de l'Assistant se relie au dossier d'une carte (dossier_id), sauf pour un apporteur : la carte porte `apporteur`, ou le
// contact WhatsApp lié est un apporteur. Il envoie plusieurs clients ; la conversation n'est celle d'aucun de leurs dossiers.
export const lierDossierConversation = (carte, typeContactLie = null) => !(carte && carte.donnees && carte.donnees.apporteur) && typeContactLie !== CATEGORIE_APPORTEUR;
// Les noms d'apporteur à masquer dans les apprentissages (correctionsDepuisCarte), qui partent chez Anthropic : la fiche reliée à la
// conversation WhatsApp, toutes les fiches de catégorie « apporteur » que la personne voit, et le nom porté par les cartes du fil.
export function nomsApporteurAMasquer({ partenaires = [], conversationWa = null, cartes = [] } = {}) {
  const reliee = conversationWa && conversationWa.partenaire_id ? (partenaires || []).find((p) => p && p.id === conversationWa.partenaire_id) : null;
  const noms = [reliee && reliee.nom, ...(partenaires || []).filter(estApporteur).map((p) => p.nom), ...(cartes || []).flatMap((c) => [c && c.donnees && c.donnees.apporteur && c.donnees.apporteur.nom, c && c.donnees && c.donnees.apporteur_nom])];
  return [...new Set(noms.map((x) => String(x || "").trim()).filter(Boolean))];
}
