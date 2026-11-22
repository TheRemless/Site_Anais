// Vérifie la migration 117 (prix de vente lus par le site secrettravelandtour.com) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// prix_publics_site rend SEULEMENT l'identifiant et le prix de vente des tarifs actifs de Secret et de Taxi demandés : jamais un net, une
// commission, un partenaire, un libellé, une note ni un tarif de ZTP ; la clé publique ne lit aucune table et n'appelle que cette fonction ;
// le déclencheur note les seuls changements de prix de Secret et de Taxi ; prix_site_relancer attend le lot, appelle le build hook de Vault
// au plus une fois par heure et réessaie après un refus de Netlify ; la migration se rejoue ; retour en arrière complet.
// Vault, pg_net et pg_cron sont simulés (mêmes noms de tables et de fonctions que sur Supabase), aucun secret réel.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-prix-publics-site.mjs
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
-- Vault, pg_net et pg_cron simulés.
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create schema net;
create table net.appels (id bigserial primary key, url text, body jsonb, params jsonb, timeout_milliseconds integer);
create table net._http_response (id bigint primary key, status_code integer, content text);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{"Content-Type": "application/json"}', timeout_milliseconds integer default 5000)
  returns bigint language sql as $$ insert into net.appels (url, body, params, timeout_milliseconds) values (url, body, params, timeout_milliseconds) returning id $$;
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
`;
const MIG = "migration-117-prix-publics-site.sql";
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d|1\d\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
ok(migrations.includes(MIG) && migrations.indexOf(MIG) > migrations.indexOf("migration-116-courses-partenaire-details.sql"), "la migration 117 passe après la 116, sur une base vide");
for (const f of migrations) await db.exec(lire(f));

const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
async function comme(role, sql, params = [], userId = "") {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, champs: r.fields.map((f) => f.name) }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}

// ---- Données fictives -------------------------------------------------------------------------------------------------------------
const ent = {};
for (const sl of ["ztp", "secret", "taxi"]) ent[sl] = (await un("select id from entites where slug = $1", [sl])).id;
const partenaire = async (e) => (await un("insert into partenaires (entite_id, nom, contact) values ($1, 'PARTENAIRE-SECRET', '{}'::jsonb) returning id", [e])).id;
const P = { secret: await partenaire(ent.secret), taxi: await partenaire(ent.taxi), ztp: await partenaire(ent.ztp) };
const tarif = async (e, prix, o = {}) => {
  const id = (await un("insert into prestations (entite_id, partenaire_id, famille, groupe, libelle, libelle_en, prix_vente, unite, actif, details) values ($1, $2, 'excursion', 'GROUPE-SECRET', 'LIBELLE-SECRET', 'LIBELLE-EN-SECRET', $3, 'pp', $4, '{\"note\": \"NOTE-SECRETE\"}'::jsonb) returning id",
    [ent[e], P[e], prix, o.actif ?? true])).id;
  await db.query("insert into prestations_nets (entite_id, prestation_id, net, net_enfant, note) values ($1, $2, 77777, 66666, 'NOTE-NET-SECRETE')", [ent[e], id]);
  return id;
};
const T = { a: await tarif("secret", 2000), inactif: await tarif("secret", 2500, { actif: false }), sansPrix: await tarif("secret", null), zero: await tarif("secret", 0), taxi: await tarif("taxi", 2300), ztp: await tarif("ztp", 9000), autre: await tarif("secret", 1500) };
const tous = Object.values(T);
const remiseAZero = () => db.exec("update prix_site_attente set a_publier = false, premier_changement = null, dernier_changement = null, changements = 0, dernier_appel = null, derniere_requete = null, dernier_resultat = '' where id");
await remiseAZero();

// ---- 1. Ce que rend la fonction publique --------------------------------------------------------------------------------------------
console.log("== prix_publics_site");
const r = await comme("anon", "select * from prix_publics_site($1::uuid[])", [tous]);
ok(r.ok, "la clé publique (anon) appelle prix_publics_site : " + (r.err || ""));
ok(JSON.stringify(r.champs) === JSON.stringify(["prestation", "prix_vente"]), "deux colonnes seulement : prestation et prix_vente (" + r.champs + ")");
const rendus = new Map((r.rows || []).map((x) => [x.prestation, Number(x.prix_vente)]));
ok(rendus.size === 3 && rendus.get(T.a) === 2000 && rendus.get(T.taxi) === 2300 && rendus.get(T.autre) === 1500, "les tarifs actifs avec prix de Secret et de Taxi, au prix de vente");
ok(!rendus.has(T.inactif) && !rendus.has(T.sansPrix) && !rendus.has(T.zero), "ni tarif inactif, ni tarif sans prix, ni tarif à 0");
ok(!rendus.has(T.ztp), "aucun tarif de ZTP");
const texte = JSON.stringify(r.rows);
ok(!/77777|66666|NOTE|PARTENAIRE|LIBELLE|GROUPE|pp"/.test(texte), "aucun net, net enfant, note, partenaire, libellé, groupe ni unité dans la réponse");
const seul = await comme("anon", "select * from prix_publics_site($1::uuid[])", [[T.a]]);
ok(seul.ok && seul.rows.length === 1 && seul.rows[0].prestation === T.a, "seuls les identifiants demandés sortent");
for (const [arg, nom] of [["null", "null"], ["'{}'::uuid[]", "liste vide"]]) {
  const v = await comme("anon", `select * from prix_publics_site(${arg})`);
  ok(v.ok && v.rows.length === 0, `sans identifiant (${nom}) : rien, on ne parcourt pas le catalogue`);
}
const beaucoup = await comme("anon", "select count(*)::int n from prix_publics_site(array_fill($1::uuid, array[1000]) || $2::uuid)", [T.ztp, T.a]);
ok(beaucoup.ok && beaucoup.rows[0].n === 0, "au plus 1 000 identifiants par appel (le 1 001e est ignoré)");
const def = await un("select p.prosecdef, p.proconfig, p.provolatile, pg_get_function_result(p.oid) res from pg_proc p where p.proname = 'prix_publics_site'");
ok(def.prosecdef && String(def.proconfig).includes("search_path=public, pg_temp") && def.provolatile === "s", "security definer, search_path fixé, stable");
ok(def.res === "TABLE(prestation uuid, prix_vente numeric)", "signature : " + def.res);
const corps = (await un("select prosrc from pg_proc where proname = 'prix_publics_site'")).prosrc;
ok(!/nets|commission|partenaire|libelle|note|details/i.test(corps), "le corps de la fonction ne lit ni nets, ni commissions, ni partenaires, ni libellés, ni notes");

// ---- 2. La clé publique ne lit rien d'autre ---------------------------------------------------------------------------------------------
console.log("== droits");
for (const sql of ["select * from prestations", "select * from prestations_nets", "select * from prix_site_attente", "select prix_site_relancer()", "select * from partenaires"]) {
  const x = await comme("anon", sql);
  ok(!x.ok, `anon refusé : ${sql}`);
}
const u = (await un("insert into auth.users (email) values ('membre@test') returning id")).id;
for (const sql of ["select * from prix_site_attente", "select prix_site_relancer()", "update prix_site_attente set a_publier = true"]) {
  const x = await comme("authenticated", sql, [], u);
  ok(!x.ok, `utilisateur connecté refusé : ${sql}`);
}
const authPrix = await comme("authenticated", "select * from prix_publics_site($1::uuid[])", [[T.a]], u);
ok(authPrix.ok && authPrix.rows.length === 1, "un utilisateur connecté lit les mêmes prix publics, rien de plus");
ok((await un("select count(*)::int n from information_schema.role_routine_grants where routine_name in ('prix_site_noter', 'prix_site_relancer') and grantee in ('anon', 'authenticated', 'PUBLIC')")).n === 0, "prix_site_noter et prix_site_relancer : aucun droit pour anon, authenticated ou public");

// ---- 3. Le déclencheur -------------------------------------------------------------------------------------------------------------------
console.log("== déclencheur");
const etat = () => un("select a_publier, changements, premier_changement, dernier_changement from prix_site_attente");
await db.query("update prestations set libelle = 'Autre libellé', ordre = 4, details = '{}'::jsonb where id = $1", [T.a]);
await db.query("update prestations_nets set net = 1 where prestation_id = $1", [T.a]);
ok(!(await etat()).a_publier, "libellé, ordre, détails ou net changés : pas de build");
await db.query("update prestations set prix_vente = 9500 where id = $1", [T.ztp]);
ok(!(await etat()).a_publier, "prix de ZTP changé : pas de build");
await db.query("update prestations set prix_vente = 2100 where id = $1", [T.a]);
let e = await etat();
ok(e.a_publier && e.changements === 1 && e.premier_changement, "prix de vente de Secret changé : note posée");
await db.query("update prestations set prix_vente = 2400 where id = $1", [T.taxi]);
await db.query("update prestations set actif = false where id = $1", [T.autre]);
e = await etat();
ok(e.a_publier && e.changements === 3, "prix de Taxi et tarif désactivé : le lot compte 3 changements");
await remiseAZero();
const nouveau = await tarif("taxi", 1800);
ok((await etat()).a_publier, "nouveau tarif de Taxi : note posée");
await remiseAZero();
await db.query("delete from prestations where id = $1", [nouveau]);
ok((await etat()).a_publier, "tarif supprimé : note posée");
await remiseAZero();
await db.query("update prestations set prix_vente = prix_vente where id = $1", [T.a]);
ok(!(await etat()).a_publier, "même prix réenregistré : pas de build");
// Le déclencheur ne bloque jamais l'enregistrement d'un prix, même si la note est inaccessible.
await db.exec("alter table prix_site_attente add constraint casse check (changements < 0) not valid");
let enregistre = true;
try { await db.query("update prestations set prix_vente = 2200 where id = $1", [T.a]); } catch { enregistre = false; }
ok(enregistre && Number((await un("select prix_vente from prestations where id = $1", [T.a])).prix_vente) === 2200, "une note en échec n'empêche pas d'enregistrer le prix");
await db.exec("alter table prix_site_attente drop constraint casse");
await remiseAZero();

// ---- 4. prix_site_relancer : lot, secret, une fois par heure, nouvel essai ----------------------------------------------------------------
console.log("== relance du build");
const relancer = async () => (await un("select prix_site_relancer() r")).r;
const appels = async () => (await db.query("select * from net.appels order by id")).rows;
ok((await relancer()) === "rien à publier", "sans changement : rien");
await db.query("update prestations set prix_vente = 2300 where id = $1", [T.a]);
ok((await relancer()) === "changement en cours, attente du lot", "changement de moins de 10 minutes : on attend le lot");
await db.exec("update prix_site_attente set dernier_changement = now() - interval '11 minutes' where id");
ok((await relancer()) === "build hook absent", "sans secret dans Vault : pas d'appel");
ok((await etat()).a_publier && (await appels()).length === 0, "la note reste, aucun appel");
await db.exec("insert into vault.secrets (name, secret) values ('netlify_build_hook_stt', 'https://exemple.test/build_hooks/abc')");
ok((await relancer()) === "build hook absent" && (await appels()).length === 0, "un secret qui n'est pas une adresse de build hook Netlify n'est pas appelé");
await db.exec("update vault.secrets set secret = 'https://api.netlify.com/build_hooks/0123456789abcdef01234567' where name = 'netlify_build_hook_stt'");
ok((await relancer()) === "build demandé", "lot calme et secret présent : build demandé");
let a = await appels();
ok(a.length === 1 && a[0].url === "https://api.netlify.com/build_hooks/0123456789abcdef01234567" && a[0].params.trigger_title === "Prix Gestion (1 changement)", "un seul appel, vers le build hook, titré « Prix Gestion »");
const apres = await un("select a_publier, changements, derniere_requete, dernier_resultat from prix_site_attente");
ok(!apres.a_publier && apres.changements === 0 && Number(apres.derniere_requete) === Number(a[0].id), "note effacée, requête retenue");
ok(!/build_hooks/.test(apres.dernier_resultat), "le résultat noté ne recopie jamais le secret");
ok((await relancer()) === "rien à publier" && (await appels()).length === 1, "passage suivant sans changement : aucun build");
// Netlify accepte : le résultat est noté. Puis un nouveau lot moins d'une heure après le dernier build attend.
await db.query("insert into net._http_response (id, status_code) values ($1, 200)", [a[0].id]);
await db.query("update prestations set prix_vente = 2350 where id = $1", [T.a]);
await db.exec("update prix_site_attente set dernier_changement = now() - interval '20 minutes', dernier_appel = now() - interval '30 minutes' where id");
ok((await relancer()) === "build demandé il y a moins d'une heure, attente", "au plus un build par heure");
ok((await un("select dernier_resultat from prix_site_attente")).dernier_resultat === "build accepté par Netlify (200)", "réponse 200 de Netlify notée");
await db.exec("update prix_site_attente set dernier_appel = now() - interval '56 minutes' where id");
ok((await relancer()) === "build demandé" && (await appels()).length === 2, "après l'heure : le lot part");
// Netlify refuse : le passage suivant remet la note et réessaie après l'heure.
a = await appels();
await db.query("insert into net._http_response (id, status_code) values ($1, 500)", [a[1].id]);
await db.exec("update prix_site_attente set dernier_appel = now() - interval '56 minutes' where id");
ok((await relancer()) === "build demandé" && (await appels()).length === 3, "réponse 500 de Netlify : nouvel essai");
a = await appels();
await db.query("insert into net._http_response (id, status_code) values ($1, null)", [a[2].id]);
ok((await relancer()) === "build demandé il y a moins d'une heure, attente" && (await etat()).a_publier, "pas de réponse (délai dépassé) : la note revient, essai au prochain créneau");

// ---- 5. Rejouer, puis retour en arrière ------------------------------------------------------------------------------------------------
console.log("== rejouer et retour");
const sql117 = lire(MIG);
ok(/^-- Gestion : migration 117/.test(sql117) && /Retour en arrière : docs\/gestion\/retour-117-prix-publics-site\.sql/.test(sql117) && /\nbegin;\n[\s\S]*\ncommit;\n$/.test(sql117), "en-tête, retour en arrière et transaction");
ok(!/build_hooks\/[A-Za-z0-9]/.test(sql117 + lire("cron-prix-site.sql")), "aucun build hook écrit dans la migration ni dans le fichier cron");
await db.exec(sql117);
ok((await un("select count(*)::int n from prix_site_attente")).n === 1 && (await etat()).a_publier, "rejouée : une seule ligne, la note gardée");
ok((await un("select count(*)::int n from pg_trigger where tgname = 'prix_site_a_revoir'")).n === 1, "rejouée : un seul déclencheur");
await db.exec("select cron.schedule('prix-site', '11,41 * * * *', 'select prix_site_relancer()')");
await db.exec(lire("retour-117-prix-publics-site.sql"));
ok((await un("select count(*)::int n from pg_proc where proname in ('prix_publics_site', 'prix_site_noter', 'prix_site_relancer')")).n === 0, "retour : les trois fonctions retirées");
ok(!(await un("select to_regclass('public.prix_site_attente') t")).t && (await un("select count(*)::int n from pg_trigger where tgname = 'prix_site_a_revoir'")).n === 0, "retour : table et déclencheur retirés");
ok((await un("select count(*)::int n from cron.job where jobname = 'prix-site'")).n === 0, "retour : le job prix-site retiré");
ok((await un("select count(*)::int n from vault.secrets where name = 'netlify_build_hook_stt'")).n === 1, "retour : le secret n'est pas touché (à retirer à part)");
await db.query("update prestations set prix_vente = 2000 where id = $1", [T.a]);
ok(Number((await un("select prix_vente from prestations where id = $1", [T.a])).prix_vente) === 2000, "après le retour, les prix s'enregistrent comme avant");
const anonApres = await comme("anon", "select * from prix_publics_site($1::uuid[])", [[T.a]]);
ok(!anonApres.ok, "après le retour, la clé publique n'a plus rien");
await db.exec(sql117);
ok((await comme("anon", "select * from prix_publics_site($1::uuid[])", [[T.a]])).rows?.length === 1, "la migration se rejoue après le retour");

console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
