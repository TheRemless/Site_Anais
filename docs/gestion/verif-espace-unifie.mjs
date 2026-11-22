// Vérifie la migration 63 (espace unifié Secret et Taxi) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// Fiches clients partagées dans les deux sens (Mook dans ses droits), ZTP inchangé, WhatsApp commun en lecture, dossiers liés, doublons.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-espace-unifie.mjs
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
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
for (const f of migrations) await db.exec(lire(f));
ok(migrations.includes("migration-63-espace-unifie.sql"), "la migration 63 passe après les autres");
await db.exec(lire("migration-63-espace-unifie.sql"));
ok(true, "la migration 63 se rejoue sans erreur (idempotente)");

async function essaie(userId, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}

const ent = {};
for (const sl of ["ztp", "secret", "taxi"]) ent[sl] = (await db.query("select id from entites where slug = $1", [sl])).rows[0]?.id;
const ORG = (await db.query("select organisation_id from entites where id = $1", [ent.secret])).rows[0].organisation_id;
const partages = (await db.query("select s.slug || '>' || c.slug p from partages_clients x join entites s on s.id = x.source_id join entites c on c.id = x.cible_id order by 1")).rows.map((r) => r.p);
ok(partages.join() === "secret>taxi,taxi>secret,ztp>secret,ztp>taxi", "Secret et Taxi partagent leurs fiches dans les deux sens, ZTP reste à sens unique : " + partages.join());

const u = {};
for (const k of ["adminSecret", "adminTaxi", "mook", "taxiSeul", "ztp"]) u[k] = (await db.query("insert into auth.users (email) values ($1) returning id", [k + "@test"])).rows[0].id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
const perms = "array['dossiers.lire', 'dossiers.ecrire', 'clients.lire', 'clients.ecrire', 'documents.ecrire']";
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Éditeur test', 'toute', ${perms}), ('${ent.taxi}', 'Éditeur test', 'toute', ${perms}), ('${ent.taxi}', 'Taxi sans clients', 'toute', array['dossiers.lire', 'dossiers.ecrire'])`);
const membre = (user, entite, role) => db.exec(`insert into membres values ('${u[user]}', '${entite}', (select id from roles where entite_id = '${entite}' and nom = '${role}')) on conflict do nothing`);
await membre("adminSecret", ent.secret, "Administrateur");
await membre("adminTaxi", ent.taxi, "Administrateur");
await membre("mook", ent.secret, "Éditeur test");
await membre("mook", ent.taxi, "Éditeur test");
await membre("taxiSeul", ent.taxi, "Taxi sans clients");
if (ent.ztp) await membre("ztp", ent.ztp, "Administrateur");

const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];

// 1. Fiches partagées.
const cS = (await un("insert into clients (entite_id, prenom, nom, telephone) values ($1, 'Anna', 'Keller', '+41 79 000 00 02') returning id", [ent.secret])).id;
const cT = (await un("insert into clients (entite_id, prenom, nom, telephone) values ($1, 'Anna', 'Keller', '079 000 00 02') returning id", [ent.taxi])).id;
const cZ = ent.ztp ? (await un("insert into clients (entite_id, prenom, nom) values ($1, 'Zoé', 'Ztp') returning id", [ent.ztp])).id : null;
let r = await essaie(u.mook, `insert into dossiers (entite_id, ref, client_id) values ('${ent.taxi}', 'T-63', '${cS}') returning id`);
ok(r.ok, "Mook crée un dossier Taxi pour une fiche Secret (partage réciproque, dans ses droits)" + (r.ok ? "" : ` (${r.err})`));
const dT = r.ok ? r.rows[0].id : null;
r = await essaie(u.mook, `insert into dossiers (entite_id, ref, client_id) values ('${ent.secret}', 'S-63', '${cT}') returning id`);
ok(r.ok, "et un dossier Secret pour une fiche Taxi" + (r.ok ? "" : ` (${r.err})`));
const dS = r.ok ? r.rows[0].id : null;
r = await essaie(u.taxiSeul, `insert into dossiers (entite_id, ref, client_id) values ('${ent.taxi}', 'T-64', '${cS}') returning id`);
ok(!r.ok, "sans le droit de lire les clients de Secret, impossible d'utiliser une fiche Secret");
r = await essaie(u.taxiSeul, `select count(*)::int n from clients where id = '${cS}'`);
ok(r.ok && r.rows[0].n === 0, "la lecture d'une fiche demande toujours le droit dans son entreprise");
if (cZ) {
  r = await essaie(u.mook, `insert into dossiers (entite_id, ref, client_id) values ('${ent.secret}', 'S-65', '${cZ}') returning id`);
  ok(!r.ok, "ZTP reste à sens unique et réservé à l'administration");
  r = await essaie(u.adminSecret, `insert into dossiers (entite_id, ref, client_id) values ('${ent.ztp}', 'Z-1', '${cS}') returning id`);
  ok(!r.ok, "jamais une fiche Secret dans un dossier ZTP");
}

