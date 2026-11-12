// VIP Taxi Lanta dans Gestion (12.11.2026) : mode taxi, Booking confirmation, commission du lendemain, messages types.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estTaxi, lignesSurPlace, dateBookingTexte, dateBooking, heureBooking, passagersBooking, prixBooking, champsBooking, commissionsADemander, valeursCommission, PIED_BOOKING, lignesEnPlus } from "../src/gestion/js/taxi-calc.mjs";
import { MESSAGES_TAXI, MESSAGES_DEFAUT, messagesDefautPour, completerReglages } from "../src/gestion/js/defauts.mjs";

test("mode taxi : réglé par l'entreprise, toutes les lignes payées au chauffeur", () => {
  assert.equal(estTaxi({ fonctionnement: "taxi" }), true);
  assert.equal(estTaxi({ fonctionnement: "excursions" }), false);
  assert.equal(estTaxi(completerReglages({})), false, "une entreprise neuve reste en voyages sur mesure");
  const l = lignesSurPlace([{ kind: "ligne", libelle: "A" }, { kind: "texte", libelle: "note" }, { kind: "ligne", paye_sur_place: false }]);
  assert.deepEqual(l.map((x) => x.paye_sur_place), [true, undefined, true]);
});

test("Booking confirmation : date, heure, passagers et prix comme sur le modèle d'Anaïs", () => {
  assert.equal(dateBookingTexte("2026-11-12"), "November 12th 2026");
  assert.deepEqual(dateBooking("2026-11-01"), { mois: "November", jour: "1", suffixe: "st", annee: "2026" });
  assert.equal(dateBookingTexte("2026-11-22"), "November 22nd 2026");
  assert.equal(dateBookingTexte("2026-11-13"), "November 13th 2026");
  assert.equal(dateBookingTexte(""), "");
  assert.equal(heureBooking("11:00"), "11 am");
  assert.equal(heureBooking("14:30"), "2:30 pm");
  assert.equal(heureBooking("12:00"), "12 pm");
  assert.equal(heureBooking("00:15"), "12:15 am");
  assert.equal(heureBooking("9h45"), "9:45 am");
  assert.equal(heureBooking("after the ferry"), "after the ferry", "un texte libre reste tel quel");
  assert.equal(passagersBooking({ adultes: 4 }, "oui"), "4 adults + luggage");
  assert.equal(passagersBooking({ adultes: 2, enfants: 1, bebes: 1 }, "3"), "2 adults, 1 child, 1 baby + 3 pieces of luggage");
  assert.equal(passagersBooking({ adultes: 1 }, ""), "1 adult");
  assert.equal(prixBooking(2700, "THB"), "2'700 THB (all fees included)");
  assert.equal(prixBooking(15000.5, "THB"), "15'000.50 THB (all fees included)");
  assert.equal(prixBooking(null), "", "sans prix, la ligne reste à remplir");
  const champs = champsBooking({ nom: "Maxime Kremer", date: "2026-11-12", pickup: "Venice Krabi Villa Resort", heure: "11:00", dropoff: "Moonlight Bay Resort", personnes: { adultes: 4 }, bagages: "oui", montant: 2700 });
  assert.deepEqual(champs.map((c) => [c.cle, c.valeur]), [
    ["NAME", "Maxime Kremer"],
    ["DATE", "November 12th 2026"],
    ["PICK UP LOCATION", "Venice Krabi Villa Resort"],
    ["PICK UP TIME", "11 am"],
    ["DROP OFF LOCATION", "Moonlight Bay Resort"],
    ["PASSENGERS", "4 adults + luggage"],
    ["TOTAL PRICE", "2'700 THB (all fees included)"],
  ]);
  assert.match(PIED_BOOKING.paiement_wise, /Wise with a 3% fee/);
});

