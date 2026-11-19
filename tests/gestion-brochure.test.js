// « Importer une brochure » (20.11.2026) : droits, fichiers, prompt, contrôle de ce que Claude rend (réponses simulées, aucun appel réel),
// comparaison au catalogue du partenaire et écritures préparées. Deux cas réels faits à la main la semaine du 17.11.2026 servent de référence :
// la brochure Rattana « Lazy Day Sunset Trip » (3 900 / 2 900 ฿) et la sortie privée de Maryz (OctopuSea, prix sur demande).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODELE_BROCHURE,
  USAGE_BROCHURE,
  controlerAccesBrochure,
  verifierFichiers,
  promptBrochure,
  parametresBrochure,
  SCHEMA_BROCHURE,
  nombresDuTexte,
  validerBrochure,
  MAX_FICHIERS,
} from "../supabase/functions/assistant/brochure.js";
import { BETA_REPLI, ligneJournal } from "../supabase/functions/assistant/calc.js";
import { brochureDisponible, comparerBrochure, changerCible, compter, planBrochure, phraseAgeEnfant, simulerBrochure, rapprocherTarif, ciblesPossibles } from "../src/gestion/js/brochure-calc.mjs";
import { venteDuTarif } from "../src/gestion/js/demande-calc.mjs";

const SECRET = "00000000-0000-4000-8000-000000000002";
const RATTANA = "3bd7a35f-9860-574e-ac21-95a9e71c1f98";
const MARYZ = "4c1f0a2e-0000-4000-8000-0000000000aa";
const AJD = "2026-11-20";
const ADMIN = ["partenaires.lire", "partenaires.ecrire", "partenaires.prix", "partenaires.nets", "dossiers.ecrire"];
// Le rôle de Mook chez Secret : il modifie les fiches, pas les prix de vente (donnees-mook-secret-prix.sql).
const MOOK = ["partenaires.lire", "partenaires.ecrire", "dossiers.lire", "dossiers.ecrire"];
const ALLUME = { assistant_ia: true };

// Ce que Claude rend pour les deux images de la brochure (~/Desktop/Claude Plugins/brochures/rattana-lazy-day-2026-11-17/) : deux programmes,
// adulte et enfant sur la même ligne. La brochure n'imprime aucun frais de parc : « parc » reste vide (le SQL fait à la main l'avait recopié
// des autres sorties, l'import ne le fait pas).
const vide = { groupe: "", famille: "excursion", unite: "pp", prix_enfant: null, age_enfant: "", sur_demande: false, net_texte: "", net_adulte: null, net_enfant: null, horaires: "", duree: "", programme: "", inclus: "", conditions: "", parc: "", bateau: "", capacite: "", lisible: true, illisible: "" };
const INCLUS = "From / to the hotel free transfer\nLunch / Soft drinks & Wine / Fruit\nSnorkel equipment\nExperienced Local Guide\nEnglish / Chinese Speaking Guide\nInsurance";
const LAZY_DAY = {
  partenaire_lu: "Rattana Island Tour",
  devise: "THB",
  tarifs: [
    { ...vide, libelle: "Phi Phi Bamboo Island + Sunset", groupe: "Lazy Day Tour Sunset Trip", prix_texte: "Adult: 3,900.- Child (4-11 yrs old): 2,900.-", prix_adulte: 3900, prix_enfant: 2900, age_enfant: "4-11", horaires: "08:30 - 18:30/20:00", programme: "08.30 Pick-up from your hotel to Hua-Hin Pier by VIP van\n10.00 Boat departure\n13.50 Bamboo Island, Thai buffet lunch\n17.50 Departure back to Koh Lanta, sunset with soft drinks\n18.30 - 20.00 VIP transfer back to your hotel", inclus: INCLUS, conditions: "The program and timing are approximate and may be modified without notice to fit the tide and local weather conditions.", bateau: "Speedboat Aquaman\nHua Hin Pier", capacite: "Small group" },
    { ...vide, libelle: "Rok Haa Island + Sunset", groupe: "Lazy Day Tour Sunset Trip", prix_texte: "Adult: 3900.- Child (4-11 yrs old): 2,900.-", prix_adulte: 3900, prix_enfant: 2900, age_enfant: "4-11", horaires: "08:30 - 18:30/20:00", programme: "08.30 Pick-up from your hotel to Hua-Hin Pier by VIP van\n12.00 Arrive at Koh Rok\n16.30 Koh Rok to Koh Ha\n17.50 Return to Koh Lanta\n18.30 - 20.00 VIP transfer back to your hotel", inclus: INCLUS, conditions: "The program and timing are approximate and may be modified without notice to fit the tide and local weather conditions.", bateau: "Speedboat Aquaman\nHua Hin Pier", capacite: "Small group" },
  ],
  trajets: [],
  remarques: "",
};

