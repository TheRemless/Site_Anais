// Sauvegarde quotidienne de la base de Gestion, lancée par launchd (toutes les heures : elle ne fait quelque chose que si celle du jour manque, donc un Mac éteint
// ou en veille la rattrape dès qu'il se rallume). Lecture seule en production : chaque requête passe par `supabase db query --read-only`.
//
//   node sauvegarder.mjs            sauvegarde du jour si elle manque
//   node sauvegarder.mjs --force    en refait une même si celle du jour existe
//
// La phrase de chiffrement est dans le trousseau macOS (service « Sauvegardes Gestion »), jamais dans un fichier.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { exporter, verifier, chiffrer, dechiffrer, serialiser, deserialiser, nomSauvegarde, dateDuNom, retention, lignesDeLaReponse } from "./sauvegarde-lib.mjs";

const jourLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const heureLocale = (d) => `${jourLocal(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
const lireJson = (f, defaut) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return defaut; } };

// Cœur de la sauvegarde, avec ses dépendances passées en paramètres pour pouvoir être testé sans réseau ni trousseau.
export async function lancerSauvegarde({ requete, phrase, destination, copies = [], dossierEtat, projet = "", maintenant = () => new Date(), notifier = () => {}, force = false }) {
  const t0 = maintenant();
  const aujourdhui = jourLocal(t0);
  const nom = nomSauvegarde(aujourdhui);
  fs.mkdirSync(destination, { recursive: true });
  fs.mkdirSync(dossierEtat, { recursive: true });
  const fichierEtat = path.join(dossierEtat, "etat.json");
  const journal = path.join(destination, "journal.log");
  const noter = (ligne) => fs.appendFileSync(journal, `${heureLocale(maintenant())} ${ligne}\n`);
  const etat = lireJson(fichierEtat, {});
  const sauverEtat = () => fs.writeFileSync(fichierEtat, JSON.stringify(etat, null, 2));
  // Une alerte par jour au plus, pour ne pas en envoyer une toutes les heures tant que ça échoue.
  const alerter = (message) => {
    if (etat.derniere_alerte === aujourdhui) return;
    etat.derniere_alerte = aujourdhui;
    sauverEtat();
    notifier("Sauvegarde Gestion", message);
  };
  const existe = fs.existsSync(path.join(destination, nom));
  if (existe && !force) {
    // Rien à faire aujourd'hui, mais on vérifie que la dernière réussite n'est pas trop ancienne (copies manquantes, etc.).
    return { statut: "deja", nom };
  }
  const verrou = path.join(dossierEtat, "verrou");
  try {
    fs.writeFileSync(verrou, String(process.pid), { flag: "wx" });
  } catch {
    const age = Date.now() - fs.statSync(verrou).mtimeMs;
    if (age < 2 * 3600 * 1000) return { statut: "en_cours", nom };
    fs.writeFileSync(verrou, String(process.pid));
  }
  try {
    const sauvegarde = await exporter(requete, { projet, maintenant: t0 });
    const problemes = verifier(sauvegarde);
    if (problemes.length) throw new Error(`export incohérent : ${problemes.slice(0, 3).join(" ; ")}`);
    const chiffre = chiffrer(serialiser(sauvegarde), phrase);
    // Relecture complète avant d'accepter le fichier : déchiffrement, décompression, manifeste.
    const relue = deserialiser(dechiffrer(chiffre, phrase));
    const pb = verifier(relue);
    if (pb.length) throw new Error(`relecture de la sauvegarde impossible : ${pb.slice(0, 3).join(" ; ")}`);
    const ecrire = (dossier) => {
      fs.mkdirSync(dossier, { recursive: true });
      const tmp = path.join(dossier, `${nom}.tmp`);
      fs.writeFileSync(tmp, chiffre, { mode: 0o600 });
      fs.renameSync(tmp, path.join(dossier, nom));
    };
    ecrire(destination);
    const avertissements = [];
    for (const copie of copies) {
      try {
        ecrire(copie);
      } catch (err) {
        avertissements.push(`copie ${copie} : ${err.message}`);
      }
    }
    // Rotation dans chaque dossier : 30 quotidiennes, 12 mensuelles.
    for (const dossier of [destination, ...copies]) {
      try {
        const { supprimer } = retention(fs.readdirSync(dossier), aujourdhui);
        for (const n of supprimer) fs.rmSync(path.join(dossier, n));
      } catch {}
    }
    const sha = crypto.createHash("sha256").update(chiffre).digest("hex").slice(0, 16);
    if (sauvegarde.manifest.fichiers_joints > 0) avertissements.push(`${sauvegarde.manifest.fichiers_joints} fichier(s) joint(s) existent : ils ne sont PAS dans cette sauvegarde`);
    noter(`OK ${nom} ${sauvegarde.manifest.total_lignes} lignes, ${Object.keys(sauvegarde.tables).length} tables, ${chiffre.length} octets, sha256 ${sha}, ${copies.length - avertissements.filter((a) => a.startsWith("copie")).length} copie(s) en plus, ${Math.round((maintenant() - t0) / 1000)} s${avertissements.length ? ` ; ATTENTION : ${avertissements.join(" ; ")}` : ""}`);
    etat.dernier_succes = aujourdhui;
    etat.derniere_alerte = etat.derniere_alerte === aujourdhui ? null : etat.derniere_alerte;
    sauverEtat();
    for (const a of avertissements) alerter(a);
    return { statut: "ok", nom, taille: chiffre.length, lignes: sauvegarde.manifest.total_lignes, avertissements };
  } catch (err) {
    noter(`ECHEC ${err.message.replace(/\s+/g, " ").slice(0, 400)}`);
    const dernier = etat.dernier_succes ? `Dernière réussie : ${etat.dernier_succes}.` : "Aucune sauvegarde réussie pour l'instant.";
    alerter(`La sauvegarde du ${aujourdhui} a échoué : ${err.message.replace(/\s+/g, " ").slice(0, 120)}. ${dernier}`);
    return { statut: "echec", nom, erreur: err.message };
  } finally {
    fs.rmSync(verrou, { force: true });
  }
}

// Vérifie sans rien écrire que la dernière sauvegarde réussie n'est pas trop ancienne (36 h) : alerte sinon.
export function verifierFraicheur({ dossierEtat, destination, maintenant = () => new Date(), notifier = () => {} }) {
  const etat = lireJson(path.join(dossierEtat, "etat.json"), {});
  const noms = fs.existsSync(destination) ? fs.readdirSync(destination).map(dateDuNom).filter(Boolean).sort() : [];
  const derniere = noms[noms.length - 1] || etat.dernier_succes;
  const aujourdhui = jourLocal(maintenant());
  if (!derniere) return { vieille: true, jours: null };
  const jours = Math.round((new Date(`${aujourdhui}T00:00:00Z`) - new Date(`${derniere}T00:00:00Z`)) / 86400000);
  if (jours >= 2 && etat.derniere_alerte !== aujourdhui) {
    etat.derniere_alerte = aujourdhui;
    fs.mkdirSync(dossierEtat, { recursive: true });
    fs.writeFileSync(path.join(dossierEtat, "etat.json"), JSON.stringify(etat, null, 2));
    notifier("Sauvegarde Gestion", `Aucune sauvegarde de la base depuis ${jours} jours (dernière : ${derniere}).`);
  }
  return { vieille: jours >= 2, jours };
}

// ---- Branchements réels (trousseau, supabase, notifications macOS) ----------------------------------------------------------------------------------------------
export const CHEMINS = (home = os.homedir()) => ({
  app: path.join(home, "Library", "Application Support", "Sauvegardes Gestion"),
  destination: path.join(home, "Documents", "Sauvegardes Gestion"),
  icloud: path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs", "Sauvegardes Gestion"),
});

export function phraseDuTrousseau() {
  if (process.env.GESTION_SAUVEGARDE_PHRASE) return process.env.GESTION_SAUVEGARDE_PHRASE;
  return execFileSync("/usr/bin/security", ["find-generic-password", "-s", "Sauvegardes Gestion", "-a", "gestion", "-w"], { encoding: "utf8" }).trim();
}

export function requeteSupabase({ ref, bin = process.env.SUPABASE_BIN || "/opt/homebrew/bin/supabase", app }) {
  return async (sql) => {
    const tmp = fs.mkdtempSync(path.join(app, "req-"));
    const f = path.join(tmp, "q.sql");
    fs.writeFileSync(f, sql);
    try {
      // --read-only : la requête s'exécute dans une transaction en lecture seule, la base ne peut pas être modifiée, et la CLI ne demande aucune confirmation.
      const r = spawnSync(bin, ["db", "query", `--remote=${ref}`, "--read-only", "-f", f, "-o", "json", "--workdir", app], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 180000 });
      if (r.error) throw new Error(`supabase : ${r.error.message}`);
      const sortie = r.stdout || "";
      const debut = sortie.indexOf("{");
      if (r.status !== 0 || debut < 0) throw new Error(`supabase db query a échoué (code ${r.status}) : ${(r.stderr || sortie).replace(/\s+/g, " ").slice(0, 300)}`);
      return lignesDeLaReponse(sortie);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };
}

export const notifierMac = (titre, message) => {
  try {
    execFileSync("/usr/bin/osascript", ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(titre)} sound name "Basso"`]);
  } catch {}
};

