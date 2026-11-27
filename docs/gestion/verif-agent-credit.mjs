// Vérifie la migration 54 (crédit de l'assistant et apprentissages de l'agent) sur un Postgres en mémoire : le plafond ne se règle que par
// l'administratrice générale, la dépense ne se lit que par les administratrices, le verrou des alertes reste à la clé de service, les
// corrections se notent par qui utilise l'agent, se lisent dans l'entreprise, se suppriment par l'administration et ne se modifient pas.
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-agent-credit.mjs . && GESTION_SQL=<repo>/docs/gestion/ node verif-agent-credit.mjs
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
ok(migrations.includes("migration-54-agent-credit-apprentissages.sql"), "la migration 54 est appliquée, après les autres");
await db.exec(fs.readFileSync(W + "migration-54-agent-credit-apprentissages.sql", "utf8"));
ok(true, "la migration 54 se rejoue sans erreur");

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
for (const k of ["jeremy", "anais", "nani", "lecteur", "ztp"]) U[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
await db.exec(`update profils set super_admin = (user_id = '${U.jeremy}'), actif = true`);
const comme = (u, sql, p) => essaie("authenticated", U[u], sql, p);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Assistante', 'toute', array['clients.lire','clients.ecrire','dossiers.lire','dossiers.ecrire','partenaires.lire'])`);
const membre = (u, s, role) => db.exec(`insert into membres values ('${U[u]}', '${ent[s]}', (select id from roles where entite_id = '${ent[s]}' and nom = '${role}'))`);
await membre("anais", "secret", "Administrateur");
await membre("nani", "secret", "Assistante");
await membre("lecteur", "secret", "Lecteur");
await membre("ztp", "ztp", "Éditeur");

console.log("== Plafond du mois ==");
const b0 = await un("select plafond_mois_usd, seuil_alerte_pct from assistant_budget");
ok(Number(b0.plafond_mois_usd) === 50 && b0.seuil_alerte_pct === 80, "plafond de 50 $ et alerte à 80 % par défaut");
ok(!(await comme("anais", "select * from assistant_budget")).ok, "la table du plafond ne se lit pas directement");
ok(!(await comme("anais", "select * from assistant_alertes")).ok, "le verrou des alertes ne se lit pas depuis l'outil");
await essaie("postgres", null, `insert into assistant_journal (user_id, entite_id, usage, statut, cout_estime_usd) values ('${U.nani}', '${ent.secret}', 'agent', 'ok', 12.5), ('${U.ztp}', '${ent.ztp}', 'lire', 'ok', 0.5)`);
const etatAnais = (await comme("anais", "select assistant_budget_etat() e")).rows[0].e;
ok(etatAnais && Number(etatAnais.cout_mois) === 13 && Number(etatAnais.plafond) === 50 && etatAnais.peut_regler === false, "une administratrice lit la dépense du mois de tout l'assistant, sans pouvoir régler");
ok((await comme("nani", "select assistant_budget_etat() e")).rows[0].e === null, "l'assistante ne lit pas la dépense");
ok((await comme("lecteur", "select assistant_budget_etat() e")).rows[0].e === null, "un lecteur non plus");
ok((await comme("jeremy", "select assistant_budget_etat() e")).rows[0].e.peut_regler === true, "l'administratrice générale peut régler");
ok(!(await comme("anais", "select regler_plafond_assistant(80, 85::smallint)")).ok, "une administratrice d'entreprise ne règle pas le plafond");
ok((await comme("jeremy", "select regler_plafond_assistant(80, 85::smallint)")).ok, "Jérémy règle le plafond");
const b1 = await un("select plafond_mois_usd, seuil_alerte_pct, maj_par from assistant_budget");
ok(Number(b1.plafond_mois_usd) === 80 && b1.seuil_alerte_pct === 85 && b1.maj_par === U.jeremy, "plafond, seuil et auteur enregistrés");
ok((await comme("jeremy", "select regler_plafond_assistant(60)")).ok && (await un("select seuil_alerte_pct s from assistant_budget")).s === 85, "le seuil reste celui d'avant s'il n'est pas donné");
ok(!(await comme("jeremy", "select regler_plafond_assistant(5000)")).ok, "un plafond au-delà de 1 000 $ est refusé");
ok(!(await comme("jeremy", "select regler_plafond_assistant(50, 10::smallint)")).ok, "un seuil sous 50 % est refusé");
ok(!(await essaie("anon", null, "select assistant_budget_etat()")).ok, "un visiteur anonyme ne lit rien");

console.log("== Apprentissages ==");
const conv = (await comme("nani", `insert into agent_conversations (entite_id, titre) values ('${ent.secret}', 'Course Jai Tiki') returning id`)).rows[0].id;
const carte = (await comme("nani", `insert into agent_cartes (conversation_id, genre, titre) values ('${conv}', 'dossier', 'Course') returning id`)).rows[0].id;
const note = await comme("nani", `insert into agent_apprentissages (entite_id, carte_id, genre, contexte, avant, apres, user_id, cree_le) values ('${ent.secret}', '${carte}', 'pickup', 'Jai Tiki → Krabi Nakharin', '12:55', '12:40', '${U.anais}', now() - interval '2 years') returning user_id, cree_le, carte_id`);
ok(note.ok && note.rows[0].user_id === U.nani && Date.now() - Date.parse(note.rows[0].cree_le) < 60000 && note.rows[0].carte_id === carte, "Nani note une correction ; auteur et date posés par la base");
ok(!(await comme("lecteur", `insert into agent_apprentissages (entite_id, genre, avant, apres) values ('${ent.secret}', 'pickup', '1', '2')`)).ok, "un lecteur ne note rien");
ok(!(await comme("nani", `insert into agent_apprentissages (entite_id, genre, avant, apres) values ('${ent.ztp}', 'pickup', '1', '2')`)).ok, "rien dans une entreprise dont on n'est pas membre");
ok(!(await comme("nani", `insert into agent_apprentissages (entite_id, genre, avant, apres) values ('${ent.secret}', 'net', '1', '2')`)).ok, "un genre inconnu est refusé");
const autreCarte = await essaie("postgres", U.ztp, `with c as (insert into agent_conversations (entite_id, titre) values ('${ent.ztp}', 'x') returning id) insert into agent_cartes (conversation_id, genre) select id, 'reponse' from c returning id`);
const croise = await comme("nani", `insert into agent_apprentissages (entite_id, carte_id, genre, avant, apres) values ('${ent.secret}', '${autreCarte.rows[0].id}', 'pickup', '1', '2') returning carte_id`);
ok(croise.ok && croise.rows[0].carte_id === null, "une carte d'une autre entreprise n'est pas reliée");
ok((await comme("nani", `select id from agent_apprentissages where entite_id = '${ent.secret}'`)).rows.length === 2, "l'assistante relit les corrections de l'entreprise (l'agent les lit avec sa session)");
ok((await comme("ztp", `select id from agent_apprentissages`)).rows.length === 0, "une autre entreprise ne les voit pas");
ok((await comme("anais", `select id from agent_apprentissages`)).rows.length === 2, "l'administratrice les voit");
ok((await comme("nani", `delete from agent_apprentissages returning id`)).rows.length === 0, "l'assistante ne supprime pas");
ok(!(await comme("nani", `update agent_apprentissages set apres = 'x' returning id`)).ok, "personne ne modifie une correction");
ok((await comme("anais", `delete from agent_apprentissages where carte_id = '${carte}' returning id`)).rows.length === 1, "l'administratrice supprime une correction");
for (let i = 0; i < 305; i++) await essaie("postgres", U.nani, `insert into agent_apprentissages (entite_id, user_id, genre, avant, apres) values ('${ent.secret}', '${U.nani}', 'prix', '${i}', '${i + 1}')`);
ok(Number((await un(`select count(*) n from agent_apprentissages where entite_id = '${ent.secret}'`)).n) === 300, "300 corrections au plus par entreprise");

console.log("== Conversation reliée ==");
const dossier = (await un(`select id from dossiers where entite_id = '${ent.secret}' limit 1`)) || null;
if (dossier) {
  ok((await comme("nani", `update agent_conversations set dossier_id = '${dossier.id}' where id = '${conv}' returning id`)).rows.length === 1, "la conversation se relie au dossier");
  ok((await comme("nani", `select id from agent_conversations where dossier_id = '${dossier.id}'`)).rows.length === 1, "la fiche du dossier retrouve la conversation");
  // Migration 133 : l'administration de l'entreprise voit les conversations de l'équipe ; un lecteur, jamais.
  ok((await comme("lecteur", `select id from agent_conversations where dossier_id = '${dossier.id}'`)).rows.length === 0, "un lecteur ne voit pas la conversation de Nani");
} else ok(true, "aucun dossier de départ chez Secret : relier un dossier est vérifié par la migration 52");
ok(!!(await un("select 1 x from pg_indexes where indexname = 'agent_conversations_dossier'")), "index sur le dossier relié");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
