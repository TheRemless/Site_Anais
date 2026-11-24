// tests/gestion-brochure-parametres.test.js : les paramètres de l'appel et les deux schémas de l'import de brochure, contrôlés contre les limites
// documentées de l'API (24.11.2026, après le 400 en 370 ms du premier essai réel de la PR 346). Sources : doc « Structured outputs »
// (limites de complexité : 24 paramètres optionnels, 16 paramètres à type union par requête, grammaire interne « Schema is too complex for
// compilation »), mots-clés pris en charge, Opus 5.5 (réflexion toujours adaptative, effort low à max, 128 000 jetons de sortie en flux),
// repli côté serveur (bêta server-side-fallback-2026-07-01, fallbacks « default »).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parametresBrochure, promptBrochure, promptRelecture, SCHEMA_BROCHURE, SCHEMA_RELECTURE, validerBrochure, gabaritJson, extraireJson, lireBrochure, demandeCorrection, fusionnerRelecture } from "../supabase/functions/assistant/brochure.js";
import { BETA_REPLI, ligneJournal, detailErreurApi } from "../supabase/functions/assistant/calc.js";
import { brochureDemoTransport } from "../src/gestion/js/brochure-demo.mjs";

// Ce que la doc accepte dans un schéma de sortie structurée.
const MOTS_ACCEPTES = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "const", "anyOf", "allOf", "$ref", "$defs", "definitions", "description", "format", "title"]);
const FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);
// Marge sous les limites : la limite interne de grammaire n'est pas chiffrée, on reste loin des limites qui le sont.
// Propriétés : la version qui passait avant la PR 346 en avait 51 ; la relecture de la 346 en avait 141 (refusée). Plafond par schéma.
const LIMITES = { union: 0, optionnels: 0, proprietes: { lecture: 80, relecture: 90 }, profondeur: 6 };

function mesurer(schema) {
  const m = { union: 0, optionnels: 0, proprietes: 0, profondeur: 0, fautes: [] };
  const visiter = (s, chemin, d) => {
    m.profondeur = Math.max(m.profondeur, d);
    for (const k of Object.keys(s)) if (!MOTS_ACCEPTES.has(k)) m.fautes.push(`${chemin} : mot-clé « ${k} » non pris en charge`);
    if (s.format && !FORMATS.has(s.format)) m.fautes.push(`${chemin} : format « ${s.format} »`);
    if (s.anyOf || Array.isArray(s.type)) m.union++;
    if (s.anyOf && (s.type || s.properties)) m.fautes.push(`${chemin} : anyOf avec type ou properties`);
    if (s.type === "object") {
      if (s.additionalProperties !== false) m.fautes.push(`${chemin} : additionalProperties doit valoir false`);
      const p = s.properties || {};
      if (!Object.keys(p).length) m.fautes.push(`${chemin} : objet sans propriétés`);
      m.proprietes += Object.keys(p).length;
      const requis = s.required || [];
      m.optionnels += Object.keys(p).filter((k) => !requis.includes(k)).length;
      for (const r of requis) if (!(r in p)) m.fautes.push(`${chemin} : « ${r} » requis mais absent`);
      for (const [k, v] of Object.entries(p)) visiter(v, `${chemin}.${k}`, d + 1);
    }
    if (s.type === "array") {
      if (!s.items) m.fautes.push(`${chemin} : tableau sans items`);
      else visiter(s.items, `${chemin}[]`, d + 1);
    }
    for (const x of s.anyOf || []) visiter(x, `${chemin}|`, d + 1);
  };
  visiter(schema, "$", 0);
  return m;
}

