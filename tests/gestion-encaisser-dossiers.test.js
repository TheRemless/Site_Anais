// tests/gestion-encaisser-dossiers.test.js : À encaisser, les commissions dossier par dossier (20.11.2026, migration 57).
// Un partenaire avec plusieurs dossiers : Anaïs coche ceux qu'il a payés, le total coché égale la somme de la liste, un geste encaisse la sélection
// (un enregistrement par dossier). Un montant différent du prévu : le reste vient plus tard, ou le dossier est soldé avec un motif.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { aRecevoirParPartenaire, recuesParPartenaire, sommeRestes, sommeMontants, natureMontant, repartirSurDossier, ecrituresEncaissement, VALEURS_ANNULATION } from "../src/gestion/js/encaisser-calc.mjs";
import { commissionsARecevoir } from "../src/gestion/js/operations-calc.mjs";
import { commissionDossier } from "../src/gestion/js/dossier-resume-calc.mjs";

const AJD = "2026-11-20";
const resa = (id, dossier, partenaire, date, extra = {}) => ({ id, dossier_id: dossier, partenaire_id: partenaire, date_service: date, statut: "confirme", montant_vente: 2000, paye_sur_place: true, libelle: `Service ${id}`, ...extra });
const source = (f) => fs.readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");

// Une base en mémoire : `nets` par réservation, et `appliquer` écrit les lignes comme le ferait enregistrerLie.
function base(reservations, nets) {
  const table = structuredClone(nets);
  return {
    reservations,
    netDe: (r) => table[r.id] || null,
    appliquer: (ecritures) => ecritures.forEach((x) => (table[x.reservation_id] = { ...(table[x.reservation_id] || {}), ...x.valeurs })),
    table,
  };
}

// Rattana : trois dossiers (deux passés, un à venir), Longtail : un dossier, plus ce qui ne doit jamais apparaître.
const jeu = () =>
  base(
    [
      resa("a1", "D1", "rattana", "2026-11-05"),
      resa("a2", "D1", "rattana", "2026-11-06"),
      resa("b1", "D2", "rattana", "2026-11-12"),
      resa("c1", "D3", "rattana", "2026-11-28"),
      resa("l1", "D4", "longtail", "2026-11-10"),
      resa("x1", "D5", "rattana", "2026-11-02"), // déjà réglée
      resa("x2", "D6", "rattana", "2026-11-03", { statut: "annule" }),
      resa("x3", "D7", "rattana", "2026-11-03"), // dossier annulé
      resa("x4", "D8", "rattana", "2026-11-03", { paye_sur_place: false }),
      resa("s1", "D9", "longtail", "2026-11-11"), // sans commission prévue
    ],
    {
      a1: { commission_prevue: 400 },
      a2: { commission_prevue: 200 },
      b1: { commission_prevue: 300 },
      c1: { commission_prevue: 500 },
      l1: { commission_prevue: 333.33 },
      x1: { commission_prevue: 100, commission_recue: 100, commission_recue_le: "2026-11-04" },
      x2: { commission_prevue: 100 },
      x3: { commission_prevue: 100 },
      x4: { commission_prevue: 100, net_prevu: 900 },
    }
  );

test("chaque partenaire avec ses dossiers dessous : réglé, annulé et payé chez nous n'apparaissent pas", () => {
  const b = jeu();
  const p = aRecevoirParPartenaire(b.reservations, b.netDe, { ecartees: new Set(["D7"]), ajd: AJD });
  assert.deepEqual(p.map((x) => x.partenaire_id), ["rattana", "longtail"], "le partenaire qui doit le plus en premier");
  const rattana = p[0];
  assert.deepEqual(rattana.dossiers.map((d) => d.dossier_id), ["D1", "D2", "D3"], "par date de service");
  assert.equal(rattana.dossiers[0].reste, 600, "un dossier regroupe ses services chez ce partenaire");
  assert.equal(rattana.dossiers[0].reservations.length, 2);
  assert.deepEqual(rattana.dossiers.map((d) => d.coche), [true, true, false], "« Tout encaisser » prend les dossiers passés, pas celui à venir");
  assert.equal(rattana.dossiers[2].aVenir, true);
  const longtail = p[1];
  const sans = longtail.dossiers.find((d) => d.dossier_id === "D9");
  assert.equal(sans.sansCommission, 1);
  assert.equal(sans.coche, false, "sans commission prévue : à cocher à la main, avec le montant reçu");
});

