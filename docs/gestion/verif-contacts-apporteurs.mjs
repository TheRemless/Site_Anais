// Vérifie la migration 68 (contacts WhatsApp typés et apporteurs d'affaires) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// Apporteur d'une autre entreprise refusé, type posé par Nani gardé contre la fonction, typer ne rouvre pas l'IA, ZTP sans apporteur,
// restauration d'un dossier, aucune colonne de rémunération, retour en arrière.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-contacts-apporteurs.mjs
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
ok(migrations.at(-1) === "migration-68-contacts-apporteurs.sql" || migrations.includes("migration-68-contacts-apporteurs.sql"), "la migration 68 passe après les autres");
await db.exec(lire("migration-68-contacts-apporteurs.sql"));
ok(true, "la migration 68 se rejoue sans erreur (idempotente)");
ok((await db.query("select 1 from information_schema.columns where table_name = 'partenaires_prives' and column_name = 'remuneration'")).rows.length === 0 && (await db.query("select to_regclass('public.apporteurs_reverse') t")).rows[0].t === null, "aucune rémunération ni commission reversée : personne n'est payé en commission");

async function essaie(userId, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];

const ent = {};
for (const sl of ["ztp", "secret", "taxi"]) ent[sl] = (await un("select id from entites where slug = $1", [sl]))?.id;
const ORG = (await un("select organisation_id from entites where id = $1", [ent.secret])).organisation_id;

const u = {};
for (const k of ["adminSecret", "adminTaxi", "adminDeux", "mook", "ztp"]) u[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
// Mook chez Secret : elle écrit les dossiers et les partenaires, sans le droit « nets » ni les réglages.
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Mook test', 'toute', array['clients.lire', 'clients.ecrire', 'dossiers.lire', 'dossiers.ecrire', 'partenaires.lire', 'partenaires.ecrire', 'taches.ecrire'])`);
const membre = (user, entite, role) => db.exec(`insert into membres values ('${u[user]}', '${entite}', (select id from roles where entite_id = '${entite}' and nom = '${role}')) on conflict do nothing`);
await membre("adminSecret", ent.secret, "Administrateur");
await membre("adminTaxi", ent.taxi, "Administrateur");
await membre("adminDeux", ent.secret, "Administrateur");
await membre("adminDeux", ent.taxi, "Administrateur");
await membre("mook", ent.secret, "Mook test");
if (ent.ztp) await membre("ztp", ent.ztp, "Administrateur");

// ---- Fiches apporteur -----------------------------------------------------------------------------------------------------------
let r = await essaie(u.adminSecret, `insert into partenaires (entite_id, nom, categorie, role) values ('${ent.secret}', 'Jade', 'apporteur', 'Travel planner') returning id`);
ok(r.ok, "l'administratrice de Secret crée la fiche apporteur de Jade" + (r.ok ? "" : ` (${r.err})`));
const jade = r.rows[0].id;
const jadeTaxi = (await un("insert into partenaires (entite_id, nom, categorie) values ($1, 'Jade', 'apporteur') returning id", [ent.taxi])).id;
const bateau = (await un("insert into partenaires (entite_id, nom, categorie) values ($1, 'Longtail test', 'Excursions bateaux') returning id", [ent.secret])).id;
const apZtp = ent.ztp ? (await un("insert into partenaires (entite_id, nom, categorie) values ($1, 'Agence amie', 'apporteur') returning id", [ent.ztp])).id : null;

// ---- Dossiers --------------------------------------------------------------------------------------------------------------------
const cS = (await un("insert into clients (entite_id, prenom, nom) values ($1, 'Lena', 'Test') returning id", [ent.secret])).id;
const dS = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, 'S-68', $2) returning id", [ent.secret, cS])).id;
r = await essaie(u.mook, `update dossiers set apporteur_id = '${jadeTaxi}' where id = '${dS}'`);
ok(!r.ok, "un apporteur d'une autre entreprise (Taxi) est refusé sur un dossier de Secret");
r = await essaie(u.adminDeux, `update dossiers set apporteur_id = '${jadeTaxi}' where id = '${dS}'`);
ok(!r.ok, "… même pour qui administre les deux entreprises");
r = await essaie(u.adminSecret, `insert into dossiers (entite_id, ref, client_id, apporteur_id) values ('${ent.secret}', 'S-69', '${cS}', '${jadeTaxi}')`);
ok(!r.ok, "… et à la création du dossier");
r = await essaie(u.mook, `update dossiers set apporteur_id = '${bateau}' where id = '${dS}'`);
ok(!r.ok, "un partenaire qui n'est pas un apporteur est refusé");
r = await essaie(u.mook, `update dossiers set apporteur_id = '${jade}' where id = '${dS}' returning apporteur_id`);
ok(r.ok && r.rows[0]?.apporteur_id === jade, "Mook, qui écrit le dossier, y pose Jade, apporteur de Secret" + (r.ok ? "" : ` (${r.err})`));
r = await essaie(u.mook, `update dossiers set notes = 'Arrivée tardive' where id = '${dS}' returning apporteur_id`);
ok(r.ok && r.rows[0]?.apporteur_id === jade, "modifier une autre colonne du dossier garde l'apporteur");
if (ent.ztp) {
  const cZ = (await un("insert into clients (entite_id, prenom, nom) values ($1, 'Zoé', 'Ztp') returning id", [ent.ztp])).id;
  r = await essaie(u.ztp, `insert into dossiers (entite_id, ref, client_id, apporteur_id) values ('${ent.ztp}', 'Z-68', '${cZ}', '${apZtp}')`);
  ok(!r.ok, "ZTP reste à part : pas d'apporteur sur un dossier de ZTP");
}
// Restauration (restaurer_dossier) : la fiche apporteur a disparu entre-temps, le dossier revient sans apporteur au lieu d'échouer.
const fantome = "00000000-0000-4000-8000-0000000000aa";
r = await essaie(u.adminSecret, `insert into dossiers (entite_id, ref, client_id, apporteur_id) values ('${ent.secret}', 'S-70', '${cS}', '${fantome}')`);
ok(!r.ok, "hors restauration, un apporteur inexistant est refusé");
const amie = (await un("insert into partenaires (entite_id, nom, categorie) values ($1, 'Ancienne amie', 'apporteur') returning id", [ent.secret])).id;
const dGarde = (await un("insert into dossiers (entite_id, ref, client_id, apporteur_id) values ($1, 'S-71', $2, $3) returning id", [ent.secret, cS, jade])).id;
const dPerdu = (await un("insert into dossiers (entite_id, ref, client_id, apporteur_id) values ($1, 'S-72', $2, $3) returning id", [ent.secret, cS, amie])).id;
for (const id of [dGarde, dPerdu]) {
  r = await essaie(u.adminSecret, `delete from dossiers where id = '${id}'`);
  ok(r.ok && r.n === 1, "dossier supprimé (corbeille)" + (r.ok ? "" : ` (${r.err})`));
}
await db.query("delete from partenaires where id = $1", [amie]);
for (const [id, attendu, msg] of [[dGarde, jade, "un dossier restauré garde son apporteur encore valable"], [dPerdu, null, "un dossier restauré dont la fiche apporteur a été supprimée revient sans apporteur"]]) {
  const cb = (await un("select id from corbeille where table_name = 'dossiers' and ligne->>'id' = $1", [id])).id;
  r = await essaie(u.adminSecret, `select restaurer_dossier('${cb}')`);
  ok(r.ok && (await un("select apporteur_id from dossiers where id = $1", [id]))?.apporteur_id === attendu, msg + (r.ok ? "" : ` (${r.err})`));
}

