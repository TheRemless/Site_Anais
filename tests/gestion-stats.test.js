// tests/gestion-stats.test.js : statistiques détaillées (périodes, mesures, descente en liste, séries, définitions).
const test = require("node:test");
const assert = require("node:assert/strict");

const calc = () => import("../src/gestion/js/stats-calc.mjs");
const ana = () => import("../src/gestion/js/analyses.mjs");
const base = () => import("../src/gestion/js/calc.mjs");
const defauts = () => import("../src/gestion/js/defauts.mjs");

const JOUR = "2026-11-11";

async function demoFaits(nets = true, slug = "excursions", debut = "2025-10-01") {
  const { donneesDemo } = await defauts();
  const { ajouterJours } = await base();
  const { faitsLocal } = await ana();
  const d = donneesDemo(JOUR, ajouterJours);
  const e = d.entites.find((x) => x.slug === slug);
  const de = (t) => d[t].filter((r) => r.entite_id === e.id);
  return faitsLocal(
    { dossiers: de("dossiers"), documents: de("documents"), paiements: de("paiements"), clients: de("clients"), profils: d.profils, reglages: d.reglages[e.id], reservations: de("reservations"), reservations_nets: de("reservations_nets"), partenaires: de("partenaires"), prestations: de("prestations") },
    { debut, fin: JOUR, jour: JOUR, nets }
  );
}

test("périodes rapides : bornes de chaque raccourci", async () => {
  const { periodeRapide } = await calc();
  assert.deepEqual(periodeRapide("aujourdhui", JOUR), [JOUR, JOUR]);
  assert.deepEqual(periodeRapide("sept", JOUR), ["2026-11-05", JOUR]);
  assert.deepEqual(periodeRapide("mois", JOUR), ["2026-11-01", JOUR]);
  assert.deepEqual(periodeRapide("mois_dernier", JOUR), ["2026-10-01", "2026-10-31"]);
  assert.deepEqual(periodeRapide("trois", JOUR), ["2026-09-01", JOUR]);
  assert.deepEqual(periodeRapide("annee", JOUR), ["2026-01-01", JOUR]);
  assert.equal(periodeRapide("perso", JOUR), null);
});

test("comparaison : le mois en cours se compare aux mêmes jours du mois d'avant, l'année à l'an dernier", async () => {
  const { periodeComparee } = await calc();
  assert.deepEqual(periodeComparee("2026-11-01", "2026-11-11", "prec"), ["2026-10-01", "2026-10-11"]);
  assert.deepEqual(periodeComparee("2026-10-01", "2026-10-31", "prec"), ["2026-09-01", "2026-09-30"]);
  assert.deepEqual(periodeComparee("2026-09-01", "2026-11-11", "prec"), ["2026-06-01", "2026-08-11"]);
  assert.deepEqual(periodeComparee("2026-01-01", "2026-11-11", "prec"), ["2025-01-01", "2025-11-11"]);
  assert.deepEqual(periodeComparee("2026-11-05", "2026-11-11", "prec"), ["2026-10-29", "2026-11-04"]);
  assert.deepEqual(periodeComparee("2026-11-01", "2026-11-11", "an"), ["2025-11-01", "2025-11-11"]);
  assert.deepEqual(periodeComparee("2024-02-29", "2024-02-29", "an"), ["2023-02-28", "2023-02-28"]);
  assert.equal(periodeComparee("2026-11-01", "2026-11-11", "aucune"), null);
});

test("séries : granularité, cases vides comprises, semaines du lundi", async () => {
  const { granularite, casesDe, cleDe } = await calc();
  assert.equal(granularite("2026-11-01", "2026-11-11"), "jour");
  assert.equal(granularite("2026-09-01", "2026-11-11"), "semaine");
  assert.equal(granularite("2026-01-01", "2026-11-11"), "mois");
  assert.equal(cleDe("2026-11-11", "semaine"), "2026-11-09");
  assert.equal(cleDe("2026-11-15", "semaine"), "2026-11-09");
  assert.deepEqual(casesDe("2026-09-01", "2026-12-31", "mois"), ["2026-09", "2026-10", "2026-11", "2026-12"]);
  assert.equal(casesDe("2026-11-01", "2026-11-07", "jour").length, 7);
  assert.deepEqual(casesDe("2026-11-11", "2026-11-23", "semaine"), ["2026-11-09", "2026-11-16", "2026-11-23"]);
});

