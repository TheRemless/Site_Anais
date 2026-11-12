// Vérifie sur un Postgres en mémoire que : (1) une sauvegarde complète se réimporte sans refus de la base (aucune colonne que la table n'a pas),
// (2) la corbeille restaure un dossier même si une colonne NOT NULL a été ajoutée depuis, (3) un client qui a un dossier dans la corbeille ne se supprime pas.
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-sauvegarde.mjs . && GESTION_SQL=<repo>/docs/gestion/ GESTION_SRC=file://<repo>/src/gestion/js/ node verif-sauvegarde.mjs
//   (GESTION_MAX=21 pour rejouer sans la migration 22 : les contrôles 2 et 3 doivent alors échouer)
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
const SRC = process.env.GESTION_SRC || "../src/gestion/js/";
const MAX = Number(process.env.GESTION_MAX || 999);
const { pourSauvegarde } = await import(new URL(SRC + "sauvegarde.mjs", import.meta.url));
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
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema public, auth to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
async function base() {
  const db = new PGlite();
  await db.exec(harnais);
  await db.exec(fs.readFileSync(W + "schema.sql", "utf8").replace("create extension if not exists pgcrypto;", ""));
  const migs = fs.readdirSync(W).filter((n) => /^migration-(1[89]|2\d)-.*\.sql$/.test(n) && parseInt(n.split("-")[1]) <= MAX).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
  for (const f of migs) await db.exec(fs.readFileSync(W + f, "utf8"));
  return db;
}
// Même ordre que les clés étrangères (store-supabase.mjs : TABLES).
const TABLES = ["clients", "dossiers", "documents", "paiements", "catalogue", "partenaires", "partenaires_prives", "prestations", "prestations_nets", "trajets", "trajets_nets", "reservations", "reservations_nets", "taches"];

const A = await base();
const E = (await A.query("select id from entites where slug = 'ztp'")).rows[0].id;
const admin = (await A.query("insert into auth.users (email) values ('admin@test') returning id")).rows[0].id; // premier compte = administratrice générale
await A.exec(`select set_config('request.jwt.claim.sub', '${admin}', false)`);
const U = (s) => s.replaceAll("{E}", E);
await A.exec(U(`
insert into clients (id, entite_id, nom) values ('00000000-0000-4000-8000-0000000000c1', '{E}', 'Client Un'), ('00000000-0000-4000-8000-0000000000c2', '{E}', 'Client Deux');
insert into dossiers (id, entite_id, ref, client_id) values ('00000000-0000-4000-8000-0000000000d1', '{E}', 'D1', '00000000-0000-4000-8000-0000000000c1'), ('00000000-0000-4000-8000-0000000000d2', '{E}', 'D2', '00000000-0000-4000-8000-0000000000c2');
insert into documents (id, entite_id, dossier_id, type, date_emission, contenu) values ('00000000-0000-4000-8000-0000000000a1', '{E}', '00000000-0000-4000-8000-0000000000d1', 'facture', '2026-10-01', '{"lignes":[{"id":"l1","unite":1000,"qte":1},{"id":"l2","unite":900,"qte":1,"paye_sur_place":true}]}');
insert into paiements (entite_id, dossier_id, date, montant) values ('{E}', '00000000-0000-4000-8000-0000000000d1', '2026-10-02', 100);
insert into partenaires (id, entite_id, nom) values ('00000000-0000-4000-8000-0000000000b1', '{E}', 'Partenaire');
insert into partenaires_prives (entite_id, partenaire_id) values ('{E}', '00000000-0000-4000-8000-0000000000b1');
insert into prestations (id, entite_id, partenaire_id, famille, libelle) values ('00000000-0000-4000-8000-0000000000e1', '{E}', '00000000-0000-4000-8000-0000000000b1', 'excursion', 'Excursion');
insert into prestations_nets (entite_id, prestation_id, net) values ('{E}', '00000000-0000-4000-8000-0000000000e1', 400);
insert into reservations (id, entite_id, dossier_id, partenaire_id, prestation_id, libelle, paye_sur_place) values ('00000000-0000-4000-8000-0000000000f1', '{E}', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1', 'Excursion', true);
insert into reservations_nets (entite_id, reservation_id, net_prevu, commission_prevue) values ('{E}', '00000000-0000-4000-8000-0000000000f1', 700, 200);
insert into taches (entite_id, titre, fait, fait_le) values ('{E}', 'Ancienne tâche terminée', true, now() - interval '200 days'), ('{E}', 'À faire', false, null);
`));

