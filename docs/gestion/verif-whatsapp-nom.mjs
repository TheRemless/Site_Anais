// Vérifie la migration 70 (nom d'un contact WhatsApp saisi à la main) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// Un administrateur écrit le nom (nettoyé, sans caractère invisible, 60 caractères) et nom_source passe à « manuel », même retapé à
// l'identique ; la clé de service ne l'écrase pas mais remplit
// un nom vide ; un lecteur seul (administrateur de l'autre entreprise sur une conversation rangée) et Mook ne l'écrivent pas ;
// whatsapp_rechercher trouve la conversation par son nom, jamais un contact personnel ; la migration se rejoue ; retour en arrière.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-whatsapp-nom.mjs
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
ok(migrations.indexOf("migration-70-whatsapp-nom.sql") > migrations.indexOf("migration-69-ia-tous-contacts.sql"), "la migration 70 passe après la 69, sur une base vide");

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
// Mook chez Secret : elle écrit les dossiers et les partenaires, sans les réglages (pas de whatsapp_admin).
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Mook test', 'toute', array['clients.lire', 'clients.ecrire', 'dossiers.lire', 'dossiers.ecrire', 'partenaires.lire', 'partenaires.ecrire', 'taches.ecrire'])`);
const membre = (user, entite, role) => db.exec(`insert into membres values ('${u[user]}', '${entite}', (select id from roles where entite_id = '${entite}' and nom = '${role}')) on conflict do nothing`);
await membre("nani", ent.secret, "Administrateur");
await membre("nani", ent.taxi, "Administrateur");
await membre("adminTaxi", ent.taxi, "Administrateur");
await membre("mook", ent.secret, "Mook test");

let n = 0;
const ranger = async (tel, nomProfil = null, texte = "Hello Nani") =>
  (await un("select whatsapp_ranger($1, $2, $3, $4::jsonb) r", [ORG, tel, nomProfil, JSON.stringify({ evenement_id: `e${++n}`, telnyx_id: `tx-${n}`, meta_id: `wamid.${n}`, sens: "entrant", origine: "client", type: "text", texte, medias: [], envoye_le: new Date(Date.now() - (100 - n) * 60000).toISOString() })])).r.conversation_id;
const conv = (id) => un("select nom, nom_source, entite_id, reponses from whatsapp_conversations where id = $1", [id]);

// ---- Structure --------------------------------------------------------------------------------------------------------------------
ok(!!(await un("select 1 x from information_schema.columns where table_name = 'whatsapp_conversations' and column_name = 'nom_source'")), "la colonne nom_source existe");
const droits = (await db.query("select privilege_type from information_schema.column_privileges where table_name = 'whatsapp_conversations' and column_name = 'nom' and grantee = 'authenticated'")).rows.map((x) => x.privilege_type);
ok(droits.includes("UPDATE"), "authenticated peut écrire la colonne nom (grant de colonne)");
const droitsSource = (await db.query("select privilege_type from information_schema.column_privileges where table_name = 'whatsapp_conversations' and column_name = 'nom_source' and grantee = 'authenticated' and privilege_type = 'UPDATE'")).rows;
ok(droitsSource.length === 0, "personne ne peut écrire nom_source directement");
for (const f of ["whatsapp_nom_insertion()", "whatsapp_nom_manuel()", "whatsapp_proteger_classement()"]) {
  const x = await un(`select has_function_privilege('authenticated', '${f}', 'execute') a, has_function_privilege('anon', '${f}', 'execute') b`);
  ok(x.a === false && x.b === false, `${f} : execute retiré à authenticated et anon`);
}

