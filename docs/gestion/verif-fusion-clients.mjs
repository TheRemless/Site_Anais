// Vérifie la migration 31 (fusion de deux fiches client) sur un Postgres en mémoire : schema.sql, migrations 18 à 29, puis 31.
//   (même mise en place que verif-securite.mjs : GESTION_SQL=<repo>/docs/gestion/ node verif-fusion-clients.mjs)
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
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql"));
for (const f of fs.readdirSync(W).filter((n) => /^migration-(1[89]|2\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]))) await db.exec(lire(f));
await db.exec(lire("migration-31-fusion-clients.sql"));
await db.exec(lire("migration-31-fusion-clients.sql"));
ok(true, "la migration 31 s'applique deux fois sans erreur");

const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const essaie = async (userId, sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
};
const E = (await un("select id from entites where slug = 'secret'")).id;
const Z = (await un("select id from entites where slug = 'ztp'")).id;
const U = {};
for (const k of ["admin", "editeur", "fusion", "limitee"]) U[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
const base = ["clients.lire", "clients.ecrire", "dossiers.lire", "dossiers.ecrire"];
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values
  ('${E}', 'Admin test', 'toute', array['${[...base, "clients.supprimer"].join("','")}']),
  ('${E}', 'Editeur test', 'toute', array['${base.join("','")}']),
  ('${E}', 'Fusion test', 'toute', array['${[...base, "clients.fusionner"].join("','")}']),
  ('${E}', 'Limitee test', 'mes_dossiers', array['${[...base, "clients.fusionner"].join("','")}'])`);
const membre = (u, role) => db.exec(`insert into membres values ('${U[u]}', '${E}', (select id from roles where entite_id = '${E}' and nom = '${role}'))`);
await membre("admin", "Admin test"); await membre("editeur", "Editeur test"); await membre("fusion", "Fusion test"); await membre("limitee", "Limitee test");

const client = async (o, e = E) => (await un("insert into clients (entite_id, prenom, nom, telephone, email, adresse, notes) values ($1, $2, $3, $4, $5, $6, $7) returning id", [e, o.prenom || "", o.nom || "", o.telephone || "", o.email || "", o.adresse || "", o.notes || ""])).id;
let n = 0;
const dossier = async (c, e = E) => (await un("insert into dossiers (entite_id, ref, client_id) values ($1, $2, $3) returning id", [e, `T-${++n}`, c])).id;

// 1. Fusion par un administrateur (supprimer + modifier les dossiers) : dossiers déplacés, champs vides remplis, notes ajoutées, l'autre fiche supprimée.
const A = await client({ prenom: "Jane", nom: "Example", telephone: "", notes: "VIP" });
const B = await client({ prenom: "J.", nom: "Example", telephone: "+41791234567", email: "jane@example.test", adresse: "Hotel X, Room 4", notes: "Allergie" });
const d1 = await dossier(A); const d2 = await dossier(B); const d3 = await dossier(B);
await db.query("insert into corbeille (entite_id, table_name, ligne, liees) values ($1, 'dossiers', $2, '{}'::jsonb)", [E, JSON.stringify({ id: "00000000-0000-4000-8000-0000000000ff", ref: "T-old", client_id: B, entite_id: E })]);
const r1 = await essaie(U.admin, "select fusionner_clients($1, $2) as id", [A, B]);
ok(r1.ok && r1.rows[0].id === A, "un administrateur fusionne la fiche B dans la fiche A");
ok((await un("select count(*)::int as n from dossiers where client_id = $1", [A])).n === 3, "les dossiers de B passent sur A");
ok(!(await un("select id from clients where id = $1", [B])), "la fiche B est supprimée");
const a = await un("select * from clients where id = $1", [A]);
ok(a.prenom === "Jane" && a.telephone === "+41791234567" && a.email === "jane@example.test" && a.adresse === "Hotel X, Room 4", "les champs vides de A prennent ceux de B, le prénom écrit reste");
ok(a.notes === "VIP\nAllergie", "les notes de B s'ajoutent à celles de A");
ok((await un("select ligne->>'client_id' as c from corbeille where ligne->>'ref' = 'T-old'")).c === A, "le dossier de B dans la corbeille pointe vers A");

// 2. Droits : un éditeur sans suppression ni fusion est refusé ; le droit « clients.fusionner » suffit ; une portée « ses dossiers » est refusée.
const C1 = await client({ nom: "Doe" }); const C2 = await client({ nom: "Doe" }); await dossier(C2);
const r2 = await essaie(U.editeur, "select fusionner_clients($1, $2)", [C1, C2]);
ok(!r2.ok && /fusionner/.test(r2.err), "un éditeur sans droit de fusion est refusé");
ok(!!(await un("select id from clients where id = $1", [C2])), "et rien n'a bougé");
const r3 = await essaie(U.limitee, "select fusionner_clients($1, $2)", [C1, C2]);
ok(!r3.ok && /voient tous les dossiers/.test(r3.err), "une portée « ses dossiers » est refusée");
const r4 = await essaie(U.fusion, "select fusionner_clients($1, $2)", [C1, C2]);
ok(r4.ok && !(await un("select id from clients where id = $1", [C2])), "le droit « clients.fusionner » suffit");

// 3. Garde-fous : même fiche, autre entreprise, anonyme.
const r5 = await essaie(U.admin, "select fusionner_clients($1, $1)", [C1]);
ok(!r5.ok, "une fiche ne se fusionne pas avec elle-même");
const Zc = await client({ nom: "Other" }, Z);
const r6 = await essaie(U.admin, "select fusionner_clients($1, $2)", [C1, Zc]);
ok(!r6.ok && !!(await un("select id from clients where id = $1", [Zc])), "deux entreprises différentes : refusé");
await db.exec("set role anon;");
let anonOk = true;
try { await db.query("select fusionner_clients($1, $2)", [C1, Zc]); } catch { anonOk = false; }
await db.exec("reset role;");
ok(!anonOk, "un visiteur anonyme ne peut pas appeler la fonction");

console.log(echecs ? `${echecs} échec(s)` : "Tout est bon.");
process.exit(echecs ? 1 : 0);