test("variation : hausse, baisse, stable, nouveau", async () => {
  const { variation } = await calc();
  assert.deepEqual(variation(150, 100), { delta: 50, pct: 50, sens: "hausse" });
  assert.deepEqual(variation(50, 100), { delta: -50, pct: -50, sens: "baisse" });
  assert.deepEqual(variation(100, 100), { delta: 0, pct: 0, sens: "stable" });
  assert.deepEqual(variation(80, 0), { delta: 80, pct: null, sens: "nouveau" });
  assert.deepEqual(variation(0, 0), { delta: 0, pct: null, sens: "stable" });
});

test("volume vendu : les services payés sur place comptent, pas dans le total chez nous", async () => {
  const { lignes, somme } = await calc();
  const faits = {
    nets: true,
    dossiers: [{ id: "d1", ref: "EX-1", client_id: "c", client: "A", pays: null, responsable: null, accepte_le: "2026-11-02", annule: false, date_depart: null, date_retour: null, f_date: "2026-11-02", v_date: "2026-11-01", devise: "THB", total: 1000, sur_place: 400, recu: 300, client_depuis: "2026-11-02" }],
    paiements: [], reservations: [],
  };
  const c = { du: "2026-11-01", au: "2026-11-30", jour: JOUR, devise: "THB" };
  assert.equal(somme(lignes("vendu", faits, c)).montant, 1400);
  assert.equal(somme(lignes("facture", faits, c)).montant, 1000);
  assert.equal(somme(lignes("a_encaisser", faits, c)).montant, 700);
});

test("chaque mesure : la somme des lignes égale le chiffre, sur toutes les périodes et devises de la démo", async () => {
  const S = await calc();
  const faits = await demoFaits();
  for (const devise of S.devises(faits, "THB")) {
    for (const [du, au] of [["2026-11-01", JOUR], ["2026-10-01", "2026-10-31"], ["2026-01-01", JOUR], ["2025-11-12", JOUR]]) {
      const c = { du, au, jour: JOUR, devise };
      for (const id of [...Object.keys(S.MESURES), "revenu"]) {
        const rows = S.lignes(id, faits, c);
        const v = S.valeur(id, faits, c);
        assert.equal(v.nombre, rows.length, id);
        assert.equal(Math.round(rows.reduce((s, l) => s + l.montant, 0) * 100) / 100, v.montant, `${id} ${devise} ${du}`);
        assert.ok(rows.every((l) => l.devise === devise), `${id} : une seule devise`);
      }
    }
  }
});

test("chaque groupe : la somme des groupes égale le chiffre, et son filtre redonne ses lignes", async () => {
  const S = await calc();
  const faits = await demoFaits();
  const c = { du: "2026-01-01", au: JOUR, jour: JOUR, devise: "THB" };
  const essais = [
    ["vendu", ["mois", "semaine", "pays", "responsable", "client", "saison", "nouveaute"]],
    ["encaisse", ["mois", "moyen", "jour"]],
    ["a_encaisser", ["tranche", "client"]],
    ["services", ["famille", "partenaire", "prestation", "statut", "paiement", "mois"]],
    ["marge", ["partenaire", "famille"]],
    ["commission_a_recevoir", ["partenaire"]],
    ["revenu", ["mois", "nature"]],
  ];
  for (const [id, dims] of essais) {
    const rows = S.lignesFiltrees(id, faits, c);
    const total = S.valeur(id, faits, c);
    assert.ok(rows.length > 0, `${id} : la démo doit avoir des lignes`);
    for (const dim of dims) {
      const groupes = S.grouper(rows, dim);
      assert.equal(Math.round(groupes.reduce((s, g) => s + g.montant, 0) * 100) / 100, total.montant, `${id} par ${dim}`);
      assert.equal(groupes.reduce((s, g) => s + g.nombre, 0), total.nombre, `${id} par ${dim} : nombre`);
      for (const g of groupes.slice(0, 3)) {
        const descente = S.lignesFiltrees(id, faits, c, `${dim}:${g.cle}`);
        assert.equal(descente.length, g.nombre, `${id} ${dim}=${g.cle}`);
        assert.equal(Math.round(descente.reduce((s, l) => s + l.montant, 0) * 100) / 100, g.montant);
      }
    }
  }
});

