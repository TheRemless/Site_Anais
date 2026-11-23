// Vérifie la migration 120 (une carte de l'Assistant ne se valide qu'une fois) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// INV-2026-046 et 047 (23.11.2026) : la même carte « dossier » a créé deux dossiers à 3 secondes d'écart. Ici : une carte se prend une seule fois,
// jamais une carte d'une autre personne, ni une carte validée ou écartée ; rendue après un arrêt, elle se reprend ; une prise de plus de 2 minutes
// se reprend ; fermée à anon ; la migration se rejoue ; retour en arrière.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-carte-prise-une-fois.mjs
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
const MIG = "migration-120-carte-prise-une-fois.sql";
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d|1\d\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
ok(migrations.includes(MIG) && migrations.indexOf(MIG) > migrations.indexOf("migration-119-corriger-commission.sql"), "la migration 120 passe après la 119, sur une base vide");
for (const f of migrations) await db.exec(lire(f));

async function essaie(userId, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];

// ---- Données fictives : deux personnes de la même entreprise, chacune sa conversation et sa carte --------------------------------------
const ent = (await un("select id from entites where slug = 'secret'")).id;
const ORG = (await un("select organisation_id from entites where id = $1", [ent])).organisation_id;
const u = {};
for (const k of ["nani", "autre"]) u[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
for (const k of ["nani", "autre"]) await db.exec(`insert into membres values ('${u[k]}', '${ent}', (select id from roles where entite_id = '${ent}' and nom = 'Administrateur')) on conflict do nothing`);
const conversation = async (k) => (await essaie(u[k], "insert into agent_conversations (entite_id, titre) values ($1, 'Test') returning id", [ent])).rows[0].id;
const carte = async (k, conv) => (await essaie(u[k], "insert into agent_cartes (conversation_id, genre, titre, donnees) values ($1, 'dossier', 'Dossier test', '{\"client\": {\"nom\": \"Client Test\"}}'::jsonb) returning id", [conv])).rows[0].id;
const convN = await conversation("nani");
const convA = await conversation("autre");
const C = await carte("nani", convN);
const prendre = async (k, id) => { const r = await essaie(u[k], "select prendre_agent_carte($1) as ok", [id]); return r.ok ? r.rows[0].ok : r.err; };
const rendre = async (k, id) => essaie(u[k], "select rendre_agent_carte($1)", [id]);

// ---- Une seule prise ---------------------------------------------------------------------------------------------------------------------
ok((await prendre("nani", C)) === true, "la première validation prend la carte");
ok((await prendre("nani", C)) === false, "un second tap (même personne) trouve la carte prise : rien n'est créé");
ok((await prendre("autre", C)) === false, "une autre personne ne prend jamais la carte d'une autre conversation");
ok((await un("select donnees->'client'->>'nom' n from agent_cartes where id = $1", [C])).n === "Client Test", "le contenu de la carte ne change pas");
await rendre("nani", C);
ok((await un("select prise_le from agent_cartes where id = $1", [C])).prise_le === null, "une validation arrêtée rend la carte");
ok((await prendre("nani", C)) === true, "la carte rendue se reprend");
await db.query("update agent_cartes set prise_le = now() - interval '3 minutes' where id = $1", [C]);
ok((await prendre("nani", C)) === true, "une prise de plus de 2 minutes (onglet fermé, coupure) se reprend");
await db.query("update agent_cartes set prise_le = now() - interval '90 seconds' where id = $1", [C]);
ok((await prendre("nani", C)) === false, "une prise de moins de 2 minutes ne se reprend pas");
const r1 = await essaie(u.nani, "update agent_cartes set statut = 'validee' where id = $1 returning statut", [C]);
ok(r1.ok && r1.rows[0].statut === "validee", "la carte se valide comme avant (règle « décider de mes cartes »)");
await db.query("update agent_cartes set prise_le = null where id = $1", [C]);
ok((await prendre("nani", C)) === false, "une carte validée ne se reprend jamais, même rendue");
await rendre("nani", C);
ok((await un("select statut from agent_cartes where id = $1", [C])).statut === "validee", "rendre une carte validée ne change rien");
const E = await carte("autre", convA);
await essaie(u.autre, "update agent_cartes set statut = 'ecartee' where id = $1", [E]);
ok((await prendre("autre", E)) === false, "une carte écartée ne se prend pas");

// ---- Droits ----------------------------------------------------------------------------------------------------------------------------
await db.exec("set role anon;");
let anonOk;
try { await db.query("select prendre_agent_carte($1)", [C]); anonOk = true; } catch { anonOk = false; } finally { await db.exec("reset role;"); }
ok(!anonOk, "fermée à anon");

// ---- Rejeu et retour en arrière ---------------------------------------------------------------------------------------------------------
await db.exec(lire(MIG));
ok((await un("select count(*)::int n from information_schema.columns where table_name = 'agent_cartes' and column_name = 'prise_le'")).n === 1, "la migration 120 se rejoue sans effet");
await db.exec(lire("retour-120-carte-prise-une-fois.sql"));
ok((await un("select count(*)::int n from information_schema.columns where table_name = 'agent_cartes' and column_name = 'prise_le'")).n === 0 && !(await un("select count(*)::int n from pg_proc where proname in ('prendre_agent_carte', 'rendre_agent_carte')")).n, "retour : colonne et fonctions retirées");
await db.exec(lire(MIG));
const D = await carte("nani", convN);
ok((await prendre("nani", D)) === true && (await prendre("nani", D)) === false, "et la 120 se repose après le retour");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
