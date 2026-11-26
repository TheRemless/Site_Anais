// Acompte absent du voucher (26.11.2026). Un service payé sur place avec un acompte encaissé par l'agence (paiement de type
// « acompte ») sortait avec « Pay at Pier / Provider » seul coché : ni « Deposit Paid », ni le montant versé, ni le reste à payer sur place.
// Cause : statutPaiementVoucher rendait « sur_place » dès que la réservation était payée sur place, sans regarder les paiements du dossier.
// Ici : la règle (paiementDuService), le voucher de Secret, la Booking confirmation de Secret et de Taxi, le message WhatsApp de Taxi et
// l'empreinte d'un voucher déjà envoyé. Noms et montants inventés.
import test from "node:test";
import assert from "node:assert/strict";

class Node {}
class Texte extends Node {
  constructor(t) {
    super();
    this.t = t;
  }
  get textContent() {
    return this.t;
  }
}
class El extends Node {
  constructor(tag) {
    super();
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.className = "";
    this.style = {};
  }
  append(...xs) {
    this.children.push(...xs.filter((x) => x !== null && x !== undefined && x !== false).map((x) => (typeof x === "string" || typeof x === "number" ? new Texte(String(x)) : x)));
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener() {}
  get textContent() {
    return this.children.map((c) => c.textContent).join("");
  }
  get lignes() {
    return ["p", "h1", "h2", "li", "tr"].includes(this.tag) ? [this.textContent] : this.children.flatMap((c) => (c instanceof El ? c.lignes : []));
  }
}
globalThis.Node = Node;
globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => new Texte(t) };

const O = await import("../src/gestion/js/operations-calc.mjs");
const { champsBooking } = await import("../src/gestion/js/taxi-calc.mjs");
const { variablesVoucher } = await import("../src/gestion/js/message-voucher-calc.mjs");
const { renderVoucher } = await import("../src/gestion/js/views/voucher.mjs");
const { textesVoucher, GROUPES_VOUCHER, GROUPES_BOOKING } = await import("../src/gestion/js/textes-voucher.mjs");

// Un bateau privé à 6 900 payé sur place au partenaire, un transfert à 800 payé au chauffeur, un service chez nous à 2 000. Montants inventés.
const tour = (o = {}) => ({ id: "R1", dossier_id: "D1", entite_id: "SECRET", ligne_id: "L1", prestation_id: null, partenaire_id: null, libelle: "Private tour", date_service: "2026-12-22", heure_pickup: "08:00", lieu_pickup: "Resort Exemple", personnes: { adultes: 2, enfants: 0, bebes: 0 }, statut: "confirme", reference_partenaire: "", montant_vente: 6900, paye_sur_place: true, notes: "", details: {}, ...o });
const taxi = (o = {}) => tour({ id: "R2", ligne_id: "L2", libelle: "Private taxi", montant_vente: 800, ...o });
const nous = (o = {}) => tour({ id: "R3", ligne_id: "L3", libelle: "Ferry ticket", montant_vente: 2000, paye_sur_place: false, ...o });
const pay = (montant, reservation_id = null) => ({ dossier_id: "D1", montant, ...(reservation_id ? { reservation_id } : {}) });
const P = (r, { total = 0, paiements = [], reservations = [r] } = {}) => O.paiementDuService(r, { resume: { total }, reservations, paiements });

test("règle : un seul service sur place, acompte non rattaché : il est imputé, montant par montant", () => {
  const r = tour();
  assert.deepEqual(P(r, { paiements: [pay(1200)] }), { statut: "acompte", verse: 1200, reste: 5700, surPlace: true, aRattacher: false, tropPercu: 0 });
  assert.deepEqual(P(r, { paiements: [] }), { statut: "sur_place", verse: null, reste: null, surPlace: true, aRattacher: false, tropPercu: 0 });
  assert.deepEqual(P(r, { paiements: [pay(6900)] }), { statut: "paye", verse: 6900, reste: 0, surPlace: false, aRattacher: false, tropPercu: 0 });
  assert.equal(P(r, { paiements: [pay(7000)] }).tropPercu, 100, "un trop-perçu se dit");
  // L'argent non rattaché paie d'abord les services chez nous : 2 000 chez nous, 2 500 reçus → 500 pour le bateau.
  assert.deepEqual([P(r, { total: 2000, paiements: [pay(2500)], reservations: [r, nous()] }).verse, P(r, { total: 2000, paiements: [pay(2500)], reservations: [r, nous()] }).reste], [500, 6400]);
  assert.equal(P(r, { total: 2000, paiements: [pay(1500)], reservations: [r, nous()] }).statut, "sur_place");
});

