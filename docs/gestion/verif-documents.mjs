// Vérifie la migration 31 (lot C1 : corbeille des documents, prochain numéro, devise écrite, acompte figé) sur un Postgres en mémoire,
// avec l'enchaînement schema.sql puis migrations 18 à 31. Même mise en place que verif-fiduciaire.mjs :
//   GESTION_SQL=<repo>/docs/gestion/ node verif-documents.mjs
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
const db = new PGlite();
await db.exec(harnais);
await db.exec(fs.readFileSync(W + "schema.sql", "utf8").replace("create extension if not exists pgcrypto;", ""));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|2\d|30)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
for (const f of migrations) await db.exec(fs.readFileSync(W + f, "utf8"));

const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const essaie = async (userId, sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
};
const E = (await un("select id from entites where slug = 'ztp'")).id;
await db.exec(`update reglages set valeur = valeur || '{"devise":"CHF","conditions":{"acompte_pct":30}}'::jsonb where entite_id = '${E}'`);
const C = (await un("insert into clients (entite_id, prenom, nom) values ($1, 'A', 'B') returning id", [E])).id;
const D = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, 'ZT-2026-0007', $2) returning id", [E, C])).id;
const doc = (await un(`insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ($1, $2, 'facture', '2026-11-02', '{"lignes":[{"id":"l1","kind":"ligne","libelle":"x","unite":100,"qte":1}]}') returning id`, [E, D])).id;
const ancien = (await un(`insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ($1, $2, 'devis', '2026-11-01', '{"lignes":[]}') returning id`, [E, D])).id;
await db.exec(`update documents set envoye_le = '2026-11-01' where id = '${ancien}'`);
await db.exec(`insert into documents_nets (document_id, entite_id, nets) values ('${doc}', '${E}', '{"l1": 60}')`);

// Personnes : l'administratrice (tous les droits) et un lecteur.
const U = {};
for (const k of ["admin", "lecteur"]) U[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
await db.exec(`insert into membres values ('${U.admin}', '${E}', (select id from roles where entite_id = '${E}' and nom = 'Administrateur'))`);
await db.exec(`insert into membres values ('${U.lecteur}', '${E}', (select id from roles where entite_id = '${E}' and nom = 'Lecteur'))`);

console.log("== migration 31");
await db.exec(fs.readFileSync(W + "migration-31-c1-documents.sql", "utf8"));
await db.exec(fs.readFileSync(W + "migration-31-c1-documents.sql", "utf8"));
ok(true, "elle se rejoue sans erreur (idempotente)");

console.log("== devise toujours écrite");
ok((await un("select contenu->>'devise' d from documents where id = $1", [doc])).d === "CHF", "un ancien document sans devise reçoit celle de son entreprise");
const neuf = (await un(`insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ($1, $2, 'devis', '2026-11-03', '{"lignes":[]}') returning contenu->>'devise' d, id`, [E, D]));
ok(neuf.d === "CHF", "un nouveau document sans devise la reçoit à l'enregistrement");
const thb = (await un(`insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ($1, $2, 'devis', '2026-11-03', '{"devise":"THB","lignes":[]}') returning contenu->>'devise' d`, [E, D]));
ok(thb.d === "THB", "une devise déjà écrite ne change pas");
ok((await un("select count(*)::int n from documents_historique where document_id = $1 and action = 'update'", [doc])).n === 0, "la reprise des anciens documents ne crée pas de version dans l'historique");
ok((await un("select devise from dossiers_resume where dossier_id = $1", [D])).devise === "CHF", "le résumé du dossier connaît la devise");

console.log("== acompte figé");
ok(Number((await un("select acompte_pct from dossiers where id = $1", [D])).acompte_pct) === 30, "un dossier au devis déjà envoyé reçoit l'acompte actuel");
const D2 = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, 'ZT-2026-0008', $2) returning id", [E, C])).id;
ok((await un("select acompte_pct from dossiers where id = $1", [D2])).acompte_pct === null, "un nouveau dossier n'a pas d'acompte figé tant que son devis n'est pas parti");
ok((await essaie(U.admin, "update dossiers set acompte_pct = 40 where id = $1 returning acompte_pct", [D2])).ok, "l'outil peut figer l'acompte à l'envoi du devis");

