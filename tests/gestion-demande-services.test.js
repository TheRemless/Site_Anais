// « Coller une demande » crée tous les services cités, chacun à sa date : lecture des heures, de l'hôtel, découpe du message en services,
// message de réponse avec le total.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lireMessage, lireHeureLibre, decouperServices, varsReponse, langueDuMessage } from "../src/gestion/js/demande-calc.mjs";

const AJD = "2026-11-12";
const PRESTATIONS = [
  { id: "i4", actif: true, famille: "excursion", libelle: "4 îles en longtail, journée", libelle_en: "4 Islands by longtail", groupe: "Excursions en groupe", prix_vente: 1200, unite: "pp", partenaire_id: "p1" },
  { id: "i4e", actif: true, famille: "excursion", libelle: "4 îles en longtail, enfant 3 à 9 ans", libelle_en: "", groupe: "Excursions en groupe", prix_vente: 900, unite: "ch", partenaire_id: "p1" },
  { id: "kay", actif: true, famille: "activite", libelle: "Kayak", libelle_en: "Kayaking", groupe: "", prix_vente: 600, unite: "pp", partenaire_id: "p2" },
  { id: "tx", actif: true, famille: "transfert", libelle: "Koh Lanta → Aéroport de Phuket", libelle_en: "Koh Lanta to Phuket Airport", groupe: "Minivan privé", prix_vente: 4500, unite: "veh", partenaire_id: "p3" },
];
const CTX = { prestations: PRESTATIONS, trajets: [], nomPartenaire: () => "" };
const lire = (t) => lireMessage(t, AJD);
const services = (t) => decouperServices(t, lire(t), CTX, AJD);

test("heure : am, pm, point, deux-points, « h », sans marqueur ignoré", () => {
  assert.equal(lireHeureLibre("pickup at 9am"), "09:00");
  assert.equal(lireHeureLibre("at 9 am please"), "09:00");
  assert.equal(lireHeureLibre("around 9.30am"), "09:30");
  assert.equal(lireHeureLibre("at 9:30 pm"), "21:30");
  assert.equal(lireHeureLibre("à 21h"), "21:00");
  assert.equal(lireHeureLibre("vers 21h30"), "21:30");
  assert.equal(lireHeureLibre("14:45"), "14:45");
  assert.equal(lireHeureLibre("12am"), "00:00");
  assert.equal(lireHeureLibre("12 pm"), "12:00");
  assert.equal(lireHeureLibre("at 9 for 4 adults"), "", "9 sans marqueur n'est pas une heure");
  assert.equal(lireHeureLibre("on 22.11 with 10 adults 2026-11-20"), "", "dates et nombres ne sont pas des heures");
});

test("hôtel : « Hotel: X », « hotel X » en minuscules, avec majuscules, sans déborder", () => {
  assert.equal(lire("Hi, we want kayaking tomorrow for 2\nHotel: Sunset Resort, Klong Dao\nName: Anna").hotel, "Sunset Resort, Klong Dao");
  assert.equal(lire("we stay at hotel sunset on 20 november, kayaking please for 2").hotel, "hotel sunset");
  assert.equal(lire("we stay at Hotel Sunset, Klong Dao and want kayaking tomorrow for 2").hotel, "Hotel Sunset, Klong Dao");
  assert.equal(lire("nous logeons à l'hôtel bamboo le 20 décembre, kayak pour 2").hotel, "hôtel bamboo");
  assert.equal(lire("kayak demain pour 2, hôtel : Bamboo Lodge").hotel, "Bamboo Lodge");
});

test("hôtel : « hotel pickup » ou « hotel near » ne sont pas un nom d'hôtel", () => {
  assert.equal(lire("Please arrange hotel pickup at 9am for kayaking tomorrow, for 2").hotel || "", "");
  assert.equal(lire("kayaking tomorrow for 2, hotel near the pier").hotel || "", "");
});

const TROIS = "Hello, we are 2 adults and 2 children, hotel: Sunset Resort. We'd like the 4 islands tour on 20 november, kayaking on 22 november and a taxi to Phuket airport on 24 november at 9am.";

