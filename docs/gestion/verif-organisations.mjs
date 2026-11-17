// Vérifie la migration 42 (plusieurs organisations) sur un Postgres en mémoire : aucune donnée d'une organisation n'est visible depuis une autre.
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-organisations.mjs . && GESTION_SQL=<repo>/docs/gestion/ node verif-organisations.mjs
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
// Une base qui a déjà servi : des numéros de fiduciaire et un suivi de rappels existent avant la migration 42.
const avant41 = migrations.filter((f) => parseInt(f.split("-")[1]) < 41);
for (const f of avant41) await db.exec(fs.readFileSync(W + f, "utf8"));
await db.exec("insert into fiduciaire_compteurs (prefixe, annee, type, dernier) values ('COM', 2026, 'facture', 7); insert into rappels_suivi (type) values ('veille');");
for (const f of migrations.filter((f) => !avant41.includes(f))) await db.exec(fs.readFileSync(W + f, "utf8"));
ok(migrations.at(-1) === "migration-42-organisations.sql", "la migration 42 est appliquée en dernier");
await db.exec(fs.readFileSync(W + "migration-42-organisations.sql", "utf8"));
ok(true, "la migration 42 se rejoue sans erreur");
// Droits des tables comme sur Supabase, puis les « revoke » et « grant » de la migration 42 rejoués.
await db.exec("grant all on all tables in schema public to authenticated; grant usage, select on all sequences in schema public to authenticated; revoke insert, update, delete on journal from authenticated;");
for (const l of fs.readFileSync(W + "migration-42-organisations.sql", "utf8").split("\n").filter((x) => /^(revoke|grant) .* on organisations /.test(x))) await db.exec(l);

const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const ZWALD = "00000000-0000-0000-0000-00000000a000";
const essaie = async (userId, sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
};
const nb = async (u, sql, p) => { const r = await essaie(u, sql, p); return r.ok ? r.rows.length : -1; };
// `meta` : métadonnée « utilisateur » (choisie par qui s'inscrit) ; `app` : métadonnée d'application (clé de service seulement).
const compte = async (email, meta = null, app = null) => (await un("insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3) returning id", [email, meta, app])).id;

console.log("== Reprise de la base existante ==");
ok((await un("select count(*)::int n from entites where organisation_id = $1", [ZWALD])).n === 3, "ZTP, Secret et Taxi sont dans l'organisation Zwald");
ok((await un("select count(*)::int n from profils where organisation_id is distinct from $1", [ZWALD])).n === 0, "tous les comptes existants sont dans Zwald");
ok((await un("select array_agg(slug order by slug) s from entites where publie_site")).s.join() === "secret,taxi", "Secret et Taxi publient toujours sur le site");
ok((await un("select dernier, organisation_id from fiduciaire_compteurs where annee = 2026")).organisation_id === ZWALD, "le compteur de fiduciaire existant passe à Zwald");
ok((await un("select count(*)::int n from rappels_suivi where organisation_id = $1", [ZWALD])).n === 1, "le suivi des rappels existant passe à Zwald");

console.log("== Comptes ==");
const anais = await compte("anais@test");
await db.exec(`update profils set super_admin = true, organisation_id = '${ZWALD}' where user_id = '${anais}'`);
ok((await un("select super_admin, organisation_id from profils where user_id = $1", [anais])).super_admin === true, "administratrice de Zwald");
const editeur = await compte("editeur@test");
await db.exec(`update profils set plateforme = true where user_id = '${editeur}'`);
const ajoute = await compte("nouvelle-assistante@test");
const pa = await un("select super_admin, organisation_id from profils where user_id = $1", [ajoute]);
ok((await un("select langue from profils where user_id = $1", [ajoute])).langue === "fr", "un compte ajouté chez Zwald démarre en français, la langue de Zwald");
ok(pa.super_admin === false && pa.organisation_id === ZWALD, "un compte ajouté à la main rejoint Zwald tant qu'elle est seule (il apparaît dans « Utilisateurs »)");
ok((await nb(anais, "select * from profils where user_id = $1", [ajoute])) === 1, "Anaïs voit ce compte pour lui donner ses accès");
const marc = await compte("marc@test", { nouvelle_organisation: true });
const p = await un("select super_admin, organisation_id from profils where user_id = $1", [marc]);
ok(p.super_admin === false && p.organisation_id === null, "un compte invité pour une nouvelle organisation n'est ni administrateur ni rattaché");
ok((await nb(marc, "select * from entites")) === 0, "un nouveau compte ne voit aucune entreprise");

