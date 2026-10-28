// tests/gestion-calc.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../src/gestion/js/calc.mjs");

const reglages = { conditions: { acompte_pct: 50, delai_jours: 10, relance_jours: 7 } };
const devis = (lignes, extra = {}) => ({ type: "devis", date_emission: "2026-10-01", created_at: "1", contenu: { lignes }, ...extra });

test("totaux : devis par région (page 1 du modèle, CHF 540)", async () => {
  const { totaux } = await load();
  const t = totaux({
    lignes: [
      { kind: "bloc", libelle: "Formule par région" },
      { kind: "ligne", libelle: "Bangkok", montant: 120 },
      { kind: "ligne", libelle: "Chiang Mai", montant: 120 },
      { kind: "ligne", libelle: "Phuket", montant: 150 },
      { kind: "ligne", libelle: "Koh Lanta", montant: 150 },
    ],
  });
  assert.equal(t.net, 540);
  assert.equal(t.remises, 0);
});

test("totaux : tarif journalier avec remise d'un jour (CHF 774 - 43 = 731)", async () => {
  const { totaux, remiseJours } = await load();
  const lignes = [
    { kind: "bloc", unite: 43, qte: 18 },
    { kind: "remise", unite: 43, qte: remiseJours(18) },
  ];
  const t = totaux({ lignes });
  assert.equal(t.sousTotal, 774);
  assert.equal(t.remises, -43);
  assert.equal(t.net, 731);
});

test("totaux : remise en pourcentage (480 - 30% = 336)", async () => {
  const { totaux } = await load();
  const t = totaux({ lignes: [{ kind: "bloc", unite: 40, qte: 12 }, { kind: "remise", pct: 30 }] });
  assert.equal(t.sousTotal, 480);
  assert.equal(t.remises, -144);
  assert.equal(t.net, 336);
});

test("totaux : facture avec montant reçu donne le reste à payer", async () => {
  const { totaux, afficherSousTotal } = await load();
  const c = { lignes: [{ kind: "bloc", unite: 40, qte: 9 }] };
  const t = totaux(c, 180);
  assert.equal(t.net, 360);
  assert.equal(t.reste, 180);
  assert.equal(afficherSousTotal(c, 180), true);
  assert.equal(afficherSousTotal(c, 0), false);
});

test("remiseJours : un jour par tranche de 14", async () => {
  const { remiseJours } = await load();
  assert.equal(remiseJours(13), 0);
  assert.equal(remiseJours(14), 1);
  assert.equal(remiseJours(19), 1);
  assert.equal(remiseJours(28), 2);
});

test("formatChf et formatDate", async () => {
  const { formatChf, formatDate } = await load();
  assert.equal(formatChf(540), "CHF 540");
  assert.equal(formatChf(1234.5), "CHF 1'234.50");
  assert.equal(formatChf(-43), "- CHF 43");
  assert.equal(formatDate("2026-10-09"), "09/10/2026");
});

test("genererRef : initiales, date AAAAMMJJ et pays comme dans les devis existants", async () => {
  const { genererRef } = await load();
  assert.equal(genererRef("Laurent", "Drapier", "2026-10-09", "Thaïlande"), "LD20261009 Thaïlande");
  assert.equal(genererRef("Myriam", "Dieni Medwed", "2026-09-12", "Thaïlande"), "MD20260912 Thaïlande");
  assert.equal(genererRef("Lorianne", "Bürki", "2026-08-15", "Vietnam"), "LB20260815 Vietnam");
  assert.equal(genererRef("Gaëlle", "Dayer Aliprandi", "2026-01-23", "Thaïlande"), "GD20260123 Thaïlande");
});

test("statutDossier : le statut découle des faits", async () => {
  const { statutDossier } = await load();
  const base = { dossier: { id: "d1" }, reglages };
  const docs = [devis([{ kind: "bloc", unite: 40, qte: 9 }])]; // 360, acompte 180
  assert.equal(statutDossier({ ...base, documents: docs, paiements: [] }), "brouillon");
  const envoye = [{ ...docs[0], envoye_le: "2026-10-02" }];
  assert.equal(statutDossier({ ...base, documents: envoye, paiements: [] }), "devis_envoye");
  assert.equal(statutDossier({ dossier: { accepte_le: "2026-10-05" }, reglages, documents: envoye, paiements: [] }), "accepte");
  assert.equal(statutDossier({ dossier: { accepte_le: "2026-10-05" }, reglages, documents: envoye, paiements: [{ montant: 180 }] }), "acompte");
  assert.equal(statutDossier({ dossier: { accepte_le: "2026-10-05" }, reglages, documents: envoye, paiements: [{ montant: 180 }, { montant: 180 }] }), "solde");
  assert.equal(statutDossier({ dossier: { annule: true }, reglages, documents: envoye, paiements: [] }), "annule");
});

test("totalDossier : la facture prime sur le devis", async () => {
  const { totalDossier } = await load();
  const d = devis([{ kind: "bloc", montant: 400 }]);
  const f = { ...devis([{ kind: "bloc", montant: 450 }]), type: "facture", created_at: "2" };
  assert.equal(totalDossier([d]), 400);
  assert.equal(totalDossier([d, f]), 450);
});

test("aFaire : acompte en retard, devis à relancer, solde proche", async () => {
  const { aFaire, resume } = await load();
  const mk = (id, dossier, documents, paiements = []) => ({
    id,
    dossier: { id, ...dossier },
    documents,
    paiements,
    reste: 0,
    statut: null,
  });
  const lignes = [{ kind: "bloc", unite: 40, qte: 10 }]; // 400
  const retard = mk("a", { accepte_le: "2026-10-01" }, [devis(lignes, { envoye_le: "2026-09-28" })]);
  retard.statut = "accepte";
  const relance = mk("b", {}, [devis(lignes, { envoye_le: "2026-10-10" })]);
  relance.statut = "devis_envoye";
  const solde = mk("c", { date_depart: "2026-11-10" }, [devis(lignes)], [{ montant: 200 }]);
  solde.statut = "acompte";
  solde.reste = 200;
  const items = aFaire([retard, relance, solde], "2026-10-28", reglages);
  assert.deepEqual(items.map((i) => i.type), ["acompte_retard", "solde_proche", "devis_relance"]);
  assert.equal(items[0].jours, 17); // échéance 11.10, aujourd'hui 28.10
  assert.ok(resume); // exporté
});

test("echeanceAcompte : date d'acceptation plus le délai", async () => {
  const { echeanceAcompte } = await load();
  assert.equal(echeanceAcompte({ accepte_le: "2026-10-05" }, reglages), "2026-10-15");
  assert.equal(echeanceAcompte({}, reglages), null);
});

test("periodeTexte : même mois, deux mois, deux années", async () => {
  const { periodeTexte } = await load();
  assert.equal(periodeTexte("2026-12-02", "2026-12-12"), "DU 2 AU 12 DÉCEMBRE 2026");
  assert.equal(periodeTexte("2027-03-27", "2027-04-10"), "DU 27 MARS AU 10 AVRIL 2027");
  assert.equal(periodeTexte("2026-12-28", "2027-01-10"), "DU 28 DÉCEMBRE 2026 AU 10 JANVIER 2027");
  assert.equal(periodeTexte("2026-11-05", ""), "NOVEMBRE 2026");
  assert.equal(periodeTexte("", ""), "");
});
