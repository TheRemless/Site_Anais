// Vérifie la migration 110 (type du contact WhatsApp compris par le sens de la conversation) sur un Postgres en mémoire : schema.sql puis
// toutes les migrations. Chauffeur et hôtel deviennent partenaire ; la clé de service ne pose que « partenaire », sur un contact sans type ni
// source, marqué « déduit » par la base ; un type posé, changé ou retiré par Nani n'est jamais touché ; Nani confirme un type déduit, ne pose
// jamais « déduit » et n'écrit ni les décisions ni les repères ; Mook ne touche à rien ; la migration se rejoue ; retour en arrière.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-whatsapp-type-contact.mjs
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
ok(migrations.indexOf("migration-110-whatsapp-type-contact.sql") > migrations.indexOf("migration-105-whatsapp-etapes.sql"), "la migration 110 passe après la 105, sur une base vide");
// Toutes les migrations sauf la 110 : on pose d'abord des types « chauffeur » et « hotel », que la 110 doit convertir.
for (const f of migrations.filter((x) => x !== "migration-110-whatsapp-type-contact.sql")) await db.exec(lire(f));

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
for (const k of ["nani", "mook"]) u[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Mook test', 'toute', array['clients.lire', 'clients.ecrire', 'dossiers.lire', 'dossiers.ecrire', 'partenaires.lire', 'partenaires.ecrire', 'taches.ecrire'])`);
const membre = (user, entite, role) => db.exec(`insert into membres values ('${u[user]}', '${entite}', (select id from roles where entite_id = '${entite}' and nom = '${role}')) on conflict do nothing`);
await membre("nani", ent.secret, "Administrateur");
await membre("nani", ent.taxi, "Administrateur");
await membre("mook", ent.secret, "Mook test");

let n = 0;
const ranger = async (tel, texte, sens = "entrant") =>
  (await un("select whatsapp_ranger($1, $2, $3, $4::jsonb) r", [ORG, tel, null, JSON.stringify({ evenement_id: `e${++n}`, telnyx_id: `tx-${n}`, meta_id: `wamid.${n}`, sens, origine: sens === "entrant" ? "client" : "app", type: "text", texte, medias: [], envoye_le: new Date(Date.now() - (100 - n) * 60000).toISOString() })])).r.conversation_id;
const conv2 = (id) => un("select type_contact from whatsapp_conversations where id = $1", [id]);
const conv = (id) => un("select type_contact, type_source, type_avis, type_signaux, reponses from whatsapp_conversations where id = $1", [id]);

// ---- Avant la 110 : un chauffeur, un hôtel, un partenaire posés par Nani ------------------------------------------------------------
const chauffeur = await ranger("+447700900611", "Ok, 10 minutes");
const hotel = await ranger("+447700900622", "Reception here");
const partenaire = await ranger("+447700900633", "Price about 650 baht please");
await essaie(u.nani, "update whatsapp_conversations set type_contact = 'chauffeur' where id = $1", [chauffeur]);
await essaie(u.nani, "update whatsapp_conversations set type_contact = 'hotel' where id = $1", [hotel]);
await essaie(u.nani, "update whatsapp_conversations set type_contact = 'partenaire' where id = $1", [partenaire]);
ok((await conv2(chauffeur)).type_contact === "chauffeur" && (await conv2(hotel)).type_contact === "hotel", "(témoin) avant la 110, chauffeur et hôtel existent");
await db.exec(lire("migration-110-whatsapp-type-contact.sql"));

// ---- Structure et conversion -------------------------------------------------------------------------------------------------------
ok(!!(await un("select 1 x from pg_proc where proname = 'whatsapp_ajouter_avis_type'")), "la fonction whatsapp_ajouter_avis_type existe");
for (const col of ["type_source", "type_avis", "type_signaux"]) ok(!!(await un("select 1 x from information_schema.columns where table_name = 'whatsapp_conversations' and column_name = $1", [col])), `la colonne ${col} existe`);
const droit = async (col) => (await db.query("select privilege_type from information_schema.column_privileges where table_name = 'whatsapp_conversations' and column_name = $1 and grantee = 'authenticated' and privilege_type = 'UPDATE'", [col])).rows.length > 0;
ok(await droit("type_source"), "authenticated peut écrire type_source (confirmer un type déduit)");
ok(!(await droit("type_avis")) && !(await droit("type_signaux")), "personne n'écrit type_avis ni type_signaux depuis l'outil");
const x = await un("select has_function_privilege('authenticated', 'whatsapp_type_source()', 'execute') a, has_function_privilege('anon', 'whatsapp_type_source()', 'execute') b");
ok(x.a === false && x.b === false, "whatsapp_type_source() : execute retiré à authenticated et anon");
for (const [id, nom] of [[chauffeur, "chauffeur"], [hotel, "hôtel"]]) {
  const c = await conv(id);
  ok(c.type_contact === "partenaire" && c.type_source === "nani", `un ${nom} devient partenaire, posé par Nani`);
}
ok((await conv(partenaire)).type_source === "nani", "un type déjà posé est celui de Nani");
let r = await essaie(u.nani, "update whatsapp_conversations set type_contact = 'chauffeur' where id = $1", [partenaire]);
ok(!r.ok, "« chauffeur » est refusé après la 110");
r = await essaie(u.nani, "update whatsapp_conversations set type_contact = 'hotel' where id = $1", [partenaire]);
ok(!r.ok, "« hotel » est refusé après la 110");

// ---- La fonction déduit « partenaire » ------------------------------------------------------------------------------------------------
const bateau = await ranger("+447700900644", "I can propose 9,500 for the day");
const AVIS = { v: 1, decisions: [{ type: "partenaire", raison: "propose son prix à Nani", le: "2026-11-22T01:00:00Z" }] };
await db.query("update whatsapp_conversations set type_avis = $1::jsonb, type_signaux = $2::jsonb where id = $3", [JSON.stringify(AVIS), JSON.stringify({ v: 1, codes: { prix_du_contact: 1, dispo_demandee: 1 }, score: 4, nets: true }), bateau]);
let c = await conv(bateau);
ok(c.type_avis.decisions[0].type === "partenaire" && c.type_signaux.nets === true, "la clé de service écrit les décisions et les repères");
await db.query("update whatsapp_conversations set type_contact = 'partenaire' where id = $1", [bateau]);
c = await conv(bateau);
ok(c.type_contact === "partenaire" && c.type_source === "deduit", "la clé de service pose « partenaire » : marqué déduit par la base");
await db.query("update whatsapp_conversations set type_contact = 'client' where id = $1", [bateau]);
ok((await conv(bateau)).type_contact === "partenaire", "la clé de service ne change jamais un type déjà posé, même déduit");
for (const t of ["client", "apporteur"]) {
  const z = await ranger(`+44770090065${t === "client" ? 1 : 2}`, "Hello");
  await db.query("update whatsapp_conversations set type_contact = $1 where id = $2", [t, z]);
  const cz = await conv(z);
  ok(cz.type_contact === null && cz.type_source === null, `la clé de service ne pose jamais « ${t} »`);
}
const perso = await ranger("+447700900666", "Coucou");
await essaie(u.nani, "update whatsapp_conversations set reponses = 'jamais' where id = $1", [perso]);
await db.query("update whatsapp_conversations set type_contact = 'partenaire' where id = $1", [perso]);
ok((await conv(perso)).type_contact === null, "jamais sur un Contact personnel");
await db.query("update whatsapp_conversations set type_source = 'deduit' where id = $1", [perso]);
ok((await conv(perso)).type_source === null, "la clé de service ne pose jamais la source seule");

// ---- Relecture n° 1 : jamais sur une conversation reliée à un client ou à un dossier ---------------------------------------------------
const fiche = (await un("insert into clients (entite_id, prenom, nom, telephone) values ($1, 'Test', 'Client', '+447700900699') returning id", [ent.secret])).id;
const dos = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, 'S-110-1', $2) returning id", [ent.secret, fiche])).id;
for (const [nom, col, val] of [["une fiche client", "client_id", fiche], ["un dossier", "dossier_id", dos]]) {
  const z = await ranger(`+44770090069${col === "client_id" ? 1 : 2}`, "Hello");
  await db.query("update whatsapp_conversations set entite_id = $1 where id = $2", [ent.secret, z]);
  await db.query(`update whatsapp_conversations set ${col} = $1 where id = $2`, [val, z]);
  ok((await un(`select ${col} v from whatsapp_conversations where id = $1`, [z])).v === val, `(témoin) conversation reliée à ${nom}`);
  await db.query("update whatsapp_conversations set type_contact = 'partenaire' where id = $1", [z]);
  const cz = await un(`select type_contact, type_source, ${col} v from whatsapp_conversations where id = $1`, [z]);
  ok(cz.type_contact === null && cz.type_source === null && cz.v === val, `jamais « partenaire » déduit sur une conversation reliée à ${nom} (le lien reste)`);
}

