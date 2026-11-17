// Lot J : corrections du contrôle d'ensemble de integration/autonomie (17.11.2026, défauts D2 à D16 et suites du lot I).
import { test } from "node:test";
import assert from "node:assert/strict";
import { netReservationCalcule, calculerNets, suiviDeclencheur, nombre } from "../src/gestion/js/nets-base-local.mjs";
import { prixVenteFige, ligneDepuisPrestation } from "../src/gestion/js/partenaires-calc.mjs";
import { contenuAvecService, ecartReservation, reservationsDepuisDocument, empreinteVoucher } from "../src/gestion/js/operations-calc.mjs";
import { contenuAvecEnfants, lignesIdsAvec, personnesSelonDossier } from "../src/gestion/js/dossier-gestes-calc.mjs";
import { envoiANoter } from "../src/gestion/js/envoi-voucher-calc.mjs";
import { feuilleJour, texteFeuillePartage } from "../src/gestion/js/feuille-calc.mjs";
import { valeurJournal } from "../src/gestion/js/journal-calc.mjs";
import { usagesEnvoi, SECOURS_ENVOI } from "../src/gestion/js/documents-calc.mjs";
import { MESSAGES_DEFAUT } from "../src/gestion/js/defauts.mjs";
import { totaux } from "../src/gestion/js/calc.mjs";

// ---- D2 : la démo recalcule le net prévu comme la base (migration 32) --------------------------------------------------------
const catalogue = () => ({
  prestations: [
    { id: "pe", partenaire_id: "p1", libelle: "Tour E", prix_vente: 1500, unite: "pp", details: { enfant: 900 } },
    { id: "pa", partenaire_id: "p1", libelle: "4 Islands", prix_vente: 1200, unite: "pp" },
    { id: "pac", partenaire_id: "p1", libelle: "4 Islands, enfant", prix_vente: 900, unite: "ch" },
    { id: "frais", partenaire_id: "p1", libelle: "Parc", prix_vente: 400, unite: "pp", sur_place: true },
  ],
  prestations_nets: [{ prestation_id: "pe", net: 1000, net_enfant: 600 }, { prestation_id: "pa", net: 800 }, { prestation_id: "pac", net: 600 }, { prestation_id: "frais", net: 400 }],
  trajets: [{ id: "tr", prix_adulte: 1900, prix_enfant: 1400 }],
  trajets_nets: [{ trajet_id: "tr", net_adulte: 1500, net_enfant: 1000 }],
  dossiers: [{ id: "d1", annule: false }, { id: "d2", annule: true }],
  partenaires_prives: [{ partenaire_id: "p1", commission_regle: { type: "pourcent_net", valeur: 10 } }],
  excursions: (e) => e === "secret",
});

function scenarioEnfant(p, tarif) {
  let k = 0;
  const uid = () => `l${++k}`;
  const adulte = ligneDepuisPrestation(p, { net: p.id === "pe" ? 1000 : 800 }, { qte: 2, date: "2026-12-10", langue: "en", uid });
  const contenu0 = { langue: "en", lignes: [adulte] };
  const [att] = reservationsDepuisDocument({ dossier_id: "d1", contenu: contenu0 }, { uid: () => "r1", regleDe: () => null });
  const r0 = { ...att.reservation, entite_id: "secret" };
  const e = contenuAvecEnfants(contenu0, { ...r0, details: {} }, { personnes: { adultes: 2, enfants: 0 } }, { personnes: { adultes: 2, enfants: 1 } }, { tarifEnfant: () => tarif, uid: () => "enfant", langue: "en" });
  const r1 = { ...r0, personnes: { adultes: 2, enfants: 1, bebes: 0 }, details: { ...r0.details, lignes_ids: lignesIdsAvec({ ...r0, details: {} }, e.ajoutee) } };
  return { r0, r1, doc0: { id: "doc", dossier_id: "d1", type: "facture", contenu: contenu0 }, doc1: { id: "doc", dossier_id: "d1", type: "facture", contenu: e.contenu } };
}

