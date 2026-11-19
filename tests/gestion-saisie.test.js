// Saisie en cours (19.11.2026) : Jérémy voyait « Une saisie est en cours : elle sera perdue si vous rechargez maintenant » sans rien avoir en
// cours, et la nouvelle version ne s'installait jamais. Cause : l'outil comparait chaque champ à sa valeur « d'origine » selon le navigateur
// (defaultValue, defaultSelected), qu'il ne tient pas à jour ; une fiche dossier ou client ouverte sans rien toucher comptait comme une saisie,
// et toute liste déroulante aussi. Désormais : un champ visible changé par la personne et pas encore enregistré, rien d'autre.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { signatureChamp, champHorsSaisie, champModifie, ZONES_HORS_SAISIE } from "../src/gestion/js/saisie-calc.mjs";

const source = (f) => fs.readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");

test("un champ que l'outil a rempli lui-même et que personne n'a touché n'est pas une saisie (fiche dossier, fiche client)", () => {
  // Pas d'origine notée : personne n'a fait de geste sur ce champ, quelle que soit sa valeur (montant proposé, nom du client, date du jour).
  assert.equal(champModifie(undefined, signatureChamp({ type: "number", value: "195" })), false);
  assert.equal(champModifie(undefined, signatureChamp({ type: "date", value: "2026-11-19" })), false);
  assert.equal(champModifie(undefined, signatureChamp({ type: "select-one", value: "virement" })), false, "une liste réglée par l'outil");
});

test("un champ touché puis laissé tel quel n'est pas une saisie ; changé, il l'est", () => {
  const origine = signatureChamp({ type: "number", value: "195" });
  assert.equal(champModifie(origine, signatureChamp({ type: "number", value: "195" })), false, "clic dans le montant, rien changé");
  assert.equal(champModifie(origine, signatureChamp({ type: "number", value: "999" })), true, "montant tapé");
  assert.equal(champModifie(origine, signatureChamp({ type: "number", value: "195" })), false, "remis comme avant : plus de saisie");
  const caseO = signatureChamp({ type: "checkbox", checked: false });
  assert.equal(champModifie(caseO, signatureChamp({ type: "checkbox", checked: true })), true, "case cochée");
  assert.equal(signatureChamp({ isContentEditable: true, textContent: "abc" }), "t:abc");
  const multi = { multiple: true, options: [{ value: "a", selected: true }, { value: "b", selected: false }] };
  assert.equal(signatureChamp(multi), "m:a");
});

test("recherche, filtres, tris, onglets, choix de l'entreprise ou de la langue ne sont jamais une saisie", () => {
  assert.equal(champHorsSaisie({ type: "search" }), true, "recherche globale et recherche d'une liste");
  assert.equal(champHorsSaisie({ type: "text", role: "combobox" }), true, "Chercher un client existant");
  for (const id of ["tri-liste", "filtre-b-0", "filtre-recherche", "recherche-client"]) assert.equal(champHorsSaisie({ type: "select-one", id }), true, id);
  assert.equal(champHorsSaisie({ type: "select-one", dansZoneHorsSaisie: true }), true, "menu (entreprise), barre de filtres, onglets, palette");
  for (const z of [".barre-filtres", ".feuille-filtres", ".puces", ".palette-fond", ".menu", ".barre-haut", ".langues", ".combo", "[data-pas-saisie]"]) assert.ok(ZONES_HORS_SAISIE.includes(z), z);
  assert.equal(champHorsSaisie({ type: "text", id: "c-tel" }), false, "le téléphone d'une fiche client reste une saisie");
  assert.equal(champHorsSaisie({ type: "textarea", id: "cc-texte" }), false, "le texte collé d'une confirmation aussi");
});

test("le suivi note l'origine au premier geste (focus, clic, touche, libellé), jamais ce que l'outil remplit", () => {
  const s = source("saisie.mjs");
  assert.match(s, /for \(const ev of \["focusin", "pointerdown", "keydown", "beforeinput"\]\) doc\.addEventListener\(ev, noter, true\);/, "à la capture, avant que la valeur ne change");
  assert.match(s, /if \(!estChamp\(c\) \|\| origine\.has\(c\)\) return;/, "la première valeur vue reste l'origine");
  assert.match(s, /\(libelle && libelle\.control\)/, "une case cochée par son libellé");
  // Une fenêtre fermée ne compte jamais (retirée, masquée ou hors affichage) ; l'écran derrière une fenêtre ouverte compte toujours.
  assert.match(s, /const visible = \(el\) => el\.isConnected && !el\.closest\("\[hidden\]"\) && el\.getClientRects\(\)\.length > 0;/);
  assert.match(s, /const zones = \[doc\.getElementById\("principal"\), \.\.\.doc\.querySelectorAll\("\.modal-fond"\)\]/);
});

test("app.mjs : une saisie, c'est un champ changé et pas enregistré ; une fenêtre ouverte, un curseur ou un écran de saisie vide ne le sont pas", () => {
  const app = source("app.mjs");
  const fonction = app.slice(app.indexOf("function saisieEnCours()"), app.indexOf("function ecranLibre()"));
  assert.match(fonction, /return champsModifies\(\)\.length > 0;/);
  assert.ok(!/\.modal-fond|activeElement|defaultValue/.test(fonction), "ni la seule présence d'une fenêtre, ni le curseur, ni defaultValue");
  assert.match(fonction, /#principal \[data-occupe\]/, "l'écran « Nouveau voucher » dit lui-même quand il est occupé");
  // Redessiner reste plus prudent : pas sous une fenêtre ouverte, pas pendant la frappe d'une recherche.
  assert.match(app, /return ecranDeLecture\(location\.hash\) && !saisieEnCours\(\) && !document\.querySelector\("\.modal-fond"\) && !curseurDansUnChamp\(\);/);
  assert.match(app, /suivreSaisies\(\);/);
  // Le rechargement de la nouvelle version n'attend plus qu'on quitte un écran de saisie vide (Nouveau dossier, Coller…).
  const recharger = app.slice(app.indexOf("function rechargerSiSur("), app.indexOf("function signalerVersion("));
  assert.ok(!/ecranDeLecture/.test(recharger));
});
