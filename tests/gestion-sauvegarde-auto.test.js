import test from "node:test";
import assert from "node:assert/strict";
import { chiffrer, dechiffrer, retention, nomSauvegarde, dateDuNom, sqlDeRestauration, serialiser, deserialiser } from "../docs/gestion/sauvegarde/sauvegarde-lib.mjs";

test("chiffrement : un aller-retour rend le contenu, une mauvaise phrase ou un fichier modifié est refusé", () => {
  const contenu = Buffer.from(JSON.stringify({ clients: [{ nom: "Dupont", telephone: "+41791234567" }] }));
  const f = chiffrer(contenu, "phrase de test");
  assert.ok(!f.includes("Dupont"), "rien de lisible dans le fichier");
  assert.deepEqual(dechiffrer(f, "phrase de test"), contenu);
  assert.throws(() => dechiffrer(f, "autre phrase"), /incorrect|modifi/i);
  const abime = Buffer.from(f);
  abime[abime.length - 1] ^= 1;
  assert.throws(() => dechiffrer(abime, "phrase de test"), /incorrect|modifi/i);
  assert.throws(() => dechiffrer(Buffer.from("pas une sauvegarde"), "x"), /format/i);
  // Deux chiffrements du même contenu diffèrent (sel et vecteur aléatoires).
  assert.notDeepEqual(chiffrer(contenu, "p"), chiffrer(contenu, "p"));
});

test("sérialisation : compressée, et relue à l'identique", () => {
  const s = { manifest: { version: 1 }, tables: { "public.a": [{ id: 1, t: "é" }] }, schema: {} };
  const octets = serialiser(s);
  assert.deepEqual(deserialiser(octets), s);
});

test("noms de fichiers : AAAA-MM-JJ, et la date se relit", () => {
  assert.equal(nomSauvegarde("2026-11-12"), "gestion-2026-11-12.gsb");
  assert.equal(dateDuNom("gestion-2026-11-12.gsb"), "2026-11-12");
  assert.equal(dateDuNom("journal.log"), null);
  assert.equal(dateDuNom("gestion-2026-11-12.gsb.tmp"), null);
});

const jourN = (n) => new Date(Date.UTC(2026, 0, 1) + n * 86400000).toISOString().slice(0, 10);
const jours = (debut, n) => Array.from({ length: n }, (_, i) => nomSauvegarde(jourN(debut + i)));

test("rotation : 30 quotidiennes et 12 mensuelles (la plus ancienne de chaque mois), rien d'autre ne part", () => {
  // 400 jours consécutifs de sauvegardes, aujourd'hui le dernier.
  const noms = jours(0, 400);
  const aujourdhui = dateDuNom(noms[noms.length - 1]);
  const { garder, supprimer } = retention(noms, aujourdhui);
  for (const q of noms.slice(-30)) assert.ok(garder.includes(q), `${q} gardée (30 derniers jours)`);
  // 12 mois les plus récents : la première sauvegarde de chaque mois est gardée.
  const mois = [...new Set(noms.map((n) => dateDuNom(n).slice(0, 7)))].slice(-12);
  for (const m of mois) assert.ok(garder.includes(noms.find((n) => dateDuNom(n).startsWith(m))), `première du mois ${m} gardée`);
  assert.equal(garder.length + supprimer.length, noms.length);
  assert.ok(garder.length <= 42, `pas plus de 42 fichiers : ${garder.length}`);
  assert.ok(supprimer.length > 300);
  // Un fichier hors format n'est jamais proposé à la suppression.
  assert.ok(!retention([...noms, "journal.log", "notes.txt"], aujourdhui).supprimer.some((n) => !n.startsWith("gestion-")));
});

test("rotation : peu de fichiers, tout est gardé ; avec des trous (Mac éteint) les 30 derniers fichiers sont gardés", () => {
  assert.deepEqual(retention(jours(0, 5), "2026-01-05").supprimer, []);
  const creux = Array.from({ length: 40 }, (_, i) => nomSauvegarde(jourN(i * 3)));
  const r = retention(creux, jourN(39 * 3));
  for (const n of creux.slice(-30)) assert.ok(r.garder.includes(n));
});

