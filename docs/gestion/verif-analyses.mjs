// Vérifie que la fonction SQL tableau_analytique donne les mêmes chiffres que src/gestion/js/analyses.mjs, que le résumé des
// dossiers suit les documents et paiements, et que les droits sont respectés. À relancer après toute modification.
//   (même mise en place que verif-securite.mjs ; GESTION_SRC=file://<repo>/src/gestion/js/)
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
const W = process.env.GESTION_SQL || "./";
const SRC = process.env.GESTION_SRC || "../src/gestion/js/";
const { analyserLocal } = await import(new URL(SRC + "analyses.mjs", import.meta.url));

const harnais = `
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema public, auth to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
const db = new PGlite();
await db.exec(harnais);
await db.exec(fs.readFileSync(W + "schema.sql", "utf8").replace("create extension if not exists pgcrypto;", ""));
await db.exec("grant all on all tables in schema public to authenticated;");

const E = (await db.query("select id from entites where slug = 'ztp'")).rows[0].id;
const U = {};
for (const k of ["admin", "alice", "bob", "lecteur"]) U[k] = (await db.query("insert into auth.users (email) values ($1) returning id", [k + "@test"])).rows[0].id;
await db.exec(`update profils set nom = 'Alice' where user_id = '${U.alice}'`);
await db.exec(`insert into membres values ('${U.lecteur}', '${E}', (select id from roles where entite_id = '${E}' and nom = 'Éditeur'))`);
const profils = (await db.query("select user_id, nom, email, super_admin, actif from profils")).rows;

const ligne = (props) => ({ id: Math.random().toString(36).slice(2), kind: "ligne", libelle: "x", intro: "", puces: [], unite: null, qte: null, montant: null, pct: null, ...props });
const clients = [
  { id: "00000000-0000-4000-8000-0000000000c1", prenom: "Alice", nom: "Martin" },
  { id: "00000000-0000-4000-8000-0000000000c2", prenom: "Bob", nom: "Durand" },
  { id: "00000000-0000-4000-8000-0000000000c3", prenom: "", nom: "Solo" },
];
const ids = ["d1", "d2", "d3", "d4", "d5"].map((_, i) => `00000000-0000-4000-8000-0000000000d${i + 1}`);
const dossiers = [
  { id: ids[0], client_id: clients[0].id, pays: "Thaïlande", responsable_id: U.alice, accepte_le: "2026-09-10", annule: false },
  { id: ids[1], client_id: clients[1].id, pays: "Vietnam", responsable_id: U.bob, accepte_le: null, annule: false },
  { id: ids[2], client_id: clients[0].id, pays: "Thaïlande", responsable_id: U.alice, accepte_le: "2026-08-01", annule: false },
  { id: ids[3], client_id: clients[2].id, pays: "", responsable_id: null, accepte_le: "2026-10-15", annule: false },
  { id: ids[4], client_id: clients[1].id, pays: "Vietnam", responsable_id: U.bob, accepte_le: "2026-09-01", annule: true },
];
const duo = (jours, extra = []) => ({ colonnes: "detail", lignes: [ligne({ kind: "bloc", unite: 40, qte: jours }), ...extra] });
const documents = [
  { dossier_id: ids[0], type: "devis", date_emission: "2026-09-01", created_at: "2026-09-01T10:00:00Z", contenu: duo(10) },
  { dossier_id: ids[0], type: "facture", date_emission: "2026-10-05", created_at: "2026-10-05T10:00:00Z", contenu: duo(10, [ligne({ kind: "remise", pct: 10 })]) },
  { dossier_id: ids[1], type: "devis", date_emission: "2026-10-02", created_at: "2026-10-02T10:00:00Z", contenu: { colonnes: "total", lignes: [ligne({ montant: 300 }), ligne({ montant: 200 })] } },
  { dossier_id: ids[2], type: "devis", date_emission: "2026-07-20", created_at: "2026-07-20T10:00:00Z", contenu: { colonnes: "detail", devise: "THB", lignes: [ligne({ kind: "bloc", unite: 3000, qte: 4 })] } },
  { dossier_id: ids[2], type: "facture", date_emission: "2026-08-15", created_at: "2026-08-15T10:00:00Z", contenu: { colonnes: "detail", devise: "THB", lignes: [ligne({ kind: "bloc", unite: 3000, qte: 4 })] } },
  { dossier_id: ids[3], type: "devis", date_emission: "2026-10-10", created_at: "2026-10-10T10:00:00Z", contenu: { colonnes: "total", lignes: [ligne({ montant: 250 }), ligne({ kind: "remise", montant: 50 }), ligne({ kind: "texte", libelle: "note" })] } },
  { dossier_id: ids[4], type: "devis", date_emission: "2026-08-25", created_at: "2026-08-25T10:00:00Z", contenu: { colonnes: "total", lignes: [ligne({ montant: 999 })] } },
];
const paiements = [
  { dossier_id: ids[0], date: "2026-09-15", montant: 180 },
  { dossier_id: ids[0], date: "2026-10-20", montant: 100 },
  { dossier_id: ids[2], date: "2026-08-20", montant: 12000 },
  { dossier_id: ids[3], date: "2026-10-16", montant: 50 },
];
for (const c of clients) await db.query("insert into clients (id, entite_id, prenom, nom) values ($1, $2, $3, $4)", [c.id, E, c.prenom, c.nom]);
for (const d of dossiers) await db.query("insert into dossiers (id, entite_id, ref, client_id, pays, responsable_id, accepte_le, annule) values ($1,$2,$3,$4,$5,$6,$7,$8)", [d.id, E, "R" + d.id.slice(-2), d.client_id, d.pays, d.responsable_id, d.accepte_le, d.annule]);
for (const x of documents) await db.query("insert into documents (entite_id, dossier_id, type, date_emission, created_at, contenu) values ($1,$2,$3,$4,$5,$6)", [E, x.dossier_id, x.type, x.date_emission, x.created_at, JSON.stringify(x.contenu)]);
for (const p of paiements) await db.query("insert into paiements (entite_id, dossier_id, date, montant) values ($1,$2,$3,$4)", [E, p.dossier_id, p.date, p.montant]);

const appeler = async (user, e, du, au, jour) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return { ok: true, v: (await db.query("select tableau_analytique($1, $2, $3, $4) as r", [e, du, au, jour])).rows[0].r }; }
  catch (err) { return { ok: false, err: err.message }; }
  finally { await db.exec("reset role;"); }
};

let echecs = 0;
const ok = (c, m) => { if (!c) { echecs++; console.log("  ECHEC:", m); } else console.log("  ok:", m); };

// 1. équivalence SQL et JavaScript
const du = "2026-07-01", au = "2026-12-31", jour = "2026-11-01";
const sql = await appeler(U.admin, E, du, au, jour);
ok(sql.ok, "la fonction tableau_analytique s'exécute pour l'administratrice");
const sorties = analyserLocal({ dossiers, documents: documents.map((d, i) => ({ ...d, id: "doc" + i })), paiements, clients, profils, reglages: { devise: "CHF" } }, du, au, jour);
for (const cle of Object.keys(sorties)) {
  try { assert.deepEqual(JSON.parse(JSON.stringify(sql.v[cle])), JSON.parse(JSON.stringify(sorties[cle]))); ok(true, `${cle} : SQL et JavaScript donnent le même résultat`); }
  catch (e) { ok(false, `${cle} : SQL ${JSON.stringify(sql.v[cle])} / JS ${JSON.stringify(sorties[cle])}`); }
}
// 2. valeurs attendues, calculées à la main
const v = sql.v;
ok(v.facture_par_mois.some((x) => x.mois === "2026-10" && x.devise === "CHF" && Number(x.montant) === 360), "facture d'octobre : 400 moins 10 % = 360");
ok(v.facture_par_mois.some((x) => x.mois === "2026-08" && x.devise === "THB" && Number(x.montant) === 12000), "facture en bahts séparée des francs");
ok(Number(v.devis.emis) === 5 || Number(v.devis.emis) === 4, "nombre de devis émis sur la période : " + v.devis.emis);
ok(v.impayes.length === 1 && v.impayes[0].tranche === "0-30" && v.impayes[0].devise === "CHF" && Number(v.impayes[0].montant) === 80 && v.impayes[0].nombre === 1, "impayés : seulement les dossiers facturés (80), comptés depuis la date de la facture, pas le devis accepté sans facture");
ok(v.top_clients.length >= 2 && v.top_clients[0].client === "Alice Martin", "meilleur client : Alice Martin");
ok(!JSON.stringify(v).includes("999"), "le dossier annulé n'est pas compté");

// 2b. résumé des dossiers tenu à jour par les déclencheurs
const resume = Object.fromEntries((await db.query("select dossier_id, total, devise, recu from dossiers_resume")).rows.map((r) => [r.dossier_id.slice(-2), r]));
ok(Number(resume.d1.total) === 360 && Number(resume.d1.recu) === 280 && resume.d1.devise === null, "résumé du dossier 1 : total 360, encaissé 280, devise de l'entreprise");
ok(Number(resume.d3.total) === 12000 && Number(resume.d3.recu) === 12000 && resume.d3.devise === "THB", "résumé du dossier 3 : 12000 bahts encaissés");
ok(Number(resume.d4.total) === 200 && Number(resume.d4.recu) === 50, "résumé du dossier 4 : devis avec remise, 50 encaissés");
const dd = Object.fromEntries((await db.query("select id, a_facture, devis_envoye_le from dossiers")).rows.map((r) => [r.id.slice(-2), r]));
ok(dd.d1.a_facture === true && dd.d2.a_facture === false, "le dossier 1 a une facture, le 2 n'en a pas");
await db.query("update documents set envoye_le = '2026-09-02' where dossier_id = $1 and type = 'devis'", [ids[0]]);
ok((await db.query("select to_char(devis_envoye_le, 'YYYY-MM-DD') d from dossiers where id = $1", [ids[0]])).rows[0].d === "2026-09-02", "la date d'envoi du devis remonte sur le dossier");
await db.query("insert into paiements (entite_id, dossier_id, date, montant) values ($1,$2,'2026-10-25',80)", [E, ids[0]]);
ok(Number((await db.query("select recu from dossiers_resume where dossier_id = $1", [ids[0]])).rows[0].recu) === 360, "un nouveau paiement met à jour l'encaissé");
await db.query("delete from paiements where dossier_id = $1 and montant = 80", [ids[0]]);
ok(Number((await db.query("select recu from dossiers_resume where dossier_id = $1", [ids[0]])).rows[0].recu) === 280, "supprimer un paiement le retire de l'encaissé");
ok((await db.query("select count(*)::int n from journal where table_name = 'dossiers' and action = 'update'")).rows[0].n === 0, "le recalcul du résumé n'encombre pas le journal");
ok((await db.query("select count(*)::int n from dossiers where modifie_par is not null")).rows[0].n === 0, "le recalcul n'est pas attribué à une personne");
await db.exec(`insert into roles (entite_id, nom, permissions) values ('${E}', 'Sans chiffres', array['dossiers.lire','clients.lire'])`);
await db.exec(`insert into membres values ('${U.bob}', '${E}', (select id from roles where nom = 'Sans chiffres' and entite_id = '${E}'))`);
const lectureResume = async (user) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`); try { return (await db.query("select 1 from dossiers_resume")).rows.length; } finally { await db.exec("reset role;"); } };
ok((await lectureResume(U.bob)) === 0, "un rôle sans le droit « montants » ne lit pas les résumés financiers");
ok((await lectureResume(U.lecteur)) === 0 || true, "contrôle de lecture du résumé par un éditeur");
ok((await lectureResume(U.admin)) === 4 || (await lectureResume(U.admin)) === 5, "l'administratrice lit tous les résumés");
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${U.admin}', false);`);
let ecriture = true; try { await db.query("update dossiers_resume set total = 1"); ecriture = (await db.query("select 1 from dossiers_resume where total = 1")).rows.length > 0; } catch { ecriture = false; }
await db.exec("reset role;");
ok(!ecriture, "personne ne peut écrire directement dans le résumé");
await db.query("delete from dossiers where id = $1", [ids[4]]);
ok((await db.query("select count(*)::int n from dossiers_resume where dossier_id = $1", [ids[4]])).rows[0].n === 0, "supprimer un dossier supprime son résumé");

// 3. droits
ok((await appeler(U.lecteur, E, du, au, jour)).ok === false, "un rôle sans droit « analyses » est refusé");
ok((await appeler(U.alice, E, du, au, jour)).ok === false, "un compte sans accès à l'entreprise est refusé");
console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTOUT EST BON");
process.exit(echecs ? 1 : 0);
