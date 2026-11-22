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
    assert.doesNotMatch(v.replace("Nani", "").replace(/\{[a-z_]+\}/g, ""), /[A-Za-z]{2,}/, cle);
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
  assert.ok(cs.some((c) => c.date_service === AJD && c.vol.startsWith("FD3217") && c.heure === "14:30"));
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

// ---- Migration 116 : tout ce qu'imprime la Booking confirmation, sauf l'interne ----------------------------------------------------------
import { lignesCourse, CHAMPS_COURSE, CHAMPS_INTERNES, CHAMPS_MOOK_INTERNES, vehiculeTh, bagagesTh, paiementTh, hebergementTh } from "../src/gestion/js/courses-partenaire-calc.mjs";
import { champsBooking } from "../src/gestion/js/taxi-calc.mjs";
import { textesVoucher } from "../src/gestion/js/textes-voucher.mjs";
import { CHAMPS_VOUCHER } from "../src/gestion/js/operations-calc.mjs";
import { CHAMPS as CHAMPS_MOOK } from "../src/gestion/js/voucher-rapide-calc.mjs";

// Une course où tout est rempli. L'en-tête de la carte montre l'heure et le client, le titre du jour montre la date.
const EN_TETE = ["client", "date", "heure"];
const DETAILS_PLEINS = {
  type_trajet: "", drop_off: "Lanta Test Villas", programme_trajet: "", duree_h: 3, vol: "FD0000 14:05", bagages: "3", sieges: 1, type_transfert: "minivan", remarques: "Call on arrival", remarques_paiement: "Cash",
  hotel: "Lanta Test Resort", chambre: "12", type_tour: "prive", bateau: "Speedboat", parc: "inclus", parc_texte: "Park fee", programme: "Snorkeling", heure_service: "09:00",
  retour_date: "2026-12-01", retour_heure: "10:00", retour_lieu: "Krabi Airport", permis: "Required", equipement: "Helmet", caution: "1000", conditions: "Fuel",
  de: "Koh Lanta", vers: "Koh Phi Phi", depart: "08:00", arrivee: "09:30", embarquement: "Saladan Pier, gate 3", checkin: "07:30", pickup_zone: "Long Beach",
};
const coursePleine = (extra = {}) => ({ id: "x", date_service: AJD, heure: "14:30", pickup: "Krabi Airport", dropoff: "Lanta Test Villas", retour: false, programme: "", adultes: 2, enfants: 1, bebes: 1, client: "Test Client", telephone: "+44 7700 900111", vol: "FD0000 14:05", prix: 2300, ref: "TX-1", reference_partenaire: "BR-7", libelle: "Private minivan: Krabi Airport → Koh Lanta", service: "Private Taxi", vehicules: 2, adresse_client: "", paiement: "sur_place", a_encaisser: 2300, details: { ...DETAILS_PLEINS }, ...extra });
const clesAffichees = (c) => { const l = lignesCourse(c); return new Set([...EN_TETE, ...l.essentiel.map((x) => x.cle), ...l.details.map((x) => x.cle)]); };

test("116 : chaque champ des vouchers (cinq modèles) est lu par le partenaire, ou listé comme interne", () => {
  const tous = new Set(Object.values(CHAMPS_VOUCHER).flat());
  for (const k of tous) assert.ok(CHAMPS_COURSE.includes(k) || CHAMPS_INTERNES.includes(k), `champ du voucher oublié : ${k}`);
  for (const k of CHAMPS_INTERNES) assert.ok(!CHAMPS_COURSE.includes(k), `interne et montré à la fois : ${k}`);
});

// Où chaque champ de la liste blanche s'affiche sur la carte.
const OU = { type_trajet: "dropoff", drop_off: "dropoff", programme_trajet: "dropoff", duree_h: "duree", vol: "vol", bagages: "bagages", sieges: "personnes", type_transfert: "vehicule", remarques: "remarques", remarques_paiement: "remarques_paiement", hotel: "hotel", chambre: "hotel", type_tour: "type_tour", bateau: "bateau", parc: "parc", parc_texte: "parc", programme: "programme_activite", heure_service: "heure_service", retour_date: "retour_date", retour_heure: "retour_heure", retour_lieu: "retour_lieu", permis: "permis", equipement: "equipement", caution: "caution", conditions: "conditions", de: "de", vers: "vers", depart: "depart", arrivee: "arrivee", embarquement: "rendez_vous", checkin: "checkin", pickup_zone: "zone" };
test("116 : chaque champ lu s'affiche sur la carte quand il est rempli", () => {
  const vus = clesAffichees(coursePleine());
  for (const k of CHAMPS_COURSE) {
    assert.ok(OU[k], `pas d'emplacement pour ${k}`);
    assert.ok(vus.has(OU[k]), `${k} rempli mais pas affiché (${OU[k]})`);
  }
  const l = lignesCourse(coursePleine());
  const texte = JSON.stringify(l);
  for (const v of ["Saladan Pier, gate 3", "Long Beach", "Call on arrival", "10:00", "Krabi Airport", "FD0000 14:05", "TX-1", "BR-7", "Lanta Test Resort · ห้อง 12"]) assert.ok(texte.includes(v), v);
});

