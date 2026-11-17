// Vérifie la migration 31 (rappel une heure avant) sur un Postgres en mémoire : un seul envoi par service et par heure, table fermée au public,
// interrupteur du profil réservé à la personne elle-même, suivi qui accepte le type « h1 ».
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-rappel-h1.mjs . && GESTION_SQL=<repo>/docs/gestion/ node verif-rappel-h1.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
let echecs = 0;
const ok = (c, msg) => { if (!c) { echecs++; console.log("  ECHEC:", msg); } else console.log("  ok:", msg); };
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema public, auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`);
await db.exec(fs.readFileSync(W + "schema.sql", "utf8").replace("create extension if not exists pgcrypto;", ""));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[789]|2\d|3\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
for (const f of migrations) await db.exec(fs.readFileSync(W + f, "utf8"));
ok(migrations.includes("migration-31-rappel-h1.sql"), "la migration 31 est appliquée après les autres");
// Comme Supabase : les tables déjà là sont ouvertes à authenticated ; celles de la migration 31 sont refermées par elle (on rejoue ses revoke).
await db.exec("grant all on all tables in schema public to authenticated; revoke insert, update, delete on journal from authenticated;");
for (const l of fs.readFileSync(W + "migration-31-rappel-h1.sql", "utf8").split("\n").filter((x) => /^revoke /.test(x))) await db.exec(l);

const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const essaie = async (role, userId, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
};
const secret = (await un("select id from entites where slug = 'secret'")).id;
const U = {};
for (const k of ["anais", "autre"]) U[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
const client = (await un(`insert into clients (entite_id, prenom, nom) values ('${secret}', 'Anna', 'Keller') returning id`)).id;
const dossier = (await un(`insert into dossiers (entite_id, ref, client_id) values ('${secret}', 'INV-1', '${client}') returning id`)).id;
const res = (await un(`insert into reservations (entite_id, dossier_id, libelle, date_service, heure_pickup) values ('${secret}', '${dossier}', '4 Islands', '2026-11-17', '08:00') returning id`)).id;

console.log("== Un seul envoi par service et par heure ==");
const marquer = (debut) => db.query(`insert into rappels_h1_envois (reservation_id, debut) values ('${res}', '${debut}') on conflict (reservation_id, debut) do nothing returning reservation_id`);
ok((await marquer("2026-11-17T01:00:00Z")).rows.length === 1, "premier passage : le service est marqué, le rappel part");
ok((await marquer("2026-11-17T01:00:00Z")).rows.length === 0, "passage suivant (ou exécution en double) : rien de nouveau, pas de second rappel");
ok((await marquer("2026-11-17T02:00:00Z")).rows.length === 1, "l'heure a changé : nouveau début, nouveau rappel");
await db.query(`insert into rappels_h1_envois (reservation_id, debut, envoye_le) values ('${res}', '2026-10-01T01:00:00Z', now() - interval '40 days')`);
ok((await un(`select count(*)::int n from rappels_h1_envois where envoye_le < now() - interval '30 days'`)).n === 0, "les marques de plus de 30 jours sont purgées");

console.log("== ZTP : un rappel par voyage et par date de départ ==");
const ztp = (await un("select id from entites where slug = 'ztp'")).id;
const clientZ = (await un(`insert into clients (entite_id, prenom, nom) values ('${ztp}', 'Famille', 'Dupont') returning id`)).id;
const voyage = (await un(`insert into dossiers (entite_id, ref, client_id, date_depart, accepte_le) values ('${ztp}', 'FD20261201', '${clientZ}', '2026-12-01', '2026-11-01') returning id`)).id;
const depart = (date) => db.query(`insert into rappels_depart_envois (dossier_id, date_depart) values ('${voyage}', '${date}') on conflict (dossier_id, date_depart) do nothing returning dossier_id`);
ok((await depart("2026-12-01")).rows.length === 1, "la veille du départ : le voyage est marqué, le rappel part");
ok((await depart("2026-12-01")).rows.length === 0, "même date : pas de second rappel");
ok((await depart("2026-12-03")).rows.length === 1, "départ déplacé : nouveau rappel la veille de la nouvelle date");
ok((await essaie("authenticated", U.anais, "select 1 from rappels_depart_envois")).ok === false, "les marques des départs sont fermées à l'outil");
await db.query(`delete from dossiers where id = '${voyage}'`);
ok((await un("select count(*)::int n from rappels_depart_envois")).n === 0, "un dossier supprimé emporte ses marques");

console.log("== Table fermée au public et à l'outil ==");
ok((await essaie("anon", null, "select 1 from rappels_h1_envois")).ok === false, "anon ne lit pas les marques");
ok((await essaie("authenticated", U.anais, "select 1 from rappels_h1_envois")).ok === false, "une personne connectée ne les lit pas");
ok((await essaie("authenticated", U.anais, `insert into rappels_h1_envois (reservation_id, debut) values ('${res}', now())`)).ok === false, "ni ne les écrit (seule la fonction le fait)");

console.log("== Interrupteur du profil ==");
ok((await un(`select rappel_h1 from profils where user_id = '${U.anais}'`)).rappel_h1 === true, "allumé par défaut pour chaque profil");
ok((await essaie("authenticated", U.anais, "select definir_rappel_h1(false)")).ok, "Anaïs coupe son rappel");
ok((await un(`select rappel_h1 from profils where user_id = '${U.anais}'`)).rappel_h1 === false && (await un(`select rappel_h1 from profils where user_id = '${U.autre}'`)).rappel_h1 === true, "seul son profil change");
ok((await essaie("authenticated", U.autre, `update profils set rappel_h1 = false where user_id = '${U.anais}'`)).n === 0, "personne ne change le réglage d'un autre");
ok((await essaie("anon", null, "select definir_rappel_h1(true)")).ok === false, "anon n'appelle pas la fonction");

console.log("== Suivi ==");
ok((await db.query("insert into rappels_suivi (type, envoyes) values ('h1', 1) returning id")).rows.length === 1, "le suivi accepte le type h1");
ok(await db.query("insert into rappels_suivi (type) values ('autre')").then(() => false, () => true), "et refuse un type inconnu");
await db.query(`delete from reservations where id = '${res}'`);
ok((await un("select count(*)::int n from rappels_h1_envois")).n === 0, "une réservation supprimée emporte ses marques");

console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTOUT EST BON");
process.exit(echecs ? 1 : 0);
