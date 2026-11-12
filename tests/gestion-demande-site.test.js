// Les messages que le site secrettravelandtour.com envoie vraiment à WhatsApp (fixtures fabriquées par docs/gestion/regenerer-messages-site.mjs,
// qui exécute le code du site) doivent tous être lus par « Coller une demande ». Si le site change sa façon d'écrire un message, on régénère les
// fixtures et ce test dit ce que Gestion ne lit plus.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lireMessage, lireDemande, notesDemande, proposerOffres } from "../src/gestion/js/demande-calc.mjs";

const AJD = "2026-11-03";
const FIXTURES = JSON.parse(fs.readFileSync(new URL("./fixtures/messages-site.json", import.meta.url), "utf8"));
const message = (nom) => FIXTURES.find((f) => f.nom === nom).message;
const lire = (nom) => lireMessage(message(nom), AJD);

test("fixtures : tous les types de formulaire du site sont couverts et lus, jamais en lecture libre", () => {
  assert.ok(FIXTURES.length >= 12);
  for (const f of FIXTURES) {
    const d = lireMessage(f.message, AJD);
    assert.ok(d, `${f.nom} : non lu`);
    assert.notEqual(d.libre, true, `${f.nom} : retombé en lecture libre`);
    // Jamais de saut de ligne dans un champ lu : c'était le symptôme du bug.
    for (const [cle, v] of Object.entries(d)) if (typeof v === "string") assert.ok(!/\n/.test(v), `${f.nom} : retour à la ligne dans ${cle}`);
  }
});

test("excursion collective : prestation, option, date, adultes, enfant et âge, hôtel prénom", () => {
  const d = lire("excursion collective");
  assert.equal(d.type, "tour");
  assert.equal(d.prestation, "4 Islands");
  assert.equal(d.option, "Join-in longtail");
  assert.equal(d.mode, "join");
  assert.equal(d.date, "2026-11-04");
  assert.deepEqual([d.adultes, d.enfants, d.bebes], [2, 1, 0]);
  assert.deepEqual(d.ages, [7]);
  assert.equal(d.hotel, "Lanta Sand Resort (Klong Dao)");
  assert.equal(d.nom, "Anna");
  assert.match(d.prixSite, /Adult: 1,000 THB/);
});

test("excursion privée avec supplément : mode privé, supplément gardé, nom avec prénom et nom", () => {
  const d = lire("excursion privée avec supplément");
  assert.equal(d.mode, "private");
  assert.equal(d.extras, "Add Koh Kradan");
  assert.equal(d.nom, "Tom Lee");
  assert.equal(d.hotel, "Hotel Sunset, Klong Dao");
  assert.equal(d.enfants, 0);
});

test("excursion au départ de Krabi : plusieurs enfants, âges, départ", () => {
  const d = lire("excursion au départ de Krabi");
  assert.deepEqual([d.adultes, d.enfants, d.bebes], [3, 2, 0]);
  assert.deepEqual(d.ages, [4, 9]);
  assert.match(d.option, /from Krabi/);
  assert.match(d.depart, /Krabi/);
});

test("excursion sur mesure : lue sans prix", () => {
  const d = lire("excursion sur mesure sans prix");
  assert.equal(d.option, "Custom day");
  assert.equal(d.prixSite, "");
  assert.equal(d.adultes, 4);
});

test("trajet complet : de, vers, date, heure, vol, siège, bagages, prise en charge et dépose", () => {
  const d = lire("trajet complet");
  assert.equal(d.type, "transfer");
  assert.equal(d.de, "Krabi Airport");
  assert.equal(d.vers, "Koh Lanta");
  assert.equal(d.date, "2026-11-10");
  assert.equal(d.heure, "14:30");
  assert.equal(d.vol, "FD3xxx");
  assert.deepEqual([d.adultes, d.enfants], [2, 1]);
  assert.equal(d.siegeEnfant, true);
  assert.equal(d.bagages, 3);
  assert.equal(d.pickup, "Krabi Airport (KBV)");
  assert.equal(d.dropoff, "Lanta Sand Resort");
  assert.equal(d.hotel, "Lanta Sand Resort", "l'hôtel est le bout du trajet qui n'est pas l'aéroport");
  assert.equal(d.nom, "Anna");
});

test("trajet retour : le sens est celui du message", () => {
  const d = lire("trajet retour");
  assert.equal(d.de, "Koh Lanta");
  assert.equal(d.vers, "Krabi Airport");
  assert.equal(d.hotel, "Lanta Sand Resort");
  assert.equal(d.nom, "Ben");
});

test("trajet avec véhicule et prix du site", () => {
  const d = lire("trajet avec prix du site");
  assert.equal(d.prixSite, "From 2,300 THB per vehicle");
  assert.equal(d.nom, "Test", "le nom s'arrête à la fin de sa ligne");
  const v = lireMessage("Transfer request: Krabi Airport to Koh Lanta – Private minivan\nGuests: 1 adult\nName: A", AJD);
  assert.equal(v.vehicule, "minivan");
  assert.equal(v.mode, "private");
  const w = lireMessage("Transfer request: Krabi Airport to Koh Lanta (private minivan)\nGuests: 1 adult", AJD);
  assert.equal(w.vehicule, "minivan");
});

test("minivan partagé : marque, mode partagé, heure souhaitée", () => {
  const d = lire("minivan partagé");
  assert.equal(d.marque, "Secret Travel & Tour");
  assert.equal(d.mode, "shared");
  assert.equal(d.vehicule, "minivan");
  assert.equal(d.heure, "09:00");
  assert.equal(d.de, "Koh Lanta");
  assert.equal(d.vers, "Krabi Airport");
  assert.match(d.prixSite, /800 THB per person/);
});

