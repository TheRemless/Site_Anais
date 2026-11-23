// Vérifie les SQL privés des guides d'Ao Nang et de Koh Lanta (donnees-secret-aonang.sql, donnees-secret-lanta-guide.sql et leurs retours) sur un Postgres en mémoire :
// schema.sql puis toutes les migrations sur une base vide, avec un petit catalogue de Koh Lanta fictif (les identifiants publics de cles-options-site.json, un partenaire fictif).
// Ao Nang : passage, contenu, rien dans ZTP ni Taxi, mêmes identifiants que carnet-produits.mjs, rejeu sans effet, retour refusé après une réservation, retour, nouveau passage.
// Koh Lanta : le correctif ne change que ce qu'il dit, une seule ligne exactement (un second candidat l'arrête sans rien écrire), se rejoue, ne remplace pas une valeur modifiée depuis,
// s'arrête sans écrire quand l'état attendu manque, se défait symétriquement.
// Les SQL nomment les partenaires, leurs nets et leurs commissions : ils vivent HORS du dépôt (public), dans ~/Desktop/Site_Anais-import/ ou GESTION_SQL_PRIVE.
// Sans eux : « SAUTÉ » en grand et code 0 ; avec --exiger, code 3.
//   mkdir /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17 && cp <repo>/docs/gestion/verif-secret-aonang-lanta.mjs .
//   GESTION_SQL=<repo>/docs/gestion/ GESTION_SRC=file://<repo>/src/gestion/js/ GESTION_SQL_PRIVE=<dossier privé> node verif-secret-aonang-lanta.mjs [--exiger]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
const W = process.env.GESTION_SQL || "./";
const SRC = process.env.GESTION_SRC || new URL("../../src/gestion/js/", import.meta.url).href;
const PRIVE = process.env.GESTION_SQL_PRIVE || path.join(os.homedir(), "Desktop", "Site_Anais-import");
const privee = (nom) => { try { return fs.readFileSync(path.join(PRIVE, nom), "utf8"); } catch { return null; } };
const FICHIERS = { AONANG: "donnees-secret-aonang.sql", RETOUR_AONANG: "retour-secret-aonang.sql", LANTA: "donnees-secret-lanta-guide.sql", RETOUR_LANTA: "retour-secret-lanta-guide.sql" };
const SQL = Object.fromEntries(Object.entries(FICHIERS).map(([k, f]) => [k, privee(f)]));
const absents = Object.entries(FICHIERS).filter(([k]) => !SQL[k]).map(([, f]) => f);
if (absents.length) {
  const ligne = "#".repeat(78);
  console.log(`${ligne}\n#  SAUTÉ : SQL privé absent de ${PRIVE} (${absents.join(", ")})\n#  Rien n'a été vérifié. Donner GESTION_SQL_PRIVE=<dossier privé> pour contrôler les catalogues.\n${ligne}`);
  process.exit(process.argv.includes("--exiger") ? 3 : 0);
}
const { PGlite } = await import("@electric-sql/pglite");
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
const n = async (sql, p = []) => Number((await un(sql, p)).n);
const ent = {};
for (const s of ["ztp", "secret", "taxi"]) ent[s] = (await un("select id from entites where slug = $1", [s])).id;
// Comme une session SQL qui se ferme : la transaction d'un fichier refusé est annulée.
const refuse = async (sql) => { let m = null; try { await db.exec(sql); } catch (e) { m = e.message; } await db.exec("rollback"); return m; };