// Catalogue Rattana avant le 17.11.2026 (fictif pour le test) : une sortie Phi Phi classique et une ligne enfant séparée.
const AVANT = [
  { id: "r1", partenaire_id: RATTANA, actif: true, famille: "excursion", groupe: "Speedboat day trips", libelle: "Phi Phi Islands + Bamboo Island (Speedboat)", libelle_en: "Phi Phi Islands + Bamboo Island", prix_vente: 2500, unite: "pp", details: {} },
  { id: "r2", partenaire_id: RATTANA, actif: true, famille: "excursion", groupe: "Speedboat day trips", libelle: "Phi Phi Islands + Bamboo Island (Speedboat), child", libelle_en: "", prix_vente: 1800, unite: "ch", details: {} },
  { id: "r3", partenaire_id: RATTANA, actif: true, famille: "excursion", groupe: "Speedboat day trips", libelle: "4 Islands by speedboat", libelle_en: "", prix_vente: 1900, unite: "pp", details: { horaires: "08:30 - 16:30" } },
  { id: "x1", partenaire_id: "autre", actif: true, famille: "excursion", groupe: "Lazy Day Tour Sunset Trip", libelle: "Phi Phi Bamboo Island + Sunset", libelle_en: "", prix_vente: 1000, unite: "pp", details: {} },
];
// Les quatre lignes écrites à la main le 17.11.2026 (lazy-day-gestion.sql) : deux tarifs adulte, deux tarifs enfant séparés.
const LIGNES_MAIN = [
  { id: "ld1", partenaire_id: RATTANA, actif: true, famille: "excursion", groupe: "Lazy Day sunset trips (small group)", libelle: "Lazy Day Sunset Trip Koh Phi Phi + Bamboo Island", libelle_en: "Lazy Day Sunset Trip Koh Phi Phi + Bamboo Island", prix_vente: 3900, unite: "pp", details: { horaires: "08h30 - 18h30/20h00", conditions: "Brochure price 3,900 ฿ (Lazy Day Tour, 17.11.2026)." } },
  { id: "ld2", partenaire_id: RATTANA, actif: true, famille: "excursion", groupe: "Lazy Day sunset trips (small group)", libelle: "Lazy Day Sunset Trip Koh Phi Phi + Bamboo Island, child (4-11)", libelle_en: "Lazy Day Sunset Trip Koh Phi Phi + Bamboo Island, child (4-11)", prix_vente: 2900, unite: "ch", details: {} },
  { id: "ld3", partenaire_id: RATTANA, actif: true, famille: "excursion", groupe: "Lazy Day sunset trips (small group)", libelle: "Lazy Day Sunset Trip Koh Rok + Koh Haa", libelle_en: "Lazy Day Sunset Trip Koh Rok + Koh Haa", prix_vente: 3900, unite: "pp", details: { horaires: "08h30 - 18h30/20h00" } },
  { id: "ld4", partenaire_id: RATTANA, actif: true, famille: "excursion", groupe: "Lazy Day sunset trips (small group)", libelle: "Lazy Day Sunset Trip Koh Rok + Koh Haa, child (4-11)", libelle_en: "Lazy Day Sunset Trip Koh Rok + Koh Haa, child (4-11)", prix_vente: 2900, unite: "ch", details: {} },
];

const lire = (v) => {
  const r = validerBrochure(structuredClone(v));
  assert.equal(r.ok, true);
  return r;
};

// ---- Fonction : droits, fichiers, prompt ---------------------------------------------------------------------------------------------------

