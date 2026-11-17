// Vérifie la migration du lot G (journal des nets et commissions des réservations) sur un Postgres en mémoire :
// schema.sql, migrations 18 et 19 (commissions), puis la migration. Même mise en place que verif-securite.mjs :
//   GESTION_SQL=<repo>/docs/gestion/ node verif-journal-nets.mjs
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
const lire = (f) => fs.readFileSync(f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire(W + "schema.sql"));
for (const f of ["migration-18-sur-place.sql", "migration-19-paiements.sql"]) await db.exec(lire(W + f));
await db.exec("grant all on all tables in schema public to authenticated; grant usage, select on all sequences in schema public to authenticated; revoke insert, update, delete on journal from authenticated;");

async function essaie(userId, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
}

const E = (await db.query("select id from entites where slug = 'secret'")).rows[0].id;
const u = {};
for (const k of ["admin", "editeur", "lecteur"]) u[k] = (await db.query("insert into auth.users (email) values ($1) returning id", [k + "@test"])).rows[0].id;
// L'administratrice a tous les droits ; « Journal sans nets » lit le journal sans le droit « partenaires.nets ».
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${E}', 'Journal sans nets', 'toute', array['dossiers.lire', 'journal.voir'])`);
const membre = (user, role) => db.exec(`insert into membres values ('${u[user]}', '${E}', (select id from roles where entite_id = '${E}' and nom = '${role}')) on conflict do nothing`);
await membre("admin", "Administrateur");
await membre("editeur", "Éditeur");
await membre("lecteur", "Journal sans nets");

const C = (await db.query("insert into clients (entite_id, prenom, nom) values ($1, 'A', 'B') returning id", [E])).rows[0].id;
const D = (await db.query("insert into dossiers (entite_id, ref, client_id) values ($1, 'S-1', $2) returning id", [E, C])).rows[0].id;
const R = (await db.query("insert into reservations (entite_id, dossier_id, libelle, date_service, montant_vente) values ($1, $2, '4 îles', '2026-12-10', 2400) returning id", [E, D])).rows[0].id;

const avant = (await db.query("select count(*)::int n from journal where table_name = 'reservations_nets'")).rows[0].n;
await essaie(u.admin, `insert into reservations_nets (entite_id, reservation_id, net_prevu) values ('${E}', '${R}', 1600)`);
ok(avant === 0 && (await db.query("select count(*)::int n from journal where table_name = 'reservations_nets'")).rows[0].n === 0, "avant la migration, les nets ne passent pas par le journal");

await db.exec(lire(W + "migration-35-journal-nets.sql"));
await db.exec(lire(W + "migration-35-journal-nets.sql"));
ok(true, "la migration se rejoue sans erreur (idempotente)");
await db.exec("grant all on all tables in schema public to authenticated; revoke insert, update, delete on journal from authenticated;");

ok((await essaie(u.admin, `update reservations_nets set net_prevu = 1500, commission_prevue = 200 where reservation_id = '${R}'`)).n === 1, "l'administratrice change le net prévu et la commission");
const lignes = (await db.query("select action, cible, libelle, details, user_id from journal where table_name = 'reservations_nets' order by id")).rows;
ok(lignes.length === 1 && lignes[0].action === "update", "la modification laisse une ligne dans le journal");
ok(lignes[0] && lignes[0].cible === R && lignes[0].libelle === "4 îles · S-1" && lignes[0].user_id === u.admin, "avec la réservation, son libellé, le dossier et qui l'a fait");
const d = lignes[0] ? lignes[0].details : {};
ok(Number(d.net_prevu?.avant) === 1600 && Number(d.net_prevu?.apres) === 1500 && d.commission_prevue?.avant === null && Number(d.commission_prevue?.apres) === 200, "les montants avant et après sont notés");
ok(!("id" in d) && !("entite_id" in d) && !("reservation_id" in d), "les identifiants ne sont pas recopiés comme des changements");

await essaie(u.admin, `update reservations_nets set net_prevu = 1500 where reservation_id = '${R}'`);
ok((await db.query("select count(*)::int n from journal where table_name = 'reservations_nets'")).rows[0].n === 1, "une modification sans changement n'est pas notée");

const R2 = (await db.query("insert into reservations (entite_id, dossier_id, libelle, date_service) values ($1, $2, 'Kayak', '2026-12-11') returning id", [E, D])).rows[0].id;
await essaie(u.admin, `insert into reservations_nets (entite_id, reservation_id, net_prevu) values ('${E}', '${R2}', 700)`);
const cree = (await db.query("select details from journal where table_name = 'reservations_nets' and action = 'insert'")).rows[0];
ok(cree && Number(cree.details.net_prevu?.apres) === 700 && !("net_paye" in cree.details), "une création note les valeurs saisies, pas les champs vides");
await db.exec(`delete from reservations where id = '${R2}'`);
const sup = (await db.query("select details, cible from journal where table_name = 'reservations_nets' and action = 'delete'")).rows[0];
ok(sup && sup.cible === R2 && Number(sup.details.net_prevu?.avant) === 700, "la suppression d'une réservation note le net qui disparaît avec elle");

const lu = async (k) => (await essaie(u[k], "select 1 from journal where table_name = 'reservations_nets'")).rows?.length ?? -1;
ok((await lu("admin")) === 3, "l'administratrice (journal et nets) lit ces lignes");
ok((await lu("lecteur")) === 0, "un rôle qui lit le journal sans le droit « nets » ne les voit pas");
ok((await essaie(u.lecteur, "select 1 from journal where table_name = 'reservations'")).rows.length >= 1, "il lit toujours le reste du journal (les réservations)");
ok((await lu("editeur")) === 0 && (await essaie(u.editeur, "select 1 from journal")).rows.length === 0, "l'éditeur, sans droit sur le journal, ne lit rien");
ok((await essaie(u.admin, "delete from journal where table_name = 'reservations_nets'")).n !== 3 && (await db.query("select count(*)::int n from journal where table_name = 'reservations_nets'")).rows[0].n === 3, "personne ne peut effacer ces lignes");
ok((await essaie(u.admin, `insert into journal (entite_id, table_name, action) values ('${E}', 'reservations_nets', 'update')`)).ok === false, "ni en écrire à la main");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
