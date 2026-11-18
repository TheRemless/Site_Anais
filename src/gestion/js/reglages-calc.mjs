// Réglages d'une entreprise (lot D, 17.11.2026) : la logique pure de l'historique, des listes archivées et des moyens de paiement.
// Sans DOM, testée dans tests/gestion-lot-d-autonomie.test.js.
import { N_ } from "./i18n.mjs";

// Groupes de réglages nommés pour l'historique : « 3 changements : Paiement, Textes des documents ».
const GROUPES = {
  emetteur: N_("Identité et contact"),
  paiement: N_("Informations de paiement"),
  devise: N_("Devise"),
  conditions: N_("Conditions"),
  taux: N_("Équivalents indicatifs"),
  numerotation: N_("Numérotation"),
  dossier: N_("Dossiers"),
  listes: N_("Listes"),
  apparence: N_("Apparence"),
  libelles: N_("Textes des documents"),
  libelles_en: N_("Textes des documents en anglais"),
  textes: N_("Conditions de paiement proposées"),
  messages: N_("Messages types"),
  modules: N_("Écrans"),
  fonctionnement: N_("Façon de travailler"),
  assistant_ia: N_("Assistant IA"),
  assistant_voix: N_("Voix de l'assistant IA"),
  responsable: N_("Personne responsable"),
  voucher: N_("Vouchers"),
  taxi: N_("Booking confirmation"),
  fiduciaire: N_("Fiduciaire"),
  textes_thai: N_("Textes thaïs de l'écran de Mook"),
};
export const nomGroupe = (cle) => GROUPES[cle] || cle;

// Clés de premier niveau qui diffèrent entre deux versions des réglages (comparaison du contenu, ordre des clés ignoré).
const stable = (v) => (v && typeof v === "object" ? (Array.isArray(v) ? `[${v.map(stable).join(",")}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`) : JSON.stringify(v ?? null));
export function groupesModifies(a, b) {
  const cles = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])];
  return cles.filter((k) => stable((a || {})[k]) !== stable((b || {})[k])).sort((x, y) => Object.keys(GROUPES).indexOf(x) - Object.keys(GROUPES).indexOf(y));
}

// ---- Listes où l'on archive au lieu de supprimer (audit n° 37 et 75) -------------------------------------------------------------------
// Variantes de conditions de paiement : une variante archivée part en fin de liste, pour que la première (celle d'un nouveau document)
// soit toujours une variante active. La dernière variante active ne s'archive pas.
export const variantesActives = (variantes) => (variantes || []).filter((v) => !v.archive);
export function archiverVariante(variantes, id) {
  const liste = [...(variantes || [])];
  const i = liste.findIndex((v) => v.id === id);
  if (i < 0 || liste[i].archive || variantesActives(liste).length <= 1) return null;
  const [v] = liste.splice(i, 1);
  return [...liste, { ...v, archive: true }];
}
export function reactiverVariante(variantes, id) {
  return (variantes || []).map((v) => (v.id === id ? { ...v, archive: false } : v));
}
// Variantes proposées dans un document : les actives, plus celle que le document utilise déjà même archivée.
export const variantesProposees = (variantes, actuelle) => (variantes || []).filter((v) => !v.archive || v.id === actuelle);

// Moyens de paiement (listes.moyens) : chaque moyen garde son identifiant quand on le renomme (les paiements enregistrés le citent).
// Un nouveau moyen reçoit un identifiant tiré de son nom, jamais celui d'un moyen existant.
export function identifiantMoyen(label, existants, slug) {
  const base = slug(label) || "moyen";
  const pris = new Set((existants || []).map((m) => m.id));
  if (!pris.has(base)) return base;
  let n = 2;
  while (pris.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
export const moyensActifs = (moyens, garder = null) => (moyens || []).filter((m) => !m.archive || m.id === garder);
// Nom affiché d'un moyen enregistré : celui de la liste, même archivé ; un code inconnu reste tel quel.
export const nomMoyen = (moyens, id) => ((moyens || []).find((m) => m.id === id) || { label: id || "" }).label;
