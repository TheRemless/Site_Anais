// Lot I (décisions de Jérémy du 17.11.2026) : net partiel laissé vide, net et commission saisis en un geste, écart soldé hors de l'encaissé.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reservationsDepuisDocument } from "../src/gestion/js/operations-calc.mjs";
import { champSaisieRapide, montantSaisi } from "../src/gestion/js/nets-reservation-calc.mjs";
import { aVerifier } from "../src/gestion/js/a-verifier-calc.mjs";
import { valeur, lignes, MESURES, DEFINITIONS } from "../src/gestion/js/stats-calc.mjs";
import { analyserLocal, faitsLocal } from "../src/gestion/js/analyses.mjs";
import { empreinteDocument } from "../src/gestion/js/documents-calc.mjs";

let n = 0;
const uid = () => `x${++n}`;
const ligne = (props) => ({ id: uid(), kind: "ligne", partenaire_id: "p1", date_service: "2026-12-01", qte: 1, ...props });

// ---- 1. Net partiel laissé vide -----------------------------------------------------------------------------------
test("net partiel : une ligne à prix sans net laisse le net du service vide, jamais la somme des seuls nets connus", () => {
  const doc = { dossier_id: "d1", contenu: { lignes: [
    ligne({ prestation_id: "s1", libelle: "Tour", intro: "(per adult)", unite: 1000, qte: 2, net: 700 }),
    ligne({ prestation_id: "s1", libelle: "Tour, child", intro: "(per child)", unite: 600, qte: 1, net: null }),
  ] } };
  const [r] = reservationsDepuisDocument(doc, { uid });
  assert.equal(r.reservation.personnes.adultes, 2);
  assert.equal(r.reservation.personnes.enfants, 1);
  assert.equal(r.net, null, "avant : 1400 (les adultes seuls)");
});

test("net complet : la somme des lignes ; une ligne offerte (prix 0) sans net ne bloque pas", () => {
  const doc = { dossier_id: "d1", contenu: { lignes: [
    ligne({ prestation_id: "s1", libelle: "Tour", unite: 1000, qte: 2, net: 700 }),
    ligne({ prestation_id: "s1", libelle: "Tour, child", intro: "(per child)", unite: 600, qte: 1, net: 400 }),
    ligne({ prestation_id: "s2", libelle: "Kayak", unite: 500, qte: 2, net: 300 }),
    ligne({ prestation_id: "s2", libelle: "Kayak, child", intro: "(per child)", unite: 0, qte: 1, net: null }),
  ] } };
  const [tour, kayak] = reservationsDepuisDocument(doc, { uid });
  assert.equal(tour.net, 1800);
  assert.equal(kayak.net, 600);
});

test("net partiel payé sur place : ni net ni commission en % du net", () => {
  const doc = { dossier_id: "d1", contenu: { lignes: [
    ligne({ trajet_id: "t1", libelle: "Speedboat", unite: 1900, qte: 2, net: 1500, paye_sur_place: true }),
    ligne({ trajet_id: "t1", libelle: "Speedboat, child", intro: "(per child)", unite: 1400, qte: 1, net: null, paye_sur_place: true }),
  ] } };
  const [r] = reservationsDepuisDocument(doc, { uid, regleDe: () => ({ type: "pourcent_net", valeur: 10 }) });
  assert.equal(r.net, null);
  assert.equal(r.commission_prevue, undefined);
  // Une règle qui ne dépend pas du net donne toujours sa commission.
  const [r2] = reservationsDepuisDocument(doc, { uid, regleDe: () => ({ type: "fixe_personne", valeur: 100 }) });
  assert.equal(r2.commission_prevue, 300);
});

