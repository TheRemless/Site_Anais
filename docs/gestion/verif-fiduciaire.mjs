// Vérifie la migration 28 (factures pour la fiduciaire) sur un Postgres en mémoire : droits, montants, numérotation sans trou, factures figées,
// et surtout que la base et le code de l'outil (cibleAgence) calculent le même montant sur les mêmes cas.
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-fiduciaire.mjs . && GESTION_SQL=<repo>/docs/gestion/ GESTION_SRC=file://<repo>/src/gestion/js/ node verif-fiduciaire.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
const SRC = process.env.GESTION_SRC || "../src/gestion/js/";
const { cibleAgence, aEmettre, libelleFacture, formaterNumero } = await import(SRC + "fiduciaire-calc.mjs");
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
await db.exec("revoke execute on all functions in schema public from public, anon; grant execute on all functions in schema public to authenticated;");

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
await db.exec(`update reglages set valeur = valeur || '{"devise":"THB","emetteur":{"nom":"Secret Travel & Tour","sous_titre":"by Zwald Travel Planner Co., Ltd.","adresse":"292 Moo 2, 81150, Koh Lanta, Krabi","telephone":"+66 00 000 0000","licence":"34/04000"},"paiement":{"texte":"**Account Name:** Zwald Travel Planner Co., Ltd.\\n**Account Number:** 000-0-00000-0"}}'::jsonb where entite_id = '${ent.secret}'`);
await db.exec(`update reglages set valeur = valeur || '{"devise":"THB"}'::jsonb where entite_id = '${ent.taxi}'`);

// Personnes : Mook (prépare, ne voit pas les nets), Anaïs (gère, voit les nets), un lecteur sans droit, une personne limitée à Taxi.
const U = {};
for (const k of ["root", "mook", "anais", "lecteur", "taxiste"]) U[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
const lectureBase = ["clients.lire", "dossiers.lire", "finances.voir", "partenaires.lire"];
for (const s of ["secret", "taxi"]) {
  await db.exec(`insert into roles (entite_id, nom, portee, permissions) values
    ('${ent[s]}', 'Assistante', 'toute', array['${[...lectureBase, "dossiers.ecrire", "fiduciaire.preparer"].join("','")}']),
    ('${ent[s]}', 'Responsable', 'toute', array['${[...lectureBase, "dossiers.ecrire", "partenaires.nets", "fiduciaire.preparer", "fiduciaire.gerer"].join("','")}'])`);
}
const membre = (u, s, role) => db.exec(`insert into membres values ('${U[u]}', '${ent[s]}', (select id from roles where entite_id = '${ent[s]}' and nom = '${role}'))`);
await membre("mook", "secret", "Assistante"); await membre("mook", "taxi", "Assistante");
await membre("anais", "secret", "Responsable"); await membre("anais", "taxi", "Responsable");
await membre("lecteur", "secret", "Lecteur");
await membre("taxiste", "taxi", "Assistante");

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
R.partielle = await resa("secret", await dossier("secret", cli, 0, 0), rattana, "Koh Rok", { surPlace: true, comPrevue: 300, comRecue: 200, comLe: "2026-11-12" });
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
  const deja = Number((await un("select coalesce(sum(montant), 0) s from fiduciaire_factures where reservation_id = $1", [id])).s);
  const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  const reservation = { statut: r.statut, paye_sur_place: r.paye_sur_place, montant_vente: r.montant_vente === null ? null : Number(r.montant_vente) };
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
  const memes = js.cas === b.cas && js.cible === Number(b.cible) && js.date === iso(b.date_cible) && js.pret === b.pret && JSON.stringify(js.manque) === JSON.stringify(b.manque) && (js.ecart === null ? b.ecart === null : js.ecart === Number(b.ecart)) && js.a_revoir === b.a_revoir && e.deja === Number(b.deja);
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
ok((await essaie(U.root, "select count(*)::int n from fiduciaire_a_preparer()")).rows[0].n >= 5, "un administrateur général voit ce qu'il y a à préparer");

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
const e4 = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.taxi}') id`);
const f4 = e4.ok ? await un("select * from fiduciaire_factures where id = $1", [e4.rows[0].id]) : null;
ok(e4.ok && f4.entite_slug === "taxi" && f4.destinataire.nom === "VIP Taxi Lanta" && f4.emetteur.emetteur.nom === "Secret Travel & Tour", "Taxi : facture émise par Secret, adressée à VIP Taxi Lanta");
ok((await essaie(U.mook, `select emettre_facture_fiduciaire('${R.nonSolde}')`)).ok === false, "client non soldé : rien à émettre");