// ---- Création par la fonction -------------------------------------------------------------------------------------------------------
const tom = await ranger("+447700900311", null, "We want the ferry to Koh Phi Phi");
const lucia = await ranger("+12025550147", null, "Hi! Places for the 4 Islands tour?");
const profil = await ranger("+12025550199", "Jade Profil", "Hello from Jade");
const somchai = await ranger("+447700900844", null, "Call me tomorrow");
let c = await conv(tom);
ok(c.nom === null && c.nom_source === null, "comme en production : une conversation sans nom de profil n'a ni nom ni source");
c = await conv(profil);
ok(c.nom === "Jade Profil" && c.nom_source === "whatsapp", "un nom de profil reçu à la création : nom_source = « whatsapp »");
await db.exec(`update whatsapp_conversations set entite_id = '${ent.secret}', entite_source = 'manuel' where id in ('${tom}', '${somchai}')`);

// ---- Un administrateur écrit le nom ---------------------------------------------------------------------------------------------------
let r = await essaie(u.nani, "update whatsapp_conversations set nom = $1 where id = $2 returning nom, nom_source", ["  Tom \t  Baker\n ", tom]);
ok(r.ok && r.n === 1 && r.rows[0].nom === "Tom Baker" && r.rows[0].nom_source === "manuel", "Nani écrit le nom : espaces nettoyés, nom_source = « manuel »" + (r.ok ? ` (${JSON.stringify(r.rows[0])})` : ` (${r.err})`));
r = await essaie(u.nani, "update whatsapp_conversations set nom = $1 where id = $2 returning nom", ["A".repeat(80), somchai]);
ok(r.ok && r.rows[0].nom.length === 60, "un nom trop long est coupé à 60 caractères");
r = await essaie(u.nani, "update whatsapp_conversations set nom = 'Somchai chauffeur' where id = $1 returning nom", [somchai]);
r = await essaie(u.nani, "update whatsapp_conversations set nom_source = 'whatsapp' where id = $1", [tom]);
ok(!r.ok, "Nani ne peut pas écrire nom_source elle-même (pas de droit sur la colonne)");
r = await essaie(u.nani, "update whatsapp_conversations set reponses = 'auto' where id = $1 returning nom, nom_source", [tom]);
ok(r.ok && r.rows[0].nom === "Tom Baker" && r.rows[0].nom_source === "manuel", "changer un autre réglage ne touche pas au nom manuel");
// Revue de la PR 300 : caractères invisibles (catégorie Cf) retirés ; un nom qui n'en contient que des invisibles est vide.
r = await essaie(u.nani, "update whatsapp_conversations set nom = $1 where id = $2 returning nom, nom_source", ["\u200BTom\u200F \u202ABa\u2060ker\u202E\uFEFF", tom]);
ok(r.ok && r.rows[0].nom === "Tom Baker" && r.rows[0].nom_source === "manuel", "caractères invisibles retirés (U+200B, U+200F, U+202A, U+2060, U+202E, U+FEFF)" + (r.ok ? ` (${JSON.stringify(r.rows[0].nom)})` : ` (${r.err})`));
const vide = await ranger("+12025550188", null, "Hi");
await essaie(u.nani, "update whatsapp_conversations set nom = 'Avant' where id = $1", [vide]);
r = await essaie(u.nani, "update whatsapp_conversations set nom = $1 where id = $2 returning nom, nom_source", ["\u200B \u2060\uFEFF\u200E", vide]);
ok(r.ok && r.rows[0].nom === null && r.rows[0].nom_source === null, "un nom fait seulement d'invisibles est vide : nom manuel effacé");
// Revue de la PR 300 : un nom de profil retapé à l'identique devient manuel (protégé de la fonction).
r = await essaie(u.nani, "update whatsapp_conversations set nom = 'Jade Profil' where id = $1 returning nom, nom_source", [profil]);
ok(r.ok && r.rows[0].nom === "Jade Profil" && r.rows[0].nom_source === "manuel", "un nom de profil retapé à l'identique devient manuel");
await ranger("+12025550199", "Autre Profil", "Hello again");
ok((await conv(profil)).nom === "Jade Profil", "… et la fonction ne le remplace plus");
r = await essaie(u.nani, "update whatsapp_conversations set nom = 'Jade' where id = $1 returning nom, nom_source", [profil]);
ok(r.ok && r.rows[0].nom === "Jade" && r.rows[0].nom_source === "manuel", "Nani change un nom manuel");

