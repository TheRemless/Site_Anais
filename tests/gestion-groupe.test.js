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

test("chaque entreprise ses chiffres : devis seulement en sur mesure, pas de facture client en taxi", async () => {
  const { syntheseEntite, consolider, seriesMensuelles } = await load();
  const taux = { CHF: 1, THB: 0.025 };
  const donnees = (devise, montant) => ({ facture_par_mois: [{ mois: "2026-10", devise, montant, nombre: 2 }], encaisse_par_mois: [{ mois: "2026-10", devise, montant, nombre: 2 }], impayes: [{ tranche: "0-30", devise, montant: 100, nombre: 1 }], pipeline: [{ devise, montant: 500, nombre: 1 }], devis: { emis: 2, acceptes: 1, delai_moyen_jours: 2 }, activite: { dossiers: 2, clients: 2 } });
  const ztp = syntheseEntite({ entite: { id: "1", nom: "ZTP" }, donnees: donnees("CHF", 600), precedent: null, cible: "CHF", taux, mode: "sur_mesure" });
  const secret = syntheseEntite({ entite: { id: "2", nom: "Secret" }, donnees: donnees("THB", 8000), precedent: null, cible: "CHF", taux, mode: "excursions" });
  const taxi = syntheseEntite({ entite: { id: "3", nom: "Taxi" }, donnees: donnees("THB", 4000), precedent: { facture_par_mois: [{ mois: "2026-09", devise: "THB", montant: 4000, nombre: 2 }], encaisse_par_mois: [] }, cible: "CHF", taux, mode: "taxi" });
  assert.equal(ztp.avecDevis, true);
  assert.equal(ztp.devisEmis, 2);
  assert.equal(secret.avecDevis, false);
  assert.equal(secret.devisEmis, 0, "Secret n'a pas de devis");
  assert.equal(secret.nbPipeline, 0);
  assert.equal(secret.facture, 200, "Secret facture directement");
  assert.equal(taxi.avecFactures, false);
  assert.equal(taxi.facture, 0, "les documents internes de Taxi ne sont pas des factures");
  assert.equal(taxi.nbFactures, 0);
  assert.equal(taxi.nbImpayes, 0);
  assert.equal(taxi.panierMoyen, null);
  assert.equal(taxi.evolFacture, null);
  assert.equal(taxi.encaisse, 100, "l'encaissé reste compté");
  const g = consolider([ztp, secret, taxi]);
  assert.equal(g.facture, 800);
  assert.equal(g.nbFactures, 4);
  assert.equal(g.panierMoyen, 200);
  assert.equal(g.devisEmis, 2);
  assert.equal(g.avecDevis, true);
  assert.deepEqual(g.parts.map((p) => p.part), [75, 25, null]);
  assert.equal(consolider([secret, taxi]).avecDevis, false, "sans société sur mesure, les devis sont sans objet");
  const series = seriesMensuelles([{ entite: { nom: "Secret" }, donnees: donnees("THB", 8000), mode: "excursions" }, { entite: { nom: "Taxi" }, donnees: donnees("THB", 4000), mode: "taxi" }], "facture_par_mois", "CHF", taux);
  assert.deepEqual(series[0].valeurs, { "2026-10": 200 });
  assert.deepEqual(series[1].valeurs, {}, "pas de facturé pour Taxi");
  assert.deepEqual(seriesMensuelles([{ entite: { nom: "Taxi" }, donnees: donnees("THB", 4000), mode: "taxi" }], "encaisse_par_mois", "CHF", taux)[0].valeurs, { "2026-10": 100 });
});
