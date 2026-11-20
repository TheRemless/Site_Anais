// « Coller une confirmation » : retrouver la fiche d'un client par son nom (bug remonté par Jérémy le 18.11.2026 : un client ZTP collé n'était
// pas reconnu). Nom collé seul, recherche pendant la frappe, correspondance plus souple, recherche manuelle, et le super administrateur.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lireConfirmation, ressembleANom, clientsCandidats, rangNom, chercherFiches } from "../src/gestion/js/confirmation-calc.mjs";

const AJD = "2026-11-18";
const lire = (f) => readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");

test("1. un nom collé seul, ou une première ligne utile qui ressemble à un nom, devient le nom du client", () => {
  assert.equal(lireConfirmation("Julien Rochat", { aujourdhui: AJD }).valeurs.nom, "Julien Rochat");
  assert.equal(lireConfirmation("   Julien Rochat  \n\n", { aujourdhui: AJD }).valeurs.nom, "Julien Rochat");
  const r = lireConfirmation("SECRET TRAVEL & TOUR\nJulien Rochat\nDate: 22/11/2026\nPrice: 500 THB", { aujourdhui: AJD });
  assert.equal(r.valeurs.nom, "Julien Rochat", "après la ligne de marque");
  assert.deepEqual(r.ignorees, [], "la ligne n'est plus montrée comme non lue");
  // « Name: » reste prioritaire ; une salutation, un chiffre, un « : » ou une ligne après un libellé ne deviennent jamais un nom.
  assert.equal(lireConfirmation("Julien Rochat\nName: Emma Wilson", { aujourdhui: AJD }).valeurs.nom, "Emma Wilson");
  for (const t of ["Hello\nDate: 22/11", "Hi Jeremy\nDate: 22/11", "Room 24\nDate: 22/11", "Booking confirmed"]) assert.equal(lireConfirmation(t, { aujourdhui: AJD }).valeurs.nom, "", t);
  assert.equal(lireConfirmation("Pick-up: Hotel\nJulien Rochat", { aujourdhui: AJD }).valeurs.nom, "", "pas la première ligne utile");
  assert.equal(ressembleANom("Anne-Sophie O'Neil"), true);
  assert.equal(ressembleANom("Mr. Varrin"), true);
  assert.equal(ressembleANom("VIP TAXI LANTA"), false, "une ligne de marque n'est pas un nom");
});

const fiches = [
  { id: "Z1", entite_id: "ZTP", prenom: "Julien", nom: "Rochat", telephone: "+41 79 000 00 02", created_at: "2026-01-01" },
  { id: "Z2", entite_id: "ZTP", prenom: "Juliette", nom: "Roux", telephone: "+41 79 000 00 05", created_at: "2026-03-01" },
  { id: "Z3", entite_id: "ZTP", prenom: "Jean", nom: "Varrin", telephone: "", created_at: "2026-02-01" },
  { id: "T1", entite_id: "TAX", prenom: "", nom: "Rochat", telephone: "", created_at: "2026-04-01" },
];

test("3. sans WhatsApp, correspondance plus souple : nom complet d'abord, puis nom de famille seul, puis tous les mots de 3 lettres au moins", () => {
  const ids = (nom) => clientsCandidats({ nom, propres: fiches.filter((c) => c.entite_id === "TAX"), partages: fiches.filter((c) => c.entite_id === "ZTP") }).parNom.map((c) => c.id);
  assert.deepEqual(ids("Julien Rochat"), ["Z1", "T1"], "nom complet identique en premier, puis le même nom de famille");
  assert.deepEqual(ids("Rochat Julien"), ["Z1", "T1"]);
  assert.deepEqual(ids("Rochat"), ["T1", "Z1"], "nom de famille seul : les deux, la plus récente d'abord");
  assert.deepEqual(ids("Julien"), ["Z1"], "prénom seul (le cas « Name: Julien »)");
  assert.deepEqual(ids("julie"), ["Z2", "Z1"], "sans accents ni casse, mots retrouvés");
  assert.deepEqual(ids("Mr Varrin"), ["Z3"], "« Mr » (moins de 3 lettres) ne compte pas");
  assert.deepEqual(ids("J. R."), [], "aucun mot de 3 lettres : rien");
  assert.deepEqual(ids("Nobody"), []);
  assert.equal(rangNom("JULIEN ROCHAT", fiches[0]), 0);
  assert.equal(rangNom("rochat", fiches[0]), 1);
  assert.equal(rangNom("Roch", fiches[0]), 2);
  // 5 propositions au plus, aucune présélection (parTelephone reste vide sans numéro commun).
  const beaucoup = Array.from({ length: 9 }, (_, i) => ({ id: `R${i}`, prenom: `Anna${i}`, nom: "Rochat", created_at: `2026-0${(i % 9) + 1}-01` }));
  const r = clientsCandidats({ nom: "Rochat", partages: beaucoup });
  assert.equal(r.parNom.length, 5);
  assert.equal(r.parTelephone, null);
});