test("droits : l'administratrice et qui a « Modifier les prix de vente » ; Mook non ; assistant éteint ou limite atteinte refusés", () => {
  const base = { entiteId: SECRET, reglages: ALLUME, appelsDuJour: 0, limite: 40 };
  assert.deepEqual(controlerAccesBrochure({ ...base, permissions: ADMIN }), { ok: true });
  const mook = controlerAccesBrochure({ ...base, permissions: MOOK });
  assert.equal(mook.erreur, "droit_manquant");
  assert.deepEqual(mook.manque, ["partenaires.prix"]);
  assert.equal(controlerAccesBrochure({ ...base, permissions: ADMIN, reglages: { assistant_ia: false } }).erreur, "assistant_eteint");
  assert.equal(controlerAccesBrochure({ ...base, permissions: ADMIN, reglages: null }).erreur, "pas_membre");
  assert.equal(controlerAccesBrochure({ ...base, permissions: ADMIN, appelsDuJour: 40 }).erreur, "limite_du_jour");
  assert.deepEqual(USAGE_BROCHURE.permissions, ["partenaires.lire", "partenaires.ecrire", "partenaires.prix"]);
  // Côté outil : le bouton suit les mêmes droits.
  assert.equal(brochureDisponible(ALLUME, ADMIN), true);
  assert.equal(brochureDisponible(ALLUME, MOOK), false);
  assert.equal(brochureDisponible({ assistant_ia: false }, ADMIN), false);
});

test("fichiers : images et PDF reconnus à leur signature, pas plus de six, pas plus de 10 Mo", () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
  const ok = verifierFichiers([{ media_type: "image/jpeg", data: jpeg.toString("base64") }, { media_type: "application/pdf", data: "JVBERi0xLjQKJ" + "A".repeat(20) }]);
  assert.equal(ok.ok, true);
  assert.equal(ok.fichiers.length, 2);
  assert.equal(verifierFichiers([]).erreur, "fichiers_absents");
  assert.equal(verifierFichiers([{ media_type: "image/gif", data: "R0lGOD" }]).erreur, "fichier_type");
  assert.equal(verifierFichiers([{ media_type: "image/png", data: "/9j/4AAQ" }]).erreur, "fichier_illisible", "un JPEG annoncé PNG");
  assert.equal(verifierFichiers([{ media_type: "image/jpeg", data: "/9j/<script>" }]).erreur, "fichier_illisible");
  assert.equal(verifierFichiers(Array.from({ length: MAX_FICHIERS + 1 }, () => ({ media_type: "image/jpeg", data: "/9j/AAAA" }))).erreur, "trop_de_fichiers");
  assert.equal(verifierFichiers([{ media_type: "image/jpeg", data: "/9j/" + "A".repeat(7_100_000) }]).erreur, "fichier_trop_lourd");
  assert.equal(verifierFichiers([{ media_type: "application/pdf", data: "JVBERi0" + "A".repeat(14_000_000) }]).erreur, "fichier_trop_lourd");
});

test("prompt : les fichiers puis la consigne, rien du catalogue ; Opus 5.5 avec repli, sortie JSON imposée", () => {
  const p = promptBrochure({ fichiers: [{ media_type: "image/jpeg", data: "/9j/AAAA" }, { media_type: "application/pdf", data: "JVBERi0AAAA" }], aujourdhui: AJD, lieu: "Koh Lanta (Thaïlande)" });
  const contenu = p.messages[0].content;
  assert.deepEqual(contenu.map((b) => b.type), ["image", "document", "text"]);
  assert.equal(contenu[1].source.media_type, "application/pdf");
  assert.match(contenu[2].text, /2026-11-20 \(vendredi\)/);
  const tout = JSON.stringify(p);
  for (const interdit of ["prix_vente", "prestations_nets", "Rattana", "marge"]) assert.ok(!tout.includes(interdit), interdit);
  assert.match(p.system[0].text, /Ne devine jamais un chiffre/);
  assert.match(p.system[0].text, /Ne déduis jamais un net/);
  const params = parametresBrochure(p);
  assert.equal(params.model, MODELE_BROCHURE);
  assert.equal(MODELE_BROCHURE, "claude-opus-5-5");
  assert.deepEqual(params.betas, [BETA_REPLI]);
  assert.equal(params.fallbacks, "default");
  assert.equal(params.output_config.effort, "medium");
  assert.equal(params.output_config.format.schema, SCHEMA_BROCHURE);
  assert.ok(!("thinking" in params) && !("temperature" in params));
  // Le schéma ne porte que des contraintes acceptées par les sorties structurées.
  const s = JSON.stringify(SCHEMA_BROCHURE);
  for (const c of ["minimum", "maximum", "minLength", "maxLength", "maxItems"]) assert.ok(!s.includes(c), c);
  // Le journal compte un appel Opus 5.5 à son prix.
  const j = ligneJournal({ userId: "u", entiteId: SECRET, usage: "brochure", statut: "ok", message: { model: "claude-opus-5-5", usage: { input_tokens: 10_000, output_tokens: 3_000 } }, dureeMs: 30_000 });
  assert.equal(j.cout_estime_usd, 0.1);
});

