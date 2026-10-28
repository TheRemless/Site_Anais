// Vérifie les règles de sécurité de schema.sql et de migration-2-entreprises.sql sur un Postgres en mémoire.
// À relancer après toute modification des fichiers SQL :
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-securite.mjs <repo>/docs/gestion/schema-v1-reference.sql . && node verif-securite.mjs
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
grant usage on schema public, auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

async function nouvelle(sqlFichiers) {
  const db = new PGlite();
  await db.exec(harnais);
  for (const f of sqlFichiers) await db.exec(fs.readFileSync(f, "utf8").replace("create extension if not exists pgcrypto;", ""));
  await db.exec("grant all on all tables in schema public to authenticated;");
  return db;
}
async function comme(db, userId, sql, params) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec("reset role;"); }
}
async function essaie(db, userId, sql, params) {
  try { const r = await comme(db, userId, sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; } catch (e) { return { ok: false, err: e.message }; }
}

console.log("== Installation neuve ==");
const db = await nouvelle([W + "schema.sql"]);
const E = Object.fromEntries((await db.query("select slug, id from entites")).rows.map((r) => [r.slug, r.id]));
// trois comptes : le premier devient administrateur général (trigger), les autres sont des profils simples
const u = {};
for (const [k, mail] of [["admin", "anais@test"], ["assistante", "assistante@test"], ["inconnu", "inconnu@test"]]) {
  u[k] = (await db.query("insert into auth.users (email) values ($1) returning id", [mail])).rows[0].id;
}
const profils = (await db.query("select email, super_admin from profils order by created_at, email")).rows;
ok(profils.find((p) => p.email === "anais@test").super_admin === true, "le premier compte devient administrateur général");
ok(profils.filter((p) => p.super_admin).length === 1, "les comptes suivants ne sont pas administrateurs");
await db.exec(`insert into membres values ('${u.assistante}', '${E.secret}', 'editeur'), ('${u.assistante}', '${E.taxi}', 'editeur');`);
// données de chaque entreprise (en tant que propriétaire)
for (const e of ["ztp", "secret", "taxi"]) {
  await db.exec(`insert into clients (id, entite_id, nom) values (gen_random_uuid(), '${E[e]}', 'Client ${e}');`);
}
for (const e of ["ztp", "secret", "taxi"]) {
  await db.exec(`insert into dossiers (entite_id, ref, client_id) select '${E[e]}', 'R-${e}', id from clients where entite_id = '${E[e]}';`);
  await db.exec(`insert into documents (entite_id, dossier_id, type, date_emission, contenu) select '${E[e]}', id, 'devis', '2026-10-01', '{}' from dossiers where entite_id = '${E[e]}';`);
  await db.exec(`insert into paiements (entite_id, dossier_id, date, montant) select '${E[e]}', id, '2026-10-02', 100 from dossiers where entite_id = '${E[e]}';`);
}

console.log("Assistante (éditeur sur Secret et Taxi)");
for (const t of ["clients", "dossiers", "documents", "paiements"]) {
  const r = await essaie(db, u.assistante, `select entite_id from ${t}`);
  ok(r.ok && r.rows.length === 2 && !r.rows.some((x) => x.entite_id === E.ztp), `${t} : voit Secret et Taxi, jamais Zwald`);
}
ok((await essaie(db, u.assistante, "select slug from entites")).rows.map((x) => x.slug).sort().join() === "secret,taxi", "ne voit que ses deux entreprises");
ok((await essaie(db, u.assistante, "select entite_id from reglages")).rows.length === 2, "ne lit pas les réglages de Zwald (IBAN)");
ok((await essaie(db, u.assistante, `insert into clients (entite_id, nom) values ('${E.ztp}', 'intrus')`)).ok === false, "ne peut pas créer un client chez Zwald");
ok((await essaie(db, u.assistante, `insert into clients (entite_id, nom) values ('${E.secret}', 'ok')`)).ok === true, "peut créer un client chez Secret");
const clientZtp = (await db.query(`select id from clients where entite_id='${E.ztp}'`)).rows[0].id;
const dossierZtp = (await db.query(`select id from dossiers where entite_id='${E.ztp}'`)).rows[0].id;
const dossierSecret = (await db.query(`select id from dossiers where entite_id='${E.secret}'`)).rows[0].id;
const clientSecret = (await db.query(`select id from clients where entite_id='${E.secret}' limit 1`)).rows[0].id;
ok((await essaie(db, u.assistante, `insert into dossiers (entite_id, ref, client_id) values ('${E.secret}', 'X1', '${clientZtp}')`)).ok === false, "ne peut pas rattacher un dossier Secret à un client Zwald");
ok((await essaie(db, u.assistante, `insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ('${E.secret}', '${dossierZtp}', 'facture', '2026-10-01', '{}')`)).ok === false, "ne peut pas mettre un document Secret dans un dossier Zwald");
ok((await essaie(db, u.assistante, `insert into dossiers (entite_id, ref, client_id) values ('${E.secret}', 'X2', '${clientSecret}')`)).ok === true, "peut créer un dossier chez Secret");
const maj = await essaie(db, u.assistante, `update dossiers set entite_id = '${E.ztp}' where id = '${dossierSecret}'`);
ok(!maj.ok, "ne peut pas déplacer un dossier vers Zwald");
const maj2 = await comme(db, u.assistante, `update clients set nom = 'piraté' where id = '${clientZtp}'`);
ok((maj2.affectedRows || 0) === 0, "ne peut pas modifier un client de Zwald");
const sup = await comme(db, u.assistante, `delete from dossiers where id = '${dossierZtp}'`);
ok((sup.affectedRows || 0) === 0, "ne peut pas supprimer un dossier de Zwald");
ok((await comme(db, u.assistante, `delete from dossiers where id = '${dossierSecret}'`)).affectedRows === 0, "un éditeur ne supprime pas un dossier, même chez Secret");
ok((await comme(db, u.assistante, `delete from paiements where entite_id = '${E.secret}'`)).affectedRows === 1, "un éditeur peut corriger un paiement chez Secret");
ok((await comme(db, u.assistante, `update reglages set valeur = '{"x":1}' where entite_id = '${E.secret}'`)).affectedRows === 0, "un éditeur ne modifie pas les réglages");
ok((await comme(db, u.assistante, `update profils set super_admin = true where user_id = '${u.assistante}'`)).affectedRows === 0, "ne peut pas s'élever administrateur");
ok((await essaie(db, u.assistante, `insert into membres values ('${u.assistante}', '${E.ztp}', 'admin')`)).ok === false, "ne peut pas s'ajouter à Zwald");
ok((await essaie(db, u.assistante, `insert into entites (slug, nom) values ('x', 'x')`)).ok === false, "ne peut pas créer d'entreprise");
ok((await essaie(db, u.assistante, "select email from profils")).rows.length === 1, "ne voit que son propre profil");

console.log("Administratrice");
ok((await essaie(db, u.admin, "select id from clients")).rows.length >= 4, "voit les clients de toutes les entreprises");
ok((await comme(db, u.admin, `update reglages set valeur = valeur || '{"x":1}' where entite_id = '${E.ztp}'`)).affectedRows === 1, "modifie les réglages de Zwald");
ok((await essaie(db, u.admin, `insert into entites (slug, nom) values ('nouvelle', 'Nouvelle')`)).ok, "crée une entreprise");
ok((await essaie(db, u.admin, `insert into membres values ('${u.inconnu}', '${E.taxi}', 'editeur')`)).ok, "donne un accès");
ok((await essaie(db, u.admin, "select email from profils")).rows.length === 3, "voit tous les profils");

console.log("Compte sans accès, compte désactivé, anonyme");
ok((await essaie(db, u.inconnu, "select entite_id from clients")).rows.every((r) => r.entite_id === E.taxi) && (await essaie(db, u.inconnu, "select entite_id from clients")).rows.length === 1, "un accès accordé à Taxi donne exactement les données de Taxi");
await db.exec(`update profils set actif = false where user_id = '${u.assistante}'`);
ok((await essaie(db, u.assistante, "select id from clients")).rows.length === 0, "un compte désactivé ne voit plus rien");
await db.exec(`delete from membres where user_id = '${u.inconnu}'`);
ok((await essaie(db, u.inconnu, "select id from clients")).rows.length === 0, "un compte sans accès ne voit rien");
await db.exec("set role anon;");
let anonRefuse = false; try { await db.query("select * from clients"); } catch { anonRefuse = true; }
await db.exec("reset role;");
ok(anonRefuse, "le visiteur anonyme est refusé");

console.log("\n== Migration depuis la première version ==");
const v1 = await nouvelle([]);
await v1.exec(fs.readFileSync("./schema-v1-reference.sql", "utf8").replace("create extension if not exists pgcrypto;", ""));
await v1.exec("create user_dummy_placeholder_unused int;".slice(0, 0));
const compte = (await v1.query("insert into auth.users (email) values ('anais@test') returning id")).rows[0].id;
await v1.exec(`insert into clients (id, nom) values ('11111111-1111-4111-8111-111111111111', 'Ancien client');
insert into dossiers (ref, client_id) values ('OLD1 Thaïlande', '11111111-1111-4111-8111-111111111111');
insert into documents (dossier_id, type, date_emission, contenu) select id, 'devis', '2026-10-01', '{"a":1}' from dossiers;
insert into paiements (dossier_id, date, montant) select id, '2026-10-02', 50 from dossiers;`);
await v1.exec(fs.readFileSync(W + "migration-2-entreprises.sql", "utf8"));
const E2 = (await v1.query("select id from entites where slug='ztp'")).rows[0].id;
ok((await v1.query("select count(*)::int n from clients where entite_id = $1", [E2])).rows[0].n === 1, "les anciens clients passent chez Zwald");
ok((await v1.query("select count(*)::int n from documents where entite_id = $1 and contenu->>'a' = '1'", [E2])).rows[0].n === 1, "les anciens documents sont conservés");
ok((await v1.query("select count(*)::int n from paiements where entite_id = $1", [E2])).rows[0].n === 1, "les anciens paiements sont conservés");
ok((await v1.query("select super_admin from profils where email='anais@test'")).rows[0].super_admin === true, "le compte existant devient administrateur général");
ok((await v1.query("select valeur->'emetteur'->>'nom' n from reglages where entite_id=$1", [E2])).rows[0].n.startsWith("Zwald"), "les réglages de Zwald sont repris");
const a1 = await essaie(v1, compte, "select id from clients");
ok(a1.ok && a1.rows.length === 1, "après migration, l'administratrice lit les données");

// même structure qu'une installation neuve
const cols = async (d) => (await d.query("select table_name||'.'||column_name||':'||data_type c from information_schema.columns where table_schema='public' order by 1")).rows.map((r) => r.c).join("\n");
ok((await cols(db)) === (await cols(v1)), "la base migrée a la même structure qu'une base neuve");
const pol = async (d) => (await d.query("select tablename||'.'||policyname||':'||cmd c from pg_policies where schemaname='public' order by 1")).rows.map((r) => r.c).join("\n");
ok((await pol(db)) === (await pol(v1)), "les règles de sécurité sont identiques");
console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTOUT EST BON");
process.exit(echecs ? 1 : 0);
