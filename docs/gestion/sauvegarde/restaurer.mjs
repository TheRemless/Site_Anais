// Restauration d'une sauvegarde Gestion : déchiffre, vérifie, puis écrit le script SQL de rechargement. Ne touche à aucune base : le script produit s'exécute à la main
// sur la base à reconstruire (voir README.md).
//
//   node restaurer.mjs gestion-2026-11-12.gsb                     vérifie le fichier et affiche son contenu (nombre de lignes par table)
//   node restaurer.mjs gestion-2026-11-12.gsb --sql restauration.sql   écrit en plus le script SQL (données personnelles : à supprimer après usage)
//
// La phrase vient du trousseau macOS (service « Sauvegardes Gestion ») ou de la variable GESTION_SAUVEGARDE_PHRASE.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { dechiffrer, deserialiser, verifier, sqlDeRestauration } from "./sauvegarde-lib.mjs";

const args = process.argv.slice(2);
const fichier = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--sql");
const iSql = args.indexOf("--sql");
const sortie = iSql >= 0 ? args[iSql + 1] : null;
if (!fichier || (iSql >= 0 && !sortie)) {
  console.error("Usage : node restaurer.mjs <fichier.gsb> [--sql sortie.sql]");
  process.exit(2);
}
const phrase = process.env.GESTION_SAUVEGARDE_PHRASE || execFileSync("/usr/bin/security", ["find-generic-password", "-s", "Sauvegardes Gestion", "-a", "gestion", "-w"], { encoding: "utf8" }).trim();
let sauvegarde;
try {
  sauvegarde = deserialiser(dechiffrer(fs.readFileSync(fichier), phrase));
} catch (err) {
  console.error(`ÉCHEC : ${err.message}`);
  process.exit(1);
}
const problemes = verifier(sauvegarde);
if (problemes.length) {
  console.error(`ÉCHEC : la sauvegarde est incohérente :\n- ${problemes.join("\n- ")}`);
  process.exit(1);
}
const m = sauvegarde.manifest;
console.log(`Sauvegarde du ${m.date}${m.projet ? ` (projet ${m.projet})` : ""} : ${m.total_lignes} lignes dans ${Object.keys(m.tables).length} tables. Manifeste vérifié.`);
for (const [nom, t] of Object.entries(m.tables)) if (t.lignes) console.log(`  ${nom} : ${t.lignes}`);
if (m.fichiers_joints) console.log(`ATTENTION : ${m.fichiers_joints} fichier(s) joint(s) existaient : ils ne sont pas dans cette sauvegarde.`);
if (sortie) {
  fs.writeFileSync(sortie, sqlDeRestauration(sauvegarde), { mode: 0o600 });
  console.log(`Script SQL écrit dans ${sortie} (il VIDE les tables avant de les recharger). Supprimez-le après usage.`);
}
