// Vérifie la migration 131 (acompte rattaché à un service) sur un Postgres en mémoire : schema.sql puis toutes les migrations ; l'écran du
// chauffeur (partenaire_courses_de) avec un acompte non rattaché, puis rattaché ; le résumé du dossier ; la restauration ; rejeu et retour.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-acompte-service.mjs
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
const MIG = "migration-131-acompte-service.sql";
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d|1\d\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
ok(migrations.includes(MIG) && migrations.indexOf(MIG) > migrations.indexOf("migration-128-frais-parc-libelle.sql"), "la migration 131 passe après la 128, sur une base vide");
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
const jour = async (n) => (await un(`select ((now() at time zone 'Asia/Bangkok')::date + ${n})::text d`)).d;
const SRC = process.env.GESTION_SRC || new URL("../../src/gestion/js/", import.meta.url).href;

// ---- Données fictives : une fiche VIP, une autre fiche, Mr. Brown ----------------------------------------------------------------------
const P = { vip: await partenaire(ent.taxi, "VIP Taxi test"), autre: await partenaire(ent.taxi, "Autre chauffeur test") };
await db.query("insert into partenaires_acces (user_id, partenaire_id) values ($1, $2)", [u.brown, P.vip]);
const prestation = (await un("insert into prestations (entite_id, partenaire_id, famille, groupe, libelle, prix_vente, unite) values ($1, $2, 'transfert', 'Private Taxi', 'Krabi Airport', 2300, 'veh') returning id", [ent.taxi, P.vip])).id;
let nref = 0;
const INTERNES = { lignes_ids: ["L-test"], envois: [{ le: "x" }], voucher_fige: 3, prix_origine: 9999, commission_demandee_le: "2026-11-01", copie_de: "abc", note: "SECRET-NOTE-RES", personnes_du_dossier: true, avis_demande_le: "2026-11-02",
  // Champs que n'imprime aucun document de Taxi (revue de sécurité, point 4) : ils ne sortent jamais, même remplis.
  remarques_paiement: "SECRET-NOTE-PAIEMENT-VOUCHER", caution: "SECRET-CAUTION", conditions: "SECRET-CONDITIONS", bateau: "SECRET-BATEAU", programme: "SECRET-PROGRAMME", parc_texte: "SECRET-PARC" };
async function course({ n = 1, partenaireId = P.vip, details = {}, surPlace = true, prix = 2300, clientDe = ent.taxi, adresse = "Lanta Test Resort, Room 12\nLong Beach", refPartenaire = "", ligne = null, paye = null, prestationId = null }) {
  const c = (await un("insert into clients (entite_id, prenom, nom, telephone, adresse, notes) values ($1, 'Test', $2, '+44 7700 900111', $3, 'SECRET-NOTE-CLIENT') returning id", [clientDe, "Client" + ++nref, adresse])).id;
  const d = (await un("insert into dossiers (entite_id, ref, client_id, notes) values ($1, $2, $3, 'SECRET-NOTE-DOSSIER') returning id", [ent.taxi, "TX-TEST-" + nref, c])).id;
  const r = (await un("insert into reservations (entite_id, dossier_id, partenaire_id, prestation_id, ligne_id, libelle, date_service, heure_pickup, lieu_pickup, personnes, statut, montant_vente, paye_sur_place, details, notes, reference_partenaire) values ($1, $2, $3, $4, $5, 'Private minivan: Krabi Airport → Koh Lanta', $6, '14:30', 'Krabi Airport', $7::jsonb, 'confirme', $8, $9, $10::jsonb, 'SECRET-NOTE-INTERNE', $11) returning id",
    [ent.taxi, d, partenaireId, prestationId, ligne ? ligne.id : "", await jour(n), JSON.stringify({ adultes: 2, enfants: 1, bebes: 1 }), prix, surPlace, JSON.stringify({ ...INTERNES, ...details }), refPartenaire])).id;
  await db.query("insert into reservations_nets (entite_id, reservation_id, net_prevu, net_paye) values ($1, $2, 1234, 1234)", [ent.taxi, r]);
  if (ligne) await db.query("insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ($1, $2, 'facture', $3, $4::jsonb)", [ent.taxi, d, await jour(0), JSON.stringify({ lignes: [{ kind: "ligne", net: 1234, ...ligne }] })]);
  if (paye) await db.query("insert into paiements (entite_id, dossier_id, date, montant, note) values ($1, $2, $3, $4, 'SECRET-NOTE-PAIEMENT')", [ent.taxi, d, await jour(0), paye]);
  return r;
}
const TOUT = { drop_off: "Lanta Test Villas", vol: "FD0000 14:05", bagages: "3", sieges: 1, sieges_bebe: 1, type_transfert: "minivan", remarques: "Call on arrival", hotel: "Lanta Test Resort", chambre: "12", embarquement: "Arrivals hall, gate 3", retour_date: "2026-12-01", retour_heure: "10:00", retour_lieu: "Krabi Airport" };
// La zone telle que pickup-calc.mjs la garde (point 2) : un objet { zone, grille, depart } ; seul le nom sort.
const ZONE = { zone: "Long Beach", grille: "SECRET-GRILLE-AUTRE-PRESTATAIRE", depart: "Saladan" };
const R = {
  complete: await course({ details: { ...TOUT, pickup_zone: ZONE }, refPartenaire: "BR-77", ligne: { id: "L-1", par: "veh", qte: 2, unite: 2300 }, prestationId: prestation }),
  prepayee: await course({ n: 2, surPlace: false, ligne: { id: "L-2", par: "veh", qte: 1, unite: 2300 }, paye: 2300 }),
  acompte: await course({ n: 3, surPlace: false, ligne: { id: "L-3", par: "veh", qte: 1, unite: 2300 }, paye: 500 }),
  sansPartenaire: await course({ n: 4, partenaireId: null, refPartenaire: "AUTRE-REF" }),
  partagee: await course({ n: 5, clientDe: ent.ztp, adresse: "Rue Test 1\n1000 Lausanne" }),
  retourDepart: await course({ n: 6, details: { type_trajet: "retour_depart", programme_trajet: "Old Town tour", duree_h: 4 } }),
  autre: await course({ n: 1, partenaireId: P.autre }),
};