// ---- Catalogue de Koh Lanta fictif : les identifiants publics du mapping du site, un partenaire fictif, des prix FICTIFS sans lien avec les vrais -------------------------
// Les valeurs que le correctif lit ou écrit (ancien et nouveau prix de l'extension, tranches de Koh Rok, seuil de commission) sont lues dans le SQL privé lui-même : ce
// fichier du dépôt public n'en écrit aucune. Les contrôles contre les vraies valeurs sont dans verif-prive-aonang-lanta.mjs (privé).
const cles = JSON.parse(fs.readFileSync(W + "cles-options-site.json", "utf8"));
const ANCIEN = Number(/and prix_vente = (\d+) and not/.exec(SQL.LANTA)[1]);
const NOUVEAU = Number(/set prix_vente = (\d+),/.exec(SQL.LANTA)[1]);
const SEUIL = Number(/< (\d+)/.exec(SQL.LANTA)[1]);
const lanta = (await un("insert into partenaires (entite_id, nom, ordre) values ($1, 'Partenaire Lanta fictif', 4) returning id", [ent.secret])).id;
const autreLanta = (await un("insert into partenaires (entite_id, nom, ordre) values ($1, 'Autre partenaire fictif', 5) returning id", [ent.secret])).id;
await db.query("insert into partenaires_prives (entite_id, partenaire_id, commission_regle) values ($1, $2, '{\"type\":\"vente_moins_net\"}'::jsonb)", [ent.secret, lanta]);
const base = async (id, ligne, libelle, vente, net) => {
  await db.query("insert into prestations (id, entite_id, partenaire_id, famille, groupe, libelle, libelle_en, details, prix_vente, unite, ordre) values ($1, $2, $3, 'excursion', 'Private charter', $4, $4, $5::jsonb, $6, 'boat', 10)", [id, ent.secret, lanta, libelle, JSON.stringify({ capacite: ligne, bateau: "Private longtail" }), vente]);
  await db.query("insert into prestations_nets (entite_id, prestation_id, net) values ($1, $2, $3)", [ent.secret, id, net]);
};
for (const t of cles["4-islands|private-longtail"]) await base(t.prestation, t.ligne, t.libelle, 6110, 5230);
for (const t of cles["koh-rok-koh-haa|private-longtail"].slice(0, 2)) await base(t.prestation, t.ligne, t.libelle, 7250, 6310);
// Un tarif privé à faible commission : il doit sortir dans la lecture seule, sans être modifié.
const faible = (await un("insert into prestations (entite_id, partenaire_id, famille, groupe, libelle, libelle_en, prix_vente, unite, ordre) values ($1, $2, 'excursion', 'Private charter', 'Charter test faible', 'Charter test faible', 3010, 'boat', 11) returning id", [ent.secret, lanta])).id;
await db.query("insert into prestations_nets (entite_id, prestation_id, net) values ($1, $2, 2840)", [ent.secret, faible]);
const LIBELLE_KRADAN = "Extension Koh Kradan sur tour 4 îles privé";
const ligneKradan = async (partenaire, prix) => (await un("insert into prestations (entite_id, partenaire_id, famille, groupe, libelle, libelle_en, prix_vente, unite, ordre) values ($1, $2, 'excursion', 'Options', $3, 'Koh Kradan extension', $4, 'boat', 12) returning id", [ent.secret, partenaire, LIBELLE_KRADAN, prix])).id;
const kradan = await ligneKradan(lanta, ANCIEN);
await db.query("insert into prestations_nets (entite_id, prestation_id, net) values ($1, $2, 233)", [ent.secret, kradan]);
// Une ligne du MÊME libellé et du même prix chez un AUTRE partenaire : elle ne doit jamais être touchée.
const kradanAutre = await ligneKradan(autreLanta, ANCIEN);
const rok46 = cles["koh-rok-koh-haa|private-longtail"][1].prestation;
const instantane = async () => JSON.stringify(await tous("select p.id, p.prix_vente::float8 v, p.libelle, p.details, n.net::float8 n from prestations p left join prestations_nets n on n.prestation_id = p.id where p.entite_id = $1 and p.id <> $2 and p.details->>'guide' is null order by p.id", [ent.secret, kradan]));
const netKradan = async () => (await un("select net::float8 n from prestations_nets where prestation_id = $1", [kradan])).n;
const prixDe = async (id) => (await un("select prix_vente::float8 p from prestations where id = $1", [id])).p;
const avantLanta = await instantane();
const netAvant = await netKradan();

