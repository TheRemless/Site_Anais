// Vérifie les migrations 30, 40 et 41 (demandes et bandeau du site, numéro WhatsApp) sur un Postgres en mémoire : qui lit, qui traite, ce qui ne se modifie jamais, et que le public n'écrit rien.
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-site.mjs . && GESTION_SQL=<repo>/docs/gestion/ node verif-site.mjs
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
ok(migrations.includes("migration-30-site.sql") && migrations.includes("migration-40-bandeau-reglages.sql") && migrations.includes("migration-41-demande-whatsapp.sql"), "les migrations 30, 40 et 41 sont appliquées, dans l'ordre");
await db.exec(fs.readFileSync(W + "migration-41-demande-whatsapp.sql", "utf8"));
ok(true, "la migration 41 se rejoue sans erreur");
// Droits des tables déjà là (comme sur Supabase) : la migration 30 ne doit pas compter sur ce qui précède.
await db.exec("grant all on all tables in schema public to authenticated; grant usage, select on all sequences in schema public to authenticated; revoke insert, update, delete on journal from authenticated;");
// …sauf les tables de la migration 30, refermées par elle : on rejoue ses « revoke » et « grant » pour annuler le « grant all » ci-dessus.
const m30 = fs.readFileSync(W + "migration-30-site.sql", "utf8");
for (const l of m30.split("\n").filter((x) => /^(revoke|grant) /.test(x) && /(demandes_site|bandeaux_site)/.test(x))) await db.exec(l);

const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const ent = {};
for (const s of ["ztp", "secret", "taxi"]) ent[s] = (await un("select id from entites where slug = $1", [s])).id;
const essaie = async (role, userId, sql, params = []) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
};
const comme = (u, sql, p) => essaie("authenticated", U[u], sql, p);

