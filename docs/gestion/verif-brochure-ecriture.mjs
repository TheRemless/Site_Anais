// Vérifie les migrations 124 (une ligne d'import de brochure écrite en une seule transaction) et 127 (ligne imprimée du trajet gardée) sur un Postgres en mémoire : schema.sql puis
// toutes les migrations. Données fictives seulement (transporteur « Démo », prix ronds).
// Contrôles : nouveau trajet et son net ensemble ; sans le droit « Prix nets », la ligne qui porte un net est refusée en entier (aucun trajet
// créé) ; sans « Modifier les prix de vente », rien ; prix changé avec sa ligne enfant séparée ; une erreur au milieu ne laisse rien ;
// une autre entreprise ou un autre partenaire refusés ; fermée à anon ; la migration se rejoue ; retour en arrière.
//   GESTION_SQL=<repo>/docs/gestion/ node verif-brochure-ecriture.mjs
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
const MIG = "migration-124-brochure-ecriture.sql";
const lire = (f) => fs.readFileSync(W + f, "utf8").replace("create extension if not exists pgcrypto;", "");
const db = new PGlite();
await db.exec(harnais);
await db.exec(lire("schema.sql") + lire("donnees-ztp-depart.sql"));
const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[89]|[2-9]\d|1\d\d)-.*\.sql$/.test(n)).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
ok(migrations.includes(MIG) && migrations.indexOf(MIG) > migrations.indexOf("migration-123-notifications-partenaire.sql"), "la migration 124 passe après la 123, sur une base vide");
for (const f of migrations) await db.exec(lire(f));

