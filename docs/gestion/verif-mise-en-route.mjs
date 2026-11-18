// Vérifie la migration 45 (mise en route d'un client) sur un Postgres en mémoire, de bout en bout :
// schéma neutre + données de Zwald + migrations, puis une agence fictive créée de zéro par l'éditeur, comme pendant l'appel de mise en route.
// Son administratrice trouve un outil complet (réglages du modèle, rôles, catalogue d'exemple) et vide de toute donnée de Zwald ; Zwald ne voit rien d'elle.
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-mise-en-route.mjs . && GESTION_SQL=<repo>/docs/gestion/ GESTION_SRC=<repo>/src/gestion/js/ node verif-mise-en-route.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const W = process.env.GESTION_SQL || "./";
const SRC = process.env.GESTION_SRC ? pathToFileURL(process.env.GESTION_SRC.replace(/\/?$/, "/")) : new URL("../../src/gestion/js/", import.meta.url);
// La même source que l'outil et la démo : les données de départ viennent du modèle métier, jamais du SQL.
const { departModele, codeCourt, MODELES } = await import(new URL("modeles-metier.mjs", SRC));
let echecs = 0;
const ok = (c, msg) => { if (!c) { echecs++; console.log("  ECHEC:", msg); } else console.log("  ok:", msg); };
const harnais = `
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now(), raw_user_meta_data jsonb, raw_app_meta_data jsonb, last_sign_in_at timestamptz);
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
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[789]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
const ZWALD = "00000000-0000-0000-0000-00000000a000";
// Ce qui ne doit jamais apparaître chez un nouveau client : noms, lieux, moyens de paiement et coordonnées propres à Zwald.
const INTERDITS = /Zwald|Lanta|Krabi|Ana[iï]s|Secret Travel|VIP Taxi|TWINT|PostFinance|292 Moo|\+ ?66 ?95|Mr\.? Brown/i;
// Les valeurs seulement : un nom de champ hérité (voucher.whatsapp_anais, vide) n'est pas une donnée de Zwald.
const valeurs = (x) => (x && typeof x === "object" ? Object.values(x).map(valeurs).join("\n") : String(x ?? ""));

console.log("== Schéma neutre ==");
{
  const vierge = new PGlite();
  await vierge.exec(harnais);
  await vierge.exec(lire("schema.sql"));
  const n = async (t) => (await vierge.query(`select count(*)::int n from ${t}`)).rows[0].n;
  ok((await n("entites")) === 0 && (await n("reglages")) === 0 && (await n("catalogue")) === 0 && (await n("roles")) === 0, "schema.sql seul ne crée aucune entreprise, aucun réglage, aucun rôle, aucun catalogue");
  ok(!INTERDITS.test(lire("schema.sql").split("\n").filter((l) => !l.startsWith("--")).join("\n")), "schema.sql ne contient aucune donnée de Zwald");
  await vierge.close();
}

console.log("== Base neuve : schéma neutre puis migrations, sans les données de Zwald ==");
{
  const neuve = new PGlite();
  await neuve.exec(harnais);
  await neuve.exec(lire("schema.sql"));
  for (const f of migrations) await neuve.exec(lire(f));
  await neuve.exec(lire("migration-42-organisations.sql"));
  await neuve.exec(lire("migration-45-mise-en-route.sql"));
  ok(true, "les migrations passent sur une base neuve, la 42 et la 45 se rejouent");
  const n = async (sql) => (await neuve.query(sql)).rows[0].n;
  ok((await n("select count(*)::int n from organisations")) === 0, "aucune organisation, pas de Zwald");
  ok((await n("select count(*)::int n from entites")) === 0, "aucune entreprise");
  const premier = (await neuve.query("insert into auth.users (email) values ('premier@test') returning id")).rows[0].id;
  const p = (await neuve.query("select organisation_id, super_admin from profils where user_id = $1", [premier])).rows[0];
  ok(p.organisation_id === null && p.super_admin === false, "le premier compte n'est rattaché à rien et n'est pas administrateur");
  await neuve.exec(`update profils set plateforme = true where user_id = '${premier}'`);
  await neuve.query("insert into auth.users (email, raw_user_meta_data) values ('client@test', '{\"nouvelle_organisation\": \"true\"}')");
  await neuve.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${premier}', false);`);
  const o = (await neuve.query("select creer_organisation('Client Un', 'client@test') as id")).rows[0].id;
  await neuve.exec("reset role;");
  const second = (await neuve.query("insert into auth.users (email) values ('ajoute@test') returning id")).rows[0].id;
  ok((await neuve.query("select organisation_id from profils where user_id = $1", [second])).rows[0].organisation_id === null, "avec un seul client, un compte ajouté à la main ne rejoint pas ce client");
  ok((await n("select count(*)::int n from organisations where nom ilike '%zwald%'")) === 0 && !!o, "seule l'organisation du client existe");
  await neuve.close();
}

