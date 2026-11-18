// Vérifie la migration 38 (équipe et réglages, lot D) et donnees-mook-secret-prix.sql sur un Postgres en mémoire :
//   * le rôle Administrateur reçoit tous les droits de la base, même si sa liste enregistrée est vide (droits calculés) ;
//   * la liste de la base est celle de l'outil (defauts.mjs), clients.fusionner et partenaires.supprimer compris ;
//   * sans « partenaires.prix », on modifie une prestation ou un trajet mais jamais son prix ; le rôle de Mook le perd, garde le reste ;
//   * chaque enregistrement des réglages garde la version remplacée, lisible seulement par qui modifie les réglages, jamais réécrite.
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-equipe-reglages.mjs . && GESTION_SQL=<repo>/docs/gestion/ GESTION_SRC=file://<repo>/src/gestion/js/ node verif-equipe-reglages.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
const SRC = process.env.GESTION_SRC || "../src/gestion/js/";
const { TOUTES_PERMISSIONS } = await import(SRC + "defauts.mjs");
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
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema public, auth to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
const db = new PGlite();
await db.exec(harnais);
await db.exec((fs.readFileSync(W + "schema.sql", "utf8") + fs.readFileSync(W + "donnees-ztp-depart.sql", "utf8")).replace("create extension if not exists pgcrypto;", ""));
// Toutes les migrations dans l'ordre (18 et suivantes), puis la 38 une seconde fois : elle se rejoue sans erreur ni doublon.
const migs = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
ok(migs.some((n) => n.startsWith("migration-38-")), "la migration 38 est trouvée");
for (const f of migs) await db.exec(fs.readFileSync(W + f, "utf8"));
await db.exec(fs.readFileSync(W + migs.find((n) => n.startsWith("migration-38-")), "utf8"));

const essaie = async (userId, sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  // La connexion simulée s'arrête avec l'essai : la suite (préparation des données) s'écrit comme la base elle-même, sans personne connectée.
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
};
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const secret = (await un("select id from entites where slug = 'secret'")).id;

// ---- 1. Liste des droits et Administrateur calculé ----------------------------------------------------------------------------------
const base = (await un("select toutes_permissions() t")).t;
ok(JSON.stringify([...base].sort()) === JSON.stringify([...TOUTES_PERMISSIONS].sort()), "la liste de la base est celle de l'outil (defauts.mjs)");
for (const d of ["clients.fusionner", "partenaires.supprimer", "partenaires.prix", "fiduciaire.gerer"]) ok(base.includes(d), `« ${d} » est dans tous les droits`);
const admins = (await db.query("select tous_droits from roles where nom = 'Administrateur' and systeme")).rows;
ok(admins.length > 0 && admins.every((r) => r.tous_droits), "chaque rôle système Administrateur a « tous les droits »");
ok((await un("select count(*)::int n from roles where tous_droits and not (systeme and nom = 'Administrateur')")).n === 0, "aucun autre rôle ne les reçoit");

