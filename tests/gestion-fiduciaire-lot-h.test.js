// Fiduciaire, lot H de l'audit d'autonomie (17.11.2026) : Taxi sorti, remise, dossier annulé, « déjà facturé » par destinataire,
// « Margin on », réglages dans l'écran, QR et titres figés à l'émission.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cibleAgence, aEmettre, libelleFacture, formaterNumero, reglagesFid, partRemise, parDestinataire, reglagesFiduciaire, FID_DEFAUT } from "../src/gestion/js/fiduciaire-calc.mjs";
import { aPreparerLocal, emettreLocal, annulerLocal, calculLocal } from "../src/gestion/js/fiduciaire-local.mjs";
import { MANQUE } from "../src/gestion/js/fiduciaire-textes.mjs";
import { aujourdhui, ajouterJours, totalDossier, sommePaiements } from "../src/gestion/js/calc.mjs";
import { donneesDemo } from "../src/gestion/js/defauts.mjs";
import { permissionsDans } from "../src/gestion/js/droits.mjs";

// ---- Réglages ----------------------------------------------------------------------------------------------------
test("réglages : actif par défaut en excursions (Secret), inactif en taxi ; un choix explicite l'emporte", () => {
  assert.equal(reglagesFid({ fonctionnement: "excursions" }).actif, true);
  assert.equal(reglagesFid({ fonctionnement: "taxi" }).actif, false, "décision du 17.11.2026 : pas de facture pour les courses de Taxi");
  assert.equal(reglagesFid({ fonctionnement: "sur_mesure" }).actif, false);
  assert.equal(reglagesFid({ fonctionnement: "taxi", fiduciaire: { actif: true } }).actif, true, "Taxi se réactive sans développeur");
  assert.equal(reglagesFid({ fonctionnement: "excursions", fiduciaire: { actif: false } }).actif, false);
  const d = reglagesFid(null);
  for (const [k, v] of Object.entries(FID_DEFAUT)) assert.equal(d[k], v, k);
  assert.equal(reglagesFid({ fiduciaire: { prefixe_facture: "  ", mot_marge: " Margin for " } }).prefixe_facture, "COM", "un champ vide reprend le défaut");
  assert.equal(reglagesFid({ fiduciaire: { mot_marge: " Margin for " } }).mot_marge, "Margin for");
  assert.equal(reglagesFid({ fiduciaire: { depuis: "n'importe quoi" } }).depuis, "", "une date illisible ne bloque rien");
  assert.equal(reglagesFid({ fiduciaire: { depuis: "2026-11-01" } }).depuis, "2026-11-01");
});

test("numéro : préfixe réglable, une série par préfixe", () => {
  assert.equal(formaterNumero("facture", 2026, 7), "COM-2026-007");
  assert.equal(formaterNumero("avoir", 2026, 7), "CN-2026-007");
  assert.equal(formaterNumero("facture", 2026, 12, "SEC"), "SEC-2026-012");
});

test("libellé : « Margin on » pour une marge, « Commission on » pour une commission, mots réglables", () => {
  const r = { libelle: "Private longtail", date_service: "2026-11-10" };
  assert.match(libelleFacture(r, { cas: "chez_nous" }), /^Margin on Private longtail, service of 10 Nov 2026$/);
  assert.match(libelleFacture(r, { cas: "sur_place" }), /^Commission on Private longtail/);
  assert.match(libelleFacture(r), /^Commission on /, "sans cas : l'ancien comportement");
  assert.match(libelleFacture(r, { cas: "chez_nous", reglages: { fiduciaire: { mot_marge: "Agency margin on" } } }), /^Agency margin on Private longtail/);
});

