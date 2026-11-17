// Bandeau du site (migration 30) : la logique pure de l'écran « Bandeau du site ».
// Anaïs n'écrit jamais d'anglais : elle choisit un modèle et le remplit (sortie, date). Le texte anglais, l'étiquette des cartes, le libellé
// du lien et la fin automatique sont calculés ici et gardés avec le bandeau ; la fonction publique « bandeau-site » les transmet au site.
// Les modèles ne disent que ce qu'Anaïs choisit d'annoncer : aucune promesse ni information qui ne vienne d'elle.
import { PRODUITS_SITE } from "./site-produits.mjs";
import { N_ } from "./i18n.mjs";

export const TEXTE_MAX = 140;

export const TYPES_BANDEAU = {
  info: { libelle: N_("Information"), aide: N_("Neutre, fond sable") },
  sea: { libelle: N_("Mer et météo"), aide: N_("Ambre, avec une vague : sorties déplacées ou annulées") },
  season: { libelle: N_("Saison"), aide: N_("Ouverture ou fermeture de saison") },
  new: { libelle: N_("Nouveauté"), aide: N_("Nouvelle sortie ou nouvelle option") },
  urgent: { libelle: N_("Perturbation importante"), aide: N_("Fond sombre, très visible") },
};

export const SECTIONS_SITE = { islands: N_("Sorties en bateau"), activities: N_("Activités"), transfers: N_("Transferts et bateaux"), rental: N_("Location"), taxi: N_("VIP Taxi Lanta") };

// Champs d'un modèle : trip (une sortie du site), option (une option de cette sortie), date, date2, de, a (heures), texte (anglais libre).
// `fin` : la fin automatique proposée ; `etiquette` : le mot court posé sur la carte des sorties visées (mer, saison).
export const MODELES = [
  { id: "sea-today", type: "sea", texte: "Rough sea today: island trips are moved to tomorrow.", champs: [], fin: "aujourdhui", etiquette: "Rough sea" },
  { id: "sea-trip-date", type: "sea", texte: "Rough sea: {trip} does not run on {date}.", champs: ["trip", "date"], fin: "date", etiquette: "Rough sea" },
  { id: "sea-trip-moved", type: "sea", texte: "Rough sea: {trip} on {date} is moved to {date2}.", champs: ["trip", "date", "date2"], fin: "date2", etiquette: "Rough sea" },
  { id: "season-until", type: "season", texte: "{trip} does not run until {date}.", champs: ["trip", "date"], fin: "veille", etiquette: "From {jour}" },
  { id: "season-back", type: "season", texte: "{trip} runs again from {date}.", champs: ["trip", "date"], fin: "date", etiquette: "From {jour}" },
  { id: "season-last", type: "season", texte: "{trip}: last trip of the season on {date}.", champs: ["trip", "date"], fin: "date", etiquette: "Until {jour}" },
  { id: "new-trip", type: "new", texte: "New: {trip}.", champs: ["trip"], fin: null },
  { id: "new-option", type: "new", texte: "New on {trip}: {option}.", champs: ["trip", "option"], fin: null },
  { id: "info-full", type: "info", texte: "{trip} is fully booked on {date}.", champs: ["trip", "date"], fin: "date" },
  { id: "info-hours", type: "info", texte: "We answer on WhatsApp from {de} to {a}.", champs: ["de", "a"], fin: null },
  { id: "urgent-boats-today", type: "urgent", texte: "Bad weather: all boat trips are cancelled today.", champs: [], fin: "aujourdhui" },
  { id: "urgent-boats-date", type: "urgent", texte: "Bad weather: all boat trips on {date} are cancelled.", champs: ["date"], fin: "date" },
  { id: "urgent-transfers", type: "urgent", texte: "Transfers may run late today.", champs: [], fin: "aujourdhui" },
  { id: "libre", type: null, texte: "{texte}", champs: ["texte"], fin: null },
];
export const modele = (id) => MODELES.find((m) => m.id === id) || null;
export const modelesDuType = (type) => MODELES.filter((m) => m.type === type || m.type === null);