for (const [nom, schema] of [["lecture", SCHEMA_BROCHURE], ["relecture", SCHEMA_RELECTURE]]) {
  test(`schéma de ${nom} : seulement des mots-clés pris en charge, tout requis, aucun type union, loin des limites de complexité`, () => {
    const m = mesurer(schema);
    assert.deepEqual(m.fautes, []);
    assert.ok(m.union <= LIMITES.union, `${m.union} paramètres à type union (limite de l'API : 16)`);
    assert.ok(m.optionnels <= LIMITES.optionnels, `${m.optionnels} paramètres optionnels (limite de l'API : 24)`);
    assert.ok(m.proprietes <= LIMITES.proprietes[nom], `${m.proprietes} propriétés (plafond ${LIMITES.proprietes[nom]})`);
    assert.ok(m.profondeur <= LIMITES.profondeur, `profondeur ${m.profondeur}`);
    // Pas de récursion : le schéma se sérialise (une référence circulaire lèverait).
    assert.doesNotThrow(() => JSON.stringify(schema));
  });
}

test("les deux passes ensemble restent sous les limites par requête (chaque passe est une requête à part)", () => {
  for (const schema of [SCHEMA_BROCHURE, SCHEMA_RELECTURE]) {
    const m = mesurer(schema);
    assert.ok(m.union <= 16 && m.optionnels <= 24);
  }
});

test("paramètres : Opus 5.5, pas de thinking ni d'échantillonnage, effort accepté, aucun format ni outil, gabarit JSON dans la consigne, flux sous 128 000, repli bêta", () => {
  const f = [{ media_type: "image/jpeg", data: "/9j/AAAA" }];
  const brochure = validerBrochure(brochureDemoTransport()).brochure;
  for (const [passe, p] of [["lecture", parametresBrochure(promptBrochure({ fichiers: f, aujourdhui: "2026-11-24" }))], ["relecture", parametresBrochure(promptRelecture({ fichiers: f, aujourdhui: "2026-11-24", brochure }), { passe: "relecture" })]]) {
    assert.equal(p.model, "claude-opus-5-5", passe);
    // Opus 5.5 : « disabled » et budget_tokens refusés (400), l'omettre vaut « adaptive ».
    assert.ok(!("thinking" in p), passe);
    for (const interdit of ["temperature", "top_p", "top_k", "tool_choice", "tools", "output_format"]) assert.ok(!(interdit in p), `${passe} : ${interdit}`);
    assert.ok(["low", "medium", "high", "xhigh", "max"].includes(p.output_config.effort), passe);
    // Plus de sortie structurée pour la brochure : « The compiled grammar is too large » (essai réel du 24.11.2026, après la PR 349).
    assert.deepEqual(Object.keys(p.output_config), ["effort"], passe);
    assert.ok(!("output_format" in p) && !("tools" in p), passe);
    // Le gabarit JSON est dans la consigne de la passe, tiré du schéma de la passe.
    const texte = p.messages[0].content.at(-1).text;
    assert.ok(texte.includes(gabaritJson(passe === "lecture" ? SCHEMA_BROCHURE : SCHEMA_RELECTURE)), passe);
    assert.match(texte, /un seul objet JSON, sans texte avant ni après/);
    assert.ok(p.max_tokens > 0 && p.max_tokens <= 128000, passe);
    assert.deepEqual(p.betas, [BETA_REPLI]);
    assert.equal(BETA_REPLI, "server-side-fallback-2026-07-01", "la forme « default » demande la bêta du 01.07.2026");
    assert.equal(p.fallbacks, "default");
    // Pas de préremplissage (refusé avec les sorties structurées) : le dernier message est celui de la personne.
    assert.equal(p.messages.at(-1).role, "user");
    assert.ok(!JSON.stringify(p.messages).includes('"citations"'));
  }
  // L'appel part en flux (64 000 jetons ne passent pas en un seul bloc).
  const index = readFileSync(new URL("../supabase/functions/assistant/index.ts", import.meta.url), "utf8");
  assert.match(index, /flux = anthropic\.beta\.messages\.stream\(parametres as unknown as [^,]+, \{ signal: arret\.signal \}\)/);
  assert.match(index, /setTimeout\(\(\) => arret\.abort\(\), delaiBrochure\)/);
});

