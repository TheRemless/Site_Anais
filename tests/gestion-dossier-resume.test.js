// tests/gestion-dossier-resume.test.js : résumé en tête de la fiche dossier (états des services, effectif, commission, prochaine étape).
const test = require("node:test");
const assert = require("node:assert/strict");
const load = () => import("../src/gestion/js/dossier-resume-calc.mjs");

const res = (o) => ({ id: o.id || "r", dossier_id: "d1", statut: "demande", paye_sur_place: false, partenaire_id: "p1", personnes: { adultes: 2, enfants: 0, bebes: 0 }, montant_vente: 1000, ...o });

test("etatsServices : compte les services, hors annulés (plus d'états de demande depuis le 14.11.2026)", async () => {
  const { etatsServices } = await load();
  const rs = [res({ id: "a", statut: "a_demander" }), res({ id: "b", statut: "demande" }), res({ id: "c", statut: "confirme" }), res({ id: "d", statut: "confirme" }), res({ id: "e", statut: "annule" })];
  assert.deepEqual(etatsServices(rs), { total: 4 });
  assert.deepEqual(etatsServices([]), { total: 0 });
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

test("actionSuivante : une seule étape, dans l'ordre envoyer, accepter, encaisser ; jamais « demander »", async () => {
  const { actionSuivante } = await load();
  const droit = { docs: true, dossiers: true, paiements: true, finances: true };
  const base = { statut: "devis_envoye", avecDevis: true, devisEnvoye: true, accepte: false, facture: false, reservations: [], reste: 500, droit };
  assert.deepEqual(actionSuivante({ ...base, aEnvoyer: { type: "devis" }, devisEnvoye: false }), { cle: "envoyer", type: "devis" });
  assert.deepEqual(actionSuivante(base), { cle: "accepter" });
  const aDemander = res({ id: "a", statut: "a_demander" });
  assert.equal(actionSuivante({ ...base, accepte: true, statut: "accepte", reservations: [aDemander] }).cle, "paiement");
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

// Lot B de l'audit du 13.11.2026 (points 4, 9 et 10).
const droitTout = { docs: true, dossiers: true, paiements: true, finances: true };
const vx = (r) => ({ reservation: r, type: "bateau", index: 1 });
const envois = (client, prestataire) => ({ envois: { ...(client ? { client: "2026-11-13" } : {}), ...(prestataire ? { prestataire: "2026-11-13" } : {}) } });

test("actionSuivante Secret : voucher, puis facture et paiement ; jamais « demander » ni « confirmer »", async () => {
  const { actionSuivante } = await load();
  const base = { excursions: true, statut: "facture", facture: true, aEnvoyer: { type: "facture" }, reste: 500, droit: droitTout };
  const a = res({ id: "a", statut: "a_demander" });
  const b = res({ id: "b", statut: "demande" });
  // Une réservation saisie avant le 14.11 avec un ancien statut est confirmée : son voucher vient en premier.
  assert.equal(actionSuivante({ ...base, reservations: [a], vouchers: [vx(a)] }).cle, "voucher");
  assert.equal(actionSuivante({ ...base, reservations: [b] }).cle, "envoyer");
  const c = res({ id: "c", statut: "confirme" });
  const s3 = actionSuivante({ ...base, reservations: [c], vouchers: [vx(c)] });
  assert.equal(s3.cle, "voucher");
  assert.equal(s3.voucher.reservation.id, "c");
  // Voucher parti chez le client : c'est fait, l'envoi au prestataire n'est plus suivi (14.11.2026).
  const c2 = res({ id: "c", statut: "confirme", details: envois(true, false) });
  assert.deepEqual(actionSuivante({ ...base, reservations: [c2], vouchers: [vx(c2)] }), { cle: "envoyer", type: "facture" });
  // Service sans prestataire : le client suffit.
  const libre = res({ id: "l", statut: "confirme", partenaire_id: null, details: envois(true, false) });
  const fini = res({ id: "c", statut: "confirme", details: envois(true, true) });
  assert.deepEqual(actionSuivante({ ...base, reservations: [fini, libre], vouchers: [vx(fini), vx(libre)] }), { cle: "envoyer", type: "facture" });
  assert.deepEqual(actionSuivante({ ...base, aEnvoyer: null, reservations: [fini], vouchers: [vx(fini)] }), { cle: "paiement" });
});

test("actionSuivante Secret et Taxi : chaque étape demande son droit, Taxi n'a ni facture ni paiement", async () => {
  const { actionSuivante } = await load();
  const c = res({ id: "c", statut: "confirme" });
  const base = { excursions: true, statut: "facture", facture: true, aEnvoyer: { type: "facture" }, reste: 500, reservations: [res({ id: "a", statut: "a_demander" }), c], vouchers: [vx(c)] };
  assert.equal(actionSuivante({ ...base, droit: { ...droitTout, dossiers: false } }).cle, "voucher");
  assert.equal(actionSuivante({ ...base, droit: { ...droitTout, dossiers: false, finances: false } }).cle, "envoyer", "sans les finances, la section vouchers est cachée");
  const fini = res({ id: "c", statut: "confirme", details: envois(true, true) });
  assert.equal(actionSuivante({ ...base, taxi: true, aEnvoyer: { type: "facture" }, reservations: [fini], vouchers: [vx(fini)], droit: droitTout }), null, "Taxi : pas de facture à envoyer ni de paiement");
  assert.equal(actionSuivante({ ...base, taxi: true, reservations: [c], vouchers: [vx(c)], droit: droitTout }).cle, "voucher", "Taxi : la Booking confirmation est l'étape suivante");
  assert.equal(actionSuivante({ ...base, reservations: [res({ id: "x", statut: "annule" })], vouchers: [], aEnvoyer: null, statut: "solde", reste: 0, droit: droitTout }), null);
});

test("actionSuivante ZTP : « Créer la facture » quand l'acompte est reçu et qu'il n'y a pas encore de facture", async () => {
  const { actionSuivante } = await load();
  const base = { statut: "accepte", avecDevis: true, devisEnvoye: true, accepte: true, facture: false, reste: 500, droit: droitTout };
  assert.deepEqual(actionSuivante({ ...base, acompteRecu: true }), { cle: "facture" });
  assert.deepEqual(actionSuivante({ ...base, acompteRecu: false }), { cle: "paiement" }, "acompte pas encore reçu : on l'encaisse d'abord");
  assert.deepEqual(actionSuivante({ ...base, acompteRecu: true, facture: true }), { cle: "paiement" });
  assert.deepEqual(actionSuivante({ ...base, acompteRecu: true, droit: { ...droitTout, docs: false } }), { cle: "paiement" }, "sans le droit documents, pas de facture proposée");
  assert.equal(actionSuivante({ ...base, acompteRecu: true, reservations: [res({ id: "a", statut: "a_demander" })] }).cle, "facture");
  // Le mode ZTP ne propose jamais de voucher ni de confirmation.
  const d = res({ id: "d", statut: "demande" });
  assert.deepEqual(actionSuivante({ ...base, acompteRecu: true, reservations: [d], vouchers: [vx(d)] }), { cle: "facture" });
});

test("varianteFacture : la variante des réglages prévue pour les factures, sinon celle du devis signalée", async () => {
  const { varianteFacture } = await load();
  const variantes = [{ id: "qr", nom: "Avec QR Wise dans le pied de page" }, { id: "email", nom: "Coordonnées de paiement envoyées par e-mail" }];
  assert.deepEqual(varianteFacture(variantes, "qr"), { variante: "qr", manque: true }, "aucune variante de facture : rien n'est inventé, le manque est signalé");
  assert.deepEqual(varianteFacture([...variantes, { id: "fact", nom: "Facture : solde à la réception du carnet" }], "qr"), { variante: "fact", manque: false });
  assert.deepEqual(varianteFacture([...variantes, { id: "inv", nom: "Invoice (balance)" }], "email"), { variante: "inv", manque: false });
  assert.deepEqual(varianteFacture([...variantes, { id: "fact", nom: "Facture" }], "perso"), { variante: "perso", manque: false }, "un texte écrit à la main pour ce devis est gardé");
  assert.deepEqual(varianteFacture([], ""), { variante: "", manque: true });
  assert.deepEqual(varianteFacture([{ id: "x", nom: "Préfacture" }], "qr"), { variante: "qr", manque: true }, "un mot qui contient « facture » ne suffit pas");
});

test("envoi des documents : « Envoyer » ouvre la fenêtre d'envoi sur tous les appareils (audit, point 3)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const lire = (f) => fs.readFileSync(path.join(__dirname, "..", "src", "gestion", "js", "views", f), "utf8");
  const dossier = lire("dossier.mjs");
  const editeur = lire("editeur.mjs");
  // La fiche n'a plus de chemin « impression au bureau, envoi au téléphone ».
  assert.doesNotMatch(dossier, /sansImpression/);
  assert.match(dossier, /const envoyerDoc = \(doc\) =>\s*envoyerDocument\(/);
  // L'éditeur : « Envoyer » appelle envoyerDocument sans condition ; « Imprimer » est un lien, sur ordinateur seulement.
  assert.match(editeur, /const envoyer = \(\) => envoyerDocument\(/);
  assert.match(editeur, /h\("button", \{ class: "principal", type: "button", onclick: envoyer \}, tr\("Envoyer"\)\)/);
  assert.match(editeur, /sansImpression\(\) \? null : h\("button", \{ class: "lien", type: "button", title: tr\("Imprimer \(Ctrl\+P\)"\), onclick: imprimer \}, tr\("Imprimer"\)\)/);
});
