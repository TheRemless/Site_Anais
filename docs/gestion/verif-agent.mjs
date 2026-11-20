// Vérifie la migration 52 (agent de l'onglet « Assistant ») sur un Postgres en mémoire : chaque personne ne voit que ses conversations, ses
// messages et ses cartes, dans une entreprise où elle écrit des dossiers ; les messages ne se modifient pas ; une carte décidée garde son
// contenu ; la conservation ne supprime que les siennes ; la table des temps de trajet et les liaisons de ferry suivent les droits de la base
// de prix ; le journal accepte « agent ».
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-agent.mjs . && GESTION_SQL=<repo>/docs/gestion/ node verif-agent.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
let echecs = 0;
const ok = (c, msg) => { if (!c) { echecs++; console.log("  ECHEC:", msg); } else console.log("  ok:", msg); };
// Comme Supabase : toute nouvelle table du schéma public est d'abord ouverte à anon et authenticated, la migration doit la refermer elle-même.
const harnais = `
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema public, auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
const db = new PGlite();
await db.exec(harnais);
await db.exec((fs.readFileSync(W + "schema.sql", "utf8") + fs.readFileSync(W + "donnees-ztp-depart.sql", "utf8")).replace("create extension if not exists pgcrypto;", ""));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
for (const f of migrations) await db.exec(fs.readFileSync(W + f, "utf8"));
ok(migrations.includes("migration-52-agent-conversations.sql"), "la migration 52 est appliquée, après les autres");
await db.exec(fs.readFileSync(W + "migration-52-agent-conversations.sql", "utf8"));
ok(true, "la migration 52 se rejoue sans erreur");

const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const ent = {};
for (const s of ["ztp", "secret", "taxi"]) ent[s] = (await un("select id from entites where slug = $1", [s])).id;
const essaie = async (role, userId, sql, params = []) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
};
const U = {};
for (const k of ["anais", "lecteur", "stagiaire", "ztp"]) U[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
const comme = (u, sql, p) => essaie("authenticated", U[u], sql, p);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Ses dossiers', 'mes_dossiers', array['clients.lire','clients.ecrire','dossiers.lire','dossiers.ecrire'])`);
const membre = (u, s, role) => db.exec(`insert into membres values ('${U[u]}', '${ent[s]}', (select id from roles where entite_id = '${ent[s]}' and nom = '${role}'))`);
await membre("anais", "secret", "Administrateur");
await membre("lecteur", "secret", "Lecteur");
await membre("stagiaire", "secret", "Ses dossiers");
await membre("ztp", "ztp", "Éditeur");

const sous = async (u, sql, p) => comme(u, sql, p);
const conv = async (u, e) => comme(u, `insert into agent_conversations (entite_id, titre) values ('${ent[e]}', 'Course Jai Tiki') returning id, user_id`);

console.log("== Le public ne lit ni n'écrit rien ==");
for (const t of ["agent_conversations", "agent_messages", "agent_cartes", "temps_trajets", "liaisons_ferry", "lieux_geo", "trajets_ors"]) ok((await essaie("anon", null, `select 1 from ${t}`)).ok === false, `anon ne lit pas ${t}`);

console.log("== Conversations : à la personne qui les ouvre ==");
const c1 = await conv("anais", "secret");
ok(c1.ok && c1.rows[0].user_id === U.anais, "Anaïs ouvre une conversation chez Secret, à son nom");
ok(!(await conv("lecteur", "secret")).ok, "un lecteur (sans « dossiers.ecrire ») ne peut pas en ouvrir");
ok(!(await conv("anais", "ztp")).ok, "Anaïs n'en ouvre pas dans une entreprise dont elle n'est pas membre");
const usurpe = await comme("anais", `insert into agent_conversations (entite_id, titre, user_id) values ('${ent.secret}', 'x', '${U.lecteur}') returning user_id`);
ok(!usurpe.ok || usurpe.rows[0].user_id === U.anais, "la personne d'une conversation est celle de la session, jamais celle envoyée");
const id = c1.rows[0].id;
const c2 = await conv("stagiaire", "secret");
ok(!c2.ok, "un rôle sans la base de prix n'ouvre pas de conversation (« partenaires.lire » exigé)");
await membre("ztp", "secret", "Éditeur");
const c3 = await conv("ztp", "secret");
ok(c3.ok, "une autre personne avec les droits ouvre la sienne");
const voitConv = async (u) => ((await comme(u, "select id from agent_conversations")).rows || []).map((r) => r.id);
const siennes = ((await essaie("postgres", null, `select id from agent_conversations where user_id = '${U.anais}' order by id`)).rows || []).map((r) => r.id);
ok(JSON.stringify((await voitConv("anais")).sort()) === JSON.stringify(siennes) && siennes.includes(id), "Anaïs ne voit que ses conversations");
ok(!(await voitConv("ztp")).includes(id), "une autre personne de la même entreprise ne voit pas celle d'Anaïs");

