import { test } from "node:test";
import assert from "node:assert/strict";
import { modeReglement, SUR_PLACE, CHEZ_NOUS, statutDepuis, resume } from "../src/gestion/js/calc.mjs";
import { modeParDefaut, appliquerModeParDefaut, commissionPrevue, regleDeCommissionComplete, reservationsDepuisDocument, repartirReception, commissionsARecevoir } from "../src/gestion/js/operations-calc.mjs";

const lignePartenaire = (id, extra = {}) => ({ id, kind: "ligne", libelle: "4 Islands", unite: 1000, qte: 2, prestation_id: "p1", partenaire_id: "rattana", date_service: "2026-12-01", ...extra });

test("mode de règlement : un seul drapeau pour la ligne de facture et la réservation", () => {
  assert.equal(modeReglement({ paye_sur_place: true }), SUR_PLACE);
  assert.equal(modeReglement({ paye_sur_place: false }), CHEZ_NOUS);
  assert.equal(modeReglement({}), CHEZ_NOUS);
  assert.equal(modeReglement(null), CHEZ_NOUS);
});

test("mode par défaut d'un partenaire : sur place seulement quand sa fiche le dit", () => {
  assert.equal(modeParDefaut({ regles: { mode_reglement: "sur_place" } }), SUR_PLACE);
  assert.equal(modeParDefaut({ regles: {} }), CHEZ_NOUS);
  assert.equal(modeParDefaut({}), CHEZ_NOUS);
  assert.equal(modeParDefaut(null), CHEZ_NOUS);
});

test("les nouvelles lignes prennent le mode du partenaire, sauf si quelqu'un a déjà choisi", () => {
  const partenaires = { rattana: { regles: { mode_reglement: "sur_place" } }, noom: { regles: {} } };
  const de = (id) => partenaires[id] || null;
  const sortie = appliquerModeParDefaut(
    [lignePartenaire("a"), lignePartenaire("b", { partenaire_id: "noom" }), lignePartenaire("c", { paye_sur_place: false }), { id: "d", kind: "texte", libelle: "Note", partenaire_id: "rattana" }, { id: "e", kind: "bloc", libelle: "Formule" }],
    de
  );
  assert.equal(sortie[0].paye_sur_place, true);
  assert.equal(sortie[1].paye_sur_place, undefined);
  assert.equal(sortie[2].paye_sur_place, false, "un choix explicite n'est pas écrasé");
  assert.equal(sortie[3].paye_sur_place, undefined, "une note n'est pas un service");
  assert.equal(sortie[4].paye_sur_place, undefined);
  assert.equal(partenaires.rattana.regles.mode_reglement, "sur_place", "les lignes d'origine ne sont pas modifiées");
});

test("commission prévue : chaque type de règle, et rien quand une donnée manque", () => {
  const donnees = { vente: 3000, net: 2400, adultes: 2, enfants: 1 };
  assert.equal(commissionPrevue({ type: "pourcent_vente", valeur: 10 }, donnees), 300);
  assert.equal(commissionPrevue({ type: "pourcent_net", valeur: 5 }, donnees), 120);
  assert.equal(commissionPrevue({ type: "fixe_personne", valeur: 100 }, donnees), 300);
  assert.equal(commissionPrevue({ type: "fixe_reservation", valeur: 250 }, donnees), 250);
  assert.equal(commissionPrevue({ type: "pourcent_vente", valeur: 12.5 }, { vente: 1999 }), 249.88);
  assert.equal(commissionPrevue({ type: "pourcent_vente", valeur: 10 }, { vente: null }), null, "sans prix de vente, rien à deviner");
  assert.equal(commissionPrevue({ type: "pourcent_net", valeur: 10 }, { vente: 3000 }), null, "sans net, rien à deviner");
  assert.equal(commissionPrevue({ type: "fixe_personne", valeur: 100 }, { adultes: 0, enfants: 0 }), null);
  assert.equal(commissionPrevue({ type: "inconnu", valeur: 10 }, donnees), null);
  assert.equal(commissionPrevue({ type: "fixe_reservation", valeur: "" }, donnees), null);
  assert.equal(commissionPrevue(null, donnees), null);
  assert.equal(regleDeCommissionComplete({ type: "fixe_personne", valeur: 100 }), true);
  assert.equal(regleDeCommissionComplete({ type: "fixe_personne" }), false);
});

