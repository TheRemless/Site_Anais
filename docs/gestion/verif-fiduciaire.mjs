// Vérifie les migrations 28 et 36 (factures pour la fiduciaire) sur un Postgres en mémoire : droits, montants, numérotation sans trou, factures figées,
// et surtout que la base et le code de l'outil (cibleAgence) calculent le même montant sur les mêmes cas.
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-fiduciaire.mjs . && GESTION_SQL=<repo>/docs/gestion/ GESTION_SRC=file://<repo>/src/gestion/js/ node verif-fiduciaire.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
const SRC = process.env.GESTION_SRC || "../src/gestion/js/";
const { cibleAgence, aEmettre, libelleFacture, formaterNumero, parDestinataire, partRemise } = await import(SRC + "fiduciaire-calc.mjs");
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
// Une base neuve avec les migrations 18 à `jusqua` (toutes par défaut).
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[23]\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
async function nouvelleBase(jusqua = Infinity) {
  const base = new PGlite();
  await base.exec(harnais);
  await base.exec(fs.readFileSync(W + "schema.sql", "utf8").replace("create extension if not exists pgcrypto;", ""));
  for (const f of migrations.filter((n) => parseInt(n.split("-")[1]) <= jusqua)) await base.exec(fs.readFileSync(W + f, "utf8"));
  return base;
}
const db = await nouvelleBase();
// Pas de « grant execute on all functions » ici : il masquerait les revoke de la migration 28 (le contrôle des fonctions internes en dépend).

const essaie = async (userId, sql, params = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role;"); }
};
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const ent = {};
for (const s of ["ztp", "secret", "taxi"]) ent[s] = (await un("select id from entites where slug = $1", [s])).id;

// Réglages de Secret : de faux coordonnées bancaires, jamais les vraies.
await db.exec(`update reglages set valeur = valeur || '{"devise":"THB","fonctionnement":"excursions","emetteur":{"nom":"Secret Travel & Tour","sous_titre":"by Zwald Travel Planner Co., Ltd.","adresse":"292 Moo 2, 81150, Koh Lanta, Krabi","telephone":"+66 00 000 0000","licence":"34/04000"},"paiement":{"texte":"**Account Name:** Zwald Travel Planner Co., Ltd.\\n**Account Number:** 000-0-00000-0"}}'::jsonb where entite_id = '${ent.secret}'`);
await db.exec(`update reglages set valeur = valeur || '{"devise":"THB","fonctionnement":"taxi","emetteur":{"nom":"VIP Taxi Lanta","adresse":"Koh Lanta"}}'::jsonb where entite_id = '${ent.taxi}'`);

