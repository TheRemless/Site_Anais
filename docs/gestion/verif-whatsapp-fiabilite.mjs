// Vérifie la migration 64 (fiabilité WhatsApp, lot 3 du 20.11.2026) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// Envoi rangé « envoi » puis confirmé ou retiré, un événement ne range qu'un message, essai compté à la réservation, compteur réservé aux
// administrateurs, relance des abandonnés, conservation des événements jamais rangés.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-whatsapp-fiabilite.mjs
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
ok(migrations.includes("migration-64-whatsapp-fiabilite.sql"), "la migration 64 passe après les autres");
await db.exec(lire("migration-64-whatsapp-fiabilite.sql"));
ok(true, "la migration 64 se rejoue sans erreur (idempotente)");

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
for (const k of ["adminSecret", "adminTaxi", "mook", "ztp"]) u[k] = (await db.query("insert into auth.users (email) values ($1) returning id", [k + "@test"])).rows[0].id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Éditeur sans réglages', 'toute', array['dossiers.lire', 'dossiers.ecrire', 'clients.lire', 'clients.ecrire'])`);
const membre = (user, entite, role) => db.exec(`insert into membres values ('${u[user]}', '${entite}', (select id from roles where entite_id = '${entite}' and nom = '${role}')) on conflict do nothing`);
await membre("adminSecret", ent.secret, "Administrateur");
await membre("adminTaxi", ent.taxi, "Administrateur");
await membre("mook", ent.secret, "Éditeur sans réglages");
if (ent.ztp) await membre("ztp", ent.ztp, "Administrateur");

const ranger = async (tel, m) => (await db.query("select whatsapp_ranger($1, $2, null, $3::jsonb) r", [ORG, tel, JSON.stringify(m)])).rows[0].r;
const base = { sens: "entrant", origine: "client", type: "text", medias: [] };

// ---- I8 : un événement ne range qu'un message, même sans id Telnyx ni Meta --------------------------------------------------------
const r1 = await ranger("+66811111111", { ...base, evenement_id: "ev-a", texte: "Hello", envoye_le: "2026-11-20T09:00:00Z" });
const r1b = await ranger("+66811111111", { ...base, evenement_id: "ev-a", texte: "Hello", envoye_le: "2026-11-20T09:00:00Z" });
ok(r1.nouveau === true && r1b.nouveau === false && r1b.message_id === r1.message_id, "un événement rejoué sans identifiant ne range pas deux messages");
const C = r1.conversation_id;
ok((await db.query("select non_lus from whatsapp_conversations where id = $1", [C])).rows[0].non_lus === 1, "… et ne compte pas deux non-lus");
await db.exec(`update whatsapp_conversations set entite_id = '${ent.taxi}', entite_source = 'manuel' where id = '${C}'`);

// ---- I1 : envoi rangé avant l'appel ----------------------------------------------------------------------------------------------
const P = (await db.query("insert into whatsapp_propositions (conversation_id, entite_id, statut, texte) values ($1, $2, 'envoi', 'Hi!') returning id", [C, ent.taxi])).rows[0].id;
const e1 = await ranger("+66811111111", { sens: "sortant", origine: "gestion", type: "text", texte: "Hi!", medias: [], envoye_le: new Date().toISOString(), statut_envoi: "envoi" });
let m = (await db.query("select statut_envoi, telnyx_id, statut_le from whatsapp_messages where id = $1", [e1.message_id])).rows[0];
ok(e1.nouveau && m.statut_envoi === "envoi" && m.telnyx_id === null && m.statut_le, "un envoi depuis Gestion est rangé « envoi », sans id Telnyx");
const app = await ranger("+66811111111", { sens: "sortant", origine: "app", type: "text", texte: "ok", medias: [], telnyx_id: "tx-app", envoye_le: "2026-11-20T09:01:00Z", statut_envoi: "envoi" });
ok((await db.query("select statut_envoi from whatsapp_messages where id = $1", [app.message_id])).rows[0].statut_envoi === null, "un message de l'app ne reçoit jamais de statut « envoi » par le rangement");
let r = await essaie(u.adminTaxi, "update whatsapp_messages set statut_envoi = 'lu'");
ok(!r.ok || r.n === 0, "personne n'écrit un statut depuis l'outil");
let erreur = null;
try { await db.query("update whatsapp_messages set statut_envoi = 'parti' where id = $1", [e1.message_id]); } catch (e) { erreur = e.message; }
ok(erreur && /statut_envoi_check/.test(erreur), "un statut inconnu est refusé par la base");

