// tests/gestion-carnet.test.js : « Carnet envoyé » fixe l'échéance du solde ; sans carnet, l'ancienne règle des 30 jours reste.
const test = require("node:test");
const assert = require("node:assert/strict");
const calc = () => import("../src/gestion/js/calc.mjs");
const carnet = () => import("../src/gestion/js/carnet-calc.mjs");

const reglages = { conditions: { acompte_pct: 50, relance_jours: 7, delai_jours: 10 }, devise: "CHF" };
const AUJOURDHUI = "2026-11-12";
// Dossier en statut « acompte » : 1000 de total, 500 reçus, départ le 2026-12-20 (38 jours) par défaut.
const resumeAcompte = async (dossier) => {
  const { resume } = await calc();
  const d = { id: "d1", client_id: "c1", annule: false, accepte_le: "2026-10-01", date_depart: "2026-12-20", ...dossier };
  const db = {
    clients: [{ id: "c1", nom: "Keller" }],
    documents: [{ id: "x1", dossier_id: "d1", type: "devis", envoye_le: "2026-09-25", date_emission: "2026-09-25", created_at: "2026-09-25", contenu: { devise: "CHF", lignes: [{ kind: "ligne", unite: 1000, qte: 1 }] } }],
    paiements: [{ id: "p1", dossier_id: "d1", montant: 500, date: "2026-10-05" }],
  };
  return resume(d, db, reglages);
};

test("sans carnet : l'échéance du solde est 30 jours avant le départ", async () => {
  const { echeanceSolde } = await calc();
  assert.deepEqual(echeanceSolde({ date_depart: "2026-12-20" }), { date: "2026-11-20", source: "depart" });
  assert.equal(echeanceSolde({}), null);
});

test("avec carnet envoyé : l'échéance du solde est la date d'envoi", async () => {
  const { echeanceSolde } = await calc();
  assert.deepEqual(echeanceSolde({ date_depart: "2026-12-20", carnet_envoye_le: "2026-11-10" }), { date: "2026-11-10", source: "carnet" });
});

test("ancienne règle inchangée : départ dans plus de 30 jours, rien dans « À faire »", async () => {
  const { aFaire } = await calc();
  const r = await resumeAcompte({});
  assert.equal(r.statut, "acompte");
  assert.deepEqual(aFaire([r], AUJOURDHUI, reglages), []);
});

test("ancienne règle inchangée : départ dans 18 jours, « solde proche »", async () => {
  const { aFaire } = await calc();
  const r = await resumeAcompte({ date_depart: "2026-11-30" });
  const items = aFaire([r], AUJOURDHUI, reglages);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "solde_proche");
  assert.equal(items[0].jours, 18);
});

test("carnet envoyé : le solde est dû tout de suite, même si le départ est loin", async () => {
  const { aFaire } = await calc();
  const r = await resumeAcompte({ carnet_envoye_le: "2026-11-09" });
  const items = aFaire([r], AUJOURDHUI, reglages);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "solde_du");
  assert.equal(items[0].jours, 3);
});

test("carnet envoyé aujourd'hui : dû aujourd'hui (0 jour)", async () => {
  const { aFaire } = await calc();
  const items = aFaire([await resumeAcompte({ carnet_envoye_le: AUJOURDHUI })], AUJOURDHUI, reglages);
  assert.deepEqual(items.map((i) => [i.type, i.jours]), [["solde_du", 0]]);
});

test("une date de carnet à venir (faute de frappe) ne fait pas taire l'ancienne règle", async () => {
  const { aFaire } = await calc();
  const items = aFaire([await resumeAcompte({ date_depart: "2026-11-30", carnet_envoye_le: "2027-01-01" })], AUJOURDHUI, reglages);
  assert.deepEqual(items.map((i) => i.type), ["solde_proche"]);
});

test("solde payé : plus rien à faire, carnet ou non", async () => {
  const { aFaire, resume } = await calc();
  const d = { id: "d1", client_id: "c1", annule: false, accepte_le: "2026-10-01", date_depart: "2026-11-30", carnet_envoye_le: "2026-11-09" };
  const db = {
    clients: [{ id: "c1", nom: "Keller" }],
    documents: [{ id: "x1", dossier_id: "d1", type: "devis", envoye_le: "2026-09-25", date_emission: "2026-09-25", created_at: "2026-09-25", contenu: { devise: "CHF", lignes: [{ kind: "ligne", unite: 1000, qte: 1 }] } }],
    paiements: [{ id: "p1", dossier_id: "d1", montant: 1000, date: "2026-10-05" }],
  };
  const r = resume(d, db, reglages);
  assert.equal(r.statut, "solde");
  assert.deepEqual(aFaire([r], AUJOURDHUI, reglages), []);
});

test("dossier annulé : pas de solde dû", async () => {
  const { aFaire } = await calc();
  assert.deepEqual(aFaire([await resumeAcompte({ annule: true, carnet_envoye_le: "2026-11-09" })], AUJOURDHUI, reglages), []);
});

test("peutNoter : seulement un dossier accepté ou avec acompte qui a un solde à régler", async () => {
  const { peutNoter } = await carnet();
  assert.equal(peutNoter({ statut: "acompte", total: 1000, reste: 500 }), true);
  assert.equal(peutNoter({ statut: "accepte", total: 1000, reste: 1000 }), true);
  assert.equal(peutNoter({ statut: "solde", total: 1000, reste: 0 }), false);
  assert.equal(peutNoter({ statut: "sur_place", total: 0, reste: 0 }), false);
  assert.equal(peutNoter({ statut: "devis_envoye", total: 1000, reste: 1000 }), false);
  assert.equal(peutNoter({ statut: "acompte", total: 1000, reste: 500, annule: true }), false);
});

test("dateValide : une vraie date, jamais dans le futur", async () => {
  const { dateValide } = await carnet();
  assert.equal(dateValide("2026-11-12", AUJOURDHUI), true);
  assert.equal(dateValide("2026-11-13", AUJOURDHUI), false);
  assert.equal(dateValide("2026-02-30", AUJOURDHUI), false);
  assert.equal(dateValide("1999-12-31", AUJOURDHUI), false);
  assert.equal(dateValide("", AUJOURDHUI), false);
  assert.equal(dateValide("12/11/2026", AUJOURDHUI), false);
});

test("disponible : sur la base distante, seulement quand la colonne existe (migration 26 appliquée)", async () => {
  const { disponible, valeursCarnet, valeursRetirer } = await carnet();
  assert.equal(disponible({ id: "d" }, true), false);
  assert.equal(disponible({ id: "d", carnet_envoye_le: null }, true), true);
  assert.equal(disponible({ id: "d" }, false), true);
  assert.deepEqual(valeursCarnet("2026-11-12"), { carnet_envoye_le: "2026-11-12" });
  assert.deepEqual(valeursRetirer(), { carnet_envoye_le: null });
});
