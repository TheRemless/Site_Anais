// Trajet « Retour au point de départ » (Jérémy, 16.11.2026) : le client prend un taxi ou un transfert pour faire un tour ou une course
// précise (un point de vue, une clinique, un marché), puis revient là où il a été pris. Pas de drop-off : un programme et, si on la connaît,
// une durée. Le prix se fixe au cas par cas, à la main : rien ici ne le calcule.
// Logique pure, sans DOM, testée dans tests/gestion-retour-depart.test.js. Le choix vit dans `details` de la réservation (pas de migration) :
//   details.type_trajet = "retour_depart" (absent : aller simple, ou un des deux sens d'un aller-retour saisi en deux services)
//   details.programme_trajet = ce que le client veut faire, en anglais (imprimé sur le voucher et la Booking confirmation)
//   details.duree_h = durée en heures (nombre, facultatif)
// Seuls Secret et Taxi saisissent des transferts : ZTP ne voit jamais ces champs.
import { tr } from "./i18n.mjs";

export const RETOUR_DEPART = "retour_depart";

export const estRetourDepartDetails = (dt) => !!dt && dt.type_trajet === RETOUR_DEPART;
export const estRetourDepart = (r) => !!r && estRetourDepartDetails(r.details);

// « 3 », « 3,5 », « 3.5 h », « 4 hours », « about 2h » : la durée en heures, par demi-heure, de 0,5 à 24. null si vide ou illisible.
export function lireDuree(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 && v <= 24 ? Math.round(v * 2) / 2 : null;
  const t = String(v).trim().toLowerCase();
  if (!t) return null;
  const m = /^(?:about|around|approx\.?|environ|~)?\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:h|hr|hrs|hours?|heures?|ชั่วโมง|ชม\.?)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return n > 0 && n <= 24 ? Math.round(n * 2) / 2 : null;
}
// Durée saisie mais illisible (« trois », « 30 »…) : à signaler sous le champ. Vide = non précisée, ce n'est pas une erreur.
export const dureeInvalide = (v) => String(v ?? "").trim() !== "" && lireDuree(v) === null;

const nombreEn = (n) => String(n);
// « about 3 hours », « about 1 hour », « about 1.5 hours » ; vide sans durée.
export const dureeAnglais = (v) => {
  const n = lireDuree(v);
  return n ? `about ${nombreEn(n)} ${n === 1 ? "hour" : "hours"}` : "";
};
// « environ 3 h », « environ 1,5 h » : pour l'interface (en anglais, « about 3 h »).
export const dureeFrancais = (v) => {
  const n = lireDuree(v);
  return n ? tr("environ {n} h", { n: String(n).replace(".", tr(",")) }) : "";
};

const propre = (s) => String(s || "").replace(/\s+/g, " ").trim();

// Le libellé d'une course de ce type, tel que la facture, la fiche, la fiduciaire et la recherche le disent : jamais « X → X ».
// « Round trip from Lanta Sand Resort: Old Town and viewpoint ». Un programme long est coupé au mot (le voucher, lui, le donne en entier).
export function libelleRetourDepart(lieu, programme = "", max = 90) {
  const l = propre(lieu);
  const tete = l ? `Round trip from ${l}` : "Round trip";
  const p = propre(programme);
  if (!p) return tete;
  const reste = max - tete.length - 2;
  if (p.length <= reste) return `${tete}: ${p}`;
  const coupe = p.slice(0, Math.max(0, reste - 1)).replace(/\s+\S*$/, "");
  return `${tete}: ${coupe || p.slice(0, Math.max(0, reste - 1))}…`;
}

// Ce que la ligne du chauffeur dit en plus de l'hôtel (feuille du jour, copie hors ligne) : « Back to the pickup place. Plan: Old Town tour. About 3 hours. »
// Vide pour un aller simple.
export function trajetPourChauffeur(r) {
  if (!estRetourDepart(r)) return "";
  const dt = r.details || {};
  const duree = dureeAnglais(dt.duree_h);
  // Le programme sans son point final (« … The driver waits. » ne fait pas « waits.. ») ; déjà dans le libellé d'une course hors catalogue, il n'est pas répété.
  const programme = propre(dt.programme_trajet).replace(/[\s.!;,]+$/, "");
  const dejaDit = programme && propre(r.libelle).toLowerCase().includes(programme.toLowerCase());
  return ["Back to the pickup place", programme && !dejaDit ? `Plan: ${programme}` : "", duree ? duree.charAt(0).toUpperCase() + duree.slice(1) : ""].filter(Boolean).join(". ");
}

// Le « drop-off » d'une course de ce type dans les messages (variable {dropoff}) : on le dit, pour ne pas laisser un blanc.
export const DROPOFF_RETOUR = { en: "back to the pickup place", fr: "retour au point de départ", th: "กลับจุดรับเดิม" };