const JOURS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MOIS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const utc = (iso) => new Date(`${iso}T00:00:00Z`);
// « Tuesday 18 November » pour une date proche (moins d'une semaine), « 18 November » sinon : un bandeau se lit en une seconde.
export function dateBandeau(iso, aujourdhui) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
  const d = utc(iso);
  const ecart = aujourdhui ? (d - utc(aujourdhui)) / 86400000 : 99;
  const an = aujourdhui && iso.slice(0, 4) !== aujourdhui.slice(0, 4) ? ` ${d.getUTCFullYear()}` : "";
  if (ecart === 0) return "today";
  if (ecart === 1) return "tomorrow";
  return `${ecart > 1 && ecart < 7 ? `${JOURS[d.getUTCDay()]} ` : ""}${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}${an}`;
}
const jourCourt = (iso) => (iso ? `${utc(iso).getUTCDate()} ${MOIS[utc(iso).getUTCMonth()].slice(0, 3)}` : "");

export const produitSite = (id) => PRODUITS_SITE.find((p) => p.id === id) || null;
export const produitsDeMarques = (marques) => PRODUITS_SITE.filter((p) => marques.includes(p.marque));

// Texte anglais d'un bandeau à partir du modèle et de ce qu'Anaïs a choisi. Renvoie { texte, manque: [champs vides] }.
export function texteBandeau(idModele, valeurs = {}, aujourdhui = "") {
  const m = modele(idModele);
  if (!m) return { texte: "", manque: ["modele"] };
  const manque = m.champs.filter((c) => !String(valeurs[c] || "").trim());
  const p = valeurs.trip ? produitSite(valeurs.trip) : null;
  const option = p && valeurs.option ? (p.options.find((o) => o.id === valeurs.option) || {}).titre : "";
  const remplace = {
    trip: p ? p.nom : valeurs.trip || "",
    option: option || "",
    date: dateBandeau(valeurs.date, aujourdhui),
    date2: dateBandeau(valeurs.date2, aujourdhui),
    de: valeurs.de || "",
    a: valeurs.a || "",
    texte: String(valeurs.texte || "").replace(/\s+/g, " ").trim(),
  };
  let texte = m.texte.replace(/\{(\w+)\}/g, (_, k) => remplace[k] || `{${k}}`);
  // « on today » se dit « today » ; « today » et « tomorrow » au début d'une phrase prennent une majuscule, une sortie au nom en minuscule aussi.
  texte = texte.replace(/\bon (today|tomorrow)\b/g, "$1");
  texte = texte.charAt(0).toUpperCase() + texte.slice(1);
  return { texte, manque };
}

// Erreurs à montrer avant d'enregistrer (codes ; l'écran les traduit).
export function verifierBandeau(b, aujourdhui) {
  const erreurs = [];
  const { texte, manque } = texteBandeau(b.modele, b.valeurs, aujourdhui);
  if (manque.length) erreurs.push({ code: "champ_vide", champs: manque });
  if (texte.length > TEXTE_MAX) erreurs.push({ code: "trop_long", longueur: texte.length });
  if (!b.marques || !b.marques.length) erreurs.push({ code: "marque" });
  if (b.cible === "produits" && !(b.produits || []).length) erreurs.push({ code: "produits" });
  if (b.cible === "sections" && !(b.sections || []).length) erreurs.push({ code: "sections" });
  if (b.lien === "page" && !/^\/[a-z0-9/-]{0,120}$/.test(b.lien_page || "")) erreurs.push({ code: "lien" });
  if (b.fin && b.debut && Date.parse(b.fin) <= Date.parse(b.debut)) erreurs.push({ code: "dates" });
  if (b.valeurs && b.valeurs.date2 && b.valeurs.date && b.valeurs.date2 <= b.valeurs.date) erreurs.push({ code: "date2" });
  return erreurs;
}

// Bangkok est à UTC+7, sans heure d'été : la fin d'une journée là-bas est 16:59:59 UTC.
export const finDeJourneeBangkok = (iso) => `${iso}T23:59:59+07:00`;
export const debutDeJourneeBangkok = (iso) => `${iso}T00:00:00+07:00`;

