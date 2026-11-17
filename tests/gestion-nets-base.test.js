// Lot F (audit du 16.11.2026, point 12) : la base remplit le net et la commission prévus (migration 31). Le formulaire de réservation
// n'écrit plus que les champs de nets changés, pour ne pas écraser ce recalcul avec la valeur lue à l'ouverture.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { champsNetsChanges } from "../src/gestion/js/nets-reservation-calc.mjs";

const lue = { net_prevu: 2100, net_paye: null, paye_le: null, commission_prevue: 220, commission_recue: null, commission_recue_le: null };
const saisis = (x = {}) => ({ net_prevu: 2100, net_paye: null, paye_le: null, commission_prevue: 220, commission_recue: null, commission_recue_le: null, ...x });

test("rien de changé dans le formulaire : rien à écrire", () => {
  assert.deepEqual(champsNetsChanges(lue, saisis()), {});
});

test("un nombre relu en texte ou une date vide ne comptent pas comme un changement", () => {
  assert.deepEqual(champsNetsChanges({ ...lue, net_prevu: "2100.00", paye_le: "" }, saisis()), {});
});

test("seul le champ modifié s'écrit", () => {
  assert.deepEqual(champsNetsChanges(lue, saisis({ commission_prevue: 300 })), { commission_prevue: 300 });
  assert.deepEqual(champsNetsChanges(lue, saisis({ paye_le: "2026-11-20", net_paye: 2100 })), { net_paye: 2100, paye_le: "2026-11-20" });
});

test("effacer un champ s'écrit (null)", () => {
  assert.deepEqual(champsNetsChanges(lue, saisis({ net_prevu: null })), { net_prevu: null });
});

test("sans ligne lue : seuls les champs remplis s'écrivent, un formulaire vide n'écrit rien", () => {
  assert.deepEqual(champsNetsChanges(null, saisis({ net_prevu: null, commission_prevue: null })), {});
  assert.deepEqual(champsNetsChanges(null, saisis({ net_prevu: 900, commission_prevue: null })), { net_prevu: 900 });
});

test("le formulaire passe par champsNetsChanges avant d'écrire les nets", () => {
  const src = fs.readFileSync(new URL("../src/gestion/js/views/reservations.mjs", import.meta.url), "utf8");
  assert.match(src, /champsNetsChanges\(n, \{ net_prevu:/);
  assert.doesNotMatch(src, /\|\| n\)\) await enregistrerLie\("reservations_nets"/);
});

test("la migration 31 : déclencheur à l'insertion et aux changements, fonctions fermées à l'API, Secret seulement", () => {
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-30-nets-base.sql", import.meta.url), "utf8");
  assert.match(sql, /create trigger remplir_nets after insert or update on reservations/);
  assert.match(sql, /create trigger fusionner_nets before insert on reservations_nets/);
  assert.match(sql, /valeur->>'fonctionnement' = 'excursions'/);
  for (const f of ["nombre_json", "commission_calculee", "net_catalogue_ligne", "net_reservation_calcule", "calculer_nets_reservation", "remplir_nets_reservation", "fusionner_nets_reservation"]) {
    assert.match(sql, new RegExp(`revoke all on function ${f}\\(`), f);
  }
  // Les politiques de lecture des nets ne changent pas.
  assert.doesNotMatch(sql, /create policy|drop policy|grant /i);
});
