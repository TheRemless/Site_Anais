// Vérifie la migration 128 (frais de parc : un libellé qui EST un frais) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// La même liste de cas que tests/gestion-notifications-partenaire.test.js (outil et fonction rappels). Puis : rejeu, retour en arrière, rejeu.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-frais-parc.mjs
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
const MIG = "migration-128-frais-parc-libelle.sql";
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d|1\d\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
ok(migrations.includes(MIG) && migrations.indexOf(MIG) > migrations.indexOf("migration-125-notifications-partenaire-mineurs.sql"), "la migration 128 passe après la 125");
for (const f of migrations) await db.exec(lire(f));
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];

const OUI = ["Koh Rok and Koh Ha, park fees", "Koh Rok park fee", "Koh Rok et Koh Ha, frais de parc", "Frais d'entrée du parc", "Frais d’entrée du parc national", "Park entrance fee", "National park fees: 4 Islands", "Entrance fee Koh Phi Phi", "Droits d'entrée Maya Bay", "Droit du parc national"];
const NON = ["Private taxi: Hotel Test → Mu Ko Lanta National Park", "Ko Lanta National Park", "National park tour", "Fill-Feel @ Long Beach Resort → Nang Thong Bay Resort", "4 Islands", "Mangrove tour + fishing park", "Private taxi: Hotel → Tiger Cave Temple (entrance fee not included)", "Private taxi: Hotel → Emerald Pool (park fees paid on site)", "Temple tour incl. entrance fee", "Private taxi with entrance fees", "Tiger Cave tour + entrance fee", "Transfer -> National park fees office"];
const est = async (l) => (await un("select frais_de_parc_libelle($1) as f", [l])).f;
const fautesOui = [];
for (const l of OUI) if ((await est(l)) !== true) fautesOui.push(l);
ok(!fautesOui.length, `les ${OUI.length} frais sont reconnus${fautesOui.length ? " (manquent : " + fautesOui.join(" ; ") + ")" : ""}`);
const fautesNon = [];
for (const l of NON) if ((await est(l)) !== false) fautesNon.push(l);
ok(!fautesNon.length, `les ${NON.length} courses qui parlent d'un frais restent des courses${fautesNon.length ? " (prises : " + fautesNon.join(" ; ") + ")" : ""}`);
ok((await est(null)) === false && (await est("")) === false, "un libellé vide n'est pas un frais");
const corps = (await un("select prosrc from pg_proc where proname = 'partenaire_notif_courses'")).prosrc;
ok(/frais_de_parc_libelle\(r\.libelle\)/.test(corps) && /coalesce\(p\.famille, ''\) <> 'frais'/.test(corps), "partenaire_notif_courses utilise la règle et garde la famille « frais »");

await db.exec(lire(MIG));
ok((await est("Koh Rok park fee")) === true, "la migration 128 se rejoue sans effet");
await db.exec(lire("retour-128-frais-parc-libelle.sql"));
ok(!(await un("select count(*)::int n from pg_proc where proname = 'frais_de_parc_libelle'")).n && /~\*/.test((await un("select prosrc from pg_proc where proname = 'partenaire_notif_courses'")).prosrc), "retour : la fonction de la 125 revient, l'aide est retirée");
await db.exec(lire(MIG));
ok((await est("Private taxi: Hotel → Tiger Cave Temple (entrance fee not included)")) === false, "et la 128 se repose après le retour");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
