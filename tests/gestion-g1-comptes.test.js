import { test } from "node:test";
import assert from "node:assert/strict";
import { estFraisDeParc, agenda, feuilleDuJour, reservationsDepuisDocument } from "../src/gestion/js/operations-calc.mjs";
import { libelleClient } from "../src/gestion/js/partenaires-calc.mjs";

const frais = { id: "f", dossier_id: "d", libelle: "Koh Rok et Koh Ha, frais de parc", partenaire_id: null, date_service: "2026-11-12", statut: "confirme", heure_pickup: "", personnes: { adultes: 2 } };
const tour = { id: "t", dossier_id: "d", libelle: "4 Islands", partenaire_id: "p1", date_service: "2026-11-12", statut: "confirme", heure_pickup: "08:00", personnes: { adultes: 2 } };

test("frais de parc : une somme à payer sur l'île, pas un service qui part", () => {
  assert.equal(estFraisDeParc(frais), true);
  assert.equal(estFraisDeParc({ ...frais, libelle: "Koh Rok park fee" }), true);
  assert.equal(estFraisDeParc(tour), false);
  assert.equal(estFraisDeParc({ ...frais, partenaire_id: "p1" }), false, "un service d'un partenaire n'est jamais pris pour des frais");
});

test("agenda et feuille du jour : les frais de parc n'y figurent pas (pas de ligne sans heure, pas de groupe sans partenaire)", () => {
  const a = agenda([frais, tour], "2026-11-11");
  assert.deepEqual(a.demain.map((r) => r.id), ["t"]);
  const contexte = { partenaire: () => "Longtail", client: () => ({ prenom: "Ben", nom: "Walker" }) };
  const f = feuilleDuJour([frais, tour], "2026-11-12", contexte);
  assert.equal(f.length, 1, "un seul groupe : celui du partenaire, pas un groupe « sans partenaire »");
  assert.equal(f[0].lignes.length, 1);
});

test("une ligne de frais de parc ne crée pas de réservation", () => {
  const ligne = (id, libelle, partenaire_id) => ({ id, kind: "ligne", libelle, intro: "(par personne)", unite: 400, qte: 2, prestation_id: "x" + id, partenaire_id, date_service: "2026-11-12" });
  const r = reservationsDepuisDocument({ dossier_id: "d1", contenu: { lignes: [ligne("1", "4 Islands", "p1"), ligne("2", "Koh Rok et Koh Ha, frais de parc", null)] } }, { uid: () => "r" });
  assert.equal(r.length, 1);
  assert.equal(r[0].reservation.libelle, "4 Islands");
});

test("traduction : « demi-journée » devient « half day », pas « demi-full day »", () => {
  assert.equal(libelleClient("Kayak mangroves, demi-journée"), "Kayak mangroves, half day");
  assert.equal(libelleClient("Excursion d'une demi-journée"), "Half-day trip");
  assert.equal(libelleClient("Tour de l'île en une journée"), "Island tour, full day");
  assert.equal(libelleClient("4 îles en longtail, journée"), "4 Islands en longtail, full day");
  assert.equal(libelleClient("Koh Rok, 1 demi-journée"), "Koh Rok, 1 half day");
});

import { rappelVeille } from "../supabase/functions/rappels/calc.js";
test("rappel de 18 h : les frais de parc ne comptent pas comme un service qui part", () => {
  const rs = [
    { entite_id: "S", dossier_id: "d1", statut: "confirme", heure_pickup: "08:00", date_service: "2026-11-12", libelle: "4 Islands", partenaire_id: "p1" },
    { entite_id: "S", dossier_id: "d1", statut: "confirme", heure_pickup: "", date_service: "2026-11-12", libelle: "Koh Rok et Koh Ha, frais de parc", partenaire_id: null },
  ];
  const m = rappelVeille(rs, "2026-11-12", { entiteIds: null, nomEntite: () => "Secret" });
  assert.match(m.titre, /^1 service /, "un seul service demain, pas deux");
  assert.doesNotMatch(m.corps, /sans heure/, "pas de fausse alerte « sans heure de pickup »");
});

test("« en retard » : un service passé dont la commission est reçue, le net payé ou qui s'est bien passé ne compte plus", () => {
  const passe = (id, extra = {}) => ({ id, dossier_id: "d", libelle: "Tour " + id, partenaire_id: "p1", date_service: "2026-11-05", statut: "a_demander", heure_pickup: "08:00", personnes: { adultes: 2 }, ...extra });
  const rs = [passe("a"), passe("b"), passe("c"), passe("d", { details: { fait_le: "2026-11-06" } }), passe("e", { statut: "confirme" })];
  const nets = { b: { commission_recue_le: "2026-11-10", commission_recue: 100 }, c: { net_paye: 800 } };
  const sans = agenda(rs, "2026-11-11");
  assert.deepEqual(sans.enRetard.map((r) => r.id), ["a", "b", "c"], "sans les nets : seuls les confirmés et les services marqués « s'est bien passé » sortent");
  const avec = agenda(rs, "2026-11-11", new Set(), { netDe: (r) => nets[r.id] || null });
  assert.deepEqual(avec.enRetard.map((r) => r.id), ["a"], "commission reçue, net payé et « s'est bien passé » sortent du retard");
});

