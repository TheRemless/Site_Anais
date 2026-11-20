// Vérifie la migration 57 (encaisser les commissions dossier par dossier) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// Moyen, versement partiel, motif et note d'écart vivent dans reservations_nets : mêmes droits que les nets, même journal, même corbeille.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-encaisser-commissions.mjs
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
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
for (const f of migrations) await db.exec(lire(f));
ok(migrations.at(-1) === "migration-57-encaisser-commissions.sql" || migrations.includes("migration-57-encaisser-commissions.sql"), "la migration 57 passe après les autres");
await db.exec(lire("migration-57-encaisser-commissions.sql"));
ok(true, "la migration 57 se rejoue sans erreur (idempotente)");

async function essaie(userId, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
}

const ent = {};
for (const s of ["ztp", "secret", "taxi"]) ent[s] = (await db.query("select id from entites where slug = $1", [s])).rows[0]?.id;
const E = ent.secret;
const u = {};
for (const k of ["admin", "sansnets", "ztp"]) u[k] = (await db.query("insert into auth.users (email) values ($1) returning id", [k + "@test"])).rows[0].id;
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${E}', 'Dossiers sans nets', 'toute', array['dossiers.lire', 'dossiers.ecrire', 'finances.voir'])`);
const membre = (user, entite, role) => db.exec(`insert into membres values ('${u[user]}', '${entite}', (select id from roles where entite_id = '${entite}' and nom = '${role}')) on conflict do nothing`);
await membre("admin", E, "Administrateur");
await membre("sansnets", E, "Dossiers sans nets");
if (ent.ztp) await membre("ztp", ent.ztp, "Administrateur");

const C = (await db.query("insert into clients (entite_id, prenom, nom) values ($1, 'A', 'B') returning id", [E])).rows[0].id;
const D = (await db.query("insert into dossiers (entite_id, ref, client_id) values ($1, 'S-57', $2) returning id", [E, C])).rows[0].id;
const R = (await db.query("insert into reservations (entite_id, dossier_id, libelle, date_service, montant_vente, paye_sur_place) values ($1, $2, '4 îles', '2026-11-10', 2400, true) returning id", [E, D])).rows[0].id;
await db.query("insert into reservations_nets (entite_id, reservation_id, commission_prevue) values ($1, $2, 500) on conflict (reservation_id) do update set commission_prevue = 500", [E, R]);

// Un versement partiel : le reste reste à recevoir, la date du versement est gardée à part.
let r = await essaie(u.admin, `update reservations_nets set commission_recue = 300, commission_partielle_le = '2026-11-15', commission_recue_moyen = 'especes' where reservation_id = '${R}'`);
ok(r.ok && r.n === 1, "l'administratrice note un versement partiel avec son moyen");
const partiel = (await db.query("select commission_recue::float8 recue, commission_recue_le, commission_partielle_le::text le, commission_recue_moyen from reservations_nets where reservation_id = $1", [R])).rows[0];
ok(partiel.recue === 300 && partiel.commission_recue_le === null && partiel.le === "2026-11-15" && partiel.commission_recue_moyen === "especes", "le versement partiel ne règle pas la commission");

// Soldé avec un écart : motif contrôlé, note bornée.
r = await essaie(u.admin, `update reservations_nets set commission_recue = 450, commission_recue_le = '2026-11-20', commission_ecart_motif = 'rabais', commission_ecart_note = 'remise de 10 %' where reservation_id = '${R}'`);
ok(r.ok, "le dossier se solde avec le motif « rabais »");
r = await essaie(u.admin, `update reservations_nets set commission_ecart_motif = 'n_importe' where reservation_id = '${R}'`);
ok(!r.ok, "un motif inconnu est refusé par la base");
r = await essaie(u.admin, `update reservations_nets set commission_ecart_note = repeat('x', 301) where reservation_id = '${R}'`);
ok(!r.ok, "une note de plus de 300 caractères est refusée");

// Les nouvelles colonnes suivent les droits des nets : sans « partenaires.nets », rien à lire ni à écrire ; une autre entreprise ne voit rien.
r = await essaie(u.sansnets, `select commission_ecart_motif from reservations_nets where reservation_id = '${R}'`);
ok(r.ok && r.rows.length === 0, "sans le droit nets, la ligne (motif, moyen, versements) reste invisible");
r = await essaie(u.sansnets, `update reservations_nets set commission_recue_moyen = 'virement' where reservation_id = '${R}'`);
ok(!r.ok || r.n === 0, "sans le droit nets, impossible d'encaisser");
if (ent.ztp) {
  r = await essaie(u.ztp, `select 1 from reservations_nets where reservation_id = '${R}'`);
  ok(r.ok && r.rows.length === 0, "l'administratrice de ZTP ne voit pas les commissions de Secret");
}

// Le journal des nets (migration 37) note les nouvelles colonnes.
const j = (await db.query("select details from journal where table_name = 'reservations_nets' and cible = $1 order by id", [R])).rows.map((x) => x.details);
ok(j.some((d) => d.commission_partielle_le && d.commission_recue_moyen), "le journal garde le versement partiel et son moyen");
ok(j.some((d) => d.commission_ecart_motif?.apres === "rabais" && d.commission_ecart_note?.apres === "remise de 10 %"), "le journal garde le motif et la note");

// La corbeille : supprimer le dossier puis le restaurer rend le motif et le moyen.
const avant = (await db.query("select commission_ecart_motif, commission_recue_moyen from reservations_nets where reservation_id = $1", [R])).rows[0];
r = await essaie(u.admin, `delete from dossiers where id = '${D}'`);
const corb = (await db.query("select id from corbeille where ligne->>'id' = $1", [D])).rows[0];
ok(r.ok && !!corb, "le dossier supprimé part dans la corbeille avec ses nets");
const rest = corb ? await essaie(u.admin, `select restaurer_dossier('${corb.id}')`) : { ok: false };
const apres = (await db.query("select commission_ecart_motif, commission_recue_moyen from reservations_nets where reservation_id = $1", [R])).rows[0];
ok(rest.ok && apres && apres.commission_ecart_motif === "rabais" && apres.commission_ecart_motif === avant.commission_ecart_motif && apres.commission_recue_moyen === avant.commission_recue_moyen, "la corbeille rend le motif et le moyen avec le dossier" + (rest.ok ? "" : ` (${rest.err})`));

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
