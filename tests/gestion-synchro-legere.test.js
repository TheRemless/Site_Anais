import test from "node:test";
import assert from "node:assert/strict";
import { creer } from "../src/gestion/js/store-supabase.mjs";

// Base factice : assez de PostgREST pour `charger()`. Elle note chaque lecture (table et genre : complète, comptage, dernier updated_at).
function faux() {
  const tables = {};
  const lectures = [];
  for (const t of ["entites", "profils", "roles", "membres", "clients", "dossiers", "catalogue", "partenaires", "partenaires_prives", "prestations", "prestations_nets", "trajets", "trajets_nets", "reservations", "reservations_nets", "dossiers_resume", "taches", "reglages"]) tables[t] = [];
  tables.partenaires = [{ id: "p1", nom: "A", updated_at: "2026-11-01T00:00:00Z" }];
  tables.prestations = [{ id: "s1", libelle: "X", updated_at: "2026-11-01T00:00:00Z" }, { id: "s2", libelle: "Y", updated_at: "2026-11-02T00:00:00Z" }];
  tables.prestations_nets = [{ id: "n1", prestation_id: "s1", net: 10 }];
  tables.trajets = [{ id: "t1" }];
  tables.trajets_nets = [];
  tables.partenaires_prives = [];
  tables.clients = [{ id: "c1", nom: "Client" }];
  const from = (nom) => {
    const e = { op: "select", head: false, colonnes: "*", tri: null, limite: null };
    const q = {
      select(colonnes = "*", opts = {}) { if (e.op === "select") { e.colonnes = colonnes; e.head = !!opts.head; } return q; },
      insert(p) { e.op = "insert"; e.p = p; return q; },
      update(p) { e.op = "update"; e.p = p; return q; },
      delete() { e.op = "delete"; return q; },
      eq() { return q; }, or() { return q; }, in() { return q; },
      order(k, o = {}) { e.tri = [k, o.ascending !== false]; return q; },
      range() { return q; },
      limit(n) { e.limite = n; return q; },
      single() { return q; },
      then(ok, ko) { return Promise.resolve(executer()).then(ok, ko); },
    };
    function executer() {
      const t = tables[nom] || [];
      if (e.op !== "select") { lectures.push({ table: nom, genre: e.op }); return { data: e.op === "insert" ? { id: "nouveau", ...e.p } : [], error: null }; }
      if (e.head) { lectures.push({ table: nom, genre: "comptage" }); return { data: null, count: t.length, error: null }; }
      if (e.colonnes === "updated_at" && !t.every((r) => "updated_at" in r)) { lectures.push({ table: nom, genre: "erreur" }); return { data: null, error: { code: "42703", message: `column ${nom}.updated_at does not exist` } }; }
      if (e.colonnes === "updated_at") { lectures.push({ table: nom, genre: "dernier" }); const tri = [...t].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))); return { data: tri.slice(0, e.limite || 1).map((r) => ({ updated_at: r.updated_at })), error: null }; }
      lectures.push({ table: nom, genre: "complete" });
      return { data: structuredClone(t), error: null };
    }
    return q;
  };
  return { from, tables, lectures };
}
const completes = (sb, table) => sb.lectures.filter((l) => l.table === table && l.genre === "complete").length;
const CATALOGUE = ["partenaires", "partenaires_prives", "prestations", "prestations_nets", "trajets", "trajets_nets"];

test("synchronisation : le premier chargement lit tout, le suivant ne relit pas le catalogue qui n'a pas changé", async () => {
  const sb = faux();
  let t = Date.parse("2026-11-12T10:00:00Z");
  const store = creer({}, { client: sb, maintenant: () => t });
  const premier = await store.charger();
  for (const c of CATALOGUE) assert.equal(completes(sb, c), 1, `${c} lu au premier chargement`);
  assert.equal(premier.prestations.length, 2);
  t += 60000;
  const second = await store.charger({ ancien: premier });
  for (const c of CATALOGUE) assert.equal(completes(sb, c), 1, `${c} pas relu (inchangé)`);
  assert.equal(completes(sb, "clients"), 2, "les données qui bougent sont relues à chaque synchronisation");
  assert.equal(completes(sb, "reservations"), 2);
  assert.strictEqual(second.prestations, premier.prestations, "le catalogue en mémoire est réutilisé tel quel");
  assert.equal(second.clients.length, 1);
});

test("synchronisation : un changement du catalogue fait par quelqu'un d'autre (ligne ajoutée, ligne modifiée) le fait relire", async () => {
  const sb = faux();
  let t = Date.parse("2026-11-12T10:00:00Z");
  const store = creer({}, { client: sb, maintenant: () => t });
  let brut = await store.charger();
  // Ajout d'une prestation ailleurs : le comptage change.
  sb.tables.prestations.push({ id: "s3", libelle: "Z", updated_at: "2026-11-12T10:00:30Z" });
  t += 60000;
  brut = await store.charger({ ancien: brut });
  assert.equal(completes(sb, "prestations"), 2);
  assert.equal(brut.prestations.length, 3);
  // Modification d'une prestation ailleurs : même nombre de lignes, updated_at plus récent.
  sb.tables.prestations[0].updated_at = "2026-11-12T10:01:30Z";
  sb.tables.prestations[0].libelle = "X modifié";
  t += 60000;
  brut = await store.charger({ ancien: brut });
  assert.equal(completes(sb, "prestations"), 3);
  assert.equal(brut.prestations[0].libelle, "X modifié");
  // Un changement dans une table du catalogue fait relire tout le catalogue d'un bloc (six tables, rarement modifiées).
  assert.equal(completes(sb, "trajets"), 3);
});

