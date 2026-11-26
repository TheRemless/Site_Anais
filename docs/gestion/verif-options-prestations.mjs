// Vérifie la migration 130 (options d'un service) sur un Postgres en mémoire : schema.sql puis toutes les migrations. Les règles de la base,
// le net prévu d'une réservation qui porte une option, le fichier de conversion du catalogue (sur des copies inventées portant les mêmes
// identifiants), puis rejeu, retour en arrière, rejeu. Libellés et prix inventés.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-options-prestations.mjs
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
const MIG = "migration-130-options-prestations.sql";
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d|1\d\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
ok(migrations.includes(MIG) && migrations.indexOf(MIG) > migrations.indexOf("migration-128-frais-parc-libelle.sql"), "la migration 130 passe après la 128");
for (const f of migrations) await db.exec(lire(f));
await db.exec(lire(MIG));
ok(true, "la migration 130 se rejoue sans erreur");
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const essai = async (sql, p = []) => { try { await db.query(sql, p); return null; } catch (e) { return e.message; } };
const script = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return e.message; } };
const E = (await un("select id from entites where slug = 'secret'")).id;
const Z = (await un("select id from entites where slug = 'ztp'")).id;
const partenaire = async (e, nom) => (await un("insert into partenaires (entite_id, nom) values ($1, $2) returning id", [e, nom])).id;
const prestation = async (e, p, libelle, prix, o = {}) => (await un("insert into prestations (id, entite_id, partenaire_id, famille, libelle, libelle_en, prix_vente, unite, sur_place) values (coalesce($1, gen_random_uuid()), $2, $3, $4, $5, $5, $6, $7, $8) returning id", [o.id || null, e, p, o.famille || "excursion", libelle, prix, o.unite || "boat", !!o.surPlace])).id;
const P1 = await partenaire(E, "Bateaux Exemple");
const P2 = await partenaire(E, "Autre Exemple");
const tour = await prestation(E, P1, "Tour privé Exemple", 6000);
const tour2 = await prestation(E, P1, "Tour privé Exemple, grand bateau", 7000);
const ext = await prestation(E, P1, "Extension Exemple", 600);
const ailleurs = await prestation(E, P2, "Tour Autre", 5000);

ok(!(await essai("update prestations set option_de = $2 where id = $1", [ext, [tour, tour2]])), "une option complète deux services du même partenaire");
ok((await un("select option_de from prestations where id = $1", [ext])).option_de.length === 2, "et la liste est gardée");
ok(/même partenaire/.test(await essai("update prestations set option_de = $2 where id = $1", [ext, [ailleurs]])), "refus : le service d'un autre partenaire");
const autreEntite = await prestation(Z, null, "Service ZTP", 100);
ok(/même partenaire et de la même entreprise/.test(await essai("update prestations set option_de = $2 where id = $1", [ext, [autreEntite]])), "refus : une autre entreprise");
ok(/propre option/.test(await essai("update prestations set option_de = $2 where id = $1", [tour, [tour]])), "refus : elle-même");
ok(/déjà des options/.test(await essai("update prestations set option_de = $2 where id = $1", [tour, [tour2]])), "refus : un service qui a des options ne devient pas une option");
const ext2 = await prestation(E, P1, "Option d'option", 50);
ok(/pas lui-même une option/.test(await essai("update prestations set option_de = $2 where id = $1", [ext2, [ext]])), "refus : une option d'option");
const note = await prestation(E, P1, "Frais de parc Exemple", 200, { surPlace: true, famille: "frais" });
ok(/sur place/.test(await essai("update prestations set option_de = $2 where id = $1", [note, [tour]])), "refus : une note « à payer sur place »");
ok(/autre partenaire/.test(await essai("update prestations set partenaire_id = $2 where id = $1", [tour, P2])), "refus : un service avec options ne change pas de partenaire");
await db.query("update prestations set option_de = $2 where id = $1", [ext, [tour, tour, tour2]]);
ok((await un("select cardinality(option_de) n from prestations where id = $1", [ext])).n === 2, "les doublons sont retirés");
await db.query("delete from prestations where id = $1", [tour2]);
ok(JSON.stringify((await un("select option_de from prestations where id = $1", [ext])).option_de) === JSON.stringify([tour]), "une prestation supprimée sort des listes d'options");

