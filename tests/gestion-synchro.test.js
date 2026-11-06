// tests/gestion-synchro.test.js : relecture silencieuse de la base pour voir ce que font les autres personnes.
import { test } from "node:test";
import assert from "node:assert/strict";

const TABLES = ["clients", "dossiers", "documents", "paiements", "catalogue", "taches", "partenaires", "partenaires_prives", "prestations", "prestations_nets", "trajets", "trajets_nets", "reservations", "reservations_nets"];
const base = () => ({
  entites: [{ id: "e1", nom: "Agence", actif: true, ordre: 0 }],
  profils: [{ user_id: "u1", email: "a@b.c", super_admin: true, actif: true }],
  roles: [],
  membres: [],
  reglages: {},
  ...Object.fromEntries(TABLES.map((t) => [t, []])),
});
const client = (id, nom) => ({ id, entite_id: "e1", nom, prenom: "", created_at: id });

async function demarrer(charger) {
  const m = await import("../src/gestion/js/etat.mjs");
  m.etat.store = { mode: "supabase", charger };
  m.etat.session = { id: "u1", email: "a@b.c" };
  await m.recharger();
  return m;
}

test("synchroniser : rien de changé, rien à redessiner", async () => {
  const m = await demarrer(async () => base());
  assert.equal(await m.synchroniser(), "inchange");
});

test("synchroniser : un client créé par une autre personne arrive, l'ordre des lignes ne compte pas", async () => {
  let lu = base();
  lu.clients = [client("1", "Anna"), client("2", "Ben")];
  const m = await demarrer(async () => structuredClone(lu));
  lu.clients = [client("2", "Ben"), client("1", "Anna")];
  assert.equal(await m.synchroniser(), "inchange", "même contenu dans un autre ordre");
  lu.clients.push(client("3", "Carla"));
  assert.equal(await m.synchroniser(), "modifie");
  assert.deepEqual(m.etat.db.clients.map((c) => c.nom).sort(), ["Anna", "Ben", "Carla"]);
  assert.equal(await m.synchroniser(), "inchange", "la lecture suivante ne change plus rien");
});

test("synchroniser : documents et paiements déjà ouverts sont gardés", async () => {
  const m = await demarrer(async () => base());
  m.etat.brut.documents.push({ id: "d1", dossier_id: "x" });
  m.etat.brut.paiements.push({ id: "p1", dossier_id: "x" });
  const lu = base();
  lu.clients.push(client("9", "Dora"));
  m.etat.store.charger = async () => structuredClone(lu);
  assert.equal(await m.synchroniser(), "modifie");
  assert.deepEqual(m.etat.brut.documents.map((d) => d.id), ["d1"]);
  assert.deepEqual(m.etat.brut.paiements.map((p) => p.id), ["p1"]);
});

test("synchroniser : nos propres écritures ne sont pas annoncées comme venant d'ailleurs", async () => {
  const lu = base();
  const m = await demarrer(async () => structuredClone(lu));
  m.etat.store.inserer = async (table, row) => ({ ...row, id: "10", created_at: "10" });
  await m.inserer("clients", { nom: "Eva", prenom: "" });
  lu.clients.push({ id: "10", entite_id: "e1", nom: "Eva", prenom: "", created_at: "10" });
  assert.equal(await m.synchroniser(), "propre");
  assert.equal(await m.synchroniser(), "inchange");
});

test("synchroniser : une lecture n'écrase pas une écriture en cours ni une écriture arrivée pendant la lecture", async () => {
  const m = await demarrer(async () => base());
  let fin;
  m.etat.store.inserer = () => new Promise((ok) => (fin = () => ok({ id: "11", entite_id: "e1", nom: "Félix", prenom: "", created_at: "11" })));
  const ecriture = m.inserer("clients", { nom: "Félix", prenom: "" });
  assert.equal(await m.synchroniser(), "ignore", "pas de lecture pendant une écriture");
  fin();
  await ecriture;
  // une écriture qui se termine pendant la lecture rend cette lecture caduque
  m.etat.store.charger = async () => {
    m.etat.store.inserer = async () => ({ id: "12", entite_id: "e1", nom: "Gina", prenom: "", created_at: "12" });
    await m.inserer("clients", { nom: "Gina", prenom: "" });
    return base();
  };
  assert.equal(await m.synchroniser(), "ignore");
  assert.ok(m.etat.db.clients.some((c) => c.nom === "Gina"), "la ligne écrite reste visible");
});

test("synchroniser : la démo n'a personne avec qui se synchroniser", async () => {
  const m = await demarrer(async () => base());
  m.etat.store.mode = "demo";
  assert.equal(await m.synchroniser(), "ignore");
});
