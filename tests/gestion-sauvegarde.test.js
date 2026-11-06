// tests/gestion-sauvegarde.test.js : ce qui part dans une sauvegarde doit pouvoir être restauré.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pourSauvegarde, VERSION_SAUVEGARDE } from "../src/gestion/js/sauvegarde.mjs";

test("sauvegarde : le résumé d'un dossier, ajouté par l'outil, n'est pas exporté (la base refuserait l'import)", () => {
  const dossier = { id: "d1", ref: "ST-2026-0001", client_id: "c1", created_at: "x", devis_envoye_le: null, a_facture: true, total: 1200, devise: "THB", recu: 300 };
  const [sortie] = pourSauvegarde("dossiers", [dossier]);
  assert.deepEqual(Object.keys(sortie).sort(), ["a_facture", "client_id", "created_at", "devis_envoye_le", "id", "ref"], "les colonnes de la table restent, le résumé part");
  assert.equal(dossier.total, 1200, "la ligne d'origine n'est pas modifiée");
});

test("sauvegarde : les autres tables sont exportées telles quelles", () => {
  const client = { id: "c1", nom: "Anna", total: 5 };
  assert.deepEqual(pourSauvegarde("clients", [client]), [client]);
  assert.deepEqual(pourSauvegarde("clients", undefined), []);
  assert.ok(VERSION_SAUVEGARDE >= 3, "la version 3 porte les réglages");
});
