// Vérifie la migration 123 (notifications en thaï du partenaire chauffeur) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// Règle commune avec partenaire_courses() (mêmes courses), liste blanche des colonnes, nouvelle course, rafale de changements (une seule
// notification), annulation, périmètre (autre fiche, Secret), compte désactivé ou accès retiré, droits, migration rejouée, retour en arrière.
// Données fictives uniquement.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-notifications-partenaire.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
let echecs = 0;
const ok = (c, msg) => { if (!c) { echecs++; console.log("  ECHEC:", msg); } else console.log("  ok:", msg); };
const harnais = `
create role anon; create role authenticated; create role service_role bypassrls; -- comme sur Supabase
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
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;
const MIG = "migration-123-notifications-partenaire.sql";
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
// Les abonnements des téléphones (migration 17, avant la numérotation que rejouent les contrôles).
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql") + lire("migration-17-rappels.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d|1\d\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
ok(migrations.includes(MIG) && migrations.indexOf(MIG) > migrations.indexOf("migration-119-corriger-commission.sql"), "la migration 123 passe après la 119, sur une base vide");
for (const f of migrations) await db.exec(lire(f));

async function essaie(userId, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
async function commeRole(role, sql, params = []) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; } catch (e) { return { ok: false, err: e.message }; } finally { await db.exec("reset role;"); }
}
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];

// ---- Données fictives ----------------------------------------------------------------------------------------------------------------
const ent = {};
for (const sl of ["ztp", "secret", "taxi"]) ent[sl] = (await un("select id from entites where slug = $1", [sl]))?.id;
const ORG = (await un("select organisation_id from entites where id = $1", [ent.taxi])).organisation_id;
for (const [e, f] of [[ent.taxi, "taxi"], [ent.secret, "excursions"]]) {
  await db.query("insert into reglages (entite_id, valeur) values ($1, $2::jsonb) on conflict (entite_id) do update set valeur = reglages.valeur || excluded.valeur", [e, JSON.stringify({ fonctionnement: f, devise: "THB" })]);
}
const u = {};
for (const k of ["nani", "brown", "autre"]) u[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test.invalid"])).id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
await db.exec(`insert into membres values ('${u.nani}', '${ent.taxi}', (select id from roles where entite_id = '${ent.taxi}' and nom = 'Administrateur')) on conflict do nothing`);
const partenaire = async (entite, nom) => (await un("insert into partenaires (entite_id, nom, contact) values ($1, $2, $3::jsonb) returning id", [entite, nom, JSON.stringify({ personne: "Chauffeur test" })])).id;
const P = { vip: await partenaire(ent.taxi, "VIP Taxi test"), autreTaxi: await partenaire(ent.taxi, "Autre chauffeur test"), secret: await partenaire(ent.secret, "Bateau test") };
const jour = async (n) => (await un(`select ((now() at time zone 'Asia/Bangkok')::date + ${n})::text d`)).d;
let nref = 0;
async function course(entite, partenaireId, n, { heure = "10:00", lieu = "Hotel Test A", details = { drop_off: "Airport Test" } } = {}) {
  const c = (await un("insert into clients (entite_id, prenom, nom, telephone) values ($1, 'Test', $2, '+44 7700 900111') returning id", [entite, "Client" + nref])).id;
  const d = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, $2, $3) returning id", [entite, "T-" + ++nref, c])).id;
  return (await un("insert into reservations (entite_id, dossier_id, partenaire_id, libelle, date_service, heure_pickup, lieu_pickup, personnes, statut, montant_vente, paye_sur_place, details, notes) values ($1, $2, $3, 'Private Taxi test', $4, $5, $6, $7::jsonb, 'confirme', 1800, true, $8::jsonb, 'note interne test') returning id",
    [entite, d, partenaireId, await jour(n), heure, lieu, JSON.stringify({ adultes: 2, enfants: 1, bebes: 0 }), JSON.stringify(details)])).id;
}
const R = { avant: await course(ent.taxi, P.vip, 1), sansPartenaire: await course(ent.taxi, null, 2), passee: await course(ent.taxi, P.vip, -1) };
await db.query("insert into partenaires_acces (user_id, partenaire_id) values ($1, $2)", [u.brown, P.vip]);

// Un passage de la fonction d'envoi (clé de service), et le temps qui passe (les empreintes vieillissent de 11 minutes).
const passage = async (delai = null) => {
  const r = await commeRole("service_role", delai === null ? "select * from partenaire_notifs_changements()" : "select * from partenaire_notifs_changements($1::interval)", delai === null ? [] : [delai]);
  if (!r.ok) throw new Error(r.err);
  return r.rows;
};
const vieillir = () => db.exec("update partenaires_notifs_courses set vue_le = vue_le - interval '11 minutes'");
const suivies = async () => (await db.query("select reservation_id from partenaires_notifs_courses where user_id = $1", [u.brown])).rows.map((x) => x.reservation_id);
const abonner = () => db.query("insert into abonnements_push (user_id, endpoint, p256dh, auth) values ($1, $2, 'cle-test', 'auth-test') on conflict do nothing", [u.brown, "https://push.test.invalid/" + u.brown]);

// ---- Structure et droits --------------------------------------------------------------------------------------------------------------
const exec = async (role, f) => (await un(`select has_function_privilege('${role}', '${f}', 'execute') a`)).a;
for (const f of ["partenaire_acces_de(uuid)", "partenaire_courses_de(uuid)"]) {
  ok(!(await exec("authenticated", f)) && !(await exec("anon", f)) && !(await exec("service_role", f)), `${f} : interne, ni l'API ni la clé de service`);
}
for (const f of ["partenaire_notif_courses(uuid)", "partenaire_notifs_changements(interval)"]) {
  ok(!(await exec("authenticated", f)) && !(await exec("anon", f)) && (await exec("service_role", f)), `${f} : clé de service seulement`);
}
ok((await exec("authenticated", "partenaire_courses()")) && !(await exec("anon", "partenaire_courses()")), "partenaire_courses() : toujours ouverte au compte connecté, jamais à anon");
for (const t of ["partenaires_notifs_courses", "partenaires_notifs_etat", "partenaires_notifs_envois"]) {
  ok(!!(await un("select 1 x from pg_class where relname = $1 and relrowsecurity", [t])), `${t} : RLS active`);
  ok(!(await commeRole("authenticated", `select * from ${t}`)).ok && !(await commeRole("anon", `select * from ${t}`)).ok, `${t} : fermée à l'API`);
}
ok(!(await commeRole("service_role", "select * from partenaires_notifs_courses")).ok, "les empreintes ne se lisent que par la fonction");
ok((await commeRole("service_role", "select * from partenaires_notifs_envois")).ok, "la clé de service lit et marque les envois");
ok(/for no key update of a/.test(lire(MIG)), "les passages concurrents sont sérialisés (for no key update sur partenaires_acces)");

