// VIP Taxi Lanta dans Gestion (12.11.2026) : mode taxi, Booking confirmation, commission du lendemain, messages types.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estTaxi, lignesSurPlace, dateBookingTexte, dateBooking, heureBooking, passagersBooking, prixBooking, champsBooking, commissionsADemander, commissionsParChauffeur, ligneCommission, varsCommissions, JOURS_COMMISSION, valeursCommission, PIED_BOOKING, lignesEnPlus } from "../src/gestion/js/taxi-calc.mjs";
import { MESSAGES_TAXI, MESSAGES_DEFAUT, MESSAGES_VOUCHER_EXCURSIONS, messagesDefautPour, completerReglages, sansSignatureFinale } from "../src/gestion/js/defauts.mjs";

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
  assert.equal(passagersBooking({ adultes: 2, enfants: 2 }, "", 2), "2 adults, 2 children (2 child seats)");
  assert.equal(passagersBooking({ adultes: 2 }, "", "x"), "2 adults", "un nombre de sièges illisible ne s'imprime pas");
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
    ["PASSENGERS", "4 adults"],
    ["LUGGAGE", "Yes"],
    ["TOTAL PRICE", "2'700 THB (all fees included)"],
  ]);
  assert.match(PIED_BOOKING.paiement_wise, /Wise with a 3% fee/);
});

test("commissions à demander : toute course passée sans commission sur 14 jours, saisies d'hier gardées, annulées écartées", () => {
  const R = [
    { id: "a", dossier_id: "d1", date_service: "2026-11-11", statut: "confirme", paye_sur_place: true },
    { id: "b", dossier_id: "d2", date_service: "2026-11-11", statut: "confirme", paye_sur_place: true, details: { commission_demandee_le: "2026-11-12" } },
    { id: "c", dossier_id: "d3", date_service: "2026-11-11", statut: "annule", paye_sur_place: true },
    // Avant-hier : la course reste (le bug du point 7 la faisait disparaître si Gestion n'était pas ouvert la veille).
    { id: "d", dossier_id: "d4", date_service: "2026-11-10", statut: "confirme", paye_sur_place: true },
    { id: "e", dossier_id: "d5", date_service: "2026-11-11", statut: "confirme", paye_sur_place: true },
    // Avant-hier avec commission saisie : À encaisser la suit, la carte ne la montre plus.
    { id: "f", dossier_id: "d6", date_service: "2026-11-09", statut: "confirme", paye_sur_place: true },
    // Il y a 14 et 15 jours : sans limite (audit du 16.11.2026, n° 46), une commission jamais demandée ne sort plus de la liste.
    { id: "g", dossier_id: "d7", date_service: "2026-10-29", statut: "confirme", paye_sur_place: true },
    { id: "h", dossier_id: "d8", date_service: "2026-10-28", statut: "confirme", paye_sur_place: true },
    // Aujourd'hui et demain : pas encore faites. Payée chez nous : aucune commission à demander.
    { id: "i", dossier_id: "d9", date_service: "2026-11-12", statut: "confirme", paye_sur_place: true },
    { id: "j", dossier_id: "d10", date_service: "2026-11-13", statut: "confirme", paye_sur_place: true },
    { id: "k", dossier_id: "d11", date_service: "2026-11-10", statut: "confirme", paye_sur_place: false },
  ];
  const nets = { b: { commission_prevue: 270, commission_recue_le: null }, f: { commission_prevue: 300, commission_recue_le: null } };
  const l = commissionsADemander(R, "2026-11-12", { ecartes: new Set(["d5"]), netDe: (r) => nets[r.id] || null });
  assert.deepEqual(l.map((x) => [x.reservation.id, x.saisie, x.montant, x.demandeLe]), [["h", false, null, null], ["g", false, null, null], ["d", false, null, null], ["a", false, null, null], ["b", true, 270, "2026-11-12"]]);
  assert.equal(JOURS_COMMISSION, null, "pas de limite par défaut");
  assert.deepEqual(commissionsADemander(R, "2026-11-12", { ecartes: new Set(["d5"]), netDe: (r) => nets[r.id] || null, jours: 14 }).map((x) => x.reservation.id), ["g", "d", "a", "b"], "une fenêtre de 14 jours réglée garde l'ancien comportement");
  assert.deepEqual(commissionsADemander(R, "2026-11-12", { jours: 3 }).map((x) => x.reservation.id), ["f", "d", "a", "b", "e"], "fenêtre réglable, sans nets tout est à saisir");
  assert.deepEqual(valeursCommission("270"), { commission_prevue: 270 });
  assert.deepEqual(valeursCommission("1'200,5", { recue: true, date: "2026-11-12" }), { commission_prevue: 1200.5, commission_recue: 1200.5, commission_recue_le: "2026-11-12" });
  assert.deepEqual(valeursCommission("0"), { commission_prevue: 0 }, "zéro : pas de commission cette fois");
  assert.equal(valeursCommission(""), null);
  assert.equal(valeursCommission("abc"), null);
  assert.equal(valeursCommission("-5"), null);
});

