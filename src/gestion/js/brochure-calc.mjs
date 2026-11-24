// « Importer une brochure », côté outil : la logique pure (sans écran). La fonction « assistant » (usage « brochure », deux passes : lecture puis
// relecture) rend ce qui figure sur la brochure ; ici on normalise les lieux, on marque l'arrivée du lendemain, on compare au catalogue du
// partenaire (nouveau, prix changé, inchangé, illisible) puis on prépare les écritures des lignes cochées. Rien ne s'écrit sans la personne :
// l'écran (views/brochure.mjs) montre chaque ligne et n'enregistre que ce qu'elle garde, une ligne par transaction (brochure_ecrire_ligne,
// migration 124).
//
// Règles de Jérémy : la brochure fait foi pour les prix de vente ; un net s'écrit s'il figure sur le document, imprimé ou écrit à la main, et
// que la personne a le droit « prix nets » ; il n'est jamais déduit. Une ligne n'est illisible que si son prix de vente ou son trajet ne se lit
// pas : un net caché la laisse lisible (« net à saisir »), et une ligne illisible se complète à la main dans l'écran avant de s'enregistrer.
// Un nom de lieu incertain est signalé « à vérifier », jamais inventé.
import { sansAccents, PERIODE_TOUTE } from "./partenaires-calc.mjs";
import { prestationEnfantSeparee, prixEnfantDe } from "./demande-calc.mjs";
import { assistantActif } from "./assistant-calc.mjs";
import { modeTrajet } from "./operations-calc.mjs";
import { brochureDemoTransport } from "./brochure-demo.mjs";

export const DROITS_BROCHURE = ["partenaires.lire", "partenaires.ecrire", "partenaires.prix"];
export const brochureDisponible = (regl, permissions = []) => assistantActif(regl) && DROITS_BROCHURE.every((p) => permissions.includes(p));

// ---- Lieux et heures --------------------------------------------------------------------------------------------------------------------

// Les abréviations d'une brochure de transporteur (essai du 24.11.2026). La fonction donne la même liste à Claude (ABREVIATIONS_PROMPT,
// assistant/brochure.js) ; ici elle s'applique après les noms déjà au catalogue. Une variante d'écriture va dans VARIANTES.
export const ABREVIATIONS_LIEUX = [
  ["Lanta", "Koh Lanta"],
  ["BKK", "Bangkok"],
  ["KL", "Kuala Lumpur"],
  ["Hadyai", "Hat Yai"],
  ["A/P", "Airport"],
  ["Ipho", "Ipoh"],
  ["Phatthalang", "Phatthalung"],
  ["Nakon", "Nakhon Si Thammarat"],
  ["Padang", "Padang Besar"],
  ["Kolok", "Sungai Kolok"],
  ["Khaosan (BKK)", "Bangkok (Khao San Road)"],
];
const cle = (s) => sansAccents(s).replace(/[^a-z0-9]+/g, " ").trim();
const VARIANTES = { "bkk khaosan": "Bangkok (Khao San Road)", khaosan: "Bangkok (Khao San Road)", "khao san": "Bangkok (Khao San Road)", "khao san road": "Bangkok (Khao San Road)", "had yai": "Hat Yai", nakhon: "Nakhon Si Thammarat", "nakhon si": "Nakhon Si Thammarat", "sungai golok": "Sungai Kolok", "ko lanta": "Koh Lanta" };
export const AMBIGUS = new Set(["nakon", "nakhon", "padang"]);
const NOMS_ENTIERS = new Map([...ABREVIATIONS_LIEUX.filter(([a]) => a !== "A/P").map(([a, b]) => [cle(a), b]), ...Object.entries(VARIANTES)]);
// Dans un nom plus long : « Krabi A/P » → « Krabi Airport », « Hadyai A/P » → « Hat Yai Airport », « BKK Airport » → « Bangkok Airport ».
const MOTS = [
  [/\bA\s*\/\s*P\b\.?|\bAPT\b\.?/gi, "Airport"],
  [/\bBKK\b/gi, "Bangkok"],
  [/\bKL\b/g, "Kuala Lumpur"],
  [/\bHad\s?yai\b/gi, "Hat Yai"],
  [/\bIpho\b/gi, "Ipoh"],
  [/\bPhatthalang\b/gi, "Phatthalung"],
];

// Les lieux déjà au catalogue (départs et arrivées des trajets de l'entreprise), un par nom.
export function lieuxDuCatalogue(trajets = []) {
  const vus = new Map();
  for (const t of trajets) for (const l of [t.de, t.vers]) if (l && !vus.has(cle(l))) vus.set(cle(l), String(l).trim());
  return [...vus.values()];
}
// Le nom du catalogue qui est ce lieu : même nom, ou le même précédé de « Koh » / « Ko » (« Lanta » → « Koh Lanta »). Un seul, sinon aucun.
function auCatalogue(nom, lieux) {
  const k = cle(nom);
  if (!k) return "";
  const memes = lieux.filter((l) => cle(l) === k);
  if (memes.length) return memes[0];
  const avecKoh = lieux.filter((l) => cle(l) === `koh ${k}` || cle(l) === `ko ${k}`);
  return avecKoh.length === 1 ? avecKoh[0] : "";
}
// Un texte qui ressemble à une abréviation : capitales courtes (« BKK »), barre ou point (« A/P », « Nak. »).
const abrege = (s) => /^[A-Z]{2,4}$/.test(s.trim()) || /[/.]/.test(s);

