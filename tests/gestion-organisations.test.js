// Migration 40 (plusieurs organisations) : les fonctions serveur ne mélangent pas les organisations.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { entitesLisibles, destinatairesH1 } from "../supabase/functions/rappels/calc.js";

const entites = [
  { id: "S", organisation_id: "zwald" },
  { id: "T", organisation_id: "zwald" },
  { id: "B", organisation_id: "agence-b" },
];

test("un administrateur ne reçoit les rappels que des entreprises de son organisation", () => {
  const anais = { user_id: "anais", actif: true, super_admin: true, organisation_id: "zwald" };
  const marc = { user_id: "marc", actif: true, super_admin: true, organisation_id: "agence-b" };
  assert.deepEqual(entitesLisibles({ profil: anais, membres: [], roles: [], entites }), ["S", "T"]);
  assert.deepEqual(entitesLisibles({ profil: marc, membres: [], roles: [], entites }), ["B"]);
  const ctx = { profils: [anais, marc], membres: [], roles: [], entites };
  assert.deepEqual(destinatairesH1(ctx, "B"), ["marc"]);
  assert.deepEqual(destinatairesH1(ctx, "S"), ["anais"]);
});

test("les fonctions serveur lisent l'organisation", () => {
  const rappels = fs.readFileSync(new URL("../supabase/functions/rappels/index.ts", import.meta.url), "utf8");
  assert.equal((rappels.match(/entitesLisibles\(\{[^}]*entites/g) || []).length, 3, "chaque appel transmet les entreprises");
  assert.doesNotMatch(rappels, /select\("id, nom"\)/, "les entreprises sont lues avec leur organisation");
  const demande = fs.readFileSync(new URL("../supabase/functions/demande-site/index.ts", import.meta.url), "utf8");
  assert.match(demande, /\.eq\("organisation_id", ORGANISATION\)\.eq\("slug"/);
  assert.match(demande, /from\("profils"\)\.select\("user_id, actif, super_admin"\)\.eq\("organisation_id", ORGANISATION\)/);
  assert.doesNotMatch(demande, /const SLUG/);
  const bandeau = fs.readFileSync(new URL("../supabase/functions/bandeau-site/index.ts", import.meta.url), "utf8");
  assert.match(bandeau, /\.in\("entite_id", /);
});

test("la migration 40 ne garde aucun slug écrit en dur hors reprise de Zwald", () => {
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-40-organisations.sql", import.meta.url), "utf8");
  const lignes = sql.split("\n").filter((l) => /'(secret|taxi)'/.test(l));
  assert.ok(lignes.every((l) => /00000000-0000-0000-0000-00000000a000/.test(l) || /^update /.test(l.trim())), lignes.join("\n"));
});