test("commissions : un seul message par chauffeur, qui liste ses courses encore à demander", () => {
  const x = (id, partenaire_id, extra = {}) => ({ reservation: { id, partenaire_id, date_service: "2026-11-11" }, saisie: false, demandeLe: null, ...extra });
  const g = commissionsParChauffeur([x("a", "brown"), x("b", "autre"), x("c", "brown"), x("d", "brown", { demandeLe: "2026-11-12" }), x("e", "brown", { saisie: true })]);
  assert.deepEqual(g.map((y) => [y.partenaireId, y.courses.map((c) => c.reservation.id), y.aDemander.map((c) => c.reservation.id)]), [["brown", ["a", "c", "d", "e"], ["a", "c"]], ["autre", ["b"], ["b"]]]);
  const v = varsCommissions([
    { contact: "Mr. Brown", date: "10 November 2026", prestation: "Koh Lanta → Ao Nang", client: "Noah Schmid", prix: "2,700 THB" },
    { contact: "Mr. Brown", date: "11 November 2026", prestation: "Krabi Airport → Koh Lanta", client: "Lea Moreau", prix: "" },
  ]);
  assert.deepEqual(v, { contact: "Mr. Brown", courses: "• 10 November 2026 · Koh Lanta → Ao Nang · Noah Schmid · 2,700 THB\n• 11 November 2026 · Krabi Airport → Koh Lanta · Lea Moreau" });
  assert.equal(ligneCommission({ date: "", prestation: "X", client: "", prix: "" }), "• X");
  // Le modèle groupé existe en anglais et en thaï, ne parle pas « d'hier » et liste les courses.
  for (const langue of ["en", "th"]) {
    const m = MESSAGES_TAXI.find((y) => y.cle === "commissions" && y.langue === langue && y.pour === "partenaire");
    assert.ok(m && m.corps.includes("{courses}") && m.corps.includes("{contact}"), langue);
    assert.ok(!/yesterday|เมื่อวาน/.test(m.corps + m.titre), `${langue} : pas « hier »`);
  }
});

