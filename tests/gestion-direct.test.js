// Gestion en direct (Jérémy, 19.11.2026) : une nouvelle demande du site et une nouvelle version de l'outil arrivent sans rafraîchir,
// et l'empreinte de version ne change qu'avec le contenu des fichiers de l'outil.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ecranDeLecture, momentDeRecharger, nouvellesDemandes, TABLES_EN_DIRECT, INACTIF_MS, CALME_MS } from "../src/gestion/js/direct-calc.mjs";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (f) => fs.readFileSync(path.join(RACINE, "src/gestion/js", f), "utf8");

test("écrans redessinés par la synchronisation : Demandes du site en fait partie, jamais un écran de saisie", () => {
  for (const h of ["", "#/", "#/demandes", "#/demandes?entite=e1", "#/dossiers", "#/dossier/abc-1", "#/dossier/abc-1?entite=e2", "#/client/x", "#/reservations?jour=2026-11-19"]) assert.ok(ecranDeLecture(h), h);
  for (const h of ["#/dossiers/nouveau", "#/reglages", "#/document/abc", "#/bandeau", "#/admin", "#/demandes/nouveau-x"]) assert.ok(!ecranDeLecture(h), h);
  assert.match(source("app.mjs"), /return ecranDeLecture\(location\.hash\) && !saisieEnCours\(\);/);
  assert.ok(!/const ECRANS_DE_LECTURE = /.test(source("app.mjs")), "une seule liste, celle de direct-calc.mjs");
});

test("rechargement d'une nouvelle version : jamais pendant une saisie, au premier moment sûr sinon", () => {
  assert.equal(momentDeRecharger({ nouvelle: false, cache: true }), false, "pas de nouvelle version, rien");
  assert.equal(momentDeRecharger({ nouvelle: true, saisie: true, cache: true, retour: true, inactifMs: 10 * INACTIF_MS }), false, "une saisie bloque tout");
  assert.equal(momentDeRecharger({ nouvelle: true, cache: true }), true, "onglet caché");
  assert.equal(momentDeRecharger({ nouvelle: true, retour: true }), true, "onglet revenu au premier plan");
  assert.equal(momentDeRecharger({ nouvelle: true, inactifMs: INACTIF_MS }), true, "inactif depuis une minute");
  assert.equal(momentDeRecharger({ nouvelle: true, inactifMs: 5000 }), false, "pendant qu'on travaille sans saisie, on attend");
  assert.equal(momentDeRecharger({ nouvelle: true, apresSaisie: true, inactifMs: CALME_MS }), true, "dès que la saisie est enregistrée ou abandonnée");
  assert.equal(momentDeRecharger({ nouvelle: true, apresSaisie: true, inactifMs: 500 }), false, "le temps de lire « enregistré »");
});

