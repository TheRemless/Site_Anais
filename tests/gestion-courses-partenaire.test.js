// Écran du partenaire chauffeur (migration 115) : logique pure de courses-partenaire-calc.mjs et règles de la démonstration,
// qui rejouent celles des fonctions de la base (contrôlées sur Postgres par docs/gestion/verif-acces-partenaire.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TH, parJour, totalDu, resteDu, verrouillee, lireMontant, erreurMontant, montantTh, personnesTh, destinationTh, dateTh, titreJour, jourSuivant, accesLocal, coursesLocales, saisieLocale, commissionDuPartenaire, suivreRetour, plafond } from "../src/gestion/js/courses-partenaire-calc.mjs";
import { donneesDemo } from "../src/gestion/js/defauts.mjs";
import { ajouterJours } from "../src/gestion/js/calc.mjs";

const AJD = "2026-11-25"; // un mercredi

test("textes : tout l'écran est en thaï, sans mot anglais hors noms propres", () => {
  for (const [cle, v] of Object.entries(TH)) {
    assert.match(v, /[฀-๿]/, cle);
    assert.doesNotMatch(v.replace("Nani", ""), /[A-Za-z]{2,}/, cle);
  }
});

test("dates : jour de la semaine en thaï, aujourd'hui et demain nommés", () => {
  assert.equal(dateTh(AJD), "พุธ 25 พ.ย.");
  assert.equal(jourSuivant(AJD), "2026-11-26");
  assert.equal(jourSuivant("2026-12-31"), "2027-01-01");
  assert.equal(titreJour(AJD, AJD), "วันนี้ · พุธ 25 พ.ย.");
  assert.equal(titreJour("2026-11-26", AJD), "พรุ่งนี้ · พฤหัส 26 พ.ย.");
  assert.equal(titreJour("2026-11-28", AJD), "เสาร์ 28 พ.ย.");
});

test("montants : lecture du champ et affichage en bahts", () => {
  assert.equal(lireMontant(""), null);
  assert.equal(lireMontant("  "), null);
  assert.equal(lireMontant("300"), 300);
  assert.equal(lireMontant("1,200"), 1200);
  assert.equal(lireMontant("1 200"), 1200);
  assert.equal(lireMontant("250.5"), 250.5);
  assert.equal(lireMontant("300 บาท"), 300);
  for (const x of ["abc", "-5", "1.234", "3e2", "1.2.3"]) assert.equal(lireMontant(x), undefined, x);
  assert.equal(montantTh(1800), "1,800 บาท");
  assert.equal(montantTh(250.5), "250.50 บาท");
  assert.equal(montantTh(10, "EUR"), "10 EUR");
  assert.equal(montantTh(null), "");
});

test("personnes et destination", () => {
  assert.equal(personnesTh({ adultes: 2, enfants: 1, bebes: 0 }), "ผู้ใหญ่ 2 · เด็ก 1");
  assert.equal(personnesTh({ adultes: 4 }), "ผู้ใหญ่ 4");
  assert.equal(destinationTh({ dropoff: "Krabi Airport" }), "Krabi Airport");
  assert.equal(destinationTh({ retour: true, programme: "Old Town tour", dropoff: "x" }), "ไปแล้วกลับมาจุดรับเดิม · Old Town tour");
});

test("total : ce qui reste dû, passées et à venir, jamais une commission réglée", () => {
  const courses = [
    { commission: 300, commission_payee: null, reglee: false },
    { commission: 400, commission_payee: 100, reglee: false },
    { commission: 200, commission_payee: 200, reglee: true },
    { commission: null, reglee: false },
    { commission: 0, reglee: false },
  ];
  assert.deepEqual(courses.map(resteDu), [300, 300, 0, 0, 0]);
  assert.equal(totalDu(courses), 600);
  assert.equal(totalDu([]), 0);
  assert.equal(totalDu([{ commission: 0.1 }, { commission: 0.2 }]), 0.3);
});

test("saisie : refusée sur une commission payée, un montant illisible ou plus cher que la course", () => {
  const c = { prix: 1800, commission: null, commission_payee: null, reglee: false };
  assert.equal(erreurMontant(c, 350), null);
  assert.equal(erreurMontant(c, null), null);
  assert.equal(erreurMontant(c, 1800), null);
  assert.equal(erreurMontant(c, 1801), TH.erreur_trop);
  assert.equal(erreurMontant(c, undefined), TH.erreur_montant);
  assert.equal(erreurMontant({ ...c, commission_payee: 50 }, 10), TH.erreur_payee);
  assert.equal(erreurMontant({ ...c, reglee: true }, 10), TH.erreur_payee);
  assert.equal(verrouillee({ commission_payee: 0, reglee: false }), false);
  // Point 4 : plafond = prix de vente, 10 000 si le prix est vide.
  assert.equal(plafond({ ...c, prix: null }), 10000);
  assert.equal(erreurMontant({ ...c, prix: null }, 10000), null);
  assert.equal(erreurMontant({ ...c, prix: null }, 10000.01), TH.erreur_trop);
  // Point 1 : zéro refusé, une commission posée par l'équipe en lecture seule, la sienne modifiable.
  assert.equal(erreurMontant(c, 0), TH.erreur_zero);
  assert.equal(erreurMontant({ ...c, commission: 300, par_moi: false }, 250), TH.posee_equipe);
  assert.equal(verrouillee({ ...c, commission: 300, par_moi: false }), true);
  assert.equal(erreurMontant({ ...c, commission: 300, par_moi: true }, 250), null);
});

