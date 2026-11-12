import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const toml = fs.readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
const bloc = toml.slice(toml.indexOf('for = "/gestion/*"'), toml.indexOf('for = "/img/*"'));
const csp = (bloc.match(/Content-Security-Policy = "([^"]+)"/) || [])[1] || "";
const directive = (nom) => (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(nom + " ")) || "").split(/\s+/).slice(1);

test("CSP de /gestion/* : scripts de l'outil seulement, réseau vers Supabase seulement, pas d'intégration dans une autre page", () => {
  assert.ok(csp, "une Content-Security-Policy est posée sur /gestion/*");
  assert.deepEqual(directive("script-src"), ["'self'"], "aucun script en ligne ni externe");
  assert.ok(!/unsafe-eval/.test(csp));
  assert.deepEqual(directive("default-src"), ["'self'"]);
  assert.deepEqual(directive("object-src"), ["'none'"]);
  assert.deepEqual(directive("frame-ancestors"), ["'none'"]);
  assert.deepEqual(directive("worker-src"), ["'self'"]);
  const supabase = "https://lkxqcmzeidlyssoqmqkh.supabase.co";
  assert.deepEqual(directive("connect-src"), ["'self'", supabase, "wss://lkxqcmzeidlyssoqmqkh.supabase.co"]);
  assert.ok(directive("img-src").includes("data:") && directive("img-src").includes("blob:"), "aperçus, PDF et captures");
  // L'adresse de Supabase du code est bien celle que la politique autorise.
  const config = fs.readFileSync(new URL("../src/gestion/js/config.mjs", import.meta.url), "utf8");
  assert.ok(config.includes(supabase));
});

test("l'outil n'a ni script ni gestionnaire en ligne : la CSP ne casse rien", () => {
  const index = fs.readFileSync(new URL("../src/gestion/index.html", import.meta.url), "utf8");
  assert.ok(!/\son[a-z]+\s*=/i.test(index), "pas d'attribut onload, onclick, etc. dans index.html");
  const scripts = [...index.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
  assert.ok(scripts.length && scripts.every((a) => /\bsrc=/.test(a)), "tous les scripts sont des fichiers");
  assert.ok(!/javascript:/i.test(index));
  // Aucune origine externe chargée par la page (polices, CDN) : tout est local.
  assert.ok(![...index.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/gi)].length, "aucune ressource externe dans index.html");
});

test("le code de l'outil ne charge rien depuis une autre origine que Supabase", () => {
  const dossier = new URL("../src/gestion/js/", import.meta.url);
  const fichiers = [];
  const parcourir = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? parcourir(new URL(f.name + "/", d)) : /\.mjs$/.test(f.name) && fichiers.push(new URL(f.name, d)); };
  parcourir(dossier);
  for (const f of fichiers) {
    const code = fs.readFileSync(f, "utf8");
    assert.ok(!/\beval\s*\(|new Function\s*\(|importScripts\s*\(/.test(code), `${f.pathname} : ni eval, ni new Function`);
    for (const m of code.matchAll(/fetch\(\s*["'`](https?:\/\/[^"'`]+)/g)) assert.ok(/supabase\.co/.test(m[1]), `${f.pathname} : fetch vers ${m[1]}`);
  }
});
