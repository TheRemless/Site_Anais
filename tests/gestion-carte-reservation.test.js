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

test("le menu : message client, modifier, changer, voucher et statut ; plus de demande, confirmation, relance ni « s'est bien passé »", async () => {
  const { entreesMenu } = await load();
  const m = entreesMenu(c({}));
  assert.deepEqual(m, ["rappel", "message_client", "modifier", "changer", "statut"], "plus de message au partenaire (14.11.2026) ; le rappel ouvre la fiche, sans rien envoyer");
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
  // Le rappel (fiche et cases « rappel envoyé ») reste lisible en lecture seule ; la base refuse la case à qui n'écrit pas.
  assert.deepEqual(entreesMenu(c({ ecrit: false })), ["rappel", "message_client"]);
  assert.deepEqual(entreesMenu(c({ ecrit: false, aPartenaire: false, aClient: false })), ["rappel"]);
});

test("annulée : messages, modifier et statut pour la réactiver, ni changer ni voucher", async () => {
  const { entreesMenu } = await load();
  assert.deepEqual(entreesMenu(c({ statut: "annule", voucher: { envoye: true } })), ["message_client", "modifier", "statut"]);
});

// Relecture de la PR 361 : le menu « … » d'une carte ne doit jamais s'ouvrir vide. Chaque clé de entreesMenu, dans tous les contextes,
// a un groupe (groupesMenu) et un geste dans la table GESTES de carteReservation, et ouvrirMenu reçoit un objet indexé par clé.
test("menu « … » : chaque entrée a un groupe et un geste, quel que soit le contexte", async () => {
  const { entreesMenu, gestePrincipal, groupesMenu } = await load();
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../src/gestion/js/views/reservations.mjs"), "utf8");
  const table = source.slice(source.indexOf("const GESTES = {"), source.indexOf("};", source.indexOf("const GESTES = {")));
  const gestes = new Set([...table.matchAll(/^\s+([a-z_]+): \[/gm)].map((m) => m[1]));
  assert.ok(gestes.size >= 7, "table GESTES introuvable dans reservations.mjs");
  assert.match(source, /ouvrirMenu\(r, Object\.fromEntries\(menu\.map\(\(k\) => \[k, GESTES\[k\]\]\)\)\)/, "ouvrirMenu attend un objet indexé par clé : une liste ouvre un menu vide");
  const vrais = [true, false];
  let vus = 0;
  for (const statut of ["confirme", "a_confirmer", "annule"])
    for (const ecrit of vrais)
      for (const aPartenaire of vrais)
        for (const aClient of vrais)
          for (const liee of vrais)
            for (const voucher of [null, { envoye: false }, { envoye: true }, { envoye: true, modifie: true }]) {
              const ctx = { statut, ecrit, aPartenaire, aClient, voucher, liee };
              const menu = entreesMenu(ctx);
              const principal = gestePrincipal(ctx);
              if (principal) assert.ok(gestes.has(principal), `geste principal sans bouton : ${principal}`);
              for (const k of menu) assert.ok(gestes.has(k), `entrée sans geste : ${k} (${JSON.stringify(ctx)})`);
              const affiches = groupesMenu(menu).flatMap(([, cles]) => cles);
              assert.deepEqual([...affiches].sort(), [...menu].sort(), `entrée sans groupe : ${JSON.stringify(ctx)}`);
              vus++;
            }
  assert.ok(vus > 100);
});
