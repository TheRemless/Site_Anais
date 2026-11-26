// Audit mobile du 26.11.2026, bloquant n° 1 : la recherche et l'onglet de la liste des dossiers suivaient d'une entreprise à l'autre.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { filtreDeLEntite } from "../src/gestion/js/filtre-entite-calc.mjs";

const DEFAUT = { onglet: "cours", q: "", tri: "recents" };

test("filtre par entreprise : la recherche d'Agence ne suit pas dans Excursions", () => {
  const memo = new Map();
  const agence = filtreDeLEntite(memo, "agence", DEFAUT);
  agence.q = "Rochat";
  agence.onglet = "annules";
  const excursions = filtreDeLEntite(memo, "excursions", DEFAUT);
  assert.deepEqual(excursions, DEFAUT);
});

test("filtre par entreprise : on retrouve sa recherche en revenant dans l'entreprise", () => {
  const memo = new Map();
  filtreDeLEntite(memo, "agence", DEFAUT).q = "Rochat";
  filtreDeLEntite(memo, "excursions", DEFAUT);
  assert.equal(filtreDeLEntite(memo, "agence", DEFAUT).q, "Rochat");
});

test("filtre par entreprise : le défaut n'est jamais modifié", () => {
  const memo = new Map();
  filtreDeLEntite(memo, "agence", DEFAUT).q = "Rochat";
  assert.equal(DEFAUT.q, "");
});

test("liste des dossiers : le filtre est repris de l'entreprise active à chaque affichage", () => {
  const src = fs.readFileSync("src/gestion/js/views/dossiers.mjs", "utf8");
  assert.match(src, /filtre = filtreDeLEntite\(memoFiltres, etat\.entiteId, FILTRE_DEFAUT\)/);
  assert.doesNotMatch(src, /const filtre = \{/);
});
