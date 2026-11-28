// Vérifie la migration 133 (l'Assistant en équipe) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// Demande de Jérémy du 27.11.2026 : l'administration d'une entreprise voit les conversations de l'Assistant de son équipe et y écrit comme la
// propriétaire. Ici, rôle par rôle : la saisie ne voit que les siennes ; l'administration de Secret voit celles de Secret, jamais celles de
// ZTP ; un lecteur ne voit rien ; l'auteur réel de chaque message et de chaque décision est posé par la base ; une seule réponse à la fois
// (verrou lu avec « for update ») ; une carte validée par deux personnes en même temps n'est prise qu'une fois ; temps réel ; rejeu ; retour.
// Données fictives uniquement.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-assistant-equipe.mjs
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
create publication supabase_realtime;
`;
const MIG = "migration-133-assistant-equipe.sql";
const RETOUR = "retour-133-assistant-equipe.sql";
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d|1\d\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
ok(migrations.includes(MIG) && migrations.indexOf(MIG) > migrations.indexOf("migration-120-carte-prise-une-fois.sql"), "la migration 133 passe après la 120, sur une base vide");
for (const f of migrations) await db.exec(lire(f));

const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const ent = {};
for (const s of ["ztp", "secret", "taxi"]) ent[s] = (await un("select id from entites where slug = $1", [s])).id;
const ORG = (await un("select organisation_id from entites where id = $1", [ent.secret])).organisation_id;
async function essaie(userId, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}

// ---- Personnes fictives -----------------------------------------------------------------------------------------------------------------
// nani : la saisie de Secret (rôle Éditeur, sans réglages) ; mook : une autre saisie de Secret ; admin : l'administration de Secret ;
// jeremy : l'administration générale (super_admin) ; adminZtp : l'administration de ZTP seulement ; lecteur : un lecteur de Secret.
const U = {};
for (const k of ["nani", "mook", "admin", "jeremy", "adminZtp", "lecteur", "chefSes", "superAilleurs"]) U[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
await db.exec(`update profils set organisation_id = '${ORG}', actif = true, super_admin = (user_id = '${U.jeremy}') where user_id in (${Object.entries(U).filter(([k]) => k !== "superAilleurs").map(([, x]) => `'${x}'`).join(",")})`);
const membre = (k, s, role) => db.exec(`insert into membres values ('${U[k]}', '${ent[s]}', (select id from roles where entite_id = '${ent[s]}' and nom = '${role}')) on conflict do nothing`);
await membre("nani", "secret", "Éditeur");
await membre("mook", "secret", "Éditeur");
await membre("admin", "secret", "Administrateur");
await membre("admin", "ztp", "Éditeur");
await membre("adminZtp", "ztp", "Administrateur");
await membre("lecteur", "secret", "Lecteur");
// S2 (relecture de la PR 366) : réglages et dossiers, mais seulement « ses dossiers ».
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Chef ses dossiers', 'mes_dossiers', array['reglages.ecrire','dossiers.lire','dossiers.ecrire','clients.lire','clients.ecrire','partenaires.lire'])`);
await membre("chefSes", "secret", "Chef ses dossiers");
// S7 : un super_admin d'une autre organisation.
const AUTRE_ORG = (await un("insert into organisations (nom) values ('Autre organisation test') returning id")).id;
// Données de test : le compte est posé dans l'autre organisation sans passer par proteger_profil (session_replication_role).
await db.exec(`set session_replication_role = replica; update profils set organisation_id = '${AUTRE_ORG}', super_admin = true, actif = true where user_id = '${U.superAilleurs}'; set session_replication_role = origin;`);
const comme = (k, sql, p) => essaie(U[k], sql, p);
const ids = (r) => (r.rows || []).map((x) => x.id);

const nouvelle = async (k, s, titre = "Course test") => (await comme(k, "insert into agent_conversations (entite_id, titre) values ($1, $2) returning id, user_id", [ent[s], titre])).rows[0];
const cN = await nouvelle("nani", "secret", "Transfert Client Test");
const cM = await nouvelle("mook", "secret");
const cZ = await nouvelle("adminZtp", "ztp");
const cA = await nouvelle("admin", "ztp", "Conversation de l'administration chez ZTP");
ok(cN.user_id === U.nani, "une conversation est à la personne qui l'ouvre");

