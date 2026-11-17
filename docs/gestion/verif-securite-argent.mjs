// Vérifie, sur un Postgres en mémoire, que les migrations 18 à 20 (paiement sur place, commissions, statistiques) et 31 (nets remplis par la base)
// respectent les droits :
// un rôle SANS « partenaires.nets » ne voit ni net ni commission, ni dans les tables, ni dans les fonctions (analyse_faits, résumés).
// À relancer après toute modification des fichiers SQL :
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-securite-argent.mjs . && GESTION_SQL=<repo>/docs/gestion/ GESTION_SRC=file://<repo>/src/gestion/js/ node verif-securite-argent.mjs
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
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema public, auth to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
const db = new PGlite();
await db.exec(harnais);
await db.exec(fs.readFileSync(W + "schema.sql", "utf8").replace("create extension if not exists pgcrypto;", ""));
for (const f of fs.readdirSync(W).filter((n) => /^migration-(1[89]|2\d|31)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]))) await db.exec(fs.readFileSync(W + f, "utf8"));
// Droits de table comme en production (migration 16 puis 3 : tout est fermé à anon, les politiques font le tri).
await db.exec("revoke execute on all functions in schema public from public, anon; grant execute on all functions in schema public to authenticated;");
// La migration 31 passe en production après ces droits par défaut : ses fonctions internes (qui lisent les nets) restent fermées à l'API.
for (const l of fs.readFileSync(W + "migration-31-nets-base.sql", "utf8").split("\n").filter((x) => /^revoke all on function/.test(x))) await db.exec(l);

const essaie = async (userId, sql, role = "authenticated") => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
};
const E = (await db.query("select id from entites where slug = 'ztp'")).rows[0].id;
const AUTRE = (await db.query("select id from entites where slug = 'secret'")).rows[0].id;
const U = {};
for (const k of ["admin", "editeur", "lecteur", "limite", "nets", "etranger"]) U[k] = (await db.query("insert into auth.users (email) values ($1) returning id", [k + "@test"])).rows[0].id;
// admin = premier compte = administratrice générale
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values
  ('${E}', 'Limité avec analyses', 'mes_dossiers', array['clients.lire','dossiers.lire','finances.voir','analytics.voir']),
  ('${E}', 'Avec nets', 'toute', array['clients.lire','dossiers.lire','finances.voir','analytics.voir','partenaires.lire','partenaires.nets','partenaires.ecrire','dossiers.ecrire'])`);
const m = (u, ent, role) => db.exec(`insert into membres values ('${U[u]}', '${ent}', (select id from roles where entite_id = '${ent}' and nom = '${role}'))`);
await m("editeur", E, "Éditeur"); await m("lecteur", E, "Lecteur"); await m("limite", E, "Limité avec analyses"); await m("nets", E, "Avec nets"); await m("etranger", AUTRE, "Lecteur");

// Données : deux clients, deux dossiers (l'un confié à « limite »), une réservation sur place avec net et commission secrets.
const NET = "777.77", COM = "123.45", NETDOC = "555.55", NETPREST = "444.44", REGLE = "pourcent_net";
await db.exec(`
insert into clients (id, entite_id, nom) values ('00000000-0000-4000-8000-0000000000c1', '${E}', 'Client Confidentiel'), ('00000000-0000-4000-8000-0000000000c2', '${E}', 'Client Du Limite');
insert into dossiers (id, entite_id, ref, client_id, responsable_id, cree_par) values
  ('00000000-0000-4000-8000-0000000000d1', '${E}', 'D1', '00000000-0000-4000-8000-0000000000c1', '${U.admin}', '${U.admin}'),
  ('00000000-0000-4000-8000-0000000000d2', '${E}', 'D2', '00000000-0000-4000-8000-0000000000c2', '${U.limite}', '${U.limite}');
insert into documents (id, entite_id, dossier_id, type, date_emission, contenu) values
  ('00000000-0000-4000-8000-0000000000a1', '${E}', '00000000-0000-4000-8000-0000000000d1', 'facture', '2026-10-01', '{"lignes":[{"id":"l1","unite":1000,"qte":1},{"id":"l2","unite":900,"qte":1,"paye_sur_place":true}]}'),
  ('00000000-0000-4000-8000-0000000000a2', '${E}', '00000000-0000-4000-8000-0000000000d2', 'facture', '2026-10-02', '{"lignes":[{"id":"l1","unite":300,"qte":1}]}');
