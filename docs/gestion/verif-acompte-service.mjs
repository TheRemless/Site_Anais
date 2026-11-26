// Vérifie la migration 131 (l'acompte du dossier imputé à ses services payés sur place) sur un Postgres en mémoire : schema.sql puis toutes
// les migrations ; la répartition dans dossiers_resume (chez nous d'abord, puis par date), l'annulation, le remboursement, le trop-perçu,
// l'écran du chauffeur (partenaire_courses_de) ; rejeu et retour. Montants inventés.
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

// ---- Migration 131 : l'acompte du dossier, imputé à ses services payés sur place ----------------------------------------------------------
// Un dossier de deux courses payées sur place (aller 1500 au jour 5, retour 800 au jour 6), et en option une course chez nous (1000).
async function dossierAR({ chezNous = 0 } = {}) {
  const cl = (await un("insert into clients (entite_id, prenom, nom, telephone) values ($1, 'Acompte', $2, '+44 7700 900333') returning id", [ent.taxi, "Test" + ++nref])).id;
  const dos = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, $2, $3) returning id", [ent.taxi, "TX-AC-" + nref, cl])).id;
  const res = async (n, ligne, prix, surPlace = true) => (await un("insert into reservations (entite_id, dossier_id, partenaire_id, ligne_id, libelle, date_service, heure_pickup, lieu_pickup, personnes, statut, montant_vente, paye_sur_place) values ($1, $2, $3, $4, 'Private taxi', $5, '09:00', 'Hotel', '{\"adultes\":2}', 'confirme', $6, $7) returning id", [ent.taxi, dos, P.vip, ligne, await jour(n), prix, surPlace])).id;
  // Le retour est créé avant l'aller : l'ordre suit la date de service, pas la création.
  const retour = await res(6, "AC-2-" + nref, 800);
  const aller = await res(5, "AC-1-" + nref, 1500);
  const lignes = [{ id: "AC-1-" + nref, kind: "ligne", par: "veh", qte: 1, unite: 1500, paye_sur_place: true }, { id: "AC-2-" + nref, kind: "ligne", par: "veh", qte: 1, unite: 800, paye_sur_place: true }];
  if (chezNous) { await res(4, "AC-3-" + nref, chezNous, false); lignes.push({ id: "AC-3-" + nref, kind: "ligne", par: "veh", qte: 1, unite: chezNous }); }
  await db.query("insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ($1, $2, 'facture', $3, $4::jsonb)", [ent.taxi, dos, await jour(0), JSON.stringify({ lignes })]);
  return { dos, aller, retour };
}
const payer = async (dos, montant) => db.query("insert into paiements (entite_id, dossier_id, date, montant) values ($1, $2, $3, $4)", [ent.taxi, dos, await jour(0), montant]);
const resumeDe = async (dos) => un("select total, recu, parts, a_rembourser, trop_percu from dossiers_resume where dossier_id = $1", [dos]);
const part = (rs, id) => (rs.parts || {})[id] || null;
const ligneDe = async (id) => (await brown()).find((x) => x.id === id);
{
  // Chez nous d'abord (1000), puis l'aller (date la plus proche) : 1600 reçus → aller 600 versés, retour rien.
  const { dos, aller, retour } = await dossierAR({ chezNous: 1000 });
  await payer(dos, 1600);
  let rs = await resumeDe(dos);
  ok(Number(rs.total) === 1000 && Number(rs.recu) === 1600, "résumé : total chez nous 1000, reçu 1600 (tout le reçu du dossier)");
  ok(Number(part(rs, aller).verse) === 600 && Number(part(rs, aller).reste) === 900 && Number(part(rs, retour).verse) === 0 && Number(part(rs, retour).reste) === 800, "chez nous d'abord, puis par date : aller 600 versés / 900 à payer, retour 0 / 800 " + JSON.stringify(rs.parts));
  const [a, r] = [await ligneDe(aller), await ligneDe(retour)];
  ok(a.paiement === "acompte" && Number(a.a_encaisser) === 900 && r.paiement === "sur_place" && Number(r.a_encaisser) === 800, "écran du chauffeur : 900 pour l'aller, 800 pour le retour " + JSON.stringify([a.paiement, a.a_encaisser, r.paiement, r.a_encaisser]));
  // Le solde arrive : l'aller est payé, le reste passe au retour, jamais deux fois le même montant.
  await payer(dos, 1500);
  rs = await resumeDe(dos);
  ok(Number(part(rs, aller).verse) === 1500 && Number(part(rs, retour).verse) === 600 && Number(part(rs, retour).reste) === 200, "le solde : aller payé, 600 sur le retour " + JSON.stringify(rs.parts));
  ok((await ligneDe(aller)).paiement === "paye" && Number((await ligneDe(aller)).a_encaisser) === 0, "aller payé d'avance : rien à encaisser");
  // Trop-perçu, sans annulation.
  await payer(dos, 500);
  rs = await resumeDe(dos);
  ok(Number(rs.trop_percu) === 300 && Number(rs.a_rembourser) === 0, "trop-perçu de 300 signalé " + JSON.stringify([rs.trop_percu, rs.a_rembourser]));
}
{
  // Annulation : l'aller annulé ne reçoit rien ; le reçu va au retour, ce qui dépasse est à rembourser ; le remboursement solde l'alerte.
  const { dos, aller, retour } = await dossierAR();
  await payer(dos, 1200);
  await db.query("update reservations set statut = 'annule' where id = $1", [aller]);
  let rs = await resumeDe(dos);
  ok(!part(rs, aller) && Number(part(rs, retour).verse) === 800 && Number(rs.a_rembourser) === 400 && Number(rs.trop_percu) === 0, "service annulé : rien pour lui, 800 sur le retour, 400 à rembourser " + JSON.stringify(rs));
  await payer(dos, -400);
  rs = await resumeDe(dos);
  ok(Number(rs.a_rembourser) === 0 && Number(rs.recu) === 800 && Number(part(rs, retour).verse) === 800, "remboursement saisi : l'alerte disparaît, le retour garde 800 " + JSON.stringify(rs));
  // Un service qui change de prix ou de mode : le résumé suit sans nouveau paiement.
  await db.query("update reservations set montant_vente = 1000 where id = $1", [retour]);
  rs = await resumeDe(dos);
  ok(Number(part(rs, retour).reste) === 200, "prix du service changé : la part suit");
  await db.query("update reservations set paye_sur_place = false where id = $1", [retour]);
  rs = await resumeDe(dos);
  ok(!part(rs, retour), "service passé chez nous : plus de part sur place");
}
{
  // Le résumé est lu par tous, dossier ouvert ou non : un utilisateur qui voit les montants lit les parts dans dossiers_resume.
  const { dos, aller } = await dossierAR();
  await payer(dos, 500);
  const lu = await essaie(u.nani, "select parts from dossiers_resume where dossier_id = $1", [dos]);
  ok(lu.ok && lu.rows.length === 1 && Number(lu.rows[0].parts[aller].verse) === 500, "les parts se lisent dans dossiers_resume (droit « finances.voir ») " + (lu.err || ""));
  const mook = await essaie(u.mook, "select parts from dossiers_resume where dossier_id = $1", [dos]);
  ok(mook.ok, "lecture sans erreur pour un autre rôle " + (mook.err || ""));
}
ok(/for update/.test(lire(MIG)), "le calcul verrouille le dossier (écritures simultanées)");

await db.exec(lire(MIG));
ok(true, "la migration 131 se rejoue sans erreur");
await db.exec(lire("retour-131-acompte-service.sql"));
ok(!(await un("select count(*)::int n from information_schema.columns where table_name = 'dossiers_resume' and column_name = 'parts'")).n, "retour : les colonnes sont retirées, les fonctions d'avant reviennent");
await db.exec(lire(MIG));
ok((await un("select count(*)::int n from information_schema.columns where table_name = 'dossiers_resume' and column_name = 'parts'")).n === 1, "et la 131 se repose après le retour");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
