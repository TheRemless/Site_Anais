// tests/gestion-carte-reservation.test.js : un seul geste principal par carte de réservation, le reste dans le menu « … ».
// Depuis le 14.11.2026, plus d'étapes avec le prestataire : une réservation saisie est confirmée, il ne reste que son voucher.
const test = require("node:test");
const assert = require("node:assert/strict");
const load = () => import("../src/gestion/js/carte-reservation-calc.mjs");

const base = { statut: "confirme", ecrit: true, aPartenaire: true, aClient: true, voucher: null, liee: false };
const c = (o) => ({ ...base, ...o });

test("le seul geste principal est « envoyer le voucher » tant qu'il n'est pas parti", async () => {
  const { gestePrincipal } = await load();
  assert.equal(gestePrincipal(c({ voucher: { envoye: false } })), "voucher");
  assert.equal(gestePrincipal(c({ voucher: { envoye: true } })), null);
  assert.equal(gestePrincipal(c({ voucher: null })), null, "service sans voucher");
  // Une réservation saisie avant le 14.11 avec un ancien statut se traite comme confirmée.
  assert.equal(gestePrincipal(c({ statut: "a_demander", voucher: { envoye: false } })), "voucher");
  assert.equal(gestePrincipal(c({ statut: "demande" })), null);
});

test("annulée ou lecture seule : aucun geste principal", async () => {
  const { gestePrincipal } = await load();
  assert.equal(gestePrincipal(c({ statut: "annule", voucher: { envoye: false } })), null);
  assert.equal(gestePrincipal(c({ ecrit: false, voucher: { envoye: false } })), null);
});

test("le menu : messages, modifier, changer, voucher et statut ; plus de demande, confirmation, relance ni « s'est bien passé »", async () => {
  const { entreesMenu } = await load();
  const m = entreesMenu(c({}));
  assert.deepEqual(m, ["message_partenaire", "message_client", "modifier", "changer", "statut"]);
  for (const ancien of ["demander", "confirmer", "relancer", "autre_reponse", "pas_envoyee", "fait"]) for (const statut of ["a_demander", "demande", "confirme"]) assert.ok(!entreesMenu(c({ statut })).includes(ancien), `${ancien} (${statut})`);
  assert.ok(!entreesMenu(c({ voucher: { envoye: false } })).includes("voucher"), "déjà le geste principal");
  assert.ok(entreesMenu(c({ voucher: { envoye: true } })).includes("voucher"), "renvoyer le voucher reste dans le menu");
});

test("dupliquer seulement pour un service lié à une ligne de facture", async () => {
  const { entreesMenu } = await load();
  assert.ok(!entreesMenu(c({})).includes("dupliquer"));
  assert.ok(entreesMenu(c({ liee: true })).includes("dupliquer"));
});

test("lecture seule : seulement les messages", async () => {
  const { entreesMenu } = await load();
  assert.deepEqual(entreesMenu(c({ ecrit: false })), ["message_partenaire", "message_client"]);
  assert.deepEqual(entreesMenu(c({ ecrit: false, aPartenaire: false, aClient: false })), []);
});

test("annulée : messages, modifier et statut pour la réactiver, ni changer ni voucher", async () => {
  const { entreesMenu } = await load();
  assert.deepEqual(entreesMenu(c({ statut: "annule", voucher: { envoye: true } })), ["message_partenaire", "message_client", "modifier", "statut"]);
});
