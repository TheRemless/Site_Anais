// PR 296 et 297 réunies : en démo, la conversation de Jade (apporteur, migration 68) sort dans « À faire » comme nouveau client envoyé par
// un apporteur, à l'écran comme pour l'agent (même calcul, aFaireWhatsApp).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aFaireEcran, donneesAFaire } from "../src/gestion/js/whatsapp-relie-calc.mjs";
import { typeContact } from "../src/gestion/js/apporteurs-calc.mjs";

test("démo : Jade, apporteur, sort dans « À faire » et un contact personnel jamais", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?relie=${Date.now()}`);
    const brut = await creer().charger();
    const jade = brut.whatsapp_conversations.find((c) => c.telephone === "+447700900955");
    assert.ok(jade, "la conversation de Jade existe une seule fois");
    assert.equal(brut.whatsapp_conversations.filter((c) => /jade/i.test(c.nom || "")).length, 1, "pas de doublon de Jade");
    assert.equal(typeContact(jade), "apporteur");
    const entites = (brut.entites || []).filter((e) => ["secret", "taxi", "excursions"].includes(e.slug));
    const donnees = donneesAFaire(brut, { entites, resumeDe: () => ({}), finances: () => false });
    const liste = JSON.stringify(aFaireEcran(donnees, { typeContact }));
    assert.match(liste, new RegExp(jade.id), "Jade est dans « À faire »");
    assert.match(liste, /apporteur/i, "… comme nouveau client envoyé par un apporteur");
    const perso = brut.whatsapp_conversations.find((c) => c.reponses === "jamais");
    if (perso) assert.doesNotMatch(liste, new RegExp(perso.id), "un contact personnel n'y est jamais");
  } finally {
    delete globalThis.localStorage;
  }
});
