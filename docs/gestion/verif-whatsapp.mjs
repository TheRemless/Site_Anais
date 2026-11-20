// Vérifie la migration 58 (réception WhatsApp) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// Rangement idempotent, client reconnu par son numéro, lecture réservée aux administrateurs de Secret et Taxi, rien d'écrit depuis l'outil.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-whatsapp.mjs
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
ok(migrations.includes("migration-58-whatsapp.sql"), "la migration 58 passe après les autres");
await db.exec(lire("migration-58-whatsapp.sql"));
ok(true, "la migration 58 se rejoue sans erreur (idempotente)");

async function essaie(userId, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
}

const ent = {};
for (const sl of ["ztp", "secret", "taxi"]) ent[sl] = (await db.query("select id from entites where slug = $1", [sl])).rows[0]?.id;
const ORG = (await db.query("select organisation_id from entites where id = $1", [ent.secret])).rows[0].organisation_id;
ok(ORG === "00000000-0000-0000-0000-00000000a000", "Secret est dans l'organisation de Zwald");
ok((await db.query("select reception_active from whatsapp_reglages where organisation_id = $1", [ORG])).rows[0]?.reception_active === true, "la réception est active par défaut");

const u = {};
for (const k of ["adminSecret", "adminTaxi", "mook", "ztp"]) u[k] = (await db.query("insert into auth.users (email) values ($1) returning id", [k + "@test"])).rows[0].id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Éditeur sans réglages', 'toute', array['dossiers.lire', 'dossiers.ecrire', 'clients.lire', 'clients.ecrire'])`);
const membre = (user, entite, role) => db.exec(`insert into membres values ('${u[user]}', '${entite}', (select id from roles where entite_id = '${entite}' and nom = '${role}')) on conflict do nothing`);
await membre("adminSecret", ent.secret, "Administrateur");
await membre("adminTaxi", ent.taxi, "Administrateur");
await membre("mook", ent.secret, "Éditeur sans réglages");
if (ent.ztp) await membre("ztp", ent.ztp, "Administrateur");

// Un client de Taxi noté à la thaïe : le message de +66812345678 le retrouve.
const C = (await db.query("insert into clients (entite_id, prenom, nom, telephone) values ($1, 'Bo', 'Test', '081 234 5678') returning id", [ent.taxi])).rows[0].id;
const D = (await db.query("insert into dossiers (entite_id, ref, client_id) values ($1, 'T-58', $2) returning id", [ent.taxi, C])).rows[0].id;
const msg = (o) => JSON.stringify({ evenement_id: "e1", telnyx_id: "tx-1", meta_id: "wamid.1", sens: "entrant", origine: "client", type: "text", texte: "Taxi to the pier at 8?", medias: [], envoye_le: "2026-11-20T09:00:00Z", ...o });
const ranger = async (tel, nom, m) => (await db.query("select whatsapp_ranger($1, $2, $3, $4::jsonb) r", [ORG, tel, nom, m])).rows[0].r;
let r1 = await ranger("+66812345678", "Bo", msg({}));
ok(r1.nouveau === true, "un nouveau message est rangé");
const conv = (await db.query("select * from whatsapp_conversations where id = $1", [r1.conversation_id])).rows[0];
ok(conv.entite_id === ent.taxi && conv.client_id === C && conv.dossier_id === D && conv.entite_source === "client", "la conversation est rattachée au client et au dossier de Taxi par le numéro");
ok(conv.non_lus === 1 && conv.dernier_sens === "entrant" && conv.nom === "Bo", "un non-lu, dernier message du client, nom du profil gardé");
let r2 = await ranger("+66812345678", null, msg({}));
ok(r2.nouveau === false && r2.message_id === r1.message_id, "le même événement renvoyé par Telnyx n'ajoute rien");
ok((await db.query("select count(*)::int n from whatsapp_messages")).rows[0].n === 1, "un seul message en base");
await ranger("+66812345678", null, msg({ evenement_id: "e2", telnyx_id: "tx-2", meta_id: "wamid.2", sens: "sortant", origine: "app", texte: "Yes, 8:00 at your hotel.", envoye_le: "2026-11-20T09:05:00Z" }));
const conv2 = (await db.query("select non_lus, dernier_sens, nom from whatsapp_conversations where id = $1", [r1.conversation_id])).rows[0];
ok(conv2.non_lus === 0 && conv2.dernier_sens === "sortant" && conv2.nom === "Bo", "la réponse de Nani depuis l'app remet les non-lus à zéro sans effacer le nom");

// Inconnu : à trier.
const r3 = await ranger("+41790000002", "Anna", msg({ evenement_id: "e3", telnyx_id: "tx-3", meta_id: "wamid.3", texte: "Hello, 4 islands tomorrow?" }));
const inconnu = (await db.query("select entite_id, client_id from whatsapp_conversations where id = $1", [r3.conversation_id])).rows[0];
ok(inconnu.entite_id === null && inconnu.client_id === null, "un numéro inconnu reste à trier");