test("script de restauration : une insertion par table, triggers coupés, séquences remises, jamais le séparateur dans les données", () => {
  const s = {
    manifest: { date: "2026-11-12" },
    tables: { "public.clients": [{ id: "a", nom: "Dupont $gsb$ piège" }], "public.vide": [], "public.journal": [{ id: 7, action: "insert" }] },
    schema: { colonnes: [{ table_schema: "public", table_name: "journal", column_name: "id", is_identity: "YES" }] },
  };
  const sql = sqlDeRestauration(s);
  assert.match(sql, /set local session_replication_role = replica/);
  assert.match(sql, /truncate table "public"\."clients", "public"\."vide", "public"\."journal" restart identity cascade/, "les tables sont vidées avant le chargement, y compris celles qui sont vides dans la sauvegarde");
  assert.match(sql, /ATTENTION/);
  assert.match(sql, /insert into "public"\."clients" overriding system value select \* from jsonb_populate_recordset\(null::"public"\."clients"/);
  assert.ok(!/insert into "public"\."vide"/.test(sql), "table vide : rien à insérer");
  assert.match(sql, /setval\(pg_get_serial_sequence\('"public"\."journal"', 'id'\)/);
  const tag = sql.match(/\$(gsb[0-9a-f]+)\$/)[1];
  assert.ok(!JSON.stringify(s).includes(`$${tag}$`));
});

// ---- Orchestration : dossiers temporaires, fausse base, fausses notifications -------------------------------------------------------------------------------
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lancerSauvegarde, verifierFraicheur } from "../docs/gestion/sauvegarde/sauvegarder.mjs";

const fausseBase = (rows = [{ id: "d1" }]) => async (sql) => {
  if (sql.includes("information_schema.tables")) return [{ table_schema: "public", table_name: "dossiers" }];
  if (sql.includes('from "public"."dossiers"')) return [{ donnees: rows }];
  return [{ donnees: [] }];
};
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gsb-"));
const options = (extra = {}) => {
  const racine = temp();
  const notes = [];
  return { notes, racine, o: { requete: fausseBase(), phrase: "p", destination: path.join(racine, "dest"), dossierEtat: path.join(racine, "etat"), maintenant: () => new Date(2026, 10, 12, 9, 30), notifier: (t, m) => notes.push(m), ...extra } };
};

test("sauvegarde du jour : fichier chiffré (droits 600) et une ligne de journal ; refaite le même jour, elle ne fait rien", async () => {
  const { o, notes } = options();
  const r = await lancerSauvegarde(o);
  assert.equal(r.statut, "ok");
  const fichier = path.join(o.destination, "gestion-2026-11-12.gsb");
  assert.ok(fs.existsSync(fichier));
  assert.equal(fs.statSync(fichier).mode & 0o777, 0o600);
  assert.ok(!fs.readFileSync(fichier).includes("d1"), "contenu chiffré");
  assert.ok(!fs.readdirSync(o.destination).some((n) => n.endsWith(".tmp")), "aucun fichier temporaire laissé");
  const journal = fs.readFileSync(path.join(o.destination, "journal.log"), "utf8");
  assert.match(journal, /^2026-11-12 09:30:00 OK gestion-2026-11-12\.gsb 1 lignes, 1 tables/m);
  assert.equal((await lancerSauvegarde(o)).statut, "deja");
  assert.equal(fs.readFileSync(path.join(o.destination, "journal.log"), "utf8"), journal, "rien de plus au journal");
  assert.deepEqual(notes, []);
});

test("échec : une ligne au journal, une seule notification par jour, et rien d'écrit dans le dossier des sauvegardes", async () => {
  const { o, notes } = options({ requete: async () => { throw new Error("supabase db query a échoué (code 1) : réseau coupé"); } });
  const r = await lancerSauvegarde(o);
  assert.equal(r.statut, "echec");
  assert.match(fs.readFileSync(path.join(o.destination, "journal.log"), "utf8"), /ECHEC supabase db query a échoué/);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /a échoué.*Aucune sauvegarde réussie/);
  await lancerSauvegarde({ ...o, force: true });
  assert.equal(notes.length, 1, "pas de deuxième alerte le même jour");
  assert.ok(!fs.readdirSync(o.destination).some((n) => n.endsWith(".gsb")));
  assert.ok(!fs.existsSync(path.join(o.dossierEtat, "verrou")), "le verrou est levé après un échec");
  // Le lendemain l'alerte repart.
  await lancerSauvegarde({ ...o, force: true, maintenant: () => new Date(2026, 10, 13, 9, 30) });
  assert.equal(notes.length, 2);
});

