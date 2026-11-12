// tests/gestion-nets-documents.test.js : les prix nets ne doivent jamais se retrouver dans le contenu stocké d'un devis ou d'une facture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { separerNets, fusionnerNets } from "../src/gestion/js/nets-documents.mjs";
import { creer } from "../src/gestion/js/store-supabase.mjs";

const contenu = () => ({ devise: "CHF", lignes: [{ id: "l1", kind: "ligne", libelle: "Bateau", unite: 100, qte: 2, net: 70, prestation_id: "p" }, { id: "l2", kind: "ligne", libelle: "Libre", montant: 50 }, { id: "l3", kind: "texte", libelle: "Note" }] });

test("separerNets : les nets sortent du contenu, par identifiant de ligne, le reste est intact", () => {
  const original = contenu();
  const { contenu: sans, nets } = separerNets(original);
  assert.deepEqual(nets, { l1: 70 });
  assert.ok(sans.lignes.every((l) => !("net" in l)));
  assert.equal(sans.lignes[0].unite, 100);
  assert.equal(sans.lignes[0].prestation_id, "p");
  assert.equal(sans.devise, "CHF");
  assert.equal(original.lignes[0].net, 70, "le contenu d'origine n'est pas modifié");
});

test("separerNets : un net absent, nul, non numérique ou sans ligne identifiable n'est pas gardé, mais jamais laissé dans le contenu", () => {
  const { contenu: sans, nets } = separerNets({ lignes: [{ id: "a", net: null }, { id: "b", net: "x" }, { net: 12 }, { id: "c", net: "45.5" }, { id: "d" }] });
  assert.deepEqual(nets, { c: 45.5 });
  assert.ok(sans.lignes.every((l) => !("net" in l)), "aucun net dans le contenu stocké");
  assert.deepEqual(separerNets(null), { contenu: null, nets: {} });
  assert.deepEqual(separerNets({ titre: "sans lignes" }), { contenu: { titre: "sans lignes" }, nets: {} });
});

test("fusionnerNets : remet les nets connus, ne touche pas aux autres lignes", () => {
  const { contenu: sans, nets } = separerNets(contenu());
  const complet = fusionnerNets(sans, nets);
  assert.equal(complet.lignes[0].net, 70);
  assert.ok(!("net" in complet.lignes[1]));
  assert.equal(fusionnerNets(sans, undefined), sans, "sans nets (pas le droit de les lire), le contenu reste tel quel");
});

// Base factice : assez de PostgREST pour les appels du magasin sur documents et documents_nets.
function faux({ droitNets = true, tableNets = true, coupures = 0 } = {}) {
  const tables = { documents: [], documents_nets: [], dossiers: [], paiements: [], dossiers_resume: [] };
  let n = 0;
  const erreurRls = { message: "new row violates row-level security policy" };
  const from = (nom) => {
    const e = { op: "select", filtres: [], payload: null, unique: false, peutManquer: false };
    const q = {
      select() { return q; },
      insert(p) { e.op = "insert"; e.payload = p; return q; },
      update(p) { e.op = "update"; e.payload = p; return q; },
      upsert(p) { e.op = "upsert"; e.payload = p; return q; },
      eq(k, v) { e.filtres.push((r) => r[k] === v); return q; },
      in(k, vs) { e.filtres.push((r) => vs.includes(r[k])); return q; },
      order() { return q; }, range() { return q; }, limit() { return q; },
      single() { e.unique = true; return q; },
      maybeSingle() { e.unique = true; e.peutManquer = true; return q; },
      then(ok, ko) { return Promise.resolve(executer()).then(ok, ko); },
    };
    function executer() {
      if (nom === "documents_nets") {
        // Coupure réseau sur les premiers appels : l'erreur ne dit pas que la table manque.
        if (coupures > 0) { coupures--; return { data: null, error: { message: "TypeError: Failed to fetch" } }; }
        if (!tableNets) return { data: null, error: { code: "42P01", message: 'relation "documents_nets" does not exist' } };
        if (!droitNets) return e.op === "select" ? { data: [], error: null } : { data: null, error: erreurRls };
      }
      const t = tables[nom];
      let sortie;
      if (e.op === "insert") { const r = { id: `d${++n}`, entite_id: "e1", ...e.payload, updated_at: `v${n}` }; t.push(r); sortie = [r]; }
      else if (e.op === "update") { sortie = t.filter((r) => e.filtres.every((f) => f(r))); sortie.forEach((r) => Object.assign(r, e.payload, { updated_at: `v${++n}` })); }
      else if (e.op === "upsert") {
        sortie = [].concat(e.payload).map((p) => { const cle = "document_id" in p ? "document_id" : "id"; const i = t.findIndex((r) => r[cle] === p[cle]); if (i >= 0) { Object.assign(t[i], p); return t[i]; } t.push({ ...p }); return t[t.length - 1]; });
      } else sortie = t.filter((r) => e.filtres.every((f) => f(r)));
      sortie = sortie.map((r) => structuredClone(r));
      if (e.unique) return { data: sortie[0] || null, error: sortie[0] || e.peutManquer ? null : { message: "no rows" } };
      return { data: sortie, error: null };
    }
    return q;
  };
  return { from, tables };
}