// 2. Dossiers liés.
r = await essaie(u.mook, `update dossiers set dossier_lie_id = '${dT}' where id = '${dS}'`);
ok(r.ok && r.n === 1, "Mook lie le dossier Secret au dossier Taxi" + (r.ok ? "" : ` (${r.err})`));
r = await essaie(u.mook, `update dossiers set dossier_lie_id = '${dS}' where id = '${dT}'`);
ok(r.ok && r.n === 1, "et le dossier Taxi au dossier Secret");
const dS2 = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, 'S-66', $2) returning id", [ent.secret, cS])).id;
r = await essaie(u.mook, `update dossiers set dossier_lie_id = '${dS2}' where id = '${dS}'`);
ok(!r.ok, "un dossier ne se lie pas à un dossier de la même entreprise");
r = await essaie(u.taxiSeul, `update dossiers set dossier_lie_id = '${dS2}' where id = '${dT}'`);
ok(!r.ok || r.n === 0, "sans accès au dossier Secret, pas de lien");
if (ent.ztp) {
  const dZ = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, 'Z-2', $2) returning id", [ent.ztp, cZ])).id;
  r = await essaie(u.mook, `update dossiers set dossier_lie_id = '${dZ}' where id = '${dS}'`);
  ok(!r.ok, "Mook ne lie pas un dossier à un dossier ZTP qu'elle ne voit pas");
}

// 3. WhatsApp commun en lecture, écritures inchangées.
const msg = (o) => JSON.stringify({ evenement_id: "e1", telnyx_id: "tx-1", meta_id: "wamid.1", sens: "entrant", origine: "client", type: "text", texte: "Taxi please", medias: [], envoye_le: "2026-11-20T09:00:00Z", ...o });
const rg = (await db.query("select whatsapp_ranger($1, '+66812345678', null, $2::jsonb) r", [ORG, msg({})])).rows[0].r;
await db.exec(`update whatsapp_conversations set entite_id = '${ent.taxi}' where id = '${rg.conversation_id}'`);
r = await essaie(u.adminSecret, `select count(*)::int n from whatsapp_messages where conversation_id = '${rg.conversation_id}'`);
ok(r.ok && r.rows[0].n === 1, "l'administrateur de Secret lit une conversation rangée chez Taxi (espace commun)");
r = await essaie(u.adminSecret, `update whatsapp_conversations set non_lus = 0, entite_id = '${ent.secret}' where id = '${rg.conversation_id}'`);
ok(!r.ok || r.n === 0, "mais il ne la déplace pas chez Secret sans être administrateur de Taxi");
r = await essaie(u.mook, `select count(*)::int n from whatsapp_conversations`);
ok(r.ok && r.rows[0].n === 0, "Mook ne lit aucune conversation WhatsApp");
if (ent.ztp) {
  r = await essaie(u.ztp, `select count(*)::int n from whatsapp_conversations`);
  ok(r.ok && r.rows[0].n === 0, "l'administratrice de ZTP non plus");
}

// 3 bis. Revue de sécurité : écrire ne s'élargit pas.
const P = (await un("insert into whatsapp_propositions (conversation_id, entite_id, statut, texte) values ($1, $2, 'a_faire', 'Hi') returning id", [rg.conversation_id, ent.taxi])).id;
r = await essaie(u.adminSecret, `update whatsapp_propositions set statut = 'ignoree' where id = '${P}'`);
ok(r.ok && r.n === 0, "l'administrateur de Secret ne traite pas une réponse d'une conversation Taxi");
r = await essaie(u.adminSecret, `select whatsapp_peut_ecrire('${rg.conversation_id}') p`);
ok(r.ok && r.rows[0].p === false, "ni ne peut envoyer ou préparer (whatsapp_peut_ecrire, appelé par les fonctions)");
r = await essaie(u.adminTaxi, `select whatsapp_peut_ecrire('${rg.conversation_id}') p`);
ok(r.ok && r.rows[0].p === true, "l'administrateur de Taxi le peut");

