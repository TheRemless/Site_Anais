// Vérifie la migration 22 (liens d'envoi) sur un Postgres en mémoire : qui peut créer, lire, signer, révoquer un lien, et que rien n'est lisible sans lui.
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-liens-envoi.mjs . && GESTION_SQL=<repo>/docs/gestion/ node verif-liens-envoi.mjs
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
await db.exec("grant all on all tables in schema public to authenticated; revoke insert, update, delete on journal from authenticated;");
// Deux passages : la migration est idempotente.
await db.exec(lire(W + "migration-22-liens-envoi.sql"));
await db.exec(lire(W + "migration-22-liens-envoi.sql"));
await db.exec("grant all on liens_envoi to anon; revoke all on liens_envoi from anon;");

async function essaie(userId, sql) {
  await db.exec(`set role ${userId ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
}
const compte = async (u, sql) => { const r = await essaie(u, sql); return r.ok ? r.rows.length : -1; };
const E = Object.fromEntries((await db.query("select slug, id from entites")).rows.map((r) => [r.slug, r.id]));
const user = async (k) => (await db.query("insert into auth.users (email) values ($1) returning id", [k + "@test"])).rows[0].id;
const u = {};
for (const k of ["editeur", "voucher", "lecteur", "sansdroit", "intrus"]) u[k] = await user(k);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${E.secret}', 'Voucher seulement', 'toute', array['clients.lire','dossiers.lire','dossiers.ecrire'])`);
const membre = (k, ent, role) => db.exec(`insert into membres values ('${u[k]}', '${E[ent]}', (select id from roles where entite_id = '${E[ent]}' and nom = '${role}'))`);
await membre("editeur", "secret", "Éditeur");
await membre("voucher", "secret", "Voucher seulement");
await membre("lecteur", "secret", "Lecteur");
await membre("intrus", "taxi", "Éditeur");
for (const e of ["secret", "taxi"]) {
  await db.exec(`insert into clients (id, entite_id, nom) values (gen_random_uuid(), '${E[e]}', 'Client ${e}');`);
  await db.exec(`insert into dossiers (entite_id, ref, client_id) select '${E[e]}', 'R-${e}', id from clients where entite_id = '${E[e]}';`);
}
const dos = Object.fromEntries((await db.query("select entite_id, id from dossiers")).rows.map((r) => [r.entite_id, r.id]));
const lien = (ent, genre, chemin, extra = "") => `insert into liens_envoi (entite_id, dossier_id, genre, objet_id, nom, type, chemin, expire_le, cree_par${extra ? ", " + extra.split("=")[0] : ""}) values ('${E[ent]}', '${dos[E[ent]]}', '${genre}', 'x', 'v.png', 'image/png', '${chemin}', now() + interval '30 days', auth.uid()${extra ? ", " + extra.split("=")[1] : ""})`;
const C1 = `${E.secret}/aaaa-1.png`;
const C2 = `${E.secret}/bbbb-2.pdf`;

console.log("Création d'un lien");
ok((await db.query("select public from storage.buckets where id = 'envois'")).rows[0].public === false, "le bucket « envois » est privé");
ok((await essaie(u.editeur, lien("secret", "voucher", C1))).ok, "un éditeur crée un lien de voucher chez Secret");
ok((await essaie(u.editeur, lien("secret", "voucher", C1))).ok === false, "le chemin d'un lien est unique");
ok((await essaie(u.voucher, lien("secret", "voucher", `${E.secret}/cccc-3.png`))).ok, "le droit d'écrire les dossiers suffit pour un voucher");
ok((await essaie(u.voucher, lien("secret", "document", `${E.secret}/dddd-4.pdf`))).ok === false, "mais pas pour un devis ou une facture (droit documents)");
ok((await essaie(u.editeur, lien("secret", "document", C2))).ok, "un éditeur crée un lien de document");
ok((await essaie(u.lecteur, lien("secret", "voucher", `${E.secret}/eeee-5.png`))).ok === false, "un lecteur ne crée aucun lien");
ok((await essaie(u.intrus, lien("secret", "voucher", `${E.secret}/ffff-6.png`))).ok === false, "un éditeur de Taxi n'en crée pas chez Secret");
ok((await essaie(null, lien("secret", "voucher", `${E.secret}/gggg-7.png`))).ok === false, "personne sans compte n'en crée");
ok((await essaie(u.editeur, `insert into liens_envoi (entite_id, dossier_id, genre, chemin, expire_le, cree_par) values ('${E.secret}', '${dos[E.secret]}', 'voucher', 'x/y', now(), '${u.lecteur}')`)).ok === false, "on ne crée pas un lien au nom d'une autre personne");
ok((await essaie(u.editeur, `insert into liens_envoi (entite_id, dossier_id, genre, chemin, expire_le, cree_par) values ('${E.secret}', '${dos[E.taxi]}', 'voucher', 'x/z', now(), auth.uid())`)).ok === false, "le dossier doit être celui de l'entreprise");

console.log("Lecture");
ok((await compte(u.editeur, "select 1 from liens_envoi")) === 3, "l'éditeur voit les liens de Secret");
ok((await compte(u.voucher, "select 1 from liens_envoi")) === 2, "le rôle voucher voit ses liens de voucher, pas ceux des documents");
ok((await compte(u.lecteur, "select 1 from liens_envoi")) === 0, "un lecteur ne voit aucun lien");
ok((await compte(u.intrus, "select 1 from liens_envoi")) === 0, "un autre entreprise ne voit rien");
ok((await compte(null, "select 1 from liens_envoi")) === -1, "un visiteur sans compte n'a pas accès à la table");

console.log("Fichiers dans le stockage");
ok((await essaie(u.editeur, `insert into storage.objects (bucket_id, name) values ('envois', '${C1}')`)).ok, "on dépose le fichier d'un lien qu'on a créé");
ok((await essaie(u.editeur, `insert into storage.objects (bucket_id, name) values ('envois', '${E.secret}/inconnu.png')`)).ok === false, "mais pas un fichier sans ligne de lien");
ok((await essaie(u.lecteur, `insert into storage.objects (bucket_id, name) values ('envois', '${E.secret}/cccc-3.png')`)).ok === false, "un lecteur ne dépose rien");
ok((await essaie(u.intrus, `insert into storage.objects (bucket_id, name) values ('envois', '${E.secret}/cccc-3.png')`)).ok === false, "un autre entreprise non plus");
await essaie(u.editeur, `insert into storage.objects (bucket_id, name) values ('envois', '${C2}')`);
ok((await compte(u.editeur, "select 1 from storage.objects where bucket_id = 'envois'")) === 2, "l'éditeur peut signer ses deux fichiers");
ok((await compte(u.voucher, "select 1 from storage.objects where bucket_id = 'envois'")) === 1, "le rôle voucher ne signe pas un document");
ok((await compte(u.lecteur, "select 1 from storage.objects where bucket_id = 'envois'")) === 0, "un lecteur ne lit rien");
ok((await compte(u.intrus, "select 1 from storage.objects where bucket_id = 'envois'")) === 0, "un autre entreprise ne lit rien");
ok((await compte(null, "select 1 from storage.objects where bucket_id = 'envois'")) <= 0, "sans compte, aucun fichier n'est listé (zéro ligne ou accès refusé)");

console.log("Modification, révocation, nettoyage");
ok((await essaie(u.editeur, `update liens_envoi set chemin = 'autre' where chemin = '${C1}'`)).ok === false, "le chemin d'un lien ne se modifie pas");
ok((await essaie(u.editeur, `update liens_envoi set expire_le = now() + interval '10 years' where chemin = '${C1}'`)).ok === false, "la durée d'un lien ne se prolonge pas");
ok((await essaie(u.lecteur, `update liens_envoi set revoque_le = now() where chemin = '${C1}'`)).n === 0, "un lecteur ne révoque rien");
ok((await essaie(u.intrus, `update liens_envoi set revoque_le = now() where chemin = '${C1}'`)).n === 0, "un autre entreprise non plus");
ok((await essaie(u.editeur, `delete from storage.objects where bucket_id = 'envois' and name = '${C1}'`)).n === 1, "l'éditeur retire le fichier");
ok((await essaie(u.editeur, `update liens_envoi set revoque_le = now() where chemin = '${C1}'`)).n === 1, "puis révoque le lien");
await essaie(u.editeur, `insert into storage.objects (bucket_id, name) values ('envois', '${C1}')`);
ok((await compte(u.editeur, `select 1 from storage.objects where name = '${C1}'`)) === 0, "un lien révoqué n'est plus signable ni redéposable");
ok((await essaie(u.editeur, `update liens_envoi set nettoye_le = now() where chemin = '${C2}'`)).n === 1, "le nettoyage d'un lien expiré se note");

console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTOUT EST BON");
process.exit(echecs ? 1 : 0);