// Un lieu hors du catalogue en casse de titre (retour de l'essai réel du 24.11.2026 : « TRANG TRAIN STATION », « SONGKHLA ») : chaque mot tout
// en capitales passe en casse de titre, sauf un sigle (connu, ou 2 à 4 lettres sans voyelle : « TRG », « KL »). Les mots déjà en casse mixte
// ne changent pas (« TRANG Airport » → « Trang Airport »). Le texte imprimé reste visible à côté.
export function casseLieu(nom) {
  return String(nom || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\p{Lu}{2,}/gu, (m) => (SIGLES.has(m) || (m.length <= 4 && !/[AEIOUY]/.test(m)) ? m : m[0] + m.slice(1).toLowerCase()));
}
// Le nom usuel d'un lieu imprimé. D'abord le catalogue, puis la table des abréviations (un nom ambigu y reste « à vérifier »), puis le nom proposé par la lecture (signalé « à vérifier »
// s'il ne vient ni de l'un ni de l'autre), sinon le texte imprimé tel quel (« à vérifier » s'il a l'air abrégé).
// Rend { nom, imprime, source: "catalogue" | "table" | "lecture" | "imprime" | "", a_verifier }.
export function normaliserLieu(imprime, { suggestion = "", lieux = [] } = {}) {
  const brut = String(imprime || "").trim();
  const propose = String(suggestion || "").trim();
  if (!brut && !propose) return { nom: "", imprime: "", source: "", a_verifier: false };
  const depuis = brut || propose;
  const cat = auCatalogue(depuis, lieux);
  if (cat) return { nom: cat, imprime: brut, source: "catalogue", a_verifier: false };
  let table = NOMS_ENTIERS.get(cle(depuis)) || "";
  if (!table) {
    const remplace = MOTS.reduce((t, [re, nom]) => t.replace(re, nom), depuis).replace(/\s+/g, " ").trim();
    if (remplace !== depuis) table = remplace;
  }
  // Un nom ambigu (« Nakon », « Nakhon » : Nakhon Si Thammarat, Ratchasima, Pathom… ; « Padang » : Padang Besar ou Padang en Indonésie) est
  // proposé, jamais réécrit d'office : « à vérifier », et la ligne n'est pas cochée (revue du 24.11.2026).
  if (table) return { nom: auCatalogue(table, lieux) || casseLieu(table), imprime: brut, source: "table", a_verifier: AMBIGUS.has(cle(depuis)) };
  if (propose && cle(propose) !== cle(brut)) {
    const catPropose = auCatalogue(propose, lieux);
    return catPropose ? { nom: catPropose, imprime: brut, source: "catalogue", a_verifier: false } : { nom: casseLieu(propose), imprime: brut, source: "lecture", a_verifier: true };
  }
  return { nom: casseLieu(depuis), imprime: brut, source: "imprime", a_verifier: abrege(depuis) };
}