test("« À vérifier » : le service au net laissé vide apparaît dans « sans net » (payé chez nous) et « sans commission » (sur place)", () => {
  const db = {
    partenaires: [{ id: "p1", nom: "Bateau", actif: true, telephones: [{ numero: "+66812345678", whatsapp: true }] }],
    dossiers: [{ id: "d1", ref: "S-1", client_id: "c1", responsable_id: "u1", annule: false }],
    clients: [{ id: "c1", prenom: "Emma", nom: "Moreau", telephone: "+41791234567" }],
    reservations: [
      { id: "r1", dossier_id: "d1", partenaire_id: "p1", libelle: "Tour", date_service: "2026-12-01", statut: "confirme", montant_vente: 2600, paye_sur_place: false },
      { id: "r2", dossier_id: "d1", partenaire_id: "p1", libelle: "Speedboat", date_service: "2026-12-02", statut: "confirme", montant_vente: 5200, paye_sur_place: true },
      { id: "r3", dossier_id: "d1", partenaire_id: "p1", libelle: "Complet", date_service: "2026-12-03", statut: "confirme", montant_vente: 1000, paye_sur_place: false },
    ],
    reservations_nets: [{ id: "n3", reservation_id: "r3", net_prevu: 700 }],
  };
  const l = aVerifier(db, { droits: { partenaires: true, dossiers: true, clients: true, nets: true }, aujourdhui: "2026-11-17" });
  const par = (cle) => (l.find((c) => c.cle === cle) || { elements: [] }).elements.map((e) => e.id);
  assert.deepEqual(par("services_sans_net"), ["r1"]);
  assert.deepEqual(par("services_sans_commission"), ["r2"]);
  assert.deepEqual(aVerifier(db, { droits: { partenaires: true, dossiers: true, clients: true, nets: true }, aujourdhui: "2026-11-17", taxi: true }).filter((c) => /sans_(net|commission)/.test(c.cle)), [], "rien en Taxi");
});

// ---- 2. Saisie rapide du net ou de la commission ------------------------------------------------------------------
test("saisie rapide : le net d'un service payé chez nous, la commission d'un service payé sur place, seulement s'ils manquent", () => {
  const anais = { nets: true, ecrit: true, taxi: false };
  const r = { id: "r1", partenaire_id: "p1", statut: "confirme", paye_sur_place: false };
  assert.equal(champSaisieRapide(r, null, anais), "net_prevu", "service saisi par Mook : aucune ligne de nets");
  assert.equal(champSaisieRapide(r, { net_prevu: null }, anais), "net_prevu");
  assert.equal(champSaisieRapide(r, { net_prevu: "" }, anais), "net_prevu");
  assert.equal(champSaisieRapide(r, { net_prevu: 0 }, anais), null, "0 est un net saisi");
  assert.equal(champSaisieRapide(r, { net_prevu: 1400 }, anais), null);
  const place = { ...r, paye_sur_place: true };
  assert.equal(champSaisieRapide(place, { net_prevu: null, commission_prevue: null }, anais), "commission_prevue");
  assert.equal(champSaisieRapide(place, { commission_prevue: 220 }, anais), null);
});

test("saisie rapide : réservée au droit « nets » avec l'écriture, jamais en Taxi, ni pour un service annulé ou sans partenaire", () => {
  const r = { id: "r1", partenaire_id: "p1", statut: "confirme", paye_sur_place: false };
  assert.equal(champSaisieRapide(r, null, { nets: false, ecrit: true }), null, "Mook");
  assert.equal(champSaisieRapide(r, null, { nets: true, ecrit: false }), null);
  assert.equal(champSaisieRapide(r, null, { nets: true, ecrit: true, taxi: true }), null, "Taxi garde son geste de commission");
  assert.equal(champSaisieRapide({ ...r, paye_sur_place: true }, null, { nets: true, ecrit: true, taxi: true }), null);
  assert.equal(champSaisieRapide({ ...r, statut: "annule" }, null, { nets: true, ecrit: true }), null);
  assert.equal(champSaisieRapide({ ...r, partenaire_id: null }, null, { nets: true, ecrit: true }), null);
  assert.equal(champSaisieRapide(r, null, { nets: true, ecrit: true, dossierAnnule: true }), null, "dossier annulé");
});

