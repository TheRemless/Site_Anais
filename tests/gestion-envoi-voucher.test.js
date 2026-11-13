import { test } from "node:test";
import assert from "node:assert/strict";
import { envoiANoter, CIBLE_ENVOI } from "../src/gestion/js/envoi-voucher-calc.mjs";
import { detailsAvecEnvoi, etatEnvoisVouchers } from "../src/gestion/js/operations-calc.mjs";

const D = "2026-11-13";

test("envoi noté : partage réussi ou conversation ouverte, pour le client comme pour le prestataire", () => {
  assert.equal(envoiANoter({ pour: "client", issue: "partage", date: D }), "client");
  assert.equal(envoiANoter({ pour: "client", issue: "conversation", date: D }), "client");
  assert.equal(envoiANoter({ pour: "partenaire", issue: "partage", date: D }), "prestataire");
  assert.equal(envoiANoter({ pour: "partenaire", issue: "conversation", date: D }), "prestataire");
});

test("envoi non noté : partage annulé, en échec, copie refusée ou onglet bloqué", () => {
  for (const issue of ["annule", "echec", "copie_refusee", "onglet_bloque", undefined, null, { erreur: new Error("x") }]) {
    assert.equal(envoiANoter({ pour: "client", issue, date: D }), null, String(issue));
    assert.equal(envoiANoter({ pour: "partenaire", issue, date: D }), null, String(issue));
  }
});

test("envoi non noté : destinataire inconnu (partage du système sans destinataire choisi)", () => {
  assert.equal(envoiANoter({ pour: undefined, issue: "partage", date: D }), null);
  assert.equal(envoiANoter({ pour: "prestataire", issue: "partage", date: D }), null);
});

test("envoi déjà noté le même jour : rien à réécrire ; noté un autre jour : la date se met à jour", () => {
  assert.equal(envoiANoter({ pour: "client", issue: "conversation", envois: { client: D }, date: D }), null);
  assert.equal(envoiANoter({ pour: "client", issue: "conversation", envois: { client: "2026-11-10" }, date: D }), "client");
  assert.equal(envoiANoter({ pour: "partenaire", issue: "partage", envois: { client: D }, date: D }), "prestataire");
  assert.equal(envoiANoter({ pour: "client", issue: "partage", envois: null, date: D }), "client");
});

test("les clés notées sont celles que lit l'avancement du dossier (« Client : 1 sur 2 »)", () => {
  const r1 = { id: 1, partenaire_id: 7, details: detailsAvecEnvoi({ pickup: "Hôtel" }, envoiANoter({ pour: "client", issue: "conversation", date: D }), D) };
  const r2 = { id: 2, partenaire_id: 8, details: {} };
  assert.equal(r1.details.pickup, "Hôtel");
  assert.deepEqual(etatEnvoisVouchers([r1, r2]), { total: 2, client: 1, prestataires: 0, totalPrestataires: 2, complet: false });
  r1.details = detailsAvecEnvoi(r1.details, envoiANoter({ pour: "partenaire", issue: "partage", date: D }), D);
  assert.deepEqual(etatEnvoisVouchers([r1, r2]), { total: 2, client: 1, prestataires: 1, totalPrestataires: 2, complet: false });
  assert.deepEqual(Object.values(CIBLE_ENVOI).sort(), ["client", "prestataire"]);
});
