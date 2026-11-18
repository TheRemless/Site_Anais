// tests/gestion-voucher-tuk-tuk.test.js : l'« Activity & Tour Voucher » du tuk-tuk de Jérémy (INV-2026-035, 18.11.2026), 2 adultes et 2 enfants,
// hors catalogue, 1 200 THB payés sur place. Il sortait avec un hôtel qui était le lieu de pickup, 1 adulte et 0 enfant, une ligne « Company /
// Operator » vide et « Payment Pending ».
import test from "node:test";
import assert from "node:assert/strict";

// Un DOM minimal : de quoi rendre le voucher (ui.mjs n'utilise que createElement, createTextNode et append).
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
  }
  append(...xs) {
    this.children.push(...xs);
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener() {}
  get textContent() {
    return this.children.map((c) => c.textContent).join("");
  }
  get lignes() {
    return ["p", "h1", "h2"].includes(this.tag) ? [this.textContent] : this.children.flatMap((c) => (c instanceof El ? c.lignes : []));
  }
}
globalThis.Node = Node;
globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => new Texte(t) };

const O = await import("../src/gestion/js/operations-calc.mjs");
const G = await import("../src/gestion/js/dossier-gestes-calc.mjs");
const { ligneLibre } = await import("../src/gestion/js/partenaires-calc.mjs");
const { renderVoucher } = await import("../src/gestion/js/views/voucher.mjs");

const REGL = { emetteur: { nom: "Secret Travel & Tour", adresse: "", telephone: "+66 00" }, apparence: {}, voucher: {}, devise: "THB" };
const CLIENT = { prenom: "Guillaume", nom: "Cazenave", telephone: "+33 6 00 00 00 00", adresse: "" };
const tuk = (extra = {}) => ({ id: "R35", dossier_id: "D35", entite_id: "SECRET", ligne_id: "L1", prestation_id: null, partenaire_id: null, libelle: "Full day tour - Tuk Tuk", date_service: "2026-12-14", heure_pickup: "08:00", lieu_pickup: "Ayutthaya Train Station", personnes: { adultes: 2, enfants: 2, bebes: 0 }, statut: "confirme", montant_vente: 1200, notes: "", paye_sur_place: false, details: {}, ...extra });
const voucher = (r, { client = CLIENT, resume = { total: 1200, recu: 0 } } = {}) => renderVoucher({ reservation: r, prestation: null, type: "activite", index: 1 }, { reglages: REGL, dossier: { ref: "INV-2026-035" }, client, resume, trajet: null }).lignes;
const ligneDe = (lignes, debut) => lignes.find((l) => l.startsWith(debut));

test("1. le lieu de pickup n'est pas un hébergement : pas de ligne Hotel sans hôtel saisi", () => {
  const l = voucher(tuk());
  assert.equal(ligneDe(l, "Hotel / Accommodation"), undefined, l.join("\n"));
  assert.match(ligneDe(l, "Pick-up Location") || ligneDe(l, "Pickup Location") || l.find((x) => x.includes("Ayutthaya Train Station")), /Ayutthaya Train Station/);
  // Hôtel de la fiche client : imprimé, même avec un pickup ailleurs.
  assert.match(ligneDe(voucher(tuk(), { client: { ...CLIENT, entite_id: "SECRET", adresse: "Baan Thai House" } }), "Hotel / Accommodation"), /Baan Thai House/);
  // Hôtel saisi sur la réservation : il l'emporte sur la fiche ; vidé exprès, rien ne s'imprime.
  assert.match(ligneDe(voucher(tuk({ details: { hotel: "Sala Ayutthaya" } }), { client: { ...CLIENT, adresse: "Baan Thai House" } }), "Hotel / Accommodation"), /Sala Ayutthaya/);
  assert.equal(ligneDe(voucher(tuk({ details: { hotel: "" } }), { client: { ...CLIENT, adresse: "Baan Thai House" } }), "Hotel / Accommodation"), undefined);
  // Le pickup à l'hôtel de la fiche garde sa chambre.
  assert.deepEqual(O.hebergementVoucher({ adresse: "Baiyok Hotel" }, { lieu_pickup: "Baiyok Hotel, Room 6" }), { hotel: "Baiyok Hotel", chambre: "6" });
  assert.deepEqual(O.hebergementVoucher({}, { lieu_pickup: "Ayutthaya Train Station" }), { hotel: "", chambre: "" });
});

