import { test } from "node:test";
import assert from "node:assert/strict";
import { agenda, dateFinService, locationEnCours, cleMessageReservation } from "../src/gestion/js/operations-calc.mjs";
import { rappelVeille, rappelLendemain } from "../supabase/functions/rappels/calc.js";
import { aVerifier } from "../src/gestion/js/a-verifier-calc.mjs";

// Le cas réel du 12.11.2026 : Honda ADV 350 chez Noom Rental, prise le 11, retour le 15, jamais confirmée.
const mckay = { id: "mckay", dossier_id: "d1", libelle: "Honda ADV 350", statut: "a_demander", date_service: "2026-11-11", details: { retour_date: "2026-11-15" } };
const termineeHier = { id: "fini", dossier_id: "d2", libelle: "Honda Click", statut: "a_demander", date_service: "2026-11-09", details: { retour_date: "2026-11-11" } };
const excursionHier = { id: "tour", dossier_id: "d3", libelle: "4 Islands", statut: "a_demander", date_service: "2026-11-11", details: {} };
const aVenir = { id: "demain", dossier_id: "d4", libelle: "Honda PCX", statut: "a_demander", date_service: "2026-11-13", details: { retour_date: "2026-11-20" } };
const ids = (l) => l.map((r) => r.id);

test("date de fin : le retour d'une location, sinon le jour du service", () => {
  assert.equal(dateFinService(mckay), "2026-11-15");
  assert.equal(dateFinService(excursionHier), "2026-11-11");
  assert.equal(dateFinService({ date_service: "2026-11-11", details: { retour_date: "2026-11-08" } }), "2026-11-11", "un retour avant la prise est une erreur de saisie : on garde le jour du service");
  assert.equal(dateFinService({ date_service: "2026-11-11", details: { retour_date: "" } }), "2026-11-11");
  assert.equal(dateFinService({ date_service: "2026-11-11" }), "2026-11-11");
  assert.equal(dateFinService({ date_service: null, details: { retour_date: "2026-11-15" } }), null, "sans date de service, rien à deviner");
});

test("location en cours : commencée avant aujourd'hui et pas encore rendue", () => {
  assert.equal(locationEnCours(mckay, "2026-11-12"), true);
  assert.equal(locationEnCours(mckay, "2026-11-15"), true, "le jour du retour, elle est encore en cours");
  assert.equal(locationEnCours(mckay, "2026-11-16"), false);
  assert.equal(locationEnCours(mckay, "2026-11-11"), false, "le jour de la prise, c'est un départ du jour, pas une location en cours");
  assert.equal(locationEnCours(excursionHier, "2026-11-12"), false, "un service d'un jour n'est jamais en cours");
  assert.equal(locationEnCours(aVenir, "2026-11-12"), false);
});

test("agenda : une location en cours n'est ni en retard ni à confirmer, ni dans « hier »", () => {
  const ag = agenda([mckay], "2026-11-12");
  assert.deepEqual(ids(ag.enRetard), []);
  assert.deepEqual(ids(ag.aConfirmer), []);
  assert.deepEqual(ids(ag.hier), []);
  assert.deepEqual(ids(ag.enCours), ["mckay"]);
});

test("agenda : une location terminée hier et un service d'un jour d'hier suivent l'ancienne règle", () => {
  const ag = agenda([termineeHier, excursionHier], "2026-11-12");
  assert.deepEqual(ids(ag.hier).sort(), ["fini", "tour"]);
  assert.deepEqual(ids(ag.enRetard).sort(), ["fini", "tour"]);
  assert.deepEqual(ids(ag.enCours), []);
});

test("agenda : l'étape d'après se déclenche le lendemain du retour", () => {
  assert.deepEqual(ids(agenda([mckay], "2026-11-15").hier), []);
  const ag = agenda([mckay], "2026-11-16");
  assert.deepEqual(ids(ag.hier), ["mckay"]);
  assert.deepEqual(ids(ag.enRetard), ["mckay"], "rendue et jamais confirmée : là, elle est bien en retard");
  assert.deepEqual(ids(ag.enCours), []);
});

test("agenda : une location jamais confirmée dont le début approche reste à confirmer", () => {
  const ag = agenda([aVenir], "2026-11-12");
  assert.deepEqual(ids(ag.aConfirmer), ["demain"]);
  assert.deepEqual(ids(ag.enCours), []);
  assert.deepEqual(ids(agenda([aVenir], "2026-11-13").aConfirmer), ["demain"], "le jour de la prise, toujours à confirmer");
});

test("agenda : annulée ou écartée, une location en cours disparaît aussi de « en cours »", () => {
  assert.deepEqual(ids(agenda([{ ...mckay, statut: "annule" }], "2026-11-12").enCours), []);
  assert.deepEqual(ids(agenda([mckay], "2026-11-12", new Set(["d1"])).enCours), []);
});

test("rappels : le rappel de 9h attend le lendemain du retour, celui de 18h reste sur la prise", () => {
  const R = [{ entite_id: "S", dossier_id: "d1", statut: "confirme", heure_pickup: "08:00", date_service: "2026-11-11", details: { retour_date: "2026-11-15" } }];
  const options = { entiteIds: null };
  assert.equal(rappelLendemain(R, "2026-11-11", options), null, "le lendemain de la prise, la location court encore");
  assert.equal(rappelLendemain(R, "2026-11-14", options), null);
  const retour = rappelLendemain(R, "2026-11-15", options);
  assert.ok(retour, "le 16, on écrit au client");
  assert.match(retour.titre, /1 client/);
  assert.ok(rappelVeille(R, "2026-11-11", options), "la veille de la prise, le rappel de 18h part");
  assert.equal(rappelVeille(R, "2026-11-15", options), null, "pas de rappel de 18h la veille du retour");
});

test("rappels : un service d'un jour, ou sans détails, garde son comportement", () => {
  const R = [{ entite_id: "S", dossier_id: "d1", statut: "confirme", heure_pickup: "08:00", date_service: "2026-11-08" }];
  assert.ok(rappelLendemain(R, "2026-11-08", { entiteIds: null }));
});

test("à vérifier : une location en cours n'est pas une réservation passée sans réponse", () => {
  const db = { reservations: [mckay, termineeHier], dossiers: [{ id: "d1" }, { id: "d2" }], clients: [] };
  const l = aVerifier(db, { droits: { dossiers: true }, aujourdhui: "2026-11-12" });
  const passees = (l.find((c) => c.cle === "reservations_passees") || { elements: [] }).elements;
  assert.deepEqual(passees.map((x) => x.id), ["fini"]);
});

test("message client : pas d'avis pendant la location, l'avis vient après le retour", () => {
  assert.equal(cleMessageReservation(mckay, "2026-11-12"), "confirmation");
  assert.equal(cleMessageReservation(mckay, "2026-11-15"), "confirmation");
  assert.equal(cleMessageReservation(mckay, "2026-11-16"), "avis");
  assert.equal(cleMessageReservation(excursionHier, "2026-11-12"), "avis");
  assert.equal(cleMessageReservation(aVenir, "2026-11-12"), "rappel", "la veille de la prise, le rappel de départ");
});
