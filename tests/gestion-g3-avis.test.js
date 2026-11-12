import { test } from "node:test";
import assert from "node:assert/strict";
import { avisParClient, variablesMessage } from "../src/gestion/js/operations-calc.mjs";
import { MESSAGES_DEFAUT } from "../src/gestion/js/defauts.mjs";

const r = (id, dossier, extra = {}) => ({ id, dossier_id: dossier, libelle: "Service " + id, date_service: "2026-11-11", statut: "confirme", details: {}, ...extra });
const clientDe = (res) => ({ d1: "c1", d2: "c1", d3: "c2" })[res.dossier_id];

test("avis : une seule demande par client, même avec plusieurs services ou plusieurs dossiers", () => {
  const liste = avisParClient([r("a", "d1"), r("b", "d1"), r("c", "d2"), r("d", "d3")], clientDe);
  assert.equal(liste.length, 2, "deux clients, deux demandes");
  const c1 = liste.find((x) => x.clientId === "c1");
  assert.deepEqual(c1.reservations.map((x) => x.id), ["a", "b", "c"], "tous les services du client sont regroupés");
  assert.equal(c1.premiere.id, "a");
  assert.equal(c1.demandeLe, null);
});

test("avis déjà demandé : noté sur un des services, il n'est plus reproposé pour le client", () => {
  const liste = avisParClient([r("a", "d1", { details: { avis_demande_le: "2026-11-12" } }), r("b", "d1")], clientDe);
  assert.equal(liste.length, 1);
  assert.equal(liste[0].demandeLe, "2026-11-12");
});

test("avis : les services annulés ou sans client ne comptent pas", () => {
  assert.equal(avisParClient([r("a", "d1", { statut: "annule" })], clientDe).length, 0);
  assert.equal(avisParClient([r("a", "inconnu")], () => null).length, 0);
});

test("message d'avis : le lien d'avis Google vient des réglages, absent il est signalé plutôt qu'inventé", () => {
  const v = variablesMessage({ reservation: r("a", "d1"), client: { prenom: "Ben" }, entreprise: { nom: "Secret", lien_avis: "https://g.page/r/CQ-RKycvZ7OCEAI/review" }, langue: "en" });
  assert.equal(v.lien_avis, "https://g.page/r/CQ-RKycvZ7OCEAI/review");
  assert.equal(variablesMessage({ reservation: r("a", "d1"), client: {}, entreprise: { nom: "Secret" }, langue: "en" }).lien_avis, "", "sans lien dans les réglages, la variable est vide (et le message dit ce qui manque)");
  for (const id of ["avis-fr", "avis-en"]) assert.match(MESSAGES_DEFAUT.find((m) => m.id === id).corps, /\{lien_avis\}/, `le modèle ${id} utilise le lien`);
});

import { notePasseport, consigneCheckin } from "../src/gestion/js/operations-calc.mjs";
import { reponsePrix } from "../src/gestion/js/demande-calc.mjs";

test("passeport pour Langkawi : une note claire pour tout trajet vers ou depuis la Malaisie, avec le check-in de la compagnie", () => {
  const trajet = { de: "Koh Lipe", vers: "Langkawi" };
  const note = notePasseport({ ...trajet, compagnie: "Bundhaya Speed Boat" });
  assert.match(note, /passport/i);
  assert.match(note, /at least six months/);
  assert.ok(note.includes(consigneCheckin("Bundhaya Speed Boat", trajet)), "le texte de check-in de la compagnie est repris tel quel, rien n'est inventé");
  assert.ok(notePasseport({ de: "Langkawi", vers: "Koh Lipe", compagnie: "Satun Pakbara Speed Boat Club" }).includes(consigneCheckin("Satun Pakbara Speed Boat Club", { de: "Langkawi", vers: "Koh Lipe" })), "depuis Langkawi aussi");
  assert.equal(notePasseport({ de: "Koh Lanta", vers: "Krabi Airport", compagnie: "Bundhaya Speed Boat" }), "", "rien pour un trajet thaïlandais");
  assert.match(notePasseport({ libelle: "Speedboat to Langkawi", compagnie: "" }), /six months/, "service saisi à la main : le libellé suffit");
  assert.equal(notePasseport({}), "");
});

test("réponse à une demande collée : le trajet Langkawi porte la note du passeport, un autre trajet non", () => {
  const d = { nom: "Anna Keller", date: "2026-12-10", adultes: 2, enfants: 0, bebes: 0 };
  const lang = reponsePrix(d, { titre: "Koh Lipe → Langkawi, 10:30", total: 3600, source: { de: "Koh Lipe", vers: "Langkawi" } }, { compagnie: "Bundhaya Speed Boat" });
  assert.match(lang, /passport/i);
  assert.ok(lang.indexOf("passport") < lang.indexOf("Would you like me to book it?"), "avant la question finale");
  const autre = reponsePrix(d, { titre: "Koh Lanta → Krabi Airport", total: 700, source: { de: "Koh Lanta", vers: "Krabi Airport" } }, { compagnie: "" });
  assert.doesNotMatch(autre, /passport/i);
});

test("Bundhaya payé d'avance : à régler au prestataire avant la veille, sauf au départ de Koh Lanta, hors Rattana, hors payé sur place", async () => {
  const { alerteAvantVeille } = await import("../src/gestion/js/operations-calc.mjs");
  const r = (extra = {}) => ({ statut: "confirme", paye_sur_place: false, date_service: "2026-12-10", libelle: "Pakbara → Langkawi", ...extra });
  const ok = alerteAvantVeille(r(), { partenaire: "Bundhaya Speed Boat", trajet: { de: "Pakbara", vers: "Langkawi" } });
  assert.deepEqual(ok, { avant: "2026-12-09", date_service: "2026-12-10" });
  assert.equal(alerteAvantVeille(r(), { partenaire: "Bundhaya Speed Boat", trajet: { de: "Koh Lanta", vers: "Langkawi" } }), null, "départ de Koh Lanta : pas de règle");
  assert.equal(alerteAvantVeille(r(), { partenaire: "Rattana Tour", trajet: { de: "Pakbara", vers: "Langkawi" } }), null, "rien pour Rattana");
  assert.equal(alerteAvantVeille(r({ paye_sur_place: true }), { partenaire: "Bundhaya", trajet: { de: "Pakbara" } }), null);
  assert.equal(alerteAvantVeille(r({ statut: "annule" }), { partenaire: "Bundhaya", trajet: { de: "Pakbara" } }), null);
  assert.equal(alerteAvantVeille(r({ date_service: null }), { partenaire: "Bundhaya", trajet: { de: "Pakbara" } }), null);
  assert.equal(alerteAvantVeille(r(), { partenaire: "Bundhaya", trajet: null }).avant, "2026-12-09", "départ lu dans le libellé quand il n'y a pas de trajet");
  assert.equal(alerteAvantVeille(r({ libelle: "Billet Bundhaya" }), { partenaire: "Bundhaya", trajet: null }), null, "départ inconnu : rien n'est deviné");
  assert.equal(alerteAvantVeille(r(), { partenaire: "Bundhaya", trajet: { de: "Pakbara" }, paye: true }), null, "déjà payé au prestataire");
});
