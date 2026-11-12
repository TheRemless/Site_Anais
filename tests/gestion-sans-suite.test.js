// tests/gestion-sans-suite.test.js : devis « sans suite » (statut, relances, motifs, disponibilité, réversibilité).
const test = require("node:test");
const assert = require("node:assert/strict");
const calc = () => import("../src/gestion/js/calc.mjs");
const ss = () => import("../src/gestion/js/sans-suite-calc.mjs");
const suite = () => import("../src/gestion/js/dossier-resume-calc.mjs");

const reglages = { conditions: { acompte_pct: 50, relance_jours: 7 }, devise: "CHF" };
const client = { id: "c1", prenom: "Anna", nom: "Keller" };
// Un dossier avec un devis envoyé il y a `jours` jours et le total donné, sans paiement.
const base = (dossier, { jours = 40, paiements = [] } = {}) => {
  const envoye = new Date(Date.parse("2026-11-12") - jours * 86400000).toISOString().slice(0, 10);
  return {
    clients: [client],
    documents: [{ id: "x1", dossier_id: "d1", type: "devis", envoye_le: envoye, date_emission: envoye, created_at: envoye, contenu: { devise: "CHF", lignes: [{ kind: "ligne", unite: 1000, qte: 1 }] } }],
    paiements,
    dossier: { id: "d1", client_id: "c1", annule: false, accepte_le: null, ...dossier },
  };
};
const resumeDe = async (o) => {
  const { resume } = await calc();
  return resume(o.dossier, { clients: o.clients, documents: o.documents, paiements: o.paiements }, reglages);
};

test("un devis envoyé reste « devis envoyé » tant qu'il n'est pas classé sans suite", async () => {
  assert.equal((await resumeDe(base({}))).statut, "devis_envoye");
});

test("classé sans suite : statut « sans_suite », hors des relances", async () => {
  const { aFaire } = await calc();
  const r = await resumeDe(base({ sans_suite_le: "2026-11-12", sans_suite_motif: "Pas de réponse" }));
  assert.equal(r.statut, "sans_suite");
  assert.deepEqual(aFaire([r], "2026-11-12", reglages), []);
});

test("sans le classement, un devis de 40 jours reste à relancer (comportement inchangé)", async () => {
  const { aFaire } = await calc();
  const r = await resumeDe(base({}));
  const items = aFaire([r], "2026-11-12", reglages);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "devis_relance");
});

test("la marque est ignorée quand le devis a été accepté ou qu'un paiement est arrivé", async () => {
  const accepte = await resumeDe(base({ accepte_le: "2026-11-01", sans_suite_le: "2026-11-02" }));
  assert.notEqual(accepte.statut, "sans_suite");
  const paye = await resumeDe(base({ sans_suite_le: "2026-11-02" }, { paiements: [{ id: "p", dossier_id: "d1", montant: 100, date: "2026-11-03" }] }));
  assert.notEqual(paye.statut, "sans_suite");
});

test("un dossier annulé reste annulé même marqué sans suite", async () => {
  assert.equal((await resumeDe(base({ annule: true, sans_suite_le: "2026-11-02" }))).statut, "annule");
});

test("rouvrir remet le dossier dans les relances", async () => {
  const { aFaire } = await calc();
  const { valeursRouvrir, valeursSansSuite } = await ss();
  const classe = base({ ...valeursSansSuite("Parti ailleurs", "2026-11-12") });
  assert.equal((await resumeDe(classe)).statut, "sans_suite");
  const rouvert = base({ ...valeursSansSuite("Parti ailleurs", "2026-11-12"), ...valeursRouvrir() });
  const r = await resumeDe(rouvert);
  assert.equal(r.statut, "devis_envoye");
  assert.equal(aFaire([r], "2026-11-12", reglages).length, 1);
});

test("valeursSansSuite : date du jour, motif nettoyé et borné", async () => {
  const { valeursSansSuite, LONGUEUR_MAX } = await ss();
  assert.deepEqual(valeursSansSuite("  Trop   cher ", "2026-11-12"), { sans_suite_le: "2026-11-12", sans_suite_motif: "Trop cher" });
  assert.equal(valeursSansSuite("x".repeat(500), "2026-11-12").sans_suite_motif.length, LONGUEUR_MAX);
  assert.equal(valeursSansSuite(undefined, "2026-11-12").sans_suite_motif, "");
});

test("peutClasser : seulement un devis brouillon ou envoyé, jamais accepté, payé ou annulé", async () => {
  const { peutClasser } = await ss();
  assert.equal(peutClasser({ statut: "devis_envoye" }), true);
  assert.equal(peutClasser({ statut: "brouillon" }), true);
  for (const statut of ["accepte", "acompte", "solde", "sur_place", "sans_suite"]) assert.equal(peutClasser({ statut }), false, statut);
  assert.equal(peutClasser({ statut: "devis_envoye", annule: true }), false);
});

test("disponible : sur la base distante, seulement quand la colonne existe (migration 25 appliquée)", async () => {
  const { disponible } = await ss();
  assert.equal(disponible({ id: "d" }, true), false, "colonne absente : bouton caché");
  assert.equal(disponible({ id: "d", sans_suite_le: null }, true), true);
  assert.equal(disponible({ id: "d" }, false), true, "démo : toujours");
});

test("actionSuivante : un devis sans suite n'a plus de prochaine étape", async () => {
  const { actionSuivante } = await suite();
  const args = { statut: "devis_envoye", avecDevis: true, devisEnvoye: true, accepte: false, droit: { dossiers: true, docs: true } };
  assert.equal(actionSuivante(args).cle, "accepter");
  assert.equal(actionSuivante({ ...args, statut: "sans_suite" }), null);
});