// ---- Relecture n° 6 : une décision ajoutée par la base, sans en perdre ------------------------------------------------------------------
const avisDe = async (id) => (await un("select type_avis from whatsapp_conversations where id = $1", [id])).type_avis;
const ajouter = (id, d) => db.query("select whatsapp_ajouter_avis_type($1, $2::jsonb) r", [id, JSON.stringify(d)]);
const tri = await ranger("+447700900711", "Price about 650 baht please");
await ajouter(tri, { type: "partenaire", raison: "donne ses prix", m: "m1" });
await ajouter(tri, { type: "partenaire", raison: "redit", m: "m1" });
let av = await avisDe(tri);
ok(av.decisions.length === 1 && av.decisions[0].raison === "redit" && av.decisions[0].le, "une décision par message : la nouvelle remplace celle du même message, heure posée par la base");
await ajouter(tri, { type: "client", raison: "", m: "m2" });
av = await avisDe(tri);
ok(av.decisions.map((d) => d.m).join(",") === "m1,m2", "une décision d'un autre message s'ajoute, la plus récente en dernier");
for (let i = 3; i <= 8; i++) await ajouter(tri, { type: "inconnu", raison: "x".repeat(200), m: `m${i}` });
av = await avisDe(tri);
ok(av.decisions.length === 5 && av.decisions[0].m === "m4" && av.decisions[4].m === "m8" && av.decisions[4].raison.length === 120, "les 5 dernières seulement, raison coupée à 120 caractères");
let e2 = null;
try { await ajouter(tri, { type: "chauffeur", m: "m9" }); } catch (e) { e2 = e.message; }
ok(!!e2, "un type inconnu est refusé");
const persoAvis = await ranger("+447700900722", "Coucou");
// La clé de service ne change pas les réponses (migration 60) : posé ici comme Nani l'aurait fait.
await db.exec("alter table whatsapp_conversations disable trigger whatsapp_proteger_classement");
await db.query("update whatsapp_conversations set reponses = 'jamais' where id = $1", [persoAvis]);
await db.exec("alter table whatsapp_conversations enable trigger whatsapp_proteger_classement");
await ajouter(persoAvis, { type: "partenaire", m: "p1" });
ok((await avisDe(persoAvis)) === null, "jamais pour un Contact personnel");
let rAvis = await essaie(u.nani, "select whatsapp_ajouter_avis_type($1, $2::jsonb)", [tri, JSON.stringify({ type: "partenaire", m: "z" })]);
ok(!rAvis.ok, "Nani n'appelle pas whatsapp_ajouter_avis_type (clé de service seulement)");
const deux = await ranger("+447700900733", "Hello");
await Promise.all([ajouter(deux, { type: "partenaire", m: "a" }), ajouter(deux, { type: "partenaire", m: "b" })]);
ok((await avisDe(deux)).decisions.length === 2, "deux décisions envoyées ensemble : aucune ne se perd");

