// tests/gestion-brochure-fiable.test.js : import de brochure aussi fiable qu'une relecture humaine (24.11.2026).
// L'essai réel de Jérémy (brochure d'un transporteur en minivan, trois photos) avait des prix justes mais un import inutilisable : nets
// manquants, arrivées du lendemain non marquées, lieux abrégés, lignes lisibles rejetées, fiche partenaire incomplète. Ici, avec une brochure
// fictive qui reprend les mêmes cas (src/gestion/js/brochure-demo.mjs : scotch, manuscrit, lendemain, abréviations, ligne coupée) et aucune
// donnée réelle : normalisation des lieux, lendemain, règle « illisible », nets manuscrits et droit « prix nets », fiche partenaire,
// relecture, rendu Markdown sûr, et les chemins qui créent un partenaire ou un trajet depuis une brochure.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Un DOM minimal : de quoi rendre le voucher (même principe que gestion-numero-vol.test.js).
class Node {}
class Texte extends Node {
  constructor(t) {
    super();
    this.t = t;
  }
  get textContent() {
    return this.t;
  }
}
class El extends Node {
  constructor(tag) {
    super();
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.className = "";
  }
  append(...xs) {
    this.children.push(...xs);
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener() {}
  get textContent() {
    return this.children.map((c) => c.textContent).join("");
  }
  get lignes() {
    return ["p", "h1", "h2"].includes(this.tag) ? [this.textContent] : this.children.flatMap((c) => (c instanceof El ? c.lignes : []));
  }
}
globalThis.Node = Node;
globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => new Texte(t) };

const B = await import("../supabase/functions/assistant/brochure.js");
const C = await import("../src/gestion/js/brochure-calc.mjs");
const { brochureDemoTransport, relectureDemo } = await import("../src/gestion/js/brochure-demo.mjs");
const { modeTrajet } = await import("../src/gestion/js/operations-calc.mjs");
const { morceauxGras } = await import("../src/gestion/js/markdown-sur.mjs");
const { renderVoucher } = await import("../src/gestion/js/views/voucher.mjs");

const PART = "00000000-0000-4000-8000-0000000000d1";
const AUTRE = "00000000-0000-4000-8000-0000000000d2";
const AJD = "2026-11-24";
// Les trajets d'une autre compagnie de l'entreprise : leurs lieux servent de noms au catalogue (« Koh Lanta », « Krabi Airport »).
const CATALOGUE = [
  { id: "c1", partenaire_id: AUTRE, actif: true, de: "Koh Lanta", vers: "Krabi Airport", mode: "Minivan", depart: "09:00", arrivee: "11:30", duree: "2 h 30", prix_adulte: 500, prix_enfant: null, periode: "", fenetres: [] },
  { id: "c2", partenaire_id: AUTRE, actif: true, de: "Koh Lanta", vers: "Hat Yai", mode: "Minivan", depart: "07:00", arrivee: "12:00", duree: "5 h", prix_adulte: 700, prix_enfant: null, periode: "", fenetres: [] },
];
const lu = (v) => {
  const r = B.validerBrochure(v);
  assert.equal(r.ok, true);
  return r;
};
const demo = () => lu(brochureDemoTransport());

// ---- Lecture : modèle, effort, schéma, consigne ----------------------------------------------------------------------------------------

test("lecture : Opus 5.5 (réflexion adaptative par défaut), effort medium, 64 000 jetons ; relecture : effort high, son propre schéma", () => {
  const f = [{ media_type: "image/jpeg", data: "/9j/AAAA" }];
  const p1 = B.parametresBrochure(B.promptBrochure({ fichiers: f, aujourdhui: AJD }));
  assert.equal(p1.model, "claude-opus-5-5");
  assert.ok(!("thinking" in p1), "Opus 5.5 : omettre thinking vaut adaptive");
  assert.equal(p1.output_config.effort, "medium");
  assert.equal(p1.max_tokens, 64000);
  assert.ok(!("format" in p1.output_config), "plus de sortie structurée");
  const p2 = B.parametresBrochure(B.promptRelecture({ fichiers: f, aujourdhui: AJD, brochure: demo().brochure }), { passe: "relecture" });
  assert.equal(p2.output_config.effort, "high");
  assert.equal(p2.max_tokens, 32000);
  assert.ok(!("format" in p2.output_config), "plus de sortie structurée");
  assert.equal(p2.system[0].text, p1.system[0].text, "la même consigne pour les deux passes");
  assert.deepEqual(p2.messages[0].content.map((b) => b.type), ["image", "text"]);
  assert.match(p2.messages[0].content[1].text, /"index":0/);
  // Rien du catalogue ni de la base ne part : seulement les fichiers et ce que la première lecture en a tiré.
  for (const interdit of ["prix_vente", "prestations_nets", "trajets_nets", "partenaire_id"]) assert.ok(!JSON.stringify(p2).includes(interdit), interdit);
  assert.equal(B.delaiPasse(undefined), 135_000);
  assert.equal(B.delaiPasse("380000"), 380_000);
  assert.equal(B.delaiPasse("999999"), 135_000);
});