// Fin automatique proposée par le modèle : le bandeau disparaît seul du site quand il n'a plus de sens.
export function finProposee(idModele, valeurs = {}, aujourdhui) {
  const m = modele(idModele);
  if (!m || !m.fin) return null;
  if (m.fin === "aujourdhui") return finDeJourneeBangkok(aujourdhui);
  if (m.fin === "veille") return valeurs.date ? debutDeJourneeBangkok(valeurs.date) : null;
  const iso = valeurs[m.fin];
  return /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? finDeJourneeBangkok(iso) : null;
}

// Étiquette courte de la carte d'une sortie visée (« Rough sea », « From 1 Dec ») : seulement pour la mer et la saison.
export function etiquetteCarte(idModele, valeurs = {}) {
  const m = modele(idModele);
  if (!m || !m.etiquette) return "";
  return m.etiquette.replace("{jour}", jourCourt(valeurs.date));
}

// Libellé anglais du lien vers une page : le nom de la sortie, ou celui de la section.
const PAGES_SECTIONS = [
  { href: "/", libelle: "See all trips", nom: N_("Accueil de Secret") },
  { href: "/tours/", libelle: "See all trips", nom: N_("Toutes les sorties") },
  { href: "/transfers/", libelle: "See transfers", nom: N_("Transferts") },
  { href: "/taxi/", libelle: "See VIP Taxi Lanta", nom: N_("Accueil de VIP Taxi Lanta") },
];
export function pagesLien(marques) {
  const sections = PAGES_SECTIONS.filter((p) => (p.href === "/taxi/" ? marques.includes("taxi") : marques.includes("secret")));
  return [...sections.map((p) => ({ href: p.href, nom: p.nom, section: true })), ...produitsDeMarques(marques).map((p) => ({ href: p.url, nom: p.nom, section: false }))];
}
export function libelleLien(href) {
  const p = PRODUITS_SITE.find((x) => x.url === href);
  if (p) return `See ${p.nom}`.slice(0, 40);
  const s = PAGES_SECTIONS.find((x) => x.href === href);
  return s ? s.libelle : "See the page";
}

// Ligne prête à enregistrer, avec tout ce qui est calculé (texte, lien, étiquette).
export function ligneBandeau(b, aujourdhui) {
  const m = modele(b.modele);
  const { texte } = texteBandeau(b.modele, b.valeurs, aujourdhui);
  const valeurs = { ...b.valeurs };
  if (b.lien === "page") valeurs.lien_libelle = libelleLien(b.lien_page);
  else delete valeurs.lien_libelle;
  const etiquette = etiquetteCarte(b.modele, b.valeurs);
  if (etiquette) valeurs.etiquette = etiquette;
  else delete valeurs.etiquette;
  return {
    marques: [...b.marques].sort(),
    type: (m && m.type) || b.type,
    modele: b.modele,
    valeurs,
    texte,
    lien: b.lien || "aucun",
    lien_page: b.lien === "page" ? b.lien_page : null,
    cible: b.cible || "tout",
    sections: b.cible === "sections" ? b.sections : [],
    produits: b.cible === "produits" ? b.produits : [],
    debut: b.debut,
    fin: b.fin || null,
    fermable: b.fermable !== false,
    priorite: b.priorite || 2,
    actif: b.actif !== false,
  };
}

// État d'un bandeau pour la liste : en ligne, programmé, terminé ou éteint.
export function etatBandeau(b, maintenant = Date.now()) {
  if (b.actif === false) return "eteint";
  if (b.fin && Date.parse(b.fin) <= maintenant) return "termine";
  if (Date.parse(b.debut) > maintenant) return "programme";
  return "en_ligne";
}
export const ETATS_BANDEAU = { en_ligne: N_("En ligne"), programme: N_("Programmé"), termine: N_("Terminé"), eteint: N_("Éteint") };

// Bandeaux qui se disputent une même page : plusieurs en ligne pour une même marque, seul le premier (priorité, puis gravité) s'affiche.
const ORDRE_TYPE = { urgent: 0, sea: 1, season: 2, new: 3, info: 4 };
export function ordreAffichage(a, b) {
  return (a.priorite || 2) - (b.priorite || 2) || ORDRE_TYPE[a.type] - ORDRE_TYPE[b.type] || Date.parse(b.debut) - Date.parse(a.debut);
}
