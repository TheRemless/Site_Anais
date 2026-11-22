// Refus du serveur jamais muet pour un message écrit d'avance (point du soir et « Proposer une excursion »). Relecture de la PR 317 :
//   - 422 contenu_interne (un net qui n'est pas un prix de vente connu, un nom de partenaire) : refus sec, sans envoi forcé ;
//   - 409 montant_a_confirmer (un prix de vente qui est aussi le net d'un autre service) : « Envoyer quand même », liste revérifiée par le serveur.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { motifRefusEnvoi, ERREURS_ENVOI, LECTURE_IMPOSSIBLE } from "../src/gestion/js/whatsapp-calc.mjs";
import { refusEnvoi } from "../supabase/functions/whatsapp-envoi/calc.js";
import { tr } from "../src/gestion/js/i18n.mjs";
import { EN } from "../src/gestion/js/i18n-en.mjs";

const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const dit = (r, texte = "") => {
  const m = motifRefusEnvoi(r, { texte });
  return m && tr(m.texte, m.vars);
};

test("422 contenu_interne : refus sec, montant et nom en clair, jamais un montant masqué, rien à confirmer", () => {
  const net = { erreur: "contenu_interne", a_retirer: ["montant_interne:1200"] };
  assert.equal(dit(net), "Le montant 1 200 est égal à un prix d'achat. Modifiez le message, rien n'est parti.");
  assert.equal(motifRefusEnvoi(net).confirmer, undefined, "pas d'envoi forcé");
  assert.equal(dit({ erreur: "contenu_interne", a_retirer: ["montant_interne:1500", "nom_prestataire:Partenaire Fictif"] }), "Le montant 1 500 est égal à un prix d'achat. Partenaire Fictif est le nom d'un partenaire. Modifiez le message, rien n'est parti.");
  assert.equal(dit({ erreur: "contenu_interne", a_retirer: ["nom_prestataire:Alpha Fictif", "nom_prestataire:Beta Fictif"] }), "Alpha Fictif, Beta Fictif sont des noms de partenaires. Modifiez le message, rien n'est parti.");
  // Pas le droit de voir les nets (Mook) : aucun montant nommé.
  const masque = dit({ erreur: "contenu_interne", a_retirer: ["montant_interne:#0123456789abcdef:aa,bb"] });
  assert.equal(masque, "Un montant du message est égal à un prix d'achat. Modifiez le message, rien n'est parti.");
  assert.equal(dit({ erreur: "contenu_interne", a_retirer: [] }), ERREURS_ENVOI.contenu_interne);
  assert.equal(motifRefusEnvoi({ erreur: "contenu_interne", a_retirer: [LECTURE_IMPOSSIBLE] }), null);
  assert.equal(motifRefusEnvoi({ erreur: "contenu_interne", a_retirer: ["controle_impossible"] }), null);
  for (const erreur of ["fenetre_fermee", "droit_manquant", "inconnu"]) assert.equal(motifRefusEnvoi({ erreur }), null, erreur);
});

test("409 montant_a_confirmer : prix de vente aussi net d'un autre service, « Envoyer quand même » avec la liste exacte", () => {
  const r = { erreur: "montant_a_confirmer", a_confirmer: [1200], portee: "autre_service" };
  const m = motifRefusEnvoi(r, { texte: "Hello, the transfer is 1,200 THB." });
  assert.equal(tr(m.texte, m.vars), "Le montant 1 200 est un prix de vente, mais aussi le net d'un autre service. Vérifiez avant d'envoyer.");
  assert.deepEqual(m.confirmer, [1200]);
  assert.equal(dit({ erreur: "montant_a_confirmer", a_confirmer: [1200, 800] }), "Les montants 1 200, 800 sont des prix de vente, mais aussi les nets d'autres services. Vérifiez avant d'envoyer.");
  // Masqué : aucun montant nommé, la confirmation porte sur tous les montants du texte (même règle que le serveur).
  const mm = motifRefusEnvoi({ erreur: "montant_a_confirmer", a_confirmer: [], masque: true }, { texte: "Price 1200 THB, see you" });
  assert.equal(tr(mm.texte, mm.vars), "Un montant du message est un prix de vente, mais aussi le net d'un autre service. Vérifiez avant d'envoyer.");
  assert.deepEqual(mm.confirmer, [1200]);
  // Rien de confirmable : refus sec.
  assert.equal(motifRefusEnvoi({ erreur: "montant_a_confirmer", a_confirmer: [], masque: true }, { texte: "Hi" }).confirmer, undefined);
  // Le serveur exige la confirmation explicite : sans la liste, 409 ; avec, l'envoi passe. Un net (a_retirer) ne se lève jamais ainsi.
  assert.equal(refusEnvoi({ a_retirer: [], a_confirmer: [1200], portee: "autre_service" }, []).status, 409);
  assert.equal(refusEnvoi({ a_retirer: [], a_confirmer: [1200], portee: "autre_service" }, [1200]), null);
  assert.equal(refusEnvoi({ a_retirer: ["montant_interne:1200"], a_confirmer: [] }, [1200]).status, 422);
});