test("règle : plusieurs services sur place, acompte non rattaché : AUCUN montant sur aucun voucher (jamais compté deux fois)", () => {
  const [a, b] = [tour(), taxi()];
  for (const r of [a, b]) {
    const p = P(r, { paiements: [pay(1200)], reservations: [a, b] });
    assert.deepEqual([p.statut, p.verse, p.reste, p.aRattacher], ["sur_place", null, null, true], r.libelle);
  }
  // Rattaché au bateau : seul son voucher le dit ; le transfert garde son prix entier à payer.
  assert.deepEqual([P(a, { paiements: [pay(1200, "R1")], reservations: [a, b] }).verse, P(a, { paiements: [pay(1200, "R1")], reservations: [a, b] }).reste], [1200, 5700]);
  assert.deepEqual(P(b, { paiements: [pay(1200, "R1")], reservations: [a, b] }), { statut: "sur_place", verse: null, reste: null, surPlace: true, aRattacher: false, tropPercu: 0 });
  // Deux acomptes rattachés, un par service.
  assert.equal(P(b, { paiements: [pay(1200, "R1"), pay(300, "R2")], reservations: [a, b] }).reste, 500);
  // Un service annulé ne reçoit rien et ne transmet rien : le seul service sur place restant n'hérite pas de son acompte rattaché.
  const ann = taxi({ statut: "annule" });
  assert.equal(P(ann, { paiements: [pay(300, "R2")], reservations: [a, ann] }).verse, null);
  assert.equal(P(a, { paiements: [pay(300, "R2")], reservations: [a, ann] }).verse, null);
});

test("règle : un acompte rattaché à un service sur place ne paie pas les services chez nous (ZTP inchangé)", () => {
  const [a, n] = [tour(), nous()];
  assert.equal(P(n, { total: 2000, paiements: [pay(1200, "R1")], reservations: [a, n] }).statut, "en_attente");
  assert.equal(P(n, { total: 2000, paiements: [pay(1200, "R1"), pay(500)], reservations: [a, n] }).statut, "acompte");
  // ZTP : pas de service sur place, la règle d'avant (statutPaiementVoucher).
  assert.equal(P(n, { total: 2000, paiements: [pay(2000)], reservations: [n] }).statut, "paye");
  assert.equal(P(n, { total: 2000, paiements: [], reservations: [n] }).statut, "en_attente");
});

test("alertes du dossier : acompte à rattacher, trop-perçu, remboursement à traiter, remarque contradictoire", () => {
  const [a, b] = [tour({ details: { remarques_paiement: "Deposit of 1000 paid" } }), taxi()];
  const codes = (x) => x.map((y) => `${y.code}:${y.montant}`);
  assert.deepEqual(codes(O.alertesPaiements({ reservations: [a, b], paiements: [pay(1200)], resume: { total: 0 } })), ["a_rattacher:1200"]);
  assert.deepEqual(codes(O.alertesPaiements({ reservations: [a, b], paiements: [pay(1200, "R1")], resume: { total: 0 } })), ["remarque_paiement:1200"]);
  assert.deepEqual(codes(O.alertesPaiements({ reservations: [tour(), b], paiements: [pay(7000, "R1")], resume: { total: 0 } })), ["trop_percu:100"]);
  assert.deepEqual(codes(O.alertesPaiements({ reservations: [tour(), taxi({ statut: "annule" })], paiements: [pay(300, "R2")], resume: { total: 0 } })), ["remboursement:300"]);
  assert.deepEqual(O.alertesPaiements({ reservations: [nous()], paiements: [pay(2000)], resume: { total: 2000 } }), [], "ZTP ou chez nous : rien");
  // La remarque qui donne un autre montant ne s'imprime pas ; celle qui donne le bon montant, si.
  const p = P(a, { paiements: [pay(1200)] });
  assert.equal(O.remarquePaiementImprimee("Deposit of 1000 paid", p, 6900), "");
  assert.equal(O.remarquePaiementImprimee("Deposit of 1,200 paid", p, 6900), "Deposit of 1,200 paid");
  assert.equal(O.remarquePaiementImprimee("Cash only", p, 6900), "Cash only");
});

const REGL = { emetteur: { nom: "Excursions Exemple", adresse: "", telephone: "+66 00" }, apparence: {}, voucher: {}, devise: "THB", fonctionnement: "excursions" };
const CLIENT = { prenom: "Jane", nom: "Example", telephone: "+44 7700 900123", adresse: "" };
const voucher = (r, { paiements = [], reservations = [r], type = "bateau", total = 0 } = {}) => renderVoucher({ reservation: r, prestation: null, type, index: 1 }, { reglages: REGL, dossier: { ref: "INV-2026-900" }, client: CLIENT, resume: { total, recu: 0, paiements }, reservations, trajet: null }).lignes;
const ligneDe = (l, debut) => l.find((x) => x.startsWith(debut));

