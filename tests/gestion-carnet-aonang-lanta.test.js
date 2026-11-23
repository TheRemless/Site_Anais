// Guides du carnet d'Ao Nang et de Koh Lanta (23.11.2026) : les demandes des pages retrouvent le bon tarif Gestion.
//   - Ao Nang : sorties propres au carnet (carnet-produits.mjs), un bateau privé au prix du bateau, tranche de personnes, options.
//   - Koh Lanta : la page envoie les identifiants du site Secret (site-produits.mjs) ; une demande du carnet les résout par identifiant, avec l'âge des enfants selon la sortie.
// Le catalogue réel (partenaires, nets, commissions, prix) est dans des SQL privés hors dépôt : ces tests prennent des partenaires et des prix de vente
// FICTIFS (sans lien avec les vrais) : ces tests vérifient des mécanismes, jamais les montants réels, qui ne se contrôlent que dans le fichier privé (verif-prive-aonang-lanta.mjs).
// Le contrôle des SQL privés saute sans GESTION_SQL_PRIVE.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PRODUITS_CARNET, SORTIES_KOH_LANTA } from "../src/gestion/js/carnet-produits.mjs";
import { PRODUITS_SITE } from "../src/gestion/js/site-produits.mjs";
import { lireMessage, offresDuService, optionDuSite } from "../src/gestion/js/demande-calc.mjs";
import { ajusterAgesCarnet, baremeEnfant, sortieParId, resoudreSortie } from "../src/gestion/js/carnet-ages.mjs";
import { demandeTarifee, autresSorties, produitSite, texteDemande, changements } from "../src/gestion/js/demandes-site-calc.mjs";
import { typeVoucherDeduit } from "../src/gestion/js/operations-calc.mjs";

