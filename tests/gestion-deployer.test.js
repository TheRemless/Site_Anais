// scripts/deployer-gestion.sh (audit dev B1 et I26 du 20.11.2026) : ce que chaque fonction embarque, et les garde-fous du script.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importsRelatifs, dependances, fonctions } from "../scripts/deployer-gestion-dependances.mjs";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("imports relatifs : from, import dynamique, import de bord, jamais jsr: ni npm:", () => {
  const src = `import { a } from "./a.js";\nimport {\n  b,\n} from "../agent/b.js";\nexport { c } from './c.js';\nimport "./bord.js";\nconst d = await import("./d.js");\nimport { createClient } from "jsr:@supabase/supabase-js@2";\nimport Anthropic from "npm:@anthropic-ai/sdk@1.3.0";`;
  assert.deepEqual(importsRelatifs(src), ["./a.js", "../agent/b.js", "./c.js", "./bord.js", "./d.js"]);
});

test("dépendances réelles : whatsapp-envoi et whatsapp-preparer embarquent l'agent (le cas B1)", () => {
  const liste = fonctions(RACINE);
  for (const f of ["agent", "whatsapp", "whatsapp-envoi", "whatsapp-preparer", "rappels"]) assert.ok(liste.includes(f), f);
  const envoi = dependances(RACINE, "whatsapp-envoi");
  assert.ok(envoi.includes("supabase/functions/whatsapp-envoi/index.ts"));
  assert.ok(envoi.includes("supabase/functions/agent/outils.js"), "l'agent entre dans whatsapp-envoi");
  assert.ok(envoi.includes("supabase/functions/whatsapp/proposer.js"));
  const preparer = dependances(RACINE, "whatsapp-preparer");
  assert.ok(preparer.includes("supabase/functions/whatsapp/reponse.ts") && preparer.some((f) => f.startsWith("supabase/functions/agent/")));
  assert.ok(dependances(RACINE, "whatsapp").includes("supabase/functions/whatsapp/fiabilite.js"));
  assert.ok(!dependances(RACINE, "invitation").some((f) => f.includes("/agent/")), "une fonction sans l'agent ne le compte pas");
});

test("script : refuse hors d'origin/master à jour, journal du commit, aucun secret", () => {
  const sh = fs.readFileSync(path.join(RACINE, "scripts/deployer-gestion.sh"), "utf8");
  assert.match(sh, /^set -euo pipefail$/m);
  assert.match(sh, /git fetch --quiet origin master/);
  assert.match(sh, /\[ "\$TETE" = "\$MASTER" \] \|\| arreter/);
  assert.match(sh, /git status --porcelain --untracked-files=no/);
  assert.match(sh, /git diff --name-only "\$dernier" "\$TETE" -- \$fichiers supabase\/config\.toml/);
  assert.match(sh, /functions deploy "\$f" --remote="\$PROJET" --use-api --yes/);
  assert.match(sh, /printf '%s\\t%s\\t%s\\t%s\\n' "\$\(date -u \+%Y-%m-%dT%H:%M:%SZ\)" "\$f" "\$TETE"/, "chaque réussite notée avec son commit");
  assert.doesNotMatch(sh, /secrets set|SERVICE_ROLE|TELNYX_|ANTHROPIC_API_KEY/, "aucun secret posé ni lu");
  assert.ok(fs.existsSync(path.join(RACINE, "docs/gestion/deployer-gestion.md")), "documenté");
});
