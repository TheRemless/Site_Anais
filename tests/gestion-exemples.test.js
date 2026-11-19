// Exemples en gris des champs : ceux de Lanta pour Anaïs et sa démo, neutres pour toute autre agence (19.11.2026).
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const ZWALD = "00000000-0000-0000-0000-00000000a000";
const LANTA = /lanta|klong|saladan|krabi|phuket|lipe|thb|baht|thaï|thai|longtail|FD 3217/i;
const charger = () => import("../src/gestion/js/exemples.mjs");
const source = (f) => readFileSync(join(__dirname, "../src/gestion/js", f), "utf8");

test("Anaïs, sa démo et une base sans organisation gardent les exemples de Lanta", async () => {
  const { exempleDe, estLanta, CLES_EXEMPLES } = await charger();
  for (const org of [ZWALD, "demo-organisation", null, undefined, ""]) assert.equal(estLanta(org), true);
  assert.equal(exempleDe("hotel", ZWALD), "Hotel Sunset, Klong Dao");
  assert.equal(exempleDe("point_embarquement", ZWALD), "Saladan Pier, comptoir n° 3");
  assert.equal(exempleDe("parc", "demo-organisation"), "400 THB per adult, 200 THB per child, cash on the island");
  assert.ok(CLES_EXEMPLES.length >= 14);
});

test("une autre agence et la démo des prospects n'ont aucun exemple de Lanta ou de Thaïlande", async () => {
  const { exempleDe, estLanta, CLES_EXEMPLES, voucherExempleDonnees, confirmationExemple } = await charger();
  for (const org of ["demo-agence", "11111111-2222-3333-4444-555555555555"]) {
    assert.equal(estLanta(org), false);
    for (const cle of CLES_EXEMPLES) assert.doesNotMatch(exempleDe(cle, org), LANTA, cle);
    for (const [cle, v] of Object.entries(voucherExempleDonnees(org))) assert.doesNotMatch(v, LANTA, cle);
    const conf = confirmationExemple(org, { marque: "Blue Lagoon Tours", devise: "USD" });
    assert.doesNotMatch(conf, LANTA);
    assert.match(conf, /BLUE LAGOON TOURS/);
    assert.match(conf, /Price: 50 USD/);
  }
});

test("une clé inconnue ne rend jamais un lieu de Lanta", async () => {
  const { exempleDe } = await charger();
  assert.equal(exempleDe("inconnue", ZWALD), "");
});

test("la démo des prospects a sa propre organisation, distincte de celle d'Anaïs", async () => {
  const { ORG_AGENCE } = await import("../src/gestion/js/demo-agence.mjs");
  const { estLanta } = await charger();
  assert.equal(estLanta(ORG_AGENCE), false);
});

test("plus aucun exemple de Lanta écrit en dur dans les écrans concernés", () => {
  const ecrans = ["views/course-libre.mjs", "views/partenaires.mjs", "views/champs-voucher.mjs", "views/demande.mjs", "views/nouveau-excursions.mjs"];
  for (const f of ecrans) assert.doesNotMatch(source(f), /placeholder: tr\("(Hotel Sunset, Klong Dao|Krabi Airport|Koh Lanta|Klong Dao|Pickup à Lanta|Saladan Pier[^"]*)"\)/, f);
  assert.doesNotMatch(source("views/champs-voucher.mjs"), /"Koh Lanta"|"Phuket"|THB/);
  assert.doesNotMatch(source("views/confirmation.mjs"), /const EXEMPLE =/);
  assert.doesNotMatch(source("views/voucher.mjs"), /Klong Dao|Koh Lipe/);
  assert.doesNotMatch(source("views/reglages.mjs"), /Banque thaïlandaise|Phuket \(Thaïlande\)/);
});