// ---- Remise ------------------------------------------------------------------------------------------------------
const L = (id, unite, qte = 1, extra = {}) => ({ id, kind: "ligne", libelle: id, unite, qte, ...extra });
test("remise : la part d'un service suit son prix de vente, en pourcentage comme en montant", () => {
  const pct = { lignes: [L("a", 3000), L("b", 1000), { id: "r", kind: "remise", libelle: "Discount", pct: 10 }] };
  assert.equal(partRemise(pct, ["a"], 3000), 300);
  assert.equal(partRemise(pct, ["b"], 1000), 100);
  const fixe = { lignes: [L("a", 3000), L("b", 1000), { id: "r", kind: "remise", libelle: "Discount", montant: 400 }] };
  assert.equal(partRemise(fixe, ["a"], 3000), 300, "400 répartis au prorata : 3000 sur 4000");
  assert.equal(partRemise(fixe, ["b"], 1000), 100);
  assert.equal(partRemise(fixe, ["x"], 3000), 0, "un service absent de la facture n'a pas de remise");
  assert.equal(partRemise({ lignes: [L("a", 3000)] }, ["a"], 3000), 0, "pas de remise, pas de part");
  // Les lignes payées sur place n'entrent pas dans le total : la remise se répartit sur les autres (comme total_document).
  const mixte = { lignes: [L("a", 3000), L("p", 2000, 1, { paye_sur_place: true }), { id: "r", kind: "remise", libelle: "Discount", pct: 10 }] };
  assert.equal(partRemise(mixte, ["a"], 3000), 300);
  assert.equal(partRemise({ lignes: [L("a", 100), { id: "r", kind: "remise", montant: 500 }] }, ["a"], 100), 100, "jamais plus que le prix de vente");
});

test("remise : elle baisse la marge déclarée (décision 4), pas la commission reçue", () => {
  const net = { net_paye: 2500, paye_le: "2026-11-09" };
  const paie = { regle: true, date: "2026-11-08" };
  assert.equal(cibleAgence({ paye_sur_place: false, montant_vente: 3000 }, net, paie).cible, 500);
  assert.equal(cibleAgence({ paye_sur_place: false, montant_vente: 3000, remise: 300 }, net, paie).cible, 200, "3000 − 300 de remise − 2500 de net");
  assert.deepEqual(cibleAgence({ paye_sur_place: false, montant_vente: 3000, remise: 600 }, net, paie).manque, ["marge_nulle"]);
  const sur = cibleAgence({ paye_sur_place: true, montant_vente: 3000, remise: 300 }, { commission_recue: 300, commission_recue_le: "2026-11-12" });
  assert.equal(sur.cible, 300, "la commission reçue fait foi");
});

test("dossier annulé sans réservation annulée : pas de marge, un avoir si elle était facturée", () => {
  const net = { net_paye: 2500, paye_le: "2026-11-09" };
  const paie = { regle: true, date: "2026-11-08" };
  const c = cibleAgence({ statut: "confirme", paye_sur_place: false, montant_vente: 3000, dossier_annule: true }, net, paie);
  assert.equal(c.pret, false);
  assert.equal(c.cible, 0);
  const deja = cibleAgence({ statut: "confirme", paye_sur_place: false, montant_vente: 3000, dossier_annule: true }, net, paie, 500);
  assert.deepEqual(aEmettre(deja, 500), { type: "avoir", montant: 500 });
});

// ---- Destinataire ------------------------------------------------------------------------------------------------
test("déjà facturé par destinataire : l'ancien prestataire garde son total, le nouveau part de zéro", () => {
  const A = { id: "pa", nom: "Old Boat Co." };
  const B = { id: "pb", nom: "New Boat Co." };
  const fs = [
    { montant: 300, destinataire_id: "pa", destinataire: { nom: A.nom } },
    { montant: -50, destinataire_id: "pa", destinataire: { nom: A.nom } },
    { montant: 100, destinataire: { nom: B.nom } }, // facture d'avant la migration 31 : reconnue par le nom
  ];
  assert.deepEqual(parDestinataire(fs, B), { deja: 100, anciens: [{ cle: "pa", destinataire_id: "pa", nom: A.nom, adresse: "", total: 250 }] });
  assert.deepEqual(parDestinataire(fs, A).deja, 250);
  assert.equal(parDestinataire(fs, null).deja, 0, "sans prestataire, rien n'est « déjà facturé » au prestataire actuel");
  assert.equal(parDestinataire([...fs, { montant: -250, destinataire_id: "pa", destinataire: { nom: A.nom } }], B).anciens.length, 0, "un ancien soldé par avoir disparaît");
});

