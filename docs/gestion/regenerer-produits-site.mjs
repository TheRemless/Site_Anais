// Recopie la liste des pages produit du site secrettravelandtour.com (identifiant, nom, marque, section, adresse, options) dans
// src/gestion/js/site-produits.mjs. Gestion s'en sert pour nommer les sorties d'une demande du site, pour cibler le bandeau et pour
// choisir le tarif d'une demande collée (demande-calc.mjs, tarifsDuSite) : l'option cochée sur le site donne le tarif, sans deviner.
// Lecture seule du dépôt du site : rien n'y est écrit. À relancer quand une page produit, une option ou un prix est ajouté, renommé ou retiré :
//   node docs/gestion/regenerer-produits-site.mjs ~/Desktop/Secrettravelandtour
// Par défaut le script lit la branche origin/main (ce qui est en ligne), pas la copie de travail.
//
// Chaque option porte :
//   - `tarifs` : ses lignes de prix reliées à un tarif de Gestion par src/_data/gestion-keys.json du site (clé « slug|option|ligne »),
//     { ligne, prestation, libelle } : la ligne telle que le site l'écrit, l'identifiant du tarif dans Gestion et son libellé anglais.
//     Ni prix ni net : le tarif lui-même reste dans la base.
//     Une option sans ligne de prix (« Price on WhatsApp ») prend ses tarifs dans docs/gestion/cles-options-site.json de ce dépôt
//     (clé « slug|identifiant de l'option »), où `ligne` est la tranche de groupe du tarif.
//   - `anciens` : les titres que l'option a portés avant (historique git du site), pour lire un message envoyé avant un changement de nom.
// Les pages taxi n'ont pas d'option : chacune porte ses `tarifs` et les deux bouts de son trajet (voir pagesTaxi plus bas).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const depot = path.resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("Donnez le chemin du dépôt du site (Secrettravelandtour).");
const ref = process.argv[3] || "origin/main";
const git = (...args) => execFileSync("git", ["-C", depot, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
// Un fichier supprimé dans un commit (le commit qui le retire le cite aussi) : rien à lire, sans message d'erreur de git.
const lireJson = (spec) => {
  try {
    return JSON.parse(execFileSync("git", ["-C", depot, "show", spec], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
};

// Dossier du fichier produit → section du site (même découpage que src/_data/products/README.md du site).
const SECTION = { tours: "islands", activities: "activities", "secret-transfers": "transfers", products: "rental", taxi: "taxi" };
const fichiers = git("ls-tree", "-r", "--name-only", ref, "src/_data/products").split("\n").filter((f) => f.endsWith(".json"));
const cles = lireJson(`${ref}:src/_data/gestion-keys.json`) || {};
const ICI = path.dirname(fileURLToPath(import.meta.url));
const clesOptions = JSON.parse(readFileSync(path.join(ICI, "cles-options-site.json"), "utf8"));
const clesOptionsLues = new Set();

// Anciens titres de chaque option : tous les commits qui ont touché un fichier produit, option par option (même identifiant).
const titresPasses = new Map(); // « slug|id » → Set des titres
for (const commit of git("log", "--format=%H", ref, "--", "src/_data/products").split("\n").filter(Boolean)) {
  for (const f of git("show", "--name-only", "--format=", commit, "--", "src/_data/products").split("\n").filter((x) => x.endsWith(".json"))) {
    const p = lireJson(`${commit}:${f}`);
    if (!p || !p.slug) continue;
    for (const o of p.options || []) {
      const titre = o.label || o.title;
      if (!o.id || !titre) continue;
      const k = `${p.slug}|${o.id}`;
      if (!titresPasses.has(k)) titresPasses.set(k, new Set());
      titresPasses.get(k).add(titre);
    }
  }
}

// Pages trajet de VIP Taxi Lanta (/taxi/<trajet>/) : la liste et l'ordre de taxiRoutes.json, les faits de products/taxi/<trajet>.json ou, pour les
// trajets regroupés, de products/taxi/southern-thailand.json (même découpage que src/_data/taxiPages.js du site). Plus l'excursion à Krabi
// (krabiDayTrip.json). Pas d'option : la page porte elle-même ses `tarifs`, reliés par les clés « taxi|trajet|ligne » de gestion-keys.json
// (« from » pour le prix d'appel, sinon le lieu de la ligne de prix : « Phuket Town », « Donsak Pier »). `de` et `vers` : les deux bouts du trajet.
const DOSSIER_TAXI = "src/_data/products/taxi";
const routesTaxi = (lireJson(`${ref}:src/_data/taxiRoutes.json`) || { routes: [] }).routes || [];
const regroupes = (lireJson(`${ref}:${DOSSIER_TAXI}/southern-thailand.json`) || { routes: [] }).routes || [];
const tarifsTaxi = (id, lignes) =>
  lignes
    .map((ligne) => ({ ligne, cle: cles[`taxi|${id}|${ligne}`] }))
    .filter((x) => x.cle && x.cle.prestation)
    .map((x) => ({ ligne: x.ligne, prestation: x.cle.prestation, libelle: x.cle.gestion || "" }));
const pagesTaxi = routesTaxi.map(({ id }) => {
  const fiche = lireJson(`${ref}:${DOSSIER_TAXI}/${id}.json`);
  const r = fiche ? fiche.route || {} : regroupes.find((x) => x.id === id);
  if (!r) throw new Error(`Trajet taxi ${id} : ni fiche ni trajet regroupé sur le site (${ref}).`);
  const tarifs = tarifsTaxi(id, ["from", ...((fiche && fiche.pricePoints) || []).map((x) => x.label)]);
  return { id, nom: fiche ? fiche.name : `${r.from} to ${r.to}`, marque: "taxi", section: "taxi", url: fiche ? fiche.url : `/taxi/${id}/`, de: r.from, vers: r.to, options: [], ...(tarifs.length ? { tarifs } : {}) };
});
const excursion = lireJson(`${ref}:src/_data/krabiDayTrip.json`);
if (excursion) {
  // Même bouts que la demande du site (« Transfer request: Koh Lanta to Krabi – Day trip », taxiPages.js).
  const tarifs = tarifsTaxi(excursion.slug, ["from"]);
  pagesTaxi.push({ id: excursion.slug, nom: excursion.name, marque: "taxi", section: "taxi", url: excursion.url, de: "Koh Lanta", vers: "Krabi", journee: true, options: [], ...(tarifs.length ? { tarifs } : {}) });
}

const produits = fichiers.filter((f) => !f.startsWith(`${DOSSIER_TAXI}/`)).map((f) => {
  const p = JSON.parse(git("show", `${ref}:${f}`));
  const dossier = f.split("/").slice(-2, -1)[0];
  const marque = p.brand === "vip" ? "taxi" : "secret";
  const titres = (p.options || []).map((o) => o.label || o.title || o.id);
  // Un ancien titre porté aussi par une autre option de la page (aujourd'hui ou avant) ne dit pas laquelle : il n'est pas gardé.
  const porteurs = new Map();
  for (const o of p.options || []) for (const t of titresPasses.get(`${p.slug}|${o.id}`) || []) porteurs.set(t, (porteurs.get(t) || 0) + 1);
  return {
    id: p.slug,
    nom: p.name,
    marque,
    section: p.template === "rental" ? "rental" : SECTION[dossier] || "activities",
    url: p.url,
    ...(p.refPrefix ? { prefixe: p.refPrefix } : {}),
    options: (p.options || []).map((o) => {
      const titre = o.label || o.title || o.id;
      const tarifs = (o.prices || [])
        .map((r) => ({ ligne: r.label, cle: cles[`${p.slug}|${titre}|${r.label}`] }))
        .filter((x) => x.cle && x.cle.prestation)
        .map((x) => ({ ligne: x.ligne, prestation: x.cle.prestation, libelle: x.cle.gestion || "" }));
      // Option sans ligne de prix reliée : la clé d'option de Gestion. Une option qui a ses lignes garde celles du site.
      const cleOption = clesOptions[`${p.slug}|${o.id}`];
      if (cleOption) {
        clesOptionsLues.add(`${p.slug}|${o.id}`);
        if (tarifs.length) console.warn(`${p.slug}|${o.id} : l'option a des prix sur le site, la clé de cles-options-site.json est ignorée.`);
        else tarifs.push(...cleOption.map((x) => ({ ligne: x.ligne, prestation: x.prestation, libelle: x.libelle || "" })));
      }
      const anciens = [...(titresPasses.get(`${p.slug}|${o.id}`) || [])].filter((t) => t !== titre && !titres.includes(t) && porteurs.get(t) === 1).sort();
      return { id: o.id, titre, ...(tarifs.length ? { tarifs } : {}), ...(anciens.length ? { anciens } : {}) };
    }),
  };
});
produits.push(...pagesTaxi);
produits.sort((a, b) => a.marque.localeCompare(b.marque) || a.section.localeCompare(b.section) || a.nom.localeCompare(b.nom));
const commit = git("rev-parse", "--short", ref).trim();

const sortie = path.join(ICI, "../../src/gestion/js/site-produits.mjs");
const orphelines = Object.keys(clesOptions).filter((k) => !k.startsWith("_") && !clesOptionsLues.has(k));
for (const k of orphelines) console.warn(`${k} : aucune option de ce nom sur le site (${ref}), clé de cles-options-site.json non utilisée.`);
writeFileSync(
  sortie,
  `// Pages produit du site secrettravelandtour.com, recopiées par docs/gestion/regenerer-produits-site.mjs (${ref} ${commit}). Ne pas modifier à la main.
// marque : « secret » (Secret Travel & Tour) ou « taxi » (VIP Taxi Lanta, /taxi/). section : islands, activities, transfers, rental, taxi.
// options[].tarifs : chaque ligne de prix du site et le tarif de Gestion qui lui correspond (src/_data/gestion-keys.json du site), sans prix ni net.
// options[].anciens : les titres que l'option a portés avant sur le site.
// Pages taxi : de et vers (les deux bouts du trajet), tarifs au niveau de la page (« from » ou le lieu de la ligne de prix), journee pour l'excursion.
export const PRODUITS_SITE = [
${produits.map((p) => `  ${JSON.stringify(p)},`).join("\n")}
];
`
);
const n = produits.reduce((t, p) => t + (p.tarifs || []).length + p.options.reduce((u, o) => u + (o.tarifs || []).length, 0), 0);
for (const k of Object.keys(cles).filter((k) => k.startsWith("taxi|"))) {
  const [, id, ligne] = k.split("|");
  const page = pagesTaxi.find((p) => p.id === id);
  if (!page) console.warn(`${k} : aucune page taxi de ce nom sur le site (${ref}).`);
  else if (cles[k].prestation && !(page.tarifs || []).some((t) => t.ligne === ligne)) console.warn(`${k} : ligne de prix absente de la page.`);
}
console.log(`${produits.length} produits et ${n} lignes de prix reliées à Gestion écrits dans ${path.relative(process.cwd(), sortie)}`);
