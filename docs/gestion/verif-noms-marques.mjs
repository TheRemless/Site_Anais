// Vérifie la migration 44 (noms et marques à l'écran) sur un Postgres en mémoire : les entreprises d'Anaïs reçoivent ses valeurs
// d'aujourd'hui (rien ne change pour elle), une valeur déjà enregistrée est gardée, une autre organisation n'est pas touchée,
// et la migration se rejoue sans rien écrire.
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-noms-marques.mjs . && GESTION_SQL=<repo>/docs/gestion/ node verif-noms-marques.mjs
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
const num = (f) => parseInt(f.split("-")[1]);
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[789]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => num(a) - num(b));
for (const f of migrations.filter((f) => num(f) < 44)) await db.exec(fs.readFileSync(W + f, "utf8"));

const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const ZWALD = "00000000-0000-0000-0000-00000000a000";
const id = async (slug) => (await un("select id from entites where organisation_id = $1 and slug = $2", [ZWALD, slug])).id;
const [ztp, secret, taxi] = [await id("ztp").catch(() => null), await id("secret"), await id("taxi")];
const ztpId = ztp || (await un("select id from entites where organisation_id = $1 and slug not in ('secret', 'taxi')", [ZWALD])).id;

// Les comptes d'Anaïs et de Jérémy (Jérémy arrive le premier : la migration choisit Anaïs par son nom, pas le plus ancien).
const compte = async (email, nom, superAdmin, jours) => {
  const u = (await un("insert into auth.users (email, created_at) values ($1, now() - ($2 || ' days')::interval) returning id", [email, String(jours)])).id;
  await db.query("insert into profils (user_id, email, nom, super_admin, organisation_id, created_at) values ($1, $2, $3, $4, $5, now() - ($6 || ' days')::interval) on conflict (user_id) do update set nom = excluded.nom, super_admin = excluded.super_admin, organisation_id = excluded.organisation_id", [u, email, nom, superAdmin, ZWALD, String(jours)]);
  return u;
};
await compte("jeremy@exemple.test", "Jérémy", true, 400);
const anais = await compte("anais@exemple.test", "Anaïs Zwald", true, 300);

// Réglages d'avant comme en production : Taxi (donnees-taxi.sql) et Secret avec un texte de voucher déjà changé.
await db.query("update reglages set valeur = $2 where entite_id = $1", [taxi, { fonctionnement: "taxi", emetteur: { nom: "VIP Taxi Lanta", licence: "" }, voucher: { nom: "VIP Taxi Lanta", adresse: "Koh Lanta, Krabi, Thailand", textes: { b_intro: "Texte d'Anaïs" } } }]);
await db.query("update reglages set valeur = valeur || $2 where entite_id = $1", [secret, { fonctionnement: "excursions", voucher: { nom: "Secret Travel & Tour", textes: { b_intro: "Intro de Secret" } } }]);

// Une autre organisation, déjà cliente : elle ne doit pas bouger.
const autreOrg = (await un("insert into organisations (nom) values ('Agence Test') returning id")).id;
const autre = (await un("insert into entites (slug, nom, organisation_id) values ('test', 'Agence Test', $1) returning id", [autreOrg])).id;
await db.query("insert into reglages (entite_id, valeur) values ($1, $2)", [autre, { fonctionnement: "taxi", emetteur: { nom: "Agence Test" } }]);
const avantAutre = (await un("select valeur from reglages where entite_id = $1", [autre])).valeur;

console.log("== Migration 44 ==");
await db.exec(fs.readFileSync(W + "migration-44-noms-marques.sql", "utf8"));
const r = async (e) => (await un("select valeur from reglages where entite_id = $1", [e])).valeur;
const [vZ, vS, vT] = [await r(ztpId), await r(secret), await r(taxi)];