test("commission du lendemain : courses d'hier sur place, saisie ou non, annulées écartées", () => {
  const R = [
    { id: "a", dossier_id: "d1", date_service: "2026-11-11", statut: "confirme", paye_sur_place: true },
    { id: "b", dossier_id: "d2", date_service: "2026-11-11", statut: "confirme", paye_sur_place: true, details: { commission_demandee_le: "2026-11-12" } },
    { id: "c", dossier_id: "d3", date_service: "2026-11-11", statut: "annule", paye_sur_place: true },
    { id: "d", dossier_id: "d4", date_service: "2026-11-10", statut: "confirme", paye_sur_place: true },
    { id: "e", dossier_id: "d5", date_service: "2026-11-11", statut: "confirme", paye_sur_place: true },
  ];
  const nets = { b: { commission_prevue: 270, commission_recue_le: null } };
  const l = commissionsADemander(R, "2026-11-11", { ecartes: new Set(["d5"]), netDe: (r) => nets[r.id] || null });
  assert.deepEqual(l.map((x) => [x.reservation.id, x.saisie, x.montant, x.demandeLe]), [["a", false, null, null], ["b", true, 270, "2026-11-12"]]);
  assert.deepEqual(valeursCommission("270"), { commission_prevue: 270 });
  assert.deepEqual(valeursCommission("1'200,5", { recue: true, date: "2026-11-12" }), { commission_prevue: 1200.5, commission_recue: 1200.5, commission_recue_le: "2026-11-12" });
  assert.deepEqual(valeursCommission("0"), { commission_prevue: 0 }, "zéro : pas de commission cette fois");
  assert.equal(valeursCommission(""), null);
  assert.equal(valeursCommission("abc"), null);
  assert.equal(valeursCommission("-5"), null);
});

test("messages de Taxi : les deux textes de Jérémy mot pour mot, messages à Mr. Brown en anglais et en thaï", () => {
  const de = (id) => MESSAGES_TAXI.find((m) => m.id === id);
  assert.equal(de("taxi-confirmation-en").cle, "confirmation");
  assert.ok(de("taxi-confirmation-en").corps.startsWith("Thank you for choosing VIP TAXI LANTA. ✨\n\nPlease see the attached confirmation and show it to the driver at pick-up."));
  assert.ok(de("taxi-confirmation-en").corps.endsWith("Have a nice day ☀️\nVIP TAXI LANTA 🌴"));
  assert.ok(de("taxi-avis-en").corps.includes("You can leave your review here:\n{lien_avis}\n"));
  assert.ok(de("taxi-avis-en").corps.endsWith("Safe travels ✨🌴\nVIP TAXI LANTA by Mr. Brown"));
  for (const cle of ["partenaire", "relance", "modification", "annulation", "commission"]) {
    for (const langue of ["en", "th"]) assert.ok(MESSAGES_TAXI.some((m) => m.cle === cle && m.langue === langue && m.pour === "partenaire"), `${cle} en ${langue}`);
  }
  assert.ok(!MESSAGES_TAXI.some((m) => m.langue === "fr"), "pas de français pour Taxi");
  assert.equal(new Set(MESSAGES_TAXI.map((m) => m.id)).size, MESSAGES_TAXI.length);
  assert.deepEqual(messagesDefautPour({ fonctionnement: "taxi" }).map((m) => m.id), [...MESSAGES_TAXI.map((m) => m.id), "reponse-en"], "plus la réponse à une demande");
  // Secret écrit à ses clients en anglais seulement : aucun modèle français par défaut. ZTP garde les modèles généraux.
  assert.deepEqual(messagesDefautPour({ fonctionnement: "excursions" }), MESSAGES_DEFAUT.filter((m) => m.langue !== "fr"));
  assert.ok(!messagesDefautPour({ fonctionnement: "excursions" }).some((m) => m.langue === "fr"));
  assert.equal(messagesDefautPour({ fonctionnement: "sur_mesure" }), MESSAGES_DEFAUT);
});