// ---- Conversations typées --------------------------------------------------------------------------------------------------------
const msg = (n, o = {}) => JSON.stringify({ evenement_id: `e${n}`, telnyx_id: `tx-${n}`, meta_id: `wamid.${n}`, sens: "entrant", origine: "client", type: "text", texte: "Hi Nani, I have two clients for you", medias: [], envoye_le: new Date(Date.now() - (100 - n) * 60000).toISOString(), ...o });
const ranger = async (tel, nom, m) => (await un("select whatsapp_ranger($1, $2, $3, $4::jsonb) r", [ORG, tel, nom, m])).r;
const c1 = (await ranger("+447700900611", "Jade", msg(1))).conversation_id;
const conv = (id) => un("select type_contact, reponses, partenaire_id, entite_id from whatsapp_conversations where id = $1", [id]);
ok((await conv(c1)).type_contact === null, "une nouvelle conversation n'a pas de type");
// La fonction (sans personne connectée) peut remplir un type encore vide.
await db.query("update whatsapp_conversations set type_contact = 'client' where id = $1", [c1]);
ok((await conv(c1)).type_contact === "client", "la fonction remplit un type encore vide");
await db.query("update whatsapp_conversations set entite_id = $2, entite_source = 'manuel' where id = $1", [c1, ent.secret]);
r = await essaie(u.mook, `update whatsapp_conversations set type_contact = 'apporteur' where id = '${c1}'`);
ok(!r.ok || r.n === 0, "Mook ne type pas une conversation (réservé aux administrateurs de Secret et Taxi)");
r = await essaie(u.adminSecret, `update whatsapp_conversations set type_contact = 'apporteur', partenaire_id = '${jade}' where id = '${c1}' returning type_contact, partenaire_id`);
ok(r.ok && r.rows[0].type_contact === "apporteur" && r.rows[0].partenaire_id === jade, "Nani type la conversation « apporteur » et la relie à la fiche de Jade" + (r.ok ? "" : ` (${r.err})`));
await db.query("update whatsapp_conversations set type_contact = 'client', partenaire_id = null, reponses = 'jamais' where id = $1", [c1]);
let x = await conv(c1);
ok(x.type_contact === "apporteur" && x.partenaire_id === jade && x.reponses === "auto", "la fonction ne change ni un type posé par Nani, ni la fiche reliée, ni les réponses");
r = await essaie(u.adminSecret, `update whatsapp_conversations set partenaire_id = '${jadeTaxi}' where id = '${c1}'`);
ok(!r.ok, "une fiche d'une autre entreprise est refusée sur la conversation");
r = await essaie(u.adminSecret, `update whatsapp_conversations set partenaire_id = '${bateau}' where id = '${c1}' returning partenaire_id`);
ok(r.ok && r.rows[0].partenaire_id === bateau, "une autre fiche de Secret se relie (partenaire, hôtel)");
await essaie(u.adminSecret, `update whatsapp_conversations set partenaire_id = '${jade}' where id = '${c1}'`);

