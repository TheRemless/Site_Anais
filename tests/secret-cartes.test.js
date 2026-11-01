// Cartes de /secret/ : toute la carte (photo, titre) est cliquable, pas seulement « Learn more ».
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const njk = read("src/secret.njk");
const css = read("src/css/secret.css");
const js = read("src/js/secret.js");

test("carte : le titre est un lien vers la page de l'excursion, ou vers le formulaire sans page", () => {
  const macro = njk.slice(njk.indexOf("{%- macro card("), njk.indexOf("{%- macro waIcon"));
  assert.match(macro, /<article class="card card-hit">/);
  assert.match(macro, /<h3><a class="card-link" href="\/secret\/\{\{ item\.id \}\}\/">\{\{ item\.name \}\}<\/a><\/h3>/);
  // Sans page dédiée, le titre ouvre le formulaire prérempli comme « Get a price ».
  assert.match(macro, /<h3><a class="card-link" href="#tell-us" data-type="\{\{ type \}\}" data-value="\{\{ item\.name \}\}">/);
  // Les liens explicites restent.
  assert.match(macro, /class="learn"/);
  assert.match(macro, /getPrice\(type, item\.name\)/);
});

test("css : le lien du titre couvre toute la carte, les liens explicites restent au-dessus", () => {
  assert.match(css, /\.card-hit\s*\{[^}]*position:\s*relative/);
  assert.match(css, /\.card-hit \.card-link::after\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/);
  assert.match(css, /\.card-hit \.links a\s*\{[^}]*position:\s*relative[^}]*z-index:\s*1/);
  assert.match(css, /\.card-hit \.card-link:focus-visible/);
});

test("js : le titre sans page préremplit le formulaire comme « Get a price »", () => {
  assert.match(js, /closest\("a\.get\[data-type\], a\.card-link\[data-type\], a\[data-open-form\]"\)/);
});