// ---- QR et titres figés ------------------------------------------------------------------------------------------
test("QR code et titres figés à l'émission ; une ancienne facture garde l'affichage d'avant", () => {
  const reglages = { emetteur: { nom: "Secret" }, paiement: { texte: "Compte actuel" }, apparence: { qr_image: "data:image/png;base64,ACTUEL", qr_pseudo: "@actuel" }, libelles_en: {} };
  const neuve = { type: "facture", emetteur: { emetteur: { nom: "Secret" }, paiement: { texte: "Compte du jour", qr_image: "data:image/png;base64,DUJOUR", qr_pseudo: "@jour" }, titres: { facture: "TAX INVOICE", ref_facture: "No." } } };
  const r1 = reglagesFiduciaire(reglages, neuve);
  assert.equal(r1.apparence.qr_image, "data:image/png;base64,DUJOUR", "le QR de la facture, pas celui d'aujourd'hui");
  assert.equal(r1.apparence.qr_pseudo, "@jour");
  assert.equal(r1.paiement.texte, "Compte du jour");
  assert.equal(r1.libelles_en.facture, "TAX INVOICE");
  assert.equal(r1.libelles_en.ref_facture, "No.");
  const sansQr = reglagesFiduciaire(reglages, { type: "facture", emetteur: { paiement: { texte: "x", qr_image: "", qr_pseudo: "" } } });
  assert.equal(sansQr.apparence.qr_image, "", "émise sans QR : reste sans QR même si un QR est ajouté ensuite");
  const ancienne = reglagesFiduciaire(reglages, { type: "avoir", emetteur: { paiement: { texte: "x" } } });
  assert.equal(ancienne.apparence.qr_image, "data:image/png;base64,ACTUEL", "facture d'avant la migration 31 : affichage inchangé");
  assert.equal(ancienne.libelles_en.facture, "CREDIT NOTE");
  assert.equal(ancienne.libelles_en.ref_facture, "Credit note no.");
});

test("chaque nouvelle raison a son texte pour les responsables", () => {
  assert.ok(MANQUE.partenaire_change);
});

// ---- Démonstration -----------------------------------------------------------------------------------------------
function demo() {
  const data = donneesDemo(aujourdhui(), ajouterJours);
  data.fiduciaire_factures = [];
  const qui = (nom) => {
    const u = data.profils.find((p) => p.nom.includes(nom));
    const ctx = { profil: u, membres: data.membres, roles: data.roles };
    return {
      voit: () => true,
      droit: (e, c) => permissionsDans(ctx, e).includes(c),
      resumeDe: (d) => ({ total: totalDossier(data.documents.filter((x) => x.dossier_id === d.id)), recu: sommePaiements(data.paiements.filter((p) => p.dossier_id === d.id)) }),
      utilisateurId: u.user_id,
      aujourdhui: aujourdhui(),
    };
  };
  const secret = data.entites.find((e) => e.slug === "excursions");
  const taxi = data.entites.find((e) => e.slug === "taxi");
  return { data, secret, taxi, mook: qui("vouchers et factures"), anais: qui("Administratrice") };
}

const emis = (data, qui, id) => { const f = emettreLocal(data, qui, id); return data.fiduciaire_factures.find((x) => x.id === f); };
const annule = (data, qui, id, cle) => { const f = annulerLocal(data, qui, id, null, cle); return data.fiduciaire_factures.find((x) => x.id === f); };

