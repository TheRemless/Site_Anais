// Vérifie la migration 72 (demandes du site et conversations WhatsApp reliées) sur un Postgres en mémoire : schema.sql puis toutes les
// migrations. Une demande ne se relie qu'à un dossier de son entreprise (jamais Secret vers Taxi, fiche partagée ou non), au même numéro ;
// une demande traitée ne prend pas de second dossier ; la conversation WhatsApp se relie sans écraser la liaison de Nani, jamais pour un
// contact personnel ; Mook, ZTP et les rôles sans le droit ne relient rien hors de leurs droits ; la migration se rejoue sans effet ; retour.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-demandes-whatsapp.mjs
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
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
for (const f of migrations) await db.exec(lire(f));
ok(migrations.indexOf("migration-72-demandes-whatsapp.sql") > migrations.indexOf("migration-70-whatsapp-nom.sql"), "la migration 72 passe après la 70, sur une base vide");

async function essaie(userId, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];

const ent = {};
for (const sl of ["ztp", "secret", "taxi"]) ent[sl] = (await un("select id from entites where slug = $1", [sl]))?.id;
const ORG = (await un("select organisation_id from entites where id = $1", [ent.secret])).organisation_id;
const u = {};
for (const k of ["nani", "adminSecret", "mook", "lecteur", "ztp"]) u[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
// Mook chez Secret : elle lit et écrit tous les dossiers (elle confirme une demande à l'écran), sans les réglages (pas la boîte WhatsApp).
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Mook test', 'toute', array['clients.lire', 'clients.ecrire', 'dossiers.lire', 'dossiers.ecrire', 'partenaires.lire']),
  ('${ent.secret}', 'Lecteur test', 'toute', array['clients.lire', 'dossiers.lire'])`);
const membre = (user, entite, role) => db.exec(`insert into membres values ('${u[user]}', '${entite}', (select id from roles where entite_id = '${entite}' and nom = '${role}')) on conflict do nothing`);
await membre("nani", ent.secret, "Administrateur");
await membre("nani", ent.taxi, "Administrateur");
await membre("adminSecret", ent.secret, "Administrateur");
await membre("mook", ent.secret, "Mook test");
await membre("lecteur", ent.secret, "Lecteur test");
if (ent.ztp) await membre("ztp", ent.ztp, "Administrateur");

// ---- Données, écrites comme le font la fonction « demande-site », la fonction « whatsapp » et l'outil ---------------------------------
const client = async (e, prenom, telephone) => (await un("insert into clients (entite_id, prenom, nom, telephone) values ($1, $2, 'Test', $3) returning id", [ent[e], prenom, telephone])).id;
let nDos = 0;
const dossier = async (e, clientId, o = {}) => (await un("insert into dossiers (entite_id, ref, client_id, annule) values ($1, $2, $3, $4) returning id", [ent[e], `${e.toUpperCase()}-72-${++nDos}`, clientId, !!o.annule])).id;
let nDem = 0;
const demande = async (e, telephone) => (await un(`insert into demandes_site (entite_id, marque, ref, produit_id, produit, date_service, adultes, nom, telephone)
  values ($1, $2, $3, '4-islands', '4 Islands', current_date + 3, 2, 'Client test', $4) returning id`, [ent[e], e, `REF-${String(++nDem).padStart(4, "0")}`, telephone])).id;
let nMsg = 0;
const ranger = async (tel, nom = null) =>
  (await un("select whatsapp_ranger($1, $2, $3, $4::jsonb) r", [ORG, tel, nom, JSON.stringify({ evenement_id: `e72-${++nMsg}`, telnyx_id: `tx72-${nMsg}`, meta_id: `wamid.72.${nMsg}`, sens: "entrant", origine: "client", type: "text", texte: "Hello Nani", medias: [], envoye_le: new Date(Date.now() - (500 - nMsg) * 60000).toISOString() })])).r.conversation_id;
const relier = (user, dem, dos) => essaie(user, "select demande_site_relier($1, $2) r", [dem, dos]);
const relierWa = (user, dem) => essaie(user, "select whatsapp_relier_apres_demande($1) r", [dem]);
const motif = (r) => (r.ok ? r.rows[0].r.motif : `erreur ${r.err}`);
const etatDemande = (id) => un("select statut, dossier_id, traitee_par, decision from demandes_site where id = $1", [id]);
const conv = (id) => un("select entite_id, entite_source, client_id, dossier_id, reponses from whatsapp_conversations where id = $1", [id]);
// Confirmer depuis l'écran « Demandes du site » : la mise à jour directe de views/demandes-site.mjs.
const confirmerEcran = (user, dem, dos) => essaie(user, "update demandes_site set statut = 'confirmee', dossier_id = $2, decision = '{\"final\":{}}' where id = $1", [dem, dos]);

// ---- Structure ----------------------------------------------------------------------------------------------------------------------
for (const f of ["demande_site_relier(uuid, uuid)", "whatsapp_relier_apres_demande(uuid)"]) {
  const x = await un(`select has_function_privilege('authenticated', '${f}', 'execute') a, has_function_privilege('anon', '${f}', 'execute') b`);
  ok(x.a === true && x.b === false, `${f} : ouverte aux personnes connectées, fermée au public`);
}
for (const f of ["cle_telephone(text)", "demandes_site_une_fois()"]) {
  const x = await un(`select has_function_privilege('authenticated', '${f}', 'execute') a, has_function_privilege('anon', '${f}', 'execute') b`);
  ok(x.a === false && x.b === false, `${f} : execute retiré à authenticated et anon`);
}
ok((await un("select cle_telephone('081 234 5678') a, cle_telephone('+66 81 234 5678') b, cle_telephone('12345') c")).a === "812345678", "cle_telephone : 9 derniers chiffres, notation thaïe comprise");
ok((await un("select cle_telephone('12345') c")).c === null, "cle_telephone : un numéro trop court ne donne rien");
let r = await essaie(u.nani, "select demande_site_relier(gen_random_uuid(), gen_random_uuid())");
ok(r.ok, "Nani appelle la fonction");
r = await db.query("select demande_site_relier(gen_random_uuid(), gen_random_uuid())").then(() => ({ ok: true }), (e) => ({ ok: false, err: e.message }));
ok(!r.ok && /Connexion requise/.test(r.err), "sans personne connectée, la fonction refuse");

// ---- 1. Dossier créé depuis WhatsApp ou l'Assistant : la demande du même numéro --------------------------------------------------------
console.log("== Demande reliée au dossier ==");
const cAnna = await client("secret", "Anna", "+44 7700 900123");
const dAnna = await dossier("secret", cAnna);
const qAnna = await demande("secret", "+447700900123");
r = await relier(u.nani, qAnna, dAnna);
ok(motif(r) === "relie", "Nani : la demande Secret d'Anna se relie au dossier Secret créé pour elle" + ` (${motif(r)})`);
let q = await etatDemande(qAnna);
ok(q.statut === "confirmee" && q.dossier_id === dAnna && q.traitee_par === u.nani && q.decision.relie && q.decision.relie.depuis === "dossier", "… confirmée, avec le dossier, qui et d'où vient le lien");
ok(r.ok && r.rows[0].r.demande && r.rows[0].r.demande.id === qAnna, "… la fonction rend la demande à jour pour l'écran");

console.log("== Pas de second dossier ==");
const dAnna2 = await dossier("secret", cAnna);
r = await relier(u.nani, qAnna, dAnna2);
ok(motif(r) === "deja_traitee" && r.rows[0].r.dossier_id === dAnna, "une demande confirmée ne se relie pas à un second dossier (rend le dossier déjà relié)");
r = await confirmerEcran(u.nani, qAnna, dAnna2);
ok(!r.ok && /déjà été traitée/.test(r.err), "« Confirmer » à l'écran sur une demande déjà confirmée est refusé (second dossier impossible)");
r = await essaie(u.nani, "update demandes_site set statut = 'refusee' where id = $1", [qAnna]);
ok(!r.ok, "une demande confirmée ne passe pas « refusée » après coup");
r = await essaie(u.nani, "update demandes_site set statut = 'classee' where id = $1", [qAnna]);
ok(!r.ok, "ni « classée »");
q = await etatDemande(qAnna);
ok(q.statut === "confirmee" && q.dossier_id === dAnna, "… elle garde son premier dossier");
const qAnnaBis = await demande("secret", "+447700900123");
r = await confirmerEcran(u.nani, qAnnaBis, dAnna2);
ok(r.ok && r.n === 1, "une demande nouvelle se confirme toujours à l'écran (règle de la migration 30)");
r = await relier(u.nani, qAnnaBis, dAnna);
ok(motif(r) === "deja_traitee", "… et ne se relie plus ensuite depuis l'Assistant");
// Un dossier supprimé vide le lien : la règle « on delete set null » passe, même avec une personne connectée.
const dJetable = await dossier("secret", cAnna);
const qJetable = await demande("secret", "+447700900123");
await relier(u.nani, qJetable, dJetable);
await db.exec(`select set_config('request.jwt.claim.sub', '${u.nani}', false)`);
r = await db.query("delete from dossiers where id = $1", [dJetable]).then(() => ({ ok: true }), (e) => ({ ok: false, err: e.message }));
await db.exec("select set_config('request.jwt.claim.sub', '', false)");
q = await etatDemande(qJetable);
ok(r.ok && q.statut === "confirmee" && q.dossier_id === null, "un dossier supprimé laisse la demande confirmée, sans dossier" + (r.ok ? "" : ` (${r.err})`));

console.log("== Chaque entreprise ses éléments ==");
const cPaul = await client("taxi", "Paul", "+33 6 39 98 00 02");
const dPaulTaxi = await dossier("taxi", cPaul);
const qPaulSecret = await demande("secret", "+33639980002");
r = await relier(u.nani, qPaulSecret, dPaulTaxi);
ok(motif(r) === "autre_entreprise", "une demande Secret n'est pas reliée à un dossier Taxi d'un client Taxi");
// Fiche partagée (migration 63) : le dossier Taxi d'une fiche Secret reste un dossier de Taxi.
const wMia = await ranger("+447700900200", "Mia");
const cMia = await client("secret", "Mia", "+44 7700 900200");
const dMiaTaxi = await dossier("taxi", cMia);
const qMiaSecret = await demande("secret", "+447700900200");
r = await relier(u.nani, qMiaSecret, dMiaTaxi);
ok(motif(r) === "autre_entreprise", "ni à un dossier Taxi d'une fiche Secret partagée");
await db.exec(`delete from partages_clients where organisation_id = '${ORG}' and source_id in ('${ent.secret}', '${ent.taxi}') and cible_id in ('${ent.secret}', '${ent.taxi}')`);
r = await relier(u.nani, qMiaSecret, dMiaTaxi);
ok(motif(r) === "autre_entreprise", "… ni sans le partage (client non partagé)");
await db.exec(`insert into partages_clients (source_id, cible_id, organisation_id) values ('${ent.secret}', '${ent.taxi}', '${ORG}'), ('${ent.taxi}', '${ent.secret}', '${ORG}') on conflict do nothing`);
ok((await etatDemande(qPaulSecret)).statut === "nouvelle" && (await etatDemande(qMiaSecret)).statut === "nouvelle", "… les deux demandes restent à traiter");
r = await confirmerEcran(u.nani, qPaulSecret, dPaulTaxi);
ok(!r.ok || r.n === 0, "l'écran non plus ne relie pas une demande Secret à un dossier Taxi (politique de la migration 30)");
const qMiaTaxi = await demande("taxi", "+447700900200");
r = await relier(u.nani, qMiaTaxi, dMiaTaxi);
ok(motif(r) === "relie", "la demande Taxi de Mia se relie au dossier Taxi de sa fiche partagée");

console.log("== Le numéro ==");
const qAutre = await demande("secret", "+12025550199");
r = await relier(u.nani, qAutre, dAnna2);
ok(motif(r) === "numero", "un autre numéro ne se relie pas");
const cThai = await client("secret", "Somsak", "081 234 5678");
const dThai = await dossier("secret", cThai);
const qThai = await demande("secret", "+66812345678");
r = await relier(u.nani, qThai, dThai);
ok(motif(r) === "relie", "« 081 234 5678 » et « +66 81 234 5678 » : même client (9 derniers chiffres)");
// Numéro absent de la fiche, mais conversation WhatsApp déjà reliée à ce dossier (relierWhatsApp passe avant dans l'Assistant).
const cSans = await client("secret", "Jade", null);
const dSans = await dossier("secret", cSans);
const wJade = await ranger("+12025550199", "Jade");
await db.query("update whatsapp_conversations set entite_id = $1, entite_source = 'manuel', client_id = $2, dossier_id = $3 where id = $4", [ent.secret, cSans, dSans, wJade]);
r = await relier(u.nani, qAutre, dSans);
ok(motif(r) === "relie", "le numéro de la conversation WhatsApp reliée au dossier compte aussi");
const qSansNumero = await demande("secret", null);
r = await relier(u.nani, qSansNumero, dAnna2);
ok(motif(r) === "numero", "une demande sans numéro ne se relie pas d'office");
const dAnnule = await dossier("secret", cAnna, { annule: true });
const qAnnule = await demande("secret", "+447700900123");
r = await relier(u.nani, qAnnule, dAnnule);
ok(motif(r) === "annule", "jamais à un dossier annulé");

console.log("== Droits ==");
const qMook = await demande("secret", "+447700900123");
const dMook = await dossier("secret", cAnna);
r = await relier(u.mook, qMook, dMook);
ok(motif(r) === "relie", "Mook relie une demande Secret dans ses droits (elle confirme déjà à l'écran)");
const qTaxiMook = await demande("taxi", "+447700900200");
r = await relier(u.mook, qTaxiMook, dMiaTaxi);
ok(motif(r) === "introuvable", "Mook ne relie pas une demande Taxi (pas de rôle chez Taxi)");
r = await relier(u.adminSecret, qTaxiMook, dMiaTaxi);
ok(motif(r) === "introuvable", "l'administratrice de Secret seule non plus");
const qZtpEssai = await demande("secret", "+447700900123");
r = await relier(u.ztp, qZtpEssai, dAnna2);
ok(motif(r) === "introuvable", "l'administrateur de ZTP ne relie aucune demande de Secret");
const qLecteur = await demande("secret", "+447700900123");
r = await relier(u.lecteur, qLecteur, dAnna2);
ok(motif(r) === "droit", "un rôle qui lit sans écrire les dossiers ne relie rien");
ok((await etatDemande(qLecteur)).statut === "nouvelle" && (await etatDemande(qTaxiMook)).statut === "nouvelle", "… les demandes refusées restent « nouvelle »");
r = await essaie(u.mook, "select count(*)::int n from whatsapp_conversations");
ok(r.ok && r.rows[0].n === 0, "Mook ne voit aucune conversation WhatsApp");

// ---- 2. Demande acceptée : la conversation WhatsApp ----------------------------------------------------------------------------------
console.log("== Conversation reliée après la demande ==");
const wLucia = await ranger("+12025550147", "Lucia");
ok((await conv(wLucia)).entite_id === null, "la conversation de Lucia est à trier");
const cLucia = await client("secret", "Lucia", "+1 202 555 0147");
const dLucia = await dossier("secret", cLucia);
const qLucia = await demande("secret", "+12025550147");
r = await relierWa(u.nani, qLucia);
ok(motif(r) === "non_confirmee", "une demande pas encore confirmée ne relie pas la conversation");
await confirmerEcran(u.nani, qLucia, dLucia);
r = await relierWa(u.mook, qLucia);
ok(motif(r) === "droit_whatsapp", "Mook confirme, mais ne relie pas la conversation (pas la boîte)");
r = await relierWa(u.lecteur, qLucia);
ok(motif(r) === "droit", "un rôle sans « dossiers.ecrire » non plus");
r = await relierWa(u.ztp, qLucia);
ok(motif(r) === "introuvable", "ZTP non plus");
ok((await conv(wLucia)).dossier_id === null, "… la conversation n'a pas bougé");
r = await relierWa(u.nani, qLucia);
let c = await conv(wLucia);
ok(motif(r) === "relie" && c.entite_id === ent.secret && c.client_id === cLucia && c.dossier_id === dLucia, "Nani : la conversation à trier se range chez Secret, reliée au client et au dossier" + ` (${motif(r)})`);
ok(r.rows[0].r.conversation && r.rows[0].r.conversation.id === wLucia && !("resume" in r.rows[0].r.conversation), "… la fonction rend seulement la liaison");
r = await relierWa(u.nani, qLucia);
ok(motif(r) === "deja_fait" && r.rows[0].r.relie === true, "rejouée, rien ne change (déjà fait)");

console.log("== Nani garde sa liaison ==");
const cTom = await client("taxi", "Tom", "+44 7700 900311");
const dTom1 = await dossier("taxi", cTom);
const dTom2 = await dossier("taxi", cTom);
const wTom = await ranger("+447700900311", "Tom");
await essaie(u.nani, "update whatsapp_conversations set entite_id = $1 where id = $2", [ent.taxi, wTom]);
await essaie(u.nani, "update whatsapp_conversations set client_id = $1, dossier_id = $2 where id = $3", [cTom, dTom1, wTom]);
const avantTom = await conv(wTom);
ok(avantTom.entite_id === ent.taxi && avantTom.client_id === cTom && avantTom.dossier_id === dTom1, "Nani a relié la conversation de Tom à son premier dossier Taxi");
const qTom = await demande("taxi", "+447700900311");
await confirmerEcran(u.nani, qTom, dTom2);
r = await relierWa(u.nani, qTom);
ok(motif(r) === "deja_relie" && JSON.stringify(await conv(wTom)) === JSON.stringify(avantTom), "une demande acceptée n'écrase pas le dossier relié par Nani");
const cAutreTom = await client("taxi", "Thomas", "+44 7700 900311");
const dAutreTom = await dossier("taxi", cAutreTom);
const wClient = await ranger("+447700900312", "Client seul");
await essaie(u.nani, "update whatsapp_conversations set entite_id = $1 where id = $2", [ent.taxi, wClient]);
await essaie(u.nani, "update whatsapp_conversations set client_id = $1 where id = $2", [cTom, wClient]);
const cClient = await client("taxi", "Autre", "+44 7700 900312");
const dClient = await dossier("taxi", cClient);
const qClient = await demande("taxi", "+447700900312");
await confirmerEcran(u.nani, qClient, dClient);
r = await relierWa(u.nani, qClient);
c = await conv(wClient);
ok(motif(r) === "deja_relie" && c.client_id === cTom && c.dossier_id === null, "ni le client choisi par Nani (sans dossier)");
ok(!!dAutreTom, "(dossier d'une autre fiche au même numéro créé pour la suite)");

console.log("== Contact personnel et autres contacts ==");
const wSomchai = await ranger("+447700900844", "Driver Somchai");
await essaie(u.nani, "update whatsapp_conversations set entite_id = $1, reponses = 'jamais' where id = $2", [ent.taxi, wSomchai]);
const cSomchai = await client("taxi", "Somchai", "+44 7700 900844");
const dSomchai = await dossier("taxi", cSomchai);
const qSomchai = await demande("taxi", "+447700900844");
await confirmerEcran(u.nani, qSomchai, dSomchai);
r = await relierWa(u.nani, qSomchai);
c = await conv(wSomchai);
ok(motif(r) === "personnel" && c.client_id === null && c.dossier_id === null, "un contact personnel n'est pas relié");
const wChauffeur = await ranger("+447700900845", "Chauffeur");
await essaie(u.nani, "update whatsapp_conversations set entite_id = $1, type_contact = 'chauffeur' where id = $2", [ent.taxi, wChauffeur]);
const qChauffeur = await demande("taxi", "+447700900845");
const dChauffeur = await dossier("taxi", await client("taxi", "Chauffeur", "+44 7700 900845"));
await confirmerEcran(u.nani, qChauffeur, dChauffeur);
r = await relierWa(u.nani, qChauffeur);
ok(motif(r) === "autre_contact" && (await conv(wChauffeur)).dossier_id === null, "un chauffeur (contact typé autre que client) non plus");
// Une conversation rangée chez Taxi n'est jamais reliée à un dossier Secret.
const wSven = await ranger("+447700900733", "Sven");
await essaie(u.nani, "update whatsapp_conversations set entite_id = $1 where id = $2", [ent.taxi, wSven]);
const dSven = await dossier("secret", await client("secret", "Sven", "+44 7700 900733"));
const qSven = await demande("secret", "+447700900733");
await confirmerEcran(u.nani, qSven, dSven);
r = await relierWa(u.nani, qSven);
c = await conv(wSven);
ok(motif(r) === "autre_entreprise" && c.entite_id === ent.taxi && c.dossier_id === null, "une demande Secret ne relie pas une conversation rangée chez Taxi");
// Remise à trier par Nani : elle reste à trier.
const wTrie = await ranger("+447700900746", "Trié");
await db.query("update whatsapp_conversations set entite_source = 'manuel' where id = $1", [wTrie]);
const dTrie = await dossier("secret", await client("secret", "Trié", "+44 7700 900746"));
const qTrie = await demande("secret", "+447700900746");
await confirmerEcran(u.nani, qTrie, dTrie);
r = await relierWa(u.nani, qTrie);
ok(motif(r) === "a_trier_par_nani" && (await conv(wTrie)).entite_id === null, "une conversation remise à trier par Nani reste à trier");
// Deux conversations aux mêmes 9 derniers chiffres : rien au hasard.
const wDouble1 = await ranger("+447700900777", "Double A");
const wDouble2 = await ranger("+337700900777", "Double B");
const dDouble = await dossier("secret", await client("secret", "Double", "+44 7700 900777"));
const qDouble = await demande("secret", "+447700900777");
await confirmerEcran(u.nani, qDouble, dDouble);
r = await relierWa(u.nani, qDouble);
ok(motif(r) === "plusieurs" && (await conv(wDouble1)).dossier_id === null && (await conv(wDouble2)).dossier_id === null, "deux conversations au même numéro : aucune n'est choisie au hasard");

console.log("== Fiche partagée, conversation à trier ==");
ok((await conv(wMia)).entite_id === null, "la conversation de Mia est à trier");
r = await relierWa(u.nani, qMiaTaxi);
c = await conv(wMia);
ok(motif(r) === "relie" && c.entite_id === ent.taxi && c.dossier_id === dMiaTaxi && c.client_id === null, "Taxi : rangée chez Taxi avec le dossier, sans la fiche de Secret (chaque entreprise ses fiches)");

console.log("== ZTP n'a pas la boîte ==");
if (ent.ztp) {
  await db.query("update entites set publie_site = true where id = $1", [ent.ztp]);
  const cZ = (await un("insert into clients (entite_id, prenom, nom, telephone) values ($1, 'Zoé', 'Z', '+44 7700 900901') returning id", [ent.ztp])).id;
  const dZ = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, 'ZTP-72', $2) returning id", [ent.ztp, cZ])).id;
  const qZ = (await un("insert into demandes_site (entite_id, marque, produit_id, telephone) values ($1, 'ztp', 'voyage', '+447700900901') returning id", [ent.ztp])).id;
  const wZ = await ranger("+447700900901", "Zoé");
  r = await relier(u.ztp, qZ, dZ);
  ok(motif(r) === "relie", "ZTP relie sa demande à son dossier (dans ses droits)");
  r = await relierWa(u.ztp, qZ);
  ok(motif(r) === "sans_boite" && (await conv(wZ)).entite_id === null, "… mais aucune conversation WhatsApp chez ZTP");
  r = await relierWa(u.nani, qZ);
  ok(motif(r) === "introuvable", "Nani ne touche pas à une demande de ZTP");
  await db.query("update entites set publie_site = false where id = $1", [ent.ztp]);
}

// ---- Se rejoue sans effet -----------------------------------------------------------------------------------------------------------
console.log("== Rejeu et retour ==");
const photo = async () => JSON.stringify([(await db.query("select * from demandes_site order by id")).rows, (await db.query("select * from whatsapp_conversations order by id")).rows]);
const p1 = await photo();
await db.exec(lire("migration-72-demandes-whatsapp.sql"));
await db.exec(lire("migration-72-demandes-whatsapp.sql"));
ok((await photo()) === p1, "la migration 72 se rejoue (deux fois) sans toucher aux données");
r = await confirmerEcran(u.nani, qAnna, dAnna2);
ok(!r.ok, "après le rejeu, une demande confirmée refuse toujours un second dossier");
ok((await un("select count(*)::int n from pg_trigger where tgname = 'une_fois' and tgrelid = 'demandes_site'::regclass")).n === 1, "un seul déclencheur une_fois après le rejeu");

await db.exec(lire("retour-72-demandes-whatsapp.sql"));
ok(!(await un("select 1 x from pg_proc where proname in ('demande_site_relier', 'whatsapp_relier_apres_demande', 'cle_telephone', 'demandes_site_une_fois')")), "retour : les fonctions sont parties");
ok((await photo()) === p1, "retour : les liens posés restent (aucune donnée touchée)");
r = await essaie(u.nani, "update demandes_site set decision = '{}' where id = $1", [qAnna]);
ok(r.ok, "retour : la règle d'avant (migration 30) reste en place");
await db.exec(lire("migration-72-demandes-whatsapp.sql"));
r = await relier(u.nani, await demande("secret", "+447700900123"), dAnna2);
ok(motif(r) === "relie", "la migration 72 se rejoue après le retour");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