test("nombres imprimés : séparateurs de milliers, décimales, intervalles", () => {
  assert.deepEqual(nombresDuTexte("Adult: 3,900.- Child (4-11 yrs old): 2,900.-"), [3900, 4, 11, 2900]);
  assert.deepEqual(nombresDuTexte("1.200 ฿ / 2 900 THB / 450.50"), [1200, 2900, 450.5]);
  assert.deepEqual(nombresDuTexte("3900 2900"), [3900, 2900]);
  // Deux prix en colonnes : une espace après plus de trois chiffres ne sépare pas des milliers.
  assert.deepEqual(nombresDuTexte("1500 900"), [1500, 900]);
  assert.deepEqual(nombresDuTexte("1,500 900"), [1500, 900]);
  assert.deepEqual(nombresDuTexte("12 500 000"), [12500000]);
  assert.deepEqual(nombresDuTexte(""), []);
});

// ---- Contrôle de la réponse --------------------------------------------------------------------------------------------------------------

test("Lazy Day : deux programmes lus, 3 900 / 2 900, enfant de 4 à 11 ans, aucun frais de parc inventé", () => {
  const { brochure, avertissements } = lire(LAZY_DAY);
  assert.deepEqual(avertissements, []);
  assert.equal(brochure.devise, "THB");
  assert.equal(brochure.tarifs.length, 2);
  for (const t of brochure.tarifs) {
    assert.equal(t.prix_adulte, 3900);
    assert.equal(t.prix_enfant, 2900);
    assert.equal(t.age_enfant, "4-11");
    assert.equal(t.parc, "");
    assert.equal(t.lisible, true);
    assert.equal(t.net_adulte, null);
  }
  assert.match(brochure.tarifs[0].programme, /\n13\.50 Bamboo Island/);
});

test("un prix absent des mots imprimés rend la ligne illisible ; un net non imprimé est retiré, jamais déduit", () => {
  const v = structuredClone(LAZY_DAY);
  v.tarifs[0].prix_adulte = 4200; // le texte imprimé dit 3,900
  v.tarifs[1].net_adulte = 3100; // aucun mot « net » imprimé
  const { brochure, avertissements } = lire(v);
  assert.equal(brochure.tarifs[0].lisible, false);
  assert.equal(brochure.tarifs[0].prix_adulte, null);
  assert.equal(brochure.tarifs[0].prix_enfant, null);
  assert.match(brochure.tarifs[0].illisible, /absent du texte imprimé/);
  assert.equal(brochure.tarifs[1].net_adulte, null);
  assert.deepEqual(avertissements, ["prix_non_imprime:Phi Phi Bamboo Island + Sunset", "net_retire:Rok Haa Island + Sunset"]);
  // Un net vraiment imprimé (« Agent rate ») est gardé tel quel.
  const w = structuredClone(LAZY_DAY);
  Object.assign(w.tarifs[0], { net_texte: "Agent rate: adult 3,100 / child 2,300", net_adulte: 3100, net_enfant: 2300 });
  const r = lire(w);
  assert.equal(r.brochure.tarifs[0].net_adulte, 3100);
  assert.equal(r.brochure.tarifs[0].net_enfant, 2300);
});

test("ligne marquée illisible par Claude : ses prix ne passent pas ; ligne sans nom retirée ; heure de départ invalide signalée", () => {
  const v = structuredClone(LAZY_DAY);
  Object.assign(v.tarifs[1], { lisible: false, illisible: "Prix enfant caché par un pli", prix_enfant: null });
  v.tarifs.push({ ...vide, libelle: "  ", prix_texte: "1,000", prix_adulte: 1000 });
  v.trajets.push({ de: "Koh Lanta", vers: "Koh Lipe", mode: "Speedboat", depart: "8h", arrivee: "", duree: "", periode: "", periode_debut: "", periode_fin: "", prix_texte: "1,900 / 1,400", prix_adulte: 1900, prix_enfant: 1400, net_texte: "", net_adulte: null, net_enfant: null, lisible: true, illisible: "" });
  const { brochure, avertissements } = lire(v);
  assert.equal(brochure.tarifs.length, 2);
  assert.equal(brochure.tarifs[1].lisible, false);
  assert.equal(brochure.tarifs[1].illisible, "Prix enfant caché par un pli");
  assert.equal(brochure.trajets[0].lisible, false);
  assert.match(brochure.trajets[0].illisible, /Heure de départ/);
  assert.ok(avertissements.includes("ligne_sans_nom"));
  assert.equal(validerBrochure({ tarifs: [], trajets: [] }).ok, false);
  assert.equal(validerBrochure(null).ok, false);
});

