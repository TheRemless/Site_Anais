// Vérifie la migration 105 (étapes des conversations WhatsApp de clients) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// La clé de service écrit les faits (avancee) mais ne touche jamais l'étape choisie par Nani ; un administrateur choisit une étape (heure posée
// par la base, clé et étape contrôlées) sans pouvoir écrire les faits ; un lecteur seul et Mook n'écrivent rien ; la migration se rejoue ;
// retour en arrière.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-whatsapp-etapes.mjs
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
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d|1\d\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
for (const f of migrations) await db.exec(lire(f));
ok(migrations.indexOf("migration-105-whatsapp-etapes.sql") > migrations.indexOf("migration-85-whatsapp-pret.sql"), "la migration 105 passe après la 85, sur une base vide");

async function essaie(userId, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];

const ent = {};
for (const sl of ["ztp", "secret", "taxi"]) ent[sl] = (await un("select id from entites where slug = $1", [sl]))?.id;
const ORG = (await un("select organisation_id from entites where id = $1", [ent.secret])).organisation_id;
const u = {};
for (const k of ["nani", "adminTaxi", "mook"]) u[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Mook test', 'toute', array['clients.lire', 'clients.ecrire', 'dossiers.lire', 'dossiers.ecrire', 'partenaires.lire', 'partenaires.ecrire', 'taches.ecrire'])`);
const membre = (user, entite, role) => db.exec(`insert into membres values ('${u[user]}', '${entite}', (select id from roles where entite_id = '${entite}' and nom = '${role}')) on conflict do nothing`);
await membre("nani", ent.secret, "Administrateur");
await membre("nani", ent.taxi, "Administrateur");
await membre("adminTaxi", ent.taxi, "Administrateur");
await membre("mook", ent.secret, "Mook test");

let n = 0;
const ranger = async (tel, texte, sens = "entrant") =>
  (await un("select whatsapp_ranger($1, $2, $3, $4::jsonb) r", [ORG, tel, null, JSON.stringify({ evenement_id: `e${++n}`, telnyx_id: `tx-${n}`, meta_id: `wamid.${n}`, sens, origine: sens === "entrant" ? "client" : "app", type: "text", texte, medias: [], envoye_le: new Date(Date.now() - (100 - n) * 60000).toISOString() })])).r.conversation_id;
const conv = (id) => un("select avancee, etape_manuelle from whatsapp_conversations where id = $1", [id]);
const FAITS = { v: 1, client: true, premier_client_le: "2026-11-21T01:00:00Z", dernier_client_le: "2026-11-21T02:00:00Z", demande_le: "2026-11-21T01:00:00Z", prix: { secret: null, taxi: "2026-11-21T01:30:00Z", inconnu: null }, pret: null, voucher_le: null, refus_le: null, calcule_le: "2026-11-22T00:00:00Z" };

// ---- Structure --------------------------------------------------------------------------------------------------------------------
for (const col of ["avancee", "etape_manuelle"]) ok(!!(await un("select 1 x from information_schema.columns where table_name = 'whatsapp_conversations' and column_name = $1", [col])), `la colonne ${col} existe`);
const droit = async (col) => (await db.query("select privilege_type from information_schema.column_privileges where table_name = 'whatsapp_conversations' and column_name = $1 and grantee = 'authenticated' and privilege_type = 'UPDATE'", [col])).rows.length > 0;
ok(await droit("etape_manuelle"), "authenticated peut écrire etape_manuelle (grant de colonne)");
ok(!(await droit("avancee")), "personne ne peut écrire avancee depuis l'outil");
const x = await un("select has_function_privilege('authenticated', 'whatsapp_etape_outil()', 'execute') a, has_function_privilege('anon', 'whatsapp_etape_outil()', 'execute') b");
ok(x.a === false && x.b === false, "whatsapp_etape_outil() : execute retiré à authenticated et anon");

// ---- La fonction écrit les faits ----------------------------------------------------------------------------------------------------
const lena = await ranger("+447700900311", "How much for a taxi to the pier?");
const tom = await ranger("+447700900422", "Price for the island tour?");
await db.exec(`update whatsapp_conversations set entite_id = '${ent.taxi}', entite_source = 'manuel' where id in ('${lena}', '${tom}')`);
ok((await conv(lena)).avancee === null, "une conversation neuve n'a pas encore de faits (la reprise les calculera)");
await db.query("update whatsapp_conversations set avancee = $1::jsonb where id = $2", [JSON.stringify(FAITS), lena]);
let c = await conv(lena);
ok(c.avancee && c.avancee.prix.taxi === "2026-11-21T01:30:00Z", "la clé de service écrit les faits");
let err = null;
try { await db.query("update whatsapp_conversations set avancee = $1::jsonb where id = $2", [JSON.stringify({ client: true, x: "y".repeat(2100) }), tom]); } catch (e) { err = e.message; }
ok(!!err, "des faits de plus de 2 000 caractères sont refusés");

// ---- Nani choisit une étape -----------------------------------------------------------------------------------------------------------
let r = await essaie(u.nani, "update whatsapp_conversations set etape_manuelle = $1::jsonb where id = $2 returning etape_manuelle, avancee", [JSON.stringify({ taxi: { etape: "reserve", le: "2001-01-01T00:00:00Z" } }), lena]);
ok(r.ok && r.n === 1, "Nani choisit « Réservé » chez Taxi" + (r.ok ? "" : ` (${r.err})`));
const le1 = r.ok ? Date.parse(r.rows[0].etape_manuelle.taxi.le) : 0;
ok(le1 > Date.now() - 60_000, "… à l'heure de la base, pas à la date envoyée par l'écran");
ok(r.ok && r.rows[0].avancee && r.rows[0].avancee.prix.taxi, "… les faits de la fonction restent");
r = await essaie(u.nani, "update whatsapp_conversations set etape_manuelle = $1::jsonb where id = $2 returning etape_manuelle", [JSON.stringify({ taxi: { etape: "reserve", le: "2030-01-01T00:00:00Z" }, secret: { etape: "prix_envoye" } }), lena]);
ok(r.ok && Date.parse(r.rows[0].etape_manuelle.taxi.le) === le1 && r.rows[0].etape_manuelle.secret.etape === "prix_envoye", "un choix inchangé garde son heure ; une autre entreprise s'ajoute");
for (const [nom, valeur] of [["une entreprise inconnue", { ztp: { etape: "reserve" } }], ["une étape inconnue", { taxi: { etape: "paye" } }], ["une valeur qui n'est pas un objet", { taxi: "reserve" }], ["un tableau", [1]]]) {
  r = await essaie(u.nani, "update whatsapp_conversations set etape_manuelle = $1::jsonb where id = $2", [JSON.stringify(valeur), lena]);
  ok(!r.ok, `refusé : ${nom}`);
}
r = await essaie(u.nani, "update whatsapp_conversations set avancee = null where id = $1", [lena]);
ok(!r.ok, "Nani ne peut pas écrire avancee (pas de droit sur la colonne)");
r = await essaie(u.nani, "update whatsapp_conversations set etape_manuelle = '{}'::jsonb where id = $1 returning etape_manuelle", [lena]);
ok(r.ok && r.rows[0].etape_manuelle === null, "un choix vide revient au calcul automatique");
await essaie(u.nani, "update whatsapp_conversations set etape_manuelle = $1::jsonb where id = $2", [JSON.stringify({ taxi: { etape: "termine" } }), lena]);
// La fonction écrit de nouveaux faits : le choix reste.
await db.query("update whatsapp_conversations set avancee = $1::jsonb, etape_manuelle = null where id = $2", [JSON.stringify({ ...FAITS, calcule_le: "2026-11-22T01:00:00Z" }), lena]);
c = await conv(lena);
ok(c.etape_manuelle && c.etape_manuelle.taxi.etape === "termine", "la clé de service ne défait jamais un choix de Nani");
ok(c.avancee.calcule_le === "2026-11-22T01:00:00Z", "… mais met bien les faits à jour");
r = await essaie(u.nani, "update whatsapp_conversations set reponses = 'auto' where id = $1 returning etape_manuelle", [lena]);
ok(r.ok && r.rows[0].etape_manuelle.taxi.etape === "termine", "changer un autre réglage ne touche pas au choix");

// ---- Lecteur seul et Mook -------------------------------------------------------------------------------------------------------------
await essaie(u.nani, "update whatsapp_conversations set entite_id = $1 where id = $2", [ent.secret, tom]);
r = await essaie(u.adminTaxi, "update whatsapp_conversations set etape_manuelle = $1::jsonb where id = $2", [JSON.stringify({ secret: { etape: "reserve" } }), tom]);
ok(r.ok ? r.n === 0 : true, "l'administratrice de Taxi ne choisit pas l'étape d'une conversation rangée chez Secret (lecture seule)" + (r.ok ? ` (${r.n} ligne)` : ""));
r = await essaie(u.mook, "update whatsapp_conversations set etape_manuelle = $1::jsonb where id = $2", [JSON.stringify({ taxi: { etape: "reserve" } }), lena]);
ok(r.ok ? r.n === 0 : true, "Mook ne choisit rien");
ok((await conv(tom)).etape_manuelle === null, "… aucun choix posé");

// ---- Se rejoue sans effet -----------------------------------------------------------------------------------------------------------
const photo = async () => JSON.stringify((await db.query("select id, avancee, etape_manuelle, updated_at from whatsapp_conversations order by id")).rows);
const p1 = await photo();
await db.exec(lire("migration-105-whatsapp-etapes.sql"));
ok((await photo()) === p1, "la migration 105 se rejoue sans effet (aucune ligne touchée)");

// ---- Retour en arrière --------------------------------------------------------------------------------------------------------------
await db.exec(lire("retour-105-whatsapp-etapes.sql"));
ok(!(await un("select 1 x from information_schema.columns where table_name = 'whatsapp_conversations' and column_name in ('avancee', 'etape_manuelle')")), "retour : les deux colonnes sont parties");
ok(!(await un("select 1 x from pg_proc where proname = 'whatsapp_etape_outil'")), "retour : le déclencheur est parti");
ok(!!(await un("select 1 x from information_schema.columns where table_name = 'whatsapp_conversations' and column_name = 'pret_reserver'")), "retour : la migration 85 reste en place");
r = await essaie(u.nani, "update whatsapp_conversations set pret_retire_le = now() where id = $1 returning pret_retire_le", [lena]);
ok(r.ok && r.rows[0].pret_retire_le, "retour : Nani retire toujours une conversation de « Prêt à réserver »");
await db.exec(lire("migration-105-whatsapp-etapes.sql"));
ok(!!(await un("select 1 x from information_schema.columns where table_name = 'whatsapp_conversations' and column_name = 'etape_manuelle'")), "la migration 105 se rejoue après le retour");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
