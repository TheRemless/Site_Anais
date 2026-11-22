// Vérifie la migration 74 (l'Assistant apprend de Nani) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// Une session de l'outil écrit toujours en son nom (auteur, source « outil », ni conversation ni réponse préparée reliées, même si elle
// envoie autre chose) ; sans session, seul un rôle serveur écrit (source « whatsapp », toujours avec sa conversation, auteur nul ou profil
// de la même organisation) ; une conversation ou une réponse préparée d'une autre entreprise est refusée ; une ligne par réponse préparée ;
// genres « remarque » et « retour » (raison de 200 caractères au plus) ; une ligne interne a tous ses nombres masqués par la base et
// n'apparaît jamais dans la vue agent_apprentissages_pour_ia (seule source des prompts) ; Mook et un
// lecteur ne notent rien ; aucune ligne ne parle de net ni de banque ; une conversation classée ensuite partenaire, chauffeur, hôtel,
// apporteur ou Contact personnel perd ses lignes, même après la purge de ses réponses préparées ; une conversation supprimée emporte les
// siennes ; les lectures et suppressions de la migration 54 ne changent pas ; la migration se rejoue ; retour.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-agent-apprendre-nani.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
let echecs = 0;
const ok = (c, msg) => { if (!c) { echecs++; console.log("  ECHEC:", msg); } else console.log("  ok:", msg); };
const harnais = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema public, auth, storage to authenticated, anon, service_role;
grant all on all tables in schema storage to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
for (const f of migrations) await db.exec(lire(f));
ok(migrations.includes("migration-74-apprentissages-nani.sql"), "la migration 74 passe avec les autres, sur une base vide");
await db.exec(lire("migration-74-apprentissages-nani.sql"));
ok(true, "la migration 74 se rejoue sans erreur");
// Comme Supabase : le rôle de la clé de service passe outre RLS et a tous les droits sur les tables.
await db.exec("alter role service_role bypassrls; grant all on all tables in schema public to service_role;");

async function essaie(role, userId, sql, params = []) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];

