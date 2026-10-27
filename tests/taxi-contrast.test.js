const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "../src/css/taxi.css"), "utf8");

function token(name) {
  const m = css.match(new RegExp("--" + name + ":\\s*(#[0-9a-fA-F]{6})\\b"));
  assert.ok(m, "jeton --" + name + " introuvable dans taxi.css");
  return m[1];
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [texte, fond] : tous les couples de texte réellement utilisés dans la page.
const PAIRS = [
  ["text", "bg"],
  ["mute", "bg"],
  ["amber", "bg"],
  ["text", "bg-2"],
  ["mute", "bg-2"],
  ["ink", "amber"],
  ["ink", "paper"],
  ["mute-ink", "paper"],
  ["err", "paper"],
  ["paper", "ink"]
];

for (const [fg, bg] of PAIRS) {
  test(`contraste --${fg} sur --${bg} d'au moins 4,5:1`, () => {
    const r = ratio(token(fg), token(bg));
    assert.ok(r >= 4.5, `ratio ${r.toFixed(2)} pour ${token(fg)} sur ${token(bg)}`);
  });
}