const U = {};
// La première personne inscrite devient administratrice générale : on la crée d'abord, à part.
for (const k of ["root", "mook", "anais", "lectrice"]) U[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
// Le rôle réel de Mook dans Secret, tel que relevé en production le 17.11.2026 (sans « partenaires.prix », que la migration ajoute ensuite).
await db.exec(`insert into roles (entite_id, nom, description, portee, permissions, systeme) values ('${secret}', 'Éditeur + factures fiduciaire', '', 'toute',
  array['catalogue.ecrire','clients.ecrire','clients.lire','documents.ecrire','dossiers.ecrire','dossiers.lire','fiduciaire.preparer','finances.voir','partenaires.ecrire','partenaires.lire','taches.ecrire'], false)`);
await db.exec(`insert into membres values ('${U.mook}', '${secret}', (select id from roles where entite_id = '${secret}' and nom = 'Éditeur + factures fiduciaire'))`);
await db.exec(`insert into membres values ('${U.anais}', '${secret}', (select id from roles where entite_id = '${secret}' and nom = 'Administrateur'))`);
await db.exec(`insert into membres values ('${U.lectrice}', '${secret}', (select id from roles where entite_id = '${secret}' and nom = 'Lecteur'))`);

// Liste enregistrée vidée : l'Administrateur garde tous les droits. Un droit ajouté plus tard à toutes_permissions() lui arrive sans SQL sur le rôle.
await db.exec(`update roles set permissions = '{}' where entite_id = '${secret}' and nom = 'Administrateur'`);
const droitsAnais = (await essaie(U.anais, "select permissions_dans($1) p", [secret])).rows[0].p;
ok(JSON.stringify([...droitsAnais].sort()) === JSON.stringify([...base].sort()), "l'Administratrice a tous les droits, liste enregistrée vide ou non");
const droitsLectrice = (await essaie(U.lectrice, "select permissions_dans($1) p", [secret])).rows[0].p;
ok(!droitsLectrice.includes("reglages.ecrire") && droitsLectrice.includes("partenaires.lire"), "un rôle ordinaire garde sa liste enregistrée");

// ---- 2. Prix de vente ---------------------------------------------------------------------------------------------------------------
// Rejouer la migration après l'ajout du rôle de Mook : comme en production, il reçoit « partenaires.prix » (il a « partenaires.ecrire »).
await db.exec(fs.readFileSync(W + migs.find((n) => n.startsWith("migration-38-")), "utf8"));
const droitsMook = async () => (await un("select permissions from roles where entite_id = $1 and nom = 'Éditeur + factures fiduciaire'", [secret])).permissions;
ok((await droitsMook()).includes("partenaires.prix"), "la migration donne le droit aux rôles qui modifient les partenaires (personne ne perd rien)");
ok((await droitsMook()).filter((d) => d === "partenaires.prix").length === 1, "sans doublon après deux passages");
ok((await un("select permissions from roles where entite_id = $1 and nom = 'Éditeur'", [secret])).permissions.includes("partenaires.prix"), "l'Éditeur système le reçoit aussi");
ok(!(await un("select permissions from roles where entite_id = $1 and nom = 'Lecteur'", [secret])).permissions.includes("partenaires.prix"), "le Lecteur ne le reçoit pas");
for (let i = 0; i < 2; i++) await db.exec(fs.readFileSync(W + "donnees-mook-secret-prix.sql", "utf8"));
const apres = await droitsMook();
ok(!apres.includes("partenaires.prix") && !apres.includes("partenaires.supprimer"), "le SQL de Mook retire le prix et la suppression");
ok(["partenaires.ecrire", "partenaires.lire", "fiduciaire.preparer", "documents.ecrire", "catalogue.ecrire", "dossiers.ecrire"].every((d) => apres.includes(d)) && apres.length === 11, "le reste de son rôle ne change pas (11 droits)");

const part = (await un("insert into partenaires (entite_id, nom) values ($1, 'Tour Example') returning id", [secret])).id;
const pres = (await un("insert into prestations (entite_id, partenaire_id, famille, libelle, prix_vente, unite, details) values ($1, $2, 'excursion', 'Island tour', 1500, 'pp', '{\"enfant\": 900, \"duree\": \"6 h\"}') returning id", [secret, part])).id;
const traj = (await un("insert into trajets (entite_id, partenaire_id, de, vers, prix_adulte, prix_enfant) values ($1, $2, 'Lanta', 'Phi Phi', 750, 500) returning id", [secret, part])).id;
const refuse = (r) => !r.ok && /prix de vente est réservé/.test(r.err);
const passe = (r) => r.ok && r.rows.length === 1;

ok(passe(await essaie(U.mook, "update prestations set libelle = 'Island tour (4 islands)', details = details || '{\"duree\": \"7 h\"}' where id = $1 returning id", [pres])), "Mook modifie le libellé et la durée d'une prestation");
ok(passe(await essaie(U.mook, "update prestations set actif = false where id = $1 returning id", [pres])), "Mook masque une prestation");
ok(passe(await essaie(U.mook, "update prestations set prix_vente = 1500, actif = true where id = $1 returning id", [pres])), "réécrire le même prix (formulaire complet) passe");
ok(refuse(await essaie(U.mook, "update prestations set prix_vente = 1200 where id = $1 returning id", [pres])), "Mook ne change pas le prix de vente");
ok(refuse(await essaie(U.mook, "update prestations set details = details || '{\"enfant\": 500}' where id = $1 returning id", [pres])), "ni le prix enfant");
ok(refuse(await essaie(U.mook, "update prestations set details = details - 'enfant' where id = $1 returning id", [pres])), "ni ne retire le prix enfant");
ok(refuse(await essaie(U.mook, "update prestations set unite = 'grp' where id = $1 returning id", [pres])), "ni l'unité (par personne devenu par groupe)");
ok(refuse(await essaie(U.mook, "update trajets set prix_adulte = 600 where id = $1 returning id", [traj])), "ni le prix adulte d'un trajet");
ok(refuse(await essaie(U.mook, "update trajets set prix_enfant = null where id = $1 returning id", [traj])), "ni son prix enfant");
ok(passe(await essaie(U.mook, "update trajets set depart = '09:00' where id = $1 returning id", [traj])), "elle change l'heure d'un trajet");
ok(refuse(await essaie(U.mook, "insert into prestations (entite_id, partenaire_id, famille, libelle, prix_vente) values ($1, $2, 'excursion', 'Copie', 1500) returning id", [secret, part])), "elle ne crée pas une prestation avec un prix");
ok(passe(await essaie(U.mook, "insert into prestations (entite_id, partenaire_id, famille, libelle) values ($1, $2, 'excursion', 'Sans prix') returning id", [secret, part])), "elle crée une prestation sans prix");
ok(refuse(await essaie(U.mook, "insert into trajets (entite_id, partenaire_id, de, vers, prix_adulte) values ($1, $2, 'Lanta', 'Lipe', 1800) returning id", [secret, part])), "elle ne crée pas un trajet avec un prix");
ok((await essaie(U.mook, "delete from partenaires where id = $1 returning id", [part])).rows.length === 0, "elle ne supprime pas un partenaire (droit partenaires.supprimer, migration 33)");
const p = await un("select prix_vente, unite, details->'enfant' enfant from prestations where id = $1", [pres]);
ok(Number(p.prix_vente) === 1500 && p.unite === "pp" && Number(p.enfant) === 900, "les prix sont intacts");
ok(passe(await essaie(U.anais, "update prestations set prix_vente = 1600, details = details || '{\"enfant\": 950}' where id = $1 returning id", [pres])), "l'administratrice change le prix");
ok(passe(await essaie(U.anais, "update trajets set prix_adulte = 800 where id = $1 returning id", [traj])), "et celui d'un trajet");
ok(passe({ ok: true, rows: (await db.query("update prestations set prix_vente = 1700 where id = $1 returning id", [pres])).rows }), "la base elle-même (sans connexion) n'est pas bloquée");
await db.exec(`select set_config('request.jwt.claim.sub', '${U.mook}', false)`);
ok((await db.query("update prestations set prix_vente = 1750 where id = $1 returning id", [pres])).rows.length === 1, "ni le SQL d'administration, même avec une session restée posée");
await db.exec("select set_config('request.jwt.claim.sub', '', false)");

// ---- 3. Historique des réglages -----------------------------------------------------------------------------------------------------
// Les migrations qui remplissent des réglages (44 : noms et marques) laissent une version ; on part d'un historique vide pour compter.
await db.exec("delete from reglages_historique");
const avant = (await un("select valeur from reglages where entite_id = $1", [secret])).valeur;
ok(passe(await essaie(U.anais, "update reglages set valeur = valeur || '{\"devise\": \"EUR\"}' where entite_id = $1 returning entite_id", [secret])), "l'administratrice enregistre les réglages");
let hist = await essaie(U.anais, "select valeur, remplace_par from reglages_historique where entite_id = $1 order by remplace_le desc, id desc", [secret]);
ok(hist.ok && hist.rows.length === 1 && JSON.stringify(hist.rows[0].valeur) === JSON.stringify(avant) && hist.rows[0].remplace_par === U.anais, "la version remplacée est gardée, avec qui l'a remplacée");
ok(passe(await essaie(U.anais, "update reglages set valeur = valeur where entite_id = $1 returning entite_id", [secret])), "un enregistrement sans changement…");
ok((await un("select count(*)::int n from reglages_historique where entite_id = $1", [secret])).n === 1, "…n'ajoute pas de version");
ok((await essaie(U.mook, "select id from reglages_historique where entite_id = $1", [secret])).rows.length === 0, "Mook (sans « modifier les réglages ») ne lit pas l'historique");
ok((await essaie(U.lectrice, "select id from reglages_historique")).rows.length === 0, "la lectrice non plus");
ok(!(await essaie(U.anais, "insert into reglages_historique (entite_id, valeur) values ($1, '{}') returning id", [secret])).ok, "personne n'écrit une version à la main");
ok(!(await essaie(U.anais, "delete from reglages_historique where entite_id = $1 returning id", [secret])).ok || (await un("select count(*)::int n from reglages_historique where entite_id = $1", [secret])).n === 1, "ni n'efface l'historique");
for (let i = 0; i < 70; i++) await db.query("update reglages set valeur = valeur || jsonb_build_object('essai', $2::int) where entite_id = $1", [secret, i]);
ok((await un("select count(*)::int n from reglages_historique where entite_id = $1", [secret])).n === 60, "60 versions au plus par entreprise");
// « Revenir à cette version » : l'outil réenregistre une ancienne valeur ; la version remplacée entre à son tour dans l'historique.
const vieille = (await un("select valeur from reglages_historique where entite_id = $1 order by remplace_le asc, id asc limit 1", [secret])).valeur;
ok(passe(await essaie(U.anais, "update reglages set valeur = $2 where entite_id = $1 returning entite_id", [secret, vieille])), "revenir à une version se fait en la réenregistrant");
ok(JSON.stringify((await un("select valeur from reglages where entite_id = $1", [secret])).valeur) === JSON.stringify(vieille), "les réglages sont ceux de la version choisie");

console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTOUT EST BON");
process.exit(echecs ? 1 : 0);
