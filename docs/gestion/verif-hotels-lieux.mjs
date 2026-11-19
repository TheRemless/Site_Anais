// Vérifie la migration 48 (hôtels situés, usages de l'assistant dans le journal) sur un Postgres en mémoire : qui lit, qui écrit, qu'une entreprise
// ne voit pas les hôtels d'une autre, que la base pose la date et l'auteur, et que le journal accepte les nouveaux usages.
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-hotels-lieux.mjs . && GESTION_SQL=<repo>/docs/gestion/ node verif-hotels-lieux.mjs
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
ok(migrations.includes("migration-27-assistant.sql") && migrations.includes("migration-48-hotels-lieux.sql"), "les migrations 27 et 48 sont appliquées, dans l'ordre");
await db.exec(fs.readFileSync(W + "migration-48-hotels-lieux.sql", "utf8"));
ok(true, "la migration 48 se rejoue sans erreur");

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

const ajoute = (u, e, cle, lieu = "Koh Phi Phi") => comme(u, `insert into hotels_lieux (entite_id, cle, nom, lieu, zone, source_url, certitude) values ('${ent[e]}', '${cle}', '${cle}', '${lieu}', 'Tonsai', 'https://exemple.test/hotel', 'probable') returning id, maj_par`);

console.log("== Le public ne lit ni n'écrit rien ==");
ok((await essaie("anon", null, "select 1 from hotels_lieux")).ok === false, "anon ne lit pas la table");
ok((await essaie("anon", null, `insert into hotels_lieux (entite_id, cle, nom) values ('${ent.secret}', 'x', 'x')`)).ok === false, "anon n'écrit pas");

console.log("== Qui ajoute ==");
const a = await ajoute("anais", "secret", "paradise resort phi phi");
ok(a.ok && a.rows[0].maj_par === U.anais, "Anaïs (Administrateur de Secret) ajoute un hôtel, la base note qu'elle l'a fait");
ok(!(await ajoute("lecteur", "secret", "autre hotel")).ok, "un lecteur ne peut pas ajouter (pas « dossiers.ecrire »)");
ok(!(await ajoute("stagiaire", "secret", "autre hotel 2")).ok, "un rôle sans la base de prix ne peut pas ajouter (pas « partenaires.lire »)");
ok(!(await ajoute("anais", "ztp", "hotel ztp")).ok, "Anaïs n'écrit pas dans une entreprise dont elle n'est pas membre");
ok(!(await ajoute("anais", "secret", "paradise resort phi phi")).ok, "un même hôtel n'existe qu'une fois par entreprise");
const usurpe = await comme("anais", `insert into hotels_lieux (entite_id, cle, nom, maj_par) values ('${ent.secret}', 'usurpe', 'usurpe', '${U.lecteur}') returning maj_par`);
ok(usurpe.ok && usurpe.rows[0].maj_par === U.anais, "l'auteur est celui de la session, jamais celui envoyé par l'outil");
ok(!(await comme("anais", `insert into hotels_lieux (entite_id, cle, nom, certitude) values ('${ent.secret}', 'mauvais', 'mauvais', 'certaine')`)).ok, "certitude hors liste refusée");

console.log("== Qui lit ==");
const voit = async (u) => ((await comme(u, "select cle from hotels_lieux order by cle")).rows || []).map((r) => r.cle).join(",");
ok((await voit("anais")) === "paradise resort phi phi,usurpe", "Anaïs voit les hôtels de Secret");
ok((await voit("lecteur")) === "paradise resort phi phi,usurpe", "un lecteur de Secret les voit (base de prix)");
ok((await voit("stagiaire")) === "", "un rôle sans la base de prix ne les voit pas");
ok((await voit("ztp")) === "", "un éditeur de Zwald ne voit pas ceux de Secret");

console.log("== Qui corrige et supprime ==");
const corr = await comme("anais", `update hotels_lieux set lieu = 'Koh Lanta', verifie = true, entite_id = '${ent.ztp}' where cle = 'paradise resort phi phi' returning lieu, verifie, entite_id`);
ok(corr.ok && corr.rows[0].lieu === "Koh Lanta" && corr.rows[0].verifie === true, "Anaïs corrige le lieu et marque l'hôtel vérifié");
ok(corr.ok && corr.rows[0].entite_id === ent.secret, "l'entreprise d'une ligne ne change pas");
ok((await comme("lecteur", "update hotels_lieux set lieu = 'x' returning id")).rows?.length === 0, "un lecteur ne corrige rien");
ok((await comme("anais", "delete from hotels_lieux where cle = 'usurpe' returning id")).rows?.length === 1, "l'administration supprime une ligne (partenaires.ecrire)");

console.log("== Journal de l'assistant ==");
for (const u of ["itineraire", "situer", "repondre_itineraire", "lire"]) {
  const r = await essaie("postgres", null, `insert into assistant_journal (user_id, entite_id, usage, statut) values ('${U.anais}', '${ent.secret}', '${u}', 'ok') returning id`);
  ok(r.ok, `le journal accepte l'usage « ${u} »`);
}
ok(!(await essaie("postgres", null, `insert into assistant_journal (user_id, entite_id, usage, statut) values ('${U.anais}', '${ent.secret}', 'autre', 'ok')`)).ok, "un usage inconnu reste refusé");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
