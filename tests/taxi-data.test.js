const test = require("node:test");
const assert = require("node:assert/strict");
const taxi = require("../src/_data/taxi.json");
const taxiView = require("../src/_data/taxiView.js");

function entries() {
  return [taxi.hero, taxi.tours, taxi.rating, taxi.payment].concat(taxi.services, taxi.why, taxi.steps, taxi.faq);
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

test("taxi.json : les tours et sorties en bateau sont confiés à Secret Travel & Tour", () => {
  assert.equal(taxi.tours.link.href, "/secret/");
  assert.match(taxi.tours.link.label, /Secret Travel & Tour/);
  assert.match(taxi.tours.text, /Secret Travel & Tour/);
  // VIP Taxi Lanta ne les propose plus lui-même dans sa liste de services.
  const ids = taxi.services.map((s) => s.id);
  assert.ok(!ids.includes("tours") && !ids.includes("boats"), ids.join(", "));
  assert.ok(taxi.faq.some((f) => /Secret Travel & Tour/.test(f.a)), "la FAQ renvoie vers Secret");
});

test("taxiView : liste chaque entrée non confirmée, et la photo du hero seulement si elle manque", () => {
  const view = taxiView();
  const unconfirmed = [taxi.hero, taxi.tours, taxi.rating, taxi.payment]
    .concat(taxi.services, taxi.why, taxi.steps, taxi.faq)
    .filter((item) => !item.confirmed).length;
  assert.equal(view.toConfirm.length, unconfirmed + (taxi.hero.photo ? 0 : 1));
  assert.equal(
    view.toConfirm.some((line) => /vehicle photo/.test(line)),
    !taxi.hero.photo
  );
});

test("taxi.json : chaque photo a un chemin existant, des dimensions et un texte alternatif", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const photos = [taxi.hero.photo, taxi.tours.photo].concat(taxi.gallery.photos, taxi.services.map((s) => s.photo)).filter(Boolean);
  assert.ok(photos.length >= 5);
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
    // Hors production, le bandeau n'apparaît que s'il reste quelque chose à confirmer.
    delete process.env.CONTEXT;
    const pending = taxiView().toConfirm.length > 0;
    assert.equal(taxiView().showDraftBanner, pending);
    process.env.CONTEXT = "deploy-preview";
    assert.equal(taxiView().showDraftBanner, pending);
    process.env.CONTEXT = "production";
    assert.equal(taxiView().showDraftBanner, false);
  } finally {
    if (saved === undefined) delete process.env.CONTEXT; else process.env.CONTEXT = saved;
  }
});

test("bloc Secret : encart du partenaire, sans insister sur le fait que c'est une autre entreprise", () => {
  assert.equal(taxi.tours.tag, "Our partner");
  assert.match(taxi.tours.title, /\?$/);
  assert.match(taxi.tours.text, /Secret Travel & Tour/);
  assert.doesNotMatch(JSON.stringify(taxi.tours), /different company|separate company|฿|\bTHB\b|€|\$/i);
});

test("véhicules : minivan partout, taxi seulement sur Koh Lanta", () => {
  const routes = require("../src/_data/taxiRoutes.json");
  const all = JSON.stringify(taxi) + JSON.stringify(routes);
  // Plus aucune formule qui laisse croire à un choix taxi ou minivan hors de l'île.
  assert.doesNotMatch(all, /taxis? (or|and|&) minivans?|minivans? (or|and|&) taxis?/i);
  const q = taxi.faq.find((f) => /taxi or a minivan/i.test(f.q));
  assert.ok(q, "question taxi ou minivan");
  assert.match(q.a, /minivan/i);
  assert.match(q.a, /Koh Lanta/);
  assert.match(taxi.hero.title, /minivan/i);
  assert.match(taxi.hero.title, /taxi/i);
  assert.match(taxi.services.find((s) => s.id === "local").text, /taxi/i);
});

test("lieux proposés : pas centrés sur Koh Lanta, les aéroports d'abord, Hat Yai inclus", () => {
  assert.notEqual(taxi.places[0], "Koh Lanta");
  assert.deepEqual(taxi.places.slice(0, 3), ["Krabi Airport", "Phuket Airport", "Surat Thani Airport"]);
  assert.ok(taxi.places.includes("Hat Yai"));
});

test("FAQ : un trajet qui ne passe pas par Koh Lanta", () => {
  const q = taxi.faq.find((f) => /Phuket Airport to Khao Lak/.test(f.q));
  assert.ok(q, "question Phuket Airport vers Khao Lak");
  assert.doesNotMatch(q.q + q.a, /Koh Lanta/);
});