test("consigne : la liste de contrôle couvre colonnes, manuscrit, scotch, cases fusionnées, fautes d'impression, lendemain, lignes coupées, rien d'inventé", () => {
  const t = B.promptBrochure({ fichiers: [{ media_type: "image/jpeg", data: "/9j/AAAA" }], aujourdhui: AJD }).system[0].text;
  for (const motif of [/Colonnes\. Repère d'abord les en-têtes, dans toutes les langues/, /เก็บ/, /ราคาทุน/, /COST/, /second prix inférieur ou égal au prix de vente est une colonne de net/, /Manuscrit\./, /Scotch et caches\./, /Cases fusionnées\./, /12\.0 AM/, /Lendemain\./, /Lignes coupées\./, /Aucun fait inventé\./, /ne se devine pas/, /Jamais un net déduit/]) assert.match(t, motif);
  // Les abréviations données à Claude sont celles que l'outil applique.
  assert.deepEqual(B.ABREVIATIONS_PROMPT, C.ABREVIATIONS_LIEUX);
  for (const [a, b] of C.ABREVIATIONS_LIEUX) assert.ok(t.includes(`${a} pour ${b}`), a);
});

test("schéma : chaque ligne porte l'imprimé brut, la valeur normalisée, le net, la confiance et la raison ; seulement des contraintes acceptées", () => {
  const trajet = B.SCHEMA_BROCHURE.properties.trajets.items;
  for (const k of ["imprime", "de_imprime", "vers_imprime", "de", "vers", "depart", "arrivee", "lendemain", "net_adulte", "net_texte", "net_source", "net_cache", "prix_repris", "coupee", "confiance", "raison"]) assert.ok(trajet.required.includes(k), k);
  const tarif = B.SCHEMA_BROCHURE.properties.tarifs.items;
  for (const k of ["imprime", "net_adulte", "net_source", "net_cache", "confiance", "raison"]) assert.ok(tarif.required.includes(k), k);
  for (const k of ["partenaire_thai", "lieu_depart", "colonnes"]) assert.ok(B.SCHEMA_BROCHURE.required.includes(k), k);
  assert.deepEqual(B.SCHEMA_BROCHURE.properties.contacts.properties.telephones.items.required, ["numero", "libelle", "whatsapp", "line"]);
  for (const s of [B.SCHEMA_BROCHURE, B.SCHEMA_RELECTURE]) for (const c of ["minimum", "maximum", "minLength", "maxLength", "maxItems"]) assert.ok(!JSON.stringify(s).includes(c), c);
});

// ---- La brochure fictive passe le contrôle de la fonction telle quelle ---------------------------------------------------------------

test("brochure fictive : la forme rendue par la fonction, contrôlée deux fois sans changer", () => {
  const brut = brochureDemoTransport();
  const r = demo();
  assert.deepEqual(r.brochure.trajets, brut.trajets);
  assert.deepEqual(B.validerBrochure(r.brochure).brochure, r.brochure, "un second contrôle ne change rien (la relecture repart de là)");
  assert.deepEqual(r.avertissements, []);
  // Aucun vrai numéro ni vrai nom : des zéros et « démo ».
  assert.ok(r.brochure.contacts.telephones.every((t) => /000 ?0?1\d\d|000-01\d\d/.test(t.numero)));
  assert.match(r.brochure.partenaire_lu, /DEMO/);
});

// ---- Arrivée le lendemain --------------------------------------------------------------------------------------------------------------

test("lendemain : arrivée avant le départ ou trajet de nuit, durée calculée (22 h, 17 h), écrit « 06:00 (next day) »", () => {
  const base = brochureDemoTransport().trajets[0];
  const v = (x) => lu({ tarifs: [], trajets: [{ ...base, duree: "", lendemain: false, ...x }] }).brochure.trajets[0];
  assert.deepEqual([v({ depart: "08:00", arrivee: "06:00" }).lendemain, v({ depart: "08:00", arrivee: "06:00" }).duree], [true, "22 h"]);
  assert.deepEqual([v({ depart: "12:00", arrivee: "05:00" }).lendemain, v({ depart: "12:00", arrivee: "05:00" }).duree], [true, "17 h"]);
  assert.deepEqual([v({ depart: "08:00", arrivee: "12:30" }).lendemain, v({ depart: "08:00", arrivee: "12:30" }).duree], [false, "4 h 30"]);
  // Dit par la brochure : une arrivée plus tard que le départ, mais le lendemain (26 h).
  assert.deepEqual([v({ depart: "08:00", arrivee: "10:00", lendemain: true }).duree], ["26 h"]);
  // Une durée imprimée reste celle imprimée.
  assert.equal(v({ depart: "08:00", arrivee: "06:00", duree: "21 h 30" }).duree, "21 h 30");
  assert.equal(C.arriveeTexte("06:00", true), "06:00 (next day)");
  assert.equal(C.arriveeTexte("11:30", false), "11:30");
  assert.deepEqual(C.lireArrivee("06:00 (next day)"), { heure: "06:00", lendemain: true, autre: "" });
  assert.deepEqual(C.lireArrivee("6:00"), { heure: "06:00", lendemain: false, autre: "" });
  assert.deepEqual(C.lireArrivee("vers midi"), { heure: "", lendemain: false, autre: "vers midi" });
  assert.equal(C.dureeTrajet("12:00", "05:00", true), "17 h");
});

test("lendemain au catalogue : le nouveau trajet s'écrit « 06:00 (next day) » ; un trajet existant à 06:00 sans « next day » est complété", () => {
  const { brochure } = demo();
  const existant = { id: "e1", partenaire_id: PART, actif: true, de: "Koh Lanta", vers: "Bangkok (Khao San Road)", mode: "VIP Bus/Van", depart: "08:00", arrivee: "06:00", duree: "22 h", prix_adulte: 1650, prix_enfant: null, periode: "", fenetres: [] };
  const c = C.comparerBrochure({ ...brochure, trajets: brochure.trajets.slice(0, 2) }, { partenaireId: PART, trajets: [existant, ...CATALOGUE] });
  assert.equal(c.trajets[0].statut, "inchange");
  const ops = C.planBrochure(c.trajets.map((l) => ({ ...l, coche: true })), { partenaireId: PART, aujourdhui: AJD, numeroMax: 10 });
  const modif = ops.find((o) => o.id === "e1");
  assert.deepEqual(modif.valeurs, { arrivee: "06:00 (next day)" });
  const neuf = ops.find((o) => o.action === "creer");
  assert.equal(neuf.valeurs.arrivee, "13:00");
  const nuit = C.planBrochure(C.comparerBrochure({ ...brochure, trajets: [brochure.trajets[3]] }, { partenaireId: PART, trajets: CATALOGUE }).trajets, { partenaireId: PART, aujourdhui: AJD });
  assert.deepEqual([nuit[0].valeurs.arrivee, nuit[0].valeurs.duree], ["05:00 (next day)", "17 h"]);
});

test("voucher : le billet imprime « Arrival Time: 06:00 (next day) » ; la Booking confirmation d'un trajet par la route n'imprime pas d'arrivée fausse", () => {
  const REGL = { emetteur: { nom: "Agence test", adresse: "", telephone: "+66 00" }, apparence: {}, voucher: {}, devise: "THB" };
  const r = { id: "R1", dossier_id: "D1", entite_id: "E", libelle: "Koh Lanta → Bangkok (Khao San Road)", date_service: "2026-12-01", heure_pickup: "07:30", lieu_pickup: "Hotel Test", personnes: { adultes: 2, enfants: 0, bebes: 0 }, statut: "confirme", montant_vente: 3300, details: {} };
  const trajet = { de: "Koh Lanta", vers: "Bangkok (Khao San Road)", depart: "08:00", arrivee: "06:00 (next day)", mode: "VIP Bus/Van" };
  const rendu = (type, regl = REGL) => renderVoucher({ reservation: r, prestation: null, type, index: 1 }, { reglages: regl, dossier: { ref: "INV-2026-099" }, client: { prenom: "Test", nom: "Client" }, resume: { total: 3300, recu: 0 }, trajet }).lignes;
  const billet = rendu("billet");
  assert.ok(billet.some((l) => /Arrival Time: 06:00 \(next day\)/.test(l)), billet.join("\n"));
  for (const regl of [REGL, { ...REGL, fonctionnement: "taxi" }]) {
    const transfert = rendu("transfert", regl);
    assert.ok(!transfert.some((l) => /06:00/.test(l) && !/next day/.test(l)), transfert.join("\n"));
  }
});

// ---- Lieux --------------------------------------------------------------------------------------------------------------------------

test("lieux : le catalogue d'abord (« Lanta » → « Koh Lanta »), puis la table des abréviations, l'imprimé gardé à côté", () => {
  const lieux = C.lieuxDuCatalogue(CATALOGUE);
  const n = (imprime, suggestion = "") => C.normaliserLieu(imprime, { suggestion, lieux });
  assert.deepEqual(n("Lanta"), { nom: "Koh Lanta", imprime: "Lanta", source: "catalogue", a_verifier: false });
  assert.deepEqual(n("Krabi A/P"), { nom: "Krabi Airport", imprime: "Krabi A/P", source: "table", a_verifier: false });
  assert.equal(n("Hadyai").nom, "Hat Yai");
  assert.equal(n("Hadyai").source, "table");
  for (const [imprime, nom] of [["BKK", "Bangkok"], ["KL", "Kuala Lumpur"], ["Ipho", "Ipoh"], ["Phatthalang", "Phatthalung"], ["Kolok", "Sungai Kolok"], ["Khaosan (BKK)", "Bangkok (Khao San Road)"], ["BKK (Khaosan)", "Bangkok (Khao San Road)"], ["Hadyai A/P", "Hat Yai Airport"]]) {
    const r = n(imprime);
    assert.equal(r.nom, nom, imprime);
    assert.equal(r.a_verifier, false, imprime);
    assert.equal(r.imprime, imprime);
  }
  // Noms ambigus (revue du 24.11.2026) : proposés, jamais réécrits d'office, « à vérifier ».
  for (const [imprime, nom] of [["Nakon", "Nakhon Si Thammarat"], ["Nakhon", "Nakhon Si Thammarat"], ["Padang", "Padang Besar"]]) assert.deepEqual(n(imprime), { nom, imprime, source: "table", a_verifier: true }, imprime);
  // Sans catalogue, « Lanta » reste « Koh Lanta » par la table.
  assert.equal(C.normaliserLieu("Lanta").nom, "Koh Lanta");
});

test("lieux : un nom incertain est signalé « à vérifier », jamais inventé ; une ligne au lieu incertain n'est pas cochée d'office", () => {
  const lieux = C.lieuxDuCatalogue(CATALOGUE);
  assert.deepEqual(C.normaliserLieu("Krabi", { lieux }), { nom: "Krabi", imprime: "Krabi", source: "imprime", a_verifier: false });
  assert.deepEqual(C.normaliserLieu("TRG", { lieux }), { nom: "TRG", imprime: "TRG", source: "imprime", a_verifier: true });
  assert.deepEqual(C.normaliserLieu("Sk.", { suggestion: "Sikao", lieux }), { nom: "Sikao", imprime: "Sk.", source: "lecture", a_verifier: true });
  // Le nom proposé par la lecture est confirmé par le catalogue : plus rien à vérifier.
  // Une abréviation dans un nom plus long : seul le mot abrégé change.
  assert.deepEqual(C.normaliserLieu("Hadyai Bus Terminal", { suggestion: "Hat Yai", lieux }), { nom: "Hat Yai Bus Terminal", imprime: "Hadyai Bus Terminal", source: "table", a_verifier: false });
  assert.equal(C.normaliserLieu("HDY", { suggestion: "Hat Yai", lieux }).source, "catalogue");
  const { brochure } = demo();
  const ligne = { ...brochure.trajets[1], vers_imprime: "TRG", vers: "TRG" };
  const c = C.comparerBrochure({ ...brochure, trajets: [ligne] }, { partenaireId: PART, trajets: CATALOGUE });
  assert.deepEqual([c.trajets[0].statut, c.trajets[0].coche, C.signauxLigne(c.trajets[0])], ["nouveau", false, ["lieu_a_verifier"]]);
  // Le nom corrigé à la main dans l'écran : la ligne se coche.
  const corrigee = C.completerLigne(c.trajets[0], { vers: "Trang" }, { partenaireId: PART, trajets: CATALOGUE });
  assert.deepEqual([corrigee.lu.vers, corrigee.lieux.vers.source, corrigee.lieux.vers.imprime, corrigee.coche], ["Trang", "saisi", "TRG", true]);
});

test("type « Bus/Van » : un trajet par la route ; bus, van et speedboat : mixte", () => {
  assert.equal(modeTrajet({ mode: "VIP Bus/Van" }), "route");
  assert.equal(modeTrajet({ mode: "Bus/Van" }), "route");
  assert.equal(modeTrajet({ mode: "Van" }), "route");
  assert.equal(modeTrajet({ mode: "Bus" }), "route");
  assert.equal(modeTrajet({ mode: "Bus/Van + Speedboat" }), "mixte");
  assert.equal(modeTrajet({ mode: "Van + speedboat" }), "mixte");
});

// ---- Règle « illisible » ---------------------------------------------------------------------------------------------------------------

test("illisible : seulement un prix de vente ou un trajet qui ne se lit pas ; un net sous scotch laisse la ligne lisible, « net à saisir »", () => {
  const { brochure } = demo();
  const t = (vers, depart) => brochure.trajets.find((x) => x.vers === vers && (!depart || x.depart === depart));
  const scotchNet = t("Hat Yai", "12:00");
  assert.deepEqual([scotchNet.lisible, scotchNet.net_adulte, scotchNet.net_cache, scotchNet.net_a_saisir, scotchNet.prix_adulte, scotchNet.prix_repris], [true, null, true, true, 650, true]);
  const scotchPrix = t("Padang Besar");
  assert.deepEqual([scotchPrix.lisible, scotchPrix.prix_adulte, scotchPrix.illisible], [false, null, "Prix de vente caché par du scotch."]);
  // Claude marque « illisible » une ligne dont seul le net est caché : le prix et le trajet se lisent, la ligne reste lisible, en lecture douteuse.
  const r = lu({ tarifs: [], trajets: [{ ...scotchNet, lisible: false, illisible: "Net couvert par du scotch." }] }).brochure.trajets[0];
  assert.deepEqual([r.lisible, r.illisible, r.confiance], [true, "", "basse"]);
  // Un net rendu alors qu'il est marqué caché ne se garde pas.
  assert.equal(lu({ tarifs: [], trajets: [{ ...scotchNet, net_adulte: 500, net_texte: "500" }] }).brochure.trajets[0].net_adulte, null);
  // Sans lieu d'arrivée : illisible, gardée pour être complétée (jamais retirée).
  const sansLieu = lu({ tarifs: [], trajets: [{ ...scotchNet, vers: "", vers_imprime: "" }] }).brochure.trajets[0];
  assert.deepEqual([sansLieu.lisible, sansLieu.illisible], [false, "Trajet illisible : départ ou arrivée à saisir."]);
});

test("ligne coupée par le bord de la photo : lisible si ses valeurs se lisent ; retrouvée à la relecture", () => {
  const avant = demo().brochure;
  assert.ok(!avant.trajets.some((t) => t.vers_imprime === "Nakon"));
  const { brochure, relecture } = relectureDemo(avant);
  const r = lu(brochure);
  const nakon = r.brochure.trajets.find((t) => t.vers_imprime === "Nakon");
  assert.deepEqual([nakon.lisible, nakon.coupee, nakon.depart, nakon.arrivee, nakon.prix_adulte, nakon.net_adulte, nakon.relecture], [true, true, "08:00", "12:00", 750, 550, "ajoute"]);
  assert.deepEqual(relecture, { corriges: 0, signales: 0, ajoutes: 1, fiche: false });
});

test("ligne illisible complétée à la main dans l'écran : prix, net et heures saisis, elle s'enregistre", () => {
  const { brochure } = demo();
  const c = C.comparerBrochure(brochure, { partenaireId: PART, trajets: CATALOGUE });
  const padang = c.trajets.find((l) => l.lu.vers === "Padang Besar");
  assert.deepEqual([padang.statut, padang.coche], ["illisible", false]);
  assert.equal(C.planBrochure([{ ...padang, coche: true }], { partenaireId: PART, droitNets: true, aujourdhui: AJD }).length, 0, "une ligne illisible ne s'écrit jamais");
  // « Padang » est ambigu : tant que le lieu n'est pas confirmé, la ligne complétée n'est pas cochée.
  const sansLieu = C.completerLigne(padang, { prix_adulte: "1,050", net_adulte: "850", arrivee: "15:45" }, { partenaireId: PART, trajets: CATALOGUE });
  assert.deepEqual([sansLieu.statut, sansLieu.coche, C.signauxLigne(sansLieu)], ["nouveau", false, ["lieu_a_verifier"]]);
  const faite = C.completerLigne(sansLieu, { vers: "Padang Besar" }, { partenaireId: PART, trajets: CATALOGUE });
  assert.deepEqual([faite.statut, faite.coche, faite.lu.prix_adulte, faite.lu.net_adulte, faite.lu.net_source, faite.lu.duree], ["nouveau", true, 1050, 850, "saisi", "7 h 45"]);
  const [op] = C.planBrochure([faite], { partenaireId: PART, droitNets: true, aujourdhui: AJD, numeroMax: 3 });
  assert.deepEqual([op.action, op.valeurs.prix_adulte, op.valeurs.arrivee, op.valeurs.de, op.valeurs.vers, op.nets.valeurs], ["creer", 1050, "15:45", "Koh Lanta", "Padang Besar", { net_adulte: 850, net_enfant: null }]);
  // Le texte imprimé de la ligne reste en base avec le trajet (colonne « imprime », migration 127).
  assert.equal(op.valeurs.imprime, "Lanta → Padang | VIP Bus/Van | 08:00 | 15:45 | 1,050", "reconstruit des champs utiles, jamais la ligne recopiée");
  // Une saisie qui n'est pas un prix ne passe pas.
  assert.equal(C.completerLigne(padang, { prix_adulte: "abc" }, { partenaireId: PART, trajets: CATALOGUE }).statut, "illisible");
});

// ---- Nets ----------------------------------------------------------------------------------------------------------------------------

test("nets manuscrits (« เก็บ ») : lus comme nets, gardés s'ils figurent dans les chiffres relevés, jamais déduits", () => {
  const { brochure } = demo();
  const bkk = brochure.trajets[0];
  assert.deepEqual([bkk.net_adulte, bkk.net_source, bkk.net_texte], [1300, "manuscrit", "1,300"]);
  assert.ok(brochure.colonnes.some((c) => c.entete === "เก็บ" && c.contenu === "net" && c.manuscrit));
  // Un net qui ne se retrouve pas dans « net_texte » est retiré, comme avant : il n'est jamais déduit.
  const r = B.validerBrochure({ tarifs: [], trajets: [{ ...bkk, net_adulte: 1200 }] });
  assert.equal(r.brochure.trajets[0].net_adulte, null);
  assert.ok(r.avertissements.includes("net_retire:Koh Lanta → Bangkok (Khao San Road)"));
  // Un net au-dessus du prix de vente se garde mais se signale, et la ligne n'est pas cochée d'office.
  const haut = B.validerBrochure({ tarifs: [], trajets: [{ ...bkk, net_adulte: 1700, net_texte: "1,700" }] });
  assert.deepEqual([haut.brochure.trajets[0].net_adulte, haut.brochure.trajets[0].net_superieur], [1700, true]);
  const c = C.comparerBrochure(haut.brochure, { partenaireId: PART, trajets: CATALOGUE });
  assert.deepEqual([c.trajets[0].coche, C.signauxLigne(c.trajets[0])], [false, ["net_superieur"]]);
  // Tarifs : un net manuscrit sur un programme se garde aussi.
  const tarif = { imprime: "Sunset tour 1,500 / 1,100", libelle: "Sunset tour", groupe: "", famille: "excursion", unite: "pp", prix_texte: "1,500", prix_adulte: 1500, prix_enfant: null, age_enfant: "", sur_demande: false, net_texte: "1,100", net_adulte: 1100, net_enfant: null, net_source: "manuscrit", net_cache: false, horaires: "", duree: "", programme: "", inclus: "", conditions: "", parc: "", bateau: "", capacite: "", coupee: false, confiance: "haute", raison: "", lisible: true, illisible: "" };
  assert.deepEqual(lu({ tarifs: [tarif], trajets: [] }).brochure.tarifs[0].net_adulte, 1100);
});

test("nets écrits selon le droit « prix nets » : sans lui, aucune opération ne porte de net ; avec lui, le net de la brochure, l'autre valeur gardée", () => {
  const { brochure } = demo();
  const c = C.comparerBrochure(brochure, { partenaireId: PART, trajets: CATALOGUE });
  const sans = C.planBrochure(c.trajets, { partenaireId: PART, droitNets: false, aujourdhui: AJD });
  assert.ok(sans.length > 0 && !sans.some((o) => o.nets));
  const avec = C.planBrochure(c.trajets, { partenaireId: PART, droitNets: true, aujourdhui: AJD });
  const bkk = avec.find((o) => o.valeurs.vers === "Bangkok (Khao San Road)");
  assert.deepEqual(bkk.nets, { table: "trajets_nets", cleParent: "trajet_id", valeurs: { net_adulte: 1300, net_enfant: null } });
  // Le net caché sous le scotch : la ligne s'écrit, sans net.
  const scotch = avec.find((o) => o.valeurs.vers === "Hat Yai" && o.valeurs.depart === "12:00");
  assert.deepEqual([scotch.action, scotch.nets], ["creer", null]);
  // Trajet existant : le net enfant déjà au catalogue est gardé.
  const existant = { id: "e2", partenaire_id: PART, actif: true, de: "Koh Lanta", vers: "Hat Yai", mode: "VIP Bus/Van", depart: "08:00", arrivee: "13:00", duree: "5 h", prix_adulte: 650, prix_enfant: null, periode: "", fenetres: [] };
  const c2 = C.comparerBrochure({ ...brochure, trajets: [brochure.trajets[1]] }, { partenaireId: PART, trajets: [existant] });
  const [op] = C.planBrochure(c2.trajets.map((l) => ({ ...l, coche: true })), { partenaireId: PART, droitNets: true, trajetsNets: [{ trajet_id: "e2", net_adulte: 480, net_enfant: 300 }], aujourdhui: AJD });
  assert.deepEqual([op.action, op.valeurs, op.nets.valeurs], ["modifier", null, { net_adulte: 500, net_enfant: 300 }]);
});

// ---- Relecture ---------------------------------------------------------------------------------------------------------------------

test("relecture : une correction remplace sa ligne, une ligne signalée passe en confiance basse, une ligne oubliée s'ajoute, un index inconnu s'ignore", () => {
  const premiere = demo().brochure;
  const ipoh = { ...premiere.trajets[4], depart: "12:30", raison: "« 12.0 AM » relu 12:30." };
  const rel = {
    trajets: [
      { index: 4, statut: "corrige", raison: "Départ « 12.0 AM » : midi.", ligne: ipoh },
      { index: 6, statut: "signale", raison: "Le 3 de 350 peut être un 8.", ligne: premiere.trajets[6] },
      { index: 99, statut: "corrige", raison: "?", ligne: premiere.trajets[0] },
      { index: -1, statut: "ajoute", raison: "Ligne oubliée.", ligne: { ...premiere.trajets[1], vers: "Trang", vers_imprime: "Trang", depart: "10:00", arrivee: "12:30", duree: "", note: "" } },
    ],
    tarifs: [],
    fiche_corrigee: true,
    fiche: { partenaire_lu: premiere.partenaire_lu, partenaire_thai: premiere.partenaire_thai, lieu_depart: "Saladan office (main road)", contacts: premiere.contacts },
    remarques: "",
  };
  const f = B.fusionnerRelecture(premiere, rel);
  assert.deepEqual(f.compte, { corriges: 1, signales: 1, ajoutes: 1, fiche: true });
  const r = lu(f.brut);
  assert.equal(r.brochure.relue, true);
  assert.deepEqual([r.brochure.trajets[4].relecture, r.brochure.trajets[4].relecture_raison], ["corrige", "Départ « 12.0 AM » : midi."]);
  assert.deepEqual([r.brochure.trajets[6].relecture, r.brochure.trajets[6].confiance], ["signale", "basse"]);
  assert.equal(r.brochure.trajets.length, premiere.trajets.length + 1);
  assert.deepEqual([r.brochure.trajets.at(-1).relecture, r.brochure.trajets.at(-1).duree], ["ajoute", "2 h 30"]);
  assert.equal(r.brochure.lieu_depart, "Saladan office (main road)");
  // L'écran : la ligne signalée n'est pas cochée d'office, la corrigée et l'ajoutée le sont.
  const c = C.comparerBrochure(r.brochure, { partenaireId: PART, trajets: CATALOGUE });
  assert.deepEqual([c.trajets[4].coche, c.trajets[6].coche, c.trajets.at(-1).coche], [true, false, true]);
  // La première lecture renvoyée par le navigateur est contrôlée : trop grosse ou mal formée, refusée.
  assert.equal(B.verifierExtraction(null).ok, false);
  assert.equal(B.verifierExtraction({ ...premiere, remarques: "x".repeat(B.MAX_EXTRACTION) }).ok, false);
  assert.equal(B.verifierExtraction(premiere).ok, true);
});

// ---- Fiche du nouveau partenaire ----------------------------------------------------------------------------------------------------

test("fiche partenaire : nom en casse normale, nom thaï, catégorie et groupe déduits, lieu de départ, libellés et cases WhatsApp et LINE", () => {
  assert.equal(C.casseNormale("KOH DEMO TRANSPORT CO., LTD."), "Koh Demo Transport Co., Ltd.");
  assert.equal(C.casseNormale("VIP DEMO VAN"), "VIP Demo Van");
  assert.equal(C.casseNormale("Demo Tours"), "Demo Tours", "déjà en casse normale : inchangé");
  const { brochure } = demo();
  // En base, la catégorie « Land transfers and taxis » existe : elle est reprise telle quelle.
  const enBase = [{ categorie: "Land transfers and taxis", groupe: "transport" }, { categorie: "Excursions bateaux", groupe: "mer" }];
  const f = C.fichePartenaireDepuisBrochure(brochure, enBase);
  assert.deepEqual(f, {
    nom: "Koh Demo Transport Co., Ltd.",
    nom_thai: "บริษัท เกาะเดโม ทรานสปอร์ต จำกัด",
    categorie: "Land transfers and taxis",
    groupe: "transport",
    contact: {
      personne: "",
      telephones: [
        { numero: "+66 81 000 0101", libelle: "Office", whatsapp: true, line: false },
        { numero: "081-000-0102", libelle: "Booking", whatsapp: false, line: true },
      ],
      emails: ["booking@demo-transport.test"],
      line: "@demotransport",
      web: "",
      adresse: "",
      embarcadere: "Saladan office",
    },
  });
  // Sans la catégorie par défaut en base : la plus fréquente du même groupe ; sans rien en base, la catégorie par défaut.
  assert.equal(C.categorieDeduite(brochure, [{ categorie: "Transferts terrestres et taxis", groupe: "transport" }, { categorie: "Transferts terrestres et taxis", groupe: "transport" }, { categorie: "Taxis", groupe: "transport" }]).categorie, "Transferts terrestres et taxis");
  assert.deepEqual(C.categorieDeduite(brochure, []), { groupe: "transport", categorie: "Land transfers and taxis" });
  // Des speedboats : une compagnie de bateaux.
  assert.equal(C.categorieDeduite({ trajets: [{ mode: "Speedboat" }, { mode: "Ferry" }] }).groupe, "mer");
  // Rien de lisible pour décider : « autre », sans catégorie.
  assert.deepEqual(C.categorieDeduite({ tarifs: [], trajets: [] }), { groupe: "autre", categorie: "" });
  // Contacts : libellé et cases gardés, un numéro trop court retiré.
  const ct = B.validerContacts({ telephones: [{ numero: "081-000-0102", libelle: "Booking", whatsapp: false, line: true }, { numero: "12 34", libelle: "", whatsapp: true, line: false }] });
  assert.deepEqual(ct.telephones, [{ numero: "081-000-0102", libelle: "Booking", whatsapp: false, line: true }]);
});

// ---- Les chemins qui créent un partenaire ou un trajet depuis une brochure ---------------------------------------------------------------

test("nouveau partenaire : rien ne s'écrit avant sa création, puis tous les trajets lisibles se créent chez lui", () => {
  const sim = C.simulerBrochure({ partenaireId: null, nouveau: true });
  const { brochure } = lu(sim.brochure);
  const avant = C.comparerBrochure(brochure, { partenaireId: null, trajets: CATALOGUE });
  assert.ok(avant.trajets.every((l) => !l.cible), "aucun trajet d'une autre compagnie n'est pris pour le sien");
  const apres = C.comparerBrochure(brochure, { partenaireId: "nouveau", trajets: CATALOGUE });
  const ops = C.planBrochure([...apres.tarifs, ...apres.trajets], { partenaireId: "nouveau", droitNets: true, aujourdhui: AJD, numeroMax: 7 });
  const lisibles = brochure.trajets.filter((t) => t.lisible).length;
  assert.equal(ops.length, lisibles);
  assert.ok(ops.every((o) => o.action === "creer" && o.table === "trajets" && o.valeurs.partenaire_id === "nouveau"));
  assert.deepEqual(ops.map((o) => o.valeurs.numero), Array.from({ length: lisibles }, (_, i) => 8 + i));
  // Les lieux au nom usuel, l'imprimé n'est pas écrit au catalogue.
  assert.deepEqual([...new Set(ops.map((o) => o.valeurs.de))], ["Koh Lanta"]);
  assert.ok(ops.some((o) => o.valeurs.vers === "Krabi Airport") && ops.some((o) => o.valeurs.vers === "Kuala Lumpur"));
  assert.ok(!ops.some((o) => /A\/P|^KL$|Hadyai|Ipho/.test(o.valeurs.vers)));
  // Les trajets de nuit arrivent « (next day) ».
  assert.deepEqual(ops.filter((o) => /next day/.test(o.valeurs.arrivee)).map((o) => o.valeurs.vers), ["Bangkok (Khao San Road)", "Kuala Lumpur", "Bangkok"]);
});

test("partenaire existant : trajet déjà au catalogue inchangé, prix changé mis à jour, nouveau départ créé", () => {
  const { brochure } = demo();
  const siens = [
    { id: "s1", partenaire_id: PART, actif: true, de: "Koh Lanta", vers: "Hat Yai", mode: "VIP Bus/Van", depart: "08:00", arrivee: "13:00", duree: "5 h", prix_adulte: 650, prix_enfant: null, periode: "", fenetres: [] },
    { id: "s2", partenaire_id: PART, actif: true, de: "Koh Lanta", vers: "Kuala Lumpur", mode: "VIP Bus/Van", depart: "12:00", arrivee: "05:00 (next day)", duree: "17 h", prix_adulte: 1850, prix_enfant: null, periode: "", fenetres: [] },
    { id: "s3", partenaire_id: PART, actif: true, de: "Koh Lanta", vers: "Trang", mode: "VIP Bus/Van", depart: "09:00", arrivee: "11:00", duree: "2 h", prix_adulte: 300, prix_enfant: null, periode: "", fenetres: [] },
  ];
  const c = C.comparerBrochure(brochure, { partenaireId: PART, trajets: [...siens, ...CATALOGUE] });
  const par = (vers, depart) => c.trajets.find((l) => l.lu.vers === vers && l.lu.depart === depart);
  assert.deepEqual([par("Hat Yai", "08:00").statut, par("Hat Yai", "08:00").cible.id], ["inchange", "s1"]);
  assert.deepEqual([par("Kuala Lumpur", "12:00").statut, par("Kuala Lumpur", "12:00").ecarts], ["prix_change", [{ champ: "prix_adulte", avant: 1850, apres: 1950 }]]);
  assert.equal(par("Hat Yai", "12:00").statut, "nouveau");
  assert.deepEqual(c.absents.map((x) => x.id), ["s3"], "le trajet absent de la brochure est listé, rien n'y change");
  const ops = C.planBrochure(c.trajets, { partenaireId: PART, aujourdhui: AJD });
  assert.deepEqual(ops.find((o) => o.id === "s2").valeurs, { prix_adulte: 1950 });
  assert.ok(!ops.some((o) => o.id === "s1"), "la ligne inchangée et non cochée ne donne rien");
});

test("titre de la section : « Horaires et trajets » pour des bus et des minivans, « Horaires de bateau » pour des bateaux seuls", () => {
  const src = readFileSync(new URL("../src/gestion/js/views/brochure.mjs", import.meta.url), "utf8");
  assert.match(src, /N_\("Horaires et trajets"\)/);
  assert.match(src, /every\(\(l\) => modeTrajet\(l\.lu\) === "bateau"\)/);
  assert.ok(!/section\(N_\("Horaires de bateau"\), comp\.trajets\)/.test(src), "plus de titre « bateau » fixe");
  assert.match(src, /un net s'écrit s'il figure sur la brochure, imprimé ou écrit à la main/);
  // Une ligne par transaction, par la fonction de la base (migration 124).
  assert.match(src, /await ecrireLigneBrochure\(op\)/);
  assert.ok(!/enregistrerLie/.test(src));
});

// ---- Rendu Markdown sûr ------------------------------------------------------------------------------------------------------------

test("gras Markdown des messages de l'Assistant : « **…** » en gras, jamais de HTML interprété", () => {
  assert.deepEqual(morceauxGras("La carte est **prête** : touchez **Lire et comparer**."), [
    { texte: "La carte est ", gras: false },
    { texte: "prête", gras: true },
    { texte: " : touchez ", gras: false },
    { texte: "Lire et comparer", gras: true },
    { texte: ".", gras: false },
  ]);
  assert.deepEqual(morceauxGras("**<img src=x onerror=alert(1)>**"), [{ texte: "<img src=x onerror=alert(1)>", gras: true }], "le HTML reste du texte");
  assert.deepEqual(morceauxGras("2 ** 3 et ** seul"), [{ texte: "2 ** 3 et ** seul", gras: false }]);
  assert.deepEqual(morceauxGras("**ouvert\nsur deux lignes**"), [{ texte: "**ouvert\nsur deux lignes**", gras: false }]);
  assert.deepEqual(morceauxGras(""), []);
  // L'écran pose chaque morceau en nœud de texte (dans un <strong> pour le gras), jamais par innerHTML.
  const src = readFileSync(new URL("../src/gestion/js/views/agent.mjs", import.meta.url), "utf8");
  assert.match(src, /morceauxGras\(t\)\.map\(\(g\) => \(g\.gras \? h\("strong", null, g\.texte\) : g\.texte\)\)/);
  assert.ok(!/innerHTML/.test(src));
});


// ---- Revue du 24.11.2026 ------------------------------------------------------------------------------------------------------------

test("corriger seulement le lieu d'une ligne douteuse ne lève pas le doute sur son prix ; saisir le prix, oui", () => {
  const { brochure } = demo();
  const douteuse = { ...brochure.trajets[1], vers_imprime: "TRG", vers: "TRG", confiance: "basse" };
  const [l] = C.comparerBrochure({ ...brochure, trajets: [douteuse] }, { partenaireId: PART, trajets: CATALOGUE }).trajets;
  const lieu = C.completerLigne(l, { vers: "Trang" }, { partenaireId: PART, trajets: CATALOGUE });
  assert.deepEqual([lieu.lu.confiance, lieu.coche, C.signauxLigne(lieu)], ["basse", false, ["confiance_basse"]]);
  const prix = C.completerLigne(lieu, { prix_adulte: "650" }, { partenaireId: PART, trajets: CATALOGUE });
  assert.deepEqual([prix.lu.confiance, prix.coche], ["haute", true]);
});

test("arrivée du lendemain lue ailleurs : « À vérifier » compte 26 h, l'Assistant et la réponse d'itinéraire disent le lendemain", async () => {
  const { ecartDuree } = await import("../src/gestion/js/a-verifier-calc.mjs");
  assert.equal(ecartDuree({ depart: "08:00", arrivee: "10:00 (next day)", duree: "26 h" }), 0);
  assert.equal(ecartDuree({ depart: "08:00", arrivee: "06:00 (next day)", duree: "22 h" }), 0);
  assert.equal(ecartDuree({ depart: "08:00", arrivee: "10:00", duree: "2 h" }), 0);
  const { verifierFaitsItineraire } = await import("../supabase/functions/assistant/itineraire.js");
  const faits = { langue: "en", prenom: "", devise: "THB", trajets: [{ date: "2026-12-01", de: "Koh Lanta", vers: "Bangkok", au_catalogue: true, mode: "VIP Bus/Van", duree: "22 h", horaires: [{ depart: "08:00", arrivee: "06:00", lendemain: true }], prix_adulte: 1650, prix_enfant: null, a_payer_sur_place: false }] };
  const v = verifierFaitsItineraire(faits);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.deepEqual(v.faits.trajets[0].horaires, [{ depart: "08:00", arrivee: "06:00", lendemain: true }]);
  const { simulerReponse } = await import("../src/gestion/js/itineraire-calc.mjs");
  assert.match(simulerReponse(faits).message || JSON.stringify(simulerReponse(faits)), /08:00 - 06:00 \(next day\)/);
  const src = readFileSync(new URL("../supabase/functions/agent/outils.js", import.meta.url), "utf8");
  assert.equal((src.match(/arrivee_lendemain: true/g) || []).length, 2, "les deux recherches de trajets le disent");
});

// ---- Revue des PR 346 et 347 (24.11.2026) --------------------------------------------------------------------------------------------

test("heure locale : « 18:30 (Malaysia time) » garde sa précision, ni lendemain déduit ni durée calculée ; écrite telle quelle au catalogue", () => {
  const base = brochureDemoTransport().trajets[3];
  const t = lu({ tarifs: [], trajets: [{ ...base, depart: "12:00", arrivee: "05:00 (Malaysia time)", lendemain: false, duree: "" }] }).brochure.trajets[0];
  assert.deepEqual([t.arrivee, t.arrivee_precision, t.lendemain, t.duree], ["05:00", "(Malaysia time)", false, ""]);
  const dit = lu({ tarifs: [], trajets: [{ ...base, depart: "12:00", arrivee: "05:00 (Malaysia time)", lendemain: true, duree: "" }] }).brochure.trajets[0];
  assert.deepEqual([dit.lendemain, dit.duree], [true, ""]);
  const [op] = C.planBrochure(C.comparerBrochure({ tarifs: [], trajets: [dit] }, { partenaireId: PART, trajets: CATALOGUE }).trajets.map((l) => ({ ...l, coche: true })), { partenaireId: PART, aujourdhui: AJD });
  assert.deepEqual([op.valeurs.arrivee, op.valeurs.duree], ["05:00 (Malaysia time) (next day)", ""]);
  // La relecture reçoit l'heure avec sa précision.
  assert.equal(B.extractionPourRelecture({ ...demo().brochure, trajets: [t] }).trajets[0].arrivee, "05:00 (Malaysia time)");
});

test("nets sans le droit : la fonction et l'écran retirent chiffres, colonne « เก็บ », ligne imprimée et raisons qui en parlent", () => {
  const b = demo().brochure;
  const avecRaison = { ...b, trajets: b.trajets.map((t, i) => (i === 2 ? { ...t, raison: "Net couvert par du scotch." } : i === 0 ? { ...t, raison: "เก็บ 1,300 écrit à la main." } : t)) };
  const serveur = B.masquerNets(avecRaison);
  assert.deepEqual(C.masquerNets(avecRaison), serveur, "la même règle des deux côtés");
  const texte = JSON.stringify(serveur);
  for (const interdit of ["เก็บ", "1,300", "1300", "Net couvert"]) assert.ok(!texte.includes(interdit), interdit);
  assert.ok(serveur.trajets.every((t) => t.net_adulte === null && t.net_enfant === null && t.net_texte === "" && !t.net_a_saisir));
  assert.ok(!serveur.colonnes.some((c) => c.contenu === "net"));
  assert.equal(serveur.trajets[0].imprime, "Lanta → Khaosan (BKK) | VIP Bus/Van | 08:00 | 06:00 | 1,650", "texte reconstruit des champs utiles");
  assert.equal(serveur.trajets[0].raison, "", "une raison qui parle du net est retirée");
  assert.equal(serveur.trajets[3].raison, "Arrivée 05:00 le lendemain.", "une raison sans net ni chiffre (hors heures) reste");
  assert.equal(serveur.trajets[4].raison, "", "une raison qui cite un autre chiffre (« 12.0 AM ») est retirée par prudence");
  const index = readFileSync(new URL("../supabase/functions/assistant/index.ts", import.meta.url), "utf8");
  assert.match(index, /const voitNets = \(perms\.data \|\| \[\]\)\.includes\("partenaires\.nets"\)/);
  assert.match(index, /valider = \(v\) => sansNets\(validerBrochure\(v\)\)/);
  const ecran = readFileSync(new URL("../src/gestion/js/views/brochure.mjs", import.meta.url), "utf8");
  assert.match(ecran, /const b = droitNets \? r\.brochure : masquerNets\(r\.brochure\)/);
});

test("sigles : « PP CRUISER » → « PP Cruiser », « BKK STD » restent, « LTD » → « Ltd »", () => {
  assert.equal(C.casseNormale("PP CRUISER"), "PP Cruiser");
  assert.equal(C.casseNormale("BKK EXPRESS VAN"), "BKK Express Van");
  assert.equal(C.casseNormale("KOH DEMO TRANSPORT CO., LTD."), "Koh Demo Transport Co., Ltd.");
  assert.equal(C.casseNormale("VIP DEMO VAN"), "VIP Demo Van");
});

test("fuite des nets : une colonne de net mal étiquetée (« autre ») n'apparaît ni en base ni à l'écran sans le droit", () => {
  const b = brochureDemoTransport();
  // La colonne « เก็บ » étiquetée « autre » : Claude n'y a pas reconnu un net, les chiffres restent dans la ligne imprimée et la raison.
  const mal = { ...b, colonnes: b.colonnes.map((c) => (c.entete === "เก็บ" ? { ...c, contenu: "autre" } : c)), trajets: b.trajets.map((t) => ({ ...t, net_texte: "", net_adulte: null, net_source: "", raison: t.net_adulte ? `Chiffre manuscrit ${t.net_adulte.toLocaleString("en-US")} dans la dernière colonne.` : t.raison })) };
  const r = lu(mal).brochure;
  // Les nets qui ne sont le prix de vente d'aucune ligne (450 est aussi le prix de vente du trajet de Krabi Airport).
  const ventes = new Set(b.trajets.map((t) => t.prix_adulte));
  const nets = b.trajets.map((t) => t.net_adulte).filter((n) => n && !ventes.has(n)).map((n) => n.toLocaleString("en-US"));
  assert.ok(nets.length >= 5);
  // En base : le texte imprimé écrit avec le trajet est reconstruit, sans la ligne recopiée.
  const ops = C.planBrochure(C.comparerBrochure(r, { partenaireId: PART, trajets: CATALOGUE }).trajets.map((l) => ({ ...l, coche: true })), { partenaireId: PART, droitNets: false, aujourdhui: AJD });
  assert.ok(ops.length >= 5);
  for (const o of ops) for (const n of nets) assert.ok(!JSON.stringify(o.valeurs).includes(n) && !JSON.stringify(o.valeurs).includes(n.replace(",", "")), `${o.valeurs.vers} : ${n}`);
  for (const o of ops) assert.ok(!/เก็บ|\[scotch\]/.test(o.valeurs.imprime), o.valeurs.imprime);
  // À l'écran sans le droit (fonction et outil) : ni la ligne recopiée, ni la raison qui cite le chiffre.
  for (const masque of [B.masquerNets(r), C.masquerNets(r)]) {
    const texte = JSON.stringify(masque.trajets.map((t) => [t.imprime, t.raison, t.relecture_raison, t.illisible, t.prix_texte]));
    for (const n of nets) assert.ok(!texte.includes(n), n);
  }
});

test("heure de départ : sa précision est gardée ; « (next day) » ou « +1 » dans l'heure comptent comme lendemain, jamais en double", () => {
  const base = brochureDemoTransport().trajets[3];
  const v = (depart, arrivee) => lu({ tarifs: [], trajets: [{ ...base, depart, arrivee, lendemain: false, duree: "" }] }).brochure.trajets[0];
  const a = v("07:00 (Malaysia time)", "15:00");
  assert.deepEqual([a.depart, a.depart_precision, a.duree], ["07:00", "(Malaysia time)", ""]);
  const b = v("12:00", "06:00 (next day)");
  assert.deepEqual([b.arrivee, b.arrivee_precision, b.lendemain, b.duree], ["06:00", "", true, "18 h"]);
  const c = v("20:00", "05:00 +1");
  assert.deepEqual([c.arrivee_precision, c.lendemain, c.duree], ["", true, "9 h"]);
  const [op] = C.planBrochure(C.comparerBrochure({ tarifs: [], trajets: [b] }, { partenaireId: PART, trajets: CATALOGUE }).trajets.map((l) => ({ ...l, coche: true })), { partenaireId: PART, aujourdhui: AJD });
  assert.equal(op.valeurs.arrivee, "06:00 (next day)", "un seul « (next day) »");
  const [opA] = C.planBrochure(C.comparerBrochure({ tarifs: [], trajets: [a] }, { partenaireId: PART, trajets: CATALOGUE }).trajets.map((l) => ({ ...l, coche: true })), { partenaireId: PART, aujourdhui: AJD });
  assert.match(opA.valeurs.imprime, /07:00 \(Malaysia time\)/, "la précision du départ reste avec le trajet");
});

test("forme : seules les listes et les objets du premier niveau sont exigés, comme validerBrochure ; « fiche » seulement si elle est corrigée", () => {
  const t = JSON.stringify({ ...brochureDemoTransport(), trajets: undefined });
  const r = B.lireBrochure({ stop_reason: "end_turn", content: [{ type: "text", text: t }] }, B.SCHEMA_BROCHURE);
  assert.deepEqual([r.ok, r.statut, r.raison, r.manque], [false, "json_invalide", "forme", ["trajets"]]);
  // Une ligne sans « periode_debut » (ou sans prix) : pas de correction, validerBrochure remplit la valeur vide.
  const sansPeriode = { ...brochureDemoTransport() };
  sansPeriode.trajets = sansPeriode.trajets.map((x, i) => (i === 2 ? (({ periode_debut, prix_adulte, ...reste }) => reste)(x) : x));
  const r2 = B.lireBrochure({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(sansPeriode) }] }, B.SCHEMA_BROCHURE);
  assert.equal(r2.ok, true);
  assert.equal(B.validerBrochure(r2.valeur).brochure.trajets[2].periode_debut, "");
  // Relecture sans fiche corrigée : « fiche » vide ne demande rien.
  const rel = (x) => B.lireBrochure({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(x) }] }, B.SCHEMA_RELECTURE);
  assert.equal(rel({ trajets: [], tarifs: [], fiche_corrigee: false, fiche: {}, remarques: "" }).ok, true);
  assert.equal(rel({ trajets: [], tarifs: [], fiche_corrigee: false, remarques: "" }).ok, true);
  assert.deepEqual(rel({ trajets: [], tarifs: [], fiche_corrigee: true, remarques: "" }).manque, ["fiche"]);
  assert.deepEqual(rel({ tarifs: [], fiche_corrigee: false }).manque, ["trajets"]);
  const c = B.demandeCorrection({ model: "m", messages: [{ role: "user", content: [{ type: "text", text: "x" }] }] }, { content: [] }, "forme", ["trajets"]);
  assert.match(c.messages.at(-1).content[0].text, /des champs requis manquent \(trajets\)/);
  assert.equal(B.lireBrochure({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(brochureDemoTransport()) }] }, B.SCHEMA_BROCHURE).ok, true, "la brochure fictive complète passe");
});

