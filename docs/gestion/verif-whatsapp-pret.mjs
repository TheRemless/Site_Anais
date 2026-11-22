// Vérifie la migration 85 (filtre « Prêt à réserver » de l'écran WhatsApp) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// La clé de service écrit la décision (pret_reserver) mais ne défait jamais un retrait de Nani ; un administrateur retire la conversation
// (pret_retire_le daté par la base, jamais une date choisie par l'écran) ou annule le retrait, sans pouvoir écrire la décision ; un lecteur seul
// et Mook n'écrivent rien ; la contrainte borne la décision ; la migration se rejoue ; retour en arrière.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-whatsapp-pret.mjs
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
ok(migrations.indexOf("migration-85-whatsapp-pret.sql") > migrations.indexOf("migration-68-contacts-apporteurs.sql"), "la migration 85 passe après la 68, sur une base vide");

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
const conv = (id) => un("select pret_reserver, pret_retire_le from whatsapp_conversations where id = $1", [id]);
const DECISION = { pret: true, le: "2026-11-21T02:16:04Z", depuis: "2026-11-20T08:55:00Z", message_id: null, source: "nani", motif: "confirmation", carte: { depart: "Hôtel A", arrivee: "Aéroport de Krabi", prix: "2,300 THB" }, calcule_le: "2026-11-22T00:00:00Z" };

// ---- Structure --------------------------------------------------------------------------------------------------------------------
for (const col of ["pret_reserver", "pret_retire_le"]) ok(!!(await un("select 1 x from information_schema.columns where table_name = 'whatsapp_conversations' and column_name = $1", [col])), `la colonne ${col} existe`);
const droit = async (col) => (await db.query("select privilege_type from information_schema.column_privileges where table_name = 'whatsapp_conversations' and column_name = $1 and grantee = 'authenticated' and privilege_type = 'UPDATE'", [col])).rows.length > 0;
ok(await droit("pret_retire_le"), "authenticated peut écrire pret_retire_le (grant de colonne)");
ok(!(await droit("pret_reserver")), "personne ne peut écrire pret_reserver depuis l'outil");
const x = await un("select has_function_privilege('authenticated', 'whatsapp_pret_outil()', 'execute') a, has_function_privilege('anon', 'whatsapp_pret_outil()', 'execute') b");
ok(x.a === false && x.b === false, "whatsapp_pret_outil() : execute retiré à authenticated et anon");

// ---- La fonction écrit la décision ----------------------------------------------------------------------------------------------------
const lena = await ranger("+447700900311", "Ok, book it please");
const tom = await ranger("+447700900422", "Yes");
await db.exec(`update whatsapp_conversations set entite_id = '${ent.taxi}', entite_source = 'manuel' where id in ('${lena}', '${tom}')`);
ok((await conv(lena)).pret_reserver === null, "une conversation neuve n'a pas encore de décision (la reprise la calculera)");
await db.query("update whatsapp_conversations set pret_reserver = $1::jsonb where id = $2", [JSON.stringify(DECISION), lena]);
let c = await conv(lena);
ok(c.pret_reserver && c.pret_reserver.pret === true && c.pret_reserver.carte.prix === "2,300 THB", "la clé de service écrit la décision");
let err = null;
try { await db.query("update whatsapp_conversations set pret_reserver = $1::jsonb where id = $2", [JSON.stringify({ pret: true, carte: { nom: "x".repeat(2100) } }), tom]); } catch (e) { err = e.message; }
ok(!!err, "une décision de plus de 2 000 caractères est refusée");
err = null;
try { await db.query("update whatsapp_conversations set pret_reserver = '[1, 2]'::jsonb where id = $1", [tom]); } catch (e) { err = e.message; }
ok(!!err, "une décision qui n'est pas un objet est refusée");

