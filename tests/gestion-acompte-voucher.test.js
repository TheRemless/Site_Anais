// Acompte absent du voucher (26.11.2026). Un service payé sur place avec un acompte encaissé par l'agence sortait avec « Pay at Pier /
// Provider » seul coché : ni « Deposit Paid », ni le montant versé, ni le reste à payer sur place. Cause : statutPaiementVoucher rendait
// « sur_place » dès que la réservation était payée sur place, sans regarder ce que le dossier avait reçu.
// L'acompte reste au dossier (décision de Jérémy) : la base l'impute (chez nous d'abord, puis les services sur place par date) et range la
// part de chacun dans le résumé ; l'outil lit ce résumé. Ici : la règle (imputationDossier, la même que recalculer_dossier), le voucher de
// Secret, la Booking confirmation, le message WhatsApp de Taxi et l'empreinte. Noms et montants inventés.
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
// Le résumé du dossier tel que la base le tient (dossiers_resume) : total chez nous, reçu, et la part de chaque service sur place.
const resumeDe = ({ total = 0, recu = 0, reservations = [] } = {}) => ({ total, recu, dossier: { total, recu, ...O.imputationDossier({ total, recu, reservations }) } });
const P = (r, { total = 0, recu = 0, reservations = [r] } = {}) => O.paiementDuService(r, { resume: resumeDe({ total, recu, reservations }) });

test("règle : le reçu couvre d'abord ce qui est dû chez nous, puis les services sur place par date, chacun jusqu'à son prix", () => {
  const r = tour();
  assert.deepEqual(P(r, { recu: 1200 }), { statut: "acompte", verse: 1200, reste: 5700, surPlace: true });
  assert.deepEqual(P(r, { recu: 0 }), { statut: "sur_place", verse: null, reste: null, surPlace: true });
  assert.deepEqual(P(r, { recu: 6900 }), { statut: "paye", verse: 6900, reste: 0, surPlace: false });
  // 2 000 chez nous, 2 500 reçus → 500 pour le bateau ; 1 500 reçus → rien pour lui.
  assert.deepEqual([P(r, { total: 2000, recu: 2500, reservations: [r, nous()] }).verse, P(r, { total: 2000, recu: 2500, reservations: [r, nous()] }).reste], [500, 6400]);
  assert.equal(P(r, { total: 2000, recu: 1500, reservations: [r, nous()] }).statut, "sur_place");
  // Deux services sur place : le plus tôt d'abord (le transfert, le 21), puis le bateau ; jamais le même montant deux fois.
  const [a, b] = [tour(), taxi({ date_service: "2026-12-21" })];
  const imp = O.imputationDossier({ total: 0, recu: 1200, reservations: [a, b] });
  assert.deepEqual(imp.parts, { R2: { verse: 800, reste: 0 }, R1: { verse: 400, reste: 6500 } });
  assert.equal(imp.parts.R1.verse + imp.parts.R2.verse, 1200, "la somme imprimée est le reçu, pas plus");
  // Même date : l'ordre de création.
  const c1 = tour({ id: "C1", created_at: "2026-11-02" });
  const c2 = tour({ id: "C2", created_at: "2026-11-01", montant_vente: 1000 });
  assert.deepEqual(O.imputationDossier({ recu: 1000, reservations: [c1, c2] }).parts.C2, { verse: 1000, reste: 0 });
});

test("règle : un service annulé ne reçoit rien ; ce qui dépasse est à rembourser, puis soldé par le remboursement ; sinon trop-perçu", () => {
  const [a, ann] = [tour({ montant_vente: 800 }), taxi({ statut: "annule" })];
  const avant = O.imputationDossier({ recu: 1200, reservations: [a, ann] });
  assert.deepEqual([avant.parts.R2, avant.parts.R1, avant.a_rembourser, avant.trop_percu], [undefined, { verse: 800, reste: 0 }, 400, 0]);
  const apres = O.imputationDossier({ recu: 1200 - 400, reservations: [a, ann] });
  assert.deepEqual([apres.a_rembourser, apres.trop_percu, apres.parts.R1.verse], [0, 0, 800], "le remboursement saisi solde l'alerte");
  const trop = O.imputationDossier({ recu: 7000, reservations: [tour()] });
  assert.deepEqual([trop.trop_percu, trop.a_rembourser], [100, 0]);
  // Le reste du dossier ne devient jamais négatif à cause d'un remboursement.
  assert.ok(O.imputationDossier({ recu: -500, reservations: [tour()] }).parts.R1.verse === 0);
});

