// tests/gestion-audit-finitions.test.js : derniers points de l'audit mobile du 26.11.2026 (n° 7 grands iPhone en paysage, n° 35 À encaisser).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const lire = (f) => fs.readFileSync(path.join(__dirname, "..", "src", "gestion", f), "utf8");

const P = "(orientation: landscape) and (max-width: 960px) and (max-height: 500px) and (pointer: coarse)";
const TEL = `not all and (min-width: 900px), ${P}`;
const echapper = (x) => x.replace(/[()]/g, "\\$&");

// Évalue une requête simple (sans « , » ni « not ») sur un appareil : largeur, hauteur, pointeur.
function vaut(req, a) {
  return req.split(" and ").every((c) => {
    const m = c.trim().match(/^\((min|max)-(width|height): (\d+)px\)$/);
    if (m) { const v = m[2] === "width" ? a.l : a.h; return m[1] === "min" ? v >= +m[3] : v <= +m[3]; }
    if (c.trim() === "(orientation: landscape)") return a.l > a.h;
    const q = c.trim().match(/^\(pointer: (\w+)\)$/); if (q) return a.p === q[1];
    throw new Error(`condition inconnue : ${c}`);
  });
}
const telephone = (a) => !vaut("(min-width: 900px)", a) || vaut(P, a);
const ordinateur = (a) => vaut("(min-width: 900px)", a) && !vaut(P, a);

test("n° 7 : coques de téléphone et d'ordinateur exactement complémentaires, une seule condition de paysage", () => {
  const css = lire("css/app.css");
  // Plus aucune requête à trous (largeur seule, hauteur 500 / 501, pointer: fine).
  assert.doesNotMatch(css, /min-height: 501px|@media \(min-width: 900px\) \{(?! @media not all)|@media \(max-width: 899px\) \{|\(pointer: fine\) \{/);
  const ordi = css.split(`@media (min-width: 900px) { @media not all and ${P} {`).length - 1;
  const tel = css.split(`@media ${TEL} {`).length - 1;
  assert.ok(ordi >= 19 && tel >= 6, `${ordi} règles d'ordinateur, ${tel} de téléphone`);
  // Les deux tests JS lisent la même requête : le téléphone, et l'ordinateur comme son contraire.
  assert.match(lire("js/views/whatsapp.mjs"), new RegExp(`matchMedia\\("${echapper(TEL)}"\\)\\.matches`));
  assert.match(lire("js/views/agent.mjs"), new RegExp(`!matchMedia\\("${echapper(TEL)}"\\)\\.matches`));
  // Complémentaires sur une grille d'appareils, hauteurs fractionnaires et pointeur absent compris (relecture de la PR 367).
  for (const l of [320, 719.5, 899.5, 900, 926, 956, 960, 960.5, 1024, 1180, 1280, 1920])
    for (const h of [380, 428, 440, 499.5, 500, 500.5, 501, 768, 820, 1000])
      for (const p of ["coarse", "fine", "none"]) {
        const a = { l, h, p };
        assert.notEqual(telephone(a), ordinateur(a), JSON.stringify(a));
      }
  // Les cas demandés.
  for (const [l, h] of [[956, 440], [926, 428], [844, 390]]) assert.ok(telephone({ l, h, p: "coarse" }), `iPhone ${l}×${h}`);
  assert.ok(ordinateur({ l: 1180, h: 820, p: "coarse" }), "iPad en paysage");
  assert.ok(ordinateur({ l: 1280, h: 800, p: "fine" }), "ordinateur");
  // Tablette de 1280 px dont le clavier réduit la hauteur à 400 : la coque ne change pas en pleine saisie.
  assert.ok(ordinateur({ l: 1280, h: 400, p: "coarse" }), "tablette, clavier ouvert");
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
  // Un iPhone en paysage (720 à 960 px) garde la variante du doigt, malgré .seulement-mobile qui s'arrête à 720 px.
  assert.match(css, new RegExp(`@media ${echapper(P)} \\{\\s*\\.enc-dossier \\.seulement-bureau \\{ display: none !important; \\}`));
  assert.match(css, new RegExp(`@media \\(max-width: 719px\\), ${echapper(P)} \\{\\s*/\\* Case, nom et montant`));
});
