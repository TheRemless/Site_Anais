import { test } from "node:test";
import assert from "node:assert/strict";
import { moyenPartage, erreurLisible, navigateurLisible, resumeEnvironnement } from "../src/gestion/js/partage-calc.mjs";

test("moyen : partage natif dès que le navigateur sait joindre des fichiers, sur téléphone comme sur ordinateur", () => {
  assert.equal(moyenPartage({ partageFichiers: true, tactile: true }), "natif");
  assert.equal(moyenPartage({ partageFichiers: true, tactile: false }), "natif");
});

test("moyen : sans partage de fichiers, l'ordinateur copie l'image et ouvre la conversation", () => {
  assert.equal(moyenPartage({ partageFichiers: false, tactile: false }), "ordinateur");
});

test("moyen : sans partage de fichiers sur téléphone, jamais de lien WhatsApp à texte seul d'office (cas du voucher sans image)", () => {
  assert.equal(moyenPartage({ partageFichiers: false, tactile: true }), "telephone_sans_partage");
});

test("erreur lisible : nom et message, valeurs absentes sans « undefined »", () => {
  assert.equal(erreurLisible({ name: "NotAllowedError", message: "The request is not allowed" }), "NotAllowedError : The request is not allowed");
  assert.equal(erreurLisible({ name: "TypeError" }), "TypeError");
  assert.equal(erreurLisible(null), "Erreur inconnue");
  assert.equal(erreurLisible("boom"), "boom");
});

test("navigateur : reconnaît Safari, Chrome, Firefox et les navigateurs intégrés sur iPhone", () => {
  const ios = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
  assert.equal(navigateurLisible(`${ios} Version/17.4 Mobile/15E148 Safari/604.1`), "Safari iPhone");
  assert.equal(navigateurLisible(`${ios} FxiOS/124.0 Mobile/15E148 Safari/605.1.15`), "Firefox iPhone");
  assert.equal(navigateurLisible(`${ios} CriOS/124.0 Mobile/15E148 Safari/604.1`), "Chrome iPhone");
  assert.equal(navigateurLisible(`${ios} Mobile/15E148 WhatsApp/24.2`), "Navigateur intégré iPhone");
  assert.equal(navigateurLisible(`${ios} Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]`), "Navigateur intégré iPhone");
  assert.equal(navigateurLisible("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"), "Chrome ordinateur");
  assert.equal(navigateurLisible(""), "Navigateur inconnu");
});

test("résumé : navigateur, application installée ou non, partage de fichiers", () => {
  const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";
  assert.equal(resumeEnvironnement({ userAgent: ua, standalone: true, partageFichiers: true }), "Safari iPhone · application installée · partage de fichiers : oui");
  assert.equal(resumeEnvironnement({ userAgent: ua, standalone: false, partageFichiers: false }), "Safari iPhone · dans le navigateur · partage de fichiers : non");
});
