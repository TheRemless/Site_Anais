// Vérifie la migration 74 (l'Assistant apprend de Nani) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// Une session de l'outil écrit toujours en son nom (auteur, source « outil », aucune réponse préparée reliée, même si elle envoie autre
// chose) ; sans session, seul un rôle serveur écrit (source « whatsapp », sans auteur) ; une réponse préparée d'une autre entreprise est
// refusée ; une ligne par réponse préparée ; genres « remarque » et « retour » (raison de 200 caractères au plus) ; Mook et un lecteur ne
// notent rien ; aucune ligne ne parle de net ni de banque ; une conversation classée ensuite partenaire, chauffeur, hôtel, apporteur ou
// Contact personnel perd ses lignes ; les lectures et suppressions de la migration 54 ne changent pas ; la migration se rejoue ; retour.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-agent-apprendre-nani.mjs
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
grant all on all tables in schema storage to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
for (const f of migrations) await db.exec(lire(f));
ok(migrations.includes("migration-74-apprentissages-nani.sql"), "la migration 74 passe avec les autres, sur une base vide");
await db.exec(lire("migration-74-apprentissages-nani.sql"));
ok(true, "la migration 74 se rejoue sans erreur");
// Comme Supabase : le rôle de la clé de service passe outre RLS et a tous les droits sur les tables.
await db.exec("alter role service_role bypassrls; grant all on all tables in schema public to service_role;");

async function essaie(role, userId, sql, params = []) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];

