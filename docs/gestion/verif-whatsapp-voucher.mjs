// Vérifie la migration 73 (voucher envoyé en image depuis Gestion) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// Le bucket « whatsapp-sortant » est privé, limité à 5 Mo, sans aucune politique : ni Nani, ni Mook, ni anon n'y lisent, n'y écrivent ni
// n'y suppriment depuis l'outil ; une politique ajoutée par erreur est retirée au prochain passage ; la migration se rejoue ; retour en arrière.
// Et la base tient le verrou du voucher : la même clé (evenement_id) ne range qu'un message, retiré sur un refus sûr ou par « Pas parti ».
//   GESTION_SQL=<repo>/docs/gestion/ node verif-whatsapp-voucher.mjs
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
grant all on all tables in schema storage to authenticated, anon;
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
ok(migrations.includes("migration-73-whatsapp-voucher.sql"), "la migration 73 passe avec les autres, sur une base vide");

async function essaie(userId, sql, params = [], role = "authenticated") {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];

const ent = {};
for (const sl of ["ztp", "secret", "taxi"]) ent[sl] = (await un("select id from entites where slug = $1", [sl]))?.id;
const ORG = (await un("select organisation_id from entites where id = $1", [ent.secret])).organisation_id;
const u = {};
for (const k of ["nani", "mook", "ztp"]) u[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Mook test', 'toute', array['clients.lire', 'clients.ecrire', 'dossiers.lire', 'dossiers.ecrire', 'partenaires.lire'])`);
const membre = (user, entite, role) => db.exec(`insert into membres values ('${u[user]}', '${entite}', (select id from roles where entite_id = '${entite}' and nom = '${role}')) on conflict do nothing`);
await membre("nani", ent.secret, "Administrateur");
await membre("nani", ent.taxi, "Administrateur");
await membre("mook", ent.secret, "Mook test");
await membre("ztp", ent.ztp, "Administrateur");

// ---- Bucket ---------------------------------------------------------------------------------------------------------------------------
const bucket = () => un("select id, public, file_size_limit from storage.buckets where id = 'whatsapp-sortant'");
let b = await bucket();
ok(b && b.public === false, "le bucket whatsapp-sortant existe et il est privé");
ok(b && Number(b.file_size_limit) === 5242880, "5 Mo par fichier au plus (limite de Meta)");
const politiques = async () => (await db.query("select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') like '%whatsapp-sortant%' or coalesce(with_check, '') like '%whatsapp-sortant%')")).rows;
ok((await politiques()).length === 0, "aucune politique ne cite le bucket : rien depuis l'outil");

// ---- Personne n'y touche depuis l'outil ---------------------------------------------------------------------------------------------
for (const [qui, role] of [["nani", "authenticated"], ["mook", "authenticated"], ["ztp", "authenticated"], [null, "anon"]]) {
  const nom = qui || "anon";
  let r = await essaie(qui && u[qui], "insert into storage.objects (bucket_id, name) values ('whatsapp-sortant', $1)", [`${ORG}/1-x.png`], role);
  ok(!r.ok, `${nom} ne dépose pas de fichier dans whatsapp-sortant`);
}
// Un fichier déposé par la fonction (clé de service : ici le propriétaire, qui passe outre RLS comme service_role).
await db.query("insert into storage.objects (bucket_id, name) values ('whatsapp-sortant', $1)", [`${ORG}/1700000000000-a.png`]);
for (const [qui, role] of [["nani", "authenticated"], ["mook", "authenticated"], ["ztp", "authenticated"], [null, "anon"]]) {
  const nom = qui || "anon";
  let r = await essaie(qui && u[qui], "select name from storage.objects where bucket_id = 'whatsapp-sortant'", [], role);
  ok(r.ok && r.rows.length === 0, `${nom} ne lit pas le fichier temporaire`);
  r = await essaie(qui && u[qui], "delete from storage.objects where bucket_id = 'whatsapp-sortant'", [], role);
  ok(r.ok ? r.n === 0 : true, `${nom} ne supprime pas le fichier temporaire`);
  r = await essaie(qui && u[qui], "update storage.objects set name = 'x' where bucket_id = 'whatsapp-sortant'", [], role);
  ok(r.ok ? r.n === 0 : true, `${nom} ne renomme pas le fichier temporaire`);
}
ok((await un("select count(*)::int n from storage.objects where bucket_id = 'whatsapp-sortant'")).n === 1, "le fichier de la fonction est toujours là");

// ---- Se rejoue, et referme ce qui aurait été ouvert à la main ---------------------------------------------------------------------
await db.exec("create policy \"lecture voucher par erreur\" on storage.objects for select to anon, authenticated using (bucket_id = 'whatsapp-sortant')");
await db.exec("update storage.buckets set public = true, file_size_limit = 52428800 where id = 'whatsapp-sortant'");
ok((await essaie(u.mook, "select name from storage.objects where bucket_id = 'whatsapp-sortant'")).rows.length === 1, "(témoin) une politique ajoutée à la main ouvrirait la lecture");
await db.exec(lire("migration-73-whatsapp-voucher.sql"));
await db.exec(lire("migration-73-whatsapp-voucher.sql"));
b = await bucket();
ok(b.public === false && Number(b.file_size_limit) === 5242880, "la migration se rejoue : le bucket redevient privé, 5 Mo");
ok((await politiques()).length === 0, "la migration se rejoue : la politique ajoutée à la main est retirée");
ok((await essaie(u.mook, "select name from storage.objects where bucket_id = 'whatsapp-sortant'")).rows.length === 0, "… et Mook ne lit plus rien");
ok(!!(await un("select 1 x from pg_policies where schemaname = 'storage' and policyname = 'lire les médias WhatsApp'")), "les politiques des autres buckets restent (médias reçus)");

// ---- Le verrou du voucher tenu par la base -------------------------------------------------------------------------------------------
const tel = "+447700900311";
const entrant = await un("select whatsapp_ranger($1, $2, null, $3::jsonb) r", [ORG, tel, JSON.stringify({ evenement_id: "e1", telnyx_id: "tx-1", sens: "entrant", origine: "client", type: "text", texte: "Hi Nani", medias: [], envoye_le: new Date(Date.now() - 600000).toISOString() })]);
const conv = entrant.r.conversation_id;
const resa = "11111111-1111-4111-8111-111111111111";
const cle = `gestion-voucher:${resa}:${Math.floor(Date.now() / 120000)}`;
const voucher = (texte = "Your voucher") => un("select whatsapp_ranger($1, $2, null, $3::jsonb) r", [ORG, tel, JSON.stringify({ evenement_id: cle, sens: "sortant", origine: "gestion", type: "image", texte, medias: [{ type: "image", mime: "image/png", taille: 1000, nom: "Voucher.png", statut: "voucher", chemin_sortant: `${ORG}/1-a.png`, reservation_id: resa }], envoye_le: new Date().toISOString(), statut_envoi: "envoi" })]);
const v1 = (await voucher()).r;
const v2 = (await voucher()).r;
ok(v1.nouveau === true && v2.nouveau === false && v1.message_id === v2.message_id, "deux demandes du même voucher : un seul message rangé (clé unique)");
const m = await un("select type, origine, statut_envoi, texte, medias from whatsapp_messages where id = $1", [v1.message_id]);
ok(m.type === "image" && m.origine === "gestion" && m.statut_envoi === "envoi" && m.texte === "Your voucher", "rangé « envoi », type image, origine gestion, légende en texte");
ok(m.medias[0].statut === "voucher" && !m.medias[0].chemin, "le média ne cite jamais le stockage « whatsapp » (pas de chemin)");
ok((await un("select whatsapp_retirer_envoi($1) x", [v1.message_id])).x === true, "refus sûr de Telnyx : le message est retiré");
const v3 = (await voucher()).r;
ok(v3.nouveau === true, "après un refus sûr, le voucher peut repartir");
let r = await essaie(u.nani, "select whatsapp_confirmer_envoi($1, false) x", [conv]);
ok(r.ok && r.rows[0].x.messages === 1, "« Pas parti » sur un voucher au résultat inconnu : retiré par Nani");
r = await essaie(u.mook, "select whatsapp_confirmer_envoi($1, true) x", [conv]);
ok(!r.ok, "Mook ne confirme pas un envoi");
r = await essaie(u.mook, "select whatsapp_peut_ecrire($1) x", [conv]);
ok(r.ok && r.rows[0].x === false, "Mook ne peut pas écrire dans la conversation (refus de la fonction)");
r = await essaie(u.ztp, "select whatsapp_peut_ecrire($1) x", [conv]);
ok(r.ok && r.rows[0].x === false, "un administrateur de ZTP non plus");
r = await essaie(u.ztp, "select whatsapp_admin($1) x", [ent.ztp]);
ok(r.ok && r.rows[0].x === false, "un voucher de ZTP n'est jamais envoyable (whatsapp_admin)");

// ---- Retour en arrière -------------------------------------------------------------------------------------------------------------
await db.exec(lire("retour-73-whatsapp-voucher.sql"));
ok(!!(await bucket()), "retour : un bucket qui contient encore un fichier reste (Supabase le refuserait)");
await db.exec("delete from storage.objects where bucket_id = 'whatsapp-sortant'");
await db.exec(lire("retour-73-whatsapp-voucher.sql"));
ok(!(await bucket()), "retour : le bucket vide est supprimé");
await db.exec(lire("migration-73-whatsapp-voucher.sql"));
b = await bucket();
ok(b && b.public === false, "la migration se rejoue après le retour");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