// Pour l'interface (carte de réservation, accueil) : « Retour au point de départ · environ 3 h ». Vide pour un aller simple.
export function resumeTrajet(r) {
  if (!estRetourDepart(r)) return "";
  const duree = dureeFrancais((r.details || {}).duree_h);
  return [tr("Retour au point de départ"), duree].filter(Boolean).join(" · ");
}

// Contrôle d'une saisie de ce type : le programme est obligatoire (le chauffeur et le client doivent savoir ce qui est prévu),
// la durée facultative mais lisible. Rend { programme_trajet, duree_h } avec un code d'erreur, vide si tout va bien.
export function erreursTrajet(dt = {}) {
  const e = {};
  if (!estRetourDepartDetails(dt)) return e;
  if (!propre(dt.programme_trajet)) e.programme_trajet = "e_programme";
  if (dureeInvalide(dt.duree_h)) e.duree_h = "e_duree";
  return e;
}

// Les champs de `details` rangés pour l'enregistrement : un aller simple n'en garde aucun, un retour au départ n'a pas de drop-off.
// `dt` : les valeurs du formulaire (texte brut). La durée s'enregistre en nombre.
export function detailsTrajet(dt = {}) {
  if (!estRetourDepartDetails(dt)) return { type_trajet: "", programme_trajet: "", duree_h: "" };
  const n = lireDuree(dt.duree_h);
  return { type_trajet: RETOUR_DEPART, programme_trajet: propre(dt.programme_trajet), duree_h: n === null ? "" : n, drop_off: "" };
}

// ---- Demande collée ------------------------------------------------------------------------------------------------------------
// Message du site (formulaire taxi de secrettravelandtour.com, 16.11.2026) : la ligne « Round trip, back to the pickup place »,
// puis « Pickup: … », « Plan: … » et « Time needed: about N hours » (ou « not sure », ou absente).
export const LIGNE_SITE = /round trip,?\s*back to (?:the )?pick-?up place/i;