test("D2 : enfant ajouté après coup avec une ligne enfant à net connu, le net prévu suit (prix enfant de la prestation et prestation séparée)", () => {
  for (const [id, tarif, avant, apres] of [["pe", { unite: 900, net: 600 }, 2000, 2600], ["pa", { unite: 900, net: 600, prestation_id: "pac" }, 1600, 2200]]) {
    const cat = catalogue();
    const s = scenarioEnfant(cat.prestations.find((x) => x.id === id), tarif);
    const n0 = calculerNets(s.r0, null, { ...cat, documents: [s.doc0] });
    assert.equal(n0.net_prevu, avant);
    assert.equal(n0.net_prevu_auto, avant);
    const suivi = suiviDeclencheur(s.r0, s.r1);
    assert.deepEqual(suivi, { suivreNet: true });
    const n1 = calculerNets(s.r1, n0, { ...cat, documents: [s.doc1] }, suivi);
    assert.equal(n1.net_prevu, apres, `${id} : net prévu après l'enfant`);
    // Sans les nets dans les lignes (rôle de Mook) : ceux du catalogue, net enfant compris.
    const sansNets = { ...s.doc1, contenu: { ...s.doc1.contenu, lignes: s.doc1.contenu.lignes.map(({ net, ...l }) => l) } };
    assert.equal(netReservationCalcule(s.r1, { ...cat, documents: [sansNets] }).net, apres, `${id} : catalogue`);
  }
});

test("D2 : un net saisi à la main, payé, ou un service annulé ne bougent pas ; Taxi et ZTP n'ont rien", () => {
  const cat = catalogue();
  const s = scenarioEnfant(cat.prestations[0], { unite: 900, net: 600 });
  const db = { ...cat, documents: [s.doc1] };
  assert.equal(calculerNets(s.r1, { net_prevu: 2500, net_prevu_auto: 2000 }, db), null, "saisi à la main");
  assert.equal(calculerNets(s.r1, { net_prevu: 2000, net_prevu_auto: 2000, net_paye: 2000 }, db), null, "payé");
  assert.equal(calculerNets(s.r1, { net_prevu: 2000, net_prevu_auto: null }, db), null, "net d'avant la migration : compte comme saisi");
  assert.equal(calculerNets({ ...s.r1, statut: "annule" }, null, db), null);
  assert.equal(calculerNets({ ...s.r1, dossier_id: "d2" }, null, db), null);
  assert.equal(calculerNets({ ...s.r1, entite_id: "taxi" }, null, db), null);
  // Prix vendu seul changé : le net calculé reste celui de la vente.
  assert.deepEqual(suiviDeclencheur(s.r1, { ...s.r1, montant_vente: 9 }), { suivreNet: false });
  assert.equal(suiviDeclencheur(s.r1, { ...s.r1, heure_pickup: "09:00", details: { ...s.r1.details, remarques: "x" } }), null, "heure ou remarques : rien");
});

test("D2 : réservation à la main (sans ligne), trajet, frais sur place, commission payée sur place, comme la base", () => {
  const cat = catalogue();
  const r = (x) => ({ id: "r", entite_id: "secret", dossier_id: "d1", statut: "confirme", ...x });
  assert.equal(netReservationCalcule(r({ prestation_id: "pa", personnes: { adultes: 2, enfants: 1 } }), cat).net, 2400);
  assert.equal(netReservationCalcule(r({ trajet_id: "tr", personnes: { adultes: 2, enfants: 1 } }), cat).net, 4000);
  assert.equal(netReservationCalcule(r({ prestation_id: "frais", personnes: { adultes: 2 } }), cat).net, null);
  assert.equal(netReservationCalcule(r({ prestation_id: null, personnes: { adultes: 2 } }), cat).net, null);
  const n = calculerNets(r({ prestation_id: "pa", partenaire_id: "p1", paye_sur_place: true, montant_vente: 2400, personnes: { adultes: 2 } }), null, cat);
  assert.deepEqual(n, { net_prevu: 1600, net_prevu_auto: 1600, commission_prevue: 160, commission_prevue_auto: 160 });
  assert.equal(nombre(" 12.5 "), 12.5);
  assert.equal(nombre("abc"), null);
});