console.log("== Création d'une organisation par l'éditeur ==");
const refus = await essaie(anais, "select creer_organisation('Agence B', 'marc@test')");
ok(!refus.ok, "l'administratrice de Zwald ne peut pas créer d'organisation");
const r = await essaie(editeur, "select creer_organisation('Agence B', 'marc@test', 'Europe/Zurich', 'en') as id");
ok(r.ok, "l'éditeur crée l'organisation B " + (r.err || ""));
const B = r.rows[0].id;
const invitee = await compte("invitee-b@test", null, { organisation_id: B });
ok((await un("select langue from profils where user_id = $1", [invitee])).langue === "en", "un compte invité par B démarre en anglais, la langue de B");
ok((await un("select super_admin, organisation_id from profils where user_id = $1", [marc])).organisation_id === B, "Marc devient administrateur de B");
ok(!(await essaie(editeur, "select creer_organisation('Autre', 'marc@test')")).ok, "un compte déjà rattaché ne change pas d'organisation");
ok((await nb(editeur, "select * from clients")) === 0 && (await nb(editeur, "select * from entites")) === 0, "l'éditeur ne voit aucune donnée des organisations");

console.log("== Isolation ==");
const cree = await essaie(marc, "insert into entites (slug, nom) values ('secret', 'Agence B') returning id, organisation_id");
ok(cree.ok && cree.rows[0].organisation_id === B, "Marc crée une entreprise dans B, même slug que chez Zwald " + (cree.err || ""));
const eB = cree.rows[0].id;
// Première entreprise d'un nouveau client, comme creerEntite dans l'outil : ses rôles de départ et ses réglages (modèle métier).
const roleCree = await essaie(marc, "insert into roles (entite_id, nom, permissions, systeme) values ($1, 'Administrateur', array['reglages.ecrire'], true) returning id", [eB]);
ok(roleCree.ok, "Marc crée les rôles de sa première entreprise " + (roleCree.err || ""));
const regl = await essaie(marc, `insert into reglages (entite_id, valeur) values ($1, '{"fonctionnement":"excursions","emetteur":{"nom":"Agence B"}}'::jsonb) on conflict (entite_id) do update set valeur = excluded.valeur returning entite_id`, [eB]);
ok(regl.ok, "Marc enregistre les réglages de sa première entreprise " + (regl.err || ""));
ok(!(await essaie(marc, `update reglages set valeur = '{}'::jsonb where entite_id = (select id from entites where slug = 'secret' and organisation_id = '${ZWALD}') returning entite_id`)).rows?.length, "Marc ne touche pas aux réglages de Secret");
ok(!(await essaie(marc, `insert into entites (slug, nom, organisation_id) values ('x', 'Pirate', '${ZWALD}')`)).ok, "Marc ne peut pas créer d'entreprise dans Zwald");
const ent = {};
for (const s of ["ztp", "secret", "taxi"]) ent[s] = (await un("select id from entites where slug = $1 and organisation_id = $2", [s, ZWALD])).id;
await db.exec(`insert into clients (entite_id, nom) values ('${ent.secret}', 'Client Zwald'), ('${eB}', 'Client B')`);
ok((await nb(anais, "select * from entites")) === 3, "Anaïs voit ses trois entreprises, pas celle de B");
ok((await nb(marc, "select * from entites")) === 1, "Marc ne voit que son entreprise");
const cA = await essaie(anais, "select nom from clients");
ok(cA.ok && cA.rows.map((x) => x.nom).join() === "Client Zwald", "Anaïs ne voit que les clients de Zwald");
const cB = await essaie(marc, "select nom from clients");
ok(cB.ok && cB.rows.map((x) => x.nom).join() === "Client B", "Marc ne voit que les clients de B");
ok((await essaie(marc, "select a_permission($1, 'clients.lire') v", [ent.secret])).rows[0].v === false, "Marc n'a aucun droit sur Secret de Zwald");
ok((await essaie(anais, "select a_permission($1, 'clients.lire') v", [eB])).rows[0].v === false, "Anaïs n'a aucun droit sur l'entreprise de B");
ok((await nb(marc, "select * from profils")) === 2, "Marc ne voit que les comptes de B (lui et l'invitée)");
ok((await nb(anais, "select * from profils where user_id = $1", [marc])) === 0, "Anaïs ne voit pas le compte de Marc");
const upd = await essaie(anais, "update profils set actif = false where user_id = $1", [marc]);
ok(upd.ok && upd.n === 0, "Anaïs ne peut pas désactiver un compte de B");
ok(!(await essaie(marc, `update profils set organisation_id = '${ZWALD}' where user_id = '${marc}'`)).ok, "Marc ne peut pas changer son organisation");
ok(!(await essaie(marc, `update profils set plateforme = true where user_id = '${marc}'`)).ok, "Marc ne peut pas devenir éditeur");
ok(!(await essaie(marc, `select set_config('gestion.interne', '1', false); update profils set plateforme = true where user_id = '${marc}'`)).ok, "ni en posant un drapeau de session");
const enAttente = await compte("attente@test", { nouvelle_organisation: true });
ok((await nb(marc, "select * from organisations")) === 1 && (await nb(anais, "select * from organisations")) === 1, "chacun ne voit que son organisation");
const opt = await essaie(marc, `update organisations set options = array['assistant'] where id = '${B}'`);
ok(!opt.ok, "Marc ne peut pas s'offrir une option payante");
ok((await essaie(marc, `update organisations set fuseau = 'Europe/Paris' where id = '${B}'`)).ok, "Marc règle le fuseau de son organisation");