console.log("== Qui voit quoi ==");
const voit = async (k) => ids(await comme(k, "select id from agent_conversations"));
const vNani = await voit("nani");
ok(vNani.includes(cN.id) && !vNani.includes(cM.id), "la saisie ne voit que ses conversations (pas celle d'une autre saisie)");
const vAdmin = await voit("admin");
ok(vAdmin.includes(cN.id) && vAdmin.includes(cM.id), "l'administration de Secret voit toutes les conversations de Secret");
ok(!vAdmin.includes(cZ.id), "l'administration de Secret ne voit pas celles de ZTP, où elle n'est pas administratrice");
ok(vAdmin.includes(cA.id), "… sauf la sienne, ouverte chez ZTP avec son rôle Éditeur");
const vZtp = await voit("adminZtp");
ok(vZtp.includes(cZ.id) && vZtp.includes(cA.id) && !vZtp.includes(cN.id), "l'administration de ZTP voit l'équipe de ZTP, jamais Secret");
const vJ = await voit("jeremy");
ok([cN.id, cM.id, cZ.id, cA.id].every((x) => vJ.includes(x)), "l'administration générale voit toutes les entreprises");
ok((await voit("lecteur")).length === 0, "un lecteur ne voit aucune conversation");
const vChef = await voit("chefSes");
ok(!vChef.includes(cN.id) && !vChef.includes(cM.id), "S2 : réglages et dossiers avec la portée « ses dossiers » ne voient pas l'équipe (comme whatsapp_admin)");
ok((await comme("nani", "select agent_ma_conversation($1) v", [cM.id])).rows[0].v === false, "agent_ma_conversation : fermée à une autre saisie");
ok((await comme("admin", "select agent_ma_conversation($1) v", [cN.id])).rows[0].v === true, "agent_ma_conversation : ouverte à l'administration de l'entreprise");

console.log("== Écrire comme la propriétaire ==");
const m1 = await comme("nani", "insert into agent_messages (conversation_id, role, contenu) values ($1, 'user', '[{\"type\":\"text\",\"text\":\"Bonjour\"}]') returning auteur_id", [cN.id]);
ok(m1.ok && m1.rows[0].auteur_id === U.nani, "le message de la propriétaire porte son auteur");
const m2 = await comme("admin", "insert into agent_messages (conversation_id, role, contenu, auteur_id) values ($1, 'user', '[{\"type\":\"text\",\"text\":\"Je reprends\"}]', $2) returning auteur_id", [cN.id, U.nani]);
ok(m2.ok && m2.rows[0].auteur_id === U.admin, "l'administration écrit dans la conversation de la saisie, sous son vrai nom (auteur imposé par la base)");
ok(!(await comme("mook", "insert into agent_messages (conversation_id, role, contenu) values ($1, 'user', '[]')", [cN.id])).ok, "une autre saisie n'écrit pas dans la conversation de Nani");
ok(!(await comme("adminZtp", "insert into agent_messages (conversation_id, role, contenu) values ($1, 'user', '[]')", [cN.id])).ok, "l'administration de ZTP n'écrit pas dans une conversation de Secret");
ok((await comme("admin", "select count(*)::int n from agent_messages where conversation_id = $1", [cN.id])).rows[0].n === 2, "l'administration lit tout le fil");
const ren = await comme("admin", "update agent_conversations set titre = 'Renommée', user_id = $2 where id = $1 returning user_id, titre", [cN.id, U.admin]);
ok(ren.ok && ren.rows[0].user_id === U.nani && ren.rows[0].titre === "Renommée", "l'administration range la conversation, qui reste à Nani");
ok((await comme("mook", "update agent_conversations set titre = 'x' where id = $1 returning id", [cN.id])).rows.length === 0, "une autre saisie ne range pas la conversation de Nani");
ok((await comme("mook", "delete from agent_conversations where id = $1 returning id", [cN.id])).rows.length === 0, "une autre saisie ne la supprime pas");

