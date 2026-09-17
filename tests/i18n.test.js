const test = require("node:test");
const assert = require("node:assert/strict");
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