test("réservation créée d'après la facture : la commission se calcule pour un service sur place seulement", () => {
  const doc = { dossier_id: "d1", contenu: { lignes: [lignePartenaire("a", { paye_sur_place: true }), lignePartenaire("b", { libelle: "Transfert", prestation_id: "p2", partenaire_id: "noom" })] } };
  const regleDe = (id) => (id === "rattana" ? { type: "fixe_personne", valeur: 100 } : { type: "fixe_reservation", valeur: 50 });
  const sortie = reservationsDepuisDocument(doc, { regleDe, uid: (() => { let i = 0; return () => `r${++i}`; })() });
  assert.equal(sortie.length, 2);
  const surPlace = sortie.find((x) => x.reservation.libelle === "4 Islands");
  const chezNous = sortie.find((x) => x.reservation.libelle === "Transfert");
  assert.equal(surPlace.reservation.paye_sur_place, true);
  assert.equal(surPlace.commission_prevue, 200, "2 adultes à 100 par personne");
  assert.equal(chezNous.reservation.paye_sur_place, false);
  assert.equal("commission_prevue" in chezNous, false, "un service chez nous n'a pas de commission");
  // Sans règle connue : aucune commission inventée.
  const sans = reservationsDepuisDocument(doc, { regleDe: () => null, uid: () => "x" });
  assert.equal(sans.some((x) => "commission_prevue" in x), false);
});

const netsParId = (table) => (r) => table[r.id] || null;
const resa = (id, extra = {}) => ({ id, dossier_id: "d", partenaire_id: "rattana", date_service: "2026-12-05", statut: "confirme", montant_vente: 1000, paye_sur_place: true, ...extra });

test("rapprochement : le virement se répartit au prorata de la commission prévue et le dernier prend l'arrondi", () => {
  const rs = [resa("a"), resa("b"), resa("c")];
  const nets = netsParId({ a: { commission_prevue: 100 }, b: { commission_prevue: 200 }, c: { commission_prevue: 300 } });
  const exact = repartirReception(rs, nets, 600);
  assert.deepEqual(exact.repartition.map((x) => x.commission_recue), [100, 200, 300]);
  assert.equal(exact.ecart, 0);
  const moins = repartirReception(rs, nets, 500);
  assert.equal(moins.ecart, -100);
  assert.equal(moins.attendu, 600);
  assert.equal(moins.repartition.reduce((s, x) => s + x.commission_recue, 0), 500, "la somme répartie est exactement le montant reçu");
  const plus = repartirReception(rs, nets, 700.01);
  assert.equal(plus.ecart, 100.01);
  assert.equal(Math.round(plus.repartition.reduce((s, x) => s + x.commission_recue, 0) * 100) / 100, 700.01);
});

test("rapprochement : sans commission prévue la répartition est égale, et une réservation déjà réglée n'est pas touchée", () => {
  const rs = [resa("a"), resa("b")];
  const egal = repartirReception(rs, netsParId({}), 300);
  assert.deepEqual(egal.repartition.map((x) => x.commission_recue), [150, 150]);
  const deja = repartirReception(rs, netsParId({ a: { commission_prevue: 100, commission_recue: 100, commission_recue_le: "2026-12-20" }, b: { commission_prevue: 80 } }), 80);
  assert.deepEqual(deja.repartition, [{ reservation_id: "b", commission_recue: 80 }]);
  assert.deepEqual(repartirReception([], netsParId({}), 50).repartition, []);
});

test("commissions à recevoir : une réception datée solde la réservation, l'écart reste visible", () => {
  const rs = [resa("a"), resa("b"), resa("c", { paye_sur_place: false })];
  const nets = netsParId({ a: { commission_prevue: 100, commission_recue: 90, commission_recue_le: "2026-12-20" }, b: { commission_prevue: 200 } });
  const [g] = commissionsARecevoir(rs, nets);
  assert.equal(g.nb, 2, "le service payé chez nous n'est pas là");
  assert.equal(g.commission_prevue, 300);
  assert.equal(g.commission_recue, 90);
  assert.equal(g.reste, 200, "la réservation réglée avec 10 de moins ne laisse pas de reste");
  assert.equal(g.ecart, -10);
  assert.equal(g.nbARecevoir, 1);
  const [fini] = commissionsARecevoir([rs[0]], nets);
  assert.equal(fini.reste, 0);
  assert.equal(fini.nbARecevoir, 0);
});

const reglages = { conditions: { acompte_pct: 30 }, devise: "THB" };
const dossier = (extra = {}) => ({ id: "d1", client_id: "c1", accepte_le: "2026-11-01", annule: false, ...extra });
const facture = (lignes) => ({ id: "f1", dossier_id: "d1", type: "facture", date_emission: "2026-11-02", created_at: "2026-11-02", contenu: { devise: "THB", lignes } });
const ligne = (unite, extra = {}) => ({ id: `l${unite}`, kind: "ligne", libelle: "x", unite, qte: 1, ...extra });