// ---- Comparaison au catalogue et écritures -------------------------------------------------------------------------------------------

test("Lazy Day avant l'import : deux tarifs nouveaux cochés, la sortie Phi Phi classique n'est pas prise pour eux", () => {
  const { brochure } = lire(LAZY_DAY);
  const c = comparerBrochure(brochure, { partenaireId: RATTANA, prestations: AVANT, trajets: [] });
  assert.deepEqual(c.tarifs.map((l) => [l.statut, l.coche, l.cible && l.cible.id]), [["nouveau", true, null], ["nouveau", true, null]]);
  // Le tarif d'un autre partenaire au même nom n'est jamais visé.
  assert.ok(!c.tarifs.some((l) => l.cible && l.cible.partenaire_id !== RATTANA));
  assert.deepEqual(compter(c.tarifs), { nouveau: 2, prix_change: 0, inchange: 0, illisible: 0 });
  assert.deepEqual(c.absents.map((x) => x.id), ["r1", "r3"]);
});

test("Lazy Day : les tarifs créés vendent comme les quatre lignes faites à la main (2 adultes et 1 enfant : 10 700 ฿)", () => {
  const { brochure } = lire(LAZY_DAY);
  const c = comparerBrochure(brochure, { partenaireId: RATTANA, prestations: AVANT, trajets: [] });
  const ops = planBrochure(c.tarifs, { partenaireId: RATTANA, prestations: AVANT, droitNets: true, langue: "en", aujourdhui: AJD, ordreMax: 22 });
  assert.equal(ops.length, 2);
  const [phi, rok] = ops;
  assert.equal(phi.action, "creer");
  assert.equal(phi.nets, null, "aucun net imprimé : rien n'est écrit dans les nets");
  assert.deepEqual(
    { ...phi.valeurs, details: undefined },
    { partenaire_id: RATTANA, famille: "excursion", groupe: "Lazy Day Tour Sunset Trip", libelle: "Phi Phi Bamboo Island + Sunset", libelle_en: "Phi Phi Bamboo Island + Sunset", prix_vente: 3900, unite: "pp", sur_place: false, actif: true, ordre: 23, details: undefined }
  );
  assert.equal(rok.valeurs.ordre, 24);
  const d = phi.valeurs.details;
  assert.equal(d.enfant, 2900);
  assert.equal(d.horaires, "08:30 - 18:30/20:00");
  assert.equal(d.parc, undefined, "pas de frais de parc imprimé, pas de champ");
  assert.match(d.inclus, /^• 08\.30 Pick-up/);
  assert.match(d.inclus, /• Insurance$/);
  assert.match(d.conditions, /approximate[\s\S]*\nChild price: 4 to 11 years old\.$/);
  assert.equal(d.note, "Importé de la brochure le 20.11.2026 (prix imprimé : « Adult: 3,900.- Child (4-11 yrs old): 2,900.- »).");
  const cree = { id: "n1", ...phi.valeurs };
  const pax = { adultes: 2, enfants: 1 };
  assert.equal(venteDuTarif({ prestation: cree, ...pax, prestations: [cree] }), 10700);
  assert.equal(venteDuTarif({ prestation: LIGNES_MAIN[0], ...pax, prestations: LIGNES_MAIN }), 10700);
});

test("Lazy Day après l'import fait à la main : tout est inchangé (prix enfant lu sur la ligne enfant séparée), rien à écrire", () => {
  const { brochure } = lire(LAZY_DAY);
  const catalogue = [...AVANT, ...LIGNES_MAIN];
  const c = comparerBrochure(brochure, { partenaireId: RATTANA, prestations: catalogue, trajets: [] });
  assert.deepEqual(c.tarifs.map((l) => [l.statut, l.confiance, l.cible.id, l.coche]), [["inchange", "sure", "ld1", false], ["inchange", "sure", "ld3", false]]);
  assert.deepEqual(planBrochure(c.tarifs, { partenaireId: RATTANA, prestations: catalogue, aujourdhui: AJD }), []);
  // Cochée quand même : seuls les champs vides se complètent (durée, inclus, bateau…), les textes déjà remplis restent.
  const ops = planBrochure(c.tarifs.map((l) => ({ ...l, coche: true })), { partenaireId: RATTANA, prestations: catalogue, aujourdhui: AJD });
  assert.equal(ops[0].action, "modifier");
  assert.equal(ops[0].valeurs.prix_vente, undefined);
  assert.equal(ops[0].valeurs.details.horaires, "08h30 - 18h30/20h00");
  assert.equal(ops[0].valeurs.details.conditions, "Brochure price 3,900 ฿ (Lazy Day Tour, 17.11.2026).");
  assert.match(ops[0].valeurs.details.inclus, /Snorkel equipment/);
  assert.match(ops[0].valeurs.details.note, /^Complété depuis la brochure le 20\.11\.2026/);
});