// ---- Structure --------------------------------------------------------------------------------------------------------------------------
const exec = async (role, f) => (await un(`select has_function_privilege('${role}', '${f}', 'execute') a`)).a;
ok((await exec("authenticated", "partenaire_courses()")) && !(await exec("anon", "partenaire_courses()")), "partenaire_courses() : authenticated seulement, jamais anon");
ok(!(await exec("authenticated", "partenaire_champs_details()")) && !(await exec("anon", "partenaire_champs_details()")), "partenaire_champs_details() reste interne");

// La liste blanche SQL est exactement celle du code (CHAMPS_COURSE), qui couvre tous les champs des vouchers sauf les internes.
const { CHAMPS_COURSE } = await import(SRC + "courses-partenaire-calc.mjs");
const sqlListe = (await un("select partenaire_champs_details() l")).l;
ok(JSON.stringify([...sqlListe].sort()) === JSON.stringify([...CHAMPS_COURSE].sort()), "la liste blanche SQL est celle de CHAMPS_COURSE (code)");

// ---- Ce que Mr. Brown reçoit -----------------------------------------------------------------------------------------------------------
const brown = async () => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${u.brown}', false);`);
  try { return (await db.query("select * from partenaire_courses()")).rows; } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
};

// ---- Migration 131 : un acompte rattaché à un service ------------------------------------------------------------------------------------
// Un dossier de deux courses payées sur place (aller 1500, retour 800) et un acompte. Montants inventés.
async function dossierAR({ surPlace = true } = {}) {
  const cl = (await un("insert into clients (entite_id, prenom, nom, telephone) values ($1, 'Acompte', $2, '+44 7700 900333') returning id", [ent.taxi, "Test" + ++nref])).id;
  const dos = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, $2, $3) returning id", [ent.taxi, "TX-AC-" + nref, cl])).id;
  const res = async (n, ligne, prix) => (await un("insert into reservations (entite_id, dossier_id, partenaire_id, ligne_id, libelle, date_service, heure_pickup, lieu_pickup, personnes, statut, montant_vente, paye_sur_place) values ($1, $2, $3, $4, 'Private taxi', $5, '09:00', 'Hotel', '{\"adultes\":2}', 'confirme', $6, $7) returning id", [ent.taxi, dos, P.vip, ligne, await jour(n), prix, surPlace])).id;
  const aller = await res(5, "AC-1-" + nref, 1500);
  const retour = await res(6, "AC-2-" + nref, 800);
  await db.query("insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ($1, $2, 'facture', $3, $4::jsonb)", [ent.taxi, dos, await jour(0), JSON.stringify({ lignes: [{ id: "AC-1-" + nref, kind: "ligne", par: "veh", qte: 1, unite: 1500, paye_sur_place: surPlace }, { id: "AC-2-" + nref, kind: "ligne", par: "veh", qte: 1, unite: 800, paye_sur_place: surPlace }] })]);
  return { dos, aller, retour };
}
const ligneDe = async (id) => (await brown()).find((x) => x.id === id);
{
  const { dos, aller, retour } = await dossierAR();
  // Non rattaché, deux courses sur place : aucun montant deviné, ni sur l'une ni sur l'autre (le même acompte ne se déduit pas deux fois).
  await db.query("insert into paiements (entite_id, dossier_id, date, montant) values ($1, $2, $3, 600)", [ent.taxi, dos, await jour(0)]);
  const [a, r] = [await ligneDe(aller), await ligneDe(retour)];
  ok(a.paiement === "acompte_partage" && a.a_encaisser === null && r.paiement === "acompte_partage" && r.a_encaisser === null, "acompte non rattaché sur deux courses sur place : aucun montant " + JSON.stringify([a.paiement, a.a_encaisser, r.paiement, r.a_encaisser]));
  // Rattaché à l'aller : l'aller encaisse 1500 - 600, le retour son prix entier.
  await db.query("update paiements set reservation_id = $2 where dossier_id = $1", [dos, aller]);
  const [a2, r2] = [await ligneDe(aller), await ligneDe(retour)];
  ok(a2.paiement === "acompte" && Number(a2.a_encaisser) === 900 && r2.paiement === "sur_place" && Number(r2.a_encaisser) === 800, "acompte rattaché à l'aller : 900 pour l'aller, 800 pour le retour " + JSON.stringify([a2.paiement, a2.a_encaisser, r2.paiement, r2.a_encaisser]));
  ok(Number((await un("select recu from dossiers_resume where dossier_id = $1", [dos])).recu) === 0, "le résumé du dossier ne compte pas l'acompte rattaché à un service sur place");
  // Le solde payé d'avance sur l'aller : rien à encaisser, « paye ».
  await db.query("insert into paiements (entite_id, dossier_id, date, montant, reservation_id) values ($1, $2, $3, 900, $4)", [ent.taxi, dos, await jour(0), aller]);
  const a3 = await ligneDe(aller);
  ok(a3.paiement === "paye" && Number(a3.a_encaisser) === 0, "aller payé en entier d'avance : rien à encaisser " + JSON.stringify([a3.paiement, a3.a_encaisser]));
  // Un paiement ne se rattache pas au service d'un autre dossier.
  const autre = await dossierAR();
  const refus = await essaie(u.nani, "update paiements set reservation_id = $2 where dossier_id = $1", [dos, autre.aller]);
  ok(!refus.ok && /son dossier/.test(refus.err), "refus : rattacher un paiement au service d'un autre dossier");
  // Un service supprimé : le paiement reste, sans rattachement.
  await db.query("delete from reservations where id = $1", [retour]);
  ok(true, "supprimer un service sans paiement rattaché passe");
}
{
  // Une seule course sur place et un acompte non rattaché : le reste dû est exact.
  const { dos, aller, retour } = await dossierAR();
  await db.query("update reservations set statut = 'annule' where id = $1", [retour]);
  await db.query("insert into paiements (entite_id, dossier_id, date, montant) values ($1, $2, $3, 500)", [ent.taxi, dos, await jour(0)]);
  const a = await ligneDe(aller);
  ok(a.paiement === "acompte" && Number(a.a_encaisser) === 1000, "une seule course sur place : acompte non rattaché déduit (1500 - 500) " + JSON.stringify([a.paiement, a.a_encaisser]));
}
{
  // Restauration : les paiements reviennent avant les réservations, la clé vérifiée en fin de transaction laisse passer.
  const { dos, aller } = await dossierAR();
  await db.query("insert into paiements (entite_id, dossier_id, date, montant, reservation_id) values ($1, $2, $3, 300, $4)", [ent.taxi, dos, await jour(0), aller]);
  const p = await un("select * from paiements where dossier_id = $1", [dos]);
  const r = await un("select * from reservations where id = $1", [aller]);
  await db.exec("begin");
  await db.query("delete from paiements where dossier_id = $1", [dos]);
  await db.query("delete from reservations where id = $1", [aller]);
  await db.query("insert into paiements select * from jsonb_populate_record(null::paiements, $1::jsonb)", [JSON.stringify(p)]);
  await db.query("insert into reservations select * from jsonb_populate_record(null::reservations, $1::jsonb)", [JSON.stringify(r)]);
  let fin = null;
  try { await db.exec("commit"); } catch (e) { fin = e.message; await db.exec("rollback"); }
  ok(!fin && (await un("select reservation_id from paiements where dossier_id = $1", [dos])).reservation_id === aller, "paiement remis avant sa réservation dans une même transaction : accepté " + (fin || ""));
}

await db.exec(lire(MIG));
ok(true, "la migration 131 se rejoue sans erreur");
await db.exec(lire("retour-131-acompte-service.sql"));
ok(!(await un("select count(*)::int n from information_schema.columns where table_name = 'paiements' and column_name = 'reservation_id'")).n, "retour : la colonne est retirée, les fonctions d'avant reviennent");
await db.exec(lire(MIG));
ok((await un("select count(*)::int n from information_schema.columns where table_name = 'paiements' and column_name = 'reservation_id'")).n === 1, "et la 131 se repose après le retour");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