async function essaie(userId, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try { const r = await db.query(sql, params); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const compte = async (sql, p = []) => (await un(sql, p)).n;

// ---- Données fictives : une entreprise, trois rôles, un transporteur ---------------------------------------------------------------------
const ent = (await un("select id from entites where slug = 'secret'")).id;
const autreEnt = (await un("select id from entites where slug = 'taxi'")).id;
const ORG = (await un("select organisation_id from entites where id = $1", [ent])).organisation_id;
const BASE = ["partenaires.lire", "partenaires.ecrire"];
const roles = { admin: [...BASE, "partenaires.prix", "partenaires.nets"], sansNets: [...BASE, "partenaires.prix"], sansPrix: [...BASE, "partenaires.nets"] };
const u = {};
for (const [k, perms] of Object.entries(roles)) {
  u[k] = (await un("insert into auth.users (email) values ($1) returning id", [k + "@test.invalid"])).id;
  const r = (await un("insert into roles (entite_id, nom, permissions) values ($1, $2, $3) returning id", [ent, "Test " + k, perms])).id;
  await db.exec(`update profils set organisation_id = '${ORG}' where organisation_id is null`);
  await db.query("insert into membres values ($1, $2, $3) on conflict do nothing", [u[k], ent, r]);
}
const P = (await un("insert into partenaires (entite_id, nom, contact) values ($1, 'Transport Démo', '{}'::jsonb) returning id", [ent])).id;
const Pautre = (await un("insert into partenaires (entite_id, nom, contact) values ($1, 'Bateau Démo', '{}'::jsonb) returning id", [ent])).id;
const ecrireLigne = async (k, op) => {
  const r = await essaie(u[k], "select brochure_ecrire_ligne($1::jsonb) as r", [JSON.stringify({ entite_id: ent, ...op })]);
  return r.ok ? { ok: true, ...r.rows[0].r } : r;
};
const trajet = (extra = {}) => ({ partenaire_id: P, numero: 1, de: "Koh Lanta", vers: "Bangkok", mode: "Bus/Van", depart: "08:00", arrivee: "06:00 (next day)", duree: "22 h", prix_adulte: 1000, prix_enfant: null, bebe: "", periode: "Whole contract period", fenetres: [], actif: true, ...extra });

// ---- Nouveau trajet avec son net -------------------------------------------------------------------------------------------------------
const a = await ecrireLigne("admin", { table: "trajets", action: "creer", valeurs: trajet(), nets: { valeurs: { net_adulte: 800, net_enfant: null } } });
ok(a.ok && a.ligne && a.nets && Number(a.nets.net_adulte) === 800 && a.nets.trajet_id === a.ligne.id, "nouveau trajet et son net écrits ensemble, la base les rend");
ok(a.ok && a.ligne.arrivee === "06:00 (next day)" && a.ligne.duree === "22 h", "arrivée du lendemain et durée gardées telles quelles");

// ---- Droits contrôlés par la base ------------------------------------------------------------------------------------------------------
const avant = await compte("select count(*)::int n from trajets where entite_id = $1", [ent]);
const b = await ecrireLigne("sansNets", { table: "trajets", action: "creer", valeurs: trajet({ depart: "12:00" }), nets: { valeurs: { net_adulte: 700, net_enfant: null } } });
ok(!b.ok && /Prix nets/.test(b.err), "sans « Prix nets », une ligne qui porte un net est refusée");
ok((await compte("select count(*)::int n from trajets where entite_id = $1", [ent])) === avant, "… et son trajet n'est pas créé (tout ou rien)");
const c = await ecrireLigne("sansNets", { table: "trajets", action: "creer", valeurs: trajet({ depart: "12:00" }) });
ok(c.ok && c.nets === null, "sans « Prix nets », la même ligne sans net s'écrit");
const d = await ecrireLigne("sansPrix", { table: "trajets", action: "creer", valeurs: trajet({ depart: "14:00" }) });
ok(!d.ok && /prix de vente/.test(d.err), "sans « Modifier les prix de vente », rien ne s'écrit");
const e = await essaie(u.admin, "select brochure_ecrire_ligne($1::jsonb)", [JSON.stringify({ entite_id: autreEnt, table: "trajets", action: "creer", valeurs: trajet() })]);
ok(!e.ok, "une autre entreprise est refusée");

// ---- Une erreur au milieu ne laisse rien -----------------------------------------------------------------------------------------------
const n0 = await compte("select count(*)::int n from trajets where entite_id = $1", [ent]);
const f = await ecrireLigne("admin", { table: "trajets", action: "creer", valeurs: trajet({ depart: "16:00" }), nets: { valeurs: { net_adulte: "pas un nombre" } } });
ok(!f.ok && (await compte("select count(*)::int n from trajets where entite_id = $1", [ent])) === n0, "un net invalide annule toute la ligne");

// ---- Prix changé d'un trajet existant, net complété ---------------------------------------------------------------------------------------
const g = await ecrireLigne("admin", { table: "trajets", action: "modifier", id: c.ligne.id, valeurs: { prix_adulte: 1100, arrivee: "05:00 (next day)", de: "Ailleurs" }, nets: { valeurs: { net_adulte: 850, net_enfant: null } } });
ok(g.ok && Number(g.ligne.prix_adulte) === 1100 && g.ligne.de === "Koh Lanta" && g.ligne.arrivee === "05:00 (next day)", "prix et arrivée modifiés, une colonne non prévue ignorée");
ok(g.ok && Number(g.nets.net_adulte) === 850 && (await compte("select count(*)::int n from trajets_nets where trajet_id = $1", [c.ligne.id])) === 1, "net du trajet existant écrit une fois");
const g2 = await ecrireLigne("admin", { table: "trajets", action: "modifier", id: c.ligne.id, valeurs: {}, nets: { valeurs: { net_adulte: 860, net_enfant: 600 } } });
ok(g2.ok && Number(g2.nets.net_adulte) === 860 && (await compte("select count(*)::int n from trajets_nets where trajet_id = $1", [c.ligne.id])) === 1, "un second import met le net à jour, sans doublon");

// ---- Tarif avec sa ligne enfant séparée --------------------------------------------------------------------------------------------------
const adulte = (await un("insert into prestations (entite_id, partenaire_id, famille, libelle, prix_vente, unite) values ($1, $2, 'excursion', 'Sortie démo', 1000, 'pp') returning id", [ent, P])).id;
const enfant = (await un("insert into prestations (entite_id, partenaire_id, famille, libelle, prix_vente, unite) values ($1, $2, 'excursion', 'Sortie démo, child', 700, 'ch') returning id", [ent, P])).id;
const etranger = (await un("insert into prestations (entite_id, partenaire_id, famille, libelle, prix_vente, unite) values ($1, $2, 'excursion', 'Autre, child', 500, 'ch') returning id", [ent, Pautre])).id;
const h = await ecrireLigne("admin", { table: "prestations", action: "modifier", id: adulte, valeurs: { prix_vente: 1200 }, enfant: { id: enfant, valeurs: { prix_vente: 800 } }, nets: { valeurs: { net: 900, net_enfant: 600, note: "" } } });
ok(h.ok && Number(h.ligne.prix_vente) === 1200 && Number(h.enfant.prix_vente) === 800 && Number(h.nets.net) === 900, "prix adulte, prix enfant séparé et nets en une fois");
const i = await ecrireLigne("admin", { table: "prestations", action: "modifier", id: adulte, valeurs: { prix_vente: 1300 }, enfant: { id: etranger, valeurs: { prix_vente: 1 } } });
ok(!i.ok && Number((await un("select prix_vente from prestations where id = $1", [adulte])).prix_vente) === 1200 && Number((await un("select prix_vente from prestations where id = $1", [etranger])).prix_vente) === 500, "la ligne enfant d'un autre partenaire est refusée, le prix adulte n'a pas bougé");
const j = await ecrireLigne("admin", { table: "prestations", action: "creer", valeurs: { partenaire_id: P, famille: "transfert", groupe: "", libelle: "Transfert démo", libelle_en: "Transfert démo", prix_vente: 500, unite: "pp", sur_place: false, actif: true, ordre: 3, details: { note: "Importé de la brochure." } } });
ok(j.ok && j.ligne.libelle === "Transfert démo" && j.ligne.details.note === "Importé de la brochure." && j.nets === null, "nouveau tarif créé avec ses détails");
const k = await ecrireLigne("admin", { table: "prestations", action: "modifier", id: "00000000-0000-4000-8000-000000000999", valeurs: { prix_vente: 1 } });
ok(!k.ok && /existe plus/.test(k.err), "un tarif disparu est signalé");

// ---- Migration 127 : le texte imprimé du trajet gardé en base ---------------------------------------------------------------------------
const im = await ecrireLigne("admin", { table: "trajets", action: "creer", valeurs: trajet({ depart: "20:00", vers: "Nakhon Si Thammarat", imprime: "Lanta - Nakon | VIP Bus/Van | 20:00 | 04:00" }) });
ok(im.ok && im.ligne.imprime === "Lanta - Nakon | VIP Bus/Van | 20:00 | 04:00", "migration 127 : le trajet garde sa ligne imprimée");
const long = await ecrireLigne("admin", { table: "trajets", action: "creer", valeurs: trajet({ depart: "21:00", imprime: "x".repeat(900) }) });
ok(long.ok && long.ligne.imprime.length === 400, "migration 127 : la ligne imprimée est coupée à 400 caractères");
ok((await compte("select count(*)::int n from trajets where imprime is null")) === 0, "migration 127 : les trajets existants ont une ligne imprimée vide, jamais nulle");

// ---- Retour de la 127 : la fonction de la 124 revient, la colonne part ; puis la 127 se repose ----------------------------------------------
await db.exec(lire("retour-127-trajet-imprime.sql"));
ok((await compte("select count(*)::int n from information_schema.columns where table_name = 'trajets' and column_name = 'imprime'")) === 0, "retour 127 : colonne imprime retirée");
const apresRetour = await ecrireLigne("admin", { table: "trajets", action: "creer", valeurs: trajet({ depart: "22:00", imprime: "ignoré" }) });
ok(apresRetour.ok && !("imprime" in apresRetour.ligne), "retour 127 : brochure_ecrire_ligne de la 124 écrit sans « imprime »");
await db.exec(lire("migration-127-trajet-imprime.sql"));
ok((await ecrireLigne("admin", { table: "trajets", action: "creer", valeurs: trajet({ depart: "23:00", imprime: "x" }) })).ligne.imprime === "x", "et la 127 se repose après son retour");

// ---- Fermée à anon ---------------------------------------------------------------------------------------------------------------------
let anonOk;
try { await db.exec("set role anon;"); await db.query("select brochure_ecrire_ligne('{}'::jsonb)"); anonOk = true; } catch { anonOk = false; } finally { await db.exec("reset role;"); }
ok(!anonOk, "fermée à anon");

// ---- Rejeu et retour en arrière ---------------------------------------------------------------------------------------------------------
await db.exec(lire(MIG));
ok((await compte("select count(*)::int n from pg_proc where proname = 'brochure_ecrire_ligne'")) === 1, "la migration 124 se rejoue sans effet");
await db.exec(lire("retour-124-brochure-ecriture.sql"));
ok((await compte("select count(*)::int n from pg_proc where proname = 'brochure_ecrire_ligne'")) === 0, "retour : fonction retirée");
await db.exec(lire(MIG));
ok((await ecrireLigne("admin", { table: "trajets", action: "creer", valeurs: trajet({ depart: "18:00" }) })).ok, "et la 124 se repose après le retour");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
