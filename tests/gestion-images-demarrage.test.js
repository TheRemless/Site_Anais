import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Images de démarrage iOS (audit mobile n° 20) : iOS prend l'image dont la requête média décrit exactement l'écran,
// en pixels physiques. Une balise qui pointe vers un fichier absent ou mal dimensionné rend le blanc pur qu'on voulait éviter.
const dossier = path.resolve("src/gestion");
const index = fs.readFileSync(path.join(dossier, "index.html"), "utf8");
const balises = [...index.matchAll(/<link rel="apple-touch-startup-image" media="\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\) and \(orientation: (portrait|landscape)\)" href="(assets\/demarrage\/[\w.-]+\.png)">/g)];

const tailleDe = (fichier) => {
  const b = fs.readFileSync(fichier);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

test("démarrage iOS : chaque balise pointe vers un PNG aux dimensions de l'écran, dans l'orientation annoncée", () => {
  assert.equal(balises.length, (index.match(/apple-touch-startup-image/g) || []).length, "toutes les balises ont la forme attendue");
  assert.ok(balises.length >= 30, `${balises.length} balises`);
  for (const [, l, h, r, orientation, href] of balises) {
    const fichier = path.join(dossier, href);
    assert.ok(fs.existsSync(fichier), href);
    const attendu = orientation === "portrait" ? [l * r, h * r] : [h * r, l * r];
    assert.deepEqual(tailleDe(fichier), attendu, href);
  }
});

test("démarrage iOS : un portrait et un paysage par écran, sans doublon, entre les repères du script", () => {
  const cles = balises.map(([, l, h, r, o]) => `${l}x${h}@${r} ${o}`);
  assert.equal(new Set(cles).size, cles.length, "pas deux balises pour le même écran");
  for (const c of cles.filter((c) => c.endsWith("portrait"))) assert.ok(cles.includes(c.replace("portrait", "landscape")), c);
  const debut = index.indexOf("images de démarrage iOS : début"), fin = index.indexOf("images de démarrage iOS : fin");
  assert.ok(debut > 0 && fin > debut);
  for (const b of balises) assert.ok(b.index > debut && b.index < fin);
});

test("démarrage iOS : aucune image orpheline, poids total sous 1,5 Mo", () => {
  const liees = new Set(balises.map((b) => path.basename(b[5])));
  const fichiers = fs.readdirSync(path.join(dossier, "assets/demarrage"));
  for (const f of fichiers) assert.ok(liees.has(f), `${f} n'est lié par aucune balise`);
  const total = fichiers.reduce((s, f) => s + fs.statSync(path.join(dossier, "assets/demarrage", f)).size, 0);
  assert.ok(total < 1.5 * 1024 * 1024, `${total} octets`);
});

test("démarrage iOS : le site construit publie les images", { skip: !fs.existsSync("_site/gestion/index.html") }, () => {
  for (const b of balises) assert.ok(fs.existsSync(path.join("_site/gestion", b[5])), b[5]);
});
