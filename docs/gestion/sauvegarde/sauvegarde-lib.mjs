// Sauvegarde automatique de la base de Gestion : export logique en JSON, chiffrement, rotation, script de restauration.
// Aucune dépendance : Node seul. Les fonctions qui touchent la base reçoivent `requete(sql) -> lignes`, branchée sur `supabase db query --read-only`
// en production (une lecture, jamais une écriture) et sur PGlite dans les contrôles (docs/gestion/verif-sauvegarde-archive.mjs).
import crypto from "node:crypto";
import zlib from "node:zlib";

const MAGIC = Buffer.from("GSB1");
const ident = (s) => `"${String(s).replaceAll('"', '""')}"`;
const sha256 = (texte) => crypto.createHash("sha256").update(texte).digest("hex");

// ---- Chiffrement : AES-256-GCM (authentifié : un fichier modifié est refusé), clé dérivée de la phrase par scrypt -----------------------------------------
// Format : « GSB1 » + sel (16) + vecteur (12) + étiquette (16) + contenu chiffré.
const cle = (phrase, sel) => crypto.scryptSync(String(phrase), sel, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });

export function chiffrer(contenu, phrase) {
  const sel = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", cle(phrase, sel), iv);
  const chiffre = Buffer.concat([c.update(contenu), c.final()]);
  return Buffer.concat([MAGIC, sel, iv, c.getAuthTag(), chiffre]);
}

export function dechiffrer(fichier, phrase) {
  if (!Buffer.isBuffer(fichier) || fichier.length < 48 || !fichier.subarray(0, 4).equals(MAGIC)) throw new Error("Ce fichier n'a pas le format d'une sauvegarde Gestion.");
  const sel = fichier.subarray(4, 20);
  const iv = fichier.subarray(20, 32);
  const etiquette = fichier.subarray(32, 48);
  const d = crypto.createDecipheriv("aes-256-gcm", cle(phrase, sel), iv);
  d.setAuthTag(etiquette);
  try {
    return Buffer.concat([d.update(fichier.subarray(48)), d.final()]);
  } catch {
    throw new Error("Phrase de chiffrement incorrecte, ou fichier modifié ou abîmé.");
  }
}

export const serialiser = (sauvegarde) => zlib.gzipSync(Buffer.from(JSON.stringify(sauvegarde)), { level: 9 });
export const deserialiser = (octets) => JSON.parse(zlib.gunzipSync(octets).toString("utf8"));

// ---- Noms et rotation -------------------------------------------------------------------------------------------------------------------------------
export const nomSauvegarde = (jour) => `gestion-${jour}.gsb`;
export const dateDuNom = (nom) => (/^gestion-(\d{4}-\d{2}-\d{2})\.gsb$/.exec(nom) || [])[1] || null;

// 30 sauvegardes quotidiennes (les 30 fichiers les plus récents, même s'il manque des jours : Mac éteint) et 12 mensuelles (la plus ancienne de chacun des 12 derniers
// mois). Un fichier qui n'a pas le format d'une sauvegarde n'est jamais proposé à la suppression.
export function retention(noms, aujourdhui, { quotidiennes = 30, mensuelles = 12 } = {}) {
  const valides = noms.filter((n) => dateDuNom(n) && dateDuNom(n) <= aujourdhui).sort((a, b) => dateDuNom(a).localeCompare(dateDuNom(b)));
  const garder = new Set(valides.slice(-quotidiennes));
  const mois = [...new Set(valides.map((n) => dateDuNom(n).slice(0, 7)))].slice(-mensuelles);
  for (const m of mois) garder.add(valides.find((n) => dateDuNom(n).startsWith(m)));
  // Les fichiers datés d'après aujourd'hui (horloge déréglée) ne sont jamais supprimés non plus.
  for (const n of noms) if (dateDuNom(n) && dateDuNom(n) > aujourdhui) garder.add(n);
  return { garder: [...garder].sort(), supprimer: noms.filter((n) => dateDuNom(n) && !garder.has(n)).sort() };
}

// ---- Export ------------------------------------------------------------------------------------------------------------------------------------------
// Tables sauvegardées : tout `public`, les comptes (`auth.users` et `auth.identities`, mots de passe hachés compris : la sauvegarde est chiffrée) et la liste des dossiers
// de fichiers (`storage.buckets`, `storage.objects` : les fichiers eux-mêmes ne sont pas dans la base).
const SQL_TABLES = `select table_schema, table_name from information_schema.tables where table_type = 'BASE TABLE' and (table_schema = 'public' or (table_schema = 'auth' and table_name in ('users', 'identities')) or (table_schema = 'storage' and table_name in ('buckets', 'objects'))) order by 1, 2`;

const json = (valeur) => (typeof valeur === "string" ? JSON.parse(valeur) : valeur);
async function agreger(requete, sql) {
  const lignes = await requete(`select coalesce(json_agg(t), '[]'::json) as donnees from (${sql}) t`);
  return json(lignes[0].donnees) || [];
}