test("les sommes affichées égalent toujours la somme de la liste, au centime", () => {
  const b = jeu();
  const p = aRecevoirParPartenaire(b.reservations, b.netDe, { ecartees: new Set(["D7"]), ajd: AJD });
  for (const x of p) assert.equal(x.reste, sommeRestes(x.dossiers), x.partenaire_id);
  assert.equal(p[0].reste, 1400);
  assert.equal(p[1].reste, 333.33);
  const tous = p.flatMap((x) => x.dossiers);
  assert.equal(sommeRestes(tous), 1733.33, "le chiffre « Commissions » en haut de l'écran");
  assert.equal(sommeRestes(tous), sommeRestes(p), "le total des partenaires égale le total des dossiers");
  // Le total coché : deux dossiers sur trois.
  assert.equal(sommeRestes(p[0].dossiers.filter((d) => d.coche)), 900);
  assert.equal(sommeMontants([0.1, 0.2, "0.3", null]), 0.6, "des montants saisis s'additionnent sans erreur d'arrondi");
});

test("un montant égal au prévu solde le dossier sans question, un enregistrement par service, et le dossier disparaît de la liste", () => {
  const b = jeu();
  const [rattana] = aRecevoirParPartenaire(b.reservations, b.netDe, { ecartees: new Set(["D7"]), ajd: AJD });
  const d1 = rattana.dossiers[0];
  assert.equal(natureMontant(d1, 600), "egal");
  const r = ecrituresEncaissement(d1, b.netDe, { montant: 600, date: AJD, moyen: "virement" });
  assert.equal(r.erreur, null);
  assert.deepEqual(r.ecritures.map((x) => [x.reservation_id, x.valeurs.commission_recue, x.valeurs.commission_recue_le, x.valeurs.commission_recue_moyen, x.valeurs.commission_ecart_motif]), [
    ["a1", 400, AJD, "virement", null],
    ["a2", 200, AJD, "virement", null],
  ]);
  b.appliquer(r.ecritures);
  const apres = aRecevoirParPartenaire(b.reservations, b.netDe, { ecartees: new Set(["D7"]), ajd: AJD });
  assert.ok(!apres[0].dossiers.some((d) => d.dossier_id === "D1"), "un dossier encaissé ne peut plus l'être une seconde fois : il n'est plus dans la liste");
  assert.equal(apres.find((x) => x.partenaire_id === "rattana").reste, 800);
  // Les autres calculs (résumé du dossier, statistiques) lisent les mêmes colonnes : réglé, sans écart.
  const [g] = commissionsARecevoir(b.reservations.filter((x) => x.dossier_id === "D1"), b.netDe);
  assert.equal(g.reste, 0);
  assert.equal(g.ecart, 0);
});

test("moins que prévu : il faut choisir, puis « le reste viendra plus tard » garde le reste à recevoir", () => {
  const b = jeu();
  const d2 = aRecevoirParPartenaire(b.reservations, b.netDe, { ajd: AJD })[0].dossiers.find((d) => d.dossier_id === "D2");
  assert.equal(natureMontant(d2, 100), "moins");
  assert.equal(ecrituresEncaissement(d2, b.netDe, { montant: 100, date: AJD }).erreur, "suite", "sans choix, rien n'est écrit");
  const r = ecrituresEncaissement(d2, b.netDe, { montant: 100, date: "2026-11-18", moyen: "especes", suite: "plus_tard" });
  assert.deepEqual(r.ecritures, [{ reservation_id: "b1", valeurs: { commission_recue: 100, commission_partielle_le: "2026-11-18", commission_recue_moyen: "especes" } }]);
  b.appliquer(r.ecritures);
  const encore = aRecevoirParPartenaire(b.reservations, b.netDe, { ajd: AJD })[0].dossiers.find((d) => d.dossier_id === "D2");
  assert.equal(encore.reste, 200, "le dossier reste dans la liste avec ce qu'il manque");
  assert.equal(encore.dejaRecu, 100);
  assert.equal(encore.partielLe, "2026-11-18");
  // Le résumé du dossier et les statistiques comptent le même reste à recevoir.
  assert.equal(commissionsARecevoir(b.reservations.filter((x) => x.dossier_id === "D2"), b.netDe)[0].reste, 200);
  // Le reste arrive : le dossier se solde, le reçu s'additionne, sans écart.
  const fin = ecrituresEncaissement(encore, b.netDe, { montant: 200, date: AJD, moyen: "virement" });
  assert.equal(natureMontant(encore, 200), "egal");
  b.appliquer(fin.ecritures);
  assert.equal(b.table.b1.commission_recue, 300);
  assert.equal(b.table.b1.commission_recue_le, AJD);
  assert.equal(fin.ecart, 0);
  assert.ok(!aRecevoirParPartenaire(b.reservations, b.netDe, { ajd: AJD })[0].dossiers.some((d) => d.dossier_id === "D2"));
  // Un versement partiel de zéro ne veut rien dire.
  assert.equal(ecrituresEncaissement(d2, b.netDe, { montant: 0, date: AJD, suite: "plus_tard" }).erreur, "montant");
});

