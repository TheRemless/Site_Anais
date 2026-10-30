// Pages /secret/<id>/ et /taxi/<route>/ (option A du chantier SEO, 30.10.2026) :
// balises, données structurées sans prix ni avis, sitemap et liens croisés.
// Lancer `npm run build` avant (lecture de _site/).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const secretPages = require("../src/_data/secretPages.js")();
const taxiRoutes = require("../src/_data/taxiRoutesView.js")();

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const html = (url) => read(path.join("_site", url, "index.html"));

const all = secretPages.pages.map((p) => ({ url: `secret/${p.id}`, title: p.title, desc: p.metaDescription, jsonLd: p.jsonLd }))
  .concat(taxiRoutes.routes.map((r) => ({ url: `taxi/${r.id}`, title: r.title, desc: r.metaDescription, jsonLd: r.jsonLd })));

test("pages : au moins 9 excursions et 9 trajets", () => {
  assert.ok(secretPages.pages.length >= 9);
  assert.ok(taxiRoutes.routes.length >= 9);
});

test("pages : title de 60 caractères au plus, description de 120 à 160, un seul h1, canonical", () => {
  for (const p of all) {
    assert.ok(p.title.length <= 60, `${p.url} : title ${p.title.length}`);
    assert.ok(p.desc.length >= 120 && p.desc.length <= 160, `${p.url} : description ${p.desc.length}`);
    const doc = html(p.url);
    assert.equal((doc.match(/<h1[ >]/g) || []).length, 1, `${p.url} : h1`);
    assert.match(doc, new RegExp(`<link rel="canonical" href="https://zwaldtravelplanner.com/${p.url}/">`));
    assert.match(doc, /<meta name="robots" content="index, follow/);
    assert.equal(decode(doc.match(/<title>(.*?)<\/title>/)[1]), p.title);
  }
});

test("pages : aucun prix, aucune note, aucun avis dans les données structurées", () => {
  for (const p of all) {
    const text = JSON.stringify(p.jsonLd);
    assert.doesNotMatch(text, /"price"|aggregateRating|reviewCount|ratingValue/, p.url);
  }
});

test("pages taxi : ni prix, ni téléphone, ni e-mail affichés", () => {
  for (const r of taxiRoutes.routes) {
    const doc = html(`taxi/${r.id}`);
    assert.doesNotMatch(doc, /\d+\s?(THB|฿|CHF|€)/, `${r.id} : prix`);
    assert.doesNotMatch(doc, /tel:|mailto:/, `${r.id} : contact direct`);
    assert.match(doc, /\/taxi\/\?from=/, `${r.id} : lien vers le formulaire prérempli`);
  }
});

test("pages secret : jamais « depuis Koh Lanta » comme limite sur les trajets, lien vers le formulaire prérempli", () => {
  for (const p of secretPages.pages) {
    const doc = html(`secret/${p.id}`);
    assert.match(doc, /\/secret\/\?(tour|activity)=/, `${p.id} : lien formulaire`);
    assert.match(doc, /application\/ld\+json/, `${p.id} : JSON-LD`);
  }
});

test("sitemap : chaque page listée une seule fois", () => {
  const sitemap = read("_site/sitemap.xml");
  for (const p of all) {
    const hits = sitemap.match(new RegExp(`<loc>https://zwaldtravelplanner\\.com/${p.url}/</loc>`, "g")) || [];
    assert.equal(hits.length, 1, p.url);
  }
});

test("liens croisés : /secret/ mène aux pages d'excursion, /taxi/ aux pages de trajet", () => {
  const secret = html("secret");
  for (const p of secretPages.pages) assert.match(secret, new RegExp(`href="/secret/${p.id}/"`), p.id);
  const taxi = html("taxi");
  for (const r of taxiRoutes.routes) assert.match(taxi, new RegExp(`href="/taxi/${r.id}/"`), r.id);
  // Pas de bloc « Popular private transfers » ni de pastilles sur /taxi/ (refus de Jérémy, 28.10.2026).
  assert.doesNotMatch(taxi, /Popular private transfers/);
});

test("taxi.json : les trajets cités par les services existent", () => {
  const taxi = require("../src/_data/taxi.json");
  for (const s of taxi.services) for (const id of s.routes || []) assert.ok(taxiRoutes.byId[id], id);
});
