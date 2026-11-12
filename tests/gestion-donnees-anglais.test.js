// Les données de Secret et de Taxi passent en anglais (groupes, libellés, détails, points d'embarquement, périodes). Le code qui lit ces textes
// doit donner le même résultat avec les anciens textes français (documents déjà émis) et avec les nouveaux textes anglais.
// Le jeu d'essai est un relevé de la base de production du 12.11.2026 : pour chaque prestation, les champs que le code lit, avant et après la traduction
// (ni prix, ni net, ni conditions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { typeVoucher, estPrive, typeTransfert, categorieVehicule, fraisDeParc, capaciteBateau, bateauEtQuai, horairesTexte, dureeTexte, pointEmbarquement, texteParcEn } from "../src/gestion/js/operations-calc.mjs";
import { prestationEnfant, prestationSupplement, groupeJoin, groupePrive } from "../src/gestion/js/demande-calc.mjs";
import { periodeSpecifique, PERIODE_TOUTE } from "../src/gestion/js/partenaires-calc.mjs";

const jeu = JSON.parse(readFileSync(new URL("./fixtures/donnees-secret-taxi-avant-apres.json", import.meta.url), "utf8"));
const comme = (x, etat) => ({ famille: x.famille, unite: x.unite, groupe: x[etat].groupe, libelle: x[etat].libelle, libelle_en: x[etat].libelle_en, details: x[etat].details });
const avant = jeu.prestations.map((x) => comme(x, "avant"));
const apres = jeu.prestations.map((x) => comme(x, "apres"));

test("le jeu d'essai est le relevé complet (359 prestations de Secret et de Taxi)", () => {
  assert.equal(jeu.prestations.length, 359);
  assert.ok(jeu.prestations.every((x) => x.apres.libelle === x.apres.libelle_en), "le libellé de l'outil est le libellé anglais");
});

// Une réservation faite avant la traduction garde son libellé français : on croise donc les deux états.
const reservations = (i) => [{ libelle: jeu.prestations[i].avant.libelle }, { libelle: jeu.prestations[i].apres.libelle }];

test("type de voucher, privé ou partagé, type de transfert et catégorie de véhicule ne changent pas", () => {
  const diffs = [];
  jeu.prestations.forEach((x, i) => {
    for (const r of reservations(i)) {
      const transfert = x.famille === "transfert";
      const ref = [typeVoucher(r, avant[i]), estPrive(avant[i], r), transfert ? typeTransfert(avant[i], r) : ""];
      const now = [typeVoucher(r, apres[i]), estPrive(apres[i], r), transfert ? typeTransfert(apres[i], r) : ""];
      if (JSON.stringify(ref) !== JSON.stringify(now)) diffs.push(`${x.avant.groupe} | ${x.avant.libelle} → ${x.apres.groupe} | ${x.apres.libelle} : ${ref} contre ${now}`);
    }
    if (x.famille === "location" && categorieVehicule(avant[i]) !== categorieVehicule(apres[i])) diffs.push(`catégorie ${x.avant.libelle}: ${categorieVehicule(avant[i])} contre ${categorieVehicule(apres[i])}`);
  });
  assert.deepEqual([...new Set(diffs)], []);
});

test("frais de parc, capacité, bateau, horaires et durée donnent le même texte en anglais", () => {
  const diffs = [];
  jeu.prestations.forEach((x, i) => {
    const f = (p) => ({ parc: fraisDeParc(p), cap: capaciteBateau(p), bat: bateauEtQuai(p), h: horairesTexte(p.details.horaires), d: dureeTexte(p.details.duree) });
    const a = f(avant[i]);
    const b = f(apres[i]);
    for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push(`${x.avant.libelle} [${k}] ${JSON.stringify(a[k])} contre ${JSON.stringify(b[k])}`);
  });
  assert.deepEqual([...new Set(diffs)], []);
});

