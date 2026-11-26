// Vérifie la migration 129 (téléphone d'un client : un numéro international coupé est refusé) sur un Postgres en mémoire : schema.sql puis
// toutes les migrations. Puis : rejeu, retour en arrière, rejeu. Numéros inventés.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-telephone-client.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
let echecs = 0;
const ok = (c, msg) => { if (!c) { echecs++; console.log("  ECHEC:", msg); } else console.log("  ok:", msg); };
const harnais = `
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema public, auth, storage to authenticated, anon;
grant all on all tables in schema storage to authenticated;
grant execute on function auth.uid() to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
const MIG = "migration-129-telephone-client.sql";
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d|1\d\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
ok(migrations.includes(MIG) && migrations.indexOf(MIG) > migrations.indexOf("migration-128-frais-parc-libelle.sql"), "la migration 129 passe après la 128");
// Une fiche ancienne au numéro coupé, écrite avant la migration : elle reste lisible et modifiable sur ses autres champs.
const migrationsAvant = migrations.filter((f) => f !== MIG);
for (const f of migrationsAvant) await db.exec(lire(f));
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const E = (await un("select id from entites where slug = 'secret'")).id;
const ancien = (await un("insert into clients (entite_id, nom, telephone) values ($1, 'Ancienne', '+1555012') returning id", [E])).id;
await db.exec(lire(MIG));

const U = (await un("insert into auth.users (email) values ('nani@test') returning id")).id;
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${E}', 'Ventes test', 'toute', array['clients.lire','clients.ecrire','dossiers.lire','dossiers.ecrire'])`);
await db.exec(`insert into membres values ('${U}', '${E}', (select id from roles where entite_id = '${E}' and nom = 'Ventes test'))`);
const essaie = async (sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${U}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
};
const creer = (tel) => essaie("insert into clients (entite_id, nom, telephone) values ($1, 'Test', $2) returning id", [E, tel]);

const BONS = ["+15550123456", "+41791234567", "+33612345678", "+66812345678", "+447700900123", "+4930123456", "", "079 123 45 67"];
const MAUVAIS = ["+1555012", "+155501234567", "+4179123456", "+336123456789", "+6681234", "+1234567890123456"];
for (const t of BONS) ok((await creer(t)).ok, `accepté depuis l'application : « ${t || "(vide)"} »`);
for (const t of MAUVAIS) {
  const r = await creer(t);
  ok(!r.ok && /incomplet ou trop long/.test(r.err), `refusé depuis l'application : « ${t} »`);
}
ok((await essaie("update clients set notes = 'vu' where id = $1", [ancien])).ok, "une fiche ancienne au numéro coupé se modifie sur ses autres champs");
const corr = await essaie("update clients set telephone = '+1555012' where id = $1", [ancien]);
ok(corr.ok, "réécrire le même numéro n'est pas un changement");
ok(!(await essaie("update clients set telephone = '+155501' where id = $1", [ancien])).ok, "le changer pour un autre numéro coupé est refusé");
ok((await essaie("update clients set telephone = '+15550123456' where id = $1", [ancien])).ok, "le corriger en numéro complet passe");
// Hors application (fonction de la base, administration) : pas de blocage, le numéro est recopié tel quel.
ok(!!(await un("insert into clients (entite_id, nom, telephone) values ($1, 'Admin', '+1555012') returning id", [E])), "une écriture hors application (propriétaire) n'est pas bloquée");

await db.exec(lire(MIG));
ok(!(await creer("+1555012")).ok, "la migration 129 se rejoue sans effet");
await db.exec(lire("retour-129-telephone-client.sql"));
ok((await creer("+1555012")).ok && !(await un("select count(*)::int n from pg_proc where proname = 'controler_telephone_client'")).n, "retour : le contrôle est retiré");
await db.exec(lire(MIG));
ok(!(await creer("+1555012")).ok, "et la 129 se repose après le retour");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
