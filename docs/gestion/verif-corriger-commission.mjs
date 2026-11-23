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
  partiel: await course(ent.taxi, P.vip, -3, { nets: { prevue: 400, recue: 100 } }),
  zero: await course(ent.taxi, P.vip, -4, { nets: { prevue: 250 } }),
  secret: await course(ent.secret, P.secret, -3, { prix: 2000 }),
};
await db.query("insert into partenaires_acces (user_id, partenaire_id) values ($1, $2)", [u.brown, P.vip]);
await db.query("update reservations_nets set commission_partielle_le = $2 where reservation_id = $1", [R.partiel, await jour(-1)]);
const com = async (id) => un("select * from reservations_nets where reservation_id = $1", [id]);
const resa = async (id) => un("select * from reservations where id = $1", [id]);
const lu = async (id) => {
  const n = (await com(id)) || {};
  const r = await resa(id);
  return JSON.stringify({ commission_prevue: n.commission_prevue ?? null, commission_recue: n.commission_recue ?? null, montant_vente: r.montant_vente ?? null });
};
const corriger = (user, id, { entite, commission, prix = null, motif = "remboursement_partiel", note = null, luJson, documents = [] }) =>
  essaie(u[user], "select corriger_commission($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb) v", [id, entite, commission, prix, motif, note, luJson, JSON.stringify(documents)]);
const code = (r) => ((r.err || "").match(/corriger_commission:(\w+)/) || [])[1] || r.err;

// ---- Structure ------------------------------------------------------------------------------------------------------------------------
for (const c of ["commission_avant_correction", "prix_avant_correction", "commission_apres_correction", "commission_corrigee_le", "commission_corrigee_motif", "commission_corrigee_note", "commission_soldee_par_correction"]) {
  ok(!!(await un("select 1 x from information_schema.columns where table_name = 'reservations_nets' and column_name = $1", [c])), `colonne ${c}`);
}
const exec = async (role, f) => (await un(`select has_function_privilege('${role}', '${f}', 'execute') a`)).a;
const F = "corriger_commission(uuid, uuid, numeric, numeric, text, text, jsonb, jsonb)";
ok((await exec("authenticated", F)) && !(await exec("anon", F)), "corriger_commission : authenticated seulement, jamais anon");