const AJD = "2026-11-23";
const md5uuid = (s) => { const h = createHash("md5").update(s).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
const lireFichier = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const AONANG = PRODUITS_CARNET.filter((p) => p.guide === "aonang");

// Prix de vente fictifs des sorties d'Ao Nang : un prix par bateau, différent pour chaque sortie.
const IDS_SORTIES_AONANG = ["aonang-vip-4-islands", "aonang-vip-hong", "aonang-vip-phi-phi", "aonang-mini-luxury-4-islands", "aonang-mini-luxury-hong", "aonang-mini-luxury-phi-phi", "aonang-luxury-4-islands", "aonang-luxury-hong", "aonang-luxury-phi-phi",
  "aonang-economique-4-islands", "aonang-economique-hong-lagoon", "aonang-economique-hong-autres-iles", "aonang-prestige-hong", "aonang-prestige-4-islands", "aonang-prestige-phi-phi"];
const VENTES_AONANG = Object.fromEntries(IDS_SORTIES_AONANG.map((id, i) => [id, 3070 + 113 * i]));
const VENTES_OPTIONS = { "aonang-option-lunch-box|standard|Per person, VIP, Mini Luxury or Luxury boat": [61, "pp"], "aonang-option-lunch-box|standard|Per person, Economy boat": [61, "pp"], "aonang-option-vip-set|standard|Per boat": [713, "boat"] };

// Catalogue fictif : partenaires A, B et C, les identifiants du module.
const prestations = [
  ...AONANG.flatMap((p) => p.options.flatMap((o) => o.tarifs.map((t) => (t.cle in VENTES_OPTIONS ? { id: t.prestation, partenaire_id: "p-a", famille: "excursion", groupe: "Option, Krabi, Ao Nang", libelle: t.libelle, libelle_en: t.libelle, prix_vente: VENTES_OPTIONS[t.cle][0], unite: VENTES_OPTIONS[t.cle][1], details: {}, actif: true } : { id: t.prestation, partenaire_id: "p-b", famille: "excursion", groupe: "Krabi, Ao Nang", libelle: t.libelle, libelle_en: t.libelle, prix_vente: VENTES_AONANG[p.id], unite: "boat", details: { capacite: t.ligne }, actif: true })))),
  // Koh Lanta : les tranches des bateaux privés du site Secret, à des prix fictifs ; groupe et enfants à un tarif fictif.
  ...[["4-islands", "private-longtail", { "1 to 2 people": 6110, "3 to 4 people": 6620, "5 to 6 people": 7130 }], ["koh-rok-koh-haa", "private-longtail", { "1 to 3 people": 7250, "4 to 6 people": 7760, "7 to 8 people": 8270, "9 to 10 people": 8780 }]]
    .flatMap(([id, opt, prix]) => PRODUITS_SITE.find((p) => p.id === id).options.find((o) => o.id === opt).tarifs.map((t) => ({ id: t.prestation, partenaire_id: "p-c", famille: "excursion", groupe: "Private", libelle: t.libelle, libelle_en: t.libelle, prix_vente: prix[t.ligne], unite: "boat", details: { capacite: t.ligne }, actif: true }))),
  // Radeau privé (pêche) : sa ligne « 1 or 2 people, the raft », une tranche de 1 à 2 personnes, au prix fictif d'un radeau.
  ...PRODUITS_SITE.find((p) => p.id === "fishing-trip").options[0].tarifs.slice(0, 1).map((t) => ({ id: t.prestation, partenaire_id: "p-c", famille: "excursion", groupe: "Private", libelle: t.libelle, libelle_en: t.libelle, prix_vente: 2330, unite: "boat", details: {}, actif: true })),
  ...PRODUITS_SITE.find((p) => p.id === "4-islands").options.filter((o) => o.id.startsWith("join-in")).flatMap((o) => o.tarifs.map((t, i) => ({ id: t.prestation, partenaire_id: "p-c", famille: "excursion", groupe: "Join-in", libelle: t.libelle, libelle_en: t.libelle, prix_vente: i === 0 ? 1010 : 610, unite: i === 0 ? "pp" : "ch", details: {}, actif: true }))),
];
const contexte = { prestations, trajets: [], partenaires: [{ id: "p-a", actif: true }, { id: "p-b", actif: true }, { id: "p-c", actif: true }], nomPartenaire: () => "" };

// Une demande d'une page du carnet : le message que la page envoie, relu comme la fenêtre de création le fait (âges réglés).
function demande(produit, option, titre, invites, { nom } = {}) {
  const texte = `Booking request: ${nom || produit} – ${titre}\nDate: Sun 20 Dec 2026\nGuests: ${invites}\nPickup: Hotel Example\nName: Anna`;
  const d = ajusterAgesCarnet({ ...lireMessage(texte, AJD), carnet: { produit, option } });
  return { d, texte };
}
const offres = (produit, option, titre, invites, opts) => { const { d, texte } = demande(produit, option, titre, invites, opts); return offresDuService(d, texte, { phrase: texte, date: d.date, adultes: d.adultes, enfants: d.enfants }, contexte); };

// ---- Ao Nang ----------------------------------------------------------------------------------------------------------------------
test("Ao Nang : 15 sorties et 2 options dans le module, vocabulaire sans prestataire, sans règle d'âge", () => {
  assert.equal(AONANG.length, 17);
  const ids = AONANG.map((p) => p.id);
  for (const a of ["aonang-vip-4-islands", "aonang-vip-hong", "aonang-vip-phi-phi", "aonang-mini-luxury-4-islands", "aonang-mini-luxury-hong", "aonang-mini-luxury-phi-phi", "aonang-luxury-4-islands", "aonang-luxury-hong", "aonang-luxury-phi-phi",
    "aonang-economique-4-islands", "aonang-economique-hong-lagoon", "aonang-economique-hong-autres-iles", "aonang-prestige-hong", "aonang-prestige-4-islands", "aonang-prestige-phi-phi", "aonang-option-lunch-box", "aonang-option-vip-set"]) assert.ok(ids.includes(a), a);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of AONANG) {
    assert.equal(p.marque, "secret");
    assert.equal(p.enfant, undefined, `${p.id} : un bateau privé n'a pas de barème d'âge`);
    for (const o of p.options) for (const t of o.tarifs) assert.equal(t.prestation, md5uuid(`carnet:${t.cle}`), t.cle);
  }
  assert.deepEqual([...new Set(AONANG.filter((p) => /^aonang-(vip|mini-luxury|luxury)/.test(p.id)).map((p) => p.options[0].titre))].sort(), ["Luxury option", "Mini Luxury option", "VIP option"]);
  assert.equal(AONANG.find((p) => p.id === "aonang-prestige-hong").options[0].titre, "Prestige option");
  assert.equal(AONANG.find((p) => p.id === "aonang-economique-hong-lagoon").options[0].titre, "Economy option");
  // Les sorties d'Ao Nang n'entrent dans aucune autre liste.
  for (const p of AONANG) assert.ok(!PRODUITS_SITE.some((s) => s.id === p.id));
});

test("Ao Nang : le prix du bateau, quel que soit le nombre de personnes jusqu'au maximum, et l'alerte au-delà", () => {
  for (const p of AONANG.filter((x) => !x.id.includes("-option-"))) {
    const max = Number(/to (\d+) people/.exec(p.options[0].tarifs[0].ligne)[1]);
    for (const n of [1, 2, max]) {
      const o = offres(p.id, "standard", p.options[0].titre, `${n} adults`, { nom: p.nom })[0];
      assert.equal(o.id, p.options[0].tarifs[0].prestation, `${p.id} ${n} pers.`);
      assert.equal(o.total, VENTES_AONANG[p.id], `${p.id} ${n} pers.`);
    }
    // Plus de monde que le bateau : le prix reste celui d'un bateau et l'offre le dit (pas de second bateau calculé).
    const trop = offres(p.id, "standard", p.options[0].titre, `${max + 1} adults`, { nom: p.nom })[0];
    assert.equal(trop.total, VENTES_AONANG[p.id]);
    assert.equal(trop.avertissement, "groupe_hors_tranche", p.id);
  }
  // Enfants : pas de tarif enfant sur un bateau privé, les enfants ne changent pas le prix.
  assert.equal(offres("aonang-luxury-hong", "standard", "Luxury option", "2 adults, 2 children (ages 5 and 9)", { nom: "Hong Islands from Ao Nang, Luxury option" })[0].total, VENTES_AONANG["aonang-luxury-hong"]);
});