test("statut : un dossier dont tout est payé sur place n'attend jamais de paiement", () => {
  assert.equal(statutDepuis({ annule: false, total: 0, recu: 0, accepteLe: "2026-11-01", devisEnvoyeLe: "2026-10-30", pct: 30, surPlace: 3000 }), "sur_place");
  assert.equal(statutDepuis({ annule: false, total: 0, recu: 0, accepteLe: null, devisEnvoyeLe: "2026-10-30", pct: 30, surPlace: 3000 }), "devis_envoye", "pas encore accepté");
  assert.equal(statutDepuis({ annule: true, total: 0, recu: 0, accepteLe: "2026-11-01", pct: 30, surPlace: 3000 }), "annule");
  assert.equal(statutDepuis({ annule: false, total: 1000, recu: 0, accepteLe: "2026-11-01", pct: 30, surPlace: 3000 }), "accepte", "un mélange attend toujours la part chez nous");
  assert.equal(statutDepuis({ annule: false, total: 0, recu: 0, accepteLe: "2026-11-01", pct: 30, surPlace: 0 }), "accepte", "un document vide n'est pas « sur place »");
});

test("résumé de dossier : documents chargés ou résumé de la base donnent le même statut", () => {
  const tout = facture([ligne(1500, { paye_sur_place: true }), ligne(2500, { paye_sur_place: true })]);
  const charge = resume(dossier(), { documents: [tout], paiements: [], clients: [] }, reglages);
  assert.equal(charge.total, 0);
  assert.equal(charge.surPlace, 4000);
  assert.equal(charge.statut, "sur_place");
  assert.equal(charge.reste, 0);
  // Sans documents chargés : la base fournit le montant payé sur place (migration 19).
  const base = resume(dossier({ total: 0, recu: 0, sur_place: 4000, devise: "THB" }), { documents: [], paiements: [], clients: [] }, reglages);
  assert.equal(base.surPlace, 4000);
  assert.equal(base.statut, "sur_place");
  const melange = resume(dossier(), { documents: [facture([ligne(1500, { paye_sur_place: true }), ligne(1000)])], paiements: [], clients: [] }, reglages);
  assert.equal(melange.total, 1000);
  assert.equal(melange.surPlace, 1500);
  assert.equal(melange.statut, "accepte");
  const ancien = resume(dossier({ total: 1000, recu: 0, devise: "THB" }), { documents: [], paiements: [], clients: [] }, reglages);
  assert.equal(ancien.surPlace, 0, "une base sans la migration 19 ne casse rien");
});

test("commissions à recevoir : une réservation réglée sans commission prévue n'est plus signalée comme manquante", () => {
  const rs = [resa("a"), resa("b")];
  const nets = netsParId({ a: { commission_recue: 75, commission_recue_le: "2026-12-20" } });
  const [g] = commissionsARecevoir(rs, nets);
  assert.equal(g.sansCommission, 1, "seule la réservation encore à régler reste sans commission");
  assert.equal(g.ecart, 75);
});

test("commission « prix de vente moins net » : la marge du service, sans valeur à saisir", () => {
  const regle = { type: "vente_moins_net" };
  assert.equal(commissionPrevue(regle, { vente: 1500, net: 1100 }), 400);
  assert.equal(commissionPrevue(regle, { vente: 1999.5, net: 1500.25 }), 499.25);
  assert.equal(commissionPrevue(regle, { vente: 800, net: 800 }), 0);
  assert.equal(commissionPrevue(regle, { vente: 1500, net: null }), null, "sans net, rien à deviner");
  assert.equal(commissionPrevue(regle, { vente: null, net: 1000 }), null, "sans prix de vente, rien à deviner");
  assert.equal(commissionPrevue(regle, { vente: 900, net: 1000 }), null, "jamais de commission négative");
  assert.equal(regleDeCommissionComplete(regle), true, "aucune valeur n'est demandée pour ce type");
});

test("réservation créée d'après la facture : la marge utilise le net de toutes les lignes, jamais un net partiel", () => {
  const regleDe = () => ({ type: "vente_moins_net" });
  const adulte = lignePartenaire("a", { paye_sur_place: true, unite: 1200, qte: 2, net: 800 });
  const enfant = lignePartenaire("b", { paye_sur_place: true, libelle: "4 Islands, child", intro: "(per child)", unite: 900, qte: 1, net: 600 });
  const complet = reservationsDepuisDocument({ dossier_id: "d1", contenu: { lignes: [adulte, enfant] } }, { regleDe, uid: () => "x" });
  assert.equal(complet.length, 1, "adulte et enfant donnent une seule réservation");
  assert.equal(complet[0].net, 2200);
  assert.equal(complet[0].commission_prevue, 1100, "(2400 + 900) − (1600 + 600)");
  const partiel = reservationsDepuisDocument({ dossier_id: "d1", contenu: { lignes: [adulte, { ...enfant, net: null }] } }, { regleDe, uid: () => "x" });
  assert.equal("commission_prevue" in partiel[0], false, "le net de l'enfant manque : pas de commission devinée");
});
