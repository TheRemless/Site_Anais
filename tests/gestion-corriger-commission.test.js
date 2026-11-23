// tests/gestion-corriger-commission.test.js : corriger une commission, ou le prix et la commission, depuis À encaisser (23.11.2026, migration 119).
// Jérémy : la commission a dû être baissée après un remboursement partiel au client ; il y aura toujours des cas spéciaux. Motif obligatoire,
// ancien montant gardé, totaux recalculés, déjà reçu gardé, Mr. Brown ne réécrit pas une commission corrigée.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { correctionCommission, derniereCorrection, MOTIFS_CORRECTION, aRecevoirParPartenaire, sommeRestes } from "../src/gestion/js/encaisser-calc.mjs";
import { recalculerCommissions } from "../src/gestion/js/operations-calc.mjs";
import { commissionDuPartenaire, saisieLocale } from "../src/gestion/js/courses-partenaire-calc.mjs";
import { valeurJournal } from "../src/gestion/js/journal-calc.mjs";

const AJD = "2026-11-23";
const MAINTENANT = "2026-11-23T09:00:00.000Z";
const resa = (id, dossier, extra = {}) => ({ id, dossier_id: dossier, partenaire_id: "bateau", date_service: "2026-11-20", statut: "confirme", montant_vente: 2000, paye_sur_place: true, libelle: `Service ${id}`, personnes: { adultes: 2, enfants: 0 }, ...extra });
const corriger = (r, n, choix) => correctionCommission(r, n, { motif: "remboursement_partiel", ...choix }, { ajd: AJD, maintenant: MAINTENANT });
const source = (f) => fs.readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");

test("la commission seule : nouvelle commission prévue, ancienne gardée, motif et date notés, la base ne la recalcule plus", () => {
  const r = resa("a", "D1");
  const res = corriger(r, { commission_prevue: 400, commission_prevue_auto: 400 }, { mode: "commission", commission: 300, note: "  client remboursé de 500  " });
  assert.equal(res.erreur, null);
  assert.equal(res.reservation, null, "le prix ne bouge pas");
  assert.deepEqual(res.nets, { commission_prevue: 300, commission_prevue_auto: null, commission_avant_correction: 400, prix_avant_correction: null, commission_corrigee_le: MAINTENANT, commission_corrigee_motif: "remboursement_partiel", commission_corrigee_note: "client remboursé de 500" });
  assert.equal(res.reste, 300);
  assert.equal(res.solde, false);
});

test("le prix et la commission : la réservation prend le nouveau prix, l'ancien prix est gardé", () => {
  const res = corriger(resa("a", "D1"), { commission_prevue: 400 }, { mode: "prix", prix: 1500, commission: 300, motif: "geste_commercial" });
  assert.equal(res.erreur, null);
  assert.deepEqual(res.reservation, { montant_vente: 1500 });
  assert.equal(res.nets.prix_avant_correction, 2000);
  assert.equal(res.nets.commission_avant_correction, 400);
  // Le prix seul change (commission égale) : c'est une correction valable.
  const seul = corriger(resa("a", "D1"), { commission_prevue: 400 }, { mode: "prix", prix: 1800, commission: 400, motif: "erreur_saisie" });
  assert.equal(seul.erreur, null);
  assert.deepEqual(seul.reservation, { montant_vente: 1800 });
});

test("les refus : montant, prix, motif, note pour « autre », rien qui change, sous le déjà reçu, au-dessus du prix, déjà soldée", () => {
  const r = resa("a", "D1");
  const n = { commission_prevue: 400, commission_recue: 100, commission_partielle_le: "2026-11-21" };
  assert.equal(corriger(r, n, { mode: "commission", commission: null }).erreur, "commission");
  assert.equal(corriger(r, n, { mode: "commission", commission: -5 }).erreur, "commission");
  assert.equal(corriger(r, n, { mode: "commission", commission: 12.345 }).erreur, "commission");
  assert.equal(corriger(r, n, { mode: "prix", prix: 0, commission: 300 }).erreur, "prix");
  assert.equal(corriger(r, n, { mode: "commission", commission: 300, motif: null }).erreur, "motif");
  assert.equal(corriger(r, n, { mode: "commission", commission: 300, motif: "rabais" }).erreur, "motif", "les motifs d'écart d'encaissement ne servent pas ici");
  assert.equal(corriger(r, n, { mode: "commission", commission: 300, motif: "autre", note: "   " }).erreur, "note");
  assert.equal(corriger(r, n, { mode: "commission", commission: 300, motif: "autre", note: "vu avec le partenaire" }).erreur, null);
  assert.equal(corriger(r, n, { mode: "commission", commission: 400 }).erreur, "inchange");
  assert.equal(corriger(r, n, { mode: "commission", commission: 50 }).erreur, "sous_recu");
  assert.equal(corriger(r, n, { mode: "prix", prix: 200, commission: 300 }).erreur, "au_dessus_prix");
  assert.equal(corriger(r, { ...n, commission_recue_le: "2026-11-22" }, { mode: "commission", commission: 300 }).erreur, "reglee");
  assert.deepEqual(MOTIFS_CORRECTION.map(([k]) => k), ["remboursement_partiel", "geste_commercial", "erreur_saisie", "autre"]);
});