// ---- Règle commune : l'écran voit exactement ce que voit la notification -----------------------------------------------------------
let r = await essaie(u.brown, "select id from partenaire_courses() order by id");
const ecran = r.rows.map((x) => x.id);
const de = (await db.query("select id from partenaire_courses_de($1) order by id", [u.brown])).rows.map((x) => x.id);
ok(r.ok && ecran.length === 3 && JSON.stringify(ecran) === JSON.stringify(de), "partenaire_courses() = partenaire_courses_de(compte) (sa fiche, sans partenaire, la passée à payer)");
ok(!(await essaie(u.brown, "select * from partenaire_courses_de($1)", [u.nani])).ok, "Mr. Brown n'appelle pas la règle pour un autre compte");
ok(!(await essaie(u.brown, "select * from partenaire_notif_courses($1)", [u.brown])).ok, "ni la liste des notifications");
const colonnes = (await db.query("select * from partenaire_notif_courses($1)", [u.brown])).fields.map((f) => f.name).sort();
ok(JSON.stringify(colonnes) === JSON.stringify(["adultes", "bebes", "client", "date_service", "dropoff", "enfants", "entite_id", "heure", "id", "jour", "libelle", "pickup", "programme", "retour"]), "liste blanche : ni prix, ni commission, ni référence, ni téléphone, ni note");
const liste = (await db.query("select id from partenaire_notif_courses($1)", [u.brown])).rows.map((x) => x.id);
ok(liste.length === 2 && !liste.includes(R.passee), "la notification ne regarde que les courses d'aujourd'hui et des jours suivants");

