// Suivi de l'assistant IA (écran #/assistant, réservé aux administratrices) : coût du jour et du mois, appels par usage, par personne et par
// entreprise, échecs, limite du jour, tendance sur 30 jours et qualité des réponses rédigées. Logique pure, testée (tests/gestion-assistant-suivi.test.js).
//
// Source : le journal `assistant_journal` (migration 27), une ligne par appel allé jusqu'à Claude, jamais le message ni la réponse. La qualité vient
// de `assistant_retouches` (migration 51) : pour chaque réponse rédigée copiée, la part de mots changés avant la copie, un nombre de 0 à 100.
// Les jours sont ceux de Bangkok, comme la limite d'appels de la fonction « assistant ».
import { N_ } from "./i18n.mjs";
import { ajouterJours } from "./calc.mjs";

// Même valeur que LIMITE_JOUR_DEFAUT (supabase/functions/assistant/calc.js). Si le secret ASSISTANT_LIMITE_JOUR la change, changer ici aussi.
export const LIMITE_JOUR = 40;

// Libellés des usages, dans l'ordre de l'écran. Un usage inconnu (ajouté plus tard) s'affiche sous son code, sans rien casser.
export const USAGES_SUIVIS = [
  ["lire", N_("Lire un message")],
  ["itineraire", N_("Itinéraire : lire les étapes")],
  ["situer", N_("Itinéraire : situer les hôtels")],
  ["repondre_itineraire", N_("Itinéraire : rédiger la réponse")],
  ["trier", N_("Trier")],
  ["brochure", N_("Brochure")],
  ["agent", N_("Onglet Assistant (conversation)")],
  ["rediger", N_("Rédiger (retiré le 19.11.2026)")],
];

// Usages qui rédigent un texte destiné au client : ce sont eux que mesure la qualité.
export const USAGES_REDIGES = ["repondre_itineraire", "rediger"];

// Statuts notés par la fonction. « ok » : réponse rendue. « refus » : Claude a refusé. Tout le reste est une erreur (coupure, réponse
// illisible ou rejetée par les contrôles, clé refusée, Anthropic occupé ou en panne).
export const STATUTS = {
  ok: N_("Réussi"),
  refus: N_("Refusé par Claude"),
  invalide: N_("Réponse rejetée par les contrôles"),
  coupe: N_("Réponse coupée (trop longue)"),
  sans_reponse: N_("Pas de réponse utilisable"),
  pause: N_("Recherche web interrompue"),
  trop_long: N_("Échange trop long, arrêté"),
  occupe: N_("Anthropic occupé"),
  cle_refusee: N_("Clé API refusée"),
  credit_epuise: N_("Crédit Anthropic épuisé"),
  erreur_api: N_("Erreur d'Anthropic"),
  erreur: N_("Erreur"),
};
export const categorie = (statut) => (statut === "ok" ? "ok" : statut === "refus" ? "refus" : "erreur");

const DECALAGE_BANGKOK = 7 * 3600 * 1000;
// Jour de Bangkok (AAAA-MM-JJ) d'un horodatage ISO.
export const jourBangkok = (iso) => new Date(Date.parse(iso) + DECALAGE_BANGKOK).toISOString().slice(0, 10);
const joursDuMois = (jour) => new Date(Date.UTC(Number(jour.slice(0, 4)), Number(jour.slice(5, 7)), 0)).getUTCDate();

// Premier instant (ISO, UTC) à lire dans le journal : le plus ancien entre le 1er du mois et le début des 30 jours, à minuit à Bangkok.
export function debutLecture(jour) {
  const debut = [`${jour.slice(0, 7)}-01`, ajouterJours(jour, -29)].sort()[0];
  return new Date(Date.parse(`${debut}T00:00:00Z`) - DECALAGE_BANGKOK).toISOString();
}

const n = (x) => Number(x) || 0;
const arrondi = (x, d = 6) => Math.round(x * 10 ** d) / 10 ** d;

function compteur() {
  return { appels: 0, ok: 0, refus: 0, erreurs: 0, cout: 0 };
}
function ajouter(c, l) {
  c.appels += 1;
  c[categorie(l.statut) === "ok" ? "ok" : categorie(l.statut) === "refus" ? "refus" : "erreurs"] += 1;
  c.cout += n(l.cout_estime_usd);
}
const fini = (c) => ({ ...c, cout: arrondi(c.cout) });

// Part des mots changés entre le brouillon de l'assistant et le texte copié, de 0 à 100 : distance d'édition sur les mots, divisée par le
// nombre de mots du plus long des deux. Une seule retouche ne donne jamais 0 (arrondi à 1 au moins). Le texte lui-même ne sort pas d'ici.
export function partModifiee(brouillon, envoye) {
  const mots = (t) => String(t || "").split(/\s+/).filter(Boolean).slice(0, 3000);
  const a = mots(brouillon);
  const b = mots(envoye);
  if (!a.length && !b.length) return 0;
  let prec = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cour = [i];
    for (let j = 1; j <= b.length; j++) cour[j] = Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prec = cour;
  }
  const d = prec[b.length];
  if (!d) return 0;
  return Math.min(100, Math.max(1, Math.round((d / Math.max(a.length, b.length)) * 100)));
}