console.log("1. Sauvegarde puis import");
// Ce que l'outil met en mémoire : les dossiers portent le résumé de la base (comme store-supabase.fusion).
const lignes = {};
for (const t of TABLES) lignes[t] = (await A.query(`select to_jsonb(x) j from ${t} x where entite_id = '${E}'`)).rows.map((r) => r.j);
const resumes = new Map((await A.query("select * from dossiers_resume")).rows.map((r) => [r.dossier_id, r]));
lignes.dossiers = lignes.dossiers.map((d) => { const r = resumes.get(d.id); return r ? { ...d, total: Number(r.total), devise: r.devise, recu: Number(r.recu), sur_place: Number(r.sur_place) || 0 } : d; });
const fichier = Object.fromEntries(TABLES.map((t) => [t, pourSauvegarde(t, lignes[t])]));
ok(lignes.dossiers.some((d) => d.sur_place > 0), "(contexte) le dossier D1 porte un montant sur place en mémoire");
ok(fichier.taches.length === 2, "toutes les tâches sont dans le fichier, la terminée depuis 200 jours aussi");

const B = await base();
// L'entreprise cible a ses comptes (profils) : les dossiers pointent vers leur responsable.
await B.query("insert into auth.users (id, email) values ($1, 'admin@test')", [admin]);
let refus = null;
const colonnes = {};
for (const t of TABLES) colonnes[t] = new Set((await B.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [t])).rows.map((r) => r.column_name));
for (const t of TABLES) {
  for (const row of fichier[t]) {
    const inconnues = Object.keys(row).filter((k) => !colonnes[t].has(k));
    if (inconnues.length) { refus = refus || `${t} : colonne inconnue ${inconnues.join(", ")} (PostgREST refuserait l'import)`; continue; }
    await B.query(`insert into ${t} select * from jsonb_populate_record(null::${t}, $1::jsonb) on conflict do nothing`, [JSON.stringify(row)]);
  }
}
ok(refus === null, refus || "aucune colonne inconnue dans le fichier : la base accepte chaque table");
for (const t of ["clients", "dossiers", "documents", "paiements", "reservations", "reservations_nets", "taches"]) {
  const n = (await B.query(`select count(*)::int n from ${t}`)).rows[0].n;
  ok(n === fichier[t].length, `${t} : ${n} ligne(s) restaurée(s) sur ${fichier[t].length}`);
}
ok(Number((await B.query("select sur_place from dossiers_resume where dossier_id = '00000000-0000-4000-8000-0000000000d1'")).rows[0]?.sur_place) === 900, "le résumé du dossier est recalculé par la base à l'import (sur place 900)");

console.log("2. Restauration depuis la corbeille après l'ajout d'une colonne NOT NULL");
await A.exec("delete from dossiers where id = '00000000-0000-4000-8000-0000000000d1'");
ok((await A.query("select count(*)::int n from corbeille")).rows[0].n === 1, "le dossier D1 est en corbeille");
await A.exec("alter table reservations add column ajoutee_apres boolean not null default false");
await A.exec("alter table paiements add column note_apres text not null default ''");
const id = (await A.query("select id from corbeille limit 1")).rows[0].id;
let r;
try { r = await A.query("select restaurer_dossier($1) as d", [id]); } catch (e) { r = { err: e.message }; }
ok(!r.err && r.rows[0].d === "00000000-0000-4000-8000-0000000000d1", "restaurer_dossier réussit malgré les colonnes NOT NULL ajoutées depuis" + (r.err ? ` (${r.err})` : ""));
if (!r.err) {
  ok((await A.query("select count(*)::int n from reservations where dossier_id = '00000000-0000-4000-8000-0000000000d1' and ajoutee_apres = false")).rows[0].n === 1, "la réservation est revenue, la nouvelle colonne a sa valeur par défaut");
  ok((await A.query("select count(*)::int n from reservations_nets where reservation_id = '00000000-0000-4000-8000-0000000000f1'")).rows[0].n === 1, "ses nets sont revenus");
  ok((await A.query("select count(*)::int n from documents where dossier_id = '00000000-0000-4000-8000-0000000000d1'")).rows[0].n === 1, "le document est revenu");
}

console.log("3. Un client qui a un dossier dans la corbeille ne se supprime pas");
await A.exec("delete from dossiers where id = '00000000-0000-4000-8000-0000000000d2'");
let sup;
try { await A.exec("delete from clients where id = '00000000-0000-4000-8000-0000000000c2'"); sup = { ok: true }; } catch (e) { sup = { err: e.message }; }
ok(!!sup.err && /corbeille/.test(sup.err), "la suppression du client est refusée avec un message clair" + (sup.err ? "" : " (elle a réussi)"));
const id2 = (await A.query("select id from corbeille where ligne->>'ref' = 'D2'")).rows[0]?.id;
if (sup.ok && id2) {
  let r2; try { await A.query("select restaurer_dossier($1)", [id2]); r2 = {}; } catch (e) { r2 = { err: e.message }; }
  ok(!!r2.err && /client/.test(r2.err), "restaurer un dossier dont le client a disparu donne un message sur le client : " + (r2.err || "aucune erreur"));
}
console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTOUT EST BON");
process.exit(echecs ? 1 : 0);