async function principal() {
  const c = CHEMINS();
  const ref = process.env.GESTION_PROJET || "lkxqcmzeidlyssoqmqkh";
  const copies = [];
  if (fs.existsSync(path.dirname(c.icloud))) copies.push(c.icloud);
  const fichierCopies = path.join(c.app, "copies.txt");
  if (fs.existsSync(fichierCopies)) for (const l of fs.readFileSync(fichierCopies, "utf8").split("\n").map((x) => x.trim()).filter((x) => x && !x.startsWith("#"))) copies.push(l);
  let phrase;
  try {
    phrase = phraseDuTrousseau();
  } catch {
    fs.mkdirSync(c.destination, { recursive: true });
    fs.appendFileSync(path.join(c.destination, "journal.log"), `${heureLocale(new Date())} ECHEC phrase de chiffrement introuvable dans le trousseau (service « Sauvegardes Gestion »)\n`);
    notifierMac("Sauvegarde Gestion", "Phrase de chiffrement introuvable dans le trousseau : sauvegarde impossible.");
    process.exit(2);
  }
  const resultat = await lancerSauvegarde({ requete: requeteSupabase({ ref, app: c.app }), phrase, destination: c.destination, copies, dossierEtat: c.app, projet: ref, notifier: notifierMac, force: process.argv.includes("--force") });
  if (resultat.statut === "deja") verifierFraicheur({ dossierEtat: c.app, destination: c.destination, notifier: notifierMac });
  console.log(JSON.stringify(resultat));
  process.exit(resultat.statut === "echec" ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) principal();