test("messages de Taxi : les deux textes de Jérémy mot pour mot, messages à Mr. Brown en anglais et en thaï", () => {
  const de = (id) => MESSAGES_TAXI.find((m) => m.id === id);
  assert.equal(de("taxi-confirmation-en").cle, "confirmation");
  assert.ok(de("taxi-confirmation-en").corps.startsWith("Thank you for choosing {entreprise}. ✨\n\nPlease see the attached confirmation and show it to the driver at pick-up."));
  assert.ok(de("taxi-confirmation-en").corps.endsWith("Have a nice day ☀️\n{entreprise} 🌴"));
  assert.ok(de("taxi-avis-en").corps.includes("You can leave your review here:\n{lien_avis}\n"));
  assert.ok(de("taxi-avis-en").corps.endsWith("Safe travels ✨🌴\n{entreprise}"), "défaut neutre : sans le nom du partenaire (Taxi d'Anaïs a son message enregistré)");
  for (const cle of ["partenaire", "relance", "modification", "annulation", "commission"]) {
    for (const langue of ["en", "th"]) assert.ok(MESSAGES_TAXI.some((m) => m.cle === cle && m.langue === langue && m.pour === "partenaire"), `${cle} en ${langue}`);
  }
  assert.ok(!MESSAGES_TAXI.some((m) => m.langue === "fr"), "pas de français pour Taxi");
  assert.equal(new Set(MESSAGES_TAXI.map((m) => m.id)).size, MESSAGES_TAXI.length);
  assert.deepEqual(messagesDefautPour({ fonctionnement: "taxi" }).map((m) => m.id), [...MESSAGES_TAXI.map((m) => m.id), "reponse-en"], "plus la réponse à une demande");
  // Secret écrit à ses clients en anglais seulement : aucun modèle français par défaut. ZTP garde les modèles généraux.
  // Plus le message sous le voucher (22.11.2026, MESSAGES_VOUCHER_EXCURSIONS), propre aux excursions.
  // « Réponse à une demande » sans le nom de l'entreprise en dernière ligne chez Secret et Taxi (23.11.2026, aucune signature).
  assert.deepEqual(messagesDefautPour({ fonctionnement: "excursions" }), [...MESSAGES_DEFAUT.filter((m) => m.langue !== "fr").map(sansSignatureFinale), ...MESSAGES_VOUCHER_EXCURSIONS]);
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

test("numéro de vol ou de bateau : sur le lieu qui est l'aéroport ou le port, sinon sur la prise en charge", async () => {
  const { lieuxAvecVol } = await import("../src/gestion/js/taxi-calc.mjs");
  assert.deepEqual(lieuxAvecVol("Krabi Airport", "Pimalai Resort", "FD3217"), { pickup: "Krabi Airport, flight FD3217", dropoff: "Pimalai Resort" });
  assert.deepEqual(lieuxAvecVol("Pimalai Resort", "Phuket Airport", "TG 226"), { pickup: "Pimalai Resort", dropoff: "Phuket Airport, flight TG 226" });
  assert.deepEqual(lieuxAvecVol("Saladan Pier", "Krabi Town", "Tigerline"), { pickup: "Saladan Pier, boat Tigerline", dropoff: "Krabi Town" });
  assert.deepEqual(lieuxAvecVol("Hotel A", "Hotel B", "FD1"), { pickup: "Hotel A, flight FD1", dropoff: "Hotel B" });
  assert.deepEqual(lieuxAvecVol("Hotel A", "Hotel B", ""), { pickup: "Hotel A", dropoff: "Hotel B" });
  assert.deepEqual(lieuxAvecVol("Krabi Airport, flight FD3217", "Hotel B", "FD3217"), { pickup: "Krabi Airport, flight FD3217", dropoff: "Hotel B" }, "jamais deux fois");
  assert.deepEqual(lieuxAvecVol("Hotel A", "Lanta Sport Resort", "FD1"), { pickup: "Hotel A, flight FD1", dropoff: "Lanta Sport Resort" }, "« Sport » n'est pas un port");
});

test("LUGGAGE (18.11.2026) : sur sa propre ligne sous PASSENGERS, seulement s'il y a des bagages, jamais « no luggage »", async () => {
  const { bagagesBooking } = await import("../src/gestion/js/taxi-calc.mjs");
  assert.equal(bagagesBooking("3"), "3 pieces");
  assert.equal(bagagesBooking("1"), "1 piece");
  assert.equal(bagagesBooking("yes"), "Yes");
  assert.equal(bagagesBooking("2 big bags"), "2 big bags");
  for (const rien of ["", "0", "no", "none", null, undefined]) assert.equal(bagagesBooking(rien), "", String(rien));
  const base = { nom: "Varrin", date: "2026-12-25", pickup: "Suvarnabhumi Airport", heure: "10:05", dropoff: "Miami Hotel", personnes: { adultes: 2, enfants: 1 }, sieges: 1, montant: 700 };
  const avec = champsBooking({ ...base, bagages: "3", remarques: "Gate 3" }).map((c) => c.cle);
  assert.deepEqual(avec, ["NAME", "DATE", "PICK UP LOCATION", "PICK UP TIME", "DROP OFF LOCATION", "PASSENGERS", "LUGGAGE", "TOTAL PRICE", "REMARKS"]);
  const sans = champsBooking({ ...base, bagages: "" });
  assert.ok(!sans.some((c) => c.cle === "LUGGAGE"));
  assert.equal(sans.find((c) => c.cle === "PASSENGERS").valeur, "2 adults, 1 child (1 child seat)");
  assert.ok(!sans.some((c) => /luggage/i.test(c.valeur)), "jamais « no luggage »");
});

test("pied jamais coupé (18.11.2026) : la Booking confirmation se resserre à la mesure, pour l'image comme pour l'impression", async () => {
  const { readFileSync } = await import("node:fs");
  const lire = (f) => readFileSync(new URL(`../src/gestion/${f}`, import.meta.url), "utf8");
  assert.match(lire("js/views/voucher-envoi.mjs"), /ajusterBooking\(hote\);\n\s+const canvas = await html2canvas/, "mesure avant de fabriquer l'image");
  const voucher = lire("js/views/voucher.mjs");
  assert.match(voucher, /imprimer\(ajusterHorsEcran\(renderVoucher\(x\)\)/, "impression d'un voucher");
  assert.match(voucher, /imprimer\(ajusterHorsEcran\(h\("div", \{ class: "vouchers" \}/, "impression de tous les vouchers");
  const taxi = lire("js/views/voucher-taxi.mjs");
  assert.match(taxi, /const CRANS = \["vt-serre", "vt-serre-fort", "vt-serre-max", "vt-serre-ultra"\];/);
  const css = lire("css/app.css");
  for (const cran of ["vt-serre-max", "vt-serre-ultra"]) assert.match(css, new RegExp(`\\.voucher-taxi\\.${cran} \\.vt-rang \\{`), cran);
});
