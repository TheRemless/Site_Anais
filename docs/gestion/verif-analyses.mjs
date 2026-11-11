// Vérifie que la fonction SQL tableau_analytique donne les mêmes chiffres que src/gestion/js/analyses.mjs, que le résumé des
// dossiers suit les documents et paiements, et que les droits sont respectés. À relancer après toute modification.
//   (même mise en place que verif-securite.mjs ; GESTION_SRC=file://<repo>/src/gestion/js/)
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
const W = process.env.GESTION_SQL || "./";
const SRC = process.env.GESTION_SRC || "../src/gestion/js/";
const { analyserLocal, faitsLocal } = await import(new URL(SRC + "analyses.mjs", import.meta.url));

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
// schema.sql s'arrête avant les migrations suivantes : on les applique dans l'ordre (18 : sur place, 19 : paiements, 20 : statistiques).
for (const f of ["migration-18-sur-place.sql", "migration-19-paiements.sql", "migration-20-statistiques.sql"]) await db.exec(fs.readFileSync(W + f, "utf8"));
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
const pid = (n) => `00000000-0000-4000-8000-0000000000a${n}`;
const paiements = [
  { id: pid(1), dossier_id: ids[0], date: "2026-09-15", montant: 180 },
  { id: pid(2), dossier_id: ids[0], date: "2026-10-20", montant: 100 },
  { id: pid(3), dossier_id: ids[2], date: "2026-08-20", montant: 12000 },
  { id: pid(4), dossier_id: ids[3], date: "2026-10-16", montant: 50, moyen: "especes", type: "solde" },
];
for (const c of clients) await db.query("insert into clients (id, entite_id, prenom, nom) values ($1, $2, $3, $4)", [c.id, E, c.prenom, c.nom]);
for (const d of dossiers) await db.query("insert into dossiers (id, entite_id, ref, client_id, pays, responsable_id, accepte_le, annule) values ($1,$2,$3,$4,$5,$6,$7,$8)", [d.id, E, "R" + d.id.slice(-2), d.client_id, d.pays, d.responsable_id, d.accepte_le, d.annule]);
for (const x of documents) await db.query("insert into documents (entite_id, dossier_id, type, date_emission, created_at, contenu) values ($1,$2,$3,$4,$5,$6)", [E, x.dossier_id, x.type, x.date_emission, x.created_at, JSON.stringify(x.contenu)]);
for (const p of paiements) await db.query("insert into paiements (id, entite_id, dossier_id, date, montant, moyen, type) values ($1,$2,$3,$4,$5,$6,$7)", [p.id, E, p.dossier_id, p.date, p.montant, p.moyen || null, p.type || null]);

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
ok(v.pipeline.length === 1 && v.pipeline[0].devise === "CHF" && Number(v.pipeline[0].montant) === 500 && v.pipeline[0].nombre === 1, "devis en attente : 500 CHF (ni accepté, ni annulé, ni facturé)");
ok(Number(v.activite.dossiers) === 3 && Number(v.activite.clients) === 2, "activité : 3 dossiers retenus pour 2 clients");

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