test("Ao Nang : options (lunch box, VIP Set) et voucher des sorties", () => {
  const lunch = AONANG.find((p) => p.id === "aonang-option-lunch-box");
  assert.equal(lunch.options[0].tarifs.length, 2, "une ligne par formule de bateau");
  assert.equal(AONANG.find((p) => p.id === "aonang-option-vip-set").options[0].tarifs.length, 1);
  const trouve = optionDuSite({ ...lireMessage("Booking request: Lunch box – Lunch box\nGuests: 2 adults", AJD), carnet: { produit: "aonang-option-lunch-box", option: "standard" } });
  assert.equal(trouve.option.tarifs.length, 2);
  // Une sortie donne un voucher de bateau, une option n'en a pas.
  const p = (cle) => prestations.find((x) => x.id === md5uuid(`carnet:${cle}`));
  assert.equal(typeVoucherDeduit({ libelle: "x" }, p("aonang-luxury-hong|standard|1 to 4 people"), null), "bateau");
  assert.equal(typeVoucherDeduit({ libelle: "Option: lunch box" }, p("aonang-option-vip-set|standard|Per boat"), null), null);
});

test("Ao Nang : une demande du carnet se retrouve par identifiant, jamais par un nom qui serait celui d'une page du site", () => {
  const lu = lireMessage("Booking request: 4 Islands from Ao Nang, VIP option – VIP option\nGuests: 2 adults", AJD);
  assert.equal(optionDuSite(lu), null, "un message collé sans identifiant ne retrouve pas une sortie du carnet");
  assert.equal(optionDuSite({ ...lu, carnet: { produit: "aonang-vip-4-islands", option: "standard" } }).produit.id, "aonang-vip-4-islands");
  assert.deepEqual(autresSorties({ page_url: "https://zwaldtravelplanner.com/carnet/ao-nang/", marque: "secret", produit_id: "aonang-vip-hong" }).every((p) => p.guide === "aonang"), true);
  assert.equal(produitSite("aonang-prestige-phi-phi").guide, "aonang");
});

// ---- Koh Lanta : les identifiants du site Secret, demandés par une page du carnet -------------------------------------------------------
test("Koh Lanta : le guide envoie les identifiants du site Secret, une demande du carnet les résout par identifiant", () => {
  const prive = (invites, option = "private-longtail", titre = "Private longtail") => offres("4-islands", option, titre, invites, { nom: "4 Islands" })[0];
  assert.equal(prive("2 adults").total, 6110);
  assert.equal(prive("2 adults, 2 children (ages 5 and 9)").total, 6620, "4 personnes : palier 3 à 4");
  assert.equal(prive("5 adults").total, 7130);
  assert.equal(prive("6 adults").total, 7130);
  // Koh Rok : les deux tranches ajoutées (7 à 8 et 9 à 10 personnes).
  const rok = (n) => offres("koh-rok-koh-haa", "private-longtail", "Private longtail", `${n} adults`, { nom: "Koh Rok & Koh Haa" })[0];
  assert.deepEqual([1, 3, 4, 6, 7, 8, 9, 10].map((n) => rok(n).total), [7250, 7250, 7760, 7760, 8270, 8270, 8780, 8780]);
  assert.equal(rok(8).ligneSite, "7 to 8 people");
  assert.equal(rok(11).total, 8780);
  assert.equal(rok(11).avertissement, "groupe_hors_tranche");
  // Groupe : adulte et enfant du join-in longtail.
  const joint = offres("4-islands", "join-in-longtail", "Join-in longtail", "2 adults, 1 child (age 7)", { nom: "4 Islands" })[0];
  assert.equal(joint.total, 2 * 1010 + 610);
  // Sans identifiant (message collé du site), le chemin du site Secret est celui d'avant : par le nom.
  const texte = "Booking request: 4 Islands – Join-in longtail\nDate: Sun 20 Dec 2026\nGuests: 2 adults\nName: Anna";
  const lu = lireMessage(texte, AJD);
  assert.equal(offresDuService(lu, texte, { phrase: texte, date: lu.date, adultes: 2, enfants: 0 }, contexte)[0].total, 2020);
});

test("Koh Lanta : les tranches de Koh Rok sont dans le mapping du site, avec les identifiants du SQL privé", () => {
  const lignes = PRODUITS_SITE.find((p) => p.id === "koh-rok-koh-haa").options.find((o) => o.id === "private-longtail").tarifs;
  assert.deepEqual(lignes.map((t) => t.ligne), ["1 to 3 people", "4 to 6 people", "7 to 8 people", "9 to 10 people"]);
  for (const t of lignes.slice(2)) assert.equal(t.prestation, md5uuid(`carnet:koh-rok-koh-haa|private-longtail|${t.ligne}`));
  const cles = JSON.parse(lireFichier("docs/gestion/cles-options-site.json"))["koh-rok-koh-haa|private-longtail"];
  assert.deepEqual(cles.map((t) => t.ligne), lignes.map((t) => t.ligne));
});