test("un nombre absent rendu à 0 par Claude reste « vide » dans l'outil (prix, net)", () => {
  const t = { ...brochureDemoTransport().trajets[1], prix_texte: "", prix_adulte: 0, net_texte: "", net_adulte: 0, prix_enfant: 0, net_enfant: 0 };
  const r = validerBrochure({ tarifs: [], trajets: [t] }).brochure.trajets[0];
  assert.deepEqual([r.prix_adulte, r.prix_enfant, r.net_adulte, r.net_enfant, r.lisible], [null, null, null, null, false]);
});

test("erreur de l'API lisible : statut, type, message, requête ; jamais une clé ; le journal note le modèle appelé", () => {
  const err = Object.assign(new Error("400 {...}"), { status: 400, requestID: "req_011demo", error: { type: "error", error: { type: "invalid_request_error", message: "Schema is too complex for compilation." } } });
  assert.deepEqual(detailErreurApi(err), { statut: 400, type: "invalid_request_error", message: "Schema is too complex for compilation.", requete: "req_011demo" });
  const fuite = Object.assign(new Error("x"), { status: 401, error: { error: { type: "authentication_error", message: "invalid x-api-key sk-ant-api03-ABCdef_123" } } });
  assert.ok(!JSON.stringify(detailErreurApi(fuite)).includes("sk-ant-api03"));
  assert.equal(detailErreurApi(null), null);
  const ligne = ligneJournal({ userId: "u", entiteId: "e", usage: "brochure", statut: "erreur_api_400", message: null, modeleDemande: "claude-opus-5-5", dureeMs: 370 });
  assert.equal(ligne.modele, "claude-opus-5-5", "plus « claude-haiku-5-5 » pour un échec d'Opus");
  assert.equal(ligneJournal({ userId: "u", entiteId: "e", usage: "lire", statut: "erreur", message: null, dureeMs: 1 }).modele, "claude-haiku-5-5", "les autres usages ne changent pas");
  const index = readFileSync(new URL("../supabase/functions/assistant/index.ts", import.meta.url), "utf8");
  assert.match(index, /detail_api: detail/);
  assert.match(index, /modeleDemande: String\(/);
  const ecran = readFileSync(new URL("../src/gestion/js/views/brochure.mjs", import.meta.url), "utf8");
  assert.match(ecran, /erreurLecture\(r && r\.erreur\) \+ detailApi\(r\)/);
});

test("relecture : chaque genre de ligne n'apparaît qu'une fois dans le schéma (plus de listes « corrigés » et « oubliés » en double)", () => {
  assert.deepEqual(Object.keys(SCHEMA_RELECTURE.properties).sort(), ["fiche", "fiche_corrigee", "remarques", "tarifs", "trajets"]);
  assert.deepEqual(SCHEMA_RELECTURE.properties.trajets.items.properties.statut.enum, ["corrige", "signale", "ajoute"]);
});

test("délai d'une passe : un AbortSignal arrête le flux, l'écran reçoit « trop_long », le journal s'écrit toujours", () => {
  const index = readFileSync(new URL("../supabase/functions/assistant/index.ts", import.meta.url), "utf8");
  assert.match(index, /if \(arret && arret\.signal\.aborted\) \{[\s\S]{0,200}statut = "delai";\s*reponse = \{ erreur: "trop_long" \};/);
  assert.match(index, /finally \{\s*if \(minuterie\) clearTimeout\(minuterie\);\s*\}/);
  // Le journal est écrit après le try/catch/finally, quel que soit le chemin.
  const fin = index.slice(index.indexOf("finally {"));
  assert.match(fin, /assistant_journal"\)\.insert\(ligneJournal/);
});

// ---- JSON libre (plus de sortie structurée) -------------------------------------------------------------------------------------------

const demo = () => validerBrochure(brochureDemoTransport()).brochure;
const reponse = (texte, stop = "end_turn") => ({ stop_reason: stop, content: [{ type: "thinking", thinking: "" }, { type: "text", text: texte }], usage: { input_tokens: 1, output_tokens: 1 } });

test("extraction : le JSON seul, entouré de texte, dans un bloc ```json, avec une accolade dans une chaîne ; tronqué ou illisible refusé", () => {
  const objet = JSON.stringify(brochureDemoTransport());
  for (const t of [objet, `Voici la lecture :\n${objet}\nBonne journée.`, "```json\n" + objet + "\n```", "Résultat :\n```\n" + objet + "\n```\nFin."]) {
    const r = extraireJson(t);
    assert.equal(r.ok, true, t.slice(0, 30));
    assert.deepEqual(r.valeur, JSON.parse(objet));
  }
  assert.deepEqual(extraireJson('{"remarques": "case } fermée { ouverte", "x": "\\"guillemet\\""}').valeur, { remarques: "case } fermée { ouverte", x: '"guillemet"' });
  assert.deepEqual(extraireJson(objet.slice(0, objet.length - 40)), { ok: false, raison: "tronque" });
  assert.deepEqual(extraireJson("```json\n" + objet.slice(0, 500)), { ok: false, raison: "tronque" });
  assert.deepEqual(extraireJson('{"a": 1,, "b": 2}'), { ok: false, raison: "invalide" });
  assert.deepEqual(extraireJson("Je ne peux pas lire ces images."), { ok: false, raison: "vide" });
  assert.deepEqual(extraireJson(""), { ok: false, raison: "vide" });
});

test("lecture de la réponse : JSON extrait puis contrôlé par validerBrochure ; illisible → json_invalide ; coupée ou refusée comme avant", () => {
  const ok = lireBrochure(reponse("Lecture faite.\n```json\n" + JSON.stringify(brochureDemoTransport()) + "\n```"));
  assert.equal(ok.ok, true);
  assert.equal(validerBrochure(ok.valeur).ok, true);
  assert.deepEqual(lireBrochure(reponse('{"tarifs": [], "trajets": [')), { ok: false, statut: "json_invalide", raison: "tronque" });
  assert.deepEqual(lireBrochure(reponse('{"tarifs": [], "trajets": [', "max_tokens")), { ok: false, statut: "coupe" });
  assert.equal(lireBrochure({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }).statut, "refus");
  // La relecture aussi : son JSON extrait passe par fusionnerRelecture puis validerBrochure.
  const rel = lireBrochure(reponse(JSON.stringify({ trajets: [], tarifs: [], fiche_corrigee: false, fiche: {}, remarques: "" })));
  assert.equal(validerBrochure(fusionnerRelecture(demo(), rel.valeur).brut).ok, true);
});

test("demande de correction : une seule, la réponse renvoyée telle quelle (réflexion comprise), puis la consigne ; dans le même délai", () => {
  const p = parametresBrochure(promptBrochure({ fichiers: [{ media_type: "image/jpeg", data: "/9j/AAAA" }], aujourdhui: "2026-11-24" }));
  const premiere = reponse('{"tarifs": [], "trajets": [');
  const c = demandeCorrection(p, premiere, "tronque");
  assert.equal(c.messages.length, p.messages.length + 2);
  assert.deepEqual(c.messages.at(-2), { role: "assistant", content: premiere.content });
  assert.match(c.messages.at(-1).content[0].text, /ne se referme pas[\s\S]*Rends seulement l'objet JSON complet et valide/);
  assert.equal(c.model, p.model);
  const index = readFileSync(new URL("../supabase/functions/assistant/index.ts", import.meta.url), "utf8");
  // Une seule fois (un « if », pas une boucle), seulement si le délai n'est pas atteint, sur le même AbortSignal.
  assert.equal((index.match(/demandeCorrection\(/g) || []).length, 1);
  assert.match(index, /if \(!lu\.ok && lu\.statut === "json_invalide" && usage === "brochure" && arret && !arret\.signal\.aborted\) \{/);
  assert.match(index, /demandeCorrection\([^)]*\)[^;]*\{ signal: arret\.signal \}\)/);
  assert.match(index, /lire = lireBrochure;/);
});