console.log("== Discussion pleine remplacée au nom de la propriétaire ==");
const rep = await comme("admin", "insert into agent_conversations (entite_id, titre, user_id) values ($1, 'Suite', $2) returning id, user_id", [ent.secret, U.nani]);
ok(rep.ok && rep.rows[0].user_id === U.nani, "l'administration ouvre la suite au nom de Nani, qui la voit");
ok((await voit("nani")).includes(rep.rows[0].id), "… et Nani la retrouve dans sa liste");
const vol = await comme("mook", "insert into agent_conversations (entite_id, titre, user_id) values ($1, 'x', $2) returning user_id", [ent.secret, U.nani]);
ok(vol.ok && vol.rows[0].user_id === U.mook, "une saisie ne crée jamais une conversation au nom d'une autre (la base la lui donne)");
const hors = await comme("admin", "insert into agent_conversations (entite_id, titre, user_id) values ($1, 'x', $2) returning user_id", [ent.secret, U.adminZtp]);
ok(hors.ok && hors.rows[0].user_id === U.admin, "l'administration ne donne pas une conversation à une personne hors de l'entreprise");
ok((await comme("admin", "select agent_membre_de($1, $2) v", [U.superAilleurs, ent.secret])).rows[0].v === false, "S7 : un super_admin d'une autre organisation n'est pas de l'entreprise");
ok((await comme("admin", "select agent_membre_de($1, $2) v", [U.jeremy, ent.secret])).rows[0].v === true, "… celui de l'organisation, oui");
const horsOrg = await comme("admin", "insert into agent_conversations (entite_id, titre, user_id) values ($1, 'x', $2) returning user_id", [ent.secret, U.superAilleurs]);
ok(horsOrg.ok && horsOrg.rows[0].user_id === U.admin, "S7 : aucune conversation au nom d'un super_admin d'une autre organisation");

