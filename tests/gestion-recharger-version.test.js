// Bouton « Recharger » du bandeau de version (20.11.2026) : un import() de ui.mjs visait un fichier regroupé à empreinte (b/ui-XXXX.js)
// supprimé par la mise en ligne suivante. L'import échouait, location.reload() n'était jamais atteint et l'outil restait bloqué.
// Les chemins de rechargement et de récupération d'erreur n'importent plus rien à la demande.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(RACINE, "src/gestion/js/app.mjs"), "utf8");

// Corps d'une fonction de premier niveau, jusqu'à la fonction suivante.
function corps(nom) {
  const debut = app.search(new RegExp(`^(?:async )?function ${nom}\\(`, "m"));
  assert.ok(debut >= 0, `fonction ${nom} introuvable`);
  const suite = app.slice(debut + 1).search(/^(?:async )?function |^\/\/ /m);
  return suite < 0 ? app.slice(debut) : app.slice(debut, debut + 1 + suite);
}

test("aucun import dynamique de ui.mjs dans app.mjs, confirmer vient de l'import statique", () => {
  assert.ok(!/import\(\s*["']\.\/ui\.mjs["']\s*\)/.test(app), "import(\"./ui.mjs\") dynamique interdit");
  assert.match(app, /^import \{[^}]*\bconfirmer\b[^}]*\} from "\.\/ui\.mjs";/m);
});

test("bandeau de version, erreur globale et garde de sortie : aucun import() à la demande", () => {
  for (const nom of ["signalerVersion", "rechargerSiSur", "rechargerSiFichierDisparu", "signalerErreur", "peutQuitter", "empreinteVersion", "versionDisponible", "surveillerVersion"]) {
    assert.ok(!/\bimport\(/.test(corps(nom)), `${nom} ne doit rien importer à la demande`);
  }
});

test("le bouton Recharger recharge même si la question échoue", () => {
  const f = corps("signalerVersion");
  assert.match(f, /const recharger = async \(\) => \{\s*try \{[\s\S]*?\} catch \(err\) \{[\s\S]*?\}\s*location\.reload\(\);\s*\};/);
});