test("voucher de Secret : acompte imprimé sur SON voucher seulement ; tout payé : reste 0", () => {
  const l = voucher(tour(), { paiements: [pay(1200)] });
  assert.match(ligneDe(l, "Payment Status"), /☐ Paid ☒ Deposit Paid ☒ Pay at Pier \/ Provider/);
  assert.match(ligneDe(l, "Amount Already Paid"), /1'200/);
  assert.match(ligneDe(l, "Balance to Pay on Arrival"), /5'700/);
  const sans = voucher(tour(), { paiements: [] });
  assert.match(ligneDe(sans, "Payment Status"), /☐ Deposit Paid ☒ Pay at Pier/);
  assert.equal(ligneDe(sans, "Amount Already Paid"), undefined);
  // Deux services sur place, acompte non rattaché : ni l'un ni l'autre n'imprime de montant.
  for (const r of [tour(), taxi()]) assert.equal(ligneDe(voucher(r, { paiements: [pay(1200)], reservations: [tour(), taxi()] }), "Amount Already Paid"), undefined);
  // Tout payé d'avance : « Paid » coché, reste 0, rien à payer sur place.
  const paye = voucher(tour(), { paiements: [pay(6900)] });
  assert.match(ligneDe(paye, "Payment Status"), /☒ Paid ☐ Deposit Paid ☐ Pay at Pier/);
  assert.match(ligneDe(paye, "Balance to Pay on Arrival"), /THB 0|: 0/);
  // Une remarque de paiement qui contredit l'acompte enregistré ne s'imprime pas.
  assert.ok(!voucher(tour({ details: { remarques_paiement: "Deposit of 1000 paid" } }), { paiements: [pay(1200)] }).some((x) => /Deposit of 1000/.test(x)));
  assert.ok(voucher(tour({ details: { remarques_paiement: "Cash only" } }), { paiements: [pay(1200)] }).some((x) => /Cash only/.test(x)));
});

test("Booking confirmation : déjà payé et reste ; tout payé : « BALANCE TO PAY: 0 », plus de paiement au chauffeur", () => {
  const t = textesVoucher(null);
  const cles = (c) => c.map((x) => `${x.cle}=${x.valeur}`);
  assert.deepEqual(cles(champsBooking({ montant: 1500, paiement: { statut: "acompte", verse: 500, reste: 1000 }, t })).filter((x) => /PAID|BALANCE/.test(x)), ["ALREADY PAID=500 THB", "BALANCE TO PAY=1'000 THB"]);
  assert.deepEqual(cles(champsBooking({ montant: 1500, paiement: { statut: "paye", verse: 1500, reste: 0 }, t })).filter((x) => /PAID|BALANCE/.test(x)), ["ALREADY PAID=1'500 THB", "BALANCE TO PAY=0 THB"]);
  assert.ok(!champsBooking({ montant: 1500, paiement: { statut: "sur_place", verse: null, reste: null }, t }).some((c) => /PAID|BALANCE/.test(c.cle)));
  assert.ok(t("b_paiement_paye") && t("bs_paiement_paye"));
  assert.ok(!("b_verse_dossier" in Object.fromEntries(GROUPES_BOOKING.flatMap((g) => g.cles))), "plus de montant « pour tout le dossier »");
});

test("message WhatsApp de Taxi : le reste du service ; aucun montant quand l'acompte n'est pas imputé ou que le dossier a trop reçu", () => {
  const p = P(taxi(), { paiements: [pay(500)] , reservations: [taxi()] });
  assert.equal(variablesVoucher({ paiement: p.statut, solde: p.reste, devise: "THB" }).paiement, "The remaining 300 THB will be collected in cash directly by the driver.");
  const deux = P(taxi(), { paiements: [pay(500)], reservations: [tour(), taxi()] });
  assert.doesNotMatch(variablesVoucher({ paiement: deux.statut, solde: deux.reste, devise: "THB" }).paiement, /remaining/);
  assert.doesNotMatch(variablesVoucher({ paiement: "acompte", solde: -1650, devise: "THB" }).paiement, /remaining -/);
});

test("empreinte : chaque montant versé change l'empreinte d'un voucher sur place ; un voucher chez nous ne bouge pas (D6)", () => {
  const r = tour();
  const e = (paiements, x = r) => O.empreinteVoucher({ reservation: x, client: CLIENT, statut: O.statutEmpreinte(P(x, { paiements, reservations: [x] })), devise: "THB" });
  const sans = e([]);
  assert.equal(sans, O.empreinteVoucher({ reservation: r, client: CLIENT, statut: "sur_place", devise: "THB" }), "sans acompte : l'empreinte d'avant (pas de faux « modifié »)");
  const vus = new Set([sans, e([pay(1200)]), e([pay(2000)]), e([pay(6900)])]);
  assert.equal(vus.size, 4, "1 200, 2 000 et tout payé donnent trois empreintes différentes");
  const n = nous();
  assert.equal(e([pay(1000)], n), e([pay(2000)], n), "chez nous : un paiement reçu ne change pas l'empreinte");
});

test("textes réglables : les lignes d'acompte sont dans les réglages des vouchers et de la Booking confirmation", () => {
  const cles = (g) => g.flatMap((x) => x.cles.map(([k]) => k));
  for (const k of ["montant_verse", "reste_sur_place"]) assert.ok(cles(GROUPES_VOUCHER).includes(k), k);
  for (const k of ["b_verse", "b_reste", "b_paiement_paye"]) assert.ok(cles(GROUPES_BOOKING).includes(k), k);
});