test("location : catégorie, véhicule, nombre, début et fin, total estimé", () => {
  const d = lire("location de scooters");
  assert.equal(d.type, "location");
  assert.equal(d.prestation, "Scooters");
  assert.equal(d.vehiculeNom, "Honda Click 125");
  assert.equal(d.vehicules, 2);
  assert.equal(d.date, "2026-11-05");
  assert.equal(d.heure, "10:00");
  assert.equal(d.jusqua, "2026-11-08");
  assert.equal(d.nom, "Luc");
  assert.match(d.prixSite, /1,500 THB/);
  assert.equal(d.de, "", "« From: » d'une location n'est pas un trajet");
});

test("speedboat : trajet, départ, billet, retour, saison, hôtel", () => {
  const a = lire("speedboat aller simple");
  assert.equal(a.type, "transfer");
  assert.equal(a.vehicule, "speedboat");
  assert.equal(a.de, "Koh Lanta");
  assert.equal(a.vers, "Koh Phi Phi");
  assert.equal(a.heure, "08:00");
  assert.equal(a.hotel, "Hotel Sunset");
  assert.equal(a.billet, "one way");
  const r = lire("speedboat aller-retour de saison");
  assert.equal(r.billet, "return");
  assert.match(r.retour, /Wed 11 Nov 2026/);
  assert.match(r.saison, /Nov to Apr/);
  assert.deepEqual([r.adultes, r.enfants], [2, 1]);
});

test("liste de sorties : la première sortie est lue, les autres gardées dans les notes", () => {
  const d = lire("liste de sorties");
  assert.equal(d.prestation, "4 Islands");
  assert.equal(d.date, "2026-11-21");
  assert.equal(d.sorties.length, 1);
  assert.match(d.sorties[0], /Koh Rok/);
  assert.equal(d.hotel, "Hotel Sunset");
  assert.equal(d.nom, "Anna");
  assert.match(notesDemande(d), /Other trips/);
});

test("enfants et bébés : moins de 3 ans comptent comme bébés, comme dans l'ancien formulaire", () => {
  const d = lireMessage("Booking request: 4 Islands – Join-in longtail\nDate: Wed 4 Nov 2026\nGuests: 2 adults, 3 children (ages under 1, 3 and 10)\nPickup: Hotel X\nName: Z", AJD);
  assert.deepEqual([d.adultes, d.enfants, d.bebes], [2, 2, 1]);
  assert.deepEqual(d.ages, [0, 3, 10]);
});

test("notes : vol, bagages, âges, sièges et prix du site vont dans le dossier", () => {
  const n = notesDemande(lire("trajet complet"));
  assert.match(n, /Pickup time: 14:30/);
  assert.match(n, /Flight or ferry: FD3xxx/);
  assert.match(n, /Bags: 3/);
  assert.match(n, /Child seat needed/);
  assert.match(n, /Child ages: 5/);
});

test("la lecture trouve le tarif de la base d'après le libellé anglais de la prestation", () => {
  const prestations = [
    { id: "a", actif: true, famille: "excursion", libelle: "4 îles en longtail, journée", libelle_en: "4 Islands by longtail", groupe: "Excursions en groupe", prix_vente: 1000, unite: "pp", partenaire_id: "p1" },
    { id: "z", actif: true, famille: "excursion", libelle: "Koh Rok en longtail privé", libelle_en: "Koh Rok private longtail", groupe: "Privatisation", prix_vente: 6500, unite: "boat", partenaire_id: "p1" },
  ];
  const d = lire("excursion collective");
  const o = proposerOffres(d, { prestations, trajets: [], nomPartenaire: () => "" });
  assert.equal(o[0].id, "a");
});

test("ancien format du site : toujours lu à l'identique", () => {
  const d = lireDemande(["Hi Secret Travel & Tour!", "I'd like a price for a transfer.", "Name: Anna Keller", "From: Krabi Airport", "To: Koh Lanta", "Date: Fri 12 Dec 2026", "Pickup time: 14:30", "Adults: 2"].join("\n"), AJD);
  assert.equal(d.type, "transfer");
  assert.equal(d.de, "Krabi Airport");
  assert.equal(d.nom, "Anna Keller");
});

test("lecture libre : un nom ou un hôtel s'arrête à la fin de sa ligne", () => {
  const d = lireMessage("Hello, we want kayaking tomorrow for 2\nHotel Sunset, Klong Dao\nName: Test\nEstimated total: 2,000 THB", AJD);
  assert.equal(d.hotel, "Hotel Sunset, Klong Dao");
  assert.equal(d.nom, "Test");
  const e = lireMessage("My name is Anna\nPrice for kayaking tomorrow for 2 please", AJD);
  assert.equal(e.nom, "Anna");
});

test("le tarif enfant ne se propose pas seul : l'offre de tête est le tarif adulte, enfant compris dans le total", () => {
  const prestations = [
    { id: "b", actif: true, famille: "excursion", libelle: "4 îles en longtail, enfant 3 à 9 ans", libelle_en: "", groupe: "Excursions en groupe", prix_vente: 900, unite: "ch", partenaire_id: "p1" },
    { id: "a", actif: true, famille: "excursion", libelle: "4 îles en longtail, journée", libelle_en: "", groupe: "Excursions en groupe", prix_vente: 1200, unite: "pp", partenaire_id: "p1" },
  ];
  const o = proposerOffres(lire("excursion collective"), { prestations, trajets: [], nomPartenaire: () => "" });
  assert.deepEqual(o.map((x) => x.id), ["a"]);
  assert.equal(o[0].total, 2 * 1200 + 900);
});
