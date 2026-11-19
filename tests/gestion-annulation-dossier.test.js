// tests/gestion-annulation-dossier.test.js : annuler le dernier service actif d'un dossier propose d'annuler aussi le dossier (19.11.2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { dossierSansServiceActif } from "../src/gestion/js/dossier-gestes-calc.mjs";

const dossier = { id: "d1", annule: false };

test("dernier service annulé : le dossier est proposé à l'annulation (cas Secret, ATV seul service)", () => {
  const reservations = [{ id: "r1", dossier_id: "d1", statut: "annule", libelle: "P2: ATV 1 hour (forest & viewpoint), driver" }, { id: "x", dossier_id: "autre", statut: "confirme" }];
  assert.equal(dossierSansServiceActif(reservations, dossier), true);
});

test("il reste un service actif : aucune question", () => {
  const reservations = [{ id: "r1", dossier_id: "d1", statut: "annule" }, { id: "r2", dossier_id: "d1", statut: "confirme" }];
  assert.equal(dossierSansServiceActif(reservations, dossier), false);
  // Un service à confirmer ou en attente compte aussi comme actif.
  assert.equal(dossierSansServiceActif([{ id: "r1", dossier_id: "d1", statut: "annule" }, { id: "r2", dossier_id: "d1", statut: "a_confirmer" }], dossier), false);
});

test("dossier déjà annulé, sans réservation ou introuvable : aucune question", () => {
  const annulees = [{ id: "r1", dossier_id: "d1", statut: "annule" }];
  assert.equal(dossierSansServiceActif(annulees, { ...dossier, annule: true }), false);
  assert.equal(dossierSansServiceActif([], dossier), false);
  assert.equal(dossierSansServiceActif(annulees, null), false);
});

// Le formulaire complet appelait lieeFacture(r) alors qu'une constante locale du même nom (un booléen) masquait la fonction importée :
// annuler une réservation par « Modifier » échouait avec « lieeFacture is not a function » (trouvé en démo le 19.11.2026).
test("formulaire de réservation : aucune variable locale ne masque la fonction lieeFacture", () => {
  const source = fs.readFileSync(new URL("../src/gestion/js/views/reservations.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:const|let|var)\s+lieeFacture\b/);
});