const ent = {};
for (const sl of ["ztp", "secret", "taxi"]) ent[sl] = (await un("select id from entites where slug = $1", [sl]))?.id;
const ORG = (await un("select organisation_id from entites where id = $1", [ent.secret])).organisation_id;
const U = {};
for (const k of ["anais", "nani", "mook", "lecteur", "ztp"]) U[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Assistante', 'toute', array['clients.lire','clients.ecrire','dossiers.lire','dossiers.ecrire','partenaires.lire'])`);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Mook test', 'toute', array['clients.lire','clients.ecrire','dossiers.lire','dossiers.ecrire'])`);
const membre = (u, s, role) => db.exec(`insert into membres values ('${U[u]}', '${ent[s]}', (select id from roles where entite_id = '${ent[s]}' and nom = '${role}')) on conflict do nothing`);
await membre("anais", "secret", "Administrateur");
await membre("nani", "secret", "Assistante");
await membre("mook", "secret", "Mook test");
await membre("lecteur", "secret", "Lecteur");
await membre("ztp", "ztp", "Administrateur");
const comme = (u, sql, p) => essaie("authenticated", U[u], sql, p);

// Une conversation WhatsApp de Secret et une réponse préparée (écrites par la fonction, ici le propriétaire).
const tel = "+447700900411";
const r0 = await un("select whatsapp_ranger($1, $2, null, $3::jsonb) r", [ORG, tel, JSON.stringify({ evenement_id: "e1", telnyx_id: "tx-1", sens: "entrant", origine: "client", type: "text", texte: "Hi, taxi to Krabi airport tomorrow?", medias: [], envoye_le: new Date(Date.now() - 600000).toISOString() })]);
const conv = r0.r.conversation_id;
await db.query("update whatsapp_conversations set entite_id = $1 where id = $2", [ent.secret, conv]);
const prop = (await un("insert into whatsapp_propositions (conversation_id, entite_id, statut, texte, langue) values ($1, $2, 'traitee', 'Hello, the transfer is 1,800 THB.', 'en') returning id", [conv, ent.secret])).id;
const propTaxi = (await un("insert into whatsapp_propositions (conversation_id, entite_id, statut, texte, langue) values ($1, $2, 'traitee', 'Hello', 'en') returning id", [conv, ent.taxi])).id;
// Une conversation d'une autre organisation.
const ORG2 = (await un("insert into organisations (nom) values ('Autre agence') returning id")).id;
const conv2 = (await un("select whatsapp_ranger($1, $2, null, $3::jsonb) r", [ORG2, "+447700900422", JSON.stringify({ evenement_id: "e2", telnyx_id: "tx-2", sens: "entrant", origine: "client", type: "text", texte: "Hi", medias: [], envoye_le: new Date().toISOString() })])).r.conversation_id;
const autreProfil = (await un("insert into auth.users (email) values ('ailleurs@test') returning id")).id;
await db.query("update profils set organisation_id = $1 where user_id = $2", [ORG2, autreProfil]);

console.log("== Écriture par la fonction (clé de service) ==");
const ins = (role, user, champs) => essaie(role, user, `insert into agent_apprentissages (entite_id, genre, contexte, avant, apres, source, proposition_id, whatsapp_conversation_id, user_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning user_id, source, proposition_id, whatsapp_conversation_id`, [champs.entite || ent.secret, champs.genre || "reponse", champs.contexte || "réponse WhatsApp en anglais", champs.avant ?? "The transfer is 1,800 THB.", champs.apres ?? "Ok perfect the round trip is 800 THB.", champs.source || null, champs.proposition || null, champs.conversation === undefined ? conv : champs.conversation, champs.user || null]);
let r = await ins("service_role", null, { proposition: prop });
ok(r.ok && r.rows[0].user_id === null && r.rows[0].source === "whatsapp" && r.rows[0].proposition_id === prop && r.rows[0].whatsapp_conversation_id === conv, "réponse depuis l'app : sans auteur, source « whatsapp », reliée à sa conversation et à la réponse préparée");
r = await ins("service_role", null, { proposition: prop });
ok(!r.ok && /unique|duplicate/i.test(r.err), "une seule ligne par réponse préparée : un événement rejoué ne note rien de plus");
r = await ins("service_role", null, { proposition: propTaxi });
ok(!r.ok && /proposition_autre_entreprise/.test(r.err), "une réponse préparée d'une autre entreprise (Taxi) ne se relie pas à Secret");
r = await ins("service_role", null, { conversation: null });
ok(!r.ok && /conversation_requise/.test(r.err), "une ligne de la fonction sans conversation est refusée");
r = await ins("service_role", null, { conversation: conv2 });
ok(!r.ok && /conversation_autre_entreprise/.test(r.err), "une conversation d'une autre organisation est refusée");
r = await ins("service_role", null, { entite: ent.taxi });
ok(!r.ok && /conversation_autre_entreprise/.test(r.err), "une conversation de Secret ne se relie pas à une ligne de Taxi");
r = await ins("service_role", null, { entite: ent.ztp, proposition: prop });
ok(!r.ok, "une réponse préparée de Secret ne se relie pas à ZTP");
// Envoi depuis Gestion : la personne qui a envoyé (passée par whatsapp-envoi), un profil de la même organisation.
r = await ins("service_role", null, { user: U.anais, avant: "Hello", apres: "Hi there, see you at the pier" });
ok(r.ok && r.rows[0].user_id === U.anais && r.rows[0].source === "whatsapp", "envoi depuis Gestion : l'auteur réel est gardé, source « whatsapp »");
r = await ins("service_role", null, { user: autreProfil, avant: "Hello", apres: "Hi from elsewhere" });
ok(!r.ok && /auteur_autre_organisation/.test(r.err), "un auteur d'une autre organisation est refusé");
r = await ins("service_role", null, { source: "outil", user: U.anais, avant: "Hello", apres: "Hi, source forcée" });
ok(r.ok && r.rows[0].source === "whatsapp", "la fonction ne se fait pas passer pour l'outil : source « whatsapp »");

console.log("== Écriture par l'outil (session) ==");
r = await ins("authenticated", U.nani, { genre: "retour", source: "whatsapp", proposition: prop, user: U.anais, avant: "Hello, the transfer is 1,800 THB.", apres: "Trop long, pas de prix sans source" });
ok(r.ok && r.rows[0].user_id === U.nani && r.rows[0].source === "outil" && r.rows[0].proposition_id === null && r.rows[0].whatsapp_conversation_id === null, "Nani note un « Pas bien » : en son nom, source « outil », rien de relié, même si elle envoie autre chose");
r = await ins("authenticated", U.nani, { genre: "retour", apres: "x".repeat(201) });
ok(!r.ok, "une raison de plus de 200 caractères est refusée par la base");
r = await ins("authenticated", U.nani, { genre: "retour", apres: "" });
ok(!r.ok, "un « Pas bien » sans raison est refusé");
// Une raison avec un montant n'est plus refusée : l'écran la range (prix de vente gardé, net masqué, question sinon).
r = await ins("authenticated", U.nani, { genre: "retour", apres: "Le prix pour le client est 1,800" });
ok(r.ok, "une raison avec un prix pour le client est acceptée");

console.log("== Ligne interne ==");
const insInterne = (role, user, champs) => essaie(role, user, `insert into agent_apprentissages (entite_id, genre, contexte, avant, apres, interne, whatsapp_conversation_id) values ($1, 'retour', $2, $3, $4, true, $5) returning id, contexte, avant, apres, interne`, [ent.secret, champs.contexte || "réponse de l'Assistant à l'équipe", champs.avant || "Le bateau 4 îles est à 2,500 THB", champs.apres || "Le bateau nous coûte 900 maintenant, 1.8k en haute saison", champs.conversation || null]);
r = await insInterne("authenticated", U.nani, {});
const interne1 = r.ok && r.rows[0];
ok(interne1 && interne1.interne === true && !/\d/.test(interne1.contexte + interne1.avant + interne1.apres), "une ligne interne envoyée avec ses montants en clair : la base masque chacun de ses nombres");
ok(interne1 && /\{montant\}/.test(interne1.apres) && /coûte \{montant\} maintenant/.test(interne1.apres), "… remplacés par {montant}");
r = await insInterne("service_role", null, { conversation: conv, avant: "Price 1 200", apres: "Achat 950" });
ok(r.ok && !/\d/.test(r.rows[0].avant + r.rows[0].apres), "même écrite par la fonction, une ligne interne est masquée");
const dansVue = async (qui) => (await comme(qui, `select id from agent_apprentissages_pour_ia where id = '${interne1.id}'`)).rows || [];
ok((await dansVue("nani")).length === 0, "la ligne interne n'est pas dans la vue lue par les prompts (session)");
ok((await un(`select count(*)::int n from agent_apprentissages_pour_ia where id = '${interne1.id}'`)).n === 0, "ni pour la clé de service");
ok((await un("select count(*)::int n from agent_apprentissages_pour_ia a join agent_apprentissages t using (id) where t.interne")).n === 0, "aucune ligne interne dans la vue");
ok((await comme("nani", `select id, interne from agent_apprentissages where id = '${interne1.id}'`)).rows.length === 1, "elle reste visible dans la table (« Suivi de l'assistant »)");
ok((await comme("mook", "select id from agent_apprentissages_pour_ia")).rows.length === 0, "vue security_invoker : Mook ne lit rien");
ok((await comme("ztp", "select id from agent_apprentissages_pour_ia")).rows.length === 0, "vue security_invoker : une autre entreprise ne lit rien");
ok(!(await essaie("anon", null, "select id from agent_apprentissages_pour_ia")).ok, "anon ne lit pas la vue");
ok((await comme("nani", "select id from agent_apprentissages_pour_ia")).rows.length > 0, "Nani lit la vue (lignes non internes)");
r = await ins("authenticated", U.nani, { genre: "remarque", avant: "Bagages : 2 valises", apres: "Bagages : 4 valises et une poussette" });
ok(r.ok, "une remarque retouchée se note (genre « remarque »)");
ok(!(await ins("authenticated", U.nani, { genre: "net" })).ok, "un genre inconnu est refusé");
ok(!(await ins("authenticated", U.mook, { genre: "retour", apres: "faux" })).ok, "Mook (sans « partenaires.lire ») ne note rien");
ok(!(await ins("authenticated", U.lecteur, { genre: "retour", apres: "faux" })).ok, "un lecteur ne note rien");
ok(!(await ins("authenticated", U.ztp, { genre: "retour", apres: "faux" })).ok, "une autre entreprise ne note rien chez Secret");
r = await ins("authenticated", null, { genre: "retour", apres: "faux", source: "whatsapp" });
ok(!r.ok, "sans session, le rôle authenticated n'écrit rien (pas de ligne « whatsapp » depuis un navigateur)");
r = await ins("anon", null, { genre: "retour", apres: "faux", source: "whatsapp" });
ok(!r.ok, "anon n'écrit rien");
ok(!(await comme("nani", "update agent_apprentissages set apres = 'x' returning id")).ok, "personne ne modifie une ligne");
ok(!(await comme("nani", "update agent_apprentissages set whatsapp_conversation_id = null returning id")).ok, "une session ne détache pas une ligne de sa conversation");

console.log("== Mots internes ==");
for (const [qui, role, user] of [["Nani", "authenticated", U.nani], ["la fonction", "service_role", null]]) {
  r = await ins(role, user, { genre: "retour", avant: "Partenaire Fictif net 1,000 per person", apres: "faux" });
  ok(!r.ok && /mot_interne/.test(r.err), `${qui} : une ligne qui parle de net est refusée par la base`);
  r = await ins(role, user, { genre: "reponse", avant: "Hello", apres: "Pay by KBank please" });
  ok(!r.ok && /mot_interne/.test(r.err), `${qui} : une ligne qui parle de banque est refusée par la base`);
}
r = await ins("authenticated", U.nani, { genre: "pickup", avant: "12:55", apres: "12:40, marge de 15 min avec le ferry" });
ok(r.ok, "« marge » d'un pickup reste permise");
ok((await ins("authenticated", U.nani, { genre: "reponse", avant: "Wifi internet ok", apres: "Kennedy Fictif will drive" })).ok, "un mot qui contient « net » n'est pas refusé");

console.log("== Lecture et suppression (migration 54, inchangées) ==");
let lus = await comme("nani", `select id, source from agent_apprentissages where entite_id = '${ent.secret}'`);
ok(lus.ok && lus.rows.some((x) => x.source === "whatsapp") && lus.rows.some((x) => x.source === "outil"), "Nani relit les lignes de l'entreprise, celles de la fonction comprises");
ok((await comme("mook", "select id from agent_apprentissages")).rows.length === 0, "Mook ne lit rien");
ok((await comme("ztp", "select id from agent_apprentissages")).rows.length === 0, "une autre entreprise ne lit rien");
ok((await comme("nani", "delete from agent_apprentissages returning id")).rows.length === 0, "l'assistante ne supprime pas");
ok((await comme("anais", "delete from agent_apprentissages where interne and source = 'whatsapp' returning id")).rows.length === 1, "l'administratrice supprime une ligne interne de la fonction");

console.log("== Conversation classée après coup, même après la purge des réponses préparées ==");
const prop2 = (await un("insert into whatsapp_propositions (conversation_id, entite_id, statut, texte, langue) values ($1, $2, 'traitee', 'Hello again', 'en') returning id", [conv, ent.secret])).id;
await ins("service_role", null, { proposition: prop2, avant: "Hello again", apres: "Hi, see you" });
const deLaConv = async () => Number((await un("select count(*) n from agent_apprentissages where whatsapp_conversation_id = $1", [conv])).n);
const n0 = await deLaConv();
ok(n0 >= 3, "des lignes tirées de la conversation");
// La purge des réponses préparées (90 jours) détache proposition_id ; la conversation reste reliée.
await db.query("delete from whatsapp_propositions where conversation_id = $1", [conv]);
ok((await deLaConv()) === n0 && Number((await un("select count(*) n from agent_apprentissages where whatsapp_conversation_id = $1 and proposition_id is not null", [conv])).n) === 0, "réponses préparées purgées : les lignes restent reliées à leur conversation");
// Le classement se fait par une personne (le déclencheur de la migration 70 garde celui de Nani face à la fonction).
ok((await comme("anais", "update whatsapp_conversations set nom = 'Tom' where id = $1", [conv])).ok, "(témoin) Anaïs renomme la conversation");
ok((await deLaConv()) === n0, "un nom changé ne retire rien");
ok((await comme("anais", "update whatsapp_conversations set type_contact = 'client' where id = $1", [conv])).ok, "(témoin) Anaïs type la conversation « client »");
ok((await deLaConv()) === n0, "typée « client » : les lignes restent");
ok((await comme("anais", "update whatsapp_conversations set type_contact = 'chauffeur' where id = $1", [conv])).ok, "(témoin) Anaïs la classe chauffeur");
ok((await deLaConv()) === 0, "classée chauffeur, après la purge des réponses préparées : ses lignes sont oubliées");
ok(Number((await un("select count(*) n from agent_apprentissages where entite_id = $1", [ent.secret])).n) > 0, "les autres lignes de l'entreprise restent");
ok((await comme("anais", "update whatsapp_conversations set type_contact = null where id = $1", [conv])).ok, "(témoin) Anaïs retire le type");
await ins("service_role", null, { avant: "Hello", apres: "Hi, back again" });
ok((await comme("anais", "update whatsapp_conversations set reponses = 'jamais' where id = $1", [conv])).ok, "(témoin) Anaïs passe la conversation en Contact personnel");
ok((await deLaConv()) === 0, "passée en Contact personnel : ses lignes sont oubliées");
ok((await comme("anais", "update whatsapp_conversations set reponses = 'auto' where id = $1", [conv])).ok, "(témoin) réponses remises");
await ins("service_role", null, { avant: "Hello", apres: "Hi, once more" });
ok((await comme("anais", "update whatsapp_conversations set type_contact = 'apporteur' where id = $1", [conv])).ok, "(témoin) Anaïs la classe apporteur");
ok((await deLaConv()) === 0, "classée apporteur : ses lignes sont oubliées");
r = await ins("service_role", null, { avant: "Hello", apres: "Hi, written too late" });
ok(!r.ok && /conversation_pas_client/.test(r.err), "une écriture de la fonction sur une conversation qui n'est plus un client est refusée par la base");
ok(!(await comme("nani", "select oublier_apprentissages_conversation()")).ok, "la fonction d'oubli ne s'appelle pas depuis l'outil");
// Une conversation supprimée emporte ses lignes : aucune ligne « whatsapp » orpheline.
ok((await comme("anais", "update whatsapp_conversations set type_contact = null where id = $1", [conv])).ok, "(témoin) Anaïs retire le type");
await ins("service_role", null, { avant: "Hello", apres: "Hi, last time" });
ok((await deLaConv()) === 1, "(témoin) une ligne de nouveau");
await db.query("delete from whatsapp_conversations where id = $1", [conv]);
ok(Number((await un("select count(*) n from agent_apprentissages where source = 'whatsapp' and whatsapp_conversation_id is null")).n) === 0 && (await deLaConv()) === 0, "conversation supprimée : ses lignes partent avec elle, aucune orpheline");

console.log("== Purge : 300 lignes par entreprise, comptées à part pour les lignes internes ==");
await db.exec("delete from agent_apprentissages");
for (let i = 0; i < 5; i++) await essaie("postgres", U.nani, `insert into agent_apprentissages (entite_id, genre, avant, apres) values ('${ent.secret}', 'pickup', '${i}', '${i + 1}')`);
for (let i = 0; i < 305; i++) await essaie("postgres", U.nani, `insert into agent_apprentissages (entite_id, genre, avant, apres, interne) values ('${ent.secret}', 'retour', 'x', 'raison ${i}', true)`);
const compte = await un(`select count(*) filter (where interne)::int i, count(*) filter (where not interne)::int p from agent_apprentissages where entite_id = '${ent.secret}'`);
ok(compte.i === 300 && compte.p === 5, "305 lignes internes : 300 gardées, les 5 corrections utiles restent");

console.log("== Contraintes ==");
r = await essaie("postgres", null, `insert into agent_apprentissages (entite_id, genre, avant, apres) values ('${ent.secret}', 'reponse', 'a', 'b') returning source, user_id`);
ok(!r.ok && /conversation_requise/.test(r.err), "sans session ni conversation (SQL du tableau de bord) : refusé");
r = await essaie("postgres", null, `alter table agent_apprentissages disable trigger noter_agent_apprentissage; insert into agent_apprentissages (entite_id, genre, avant, apres, source) values ('${ent.secret}', 'reponse', 'a', 'b', 'outil')`);
await db.exec("alter table agent_apprentissages enable trigger noter_agent_apprentissage");
ok(!r.ok, "une ligne « outil » sans auteur est refusée par la contrainte");
r = await essaie("postgres", null, `alter table agent_apprentissages disable trigger noter_agent_apprentissage; insert into agent_apprentissages (entite_id, genre, avant, apres, source) values ('${ent.secret}', 'reponse', 'a', 'b', 'whatsapp')`);
await db.exec("alter table agent_apprentissages enable trigger noter_agent_apprentissage");
ok(!r.ok, "une ligne « whatsapp » sans conversation est refusée par la contrainte");

console.log("== Retour en arrière ==");
await db.exec(lire("retour-74-apprentissages-nani.sql"));
const n = await un("select count(*) filter (where user_id is null)::int n, count(*) filter (where genre in ('retour', 'remarque'))::int g, count(*)::int t from agent_apprentissages");
ok(n.n === 0 && n.g === 0 && n.t === 5, "retour : les lignes de la fonction et des nouveaux genres sont effacées, les corrections de l'outil restent");
ok(!(await un("select 1 x from pg_trigger where tgname = 'oublier_apprentissages'")), "retour : le déclencheur d'oubli est retiré");
ok(!(await un("select 1 x from information_schema.columns where table_name = 'agent_apprentissages' and column_name in ('source', 'proposition_id', 'whatsapp_conversation_id', 'interne')")), "retour : colonnes retirées");
ok(!(await un("select 1 x from information_schema.views where table_name = 'agent_apprentissages_pour_ia'")), "retour : la vue est retirée");
ok(!(await comme("nani", `insert into agent_apprentissages (entite_id, genre, avant, apres) values ('${ent.secret}', 'retour', 'a', 'b')`)).ok, "retour : le genre « retour » n'existe plus");
r = await comme("nani", `insert into agent_apprentissages (entite_id, genre, avant, apres) values ('${ent.secret}', 'pickup', '12:55', '12:40') returning user_id`);
ok(r.ok && r.rows[0].user_id === U.nani, "retour : une correction de l'outil se note comme avant");
await db.exec(lire("migration-74-apprentissages-nani.sql"));
const conv3 = (await un("select whatsapp_ranger($1, $2, null, $3::jsonb) r", [ORG, "+447700900433", JSON.stringify({ evenement_id: "e3", telnyx_id: "tx-3", sens: "entrant", origine: "client", type: "text", texte: "Hi", medias: [], envoye_le: new Date().toISOString() })])).r.conversation_id;
r = await ins("service_role", null, { conversation: conv3 });
ok(r.ok && r.rows[0].source === "whatsapp", "la migration se rejoue après le retour");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
