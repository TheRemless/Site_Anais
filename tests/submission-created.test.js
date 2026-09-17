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

test("buildBodies : nom et sujet échappés dans le HTML, pas dans le texte brut", () => {
  const { text, html } = buildBodies("<b>Marc</b>", "Devis & co", "fr");
  assert.match(text, /^Merci <b>Marc<\/b> !/);
  assert.match(html, /&lt;b&gt;Marc&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<strong><b>/);
  assert.match(html, /Devis &amp; co/);
});