// Le tableau de bord. `lignes` : lignes du journal (cree_le, user_id, entite_id, usage, statut, cout_estime_usd), lues depuis debutLecture(jour).
// `retouches` : lignes de assistant_retouches (cree_le, user_id, entite_id, usage, part_modifiee), ou null tant que la migration 51 manque.
// `noms` : user_id → nom ; `entites` : [{ id, nom }] (l'ordre de l'écran) ; `entiteId` : une seule entreprise, ou null pour toutes.
export function suiviAssistant({ lignes = [], retouches = null, jour, limite = LIMITE_JOUR, noms = {}, entites = [], entiteId = null }) {
  const mois = jour.slice(0, 7);
  const debut30 = ajouterJours(jour, -29);
  const garder = (l) => !entiteId || l.entite_id === entiteId;
  // Toutes les lignes lues comptent pour la limite : la fonction compte les appels d'une personne toutes entreprises confondues.
  const appelsJourPersonne = new Map();
  for (const l of lignes) if (jourBangkok(l.cree_le) === jour) appelsJourPersonne.set(l.user_id, (appelsJourPersonne.get(l.user_id) || 0) + 1);
  const parJourPersonne = new Map();
  for (const l of lignes) {
    const k = `${jourBangkok(l.cree_le)}|${l.user_id}`;
    parJourPersonne.set(k, (parJourPersonne.get(k) || 0) + 1);
  }

  const L = lignes.filter(garder).map((l) => ({ ...l, jour: jourBangkok(l.cree_le) }));
  const duMois = L.filter((l) => l.jour.slice(0, 7) === mois);
  const total = { jour: compteur(), mois: compteur() };
  const usages = new Map();
  const personnes = new Map();
  const ents = new Map();
  const statuts = new Map();
  for (const l of L) if (l.jour === jour) ajouter(total.jour, l);
  for (const l of duMois) {
    ajouter(total.mois, l);
    if (!usages.has(l.usage)) usages.set(l.usage, compteur());
    ajouter(usages.get(l.usage), l);
    if (!personnes.has(l.user_id)) personnes.set(l.user_id, compteur());
    ajouter(personnes.get(l.user_id), l);
    if (!ents.has(l.entite_id)) ents.set(l.entite_id, compteur());
    ajouter(ents.get(l.entite_id), l);
    if (l.statut !== "ok") statuts.set(l.statut, (statuts.get(l.statut) || 0) + 1);
  }

  // Tendance : un point par jour sur 30 jours, jours sans appel compris (à 0).
  const tendance = [];
  const jours30 = Array.from({ length: 30 }, (_, i) => ajouterJours(debut30, i));
  const parJour = new Map(jours30.map((j) => [j, compteur()]));
  for (const l of L) if (parJour.has(l.jour)) ajouter(parJour.get(l.jour), l);
  for (const j of jours30) tendance.push({ jour: j, ...fini(parJour.get(j)) });

  // Projection du mois : le coût moyen par jour écoulé, étendu au mois entier. Rien avant le 3e jour (trop tôt pour dire quoi que ce soit).
  const ecoules = Number(jour.slice(8, 10));
  const projection = ecoules >= 3 ? arrondi((total.mois.cout / ecoules) * joursDuMois(jour), 4) : null;

  const ordreUsage = USAGES_SUIVIS.map(([k]) => k);
  const libelleUsage = (k) => (USAGES_SUIVIS.find(([c]) => c === k) || [k, k])[1];
  const nomEntite = (id) => (entites.find((e) => e.id === id) || {}).nom || "";
  const nomPersonne = (id) => noms[id] || "";

  const idsPersonnes = new Set([...personnes.keys(), ...L.filter((l) => l.jour === jour).map((l) => l.user_id)]);
  const lignesPersonnes = [...idsPersonnes].map((id) => {
    const aujourd = appelsJourPersonne.get(id) || 0;
    // Jours des 30 derniers où la personne a atteint la limite (toutes entreprises confondues).
    let joursLimite = 0;
    for (const j of jours30) if ((parJourPersonne.get(`${j}|${id}`) || 0) >= limite) joursLimite += 1;
    return { user_id: id, nom: nomPersonne(id), aujourdhui: aujourd, limiteAtteinte: aujourd >= limite, joursLimite, ...fini(personnes.get(id) || compteur()) };
  });
  lignesPersonnes.sort((a, b) => b.aujourdhui - a.aujourdhui || b.appels - a.appels || a.nom.localeCompare(b.nom));

  const echecs = L.filter((l) => l.statut !== "ok")
    .sort((a, b) => (a.cree_le < b.cree_le ? 1 : -1))
    .slice(0, 10)
    .map((l) => ({ cree_le: l.cree_le, usage: l.usage, libelleUsage: libelleUsage(l.usage), statut: l.statut, libelleStatut: STATUTS[l.statut] || l.statut, categorie: categorie(l.statut), personne: nomPersonne(l.user_id), entreprise: nomEntite(l.entite_id) }));

  return {
    jour,
    mois,
    limite,
    aujourdhui: fini(total.jour),
    duMois: fini(total.mois),
    projection,
    usages: [...usages.entries()]
      .map(([k, c]) => ({ usage: k, libelle: libelleUsage(k), ...fini(c), coutMoyen: c.appels ? arrondi(c.cout / c.appels) : 0 }))
      .sort((a, b) => (ordreUsage.indexOf(a.usage) + 1 || 99) - (ordreUsage.indexOf(b.usage) + 1 || 99)),
    personnes: lignesPersonnes,
    limiteAtteinte: lignesPersonnes.filter((p) => p.limiteAtteinte).length,
    entreprises: [...ents.entries()].map(([id, c]) => ({ entite_id: id, nom: nomEntite(id), ...fini(c) })).sort((a, b) => b.cout - a.cout || b.appels - a.appels),
    statuts: [...statuts.entries()].map(([k, nb]) => ({ statut: k, libelle: STATUTS[k] || k, categorie: categorie(k), nombre: nb })).sort((a, b) => b.nombre - a.nombre),
    echecs,
    tendance,
    qualite: qualite({ duMois, retouches, mois, garder }),
  };
}

