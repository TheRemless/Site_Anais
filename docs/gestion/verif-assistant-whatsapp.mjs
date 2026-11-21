// Vérifie la migration 67 (l'Assistant lit la boîte WhatsApp, 21.11.2026) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// whatsapp_rechercher : un rôle sans whatsapp_lit ne trouve rien, un contact « jamais » n'est jamais rendu, la recherche trouve un mot, un
// préfixe et un numéro, les messages supprimés et la clé de service ne rendent rien.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-assistant-whatsapp.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
let echecs = 0;
const ok = (c, msg) => { if (!c) { echecs++; console.log("  ECHEC:", msg); } else console.log("  ok:", msg); };
const harnais = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema public, auth, storage to authenticated, anon, service_role;
grant all on all tables in schema storage to authenticated;
grant execute on function auth.uid() to authenticated, anon, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
for (const f of migrations) await db.exec(lire(f));
ok(migrations.includes("migration-67-assistant-whatsapp.sql"), "la migration 67 passe après les autres");
await db.exec(lire("migration-67-assistant-whatsapp.sql"));
ok(true, "la migration 67 se rejoue sans erreur (idempotente)");

async function essaie(userId, sql, params) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}

const ent = {};
for (const sl of ["ztp", "secret", "taxi"]) ent[sl] = (await db.query("select id from entites where slug = $1", [sl])).rows[0]?.id;
const ORG = (await db.query("select organisation_id from entites where id = $1", [ent.secret])).rows[0].organisation_id;
const u = {};
for (const k of ["adminSecret", "adminTaxi", "mook", "ztp", "personne"]) u[k] = (await db.query("insert into auth.users (email) values ($1) returning id", [k + "@test"])).rows[0].id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Éditeur sans réglages', 'toute', array['dossiers.lire', 'dossiers.ecrire', 'clients.lire', 'clients.ecrire'])`);
const membre = (user, entite, role) => db.exec(`insert into membres values ('${u[user]}', '${entite}', (select id from roles where entite_id = '${entite}' and nom = '${role}')) on conflict do nothing`);
await membre("adminSecret", ent.secret, "Administrateur");
await membre("adminTaxi", ent.taxi, "Administrateur");
await membre("mook", ent.secret, "Éditeur sans réglages");
if (ent.ztp) await membre("ztp", ent.ztp, "Administrateur");

const ranger = async (tel, m) => (await db.query("select whatsapp_ranger($1, $2, $3, $4::jsonb) r", [ORG, tel, m.nom || null, JSON.stringify(m)])).rows[0].r;
const base = { sens: "entrant", origine: "client", type: "text", medias: [] };
let n = 0;
const msg = (tel, texte, o = {}) => ranger(tel, { ...base, evenement_id: `ev-${++n}`, texte, envoye_le: new Date(Date.parse("2026-11-20T08:00:00Z") + n * 60000).toISOString(), ...o });

// Lucia (à trier) demande une excursion ; Tom (Taxi) parle d'un ferry et donne un numéro ; Somchai (Taxi) est un contact personnel.
const lucia = await msg("+12025550147", "Hi! Do you still have places for the 4 Islands tour on Saturday?", { nom: "Lucia" });
await msg("+12025550147", null, { type: "image", medias: [{ type: "image", legende: "Our hotel Lanta Sand", statut: "copie" }] });
const tom = await msg("+447700900311", "We want the ferry to Koh Phi Phi, my booking number is 20260142.", { nom: "Tom" });
await msg("+447700900311", "My other phone is 081 234 5678", { nom: "Tom" });
const somchai = await msg("+447700900844", "Ferry tickets for my cousin tomorrow, call me", { nom: "Driver Somchai" });
const supprime = await msg("+447700900311", "secret banana word", { nom: "Tom" });
await db.query("update whatsapp_messages set supprime_le = now(), texte = null where id = $1", [supprime.message_id]);
await db.exec(`update whatsapp_conversations set entite_id = '${ent.taxi}', entite_source = 'manuel' where id in ('${tom.conversation_id}', '${somchai.conversation_id}')`);
let r = await essaie(u.adminTaxi, `update whatsapp_conversations set reponses = 'jamais' where id = '${somchai.conversation_id}'`);
ok(r.ok && r.n === 1, "Nani règle Somchai sur « Contact personnel »");

const cherche = (user, q, lim = 20) => essaie(user, "select * from whatsapp_rechercher($1, $2)", [q, lim]);