test("séries : la somme des cases égale le chiffre de la période", async () => {
  const S = await calc();
  const faits = await demoFaits();
  for (const [du, au] of [["2026-11-01", JOUR], ["2026-09-01", JOUR], ["2026-01-01", JOUR]]) {
    const c = { du, au, jour: JOUR, devise: "THB" };
    for (const id of ["vendu", "encaisse", "services", "commission_recue", "revenu"]) {
      const s = S.serie(id, faits, c);
      assert.equal(Math.round(s.reduce((t, x) => t + x.montant, 0) * 100) / 100, S.valeur(id, faits, c).montant, `${id} ${du}`);
    }
  }
});

test("droit « nets » : sans lui, commissions, nets et marge sont indisponibles et vides", async () => {
  const S = await calc();
  const faits = await demoFaits(false);
  assert.equal(faits.nets, false);
  assert.ok(faits.reservations.every((r) => r.net_prevu === null && r.commission_prevue === null && r.commission_recue === null && r.paye_le === null));
  const c = { du: "2026-01-01", au: JOUR, jour: JOUR, devise: "THB" };
  for (const id of ["commission_prevue", "commission_recue", "commission_a_recevoir", "net_paye", "net_a_payer", "marge", "revenu"]) {
    assert.equal(S.disponible(id, faits), id === "revenu" ? true : false, id);
  }
  assert.equal(S.valeur("commission_recue", faits, c).nombre, 0);
  assert.ok(S.valeur("services", faits, c).nombre > 0, "les services restent visibles sans le droit");
});

test("comparer : le chiffre et celui de la période de comparaison ; les mesures à ce jour n'ont pas d'écart", async () => {
  const S = await calc();
  const faits = await demoFaits();
  const c = { du: "2026-10-01", au: "2026-10-31", jour: JOUR, devise: "THB" };
  const cmp = S.periodeComparee(c.du, c.au, "prec");
  const r = S.comparer("vendu", faits, c, cmp);
  assert.equal(r.precedent.montant, S.valeur("vendu", faits, { ...c, du: "2026-09-01", au: "2026-09-30" }).montant);
  assert.equal(r.ecart.delta, Math.round((r.actuel.montant - r.precedent.montant) * 100) / 100);
  assert.equal(S.comparer("a_encaisser", faits, c, cmp).ecart, null);
  assert.equal(S.comparer("vendu", faits, c, null).precedent, null);
});

test("dossiers annulés : ni vendus ni facturés, mais comptés dans le taux d'annulation", async () => {
  const S = await calc();
  const faits = await demoFaits();
  const c = { du: "2025-11-01", au: JOUR, jour: JOUR, devise: "THB" };
  assert.ok(S.lignes("vendu", faits, c).every((l) => !l.src.annule));
  assert.ok(S.lignes("annules", faits, c).every((l) => l.src.annule));
  const i = S.indicateursDossiers(faits, c);
  assert.ok(i.tauxAnnulation > 0 && i.tauxAnnulation < 40, `taux d'annulation plausible : ${i.tauxAnnulation}`);
  assert.equal(i.ouverts >= i.dossiers + i.annules, true);
});

test("indicateurs de devis : taux d'acceptation et délai", async () => {
  const S = await calc();
  const faits = {
    nets: false,
    dossiers: [
      { id: "1", ref: "A", client_id: "c", client: "", accepte_le: "2026-11-05", annule: false, f_date: null, v_date: "2026-11-01", devise: "CHF", total: 100, sur_place: 0, recu: 0 },
      { id: "2", ref: "B", client_id: "c", client: "", accepte_le: null, annule: false, f_date: null, v_date: "2026-11-02", devise: "CHF", total: 100, sur_place: 0, recu: 0 },
      { id: "3", ref: "C", client_id: "c", client: "", accepte_le: "2026-11-04", annule: false, f_date: null, v_date: "2026-11-02", devise: "CHF", total: 100, sur_place: 0, recu: 0 },
      { id: "4", ref: "D", client_id: "c", client: "", accepte_le: null, annule: false, f_date: null, v_date: "2026-11-03", devise: "CHF", total: 100, sur_place: 0, recu: 0 },
    ],
    paiements: [], reservations: [],
  };
  const r = S.indicateursDevis(faits, { du: "2026-11-01", au: "2026-11-30", jour: JOUR, devise: "CHF" });
  assert.deepEqual(r, { emis: 4, acceptes: 2, taux: 50, delaiMoyen: 3, delaiN: 2 });
});

