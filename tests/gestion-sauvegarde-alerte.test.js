import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { alerteSauvegarde, DELAI_ALERTE_H } from "../src/gestion/js/sauvegarde-calc.mjs";

const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const MAINTENANT = "2026-11-21T12:00:00Z";
const ilYa = (h) => new Date(Date.parse(MAINTENANT) - h * 3600 * 1000).toISOString();

test("alerte sauvegarde : rien quand une sauvegarde a réussi depuis moins de 30 heures", () => {
  assert.equal(DELAI_ALERTE_H, 30);
  assert.equal(alerteSauvegarde(null), null);
  assert.equal(alerteSauvegarde({ dernier_succes: ilYa(10), maintenant: MAINTENANT }), null);
  assert.equal(alerteSauvegarde({ dernier_succes: ilYa(29.9), dernier_echec: ilYa(1), maintenant: MAINTENANT }), null);
});

test("alerte sauvegarde : jamais réussie, trop ancienne, avec ou sans échec", () => {
  assert.deepEqual(alerteSauvegarde({ dernier_succes: null, maintenant: MAINTENANT }), { jamais: true, heures: null, echec: false, message: "" });
  const a = alerteSauvegarde({ dernier_succes: ilYa(31), dernier_echec: ilYa(2), message: "connexion refusée", maintenant: MAINTENANT });
  assert.equal(a.heures, 31);
  assert.equal(a.echec, true);
  assert.equal(a.message, "connexion refusée");
  // GitHub n'a rien lancé : pas d'échec noté, l'alerte sonne quand même.
  assert.equal(alerteSauvegarde({ dernier_succes: ilYa(50), maintenant: MAINTENANT }).echec, false);
});

test("écran : le bandeau est posé sous celui du crédit et le démarrage recharge une fois sur un fichier disparu", () => {
  const app = lire("src/gestion/js/app.mjs");
  assert.match(app, /bandeauCredit\(\), bandeauSauvegarde\(\)/);
  assert.match(app, /FICHIER_DISPARU\.test\(String\(\(err && err\.message\) \|\| ""\)\)\)[\s\S]{0,400}location\.reload\(\)/);
  const m = lire("docs/gestion/migration-66-sauvegarde-github.sql");
  assert.match(m, /grant execute on function sauvegarde_etat\(\) to authenticated/);
  assert.doesNotMatch(m, /password '/i);
});
