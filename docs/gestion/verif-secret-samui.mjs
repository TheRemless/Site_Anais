// Vérifie le SQL privé du catalogue du guide « Excursions en bateau à Koh Samui » (donnees-secret-samui.sql et son retour) sur un Postgres en mémoire :
// schema.sql puis toutes les migrations sur une base vide. Passage, contenu (partenaires, règle de commission, tarifs, aucun net), rien dans ZTP ni dans Taxi,
// rejeu sans effet (rien d'écrasé), mêmes identifiants que carnet-produits.mjs, bon tarif pour une demande lue, retour en arrière, retour refusé après une réservation.
// Le SQL nomme les partenaires et leurs commissions : il vit HORS du dépôt (public), dans ~/Desktop/Site_Anais-import/ ou dans GESTION_SQL_PRIVE. Sans lui, ce contrôle s'arrête sans erreur.
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17 && cp <repo>/docs/gestion/verif-secret-samui.mjs .
//   GESTION_SQL=<repo>/docs/gestion/ GESTION_SRC=file://<repo>/src/gestion/js/ GESTION_SQL_PRIVE=<dossier privé> node verif-secret-samui.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
const W = process.env.GESTION_SQL || "./";
const SRC = process.env.GESTION_SRC || new URL("../../src/gestion/js/", import.meta.url).href;
const PRIVE = process.env.GESTION_SQL_PRIVE || path.join(os.homedir(), "Desktop", "Site_Anais-import");
const privee = (nom) => { try { return fs.readFileSync(path.join(PRIVE, nom), "utf8"); } catch { return null; } };
const DONNEES = privee("donnees-secret-samui.sql");
const RETOUR = privee("retour-secret-samui.sql");
if (!DONNEES || !RETOUR) {
  console.log(`SQL privé absent de ${PRIVE} : contrôle sauté.`);
  process.exit(0);
}
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
const md5uuid = (s) => { const h = createHash("md5").update(s).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d|1\d\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
for (const f of migrations) await db.exec(lire(f));
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const tous = async (sql, p = []) => (await db.query(sql, p)).rows;
const ent = {};
for (const s of ["ztp", "secret", "taxi"]) ent[s] = (await un("select id from entites where slug = $1", [s])).id;
// Les partenaires du fichier : leurs clés sont dans le SQL, leurs identifiants s'en déduisent.
const PIDS = [...new Set([...DONNEES.matchAll(/md5\('carnet-partenaire:([^']+)'\)::uuid/g)].map((m) => md5uuid(`carnet-partenaire:${m[1]}`)))];
const TARIFS = "details->>'guide' = 'koh-samui'";
const compte = async () => ({
  partenaires: Number((await un("select count(*) n from partenaires where id = any($1::uuid[])", [PIDS])).n),
  tarifs: Number((await un(`select count(*) n from prestations where ${TARIFS}`)).n),
  regles: Number((await un("select count(*) n from partenaires_prives where commission_regle is not null and partenaire_id = any($1::uuid[])", [PIDS])).n),
});

// Quelques données de Koh Lanta déjà là : elles ne doivent pas bouger.
const lanta = (await un("insert into partenaires (entite_id, nom, ordre) values ($1, 'Partenaire Lanta', 4) returning id", [ent.secret])).id;
await db.query("insert into prestations (entite_id, partenaire_id, famille, groupe, libelle, prix_vente, unite, ordre) values ($1, $2, 'excursion', 'Join-in', '4 Islands', 1200, 'pp', 7)", [ent.secret, lanta]);
const avant = { prestations: Number((await un("select count(*) n from prestations")).n), partenaires: Number((await un("select count(*) n from partenaires")).n) };

console.log("== Passage sur une base vide ==");
await db.exec(DONNEES);
let c = await compte();
ok(PIDS.length === 2 && c.partenaires === 2 && c.tarifs === 19 && c.regles === 2, `2 partenaires, 19 tarifs, 2 règles de commission (${JSON.stringify(c)})`);
ok(Number((await un("select count(*) n from prestations")).n) === avant.prestations + 19 && Number((await un("select count(*) n from partenaires")).n) === avant.partenaires + 2, "rien d'autre n'est écrit");
for (const s of ["ztp", "taxi"]) ok(Number((await un(`select count(*) n from prestations where entite_id = $1 and (${TARIFS} or partenaire_id = any($2::uuid[]))`, [ent[s], PIDS])).n) === 0 && Number((await un("select count(*) n from partenaires where entite_id = $1 and id = any($2::uuid[])", [ent[s], PIDS])).n) === 0 && Number((await un("select count(*) n from partenaires_prives where entite_id = $1 and partenaire_id = any($2::uuid[])", [ent[s], PIDS])).n) === 0, `rien dans ${s}`);
ok(Number((await un(`select count(*) n from prestations where ${TARIFS} and entite_id <> $1`, [ent.secret])).n) === 0, "tous les tarifs sont dans Secret");
const regles = await tous("select pp.commission_regle r, p.regles from partenaires p join partenaires_prives pp on pp.partenaire_id = p.id where p.id = any($1::uuid[])", [PIDS]);
ok(regles.every((x) => x.r.type === "pourcent_vente" && Number(x.r.valeur) > 0 && Number(x.r.valeur) < 100), "chaque partenaire a une commission en pourcentage du prix de vente");
ok(regles.every((x) => x.regles.mode_reglement === "sur_place"), "règlement sur place pour chaque partenaire");
ok(Number((await un(`select count(*) n from prestations_nets where prestation_id in (select id from prestations where ${TARIFS})`)).n) === 0, "aucun net écrit");
ok(Number((await un(`select count(*) n from prestations where ${TARIFS} and (sur_place or not actif or prix_vente is null)`)).n) === 0, "tous les tarifs sont actifs, avec un prix, ni « frais » ni sur place");
const noms = (await tous("select nom from partenaires where id = any($1::uuid[])", [PIDS])).map((x) => x.nom.toLowerCase());
const textes = await tous(`select libelle, libelle_en, groupe, details::text d from prestations where ${TARIFS}`);
ok(noms.length === 2 && !textes.some((r) => noms.some((n) => `${r.libelle} ${r.libelle_en} ${r.groupe} ${r.d}`.toLowerCase().includes(n))), "aucun nom de partenaire dans un tarif");
const petit = await un("select prix_vente, details from prestations where libelle_en like 'Ang Thong Marine Park, small group by speedboat%'");
ok(Number(petit.prix_vente) === 4400 && Number(petit.details.enfant) === 2700 && /Foreign adult: 300/.test(petit.details.parc) && /Foreign child: 150/.test(petit.details.parc) && petit.details.a_confirmer === undefined, "petit groupe : 4 400 adulte, 2 700 enfant, entrée du parc dite en plus (300 et 150)");
ok(Number((await un(`select count(*) n from prestations where ${TARIFS} and libelle_en like 'Ang Thong%' and details->>'parc' like '%300%150%'`)).n) === 5, "les 5 tarifs d'Ang Thong disent les droits d'entrée");
ok(Number((await un(`select count(*) n from prestations where ${TARIFS} and unite = 'veh' and prix_vente = 1500`)).n) === 1, "option transfert d'hôtel : 1 500 par van");
ok(Number((await un("select count(*) n from prestations where libelle = '4 Islands' and prix_vente = 1200")).n) === 1, "le catalogue de Koh Lanta n'a pas bougé");

console.log("== Mêmes identifiants que carnet-produits.mjs, bon tarif pour une demande ==");
const { PRODUITS_CARNET } = await import(SRC + "carnet-produits.mjs");
const { lireMessage, ajusterAgesCarnet, offresDuService } = await import(SRC + "demande-calc.mjs");
const prestations = await tous("select id, partenaire_id, famille, groupe, libelle, libelle_en, prix_vente::float8 as prix_vente, unite, details, sur_place, actif from prestations where entite_id = $1", [ent.secret]);
const partenaires = await tous("select id, actif from partenaires where entite_id = $1", [ent.secret]);
const ids = PRODUITS_CARNET.flatMap((p) => p.options.flatMap((o) => o.tarifs.map((t) => t.prestation)));
ok(ids.length === 18 && ids.every((id) => prestations.some((p) => p.id === id)), "les 18 tarifs de carnet-produits.mjs existent en base, avec le même identifiant");
const cible = (produit, option, adultes, ages = []) => {
  const p = PRODUITS_CARNET.find((x) => x.id === produit);
  const texte = `Booking request: ${p.nom} – ${p.options.find((o) => o.id === option).titre}\nDate: Sun 20 Dec 2026\nGuests: ${adultes} adults${ages.length ? `, ${ages.length} children (ages ${ages.join(", ")})` : ""}\nName: Test`;
  const d = ajusterAgesCarnet({ ...lireMessage(texte, "2026-11-22"), carnet: { produit, option } });
  return offresDuService(d, texte, { phrase: texte, date: d.date, adultes: d.adultes, enfants: d.enfants }, { prestations, trajets: [], partenaires, nomPartenaire: () => "" })[0];
};
ok(cible("ang-thong-big-boat", "with-kayak", 2, [5, 9]).total === 5700, "big boat avec kayak, 2 adultes et 2 enfants : 5 700");
ok(cible("ang-thong-big-boat", "with-kayak", 2, [5, 12]).total === 3 * 1850 + 1000, "big boat : un enfant de 12 ans paie le tarif adulte");
ok(cible("pig-island-longtail-prive-4h", "standard", 2, [5, 9]).total === 4500, "longtail 4 h, 4 personnes : palier 4 à 5, 4 500");
ok(cible("ang-thong-petit-groupe-speedboat", "standard", 2, [4]).total === 11500, "petit groupe, 2 adultes et 1 enfant : 11 500");
ok(cible("ang-thong-petit-groupe-speedboat", "standard", 2, [12]).total === 3 * 4400, "petit groupe : un enfant de 12 ans paie le tarif adulte");

console.log("== Rejeu ==");
const empreinte = async () => (await un(`select md5(string_agg(row_to_json(p)::text, '|' order by id)) m from (select * from prestations where ${TARIFS}) p`)).m + (await un("select md5(string_agg(row_to_json(p)::text, '|' order by id)) m from partenaires p where id = any($1::uuid[])", [PIDS])).m;
const e1 = await empreinte();
await db.exec(DONNEES);
ok(JSON.stringify(await compte()) === JSON.stringify(c) && (await empreinte()) === e1, "rejouer ne change rien");
await db.query("update prestations set prix_vente = 1999 where id = $1", [ids[0]]);
await db.query("update partenaires_prives set commission_regle = '{\"type\":\"pourcent_vente\",\"valeur\":12}' where partenaire_id = $1", [PIDS[1]]);
await db.exec(DONNEES);
ok(Number((await un("select prix_vente::float8 p from prestations where id = $1", [ids[0]])).p) === 1999 && Number((await un("select (commission_regle->>'valeur')::int v from partenaires_prives where partenaire_id = $1", [PIDS[1]])).v) === 12, "rejouer n'écrase ni un prix ni une règle changés depuis");
await db.query("update prestations set prix_vente = 1850 where id = $1", [ids[0]]);

console.log("== Retour refusé quand un dossier utilise un tarif ==");
const client = (await un("insert into clients (entite_id, prenom, nom) values ($1, 'Anna', 'Test') returning id", [ent.secret])).id;
const dossier = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, 'S-SAMUI', $2) returning id", [ent.secret, client])).id;
await db.query("insert into reservations (entite_id, dossier_id, prestation_id, libelle, statut, personnes) values ($1, $2, $3, 'Ang Thong', 'confirme', '{}'::jsonb)", [ent.secret, dossier, ids[0]]);
let refus = null;
try { await db.exec(RETOUR); } catch (e) { refus = e.message; }
// Comme une session SQL qui se ferme : la transaction du retour refusé est annulée.
await db.exec("rollback");
ok(refus && /réservations utilisent/.test(refus), "le retour refuse et le dit");
await db.query("update partenaires_prives set commission_regle = $2::jsonb where partenaire_id = $1", [PIDS[1], JSON.stringify(regles[regles.length - 1].r)]);
await db.query("delete from reservations where dossier_id = $1", [dossier]);

console.log("== Retour en arrière ==");
await db.exec(RETOUR);
c = await compte();
ok(c.partenaires === 0 && c.tarifs === 0 && c.regles === 0, `tout est défait (${JSON.stringify(c)})`);
ok(Number((await un("select count(*) n from prestations")).n) === avant.prestations && Number((await un("select count(*) n from partenaires")).n) === avant.partenaires, "il reste exactement ce qu'il y avait avant");
await db.exec(RETOUR);
ok(true, "le retour se rejoue sans erreur");
console.log("== Nouveau passage après le retour ==");
await db.exec(DONNEES);
c = await compte();
ok(c.partenaires === 2 && c.tarifs === 19 && c.regles === 2, "le fichier repasse après le retour");
// Un tarif ajouté à la main chez le partenaire le protège du retour.
await db.query("insert into prestations (entite_id, partenaire_id, famille, libelle, prix_vente, unite) values ($1, $2, 'excursion', 'Ajout manuel', 100, 'pp')", [ent.secret, PIDS[1]]);
await db.exec(RETOUR);
ok(Number((await un("select count(*) n from partenaires where id = $1", [PIDS[1]])).n) === 1 && Number((await un("select count(*) n from prestations where libelle = 'Ajout manuel'")).n) === 1, "un partenaire qui a un tarif ajouté depuis n'est pas supprimé");
console.log(echecs ? `\n${echecs} échec(s)` : "\nTout passe.");
process.exit(echecs ? 1 : 0);