const compter = async (user, table) => { const r = await essaie(user, `select count(*)::int n from ${table}`); return r.ok ? r.rows[0].n : -1; };

ok(await compter(u.adminTaxi, "whatsapp_conversations") === 2, "l'administrateur de Taxi lit sa conversation et celle à trier");
ok(await compter(u.adminSecret, "whatsapp_conversations") === 1, "l'administrateur de Secret ne lit que celle à trier, pas celle de Taxi");
ok(await compter(u.adminSecret, "whatsapp_messages") === 1, "… et seulement ses messages");
ok(await compter(u.mook, "whatsapp_conversations") === 0 && await compter(u.mook, "whatsapp_messages") === 0, "un rôle sans réglages ne voit aucun message");
if (ent.ztp) ok(await compter(u.ztp, "whatsapp_conversations") === 0, "l'administratrice de ZTP ne voit rien");
let r = await essaie(u.adminTaxi, "select count(*) from whatsapp_evenements");
ok(!r.ok, "personne ne lit les événements bruts depuis l'outil");
r = await essaie(u.adminTaxi, `insert into whatsapp_messages (conversation_id, sens, origine, type, envoye_le) values ('${r1.conversation_id}', 'sortant', 'gestion', 'text', now())`);
ok(!r.ok, "personne n'écrit un message depuis l'outil");
r = await essaie(u.adminTaxi, `update whatsapp_conversations set entite_id = '${ent.secret}' where id = '${r1.conversation_id}'`);
ok(!r.ok, "le classement n'est pas encore ouvert à l'outil (phase 2)");
r = await essaie(u.adminTaxi, `select whatsapp_ranger('${ORG}', '+41790000009', null, '{}'::jsonb)`);
ok(!r.ok, "l'outil ne peut pas appeler whatsapp_ranger");
r = await essaie(u.adminTaxi, `select purger_whatsapp('${ORG}')`);
ok(!r.ok, "l'outil ne peut pas appeler purger_whatsapp");

// Interrupteur : un administrateur de Secret ou de Taxi suspend la réception ; rien d'autre ne change ; Mook ne peut pas.
r = await essaie(u.mook, `update whatsapp_reglages set reception_active = false`);
ok(r.ok && r.n === 0, "Mook ne suspend pas la réception");
r = await essaie(u.adminSecret, `update whatsapp_reglages set numero = '+66000000000'`);
ok(!r.ok, "le numéro ne se change pas depuis l'outil");
r = await essaie(u.adminSecret, `update whatsapp_reglages set reception_active = false`);
ok(r.ok && r.n === 1, "l'administrateur de Secret suspend la réception");
await db.exec(`update whatsapp_reglages set reception_active = true`);

// Médias : le chemin donne accès seulement à une conversation lisible.
r = await essaie(u.adminSecret, `select whatsapp_lit_chemin('${ORG}/${r3.conversation_id}/x-1.jpg') a, whatsapp_lit_chemin('${ORG}/${r1.conversation_id}/x-1.jpg') b, whatsapp_lit_chemin('../${r3.conversation_id}/x') c, whatsapp_lit_chemin('nimporte') d`);
ok(r.ok && r.rows[0].a === true && r.rows[0].b === false && r.rows[0].c === false && r.rows[0].d === false, "un média se lit seulement par qui lit sa conversation, un chemin mal formé ne donne rien");

// Conservation.
await db.query("insert into whatsapp_evenements (id, type, organisation_id, brut, recu_le) values ('vieux', 'message.received', $1, '{}', now() - interval '31 days'), ('recent', 'message.received', $1, '{}', now())", [ORG]);
await ranger("+41790000002", null, msg({ evenement_id: "e4", telnyx_id: "tx-4", meta_id: "wamid.4", type: "image", texte: null, medias: [{ type: "image", statut: "copie", chemin: `${ORG}/${r3.conversation_id}/m-1.jpg` }], envoye_le: new Date(Date.now() - 100 * 86400000).toISOString() }));
await ranger("+41790000002", null, msg({ evenement_id: "e5", telnyx_id: "tx-5", meta_id: "wamid.5", texte: "old", envoye_le: new Date(Date.now() - 400 * 86400000).toISOString() }));
const purge = (await db.query("select * from purger_whatsapp($1)", [ORG])).rows;
ok(purge.length === 1 && purge[0].chemins[0].endsWith("/m-1.jpg"), "les médias de plus de 90 jours sont rendus pour être effacés");
const ids = (await db.query("select id from whatsapp_evenements order by id")).rows.map((x) => x.id);
ok(!ids.includes("vieux") && ids.includes("recent"), "les événements de plus de 30 jours sont supprimés");
ok((await db.query("select count(*)::int n from whatsapp_messages where telnyx_id = 'tx-5'")).rows[0].n === 0, "les messages de plus de 365 jours sont supprimés");
ok((await db.query("select count(*)::int n from whatsapp_conversations")).rows[0].n === 2, "les conversations récentes restent");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
