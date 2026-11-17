// tests/gestion-lot-e-commissions.test.js : lot E de l'audit d'autonomie du 16.11.2026 (points 10 et 84, bandeau « Recalculer »).
// Un virement ne solde que les services cochés (d'avance : passés avec une commission prévue), une réception se défait, la commission Taxi
// saisie se modifie avec sa date de réception, et le recalcul reste accessible même sans commission en attente.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { servicesAReceptionner, repartirReception, commissionsARecevoir, recalculerCommissions } from "../src/gestion/js/operations-calc.mjs";

const netsParId = (table) => (r) => table[r.id] || null;
const resa = (id, date, extra = {}) => ({ id, dossier_id: "d", partenaire_id: "rattana", date_service: date, statut: "confirme", montant_vente: 1000, paye_sur_place: true, ...extra });
const source = (f) => fs.readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");

test("point 10 : seuls les services passés avec une commission prévue sont cochés d'avance", () => {
  const rs = [resa("futur", "2026-11-25"), resa("passe", "2026-11-10"), resa("sans", "2026-11-12"), resa("regle", "2026-11-05"), resa("jour", "2026-11-17"), resa("nodate", null)];
  const nets = netsParId({ futur: { commission_prevue: 300 }, passe: { commission_prevue: 100 }, regle: { commission_prevue: 50, commission_recue: 50, commission_recue_le: "2026-11-06" }, jour: { commission_prevue: 80 }, nodate: { commission_prevue: 40 } });
  const s = servicesAReceptionner(rs, nets, "2026-11-17");
  assert.deepEqual(s.map((x) => x.reservation.id), ["passe", "sans", "jour", "futur", "nodate"], "dans l'ordre des dates, sans le service déjà réglé");
  const coche = Object.fromEntries(s.map((x) => [x.reservation.id, x.coche]));
  assert.deepEqual(coche, { passe: true, sans: false, jour: false, futur: false, nodate: false });
  assert.equal(s.find((x) => x.reservation.id === "sans").prevue, null, "sans commission prévue : null, pas 0");
  assert.equal(s.find((x) => x.reservation.id === "futur").passe, false);
});

test("point 10 : « Reçu comme prévu » ne marque que les services cochés, les services à venir restent à recevoir", () => {
  const rs = [resa("a", "2026-11-03"), resa("b", "2026-11-08"), resa("futur", "2026-11-28"), resa("sans", "2026-11-09")];
  const table = { a: { commission_prevue: 100 }, b: { commission_prevue: 300 }, futur: { commission_prevue: 500 } };
  const nets = netsParId(table);
  const coches = servicesAReceptionner(rs, nets, "2026-11-17").filter((x) => x.coche);
  const ids = new Set(coches.map((x) => x.reservation.id));
  const attendu = coches.reduce((s, x) => s + x.prevue, 0);
  assert.equal(attendu, 400);
  const { repartition, ecart } = repartirReception(rs, nets, attendu, { ids });
  assert.deepEqual(repartition, [{ reservation_id: "a", commission_recue: 100 }, { reservation_id: "b", commission_recue: 300 }]);
  assert.equal(ecart, 0);
  // Après l'enregistrement, le service à venir et celui sans commission restent dans les commissions à recevoir.
  for (const x of repartition) table[x.reservation_id] = { ...table[x.reservation_id], commission_recue: x.commission_recue, commission_recue_le: "2026-11-17" };
  const [g] = commissionsARecevoir(rs, nets);
  assert.equal(g.nbARecevoir, 2);
  assert.equal(g.reste, 500);
  assert.equal(g.sansCommission, 1, "le service sans commission reste signalé");
});

