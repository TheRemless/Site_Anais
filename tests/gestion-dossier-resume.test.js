// tests/gestion-dossier-resume.test.js : résumé en tête de la fiche dossier (états des services, effectif, commission, prochaine étape).
const test = require("node:test");
const assert = require("node:assert/strict");
const load = () => import("../src/gestion/js/dossier-resume-calc.mjs");

const res = (o) => ({ id: o.id || "r", dossier_id: "d1", statut: "demande", paye_sur_place: false, partenaire_id: "p1", personnes: { adultes: 2, enfants: 0, bebes: 0 }, montant_vente: 1000, ...o });

test("etatsServices : compte les services par état, hors annulés", async () => {
  const { etatsServices } = await load();
  const rs = [res({ id: "a", statut: "a_demander" }), res({ id: "b", statut: "demande" }), res({ id: "c", statut: "confirme" }), res({ id: "d", statut: "confirme" }), res({ id: "e", statut: "annule" })];
  assert.deepEqual(etatsServices(rs), { total: 4, a_demander: 1, demande: 1, confirme: 2 });
  assert.deepEqual(etatsServices([]), { total: 0, a_demander: 0, demande: 0, confirme: 0 });
});

test("personnesDossier : un effectif, ou une fourchette quand les groupes diffèrent", async () => {
  const { personnesDossier } = await load();
  assert.deepEqual(personnesDossier([res({}), res({})]), { min: 2, max: 2 });
  assert.deepEqual(personnesDossier([res({}), res({ personnes: { adultes: 2, enfants: 1, bebes: 1 } })]), { min: 2, max: 4 });
  assert.deepEqual(personnesDossier([res({ statut: "annule", personnes: { adultes: 9 } }), res({})]), { min: 2, max: 2 }, "un service annulé ne compte pas");
  assert.equal(personnesDossier([res({ personnes: {} })]), null);
  assert.equal(personnesDossier([]), null);
});

test("commissionDossier : prévue, reçue et à recevoir des services payés sur place seulement", async () => {
  const { commissionDossier } = await load();
  const nets = { a: { commission_prevue: 100, commission_recue: 40 }, b: { commission_prevue: 50 }, c: { commission_prevue: 80, commission_recue: 90, commission_recue_le: "2026-11-10" } };
  const netDe = (r) => nets[r.id] || null;
  const rs = [res({ id: "a", paye_sur_place: true }), res({ id: "b", paye_sur_place: true }), res({ id: "c", paye_sur_place: true }), res({ id: "z", paye_sur_place: false }), res({ id: "x", paye_sur_place: true, statut: "annule" })];
  const c = commissionDossier(rs, netDe);
  assert.equal(c.services, 3);
  assert.equal(c.prevue, 230);
  assert.equal(c.recue, 130);
  assert.equal(c.reste, 110, "100 - 40 + 50 ; le service réglé n'a plus de reste");
  assert.equal(c.ecart, 10, "90 versés pour 80 prévus");
  assert.equal(c.aRecevoir, 2);
  assert.equal(commissionDossier([res({ id: "z" })], netDe), null, "aucun service sur place : pas de commission");
});

test("commissionDossier : un service sur place sans commission renseignée est signalé, pas deviné", async () => {
  const { commissionDossier } = await load();
  const c = commissionDossier([res({ id: "a", paye_sur_place: true })], () => null);
  assert.equal(c.prevue, 0);
  assert.equal(c.reste, 0);
  assert.equal(c.sansCommission, 1);
});

test("actionSuivante : une seule étape, dans l'ordre envoyer, accepter, demander, encaisser", async () => {
  const { actionSuivante } = await load();
  const droit = { docs: true, dossiers: true, paiements: true, finances: true };
  const base = { statut: "devis_envoye", avecDevis: true, devisEnvoye: true, accepte: false, facture: false, reservations: [], reste: 500, droit };
  assert.deepEqual(actionSuivante({ ...base, aEnvoyer: { type: "devis" }, devisEnvoye: false }), { cle: "envoyer", type: "devis" });
  assert.deepEqual(actionSuivante(base), { cle: "accepter" });
  const aDemander = res({ id: "a", statut: "a_demander" });
  assert.equal(actionSuivante({ ...base, accepte: true, statut: "accepte", reservations: [aDemander] }).cle, "demander");
  assert.equal(actionSuivante({ ...base, accepte: true, statut: "accepte", reservations: [res({ statut: "confirme" })] }).cle, "paiement");
});

test("actionSuivante : rien à encaisser quand tout est sur place ou soldé, rien sur un dossier annulé ou sans droit", async () => {
  const { actionSuivante } = await load();
  const droit = { docs: true, dossiers: true, paiements: true, finances: true };
  const base = { accepte: true, facture: true, reservations: [], reste: 0, droit };
  assert.equal(actionSuivante({ ...base, statut: "sur_place", reste: 300 }), null, "tout sur place : jamais d'invitation à encaisser");
  assert.equal(actionSuivante({ ...base, statut: "solde" }), null);
  assert.equal(actionSuivante({ ...base, statut: "accepte", reste: 300, annule: true }), null);
  assert.equal(actionSuivante({ ...base, statut: "accepte", reste: 300, droit: { ...droit, paiements: false } }), null);
  assert.equal(actionSuivante({ ...base, statut: "accepte", reste: 300, aEnvoyer: { type: "facture" }, droit: { ...droit, docs: false } }).cle, "paiement", "sans le droit documents, pas d'envoi proposé : on passe à la suite");
  assert.equal(actionSuivante({ ...base, statut: "accepte", reste: 300 }).cle, "paiement");
});