// Typer ne rouvre jamais l'IA : le type et le réglage des réponses sont indépendants en base (l'écran les couple au tap).
r = await essaie(u.adminSecret, `update whatsapp_conversations set reponses = 'jamais' where id = '${c1}' returning type_contact, reponses`);
ok(r.ok && r.rows[0].reponses === "jamais" && r.rows[0].type_contact === "apporteur", "le réglage des réponses se change à part, le type reste");
r = await essaie(u.adminSecret, `update whatsapp_conversations set type_contact = 'chauffeur' where id = '${c1}' returning type_contact, reponses`);
ok(r.ok && r.rows[0].type_contact === "chauffeur" && r.rows[0].reponses === "jamais", "typer un contact « jamais » ne le rouvre pas à l'IA");
await db.query("update whatsapp_conversations set type_contact = 'client', reponses = 'auto' where id = $1", [c1]);
x = await conv(c1);
ok(x.type_contact === "chauffeur" && x.reponses === "jamais", "la fonction ne change ni le type ni le « jamais » posés par Nani");
r = await essaie(u.adminSecret, `update whatsapp_conversations set type_contact = null, reponses = 'jamais' where id = '${c1}' returning type_contact, reponses`);
ok(r.ok && r.rows[0].type_contact === null && r.rows[0].reponses === "jamais", "personnel : « jamais » sans type");
await db.query("update whatsapp_conversations set type_contact = 'client' where id = $1", [c1]);
ok((await conv(c1)).type_contact === null, "la fonction ne type pas un contact personnel");
r = await essaie(u.adminSecret, `update whatsapp_conversations set type_contact = 'ami' where id = '${c1}'`);
ok(!r.ok, "un type inconnu est refusé");
ok((await un("select count(*)::int n from pg_constraint where conname = 'whatsapp_conversations_personnel_check'")).n === 0, "aucune contrainte ne lie le type aux réponses");
await essaie(u.adminSecret, `update whatsapp_conversations set reponses = 'auto' where id = '${c1}'`);
await essaie(u.adminSecret, `update whatsapp_conversations set type_contact = 'apporteur', partenaire_id = '${jade}' where id = '${c1}'`);

// Changement d'entreprise : la fiche de Secret n'est plus reliée.
r = await essaie(u.adminDeux, `update whatsapp_conversations set entite_id = '${ent.taxi}' where id = '${c1}' returning partenaire_id, type_contact`);
ok(r.ok && r.rows[0].partenaire_id === null && r.rows[0].type_contact === "apporteur", "ranger la conversation chez Taxi retire la fiche de Secret, le type reste" + (r.ok ? "" : ` (${r.err})`));

// Supprimer la fiche apporteur : le dossier et la conversation la perdent, sans erreur.
await essaie(u.adminDeux, `update whatsapp_conversations set partenaire_id = '${jadeTaxi}' where id = '${c1}'`);
await db.query("delete from partenaires where id = $1", [jadeTaxi]);
ok((await conv(c1)).partenaire_id === null, "une fiche supprimée laisse la conversation sans fiche");
await db.query("delete from partenaires where id = $1", [jade]);
ok((await un("select apporteur_id from dossiers where id = $1", [dS])).apporteur_id === null, "… et le dossier sans apporteur");

// ---- Retour en arrière -----------------------------------------------------------------------------------------------------------
await db.exec(lire("retour-68-contacts-apporteurs.sql"));
const colonnes = (await db.query("select table_name || '.' || column_name c from information_schema.columns where (table_name, column_name) in (('dossiers', 'apporteur_id'), ('whatsapp_conversations', 'type_contact'), ('whatsapp_conversations', 'partenaire_id'))")).rows;
ok(colonnes.length === 0, "le retour en arrière retire les trois colonnes");
await db.query("update whatsapp_conversations set reponses = 'jamais' where id = $1", [c1]);
ok((await un("select reponses from whatsapp_conversations where id = $1", [c1])).reponses === "auto", "le classement protégé de la migration 60 marche encore après le retour");
await db.exec(lire("migration-68-contacts-apporteurs.sql"));
ok(true, "la migration 68 se rejoue après le retour en arrière");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