test("prix interne d'une course : il suit la date, le prix et le paiement au chauffeur, sans toucher au reste", async () => {
  const { contenuCourse } = await import("../src/gestion/js/taxi-calc.mjs");
  const contenu = { lignes: [{ id: "l1", kind: "ligne", unite: 2300, qte: 1, date_service: "2026-11-20", paye_sur_place: true }, { id: "n", kind: "texte", libelle: "note" }] };
  const r = { ligne_id: "l1", montant_vente: 2700, date_service: "2026-11-21" };
  const suite = contenuCourse(contenu, r);
  assert.deepEqual(suite.lignes[0], { id: "l1", kind: "ligne", unite: 2700, qte: 1, date_service: "2026-11-21", paye_sur_place: true });
  assert.equal(suite.lignes[1].libelle, "note");
  assert.equal(contenuCourse(suite, r), null, "rien ne change : pas d'écriture");
  assert.equal(contenuCourse(contenu, { ligne_id: "autre" }), null, "course absente du document");
  const sansPrix = contenuCourse(contenu, { ligne_id: "l1", montant_vente: null, date_service: "2026-11-22" });
  assert.equal(sansPrix.lignes[0].unite, 2300, "sans prix saisi, l'ancien reste");
});

test("course saisie à la main : une ligne payée au chauffeur au prix de la course", async () => {
  const { ligneCourse } = await import("../src/gestion/js/taxi-calc.mjs");
  const l = ligneCourse({ libelle: "Private minivan: Koh Lanta → Trang", montant_vente: 3000, date_service: "2026-11-20", partenaire_id: "p" }, "x");
  assert.deepEqual([l.id, l.kind, l.unite, l.qte, l.date_service, l.paye_sur_place], ["x", "ligne", 3000, 1, "2026-11-20", true]);
  assert.equal(ligneCourse({ libelle: "A" }, "y").unite, 0, "sans prix : zéro, à compléter");
});

test("réglages de Taxi complets sans informations de paiement ni conditions", async () => {
  const { reglagesIncomplets } = await import("../src/gestion/js/defauts.mjs");
  const r = completerReglages({ fonctionnement: "taxi", devise: "THB", emetteur: { nom: "VIP Taxi Lanta", adresse: "Koh Lanta, Krabi, Thailand", contact: "+66 95 868 38 46" } });
  assert.deepEqual(reglagesIncomplets(r), []);
  assert.ok(reglagesIncomplets({ ...r, fonctionnement: "excursions" }).length > 0);
});

test("demande collée : « Transfer request: » du site va à Taxi, pas le minivan partagé ni le speedboat", async () => {
  const { demandeDeTaxi, entrepriseTaxi } = await import("../src/gestion/js/taxi-calc.mjs");
  const { lireMessage } = await import("../src/gestion/js/demande-calc.mjs");
  const fixtures = JSON.parse((await import("node:fs")).readFileSync(new URL("./fixtures/messages-site.json", import.meta.url), "utf8"));
  const liste = Array.isArray(fixtures) ? fixtures : fixtures.messages;
  for (const f of liste) {
    const d = lireMessage(f.message, "2026-11-08");
    assert.equal(demandeDeTaxi(f.message, d), /^Transfer request:/.test(f.message), f.nom);
  }
  assert.equal(demandeDeTaxi("Transfer request: A to B", null), false);
  const E = [{ id: "s", nom: "Secret" }, { id: "t", nom: "VIP Taxi Lanta" }];
  const R = { s: { fonctionnement: "excursions" }, t: { fonctionnement: "taxi" } };
  assert.equal(entrepriseTaxi(E, (id) => R[id], "s").id, "t");
  assert.equal(entrepriseTaxi(E, (id) => R[id], "t"), null, "déjà dans Taxi");
  assert.equal(entrepriseTaxi([E[0]], (id) => R[id], "s"), null, "Taxi inaccessible");
});

test("Booking confirmation : une valeur trop longue compte ses lignes en plus, pour resserrer la page pleine", () => {
  assert.equal(lignesEnPlus(["Emma Wilson", "Krabi Airport", ""]), 0);
  assert.equal(lignesEnPlus(["Pimalai Resort & Spa, Kantiang Bay, Koh Lanta Yai"]), 1);
  assert.equal(lignesEnPlus(["x".repeat(80), "y".repeat(40)]), 3);
});
