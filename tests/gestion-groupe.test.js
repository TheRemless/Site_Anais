// tests/gestion-groupe.test.js : consolidation des chiffres de plusieurs sociétés dans une devise.
const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../src/gestion/js/groupe.mjs");

const ztp = { nom: "ZTP", devise: "CHF", taux: { eur: 1.058, thb: 40.54 } };
const secret = { nom: "Secret", devise: "THB", taux: { eur: 0.026, thb: 1 } };

test("tauxDepuisReglages : déduits des réglages, la première source gagne, rien n'est deviné", async () => {
  const { tauxDepuisReglages } = await load();
  const enChf = tauxDepuisReglages([ztp, secret], "CHF");
  assert.equal(enChf.taux.CHF, 1);
  assert.equal(enChf.taux.THB, Math.round((1 / 40.54) * 1e6) / 1e6);
  assert.equal(enChf.source.THB, "ZTP");
  assert.equal(enChf.taux.USD, undefined);
  const enThb = tauxDepuisReglages([ztp, secret], "THB");
  assert.equal(enThb.taux.CHF, 40.54, "1 CHF = 40.54 THB d'après les réglages de ZTP");
  assert.equal(enThb.source.CHF, "ZTP");
  const enEur = tauxDepuisReglages([ztp, secret], "EUR");
  assert.equal(enEur.taux.CHF, 1.058);
  assert.equal(enEur.taux.THB, 0.026, "1 THB en euros d'après les réglages de Secret");
});

test("sommeConvertie : convertit ce qu'elle peut et signale les devises sans taux", async () => {
  const { sommeConvertie } = await load();
  const r = sommeConvertie([{ devise: "CHF", montant: 100 }, { devise: "THB", montant: 4054 }, { devise: "USD", montant: 10 }], "CHF", { CHF: 1, THB: 1 / 40.54 });
  assert.equal(r.montant, 200);
  assert.deepEqual(r.manquantes, ["USD"]);
});

test("periodePrecedente et evolution", async () => {
  const { periodePrecedente, evolution } = await load();
  assert.deepEqual(periodePrecedente("2026-10-01", "2026-10-31"), ["2026-08-31", "2026-09-30"]);
  assert.deepEqual(periodePrecedente("2026-01-01", "2026-12-31"), ["2025-01-01", "2025-12-31"]);
  assert.equal(evolution(120, 100), 20);
  assert.equal(evolution(80, 100), -20);
  assert.equal(evolution(50, 0), null);
});

test("syntheseEntite et consolider : totaux du groupe et part de chaque société", async () => {
  const { syntheseEntite, consolider } = await load();
  const taux = { CHF: 1, THB: 0.025 };
  const a = syntheseEntite({
    entite: { id: "1", nom: "ZTP" },
    donnees: { facture_par_mois: [{ mois: "2026-10", devise: "CHF", montant: 600, nombre: 2 }], encaisse_par_mois: [{ mois: "2026-10", devise: "CHF", montant: 300, nombre: 3 }], impayes: [{ tranche: "0-30", devise: "CHF", montant: 300, nombre: 1 }], pipeline: [{ devise: "CHF", montant: 1000, nombre: 2 }], devis: { emis: 4, acceptes: 2, delai_moyen_jours: 3 }, activite: { dossiers: 3, clients: 2 }, top_clients: [], par_pays: [], par_responsable: [] },
    precedent: { facture_par_mois: [{ mois: "2026-09", devise: "CHF", montant: 500, nombre: 1 }], encaisse_par_mois: [] },
    cible: "CHF",
    taux,
  });
  assert.equal(a.facture, 600);
  assert.equal(a.panierMoyen, 300);
  assert.equal(a.tauxAcceptation, 50);
  assert.equal(a.evolFacture, 20);
  assert.equal(a.evolEncaisse, null, "rien d'encaissé la période précédente");
  const b = syntheseEntite({
    entite: { id: "2", nom: "Secret" },
    donnees: { facture_par_mois: [{ mois: "2026-10", devise: "THB", montant: 16000, nombre: 4 }], encaisse_par_mois: [{ mois: "2026-10", devise: "THB", montant: 16000, nombre: 4 }], impayes: [], pipeline: [], devis: { emis: 0, acceptes: 0, delai_moyen_jours: null }, activite: { dossiers: 4, clients: 4 }, top_clients: [], par_pays: [], par_responsable: [] },
    precedent: null,
    cible: "CHF",
    taux,
  });
  assert.equal(b.facture, 400);
  assert.equal(b.tauxAcceptation, null);
  const g = consolider([a, b]);
  assert.equal(g.facture, 1000);
  assert.equal(g.encaisse, 700);
  assert.equal(g.nbFactures, 6);
  assert.equal(g.panierMoyen, Math.round((1000 / 6) * 100) / 100);
  assert.equal(g.dossiers, 7);
  assert.deepEqual(g.parts.map((p) => p.part), [60, 40]);
  assert.equal(g.evolFacture, 100, "600 + 400 contre 500 la période précédente (seule ZTP en a une)");
});

test("seriesMensuelles et classementGroupe : converties, les devises sans taux sont ignorées", async () => {
  const { seriesMensuelles, classementGroupe } = await load();
  const parEntite = [
    { entite: { id: "1", nom: "ZTP" }, donnees: { facture_par_mois: [{ mois: "2026-09", devise: "CHF", montant: 100, nombre: 1 }, { mois: "2026-10", devise: "EUR", montant: 50, nombre: 1 }], top_clients: [{ client: "Alice", devise: "CHF", montant: 100, nombre: 1 }] } },
    { entite: { id: "2", nom: "Secret" }, donnees: { facture_par_mois: [{ mois: "2026-10", devise: "THB", montant: 4000, nombre: 2 }], top_clients: [{ client: "Ben", devise: "THB", montant: 4000, nombre: 2 }] } },
  ];
  const taux = { CHF: 1, THB: 0.025 };
  const series = seriesMensuelles(parEntite, "facture_par_mois", "CHF", taux);
  assert.deepEqual(series[0].valeurs, { "2026-09": 100 });
  assert.deepEqual(series[1].valeurs, { "2026-10": 100 });
  const top = classementGroupe(parEntite, "top_clients", "client", "CHF", taux);
  assert.equal(top.length, 2);
  assert.equal(top[0].entite, "ZTP");
  assert.equal(top[1].montant, 100);
});