test("magasin : un devis écrit avec ses nets les range dans documents_nets, jamais dans le contenu stocké", async () => {
  const sb = faux();
  const store = creer({}, { client: sb });
  const doc = await store.inserer("documents", { dossier_id: "D", type: "devis", date_emission: "2026-11-01", contenu: contenu() });
  assert.ok(sb.tables.documents[0].contenu.lignes.every((l) => !("net" in l)), "rien de secret dans la ligne de documents");
  assert.deepEqual(sb.tables.documents_nets[0].nets, { l1: 70 });
  assert.equal(doc.contenu.lignes[0].net, 70, "l'outil récupère le net en mémoire");
  // modification du contenu
  const c = contenu();
  c.lignes[1].net = 33;
  const maj = await store.modifier("documents", doc.id, { contenu: c, date_emission: "2026-11-02" });
  assert.ok(sb.tables.documents[0].contenu.lignes.every((l) => !("net" in l)));
  assert.deepEqual(sb.tables.documents_nets[0].nets, { l1: 70, l2: 33 });
  assert.equal(maj.contenu.lignes[1].net, 33);
  // modification sans contenu (date d'envoi) : les nets reviennent en mémoire
  const envoye = await store.modifier("documents", doc.id, { envoye_le: "2026-11-03" });
  assert.equal(envoye.contenu.lignes[0].net, 70);
});

test("magasin : relecture d'un dossier ou d'une sauvegarde, les nets sont fusionnés pour qui y a droit", async () => {
  const sb = faux();
  const store = creer({}, { client: sb });
  const doc = await store.inserer("documents", { dossier_id: "D", type: "devis", date_emission: "2026-11-01", contenu: contenu() });
  const complet = await store.dossierComplet("D");
  assert.equal(complet.documents[0].contenu.lignes[0].net, 70);
  const tous = await store.tousDocuments("e1");
  assert.equal(tous[0].contenu.lignes[0].net, 70);
  assert.equal(doc.id, tous[0].id);
});

test("magasin : sans le droit « nets », rien n'est lu et rien n'est écrit dans documents_nets", async () => {
  const sb = faux({ droitNets: false });
  sb.tables.documents.push({ id: "d0", dossier_id: "D", entite_id: "e1", type: "devis", contenu: { lignes: [{ id: "l1", unite: 100, qte: 1 }] } });
  const store = creer({}, { client: sb });
  const complet = await store.dossierComplet("D");
  assert.ok(complet.documents[0].contenu.lignes.every((l) => !("net" in l)), "aucun net pour une personne qui n'y a pas droit");
  // elle enregistre le devis : pas de nets à écrire, donc aucun appel refusé, et les nets existants ne sont pas touchés
  const maj = await store.modifier("documents", "d0", { contenu: { lignes: [{ id: "l1", unite: 120, qte: 1 }] } });
  assert.equal(maj.contenu.lignes[0].unite, 120);
});