// Refus sûr de Telnyx : le message est retiré et la conversation redevient « client en attente ».
ok((await db.query("select dernier_sens from whatsapp_conversations where id = $1", [C])).rows[0].dernier_sens === "sortant", "l'envoi rangé marque la conversation répondue");
ok((await db.query("select non_lus from whatsapp_conversations where id = $1", [C])).rows[0].non_lus === 0, "l'envoi rangé remet les non-lus à zéro");
// Le client réécrit après la réponse de l'app : sa question doit redevenir non lue si l'envoi est retiré.
await ranger("+66811111111", { ...base, evenement_id: "ev-b", texte: "And tomorrow?", envoye_le: "2026-11-20T09:02:00Z" });
await db.exec(`update whatsapp_conversations set non_lus = 0 where id = '${C}'`);
ok((await db.query("select whatsapp_retirer_envoi($1) r", [e1.message_id])).rows[0].r === true, "un envoi refusé se retire");
const nl = (await db.query("select non_lus, dernier_sens from whatsapp_conversations where id = $1", [C])).rows[0];
ok(nl.non_lus === 1 && nl.dernier_sens === "entrant", "… la question du client redevient non lue");
const cv = (await db.query("select dernier_sens, dernier_message_le from whatsapp_conversations where id = $1", [C])).rows[0];
ok(new Date(cv.dernier_message_le).toISOString() === "2026-11-20T09:02:00.000Z", "… et le dernier message redevient le précédent");
ok((await db.query("select whatsapp_retirer_envoi($1) r", [app.message_id])).rows[0].r === false, "un message de l'app ne se retire jamais");
r = await essaie(u.adminTaxi, "select whatsapp_retirer_envoi($1)", [app.message_id]);
ok(!r.ok, "whatsapp_retirer_envoi n'est pas ouverte à l'outil");

// « C'est parti » et « Pas parti ».
const e2 = await ranger("+66811111111", { sens: "sortant", origine: "gestion", type: "text", texte: "Hi again", medias: [], envoye_le: new Date().toISOString(), statut_envoi: "envoi" });
r = await essaie(u.mook, "select whatsapp_confirmer_envoi($1, true) r", [C]);
ok(!r.ok, "Mook ne confirme pas un envoi");
r = await essaie(u.adminSecret, "select whatsapp_confirmer_envoi($1, true) r", [C]);
ok(!r.ok, "l'administrateur de Secret ne confirme pas un envoi d'une conversation de Taxi (lecture seule)");
r = await essaie(u.adminTaxi, "select whatsapp_confirmer_envoi($1, false) r", [C]);
ok(r.ok && r.rows[0].r.messages === 1 && r.rows[0].r.propositions === 1, "« Pas parti » : le message sort du fil, la réponse redevient à faire");
ok((await db.query("select count(*)::int n from whatsapp_messages where id = $1", [e2.message_id])).rows[0].n === 0 && (await db.query("select statut from whatsapp_propositions where id = $1", [P])).rows[0].statut === "a_faire", "… vérifié en base");
await db.exec(`update whatsapp_propositions set statut = 'envoi' where id = '${P}'`);
const e3 = await ranger("+66811111111", { sens: "sortant", origine: "gestion", type: "text", texte: "Hi again", medias: [], envoye_le: new Date().toISOString(), statut_envoi: "envoi" });
await db.query("update whatsapp_messages set statut_envoi = 'echec', erreur_envoi = 'sans_confirmation' where id = $1", [e3.message_id]);
r = await essaie(u.adminTaxi, "select whatsapp_confirmer_envoi($1, true) r", [C]);
m = (await db.query("select statut_envoi, erreur_envoi from whatsapp_messages where id = $1", [e3.message_id])).rows[0];
const pr = (await db.query("select statut, traitee_par, traitee_par_quoi from whatsapp_propositions where id = $1", [P])).rows[0];
ok(r.ok && m.statut_envoi === "envoye" && m.erreur_envoi === null, "« C'est parti » après 5 minutes : le message reste, « envoyé »");
ok(pr.statut === "traitee" && pr.traitee_par === u.adminTaxi && pr.traitee_par_quoi === "gestion", "… et la réponse est soldée, par qui");
await db.query("update whatsapp_messages set statut_envoi = 'echec', erreur_envoi = '40008 refus' where id = $1", [e3.message_id]);
r = await essaie(u.adminTaxi, "select whatsapp_confirmer_envoi($1, false) r", [C]);
ok(r.ok && (await db.query("select count(*)::int n from whatsapp_messages where id = $1", [e3.message_id])).rows[0].n === 1, "un refus de WhatsApp n'est pas un doute : « Pas parti » ne l'efface pas");