// ---- D3 : prix venus du catalogue figés sans le droit « partenaires.prix » ----------------------------------------------------------
test("D3 : un prix venu du catalogue est figé sans le droit, un prix vide ou hors catalogue reste libre", () => {
  const cat = catalogue();
  assert.equal(prixVenteFige({ prestation_id: "pe", montant_vente: 3000 }, cat), true, "réservation d'un tarif");
  assert.equal(prixVenteFige({ prestation_id: "pe", montant_vente: 3000 }, cat, { droitPrix: true }), false, "avec le droit");
  assert.equal(prixVenteFige({ prestation_id: "pe", montant_vente: null }, cat), false, "prix vide : à remplir");
  assert.equal(prixVenteFige({ prestation_id: null, montant_vente: 900 }, cat), false, "hors catalogue");
  assert.equal(prixVenteFige({ prestation_id: "pe", unite: 1500, qte: 2 }, cat), true, "ligne de facture d'un tarif");
  assert.equal(prixVenteFige({ trajet_id: "tr", unite: 1900 }, cat), true, "ligne de trajet");
  const aSaisir = { ...cat, prestations: [{ id: "vide", prix_vente: null }] };
  assert.equal(prixVenteFige({ prestation_id: "vide", unite: 700 }, aSaisir), false, "tarif « prix à saisir » : rempli par Mook");
});

// ---- D4 : changer le partenaire ou le tarif d'un service adulte + enfant --------------------------------------------------------
test("D4 : un nouveau tarif donne son net à la ligne adulte et son net enfant à la ligne enfant", () => {
  const lignes = [
    { id: "a", kind: "ligne", libelle: "Transfer", intro: "(per person)", unite: 1500, qte: 1, prestation_id: "old", partenaire_id: "p0", net: 1200 },
    { id: "c", kind: "ligne", libelle: "Transfer, child", intro: "(per child)", unite: 900, qte: 1, prestation_id: "old", partenaire_id: "p0", net: 700 },
  ];
  const r = { ligne_id: "a", details: { lignes_ids: ["a", "c"] }, personnes: { adultes: 1, enfants: 1 } };
  const opts = { prestationDe: (id) => catalogue().prestations.find((p) => p.id === id), netDe: (p) => ({ pe: 1000 })[p.id], tarifEnfantDe: (pid) => (pid === "pe" ? { unite: 900, net: 600 } : null) };
  const { contenu } = contenuAvecService({ lignes }, r, { partenaire_id: "p1", prestation_id: "pe", trajet_id: null }, opts);
  const [a, c] = contenu.lignes;
  assert.equal(a.prestation_id, "pe");
  assert.equal(a.net, 1000);
  assert.equal(c.prestation_id, "pe");
  assert.equal(c.net, 600, "net enfant du nouveau tarif, pas celui de l'ancien partenaire");
  // Hors catalogue chez le nouveau partenaire : aucun net plutôt que celui de l'ancien.
  const libre = contenuAvecService({ lignes }, r, { partenaire_id: "p1", prestation_id: null, trajet_id: null }, opts).contenu;
  assert.ok(libre.lignes.every((l) => l.net === null && l.libre));
});

// ---- D5 et D6 : envoi noté à la main, empreinte sans le paiement de l'agence ---------------------------------------------------
test("D5 : « Marquer renvoyé » note un envoi fait hors de WhatsApp, même déjà noté ce jour quand le voucher a changé", () => {
  assert.equal(envoiANoter({ pour: "client", issue: "manuel", envois: {}, date: "2026-11-17" }), "client");
  assert.equal(envoiANoter({ pour: "client", issue: "manuel", envois: { client: "2026-11-17" }, date: "2026-11-17" }), null);
  assert.equal(envoiANoter({ pour: "client", issue: "manuel", envois: { client: "2026-11-17" }, date: "2026-11-17", modifie: true }), "client");
  assert.equal(envoiANoter({ pour: "client", issue: "annule", envois: {}, date: "2026-11-17" }), null);
});

