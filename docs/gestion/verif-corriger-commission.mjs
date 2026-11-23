// Vérifie la migration 119 (corriger une commission, ou le prix et la commission, depuis À encaisser) sur un Postgres en mémoire :
// schema.sql puis toutes les migrations. La correction de Nani l'emporte sur Mr. Brown, les motifs sont contrôlés, le journal garde l'ancien
// montant, la base ne recalcule plus une commission corrigée quand le prix change, la migration se rejoue et son retour en arrière marche.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-corriger-commission.mjs
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
const MIG = "migration-119-corriger-commission.sql";
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d|1\d\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
ok(migrations.includes(MIG) && migrations.indexOf(MIG) > migrations.indexOf("migration-118-sieges-par-type.sql"), "la migration 119 passe après la 118, sur une base vide");
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
  taxi: await course(ent.taxi, P.vip, -1),
  taxiSien: await course(ent.taxi, P.vip, -2),
  secret: await course(ent.secret, P.secret, -3, { prix: 2000 }),
};
await db.query("insert into partenaires_acces (user_id, partenaire_id) values ($1, $2)", [u.brown, P.vip]);
const com = async (id) => un("select * from reservations_nets where reservation_id = $1", [id]);

// ---- Structure ------------------------------------------------------------------------------------------------------------------------
for (const c of ["commission_avant_correction", "prix_avant_correction", "commission_corrigee_le", "commission_corrigee_motif", "commission_corrigee_note"]) {
  ok(!!(await un("select 1 x from information_schema.columns where table_name = 'reservations_nets' and column_name = $1", [c])), `colonne ${c}`);
}

