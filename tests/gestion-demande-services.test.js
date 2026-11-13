// « Coller une demande » crée tous les services cités, chacun à sa date : lecture des heures, de l'hôtel, découpe du message en services,
// message de réponse avec le total.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lireMessage, lireHeureLibre, decouperServices, varsReponse, langueDuMessage, sensTrajet } from "../src/gestion/js/demande-calc.mjs";
import { donneesDemo } from "../src/gestion/js/defauts.mjs";
import { ajouterJours } from "../src/gestion/js/calc.mjs";

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

// ---- Messages WhatsApp réels, lus avec les tarifs et les trajets de la démo Excursions (aucune prestation ajoutée) --------------------------
const DEMO = donneesDemo(AJD, ajouterJours);
const SECRET = DEMO.entites[1].id;
const CTX_DEMO = { prestations: DEMO.prestations.filter((p) => p.entite_id === SECRET), trajets: DEMO.trajets.filter((t) => t.entite_id === SECRET), nomPartenaire: () => "" };
const demo = (t) => ({ d: lire(t), s: decouperServices(t, lire(t), CTX_DEMO, AJD) });

test("message de l'audit du 13.11 : 2 services, l'enfant sur le tour, l'hôtel, le transfert du 24 à 9 h sans le trajet inverse", () => {
  const { d, s } = demo("Hi! I'd like to book the 4 islands longtail tour for 2 adults and 1 child (8 years) on 20 November, pickup at Lanta Sand Resort. Also a transfer from Koh Lanta to Krabi airport on 24 November at 9am. My name is Sarah Miller, +44 7700 900123");
  assert.equal(d.hotel, "Lanta Sand Resort");
  assert.equal(d.nom, "Sarah Miller");
  assert.equal(s.length, 2);
  assert.equal(s[0].offres[0].titre, "4 Islands by longtail, full day");
  assert.deepEqual([s[0].date, s[0].adultes, s[0].enfants], ["2026-11-20", 2, 1]);
  assert.match(s[1].phrase, /from Koh Lanta to Krabi airport/);
  assert.deepEqual([s[1].date, s[1].heure], ["2026-11-24", "09:00"]);
  // La démo n'a que Krabi Airport → Koh Lanta : le service reste « à préciser » plutôt que réservé à l'envers.
  assert.ok(!s[1].offres.some((o) => /Krabi Airport → Koh Lanta/.test(o.titre)), "trajet en sens inverse proposé");
  assert.ok(!s[1].offres.some((o) => /Phuket|Lipe/.test(o.titre)), "un seul bout commun ne suffit pas");
});

test("aller et retour en bateau : chaque jour son sens, le speedboat demandé passe devant le ferry", () => {
  const { d, s } = demo("Hello, we are 2 adults and 2 kids (5 and 10). Can we book a speedboat from Koh Lanta to Koh Phi Phi on 22 Nov, and back from Phi Phi to Lanta on 25 Nov? Staying at Pimalai Resort.");
  assert.equal(d.hotel, "Pimalai Resort");
  assert.equal(s.length, 2);
  assert.equal(s[0].offres[0].source.mode, "Speedboat");
  assert.ok(s[0].offres.every((o) => o.source.de === "Koh Lanta" && o.source.vers === "Koh Phi Phi"));
  assert.ok(s[1].offres.length && s[1].offres.every((o) => o.source.de === "Koh Phi Phi" && o.source.vers === "Koh Lanta"));
  assert.deepEqual(s.map((x) => [x.date, x.adultes, x.enfants]), [["2026-11-22", 2, 2], ["2026-11-25", 2, 2]]);
});

test("pickup à l'aéroport : le trajet dans le bon sens, l'aéroport n'est pas l'hôtel", () => {
  const { d, s } = demo("Hi, can you pick us up from Krabi airport on 18 December at 2pm to Koh Lanta? 4 people, staying at Sea Breeze Bungalows, Klong Nin. Thanks, Tom");
  assert.equal(d.hotel, "Sea Breeze Bungalows, Klong Nin");
  assert.equal(d.nom, "Tom");
  assert.equal(s.length, 1);
  assert.equal(s[0].offres[0].titre, "Krabi Airport → Koh Lanta");
  assert.deepEqual([s[0].date, s[0].heure, s[0].adultes, s[0].enfants], ["2026-12-18", "14:00", 4, 0]);
});