// Personnes : Mook (prépare, ne voit pas les nets), Anaïs (gère, voit les nets), un lecteur sans droit, une personne limitée à Taxi.
const U = {};
for (const k of ["root", "mook", "anais", "lecteur", "taxiste"]) U[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
const lectureBase = ["clients.lire", "dossiers.lire", "finances.voir", "partenaires.lire"];
for (const s of ["secret", "taxi"]) {
  await db.exec(`insert into roles (entite_id, nom, portee, permissions) values
    ('${ent[s]}', 'Assistante', 'toute', array['${[...lectureBase, "dossiers.ecrire", "fiduciaire.preparer"].join("','")}']),
    ('${ent[s]}', 'Responsable', 'toute', array['${[...lectureBase, "dossiers.ecrire", "partenaires.nets", "fiduciaire.preparer", "fiduciaire.gerer"].join("','")}'])`);
}
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Limitée', 'mes_dossiers', array['${[...lectureBase, "dossiers.ecrire", "fiduciaire.preparer"].join("','")}'])`);
U.limitee = (await un("insert into auth.users (email) values ('limitee@test') returning id")).id;
const membre = (u, s, role) => db.exec(`insert into membres values ('${U[u]}', '${ent[s]}', (select id from roles where entite_id = '${ent[s]}' and nom = '${role}'))`);
await membre("mook", "secret", "Assistante"); await membre("mook", "taxi", "Assistante");
await membre("anais", "secret", "Responsable"); await membre("anais", "taxi", "Responsable");
await membre("lecteur", "secret", "Lecteur");
await membre("taxiste", "taxi", "Assistante");
await membre("limitee", "secret", "Limitée");

// Données.
const cli = (await un("insert into clients (entite_id, prenom, nom) values ($1, 'Jane', 'Example') returning id", [ent.secret])).id;
const cliT = (await un("insert into clients (entite_id, prenom, nom) values ($1, 'Tom', 'Sample') returning id", [ent.taxi])).id;
const part = async (e, nom, adresse) => (await un("insert into partenaires (entite_id, nom, contact) values ($1, $2, $3) returning id", [ent[e], nom, JSON.stringify(adresse ? { adresse } : {})])).id;
const rattana = await part("secret", "Rattana Tour Co., Ltd.", "1 Moo 2, Koh Lanta, Krabi 81150");
const sansAdresse = await part("secret", "Provider Without Address", "");
const vip = await part("taxi", "VIP Taxi Lanta", "5 Moo 1, Koh Lanta, Krabi 81150");
let nd = 0;
const dossier = async (e, client, total, paye, datePaiement = "2026-11-08") => {
  const d = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, $2, $3) returning id", [ent[e], `INV-2026-${String(++nd).padStart(3, "0")}`, client])).id;
  if (total) await db.exec(`insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ('${ent[e]}', '${d}', 'facture', '2026-11-01', '{"devise":"THB","lignes":[{"id":"l1","kind":"ligne","libelle":"x","unite":${total},"qte":1}]}')`);
  if (paye) await db.exec(`insert into paiements (entite_id, dossier_id, date, montant) values ('${ent[e]}', '${d}', '${datePaiement}', ${paye})`);
  return d;
};
const resa = async (e, d, p, libelle, o = {}) => {
  const r = (await un("insert into reservations (entite_id, dossier_id, partenaire_id, libelle, date_service, montant_vente, paye_sur_place, statut) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
    [ent[e], d, p, libelle, o.date || "2026-11-10", o.vente ?? 3000, !!o.surPlace, o.statut || "confirme"])).id;
  await db.query("insert into reservations_nets (entite_id, reservation_id, net_prevu, net_paye, paye_le, commission_prevue, commission_recue, commission_recue_le) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [ent[e], r, o.netPrevu ?? null, o.netPaye ?? null, o.payeLe ?? null, o.comPrevue ?? null, o.comRecue ?? null, o.comLe ?? null]);
  return r;
};
const R = {};
R.surPlace = await resa("secret", await dossier("secret", cli, 0, 0), rattana, "Longtail 4 Islands", { surPlace: true, comPrevue: 300, comRecue: 300, comLe: "2026-11-12" });
R.partielle = await resa("secret", await dossier("secret", cli, 0, 0), rattana, "Koh Rok", { surPlace: true, comPrevue: 300, comRecue: 200, comLe: "2026-11-10" });
R.pasRecue = await resa("secret", await dossier("secret", cli, 0, 0), rattana, "Phi Phi", { surPlace: true, comPrevue: 300 });
R.sansDate = await resa("secret", await dossier("secret", cli, 0, 0), rattana, "Hong Islands", { surPlace: true, comPrevue: 300, comRecue: 300 });
R.chezNous = await resa("secret", await dossier("secret", cli, 3000, 3000, "2026-11-08"), rattana, "Private longtail", { netPrevu: 2400, netPaye: 2500, payeLe: "2026-11-09" });
R.nonSolde = await resa("secret", await dossier("secret", cli, 3000, 1000), rattana, "Sunset cruise", { netPaye: 2500, payeLe: "2026-11-09" });
R.prestaPasPaye = await resa("secret", await dossier("secret", cli, 3000, 3000), rattana, "Mangrove kayak", { netPrevu: 2400 });
R.perte = await resa("secret", await dossier("secret", cli, 3000, 3000), rattana, "Cooking class", { netPaye: 3200, payeLe: "2026-11-09" });
R.annule = await resa("secret", await dossier("secret", cli, 3000, 3000), rattana, "Snorkel", { statut: "annule", netPaye: 2500, payeLe: "2026-11-09" });
R.aucunNet = await resa("secret", await dossier("secret", cli, 3000, 3000), rattana, "Minivan", {});
R.sansAdresse = await resa("secret", await dossier("secret", cli, 0, 0), sansAdresse, "Elephant care", { surPlace: true, comPrevue: 100, comRecue: 100, comLe: "2026-11-12" });
R.taxi = await resa("taxi", await dossier("taxi", cliT, 0, 0), vip, "Airport to Kantiang", { surPlace: true, vente: 1200, comPrevue: 100, comRecue: 100, comLe: "2026-11-11" });

console.log("Calcul : la base et le code de l'outil donnent la même chose");
const entreeJs = async (id) => {
  const r = await un("select * from reservations where id = $1", [id]);
  const n = (await un("select * from reservations_nets where reservation_id = $1", [id])) || null;
  const rs = await un("select * from dossiers_resume where dossier_id = $1", [r.dossier_id]);
  const dp = await un("select max(date)::text d from paiements where dossier_id = $1", [r.dossier_id]);
  // Comme fiduciaire-local.mjs : « déjà facturé » au prestataire actuel, part de la remise de la facture du client, dossier annulé.
  const p = (await un("select id, nom from partenaires where id = $1 and entite_id = $2", [r.partenaire_id, r.entite_id])) || null;
  const factures = (await db.query("select montant, destinataire_id, destinataire from fiduciaire_factures where reservation_id = $1", [id])).rows.map((f) => ({ ...f, montant: Number(f.montant) }));
  const deja = parDestinataire(factures, p).deja;
  const ids = [r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean);
  const docs = (await db.query("select contenu from documents where dossier_id = $1 and type = 'facture' order by date_emission desc, created_at desc", [r.dossier_id])).rows;
  const doc = docs.find((x) => ((x.contenu || {}).lignes || []).some((l) => ids.includes(l.id)));
  const annule = (await un("select annule from dossiers where id = $1", [r.dossier_id])).annule;
  const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  const vente = r.montant_vente === null ? null : Number(r.montant_vente);
  const reservation = { statut: r.statut, paye_sur_place: r.paye_sur_place, montant_vente: vente, remise: doc ? partRemise(doc.contenu, ids, vente) : 0, dossier_annule: annule };
  const net = { net_paye: n.net_paye === null ? null : Number(n.net_paye), paye_le: iso(n.paye_le), commission_prevue: n.commission_prevue === null ? null : Number(n.commission_prevue), commission_recue: n.commission_recue === null ? null : Number(n.commission_recue), commission_recue_le: iso(n.commission_recue_le) };
  const paiement = rs ? { regle: Number(rs.total) > 0 && Number(rs.recu) >= Number(rs.total), date: dp.d } : null;
  return { reservation, net, paiement, deja };
};
const compare = async (nom) => {
  const id = R[nom];
  const e = await entreeJs(id);
  const js = cibleAgence(e.reservation, e.net, e.paiement, e.deja);
  const b = await un("select * from fiduciaire_cible($1)", [id]);
  const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  const memes = (e.reservation.paye_sur_place || e.reservation.statut === "annule" || e.reservation.dossier_annule || e.reservation.remise === Number(b.remise)) && js.cas === b.cas && js.cible === Number(b.cible) && js.date === iso(b.date_cible) && js.pret === b.pret && JSON.stringify(js.manque) === JSON.stringify(b.manque) && (js.ecart === null ? b.ecart === null : js.ecart === Number(b.ecart)) && js.a_revoir === b.a_revoir && e.deja === Number(b.deja);
  ok(memes, `${nom} : ${JSON.stringify({ cas: b.cas, cible: Number(b.cible), date: iso(b.date_cible), pret: b.pret, manque: b.manque })}${memes ? "" : " / code : " + JSON.stringify(js)}`);
  return { js, b };
};
const attendu = { surPlace: [300, true], partielle: [200, true], pasRecue: [0, false], sansDate: [0, false], chezNous: [500, true], nonSolde: [0, false], prestaPasPaye: [0, false], perte: [0, false], annule: [0, false], aucunNet: [0, false], taxi: [100, true] };
for (const nom of Object.keys(attendu)) {
  const { b } = await compare(nom);
  ok(Number(b.cible) === attendu[nom][0] && b.pret === attendu[nom][1], `${nom} : montant ${attendu[nom][0]}, prêt ${attendu[nom][1]}`);
}

console.log("Droits");
const lecteurListe = await essaie(U.lecteur, "select * from fiduciaire_a_preparer()");
ok(lecteurListe.ok && lecteurListe.rows.length === 0, "un lecteur sans le droit ne voit rien à préparer");
ok((await essaie(U.lecteur, `select emettre_facture_fiduciaire('${R.surPlace}')`)).ok === false, "un lecteur ne peut pas émettre");
const mookListe = await essaie(U.mook, "select * from fiduciaire_a_preparer()");
const parRes = Object.fromEntries(mookListe.rows.map((x) => [x.reservation_id, x]));
ok(mookListe.ok && parRes[R.surPlace] && Number(parRes[R.surPlace].montant) === 300 && parRes[R.surPlace].type === "facture", "Mook voit le service sur place à 300");
ok(parRes[R.chezNous] && Number(parRes[R.chezNous].montant) === 500, "Mook voit la marge à facturer (500), sans le détail du calcul");
ok(!parRes[R.nonSolde] && !parRes[R.pasRecue] && !parRes[R.perte], "rien pour un client non soldé, une commission non reçue, une marge négative");
ok(mookListe.rows.every((x) => x.ecart === null), "Mook ne voit aucun écart avec la commission prévue (donnée des nets)");
ok(!JSON.stringify(mookListe.rows.map(({ reservation_id, entite_id, ...reste }) => reste)).match(/2400|2500|3200/), "aucun net dans ce que Mook reçoit (les identifiants mis à part)");
ok((await essaie(U.mook, "select * from reservations_nets")).rows.length === 0, "Mook ne lit toujours pas les nets");
const anaisListe = await essaie(U.anais, "select * from fiduciaire_a_preparer()");
ok(anaisListe.rows.find((x) => x.reservation_id === R.partielle && Number(x.ecart) === -100), "Anaïs voit l'écart de la commission partielle (−100)");
ok((await essaie(U.mook, `select fiduciaire_calcul('${R.chezNous}')`)).ok === false, "Mook ne peut pas revoir le calcul");
const calcul = await essaie(U.anais, `select fiduciaire_calcul('${R.chezNous}') j`);
ok(calcul.ok && calcul.rows[0].j.net_paye === 2500 && calcul.rows[0].j.cible === 500, "Anaïs revoit le calcul avec le net payé");
ok((await essaie(U.mook, `insert into fiduciaire_factures (entite_id, entite_slug, type, annee, seq, numero, date_facture, montant, devise, libelle, cas, destinataire, emetteur) values ('${ent.secret}', 'secret', 'facture', 2026, 99, 'COM-2026-099', '2026-11-12', 99999, 'THB', 'x', 'sur_place', '{}', '{}')`)).ok === false, "Mook ne peut pas écrire un montant de son choix");
ok((await essaie(U.taxiste, `select emettre_facture_fiduciaire('${R.surPlace}')`)).ok === false, "le droit de Taxi n'ouvre pas Secret");

console.log("Administrateur général");
await db.exec(`insert into profils (user_id, email, nom, super_admin, actif) values ('${U.root}', 'root@test', 'Root', true, true) on conflict (user_id) do update set super_admin = true, actif = true`);
ok((await essaie(U.root, "select toutes_permissions() t")).rows[0].t.includes("fiduciaire.gerer"), "« tous les droits » comprend les deux droits fiduciaire");
ok((await essaie(U.root, "select count(*)::int n from fiduciaire_a_preparer()")).rows[0].n >= 4, "un administrateur général voit ce qu'il y a à préparer");

console.log("Émission et numérotation");
const e1 = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.surPlace}') id`);
ok(e1.ok, "Mook émet la facture d'un service sur place");
const f1 = await un("select * from fiduciaire_factures where id = $1", [e1.rows[0].id]);
ok(f1.numero === "COM-2026-001" && f1.numero === formaterNumero("facture", 2026, 1), "premier numéro COM-2026-001, même format que le code");
ok(Number(f1.montant) === 300 && f1.date_facture.toISOString().slice(0, 10) === "2026-11-12", "montant 300, daté du jour de réception");
ok(f1.destinataire.nom === "Rattana Tour Co., Ltd." && f1.destinataire.adresse.startsWith("1 Moo 2"), "adressée à l'entreprise prestataire, nom et adresse de la base");
ok(f1.emetteur.emetteur.licence === "34/04000" && /Account Name/.test(f1.emetteur.paiement.texte), "l'émetteur et le compte bancaire de Secret sont copiés sur la facture");
const dossierRef = (await un("select d.ref from reservations r join dossiers d on d.id = r.dossier_id where r.id = $1", [R.surPlace])).ref;
ok(f1.libelle === libelleFacture({ libelle: "Longtail 4 Islands", date_service: "2026-11-10" }, { dossierRef, prenom: "Jane", nom: "Example" }), "libellé identique à celui du code : " + f1.libelle);
ok(!/Jane|Example/.test(f1.libelle), "le nom du client n'est pas sur la facture, seulement ses initiales");
ok((await essaie(U.mook, `select emettre_facture_fiduciaire('${R.surPlace}')`)).ok === false, "deuxième clic : pas de doublon");

