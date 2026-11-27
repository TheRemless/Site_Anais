// tests/gestion-fenetres-historique.test.js : fenêtres (feuilles, menus, confirmations) et retour arrière du navigateur.
// Défaut relevé sur la preview groupée (PR 365) et en production : une feuille restait affichée par-dessus l'écran suivant
// après un retour arrière ou un lien.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const load = () => import("../src/gestion/js/fenetres-historique-calc.mjs");

test("retour arrière : la fenêtre du dessus se ferme, l'écran reste", async () => {
  const { fermeturesAuRetour } = await load();
  // Une feuille ouverte (entrée 1), le retour arrive sur l'entrée de l'écran (sans feuille).
  assert.deepEqual(fermeturesAuRetour([{ n: 1, modifie: false }], { gestionEntree: 4 }), { fermer: [1], demander: null });
  assert.deepEqual(fermeturesAuRetour([{ n: 1, modifie: false }], null), { fermer: [1], demander: null });
  // Rien d'ouvert : rien à fermer, le retour quitte l'écran comme avant.
  assert.deepEqual(fermeturesAuRetour([], { gestionEntree: 4 }), { fermer: [], demander: null });
});

test("retour arrière : des fenêtres empilées se ferment dans l'ordre, une à la fois", async () => {
  const { fermeturesAuRetour } = await load();
  // « Réservation et voucher » (2) puis « Confirmation » (3) : le retour revient sur l'entrée 2, seule la confirmation se ferme.
  const pile = [{ n: 2, modifie: false }, { n: 3, modifie: false }];
  assert.deepEqual(fermeturesAuRetour(pile, { feuille: 2 }), { fermer: [3], demander: null });
  // Le retour suivant revient sous l'entrée 2 : la feuille se ferme à son tour.
  assert.deepEqual(fermeturesAuRetour([{ n: 2, modifie: false }], {}), { fermer: [2], demander: null });
  // Un saut de deux entrées (history.go(-2)) ferme les deux, celle du dessus d'abord.
  assert.deepEqual(fermeturesAuRetour(pile, {}), { fermer: [3, 2], demander: null });
});

test("retour arrière : une saisie non enregistrée demande confirmation, les fenêtres du dessous restent", async () => {
  const { fermeturesAuRetour } = await load();
  assert.deepEqual(fermeturesAuRetour([{ n: 5, modifie: true }], {}), { fermer: [], demander: 5 });
  // Un menu sans saisie (dessus) se ferme, la feuille remplie du dessous demande avant de se fermer.
  assert.deepEqual(fermeturesAuRetour([{ n: 5, modifie: true }, { n: 6, modifie: false }], {}), { fermer: [6], demander: 5 });
});

test("entrée orpheline : celle d'une fenêtre fermée autrement est retirée, jamais celle d'une fenêtre ouverte ni de la visionneuse", async () => {
  const { entreeOrpheline } = await load();
  assert.equal(entreeOrpheline({ feuille: 3 }, [3]), false);
  assert.equal(entreeOrpheline({ feuille: 3 }, []), true);
  assert.equal(entreeOrpheline({ feuille: 3, feuilleLibre: true }, [3]), true);
  assert.equal(entreeOrpheline({ gestionEntree: 2 }, []), false);
  assert.equal(entreeOrpheline(null, []), false);
  assert.equal(entreeOrpheline({ feuille: 3, visionneuse: true }, []), false);
});

test("ouverture : une fenêtre enchaînée reprend l'entrée libérée, sinon elle en ajoute une", async () => {
  const { entreePourOuverture } = await load();
  // Commission suivante ouverte juste après l'enregistrement de la précédente : pas d'entrée en trop.
  assert.deepEqual(entreePourOuverture({ gestionEntree: 2, feuille: 7, feuilleLibre: true }, 8, []), { remplacer: true, etat: { gestionEntree: 2, feuille: 8 } });
  // Confirmation par-dessus une feuille ouverte : nouvelle entrée, l'entrée de la feuille reste.
  assert.deepEqual(entreePourOuverture({ gestionEntree: 2, feuille: 7 }, 8, [7]), { remplacer: false, etat: { gestionEntree: 2, feuille: 8 } });
  assert.deepEqual(entreePourOuverture(null, 1, []), { remplacer: false, etat: { feuille: 1 } });
});

test("changement d'écran : les fenêtres de l'écran quitté se ferment, pas celle ouverte sur le nouvel écran", async () => {
  const { fermeturesAuChangementDEcran } = await load();
  const pile = [{ n: 1, hash: "#/whatsapp?c=1" }, { n: 2, hash: "#/whatsapp?c=1" }, { n: 3, hash: "#/dossier/9" }];
  assert.deepEqual(fermeturesAuChangementDEcran(pile, "#/dossier/9"), [2, 1]);
  assert.deepEqual(fermeturesAuChangementDEcran([], "#/"), []);
});

test("modal() suit l'historique : une entrée par fenêtre, retour et changement d'écran branchés", () => {
  const ui = fs.readFileSync(path.join(__dirname, "..", "src", "gestion", "js", "ui.mjs"), "utf8");
  assert.match(ui, /window\.addEventListener\("popstate"/);
  assert.match(ui, /window\.addEventListener\("hashchange"/);
  assert.match(ui, /entrerHistorique\(n\);\s*placeDansPile = \{/);
  // Changement d'écran : la saisie est gardée en brouillon avant la fermeture.
  assert.match(ui, /quitterEcran: \(\) => \(modifie\(\) \? \(garderBrouillon\(\), fermer\(true\)\) : fermer\(\)\)/);
  // Une fenêtre cachée (travail sans affichage) n'ajoute pas d'entrée.
  assert.ok(ui.indexOf("if (cache) return fermer;") < ui.indexOf("entrerHistorique(n);"));
});