test("règle : un dossier annulé, même sans annuler ses services, n'impute rien ; tout est à rembourser", () => {
  const imp = O.imputationDossier({ recu: 1200, reservations: [tour()], annule: true });
  assert.deepEqual([imp.parts, imp.a_rembourser, imp.trop_percu], [{}, 1200, 0]);
  assert.equal(O.paiementDuService(tour(), { resume: { total: 0, recu: 1200, dossier: imp } }).verse, null, "aucun montant sur le voucher");
});

test("alerte : un acompte réparti entre des prestataires différents montre la répartition ; un seul prestataire, rien", () => {
  const [bateau, transfert] = [tour({ partenaire_id: "pB" }), taxi({ partenaire_id: "pT", date_service: "2026-12-20" })];
  const a = O.alertesPaiements({ reservations: [bateau, transfert], resume: resumeDe({ recu: 1200, reservations: [bateau, transfert] }) }).find((x) => x.code === "repartition");
  assert.deepEqual(a.repartition.map((x) => [x.libelle, x.date, x.verse]), [["Private taxi", "2026-12-20", 800], ["Private tour", "2026-12-22", 400]]);
  const meme = [tour({ partenaire_id: "pB" }), taxi({ partenaire_id: "pB", date_service: "2026-12-20" })];
  assert.ok(!O.alertesPaiements({ reservations: meme, resume: resumeDe({ recu: 1200, reservations: meme }) }).some((x) => x.code === "repartition"));
});

test("règle : chez nous et ZTP, la règle d'avant (le reçu contre le total, aucun montant imprimé)", () => {
  const [a, n] = [tour(), nous()];
  assert.equal(P(n, { total: 2000, recu: 1200, reservations: [a, n] }).statut, "acompte");
  assert.equal(P(n, { total: 2000, recu: 2000, reservations: [n] }).statut, "paye");
  assert.equal(P(n, { total: 2000, recu: 0, reservations: [n] }).statut, "en_attente");
  assert.equal(P(n, { total: 2000, recu: 2000, reservations: [n] }).verse, null);
});

test("dossier non chargé : la part vient du résumé de la base, pas des paiements en mémoire (le même résultat, ouvert ou non)", () => {
  const r = tour();
  // Résumé lu dans dossiers_resume (store Supabase) : aucun paiement en mémoire.
  const base = { total: 0, recu: 1200, paiements: [], dossier: { total: 0, recu: 1200, parts: { R1: { verse: 1200, reste: 5700 } } } };
  assert.deepEqual(O.paiementDuService(r, { resume: base }), { statut: "acompte", verse: 1200, reste: 5700, surPlace: true });
  // Ouvert (paiements chargés) : la même part, puisqu'elle vient toujours du résumé.
  assert.deepEqual(O.paiementDuService(r, { resume: { ...base, paiements: [{ montant: 1200 }] } }), O.paiementDuService(r, { resume: base }));
  // Un service chez nous déjà payé, dossier non ouvert : « Paid », jamais « Payment Pending ».
  assert.equal(O.paiementDuService(nous(), { resume: { total: 2000, recu: 2000, paiements: [], dossier: { parts: {} } } }).statut, "paye");
});