console.log("== Accès ==");
const roleB = (await un("insert into roles (entite_id, nom, permissions) values ($1, 'Assistante', array['clients.lire']) returning id", [eB])).id;
const roleZ = (await un("select id from roles where entite_id = $1 limit 1", [ent.secret])).id;
const julie = await compte("julie@test");
ok((await un("select organisation_id from profils where user_id = $1", [julie])).organisation_id === null, "avec deux organisations, un compte sans invitation n'est rattaché à aucune");
const invite = await compte("invite@test", null, { organisation_id: B });
ok((await un("select organisation_id from profils where user_id = $1", [invite])).organisation_id === B, "un compte créé par la clé de service pour B rejoint B");
const intrus = await compte("intrus@test", { organisation_id: B });
ok((await un("select organisation_id from profils where user_id = $1", [intrus])).organisation_id === null, "une inscription qui annonce elle-même l'organisation B n'y entre pas");
const lien = await essaie(marc, "insert into membres (user_id, entite_id, role_id) values ($1, $2, $3)", [julie, eB, roleB]);
ok(lien.ok, "Marc donne un accès à un compte neuf " + (lien.err || ""));
ok((await un("select organisation_id from profils where user_id = $1", [julie])).organisation_id === B, "le compte neuf est rattaché à B");
ok(!(await essaie(anais, "insert into membres (user_id, entite_id, role_id) values ($1, $2, $3)", [julie, ent.secret, roleZ])).ok, "Anaïs ne peut pas donner d'accès Zwald à un compte de B");
ok(!(await essaie(marc, "insert into membres (user_id, entite_id, role_id) values ($1, $2, $3)", [julie, ent.secret, roleZ])).ok, "Marc ne peut pas ouvrir Secret de Zwald");
ok(!(await essaie(marc, "insert into membres (user_id, entite_id, role_id) values ($1, $2, $3)", [julie, eB, roleZ])).ok, "un rôle d'une autre entreprise est refusé");
ok((await nb(julie, "select * from clients")) === 1, "Julie voit le client de B");
ok((await essaie(julie, "select a_permission($1, 'partenaires.prix') v", [eB])).rows[0].v === false, "sans « tous droits », Julie n'a que les droits de son rôle");
await db.exec(`update roles set tous_droits = true where id = '${roleB}'`);
ok((await essaie(julie, "select a_permission($1, 'partenaires.prix') v", [eB])).rows[0].v === true, "rôle « tous droits » (migration 38) : Julie a toutes les permissions");
await db.exec(`update roles set tous_droits = false where id = '${roleB}'`);
ok(!(await essaie(marc, "insert into membres (user_id, entite_id, role_id) values ($1, $2, $3)", [enAttente, eB, roleB])).ok, "Marc ne peut pas prendre un compte qui attend sa propre organisation");
ok((await un("select organisation_id from profils where user_id = $1", [enAttente])).organisation_id === null, "ce compte reste libre");
const eq = await essaie(marc, "select * from equipe_de($1)", [eB]);
ok(eq.ok && eq.rows.length === 2, "l'équipe de B compte Marc et Julie, pas Anaïs");

