// Mise en route d'un client du logiciel (migration 45, 18.11.2026) : schéma neutre, données de départ par modèle métier,
// installation de la première entreprise par l'éditeur. La base est vérifiée par docs/gestion/verif-mise-en-route.mjs ;
// ici la source unique des données (modeles-metier.mjs), l'écran de l'éditeur et la démo, qui isole les organisations comme la base.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MODELES, departModele, catalogueModele, codeCourt } from "../src/gestion/js/modeles-metier.mjs";
import { TOUTES_PERMISSIONS } from "../src/gestion/js/defauts.mjs";
import { tauxVers, equivalents, lignesEquivalents } from "../src/gestion/js/calc.mjs";
import { lireDemande, premiereAdministratrice } from "../supabase/functions/invitation/calc.js";

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

test("taux de change : vides, base = devise du client, aucune conversion proposée tant qu'un taux manque", () => {
  const r = departModele("travel_planner", { nom: "X", devise: "EUR" }).reglages;
  assert.deepEqual(r.taux, { eur: null, thb: null }, "jamais les taux de ZTP (base CHF)");
  assert.equal(tauxVers(r, "EUR", "THB"), null, "la facture locale demande le taux à la main");
  assert.deepEqual(equivalents(1000, lignesEquivalents({ actif: true, eur: r.taux.eur, thb: r.taux.thb }, r.taux)), []);
  assert.deepEqual(equivalents(1000, lignesEquivalents({ actif: true, lignes: [{ code: "THB", taux: "" }] }, r.taux)), [], "éditeur : une ligne sans taux ne s'affiche pas");
});

test("invitation, reprendre_client : identifiant d'organisation contrôlé, lien pour la première administratrice", () => {
  const retour = "https://gestion.zwaldtravelplanner.com/";
  const origines = ["https://gestion.zwaldtravelplanner.com"];
  const org = "11111111-1111-4111-8111-111111111111";
  assert.equal(lireDemande({ action: "reprendre_client", organisation_id: "x", retour }, { origines }).erreur, "organisation_invalide");
  assert.equal(lireDemande({ action: "reprendre_client", organisation_id: org, retour: "https://pirate.com/" }, { origines }).erreur, "retour_refuse");
  assert.deepEqual(lireDemande({ action: "reprendre_client", organisation_id: org, retour }, { origines }), { ok: true, action: "reprendre_client", organisationId: org, retour });
  const profils = [
    { user_id: "b", email: "b@x.test", super_admin: true, actif: true, organisation_id: org, created_at: "2026-11-18T10:00:00Z" },
    { user_id: "a", email: "a@x.test", super_admin: true, actif: true, organisation_id: org, created_at: "2026-11-18T09:00:00Z" },
    { user_id: "c", email: "c@x.test", super_admin: false, actif: true, organisation_id: org, created_at: "2026-11-18T08:00:00Z" },
    { user_id: "z", email: "z@x.test", super_admin: true, actif: true, organisation_id: "autre", created_at: "2026-01-01T00:00:00Z" },
  ];
  assert.equal(premiereAdministratrice(profils, org).user_id, "a");
  assert.equal(premiereAdministratrice([], org), null);
  // Côté fonction : la règle « client neuf » est vérifiée par la base avec la session de l'éditeur, avant la clé de service.
  const src = lire("supabase/functions/invitation/index.ts");
  const bloc = src.slice(src.indexOf('lu.action === "reprendre_client"'));
  assert.ok(bloc.indexOf('sb.rpc("client_a_reprendre"') > 0 && bloc.indexOf('sb.rpc("client_a_reprendre"') < bloc.indexOf("SUPABASE_SERVICE_ROLE_KEY"));
  assert.match(bloc, /if \(neuf !== true\) return json\(\{ erreur: "client_en_service" \}, 409\);/);
});

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
    const clients = (await store.clientsPlateforme()).filter((o) => o.id !== editeur.organisation_id && o.nom !== "Organisation démo");
    assert.deepEqual(clients.map((o) => [o.nom, o.entreprises, o.neuve]), [["Agence Bleue", 1, true]]);
    const reprise = await store.invitation({ action: "reprendre_client", organisation_id: r.organisation_id });
    assert.ok(reprise.lien && reprise.email === "lena@agence-bleue.test", "nouveau lien pour Lena");

    store.changerUtilisateurDemo(r.user_id);
    const lena = await store.charger();
    assert.deepEqual(lena.entites.map((e) => e.slug), ["agence-bleue"]);
    assert.equal(lena.reglages[lena.entites[0].id].devise, "EUR");
    assert.equal(lena.catalogue.length, 3);
    assert.equal(lena.roles.length, 3);
    assert.deepEqual(lena.roles.map((r) => [r.systeme, r.tous_droits]), [[true, true], [false, false], [false, false]], "seul l'Administrateur est un rôle système");
    assert.equal(lena.dossiers.length + lena.clients.length + lena.partenaires.length + lena.demandes_site.length, 0, "vide de toute donnée de la démo");
    assert.deepEqual(lena.organisations.map((o) => o.nom), ["Agence Bleue"]);
    assert.deepEqual(lena.profils.map((p) => p.email), ["lena@agence-bleue.test"]);

    store.changerUtilisateurDemo(editeur.id);
    assert.equal((await store.invitation({ action: "reprendre_client", organisation_id: r.organisation_id })).erreur, "client_en_service", "Lena s'est connectée : plus de reprise");
    assert.equal((await store.clientsPlateforme()).find((o) => o.id === r.organisation_id).neuve, false);
    await assert.rejects(store.installerEntreprise({ organisation: r.organisation_id, nom: "Encore", slug: "encore", ...d }));
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