test("trois services, chacun à sa date, l'heure du taxi seulement sur le taxi", () => {
  const s = services(TROIS);
  assert.equal(s.length, 3);
  assert.deepEqual(s.map((x) => x.offres[0].id), ["i4", "kay", "tx"]);
  assert.deepEqual(s.map((x) => x.date), ["2026-11-20", "2026-11-22", "2026-11-24"]);
  assert.deepEqual(s.map((x) => x.heure), ["", "", "09:00"]);
  assert.deepEqual(s.map((x) => [x.adultes, x.enfants]), [[2, 2], [2, 2], [2, 2]]);
  assert.equal(lire(TROIS).hotel, "Sunset Resort", "l'hôtel n'est pas pris pour un coucher de soleil");
});

test("trois services en français", () => {
  const s = services("Bonjour, nous sommes 2 adultes et 2 enfants. On voudrait le tour des 4 îles le 20 novembre, du kayak le 22 novembre et un taxi vers l'aéroport de Phuket le 24 novembre à 9h.");
  assert.deepEqual(s.map((x) => x.offres[0].id), ["i4", "kay", "tx"]);
  assert.deepEqual(s.map((x) => x.date), ["2026-11-20", "2026-11-22", "2026-11-24"]);
  assert.equal(s[2].heure, "09:00");
});

test("une phrase par service, des services sur plusieurs lignes", () => {
  const s = services("Hi\n2 adults\n4 islands tour on 20 november\nkayaking on 22 november 8.30am");
  assert.deepEqual(s.map((x) => x.date), ["2026-11-20", "2026-11-22"]);
  assert.equal(s[1].heure, "08:30");
});

test("une seule date dans le message : tous les services la prennent", () => {
  const s = services("We are 2 adults, we want the 4 islands tour and kayaking on 20 november");
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => x.date), ["2026-11-20", "2026-11-20"]);
});

test("message sans date : la date est vide, rien n'est inventé", () => {
  const s = services("We are 2 adults and want the 4 islands tour, thanks");
  assert.equal(s.length, 1);
  assert.equal(s[0].date, "");
});

test("deux fois le même service à deux dates : deux lignes", () => {
  const s = services("2 adults, 4 islands tour on 20 november and again on 25 november");
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => x.offres[0].id), ["i4", "i4"]);
  assert.deepEqual(s.map((x) => x.date), ["2026-11-20", "2026-11-25"]);
  const f = services("2 adultes, tour des 4 îles le 20 novembre et encore le 25 novembre");
  assert.deepEqual(f.map((x) => x.date), ["2026-11-20", "2026-11-25"]);
});

test("jour seul avec « th » : le mois est celui de la date précédente", () => {
  const s = services("2 adults, 4 islands tour on 20 november and kayaking on the 22nd");
  assert.deepEqual(s.map((x) => x.date), ["2026-11-20", "2026-11-22"]);
});

test("service non reconnu : une ligne « à préciser » avec la phrase, jamais le silence", () => {
  const s = services("We are 2 adults. We'd like the 4 islands tour on 20 november and we want to go paragliding on 21 november");
  assert.equal(s.length, 2);
  assert.equal(s[0].offres[0].id, "i4");
  assert.deepEqual(s[1].offres, []);
  assert.match(s[1].phrase, /paragliding/);
  assert.equal(s[1].date, "2026-11-21");
});

test("message de formulaire du site : une seule ligne, pas de découpe en plusieurs services", () => {
  const t = "Booking request: 4 Islands – Join-in longtail\nDate: Wed 18 Nov 2026\nGuests: 2 adults, 1 child (age 7)\nPickup: Hotel X\nName: Anna";
  const d = lire(t);
  assert.equal(d.site, true);
  assert.equal(decouperServices(t, d, CTX, AJD).length, 1);
});

test("langue du message : français, anglais, et anglais par défaut", () => {
  assert.equal(langueDuMessage("Bonjour, nous voudrions le tour des 4 îles pour demain, merci"), "fr");
  assert.equal(langueDuMessage("Hello, we would like the 4 islands tour tomorrow, thank you"), "en");
  assert.equal(langueDuMessage("4 islands 20 november 2 adults"), "en");
  assert.equal(langueDuMessage("Booking request: 4 Islands – Join-in longtail\nGuests: 2 adults"), "en");
});

