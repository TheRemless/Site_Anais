import { test } from "node:test";
import assert from "node:assert/strict";
import { DUREE_JOURS, expiration, cheminLien, lienActif, secondesRestantes, messageLien } from "../src/gestion/js/liens-calc.mjs";

const MAINTENANT = "2026-11-11T08:00:00.000Z";

test("expiration : 30 jours par défaut, durée réglable", () => {
  assert.equal(DUREE_JOURS, 30);
  assert.equal(expiration(MAINTENANT), "2026-12-11T08:00:00.000Z");
  assert.equal(expiration(MAINTENANT, 7), "2026-11-18T08:00:00.000Z");
});

test("chemin : entreprise puis identifiant aléatoire, jamais un nom de client", () => {
  assert.equal(cheminLien("ent-1", "abc", "image/png"), "ent-1/abc.png");
  assert.equal(cheminLien("ent-1", "abc", "application/pdf"), "ent-1/abc.pdf");
  assert.equal(cheminLien("ent-1", "abc", "image/jpeg"), "ent-1/abc.jpg");
  assert.equal(cheminLien("ent-1", "abc"), "ent-1/abc.png");
});

test("lien actif : ni révoqué, ni nettoyé, ni expiré", () => {
  const base = { expire_le: "2026-12-11T08:00:00.000Z", revoque_le: null, nettoye_le: null };
  assert.equal(lienActif(base, MAINTENANT), true);
  assert.equal(lienActif({ ...base, revoque_le: MAINTENANT }, MAINTENANT), false);
  assert.equal(lienActif({ ...base, nettoye_le: MAINTENANT }, MAINTENANT), false);
  assert.equal(lienActif({ ...base, expire_le: "2026-11-11T07:59:59.000Z" }, MAINTENANT), false);
  assert.equal(lienActif({ ...base, expire_le: MAINTENANT }, MAINTENANT), false, "à l'instant d'expiration, il n'est plus actif");
});

test("secondes restantes : jamais négatives", () => {
  assert.equal(secondesRestantes({ expire_le: "2026-11-11T09:00:00.000Z" }, MAINTENANT), 3600);
  assert.equal(secondesRestantes({ expire_le: "2026-11-10T09:00:00.000Z" }, MAINTENANT), 0);
});

test("message en anglais : un voucher, avec le lien et l'échéance", () => {
  const t = messageLien({ genre: "voucher", langue: "en", prenom: "Ben", liens: [{ nom: "v1", url: "https://x.test/a" }], expire: "2026-12-11T08:00:00.000Z" });
  assert.equal(t, "Hello Ben,\n\nhere is your voucher:\nhttps://x.test/a\n\nThe link is valid until 11 December 2026.");
});

test("message en anglais : plusieurs vouchers numérotés", () => {
  const t = messageLien({ genre: "voucher", langue: "en", prenom: "Ben", liens: [{ url: "https://x.test/a" }, { url: "https://x.test/b" }], expire: "2026-12-11T08:00:00.000Z" });
  assert.match(t, /here are your vouchers:\n1\. https:\/\/x\.test\/a\n2\. https:\/\/x\.test\/b\n\nThe link is valid until 11 December 2026\.$/);
});

test("message en français : facture et devis, sans prénom", () => {
  assert.equal(messageLien({ genre: "facture", langue: "fr", liens: [{ url: "https://x.test/f" }], expire: "2026-12-11T08:00:00.000Z" }), "Bonjour,\n\nvoici votre facture :\nhttps://x.test/f\n\nLe lien est valable jusqu'au 11 décembre 2026.");
  assert.match(messageLien({ genre: "devis", langue: "fr", prenom: "Anna", liens: [{ url: "u" }] }), /^Bonjour Anna,\n\nvoici votre devis :\nu$/);
});

test("le message contient toujours le lien et ne dit jamais « joint » ni « attached »", () => {
  for (const langue of ["fr", "en"]) for (const genre of ["voucher", "devis", "facture"]) {
    const t = messageLien({ genre, langue, liens: [{ url: "https://x.test/z" }], expire: "2026-12-11T08:00:00.000Z" });
    assert.ok(t.includes("https://x.test/z"));
    assert.ok(!/joint|attach/i.test(t));
    assert.ok(!/undefined|null/.test(t));
  }
});
