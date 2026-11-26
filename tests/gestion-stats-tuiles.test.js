// Relecture de la PR #357 : la tuile restée seule sur sa ligne (téléphone, deux colonnes) et les étiquettes du graphique en vue « Jour ».
import { test } from "node:test";
import assert from "node:assert/strict";
import { indexTuileSeule, sautEtiquettes, largeurGraphique, colonnePlusProche } from "../src/gestion/js/mobile-calc.mjs";

// Contre-relecture de la PR #357 : seule la vue Jour tient dans la largeur, et le toucher choisit la colonne la plus proche.
test("graphique : la vue Jour de 31 jours ou moins tient dans la largeur", () => {
  assert.equal(largeurGraphique({ n: 31, disponible: 312, pas: 56, marges: 14, ajuster: true }), 312);
  assert.equal(largeurGraphique({ n: 26, disponible: 312, pas: 44, marges: 14, ajuster: true }), 312);
});

test("graphique : au-delà de 31 jours, ou en Semaine et Mois, les colonnes gardent leur pas et le graphique défile", () => {
  assert.equal(largeurGraphique({ n: 330, disponible: 312, pas: 56, marges: 14, ajuster: true }), 14 + 330 * 56);
  // Semaine sur un mois : cinq colonnes de 44 px tiennent déjà, la largeur disponible reste.
  assert.equal(largeurGraphique({ n: 5, disponible: 312, pas: 44, marges: 14 }), 312);
  // Mois sur une année, deux séries : 12 colonnes de 56 px, plus large que l'écran.
  assert.equal(largeurGraphique({ n: 12, disponible: 312, pas: 56, marges: 14 }), 14 + 12 * 56);
  assert.ok((largeurGraphique({ n: 12, disponible: 312, pas: 56, marges: 14 }) - 14) / 12 >= 44);
});

test("graphique : le toucher choisit la colonne la plus proche de x", () => {
  const g = { gauche: 6, largeurCase: 10, n: 31 };
  assert.equal(colonnePlusProche(6, g), 0);
  assert.equal(colonnePlusProche(15.9, g), 0);
  assert.equal(colonnePlusProche(16, g), 1);
  assert.equal(colonnePlusProche(200, g), 19);
  // Dans la marge de gauche ou au-delà de la dernière : la colonne du bord.
  assert.equal(colonnePlusProche(0, g), 0);
  assert.equal(colonnePlusProche(9999, g), 30);
  assert.equal(colonnePlusProche(50, { gauche: 0, largeurCase: 0, n: 3 }), -1);
  assert.equal(colonnePlusProche(50, { gauche: 0, largeurCase: 10, n: 0 }), -1);
});

test("tuiles : sans grande tuile, la dernière d'un nombre impair reste seule", () => {
  assert.equal(indexTuileSeule([false, false, false]), 2);
  assert.equal(indexTuileSeule([false, false, false, false]), -1);
});

test("tuiles : la grande du début ne compte pas", () => {
  assert.equal(indexTuileSeule([true, false, false, false]), 3);
  assert.equal(indexTuileSeule([true, false, false]), -1);
});

test("tuiles : Aperçu de Secret avec nets, deux grandes et six petites, aucune seule", () => {
  // vendu (grande), revenu (grande), puis six petites : « Dossiers vendus » ne doit plus passer en pleine largeur.
  assert.equal(indexTuileSeule([true, false, false, true, false, false, false, false]), -1);
});

test("tuiles : deux grandes et cinq petites, la dernière petite reste seule, même placée avant une grande", () => {
  assert.equal(indexTuileSeule([true, false, true, false, false, false, false]), 6);
  assert.equal(indexTuileSeule([false, false, false, true]), 2);
});

test("graphique : une étiquette par colonne quand il y a la place, puis une sur deux, puis une sur sept", () => {
  assert.equal(sautEtiquettes(44), 1);
  assert.equal(sautEtiquettes(25), 2);
  assert.equal(sautEtiquettes(9.6), 7);
  assert.equal(sautEtiquettes(4), 10);
  assert.equal(sautEtiquettes(0), 1);
});