test("4. « Chercher un client existant » : par nom ou par WhatsApp, dans les fiches de l'entreprise et les fiches partagées", () => {
  const propres = fiches.filter((c) => c.entite_id === "TAX");
  const partages = fiches.filter((c) => c.entite_id === "ZTP");
  assert.deepEqual(chercherFiches({ q: "roch", propres, partages }).map((c) => c.id), ["T1", "Z1"]);
  assert.deepEqual(chercherFiches({ q: "Julien Rochat", propres, partages }).map((c) => c.id), ["Z1", "T1"]);
  assert.deepEqual(chercherFiches({ q: "0002", propres, partages }).map((c) => c.id), ["Z1"], "4 chiffres : le WhatsApp");
  assert.deepEqual(chercherFiches({ q: "+41 79 000 00 05", propres, partages }).map((c) => c.id), ["Z2"]);
  assert.deepEqual(chercherFiches({ q: "x", propres, partages }), [], "moins de 2 caractères : rien");
  // L'écran cherche dans les mêmes sources que les propositions : la fiche de l'entreprise et clientsPartages (règle d'accès de la PR 234).
  const ecran = lire("views/confirmation.mjs");
  assert.match(ecran, /const sources = id \? \{ propres: etat\.brut\.clients\.filter\(\(c\) => c\.entite_id === id && !c\.nom_seul\), partages: clientsPartages\(id\)/);
  assert.match(ecran, /chercherFiches\(\{ q, \.\.\.sources \}\)/);
  assert.match(ecran, /trouvees\.map\(\(c\) => ligneClient\(c, id, false\)\)/, "résultats de recherche jamais cochés d'office");
});

test("2. la recherche des fiches se relance pendant la frappe (nom, WhatsApp, recherche), avec un léger délai, et garde le choix fait", () => {
  const ecran = lire("views/confirmation.mjs");
  assert.match(ecran, /for \(const c of \[champs\.nom, champs\.telephone, recherche\]\) c\.addEventListener\("input", relancer\);/);
  assert.match(ecran, /attenteClient = setTimeout\(dessinerClient, 250\)/);
  assert.match(ecran, /const avant = choixClient\(\);/);
  assert.match(ecran, /recherche\.value = "";\n\s+dessinerEntreprises\(lu\.marque\);/, "un nouveau collage efface la recherche d'avant");
  assert.match(ecran, /if \(fichesAffichees && !choixClient\(\)\)/, "création refusée tant qu'une fiche proposée n'est ni choisie ni écartée");
});

test("5. super administrateur sans rôle de membre (Jérémy en production) : il voit et choisit les fiches ZTP partagées", async () => {
  const { permissionsDans } = await import("../src/gestion/js/droits.mjs");
  const { peutUtiliserPartages } = await import("../src/gestion/js/partage-clients-calc.mjs");
  const profil = { user_id: "J", super_admin: true, actif: true };
  const ctx = { profil, membres: [], roles: [] };
  assert.ok(permissionsDans(ctx, "TAX").includes("dossiers.ecrire"), "tous les droits sans rôle");
  assert.ok(peutUtiliserPartages({ superAdmin: true, permissionsSource: permissionsDans(ctx, "ZTP"), permissionsCible: permissionsDans(ctx, "TAX"), voitToutSource: true }));
  // Par la vraie couche d'état, sur la démo : l'administratrice de démo est super administratrice et n'a aucun rôle de membre.
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  globalThis.location = { origin: "http://localhost", pathname: "/gestion/", search: "?demo", hash: "" };
  try {
    const { creer } = await import("../src/gestion/js/store-local.mjs");
    const prep = creer();
    const brut = await prep.charger();
    const admin = brut.profils.find((p) => p.super_admin);
    assert.ok(admin, "administratrice de démo super administratrice");
    prep.changerUtilisateurDemo(admin.user_id); // enregistre la démo : etat.mjs relit les mêmes données
    assert.equal(brut.membres.filter((m) => m.user_id === admin.user_id).length, 0, "sans rôle de membre, comme Jérémy");
    const taxi = brut.entites.find((e) => e.slug === "taxi");
    const agence = brut.entites.find((e) => e.slug === "agence");
    stockage.set("gestion-zwald-entite", agence.id);
    const E = await import("../src/gestion/js/etat.mjs");
    await E.init();
    assert.ok(E.partageClientsPermis(agence.id, taxi.id));
    const partagees = E.clientsPartages(taxi.id);
    const rochat = partagees.find((c) => c.prenom === "Julien" && c.nom === "Rochat");
    assert.ok(rochat, "Julien Rochat (fiche de l'agence) proposé dans Taxi");
    assert.equal(clientsCandidats({ nom: "Julien", partages: partagees }).parNom[0].id, rochat.id);
  } finally {
    delete globalThis.localStorage;
    delete globalThis.location;
  }
});

// ---- Nouvelle version de Gestion (18.11.2026) -------------------------------------------------------------------------------------
// Cause probable du « Béatrice Monate » sans proposition : un onglet ouvert avant la PR 235 gardait l'ancien code, et rien ne le disait,
// parce que seul app.mjs était surveillé et que la PR 235 ne le touchait pas.
test("version : une empreinte de tous les fichiers de Gestion est écrite au build, et tout changement l'altère", async () => {
  const { existsSync } = await import("node:fs");
  const config = readFileSync(new URL("../.eleventy.js", import.meta.url), "utf8");
  assert.match(config, /eleventyConfig\.on\("eleventy\.after"/);
  assert.match(config, /empreinteGestion\(path\.join\(__dirname, "src\/gestion"\)\)/, "tous les fichiers de l'outil, pas seulement app.mjs (calcul dans scripts/empreinte-gestion.cjs)");
  assert.match(config, /"version\.json"/);
  // Le build (npm run build, avant npm test) l'a produite.
  const fichier = new URL("../_site/gestion/version.json", import.meta.url);
  assert.ok(existsSync(fichier), "_site/gestion/version.json absent : lancer le build avant les tests");
  assert.match(JSON.parse(readFileSync(fichier, "utf8")).version, /^[0-9a-f]{16}$/);
});

test("version : vérifiée au retour sur l'onglet et toutes les 3 minutes ; recharger ne perd jamais une saisie", () => {
  const app = lire("app.mjs");
  assert.match(app, /const r = await fetch\("version\.json", \{ cache: "no-store" \}\);/);
  assert.match(app, /setInterval\(verifier, 3 \* 60 \* 1000\)/);
  assert.match(app, /actuelle\.startsWith\("v:"\) === empreinteInitiale\.startsWith\("v:"\)/, "jamais un ETag comparé à une version");
  assert.match(app, /document\.addEventListener\("visibilitychange", verifier\);/);
  // Le bandeau ne recharge pas d'office : avec une saisie en cours, il demande d'abord.
  assert.match(app, /if \(!rienAPerdre\(\) && !\(await confirmer\(/);
  assert.match(app, /tr\(\"Plus tard\"\)\)\)\) return;\n\s+\} catch \(err\) \{\n\s+console\.error\(err\);\n\s+\}\n\s+location\.reload\(\);/);
  // Depuis le 19.11.2026, le rechargement automatique passe seulement par rechargerSiSur (jamais pendant une saisie, voir gestion-direct.test.js).
  assert.doesNotMatch(app.slice(app.indexOf("function signalerVersion"), app.indexOf("async function surveillerVersion")), /setTimeout\([^)]*location\.reload/, "aucun rechargement à l'aveugle");
  assert.match(app, /if \(ok\) location\.reload\(\);/, "le rechargement automatique est celui du moment sûr");
});