test("app.mjs : rechargement automatique câblé sur le moment sûr, écrans de saisie et garde des réglages compris, bouton gardé", () => {
  const app = source("app.mjs");
  assert.match(app, /const saisie = saisieEnCours\(\) \|\| !ecranDeLecture\(location\.hash\) \|\| !!\(etat\.garde && etat\.garde\(\)\);/);
  assert.match(app, /if \(ok\) location\.reload\(\);/, "location.reload garde l'adresse : l'écran et le dossier ouverts restent");
  assert.match(app, /setInterval\(\(\) => rechargerSiSur\(\), 2000\);/);
  assert.match(app, /if \(versionSignalee\) return void rechargerSiSur\(\{ retour \}\);/);
  assert.match(app, /if \(saisieEnCours\(\)\) \{\n\s+const \{ confirmer \} = await import\("\.\/ui\.mjs"\);/, "le bouton du bandeau demande toujours avant de perdre une saisie");
});

test("demandes du site en direct : Realtime sur demandes_site, compteur à chaque relecture, annonce des arrivées", () => {
  assert.deepEqual(TABLES_EN_DIRECT, ["demandes_site"]);
  const app = source("app.mjs");
  assert.match(app, /etat\.store\.ecouter\(TABLES_EN_DIRECT, changementDistant\)/);
  assert.match(app, /attente = setTimeout\(\(\) => \(\(derniere = 0\), actualiser\(true\)\), 800\);/, "plusieurs événements, une relecture");
  assert.match(app, /if \(etat\.session && document\.querySelector\("\.coque"\)\) majBadges\(\);/, "le compteur suit même sans redessiner");
  assert.equal(nouvellesDemandes(2, 3), 1);
  assert.equal(nouvellesDemandes(3, 2), 0);
  assert.equal(nouvellesDemandes(undefined, 1), 1);
});

test("store Supabase : un canal postgres_changes par table suivie, refait sans doublon", async () => {
  const canaux = [];
  const retires = [];
  const sb = {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    channel(nom) {
      const c = { nom, ecoutes: [], abonne: false, on(type, filtre, cb) { this.ecoutes.push({ type, filtre, cb }); return this; }, subscribe() { this.abonne = true; return this; } };
      canaux.push(c);
      return c;
    },
    removeChannel(c) { retires.push(c); },
  };
  const { creer } = await import("../src/gestion/js/store-supabase.mjs");
  const store = creer({}, { client: sb });
  const recus = [];
  store.ecouter(["demandes_site"], (t) => recus.push(t));
  assert.equal(canaux.length, 1);
  assert.deepEqual(canaux[0].ecoutes.map((e) => [e.type, e.filtre.schema, e.filtre.table, e.filtre.event]), [["postgres_changes", "public", "demandes_site", "*"]]);
  assert.ok(canaux[0].abonne);
  canaux[0].ecoutes[0].cb({ new: { id: "x", nom: "secret" } });
  assert.deepEqual(recus, ["demandes_site"], "seul le nom de la table remonte : l'outil relit avec ses droits");
  const arreter = store.ecouter(["demandes_site"], () => {});
  assert.equal(retires[0], canaux[0], "un second abonnement remplace le premier");
  arreter();
  assert.equal(retires[1], canaux[1]);
});

test("démo : une demande simulée prévient l'outil, qui relit et la montre sans rafraîchir", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?direct=${Date.now()}`);
    const store = creer();
    assert.equal(store.synchronisable, true);
    const m = await import("../src/gestion/js/etat.mjs");
    m.etat.store = store;
    const admin = store.utilisateursDemo()[0];
    m.etat.session = { id: admin.id, email: "admin@demo.local" };
    await m.recharger();
    const excursions = m.etat.brut.entites.find((e) => e.slug === "excursions");
    m.changerEntite(excursions.id, { naviguer: false });
    const avant = m.etat.db.demandes_site.length;
    let prevenu = 0;
    store.ecouter(["demandes_site"], () => prevenu++);
    await store.simulerDemandeSite(excursions.id);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(prevenu, 1, "l'outil est prévenu");
    assert.equal(await m.synchroniser(), "modifie", "la relecture voit la demande");
    assert.equal(m.etat.db.demandes_site.length, avant + 1);
    assert.equal(await m.synchroniser(), "inchange");
  } finally {
    delete globalThis.localStorage;
  }
});

test("synchroniser : une démo sans relecture (ancien magasin) reste ignorée", async () => {
  const m = await import("../src/gestion/js/etat.mjs");
  const garde = m.etat.store;
  m.etat.store = { mode: "demo", charger: async () => ({}) };
  assert.equal(await m.synchroniser(), "ignore");
  m.etat.store = garde;
});

test("empreinte de version : le contenu des fichiers de l'outil seulement, pas la date ni un fichier caché", () => {
  const eleventy = fs.readFileSync(path.join(RACINE, ".eleventy.js"), "utf8");
  assert.match(eleventy, /if \(n\.name\.startsWith\("\."\)\) continue;/);
  assert.ok(!/Date\.now|new Date|process\.env/.test(eleventy.slice(eleventy.indexOf("Identifiant de version"), eleventy.indexOf("return {", eleventy.indexOf("Identifiant de version")))), "rien qui change d'un build à l'autre");
  // Même calcul que le build, refait ici : le fichier publié (après npm run build) doit lui être égal.
  const racine = path.join(RACINE, "src/gestion");
  const fichiers = [];
  const parcourir = (d) => {
    for (const n of fs.readdirSync(d, { withFileTypes: true })) {
      if (n.name.startsWith(".")) continue;
      const p = path.join(d, n.name);
      if (n.isDirectory()) parcourir(p);
      else fichiers.push(p);
    }
  };
  parcourir(racine);
  const h = crypto.createHash("sha256");
  for (const f of fichiers.sort()) h.update(path.relative(racine, f)).update("\0").update(fs.readFileSync(f));
  const publie = path.join(RACINE, "_site/gestion/version.json");
  if (fs.existsSync(publie)) assert.equal(JSON.parse(fs.readFileSync(publie, "utf8")).version, h.digest("hex").slice(0, 16), "version.json = empreinte du contenu de src/gestion");
});

test("migration 47 : demandes_site dans la publication Realtime, protégée et rejouable", () => {
  const sql = fs.readFileSync(path.join(RACINE, "docs/gestion/migration-47-demandes-direct.sql"), "utf8");
  assert.match(sql, /if exists \(select 1 from pg_publication where pubname = 'supabase_realtime'\)/);
  assert.match(sql, /alter publication supabase_realtime add table public\.demandes_site;/);
  assert.ok(!/drop policy|create policy|grant /i.test(sql), "les droits RLS de la table ne changent pas");
  assert.match(fs.readFileSync(path.join(RACINE, "netlify.toml"), "utf8"), /connect-src [^"]*wss:\/\/lkxqcmzeidlyssoqmqkh\.supabase\.co/, "la page a le droit d'ouvrir la connexion Realtime");
});
