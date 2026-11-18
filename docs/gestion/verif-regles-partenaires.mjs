// Vérifie la migration 43 (règles des partenaires) sur un Postgres en mémoire : les partenaires de Zwald reçoivent exactement les règles
// d'avant (écrites jusque-là dans le code d'après leur nom), les autres organisations n'en reçoivent aucune, la migration se rejoue.
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-regles-partenaires.mjs . && GESTION_SQL=<repo>/docs/gestion/ node verif-regles-partenaires.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
let echecs = 0;
const ok = (c, msg) => { if (!c) { echecs++; console.log("  ECHEC:", msg); } else console.log("  ok:", msg); };
const harnais = `
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now(), raw_user_meta_data jsonb, raw_app_meta_data jsonb);
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
const db = new PGlite();
await db.exec(harnais);
await db.exec(fs.readFileSync(W + "schema.sql", "utf8").replace("create extension if not exists pgcrypto;", ""));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[789]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
const M43 = "migration-43-regles-partenaires.sql";
ok(migrations.includes(M43), "la migration 43 existe");
for (const f of migrations.filter((f) => parseInt(f.split("-")[1]) < 43)) await db.exec(fs.readFileSync(W + f, "utf8"));

const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const ZWALD = "00000000-0000-0000-0000-00000000a000";
const ent = async (slug) => (await un("select id from entites where organisation_id = $1 and slug = $2", [ZWALD, slug])).id;
const ztp = await ent("ztp");
const secret = await ent("secret");
const taxi = await ent("taxi");
// Une autre organisation, avec des partenaires aux mêmes noms : aucune règle ne doit lui arriver.
const autreOrg = (await un("insert into organisations (nom) values ('Autre agence') returning id")).id;
const autre = (await un("insert into entites (nom, slug, organisation_id) values ('Autre', 'autre', $1) returning id", [autreOrg])).id;
// Réglages existants des entreprises de Zwald (une avec une destination déjà réglée à la main : elle ne change pas).
for (const e of [ztp, secret]) await db.query("insert into reglages (entite_id, valeur) values ($1, $2) on conflict (entite_id) do update set valeur = excluded.valeur", [e, { devise: "THB" }]);
await db.query("insert into reglages (entite_id, valeur) values ($1, $2) on conflict (entite_id) do update set valeur = excluded.valeur", [taxi, { devise: "THB", destinations_passeport: [] }]);
await db.query("insert into reglages (entite_id, valeur) values ($1, $2)", [autre, { devise: "EUR" }]);

const part = async (entite, nom, regles = {}) => (await un("insert into partenaires (entite_id, nom, regles) values ($1, $2, $3) returning id", [entite, nom, regles])).id;
const bundhaya = await part(secret, "Bundhaya Speed Boat", { points_embarquement: [{ lieu: "Koh Lanta", ou: "Saladan Pier" }] });
const satun = await part(secret, "Satun Pakbara Speed Boat Club");
const satunFiche = await part(ztp, "Satun Pakbara (fiche écrite)", { checkin_voucher: "Check-in 1 hour before." });
const nan = await part(secret, "Mr. Nan Taxi");
const vip = await part(taxi, "VIP Taxi Lanta");
const rattana = await part(secret, "Rattana Tour");
const bundhayaAutre = await part(autre, "Bundhaya Speed Boat");
const taxiAutre = await part(autre, "City Taxi");
const pres = (entite, partenaire, groupe, libelle) => db.query("insert into prestations (entite_id, partenaire_id, famille, groupe, libelle, prix_vente, unite) values ($1, $2, 'transfert', $3, $4, 100, 'pp')", [entite, partenaire, groupe, libelle]);
await pres(secret, nan, "Taxis de Saladan", "Klong Nin");
await pres(secret, nan, "Saladan taxis", "Phra Ae");
await pres(secret, rattana, "Private minivan", "Koh Lanta → Krabi Airport");
await pres(autre, taxiAutre, "Saladan taxis", "Centre");

const histAvant = (await un("select count(*)::int n from reglages_historique")).n;
console.log("== Migration 43 ==");
await db.exec(fs.readFileSync(W + M43, "utf8"));
ok(true, "la migration 43 passe");
const p = async (id) => un("select nom, payer_avant_veille, payer_avant_veille_sauf, checkin_passeport, tarif_zone, taxi_defaut, regles->>'checkin_voucher' as checkin from partenaires where id = $1", [id]);

console.log("== Partenaires de Zwald : les règles d'avant ==");
const b = await p(bundhaya);
ok(b.payer_avant_veille && b.payer_avant_veille_sauf === "Lanta", "Bundhaya : à payer avant la veille, sauf départ de Lanta");
ok(/^Check-in 90 minutes before departure, counter closes 45 minutes before\. Passport of each passenger required \(immigration\), kept by the captain during the crossing\.$/.test(b.checkin_passeport), "Bundhaya : consigne passeport d'avant, mot pour mot");
ok(b.checkin === "Check-in at the pier 45 minutes before departure, counter closes 15 minutes before. Please bring this voucher and your passport or ID.", "Bundhaya : consigne du billet d'avant, mot pour mot");
ok(!b.tarif_zone && !b.taxi_defaut, "Bundhaya : ni tarifs par zone ni taxi par défaut");
const s = await p(satun);
ok(s.checkin === "Please present this voucher at the counter 30 minutes before departure, counter closes 20 minutes before. Passport or ID required.", "Satun : consigne du billet d'avant, mot pour mot");
ok(!s.payer_avant_veille && s.checkin_passeport === "", "Satun : ni avance ni consigne passeport propre (la consigne générale de l'immigration)");
ok((await p(satunFiche)).checkin === "Check-in 1 hour before.", "une consigne déjà écrite sur la fiche reste telle quelle");
const n = await p(nan);
ok(n.tarif_zone && n.taxi_defaut, "Mr. Nan Taxi : tarifs par zone (groupe Saladan) et nom « taxi »");
ok(!n.payer_avant_veille, "Mr. Nan Taxi : pas d'avance");
ok((await p(vip)).taxi_defaut && !(await p(vip)).tarif_zone, "VIP Taxi Lanta : taxi par défaut");
const r = await p(rattana);
ok(!r.payer_avant_veille && !r.tarif_zone && !r.taxi_defaut && r.checkin_passeport === "" && r.checkin === null, "Rattana : aucune règle");

console.log("== Destination à passeport ==");
const dest = async (e) => (await un("select valeur->'destinations_passeport' d from reglages where entite_id = $1", [e])).d;
const attendu = [{ lieux: ["Langkawi", "Malaysia", "Malaisie"], note_en: "Travelling to or from Langkawi (Malaysia): please bring your passport, valid for at least six months.", note_fr: "Trajet vers ou depuis Langkawi (Malaisie) : prévoyez votre passeport, valable au moins six mois." }];
ok(JSON.stringify(await dest(ztp)) === JSON.stringify(attendu) && JSON.stringify(await dest(secret)) === JSON.stringify(attendu), "ZTP et Secret : Langkawi, Malaysia, Malaisie avec les deux notes d'avant");
ok(JSON.stringify(await dest(taxi)) === "[]", "une destination déjà réglée n'est pas écrasée");
ok((await un("select valeur->>'devise' d from reglages where entite_id = $1", [ztp])).d === "THB", "les autres réglages ne bougent pas");
ok((await un("select count(*)::int n from reglages_historique")).n === histAvant, "l'ajout ne laisse aucune version dans l'historique des réglages");
await db.query("update reglages set valeur = valeur || '{\"devise\": \"EUR\"}' where entite_id = $1", [ztp]);
ok((await un("select count(*)::int n from reglages_historique")).n === histAvant + 1, "l'historique des réglages remarche après la migration");

console.log("== Autres organisations ==");
const ba = await p(bundhayaAutre);
ok(!ba.payer_avant_veille && ba.checkin_passeport === "" && ba.checkin === null, "un « Bundhaya » d'une autre organisation n'a aucune règle");
const ta = await p(taxiAutre);
ok(!ta.taxi_defaut && !ta.tarif_zone, "un « taxi » d'une autre organisation n'est ni taxi par défaut ni à tarifs par zone");
ok((await dest(autre)) === null, "une autre organisation n'a pas de destination à passeport");
const nouveau = await p(await part(autre, "Nouveau partenaire"));
ok(!nouveau.payer_avant_veille && nouveau.payer_avant_veille_sauf === "" && nouveau.checkin_passeport === "" && !nouveau.tarif_zone && !nouveau.taxi_defaut, "un nouveau partenaire commence sans règle");

console.log("== Rejeu et limites ==");
await db.exec(fs.readFileSync(W + M43, "utf8"));
ok(JSON.stringify(await p(bundhaya)) === JSON.stringify(b), "la migration se rejoue sans rien changer");
let refus = false;
try { await db.query("update partenaires set checkin_passeport = $1 where id = $2", ["x".repeat(1001), rattana]); } catch { refus = true; }
ok(refus, "une consigne passeport de plus de 1000 caractères est refusée");

console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
