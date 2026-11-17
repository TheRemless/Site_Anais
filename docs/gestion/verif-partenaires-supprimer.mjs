// Vérifie la migration 31 (droit « partenaires.supprimer ») sur un Postgres en mémoire : seul ce droit permet de supprimer un partenaire,
// une prestation ou un trajet ; « partenaires.ecrire » seul modifie et masque encore ; le droit entre dans « tous les droits » et dans le rôle
// Administrateur, jamais dans l'Éditeur ; la liste de la base est la même que celle de l'outil (defauts.mjs).
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-partenaires-supprimer.mjs . && GESTION_SQL=<repo>/docs/gestion/ GESTION_SRC=file://<repo>/src/gestion/js/ node verif-partenaires-supprimer.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
const SRC = process.env.GESTION_SRC || "../src/gestion/js/";
const { TOUTES_PERMISSIONS } = await import(SRC + "defauts.mjs");
let echecs = 0;
const ok = (c, msg) => { if (!c) { echecs++; console.log("  ECHEC:", msg); } else console.log("  ok:", msg); };
const lignes = (r) => (r.ok ? r.rows.length : `erreur : ${r.err}`);
const harnais = `
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema public, auth to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
const db = new PGlite();
await db.exec(harnais);
await db.exec(fs.readFileSync(W + "schema.sql", "utf8").replace("create extension if not exists pgcrypto;", ""));
for (const f of fs.readdirSync(W).filter((n) => /^migration-(1[89]|2\d|3[01])-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]))) await db.exec(fs.readFileSync(W + f, "utf8"));
// Deux fois : la migration se rejoue sans erreur ni doublon.
await db.exec(fs.readFileSync(W + "migration-31-partenaires-supprimer.sql", "utf8"));

const essaie = async (userId, sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
};
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const secret = (await un("select id from entites where slug = 'secret'")).id;

const base = (await un("select toutes_permissions() t")).t;
ok(base.includes("partenaires.supprimer"), "le droit entre dans « tous les droits »");
ok(JSON.stringify([...base].sort()) === JSON.stringify([...TOUTES_PERMISSIONS].sort()), "la liste de la base est celle de l'outil (defauts.mjs)");
const roles = (await db.query("select nom, permissions from roles where entite_id = $1", [secret])).rows;
const droitsDe = (nom) => (roles.find((r) => r.nom === nom) || { permissions: [] }).permissions;
ok(droitsDe("Administrateur").includes("partenaires.supprimer"), "le rôle Administrateur reçoit le droit");
ok(droitsDe("Administrateur").filter((d) => d === "partenaires.supprimer").length === 1, "sans doublon après deux passages");
ok(!droitsDe("Éditeur").includes("partenaires.supprimer"), "l'Éditeur ne le reçoit pas");

// Mook : les droits de l'Éditeur (partenaires.ecrire compris), pas de suppression. Anaïs : Administratrice de Secret.
const U = {};
// La première personne inscrite devient administratrice générale : on la crée d'abord, à part.
for (const k of ["root", "mook", "anais"]) U[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
await db.exec(`insert into membres values ('${U.mook}', '${secret}', (select id from roles where entite_id = '${secret}' and nom = 'Éditeur'))`);
await db.exec(`insert into membres values ('${U.anais}', '${secret}', (select id from roles where entite_id = '${secret}' and nom = 'Administrateur'))`);
const part = (await un("insert into partenaires (entite_id, nom) values ($1, 'Tour Example') returning id", [secret])).id;
const pres = (await un("insert into prestations (entite_id, partenaire_id, famille, libelle) values ($1, $2, 'excursion', 'Island tour') returning id", [secret, part])).id;
const traj = (await un("insert into trajets (entite_id, partenaire_id, de, vers) values ($1, $2, 'Lanta', 'Phi Phi') returning id", [secret, part])).id;

for (const [table, id] of [["prestations", pres], ["trajets", traj], ["partenaires", part]]) {
  const r = await essaie(U.mook, `delete from ${table} where id = $1 returning id`, [id]);
  ok(lignes(r) === 0, `sans le droit, la suppression dans ${table} ne touche rien`);
}
ok(lignes(await essaie(U.mook, "update partenaires set actif = false where id = $1 returning id", [part])) === 1, "sans le droit, on masque encore un partenaire");
ok(lignes(await essaie(U.mook, "update prestations set actif = false where id = $1 returning id", [pres])) === 1, "sans le droit, on masque encore une prestation");
ok(lignes(await essaie(U.mook, "update trajets set actif = false where id = $1 returning id", [traj])) === 1, "sans le droit, on masque encore un trajet");
ok(lignes(await essaie(U.mook, "insert into prestations (entite_id, partenaire_id, famille, libelle) values ($1, $2, 'excursion', 'Copie') returning id", [secret, part])) === 1, "sans le droit, on crée encore une prestation");
ok((await un("select count(*)::int n from prestations where partenaire_id = $1", [part])).n === 2, "les éléments sont toujours là");

ok(lignes(await essaie(U.anais, "delete from trajets where id = $1 returning id", [traj])) === 1, "avec le droit, l'administratrice supprime un trajet");
ok(lignes(await essaie(U.anais, "delete from partenaires where id = $1 returning id", [part])) === 1, "avec le droit, l'administratrice supprime un partenaire");
ok((await un("select count(*)::int n from prestations where partenaire_id = $1", [part])).n === 0, "ses prestations partent avec lui (cascade)");

console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTOUT EST BON");
process.exit(echecs ? 1 : 0);