test("le tarif enfant et le supplément se retrouvent comme avant", () => {
  const avecId = (liste) => liste.map((x, j) => ({ ...x, id: j, partenaire_id: jeu.prestations[j].p, actif: jeu.prestations[j].actif }));
  const A = avecId(avant);
  const B = avecId(apres);
  assert.deepEqual(B.map((p) => (prestationEnfant(p, B) || {}).id ?? null), A.map((p) => (prestationEnfant(p, A) || {}).id ?? null));
  assert.deepEqual(B.map((p) => (prestationSupplement(p, B) || {}).id ?? null), A.map((p) => (prestationSupplement(p, A) || {}).id ?? null));
});

test("les points d'embarquement anglais donnent le texte du voucher d'avant", () => {
  for (const p of jeu.partenaires) {
    for (const pt of p.avant) {
      const i = p.avant.indexOf(pt);
      assert.equal(pointEmbarquement({ regles: { points_embarquement: p.apres } }, pt.lieu), pointEmbarquement({ regles: { points_embarquement: p.avant } }, pt.lieu), `${pt.lieu} : ${pt.ou} / ${p.apres[i].ou}`);
    }
  }
});

test("le texte des frais de parc en anglais se lit comme le texte français", () => {
  assert.equal(texteParcEn("Foreign adult: 400 ฿ | Child: 200 ฿\n(Thai: 40 ฿ / 20 ฿)"), texteParcEn("Adulte étranger: 400 ฿ | Enfant: 200 ฿\n(Thaï: 40 ฿ / 20 ฿)"));
  assert.equal(texteParcEn("Foreign adult: 200 ฿ | Child: 100 ฿\n(Thai: 40 ฿ / 20 ฿), To be paid in cash on site"), texteParcEn("Adulte étranger: 200 ฿ | Enfant: 100 ฿\n(Thaï: 40 ฿ / 20 ฿), À régler en espèces sur place"));
  assert.equal(texteParcEn("Foreign child: 100 ฿ | Thai child: 20 ฿"), texteParcEn("Enfant étranger: 100 ฿ | Enfant thaï: 20 ฿"));
  assert.equal(texteParcEn("200 ฿ / foreign adult, 100 ฿ / child (40 ฿ / 20 ฿ Thai)"), texteParcEn("200 ฿ / adulte étranger, 100 ฿ / enfant (40 ฿ / 20 ฿ thaï)"));
  assert.equal(texteParcEn("Depending on destination (200 to 400 ฿ / foreign adult, 100 to 200 ฿ / child)"), texteParcEn("Selon destination (200 à 400 ฿ / adulte étranger, 100 à 200 ฿ / enfant)"));
});

test("la période « toute la période du contrat » ne s'affiche pas, dans les deux langues", () => {
  assert.equal(periodeSpecifique("Toute la période du contrat"), "");
  assert.equal(periodeSpecifique("Whole contract period"), "");
  assert.equal(periodeSpecifique("1 Nov 2026 → 4 May 2027"), "1 Nov 2026 → 4 May 2027");
  assert.equal(periodeSpecifique(""), "");
  assert.ok(PERIODE_TOUTE.includes("Whole contract period"));
});

test("chaque période, arrivée et départ du jeu d'essai est en anglais", () => {
  const francais = /[àâçéèêëîïôùûüœ]|\b(heure|lendemain|toute|déc|avr|mai|juin|et)\b/i;
  const reste = jeu.trajets.flat().filter((s) => typeof s === "string" && francais.test(s));
  assert.deepEqual(reste.filter((s) => !/^$/.test(s)), []);
});

test("excursion en groupe ou privée : le groupe dit la même chose en français et en anglais", () => {
  const norm = (g) => String(g || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const diffs = [];
  for (const x of jeu.prestations) {
    const a = norm(x.avant.groupe || x.avant.libelle);
    const b = norm(x.apres.groupe || x.apres.libelle);
    if (groupeJoin(a) !== groupeJoin(b) || groupePrive(a) !== groupePrive(b)) diffs.push(`${x.avant.groupe} → ${x.apres.groupe}`);
  }
  assert.deepEqual([...new Set(diffs)], []);
});