test("journal : une correction coupée par le délai compte les jetons de la première réponse, plus les siens s'il y en a", () => {
  const index = readFileSync(new URL("../supabase/functions/assistant/index.ts", import.meta.url), "utf8");
  assert.match(index, /premierMessage = premier;\s*\/\/[^\n]*\n\s*reponseClaude = null;/);
  assert.match(index, /if \(partiel && usageAvant\) reponseClaude = \{ \.\.\.partiel, usage: additionner\(usageAvant, partiel\.usage\) \}/);
  assert.match(index, /else if \(premierMessage && usageAvant\) reponseClaude = \{ \.\.\.premierMessage, usage: additionner\(usageAvant, \{\}\) \}/);
});

test("retour de la migration 127 : la fonction de la 124 revient avant le retrait de la colonne", () => {
  const sql = readFileSync(new URL("../docs/gestion/retour-127-trajet-imprime.sql", import.meta.url), "utf8");
  assert.ok(sql.indexOf("create or replace function brochure_ecrire_ligne") < sql.indexOf("alter table trajets drop column if exists imprime"));
  assert.ok(!/imprime/.test(sql.slice(sql.indexOf("create or replace function"), sql.indexOf("alter table trajets drop"))), "la fonction rendue n'écrit pas « imprime »");
});