test("synchronisation : le catalogue est relu au plus tard après quinze minutes (nets modifiés ailleurs, sans date)", async () => {
  const sb = faux();
  let t = Date.parse("2026-11-12T10:00:00Z");
  const store = creer({}, { client: sb, maintenant: () => t });
  let brut = await store.charger();
  t += 14 * 60000;
  brut = await store.charger({ ancien: brut });
  assert.equal(completes(sb, "prestations_nets"), 1);
  sb.tables.prestations_nets[0].net = 99;
  t += 2 * 60000;
  brut = await store.charger({ ancien: brut });
  assert.equal(completes(sb, "prestations_nets"), 2, "relu après quinze minutes");
  assert.equal(brut.prestations_nets[0].net, 99);
});

test("synchronisation : une écriture faite ici dans le catalogue le fait relire tout de suite", async () => {
  const sb = faux();
  let t = Date.parse("2026-11-12T10:00:00Z");
  const store = creer({}, { client: sb, maintenant: () => t });
  let brut = await store.charger();
  await store.modifier("prestations", "s1", { libelle: "Nouveau nom" }).catch(() => {});
  t += 1000;
  brut = await store.charger({ ancien: brut });
  assert.equal(completes(sb, "prestations"), 2);
  await store.modifier("clients", "c1", { nom: "x" }).catch(() => {});
  t += 1000;
  await store.charger({ ancien: brut });
  assert.equal(completes(sb, "prestations"), 2, "une écriture hors catalogue ne force rien");
});

test("synchronisation : sans copie précédente (première ouverture) ou avec une copie incomplète, tout est lu ; les lectures partent en parallèle", async () => {
  const sb = faux();
  const store = creer({}, { client: sb });
  await store.charger({ ancien: { clients: [] } });
  for (const c of CATALOGUE) assert.equal(completes(sb, c), 1);
  // En parallèle : toutes les tables sont demandées avant que la première réponse ne soit attendue.
  let enVol = 0;
  let pic = 0;
  const from = sb.from;
  const lent = { ...sb, from: (nom) => { const q = from(nom); const then = q.then; q.then = (ok, ko) => { enVol++; pic = Math.max(pic, enVol); return new Promise((r) => setTimeout(r, 5)).then(() => then.call(q, ok, ko)).finally(() => enVol--).then(ok, ko); }; return q; } };
  await creer({}, { client: lent }).charger();
  assert.ok(pic >= 8, `au moins 8 lectures en même temps (${pic})`);
});

test("synchronisation : une table sans updated_at (trajets) ne fait jamais échouer la synchronisation ; une erreur de marqueur force la relecture", async () => {
  const sb = faux();
  let t = Date.parse("2026-11-12T10:00:00Z");
  const store = creer({}, { client: sb, maintenant: () => t });
  let brut = await store.charger();
  for (let i = 0; i < 3; i++) {
    t += 60000;
    brut = await store.charger({ ancien: brut });
  }
  assert.equal(completes(sb, "prestations"), 1, "le catalogue reste en mémoire d'une minute à l'autre");
  assert.ok(!sb.lectures.some((l) => l.table === "trajets" && l.genre === "dernier"), "pas de lecture de updated_at sur trajets");
  // Marqueur illisible (coupure, droit retiré) : on relit tout au lieu d'échouer.
  const cassee = { ...sb, from: (nom) => { const q = sb.from(nom); const then = q.then; q.then = (ok, ko) => then.call(q, (r) => ok(r), ko); return nom === "prestations" ? { ...q, select: (c, o) => (o && o.head ? { then: (ok) => ok({ error: { message: "Failed to fetch" } }) } : q.select(c, o)) } : q; } };
  const store2 = creer({}, { client: cassee, maintenant: () => t });
  const b2 = await store2.charger();
  t += 60000;
  await assert.doesNotReject(store2.charger({ ancien: b2 }));
});

test("synchronisation : si le résultat d'une lecture est écarté (écriture pendant la lecture), le catalogue sera relu à la suivante", async () => {
  const sb = faux();
  let t = Date.parse("2026-11-12T10:00:00Z");
  const store = creer({}, { client: sb, maintenant: () => t });
  const brut = await store.charger();
  sb.tables.prestations.push({ id: "s3", libelle: "Z", updated_at: "2026-11-12T10:00:30Z" });
  t += 60000;
  await store.charger({ ancien: brut }); // lu, mais la synchronisation l'écarte (retour « ignore »)
  store.annulerDerniereLecture();
  t += 60000;
  const apres = await store.charger({ ancien: brut });
  assert.equal(apres.prestations.length, 3, "le changement d'un autre n'est pas perdu parce qu'une lecture a été écartée");
});
