// Vérifie la migration 100 (messages WhatsApp manquants) sur un Postgres en mémoire : schema.sql, toutes les migrations jusqu'à la 99,
// des conversations et des événements inventés, puis la 100. BSUID rempli depuis les événements (seulement quand il est sûr), client sans
// numéro rangé et retrouvé par son BSUID, ligne « non transmis » remplacée par le vrai message, id Telnyx complété après un rattrapage,
// repère posé et effacé, droits réservés à la clé de service, migration rejouée, retour en arrière.
// Dépôt public : numéros fictifs (+447700900…), BSUID et textes inventés.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-whatsapp-manquants.mjs
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
grant all on all tables in schema storage to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const numero = (n) => parseInt(n.split("-")[1]);
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const toutes = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d|1\d\d)-.*\.sql$/.test(n)).sort((a, b) => numero(a) - numero(b));
for (const f of toutes.filter((f) => numero(f) < 100)) await db.exec(lire(f));

async function essaie(userId, sql, params = [], role = "authenticated") {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const ent = {};
for (const sl of ["ztp", "secret", "taxi"]) ent[sl] = (await un("select id from entites where slug = $1", [sl]))?.id;
const ORG = (await un("select organisation_id from entites where id = $1", [ent.secret])).organisation_id;
const nani = (await un("insert into auth.users (email) values ('nani@test') returning id")).id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
await db.exec(`insert into membres values ('${nani}', '${ent.secret}', (select id from roles where entite_id = '${ent.secret}' and nom = 'Administrateur')) on conflict do nothing`);

// ---- Avant la 100 : deux conversations et leurs événements (forme Telnyx, inventée) ------------------------------------------------
const A = "+447700900401", B = "+447700900402", NANI = "+447700900400";
const BA = "GB.10000000000000000401", BB1 = "GB.10000000000000000402", BB2 = "GB.10000000000000000499";
const ranger0 = (tel, m) => un("select whatsapp_ranger($1, $2, null, $3::jsonb) r", [ORG, tel, JSON.stringify(m)]);
const msg = (n, extra = {}) => ({ evenement_id: `e${n}`, telnyx_id: `tx-${n}`, meta_id: `wamid.${n}`, sens: "entrant", origine: "client", type: "text", texte: "Hello", medias: [], envoye_le: new Date(Date.now() - (200 - n) * 60000).toISOString(), ...extra });
const convA = (await ranger0(A, msg(1))).r.conversation_id;
const convB = (await ranger0(B, msg(2))).r.conversation_id;
const evenement = (id, type, payload) => db.query("insert into whatsapp_evenements (id, type, organisation_id, brut, traite_le) values ($1, $2, $3, $4::jsonb, now())", [id, type, ORG, JSON.stringify({ data: { id, event_type: type, payload } })]);
await evenement("ev-a1", "message.received", { from: { phone_number: A }, to: NANI, body: { from_user_id: BA } });
await evenement("ev-a2", "message.echo", { from: { phone_number: NANI }, to: A, body: { to_user_id: BA } });
// B a vu deux BSUID différents : on ne devine pas.
await evenement("ev-b1", "message.received", { from: { phone_number: B }, to: NANI, body: { from_user_id: BB1 } });
await evenement("ev-b2", "message.received", { from: { phone_number: B }, to: NANI, body: { from_user_id: BB2 } });

// ---- La 100 -------------------------------------------------------------------------------------------------------------------
ok(toutes.includes("migration-100-whatsapp-manquants.sql"), "la migration 100 est là");
await db.exec(lire("migration-100-whatsapp-manquants.sql"));
await db.exec(lire("migration-100-whatsapp-manquants.sql"));
ok(true, "la migration passe après les autres et se rejoue");
const conv = (id) => un("select * from whatsapp_conversations where id = $1", [id]);
ok((await conv(convA)).bsuid === BA, "BSUID rempli depuis les événements gardés (reçu et écho)");
ok((await conv(convB)).bsuid === null, "deux BSUID différents pour un numéro : rien de deviné");

// ---- Rangement par BSUID ---------------------------------------------------------------------------------------------------------
const ranger = (tel, m, bsuid = null) => un("select whatsapp_ranger($1, $2, null, $3::jsonb) r", [ORG, tel, JSON.stringify({ ...m, bsuid })]);
let r = (await ranger(null, msg(3), BA)).r;
ok(r.conversation_id === convA && r.nouveau === true, "sans numéro, le BSUID retrouve la conversation");
const C = "GB.10000000000000000403";
r = (await ranger(null, msg(4), C)).r;
const convC = r.conversation_id;
let c = await conv(convC);
ok(r.nouveau && c.telephone === null && c.bsuid === C && c.entite_id === null, "client sans numéro : nouvelle conversation à trier, rangée par son BSUID");
r = (await ranger(null, msg(5), C)).r;
ok(r.conversation_id === convC, "… et retrouvée au message suivant");
const telC = "+447700900403";
r = (await ranger(telC, msg(6), C)).r;
c = await conv(convC);
ok(r.conversation_id === convC && c.telephone === telC, "le numéro arrive plus tard : noté sur la même conversation");
r = (await ranger(B, msg(7), BB1)).r;
ok(r.conversation_id === convB && (await conv(convB)).bsuid === BB1, "conversation connue par son numéro : le BSUID est noté une fois");
await ranger(B, msg(8), BB2);
ok((await conv(convB)).bsuid === BB1, "… et jamais remplacé");
let err = null;
try { await ranger(null, msg(9), null); } catch (e) { err = e.message; }
ok(/sans_identifiant/.test(err || ""), "ni numéro ni BSUID : refusé");
err = null;
try { await ranger(null, msg(10), "pas un bsuid"); } catch (e) { err = e.message; }
ok(/sans_identifiant/.test(err || ""), "BSUID mal formé : refusé");
const avant = (await un("select count(*)::int n from whatsapp_conversations")).n;
err = null;
try { await db.query("insert into whatsapp_conversations (organisation_id) values ($1)", [ORG]); } catch (e) { err = e.message; }
ok(!!err && (await un("select count(*)::int n from whatsapp_conversations")).n === avant, "la base refuse une conversation sans numéro ni BSUID");

// ---- Ligne « non transmis » remplacée par le vrai message ----------------------------------------------------------------------------
const nt = (await ranger(A, msg(11, { telnyx_id: null, type: "non_transmis", texte: null }), BA)).r;
const nonLus = (await conv(convA)).non_lus;
ok(nt.nouveau === true, "ligne « non transmis » rangée, sans texte");
ok((await conv(convA)).dernier_type === "non_transmis" && (await conv(convA)).attend_depuis !== null, "elle apparaît dans la liste (type) et le client attend une réponse");
r = (await ranger(A, msg(11, { evenement_id: "e11-vrai", texte: "The real text" }), BA)).r;
let m = await un("select type, texte, telnyx_id from whatsapp_messages where id = $1", [nt.message_id]);
ok(r.nouveau === true && r.remplace === true && r.message_id === nt.message_id, "le vrai message (même wamid) remplace la ligne");
ok(m.type === "text" && m.texte === "The real text" && m.telnyx_id === "tx-11", "type, texte et id Telnyx du vrai message");
ok((await conv(convA)).non_lus === nonLus, "pas de non-lu de plus");
r = (await ranger(A, msg(11, { evenement_id: "e11-bis", type: "non_transmis", texte: null }), BA)).r;
ok(r.nouveau === false && (await un("select texte from whatsapp_messages where id = $1", [nt.message_id])).texte === "The real text", "une ligne « non transmis » tardive n'écrase pas le vrai message");

// ---- Rattrapage puis message.received : l'id Telnyx est complété ----------------------------------------------------------------
const rat = (await ranger(A, msg(12, { telnyx_id: null, evenement_id: "w12" }), BA)).r;
r = (await ranger(A, msg(12), BA)).r;
ok(r.nouveau === false && r.message_id === rat.message_id, "message.received après le rattrapage : pas de doublon");
ok((await un("select telnyx_id from whatsapp_messages where id = $1", [rat.message_id])).telnyx_id === "tx-12", "… et l'id Telnyx est noté (modifications et suppressions)");

// ---- Repère « semble manquer » ----------------------------------------------------------------------------------------------------
const quand = new Date(Date.now() - 30 * 60000).toISOString();
await un("select whatsapp_signaler_manque($1, $2) x", [convB, quand]);
ok((await conv(convB)).manque_le !== null, "repère posé sur la conversation");
await ranger(B, msg(13, { envoye_le: new Date().toISOString() }), BB1);
ok((await conv(convB)).manque_le === null, "effacé au message suivant du client");
await un("select whatsapp_signaler_manque($1, $2) x", [convB, quand]);
ok((await conv(convB)).manque_le === null, "pas posé si le client a écrit depuis cette réponse");
await ranger(B, msg(14, { sens: "sortant", origine: "app", envoye_le: new Date(Date.now() + 60000).toISOString() }), BB1);
ok((await conv(convB)).manque_le === null, "une réponse de Nani ne pose rien d'elle-même");
const idM = (await un("select id from whatsapp_messages where evenement_id = 'e14'")).id;

// Repère effacé par le message du client arrivé en retard (envoyé AVANT la réponse de Nani qui portait le repère).
const echo = (await ranger(B, msg(15, { sens: "sortant", origine: "app", envoye_le: new Date(Date.now() + 120000).toISOString() }), BB1)).r;
await db.query("update whatsapp_messages set repere = 'semble_manquer' where id = $1", [echo.message_id]);
await un("select whatsapp_signaler_manque($1, $2) x", [convB, new Date(Date.now() + 120000).toISOString()]);
ok((await conv(convB)).manque_le !== null, "(témoin) repère posé sur la réponse de Nani et sur la liste");
await ranger(B, msg(16, { envoye_le: new Date(Date.now() + 90000).toISOString() }), BB1);
ok((await conv(convB)).manque_le === null, "message du client en retard : repère de la liste effacé");
ok((await un("select repere from whatsapp_messages where id = $1", [echo.message_id])).repere === null, "… et celui de la réponse de Nani qu'il précède");
await db.query("update whatsapp_messages set repere = 'semble_manquer' where id = $1", [echo.message_id]);
await ranger(B, msg(17, { envoye_le: new Date(Date.now() + 300000).toISOString() }), BB1);
ok((await un("select repere from whatsapp_messages where id = $1", [echo.message_id])).repere === "semble_manquer", "un message du client plus récent laisse le repère de la réponse (le message manquant manque toujours)");

// ---- Même BSUID, autre numéro : jamais de changement de numéro, une nouvelle conversation signalée ------------------------------------
const A2 = "+447700900411";
r = (await ranger(A2, msg(40), BA)).r;
const convA2 = r.conversation_id;
let c2 = await conv(convA2);
ok(convA2 !== convA && c2.telephone === A2 && c2.meme_client_que === convA && c2.bsuid === null, "nouveau numéro : nouvelle conversation qui pointe vers l'ancienne");
ok((await conv(convA)).telephone === A && (await conv(convA)).bsuid === BA, "l'ancienne garde son numéro et son BSUID");
r = (await ranger(A2, msg(41), BA)).r;
ok(r.conversation_id === convA2, "le message suivant du nouveau numéro va dans sa conversation");
r = (await ranger(null, msg(42), BA)).r;
ok(r.conversation_id === convA, "un message sans numéro va à la conversation du BSUID");

// ---- Conversation vue d'abord sans numéro, rattachée dès que son numéro arrive ----------------------------------------------------
const Y = "+447700900420";
const convY = (await ranger0(Y, msg(50))).r.conversation_id;
// Réglé par Nani (le déclencheur de la migration 60 garde ce réglage contre la clé de service) : ici, déclencheur coupé le temps du réglage.
const reglerPersonnel = async (id) => {
  await db.exec("alter table whatsapp_conversations disable trigger whatsapp_proteger_classement");
  await db.query("update whatsapp_conversations set reponses = 'jamais' where id = $1", [id]);
  await db.exec("alter table whatsapp_conversations enable trigger whatsapp_proteger_classement");
};
await reglerPersonnel(convY);
ok((await conv(convY)).reponses === "jamais", "(témoin) Contact personnel réglé");
const BZ = "GB.10000000000000000420";
const convZ = (await ranger(null, msg(51), BZ)).r.conversation_id;
await ranger(null, msg(52), BZ);
ok(convZ !== convY && (await conv(convZ)).telephone === null, "(témoin) le Contact personnel écrit sans numéro : conversation à part");
await db.query("insert into taches (entite_id, titre, whatsapp_conversation_id) values ($1, 'Rappeler', $2)", [ent.secret, convZ]).catch(() => {});
r = (await ranger(Y, msg(53), BZ)).r;
ok(r.conversation_id === convY, "son numéro arrive avec le même BSUID : rangé chez le Contact personnel");
ok(!(await conv(convZ)), "la conversation sans numéro est rattachée puis disparaît");
ok((await un("select count(*)::int n from whatsapp_messages where conversation_id = $1", [convY])).n === 4, "ses messages sont passés à la conversation du numéro");
const cy = await conv(convY);
ok(cy.bsuid === BZ && cy.reponses === "jamais", "BSUID noté, toujours Contact personnel");
const tache = await un("select whatsapp_conversation_id from taches where titre = 'Rappeler'");
ok(!tache || tache.whatsapp_conversation_id === convY, "ce qui citait la conversation rattachée suit");
// L'inverse : une conversation sans numéro réglée « Contact personnel » ne se fond pas dans une conversation ouverte à l'IA.
const Q = "+447700900430", BQ = "GB.10000000000000000430";
const convQ = (await ranger0(Q, msg(60))).r.conversation_id;
const convP = (await ranger(null, msg(61), BQ)).r.conversation_id;
await reglerPersonnel(convP);
r = (await ranger(Q, msg(62), BQ)).r;
ok(r.conversation_id === convQ && !!(await conv(convP)) && (await conv(convQ)).meme_client_que === convP, "Contact personnel sans numéro : pas de fusion, seulement « nouveau numéro pour ce client »");
await db.query("update whatsapp_messages set repere = 'semble_manquer' where id = $1", [idM]);
err = null;
try { await db.query("update whatsapp_messages set repere = 'autre' where id = $1", [idM]); } catch (e) { err = e.message; }
ok(!!err, "repere : seulement « semble_manquer »");

// ---- Droits -----------------------------------------------------------------------------------------------------------------
for (const [qui, role] of [[nani, "authenticated"], [null, "anon"]]) {
  const nom = qui ? "Nani" : "anon";
  ok(!(await essaie(qui, "select whatsapp_ranger($1, $2, null, $3::jsonb)", [ORG, A, JSON.stringify(msg(20))], role)).ok, `${nom} n'appelle pas whatsapp_ranger`);
  ok(!(await essaie(qui, "select whatsapp_signaler_manque($1, now())", [convA], role)).ok, `${nom} n'appelle pas whatsapp_signaler_manque`);
  ok(!(await essaie(qui, "select whatsapp_rattacher($1, $2)", [convA2, convA], role)).ok, `${nom} n'appelle pas whatsapp_rattacher`);
  for (const col of ["bsuid", "manque_le", "telephone", "meme_client_que"]) {
    const t = await essaie(qui, `update whatsapp_conversations set ${col} = null where id = $1`, [convB], role);
    ok(!t.ok || t.n === 0, `${nom} ne modifie pas ${col}`);
  }
  const t = await essaie(qui, "update whatsapp_messages set repere = null where id = $1", [idM], role);
  ok(!t.ok || t.n === 0, `${nom} ne modifie pas repere`);
}

// ---- Voucher vers une conversation sans numéro : refusé avant tout envoi -----------------------------------------------------------
const sansNum = (await ranger(null, msg(21), "GB.10000000000000000421")).r.conversation_id;
err = null;
try {
  await un("select whatsapp_ranger_voucher($1, $2, $3, $4::jsonb) r", [sansNum, "11111111-1111-4111-8111-111111111111", "gestion-voucher:11111111-1111-4111-8111-111111111111:00000001-0000-4000-8000-000000000000", JSON.stringify({ texte: "v", medias: [{ statut: "voucher", reservation_id: "11111111-1111-4111-8111-111111111111" }] })]);
} catch (e) { err = e.message; }
ok(/sans_identifiant/.test(err || ""), "voucher vers une conversation sans numéro : refusé par la base");

// ---- Retour en arrière -----------------------------------------------------------------------------------------------------------
err = null;
try { await db.exec(lire("retour-100-whatsapp-manquants.sql")); } catch (e) { err = e.message; }
await db.exec("rollback").catch(() => {});
ok(/sans numéro/.test(err || ""), "le retour s'arrête tant qu'une conversation n'a pas de numéro");
ok(!!(await un("select 1 x from information_schema.columns where table_name = 'whatsapp_conversations' and column_name = 'bsuid'")), "… sans rien défaire");
await db.query("delete from whatsapp_conversations where telephone is null");
await db.exec(lire("retour-100-whatsapp-manquants.sql"));
ok(!(await un("select 1 x from information_schema.columns where table_name in ('whatsapp_conversations', 'whatsapp_messages') and column_name in ('bsuid', 'manque_le', 'meme_client_que', 'repere')")), "retour : colonnes retirées");
r = (await ranger0("+447700900499", msg(30))).r;
ok(r.nouveau === true, "retour : l'ancien whatsapp_ranger range de nouveau");
await db.exec(lire("migration-100-whatsapp-manquants.sql"));
ok(!!(await un("select 1 x from information_schema.columns where table_name = 'whatsapp_conversations' and column_name = 'bsuid'")), "la 100 repasse après le retour");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
