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
  const sitemap = read("src/sitemap.xml");
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

test("itinéraires : au moins 10 trajets tirés de la liste de destinations, avec codes d'aéroport", () => {
  assert.ok(taxi.routes.length >= 10, `${taxi.routes.length} itinéraires`);
  const titles = taxi.routes.map((r) => r.title).join(" | ");
  for (const code of ["KBV", "HKT", "URT"]) assert.match(titles, new RegExp(code));
  for (const r of taxi.routes) {
    assert.equal(typeof r.confirmed, "boolean", r.title);
    assert.ok(r.title, r.title);
  }
});

test("itinéraires : chaque trajet pré-remplit From et To, sauf « ailleurs » qui laisse libre", () => {
  const anywhere = taxi.routes.filter((r) => !r.from && !r.to);
  assert.equal(anywhere.length, 1, "une seule entrée « ailleurs dans le sud de la Thaïlande »");
  assert.match(anywhere[0].title, /Southern Thailand/);
  for (const r of taxi.routes.filter((x) => x.from || x.to)) {
    assert.ok(r.from && r.to, r.title);
    assert.ok(r.from === "Koh Lanta" || r.to === "Koh Lanta", r.title);
    // Les lieux proposés doivent exister dans la liste suggérée de la page.
    for (const place of [r.from, r.to]) assert.ok(taxi.places.includes(place), `${place} absent de places`);
  }
});

test("itinéraires : aucune durée, distance ni prix inventé", () => {
  const all = JSON.stringify(taxi.routes) + JSON.stringify(taxi.faq);
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

test("la page affiche les itinéraires avec un lien qui pré-remplit le formulaire, sans texte caché en double", () => {
  assert.doesNotMatch(njk, /class="sr"> \{\{ r\.title/);
  assert.match(njk, /aria-describedby="route-/);
  assert.match(njk, /taxi\.routes/);
  assert.match(njk, /data-from/);
  assert.match(njk, /data-to/);
  assert.match(njk, /h-routes/);
});

test("données structurées : catalogue des services sans prix", () => {
  const ld = taxiView().jsonLd;
  assert.equal(ld.hasOfferCatalog["@type"], "OfferCatalog");
  const items = ld.hasOfferCatalog.itemListElement;
  assert.ok(items.length >= 3);
  assert.doesNotMatch(JSON.stringify(ld), /"price"|priceCurrency/i);
});

// Le nom de la base figure dans chaque titre d'itinéraire (« Krabi Airport (KBV) and Koh Lanta »), c'est voulu :
// c'est la formulation que les gens tapent. Sur la page rendue, cela représente environ 3 % des mots visibles.
// Ce plafond en nombre d'occurrences (21 aujourd'hui) empêche d'ajouter de la répétition sans y penser.
test("répétition de « Koh Lanta » plafonnée à 24 occurrences dans les textes de la page", () => {
  const shown = ["title", "text", "lead", "note", "q", "a"];
  const dataText = [taxi.hero, taxi.tours, taxi.rating, taxi.payment].concat(taxi.services, taxi.routes, taxi.why, taxi.steps, taxi.faq)
    .map((item) => shown.map((k) => item[k]).filter(Boolean).join(" ")).join(" ");
  const hits = (dataText.match(/Koh Lanta/g) || []).length;
  assert.ok(hits <= 24, `${hits} occurrences de « Koh Lanta »`);
});
