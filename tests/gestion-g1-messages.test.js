import { test } from "node:test";
import assert from "node:assert/strict";
import { gabaritsPropose, gabaritsManquants } from "../src/gestion/js/operations-calc.mjs";
import { MESSAGES_DEFAUT } from "../src/gestion/js/defauts.mjs";

// État de la production pour Secret : seulement la demande au partenaire, en anglais et en thaï.
const stockes = MESSAGES_DEFAUT.filter((m) => m.pour === "partenaire" && m.cle === "partenaire").map((m) => ({ ...m }));

test("relance, modification, annulation absentes en base : le modèle par défaut de cet usage, jamais la demande de réservation", () => {
  for (const cle of ["relance", "modification", "annulation"]) {
    const p = gabaritsPropose(stockes, MESSAGES_DEFAUT, { pour: "partenaire", langue: "en", cle });
    assert.ok(p.choisi, cle);
    assert.equal(p.choisi.cle, cle, `la clé « ${cle} » n'est pas remplacée par le premier modèle venu`);
    assert.notEqual(p.choisi.cle, "partenaire");
    assert.equal(p.choisi.defaut, true, "le modèle vient des modèles par défaut, rien n'est écrit en base");
  }
  assert.match(gabaritsPropose(stockes, MESSAGES_DEFAUT, { pour: "partenaire", langue: "en", cle: "relance" }).choisi.titre, /Follow-up/);
});

test("un modèle modifié en base garde la priorité sur le modèle par défaut de la même clé", () => {
  const modifie = { id: "perso", pour: "partenaire", cle: "relance", langue: "en", titre: "Ma relance", corps: "Hello, any news?" };
  const p = gabaritsPropose([...stockes, modifie], MESSAGES_DEFAUT, { pour: "partenaire", langue: "en", cle: "relance" });
  assert.equal(p.choisi.id, "perso");
  assert.equal(p.liste.some((m) => m.defaut && m.cle === "relance" && m.langue === "en"), false, "pas de doublon par défaut quand la clé existe dans cette langue");
});

test("une clé qui n'existe ni en base ni par défaut ne choisit rien : on ne prend pas le premier modèle", () => {
  const p = gabaritsPropose(stockes, MESSAGES_DEFAUT, { pour: "partenaire", langue: "en", cle: "inconnue" });
  assert.equal(p.choisi, null);
  assert.ok(p.liste.length > 0, "les modèles restent proposables à la main");
});

test("sans clé demandée : le premier modèle de la langue, comme avant", () => {
  const p = gabaritsPropose(stockes, MESSAGES_DEFAUT, { pour: "partenaire", langue: "en", cle: "" });
  assert.equal(p.choisi.langue, "en");
  assert.equal(p.choisi.defaut, undefined);
});

test("les modèles par défaut d'un usage proposent aussi leurs autres langues", () => {
  const p = gabaritsPropose(stockes, MESSAGES_DEFAUT, { pour: "partenaire", langue: "th", cle: "annulation" });
  assert.equal(p.choisi.langue, "th");
  assert.equal(p.choisi.cle, "annulation");
});

test("« Ajouter les modèles manquants » : seulement les clés absentes, rien n'écrase un modèle modifié", () => {
  const modifie = { id: "perso", pour: "partenaire", cle: "partenaire", langue: "en", titre: "Ma demande", corps: "Hi, can you take 2 people?" };
  const manquants = gabaritsManquants([modifie], MESSAGES_DEFAUT);
  assert.equal(manquants.some((m) => m.cle === "partenaire" && m.langue === "en" && m.pour === "partenaire"), false, "la demande en anglais existe déjà (modifiée)");
  assert.equal(manquants.some((m) => m.cle === "relance" && m.langue === "en"), true);
  assert.equal(manquants.some((m) => m.cle === "partenaire" && m.langue === "th"), true);
  assert.ok(manquants.every((m) => !m.defaut), "les modèles à ajouter sont des modèles ordinaires");
  assert.equal(gabaritsManquants(MESSAGES_DEFAUT, MESSAGES_DEFAUT).length, 0, "rien à ajouter quand tout est là");
});

import { champsConfirmation } from "../src/gestion/js/operations-calc.mjs";
test("Confirmée : l'heure de pickup et la référence du prestataire se notent au même geste, sans effacer ce qui existe", () => {
  const r = { statut: "demande", heure_pickup: "", reference_partenaire: "" };
  assert.deepEqual(champsConfirmation(r, { heure: "08:30", reference: " LT-42 " }), { statut: "confirme", heure_pickup: "08:30", reference_partenaire: "LT-42" });
  assert.deepEqual(champsConfirmation(r, { heure: "", reference: "" }), { statut: "confirme" }, "tout est facultatif : confirmer sans rien saisir reste possible");
  const deja = { ...r, heure_pickup: "07:00", reference_partenaire: "A1" };
  assert.deepEqual(champsConfirmation(deja, { heure: "", reference: "" }), { statut: "confirme" }, "une heure déjà notée n'est pas effacée");
  assert.deepEqual(champsConfirmation(deja, { heure: "07:30", reference: "" }), { statut: "confirme", heure_pickup: "07:30" });
});
