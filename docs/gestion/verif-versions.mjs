// Vérifie la migration 24 (versions des dossiers et des paiements) sur un Postgres en mémoire, avec l'enchaînement schema.sql puis migrations 18 à 24.
//   (même mise en place que verif-securite.mjs : GESTION_SQL=<repo>/docs/gestion/ node verif-versions.mjs)
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
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
const lire = (f) => fs.readFileSync(f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire(W + "schema.sql"));
for (const f of ["migration-18-sur-place.sql", "migration-19-paiements.sql", "migration-20-statistiques.sql", "migration-21-analyses-portee.sql", "migration-22-restauration.sql", "migration-23-suivi-rappels.sql"]) await db.exec(lire(W + f));

const E = (await db.query("select id from entites where slug = 'ztp'")).rows[0].id;
const C = (await db.query("insert into clients (entite_id, prenom, nom) values ($1, 'A', 'B') returning id", [E])).rows[0].id;
const D = (await db.query("insert into dossiers (entite_id, ref, client_id) values ($1, 'T-1', $2) returning id", [E, C])).rows[0].id;
const P = (await db.query("insert into paiements (entite_id, dossier_id, date, montant, moyen) values ($1, $2, '2026-11-01', 100, 'virement') returning id", [E, D])).rows[0].id;
const col = async (t) => (await db.query("select count(*)::int n from information_schema.columns where table_name = $1 and column_name = 'updated_at'", [t])).rows[0].n;
ok((await col("dossiers")) === 0 && (await col("paiements")) === 0, "avant la migration, dossiers et paiements n'ont pas de version");

await db.exec(lire(W + "migration-24-versions.sql"));
ok((await col("dossiers")) === 1 && (await col("paiements")) === 1, "la migration 24 ajoute la colonne updated_at aux deux tables");
await db.exec(lire(W + "migration-24-versions.sql"));
ok(true, "elle se rejoue sans erreur (idempotente)");

const v = async (t, id) => (await db.query(`select updated_at::text u from ${t} where id = $1`, [id])).rows[0].u;
const v0 = await v("dossiers", D);
await db.exec(`update dossiers set notes = 'a' where id = '${D}'`);
const v1 = await v("dossiers", D);
ok(v1 !== v0, "modifier une fiche dossier renouvelle sa version");

// Le recalcul automatique du résumé (enregistrement d'un devis ou d'un paiement) n'est pas une modification de la fiche.
await db.exec(`insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ('${E}', '${D}', 'devis', '2026-11-02', '{"devise":"CHF","lignes":[{"id":"l1","kind":"ligne","libelle":"x","unite":100,"qte":1}]}')`);
await db.exec(`update documents set envoye_le = '2026-11-03' where dossier_id = '${D}'`);
await db.exec(`insert into paiements (entite_id, dossier_id, date, montant) values ('${E}', '${D}', '2026-11-04', 10)`);
const vd = (await db.query("select devis_envoye_le::text d from dossiers where id = $1", [D])).rows[0].d;
ok(vd === "2026-11-03", "le résumé du dossier a bien été recalculé par la base");
ok((await v("dossiers", D)) === v1, "ce recalcul ne change pas la version de la fiche dossier");

const p0 = await v("paiements", P);
await db.exec(`update paiements set note = 'corrigé' where id = '${P}'`);
ok((await v("paiements", P)) !== p0, "corriger un paiement renouvelle sa version");

// Écriture avec contrôle de version, comme le fait l'outil : refusée quand la ligne a changé depuis la lecture.
const lue = await v("dossiers", D);
await db.exec(`update dossiers set notes = 'autre personne' where id = '${D}'`);
const refus = await db.query(`update dossiers set notes = 'moi' where id = '${D}' and updated_at = '${lue}' returning id`);
ok(refus.rows.length === 0, "une écriture avec l'ancienne version ne passe pas");
const lue2 = await v("dossiers", D);
const passe = await db.query(`update dossiers set notes = 'moi' where id = '${D}' and updated_at = '${lue2}' returning id`);
ok(passe.rows.length === 1, "avec la version à jour, elle passe");
const lueP = await v("paiements", P);
await db.exec(`update paiements set montant = 120 where id = '${P}'`);
ok((await db.query(`update paiements set montant = 130 where id = '${P}' and updated_at = '${lueP}' returning id`)).rows.length === 0, "même contrôle sur un paiement");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