test("D6 : un paiement reçu ne change pas l'empreinte du voucher, le paiement sur place si", () => {
  const r = { libelle: "Tour", date_service: "2026-12-01", personnes: { adultes: 2 } };
  const e = (statut) => empreinteVoucher({ reservation: r, client: { prenom: "Ann" }, statut, devise: "THB" });
  assert.equal(e("en_attente"), e("acompte"));
  assert.equal(e("en_attente"), e("paye"));
  assert.notEqual(e("en_attente"), e("sur_place"));
});

// ---- D7 : prestation à 0 = offerte -----------------------------------------------------------------------------------------------
test("D7 : une prestation à 0 au catalogue arrive en facture marquée offerte, un prix vide non", () => {
  const offerte = ligneDepuisPrestation({ id: "x", libelle: "Welcome drink", prix_vente: 0, unite: "pp" }, null, { qte: 2, uid: () => "l" });
  assert.equal(offerte.offert, true);
  assert.equal(totaux({ lignes: [offerte] }).net, 0);
  const vide = ligneDepuisPrestation({ id: "y", libelle: "Tour", prix_vente: null, unite: "pp" }, null, { qte: 2, uid: () => "l" });
  assert.equal(vide.offert, undefined);
  assert.equal(ligneDepuisPrestation({ id: "z", libelle: "Tour", prix_vente: 1500, unite: "pp" }, null, { uid: () => "l" }).offert, undefined);
});

// ---- D8 : personnes du dossier ---------------------------------------------------------------------------------------------------
test("D8 : un service sans ligne enfant ou sans personnes prend les adultes et enfants du dossier", () => {
  const d = { adultes: 2, enfants: 1 };
  assert.deepEqual(personnesSelonDossier({ adultes: 3, enfants: 0 }, d), d, "par personne : 3 facturés = 2 + 1");
  assert.deepEqual(personnesSelonDossier({ adultes: 2, enfants: 0 }, d, "ad"), d, "par adulte : l'enfant n'est pas facturé mais vient");
  assert.equal(personnesSelonDossier({ adultes: 2, enfants: 0 }, d, "pp"), null, "par personne pour 2 : rien de deviné");
  assert.deepEqual(personnesSelonDossier({ adultes: 0, enfants: 0 }, d), d, "par véhicule");
  assert.equal(personnesSelonDossier({ adultes: 2, enfants: 1 }, d), null, "ligne enfant : déjà juste");
  assert.equal(personnesSelonDossier({ adultes: 5, enfants: 0 }, d), null, "autre quantité : rien de deviné");
  assert.equal(personnesSelonDossier({ adultes: 3 }, { adultes: 3, enfants: 0 }), null);
  // La facture qui compte 3 personnes au prix adulte n'est pas en écart avec 2 adultes + 1 enfant repris du dossier.
  const doc = { contenu: { lignes: [{ id: "a", kind: "ligne", libelle: "Tour", intro: "(per person)", unite: 1000, qte: 3, prestation_id: "pa", date_service: "2026-12-01" }] } };
  const r = { ligne_id: "a", date_service: "2026-12-01", personnes: { adultes: 2, enfants: 1 }, montant_vente: 3000, details: { personnes_du_dossier: true } };
  assert.ok(!(ecartReservation(r, doc) || { champs: [] }).champs.some((c) => c.cle === "personnes"));
  const sansMarque = { ...r, details: {} };
  assert.ok(ecartReservation(sansMarque, doc).champs.some((c) => c.cle === "personnes"), "saisi à la main : l'écart reste signalé");
});

