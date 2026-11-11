import test from "node:test";
import assert from "node:assert/strict";
import { contenuAvecReservation, ecartReservation, reservationsDepuisDocument } from "../src/gestion/js/operations-calc.mjs";
import { totaux } from "../src/gestion/js/calc.mjs";

const adulte = { id: "a", kind: "ligne", libelle: "Bateau Koh Lanta → Koh Mook, départ 09:00", intro: "(par adulte)", unite: 800, qte: 2, trajet_id: "t", partenaire_id: "p", date_service: "2026-12-10" };
const enfant = { id: "e", kind: "ligne", libelle: "Bateau Koh Lanta → Koh Mook, départ 09:00, enfant", intro: "(par enfant)", unite: 500, qte: 1, trajet_id: "t", partenaire_id: "p", date_service: "2026-12-10" };
const note = { id: "n", kind: "texte", libelle: "À régler sur place", sur_place: true, prestation_id: null, trajet_id: "t", date_service: "2026-12-10" };
const contenu = { lignes: [adulte, enfant, note, { id: "x", kind: "ligne", libelle: "Autre", unite: 100, qte: 1, trajet_id: "t2", date_service: "2026-12-10" }] };
const r = { ligne_id: "a", details: { lignes_ids: ["a", "e"] }, date_service: "2026-12-10", personnes: { adultes: 2, enfants: 1 } };
const avant = { date_service: "2026-12-10", personnes: { adultes: 2, enfants: 1 } };

test("réservation vers facture : une nouvelle date passe sur les lignes du service et sur sa note, pas sur les autres", () => {
  const { contenu: suite, reste } = contenuAvecReservation(contenu, r, avant, { ...avant, date_service: "2026-12-12" });
  assert.deepEqual(reste, []);
  assert.deepEqual(suite.lignes.map((l) => l.date_service), ["2026-12-12", "2026-12-12", "2026-12-12", "2026-12-10"]);
  assert.equal(totaux(suite).net, totaux(contenu).net, "le total ne bouge pas avec la date");
});

test("réservation vers facture : adultes et enfants changent la quantité des lignes à prix par personne et le total suit", () => {
  const { contenu: suite, reste } = contenuAvecReservation(contenu, r, avant, { ...avant, personnes: { adultes: 4, enfants: 2 } });
  assert.deepEqual(reste, []);
  assert.deepEqual(suite.lignes.slice(0, 2).map((l) => l.qte), [4, 2]);
  assert.equal(totaux(suite).net, 4 * 800 + 2 * 500 + 100);
  // Une fois la facture à jour, plus aucun écart entre la réservation et elle.
  assert.equal(ecartReservation({ ...r, personnes: { adultes: 4, enfants: 2 }, montant_vente: 4200 }, { contenu: suite }), null);
});

test("réservation vers facture : ce qui ne peut pas suivre est signalé, jamais deviné", () => {
  // Un prix de groupe (quantité 1 pour 2 adultes), un montant fixe, des enfants sans ligne enfant, un nombre tombé à zéro.
  const groupe = { lignes: [{ ...adulte, qte: 1, intro: "(par groupe)" }] };
  const rg = { ligne_id: "a", details: {} };
  const a = contenuAvecReservation(groupe, rg, { personnes: { adultes: 2, enfants: 0 } }, { personnes: { adultes: 3, enfants: 0 } });
  assert.equal(a.contenu, null);
  assert.deepEqual(a.reste, [{ cle: "adultes", reservation: 3, facture: 1 }]);
  const fixe = { lignes: [{ id: "a", kind: "ligne", libelle: "Forfait", montant: 500, unite: null, qte: null }] };
  assert.deepEqual(contenuAvecReservation(fixe, rg, { personnes: { adultes: 2 } }, { personnes: { adultes: 3 } }).reste.map((x) => x.cle), ["adultes"]);
  const sansEnfant = { lignes: [adulte] };
  const e = contenuAvecReservation(sansEnfant, { ligne_id: "a", details: {} }, { personnes: { adultes: 2, enfants: 0 } }, { personnes: { adultes: 2, enfants: 2 } });
  assert.equal(e.contenu, null);
  assert.deepEqual(e.reste, [{ cle: "enfants", reservation: 2, facture: 0 }]);
  const zero = contenuAvecReservation(contenu, r, avant, { ...avant, personnes: { adultes: 0, enfants: 1 } });
  assert.deepEqual(zero.reste.map((x) => x.cle), ["adultes"]);
  assert.equal(zero.contenu, null, "pas de ligne à zéro : on laisse la personne décider");
});