console.log("== Cartes ==");
const carte = async (k, conv) => (await comme(k, "insert into agent_cartes (conversation_id, genre, titre, donnees) values ($1, 'dossier', 'Dossier test', '{\"client\": {\"nom\": \"Client Test\"}}'::jsonb) returning id", [conv])).rows[0].id;
const prendre = async (k, id) => { const r = await comme(k, "select prendre_agent_carte($1) as ok", [id]); return r.ok ? r.rows[0].ok : r.err; };
const prendreE = async (k, id, forcer = false) => (await comme(k, "select prendre_agent_carte_equipe($1, $2) r", [id, forcer])).rows[0].r;
const controler = async (k, id) => (await comme(k, "select controler_agent_carte($1) r", [id])).rows[0].r;
const ecarter = async (k, id) => { const r = await comme(k, "select ecarter_agent_carte($1) r", [id]); return r.ok ? r.rows[0].r : { err: r.err }; };
const statut = async (id) => (await un("select statut, decide_par, prise_par from agent_cartes where id = $1", [id]));
const vieillir = (id, sql) => db.exec(`select set_config('gestion.agent_carte', '1', false); update agent_cartes set ${sql} where id = '${id}'; select set_config('gestion.agent_carte', '', false);`);
const K = await carte("nani", cN.id);
ok((await prendreE("admin", K)).ok === true, "l'administration prend la carte de Nani");
ok((await statut(K)).prise_par === U.admin, "qui a pris la carte est noté");
const pN = await prendreE("nani", K);
ok(pN.ok === false && pN.raison === "prise" && pN.par === U.admin, "Nani, au même moment, la trouve prise, et par qui : rien n'est créé deux fois");
ok((await prendre("mook", K)) === false, "une autre saisie ne la prend jamais");
const p2 = await prendreE("admin", K);
ok(p2.ok === false && p2.raison === "prise" && p2.par === U.admin, "la même personne dans un second onglet la trouve prise aussi");
ok((await controler("admin", K)).ok === true, "juste avant d'écrire (et toutes les 45 s), la carte est toujours prise par l'administration, prise renouvelée");
// S1b : Nani écarte pendant la validation de l'administration.
const e1 = await ecarter("nani", K);
ok(e1.ok === false && e1.raison === "prise" && (await statut(K)).statut === "proposee", "S1b : écarter pendant la validation d'une autre personne est refusé");
const eDirect = await comme("nani", "update agent_cartes set statut = 'ecartee' where id = $1 returning statut", [K]);
ok(!eDirect.ok && /carte_prise/.test(eDirect.err), "S1b : même par l'API directe (déclencheur)");
// S1c : Nani rend la carte de l'administration puis la prend.
await comme("nani", "select rendre_agent_carte($1)", [K]);
ok((await statut(K)).prise_par === U.admin, "S1c : seule la personne qui a pris la carte la rend");
const volPrise = await comme("nani", "update agent_cartes set prise_le = null, prise_par = null where id = $1 returning prise_par", [K]);
ok(volPrise.ok && volPrise.rows[0].prise_par === U.admin, "S1c : la prise ne s'efface pas par une mise à jour ordinaire");
ok((await prendreE("nani", K)).ok === false, "S1c : Nani ne la prend toujours pas");
const v = await comme("admin", "update agent_cartes set statut = 'validee' where id = $1 returning statut, decide_par", [K]);
ok(v.ok && v.rows[0].decide_par === U.admin, "la carte validée porte qui l'a validée");
// S1 : Nani, sur un écran pas encore rafraîchi, écarte la carte validée.
const e2 = await ecarter("nani", K);
ok(e2.ok === false && e2.raison === "decidee" && e2.par === U.admin && (await statut(K)).statut === "validee", "S1 : écarter une carte validée est refusé (le dossier existe), avec qui l'a validée");
const e3 = await comme("admin", "update agent_cartes set statut = 'ecartee' where id = $1", [K]);
ok(!e3.ok && /carte_decidee/.test(e3.err), "S1 : une carte validée ne change plus de statut, même pour qui l'a validée");
ok((await prendre("nani", K)) === false && (await prendreE("nani", K, true)).raison === "decidee", "une carte validée ne se reprend jamais");
ok((await comme("admin", "update agent_cartes set decide_par = $2 where id = $1 returning decide_par", [K, U.nani])).rows[0].decide_par === U.admin, "l'auteur d'une décision ne se réécrit pas");
// Prise expirée : « Vérifier avant » laissé ouvert, écran endormi. La reprise se fait en le sachant ; l'ancienne validation est refusée.
const K2 = await carte("nani", cN.id);
ok((await prendreE("admin", K2)).ok === true, "l'administration prend une seconde carte");
await vieillir(K2, "prise_le = now() - interval '3 minutes'");
const exp = await prendreE("nani", K2);
ok(exp.ok === false && exp.raison === "expiree" && exp.par === U.admin, "prise expirée : Nani voit que l'administration était dessus");
ok((await prendreE("nani", K2, true)).ok === true, "… et la reprend en le sachant");
const ctl = await controler("admin", K2);
ok(ctl.ok === false && ctl.raison === "reprise" && ctl.par === U.nani, "l'administration revient et enregistre : refusé avant toute écriture, rien n'est créé deux fois");
ok((await controler("nani", K2)).ok === true, "Nani, elle, peut enregistrer");
const e4 = await ecarter("nani", K2);
ok(e4.ok === true && (await statut(K2)).statut === "ecartee", "on écarte une carte qu'on tient soi-même");
// Écarter une carte libre.
const K3 = await carte("nani", cN.id);
ok((await ecarter("admin", K3)).ok === true, "l'administration écarte une carte libre de Nani");
ok((await controler("nani", K3)).raison === "decidee", "contrôle d'une carte écartée : refusé");
ok((await ecarter("mook", K3)).raison === "introuvable", "une autre saisie ne voit pas la carte");
const corps = async (f) => (await un("select prosrc s from pg_proc where proname = $1", [f])).s;
for (const f of ["prendre_agent_carte_equipe", "controler_agent_carte", "ecarter_agent_carte", "rendre_agent_carte"]) ok(/for update/.test(await corps(f)), `${f} lit la carte avec « for update »`);

