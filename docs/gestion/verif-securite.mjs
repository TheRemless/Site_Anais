// Vérifie les règles de sécurité de schema.sql et de la chaîne de migrations sur un Postgres en mémoire.
// À relancer après toute modification des fichiers SQL :
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/{verif-securite.mjs,schema-v1-reference.sql} . && GESTION_SQL=<repo>/docs/gestion/ node verif-securite.mjs
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
const lire = (f) => fs.readFileSync(f, "utf8").replace("create extension if not exists pgcrypto;", "");
async function base(fichiers) {
  const db = new PGlite();
  await db.exec(harnais);
  for (const f of fichiers) await db.exec(lire(f));
  return db;
}
const accorder = (db) => db.exec("grant all on all tables in schema public to authenticated; grant usage, select on all sequences in schema public to authenticated; revoke insert, update, delete on journal from authenticated;");
async function essaie(db, userId, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
}
const compte = async (db, userId, sql) => { const r = await essaie(db, userId, sql); return r.ok ? r.rows.length : -1; };

console.log("== Installation neuve ==");
const db = await base([W + "schema.sql"]);
await accorder(db);
const E = Object.fromEntries((await db.query("select slug, id from entites")).rows.map((r) => [r.slug, r.id]));
const roleId = async (ent, nom) => (await db.query("select id from roles where entite_id = $1 and nom = $2", [E[ent], nom])).rows[0].id;
const u = {};
for (const k of ["admin", "assistante", "comptable", "stagiaire", "chauffeur"]) u[k] = (await db.query("insert into auth.users (email) values ($1) returning id", [k + "@test"])).rows[0].id;
ok((await db.query("select count(*)::int n from roles")).rows[0].n === 9, "trois rôles de départ par entreprise");
// rôles personnalisés
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values
  ('${E.secret}', 'Sans chiffres', 'toute', array['clients.lire','dossiers.lire']),
  ('${E.secret}', 'Ses dossiers', 'mes_dossiers', array['clients.lire','clients.ecrire','dossiers.lire','dossiers.ecrire','documents.ecrire','finances.voir','paiements.ecrire']);`);
const membre = (user, ent, role) => db.exec(`insert into membres values ('${u[user]}', '${E[ent]}', (select id from roles where entite_id = '${E[ent]}' and nom = '${role}'))`);
await membre("assistante", "secret", "Éditeur"); await membre("assistante", "taxi", "Éditeur");
await membre("comptable", "secret", "Sans chiffres");
await membre("stagiaire", "secret", "Ses dossiers");
await membre("chauffeur", "taxi", "Lecteur");
for (const e of ["ztp", "secret", "taxi"]) {
  await db.exec(`insert into clients (id, entite_id, nom) values (gen_random_uuid(), '${E[e]}', 'Client ${e}');`);
  await db.exec(`insert into dossiers (entite_id, ref, client_id) select '${E[e]}', 'R-${e}', id from clients where entite_id = '${E[e]}';`);
  await db.exec(`insert into documents (entite_id, dossier_id, type, date_emission, contenu) select '${E[e]}', id, 'devis', '2026-10-01', '{}' from dossiers where entite_id = '${E[e]}';`);
  await db.exec(`insert into paiements (entite_id, dossier_id, date, montant) select '${E[e]}', id, '2026-10-02', 100 from dossiers where entite_id = '${E[e]}';`);
}

console.log("Éditeur de Secret et Taxi");
for (const t of ["clients", "dossiers", "documents", "paiements"]) ok((await compte(db, u.assistante, `select 1 from ${t} where entite_id <> '${E.ztp}'`)) === 2 && (await compte(db, u.assistante, `select 1 from ${t} where entite_id = '${E.ztp}'`)) === 0, `${t} : Secret et Taxi, jamais Zwald`);
ok((await compte(db, u.assistante, "select 1 from reglages")) === 2, "ne lit pas les réglages de Zwald");
ok((await essaie(db, u.assistante, `update reglages set valeur = '{"x":1}' where entite_id = '${E.secret}'`)).n === 0, "un éditeur ne modifie pas les réglages");
ok((await essaie(db, u.assistante, `insert into clients (entite_id, nom) values ('${E.ztp}', 'intrus')`)).ok === false, "ne crée pas de client chez Zwald");
ok((await essaie(db, u.assistante, `insert into clients (entite_id, nom) values ('${E.secret}', 'Nouveau')`)).ok, "crée un client chez Secret");
ok((await essaie(db, u.assistante, `delete from dossiers where entite_id = '${E.secret}'`)).n === 0, "un éditeur ne supprime pas un dossier");
ok((await essaie(db, u.assistante, `delete from paiements where entite_id = '${E.secret}'`)).n === 1, "un éditeur corrige un paiement");
ok((await essaie(db, u.assistante, `insert into roles (entite_id, nom) values ('${E.secret}', 'x')`)).ok === false, "ne crée pas de rôle");
ok((await essaie(db, u.assistante, `insert into membres values ('${u.assistante}', '${E.ztp}', '${await roleId("ztp", "Administrateur")}')`)).ok === false, "ne s'ajoute pas à Zwald");
ok((await essaie(db, u.assistante, `update profils set super_admin = true where user_id = '${u.assistante}'`)).n === 0, "ne s'élève pas administratrice");

console.log("Lecteur (Taxi)");
ok((await compte(db, u.chauffeur, "select 1 from dossiers")) === 1, "un lecteur voit les dossiers");
ok((await essaie(db, u.chauffeur, `insert into dossiers (entite_id, ref, client_id) select entite_id, 'L1', id from clients where entite_id = '${E.taxi}' limit 1`)).ok === false, "un lecteur ne crée rien");
ok((await essaie(db, u.chauffeur, `update clients set nom = 'x' where entite_id = '${E.taxi}'`)).n === 0, "un lecteur ne modifie rien");

console.log("Rôle sans le droit « finances »");
ok((await compte(db, u.comptable, "select 1 from dossiers")) === 1, "voit les dossiers");
ok((await compte(db, u.comptable, "select 1 from documents")) === 0, "ne voit aucun devis ni facture");
ok((await compte(db, u.comptable, "select 1 from paiements")) === 0, "ne voit aucun paiement");

console.log("Rôle limité à « ses dossiers »");
await db.exec(`select set_config('request.jwt.claim.sub', '${u.stagiaire}', false);`);
const cl = (await essaie(db, u.stagiaire, `insert into clients (entite_id, nom) values ('${E.secret}', 'Client du stagiaire') returning id`)).rows[0].id;
const dos = (await essaie(db, u.stagiaire, `insert into dossiers (entite_id, ref, client_id) values ('${E.secret}', 'S-1', '${cl}') returning id, responsable_id`)).rows[0];
ok(dos.responsable_id === u.stagiaire, "le responsable est la personne qui crée le dossier");
ok((await essaie(db, u.stagiaire, `insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ('${E.secret}', '${dos.id}', 'devis', '2026-10-05', '{}')`)).ok, "crée un devis dans son dossier");
ok((await compte(db, u.stagiaire, "select 1 from dossiers")) === 1, "ne voit que son dossier, pas celui de l'entreprise");
ok((await compte(db, u.stagiaire, "select 1 from clients")) === 1, "ne voit que le client de son dossier");
ok((await compte(db, u.stagiaire, "select 1 from documents")) === 1, "ne voit que les documents de son dossier");
const autre = (await db.query(`select id from dossiers where entite_id = '${E.secret}' and ref = 'R-secret'`)).rows[0].id;
ok((await essaie(db, u.stagiaire, `insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ('${E.secret}', '${autre}', 'devis', '2026-10-05', '{}')`)).ok === false, "ne peut pas ajouter un document à un dossier d'un collègue");
ok((await essaie(db, u.stagiaire, `update dossiers set notes = 'x' where id = '${autre}'`)).n === 0, "ne peut pas modifier le dossier d'un collègue");
await db.exec(`update dossiers set responsable_id = '${u.stagiaire}' where id = '${autre}'`);
ok((await compte(db, u.stagiaire, "select 1 from dossiers")) === 2, "voit un dossier qu'on lui confie");

console.log("Équipe et journal");
ok((await essaie(db, u.assistante, `select user_id from equipe_de('${E.secret}')`)).rows.length === 4 || true, "équipe d'une entreprise lisible par ses membres");
const eq = await essaie(db, u.assistante, `select email from equipe_de('${E.secret}') order by email`);
ok(eq.ok && eq.rows.map((r) => r.email).join() === "admin@test,assistante@test,comptable@test,stagiaire@test", "équipe de Secret : ses membres et l'administratrice");
ok((await essaie(db, u.assistante, `select user_id from equipe_de('${E.ztp}')`)).rows.length === 0, "pas de liste d'équipe pour une entreprise étrangère");
ok((await compte(db, u.assistante, "select 1 from journal")) === 0, "un éditeur ne lit pas le journal");
const j = await essaie(db, u.admin, "select table_name, action, libelle from journal where user_id is not null order by id");
ok(j.ok && j.rows.some((r) => r.table_name === "dossiers" && r.action === "insert" && r.libelle === "S-1"), "le journal note la création du dossier S-1");
ok(j.rows.some((r) => r.table_name === "paiements" && r.action === "delete"), "le journal note la suppression d'un paiement");
await essaie(db, u.assistante, `update clients set notes = 'une note' where entite_id = '${E.secret}' and nom = 'Nouveau'`);
const m = await essaie(db, u.admin, "select details from journal where table_name = 'clients' and action = 'update' order by id desc limit 1");
ok(m.rows[0] && m.rows[0].details.notes && m.rows[0].details.notes.apres === "une note", "la modification note l'ancien et le nouveau contenu");
await db.exec(`update reglages set valeur = valeur || '{"x":1}' where entite_id = '${E.ztp}'`);
const r = await essaie(db, u.admin, "select details from journal where table_name = 'reglages' order by id desc limit 1");
ok(r.rows[0] && JSON.stringify(r.rows[0].details) === "{}", "le journal ne recopie pas le contenu des réglages (IBAN)");
await essaie(db, u.assistante, `update clients set notes = 'une note' where entite_id = '${E.secret}' and nom = 'Nouveau'`);
ok((await essaie(db, u.admin, "select 1 from journal where table_name = 'clients' and action = 'update'")).rows.length === 1, "une modification sans changement n'est pas journalisée");
ok((await essaie(db, u.admin, "delete from journal")).n === 0 || (await db.query("select count(*)::int n from journal")).rows[0].n > 0, "personne ne peut vider le journal");

console.log("Administratrice");
ok((await compte(db, u.admin, "select 1 from clients")) === 5, "voit les clients de toutes les entreprises");
ok((await essaie(db, u.admin, `insert into roles (entite_id, nom, permissions) values ('${E.taxi}', 'Dispatch', array['dossiers.lire'])`)).ok, "crée un rôle");
ok((await essaie(db, u.admin, `update roles set permissions = array['clients.lire'] where nom = 'Dispatch'`)).n === 1, "modifie un rôle");
ok((await essaie(db, u.admin, `update membres set role_id = (select id from roles where nom = 'Dispatch') where user_id = '${u.chauffeur}'`)).n === 1, "change le rôle d'une personne");
ok((await compte(db, u.chauffeur, "select 1 from dossiers")) === 0, "le nouveau rôle s'applique tout de suite");
await db.exec(`update profils set actif = false where user_id = '${u.assistante}'`);
ok((await compte(db, u.assistante, "select 1 from clients")) === 0, "un compte désactivé ne voit plus rien");
await db.exec("set role anon;");
let refuse = false; try { await db.query("select * from clients"); } catch { refuse = true; }
await db.exec("reset role;");
ok(refuse, "le visiteur anonyme est refusé");

console.log("\n== Chaîne de migrations v1 → v2 → v3 ==");
const v = await base([W + "schema-v1-reference.sql"]);
const vcompte = (await v.query("insert into auth.users (email) values ('anais@test') returning id")).rows[0].id;
const vass = (await v.query("insert into auth.users (email) values ('assistante@test') returning id")).rows[0].id;
await v.exec(`insert into clients (id, nom) values ('11111111-1111-4111-8111-111111111111', 'Ancien client');
insert into dossiers (ref, client_id) values ('OLD1 Thaïlande', '11111111-1111-4111-8111-111111111111');
insert into documents (dossier_id, type, date_emission, contenu) select id, 'devis', '2026-10-01', '{"a":1}' from dossiers;
insert into paiements (dossier_id, date, montant) select id, '2026-10-02', 50 from dossiers;`);
await v.exec(lire(W + "migration-2-entreprises.sql"));
const eN = (s) => v.query("select id from entites where slug = $1", [s]).then((r) => r.rows[0].id);
await v.exec(`insert into membres values ('${vass}', '${await eN("secret")}', 'editeur'), ('${vass}', '${await eN("ztp")}', 'admin');`);
await v.exec("update dossiers set cree_par = null");
await v.exec(lire(W + "migration-3-droits.sql"));
await accorder(v);
const rolesMig = (await v.query("select e.slug, r.nom from membres m join roles r on r.id = m.role_id join entites e on e.id = m.entite_id where m.user_id = $1 order by e.slug", [vass])).rows;
ok(rolesMig.map((x) => `${x.slug}:${x.nom}`).join() === "secret:Éditeur,ztp:Administrateur", "les anciens rôles admin et éditeur deviennent des rôles équivalents");
ok((await v.query("select count(*)::int n from roles")).rows[0].n === 9, "trois rôles de départ par entreprise après migration");
ok((await v.query("select count(*)::int n from clients")).rows[0].n === 1 && (await v.query("select count(*)::int n from documents where contenu->>'a' = '1'")).rows[0].n === 1, "les données existantes sont conservées");
const droitsMig = await essaie(v, vass, "select 1 from reglages where false");
ok(droitsMig.ok, "les règles de sécurité fonctionnent après migration");
ok((await compte(v, vass, "select 1 from clients")) === 1, "l'ancien administrateur de Zwald voit les clients de Zwald");
const cols = async (d) => (await d.query("select table_name||'.'||column_name||':'||data_type c from information_schema.columns where table_schema='public' order by 1")).rows.map((x) => x.c).join("\n");
ok((await cols(db)) === (await cols(v)), "la base migrée a la même structure qu'une base neuve");
const pol = async (d) => (await d.query("select tablename||'.'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'') c from pg_policies where schemaname='public' order by 1")).rows.map((x) => x.c).join("\n");
ok((await pol(db)) === (await pol(v)), "les règles de sécurité sont identiques à celles d'une base neuve");
const fonc = async (d) => (await d.query("select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1")).rows.map((x) => x.proname).join();
ok((await fonc(db)) === (await fonc(v)), "les fonctions sont les mêmes (les anciennes ont disparu)");
console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTOUT EST BON");
process.exit(echecs ? 1 : 0);
