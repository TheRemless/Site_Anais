// Ouverture rapide de Gestion (19.11.2026) : JS regroupé au build en fichiers aux noms empreintés, gardés un an et par le service worker ;
// la page, version.json et le service worker toujours relus. Ces tests lisent le site construit (npm run build avant npm test, comme la CI).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(RACINE, "_site/gestion");
const lire = (f) => fs.readFileSync(path.join(SITE, f), "utf8");
const construit = fs.existsSync(path.join(SITE, "b"));

test("build : la page annonce un point d'entrée regroupé et ses morceaux, tous présents, plus aucun module source", { skip: !construit && "lancer npm run build" }, () => {
  const index = lire("index.html");
  const entree = index.match(/<script type="module" src="(b\/app-[A-Z0-9]+\.js)"><\/script>/);
  assert.ok(entree, "point d'entrée b/app-<empreinte>.js");
  assert.ok(!/src="js\/app\.mjs"|href="js\//.test(index), "plus aucun module source chargé par la page");
  const annonces = [...index.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
  assert.ok(annonces.length > 0 && annonces.every((a) => a.startsWith("b/")), "morceaux annoncés d'avance, tous dans b/");
  for (const f of [entree[1], ...annonces]) assert.ok(fs.existsSync(path.join(SITE, f)), f);
  // Les morceaux que le point d'entrée importe sont tous annoncés : le navigateur les demande en un seul aller-retour.
  const importes = [...lire(entree[1]).matchAll(/from"\.\/([^"]+\.js)"/g)].map((m) => `b/${m[1]}`);
  for (const f of importes) assert.ok(annonces.includes(f), `${f} annoncé`);
  for (const css of ["app", "document"]) assert.match(index, new RegExp(`<link rel="stylesheet" href="b/${css}-[0-9a-f]{10}\\.css">`));
});

test("build : un nom empreinté porte le contenu exact de sa source (feuilles de style), les adresses relatives restent justes", { skip: !construit && "lancer npm run build" }, () => {
  const index = lire("index.html");
  const app = index.match(/href="(b\/app-[0-9a-f]{10}\.css)"/)[1];
  assert.equal(lire(app), fs.readFileSync(path.join(RACINE, "src/gestion/css/app.css"), "utf8"));
  for (const u of lire(app).matchAll(/url\(["']?(\.\.\/[^"')]+)["']?\)/g)) assert.ok(fs.existsSync(path.join(SITE, "b", u[1])), u[1]);
});

test("build : les écrans chargés à la demande restent à part", { skip: !construit && "lancer npm run build" }, () => {
  const fichiers = fs.readdirSync(path.join(SITE, "b"));
  for (const ecran of ["partenaires", "demandes-site", "analyses", "voucher-rapide", "html2canvas", "store-supabase", "store-local"]) assert.ok(fichiers.some((f) => f.startsWith(`${ecran}-`)), `${ecran} dans son propre fichier`);
  const index = lire("index.html");
  assert.ok(!/html2canvas|analyses-/.test(index), "ni html2canvas ni les statistiques au démarrage");
});

test("build : le service worker reçoit la liste exacte des fichiers regroupés et une version qui change avec eux", { skip: !construit && "lancer npm run build" }, () => {
  const sw = lire("sw.js");
  const liste = JSON.parse(sw.match(/const PRECHARGE = (\[[^\]]*\]);/)[1]);
  assert.deepEqual(liste, fs.readdirSync(path.join(SITE, "b")).sort().map((f) => `b/${f}`));
  assert.match(sw, /const VERSION_APP = "[0-9a-f]{10}";/);
  assert.ok(!liste.some((f) => /index\.html|version\.json|sw\.js/.test(f)));
});

test("netlify.toml : b/ un an sans revalidation, la page, version.json et le service worker relus, aucun Cache-Control sur /gestion/*", () => {
  const toml = fs.readFileSync(path.join(RACINE, "netlify.toml"), "utf8");
  const bloc = (motif) => {
    const i = toml.indexOf(`for = "${motif}"`);
    assert.ok(i >= 0, motif);
    const fin = toml.indexOf("[[headers]]", i);
    return toml.slice(i, fin < 0 ? undefined : fin);
  };
  assert.ok(!/Cache-Control/.test(bloc("/gestion/*")), "sinon il se combinerait avec celui de /gestion/b/*");
  assert.match(bloc("/gestion/b/*"), /Cache-Control = "public, max-age=31536000, immutable"/);
  for (const m of ["/gestion/", "/gestion/index.html", "/gestion/version.json", "/gestion/sw.js"]) assert.match(bloc(m), /Cache-Control = "no-cache"/, m);
  assert.match(bloc("/gestion/*"), /Content-Security-Policy = "default-src 'self'; script-src 'self';/, "la politique de sécurité ne change pas");
});

test("sources : imports écrits en entier (le regroupement les suit), service worker installé pour tous, repère de mesure", () => {
  const store = fs.readFileSync(path.join(RACINE, "src/gestion/js/store.mjs"), "utf8");
  assert.match(store, /reel \? await import\("\.\/store-supabase\.mjs"\) : await import\("\.\/store-local\.mjs"\)/);
  for (const f of fs.readdirSync(path.join(RACINE, "src/gestion/js"), { recursive: true }).filter((f) => f.endsWith(".mjs"))) {
    const code = fs.readFileSync(path.join(RACINE, "src/gestion/js", f), "utf8");
    for (const m of code.matchAll(/import\(([^)]*)\)/g)) assert.match(m[1], /^\s*["'][^"']+["']\s*$/, `${f} : import(${m[1]}) doit être une adresse écrite en entier`);
  }
  const app = fs.readFileSync(path.join(RACINE, "src/gestion/js/app.mjs"), "utf8");
  assert.match(app, /navigator\.serviceWorker\.register\("sw\.js", \{ scope: "\.\/" \}\)/);
  assert.match(app, /performance\.mark\("gestion-pret"\)/);
  assert.match(fs.readFileSync(path.join(RACINE, ".eleventy.js"), "utf8"), /await regrouperGestion\(\{ source: path\.join\(__dirname, "src\/gestion"\), sortie: path\.join\(dir\.output, "gestion"\) \}\);/);
});

test("données : à l'ouverture, le marqueur du catalogue part avec les tables (un aller-retour de moins) ; le journal n'est jamais lu au démarrage", () => {
  const store = fs.readFileSync(path.join(RACINE, "src/gestion/js/store-supabase.mjs"), "utf8");
  assert.match(store, /const marqueur = empreinteCatalogue\(\)\.then\(\(e\) => e, \(\) => null\);/);
  assert.match(store, /if \(!ouverture\) \{\n\s+nouvelle = await marqueur;/);
  const charger = store.slice(store.indexOf("async charger("), store.indexOf("async inserer("));
  assert.ok(!/journal/.test(charger), "le journal se lit à l'écran Journal seulement");
});