// ---- Nani retire la conversation --------------------------------------------------------------------------------------------------
let r = await essaie(u.nani, "update whatsapp_conversations set pret_retire_le = '2001-01-01T00:00:00Z' where id = $1 returning pret_retire_le, pret_reserver", [lena]);
ok(r.ok && r.n === 1, "Nani retire la conversation du filtre" + (r.ok ? "" : ` (${r.err})`));
const retire = r.ok ? new Date(r.rows[0].pret_retire_le).getTime() : 0;
ok(retire > Date.now() - 60_000, "… à l'heure de la base, pas à la date envoyée par l'écran");
ok(r.ok && r.rows[0].pret_reserver && r.rows[0].pret_reserver.pret === true, "… la décision de la fonction reste");
r = await essaie(u.nani, "update whatsapp_conversations set pret_reserver = null where id = $1", [lena]);
ok(!r.ok, "Nani ne peut pas écrire pret_reserver (pas de droit sur la colonne)");
ok((await conv(lena)).pret_reserver.pret === true, "… la décision n'a pas changé");
// La fonction écrit une nouvelle décision : le retrait reste.
await db.query("update whatsapp_conversations set pret_reserver = $1::jsonb, pret_retire_le = null where id = $2", [JSON.stringify({ ...DECISION, calcule_le: "2026-11-22T01:00:00Z" }), lena]);
c = await conv(lena);
ok(c.pret_retire_le && new Date(c.pret_retire_le).getTime() === retire, "la clé de service ne défait jamais un retrait de Nani");
ok(c.pret_reserver.calcule_le === "2026-11-22T01:00:00Z", "… mais met bien la décision à jour");
await db.query("update whatsapp_conversations set tri = '{\"motif\":\"remerciement\"}'::jsonb where id = $1", [lena]);
ok((await conv(lena)).pret_retire_le !== null, "le tri écrit par la fonction laisse le retrait");
r = await essaie(u.nani, "update whatsapp_conversations set reponses = 'auto' where id = $1 returning pret_retire_le", [lena]);
ok(r.ok && new Date(r.rows[0].pret_retire_le).getTime() === retire, "changer un autre réglage ne touche pas au retrait");
r = await essaie(u.nani, "update whatsapp_conversations set pret_retire_le = null where id = $1 returning pret_retire_le", [lena]);
ok(r.ok && r.rows[0].pret_retire_le === null, "« Annuler » : Nani remet le retrait à vide");

// ---- Lecteur seul et Mook -------------------------------------------------------------------------------------------------------------
await essaie(u.nani, "update whatsapp_conversations set entite_id = $1 where id = $2", [ent.secret, tom]);
r = await essaie(u.adminTaxi, "update whatsapp_conversations set pret_retire_le = now() where id = $1", [tom]);
ok(r.ok ? r.n === 0 : true, "l'administratrice de Taxi ne retire pas une conversation rangée chez Secret (lecture seule)" + (r.ok ? ` (${r.n} ligne)` : ""));
r = await essaie(u.mook, "update whatsapp_conversations set pret_retire_le = now() where id = $1", [lena]);
ok(r.ok ? r.n === 0 : true, "Mook ne retire rien");
ok((await conv(tom)).pret_retire_le === null && (await conv(lena)).pret_retire_le === null, "… aucun retrait posé");
r = await essaie(u.adminTaxi, "update whatsapp_conversations set pret_retire_le = now() where id = $1 returning pret_retire_le", [lena]);
ok(r.ok && r.n === 1, "l'administratrice de Taxi retire une conversation rangée chez Taxi");

