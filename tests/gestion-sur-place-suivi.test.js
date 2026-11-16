// Frais « sur place » et facture qui suit la réservation (16.11.2026). Parcours d'Anaïs : une prestation de Mr Palm (partenaire payé sur place),
// sans prix, cochée « sur place » par erreur, devenait une note « 0 THB per adult » ; puis la réservation modifiée (libellé, partenaire, prix)
// laissait la facture sur l'ancien service, l'ancien partenaire et 2 500 au lieu de 2 000.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { noteSurPlace, ligneDepuisPrestation, surPlacePossible } from "../src/gestion/js/partenaires-calc.mjs";
import { contenuAvecService, contenuAvecReservation, ecartReservation, attenduDepuisFacture, descriptionService } from "../src/gestion/js/operations-calc.mjs";
import { aVerifier } from "../src/gestion/js/a-verifier-calc.mjs";
import { donneesDemo } from "../src/gestion/js/defauts.mjs";
import { totaux } from "../src/gestion/js/calc.mjs";

const ajouterJours = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const demo = () => donneesDemo("2026-11-16", ajouterJours);
const lire = (f) => fs.readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");

// ---- 1. Note « à régler sur place » -------------------------------------------------------------------------------
test("note sur place : sans prix, aucun montant (le défaut du 16.11 sortait « 0 THB per adult »)", () => {
  const palm = { libelle: "Ceci est un test Mr Palm", prix_vente: null, unite: "veh", sur_place: true, details: {} };
  assert.equal(noteSurPlace(palm, "en"), "To be paid on site in cash: Ceci est un test Mr Palm. Never included by the operators.");
  assert.equal(noteSurPlace(palm, ""), "À régler sur place, en espèces : Ceci est un test Mr Palm. Jamais inclus par les prestataires.");
  assert.ok(!/\b0 THB/.test(noteSurPlace({ ...palm, prix_vente: 0 }, "en")), "un prix à zéro ne s'écrit pas non plus");
  assert.ok(!/\b0 THB/.test(ligneDepuisPrestation(palm, null, { langue: "en" }).libelle));
});

test("note sur place : l'unité du tarif est respectée (véhicule, personne, adulte et enfant), en français et en anglais", () => {
  const base = { libelle: "Entrée", libelle_en: "Entrance", details: {} };
  assert.equal(noteSurPlace({ ...base, prix_vente: 300, unite: "veh" }, "en"), "To be paid on site in cash: Entrance, 300 THB per vehicle. Never included by the operators.");
  assert.equal(noteSurPlace({ ...base, prix_vente: 300, unite: "veh" }, ""), "À régler sur place, en espèces : Entrée, 300 THB par véhicule. Jamais inclus par les prestataires.");
  assert.equal(noteSurPlace({ ...base, prix_vente: 100, unite: "pp" }, "en"), "To be paid on site in cash: Entrance, 100 THB per person. Never included by the operators.");
  assert.equal(noteSurPlace({ ...base, prix_vente: 400, unite: "ad", details: { enfant: 200 } }, ""), "À régler sur place, en espèces : Entrée, 400 THB par adulte et 200 THB par enfant. Jamais inclus par les prestataires.");
  // Un prix enfant ne s'ajoute pas à un tarif par véhicule.
  assert.equal(noteSurPlace({ ...base, prix_vente: 300, unite: "veh", details: { enfant: 100 } }, "en"), "To be paid on site in cash: Entrance, 300 THB per vehicle. Never included by the operators.");
  // Sans unité : le montant seul.
  assert.equal(noteSurPlace({ ...base, prix_vente: 50, unite: "" }, "en"), "To be paid on site in cash: Entrance, 50 THB. Never included by the operators.");
});

test("note sur place : les frais de parc de la démo gardent leur texte", () => {
  const d = demo();
  const frais = d.prestations.filter((x) => x.sur_place);
  assert.ok(frais.length >= 2);
  for (const x of frais) assert.equal(x.famille, "frais", "seuls des frais de parc sont « sur place » dans la démo");
  const rok = frais.find((x) => x.libelle === "Koh Rok and Koh Ha");
  assert.equal(noteSurPlace(rok, "en"), "To be paid on site in cash: Koh Rok and Koh Ha, 400 THB per adult and 200 THB per child. Never included by the operators.");
});