// ---- D14 : feuille du jour -------------------------------------------------------------------------------------------------------
test("D14 : un transfert par véhicule prend les passagers du dossier, jamais « 0 passengers »", () => {
  const ctx = { partenaire: () => "Ferry démo", client: () => ({ prenom: "Paul" }) };
  const rs = [
    { id: "t", dossier_id: "d", partenaire_id: "f", date_service: "2026-11-25", libelle: "Transfer", personnes: { adultes: 0, enfants: 0 }, statut: "confirme" },
    { id: "x", dossier_id: "d", partenaire_id: "y", date_service: "2026-11-26", libelle: "Tour", personnes: { adultes: 2, enfants: 1 }, statut: "confirme" },
  ];
  const [g] = feuilleJour(rs, "2026-11-25", ctx);
  assert.equal(g.adultes, 2);
  assert.equal(g.enfants, 1);
  assert.match(texteFeuillePartage(g, "2026-11-25"), /2 adults, 1 child/);
  const [seul] = feuilleJour([rs[0]], "2026-11-25", ctx);
  assert.doesNotMatch(texteFeuillePartage(seul, "2026-11-25"), /0 passengers/);
});

// ---- D13 : journal ---------------------------------------------------------------------------------------------------------------
test("D13 : le journal dit les noms, pas les identifiants", () => {
  const ctx = { prestations: [{ id: "dc8095fc-b493-4f00-8000-000000000001", libelle: "Krabi Airport → Koh Lanta" }], partenaires: [{ id: "p", nom: "Ferry démo" }], trajets: [], clients: [], personnes: new Map() };
  assert.equal(valeurJournal("prestation_id", "dc8095fc-b493-4f00-8000-000000000001", ctx), "Krabi Airport → Koh Lanta");
  assert.equal(valeurJournal("partenaire_id", "p", ctx), "Ferry démo");
  assert.equal(valeurJournal("prestation_id", "inconnue", ctx), "(supprimé)");
  assert.equal(valeurJournal("prestation_id", null, ctx), "vide");
  assert.equal(valeurJournal("personnes", { adultes: 2, enfants: 1 }, ctx), "2 adultes, 1 enfant");
  assert.equal(valeurJournal("paye_sur_place", true, ctx), "oui");
  assert.equal(valeurJournal("autre", "dc8095fc-b493-4f00-8000-000000000001", ctx), "(fiche liée)");
  const d = valeurJournal("details", { lignes_ids: ["dc8095fc-b493-4f00-8000-000000000001", "dc8095fc-b493-4f00-8000-000000000002"], remarques: "Aisle seat" }, ctx);
  assert.doesNotMatch(d, /dc8095fc/);
  assert.match(d, /lignes de facture : 2/);
  assert.equal(valeurJournal("details", {}, ctx), "vide");
});

// ---- D16 : renvoi d'une facture corrigée ------------------------------------------------------------------------------------------
test("D16 : une facture corrigée repart avec le modèle « facture mise à jour », en français et en anglais", () => {
  assert.deepEqual(usagesEnvoi("facture", { renvoi: true }), { message: "renvoi_facture", objet: "objet_renvoi_facture" });
  assert.deepEqual(usagesEnvoi("facture"), { message: "envoi_facture", objet: "objet_facture" });
  assert.deepEqual(usagesEnvoi("devis", { renvoi: true }), { message: "envoi_devis", objet: "objet_devis" });
  for (const langue of ["fr", "en"]) {
    assert.match(SECOURS_ENVOI[langue].renvoi_facture, /\{numero\}/);
    assert.match(SECOURS_ENVOI[langue].objet_renvoi_facture, /\{numero\}/);
  }
  assert.equal(MESSAGES_DEFAUT.filter((m) => /renvoi_facture$/.test(m.cle)).length, 4);
});

