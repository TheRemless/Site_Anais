// Vérifie la migration 67 (l'Assistant lit la boîte WhatsApp, 21.11.2026) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// whatsapp_rechercher : un rôle sans whatsapp_lit ne trouve rien, un contact « jamais » n'est jamais rendu, la recherche trouve un mot, un
// préfixe et un numéro, les messages supprimés et la clé de service ne rendent rien. Revue de sécurité de la PR 295 : le texte rendu est
// entier et sans marqueur, l'outil de l'agent (agent-whatsapp-lecture.mjs, le même fichier que la fonction) le masque avant de le couper,
// aucun numéro ni IBAN ne sort même cherché par morceau ; préfixe dès 3 lettres ; chiffres sur 90 jours ; 3 secondes au plus ;
// whatsapp_admin de l'entreprise active ; taches.whatsapp_conversation_id.
//   GESTION_SQL=<repo>/docs/gestion/ GESTION_SRC=file://<repo>/src/gestion/js/ node verif-assistant-whatsapp.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
const SRC = process.env.GESTION_SRC || "../src/gestion/js/";
const L = await import(SRC + "agent-whatsapp-lecture.mjs");
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
grant all on all tables in schema storage to authenticated;
grant execute on function auth.uid() to authenticated, anon, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
for (const f of migrations) await db.exec(lire(f));
ok(migrations.includes("migration-67-assistant-whatsapp.sql"), "la migration 67 passe après les autres");
await db.exec(lire("migration-67-assistant-whatsapp.sql"));
ok(true, "la migration 67 se rejoue sans erreur (idempotente)");

async function essaie(userId, sql, params) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}

const ent = {};
for (const sl of ["ztp", "secret", "taxi"]) ent[sl] = (await db.query("select id from entites where slug = $1", [sl])).rows[0]?.id;
const ORG = (await db.query("select organisation_id from entites where id = $1", [ent.secret])).rows[0].organisation_id;
const u = {};
for (const k of ["adminSecret", "adminTaxi", "mook", "ztp", "personne"]) u[k] = (await db.query("insert into auth.users (email) values ($1) returning id", [k + "@test"])).rows[0].id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Éditeur sans réglages', 'toute', array['dossiers.lire', 'dossiers.ecrire', 'clients.lire', 'clients.ecrire'])`);
const membre = (user, entite, role) => db.exec(`insert into membres values ('${u[user]}', '${entite}', (select id from roles where entite_id = '${entite}' and nom = '${role}')) on conflict do nothing`);
await membre("adminSecret", ent.secret, "Administrateur");
await membre("adminTaxi", ent.taxi, "Administrateur");
await membre("mook", ent.secret, "Éditeur sans réglages");
if (ent.ztp) await membre("ztp", ent.ztp, "Administrateur");

const ranger = async (tel, m) => (await db.query("select whatsapp_ranger($1, $2, $3, $4::jsonb) r", [ORG, tel, m.nom || null, JSON.stringify(m)])).rows[0].r;
const base = { sens: "entrant", origine: "client", type: "text", medias: [] };
let n = 0;
const msg = (tel, texte, o = {}) => ranger(tel, { ...base, evenement_id: `ev-${++n}`, texte, envoye_le: new Date(Date.parse("2026-11-20T08:00:00Z") + n * 60000).toISOString(), ...o });