// ---- I2 : réservation qui compte l'essai, compteur, relance ----------------------------------------------------------------------
const ev = (id, o = "") => db.query(`insert into whatsapp_evenements (id, type, organisation_id, brut${o ? ", " + o.split("=")[0] : ""}) values ($1, 'message.received', $2, '{}'::jsonb${o ? ", " + o.split("=")[1] : ""})`, [id, ORG]);
await ev("ev-1");
let res = (await db.query("select * from whatsapp_reserver_evenement('ev-1')")).rows;
ok(res.length === 1 && res[0].essais === 1, "réservé : l'essai est compté tout de suite");
ok((await db.query("select * from whatsapp_reserver_evenement('ev-1')")).rows.length === 0, "une deuxième instance ne le prend pas pendant 2 minutes");
await db.exec("update whatsapp_evenements set pris_le = now() - interval '3 minutes' where id = 'ev-1'");
res = (await db.query("select * from whatsapp_reserver_evenement('ev-1')")).rows;
ok(res.length === 1 && res[0].essais === 2, "une instance tuée en route : repris après 2 minutes, et cet essai compte");
await db.exec("update whatsapp_evenements set pris_le = null, essais = 5, erreur = 'panne' where id = 'ev-1'");
ok((await db.query("select * from whatsapp_reserver_evenement('ev-1')")).rows.length === 0, "après 5 essais, plus repris");
await db.exec("insert into whatsapp_evenements (id, type, organisation_id, brut, erreur, essais) values ('ev-2', 'message.received', '" + ORG + "', '{}'::jsonb, 'délai', 2)");
await db.exec("insert into whatsapp_evenements (id, type, organisation_id, brut, recu_le) values ('ev-3', 'message.received', '" + ORG + "', '{}'::jsonb, now() - interval '20 minutes')");
await db.exec("insert into whatsapp_evenements (id, type, organisation_id, brut, traite_le) values ('ev-4', 'message.received', '" + ORG + "', '{}'::jsonb, now())");
await db.exec("insert into whatsapp_evenements (id, type, organisation_id, brut, erreur, essais) values ('ev-5', 'message.sent', '" + ORG + "', '{}'::jsonb, 'attente: statut_message_inconnu', 1)");
r = await essaie(u.adminTaxi, "select whatsapp_etat_reception() e");
const et = r.ok ? r.rows[0].e : {};
ok(r.ok && et.abandonnes === 1 && et.en_erreur === 1 && et.en_retard === 1 && et.derniere_erreur === "délai", "compteur : 1 abandonné, 1 en erreur, 1 en retard, dernière erreur lisible");
r = await essaie(u.mook, "select whatsapp_etat_reception() e");
ok(r.ok && r.rows[0].e === null, "Mook ne lit pas le compteur");
if (ent.ztp) { r = await essaie(u.ztp, "select whatsapp_etat_reception() e"); ok(r.ok && r.rows[0].e === null, "l'administratrice de ZTP non plus"); }
r = await essaie(u.adminTaxi, "select * from whatsapp_evenements");
ok(!r.ok || r.rows.length === 0, "les événements bruts restent illisibles depuis l'outil");
r = await essaie(u.mook, "select whatsapp_relancer_evenements() n");
ok(r.ok && r.rows[0].n === 0, "Mook ne relance rien");
r = await essaie(u.adminSecret, "select whatsapp_relancer_evenements() n");
ok(r.ok && r.rows[0].n === 1 && (await db.query("select essais from whatsapp_evenements where id = 'ev-1'")).rows[0].essais === 0, "un administrateur remet l'abandonné en file");
r = await essaie(u.adminTaxi, "select * from whatsapp_reserver_evenement('ev-2')");
ok(!r.ok, "la réservation n'est pas ouverte à l'outil");

// ---- Conservation : un événement jamais rangé reste 90 jours ---------------------------------------------------------------------
await db.exec(`insert into whatsapp_evenements (id, type, organisation_id, brut, recu_le) values ('ev-vieux-ok', 'x', '${ORG}', '{}'::jsonb, now() - interval '40 days')`);
await db.exec(`update whatsapp_evenements set traite_le = now() - interval '40 days' where id = 'ev-vieux-ok'`);
await db.exec(`insert into whatsapp_evenements (id, type, organisation_id, brut, recu_le, erreur) values ('ev-vieux-ko', 'x', '${ORG}', '{}'::jsonb, now() - interval '40 days', 'panne')`);
await db.exec(`insert into whatsapp_evenements (id, type, organisation_id, brut, recu_le, erreur) values ('ev-tres-vieux', 'x', '${ORG}', '{}'::jsonb, now() - interval '100 days', 'panne')`);
await db.query("select * from purger_whatsapp($1)", [ORG]);
const restent = (await db.query("select id from whatsapp_evenements where id like 'ev-%vieux%' order by id")).rows.map((x) => x.id);
ok(JSON.stringify(restent) === JSON.stringify(["ev-vieux-ko"]), "purge : traité à 30 jours, jamais rangé à 90 jours");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