test("revenu : encaissé moins nets payés plus commissions reçues", async () => {
  const S = await calc();
  const faits = {
    nets: true,
    dossiers: [{ id: "d", ref: "A", client_id: "c", client: "X", accepte_le: "2026-11-01", annule: false, f_date: "2026-11-01", v_date: null, devise: "THB", total: 1000, sur_place: 0, recu: 1000 }],
    paiements: [{ id: "p", dossier_id: "d", ref: "A", client: "X", date: "2026-11-03", montant: 1000, moyen: null, devise: "THB" }],
    reservations: [
      { id: "r1", dossier_id: "d", ref: "A", client: "X", devise: "THB", dossier_annule: false, libelle: "a", partenaire: "P", famille: "excursion", date_service: "2026-11-05", statut: "confirme", montant_vente: 1000, paye_sur_place: false, adultes: 2, enfants: 0, bebes: 0, net_prevu: 700, net_paye: 700, paye_le: "2026-11-06", commission_prevue: null, commission_recue: null, commission_recue_le: null },
      { id: "r2", dossier_id: "d", ref: "A", client: "X", devise: "THB", dossier_annule: false, libelle: "b", partenaire: "Q", famille: "activite", date_service: "2026-11-05", statut: "confirme", montant_vente: 500, paye_sur_place: true, adultes: 2, enfants: 0, bebes: 0, net_prevu: null, net_paye: null, paye_le: null, commission_prevue: 100, commission_recue: 100, commission_recue_le: "2026-11-09" },
    ],
  };
  const c = { du: "2026-11-01", au: "2026-11-30", jour: JOUR, devise: "THB" };
  assert.deepEqual(S.valeur("revenu", faits, c), { montant: 400, nombre: 3 });
  assert.equal(S.valeur("marge", faits, c).montant, 400);
  assert.equal(S.valeur("commission_a_recevoir", faits, c).nombre, 0);
});

test("définitions : chaque mesure a un titre et une explication", async () => {
  const S = await calc();
  for (const id of [...Object.keys(S.MESURES), "revenu"]) assert.ok(S.DEFINITIONS[id] && S.DEFINITIONS[id][0] && S.DEFINITIONS[id][1].length > 20, id);
});

test("résumé du mois : texte prêt pour WhatsApp, avec la comparaison, sans commissions quand le droit manque", async () => {
  const { resumeMois } = await import("../src/gestion/js/analyses-resume.mjs");
  const { forcerLangue, pretLangue } = await import("../src/gestion/js/i18n.mjs");
  const S = await calc();
  const avec = await demoFaits(true);
  const texte = resumeMois({ faits: avec, jour: JOUR, devise: "THB", entite: "Excursions démo" });
  const c = { du: "2026-11-01", au: JOUR, jour: JOUR, devise: "THB" };
  assert.match(texte, /^\*Résumé de novembre 2026\* · Excursions démo/);
  assert.ok(texte.includes(`Volume vendu : THB ${new Intl.NumberFormat("de-CH").format(S.valeur("vendu", avec, c).montant).replace(/’/g, "'")}`), texte);
  assert.match(texte, /Commissions reçues : THB/);
  assert.match(texte, /Commissions à recevoir : THB/);
  assert.match(texte, /Reste à encaisser : THB .* \(\d+ dossiers?\)/);
  assert.match(texte, /avant THB/);
  const sans = resumeMois({ faits: await demoFaits(false), jour: JOUR, devise: "THB", entite: "X" });
  assert.ok(!sans.includes("Commissions"), "sans le droit « nets », aucune ligne de commission");
  forcerLangue("en");
  await pretLangue();
  try {
    const en = resumeMois({ faits: avec, jour: JOUR, devise: "THB", entite: "X" });
    assert.match(en, /Summary for November 2026/);
    assert.match(en, /Sales volume : THB/);
  } finally {
    forcerLangue("fr");
  }
});
