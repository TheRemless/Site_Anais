import test from "node:test";
import assert from "node:assert/strict";
import { etatRappels } from "../src/gestion/js/rappels-etat.mjs";

const ligne = (cree_le, extra = {}) => ({ cree_le, type: "veille", abonnements: 2, envoyes: 2, echecs: 0, erreur: "", ...extra });
const MAINTENANT = "2026-11-12T03:00:00Z";

test("rappels : aucune exécution notée, un rappel récent réussi, une alerte sinon", () => {
  assert.equal(etatRappels([], MAINTENANT).statut, "aucune");
  assert.equal(etatRappels(null, MAINTENANT).statut, "aucune");
  assert.equal(etatRappels([ligne("2026-11-12T02:00:05Z")], MAINTENANT).statut, "ok");
  // Un rappel sans rien à envoyer (rien demain) est un succès : pas d'erreur, pas d'échec.
  assert.equal(etatRappels([ligne("2026-11-12T02:00:05Z", { envoyes: 0, abonnements: 0 })], MAINTENANT).statut, "ok");
});

test("rappels : alerte quand le dernier a échoué ou qu'aucun n'a réussi depuis 24 h", () => {
  const recentEnErreur = etatRappels([ligne("2026-11-12T02:00:05Z", { erreur: "Timeout" }), ligne("2026-11-11T11:00:05Z")], MAINTENANT);
  assert.equal(recentEnErreur.statut, "alerte");
  assert.equal(recentEnErreur.message, "derniere_en_echec");
  assert.equal(etatRappels([ligne("2026-11-12T02:00:05Z", { envoyes: 0, echecs: 1, abonnements: 1 })], MAINTENANT).message, "aucun_reussi_24h", "le seul rappel a échoué partout : aucun n'a réussi");
  // Un appareil en échec permanent (adresse qui répond 400) ne fait pas une alerte tant que les autres reçoivent le rappel.
  assert.equal(etatRappels([ligne("2026-11-12T02:00:05Z", { abonnements: 3, envoyes: 2, echecs: 1 })], MAINTENANT).statut, "ok");
  const vieux = etatRappels([ligne("2026-11-10T11:00:05Z")], MAINTENANT);
  assert.equal(vieux.statut, "alerte");
  assert.equal(vieux.message, "aucun_reussi_24h");
  // Exactement à la limite : 24 h pile reste correct, au-delà non.
  assert.equal(etatRappels([ligne("2026-11-11T03:00:00Z")], MAINTENANT).statut, "ok");
  assert.equal(etatRappels([ligne("2026-11-11T02:59:00Z")], MAINTENANT).statut, "alerte");
});

test("rappels : l'ordre des lignes reçues ne compte pas", () => {
  const a = ligne("2026-11-12T02:00:05Z", { erreur: "x" });
  const b = ligne("2026-11-11T11:00:05Z");
  assert.equal(etatRappels([b, a], MAINTENANT).derniere, a);
  assert.equal(etatRappels([b, a], MAINTENANT).dernierReussi, b);
});
