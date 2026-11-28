// Audit mobile du 26.11.2026, bloquant n° 1 : la recherche et l'onglet de la liste des dossiers suivaient d'une entreprise à l'autre.
// Relecture de la PR #357 : l'adresse de la liste porte l'entreprise, et la recherche ne se perd plus au retour arrière ni au redessin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filtreDeLEntite, filtreDepuisAdresse, adresseListe } from "../src/gestion/js/filtre-entite-calc.mjs";

const DEFAUT = { onglet: "cours", q: "", tri: "recents" };
const OPTIONS = { onglets: ["cours", "encaisser", "attente", "annules", "tous"], tris: ["recents", "reste", "client"] };
const lire = (adresse, entiteId) => filtreDepuisAdresse(new URLSearchParams(adresse.split("?")[1] || ""), entiteId, OPTIONS);

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

test("adresse de la liste : onglet, tri et entreprise, jamais la recherche", () => {
  const a = adresseListe({ onglet: "annules", q: "Rochat", tri: "client" }, "e-1");
  assert.equal(a, "#/dossiers?e=e-1&onglet=annules&tri=client");
  assert.doesNotMatch(a, /Rochat/);
});

test("adresse de la liste : notre propre adresse rend onglet et tri et garde la recherche (redessin en direct, retour arrière)", () => {
  const memo = new Map();
  const f = filtreDeLEntite(memo, "e-1", DEFAUT);
  Object.assign(f, { onglet: "annules", q: "Rochat", tri: "client" });
  // Ce que fait listeDossiers() quand app.mjs rappelle l'écran sur la même adresse.
  Object.assign(f, lire(adresseListe(f, "e-1"), "e-1"));
  assert.deepEqual(f, { onglet: "annules", q: "Rochat", tri: "client" });
});

test("adresse de la liste : l'onglet et le tri d'une autre entreprise sont ignorés", () => {
  const ecrite = adresseListe({ onglet: "annules", q: "", tri: "client" }, "agence");
  assert.deepEqual(lire(ecrite, "excursions"), {});
});

test("adresse de la liste : un chiffre du tableau de bord ouvre son onglet sur une liste sans recherche", () => {
  assert.deepEqual(lire("#/dossiers?onglet=encaisser&tri=reste", "e-1"), { onglet: "encaisser", tri: "reste", q: "" });
  assert.deepEqual(lire("#/dossiers?onglet=attente", "e-1"), { onglet: "attente", q: "" });
});

test("adresse de la liste : un lien avec sa recherche la pose, le menu « Dossiers » ne touche à rien", () => {
  assert.deepEqual(lire("#/dossiers?q=ZTP-12", "e-1"), { q: "ZTP-12" });
  assert.deepEqual(lire("#/dossiers", "e-1"), {});
});

test("adresse de la liste : un onglet ou un tri inconnus ne passent pas", () => {
  assert.deepEqual(lire("#/dossiers?e=e-1&onglet=soldes&tri=nimporte", "e-1"), {});
});

test("adresse de la liste : sans entreprise active, l'adresse se relit quand même", () => {
  const f = { onglet: "tous", q: "x", tri: "reste" };
  assert.deepEqual(lire(adresseListe(f, null), null), { onglet: "tous", tri: "reste" });
});
