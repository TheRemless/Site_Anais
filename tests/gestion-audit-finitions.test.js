// tests/gestion-audit-finitions.test.js : derniers points de l'audit mobile du 26.11.2026 (n° 7 grands iPhone en paysage, n° 35 À encaisser).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const lire = (f) => fs.readFileSync(path.join(__dirname, "..", "src", "gestion", f), "utf8");

const ORDI = "(min-width: 900px) and (min-height: 501px), (min-width: 900px) and (pointer: fine)";
const TEL = "(max-width: 899px), (max-height: 500px) and (pointer: coarse)";

test("n° 7 : un iPhone en paysage (pointeur tactile, 500 px de haut au plus) ne passe jamais en mise en page d'ordinateur", () => {
  const css = lire("css/app.css");
  // Plus aucune règle qui bascule sur la seule largeur de 900 px.
  assert.doesNotMatch(css, /@media \(min-width: 900px\) \{/);
  assert.doesNotMatch(css, /@media \(max-width: 899px\) \{/);
  assert.ok(css.split(`@media ${ORDI} {`).length - 1 >= 19, "toutes les règles d'ordinateur portent la hauteur et le pointeur");
  assert.ok(css.split(`@media ${TEL} {`).length - 1 >= 6, "les règles de téléphone reçoivent le cas inverse");
  // Le bloc paysage compact vaut aussi pour les grands iPhone (926 à 956 px de large).
  assert.match(css, /@media \(max-height: 480px\) and \(orientation: landscape\) and \(max-width: 899px\), \(max-height: 480px\) and \(orientation: landscape\) and \(pointer: coarse\) \{/);
  // Les mêmes critères en JavaScript.
  assert.match(lire("js/views/whatsapp.mjs"), new RegExp(`matchMedia\\("${TEL.replace(/[()]/g, "\\$&")}"\\)`));
  assert.match(lire("js/views/agent.mjs"), new RegExp(`matchMedia\\("${ORDI.replace(/[()]/g, "\\$&")}"\\)`));
});

test("n° 35 : À encaisser sur téléphone, un bouton « … » de 44 px par ligne au lieu de « Dossier » et « Corriger »", () => {
  const css = lire("css/app.css");
  assert.match(css, /\.enc-plus \{ width: 44px; height: 44px; \}/);
  assert.match(css, /\.enc-actions:not\(:has\(\.enc-plus\)\) \{ display: none; \}/);
  // Le lien du nom garde une cible de 44 px sans agrandir la ligne.
  assert.match(css, /\.enc-texte a\.enc-client-lien \{ display: inline-flex; align-items: center; align-self: center; min-height: 44px; margin: -10px 0; \}/);
  const vue = lire("js/views/encaisser-commissions.mjs");
  assert.match(vue, /geste\(tr\("Ouvrir le dossier"\), \(\) => \(ouvrir\(\), naviguer\(`#\/dossier\/\$\{d\.dossier_id\}`\)\)\)/);
  assert.match(lire("js/i18n-en.mjs"), /"Plus d'actions : \{client\}": "More actions: \{client\}"/);
});