test("Koh Lanta : les sorties du guide sont dans le mapping, deux sont absentes et le disent", () => {
  const demandees = ["4-islands", "koh-rok-koh-haa", "koh-phi-phi", "mangroves", "fishing-trip", "sunrise-raft", "sunset-dinner-raft", "atv", "batik", "cooking-class", "elephant-sanctuary", "go-kart", "kayak", "mangrove-kayaking", "scuba-diving", "rental", "speedboat-ferry"];
  for (const id of demandees) assert.equal(sortieParId(id).id, id, id);
  // Pas dans le mapping du site : aucune sortie trouvée, donc aucun tarif choisi tout seul (la fenêtre propose « Choisir dans la base »).
  for (const id of ["koh-talabeng-koh-bubu", "island-day-tour"]) {
    assert.equal(sortieParId(id), null, id);
    const lu = lireMessage("Booking request: Koh Talabeng – Day\nGuests: 2 adults", AJD);
    assert.equal(optionDuSite({ ...lu, carnet: { produit: id, option: "x" } }), null);
  }
  const doc = lireFichier("docs/gestion/carnet-aonang-lanta.md");
  assert.match(doc, /koh-talabeng-koh-bubu/);
  assert.match(doc, /island-day-tour/);
});

test("Koh Lanta : le barème d'âge d'une OPTION vient de l'âge structuré de sa ligne enfant, jamais du libellé ni d'une union entre options", () => {
  const produit = (id) => PRODUITS_SITE.find((p) => p.id === id);
  const bareme = (id, option) => baremeEnfant(produit(id), produit(id).options.find((o) => o.id === option));
  assert.deepEqual(bareme("4-islands", "join-in-longtail"), { min: 4, max: 11 });
  assert.deepEqual(bareme("4-islands", "join-in-speedboat"), { min: 4, max: 11 });
  assert.deepEqual(bareme("koh-rok-koh-haa", "sunset"), { min: 4, max: 11 });
  assert.deepEqual(bareme("koh-phi-phi", "join-in-speedboat"), { min: 4, max: 11 });
  assert.deepEqual(bareme("mangroves", "fishing-park"), { min: 4, max: 11 });
  assert.deepEqual(bareme("kayak", "love-kayak-1-day"), { min: 4, max: 11 });
  assert.deepEqual(bareme("mangrove-kayaking", "mangrove-kayak-half-day"), { min: 4, max: 11 });
  assert.deepEqual(bareme("elephant-sanctuary", "programme-b"), { min: 4, max: 10 });
  assert.deepEqual(bareme("batik", "morning-or-afternoon"), { min: 3, max: 10 });
  assert.deepEqual(bareme("fishing-trip", "private-raft"), { min: 3, max: 9 });
  assert.deepEqual(bareme("sunrise-raft", "raft-sunrise"), { min: 3, max: 9 });
  assert.deepEqual(bareme("sunset-dinner-raft", "raft-sunset-dinner"), { min: 3, max: 9 });
  assert.deepEqual(bareme("scuba-diving", "snorkelling-on-dive-boat"), { min: 5, max: 11 });
  // Une option sans ligne enfant (bateau privé, cours privé, plongée) : aucun barème, même quand une autre option de la sortie en a un.
  for (const [id, option] of [["4-islands", "private-longtail"], ["4-islands", "private-speedboat"], ["koh-rok-koh-haa", "private-longtail"], ["batik", "private-course"], ["scuba-diving", "one-day-experience"], ["scuba-diving", "fun-dives"], ["scuba-diving", "courses"]]) assert.equal(bareme(id, option), null, `${id} / ${option}`);
  // Des lignes enfant qui ne disent pas le même âge (quad : conducteur et passager) : aucun barème, on ne choisit pas pour eux.
  for (const o of produit("atv").options) assert.equal(baremeEnfant(produit("atv"), o), null, `atv / ${o.id}`);
  // Sans option résolue : jamais le barème d'une autre option, ni une union (plongée, cours de batik).
  assert.equal(baremeEnfant(produit("scuba-diving"), null), null);
  assert.equal(baremeEnfant(produit("batik"), undefined), null);
  assert.equal(baremeEnfant(produit("4-islands"), null), null);
  // Sans âge structuré dans les lignes du site : aucune règle inventée.
  for (const id of ["go-kart", "cooking-class", "rental", "speedboat-ferry", "shared-minivan"]) for (const o of produit(id).options) assert.equal(baremeEnfant(produit(id), o), null, `${id} / ${o.id}`);
});

test("Koh Lanta : chaque ligne « Child » d'une option du site porte un âge structuré (sinon le barème casserait sans signal)", () => {
  for (const p of PRODUITS_SITE.filter((x) => x.marque === "secret")) for (const o of p.options) for (const t of o.tarifs || []) {
    if (!/^child\b/i.test(t.ligne)) continue;
    assert.ok(t.ages && Number.isFinite(t.ages.min) && Number.isFinite(t.ages.max) && t.ages.min <= t.ages.max, `${p.id} / ${o.id} / ${t.ligne} : âge structuré manquant (regenerer-produits-site.mjs)`);
  }
  // Un changement de libellé n'y change rien : le barème ne lit pas le texte de la ligne.
  const p = PRODUITS_SITE.find((x) => x.id === "4-islands");
  const o = p.options.find((x) => x.id === "join-in-longtail");
  const renomme = { ...o, tarifs: o.tarifs.map((t) => (/^child/i.test(t.ligne) ? { ...t, ligne: "Child, ages as shown" } : t)) };
  assert.deepEqual(baremeEnfant(p, renomme), { min: 4, max: 11 });
});