// ---- Mr. Brown saisit, Nani corrige au même montant : il ne la réécrit plus -------------------------------------------------------------
let r = await essaie(u.brown, "select partenaire_saisir_commission($1, 500) v", [R.taxi]);
ok(r.ok, "Mr. Brown saisit 500 " + (r.err || ""));
const correction = (id, valeurs) => essaie(u.nani, `update reservations_nets set ${Object.keys(valeurs).map((k, i) => `${k} = $${i + 2}`).join(", ")} where reservation_id = $1`, [id, ...Object.values(valeurs)]);
r = await correction(R.taxi, { commission_prevue: 500, commission_prevue_auto: null, commission_avant_correction: 500, commission_corrigee_le: new Date().toISOString(), commission_corrigee_motif: "geste_commercial", commission_corrigee_note: null, commission_partenaire: null, commission_partenaire_le: null });
ok(r.ok && r.n === 1, "Nani corrige (même montant, le prix seul change) " + (r.err || ""));
r = await essaie(u.brown, "select partenaire_saisir_commission($1, 700) v", [R.taxi]);
ok(!r.ok && /corrigée par l'équipe/.test(r.err) && Number((await com(R.taxi)).commission_prevue) === 500, "Mr. Brown n'écrase pas la commission corrigée " + (r.err || ""));
r = await essaie(u.brown, "select par_moi, modifiable from partenaire_courses() where id = $1", [R.taxi]);
ok(r.ok && r.rows[0] && r.rows[0].par_moi === false && r.rows[0].modifiable === false, "son écran la montre verrouillée");
// Garde de la base même si l'écran n'avait pas effacé sa saisie : la date de correction suffit.
await essaie(u.brown, "select partenaire_saisir_commission($1, 300) v", [R.taxiSien]);
await db.query("update reservations_nets set commission_corrigee_le = now(), commission_corrigee_motif = 'erreur_saisie' where reservation_id = $1", [R.taxiSien]);
r = await essaie(u.brown, "select partenaire_saisir_commission($1, 400) v", [R.taxiSien]);
ok(!r.ok && Number((await com(R.taxiSien)).commission_prevue) === 300, "corrigée sans effacer sa saisie : toujours refusée");

// ---- Contraintes ----------------------------------------------------------------------------------------------------------------------
r = await correction(R.taxi, { commission_corrigee_motif: "rabais" });
ok(!r.ok, "motif hors liste refusé");
r = await correction(R.taxi, { commission_corrigee_motif: "autre", commission_corrigee_note: "  " });
ok(!r.ok, "« autre » sans note refusé");
r = await correction(R.taxi, { commission_corrigee_motif: "autre", commission_corrigee_note: "vu avec le chauffeur" });
ok(r.ok, "« autre » avec une note accepté " + (r.err || ""));
r = await correction(R.taxi, { commission_corrigee_note: "x".repeat(201) });
ok(!r.ok, "note de plus de 200 caractères refusée");
r = await essaie(u.mook, "update reservations_nets set commission_prevue = 1 where reservation_id = $1", [R.taxi]);
ok(r.ok ? r.n === 0 : true, "Mook (sans les nets) ne corrige pas");
r = await essaie(u.mook, "select commission_avant_correction from reservations_nets");
ok(!r.ok || r.rows.length === 0, "Mook ne lit pas les corrections");

// ---- Journal : l'ancien montant reste ---------------------------------------------------------------------------------------------------
const j = await un("select details from journal where table_name = 'reservations_nets' and cible = $1 and details ? 'commission_corrigee_le' order by created_at desc limit 1", [R.taxi]);
ok(j && j.details.commission_partenaire && Number(j.details.commission_partenaire.avant) === 500, "le journal des nets garde la saisie effacée et la correction");

// ---- Secret : le prix change, la base ne réécrit pas la commission corrigée (migration 32) ---------------------------------------------
await db.query("update partenaires_prives set commission_regle = $2::jsonb where partenaire_id = $1", [P.secret, JSON.stringify({ type: "pourcent_vente", valeur: 20 })]);
if (!(await un("select 1 x from partenaires_prives where partenaire_id = $1", [P.secret]))) await db.query("insert into partenaires_prives (partenaire_id, entite_id, commission_regle) values ($1, $2, $3::jsonb)", [P.secret, ent.secret, JSON.stringify({ type: "pourcent_vente", valeur: 20 })]);
await db.query("update reservations set montant_vente = 2100 where id = $1", [R.secret]);
let n = await com(R.secret);
ok(n && Number(n.commission_prevue) === 420 && Number(n.commission_prevue_auto) === 420, "avant correction : la base calcule 20 % de 2 100");
r = await correction(R.secret, { commission_prevue: 300, commission_prevue_auto: null, commission_avant_correction: 420, commission_corrigee_le: new Date().toISOString(), commission_corrigee_motif: "remboursement_partiel" });
ok(r.ok, "Nani corrige à 300 " + (r.err || ""));
r = await essaie(u.nani, "update reservations set montant_vente = 1500 where id = $1", [R.secret]);
n = await com(R.secret);
ok(r.ok && Number(n.commission_prevue) === 300, "le prix change ensuite : la commission corrigée reste 300 " + (r.err || ""));
const jr = await un("select details from journal where table_name = 'reservations' and cible = $1 and details ? 'montant_vente' order by created_at desc limit 1", [R.secret]);
ok(jr && Number(jr.details.montant_vente.avant) === 2100, "le journal des réservations garde l'ancien prix");

// ---- Rejouée, puis retour en arrière ---------------------------------------------------------------------------------------------------
await db.exec(lire(MIG));
ok(Number((await com(R.taxi)).commission_prevue) === 500, "la migration se rejoue sans rien changer");
await db.exec(lire("retour-119-corriger-commission.sql"));
ok(!(await un("select 1 x from information_schema.columns where table_name = 'reservations_nets' and column_name = 'commission_corrigee_le'")), "retour : colonnes parties");
ok(!/commission_corrigee/.test((await un("select prosrc from pg_proc where proname = 'partenaire_saisir_commission'")).prosrc), "retour : la fonction de la migration 115 revient");
r = await essaie(u.brown, "select partenaire_saisir_commission($1, 600) v", [R.taxi]);
ok(!r.ok && /équipe/.test(r.err), "retour : sa saisie effacée par l'écran, la commission corrigée reste protégée");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