const echec = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.sansAdresse}')`);
ok(echec.ok === false && /Provider Without Address/.test(echec.err), "sans adresse du destinataire : refus qui nomme le prestataire");
const e2 = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.chezNous}') id`);
const f2 = await un("select * from fiduciaire_factures where id = $1", [e2.rows[0].id]);
ok(f2.numero === "COM-2026-002" && Number(f2.montant) === 500 && f2.cas === "chez_nous", "l'émission refusée n'a pas consommé de numéro : COM-2026-002, marge 500");
ok(f2.date_facture.toISOString().slice(0, 10) === "2026-11-09", "marge datée du plus tardif des deux paiements (2026-11-09)");
const e3 = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.partielle}') id`);
ok(e3.ok && Number((await un("select montant from fiduciaire_factures where id = $1", [e3.rows[0].id])).montant) === 200, "commission partielle : 200 facturés");
// Taxi sort de la fiduciaire (décision du 17.11.2026) : rien à préparer, rien à émettre, tant que le réglage « actif » n'est pas coché.
ok(!(await essaie(U.mook, "select * from fiduciaire_a_preparer()")).rows.some((x) => x.reservation_id === R.taxi), "Taxi : la course n'est pas proposée");
const taxiRefus = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.taxi}') id`);
ok(taxiRefus.ok === false && /n'émet pas de factures pour la fiduciaire/.test(taxiRefus.err), "Taxi : l'émission est refusée avec un message clair");
await db.exec(`update reglages set valeur = valeur || '{"fiduciaire":{"actif":true}}'::jsonb where entite_id = '${ent.taxi}'`);
const e4 = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.taxi}') id`);
const f4 = e4.ok ? await un("select * from fiduciaire_factures where id = $1", [e4.rows[0].id]) : null;
ok(e4.ok && f4.entite_slug === "taxi" && f4.destinataire.nom === "VIP Taxi Lanta" && f4.emetteur.emetteur.nom === "VIP Taxi Lanta" && f4.destinataire_id === vip, "Taxi réactivé par le réglage : facture émise par l'entreprise du service, adressée à VIP Taxi Lanta");
await db.exec(`update reglages set valeur = valeur || '{"fiduciaire":{"actif":false}}'::jsonb where entite_id = '${ent.taxi}'`);
ok((await essaie(U.mook, `select emettre_facture_fiduciaire('${R.nonSolde}')`)).ok === false, "client non soldé : rien à émettre");