// ---- Mr. Brown saisit, Nani corrige au même montant (le prix seul change) : il ne la réécrit plus ----------------------------------------
let r = await essaie(u.brown, "select partenaire_saisir_commission($1, 500) v", [R.taxi]);
ok(r.ok, "Mr. Brown saisit 500 " + (r.err || ""));
r = await corriger("nani", R.taxi, { entite: ent.taxi, commission: 500, prix: 1600, motif: "geste_commercial", luJson: await lu(R.taxi) });
ok(r.ok && r.rows[0].v.nets.commission_prevue === 500, "Nani corrige (même montant, prix 1 800 → 1 600) " + (r.err || ""));
let n = await com(R.taxi);
ok(n.commission_partenaire === null && Number(n.commission_apres_correction) === 500 && Number(n.prix_avant_correction) === 1800 && Number((await resa(R.taxi)).montant_vente) === 1600, "saisie du partenaire effacée, montant posé et ancien prix gardés");
r = await essaie(u.brown, "select partenaire_saisir_commission($1, 700) v", [R.taxi]);
ok(!r.ok && /corrigée par l'équipe/.test(r.err) && Number((await com(R.taxi)).commission_prevue) === 500, "Mr. Brown n'écrase pas la commission corrigée");
r = await essaie(u.brown, "select par_moi, modifiable from partenaire_courses() where id = $1", [R.taxi]);
ok(r.ok && r.rows[0] && r.rows[0].par_moi === false && r.rows[0].modifiable === false, "partenaire_courses : la course corrigée n'est pas modifiable");
// Garde de la base même si sa saisie n'avait pas été effacée : la date de correction suffit (liste et saisie).
await essaie(u.brown, "select partenaire_saisir_commission($1, 300) v", [R.taxiSien]);
await db.query("update reservations_nets set commission_corrigee_le = now(), commission_corrigee_motif = 'erreur_saisie' where reservation_id = $1", [R.taxiSien]);
r = await essaie(u.brown, "select modifiable from partenaire_courses() where id = $1", [R.taxiSien]);
ok(r.ok && r.rows[0].modifiable === false, "partenaire_courses : corrigée sans effacer sa saisie, toujours verrouillée");
r = await essaie(u.brown, "select partenaire_saisir_commission($1, 400) v", [R.taxiSien]);
ok(!r.ok && Number((await com(R.taxiSien)).commission_prevue) === 300, "partenaire_saisir_commission : toujours refusée");

// ---- Concurrence : un encaissement noté entre l'ouverture et l'enregistrement ----------------------------------------------------------
const luAvant = await lu(R.partiel);
await essaie(u.nani, "update reservations_nets set commission_recue = 250, commission_partielle_le = $2 where reservation_id = $1", [R.partiel, await jour(0)]);
r = await corriger("nani", R.partiel, { entite: ent.taxi, commission: 100, luJson: luAvant });
n = await com(R.partiel);
ok(!r.ok && code(r) === "change" && Number(n.commission_recue) === 250 && Number(n.commission_prevue) === 400 && !n.commission_recue_le, "écriture concurrente refusée : l'encaissement de 250 reste, rien n'est corrigé");
// Sans la lecture de la feuille : nulle, pas un objet, ou sans les trois montants.
for (const [quoi, luJson] of [["nulle", null], ["un tableau", "[]"], ["un nombre", "400"], ["une chaîne", JSON.stringify("x")], ["sans le prix", JSON.stringify({ commission_prevue: 400, commission_recue: 250 })], ["vide", "{}"]]) {
  r = await corriger("nani", R.partiel, { entite: ent.taxi, commission: 300, luJson });
  ok(!r.ok && code(r) === "lecture_manquante" && Number((await com(R.partiel)).commission_prevue) === 400, `lecture ${quoi} : refusée (${code(r)}), rien d'écrit`);
}
r = await corriger("nani", R.partiel, { entite: ent.taxi, commission: 200, luJson: await lu(R.partiel) });
ok(!r.ok && code(r) === "sous_recu", "refusée sous le déjà reçu (contrôle de la base)");
// Solde : la nouvelle commission égale le déjà reçu, commission_recue n'est jamais réécrite.
r = await corriger("nani", R.partiel, { entite: ent.taxi, commission: 250, luJson: await lu(R.partiel) });
n = await com(R.partiel);
ok(r.ok && Number(n.commission_recue) === 250 && (await un("select commission_recue_le::text d from reservations_nets where reservation_id = $1", [R.partiel])).d === (await jour(0)) && n.commission_soldee_par_correction === true, "soldée au déjà reçu : reçu intact, date du dernier versement " + (r.err || ""));
r = await corriger("nani", R.partiel, { entite: ent.taxi, commission: 300, luJson: await lu(R.partiel) });
ok(!r.ok && code(r) === "reglee", "une commission soldée ne se corrige plus");
r = await corriger("nani", R.zero, { entite: ent.taxi, commission: 0, luJson: await lu(R.zero) });
n = await com(R.zero);
ok(r.ok && n.commission_recue === null && !!n.commission_recue_le && n.commission_soldee_par_correction === true, "corrigée à 0 sans rien de reçu : soldée par correction, aucun montant reçu inventé");

// ---- Droits et entreprise -----------------------------------------------------------------------------------------------------------
r = await corriger("mook", R.taxiSien, { entite: ent.taxi, commission: 100, luJson: await lu(R.taxiSien) });
ok(!r.ok && ["droits", "introuvable"].includes(code(r)), "Mook (sans les nets) : refusée " + code(r));
r = await corriger("brown", R.taxiSien, { entite: ent.taxi, commission: 100, luJson: await lu(R.taxiSien) });
ok(!r.ok, "le compte partenaire : refusée");
r = await corriger("nani", R.taxiSien, { entite: ent.secret, commission: 100, luJson: await lu(R.taxiSien) });
ok(!r.ok && code(r) === "entite", "autre entreprise que celle de la course : refusée");
r = await corriger("autre", R.taxiSien, { entite: ent.taxi, commission: 100, luJson: await lu(R.taxiSien) });
ok(!r.ok, "un compte sans accès à Taxi : refusée");
ok(!(await anonyme(`select corriger_commission('${R.taxiSien}', '${ent.taxi}', 1, null, 'autre', 'x', '{}'::jsonb, '[]'::jsonb)`)).ok, "anon : refusée");
for (const [quoi, args, attendu] of [
  ["motif hors liste", { motif: "rabais" }, "motif"],
  ["« autre » sans note", { motif: "autre", note: "  " }, "note"],
  ["note de plus de 200 caractères", { note: "x".repeat(201) }, "note"],
  ["trois décimales", { commission: 10.555 }, "commission"],
  ["au-dessus du prix", { commission: 5000 }, "au_dessus_prix"],
  ["rien ne change", { commission: 300 }, "inchange"],
]) {
  r = await corriger("nani", R.taxiSien, { entite: ent.taxi, commission: 100, ...args, luJson: await lu(R.taxiSien) });
  ok(!r.ok && code(r) === attendu, `refusée : ${quoi} (${code(r)})`);
}

// ---- Secret : prix, commission et facture dans une seule transaction ; la migration 32 ne recalcule pas entre les deux ------------------
await db.query("update partenaires_prives set commission_regle = $2::jsonb where partenaire_id = $1", [P.secret, JSON.stringify({ type: "pourcent_vente", valeur: 20 })]);
if (!(await un("select 1 x from partenaires_prives where partenaire_id = $1", [P.secret]))) await db.query("insert into partenaires_prives (partenaire_id, entite_id, commission_regle) values ($1, $2, $3::jsonb)", [P.secret, ent.secret, JSON.stringify({ type: "pourcent_vente", valeur: 20 })]);
await db.query("update reservations set montant_vente = 2100 where id = $1", [R.secret]);
n = await com(R.secret);
ok(n && Number(n.commission_prevue) === 420 && Number(n.commission_prevue_auto) === 420, "avant correction : la base calcule 20 % de 2 100");
const dossierSecret = (await resa(R.secret)).dossier_id;
const facture = await un("insert into documents (entite_id, dossier_id, type, contenu, date_emission) values ($1, $2, 'facture', $3::jsonb, current_date) returning id, updated_at", [ent.secret, dossierSecret, JSON.stringify({ lignes: [{ id: "l1", unite: 2100, qte: 1 }] })]);
const autreDossier = await un("insert into dossiers (entite_id, ref, client_id) select entite_id, 'S-autre', client_id from dossiers where id = $1 returning id", [dossierSecret]);
const etrangere = await un("insert into documents (entite_id, dossier_id, type, contenu, date_emission) values ($1, $2, 'facture', '{}'::jsonb, current_date) returning id, updated_at", [ent.secret, autreDossier.id]);
const contenuNeuf = { lignes: [{ id: "l1", unite: 1800, qte: 1 }] };
// Tout ou rien : une facture d'un autre dossier dans la liste fait tout échouer, rien n'est écrit.
r = await corriger("nani", R.secret, { entite: ent.secret, commission: 300, prix: 1800, luJson: await lu(R.secret), documents: [{ id: facture.id, updated_at: facture.updated_at, contenu: contenuNeuf }, { id: etrangere.id, updated_at: etrangere.updated_at, contenu: {} }] });
ok(!r.ok && Number((await resa(R.secret)).montant_vente) === 2100 && Number((await com(R.secret)).commission_prevue) === 420 && Number((await un("select contenu->'lignes'->0->>'unite' u from documents where id = $1", [facture.id])).u) === 2100, "tout ou rien : une facture d'un autre dossier, ni prix, ni commission, ni facture écrits");
r = await corriger("nani", R.secret, { entite: ent.secret, commission: 300, prix: 1800, luJson: await lu(R.secret), documents: [{ id: facture.id, updated_at: "2000-01-01T00:00:00Z", contenu: contenuNeuf }] });
ok(!r.ok && code(r) === "change" && Number((await resa(R.secret)).montant_vente) === 2100, "facture modifiée depuis l'ouverture : refusée, rien d'écrit");
r = await corriger("nani", R.secret, { entite: ent.secret, commission: 300, prix: 1800, luJson: await lu(R.secret), documents: [{ id: facture.id, updated_at: facture.updated_at, contenu: contenuNeuf }] });
n = await com(R.secret);
ok(r.ok && Number(n.commission_prevue) === 300 && n.commission_prevue_auto === null && Number((await resa(R.secret)).montant_vente) === 1800, "prix 1 800 et commission 300 (la règle aurait donné 360) " + (r.err || ""));
ok(Number((await un("select contenu->'lignes'->0->>'unite' u from documents where id = $1", [facture.id])).u) === 1800 && r.rows[0].v.documents.length === 1, "la facture suit dans la même transaction");
await essaie(u.nani, "update reservations set montant_vente = 1500 where id = $1", [R.secret]);
ok(Number((await com(R.secret)).commission_prevue) === 300, "le prix change ensuite : la commission corrigée reste 300");
const jr = await un("select details from journal where table_name = 'reservations' and cible = $1 and details ? 'montant_vente' order by created_at asc limit 1 offset 1", [R.secret]);
ok(jr && Number(jr.details.montant_vente.avant) === 2100, "le journal des réservations garde l'ancien prix");
const jn = await un("select details from journal where table_name = 'reservations_nets' and cible = $1 and details ? 'commission_corrigee_le' order by created_at desc limit 1", [R.secret]);
ok(jn && Number(jn.details.commission_prevue.avant) === 420, "le journal des nets garde l'ancienne commission");
// Un rôle qui écrit les dossiers sans les factures ne fait pas suivre une facture.
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Nets sans factures', 'toute', array['dossiers.lire', 'dossiers.ecrire', 'partenaires.lire', 'partenaires.nets', 'finances.voir'])`);
await membre("autre", ent.secret, "Nets sans factures");
const f2 = await un("select id, updated_at from documents where id = $1", [facture.id]);
r = await corriger("autre", R.secret, { entite: ent.secret, commission: 250, prix: 1700, luJson: await lu(R.secret), documents: [{ id: f2.id, updated_at: f2.updated_at, contenu: contenuNeuf }] });
ok(!r.ok && code(r) === "documents" && Number((await resa(R.secret)).montant_vente) === 1500, "sans le droit des factures : la facture ne suit pas, rien n'est écrit");

// ---- Rejouée, puis retour en arrière ---------------------------------------------------------------------------------------------------
await db.exec(lire(MIG));
ok(Number((await com(R.taxi)).commission_prevue) === 500, "la migration se rejoue sans rien changer");
await db.exec(lire("retour-119-corriger-commission.sql"));
ok(!(await un("select 1 x from information_schema.columns where table_name = 'reservations_nets' and column_name = 'commission_corrigee_le'")), "retour : colonnes parties");
ok(!(await un("select 1 x from pg_proc where proname = 'corriger_commission'")), "retour : corriger_commission partie");
ok(!/commission_corrigee/.test((await un("select prosrc from pg_proc where proname = 'partenaire_saisir_commission'")).prosrc) && !/commission_corrigee/.test((await un("select prosrc from pg_proc where proname = 'partenaire_courses'")).prosrc), "retour : les fonctions des migrations 115 et 116 reviennent");
r = await essaie(u.brown, "select partenaire_saisir_commission($1, 600) v", [R.taxi]);
ok(!r.ok && /équipe/.test(r.err), "retour : sa saisie effacée, la commission corrigée reste protégée");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
