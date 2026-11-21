// Vérifie la migration 73 (voucher envoyé en image depuis Gestion) sur un Postgres en mémoire : schema.sql puis toutes les migrations.
// Le bucket « whatsapp-sortant » est privé, limité à 5 Mo, sans aucune politique : ni Nani, ni Mook, ni anon n'y lisent, n'y écrivent ni
// n'y suppriment depuis l'outil ; une politique ajoutée par erreur est retirée au prochain passage ; la migration se rejoue ; retour en arrière.
// Une politique de storage.objects sans bucket_id arrête la migration. Et la base tient le verrou du voucher (whatsapp_ranger_voucher, revue
// de sécurité de la PR 304) : course entre deux demandes, envoi incertain qui bloque sans limite de durée, « C'est parti » et « Pas parti ».
//   GESTION_SQL=<repo>/docs/gestion/ node verif-whatsapp-voucher.mjs
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
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
for (const f of migrations) await db.exec(lire(f));
ok(migrations.includes("migration-73-whatsapp-voucher.sql"), "la migration 73 passe avec les autres, sur une base vide");

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
const u = {};
for (const k of ["nani", "mook", "ztp"]) u[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test"])).id;
await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
await db.exec(`insert into roles (entite_id, nom, portee, permissions) values ('${ent.secret}', 'Mook test', 'toute', array['clients.lire', 'clients.ecrire', 'dossiers.lire', 'dossiers.ecrire', 'partenaires.lire'])`);
const membre = (user, entite, role) => db.exec(`insert into membres values ('${u[user]}', '${entite}', (select id from roles where entite_id = '${entite}' and nom = '${role}')) on conflict do nothing`);
await membre("nani", ent.secret, "Administrateur");
await membre("nani", ent.taxi, "Administrateur");
await membre("mook", ent.secret, "Mook test");
await membre("ztp", ent.ztp, "Administrateur");

// ---- Bucket ---------------------------------------------------------------------------------------------------------------------------
const bucket = () => un("select id, public, file_size_limit from storage.buckets where id = 'whatsapp-sortant'");
let b = await bucket();
ok(b && b.public === false, "le bucket whatsapp-sortant existe et il est privé");
ok(b && Number(b.file_size_limit) === 5242880, "5 Mo par fichier au plus (limite de Meta)");
const politiques = async () => (await db.query("select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') like '%whatsapp-sortant%' or coalesce(with_check, '') like '%whatsapp-sortant%')")).rows;
ok((await politiques()).length === 0, "aucune politique ne cite le bucket : rien depuis l'outil");

// ---- Personne n'y touche depuis l'outil ---------------------------------------------------------------------------------------------
for (const [qui, role] of [["nani", "authenticated"], ["mook", "authenticated"], ["ztp", "authenticated"], [null, "anon"]]) {
  const nom = qui || "anon";
  let r = await essaie(qui && u[qui], "insert into storage.objects (bucket_id, name) values ('whatsapp-sortant', $1)", [`${ORG}/1-x.png`], role);
  ok(!r.ok, `${nom} ne dépose pas de fichier dans whatsapp-sortant`);
}
// Un fichier déposé par la fonction (clé de service : ici le propriétaire, qui passe outre RLS comme service_role).
await db.query("insert into storage.objects (bucket_id, name) values ('whatsapp-sortant', $1)", [`${ORG}/1700000000000-a.png`]);
for (const [qui, role] of [["nani", "authenticated"], ["mook", "authenticated"], ["ztp", "authenticated"], [null, "anon"]]) {
  const nom = qui || "anon";
  let r = await essaie(qui && u[qui], "select name from storage.objects where bucket_id = 'whatsapp-sortant'", [], role);
  ok(r.ok && r.rows.length === 0, `${nom} ne lit pas le fichier temporaire`);
  r = await essaie(qui && u[qui], "delete from storage.objects where bucket_id = 'whatsapp-sortant'", [], role);
  ok(r.ok ? r.n === 0 : true, `${nom} ne supprime pas le fichier temporaire`);
  r = await essaie(qui && u[qui], "update storage.objects set name = 'x' where bucket_id = 'whatsapp-sortant'", [], role);
  ok(r.ok ? r.n === 0 : true, `${nom} ne renomme pas le fichier temporaire`);
}
ok((await un("select count(*)::int n from storage.objects where bucket_id = 'whatsapp-sortant'")).n === 1, "le fichier de la fonction est toujours là");

// ---- Se rejoue, et referme ce qui aurait été ouvert à la main ---------------------------------------------------------------------
await db.exec("create policy \"lecture voucher par erreur\" on storage.objects for select to anon, authenticated using (bucket_id = 'whatsapp-sortant')");
await db.exec("update storage.buckets set public = true, file_size_limit = 52428800 where id = 'whatsapp-sortant'");
ok((await essaie(u.mook, "select name from storage.objects where bucket_id = 'whatsapp-sortant'")).rows.length === 1, "(témoin) une politique ajoutée à la main ouvrirait la lecture");
await db.exec(lire("migration-73-whatsapp-voucher.sql"));
await db.exec(lire("migration-73-whatsapp-voucher.sql"));
b = await bucket();
ok(b.public === false && Number(b.file_size_limit) === 5242880, "la migration se rejoue : le bucket redevient privé, 5 Mo");
ok((await politiques()).length === 0, "la migration se rejoue : la politique ajoutée à la main est retirée");
ok((await essaie(u.mook, "select name from storage.objects where bucket_id = 'whatsapp-sortant'")).rows.length === 0, "… et Mook ne lit plus rien");
ok(!!(await un("select 1 x from pg_policies where schemaname = 'storage' and policyname = 'lire les médias WhatsApp'")), "les politiques des autres buckets restent (médias reçus)");

// ---- Garde-fou : une politique sans bucket_id vaudrait pour ce bucket ------------------------------------------------------------
await db.exec("create policy \"tout lire par erreur\" on storage.objects for select to authenticated using (true)");
let arret = null;
try { await db.exec(lire("migration-73-whatsapp-voucher.sql")); } catch (e) { arret = e.message; }
ok(!!arret && /tout lire par erreur/.test(arret) && /sans bucket_id/.test(arret), "une politique sans bucket_id arrête la migration et elle la nomme");
await db.exec("rollback").catch(() => {});
await db.exec("drop policy \"tout lire par erreur\" on storage.objects");
await db.exec(lire("migration-73-whatsapp-voucher.sql"));
ok(!!(await un("select 1 x from pg_proc where proname = 'whatsapp_ranger_voucher'")), "sans elle, la migration passe de nouveau");

// ---- Le verrou du voucher tenu par la base (whatsapp_ranger_voucher) ---------------------------------------------------------------
const tel = "+447700900311";
const entrant = await un("select whatsapp_ranger($1, $2, null, $3::jsonb) r", [ORG, tel, JSON.stringify({ evenement_id: "e1", telnyx_id: "tx-1", sens: "entrant", origine: "client", type: "text", texte: "Hi Nani", medias: [], envoye_le: new Date(Date.now() - 600000).toISOString() })]);
const conv = entrant.r.conversation_id;
const resa = "11111111-1111-4111-8111-111111111111";
const autreResa = "22222222-1111-4111-8111-111111111111";
const essai = (n) => `0000000${n}-0000-4000-8000-000000000000`;
const message = (reservation = resa, texte = "Your voucher") => ({ texte, medias: [{ type: "image", mime: "image/png", taille: 1000, nom: "Voucher.png", statut: "voucher", chemin_sortant: `${ORG}/1-a.png`, reservation_id: reservation }] });
const verrou = async (n, reservation = resa, m = message(reservation)) =>
  (await un("select whatsapp_ranger_voucher($1, $2, $3, $4::jsonb) r", [conv, reservation, `gestion-voucher:${reservation}:${essai(n)}`, JSON.stringify(m)])).r;

// Course entre deux demandes : la fonction prend la conversation « for update » avant tout contrôle. PGlite n'a qu'une connexion, les deux
// demandes passent donc l'une après l'autre, comme Postgres les ordonne sous ce verrou : la seconde voit le message de la première.
const v1 = await verrou(1);
ok(v1.nouveau === true && !!v1.message_id, "première demande : rangée");
const v2 = await verrou(2);
ok(v2.refus === "a_verifier" && !v2.message_id, "course : la seconde demande (autre confirmation) voit l'envoi en cours et s'arrête");
ok((await verrou(1)).refus === "deja", "la même confirmation rejouée : rien de rangé");
ok((await un("select count(*)::int n from whatsapp_messages where conversation_id = $1 and type = 'image'", [conv])).n === 1, "un seul message dans le fil");
const m = await un("select type, origine, statut_envoi, texte, medias, evenement_id from whatsapp_messages where id = $1", [v1.message_id]);
ok(m.type === "image" && m.origine === "gestion" && m.statut_envoi === "envoi" && m.texte === "Your voucher", "rangé « envoi », type image, origine gestion, légende en texte");
ok(m.evenement_id === `gestion-voucher:${resa}:${essai(1)}`, "clé : gestion-voucher:<réservation>:<id de la confirmation>");
ok(m.medias[0].statut === "voucher" && !m.medias[0].chemin, "le média ne cite jamais le stockage « whatsapp » (pas de chemin)");
const v3 = await verrou(3, autreResa);
ok(v3.nouveau === true, "un autre voucher du dossier part, lui");
await un("select whatsapp_retirer_envoi($1) x", [v3.message_id]);

// Sans limite de durée : passé en échec « sans_confirmation » par la reprise, et vieux de trois jours, il bloque toujours.
await db.query("update whatsapp_messages set statut_envoi = 'echec', erreur_envoi = 'sans_confirmation', envoye_le = now() - interval '3 days' where id = $1", [v1.message_id]);
ok((await verrou(2)).refus === "a_verifier", "envoi incertain de trois jours : toujours bloqué");
await db.query("update whatsapp_messages set erreur_envoi = 'telnyx 131026' where id = $1", [v1.message_id]);
ok((await verrou(2)).nouveau === true, "un échec annoncé par WhatsApp n'est pas un doute : le voucher peut repartir");
await db.query("delete from whatsapp_messages where conversation_id = $1 and type = 'image'", [conv]);

// « Pas parti » lève le verrou ; « C'est parti » aussi, puis 2 minutes de calme.
const a = await verrou(4);
ok((await verrou(5)).refus === "a_verifier", "envoi en cours : bloqué");
let r = await essaie(u.nani, "select whatsapp_confirmer_envoi($1, false) x", [conv]);
ok(r.ok && r.rows[0].x.messages === 1, "« Pas parti » : le message sort du fil");
const b2 = await verrou(5);
ok(b2.nouveau === true, "… et le voucher peut repartir");
r = await essaie(u.nani, "select whatsapp_confirmer_envoi($1, true) x", [conv]);
ok(r.ok && r.rows[0].x.messages === 1, "« C'est parti »");
ok((await verrou(6)).refus === "recent", "parti il y a moins de 2 minutes : bloqué");
await db.query("update whatsapp_messages set envoye_le = now() - interval '3 minutes' where id = $1", [b2.message_id]);
ok((await verrou(6)).nouveau === true, "après 2 minutes, il peut repartir");
ok(!!a.message_id, "(témoin)");

// Entrées refusées.
let e = null;
try { await un("select whatsapp_ranger_voucher($1, $2, $3, $4::jsonb) r", [conv, resa, `gestion-voucher:${resa}:pas-un-uuid`, JSON.stringify(message())]); } catch (x) { e = x.message; }
ok(/cle_invalide/.test(e || ""), "clé mal formée : refusée");
e = null;
try { await un("select whatsapp_ranger_voucher($1, $2, $3, $4::jsonb) r", [conv, resa, `gestion-voucher:${autreResa}:${essai(7)}`, JSON.stringify(message())]); } catch (x) { e = x.message; }
ok(/cle_invalide/.test(e || ""), "clé d'une autre réservation : refusée");
e = null;
try { await un("select whatsapp_ranger_voucher($1, $2, $3, $4::jsonb) r", [conv, resa, `gestion-voucher:${resa}:${essai(7)}`, JSON.stringify(message(autreResa))]); } catch (x) { e = x.message; }
ok(/medias_invalides/.test(e || ""), "un média d'une autre réservation : refusé");
ok((await un("select whatsapp_ranger_voucher($1, $2, $3, $4::jsonb) r", ["99999999-1111-4111-8111-111111111111", resa, `gestion-voucher:${resa}:${essai(8)}`, JSON.stringify(message())])).r.refus === "conversation", "conversation inconnue : rien");

// Droits.
for (const qui of ["nani", "mook", "ztp"]) {
  r = await essaie(u[qui], "select whatsapp_ranger_voucher($1, $2, $3, $4::jsonb) r", [conv, resa, `gestion-voucher:${resa}:${essai(9)}`, JSON.stringify(message())]);
  ok(!r.ok, `${qui} n'appelle pas whatsapp_ranger_voucher (clé de service seulement)`);
}
r = await essaie(u.mook, "select whatsapp_confirmer_envoi($1, true) x", [conv]);
ok(!r.ok, "Mook ne confirme pas un envoi");
r = await essaie(u.mook, "select whatsapp_peut_ecrire($1) x", [conv]);
ok(r.ok && r.rows[0].x === false, "Mook ne peut pas écrire dans la conversation (refus de la fonction)");
r = await essaie(u.ztp, "select whatsapp_peut_ecrire($1) x", [conv]);
ok(r.ok && r.rows[0].x === false, "un administrateur de ZTP non plus");
r = await essaie(u.ztp, "select whatsapp_admin($1) x", [ent.ztp]);
ok(r.ok && r.rows[0].x === false, "un voucher de ZTP n'est jamais envoyable (whatsapp_admin)");

// ---- Retour en arrière -------------------------------------------------------------------------------------------------------------
await db.exec(lire("retour-73-whatsapp-voucher.sql"));
ok(!!(await bucket()), "retour : un bucket qui contient encore un fichier reste (Supabase le refuserait)");
await db.exec("delete from storage.objects where bucket_id = 'whatsapp-sortant'");
await db.exec(lire("retour-73-whatsapp-voucher.sql"));
ok(!(await bucket()), "retour : le bucket vide est supprimé");
ok(!(await un("select 1 x from pg_proc where proname = 'whatsapp_ranger_voucher'")), "retour : la fonction du verrou est partie");
await db.exec(lire("migration-73-whatsapp-voucher.sql"));
b = await bucket();
ok(b && b.public === false, "la migration se rejoue après le retour");

console.log(echecs ? `${echecs} échec(s)` : "tout est ok");
process.exit(echecs ? 1 : 0);
