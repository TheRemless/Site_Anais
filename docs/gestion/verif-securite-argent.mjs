// Vérifie, sur un Postgres en mémoire, que les migrations 18 à 20 (paiement sur place, commissions, statistiques) respectent les droits :
// un rôle SANS « partenaires.nets » ne voit ni net ni commission, ni dans les tables, ni dans les fonctions (analyse_faits, résumés).
// À relancer après toute modification des fichiers SQL :
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-securite-argent.mjs . && GESTION_SQL=<repo>/docs/gestion/ node verif-securite-argent.mjs
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
for (const f of fs.readdirSync(W).filter((n) => /^migration-(1[89]|2\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]))) await db.exec(fs.readFileSync(W + f, "utf8"));
// Droits de table comme en production (migration 16 puis 3 : tout est fermé à anon, les politiques font le tri).
await db.exec("revoke execute on all functions in schema public from public, anon; grant execute on all functions in schema public to authenticated;");

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

console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTOUT EST BON");
process.exit(echecs ? 1 : 0);
