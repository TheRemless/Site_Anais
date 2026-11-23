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
import { PRODUITS_CARNET, SORTIES_KOH_LANTA, EXTRAS_DU_SITE } from "../src/gestion/js/carnet-produits.mjs";
import { PRODUITS_SITE } from "../src/gestion/js/site-produits.mjs";
import { lireMessage, offresDuService, optionDuSite, notesDemande, extrasDemandes } from "../src/gestion/js/demande-calc.mjs";
import { ajusterAgesCarnet, baremeEnfant, sortieParId, resoudreSortie, resoudreProduit, agesDuMessage, lireInvites, lireInvitesFrancais, LIGNE_ENFANT, cleTexte } from "../src/gestion/js/carnet-ages.mjs";
import { demandeTarifee, autresSorties, guideDeLaPage, champsCarnet, optionsModifiables, optionModifiee, titreCanonique, titreOption, texteDemande, changements, reponseConfirmation } from "../src/gestion/js/demandes-site-calc.mjs";
import { typeVoucherDeduit } from "../src/gestion/js/operations-calc.mjs";
import { ligneDepuisPrestation } from "../src/gestion/js/partenaires-calc.mjs";

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
// L'extension de Koh Kradan du catalogue fictif : une ligne du partenaire des tranches, au prix FICTIF d'un bateau, que Gestion retrouve par sa clé stable (details.cle_carnet).
const KRADAN = { id: "kradan-fictif", partenaire_id: "p-c", famille: "excursion", groupe: "Option", libelle: "Extension fictive", libelle_en: "Extension", prix_vente: 777, unite: "boat", details: { cle_carnet: EXTRAS_DU_SITE[0].cle }, sur_place: false, actif: true };
prestations.push(KRADAN);
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
  assert.equal(sortieParId("aonang-prestige-phi-phi").guide, "aonang");
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

test("Koh Lanta : chaque option du site avec une ligne « Child » reliée a un barème structuré, sauf celles dont les lignes enfant se contredisent (quad)", () => {
  const sansBareme = [];
  for (const p of PRODUITS_SITE.filter((x) => x.marque === "secret")) for (const o of p.options) {
    if (!(o.tarifs || []).some((t) => LIGNE_ENFANT.test(t.ligne))) continue;
    if (o.enfant) assert.ok(Number.isFinite(o.enfant.min) && Number.isFinite(o.enfant.max) && o.enfant.min <= o.enfant.max, `${p.id} / ${o.id}`);
    else sansBareme.push(`${p.id} / ${o.id}`);
  }
  assert.deepEqual(sansBareme, ["atv / track-30-min", "atv / forest-1-hr", "atv / beach-bridge-2-hr", "atv / atv-kayak-2-hr"], "une nouvelle option avec ligne enfant sans barème est à regarder (regenerer-produits-site.mjs)");
  // Un libellé renommé n'y change rien : le barème ne lit pas le texte de la ligne.
  const p = PRODUITS_SITE.find((x) => x.id === "4-islands");
  const o = p.options.find((x) => x.id === "join-in-longtail");
  assert.deepEqual(baremeEnfant(p, { ...o, tarifs: o.tarifs.map((t) => (/^child/i.test(t.ligne) ? { ...t, ligne: "Kids, as shown" } : t)) }), { min: 4, max: 11 });
});