// ---- Sans téléphone abonné : rien n'est suivi -----------------------------------------------------------------------------------------
ok((await passage()).length === 0 && (await suivies()).length === 0 && !(await un("select 1 x from partenaires_notifs_etat")), "aucun abonnement : rien suivi, rien envoyé");

// ---- Premier passage : ses courses sont prises sans rien envoyer -------------------------------------------------------------------
await abonner();
ok((await passage()).length === 0 && (await suivies()).length === 2, "premier passage : deux courses suivies, aucune notification");
await vieillir();
ok((await passage()).length === 0, "rien n'a changé : rien ne part");

// ---- Nouvelle course ---------------------------------------------------------------------------------------------------------------
R.nouvelle = await course(ent.taxi, P.vip, 3, { heure: "08:30", lieu: "Hotel Test B", details: { drop_off: "Pier Test" } });
ok((await passage()).length === 0, "nouvelle course : attend que la saisie soit finie (délai de regroupement)");
await vieillir();
let n = await passage();
ok(n.length === 1 && n[0].genre === "nouvelle" && n[0].reservation_id === R.nouvelle && n[0].apercu.heure === "08:30" && n[0].apercu.pickup === "Hotel Test B" && n[0].apercu.dropoff === "Pier Test" && n[0].apercu.adultes === 2, "nouvelle course : une notification avec heure, trajet, personnes");
ok(!("prix" in n[0].apercu) && !("ref" in n[0].apercu) && !("telephone" in n[0].apercu) && !JSON.stringify(n[0]).includes("note interne"), "rien d'interne dans la notification");
await vieillir();
ok((await passage()).length === 0, "pas de doublon au passage suivant");

// ---- Rafale de modifications : une seule notification ------------------------------------------------------------------------------
await db.query("update reservations set heure_pickup = '09:00' where id = $1", [R.nouvelle]);
await passage();
await db.query("update reservations set lieu_pickup = 'Hotel Test C' where id = $1", [R.nouvelle]);
await passage();
await db.query("update reservations set personnes = '{\"adultes\": 3}'::jsonb where id = $1", [R.nouvelle]);
ok((await passage()).length === 0, "rafale en cours : rien ne part");
await vieillir();
n = await passage();
ok(n.length === 1 && n[0].genre === "modifiee" && n[0].apercu.heure === "09:00" && n[0].apercu.pickup === "Hotel Test C" && n[0].apercu.adultes === 3 && n[0].apercu_avant.heure === "08:30", "trois changements, une seule notification « modifiée », avec l'état d'avant");
await vieillir();
ok((await passage()).length === 0, "et pas de doublon");
// Un retour à l'état déjà notifié pendant la rafale : rien à dire.
await db.query("update reservations set heure_pickup = '11:00' where id = $1", [R.nouvelle]);
await passage();
await db.query("update reservations set heure_pickup = '09:00' where id = $1", [R.nouvelle]);
await passage();
await vieillir();
ok((await passage()).length === 0, "changé puis remis comme avant : aucune notification");
// Un changement qui ne compte pas (vol, note interne) ne notifie pas.
await db.query("update reservations set notes = 'autre note', details = details || '{\"vol\": \"TG 000\"}'::jsonb where id = $1", [R.nouvelle]);
await passage();
await vieillir();
ok((await passage()).length === 0, "vol ou note interne changés : pas de notification");
// Destination et date comptent.
await db.query("update reservations set details = details || '{\"drop_off\": \"Airport Test 2\"}'::jsonb, date_service = $2 where id = $1", [R.nouvelle, await jour(4)]);
await passage();
await vieillir();
n = await passage();
ok(n.length === 1 && n[0].genre === "modifiee" && n[0].apercu.dropoff === "Airport Test 2" && n[0].apercu.date_service === (await jour(4)), "destination et date changées : notifiées");