// ---- La clé de service n'écrase pas un nom manuel ----------------------------------------------------------------------------------------
await ranger("+447700900311", "Thomas from WhatsApp", "Any news?");
c = await conv(tom);
ok(c.nom === "Tom Baker" && c.nom_source === "manuel", "whatsapp_ranger avec un nom de profil ne change pas le nom manuel");
await db.query("update whatsapp_conversations set nom = 'Écrasé', nom_source = 'whatsapp' where id = $1", [tom]);
c = await conv(tom);
ok(c.nom === "Tom Baker" && c.nom_source === "manuel", "une mise à jour directe sans personne connectée ne le change pas non plus");
await db.query("update whatsapp_conversations set tri = '{\"motif\":\"demande_client\"}'::jsonb where id = $1", [tom]);
ok((await conv(tom)).nom === "Tom Baker", "le tri écrit par la fonction laisse le nom");

// ---- … mais remplit un nom vide (et suit un nom de profil) ------------------------------------------------------------------------------
await ranger("+12025550147", "Lucia", "Saturday please");
c = await conv(lucia);
ok(c.nom === "Lucia" && c.nom_source === "whatsapp", "whatsapp_ranger remplit un nom vide : nom_source = « whatsapp »");
await ranger("+12025550147", "Lucia Rossi", "And Sunday?");
c = await conv(lucia);
ok(c.nom === "Lucia Rossi" && c.nom_source === "whatsapp", "un nom de profil suit le profil (il n'est pas protégé)");
await db.query("update whatsapp_conversations set nom_source = 'manuel' where id = $1", [lucia]);
ok((await conv(lucia)).nom_source === "whatsapp", "la clé de service ne marque pas un nom de profil comme manuel");
await ranger("+12025550147", null, "Thanks");
c = await conv(lucia);
ok(c.nom === "Lucia Rossi" && c.nom_source === "whatsapp", "un message sans nom de profil laisse le nom");

// ---- Lecteur seul et Mook -------------------------------------------------------------------------------------------------------------
r = await essaie(u.adminTaxi, "select nom from whatsapp_conversations where id = $1", [tom]);
ok(r.ok && r.rows.length === 1 && r.rows[0].nom === "Tom Baker", "l'administratrice de Taxi lit la conversation rangée chez Secret (boîte commune)");
r = await essaie(u.adminTaxi, "update whatsapp_conversations set nom = 'Pirate' where id = $1", [tom]);
ok(r.ok ? r.n === 0 : true, "… mais ne peut pas écrire son nom (lecture seule)" + (r.ok ? ` (${r.n} ligne)` : ""));
ok((await conv(tom)).nom === "Tom Baker", "… le nom n'a pas changé");
r = await essaie(u.mook, "update whatsapp_conversations set nom = 'Mook' where id = $1", [tom]);
ok(r.ok ? r.n === 0 : true, "Mook ne peut pas écrire le nom");
r = await essaie(u.mook, "select count(*)::int n from whatsapp_conversations");
ok(r.ok && r.rows[0].n === 0, "Mook ne voit aucune conversation");
ok((await conv(tom)).nom === "Tom Baker", "… le nom n'a toujours pas changé");
r = await essaie(u.adminTaxi, "update whatsapp_conversations set nom = 'Lucia R.' where id = $1 returning nom_source", [lucia]);
ok(r.ok && r.n === 1 && r.rows[0].nom_source === "manuel", "une conversation à trier se nomme par un administrateur de l'une des deux entreprises");

// ---- Vider efface le nom manuel ---------------------------------------------------------------------------------------------------------
r = await essaie(u.nani, "update whatsapp_conversations set nom = '   ' where id = $1 returning nom, nom_source", [profil]);
ok(r.ok && r.rows[0].nom === null && r.rows[0].nom_source === null, "un nom vidé (espaces seuls) efface le nom manuel");
await ranger("+12025550199", "Jade Profil", "Back again");
c = await conv(profil);
ok(c.nom === "Jade Profil" && c.nom_source === "whatsapp", "… et le nom de profil peut revenir");