test("un dossier en partie encaissé garde ses encaissements, le reste dû suit la nouvelle commission et les totaux restent la somme de la liste", () => {
  const rs = [resa("a", "D1"), resa("b", "D2"), resa("c", "D3")];
  const table = { a: { commission_prevue: 400, commission_recue: 100, commission_partielle_le: "2026-11-21", commission_recue_moyen: "especes" }, b: { commission_prevue: 250 }, c: { commission_prevue: 150 } };
  const netDe = (r) => table[r.id] || null;
  const avant = aRecevoirParPartenaire(rs, netDe, { ajd: AJD });
  assert.equal(avant[0].reste, 300 + 250 + 150);
  const res = corriger(rs[0], table.a, { mode: "commission", commission: 250 });
  assert.equal(res.nets.commission_recue, undefined, "le déjà reçu n'est pas réécrit");
  table.a = { ...table.a, ...res.nets };
  const apres = aRecevoirParPartenaire(rs, netDe, { ajd: AJD });
  const d1 = apres[0].dossiers.find((d) => d.dossier_id === "D1");
  assert.equal(d1.dejaRecu, 100);
  assert.equal(d1.reste, 150);
  assert.equal(apres[0].reste, sommeRestes(apres[0].dossiers));
  assert.equal(apres[0].reste, 150 + 250 + 150);
  assert.equal(table.a.commission_recue_moyen, "especes");
});

test("corrigée au montant déjà reçu : le service est soldé au jour du dernier versement et quitte la liste ; à zéro sans rien de reçu : soldé aujourd'hui", () => {
  const r = resa("a", "D1");
  const partiel = corriger(r, { commission_prevue: 400, commission_recue: 100, commission_partielle_le: "2026-11-21" }, { mode: "commission", commission: 100 });
  assert.equal(partiel.solde, true);
  assert.equal(partiel.nets.commission_recue, 100);
  assert.equal(partiel.nets.commission_recue_le, "2026-11-21");
  const table = { a: { commission_prevue: 400, commission_recue: 100, commission_partielle_le: "2026-11-21", ...partiel.nets } };
  assert.equal(aRecevoirParPartenaire([r], (x) => table[x.id], { ajd: AJD }).length, 0);
  const zero = corriger(r, { commission_prevue: 400 }, { mode: "commission", commission: 0 });
  assert.equal(zero.solde, true);
  assert.equal(zero.nets.commission_recue, 0);
  assert.equal(zero.nets.commission_recue_le, AJD);
});

test("Mr. Brown : sa saisie est effacée par la correction, la commission n'est plus « la sienne » et il ne peut plus la réécrire", () => {
  const n = { commission_prevue: 500, commission_partenaire: 500, commission_partenaire_le: "2026-11-22T10:00:00Z" };
  assert.equal(commissionDuPartenaire(n), true);
  // Même montant (le prix seul change) : la correction l'emporte quand même.
  const res = corriger(resa("t", "T1", { montant_vente: 1800 }), n, { mode: "prix", prix: 1600, commission: 500, motif: "geste_commercial" });
  assert.equal(res.nets.commission_partenaire, null);
  assert.equal(res.nets.commission_partenaire_le, null);
  const corrigee = { ...n, ...res.nets };
  assert.equal(commissionDuPartenaire(corrigee), false);
  // Le mode démo de son écran (coursesLocales) suit la même règle que la base : course verrouillée.
  const reservation = { id: "t", entite_id: "taxi", dossier_id: "T1", partenaire_id: "vip", date_service: "2026-11-24", statut: "confirme", montant_vente: 1600, paye_sur_place: true, personnes: { adultes: 1 } };
  const jeu = (nets) => ({ reservations: [reservation], reservations_nets: [{ reservation_id: "t", ...nets }], dossiers: [{ id: "T1", entite_id: "taxi", client_id: "c", annule: false }], clients: [{ id: "c", entite_id: "taxi", prenom: "Test", nom: "Client" }], partenaires_acces: [{ user_id: "u", partenaire_id: "vip", entite_id: "taxi" }], partenaires: [{ id: "vip", entite_id: "taxi", nom: "VIP test" }], entites: [{ id: "taxi" }], reglages: { taxi: { fonctionnement: "taxi", devise: "THB" } }, profils: [{ user_id: "u", actif: true }], membres: [] });
  assert.equal(saisieLocale(jeu(n), "u", "2026-11-23", "t", 700).commission_prevue, 700, "avant la correction, il peut changer la sienne");
  assert.throws(() => saisieLocale(jeu(corrigee), "u", "2026-11-23", "t", 700), (e) => e.message !== "Course introuvable.");
});