test("sortie au coucher du soleil puis taxi : l'âge de l'enfant reste sur la sortie, « X Hotel » est l'hôtel", () => {
  const { d, s } = demo("Hello! Sunset longtail trip tomorrow for 2 adults and 1 kid (4 yrs old) please. We're at Lanta Garden Hotel. Then a taxi to Phuket airport on 20/11 at 7am. Anna");
  assert.equal(d.hotel, "Lanta Garden Hotel");
  assert.equal(s.length, 2);
  assert.equal(s[0].offres[0].titre, "Sunset by longtail, 2 hours");
  assert.deepEqual([s[0].date, s[0].adultes, s[0].enfants], ["2026-11-13", 2, 1]);
  assert.equal(s[1].offres[0].titre, "Koh Lanta → Phuket Airport");
  assert.deepEqual([s[1].date, s[1].heure], ["2026-11-20", "07:00"]);
});

test("en français : « 1 enfant de 6 ans » ne crée pas de service, l'hôtel est lu avant le mot Resort", () => {
  const { d, s } = demo("Bonjour, nous sommes 2 adultes et 1 enfant de 6 ans. On voudrait le tour des 4 îles en longtail le 21 novembre, prise en charge au Lanta Sand Resort. Merci, Julie");
  assert.equal(d.hotel, "Lanta Sand Resort");
  assert.equal(s.length, 1);
  assert.equal(s[0].offres[0].titre, "4 Islands by longtail, full day");
  assert.deepEqual([s[0].date, s[0].adultes, s[0].enfants], ["2026-11-21", 2, 1]);
  assert.ok(!/ {2}| \./.test(s[0].phrase), "phrase sans espaces en trop");
});

test("effectif : le même groupe d'adultes garde les enfants du message, un autre groupe non", () => {
  const meme = services("We are 2 adults and 1 child. Kayaking on 20 november for 2 adults.");
  assert.deepEqual([meme[0].adultes, meme[0].enfants], [2, 1]);
  const autre = services("We are 2 adults and 1 child. Kayaking on 20 november for 4 adults.");
  assert.deepEqual([autre[0].adultes, autre[0].enfants], [4, 0]);
});

test("un fragment de personnes, d'âges ou de date complète le service d'avant", () => {
  const s = services("4 islands tour for 2 adults and 2 children aged 5 and 9 on 20 november");
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].date, s[0].adultes, s[0].enfants], ["2026-11-20", 2, 2]);
});

test("hôtel : « pickup at X », « X Resort », sans prendre un aéroport ni une phrase pour un hôtel", () => {
  assert.equal(lire("kayaking tomorrow for 2, pickup at Lanta Sand Resort").hotel, "Lanta Sand Resort");
  assert.equal(lire("kayaking tomorrow for 2, pick us up from Pimalai please").hotel, "Pimalai");
  assert.equal(lire("We are at Sea Breeze Bungalows, kayaking tomorrow for 2").hotel, "Sea Breeze Bungalows");
  assert.equal(lire("pickup at Krabi Airport tomorrow 2pm for 2").hotel || "", "");
  assert.equal(lire("The Resort is great, kayaking tomorrow for 2").hotel || "", "");
});

test("sens d'un trajet : from et to font foi, sinon l'ordre des lieux", () => {
  assert.equal(sensTrajet("Krabi Airport", "Koh Lanta", "a transfer from Koh Lanta to Krabi airport"), "inverse");
  assert.equal(sensTrajet("Krabi Airport", "Koh Lanta", "transfer to Koh Lanta from Krabi airport"), "direct");
  assert.equal(sensTrajet("Krabi Airport", "Koh Lanta", "taxi Krabi airport - Koh Lanta"), "direct");
  assert.equal(sensTrajet("Koh Lanta", "Phuket Airport", "un taxi vers l'aéroport de Phuket"), "");
  assert.equal(sensTrajet("Koh Phi Phi", "Koh Lanta", "de Koh Lanta à Koh Phi Phi"), "inverse");
});