// ---- Annulation ---------------------------------------------------------------------------------------------------------------------
await db.query("update reservations set statut = 'annule' where id = $1", [R.nouvelle]);
await passage();
await vieillir();
n = await passage();
ok(n.length === 1 && n[0].genre === "annulee" && n[0].apercu.pickup === "Hotel Test C" && !("client" in n[0]) , "course annulée : une notification « annulée » avec ce qu'il avait vu");
await vieillir();
ok((await passage()).length === 0, "annulée : pas de doublon");
await db.query("update reservations set statut = 'confirme' where id = $1", [R.nouvelle]);
await passage();
await vieillir();
n = await passage();
ok(n.length === 1 && n[0].genre === "nouvelle", "rétablie : de nouveau une course (« nouvelle »)");
await db.query("update dossiers set annule = true where id = (select dossier_id from reservations where id = $1)", [R.nouvelle]);
await passage();
await vieillir();
n = await passage();
ok(n.length === 1 && n[0].genre === "annulee", "dossier annulé : la course est annulée pour lui");
// Créée puis annulée avant la fin du délai : rien.
R.eclair = await course(ent.taxi, P.vip, 5);
await passage();
await db.query("update reservations set statut = 'annule' where id = $1", [R.eclair]);
await passage();
await vieillir();
ok((await passage()).length === 0, "créée puis annulée dans le délai : aucune notification");

// ---- Périmètre : autre fiche, Secret ------------------------------------------------------------------------------------------------
R.autreFiche = await course(ent.taxi, P.autreTaxi, 2);
R.secret = await course(ent.secret, P.secret, 2);
R.secretVip = await course(ent.secret, P.vip, 2); // une course de Secret posée par erreur sur sa fiche
await passage();
await vieillir();
n = await passage();
ok(n.length === 0 && !(await suivies()).some((id) => [R.autreFiche, R.secret, R.secretVip].includes(id)), "course d'une autre fiche, de Secret, ou de Secret sur sa fiche : jamais notifiée");
await db.query("update reservations set statut = 'annule' where id = $1", [R.autreFiche]);
await passage();
await vieillir();
ok((await passage()).length === 0, "l'annulation d'une course d'une autre fiche ne lui parvient pas");

// ---- Sortie de sa liste sans annulation (relecture du 24.11.2026, point B1) -------------------------------------------------------
// Une course déjà notifiée qui ne lui est plus confiée : « retiree », avec ce qu'il avait vu. Seule la date (passée, au-delà de 60 jours) se tait.
const sortie = async (id, quoi) => {
  await passage();
  await vieillir();
  const x = await passage();
  return x.length === 1 && x[0].genre === "retiree" && x[0].reservation_id === id && x[0].apercu.pickup === "Hotel Test A" && x[0].apercu.date_service === (quoi.date || x[0].apercu.date_service);
};
const notifiee = async () => {
  const id = await course(ent.taxi, P.vip, 6);
  await passage();
  await vieillir();
  const x = await passage();
  if (!(x.length === 1 && x[0].genre === "nouvelle" && x[0].reservation_id === id)) throw new Error("course de départ non notifiée");
  return id;
};
await db.query("update reservations set partenaire_id = $2 where id = $1", [R.sansPartenaire, P.autreTaxi]);
ok(await sortie(R.sansPartenaire, { date: await jour(2) }), "course sans partenaire confiée à une autre fiche : « ne vous est plus confiée »");
await vieillir();
ok((await passage()).length === 0, "pas de doublon");
await db.query("update reservations set partenaire_id = null where id = $1", [R.sansPartenaire]);
await passage();
await vieillir();
n = await passage();
ok(n.length === 1 && n[0].genre === "nouvelle", "revenue dans sa liste : de nouveau une course");
R.fiche = await notifiee();
await db.query("update reservations set partenaire_id = $2 where id = $1", [R.fiche, P.autreTaxi]);
ok(await sortie(R.fiche, {}), "course de sa fiche confiée à une autre fiche : notifiée");
R.secretPassee = await notifiee();
{
  // Déplacée dans un dossier de Secret (la course et son dossier changent d'entreprise ensemble).
  const c = (await un("insert into clients (entite_id, prenom, nom) values ($1, 'Test', 'Secret') returning id", [ent.secret])).id;
  const d = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, 'S-TEST', $2) returning id", [ent.secret, c])).id;
  await db.query("update reservations set entite_id = $2, dossier_id = $3, partenaire_id = $4 where id = $1", [R.secretPassee, ent.secret, d, P.secret]);
}
ok(await sortie(R.secretPassee, {}), "course passée chez Secret : notifiée, sans rien dire de Secret");
R.supprimee = await notifiee();
await db.query("delete from reservations where id = $1", [R.supprimee]);
ok(await sortie(R.supprimee, {}), "course supprimée (fiche retirée) : notifiée avec ce qu'il avait vu");
await vieillir();
ok((await passage()).length === 0, "et une seule fois");
// Sorties par la date : silencieuses.
R.loin = await notifiee();
await db.query("update reservations set date_service = $2 where id = $1", [R.loin, await jour(70)]);
await passage();
await vieillir();
ok((await passage()).length === 0 && !(await suivies()).includes(R.loin), "repoussée au-delà de 60 jours : oubliée, rien envoyé");
R.hier = await notifiee();
await db.query("update reservations set date_service = $2 where id = $1", [R.hier, await jour(-1)]);
await passage();
await vieillir();
ok((await passage()).length === 0 && !(await suivies()).includes(R.hier), "passée : oubliée, rien envoyé");
// Créée puis confiée à une autre fiche dans le délai : rien.
R.vite = await course(ent.taxi, P.vip, 7);
await passage();
await db.query("update reservations set partenaire_id = $2 where id = $1", [R.vite, P.autreTaxi]);
await passage();
await vieillir();
ok((await passage()).length === 0, "créée puis confiée à une autre fiche dans le délai : aucune notification");
// Frais de parc : jamais dans ses notifications (même filtre que les rappels des membres).
R.parc = await (async () => {
  const id = await course(ent.taxi, null, 3);
  await db.query("update reservations set libelle = 'Frais de parc test' where id = $1", [id]);
  return id;
})();
await passage();
await vieillir();
ok((await passage()).length === 0 && !(await suivies()).includes(R.parc) && !(await db.query("select id from partenaire_notif_courses($1)", [u.brown])).rows.some((x) => x.id === R.parc), "frais de parc : ni suivis ni notifiés");
r = await essaie(u.brown, "select id from partenaire_courses() where id = $1", [R.parc]);
ok(r.ok && r.rows.length === 1, "… alors qu'ils restent sur son écran (rien ne change pour l'écran)");