test("départ avec sa précision : « 07:00 (Malaysia time) » arrive tel quel au catalogue et sur le voucher ; même heure rapprochée au réimport", () => {
  const base = brochureDemoTransport().trajets[3];
  const t = lu({ tarifs: [], trajets: [{ ...base, depart: "07:00 (Malaysia time)", arrivee: "15:00", lendemain: false, duree: "" }] }).brochure.trajets[0];
  const [op] = C.planBrochure(C.comparerBrochure({ tarifs: [], trajets: [t] }, { partenaireId: PART, trajets: CATALOGUE }).trajets.map((l) => ({ ...l, coche: true })), { partenaireId: PART, aujourdhui: AJD });
  assert.equal(op.valeurs.depart, "07:00 (Malaysia time)");
  assert.equal(C.departTexte("08:00", ""), "08:00");
  // Réimport : le trajet du catalogue « 07:00 (Malaysia time) » est reconnu, pas recréé.
  const existant = { id: "m1", partenaire_id: PART, actif: true, de: t.de, vers: t.vers, mode: t.mode, depart: "07:00 (Malaysia time)", arrivee: "15:00", duree: "", prix_adulte: t.prix_adulte, prix_enfant: null, periode: "", fenetres: [] };
  const c = C.comparerBrochure({ tarifs: [], trajets: [t] }, { partenaireId: PART, trajets: [existant] });
  assert.deepEqual([c.trajets[0].statut, c.trajets[0].cible && c.trajets[0].cible.id], ["inchange", "m1"]);
  // Le voucher imprime le départ tel qu'au catalogue.
  const REGL = { emetteur: { nom: "Agence test", adresse: "", telephone: "+66 00" }, apparence: {}, voucher: {}, devise: "THB" };
  const r = { id: "R1", dossier_id: "D1", entite_id: "E", libelle: "Koh Lanta → Kuala Lumpur", date_service: "2026-12-01", heure_pickup: "06:30", lieu_pickup: "Hotel Test", personnes: { adultes: 1, enfants: 0, bebes: 0 }, statut: "confirme", montant_vente: 1950, details: {} };
  const lignes = renderVoucher({ reservation: r, prestation: null, type: "billet", index: 1 }, { reglages: REGL, dossier: { ref: "INV-2026-099" }, client: { prenom: "Test", nom: "Client" }, resume: { total: 1950, recu: 0 }, trajet: { de: "Koh Lanta", vers: "Kuala Lumpur", depart: op.valeurs.depart, arrivee: op.valeurs.arrivee, mode: "VIP Bus/Van" } }).lignes;
  assert.ok(lignes.some((l) => /07:00 \(Malaysia time\)/.test(l)), lignes.join("\n"));
  // Le formulaire du trajet garde la précision quand l'heure est enregistrée.
  const form = readFileSync(new URL("../src/gestion/js/views/trajets.mjs", import.meta.url), "utf8");
  assert.match(form, /const departSaisi = \(\) => \(depart\.value \? \[depart\.value, precisionDepart\]\.filter\(Boolean\)\.join\(" "\) : ""\);/);
  assert.match(form, /depart: departSaisi\(\)/);
});