console.log("Complément, avoir, correction");
await db.exec(`update reservations_nets set commission_recue = 300, commission_recue_le = '2026-11-12' where reservation_id = '${R.partielle}'`);
await compare("partielle");
const e5 = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.partielle}') id`);
const f5 = e5.ok ? await un("select * from fiduciaire_factures where id = $1", [e5.rows[0].id]) : null;
ok(e5.ok && Number(f5.montant) === 100 && f5.date_facture.toISOString().slice(0, 10) === "2026-11-12", "le complément reçu plus tard : une facture de 100 datée de sa réception (le 12)");
await db.exec(`update reservations_nets set commission_recue = 250 where reservation_id = '${R.surPlace}'`);
const { js: jsAvoir } = await compare("surPlace");
ok(aEmettre(jsAvoir, 300).type === "avoir", "commission corrigée à 250 : le code dit « avoir de 50 »");
ok((await essaie(U.mook, `select emettre_facture_fiduciaire('${R.surPlace}')`)).ok === false, "Mook n'émet pas d'avoir");
const av = await essaie(U.anais, `select emettre_facture_fiduciaire('${R.surPlace}') id`);
const fav = av.ok ? await un("select * from fiduciaire_factures where id = $1", [av.rows[0].id]) : null;
ok(av.ok && fav.numero === formaterNumero("avoir", fav.annee, 1) && Number(fav.montant) === -50 && fav.avoir_de === f1.id && fav.avoir_de_numero === "COM-2026-001", "Anaïs émet l'avoir CN-…-001 de −50 qui renvoie à COM-2026-001");
ok((await essaie(U.anais, `select emettre_facture_fiduciaire('${R.surPlace}')`)).ok === false, "après l'avoir, le total facturé est juste : rien d'autre à émettre");
await db.exec(`update reservations set statut = 'annule' where id = '${R.chezNous}'`);
await compare("chezNous");
const av2 = await essaie(U.anais, `select emettre_facture_fiduciaire('${R.chezNous}') id`);
ok(av2.ok && Number((await un("select montant from fiduciaire_factures where id = $1", [av2.rows[0].id])).montant) === -500, "remboursement : annulé après facture, avoir de −500");

console.log("Date de départ");
R.ancienne = await resa("secret", await dossier("secret", cli, 0, 0), rattana, "Ancienne excursion", { surPlace: true, date: "2025-03-01", comPrevue: 100, comRecue: 100, comLe: "2025-03-10" });
ok((await essaie(U.mook, "select * from fiduciaire_a_preparer()")).rows.some((x) => x.reservation_id === R.ancienne), "sans date de départ, une ancienne commission est proposée");
await db.exec(`update reglages set valeur = valeur || '{"fiduciaire":{"depuis":"2026-11-01"}}'::jsonb where entite_id = '${ent.secret}'`);
ok(!(await essaie(U.mook, "select * from fiduciaire_a_preparer()")).rows.some((x) => x.reservation_id === R.ancienne), "avec une date de départ au 1er novembre 2026, elle n'est plus proposée");
const tropVieux = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.ancienne}')`);
ok(tropVieux.ok === false && /date de départ/.test(tropVieux.err), "et elle ne s'émet pas non plus");