// Qualité du mois : parmi les réponses rédigées puis copiées, la part copiée sans aucune retouche, et la part moyenne de mots changés.
// `redigees` : réponses rédigées avec succès (journal) ; `mesurees` : celles dont la copie a été mesurée. Une réponse jamais copiée n'est pas mesurée.
function qualite({ duMois, retouches, mois, garder }) {
  const redigees = duMois.filter((l) => l.statut === "ok" && USAGES_REDIGES.includes(l.usage)).length;
  if (!Array.isArray(retouches)) return { disponible: false, redigees, mesurees: 0, sansRetouche: 0, part: null, moyenne: null, usages: [] };
  const R = retouches.filter((r) => garder(r) && jourBangkok(r.cree_le).slice(0, 7) === mois);
  const sans = R.filter((r) => n(r.part_modifiee) === 0).length;
  const parUsage = new Map();
  for (const r of R) {
    if (!parUsage.has(r.usage)) parUsage.set(r.usage, []);
    parUsage.get(r.usage).push(n(r.part_modifiee));
  }
  const moyenne = (v) => (v.length ? Math.round(v.reduce((t, x) => t + x, 0) / v.length) : null);
  return {
    disponible: true,
    redigees,
    mesurees: R.length,
    sansRetouche: sans,
    part: R.length ? Math.round((sans / R.length) * 100) : null,
    moyenne: moyenne(R.map((r) => n(r.part_modifiee))),
    usages: [...parUsage.entries()].map(([usage, v]) => ({ usage, mesurees: v.length, sansRetouche: v.filter((x) => x === 0).length, moyenne: moyenne(v) })),
  };
}

// Entreprises que la personne peut suivre : celles où elle administre (réglages) et lit le journal. L'administratrice générale les a toutes.
export function entreprisesSuivies({ entites, permissionsDe }) {
  return entites.filter((e) => {
    const p = permissionsDe(e.id) || [];
    return p.includes("reglages.ecrire") && p.includes("journal.voir");
  });
}

// Crédit du mois (migration 54) : la dépense de tout l'assistant (toutes entreprises) face au plafond réglé par Jérémy. `budget` : la réponse
// de assistant_budget_etat() ({ cout_mois, plafond, seuil }), ou null pour qui n'administre pas (et avant la migration).
export function etatCredit(budget) {
  if (!budget) return null;
  const cout = Math.max(0, Number(budget.cout_mois) || 0);
  const plafond = Number(budget.plafond) > 0 ? Number(budget.plafond) : 50;
  const seuil = Number(budget.seuil) >= 50 && Number(budget.seuil) <= 99 ? Number(budget.seuil) : 80;
  const pct = Math.floor((cout / plafond) * 100);
  return { cout: arrondi(cout, 4), plafond, seuil, pct, reste: arrondi(Math.max(0, plafond - cout), 4), alerte: pct >= seuil, atteint: cout >= plafond, peutRegler: budget.peut_regler === true };
}

// Libellés des apprentissages de l'agent (agent-apprendre.mjs), dans l'ordre de l'écran.
export const GENRES_APPRIS = {
  pickup: N_("Heure de pickup"),
  libelle: N_("Libellé"),
  prix: N_("Prix de vente"),
  lieu: N_("Lieu de pickup"),
  date: N_("Date"),
  reponse: N_("Réponse au client"),
};
