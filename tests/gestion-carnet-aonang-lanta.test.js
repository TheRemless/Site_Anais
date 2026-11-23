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
import { lireMessage, offresDuService, optionDuSite, notesDemande, extrasDemandes, extrasCrees, serviceCree, extrasDeLaDemande } from "../src/gestion/js/demande-calc.mjs";
import { ajusterAgesCarnet, baremeEnfant, sortieParId, resoudreSortie, resoudreProduit, agesDuMessage, lireInvites, lireInvitesFrancais, LIGNE_ENFANT, cleTexte } from "../src/gestion/js/carnet-ages.mjs";
import { guideDeLaRef, carnetDuMessage } from "../src/gestion/js/carnet-colle.mjs";
import { REFS_CARNET } from "../src/gestion/js/carnet-produits.mjs";
import { demandeTarifee, autresSorties, guideDeLaPage, champsCarnet, optionsModifiables, optionModifiee, titreCanonique, titreOption, texteDemande, changements, reponseConfirmation, finalDeConfirmation, extrasDuMessage, extrasPourOption, transfertDuMessage } from "../src/gestion/js/demandes-site-calc.mjs";
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

test("message collé sans référence du carnet : lu comme un message libre, ni barème d'âge ni tarif de la sortie ; avec la référence, voir le test du collage", () => {
  // Le même récapitulatif SANS sa ligne « Réf : » : un client qui écrit librement. Gestion ne peut pas savoir qu'il vient du carnet et ne devine rien.
  const recap = "Demande de réservation : Ang Thong en big boat, journée en groupe\nFormule : avec kayak\nPersonnes : 1 adulte, 1 enfant (12 ans)";
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
  assert.match(texte, /^Hotel transfer: requested \(indicative 1 500 THB per van\)$/m);
  assert.doesNotMatch(texte, /^Extras:/m, "le transfert est un prix indicatif à confirmer, pas un extra acquis");
  assert.match(texte, /^Park fee: 400 THB$/m);
  assert.match(texte, /^Message: allergie aux arachides$/m);
  // Lu par la fenêtre : le supplément de transfert et la remarque sont dans le dossier (notes).
  const lu = lireMessage(texte, AJD);
  assert.equal(lu.extras, "");
  assert.equal(lu.transfertHotel, "requested (indicative 1 500 THB per van)");
  assert.equal(lu.remarque, "allergie aux arachides");
  assert.equal(lu.parc, "400 THB");
  const notes = notesDemande(lu);
  assert.match(notes, /Hotel transfer: requested \(indicative 1 500 THB per van\)/);
  assert.doesNotMatch(notes, /Extras:|oui|indicatif/, "aucun mot français du récapitulatif ne passe dans les notes");
  assert.match(notes, /Client message: allergie aux arachides/);
  assert.match(notes, /Park fee \(paid on site\): 400 THB/);
  assert.match(notes, /Formula: avec kayak/);
  // Transfert refusé (« non ») : aucune ligne d'extras ; sans message du client : aucune ligne « Message: ».
  const non = texteDemande(ligneSamui("ang-thong-big-boat", "avec-kayak", "avec kayak", { message: "Demande de réservation : x\nPersonnes : 2 adultes\nTransfert depuis l'hôtel : non" }));
  assert.doesNotMatch(non, /^(Extras|Hotel transfer|Message|Park fee|Formula|Slot):/m);
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

test("Extension Koh Kradan : « Add Koh Kradan » sur le 4 Islands privé d'une demande du carnet ajoute la ligne et son prix au total, une fois, au prix d'un bateau", () => {
  {
    const carnet = true;
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
  // « Modifier » : l'option passe du bateau privé au join-in : le join-in n'a pas d'extension (Kradan y est déjà), le message n'en garde pas la ligne.
  const ligne = { marque: "secret", produit_id: "4-islands", produit: "4 Islands", option_id: "private-longtail", option_titre: "Private longtail", date_service: "2026-12-20", adultes: 2, enfants: 0, nom: "Anna", telephone: null, total_estime: 6887, devise: "THB", page_url: ZTP, message: MSG_KRADAN("2 adults") };
  const vers = texteDemande(ligne, { option_titre: "Join-in longtail" });
  assert.doesNotMatch(vers, /Extras|Kradan/);
  assert.doesNotMatch(vers, /Estimated total/, "le prix annoncé était celui du bateau privé");
  const joint = kradanOffre(vers, { option: "private-longtail" });
  assert.equal(joint.extras, undefined);
  assert.equal(joint.total, 2 * 1010);
  // Et dans l'autre sens : un message du join-in modifié vers le bateau privé reçoit l'extension.
  const ligneJoint = { ...ligne, option_id: "join-in-longtail", option_titre: "Join-in longtail", message: MSG_KRADAN("2 adults").replace("Private longtail", "Join-in longtail") };
  const retour = kradanOffre(texteDemande(ligneJoint, { option_titre: "Private longtail" }), { option: "join-in-longtail" });
  assert.deepEqual([retour.extras.length, retour.total], [1, 6110 + 777]);
  // Réponse de confirmation : l'extension est dite, le total est celui de la fenêtre.
  const final = { date: "2026-12-20", option_titre: "Private longtail", adultes: 2, enfants: 0, total: deux.total, extras: ["Add Koh Kradan"], devise: "THB" };
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
  assert.deepEqual(o.extrasManquants, ["Add Koh Kradan"]);
  assert.equal(o.avertissement, "", "l'avertissement principal n'est pas pris par l'extra : le champ est distinct");
  assert.equal(o.extras, undefined);
  assert.equal(o.total, 6110, "le prix de la tranche seul");
  // Une extension masquée n'est pas proposée non plus.
  const masquee = { ...contexte, prestations: prestations.map((p) => (p.id === "kradan-fictif" ? { ...p, actif: false } : p)) };
  assert.deepEqual(kradanOffre(MSG_KRADAN("2 adults"), { contexteVoulu: masquee }).extrasManquants, ["Add Koh Kradan"]);
  // La clé du module ne dit ni nom ni montant ; le mapping la porte seule.
  assert.deepEqual(EXTRAS_DU_SITE.map((x) => Object.keys(x).sort()), EXTRAS_DU_SITE.map(() => ["cle", "ligne", "option", "par", "produits"]));
  assert.equal(EXTRAS_DU_SITE[0].ligne, "Add Koh Kradan");
  assert.doesNotMatch(JSON.stringify(EXTRAS_DU_SITE), /\d{3}|villa|net/i);
  const doc = lireFichier("docs/gestion/carnet-aonang-lanta.md");
  assert.match(doc, /Add Koh Kradan/);
  const vue = lireFichier("src/gestion/js/views/demande.mjs");
  assert.match(vue, /offre\.extras/, "la fenêtre fait une ligne par extra");
  assert.match(vue, /extra_sans_tarif/);
});

// ---- Quatrième relecture : l'extension Kradan ne vaut que pour le carnet, et de bout en bout ----------------------------------------------------------
const LIGNE_4I = { marque: "secret", produit_id: "4-islands", produit: "4 Islands", option_id: "private-longtail", option_titre: "Private longtail", date_service: "2026-12-20", adultes: 2, enfants: 0, nom: "Anna", telephone: null, total_estime: 6887, devise: "THB", page_url: ZTP, message: MSG_KRADAN("2 adults") };
// Les lignes que la fenêtre crée pour une offre, comme demande.mjs les fait (la ligne du tarif, puis une ligne par extra).
const lignesDeLOffre = (o) => [ligneDepuisPrestation(o.source, null, { langue: "en", qte: 1 }), ...(o.extras || []).map((x) => ligneDepuisPrestation(x.source, null, { langue: "en", qte: x.qte }))];

test("réponse de confirmation : les extras viennent des lignes RÉELLEMENT créées, par finalDeConfirmation (le chemin de confirmer_), jamais d'un final fourni à la main", () => {
  const offre = kradanOffre(MSG_KRADAN("2 adults"));
  const lignes = lignesDeLOffre(offre);
  // La ligne Kradan est créée : la réponse l'annonce, avec le total de la facture.
  const cree = [{ titre: offre.titre, date: "2026-12-20", heure: "", adultes: 2, enfants: 0, extras: extrasCrees(lignes, prestations) }];
  assert.deepEqual(cree[0].extras, ["Add Koh Kradan"]);
  const final = finalDeConfirmation(LIGNE_4I, {}, { services: cree, total: offre.total, devise: "THB" });
  assert.match(reponseConfirmation(LIGNE_4I, final, { aujourdhui: AJD }), /^Extras: Add Koh Kradan$/m);
  // Anaïs supprime la ligne Kradan dans la fenêtre avant de créer : l'offre la proposait, mais la réponse ne l'annonce pas.
  const sansLigne = [{ titre: offre.titre, date: "2026-12-20", adultes: 2, enfants: 0, extras: extrasCrees(lignes.slice(0, 1), prestations) }];
  assert.deepEqual(sansLigne[0].extras, []);
  const final2 = finalDeConfirmation(LIGNE_4I, {}, { services: sansLigne, total: 6110, devise: "THB" });
  assert.doesNotMatch(reponseConfirmation(LIGNE_4I, final2, { aujourdhui: AJD }), /Extras|Kradan/);
  // Plusieurs services : chacun dit ses extras.
  const deux = finalDeConfirmation(LIGNE_4I, {}, { services: [cree[0], { ...sansLigne[0], date: "2026-12-22" }], total: 13000, devise: "THB" });
  const rep = reponseConfirmation(LIGNE_4I, deux, { aujourdhui: AJD });
  assert.equal((rep.match(/Extras: Add Koh Kradan/g) || []).length, 1);
  // Une ligne sans tarif connu ou une ligne libre ne devient jamais un extra.
  assert.deepEqual(extrasCrees([{ prestation_id: "inconnu" }, { prestation_id: null, libelle: "Add Koh Kradan" }], prestations), []);
  // La vue passe par ces fonctions : le final de confirmer_ n'est plus écrit à la main et les extras des services viennent des lignes.
  const vue = lireFichier("src/gestion/js/views/demandes-site.mjs");
  assert.match(vue, /finalDeConfirmation\(d, modifs, /);
  assert.doesNotMatch(vue, /const final = \{\s*\.\.\.\(services\.length/);
  const fenetre = lireFichier("src/gestion/js/views/demande.mjs");
  assert.match(fenetre, /serviceCree\(\{.*\}, b\.lignes\.filter/);
  assert.doesNotMatch(fenetre, /extras: \(\(etatDe\(sv\)\.offre \|\| \{\}\)\.extras/);
});

test("extra sans tarif : dit EN PLUS de l'avertissement principal (groupe hors tranche, sur place), jamais caché derrière lui", () => {
  const sansExtension = { ...contexte, prestations: prestations.filter((p) => p.id !== "kradan-fictif") };
  const hors = kradanOffre(MSG_KRADAN("8 adults"), { contexteVoulu: sansExtension });
  assert.equal(hors.avertissement, "groupe_hors_tranche");
  assert.deepEqual(hors.extrasManquants, ["Add Koh Kradan"]);
  // Avec le tarif : pas d'extra manquant, l'avertissement du groupe reste seul.
  assert.equal(kradanOffre(MSG_KRADAN("8 adults")).extrasManquants, undefined);
  // La fenêtre affiche l'avertissement principal ET celui de l'extra : le second n'est pas dans la chaîne « else if » du premier.
  const fenetre = lireFichier("src/gestion/js/views/demande.mjs");
  assert.match(fenetre, /offre\.extrasManquants && offre\.extrasManquants\.length\) alertes\.push\(tr\(AVERTISSEMENTS\.extra_sans_tarif\)\)/);
  assert.doesNotMatch(fenetre, /else if \(offre && offre\.extrasManquants/);
});

test("liste de sorties : les extras se lisent dans les lignes de CHAQUE sortie, ceux de la première sont ceux du service préparé", () => {
  const liste = (a, b) => `Trip list: 2 trips\nGuests: 2 adults\nPickup: Hotel Sunset\nName: Anna\n\nSat 19 Dec 2026\n4 Islands – ${a.titre}\n${a.extras ? `Extras: ${a.extras}\n` : ""}\nSun 20 Dec 2026\n4 Islands – ${b.titre}${b.extras ? `\nExtras: ${b.extras}` : ""}`;
  const prive = { titre: "Private longtail" };
  const avec = { titre: "Private longtail", extras: "Add Koh Kradan" };
  const joint = { titre: "Join-in longtail" };
  const calc = (texte, option = "private-longtail") => {
    const d = lireMessage(texte, AJD);
    const lu = ajusterAgesCarnet({ ...d, carnet: { produit: "4-islands", option } });
    return { d, offre: offresDuService(lu, texte, { phrase: texte, date: lu.date, adultes: lu.adultes, enfants: lu.enfants }, contexte)[0] };
  };
  // Kradan seulement le jour 2 : les 700 ne tombent pas sur le jour 1, et la ligne reste dans les notes de l'autre sortie.
  const j2 = calc(liste(prive, avec));
  assert.equal(j2.d.extras, "");
  assert.equal(j2.offre.extras, undefined);
  assert.equal(j2.offre.total, 6110);
  assert.match(notesDemande(j2.d), /Other trips: Sun 20 Dec 2026: 4 Islands – Private longtail \(Extras: Add Koh Kradan\)/);
  // Kradan seulement le jour 1 : compté sur la sortie préparée.
  const j1 = calc(liste(avec, prive));
  assert.equal(j1.d.extras, "Add Koh Kradan");
  assert.equal(j1.offre.extras.length, 1);
  assert.equal(j1.offre.total, 6110 + 777);
  assert.doesNotMatch(notesDemande(j1.d), /Other trips:.*Extras/);
  // Première sortie d'une autre option, Kradan sur la 2e : jamais compté sur la première (le join-in a déjà Kradan), gardé dans les notes.
  const autre = calc(liste(joint, avec), "join-in-longtail");
  assert.equal(autre.offre.extras, undefined);
  assert.match(notesDemande(autre.d), /\(Extras: Add Koh Kradan\)/);
  // Message sans liste : inchangé.
  assert.equal(lireMessage(MSG_KRADAN("2 adults"), AJD).extras, "Add Koh Kradan");
});

test("transfert depuis l'hôtel du récapitulatif français : ligne distincte « Hotel transfer: », jamais dans les extras ni dans la fiche des extras", () => {
  const recap = "Demande de réservation : Pig Island\nFormule : avec kayak\nDate : 20 décembre 2026\nPersonnes : 2 adultes\nTransfert depuis l'hôtel : oui (1 500 THB par van, indicatif)\nMessage : allergie aux arachides\nRéf : SAM-AB12";
  assert.equal(extrasDuMessage(recap), "", "un prix indicatif n'est pas un extra acquis");
  const ligne = ligneSamui("ang-thong-big-boat", "avec-kayak", "avec kayak", { message: recap });
  const fiche = champsCarnet(ligne);
  assert.equal(fiche.extras, "");
  assert.equal(fiche.transfert, "requested (indicative 1 500 THB per van)");
  const texte = texteDemande(ligne);
  const lu = lireMessage(texte, AJD);
  assert.equal(lu.extras, "");
  assert.equal(extrasDemandes({ ...lu, carnet: { produit: "ang-thong-big-boat", option: "avec-kayak" } }).length, 0);
  const notes = notesDemande(lu);
  assert.match(notes, /Hotel transfer: requested \(indicative 1 500 THB per van\)\. Park fee|Hotel transfer: requested \(indicative 1 500 THB per van\)/);
  assert.match(notes, /Client message: allergie aux arachides/);
  assert.doesNotMatch(notes, /Extras|oui|indicatif|par van/);
  // Transfert refusé : aucune ligne. Extras écrits à la façon du site ET transfert : deux lignes séparées.
  assert.equal(champsCarnet(ligneSamui("ang-thong-big-boat", "avec-kayak", "avec kayak", { message: "Demande de réservation : x\nTransfert depuis l'hôtel : non" })).transfert, "");
  const les2 = texteDemande(ligneSamui("ang-thong-big-boat", "avec-kayak", "avec kayak", { message: `${recap}\nExtras: Fishing rod` }));
  assert.match(les2, /^Extras: Fishing rod$/m);
  assert.match(les2, /^Hotel transfer: requested/m);
});

test("« Modifier » vers une option sans l'extension : le message refait et les notes ne gardent que les extras applicables à l'option finale", () => {
  const avec = (extras) => ({ ...LIGNE_4I, message: MSG_KRADAN("2 adults", extras) });
  // Bateau privé vers join-in : l'extension s'en va du message et des notes.
  const vers = texteDemande(avec("Add Koh Kradan"), { option_titre: "Join-in longtail" });
  assert.doesNotMatch(vers, /Extras|Kradan/);
  assert.doesNotMatch(notesDemande(lireMessage(vers, AJD)), /Extras|Kradan/);
  // Même option (nom différent) ou sans changement d'option : l'extension reste.
  assert.match(texteDemande(avec("Add Koh Kradan"), { option_titre: "Private longtail" }), /^Extras: Add Koh Kradan$/m);
  assert.match(texteDemande(avec("Add Koh Kradan"), { date: "2026-12-22" }), /^Extras: Add Koh Kradan$/m);
  // Les autres extras restent, et « per boat » de la refonte du site part avec l'extension.
  assert.match(texteDemande(avec("Add Koh Kradan; Fishing rod"), { option_titre: "Join-in longtail" }), /^Extras: Fishing rod$/m);
  assert.match(texteDemande(avec("Fishing rod, Add Koh Kradan, per boat"), { option_titre: "Join-in longtail" }), /^Extras: Fishing rod$/m);
  assert.equal(extrasPourOption("Add Koh Kradan, per boat", "4-islands", "join-in-longtail"), "");
  assert.equal(extrasPourOption("Add Koh Kradan, per boat", "4-islands", "private-longtail"), "Add Koh Kradan, per boat");
  // Message refait (récapitulatif de la page) : même règle.
  const refait = { ...avec(""), message: "Demande de réservation : x\nExtras: Add Koh Kradan\nPersonnes : 2 adultes" };
  assert.doesNotMatch(texteDemande(refait, { option_titre: "Join-in longtail" }), /Extras/);
  assert.match(texteDemande(refait), /^Extras: Add Koh Kradan$/m);
});

test("l'extension Kradan ne vaut que pour une demande du carnet : le site Secret ordinaire n'est pas touché, et la doc ne dit plus le contraire", () => {
  const ordinaire = kradanOffre(MSG_KRADAN("2 adults"), { carnet: false });
  const base = kradanOffre(MSG_KRADAN("2 adults", ""), { carnet: false });
  assert.equal(ordinaire.extras, undefined);
  assert.equal(ordinaire.extrasManquants, undefined);
  assert.equal(ordinaire.total, base.total, "Gestion n'ajoute rien à une demande du site ordinaire");
  assert.deepEqual(extrasDemandes(lireMessage(MSG_KRADAN("2 adults"), AJD)), []);
  const doc = lireFichier("docs/gestion/carnet-aonang-lanta.md");
  assert.doesNotMatch(doc, /même résultat que pour une demande du site Secret ordinaire/);
  assert.match(doc, /demande du carnet/);
});

test("sources uniques : extras demandés calculés une fois par proposerOffres, une seule règle pour Ao Nang, un seul lecteur de ligne, commentaires au bon endroit", () => {
  const dc = lireFichier("src/gestion/js/demande-calc.mjs");
  assert.equal((dc.match(/(?<!function )extrasDeLaDemande\(d\);/g) || []).length, 1, "extrasDeLaDemande n'est appelé qu'une fois, dans proposerOffres");
  assert.doesNotMatch(dc, /function ajouterExtras\(offre, d,/);
  const calc = lireFichier("src/gestion/js/demandes-site-calc.mjs");
  assert.equal((calc.match(/\[\/\^[a-z?-]+\(-\|\$\)\/, "[a-z-]+"\]/g) || []).length, 3, "trois guides, une règle chacun");
  assert.equal(guideDeLaPage({ page_url: "https://zwaldtravelplanner.com/carnet/ao-nang-x7k2/" }), "aonang");
  assert.equal(guideDeLaPage({ page_url: "https://zwaldtravelplanner.com/carnet/aonang-x7k2/" }), "aonang");
  assert.equal(guideDeLaPage({ page_url: "https://zwaldtravelplanner.com/carnet/aonangement-x7k2/" }), null);
  assert.doesNotMatch(calc, /const lire = \(re\) => \(re\.exec\(message/, "un seul lecteur de ligne");
  assert.equal((calc.match(/const lireLigne = /g) || []).length, 1);
  // Chaque commentaire de tête décrit la fonction qui le suit.
  const avant = (marque) => calc.slice(0, calc.indexOf(marque)).split("\n").slice(-4).join("\n");
  assert.match(avant("export function autresSorties"), /Les autres sorties/);
  assert.doesNotMatch(avant("export function guideDeLaPage"), /Les autres sorties/);
  assert.match(avant("function lignesDuRecapitulatif"), /lignes du récapitulatif/);
  assert.doesNotMatch(avant("export const extrasDuMessage"), /lignes du récapitulatif/);
});

// ---- Cinquième relecture ---------------------------------------------------------------------------------------------------------------------------
test("extra demandé qui ne peut créer aucune ligne : l'offre le dit (offre du recouvrement de mots, option non reconnue), il ne disparaît pas en silence", () => {
  // Option que la page envoie mais que Gestion ne reconnaît pas : seules des offres du recouvrement de mots sont proposées, aucune ne peut porter la ligne : l'extra est signalé sur chacune.
  const inconnue = "Booking request: 4 Islands – Moonlight cruise\nDate: Sun 20 Dec 2026\nGuests: 2 adults\nExtras: Add Koh Kradan\nName: Anna";
  const dm = { ...lireMessage(inconnue, AJD), carnet: { produit: "4-islands", option: "disparue" } };
  const offresMots = offresDuService(dm, inconnue, { phrase: "Private 4 Islands charter", date: dm.date, adultes: 2, enfants: 0 }, contexte);
  assert.ok(offresMots.length > 0);
  for (const o of offresMots) assert.deepEqual(o.extrasManquants, ["Add Koh Kradan"], o.titre);
  const d = { ...lireMessage(MSG_KRADAN("2 adults"), AJD), carnet: { produit: "4-islands", option: "private-longtail" } };
  // Option reconnue, offre du site : la ligne est ajoutée, rien de manquant.
  const bonne = kradanOffre(MSG_KRADAN("2 adults"));
  assert.equal(bonne.extrasManquants, undefined);
  // Les autres offres de la même demande, qui ne sont pas des offres du site, le disent aussi.
  const toutes = offresDuService({ ...d, prestation: "4 Islands", option: "Private longtail" }, MSG_KRADAN("2 adults"), { phrase: "4 Islands private", date: d.date, adultes: 2, enfants: 0 }, contexte);
  for (const o of toutes) assert.ok(o.extras ? o.extrasManquants === undefined : (o.extrasManquants || []).includes("Add Koh Kradan"), `${o.titre} : extra porté ou signalé`);
  // Une demande sans extra, ou d'une autre option (join-in), ne signale rien.
  assert.equal(kradanOffre(MSG_KRADAN("2 adults", "")).extrasManquants, undefined);
  // Une extension demandée sur le join-in (Kradan y est déjà dans la sortie) n'est pas ajoutée, et l'offre le dit.
  const joint = kradanOffre(MSG_KRADAN("2 adults").replace("Private longtail", "Join-in longtail"), { option: "join-in-longtail" });
  assert.equal(joint.extras, undefined);
  assert.deepEqual(joint.extrasManquants, ["Add Koh Kradan"]);
});

test("liste de sorties du site ordinaire : l'Extras d'en-tête et celui de pied restent dans les notes, comme avant ; ceux de la première sortie restent à elle", () => {
  const corps = "Sat 21 Nov 2026\n4 Islands – Join-in longtail\nPrice: Adult: 1,000 THB\n\nMon 23 Nov 2026\nKoh Rok – Custom day";
  const entete = lireMessage(`Trip list: 2 trips\nGuests: 2 adults\nExtras: Late checkout\nName: Anna\n\n${corps}`, AJD);
  assert.equal(entete.extras, "", "l'extra d'en-tête n'est pas celui de la première sortie");
  assert.match(notesDemande(entete), /Extras: Late checkout/);
  const pied = lireMessage(`Trip list: 2 trips\nGuests: 2 adults\nName: Anna\n\n${corps}\n\nExtras: Baby cot`, AJD);
  assert.equal(pied.extras, "");
  assert.match(notesDemande(pied), /Extras: Baby cot/);
  assert.doesNotMatch(notesDemande(pied), /Other trips:[^.]*Baby cot/, "le pied n'est pas rattaché à la dernière sortie");
  // En-tête, première sortie et pied : tous gardés.
  const tout = lireMessage(`Trip list: 2 trips\nGuests: 2 adults\nExtras: Late checkout\nName: Anna\n\nSat 21 Nov 2026\n4 Islands – Join-in longtail\nExtras: Fishing rod\n\nMon 23 Nov 2026\nKoh Rok – Custom day\nExtras: Snorkel mask\n\nExtras: Baby cot`, AJD);
  assert.equal(tout.extras, "Fishing rod");
  for (const x of ["Late checkout", "Fishing rod", "Baby cot"]) assert.match(notesDemande(tout), new RegExp(`Extras: [^.]*${x}`));
  assert.match(notesDemande(tout), /Other trips: Mon 23 Nov 2026: Koh Rok – Custom day \(Extras: Snorkel mask\)/);
  // Une liste sans extra : aucune ligne « Extras: ».
  assert.doesNotMatch(notesDemande(lireMessage(`Trip list: 2 trips\nGuests: 2 adults\nName: Anna\n\n${corps}`, AJD)), /Extras:/);
});

test("transfert depuis l'hôtel : toutes les formes du récapitulatif de la page sont traduites, aucun mot français dans la ligne anglaise", () => {
  const t = (v) => transfertDuMessage(`Transfert depuis l'hôtel : ${v}`);
  assert.equal(t("oui (1 500 THB par van, indicatif)"), "requested (indicative 1 500 THB per van)");
  assert.equal(t("oui (1\u202f500\u00a0THB par van, indicatif)"), "requested (indicative 1 500 THB per van)");
  assert.equal(t("oui (900 THB par personne, indicatif)"), "requested (indicative 900 THB per person)");
  assert.equal(t("oui (1 500 THB par bateau, indicatif)"), "requested (indicative 1 500 THB per boat)");
  assert.equal(t("oui (1 500 THB, indicatif)"), "requested (indicative 1 500 THB)");
  assert.equal(t("oui (indicatif)"), "requested (indicative)");
  assert.equal(t("oui"), "requested");
  assert.equal(t("non"), "");
  for (const v of ["oui (1 500 THB par van, indicatif)", "oui (900 THB par personne, indicatif)", "oui (indicatif)", "oui (1 500 THB par bateau, indicatif)"]) assert.doesNotMatch(t(v), /\b(oui|par|personne|indicatif|bateau)\b/i, v);
  // Forme inconnue : le texte tel quel, entre guillemets.
  assert.equal(t("oui (1 500 THB par hélicoptère, indicatif)"), 'requested, "oui (1 500 THB par hélicoptère, indicatif)"');
});

test("total d'un service créé : même source que ses extras, les lignes réellement créées (ligne Kradan supprimée = ni extra ni prix)", () => {
  const offre = kradanOffre(MSG_KRADAN("2 adults"));
  const lignes = lignesDeLOffre(offre);
  const base = { titre: offre.titre, date: "2026-12-20", adultes: 2, enfants: 0 };
  const avec = serviceCree(base, lignes, prestations);
  assert.deepEqual([avec.total, avec.extras], [offre.total, ["Add Koh Kradan"]]);
  const sans = serviceCree(base, lignes.slice(0, 1), prestations);
  assert.deepEqual([sans.total, sans.extras], [6110, []], "le total de l'offre (avec Kradan) n'est plus repris");
  assert.equal(serviceCree(base, [{ kind: "texte", libelle: "à payer sur place" }], prestations).total, null);
  assert.equal(serviceCree(base, [...lignes, { kind: "ligne", unite: 100.5, qte: 2, prestation_id: null }], prestations).total, offre.total + 201);
  const fenetre = lireFichier("src/gestion/js/views/demande.mjs");
  assert.doesNotMatch(fenetre, /total: \(etatDe\(sv\)\.offre \|\| \{\}\)\.total \?\? null, extras:/);
});

test("extrasPourOption : un extra se compare entier, les séparateurs d'origine sont gardés, rien à retirer = texte inchangé", () => {
  const r = (t, opt = "join-in-longtail") => extrasPourOption(t, "4-islands", opt);
  assert.equal(r("Add Koh Kradan sunset dinner"), "Add Koh Kradan sunset dinner", "un autre extra qui commence pareil reste");
  assert.equal(r("Add Koh Kradan sunset dinner; Add Koh Kradan"), "Add Koh Kradan sunset dinner");
  assert.equal(r("Fishing rod | Add Koh Kradan | Pizza"), "Fishing rod | Pizza");
  assert.equal(r("Fishing rod;Pizza"), "Fishing rod;Pizza", "rien à retirer : texte exactement inchangé, séparateurs compris");
  assert.equal(r("Pizza | Fishing rod; Beer"), "Pizza | Fishing rod; Beer");
  assert.equal(r("Add Koh Kradan; Fishing rod"), "Fishing rod");
  assert.equal(r("Fishing rod, Add Koh Kradan, per boat"), "Fishing rod");
  assert.equal(r("Add Koh Kradan, per boat"), "");
  assert.equal(r("Add Koh Kradan, per boat", "private-longtail"), "Add Koh Kradan, per boat");
  assert.equal(r("add koh kradan"), "");
  // L'extension ne s'applique pas non plus à « Add Koh Kradan sunset dinner » côté tarif.
  assert.deepEqual(extrasDemandes({ ...lireMessage(MSG_KRADAN("2 adults", "Add Koh Kradan sunset dinner"), AJD), carnet: { produit: "4-islands", option: "private-longtail" } }), []);
});

test("code mort : plus d'import inutile de titreCanonique dans la vue des demandes, plus de boucle à un seul tour dans les tests", () => {
  const vue = lireFichier("src/gestion/js/views/demandes-site.mjs");
  assert.doesNotMatch(vue.split("\n").slice(0, 25).join("\n"), /titreCanonique/);
  assert.doesNotMatch(lireFichier("tests/gestion-carnet-aonang-lanta.test.js"), /for \(const carnet of \[true\]\)/);
});

// ---- Lot « lunch box, VIP Set et message collé » (23.11.2026) --------------------------------------------------------------------------------
const ID_TARIF = (cle) => PRODUITS_CARNET.flatMap((p) => p.options.flatMap((o) => o.tarifs)).find((t) => t.cle === cle).prestation;
const CLE_LUNCH_VIP = "aonang-option-lunch-box|standard|Per person, VIP, Mini Luxury or Luxury boat";
const CLE_LUNCH_ECO = "aonang-option-lunch-box|standard|Per person, Economy boat";
const CLE_VIP_SET = "aonang-option-vip-set|standard|Per boat";
// Le message anglais de la page d'Ao Nang (buildGestionMessage de src/js/carnet-booking.js) : les lignes dans l'ordre de la page.
const MSG_AONANG = (produit, titre, { invites = "2 adults, 1 child (age 12)", extras = "Lunch box", creneau = "Departure: 8am to 2pm", ref = "AON-AB12" } = {}) =>
  [`Booking request: ${produit} – ${titre}`, creneau, "Date: Sun 20 Dec 2026", `Guests: ${invites}`, extras ? `Extras: ${extras}` : "", "Pickup: Hotel Example", "Name: Anna", "WhatsApp: +41791234567", "Park fee: about 600 THB", "Message: test", ref ? `Ref: ${ref}` : ""].filter(Boolean).join("\n");
const offreCollee = (texte, ctx = contexte) => { const d = lireMessage(texte, AJD); return { d, offre: offresDuService(d, texte, { phrase: texte, date: d.date, adultes: d.adultes, enfants: d.enfants }, ctx)[0] }; };

test("lunch box et VIP Set d'Ao Nang : tarifés d'après la sortie, la lunch box par personne payante (enfants compris, bébés exclus), le VIP Set par bateau", () => {
  const vip = (extras, invites) => offreCollee(MSG_AONANG("Hong Islands from Ao Nang, VIP option", "VIP option", { extras, invites })).offre;
  const base = vip("", "2 adults, 1 child (age 12)");
  assert.equal(base.id, ID_TARIF("aonang-vip-hong|standard|1 to 4 people"));
  const avec = vip("Lunch box", "2 adults, 1 child (age 12)");
  assert.equal(avec.total - base.total, 3 * 61, "2 adultes + 1 enfant = 3 lunch box");
  assert.deepEqual(avec.extras.map((x) => [x.source.id, x.qte, x.ligne]), [[ID_TARIF(CLE_LUNCH_VIP), 3, "Lunch box"]]);
  const ligne = ligneDepuisPrestation(avec.extras[0].source, null, { langue: "en", qte: avec.extras[0].qte });
  assert.deepEqual([ligne.unite, ligne.qte], [61, 3], "une ligne, le prix par personne, la quantité des personnes");
  // Les lignes créées (comme la fenêtre les fait) : le total et les extras de la réponse viennent d'elles.
  const creees = serviceCree({ titre: avec.titre }, lignesDeLOffre(avec), prestations);
  assert.deepEqual([creees.total, creees.extras], [avec.total, ["Lunch box"]]);
  const sansLunch = serviceCree({ titre: avec.titre }, lignesDeLOffre(avec).slice(0, 1), prestations);
  assert.deepEqual([sansLunch.total, sansLunch.extras], [base.total, []]);
  // Un bébé ne paie pas de lunch box.
  assert.equal(vip("Lunch box", "2 adults, 1 child (age 1)").extras[0].qte, 2);
  // Mini Luxury : même ligne de la lunch box que VIP.
  const mini = offreCollee(MSG_AONANG("Hong Islands from Ao Nang, Mini Luxury option", "Mini Luxury option")).offre;
  assert.equal(mini.extras[0].source.id, ID_TARIF(CLE_LUNCH_VIP));
  // Économique : sa propre ligne de lunch box, et le VIP Set au prix d'un bateau, une seule fois.
  const eco = (extras, invites = "2 adults, 1 child (age 12)") => offreCollee(MSG_AONANG("Hong Island and Lagoon from Ao Nang, Economy option", "Economy option", { extras, invites })).offre;
  const ecoBase = eco("");
  const ecoDeux = eco("Lunch box, VIP Set");
  assert.deepEqual(ecoDeux.extras.map((x) => [x.source.id, x.qte, x.ligne]), [[ID_TARIF(CLE_LUNCH_ECO), 3, "Lunch box"], [ID_TARIF(CLE_VIP_SET), 1, "VIP Set"]]);
  assert.equal(ecoDeux.total - ecoBase.total, 3 * 61 + 713);
  assert.equal(eco("VIP Set; VIP Set").extras.length, 1, "jamais deux fois");
  assert.equal(eco("VIP Set", "6 adults").extras[0].qte, 1, "VIP Set : par bateau, jamais par personne");
});

test("extra impossible pour la sortie : jamais ajouté, l'offre le dit (VIP Set hors économique, lunch box sur Luxury et Prestige)", () => {
  const impossible = (produit, titre, extras) => offreCollee(MSG_AONANG(produit, titre, { extras })).offre;
  for (const [produit, titre] of [["Hong Islands from Ao Nang, VIP option", "VIP option"], ["4 Islands from Ao Nang, Mini Luxury option", "Mini Luxury option"], ["Phi Phi Islands from Ao Nang, Luxury option", "Luxury option"]]) {
    const o = impossible(produit, titre, "VIP Set");
    assert.equal(o.extras, undefined, produit);
    assert.deepEqual(o.extrasManquants, ["VIP Set"], produit);
  }
  for (const [produit, titre] of [["Hong Islands from Ao Nang, Luxury option", "Luxury option"], ["Hong Islands from Ao Nang, Prestige option", "Prestige option"]]) {
    const o = impossible(produit, titre, "Lunch box");
    assert.equal(o.extras, undefined, produit);
    assert.deepEqual(o.extrasManquants, ["Lunch box"], produit);
    assert.equal(o.total, impossible(produit, titre, "").total, "aucun prix ajouté");
  }
  // Possible et impossible ensemble : l'un est ajouté, l'autre signalé.
  const vip = impossible("Hong Islands from Ao Nang, VIP option", "VIP option", "Lunch box, VIP Set");
  assert.deepEqual([vip.extras.map((x) => x.ligne), vip.extrasManquants], [["Lunch box"], ["VIP Set"]]);
  // Tarif absent de la base : signalé, rien d'ajouté.
  const sans = { ...contexte, prestations: prestations.filter((p) => p.id !== ID_TARIF(CLE_LUNCH_VIP)) };
  const o = offreCollee(MSG_AONANG("Hong Islands from Ao Nang, VIP option", "VIP option"), sans).offre;
  assert.deepEqual([o.extras, o.extrasManquants], [undefined, ["Lunch box"]]);
  // Le mapping ne porte que des sorties qui existent, avec un seul tarif par libellé et sortie.
  for (const x of EXTRAS_DU_SITE) for (const id of x.produits) assert.ok(sortieParId(id), id);
  const vus = new Set();
  for (const x of EXTRAS_DU_SITE) for (const id of x.produits) { assert.ok(!vus.has(`${x.ligne}|${id}`), `${x.ligne} ${id}`); vus.add(`${x.ligne}|${id}`); }
  // Les extras que la page propose sont exactement ceux que Gestion sait tarifer : libellés `en` de ao-nang-excursions-bateau.11tydata.js.
  const page = lireFichier("src/carnet/ao-nang-excursions-bateau.11tydata.js");
  for (const l of ["Lunch box", "VIP Set"]) assert.ok(page.includes(`en: "${l}"`), l);
  assert.deepEqual([...new Set(EXTRAS_DU_SITE.filter((x) => x.produits.some((p) => p.startsWith("aonang-"))).map((x) => x.ligne))].sort(), ["Lunch box", "VIP Set"]);
});

test("« Modifier » : la lunch box d'une sortie qui ne la propose pas (Luxury) n'est pas gardée, celle d'une sortie qui la propose reste", () => {
  assert.equal(extrasPourOption("Lunch box", "aonang-luxury-hong", "standard"), "");
  assert.equal(extrasPourOption("Lunch box", "aonang-vip-hong", "standard"), "Lunch box");
  assert.equal(extrasPourOption("Lunch box, VIP Set", "aonang-economique-4-islands", "standard"), "Lunch box, VIP Set");
  assert.equal(extrasPourOption("Lunch box, VIP Set", "aonang-vip-hong", "standard"), "Lunch box");
});

test("message collé : la référence de la page désigne le guide (une seule table), la sortie se retrouve par son nom, les règles du carnet s'appliquent", () => {
  // La table est celle des pages : un test la lit dans les fichiers des guides.
  for (const [prefixe, guide, fichier] of [["SAM", "koh-samui", "koh-samui-excursions-bateau"], ["AON", "aonang", "ao-nang-excursions-bateau"], ["LAN", "koh-lanta", "koh-lanta-excursions-activites"]]) {
    assert.equal(REFS_CARNET[prefixe], guide);
    assert.match(lireFichier(`src/carnet/${fichier}.11tydata.js`), new RegExp(`prefixeRef: "${prefixe}"`));
  }
  assert.deepEqual(Object.keys(REFS_CARNET).sort(), ["AON", "LAN", "SAM"]);
  assert.equal(guideDeLaRef("x\nRef: AON-AB12"), "aonang");
  assert.equal(guideDeLaRef("x\nRéf : SAM-AB12"), "koh-samui");
  assert.equal(guideDeLaRef("x\nRef: XYZ-AB12"), null);
  assert.equal(guideDeLaRef("x\nRef: toString-AB12"), null);
  assert.equal(guideDeLaRef("Booking request: x"), null);
  // Samui : le récapitulatif français du WhatsApp, tel que la page l'écrit, avec un enfant de 12 ans (barème 4 à 11 : compté adulte).
  const samui = "Bonjour Anaïs, voici ma demande de réservation.\n\nDemande de réservation : Ang Thong en big boat, journée en groupe\nFormule : avec kayak\nDate : dimanche 20 décembre 2026\nCréneau : Matin, 09:00 à 13:00\nPersonnes : 1 adulte, 1 enfant (12 ans)\nPrise en charge : Hotel Example\nTransfert depuis l'hôtel : oui (1 500 THB par van, indicatif)\nEstimation : 5 000 THB, à payer sur place après confirmation\nEntrée du parc à payer sur place : 400 THB\nNom : Anna\nWhatsApp : +41791234567\nMessage : allergie aux arachides\nRéf : SAM-AB12";
  const s = lireMessage(samui, AJD);
  assert.deepEqual(s.carnet, { produit: "ang-thong-big-boat", option: "with-kayak" });
  assert.deepEqual([s.adultes, s.enfants, s.plusGrands, s.agesDeclares], [2, 0, 1, [12]]);
  assert.deepEqual([s.date, s.nom, s.pickup, s.parc, s.remarque], ["2026-12-20", "Anna", "Hotel Example", "400 THB", "allergie aux arachides"]);
  assert.equal(s.extras, "", "le transfert n'est pas un extra");
  assert.match(notesDemande(s), /Child ages: 12/);
  assert.equal(optionDuSite(s).option.id, "with-kayak");
  // Sans la ligne de référence, le même texte reste un message libre.
  const libre = lireMessage(samui.replace(/\nRéf : SAM-AB12/, ""), AJD);
  assert.deepEqual([libre.carnet, libre.libre], [undefined, true]);
  // Préfixe inconnu, préfixe d'un autre guide avec un nom qui n'est pas le sien, nom de sortie inconnu : rien ne change.
  assert.equal(lireMessage(samui.replace("SAM-AB12", "XYZ-AB12"), AJD).carnet, undefined);
  assert.equal(lireMessage(samui.replace("SAM-AB12", "AON-AB12"), AJD).carnet, undefined);
  assert.equal(lireMessage(samui.replace("Ang Thong en big boat, journée en groupe", "Sortie inconnue"), AJD).carnet, undefined);
  assert.equal(carnetDuMessage("Booking request: Ang Thong Marine Park by big boat – With kayak\nRef: AON-AB12"), null);
  // Ao Nang : le message anglais de la page, lunch box et enfant de 12 ans : 4 600 + 3 × 80 sur les vrais prix, 4 600 fictifs + 3 × 61 ici.
  const aon = offreCollee(MSG_AONANG("Hong Islands from Ao Nang, VIP option", "VIP option"));
  assert.deepEqual(aon.d.carnet, { produit: "aonang-vip-hong", option: "standard" });
  const nuAon = offreCollee(MSG_AONANG("Hong Islands from Ao Nang, VIP option", "VIP option", { extras: "" }));
  assert.equal(aon.offre.total, nuAon.offre.total + 3 * 61);
  assert.equal(aon.d.parc, "about 600 THB");
  // Koh Lanta : le message du guide, enfant de 12 ans, Kradan sur le bateau privé.
  const lanta = "Booking request: 4 Islands – Private longtail\nDate: Sun 20 Dec 2026\nGuests: 2 adults, 1 child (age 12)\nExtras: Add Koh Kradan\nPickup: Hotel Example\nName: Anna\nRef: LAN-AB12";
  const l = offreCollee(lanta);
  assert.deepEqual(l.d.carnet, { produit: "4-islands", option: "private-longtail" });
  assert.equal(l.offre.total, offreCollee(lanta.replace("Extras: Add Koh Kradan\n", "")).offre.total + 777);
  assert.deepEqual(l.offre.extras.map((x) => x.ligne), ["Add Koh Kradan"]);
  // Le même texte sans « Ref: » (site ordinaire, client libre) : aucune extension, aucun carnet.
  const ordinaire = offreCollee(lanta.replace("\nRef: LAN-AB12", ""));
  assert.deepEqual([ordinaire.d.carnet, ordinaire.offre.extras], [undefined, undefined]);
  // La fenêtre d'une demande du site garde son contexte exact : la référence n'est pas relue.
  assert.equal(lireMessage(lanta, AJD, { detecterCarnet: false }).carnet, undefined);
  assert.match(lireFichier("src/gestion/js/views/demande.mjs"), /lireMessage\(texte, aujourdhui\(\), \{ detecterCarnet: false \}\)/);
});

test("message collé : la table des références et les noms de page du guide de Koh Samui viennent des fichiers des pages", () => {
  const page = lireFichier("src/carnet/koh-samui-excursions-bateau.11tydata.js");
  const noms = PRODUITS_CARNET.filter((p) => p.guide === "koh-samui").map((p) => p.nomPage);
  assert.equal(noms.length, 9);
  for (const n of noms) assert.ok(n && page.includes(`produit: "${n}"`), n);
  assert.equal(new Set(noms).size, 9);
  for (const p of PRODUITS_CARNET.filter((x) => x.guide !== "koh-samui")) assert.equal(p.nomPage, undefined, p.id);
});

test("Assistant : la lecture de l'agent se fait côté serveur, la détection du carnet n'y passe pas (documenté) ; la lecture de démonstration passe par lireMessage", () => {
  // La lecture réelle est faite par la fonction « agent » (modèle) : elle rend des cartes avec des offres du catalogue et ne porte ni le texte ni la référence jusqu'à la fenêtre.
  const doc = lireFichier("docs/gestion/carnet-aonang-lanta.md");
  assert.match(doc, /Message collé et Assistant/);
  assert.match(doc, /fonction « agent »/);
  assert.match(lireFichier("src/gestion/js/assistant-calc.mjs"), /const d = lireMessage\(texte, aujourdhui\);/, "la lecture de démonstration passe par lireMessage, donc par la détection");
});

const SQL_NET_VIP = prive("correctif-vip-set-net.sql");
const RETOUR_NET_VIP = prive("retour-correctif-vip-set-net.sql");
test("SQL privé du net du VIP Set : une seule ligne, tarif vérifié, jamais d'écrasement, retour symétrique", { skip: !SQL_NET_VIP || !RETOUR_NET_VIP ? "SQL privé absent (GESTION_SQL_PRIVE)" : false }, () => {
  assert.match(SQL_NET_VIP, /begin;[\s\S]*commit;/);
  assert.match(SQL_NET_VIP, /pg_advisory_xact_lock/);
  assert.equal((SQL_NET_VIP.match(/insert into prestations_nets/g) || []).length, 1);
  assert.match(SQL_NET_VIP, /md5\('carnet:aonang-option-vip-set\|standard\|Per boat'\)::uuid/);
  assert.match(SQL_NET_VIP, /on conflict \(prestation_id\) do nothing/);
  assert.match(SQL_NET_VIP, /n <> 1 then[\s\S]*raise exception/);
  assert.match(SQL_NET_VIP, /déjà un net différent/);
  assert.match(RETOUR_NET_VIP, /delete from prestations_nets/);
  assert.match(RETOUR_NET_VIP, /get diagnostics n = row_count/);
  assert.equal(ID_TARIF("aonang-option-vip-set|standard|Per boat").length, 36);
  // Rien d'autre que cette ligne : aucun tarif, aucun partenaire, aucune commission.
  for (const f of [SQL_NET_VIP, RETOUR_NET_VIP]) assert.doesNotMatch(f.replace(/^--.*$/gm, ""), /insert into (prestations|partenaires)\b|update |insert into partenaires_prives/);
});
