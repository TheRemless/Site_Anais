// Acompte absent du voucher (INV-2026-055, 26.11.2026). Un service payé sur place avec un acompte encaissé par l'agence (paiement de type
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

// Le cas réel, rendu fictif : un bateau privé à 6 900 payé sur place au partenaire, un acompte de 1 200 reçu par l'agence.
const tour = (o = {}) => ({ id: "R1", dossier_id: "D1", entite_id: "SECRET", ligne_id: "L1", prestation_id: null, partenaire_id: null, libelle: "Private 4 Islands tour", date_service: "2026-12-22", heure_pickup: "08:00", lieu_pickup: "Resort Exemple", personnes: { adultes: 2, enfants: 0, bebes: 0 }, statut: "confirme", reference_partenaire: "", montant_vente: 6900, paye_sur_place: true, notes: "", details: { remarques_paiement: "Deposit paid" }, ...o });

test("règle : un acompte au-delà des services chez nous est celui du service payé sur place", () => {
  const r = tour();
  assert.deepEqual(O.paiementDuService(r, { resume: { total: 0, recu: 1200 }, reservations: [r] }), { statut: "acompte", verse: 1200, reste: 5700, surPlace: true, global: false });
  // Rien reçu : sur place, comme avant.
  assert.deepEqual(O.paiementDuService(r, { resume: { total: 0, recu: 0 }, reservations: [r] }), { statut: "sur_place", verse: null, reste: null, surPlace: true, global: false });
  // Tout reçu : payé, aucun reste.
  assert.equal(O.paiementDuService(r, { resume: { total: 0, recu: 6900 }, reservations: [r] }).statut, "paye");
  // L'argent reçu paie d'abord les services chez nous du dossier : 2 000 chez nous, 2 500 reçus → 500 d'acompte sur le bateau.
  const p = O.paiementDuService(r, { resume: { total: 2000, recu: 2500 }, reservations: [r, { id: "R2", dossier_id: "D1", paye_sur_place: false, montant_vente: 2000 }] });
  assert.deepEqual([p.verse, p.reste], [500, 6400]);
  assert.equal(O.paiementDuService(r, { resume: { total: 2000, recu: 1500 }, reservations: [r] }).statut, "sur_place", "acompte entièrement pris par les services chez nous");
  // Deux services sur place : la part de chacun n'est pas connue, le montant est dit pour tout le dossier et aucun reste n'est inventé.
  const deux = O.paiementDuService(r, { resume: { total: 0, recu: 1200 }, reservations: [r, tour({ id: "R3" })] });
  assert.deepEqual(deux, { statut: "acompte", verse: 1200, reste: null, surPlace: true, global: true });
  // Un service sur place annulé ne compte pas.
  assert.equal(O.paiementDuService(r, { resume: { total: 0, recu: 1200 }, reservations: [r, tour({ id: "R3", statut: "annule" })] }).global, false);
  // Un service chez nous garde la règle d'avant (ZTP compris).
  assert.equal(O.paiementDuService(tour({ paye_sur_place: false }), { resume: { total: 6900, recu: 1200 }, reservations: [] }).statut, "acompte");
  assert.equal(O.paiementDuService(tour({ paye_sur_place: false }), { resume: { total: 6900, recu: 0 }, reservations: [] }).statut, "en_attente");
});

const REGL = { emetteur: { nom: "Excursions Exemple", adresse: "", telephone: "+66 00" }, apparence: {}, voucher: {}, devise: "THB", fonctionnement: "excursions" };
const CLIENT = { prenom: "Jane", nom: "Example", telephone: "+44 7700 900123", adresse: "" };
const voucher = (r, { resume, reservations = [r], type = "bateau" } = {}) => renderVoucher({ reservation: r, prestation: null, type, index: 1 }, { reglages: REGL, dossier: { ref: "INV-2026-900" }, client: CLIENT, resume, reservations, trajet: null }).lignes;

