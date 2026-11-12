// Prouve qu'une sauvegarde automatique se recharge : base d'origine (schéma + migrations + données) → export → chiffrement → déchiffrement → script SQL de restauration →
// base neuve avec le même schéma → mêmes lignes, mêmes séquences. Tout se passe sur Postgres en mémoire (PGlite), jamais sur la production.
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-sauvegarde-archive.mjs . && GESTION_SQL=<repo>/docs/gestion/ GESTION_SAUV=file://<repo>/docs/gestion/sauvegarde/sauvegarde-lib.mjs node verif-sauvegarde-archive.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
const { exporter, verifier, chiffrer, dechiffrer, serialiser, deserialiser, sqlDeRestauration } = await import(process.env.GESTION_SAUV || new URL("./sauvegarde/sauvegarde-lib.mjs", import.meta.url));
let echecs = 0;
const ok = (c, msg) => { if (!c) { echecs++; console.log("  ECHEC:", msg); } else console.log("  ok:", msg); };
const harnais = `
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, encrypted_password text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema public, auth, storage to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;
async function base() {
  const db = new PGlite();
  await db.exec(harnais);
  await db.exec(fs.readFileSync(W + "schema.sql", "utf8").replace("create extension if not exists pgcrypto;", ""));
  const migs = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
  for (const f of migs) await db.exec(fs.readFileSync(W + f, "utf8"));
  return db;
}

console.log("Base d'origine");
const A = await base();
const E = (await A.query("select id from entites where slug = 'ztp'")).rows[0].id;
const admin = (await A.query("insert into auth.users (email, encrypted_password) values ('admin@test', '$2a$10$hashdetest') returning id")).rows[0].id;
await A.exec(`select set_config('request.jwt.claim.sub', '${admin}', false)`);
await A.exec(`
insert into clients (id, entite_id, nom, telephone) values ('00000000-0000-4000-8000-0000000000c1', '${E}', 'Client Un', '+41791234567'), ('00000000-0000-4000-8000-0000000000c2', '${E}', 'Client Deux', '');
insert into dossiers (id, entite_id, ref, client_id) values ('00000000-0000-4000-8000-0000000000d1', '${E}', 'D1', '00000000-0000-4000-8000-0000000000c1');
insert into documents (id, entite_id, dossier_id, type, date_emission, contenu) values ('00000000-0000-4000-8000-0000000000a1', '${E}', '00000000-0000-4000-8000-0000000000d1', 'facture', '2026-10-01', '{"lignes":[{"id":"l1","unite":1000.5,"qte":1},{"id":"l2","unite":900,"qte":1,"paye_sur_place":true}],"texte":"accents é à \\"guillemets\\" $gsb$ dollars"}');
insert into paiements (entite_id, dossier_id, date, montant) values ('${E}', '00000000-0000-4000-8000-0000000000d1', '2026-10-02', 100.25);
insert into partenaires (id, entite_id, nom, regles) values ('00000000-0000-4000-8000-0000000000b1', '${E}', 'Partenaire', '{"mode_reglement":"sur_place"}');
insert into partenaires_prives (entite_id, partenaire_id, commission_regle) values ('${E}', '00000000-0000-4000-8000-0000000000b1', '{"type":"pourcent_vente","valeur":10}');
insert into taches (entite_id, titre, fait) values ('${E}', 'À faire', false);
`);
await A.exec("update documents set contenu = contenu where id = '00000000-0000-4000-8000-0000000000a1'");

console.log("Export, chiffrement, relecture");
const requete = async (sql) => (await A.query(sql)).rows;
const sauvegarde = await exporter(requete, { projet: "test", maintenant: new Date("2026-11-12T03:00:00Z") });
ok(sauvegarde.manifest.total_lignes > 0, `${sauvegarde.manifest.total_lignes} ligne(s) exportée(s) dans ${Object.keys(sauvegarde.tables).length} tables`);
ok(!!sauvegarde.tables["auth.users"] && sauvegarde.tables["auth.users"].length === 1, "les comptes (auth.users) sont dans la sauvegarde");
ok(!!sauvegarde.tables["public.partenaires_prives"], "les tables protégées des nets et commissions sont dans la sauvegarde (elle est chiffrée)");
ok(verifier(sauvegarde).length === 0, "le manifeste correspond au contenu");
ok(sauvegarde.schema.fonctions.length > 5 && sauvegarde.schema.politiques.length > 10 && sauvegarde.schema.colonnes.length > 100, "la photo du schéma contient fonctions, politiques et colonnes");
const fichier = chiffrer(serialiser(sauvegarde), "phrase de test");
ok(!fichier.includes("Client Un") && !fichier.includes("hashdetest"), "le fichier chiffré ne contient rien de lisible");
const relue = deserialiser(dechiffrer(fichier, "phrase de test"));
ok(verifier(relue).length === 0, "relue après déchiffrement, la sauvegarde est identique");
let refus = false;
try { dechiffrer(fichier, "mauvaise"); } catch { refus = true; }
ok(refus, "une mauvaise phrase est refusée");
const trafiquee = structuredClone(relue);
trafiquee.tables["public.clients"][0].nom = "Pirate";
ok(verifier(trafiquee).some((p) => /empreinte/.test(p)), "une table modifiée à la main est détectée par le manifeste");

console.log("Restauration dans une base neuve");
const B = await base();
const sql = sqlDeRestauration(relue);
let echecSql = null;
try { await B.exec(sql); } catch (e) { echecSql = e.message; }
ok(echecSql === null, "le script de restauration s'exécute sans erreur" + (echecSql ? ` : ${echecSql}` : ""));
if (!echecSql) {
  const nettoyer = (ligne) => JSON.stringify(ligne, Object.keys(ligne).sort());
  for (const nom of Object.keys(sauvegarde.tables)) {
    const lire = async (db) => (await db.query(`select to_jsonb(t) j from ${nom.split(".").map((x) => `"${x}"`).join(".")} t`)).rows.map((r) => nettoyer(r.j)).sort();
    const a = await lire(A);
    const b = await lire(B);
    ok(JSON.stringify(a) === JSON.stringify(b), `${nom} : ${b.length} ligne(s) identiques à l'origine`);
  }
  const apres = await B.query("insert into journal (entite_id, table_name, action) values ($1, 'test', 'insert') returning id", [E]);
  const maxA = (await A.query("select coalesce(max(id), 0)::int m from journal")).rows[0].m;
  ok(apres.rows[0].id > maxA, `les séquences sont remises : le prochain numéro du journal (${apres.rows[0].id}) dépasse ceux de la sauvegarde (${maxA})`);
  ok(Number((await B.query("select sur_place from dossiers_resume where dossier_id = '00000000-0000-4000-8000-0000000000d1'")).rows[0].sur_place) === 900, "le résumé du dossier est revenu (sur place 900)");
}
console.log(echecs ? `\n${echecs} ÉCHEC(S)` : "\nTOUT EST BON");
process.exit(echecs ? 1 : 0);
