// Images de démarrage iOS de l'outil de gestion (audit mobile n° 20, 26.11.2026).
// Lancée depuis l'écran d'accueil, l'app montre l'écran de lancement d'iOS avant même de lire la page : sans image
// apple-touch-startup-image, c'est 1 à 2 s de blanc pur. Ce script dessine, pour chaque taille d'écran de la liste,
// le fond de l'app (#f5f8f8, --fond de css/app.css et background_color du manifeste) avec l'icône Zwald au centre,
// écrit les PNG dans src/gestion/assets/demarrage/ et remplace les balises entre les deux repères de src/gestion/index.html.
// Pas de version sombre : l'app est en thème clair seulement (<meta name="color-scheme" content="light">).
//
// Relancer après avoir complété la liste ECRANS :  node scripts/gestion-images-demarrage.mjs
// Playwright n'est pas une dépendance du dépôt : le script le cherche dans PLAYWRIGHT_DIR (dossier node_modules), sinon dans le cache npx.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gestion = path.join(racine, "src/gestion");
const sortie = path.join(gestion, "assets/demarrage");
const FOND = "#f5f8f8";
const ICONE = path.join(gestion, "assets/zwald-512.png");
const COTE_ICONE = 140; // en points, comme une grande icône d'app au centre de l'écran
const DEBUT = "<!-- images de démarrage iOS : début (généré par scripts/gestion-images-demarrage.mjs, ne pas modifier à la main) -->";
const FIN = "<!-- images de démarrage iOS : fin -->";

// Tailles d'écran en points (portrait) et ratio de pixels. iOS choisit l'image dont la requête média correspond exactement :
// un appareil absent de la liste retombe sur le blanc. Pour en ajouter un, une ligne suffit.
export const ECRANS = [
  { nom: "iphone-se-8", appareils: "iPhone SE (2e et 3e gén.), 8, 7, 6s", l: 375, h: 667, r: 2 },
  { nom: "iphone-8-plus", appareils: "iPhone 8 Plus, 7 Plus, 6s Plus", l: 414, h: 736, r: 3 },
  { nom: "iphone-mini", appareils: "iPhone 12 mini, 13 mini, X, XS, 11 Pro", l: 375, h: 812, r: 3 },
  { nom: "iphone-xr-11", appareils: "iPhone XR, 11", l: 414, h: 896, r: 2 },
  { nom: "iphone-xs-max", appareils: "iPhone XS Max, 11 Pro Max", l: 414, h: 896, r: 3 },
  { nom: "iphone-390", appareils: "iPhone 12, 12 Pro, 13, 13 Pro, 14, 16e, 17e", l: 390, h: 844, r: 3 },
  { nom: "iphone-428", appareils: "iPhone 12 Pro Max, 13 Pro Max, 14 Plus", l: 428, h: 926, r: 3 },
  { nom: "iphone-393", appareils: "iPhone 14 Pro, 15, 15 Pro, 16", l: 393, h: 852, r: 3 },
  { nom: "iphone-430", appareils: "iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus", l: 430, h: 932, r: 3 },
  { nom: "iphone-402", appareils: "iPhone 16 Pro, 17, 17 Pro", l: 402, h: 874, r: 3 },
  { nom: "iphone-440", appareils: "iPhone 16 Pro Max, 17 Pro Max", l: 440, h: 956, r: 3 },
  { nom: "iphone-air", appareils: "iPhone Air", l: 420, h: 912, r: 3 },
  { nom: "ipad-mini", appareils: "iPad mini (6e et 7e gén.)", l: 744, h: 1133, r: 2 },
  { nom: "ipad-102", appareils: "iPad 10,2 pouces (7e à 9e gén.)", l: 810, h: 1080, r: 2 },
  { nom: "ipad-109", appareils: "iPad (10e et 11e gén.), iPad Air 10,9 et 11 pouces", l: 820, h: 1180, r: 2 },
  { nom: "ipad-pro-11", appareils: "iPad Pro 11 pouces (1re à 4e gén.)", l: 834, h: 1194, r: 2 },
  { nom: "ipad-pro-11-m4", appareils: "iPad Pro 11 pouces (M4 et suivants)", l: 834, h: 1210, r: 2 },
  { nom: "ipad-129", appareils: "iPad Pro 12,9 pouces, iPad Air 13 pouces", l: 1024, h: 1366, r: 2 },
  { nom: "ipad-pro-13", appareils: "iPad Pro 13 pouces (M4 et suivants)", l: 1032, h: 1376, r: 2 },
];

