import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmation } from "../src/gestion/js/confirmation.mjs";

// Fenêtre factice qui se comporte comme `modal` : sa fonction de fermeture appelle l'option `ferme`, donc `annuler`.
const fenetre = () => {
  const etat = { fin: null, ferme: null };
  const promesse = confirmation(({ fin, annuler }) => {
    etat.fin = fin;
    etat.ferme = () => annuler();
    return etat.ferme;
  });
  return { etat, promesse };
};

test("le bouton de confirmation répond oui, malgré la fermeture qui répond non", async () => {
  const { etat, promesse } = fenetre();
  etat.fin(true);
  assert.equal(await promesse, true);
});

test("le bouton d'annulation répond non", async () => {
  const { etat, promesse } = fenetre();
  etat.fin(false);
  assert.equal(await promesse, false);
});

test("la croix, Échap ou le fond (fermeture directe) répondent non", async () => {
  const { etat, promesse } = fenetre();
  etat.ferme();
  assert.equal(await promesse, false);
});

test("une fois répondu, une fermeture tardive ne change pas la réponse", async () => {
  const { etat, promesse } = fenetre();
  etat.fin(true);
  etat.ferme();
  assert.equal(await promesse, true);
});
