// Relecture de la PR #357 : la tuile restée seule sur sa ligne (téléphone, deux colonnes) et les étiquettes du graphique en vue « Jour ».
import { test } from "node:test";
import assert from "node:assert/strict";
import { indexTuileSeule, sautEtiquettes } from "../src/gestion/js/mobile-calc.mjs";

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