// 4 bis. Partage réciproque coché avec ZTP : n'ouvre rien.
if (ent.ztp) {
  await db.query("insert into partages_clients (source_id, cible_id, organisation_id) values ($1, $2, $3) on conflict do nothing", [ent.secret, ent.ztp, ORG]);
  await membre("mook", ent.ztp, "Administrateur");
  await db.exec(`update roles set tous_droits = false, permissions = array['dossiers.lire', 'dossiers.ecrire', 'clients.lire', 'clients.ecrire'] where entite_id = '${ent.ztp}' and nom = 'Administrateur'`).catch(() => {});
  r = await essaie(u.mook, `insert into dossiers (entite_id, ref, client_id) values ('${ent.secret}', 'S-ZTP', '${cZ}') returning id`);
  ok(!r.ok, "un partage réciproque coché avec ZTP ne permet toujours pas à un non-administrateur d'utiliser une fiche ZTP");
  await db.query("delete from partages_clients where source_id = $1 and cible_id = $2", [ent.secret, ent.ztp]);
  await db.query("delete from membres where user_id = $1 and entite_id = $2", [u.mook, ent.ztp]);
}

// 5 bis. Liens : un rôle « mes dossiers » ne lie pas vers un dossier qu'il ne voit pas ; jamais vers ZTP ; restauration depuis la corbeille.
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Mes dossiers', 'mes_dossiers', array['dossiers.lire', 'dossiers.ecrire', 'clients.lire'])`);
u.partiel = (await un("insert into auth.users (email) values ('partiel@test') returning id")).id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
await membre("partiel", ent.secret, "Mes dossiers");
await membre("partiel", ent.taxi, "Éditeur test");
const dT2 = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, 'T-67', $2) returning id", [ent.taxi, cT])).id;
r = await essaie(u.partiel, `update dossiers set dossier_lie_id = '${dS2}' where id = '${dT2}'`);
ok(!r.ok, "un rôle limité à ses dossiers ne lie pas vers un dossier Secret qu'il ne voit pas");
// Corbeille : supprimer le dossier Secret lié, puis le restaurer, garde le lien.
const corb = async (id) => (await un("select id from corbeille where table_name = 'dossiers' and ligne->>'id' = $1", [id]))?.id;
await db.exec(`delete from dossiers where id = '${dS}'`);
const cb = await corb(dS);
ok(!!cb, "le dossier lié supprimé part dans la corbeille");
if (cb) {
  r = await essaie(u.adminSecret, `select restaurer_dossier('${cb}')`);
  const lien = (await un("select dossier_lie_id from dossiers where id = $1", [dS]))?.dossier_lie_id;
  ok(r.ok && lien === dT, "restauré par l'administrateur de Secret (sans droit dans Taxi), il garde son lien" + (r.ok ? "" : ` (${r.err})`));
}
// Le dossier lié a disparu entre-temps : le dossier revient sans lien.
await db.exec(`delete from dossiers where id = '${dS}'`);
await db.exec(`update dossiers set dossier_lie_id = null where id = '${dT}'`);
await db.exec(`delete from dossiers where id = '${dT}'`);
const cb2 = await corb(dS);
if (cb2) {
  await db.exec(`delete from corbeille where table_name = 'dossiers' and ligne->>'id' = '${dT}'`);
  r = await essaie(u.adminSecret, `select restaurer_dossier('${cb2}')`);
  ok(r.ok && (await un("select dossier_lie_id from dossiers where id = $1", [dS])).dossier_lie_id === null, "sans le dossier lié, la restauration réussit et retire le lien" + (r.ok ? "" : ` (${r.err})`));
}