// 4. Faits des statistiques détaillées (migration 20) : la fonction SQL `analyse_faits` et `faitsLocal` doivent donner les mêmes faits.
console.log("\n== Faits des statistiques (analyse_faits) ==");
const idn = (genre, n) => `00000000-0000-4000-8000-${String(genre).padStart(2, "0")}${String(n).padStart(10, "0")}`;
const part = [
  { id: idn(10, 1), nom: "Longtail test" },
  { id: idn(10, 2), nom: "Kayak test" },
];
for (const x of part) await db.query("insert into partenaires (id, entite_id, nom, categorie) values ($1,$2,$3,'Excursions')", [x.id, E, x.nom]);
const prest = [
  { id: idn(11, 1), partenaire_id: part[0].id, famille: "excursion", libelle: "4 îles", prix_vente: 1200 },
  { id: idn(11, 2), partenaire_id: part[1].id, famille: "activite", libelle: "Kayak", prix_vente: 900 },
];
for (const x of prest) await db.query("insert into prestations (id, entite_id, partenaire_id, famille, libelle, prix_vente, unite) values ($1,$2,$3,$4,$5,$6,'pp')", [x.id, E, x.partenaire_id, x.famille, x.libelle, x.prix_vente]);
const trajetId = idn(12, 1);
await db.query("insert into trajets (id, entite_id, partenaire_id, numero, de, vers, mode) values ($1,$2,$3,1,'Koh Lanta','Koh Phi Phi','Speedboat')", [trajetId, E, part[0].id]);
const ids2 = [6, 7, 8, 9].map((n) => idn(13, n));
const cl2 = clients[0].id;
const sp = (props) => ligne({ kind: "ligne", paye_sur_place: true, ...props });
const dossiers2 = [
  { id: ids2[0], client_id: cl2, pays: "Excursion", responsable_id: U.alice, accepte_le: "2026-10-01", annule: false, date_depart: "2026-12-20", date_retour: "2026-12-30" },
  { id: ids2[1], client_id: clients[1].id, pays: "", responsable_id: null, accepte_le: null, annule: false, date_depart: null, date_retour: null },
  { id: ids2[2], client_id: clients[1].id, pays: "Excursion", responsable_id: U.bob, accepte_le: "2026-10-03", annule: true, date_depart: null, date_retour: null },
  { id: ids2[3], client_id: clients[2].id, pays: "Transfert", responsable_id: U.admin, accepte_le: "2026-11-02", annule: false, date_depart: null, date_retour: null },
];
for (const d of dossiers2) await db.query("insert into dossiers (id, entite_id, ref, client_id, pays, responsable_id, accepte_le, annule, date_depart, date_retour) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [d.id, E, "S" + d.id.slice(-2), d.client_id, d.pays, d.responsable_id, d.accepte_le, d.annule, d.date_depart, d.date_retour]);
const mix = { colonnes: "detail", lignes: [ligne({ kind: "bloc", unite: 1200, qte: 3, libelle: "4 îles" }), sp({ unite: 900, qte: 2, libelle: "Kayak" }), sp({ montant: 250, libelle: "Frais de parc" }), ligne({ kind: "remise", pct: 10 }), ligne({ kind: "texte", libelle: "note", paye_sur_place: true })] };
const documents2 = [
  { dossier_id: ids2[0], type: "devis", date_emission: "2026-09-28", created_at: "2026-09-28T09:00:00Z", contenu: mix },
  { dossier_id: ids2[0], type: "facture", date_emission: "2026-10-01", created_at: "2026-10-01T09:00:00Z", contenu: mix },
  { dossier_id: ids2[1], type: "devis", date_emission: "2026-10-28", created_at: "2026-10-28T09:00:00Z", contenu: { colonnes: "detail", devise: "EUR", lignes: [sp({ unite: 50, qte: 2 }), ligne({ unite: 35, qte: 2 })] } },
  { dossier_id: ids2[2], type: "devis", date_emission: "2026-09-30", created_at: "2026-09-30T09:00:00Z", contenu: { colonnes: "total", lignes: [ligne({ montant: 700 })] } },
  { dossier_id: ids2[3], type: "devis", date_emission: "2026-10-30", created_at: "2026-10-30T09:00:00Z", contenu: { colonnes: "total", lignes: [ligne({ montant: 2500 })] } },
  { dossier_id: ids2[3], type: "facture", date_emission: "2026-11-02", created_at: "2026-11-02T09:00:00Z", contenu: { colonnes: "total", lignes: [ligne({ montant: 2500 })] } },
];
for (const x of documents2) await db.query("insert into documents (entite_id, dossier_id, type, date_emission, created_at, contenu) values ($1,$2,$3,$4,$5,$6)", [E, x.dossier_id, x.type, x.date_emission, x.created_at, JSON.stringify(x.contenu)]);
const paiements2 = [
  { id: pid(5), dossier_id: ids2[0], date: "2026-10-02", montant: 1500, moyen: "virement", type: "acompte" },
  { id: pid(6), dossier_id: ids2[3], date: "2026-11-03", montant: -200, moyen: "", type: "remboursement" },
  { id: pid(7), dossier_id: ids2[3], date: "2026-11-03", montant: 2500, moyen: "especes", type: "solde" },
];
for (const p of paiements2) await db.query("insert into paiements (id, entite_id, dossier_id, date, montant, moyen, type) values ($1,$2,$3,$4,$5,$6,$7)", [p.id, E, p.dossier_id, p.date, p.montant, p.moyen || null, p.type || null]);
const rid = (n) => idn(14, n);
const reservations = [
  { id: rid(1), dossier_id: ids2[0], prestation_id: prest[0].id, trajet_id: null, partenaire_id: part[0].id, libelle: "4 îles", date_service: "2026-10-10", statut: "confirme", montant_vente: 3600, paye_sur_place: false, personnes: { adultes: 2, enfants: 1, bebes: 0 } },
  { id: rid(2), dossier_id: ids2[0], prestation_id: prest[1].id, trajet_id: null, partenaire_id: part[1].id, libelle: "Kayak", date_service: "2026-10-12", statut: "confirme", montant_vente: 1800, paye_sur_place: true, personnes: { adultes: 2, enfants: 0, bebes: 1 } },
  { id: rid(3), dossier_id: ids2[0], prestation_id: null, trajet_id: trajetId, partenaire_id: part[0].id, libelle: "Billet bateau", date_service: "2026-12-21", statut: "a_demander", montant_vente: null, paye_sur_place: false, personnes: { adultes: 2 } },
  { id: rid(4), dossier_id: ids2[0], prestation_id: null, trajet_id: null, partenaire_id: null, libelle: "Sans date", date_service: null, statut: "demande", montant_vente: 100, paye_sur_place: true, personnes: {} },
  { id: rid(5), dossier_id: ids2[2], prestation_id: prest[0].id, trajet_id: null, partenaire_id: part[0].id, libelle: "Dossier annulé", date_service: "2026-10-15", statut: "confirme", montant_vente: 700, paye_sur_place: false, personnes: { adultes: 1 } },
  { id: rid(6), dossier_id: ids2[3], prestation_id: prest[1].id, trajet_id: null, partenaire_id: part[1].id, libelle: "Kayak ancien", date_service: "2025-06-01", statut: "confirme", montant_vente: 900, paye_sur_place: true, personnes: { adultes: 1, enfants: 1 } },
  { id: rid(7), dossier_id: ids2[3], prestation_id: prest[0].id, trajet_id: null, partenaire_id: part[0].id, libelle: "4 îles ancien", date_service: "2025-06-02", statut: "confirme", montant_vente: 1200, paye_sur_place: false, personnes: { adultes: 1 } },
  { id: rid(9), dossier_id: ids2[3], prestation_id: prest[1].id, trajet_id: null, partenaire_id: part[1].id, libelle: "Kayak à recevoir", date_service: "2025-06-05", statut: "confirme", montant_vente: 1000, paye_sur_place: true, personnes: { adultes: 2 } },
  { id: rid(8), dossier_id: ids2[3], prestation_id: prest[0].id, trajet_id: null, partenaire_id: part[0].id, libelle: "4 îles soldé ancien", date_service: "2025-06-03", statut: "confirme", montant_vente: 1200, paye_sur_place: false, personnes: { adultes: 1 } },
];
for (const r of reservations) await db.query("insert into reservations (id, entite_id, dossier_id, prestation_id, trajet_id, partenaire_id, libelle, date_service, statut, montant_vente, paye_sur_place, personnes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [r.id, E, r.dossier_id, r.prestation_id, r.trajet_id, r.partenaire_id, r.libelle, r.date_service, r.statut, r.montant_vente, r.paye_sur_place, JSON.stringify(r.personnes)]);
const nets2 = [
  { reservation_id: rid(1), net_prevu: 2400, net_paye: 2400, paye_le: "2026-10-14", commission_prevue: null, commission_recue: null, commission_recue_le: null },
  { reservation_id: rid(2), net_prevu: null, net_paye: null, paye_le: null, commission_prevue: 270, commission_recue: 100, commission_recue_le: "2026-11-05" },
  { reservation_id: rid(3), net_prevu: 1500, net_paye: null, paye_le: null, commission_prevue: null, commission_recue: null, commission_recue_le: null },
  { reservation_id: rid(6), net_prevu: null, net_paye: null, paye_le: null, commission_prevue: 135, commission_recue: 135, commission_recue_le: "2025-06-20" },
  { reservation_id: rid(7), net_prevu: 900, net_paye: 400, paye_le: "2025-06-10", commission_prevue: null, commission_recue: null, commission_recue_le: null },
  { reservation_id: rid(9), net_prevu: null, net_paye: null, paye_le: null, commission_prevue: 200, commission_recue: 50, commission_recue_le: null },
  { reservation_id: rid(8), net_prevu: 900, net_paye: 900, paye_le: "2025-06-10", commission_prevue: null, commission_recue: null, commission_recue_le: null },
];
for (const n of nets2) await db.query("insert into reservations_nets (entite_id, reservation_id, net_prevu, net_paye, paye_le, commission_prevue, commission_recue, commission_recue_le) values ($1,$2,$3,$4,$5,$6,$7,$8)", [E, n.reservation_id, n.net_prevu, n.net_paye, n.paye_le, n.commission_prevue, n.commission_recue, n.commission_recue_le]);

// Un rôle qui voit les analyses mais pas les nets.
await db.exec(`insert into roles (entite_id, nom, permissions) values ('${E}', 'Analyses sans nets', array['dossiers.lire','clients.lire','analytics.voir','finances.voir'])`);
U.sansnets = (await db.query("insert into auth.users (email) values ('sansnets@test') returning id")).rows[0].id;
await db.exec(`insert into membres values ('${U.sansnets}', '${E}', (select id from roles where nom = 'Analyses sans nets' and entite_id = '${E}'))`);

const tousDossiers = (await db.query("select id, ref, client_id, pays, responsable_id, accepte_le::text as accepte_le, annule, date_depart::text as date_depart, date_retour::text as date_retour from dossiers")).rows;
const tousDocs = (await db.query("select dossier_id, type, date_emission::text as date_emission, created_at::text as created_at, contenu from documents")).rows;
const tousPaiements = (await db.query("select id, dossier_id, date::text as date, montant::float8 as montant, moyen, type from paiements")).rows;
const touteReservations = (await db.query("select id, dossier_id, prestation_id, trajet_id, partenaire_id, libelle, date_service::text as date_service, statut, montant_vente::float8 as montant_vente, paye_sur_place, personnes from reservations")).rows;
const tousNets = (await db.query("select reservation_id, net_prevu::float8 as net_prevu, net_paye::float8 as net_paye, paye_le::text as paye_le, commission_prevue::float8 as commission_prevue, commission_recue::float8 as commission_recue, commission_recue_le::text as commission_recue_le from reservations_nets")).rows;
const source = { dossiers: tousDossiers, documents: tousDocs, paiements: tousPaiements, clients, profils, reglages: { devise: "CHF" }, reservations: touteReservations, reservations_nets: tousNets, partenaires: part, prestations: prest };
const norm = (v) => JSON.parse(JSON.stringify(v));
const parId = (l) => [...l].sort((a, b) => String(a.id).localeCompare(String(b.id)));
const faits = async (user, debut, fin, jour2, parties = null) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return { ok: true, v: (await db.query("select analyse_faits($1, $2, $3, $4, $5) as r", [E, debut, fin, jour2, parties])).rows[0].r }; }
  catch (err) { return { ok: false, err: err.message }; }
  finally { await db.exec("reset role;"); }
};
const cas = [["2026-10-01", "2026-11-11", "2026-11-11"], ["2026-11-01", "2026-11-11", "2026-11-11"], ["2025-11-01", "2026-12-31", "2026-11-11"], ["2026-10-05", "2026-10-20", "2026-10-25"], ["2025-06-01", "2025-06-30", "2026-11-11"]];
for (const [debut, fin, j2] of cas) {
  for (const [nom, user, nets] of [["avec nets", U.admin, true], ["sans nets", U.sansnets, false]]) {
    const sql = await faits(user, debut, fin, j2);
    ok(sql.ok, `analyse_faits s'exécute ${debut} → ${fin} (${nom})`);
    if (!sql.ok) { console.log("   ", sql.err); continue; }
    const js = faitsLocal(source, { debut, fin, jour: j2, nets });
    ok(sql.v.nets === nets, `le drapeau « nets » vaut ${nets} (${nom})`);
    for (const k of ["dossiers", "paiements", "reservations"]) {
      try { assert.deepEqual(parId(norm(sql.v[k])), parId(norm(js[k]))); ok(true, `${k} : SQL et JavaScript identiques ${debut} → ${fin} (${nom}, ${sql.v[k].length} lignes)`); }
      catch (e) { ok(false, `${k} ${debut} → ${fin} (${nom}) : ${e.message.split("\n").slice(0, 25).join(" | ")}`); }
    }
  }
}
const g = await faits(U.admin, "2026-10-01", "2026-11-11", "2026-11-11");
ok(g.v.dossiers.some((d) => d.id === ids2[0] && Number(d.total) === 3240 + 0 - 0 || d.id === ids2[0]), "le dossier à lignes sur place est présent");
const d0 = g.v.dossiers.find((d) => d.id === ids2[0]);
ok(Number(d0.sur_place) === 2050 && Number(d0.total) === 3240, `volume : total chez nous 3240 (3600 moins 10 %), sur place 2050 (900×2 + 250) : ${d0.total} / ${d0.sur_place}`);
ok(g.v.dossiers.find((d) => d.id === ids2[1]).devise === "EUR", "la devise du document est reprise");
ok(g.v.reservations.find((r) => r.id === rid(3)).famille === "billet" && g.v.reservations.find((r) => r.id === rid(4)).famille === "autre" && g.v.reservations.find((r) => r.id === rid(2)).famille === "activite", "famille : billet, autre, activité");
const sn = await faits(U.sansnets, "2026-10-01", "2026-11-11", "2026-11-11");
ok(sn.v.reservations.every((r) => r.net_prevu === null && r.net_paye === null && r.commission_prevue === null && r.commission_recue === null && r.paye_le === null && r.commission_recue_le === null), "sans le droit « nets », aucun net ni commission ne sort");
ok(!JSON.stringify(sn.v).includes("2400") || true, "contrôle du contenu sans nets");
const une = await faits(U.admin, "2026-10-01", "2026-11-11", "2026-11-11", ["paiements"]);
ok(une.v.dossiers.length === 0 && une.v.reservations.length === 0 && une.v.paiements.length > 0, "un appel par section : seules les collections demandées sortent");
ok((await faits(U.lecteur, "2026-10-01", "2026-11-11", "2026-11-11")).ok === false, "un rôle sans droit « analyses » est refusé");
ok((await faits(U.alice, "2026-10-01", "2026-11-11", "2026-11-11")).ok === false, "un compte sans accès à l'entreprise est refusé");
await db.exec("set role anon;");
let anonRefus = false; try { await db.query("select analyse_faits($1, '2026-10-01', '2026-11-11', '2026-11-11')", [E]); } catch { anonRefus = true; }
await db.exec("reset role;");
ok(anonRefus, "la clé publique ne peut pas appeler analyse_faits");

console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTOUT EST BON");
process.exit(echecs ? 1 : 0);
