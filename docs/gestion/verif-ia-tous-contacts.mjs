// Vérifie la migration 69 (l'IA lit tous les contacts WhatsApp sauf le contact personnel) sur un Postgres en mémoire : schema.sql puis
// toutes les migrations. Un partenaire, un chauffeur ou un hôtel « jamais » repasse à « auto » malgré le classement protégé ; un contact
// « Personnel », un client et un apporteur ne bougent pas ; le déclencheur revient actif ; la migration se rejoue ; retour en arrière.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-ia-tous-contacts.mjs
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
ok(migrations.indexOf("migration-69-ia-tous-contacts.sql") > migrations.indexOf("migration-68-contacts-apporteurs.sql"), "la migration 69 passe après la 68, sur une base vide");

async function essaie(userId, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows, n: r.affectedRows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];

const ent = {};
for (const sl of ["secret", "taxi"]) ent[sl] = (await un("select id from entites where slug = $1", [sl]))?.id;
const ORG = (await un("select organisation_id from entites where id = $1", [ent.secret])).organisation_id;
const nani = (await un("insert into auth.users (email) values ('nani@test') returning id")).id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
for (const e of [ent.secret, ent.taxi]) await db.exec(`insert into membres values ('${nani}', '${e}', (select id from roles where entite_id = '${e}' and nom = 'Administrateur')) on conflict do nothing`);

// ---- Les conversations d'avant, typées par Nani avec l'ancien couplage de l'écran --------------------------------------------------------
let n = 0;
const msg = () => JSON.stringify({ evenement_id: `e${++n}`, telnyx_id: `tx-${n}`, meta_id: `wamid.${n}`, sens: "entrant", origine: "client", type: "text", texte: "Hello Nani", medias: [], envoye_le: new Date(Date.now() - (100 - n) * 60000).toISOString() });
const contacts = {
  partenaire: { tel: "+66810000001", type: "partenaire", reponses: "jamais", attendu: "auto" },
  chauffeur: { tel: "+66810000002", type: "chauffeur", reponses: "jamais", attendu: "auto" },
  hotel: { tel: "+66810000003", type: "hotel", reponses: "jamais", attendu: "auto" },
  personnel: { tel: "+66810000004", type: null, reponses: "jamais", attendu: "jamais" },
  apporteur: { tel: "+66810000005", type: "apporteur", reponses: "jamais", attendu: "jamais" },
  client: { tel: "+66810000006", type: "client", reponses: "jamais", attendu: "jamais" },
  partenaireOuvert: { tel: "+66810000007", type: "partenaire", reponses: "auto", attendu: "auto" },
  sansType: { tel: "+66810000008", type: null, reponses: "auto", attendu: "auto" },
};
for (const [nom, c] of Object.entries(contacts)) {
  c.id = (await un("select whatsapp_ranger($1, $2, $3, $4::jsonb) r", [ORG, c.tel, nom, msg()])).r.conversation_id;
  const r = await essaie(nani, `update whatsapp_conversations set entite_id = '${ent.secret}', type_contact = ${c.type ? `'${c.type}'` : "null"}, reponses = '${c.reponses}' where id = '${c.id}' returning reponses, type_contact`);
  ok(r.ok && r.rows[0] && r.rows[0].reponses === c.reponses && r.rows[0].type_contact === c.type, `Nani range « ${nom} » (${c.type || "sans type"}, ${c.reponses})` + (r.ok ? "" : ` (${r.err})`));
}
const etat = async (c) => (await un("select reponses, type_contact, updated_at from whatsapp_conversations where id = $1", [c.id]));

// Sans la migration, une mise à jour sans personne connectée (l'éditeur SQL, la clé de service) ne passe pas : le déclencheur garde « jamais ».
await db.query("update whatsapp_conversations set reponses = 'auto' where id = $1", [contacts.partenaire.id]);
ok((await etat(contacts.partenaire)).reponses === "jamais", "sans contournement, le classement protégé garde « jamais » (d'où le déclencheur désactivé dans la 69)");

