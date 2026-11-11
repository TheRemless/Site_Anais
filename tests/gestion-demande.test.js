import { test } from "node:test";
import assert from "node:assert/strict";
import { lireDate, lireDemande, lireMessage, lireDateLibre, proposerOffresLibres, offresPour, clientsProches, prestationEnfant, prixPrestation, prixTrajet, proposerOffres, reponsePrix, notesDemande, separerNom } from "../src/gestion/js/demande-calc.mjs";

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

// ---- Message libre (WhatsApp, sans formulaire) ----------------------------------------------------------------------
test("date libre : jour et mois dans les deux ordres, français, demain, jj/mm", () => {
  assert.equal(lireDateLibre("on 12 December", AJD), "2026-12-12");
  assert.equal(lireDateLibre("December 12th please", AJD), "2026-12-12");
  assert.equal(lireDateLibre("le 3 janvier", AJD), "2027-01-03");
  assert.equal(lireDateLibre("le 15 août 2027", AJD), "2027-08-15");
  assert.equal(lireDateLibre("demain", AJD), "2026-11-09");
  assert.equal(lireDateLibre("tomorrow morning", AJD), "2026-11-09");
  assert.equal(lireDateLibre("après-demain", AJD), "2026-11-10");
  assert.equal(lireDateLibre("le 20/12", AJD), "2026-12-20");
  assert.equal(lireDateLibre("20/12/2026", AJD), "2026-12-20");
  assert.equal(lireDateLibre("31/02", AJD), "");
  assert.equal(lireDateLibre("2 adults 1 child", AJD), "");
  assert.equal(lireDateLibre("room 12 may be fine", AJD), "");
});

const LIBRE = "Hello! My name is Sophie Martin, we would like to do the 4 islands tour on 12 December. We are 2 adults and 1 child, staying at Hotel Sunset, Klong Dao. My number is +33 6 12 34 56 78";

test("message libre : nom, date, personnes, hôtel et téléphone", () => {
  const d = lireMessage(LIBRE, AJD);
  assert.equal(d.libre, true);
  assert.equal(d.nom, "Sophie Martin");
  assert.equal(d.date, "2026-12-12");
  assert.equal(d.adultes, 2);
  assert.equal(d.enfants, 1);
  assert.equal(d.hotel, "Hotel Sunset, Klong Dao");
  assert.equal(d.telephone, "+33 6 12 34 56 78");
});

test("message libre en français", () => {
  const d = lireMessage("Bonjour, nous sommes 4 personnes dont 2 enfants, on loge à l'hôtel Bamboo et on voudrait le tour des 4 îles demain. Marc Dupont", AJD);
  assert.equal(d.adultes, 2, "4 personnes dont 2 enfants : deux adultes");
  assert.equal(d.enfants, 2);
  assert.equal(d.date, "2026-11-09");
  assert.equal(d.hotel, "hôtel Bamboo");
});

test("message libre : « for 3 » et « 3 pax » donnent des adultes, un message sans rien est refusé", () => {
  assert.equal(lireMessage("price for 3 for kayaking tomorrow", AJD).adultes, 3);
  assert.equal(lireMessage("kayak 3 pax", AJD).adultes, 3);
  assert.equal(lireMessage("", AJD), null);
  assert.equal(lireMessage("ok merci", AJD), null);
});

test("message structuré : lireMessage renvoie la lecture du formulaire", () => {
  const d = lireMessage(TRANSFERT, AJD);
  assert.equal(d.libre, undefined);
  assert.equal(d.type, "transfer");
});

test("offres libres : l'excursion citée dans la phrase est trouvée, avec son prix", () => {
  const d = lireMessage(LIBRE, AJD);
  const o = offresPour(d, LIBRE, { prestations: PRESTATIONS, trajets: TRAJETS, nomPartenaire: nom });
  assert.equal(o[0].id, "x1");
  assert.equal(o[0].total, 3600);
});

test("offres libres : un trajet cité dans la phrase, dans le bon sens", () => {
  const t = "Hi, we need a taxi from Krabi airport to Koh Lanta on 12 December, 2 people";
  const d = lireMessage(t, AJD);
  assert.equal(d.adultes, 2);
  const o = offresPour(d, t, { prestations: [], trajets: TRAJETS, nomPartenaire: nom });
  assert.equal(o[0].id, "t1");
  assert.equal(o[0].total, 1000);
});

test("offres libres : rien de reconnu dans la base, rien d'inventé", () => {
  assert.deepEqual(proposerOffresLibres({ adultes: 2, enfants: 0 }, "we want to go paragliding", { prestations: PRESTATIONS, trajets: TRAJETS, nomPartenaire: nom }), []);
});

test("offres libres : un seul mot commun comme « tour » ne suffit pas", () => {
  assert.deepEqual(proposerOffresLibres({ adultes: 1, enfants: 0 }, "do you have a tour tomorrow?", { prestations: PRESTATIONS, trajets: [], nomPartenaire: nom }), []);
});

