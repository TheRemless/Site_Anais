// Modules (SaaS, 17.11.2026) : les écrans propres à un métier passent par la table de modules.js, plus par des tests de mode dans chaque écran.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MODULES, moduleAllume, moduleDisponible, modulesReglables, moduleDeLEcran } from "../src/gestion/js/modules.mjs";

const FONC = ["sur_mesure", "excursions", "taxi"];
const ctx = (fonctionnement, modules = {}, publieSite) => ({ reglages: { fonctionnement, modules }, publieSite });

// L'ancienne règle de etat.mjs (avant les modules), pour vérifier que rien ne change chez Anaïs.
function ancienne(nom, fonctionnement, modules) {
  const exc = fonctionnement === "excursions" || fonctionnement === "taxi";
  const taxi = fonctionnement === "taxi";
  const brut = (n) => {
    if (["partenaires", "reservations", "messages"].includes(n) && !exc) return false;
    if (n === "catalogue" && exc) return false;
    const v = modules[n];
    if (v === true || v === false) return v;
    return true;
  };
  if (nom === "trajets" || nom === "du") return brut("partenaires") && !taxi;
  if (nom === "demande_collee" || nom === "demandes_site" || nom === "bandeau_site" || nom === "fiduciaire") return exc;
  if (nom === "commissions") return taxi && brut("reservations");
  return brut(nom);
}

test("modules : mêmes écrans qu'avant pour ZTP, Secret et Taxi, quels que soient les anciens choix « Écrans »", () => {
  const choix = [{}, { partenaires: false }, { reservations: false }, { messages: false }, { catalogue: false }, { partenaires: null, catalogue: null }, { partenaires: true, catalogue: true }];
  for (const f of FONC) for (const c of choix) for (const m of MODULES) assert.equal(moduleAllume(m.id, ctx(f, c)), ancienne(m.id, f, c), `${m.id} en ${f} avec ${JSON.stringify(c)}`);
});

test("modules : le réglage « Écrans » éteint un module, il ne l'ouvre jamais hors de sa façon de travailler", () => {
  assert.equal(moduleAllume("partenaires", ctx("sur_mesure", { partenaires: true })), false);
  assert.equal(moduleAllume("catalogue", ctx("excursions", { catalogue: true })), false);
  assert.equal(moduleAllume("trajets", ctx("taxi", { trajets: true })), false);
  assert.equal(moduleAllume("trajets", ctx("excursions", { partenaires: false, trajets: true })), false, "un module requis éteint ferme ceux qui en dépendent");
  assert.equal(moduleAllume("trajets", ctx("excursions", { trajets: false })), false);
  assert.equal(moduleAllume("partenaires", ctx("excursions", { trajets: false })), true, "masquer Trajets ne masque que lui");
  assert.equal(moduleAllume("inconnu", ctx("sur_mesure")), true);
});

test("modules du site : seulement dans une entreprise qui publie sur le site", () => {
  for (const id of ["demandes_site", "bandeau_site"]) {
    assert.equal(moduleAllume(id, ctx("excursions", {}, true)), true);
    assert.equal(moduleAllume(id, ctx("taxi", {}, false)), false, "entreprise d'un client sans site");
    assert.equal(moduleAllume(id, ctx("excursions", {}, undefined)), true, "colonne absente : rien ne se ferme");
    assert.equal(moduleAllume(id, ctx("sur_mesure", {}, true)), false);
  }
  assert.equal(moduleAllume("demandes_site", ctx("excursions", { demandes_site: false }, true)), false);
});

test("Réglages, Écrans : seuls les modules de la façon de travailler, sans la fiduciaire (elle a son propre réglage)", () => {
  const ids = (c) => modulesReglables(c).map((m) => m.id);
  assert.deepEqual(ids(ctx("sur_mesure")), ["catalogue"]);
  assert.deepEqual(ids(ctx("excursions", { partenaires: false }, true)), ["partenaires", "trajets", "du", "reservations", "messages", "demande_collee", "demandes_site", "bandeau_site"], "Trajets reste proposé quand Partenaires est masqué");
  assert.deepEqual(ids(ctx("taxi", {}, false)), ["partenaires", "reservations", "messages", "demande_collee", "commissions"]);
});

test("chaque écran de module a sa route et passe par ecranDeLEntreprise", () => {
  const app = fs.readFileSync("src/gestion/js/app.mjs", "utf8");
  for (const m of MODULES) for (const cle of m.ecrans) {
    assert.equal(moduleDeLEcran(cle).id, m.id);
    assert.match(app, new RegExp(`"${cle}", vers\\(`), `route ${cle}`);
  }
  assert.match(app, /const m = moduleDeLEcran\(cle\);\n  return !m \|\| moduleActif\(m\.id\);/);
  assert.equal(moduleDeLEcran("dossiers"), null);
});

test("plus de test de mode pour afficher un écran du menu, du site ou de « Coller une demande »", () => {
  const app = fs.readFileSync("src/gestion/js/app.mjs", "utf8");
  const menu = app.slice(app.indexOf("function ecrans()"), app.indexOf("].filter((s) => s.items.length);"));
  assert.doesNotMatch(menu.slice(menu.indexOf('titre: tr("Partenaires")')), /modeTaxi\(\)|modeExcursions\(\)/);
  assert.doesNotMatch(app, /const siteVisible = \(\) => modeExcursions/);
  for (const f of ["views/dashboard.mjs", "views/dossiers.mjs"]) assert.match(fs.readFileSync(`src/gestion/js/${f}`, "utf8"), /moduleActif\("demande_collee"\) \? h\("button"/, f);
  assert.match(fs.readFileSync("src/gestion/js/views/dashboard.mjs", "utf8"), /moduleActif\("commissions"\) \? sectionCommissionsHier/);
  assert.doesNotMatch(fs.readFileSync("src/gestion/js/views/bandeau-site.mjs", "utf8"), /modeTaxi|caseMarque\("secret"\)/);
  assert.doesNotMatch(fs.readFileSync("src/gestion/js/views/demandes-site.mjs", "utf8"), /d\.marque === "taxi" \? "taxi" : "secret"|secrettravelandtour\.com/);
});

test("le menu se refait quand un module s'allume ou s'éteint, sans recharger la page", () => {
  const app = fs.readFileSync("src/gestion/js/app.mjs", "utf8");
  assert.match(app, /const cle = `\$\{etat\.entiteId\}\|\$\{roleActif\(\)\}\|\$\{etat\.session\.id\}\|\$\{langueActive\(\)\}\|\$\{MODULES\.filter\(\(m\) => moduleActif\(m\.id\)\)/);
});