console.log("== Messages : ajoutés, jamais modifiés ==");
ok((await comme("anais", `insert into agent_messages (conversation_id, role, contenu) values ('${id}', 'user', '[{"type":"text","text":"Pickup Jai Tiki"}]') returning id`)).ok, "Anaïs ajoute un message à sa conversation");
ok(!(await comme("ztp", `insert into agent_messages (conversation_id, role, contenu) values ('${id}', 'user', '[]')`)).ok, "une autre personne n'écrit pas dans la conversation d'Anaïs");
ok(((await comme("ztp", `select id from agent_messages where conversation_id = '${id}'`)).rows || []).length === 0, "ni ne lit ses messages");
ok(!(await comme("anais", `update agent_messages set contenu = '[]' where conversation_id = '${id}'`)).ok, "un message ne se modifie pas");

console.log("== Cartes : proposées, puis décidées ==");
const k = await comme("anais", `insert into agent_cartes (conversation_id, genre, titre, donnees) values ('${id}', 'dossier', 'Dossier', '{"prix":null}') returning id`);
ok(k.ok, "une carte proposée s'ajoute");
ok(!(await comme("anais", `insert into agent_cartes (conversation_id, genre, titre, statut) values ('${id}', 'reponse', 'x', 'validee')`)).ok, "une carte ne naît pas validée");
const d = await comme("anais", `update agent_cartes set statut = 'validee', donnees = '{"prix":9999}' where id = '${k.rows[0].id}' returning statut, donnees, decide_le`);
ok(d.ok && d.rows[0].statut === "validee" && d.rows[0].donnees.prix === null && d.rows[0].decide_le, "valider change le sort et la date, jamais le contenu proposé");
ok(((await comme("ztp", `update agent_cartes set statut = 'ecartee' where id = '${k.rows[0].id}' returning id`)).rows || []).length === 0, "une autre personne ne décide pas des cartes d'Anaïs");

console.log("== Conservation ==");
await essaie("postgres", null, `update agent_conversations set maj_le = now() - interval '120 days'`);
const p = await comme("ztp", "select purger_agent_conversations(90) as n");
ok(p.ok && p.rows[0].n === 1, "la conservation ne supprime que les conversations de la personne qui la lance");
ok(((await essaie("postgres", null, `select id from agent_conversations where id = '${id}'`)).rows || []).length === 1, "celle d'Anaïs reste");
const p2 = await comme("anais", "select purger_agent_conversations(90) as n");
ok(p2.ok && p2.rows[0].n === siennes.length && ((await essaie("postgres", null, `select id from agent_messages`)).rows || []).length === 0 && ((await essaie("postgres", null, `select id from agent_cartes`)).rows || []).length === 0, "les siennes partent avec leurs messages et leurs cartes");

console.log("== Temps de trajet et liaisons de ferry ==");
const tt = (u, e, de) => comme(u, `insert into temps_trajets (entite_id, de, vers, cle, duree_min, ferry, source) values ('${ent[e]}', '${de}', 'Krabi Airport', '${de} | krabi airport', 150, true, 'Mr. Brown') returning id, maj_par, a_verifier`);
const t1 = await tt("anais", "secret", "Koh Lanta");
ok(t1.ok && t1.rows[0].maj_par === U.anais && t1.rows[0].a_verifier === true, "Anaïs ajoute une durée (à vérifier par défaut), la base note l'auteur");
ok(!(await tt("lecteur", "secret", "Ao Nang")).ok, "un lecteur n'ajoute pas de durée");
ok(((await comme("lecteur", "select id from temps_trajets")).rows || []).length === 1, "un lecteur de Secret la lit (base de prix)");
ok(((await comme("stagiaire", "select id from temps_trajets")).rows || []).length === 0, "un rôle sans la base de prix ne la lit pas");
ok(!(await tt("anais", "secret", "Koh Lanta")).ok, "une paire n'existe qu'une fois par entreprise");
ok(!(await comme("anais", `insert into temps_trajets (entite_id, de, vers, cle, duree_min) values ('${ent.secret}', 'a', 'b', 'a | b', 0)`)).ok, "une durée nulle est refusée");
const lf = await comme("anais", `insert into liaisons_ferry (entite_id, nom, cote_ile, port_ile, port_continent) values ('${ent.secret}', 'Ferry de Koh Lanta', 'Koh Lanta', 'Khlong Mak', 'Krabi-Koh Lanta') returning duree_min`);
ok(lf.ok && lf.rows[0].duree_min === 60, "une liaison de ferry compte 60 min par défaut");
ok(((await comme("ztp", "select id from liaisons_ferry")).rows || []).length === 1, "l'éditeur ajouté à Secret la lit");
ok(((await comme("anais", `select id from temps_trajets where entite_id = '${ent.ztp}'`)).rows || []).length === 0, "rien d'une entreprise dont on n'est pas membre");

console.log("== Journal et coût du mois ==");
ok((await essaie("postgres", null, `insert into assistant_journal (user_id, entite_id, usage, statut, cout_estime_usd) values ('${U.anais}', '${ent.secret}', 'agent', 'ok', 0.05) returning id`)).ok, "le journal accepte l'usage « agent »");
ok(!(await comme("anais", "select assistant_cout_depuis(now() - interval '1 day')")).ok, "une personne ne lit pas la dépense du mois (fonction réservée à la clé de service)");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