// La Booking confirmation de Taxi (champsBooking) : chacune de ses lignes a son équivalent sur la carte du partenaire.
const BOOKING = { b_nom: "client", b_date: "date", b_pickup: "pickup", b_pickup_retour: "pickup", b_heure: "heure", b_programme: "dropoff", b_duree: "duree", b_dropoff: "dropoff", b_passagers: "personnes", b_bagages: "bagages", b_prix: "paiement", b_remarques: "remarques" };
test("116 : aucun champ de la Booking confirmation ne manque (aller simple et retour au point de départ)", () => {
  const t = textesVoucher(null);
  const parTexte = new Map(Object.keys(BOOKING).map((k) => [t(k), k]));
  for (const retour of [null, { programme: "Old Town tour", duree: "3 hours" }]) {
    const champs = champsBooking({ nom: "Test Client", date: AJD, pickup: "Krabi Airport", heure: "14:30", dropoff: "Villa", personnes: { adultes: 2, enfants: 1, bebes: 1 }, bagages: "3", sieges: 1, vol: "FD1", montant: 2300, retour, remarques: "Call", t });
    const c = coursePleine(retour ? { retour: true, programme: "Old Town tour", details: { ...DETAILS_PLEINS, type_trajet: "retour_depart", programme_trajet: "Old Town tour" } } : {});
    const vus = clesAffichees(c);
    for (const ch of champs) {
      const k = parTexte.get(ch.cle);
      assert.ok(k, `ligne de la Booking confirmation sans correspondance : ${ch.cle}`);
      assert.ok(vus.has(BOOKING[k]), `${ch.cle} absente de la carte`);
    }
  }
});

// Le formulaire de Mook : chaque champ a son équivalent, sauf la note interne.
const MOOK = { nom: "client", telephone: "telephone", date: "date", pickup: "pickup", heure: "heure", trajet: "dropoff", dropoff: "dropoff", programme: "dropoff", duree: "duree", vol: "vol", adultes: "personnes", enfants: "personnes", bagages: "bagages", sieges: "personnes", prix: "paiement", remarques: "remarques" };
test("116 : aucun champ du voucher de Mook ne manque, sauf sa note interne", () => {
  const c = coursePleine({ retour: true, programme: "Tour", details: { ...DETAILS_PLEINS, type_trajet: "retour_depart" } });
  const vus = new Set([...clesAffichees(c), "telephone"]);
  for (const k of CHAMPS_MOOK) {
    if (CHAMPS_MOOK_INTERNES.includes(k)) continue;
    assert.ok(MOOK[k], `champ de Mook sans correspondance : ${k}`);
    assert.ok(vus.has(MOOK[k]), `${k} absent de la carte`);
  }
  assert.deepEqual(CHAMPS_MOOK_INTERNES, ["notes"]);
  const vue = fs.readFileSync(new URL("../src/gestion/js/views/courses-partenaire.mjs", import.meta.url), "utf8");
  assert.match(vue, /c\.telephone \?/, "le téléphone du client s'affiche");
  assert.doesNotMatch(vue, /<details|"details", \{/, "rien de replié : pas de bloc <details>");
});

test("116 : véhicule, bagages, paiement et hôtel en thaï", () => {
  assert.equal(vehiculeTh({ libelle: "Private minivan: A → B", service: "Private Taxi", vehicules: 2 }), "รถตู้ 2 คัน");
  assert.equal(vehiculeTh({ libelle: "Private Taxi: A → B", service: "Private Taxi" }), "แท็กซี่ 1 คัน");
  assert.equal(vehiculeTh({ libelle: "Shared minivan", vehicules: 1 }), "รถตู้รวม 1 คัน");
  assert.equal(vehiculeTh({ libelle: "x", details: { type_transfert: "taxi" } }), "แท็กซี่ 1 คัน");
  assert.equal(bagagesTh("3"), "3 ใบ");
  assert.equal(bagagesTh("oui"), "มี");
  assert.equal(bagagesTh("0"), "");
  assert.equal(paiementTh({ paiement: "sur_place", a_encaisser: 2300 }), "คนขับเก็บเงินสด 2,300 บาท");
  assert.equal(paiementTh({ paiement: "paye", a_encaisser: 0 }), "ลูกค้าจ่ายแล้ว ไม่ต้องเก็บเงิน");
  assert.equal(paiementTh({ paiement: "acompte", a_encaisser: 1800 }), "ลูกค้าจ่ายแล้วบางส่วน คนขับเก็บ 1,800 บาท");
  assert.match(paiementTh({ paiement: "en_attente" }), /Nani/);
  assert.deepEqual(hebergementTh({ adresse_client: "Lanta Resort, Room 12", details: {} }), { hotel: "Lanta Resort", chambre: "12" });
  assert.deepEqual(hebergementTh({ adresse_client: "Lanta Resort", details: { hotel: "Autre Hotel", chambre: "5" } }), { hotel: "Autre Hotel", chambre: "5" });
  for (const v of Object.values(TH)) assert.match(v, /[฀-๿]|\{montant\}/);
});

test("116 démo : seuls les champs de la liste blanche sortent, avec référence, véhicules et paiement", () => {
  const d = demo();
  const u = chauffeurDe(d);
  const r = d.reservations.find((x) => x.id === coursesLocales(d, u, AJD)[0].id);
  r.details = { ...(r.details || {}), lignes_ids: ["a"], envois: [1], prix_origine: 9999, note: "SECRET", embarquement: "Gate 3" };
  r.notes = "SECRET-NOTE";
  const c = coursesLocales(d, u, AJD).find((x) => x.id === r.id);
  assert.equal(c.details.embarquement, "Gate 3");
  for (const k of ["lignes_ids", "envois", "prix_origine", "note"]) assert.ok(!(k in c.details), k);
  assert.ok(!JSON.stringify(c).includes("SECRET"));
  assert.ok(c.ref && c.paiement === "sur_place" && Number(c.vehicules) >= 1);
});