test("une base qui ne ressemble pas à Gestion (pas de table dossiers) est refusée, pas sauvegardée", async () => {
  const { o, notes } = options({ requete: async (sql) => (sql.includes("information_schema.tables") ? [{ table_schema: "public", table_name: "autre" }] : [{ donnees: [] }]) });
  assert.equal((await lancerSauvegarde(o)).statut, "echec");
  assert.match(notes[0], /dossiers/);
});

test("rotation et copies : les vieux fichiers partent dans chaque dossier, une copie impossible est signalée sans perdre la sauvegarde", async () => {
  const { o, racine, notes } = options();
  const copie = path.join(racine, "icloud");
  fs.mkdirSync(o.destination, { recursive: true });
  fs.mkdirSync(copie, { recursive: true });
  for (let i = 0; i < 400; i++) {
    const nom = nomSauvegarde(new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10));
    if (nom >= "gestion-2026-11-12.gsb") continue;
    fs.writeFileSync(path.join(o.destination, nom), "x");
    fs.writeFileSync(path.join(copie, nom), "x");
  }
  fs.writeFileSync(path.join(racine, "fichier"), "pas un dossier");
  const r = await lancerSauvegarde({ ...o, copies: [copie, path.join(racine, "fichier", "impossible")] });
  assert.equal(r.statut, "ok");
  for (const d of [o.destination, copie]) {
    const gsb = fs.readdirSync(d).filter((n) => n.endsWith(".gsb"));
    assert.ok(gsb.length <= 42 && gsb.includes("gestion-2026-11-12.gsb"), `${d} : ${gsb.length} fichier(s)`);
  }
  assert.equal(r.avertissements.length, 1);
  assert.match(r.avertissements[0], /copie .*impossible/);
  assert.equal(notes.length, 1, "la copie manquée est signalée");
  assert.ok(fs.existsSync(path.join(o.destination, "journal.log")));
});

test("fichiers joints : leur existence est signalée (ils ne sont pas dans la base)", async () => {
  const { o, notes } = options({ requete: async (sql) => (sql.includes("information_schema.tables") ? [{ table_schema: "public", table_name: "dossiers" }, { table_schema: "storage", table_name: "objects" }] : sql.includes('from "storage"."objects"') ? [{ donnees: [{ id: "o1" }] }] : sql.includes('from "public"."dossiers"') ? [{ donnees: [{ id: "d" }] }] : [{ donnees: [] }]) });
  const r = await lancerSauvegarde(o);
  assert.equal(r.statut, "ok");
  assert.match(r.avertissements[0], /fichier\(s\) joint\(s\)/);
  assert.match(notes[0], /fichier\(s\) joint/);
});

test("fraîcheur : une alerte quand la dernière sauvegarde a plus d'un jour d'écart, une fois par jour", () => {
  const { o, notes } = options();
  fs.mkdirSync(o.destination, { recursive: true });
  fs.writeFileSync(path.join(o.destination, "gestion-2026-11-09.gsb"), "x");
  const d = { dossierEtat: o.dossierEtat, destination: o.destination, maintenant: () => new Date(2026, 10, 12, 10), notifier: o.notifier };
  assert.equal(verifierFraicheur(d).jours, 3);
  assert.equal(verifierFraicheur(d).jours, 3);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /depuis 3 jours/);
  fs.writeFileSync(path.join(o.destination, "gestion-2026-11-11.gsb"), "x");
  assert.equal(verifierFraicheur({ ...d, dossierEtat: path.join(o.dossierEtat, "autre") }).vieille, false, "hier : pas d'alerte");
});
