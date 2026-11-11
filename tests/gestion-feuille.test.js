import { test } from "node:test";
import assert from "node:assert/strict";
import { alertesFeuille, texteFeuillePartage, joursProposes, reportsProposes } from "../src/gestion/js/feuille-calc.mjs";

const groupe = {
  nom: "Van démo",
  adultes: 3,
  enfants: 0,
  lignes: [
    { id: "a", heure: "08:00", libelle: "Airport → Lanta", client: "Anna Keller", telephone: "+49 160 1", hotel: "Hotel Sunset", chambre: "12", personnes: { adultes: 2 } },
    { id: "b", heure: "", libelle: "Airport → Lanta", client: "Ben Walker", telephone: "", hotel: "", chambre: "", personnes: { adultes: 1 } },
  ],
};

test("alertes : heure et hôtel manquants, dans l'ordre de la feuille", () => {
  assert.deepEqual(alertesFeuille([groupe]), [{ id: "b", libelle: "Airport → Lanta", client: "Ben Walker", manque: ["heure", "hotel"] }]);
  assert.deepEqual(alertesFeuille([{ lignes: [] }]), []);
  assert.deepEqual(alertesFeuille([{ lignes: [{ id: "c", heure: "09:00", hotel: "  ", libelle: "x", client: "y" }] }])[0].manque, ["hotel"]);
});

test("texte : un pickup incomplet le dit, un pickup complet est inchangé", () => {
  const t = texteFeuillePartage(groupe, "2026-11-12").split("\n");
  assert.match(t[0], /^Van démo: 12 November 2026, 3 adults$/);
  assert.match(t[1], /^08:00 · Airport → Lanta · Anna Keller · \+49 160 1 · Hotel Sunset, room 12 · 2 adults$/);
  assert.match(t[2], /^time TBC · Airport → Lanta · Ben Walker · pickup TBC · 1 adult$/);
});

test("jours proposés : aujourd'hui, demain, après-demain, fin de mois comprise", () => {
  assert.deepEqual(joursProposes("2026-11-30"), ["2026-11-30", "2026-12-01", "2026-12-02"]);
});

test("reports : le lundi est toujours le prochain, un dimanche comme un lundi", () => {
  assert.equal(reportsProposes("2026-11-11").lundi, "2026-11-16"); // mercredi
  assert.equal(reportsProposes("2026-11-15").lundi, "2026-11-16"); // dimanche
  assert.equal(reportsProposes("2026-11-16").lundi, "2026-11-23"); // lundi
  assert.equal(reportsProposes("2026-11-30").demain, "2026-12-01");
  assert.equal(reportsProposes("2026-11-11").semaine, "2026-11-18");
});
