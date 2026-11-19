// Ouverture rapide de Gestion (19.11.2026) : au build, le JS de l'outil est regroupé en quelques fichiers aux noms empreintés par leur contenu,
// au lieu de 80 modules découverts en cascade et revalidés un par un à chaque ouverture (une à deux minutes sur un téléphone en Thaïlande).
//   * gestion/b/app-<empreinte>.js et ses morceaux partagés : tout ce qu'il faut pour le premier écran ;
//   * gestion/b/<écran>-<empreinte>.js : les écrans chargés à la demande (import() dans le code) le restent ;
//   * gestion/b/app-<empreinte>.css, document-<empreinte>.css : les deux feuilles de style, contenu identique (b/ est voisin de css/,
//     leurs adresses relatives ../assets/… restent justes) ;
//   * gestion/index.html annonce ces fichiers ; gestion/sw.js reçoit leur liste pour les garder (deuxième ouverture sans réseau pour eux).
// Un nom empreinté ne change jamais de contenu : cache d'un an (netlify.toml). index.html, version.json et sw.js restent revalidés à chaque
// ouverture : une nouvelle version arrive toujours (règle « jamais une ancienne version »). Les sources restent publiées telles quelles
// (page hors connexion, contrôle de version de secours, prévisualisation locale sans build).
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DOSSIER = "b";
const empreinte = (contenu) => crypto.createHash("sha256").update(contenu).digest("hex").slice(0, 10);

async function regrouperGestion({ source, sortie }) {
  const esbuild = require("esbuild");
  const dossier = path.join(sortie, DOSSIER);
  fs.rmSync(dossier, { recursive: true, force: true });
  const resultat = await esbuild.build({
    entryPoints: [path.join(source, "js/app.mjs")],
    bundle: true,
    splitting: true,
    format: "esm",
    minify: true,
    outdir: dossier,
    entryNames: "[name]-[hash]",
    chunkNames: "[name]-[hash]",
    metafile: true,
    legalComments: "none",
    logLevel: "warning",
    // html2canvas (vendor/, recopiée telle quelle) a un « case » en double sans effet : on ne la modifie pas, l'avertissement est tu.
    logOverride: { "duplicate-case": "silent" },
    // Les licences des bibliothèques recopiées (vendor/) restent publiées à côté de leurs sources.
  });
  const sorties = resultat.metafile.outputs;
  const nom = (p) => path.relative(sortie, path.resolve(p)).split(path.sep).join("/");
  const entree = Object.keys(sorties).find((p) => sorties[p].entryPoint && /js\/app\.mjs$/.test(sorties[p].entryPoint));
  if (!entree) throw new Error("regrouper-gestion : point d'entrée app.mjs introuvable dans le résultat");
  // Les morceaux que le premier écran importe directement : annoncés d'avance (un seul aller-retour au lieu d'une cascade).
  const premiers = sorties[entree].imports.filter((i) => i.kind === "import-statement").map((i) => nom(i.path));

  // Feuilles de style : même contenu, nom empreinté.
  const css = {};
  for (const f of ["app.css", "document.css"]) {
    const contenu = fs.readFileSync(path.join(source, "css", f));
    const cible = `${DOSSIER}/${f.replace(/\.css$/, "")}-${empreinte(contenu)}.css`;
    fs.writeFileSync(path.join(sortie, cible), contenu);
    css[f] = cible;
  }

  // index.html : la feuille de style empreintée, le point d'entrée regroupé et ses morceaux annoncés.
  const fichierIndex = path.join(sortie, "index.html");
  let index = fs.readFileSync(fichierIndex, "utf8");
  index = index.replace(/^<!-- Les modules du premier écran[^\n]*\n/m, "").replace(/^<link rel="modulepreload" href="[^"]+">\n/gm, "");
  for (const [f, cible] of Object.entries(css)) index = index.replace(`href="css/${f}"`, `href="${cible}"`);
  const precharges = premiers.map((p) => `<link rel="modulepreload" href="${p}">\n`).join("");
  index = index.replace('<script type="module" src="js/app.mjs"></script>', `${precharges}<script type="module" src="${nom(entree)}"></script>`);
  if (!index.includes(nom(entree))) throw new Error("regrouper-gestion : balise du point d'entrée introuvable dans index.html");
  fs.writeFileSync(fichierIndex, index);

  // Service worker : la liste des fichiers empreintés à garder, et une version qui change avec eux (le navigateur installe alors le nouveau
  // service worker, qui garde les nouveaux fichiers et efface les anciens).
  const fichiers = fs.readdirSync(dossier).sort().map((f) => `${DOSSIER}/${f}`);
  const versionSw = empreinte(fichiers.join("\n"));
  const fichierSw = path.join(sortie, "sw.js");
  const sw = fs.readFileSync(fichierSw, "utf8");
  const marque = /const PRECHARGE = \[\];\nconst VERSION_APP = "source";/;
  if (!marque.test(sw)) throw new Error("regrouper-gestion : marque PRECHARGE / VERSION_APP introuvable dans sw.js");
  fs.writeFileSync(fichierSw, sw.replace(marque, `const PRECHARGE = ${JSON.stringify(fichiers)};\nconst VERSION_APP = "${versionSw}";`));
  return { entree: nom(entree), premiers, css: Object.values(css), fichiers, versionSw };
}

module.exports = { regrouperGestion, DOSSIER };
