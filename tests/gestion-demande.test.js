import { test } from "node:test";
import assert from "node:assert/strict";
import { lireDate, lireDemande, prixPrestation, prixTrajet, proposerOffres, reponsePrix, notesDemande, separerNom } from "../src/gestion/js/demande-calc.mjs";

const AJD = "2026-11-08";

test("date : aujourd'hui, demain, date lointaine, année déduite", () => {
  assert.equal(lireDate("Today (Sun 8 Nov)", AJD), "2026-11-08");
  assert.equal(lireDate("Tomorrow (Mon 9 Nov)", AJD), "2026-11-09");
  assert.equal(lireDate("Fri 12 Dec 2026", AJD), "2026-12-12");
  assert.equal(lireDate("Wed 6 Jan", AJD), "2027-01-06");
  assert.equal(lireDate("Sat 7 Nov", AJD), "2026-11-07");
  assert.equal(lireDate("31 Nov 2026", AJD), "");
  assert.equal(lireDate("soon", AJD), "");
});

const TRANSFERT = ["Hi Secret Travel & Tour!", "I'd like a price for a transfer.", "Name: Anna Keller", "From: Krabi Airport", "To: Koh Lanta", "Date: Fri 12 Dec 2026", "Pickup time: 14:30", "Adults: 2", "Children (3-11): 1", "Babies (0-2): 1", "Child seat needed", "Shared minivan"].join("\n");

test("demande de transfert : tous les champs du formulaire", () => {
  const d = lireDemande(TRANSFERT, AJD);
  assert.deepEqual({ ...d }, { marque: "Secret Travel & Tour", type: "transfer", nom: "Anna Keller", prestation: "", de: "Krabi Airport", vers: "Koh Lanta", date: "2026-12-12", dateTexte: "Fri 12 Dec 2026", heure: "14:30", adultes: 2, enfants: 1, bebes: 1, vehicule: "minivan", mode: "shared", siegeEnfant: true, siegeBebe: false, hotel: "" });
});

test("demande de bateau et d'activité, avec l'hôtel", () => {
  const b = lireDemande(["Hi Secret Travel & Tour!", "I'm interested in a boat tour: 4 Islands.", "Name: Tom", "Date: Tomorrow (Mon 9 Nov)", "Adults: 3", "Join-in trip", "Hotel or accommodation: Hotel Sunset, Klong Dao"].join("\n"), AJD);
  assert.equal(b.type, "boat");
  assert.equal(b.prestation, "4 Islands");
  assert.equal(b.mode, "join");
  assert.equal(b.date, "2026-11-09");
  assert.equal(b.hotel, "Hotel Sunset, Klong Dao");
  const a = lireDemande("Hi Secret Travel & Tour!\nI'm interested in an activity: Kayaking.\nPeople: 4", AJD);
  assert.equal(a.type, "activity");
  assert.equal(a.adultes, 4);
});

test("demande de taxi : marque VIP Taxi Lanta, speedboat", () => {
  const d = lireDemande("Hi VIP Taxi Lanta!\nI'd like a price for a transfer.\nFrom: Koh Lanta\nTo: Phuket Airport\nAdults: 1\nPrivate minivan", AJD);
  assert.equal(d.marque, "VIP Taxi Lanta");
  assert.equal(d.vehicule, "minivan");
  assert.equal(d.mode, "private");
  assert.equal(lireDemande("Private speedboat\nFrom: A\nTo: B", AJD).vehicule, "speedboat");
});

test("un texte qui n'est pas une demande est refusé", () => {
  assert.equal(lireDemande("", AJD), null);
  assert.equal(lireDemande("Bonjour, vous êtes ouverts demain ?", AJD), null);
});

const TRAJETS = [
  { id: "t1", actif: true, de: "Krabi Airport", vers: "Koh Lanta", depart: "14:30", mode: "Van partagé", prix_adulte: 500, prix_enfant: 300, partenaire_id: "p1" },
  { id: "t2", actif: true, de: "Koh Lanta", vers: "Koh Lipe", depart: "10:30", mode: "Speedboat", prix_adulte: 1800, prix_enfant: null, partenaire_id: "p2" },
  { id: "t3", actif: false, de: "Krabi Airport", vers: "Koh Lanta", depart: "09:00", mode: "Van partagé", prix_adulte: 1, prix_enfant: 1 },
];
const PRESTATIONS = [
  { id: "x1", actif: true, famille: "excursion", libelle: "4 îles en longtail, journée", libelle_en: "4 Islands by longtail", groupe: "Join tour", prix_vente: 1200, unite: "pp", partenaire_id: "p1" },
  { id: "x2", actif: true, famille: "excursion", libelle: "4 îles en bateau privé", libelle_en: "4 Islands private boat", groupe: "Private", prix_vente: 9000, unite: "boat", partenaire_id: "p1" },
  { id: "x3", actif: true, famille: "activite", libelle: "Kayak", libelle_en: "Kayaking", groupe: "", prix_vente: 600, unite: "pp" },
  { id: "x4", actif: true, famille: "transfert", libelle: "Taxi privé Koh Lanta → Phuket Airport", libelle_en: "Private taxi Koh Lanta to Phuket Airport", groupe: "", prix_vente: 4500, unite: "veh" },
];
const nom = (id) => ({ p1: "Longtail démo", p2: "Speed démo" })[id] || "";