test("alertes du dossier : remboursement à traiter, trop-perçu, remarque contradictoire ; les dates, % et frais ne comptent pas", () => {
  const a = tour({ details: { remarques_paiement: "Deposit of 1000 paid" } });
  const codes = (x) => x.map((y) => `${y.code}:${y.montant}`);
  assert.deepEqual(codes(O.alertesPaiements({ reservations: [a], resume: resumeDe({ recu: 1200, reservations: [a] }) })), ["remarque_paiement:1200"]);
  assert.deepEqual(codes(O.alertesPaiements({ reservations: [tour()], resume: resumeDe({ recu: 7000, reservations: [tour()] }) })), ["trop_percu:100"]);
  const ann = taxi({ statut: "annule" });
  assert.deepEqual(codes(O.alertesPaiements({ reservations: [tour({ montant_vente: 800 }), ann], resume: resumeDe({ recu: 1200, reservations: [tour({ montant_vente: 800 }), ann] }) })), ["remboursement:400"]);
  assert.deepEqual(O.alertesPaiements({ reservations: [nous()], resume: resumeDe({ total: 2000, recu: 2000, reservations: [nous()] }) }), [], "ZTP ou chez nous : rien");
  const p = P(a, { recu: 1200 });
  assert.equal(O.remarquePaiementImprimee("Deposit of 1000 paid", p, 6900), "");
  assert.equal(O.remarquePaiementImprimee("Deposit of 1,200 paid", p, 6900), "Deposit of 1,200 paid");
  assert.equal(O.remarquePaiementImprimee("Cash only", p, 6900), "Cash only");
  // Le montant de l'acompte reste lu quand « fee » suit d'autres mots : il contredit la part enregistrée s'il est faux.
  assert.deepEqual(O.montantsRemarque("Deposit 1500 THB plus fee"), [1500]);
  assert.deepEqual(O.montantsRemarque("Deposit 1500 + 150 Wise fee"), [1500]);
  assert.equal(O.remarquePaiementImprimee("Deposit 1500 THB plus fee", p, 6900), "", "1 500 contredit la part de 1 200");
  for (const t of ["Deposit 1,200 paid on 26.11.2026", "Deposit 1,200 paid 26/11", "Wise 3 % included, 1200 paid", "1200 paid, 50 THB fee", "1200 paid + 40 fees", "1200 + 150 Wise fee", "1200 + 150 bank transfer fee", "1200 THB plus fee", "Deposit 1200 THB plus Wise fee"]) assert.equal(O.remarquePaiementImprimee(t, p, 6900), t, t);
});

const REGL = { emetteur: { nom: "Excursions Exemple", adresse: "", telephone: "+66 00" }, apparence: {}, voucher: {}, devise: "THB", fonctionnement: "excursions" };
const CLIENT = { prenom: "Jane", nom: "Example", telephone: "+44 7700 900123", adresse: "" };
const voucher = (r, { recu = 0, reservations = [r], type = "bateau", total = 0 } = {}) => renderVoucher({ reservation: r, prestation: null, type, index: 1 }, { reglages: REGL, dossier: { ref: "INV-2026-900" }, client: CLIENT, resume: resumeDe({ total, recu, reservations }), reservations, trajet: null }).lignes;
const ligneDe = (l, debut) => l.find((x) => x.startsWith(debut));