// 4. Doublons à valider.
r = await essaie(u.mook, `select * from doublons_clients_partages()`);
ok(r.ok && r.rows.some((x) => [x.fiche_a, x.fiche_b].includes(cS) && [x.fiche_a, x.fiche_b].includes(cT) && x.raison === "téléphone"), "la paire Secret et Taxi au même téléphone est proposée" + (r.ok ? "" : ` (${r.err})`));
ok(r.ok && !r.rows.some((x) => [x.fiche_a, x.fiche_b].includes(cZ)), "aucune fiche ZTP dans la liste");
ok((await un("select count(*)::int n from clients where id in ($1, $2)", [cS, cT])).n === 2, "rien n'est fusionné tout seul");
r = await essaie(u.adminSecret, `select count(*)::int n from doublons_clients_partages()`);
ok(r.ok && r.rows[0].n === 0, "un administrateur de Secret seul (sans lire les clients de Taxi) ne voit pas la liste");
r = await essaie(u.taxiSeul, `select count(*)::int n from doublons_clients_partages()`);
ok(r.ok && r.rows[0].n === 0, "sans lire les clients des deux entreprises, la liste est vide");

// 2 bis. Fusion entre Secret et Taxi : administration seulement, rien de perdu, la conversation suit.
await db.exec(`update clients set notes = 'allergie', telephone = '+41 79 111 11 11' where id = '${cS}'`);
await db.exec(`update clients set telephone = '+66 81 999 9999', email = 'anna@test' where id = '${cT}'`);
r = await essaie(u.mook, `select fusionner_clients('${cT}', '${cS}')`);
ok(!r.ok, "Mook ne fusionne pas deux fiches d'entreprises différentes");
u.adminDeux = (await un("insert into auth.users (email) values ('admin2@test') returning id")).id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
await membre("adminDeux", ent.secret, "Administrateur");
await membre("adminDeux", ent.taxi, "Administrateur");
r = await essaie(u.adminSecret, `select fusionner_clients('${cT}', '${cS}')`);
ok(!r.ok, "un administrateur de Secret seul ne fusionne pas vers une fiche Taxi");
await db.exec(`update whatsapp_conversations set client_id = '${cS}', entite_id = '${ent.secret}' where id = '${rg.conversation_id}'`);
r = await essaie(u.adminDeux, `select fusionner_clients('${cT}', '${cS}')`);
ok(r.ok, "l'administrateur des deux entreprises fusionne" + (r.ok ? "" : ` (${r.err})`));
const g = await un("select notes, telephone from clients where id = $1", [cT]);
ok(g && /allergie/.test(g.notes) && /Autre téléphone : \+41 79 111 11 11/.test(g.notes), "les notes et l'autre téléphone de la fiche absorbée sont gardés");
// Migration 85 : un client appartient à Secret et à Taxi ; sa conversation garde la fiche fusionnée de Taxi (avant : retirée).
ok((await un("select client_id from whatsapp_conversations where id = $1", [rg.conversation_id])).client_id === cT, "la conversation d'un client garde la fiche fusionnée de l'autre entreprise (client commun, migration 85)");

const org2 = (await un("insert into organisations (nom) values ('Autre agence') returning id")).id;
const s2 = (await un("insert into entites (slug, nom, organisation_id) values ('secret', 'Autre Secret', $1) returning id", [org2])).id;
const t2 = (await un("insert into entites (slug, nom, organisation_id) values ('taxi', 'Autre Taxi', $1) returning id", [org2])).id;
await db.query("insert into partages_clients (source_id, cible_id, organisation_id) values ($1, $2, $3), ($2, $1, $3)", [s2, t2, org2]);
// 5. Retour en arrière.
await db.exec(lire("retour-63-espace-unifie.sql"));
const apres = (await db.query("select s.slug || '>' || c.slug p from partages_clients x join entites s on s.id = x.source_id join entites c on c.id = x.cible_id order by 1")).rows.map((r) => r.p);
ok(apres.join() === "secret>taxi,taxi>secret,ztp>secret,ztp>taxi" && (await un("select count(*)::int n from partages_clients where organisation_id = $1", [ORG])).n === 2, "le retour en arrière remet le partage d'avant chez Zwald et ne touche pas une autre organisation");
ok((await un("select count(*)::int n from information_schema.columns where table_name = 'dossiers' and column_name = 'dossier_lie_id'")).n === 0, "et retire la colonne des dossiers liés");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
