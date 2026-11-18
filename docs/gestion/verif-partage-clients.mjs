// Vérifie la migration 46 (fiches clients partagées) sur un Postgres en mémoire : schéma, données de Zwald, toutes les migrations.
// Ce que la base garantit, quel que soit l'écran :
//   * l'administration utilise une fiche ZTP dans un dossier de Secret ou de Taxi, sans copie ;
//   * l'assistante de Secret et de Taxi (rôles de Mook en production) ne lit aucune fiche ZTP, seulement le nom de ses clients de dossiers ;
//   * ZTP ne lit ni n'utilise aucune fiche de Secret ou de Taxi ;
//   * rien ne passe d'une organisation à l'autre ; le retour en arrière remet la clé d'avant.
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-partage-clients.mjs . && GESTION_SQL=<repo>/docs/gestion/ node verif-partage-clients.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
let echecs = 0;
const ok = (c, msg) => { if (!c) { echecs++; console.log("  ECHEC:", msg); } else console.log("  ok:", msg); };
const harnais = `
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now(), raw_user_meta_data jsonb, raw_app_meta_data jsonb, last_sign_in_at timestamptz);
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
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[789]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
const avant46 = migrations.filter((f) => parseInt(f.split("-")[1]) < 46);
for (const f of avant46) await db.exec(lire(f));
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const Z = (await un("select id from entites where slug = 'ztp'")).id;
const S = (await un("select id from entites where slug = 'secret'")).id;
const T = (await un("select id from entites where slug = 'taxi'")).id;
const ZWALD = "00000000-0000-0000-0000-00000000a000";

// Une base qui a déjà servi : une fiche ZTP, une fiche Secret en double de la même personne, avec un dossier, avant la migration.
const avant = async (e, nom, tel) => (await un("insert into clients (entite_id, prenom, nom, telephone) values ($1, 'Jane', $2, $3) returning id", [e, nom, tel])).id;
const ztpAncien = await avant(Z, "Example", "+41 79 123 45 67");
const secretAncien = await avant(S, "Example", "");
await db.query("insert into dossiers (entite_id, ref, client_id) values ($1, 'ST-ANCIEN', $2)", [S, secretAncien]);

await db.exec(lire("migration-46-partage-clients.sql"));
await db.exec(lire("migration-46-partage-clients.sql"));
ok(true, "la migration 46 s'applique sur une base qui a servi, et se rejoue");
// Droits des tables comme sur Supabase, puis les « revoke » et « grant » des migrations 42 et 46 rejoués.
await db.exec("grant all on all tables in schema public to authenticated; grant usage, select on all sequences in schema public to authenticated; revoke insert, update, delete on journal from authenticated;");
for (const f of ["migration-42-organisations.sql", "migration-46-partage-clients.sql"])
  for (const l of lire(f).split("\n").filter((x) => /^(revoke|grant) .* on (organisations|partages_clients) /.test(x))) await db.exec(l);

console.log("== Réglage de Zwald ==");
const partages = (await db.query("select s.slug || '>' || c.slug as p from partages_clients x join entites s on s.id = x.source_id join entites c on c.id = x.cible_id order by 1")).rows.map((r) => r.p);
ok(partages.join() === "ztp>secret,ztp>taxi", "ZTP partage ses clients avec Secret et Taxi, et rien d'autre : " + partages.join());
ok((await un("select count(*)::int n from dossiers where ref = 'ST-ANCIEN'")).n === 1, "les dossiers d'avant gardent leur client");
const fk = (await db.query("select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'dossiers'::regclass and contype = 'f' and pg_get_constraintdef(oid) like '%clients%'")).rows.map((r) => r.d);
ok(fk.length === 1 && /FOREIGN KEY \(client_id\) REFERENCES clients\(id\) ON DELETE RESTRICT/.test(fk[0]), "une seule clé vers les clients, sur l'identifiant, on delete restrict");

// Comptes : comme en production (relevé du 18.11.2026) ; plus un employé de ZTP seul, une administratrice de Secret seule.
const essaie = async (userId, sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
};
const compte = async (email) => (await un("insert into auth.users (email) values ($1) returning id", [email])).id;
const anais = await compte("anais@test");
const mook = await compte("mook@test");
const ztpSeul = await compte("ztp-seul@test");
const adminSecret = await compte("admin-secret@test");
await db.exec(`update profils set super_admin = true, organisation_id = '${ZWALD}' where user_id = '${anais}'`);
const role = async (e, nom, portee, perms) => (await un("insert into roles (entite_id, nom, portee, permissions) values ($1, $2, $3, $4) returning id", [e, nom, portee, perms])).id;
const EDITEUR = ["catalogue.ecrire", "clients.ecrire", "clients.lire", "documents.ecrire", "dossiers.ecrire", "dossiers.lire", "fiduciaire.preparer", "finances.voir", "partenaires.ecrire", "partenaires.lire", "taches.ecrire"];
const VOUCHERS = ["clients.ecrire", "clients.lire", "documents.ecrire", "dossiers.ecrire", "dossiers.lire", "fiduciaire.preparer", "finances.voir", "partenaires.lire", "vouchers.seul"];
const membre = (u, e, r) => db.query("insert into membres (user_id, entite_id, role_id) values ($1, $2, $3)", [u, e, r]);
await membre(mook, S, await role(S, "Éditeur + factures fiduciaire (test)", "toute", EDITEUR));
await membre(mook, T, await role(T, "Vouchers et factures fiduciaire (test)", "toute", VOUCHERS));
await membre(ztpSeul, Z, await role(Z, "Éditeur (test)", "toute", EDITEUR));
await membre(adminSecret, S, (await un("select id from roles where entite_id = $1 and nom = 'Administrateur'", [S])).id);

console.log("== L'administration utilise une fiche ZTP dans Secret et Taxi ==");
const nouveau = async (u, e, nom, tel = "", email = "") => {
  const r = await essaie(u, "insert into clients (entite_id, prenom, nom, telephone, email) values ($1, 'Alex', $2, $3, $4) returning id", [e, nom, tel, email]);
  if (!r.ok) throw new Error(r.err);
  return r.rows[0].id;
};
const ztp = await nouveau(anais, Z, "Martin", "+41 79 000 00 01", "alex@example.test");
const secretClient = await nouveau(anais, S, "Lee", "+66 80 000 0001");
const taxiClient = await nouveau(anais, T, "Brown", "+66 80 000 0002");
let n = 0;
const dossier = (u, e, c, extra = {}) => essaie(u, "insert into dossiers (entite_id, ref, client_id, notes) values ($1, $2, $3, $4) returning id", [e, `T-${++n}`, c, extra.notes || ""]);
const dS = await dossier(anais, S, ztp);
ok(dS.ok, "Anaïs crée un dossier Secret au client ZTP " + (dS.err || ""));
const dT = await dossier(anais, T, ztp);
ok(dT.ok, "Anaïs crée un dossier Taxi au client ZTP " + (dT.err || ""));
const dZ = await dossier(anais, Z, ztp);
const idS = dS.rows[0].id;
ok((await un("select entite_id from dossiers where id = $1", [idS])).entite_id === S, "le dossier au client ZTP reste un dossier de Secret");
ok((await un("select entite_id from clients where id = $1", [ztp])).entite_id === Z, "la fiche reste celle de ZTP (aucune copie)");
ok((await un("select count(*)::int n from clients where nom = 'Martin'")).n === 1, "une seule fiche pour cette personne");
const maj = await essaie(anais, "update clients set telephone = '+41 79 999 99 99' where id = $1", [ztp]);
ok(maj.ok && maj.n === 1, "Anaïs change le WhatsApp depuis Secret : c'est la fiche ZTP qui change");
ok((await un("select c.telephone from dossiers d join clients c on c.id = d.client_id where d.id = $1", [dT.rows[0].id])).telephone === "+41 79 999 99 99", "le dossier Taxi voit le nouveau WhatsApp");
const lusAnais = await essaie(anais, "select d.ref, e.slug from dossiers d join entites e on e.id = d.entite_id where d.client_id = $1 order by e.slug", [ztp]);
ok(lusAnais.ok && lusAnais.rows.map((r) => r.slug).join() === "secret,taxi,ztp", "depuis la fiche ZTP, Anaïs lit ses dossiers Secret, Taxi et ZTP");

console.log("== Mook : aucune fiche ZTP ==");
const mClients = await essaie(mook, "select id, entite_id from clients");
ok(mClients.ok && !mClients.rows.some((c) => c.entite_id === Z), "Mook ne lit aucune fiche ZTP dans la liste des clients");
ok((await essaie(mook, "select * from clients where id = $1", [ztp])).rows.length === 0, "ni en la demandant par son identifiant");
ok((await essaie(mook, "select * from clients where telephone like '+41%' or nom = 'Martin'")).rows.length === 0, "ni par une recherche");
ok((await essaie(mook, "select c.* from dossiers d join clients c on c.id = d.client_id where d.id = $1", [idS])).rows.length === 0, "ni par la jointure de son dossier Secret");
const mDossier = await essaie(mook, "select id, client_id from dossiers where id = $1", [idS]);
ok(mDossier.ok && mDossier.rows.length === 1, "Mook ouvre le dossier Secret au client ZTP");
const lies = await essaie(mook, "select * from clients_lies()");
ok(lies.ok && lies.rows.length === 1 && lies.rows[0].id === ztp && lies.rows[0].nom === "Martin" && lies.rows[0].prenom === "Alex", "clients_lies() lui donne le nom du client de ce dossier, pour le voucher");
ok(lies.ok && Object.keys(lies.rows[0] || {}).sort().join() === "civilite,entite_id,id,nom,prenom", "et rien d'autre : ni WhatsApp, ni e-mail, ni adresse, ni notes");
ok((await essaie(ztpSeul, "select * from clients_lies()")).rows.length === 0, "un compte de ZTP seul ne reçoit aucun nom de Secret ou de Taxi par clients_lies()");
const mUpd = await essaie(mook, "update clients set telephone = '0' where id = $1", [ztp]);
ok(mUpd.ok && mUpd.n === 0, "Mook ne modifie pas la fiche ZTP");
const mDel = await essaie(mook, "delete from clients where id = $1", [ztp]);
ok(mDel.ok && mDel.n === 0, "Mook ne supprime pas la fiche ZTP");
const mIns = await dossier(mook, S, ztp);
ok(!mIns.ok && /administration/.test(mIns.err), "Mook ne crée pas de dossier Secret au client ZTP (identifiant connu)");
ok(!(await dossier(mook, T, ztp)).ok, "ni de dossier Taxi");
const mNote = await essaie(mook, "update dossiers set notes = 'Pick-up 9:00', client_id = client_id where id = $1", [idS]);
ok(mNote.ok && mNote.n === 1, "Mook modifie le dossier Secret au client ZTP (le lien reste)");
const sienD = await dossier(mook, S, secretClient);
const mRelie = await essaie(mook, "update dossiers set client_id = $2 where id = $1", [sienD.rows[0].id, ztp]);
ok(!mRelie.ok, "Mook ne relie pas un de ses dossiers au client ZTP");
ok(!(await essaie(mook, "select fusionner_clients($1, $2)", [ztp, secretClient])).ok, "Mook ne rattache pas une fiche Secret à une fiche ZTP");
ok(!(await essaie(mook, "insert into partages_clients (source_id, cible_id) values ($1, $2)", [S, Z])).ok, "Mook ne crée aucun partage");
ok(!(await essaie(mook, "delete from partages_clients")).n, "ni n'en retire");

console.log("== Sens unique : ZTP ne lit ni n'utilise les fiches de Secret et de Taxi ==");
const zClients = await essaie(ztpSeul, "select entite_id from clients");
ok(zClients.ok && zClients.rows.length > 0 && zClients.rows.every((c) => c.entite_id === Z), "un compte de ZTP ne lit que les fiches ZTP");
ok((await essaie(ztpSeul, "select * from clients where id in ($1, $2)", [secretClient, taxiClient])).rows.length === 0, "aucune fiche Secret ou Taxi, même par identifiant");
ok((await essaie(ztpSeul, "select * from dossiers where entite_id <> $1", [Z])).rows.length === 0, "aucun dossier Secret ou Taxi (même au client ZTP)");
const inverse = await dossier(anais, Z, secretClient);
ok(!inverse.ok && /ne partage pas/.test(inverse.err), "même l'administration ne met pas une fiche Secret dans un dossier ZTP");
ok(!(await dossier(anais, Z, taxiClient)).ok, "ni une fiche Taxi");
ok(!(await dossier(anais, T, secretClient)).ok, "ni une fiche Secret dans un dossier Taxi (pas de partage Secret vers Taxi)");
let sansConnexion = true;
try { await db.query("insert into dossiers (entite_id, ref, client_id) values ($1, 'X-SQL', $2)", [Z, secretClient]); } catch { sansConnexion = false; }
ok(!sansConnexion, "même sans connexion (éditeur SQL), le sens inverse est refusé");
ok(!(await essaie(ztpSeul, "insert into partages_clients (source_id, cible_id) values ($1, $2)", [S, Z])).ok, "un compte de ZTP ne crée pas le partage inverse");
const ziUpd = await essaie(anais, "update dossiers set client_id = $2 where id = $1", [dZ.rows[0].id, secretClient]);
ok(!ziUpd.ok, "ni en changeant le client d'un dossier ZTP");

console.log("== Qui utilise les fiches partagées ==");
ok((await essaie(adminSecret, "select * from clients where entite_id = $1", [Z])).rows.length === 0, "l'administratrice de Secret seule ne lit aucune fiche ZTP");
ok(!(await dossier(adminSecret, S, ztp)).ok, "et ne relie aucun dossier à une fiche ZTP");
ok(!(await dossier(ztpSeul, S, ztp)).ok, "un compte de ZTP seul ne crée rien dans Secret");
ok((await essaie(anais, "select partage_clients_permis($1, $2) p", [Z, S])).rows[0].p === true, "partage_clients_permis : vrai pour l'administration générale");
ok((await essaie(mook, "select partage_clients_permis($1, $2) p", [Z, S])).rows[0].p === false, "faux pour Mook");

console.log("== Une fiche partagée ne se déplace pas, ne disparaît pas ==");
const dep = await essaie(anais, "update clients set entite_id = $2 where id = $1", [ztp, S]);
ok(!dep.ok && /dossiers/.test(dep.err), "la fiche ZTP avec des dossiers ne change pas d'entreprise (import de sauvegarde)");
const sup = await essaie(anais, "delete from clients where id = $1", [ztp]);
ok(!sup.ok, "la fiche ZTP avec des dossiers Secret ne se supprime pas");

console.log("== Partage retiré : les dossiers déjà reliés restent ==");
await db.query("delete from partages_clients where source_id = $1 and cible_id = $2", [Z, T]);
ok((await essaie(anais, "update dossiers set notes = 'ok' where id = $1", [dT.rows[0].id])).n === 1, "le dossier Taxi au client ZTP se modifie encore");
ok(!(await dossier(anais, T, ztp)).ok, "mais aucun nouveau dossier Taxi ne prend une fiche ZTP");
const remis = await essaie(anais, "insert into partages_clients (source_id, cible_id, organisation_id) values ($1, $2, gen_random_uuid()) returning organisation_id", [Z, T]);
ok(remis.ok && remis.rows[0].organisation_id === ZWALD, "l'administration générale remet le partage ; l'organisation envoyée n'est pas crue");
ok(!(await essaie(ztpSeul, "delete from partages_clients")).n, "un compte sans administration générale ne retire aucun partage");

console.log("== Corbeille : un dossier Secret au client ZTP se restaure ==");
const aRestaurer = (await dossier(anais, S, ztp)).rows[0].id;
await db.query("delete from partages_clients where source_id = $1 and cible_id = $2", [Z, S]);
const supprime = await essaie(anais, "delete from dossiers where id = $1", [aRestaurer]);
const enCorbeille = await un("select id from corbeille where table_name = 'dossiers' and ligne->>'id' = $1", [aRestaurer]);
ok(supprime.ok && !!enCorbeille, "le dossier supprimé part dans la corbeille");
const restaure = await essaie(anais, "select restaurer_dossier($1) as id", [enCorbeille.id]);
ok(restaure.ok && (await un("select client_id from dossiers where id = $1", [aRestaurer])).client_id === ztp, "il se restaure avec sa fiche ZTP, même partage retiré " + (restaure.err || ""));
await db.query("insert into partages_clients (source_id, cible_id) values ($1, $2)", [Z, S]);
const seulEnCorbeille = await nouveau(anais, S, "Corbeille");
const dC = (await dossier(anais, S, seulEnCorbeille)).rows[0].id;
await essaie(anais, "delete from dossiers where id = $1", [dC]);
const deplace = await essaie(anais, "update clients set entite_id = $2 where id = $1", [seulEnCorbeille, Z]);
ok(!deplace.ok, "une fiche dont le seul dossier est dans la corbeille ne change pas d'entreprise (la restauration recréerait un lien sans partage)");
const faux = await essaie(mook, "insert into dossiers (id, entite_id, ref, client_id) values (gen_random_uuid(), $1, 'X-FAUX', $2)", [S, ztp]);
ok(!faux.ok, "un dossier neuf (absent de la corbeille) au client ZTP reste refusé à Mook");

console.log("== Organisations ==");
const orgB = (await un("insert into organisations (nom) values ('Agence B') returning id")).id;
const B = (await un("insert into entites (slug, nom, organisation_id) values ('b', 'B', $1) returning id", [orgB])).id;
const clientB = (await un("insert into clients (entite_id, nom) values ($1, 'Bclient') returning id", [B])).id;
ok(!(await essaie(anais, "insert into partages_clients (source_id, cible_id) values ($1, $2)", [Z, B])).ok, "Anaïs ne partage rien avec une entreprise d'une autre organisation");
let entreOrg = true;
try { await db.query("insert into partages_clients (source_id, cible_id) values ($1, $2)", [B, S]); } catch { entreOrg = false; }
ok(!entreOrg, "même sans connexion, deux organisations ne partagent rien");
ok(!(await dossier(anais, S, clientB)).ok, "un client d'une autre organisation n'entre dans aucun dossier");
ok((await essaie(anais, "select * from partages_clients")).rows.length === 2, "Anaïs ne voit que les partages de son organisation");

console.log("== Doublons d'avant le partage : rattacher la fiche Secret à la fiche ZTP ==");
const nS = (await un("select count(*)::int n from clients where entite_id = $1", [S])).n;
const r1 = await essaie(mook, "select fusionner_clients($1, $2)", [ztpAncien, secretAncien]);
ok(!r1.ok, "Mook ne peut pas rattacher");
const r2 = await essaie(anais, "select fusionner_clients($1, $2)", [secretAncien, ztpAncien]);
ok(!r2.ok, "une fiche ZTP ne disparaît jamais dans Secret");
const r3 = await essaie(anais, "select fusionner_clients($1, $2) as id", [ztpAncien, secretAncien]);
ok(r3.ok && r3.rows[0].id === ztpAncien, "Anaïs rattache la fiche Secret en double à la fiche ZTP " + (r3.err || ""));
const anc = await un("select d.entite_id, d.client_id from dossiers d where ref = 'ST-ANCIEN'");
ok(anc.entite_id === S && anc.client_id === ztpAncien, "le dossier Secret reste dans Secret et pointe vers la fiche ZTP");
ok(!(await un("select id from clients where id = $1", [secretAncien])), "la fiche en double a disparu");
ok((await un("select count(*)::int n from clients where entite_id = $1", [S])).n === nS - 1, "Secret compte une fiche de moins, ZTP aucune de plus");
ok((await un("select telephone from clients where id = $1", [ztpAncien])).telephone === "+41 79 123 45 67", "la fiche ZTP garde son WhatsApp");
const dbl = await un("insert into clients (entite_id, prenom, nom, email) values ($1, 'Kim', 'Doe', 'kim@example.test') returning id", [T]);
await db.query("insert into dossiers (entite_id, ref, client_id) values ($1, 'VT-1', $2)", [T, dbl.id]);
const kimZ = (await un("insert into clients (entite_id, prenom, nom) values ($1, 'Kim', 'Doe') returning id", [Z])).id;
await db.query("select fusionner_clients($1, $2)", [kimZ, dbl.id]);
ok((await un("select email from clients where id = $1", [kimZ])).email === "kim@example.test" && (await un("select client_id from dossiers where ref = 'VT-1'")).client_id === kimZ, "dans l'éditeur SQL (sans connexion) : rattachement Taxi vers ZTP, e-mail repris");
let sqlInverse = true;
try { await db.query("select fusionner_clients($1, $2)", [secretClient, ztp]); } catch { sqlInverse = false; }
ok(!sqlInverse, "même sans connexion, jamais une fiche ZTP absorbée par Secret");

console.log("== Statistiques : un dossier Secret au client ZTP compte dans Secret ==");
const st = await essaie(anais, "select count(*)::int n, count(distinct client_id)::int c from dossiers where entite_id = $1", [S]);
ok(st.ok && st.rows[0].n >= 3, "les dossiers Secret se comptent dans Secret");
ok((await un("select count(*)::int n from clients where entite_id = $1 and nom = 'Martin'", [S])).n === 0, "et la fiche ZTP ne s'ajoute pas aux fiches de Secret");

console.log("== Retour en arrière ==");
let retourBloque = false;
try { await db.exec(lire("retour-46-partage-clients.sql")); } catch (e) { retourBloque = /Retour impossible/.test(e.message); }
ok(retourBloque, "le retour refuse tant que des dossiers utilisent une fiche d'une autre entreprise");
await db.exec("rollback;").catch(() => {});
ok((await un("select count(*)::int n from partages_clients")).n === 2, "et ne touche à rien");
await db.exec("delete from dossiers d using clients c where c.id = d.client_id and c.entite_id <> d.entite_id");
await db.exec(lire("retour-46-partage-clients.sql"));
const fk2 = (await db.query("select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'dossiers'::regclass and contype = 'f' and pg_get_constraintdef(oid) like '%clients%'")).rows.map((r) => r.d);
ok(fk2.length === 1 && /\(client_id, entite_id\)/.test(fk2[0]), "le retour remet la clé à deux colonnes");
ok(!(await un("select to_regclass('public.partages_clients') t")).t, "et retire la table des partages");
let apresRetour = true;
try { await db.query("insert into dossiers (entite_id, ref, client_id) values ($1, 'X-RET', $2)", [S, ztp]); } catch { apresRetour = false; }
ok(!apresRetour, "après le retour, un dossier Secret ne prend plus de fiche ZTP");
await db.exec(lire("migration-46-partage-clients.sql"));
ok((await un("select count(*)::int n from partages_clients")).n === 2, "la migration 46 se réapplique après le retour");

console.log(echecs ? `${echecs} échec(s)` : "Tout est bon.");
process.exit(echecs ? 1 : 0);
