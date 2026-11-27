// Vérifie la migration 132 (message automatique de nuit, 27.11.2026) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// Clé de nuit et bornes, une seule réservation par conversation et par nuit même pour deux appels simultanés, contacts exclus, réglage coupé,
// équipe qui a déjà écrit, résultat de Telnyx et reprise sans doublon, réglage réservé aux administrateurs, aperçu de la liste, retour arrière.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-whatsapp-message-nuit.mjs   (depuis un dossier où @electric-sql/pglite est installé)
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
grant all on all tables in schema storage to authenticated;
grant execute on function auth.uid() to authenticated, anon, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const TEXTE = "🌴 Hello and thank you for contacting us !\n\nOur team is currently away, but we’ll get back to you as soon as possible around 7:00 AM (Thailand time).\n\nIn the meantime, please feel free to send us all the details of your request so we can assist you more efficiently:\n\nThe more details you share, the more accurately we can assist you when we get back to you !\n\nThank you for your patience. We look forward to helping you discover Thailand ! 🇹🇭🌴";

const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d|1\d\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
ok(migrations.at(-1) === "migration-132-whatsapp-message-nuit.sql" || migrations.includes("migration-132-whatsapp-message-nuit.sql"), "la migration 132 passe après les autres");
for (const f of migrations) await db.exec(lire(f));
await db.exec(lire("migration-132-whatsapp-message-nuit.sql"));
ok(true, "la migration 132 se rejoue sans erreur");

async function essaie(userId, sql, params) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
const un = async (sql, p) => (await db.query(sql, p)).rows[0];

// ---- Clé de nuit et bornes (heure de Bangkok, UTC+7) -----------------------------------------------------------------------------
const cle = async (iso, debut = "22:00", fin = "06:00") => {
  const r = await un("select whatsapp_nuit_cle($1::timestamptz, $2::time, $3::time)::text c", [iso, debut, fin]);
  return r.c;
};
ok((await cle("2026-11-27T21:59:00+07:00")) === null, "21:59 : de jour");
ok((await cle("2026-11-27T22:00:00+07:00")) === "2026-11-27", "22:00 : nuit du 27");
ok((await cle("2026-11-27T23:59:59+07:00")) === "2026-11-27", "23:59 : nuit du 27");
ok((await cle("2026-11-28T00:00:00+07:00")) === "2026-11-27", "minuit : encore la nuit du 27");
ok((await cle("2026-11-28T01:00:00+07:00")) === "2026-11-27", "01:00 le 28 : nuit du 27");
ok((await cle("2026-11-28T05:59:00+07:00")) === "2026-11-27", "05:59 : nuit du 27");
ok((await cle("2026-11-28T06:00:00+07:00")) === null, "06:00 : de jour");
ok((await cle("2026-11-28T12:00:00+07:00")) === null, "midi : de jour");
ok((await cle("2026-11-27T15:00:00Z")) === "2026-11-27", "15:00 UTC = 22:00 à Bangkok");
ok((await cle("2026-11-27T14:59:00Z")) === null, "14:59 UTC = 21:59 à Bangkok");
ok((await cle("2026-12-31T23:30:00+07:00")) === "2026-12-31" && (await cle("2027-01-01T02:00:00+07:00")) === "2026-12-31", "passage d'année");
ok((await cle("2026-11-28T03:00:00+07:00", "01:00", "05:00")) === "2026-11-28" && (await cle("2026-11-28T05:00:00+07:00", "01:00", "05:00")) === null, "plage sans minuit (01:00 à 05:00)");

// ---- Texte et réglages par défaut ------------------------------------------------------------------------------------------------
const ent = {};
for (const sl of ["ztp", "secret", "taxi"]) ent[sl] = (await un("select id from entites where slug = $1", [sl]))?.id;
const ORG = (await un("select organisation_id from entites where id = $1", [ent.secret])).organisation_id;
await db.query("insert into whatsapp_reglages (organisation_id) values ($1) on conflict do nothing", [ORG]);
const regl = await un("select nuit_active, nuit_texte, to_char(nuit_debut, 'HH24:MI') d, to_char(nuit_fin, 'HH24:MI') f from whatsapp_reglages where organisation_id = $1", [ORG]);
ok(regl.nuit_active === true && regl.d === "22:00" && regl.f === "06:00", "activé par défaut, de 22:00 à 06:00");
ok(regl.nuit_texte === TEXTE, "le texte par défaut est celui de Jérémy, mot pour mot (emojis, espaces avant « ! », apostrophe typographique)");