test("point 1 : la commission est « du partenaire » tant qu'elle égale le montant qu'il a saisi", () => {
  assert.equal(commissionDuPartenaire({ commission_prevue: 300, commission_partenaire: 300 }), true);
  assert.equal(commissionDuPartenaire({ commission_prevue: "300.00", commission_partenaire: 300 }), true);
  assert.equal(commissionDuPartenaire({ commission_prevue: 280, commission_partenaire: 300 }), false);
  assert.equal(commissionDuPartenaire({ commission_prevue: 300, commission_partenaire: null }), false);
  assert.equal(commissionDuPartenaire({ commission_prevue: null, commission_partenaire: 300 }), false);
  assert.equal(commissionDuPartenaire(null), false);
});

test("point 7 : l'écouteur de retour sur l'application se retire en quittant l'écran", () => {
  const ecouteurs = new Set();
  const doc = { visibilityState: "visible", addEventListener: (t, f) => t === "visibilitychange" && ecouteurs.add(f), removeEventListener: (t, f) => t === "visibilitychange" && ecouteurs.delete(f) };
  let relu = 0;
  let saisie = false;
  const arreter = suivreRetour(doc, () => relu++, { saisieEnCours: () => saisie });
  assert.equal(ecouteurs.size, 1);
  for (const f of ecouteurs) f();
  assert.equal(relu, 1);
  saisie = true;
  for (const f of ecouteurs) f();
  assert.equal(relu, 1, "pas de relecture pendant une saisie");
  arreter();
  assert.equal(ecouteurs.size, 0);
  const vue = fs.readFileSync(new URL("../src/gestion/js/views/courses-partenaire.mjs", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/gestion/js/app.mjs", import.meta.url), "utf8");
  assert.match(vue, /racine\.arreter = suivreRetour\(/);
  assert.doesNotMatch(vue, /document\.addEventListener\("visibilitychange"/);
  assert.ok((app.match(/quitterPartenaire\(\)/g) || []).length >= 4, "app.mjs retire l'écouteur en quittant l'écran");
});

test("jours : aujourd'hui et demain toujours là, la suite dans l'ordre, les jours passés à part", () => {
  const cs = [
    { id: "a", date_service: "2026-11-22" },
    { id: "b", date_service: "2026-11-27" },
    { id: "c", date_service: AJD },
    { id: "d", date_service: "2026-11-27" },
  ];
  const { aVenir, passees } = parJour(cs, AJD);
  assert.deepEqual(aVenir.map((b) => b.date), [AJD, "2026-11-26", "2026-11-27"]);
  assert.deepEqual(aVenir[1].courses, []);
  assert.deepEqual(aVenir[2].courses.map((c) => c.id), ["b", "d"]);
  assert.deepEqual(passees.map((b) => b.date), ["2026-11-22"]);
});

// ---- Démonstration ----------------------------------------------------------------------------------------------------------------
const demo = () => donneesDemo(AJD, ajouterJours);
const chauffeurDe = (d) => d.partenaires_acces[0].user_id;

test("démo : le partenaire chauffeur n'est membre d'aucune entreprise et a son accès", () => {
  const d = demo();
  const u = chauffeurDe(d);
  assert.ok(d.profils.some((p) => p.user_id === u && !p.super_admin));
  assert.ok(!d.membres.some((m) => m.user_id === u));
  const a = accesLocal(d, u);
  assert.ok(a && a.entite.slug === "taxi");
  for (const autre of d.profils.filter((p) => p.user_id !== u)) assert.equal(accesLocal(d, autre.user_id), null);
});

test("démo : ses courses de Taxi seulement, à venir et passées encore à payer, sans net", () => {
  const d = demo();
  const u = chauffeurDe(d);
  const taxi = d.entites.find((e) => e.slug === "taxi");
  const cs = coursesLocales(d, u, AJD);
  assert.ok(cs.length >= 4);
  const ids = new Set(cs.map((c) => c.id));
  for (const r of d.reservations) if (ids.has(r.id)) assert.equal(r.entite_id, taxi.id);
  assert.ok(cs.some((c) => c.date_service === AJD && c.vol === "FD3217" && c.heure === "14:30"));
  assert.ok(cs.some((c) => c.retour && c.programme));
  assert.ok(cs.every((c) => !Object.keys(c).some((k) => /net/.test(k))));
  assert.deepEqual(cs.map((c) => c.date_service), [...cs.map((c) => c.date_service)].sort());
  // Une course annulée disparaît, une compte désactivé ne voit plus rien.
  const r = d.reservations.find((x) => x.id === cs[0].id);
  r.statut = "annule";
  assert.ok(!coursesLocales(d, u, AJD).some((c) => c.id === r.id));
  d.profils.find((p) => p.user_id === u).actif = false;
  assert.deepEqual(coursesLocales(d, u, AJD), []);
});

test("point 2 : les courses de sa fiche et sans partenaire, jamais une autre fiche ni une autre entreprise", () => {
  const d = demo();
  const u = chauffeurDe(d);
  const taxi = d.entites.find((e) => e.slug === "taxi");
  const avant = coursesLocales(d, u, AJD);
  const r = d.reservations.find((x) => x.id === avant.find((c) => c.date_service > AJD).id);
  r.partenaire_id = null;
  const apres = coursesLocales(d, u, AJD);
  assert.ok(apres.some((c) => c.id === r.id), "une course de Taxi sans partenaire reste dans la liste");
  assert.equal(apres.length, avant.length);
  assert.ok(saisieLocale(d, u, AJD, r.id, 100));
  const autre = d.reservations.find((x) => x.entite_id !== taxi.id && x.date_service >= AJD);
  autre.partenaire_id = d.partenaires_acces[0].partenaire_id;
  assert.ok(!coursesLocales(d, u, AJD).some((c) => c.id === autre.id), "une course d'une autre entreprise reste invisible, même posée sur sa fiche");
  const autreFiche = { ...d.partenaires.find((p) => p.id === d.partenaires_acces[0].partenaire_id), id: "autre-fiche", nom: "Autre chauffeur" };
  d.partenaires.push(autreFiche);
  r.partenaire_id = autreFiche.id;
  assert.ok(!coursesLocales(d, u, AJD).some((c) => c.id === r.id), "une course confiée à une autre fiche de Taxi reste invisible");
});

test("point 3 : d'aujourd'hui à 60 jours, et les courses passées tant que la commission n'est pas payée", () => {
  const d = demo();
  const u = chauffeurDe(d);
  const r = d.reservations.find((x) => x.id === coursesLocales(d, u, AJD).find((c) => c.date_service >= AJD).id);
  r.date_service = jourSuivant(AJD, 60);
  assert.ok(coursesLocales(d, u, AJD).some((c) => c.id === r.id));
  r.date_service = jourSuivant(AJD, 61);
  assert.ok(!coursesLocales(d, u, AJD).some((c) => c.id === r.id));
  r.date_service = jourSuivant(AJD, -120);
  assert.ok(coursesLocales(d, u, AJD).some((c) => c.id === r.id), "passée sans commission : visible, même ancienne");
  d.reservations_nets.push({ id: "n-test", entite_id: r.entite_id, reservation_id: r.id, commission_prevue: 300, commission_recue: 300, commission_recue_le: AJD });
  assert.ok(!coursesLocales(d, u, AJD).some((c) => c.id === r.id), "payée : elle disparaît");
});

test("démo : la saisie suit les règles de la base", () => {
  const d = demo();
  const u = chauffeurDe(d);
  const c = coursesLocales(d, u, AJD).find((x) => x.date_service === AJD);
  const v = saisieLocale(d, u, AJD, c.id, 300);
  assert.equal(v.commission_prevue, 300);
  assert.equal(v.commission_partenaire, 300, "point 1 : marquée comme la sienne");
  assert.ok(v.commission_partenaire_le);
  assert.throws(() => saisieLocale(d, u, AJD, c.id, c.prix + 1));
  assert.throws(() => saisieLocale(d, u, AJD, c.id, 0), "point 1 : zéro refusé");
  d.reservations_nets.push({ id: "n-equipe", entite_id: d.reservations.find((x) => x.id === c.id).entite_id, reservation_id: c.id, commission_prevue: 200, commission_partenaire: null });
  const apres = coursesLocales(d, u, AJD).find((x) => x.id === c.id);
  assert.equal(apres.modifiable, false);
  assert.equal(apres.par_moi, false);
  assert.throws(() => saisieLocale(d, u, AJD, c.id, 150), "point 1 : jamais écraser la commission de l'équipe");
  assert.throws(() => saisieLocale(d, u, AJD, "inconnue", 10));
  const autre = d.profils.find((p) => p.super_admin).user_id;
  assert.throws(() => saisieLocale(d, autre, AJD, c.id, 10));
});

test("l'écran du partenaire ne lit aucune table : seulement les fonctions de la base", () => {
  const vue = fs.readFileSync(new URL("../src/gestion/js/views/courses-partenaire.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(vue, /etat\.db|etat\.brut|modifier\(|enregistrerLie/);
  const sb = fs.readFileSync(new URL("../src/gestion/js/store-supabase.mjs", import.meta.url), "utf8");
  const bloc = sb.slice(sb.indexOf("async partenaireAcces()"), sb.indexOf("async fiduciaireAPreparer()"));
  assert.doesNotMatch(bloc, /sb\.from\(/);
  for (const f of ["partenaire_mon_acces", "partenaire_courses", "partenaire_saisir_commission"]) assert.ok(bloc.includes(`"${f}"`), f);
});
