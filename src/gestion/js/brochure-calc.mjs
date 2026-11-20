// « Importer une brochure », côté outil : la logique pure (sans écran). La fonction « assistant » (usage « brochure ») rend ce qui est imprimé
// sur la brochure ; ici on le compare au catalogue du partenaire (nouveau, prix changé, inchangé, illisible) puis on prépare les écritures des
// lignes cochées. Rien ne s'écrit sans la personne : l'écran (views/brochure.mjs) montre chaque ligne et n'enregistre que ce qu'elle garde.
//
// Règles de Jérémy : la brochure fait foi pour les prix de vente ; le net n'est jamais déduit (il ne s'écrit que s'il est imprimé et que la
// personne a le droit « prix nets ») ; une ligne illisible est signalée et ne s'enregistre pas.
import { sansAccents, PERIODE_TOUTE } from "./partenaires-calc.mjs";
import { prestationEnfantSeparee, prixEnfantDe } from "./demande-calc.mjs";
import { assistantActif } from "./assistant-calc.mjs";

export const DROITS_BROCHURE = ["partenaires.lire", "partenaires.ecrire", "partenaires.prix"];
export const brochureDisponible = (regl, permissions = []) => assistantActif(regl) && DROITS_BROCHURE.every((p) => permissions.includes(p));

// ---- Rapprochement avec le catalogue ------------------------------------------------------------------------------------------------------

// Mots qui ne distinguent pas deux programmes (« Koh », « trip », « small group »…). Pluriels ramenés au singulier.
const VIDES = new Set(["the", "and", "with", "by", "of", "to", "for", "in", "on", "de", "du", "des", "la", "le", "les", "et", "en", "au", "aux", "a", "un", "une", "koh", "ko", "trip", "tour", "small", "group", "groupe", "island", "ile", "iles", "excursion", "pp", "per", "person", "par", "personne", "adult", "adulte"]);
const cle = (s) => sansAccents(s).replace(/[^a-z0-9]+/g, " ").trim();
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

const cleTrajet = (t) => `${cle(t.de)}|${cle(t.vers)}|${t.depart || ""}`;

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

// Coché d'office : une ligne nouvelle (lisible) et un prix changé sur un tarif reconnu sans doute. Un rapprochement « probable » attend que la
// personne vérifie que c'est bien ce tarif. Une ligne illisible ne se coche pas.
export const cocheParDefaut = (ligne) => ligne.statut === "nouveau" || (ligne.statut === "prix_change" && ligne.confiance !== "probable");

// Toutes les lignes de la brochure face au catalogue du partenaire. Rend { tarifs, trajets, absents } ; chaque ligne garde ce qui a été lu
// (`lu`), son tarif ou trajet du catalogue (`cible`), son statut, et un identifiant stable (`cle`) pour l'écran.
export function comparerBrochure(brochure, { partenaireId, prestations = [], trajets = [] }) {
  const cibles = ciblesPossibles(partenaireId, prestations);
  const deja = new Set();
  const tarifs = (brochure.tarifs || []).map((lu, i) => {
    const r = lu.lisible ? rapprocherTarif(lu, cibles.filter((p) => !deja.has(p.id))) : { cible: null, confiance: "", score: 0 };
    if (r.cible) deja.add(r.cible.id);
    const c = comparerTarif(lu, r.cible, prestations);
    const ligne = { cle: `t${i}`, genre: "prestation", lu, cible: r.cible, confiance: r.confiance, proche: r.proche || null, libelle: lu.libelle, ...c };
    return { ...ligne, coche: cocheParDefaut(ligne) };
  });
  const sesTrajets = trajets.filter((t) => t.partenaire_id === partenaireId);
  const dejaT = new Set();
  const lignesTrajets = (brochure.trajets || []).map((lu, i) => {
    const cible = lu.lisible ? sesTrajets.find((t) => !dejaT.has(t.id) && cleTrajet(t) === cleTrajet(lu)) || null : null;
    if (cible) dejaT.add(cible.id);
    const c = comparerTrajet(lu, cible);
    const ligne = { cle: `j${i}`, genre: "trajet", lu, cible, confiance: cible ? "sure" : "", ...c };
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
const noteImport = (lu, aujourdhui) => `Importé de la brochure le ${dateFr(aujourdhui)}${lu.prix_texte ? ` (prix imprimé : « ${lu.prix_texte} »)` : ""}.`;

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
// `enfant` : la ligne enfant séparée d'un ancien tarif à mettre à jour. `nets` : seulement si `droitNets` et un net imprimé (jamais déduit) ;
// il complète la ligne de nets existante sans effacer l'autre valeur. Une ligne cochée qui ne change rien ne donne aucune opération.
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
        valeurs: { partenaire_id: partenaireId, de: lu.de, vers: lu.vers, mode: lu.mode, depart: lu.depart, arrivee: lu.arrivee, duree: lu.duree, prix_adulte: lu.prix_adulte, prix_enfant: lu.prix_enfant, bebe: "", periode: lu.periode || (fenetres.length ? "" : PERIODE_TOUTE[1]), fenetres, actif: true, numero },
        enfant: null,
        nets: avecNet ? { table: "trajets_nets", cleParent: "trajet_id", valeurs: { net_adulte: lu.net_adulte, net_enfant: lu.net_enfant } } : null,
      });
      continue;
    }
    const c = l.cible;
    const patch = {};
    if (lu.prix_adulte !== null && lu.prix_adulte !== nombre(c.prix_adulte)) patch.prix_adulte = lu.prix_adulte;
    if (lu.prix_enfant !== null && lu.prix_enfant !== nombre(c.prix_enfant)) patch.prix_enfant = lu.prix_enfant;
    if (!c.arrivee && lu.arrivee) patch.arrivee = lu.arrivee;
    if (!c.duree && lu.duree) patch.duree = lu.duree;
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
export function simulerBrochure({ partenaireId, prestations = [], trajets = [] }) {
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
  return { ok: true, usage: "brochure", modele: "demo", brochure: { partenaire_lu: "", devise: "THB", tarifs, trajets: lignesTrajets, remarques: "Démonstration : aucune brochure n'a été lue, ces lignes sont tirées du catalogue." }, avertissements: [] };
}

// Le nom imprimé sur la brochure ressemble-t-il à celui du partenaire ? Faux seulement quand aucun mot ne se retrouve : l'écran prévient alors
// qu'il s'agit peut-être de la brochure d'un autre partenaire. Sans nom imprimé, rien à dire.
export function memePartenaire(nomLu, nomPartenaire) {
  const lu = motsCles(nomLu);
  if (!lu.size) return true;
  const sien = motsCles(nomPartenaire);
  return [...lu].some((m) => sien.has(m));
}
