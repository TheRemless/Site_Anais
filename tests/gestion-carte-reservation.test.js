// tests/gestion-carte-reservation.test.js : un seul geste principal par carte de réservation, le reste dans le menu « … ».
const test = require("node:test");
const assert = require("node:assert/strict");
const load = () => import("../src/gestion/js/carte-reservation-calc.mjs");

const base = { statut: "a_demander", ecrit: true, aPartenaire: true, aClient: true, passee: false, relancer: false, jourDeDemande: false, voucher: null, liee: false };
const c = (o) => ({ ...base, ...o });

test("à demander avec partenaire : le geste est « demander »", async () => {
  const { gestePrincipal } = await load();
  assert.equal(gestePrincipal(c({})), "demander");
});

test("à demander sans partenaire : on complète la réservation (« modifier »)", async () => {
  const { gestePrincipal } = await load();
  assert.equal(gestePrincipal(c({ aPartenaire: false })), "modifier");
});

test("demandée : « confirmée », ou « relancer » quand le prestataire est en retard", async () => {
  const { gestePrincipal } = await load();
  assert.equal(gestePrincipal(c({ statut: "demande" })), "confirmer");
  assert.equal(gestePrincipal(c({ statut: "demande", relancer: true })), "relancer");
  assert.equal(gestePrincipal(c({ statut: "demande", aPartenaire: false })), "modifier");
});

test("confirmée : « envoyer le voucher » tant qu'il n'est pas parti, puis plus de geste principal", async () => {
  const { gestePrincipal } = await load();
  assert.equal(gestePrincipal(c({ statut: "confirme", voucher: { envoye: false } })), "voucher");
  assert.equal(gestePrincipal(c({ statut: "confirme", voucher: { envoye: true } })), null);
  assert.equal(gestePrincipal(c({ statut: "confirme", voucher: null })), null, "service sans voucher");
});

test("service passé non clos : « s'est bien passé » passe avant le reste", async () => {
  const { gestePrincipal } = await load();
  assert.equal(gestePrincipal(c({ passee: true })), "fait");
  assert.equal(gestePrincipal(c({ passee: true, statut: "demande" })), "fait");
  assert.equal(gestePrincipal(c({ passee: true, statut: "confirme", voucher: { envoye: false } })), "voucher");
});

test("annulée ou lecture seule : aucun geste principal", async () => {
  const { gestePrincipal } = await load();
  assert.equal(gestePrincipal(c({ statut: "annule" })), null);
  assert.equal(gestePrincipal(c({ ecrit: false })), null);
});

test("le menu ne répète pas le geste principal", async () => {
  const { entreesMenu } = await load();
  const m = entreesMenu(c({}));
  assert.ok(!m.includes("demander"));
  assert.ok(m.includes("message_partenaire") && m.includes("message_client") && m.includes("modifier") && m.includes("changer") && m.includes("statut"));
  const v = entreesMenu(c({ statut: "confirme", voucher: { envoye: false } }));
  assert.ok(!v.includes("voucher"));
  const deja = entreesMenu(c({ statut: "confirme", voucher: { envoye: true } }));
  assert.ok(deja.includes("voucher"), "renvoyer le voucher reste dans le menu");
});

test("réservation demandée : réponses du prestataire dans le menu, « remettre à demander » seulement le jour même", async () => {
  const { entreesMenu } = await load();
  const m = entreesMenu(c({ statut: "demande" }));
  assert.ok(!m.includes("confirmer"), "geste principal");
  assert.deepEqual(["autre_reponse", "relancer"].filter((k) => m.includes(k)), ["autre_reponse", "relancer"]);
  assert.ok(!m.includes("pas_envoyee"));
  assert.ok(entreesMenu(c({ statut: "demande", jourDeDemande: true })).includes("pas_envoyee"));
  const enRetard = entreesMenu(c({ statut: "demande", relancer: true }));
  assert.ok(!enRetard.includes("relancer") && enRetard.includes("confirmer"));
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

test("annulée : messages, modifier et statut pour la réactiver, ni changer ni geste du prestataire", async () => {
  const { entreesMenu } = await load();
  assert.deepEqual(entreesMenu(c({ statut: "annule" })), ["message_partenaire", "message_client", "modifier", "statut"]);
});

test("un service passé reste clôturable depuis le menu quand le geste principal est autre", async () => {
  const { entreesMenu } = await load();
  const m = entreesMenu(c({ passee: true, statut: "a_demander" }));
  assert.ok(!m.includes("fait"), "geste principal");
  assert.ok(m.includes("demander"), "toujours disponible");
});
