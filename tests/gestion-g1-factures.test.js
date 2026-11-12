import { test } from "node:test";
import assert from "node:assert/strict";
import { aMarquerEnvoye } from "../src/gestion/js/calc.mjs";

test("envoi d'un document : devis et factures proposent la date d'envoi, un document déjà envoyé non", () => {
  assert.equal(aMarquerEnvoye({ type: "devis", envoye_le: null }), true);
  assert.equal(aMarquerEnvoye({ type: "facture", envoye_le: null }), true, "une facture qui part n'était jamais marquée envoyée");
  assert.equal(aMarquerEnvoye({ type: "facture_locale", envoye_le: null }), true);
  assert.equal(aMarquerEnvoye({ type: "facture", envoye_le: "2026-11-08" }), false);
  assert.equal(aMarquerEnvoye({ type: "autre", envoye_le: null }), false);
  assert.equal(aMarquerEnvoye(null), false);
});

import { acceptationAuPaiement, payeSansFacture } from "../src/gestion/js/calc.mjs";
test("un premier paiement vaut acceptation : le dossier ne reste plus « devis en attente » une fois soldé", () => {
  assert.equal(acceptationAuPaiement({ accepte_le: null, annule: false }, "2026-11-09", false), "2026-11-09");
  assert.equal(acceptationAuPaiement({ accepte_le: "2026-11-01", annule: false }, "2026-11-09", false), null, "déjà accepté : la date d'acceptation ne bouge pas");
  assert.equal(acceptationAuPaiement({ accepte_le: null, annule: false }, "2026-11-09", true), null, "un remboursement n'accepte rien");
  assert.equal(acceptationAuPaiement({ accepte_le: null, annule: true }, "2026-11-09", false), null, "un dossier annulé reste annulé");
  assert.equal(acceptationAuPaiement({ accepte_le: null, annule: false }, "", false), null, "sans date de paiement, rien à poser");
});

test("payé sans facture : de l'argent reçu et aucune facture sur le dossier", () => {
  const facture = { type: "facture" };
  assert.equal(payeSansFacture({ recu: 1000, documents: [{ type: "devis" }], annule: false }), true);
  assert.equal(payeSansFacture({ recu: 1000, documents: [{ type: "devis" }, facture], annule: false }), false);
  assert.equal(payeSansFacture({ recu: 0, documents: [{ type: "devis" }], annule: false }), false);
  assert.equal(payeSansFacture({ recu: 1000, documents: [], annule: true }), false, "un dossier annulé a sa propre alerte");
  assert.equal(payeSansFacture({ recu: 1000, documents: [{ type: "facture_locale" }], annule: false }), false);
});

import { recalculerCommissions, lieuParDefaut } from "../src/gestion/js/operations-calc.mjs";
test("commission reçue qui s'écarte de la règle : signalée, jamais modifiée (cas Rattana INV-2026-001 et 004)", () => {
  const regleDe = () => ({ type: "vente_moins_net" });
  const r = { id: "r1", dossier_id: "d1", partenaire_id: "rattana", paye_sur_place: true, statut: "confirme", montant_vente: 4000, personnes: { adultes: 2, enfants: 0 } };
  const nets = { r1: { net_prevu: 2800, commission_prevue: 1600, commission_recue: 1600, commission_recue_le: "2026-11-11" } };
  const t = recalculerCommissions([r], { regleDe, netDe: (x) => nets[x.id] });
  assert.equal(t.changements.length, 0, "la commission reçue n'est jamais recalculée");
  assert.deepEqual(t.ecartsRecus.map((e) => ({ id: e.reservation.id, prevue: e.prevue, attendue: e.attendue, recue: e.recue })), [{ id: "r1", prevue: 1600, attendue: 1200, recue: 1600 }]);
  // Une commission reçue conforme à la règle ne se signale pas.
  const juste = { r1: { ...nets.r1, commission_prevue: 1200, commission_recue: 1200 } };
  assert.equal(recalculerCommissions([r], { regleDe, netDe: (x) => juste[x.id] }).ecartsRecus.length, 0);
  // Sans règle ou sans net : rien à comparer, rien d'inventé.
  assert.equal(recalculerCommissions([r], { regleDe: () => null, netDe: (x) => nets[x.id] }).ecartsRecus.length, 0);
});

test("service ajouté à un dossier : le lieu de pickup du dossier est repris, sinon l'adresse du client", () => {
  const rs = [{ lieu_pickup: "", created_at: "2026-11-01" }, { lieu_pickup: "Hotel Sunset, Room 12", created_at: "2026-11-02" }, { lieu_pickup: "Autre", created_at: "2026-11-01" }];
  assert.equal(lieuParDefaut(rs, { adresse: "Beach Resort\nKoh Lanta" }), "Hotel Sunset, Room 12", "le dernier lieu saisi sur le dossier");
  assert.equal(lieuParDefaut([{ lieu_pickup: "" }], { adresse: "Hotel Sunset, Room 12\nKoh Lanta" }), "Hotel Sunset, Room 12", "sinon la première ligne de l'adresse du client");
  assert.equal(lieuParDefaut([], {}), "");
});