console.log("Factures figées");
const fige = async (sql) => { try { await db.exec(sql); return false; } catch (e) { return true; } };
ok(await fige(`update fiduciaire_factures set montant = 1 where id = '${f1.id}'`), "même avec tous les droits de la base, le montant ne se modifie pas");
ok(await fige(`update fiduciaire_factures set numero = 'COM-2026-777' where id = '${f1.id}'`), "ni le numéro");
ok(await fige(`update fiduciaire_factures set destinataire = '{}' where id = '${f1.id}'`), "ni le destinataire");
ok(await fige(`delete from fiduciaire_factures where id = '${f1.id}'`), "ni la suppression");
ok(await fige("truncate fiduciaire_factures"), "ni le vidage");
ok((await essaie(U.anais, `update fiduciaire_factures set montant = 1 where id = '${f1.id}'`)).ok === false, "le navigateur n'a aucun droit d'écriture direct");
const suite = await un("select count(*)::int n, max(seq) filter (where type = 'facture') m from fiduciaire_factures");
ok(suite.n === 7 && suite.m === 5, "7 documents émis, factures 1 à 5 sans trou");

console.log("Envoi à la fiduciaire");
ok((await essaie(U.mook, `select marquer_envoyee_fiduciaire(array['${f1.id}','${f2.id}']::uuid[], '2026-11-12') n`)).rows[0].n === 2, "Mook marque deux factures envoyées le 12 novembre");
ok((await un("select envoyee_le::text d from fiduciaire_factures where id = $1", [f1.id])).d === "2026-11-12", "la date est enregistrée");
ok((await essaie(U.mook, `select marquer_envoyee_fiduciaire(array['${f1.id}']::uuid[], null)`)).ok === false, "Mook ne retire pas la mention d'envoi");
ok((await essaie(U.anais, `select marquer_envoyee_fiduciaire(array['${f1.id}']::uuid[], null) n`)).ok, "Anaïs peut la retirer");
ok((await essaie(U.taxiste, `select marquer_envoyee_fiduciaire(array['${f1.id}']::uuid[], '2026-11-12')`)).ok === false, "le droit de Taxi n'ouvre pas les factures de Secret");
const listeMook = await essaie(U.mook, "select numero, entite_slug from fiduciaire_factures order by numero");
ok(listeMook.ok && listeMook.rows.length === 7, "Mook lit les 7 documents (Secret et Taxi)");
ok((await essaie(U.taxiste, "select numero from fiduciaire_factures")).rows.length === 1, "la personne limitée à Taxi ne lit que la facture de Taxi");


console.log("Corrections après relecture");
const J = async (n) => (await un("select (current_date + $1::int)::text d", [n])).d;
// Fonctions internes : fermées aux utilisateurs connectés.
const internes = { fiduciaire_cible: `'${R.surPlace}'`, fiduciaire_libelle: `'${R.surPlace}'`, fiduciaire_depuis: `'${ent.secret}'`, fiduciaire_emetteur: `'${ent.secret}'`, fiduciaire_initiales: "'x'", fiduciaire_date_en: "current_date",
  fiduciaire_reglages: `'${ent.secret}'`, fiduciaire_concernee: `'${ent.secret}'`, fiduciaire_texte: "'a', 'b'", remise_reservation: `'${R.surPlace}'` };
for (const f of Object.keys(internes)) {
  const args = internes[f];
  const r = await essaie(U.anais, `select ${f}(${args})`);
  ok(r.ok === false && /permission denied/i.test(r.err), `${f} n'est pas appelable par un utilisateur connecté`);
}
ok((await essaie(U.anais, "select fiduciaire_prochain_numero('facture', current_date, 'COM')")).ok === false, "fiduciaire_prochain_numero non plus");
ok((await essaie(null, "select * from fiduciaire_a_preparer()")).ok === false || (await essaie(null, "select * from fiduciaire_a_preparer()")).rows.length === 0, "sans connexion, rien à préparer");

// Périmètre « mes dossiers » : la personne limitée ne voit que les services de ses dossiers.
R.attendu = await resa("secret", await dossier("secret", cli, 0, 0), rattana, "Mangrove walk", { surPlace: true, comPrevue: 60, comRecue: 60, comLe: await J(-1) });
ok((await essaie(U.limitee, "select * from fiduciaire_a_preparer()")).rows.length === 0, "un rôle limité à ses dossiers ne voit rien qu'il n'a pas créé");
await db.exec(`update dossiers set cree_par = '${U.limitee}' where id = (select dossier_id from reservations where id = '${R.attendu}')`);
const lim = await essaie(U.limitee, "select * from fiduciaire_a_preparer()");
ok(lim.rows.length === 1 && lim.rows[0].reservation_id === R.attendu, "il voit ensuite les services de son dossier, et seulement eux");
ok((await essaie(U.limitee, `select emettre_facture_fiduciaire('${R.pasRecue}')`)).ok === false, "et n'émet pas pour le dossier d'un autre");

// Garde-fou : l'écran affichait un complément, la situation a changé.
const perime = await essaie(U.limitee, `select emettre_facture_fiduciaire('${R.attendu}', null, 'avoir')`);
ok(perime.ok === false && /a changé/.test(perime.err), "un type attendu qui ne correspond plus refuse l'émission");
const frais = await essaie(U.limitee, `select emettre_facture_fiduciaire('${R.attendu}', null, 'facture') id`);
ok(frais.ok, "avec le bon type attendu, elle part");
const lfr = (await essaie(U.limitee, "select numero from fiduciaire_factures")).rows;
ok(lfr.length === 1, "la personne limitée ne lit que la facture de son dossier");