// « about 3 hours », « 3 hours », « not sure » → 3, 3, null.
export const dureeSite = (v) => (/not sure|unsure|don'?t know/i.test(String(v || "")) ? null : lireDuree(String(v || "").replace(/^\s*(?:about|around|approx\.?)\s*/i, "")));

// Message libre : ce qui dit « on revient au même endroit » (le chauffeur attend, fait le tour, ramène à l'hôtel).
// Indices forts : seuls, ils suffisent. Indices faibles (« and back », « round trip ») : seulement sans seconde date, sinon c'est un
// aller-retour classique A → B puis B → A (règle RETOUR de demande-calc.mjs), qui fait deux services.
const SANS_ACC = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const LIEU_DEPART = "(?:the |our |my )?(?:hotel|resort|villa|bungalows?|guest ?house|homestay|accommodation|room|place|same (?:place|spot|point)|starting point|pick-?up (?:place|point|spot))";
// Toujours un retour au départ : le chauffeur attend, fait le tour, ramène au même endroit.
const ABSOLUS = [
  /\bwait(?:s|ing)? for (?:us|me)\b/,
  /\b(?:driver|he|she|taxi|car) (?:can |could |will |would |to )?wait\b/,
  /\b(?:drive|take|show) (?:us|me) around\b/,
  /\bdriving (?:us|me) around\b/,
  /\b(?:same|starting) (?:place|spot|point)\b/,
  /\bpoint de depart\b/,
  /\bmeme endroit\b/,
  /\b(?:nous|m)\s*['’]?\s*attendre\b/,
  /\b(?:le chauffeur|il) (?:nous |m['’])?attend\w*\b/,
  /\baller[- ]retour (?:au|a|du) meme\b/,
];
// « back to the hotel », « nous ramener » : un retour au départ, sauf quand le message part d'un aéroport ou d'un port (« from the airport
// back to the hotel » est un aller simple).
const RETOURS = [
  new RegExp(`\\b(?:back|return(?:ing)?|come back) to ${LIEU_DEPART}\\b`),
  /\b(?:bring|take|drive) (?:us|me) back\b/,
  /\b(?:nous|me) ramener\b/,
  /\b(?:ramene|ramener|revenir|retour|rentrer)\w* (?:a|à|au) (?:l['’]\s*)?(?:hotel|villa|resort|bungalow|logement)\b/,
];
const FAIBLES = [/\band back\b/, /\bround[- ]?trip\b/, /\bcome back\b/, /\baller[- ]?(?:et[- ])?retour\b/, /\bthere and back\b/];
// Un aéroport ou un port dans le message : « and back » ou « back to the hotel » y décrit un transfert, pas un tour.
const BOUT_TRANSFERT = /\b(?:airport|aeroport|pier|ferry|jetty|port|terminal|bus station|gare)\b/;
// Un bateau ou une autre île : c'est un billet aller-retour, pas une course en taxi (« around the island » reste une course sur Koh Lanta).
const BATEAU = /\b(?:speed ?boats?|boats?|bateaux?|ferry|longtail|islands|island hopping|iles|koh (?!lanta\b)\w+)\b/;

export function indiceRetourDepart(texte) {
  const t = SANS_ACC(texte);
  if (BATEAU.test(t)) return "";
  if (ABSOLUS.some((re) => re.test(t))) return "fort";
  if (BOUT_TRANSFERT.test(t)) return "";
  if (RETOURS.some((re) => re.test(t))) return "fort";
  if (FAIBLES.some((re) => re.test(t))) return "faible";
  return "";
}

// « for 3 hours », « about 4h », « pendant 3 heures », « 2-3 hours » (on garde le plus long) : la durée citée, ou null.
export function dureeLibre(texte) {
  const t = SANS_ACC(texte);
  const m = /(\d{1,2}(?:[.,]\d)?)\s*(?:-|to|a|à)\s*(\d{1,2}(?:[.,]\d)?)\s*(?:h\b|hrs?\b|hours?\b|heures?\b)/.exec(t) || /(\d{1,2}(?:[.,]\d)?)()\s*(?:h\b|hrs?\b|hours?\b|heures?\b)(?!\s*\d)/.exec(t);
  if (!m) return null;
  // « at 9h » ou « 9h30 » est une heure, pas une durée.
  const avant = t.slice(Math.max(0, m.index - 4), m.index);
  if (/\b(?:at|a|à|vers)\s*$/.test(avant)) return null;
  return lireDuree(m[2] || m[1]);
}

// La phrase utile pour « Programme » : celle qui porte l'indice, sans salutation ni signature, coupée à 200 caractères.
export function phraseProgramme(texte) {
  const phrases = String(texte || "").split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const utiles = phrases.filter((p) => indiceRetourDepart(p) || /\b(?:visit|see|tour|go to|stop at|stops?|viewpoint|market|clinic|hospital|temple|shopping|old town|beach|aller voir|visiter|faire le tour)\b/i.test(SANS_ACC(p)));
  // La salutation en tête de phrase s'en va (« Hello, on 20 Nov… »), les remerciements seuls aussi.
  const SALUT = /^(?:hi|hello|hey|dear|good (?:morning|afternoon|evening)|bonjour|bonsoir|salut)\b[^,.!?\n]{0,20}?[,.!]\s*|^(?:hi|hello|hey|bonjour|bonsoir|salut)\s+/i;
  const choix = (utiles.length ? utiles : phrases).map((p) => p.replace(SALUT, "").trim()).filter((p) => p && !/^(?:thanks?|thank you|merci|regards|cheers|best)\b/i.test(p));
  const t = propre(choix.join(" "));
  return t.length > 200 ? `${t.slice(0, 199).replace(/\s+\S*$/, "")}…` : t;
}

// Décision pour un message libre : { programme, duree } si c'est un retour au point de départ, sinon null.
// `nbDates` : le nombre de dates distinctes du message (deux dates avec « and back » font un aller-retour classique).
export function lireRetourDepartLibre(texte, { nbDates = 0 } = {}) {
  const indice = indiceRetourDepart(texte);
  if (!indice) return null;
  // Deux dates : l'aller et le retour d'un aller-retour classique, même avec « back to the hotel ».
  if (nbDates > 1) return null;
  return { programme: phraseProgramme(texte), duree: dureeLibre(texte) };
}

// Fiche d'une course hors catalogue (sans prestation ni trajet de la base) dont on change le type : son libellé généré suit, pour que la
// facture, la fiduciaire et la recherche disent la même chose que le voucher. Un libellé réécrit à la main, ou celui d'une prestation, ne bouge pas.
// Rend le nouveau libellé, ou null s'il ne change pas.
export function libelleSelonTrajet({ libelle = "", libre = false, lieu = "", details = {} }) {
  if (!libre) return null;
  const l = String(libelle || "").trim();
  const genere = /→/.test(l) || /^round trip\b/i.test(l);
  if (!genere) return null;
  const p = propre(lieu);
  let nouveau = null;
  if (estRetourDepartDetails(details)) nouveau = p ? libelleRetourDepart(p, details.programme_trajet) : null;
  else if (/^round trip\b/i.test(l)) nouveau = p && propre(details.drop_off) ? `${p} → ${propre(details.drop_off)}` : null;
  return nouveau && nouveau !== l ? nouveau : null;
}