// ---- Recherche par le nom -------------------------------------------------------------------------------------------------------------
const cherche = (user, q) => essaie(user, "select conversation_id from whatsapp_rechercher($1, 20)", [q]);
r = await cherche(u.nani, "Bak");
ok(r.ok && r.rows.some((x) => x.conversation_id === tom), "whatsapp_rechercher trouve la conversation par le préfixe du nom saisi (« Bak »)");
r = await cherche(u.nani, "tom baker");
ok(r.ok && r.rows.filter((x) => x.conversation_id === tom).length >= 1, "… et par le nom entier, en minuscules");
r = await cherche(u.adminTaxi, "Baker");
ok(r.ok && r.rows.some((x) => x.conversation_id === tom), "… la lecture commune la trouve aussi (administratrice de Taxi)");
r = await cherche(u.mook, "Baker");
ok(r.ok && r.rows.length === 0, "Mook ne trouve rien");
await essaie(u.nani, "update whatsapp_conversations set reponses = 'jamais' where id = $1", [somchai]);
r = await cherche(u.nani, "Somchai");
ok(r.ok && r.rows.length === 0, "un contact personnel n'est jamais trouvé par son nom");
r = await db.query("select * from whatsapp_rechercher('Baker', 20)");
ok(r.rows.length === 0, "la clé de service ne trouve rien (aucune organisation)");

// ---- Se rejoue sans effet -----------------------------------------------------------------------------------------------------------
const photo = async () => JSON.stringify((await db.query("select id, nom, nom_source, updated_at from whatsapp_conversations order by id")).rows);
const p1 = await photo();
await db.exec(lire("migration-70-whatsapp-nom.sql"));
ok((await photo()) === p1, "la migration 70 se rejoue sans effet (aucune ligne touchée)");
await ranger("+447700900311", "Thomas again", "Hello?");
ok((await conv(tom)).nom === "Tom Baker", "après le rejeu, le nom manuel est toujours protégé");

// ---- Retour en arrière --------------------------------------------------------------------------------------------------------------
await db.exec(lire("retour-70-whatsapp-nom.sql"));
ok(!(await un("select 1 x from information_schema.columns where table_name = 'whatsapp_conversations' and column_name = 'nom_source'")), "retour : la colonne nom_source est partie");
ok((await un("select nom from whatsapp_conversations where id = $1", [tom])).nom === "Tom Baker", "retour : le nom saisi reste dans « nom »");
r = await essaie(u.nani, "update whatsapp_conversations set nom = 'X' where id = $1", [tom]);
ok(!r.ok, "retour : plus personne n'écrit le nom depuis l'outil");
r = await cherche(u.nani, "Baker");
ok(r.ok && !r.rows.some((x) => x.conversation_id === tom), "retour : whatsapp_rechercher ne cherche plus dans le nom");
r = await cherche(u.nani, "ferry");
ok(r.ok && r.rows.some((x) => x.conversation_id === tom), "retour : la recherche dans les messages marche toujours");
await ranger("+447700900877", "Nouveau", "Hi");
ok(!!(await un("select 1 x from whatsapp_conversations where telephone = '+447700900877'")), "retour : la fonction range toujours un nouveau contact");
await db.exec(lire("migration-70-whatsapp-nom.sql"));
c = await un("select nom, nom_source from whatsapp_conversations where id = $1", [tom]);
ok(c.nom === "Tom Baker" && c.nom_source === null, "la migration 70 se rejoue après le retour, sans toucher aux noms existants");
r = await essaie(u.nani, "update whatsapp_conversations set nom = 'Tom B.' where id = $1 returning nom_source", [tom]);
ok(r.ok && r.rows[0].nom_source === "manuel", "… et Nani écrit de nouveau le nom");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