test("montant saisi : espaces, apostrophes et virgule acceptés ; vide, texte et négatif refusés", () => {
  assert.deepEqual(montantSaisi("1 200"), { valeur: 1200 });
  assert.deepEqual(montantSaisi("1'200,50"), { valeur: 1200.5 });
  assert.deepEqual(montantSaisi(" 0 "), { valeur: 0 });
  assert.deepEqual(montantSaisi("12.345"), { valeur: 12.35 });
  assert.deepEqual(montantSaisi(""), { erreur: "vide" });
  assert.deepEqual(montantSaisi("douze"), { erreur: "invalide" });
  assert.deepEqual(montantSaisi("12 THB"), { erreur: "invalide" });
  assert.deepEqual(montantSaisi("-5"), { erreur: "negatif" });
});

test("net d'une ligne de facture complété : l'empreinte d'envoi ne change pas (pas de « modifiée depuis l'envoi »)", () => {
  const doc = { date_emission: "2026-11-17", contenu: { lignes: [{ id: "l1", kind: "ligne", prestation_id: "s1", libelle: "Tour", unite: 1000, qte: 2 }] } };
  const avecNet = { ...doc, contenu: { lignes: [{ ...doc.contenu.lignes[0], net: 700 }] } };
  assert.equal(empreinteDocument(avecNet), empreinteDocument(doc));
});

// ---- 3. Écart soldé hors de l'encaissé ----------------------------------------------------------------------------
const source = () => ({
  dossiers: [{ id: "d1", ref: "S-1", client_id: "c1", accepte_le: "2026-11-02", annule: false }],
  documents: [{ id: "f1", dossier_id: "d1", type: "facture", date_emission: "2026-11-02", created_at: "2026-11-02T08:00:00Z", contenu: { colonnes: "total", devise: "THB", lignes: [{ id: "l1", kind: "ligne", libelle: "Tour", montant: 10000 }] } }],
  paiements: [
    { id: "p1", dossier_id: "d1", date: "2026-11-05", montant: 9960, moyen: "wise", type: "solde" },
    { id: "p2", dossier_id: "d1", date: "2026-11-06", montant: 40, moyen: "", type: "ecart" },
  ],
  clients: [{ id: "c1", prenom: "Emma", nom: "Moreau" }],
  profils: [],
  reglages: { devise: "THB" },
});

test("statistiques : l'écart soldé sort de l'encaissé et se compte à part ; le dossier reste soldé", () => {
  const faits = faitsLocal(source(), { debut: "2026-11-01", fin: "2026-11-30", jour: "2026-11-17", nets: true });
  const c = { du: "2026-11-01", au: "2026-11-30", jour: "2026-11-17", devise: "THB" };
  assert.deepEqual(valeur("encaisse", faits, c), { montant: 9960, nombre: 1 });
  assert.deepEqual(valeur("ecart_solde", faits, c), { montant: 40, nombre: 1 });
  assert.deepEqual(lignes("ecart_solde", faits, c).map((l) => l.id), ["p2"]);
  assert.equal(valeur("a_encaisser", faits, c).montant, 0, "le reste à encaisser compte l'écart comme réglé");
  assert.ok(MESURES.ecart_solde && DEFINITIONS.ecart_solde, "la mesure a sa définition affichée");
});

test("analyses par société : encaissé sans l'écart, écart à part (miroir de la migration 36)", () => {
  const a = analyserLocal(source(), "2026-11-01", "2026-11-30", "2026-11-17");
  assert.deepEqual(a.encaisse_par_mois, [{ mois: "2026-11", devise: "THB", montant: 9960, nombre: 1 }]);
  assert.deepEqual(a.ecart_par_mois, [{ mois: "2026-11", devise: "THB", montant: 40, nombre: 1 }]);
  assert.deepEqual(a.impayes, [], "le dossier reste soldé");
});