// Lucia (à trier) demande une excursion ; Tom (Taxi) parle d'un ferry et donne un numéro ; Somchai (Taxi) est un contact personnel.
const lucia = await msg("+12025550147", "Hi! Do you still have places for the 4 Islands tour on Saturday?", { nom: "Lucia" });
await msg("+12025550147", null, { type: "image", medias: [{ type: "image", legende: "Our hotel Lanta Sand", statut: "copie" }] });
const tom = await msg("+447700900311", "We want the ferry to Koh Phi Phi, my booking number is 20260142.", { nom: "Tom" });
const telTom = await msg("+447700900311", "My other phone is 081 234 5678", { nom: "Tom" });
// Un long message : le numéro et l'IBAN sont loin du début, un extrait coupé avant le masquage les laissait passer en morceaux.
const long = await msg("+447700900311", `${"blah ".repeat(60)}pickup 23.11.2026 / 0812345678 then pay to IBAN CH93 0076 2011 6238 5295 7 ${"blah ".repeat(60)}`, { nom: "Tom" });
// Un message de plus de 90 jours : ses chiffres ne se cherchent plus (ses mots oui).
const vieux = await msg("+447700900311", "Old voucher 9988-7766 for the snorkel", { nom: "Tom", envoye_le: new Date(Date.now() - 120 * 86400000).toISOString() });
const somchai = await msg("+447700900844", "Ferry tickets for my cousin tomorrow, call me", { nom: "Driver Somchai" });
const supprime = await msg("+447700900311", "secret banana word", { nom: "Tom" });
await db.query("update whatsapp_messages set supprime_le = now(), texte = null where id = $1", [supprime.message_id]);
await db.exec(`update whatsapp_conversations set entite_id = '${ent.taxi}', entite_source = 'manuel' where id in ('${tom.conversation_id}', '${somchai.conversation_id}')`);
let r = await essaie(u.adminTaxi, `update whatsapp_conversations set reponses = 'jamais' where id = '${somchai.conversation_id}'`);
ok(r.ok && r.n === 1, "Nani règle Somchai sur « Contact personnel »");

const cherche = (user, q, lim = 20) => essaie(user, "select * from whatsapp_rechercher($1, $2)", [q, lim]);

// ---- Droits ------------------------------------------------------------------------------------------------------------------------
for (const [qui, libelle] of [["mook", "Mook (éditrice sans réglages)"], ["ztp", "l'administratrice de ZTP"], ["personne", "une personne sans rôle"]]) {
  if (qui === "ztp" && !ent.ztp) continue;
  r = await cherche(u[qui], "ferry");
  ok(r.ok && r.rows.length === 0, `${libelle} ne trouve rien (pas de whatsapp_lit)`);
}
r = await db.query("select * from whatsapp_rechercher('ferry', 20)");
ok(r.rows.length === 0, "sans personne connectée (clé de service), rien : la fonction redit whatsapp_lit");
r = await essaie(u.adminSecret, "select prosecdef from pg_proc where proname = 'whatsapp_rechercher'");
ok(r.ok && r.rows[0].prosecdef === false, "whatsapp_rechercher est SECURITY INVOKER : la RLS s'applique");
await db.exec("set role anon");
var refus = null;
try { await db.query("select * from whatsapp_rechercher('ferry', 20)"); } catch (e) { refus = e.message; }
await db.exec("reset role");
ok(!!refus, "anon ne peut pas l'appeler");

// ---- Recherche ---------------------------------------------------------------------------------------------------------------------
r = await cherche(u.adminTaxi, "ferry");
ok(r.ok && r.rows.length === 1 && r.rows[0].conversation_id === tom.conversation_id && r.rows[0].message_id === tom.message_id, "un mot : « ferry » trouve le message de Tom");
ok(r.ok && r.rows[0].extrait === "We want the ferry to Koh Phi Phi, my booking number is 20260142.", "… avec le texte entier, sans marqueur ni coupe (l'agent masque avant de couper)");
ok(r.ok && !r.rows.some((x) => x.conversation_id === somchai.conversation_id), "le contact « jamais » n'est jamais rendu, même s'il dit « ferry »");
r = await cherche(u.adminSecret, "is");
ok(r.ok && !r.rows.some((x) => x.conversation_id === lucia.conversation_id), "deux lettres : un mot entier, pas un préfixe (« is » ne trouve pas « Islands »)");
r = await cherche(u.adminTaxi, "my booking");
ok(r.ok && r.rows.some((x) => x.message_id === tom.message_id), "… mais « my » trouve le mot « my »");
r = await cherche(u.adminSecret, "isl");
ok(r.ok && r.rows.length === 1 && r.rows[0].conversation_id === lucia.conversation_id, "un préfixe : « isl » trouve « Islands » (conversation à trier, lue par l'administrateur de Secret)");
r = await cherche(u.adminSecret, "lanta san");
ok(r.ok && r.rows.length === 1 && r.rows[0].conversation_id === lucia.conversation_id, "deux préfixes, dans la légende d'une photo");
r = await cherche(u.adminSecret, "Phi phi");
ok(r.ok && r.rows.length === 1 && r.rows[0].conversation_id === tom.conversation_id, "majuscules ignorées ; l'administrateur de Secret lit aussi Taxi (migration 63)");
r = await cherche(u.adminTaxi, "20260142");
ok(r.ok && r.rows.length >= 1 && r.rows.some((x) => x.message_id === tom.message_id), "un numéro de dossier écrit dans un message");
r = await cherche(u.adminTaxi, "0812345678");
ok(r.ok && r.rows.some((x) => x.conversation_id === tom.conversation_id), "un numéro écrit avec des espaces dans le message (« 081 234 5678 »)");
r = await cherche(u.adminTaxi, "99887766");
ok(r.ok && r.rows.length === 0, "les chiffres (écrits en morceaux) d'un message de plus de 90 jours ne se cherchent plus");
r = await cherche(u.adminTaxi, "snorkel");
ok(r.ok && r.rows.some((x) => x.message_id === vieux.message_id), "… ses mots, toujours (index plein texte)");
r = await cherche(u.adminTaxi, "+44 7700 900311");
ok(r.ok && r.rows.length >= 1 && r.rows.every((x) => x.conversation_id === tom.conversation_id), "le numéro du contact trouve sa conversation");
r = await cherche(u.adminTaxi, "+44 7700 900844");
ok(r.ok && r.rows.length === 0, "… mais jamais celle d'un contact « jamais »");
r = await cherche(u.adminTaxi, "banana");
ok(r.ok && r.rows.length === 0, "un message supprimé par le client ne se trouve plus");
r = await cherche(u.adminTaxi, "cousin");
ok(r.ok && r.rows.length === 0, "rien du contact personnel, même un mot qu'il est le seul à écrire");