const CLIENTS = [
  { id: "c1", prenom: "Sophie", nom: "Martin", telephone: "+33 6 12 34 56 78" },
  { id: "c2", prenom: "Anna", nom: "Keller", telephone: "+49 160 0000000" },
  { id: "c3", prenom: "Sophie", nom: "Marti", telephone: "" },
];

test("clients proches : même téléphone d'abord, puis même nom", () => {
  assert.deepEqual(clientsProches({ nom: "Autre Nom", telephone: "0033612345678" }, CLIENTS).map((x) => x.client.id), ["c1"]);
  assert.deepEqual(clientsProches({ nom: "sophie martin", telephone: "" }, CLIENTS).map((x) => [x.client.id, x.raison]), [["c1", "nom"]]);
  assert.deepEqual(clientsProches({ nom: "Zoe Zed", telephone: "" }, CLIENTS), []);
  assert.deepEqual(clientsProches({ nom: "", telephone: "" }, CLIENTS), []);
});

test("offres libres : le lieu de l'hôtel ne fait pas trouver un trajet, les frais de parc et tarifs enfant ne sont jamais proposés seuls", () => {
  const prestations = [
    { id: "a", actif: true, famille: "excursion", libelle: "4 îles en longtail, journée", libelle_en: "", groupe: "Excursions en groupe", prix_vente: 1200, unite: "pp" },
    { id: "b", actif: true, famille: "excursion", libelle: "4 îles en longtail, enfant 3 à 9 ans", libelle_en: "", groupe: "Excursions en groupe", prix_vente: 900, unite: "ch" },
    { id: "c", actif: true, famille: "frais", libelle: "4 îles", libelle_en: "", groupe: "Frais de parc national", prix_vente: 200, unite: "ad", sur_place: true },
    { id: "d", actif: true, famille: "transfert", libelle: "Saladan → Klong Dao", libelle_en: "", groupe: "Taxi local", prix_vente: 80, unite: "pp" },
  ];
  const texte = "My name is Sophie Martin, 4 islands tour on 12 December, 2 adults, staying at Hotel Sunset, Klong Dao";
  const d = lireMessage(texte, AJD);
  assert.deepEqual(offresPour(d, texte, { prestations, trajets: [], nomPartenaire: nom }).map((o) => o.id), ["a"]);
});

test("prix avec enfants : tarif enfant de la base, sinon tarif adulte avec avertissement", () => {
  const prestations = [
    { id: "a", actif: true, famille: "excursion", libelle: "4 îles en longtail, journée", libelle_en: "", groupe: "Excursions en groupe", prix_vente: 1200, unite: "pp", partenaire_id: "p1" },
    { id: "b", actif: true, famille: "excursion", libelle: "4 îles en longtail, enfant 3 à 9 ans", libelle_en: "", groupe: "Excursions en groupe", prix_vente: 900, unite: "ch", partenaire_id: "p1" },
    { id: "k", actif: true, famille: "activite", libelle: "Kayak", libelle_en: "Kayaking", groupe: "", prix_vente: 600, unite: "pp", partenaire_id: "p2" },
  ];
  assert.equal(prestationEnfant(prestations[0], prestations).id, "b");
  const texte = "4 islands tour, 2 adults and 1 child";
  const o = offresPour(lireMessage(texte, AJD), texte, { prestations, trajets: [], nomPartenaire: nom });
  assert.equal(o[0].total, 3300);
  assert.equal(o[0].enfant.id, "b");
  const k = offresPour(lireMessage("kayaking, 2 adults 1 child", AJD), "kayaking, 2 adults 1 child", { prestations, trajets: [], nomPartenaire: nom });
  assert.equal(k[0].total, 1800);
  assert.equal(k[0].avertissement, "enfant_plein_tarif");
});

test("message libre : signature après une formule de politesse, pas un lieu en fin de message", () => {
  assert.equal(lireMessage("On voudrait le tour des 4 îles demain. Merci, Marc Dupont +41 79 123 45 67", AJD).nom, "Marc Dupont");
  assert.equal(lireMessage("Hi, we need kayaking tomorrow for 2, staying at Hotel Sunset, Klong Dao", AJD).nom, "");
  assert.equal(lireMessage("Hi, we need kayaking tomorrow for 2.\nAnna Keller", AJD).nom, "Anna Keller");
});

test("offres libres : un nom court n'abîme pas les autres mots du message", () => {
  const prestations = [{ id: "a", actif: true, famille: "excursion", libelle: "Tomorrow Special tour kayak", libelle_en: "", groupe: "", prix_vente: 100, unite: "pp" }];
  const texte = "I'm Tom, kayak tomorrow special";
  const d = { ...lireMessage(texte, AJD), nom: "Tom" };
  assert.equal(offresPour(d, texte, { prestations, trajets: [], nomPartenaire: nom }).length, 1);
});
