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

test("/taxi/ : balise title de 60 caractères au plus, avec le mot-clé, la zone et la marque", () => {
  const title = decode(njk.match(/<title>(.*?)<\/title>/)[1]);
  assert.ok(title.length <= 60, `${title.length} caractères : ${title}`);
  assert.match(title, /Taxi/i);
  assert.match(title, /Southern Thailand/);
  assert.match(title, /VIP Taxi Lanta/);
});

test("/taxi/ : meta description de 120 à 160 caractères, avec un appel à l'action", () => {
  const description = decode(njk.match(/<meta name="description" content="(.*?)">/)[1]);
  assert.ok(description.length >= 120 && description.length <= 160, `${description.length} caractères`);
  assert.match(description, /Request|Book|Send/);
  assert.match(description, /Southern Thailand/);
  assert.match(description, /Koh Lanta/);
});

test("/taxi/ : un seul h1, qui contient le mot-clé principal", () => {
  assert.equal((njk.match(/<h1[ >]/g) || []).length, 1);
  assert.match(taxi.hero.title, /taxi/i);
  assert.match(taxi.hero.title, /Southern Thailand/);
});

test("/taxi/ : le service couvre tout le sud de la Thaïlande, Koh Lanta est la base", () => {
  assert.match(taxi.hero.lead, /Southern Thailand/);
  assert.match(taxi.hero.lead, /Koh Lanta/);
  assert.match(njk, /h-services">[^<]*Southern Thailand/);
  // Aucune question ne présente l'offre comme limitée au départ de Koh Lanta.
  // Exceptions : « to and from Koh Lanta » (les deux sens) et « Do you only drive from Koh Lanta? » (réponse : No).
  const restrictive = taxi.faq.filter((f) => /(?<!to and )from Koh Lanta/i.test(f.q) && !/only drive from Koh Lanta/i.test(f.q));
  assert.deepEqual(restrictive.map((f) => f.q), [], "question trop restrictive dans la FAQ");
  const where = taxi.faq.find((f) => /Southern Thailand/.test(f.q));
  assert.ok(where, "question sur la zone couverte");
  assert.match(where.a, /Phuket/);
});

test("/taxi/ : le sitemap la liste une seule fois", () => {
  // Le sitemap est généré par Eleventy (src/sitemap.njk) : lancer `npm run build` avant les tests.
  const sitemap = read("_site/sitemap.xml");
  const hits = sitemap.match(/<loc>https:\/\/zwaldtravelplanner\.com\/taxi\/<\/loc>/g) || [];
  assert.equal(hits.length, 1);
});

test("liens internes : /secret/ pointe vers /taxi/ et /taxi/ vers /secret/", () => {
  assert.match(read("src/secret.njk"), /href="\/taxi\/"/);
  assert.equal(taxi.tours.link.href, "/secret/");
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
  for (const place of ["Southern Thailand", "Koh Lanta", "Krabi", "Phuket", "Surat Thani"]) assert.match(area, new RegExp(place));
  // Pas de note ni d'avis inventés, pas de téléphone ni d'e-mail (décision : le formulaire est le canal unique).
  assert.doesNotMatch(JSON.stringify(ld), /aggregateRating|"review"|ratingValue|telephone|email|priceRange/i);
  // Le JSON-LD doit rester du JSON valide une fois sérialisé pour la page.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(ld)));
});

test("la page insère les données structurées", () => {
  assert.match(njk, /application\/ld\+json/);
  assert.match(njk, /taxiView\.jsonLd/);
});

test("FAQ : aucune durée, distance ni prix inventé", () => {
  const all = JSON.stringify(taxi.faq);
  assert.doesNotMatch(all, /\b\d+\s?(h|hr|hrs|hours?|min|minutes?|km|kms|baht|thb)\b|฿|€|\$/i);
});

test("FAQ : précise que l'offre ne se limite pas à Koh Lanta et qu'elle couvre les aéroports", () => {
  const notOnly = taxi.faq.find((f) => /only drive from Koh Lanta/i.test(f.q));
  assert.ok(notOnly, "question « seulement depuis Koh Lanta »");
  assert.match(notOnly.a, /Southern Thailand/);
  assert.match(notOnly.a, /Ko Lanta/);
  const airports = taxi.faq.find((f) => /airport transfers?/i.test(f.q));
  assert.ok(airports, "question sur les transferts aéroport");
  assert.match(airports.a, /Krabi/);
  assert.match(airports.a, /Phuket/);
  assert.match(airports.a, /Surat Thani/);
});

test("variante d'orthographe « Ko Lanta » présente mais pas répétée à outrance", () => {
  const text = JSON.stringify(taxi);
  const count = (text.match(/Ko Lanta/g) || []).length;
  assert.ok(count >= 1 && count <= 3, `${count} occurrences de « Ko Lanta »`);
});

test("From et To sont des listes déroulantes de lieux populaires où l'on peut aussi écrire librement", () => {
  assert.doesNotMatch(njk, /h-routes|class="routes"|class="chips"|Request this transfer|<datalist|list="places"/);
  assert.doesNotMatch(njk, /taxi\.routes/);
  assert.match(njk, /macro combo\(/);
  assert.match(njk, /combo\("from", "From", taxi\.places\)/);
  assert.match(njk, /combo\("to", "To", taxi\.places\)/);
  for (const attr of ['role="combobox"', 'aria-autocomplete="list"', 'aria-expanded="false"', 'role="listbox"', 'role="option"']) {
    assert.ok(njk.includes(attr), attr);
  }
});

test("données structurées : catalogue des services sans prix", () => {
  const ld = taxiView().jsonLd;
  assert.equal(ld.hasOfferCatalog["@type"], "OfferCatalog");
  const items = ld.hasOfferCatalog.itemListElement;
  assert.ok(items.length >= 3);
  assert.doesNotMatch(JSON.stringify(ld), /"price"|priceCurrency/i);
});

// Ce plafond en nombre d'occurrences empêche d'ajouter de la répétition sans y penser.
test("répétition de « Koh Lanta » plafonnée à 24 occurrences dans les textes de la page", () => {
  const shown = ["title", "text", "lead", "note", "q", "a"];
  const dataText = [taxi.hero, taxi.tours, taxi.rating, taxi.payment].concat(taxi.services, taxi.why, taxi.steps, taxi.faq)
    .map((item) => shown.map((k) => item[k]).filter(Boolean).join(" ")).join(" ");
  const hits = (dataText.match(/Koh Lanta/g) || []).length;
  assert.ok(hits <= 24, `${hits} occurrences de « Koh Lanta »`);
});

test("services : les aéroports sont nommés avec leurs codes, dans les deux sens", () => {
  const text = taxi.services.map((s) => s.text).join(" ");
  for (const code of ["KBV", "HKT", "URT"]) assert.match(text, new RegExp(code));
  assert.match(text, /both directions/);
});

test("FAQ : questions précises sur les trajets depuis les aéroports, le retour et les enfants", () => {
  const questions = taxi.faq.map((f) => f.q).join(" | ");
  assert.match(questions, /Krabi Airport to Koh Lanta/);
  assert.match(questions, /Phuket Airport/);
  assert.match(questions, /leave Koh Lanta/);
  assert.match(questions, /children or babies/);
  assert.ok(taxi.faq.length >= 10, `${taxi.faq.length} questions`);
  assert.equal(new Set(taxi.faq.map((f) => f.q)).size, taxi.faq.length, "pas de question en double");
});

test("mise en page : la FAQ vient après le formulaire", () => {
  assert.ok(njk.indexOf('id="h-faq"') > njk.indexOf('id="request"'), "FAQ sous le formulaire");
  assert.ok(njk.indexOf('id="h-faq"') < njk.indexOf("</main>"), "FAQ dans <main>");
});

test("bloc Secret : encart publicitaire à part, avec son logo et sa couleur, pas une section du site", () => {
  const partner = fs.readFileSync(path.join(__dirname, "../src/_includes/taxi-partner.njk"), "utf8");
  const route = fs.readFileSync(path.join(__dirname, "../src/taxi-route.njk"), "utf8");
  for (const page of [njk, route]) assert.match(page, /include "taxi-partner\.njk"/);
  assert.match(partner, /<aside class="partner" aria-labelledby="h-tours">/);
  assert.match(partner, /class="partner-tag">\{\{ taxi\.tours\.tag \}\}/);
  assert.match(partner, /class="partner-logo"[^>]*src="\/images\/secret\/emblem\.webp"/);
  assert.doesNotMatch(njk + route, /<section class="tours"/);
  const css = fs.readFileSync(path.join(__dirname, "../src/css/taxi.css"), "utf8");
  assert.match(css, /--sec-green:\s*#0A4C44/i);
  assert.match(css, /font-family:\s*'Concert One'/);
  assert.match(css, /\.partner\s*\{/);
});
