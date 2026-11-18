// Vérifie la migration 44 (noms et marques à l'écran) sur un Postgres en mémoire : les entreprises d'Anaïs reçoivent ses valeurs
// d'aujourd'hui (rien ne change pour elle), une valeur déjà enregistrée est gardée, une valeur vide écrite par l'outil déployé avant
// la migration compte comme absente, une autre organisation n'est pas touchée, et la migration se rejoue sans rien écrire.
// Comme les autres contrôles qui lisent le code de l'outil : à lancer depuis un dossier voisin de `src` (« ../src/gestion/js »).
//   mkdir -p /tmp/verif/v && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17 && ln -s <repo>/src src
//   cp <repo>/docs/gestion/verif-noms-marques.mjs v/ && cd v && GESTION_SQL=<repo>/docs/gestion/ node verif-noms-marques.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import { MESSAGES_DEFAUT, completerReglages } from "../src/gestion/js/defauts.mjs";
const W = process.env.GESTION_SQL || "./";
let echecs = 0;
const ok = (c, msg) => { if (!c) { echecs++; console.log("  ECHEC:", msg); } else console.log("  ok:", msg); };
const harnais = `
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now(), raw_user_meta_data jsonb, raw_app_meta_data jsonb);
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
const ZWALD = "00000000-0000-0000-0000-00000000a000";
const ANAIS = "1b7ea0fd-cad0-44a8-bf1d-4a004478bb71";
const MIGRATION = fs.readFileSync(W + "migration-44-noms-marques.sql", "utf8");
const AVIS_AVANT = {
  "avis-fr": "Bonjour {prenom},\n\nNous espérons que {prestation} vous a plu ! Si vous avez deux minutes, un avis Google nous aiderait beaucoup :\n{lien_avis}\nMerci d'avance.\n\nÀ bientôt à Koh Lanta,\n{entreprise}",
  "avis-en": "Hello {prenom},\n\nWe hope you enjoyed {prestation}! If you have two minutes, a Google review would help us a lot:\n{lien_avis}\nThank you in advance.\n\nSee you again in Koh Lanta,\n{entreprise}",
};

// Une base comme la production avant la migration 44 : schéma, migrations jusqu'à la 43, comptes d'Anaïs (nom vide, comme en production)
// et de Jérémy, une autre organisation cliente.
async function base() {
  const db = new PGlite();
  await db.exec(harnais);
  await db.exec(fs.readFileSync(W + "schema.sql", "utf8").replace("create extension if not exists pgcrypto;", ""));
  const num = (f) => parseInt(f.split("-")[1]);
  const migrations = fs.readdirSync(W).filter((n) => /^migration-(1[789]|[2-9]\d)-.*\.sql$/.test(n)).sort((a, b) => num(a) - num(b));
  for (const f of migrations.filter((f) => num(f) < 44)) await db.exec(fs.readFileSync(W + f, "utf8"));
  const un = async (sql, p = []) => (await db.query(sql, p)).rows[0];
  const id = async (slug) => (await un("select id from entites where organisation_id = $1 and slug = $2", [ZWALD, slug]) || {}).id;
  const secret = await id("secret");
  const taxi = await id("taxi");
  const ztp = (await id("ztp")) || (await un("select id from entites where organisation_id = $1 and slug not in ('secret', 'taxi')", [ZWALD])).id;
  const compte = async (uid, email, nom, jours) => {
    await db.query("insert into auth.users (id, email, created_at) values ($1, $2, now() - ($3 || ' days')::interval)", [uid, email, String(jours)]);
    await db.query("insert into profils (user_id, email, nom, super_admin, organisation_id, created_at) values ($1, $2, $3, true, $4, now() - ($5 || ' days')::interval) on conflict (user_id) do update set nom = excluded.nom, super_admin = true, organisation_id = excluded.organisation_id", [uid, email, nom, ZWALD, String(jours)]);
  };
  await compte("00000000-0000-4000-8000-0000000000e1", "jeremy@exemple.test", "Jérémy", 400);
  await compte(ANAIS, "anais@exemple.test", "", 300);
  const autreOrg = (await un("insert into organisations (nom) values ('Agence Test') returning id")).id;
  const autre = (await un("insert into entites (slug, nom, organisation_id) values ('test', 'Agence Test', $1) returning id", [autreOrg])).id;
  await db.query("insert into reglages (entite_id, valeur) values ($1, $2)", [autre, { fonctionnement: "taxi", emetteur: { nom: "Agence Test" } }]);
  const r = async (e) => (await un("select valeur from reglages where entite_id = $1", [e])).valeur;
  const ecrire = (e, v) => db.query("update reglages set valeur = $2 where entite_id = $1", [e, v]);
  return { db, un, r, ecrire, ztp, secret, taxi, autre, autreOrg };
}

// ---- 1. Production telle que relevée le 18.11.2026 -----------------------------------------------------------------------------------
console.log("== Production d'aujourd'hui ==");
{
  const { db, un, r, ecrire, ztp, secret, taxi, autre, autreOrg } = await base();
  // ZTP : aucun message enregistré. Secret : ses messages (avis avec Koh Lanta), son logo. Taxi : ses messages, son logo, pas de photo.
  const zAvant = await r(ztp);
  delete zAvant.messages;
  await ecrire(ztp, zAvant);
  await ecrire(secret, { ...(await r(secret)), fonctionnement: "excursions", apparence: { logo: "assets/logo-secret.png" }, messages: [{ id: "avis-en", pour: "client", cle: "avis", langue: "en", titre: "Avis", corps: AVIS_AVANT["avis-en"] }], voucher: { nom: "Secret Travel & Tour", textes: { b_intro: "Intro de Secret" } } });
  await ecrire(taxi, { fonctionnement: "taxi", emetteur: { nom: "VIP Taxi Lanta", licence: "" }, apparence: { logo: "assets/logo-vip-taxi.webp" }, messages: [{ id: "taxi-avis-en", corps: "… VIP TAXI LANTA by Mr. Brown" }], voucher: { nom: "VIP Taxi Lanta", adresse: "Koh Lanta, Krabi, Thailand", textes: { b_intro: "Texte d'Anaïs" } } });
  const avantAutre = await r(autre);
  ok(!("messages" in (await r(ztp))), "ZTP : aucun message enregistré avant");

  await db.exec(MIGRATION);
  const [vZ, vS, vT] = [await r(ztp), await r(secret), await r(taxi)];
  ok((await un("select libelle_admin from organisations where id = $1", [ZWALD])).libelle_admin === "Administratrice générale", "Zwald : « Administratrice générale »");
  ok((await un("select libelle_admin from organisations where id = $1", [autreOrg])).libelle_admin === null, "autre organisation : libellé neutre (null)");
  for (const [nom, v] of [["ZTP", vZ], ["Secret", vS], ["Taxi", vT]]) {
    ok(v.responsable.prenom === "Anaïs" && v.responsable.prenom_th === "อานาอิส" && v.responsable.user_id === ANAIS, `${nom} : personne responsable Anaïs, son compte (nom vide en production)`);
    ok(v.emetteur.licence_libelle === "Licence TAT" && v.emetteur.licence_libelle_en === "TAT licence", `${nom} : « Licence TAT » / « TAT licence »`);
    ok(v.assistant_voix.lieu === "Koh Lanta (Thaïlande)", `${nom} : lieu de l'assistant`);
  }
  ok(vZ.emetteur.nom === zAvant.emetteur.nom, "ZTP : le reste de l'émetteur est gardé");
  ok(!vZ.voucher || !vZ.voucher.textes || !vZ.voucher.textes.b_merci, "ZTP (voyages sur mesure) : aucun texte de voucher ajouté");
  ok(JSON.stringify(vZ.messages.map((m) => m.id)) === JSON.stringify(MESSAGES_DEFAUT.map((m) => m.id)), "ZTP : les messages types d'avant enregistrés, tous, dans l'ordre");
  ok(vZ.messages.find((m) => m.id === "avis-fr").corps === AVIS_AVANT["avis-fr"] && vZ.messages.find((m) => m.id === "avis-en").corps === AVIS_AVANT["avis-en"], "ZTP : « À bientôt à Koh Lanta » gardé mot pour mot");
  ok(vZ.messages.filter((m) => !/^avis-/.test(m.id)).every((m) => m.corps === MESSAGES_DEFAUT.find((d) => d.id === m.id).corps), "ZTP : les autres messages sont ceux du code");
  ok(vS.messages.length === 1 && vS.messages[0].corps === AVIS_AVANT["avis-en"], "Secret : ses messages enregistrés ne bougent pas");
  ok(vT.messages[0].corps === "… VIP TAXI LANTA by Mr. Brown", "Taxi : ses messages enregistrés ne bougent pas");
  ok(vT.voucher.textes.b_merci === "Thank you for choosing VIP TAXI LANTA – we look forward to driving you safely and comfortably to your destination! 🚐✨", "Taxi : remerciement d'avant, mot pour mot");
  ok(vT.voucher.textes.b_signature === "VIP TAXI LANTA Team" && vT.voucher.textes.b_lieu === "Koh Lanta, Krabi, Thailand" && vT.voucher.textes.licence === "TAT licence", "Taxi : signature, lieu et licence d'avant");
  ok(vT.voucher.textes.b_intro === "Texte d'Anaïs" && vT.voucher.nom === "VIP Taxi Lanta" && vT.voucher.adresse === "Koh Lanta, Krabi, Thailand", "Taxi : textes et bloc voucher déjà enregistrés gardés");
  ok(vT.apparence.logo === "assets/logo-vip-taxi.webp" && vT.voucher.bandeau === "assets/taxi-bandeau.webp", "Taxi : son logo gardé, la photo d'avant enregistrée");
  ok(vS.apparence.logo === "assets/logo-secret.png" && vS.voucher.bandeau === "assets/secret-bandeau.webp", "Secret : son logo gardé, la photo d'avant enregistrée");
  ok(vS.voucher.textes.b_intro === "Intro de Secret" && vS.voucher.textes.licence === "TAT licence", "Secret : un texte déjà changé gardé, l'intitulé de licence d'avant ajouté");
  ok(/^Tu écris pour \{entreprise\}, un service de taxi privé à Koh Lanta/.test(vT.assistant_voix.fr) && /"Have a nice day, \{entreprise\}"\.$/.test(vT.assistant_voix.en), "Taxi : voix signée du nom de l'entreprise");
  ok(/^Tu écris comme Anaïs/.test(vS.assistant_voix.fr) && /"Have a lovely day, Anaïs"\.$/.test(vS.assistant_voix.en), "Secret : voix d'Anaïs");
  ok(vS.assistant_voix.fr.split("\n").length === 5, "la voix garde ses retours à la ligne");
  ok(JSON.stringify(await r(autre)) === JSON.stringify(avantAutre), "autre organisation : réglages inchangés");

  // Les valeurs remplies, écrites pour le test JS (tests/fixtures/noms-marques-reglages.json) : même source que la base.
  const ajoute = (v) => ({ responsable: { ...v.responsable, user_id: "" }, emetteur: { licence_libelle: v.emetteur.licence_libelle, licence_libelle_en: v.emetteur.licence_libelle_en }, ...(v.voucher && v.voucher.textes ? { voucher: { bandeau: v.voucher.bandeau, textes: Object.fromEntries(["licence", "b_merci", "b_signature", "b_lieu"].map((k) => [k, v.voucher.textes[k]])) } } : {}), ...(v.apparence && v.apparence.logo ? { apparence: { logo: v.apparence.logo } } : {}), assistant_voix: v.assistant_voix });
  if (process.env.ECRIRE_FIXTURE) fs.writeFileSync(process.env.ECRIRE_FIXTURE, JSON.stringify({ ztp: { ...ajoute(vZ), messages: vZ.messages.filter((m) => /^avis-/.test(m.id)) }, secret: ajoute(vS), taxi: ajoute(vT) }, null, 1));

  console.log("== Deuxième passage ==");
  const versions = async () => (await un("select count(*)::int n from reglages_historique")).n;
  const majs = async () => (await un("select string_agg(updated_at::text, ',' order by entite_id) s from reglages")).s;
  const [v1, m1] = [await versions(), await majs()];
  await db.exec(MIGRATION);
  ok((await versions()) === v1 && (await majs()) === m1, "rejouée : aucune ligne réécrite, aucun historique en plus");

  console.log("== Droit de modifier le libellé ==");
  await db.exec("grant all on all tables in schema public to authenticated; revoke update on organisations from authenticated;");
  for (const l of fs.readFileSync(W + "migration-42-organisations.sql", "utf8").split("\n").filter((x) => /^grant update .* on organisations /.test(x))) await db.exec(l);
  for (const l of MIGRATION.split("\n").filter((x) => /^grant update .* on organisations /.test(x))) await db.exec(l);
  const essaie = async (uid, sql, p) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`); try { return (await db.query(sql, p)).rows.length; } catch (e) { return e.message; } finally { await db.exec("reset role;"); } };
  ok((await essaie(ANAIS, "update organisations set libelle_admin = 'Direction' where id = $1 returning id", [ZWALD])) === 1, "l'administration de l'organisation change le libellé");
  ok((await un("select libelle_admin from organisations where id = $1", [ZWALD])).libelle_admin === "Direction", "le libellé est enregistré");
  ok(typeof (await essaie(ANAIS, "update organisations set statut = 'suspendu' where id = $1 returning id", [ZWALD])) === "string", "le statut reste réservé à l'éditeur");
}

// ---- 2. L'outil déployé avant la migration : réglages enregistrés avec les valeurs neutres vides ---------------------------------------
console.log("== Outil déployé avant la migration ==");
{
  const { db, r, ecrire, ztp, taxi } = await base();
  // Un enregistrement depuis Réglages écrit les réglages complétés : responsable, voix et libellé vides, messages neutres du nouveau code.
  await ecrire(ztp, completerReglages(await r(ztp)));
  await ecrire(taxi, completerReglages({ fonctionnement: "taxi", emetteur: { nom: "VIP Taxi Lanta" }, apparence: { logo: "" }, voucher: { nom: "VIP Taxi Lanta", bandeau: "" } }));
  const z0 = await r(ztp);
  ok(z0.responsable && z0.responsable.prenom === "" && z0.emetteur.licence_libelle === "" && z0.assistant_voix.fr === "", "avant : valeurs vides enregistrées");
  ok(z0.messages.find((m) => m.id === "avis-fr").corps !== AVIS_AVANT["avis-fr"], "avant : avis neutre enregistré");
  await db.exec(MIGRATION);
  const [vZ, vT] = [await r(ztp), await r(taxi)];
  ok(vZ.responsable.prenom === "Anaïs" && vZ.responsable.user_id === ANAIS, "un responsable vide compte comme absent");
  ok(vZ.emetteur.licence_libelle === "Licence TAT" && vZ.emetteur.licence_libelle_en === "TAT licence", "un libellé de licence vide compte comme absent");
  ok(/^Tu écris comme Anaïs/.test(vZ.assistant_voix.fr) && vZ.assistant_voix.lieu === "Koh Lanta (Thaïlande)", "une voix vide compte comme absente");
  ok(vZ.messages.find((m) => m.id === "avis-fr").corps === AVIS_AVANT["avis-fr"] && vZ.messages.find((m) => m.id === "avis-en").corps === AVIS_AVANT["avis-en"], "l'avis neutre enregistré redevient celui d'avant");
  ok(vZ.messages.length === z0.messages.length, "les autres messages enregistrés restent");
  ok(vT.apparence.logo === "assets/logo-vip-taxi.webp" && vT.voucher.bandeau === "assets/taxi-bandeau.webp", "un logo et une photo vides comptent comme absents");
  ok(vT.voucher.textes.b_signature === "VIP TAXI LANTA Team", "Taxi : textes d'avant enregistrés");
}

console.log(echecs ? `${echecs} échec(s)` : "Tout est bon.");
process.exit(echecs ? 1 : 0);