test("réservation vers facture : une partie suit, l'autre reste en écart signalé", () => {
  const { contenu: suite, reste } = contenuAvecReservation(contenu, r, avant, { date_service: "2026-12-11", personnes: { adultes: 3, enfants: 1 } });
  assert.equal(suite.lignes[0].qte, 3);
  assert.equal(suite.lignes[0].date_service, "2026-12-11");
  assert.deepEqual(reste, []);
  const partiel = contenuAvecReservation({ lignes: [adulte] }, { ligne_id: "a", details: {} }, { date_service: "2026-12-10", personnes: { adultes: 2, enfants: 0 } }, { date_service: "2026-12-11", personnes: { adultes: 2, enfants: 1 } });
  assert.equal(partiel.contenu.lignes[0].date_service, "2026-12-11");
  assert.deepEqual(partiel.reste.map((x) => x.cle), ["enfants"]);
});

test("réservation vers facture : rien à faire, ligne absente, document sans ce service", () => {
  assert.deepEqual(contenuAvecReservation(contenu, r, avant, avant), { contenu: null, reste: [] });
  assert.deepEqual(contenuAvecReservation(contenu, { ligne_id: "zz", details: {} }, avant, { ...avant, date_service: "2026-12-12" }), { contenu: null, reste: [] });
  assert.deepEqual(contenuAvecReservation(contenu, { ligne_id: "", details: {} }, avant, { ...avant, date_service: "2026-12-12" }), { contenu: null, reste: [] });
  assert.deepEqual(contenuAvecReservation(null, r, avant, avant), { contenu: null, reste: [] });
});

test("les réservations créées d'après un document suivent ensuite leur facture (contrôle de cohérence avec la création)", () => {
  const [{ reservation }] = reservationsDepuisDocument({ dossier_id: "D", contenu: { lignes: [{ ...adulte, prestation_id: null }, { ...enfant }] } }, { uid: () => "R" });
  const { contenu: suite } = contenuAvecReservation({ lignes: [adulte, enfant] }, reservation, { date_service: reservation.date_service, personnes: reservation.personnes }, { date_service: "2026-12-20", personnes: { adultes: 3, enfants: 1 } });
  assert.equal(ecartReservation({ ...reservation, date_service: "2026-12-20", personnes: { adultes: 3, enfants: 1 }, montant_vente: 3 * 800 + 500 }, { contenu: suite }), null);
});

import { recalculerCommissions } from "../src/gestion/js/operations-calc.mjs";

test("recalcul des commissions : seulement les services sur place, non annulés, non reçus, avec une règle complète", () => {
  const regles = { P: { type: "pourcent_vente", valeur: 10 }, Q: { type: "vente_moins_net" } };
  const nets = { 1: { net_prevu: 700 }, 2: { commission_prevue: 50 }, 3: { commission_prevue: 100, commission_recue_le: "2026-11-01" }, 5: { net_prevu: null }, 6: { commission_prevue: 300 } };
  const R = [
    { id: "1", partenaire_id: "Q", paye_sur_place: true, statut: "confirme", montant_vente: 1000, dossier_id: "d" },
    { id: "2", partenaire_id: "P", paye_sur_place: true, statut: "confirme", montant_vente: 1000, dossier_id: "d" },
    { id: "3", partenaire_id: "P", paye_sur_place: true, statut: "confirme", montant_vente: 1000, dossier_id: "d" },
    { id: "4", partenaire_id: "P", paye_sur_place: false, statut: "confirme", montant_vente: 1000, dossier_id: "d" },
    { id: "5", partenaire_id: "Q", paye_sur_place: true, statut: "confirme", montant_vente: 1000, dossier_id: "d" },
    { id: "6", partenaire_id: "P", paye_sur_place: true, statut: "confirme", montant_vente: 3000, dossier_id: "d" },
    { id: "7", partenaire_id: "P", paye_sur_place: true, statut: "annule", montant_vente: 1000, dossier_id: "d" },
    { id: "8", partenaire_id: "P", paye_sur_place: true, statut: "confirme", montant_vente: 1000, dossier_id: "x" },
    { id: "9", partenaire_id: "Z", paye_sur_place: true, statut: "confirme", montant_vente: 1000, dossier_id: "d" },
  ];
  const ctx = { regleDe: (id) => regles[id] || null, netDe: (r) => nets[r.id] || null, ecartees: new Set(["x"]) };
  const t = recalculerCommissions(R, ctx);
  assert.deepEqual(t.changements.map((c) => [c.reservation.id, c.avant, c.apres]), [["1", null, 300], ["2", 50, 100]]);
  assert.equal(t.inchanges, 1, "6 : 300 déjà juste");
  assert.equal(t.impossibles, 2, "5 : net manquant, 9 : pas de règle");
  assert.deepEqual(recalculerCommissions(R, ctx, { seulementVides: true }).changements.map((c) => c.reservation.id), ["1"]);
  assert.deepEqual(recalculerCommissions(R, ctx, { partenaireId: "P" }).changements.map((c) => c.reservation.id), ["2"]);
});