test("Koh Lanta : un enfant de 12 ans compte adulte, un enfant de 3 ans est signalé, des enfants sans âge aussi, comme pour Koh Samui", () => {
  const j = (invites) => offres("4-islands", "join-in-longtail", "Join-in longtail", invites, { nom: "4 Islands" })[0];
  assert.equal(j("1 adult, 1 child (age 12)").total, 2 * 1010, "12 ans : tarif adulte");
  assert.equal(j("1 adult, 1 child (age 11)").total, 1010 + 610);
  assert.equal(j("2 adults, 1 child (age 3)").avertissement, "age_enfant");
  assert.equal(j("2 adults, 1 child (age 2)").avertissement, "", "un bébé gratuit : aucune alerte");
  assert.equal(j("2 adults, 2 children").avertissement, "ages_manquants");
  // Même règle côté liste : la ligne de la table d'une demande du carnet de Koh Lanta est comptée comme la fenêtre de création.
  const ligne = { page_url: "https://zwaldtravelplanner.com/carnet/koh-lanta/", produit_id: "4-islands", option_id: "join-in-longtail", adultes: 1, enfants: 1, message: "Booking request: 4 Islands – Join-in longtail\nGuests: 1 adult, 1 child (age 12)" };
  const t = demandeTarifee(ligne);
  assert.deepEqual([t.adultes, t.enfants, t.plusGrands], [2, 0, 1]);
  // Une sortie privée de Koh Lanta : pas de barème, rien n'est ajusté.
  assert.equal(demandeTarifee({ ...ligne, option_id: "private-longtail" }).plusGrands, undefined);
  // Un message collé du site (sans identifiant du carnet) n'est jamais ajusté.
  assert.equal(ajusterAgesCarnet({ ...lireMessage("Booking request: 4 Islands – Join-in longtail\nGuests: 1 adult, 1 child (age 12)", AJD) }).plusGrands, undefined);
  // Autres sorties proposées au refus : celles du site pour Koh Lanta, celles du guide pour Ao Nang.
  assert.ok(autresSorties(ligne).every((p) => PRODUITS_SITE.includes(p)));
});

