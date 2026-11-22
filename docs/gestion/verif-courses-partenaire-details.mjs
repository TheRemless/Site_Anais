// Vérifie la migration 116 (détail des courses pour le partenaire chauffeur) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// Chaque course rend les champs du voucher (liste blanche), la référence, le véhicule et leur nombre, l'hébergement, le paiement ; jamais un net,
// une note interne (réservation, dossier, Mook), une trace d'envoi, un prix d'origine, ni la référence d'un autre prestataire ; la liste blanche
// SQL est celle du code ; la migration se rejoue ; retour en arrière vers la fonction de la migration 115.
//   GESTION_SQL=<repo>/docs/gestion/ GESTION_SRC=file://<repo>/src/gestion/js/ node verif-courses-partenaire-details.mjs
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
const MIG = "migration-116-courses-partenaire-details.sql";
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d|1\d\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
ok(migrations.includes(MIG) && migrations.indexOf(MIG) > migrations.indexOf("migration-115-acces-partenaire.sql"), "la migration 116 passe après la 115, sur une base vide");
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
const INTERNES = { lignes_ids: ["L-test"], envois: [{ le: "x" }], voucher_fige: 3, prix_origine: 9999, commission_demandee_le: "2026-11-01", copie_de: "abc", note: "SECRET-NOTE-RES", personnes_du_dossier: true, avis_demande_le: "2026-11-02" };
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
const TOUT = { drop_off: "Lanta Test Villas", vol: "FD0000 14:05", bagages: "3", sieges: 1, type_transfert: "minivan", remarques: "Call on arrival", remarques_paiement: "Cash THB", hotel: "Lanta Test Resort", chambre: "12", embarquement: "Arrivals hall, gate 3", pickup_zone: "Long Beach", retour_date: "2026-12-01", retour_heure: "10:00", retour_lieu: "Krabi Airport" };
const R = {
  complete: await course({ details: TOUT, refPartenaire: "BR-77", ligne: { id: "L-1", par: "veh", qte: 2, unite: 2300 }, prestationId: prestation }),
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
let rows = await brown();
const de = (id) => rows.find((x) => x.id === id);
ok(!!de(R.complete) && !!de(R.sansPartenaire) && !de(R.autre), "mêmes courses que la 115 : sa fiche et sans partenaire, jamais une autre fiche");
const c = de(R.complete);
for (const k of Object.keys(TOUT)) ok(String(c.details[k]) === String(TOUT[k]), `champ du voucher rendu : ${k}`);
ok(c.ref === "TX-TEST-1" && c.reference_partenaire === "BR-77", "la référence de la course et la sienne");
ok(c.libelle.startsWith("Private minivan") && c.service === "Private Taxi", "le type de véhicule : libellé de la course et groupe du tarif");
ok(Number(c.vehicules) === 2, "le nombre de véhicules vient de la quantité de la ligne au véhicule");
ok(Number(de(R.sansPartenaire).vehicules) === 1, "sans ligne : un véhicule");
ok(c.adresse_client === "Lanta Test Resort, Room 12", "l'hôtel du client (première ligne de l'adresse) pour une fiche de Taxi");
ok(de(R.partagee).adresse_client === "", "jamais l'adresse postale d'une fiche partagée d'une autre entreprise");
ok(c.paiement === "sur_place" && Number(c.a_encaisser) === 2300, "payé au chauffeur : il encaisse le prix");
ok(de(R.prepayee).paiement === "paye" && Number(de(R.prepayee).a_encaisser) === 0, "déjà payé : rien à encaisser " + JSON.stringify([de(R.prepayee).paiement, de(R.prepayee).a_encaisser]));
ok(de(R.acompte).paiement === "acompte" && Number(de(R.acompte).a_encaisser) === 1800, "acompte : il encaisse le reste " + JSON.stringify([de(R.acompte).paiement, de(R.acompte).a_encaisser]));
ok(de(R.sansPartenaire).reference_partenaire === "", "jamais la référence d'un autre prestataire sur une course sans sa fiche");
ok(de(R.retourDepart).retour === true && de(R.retourDepart).details.programme_trajet === "Old Town tour" && Number(de(R.retourDepart).details.duree_h) === 4, "retour au point de départ : programme et durée");

// ---- Aucun net, aucune note interne ----------------------------------------------------------------------------------------------------
const tout = JSON.stringify(rows);
for (const k of Object.keys(INTERNES)) ok(rows.every((x) => !(k in (x.details || {}))), `clé interne absente : ${k}`);
for (const s of ["1234", "9999", "SECRET-NOTE", "L-test", "AUTRE-REF", "Autre chauffeur test", "VIP Taxi test"]) ok(!tout.includes(s), `rien ne sort de « ${s} » (nets, notes, lignes, autre prestataire)`);
ok(!Object.keys(c).some((k) => /net|note|marge/.test(k)), "aucune colonne de net, de marge ou de note");

// ---- Se rejoue, retour en arrière ----------------------------------------------------------------------------------------------------------
await db.exec(lire(MIG));
ok(JSON.stringify(await brown()) === JSON.stringify(rows), "la migration 116 se rejoue sans effet");
await db.exec(lire("retour-116-courses-partenaire-details.sql"));
rows = await brown();
ok(rows.length > 0 && !("details" in rows[0]) && "modifiable" in rows[0], "retour : la fonction de la migration 115 revient");
ok(!(await exec("anon", "partenaire_courses()")), "retour : toujours fermée à anon");
await db.exec(lire(MIG));
ok("details" in (await brown())[0], "et la 116 se repose après le retour");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