// ---- Retouches après l'essai réel du 24.11.2026 --------------------------------------------------------------------------------------

test("lieux hors catalogue en casse de titre, sigles gardés ; l'imprimé reste à côté", () => {
  const n = (x) => C.normaliserLieu(x, { lieux: C.lieuxDuCatalogue(CATALOGUE) });
  for (const [imprime, nom] of [["TRANG", "Trang"], ["TRANG Airport", "Trang Airport"], ["TRANG TRAIN STATION", "Trang Train Station"], ["SONGKHLA", "Songkhla"], ["SATUN", "Satun"], ["PENANG", "Penang"], ["BUTTERWORTH", "Butterworth"], ["HADYAI A/P", "Hat Yai Airport"]]) {
    assert.equal(n(imprime).nom, nom, imprime);
    assert.equal(n(imprime).imprime, imprime);
  }
  assert.equal(n("TRG").nom, "TRG", "un sigle reste en capitales");
  assert.equal(n("PP CRUISER PIER").nom, "PP Cruiser Pier");
  assert.equal(n("LANTA").nom, "Koh Lanta", "le catalogue passe avant");
  assert.equal(C.casseLieu("Krabi Airport"), "Krabi Airport", "un nom déjà en casse mixte ne change pas");
});

test("relecture : « Corrigé » seulement si une valeur visible change ; une forme différente (virgule, 0, durée) est ignorée", () => {
  // Comme l'essai réel : les durées ne sont pas imprimées, la première lecture les a calculées des heures.
  const premiere = lu({ ...brochureDemoTransport(), trajets: brochureDemoTransport().trajets.map((t) => ({ ...t, duree: "" })) }).brochure;
  // Les 10 lignes renvoyées « corrigées » sans rien changer de visible : net_texte sans virgule, 0 pour l'enfant, durée vidée.
  const bruit = premiere.trajets.map((t, index) => ({ index, statut: "corrige", raison: "net_texte recopié avec sa virgule ; prix et net enfant absents mis à 0 ; durée calculée retirée car elle n'est pas imprimée.", ligne: { ...t, net_texte: String(t.net_adulte || ""), prix_enfant: 0, net_enfant: 0, duree: "" } }));
  const f = B.fusionnerRelecture(premiere, { trajets: bruit, tarifs: [], fiche_corrigee: false, fiche: {}, remarques: "" });
  assert.equal(f.compte.corriges, 0);
  const r = lu(f.brut).brochure;
  assert.ok(r.trajets.every((t) => t.relecture === "" && t.relecture_raison === ""));
  // Un vrai changement (prix) reste « corrigé », avec une raison lisible.
  const vrai = B.fusionnerRelecture(premiere, { trajets: [{ index: 1, statut: "corrige", raison: "Prix relu 680 : le 5 était un 8.", ligne: { ...premiere.trajets[1], prix_texte: "680", prix_adulte: 680 } }], tarifs: [], fiche_corrigee: false, fiche: {}, remarques: "" });
  assert.equal(vrai.compte.corriges, 1);
  assert.deepEqual([lu(vrai.brut).brochure.trajets[1].relecture, lu(vrai.brut).brochure.trajets[1].relecture_raison], ["corrige", "Prix relu 680 : le 5 était un 8."]);
  // Un lendemain ajouté ou une heure changée comptent aussi.
  assert.equal(B.changeVisible(premiere.trajets[1], { ...premiere.trajets[1], arrivee: "13:00 (next day)" }), true);
  assert.equal(B.changeVisible(premiere.trajets[1], { ...premiere.trajets[1], depart: "08:30" }), true);
  assert.equal(B.changeVisible(premiere.trajets[1], { ...premiere.trajets[1], vers: "Trang" }), true);
});

