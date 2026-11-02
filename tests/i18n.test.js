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
  // Hors périmètre, volontairement non vérifié ici : ces hrefs restent français
  // même dans src/en/ (pages non traduites) : /galerie/, /mini-guides/,
  // /mentions-legales/, /politique-confidentialite/, et /cgv/ dans le
  // bandeau de src/en/cgv.njk qui renvoie volontairement vers la version française.
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

// --- Garde-fous sur les 3 duplications les plus fragiles (voir docs/superpowers/specs/2026-09-17-selecteur-langue-design.md, section "Maintenance") ---

test("i18n : Girls Trips sans dates fixes, champ libre de période dans les deux formulaires", () => {
  // Décision du 30.10.2026 : les Girls Trips se font toute l'année, les dates se choisissent avec le groupe.
  for (const file of ["src/girls-trips.njk", "src/en/girls-trips.njk"]) {
    const content = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.doesNotMatch(content, /date-card|dates-grid/, file + " ne doit plus afficher de grille de dates");
  }
  for (const file of ["src/contact.njk", "src/en/contact.njk"]) {
    const content = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.match(content, /<input type="text" id="gt_depart" name="gt_depart"/, file + " doit avoir un champ libre gt_depart");
    assert.doesNotMatch(content, /<select id="gt_depart"/, file + " ne doit plus avoir de select de dates");
  }
});

test('i18n : la chaîne "Girls Trips ✨" est identique partout où elle sert à la détection', () => {
  const files = [
    path.join(__dirname, "..", "src", "contact.njk"),
    path.join(__dirname, "..", "src", "en", "contact.njk"),
    path.join(__dirname, "..", "netlify", "functions", "submission-created.js"),
  ];
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    assert.ok(content.includes("Girls Trips ✨"), file + " ne contient pas la chaîne exacte \"Girls Trips ✨\"");
  }
});

test("i18n : SUBJECT_GROUPS de src/en/contact.njk correspond aux <option> et data-subject-group réels", () => {
  const content = fs.readFileSync(path.join(__dirname, "..", "src", "en", "contact.njk"), "utf8");

  const groupsBlock = content.match(/var SUBJECT_GROUPS = \{([\s\S]*?)\};/);
  assert.ok(groupsBlock, "SUBJECT_GROUPS introuvable dans src/en/contact.njk");

  const pairRe = /"([^"]+)":\s*"([^"]+)"/g;
  const groups = [];
  let m;
  while ((m = pairRe.exec(groupsBlock[1]))) groups.push([m[1], m[2]]);
  assert.ok(groups.length > 0, "aucune paire clé/valeur trouvée dans SUBJECT_GROUPS");

  const optionRe = /<option[^>]*>([^<]*)<\/option>/g;
  const optionTexts = [];
  while ((m = optionRe.exec(content))) optionTexts.push(m[1]);

  const dataGroupRe = /data-subject-group="([^"]+)"/g;
  const dataGroupValues = [];
  while ((m = dataGroupRe.exec(content))) dataGroupValues.push(m[1]);

  for (const [key, value] of groups) {
    assert.ok(optionTexts.includes(key), `SUBJECT_GROUPS a la clé "${key}" mais aucune <option> ne porte ce texte`);
    assert.ok(
      dataGroupValues.includes(value),
      `SUBJECT_GROUPS pointe vers le groupe "${value}" mais aucun data-subject-group="${value}" n'existe`
    );
  }
});

test("CGV : version anglaise présente, liée depuis le pied de page anglais", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  assert.ok(fs.existsSync(path.join(root, "src", "en", "cgv.njk")), "src/en/cgv.njk manque");
  const footer = fs.readFileSync(path.join(root, "src", "_includes", "footer.njk"), "utf8");
  assert.match(footer, /\{% if lang == "en" %\}\/en\/cgv\/\{% else %\}\/cgv\/\{% endif %\}/);
  const en = fs.readFileSync(path.join(root, "_site", "en", "cgv", "index.html"), "utf8");
  assert.match(en, /hreflang="fr" href="https:\/\/zwaldtravelplanner\.com\/cgv\/"/);
});
