// Liste PRIVÉE des noms de prestataires à ne jamais publier : jamais écrite dans le dépôt (il est public).
// Fichier `noms-partenaires-samui.txt` (un nom par ligne, insensible à la casse) dans le dossier de la variable d'environnement
// GESTION_SQL_PRIVE, sinon dans /Users/admin/Desktop/Site_Anais-import/. Absent : les contrôles qui s'en servent sautent avec un message.
const fs = require("node:fs");
const path = require("node:path");

const FICHIER = "noms-partenaires-samui.txt";
const dossiers = () => [process.env.GESTION_SQL_PRIVE, "/Users/admin/Desktop/Site_Anais-import"].filter(Boolean);

function noms() {
  for (const d of dossiers()) {
    try {
      const liste = fs.readFileSync(path.join(d, FICHIER), "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (liste.length) return liste;
    } catch (e) { /* dossier ou fichier absent : on essaie le suivant */ }
  }
  return null;
}

// Un motif par nom : espaces et tirets interchangeables, casse ignorée.
function motifs() {
  const liste = noms();
  if (!liste) return null;
  return liste.map((n) => new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s-]+/g, "[\\s\\-_]?"), "i"));
}

module.exports = { noms, motifs, message: `liste privée absente (${FICHIER} dans GESTION_SQL_PRIVE ou Site_Anais-import) : contrôle des noms sauté` };
