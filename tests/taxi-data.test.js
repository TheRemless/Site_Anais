const test = require("node:test");
const assert = require("node:assert/strict");
const taxi = require("../src/_data/taxi.json");
const taxiView = require("../src/_data/taxiView.js");

function entries() {
  return [taxi.hero, taxi.rating, taxi.payment].concat(taxi.services, taxi.why, taxi.steps);
}

test("taxi.json : chaque entrée porte un booléen confirmed", () => {
  for (const item of entries()) {
    assert.equal(typeof item.confirmed, "boolean", JSON.stringify(item).slice(0, 60));
  }
});

test("taxi.json : aucun prix et aucun contact direct dans les textes", () => {
  const all = JSON.stringify(taxi);
  assert.doesNotMatch(all, /฿|\bTHB\b|\bbaht\b|€|\$/i);
  assert.doesNotMatch(all, /wa\.me|tel:|@outlook|mailto:/i);
});

test("taxi.json : le lien des excursions bateau pointe vers /secret/", () => {
  const boats = taxi.services.find((s) => s.id === "boats");
  assert.ok(boats, "service boats manquant");
  assert.equal(boats.link.href, "/secret/");
});

test("taxiView : liste les entrées à confirmer et la photo du hero", () => {
  const view = taxiView();
  assert.ok(view.toConfirm.length > 0);
  assert.ok(view.toConfirm.some((line) => /photo/i.test(line)));
});

test("taxiView : bandeau visible hors production, masqué en production", () => {
  const saved = process.env.CONTEXT;
  try {
    delete process.env.CONTEXT;
    assert.equal(taxiView().showDraftBanner, true);
    process.env.CONTEXT = "deploy-preview";
    assert.equal(taxiView().showDraftBanner, true);
    process.env.CONTEXT = "production";
    assert.equal(taxiView().showDraftBanner, false);
  } finally {
    if (saved === undefined) delete process.env.CONTEXT; else process.env.CONTEXT = saved;
  }
});
