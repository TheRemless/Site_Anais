// Vérifie la migration 54 (demandes d'amélioration depuis l'Assistant) sur un Postgres en mémoire : la table ne se lit que par les
// administratrices de l'entreprise, ne s'écrit par personne avec une session (seulement par les fonctions, clé de service) ; les cartes
// acceptent les genres « reglage » et « amelioration ».
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-ameliorations.mjs . && GESTION_SQL=<repo>/docs/gestion/ node verif-ameliorations.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
let echecs = 0;
const ok = (c, msg) => { if (!c) { echecs++; console.log("  ECHEC:", msg); } else console.log("  ok:", msg); };
// Comme Supabase : toute nouvelle table du schéma public est d'abord ouverte à anon et authenticated, la migration doit la refermer elle-même.
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
grant execute on function auth.uid() to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
const db = new PGlite();
await db.exec(harnais);
await db.exec((fs.readFileSync(W + "schema.sql", "utf8") + fs.readFileSync(W + "donnees-ztp-depart.sql", "utf8")).replace("create extension if not exists pgcrypto;", ""));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
for (const f of migrations) await db.exec(fs.readFileSync(W + f, "utf8"));
ok(migrations.includes("migration-54-ameliorations.sql"), "la migration 54 est appliquée, après les autres");
await db.exec(fs.readFileSync(W + "migration-54-ameliorations.sql", "utf8"));
ok(true, "la migration 54 se rejoue sans erreur");

const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const ent = {};
for (const s of ["ztp", "secret", "taxi"]) ent[s] = (await un("select id from entites where slug = $1", [s])).id;
const essaie = async (role, userId, sql, params = []) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
};
const U = {};
for (const k of ["anais", "lecteur", "stagiaire", "ztp"]) U[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
const comme = (u, sql, p) => essaie("authenticated", U[u], sql, p);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Ses dossiers', 'mes_dossiers', array['clients.lire','clients.ecrire','dossiers.lire','dossiers.ecrire'])`);
const membre = (u, s, role) => db.exec(`insert into membres values ('${U[u]}', '${ent[s]}', (select id from roles where entite_id = '${ent[s]}' and nom = '${role}'))`);
await membre("anais", "secret", "Administrateur");
await membre("lecteur", "secret", "Lecteur");
await membre("stagiaire", "secret", "Ses dossiers");
await membre("ztp", "ztp", "Éditeur");

const conv = async (u, e) => comme(u, `insert into agent_conversations (entite_id, titre) values ('${ent[e]}', 'Amélioration') returning id`);

console.log("== Le public ne lit rien ==");
ok((await essaie("anon", null, "select 1 from ameliorations")).ok === false, "anon ne lit pas les demandes");

console.log("== Cartes « reglage » et « amelioration » ==");
const c = (await conv("anais", "secret")).rows[0].id;
for (const g of ["reglage", "amelioration"]) ok((await comme("anais", `insert into agent_cartes (conversation_id, genre, titre) values ('${c}', '${g}', 'x') returning id`)).ok, `une carte « ${g} » s'ajoute`);
ok(!(await comme("anais", `insert into agent_cartes (conversation_id, genre, titre) values ('${c}', 'autre', 'x')`)).ok, "un genre inconnu reste refusé");
ok((await comme("anais", `insert into agent_cartes (conversation_id, genre, titre) values ('${c}', 'temps', 'x') returning id`)).ok, "les anciens genres restent permis");

console.log("== Demandes : écrites par les fonctions seulement, lues par les administratrices ==");
const carte = (await un(`select id from agent_cartes where genre = 'amelioration'`)).id;
const ins = await essaie("postgres", null, `insert into ameliorations (entite_id, user_id, conversation_id, carte_id, titre, texte) values ('${ent.secret}', '${U.anais}', '${c}', '${carte}', 'Champ vol', 'Besoin : noter le vol.') returning id, statut`);
ok(ins.ok && ins.rows[0].statut === "envoyee", "la clé de service enregistre une demande, « envoyée » par défaut");
ok(!(await comme("anais", `insert into ameliorations (entite_id, user_id, titre, texte) values ('${ent.secret}', '${U.anais}', 'x', 'y')`)).ok, "une administratrice n'écrit pas elle-même dans la table");
ok(!(await comme("anais", `update ameliorations set statut = 'en_ligne' returning id`)).ok || ((await comme("anais", `update ameliorations set statut = 'en_ligne' returning id`)).rows || []).length === 0, "ni ne change un statut");
ok(((await comme("anais", "select id from ameliorations")).rows || []).length === 1, "l'administratrice de Secret lit la demande");
ok(((await comme("lecteur", "select id from ameliorations")).rows || []).length === 0, "un lecteur de Secret ne la lit pas");
ok(((await comme("ztp", "select id from ameliorations")).rows || []).length === 0, "une personne d'une autre entreprise ne la lit pas");
ok(!(await essaie("postgres", null, `insert into ameliorations (entite_id, user_id, titre, texte, statut) values ('${ent.secret}', '${U.anais}', 'x', 'y', 'fusionnee')`)).ok, "un statut inconnu est refusé");
ok(!(await essaie("postgres", null, `insert into ameliorations (entite_id, user_id, titre, texte, pr_url) values ('${ent.secret}', '${U.anais}', 'x', 'y', 'https://evil.example/pull/1')`)).ok, "un lien de PR hors GitHub est refusé");
ok(!(await essaie("postgres", null, `insert into ameliorations (entite_id, user_id, titre, texte) values ('${ent.secret}', '${U.anais}', '${"x".repeat(81)}', 'y')`)).ok, "un titre de plus de 80 caractères est refusé");
const sup = await essaie("postgres", null, `delete from agent_cartes where id = '${carte}'`);
ok(sup.ok && (await un("select carte_id from ameliorations")).carte_id === null, "la carte supprimée (conservation) laisse la demande, sans lien");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
