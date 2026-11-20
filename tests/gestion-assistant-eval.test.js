// Notation du jeu d'essai de l'assistant IA (scripts/eval-assistant/notes.mjs) : fonctions pures, sans appel à Claude.
import { test } from "node:test";
import assert from "node:assert/strict";
import { noterTrier, noterLire, noterReponse, noterAgent, hotelOk, telephoneOk, catalogueOk } from "../scripts/eval-assistant/notes.mjs";

test("notation du tri : type, choix, nom et changement (pour le futur agent)", () => {
  const cas = { type: ["changement"], nom: "Peter Hall", date_service: "2026-11-20", changement: { date: "", heure: "09:00", adultes: 0, enfants: 0 } };
  const juste = noterTrier({ types: ["changement"], nom: "Peter Hall", date_service: "2026-11-20", nouveau: { date: "", heure: "09:00", adultes: 0, enfants: 0 } }, cas);
  assert.deepEqual(juste.grade, { exact: 1, score: 1 });
  const proche = noterTrier({ types: ["question", "changement"], nom: "", date_service: "", nouveau: { date: "", heure: "", adultes: 0, enfants: 0 } }, cas);
  assert.equal(proche.grade.exact, 0);
  assert.ok(proche.rates.includes("type") && !proche.rates.includes("type_dans_les_choix"));
  assert.ok(proche.rates.includes("nom") && proche.rates.includes("nouvelle_heure"));
});

test("notation : hôtel, téléphone, ligne du catalogue", () => {
  assert.ok(hotelOk("Cocolanta Resort", ["Cocolanta Resort Koh Lanta"]));
  assert.ok(hotelOk("", ["", "Sweet Life"]));
  assert.ok(!hotelOk("", ["Pimalai"]));
  assert.ok(!hotelOk("Lanta Sand", ["Pimalai"]));
  assert.ok(telephoneOk("+33 6 21 43 65 87", "0621436587"));
  assert.ok(telephoneOk("", ""));
  assert.ok(!telephoneOk("+33 6 21 43 65 00", "0621436587"));
  const catalogue = { prestations: [{ id: "p1", libelle_en: "Krabi Airport", groupe: "Private Taxi" }], trajets: [{ id: "t1", de: "Koh Lanta", vers: "Koh Phi Phi", mode: "Speedboat" }] };
  assert.ok(catalogueOk({ offre: { genre: "prestation", id: "p1" } }, [{ libelle: "Krabi Airport", groupe: "Private Taxi" }], catalogue));
  assert.ok(catalogueOk({ offre: { genre: "trajet", id: "t1" } }, [{ libelle: "Koh Lanta → Koh Phi Phi" }], catalogue));
  assert.ok(catalogueOk({ offre: null, hors_catalogue: true }, ["hors_catalogue"], catalogue));
  assert.ok(catalogueOk({ offre: null, hors_catalogue: false }, ["aucun"], catalogue));
  assert.ok(!catalogueOk({ offre: null, hors_catalogue: false }, [{ libelle: "Krabi Airport" }], catalogue));
});

test("notation lire : un service manquant ou une mauvaise heure se voient", () => {
  const att = { client: { nom: "Julie", telephone: "0698765432", hotel: ["Pimalai"], langue: "fr", adultes: 2, enfants: 0, bebes: 1 }, services: [{ date: ["2026-11-20"], heure: ["07:00"], adultes: 2, enfants: 0, catalogue: ["hors_catalogue"] }] };
  const p = { client: { nom: "Julie", telephone: "06 98 76 54 32", hotel: "Pimalai", langue: "fr", adultes: 2, enfants: 0, bebes: 1 }, services: [{ date: "2026-11-20", heure: "07:00", adultes: 2, enfants: 0, offre: null, hors_catalogue: true }] };
  assert.equal(noterLire(p, att, {}).grade.exact, 1);
  const faux = noterLire({ ...p, services: [{ ...p.services[0], heure: "" }] }, att, {});
  assert.deepEqual(faux.rates, ["s1_heure"]);
  assert.ok(noterLire({ ...p, services: [] }, att, {}).rates.includes("nombre_services"));
});

test("notation des réponses : montant hors faits, compagnie, signature, prix oublié", () => {
  const base = { prix: [700], heures: ["13:00"], langue: "fr", signature_interdite: true, entreprise: "Secret Travel & Tour", compagnies: ["Bundhaya Speed Boat"], interdits: ["Nani"] };
  const bon = "Bonjour Paul,\nMerci pour votre message.\n→ 25 janvier, Koh Lanta → Koh Phi Phi : départ 13:00, 700 THB par adulte.\nDites-nous l'horaire qui vous convient.";
  assert.deepEqual(noterReponse(bon, { avertissements: [] }, base).grade, { exact: 1, score: 1 });
  const mauvais = `${bon.replace("700", "650")} Le bateau est celui de Bundhaya Speed Boat.\nBelle journée, Nani`;
  const n = noterReponse(mauvais, { avertissements: ["montant_hors_base:650"] }, base);
  assert.ok(["montants_des_faits", "aucune_compagnie", "sans_signature", "aucun_mot_interdit", "tous_les_prix"].every((r) => n.rates.includes(r)));
  assert.ok(noterReponse("Hello Paul, thank you. Tu peux choisir.", { avertissements: [] }, { ...base, prix: [] }).rates.includes("langue"));
});
test("notation de l'agent : départ à temps, aucune heure ni prix inventés, questions posées", () => {
  const att = { departs_admissibles: ["13:30", "13:40"], departs_exclus: ["14:30", "15:00"] };
  assert.equal(noterAgent("Take the speedboat at 13:30, arriving 14:30.", { ...att, heure_pickup: "", heures_autorisees: ["14:30"] }).grade.exact, 1);
  assert.deepEqual(noterAgent("The 15:00 boat is perfect.", att).rates, ["un_depart_a_temps", "aucun_depart_trop_tard"]);
  const hopital = { heure_pickup: "", heures_autorisees: ["16:00"], montants_interdits: [2300, 2500], doit_demander: ["personnes", "bagages", "heure du vol"] };
  assert.equal(noterAgent("We will pick you up at 14:00, total 2,300 THB.", hopital).grade.exact, 0);
  assert.deepEqual(noterAgent("Arrival at the hospital at 16:00 is possible. How many people, how many bags, and what time is your flight? We will send the price.", hopital).rates, []);
});