export async function exporter(requete, { projet = "", maintenant = new Date() } = {}) {
  const liste = await requete(SQL_TABLES);
  const tables = {};
  const manifest = { version: 1, projet, date: maintenant.toISOString(), tables: {}, total_lignes: 0, fichiers_joints: 0 };
  for (const { table_schema: s, table_name: t } of liste) {
    const lignes = await agreger(requete, `select * from ${ident(s)}.${ident(t)}`);
    tables[`${s}.${t}`] = lignes;
    manifest.tables[`${s}.${t}`] = { lignes: lignes.length, sha256: sha256(JSON.stringify(lignes)) };
    manifest.total_lignes += lignes.length;
  }
  manifest.fichiers_joints = (tables["storage.objects"] || []).length;
  const noms = liste.map((x) => `'${x.table_schema}.${x.table_name}'`).join(", ") || "''";
  const schema = {
    colonnes: await agreger(requete, `select table_schema, table_name, column_name, data_type, udt_name, is_nullable, column_default, is_identity from information_schema.columns where table_schema || '.' || table_name in (${noms}) order by table_schema, table_name, ordinal_position`),
    contraintes: await agreger(requete, `select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`),
    index: await agreger(requete, `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`),
    fonctions: await agreger(requete, `select p.proname, pg_get_functiondef(p.oid) as definition from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' order by 1`),
    declencheurs: await agreger(requete, `select tgrelid::regclass::text as table_name, tgname, pg_get_triggerdef(oid) as definition from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace) order by 1, 2`),
    politiques: await agreger(requete, `select schemaname, tablename, policyname, cmd, roles::text as roles, qual, with_check from pg_policies where schemaname in ('public', 'storage') order by 1, 2, 3`),
  };
  return { manifest, tables, schema };
}

// Relit une sauvegarde : le contenu de chaque table correspond au manifeste (même nombre de lignes, même empreinte).
export function verifier(sauvegarde) {
  const problemes = [];
  const m = sauvegarde && sauvegarde.manifest;
  if (!m || m.version !== 1 || !sauvegarde.tables) return ["manifeste absent ou d'une autre version"];
  for (const [nom, attendu] of Object.entries(m.tables)) {
    const lignes = sauvegarde.tables[nom];
    if (!Array.isArray(lignes)) problemes.push(`${nom} : table absente`);
    else if (lignes.length !== attendu.lignes) problemes.push(`${nom} : ${lignes.length} ligne(s) au lieu de ${attendu.lignes}`);
    else if (sha256(JSON.stringify(lignes)) !== attendu.sha256) problemes.push(`${nom} : empreinte différente`);
  }
  if (!m.tables["public.dossiers"]) problemes.push("la table des dossiers manque : ce n'est pas la base de Gestion");
  return problemes;
}

// ---- Restauration ---------------------------------------------------------------------------------------------------------------------------------------
// Script SQL qui recharge les données dans une base dont le schéma est déjà recréé (docs/gestion/sauvegarde/README.md) : il vide d'abord les tables de la sauvegarde. Les déclencheurs et les clés étrangères sont
// coupés pendant le chargement (session_replication_role = replica) : l'ordre des tables n'a pas d'importance et les résumés ne sont pas recalculés. Les colonnes
// d'identité reçoivent leurs valeurs d'origine, puis leur séquence est remise après la plus grande.
export function sqlDeRestauration(sauvegarde) {
  const tout = JSON.stringify(sauvegarde.tables);
  let tag;
  do tag = `gsb${crypto.randomBytes(6).toString("hex")}`; while (tout.includes(`$${tag}$`));
  const sortie = [
    `-- Restauration de la sauvegarde Gestion du ${sauvegarde.manifest.date}${sauvegarde.manifest.projet ? ` (projet ${sauvegarde.manifest.projet})` : ""}.`,
    "-- À exécuter APRÈS avoir recréé le schéma (voir README). Contient des données personnelles : ne pas conserver ce fichier.",
    "-- ATTENTION : ce script VIDE les tables de la sauvegarde avant de les recharger (le schéma recréé contient déjà des données de départ : entreprises, rôles).",
    "-- Ne l'exécutez que sur la base à reconstruire, jamais sur une base en service dont vous voulez garder le contenu.",
    "begin;",
    "set local session_replication_role = replica;",
    `truncate table ${Object.keys(sauvegarde.tables).map((n) => n.split(".").map(ident).join(".")).join(", ")} restart identity cascade;`,
  ];
  for (const [nom, lignes] of Object.entries(sauvegarde.tables)) {
    if (!lignes.length) continue;
    const [s, t] = nom.split(".");
    sortie.push(`insert into ${ident(s)}.${ident(t)} overriding system value select * from jsonb_populate_recordset(null::${ident(s)}.${ident(t)}, $${tag}$${JSON.stringify(lignes)}$${tag}$::jsonb);`);
  }
  for (const c of (sauvegarde.schema && sauvegarde.schema.colonnes) || []) {
    if (c.is_identity === "YES" && (sauvegarde.tables[`${c.table_schema}.${c.table_name}`] || []).length) {
      sortie.push(`select setval(pg_get_serial_sequence('${ident(c.table_schema)}.${ident(c.table_name)}', '${c.column_name}'), coalesce((select max(${ident(c.column_name)}) from ${ident(c.table_schema)}.${ident(c.table_name)}), 1));`);
    }
  }
  sortie.push("commit;", "");
  return sortie.join("\n");
}