// ---- Nani confirme, change ou retire ----------------------------------------------------------------------------------------------
r = await essaie(u.nani, "update whatsapp_conversations set type_source = 'nani' where id = $1 returning type_contact, type_source", [bateau]);
ok(r.ok && r.rows[0].type_source === "nani" && r.rows[0].type_contact === "partenaire", "Nani confirme un partenaire déduit" + (r.ok ? "" : ` (${r.err})`));
const voiture = await ranger("+447700900677", "On my way to pick up the customers");
await db.query("update whatsapp_conversations set type_contact = 'partenaire' where id = $1", [voiture]);
ok((await conv(voiture)).type_source === "deduit", "(témoin) un second partenaire déduit");
r = await essaie(u.nani, "update whatsapp_conversations set type_contact = 'client' where id = $1 returning type_contact, type_source", [voiture]);
ok(r.ok && r.rows[0].type_contact === "client" && r.rows[0].type_source === "nani", "Nani le change en client d'un geste : le type devient le sien");
await db.query("update whatsapp_conversations set type_contact = 'partenaire' where id = $1", [voiture]);
ok((await conv(voiture)).type_contact === "client", "… et la fonction ne le repasse jamais en partenaire");
r = await essaie(u.nani, "update whatsapp_conversations set type_contact = null where id = $1 returning type_contact, type_source", [voiture]);
ok(r.ok && r.rows[0].type_contact === null && r.rows[0].type_source === "nani", "Nani retire le type : la source reste la sienne");
await db.query("update whatsapp_conversations set type_contact = 'partenaire' where id = $1", [voiture]);
ok((await conv(voiture)).type_contact === null, "… et la fonction ne repose rien sur un type retiré par Nani");
const neuve = await ranger("+447700900688", "Hello");
r = await essaie(u.nani, "update whatsapp_conversations set type_source = 'deduit' where id = $1 returning type_source", [bateau]);
ok(r.ok && r.rows[0].type_source === "nani", "Nani ne pose jamais « deduit »");
r = await essaie(u.nani, "update whatsapp_conversations set type_source = 'nani' where id = $1 returning type_source", [neuve]);
ok(r.ok && r.rows[0].type_source === null, "« nani » sans type ne s'écrit pas (rien à confirmer)");
r = await essaie(u.nani, "update whatsapp_conversations set type_avis = '{}'::jsonb where id = $1", [bateau]);
ok(!r.ok, "Nani ne peut pas écrire type_avis (pas de droit sur la colonne)");
r = await essaie(u.mook, "update whatsapp_conversations set type_source = 'nani' where id = $1", [neuve]);
ok(r.ok ? r.n === 0 : true, "Mook ne touche pas au type");
let err = null;
try { await db.query("update whatsapp_conversations set type_signaux = $1::jsonb where id = $2", [JSON.stringify({ v: 1, x: "y".repeat(900) }), neuve]); } catch (e) { err = e.message; }
ok(!!err, "des repères de plus de 800 caractères sont refusés");
err = null;
try { await db.query("update whatsapp_conversations set type_avis = '[1]'::jsonb where id = $1", [neuve]); } catch (e) { err = e.message; }
ok(!!err, "des décisions qui ne sont pas un objet sont refusées");

