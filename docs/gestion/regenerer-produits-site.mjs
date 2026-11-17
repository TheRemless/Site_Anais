// Recopie la liste des pages produit du site secrettravelandtour.com (identifiant, nom, marque, section, adresse, options) dans
// src/gestion/js/site-produits.mjs. Gestion s'en sert pour nommer les sorties d'une demande du site et pour cibler le bandeau.
// Lecture seule du dépôt du site : rien n'y est écrit. À relancer quand une page produit est ajoutée, renommée ou retirée :
//   node docs/gestion/regenerer-produits-site.mjs ~/Desktop/Secrettravelandtour
// Par défaut le script lit la branche origin/main (ce qui est en ligne), pas la copie de travail.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const depot = path.resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("Donnez le chemin du dépôt du site (Secrettravelandtour).");
const ref = process.argv[3] || "origin/main";
const git = (...args) => execFileSync("git", ["-C", depot, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// Dossier du fichier produit → section du site (même découpage que src/_data/products/README.md du site).
const SECTION = { tours: "islands", activities: "activities", "secret-transfers": "transfers", products: "rental", taxi: "taxi" };
const fichiers = git("ls-tree", "-r", "--name-only", ref, "src/_data/products").split("\n").filter((f) => f.endsWith(".json"));
const produits = fichiers.map((f) => {
  const p = JSON.parse(git("show", `${ref}:${f}`));
  const dossier = f.split("/").slice(-2, -1)[0];
  const marque = p.brand === "vip" ? "taxi" : "secret";
  return {
    id: p.slug,
    nom: p.name,
    marque,
    section: p.template === "rental" ? "rental" : SECTION[dossier] || "activities",
    url: p.url,
    ...(p.refPrefix ? { prefixe: p.refPrefix } : {}),
    options: (p.options || []).map((o) => ({ id: o.id, titre: o.label || o.title || o.id })),
  };
});
produits.sort((a, b) => a.marque.localeCompare(b.marque) || a.section.localeCompare(b.section) || a.nom.localeCompare(b.nom));
const commit = git("rev-parse", "--short", ref).trim();

const sortie = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/gestion/js/site-produits.mjs");
writeFileSync(
  sortie,
  `// Pages produit du site secrettravelandtour.com, recopiées par docs/gestion/regenerer-produits-site.mjs (${ref} ${commit}). Ne pas modifier à la main.
// marque : « secret » (Secret Travel & Tour) ou « taxi » (VIP Taxi Lanta, /taxi/). section : islands, activities, transfers, rental, taxi.
export const PRODUITS_SITE = [
${produits.map((p) => `  ${JSON.stringify(p)},`).join("\n")}
];
`
);
console.log(`${produits.length} produits écrits dans ${path.relative(process.cwd(), sortie)}`);