test("raisons : une phrase pour la personne, jamais un nom de champ ni une remarque sur 0, la durée ou la virgule", () => {
  for (const t of ["net_texte recopié avec sa virgule.", "prix et net enfant absents mis à 0.", "Durée calculée retirée car elle n'est pas imprimée.", "prix_enfant = 0", "Valeur null remplacée.", "Corrigé dans le JSON."]) assert.equal(B.raisonLisible(t), "", t);
  // De vraies phrases restent, même avec « à 0 », « virgule » ou « champ » (revue de la PR 354).
  for (const t of ["« 12.0 AM » lu 12:00 : départ de midi.", "Net couvert par du scotch.", "Ligne coupée par le bas de la photo 2.", "Prix enfant à 0 sur la brochure : gratuit sous 4 ans.", "1,500 lu 1 500 : la virgule sépare les milliers.", "Le champ de prix est taché."]) assert.equal(B.raisonLisible(t), t, t);
  const t = lu({ tarifs: [], trajets: [{ ...brochureDemoTransport().trajets[0], raison: "net_texte recopié avec sa virgule." }] }).brochure.trajets[0];
  assert.equal(t.raison, "");
  const consigne = B.promptBrochure({ fichiers: [{ media_type: "image/jpeg", data: "/9j/AAAA" }], aujourdhui: AJD }).system[0].text;
  assert.match(consigne, /Jamais un nom de champ, ni une remarque sur les valeurs à 0, la durée ou la forme du JSON/);
});