console.log("== Une seule réponse à la fois ==");
const prise = async (k, c) => (await comme(k, "select prendre_agent_conversation($1) r", [c])).rows[0].r;
const r1 = await prise("admin", cN.id);
ok(r1.ok === true && r1.jeton, "l'administration prend la conversation pour une réponse");
const enCours = async (k) => (await comme(k, "select conversation_id, reponse_par from agent_reponses_en_cours($1)", [ent.secret])).rows;
ok((await enCours("admin")).some((x) => x.conversation_id === cN.id && x.reponse_par === U.admin), "réponses en cours à l'heure du serveur : l'administration la voit");
ok((await enCours("nani")).some((x) => x.conversation_id === cN.id && x.reponse_par === U.admin), "… Nani aussi, et par qui");
ok(!(await enCours("mook")).some((x) => x.conversation_id === cN.id), "… une autre saisie, non (RLS)");
const r2 = await prise("nani", cN.id);
ok(r2.ok === false && r2.raison === "occupee" && r2.par === U.admin, "Nani, au même moment, la trouve occupée (et par qui)");
ok((await prise("admin", cN.id)).ok === false, "un second onglet de la même personne la trouve occupée aussi");
const bloque = await comme("nani", "insert into agent_messages (conversation_id, role, contenu) values ($1, 'user', '[]')", [cN.id]);
ok(!bloque.ok && /conversation_occupee/.test(bloque.err), "un message d'une autre personne pendant la réponse est refusé par la base");
ok((await comme("admin", "insert into agent_messages (conversation_id, role, contenu) values ($1, 'assistant', '[]') returning id", [cN.id])).ok, "la personne qui a demandé la réponse continue d'écrire");
const f1 = await comme("nani", "insert into agent_fichiers (conversation_id, nom, media_type, taille, data) values ($1, 'test.pdf', 'application/pdf', 4, 'JVBE')", [cN.id]);
ok(!f1.ok && /conversation_occupee/.test(f1.err), "S4 : un fichier d'une autre personne pendant la réponse est refusé");
const k1 = await comme("nani", "insert into agent_cartes (conversation_id, genre, titre) values ($1, 'dossier', 'x')", [cN.id]);
ok(!k1.ok && /conversation_occupee/.test(k1.err), "S4 : une carte d'une autre personne pendant la réponse est refusée");
ok((await comme("admin", "insert into agent_cartes (conversation_id, genre, titre) values ($1, 'dossier', 'Carte de la réponse') returning id", [cN.id])).ok, "la réponse en cours ajoute ses cartes");
ok((await comme("nani", "update agent_conversations set reponse_le = null where id = $1 returning reponse_le", [cN.id])).rows[0].reponse_le !== null, "le verrou ne s'efface pas par une mise à jour ordinaire");
ok((await prise("mook", cN.id)).raison === "introuvable", "une conversation illisible est introuvable, sans dire qui l'occupe");
ok((await comme("nani", "select rendre_agent_conversation($1, gen_random_uuid()) r", [cN.id])).rows[0].r === false, "un mauvais jeton ne rend pas la conversation");
// Discussion pleine : remplacée dans une seule transaction, le verrou passe sur la nouvelle.
const cPleine = await nouvelle("nani", "secret", "Discussion pleine");
const rP = await prise("admin", cPleine.id);
ok((await comme("admin", "select remplacer_agent_conversation($1, gen_random_uuid()) r", [cPleine.id])).rows[0].r.ok === false, "remplacer : refusé sans le jeton de la réponse");
const rem = (await comme("admin", "select remplacer_agent_conversation($1, $2) r", [cPleine.id, rP.jeton])).rows[0].r;
ok(rem.ok === true && rem.user_id === U.nani, "remplacer : la nouvelle reste à Nani");
const etats = (await db.query("select id, statut, reponse_jeton from agent_conversations where id in ($1, $2)", [cPleine.id, rem.id])).rows;
ok(etats.find((x) => x.id === cPleine.id).statut === "archivee" && !etats.find((x) => x.id === cPleine.id).reponse_jeton, "remplacer : l'ancienne est archivée et rendue");
ok(etats.find((x) => x.id === rem.id).reponse_jeton === rem.jeton, "remplacer : la nouvelle est prise avec le nouveau jeton");
ok((await prise("nani", rem.id)).raison === "occupee", "remplacer : Nani trouve la nouvelle occupée pendant la réponse");
ok((await comme("admin", "select rendre_agent_conversation($1, $2) r", [rem.id, rem.jeton])).rows[0].r === true, "remplacer : la nouvelle se rend avec son jeton");
ok((await comme("admin", "select rendre_agent_conversation($1, $2) r", [cN.id, r1.jeton])).rows[0].r === true, "le bon jeton la rend");
const r3 = await prise("nani", cN.id);
ok(r3.ok === true, "rendue, la conversation se reprend");
// Vieillir la prise comme le ferait l'horloge (le réglage local que posent les fonctions du verrou).
await db.exec(`select set_config('gestion.agent_verrou', '1', false); update agent_conversations set reponse_le = now() - interval '4 minutes' where id = '${cN.id}'; select set_config('gestion.agent_verrou', '', false);`);
ok((await prise("admin", cN.id)).ok === true, "une prise de plus de 3 minutes (fonction arrêtée) se reprend");
ok((await comme("nani", "select rendre_agent_conversation($1, $2) r", [cN.id, r3.jeton])).rows[0].r === false, "la réponse arrêtée ne libère pas celle qui l'a reprise");
ok(/for update[\s\S]*update agent_conversations/.test(await corps("prendre_agent_conversation")), "prendre_agent_conversation lit la conversation avec « for update » avant de la prendre");
ok((await prise("admin", cM.id)).ok === true && (await prise("mook", cM.id)).ok === false, "prise par l'administration, la conversation reste prise pour sa propriétaire aussi");

