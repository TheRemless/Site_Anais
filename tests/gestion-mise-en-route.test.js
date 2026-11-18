// Mise en route d'un client du logiciel (migration 45, 18.11.2026) : schéma neutre, données de départ par modèle métier,
// installation de la première entreprise par l'éditeur. La base est vérifiée par docs/gestion/verif-mise-en-route.mjs ;
// ici la source unique des données (modeles-metier.mjs), l'écran de l'éditeur et la démo, qui isole les organisations comme la base.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MODELES, departModele, catalogueModele, codeCourt } from "../src/gestion/js/modeles-metier.mjs";
import { TOUTES_PERMISSIONS } from "../src/gestion/js/defauts.mjs";

const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const INTERDITS = /Zwald|Lanta|Krabi|Ana[iï]s|Secret Travel|VIP Taxi|TWINT|PostFinance|292 Moo|\+ ?66 ?95|Mr\.? Brown/i;
const valeurs = (x) => (x && typeof x === "object" ? Object.values(x).map(valeurs).join("\n") : String(x ?? ""));

test("schema.sql est neutre : les données de Zwald sont dans donnees-ztp-depart.sql", () => {
  const schema = lire("docs/gestion/schema.sql");
  const code = schema.split("\n").filter((l) => !l.startsWith("--")).join("\n");
  assert.doesNotMatch(code, /insert into (entites|reglages|catalogue|roles)\b/);
  assert.doesNotMatch(code, INTERDITS);
  const ztp = lire("docs/gestion/donnees-ztp-depart.sql");
  assert.match(ztp, /insert into entites \(id, slug, nom, ordre\) values/);
  assert.match(ztp, /'ztp', 'Zwald Travel Planner'/);
  assert.match(ztp, /insert into catalogue/);
});

for (const m of MODELES) {
  test(`départ ${m.id} : réglages complets, trois rôles, aucune donnée de Zwald`, () => {
    const d = departModele(m.id, { nom: "Agence Bleue", devise: "EUR" });
    assert.equal(d.reglages.fonctionnement, m.fonctionnement);
    assert.equal(d.reglages.devise, "EUR");
    assert.equal(d.reglages.listes.devises[0], "EUR");
    assert.doesNotMatch(valeurs(d.reglages), INTERDITS);
    assert.ok(!d.reglages.listes.moyens.some((x) => ["twint", "postfinance"].includes(x.id)));
    assert.equal(d.roles[0].nom, "Administrateur");
    assert.equal(d.roles[0].tous_droits, true);
    assert.ok(d.roles.every((r) => r.permissions.every((p) => TOUTES_PERMISSIONS.includes(p))), "permissions connues de la base");
    assert.doesNotMatch(valeurs(d.catalogue), INTERDITS);
  });
}

test("catalogue d'exemple : formules d'un travel planner sans prix, rien pour excursions et transferts", () => {
  assert.equal(catalogueModele("travel_planner").length, 3);
  assert.ok(catalogueModele("travel_planner").every((c) => c.prix === null));
  assert.deepEqual(catalogueModele("tour_agency"), []);
  assert.deepEqual(catalogueModele("transfers"), []);
});

test("code court tiré du nom", () => {
  assert.equal(codeCourt("Agence Bleue"), "agence-bleue");
  assert.equal(codeCourt("Été à Lisboa !"), "ete-a-lisboa");
  assert.equal(codeCourt("***"), "agence");
  assert.match(codeCourt("x".repeat(80)), /^[a-z0-9-]{1,40}$/);
});

test("migration 45 : réservée à l'éditeur, une organisation sans entreprise, entrées contrôlées", () => {
  const sql = lire("docs/gestion/migration-45-mise-en-route.sql");
  assert.match(sql, /if not est_plateforme\(\) then raise exception/);
  assert.match(sql, /if exists \(select 1 from entites where organisation_id = p_organisation\) then/);
  assert.match(sql, /<@ toutes_permissions\(\)/);
  assert.match(sql, /revoke all on function installer_entreprise\(uuid, text, text, jsonb, jsonb, jsonb\) from public, anon;/);
});

test("écran de l'éditeur : type d'activité et devise, puis installation après creer_client", () => {
  const admin = lire("src/gestion/js/views/admin.mjs");
  const i = admin.indexOf('action: "creer_client"');
  const j = admin.indexOf("await installerClient(r.organisation_id");
  assert.ok(i > 0 && j > i, "l'entreprise s'installe après la création du client");
  assert.match(admin, /id: "nc-modele"/);
  assert.match(admin, /id: "nc-devise", required: true/);
  // L'outil et la création d'entreprise par l'administratrice partagent la même source.
  assert.match(lire("src/gestion/js/etat.mjs"), /const depart = modele \? departModele\(modele, \{ nom, devise \}\) : null;/);
});

test("démo : l'éditeur crée une agence prête ; elle ne voit rien de la démo, la démo rien d'elle", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  globalThis.location = { origin: "http://localhost", pathname: "/gestion/", search: "?demo", hash: "" };
  try {
    const { creer } = await import("../src/gestion/js/store-local.mjs");
    const store = creer();
    const admin = store.utilisateursDemo().find((u) => u.super_admin);
    const editeur = store.utilisateursDemo().find((u) => u.plateforme);
    assert.ok(editeur, "un compte éditeur existe dans la démo");
    store.changerUtilisateurDemo(editeur.id);
    assert.equal((await store.charger()).entites.length, 0, "l'éditeur ne voit aucune entreprise");
    const r = await store.invitation({ action: "creer_client", organisation: "Agence Bleue", nom: "Lena", email: "lena@agence-bleue.test", fuseau: "Europe/Lisbon", langue: "en" });
    assert.ok(r.organisation_id && r.lien, JSON.stringify(r));
    const d = departModele("travel_planner", { nom: "Agence Bleue", devise: "EUR" });
    await store.installerEntreprise({ organisation: r.organisation_id, nom: "Agence Bleue", slug: "agence-bleue", ...d });
    await assert.rejects(store.installerEntreprise({ organisation: r.organisation_id, nom: "Encore", slug: "encore", ...d }), /déjà une entreprise/);
    assert.equal((await store.charger()).entites.length, 0, "après la mise en route, l'éditeur ne voit toujours rien");
    assert.equal((await store.charger()).organisations.length, 2, "il voit la liste des organisations");

    store.changerUtilisateurDemo(r.user_id);
    const lena = await store.charger();
    assert.deepEqual(lena.entites.map((e) => e.slug), ["agence-bleue"]);
    assert.equal(lena.reglages[lena.entites[0].id].devise, "EUR");
    assert.equal(lena.catalogue.length, 3);
    assert.equal(lena.roles.length, 3);
    assert.equal(lena.dossiers.length + lena.clients.length + lena.partenaires.length + lena.demandes_site.length, 0, "vide de toute donnée de la démo");
    assert.deepEqual(lena.organisations.map((o) => o.nom), ["Agence Bleue"]);
    assert.deepEqual(lena.profils.map((p) => p.email), ["lena@agence-bleue.test"]);

    store.changerUtilisateurDemo(admin.id);
    const demo = await store.charger();
    assert.ok(!demo.entites.some((e) => e.slug === "agence-bleue"), "l'administratrice de la démo ne voit pas l'agence");
    assert.ok(!demo.profils.some((p) => p.email === "lena@agence-bleue.test"));
    assert.equal(demo.organisations.length, 1);
  } finally {
    delete globalThis.localStorage;
    delete globalThis.location;
  }
});
