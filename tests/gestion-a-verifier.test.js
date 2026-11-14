import test from "node:test";
import assert from "node:assert/strict";
import { aVerifier, minutesDepuisHeure, minutesDepuisDuree, ecartDuree } from "../src/gestion/js/a-verifier-calc.mjs";

test("heures et durées écrites à la main : formats courants, null quand on ne comprend pas", () => {
  assert.equal(minutesDepuisHeure("10:30"), 630);
  assert.equal(minutesDepuisHeure("10h30"), 630);
  assert.equal(minutesDepuisHeure("09h00 (départ)"), 540);
  assert.equal(minutesDepuisHeure("matin"), null);
  assert.equal(minutesDepuisHeure("25:00"), null);
  assert.equal(minutesDepuisDuree("3 h"), 180);
  assert.equal(minutesDepuisDuree("1h30"), 90);
  assert.equal(minutesDepuisDuree("Environ 3h00"), 180);
  assert.equal(minutesDepuisDuree("45 min"), 45);
  assert.equal(minutesDepuisDuree("2 heures"), 120);
  assert.equal(minutesDepuisDuree("1 hour"), 60);
  assert.equal(minutesDepuisDuree("variable"), null);
  // Cas relevés par la revue : décimales, sommes, fourchettes, AM/PM.
  assert.equal(minutesDepuisDuree("1.5 h"), 90);
  assert.equal(minutesDepuisDuree("1,5 heures"), 90);
  assert.equal(minutesDepuisDuree("1h+1h"), 120);
  assert.equal(minutesDepuisDuree("2h30 + 1h"), 210);
  assert.equal(minutesDepuisDuree("2 heures (1h+1h)"), 120, "le total d'abord, pas la somme des parties en plus");
  assert.equal(minutesDepuisDuree("1h-1h30"), null, "fourchette : ambiguë");
  assert.equal(minutesDepuisDuree("3 à 4 heures"), null);
  assert.equal(minutesDepuisDuree("45 mn"), 45);
  assert.equal(minutesDepuisHeure("2:30 PM"), 14 * 60 + 30);
  assert.equal(minutesDepuisHeure("12:00 AM"), 0);
});

test("durée d'un trajet : écart avec arrivée moins départ, minuit compris, null si une donnée manque", () => {
  assert.equal(ecartDuree({ depart: "10:30", arrivee: "13:30", duree: "3 h" }), 0);
  assert.equal(ecartDuree({ depart: "10:30", arrivee: "11:30", duree: "3 h" }), 120);
  assert.equal(ecartDuree({ depart: "23:00", arrivee: "01:00", duree: "2 h" }), 0, "passage de minuit");
  assert.equal(ecartDuree({ depart: "10:30", arrivee: "", duree: "3 h" }), null);
  assert.equal(ecartDuree({ depart: "10:30", arrivee: "11:00", duree: "" }), null);
});