ok((await un("select libelle_admin from organisations where id = $1", [ZWALD])).libelle_admin === "Administratrice générale", "Zwald : « Administratrice générale »");
ok((await un("select libelle_admin from organisations where id = $1", [autreOrg])).libelle_admin === null, "autre organisation : libellé neutre (null)");
for (const [nom, v] of [["ZTP", vZ], ["Secret", vS], ["Taxi", vT]]) {
  ok(v.responsable && v.responsable.prenom === "Anaïs" && v.responsable.prenom_th === "อานาอิส" && v.responsable.user_id === anais, `${nom} : personne responsable Anaïs (son compte, pas le plus ancien)`);
  ok(v.emetteur.licence_libelle === "Licence TAT" && v.emetteur.licence_libelle_en === "TAT licence", `${nom} : libellé de licence « Licence TAT » / « TAT licence »`);
  ok(v.assistant_voix && v.assistant_voix.lieu === "Koh Lanta (Thaïlande)", `${nom} : lieu de l'assistant`);
}
ok(vZ.emetteur.nom === "Zwald Travel Planner Co., Ltd.", "ZTP : le reste de l'émetteur est gardé");
ok(!vZ.voucher || !vZ.voucher.textes || !vZ.voucher.textes.b_merci, "ZTP (voyages sur mesure) : aucun texte de voucher ajouté");
ok(vT.voucher.textes.b_merci === "Thank you for choosing VIP TAXI LANTA – we look forward to driving you safely and comfortably to your destination! 🚐✨", "Taxi : remerciement d'avant, mot pour mot");
ok(vT.voucher.textes.b_signature === "VIP TAXI LANTA Team" && vT.voucher.textes.b_lieu === "Koh Lanta, Krabi, Thailand" && vT.voucher.textes.licence === "TAT licence", "Taxi : signature, lieu et licence d'avant");
ok(vT.voucher.textes.b_intro === "Texte d'Anaïs" && vT.voucher.nom === "VIP Taxi Lanta" && vT.voucher.adresse === "Koh Lanta, Krabi, Thailand", "Taxi : les textes et le bloc voucher déjà enregistrés sont gardés");
ok(vS.voucher.textes.b_intro === "Intro de Secret" && vS.voucher.textes.licence === "TAT licence", "Secret : un texte déjà changé est gardé, l'intitulé de licence d'avant est ajouté");
ok(vS.voucher.nom === "Secret Travel & Tour", "Secret : nom du voucher gardé");
ok(/^Tu écris pour \{entreprise\}, un service de taxi privé à Koh Lanta/.test(vT.assistant_voix.fr) && /"Have a nice day, \{entreprise\}"\.$/.test(vT.assistant_voix.en), "Taxi : voix signée du nom de l'entreprise");
ok(/^Tu écris comme Anaïs/.test(vS.assistant_voix.fr) && /"Have a lovely day, Anaïs"\.$/.test(vS.assistant_voix.en), "Secret : voix d'Anaïs");
ok(vS.assistant_voix.fr.split("\n").length === 5, "la voix garde ses retours à la ligne");
ok(JSON.stringify(await r(autre)) === JSON.stringify(avantAutre), "autre organisation : réglages inchangés");

// Les valeurs remplies, écrites pour le test JS (tests/fixtures/noms-marques-reglages.json) : même source que la base.
const ajoute = (v) => ({ responsable: { ...v.responsable, user_id: "" }, emetteur: { licence_libelle: v.emetteur.licence_libelle, licence_libelle_en: v.emetteur.licence_libelle_en }, ...(v.voucher && v.voucher.textes ? { voucher: { textes: Object.fromEntries(["licence", "b_merci", "b_signature", "b_lieu"].map((k) => [k, v.voucher.textes[k]])) } } : {}), assistant_voix: v.assistant_voix });
if (process.env.ECRIRE_FIXTURE) fs.writeFileSync(process.env.ECRIRE_FIXTURE, JSON.stringify({ ztp: ajoute(vZ), secret: ajoute(vS), taxi: ajoute(vT) }, null, 1));

console.log("== Deuxième passage ==");
const versions = async () => (await un("select count(*)::int n from reglages_historique")).n;
const majs = async () => (await un("select string_agg(updated_at::text, ',' order by entite_id) s from reglages")).s;
const [v1, m1] = [await versions(), await majs()];
await db.exec(fs.readFileSync(W + "migration-44-noms-marques.sql", "utf8"));
ok((await versions()) === v1 && (await majs()) === m1, "rejouée : aucune ligne réécrite, aucun historique en plus");

console.log(echecs ? `${echecs} échec(s)` : "Tout est bon.");
process.exit(echecs ? 1 : 0);