// ---- Un client appartient à Secret et à Taxi : relier sans ranger (whatsapp_reclasser, migration 85) --------------------------------
const fiche = async (e, tel) => (await un("insert into clients (entite_id, prenom, nom, telephone) values ($1, 'Test', 'Client', $2) returning id", [ent[e], tel])).id;
let nDos = 0;
const dos = async (e, k) => (await un("insert into dossiers (entite_id, ref, client_id) values ($1, $2, $3) returning id", [ent[e], `${e.toUpperCase()}-85-${++nDos}`, k])).id;
const sam = await ranger("+447700900555", "We would like the airport transfer, yes please");
const kS = await fiche("secret", "+44 7700 900555"), kT = await fiche("taxi", "+44 7700 900555"), kZ = await fiche("ztp", "+44 7700 900555");
const dS = await dos("secret", kS), dT = await dos("taxi", kT), dZ = await dos("ztp", kZ);
const lien = (id) => un("select entite_id, client_id, dossier_id from whatsapp_conversations where id = $1", [id]);
r = await essaie(u.nani, "update whatsapp_conversations set client_id = $1, dossier_id = $2 where id = $3 returning entite_id, client_id, dossier_id", [kT, dT, sam]);
ok(r.ok && r.rows[0].entite_id === null && r.rows[0].dossier_id === dT && r.rows[0].client_id === kT, "client à trier : relié au dossier Taxi sans être rangé" + (r.ok ? "" : ` (${r.err})`));
r = await essaie(u.nani, "update whatsapp_conversations set client_id = $1, dossier_id = $2 where id = $3 returning entite_id, dossier_id", [kS, dS, sam]);
ok(r.ok && r.rows[0].entite_id === null && r.rows[0].dossier_id === dS, "… puis au dossier Secret, toujours commun");
await essaie(u.nani, "update whatsapp_conversations set entite_id = $1 where id = $2", [ent.taxi, sam]);
r = await essaie(u.nani, "update whatsapp_conversations set client_id = $1, dossier_id = $2 where id = $3 returning entite_id, dossier_id", [kS, dS, sam]);
ok(r.ok && r.rows[0].dossier_id === dS, "rangé chez Taxi, un dossier Secret se relie quand même");
r = await essaie(u.nani, "update whatsapp_conversations set entite_id = null, client_id = $1, dossier_id = $2 where id = $3 returning entite_id, dossier_id", [kT, dT, sam]);
ok(r.ok && r.rows[0].entite_id === null && r.rows[0].dossier_id === dT, "rangé dans l'autre entreprise : redevient commun en se reliant");
r = await essaie(u.nani, "update whatsapp_conversations set client_id = $1, dossier_id = $2 where id = $3 returning dossier_id, client_id", [kZ, dZ, sam]);
ok(r.ok && r.rows[0].dossier_id === null && r.rows[0].client_id === null, "jamais un dossier ou une fiche ZTP");
r = await essaie(u.nani, "update whatsapp_conversations set client_id = $1, dossier_id = $2 where id = $3 returning dossier_id", [kS, dT, sam]);
ok(r.ok && r.rows[0].dossier_id === null, "un dossier qui n'est pas celui de la fiche est retiré");
// Une administratrice de Taxi seulement ne relie pas un dossier de Secret.
await essaie(u.nani, "update whatsapp_conversations set client_id = null, dossier_id = null where id = $1", [sam]);
r = await essaie(u.adminTaxi, "update whatsapp_conversations set client_id = $1, dossier_id = $2 where id = $3 returning dossier_id", [kS, dS, sam]);
ok(r.ok && r.n === 1 && r.rows[0].dossier_id === null, "l'administratrice de Taxi seule ne relie pas un dossier de Secret");
r = await essaie(u.adminTaxi, "update whatsapp_conversations set client_id = $1, dossier_id = $2 where id = $3 returning dossier_id", [kT, dT, sam]);
ok(r.ok && r.rows[0].dossier_id === dT, "… mais relie un dossier de Taxi");
// Un contact qui n'est pas un client garde la règle d'avant.
const hotel = await ranger("+447700900566", "Room 12 is ready");
await essaie(u.nani, "update whatsapp_conversations set type_contact = 'hotel' where id = $1", [hotel]);
r = await essaie(u.nani, "update whatsapp_conversations set client_id = $1, dossier_id = $2 where id = $3 returning dossier_id", [kT, dT, hotel]);
ok(r.ok && r.rows[0].dossier_id === null, "un hôtel à trier n'est relié à aucun dossier (règle d'avant)");
// La fonction (clé de service) relie aussi un client sans le ranger (liaison après une demande du site), depuis un lien vide (un lien posé
// n'est jamais écrasé par elle, whatsapp_proteger_classement).
await essaie(u.nani, "update whatsapp_conversations set client_id = null, dossier_id = null where id = $1", [sam]);
await db.query("update whatsapp_conversations set client_id = $1, dossier_id = $2 where id = $3", [kS, dS, sam]);
ok((await lien(sam)).dossier_id === dS, "la clé de service relie un client à un dossier Secret");

// ---- Se rejoue sans effet -----------------------------------------------------------------------------------------------------------
const photo = async () => JSON.stringify((await db.query("select id, pret_reserver, pret_retire_le, updated_at from whatsapp_conversations order by id")).rows);
const p1 = await photo();
await db.exec(lire("migration-85-whatsapp-pret.sql"));
ok((await photo()) === p1, "la migration 85 se rejoue sans effet (aucune ligne touchée)");

// ---- Retour en arrière --------------------------------------------------------------------------------------------------------------
await db.exec(lire("retour-85-whatsapp-pret.sql"));
ok(!(await un("select 1 x from information_schema.columns where table_name = 'whatsapp_conversations' and column_name in ('pret_reserver', 'pret_retire_le')")), "retour : les deux colonnes sont parties");
ok(!(await un("select 1 x from pg_proc where proname = 'whatsapp_pret_outil'")), "retour : le déclencheur est parti");
r = await essaie(u.nani, "update whatsapp_conversations set client_id = $1, dossier_id = $2 where id = $3 returning dossier_id", [kT, dT, sam]);
ok(r.ok && r.rows[0].dossier_id === null, "retour : whatsapp_reclasser de la migration 72 (une conversation à trier n'a plus de dossier)");
await ranger("+447700900877", "Hi");
ok(!!(await un("select 1 x from whatsapp_conversations where telephone = '+447700900877'")), "retour : la fonction range toujours un nouveau contact");
r = await essaie(u.nani, "update whatsapp_conversations set reponses = 'jamais' where id = $1 returning reponses", [tom]);
ok(r.ok && r.rows[0].reponses === "jamais", "retour : Nani range toujours ses conversations");
await db.exec(lire("migration-85-whatsapp-pret.sql"));
ok(!!(await un("select 1 x from information_schema.columns where table_name = 'whatsapp_conversations' and column_name = 'pret_retire_le'")), "la migration 85 se rejoue après le retour");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