// ---- Bornes et syntaxe -------------------------------------------------------------------------------------------------------------
r = await cherche(u.adminTaxi, "ferry & | ! ( ) : * ' \" \\ <>");
ok(r.ok && r.rows.length === 1, "les signes de la syntaxe des requêtes sont ignorés, sans erreur");
r = await cherche(u.adminTaxi, "x");
ok(r.ok && r.rows.length === 0, "un mot d'une lettre ne cherche rien");
r = await cherche(u.adminTaxi, "");
ok(r.ok && r.rows.length === 0, "une recherche vide ne rend rien");
r = await cherche(u.adminTaxi, "ferry", 100000);
ok(r.ok && r.rows.length === 1, "une limite démesurée est bornée");
r = await cherche(u.adminTaxi, "i", -5);
ok(r.ok, "une limite négative est bornée, sans erreur");
r = await cherche(u.adminTaxi, "ferry ".repeat(200));
ok(r.ok && r.rows.length === 1, "une recherche très longue est coupée à 100 caractères");
r = await cherche(u.adminTaxi, null, null);
ok(r.ok && r.rows.length === 0, "null ne casse rien");
const config = (await db.query("select proconfig from pg_proc where proname = 'whatsapp_rechercher'")).rows[0].proconfig || [];
ok(config.includes("statement_timeout=3s"), "3 secondes au plus");
await db.exec("set role service_role");
refus = null;
try { await db.query("select * from whatsapp_rechercher('ferry', 20)"); } catch (e) { refus = e.message; }
await db.exec("reset role");
ok(!!refus, "la clé de service ne peut pas l'appeler (et la fonction ne rend rien sans personne connectée)");

// ---- Numéros et IBAN : jamais en clair, même cherchés par morceau (chaîne complète : base, puis outil de l'agent) --------------------
const outil = async (user, texte) => {
  const t = await cherche(user, texte, 50);
  const convs = (await db.query("select * from whatsapp_conversations")).rows.map((c) => ({ ...c, created_at: new Date(c.created_at).toISOString(), dernier_message_le: c.dernier_message_le && new Date(c.dernier_message_le).toISOString() }));
  const trouves = (t.rows || []).map((x) => ({ ...x, envoye_le: new Date(x.envoye_le).toISOString() }));
  // Sans les identifiants ni les dates (des chiffres au hasard), pour ne regarder que le texte rendu.
  return JSON.stringify(L.chercherConversations({ texte, client: "", dossier: "", du: "", au: "", non_lus: false, attend_reponse: false }, { conversations: convs, trouves, entites: [{ id: ent.secret, slug: "secret" }, { id: ent.taxi, slug: "taxi" }] })).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "ID").replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "DATE");
};
for (const q of ["5678", "081 234", "0812345678", "234 5678", "0076", "CH93 0076", "6238 5295", "pickup"]) {
  const t = await outil(u.adminTaxi, q);
  ok(/"nom":"Tom"/.test(t), `« ${q} » : la conversation se trouve`);
  ok(!/0812345678|081 234 5678|234 5678|5678|CH93|0076|2011 6238|5295/.test(t), `« ${q} » : ni numéro ni IBAN en clair, même en morceaux`);
}
ok((await outil(u.adminTaxi, "pickup")).includes("23.11.2026"), "… la date, elle, reste lisible");
ok(telTom.message_id && long.message_id, "messages de contrôle rangés");