// Dates : jamais dans le futur.
R.futur = await resa("secret", await dossier("secret", cli, 0, 0), rattana, "Future tour", { surPlace: true, comPrevue: 70, comRecue: 70, comLe: await J(5) });
const futur = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.futur}')`);
ok(futur.ok === false && /futur/.test(futur.err), "une date de réception à venir (faute de frappe) ne s'émet pas");
ok((await essaie(U.mook, `select marquer_envoyee_fiduciaire(array['${f4.id}']::uuid[], '${await J(3)}')`)).ok === false, "une date d'envoi à venir est refusée");
const dejaEnvoyee = await essaie(U.mook, `select marquer_envoyee_fiduciaire(array['${f2.id}']::uuid[], '${await J(-1)}')`);
ok(dejaEnvoyee.ok === false && /responsables/.test(dejaEnvoyee.err), "une date d'envoi déjà posée ne se réécrit pas sans « gérer »");
ok((await essaie(U.anais, `select marquer_envoyee_fiduciaire(array['${f2.id}']::uuid[], '${await J(-1)}') n`)).ok, "un responsable peut la corriger");
const avoirFutur = await essaie(U.anais, `select annuler_facture_fiduciaire('${R.partielle}', '${await J(2)}')`);
ok(avoirFutur.ok === false && /entre la date/.test(avoirFutur.err), "un avoir ne se date pas dans le futur");

// Destinataire d'une autre entreprise : jamais copié.
const vipSecret = await resa("taxi", await dossier("taxi", cliT, 0, 0), rattana, "Mauvais partenaire", { surPlace: true, vente: 900, comPrevue: 90, comRecue: 90, comLe: "2026-11-11" });
await db.exec(`update reglages set valeur = valeur || '{"fiduciaire":{"actif":true}}'::jsonb where entite_id = '${ent.taxi}'`);
const croise = await essaie(U.taxiste, `select emettre_facture_fiduciaire('${vipSecret}')`);
await db.exec(`update reglages set valeur = valeur || '{"fiduciaire":{"actif":false}}'::jsonb where entite_id = '${ent.taxi}'`);
ok(croise.ok === false && /pas de prestataire/.test(croise.err), "un partenaire d'une autre entreprise n'est pas reconnu comme destinataire");
ok((await essaie(U.taxiste, "select * from fiduciaire_a_preparer()")).rows.every((x) => x.reservation_id !== vipSecret || x.destinataire_nom === null), "et son nom ne fuit pas dans la liste");

// L'émetteur copié ne contient que ce qu'affiche une facture.
await db.exec(`update reglages set valeur = jsonb_set(jsonb_set(valeur, '{emetteur,cle_interne}', '"interne"'), '{paiement,secret}', '"jeton"') where entite_id = '${ent.secret}'`);
R.emetteur = await resa("secret", await dossier("secret", cli, 0, 0), rattana, "Copie émetteur", { surPlace: true, comPrevue: 40, comRecue: 40, comLe: await J(-1) });
const ee = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.emetteur}') id`);
const fe = await un("select emetteur from fiduciaire_factures where id = $1", [ee.rows[0].id]);
ok(!JSON.stringify(fe.emetteur).match(/interne|jeton/) && fe.emetteur.emetteur.licence === "34/04000" && /Account Name/.test(fe.emetteur.paiement.texte), "seules les clés d'affichage de l'émetteur et du paiement sont copiées");

// Une commission reprise après facture : plus de calcul possible, l'avoir total reste possible.
R.reprise = await resa("secret", await dossier("secret", cli, 0, 0), rattana, "Commission reprise", { surPlace: true, comPrevue: 100, comRecue: 100, comLe: await J(-2) });
const er = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.reprise}') id`);
ok(er.ok, "facture de 100 émise");
await db.exec(`update reservations_nets set commission_recue = 0 where reservation_id = '${R.reprise}'`);
ok((await essaie(U.anais, `select emettre_facture_fiduciaire('${R.reprise}')`)).ok === false, "la commission étant reprise, le calcul ne propose plus rien");
const rowRevoir = (await essaie(U.anais, "select * from fiduciaire_a_preparer()")).rows.find((x) => x.reservation_id === R.reprise);
ok(rowRevoir && rowRevoir.a_revoir && Number(rowRevoir.deja_facture) === 100, "la ligne reste « à revoir », avec les 100 déjà facturés");
ok((await essaie(U.mook, `select annuler_facture_fiduciaire('${R.reprise}')`)).ok === false, "Mook n'annule pas par un avoir");
const an = await essaie(U.anais, `select annuler_facture_fiduciaire('${R.reprise}') id`);
const fan = an.ok ? await un("select * from fiduciaire_factures where id = $1", [an.rows[0].id]) : null;
ok(an.ok && Number(fan.montant) === -100 && fan.type === "avoir" && fan.destinataire.nom === "Rattana Tour Co., Ltd.", "Anaïs annule par un avoir de −100, exactement ce qui était facturé");
ok((await essaie(U.anais, `select annuler_facture_fiduciaire('${R.reprise}')`)).ok === false, "un second avoir est refusé : le total est déjà à zéro");

// Service supprimé alors qu'il était facturé.
R.supprime = await resa("secret", await dossier("secret", cli, 0, 0), rattana, "Service supprimé", { surPlace: true, comPrevue: 80, comRecue: 80, comLe: await J(-2) });
await essaie(U.mook, `select emettre_facture_fiduciaire('${R.supprime}')`);
await db.exec(`delete from reservations where id = '${R.supprime}'`);
const orphelin = (await essaie(U.anais, "select * from fiduciaire_a_preparer()")).rows.find((x) => x.reservation_id === R.supprime);
ok(orphelin && orphelin.a_revoir && orphelin.manque.includes("service_supprime") && Number(orphelin.deja_facture) === 80, "un service supprimé encore facturé est listé pour les responsables");
ok(!(await essaie(U.mook, "select * from fiduciaire_a_preparer()")).rows.some((x) => x.reservation_id === R.supprime), "mais pas pour l'assistante");
ok((await essaie(U.anais, `select annuler_facture_fiduciaire('${R.supprime}') id`)).ok, "l'avoir s'émet même sans le service");

