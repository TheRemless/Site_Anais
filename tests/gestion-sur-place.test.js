import { test } from "node:test";
import assert from "node:assert/strict";
import { totaux, montantLigne, montantBrut, montantSurPlace } from "../src/gestion/js/calc.mjs";
import { reservationsDepuisDocument, ecartReservation, duParPartenaire, commissionsARecevoir, statutPaiementVoucher } from "../src/gestion/js/operations-calc.mjs";
import { margeDocument } from "../src/gestion/js/partenaires-calc.mjs";

const lignes = [
  { id: "a", kind: "ligne", libre: true, libelle: "Transfert", unite: 1000, qte: 2, date_service: "2026-11-20" },
  { id: "b", kind: "ligne", libre: true, libelle: "Kayak, adulte", unite: 1500, qte: 2, date_service: "2026-11-21", paye_sur_place: true },
];

test("total : une ligne payée sur place reste sur le document mais n'entre pas dans le total à régler", () => {
  const t = totaux({ lignes });
  assert.equal(t.net, 2000);
  assert.equal(t.montants[1], 0);
  assert.equal(montantLigne(lignes[1]), 3000);
  assert.equal(montantBrut(lignes[1]), 0);
  assert.equal(montantSurPlace({ lignes }), 3000);
  assert.equal(montantSurPlace({ lignes: [lignes[0]] }), 0);
});

test("total : une remise en pourcentage se calcule sur ce que le client règle, pas sur la ligne sur place", () => {
  const t = totaux({ lignes: [...lignes, { id: "r", kind: "remise", pct: 10 }] });
  assert.equal(t.remises, -200);
  assert.equal(t.net, 1800);
});

test("marge : une ligne payée sur place n'entre ni dans la vente ni dans les nets", () => {
  const c = { lignes: [{ ...lignes[0], prestation_id: "p1", net: 800 }, { ...lignes[1], prestation_id: "p2", net: 1200 }] };
  const m = margeDocument(c, totaux(c).net);
  assert.equal(m.vente, 2000);
  assert.equal(m.nets, 1600);
  assert.equal(m.marge, 400);
  assert.equal(m.avecNet, 1);
});

test("réservation créée d'après la facture : elle hérite du paiement sur place", () => {
  const doc = { dossier_id: "d", contenu: { lignes: lignes.map((l) => ({ ...l, prestation_id: "p" + l.id })) } };
  const r = reservationsDepuisDocument(doc, { uid: (() => { let i = 0; return () => `r${++i}`; })() });
  assert.equal(r.length, 2);
  assert.equal(r.find((x) => x.reservation.ligne_id === "a").reservation.paye_sur_place, false);
  assert.equal(r.find((x) => x.reservation.ligne_id === "b").reservation.paye_sur_place, true);
  // Le prix de vente reste le vrai prix, même payé sur place.
  assert.equal(r.find((x) => x.reservation.ligne_id === "b").reservation.montant_vente, 3000);
});

test("écart facture et réservation : le paiement sur place est comparé", () => {
  const doc = { contenu: { lignes: [{ ...lignes[1], prestation_id: "p" }] } };
  const base = { ligne_id: "b", date_service: "2026-11-21", personnes: { adultes: 2, enfants: 0 }, montant_vente: 3000 };
  const e = ecartReservation({ ...base, paye_sur_place: false }, doc);
  assert.deepEqual(e.champs.map((c) => c.cle), ["paye_sur_place"]);
  assert.equal(e.attendu.paye_sur_place, true);
  assert.equal(ecartReservation({ ...base, paye_sur_place: true }, doc), null);
});

test("dû aux partenaires : un service payé sur place ne leur est rien dû", () => {
  const R = [
    { id: "1", partenaire_id: "P", date_service: "2026-11-20", statut: "confirme", montant_vente: 2000, dossier_id: "d" },
    { id: "2", partenaire_id: "P", date_service: "2026-11-21", statut: "confirme", montant_vente: 3000, dossier_id: "d", paye_sur_place: true },
  ];
  const nets = { 1: { net_prevu: 1600 }, 2: { net_prevu: 2400, commission_prevue: 450 } };
  const du = duParPartenaire(R, (r) => nets[r.id] || null);
  assert.equal(du.length, 1);
  assert.equal(du[0].nb, 1);
  assert.equal(du[0].net_prevu, 1600);
});

test("commissions à recevoir : par partenaire et par mois, prévue, reçue, reste, et services sans commission", () => {
  const R = [
    { id: "1", partenaire_id: "P", date_service: "2026-11-21", statut: "confirme", montant_vente: 3000, dossier_id: "d", paye_sur_place: true },
    { id: "2", partenaire_id: "P", date_service: "2026-11-25", statut: "confirme", montant_vente: 1000, dossier_id: "d", paye_sur_place: true },
    { id: "3", partenaire_id: "P", date_service: "2026-11-26", statut: "confirme", montant_vente: 500, dossier_id: "d", paye_sur_place: true },
    { id: "4", partenaire_id: "P", date_service: "2026-11-22", statut: "annule", montant_vente: 900, dossier_id: "d", paye_sur_place: true },
    { id: "5", partenaire_id: "P", date_service: "2026-11-22", statut: "confirme", montant_vente: 900, dossier_id: "x", paye_sur_place: true },
    { id: "6", partenaire_id: "P", date_service: "2026-11-22", statut: "confirme", montant_vente: 700, dossier_id: "d" },
    { id: "7", partenaire_id: "Q", date_service: "2026-12-02", statut: "confirme", montant_vente: 800, dossier_id: "d", paye_sur_place: true },
  ];
  const nets = { 1: { commission_prevue: 450, commission_recue: 450 }, 2: { commission_prevue: 150 }, 7: { commission_prevue: 100 } };
  const c = commissionsARecevoir(R, (r) => nets[r.id] || null, new Set(["x"]));
  assert.equal(c.length, 2);
  const nov = c.find((g) => g.partenaire_id === "P");
  assert.equal(nov.nb, 3);
  assert.equal(nov.vente, 4500);
  assert.equal(nov.commission_prevue, 600);
  assert.equal(nov.commission_recue, 450);
  assert.equal(nov.reste, 150);
  assert.equal(nov.sansCommission, 1);
  assert.equal(c[0].mois, "2026-12");
});

test("voucher : un service payé sur place annonce le paiement au prestataire, même si le dossier est soldé", () => {
  assert.equal(statutPaiementVoucher({ total: 2000, recu: 2000 }), "paye");
  assert.equal(statutPaiementVoucher({ total: 2000, recu: 2000, surPlace: true }), "sur_place");
  assert.equal(statutPaiementVoucher({ total: 0, recu: 0 }), "sur_place");
});