// Pour la suite, « maintenant » est la nuit : la plage est posée autour de l'heure actuelle de Bangkok.
const hm = (d) => d.toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false });
const maintenant = Date.now();
const debut = hm(new Date(maintenant - 3 * 3600_000));
const fin = hm(new Date(maintenant + 3 * 3600_000));
await db.query("update whatsapp_reglages set numero = '+66900000000', nuit_debut = $2::time, nuit_fin = $3::time where organisation_id = $1", [ORG, debut, fin]);

const u = {};
for (const k of ["adminSecret", "adminTaxi", "mook"]) u[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Éditeur sans réglages', 'toute', array['dossiers.lire', 'dossiers.ecrire'])`);
const membre = (user, entite, role) => db.exec(`insert into membres values ('${u[user]}', '${entite}', (select id from roles where entite_id = '${entite}' and nom = '${role}')) on conflict do nothing`);
await membre("adminSecret", ent.secret, "Administrateur");
await membre("adminTaxi", ent.taxi, "Administrateur");
await membre("mook", ent.secret, "Éditeur sans réglages");

const ranger = async (tel, m) => (await un("select whatsapp_ranger($1, $2, null, $3::jsonb) r", [ORG, tel, JSON.stringify(m)])).r;
const iso = (ms) => new Date(ms).toISOString();
let n = 0;
const client = (tel, o = {}) => ranger(tel, { sens: "entrant", origine: "client", type: "text", texte: "Hello", medias: [], evenement_id: `ev-${++n}`, envoye_le: iso(maintenant - 60_000), ...o });
const reserver = async (id) => (await db.query("select * from whatsapp_reserver_nuit($1)", [id])).rows;
const lignes = async (conv) => (await db.query("select * from whatsapp_messages_nuit where conversation_id = $1", [conv])).rows;

// ---- Une seule fois par personne et par nuit -------------------------------------------------------------------------------------
const a1 = await client("+66811110001");
const C = a1.conversation_id;
let r = await reserver(a1.message_id);
ok(r.length === 1 && r[0].telephone === "+66811110001" && r[0].numero === "+66900000000" && r[0].texte === TEXTE, "un client qui écrit la nuit : le message est réservé, avec le numéro et le texte");
const auto = await un("select sens, origine, type, statut_envoi, automatique, texte from whatsapp_messages where id = $1", [r[0].message_id]);
ok(auto.sens === "sortant" && auto.origine === "gestion" && auto.statut_envoi === "envoi" && auto.automatique === "nuit" && auto.texte === TEXTE, "… rangé avant l'appel : sortant, de Gestion, « envoi », marqué automatique");
const a2 = await client("+66811110001", { texte: "Are you there?", envoye_le: iso(maintenant - 30_000) });
ok((await reserver(a2.message_id)).length === 0 && (await lignes(C)).length === 1, "un second message la même nuit : rien de plus");
ok((await reserver(a1.message_id)).length === 0, "le même message rejoué : rien de plus");

// Deux webhooks à la même seconde, sur deux connexions : une seule réservation.
const b1 = await client("+66811110002");
const b2 = await client("+66811110002", { texte: "Hi again" });
// PGlite n'a qu'une connexion : la garantie contre deux webhooks simultanés est la contrainte unique, tentée ici directement.
let doublon = null;
try {
  await db.query("insert into whatsapp_messages_nuit (organisation_id, conversation_id, nuit) select organisation_id, conversation_id, nuit from whatsapp_messages_nuit where conversation_id = $1", [C]);
} catch (e) { doublon = e.message; }
ok(doublon && /whatsapp_messages_nuit_une_fois/.test(doublon), "la base refuse une seconde ligne pour la même conversation et la même nuit");
const [x1, x2] = await Promise.all([reserver(b1.message_id), reserver(b2.message_id)]);
ok(x1.length + x2.length === 1 && (await lignes(b1.conversation_id)).length === 1, "deux réservations lancées ensemble : un seul envoi");
const autos = await un("select count(*)::int n from whatsapp_messages where conversation_id = $1 and automatique = 'nuit'", [b1.conversation_id]);
ok(autos.n === 1, "… et un seul message automatique dans la conversation");

// ---- Ce qui ne déclenche rien -----------------------------------------------------------------------------------------------------
const rien = async (libelle, tel, prep, o = {}) => {
  const m = await client(tel, o);
  if (prep) await prep(m.conversation_id, m.message_id);
  ok((await reserver(m.message_id)).length === 0, libelle);
  return m;
};
await rien("une réaction ne déclenche rien", "+66811110010", null, { type: "reaction", texte: "👍" });
await rien("une ligne « non transmis » ne déclenche rien", "+66811110011", null, { type: "non_transmis", texte: null });
await rien("un message supprimé ne déclenche rien", "+66811110012", (c, m) => db.query("update whatsapp_messages set supprime_le = now() where id = $1", [m]));
const nani = await ranger("+66811110013", { sens: "sortant", origine: "app", type: "text", texte: "Bonne nuit", medias: [], telnyx_id: "tx-n1", envoye_le: iso(maintenant - 30_000) });
ok((await reserver(nani.message_id)).length === 0, "un message de Nani ne déclenche rien");
// Préparation : les déclencheurs de protection du classement (migrations 60, 70, 110) gardent un type posé sans session ; coupés le temps de poser le cas.
const poser = async (c, champs) => {
  await db.exec("alter table whatsapp_conversations disable trigger user");
  try { await db.query(`update whatsapp_conversations set ${champs} where id = $1`, [c]); }
  finally { await db.exec("alter table whatsapp_conversations enable trigger user"); }
};
const sansMigrations = async (col, val) => async (c) => poser(c, `${col} = ${val}`);
await rien("un Contact personnel (reponses = jamais) ne reçoit rien", "+66811110014", await sansMigrations("reponses", "'jamais'"));
await rien("un partenaire ne reçoit rien", "+66811110015", await sansMigrations("type_contact", "'partenaire'"));
await rien("un apporteur ne reçoit rien", "+66811110016", await sansMigrations("type_contact", "'apporteur'"));
const pid = (await un("insert into partenaires (entite_id, nom) values ($1, 'Fiche test') returning id", [ent.secret])).id;
await rien("une fiche partenaire ne reçoit rien", "+66811110017", await sansMigrations("partenaire_id", `'${pid}', entite_id = '${ent.secret}'`));
const typeClient = await client("+66811110018");
await poser(typeClient.conversation_id, "type_contact = 'client'");
ok((await reserver(typeClient.message_id)).length === 1, "un contact typé client reçoit le message");
// L'équipe a déjà écrit cette nuit.
const deja = await client("+66811110019", { envoye_le: iso(maintenant - 120_000) });
await ranger("+66811110019", { sens: "sortant", origine: "app", type: "text", texte: "I'm here", medias: [], telnyx_id: "tx-n2", envoye_le: iso(maintenant - 90_000) });
const deja2 = await client("+66811110019");
ok((await reserver(deja2.message_id)).length === 0, "Nani a déjà écrit depuis le début de la nuit : rien ne part");
// Une réponse de la veille au soir (avant le début de la nuit) n'empêche rien.
const veille = await ranger("+66811110020", { sens: "sortant", origine: "app", type: "text", texte: "See you", medias: [], telnyx_id: "tx-n3", envoye_le: iso(maintenant - 4 * 3600_000) });
const apres = await client("+66811110020");
ok(veille && (await reserver(apres.message_id)).length === 1, "une réponse d'avant le début de la nuit n'empêche pas le message");
// Un envoi de Gestion en échec n'est pas une réponse.
const echecG = await client("+66811110021", { envoye_le: iso(maintenant - 120_000) });
await db.query("insert into whatsapp_messages (conversation_id, sens, origine, type, texte, envoye_le, statut_envoi, erreur_envoi) values ($1, 'sortant', 'gestion', 'text', 'x', $2, 'echec', 'telnyx_refuse')", [echecG.conversation_id, iso(maintenant - 100_000)]);
const echecG2 = await client("+66811110021");
ok((await reserver(echecG2.message_id)).length === 1, "un envoi de Gestion en échec ne compte pas comme une réponse");
// De jour, et nuit déjà finie.
await rien("un message de jour ne déclenche rien", "+66811110022", null, { envoye_le: iso(maintenant - 5 * 3600_000) });
await rien("un message d'une nuit passée (rattrapé tard) ne déclenche rien", "+66811110023", null, { envoye_le: iso(maintenant - 24 * 3600_000) });
// Réglage coupé.
await db.query("update whatsapp_reglages set nuit_active = false where organisation_id = $1", [ORG]);
await rien("réglage coupé : rien ne part", "+66811110024");
await db.query("update whatsapp_reglages set nuit_active = true where organisation_id = $1", [ORG]);
// Sans numéro de l'entreprise.
await db.query("update whatsapp_reglages set numero = null where organisation_id = $1", [ORG]);
await rien("numéro de l'entreprise inconnu : rien ne part", "+66811110025");
await db.query("update whatsapp_reglages set numero = '+66900000000' where organisation_id = $1", [ORG]);

// ---- Résultat de Telnyx et reprise ------------------------------------------------------------------------------------------------
const L = (await lignes(C))[0];
ok((await un("select whatsapp_nuit_resultat($1, 'envoye', 'tx-auto-1') r", [L.id])).r === true, "parti : résultat noté");
const envoye = await un("select statut_envoi, telnyx_id from whatsapp_messages where id = $1", [L.message_id]);
ok(envoye.statut_envoi === "envoye" && envoye.telnyx_id === "tx-auto-1" && (await lignes(C))[0].statut === "envoye", "… sur le message et sur la ligne de la nuit, ensemble");
ok((await un("select whatsapp_nuit_resultat($1, 'envoye', 'tx-auto-2') r", [L.id])).r === false, "un résultat noté deux fois : la seconde est refusée");

// Refus sûr : repris, 3 essais en tout, sans doublon.
const f = await client("+66811110030");
const [fr] = await reserver(f.message_id);
await un("select whatsapp_nuit_resultat($1, 'echec', null, 'telnyx_refuse') r", [fr.id]);
ok((await un("select statut_envoi from whatsapp_messages where id = $1", [fr.message_id])).statut_envoi === "echec", "refus sûr : le message passe en échec");
ok((await db.query("select * from whatsapp_reprendre_nuit($1)", [ORG])).rows.length === 0, "pas repris dans la minute");
await db.query("update whatsapp_messages_nuit set pris_le = now() - interval '2 minutes' where id = $1", [fr.id]);
let rep = (await db.query("select * from whatsapp_reprendre_nuit($1)", [ORG])).rows;
ok(rep.length === 1 && rep[0].id === fr.id && rep[0].message_id === fr.message_id && rep[0].texte === TEXTE, "repris par le cron : le même message repart");
ok((await db.query("select * from whatsapp_reprendre_nuit($1)", [ORG])).rows.length === 0, "… une reprise de plus ne le reprend pas pendant l'essai");
ok((await un("select count(*)::int n from whatsapp_messages where conversation_id = $1 and automatique = 'nuit'", [f.conversation_id])).n === 1, "… sans second message dans la conversation");
await un("select whatsapp_nuit_resultat($1, 'echec', null, 'telnyx_refuse') r", [fr.id]);
await db.query("update whatsapp_messages_nuit set pris_le = now() - interval '2 minutes' where id = $1", [fr.id]);
rep = (await db.query("select * from whatsapp_reprendre_nuit($1)", [ORG])).rows;
await un("select whatsapp_nuit_resultat($1, 'echec', null, 'telnyx_refuse') r", [fr.id]);
const abandon = (await lignes(f.conversation_id))[0];
ok(rep.length === 1 && abandon.statut === "abandonne" && abandon.essais === 3, "après 3 essais : abandonné");
await db.query("update whatsapp_messages_nuit set pris_le = now() - interval '2 minutes' where id = $1", [fr.id]);
ok((await db.query("select * from whatsapp_reprendre_nuit($1)", [ORG])).rows.length === 0, "… et plus jamais repris");

// Incertain (délai dépassé) : jamais renvoyé.
const g = await client("+66811110031");
const [gr] = await reserver(g.message_id);
await un("select whatsapp_nuit_resultat($1, 'incertain', null, 'delai') r", [gr.id]);
await db.query("update whatsapp_messages_nuit set pris_le = now() - interval '10 minutes' where id = $1", [gr.id]);
ok((await db.query("select * from whatsapp_reprendre_nuit($1)", [ORG])).rows.length === 0 && (await un("select statut_envoi from whatsapp_messages where id = $1", [gr.message_id])).statut_envoi === "envoi", "résultat incertain : jamais renvoyé, le message reste « envoi » (à vérifier après 5 minutes)");
// Réservation restée en route : incertaine, jamais renvoyée.
const k = await client("+66811110032");
const [kr] = await reserver(k.message_id);
await db.query("update whatsapp_messages_nuit set pris_le = now() - interval '3 minutes' where id = $1", [kr.id]);
ok((await db.query("select * from whatsapp_reprendre_nuit($1)", [ORG])).rows.length === 0 && (await lignes(k.conversation_id))[0].statut === "incertain", "une réservation interrompue devient incertaine, jamais renvoyée");
// Refus sûr, puis Nani répond avant la reprise : abandonné.
const p = await client("+66811110033");
const [pr] = await reserver(p.message_id);
await un("select whatsapp_nuit_resultat($1, 'echec', null, 'telnyx_refuse') r", [pr.id]);
await ranger("+66811110033", { sens: "sortant", origine: "app", type: "text", texte: "Hi", medias: [], telnyx_id: "tx-n4", envoye_le: iso(Date.now()) });
await db.query("update whatsapp_messages_nuit set pris_le = now() - interval '2 minutes' where id = $1", [pr.id]);
ok((await db.query("select * from whatsapp_reprendre_nuit($1)", [ORG])).rows.length === 0 && (await lignes(p.conversation_id))[0].statut === "abandonne", "Nani a répondu entre-temps : la reprise abandonne");
// Refus sûr, puis réglage coupé : abandonné.
const q = await client("+66811110034");
const [qr] = await reserver(q.message_id);
await un("select whatsapp_nuit_resultat($1, 'echec', null, 'telnyx_refuse') r", [qr.id]);
await db.query("update whatsapp_reglages set nuit_active = false where organisation_id = $1", [ORG]);
await db.query("update whatsapp_messages_nuit set pris_le = now() - interval '2 minutes' where id = $1", [qr.id]);
ok((await db.query("select * from whatsapp_reprendre_nuit($1)", [ORG])).rows.length === 0 && (await lignes(q.conversation_id))[0].statut === "abandonne", "réglage coupé avant la reprise : rien ne repart");
await db.query("update whatsapp_reglages set nuit_active = true where organisation_id = $1", [ORG]);

// ---- Aperçu de la liste : le client attend toujours ------------------------------------------------------------------------------
const conv = await un("select dernier_texte, attend_depuis, dernier_sens, non_lus from whatsapp_conversations where id = $1", [C]);
ok(conv.dernier_texte === "Are you there?" && conv.attend_depuis && conv.dernier_sens === "entrant" && conv.non_lus === 2, "au matin, la liste montre le message du client, « attend une réponse », non-lus gardés");
await db.query("select whatsapp_recalculer_dernier($1)", [C]);
ok((await un("select dernier_sens from whatsapp_conversations where id = $1", [C])).dernier_sens === "entrant", "le recalcul du dernier message ignore le message automatique");

// ---- Droits -------------------------------------------------------------------------------------------------------------------------
r = await essaie(u.adminSecret, "select * from whatsapp_reserver_nuit($1)", [a1.message_id]);
ok(!r.ok, "whatsapp_reserver_nuit n'est pas ouverte à l'outil");
r = await essaie(u.adminSecret, "select whatsapp_nuit_resultat($1, 'envoye', 'x')", [L.id]);
ok(!r.ok, "whatsapp_nuit_resultat n'est pas ouverte à l'outil");
r = await essaie(u.adminSecret, "select * from whatsapp_reprendre_nuit($1)", [ORG]);
ok(!r.ok, "whatsapp_reprendre_nuit n'est pas ouverte à l'outil");
r = await essaie(u.adminSecret, "select count(*) from whatsapp_messages_nuit");
ok(!r.ok, "la table des nuits n'est pas lisible depuis l'outil");
r = await essaie(u.adminSecret, "update whatsapp_reglages set nuit_active = false");
ok(!r.ok || r.n === 0, "le réglage ne s'écrit pas directement depuis l'outil");
r = await essaie(u.mook, "select whatsapp_regler_nuit($1, false, 'x', '22:00', '06:00')", [ORG]);
ok(!r.ok && /droit_manquant/.test(r.err), "Mook ne change pas le réglage");
r = await essaie(u.adminSecret, "select whatsapp_regler_nuit($1, true, '   ', '22:00', '06:00')", [ORG]);
ok(!r.ok && /texte_vide/.test(r.err), "texte vide refusé");
r = await essaie(u.adminSecret, "select whatsapp_regler_nuit($1, true, $2, '22:00', '06:00')", [ORG, "é".repeat(2100)]);
ok(!r.ok && /texte_trop_long/.test(r.err), "texte de plus de 4 096 octets refusé");
r = await essaie(u.adminSecret, "select whatsapp_regler_nuit($1, true, 'Hi', '22:00', '22:00')", [ORG]);
ok(!r.ok && /heures_invalides/.test(r.err), "début égal à la fin refusé");
r = await essaie(u.adminSecret, "select whatsapp_regler_nuit($1, true, 'Hi', '22:00:30', '06:00')", [ORG]);
ok(!r.ok && /heures_invalides/.test(r.err), "secondes refusées");
r = await essaie(u.adminTaxi, "select whatsapp_regler_nuit($1, false, 'Back at 7', '21:30', '06:30') r", [ORG]);
ok(r.ok && r.rows[0].r.nuit_active === false && r.rows[0].r.nuit_debut === "21:30" && r.rows[0].r.nuit_fin === "06:30" && r.rows[0].r.nuit_texte === "Back at 7", "un administrateur de Taxi change le réglage");
r = await essaie(u.adminSecret, "select nuit_active, nuit_texte from whatsapp_reglages");
ok(r.ok && r.rows[0].nuit_active === false, "les administrateurs lisent le réglage");
r = await essaie(u.adminSecret, "select whatsapp_regler_nuit($1, true, 'x', '22:00', '06:00')", ["00000000-0000-0000-0000-0000000000ff"]);
ok(!r.ok && /droit_manquant/.test(r.err), "une autre organisation : refusé");

// ---- Retour en arrière ------------------------------------------------------------------------------------------------------------
await db.exec(lire("retour-132-whatsapp-message-nuit.sql"));
const reste = await un("select (select count(*)::int from information_schema.columns where table_name = 'whatsapp_reglages' and column_name like 'nuit_%') c, to_regclass('whatsapp_messages_nuit') t, (select count(*)::int from pg_proc where proname like 'whatsapp_%nuit%') f");
ok(reste.c === 0 && reste.t === null && reste.f === 0, "le retour en arrière enlève colonnes, table et fonctions");
await client("+66811110040");
ok(true, "après le retour, un message se range toujours (aperçu et recalcul d'avant)");
await db.exec(lire("migration-132-whatsapp-message-nuit.sql"));
ok(true, "la migration repasse après le retour en arrière");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