// ---- 2. Fiche prestation ----------------------------------------------------------------------------------------------
test("fiche prestation : la case « sur place » n'existe que pour un frais, et une autre famille l'enregistre à false", () => {
  assert.equal(surPlacePossible("frais"), true);
  for (const f of ["excursion", "activite", "location", "transfert", "autre", "", undefined]) assert.equal(surPlacePossible(f), false);
  const vue = lire("views/partenaires.mjs");
  assert.match(vue, /sur_place: surPlacePossible\(famille\.value\) && surPlace\.checked/, "l'enregistrement remet false hors frais");
  assert.match(vue, /famille\.addEventListener\("change", majSurPlace\)/, "la case suit le changement de famille");
  assert.match(vue, /caseSurPlace\.hidden = !frais/);
  assert.match(vue, /modeParDefaut\(p\) === SUR_PLACE \? tr\("Les clients de \{partenaire\} le paient directement/, "aide pour un partenaire payé sur place");
});

// ---- 3. La facture suit la réservation ------------------------------------------------------------------------------
// Le dossier INV-2026-019 tel qu'Anaïs l'a laissé : la ligne vient du tarif de VIP Taxi Lanta, payé sur place, 2 500 par véhicule.
const ligneVip = { id: "L1", kind: "ligne", titre: "Full-day trip, discovery of Koh Lanta", libelle: "Full-day trip, discovery of Koh Lanta, 20 November 2026", intro: "", unite: 2500, qte: 1, par: "veh", prestation_id: "pVip", partenaire_id: "vip", date_service: "2026-11-20", paye_sur_place: true, net: 2200 };
const autre = { id: "L2", kind: "ligne", titre: "Koh Rok", libelle: "Koh Rok, 2 passengers, 21 November 2026", intro: "", unite: 1500, qte: 2, prestation_id: "pRok", partenaire_id: "longtail", date_service: "2026-11-21" };
const contenuDossier = () => ({ langue: "en", prestataire: "VIP Taxi Lanta, Longtail", lignes: [structuredClone(ligneVip), structuredClone(autre)] });
const resa = { id: "R1", ligne_id: "L1", details: {}, prestation_id: "pVip", partenaire_id: "vip", libelle: "Full-day trip, discovery of Koh Lanta", date_service: "2026-11-20", personnes: { adultes: 2, enfants: 0 }, montant_vente: 2500, paye_sur_place: true };
const noms = { vip: "VIP Taxi Lanta", palm: "Mr Palm", longtail: "Longtail" };
const prestations = { pVip: { id: "pVip", partenaire_id: "vip", unite: "veh", prix_vente: 2500 }, pPalm: { id: "pPalm", partenaire_id: "palm", unite: "veh", prix_vente: null }, pPalmPp: { id: "pPalmPp", partenaire_id: "palm", unite: "pp", prix_vente: 900 } };
const options = { prestationDe: (id) => prestations[id] || null, netDe: (p) => (p.id === "pPalmPp" ? 600 : undefined), nomPartenaire: (id) => noms[id] || "" };

test("facture qui suit : libellé, partenaire et prix changés dans la réservation passent sur la ligne", () => {
  const { contenu, reste } = contenuAvecService(contenuDossier(), resa, { libelle: "Full-day trip, discovery of Koh Lanta by private Songthaew", partenaire_id: "palm", montant_vente: 2000 }, options);
  assert.deepEqual(reste, []);
  const l = contenu.lignes[0];
  assert.equal(l.titre, "Full-day trip, discovery of Koh Lanta by private Songthaew");
  assert.equal(l.libelle, "Full-day trip, discovery of Koh Lanta by private Songthaew, 20 November 2026", "la description générée suit le nom");
  assert.equal(l.partenaire_id, "palm");
  assert.equal(l.unite, 2000);
  assert.equal(l.paye_sur_place, true, "le mode sur place reste");
  assert.equal(contenu.prestataire, "Mr Palm, Longtail", "la mention du prestataire suit");
  assert.deepEqual(contenu.lignes[1], autre, "les autres services ne bougent pas");
  // Plus aucun écart entre la réservation modifiée et la facture.
  assert.equal(ecartReservation({ ...resa, libelle: "Full-day trip, discovery of Koh Lanta by private Songthaew", partenaire_id: "palm", montant_vente: 2000 }, { contenu }), null);
});

test("facture qui suit : changer de partenaire sans tarif détache l'ancien tarif ; choisir un tarif reprend son unité et son net", () => {
  const detache = contenuAvecService(contenuDossier(), resa, { partenaire_id: "palm", prestation_id: null, trajet_id: null }, options).contenu.lignes[0];
  assert.equal(detache.prestation_id, null);
  assert.equal(detache.libre, true, "le service reste un service (hors catalogue), avec sa réservation");
  assert.equal(detache.net, null, "le net de VIP Taxi Lanta ne reste pas sur la ligne de Mr Palm");
  const pp = contenuAvecService(contenuDossier(), resa, { partenaire_id: "palm", prestation_id: "pPalmPp", trajet_id: null, montant_vente: 1800 }, options).contenu.lignes[0];
  assert.equal(pp.prestation_id, "pPalmPp");
  assert.equal(pp.net, 600);
  assert.equal(pp.par, undefined, "plus « par véhicule »");
  assert.equal(pp.qte, 2, "par personne : la quantité devient le nombre de personnes");
  assert.equal(pp.unite, 900, "1 800 pour deux personnes");
  assert.equal(pp.libelle, "Full-day trip, discovery of Koh Lanta, 2 passengers, 20 November 2026");
});

test("facture qui suit : un prix réparti sur plusieurs lignes n'est pas deviné, il est signalé", () => {
  const ad = { id: "a", kind: "ligne", libelle: "Bateau", intro: "(par adulte)", unite: 800, qte: 2, prestation_id: "p", partenaire_id: "x", date_service: "2026-12-10" };
  const en = { id: "e", kind: "ligne", libelle: "Bateau, enfant", intro: "(par enfant)", unite: 500, qte: 1, prestation_id: "pe", partenaire_id: "x", date_service: "2026-12-10" };
  const r = { ligne_id: "a", details: { lignes_ids: ["a", "e"] }, libelle: "Bateau", partenaire_id: "x" };
  const { contenu, reste } = contenuAvecService({ lignes: [ad, en] }, r, { libelle: "Bateau privé", partenaire_id: "y", montant_vente: 2000 }, {});
  assert.deepEqual(contenu.lignes.map((l) => [l.libelle, l.partenaire_id, l.unite]), [["Bateau privé", "y", 800], ["Bateau privé, enfant", "y", 500]], "nom et partenaire sur toutes les lignes, prix inchangé");
  assert.deepEqual(reste.map((x) => x.cle), ["montant_vente"]);
  assert.equal(totaux(contenu).net, 2100);
});

test("facture qui suit : rien ne change quand rien ne diffère ; les notes ne sont jamais touchées", () => {
  const note = { id: "N", kind: "texte", libelle: "To be paid on site in cash: Park.", sur_place: true, prestation_id: "pf" };
  const c = { langue: "en", lignes: [structuredClone(ligneVip), note] };
  assert.equal(contenuAvecService(c, resa, { libelle: resa.libelle, partenaire_id: "vip", montant_vente: 2500 }, options).contenu, null);
  const r2 = { ...resa, ligne_id: "N" };
  assert.equal(contenuAvecService(c, r2, { libelle: "X" }, options).contenu, null, "une réservation ne pointe jamais vers une note");
});

test("facture qui suit : une date changée met aussi à jour la description générée, pas une description réécrite à la main", () => {
  const avant = { date_service: "2026-11-20", personnes: { adultes: 2, enfants: 0 } };
  const apres = { ...avant, date_service: "2026-11-22" };
  const suite = contenuAvecReservation(contenuDossier(), resa, avant, apres).contenu;
  assert.equal(suite.lignes[0].libelle, "Full-day trip, discovery of Koh Lanta, 22 November 2026");
  const fixe = contenuDossier();
  fixe.lignes[0].libelle = "Journée privée sur mesure";
  assert.equal(contenuAvecReservation(fixe, resa, avant, apres).contenu.lignes[0].libelle, "Journée privée sur mesure");
  // La description générée est bien celle de la création (même fonction).
  assert.equal(descriptionService({ ...ligneVip, libelle: ligneVip.titre }, "en"), ligneVip.libelle);
});

test("écart réservation et facture : le libellé et le partenaire sont comparés", () => {
  const doc = { contenu: contenuDossier() };
  const a = attenduDepuisFacture(resa, doc);
  assert.equal(a.libelle, "Full-day trip, discovery of Koh Lanta");
  assert.equal(a.partenaire_id, "vip");
  assert.equal(ecartReservation(resa, doc), null);
  const e = ecartReservation({ ...resa, libelle: "Full-day trip, discovery of Koh Lanta by private Songthaew", partenaire_id: "palm", montant_vente: 2000 }, doc);
  assert.deepEqual(e.champs.map((c) => c.cle), ["montant_vente", "libelle", "partenaire_id"]);
});

test("la fiche de réservation fait suivre la facture : tarif, partenaire, prix, et mode du nouveau partenaire", () => {
  const vue = lire("views/reservations.mjs");
  assert.match(vue, /montantSuit: vente\.value === venteInitiale, service \}\)/, "le formulaire passe ce qui a changé");
  assert.match(vue, /surPlace\.definir\(modeParDefaut\(partenaireDe\(partenaire\.value \|\| null\)\)\);\n\s+tarifTouche = true;\n\s+remplirTarifs\(\);/, "changer de partenaire reprend son mode et ses tarifs");
  assert.match(vue, /peut\("documents\.ecrire"\) && e\.champs\.length \? h\("button"/, "« Mettre la facture comme la réservation » pour tout écart");
  const suivi = lire("views/suivi-facture.mjs");
  assert.match(suivi, /principale\.doc\.envoye_le && !dejaConfirme/, "une facture envoyée demande toujours confirmation");
  assert.match(suivi, /contenuAvecService\(suite, r, service/);
});

// ---- 4. À vérifier ----------------------------------------------------------------------------------------------
test("à vérifier : prestation « sur place » hors frais, note laissée sur une facture, facture différente de sa réservation", () => {
  const db = {
    partenaires: [{ id: "palm", nom: "Mr Palm" }, { id: "vip", nom: "VIP Taxi Lanta" }],
    prestations: [
      { id: "pTest", partenaire_id: "palm", famille: "transfert", libelle: "Ceci est un test Mr Palm", prix_vente: null, unite: "veh", sur_place: true, actif: true },
      { id: "pParc", partenaire_id: null, famille: "frais", libelle: "Koh Rok", prix_vente: 400, unite: "ad", sur_place: true, actif: true },
      { id: "pVip", partenaire_id: "vip", famille: "excursion", libelle: "Full-day trip", prix_vente: 2500, unite: "veh", actif: true },
    ],
    dossiers: [{ id: "d1", ref: "INV-2026-019", responsable_id: "u", annule: false }, { id: "d2", ref: "INV-2026-020", responsable_id: "u", annule: true }],
    documents: [
      { id: "f1", dossier_id: "d1", type: "facture", contenu: { lignes: [structuredClone(ligneVip), { id: "N1", kind: "texte", sur_place: true, prestation_id: "pTest", libelle: "To be paid on site in cash: Ceci est un test Mr Palm, 0 THB per adult." }, { id: "N2", kind: "texte", sur_place: true, prestation_id: "pParc", libelle: "Park fee" }] } },
      { id: "f2", dossier_id: "d2", type: "facture", contenu: { lignes: [{ id: "N3", kind: "texte", sur_place: true, prestation_id: "pTest", libelle: "x" }] } },
    ],
    reservations: [{ ...resa, dossier_id: "d1", libelle: "Full-day trip, discovery of Koh Lanta by private Songthaew", partenaire_id: "palm", montant_vente: 2000 }],
  };
  const droits = { partenaires: true, dossiers: true, clients: true };
  const l = aVerifier(db, { droits });
  const par = (cle) => (l.find((c) => c.cle === cle) || { elements: [] }).elements;
  assert.deepEqual(par("prestations_sur_place_hors_frais").map((x) => x.id), ["pTest"], "les vrais frais de parc ne sont pas signalés");
  assert.deepEqual(par("notes_sur_place_hors_frais").map((x) => [x.id, x.lien]), [["f1:N1", "#/doc/f1"]], "la note de frais de parc reste, le dossier annulé est ignoré");
  const ecarts = par("factures_differentes_reservation");
  assert.equal(ecarts.length, 1);
  assert.equal(ecarts[0].lien, "#/dossier/d1");
  assert.match(ecarts[0].detail, /libellé, partenaire, montant|montant, libellé, partenaire/);
  // Taxi : pas de contrôle facture contre réservation ; sans documents chargés, le contrôle se tait.
  assert.equal(aVerifier(db, { droits, taxi: true }).some((c) => c.cle === "factures_differentes_reservation"), false);
  assert.equal(aVerifier({ ...db, documents: [] }, { droits }).some((c) => c.cle === "factures_differentes_reservation"), false);
  // Chaque contrôle suit le droit de qui peut corriger.
  assert.deepEqual(aVerifier(db, { droits: { partenaires: true } }).map((c) => c.cle).sort(), ["partenaires_sans_telephone", "prestations_sur_place_hors_frais"]);
});

test("à vérifier : la démo des trois entreprises ne signale aucune prestation « sur place » hors frais", () => {
  const d = demo();
  for (const e of new Set(d.prestations.map((x) => x.entite_id))) {
    const db = { prestations: d.prestations.filter((x) => x.entite_id === e), partenaires: [] };
    assert.equal(aVerifier(db, { droits: { partenaires: true } }).some((c) => c.cle === "prestations_sur_place_hors_frais"), false);
  }
});

test("écart réservation et facture : une ligne ancienne sans partenaire (clé absente) ne crée pas de fausse alerte", () => {
  const { partenaire_id, ...sansCle } = structuredClone(ligneVip);
  const doc = { contenu: { lignes: [sansCle] } };
  assert.equal(attenduDepuisFacture(resa, doc).partenaire_id, undefined);
  assert.equal(ecartReservation(resa, doc), null);
  // Une ligne « sans partenaire » explicite (null) est comparée.
  assert.deepEqual(ecartReservation(resa, { contenu: { lignes: [{ ...sansCle, partenaire_id: null }] } }).champs.map((c) => c.cle), ["partenaire_id"]);
});

test("revue : le tarif ne se détache pas sur une modification sans rapport, un nom vide ne se colle pas devant le texte", () => {
  const vue = lire("views/reservations.mjs");
  assert.match(vue, /const tarifChange = tarifTouche && \(/, "seul un geste sur le tarif ou le partenaire change le tarif");
  assert.match(vue, /x\.id === r\.prestation_id\)\)/, "le tarif actuel reste dans la liste, même archivé ou coché sur place");
  assert.match(vue, /choisi\.unite === "day" \? Math\.max\(1, Number\(\(r\.details \|\| \{\}\)\.jours\) \|\| 1\)/, "une location par jour compte ses jours");
  const ancienne = { id: "L", kind: "ligne", libelle: "", unite: 500, qte: 1, prestation_id: "p", partenaire_id: "x" };
  const { contenu } = contenuAvecService({ lignes: [ancienne] }, { ligne_id: "L", details: {} }, { libelle: "Taxi Lanta" }, {});
  assert.equal(contenu.lignes[0].libelle, "Taxi Lanta");
  // Le document de référence est la facture, même quand le devis vient après dans la liste.
  const db = {
    dossiers: [{ id: "d", ref: "R", responsable_id: "u" }],
    documents: [{ id: "f", dossier_id: "d", type: "facture", contenu: { lignes: [structuredClone(ligneVip)] } }, { id: "v", dossier_id: "d", type: "devis", contenu: { lignes: [{ ...structuredClone(ligneVip), unite: 9999 }] } }],
    reservations: [{ ...resa, dossier_id: "d" }],
  };
  assert.equal(aVerifier(db, { droits: { dossiers: true } }).some((c) => c.cle === "factures_differentes_reservation"), false);
});