test("le recalcul d'après la règle du partenaire ne défait pas une correction", () => {
  const r = resa("a", "D1");
  const regleDe = () => ({ type: "pourcent_vente", valeur: 20 });
  const sans = recalculerCommissions([r], { regleDe, netDe: () => ({ commission_prevue: 250 }) });
  assert.equal(sans.changements.length, 1, "sans correction, la règle propose 400");
  const avec = recalculerCommissions([r], { regleDe, netDe: () => ({ commission_prevue: 250, commission_corrigee_le: MAINTENANT }) });
  assert.equal(avec.changements.length, 0);
});

test("la trace : dernière correction lue, motif en mots dans le journal", () => {
  assert.equal(derniereCorrection({ commission_prevue: 300 }), null);
  assert.deepEqual(derniereCorrection({ commission_prevue: 300, commission_avant_correction: 400, prix_avant_correction: 2000, commission_corrigee_le: MAINTENANT, commission_corrigee_motif: "remboursement_partiel", commission_corrigee_note: "x" }), { le: "2026-11-23", avant: 400, apres: 300, prixAvant: 2000, motif: "remboursement_partiel", note: "x" });
  assert.equal(valeurJournal("commission_corrigee_motif", "geste_commercial"), "Geste commercial");
  const journal = source("views/journal.mjs");
  for (const k of ["commission_avant_correction", "prix_avant_correction", "commission_corrigee_le", "commission_corrigee_motif", "commission_corrigee_note"]) assert.match(journal, new RegExp(`${k}: N_\\(`), `${k} a un nom dans le journal`);
});

test("l'écran : dossier cliquable avec retour vers À encaisser, bouton Corriger seulement avec les nets et l'écriture, prix par le chemin de la facture", () => {
  const vue = source("views/encaisser-commissions.mjs");
  assert.match(vue, /#\/dossier\/\$\{dossierId\}\?depuis=encaisser/);
  assert.match(vue, /const corrige = ecrit && voitNets\(\);/);
  assert.match(vue, /const corriger = corrige \?/);
  assert.match(vue, /suivreFacture\(frais, valeurs/);
  assert.match(vue, /appliquerChangements\(suivi\.changements\)/);
  assert.match(vue, /lu\(frais\) !== ouverture\.get\(r\.id\)/, "une ligne changée depuis l'ouverture n'est pas écrite");
  assert.match(vue, /chargerDossier\(d\.dossier_id\)\.then\(majRecap\)/, "les factures du dossier sont chargées pour l'avertissement");
  const dossier = source("views/dossier.mjs");
  assert.match(dossier, /get\("depuis"\) === "encaisser" \? h\("a", \{ class: "retour", href: "#\/encaisser" \}/);
  // Mook (sans le droit des nets) ne voit pas l'écran des commissions ; le partenaire a son propre écran.
  assert.match(source("views/encaisser.mjs"), /const voitCommissions = voitNets\(\) && modeExcursions\(\);/);
  assert.doesNotMatch(source("views/courses-partenaire.mjs"), /Corriger la commission|correctionCommission/);
});

test("le voucher et les messages au client ne lisent jamais la correction ni la commission", () => {
  for (const f of ["views/voucher.mjs", "views/voucher-secret.mjs", "views/voucher-taxi.mjs", "views/message-client.mjs", "message-voucher-calc.mjs", "textes-voucher.mjs"]) {
    const s = source(f);
    assert.doesNotMatch(s, /commission_corrigee|commission_avant_correction|prix_avant_correction|commission_prevue|commission_recue/, f);
  }
});

test("la migration 119 : colonnes, motifs contrôlés, refus de Mr. Brown, rejouée en CI", () => {
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-119-corriger-commission.sql", import.meta.url), "utf8");
  for (const c of ["commission_avant_correction", "prix_avant_correction", "commission_corrigee_le", "commission_corrigee_motif", "commission_corrigee_note"]) assert.match(sql, new RegExp(`add column if not exists ${c}`));
  assert.match(sql, /'remboursement_partiel', 'geste_commercial', 'erreur_saisie', 'autre'/);
  assert.match(sql, /n\.commission_corrigee_le is not null then\s+raise exception 'Commission corrigée par l''équipe/);
  assert.ok(fs.existsSync(new URL("../docs/gestion/retour-119-corriger-commission.sql", import.meta.url)));
  const ci = fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /verif-corriger-commission/);
});
