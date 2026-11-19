// Remarque imprimée et note interne (Jérémy, 19.11.2026) : l'écran « Nouveau voucher » de Mook et « Nouveau dossier » (Taxi, Secret) les
// proposent comme « Coller une confirmation ». La remarque est `reservations.details.remarques` (celle que l'édition du voucher modifie déjà),
// la note est `dossiers.notes`. Pas de nouvelle colonne.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TH, CHAMPS, valeursVides, erreursVoucher, donneesVoucher, reservationVoucher, reservationApercu, correctionReservation, valeursDepuis } from "../src/gestion/js/voucher-rapide-calc.mjs";
import { champsBooking } from "../src/gestion/js/taxi-calc.mjs";
import { champsCreation } from "../src/gestion/js/creation-voucher-calc.mjs";
import { CHAMPS_VOUCHER } from "../src/gestion/js/operations-calc.mjs";

const source = (f) => readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");
const bon = { ...valeursVides(), nom: "Emma Schmid", date: "2026-11-22", pickup: "Lanta Sand Resort", heure: "16:30", dropoff: "Krabi Airport", adultes: "2", prix: "1500" };

test("Mook : la remarque est imprimée, donc refusée en thaï ; la note interne accepte le thaï", () => {
  assert.equal(erreursVoucher({ ...bon, remarques: "วันเกิด 50 ปี" }).remarques, "e_thai");
  assert.ok(TH.e_thai);
  assert.deepEqual(erreursVoucher({ ...bon, remarques: "50th birthday", notes: "ลูกค้าจ่ายเงินสด ชอบเพลงเบาๆ" }), {});
  // Les deux sont facultatives.
  assert.deepEqual(erreursVoucher(bon), {});
  // Chaque champ a son libellé et son aide en thaï, dans l'ordre de l'écran (après le prix).
  for (const c of ["remarques", "remarques_aide", "notes", "notes_aide"]) assert.ok(TH[c], c);
  assert.deepEqual(CHAMPS.slice(-3), ["prix", "remarques", "notes"]);
});

test("Mook : la remarque va sur la Booking confirmation (REMARKS), la note jamais", () => {
  const x = donneesVoucher({ ...bon, remarques: "50th birthday", notes: "ลูกค้าจ่ายเงินสด\nLate flight" });
  assert.equal(x.remarques, "50th birthday");
  assert.equal(x.notes, "ลูกค้าจ่ายเงินสด\nLate flight", "la note garde ses lignes et son thaï");
  assert.equal(reservationVoucher(x).details.remarques, "50th birthday");
  const r = reservationApercu(x);
  assert.equal(r.details.remarques, "50th birthday");
  assert.ok(!JSON.stringify(r).includes("Late flight"), "la note ne passe pas sur la réservation");
  const lignes = champsBooking({ nom: x.nom, date: x.date, pickup: x.pickup, heure: x.heure, dropoff: x.dropoff, personnes: x.personnes, montant: x.prix, remarques: r.details.remarques });
  assert.equal(lignes[lignes.length - 1].valeur, "50th birthday");
  assert.ok(!lignes.some((l) => String(l.valeur).includes("Late flight")));
});

test("Mook : « mes derniers vouchers » reprend remarque et note, et la correction les change ou les efface", () => {
  const x = donneesVoucher({ ...bon, remarques: "50th birthday" });
  const r = { ...reservationApercu(x), id: "R1" };
  const v = valeursDepuis(r, { nom: "Emma Schmid" }, { notes: "ลูกค้าจ่ายเงินสด" });
  assert.equal(v.remarques, "50th birthday");
  assert.equal(v.notes, "ลูกค้าจ่ายเงินสด");
  assert.equal(correctionReservation(r, donneesVoucher(v)), null, "rien ne change tant qu'on ne touche à rien");
  assert.equal(correctionReservation(r, donneesVoucher({ ...v, remarques: "Child seat please" })).details.remarques, "Child seat please");
  assert.equal("remarques" in correctionReservation(r, donneesVoucher({ ...v, remarques: "" })).details, false);
  // Une remarque sur deux lignes (écrite dans la réservation) reste telle quelle quand Mook corrige autre chose.
  const deux = { ...r, details: { ...r.details, remarques: "Birthday\nCake box in the trunk" } };
  assert.equal(correctionReservation(deux, donneesVoucher(valeursDepuis(deux, { nom: "Emma Schmid" }, {}))), null);
  // La note se crée avec le dossier et se corrige sur le dossier (jamais sur la réservation).
  const vue = source("views/voucher-rapide.mjs");
  assert.match(vue, /creerCourse\(x, essai, \{ notes: x\.notes \}\)/);
  assert.match(vue, /modifier\("dossiers", d\.id, \{ notes: x\.notes \|\| "" \}\)/);
  assert.match(vue, /valeursDepuis\(r, v\.client, /);
});

test("Nouveau dossier : chaque service propose la remarque imprimée, Taxi comme Secret ; le dossier propose la note interne", () => {
  assert.ok(champsCreation({ type: "transfert", personnes: { adultes: 2 } }, { taxi: true }).includes("remarques"), "Taxi : Booking confirmation");
  for (const type of Object.keys(CHAMPS_VOUCHER)) assert.ok(champsCreation({ type }).includes("remarques"), `Secret : ${type}`);
  const vue = source("views/nouveau-excursions.mjs");
  assert.match(vue, /champ\(tr\("Note interne du dossier \(jamais imprimée\)"\), notes,/);
  assert.match(vue, /creerDossierExcursions\(\{ client: .*, notes: notes\.value, ref: ref\.value/);
  // La même clé que l'édition du voucher (reservations.mjs) : `remarques` dans les détails de la réservation.
  assert.match(source("views/champs-voucher.mjs"), /remarques: \(\) => champ\(tr\("Remarques sur le voucher"\), remarques\)/);
});
