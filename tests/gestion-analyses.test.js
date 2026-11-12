// tests/gestion-analyses.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../src/gestion/js/analyses.mjs");
const ligne = (props) => ({ id: "x", kind: "ligne", libelle: "", intro: "", puces: [], unite: null, qte: null, montant: null, pct: null, ...props });

test("analyserLocal : facturé, encaissé, impayés et conversion sur une période", async () => {
  const { analyserLocal } = await load();
  const dossiers = [
    { id: "d1", client_id: "c1", pays: "Thaïlande", responsable_id: null, accepte_le: "2026-09-10", annule: false },
    { id: "d2", client_id: "c1", pays: "Vietnam", responsable_id: null, accepte_le: null, annule: false },
    { id: "d3", client_id: "c1", pays: "Vietnam", responsable_id: null, accepte_le: "2026-09-01", annule: true },
  ];
  const documents = [
    { id: "a", dossier_id: "d1", type: "devis", date_emission: "2026-09-01", created_at: "1", contenu: { lignes: [ligne({ montant: 400 })] } },
    { id: "b", dossier_id: "d1", type: "facture", date_emission: "2026-10-05", created_at: "2", contenu: { lignes: [ligne({ montant: 400 }), ligne({ kind: "remise", pct: 10 })] } },
    { id: "c", dossier_id: "d2", type: "devis", date_emission: "2026-10-02", created_at: "3", contenu: { lignes: [ligne({ montant: 500 })] } },
    { id: "d", dossier_id: "d3", type: "devis", date_emission: "2026-08-25", created_at: "4", contenu: { lignes: [ligne({ montant: 999 })] } },
  ];
  const paiements = [{ dossier_id: "d1", date: "2026-09-15", montant: 180 }];
  const r = analyserLocal({ dossiers, documents, paiements, clients: [{ id: "c1", prenom: "Alice", nom: "Martin" }], profils: [], reglages: { devise: "CHF" } }, "2026-07-01", "2026-12-31", "2026-11-01");
  assert.deepEqual(r.facture_par_mois, [{ mois: "2026-10", devise: "CHF", montant: 360, nombre: 1 }]);
  assert.deepEqual(r.encaisse_par_mois, [{ mois: "2026-09", devise: "CHF", montant: 180, nombre: 1 }]);
  assert.equal(r.devis.emis, 3);
  assert.equal(r.devis.acceptes, 2);
  assert.deepEqual(r.impayes, [{ tranche: "0-30", devise: "CHF", montant: 180, nombre: 1 }]);
  assert.equal(r.top_clients[0].client, "Alice Martin");
  assert.equal(r.top_clients[0].montant, 360);
  assert.ok(!JSON.stringify(r.top_clients).includes("999"), "le dossier annulé n'est pas compté");
  assert.deepEqual(r.pipeline, [{ devise: "CHF", montant: 500, nombre: 1 }]);
  assert.deepEqual(r.activite, { dossiers: 1, clients: 1 });
});

test("statistiques : chaque entreprise ses sections et son résumé du mois", async () => {
  const { SECTIONS, sectionVisible } = await import("../src/gestion/js/views/analyses-sections.mjs");
  const { resumeMois } = await import("../src/gestion/js/analyses-resume.mjs");
  const visibles = (m) => Object.keys(SECTIONS).filter((k) => sectionVisible(SECTIONS[k], { reservations: true, ...m }));
  assert.deepEqual(visibles({}), ["apercu", "ventes", "encaissements", "commissions", "clients", "services", "avenir", "devis"]);
  assert.deepEqual(visibles({ reservations: false }), ["apercu", "ventes", "encaissements", "commissions", "clients", "avenir", "devis"], "ZTP sans réservations garde « À venir » pour les départs");
  assert.deepEqual(visibles({ excursions: true }), ["apercu", "ventes", "encaissements", "commissions", "clients", "services", "avenir"], "Secret : pas de devis");
  assert.deepEqual(visibles({ excursions: true, taxi: true }), ["apercu", "ventes", "commissions", "clients", "services", "avenir"], "Taxi : ni devis ni encaissements");
  const faits = { nets: false, devise_defaut: "THB", dossiers: [], paiements: [], reservations: [] };
  const base = { faits, jour: "2026-11-11", devise: "THB", entite: "X" };
  const ztp = resumeMois(base);
  assert.match(ztp, /Devis en attente/);
  assert.match(ztp, /Encaissé chez nous/);
  const secret = resumeMois({ ...base, excursions: true });
  assert.ok(!secret.includes("Devis"), secret);
  assert.match(secret, /Reste à encaisser/);
  const taxi = resumeMois({ ...base, excursions: true, taxi: true });
  assert.ok(!taxi.includes("Devis") && !taxi.includes("Encaissé chez nous") && !taxi.includes("Reste à encaisser"), taxi);
  assert.match(taxi, /Volume vendu/);
});