// Le net prévu d'une réservation : ses lignes de facture, service et option (net_reservation_calcule, migration 32).
await db.query("insert into prestations_nets (entite_id, prestation_id, net) values ($1, $2, 5000), ($1, $3, 450)", [E, tour, ext]);
const client = (await un("insert into clients (entite_id, nom) values ($1, 'Example') returning id", [E])).id;
const dossier = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, 'T-OPT-1', $2) returning id", [E, client])).id;
const lignes = [
  { id: "L1", kind: "ligne", libelle: "Tour privé Exemple", prestation_id: tour, partenaire_id: P1, unite: 6000, qte: 1, paye_sur_place: true },
  { id: "L2", kind: "ligne", libelle: "Extension Exemple", prestation_id: ext, partenaire_id: P1, unite: 600, qte: 1, paye_sur_place: true, option_de: "L1" },
];
await db.query("insert into documents (entite_id, dossier_id, type, date_emission, contenu) values ($1, $2, 'facture', current_date, $3::jsonb)", [E, dossier, JSON.stringify({ lignes })]);
const resa = (await un("insert into reservations (entite_id, dossier_id, ligne_id, prestation_id, partenaire_id, libelle, personnes, montant_vente, paye_sur_place, details) values ($1, $2, 'L1', $3, $4, 'Tour privé Exemple', '{\"adultes\":2}', 6600, true, $5::jsonb) returning id", [E, dossier, tour, P1, JSON.stringify({ lignes_ids: ["L1", "L2"] })])).id;
const calcule = await un("select (net_reservation_calcule(r)).net as net, (net_reservation_calcule(r)).complet as complet from reservations r where r.id = $1", [resa]);
ok(Number(calcule.net) === 5450 && calcule.complet === true, "le net prévu compte le net de l'option (5 000 + 450)");

// Le fichier de conversion, sur des copies inventées qui portent les identifiants du catalogue : il passe les règles, se rejoue sans effet.
const conv = lire("donnees-options-catalogue.sql");
const actif = conv.split("-- 2. À confirmer")[0];
const paires = [...actif.matchAll(/update prestations set option_de = array\[(.*?)\]::uuid\[\]\s*where id (?:= '([0-9a-f-]+)'|in \((.*?)\))/gs)].map((m) => ({ parents: [...m[1].matchAll(/'([0-9a-f-]{36})'/g)].map((x) => x[1]), options: m[2] ? [m[2]] : [...m[3].matchAll(/'([0-9a-f-]{36})'/g)].map((x) => x[1]) }));
ok(paires.length === 6 && paires.reduce((n, p) => n + p.parents.length * p.options.length, 0) === 35, "six mises à jour, 35 paires service et option");
const Pc = {};
let i = 0;
for (const p of paires) {
  const part = (Pc[p.parents[0]] ||= await partenaire(E, `Partenaire ${++i}`));
  for (const id of p.parents) if (!(await un("select 1 from prestations where id = $1", [id]))) await prestation(E, part, `Service ${id.slice(0, 4)}`, 1000, { id });
  for (const id of p.options) if (!(await un("select 1 from prestations where id = $1", [id]))) await prestation(E, part, `Option ${id.slice(0, 4)}`, 100, { id });
}
const erreurConv = await script(conv);
ok(!erreurConv, `le fichier de conversion s'applique${erreurConv ? ` (${erreurConv})` : ""}`);
ok((await un("select count(*)::int n from prestations where cardinality(option_de) > 0 and id = any($1)", [paires.flatMap((p) => p.options)])).n === 7, "sept prestations deviennent des options");
ok(!(await script(conv)), "et se rejoue sans effet");

await db.exec(lire("retour-130-options-prestations.sql"));
ok(!(await un("select count(*)::int n from information_schema.columns where table_name = 'prestations' and column_name = 'option_de'")).n, "retour : la colonne et les contrôles sont retirés");
await db.exec(lire(MIG));
ok(/propre option/.test(await essai("update prestations set option_de = $2 where id = $1", [tour, [tour]])), "et la 130 se repose après le retour");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