test("nouvelle brochure à 4 200 / 3 000 : prix changés cochés, le tarif adulte et sa ligne enfant séparée sont mis à jour", () => {
  const v = structuredClone(LAZY_DAY);
  for (const t of v.tarifs) Object.assign(t, { prix_texte: "Adult: 4,200.- Child (4-11 yrs old): 3,000.-", prix_adulte: 4200, prix_enfant: 3000 });
  const { brochure } = lire(v);
  const catalogue = [...AVANT, ...LIGNES_MAIN];
  const c = comparerBrochure(brochure, { partenaireId: RATTANA, prestations: catalogue, trajets: [] });
  assert.deepEqual(c.tarifs[0].ecarts, [{ champ: "prix_adulte", avant: 3900, apres: 4200 }, { champ: "prix_enfant", avant: 2900, apres: 3000 }]);
  assert.equal(c.tarifs[0].statut, "prix_change");
  assert.equal(c.tarifs[0].coche, true);
  const ops = planBrochure(c.tarifs, { partenaireId: RATTANA, prestations: catalogue, aujourdhui: AJD });
  assert.deepEqual(ops.map((o) => [o.action, o.id, o.valeurs.prix_vente, o.enfant && o.enfant.id, o.enfant && o.enfant.valeurs.prix_vente]), [["modifier", "ld1", 4200, "ld2", 3000], ["modifier", "ld3", 4200, "ld4", 3000]]);
  assert.match(ops[0].valeurs.details.note, /^Prix mis à jour depuis la brochure le 20\.11\.2026 \(prix imprimé : « Adult: 4,200\.-/);
  // Un tarif qui porte son prix enfant sur sa fiche le garde là.
  const fiche = [{ ...LIGNES_MAIN[0], details: { enfant: 2900 } }];
  const c2 = comparerBrochure(brochure, { partenaireId: RATTANA, prestations: fiche, trajets: [] });
  const [op] = planBrochure([c2.tarifs[0]], { partenaireId: RATTANA, prestations: fiche, aujourdhui: AJD });
  assert.equal(op.enfant, null);
  assert.equal(op.valeurs.details.enfant, 3000);
});

test("rapprochement seulement probable : prix changé non coché d'office ; choisir un autre tarif recalcule le statut", () => {
  const cible = { id: "p9", partenaire_id: RATTANA, actif: true, famille: "excursion", groupe: "Sunset", libelle: "Lazy Day Phi Phi Bamboo Sunset cruise", prix_vente: 3500, unite: "pp", details: {} };
  const { brochure } = lire(LAZY_DAY);
  const r = rapprocherTarif(brochure.tarifs[0], ciblesPossibles(RATTANA, [cible]));
  assert.equal(r.confiance, "probable");
  const c = comparerBrochure(brochure, { partenaireId: RATTANA, prestations: [cible], trajets: [] });
  assert.equal(c.tarifs[0].statut, "prix_change");
  assert.equal(c.tarifs[0].coche, false);
  const neuf = changerCible(c.tarifs[0], null, [cible]);
  assert.deepEqual([neuf.statut, neuf.coche, neuf.cible], ["nouveau", true, null]);
  const choisi = changerCible(neuf, cible, [cible]);
  assert.deepEqual([choisi.statut, choisi.confiance, choisi.coche], ["prix_change", "sure", true]);
});

test("Maryz (OctopuSea) : prix sur demande, tarif par groupe sans prix, frais de parc imprimés repris tels quels", () => {
  const { brochure } = lire({
    partenaire_lu: "OctopuSea",
    devise: "THB",
    tarifs: [{ ...vide, libelle: "Private speedboat, custom day", unite: "grp", sur_demande: true, prix_texte: "Price on request", prix_adulte: 25000, horaires: "Departure time of your choice, back at 16:00 at the latest", capacite: "20 passengers plus crew", bateau: "Speedboat OctopuSea\n2 Yamaha 200 engines", inclus: "Hotel-to-pier transfers (round trip)\nFull snorkelling equipment and life jackets\nLunch, fresh fruit, water and soft drinks", parc: "Marine park fee: 200 ฿ per snorkeler, paid separately" }],
    trajets: [],
    remarques: "",
  });
  const t = brochure.tarifs[0];
  assert.equal(t.prix_adulte, null, "sur demande : aucun prix, même si Claude en rendait un");
  const c = comparerBrochure(brochure, { partenaireId: MARYZ, prestations: [], trajets: [] });
  assert.equal(c.tarifs[0].statut, "nouveau");
  const [op] = planBrochure(c.tarifs, { partenaireId: MARYZ, aujourdhui: AJD, droitNets: true });
  assert.equal(op.valeurs.prix_vente, null);
  assert.equal(op.valeurs.unite, "grp");
  assert.equal(op.valeurs.details.enfant, undefined);
  assert.equal(op.valeurs.details.parc, "Marine park fee: 200 ฿ per snorkeler, paid separately");
  assert.equal(op.valeurs.details.capacite, "20 passengers plus crew");
  assert.match(op.valeurs.details.conditions, /^Price on request\.$/);
  assert.equal(op.nets, null);
});

test("nets : écrits seulement s'ils sont imprimés et avec le droit « prix nets » ; l'autre valeur existante est gardée", () => {
  const w = structuredClone(LAZY_DAY);
  Object.assign(w.tarifs[0], { net_texte: "Agent rate: adult 3,100", net_adulte: 3100 });
  const { brochure } = lire(w);
  const c = comparerBrochure(brochure, { partenaireId: RATTANA, prestations: LIGNES_MAIN, trajets: [] });
  const lignes = c.tarifs.map((l) => ({ ...l, coche: true }));
  const sansDroit = planBrochure(lignes, { partenaireId: RATTANA, prestations: LIGNES_MAIN, droitNets: false, aujourdhui: AJD });
  assert.ok(sansDroit.every((o) => o.nets === null));
  const avecDroit = planBrochure(lignes, { partenaireId: RATTANA, prestations: LIGNES_MAIN, prestationsNets: [{ prestation_id: "ld1", net: 3000, net_enfant: 2200, note: "contrat 2026" }], droitNets: true, aujourdhui: AJD });
  assert.deepEqual(avecDroit[0].nets, { table: "prestations_nets", cleParent: "prestation_id", valeurs: { net: 3100, net_enfant: 2200, note: "contrat 2026" } });
  assert.equal(avecDroit[1].nets, null, "le Rok n'a pas de net imprimé");
});

test("une ligne illisible ne s'écrit jamais, même cochée", () => {
  const v = structuredClone(LAZY_DAY);
  Object.assign(v.tarifs[0], { lisible: false, illisible: "Prix flou", prix_adulte: null, prix_enfant: null });
  const { brochure } = lire(v);
  const c = comparerBrochure(brochure, { partenaireId: RATTANA, prestations: AVANT, trajets: [] });
  assert.deepEqual([c.tarifs[0].statut, c.tarifs[0].coche], ["illisible", false]);
  const ops = planBrochure(c.tarifs.map((l) => ({ ...l, coche: true })), { partenaireId: RATTANA, prestations: AVANT, aujourdhui: AJD });
  assert.deepEqual(ops.map((o) => o.libelle), ["Rok Haa Island + Sunset"]);
});

test("horaires de bateau : départ connu inchangé, nouveau départ créé avec sa période, prix changé mis à jour", () => {
  const trajets = [
    { id: "tj1", partenaire_id: RATTANA, actif: true, de: "Koh Lanta", vers: "Koh Lipe", mode: "Speedboat", depart: "08:00", arrivee: "11:30", duree: "", prix_adulte: 1900, prix_enfant: 1400, periode: "Whole contract period", fenetres: [] },
    { id: "tj2", partenaire_id: RATTANA, actif: true, de: "Koh Lanta", vers: "Phi Phi", mode: "Speedboat", depart: "09:00", arrivee: "", duree: "", prix_adulte: 1200, prix_enfant: 900, periode: "", fenetres: [] },
  ];
  const ligne = (de, vers, depart, ad, en, extra = {}) => ({ de, vers, mode: "Speedboat", depart, arrivee: "", duree: "", periode: "", periode_debut: "", periode_fin: "", prix_texte: `${ad.toLocaleString("en-US")} / ${en.toLocaleString("en-US")}`, prix_adulte: ad, prix_enfant: en, net_texte: "", net_adulte: null, net_enfant: null, lisible: true, illisible: "", ...extra });
  const { brochure } = lire({
    partenaire_lu: "",
    devise: "THB",
    tarifs: [],
    trajets: [ligne("Koh Lanta", "Koh Lipe", "08:00", 1900, 1400), ligne("Koh Lanta", "Koh Lipe", "13:30", 1900, 1400, { arrivee: "17:00", periode: "1 Nov 2026 - 30 Apr 2027", periode_debut: "2026-11-01", periode_fin: "2027-04-30" }), ligne("Koh Lanta", "Phi Phi", "09:00", 1300, 900, { duree: "1 h 30" })],
    remarques: "",
  });
  const c = comparerBrochure(brochure, { partenaireId: RATTANA, prestations: [], trajets });
  assert.deepEqual(c.trajets.map((l) => [l.statut, l.cible && l.cible.id, l.coche]), [["inchange", "tj1", false], ["nouveau", null, true], ["prix_change", "tj2", true]]);
  const ops = planBrochure(c.trajets, { partenaireId: RATTANA, aujourdhui: AJD, numeroMax: 40 });
  assert.deepEqual(ops[0].valeurs, { partenaire_id: RATTANA, de: "Koh Lanta", vers: "Koh Lipe", mode: "Speedboat", depart: "13:30", arrivee: "17:00", duree: "", prix_adulte: 1900, prix_enfant: 1400, bebe: "", periode: "1 Nov 2026 - 30 Apr 2027", fenetres: [["2026-11-01", "2027-04-30"]], actif: true, numero: 41 });
  assert.deepEqual([ops[1].action, ops[1].id, ops[1].valeurs], ["modifier", "tj2", { prix_adulte: 1300, duree: "1 h 30" }]);
});

test("phrase d'âge du prix enfant, en anglais (Secret, Taxi) ou en français (Zwald)", () => {
  assert.equal(phraseAgeEnfant("4-11", "en"), "Child price: 4 to 11 years old.");
  assert.equal(phraseAgeEnfant("4-11 yrs old", "fr"), "Prix enfant de 4 à 11 ans.");
  assert.equal(phraseAgeEnfant("under 12", "en"), "Child price: under 12.");
  assert.equal(phraseAgeEnfant("", "fr"), "");
});

test("démonstration : la réponse simulée montre inchangé, prix changé, nouveau et illisible, et passe le contrôle de la fonction", () => {
  const sim = simulerBrochure({ partenaireId: RATTANA, prestations: AVANT, trajets: [] });
  const r = validerBrochure(sim.brochure);
  assert.equal(r.ok, true);
  const c = comparerBrochure(r.brochure, { partenaireId: RATTANA, prestations: AVANT, trajets: [] });
  assert.deepEqual(c.tarifs.map((l) => l.statut), ["inchange", "prix_change", "nouveau", "illisible"]);
});

test("nom imprimé sur la brochure : un mot commun suffit, sinon l'écran prévient", async () => {
  const { memePartenaire } = await import("../src/gestion/js/brochure-calc.mjs");
  assert.equal(memePartenaire("Rattana Island Tour", "Rattana"), true);
  assert.equal(memePartenaire("OctopuSea", "Maryz (OctopuSea)"), true);
  assert.equal(memePartenaire("", "Rattana"), true);
  assert.equal(memePartenaire("Satun Pakbara Speedboat", "Rattana"), false);
});

test("prix enfant imprimé pour un tarif par bateau sans ligne enfant : montré en information, jamais compté comme un changement", () => {
  const bateau = { id: "b1", partenaire_id: RATTANA, actif: true, famille: "excursion", groupe: "", libelle: "Private longtail, full day", libelle_en: "", prix_vente: 6000, unite: "boat", details: {} };
  const { brochure } = lire({ partenaire_lu: "", devise: "THB", tarifs: [{ ...vide, libelle: "Private longtail, full day", unite: "boat", prix_texte: "6,000 per boat, child 500", prix_adulte: 6000, prix_enfant: 500 }], trajets: [], remarques: "" });
  const c = comparerBrochure(brochure, { partenaireId: RATTANA, prestations: [bateau], trajets: [] });
  assert.equal(c.tarifs[0].statut, "inchange");
  assert.deepEqual(c.tarifs[0].infos, [{ champ: "prix_enfant", avant: null, apres: 500 }]);
  assert.deepEqual(planBrochure(c.tarifs, { partenaireId: RATTANA, prestations: [bateau], aujourdhui: AJD }), []);
});