console.log("== Fiduciaire ==");
const num = async (u) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${u}', false);`);
  return (await un("select o_numero from fiduciaire_prochain_numero('facture', '2026-11-17', 'COM')")).o_numero;
};
ok((await num(anais)) === "COM-2026-008", "Zwald continue sa numérotation");
ok((await num(marc)) === "COM-2026-001", "B commence sa propre numérotation");
ok((await num(anais)) === "COM-2026-009", "Zwald garde sa série même quand B émet");
ok((await un("select count(*)::int n from fiduciaire_compteurs where prefixe = 'COM' and annee = 2026")).n === 2, "deux séries COM 2026, une par organisation");
await db.exec(`select set_config('request.jwt.claim.sub', '${julie}', false);`);
ok((await un("select o_numero from fiduciaire_prochain_numero('facture', '2026-11-17', 'COM')")).o_numero === "COM-2026-002", "Julie (membre de B) suit la série de B");
await db.exec(`select set_config('request.jwt.claim.sub', '${enAttente}', false);`);
let err = "";
try { await db.query("select fiduciaire_prochain_numero('facture', '2026-11-17', 'COM')"); } catch (e) { err = e.message; }
ok(/sans organisation/.test(err), "un compte sans organisation ne tire aucun numéro");
await db.exec(`select set_config('request.jwt.claim.sub', '', false);`);

console.log("== Journal des comptes ==");
await db.exec(`insert into journal (entite_id, organisation_id, table_name, action, cible, libelle) values (null, '${ZWALD}', 'comptes', 'invite', 'x', 'zwald'), (null, '${B}', 'comptes', 'invite', 'y', 'b')`);
const jA = await essaie(anais, "select libelle from journal where entite_id is null and table_name = 'comptes'");
ok(jA.ok && jA.rows.map((x) => x.libelle).join() === "zwald", "Anaïs lit le journal des comptes de Zwald, pas celui de B");
const jJ = await essaie(julie, "select libelle from journal where entite_id is null");
ok(jJ.ok && jJ.rows.length === 0, "un membre qui n'est pas administrateur ne lit pas le journal des comptes");

console.log("== Suivi des rappels ==");
await db.exec(`insert into rappels_suivi (type, organisation_id) values ('veille', '${B}')`);
let sansOrg = "";
try { await db.exec("insert into rappels_suivi (type) values ('veille')"); } catch (e) { sansOrg = e.message; }
ok(/null/.test(sansOrg), "une ligne de suivi sans organisation est refusée, plus rangée chez Zwald");
ok((await nb(anais, "select * from rappels_suivi")) === 1 && (await nb(marc, "select * from rappels_suivi")) === 1, "chacun ne voit que le suivi de ses rappels");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