console.log("== corbeille des documents");
await db.exec(`delete from documents where id = '${doc}'`);
ok((await un("select count(*)::int n from documents_nets_corbeille where document_id = $1", [doc])).n === 1, "les nets d'un document supprimé sont gardés à part");
ok(!(await essaie(U.lecteur, "select * from documents_nets_corbeille")).ok || (await essaie(U.lecteur, "select * from documents_nets_corbeille")).rows.length === 0, "personne ne lit directement les nets gardés");
const liste = await essaie(U.admin, "select * from documents_supprimes($1)", [E]);
ok(liste.ok && liste.rows.length === 1 && liste.rows[0].document_id === doc && liste.rows[0].ref === "ZT-2026-0007" && liste.rows[0].type === "facture", "l'administratrice voit la facture supprimée avec sa référence");
ok(!(await essaie(U.lecteur, "select * from documents_supprimes($1)", [E])).ok, "un lecteur ne voit pas la corbeille des documents");
ok(!(await essaie(U.lecteur, "select restaurer_document($1)", [doc])).ok, "un lecteur ne restaure pas un document");
const r = await essaie(U.admin, "select restaurer_document($1) d", [doc]);
ok(r.ok && r.rows[0].d === D, "l'administratrice restaure la facture dans son dossier");
ok((await un("select contenu->'lignes'->0->>'libelle' l from documents where id = $1", [doc])).l === "x", "le contenu revient tel quel");
ok((await un("select nets->>'l1' n from documents_nets where document_id = $1", [doc])).n === "60", "les nets reviennent avec le document");
ok((await essaie(U.admin, "select * from documents_supprimes($1)", [E])).rows.length === 0, "le document restauré quitte la corbeille");
ok(!(await essaie(U.admin, "select restaurer_document($1)", [doc])).ok, "on ne restaure pas deux fois");
// Un document dont le dossier est supprimé se restaure par la corbeille des dossiers, pas ici.
await db.exec(`delete from dossiers where id = '${D2}'`);
const D3 = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, 'ZT-2026-0009', $2) returning id", [E, C])).id;
const d3 = (await un(`insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ($1, $2, 'devis', '2026-11-03', '{"lignes":[]}') returning id`, [E, D3])).id;
await db.exec(`delete from dossiers where id = '${D3}'`);
ok((await essaie(U.admin, "select * from documents_supprimes($1)", [E])).rows.every((x) => x.document_id !== d3), "un document parti avec son dossier n'est pas proposé ici");
ok(!(await essaie(U.admin, "select restaurer_document($1)", [d3])).ok, "et ne se restaure pas sans son dossier");

console.log("== portée de la restauration");
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${E}', 'Limitée', 'mes_dossiers', array['dossiers.lire','dossiers.ecrire','documents.ecrire','documents.supprimer','finances.voir'])`);
U.limitee = (await un("insert into auth.users (email) values ('limitee@test') returning id")).id;
await db.exec(`insert into membres values ('${U.limitee}', '${E}', (select id from roles where entite_id = '${E}' and nom = 'Limitée'))`);
const autre = (await un(`insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ($1, $2, 'devis', '2026-11-04', '{"lignes":[]}') returning id`, [E, D])).id;
await db.exec(`delete from documents where id = '${autre}'`);
ok((await essaie(U.limitee, "select * from documents_supprimes($1)", [E])).rows.length === 0, "un rôle limité à ses dossiers ne voit pas les documents des autres");
ok(!(await essaie(U.limitee, "select restaurer_document($1)", [autre])).ok, "ni ne les restaure en passant par l'identifiant");
ok((await essaie(U.admin, "select restaurer_document($1)", [autre])).ok, "l'administratrice, elle, le restaure");

console.log("== prochain numéro");
const lu = await essaie(U.admin, "select lire_prochain_numero($1, 2026) n", [E]);
ok(lu.ok && lu.rows[0].n.minimum === 10 && lu.rows[0].n.prochain === 10, "le prochain numéro suit le plus grand déjà donné (0009 → 10)");
ok(!(await essaie(U.lecteur, "select lire_prochain_numero($1, 2026)", [E])).ok, "un lecteur ne voit pas la numérotation");
ok(!(await essaie(U.admin, "select fixer_prochain_numero($1, 2026, 5)", [E])).ok, "impossible de revenir sous un numéro déjà donné");
ok(!(await essaie(U.lecteur, "select fixer_prochain_numero($1, 2026, 50)", [E])).ok, "un lecteur ne change pas la numérotation");
ok((await essaie(U.admin, "select fixer_prochain_numero($1, 2026, 50)", [E])).ok, "l'administratrice saute au numéro 50");
const suivant = await essaie(U.admin, "select prochain_numero_ref($1, 2026, 9) n", [E]);
ok(suivant.ok && suivant.rows[0].n === 50, "le dossier suivant prend bien le numéro 50");
ok((await un("select count(*)::int n from journal where table_name = 'reglages' and details ? 'prochain_numero'")).n === 1, "le changement de numérotation est au journal");

console.log(echecs ? `${echecs} échec(s)` : "Tout est bon.");
process.exit(echecs ? 1 : 0);