test("voucher de Secret : « Deposit Paid » et le mode sur place cochés, montant versé et reste à payer imprimés", () => {
  const l = voucher(tour(), { resume: { total: 0, recu: 1200 } });
  const statut = l.find((x) => x.startsWith("Payment Status"));
  assert.match(statut, /☒ Deposit Paid/, statut);
  assert.match(statut, /☒ Pay at Pier \/ Provider/, statut);
  assert.match(statut, /☐ Paid/, statut);
  assert.match(l.find((x) => x.startsWith("Amount Already Paid")), /1,200|1'200|1 200/);
  assert.match(l.find((x) => x.startsWith("Balance to Pay on Arrival")), /5,700|5'700|5 700/);
  assert.match(l.find((x) => x.startsWith("Total Price")), /6,900|6'900|6 900/);
  assert.ok(l.some((x) => /Remarks.*Deposit paid/.test(x)), "la remarque de paiement saisie reste imprimée");
  // Sans acompte : inchangé, une seule case, aucune ligne de montant.
  const sans = voucher(tour(), { resume: { total: 0, recu: 0 } });
  assert.match(sans.find((x) => x.startsWith("Payment Status")), /☐ Deposit Paid ☒ Pay at Pier/);
  assert.equal(sans.find((x) => x.startsWith("Amount Already Paid")), undefined);
  // Activité : même règle avec ses propres mots.
  const act = voucher(tour(), { resume: { total: 0, recu: 1200 }, type: "activite" });
  assert.match(act.find((x) => x.startsWith("Payment Status")), /☒ Deposit Paid ☒ Pay on Arrival/);
  // Deux services sur place : le montant pour tout le dossier, pas de reste.
  const deux = voucher(tour(), { resume: { total: 0, recu: 1200 }, reservations: [tour(), tour({ id: "R3" })] });
  assert.ok(deux.some((x) => x.startsWith("Amount Already Paid (whole booking)")));
  assert.equal(deux.find((x) => x.startsWith("Balance to Pay on Arrival")), undefined);
});

test("Booking confirmation (Taxi et transfert de Secret payé au chauffeur) : déjà payé et reste à payer sous le prix", () => {
  const t = textesVoucher(null);
  const pay = O.paiementDuService(tour(), { resume: { total: 0, recu: 500 }, reservations: [tour()] });
  const champs = champsBooking({ nom: "Jane Example", montant: 1500, devise: "THB", paiement: { ...pay, verse: 500, reste: 1000 }, t });
  const cles = champs.map((c) => c.cle);
  assert.deepEqual(cles.slice(cles.indexOf("TOTAL PRICE"), cles.indexOf("TOTAL PRICE") + 3), ["TOTAL PRICE", "ALREADY PAID", "BALANCE TO PAY"]);
  assert.equal(champs.find((c) => c.cle === "ALREADY PAID").valeur, "500 THB");
  assert.equal(champs.find((c) => c.cle === "BALANCE TO PAY").valeur, "1'000 THB");
  assert.ok(!champsBooking({ montant: 1500, t }).some((c) => c.cle === "ALREADY PAID"), "sans acompte : rien de plus");
  assert.ok(champsBooking({ montant: 1500, paiement: { statut: "acompte", verse: 500, reste: null, global: true }, t }).some((c) => c.cle === "ALREADY PAID (WHOLE BOOKING)"));
});

test("message WhatsApp de Taxi : le reste à payer au chauffeur est celui du service, plus « payé » à tort", () => {
  const pay = O.paiementDuService(tour({ montant_vente: 1500 }), { resume: { total: 0, recu: 500 }, reservations: [tour({ montant_vente: 1500 })] });
  assert.equal(variablesVoucher({ paiement: pay.statut, solde: pay.reste, devise: "THB" }).paiement, "The remaining 1,000 THB will be collected in cash directly by the driver.");
});

test("empreinte d'un voucher envoyé : un acompte reçu ensuite le marque « modifié depuis l'envoi », un voucher sans acompte ne bouge pas", () => {
  const r = tour();
  const avant = O.empreinteVoucher({ reservation: r, client: CLIENT, statut: O.statutEmpreinte(O.paiementDuService(r, { resume: { total: 0, recu: 0 }, reservations: [r] })), devise: "THB" });
  const meme = O.empreinteVoucher({ reservation: r, client: CLIENT, statut: "sur_place", devise: "THB" });
  assert.equal(avant, meme, "sans acompte, l'empreinte est celle d'avant la correction (pas de faux « modifié »)");
  const apres = O.empreinteVoucher({ reservation: r, client: CLIENT, statut: O.statutEmpreinte(O.paiementDuService(r, { resume: { total: 0, recu: 1200 }, reservations: [r] })), devise: "THB" });
  assert.notEqual(avant, apres);
});

test("textes réglables : les nouvelles lignes sont dans les réglages des vouchers et de la Booking confirmation", () => {
  const cles = (g) => g.flatMap((x) => x.cles.map(([k]) => k));
  for (const k of ["montant_verse", "montant_verse_dossier", "reste_sur_place"]) assert.ok(cles(GROUPES_VOUCHER).includes(k), k);
  for (const k of ["b_verse", "b_verse_dossier", "b_reste"]) assert.ok(cles(GROUPES_BOOKING).includes(k), k);
});