console.log("Complément, avoir, correction");
await db.exec(`update reservations_nets set commission_recue = 300, commission_recue_le = '2026-11-20' where reservation_id = '${R.partielle}'`);
await compare("partielle");
const e5 = await essaie(U.mook, `select emettre_facture_fiduciaire('${R.partielle}') id`);
const f5 = e5.ok ? await un("select * from fiduciaire_factures where id = $1", [e5.rows[0].id]) : null;
ok(e5.ok && Number(f5.montant) === 100 && f5.date_facture.toISOString().slice(0, 10) === "2026-11-20", "le complément reçu plus tard : une facture de 100 datée du 20");
await db.exec(`update reservations_nets set commission_recue = 250 where reservation_id = '${R.surPlace}'`);
const { js: jsAvoir } = await compare("surPlace");
ok(aEmettre(jsAvoir, 300).type === "avoir", "commission corrigée à 250 : le code dit « avoir de 50 »");
ok((await essaie(U.mook, `select emettre_facture_fiduciaire('${R.surPlace}')`)).ok === false, "Mook n'émet pas d'avoir");
const av = await essaie(U.anais, `select emettre_facture_fiduciaire('${R.surPlace}', '2026-11-25') id`);
const fav = av.ok ? await un("select * from fiduciaire_factures where id = $1", [av.rows[0].id]) : null;
ok(av.ok && fav.numero === "CN-2026-001" && Number(fav.montant) === -50 && fav.avoir_de === f1.id && fav.avoir_de_numero === "COM-2026-001", "Anaïs émet l'avoir CN-2026-001 de −50 qui renvoie à COM-2026-001");
ok((await essaie(U.anais, `select emettre_facture_fiduciaire('${R.surPlace}')`)).ok === false, "après l'avoir, le total facturé est juste : rien d'autre à émettre");
await db.exec(`update reservations set statut = 'annule' where id = '${R.chezNous}'`);
await compare("chezNous");
const av2 = await essaie(U.anais, `select emettre_facture_fiduciaire('${R.chezNous}', '2026-11-26') id`);
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
ok((await essaie(U.mook, `select marquer_envoyee_fiduciaire(array['${f1.id}','${f2.id}']::uuid[], '2026-12-01') n`)).rows[0].n === 2, "Mook marque deux factures envoyées le 1er décembre");
ok((await un("select envoyee_le::text d from fiduciaire_factures where id = $1", [f1.id])).d === "2026-12-01", "la date est enregistrée");
ok((await essaie(U.mook, `select marquer_envoyee_fiduciaire(array['${f1.id}']::uuid[], null)`)).ok === false, "Mook ne retire pas la mention d'envoi");
ok((await essaie(U.anais, `select marquer_envoyee_fiduciaire(array['${f1.id}']::uuid[], null) n`)).ok, "Anaïs peut la retirer");
ok((await essaie(U.taxiste, `select marquer_envoyee_fiduciaire(array['${f1.id}']::uuid[], '2026-12-02')`)).ok === false, "le droit de Taxi n'ouvre pas les factures de Secret");
const listeMook = await essaie(U.mook, "select numero, entite_slug from fiduciaire_factures order by numero");
ok(listeMook.ok && listeMook.rows.length === 7, "Mook lit les 7 documents (Secret et Taxi)");
ok((await essaie(U.taxiste, "select numero from fiduciaire_factures")).rows.length === 1, "la personne limitée à Taxi ne lit que la facture de Taxi");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