// ---- Droit d'utiliser les outils : administrer l'entreprise active (whatsapp_admin, migration 58) ----------------------------------
const admin = async (user, e) => (await essaie(user, "select whatsapp_admin($1) a", [e])).rows?.[0]?.a;
ok((await admin(u.adminSecret, ent.secret)) === true && (await admin(u.adminSecret, ent.taxi)) === false, "l'administrateur de Secret a les outils dans Secret, pas dans Taxi");
ok((await admin(u.adminTaxi, ent.taxi)) === true && (await admin(u.adminTaxi, ent.secret)) === false, "l'administrateur de Taxi, l'inverse");
ok((await admin(u.mook, ent.secret)) === false, "Mook jamais");
if (ent.ztp) ok((await admin(u.ztp, ent.ztp)) === false, "l'administratrice de ZTP jamais (ZTP n'a pas la boîte)");

// ---- taches.whatsapp_conversation_id ---------------------------------------------------------------------------------------------
const col = (await db.query("select is_nullable from information_schema.columns where table_name = 'taches' and column_name = 'whatsapp_conversation_id'")).rows[0];
ok(col && col.is_nullable === "YES", "colonne taches.whatsapp_conversation_id, vide permise");
const regle = (await db.query("select confdeltype from pg_constraint where conrelid = 'taches'::regclass and contype = 'f' and pg_get_constraintdef(oid) like '%whatsapp_conversations%'")).rows[0];
ok(regle && regle.confdeltype === "n", "référence vers la conversation, effacée avec elle (on delete set null)");
const tache = async (user, conv) => essaie(user, "insert into taches (entite_id, titre, description, echeance, whatsapp_conversation_id) values ($1, 'WhatsApp, Tom : confirmer', $2, '2026-11-20', $3) returning whatsapp_conversation_id w", [ent.taxi, L.MARQUE_PROMESSE, conv]);
r = await tache(u.adminTaxi, tom.conversation_id);
ok(r.ok && r.rows[0].w === tom.conversation_id, "une tâche se relie à une conversation lue");
const inconnue = "00000000-0000-4000-8000-000000000999";
r = await tache(u.adminTaxi, inconnue);
ok(r.ok && r.rows[0].w === null, "une conversation qui n'existe plus (corbeille) : la tâche s'écrit sans le lien");
const t1 = (await db.query("insert into taches (entite_id, titre, description, echeance, whatsapp_conversation_id) values ($1, 'WhatsApp, Lucia : rappeler', $2, '2026-11-20', $3) returning id", [ent.secret, L.MARQUE_PROMESSE, lucia.conversation_id])).rows[0].id;
ok((await db.query("select whatsapp_conversation_id w from taches where id = $1", [t1])).rows[0].w === lucia.conversation_id, "la fonction « whatsapp » (sans personne connectée) relie la tâche");
await db.query("delete from whatsapp_conversations where id = $1", [lucia.conversation_id]);
ok((await db.query("select whatsapp_conversation_id w from taches where id = $1", [t1])).rows[0].w === null, "la conversation purgée : la tâche reste, sans le lien");