test("motifs : chaque phrase possible a sa traduction anglaise", () => {
  const cas = [[1], [1, 2], []].flatMap((m) => [[], ["nom_prestataire:A Fictif"], ["nom_prestataire:A Fictif", "nom_prestataire:B Fictif"]].map((n) => ({ erreur: "contenu_interne", a_retirer: [...(m.length ? [`montant_interne:${m.join(",")}`] : ["montant_interne:#0123456789abcdef:aa"]), ...n] })));
  cas.push({ erreur: "montant_a_confirmer", a_confirmer: [5] }, { erreur: "montant_a_confirmer", a_confirmer: [5, 6] }, { erreur: "montant_a_confirmer", masque: true, a_confirmer: [] });
  for (const r of cas) {
    const m = motifRefusEnvoi(r, { texte: "Price 5 THB" });
    assert.ok(m && EN[m.texte], m && m.texte);
  }
  for (const k of ["Message à modifier avant l'envoi", "Envoyer quand même", "Le message refusé ne part pas par WhatsApp : modifiez-le d'abord."]) assert.ok(EN[k], k);
});

test("écrans : motif affiché, texte modifiable, « Envoyer quand même » seulement pour le 409 et pour le texte refusé tel quel", () => {
  const soir = lire("src/gestion/js/views/point-soir.mjs");
  assert.match(soir, /const motif = motifRefusEnvoi\(res, \{ texte: envoye,/);
  assert.match(soir, /if \(code === "contenu_interne" \|\| code === "montant_a_confirmer"\) \{\n\s+refuse = envoye;/);
  assert.match(soir, /edition = h\("textarea", \{ class: "point-soir-edition"/);
  assert.match(soir, /if \(motif && motif\.confirmer\) \{\n\s+const liste = motif\.confirmer;\n\s+confirmation = h\("button", [^\n]*partir\(\{ dejaConfirme: true, confirmes: liste \}\)[^\n]*tr\("Envoyer quand même"\)\);/);
  assert.match(soir, /if \(confirmes && texteEnvoye\(\) !== refuse\) return;/);
  assert.match(soir, /if \(confirmation\) confirmation\.hidden = refuse === null \|\| texteEnvoye\(\) !== refuse;/);
  const exc = lire("src/gestion/js/views/proposer-excursion.mjs");
  assert.match(exc, /motif = motifRefusEnvoi\(res, \{ texte,/);
  assert.match(exc, /\? tr\(motif\.texte, motif\.vars\)/);
  assert.match(exc, /if \(motif && motif\.confirmer\) \{\n\s+const liste = motif\.confirmer;\n\s+confirmation = h\("button", [^\n]*onclick: \(\) => partir\(liste\) \}, tr\("Envoyer quand même"\)\);/);
  assert.match(exc, /if \(confirmes \? zone\.value\.trim\(\) !== refuse \|\| bloque \|\| !fenetreOk : envoyer\.disabled\) return;/);
  assert.match(exc, /if \(confirmation\) confirmation\.hidden = !aRefaire;/);
});