test("voucher de Secret : chaque voucher imprime SA part ; tout payé : reste 0", () => {
  const l = voucher(tour(), { recu: 1200 });
  assert.match(ligneDe(l, "Payment Status"), /☐ Paid ☒ Deposit Paid ☒ Pay at Pier \/ Provider/);
  assert.match(ligneDe(l, "Amount Already Paid"), /1'200/);
  assert.match(ligneDe(l, "Balance to Pay on Arrival"), /5'700/);
  const sans = voucher(tour(), { recu: 0 });
  assert.match(ligneDe(sans, "Payment Status"), /☐ Deposit Paid ☒ Pay at Pier/);
  assert.equal(ligneDe(sans, "Amount Already Paid"), undefined);
  // Deux services sur place, 1 200 reçus : le transfert (le 21) reçoit 800, le bateau 400 ; chacun n'imprime que sa part.
  const deux = [tour(), taxi({ date_service: "2026-12-21" })];
  assert.match(ligneDe(voucher(deux[1], { recu: 1200, reservations: deux }), "Amount Already Paid"), /800/);
  assert.match(ligneDe(voucher(deux[0], { recu: 1200, reservations: deux }), "Amount Already Paid"), /400/);
  // Tout payé d'avance : « Paid » coché, reste 0, rien à payer sur place.
  const paye = voucher(tour(), { recu: 6900 });
  assert.match(ligneDe(paye, "Payment Status"), /☒ Paid ☐ Deposit Paid ☐ Pay at Pier/);
  assert.match(ligneDe(paye, "Balance to Pay on Arrival"), /THB 0|: 0/);
  // Une remarque de paiement qui contredit l'acompte enregistré ne s'imprime pas.
  assert.ok(!voucher(tour({ details: { remarques_paiement: "Deposit of 1000 paid" } }), { recu: 1200 }).some((x) => /Deposit of 1000/.test(x)));
  assert.ok(voucher(tour({ details: { remarques_paiement: "Cash only" } }), { recu: 1200 }).some((x) => /Cash only/.test(x)));
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

test("message WhatsApp de Taxi : le reste du service ; aucun montant quand rien ne lui est imputé ou que le dossier a trop reçu", () => {
  const p = P(taxi(), { recu: 500, reservations: [taxi()] });
  assert.equal(variablesVoucher({ paiement: p.statut, solde: p.reste, devise: "THB" }).paiement, "The remaining 300 THB will be collected in cash directly by the driver.");
  // Le bateau passe avant (le 20) et prend les 500 : rien pour le transfert, aucun montant annoncé.
  const deux = P(taxi(), { recu: 500, reservations: [tour({ date_service: "2026-12-20" }), taxi()] });
  assert.doesNotMatch(variablesVoucher({ paiement: deux.statut, solde: deux.reste, devise: "THB" }).paiement, /remaining/);
  assert.doesNotMatch(variablesVoucher({ paiement: "acompte", solde: -1650, devise: "THB" }).paiement, /remaining -/);
});

test("empreinte : chaque montant versé change l'empreinte d'un voucher sur place ; un voucher chez nous ne bouge pas (D6)", () => {
  const r = tour();
  const e = (recu, x = r, total = 0) => O.empreinteVoucher({ reservation: x, client: CLIENT, statut: O.statutEmpreinte(P(x, { recu, total, reservations: [x] })), devise: "THB" });
  const sans = e(0);
  assert.equal(sans, O.empreinteVoucher({ reservation: r, client: CLIENT, statut: "sur_place", devise: "THB" }), "sans acompte : l'empreinte d'avant (pas de faux « modifié »)");
  const vus = new Set([sans, e(1200), e(2000), e(6900)]);
  assert.equal(vus.size, 4, "1 200, 2 000 et tout payé donnent trois empreintes différentes");
  const n = nous();
  assert.equal(e(1000, n, 2000), e(2000, n, 2000), "chez nous : un paiement reçu ne change pas l'empreinte");
});

test("textes réglables : les lignes d'acompte sont dans les réglages des vouchers et de la Booking confirmation", () => {
  const cles = (g) => g.flatMap((x) => x.cles.map(([k]) => k));
  for (const k of ["montant_verse", "reste_sur_place"]) assert.ok(cles(GROUPES_VOUCHER).includes(k), k);
  for (const k of ["b_verse", "b_reste", "b_paiement_paye"]) assert.ok(cles(GROUPES_BOOKING).includes(k), k);
});

test("fiche du dossier : « À payer sur place » donne le reste après l'acompte imputé, la part imputée en dessous", async () => {
  // Services chez nous 2 400, une excursion sur place 7 450 (option comprise), 3 000 reçus : 600 imputés, 6 850 à payer au départ.
  const resume = { total: 2400, recu: 3000, surPlace: 7450, dossier: { parts: { "resa-1": { verse: 600, reste: 6850 } } } };
  assert.deepEqual(O.surPlaceApresAcompte(resume), { reste: 6850, verse: 600 });
  assert.deepEqual(O.surPlaceApresAcompte({ surPlace: 7450, dossier: { parts: {} } }), { reste: 7450, verse: 0 }, "sans acompte imputé : le prix sur place entier");
  assert.deepEqual(O.surPlaceApresAcompte({ surPlace: 7450, dossier: {} }), { reste: 7450, verse: 0 }, "résumé sans parts (base pas encore migrée)");
  assert.deepEqual(O.surPlaceApresAcompte({ surPlace: 1000, dossier: { parts: { a: { verse: 400 }, b: { verse: 800 } } } }), { reste: 0, verse: 1000 }, "jamais négatif");
  // La même règle que la base : les parts calculées par imputationDossier donnent le même reste.
  const resas = [{ id: "resa-1", paye_sur_place: true, statut: "confirme", montant_vente: 7450, date_service: "2026-12-10" }];
  const { parts } = O.imputationDossier({ total: 2400, recu: 3000, reservations: resas });
  assert.deepEqual(O.surPlaceApresAcompte({ surPlace: 7450, dossier: { parts } }), { reste: 6850, verse: 600 });
  // La fiche lit cette aide, pas r.surPlace brut, et la phrase est traduite.
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/gestion/js/views/dossier.mjs", import.meta.url), "utf8");
  assert.match(src, /surPlaceApresAcompte\(r\)/);
  assert.match(src, /ligne\(tr\("À payer sur place"\), sp\.verse > 0/);
  const en = fs.readFileSync(new URL("../src/gestion/js/i18n-en.mjs", import.meta.url), "utf8");
  assert.ok(en.includes("\"dont {montant} d'acompte déjà reçu\""));
});