const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql"));
await db.exec(lire("donnees-ztp-depart.sql"));
for (const f of migrations) await db.exec(lire(f));
ok(migrations.includes("migration-45-mise-en-route.sql"), "la migration 45 est appliquée avec les autres");
await db.exec(lire("migration-45-mise-en-route.sql"));
ok(true, "la migration 45 se rejoue sans erreur");
await db.exec("grant all on all tables in schema public to authenticated; grant usage, select on all sequences in schema public to authenticated; revoke insert, update, delete on journal from authenticated;");
for (const l of lire("migration-42-organisations.sql").split("\n").filter((x) => /^(revoke|grant) .* on organisations /.test(x))) await db.exec(l);
for (const l of lire("migration-45-mise-en-route.sql").split("\n").filter((x) => /^(revoke|grant) /.test(x))) await db.exec(l);

const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const essaie = async (userId, sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
};
const nb = async (u, sql, p) => { const r = await essaie(u, sql, p); return r.ok ? r.rows.length : -1; };
const compte = async (email, meta = null) => (await un("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, meta])).id;
const installer = (u, org, nom, modele, devise, change = (d) => d) => {
  const d = change(departModele(modele, { nom, devise }));
  return essaie(u, "select installer_entreprise($1, $2, $3, $4, $5, $6) as id", [org, nom, codeCourt(nom), JSON.stringify(d.reglages), JSON.stringify(d.roles), JSON.stringify(d.catalogue)]);
};

console.log("== Zwald avant la mise en route ==");
const anais = await compte("anais@test");
await db.exec(`update profils set super_admin = true, organisation_id = '${ZWALD}' where user_id = '${anais}'`);
const editeur = await compte("editeur@test");
await db.exec(`update profils set plateforme = true where user_id = '${editeur}'`);
const ent = Object.fromEntries((await db.query("select slug, id from entites where organisation_id = $1", [ZWALD])).rows.map((r) => [r.slug, r.id]));
ok(Object.keys(ent).sort().join() === "secret,taxi,ztp", "Zwald a ses trois entreprises (données de donnees-ztp-depart.sql)");
await db.exec(`insert into clients (id, entite_id, nom) values ('11111111-1111-4111-8111-111111111111', '${ent.ztp}', 'Client Zwald')`);
await db.exec(`insert into dossiers (entite_id, ref, client_id) values ('${ent.ztp}', 'ZTP-2026-001', '11111111-1111-4111-8111-111111111111')`);
const avantZ = { catalogue: (await un("select count(*)::int n from catalogue where entite_id = $1", [ent.ztp])).n, reglages: (await un("select valeur::text v from reglages where entite_id = $1", [ent.ztp])).v };

console.log("== Mise en route d'une agence fictive (Agence Bleue, travel planner, EUR) ==");
// Fonction « invitation », action creer_client : compte en attente de sa propre organisation, puis creer_organisation avec la session de l'éditeur.
const lena = await compte("lena@agence-bleue.test", { nouvelle_organisation: "true" });
ok(!(await essaie(anais, "select creer_organisation('Agence Bleue', 'lena@agence-bleue.test')")).ok, "Anaïs ne peut pas créer de client");
const org = await essaie(editeur, "select creer_organisation('Agence Bleue', 'lena@agence-bleue.test', 'Europe/Lisbon', 'en') as id");
ok(org.ok, "l'éditeur crée l'organisation " + (org.err || ""));
const B = org.rows[0].id;
ok(!(await installer(anais, B, "Agence Bleue", "travel_planner", "EUR")).ok, "Anaïs ne peut pas installer d'entreprise");
ok(!(await installer(lena, B, "Agence Bleue", "travel_planner", "EUR")).ok, "l'administratrice du client non plus (elle crée les suivantes elle-même)");
ok(!(await installer(editeur, ZWALD, "Pirate", "travel_planner", "EUR")).ok, "l'éditeur n'installe rien chez Zwald, qui a déjà ses entreprises");
const inst = await installer(editeur, B, "Agence Bleue", "travel_planner", "EUR");
ok(inst.ok, "l'éditeur installe la première entreprise de l'agence " + (inst.err || ""));
const eB = inst.rows[0].id;
ok(!(await installer(editeur, B, "Agence Bleue 2", "tour_agency", "EUR")).ok, "une seconde installation est refusée : l'administratrice règle la suite");

console.log("== Ce que voit l'éditeur après ==");
for (const t of ["entites", "reglages", "catalogue", "roles", "clients", "dossiers", "profils where user_id <> auth.uid()"]) ok((await nb(editeur, `select * from ${t}`)) === 0, `l'éditeur ne voit rien dans ${t.split(" ")[0]}`);
ok((await nb(editeur, "select * from organisations")) === 2, "l'éditeur voit la liste des organisations (Zwald et Agence Bleue)");

console.log("== Ce que voit l'administratrice de l'agence ==");
const ents = await essaie(lena, "select id, nom, slug, organisation_id from entites");
ok(ents.ok && ents.rows.length === 1 && ents.rows[0].slug === "agence-bleue" && ents.rows[0].organisation_id === B, "une seule entreprise, la sienne (agence-bleue)");
const regl = (await essaie(lena, "select valeur from reglages")).rows;
ok(regl.length === 1, "ses réglages, et seulement les siens");
const v = regl[0].valeur;
ok(v.fonctionnement === "sur_mesure" && v.devise === "EUR" && v.emetteur.nom === "Agence Bleue", "façon de travailler du modèle, devise choisie, nom de l'agence");
ok(v.libelles.facture === "INVOICE" && v.messages.length > 0 && v.messages.every((m) => m.langue === "en"), "documents et messages types en anglais");
ok(!v.listes.moyens.some((m) => ["twint", "postfinance"].includes(m.id)), "moyens de paiement neutres, sans TWINT ni PostFinance");
ok(v.listes.devises[0] === "EUR", "la devise choisie est la première proposée");
ok(!INTERDITS.test(valeurs(v)), "aucune donnée de Zwald dans ses réglages");
const roles = (await essaie(lena, "select nom, tous_droits, systeme from roles order by tous_droits desc, nom")).rows;
ok(roles.length === 3 && roles[0].nom === "Administrateur" && roles[0].tous_droits && roles[0].systeme, "trois rôles de départ, l'Administrateur « tous droits » et système en premier");
ok(roles.slice(1).every((r) => !r.systeme && !r.tous_droits), "les autres rôles ne sont ni système ni « tous droits » : le client les modifie");
const cat = (await essaie(lena, "select libelle, prix, kind from catalogue order by ordre")).rows;
ok(cat.length === 3 && cat.every((c) => c.prix === null) && cat[0].kind === "formule", "catalogue d'exemple : trois lignes en anglais, sans prix");
ok(!INTERDITS.test(JSON.stringify(cat)), "aucune ligne du catalogue de Zwald");
for (const t of ["clients", "dossiers", "documents", "paiements", "partenaires", "prestations", "reservations", "taches", "demandes_site", "bandeaux_site"]) ok((await nb(lena, `select * from ${t}`)) === 0, `aucune ligne dans ${t}`);
ok((await essaie(lena, "select cardinality(permissions_dans($1)) = cardinality(toutes_permissions()) v", [eB])).rows[0].v === true, "elle a tous les droits dans son entreprise");
ok((await essaie(lena, "select a_permission($1, 'clients.lire') v", [ent.ztp])).rows[0].v === false, "aucun droit sur ZTP");
ok((await nb(lena, "select * from organisations")) === 1, "elle ne voit que son organisation");
ok((await nb(lena, "select * from profils")) === 1, "elle ne voit que son propre compte");
const jl = (await essaie(lena, "select action, libelle from journal where entite_id is null")).rows;
ok(jl.length === 1 && jl[0].action === "installer", "son journal note l'installation, rien de Zwald");

console.log("== Elle travaille ==");
const cB = await essaie(lena, `insert into clients (entite_id, nom) values ('${eB}', 'Jones') returning id`);
ok(cB.ok, "elle crée un client " + (cB.err || ""));
ok((await essaie(lena, `insert into dossiers (entite_id, ref, client_id) values ('${eB}', 'AB-0001', '${cB.rows[0].id}') returning id`)).ok, "elle crée un dossier");
ok((await essaie(lena, `update reglages set valeur = jsonb_set(valeur, '{emetteur,adresse}', '"Rua Augusta 1, Lisbon"') where entite_id = '${eB}' returning entite_id`)).rows?.length === 1, "elle complète ses coordonnées dans Réglages");
ok(!(await essaie(lena, `insert into clients (entite_id, nom) values ('${ent.ztp}', 'Pirate')`)).ok, "elle ne peut rien écrire chez ZTP");
const updZ = await essaie(lena, `update reglages set valeur = '{}'::jsonb where entite_id = '${ent.ztp}'`);
ok(updZ.ok && updZ.n === 0, "ni toucher aux réglages de ZTP");

console.log("== Zwald ne voit rien de l'agence ==");
ok((await nb(anais, "select * from entites")) === 3, "Anaïs voit ses trois entreprises, pas l'Agence Bleue");
ok((await essaie(anais, "select nom from clients")).rows.map((x) => x.nom).join() === "Client Zwald", "Anaïs ne voit que son client");
ok((await nb(anais, "select * from dossiers")) === 1, "ni les dossiers de l'agence");
ok((await nb(anais, `select * from catalogue where entite_id = '${eB}'`)) === 0 && (await nb(anais, `select * from reglages where entite_id = '${eB}'`)) === 0, "ni son catalogue ni ses réglages");
ok((await nb(anais, "select * from profils where user_id = $1", [lena])) === 0, "ni le compte de Lena");
ok((await nb(anais, "select * from organisations")) === 1, "ni son organisation");
ok((await essaie(anais, "select libelle from journal where entite_id is null")).rows.every((r) => r.libelle !== "Agence Bleue"), "ni son journal");
ok((await un("select count(*)::int n from catalogue where entite_id = $1", [ent.ztp])).n === avantZ.catalogue && (await un("select valeur::text v from reglages where entite_id = $1", [ent.ztp])).v === avantZ.reglages, "le catalogue et les réglages de ZTP sont intacts");

console.log("== Les trois modèles ==");
for (const m of MODELES) {
  const u = await compte(`admin-${m.id}@test`, { nouvelle_organisation: "true" });
  const o = (await essaie(editeur, `select creer_organisation('Test ${m.id}', 'admin-${m.id}@test') as id`)).rows[0].id;
  const r = await installer(editeur, o, `Test ${m.id}`, m.id, "USD");
  ok(r.ok, `${m.id} : installé ` + (r.err || ""));
  const vv = (await essaie(u, "select valeur from reglages")).rows[0]?.valeur || {};
  ok(vv.fonctionnement === m.fonctionnement && vv.devise === "USD" && !INTERDITS.test(valeurs(vv)), `${m.id} : façon de travailler « ${m.fonctionnement} », USD, rien de Zwald`);
  ok((await nb(u, "select * from entites")) === 1 && (await nb(u, "select * from clients")) === 0, `${m.id} : sa seule entreprise, aucun client`);
}

console.log("== Contrôles des entrées ==");
const vide = async (email) => { await compte(email, { nouvelle_organisation: "true" }); return (await essaie(editeur, `select creer_organisation('Contrôle', '${email}') as id`)).rows[0].id; };
const oC = await vide("c1@test");
ok(!(await essaie(editeur, "select installer_entreprise($1, 'X', 'Code Invalide', '{}'::jsonb, '[]'::jsonb)", [oC])).ok, "code court invalide refusé");
ok(!(await installer(editeur, oC, "Contrôle", "travel_planner", "EUR", (d) => ({ ...d, roles: [d.roles[0], { ...d.roles[1], permissions: ["clients.lire", "tout.pirater"] }] }))).ok, "permission inconnue refusée sur un autre rôle que l'Administrateur");
ok(!(await installer(editeur, oC, "Contrôle", "travel_planner", "EUR", (d) => ({ ...d, roles: [d.roles[0], { ...d.roles[1], tous_droits: true }] }))).ok, "« tous droits » refusé ailleurs que sur le premier rôle");
ok(!(await installer(editeur, oC, "Contrôle", "travel_planner", "EUR", (d) => ({ ...d, roles: d.roles.slice(1) }))).ok, "sans Administrateur en premier, refusé");
ok(!(await installer(editeur, oC, "Contrôle", "travel_planner", "EUR", (d) => ({ ...d, catalogue: [{ kind: "pirate", libelle: "x" }] }))).ok, "ligne de catalogue invalide refusée");
ok(!(await essaie(editeur, "select installer_entreprise(gen_random_uuid(), 'X', 'x', '{}'::jsonb, '[{\"nom\":\"A\",\"portee\":\"toute\",\"permissions\":[],\"tous_droits\":true}]'::jsonb)")).ok, "organisation inconnue refusée");
ok((await un("select count(*)::int n from entites where organisation_id = $1", [oC])).n === 0, "un refus ne laisse aucune entreprise à moitié créée");
ok(!(await essaie(null, "select installer_entreprise($1, 'X', 'x', '{}'::jsonb, '[]'::jsonb)", [oC])).ok, "sans connexion, refusé");
await db.exec("set role anon;");
const anon = await db.query("select installer_entreprise(gen_random_uuid(), 'X', 'x', '{}'::jsonb, '[]'::jsonb)").then(() => "", (e) => e.message);
await db.exec("reset role;");
ok(/permission denied/.test(anon), "la clé publique (anon) n'a pas le droit d'appeler la fonction");

console.log("== Client neuf seulement ==");
const oS = await vide("suspendu@test");
await db.exec(`update organisations set statut = 'suspendu' where id = '${oS}'`);
ok(!(await installer(editeur, oS, "Suspendu", "travel_planner", "EUR")).ok, "organisation suspendue : installation refusée");
const oL = await vide("connecte@test");
await db.exec("update auth.users set last_sign_in_at = now() where email = 'connecte@test'");
const refusL = await installer(editeur, oL, "Connecté", "travel_planner", "EUR");
ok(!refusL.ok && /déjà en service/.test(refusL.err || ""), "un compte du client s'est déjà connecté : installation refusée");
ok((await un("select count(*)::int n from entites where organisation_id in ($1, $2)", [oS, oL])).n === 0, "aucune entreprise posée chez eux");
const oA = await vide("attente@test");
ok((await essaie(editeur, "select client_a_reprendre($1) v", [oA])).rows[0].v === true, "client créé à moitié : l'éditeur peut le reprendre");
ok((await essaie(editeur, "select client_a_reprendre($1) v", [oL])).rows[0].v === false, "client déjà connecté : plus de reprise");
ok((await essaie(editeur, "select client_a_reprendre($1) v", [B])).rows[0].v === false, "l'Agence Bleue, qui a déjà une fiche client, ne se reprend plus");
const oT = await vide("tardive@test");
ok((await installer(editeur, oT, "Tardive", "transfers", "THB")).ok && (await essaie(editeur, "select client_a_reprendre($1) v", [oT])).rows[0].v === true, "entreprise installée, personne connecté : la reprise reste possible");
await db.exec("update auth.users set last_sign_in_at = now() where email = 'tardive@test'");
ok((await essaie(editeur, "select client_a_reprendre($1) v", [oT])).rows[0].v === false, "dès que son administratrice s'est connectée, plus de reprise");
ok((await essaie(editeur, "select client_a_reprendre($1) v", [ZWALD])).rows[0].v === false, "Zwald ne se reprend jamais");
ok(!(await essaie(anais, "select client_a_reprendre($1) v", [oA])).ok, "Anaïs ne peut pas demander de reprise");
ok(!(await essaie(lena, "select organisation_neuve($1)", [oA])).ok, "organisation_neuve n'est pas appelable directement");
const liste = await essaie(editeur, "select id, nom, entreprises, neuve, admin_email from clients_plateforme()");
const ligne = (id) => (liste.rows || []).find((x) => x.id === id) || {};
ok(liste.ok && ligne(B).entreprises === 1 && ligne(B).neuve === false && ligne(B).admin_email === "lena@agence-bleue.test", "liste des clients : l'Agence Bleue, une entreprise, déjà en service");
ok(ligne(oA).entreprises === 0 && ligne(oA).neuve === true, "liste des clients : le client créé à moitié est à reprendre");
ok(!(await essaie(anais, "select * from clients_plateforme()")).ok && !(await essaie(lena, "select * from clients_plateforme()")).ok, "la liste des clients est réservée à l'éditeur");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
