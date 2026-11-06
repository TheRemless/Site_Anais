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

test("synchroniser : un dossier dont le résumé a changé ailleurs perd ses copies locales, les autres les gardent", async () => {
  const lu = base();
  lu.dossiers = [{ id: "A", entite_id: "e1", client_id: "1", total: 1000, recu: 0, devise: "CHF", created_at: "1" }, { id: "B", entite_id: "e1", client_id: "1", total: 500, recu: 0, devise: "CHF", created_at: "2" }];
  const m = await demarrer(async () => structuredClone(lu));
  m.etat.brut.documents.push({ id: "dA", dossier_id: "A" }, { id: "dB", dossier_id: "B" });
  m.etat.brut.paiements.push({ id: "pA", dossier_id: "A" });
  // une autre personne enregistre un acompte sur A : le résumé de A change, celui de B non
  lu.dossiers[0] = { ...lu.dossiers[0], recu: 500 };
  assert.equal(await m.synchroniser(), "modifie");
  assert.deepEqual(m.etat.brut.documents.map((d) => d.id), ["dB"], "A est relu à son ouverture, B garde sa copie");
  assert.deepEqual(m.etat.brut.paiements, []);
  assert.equal(m.etat.brut.dossiers.find((d) => d.id === "A").recu, 500);
});

test("numeroSuivant : le numéro vient de la base, sinon le calcul local prend le relais", async () => {
  const m = await demarrer(async () => base());
  m.etat.store.prochainNumeroRef = async (entite, annee, minimum) => {
    assert.equal(entite, "e1");
    return minimum + 5;
  };
  assert.equal(await m.numeroSuivant(2026, 10), 15, "la base peut avoir donné des numéros que la personne ne voit pas");
  m.etat.store.prochainNumeroRef = async () => { throw new Error("function prochain_numero_ref does not exist"); };
  assert.equal(await m.numeroSuivant(2026, 10), 11, "sans la migration 14, on garde le calcul local");
  m.etat.store.prochainNumeroRef = async () => 3;
  assert.equal(await m.numeroSuivant(2026, 10), 11, "un numéro incohérent est ignoré");
});

test("modifier avec verrou : la version lue part avec l'écriture, un conflit remonte à l'appelant", async () => {
  const lu = base();
  lu.clients = [{ ...client("1", "Anna"), updated_at: "2026-11-06T10:00:00.000001+00:00" }];
  const m = await demarrer(async () => structuredClone(lu));
  const recus = [];
  m.etat.store.modifier = async (table, id, patch, avant) => {
    recus.push(avant);
    if (avant && avant !== "2026-11-06T10:00:00.000001+00:00") { const e = new Error("conflit"); e.conflit = true; throw e; }
    return { ...client("1", patch.nom || "Anna"), updated_at: "2026-11-06T10:05:00.000002+00:00" };
  };
  await m.modifier("clients", "1", { nom: "Anne" }, { verrou: true });
  assert.deepEqual(recus, ["2026-11-06T10:00:00.000001+00:00"], "la version lue sert de référence");
  assert.equal(m.etat.db.clients[0].updated_at, "2026-11-06T10:05:00.000002+00:00", "la nouvelle version devient la référence");
  await m.modifier("clients", "1", { nom: "Anna" });
  assert.equal(recus[1], undefined, "sans verrou, rien n'est vérifié");
  // quelqu'un d'autre enregistre entre-temps : la version qu'on croit connaître est périmée
  m.etat.brut.clients[0].updated_at = "2026-11-06T09:00:00+00:00";
  await assert.rejects(m.modifier("clients", "1", { nom: "Zoé" }, { verrou: true }), (e) => e.conflit === true);
  assert.equal(m.etat.db.clients[0].nom, "Anna", "un enregistrement refusé ne change pas la copie en mémoire");
});

test("modifier : une ligne retirée de la mémoire pendant l'attente est remise, sans propriété parasite", async () => {
  const lu = base();
  lu.clients = [client("1", "Anna")];
  const m = await demarrer(async () => structuredClone(lu));
  m.etat.store.modifier = async () => {
    m.etat.brut.clients = []; // une relecture a vidé la liste pendant l'écriture
    return client("1", "Anne");
  };
  await m.modifier("clients", "1", { nom: "Anne" });
  assert.deepEqual(m.etat.brut.clients.map((c) => c.nom), ["Anne"]);
  assert.equal(Object.keys(m.etat.brut.clients).length, 1, "aucune clé « -1 »");
});

test("synchroniser : le document en cours d'édition garde sa copie même si le résumé du dossier change", async () => {
  const lu = base();
  lu.dossiers = [{ id: "A", entite_id: "e1", client_id: "1", total: 1000, recu: 0, devise: "CHF", created_at: "1" }];
  const m = await demarrer(async () => structuredClone(lu));
  m.etat.brut.documents.push({ id: "dEdite", dossier_id: "A" }, { id: "dAutre", dossier_id: "A" });
  m.etat.documentsOuverts.add("dEdite");
  lu.dossiers[0] = { ...lu.dossiers[0], recu: 400 };
  assert.equal(await m.synchroniser(), "modifie");
  assert.deepEqual(m.etat.brut.documents.map((d) => d.id), ["dEdite"], "l'éditeur garde son document, les autres sont relus à l'ouverture");
  m.etat.documentsOuverts.delete("dEdite");
});

test("enregistrerReglages : la version lue à l'ouverture de l'écran sert de référence", async () => {
  const lu = base();
  lu.reglages = { e1: { devise: "CHF" } };
  lu.reglages_maj = { e1: "v1" };
  const m = await demarrer(async () => structuredClone(lu));
  const recus = [];
  m.etat.store.enregistrerReglages = async (entite, valeur, avant) => (recus.push(avant), "v3");
  m.etat.brut.reglages_maj.e1 = "v2"; // la synchronisation a apporté la version d'une autre personne
  await m.enregistrerReglages({ devise: "EUR" }, "v1");
  assert.deepEqual(recus, ["v1"], "c'est la version que la personne a vue, pas la plus récente en mémoire");
  assert.equal(m.etat.brut.reglages_maj.e1, "v3");
  await m.enregistrerReglages({ devise: "USD" });
  assert.equal(recus[1], "v3", "sans version lue, la version courante sert de référence");
});