// ---- Relecture de code du 24.11.2026 : filtre des frais de parc resserré, date effacée ---------------------------------------------
// Une vraie course vers un parc, sans partenaire comme la plupart des courses de Taxi : notifiée.
R.versParc = await course(ent.taxi, null, 3);
await db.query("update reservations set libelle = 'Private taxi: Hotel Test → Mu Ko Lanta National Park' where id = $1", [R.versParc]);
await passage();
await vieillir();
n = await passage();
ok(n.length === 1 && n[0].genre === "nouvelle" && n[0].reservation_id === R.versParc, "course vers un parc national (libellé qui le nomme) : notifiée");
// Des frais rangés dans une prestation de la famille « frais » : écartés, quel que soit leur libellé.
const frais = (await un("insert into prestations (entite_id, famille, groupe, libelle) values ($1, 'frais', 'Test', 'Droits test') returning id", [ent.taxi])).id;
R.droits = await course(ent.taxi, null, 3);
await db.query("update reservations set prestation_id = $2, libelle = 'Droits test' where id = $1", [R.droits, frais]);
await db.query("update reservations set libelle = 'Park fees Koh Test' where id = $1", [R.parc]);
await passage();
await vieillir();
ok((await passage()).length === 0 && !(await suivies()).includes(R.droits), "prestation « frais » ou libellé « Park fees… » : jamais notifiés");
// Une course notifiée qui devient des frais de parc reste sur son écran : oubliée sans « ne vous est plus confiée ».
await db.query("update reservations set prestation_id = $2 where id = $1", [R.versParc, frais]);
await passage();
await vieillir();
ok((await passage()).length === 0 && !(await suivies()).includes(R.versParc), "devenue des frais mais encore sur son écran : oubliée, jamais « retirée »");
// Date effacée : la course sort de son écran, il est prévenu une fois ; une nouvelle date la ramène comme nouvelle course.
R.sansDate = await notifiee();
await db.query("update reservations set date_service = null where id = $1", [R.sansDate]);
await passage();
await vieillir();
n = await passage();
ok(n.length === 1 && n[0].genre === "sans_date" && n[0].reservation_id === R.sansDate && n[0].apercu.date_service === (await jour(6)), "date effacée : notifiée avec la date qu'il avait vue");
await vieillir();
ok((await passage()).length === 0 && (await suivies()).includes(R.sansDate), "une seule fois, la course reste suivie");
await db.query("update reservations set date_service = $2 where id = $1", [R.sansDate, await jour(8)]);
await passage();
await vieillir();
n = await passage();
ok(n.length === 1 && n[0].genre === "nouvelle" && n[0].apercu.date_service === (await jour(8)), "nouvelle date : de nouveau une course");

