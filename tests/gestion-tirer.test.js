// tests/gestion-tirer.test.js : logique du geste « tirer pour actualiser » (seuil, résistance, bords, refus, bilan).
const test = require("node:test");
const assert = require("node:assert/strict");
const load = () => import("../src/gestion/js/tirer-calc.mjs");

test("la course de l'indicateur augmente avec la résistance et ne dépasse jamais le maximum", async () => {
  const { decalage, MAX } = await load();
  assert.equal(decalage(0), 0);
  assert.equal(decalage(-30), 0);
  let avant = 0;
  for (const dy of [10, 30, 70, 140, 300, 2000]) {
    const d = decalage(dy);
    assert.ok(d > avant, `dy ${dy}`);
    assert.ok(d <= MAX);
    avant = d;
  }
  // la résistance : le doigt fait plus de chemin que l'indicateur
  assert.ok(decalage(70) < 70);
});

test("la progression va de 0 à 1 au seuil", async () => {
  const { progression, SEUIL } = await load();
  assert.equal(progression(0), 0);
  assert.equal(progression(SEUIL / 2), 0.5);
  assert.equal(progression(SEUIL), 1);
  assert.equal(progression(SEUIL * 3), 1);
});

test("un tirage vers le bas au-delà du seuil se déclenche au relâchement, pas en dessous", async () => {
  const { DEPART, suivre, declenche, SEUIL, etape } = await load();
  let e = suivre(DEPART, 2, 20, 0);
  assert.equal(e.phase, "tire");
  assert.equal(e.arme, false);
  assert.equal(etape(e), "tirer");
  assert.equal(declenche(e), false);
  e = suivre(e, 3, SEUIL, 0);
  assert.equal(e.arme, true);
  assert.equal(etape(e), "relacher");
  assert.equal(declenche(e), true);
  // revenir en arrière désarme
  e = suivre(e, 3, SEUIL - 20, 0);
  assert.equal(declenche(e), false);
});

test("tant que le doigt a peu bougé, rien n'est décidé", async () => {
  const { DEPART, suivre, direction } = await load();
  assert.equal(direction(3, 4), "attente");
  assert.equal(suivre(DEPART, 3, 4, 0), DEPART);
});

test("un défilement vers le haut, un glissement de côté ou un tirage en biais refuse le geste jusqu'à la fin du toucher", async () => {
  const { DEPART, suivre, declenche, SEUIL } = await load();
  for (const [dx, dy] of [[0, -20], [40, 15], [60, 70]]) {
    let e = suivre(DEPART, dx, dy, 0);
    assert.equal(e.phase, "refuse", `${dx},${dy}`);
    // le doigt revient ensuite vers le bas : toujours refusé
    e = suivre(e, 0, SEUIL * 2, 0);
    assert.equal(e.phase, "refuse");
    assert.equal(declenche(e), false);
  }
});

test("si la page n'est plus tout en haut, le geste est refusé", async () => {
  const { DEPART, suivre, declenche, SEUIL } = await load();
  let e = suivre(DEPART, 0, 30, 0);
  e = suivre(e, 0, SEUIL + 10, 12);
  assert.equal(e.phase, "refuse");
  assert.equal(declenche(e), false);
});

test("une fois le tirage commencé, une légère dérive de côté ne l'annule pas", async () => {
  const { DEPART, suivre, SEUIL } = await load();
  let e = suivre(DEPART, 0, 30, 0);
  e = suivre(e, 40, SEUIL + 5, 0);
  assert.equal(e.phase, "tire");
  assert.equal(e.arme, true);
});

test("le geste ne démarre pas près des bords, hors du haut de la page, à plusieurs doigts ou quand l'écran est occupé", async () => {
  const { peutDemarrer } = await load();
  const base = { scrollY: 0, x: 180, y: 300, largeur: 375, touches: 1 };
  assert.equal(peutDemarrer(base), true);
  assert.equal(peutDemarrer({ ...base, x: 10 }), false, "bord gauche : retour iOS");
  assert.equal(peutDemarrer({ ...base, x: 370 }), false, "bord droit");
  assert.equal(peutDemarrer({ ...base, y: 3 }), false, "haut de l'écran : notifications");
  assert.equal(peutDemarrer({ ...base, scrollY: 1 }), false, "page défilée");
  assert.equal(peutDemarrer({ ...base, defilee: true }), false, "conteneur défilé sous le doigt");
  assert.equal(peutDemarrer({ ...base, touches: 2 }), false, "pincement");
  assert.equal(peutDemarrer({ ...base, bloque: true }), false, "fenêtre, champ en saisie, actualisation en cours");
});

test("le bilan dit la vérité : hors connexion, erreur réelle, ou à jour", async () => {
  const { bilan } = await load();
  assert.deepEqual(bilan({ resultat: "inchange" }), { type: "ok", cle: "a_jour" });
  assert.deepEqual(bilan({ resultat: "modifie" }), { type: "ok", cle: "a_jour" });
  assert.deepEqual(bilan({ resultat: "ignore", demo: true }), { type: "ok", cle: "a_jour" });
  assert.deepEqual(bilan({ resultat: "ignore" }), { type: "info", cle: "deja_en_cours" });
  assert.deepEqual(bilan({ erreur: new Error("JWT expired") }), { type: "erreur", cle: "erreur", message: "JWT expired" });
  // hors connexion : on ne montre pas le message technique du navigateur
  assert.deepEqual(bilan({ erreur: new TypeError("Load failed"), horsLigne: true }), { type: "erreur", cle: "hors_ligne" });
});