// Un service « chez nous » complet : facture du client (avec une remise éventuelle), paiement, prestataire payé.
let n = 0;
function serviceChezNous(data, entite, { vente = 3000, net = 2500, remise = null, annule = false, partenaire = null } = {}) {
  const j = (k) => ajouterJours(aujourdhui(), k);
  const id = (p) => `${p}-lot-h-${++n}`;
  const p = partenaire || { id: id("p"), created_at: j(-10), entite_id: entite.id, nom: `Boat Co. ${n}`, contact: { adresse: "1 Moo 2, Koh Lanta" }, actif: true };
  if (!data.partenaires.includes(p)) data.partenaires.push(p);
  const c = { id: id("c"), created_at: j(-10), entite_id: entite.id, prenom: "Jane", nom: "Example", civilite: "", adresse: "", telephone: "", email: "", notes: "" };
  data.clients.push(c);
  const d = { id: id("d"), created_at: j(-10), entite_id: entite.id, ref: `INV-LOTH-${n}`, client_id: c.id, annule };
  data.dossiers.push(d);
  const lignes = [{ id: id("l"), kind: "ligne", libelle: "Private longtail", unite: vente, qte: 1 }];
  if (remise) lignes.push({ id: id("r"), kind: "remise", libelle: "Discount", pct: remise });
  const doc = { id: id("doc"), created_at: j(-9), entite_id: entite.id, dossier_id: d.id, type: "facture", date_emission: j(-9), contenu: { devise: "THB", lignes } };
  data.documents.push(doc);
  const total = totalDossier([doc]);
  data.paiements.push({ id: id("pay"), created_at: j(-8), entite_id: entite.id, dossier_id: d.id, date: j(-8), montant: total });
  const r = { id: id("res"), created_at: j(-9), entite_id: entite.id, dossier_id: d.id, ligne_id: lignes[0].id, partenaire_id: p.id, libelle: "Private longtail", date_service: j(-5), statut: "confirme", montant_vente: vente, paye_sur_place: false, details: {} };
  data.reservations.push(r);
  data.reservations_nets.push({ id: id("n"), entite_id: entite.id, reservation_id: r.id, net_prevu: net, net_paye: net, paye_le: j(-4) });
  return { r, d, p, doc };
}