// ---- Lot I, suite : écarts soldés à part dans la vue par société ----------------------------------------------------------------
test("lot I : la vue par société montre les écarts soldés à part, hors de l'encaissé", async () => {
  const { syntheseEntite, consolider } = await import("../src/gestion/js/groupe.mjs");
  const vide = { facture_par_mois: [], impayes: [], pipeline: [], devis: {}, activite: {}, top_clients: [], par_pays: [], par_responsable: [] };
  const s = syntheseEntite({ entite: { id: "2", nom: "Secret" }, donnees: { ...vide, encaisse_par_mois: [{ mois: "2026-10", devise: "THB", montant: 16000, nombre: 4 }], ecart_par_mois: [{ mois: "2026-10", devise: "THB", montant: 10, nombre: 1 }] }, precedent: null, cible: "THB", taux: { THB: 1 }, mode: "excursions" });
  assert.equal(s.encaisse, 16000, "l'écart ne gonfle pas l'encaissé");
  assert.equal(s.ecarts, 10);
  assert.equal(s.nbEcarts, 1);
  const z = syntheseEntite({ entite: { id: "1", nom: "ZTP" }, donnees: { ...vide, encaisse_par_mois: [] }, precedent: null, cible: "THB", taux: { THB: 1 } });
  assert.equal(z.ecarts, 0, "une entreprise sans écart (ou une ancienne base sans la série) : 0");
  const g = consolider([s, z]);
  assert.equal(g.ecarts, 10);
  assert.equal(g.nbEcarts, 1);
});

// ---- D9 : un service payé sur place dont la ligne compte les enfants au prix adulte suit les personnes ----------------------------
test("D9 et D8 : la ligne qui compte adultes + enfants au prix adulte suit le nombre total de personnes, sans ligne enfant en plus", async () => {
  const { contenuAvecReservation } = await import("../src/gestion/js/operations-calc.mjs");
  const { montantSurPlace } = await import("../src/gestion/js/calc.mjs");
  const l = { id: "a", kind: "ligne", libelle: "Sunset", titre: "Sunset", intro: "", unite: 700, qte: 3, prestation_id: "p", date_service: "2026-11-25", paye_sur_place: true };
  const r = { ligne_id: "a", details: { personnes_du_dossier: true }, personnes: { adultes: 2, enfants: 1 } };
  const avant = { date_service: "2026-11-25", personnes: { adultes: 2, enfants: 1 } };
  const s = contenuAvecReservation({ lignes: [l] }, r, avant, { date_service: "2026-11-25", personnes: { adultes: 3, enfants: 1 } });
  assert.equal(s.contenu.lignes[0].qte, 4);
  assert.equal(montantSurPlace(s.contenu), 2800, "le total sur place change : l'aperçu peut le montrer");
  const e = contenuAvecReservation({ lignes: [l] }, r, avant, { date_service: "2026-11-25", personnes: { adultes: 2, enfants: 2 } }).contenu;
  assert.equal(e.lignes[0].qte, 4);
  const plus = contenuAvecEnfants(e, r, avant, { personnes: { adultes: 2, enfants: 2 } }, { tarifEnfant: () => ({ unite: 400, net: 300 }), uid: () => "x" });
  assert.equal(plus.ajoutee, null, "pas de ligne enfant en plus des enfants déjà comptés");
});

// ---- Revue de la PR 217 par la session principale -----------------------------------------------------------------------------
test("revue 1 : les personnes du dossier se relisent à chaque service créé, une réservation créée juste avant compte", async () => {
  const { personnesPourService, personnesSelonDossier } = await import("../src/gestion/js/dossier-gestes-calc.mjs");
  // Dossier sans réservation, « Créer 2 réservations depuis la facture » : une excursion pour 2 adultes, puis un transfert par véhicule.
  const creees = [];
  const excursion = { personnes: { adultes: 2, enfants: 0 } };
  const d1 = personnesPourService({ duDossier: true, reservations: creees });
  assert.equal(d1, null, "rien encore dans le dossier");
  creees.push({ ...excursion, statut: "confirme" });
  const d2 = personnesPourService({ duDossier: true, reservations: creees });
  assert.deepEqual(personnesSelonDossier({ adultes: 0, enfants: 0 }, d2, "veh"), { adultes: 2, enfants: 0 }, "le transfert prend les 2 adultes de l'excursion créée juste avant");
  assert.deepEqual(personnesPourService({ fixes: { adultes: 2, enfants: 1 }, duDossier: true, reservations: creees }), { adultes: 2, enfants: 1 }, "les personnes du Nouveau dossier passent d'abord");
  assert.equal(personnesPourService({ reservations: creees }), null, "création depuis une facture sans reprise : rien");
});

