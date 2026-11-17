// Migration 42 (plusieurs organisations) : les fonctions serveur ne mélangent pas les organisations.
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
  assert.match(demande, /from\("entites"\)\.select\("id, nom, slug"\)\.eq\("organisation_id", ORGANISATION\)\.eq\("publie_site", true\)/);
  assert.match(demande, /from\("profils"\)\.select\("user_id, actif, super_admin"\)\.eq\("organisation_id", ORGANISATION\)/);
  assert.doesNotMatch(demande, /const SLUG/);
  const bandeau = fs.readFileSync(new URL("../supabase/functions/bandeau-site/index.ts", import.meta.url), "utf8");
  assert.match(bandeau, /\.in\("entite_id", /);
});

test("la migration 42 ne garde aucun slug écrit en dur hors reprise de Zwald", () => {
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-42-organisations.sql", import.meta.url), "utf8");
  const lignes = sql.split("\n").filter((l) => /'(secret|taxi)'/.test(l));
  assert.ok(lignes.every((l) => /00000000-0000-0000-0000-00000000a000/.test(l) || /^update /.test(l.trim())), lignes.join("\n"));
});

test("migration 42 : le bandeau du site garde le droit « reglages.ecrire » de la migration 40", () => {
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-42-organisations.sql", import.meta.url), "utf8");
  const corps = sql.slice(sql.indexOf("function publie_sur_le_site"), sql.indexOf("$$;", sql.indexOf("function publie_sur_le_site")));
  assert.match(corps, /a_permission\(e, 'reglages\.ecrire'\)/);
  assert.match(corps, /publie_site/);
});

test("outil : organisation du compte, rôle « tous droits » de la première entreprise, éditeur et modèle par défaut", () => {
  const etat = fs.readFileSync(new URL("../src/gestion/js/etat.mjs", import.meta.url), "utf8");
  assert.match(etat, /const mienne = etat\.moi && etat\.moi\.organisation_id;/, "l'éditeur ne prend pas la première organisation venue");
  assert.match(etat, /\|\| \(!etat\.brut\.roles\.length && organisation\(\) !== null\)/, "première entreprise : le rôle Administrateur a « tous droits »");
  const admin = fs.readFileSync(new URL("../src/gestion/js/views/admin.mjs", import.meta.url), "utf8");
  assert.match(admin, /etat\.moi && etat\.moi\.plateforme \? h\("button", \{ class: "secondaire", type: "button", onclick: \(\) => nouveauClientModal\(\) \}/, "« Nouveau client » aussi dans Administration");
  assert.match(admin, /\(organisation\(\) \|\| \{\}\)\.langue === "fr" \? "" : MODELE_DEFAUT/, "organisation en français : réglages vides par défaut, comme avant");
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-42-organisations.sql", import.meta.url), "utf8");
  assert.match(sql, /case when r\.tous_droits then toutes_permissions\(\) else r\.permissions end/, "permissions_dans garde la règle de la migration 38");
  assert.match(sql, /app->>'organisation_id'/);
  assert.doesNotMatch(sql, /meta->>'organisation_id'/, "la métadonnée choisie à l'inscription n'est jamais crue");
});