const tel = (numero, whatsapp = false) => ({ numero, whatsapp });
const db = () => ({
  partenaires: [
    { id: "p1", nom: "Avec tout", actif: true, contact: { telephones: [tel("+66 81 000 0001", true)] } },
    { id: "p2", nom: "Sans WhatsApp", actif: true, contact: { telephones: [tel("+66 81 000 0002")] } },
    { id: "p3", nom: "Sans téléphone", actif: true, contact: { telephones: [] } },
    { id: "p4", nom: "Inactif sans téléphone", actif: false, contact: {} },
  ],
  trajets: [
    { id: "t1", de: "Lanta", vers: "Phi Phi", partenaire_id: "p1", depart: "10:30", arrivee: "11:30", duree: "1 h", prix_adulte: 900, actif: true },
    { id: "t2", de: "Lanta", vers: "Lipe", partenaire_id: "p1", depart: "10:30", arrivee: "13:30", duree: "1 h", prix_adulte: null, actif: true },
    { id: "t3", de: "Lanta", vers: "Mook", partenaire_id: "p1", depart: "10:30", arrivee: "11:00", duree: "30 min", prix_adulte: 0, actif: true },
    { id: "t4", de: "Lanta", vers: "Krabi", partenaire_id: "p1", depart: "10:30", arrivee: "12:00", duree: "1h30", prix_adulte: 500, actif: false },
  ],
  prestations: [
    { id: "s1", partenaire_id: "p1", famille: "excursion", groupe: "Excursions en groupe", libelle: "4 îles", prix_vente: 1200, actif: true },
    { id: "s2", partenaire_id: "p1", famille: "excursion", groupe: "excursions en groupe ", libelle: "Koh Rok", prix_vente: 0, actif: true },
    { id: "s3", partenaire_id: "p1", famille: "activite", groupe: "", libelle: "Kayak", prix_vente: null, details: { horaires: "Tarif : 900 THB par personne" }, actif: true },
    { id: "s4", partenaire_id: "p1", famille: "activite", groupe: "", libelle: "Plongée", prix_vente: 2800, actif: true },
    { id: "s5", partenaire_id: "p1", famille: "frais", groupe: "", libelle: "Frais de parc", prix_vente: 0, sur_place: true, actif: true },
    { id: "s6", partenaire_id: "p1", famille: "activite", groupe: "", libelle: "Archivée", prix_vente: 0, actif: false },
  ],
  prestations_nets: [{ id: "n1", prestation_id: "s1", net: 800 }, { id: "n4", prestation_id: "s4", net: null }],
  dossiers: [
    { id: "d1", ref: "R1", client_id: "c1", responsable_id: "u1", annule: false },
    { id: "d2", ref: "R2", client_id: "c2", responsable_id: null, annule: false },
    { id: "d3", ref: "R3", client_id: "c2", responsable_id: null, annule: true },
  ],
  clients: [{ id: "c1", prenom: "Emma", nom: "Moreau", telephone: "+41791234567", email: "" }, { id: "c2", prenom: "", nom: "Sans contact", telephone: "", email: "" }, { id: "c3", nom: "Avec e-mail", telephone: "", email: "a@b.ch" }],
  reservations: [
    { id: "r1", dossier_id: "d1", libelle: "Excursion", date_service: "2026-11-01", statut: "a_demander" },
    { id: "r2", dossier_id: "d1", libelle: "Taxi", date_service: "2026-11-02", statut: "demande" },
    { id: "r3", dossier_id: "d1", libelle: "Confirmée", date_service: "2026-11-02", statut: "confirme" },
    { id: "r4", dossier_id: "d1", libelle: "À venir", date_service: "2026-12-02", statut: "a_demander" },
    { id: "r5", dossier_id: "d3", libelle: "Dossier annulé", date_service: "2026-11-01", statut: "a_demander" },
  ],
});
const tous = { partenaires: true, dossiers: true, clients: true, nets: true };
const par = (liste, cle) => (liste.find((c) => c.cle === cle) || { elements: [] }).elements;