test("1 bis. le champ Hôtel est proposé pour une activité, une excursion en bateau et une location", () => {
  for (const type of ["activite", "bateau", "location"]) assert.ok(O.champsVoucherDe(type).includes("hotel"), type);
  assert.ok(!O.champsVoucherDe("transfert").includes("hotel"));
});

test("2. Number of Guests : les participants saisis, jamais la quantité facturée", () => {
  const ligne = ligneLibre({ libelle: "Full day tour - Tuk Tuk", prix: 1200, date: "2026-12-14", par: "grp", personnes: { adultes: 2, enfants: 2 } }, { uid: () => "L1" });
  const [{ reservation }] = O.reservationsDepuisDocument({ dossier_id: "D35", contenu: { lignes: [ligne] } }, { uid: () => "R35" });
  const l = voucher(tuk({ personnes: reservation.personnes }));
  assert.match(ligneDe(l, "Number of Guests"), /Adults: 2\s*Children: 2/);
});

test("3. pas de ligne « Company / Operator » vide sans partenaire", () => {
  assert.equal(ligneDe(voucher(tuk()), "Company / Operator"), undefined);
});

test("4. payé sur place : « Pay on Arrival » coché, pas « Payment Pending »", () => {
  const l = ligneDe(voucher(tuk({ paye_sur_place: true })), "Payment Status");
  assert.match(l, /☒ Pay on Arrival/, l);
  assert.doesNotMatch(l, /Payment Pending/);
  // Rien reçu et pas payé sur place : « Payment Pending », comme avant.
  assert.match(ligneDe(voucher(tuk()), "Payment Status"), /☒ Payment Pending/);
  // La case « payé sur place » de la ligne passe à la réservation.
  const ligne = { ...ligneLibre({ libelle: "Full day tour - Tuk Tuk", prix: 1200, par: "grp", personnes: { adultes: 2, enfants: 2 } }, { uid: () => "L1" }), paye_sur_place: true };
  const [{ reservation }] = O.reservationsDepuisDocument({ dossier_id: "D35", contenu: { lignes: [ligne] } }, { uid: () => "R35" });
  assert.equal(reservation.paye_sur_place, true);
  // La case décochée l'emporte sur le mode habituel du partenaire.
  const [x] = O.appliquerModeParDefaut([{ ...ligne, partenaire_id: "P", paye_sur_place: false }], () => ({ regles: { mode_reglement: "sur_place" } }));
  assert.equal(x.paye_sur_place, false);
});

test("dossier d'avant (INV-2026-035) : passer la réservation à 2 adultes et 2 enfants ne change pas le total de 1 200", () => {
  // La ligne telle que l'ancienne « Autre prestation » l'a créée : quantité 1, sans unité ni participants.
  const ancienne = { id: "L1", kind: "ligne", libre: true, titre: "Full day tour - Tuk Tuk", libelle: "Full day tour - Tuk Tuk, 1 passenger, 14 December 2026", intro: "", unite: 1200, qte: 1, date_service: "2026-12-14", prestation_id: null, partenaire_id: null };
  const r = { ligne_id: "L1", details: {} };
  const avant = { date_service: "2026-12-14", personnes: { adultes: 1, enfants: 0 } };
  const apres = { date_service: "2026-12-14", personnes: { adultes: 2, enfants: 2 } };
  const { contenu } = O.contenuAvecReservation({ langue: "en", lignes: [ancienne] }, r, avant, apres);
  const [l] = contenu.lignes;
  assert.equal(l.qte, 1);
  assert.equal(l.unite * l.qte, 1200);
  assert.equal(l.libelle, "Full day tour - Tuk Tuk, 2 adults, 2 children, 14 December 2026");
  // Pas de ligne enfant ajoutée ni de message « pas de tarif enfant » : prix de groupe.
  const e = G.contenuAvecEnfants(contenu, r, avant, apres, { tarifEnfant: () => null, langue: "en" });
  assert.equal(e.contenu, null);
  assert.equal(e.raison, "prix_global");
  // Et plus d'écart entre la facture et la réservation.
  assert.equal(O.ecartReservation({ ...r, date_service: "2026-12-14", personnes: { ...apres.personnes, bebes: 0 }, montant_vente: 1200, paye_sur_place: false, libelle: "Full day tour - Tuk Tuk", partenaire_id: null }, { contenu }), null);
});
