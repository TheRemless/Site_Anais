const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const taxi = require("../src/_data/taxi.json");
const taxiView = require("../src/_data/taxiView.js");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const njk = read("src/taxi.njk");
const decode = (s) => s.replace(/&amp;/g, "&");

test("/taxi/ : la page est indexable", () => {
  assert.doesNotMatch(njk, /noindex/i);
  assert.match(njk, /<meta name="robots" content="index, follow/);
});

test("/taxi/ : balise title de 60 caractères au plus, avec le mot-clé et la marque", () => {
  const title = decode(njk.match(/<title>(.*?)<\/title>/)[1]);
  assert.ok(title.length <= 60, `${title.length} caractères : ${title}`);
  assert.match(title, /Taxi/i);
  assert.match(title, /Koh Lanta/);
  assert.match(title, /VIP Taxi Lanta/);
});

test("/taxi/ : meta description de 120 à 160 caractères, avec un appel à l'action", () => {
  const description = decode(njk.match(/<meta name="description" content="(.*?)">/)[1]);
  assert.ok(description.length >= 120 && description.length <= 160, `${description.length} caractères`);
  assert.match(description, /Request|Book|Send/);
  assert.match(description, /Krabi/);
});

test("/taxi/ : un seul h1, qui contient le mot-clé principal", () => {
  assert.equal((njk.match(/<h1[ >]/g) || []).length, 1);
  assert.match(taxi.hero.title, /taxi/i);
  assert.match(taxi.hero.title, /Koh Lanta/);
});

test("/taxi/ : le sitemap la liste une seule fois", () => {
  const sitemap = read("src/sitemap.xml");
  const hits = sitemap.match(/<loc>https:\/\/zwaldtravelplanner\.com\/taxi\/<\/loc>/g) || [];
  assert.equal(hits.length, 1);
});

test("liens internes : /secret/ pointe vers /taxi/ et /taxi/ vers /secret/", () => {
  assert.match(read("src/secret.njk"), /href="\/taxi\/"/);
  assert.ok(taxi.services.some((s) => s.link && s.link.href === "/secret/"));
});

test("/taxi/ : questions fréquentes tirées du site de VIP Taxi Lanta, chacune avec confirmed", () => {
  assert.ok(taxi.faq.length >= 3);
  for (const item of taxi.faq) {
    assert.ok(item.q.endsWith("?"), item.q);
    assert.ok(item.a.length > 20, item.q);
    assert.equal(typeof item.confirmed, "boolean", item.q);
  }
});

test("données structurées : TaxiService, zone desservie, aucun fait non vérifié", () => {
  const ld = taxiView().jsonLd;
  assert.equal(ld["@context"], "https://schema.org");
  assert.equal(ld["@type"], "TaxiService");
  assert.equal(ld.url, "https://zwaldtravelplanner.com/taxi/");
  const area = JSON.stringify(ld.areaServed);
  for (const place of ["Koh Lanta", "Krabi", "Phuket", "Surat Thani"]) assert.match(area, new RegExp(place));
  // Pas de note ni d'avis inventés, pas de téléphone ni d'e-mail (décision : le formulaire est le canal unique).
  assert.doesNotMatch(JSON.stringify(ld), /aggregateRating|"review"|ratingValue|telephone|email|priceRange/i);
  // Le JSON-LD doit rester du JSON valide une fois sérialisé pour la page.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(ld)));
});

test("la page insère les données structurées", () => {
  assert.match(njk, /application\/ld\+json/);
  assert.match(njk, /taxiView\.jsonLd/);
});
