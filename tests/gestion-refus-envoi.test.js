// Refus du serveur jamais muet pour un message écrit d'avance (point du soir et « Proposer une excursion », décision du 22.11.2026) :
// motif en clair, texte modifiable, envoi rallumé dès que le texte change, pas d'envoi forcé.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { motifRefusEnvoi, ERREURS_ENVOI, LECTURE_IMPOSSIBLE } from "../src/gestion/js/whatsapp-calc.mjs";
import { tr } from "../src/gestion/js/i18n.mjs";
import { EN } from "../src/gestion/js/i18n-en.mjs";

const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const dit = (r) => {
  const m = motifRefusEnvoi(r);
  return m && tr(m.texte, m.vars);
};

test("motif : un montant égal à un prix d'achat est nommé, jamais quand il est masqué", () => {
  assert.equal(dit({ erreur: "montant_a_confirmer", a_confirmer: [1200], portee: "catalogue" }), "Le montant 1 200 est égal à un prix d'achat. Modifiez le message, rien n'est parti.");
  assert.equal(dit({ erreur: "montant_a_confirmer", a_confirmer: [1200, 800] }), "Les montants 1 200, 800 sont égaux à des prix d'achat. Modifiez le message, rien n'est parti.");
  // Pas le droit de voir les nets (Mook) : aucun montant nommé.
  const masque = dit({ erreur: "montant_a_confirmer", a_confirmer: [], masque: true });
  assert.equal(masque, "Un montant du message est égal à un prix d'achat. Modifiez le message, rien n'est parti.");
  assert.ok(!/\d/.test(masque));
  assert.equal(dit({ erreur: "contenu_interne", a_retirer: ["montant_interne:#0123456789abcdef:aa,bb"] }), masque);
});

test("motif : 422 contenu_interne avec montants et noms ; lecture impossible et autres refus gardent leur message", () => {
  assert.equal(dit({ erreur: "contenu_interne", a_retirer: ["montant_interne:1500", "nom_prestataire:Partenaire Fictif"] }), "Le montant 1 500 est égal à un prix d'achat. Partenaire Fictif est le nom d'un partenaire. Modifiez le message, rien n'est parti.");
  assert.equal(dit({ erreur: "contenu_interne", a_retirer: ["nom_prestataire:Alpha Fictif", "nom_prestataire:Beta Fictif"] }), "Alpha Fictif, Beta Fictif sont des noms de partenaires. Modifiez le message, rien n'est parti.");
  assert.equal(dit({ erreur: "contenu_interne", a_retirer: [] }), ERREURS_ENVOI.contenu_interne);
  assert.equal(motifRefusEnvoi({ erreur: "contenu_interne", a_retirer: [LECTURE_IMPOSSIBLE] }), null);
  assert.equal(motifRefusEnvoi({ erreur: "contenu_interne", a_retirer: ["controle_impossible"] }), null);
  for (const erreur of ["fenetre_fermee", "droit_manquant", "inconnu"]) assert.equal(motifRefusEnvoi({ erreur }), null, erreur);
  assert.equal(motifRefusEnvoi(null), null);
});

test("motif : chaque phrase possible a sa traduction anglaise", () => {
  const cas = [[1], [1, 2], []].flatMap((m) => [[], ["nom_prestataire:A Fictif"], ["nom_prestataire:A Fictif", "nom_prestataire:B Fictif"]].map((n) => ({ erreur: "contenu_interne", a_retirer: [...(m.length ? [`montant_interne:${m.join(",")}`] : ["montant_interne:#0123456789abcdef:aa"]), ...n] })));
  for (const r of cas) {
    const m = motifRefusEnvoi(r);
    assert.ok(m && EN[m.texte], m && m.texte);
  }
  assert.ok(EN["Message à modifier avant l'envoi"]);
});

test("écrans : motif affiché, texte modifiable, envoi rallumé au changement, pas d'envoi forcé", () => {
  const soir = lire("src/gestion/js/views/point-soir.mjs");
  assert.match(soir, /const motif = motifRefusEnvoi\(res,/);
  assert.match(soir, /if \(code === "contenu_interne" \|\| code === "montant_a_confirmer"\) \{\n\s+refuse = envoye;/);
  assert.match(soir, /edition = h\("textarea", \{ class: "point-soir-edition"/);
  assert.match(soir, /edition\.addEventListener\("input", majBouton\)/);
  assert.match(soir, /\(refuse !== null && texteEnvoye\(\) === refuse\)/);
  assert.match(soir, /whatsappEnvoyer\(\{ conversation_id: moyen\.conversation_id, texte: envoye \}\)/);
  assert.ok(!/montants_confirmes/.test(soir), "pas d'envoi forcé dans le point du soir");
  const exc = lire("src/gestion/js/views/proposer-excursion.mjs");
  assert.match(exc, /motif = motifRefusEnvoi\(res,/);
  assert.match(exc, /\? tr\(motif\.texte, motif\.vars\)/);
  assert.ok(!/montants_confirmes|Envoyer quand même|aConfirmerEnvoi/.test(exc), "pas d'envoi forcé dans l'excursion");
  // Le refus reste côté serveur : whatsapp-envoi n'est pas touché par ce changement.
  assert.match(lire("supabase/functions/whatsapp-envoi/calc.js"), /if \(aConfirmer\.length && !memesMontants\(aConfirmer, confirmes\)\) return \{ status: 409/);
});
