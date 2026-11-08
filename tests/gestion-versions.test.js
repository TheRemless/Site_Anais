import { test } from "node:test";
import assert from "node:assert/strict";
import { comparerDocuments } from "../src/gestion/js/versions-calc.mjs";

const ligne = (id, p = {}) => ({ id, kind: "ligne", libelle: id, intro: "", puces: [], unite: 100, qte: 1, montant: null, pct: null, ...p });
const doc = (lignes, extra = {}, date = "2026-11-01") => ({ date_emission: date, contenu: { bandeau: "", colonnes: "total", variante: "", langue: "", devise: "CHF", lignes, ...extra } });

test("deux documents identiques : rien à signaler", () => {
  const r = comparerDocuments(doc([ligne("a")]), doc([ligne("a")]));
  assert.equal(r.identique, true);
  assert.deepEqual(r.changements, []);
});

test("quantité et prix modifiés : le total et la ligne donnent les deux valeurs", () => {
  const r = comparerDocuments(doc([ligne("a", { qte: 2, unite: 100 })]), doc([ligne("a", { qte: 3, unite: 120 })]));
  const total = r.changements.find((c) => c.type === "total");
  assert.deepEqual([total.version, total.actuel], [200, 360]);
  const l = r.changements.find((c) => c.type === "ligne_modifiee");
  assert.equal(l.intitule, "a");
  assert.deepEqual(l.champs.map((c) => [c.cle, c.version, c.actuel]), [["unite", 100, 120], ["qte", 2, 3]]);
});

test("ligne ajoutée depuis : restaurer la retire ; ligne supprimée depuis : restaurer la retrouve", () => {
  const version = doc([ligne("a"), ligne("b", { libelle: "Kayak" })]);
  const actuel = doc([ligne("a"), ligne("c", { libelle: "Plongée" })]);
  const r = comparerDocuments(version, actuel);
  assert.deepEqual(r.changements.filter((c) => c.type === "ligne_retrouvee").map((c) => c.intitule), ["Kayak"]);
  assert.deepEqual(r.changements.filter((c) => c.type === "ligne_retiree").map((c) => c.intitule), ["Plongée"]);
});

test("date d'émission, devise et titre : annoncés ; null, vide et espaces sont la même chose", () => {
  const r = comparerDocuments(doc([ligne("a")], { devise: "EUR", bandeau: "VOYAGE" }, "2026-10-01"), doc([ligne("a")], { devise: "CHF", bandeau: "  " }));
  assert.deepEqual(r.changements.filter((c) => c.type === "champ").map((c) => c.cle), ["bandeau", "devise"]);
  assert.equal(r.changements.find((c) => c.type === "date_emission").version, "2026-10-01");
  const meme = comparerDocuments(doc([ligne("a", { intro: null, puces: ["", "  "], date_service: "" })]), doc([ligne("a", { intro: "", puces: [], date_service: null })]));
  assert.equal(meme.identique, true);
});

test("puces et texte d'une ligne : comparés ; le net n'est jamais comparé", () => {
  const r = comparerDocuments(doc([ligne("a", { puces: ["x", "y"], net: 10 })]), doc([ligne("a", { puces: ["x"], net: 99 })]));
  const l = r.changements.find((c) => c.type === "ligne_modifiee");
  assert.deepEqual(l.champs.map((c) => c.cle), ["puces"]);
});

test("devise : un document sans devise fixée prend celle de l'entreprise, chaque montant garde sa devise", () => {
  const r = comparerDocuments(doc([ligne("a", { qte: 2 })], { devise: "EUR" }), doc([ligne("a")], { devise: "" }), { defaut: "CHF" });
  const champ = r.changements.find((c) => c.type === "champ" && c.cle === "devise");
  assert.deepEqual([champ.version, champ.actuel], ["EUR", "CHF"]);
  const total = r.changements.find((c) => c.type === "total");
  assert.deepEqual([total.deviseVersion, total.deviseActuel], ["EUR", "CHF"]);
  assert.equal(comparerDocuments(doc([ligne("a")], { devise: "CHF" }), doc([ligne("a")], { devise: "" }), { defaut: "CHF" }).identique, true);
});