test("revue 2 : le prix figé d'un service à la main suit les adultes et les enfants, prix enfant compris", async () => {
  const { venteDuTarif } = await import("../src/gestion/js/demande-calc.mjs");
  const pp = { id: "pp", partenaire_id: "p", famille: "excursion", libelle: "Tour", prix_vente: 1200, unite: "pp", details: {} };
  assert.equal(venteDuTarif({ prestation: pp, adultes: 2 }), 2400);
  assert.equal(venteDuTarif({ prestation: pp, adultes: 3 }), 3600, "de 2 à 3 adultes : 3 600, pas 2 400");
  assert.equal(venteDuTarif({ prestation: pp, adultes: 2, enfants: 1 }), 3600, "sans prix enfant : l'enfant au prix par personne");
  const avecEnfant = { ...pp, details: { enfant: 900 } };
  assert.equal(venteDuTarif({ prestation: avecEnfant, adultes: 2, enfants: 1 }), 3300);
  const separee = { id: "pc", partenaire_id: "p", famille: "excursion", libelle: "Tour, enfant", prix_vente: 800, unite: "ch" };
  assert.equal(venteDuTarif({ prestation: pp, adultes: 2, enfants: 1, prestations: [pp, separee] }), 3200, "prestation enfant séparée");
  assert.equal(venteDuTarif({ prestation: { ...pp, unite: "veh", prix_vente: 2500 }, adultes: 4 }), 2500, "par véhicule : un seul prix");
  assert.equal(venteDuTarif({ prestation: { ...pp, unite: "day", prix_vente: 300 }, jours: 3 }), 900);
  assert.equal(venteDuTarif({ trajet: { prix_adulte: 1900, prix_enfant: 1400 }, adultes: 2, enfants: 1 }), 5200);
  assert.equal(venteDuTarif({ prestation: { ...pp, prix_vente: null }, adultes: 2 }), null, "prix à saisir : rien d'imposé");
});

test("revue 3 : une ligne adulte qui compte un enfant ne prend un adulte de plus que si le tarif n'a pas de prix enfant", async () => {
  const { contenuAvecReservation } = await import("../src/gestion/js/operations-calc.mjs");
  const l = { id: "a", kind: "ligne", libelle: "Tour", titre: "Tour", intro: "(per person)", unite: 1200, qte: 3, prestation_id: "pp" };
  const r = { ligne_id: "a", details: {}, personnes: { adultes: 2, enfants: 1 } };
  const avant = { personnes: { adultes: 2, enfants: 1 } };
  const apres = { personnes: { adultes: 2, enfants: 2 } };
  // Le tarif a un prix enfant : la ligne adulte ne bouge pas, l'enfant ajouté reçoit sa ligne enfant.
  const avecPrix = contenuAvecReservation({ lignes: [l] }, r, avant, apres, { tarifEnfant: () => ({ unite: 900, net: 600 }) });
  assert.equal(avecPrix.contenu, null);
  const e = contenuAvecEnfants({ lignes: [l] }, r, avant, apres, { tarifEnfant: () => ({ unite: 900, net: 600 }), uid: () => "enf" });
  assert.equal(e.ajoutee, "enf");
  // Sans prix enfant, ou enfants repris du dossier : la ligne suit le total.
  assert.equal(contenuAvecReservation({ lignes: [l] }, r, avant, apres, { tarifEnfant: () => null }).contenu.lignes[0].qte, 4);
  assert.equal(contenuAvecReservation({ lignes: [l] }, { ...r, details: { personnes_du_dossier: true } }, avant, apres).contenu.lignes[0].qte, 4);
  assert.equal(contenuAvecReservation({ lignes: [l] }, r, avant, apres).contenu, null, "sans rien savoir du tarif : pas de devinette");
});