// ---- Se rejoue sans effet -----------------------------------------------------------------------------------------------------------
const photo = async () => JSON.stringify((await db.query("select id, type_contact, type_source, type_avis, type_signaux, updated_at from whatsapp_conversations order by id")).rows);
const p1 = await photo();
await db.exec(lire("migration-110-whatsapp-type-contact.sql"));
ok((await photo()) === p1, "la migration 110 se rejoue sans effet (aucune ligne touchée)");

// ---- Retour en arrière --------------------------------------------------------------------------------------------------------------
await db.exec(lire("retour-110-whatsapp-type-contact.sql"));
ok(!(await un("select 1 x from information_schema.columns where table_name = 'whatsapp_conversations' and column_name in ('type_source', 'type_avis', 'type_signaux')")), "retour : les trois colonnes sont parties");
ok(!(await un("select 1 x from pg_proc where proname = 'whatsapp_type_source'")), "retour : le déclencheur est parti");
ok(!(await un("select 1 x from pg_proc where proname = 'whatsapp_ajouter_avis_type'")), "retour : la fonction d'ajout des décisions est partie");
ok((await conv2(bateau)).type_contact === "partenaire", "retour : les types restent");
r = await essaie(u.nani, "update whatsapp_conversations set type_contact = 'chauffeur' where id = $1 returning type_contact", [neuve]);
ok(r.ok && r.rows[0].type_contact === "chauffeur", "retour : « chauffeur » est de nouveau accepté (comme la 68)");
await db.exec(lire("migration-110-whatsapp-type-contact.sql"));
ok((await un("select type_contact from whatsapp_conversations where id = $1", [neuve])).type_contact === "partenaire", "la migration 110 se rejoue après le retour (et convertit de nouveau)");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
