// Bandeau du site réservé au droit « Modifier les réglages de l'entreprise » (Jérémy, 17.11.2026 : Mook ne change pas les bandeaux ; migration 40).
// La base est vérifiée par docs/gestion/verif-site.mjs ; ici l'outil (menu, écran) et la démo, qui refuse comme la base.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = (f) => fs.readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");

test("migration 40 : publie_sur_le_site demande « reglages.ecrire » en plus de « dossiers.ecrire »", () => {
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-40-bandeau-reglages.sql", import.meta.url), "utf8");
  assert.match(sql, /create or replace function publie_sur_le_site\(e uuid\)/);
  assert.match(sql, /a_permission\(e, 'dossiers\.ecrire'\) and a_permission\(e, 'reglages\.ecrire'\)/);
  assert.match(sql, /revoke all on function publie_sur_le_site\(uuid\) from public, anon;/);
});

test("menu, route et écran : le bandeau n'apparaît qu'avec le droit, les demandes du site ne changent pas", () => {
  const app = source("app.mjs");
  assert.match(app, /const voitLeSite = \(\) => peut\("dossiers\.lire"\) && voitToutActif\(\);/);
  assert.match(app, /const bandeauVisible = \(\) => moduleActif\("bandeau_site"\) && voitLeSite\(\) && peut\("dossiers\.ecrire"\) && peut\("reglages\.ecrire"\);/);
  assert.match(app, /\.\.\.si\(bandeauVisible\(\), \{ href: "#\/bandeau"/);
  assert.match(app, /if \(cle === "bandeau"\) return bandeauVisible\(\);/);
  assert.match(app, /if \(cle === "demandes"\) return siteVisible\(\);/);
  assert.match(source("views/bandeau-site.mjs"), /const ecrit = peut\("dossiers\.ecrire"\) && peut\("reglages\.ecrire"\);/);
});

test("démo : Mook (Secret) ne crée, ne modifie ni ne supprime un bandeau ; l'administratrice oui", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  globalThis.location = { origin: "http://localhost", pathname: "/gestion/", search: "?demo", hash: "" };
  try {
    const { creer } = await import("../src/gestion/js/store-local.mjs");
    const store = creer();
    const admin = store.utilisateursDemo()[0];
    const mook = store.utilisateursDemo().find((u) => /vouchers et factures/.test(u.nom));
    store.changerUtilisateurDemo(mook.id);
    let donnees = await store.charger();
    const secret = donnees.entites.find((e) => e.slug === "excursions");
    const b = donnees.bandeaux_site.find((x) => x.entite_id === secret.id);
    assert.ok(b, "Mook voit toujours les bandeaux de Secret");
    await assert.rejects(store.inserer("bandeaux_site", { entite_id: secret.id, marques: ["secret"], type: "info", modele: "x", texte: "y" }), /bandeau du site est réservé/);
    await assert.rejects(store.modifier("bandeaux_site", b.id, { actif: false }), /bandeau du site est réservé/);
    await assert.rejects(store.supprimer("bandeaux_site", b.id), /bandeau du site est réservé/);
    store.changerUtilisateurDemo(admin.id);
    donnees = await store.charger();
    await store.modifier("bandeaux_site", b.id, { actif: false });
    assert.equal((await store.charger()).bandeaux_site.find((x) => x.id === b.id).actif, false);
  } finally {
    delete globalThis.localStorage;
    delete globalThis.location;
  }
});