export function variantes() {
  return ECRANS.flatMap((e) => ["portrait", "landscape"].map((orientation) => ({
    ...e,
    orientation,
    fichier: `${e.nom}-${orientation === "portrait" ? "portrait" : "paysage"}.png`,
    largeurPx: (orientation === "portrait" ? e.l : e.h) * e.r,
    hauteurPx: (orientation === "portrait" ? e.h : e.l) * e.r,
  })));
}

function balises() {
  return variantes().map((v) =>
    `<link rel="apple-touch-startup-image" media="(device-width: ${v.l}px) and (device-height: ${v.h}px) and (-webkit-device-pixel-ratio: ${v.r}) and (orientation: ${v.orientation})" href="assets/demarrage/${v.fichier}">`
  ).join("\n");
}

function chargerPlaywright() {
  const dossiers = [process.env.PLAYWRIGHT_DIR, path.join(racine, "node_modules")];
  const npx = path.join(os.homedir(), ".npm/_npx");
  if (fs.existsSync(npx)) for (const d of fs.readdirSync(npx)) dossiers.push(path.join(npx, d, "node_modules"));
  for (const d of dossiers.filter(Boolean)) {
    if (fs.existsSync(path.join(d, "playwright"))) return createRequire(path.join(d, "/"))("playwright");
  }
  throw new Error("Playwright introuvable : npx playwright install chromium, ou PLAYWRIGHT_DIR=<dossier node_modules>");
}

async function generer() {
  const { chromium } = chargerPlaywright();
  const executable = process.env.CHROMIUM_PATH || undefined;
  const navigateur = await chromium.launch(executable ? { executablePath: executable } : {});
  const icone = `data:image/png;base64,${fs.readFileSync(ICONE).toString("base64")}`;
  // Coins arrondis à 22,5 % comme une icône d'app iOS, ombre très légère pour détacher le carré sarcelle du fond clair.
  const page = (l, h) => `<!doctype html><html><head><style>
    html,body{margin:0;width:${l}px;height:${h}px;background:${FOND};overflow:hidden}
    body{display:flex;align-items:center;justify-content:center}
    img{width:${COTE_ICONE}px;height:${COTE_ICONE}px;border-radius:22.5%;box-shadow:0 2px 10px rgba(10,60,64,.12)}
  </style></head><body><img src="${icone}" alt=""></body></html>`;
  fs.rmSync(sortie, { recursive: true, force: true });
  fs.mkdirSync(sortie, { recursive: true });
  let total = 0;
  for (const v of variantes()) {
    const l = v.largeurPx / v.r, h = v.hauteurPx / v.r;
    const ctx = await navigateur.newContext({ viewport: { width: l, height: h }, deviceScaleFactor: v.r });
    const onglet = await ctx.newPage();
    await onglet.setContent(page(l, h));
    await onglet.locator("img").evaluate((img) => img.decode());
    const brut = await onglet.screenshot({ type: "png" });
    await ctx.close();
    // Aplat et une icône : une palette de 64 couleurs suffit et divise le poids par dix.
    const png = await sharp(brut).png({ palette: true, colours: 64, compressionLevel: 9, effort: 10 }).toBuffer();
    const { width, height } = await sharp(png).metadata();
    if (width !== v.largeurPx || height !== v.hauteurPx) throw new Error(`${v.fichier} : ${width}×${height} au lieu de ${v.largeurPx}×${v.hauteurPx}`);
    fs.writeFileSync(path.join(sortie, v.fichier), png);
    total += png.length;
    console.log(`${v.fichier.padEnd(30)} ${width}×${height}  ${(png.length / 1024).toFixed(1)} Ko`);
  }
  await navigateur.close();
  console.log(`${variantes().length} images, ${(total / 1024).toFixed(0)} Ko en tout`);
}

function ecrireBalises() {
  const fichier = path.join(gestion, "index.html");
  const html = fs.readFileSync(fichier, "utf8");
  const bloc = `${DEBUT}\n${balises()}\n${FIN}`;
  const i = html.indexOf(DEBUT), j = html.indexOf(FIN);
  let nouveau;
  if (i !== -1 && j !== -1) nouveau = html.slice(0, i) + bloc + html.slice(j + FIN.length);
  else {
    // Première fois : juste après l'icône d'écran d'accueil, avec qui elles vont.
    const ancre = /<link rel="apple-touch-icon"[^>]*>\n/.exec(html);
    if (!ancre) throw new Error("balise apple-touch-icon introuvable dans index.html");
    nouveau = html.slice(0, ancre.index + ancre[0].length) + bloc + "\n" + html.slice(ancre.index + ancre[0].length);
  }
  fs.writeFileSync(fichier, nouveau);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generer();
  ecrireBalises();
}