import { etatEnvoisVouchers, detailsAvecEnvoi } from "../src/gestion/js/operations-calc.mjs";
test("vouchers envoyés : une vraie trace par voucher, au client seulement depuis le 14.11.2026", () => {
  const v = (id, extra = {}) => ({ id, partenaire_id: "p1", details: {}, ...extra });
  const rien = etatEnvoisVouchers([v("a"), v("b", { partenaire_id: null })]);
  assert.deepEqual(rien, { total: 2, client: 0, complet: false });
  const partiel = etatEnvoisVouchers([v("a", { details: { envois: { client: "2026-11-11" } } }), v("b", { partenaire_id: null, details: { envois: { client: "2026-11-11" } } })]);
  assert.equal(partiel.client, 2);
  assert.equal(partiel.complet, true, "le client a reçu chaque voucher : c'est complet, le prestataire n'est plus suivi");
  const tout = etatEnvoisVouchers([v("a", { details: { envois: { client: "2026-11-11", prestataire: "2026-11-11" } } }), v("b", { partenaire_id: null, details: { envois: { client: "2026-11-11" } } })]);
  assert.equal(tout.complet, true, "un voucher sans prestataire n'attend que le client");
  assert.equal(etatEnvoisVouchers([]).complet, false, "aucun voucher : rien n'est envoyé");
  assert.deepEqual(detailsAvecEnvoi({ x: 1, envois: { client: "2026-11-01" } }, "prestataire", "2026-11-11"), { x: 1, envois: { client: "2026-11-01", prestataire: "2026-11-11" } }, "ajoute sans effacer");
  assert.deepEqual(detailsAvecEnvoi(null, "client", "2026-11-11"), { envois: { client: "2026-11-11" } });
});

import { normaliserTelephone, chiffres } from "../src/gestion/js/partenaires-calc.mjs";
import { lienWhatsApp } from "../src/gestion/js/operations-calc.mjs";
test("numéro de téléphone : une seule normalisation, +66 deviné seulement pour un partenaire thaï au format local", () => {
  // Clients (jamais de devinette)
  assert.deepEqual(normaliserTelephone("+41 79 123 45 67"), { numero: "+41791234567", raison: "" });
  assert.deepEqual(normaliserTelephone("0041 79 123 45 67"), { numero: "+41791234567", raison: "" }, "« 00 » vaut « + »");
  assert.deepEqual(normaliserTelephone("41791234567"), { numero: "+41791234567", raison: "" }, "indicatif écrit sans le plus");
  assert.deepEqual(normaliserTelephone("079 123 45 67"), { numero: "", raison: "sans_indicatif" }, "un numéro suisse en 0 ne part jamais vers la Thaïlande");
  assert.deepEqual(normaliserTelephone("081-9789025"), { numero: "", raison: "sans_indicatif" }, "même un numéro thaï en 0 est refusé pour un client");
  assert.deepEqual(normaliserTelephone(""), { numero: "", raison: "vide" });
  assert.deepEqual(normaliserTelephone("pas de numéro"), { numero: "", raison: "vide" });
  assert.deepEqual(normaliserTelephone("12 34"), { numero: "", raison: "trop_court" });
  // Partenaires thaïs au format local
  assert.deepEqual(normaliserTelephone("081-9789025", { thaiLocal: true }), { numero: "+66819789025", raison: "" });
  assert.deepEqual(normaliserTelephone("+49 160 123456", { thaiLocal: true }), { numero: "+49160123456", raison: "" }, "un indicatif écrit n'est jamais remplacé");
  // chiffres() : le même résultat, juste le numéro
  assert.equal(chiffres("0041 79 123 45 67"), "+41791234567");
  assert.equal(chiffres("079 123 45 67"), "");
  assert.equal(chiffres("081-9789025", { thaiLocal: true }), "+66819789025");
  // Lien WhatsApp
  assert.equal(lienWhatsApp("0041 79 123 45 67", "Hi"), "https://wa.me/41791234567?text=Hi", "plus de « wa.me/0041… »");
  assert.equal(lienWhatsApp("079 123 45 67", "Hi"), "https://wa.me/?text=Hi", "sans indicatif : WhatsApp laisse choisir le contact");
  assert.equal(lienWhatsApp("081-9789025", "x", { thaiLocal: true }), "https://wa.me/66819789025?text=x");
});