test("moins que prévu, dossier soldé : motif obligatoire, écart gardé sur le dossier", () => {
  const b = jeu();
  const d2 = aRecevoirParPartenaire(b.reservations, b.netDe, { ajd: AJD })[0].dossiers.find((d) => d.dossier_id === "D2");
  assert.equal(ecrituresEncaissement(d2, b.netDe, { montant: 250, date: AJD, suite: "solder" }).erreur, "motif");
  assert.equal(ecrituresEncaissement(d2, b.netDe, { montant: 250, date: AJD, suite: "solder", motif: "inconnu" }).erreur, "motif");
  const r = ecrituresEncaissement(d2, b.netDe, { montant: 250, date: AJD, moyen: "virement", suite: "solder", motif: "rabais", note: "  remise de 500 au client  " });
  assert.equal(r.ecart, -50);
  assert.deepEqual(r.ecritures[0].valeurs, { commission_recue: 250, commission_recue_le: AJD, commission_recue_moyen: "virement", commission_ecart_motif: "rabais", commission_ecart_note: "remise de 500 au client" });
  b.appliquer(r.ecritures);
  const c = commissionDossier(b.reservations.filter((x) => x.dossier_id === "D2"), b.netDe);
  assert.equal(c.ecart, -50, "l'écart reste visible sur le dossier");
  assert.equal(c.reste, 0);
  assert.deepEqual(c.motifs, [{ motif: "rabais", note: "remise de 500 au client" }]);
});

test("plus que prévu : accepté tel quel, avec un motif, sans blocage", () => {
  const b = jeu();
  const d2 = aRecevoirParPartenaire(b.reservations, b.netDe, { ajd: AJD })[0].dossiers.find((d) => d.dossier_id === "D2");
  assert.equal(natureMontant(d2, 380), "plus");
  assert.equal(ecrituresEncaissement(d2, b.netDe, { montant: 380, date: AJD, suite: "plus_tard" }).erreur, "motif", "plus que prévu se solde toujours, avec un motif");
  const r = ecrituresEncaissement(d2, b.netDe, { montant: 380, date: AJD, motif: "plus_cher" });
  assert.equal(r.erreur, null);
  assert.equal(r.suite, "solder");
  assert.equal(r.ecart, 80);
  assert.equal(r.ecritures[0].valeurs.commission_recue, 380);
  assert.equal(r.ecritures[0].valeurs.commission_ecart_note, null, "la note est facultative");
});

test("sans commission prévue : le montant reçu solde le dossier sans motif ; un montant vide ou négatif est refusé", () => {
  const b = jeu();
  const sans = aRecevoirParPartenaire(b.reservations, b.netDe, { ajd: AJD }).find((p) => p.partenaire_id === "longtail").dossiers.find((d) => d.dossier_id === "D9");
  assert.equal(natureMontant(sans, null), "invalide");
  assert.equal(natureMontant(sans, 0), "invalide");
  assert.equal(natureMontant(sans, -5), "invalide");
  const r = ecrituresEncaissement(sans, b.netDe, { montant: 150, date: AJD, moyen: "especes" });
  assert.equal(r.erreur, null);
  assert.deepEqual(r.ecritures[0].valeurs, { commission_prevue: 150, commission_recue: 150, commission_recue_le: AJD, commission_recue_moyen: "especes", commission_ecart_motif: null, commission_ecart_note: null });
  b.appliquer(r.ecritures);
  const c = commissionDossier(b.reservations.filter((x) => x.dossier_id === "D9"), b.netDe);
  assert.equal(c.ecart, 0, "le montant reçu devient la commission : pas d'écart fantôme dans le dossier ni les statistiques");
  assert.equal(recuesParPartenaire(b.reservations, b.netDe, {}).find((p) => p.partenaire_id === "longtail").dossiers[0].ecart, 0);
  assert.equal(ecrituresEncaissement(sans, b.netDe, { montant: 150, date: "" }).erreur, "date");
});

