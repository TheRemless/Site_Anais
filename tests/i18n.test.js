const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const i18n = require("../src/_data/i18n.json");

test("i18n : le français et l'anglais ont exactement les mêmes clés", () => {
  const frKeys = Object.keys(i18n.fr).sort();
  const enKeys = Object.keys(i18n.en).sort();
  assert.deepEqual(frKeys, enKeys);
});

test("i18n : aucune valeur vide", () => {
  for (const lang of ["fr", "en"]) {
    for (const [key, value] of Object.entries(i18n[lang])) {
      assert.ok(value && value.length > 0, `${lang}.${key} est vide`);
    }
  }
});

const TRANSLATED_PAGES = [
  "index.njk",
  "services.njk",
  "girls-trips.njk",
  "cartes-cadeaux.njk",
  "faq.njk",
  "contact.njk",
  "a-propos.njk",
];

test("i18n : chacune des 7 pages traduites existe côté FR et côté EN", () => {
  for (const file of TRANSLATED_PAGES) {
    const fr = path.join(__dirname, "..", "src", file);
    const en = path.join(__dirname, "..", "src", "en", file);
    assert.ok(fs.existsSync(fr), file + " manquant côté français");
    assert.ok(fs.existsSync(en), file + " manquant côté anglais (src/en/)");
  }
});

test("i18n : aucun lien de corps de page en français dans src/en/", () => {
  const enDir = path.join(__dirname, "..", "src", "en");
  const outOfScopeHrefs = ["/galerie/", "/mini-guides/", "/mentions-legales/", "/cgv/", "/politique-confidentialite/"];
  const inScopeFrHrefs = TRANSLATED_PAGES.map((f) => {
    const slug = f === "index.njk" ? "" : f.replace(".njk", "/");
    return "href=\"/" + slug + "\"";
  });
  for (const file of fs.readdirSync(enDir)) {
    if (!file.endsWith(".njk")) continue;
    const content = fs.readFileSync(path.join(enDir, file), "utf8");
    for (const badHref of inScopeFrHrefs) {
      assert.ok(
        !content.includes(badHref),
        file + " contient un lien français " + badHref + " vers une page pourtant traduite (devrait pointer vers /en/...)"
      );
    }
  }
});
