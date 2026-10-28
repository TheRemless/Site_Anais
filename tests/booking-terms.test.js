// tests/booking-terms.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");
const read = (file) => fs.readFileSync(path.join(SRC, file), "utf8");

// Pages propres à Secret Travel & Tour et à VIP Taxi Lanta, et leurs fichiers associés.
const OWN_FILES = new Set([
  "secret.njk",
  "taxi.njk",
  "booking-terms.njk",
  "booking-terms-fr.njk",
  "_data/secret.json",
  "_data/secretView.js",
  "_data/taxi.json",
  "_data/taxiView.js",
  "js/secret.js",
  "js/secret-form.js",
  "js/taxi.js",
  "js/taxi-form.js"
]);

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "images" || entry.name === "files" ? [] : listFiles(full);
    return /\.(njk|json|js|html)$/.test(entry.name) ? [path.relative(SRC, full)] : [];
  });
}

test("booking terms : version anglaise et traduction française, non indexées", () => {
  const en = read("booking-terms.njk");
  const fr = read("booking-terms-fr.njk");
  assert.match(en, /permalink: \/booking-terms\//);
  assert.match(fr, /permalink: \/booking-terms\/fr\//);
  for (const page of [en, fr]) {
    assert.match(page, /<meta name="robots" content="noindex, follow">/);
    assert.match(page, /Zwald Travel Planner Co\., Ltd\./);
  }
  assert.match(fr, /la <a href="\/booking-terms\/">version anglaise<\/a> fait foi/);
  assert.equal((en.match(/<h2>/g) || []).length, (fr.match(/<h2>/g) || []).length, "même nombre d'articles");
});

test("booking terms : liées depuis /secret/ et /taxi/", () => {
  assert.match(read("secret.njk"), /href="\/booking-terms\/"/);
  assert.match(read("taxi.njk"), /href="\/booking-terms\/"/);
});

// Règle de Jérémy : un client qui ne connaît que Zwald ne doit pas découvrir
// que Secret Travel & Tour ou VIP Taxi Lanta existent.
test("aucune page Zwald ne mentionne Secret, le taxi ou les booking terms", () => {
  const forbidden = /Secret Travel|VIP Taxi|\/secret\/|\/taxi\/|\/booking-terms/;
  for (const file of listFiles(SRC)) {
    if (OWN_FILES.has(file)) continue;
    assert.ok(!forbidden.test(read(file)), file + " mentionne Secret, le taxi ou les booking terms");
  }
});