test("durée : calculée des heures quand elle n'est pas imprimée, et dite « calculée » ; une durée imprimée reste telle quelle", () => {
  const base = brochureDemoTransport().trajets[0];
  const calc = lu({ tarifs: [], trajets: [{ ...base, duree: "" }] }).brochure.trajets[0];
  assert.deepEqual([calc.duree, calc.duree_calculee], ["22 h", true]);
  assert.deepEqual(B.validerBrochure({ tarifs: [], trajets: [calc] }).brochure.trajets[0].duree_calculee, true, "le drapeau tient au second contrôle (relecture)");
  const imprimee = lu({ tarifs: [], trajets: [{ ...base, duree: "21 h 30" }] }).brochure.trajets[0];
  assert.deepEqual([imprimee.duree, imprimee.duree_calculee], ["21 h 30", false]);
  const ecran = readFileSync(new URL("../src/gestion/js/views/brochure.mjs", import.meta.url), "utf8");
  assert.match(ecran, /lu\.duree_calculee \? tr\("\{duree\}, calculée des heures"/);
});

// ---- Revue de la PR 354 --------------------------------------------------------------------------------------------------------------

test("relecture : une vraie correction de n'importe quel champ écrit ou affiché est gardée (trajets et tarifs)", () => {
  const premiere = demo().brochure;
  const trajet = premiere.trajets[1];
  for (const [champ, valeur] of [["mode", "VIP Bus"], ["periode", "1 Nov 2026 - 30 Apr 2027"], ["duree", "5 h 30"], ["note", "change in Satun"]]) {
    const f = B.fusionnerRelecture(premiere, { trajets: [{ index: 1, statut: "corrige", raison: `${champ} relu.`, ligne: { ...trajet, [champ]: valeur } }], tarifs: [], fiche_corrigee: false, fiche: {}, remarques: "" });
    assert.equal(f.compte.corriges, 1, champ);
    const r = lu(f.brut).brochure.trajets[1];
    assert.equal(r[champ], valeur, champ);
    assert.equal(r.relecture, "corrige", champ);
    assert.deepEqual(r.relecture_champs, [champ], champ);
  }
  const tarif = { imprime: "Sunset tour 1,500 / 1,100", libelle: "Sunset tour", groupe: "Sunset trips", famille: "excursion", unite: "pp", prix_texte: "1,500 / 1,100", prix_adulte: 1500, prix_enfant: 1100, age_enfant: "4-11", sur_demande: false, net_texte: "", net_adulte: null, net_enfant: null, net_source: "", net_cache: false, horaires: "13:00 - 19:30", duree: "", programme: "13:00 Pick-up", inclus: "Snacks", conditions: "Weather permitting", parc: "", bateau: "", capacite: "", coupee: false, confiance: "haute", raison: "", lisible: true };
  const avecTarif = { ...premiere, tarifs: [lu({ tarifs: [tarif], trajets: [] }).brochure.tarifs[0]] };
  for (const [champ, valeur] of [["unite", "ad"], ["age_enfant", "3-10"], ["parc", "Park fee 200 per adult"], ["inclus", "Snacks\nSnorkel set"], ["conditions", "Min. 2 people"], ["horaires", "13:30 - 19:30"], ["programme", "13:30 Pick-up"], ["famille", "activite"], ["groupe", "Evening trips"]]) {
    const f = B.fusionnerRelecture(avecTarif, { trajets: [], tarifs: [{ index: 0, statut: "corrige", raison: "Relu.", ligne: { ...tarif, [champ]: valeur } }], fiche_corrigee: false, fiche: {}, remarques: "" });
    assert.equal(f.compte.corriges, 1, champ);
    const r = lu(f.brut).brochure.tarifs[0];
    assert.equal(r[champ], valeur, champ);
    assert.deepEqual(r.relecture_champs, [champ], champ);
  }
  // Les champs de forme seuls ne comptent pas.
  assert.deepEqual(B.champsChanges(trajet, { ...trajet, prix_texte: "650.-", net_texte: "500", imprime: "autre", raison: "x", confiance: "moyenne" }), []);
});

test("durée calculée : jamais renvoyée à la relecture, le drapeau tient après une correction ; une ligne ajoutée garde sa phrase par défaut", () => {
  const base = brochureDemoTransport().trajets[1];
  const premiere = lu({ ...brochureDemoTransport(), trajets: [{ ...base, duree: "" }] }).brochure;
  assert.equal(premiere.trajets[0].duree_calculee, true);
  assert.equal(B.extractionPourRelecture(premiere).trajets[0].duree, "", "la durée calculée ne part pas");
  const ligneRelue = { ...B.extractionPourRelecture(premiere).trajets[0], prix_texte: "680", prix_adulte: 680 };
  delete ligneRelue.index;
  const f = B.fusionnerRelecture(premiere, { trajets: [{ index: 0, statut: "corrige", raison: "Prix relu.", ligne: ligneRelue }], tarifs: [], fiche_corrigee: false, fiche: {}, remarques: "" });
  const r = lu(f.brut).brochure.trajets[0];
  assert.deepEqual([r.prix_adulte, r.duree, r.duree_calculee], [680, "5 h", true]);
  // Ligne ajoutée avec une raison technique : la phrase par défaut la remplace.
  const ajout = B.fusionnerRelecture(premiere, { trajets: [{ index: -1, statut: "ajoute", raison: "net_texte manquant.", ligne: { ...base, depart: "16:00", arrivee: "21:00" } }], tarifs: [], fiche_corrigee: false, fiche: {}, remarques: "" });
  assert.equal(lu(ajout.brut).brochure.trajets.at(-1).relecture_raison, "Ligne oubliée à la première lecture.");
});

test("lignes illisibles : leur motif passe par le même filtre ; sans le droit des nets, une correction du seul net ne s'annonce pas", () => {
  const base = brochureDemoTransport().trajets[8];
  const t = lu({ tarifs: [], trajets: [{ ...base, illisible: "prix_adulte mis à 0 (scotch).", raison: "" }] }).brochure.trajets[0];
  assert.equal(t.illisible, "Prix de vente à saisir.");
  const premiere = demo().brochure;
  const f = B.fusionnerRelecture(premiere, { trajets: [{ index: 1, statut: "corrige", raison: "Net relu 520.", ligne: { ...premiere.trajets[1], net_texte: "520", net_adulte: 520 } }], tarifs: [], fiche_corrigee: false, fiche: {}, remarques: "" });
  const r = lu(f.brut).brochure;
  assert.deepEqual([r.trajets[1].relecture, r.trajets[1].relecture_champs], ["corrige", ["net_adulte"]]);
  for (const masque of [B.masquerNets(r), C.masquerNets(r)]) assert.deepEqual([masque.trajets[1].relecture, masque.trajets[1].relecture_raison], ["", ""]);
  // Une correction du prix reste annoncée sans le droit.
  const g = B.fusionnerRelecture(premiere, { trajets: [{ index: 1, statut: "corrige", raison: "Prix relu.", ligne: { ...premiere.trajets[1], prix_texte: "680", prix_adulte: 680 } }], tarifs: [], fiche_corrigee: false, fiche: {}, remarques: "" });
  assert.equal(B.masquerNets(lu(g.brut).brochure).trajets[1].relecture, "corrige");
});

test("casse : « MCDONALD'S » → « McDonald's », « ST » → « St », « MT. » → « Mt. », sigles connus gardés", () => {
  for (const [a, b] of [["MCDONALD'S", "McDonald's"], ["ST", "St"], ["MT. KINABALU", "Mt. Kinabalu"], ["ST JOHN PIER", "St John Pier"], ["MACDONALD HOUSE", "MacDonald House"], ["MACAU", "Macau"], ["VIP PIER", "VIP Pier"], ["KHAOSAN (BKK)", "Khaosan (BKK)"]]) {
    assert.equal(C.casseLieu(a), b, a);
    assert.equal(C.casseNormale(a), b, a);
  }
  assert.equal(C.casseNormale("KOH DEMO TRANSPORT CO., LTD."), "Koh Demo Transport Co., Ltd.");
  assert.equal(C.casseLieu("Krabi A/P"), "Krabi A/P");
});
