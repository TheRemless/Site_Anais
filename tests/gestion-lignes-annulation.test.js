// tests/gestion-lignes-annulation.test.js : supprimer une ligne de devis (avec ses options) puis l'annuler depuis le toast (relecture de la PR #360).
const test = require("node:test");
const assert = require("node:assert/strict");
const load = () => import("../src/gestion/js/lignes-annulation-calc.mjs");

const L = (id, o = {}) => ({ id, kind: "ligne", libelle: id, ...o });
const ids = (lignes) => lignes.map((l) => l.id);

test("retirerLigne : une ligne simple, puis Annuler la remet à sa place", async () => {
  const { retirerLigne, remettreLignes } = await load();
  const lignes = [L("a"), L("b"), L("c")];
  const r = retirerLigne(lignes, 1);
  assert.deepEqual(ids(r.lignes), ["a", "c"]);
  assert.equal(r.options, 0);
  assert.deepEqual(ids(remettreLignes(r.lignes, r)), ["a", "b", "c"]);
  assert.deepEqual(ids(lignes), ["a", "b", "c"], "la liste d'origine n'est pas modifiée");
});

test("retirerLigne : un service emporte ses options, Annuler les remet toutes à leur place", async () => {
  const { retirerLigne, remettreLignes } = await load();
  const lignes = [L("a"), L("s"), L("o1", { option_de: "s" }), L("o2", { option_de: "s" }), L("b")];
  const r = retirerLigne(lignes, 1);
  assert.deepEqual(ids(r.lignes), ["a", "b"]);
  assert.equal(r.options, 2);
  assert.deepEqual(ids(remettreLignes(r.lignes, r)), ["a", "s", "o1", "o2", "b"]);
});

test("remettreLignes : une ligne ajoutée pendant le délai reste, les lignes retirées reviennent à leur place", async () => {
  const { retirerLigne, remettreLignes } = await load();
  const lignes = [L("a"), L("s"), L("o1", { option_de: "s" }), L("b")];
  const r = retirerLigne(lignes, 1);
  const pendant = [...r.lignes, L("nouvelle")];
  assert.deepEqual(ids(remettreLignes(pendant, r)), ["a", "s", "o1", "b", "nouvelle"]);
  // Ajout en tête et service supprimé en tête.
  const r0 = retirerLigne([L("x"), L("y")], 0);
  assert.deepEqual(ids(remettreLignes([L("n"), ...r0.lignes], r0)), ["x", "n", "y"]);
});

test("remettreLignes : place incertaine ou déjà remise, rien n'est deviné (null)", async () => {
  const { retirerLigne, remettreLignes } = await load();
  const lignes = [L("a"), L("s"), L("b")];
  const r = retirerLigne(lignes, 1);
  assert.equal(remettreLignes(r.lignes.filter((l) => l.id !== "a"), r), null, "la ligne qui précédait a disparu");
  assert.equal(remettreLignes(lignes, r), null, "déjà remise");
  assert.equal(remettreLignes([], { retirees: [] }), null);
});