test("un dossier à plusieurs services : la répartition suit ce qu'il reste sur chacun et tombe juste au centime", () => {
  const b = base([resa("p", "D", "x", "2026-11-01"), resa("q", "D", "x", "2026-11-01"), resa("r", "D", "x", "2026-11-01")], { p: { commission_prevue: 100 }, q: { commission_prevue: 100, commission_recue: 50 }, r: { commission_prevue: 100 } });
  const [d] = aRecevoirParPartenaire(b.reservations, b.netDe, { ajd: AJD })[0].dossiers;
  assert.equal(d.reste, 250);
  const parts = repartirSurDossier(d, b.netDe, 100);
  assert.deepEqual(parts.map((x) => x.part), [40, 20, 40]);
  const tiers = repartirSurDossier({ ...d }, base(d.reservations, { p: {}, q: {}, r: {} }).netDe, 100);
  assert.equal(sommeMontants(tiers.map((x) => x.part)), 100, "à parts égales sans prévu, le dernier prend l'arrondi");
  assert.deepEqual(tiers.map((x) => x.part), [33.33, 33.33, 33.34]);
});

test("reçues ces derniers jours : réglées et versements partiels, avec moyen, écart et motif ; l'annulation efface tout ce qui a été noté", () => {
  const b = base([resa("a", "D1", "x", "2026-11-01"), resa("b", "D2", "x", "2026-11-02"), resa("c", "D3", "x", "2026-08-01")], {
    a: { commission_prevue: 300, commission_recue: 250, commission_recue_le: "2026-11-15", commission_recue_moyen: "virement", commission_ecart_motif: "rabais" },
    b: { commission_prevue: 300, commission_recue: 100, commission_partielle_le: "2026-11-16" },
    c: { commission_prevue: 300, commission_recue: 300, commission_recue_le: "2026-08-05" },
  });
  const [p] = recuesParPartenaire(b.reservations, b.netDe, { depuis: "2026-08-22" });
  assert.deepEqual(p.dossiers.map((d) => [d.dossier_id, d.recu, d.ecart, d.partiel, d.motif, d.moyen]), [
    ["D2", 100, 0, true, null, null],
    ["D1", 250, -50, false, "rabais", "virement"],
  ]);
  assert.deepEqual(Object.keys(VALEURS_ANNULATION).sort(), ["commission_ecart_motif", "commission_ecart_note", "commission_partielle_le", "commission_recue", "commission_recue_le", "commission_recue_moyen"]);
  assert.ok(Object.values(VALEURS_ANNULATION).every((v) => v === null));
  assert.ok(!("commission_prevue" in VALEURS_ANNULATION), "la commission prévue ne change pas");
});

test("l'écran : nets et commissions seulement avec le droit, encaissement seulement avec l'écriture, un seul envoi à la fois", () => {
  const vue = source("views/encaisser.mjs");
  assert.match(vue, /const voitCommissions = voitNets\(\) && modeExcursions\(\);/, "les commissions demandent le droit nets (et Secret ou Taxi, jamais ZTP)");
  assert.match(vue, /voitCommissions \? sectionCommissions\(\{ rafraichir, ecrit \}\) : null/);
  const s = source("views/encaisser-commissions.mjs");
  assert.match(s, /if \(!ecrit\) return h\("li"/, "sans le droit d'écrire, pas de case à cocher");
  assert.match(s, /ecrit \? barre : null/, "ni de barre « Encaisser la sélection »");
  assert.match(s, /let envoiEnCours = false;/);
  assert.match(s, /if \(envoiEnCours\) return;/, "un second envoi pendant le premier est ignoré");
  assert.match(s, /bouton\.disabled = true;/, "le bouton est bloqué pendant l'envoi");
  assert.match(s, /if \(n && n\.commission_recue_le\) continue;/, "un service réglé entre-temps n'est pas encaissé une seconde fois");
  assert.match(s, /if \(etat\.entiteId !== entite\) \{/, "une feuille ouverte dans une entreprise n'écrit jamais dans une autre");
  assert.match(s, /\{ ecartees, ajd \}/, "les dossiers annulés sont écartés");
  // Le résumé de l'écran : le chiffre « Commissions » vient du même calcul que la liste.
  assert.match(s, /const total = sommeRestes\(partenaires\.flatMap\(\(p\) => p\.dossiers\)\);/);
  assert.match(vue, /prix\(commissions\.total\)/);
});

test("migration 57 : quatre colonnes privées sur reservations_nets, motif contrôlé, rejouable", () => {
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-57-encaisser-commissions.sql", import.meta.url), "utf8");
  for (const c of ["commission_recue_moyen text", "commission_partielle_le date", "commission_ecart_motif text", "commission_ecart_note text"]) assert.match(sql, new RegExp(`alter table reservations_nets add column if not exists ${c}`));
  assert.match(sql, /commission_ecart_motif in \('rabais', 'plus_cher', 'autre'\)/);
  assert.match(sql, /drop constraint if exists/);
  assert.doesNotMatch(sql, /alter table reservations add/, "rien dans la table publique des réservations");
  const ci = fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /verif-encaisser-commissions/);
});
