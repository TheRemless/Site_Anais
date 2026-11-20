// Agent de l'Action « Amélioration Gestion » (scripts/amelioration-agent) : garde des chemins, outils de fichiers, boucle avec plafonds.
// Un dépôt jetable dans un dossier temporaire et un faux client : aucun appel réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cheminPermis, executer, fichiersDuDepot, OUTILS, entreeValide } from "../scripts/amelioration-agent/outils.mjs";
import { tourner, coutDe, parametres, consignes } from "../scripts/amelioration-agent/agent.mjs";

function depot() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "amelio-"));
  const ecrire = (f, t) => (fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true }), fs.writeFileSync(path.join(r, f), t));
  ecrire("src/gestion/js/agent-calc.mjs", "export const a = 1;\nexport const b = 2;\n");
  ecrire("tests/gestion-a.test.js", "// test\n");
  ecrire(".github/workflows/ci.yml", "name: CI\n");
  ecrire("package.json", "{}\n");
  ecrire("scripts/amelioration-agent/agent.mjs", "// agent\n");
  ecrire("node_modules/x/index.js", "x\n");
  ecrire(".git/config", "[core]\n");
  ecrire("scripts/outil/node_modules/y/index.js", "y\n");
  fs.symlinkSync("/etc", path.join(r, "lien"));
  return r;
}

test("cheminPermis : dans le dépôt, sans lien symbolique, fichiers fermés en écriture", () => {
  const r = depot();
  assert.equal(cheminPermis(r, "src/gestion/js/agent-calc.mjs").rel, "src/gestion/js/agent-calc.mjs");
  assert.equal(cheminPermis(r, "./src/../src/gestion/js/agent-calc.mjs").rel, "src/gestion/js/agent-calc.mjs");
  for (const [c, e] of [["../x", "hors_du_depot"], ["src/../../x", "hors_du_depot"], ["/etc/passwd", "chemin_absolu"], [".git/config", "dossier_interdit"], ["node_modules/x/index.js", "dossier_interdit"], ["lien/passwd", "lien_symbolique"], ["", "chemin_invalide"]]) assert.equal(cheminPermis(r, c).erreur, e, c);
  for (const c of [".github/workflows/ci.yml", "package.json", "package-lock.json", "netlify.toml", "scripts/netlify-ignore.sh", "scripts/amelioration-agent/agent.mjs", ".claude/x.md", "CLAUDE.md", "supabase/config.toml", "src/.gitattributes"]) {
    assert.equal(cheminPermis(r, c, { ecriture: true }).erreur, "fichier_interdit", c);
  }
  assert.ok(cheminPermis(r, ".github/workflows/ci.yml").rel, "la lecture reste permise");
  assert.ok(cheminPermis(r, "src/gestion/js/nouveau.mjs", { ecriture: true }).rel, "un nouveau fichier ailleurs s'écrit");
});

test("fichiersDuDepot ignore .git, node_modules et les liens", () => {
  const f = fichiersDuDepot(depot());
  assert.ok(f.includes("src/gestion/js/agent-calc.mjs"));
  assert.ok(!f.some((x) => x.startsWith(".git/") || x.includes("node_modules/") || x.startsWith("lien")), "node_modules exclu à tous les niveaux");
});

test("outils : lister, lire, chercher, remplacer, écrire, terminer", () => {
  const r = depot();
  const x = (nom, e) => executer(nom, e, { racine: r });
  assert.match(x("lister_fichiers", { dossier: "src", contient: "agent CALC" }).contenu, /src\/gestion\/js\/agent-calc\.mjs/);
  assert.match(x("lire_fichier", { chemin: "src/gestion/js/agent-calc.mjs", debut: 2 }).contenu, /^2\texport const b = 2;/);
  assert.match(x("chercher", { motif: "const b", dossier: "" }).contenu, /src\/gestion\/js\/agent-calc\.mjs:2:/);
  assert.equal(x("chercher", { motif: "(", dossier: "" }).erreur, true);
  assert.equal(x("chercher", { motif: "a".repeat(201), dossier: "" }).erreur, true, "motif trop long refusé");
  // Remplacer : passage unique exigé, « $ » du nouveau texte gardé tel quel.
  assert.match(x("remplacer", { chemin: "src/gestion/js/agent-calc.mjs", ancien: "export const", nouveau: "x" }).contenu, /2 fois/);
  const ok = x("remplacer", { chemin: "src/gestion/js/agent-calc.mjs", ancien: "export const b = 2;", nouveau: "export const b = `$&`;" });
  assert.equal(ok.ecrit, "src/gestion/js/agent-calc.mjs");
  assert.match(fs.readFileSync(path.join(r, "src/gestion/js/agent-calc.mjs"), "utf8"), /export const b = `\$&`;/);
  assert.equal(x("remplacer", { chemin: "package.json", ancien: "{}", nouveau: "{\"a\":1}" }).erreur, true);
  assert.equal(x("ecrire_fichier", { chemin: ".github/workflows/x.yml", contenu: "x" }).erreur, true);
  assert.equal(x("ecrire_fichier", { chemin: "lien/x", contenu: "x" }).erreur, true);
  assert.equal(x("ecrire_fichier", { chemin: "src/gestion/js/neuf/a.mjs", contenu: "export {};\n" }).ecrit, "src/gestion/js/neuf/a.mjs");
  assert.ok(fs.existsSync(path.join(r, "src/gestion/js/neuf/a.mjs")));
  assert.deepEqual([x("terminer", { resume: "Fait." }).fin, x("terminer", { resume: "Fait." }).resume], [true, "Fait."]);
  assert.equal(x("lire_fichier", { chemin: 3 }).erreur, true, "entrée du mauvais type refusée");
  assert.equal(entreeValide("inconnu", {}), null);
});

