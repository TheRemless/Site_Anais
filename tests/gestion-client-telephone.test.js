import test from "node:test";
import assert from "node:assert/strict";
import { verifierTelephoneClient, numerosClient } from "../src/gestion/js/client-calc.mjs";

test("téléphone client : international accepté et normalisé, sans indicatif refusé, vide et inchangé acceptés", () => {
  assert.deepEqual(verifierTelephoneClient("+41 79 123 45 67"), { ok: true, valeur: "+41791234567", raison: "" });
  assert.equal(verifierTelephoneClient("0041 79 123 45 67").valeur, "+41791234567");
  assert.equal(verifierTelephoneClient("41791234567").valeur, "+41791234567");
  const sans = verifierTelephoneClient("079 123 45 67");
  assert.equal(sans.ok, false);
  assert.equal(sans.raison, "sans_indicatif");
  assert.equal(verifierTelephoneClient("123").raison, "trop_court");
  assert.equal(verifierTelephoneClient("abc").raison, "vide");
  assert.deepEqual(verifierTelephoneClient("   "), { ok: true, valeur: "", raison: "" });
  // Un ancien numéro sans indicatif déjà enregistré ne bloque pas la modification d'un autre champ, mais le changer demande l'indicatif.
  assert.equal(verifierTelephoneClient("079 123 45 67", "079 123 45 67").ok, true);
  assert.equal(verifierTelephoneClient("079 123 45 68", "079 123 45 67").ok, false);
});

test("boutons Appeler et WhatsApp d'un client : jamais d'indicatif deviné", () => {
  assert.deepEqual(numerosClient("+41 79 123 45 67"), { appel: "+41791234567", whatsapp: "41791234567" });
  assert.deepEqual(numerosClient("079 123 45 67"), { appel: "0791234567", whatsapp: "" }, "l'appel marche en local, WhatsApp demande l'international");
  assert.deepEqual(numerosClient(""), { appel: "", whatsapp: "" });
  assert.deepEqual(numerosClient("12"), { appel: "", whatsapp: "" });
});