insert into documents_nets (document_id, entite_id, nets) values ('00000000-0000-4000-8000-0000000000a1', '${E}', '{"l2": ${NETDOC}}');
insert into partenaires (id, entite_id, nom, regles) values ('00000000-0000-4000-8000-0000000000b1', '${E}', 'Partenaire', '{"mode_reglement":"sur_place"}');
insert into partenaires_prives (entite_id, partenaire_id, commission_regle) values ('${E}', '00000000-0000-4000-8000-0000000000b1', '{"type":"${REGLE}","valeur":${COM}}');
insert into prestations (id, entite_id, partenaire_id, famille, libelle) values ('00000000-0000-4000-8000-0000000000e1', '${E}', '00000000-0000-4000-8000-0000000000b1', 'excursion', 'Excursion');
insert into prestations_nets (entite_id, prestation_id, net) values ('${E}', '00000000-0000-4000-8000-0000000000e1', ${NETPREST});
insert into reservations (id, entite_id, dossier_id, partenaire_id, prestation_id, libelle, date_service, montant_vente, paye_sur_place, personnes) values
  ('00000000-0000-4000-8000-0000000000f1', '${E}', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1', 'Excursion', '2026-12-01', 900, true, '{"adultes": 2}');
insert into reservations_nets (entite_id, reservation_id, net_prevu, commission_prevue, commission_recue) values ('${E}', '00000000-0000-4000-8000-0000000000f1', ${NET}, ${COM}, 50);
`);
await db.exec(`insert into roles (entite_id, nom, permissions) values ('${E}', 'Suppression sans nets', array['dossiers.lire','dossiers.supprimer','dossiers.ecrire'])`);
U.suppr = (await db.query("insert into auth.users (email) values ('suppr@test') returning id")).rows[0].id;
await m("suppr", E, "Suppression sans nets");
const appel = (u, e = E) => essaie(U[u], `select analyse_faits('${e}', '2026-01-01', '2026-12-31', '2026-11-11')::text as j`);
const texteNets = [NET, COM, NETDOC, NETPREST, REGLE];

console.log("Rôle sans « nets » (Lecteur : analyses et montants)");
for (const t of ["partenaires_prives", "reservations_nets", "documents_nets", "prestations_nets", "trajets_nets"]) {
  const r = await essaie(U.lecteur, `select * from ${t}`);
  ok(r.ok && r.rows.length === 0, `${t} : aucune ligne lisible`);
}
const lect = await appel("lecteur");
ok(lect.ok, "analyse_faits répond au Lecteur");
const jl = lect.ok ? JSON.parse(lect.rows[0].j) : { reservations: [] };
ok(jl.nets === false, "`nets` vaut false");
ok(jl.reservations.length === 1 && ["net_prevu", "net_paye", "paye_le", "commission_prevue", "commission_recue", "commission_recue_le"].every((k) => jl.reservations[0][k] === null), "net et commissions valent null dans les réservations");
ok(texteNets.every((x) => !lect.rows[0].j.includes(x)), "aucun net, commission ni règle de commission dans le texte renvoyé");
for (const t of ["reservations", "documents", "dossiers_resume", "partenaires", "prestations"]) {
  const r = await essaie(U.lecteur, `select to_jsonb(x)::text as j from ${t} x`);
  ok(r.ok && texteNets.every((x) => !r.rows.some((l) => l.j.includes(x))), `${t} : aucun net ni commission dans les lignes lisibles`);
}
ok(!(await essaie(U.lecteur, `update partenaires_prives set commission_regle = '{"type":"fixe_reservation","valeur":1}'`)).n, "ne modifie pas une règle de commission");
ok(!(await essaie(U.lecteur, `insert into reservations_nets (entite_id, reservation_id, commission_prevue) values ('${E}', '00000000-0000-4000-8000-0000000000f1', 1) on conflict (reservation_id) do update set commission_prevue = 1`)).ok, "n'écrit pas de commission");

console.log("Rôle avec « nets »");
const avec = await appel("nets");
const ja = avec.ok ? JSON.parse(avec.rows[0].j) : { reservations: [] };
ok(ja.nets === true && ja.reservations[0].net_prevu === 777.77 && ja.reservations[0].commission_prevue === 123.45, "voit net et commission prévue");
ok(jl.reservations[0].montant_vente === 900 && ja.dossiers.find((d) => d.ref === "D1").sur_place === 900, "le montant payé sur place est un montant de vente, visible sans « nets »");

console.log("Rôle sans « analyses » (Éditeur), autre entreprise, visiteur anonyme");
ok((await appel("editeur")).err?.includes("Droit insuffisant"), "un Éditeur n'a pas les analyses");
ok((await appel("etranger")).err?.includes("Droit insuffisant"), "un membre d'une autre entreprise ne lit pas celle-ci");
ok(!(await essaie(null, `select analyse_faits('${E}', '2026-01-01', '2026-12-31')`, "anon")).ok, "la clé publique n'appelle pas analyse_faits");
ok(!(await essaie(null, `select recalculer_dossier('00000000-0000-4000-8000-0000000000d1')`, "anon")).ok, "la clé publique n'appelle pas recalculer_dossier");
ok(!(await essaie(null, `select montant_sur_place('{}'::jsonb)`, "anon")).ok, "la clé publique n'appelle pas montant_sur_place");

console.log("Portée « mes dossiers » avec analyses");
const lim = await appel("limite");
const jlim = lim.ok ? JSON.parse(lim.rows[0].j) : { dossiers: [] };
const direct = await essaie(U.limite, "select count(*)::int n from dossiers");
ok(direct.rows[0].n === 1, "(contexte) la table dossiers ne lui montre que le sien");
// Migration 21 : sans elle, analyse_faits et tableau_analytique portaient sur toute l'entreprise, noms de clients compris.
ok(jlim.dossiers.length === 1 && jlim.dossiers.every((d) => d.client === "Client Du Limite"), "analyse_faits se limite aux dossiers que ce rôle voit (noms de clients compris)");
const tab = await essaie(U.limite, `select tableau_analytique('${E}', '2026-01-01', '2026-12-31', '2026-11-11')::text as j`);
ok(tab.ok && !tab.rows[0].j.includes("Client Confidentiel") && tab.rows[0].j.includes("Client Du Limite"), "tableau_analytique (groupe, meilleurs clients) se limite aussi à ses dossiers");
const tabAdmin = await essaie(U.admin, `select tableau_analytique('${E}', '2026-01-01', '2026-12-31', '2026-11-11')::text as j`);
ok(tabAdmin.ok && tabAdmin.rows[0].j.includes("Client Confidentiel") && tabAdmin.rows[0].j.includes("Client Du Limite"), "une portée « toute » voit tous les clients");

console.log("Corbeille : un dossier supprimé garde ses nets pour la restauration, sans les montrer");
await db.exec(`select set_config('request.jwt.claim.sub', '${U.admin}', false)`);
const sup = await essaie(U.suppr, `delete from dossiers where id = '00000000-0000-4000-8000-0000000000d1'`);
ok(sup.ok && sup.n === 1, "un rôle avec « supprimer » supprime le dossier");
const co = await essaie(U.suppr, "select id, ligne, supprime_le from corbeille");
ok(co.ok && co.rows.length === 1, "il voit le dossier dans la corbeille");
const lc = await essaie(U.suppr, "select liees from corbeille");
ok(!lc.ok, "la colonne `liees` (nets, commissions) n'est pas lisible par l'API");
const tout = await essaie(U.suppr, "select * from corbeille");
ok(!tout.ok, "un `select *` sur la corbeille est refusé aussi");
const rest = await essaie(U.suppr, `select restaurer_dossier(id) from corbeille limit 1`);
ok(rest.ok, "la restauration (security definer) fonctionne toujours : " + (rest.err || ""));
const netsRestaures = (await db.query("select count(*)::int n from reservations_nets where reservation_id = '00000000-0000-4000-8000-0000000000f1'")).rows[0].n;
ok(netsRestaures === 1, "les nets de la réservation sont remis à la restauration");

console.log("recalculer_dossier");
const avant = (await db.query("select total, recu, sur_place from dossiers_resume where dossier_id = '00000000-0000-4000-8000-0000000000d1'")).rows[0];
const rec = await essaie(U.etranger, `select recalculer_dossier('00000000-0000-4000-8000-0000000000d1')`);
const apres = (await db.query("select total, recu, sur_place from dossiers_resume where dossier_id = '00000000-0000-4000-8000-0000000000d1'")).rows[0];
ok(JSON.stringify(avant) === JSON.stringify(apres) && !JSON.stringify(rec.rows).includes("1000"), "appelée par un étranger, elle ne change rien et ne renvoie rien (recalcul idempotent)");
ok(Number(avant.total) === 1000 && Number(avant.sur_place) === 900, "le résumé : total 1000 chez nous, 900 sur place");

console.log("Suivi des rappels (migration 23)");
await db.exec("insert into rappels_suivi (type, cible, abonnements, envoyes, erreur) values ('veille', '2026-11-12', 2, 2, '')");
ok((await essaie(U.admin, "select count(*)::int n from rappels_suivi")).rows[0].n === 1, "l'administratrice générale lit le suivi");
ok((await essaie(U.lecteur, "select count(*)::int n from rappels_suivi")).rows[0].n === 0, "un Lecteur ne lit pas le suivi");
ok((await essaie(U.editeur, "select count(*)::int n from rappels_suivi")).rows[0].n === 0, "un Éditeur sans droit réglages ne le lit pas");
ok(!(await essaie(U.admin, "insert into rappels_suivi (type) values ('veille')")).ok, "personne n'écrit dans le suivi par l'API, même administratrice");
ok(!(await essaie(null, "select 1 from rappels_suivi", "anon")).ok, "la clé publique n'y accède pas");


console.log("Migration 31 : net et commission prévus remplis par la base (lot F)");
{
  const SRC = process.env.GESTION_SRC || "../src/gestion/js/";
  const { reservationsDepuisDocument, commissionPrevue } = await import(new URL(SRC + "operations-calc.mjs", import.meta.url));
  const { ligneDepuisPrestation, lignesDepuisTrajet } = await import(new URL(SRC + "partenaires-calc.mjs", import.meta.url));
  const { separerNets } = await import(new URL(SRC + "nets-documents.mjs", import.meta.url));
  const S = AUTRE;
  const T = (await db.query("select id from entites where slug = 'taxi'")).rows[0].id;
  await db.exec(`update reglages set valeur = valeur || '{"fonctionnement":"excursions"}' where entite_id = '${S}';
    insert into reglages (entite_id, valeur) values ('${T}', '{"fonctionnement":"taxi"}') on conflict (entite_id) do update set valeur = reglages.valeur || '{"fonctionnement":"taxi"}';`);
  for (const k of ["mook", "anais", "mookTaxi"]) U[k] = (await db.query("insert into auth.users (email) values ($1) returning id", [k + "@test"])).rows[0].id;
  // Mook : l'Éditeur plus la lecture des partenaires, sans « partenaires.nets » (son rôle en production). Anaïs : tout, nets compris.
  for (const e of [S, T]) await db.exec(`insert into roles (entite_id, nom, portee, permissions) values
    ('${e}', 'Mook', 'toute', array['clients.lire','clients.ecrire','dossiers.lire','dossiers.ecrire','documents.ecrire','finances.voir','partenaires.lire']),
    ('${e}', 'Anaïs', 'toute', array['clients.lire','clients.ecrire','dossiers.lire','dossiers.ecrire','documents.ecrire','finances.voir','partenaires.lire','partenaires.ecrire','partenaires.nets'])`);
  await m("mook", S, "Mook"); await m("anais", S, "Anaïs"); await m("mookTaxi", T, "Mook");
  const id = (n) => `00000000-0000-4000-8000-0000000031${String(n).padStart(2, "0")}`;
  const P_NOUS = id(1), P_PLACE = id(2), P_FIXE = id(3), X = id(11), Y = id(12), Z = id(13), ZC = id(14), FRAIS = id(15), TR = id(21), D = id(31), DANN = id(32), DT = id(33), PT = id(34), XT = id(35);
  const regles = { [P_PLACE]: { type: "pourcent_net", valeur: 10 }, [P_FIXE]: { type: "fixe_personne", valeur: "150" } };
  await db.exec(`
  insert into partenaires (id, entite_id, nom, regles) values ('${P_NOUS}', '${S}', 'Chez nous', '{}'), ('${P_PLACE}', '${S}', 'Sur place', '{"mode_reglement":"sur_place"}'), ('${P_FIXE}', '${S}', 'Fixe', '{"mode_reglement":"sur_place"}'), ('${PT}', '${T}', 'Chauffeur', '{"mode_reglement":"sur_place"}');
  insert into partenaires_prives (entite_id, partenaire_id, commission_regle) values ('${S}', '${P_PLACE}', '${JSON.stringify(regles[P_PLACE])}'), ('${S}', '${P_FIXE}', '${JSON.stringify(regles[P_FIXE])}'), ('${T}', '${PT}', '{"type":"fixe_reservation","valeur":100}');
  insert into prestations (id, entite_id, partenaire_id, famille, libelle, prix_vente, unite, sur_place) values
    ('${X}', '${S}', '${P_NOUS}', 'excursion', 'Tour X', 1000, 'pp', false), ('${Y}', '${S}', '${P_PLACE}', 'excursion', 'Tour Y', 1500, 'ad', false),
    ('${Z}', '${S}', '${P_FIXE}', 'excursion', 'Tour Z', 2000, 'ad', false), ('${ZC}', '${S}', '${P_FIXE}', 'excursion', 'Tour Z, enfant', 1200, 'ch', false),
    ('${FRAIS}', '${S}', '${P_NOUS}', 'frais', 'Droit de parc', 400, 'pp', true), ('${XT}', '${T}', '${PT}', 'transfert', 'Course', 800, 'veh', false);
  insert into prestations_nets (entite_id, prestation_id, net) values ('${S}', '${X}', 700), ('${S}', '${Y}', 1100), ('${S}', '${Z}', 1600), ('${S}', '${ZC}', 900), ('${S}', '${FRAIS}', 400), ('${T}', '${XT}', 600);
  insert into trajets (id, entite_id, partenaire_id, de, vers, mode, depart, prix_adulte, prix_enfant) values ('${TR}', '${S}', '${P_NOUS}', 'Lanta', 'Lipe', 'Speedboat', '08:00', 1900, 1400);
  insert into trajets_nets (entite_id, trajet_id, net_adulte, net_enfant) values ('${S}', '${TR}', 1500, 1000);
  insert into clients (id, entite_id, nom) values ('${id(41)}', '${S}', 'Client Secret'), ('${id(42)}', '${T}', 'Client Taxi');
  insert into dossiers (id, entite_id, ref, client_id, annule) values ('${D}', '${S}', 'S1', '${id(41)}', false), ('${DANN}', '${S}', 'S2', '${id(41)}', true), ('${DT}', '${T}', 'T1', '${id(42)}', false);
  `);
  const netsDe = async (rid) => (await db.query(`select net_prevu::float8 as net, commission_prevue::float8 as com, net_prevu_auto::float8 as net_auto, commission_prevue_auto::float8 as com_auto from reservations_nets where reservation_id = '${rid}'`)).rows;
  const insererPar = (u, champs) => essaie(U[u], `insert into reservations (${Object.keys(champs).join(", ")}) values (${Object.values(champs).map((v) => (v === null ? "null" : typeof v === "object" ? `'${JSON.stringify(v)}'` : `'${v}'`)).join(", ")}) returning id`);
  const base = (rid, extra) => ({ id: rid, entite_id: S, dossier_id: D, libelle: "Service", statut: "confirme", ...extra });

  // 1. Réservation à la main par Mook (sans ligne de facture) : le tarif du catalogue × la quantité du formulaire.
  let r = await insererPar("mook", base(id(51), { prestation_id: X, partenaire_id: P_NOUS, personnes: { adultes: 2, enfants: 1 }, montant_vente: 3000 }));
  ok(r.ok, "Mook crée une réservation (droits inchangés) " + (r.err || ""));
  ok(JSON.stringify(await netsDe(id(51))) === JSON.stringify([{ net: 2100, com: null, net_auto: 2100, com_auto: null }]), "net prévu = net par personne × (adultes + enfants), aucune commission pour un service payé chez nous");
  ok((await essaie(U.mook, `select * from reservations_nets`)).rows.length === 0, "Mook ne lit toujours aucun net");
  ok((await essaie(U.mook, `select to_jsonb(x)::text as j from reservations x where id = '${id(51)}'`)).rows.every((l) => !l.j.includes("2100")), "ni dans la réservation qu'elle lit");
  r = await insererPar("mook", base(id(52), { trajet_id: TR, partenaire_id: P_NOUS, personnes: { adultes: 2, enfants: 1 }, montant_vente: 5200 }));
  ok(JSON.stringify(await netsDe(id(52))) === JSON.stringify([{ net: 4000, com: null, net_auto: 4000, com_auto: null }]), "trajet : adultes × net adulte + enfants × net enfant");
  r = await insererPar("mook", base(id(53), { prestation_id: Y, partenaire_id: P_PLACE, personnes: { adultes: 2, enfants: 0 }, montant_vente: 3000, paye_sur_place: true }));
  ok(JSON.stringify(await netsDe(id(53))) === JSON.stringify([{ net: 2200, com: 220, net_auto: 2200, com_auto: 220 }]), "payé sur place : commission d'après la règle du partenaire (10 % du net)");
  r = await insererPar("mook", base(id(54), { prestation_id: FRAIS, partenaire_id: P_NOUS, personnes: { adultes: 2 }, montant_vente: 800 }));
  ok((await netsDe(id(54))).length === 0, "un frais réglé sur place par le client n'a pas de net");
  r = await insererPar("mook", base(id(55), { prestation_id: null, partenaire_id: P_PLACE, personnes: { adultes: 2 }, montant_vente: 900, paye_sur_place: true }));
  ok((await netsDe(id(55))).length === 0, "service hors catalogue avec une règle en % du net : rien n'est deviné");

  // 2. Changements de la réservation : la valeur calculée suit, la valeur saisie reste.
  await essaie(U.mook, `update reservations set personnes = '{"adultes": 3, "enfants": 1}' where id = '${id(51)}'`);
  ok((await netsDe(id(51)))[0].net === 2800, "Mook change les personnes : le net calculé suit");
  await essaie(U.anais, `update reservations_nets set net_prevu = 2500 where reservation_id = '${id(51)}'`);
  await essaie(U.mook, `update reservations set personnes = '{"adultes": 4, "enfants": 1}', prestation_id = '${X}' where id = '${id(51)}'`);
  ok((await netsDe(id(51)))[0].net === 2500, "un net saisi à la main par Anaïs n'est jamais écrasé");
  await essaie(U.mook, `update reservations set montant_vente = 3200, personnes = '{"adultes": 3}' where id = '${id(53)}'`);
  ok(JSON.stringify(await netsDe(id(53))) === JSON.stringify([{ net: 3300, com: 330, net_auto: 3300, com_auto: 330 }]), "net et commission calculés suivent les personnes");
  await essaie(U.anais, `update reservations_nets set commission_prevue = 300 where reservation_id = '${id(53)}'`);
  await essaie(U.mook, `update reservations set personnes = '{"adultes": 4}' where id = '${id(53)}'`);
  const n53 = (await netsDe(id(53)))[0];
  ok(n53.net === 4400 && n53.com === 300, "une commission saisie à la main reste, le net calculé suit");
  await essaie(U.mook, `update reservations set paye_sur_place = false where id = '${id(52)}'`);
  await essaie(U.anais, `update reservations_nets set commission_recue = 50, commission_recue_le = '2026-11-20' where reservation_id = '${id(53)}'`);
  await essaie(U.anais, `update reservations_nets set commission_prevue = commission_prevue_auto where reservation_id = '${id(53)}'`);
  await essaie(U.mook, `update reservations set personnes = '{"adultes": 1}' where id = '${id(53)}'`);
  ok((await netsDe(id(53)))[0].com === 330, "une commission reçue ne bouge plus");
  await essaie(U.anais, `update reservations_nets set net_paye = 1000, paye_le = '2026-11-20' where reservation_id = '${id(52)}'`);
  await essaie(U.mook, `update reservations set personnes = '{"adultes": 5}' where id = '${id(52)}'`);
  ok((await netsDe(id(52)))[0].net === 4000, "un net payé ne bouge plus");

  // 3. Taxi, annulations : rien.
  r = await essaie(U.mookTaxi, `insert into reservations (entite_id, dossier_id, libelle, prestation_id, partenaire_id, personnes, montant_vente, paye_sur_place) values ('${T}', '${DT}', 'Course', '${XT}', '${PT}', '{"adultes":2}', 800, true) returning id`);
  ok(r.ok && (await netsDe(r.rows[0].id)).length === 0, "Taxi : ni net ni commission par défaut (décisions du 12.11 et du 17.11.2026)");
  await insererPar("mook", base(id(56), { prestation_id: X, partenaire_id: P_NOUS, personnes: { adultes: 2 }, statut: "annule" }));
  await insererPar("mook", base(id(57), { dossier_id: DANN, prestation_id: X, partenaire_id: P_NOUS, personnes: { adultes: 2 } }));
  ok((await netsDe(id(56))).length === 0 && (await netsDe(id(57))).length === 0, "service annulé ou dossier annulé : rien");

  // 4. L'interface qui insère ses nets alors que la base a déjà créé la ligne : la ligne est complétée, pas d'erreur de clé unique.
  r = await insererPar("anais", base(id(58), { prestation_id: X, partenaire_id: P_NOUS, personnes: { adultes: 1 }, montant_vente: 1000 }));
  const ins = await essaie(U.anais, `insert into reservations_nets (entite_id, reservation_id, net_prevu, net_paye, paye_le) values ('${S}', '${id(58)}', 650, null, null) returning net_prevu::float8 as net, net_prevu_auto::float8 as auto`);
  ok(ins.ok && ins.rows[0].net === 650 && ins.rows[0].auto === 700, "insertion de l'interface sur une ligne déjà créée : sa valeur gagne et compte comme saisie " + (ins.err || ""));
  ok((await db.query(`select count(*)::int n from reservations_nets where reservation_id = '${id(58)}'`)).rows[0].n === 1, "une seule ligne de nets par réservation");
  const ins2 = await essaie(U.anais, `insert into reservations_nets (entite_id, reservation_id, commission_recue) values ('${S}', '${id(58)}', 10) returning net_prevu::float8 as net`);
  ok(ins2.ok && ins2.rows[0].net === 650, "une insertion partielle garde les valeurs déjà là");
  ok(!(await essaie(U.mook, `insert into reservations_nets (entite_id, reservation_id, net_prevu) values ('${S}', '${id(51)}', 1)`)).ok, "Mook n'écrit toujours aucun net");
  for (const f of [`calculer_nets_reservation('${id(51)}')`, `net_reservation_calcule(r) from reservations r`, `net_catalogue_ligne('${X}', null, false)`]) {
    ok(!(await essaie(U.mook, `select ${f}`)).ok, `Mook n'appelle pas ${f.split("(")[0]}`);
  }

  // 5. Mêmes résultats que l'interface : une facture faite par Anaïs (nets visibles) donne, par reservationsDepuisDocument, le net et la
  //    commission de référence ; la même facture saisie par Mook (lignes sans nets) donne, par la base, les mêmes valeurs.
  let n = 0;
  const uid = () => `l${++n}`;
  const nets = { [X]: { net: 700 }, [Y]: { net: 1100 }, [Z]: { net: 1600 }, [ZC]: { net: 900 } };
  const P = { [X]: { id: X, partenaire_id: P_NOUS, libelle: "Tour X", prix_vente: 1000, unite: "pp" }, [Y]: { id: Y, partenaire_id: P_PLACE, libelle: "Tour Y", prix_vente: 1500, unite: "ad" }, [Z]: { id: Z, partenaire_id: P_FIXE, libelle: "Tour Z", prix_vente: 2000, unite: "ad" }, [ZC]: { id: ZC, partenaire_id: P_FIXE, libelle: "Tour Z, enfant", prix_vente: 1200, unite: "ch" } };
  const lignes = [
    ligneDepuisPrestation(P[X], nets[X], { qte: 3, date: "2026-12-01", uid }),
    ...lignesDepuisTrajet({ id: TR, partenaire_id: P_NOUS, de: "Lanta", vers: "Lipe", mode: "Speedboat", depart: "08:00", prix_adulte: 1900, prix_enfant: 1400 }, { net_adulte: 1500, net_enfant: 1000 }, { adultes: 2, enfants: 2, date: "2026-12-02", langue: "en", uid }),
    { ...ligneDepuisPrestation(P[Y], nets[Y], { qte: 2, date: "2026-12-03", uid }), paye_sur_place: true },
    { ...ligneDepuisPrestation(P[Z], nets[Z], { qte: 2, date: "2026-12-04", uid }), paye_sur_place: true },
    { ...ligneDepuisPrestation(P[ZC], nets[ZC], { qte: 1, date: "2026-12-04", uid }), paye_sur_place: true },
  ];
  const doc = { dossier_id: D, contenu: { lignes } };
  const attendues = reservationsDepuisDocument(doc, { uid: (() => { let k = 60; return () => id(++k); })(), regleDe: (pid) => regles[pid] || null });
  ok(attendues.length === 4, "(contexte) quatre réservations attendues, dont une adulte + enfant réunie");
  await db.query(`insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ($1, $2, 'facture', '2026-11-17', $3)`, [S, D, JSON.stringify(separerNets(doc.contenu).contenu)]);
  for (const a of attendues) {
    const x = a.reservation;
    const res = await insererPar("mook", { id: x.id, entite_id: S, dossier_id: D, ligne_id: x.ligne_id, prestation_id: x.prestation_id, trajet_id: x.trajet_id, partenaire_id: x.partenaire_id, libelle: x.libelle, date_service: x.date_service, personnes: x.personnes, statut: x.statut, montant_vente: x.montant_vente, paye_sur_place: x.paye_sur_place, details: x.details });
    const lu = (await netsDe(x.id))[0] || {};
    const com = a.commission_prevue === undefined ? null : a.commission_prevue;
    ok(res.ok && lu.net === a.net && (lu.com ?? null) === com, `facture saisie par Mook, « ${x.libelle} » : net ${lu.net === a.net ? "=" : "≠"} interface, commission ${(lu.com ?? null) === com ? "=" : "≠"} interface ${res.err || ""}`);
  }

  // 6. Règle de commission : la base et commissionPrevue rendent la même chose sur une grille de cas.
  const types = ["pourcent_vente", "pourcent_net", "fixe_personne", "fixe_reservation", "vente_moins_net", "inconnu"];
  const valeurs = [10, "12.5", "", null, -1, "abc", 0];
  let ecarts = 0, cas = 0;
  for (const type of types) for (const valeur of valeurs) for (const vente of [null, 1000, 333.33]) for (const net of [null, 900, 1200]) for (const [ad, en] of [[0, 0], [2, 1]]) {
    const regle = valeur === undefined ? { type } : { type, valeur };
    const js = commissionPrevue(regle, { vente, net, adultes: ad, enfants: en });
    const sql = (await db.query("select commission_calculee($1::jsonb, $2, $3, $4, $5)::float8 as c", [JSON.stringify(regle), vente, net, ad, en])).rows[0].c;
    cas++;
    if ((js ?? null) !== (sql ?? null)) { ecarts++; if (ecarts < 5) console.log("   écart", JSON.stringify(regle), vente, net, ad, en, js, sql); }
  }
  ok(ecarts === 0, `commission_calculee = commissionPrevue sur ${cas} cas`);

  // 7. Rattrapage : ne remplit que les valeurs vides, relançable sans effet de bord.
  await db.exec("alter table reservations disable trigger remplir_nets");
  await insererPar("anais", base(id(71), { prestation_id: X, partenaire_id: P_NOUS, personnes: { adultes: 2 }, montant_vente: 2000 }));
  await insererPar("anais", base(id(72), { prestation_id: Y, partenaire_id: P_PLACE, personnes: { adultes: 1 }, montant_vente: 1500, paye_sur_place: true }));
  await insererPar("anais", base(id(73), { prestation_id: X, partenaire_id: P_NOUS, personnes: { adultes: 2 }, montant_vente: 2000 }));
  await insererPar("anais", base(id(74), { prestation_id: null, partenaire_id: P_NOUS, personnes: { adultes: 2 }, montant_vente: 2000 }));
  await db.exec(`insert into reservations_nets (entite_id, reservation_id, net_prevu) values ('${S}', '${id(72)}', 999), ('${S}', '${id(73)}', 1234)`);
  await db.exec("alter table reservations enable trigger remplir_nets");
  const avantR = (await db.query("select reservation_id, to_jsonb(n) - 'id' as j from reservations_nets n order by reservation_id")).rows;
  const rattrapage = fs.readFileSync(W + "rattrapage-31-nets-base.sql", "utf8");
  const passe1 = (await db.query(rattrapage.replace(/^begin;|^commit;/gm, ""))).rows[0].reservations_completees;
  ok(Number(passe1) === 2, `premier passage : 2 réservations complétées (lu : ${passe1})`);
  ok(JSON.stringify(await netsDe(id(71))) === JSON.stringify([{ net: 1400, com: null, net_auto: 1400, com_auto: null }]), "réservation sans ligne de nets : net rempli");
  ok(JSON.stringify(await netsDe(id(72))) === JSON.stringify([{ net: 999, com: 99.9, net_auto: null, com_auto: 99.9 }]), "net déjà saisi gardé, commission vide remplie d'après lui");
  ok((await netsDe(id(73)))[0].net === 1234 && (await netsDe(id(74))).length === 0, "net existant intact, hors catalogue laissé vide");
  const changees = (await db.query("select reservation_id, to_jsonb(n) - 'id' as j from reservations_nets n order by reservation_id")).rows.filter((x) => { const a = avantR.find((y) => y.reservation_id === x.reservation_id); return !a || JSON.stringify(a.j) !== JSON.stringify(x.j); }).map((x) => x.reservation_id);
  ok(JSON.stringify(changees.sort()) === JSON.stringify([id(71), id(72)].sort()), "rien d'autre n'a changé");
  const passe2 = (await db.query(rattrapage.replace(/^begin;|^commit;/gm, ""))).rows[0].reservations_completees;
  ok(Number(passe2) === 0, "deuxième passage : rien à faire");

  // 8. Corbeille : restaurer un dossier de Secret remet ses nets tels quels (la ligne créée par le déclencheur à la réinsertion est complétée).
  await db.exec(`insert into dossiers (id, entite_id, ref, client_id) values ('${id(81)}', '${S}', 'S3', '${id(41)}')`);
  await insererPar("mook", base(id(82), { dossier_id: id(81), prestation_id: Y, partenaire_id: P_PLACE, personnes: { adultes: 2 }, montant_vente: 3000, paye_sur_place: true }));
  await essaie(U.anais, `update reservations_nets set net_prevu = 2000 where reservation_id = '${id(82)}'`);
  const avantCorbeille = JSON.stringify(await netsDe(id(82)));
  ok((await essaie(U.admin, `delete from dossiers where id = '${id(81)}'`)).n === 1, "(contexte) le dossier part à la corbeille");
  const restau = await essaie(U.admin, `select restaurer_dossier(id) from corbeille where (ligne->>'id') = '${id(81)}'`);
  ok(restau.ok && JSON.stringify(await netsDe(id(82))) === avantCorbeille, "restauré : net saisi et commission calculée identiques, une seule ligne " + (restau.err || ""));
}

console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTOUT EST BON");
process.exit(echecs ? 1 : 0);
