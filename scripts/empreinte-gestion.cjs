// Empreinte de version de l'outil de gestion (18.11.2026, revue le 19.11.2026) : le contenu de tous les fichiers de src/gestion, et rien
// d'autre (ni date, ni variable du build, ni fichier caché comme .DS_Store). Écrite dans gestion/version.json par .eleventy.js ; un onglet ouvert
// la compare à la sienne. Elle ne change donc que si un fichier servi sous /gestion/ change de contenu.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function empreinteGestion(racine) {
  const fichiers = [];
  const parcourir = (d) => {
    for (const n of fs.readdirSync(d, { withFileTypes: true })) {
      if (n.name.startsWith(".")) continue;
      const p = path.join(d, n.name);
      if (n.isDirectory()) parcourir(p);
      else fichiers.push(p);
    }
  };
  parcourir(racine);
  const h = crypto.createHash("sha256");
  for (const f of fichiers.sort()) h.update(path.relative(racine, f)).update("\0").update(fs.readFileSync(f));
  return { version: h.digest("hex").slice(0, 16), fichiers };
}

module.exports = { empreinteGestion };
