// Logique pure du module Partenaires : familles, unités, marges, recherche de trajets.
// Aucune dépendance au navigateur pour pouvoir la tester avec node --test.

export const FAMILLES = [
  ["excursion", "Excursions"],
  ["activite", "Activités"],
  ["location", "Locations"],
  ["transfert", "Transferts"],
  ["frais", "Frais de parc"],
  ["autre", "Autres"],
];
export const nomFamille = (code) => (FAMILLES.find(([c]) => c === code) || ["", code])[1];

// Unité d'un prix : code court en base, libellé en français et en anglais pour les documents.
export const UNITES = {
  pp: ["par personne", "per person"],
  ad: ["par adulte", "per adult"],
  ch: ["par enfant", "per child"],
  boat: ["par bateau", "per boat"],
  veh: ["par véhicule", "per vehicle"],
  day: ["par jour", "per day"],
  ses: ["par session", "per session"],
  grp: ["par groupe", "per group"],
  "": ["", ""],
};
export const libelleUnite = (code, en = false) => (UNITES[code] || UNITES[""])[en ? 1 : 0];

// Devine l'unité d'après un texte de brochure (« Par personne », « Par bateau », « 4 à 6 personnes »).
export function uniteDepuisTexte(texte) {
  const t = sansAccents(texte);
  if (/bateau|boat|privatif/.test(t)) return "boat";
  if (/vehicule|voiture|van|car\b/.test(t)) return "veh";
  if (/jour|day/.test(t)) return "day";
  if (/enfant|child/.test(t)) return "ch";
  if (/adulte|adult/.test(t)) return "ad";
  if (/\d\s*(a|-|–)\s*\d+\s*(personnes|pax)|\d+\s*personnes/.test(t)) return "grp";
  if (/personne|person|pax|public/.test(t)) return "pp";
  return "";
}

export const sansAccents = (s) => (s === null || s === undefined ? "" : String(s)).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Tous les mots saisis doivent apparaître dans le texte (recherche sans accents ni casse).
export function correspond(texte, q) {
  const mots = sansAccents(q).split(/\s+/).filter(Boolean);
  if (!mots.length) return true;
  const h = sansAccents(texte);
  return mots.every((m) => h.includes(m));
}

// Marge entre prix de vente et net : montant et pourcentage du prix de vente. Null quand il manque un des deux.
export function marge(vente, net) {
  if (vente === null || vente === undefined || net === null || net === undefined || vente === "" || net === "") return null;
  const v = Number(vente);
  const n = Number(net);
  if (Number.isNaN(v) || Number.isNaN(n)) return null;
  const montant = Math.round((v - n) * 100) / 100;
  return { montant, pct: v ? Math.round(((v - n) / v) * 100) : 0 };
}

// Un trajet sans fenêtre circule toute la période du contrat ; sinon la date doit tomber dans une fenêtre.
export function trajetDisponible(t, dateIso) {
  if (!dateIso) return true;
  const f = Array.isArray(t.fenetres) ? t.fenetres : [];
  if (!f.length) return true;
  return f.some(([debut, fin]) => dateIso >= debut && dateIso <= fin);
}

export const lieux = (trajets) => [...new Set(trajets.flatMap((t) => [t.de, t.vers]))].filter(Boolean).sort((a, b) => a.localeCompare(b, "fr"));

export function filtrerTrajets(trajets, { de = "", vers = "", partenaireId = "", date = "", q = "", nomPartenaire = () => "" } = {}) {
  return trajets
    .filter((t) => t.actif !== false)
    .filter((t) => (!de || t.de === de) && (!vers || t.vers === vers) && (!partenaireId || t.partenaire_id === partenaireId) && trajetDisponible(t, date))
    .filter((t) => correspond([t.de, t.vers, t.mode, t.depart, t.arrivee, t.periode, nomPartenaire(t.partenaire_id)].join(" "), q))
    .sort((a, b) => `${a.de}${a.vers}`.localeCompare(`${b.de}${b.vers}`, "fr") || (a.depart || "").localeCompare(b.depart || ""));
}

// Pour un départ et une arrivée donnés : les trajets au net adulte le plus bas, seulement quand les compagnies
// n'ont pas le même minimum (sinon le repère n'apporte rien). `netDe(t)` renvoie le net adulte ou null.
export function meilleursNets(trajets, netDe) {
  const parCie = new Map();
  for (const t of trajets) {
    const n = netDe(t);
    if (n === null || n === undefined) continue;
    parCie.set(t.partenaire_id, Math.min(parCie.get(t.partenaire_id) ?? Infinity, Number(n)));
  }
  const minima = [...parCie.values()];
  if (minima.length < 2 || new Set(minima).size < 2) return new Set();
  const min = Math.min(...minima);
  return new Set(trajets.filter((t) => Number(netDe(t)) === min).map((t) => t.id));
}

// Résumé par compagnie d'une liste de trajets déjà filtrés : nombre de départs, heures, prix adulte le plus bas.
export function resumeParCompagnie(trajets, netDe) {
  const out = new Map();
  for (const t of trajets) {
    const r = out.get(t.partenaire_id) || { partenaire_id: t.partenaire_id, departs: 0, heures: new Set(), vente: Infinity, net: Infinity };
    r.departs++;
    if (t.depart) r.heures.add(t.depart.slice(0, 5));
    if (t.prix_adulte !== null && t.prix_adulte !== undefined) r.vente = Math.min(r.vente, Number(t.prix_adulte));
    const n = netDe(t);
    if (n !== null && n !== undefined) r.net = Math.min(r.net, Number(n));
    out.set(t.partenaire_id, r);
  }
  return [...out.values()].map((r) => ({ ...r, heures: [...r.heures].sort(), vente: Number.isFinite(r.vente) ? r.vente : null, net: Number.isFinite(r.net) ? r.net : null }));
}

// Contrats qui arrivent à échéance dans `jours` jours (ou déjà passés), pour l'écran Aujourd'hui.
export function contratsAEcheance(partenaires, ajd, jours = 30) {
  const limite = ajouter(ajd, jours);
  return partenaires
    .filter((p) => p.actif !== false && p.contrat && p.contrat.fin && p.contrat.fin <= limite)
    .map((p) => ({ partenaire: p, fin: p.contrat.fin, passe: p.contrat.fin < ajd }))
    .sort((a, b) => a.fin.localeCompare(b.fin));
}

function ajouter(iso, n) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