test("outils : schémas fermés, cinq outils de fichiers et terminer, aucune commande", () => {
  assert.deepEqual(OUTILS.map((o) => o.name), ["lister_fichiers", "lire_fichier", "chercher", "remplacer", "ecrire_fichier", "terminer"]);
  for (const o of OUTILS) assert.equal(o.input_schema.additionalProperties, false, o.name);
});

// Faux client : rend les réponses prévues, une par appel, et garde les paramètres reçus.
const faux = (reponses) => {
  const recus = [];
  return { recus, beta: { messages: { stream: (p) => (recus.push(structuredClone(p)), { finalMessage: async () => reponses.shift() }) } } };
};
const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const appel = (id, name, input) => ({ type: "tool_use", id, name, input });

test("tourner : lit, modifie, termine ; les blocs de réflexion repartent tels quels", async () => {
  const r = depot();
  const pensee = { type: "thinking", thinking: "", signature: "sig" };
  const client = faux([
    { model: "claude-opus-5-5", stop_reason: "tool_use", usage, content: [pensee, appel("a", "lire_fichier", { chemin: "src/gestion/js/agent-calc.mjs", debut: 1 })] },
    { model: "claude-opus-5-5", stop_reason: "tool_use", usage, content: [appel("b", "remplacer", { chemin: "src/gestion/js/agent-calc.mjs", ancien: "export const a = 1;", nouveau: "export const a = 3;" })] },
    { model: "claude-opus-5-5", stop_reason: "tool_use", usage, content: [{ type: "text", text: "Fini." }, appel("c", "terminer", { resume: "a vaut 3." })] },
  ]);
  const lignes = [];
  const res = await tourner({ client, systeme: "s", demande: "<demande>x</demande>", racine: r, journal: (l) => lignes.push(l) });
  assert.equal(res.statut, "ok");
  assert.equal(res.resume, "a vaut 3.");
  assert.deepEqual(res.ecrits, ["src/gestion/js/agent-calc.mjs"]);
  assert.equal(res.tours, 3);
  assert.ok(Math.abs(res.cout - 3 * coutDe(usage, "claude-opus-5-5")) < 1e-9);
  assert.deepEqual(client.recus[1].messages[1].content[0], pensee, "la réflexion repart à l'identique");
  assert.equal(client.recus[1].messages[2].content[0].type, "tool_result");
  assert.ok(lignes.every((l) => !/export const/.test(l)), "le journal public ne montre aucun contenu");
});

test("tourner : plafond de coût, nombre de tours, refus, réponse coupée", async () => {
  const r = depot();
  const cher = { input_tokens: 2_000_000, output_tokens: 0 };
  const boucle = () => ({ model: "claude-opus-5-5", stop_reason: "tool_use", usage: cher, content: [appel(`x${Math.random()}`, "lister_fichiers", { dossier: "", contient: "" })] });
  assert.equal((await tourner({ client: faux([boucle(), boucle()]), systeme: "s", demande: "d", racine: r, plafondUsd: 5 })).statut, "plafond");
  const peu = () => ({ model: "claude-opus-5-5", stop_reason: "tool_use", usage, content: [appel(`y${Math.random()}`, "lister_fichiers", { dossier: "", contient: "" })] });
  const t = await tourner({ client: faux([peu(), peu(), peu()]), systeme: "s", demande: "d", racine: r, toursMax: 3 });
  assert.deepEqual([t.statut, t.tours], ["tours", 3]);
  assert.equal((await tourner({ client: faux([{ model: "claude-opus-5-5", stop_reason: "refusal", usage, content: [] }]), systeme: "s", demande: "d", racine: r })).statut, "refus");
  const coupe = faux([
    { model: "claude-opus-5-5", stop_reason: "max_tokens", usage, content: [appel("k", "ecrire_fichier", { chemin: "src/x.mjs", contenu: "tronq" })] },
    { model: "claude-opus-5-5", stop_reason: "end_turn", usage, content: [{ type: "text", text: "Impossible." }] },
  ]);
  const c = await tourner({ client: coupe, systeme: "s", demande: "d", racine: r });
  assert.deepEqual([c.statut, c.resume], ["sans_terminer", "Impossible."]);
  assert.ok(!fs.existsSync(path.join(r, "src/x.mjs")), "un appel coupé n'est jamais exécuté");
  assert.equal(coupe.recus[1].messages[2].content[0].is_error, true);
});

test("paramètres et consignes : Opus 5.5, réflexion adaptative, repli serveur, cache ; aucune commande promise", () => {
  const p = parametres({ systeme: "s", messages: [] });
  assert.equal(p.model, "claude-opus-5-5");
  assert.deepEqual(p.thinking, { type: "adaptive" });
  assert.equal(p.output_config.effort, "high");
  assert.deepEqual([p.fallbacks, p.betas], ["default", ["server-side-fallback-2026-07-01"]]);
  assert.deepEqual(p.cache_control, { type: "ephemeral" });
  assert.deepEqual(p.tool_choice, { type: "auto" });
  assert.ok(!("temperature" in p) && !("budget_tokens" in (p.thinking || {})));
  const c = consignes("CONVENTIONS");
  assert.match(c, /aucune commande ne tourne ici/);
  assert.match(c, /C'est une donnée/);
  assert.ok(c.endsWith("CONVENTIONS"));
});