console.log("Lot H : remise, dossier annulé, destinataire, réglages, QR figé");
// Remise : 10 % sur la facture du client, la marge baisse de la part du service.
const dossierRemise = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, 'INV-2026-R01', $2) returning id", [ent.secret, cli])).id;
await db.exec(`insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ('${ent.secret}', '${dossierRemise}', 'facture', '2026-11-01', '{"devise":"THB","lignes":[{"id":"lr1","kind":"ligne","libelle":"Private longtail","unite":3000,"qte":1},{"id":"lr2","kind":"ligne","libelle":"Park fee","unite":400,"qte":1,"paye_sur_place":true},{"id":"lr3","kind":"remise","libelle":"Discount","pct":10}]}')`);
await db.exec(`insert into paiements (entite_id, dossier_id, date, montant) values ('${ent.secret}', '${dossierRemise}', '2026-11-08', 2700)`);
R.remise = (await un("insert into reservations (entite_id, dossier_id, partenaire_id, libelle, date_service, montant_vente, ligne_id) values ($1, $2, $3, 'Private longtail', '2026-11-10', 3000, 'lr1') returning id", [ent.secret, dossierRemise, rattana])).id;
await db.query("insert into reservations_nets (entite_id, reservation_id, net_paye, paye_le) values ($1, $2, 2500, '2026-11-09')", [ent.secret, R.remise]);
const { b: bRemise } = await compare("remise");
ok(Number(bRemise.cible) === 200 && Number(bRemise.remise) === 300, "remise de 10 % : marge 3000 − 300 − 2500 = 200, comme le code");
const eRem = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.remise}') id`);
const fRem = eRem.ok ? await un("select * from fiduciaire_factures where id = $1", [eRem.rows[0].id]) : null;
ok(eRem.ok && Number(fRem.montant) === 200 && fRem.libelle.startsWith("Margin on Private longtail"), "facture de 200, libellé « Margin on »");
ok(fRem.libelle === libelleFacture({ libelle: "Private longtail", date_service: "2026-11-10" }, { dossierRef: "INV-2026-R01", prenom: "Jane", nom: "Example", cas: "chez_nous" }), "libellé identique au code : " + fRem.libelle);
const calcRem = await essaie(U.anais, `select fiduciaire_calcul('${R.remise}') j`);
ok(calcRem.ok && calcRem.rows[0].j.remise === 300, "« Revoir le calcul » montre la part de la remise");

// Dossier annulé, réservation restée confirmée : plus de marge, l'avoir est proposé.
await db.exec(`update dossiers set annule = true where id = '${dossierRemise}'`);
const { js: jsAnnule } = await compare("remise");
ok(aEmettre(jsAnnule, 200).type === "avoir", "dossier annulé : le code propose l'avoir de 200");
const ligneAnnule = (await essaie(U.anais, "select * from fiduciaire_a_preparer()")).rows.find((x) => x.reservation_id === R.remise);
ok(ligneAnnule && ligneAnnule.type === "avoir" && Number(ligneAnnule.montant) === 200, "la base aussi : avoir de 200 à préparer");
await db.exec(`update dossiers set annule = false where id = '${dossierRemise}'`);

// Le prestataire change après facture : le nouveau reçoit tout, l'ancien garde sa facture jusqu'à l'avoir.
const nouveauPresta = await part("secret", "New Boat Co.", "3 Moo 1, Koh Lanta, Krabi 81150");
await db.exec(`update reservations set partenaire_id = '${nouveauPresta}' where id = '${R.remise}'`);
await compare("remise");
const apresChange = (await essaie(U.anais, "select * from fiduciaire_a_preparer()")).rows.filter((x) => x.reservation_id === R.remise);
const pourNouveau = apresChange.find((x) => x.type === "facture");
const pourAncien = apresChange.find((x) => (x.manque || []).includes("partenaire_change"));
ok(pourNouveau && Number(pourNouveau.montant) === 200 && pourNouveau.destinataire_nom === "New Boat Co.", "nouveau prestataire : le montant entier (200), pas la différence");
ok(pourAncien && Number(pourAncien.deja_facture) === 200 && pourAncien.destinataire_nom === "Rattana Tour Co., Ltd." && pourAncien.destinataire_cle === rattana, "ancien prestataire : à revoir, avec ses 200 déjà facturés");
ok(!(await essaie(U.mook, "select * from fiduciaire_a_preparer()")).rows.some((x) => (x.manque || []).includes("partenaire_change")), "l'assistante ne voit pas l'avoir à l'ancien");
const eNouv = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.remise}') id`);
ok(eNouv.ok && (await un("select destinataire_id from fiduciaire_factures where id = $1", [eNouv.rows[0].id])).destinataire_id === nouveauPresta, "facture au nouveau prestataire émise");
const ambigu = await essaie(U.anais, `select annuler_facture_fiduciaire('${R.remise}')`);
ok(ambigu.ok === false && /plusieurs prestataires/.test(ambigu.err), "deux destinataires : l'avoir demande lequel");
const avAncien = await essaie(U.anais, `select annuler_facture_fiduciaire('${R.remise}', null, '${rattana}') id`);
const fAvAncien = avAncien.ok ? await un("select * from fiduciaire_factures where id = $1", [avAncien.rows[0].id]) : null;
ok(avAncien.ok && Number(fAvAncien.montant) === -200 && fAvAncien.destinataire_id === rattana && fAvAncien.avoir_de === fRem.id, "avoir de −200 à l'ancien, qui renvoie à sa facture");
ok(!(await essaie(U.anais, "select * from fiduciaire_a_preparer()")).rows.some((x) => x.reservation_id === R.remise), "tout est juste : plus rien pour ce service");