test("à vérifier : chaque contrôle repère ses cas, pas les autres", () => {
  const l = aVerifier(db(), { droits: tous, aujourdhui: "2026-11-12" });
  assert.deepEqual(par(l, "trajets_sans_prix").map((x) => x.id), ["t2", "t3"], "prix vide ou à zéro, trajets actifs seulement");
  assert.deepEqual(par(l, "prestations_a_zero").map((x) => x.id), ["s2"], "un prix à zéro (le frais de parc payé sur place et l'archivée ne comptent pas)");
  assert.deepEqual(par(l, "prestations_prix_en_texte").map((x) => x.id), ["s3"]);
  assert.deepEqual(par(l, "prestations_sans_net").map((x) => x.id), ["s3".replace("s3", "s4")].filter(Boolean), "net absent ou vide : la plongée ; ni le prix à zéro ni le texte seul");
  assert.deepEqual(par(l, "groupes_en_double").map((x) => x.texte), ["Excursions en groupe / excursions en groupe "]);
  assert.deepEqual(par(l, "partenaires_sans_telephone").map((x) => x.id), ["p3"], "un partenaire inactif n'est pas signalé");
  assert.deepEqual(par(l, "partenaires_sans_whatsapp").map((x) => x.id), ["p2"], "avec téléphone mais sans WhatsApp");
  assert.deepEqual(par(l, "trajets_duree").map((x) => x.id), ["t2"], "écart de plus de 20 minutes (t3 : 30 min annoncées, 30 min réelles)");
  // Plus de contrôle « réservation passée jamais confirmée » : une réservation saisie est confirmée (14.11.2026).
  assert.ok(!l.some((c) => c.cle === "reservations_passees"));
  assert.deepEqual(par(l, "clients_sans_contact").map((x) => x.id), ["c2"]);
  assert.deepEqual(par(l, "dossiers_sans_responsable").map((x) => x.id), ["d2"], "un dossier annulé n'est pas signalé");
});

test("à vérifier : « à relire » pour les doutes, jamais pour les cas certains ; chaque cas a un lien vers sa fiche", () => {
  const l = aVerifier(db(), { droits: tous, aujourdhui: "2026-11-12" });
  const relire = Object.fromEntries(l.map((c) => [c.cle, c.aRelire]));
  assert.equal(relire.trajets_duree, true);
  assert.equal(relire.groupes_en_double, true);
  assert.equal(relire.prestations_prix_en_texte, true);
  assert.equal(relire.trajets_sans_prix, false);
  for (const c of l) for (const e of c.elements) assert.match(e.lien, /^#\//, `${c.cle} : lien vers la fiche`);
  assert.equal(par(l, "dossiers_sans_responsable")[0].lien, "#/dossier/d2");
  assert.equal(par(l, "partenaires_sans_telephone")[0].lien, "#/partenaire/p3");
  assert.equal(par(l, "clients_sans_contact")[0].lien, "#/client/c2");
});

test("à vérifier : sans le droit « nets » le contrôle des nets n'existe pas, et chaque contrôle suit le droit de qui peut corriger", () => {
  assert.equal(par(aVerifier(db(), { droits: { ...tous, nets: false }, aujourdhui: "2026-11-12" }), "prestations_sans_net").length, 0);
  assert.ok(!aVerifier(db(), { droits: { ...tous, nets: false }, aujourdhui: "2026-11-12" }).some((c) => c.cle === "prestations_sans_net"));
  const seulDossiers = aVerifier(db(), { droits: { dossiers: true }, aujourdhui: "2026-11-12" });
  assert.deepEqual(seulDossiers.map((c) => c.cle).sort(), ["dossiers_sans_responsable"]);
  assert.deepEqual(aVerifier(db(), { droits: {}, aujourdhui: "2026-11-12" }), []);
  // Aucune fuite de net dans les éléments rendus.
  assert.ok(!JSON.stringify(aVerifier(db(), { droits: { ...tous, nets: false }, aujourdhui: "2026-11-12" })).includes("800"));
});

test("à vérifier : une base vide ou incomplète ne plante pas", () => {
  assert.deepEqual(aVerifier({}, { droits: tous, aujourdhui: "2026-11-12" }), []);
  assert.doesNotThrow(() => aVerifier({ partenaires: [{ id: "p" }], prestations: [{ id: "s", actif: true }], trajets: [{ id: "t" }], reservations: [{ id: "r", statut: "demande" }] }, { droits: tous, aujourdhui: "2026-11-12" }));
});

test("à vérifier : les petites phrases composées passent par la traduction fournie", () => {
  const l = aVerifier(db(), { droits: tous, aujourdhui: "2026-11-12", tr: (texte, vars = {}) => `EN:${String(texte).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "")}` });
  assert.match(par(l, "trajets_duree")[0].detail, /EN:durée écrite « 1 h » \(écart 120 min\)/);
});
