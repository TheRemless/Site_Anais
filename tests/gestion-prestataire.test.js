import { test } from "node:test";
import assert from "node:assert/strict";
import { joursDepuisDemande, attente, detailsDemande, detailsRelance, detailsRefus, refusee } from "../src/gestion/js/prestataire-calc.mjs";

const AJD = "2026-11-11";

test("jours depuis la demande : le jour même, deux jours, repli sur la dernière modification", () => {
  assert.equal(joursDepuisDemande({ statut: "demande", details: { demande_le: "2026-11-11" } }, AJD), 0);
  assert.equal(joursDepuisDemande({ statut: "demande", details: { demande_le: "2026-11-09" } }, AJD), 2);
  assert.equal(joursDepuisDemande({ statut: "demande", details: {}, updated_at: "2026-11-08T03:00:00Z" }, AJD), 3);
  assert.equal(joursDepuisDemande({ statut: "a_demander", details: {} }, AJD), null);
});

test("attente : seulement une réservation demandée, relance proposée au bout de deux jours", () => {
  assert.equal(attente({ statut: "confirme", details: {} }, AJD), null);
  assert.deepEqual(attente({ statut: "demande", details: { demande_le: "2026-11-11" } }, AJD), { jours: 0, relancer: false, relances: 0 });
  assert.equal(attente({ statut: "demande", details: { demande_le: "2026-11-09" } }, AJD).relancer, true);
  // Une relance de la veille repousse la suivante.
  assert.equal(attente({ statut: "demande", details: { demande_le: "2026-11-05", relance_le: "2026-11-10", relances: 1 } }, AJD).relancer, false);
  assert.deepEqual(attente({ statut: "demande", details: {} }, AJD), { jours: null, relancer: false });
});

test("détails : demande, relance et refus gardent les autres champs du voucher", () => {
  const r = { details: { chambre: "12", relances: 1 } };
  assert.deepEqual(detailsDemande(r, AJD), { chambre: "12", demande_le: AJD, relance_le: null, relances: 0, refus_le: null });
  assert.equal(detailsRelance({ details: { relances: 1 } }, AJD).relances, 2);
  assert.equal(detailsRefus(r, AJD).refus_le, AJD);
  assert.equal(detailsRefus(r, AJD).chambre, "12");
});

test("refusée : redevient à demander mais garde la trace", () => {
  assert.equal(refusee({ statut: "a_demander", details: { refus_le: AJD } }), true);
  assert.equal(refusee({ statut: "a_demander", details: {} }), false);
  assert.equal(refusee({ statut: "demande", details: { refus_le: AJD } }), false);
});