// ---- Contrat, module et SQL privés ----------------------------------------------------------------------------------------------------
test("contrat : les identifiants du fichier carnet-aonang-lanta.md sont ceux du module et du site", () => {
  const doc = lireFichier("docs/gestion/carnet-aonang-lanta.md");
  const dansDoc = new Set([...doc.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]));
  for (const p of AONANG) assert.ok(dansDoc.has(p.id), `${p.id} absent du contrat`);
  for (const id of ["4-islands", "koh-rok-koh-haa", "koh-phi-phi", "mangroves", "fishing-trip", "sunrise-raft", "sunset-dinner-raft", "atv", "batik", "cooking-class", "elephant-sanctuary", "go-kart", "kayak", "mangrove-kayaking", "scuba-diving", "rental"]) assert.ok(dansDoc.has(id), `${id} absent du contrat`);
  const idsConnus = new Set([...AONANG.map((p) => p.id), ...PRODUITS_SITE.map((p) => p.id)]);
  for (const id of dansDoc) assert.ok(idsConnus.has(id), `${id} du contrat inconnu du module et du site`);
  // Le contrat ne dit ni partenaire, ni commission, ni net.
  assert.doesNotMatch(doc, /commission|\bnet\b|partenaire :|prix d'achat/i);
  assert.match(lireFichier("docs/gestion/demandes-site.md"), /carnet-aonang-lanta\.md/);
  // Les options de chaque sortie du site dites dans le contrat existent sur le site.
  for (const l of doc.split("\n").filter((x) => /^\| `(4-islands|koh-rok-koh-haa|atv)`/.test(x))) {
    const id = /^\| `([^`]+)`/.exec(l)[1];
    for (const o of [...l.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]).slice(1)) assert.ok(PRODUITS_SITE.find((p) => p.id === id).options.some((x) => x.id === o), `${id} / ${o}`);
  }
});

const DOSSIER_PRIVE = process.env.GESTION_SQL_PRIVE || path.join(os.homedir(), "Desktop", "Site_Anais-import");
const prive = (nom) => { try { return fs.readFileSync(path.join(DOSSIER_PRIVE, nom), "utf8"); } catch { return null; } };
const SQL_AONANG = prive("donnees-secret-aonang.sql");
const RETOUR_AONANG = prive("retour-secret-aonang.sql");
const SQL_LANTA = prive("donnees-secret-lanta-guide.sql");
const RETOUR_LANTA = prive("retour-secret-lanta-guide.sql");

test("SQL privé d'Ao Nang : mêmes identifiants que le module, uniquement dans Secret, un net par tarif sauf le VIP Set", { skip: !SQL_AONANG || !RETOUR_AONANG ? "SQL privé absent (GESTION_SQL_PRIVE)" : false }, () => {
  const lignes = [...SQL_AONANG.matchAll(/^\s+\('((?:[^']|'')*)', md5\('carnet-partenaire:([^']+)'\)::uuid, '((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)', (\d+), '(\w+)', (\d+), \$j\$(.*)\$j\$::jsonb\),?$/gm)].map((m) => ({ cle: m[1].replace(/''/g, "'"), groupe: m[3], prix: Number(m[6]), unite: m[7], details: JSON.parse(m[9]) }));
  const cles = AONANG.flatMap((p) => p.options.flatMap((o) => o.tarifs.map((t) => t.cle)));
  assert.deepEqual(lignes.map((l) => l.cle).sort(), cles.sort(), "les tarifs du SQL sont ceux du module, ni plus ni moins");
  for (const l of lignes) {
    assert.ok(l.prix > 0, `${l.cle} : un prix de vente`);
    assert.equal(l.details.guide, "aonang");
    if (l.groupe === "Krabi, Ao Nang") {
      assert.equal(l.unite, "boat", l.cle);
      assert.match(l.details.parc, /Foreign adult: \d+ ฿ \| Foreign child: \d+ ฿ \| child means 3 to 14 years, under 3 free \| To be paid in cash on site/, `${l.cle} : droits d'entrée en plus`);
      assert.equal(l.details.capacite, l.cle.split("|")[2]);
    } else assert.equal(l.groupe, "Option, Krabi, Ao Nang", "une option n'a pas de voucher");
  }
  // Les noms des partenaires, lus dans le SQL, ne sortent dans aucun libellé ni aucun détail, ni dans le module.
  const noms = [...SQL_AONANG.matchAll(/\(md5\('carnet-partenaire:[^']+'\)::uuid, '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
  assert.equal(noms.length, 3);
  const module = JSON.stringify(AONANG).toLowerCase();
  for (const n of noms) assert.ok(!module.includes(n.toLowerCase()), "le module ne nomme aucun partenaire");
  assert.equal((SQL_AONANG.match(/"type":"vente_moins_net"/g) || []).length, 3);
  assert.equal((SQL_AONANG.match(/"mode_reglement":"sur_place"/g) || []).length, 3);
  // Nets : une ligne par tarif, sauf le VIP Set dont le net est à confirmer.
  const nets = [...SQL_AONANG.split("-- 4. Nets")[1].matchAll(/^\s+\('((?:[^']|'')*)', (\d+)\),?$/gm)].map((m) => m[1]);
  assert.equal(nets.length, cles.length - 1);
  assert.ok(!nets.includes("aonang-option-vip-set|standard|Per boat"), "net du VIP Set non écrit");
  assert.deepEqual([...new Set(SQL_AONANG.match(/00000000-0000-4000-8000-00000000000\d/g))], ["00000000-0000-4000-8000-000000000002"], "Secret seulement");
  assert.doesNotMatch(RETOUR_AONANG, /00000000-0000-4000-8000-00000000000[13]/);
  assert.match(SQL_AONANG, /pg_advisory_xact_lock/);
});

test("SQL privé de Koh Lanta : ligne Kradan ciblée par partenaire et marquée, nombre de lignes touchées contrôlé, tranches de Koh Rok aux identifiants du mapping", { skip: !SQL_LANTA || !RETOUR_LANTA ? "SQL privé absent (GESTION_SQL_PRIVE)" : false }, () => {
  const rok = PRODUITS_SITE.find((p) => p.id === "koh-rok-koh-haa").options.find((o) => o.id === "private-longtail").tarifs;
  for (const ligne of ["7 to 8 people", "9 to 10 people"]) {
    const t = rok.find((x) => x.ligne === ligne);
    assert.match(SQL_LANTA, new RegExp(`'${t.prestation}', '${ligne}', \\d+, \\d`), `${ligne} avec l'identifiant du mapping`);
    assert.ok(RETOUR_LANTA.includes(`'${t.prestation}'`), `${ligne} retirée par le retour`);
  }
  // L'extension est choisie par le partenaire de la tranche de départ ET son libellé, comptée avant (exactement une), marquée, et le nombre de lignes touchées est contrôlé ; le
  // retour ne remet que la ligne marquée, du prix qu'elle a gardé en marque. Aucune mise à jour « à l'aveugle » sur un libellé seul.
  const bloc = (sql) => sql.split("do $$")[1].split("end $$")[0];
  const donnees = bloc(SQL_LANTA);
  const retour = bloc(RETOUR_LANTA);
  assert.match(donnees, /partenaire_id = v_partenaire/);
  assert.match(donnees, /get diagnostics touchees = row_count;\s+if touchees <> 1 then\s+raise exception/);
  assert.match(donnees, /if a_faire > 1 then\s+raise exception/);
  assert.match(donnees, /a_faire = 0 and deja = 0 then\s+raise exception/);
  assert.match(donnees, /prix_avant_guide_lanta/);
  assert.match(retour, /get diagnostics touchees = row_count;\s+if touchees <> 1 then\s+raise exception/);
  assert.match(retour, /if marquees > 1 then\s+raise exception/);
  assert.match(retour, /details->>'prix_avant_guide_lanta'/);
  assert.match(retour, /details \? 'prix_avant_guide_lanta'/, "le retour ne touche que la ligne marquée");
  assert.match(SQL_LANTA, /raise exception 'Tranche de départ de Koh Rok introuvable/);
  assert.match(SQL_LANTA, /for update/);
  assert.match(SQL_LANTA, /pg_advisory_xact_lock/);
  assert.match(SQL_LANTA, /< \d+/, "lecture seule des commissions sous un seuil");
  assert.doesNotMatch(SQL_LANTA, /^delete /m);
  assert.doesNotMatch(SQL_LANTA, /00000000-0000-4000-8000-00000000000[13]/);
});

test("verif-secret-aonang-lanta.mjs : sans les SQL privés il saute en le disant en grand, --exiger sort en code 3", () => {
  const script = new URL("../docs/gestion/verif-secret-aonang-lanta.mjs", import.meta.url).pathname;
  const lance = (...args) => spawnSync(process.execPath, [script, ...args], { env: { ...process.env, GESTION_SQL_PRIVE: "/dossier/qui/n/existe/pas" }, encoding: "utf8" });
  const sans = lance();
  assert.equal(sans.status, 0);
  assert.match(sans.stdout, /SAUTÉ/);
  assert.equal(lance("--exiger").status, 3);
});

test("Koh Lanta : « Modifier » change l'option d'une demande du carnet, le tarif suit le titre du message (même chemin que la fenêtre de création)", async () => {
  const { texteDemande } = await import("../src/gestion/js/demandes-site-calc.mjs");
  const ligne = { marque: "secret", produit_id: "4-islands", produit: "4 Islands", option_id: "join-in-longtail", option_titre: "Join-in longtail", date_service: "2026-12-20", adultes: 2, enfants: 0, nom: "Anna", page_url: "https://zwaldtravelplanner.com/carnet/koh-lanta/", message: "Booking request: 4 Islands – Join-in longtail\nDate: Sun 20 Dec 2026\nGuests: 2 adults\nName: Anna" };
  const texte = texteDemande(ligne, { option_titre: "Join-in speedboat" });
  assert.match(texte, /^Booking request: 4 Islands – Join-in speedboat$/m);
  const lu = lireMessage(texte, AJD);
  const trouve = optionDuSite({ ...lu, carnet: { produit: "4-islands", option: "join-in-longtail" } });
  assert.equal(trouve.option.id, "join-in-speedboat", "le titre écrit dans le message l'emporte sur l'option envoyée");
});

// ---- Revue de la PR 333 ---------------------------------------------------------------------------------------------------------------------
const ZTP = "https://zwaldtravelplanner.com/carnet/koh-lanta/";
test("« Modifier » vers une autre option : l'âge, le tarif, les changements et la réponse suivent le titre du message", () => {
  const ligne = { marque: "secret", produit_id: "4-islands", produit: "4 Islands", option_id: "private-longtail", option_titre: "Private longtail", date_service: "2026-12-20", adultes: 1, enfants: 1, nom: "Anna", telephone: null, total_estime: null, devise: "THB", page_url: ZTP,
    message: "Booking request: 4 Islands – Private longtail\nDate: Sun 20 Dec 2026\nGuests: 1 adult, 1 child (age 12)\nName: Anna" };
  // Tel que demandé (bateau privé) : aucun barème, l'enfant reste enfant.
  assert.equal(demandeTarifee(ligne).plusGrands, undefined);
  // Après « Modifier » vers le join-in : le message dit le nouveau titre, l'identifiant d'option de la demande reste celui d'avant.
  const texte = texteDemande(ligne, { option_titre: "Join-in longtail" });
  assert.match(texte, /^Booking request: 4 Islands – Join-in longtail$/m);
  const lu = ajusterAgesCarnet({ ...lireMessage(texte, AJD), carnet: { produit: "4-islands", option: "private-longtail" } });
  assert.deepEqual([lu.adultes, lu.enfants, lu.plusGrands, lu.plusGrandsMax], [2, 0, 1, 11], "fenêtre de création : l'enfant de 12 ans compte adulte");
  const table = demandeTarifee(ligne, "Join-in longtail");
  assert.deepEqual([table.adultes, table.enfants, table.plusGrands], [lu.adultes, lu.enfants, lu.plusGrands], "liste : même résultat");
  assert.equal(resoudreSortie(lu).option.id, "join-in-longtail");
  // Le tarif suit la même option : adulte pour les deux.
  const offre = offresDuService(lu, texte, { phrase: texte, date: lu.date, adultes: lu.adultes, enfants: lu.enfants }, contexte)[0];
  assert.equal(offre.total, 2 * 1010);
  // Changements et réponse de confirmation : mêmes personnes, aucun changement de personnes inventé, l'option changée est dite.
  const final = { date: "2026-12-20", option_titre: "Join-in longtail", adultes: lu.adultes, enfants: lu.enfants, total: offre.total, devise: "THB" };
  const ch = changements(ligne, final);
  assert.deepEqual(ch.filter((c) => c.champ === "personnes"), []);
  assert.ok(ch.some((c) => c.champ === "option"));
});

test("une seule recherche des sorties : le carnet d'abord, aucun identifiant du carnet qui soit aussi celui du site", () => {
  const idsSite = new Set(PRODUITS_SITE.map((p) => p.id));
  for (const p of PRODUITS_CARNET) assert.ok(!idsSite.has(p.id), `${p.id} : identifiant du carnet aussi présent sur le site`);
  const faux = { ...PRODUITS_SITE.find((p) => p.marque === "secret"), id: "aonang-vip-hong" };
  PRODUITS_SITE.push(faux);
  try {
    assert.equal(sortieParId("aonang-vip-hong").guide, "aonang", "le carnet d'abord");
    assert.equal(produitSite("aonang-vip-hong"), sortieParId("aonang-vip-hong"), "la liste des demandes cherche comme le tarif");
    assert.equal(resoudreSortie({ carnet: { produit: "aonang-vip-hong", option: "standard" }, option: "" }).produit.guide, "aonang");
    assert.equal(optionDuSite({ ...lireMessage("Booking request: x – y\nGuests: 1 adult", AJD), carnet: { produit: "aonang-vip-hong", option: "standard" } }).produit.guide, "aonang");
  } finally {
    PRODUITS_SITE.splice(PRODUITS_SITE.indexOf(faux), 1);
  }
  // Les pages du site, y compris celles de VIP Taxi Lanta, se retrouvent comme avant.
  assert.equal(produitSite("4-islands").id, "4-islands");
  const taxi = PRODUITS_SITE.find((p) => p.marque === "taxi");
  assert.equal(produitSite(taxi.id), taxi);
  assert.equal(produitSite("n-existe-pas"), null);
});

test("« Proposer une autre sortie » : le guide de Koh Lanta a sa propre liste, comme les autres guides", () => {
  const ligne = { page_url: ZTP, marque: "secret", produit_id: "4-islands" };
  assert.deepEqual(autresSorties(ligne).map((p) => p.id), SORTIES_KOH_LANTA.filter((id) => id !== "4-islands"));
  assert.ok(!autresSorties(ligne).some((p) => p.id === "shared-minivan"), "un transfert du site n'est pas une sortie de ce guide");
  assert.deepEqual(autresSorties({ ...ligne, produit_id: "shared-minivan" }), [], "une sortie du site que ce guide ne propose pas : rien à proposer");
  // Une demande du site Secret (pas du carnet) : toutes les sorties du site, comme avant.
  const site = autresSorties({ ...ligne, page_url: "https://secrettravelandtour.com/tours/4-islands/" });
  assert.ok(site.some((p) => p.id === "shared-minivan") && site.every((p) => PRODUITS_SITE.includes(p)));
  // Le tableau du contrat est la liste.
  const doc = lireFichier("docs/gestion/carnet-aonang-lanta.md").split("## Koh Lanta")[1];
  const dansDoc = [...doc.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]).filter((id) => id !== "product_id");
  assert.deepEqual(dansDoc, SORTIES_KOH_LANTA);
  for (const id of SORTIES_KOH_LANTA) assert.ok(PRODUITS_SITE.some((p) => p.id === id && p.marque === "secret"), id);
});

test("groupe d'un bateau privé : l'âge minimum de la sortie dit à partir de quand un enfant compte (radeau : 3 ans), 4 ans sinon, comme sur le site", () => {
  const radeau = (invites) => offres("fishing-trip", "private-raft", "Private raft", invites, { nom: "Fishing trip" })[0];
  // Radeau de 1 ou 2 personnes, barème 3 à 9 ans : à 3 ans un enfant compte (3 personnes : hors tranche), à 2 ans c'est un bébé.
  assert.equal(radeau("2 adults, 1 child (age 3)").avertissement, "groupe_hors_tranche");
  assert.equal(radeau("2 adults, 1 child (age 2)").avertissement, "");
  assert.equal(radeau("2 adults").avertissement, "");
  // Bateau privé sans barème (4 Islands) : seuil de 4 ans, un enfant de 3 ans ne compte pas dans la tranche.
  const prive = (invites) => offres("4-islands", "private-longtail", "Private longtail", invites, { nom: "4 Islands" })[0];
  assert.equal(prive("2 adults, 1 child (age 3)").ligneSite, "1 to 2 people", "3 ans : pas compté");
  assert.equal(prive("2 adults, 1 child (age 4)").ligneSite, "3 to 4 people", "4 ans : compté");
  assert.equal(prive("2 adults, 2 children (ages 3 and 4)").ligneSite, "3 to 4 people");
  // Sortie à barème de 4 ans (join-in) : un enfant de 3 ans reste enfant (prix enfant) avec l'alerte ; un bébé de 2 ans non.
  const joint = (invites) => offres("4-islands", "join-in-longtail", "Join-in longtail", invites, { nom: "4 Islands" })[0];
  assert.equal(joint("2 adults, 1 child (age 3)").avertissement, "age_enfant");
  assert.equal(joint("2 adults, 1 child (age 3)").total, 2 * 1010 + 610);
  assert.equal(joint("2 adults, 1 child (age 2)").avertissement, "");
});