// ---- whatsapp_partenaires_parmi (migration 67) : plus appelée depuis la 69 (l'IA lit aussi les partenaires), gardée en base. Ses droits ---
// ne bougent pas : elle ne rend que des clés de numéros déjà donnés, rien à Mook ni sans personne connectée.
const fiches = [
  [ent.taxi, "Chauffeurs", { telephones: [{ numero: "+66 81 111 2222" }, "089-333-4444"] }],
  [ent.secret, "Ferries et speedboats", { telephones: "075 123 4567, 076 765 4321  02 999 8888" }],
  [ent.secret, "Apporteur d'affaires", { telephones: ["+44 7700 900955"] }],
  [ent.ztp || ent.secret, "Hôtels", { telephones: [{ telephone: "+41 79 000 0001" }] }],
];
for (const [e, categorie, contact] of fiches) await db.query("insert into partenaires (entite_id, nom, categorie, contact) values ($1, $2, $3, $4::jsonb)", [e, `Fiche ${categorie}`, categorie, JSON.stringify(contact)]);
const tels = ["+66811112222", "+66893334444", "+66751234567", "+66767654321", "+6629998888", "+447700900955", "+41790000001", "+447700900311"];
// Les 9 derniers chiffres des numéros des fiches (sauf l'apporteur), parmi ceux donnés.
const attendu = ["751234567", "767654321", "790000001", "811112222", "893334444"];
r = await essaie(u.adminTaxi, "select whatsapp_partenaires_parmi($1::text[]) p", [tels]);
ok(r.ok && JSON.stringify(r.rows[0].p) === JSON.stringify(attendu), `numéros des fiches partenaires (${attendu.length} sur ${tels.length})`);
ok(r.ok && !r.rows[0].p.includes("700900955") && !r.rows[0].p.includes("700900311"), "… sauf l'apporteur et un client");
ok(r.ok && r.rows[0].p.includes("790000001"), "… fiches de toute l'organisation (même d'une entreprise que la personne ne lit pas)");
r = await essaie(u.mook, "select whatsapp_partenaires_parmi($1::text[]) p", [tels]);
ok(r.ok && r.rows[0].p.length === 0, "Mook n'apprend rien");
ok((await db.query("select whatsapp_partenaires_parmi($1::text[]) p", [tels])).rows[0].p.length === 0, "sans personne connectée, rien");

const plan = (await db.query("select indexdef from pg_indexes where indexname = 'whatsapp_messages_recherche'")).rows[0];
ok(plan && /gin/i.test(plan.indexdef) && /simple/.test(plan.indexdef), "index GIN, configuration « simple »");

// « Demander à l'assistant » sur une conversation à trier (PR 297) : la liaison est permise vers Secret ou Taxi, jamais vers une
// conversation rangée dans une autre entreprise que celle de l'Assistant.
{
  const aTrier = (await msg("+12025550999", "Hello, a tour for 2 on Monday?", { nom: "Inconnu" })).conversation_id;
  const rangeeTaxi = (await msg("+12025550888", "Taxi to the pier please", { nom: "Taxi client" })).conversation_id;
  await db.exec(`update whatsapp_conversations set entite_id = '${ent.taxi}' where id = '${rangeeTaxi}'`);
  ok((await db.query("select entite_id from whatsapp_conversations where id = $1", [aTrier])).rows[0].entite_id === null, "une conversation neuve est à trier");
  const lier = (user, entite, conv) => essaie(u[user], "insert into agent_conversations (entite_id, user_id, whatsapp_conversation_id) values ($1, $2, $3) returning id", [entite, u[user], conv]);
  let x = await lier("adminSecret", ent.secret, aTrier);
  if (!x.ok) console.log("    (détail)", x.err);
  ok(x.ok, "à trier : liée à l'Assistant de Secret (le déclencheur ne refuse plus)");
  x = await lier("adminSecret", ent.secret, rangeeTaxi);
  ok(!x.ok, "rangée chez Taxi : refusée depuis l'Assistant de Secret");
  x = await lier("mook", ent.secret, aTrier);
  ok(!x.ok, "Mook (sans whatsapp_lit) : refusée");
  const sql = fs.readFileSync(W + "migration-67-assistant-whatsapp.sql", "utf8");
  ok(/c\.entite_id is null and exists \(\s*select 1 from entites e where e\.id = new\.entite_id and e\.organisation_id = c\.organisation_id and e\.slug in \('secret', 'taxi'\)/.test(sql), "à trier : seulement Secret ou Taxi de la même organisation");
}

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