test("génération du barème d'âge d'une option du site : toutes les lignes enfant comptent, « Child seat » et la gratuité ne comptent pas, un cas sans âge ne casse pas tout", async () => {
  const { baremeDeOption, estLigneEnfant } = await import("../docs/gestion/bareme-enfant-site.mjs");
  // Une ligne enfant que le site ne relie à aucun tarif de Gestion garde son barème.
  assert.deepEqual(baremeDeOption([{ label: "Adult", amount: 1000 }, { label: "Child, 4 to 11", amount: 600, ages: { min: 4, max: 11 } }, { label: "Child under 4", amount: 0, ages: { max: 3 } }]).bareme, { min: 4, max: 11 });
  assert.deepEqual(baremeDeOption([{ label: "Child 3 to 9, per person", ages: { min: 3, max: 9 } }]).bareme, { min: 3, max: 9 });
  assert.deepEqual(baremeDeOption([{ label: "Child rider", ages: { min: 5, max: 12 } }, { label: "Child passenger", ages: { min: 5, max: 12 } }]).bareme, { min: 5, max: 12 });
  // Des âges différents : aucun barème, et la génération le dit.
  const quad = baremeDeOption([{ label: "Child rider", ages: { min: 5, max: 12 } }, { label: "Child passenger", ages: { min: 3, max: 12 } }]);
  assert.deepEqual([quad.bareme, quad.ambigu], [null, true]);
  assert.equal(baremeDeOption([{ label: "1 to 2 people" }]).bareme, null);
  assert.equal(baremeDeOption(undefined).bareme, null);
  // Cas 1 : « Child seat », « Child menu » ne sont pas des lignes de tarif enfant : ignorées, la génération ne casse pas.
  assert.doesNotThrow(() => baremeDeOption([{ label: "Adult", amount: 1000 }, { label: "Child seat", amount: 100 }, { label: "Child menu", amount: 200 }, { label: "Child, 4 to 11", amount: 600, ages: { min: 4, max: 11 } }]));
  assert.deepEqual(baremeDeOption([{ label: "Child seat", amount: 100 }, { label: "Child menu", amount: 200 }]).bareme, null);
  assert.equal(estLigneEnfant({ label: "Child seat" }), false);
  assert.equal(estLigneEnfant({ label: "Child seat", ages: { min: 2, max: 5 } }), true, "une ligne qui porte des âges est une ligne enfant");
  assert.equal(estLigneEnfant({ label: "Adult, from age 12", ages: { min: 12 } }), false, "une ligne adulte n'est jamais une ligne enfant");
  assert.equal(estLigneEnfant({ label: "Child" }), true);
  assert.equal(estLigneEnfant({ label: "Child, 4 to 11" }), true);
  assert.equal(estLigneEnfant({ label: "Child 3 to 9, per person" }), true);
  // Cas 2 : une ligne de gratuité à deux bornes (prix 0, âges 0 à 3) n'est jamais un barème.
  assert.equal(baremeDeOption([{ label: "Child under 4", amount: 0, ages: { min: 0, max: 3 } }]).bareme, null);
  assert.deepEqual(baremeDeOption([{ label: "Child, 4 to 11", amount: 600, ages: { min: 4, max: 11 } }, { label: "Child under 4", amount: 0, ages: { min: 0, max: 3 } }]).bareme, { min: 4, max: 11 });
  // Cas 3 : une ligne enfant sans âge. Non reliée à Gestion : un avertissement clair, pas d'échec. Reliée : échec avec la ligne en cause.
  const sans = baremeDeOption([{ label: "Child, 4 to 11", amount: 600 }], "4-islands / join-in-longtail");
  assert.equal(sans.bareme, null);
  assert.match(sans.avertissements[0], /4-islands \/ join-in-longtail : la ligne enfant « Child, 4 to 11 » n'a pas d'âge .* aucun tarif de Gestion/);
  assert.throws(() => baremeDeOption([{ label: "Child, 4 to 11", amount: 600 }], "4-islands / join-in-longtail", { reliee: () => true }), /la ligne enfant « Child, 4 to 11 » n'a pas d'âge .* reliée à un tarif de Gestion/);
  // Le script de génération s'en sert et le fichier généré porte `enfant` sur les options, plus d'`ages` sur les lignes de prix.
  const script = lireFichier("docs/gestion/regenerer-produits-site.mjs");
  assert.match(script, /baremeDeOption\(o\.prices/);
  assert.match(script, /reliee:/);
  for (const p of PRODUITS_SITE) for (const o of p.options) for (const t of o.tarifs || []) assert.equal(t.ages, undefined, `${p.id} / ${o.id}`);
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
  // La clé stable de l'extra du site (celle du module) est écrite sur la ligne marquée et retirée par le retour.
  assert.ok(donnees.includes(`'cle_carnet', '${EXTRAS_DU_SITE[0].cle}'`), "la clé de l'extra du module est celle du SQL");
  assert.match(retour, /details - 'prix_avant_guide_lanta' - 'cle_carnet'/);
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
test("« Modifier » vers une autre option : l'âge, le tarif et la réponse suivent le titre du message, « avant » est la demande telle qu'envoyée", () => {
  const base = { marque: "secret", produit_id: "4-islands", produit: "4 Islands", date_service: "2026-12-20", adultes: 1, enfants: 1, nom: "Anna", telephone: null, total_estime: null, devise: "THB", page_url: ZTP };
  const privee = { ...base, option_id: "private-longtail", option_titre: "Private longtail", message: "Booking request: 4 Islands – Private longtail\nDate: Sun 20 Dec 2026\nGuests: 1 adult, 1 child (age 12)\nName: Anna" };
  const groupe = { ...base, option_id: "join-in-longtail", option_titre: "Join-in longtail", message: "Booking request: 4 Islands – Join-in longtail\nDate: Sun 20 Dec 2026\nGuests: 1 adult, 1 child (age 12)\nName: Anna" };
  // Tel que demandé (bateau privé) : aucun barème, l'enfant reste enfant ; en join-in, il compte adulte.
  assert.deepEqual([demandeTarifee(privee).adultes, demandeTarifee(privee).enfants], [1, 1]);
  assert.deepEqual([demandeTarifee(groupe).adultes, demandeTarifee(groupe).enfants], [2, 0]);
  // Après « Modifier » du bateau privé vers le join-in : le message dit le nouveau titre, l'identifiant d'option de la demande reste celui d'avant.
  const texte = texteDemande(privee, { option_titre: "Join-in longtail" });
  assert.match(texte, /^Booking request: 4 Islands – Join-in longtail$/m);
  const lu = ajusterAgesCarnet({ ...lireMessage(texte, AJD), carnet: { produit: "4-islands", option: "private-longtail" } });
  assert.deepEqual([lu.adultes, lu.enfants, lu.plusGrands, lu.plusGrandsMax], [2, 0, 1, 11], "fenêtre de création : l'enfant de 12 ans compte adulte");
  assert.deepEqual([demandeTarifee(privee, "Join-in longtail").adultes, demandeTarifee(privee, "Join-in longtail").enfants], [lu.adultes, lu.enfants], "liste : même résultat");
  assert.equal(resoudreSortie(lu).option.id, "join-in-longtail");
  const offre = offresDuService(lu, texte, { phrase: texte, date: lu.date, adultes: lu.adultes, enfants: lu.enfants }, contexte)[0];
  assert.equal(offre.total, 2 * 1010);
  // Sens 1 : bateau privé vers join-in. Avant (demande telle qu'envoyée, bateau privé) : 1 adulte et 1 enfant ; après (join-in) : 2 adultes.
  const finalGroupe = { date: "2026-12-20", option_titre: "Join-in longtail", adultes: lu.adultes, enfants: lu.enfants, total: offre.total, devise: "THB" };
  const ch = changements(privee, finalGroupe);
  assert.deepEqual(ch.find((c) => c.champ === "personnes"), { champ: "personnes", avant: "1 adult, 1 child", apres: "2 adults" });
  assert.match(reponseConfirmation(privee, finalGroupe, { aujourdhui: AJD }), /Guests: 2 adults instead of 1 adult, 1 child/);
  // Sens 2 : join-in vers bateau privé. Avant (demande en join-in) : 2 adultes ; après (bateau privé, l'enfant de 12 ans reste enfant) : 1 adulte et 1 enfant.
  const texte2 = texteDemande(groupe, { option_titre: "Private longtail" });
  const lu2 = ajusterAgesCarnet({ ...lireMessage(texte2, AJD), carnet: { produit: "4-islands", option: "join-in-longtail" } });
  assert.deepEqual([lu2.adultes, lu2.enfants, lu2.plusGrands], [1, 1, undefined], "bateau privé : aucun barème, l'enfant reste enfant");
  const finalPrive = { date: "2026-12-20", option_titre: "Private longtail", adultes: lu2.adultes, enfants: lu2.enfants, total: 6110, devise: "THB" };
  assert.deepEqual(changements(groupe, finalPrive).find((c) => c.champ === "personnes"), { champ: "personnes", avant: "2 adults", apres: "1 adult, 1 child" });
  assert.match(reponseConfirmation(groupe, finalPrive, { aujourdhui: AJD }), /Guests: 1 adult, 1 child instead of 2 adults/);
  // Sans changement d'option : aucun changement de personnes, ni dans un sens ni dans l'autre.
  assert.equal(changements(groupe, { ...finalGroupe, option_titre: "Join-in longtail" }).find((c) => c.champ === "personnes"), undefined);
  assert.equal(changements(privee, { ...finalPrive, adultes: 1, enfants: 1, option_titre: "Private longtail" }).find((c) => c.champ === "personnes"), undefined);
});

test("une seule recherche des sorties : le carnet d'abord, aucun identifiant du carnet qui soit aussi celui du site", () => {
  const idsSite = new Set(PRODUITS_SITE.map((p) => p.id));
  for (const p of PRODUITS_CARNET) assert.ok(!idsSite.has(p.id), `${p.id} : identifiant du carnet aussi présent sur le site`);
  const faux = { ...PRODUITS_SITE.find((p) => p.marque === "secret"), id: "aonang-vip-hong" };
  PRODUITS_SITE.push(faux);
  try {
    assert.equal(sortieParId("aonang-vip-hong").guide, "aonang", "le carnet d'abord");
    assert.equal(sortieParId("aonang-vip-hong").guide, "aonang", "la liste des demandes cherche comme le tarif");
    assert.equal(resoudreSortie({ carnet: { produit: "aonang-vip-hong", option: "standard" }, option: "" }).produit.guide, "aonang");
    assert.equal(optionDuSite({ ...lireMessage("Booking request: x – y\nGuests: 1 adult", AJD), carnet: { produit: "aonang-vip-hong", option: "standard" } }).produit.guide, "aonang");
  } finally {
    PRODUITS_SITE.splice(PRODUITS_SITE.indexOf(faux), 1);
  }
  // Les pages du site, y compris celles de VIP Taxi Lanta, se retrouvent comme avant.
  assert.equal(sortieParId("4-islands").id, "4-islands");
  const taxi = PRODUITS_SITE.find((p) => p.marque === "taxi");
  assert.equal(sortieParId(taxi.id), taxi);
  assert.equal(sortieParId("n-existe-pas"), null);
});

test("« Proposer une autre sortie » : le guide de Koh Lanta a sa propre liste, comme les autres guides", () => {
  const ligne = { page_url: ZTP, marque: "secret", produit_id: "4-islands" };
  assert.deepEqual(autresSorties(ligne).map((p) => p.id), SORTIES_KOH_LANTA.filter((id) => id !== "4-islands"));
  assert.ok(!autresSorties(ligne).some((p) => p.id === "shared-minivan"), "un transfert du site n'est pas une sortie de ce guide");
  // Un identifiant que ni le carnet ni le guide de Koh Lanta ne connaissent : les sorties du guide de la PAGE (jamais celles d'un autre guide), sinon rien.
  const page = (slug) => `https://zwaldtravelplanner.com/carnet/${slug}-abc/`.replace("-abc/", "/");
  for (const inconnu of ["koh-talabeng-koh-bubu", "island-day-tour", "un-guide-futur"]) {
    assert.deepEqual(autresSorties({ ...ligne, page_url: page("koh-lanta-excursions-bateau"), produit_id: inconnu }).map((p) => p.id), SORTIES_KOH_LANTA, `${inconnu} depuis le guide de Koh Lanta`);
    assert.deepEqual(autresSorties({ ...ligne, page_url: page("koh-samui-excursions-bateau"), produit_id: inconnu }).map((p) => p.guide), Array(9).fill("koh-samui"), `${inconnu} depuis le guide de Koh Samui : jamais une sortie de Koh Lanta`);
    assert.deepEqual([...new Set(autresSorties({ ...ligne, page_url: page("ao-nang-excursions-bateau"), produit_id: inconnu }).map((p) => p.guide))], ["aonang"], `${inconnu} depuis le guide d'Ao Nang`);
    assert.deepEqual(autresSorties({ ...ligne, page_url: page("un-autre-guide"), produit_id: inconnu }), [], `${inconnu} depuis une page de guide inconnue : rien plutôt qu'un autre guide`);
  }
  assert.equal(guideDeLaPage({ page_url: page("koh-samui-excursions-bateau") }), "koh-samui");
  assert.equal(guideDeLaPage({ page_url: page("ao-nang-bateau") }), "aonang");
  assert.equal(guideDeLaPage({ page_url: page("koh-lanta-bateau") }), "koh-lanta");
  assert.equal(guideDeLaPage({ page_url: page("koh-lantana") }), null, "le début du nom, pas un préfixe de lettres");
  // Un produit du site que le guide de Koh Lanta ne propose pas (shared-minivan) : la liste du guide.
  assert.deepEqual(autresSorties({ ...ligne, produit_id: "shared-minivan" }).map((p) => p.id), SORTIES_KOH_LANTA);
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

// ---- Deuxième relecture de la PR 333 -----------------------------------------------------------------------------------------------------
test("barème de la SORTIE (Koh Samui) : il s'applique sans option résolue, le repli sur les lignes du site exige l'option", () => {
  // Ang Thong en big boat : deux options, barème 4 à 11 ans pour la sortie. Option inconnue, absente : l'enfant de 12 ans compte adulte quand même.
  const big = (carnet, option = "") => ajusterAgesCarnet({ ...lireMessage("Booking request: Ang Thong Marine Park by big boat – x\nGuests: 1 adult, 1 child (age 12)", AJD), option, carnet });
  for (const carnet of [{ produit: "ang-thong-big-boat", option: "inconnue" }, { produit: "ang-thong-big-boat", option: "" }, { produit: "ang-thong-big-boat" }]) {
    assert.equal(resoudreSortie({ carnet, option: "" }), null, "l'option n'est pas résolue");
    const d = big(carnet);
    assert.deepEqual([d.adultes, d.enfants, d.plusGrands, d.plusGrandsMax], [2, 0, 1, 11], JSON.stringify(carnet));
  }
  // Sortie du site : sans option résolue, aucun barème (repli sur les lignes enfant de l'option, qui n'existe pas ici).
  const site = (carnet) => ajusterAgesCarnet({ ...lireMessage("Booking request: 4 Islands – x\nGuests: 1 adult, 1 child (age 12)", AJD), option: "", carnet });
  for (const carnet of [{ produit: "4-islands", option: "inconnue" }, { produit: "4-islands", option: "" }, { produit: "scuba-diving", option: "" }]) assert.equal(site(carnet).plusGrands, undefined, JSON.stringify(carnet));
  assert.equal(baremeEnfant(sortieParId("ang-thong-big-boat"), null).max, 11);
  assert.equal(baremeEnfant(sortieParId("4-islands"), null), null);
});

test("ligne de la liste sans option_titre ni option_id : le titre de l'option vient de titreOption, comme pour le tarif", () => {
  // Sortie Samui à une seule option, ligne sans titre ni identifiant d'option : l'enfant de 12 ans compte adulte.
  const ligne = { page_url: "https://zwaldtravelplanner.com/carnet/koh-samui/", marque: "secret", produit_id: "ang-thong-petit-groupe-speedboat", option_id: null, option_titre: null, adultes: 1, enfants: 1, message: "Demande de réservation : x\nPersonnes : 1 adulte, 1 enfant (12 ans)" };
  const t = demandeTarifee(ligne);
  assert.deepEqual([t.adultes, t.enfants, t.plusGrands], [2, 0, 1]);
  // Big boat (deux options) sans titre ni identifiant : le barème de la sortie s'applique quand même.
  const big = demandeTarifee({ ...ligne, produit_id: "ang-thong-big-boat" });
  assert.deepEqual([big.adultes, big.enfants, big.plusGrands], [2, 0, 1]);
  // Option_titre vide mais identifiant d'option connu (page de Koh Lanta) : titreOption le retrouve par l'identifiant.
  const lanta = demandeTarifee({ ...ligne, produit_id: "4-islands", option_id: "join-in-longtail", message: "Booking request: 4 Islands – Join-in longtail\nGuests: 1 adult, 1 child (age 12)" });
  assert.deepEqual([lanta.adultes, lanta.enfants], [2, 0]);
});

test("récapitulatif de la page du carnet (en français) : la fenêtre lit un message refait des champs, les âges viennent de « Personnes : », l'option « avec-kayak » est reconnue", () => {
  const recap = "Demande de réservation : Ang Thong en big boat, journée en groupe\nFormule : avec kayak\nDate : 20 décembre 2026\nPersonnes : 2 adultes, 2 enfants (5 ans, 12 ans)\nPrise en charge : Hotel Example\nNom : Anna\nWhatsApp : +41791234567\nRéf : SAM-AB12";
  assert.deepEqual(agesDuMessage(recap), { adultes: 2, enfants: 2, bebes: 0, ages: [5, 12] });
  assert.deepEqual(agesDuMessage("Personnes : 1 adulte, 1 enfant (moins d'1 an)"), { adultes: 1, enfants: 0, bebes: 1, ages: [0] });
  assert.equal(agesDuMessage("Date : x"), null);
  const ligne = { marque: "secret", produit_id: "ang-thong-big-boat", produit: "Ang Thong en big boat, journée en groupe", option_id: "avec-kayak", option_titre: "avec kayak", date_service: "2026-12-20", adultes: 2, enfants: 2, pickup: "Hotel Example", nom: "Anna", telephone: null, total_estime: null, devise: "THB", page_url: "https://zwaldtravelplanner.com/carnet/koh-samui/", message: recap };
  const texte = texteDemande(ligne);
  assert.match(texte, /^Booking request: Ang Thong Marine Park by big boat – avec kayak$/m, "produit du catalogue, option de la demande");
  assert.match(texte, /^Guests: 2 adults, 2 children \(ages 5 and 12\)$/m);
  assert.match(texte, /^Pickup: Hotel Example$/m);
  // Les modifications se posent sur le message refait.
  assert.match(texteDemande(ligne, { option_titre: "Without kayak", date: "2026-12-22" }), /^Booking request: Ang Thong Marine Park by big boat – Without kayak$/m);
  // Même résultat que la fenêtre : option par alias, tarif, enfant de 12 ans adulte.
  const lu = ajusterAgesCarnet({ ...lireMessage(texte, AJD), carnet: { produit: "ang-thong-big-boat", option: "avec-kayak" } });
  assert.equal(resoudreSortie(lu).option.id, "with-kayak");
  assert.deepEqual([lu.adultes, lu.enfants, lu.plusGrands], [3, 1, 1]);
  assert.deepEqual([demandeTarifee(ligne).adultes, demandeTarifee(ligne).enfants], [3, 1]);
  assert.equal(resoudreSortie({ carnet: { produit: "ang-thong-big-boat", option: "sans-kayak" }, option: "" }).option.id, "without-kayak");
  assert.equal(resoudreSortie({ carnet: { produit: "ang-thong-big-boat", option: "" }, option: "sans kayak" }).option.id, "without-kayak");
  assert.equal(optionDuSite({ ...lu }).option.id, "with-kayak");
  // Une demande qui n'est pas du carnet garde son message : jamais refait.
  const site = { ...ligne, page_url: "https://secrettravelandtour.com/tours/4-islands/", message: "Booking request: 4 Islands – Join-in longtail\nGuests: 2 adults" };
  assert.equal(texteDemande(site), site.message);
});

test("chemins qui ne reçoivent que du texte (Assistant, message collé) : aucun contexte du carnet, donc ni barème d'âge ni tarif de la sortie, et le test le documente", () => {
  // Le message que la page envoie à WhatsApp ne porte ni l'adresse de la page, ni l'identifiant de la sortie, ni la marque du guide : seulement le nom français de la sortie et
  // « Réf : SAM-… » (préfixe réglable). Un chemin qui ne reçoit que ce texte ne peut pas savoir qu'il vient du carnet.
  const recap = "Demande de réservation : Ang Thong en big boat, journée en groupe\nFormule : avec kayak\nPersonnes : 1 adulte, 1 enfant (12 ans)\nRéf : SAM-AB12";
  const lu = lireMessage(recap, AJD);
  assert.equal(lu.libre, true, "lu comme un message libre");
  assert.equal(lu.carnet, undefined);
  assert.equal(optionDuSite(lu), null);
  assert.ok(!offresDuService(lu, recap, { phrase: recap, date: "", adultes: 1, enfants: 1 }, contexte).some((o) => o.ligneSite), "aucun tarif de la sortie choisi d'après le texte");
  assert.equal(ajusterAgesCarnet({ ...lu, ages: [12], enfants: 1, adultes: 1 }).plusGrands, undefined, "aucune conversion adulte sans contexte");
  // Le même enfant, quand le contexte existe (la ligne de la table, qui porte la page et l'identifiant) : compté adulte.
  const ligne = { page_url: ZTP, marque: "secret", produit_id: "ang-thong-big-boat", option_id: "avec-kayak", option_titre: "avec kayak", adultes: 1, enfants: 1, message: recap };
  assert.deepEqual([demandeTarifee(ligne).adultes, demandeTarifee(ligne).enfants], [2, 0]);
  // Et une demande ordinaire du site Secret, lue en texte : jamais ajustée.
  const ordinaire = lireMessage("Booking request: 4 Islands – Join-in longtail\nGuests: 1 adult, 1 child (age 12)", AJD);
  assert.equal(ajusterAgesCarnet(ordinaire).plusGrands, undefined);
  assert.equal(resoudreProduit(ordinaire), null);
});

test("une seule définition : ligne enfant, normalisation du texte, recherche d'une sortie par identifiant", async () => {
  const code = (f) => lireFichier(`src/gestion/js/${f}`).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code("demande-calc.mjs"), /const LIGNE_ENFANT\s*=|const cleTexte\s*=/, "demande-calc.mjs importe LIGNE_ENFANT et cleTexte de carnet-ages.mjs");
  assert.doesNotMatch(code("carnet-ages.mjs"), /\/\^child\\b\/i\.test/, "carnet-ages.mjs ne redéfinit pas la ligne enfant");
  assert.equal((code("carnet-ages.mjs").match(/\^child\\b/g) || []).length, 1);
  assert.equal(cleTexte("  Join-in  Longtail & Co "), "join in longtail and co");
  assert.equal(LIGNE_ENFANT.test("Child, 4 to 11"), true);
  assert.equal(LIGNE_ENFANT.test("Children's seat"), false);
  const bandeau = await import("../src/gestion/js/bandeau-calc.mjs");
  const liste = await import("../src/gestion/js/demandes-site-calc.mjs");
  assert.equal(liste.produitSite, undefined, "demandes-site-calc.mjs n'a plus d'alias de la recherche");
  // Le bandeau ne vise que des pages du site : jamais une sortie du carnet.
  assert.equal(bandeau.produitSite("4-islands").id, "4-islands");
  assert.equal(bandeau.produitSite("aonang-vip-hong"), null);
  assert.equal(bandeau.produitSite("ang-thong-big-boat"), null);
  assert.equal(bandeau.produitSite(PRODUITS_SITE.find((p) => p.marque === "taxi").id).marque, "taxi");
  // Les noms d'une option, normalisés, sont une seule liste.
  const { nomsDeOption } = await import("../src/gestion/js/carnet-ages.mjs");
  assert.deepEqual(nomsDeOption({ id: "with-kayak", titre: "With kayak", alias: ["avec-kayak", "Avec kayak"] }), ["with kayak", "with kayak", "avec kayak", "avec kayak"]);
});

test("identifiants des sorties : aucune sortie du carnet (Koh Samui, Ao Nang) ni du guide de Koh Lanta n'entre en collision avec un identifiant du site Secret ou du carnet", () => {
  const idsSite = new Map();
  for (const p of PRODUITS_SITE) idsSite.set(p.id, (idsSite.get(p.id) || 0) + 1);
  for (const [id, n] of idsSite) assert.equal(n, 1, `${id} : identifiant du site en double`);
  const idsCarnet = PRODUITS_CARNET.map((p) => p.id);
  assert.equal(new Set(idsCarnet).size, idsCarnet.length, "identifiant du carnet en double");
  for (const p of PRODUITS_CARNET) assert.ok(!idsSite.has(p.id), `${p.id} (${p.guide}) : aussi un identifiant du site Secret`);
  assert.ok(PRODUITS_CARNET.some((p) => p.guide === "koh-samui") && PRODUITS_CARNET.some((p) => p.guide === "aonang"));
  // Le guide de Koh Lanta n'a que des identifiants du site, aucun du carnet.
  for (const id of SORTIES_KOH_LANTA) {
    assert.ok(idsSite.has(id), `${id} : absent du site`);
    assert.ok(!idsCarnet.includes(id), `${id} : aussi un identifiant du carnet`);
    assert.equal(sortieParId(id).guide, undefined, `${id} : se résout vers le site`);
  }
  for (const p of PRODUITS_CARNET) assert.equal(sortieParId(p.id), p, `${p.id} : se résout vers le carnet`);
});

// ---- Troisième relecture de la PR 333 -----------------------------------------------------------------------------------------------------
const SAMUI = "https://zwaldtravelplanner.com/carnet/koh-samui-excursions-bateau/";
const ligneSamui = (produit_id, option_id, option_titre, extra = {}) => ({ marque: "secret", produit_id, produit: "x", option_id, option_titre, date_service: "2026-12-20", adultes: 2, enfants: 0, nom: "Anna", pickup: "Hotel Example", telephone: null, total_estime: 5000, devise: "THB", page_url: SAMUI,
  message: "Demande de réservation : x\nPersonnes : 2 adultes", ...extra });

test("« Modifier » : pas de doublon d'option, choisir la même option n'est pas un changement (Koh Samui avec/sans kayak, créneau, site Secret ordinaire)", () => {
  // Ang Thong en big boat, option « avec kayak » (libellé de la page) : la liste a deux options, pas trois, départ sous le titre canonique.
  const kayak = ligneSamui("ang-thong-big-boat", "avec-kayak", "avec kayak");
  const { options, courante } = optionsModifiables(kayak);
  assert.deepEqual(options.map((o) => o.titre), ["With kayak", "Without kayak"]);
  assert.equal(courante, "With kayak");
  assert.equal(titreCanonique(kayak), "With kayak");
  // Choisir la même option (sous son titre canonique, son libellé de la page ou son identifiant) : aucun titre posé dans les changements.
  for (const choix of ["With kayak", "avec kayak", "Avec-Kayak", "  with   kayak ", "avec-kayak"]) assert.equal(optionModifiee(kayak, choix), null, choix);
  assert.equal(optionModifiee(kayak, "Without kayak"), "Without kayak");
  assert.equal(optionModifiee(kayak, "sans kayak"), "sans kayak", "une autre option sous son nom de page est bien un changement");
  assert.equal(optionModifiee(kayak, ""), null);
  // Aucune annonce « Option: With kayak instead of avec kayak » : la confirmation sans changement d'option ne parle pas d'option.
  const final = { date: "2026-12-20", option_titre: titreCanonique(kayak), adultes: 2, enfants: 0, total: 5000, devise: "THB" };
  assert.equal(changements(kayak, final).find((c) => c.champ === "option"), undefined);
  assert.doesNotMatch(reponseConfirmation(kayak, final, { aujourdhui: AJD }), /Option:|instead of/);
  assert.match(reponseConfirmation(kayak, final, { aujourdhui: AJD }), /x – With kayak/, "le titre canonique, pas « avec kayak »");
  // Changer vraiment d'option : « Without kayak instead of With kayak ».
  const sans = changements(kayak, { ...final, option_titre: "Without kayak" }).find((c) => c.champ === "option");
  assert.deepEqual(sans, { champ: "option", avant: "With kayak", apres: "Without kayak" });
  // Créneau : la page envoie l'identifiant et le libellé du créneau, la sortie n'a qu'une option (« Whole boat »).
  const creneau = ligneSamui("ang-thong-speedboat-prive", "journee", "Journée, 09:00 à 17:00");
  const c = optionsModifiables(creneau);
  assert.deepEqual([c.options.map((o) => o.titre), c.courante], [["Whole boat"], "Whole boat"]);
  assert.equal(optionModifiee(creneau, "Whole boat"), null);
  assert.equal(changements(creneau, { date: "2026-12-20", option_titre: "Whole boat", adultes: 2, enfants: 0, devise: "THB" }).find((x) => x.champ === "option"), undefined);
  // Site Secret ordinaire : option sous son titre, ou sous un ancien titre, sans doublon non plus.
  const site = { marque: "secret", produit_id: "koh-rok-koh-haa", option_id: "join-in-speedboat", option_titre: "Join-in speedboat", page_url: "https://secrettravelandtour.com/tours/koh-rok-koh-haa/", message: "" };
  const s1 = optionsModifiables(site);
  assert.equal(s1.options.length, sortieParId("koh-rok-koh-haa").options.length, "aucun doublon avec l'ancien titre");
  assert.equal(s1.courante, "Day trip");
  assert.equal(optionModifiee(site, "Day trip"), null);
  assert.equal(optionModifiee(site, "Sunset trip"), "Sunset trip");
  // Option qui ne se reconnaît pas (nom changé depuis sur le site) : elle s'ajoute en tête, comme avant.
  const perdu = { ...site, option_id: "disparue", option_titre: "Ancien nom" };
  assert.equal(optionsModifiables(perdu).options[0].titre, "Ancien nom");
  assert.equal(optionsModifiables(perdu).courante, "Ancien nom");
  assert.equal(optionModifiee(perdu, "Ancien nom"), null);
  // La vue : liste et choix passent par ces fonctions, plus de comparaison de texte.
  const vue = lireFichier("src/gestion/js/views/demandes-site.mjs");
  assert.match(vue, /optionsModifiables\(d\)/);
  assert.match(vue, /optionModifiee\(d, option\.value\)/);
  assert.doesNotMatch(vue, /option\.value\.trim\(\) !== titreOption\(d\)/);
});

test("message refait pour une demande du carnet : le transfert coché, le message du client et le droit de parc arrivent jusqu'au dossier", () => {
  const recap = "Demande de réservation : Pig Island\nFormule : avec kayak\nDate : 20 décembre 2026\nCréneau : Matin, 09:00 à 13:00\nPersonnes : 2 adultes\nPrise en charge : Hotel Example\nTransfert depuis l'hôtel : oui (1 500 THB par van, indicatif)\nEstimation : 5 000 THB, à payer sur place après confirmation\nEntrée du parc à payer sur place : 400 THB\nNom : Anna\nWhatsApp : +41791234567\nMessage : allergie aux arachides\nRéf : SAM-AB12";
  const ligne = ligneSamui("ang-thong-big-boat", "avec-kayak", "avec kayak", { message: recap });
  const texte = texteDemande(ligne);
  assert.match(texte, /^Formula: avec kayak$/m);
  assert.match(texte, /^Slot: Matin, 09:00 à 13:00$/m);
  assert.match(texte, /^Extras: Hotel transfer oui \(1 500 THB par van, indicatif\)$/m);
  assert.match(texte, /^Park fee: 400 THB$/m);
  assert.match(texte, /^Message: allergie aux arachides$/m);
  // Lu par la fenêtre : le supplément de transfert et la remarque sont dans le dossier (notes).
  const lu = lireMessage(texte, AJD);
  assert.match(lu.extras, /Hotel transfer oui \(1 500 THB/);
  assert.equal(lu.remarque, "allergie aux arachides");
  assert.equal(lu.parc, "400 THB");
  const notes = notesDemande(lu);
  assert.match(notes, /Extras: Hotel transfer oui \(1 500 THB par van, indicatif\)/);
  assert.match(notes, /Client message: allergie aux arachides/);
  assert.match(notes, /Park fee \(paid on site\): 400 THB/);
  assert.match(notes, /Formula: avec kayak/);
  // Transfert refusé (« non ») : aucune ligne d'extras ; sans message du client : aucune ligne « Message: ».
  const non = texteDemande(ligneSamui("ang-thong-big-boat", "avec-kayak", "avec kayak", { message: "Demande de réservation : x\nPersonnes : 2 adultes\nTransfert depuis l'hôtel : non" }));
  assert.doesNotMatch(non, /^(Extras|Message|Park fee|Formula|Slot):/m);
  // Un message déjà au format du site (guide de Koh Lanta) est gardé tel quel, ses lignes « Extras: » comprises.
  const anglais = "Booking request: 4 Islands – Private longtail\nDate: Sun 20 Dec 2026\nGuests: 2 adults\nExtras: Add Koh Kradan\nName: Anna";
  assert.equal(texteDemande({ ...ligneSamui("4-islands", "private-longtail", "Private longtail"), message: anglais }), anglais);
});

test("« Estimated total » du message refait : écrit tant que l'option est celle demandée, retiré quand « Modifier » change l'option (kayak vers sans kayak, site Secret ordinaire aussi)", () => {
  const ligne = ligneSamui("ang-thong-big-boat", "avec-kayak", "avec kayak", { total_estime: 6000 });
  assert.match(texteDemande(ligne), /^Estimated total: 6,000 THB$/m);
  assert.match(texteDemande(ligne, { date: "2026-12-22" }), /^Estimated total: 6,000 THB$/m, "la date ne change pas le prix");
  assert.match(texteDemande(ligne, { option_titre: "With kayak" }), /^Estimated total: 6,000 THB$/m, "la même option sous un autre nom : le prix vaut encore");
  const sans = texteDemande(ligne, { option_titre: "Without kayak" });
  assert.match(sans, /^Booking request: Ang Thong Marine Park by big boat – Without kayak$/m);
  assert.doesNotMatch(sans, /Estimated total|Price on the site/);
  assert.equal(lireMessage(sans, AJD).prixSite, "", "la fenêtre ne porte plus le prix de l'ancienne option");
  // Site Secret ordinaire, message au format du site avec son prix : même règle.
  const ordinaire = { marque: "secret", produit_id: "4-islands", option_id: "join-in-longtail", option_titre: "Join-in longtail", page_url: "https://secrettravelandtour.com/tours/4-islands/", message: "Booking request: 4 Islands – Join-in longtail\nDate: Sun 20 Dec 2026\nGuests: 2 adults\nEstimated total: 2,000 THB\nName: Anna" };
  assert.match(texteDemande(ordinaire), /^Estimated total: 2,000 THB$/m);
  assert.doesNotMatch(texteDemande(ordinaire, { option_titre: "Join-in speedboat" }), /Estimated total/);
});

test("invités : une seule règle pour toutes les langues, et noms d'option normalisés une seule fois (« Avec-Kayak », espaces, casse)", () => {
  // Mêmes âges dits en anglais et en français : même résultat.
  assert.deepEqual(lireInvites("2 adults, 3 children (ages under 1, 3 and 10)"), lireInvitesFrancais("2 adultes, 3 enfants (moins d'1 an, 3 ans, 10 ans)"));
  assert.deepEqual(lireInvites("2 adults, 2 children"), lireInvitesFrancais("2 adultes, 2 enfants"), "âges absents : on garde le nombre");
  assert.deepEqual(lireInvites("1 adult"), lireInvitesFrancais("1 adulte"));
  const code = lireFichier("src/gestion/js/carnet-ages.mjs").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.equal((code.match(/ages\.filter\(\(a\) => a >= 3\)/g) || []).length, 1, "la règle des 3 ans n'est écrite qu'une fois");
  assert.match(code, /function invitesDe\(/);
  // Un seul nomsDeOption pour le tarif, l'âge et le titre.
  for (const option of [" Avec-Kayak ", "AVEC KAYAK", "avec_kayak", "With   Kayak"]) assert.equal(resoudreSortie({ carnet: { produit: "ang-thong-big-boat", option }, option: "" }).option.id, "with-kayak", option);
  assert.equal(resoudreSortie({ carnet: { produit: "ang-thong-big-boat", option: "" }, option: "  SANS-Kayak " }).option.id, "without-kayak");
  assert.equal(titreOption({ produit_id: "ang-thong-big-boat", option_id: "AVEC-KAYAK" }), "With kayak");
  assert.equal(titreOption({ produit_id: "ang-thong-big-boat", option_id: " Avec Kayak ".trim() }), "With kayak");
  const calc = lireFichier("src/gestion/js/demandes-site-calc.mjs");
  assert.doesNotMatch(calc, /\.alias \|\| \[\]\)\.includes/, "titreOption ne compare plus les alias à la main");
  assert.match(calc, /nomsDeOption\(x\)/);
});

// ---- Extension Koh Kradan du 4 Islands privé -------------------------------------------------------------------------------------------------
const MSG_KRADAN = (invites, extras = "Add Koh Kradan") => `Booking request: 4 Islands – Private longtail\nDate: Sun 20 Dec 2026\nGuests: ${invites}\n${extras ? `Extras: ${extras}\n` : ""}Name: Anna`;
const kradanOffre = (texte, { carnet = true, contexteVoulu = contexte, option = "private-longtail" } = {}) => {
  const d = lireMessage(texte, AJD);
  const lu = carnet ? ajusterAgesCarnet({ ...d, carnet: { produit: "4-islands", option } }) : d;
  return offresDuService(lu, texte, { phrase: texte, date: lu.date, adultes: lu.adultes, enfants: lu.enfants }, contexteVoulu)[0];
};

test("Extension Koh Kradan : « Add Koh Kradan » sur le 4 Islands privé ajoute la ligne et son prix au total, une fois, au prix d'un bateau (carnet ET site ordinaire)", () => {
  for (const carnet of [true, false]) {
    const base = kradanOffre(MSG_KRADAN("2 adults", ""), { carnet });
    assert.equal(base.extras, undefined, "sans l'extra : rien n'est ajouté");
    const avec = kradanOffre(MSG_KRADAN("2 adults"), { carnet });
    assert.equal(avec.total, base.total + 777, `carnet=${carnet} : le total reprend l'extension`);
    assert.deepEqual(avec.extras.map((x) => [x.source.id, x.qte, x.ligne]), [["kradan-fictif", 1, "Add Koh Kradan"]]);
    assert.equal(avec.id, base.id, "la tranche ne change pas");
    // Un prix par bateau, jamais par personne : de 2 à 6 personnes, une seule extension, le même supplément.
    for (const n of [2, 3, 4, 5, 6]) {
      const sans = kradanOffre(MSG_KRADAN(`${n} adults`, ""), { carnet });
      const kr = kradanOffre(MSG_KRADAN(`${n} adults`), { carnet });
      assert.equal(kr.extras.length, 1, `${n} personnes`);
      assert.equal(kr.total - sans.total, 777, `${n} personnes : le prix d'un bateau`);
    }
    // La ligne de la facture : un prix, une quantité de 1, jamais les personnes.
    const ligne = ligneDepuisPrestation(avec.extras[0].source, null, { langue: "en", qte: avec.extras[0].qte });
    assert.deepEqual([ligne.unite, ligne.qte, ligne.par, ligne.prestation_id], [777, 1, "boat", "kradan-fictif"]);
  }
  // Pas deux fois : l'extra dit deux fois, ou en minuscules, ou avec d'autres extras.
  for (const extras of ["Add Koh Kradan, Add Koh Kradan", "add koh kradan; Add Koh Kradan", "Add Koh Kradan | Other thing"]) assert.equal(kradanOffre(MSG_KRADAN("2 adults", extras)).extras.length, 1, extras);
  assert.equal(extrasDemandes({ ...lireMessage(MSG_KRADAN("2 adults"), AJD), carnet: { produit: "4-islands", option: "private-longtail" } }).length, 1);
  // Un autre extra, une autre option ou une autre sortie : rien.
  assert.equal(kradanOffre(MSG_KRADAN("2 adults", "Fishing rod")).extras, undefined);
  assert.equal(kradanOffre(MSG_KRADAN("2 adults").replace("Private longtail", "Join-in longtail"), { option: "join-in-longtail" }).extras, undefined, "le join-in a Kradan dans la sortie");
  const koh = "Booking request: Koh Rok & Koh Haa – Private longtail\nDate: Sun 20 Dec 2026\nGuests: 2 adults\nExtras: Add Koh Kradan\nName: Anna";
  const lu = lireMessage(koh, AJD);
  assert.equal(offresDuService({ ...lu, carnet: { produit: "koh-rok-koh-haa", option: "private-longtail" } }, koh, { phrase: koh, date: lu.date, adultes: 2, enfants: 0 }, contexte)[0].extras, undefined);
});

test("Extension Koh Kradan : la tranche change avec les personnes, « Modifier » vers une autre option retire l'extra, le retour la remet, la réponse la dit", () => {
  // Kradan + tranche changée : 2 personnes (tranche 1-2) puis 4 personnes (tranche 3-4) : la tranche et le prix de la tranche changent, l'extension reste la même.
  const deux = kradanOffre(MSG_KRADAN("2 adults"));
  const quatre = kradanOffre(MSG_KRADAN("2 adults, 2 children (ages 5 and 9)"));
  assert.equal(deux.ligneSite, "1 to 2 people");
  assert.equal(quatre.ligneSite, "3 to 4 people");
  assert.equal(quatre.total - deux.total, 6620 - 6110);
  assert.deepEqual([deux.extras[0].source.id, quatre.extras[0].source.id], ["kradan-fictif", "kradan-fictif"]);
  // « Modifier » : l'option passe du bateau privé au join-in. Le message refait garde la ligne « Extras: », mais le join-in n'a pas d'extension (Kradan y est déjà).
  const ligne = { marque: "secret", produit_id: "4-islands", produit: "4 Islands", option_id: "private-longtail", option_titre: "Private longtail", date_service: "2026-12-20", adultes: 2, enfants: 0, nom: "Anna", telephone: null, total_estime: 6887, devise: "THB", page_url: ZTP, message: MSG_KRADAN("2 adults") };
  const vers = texteDemande(ligne, { option_titre: "Join-in longtail" });
  assert.match(vers, /^Extras: Add Koh Kradan$/m);
  assert.doesNotMatch(vers, /Estimated total/, "le prix annoncé était celui du bateau privé");
  const joint = kradanOffre(vers, { option: "private-longtail" });
  assert.equal(joint.extras, undefined);
  assert.equal(joint.total, 2 * 1010);
  // Et dans l'autre sens : un message du join-in modifié vers le bateau privé reçoit l'extension.
  const ligneJoint = { ...ligne, option_id: "join-in-longtail", option_titre: "Join-in longtail", message: MSG_KRADAN("2 adults").replace("Private longtail", "Join-in longtail") };
  const retour = kradanOffre(texteDemande(ligneJoint, { option_titre: "Private longtail" }), { option: "join-in-longtail" });
  assert.deepEqual([retour.extras.length, retour.total], [1, 6110 + 777]);
  // Réponse de confirmation : l'extension est dite, le total est celui de la fenêtre.
  const final = { date: "2026-12-20", option_titre: "Private longtail", adultes: 2, enfants: 0, total: deux.total, extras: deux.extras.map((x) => x.ligne), devise: "THB" };
  const reponse = reponseConfirmation(ligne, final, { aujourdhui: AJD });
  assert.match(reponse, /^Extras: Add Koh Kradan$/m);
  assert.match(reponse, new RegExp(`^Total: ${deux.total.toLocaleString("en-US")} THB$`, "m"));
  assert.doesNotMatch(reponseConfirmation(ligne, { ...final, extras: [] }, { aujourdhui: AJD }), /Extras:/);
  // La fiche de la liste dit l'extra demandé.
  assert.equal(champsCarnet(ligne).extras, "Add Koh Kradan");
  assert.equal(champsCarnet({ ...ligne, message: MSG_KRADAN("2 adults", "") }).extras, "");
});

test("Extension Koh Kradan : sans tarif en base (SQL du guide pas encore passé) l'offre le dit, la tranche reste juste", () => {
  const sansExtension = { ...contexte, prestations: prestations.filter((p) => p.id !== "kradan-fictif") };
  const o = kradanOffre(MSG_KRADAN("2 adults"), { contexteVoulu: sansExtension });
  assert.equal(o.avertissement, "extra_sans_tarif");
  assert.equal(o.extraManquant, "Add Koh Kradan");
  assert.equal(o.extras, undefined);
  assert.equal(o.total, 6110, "le prix de la tranche seul");
  // Une extension masquée n'est pas proposée non plus.
  const masquee = { ...contexte, prestations: prestations.map((p) => (p.id === "kradan-fictif" ? { ...p, actif: false } : p)) };
  assert.equal(kradanOffre(MSG_KRADAN("2 adults"), { contexteVoulu: masquee }).avertissement, "extra_sans_tarif");
  // La clé du module ne dit ni nom ni montant ; le mapping la porte seule.
  assert.deepEqual(EXTRAS_DU_SITE.map((x) => Object.keys(x).sort()), [["cle", "ligne", "option", "produit"]]);
  assert.equal(EXTRAS_DU_SITE[0].ligne, "Add Koh Kradan");
  assert.doesNotMatch(JSON.stringify(EXTRAS_DU_SITE), /\d{3}|villa|net/i);
  const doc = lireFichier("docs/gestion/carnet-aonang-lanta.md");
  assert.match(doc, /Add Koh Kradan/);
  const vue = lireFichier("src/gestion/js/views/demande.mjs");
  assert.match(vue, /offre\.extras/, "la fenêtre fait une ligne par extra");
  assert.match(vue, /extra_sans_tarif/);
});
