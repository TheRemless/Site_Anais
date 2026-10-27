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

test("taxiView : liste les entrées à confirmer, et la photo du hero seulement si elle manque", () => {
  const view = taxiView();
  assert.ok(view.toConfirm.length > 0);
  assert.equal(
    view.toConfirm.some((line) => /vehicle photo/.test(line)),
    !taxi.hero.photo
  );
});

test("taxi.json : chaque photo a un chemin existant, des dimensions et un texte alternatif", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const photos = [taxi.hero.photo].concat(taxi.gallery.photos, taxi.services.map((s) => s.photo)).filter(Boolean);
  assert.ok(photos.length >= 4);
  for (const p of photos) {
    assert.ok(fs.existsSync(path.join(__dirname, "../src", p.src)), p.src);
    assert.ok(p.width > 0 && p.height > 0, p.src);
    assert.ok(p.alt && p.alt.length > 10, p.src);
    // Chaque fichier cité dans srcset ("chemin 900w, chemin 1800w") doit exister aussi.
    for (const candidate of (p.srcset || "").split(",").filter(Boolean)) {
      const file = candidate.trim().split(/\s+/)[0];
      assert.ok(fs.existsSync(path.join(__dirname, "../src", file)), file);
    }
  }
});

test("taxi.json : destinations proposées dans From et To, sans doublon", () => {
  assert.ok(taxi.places.length >= 8);
  assert.equal(new Set(taxi.places).size, taxi.places.length);
  for (const place of taxi.places) assert.ok(place.trim() && !/[<>"]/.test(place), place);
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
