// Fabrique les messages que le site secrettravelandtour.com envoie vraiment à WhatsApp, en exécutant son code (src/js/booking.js), et les écrit dans
// tests/fixtures/messages-site.json. Le test gestion-demande-site.test.js vérifie que « Coller une demande » les lit tous.
// À relancer quand le site change sa façon d'écrire un message :
//   node docs/gestion/regenerer-messages-site.mjs ~/Desktop/Secrettravelandtour/src/js/booking.js
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const chemin = path.resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("Donnez le chemin de src/js/booking.js du dépôt du site.");
const B = createRequire(import.meta.url)(chemin);
const TODAY = "2026-11-03";
const etat = (config, sur) => Object.assign(B.emptyState(config), { today: TODAY }, sur);

const TOUR = { variant: "tour", brand: "Secret Travel & Tour", product: "4 Islands", productId: "4-islands", options: [
  { id: "join-in-longtail", title: "Join-in longtail", rows: [{ label: "Adult", price: "1,000 THB" }, { label: "Child, 4 to 11", price: "600 THB" }] },
  { id: "private-longtail", title: "Private longtail", rows: [{ label: "1 to 2 people", price: "5,900 THB" }, { label: "Add Koh Kradan", price: "+500 THB", tick: true }] },
  { id: "from-krabi", title: "Join-in speedboat from Krabi", departure: "Krabi", rows: [{ label: "Adult", price: "1,800 THB" }] },
  { id: "on-request", title: "Custom day", rows: [] },
] };
const TAXI = { variant: "taxi", brand: "VIP Taxi Lanta", product: "Krabi Airport to Koh Lanta", productId: "taxi-krabi-airport-koh-lanta", from: "Krabi Airport", to: "Koh Lanta" };
const PARTAGE = { variant: "taxi", shared: true, brand: "Secret Travel & Tour", product: "Koh Lanta to Krabi Airport", productId: "shared-koh-lanta-krabi", from: "Koh Lanta", to: "Krabi Airport", priceNote: "From 800 THB per person" };
const LOCATION = { variant: "rental", brand: "Secret Travel & Tour", product: "Scooter rental", productId: "scooter", options: [
  { id: "scooters", title: "Scooters", rows: [{ label: "Honda Click 125", price: "250 THB", amount: 250, unit: "per 24 hours" }, { label: "Honda PCX 160", price: "350 THB", amount: 350, unit: "per 24 hours" }] },
] };
const BATEAU = { variant: "speedboat", brand: "Secret Travel & Tour", product: "Speedboat", productId: "speedboat", routes: [
  { id: "lanta-phi-phi", label: "Koh Lanta to Koh Phi Phi", back: "phi-phi-lanta", deps: [{ id: "d1", time: "08:00", arrives: "09:30" }, { id: "d2", time: "11:30", arrives: "13:00", season: "Nov to Apr" }] },
  { id: "phi-phi-lanta", label: "Koh Phi Phi to Koh Lanta", back: "lanta-phi-phi", deps: [{ id: "r1", time: "15:00", arrives: "16:30" }] },
] };
const CATALOGUE = { "4-islands": TOUR, "koh-rok": Object.assign({}, TOUR, { name: undefined, product: "Koh Rok" }) };
for (const [slug, p] of Object.entries(CATALOGUE)) p.name = p.product;

const scenarios = [
  ["excursion collective", "tour", B.buildMessage(TOUR, etat(TOUR, { option: "join-in-longtail", dateChoice: "other", dateOther: "2026-11-04", adults: 2, childAges: [7], pickup: "Lanta Sand Resort (Klong Dao)", name: "Anna" }))],
  ["excursion privée avec supplément", "tour", B.buildMessage(TOUR, etat(TOUR, { option: "private-longtail", dateChoice: "other", dateOther: "2026-11-12", adults: 2, childAges: [], addons: ["Add Koh Kradan"], pickup: "Hotel Sunset, Klong Dao", name: "Tom Lee" }))],
  ["excursion au départ de Krabi", "tour", B.buildMessage(TOUR, etat(TOUR, { option: "from-krabi", dateChoice: "other", dateOther: "2026-11-15", adults: 3, childAges: [4, 9], pickup: "Centara Krabi", name: "Marie" }))],
  ["excursion sur mesure sans prix", "tour", B.buildMessage(TOUR, etat(TOUR, { option: "on-request", dateChoice: "other", dateOther: "2026-11-20", adults: 4, childAges: [], pickup: "Lanta Castaway", name: "Paul" }))],
  ["trajet complet", "taxi", B.buildMessage(TAXI, etat(TAXI, { direction: "out", dateChoice: "other", dateOther: "2026-11-10", time: "14:30", flight: "FD3xxx", adults: 2, childAges: [5], childSeats: 1, bags: 3, pickupAt: "Krabi Airport (KBV)", dropoffAt: "Lanta Sand Resort", name: "Anna" }))],
  ["trajet retour", "taxi", B.buildMessage(TAXI, etat(TAXI, { direction: "back", dateChoice: "other", dateOther: "2026-11-18", adults: 1, childAges: [], pickupAt: "Lanta Sand Resort", dropoffAt: "Krabi Airport (KBV)", name: "Ben" }))],
  ["trajet avec prix du site", "taxi", B.buildMessage(Object.assign({}, TAXI, { priceNote: "From 2,300 THB per vehicle" }), etat(TAXI, { direction: "out", dateChoice: "other", dateOther: "2026-11-10", adults: 2, childAges: [], pickupAt: "Krabi Airport (KBV)", dropoffAt: "Lanta Sand Resort", name: "Test" }))],
  ["minivan partagé", "taxi", B.buildMessage(PARTAGE, etat(PARTAGE, { direction: "out", dateChoice: "other", dateOther: "2026-11-14", time: "09:00", adults: 2, childAges: [], pickupAt: "Hotel Sunset", dropoffAt: "Krabi Airport", name: "Sophie" }))],
  ["location de scooters", "rental", B.buildMessage(LOCATION, etat(LOCATION, { option: "scooters", vehicle: "Honda Click 125", vehicles: 2, dateFrom: "2026-11-05", timeFrom: "10:00", dateTo: "2026-11-08", timeTo: "10:00", name: "Luc" }))],
  ["speedboat aller simple", "speedboat", B.buildMessage(BATEAU, etat(BATEAU, { route: "lanta-phi-phi", departure: "d1", tripType: "one-way", dateChoice: "other", dateOther: "2026-11-09", adults: 2, childAges: [], pickup: "Hotel Sunset", name: "Eva" }))],
  ["speedboat aller-retour de saison", "speedboat", B.buildMessage(BATEAU, etat(BATEAU, { route: "lanta-phi-phi", departure: "d2", tripType: "return", returnDeparture: "r1", returnDate: "2026-11-11", dateChoice: "other", dateOther: "2026-11-09", adults: 2, childAges: [8], pickup: "Hotel Sunset", name: "Eva" }))],
  ["liste de sorties", "liste", B.buildTripList(CATALOGUE, { items: [{ id: "a", slug: "4-islands", option: "join-in-longtail", date: "2026-11-21" }, { id: "b", slug: "koh-rok", option: "on-request", date: "2026-11-23" }], adults: 2, childAges: [], pickup: "Hotel Sunset", name: "Anna" })],
];
writeFileSync(new URL("../../tests/fixtures/messages-site.json", import.meta.url), JSON.stringify(scenarios.map(([nom, genre, message]) => ({ nom, genre, message })), null, 2) + "\n");
console.log(scenarios.length, "messages écrits");
for (const [nom, , m] of scenarios) console.log("\n== " + nom + "\n" + m);
