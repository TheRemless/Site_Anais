// tests/secret-data.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const secret = require("../src/_data/secret.json");

const IMAGES = path.join(__dirname, "..", "src", "images", "secret");
const items = secret.tours.concat(secret.activities);

test("secret.json : identifiants uniques", () => {
  const ids = secret.routes.concat(items).map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("secret.json : chaque trajet a ses coordonnées et son étiquette de carte", () => {
  for (const r of secret.routes) {
    assert.ok(r.name, r.id);
    assert.equal(typeof r.lat, "number", r.id);
    assert.equal(typeof r.lng, "number", r.id);
    assert.ok(Array.isArray(r.label) && r.label.length === 3, r.id);
    assert.equal(typeof r.confirmed, "boolean", r.id);
  }
});

test("secret.json : chaque excursion ou activité est complète", () => {
  for (const t of items) {
    assert.ok(t.name && t.description, t.id);
    assert.ok(Array.isArray(t.info), t.id);
    assert.equal(typeof t.confirmed, "boolean", t.id);
    if (t.photo) assert.ok(t.photoAlt, t.id + " : photo sans texte alternatif");
  }
});

test("secret.json : les photos citées existent", () => {
  for (const t of items) {
    if (t.photo) assert.ok(fs.existsSync(path.join(IMAGES, t.photo)), t.photo + " introuvable");
  }
  if (secret.team.photo) assert.ok(fs.existsSync(path.join(IMAGES, secret.team.photo)), secret.team.photo + " introuvable");
});

test("secretView : carte projetée et bandeau d'aperçu masqué en production", () => {
  const view = require("../src/_data/secretView.js");
  const saved = process.env.CONTEXT;
  try {
    process.env.CONTEXT = "production";
    assert.equal(view().showDraftBanner, false);
    process.env.CONTEXT = "deploy-preview";
    const v = view();
    assert.equal(v.map.routes.length, secret.routes.length);
    assert.equal(v.showDraftBanner, v.toConfirm.length > 0);
  } finally {
    if (saved === undefined) delete process.env.CONTEXT;
    else process.env.CONTEXT = saved;
  }
});
