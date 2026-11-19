// Démo des prospects (/gestion/?demo=agence, Jérémy 19.11.2026) : une agence fictive, rien des entreprises d'Anaïs ni de Koh Lanta.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { donneesDemoAgence } from "../src/gestion/js/demo-agence.mjs";
import { ajouterJours } from "../src/gestion/js/calc.mjs";
import { moduleAllume } from "../src/gestion/js/modules.mjs";

const ajd = "2026-11-19";
const d = donneesDemoAgence(ajd, ajouterJours);

test("démo agence : aucun lieu, marque ni devise propre à Anaïs", () => {
  const txt = JSON.stringify(d);
  for (const m of ["Lanta", "Krabi", "Phuket", "Phi Phi", "Saladan", "Klong", "Koh ", "Lipe", "Ao Nang", "Langkawi", "Lomprayah", "Seatran", "฿", "THB", "VIP", "Secret", "Zwald", "Anaïs", "Moo "]) assert.ok(!txt.includes(m), m);
});

test("démo agence : une entreprise d'excursions en dollars, sans trajets, fiduciaire ni site", () => {
  assert.equal(d.entites.length, 1);
  const e = d.entites[0];
  const r = d.reglages[e.id];
  assert.equal(r.fonctionnement, "excursions");
  assert.equal(r.devise, "USD");
  assert.equal(r.fiduciaire.actif, false);
  assert.equal(e.publie_site, false);
  const ctx = { reglages: r, publieSite: e.publie_site };
  assert.equal(moduleAllume("trajets", ctx), false);
  assert.equal(moduleAllume("partenaires", ctx), true);
  assert.equal(moduleAllume("demandes_site", ctx), false);
  assert.ok(d.profils.every((p) => !p.plateforme && p.organisation_id === d.organisations[0].id));
});

test("démo agence : des services aujourd'hui et un historique, toujours les mêmes", () => {
  assert.ok(d.reservations.some((r) => r.date_service === ajd));
  assert.ok(d.dossiers.length > 60);
  const ids = new Set(d.dossiers.map((x) => x.id));
  assert.ok(d.reservations.every((r) => ids.has(r.dossier_id)));
  const refs = d.dossiers.map((x) => x.ref);
  assert.equal(new Set(refs).size, refs.length);
  const encore = donneesDemoAgence(ajd, ajouterJours);
  assert.deepEqual(encore.dossiers.map((x) => [x.ref, x.created_at]), d.dossiers.map((x) => [x.ref, x.created_at]));
});

test("démo agence : servie par ?demo=agence, à part de la démo d'Anaïs", () => {
  const s = fs.readFileSync(new URL("../src/gestion/js/store-local.mjs", import.meta.url), "utf8");
  assert.match(s, /get\("demo"\) === "agence"/);
  assert.match(s, /AGENCE \? "gestion-demo-agence-v2" : "gestion-zwald-demo-v13"/);
  const p = fs.readFileSync(new URL("../src/gestion/js/views/partenaires.mjs", import.meta.url), "utf8");
  assert.ok(!p.includes('modeTaxi() ? null : h("a", { class: "bouton secondaire", href: "#/trajets" }'));
});
