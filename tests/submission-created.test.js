const test = require("node:test");
const assert = require("node:assert/strict");
const { buildBodies } = require("../netlify/functions/submission-created.js");

test("buildBodies : gabarit français par défaut", () => {
  const { text } = buildBodies("Claire", "Girls Trips ✨", "fr");
  assert.match(text, /^Merci Claire !/);
  assert.match(text, /Petit rappel/);
});

test("buildBodies : gabarit anglais", () => {
  const { text } = buildBodies("Claire", "Girls Trips ✨", "en");
  assert.match(text, /^Thank you Claire!/);
  assert.match(text, /Just a quick reminder/);
});

test("buildBodies : sujet hors Girls Trips, pas de rappel, dans les deux langues", () => {
  const fr = buildBodies("Marc", "Demande de devis", "fr");
  const en = buildBodies("Marc", "Custom-made trip", "en");
  assert.doesNotMatch(fr.text, /Petit rappel/);
  assert.doesNotMatch(en.text, /Just a quick reminder/);
});