// Une arrivée du lendemain s'écrit comme au catalogue : « 06:00 (next day) ». lireArrivee fait l'inverse (le formulaire des trajets, le voucher).
export const SUFFIXE_LENDEMAIN = " (next day)";
// `precision` : ce que la brochure imprime après l'heure (« (Malaysia time) »), gardé tel quel.
export const arriveeTexte = (heure, lendemain = false, precision = "") => (heure ? `${heure}${precision ? ` ${precision}` : ""}${lendemain ? SUFFIXE_LENDEMAIN : ""}` : "");
// Le départ écrit au catalogue, avec sa précision imprimée (« 07:00 (Malaysia time) »), comme l'arrivée : le voucher l'imprime tel quel.
export const departTexte = (heure, precision = "") => (heure ? `${heure}${precision ? ` ${precision}` : ""}` : "");
// Ce que la brochure imprime du trajet, gardé en base (colonne « imprime », migration 127) : jamais la ligne recopiée (elle peut porter un net,
// et trajets se lit avec le seul droit « voir les partenaires »), mais les champs utiles reconstruits : lieux et type tels qu'imprimés, heures
// avec leur précision, prix de vente (texteSurLigne). Un nom de lieu ambigu ou corrigé garde ainsi sa trace.
export const texteImprimeTrajet = (lu) => texteSurLigne(lu);
export function lireArrivee(texte) {
  const t = String(texte || "").trim();
  const m = /^(\d{1,2}:\d{2})\s*(?:\((?:next day|\+1|lendemain|le lendemain)\)|\+1)?$/i.exec(t);
  if (!m) return { heure: "", lendemain: false, autre: t };
  return { heure: m[1].padStart(5, "0"), lendemain: /next day|\+1|lendemain/i.test(t), autre: "" };
}
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
// Durée sûre d'une ligne lue : aucune quand une heure porte une précision (heure locale d'un autre fuseau, « (Malaysia time) »).
export const dureeSure = (lu) => (lu.depart_precision || lu.arrivee_precision ? "" : dureeTrajet(lu.depart, lu.arrivee, lu.lendemain));
// Durée d'un trajet, écrite comme au catalogue (« 22 h », « 1 h 30 »), quand départ et arrivée sont connus.
export function dureeTrajet(depart, arrivee, lendemain) {
  if (!HEURE.test(depart || "") || !HEURE.test(arrivee || "")) return "";
  const d = minutes(arrivee) - minutes(depart) + (lendemain || minutes(arrivee) < minutes(depart) ? 1440 : 0);
  if (d <= 0) return "";
  const h = Math.floor(d / 60);
  const m = d % 60;
  return !h ? `${m} min` : m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

// ---- Rapprochement avec le catalogue ------------------------------------------------------------------------------------------------------

// Mots qui ne distinguent pas deux programmes (« Koh », « trip », « small group »…). Pluriels ramenés au singulier.
const VIDES = new Set(["the", "and", "with", "by", "of", "to", "for", "in", "on", "de", "du", "des", "la", "le", "les", "et", "en", "au", "aux", "a", "un", "une", "koh", "ko", "trip", "tour", "small", "group", "groupe", "island", "ile", "iles", "excursion", "pp", "per", "person", "par", "personne", "adult", "adulte"]);
export function motsCles(...textes) {
  const out = new Set();
  for (const t of textes)
    for (let m of cle(t).split(" ")) {
      if (m.length > 3 && m.endsWith("s")) m = m.slice(0, -1);
      if (m.length >= 2 && !VIDES.has(m)) out.add(m);
    }
  return out;
}
// Coefficient de Dice entre deux ensembles de mots : 1 quand ils sont égaux, 0 quand rien n'est commun.
const dice = (a, b) => {
  if (!a.size || !b.size) return 0;
  let commun = 0;
  for (const m of a) if (b.has(m)) commun++;
  return (2 * commun) / (a.size + b.size);
};
export const SEUIL_RAPPROCHEMENT = 0.75;
export const SEUIL_PROCHE = 0.5;

// Les tarifs du partenaire qu'une ligne de brochure peut mettre à jour : ni la ligne enfant séparée (elle suit son tarif adulte), ni un frais de parc.
export const ciblesPossibles = (partenaireId, prestations = []) => prestations.filter((p) => p.partenaire_id === partenaireId && p.unite !== "ch" && p.famille !== "frais");

// Le tarif du catalogue qui correspond le mieux à une ligne lue : même libellé (« sure »), mêmes mots (« sure »), mots proches (« probable »),
// sinon aucun, avec le plus proche pour aide (« proche »). Un tarif actif passe avant un tarif masqué à score égal.
export function rapprocherTarif(lu, cibles) {
  const k = cle(lu.libelle);
  const exact = cibles.filter((p) => k && (cle(p.libelle) === k || cle(p.libelle_en) === k)).sort((a, b) => (a.actif === false) - (b.actif === false))[0];
  if (exact) return { cible: exact, confiance: "sure", score: 1 };
  const mots = motsCles(lu.groupe, lu.libelle);
  let meilleur = null;
  for (const p of cibles) {
    const score = Math.max(dice(mots, motsCles(p.groupe, p.libelle)), dice(mots, motsCles(p.groupe, p.libelle_en)));
    if (!meilleur || score > meilleur.score || (score === meilleur.score && meilleur.cible.actif === false && p.actif !== false)) meilleur = { cible: p, score };
  }
  if (!meilleur || meilleur.score < SEUIL_PROCHE) return { cible: null, confiance: "", score: 0 };
  if (meilleur.score === 1) return { cible: meilleur.cible, confiance: "sure", score: 1 };
  if (meilleur.score >= SEUIL_RAPPROCHEMENT) return { cible: meilleur.cible, confiance: "probable", score: meilleur.score };
  return { cible: null, confiance: "", score: 0, proche: meilleur.cible };
}

const nombre = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// Le prix enfant d'un tarif du catalogue : celui de sa fiche, sinon celui de la ligne enfant séparée (anciens tarifs, comme Lazy Day du 17.11.2026).
export function enfantDuCatalogue(p, prestations = []) {
  const fiche = prixEnfantDe(p);
  if (fiche !== null) return { prix: fiche, separee: null };
  const separee = prestationEnfantSeparee(p, prestations);
  return { prix: separee ? nombre(separee.prix_vente) : null, separee };
}

// Statut d'une ligne de tarif face à son tarif du catalogue (ou à aucun). `ecarts` liste les prix qui changent ; `infos` ce qui diffère sans être
// repris (l'unité d'un tarif existant ne change pas ici).
export function comparerTarif(lu, cible, prestations = []) {
  if (!lu.lisible) return { statut: "illisible", ecarts: [], infos: [] };
  if (!cible) return { statut: "nouveau", ecarts: [], infos: [] };
  const ecarts = [];
  const infos = [];
  const avant = nombre(cible.prix_vente);
  if (lu.prix_adulte !== null && lu.prix_adulte !== avant) ecarts.push({ champ: "prix_adulte", avant, apres: lu.prix_adulte });
  const enfant = enfantDuCatalogue(cible, prestations);
  // Un prix enfant ne s'écrit que sur un tarif par personne ou par adulte, ou sur sa ligne enfant séparée : sinon il est montré, pas repris.
  const enfantInscriptible = !!enfant.separee || ["pp", "ad"].includes(cible.unite);
  if (lu.prix_enfant !== null && lu.prix_enfant !== enfant.prix) (enfantInscriptible ? ecarts : infos).push({ champ: "prix_enfant", avant: enfant.prix, apres: lu.prix_enfant });
  if (lu.unite && cible.unite && lu.unite !== cible.unite) infos.push({ champ: "unite", avant: cible.unite, apres: lu.unite });
  return { statut: ecarts.length ? "prix_change" : "inchange", ecarts, infos };
}

// L'heure de départ seule (« 07:00 » de « 07:00 (Malaysia time) ») : un départ avec sa précision au catalogue se rapproche de la même heure lue.
const heureSeule = (h) => String(h || "").slice(0, 5);
const cleTrajet = (t) => `${cle(t.de)}|${cle(t.vers)}|${heureSeule(t.depart)}`;

export function comparerTrajet(lu, cible) {
  if (!lu.lisible) return { statut: "illisible", ecarts: [], infos: [] };
  if (!cible) return { statut: "nouveau", ecarts: [], infos: [] };
  const ecarts = [];
  for (const [champ, cleCible] of [["prix_adulte", "prix_adulte"], ["prix_enfant", "prix_enfant"]]) {
    const avant = nombre(cible[cleCible]);
    if (lu[champ] !== null && lu[champ] !== avant) ecarts.push({ champ, avant, apres: lu[champ] });
  }
  return { statut: ecarts.length ? "prix_change" : "inchange", ecarts, infos: [] };
}

// Ce qui demande un regard avant d'enregistrer : un lieu au nom incertain, une lecture douteuse (confiance basse, ligne signalée à la
// relecture), un net au-dessus du prix de vente. « net_a_saisir » se montre sans retenir la ligne : elle s'enregistre avec un net vide.
export function signauxLigne(ligne) {
  const lu = ligne.lu || {};
  const s = [];
  if (ligne.lieux && ((ligne.lieux.de && ligne.lieux.de.a_verifier) || (ligne.lieux.vers && ligne.lieux.vers.a_verifier))) s.push("lieu_a_verifier");
  if (lu.confiance === "basse") s.push("confiance_basse");
  if (lu.relecture === "signale") s.push("relecture_signale");
  if (lu.net_superieur) s.push("net_superieur");
  if (lu.net_a_saisir && !lu.sur_demande) s.push("net_a_saisir");
  return s;
}
const RETENUS = ["lieu_a_verifier", "confiance_basse", "relecture_signale", "net_superieur"];

// Coché d'office : une ligne nouvelle (lisible) et un prix changé sur un tarif reconnu sans doute, sans rien qui demande un regard. Un
// rapprochement « probable » attend que la personne vérifie que c'est bien ce tarif. Une ligne illisible ne se coche pas.
export const cocheParDefaut = (ligne) => (ligne.statut === "nouveau" || (ligne.statut === "prix_change" && ligne.confiance !== "probable")) && !signauxLigne(ligne).some((x) => RETENUS.includes(x));

// Une ligne de trajet lue, ses lieux ramenés au nom usuel (catalogue, puis table des abréviations). Le texte imprimé reste dans `lieux`.
function trajetNormalise(brut, lieux, saisis = {}) {
  const de = saisis.de !== undefined ? { nom: saisis.de, imprime: brut.de_imprime || "", source: "saisi", a_verifier: false } : normaliserLieu(brut.de_imprime || brut.de, { suggestion: brut.de, lieux });
  const vers = saisis.vers !== undefined ? { nom: saisis.vers, imprime: brut.vers_imprime || "", source: "saisi", a_verifier: false } : normaliserLieu(brut.vers_imprime || brut.vers, { suggestion: brut.vers, lieux });
  return { lu: { ...brut, de: de.nom, vers: vers.nom }, lieux: { de, vers } };
}

// Le trajet du catalogue d'une ligne lue : même départ, même arrivée, même heure, pas déjà pris par une autre ligne.
const cibleTrajet = (lu, sesTrajets, pris) => (lu.lisible ? sesTrajets.find((t) => !pris.has(t.id) && cleTrajet(t) === cleTrajet(lu)) || null : null);

// Toutes les lignes de la brochure face au catalogue du partenaire. Rend { tarifs, trajets, absents } ; chaque ligne garde ce qui a été lu
// (`lu`, lieux normalisés ; `brut`, tel que la fonction l'a rendu), son tarif ou trajet du catalogue (`cible`), son statut, et un identifiant
// stable (`cle`) pour l'écran. `trajets` : tous ceux de l'entreprise (leurs lieux servent à la normalisation) ; seuls ceux du partenaire se comparent.
export function comparerBrochure(brochure, { partenaireId, prestations = [], trajets = [] }) {
  const cibles = ciblesPossibles(partenaireId, prestations);
  const deja = new Set();
  const tarifs = (brochure.tarifs || []).map((lu, i) => {
    const r = lu.lisible ? rapprocherTarif(lu, cibles.filter((p) => !deja.has(p.id))) : { cible: null, confiance: "", score: 0 };
    if (r.cible) deja.add(r.cible.id);
    const c = comparerTarif(lu, r.cible, prestations);
    const ligne = { cle: `t${i}`, genre: "prestation", lu, brut: lu, cible: r.cible, confiance: r.confiance, proche: r.proche || null, libelle: lu.libelle, ...c };
    return { ...ligne, coche: cocheParDefaut(ligne) };
  });
  const lieux = lieuxDuCatalogue(trajets);
  const sesTrajets = partenaireId ? trajets.filter((t) => t.partenaire_id === partenaireId) : [];
  const dejaT = new Set();
  const lignesTrajets = (brochure.trajets || []).map((brut, i) => {
    const { lu, lieux: noms } = trajetNormalise(brut, lieux);
    const cible = cibleTrajet(lu, sesTrajets, dejaT);
    if (cible) dejaT.add(cible.id);
    const c = comparerTrajet(lu, cible);
    const ligne = { cle: `j${i}`, genre: "trajet", lu, brut, lieux: noms, cible, confiance: cible ? "sure" : "", ...c };
    return { ...ligne, coche: cocheParDefaut(ligne) };
  });
  // Ce que le catalogue a et que la brochure ne montre pas : rien n'y change, la liste aide à repérer un programme arrêté.
  const absents = [...cibles.filter((p) => p.actif !== false && !deja.has(p.id)), ...sesTrajets.filter((t) => t.actif !== false && !dejaT.has(t.id))];
  return { tarifs, trajets: lignesTrajets, absents };
}

// Une ligne dont la personne change le tarif visé (« Nouvelle prestation » ou un autre tarif du partenaire) : statut recalculé.
export function changerCible(ligne, cible, prestations = []) {
  const c = comparerTarif(ligne.lu, cible, prestations);
  const neuve = { ...ligne, cible, confiance: cible ? "sure" : "", proche: null, ...c };
  return { ...neuve, coche: cocheParDefaut(neuve) };
}

const prixSaisi = (v) => {
  const n = Number(String(v ?? "").replace(/[\s,']/g, ""));
  return v === "" || v === null || v === undefined || !Number.isFinite(n) || n <= 0 ? null : Math.round(n * 100) / 100;
};

// Une ligne complétée ou corrigée à la main dans l'écran (24.11.2026) : prix de vente, prix enfant, nets, heures, lieux. Ce qui est saisi
// remplace ce qui a été lu ; un champ laissé vide garde la lecture. La ligne redevient lisible quand son prix de vente et son trajet sont là,
// puis elle est comparée de nouveau au catalogue. `pris` : les tarifs ou trajets du catalogue déjà visés par les autres lignes.
// `saisie` : { prix_adulte, prix_enfant, net_adulte, net_enfant, depart, arrivee, lendemain, de, vers } (textes de l'écran).
export function completerLigne(ligne, saisie, { partenaireId, prestations = [], trajets = [], pris = new Set() } = {}) {
  const s = saisie || {};
  const brut = { ...ligne.brut };
  const nombres = {};
  for (const k of ["prix_adulte", "prix_enfant", "net_adulte", "net_enfant"]) if (s[k] !== undefined && String(s[k]).trim() !== "") nombres[k] = prixSaisi(s[k]);
  Object.assign(brut, Object.fromEntries(Object.entries(nombres).filter(([, v]) => v !== null)));
  if (nombres.net_adulte || nombres.net_enfant) Object.assign(brut, { net_source: "saisi", net_cache: false, net_superieur: false });
  const saisi = { ...(ligne.saisi || {}), ...Object.fromEntries(Object.keys(nombres).filter((k) => nombres[k] !== null).map((k) => [k, true])) };
  if (ligne.genre === "trajet") {
    for (const k of ["depart", "arrivee"]) if (s[k] !== undefined && HEURE.test(String(s[k]))) (brut[k] = s[k]), (saisi[k] = true);
    if (s.lendemain !== undefined) (brut.lendemain = !!s.lendemain), (saisi.lendemain = true);
    if (brut.depart && brut.arrivee && !brut.depart_precision && !brut.arrivee_precision && minutes(brut.arrivee) < minutes(brut.depart)) brut.lendemain = true;
    if (saisi.depart || saisi.arrivee || saisi.lendemain) brut.duree = dureeSure(brut);
    const lieuxSaisis = {};
    for (const k of ["de", "vers"]) if (s[k] !== undefined && String(s[k]).trim()) lieuxSaisis[k] = String(s[k]).trim();
    const avant = ligne.lieux || {};
    const garde = { ...(avant.de && avant.de.source === "saisi" ? { de: avant.de.nom } : {}), ...(avant.vers && avant.vers.source === "saisi" ? { vers: avant.vers.nom } : {}), ...lieuxSaisis };
    const n = trajetNormalise(brut, lieuxDuCatalogue(trajets), garde);
    n.lu.lisible = !!(n.lu.de && n.lu.vers && HEURE.test(n.lu.depart || "") && n.lu.prix_adulte !== null);
    n.lu.illisible = n.lu.lisible ? "" : brut.illisible || ligne.brut.illisible;
    // Un prix, un net ou une heure saisis : la personne a regardé les chiffres. Un lieu corrigé seul ne lève pas un doute sur le prix.
    if (Object.keys(saisi).length && n.lu.lisible) n.lu.confiance = "haute";
    if (n.lu.net_adulte !== null && n.lu.net_a_saisir) n.lu.net_a_saisir = false;
    const sesTrajets = partenaireId ? trajets.filter((t) => t.partenaire_id === partenaireId) : [];
    const cible = cibleTrajet(n.lu, sesTrajets, pris);
    const c = comparerTrajet(n.lu, cible);
    const neuve = { ...ligne, lu: n.lu, brut, lieux: n.lieux, saisi, cible, confiance: cible ? "sure" : "", ...c };
    return { ...neuve, coche: n.lu.lisible && cocheParDefaut(neuve) };
  }
  const lu = { ...brut, lisible: brut.sur_demande || brut.prix_adulte !== null, ...(saisi.prix_adulte || saisi.prix_enfant ? { saisi_main: true } : {}) };
  lu.illisible = lu.lisible ? "" : lu.illisible;
  if (Object.keys(saisi).length) lu.confiance = "haute";
  if (lu.net_adulte !== null) lu.net_a_saisir = false;
  const cibles = ciblesPossibles(partenaireId, prestations).filter((p) => !pris.has(p.id));
  const r = ligne.cible && !pris.has(ligne.cible.id) ? { cible: ligne.cible, confiance: ligne.confiance } : lu.lisible ? rapprocherTarif(lu, cibles) : { cible: null, confiance: "" };
  const c = comparerTarif(lu, r.cible, prestations);
  const neuve = { ...ligne, lu, brut, saisi, cible: r.cible, confiance: r.confiance, proche: r.proche || null, ...c };
  return { ...neuve, coche: lu.lisible && cocheParDefaut(neuve) };
}

export function compter(lignes) {
  const n = { nouveau: 0, prix_change: 0, inchange: 0, illisible: 0 };
  for (const l of lignes) n[l.statut] = (n[l.statut] || 0) + 1;
  return n;
}

// ---- Écritures ------------------------------------------------------------------------------------------------------------------------

const AGES = /^(\d{1,2})\s*(?:-|–|à|to)\s*(\d{1,2})$/;
// La tranche d'âge du prix enfant, écrite dans la langue des fiches de l'entreprise (anglais pour Secret et Taxi, français pour Zwald).
export function phraseAgeEnfant(age, langue = "en") {
  const a = String(age || "").replace(/\s*(ans|years?( old)?|yrs?( old)?|y\.?o\.?)\s*$/i, "").trim();
  if (!a) return "";
  const m = AGES.exec(a);
  if (langue === "fr") return m ? `Prix enfant de ${m[1]} à ${m[2]} ans.` : `Prix enfant : ${a}.`;
  return m ? `Child price: ${m[1]} to ${m[2]} years old.` : `Child price: ${a}.`;
}

const puces = (t) => String(t || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => (/^[•\-*]/.test(l) ? `• ${l.replace(/^[•\-*]\s*/, "")}` : `• ${l}`));
const dateFr = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");
const noteImport = (lu, aujourdhui) => `Importé de la brochure le ${dateFr(aujourdhui)}${lu.prix_texte ? ` (prix imprimé : « ${lu.prix_texte} »)` : ""}${lu.saisi_main ? ", prix complété à la main" : ""}.`;

// Détails d'une prestation nouvelle : seulement ce que la brochure imprime (un champ vide n'est pas écrit). Le déroulé et les inclus vont
// ensemble dans « Inclus », une puce par ligne, comme les fiches faites à la main.
export function detailsDepuisBrochure(lu, { langue = "en", aujourdhui = "" } = {}) {
  const d = {};
  const mettre = (k, v) => v && (d[k] = v);
  mettre("horaires", lu.horaires);
  mettre("duree", lu.duree);
  mettre("capacite", lu.capacite);
  mettre("bateau", lu.bateau);
  mettre("inclus", [...puces(lu.programme), ...puces(lu.inclus)].join("\n"));
  mettre("parc", lu.parc);
  // Prix « sur demande » : la prestation naît sans prix (« prix à saisir » à chaque client) et la fiche le dit.
  const surDemande = lu.sur_demande ? (langue === "fr" ? "Prix sur demande." : "Price on request.") : "";
  mettre("conditions", [surDemande, lu.conditions, lu.prix_enfant !== null ? phraseAgeEnfant(lu.age_enfant, langue) : ""].filter(Boolean).join("\n"));
  d.note = noteImport(lu, aujourdhui);
  if (lu.prix_enfant !== null && ["pp", "ad"].includes(uniteNouvelle(lu))) d.enfant = lu.prix_enfant;
  return d;
}
// Unité d'un tarif créé : celle imprimée ; un prix enfant sans unité imprimée fait un tarif par personne.
const uniteNouvelle = (lu) => lu.unite || (lu.prix_enfant !== null ? "pp" : "");

const TEXTES = ["horaires", "duree", "capacite", "bateau", "inclus", "parc", "conditions"];

// Les opérations à faire pour les lignes cochées, dans l'ordre : { genre, action: "creer" | "modifier", table, id, valeurs, enfant, nets, cle, libelle }.
// `enfant` : la ligne enfant séparée d'un ancien tarif à mettre à jour. `nets` : seulement si `droitNets` et un net qui figure sur le document,
// imprimé ou écrit à la main, ou saisi dans l'écran (jamais déduit) ; il complète la ligne de nets existante sans effacer l'autre valeur.
// Un net caché ou absent laisse la ligne s'enregistrer, sans net. Une ligne cochée qui ne change rien ne donne aucune opération.
// Chaque opération s'écrit en une transaction (brochure_ecrire_ligne, migration 124) : la ligne, sa ligne enfant et ses nets ensemble.
export function planBrochure(lignes, { partenaireId, prestations = [], prestationsNets = [], trajetsNets = [], droitNets = false, langue = "en", aujourdhui = "", ordreMax = 0, numeroMax = 0 } = {}) {
  const ops = [];
  let ordre = ordreMax;
  let numero = numeroMax;
  const netsDe = (liste, cleParent, id) => (id ? liste.find((n) => n[cleParent] === id) || null : null);
  for (const l of lignes) {
    if (!l.coche || l.statut === "illisible" || !l.lu.lisible) continue;
    const lu = l.lu;
    const avecNet = droitNets && (lu.net_adulte !== null || lu.net_enfant !== null);
    if (l.genre === "prestation") {
      const libelle = String(l.libelle || lu.libelle).trim() || lu.libelle;
      if (!l.cible) {
        ordre += 1;
        ops.push({
          genre: "prestation",
          action: "creer",
          table: "prestations",
          cle: l.cle,
          libelle,
          valeurs: { partenaire_id: partenaireId, famille: lu.famille || "excursion", groupe: lu.groupe || "", libelle, libelle_en: libelle, prix_vente: lu.prix_adulte, unite: uniteNouvelle(lu), sur_place: false, actif: true, ordre, details: detailsDepuisBrochure(lu, { langue, aujourdhui }) },
          enfant: null,
          nets: avecNet ? { table: "prestations_nets", cleParent: "prestation_id", valeurs: { net: lu.net_adulte, net_enfant: lu.net_enfant, note: "" } } : null,
        });
        continue;
      }
      const c = l.cible;
      const d = { ...(c.details || {}) };
      const patch = {};
      let enfant = null;
      if (lu.prix_adulte !== null && lu.prix_adulte !== nombre(c.prix_vente)) patch.prix_vente = lu.prix_adulte;
      if (lu.prix_enfant !== null) {
        const e = enfantDuCatalogue(c, prestations);
        if (lu.prix_enfant !== e.prix) {
          if (e.separee && d.enfant === undefined) enfant = { id: e.separee.id, libelle: e.separee.libelle, valeurs: { prix_vente: lu.prix_enfant } };
          else if (["pp", "ad"].includes(c.unite)) d.enfant = lu.prix_enfant;
        }
      }
      // Les textes déjà remplis au catalogue ne changent pas : seuls les champs vides prennent ce que la brochure imprime.
      const neufs = detailsDepuisBrochure(lu, { langue, aujourdhui });
      for (const k of TEXTES) if (!d[k] && neufs[k]) d[k] = neufs[k];
      const changeDetails = JSON.stringify(d) !== JSON.stringify(c.details || {});
      if (!("prix_vente" in patch) && !changeDetails && !enfant && !avecNet) continue;
      // La remarque interne garde la trace de l'import, après ce qu'elle disait déjà.
      const prixTouche = "prix_vente" in patch || !!enfant || d.enfant !== (c.details || {}).enfant;
      if (changeDetails || prixTouche) d.note = [String((c.details && c.details.note) || "").trim(), `${prixTouche ? "Prix mis à jour" : "Complété"} depuis la brochure le ${dateFr(aujourdhui)}${lu.prix_texte ? ` (prix imprimé : « ${lu.prix_texte} »)` : ""}.`].filter(Boolean).join("\n");
      const valeurs = { ...patch, ...(JSON.stringify(d) !== JSON.stringify(c.details || {}) ? { details: d } : {}) };
      const n = netsDe(prestationsNets, "prestation_id", c.id);
      ops.push({
        genre: "prestation",
        action: "modifier",
        table: "prestations",
        id: c.id,
        cle: l.cle,
        libelle: c.libelle,
        valeurs: Object.keys(valeurs).length ? valeurs : null,
        enfant,
        nets: avecNet ? { table: "prestations_nets", cleParent: "prestation_id", valeurs: { net: lu.net_adulte ?? nombre(n && n.net), net_enfant: lu.net_enfant ?? nombre(n && n.net_enfant), note: (n && n.note) || "" } } : null,
      });
      continue;
    }
    // Trajet
    const fenetres = lu.periode_debut && lu.periode_fin ? [[lu.periode_debut, lu.periode_fin]] : [];
    if (!l.cible) {
      numero += 1;
      ops.push({
        genre: "trajet",
        action: "creer",
        table: "trajets",
        cle: l.cle,
        libelle: `${lu.de} → ${lu.vers}, ${lu.depart}`,
        valeurs: { partenaire_id: partenaireId, imprime: texteImprimeTrajet(lu), de: lu.de, vers: lu.vers, mode: lu.mode, depart: departTexte(lu.depart, lu.depart_precision), arrivee: arriveeTexte(lu.arrivee, lu.lendemain, lu.arrivee_precision), duree: lu.duree || dureeSure(lu), prix_adulte: lu.prix_adulte, prix_enfant: lu.prix_enfant, bebe: "", periode: lu.periode || (fenetres.length ? "" : PERIODE_TOUTE[1]), fenetres, actif: true, numero },
        enfant: null,
        nets: avecNet ? { table: "trajets_nets", cleParent: "trajet_id", valeurs: { net_adulte: lu.net_adulte, net_enfant: lu.net_enfant } } : null,
      });
      continue;
    }
    const c = l.cible;
    const patch = {};
    if (lu.prix_adulte !== null && lu.prix_adulte !== nombre(c.prix_adulte)) patch.prix_adulte = lu.prix_adulte;
    if (lu.prix_enfant !== null && lu.prix_enfant !== nombre(c.prix_enfant)) patch.prix_enfant = lu.prix_enfant;
    // L'arrivée s'écrit si le catalogue n'en a pas, ou s'il a la même heure sans dire qu'elle est le lendemain.
    const arrivee = arriveeTexte(lu.arrivee, lu.lendemain, lu.arrivee_precision);
    if (arrivee && (!c.arrivee || ((lu.lendemain || lu.arrivee_precision) && c.arrivee === lu.arrivee))) patch.arrivee = arrivee;
    if (!c.duree && (lu.duree || dureeSure(lu))) patch.duree = lu.duree || dureeSure(lu);
    if (!Object.keys(patch).length && !avecNet) continue;
    const n = netsDe(trajetsNets, "trajet_id", c.id);
    ops.push({
      genre: "trajet",
      action: "modifier",
      table: "trajets",
      id: c.id,
      cle: l.cle,
      libelle: `${c.de} → ${c.vers}, ${c.depart}`,
      valeurs: Object.keys(patch).length ? patch : null,
      enfant: null,
      nets: avecNet ? { table: "trajets_nets", cleParent: "trajet_id", valeurs: { net_adulte: lu.net_adulte ?? nombre(n && n.net_adulte), net_enfant: lu.net_enfant ?? nombre(n && n.net_enfant) } } : null,
    });
  }
  return ops;
}

// ---- Démonstration --------------------------------------------------------------------------------------------------------------------

// Réponse simulée de la fonction pour la démonstration (aucune brochure n'est lue) : tirée du catalogue du partenaire pour montrer les quatre
// statuts. Un tarif inchangé, un prix changé, un tarif nouveau, une ligne illisible, et un horaire de bateau s'il en a.
// Un nouveau partenaire (carte de l'onglet Assistant) : la brochure fictive d'un transporteur en minivan (brochure-demo.mjs), avec ses nets
// manuscrits, son scotch, ses arrivées du lendemain et ses lieux abrégés.
export function simulerBrochure({ partenaireId, prestations = [], trajets = [], nouveau = false }) {
  if (nouveau) return { ok: true, usage: "brochure", modele: "demo", brochure: brochureDemoTransport(), avertissements: [] };
  const siens = ciblesPossibles(partenaireId, prestations).filter((p) => p.actif !== false && nombre(p.prix_vente) !== null);
  const vide = { groupe: "", famille: "excursion", unite: "pp", prix_enfant: null, age_enfant: "", sur_demande: false, net_texte: "", net_adulte: null, net_enfant: null, horaires: "", duree: "", programme: "", inclus: "", conditions: "", parc: "", bateau: "", capacite: "", lisible: true, illisible: "" };
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  const tarifs = [];
  if (siens[0]) {
    const p = siens[0];
    tarifs.push({ ...vide, libelle: p.libelle_en || p.libelle, groupe: p.groupe || "", unite: p.unite || "pp", prix_adulte: Number(p.prix_vente), prix_texte: `Adult: ${fmt(p.prix_vente)}.-` });
  }
  if (siens[1]) {
    const p = siens[1];
    const neuf = Math.round((Number(p.prix_vente) * 1.1) / 100) * 100;
    tarifs.push({ ...vide, libelle: p.libelle_en || p.libelle, groupe: p.groupe || "", unite: p.unite || "pp", prix_adulte: neuf, prix_texte: `Adult: ${fmt(neuf)}.-` });
  }
  tarifs.push({ ...vide, libelle: "Sunset snorkelling trip", groupe: "Sunset trips", prix_adulte: 3900, prix_enfant: 2900, age_enfant: "4-11", prix_texte: "Adult: 3,900.- Child (4-11 yrs old): 2,900.-", horaires: "13:00 - 19:30", programme: "13:00 Hotel pick-up\n14:00 Boat departure\n18:30 Sunset on board", inclus: "Hotel transfers\nSnacks, soft drinks and fruit\nSnorkel equipment\nInsurance", conditions: "Programme and times approximate, they follow the tide and the weather." });
  tarifs.push({ ...vide, libelle: "Private longtail, full day", unite: "boat", prix_adulte: null, prix_texte: "", lisible: false, illisible: "Prix caché par un pli de la brochure." });
  const sesTrajets = trajets.filter((t) => t.partenaire_id === partenaireId && t.actif !== false && t.depart);
  const lignesTrajets = [];
  if (sesTrajets[0]) {
    const t = sesTrajets[0];
    const vide2 = { mode: t.mode || "", arrivee: t.arrivee || "", duree: t.duree || "", periode: "", periode_debut: "", periode_fin: "", net_texte: "", net_adulte: null, net_enfant: null, lisible: true, illisible: "" };
    lignesTrajets.push({ ...vide2, de: t.de, vers: t.vers, depart: t.depart, prix_adulte: nombre(t.prix_adulte), prix_enfant: nombre(t.prix_enfant), prix_texte: [t.prix_adulte, t.prix_enfant].filter((x) => nombre(x) !== null).map((x) => fmt(x)).join(" / ") });
    const [h, m] = t.depart.split(":").map(Number);
    const plusTard = `${String((h + 3) % 24).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
    lignesTrajets.push({ ...vide2, arrivee: "", de: t.de, vers: t.vers, depart: plusTard, prix_adulte: nombre(t.prix_adulte), prix_enfant: nombre(t.prix_enfant), prix_texte: [t.prix_adulte, t.prix_enfant].filter((x) => nombre(x) !== null).map((x) => fmt(x)).join(" / ") });
  }
  const contacts = { telephones: [], emails: [], web: "", line: "", adresse: "", personne: "" };
  return { ok: true, usage: "brochure", modele: "demo", brochure: { partenaire_lu: nouveau ? "Partenaire de démonstration" : "", contacts, devise: "THB", tarifs, trajets: lignesTrajets, remarques: "Démonstration : aucune brochure n'a été lue, ces lignes sont tirées du catalogue." }, avertissements: [] };
}

// Le nom imprimé sur la brochure ressemble-t-il à celui du partenaire ? Faux seulement quand aucun mot ne se retrouve : l'écran prévient alors
// qu'il s'agit peut-être de la brochure d'un autre partenaire. Sans nom imprimé, rien à dire.
export function memePartenaire(nomLu, nomPartenaire) {
  const lu = motsCles(nomLu);
  if (!lu.size) return true;
  const sien = motsCles(nomPartenaire);
  return [...lu].some((m) => sien.has(m));
}

// ---- Fiche du nouveau partenaire ----------------------------------------------------------------------------------------------------------

// Un nom imprimé tout en capitales s'écrit en casse normale : « LANTA DEMO TRANSPORT CO., LTD. » → « Lanta Demo Transport Co., Ltd. ».
// Les sigles restent en capitales (connus, ou 2 à 4 lettres sans voyelle). Un nom qui a déjà des minuscules ne change pas.
const SIGLES = new Set(["VIP", "ATV", "BKK", "KL", "TAT", "SUP", "THB", "KBV", "HKT", "USA", "UK", "II", "III", "IV"]);
export function casseNormale(nom) {
  const t = String(nom || "").replace(/\s+/g, " ").trim();
  if (!t || /\p{Ll}/u.test(t)) return t;
  // Un sigle reste en capitales : connu (SIGLES), ou de 2 à 4 lettres sans voyelle (« PP », « BKK », « TRG ») : « PP CRUISER » → « PP Cruiser ».
  return t.replace(/\p{Lu}+/gu, (m) => (m === "LTD" ? "Ltd" : SIGLES.has(m) || (m.length >= 2 && m.length <= 4 && !/[AEIOUY]/.test(m)) ? m : m[0] + m.slice(1).toLowerCase()));
}

// Groupe et catégorie d'un nouveau partenaire, d'après ce que la brochure vend : des bus et des minivans font un transporteur (« transport »,
// « Land transfers and taxis »), des ferries et des speedboats une compagnie de bateaux. La catégorie reprend d'abord une valeur déjà en base :
// la catégorie par défaut si elle y est écrite telle quelle, sinon la plus fréquente des partenaires du même groupe. Rien de déduit : « autre ».
export const CATEGORIES_PAR_DEFAUT = { transport: "Land transfers and taxis", mer: "Ferries and speedboats", location: "Rentals", activite: "Activities" };
export function categorieDeduite(brochure, partenaires = []) {
  const b = brochure || {};
  const modes = (b.trajets || []).map((t) => modeTrajet(t));
  const route = modes.filter((m) => m === "route" || m === "mixte").length;
  const eau = modes.filter((m) => m === "bateau").length;
  const familles = (b.tarifs || []).map((t) => t.famille);
  const plus = (f) => familles.filter((x) => x === f).length;
  let groupe = "autre";
  if (route || eau) groupe = route >= eau ? "transport" : "mer";
  else if (familles.length) {
    const [f] = ["transfert", "location", "activite", "excursion"].map((f) => [f, plus(f)]).sort((x, y) => y[1] - x[1])[0];
    groupe = { transfert: "transport", location: "location", activite: "activite", excursion: (b.tarifs || []).some((t) => t.bateau) ? "mer" : "autre" }[f];
  }
  const defaut = groupe === "mer" && !(b.trajets || []).length ? "" : CATEGORIES_PAR_DEFAUT[groupe] || "";
  const existantes = partenaires.map((p) => String(p.categorie || "").trim()).filter(Boolean);
  if (defaut && existantes.includes(defaut)) return { groupe, categorie: defaut };
  const compte = new Map();
  for (const p of partenaires) if (p.groupe === groupe && p.categorie && p.categorie !== "apporteur") compte.set(p.categorie, (compte.get(p.categorie) || 0) + 1);
  const frequente = [...compte].sort((x, y) => y[1] - x[1])[0];
  return { groupe, categorie: groupe === "autre" ? "" : frequente ? frequente[0] : defaut };
}

// La fiche d'un partenaire créé depuis sa brochure : nom en casse normale, nom thaï, catégorie et groupe, lieu de départ, numéros avec leur
// libellé et leurs cases WhatsApp et LINE, tels qu'imprimés. Le formulaire habituel s'ouvre avec, rien n'est créé sans « Enregistrer ».
export function fichePartenaireDepuisBrochure(brochure, partenaires = []) {
  const b = brochure || {};
  const c = b.contacts || {};
  const { groupe, categorie } = categorieDeduite(b, partenaires);
  const telephones = (c.telephones || []).map((t) => (typeof t === "string" ? { numero: t, libelle: "", whatsapp: false, line: false } : { numero: t.numero || "", libelle: t.libelle || "", whatsapp: !!t.whatsapp, line: !!t.line })).filter((t) => t.numero);
  return {
    nom: casseNormale(b.partenaire_lu),
    nom_thai: String(b.partenaire_thai || "").trim(),
    categorie,
    groupe,
    contact: { personne: c.personne || "", telephones, emails: c.emails || [], line: c.line || "", web: c.web || "", adresse: c.adresse || "", embarcadere: String(b.lieu_depart || "").trim() },
  };
}

// Une brochure sans ses nets, pour qui n'a pas le droit « prix nets » (revues du 24.11.2026) : nets vidés, colonnes de net retirées, et plus
// aucun texte imprimé brut. La ligne imprimée est remplacée par un texte reconstruit des seuls champs utiles (lieux et type imprimés, heures,
// prix de vente : texteSurLigne), jamais par la ligne recopiée : une colonne de net mal étiquetée (« autre ») n'y passe donc pas. Une raison,
// une remarque ou un motif d'illisibilité qui parle d'un net ou cite un chiffre (hors heures) est retiré. La même fonction existe côté outil
// (brochure-calc.mjs) ; un test vérifie qu'elles rendent la même chose.
const MOTS_NET = /\bnets?\b|\bagent\b|\bcost\b|\bcommission|เก็บ|ราคาทุน|ราคาเอเย่นต์/i;
const sansChiffre = (t) => (typeof t === "string" && t && !MOTS_NET.test(t) && !/\d/.test(t.replace(/\b\d{1,2}[:.h]\d{2}\b/g, "")) ? t : "");
const montantsVente = (l) => [l.prix_adulte, l.prix_enfant].filter((x) => typeof x === "number" && x > 0).map((x) => x.toLocaleString("en-US")).join(" / ");
// Le texte imprimé sûr d'une ligne, reconstruit champ par champ : ce qui s'écrit en base (trajets.imprime) et ce qui se montre sans le droit.
export function texteSurLigne(l) {
  const x = l || {};
  const heure = (h, p) => [h, p].filter(Boolean).join(" ");
  const morceaux = "de" in x || "vers" in x
    ? [[x.de_imprime || x.de, x.vers_imprime || x.vers].filter(Boolean).join(" → "), x.mode, heure(x.depart, x.depart_precision), heure(x.arrivee, x.arrivee_precision), montantsVente(x)]
    : [x.libelle, montantsVente(x)];
  return morceaux.map((m) => String(m || "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ").slice(0, 400);
}
export function masquerNets(brochure) {
  const b = brochure || {};
  const colonnes = Array.isArray(b.colonnes) ? b.colonnes : [];
  const ligne = (l) => ({ ...l, imprime: texteSurLigne(l), prix_texte: montantsVente(l), raison: sansChiffre(l.raison), relecture_raison: sansChiffre(l.relecture_raison), illisible: sansChiffre(l.illisible) || (l.lisible === false ? "Ligne à compléter." : ""), net_texte: "", net_adulte: null, net_enfant: null, net_source: "", net_cache: false, net_superieur: false, net_a_saisir: false });
  return { ...b, colonnes: colonnes.filter((c) => c && c.contenu !== "net" && c.contenu !== "net_enfant" && !MOTS_NET.test(c.entete || "")), tarifs: (b.tarifs || []).map(ligne), trajets: (b.trajets || []).map(ligne), remarques: sansChiffre(b.remarques) };
}