// Le comptage d'avant, en tête de la migration.
const sql69 = lire("migration-69-ia-tous-contacts.sql");
const comptage = "select type_contact, count(*) from whatsapp_conversations where type_contact in ('partenaire','chauffeur','hotel') and reponses = 'jamais' group by 1;";
ok(sql69.includes(comptage), "la requête de comptage est en tête de la migration");
const avant = (await db.query(comptage)).rows.map((x) => `${x.type_contact}:${x.count}`).sort();
ok(JSON.stringify(avant) === JSON.stringify(["chauffeur:1", "hotel:1", "partenaire:1"]), `comptage avant : ${avant.join(", ")}`);

// ---- La migration 69 ----------------------------------------------------------------------------------------------------------------
await db.exec(sql69);
for (const [nom, c] of Object.entries(contacts)) {
  const x = await etat(c);
  ok(x.reponses === c.attendu && x.type_contact === c.type, `après la 69 : « ${nom} » est ${c.attendu}` + (x.type_contact === c.type ? "" : " (type changé !)"));
}
ok((await db.query(comptage)).rows.length === 0, "contrôle après : plus aucun partenaire, chauffeur ni hôtel sur « jamais »");
const declencheur = await un("select tgenabled from pg_trigger where tgname = 'whatsapp_proteger_classement' and tgrelid = 'whatsapp_conversations'::regclass");
ok(declencheur && declencheur.tgenabled === "O", "le déclencheur whatsapp_proteger_classement est réactivé");
await db.query("update whatsapp_conversations set reponses = 'auto' where id = $1", [contacts.personnel.id]);
ok((await etat(contacts.personnel)).reponses === "jamais", "… et protège encore : la fonction ne rouvre pas un contact personnel");
ok((await un("select to_regprocedure('public.whatsapp_partenaires_parmi(text[])') f")).f !== null, "whatsapp_partenaires_parmi reste en base (plus appelée)");

// Se rejoue sans effet : aucune ligne touchée, updated_at compris.
const photo = async () => JSON.stringify((await db.query("select id, reponses, type_contact, updated_at from whatsapp_conversations order by id")).rows);
const p1 = await photo();
await db.exec(sql69);
ok((await photo()) === p1, "la migration 69 se rejoue sans effet (aucune ligne touchée)");

// Après la 69, Nani peut toujours régler un partenaire « rien envoyé à l'IA » (menu « … ») ; la fonction ne le rouvre pas.
let r = await essaie(nani, `update whatsapp_conversations set reponses = 'jamais' where id = '${contacts.chauffeur.id}' returning reponses`);
ok(r.ok && r.rows[0].reponses === "jamais", "Nani règle encore un chauffeur « rien envoyé à l'IA »");
await db.query("update whatsapp_conversations set reponses = 'auto' where id = $1", [contacts.chauffeur.id]);
ok((await etat(contacts.chauffeur)).reponses === "jamais", "… et la fonction ne le rouvre pas");
await essaie(nani, `update whatsapp_conversations set reponses = 'auto' where id = '${contacts.chauffeur.id}'`);

// ---- Retour en arrière -------------------------------------------------------------------------------------------------------------
await db.exec(lire("retour-69-ia-tous-contacts.sql"));
for (const nom of ["partenaire", "chauffeur", "hotel", "partenaireOuvert"]) ok((await etat(contacts[nom])).reponses === "jamais", `retour : « ${nom} » est fermé (le retour ne sait pas lesquels l'étaient)`);
for (const nom of ["personnel", "apporteur", "client"]) ok((await etat(contacts[nom])).reponses === "jamais", `retour : « ${nom} » ne change pas`);
ok((await etat(contacts.sansType)).reponses === "auto", "retour : une conversation sans type reste ouverte");
const d2 = await un("select tgenabled from pg_trigger where tgname = 'whatsapp_proteger_classement' and tgrelid = 'whatsapp_conversations'::regclass");
ok(d2 && d2.tgenabled === "O", "retour : le déclencheur est réactivé");
await db.exec(sql69);
ok((await db.query(comptage)).rows.length === 0, "la migration 69 se rejoue après le retour en arrière");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