// ---- Compte désactivé, partenaire désactivé, accès retiré -------------------------------------------------------------------------
await db.query("update profils set actif = false where user_id = $1", [u.brown]);
await db.query("update reservations set heure_pickup = '06:00' where id = $1", [R.avant]);
ok((await passage()).length === 0 && (await suivies()).length === 0 && !(await un("select 1 x from partenaires_notifs_etat")), "compte désactivé : empreintes effacées, rien envoyé");
await vieillir();
ok((await passage()).length === 0, "toujours rien");
await db.query("update profils set actif = true where user_id = $1", [u.brown]);
ok((await passage()).length === 0 && (await suivies()).length > 0, "réactivé : courses reprises sans avalanche");
await db.query("update partenaires set actif = false where id = $1", [P.vip]);
ok((await passage()).length === 0 && (await suivies()).length === 0, "partenaire désactivé : rien");
await db.query("update partenaires set actif = true where id = $1", [P.vip]);
await passage();
await db.query("insert into partenaires_notifs_envois (user_id, cle) values ($1, 'veille:2099-01-01')", [u.brown]);
await db.query("delete from partenaires_acces where user_id = $1", [u.brown]);
ok((await un("select count(*)::int n from partenaires_notifs_courses")).n === 0 && (await un("select count(*)::int n from partenaires_notifs_envois")).n === 0, "accès supprimé : tout part avec lui (cascade)");
R.apres = await course(ent.taxi, P.vip, 2);
await vieillir();
ok((await passage()).length === 0 && (await db.query("select * from partenaire_notif_courses($1)", [u.brown])).rows.length === 0, "accès supprimé : plus rien ne part, plus aucune course lue");

// ---- Marquage des résumés et des rappels 1 h avant (clé unique) ----------------------------------------------------------------------
await db.query("insert into partenaires_acces (user_id, partenaire_id) values ($1, $2)", [u.brown, P.vip]);
r = await commeRole("service_role", "insert into partenaires_notifs_envois (user_id, cle) values ($1, 'h1:x:2099-01-01T03:00:00.000Z') on conflict do nothing returning cle", [u.brown]);
const r2 = await commeRole("service_role", "insert into partenaires_notifs_envois (user_id, cle) values ($1, 'h1:x:2099-01-01T03:00:00.000Z') on conflict do nothing returning cle", [u.brown]);
ok(r.ok && r.rows.length === 1 && r2.ok && r2.rows.length === 0, "un rappel 1 h avant ne se marque qu'une fois");

// ---- Rejouée, puis retour en arrière ---------------------------------------------------------------------------------------------------
await abonner();
await passage();
const avant = (await suivies()).length;
await db.exec(lire(MIG));
ok((await suivies()).length === avant && avant > 0, "la migration se rejoue sans rien perdre");
r = await essaie(u.brown, "select id from partenaire_courses()");
ok(r.ok && r.rows.length > 0, "l'écran lit toujours ses courses après la migration rejouée");
await db.exec(lire("retour-123-notifications-partenaire.sql"));
ok(!(await un("select 1 x from pg_class where relname = 'partenaires_notifs_courses'")) && !(await un("select 1 x from pg_proc where proname in ('partenaire_courses_de', 'partenaire_acces_de', 'partenaire_notifs_changements')")), "retour : tables et fonctions parties");
const r3 = await essaie(u.brown, "select id from partenaire_courses() order by id");
ok(r3.ok && JSON.stringify(r3.rows) === JSON.stringify(r.rows.sort((a, b) => a.id.localeCompare(b.id))), "retour : l'écran voit les mêmes courses");
await db.exec(lire(MIG));
ok(!!(await un("select 1 x from pg_proc where proname = 'partenaire_notifs_changements'")), "et la migration se rejoue après le retour");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