test("démo : Taxi n'émet plus de facture pour la fiduciaire, et se réactive par le réglage", () => {
  const { data, taxi, anais } = demo();
  const { r } = serviceChezNous(data, taxi);
  assert.ok(!aPreparerLocal(data, anais).some((x) => x.reservation_id === r.id), "rien à préparer en Taxi");
  assert.throws(() => emettreLocal(data, anais, r.id), /n'émet pas de factures pour la fiduciaire/);
  data.reglages[taxi.id] = { ...data.reglages[taxi.id], fiduciaire: { actif: true } };
  const l = aPreparerLocal(data, anais).find((x) => x.reservation_id === r.id);
  assert.equal(l && l.type, "facture", "réactivé : la course se propose");
  const f = emis(data, anais, r.id);
  assert.equal(f.emetteur.emetteur.nom, data.reglages[taxi.id].emetteur.nom, "émise par l'entreprise du service, plus toujours par Secret");
  // Désactivé de nouveau : la facture existante reste et se corrige par un avoir.
  data.reglages[taxi.id].fiduciaire.actif = false;
  data.reservations.find((x) => x.id === r.id).statut = "annule";
  const avoir = aPreparerLocal(data, anais).find((x) => x.reservation_id === r.id);
  assert.equal(avoir && avoir.type, "avoir");
  assert.ok(emettreLocal(data, anais, r.id, null, "avoir"));
});

test("démo : une remise sur la facture du client baisse la marge facturée", () => {
  const { data, secret, anais } = demo();
  const { r } = serviceChezNous(data, secret, { vente: 3000, net: 2500, remise: 10 });
  const l = aPreparerLocal(data, anais).find((x) => x.reservation_id === r.id);
  assert.equal(l.montant, 200, "3000 − 300 de remise − 2500");
  const calc = calculLocal(data, anais, r.id);
  assert.equal(calc.remise, 300);
  assert.equal(calc.cible, 200);
  const f = emis(data, anais, r.id);
  assert.equal(f.montant, 200);
  assert.match(f.libelle, /^Margin on Private longtail/, "une marge se dit « Margin on »");
});

test("démo : un dossier annulé sans réservation annulée n'est pas facturé, et ce qui l'était s'annule", () => {
  const { data, secret, anais } = demo();
  const { r, d } = serviceChezNous(data, secret, { annule: true });
  assert.ok(!aPreparerLocal(data, anais).some((x) => x.reservation_id === r.id));
  d.annule = false;
  emettreLocal(data, anais, r.id);
  d.annule = true;
  const l = aPreparerLocal(data, anais).find((x) => x.reservation_id === r.id);
  assert.equal(l.type, "avoir");
  assert.equal(l.montant, 500);
});

test("démo : le prestataire change après facture, le nouveau reçoit tout et l'avoir à l'ancien est proposé", () => {
  const { data, secret, anais, mook } = demo();
  const { r, p: ancien } = serviceChezNous(data, secret);
  const f1 = emis(data, anais, r.id);
  assert.equal(f1.destinataire_id, ancien.id);
  const nouveau = { id: "p-nouveau", created_at: aujourdhui(), entite_id: secret.id, nom: "New Boat Co.", contact: { adresse: "3 Moo 1, Koh Lanta" }, actif: true };
  data.partenaires.push(nouveau);
  data.reservations.find((x) => x.id === r.id).partenaire_id = nouveau.id;
  const lignes = aPreparerLocal(data, anais).filter((x) => x.reservation_id === r.id);
  const pourNouveau = lignes.find((x) => x.type === "facture");
  assert.equal(pourNouveau.destinataire_nom, "New Boat Co.");
  assert.equal(pourNouveau.montant, 500, "le montant entier, pas la différence");
  const pourAncien = lignes.find((x) => x.manque.includes("partenaire_change"));
  assert.equal(pourAncien.destinataire_nom, ancien.nom);
  assert.equal(pourAncien.deja_facture, 500);
  assert.ok(!aPreparerLocal(data, mook).some((x) => x.manque.includes("partenaire_change")), "l'avoir est une décision de responsable");
  const f2 = emis(data, anais, r.id);
  assert.equal(f2.destinataire.nom, "New Boat Co.");
  assert.throws(() => annulerLocal(data, anais, r.id), /plusieurs prestataires/);
  const av = annule(data, anais, r.id, pourAncien.destinataire_cle);
  assert.equal(av.montant, -500);
  assert.equal(av.destinataire.nom, ancien.nom);
  assert.equal(av.avoir_de, f1.id);
  assert.ok(!aPreparerLocal(data, anais).some((x) => x.reservation_id === r.id), "tout est juste : rien d'autre à émettre");
});

test("démo : préfixes, titres et QR copiés à l'émission ; changer de préfixe démarre une série", () => {
  const { data, secret, anais } = demo();
  data.reglages[secret.id] = { ...data.reglages[secret.id], apparence: { ...(data.reglages[secret.id].apparence || {}), qr_image: "data:image/png;base64,QR", qr_pseudo: "@secret" } };
  const a = serviceChezNous(data, secret);
  const f1 = emis(data, anais, a.r.id);
  assert.equal(f1.emetteur.paiement.qr_image, "data:image/png;base64,QR", "le QR des réglages (apparence) est copié");
  assert.equal(f1.emetteur.titres.facture, "INVOICE");
  assert.equal(f1.emetteur.entite_id, secret.id);
  data.reglages[secret.id].fiduciaire = { prefixe_facture: "SEC", titre_facture: "TAX INVOICE" };
  const b = serviceChezNous(data, secret);
  const f2 = emis(data, anais, b.r.id);
  assert.equal(f2.numero, `SEC-${f2.annee}-001`);
  assert.equal(f2.emetteur.titres.facture, "TAX INVOICE");
  assert.equal(reglagesFiduciaire(data.reglages[secret.id], f1).libelles_en.facture, "INVOICE", "l'ancienne facture garde son titre");
});

test("relecture : compte bancaire figé même vide, avoir relié à une facture d'avant la migration 31", () => {
  const reglages = { emetteur: { nom: "Secret" }, paiement: { texte: "Compte ajouté plus tard" }, apparence: { qr_image: "" }, libelles_en: {} };
  const vide = reglagesFiduciaire(reglages, { type: "facture", emetteur: { paiement: { texte: "", qr_image: "", qr_pseudo: "" } } });
  assert.equal(vide.paiement.texte, "", "émise sans compte : reste sans compte");
  const { data, secret, anais } = demo();
  data.reglages[secret.id] = { ...data.reglages[secret.id], fiduciaire: { actif: true } };
  const { r, p } = serviceChezNous(data, secret);
  const f = emis(data, anais, r.id);
  delete f.destinataire_id; // comme une facture émise avant la migration 31
  data.reservations_nets.find((x) => x.reservation_id === r.id).net_paye = 2600;
  const av = emis(data, anais, r.id);
  assert.equal(av.type, "avoir");
  assert.equal(av.avoir_de, f.id, "l'avoir renvoie à la facture reconnue par le nom du prestataire");
  assert.equal(p.nom, f.destinataire.nom);
});