console.log("== Ao Nang : passage sur une base vide ==");
const PIDS = [...new Set([...SQL.AONANG.matchAll(/md5\('carnet-partenaire:([^']+)'\)::uuid/g)].map((m) => md5uuid(`carnet-partenaire:${m[1]}`)))];
const TARIFS = "details->>'guide' = 'aonang'";
const compte = async () => ({
  partenaires: await n("select count(*) n from partenaires where id = any($1::uuid[])", [PIDS]),
  tarifs: await n(`select count(*) n from prestations where ${TARIFS}`),
  nets: await n(`select count(*) n from prestations_nets where prestation_id in (select id from prestations where ${TARIFS})`),
  regles: await n("select count(*) n from partenaires_prives where commission_regle is not null and partenaire_id = any($1::uuid[])", [PIDS]),
});
const avantPrestations = await n("select count(*) n from prestations");
await db.exec(SQL.AONANG);
let c = await compte();
ok(PIDS.length === 3 && c.partenaires === 3 && c.tarifs === 18 && c.nets === 17 && c.regles === 3, `3 partenaires, 18 tarifs, 17 nets, 3 règles (${JSON.stringify(c)})`);
ok((await n("select count(*) n from prestations")) === avantPrestations + 18, "rien d'autre n'est écrit");
for (const s of ["ztp", "taxi"]) ok((await n(`select count(*) n from prestations where entite_id = $1 and ${TARIFS}`, [ent[s]])) + (await n("select count(*) n from partenaires where entite_id = $1 and id = any($2::uuid[])", [ent[s], PIDS])) === 0, `rien dans ${s}`);
ok((await n(`select count(*) n from prestations where ${TARIFS} and entite_id <> $1`, [ent.secret])) === 0, "tous les tarifs sont dans Secret");
const regles = await tous("select pp.commission_regle r, p.regles from partenaires p join partenaires_prives pp on pp.partenaire_id = p.id where p.id = any($1::uuid[])", [PIDS]);
ok(regles.every((x) => x.r.type === "vente_moins_net" && x.regles.mode_reglement === "sur_place"), "commission « vente moins net » et règlement sur place pour chaque partenaire");
const sansNet = await tous(`select libelle_en from prestations p where ${TARIFS} and not exists (select 1 from prestations_nets n where n.prestation_id = p.id)`);
ok(sansNet.length === 1 && /VIP Set/.test(sansNet[0].libelle_en), "seul le VIP Set n'a pas de net (à confirmer)");
ok((await n(`select count(*) n from prestations p join prestations_nets x on x.prestation_id = p.id where p.details->>'guide' = 'aonang' and p.prix_vente - x.net < 0`)) === 0, "aucune commission négative");
ok((await n(`select count(*) n from prestations where ${TARIFS} and (sur_place or not actif or prix_vente is null)`)) === 0, "tous les tarifs sont actifs, avec un prix, ni « frais » ni sur place");
const noms = (await tous("select nom from partenaires where id = any($1::uuid[])", [PIDS])).map((x) => x.nom.toLowerCase());
const textes = await tous(`select libelle, libelle_en, groupe, details::text d from prestations where ${TARIFS}`);
ok(noms.length === 3 && !textes.some((r) => noms.some((nom) => `${r.libelle} ${r.libelle_en} ${r.groupe} ${r.d}`.toLowerCase().includes(nom))), "aucun nom de partenaire dans un tarif");
ok((await n(`select count(*) n from prestations where ${TARIFS} and groupe = 'Krabi, Ao Nang' and unite = 'boat' and details->>'parc' ~ 'Foreign adult: [0-9]+ ฿ \\| Foreign child: [0-9]+ ฿' and details->>'parc' like '%To be paid in cash on site'`)) === 15, "les 15 sorties disent les droits d'entrée en plus, payés sur place");
ok((await n(`select count(*) n from prestations where ${TARIFS} and groupe like 'Option%'`)) === 3, "3 options (2 lunch box, 1 VIP Set), groupe « Option » : pas de voucher");

console.log("== Ao Nang : mêmes identifiants que carnet-produits.mjs, bon tarif ==");
const { PRODUITS_CARNET } = await import(SRC + "carnet-produits.mjs");
const { lireMessage, offresDuService } = await import(SRC + "demande-calc.mjs");
const { ajusterAgesCarnet } = await import(SRC + "carnet-ages.mjs");
const catalogue = async () => ({ prestations: await tous("select id, partenaire_id, famille, groupe, libelle, libelle_en, prix_vente::float8 as prix_vente, unite, details, sur_place, actif from prestations where entite_id = $1", [ent.secret]), trajets: [], partenaires: await tous("select id, actif from partenaires where entite_id = $1", [ent.secret]), nomPartenaire: () => "" });
const ids = PRODUITS_CARNET.filter((p) => p.guide === "aonang").flatMap((p) => p.options.flatMap((o) => o.tarifs.map((t) => t.prestation)));
const dansBase = new Set((await catalogue()).prestations.map((p) => p.id));
ok(ids.length === 18 && ids.every((id) => dansBase.has(id)), "les 18 tarifs du module existent en base, avec le même identifiant");
const demande = async (produit, option, invites) => {
  const p = (await import(SRC + "carnet-produits.mjs")).PRODUITS_CARNET.find((x) => x.id === produit) || (await import(SRC + "site-produits.mjs")).PRODUITS_SITE.find((x) => x.id === produit);
  const o = p.options.find((x) => x.id === option);
  const texte = `Booking request: ${p.nom} – ${o.titre}\nDate: Sun 20 Dec 2026\nGuests: ${invites}\nName: Test`;
  const d = ajusterAgesCarnet({ ...lireMessage(texte, "2026-11-23"), carnet: { produit, option } });
  return offresDuService(d, texte, { phrase: texte, date: d.date, adultes: d.adultes, enfants: d.enfants }, await catalogue());
};
const vente = async (cle) => Number((await un("select prix_vente::float8 p from prestations where id = $1", [md5uuid(`carnet:${cle}`)])).p);
let o = (await demande("aonang-luxury-hong", "standard", "2 adults, 2 children (ages 5 and 9)"))[0];
ok(o.id === md5uuid("carnet:aonang-luxury-hong|standard|1 to 4 people") && o.total === (await vente("aonang-luxury-hong|standard|1 to 4 people")), "Luxury Hong, 4 personnes : le prix du bateau");
o = (await demande("aonang-prestige-phi-phi", "standard", "6 adults"))[0];
ok(o.total === (await vente("aonang-prestige-phi-phi|standard|1 to 6 people")) && o.avertissement === "", "Prestige Phi Phi, 6 personnes : le prix du bateau, sans alerte");
o = (await demande("aonang-vip-hong", "standard", "5 adults"))[0];
ok(o.avertissement === "groupe_hors_tranche", "VIP, 5 personnes : plus que le bateau, l'offre le dit");

console.log("== Ao Nang : rejeu ==");
const empreinte = async () => (await un(`select md5(string_agg(row_to_json(p)::text, '|' order by id)) m from (select * from prestations where ${TARIFS}) p`)).m + (await un("select md5(string_agg(row_to_json(p)::text, '|' order by id)) m from partenaires p where id = any($1::uuid[])", [PIDS])).m;
const e1 = await empreinte();
await db.exec(SQL.AONANG);
ok(JSON.stringify(await compte()) === JSON.stringify(c) && (await empreinte()) === e1, "rejouer ne change rien");
await db.query("update prestations set prix_vente = prix_vente + 1 where id = $1", [ids[0]]);
const net0 = (await un("select net::float8 n from prestations_nets where prestation_id = $1", [ids[0]])).n;
await db.query("update prestations_nets set net = net + 5 where prestation_id = $1", [ids[0]]);
await db.exec(SQL.AONANG);
ok((await un("select prix_vente::float8 p from prestations where id = $1", [ids[0]])).p === (await vente("aonang-vip-4-islands|standard|1 to 4 people")) && (await un("select net::float8 n from prestations_nets where prestation_id = $1", [ids[0]])).n === net0 + 5, "rejouer n'écrase ni un prix ni un net changés depuis");
await db.query("update prestations set prix_vente = prix_vente - 1 where id = $1", [ids[0]]);
await db.query("update prestations_nets set net = net - 5 where prestation_id = $1", [ids[0]]);

console.log("== Ao Nang : retour refusé quand un dossier utilise un tarif ==");
const client = (await un("insert into clients (entite_id, prenom, nom) values ($1, 'Anna', 'Test') returning id", [ent.secret])).id;
const dossier = (await un("insert into dossiers (entite_id, ref, client_id) values ($1, 'S-AONANG', $2) returning id", [ent.secret, client])).id;
await db.query("insert into reservations (entite_id, dossier_id, prestation_id, libelle, statut, personnes) values ($1, $2, $3, 'Ao Nang', 'confirme', '{}'::jsonb)", [ent.secret, dossier, ids[0]]);
let msg = await refuse(SQL.RETOUR_AONANG);
ok(msg && /réservations utilisent/.test(msg), "le retour refuse et le dit");
ok(JSON.stringify(await compte()) === JSON.stringify(c), "rien n'a été supprimé");
await db.query("delete from reservations where dossier_id = $1", [dossier]);

console.log("== Ao Nang : retour en arrière ==");
await db.exec(SQL.RETOUR_AONANG);
c = await compte();
ok(c.partenaires === 0 && c.tarifs === 0 && c.nets === 0 && c.regles === 0, `tout est défait (${JSON.stringify(c)})`);
ok((await n("select count(*) n from prestations")) === avantPrestations, "il reste exactement ce qu'il y avait avant");
await db.exec(SQL.RETOUR_AONANG);
ok(true, "le retour se rejoue sans erreur");
await db.exec(SQL.AONANG);
c = await compte();
ok(c.partenaires === 3 && c.tarifs === 18 && c.nets === 17 && c.regles === 3, "le fichier repasse après le retour");

console.log("== Koh Lanta : correctif ==");
const tranches = cles["koh-rok-koh-haa|private-longtail"].slice(2);
ok(tranches.length === 2, "le mapping du site porte les deux nouvelles tranches de Koh Rok");
const voulues = tranches.map((t) => ({ ...t, vente: Number(new RegExp(`'${t.prestation}', '${t.ligne}', (\\d+),`).exec(SQL.LANTA)[1]), net: Number(new RegExp(`\\('${t.prestation}', (\\d+)\\)`).exec(SQL.LANTA)[1]) }));
ok(voulues.every((t) => t.vente > 0 && t.net > 0), "le SQL dit le prix et le net de chaque tranche");

// Piège : une seconde ligne Kradan du même partenaire au même prix. Le fichier s'arrête SANS rien écrire (une seule ligne attendue, jamais « toutes celles qui ressemblent »).
const piege = await ligneKradan(lanta, ANCIEN);
msg = await refuse(SQL.LANTA);
ok(msg && /Plusieurs extensions Koh Kradan/.test(msg), "deux lignes Kradan au même prix : le fichier s'arrête et le dit");
ok((await prixDe(kradan)) === ANCIEN && (await prixDe(piege)) === ANCIEN && (await prixDe(kradanAutre)) === ANCIEN, "aucune des trois lignes n'a été modifiée");
ok((await n("select count(*) n from prestations where id = any($1::uuid[])", [tranches.map((t) => t.prestation)])) === 0, "aucune tranche n'a été écrite non plus (tout ou rien)");
await db.query("delete from prestations where id = $1", [piege]);

const resultats = await db.exec(SQL.LANTA);
ok((await prixDe(kradan)) === NOUVEAU && (await netKradan()) === netAvant, "l'extension Kradan du bon partenaire change de prix, son net est inchangé");
ok((await prixDe(kradanAutre)) === ANCIEN, "la ligne de même libellé d'un autre partenaire n'est pas touchée");
ok((await un("select details->>'prix_avant_guide_lanta' m from prestations where id = $1", [kradan])).m === String(ANCIEN), "la ligne modifiée est marquée de son prix d'avant");
const nouvelles = await tous("select p.id, p.prix_vente::float8 v, p.details, p.partenaire_id, p.groupe, p.libelle, x.net::float8 n from prestations p left join prestations_nets x on x.prestation_id = p.id where p.id = any($1::uuid[]) order by p.prix_vente", [tranches.map((t) => t.prestation)]);
ok(nouvelles.length === 2 && voulues.every((t) => nouvelles.some((x) => x.id === t.prestation && x.v === t.vente && x.n === t.net)), "les deux tranches de Koh Rok sont écrites avec le prix et le net du SQL");
ok(nouvelles.every((x) => x.v - x.n >= SEUIL), "chaque nouvelle tranche garde au moins la commission minimale que le SQL contrôle");
const modele = await un("select partenaire_id, groupe, libelle, details from prestations where id = $1", [rok46]);
ok(nouvelles.every((x) => x.partenaire_id === modele.partenaire_id && x.groupe === modele.groupe && x.libelle === modele.libelle && x.details.bateau === modele.details.bateau) && voulues.every((t) => nouvelles.find((x) => x.id === t.prestation).details.capacite === t.ligne), "elles copient la tranche de 4 à 6 personnes, la capacité change");
const apres = JSON.parse(await instantane()).filter((x) => !tranches.some((t) => t.prestation === x.id) && x.id !== kradanAutre);
ok(JSON.stringify(apres) === JSON.stringify(JSON.parse(avantLanta).filter((x) => x.id !== kradanAutre)), "aucune autre prestation de Koh Lanta n'a changé (valeurs, détails, nets)");
const lecture = resultats.map((r) => r.rows).filter((r) => r && r.length && "commission" in r[0]).flat();
ok(lecture.some((r) => r.libelle === "Charter test faible" && Number(r.commission) < SEUIL), "la lecture seule liste le tarif privé à faible commission");
ok(!lecture.some((r) => Number(r.commission) >= SEUIL), "la lecture seule ne liste que des commissions sous le seuil");
ok((await prixDe(faible)) === 3010, "le tarif à faible commission n'est pas modifié");

console.log("== Koh Lanta : rejeu ==");
const photo = JSON.stringify([await tous("select id, prix_vente::float8 v, details from prestations where entite_id = $1 order by id", [ent.secret]), await tous("select prestation_id, net::float8 n from prestations_nets order by prestation_id")]);
await db.exec(SQL.LANTA);
ok(JSON.stringify([await tous("select id, prix_vente::float8 v, details from prestations where entite_id = $1 order by id", [ent.secret]), await tous("select prestation_id, net::float8 n from prestations_nets order by prestation_id")]) === photo, "rejouer ne change rien");
await db.query("update prestations set prix_vente = prix_vente + 50 where id = any($1::uuid[])", [[kradan, tranches[0].prestation]]);
const modifie = [await prixDe(kradan), await prixDe(tranches[0].prestation)];
await db.exec(SQL.LANTA);
ok((await prixDe(kradan)) === modifie[0] && (await prixDe(tranches[0].prestation)) === modifie[1], "rejouer n'écrase pas une valeur changée depuis (la ligne marquée n'est plus retouchée)");
await db.query("update prestations set prix_vente = prix_vente - 50 where id = any($1::uuid[])", [[kradan, tranches[0].prestation]]);

console.log("== Koh Lanta : état attendu absent ==");
await db.query("update prestations set libelle = 'Autre extension' where id = $1", [kradan]);
msg = await refuse(SQL.LANTA);
ok(msg && /Extension Koh Kradan .*introuvable/.test(msg), "sans extension Kradan (marquée ou à l'ancien prix), le fichier s'arrête et le dit");
await db.query("update prestations set libelle = $2 where id = $1", [kradan, LIBELLE_KRADAN]);

console.log("== Koh Lanta : retour ==");
await db.query("insert into reservations (entite_id, dossier_id, prestation_id, libelle, statut, personnes) values ($1, $2, $3, 'Koh Rok', 'confirme', '{}'::jsonb)", [ent.secret, dossier, tranches[0].prestation]);
msg = await refuse(SQL.RETOUR_LANTA);
ok(msg && /réservations utilisent/.test(msg), "le retour refuse quand un dossier utilise une tranche");
ok((await prixDe(kradan)) === NOUVEAU, "rien n'a été défait");
await db.query("delete from reservations where dossier_id = $1", [dossier]);
// Piège symétrique : deux lignes marquées. Le retour s'arrête sans rien écrire.
await db.query("update prestations set details = details || jsonb_build_object('prix_avant_guide_lanta', $2::int), prix_vente = $3 where id = $1", [kradanAutre, ANCIEN, NOUVEAU]);
msg = await refuse(SQL.RETOUR_LANTA);
ok(msg && /Plusieurs extensions Koh Kradan marquées/.test(msg), "deux lignes marquées : le retour s'arrête et le dit");
ok((await prixDe(kradan)) === NOUVEAU && (await n("select count(*) n from prestations where id = any($1::uuid[])", [tranches.map((t) => t.prestation)])) === 2, "rien n'a été défait (tout ou rien)");
await db.query("update prestations set details = details - 'prix_avant_guide_lanta', prix_vente = $2 where id = $1", [kradanAutre, ANCIEN]);
await db.exec(SQL.RETOUR_LANTA);
ok((await prixDe(kradan)) === ANCIEN && (await un("select details ? 'prix_avant_guide_lanta' m from prestations where id = $1", [kradan])).m === false, "l'extension repasse à son prix d'avant et perd sa marque");
ok((await prixDe(kradanAutre)) === ANCIEN, "la ligne de l'autre partenaire est restée telle quelle");
ok((await n("select count(*) n from prestations where id = any($1::uuid[])", [tranches.map((t) => t.prestation)])) === 0 && (await n("select count(*) n from prestations_nets where prestation_id = any($1::uuid[])", [tranches.map((t) => t.prestation)])) === 0, "les deux tranches et leurs nets sont retirés");
ok(JSON.stringify(JSON.parse(await instantane())) === avantLanta, "il reste exactement l'état d'avant");
await db.exec(SQL.RETOUR_LANTA);
ok(true, "le retour se rejoue sans erreur");
await db.exec(SQL.LANTA);
ok((await prixDe(kradan)) === NOUVEAU, "le correctif repasse après le retour");
console.log(echecs ? `\n${echecs} échec(s)` : "\nTout passe.");
process.exit(echecs ? 1 : 0);
