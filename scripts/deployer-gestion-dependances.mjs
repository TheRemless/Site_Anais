// Fichiers qu'embarque chaque fonction Supabase de Gestion : son index.ts et tout ce qu'il importe en chemin relatif, de proche en proche
// (« ../agent/outils.js » fait entrer le dossier agent dans whatsapp-envoi). Les paquets jsr: et npm: ne comptent pas : leur version est
// écrite dans le code, donc un changement passe par un fichier.
// Utilisé par scripts/deployer-gestion.sh ; testé par tests/gestion-deployer.test.js.
//   node scripts/deployer-gestion-dependances.mjs [racine]   →  une ligne par fichier : « <fonction>\t<chemin depuis la racine> »
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;

// Les imports relatifs d'un texte source, dans l'ordre.
export function importsRelatifs(texte) {
  const sortie = [];
  for (const m of String(texte).matchAll(IMPORT)) if (m[1].startsWith("./") || m[1].startsWith("../")) sortie.push(m[1]);
  return sortie;
}

// Fermeture des imports d'une fonction : chemins relatifs à `racine`, triés. Un import introuvable lève (le déploiement échouerait aussi).
export function dependances(racine, fonction) {
  const dossier = path.join(racine, "supabase", "functions");
  const depart = path.join(dossier, fonction, "index.ts");
  const vus = new Set();
  const pile = [depart];
  while (pile.length) {
    const f = pile.pop();
    if (vus.has(f)) continue;
    if (!fs.existsSync(f)) throw new Error(`import introuvable : ${path.relative(racine, f)}`);
    vus.add(f);
    for (const i of importsRelatifs(fs.readFileSync(f, "utf8"))) pile.push(path.resolve(path.dirname(f), i));
  }
  return [...vus].map((f) => path.relative(racine, f).split(path.sep).join("/")).sort();
}

// Les fonctions : chaque dossier de supabase/functions qui a un index.ts.
export function fonctions(racine) {
  const dossier = path.join(racine, "supabase", "functions");
  return fs.readdirSync(dossier, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(dossier, d.name, "index.ts"))).map((d) => d.name).sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const racine = path.resolve(process.argv[2] || ".");
  for (const f of fonctions(racine)) for (const d of dependances(racine, f)) process.stdout.write(`${f}\t${d}\n`);
}
