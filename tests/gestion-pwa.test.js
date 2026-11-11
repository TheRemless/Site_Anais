import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const dossier = path.resolve("src/gestion");
const manifeste = JSON.parse(fs.readFileSync(path.join(dossier, "manifest.webmanifest"), "utf8"));
const index = fs.readFileSync(path.join(dossier, "index.html"), "utf8");

// Dimensions d'un PNG : largeur et hauteur sont dans l'en-tête IHDR.
const tailleDe = (fichier) => {
  const b = fs.readFileSync(fichier);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
};

test("manifeste : installable en plein écran, dans le périmètre de l'outil", () => {
  assert.equal(manifeste.display, "standalone");
  assert.equal(manifeste.start_url, "/gestion/");
  assert.ok(manifeste.start_url.startsWith(manifeste.scope));
  assert.ok(manifeste.name && manifeste.short_name);
});

test("manifeste : chaque icône existe à la taille annoncée, avec une icône masquable", () => {
  for (const i of manifeste.icons) assert.equal(tailleDe(path.join(dossier, i.src)), i.sizes, i.src);
  assert.ok(manifeste.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"));
  assert.ok(manifeste.icons.some((i) => i.purpose === "any" && i.sizes === "192x192"));
});

test("page : le manifeste et l'icône iPhone sont liés, l'outil reste non indexé", () => {
  assert.match(index, /<link rel="manifest" href="manifest\.webmanifest">/);
  const m = /<link rel="apple-touch-icon" sizes="180x180" href="\/gestion\/(assets\/[^"]+)">/.exec(index);
  assert.ok(m, "icône iPhone liée par un chemin absolu, avec sa taille");
  assert.equal(tailleDe(path.join(dossier, m[1])), "180x180");
  // iOS retient l'icône d'une adresse : un fichier déjà vu sans succès ne se recharge pas, d'où des noms neufs (zwald-*) plutôt que icone-*.
  assert.match(m[1], /zwald-180\.png$/);
  assert.match(index, /apple-mobile-web-app-capable/);
  assert.match(index, /noindex/);
});

test("page : plein écran sous l'encoche, zoom permis, thème clair, pas de service externe qui bloque l'affichage", () => {
  assert.match(index, /viewport-fit=cover/);
  assert.doesNotMatch(index, /user-scalable=no|maximum-scale/, "le zoom reste permis");
  assert.match(index, /<meta name="color-scheme" content="light">/);
  assert.doesNotMatch(index, /fonts\.googleapis\.com|fonts\.gstatic\.com/, "la police est auto-hébergée");
  const css = fs.readFileSync(path.join(dossier, "css/app.css"), "utf8");
  assert.match(css, /@font-face\s*\{\s*font-family:\s*"Raleway"/);
  for (const m of css.matchAll(/url\("\.\.\/(assets\/fonts\/[^"]+)"\)/g)) assert.ok(fs.existsSync(path.join(dossier, m[1])), m[1]);
});

test("manifeste : les raccourcis restent dans le périmètre de l'outil et ont leur icône", () => {
  for (const r of manifeste.shortcuts || []) {
    assert.ok(r.url.startsWith(manifeste.scope), r.url);
    for (const i of r.icons) assert.ok(fs.existsSync(path.join(dossier, i.src)), i.src);
  }
});

test("service worker : ni cache ni interception des requêtes (l'outil se charge toujours depuis le réseau)", () => {
  const sw = fs.readFileSync(path.join(dossier, "sw.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(sw, /\bcaches\b/);
  assert.doesNotMatch(sw, /addEventListener\(\s*["']fetch["']/);
});

test("modulepreload : chaque module annoncé existe", () => {
  for (const m of index.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)) assert.ok(fs.existsSync(path.join(dossier, m[1])), m[1]);
});