// Réglages : préfixe, titres, mots ; QR figé (il vient de reglages.apparence).
await db.exec(`update reglages set valeur = valeur || '{"apparence":{"qr_image":"data:image/png;base64,QR1","qr_pseudo":"@secret"},"fiduciaire":{"depuis":"2026-11-01","prefixe_facture":"SEC","titre_facture":"TAX INVOICE","mot_commission":"Agency commission on"}}'::jsonb where entite_id = '${ent.secret}'`);
R.reglages = await resa("secret", await dossier("secret", cli, 0, 0), rattana, "Réglages", { surPlace: true, comPrevue: 30, comRecue: 30, comLe: await J(-1) });
const eReg = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.reglages}') id`);
const fReg = eReg.ok ? await un("select * from fiduciaire_factures where id = $1", [eReg.rows[0].id]) : null;
ok(eReg.ok && fReg.numero === formaterNumero("facture", fReg.annee, 1, "SEC"), "nouveau préfixe : nouvelle série SEC-…-001 (" + (fReg && fReg.numero) + ")");
ok(fReg.libelle.startsWith("Agency commission on Réglages"), "mot du libellé réglé");
ok(fReg.emetteur.paiement.qr_image === "data:image/png;base64,QR1" && fReg.emetteur.paiement.qr_pseudo === "@secret" && fReg.emetteur.titres.facture === "TAX INVOICE" && fReg.emetteur.entite_id === ent.secret, "QR, titres et entreprise émettrice copiés sur la facture");
await db.exec(`update reglages set valeur = jsonb_set(valeur, '{apparence,qr_image}', '""') where entite_id = '${ent.secret}'`);
R.sansQr = await resa("secret", await dossier("secret", cli, 0, 0), rattana, "Sans QR", { surPlace: true, comPrevue: 20, comRecue: 20, comLe: await J(-1) });
const eSq = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.sansQr}') id`);
const fSq = eSq.ok ? await un("select emetteur from fiduciaire_factures where id = $1", [eSq.rows[0].id]) : null;
ok(eSq.ok && fSq.emetteur.paiement.qr_image === "", "sans QR le jour de l'émission : la clé est écrite vide, la facture reste sans QR");
ok(await fige(`update fiduciaire_factures set destinataire_id = null where id = '${fReg.id}'`), "le destinataire est figé lui aussi");
ok((await un("select fiduciaire_texte(E'\\n SEC\\t \\n', 'COM') t")).t === "SEC" && (await un("select fiduciaire_texte(E' \\n ', 'COM') t")).t === "COM", "les blancs (retours à la ligne compris) se retirent comme trim() dans l'outil");
ok(Object.prototype.hasOwnProperty.call(fSq.emetteur.paiement, "texte"), "le texte du compte est toujours copié, même vide");

console.log("Migration 36 sur une base qui a déjà des factures (comme la production)");
{
  const ancienne = await nouvelleBase(35);
  const q1 = async (sql, p = []) => (await ancienne.query(sql, p)).rows[0];
  const sec = (await q1("select id from entites where slug = 'secret'")).id;
  await ancienne.exec(`update reglages set valeur = valeur || '{"devise":"THB","fonctionnement":"excursions","emetteur":{"nom":"Secret Travel & Tour"},"paiement":{"texte":"x"}}'::jsonb where entite_id = '${sec}'`);
  const c0 = (await q1("insert into clients (entite_id, prenom, nom) values ($1, 'Jane', 'Example') returning id", [sec])).id;
  const p0 = (await q1("insert into partenaires (entite_id, nom, contact) values ($1, 'Rattana Tour Co., Ltd.', '{\"adresse\":\"1 Moo 2\"}') returning id", [sec])).id;
  const d0 = (await q1("insert into dossiers (entite_id, ref, client_id) values ($1, 'INV-2026-001', $2) returning id", [sec, c0])).id;
  const r0 = (await q1("insert into reservations (entite_id, dossier_id, partenaire_id, libelle, date_service, montant_vente, paye_sur_place) values ($1, $2, $3, 'Longtail', '2026-11-10', 3000, true) returning id", [sec, d0, p0])).id;
  await ancienne.query("insert into reservations_nets (entite_id, reservation_id, commission_prevue, commission_recue, commission_recue_le) values ($1, $2, 300, 300, '2026-11-12')", [sec, r0]);
  // Un administrateur général émet, comme Anaïs le 16.11.2026.
  const root = (await q1("insert into auth.users (email) values ('root@test') returning id")).id;
  await ancienne.exec(`insert into profils (user_id, email, nom, super_admin, actif) values ('${root}', 'root@test', 'Root', true, true) on conflict (user_id) do update set super_admin = true, actif = true`);
  const commeRoot = async (sql) => { await ancienne.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${root}', false);`); try { return (await ancienne.query(sql)).rows[0]; } finally { await ancienne.exec("reset role;"); } };
  const f0 = (await commeRoot(`select emettre_facture_fiduciaire('${r0}') id`)).id;
  await ancienne.exec(fs.readFileSync(W + migrations.find((n) => n.startsWith("migration-36-")), "utf8"));
  const apres = await q1("select destinataire_id, numero, emetteur from fiduciaire_factures where id = $1", [f0]);
  ok(apres.destinataire_id === p0 && apres.numero === "COM-2026-001", "la facture existante reçoit son destinataire, sans changer de numéro");
  ok((await q1("select prefixe from fiduciaire_compteurs where type = 'facture'")).prefixe === "COM", "le compteur existant devient la série COM");
  await ancienne.query("update reservations_nets set commission_recue = 350 where reservation_id = $1", [r0]);
  const f1b = (await commeRoot(`select emettre_facture_fiduciaire('${r0}') id`)).id;
  const comp = await q1("select numero, montant from fiduciaire_factures where id = $1", [f1b]);
  ok(comp.numero === "COM-2026-002" && Number(comp.montant) === 50, "la série continue (COM-2026-002) et le complément tient compte de l'ancienne facture");
}

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
