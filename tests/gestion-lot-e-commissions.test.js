// tests/gestion-lot-e-commissions.test.js : lot E de l'audit d'autonomie du 16.11.2026 (points 10 et 84, bandeau « Recalculer »).
// Une réception se défait et le recalcul reste accessible même sans commission en attente. L'encaissement lui-même a été refait dossier par
// dossier le 20.11.2026 (tests/gestion-encaisser-dossiers.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { recalculerCommissions } from "../src/gestion/js/operations-calc.mjs";

const netsParId = (table) => (r) => table[r.id] || null;
const resa = (id, date, extra = {}) => ({ id, dossier_id: "d", partenaire_id: "rattana", date_service: date, statut: "confirme", montant_vente: 1000, paye_sur_place: true, ...extra });
const source = (f) => fs.readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");

test("point 10 : l'écran encaisse dossier par dossier (voir gestion-encaisser-dossiers.test.js) et laisse annuler une réception", () => {
  const s = source("views/encaisser-commissions.mjs");
  assert.match(s, /aRecevoirParPartenaire\(etat\.db\.reservations, netDe, \{ ecartees, ajd \}\)/);
  assert.match(s, /ecrituresEncaissement\(b\.d, netReservation, \{/, "chaque dossier coché a ses propres écritures");
  assert.match(s, /VALEURS_ANNULATION/, "annuler une réception efface montant, dates, moyen et motif");
  assert.match(s, /tr\("Annuler la réception"\)/);
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