test("magasin : une sauvegarde importée range les nets à part", async () => {
  const sb = faux();
  const store = creer({}, { client: sb });
  await store.importer({ documents: [{ id: "dx", entite_id: "e1", dossier_id: "D", type: "devis", date_emission: "2026-11-01", contenu: contenu() }] });
  assert.ok(sb.tables.documents[0].contenu.lignes.every((l) => !("net" in l)), "pas de net dans le contenu importé");
  assert.deepEqual(sb.tables.documents_nets[0], { document_id: "dx", entite_id: "e1", nets: { l1: 70 } });
});

test("magasin : sans la migration 16, les nets ne sont JAMAIS écrits dans le contenu : l'enregistrement est refusé avec un message", async () => {
  const sb = faux({ tableNets: false });
  const store = creer({}, { client: sb });
  await assert.rejects(store.inserer("documents", { dossier_id: "D", type: "devis", date_emission: "2026-11-01", contenu: contenu() }), /migration 16/);
  assert.equal(sb.tables.documents.length, 0, "rien n'est écrit, donc aucun net lisible avec le seul droit finances");
  // Un document sans net s'enregistre normalement.
  await store.inserer("documents", { dossier_id: "D", type: "devis", date_emission: "2026-11-01", contenu: { lignes: [{ id: "l1", unite: 100, qte: 1 }] } });
  assert.equal(sb.tables.documents.length, 1);
});

test("magasin : une coupure au moment de détecter la table des nets ne fait plus écrire les nets dans le devis, et la détection est retentée", async () => {
  const sb = faux({ coupures: 1 });
  const store = creer({}, { client: sb });
  // Première tentative : la détection échoue (réseau). Rien n'est écrit, l'erreur remonte.
  await assert.rejects(store.inserer("documents", { dossier_id: "D", type: "devis", date_emission: "2026-11-01", contenu: contenu() }), /Failed to fetch/);
  assert.equal(sb.tables.documents.length, 0, "aucun net n'a été écrit dans le contenu pendant la coupure");
  // Deuxième tentative : la détection est refaite (l'échec n'est pas gardé toute la session) et les nets vont à part.
  await store.inserer("documents", { dossier_id: "D", type: "devis", date_emission: "2026-11-01", contenu: contenu() });
  assert.ok(sb.tables.documents[0].contenu.lignes.every((l) => !("net" in l)));
  assert.deepEqual(sb.tables.documents_nets[0].nets, { l1: 70 });
});

test("déconnexion : se déconnecter ne ferme que cet appareil, « tous les appareils » est un geste à part", async () => {
  const appels = [];
  const sb = { ...faux(), auth: { signOut: async (o) => { appels.push(o); return { error: null }; } } };
  const store = creer({}, { client: sb });
  await store.deconnecter();
  await store.deconnecterPartout();
  assert.deepEqual(appels, [{ scope: "local" }, { scope: "global" }]);
});

test("import : sans la table des nets, la sauvegarde qui en porte est refusée AVANT la première écriture (rien d'importé à moitié)", async () => {
  const sb = faux({ tableNets: false });
  const store = creer({}, { client: sb });
  await assert.rejects(store.importer({ clients: [{ id: "c1", entite_id: "e1", nom: "X" }], documents: [{ id: "dx", entite_id: "e1", dossier_id: "D", type: "devis", date_emission: "2026-11-01", contenu: contenu() }] }), /migration 16/);
  assert.equal(sb.tables.documents.length, 0);
});

test("déconnexion : une erreur renvoyée par signOut (réseau) est levée, pas avalée", async () => {
  const sb = { ...faux(), auth: { signOut: async () => ({ error: { message: "Failed to fetch" } }) } };
  const store = creer({}, { client: sb });
  await assert.rejects(store.deconnecterPartout(), /Failed to fetch/);
  await assert.rejects(store.deconnecter(), /Failed to fetch/);
});
