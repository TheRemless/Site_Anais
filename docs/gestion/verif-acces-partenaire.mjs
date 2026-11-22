// Vérifie la migration 115 (accès d'un partenaire chauffeur à ses courses, Mr. Brown de VIP Taxi Lanta) sur un Postgres en mémoire :
// schema.sql puis toutes les migrations. Le compte partenaire ne lit aucune table ; par les fonctions, il ne voit que ses courses de Taxi
// (à venir, et passées dont la commission reste à payer), sans net ; il ne saisit que la commission d'une de ses courses non payée ;
// un autre compte n'obtient rien ; les garde-fous de pose de l'accès tiennent ; la migration se rejoue ; retour en arrière.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-acces-partenaire.mjs
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
const MIG = "migration-115-acces-partenaire.sql";
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d|1\d\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
ok(migrations.includes(MIG) && migrations.indexOf(MIG) > migrations.indexOf("migration-110-whatsapp-type-contact.sql"), "la migration 115 passe après la 110, sur une base vide");
for (const f of migrations) await db.exec(lire(f));

async function essaie(userId, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
async function anonyme(sql) {
  await db.exec("set role anon; select set_config('request.jwt.claim.sub', '', false);");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; } catch (e) { return { ok: false, err: e.message }; } finally { await db.exec("reset role;"); }
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
for (const k of ["nani", "mook", "brown", "autre"]) u[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.taxi}', 'Vouchers test', 'toute', array['clients.lire', 'clients.ecrire', 'dossiers.lire', 'dossiers.ecrire', 'documents.ecrire', 'finances.voir', 'partenaires.lire', 'vouchers.seul'])`);
const membre = (user, entite, role) => db.exec(`insert into membres values ('${u[user]}', '${entite}', (select id from roles where entite_id = '${entite}' and nom = '${role}')) on conflict do nothing`);
await membre("nani", ent.taxi, "Administrateur");
await membre("nani", ent.secret, "Administrateur");
await membre("mook", ent.taxi, "Vouchers test");

const partenaire = async (entite, nom) => (await un("insert into partenaires (entite_id, nom, contact) values ($1, $2, $3::jsonb) returning id", [entite, nom, JSON.stringify({ personne: "Mr. Test" })])).id;
const P = { vip: await partenaire(ent.taxi, "VIP Taxi test"), autreTaxi: await partenaire(ent.taxi, "Autre chauffeur test"), secret: await partenaire(ent.secret, "Bateau test") };
const jour = async (n) => (await un(`select ((now() at time zone 'Asia/Bangkok')::date + ${n})::text d`)).d;
let nref = 0;
async function course(entite, partenaireId, n, { heure = "10:00", prix = 1800, details = {}, statut = "confirme", dossierAnnule = false, nets = null, client = ["Test", "Client" + nref], clientDe = entite } = {}) {
  const c = (await un("insert into clients (entite_id, prenom, nom, telephone) values ($1, $2, $3, $4) returning id", [clientDe, client[0], client[1], "+44 7700 900" + String(100 + nref)])).id;
  const d = (await un("insert into dossiers (entite_id, ref, client_id, annule) values ($1, $2, $3, $4) returning id", [entite, "T-" + ++nref, c, dossierAnnule])).id;
  const r = (await un("insert into reservations (entite_id, dossier_id, partenaire_id, libelle, date_service, heure_pickup, lieu_pickup, personnes, statut, montant_vente, paye_sur_place, details, notes) values ($1, $2, $3, 'Private Taxi test', $4, $5, 'Hotel Test, Long Beach', $6::jsonb, $7, $8, true, $9::jsonb, 'note interne test') returning id",
    [entite, d, partenaireId, await jour(n), heure, JSON.stringify({ adultes: 2, enfants: 1, bebes: 0 }), statut, prix, JSON.stringify(details)])).id;
  if (nets) await db.query("insert into reservations_nets (entite_id, reservation_id, net_prevu, commission_prevue, commission_recue, commission_recue_le) values ($1, $2, $3, $4, $5, $6)", [entite, r, nets.net ?? null, nets.prevue ?? null, nets.recue ?? null, nets.recue_le ?? null]);
  return r;
}
const R = {
  aujourdhui: await course(ent.taxi, P.vip, 0, { heure: "14:30", details: { drop_off: "Krabi Airport", vol: "FD0000" }, nets: { net: 1234 } }),
  demain: await course(ent.taxi, P.vip, 1, { heure: "06:30", clientDe: ent.ztp, client: ["Partage", "Ztp"] }),
  plusTard: await course(ent.taxi, P.vip, 5, { details: { type_trajet: "retour_depart", programme_trajet: "Old Town tour" } }),
  passeeSansCom: await course(ent.taxi, P.vip, -3),
  passeeDue: await course(ent.taxi, P.vip, -4, { nets: { prevue: 300 } }),
  passeePartielle: await course(ent.taxi, P.vip, -2, { nets: { prevue: 400, recue: 100 } }),
  passeePayee: await course(ent.taxi, P.vip, -5, { nets: { prevue: 300, recue: 300, recue_le: await jour(-1) } }),
  futurePayee: await course(ent.taxi, P.vip, 2, { nets: { prevue: 200, recue: 200, recue_le: await jour(0) } }),
  vieille: await course(ent.taxi, P.vip, -70),
  annulee: await course(ent.taxi, P.vip, 1, { statut: "annule" }),
  dossierAnnule: await course(ent.taxi, P.vip, 1, { dossierAnnule: true }),
  autreChauffeur: await course(ent.taxi, P.autreTaxi, 1),
  secretAvecVip: await course(ent.secret, P.vip, 1),
  secret: await course(ent.secret, P.secret, 1),
};

// ---- Structure -----------------------------------------------------------------------------------------------------------------------
ok(!!(await un("select 1 x from pg_class where relname = 'partenaires_acces' and relrowsecurity")), "la table partenaires_acces existe, RLS active");
const exec = async (role, f) => (await un(`select has_function_privilege('${role}', '${f}', 'execute') a`)).a;
for (const f of ["partenaire_mon_acces()", "partenaire_courses()", "partenaire_saisir_commission(uuid, numeric)"]) {
  ok((await exec("authenticated", f)) && !(await exec("anon", f)), `${f} : authenticated seulement, jamais anon`);
}
ok(!(await exec("authenticated", "partenaire_acces_actuel()")) && !(await exec("anon", "partenaire_acces_actuel()")), "partenaire_acces_actuel() reste interne");
const priv = async (p) => (await un(`select has_table_privilege('authenticated', 'partenaires_acces', '${p}') a`)).a;
ok((await priv("SELECT")) && !(await priv("INSERT")) && !(await priv("UPDATE")) && !(await priv("DELETE")), "partenaires_acces : lecture seule depuis l'API");
ok(!(await anonyme("select * from partenaires_acces")).ok, "anon ne lit pas partenaires_acces");

// ---- Garde-fous de pose de l'accès -----------------------------------------------------------------------------------------------------
const poser = async (user, p) => { try { await db.query("insert into partenaires_acces (user_id, partenaire_id) values ($1, $2)", [u[user], p]); return null; } catch (e) { return e.message; } };
ok(/mode taxi/.test(await poser("brown", P.secret) || ""), "refusé pour un partenaire de Secret (pas en mode taxi)");
ok(/déjà accès/.test(await poser("nani", P.vip) || ""), "refusé pour un compte déjà membre d'une entreprise");
ok((await poser("brown", P.vip)) === null, "posé pour Mr. Brown sur VIP Taxi (compte sans aucun accès)");
let err = null;
try { await membre("brown", ent.taxi, "Vouchers test"); } catch (e) { err = e.message; }
ok(/compte partenaire/.test(err || ""), "un compte partenaire ne devient pas membre d'une entreprise");
ok((await essaie(u.brown, "insert into partenaires_acces (user_id, partenaire_id) values ($1, $2)", [u.autre, P.vip])).ok === false, "Mr. Brown ne donne pas d'accès à un autre compte");
ok((await essaie(u.nani, "insert into partenaires_acces (user_id, partenaire_id) values ($1, $2)", [u.autre, P.vip])).ok === false, "même l'administratrice ne pose pas l'accès par l'API (éditeur SQL seulement)");
let r = await essaie(u.brown, "select * from partenaires_acces");
ok(r.ok && r.rows.length === 1 && r.rows[0].user_id === u.brown, "Mr. Brown lit sa seule ligne d'accès");
r = await essaie(u.mook, "select * from partenaires_acces");
ok(r.ok && r.rows.length === 0, "Mook ne voit pas les accès partenaires");

// ---- Mr. Brown ne lit aucune table ------------------------------------------------------------------------------------------------------
for (const t of ["clients", "dossiers", "reservations", "reservations_nets", "partenaires", "partenaires_prives", "prestations", "reglages", "journal", "documents", "paiements", "membres", "roles", "taches", "fiduciaire_factures"]) {
  r = await essaie(u.brown, `select * from ${t}`);
  ok(!r.ok || r.rows.length === 0, `Mr. Brown ne lit rien dans ${t}`);
}
r = await essaie(u.brown, "select * from profils");
ok(r.ok && r.rows.every((p) => p.user_id === u.brown), "Mr. Brown ne voit que son propre profil");
r = await essaie(u.brown, "select * from equipe_de($1)", [ent.taxi]);
ok(!r.ok || r.rows.length === 0, "Mr. Brown ne voit pas l'équipe de Taxi");
r = await essaie(u.brown, "update reservations set montant_vente = 1 where id = $1", [R.aujourdhui]);
ok(r.ok ? r.n === 0 : true, "Mr. Brown ne modifie pas une réservation");
r = await essaie(u.brown, "update reservations_nets set commission_prevue = 1");
ok(r.ok ? r.n === 0 : true, "Mr. Brown n'écrit pas directement dans reservations_nets");

// ---- Ses courses -------------------------------------------------------------------------------------------------------------------------
r = await essaie(u.brown, "select * from partenaire_mon_acces()");
ok(r.ok && r.rows.length === 1 && r.rows[0].partenaire === "VIP Taxi test" && r.rows[0].contact === "Mr. Test" && r.rows[0].devise === "THB", "partenaire_mon_acces : son partenaire, son contact, la devise");
r = await essaie(u.brown, "select * from partenaire_courses()");
ok(r.ok, "partenaire_courses répond pour Mr. Brown " + (r.err || ""));
const ids = (r.rows || []).map((x) => x.id);
const attendues = ["passeeDue", "passeeSansCom", "passeePartielle", "aujourdhui", "demain", "futurePayee", "plusTard"];
ok(attendues.every((k) => ids.includes(R[k])) && ids.length === attendues.length, `ses ${attendues.length} courses : à venir (même payée) et passées à payer`);
for (const k of ["passeePayee", "vieille", "annulee", "dossierAnnule", "autreChauffeur", "secretAvecVip", "secret"]) ok(!ids.includes(R[k]), `pas la course « ${k} »`);
ok(r.rows.find((x) => x.id === R.demain)?.client === "Partage Ztp", "un client partagé de ZTP (migration 46) garde son nom sur la course de Taxi");
ok(ids[0] === R.passeeDue && ids[ids.length - 1] === R.plusTard, "triées par date");
const auj = r.rows.find((x) => x.id === R.aujourdhui);
ok(auj && auj.heure === "14:30" && auj.pickup === "Hotel Test, Long Beach" && auj.dropoff === "Krabi Airport" && auj.vol === "FD0000" && auj.adultes === 2 && auj.enfants === 1 && Number(auj.prix) === 1800 && /^Test Client/.test(auj.client) && auj.telephone.startsWith("+44"), "chaque course : heure, lieux, vol, personnes, client, téléphone, prix");
ok(r.rows.find((x) => x.id === R.plusTard).retour === true && r.rows.find((x) => x.id === R.plusTard).programme === "Old Town tour", "un retour au point de départ est signalé avec son programme");
const colonnes = Object.keys(auj || {});
ok(!colonnes.some((c) => /net|note|ref|partenaire/.test(c)) && !JSON.stringify(r.rows).includes("1234") && !JSON.stringify(r.rows).includes("note interne"), "aucun net, aucune note interne, aucune référence de dossier");
for (const k of ["nani", "mook", "autre"]) {
  const x = await essaie(u[k], "select * from partenaire_courses()");
  const y = await essaie(u[k], "select * from partenaire_mon_acces()");
  ok(x.ok && x.rows.length === 0 && y.ok && y.rows.length === 0, `${k} n'obtient rien des fonctions partenaire`);
}
ok(!(await anonyme("select * from partenaire_courses()")).ok, "anon n'appelle pas partenaire_courses");

// ---- Saisir sa commission -------------------------------------------------------------------------------------------------------------------
const com = async (id) => un("select commission_prevue, net_prevu from reservations_nets where reservation_id = $1", [id]);
r = await essaie(u.brown, "select partenaire_saisir_commission($1, 350) v", [R.aujourdhui]);
ok(r.ok && Number(r.rows[0].v) === 350, "Mr. Brown saisit 350 sur la course d'aujourd'hui " + (r.err || ""));
let n = await com(R.aujourdhui);
ok(Number(n.commission_prevue) === 350 && Number(n.net_prevu) === 1234, "la commission prévue est posée, le net reste tel quel");
r = await essaie(u.nani, "select commission_prevue from reservations_nets where reservation_id = $1", [R.aujourdhui]);
ok(r.ok && Number(r.rows[0].commission_prevue) === 350, "Nani voit la commission annoncée par Mr. Brown");
const j = await un("select user_id, details from journal where table_name = 'reservations_nets' and cible = $1 order by id desc limit 1", [R.aujourdhui]);
ok(j && j.user_id === u.brown && j.details.commission_prevue, "le journal des nets note la saisie et le compte de Mr. Brown");
r = await essaie(u.brown, "select partenaire_saisir_commission($1, 250) v", [R.passeeSansCom]);
ok(r.ok && Number((await com(R.passeeSansCom)).commission_prevue) === 250, "une course passée sans commission reçoit sa première ligne de nets");
r = await essaie(u.brown, "select partenaire_saisir_commission($1, 320) v", [R.aujourdhui]);
ok(r.ok && Number((await com(R.aujourdhui)).commission_prevue) === 320, "il corrige sa saisie tant que rien n'est payé");
r = await essaie(u.brown, "select partenaire_saisir_commission($1, null) v", [R.demain]);
ok(r.ok && !(await com(R.demain)), "effacer une commission jamais saisie ne crée rien");
for (const [m, quoi] of [[-1, "négatif"], [10.555, "trois décimales"], [1801, "plus que le prix"]]) {
  r = await essaie(u.brown, `select partenaire_saisir_commission($1, ${m}) v`, [R.demain]);
  ok(!r.ok, `refusé : montant ${quoi}`);
}
r = await essaie(u.brown, "select partenaire_saisir_commission($1, 100) v", [R.passeePartielle]);
ok(!r.ok && /payée/.test(r.err) && Number((await com(R.passeePartielle)).commission_prevue) === 400, "refusé : commission déjà payée en partie");
r = await essaie(u.brown, "select partenaire_saisir_commission($1, 100) v", [R.futurePayee]);
ok(!r.ok && /payée/.test(r.err), "refusé : commission déjà payée");
for (const k of ["passeePayee", "vieille", "annulee", "autreChauffeur", "secretAvecVip", "secret"]) {
  r = await essaie(u.brown, "select partenaire_saisir_commission($1, 10) v", [R[k]]);
  ok(!r.ok, `refusé sur la course « ${k} »`);
}
r = await essaie(u.mook, "select partenaire_saisir_commission($1, 10) v", [R.demain]);
ok(!r.ok && /refusé/i.test(r.err), "Mook ne passe pas par la saisie partenaire");
r = await essaie(u.brown, "select * from partenaire_courses()");
ok(r.ok && r.rows.some((x) => x.id === R.passeeSansCom), "la course passée saisie reste dans sa liste (commission à payer)");
await db.query("update reservations_nets set commission_recue = 250, commission_recue_le = $2 where reservation_id = $1", [R.passeeSansCom, await jour(0)]);
r = await essaie(u.brown, "select * from partenaire_courses()");
ok(r.ok && !r.rows.some((x) => x.id === R.passeeSansCom), "une fois payée par Nani, la course passée quitte sa liste");

// ---- Coupures --------------------------------------------------------------------------------------------------------------------------
await db.query("update profils set actif = false where user_id = $1", [u.brown]);
r = await essaie(u.brown, "select * from partenaire_courses()");
ok(r.ok && r.rows.length === 0, "compte désactivé : plus aucune course");
await db.query("update profils set actif = true where user_id = $1", [u.brown]);
await db.query("update partenaires set actif = false where id = $1", [P.vip]);
r = await essaie(u.brown, "select * from partenaire_courses()");
ok(r.ok && r.rows.length === 0, "partenaire désactivé : plus aucune course");
await db.query("update partenaires set actif = true where id = $1", [P.vip]);
await db.query("update reglages set valeur = valeur || '{\"fonctionnement\": \"excursions\"}'::jsonb where entite_id = $1", [ent.taxi]);
r = await essaie(u.brown, "select partenaire_saisir_commission($1, 10) v", [R.demain]);
ok(!r.ok, "entreprise sortie du mode taxi : plus de saisie");
await db.query("update reglages set valeur = valeur || '{\"fonctionnement\": \"taxi\"}'::jsonb where entite_id = $1", [ent.taxi]);

// ---- Se rejoue, retour en arrière ------------------------------------------------------------------------------------------------------
const photo = async () => JSON.stringify((await db.query("select * from partenaires_acces order by user_id")).rows) + JSON.stringify((await db.query("select reservation_id, commission_prevue from reservations_nets order by reservation_id")).rows);
const p1 = await photo();
await db.exec(lire(MIG));
ok((await photo()) === p1, "la migration 115 se rejoue sans effet");
r = await essaie(u.brown, "select * from partenaire_courses()");
ok(r.ok && r.rows.length > 0, "… et l'accès marche toujours");
await db.exec(lire("retour-115-acces-partenaire.sql"));
ok(!(await un("select 1 x from pg_class where relname = 'partenaires_acces'")) && !(await un("select 1 x from pg_proc where proname like 'partenaire_%'")), "retour : table et fonctions parties");
ok(Number((await com(R.aujourdhui)).commission_prevue) === 320, "retour : les commissions saisies restent");
await membre("brown", ent.taxi, "Vouchers test");
ok(!!(await un("select 1 x from membres where user_id = $1", [u.brown])), "retour : le compte peut de nouveau recevoir un rôle");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