// ---- Droits ------------------------------------------------------------------------------------------------------------------------
for (const [qui, libelle] of [["mook", "Mook (éditrice sans réglages)"], ["ztp", "l'administratrice de ZTP"], ["personne", "une personne sans rôle"]]) {
  if (qui === "ztp" && !ent.ztp) continue;
  r = await cherche(u[qui], "ferry");
  ok(r.ok && r.rows.length === 0, `${libelle} ne trouve rien (pas de whatsapp_lit)`);
}
r = await db.query("select * from whatsapp_rechercher('ferry', 20)");
ok(r.rows.length === 0, "sans personne connectée (clé de service), rien : la fonction redit whatsapp_lit");
r = await essaie(u.adminSecret, "select prosecdef from pg_proc where proname = 'whatsapp_rechercher'");
ok(r.ok && r.rows[0].prosecdef === false, "whatsapp_rechercher est SECURITY INVOKER : la RLS s'applique");
await db.exec("set role anon");
let refus = null;
try { await db.query("select * from whatsapp_rechercher('ferry', 20)"); } catch (e) { refus = e.message; }
await db.exec("reset role");
ok(!!refus, "anon ne peut pas l'appeler");

// ---- Recherche ---------------------------------------------------------------------------------------------------------------------
r = await cherche(u.adminTaxi, "ferry");
ok(r.ok && r.rows.length === 1 && r.rows[0].conversation_id === tom.conversation_id && r.rows[0].message_id === tom.message_id, "un mot : « ferry » trouve le message de Tom");
ok(r.ok && /«ferry»/i.test(r.rows[0].extrait), "… avec un extrait où le mot est marqué");
ok(r.ok && !r.rows.some((x) => x.conversation_id === somchai.conversation_id), "le contact « jamais » n'est jamais rendu, même s'il dit « ferry »");
r = await cherche(u.adminSecret, "isl");
ok(r.ok && r.rows.length === 1 && r.rows[0].conversation_id === lucia.conversation_id, "un préfixe : « isl » trouve « Islands » (conversation à trier, lue par l'administrateur de Secret)");
r = await cherche(u.adminSecret, "lanta san");
ok(r.ok && r.rows.length === 1 && r.rows[0].conversation_id === lucia.conversation_id, "deux préfixes, dans la légende d'une photo");
r = await cherche(u.adminSecret, "Phi phi");
ok(r.ok && r.rows.length === 1 && r.rows[0].conversation_id === tom.conversation_id, "majuscules ignorées ; l'administrateur de Secret lit aussi Taxi (migration 63)");
r = await cherche(u.adminTaxi, "20260142");
ok(r.ok && r.rows.length >= 1 && r.rows.some((x) => x.message_id === tom.message_id), "un numéro de dossier écrit dans un message");
r = await cherche(u.adminTaxi, "0812345678");
ok(r.ok && r.rows.some((x) => x.conversation_id === tom.conversation_id), "un numéro écrit avec des espaces dans le message (« 081 234 5678 »)");
r = await cherche(u.adminTaxi, "+44 7700 900311");
ok(r.ok && r.rows.length >= 1 && r.rows.every((x) => x.conversation_id === tom.conversation_id), "le numéro du contact trouve sa conversation");
r = await cherche(u.adminTaxi, "+44 7700 900844");
ok(r.ok && r.rows.length === 0, "… mais jamais celle d'un contact « jamais »");
r = await cherche(u.adminTaxi, "banana");
ok(r.ok && r.rows.length === 0, "un message supprimé par le client ne se trouve plus");
r = await cherche(u.adminTaxi, "cousin");
ok(r.ok && r.rows.length === 0, "rien du contact personnel, même un mot qu'il est le seul à écrire");

// ---- Bornes et syntaxe -------------------------------------------------------------------------------------------------------------
r = await cherche(u.adminTaxi, "ferry & | ! ( ) : * ' \" \\ <>");
ok(r.ok && r.rows.length === 1, "les signes de la syntaxe des requêtes sont ignorés, sans erreur");
r = await cherche(u.adminTaxi, "x");
ok(r.ok && r.rows.length === 0, "un mot d'une lettre ne cherche rien");
r = await cherche(u.adminTaxi, "");
ok(r.ok && r.rows.length === 0, "une recherche vide ne rend rien");
r = await cherche(u.adminTaxi, "ferry", 100000);
ok(r.ok && r.rows.length === 1, "une limite démesurée est bornée");
r = await cherche(u.adminTaxi, "i", -5);
ok(r.ok, "une limite négative est bornée, sans erreur");
r = await cherche(u.adminTaxi, "ferry ".repeat(200));
ok(r.ok && r.rows.length === 1, "une recherche très longue est coupée à 100 caractères");
r = await cherche(u.adminTaxi, null, null);
ok(r.ok && r.rows.length === 0, "null ne casse rien");
const plan = (await db.query("select indexdef from pg_indexes where indexname = 'whatsapp_messages_recherche'")).rows[0];
ok(plan && /gin/i.test(plan.indexdef) && /simple/.test(plan.indexdef), "index GIN, configuration « simple »");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