console.log("== Droits des fonctions ==");
for (const f of ["prendre_agent_conversation($1)", "rendre_agent_conversation($1, gen_random_uuid())", "agent_voit_equipe($1)"]) {
  await db.exec("set role anon;");
  let anonOk;
  try { await db.query(`select ${f}`, [f.startsWith("agent_voit") ? ent.secret : cN.id]); anonOk = true; } catch { anonOk = false; } finally { await db.exec("reset role;"); }
  ok(!anonOk, `${f.split("(")[0]} fermée à anon`);
}
ok((await comme("adminZtp", "select agent_membre_de($1, $2) v", [U.nani, ent.secret])).rows[0].v === false, "agent_membre_de ne renseigne pas sur une entreprise dont on n'est pas membre");
ok((await comme("admin", "select agent_voit_equipe($1) v", [ent.secret])).rows[0].v === true && (await comme("nani", "select agent_voit_equipe($1) v", [ent.secret])).rows[0].v === false, "agent_voit_equipe : l'administration oui, la saisie non");

console.log("== Temps réel ==");
const pub = (await db.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime'")).rows.map((r) => r.tablename);
ok(pub.includes("agent_conversations") && pub.includes("agent_cartes") && !pub.includes("agent_messages"), "conversations et cartes en temps réel, pas les messages");

console.log("== Rejeu et retour en arrière ==");
await db.exec(lire(MIG));
ok((await voit("admin")).includes(cM.id), "la migration 133 se rejoue sans effet");
await db.exec(lire(RETOUR));
const vRetour = await voit("admin");
ok(!vRetour.includes(cN.id) && vRetour.includes(cA.id), "retour : chacun ne voit de nouveau que ses conversations");
ok((await un("select count(*)::int n from information_schema.columns where table_name in ('agent_messages', 'agent_cartes', 'agent_conversations') and column_name in ('auteur_id', 'decide_par', 'prise_par', 'reponse_par', 'reponse_le', 'reponse_jeton')")).n === 0, "retour : colonnes retirées");
ok(!(await un("select count(*)::int n from pg_proc where proname in ('prendre_agent_conversation', 'rendre_agent_conversation', 'agent_voit_equipe', 'agent_membre_de', 'noter_agent_message', 'prendre_agent_carte_equipe', 'controler_agent_carte', 'ecarter_agent_carte', 'remplacer_agent_conversation', 'agent_conversation_libre', 'agent_reponses_en_cours')")).n, "retour : fonctions retirées");
ok((await un("select count(*)::int n from agent_messages where conversation_id = $1", [cN.id])).n === 3, "retour : aucun message supprimé");
const KR = await carte("nani", cN.id);
ok((await prendre("nani", KR)) === true && (await prendre("nani", KR)) === false, "retour : la carte se prend comme avec la migration 120");
ok(!(await db.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime'")).rows.some((r) => r.tablename.startsWith("agent_")), "retour : plus de temps réel sur l'Assistant");
await db.exec(lire(MIG));
ok((await voit("admin")).includes(cN.id), "et la 133 se repose après le retour");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