// Personnes : Anaïs (Administrateur de Secret et de Taxi), une éditrice de Secret (le rôle de Mook n'a pas « reglages.ecrire »), un lecteur de Secret, une stagiaire limitée à ses dossiers, l'assistante « vouchers seulement » de Taxi,
// un éditeur de Zwald seulement, l'administratrice générale.
const U = {};
for (const k of ["anais", "editrice", "lecteur", "stagiaire", "mook", "ztp", "root"]) U[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
await db.exec(`update profils set super_admin = true, organisation_id = '00000000-0000-0000-0000-00000000a000' where user_id = '${U.root}'`);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Ses dossiers', 'mes_dossiers', array['clients.lire','clients.ecrire','dossiers.lire','dossiers.ecrire'])`);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.taxi}', 'Vouchers', 'toute', array['clients.lire','clients.ecrire','dossiers.lire','dossiers.ecrire','vouchers.seul'])`);
const membre = (u, s, role) => db.exec(`insert into membres values ('${U[u]}', '${ent[s]}', (select id from roles where entite_id = '${ent[s]}' and nom = '${role}'))`);
await membre("anais", "secret", "Administrateur"); await membre("anais", "taxi", "Administrateur");
await membre("editrice", "secret", "Éditeur");
await membre("lecteur", "secret", "Lecteur");
await membre("stagiaire", "secret", "Ses dossiers");
await membre("mook", "taxi", "Vouchers");
await membre("ztp", "ztp", "Éditeur");

// Demandes écrites comme le fait la fonction (clé de service = propriétaire des tables).
const demande = async (s, o = {}) => (await un(`insert into demandes_site (entite_id, marque, ref, produit_id, produit, date_service, adultes, enfants, nom, pickup, total_estime, page_url)
  values ($1, $2, $3, $4, $5, '2026-11-18', 2, 1, 'Anna Keller', 'Hotel Sunset', 3000, 'https://secrettravelandtour.com/tours/4-islands/') returning id`, [ent[s], s, o.ref || "FOUR-7K3Q", o.produit || "4-islands", o.nom || "4 Islands"])).id;
const dS = await demande("secret");
const dS2 = await demande("secret", { ref: "DIVE-AB12", produit: "scuba-diving", nom: "Scuba diving" });
const dT = await demande("taxi", { ref: "TAXI-ZZ99", produit: "krabi-airport-koh-lanta", nom: "Krabi Airport to Koh Lanta" });

console.log("== Le public n'écrit rien ==");
ok((await essaie("anon", null, "select 1 from demandes_site")).ok === false, "anon ne lit pas les demandes");
ok((await essaie("anon", null, `insert into demandes_site (entite_id, marque, produit_id) values ('${ent.secret}', 'secret', 'x')`)).ok === false, "anon n'insère pas de demande (seule la fonction le fait)");
ok((await comme("anais", `insert into demandes_site (entite_id, marque, produit_id) values ('${ent.secret}', 'secret', 'x')`)).ok === false, "une personne connectée n'insère pas de demande non plus");
ok((await essaie("anon", null, "select 1 from bandeaux_site")).ok === false, "anon ne lit pas la table des bandeaux (le site passe par la fonction)");
ok((await essaie("anon", null, `insert into bandeaux_site (entite_id, marques, type, modele, texte) values ('${ent.secret}', '{secret}', 'info', 'x', 'y')`)).ok === false, "anon ne crée pas de bandeau");

console.log("== Chaque entreprise ne voit que ses demandes ==");
const voit = async (u) => ((await comme(u, "select produit_id from demandes_site order by produit_id")).rows || []).map((r) => r.produit_id).join(",");
ok((await voit("anais")) === "4-islands,krabi-airport-koh-lanta,scuba-diving", "Anaïs voit les demandes de Secret et de Taxi, ses deux entreprises");
ok((await voit("lecteur")) === "4-islands,scuba-diving", "un lecteur de Secret voit celles de Secret, pas celles de Taxi");
ok((await voit("ztp")) === "", "un éditeur de Zwald ne voit aucune demande du site");
ok((await voit("stagiaire")) === "", "un rôle limité à ses dossiers ne voit pas les demandes (nom et hôtel de clients qui ne sont pas les siens)");
ok((await voit("mook")) === "", "l'écran « Nouveau voucher » seul ne voit pas les demandes");
ok((await voit("root")).split(",").length === 3, "l'administratrice générale voit tout");

console.log("== Traitement ==");
const client = async (e) => (await un(`insert into clients (entite_id, prenom, nom) values ('${ent[e]}', 'Anna', 'Keller') returning id`)).id;
const dosS = (await un(`insert into dossiers (entite_id, ref, client_id) values ('${ent.secret}', 'INV-2026-100', '${await client("secret")}') returning id`)).id;
const dosT = (await un(`insert into dossiers (entite_id, ref, client_id) values ('${ent.taxi}', 'TX-100', '${await client("taxi")}') returning id`)).id;
ok((await comme("lecteur", `update demandes_site set statut = 'refusee' where id = '${dS}'`)).n === 0, "un lecteur ne traite pas une demande");
ok((await comme("anais", `update demandes_site set nom = 'Autre' where id = '${dS}'`)).ok === false, "ce que le client a envoyé ne se modifie pas (colonne fermée)");
ok((await comme("anais", `update demandes_site set statut = 'confirmee', dossier_id = '${dosT}' where id = '${dS}'`)).ok === false, "une demande de Secret ne se rattache pas à un dossier de Taxi");
const conf = await comme("anais", `update demandes_site set statut = 'confirmee', dossier_id = '${dosS}', decision = '{"changements":{"date":{"avant":"2026-11-18","apres":"2026-11-19"}}}' where id = '${dS}' returning traitee_par, traitee_le`);
ok(conf.ok && conf.rows.length === 1 && conf.rows[0].traitee_par === U.anais && conf.rows[0].traitee_le, "Anaïs confirme : dossier rattaché, la base note qui et quand");
ok((await comme("anais", `update demandes_site set statut = 'nouvelle' where id = '${dS}'`)).ok === false, "une demande traitée ne redevient pas « nouvelle »");
ok((await comme("anais", `update demandes_site set statut = 'refusee', decision = '{"motif":"complet"}' where id = '${dT}'`)).n === 1, "Anaïs refuse une demande de Taxi");
ok((await comme("anais", `delete from demandes_site where id = '${dS2}'`)).ok === false, "une demande ne se supprime pas (les chiffres gardent tout)");
ok((await comme("ztp", `update demandes_site set statut = 'classee' where id = '${dS2}'`)).n === 0, "un éditeur de Zwald ne touche pas aux demandes de Secret");
ok((await comme("stagiaire", `update demandes_site set statut = 'classee' where id = '${dS2}'`)).n === 0, "un rôle limité à ses dossiers non plus");
const fige = await db.query(`update demandes_site set produit_id = 'autre' where id = '${dS2}'`).then(() => true, () => false);
ok(!fige, "même la clé de service ne réécrit pas ce que le client a envoyé (déclencheur)");
const j = await db.query(`select action from journal where table_name = 'demandes_site'`);
ok(j.rows.length === 2, "le journal note les deux traitements");

console.log("== Numéro WhatsApp (migration 41) ==");
const avecNumero = async (s, tel, saisi = null, nom = "Anna Maria Keller-Schmid") => db.query(`insert into demandes_site (entite_id, marque, produit_id, nom, telephone, telephone_saisi) values ($1, $2, '4-islands', $3, $4, $5) returning id`, [ent[s], s, nom, tel, saisi]).then((r) => r.rows[0].id, (e) => ({ erreur: e.message }));
const wS = await avecNumero("secret", "+41791234567");
const wT = await avecNumero("taxi", "+66812345678");
ok(typeof wS === "string" && typeof wT === "string", "la fonction écrit un numéro E.164 et le nom complet");
ok(typeof (await avecNumero("secret", null, "079 123 45 67")) === "string", "un numéro illisible est gardé tel que saisi, sans numéro");
ok(typeof (await avecNumero("secret", null)) === "string", "une demande sans numéro (page en cache) passe toujours");
for (const faux of ["0791234567", "+41 79 123 45 67", "+0791234567", "+1234567", "+1234567890123456", "41791234567"]) ok((await avecNumero("secret", faux)).erreur, `la base refuse « ${faux} » (pas du E.164)`);
ok((await avecNumero("secret", "+41791234567", "079")).erreur, "pas de saisie gardée à côté d'un numéro lisible");
ok((await avecNumero("secret", null, "x".repeat(41))).erreur, "une saisie gardée fait 40 caractères au plus");
ok(typeof (await avecNumero("secret", "+41791234567", null, "x".repeat(120))) === "string" && (await avecNumero("secret", "+41791234567", null, "x".repeat(121))).erreur, "le nom complet va jusqu'à 120 caractères, pas plus");
const numeros = async (u) => ((await comme(u, "select telephone from demandes_site where telephone is not null order by telephone")).rows || []).map((r) => r.telephone).join(",");
ok((await numeros("lecteur")).split(",").every((n) => n === "+41791234567") && !(await numeros("lecteur")).includes("+66"), "un lecteur de Secret voit les numéros de Secret, pas ceux de Taxi");
ok((await numeros("ztp")) === "" && (await numeros("stagiaire")) === "" && (await numeros("mook")) === "", "Zwald, un rôle limité à ses dossiers et l'écran voucher seul ne voient aucun numéro");
ok((await essaie("anon", null, "select telephone from demandes_site")).ok === false, "anon ne lit aucun numéro");
ok((await comme("anais", `update demandes_site set telephone = '+33612345678' where id = '${wS}'`)).ok === false, "le numéro ne se modifie pas depuis l'outil (colonne fermée)");
ok(await db.query(`update demandes_site set telephone = '+33612345678' where id = '${wS}'`).then(() => false, () => true), "ni par la clé de service (déclencheur « figer »)");
await comme("anais", `update demandes_site set statut = 'confirmee' where id = '${wS}'`);
ok((await un(`select count(*)::int n from journal where table_name = 'demandes_site' and (details::text like '%41791234567%' or details::text like '%Keller-Schmid%')`)).n === 0, "le journal note le traitement, jamais le numéro ni le nom");

console.log("== Bandeaux ==");
const bandeau = (e, o = {}) => `insert into bandeaux_site (entite_id, marques, type, modele, texte, lien, lien_page, cible, produits) values ('${ent[e]}', '{${o.marques || "secret"}}', '${o.type || "sea"}', 'sea-today', '${o.texte || "Rough sea today: island trips are moved to tomorrow."}', '${o.lien || "aucun"}', ${o.page ? `'${o.page}'` : "null"}, '${o.cible || "tout"}', '{${o.produits || ""}}') returning id`;
const b1 = await comme("anais", bandeau("secret", { marques: "secret,taxi" }));
ok(b1.ok && b1.rows.length === 1, "Anaïs allume un bandeau pour les deux marques depuis Secret");
ok((await comme("lecteur", bandeau("secret"))).ok === false, "un lecteur ne crée pas de bandeau");
// Migration 40 (Jérémy, 17.11.2026) : Mook ne change pas les bandeaux. Écrire les dossiers ne suffit plus, il faut « reglages.ecrire ».
ok((await comme("editrice", bandeau("secret"))).ok === false, "une éditrice de Secret (sans « Modifier les réglages ») ne crée pas de bandeau");
ok((await comme("ztp", bandeau("secret"))).ok === false, "un éditeur de Zwald ne crée pas de bandeau chez Secret");
ok((await comme("ztp", bandeau("ztp"))).ok === false, "ni chez Zwald : seules Secret et Taxi publient sur secrettravelandtour.com");
ok((await comme("root", bandeau("ztp"))).ok === false, "même l'administratrice générale ne publie pas depuis Zwald");
ok((await comme("stagiaire", bandeau("secret"))).ok === false, "un rôle limité à ses dossiers ne publie pas sur le site");
ok((await comme("mook", bandeau("taxi"))).ok === false, "l'écran « Nouveau voucher » seul ne publie pas sur le site");
ok((await comme("anais", bandeau("secret", { texte: "x".repeat(141) }))).ok === false, "un texte de plus de 140 caractères est refusé");
ok((await comme("anais", bandeau("secret", { marques: "secret,ztp" }))).ok === false, "une marque inconnue est refusée");
ok((await comme("anais", bandeau("secret", { lien: "page", page: "https://ailleurs.example/" }))).ok === false, "un lien vers un autre site est refusé (chemin du site seulement)");
ok((await comme("anais", bandeau("secret", { cible: "produits" }))).ok === false, "« produits choisis » sans produit est refusé");
ok((await comme("anais", bandeau("secret", { lien: "page", page: "/tours/4-islands/", cible: "produits", produits: "4-islands" }))).ok, "un bandeau ciblé sur une sortie avec un lien vers sa page passe");
ok((await comme("lecteur", "select 1 from bandeaux_site")).rows.length === 2, "un lecteur de Secret voit les bandeaux de Secret");
ok((await comme("ztp", "select 1 from bandeaux_site")).rows.length === 0, "Zwald ne voit pas les bandeaux de Secret");
ok((await comme("anais", `update bandeaux_site set actif = false where id = '${b1.rows[0].id}'`)).n === 1, "un tap l'éteint");
ok((await comme("lecteur", `delete from bandeaux_site where id = '${b1.rows[0].id}'`)).n === 0, "un lecteur ne le supprime pas");
ok((await comme("editrice", "select 1 from bandeaux_site")).rows.length === 2, "l'éditrice voit toujours les bandeaux");
ok((await comme("editrice", `update bandeaux_site set actif = true where id = '${b1.rows[0].id}'`)).n === 0, "l'éditrice ne rallume ni ne modifie un bandeau");
ok((await comme("editrice", `delete from bandeaux_site where id = '${b1.rows[0].id}'`)).n === 0, "l'éditrice ne supprime pas un bandeau");
ok((await comme("anais", `update bandeaux_site set fin = debut - interval '1 hour' where id = '${b1.rows[0].id}'`)).ok === false, "une fin avant le début est refusée");

console.log("== Fonctions ==");
ok((await essaie("anon", null, `select lit_demandes_site('${ent.secret}')`)).ok === false, "anon n'appelle pas la fonction de droits");

console.log("== En direct (migration 47) ==");
// Les migrations ont déjà tourné sans publication Realtime (base neuve, PGlite) : la 47 n'y a rien fait. Avec la publication de Supabase, elle y
// ajoute demandes_site, une seule fois.
ok(!(await db.query("select 1 from pg_publication_tables where tablename = 'demandes_site'")).rows.length, "sans publication Realtime, la migration 47 ne fait rien et ne bloque pas");
await db.exec("create publication supabase_realtime;");
await db.exec(fs.readFileSync(W + "migration-47-demandes-direct.sql", "utf8"));
await db.exec(fs.readFileSync(W + "migration-47-demandes-direct.sql", "utf8"));
const publiees = (await db.query("select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime'")).rows;
ok(publiees.length === 1 && publiees[0].tablename === "demandes_site" && publiees[0].schemaname === "public", "demandes_site entre dans la publication Realtime, seule, et la migration se rejoue");

console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTOUT EST BON");
process.exit(echecs ? 1 : 0);