test("prix : par personne, par bateau, bébés gratuits, tarif enfant manquant", () => {
  assert.equal(prixPrestation(PRESTATIONS[0], { adultes: 2, enfants: 1 }), 3600);
  assert.equal(prixPrestation(PRESTATIONS[1], { adultes: 2, enfants: 1 }), 9000);
  assert.equal(prixPrestation({ ...PRESTATIONS[0], sur_place: true }, { adultes: 1, enfants: 0 }), null);
  assert.deepEqual(prixTrajet(TRAJETS[0], { adultes: 2, enfants: 1 }), { total: 1300, avertissement: "" });
  assert.deepEqual(prixTrajet(TRAJETS[1], { adultes: 2, enfants: 1 }), { total: 3600, avertissement: "sans_tarif_enfant" });
});

test("offres : le transfert demandé trouve son trajet actif et son prix", () => {
  const d = lireDemande(TRANSFERT, AJD);
  const o = proposerOffres(d, { prestations: PRESTATIONS, trajets: TRAJETS, nomPartenaire: nom });
  assert.equal(o[0].id, "t1");
  assert.equal(o[0].total, 1300);
  assert.ok(!o.some((x) => x.id === "t3"), "un trajet inactif n'est jamais proposé");
});

test("offres : le trajet dans l'autre sens est proposé après le sens direct", () => {
  const d = lireDemande("Hi Secret Travel & Tour!\nI'd like a price for a transfer.\nFrom: Koh Lanta\nTo: Krabi Airport\nAdults: 1", AJD);
  const o = proposerOffres(d, { prestations: [], trajets: TRAJETS, nomPartenaire: nom });
  assert.equal(o[0].id, "t1");
});

test("offres : la speedboat demandée écarte le van, la prestation taxi est trouvée par ses mots", () => {
  const d = lireDemande("Hi VIP Taxi Lanta!\nI'd like a price for a transfer.\nFrom: Koh Lanta\nTo: Phuket Airport\nAdults: 2\nPrivate minivan", AJD);
  const o = proposerOffres(d, { prestations: PRESTATIONS, trajets: TRAJETS, nomPartenaire: nom });
  assert.equal(o[0].id, "x4");
  assert.equal(o[0].total, 4500);
  const lipe = lireDemande("From: Koh Lanta\nTo: Koh Lipe\nPrivate speedboat\nAdults: 1", AJD);
  assert.equal(proposerOffres(lipe, { trajets: TRAJETS, prestations: [], nomPartenaire: nom })[0].id, "t2");
});

test("offres : excursion par ses mots anglais, collectif ou privé selon la demande", () => {
  const join = lireDemande("I'm interested in a boat tour: 4 Islands.\nAdults: 3\nJoin-in trip", AJD);
  const o = proposerOffres(join, { prestations: PRESTATIONS, trajets: [], nomPartenaire: nom });
  assert.equal(o[0].id, "x1");
  assert.equal(o[0].total, 3600);
  const priv = lireDemande("I'm interested in a boat tour: 4 Islands.\nAdults: 3\nPrivate boat", AJD);
  assert.equal(proposerOffres(priv, { prestations: PRESTATIONS, trajets: [], nomPartenaire: nom })[0].id, "x2");
  assert.equal(proposerOffres(lireDemande("I'm interested in an activity: Kayaking.\nPeople: 2", AJD), { prestations: PRESTATIONS, trajets: [], nomPartenaire: nom })[0].id, "x3");
});

test("offres : rien dans la base, aucune proposition inventée", () => {
  const d = lireDemande("I'm interested in an activity: Paragliding.\nPeople: 2", AJD);
  assert.deepEqual(proposerOffres(d, { prestations: PRESTATIONS, trajets: TRAJETS, nomPartenaire: nom }), []);
});

test("réponse : ce qui est demandé, le prix de la base, la question", () => {
  const d = lireDemande(TRANSFERT, AJD);
  const o = proposerOffres(d, { prestations: [], trajets: TRAJETS, nomPartenaire: nom })[0];
  const t = reponsePrix(d, o, { devise: "THB" });
  assert.match(t, /^Hello Anna,/);
  assert.match(t, /Krabi Airport → Koh Lanta, 14:30/);
  assert.match(t, /Date: 12 December 2026/);
  assert.match(t, /Price: THB 1,300/);
  assert.match(t, /Would you like me to book it\?$/);
  assert.ok(!/undefined|null|NaN/.test(t));
});

test("réponse sans prix ni nom : pas de ligne vide de sens", () => {
  const t = reponsePrix({ nom: "", date: "", heure: "", adultes: 1, enfants: 0, bebes: 0 }, { titre: "Kayaking", total: null }, { devise: "THB" });
  assert.match(t, /^Hello,/);
  assert.ok(!/Price:/.test(t));
});

test("notes du dossier et séparation du nom", () => {
  assert.equal(notesDemande(lireDemande(TRANSFERT, AJD)), "Pickup time: 14:30. Child seat needed. Babies (0-2): 1");
  assert.deepEqual(separerNom("Anna Keller"), { prenom: "Anna", nom: "Keller" });
  assert.deepEqual(separerNom("Anna van der Berg"), { prenom: "Anna", nom: "van der Berg" });
  assert.deepEqual(separerNom("Madonna"), { prenom: "", nom: "Madonna" });
});

test("offres : un minivan demandé n'est jamais proposé en speedboat", () => {
  const d = lireDemande("From: Koh Lanta\nTo: Koh Lipe\nPrivate minivan\nAdults: 1", AJD);
  assert.deepEqual(proposerOffres(d, { trajets: TRAJETS, prestations: [], nomPartenaire: nom }), []);
});