const ent = {};
for (const sl of ["ztp", "secret", "taxi"]) ent[sl] = (await un("select id from entites where slug = $1", [sl]))?.id;
const ORG = (await un("select organisation_id from entites where id = $1", [ent.secret])).organisation_id;
const U = {};
for (const k of ["anais", "nani", "mook", "lecteur", "ztp"]) U[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Assistante', 'toute', array['clients.lire','clients.ecrire','dossiers.lire','dossiers.ecrire','partenaires.lire'])`);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Mook test', 'toute', array['clients.lire','clients.ecrire','dossiers.lire','dossiers.ecrire'])`);
const membre = (u, s, role) => db.exec(`insert into membres values ('${U[u]}', '${ent[s]}', (select id from roles where entite_id = '${ent[s]}' and nom = '${role}')) on conflict do nothing`);
await membre("anais", "secret", "Administrateur");
await membre("nani", "secret", "Assistante");
await membre("mook", "secret", "Mook test");
await membre("lecteur", "secret", "Lecteur");
await membre("ztp", "ztp", "Administrateur");
const comme = (u, sql, p) => essaie("authenticated", U[u], sql, p);

// Une conversation WhatsApp de Secret et une réponse préparée (écrites par la fonction, ici le propriétaire).
const tel = "+447700900411";
const r0 = await un("select whatsapp_ranger($1, $2, null, $3::jsonb) r", [ORG, tel, JSON.stringify({ evenement_id: "e1", telnyx_id: "tx-1", sens: "entrant", origine: "client", type: "text", texte: "Hi, taxi to Krabi airport tomorrow?", medias: [], envoye_le: new Date(Date.now() - 600000).toISOString() })]);
const conv = r0.r.conversation_id;
await db.query("update whatsapp_conversations set entite_id = $1 where id = $2", [ent.secret, conv]);
const prop = (await un("insert into whatsapp_propositions (conversation_id, entite_id, statut, texte, langue) values ($1, $2, 'traitee', 'Hello, the transfer is 1,800 THB.', 'en') returning id", [conv, ent.secret])).id;
const propTaxi = (await un("insert into whatsapp_propositions (conversation_id, entite_id, statut, texte, langue) values ($1, $2, 'traitee', 'Hello', 'en') returning id", [conv, ent.taxi])).id;

console.log("== Écriture par la fonction (clé de service) ==");
const ins = (role, user, champs) => essaie(role, user, `insert into agent_apprentissages (entite_id, genre, contexte, avant, apres, source, proposition_id, user_id) values ($1, $2, $3, $4, $5, $6, $7, $8) returning user_id, source, proposition_id`, [champs.entite || ent.secret, champs.genre || "reponse", champs.contexte || "réponse WhatsApp en anglais", champs.avant ?? "The transfer is 1,800 THB.", champs.apres ?? "Ok perfect the round trip is 800 THB.", champs.source || null, champs.proposition || null, champs.user || null]);
let r = await ins("service_role", null, { source: "whatsapp", proposition: prop });
ok(r.ok && r.rows[0].user_id === null && r.rows[0].source === "whatsapp" && r.rows[0].proposition_id === prop, "la fonction écrit une correction de Nani : sans auteur, source « whatsapp », reliée à la réponse préparée");
r = await ins("service_role", null, { source: "whatsapp", proposition: prop });
ok(!r.ok && /unique|duplicate/i.test(r.err), "une seule ligne par réponse préparée : un événement rejoué ne note rien de plus");
r = await ins("service_role", null, { source: "outil", user: U.anais, proposition: propTaxi });
ok(!r.ok && /proposition_autre_entreprise/.test(r.err), "une réponse préparée d'une autre entreprise (Taxi) ne se relie pas à Secret");
r = await ins("service_role", null, { source: "outil", user: U.anais });
ok(r.ok && r.rows[0].user_id === null && r.rows[0].source === "whatsapp", "la fonction ne se fait pas passer pour une personne : auteur effacé, source « whatsapp »");
r = await ins("service_role", null, { entite: ent.ztp, proposition: prop });
ok(!r.ok, "une réponse préparée de Secret ne se relie pas à ZTP");

console.log("== Écriture par l'outil (session) ==");
r = await ins("authenticated", U.nani, { genre: "retour", source: "whatsapp", proposition: prop, user: U.anais, avant: "Hello, the transfer is 1,800 THB.", apres: "Trop long, pas de prix sans source" });
ok(r.ok && r.rows[0].user_id === U.nani && r.rows[0].source === "outil" && r.rows[0].proposition_id === null, "Nani note un « Pas bien » : en son nom, source « outil », rien de relié, même si elle envoie autre chose");
r = await ins("authenticated", U.nani, { genre: "retour", apres: "x".repeat(201) });
ok(!r.ok, "une raison de plus de 200 caractères est refusée par la base");
r = await ins("authenticated", U.nani, { genre: "retour", apres: "" });
ok(!r.ok, "un « Pas bien » sans raison est refusé");
r = await ins("authenticated", U.nani, { genre: "remarque", avant: "Bagages : 2 valises", apres: "Bagages : 4 valises et une poussette" });
ok(r.ok, "une remarque retouchée se note (genre « remarque »)");
ok(!(await ins("authenticated", U.nani, { genre: "net" })).ok, "un genre inconnu est refusé");
ok(!(await ins("authenticated", U.mook, { genre: "retour", apres: "faux" })).ok, "Mook (sans « partenaires.lire ») ne note rien");
ok(!(await ins("authenticated", U.lecteur, { genre: "retour", apres: "faux" })).ok, "un lecteur ne note rien");
ok(!(await ins("authenticated", U.ztp, { genre: "retour", apres: "faux" })).ok, "une autre entreprise ne note rien chez Secret");
r = await ins("authenticated", null, { genre: "retour", apres: "faux", source: "whatsapp" });
ok(!r.ok, "sans session, le rôle authenticated n'écrit rien (pas de ligne « whatsapp » depuis un navigateur)");
r = await ins("anon", null, { genre: "retour", apres: "faux", source: "whatsapp" });
ok(!r.ok, "anon n'écrit rien");
ok(!(await comme("nani", "update agent_apprentissages set apres = 'x' returning id")).ok, "personne ne modifie une ligne");
ok((await comme("nani", "update agent_apprentissages set source = 'outil' where source = 'whatsapp' returning id")).ok === false, "une session ne change pas la source d'une ligne de la fonction");

console.log("== Mots internes ==");
for (const [qui, role, user] of [["Nani", "authenticated", U.nani], ["la fonction", "service_role", null]]) {
  r = await ins(role, user, { genre: "retour", avant: "Rattana net 1,000 per person", apres: "faux" });
  ok(!r.ok && /mot_interne/.test(r.err), `${qui} : une ligne qui parle de net est refusée par la base`);
  r = await ins(role, user, { genre: "reponse", avant: "Hello", apres: "Pay by KBank please" });
  ok(!r.ok && /mot_interne/.test(r.err), `${qui} : une ligne qui parle de banque est refusée par la base`);
}
r = await ins("authenticated", U.nani, { genre: "pickup", avant: "12:55", apres: "12:40, marge de 15 min avec le ferry" });
ok(r.ok, "« marge » d'un pickup reste permise ; « internet » ou « Kenneth » ne sont pas des mots internes");
ok((await ins("authenticated", U.nani, { genre: "reponse", avant: "Wifi internet ok", apres: "Kenneth will drive" })).ok, "un mot qui contient « net » n'est pas refusé");

console.log("== Lecture et suppression (migration 54, inchangées) ==");
let lus = await comme("nani", `select id, source from agent_apprentissages where entite_id = '${ent.secret}'`);
ok(lus.ok && lus.rows.length === 6 && lus.rows.some((x) => x.source === "whatsapp"), "Nani relit les lignes de l'entreprise, celles de la fonction comprises");
ok((await comme("mook", "select id from agent_apprentissages")).rows.length === 0, "Mook ne lit rien");
ok((await comme("ztp", "select id from agent_apprentissages")).rows.length === 0, "une autre entreprise ne lit rien");
ok((await comme("nani", "delete from agent_apprentissages returning id")).rows.length === 0, "l'assistante ne supprime pas");
ok((await comme("anais", "delete from agent_apprentissages where source = 'whatsapp' and proposition_id is null returning id")).rows.length === 1, "l'administratrice supprime une ligne de la fonction");

console.log("== Conversation classée après coup ==");
const prop2 = (await un("insert into whatsapp_propositions (conversation_id, entite_id, statut, texte, langue) values ($1, $2, 'traitee', 'Hello again', 'en') returning id", [conv, ent.secret])).id;
await ins("service_role", null, { proposition: prop2 });
const deLaConv = async () => Number((await un("select count(*) n from agent_apprentissages where proposition_id in (select id from whatsapp_propositions where conversation_id = $1)", [conv])).n);
ok((await deLaConv()) === 2, "deux lignes tirées de la conversation");
// Le classement se fait par une personne (le déclencheur de la migration 70 garde celui de Nani face à la fonction).
ok((await comme("anais", "update whatsapp_conversations set nom = 'Tom' where id = $1", [conv])).ok, "(témoin) Anaïs range la conversation");
ok((await deLaConv()) === 2, "un nom changé ne retire rien");
ok((await comme("anais", "update whatsapp_conversations set type_contact = 'client' where id = $1", [conv])).ok, "(témoin) Anaïs range la conversation");
ok((await deLaConv()) === 2, "typée « client » : les lignes restent");
ok((await comme("anais", "update whatsapp_conversations set type_contact = 'chauffeur' where id = $1", [conv])).ok, "(témoin) Anaïs range la conversation");
ok((await deLaConv()) === 0, "classée chauffeur : ses lignes sont oubliées");
ok(Number((await un("select count(*) n from agent_apprentissages where entite_id = $1", [ent.secret])).n) > 0, "les autres lignes de l'entreprise restent");
ok((await comme("anais", "update whatsapp_conversations set type_contact = null where id = $1", [conv])).ok, "(témoin) Anaïs range la conversation");
await ins("service_role", null, { proposition: prop2 });
ok((await comme("anais", "update whatsapp_conversations set reponses = 'jamais' where id = $1", [conv])).ok, "(témoin) Anaïs range la conversation");
ok((await deLaConv()) === 0, "passée en Contact personnel : ses lignes sont oubliées");
ok((await comme("anais", "update whatsapp_conversations set reponses = 'auto' where id = $1", [conv])).ok, "(témoin) Anaïs range la conversation");
await ins("service_role", null, { proposition: prop2 });
ok((await comme("anais", "update whatsapp_conversations set partenaire_id = (select id from partenaires limit 1) where id = $1 and exists (select 1 from partenaires)", [conv])).ok, "(témoin) Anaïs range la conversation");
ok((await comme("anais", "update whatsapp_conversations set type_contact = 'apporteur' where id = $1", [conv])).ok, "(témoin) Anaïs range la conversation");
ok((await deLaConv()) === 0, "classée apporteur : ses lignes sont oubliées");
ok(!(await comme("nani", "select oublier_apprentissages_conversation()")).ok, "la fonction d'oubli ne s'appelle pas depuis l'outil");

console.log("== Contraintes ==");
r = await essaie("postgres", null, `insert into agent_apprentissages (entite_id, genre, avant, apres) values ('${ent.secret}', 'reponse', 'a', 'b') returning source, user_id`);
ok(r.ok && r.rows[0].source === "whatsapp" && r.rows[0].user_id === null, "sans session (SQL du tableau de bord) : ligne sans auteur, donc « whatsapp »");
r = await essaie("postgres", null, `alter table agent_apprentissages disable trigger noter_agent_apprentissage; insert into agent_apprentissages (entite_id, genre, avant, apres, source) values ('${ent.secret}', 'reponse', 'a', 'b', 'outil')`);
await db.exec("alter table agent_apprentissages enable trigger noter_agent_apprentissage");
ok(!r.ok, "une ligne « outil » sans auteur est refusée par la contrainte");

console.log("== Retour en arrière ==");
await db.exec(lire("retour-74-apprentissages-nani.sql"));
const n = await un("select count(*) filter (where user_id is null)::int n, count(*) filter (where genre in ('retour', 'remarque'))::int g, count(*)::int t from agent_apprentissages");
ok(n.n === 0 && n.g === 0 && n.t === 2, "retour : les lignes de la fonction et des nouveaux genres sont effacées, les corrections de l'outil restent");
ok(!(await un("select 1 x from pg_trigger where tgname = 'oublier_apprentissages'")), "retour : le déclencheur d'oubli est retiré");
ok(!(await un("select 1 x from information_schema.columns where table_name = 'agent_apprentissages' and column_name in ('source', 'proposition_id')")), "retour : colonnes retirées");
ok(!(await comme("nani", `insert into agent_apprentissages (entite_id, genre, avant, apres) values ('${ent.secret}', 'retour', 'a', 'b')`)).ok, "retour : le genre « retour » n'existe plus");
r = await comme("nani", `insert into agent_apprentissages (entite_id, genre, avant, apres) values ('${ent.secret}', 'pickup', '12:55', '12:40') returning user_id`);
ok(r.ok && r.rows[0].user_id === U.nani, "retour : une correction de l'outil se note comme avant");
await db.exec(lire("migration-74-apprentissages-nani.sql"));
r = await ins("service_role", null, { proposition: prop });
ok(r.ok && r.rows[0].source === "whatsapp", "la migration se rejoue après le retour");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