test("point 10 : « Autre montant » se répartit sur les seuls services cochés", () => {
  const rs = [resa("a", "2026-11-03"), resa("b", "2026-11-08"), resa("futur", "2026-11-28")];
  const nets = netsParId({ a: { commission_prevue: 100 }, b: { commission_prevue: 300 }, futur: { commission_prevue: 500 } });
  const r = repartirReception(rs, nets, 360, { ids: new Set(["a", "b"]) });
  assert.deepEqual(r.repartition.map((x) => x.reservation_id), ["a", "b"]);
  assert.equal(r.attendu, 400, "l'attendu ne compte que les services cochés");
  assert.equal(r.ecart, -40);
  assert.equal(Math.round(r.repartition.reduce((s, x) => s + x.commission_recue, 0) * 100) / 100, 360);
  // Un service sans commission coché à la main : il est soldé avec 0, les autres prennent le montant au prorata.
  const avecSans = repartirReception([...rs, resa("sans", "2026-11-09")], netsParId({ a: { commission_prevue: 100 } }), 100, { ids: new Set(["a", "sans"]) });
  assert.deepEqual(avecSans.repartition, [{ reservation_id: "a", commission_recue: 100 }, { reservation_id: "sans", commission_recue: 0 }]);
  // Sans `ids`, le comportement d'avant est inchangé (tous les services non réglés).
  assert.equal(repartirReception(rs, nets, 900).repartition.length, 3);
});

test("point 10 : l'écran coche d'avance, demande la liste avant d'enregistrer et laisse annuler une réception", () => {
  const s = source("views/encaisser.mjs");
  assert.match(s, /servicesAReceptionner\(g\.reservations, netReservation, ajd\)/);
  assert.match(s, /repartirReception\(g\.reservations, netReservation, v, \{ ids: new Set\(/, "la répartition reçoit la liste cochée");
  assert.doesNotMatch(s, /repartirReception\(g\.reservations, netReservation, g\.reste\)/, "plus de marquage de tout le groupe d'un tap");
  assert.match(s, /commission_recue: null, commission_recue_le: null/, "annuler une réception efface montant et date");
  assert.match(s, /tr\("Annuler une réception"\)/);
  assert.match(s, /g\.nb > g\.nbARecevoir \? h\("button"/, "le bouton d'annulation apparaît dès qu'un service du groupe est réglé, y compris dans « Déjà reçues »");
});

test("bandeau « Recalculer » : affiché hors de la liste des commissions en attente, sauf en Taxi", () => {
  const s = source("views/encaisser.mjs");
  assert.match(s, /voitCommissions && ecrit && !modeTaxi\(\) \? bandeauRecalcul\(rafraichir\) : null,\n\s+rienADire/, "le bandeau vient avant « Rien à encaisser » : il reste là quand tout est reçu");
  assert.doesNotMatch(s, /aRecevoir\.length\s*\?[^\n]*ouvrirRecalculCommissions/, "le bouton ne dépend plus des commissions en attente");
  const r = source("views/recalcul-commission.mjs");
  assert.match(r, /export function bandeauRecalcul/);
  // Ce que le bandeau compte : commissions vides à remplir et commissions différentes de la règle, jamais une commission déjà reçue.
  const regle = { type: "fixe_reservation", valeur: 200 };
  const rs = [resa("vide", "2026-11-03"), resa("diff", "2026-11-04"), resa("juste", "2026-11-05"), resa("recue", "2026-11-06")];
  const nets = netsParId({ diff: { commission_prevue: 150 }, juste: { commission_prevue: 200 }, recue: { commission_prevue: 150, commission_recue: 150, commission_recue_le: "2026-11-10" } });
  const t = recalculerCommissions(rs, { regleDe: () => regle, netDe: nets });
  assert.deepEqual(t.changements.map((x) => [x.reservation.id, x.avant]), [["vide", null], ["diff", 150]]);
});

test("point 84 : la commission Taxi saisie se modifie, avec une date de réception", () => {
  const s = source("views/taxi-hier.mjs");
  assert.match(s, /tr\("Modifier"\)/);
  assert.match(s, /type: "date", value: \(edition && x\.recueLe\) \|\| ajd, max: ajd/, "date de réception préremplie, aujourd'hui par défaut, jamais dans le futur");
  assert.match(s, /valeursCommission\(montant\.value, \{ recue: recue\.checked, date: date\.value \}\)/, "la date saisie remplace la date du jour");
  assert.match(s, /if \(!recue\.checked\) Object\.assign\(valeurs, \{ commission_recue: null, commission_recue_le: null \}\)/, "décocher « Déjà reçue » efface la réception");
  assert.match(s, /saisiesRecentes\.add\(r\.id\)/, "la course saisie reste à l'écran pour être corrigée");
});