const OFFRE = (titre, total, extra = {}) => ({ genre: "prestation", id: titre, titre, total, source: { libelle: `${titre} FR`, partenaire_id: "p" }, ...extra });

test("réponse : chaque service avec sa date, son prix, et le total", () => {
  const v = varsReponse({ d: { nom: "Anna Keller" }, services: [{ offre: OFFRE("4 Islands by longtail", 3300), date: "2026-11-20", adultes: 2, enfants: 1 }, { offre: OFFRE("Mangrove kayaking", 1200), date: "2026-11-22", adultes: 2, enfants: 0 }], devise: "THB", langue: "en", entreprise: { nom: "Secret", telephone: "+66 1" } });
  assert.equal(v.bonjour, "Hello Anna,");
  assert.equal(v.total, "THB 4,500");
  assert.match(v.services, /• 4 Islands by longtail\n {2}20 November 2026 · 2 adults, 1 child · THB 3,300/);
  assert.match(v.services, /• Mangrove kayaking\n {2}22 November 2026 · 2 adults · THB 1,200/);
  assert.equal(v.entreprise, "Secret");
});

test("réponse en français : libellés français, dates françaises, aucun mot anglais", () => {
  const v = varsReponse({ d: { nom: "" }, services: [{ offre: OFFRE("4 Islands by longtail", 3600), date: "2026-11-20", adultes: 2, enfants: 2 }], devise: "THB", langue: "fr", entreprise: { nom: "Secret", telephone: "" } });
  assert.equal(v.bonjour, "Bonjour,");
  assert.match(v.services, /• 4 Islands by longtail FR\n {2}20 novembre 2026 · 2 adultes, 2 enfants · THB 3 600/);
  assert.equal(v.total, "THB 3 600");
  assert.ok(!/\badults?\b|\bchild/.test(v.services));
});

test("réponse : prix inconnu ou date manquante dits en toutes lettres, total à confirmer, aucune variable vide", () => {
  const v = varsReponse({ d: { nom: "A" }, services: [{ offre: OFFRE("Kayak", null), date: "", adultes: 1, enfants: 0 }, { offre: OFFRE("Taxi", 100), date: "2026-11-24", adultes: 1, enfants: 0 }], devise: "THB", langue: "en", entreprise: { nom: "Secret", telephone: "" } });
  assert.match(v.services, /date to be confirmed · 1 adult · price to be confirmed/);
  assert.equal(v.total, "to be confirmed", "un total qui ignore un prix inconnu serait faux");
  for (const [k, val] of Object.entries(v)) if (k !== "telephone") assert.ok(String(val).trim(), `variable vide : ${k}`);
});

test("réponse : ligne sans service reconnu, dite à préciser", () => {
  const v = varsReponse({ d: { nom: "A" }, services: [{ offre: null, phrase: "paragliding on 21 november", date: "2026-11-21", adultes: 2, enfants: 0 }], devise: "THB", langue: "en", entreprise: { nom: "S", telephone: "" } });
  assert.match(v.services, /to be specified/);
});

test("service non cité par un verbe : un fragment daté qui nomme autre chose est « à préciser », pas une copie", () => {
  const s = services("2 adults, 4 islands tour on 20 november, paragliding on 22 november");
  assert.equal(s.length, 2);
  assert.equal(s[0].offres[0].id, "i4");
  assert.deepEqual(s[1].offres, []);
  assert.match(s[1].phrase, /paragliding/);
  assert.equal(s[1].date, "2026-11-22");
  assert.equal(s[1].copie, false);
});

test("taxi vers l'aéroport en français : le départ de Koh Lanta est sous-entendu", () => {
  const s = services("Bonjour, nous sommes 2 adultes. Un taxi vers l'aéroport de Phuket le 24 novembre à 9h.");
  assert.equal(s[0].offres[0].id, "tx");
  assert.equal(s[0].heure, "09:00");
});
