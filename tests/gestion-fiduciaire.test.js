import { test } from "node:test";
import assert from "node:assert/strict";
import { cibleAgence, aEmettre, initiales, libelleFacture, formaterNumero, contenuDepuisFacture, filtrerFactures, aPreparer } from "../src/gestion/js/fiduciaire-calc.mjs";

// Ce qui revient à l'agence : la commission reçue (service payé sur place) ou la marge (service payé chez nous).
const surPlace = (extra = {}) => ({ statut: "confirme", paye_sur_place: true, montant_vente: 3000, date_service: "2026-11-10", ...extra });
const chezNous = (extra = {}) => ({ statut: "confirme", paye_sur_place: false, montant_vente: 3000, date_service: "2026-11-10", ...extra });

test("sur place : la commission reçue, datée du jour de réception", () => {
  const c = cibleAgence(surPlace(), { commission_prevue: 300, commission_recue: 300, commission_recue_le: "2026-11-12" });
  assert.equal(c.cas, "sur_place");
  assert.equal(c.cible, 300);
  assert.equal(c.date, "2026-11-12");
  assert.equal(c.pret, true);
  assert.deepEqual(c.manque, []);
});

test("sur place : rien n'est facturé tant que la commission n'est pas reçue", () => {
  for (const net of [null, {}, { commission_prevue: 300 }, { commission_prevue: 300, commission_recue: 0, commission_recue_le: "2026-11-12" }]) {
    const c = cibleAgence(surPlace(), net);
    assert.equal(c.pret, false, JSON.stringify(net));
    assert.equal(c.cible, 0);
    assert.ok(c.manque.length > 0);
  }
  const sansDate = cibleAgence(surPlace(), { commission_recue: 300 });
  assert.equal(sansDate.pret, false, "une commission reçue sans date de réception ne se date pas");
  assert.deepEqual(sansDate.manque, ["date_reception"]);
});

test("chez nous : la marge, ce que le client a payé moins le net payé au prestataire", () => {
  const c = cibleAgence(chezNous(), { net_prevu: 2400, net_paye: 2500, paye_le: "2026-11-09" }, { regle: true, date: "2026-11-08" });
  assert.equal(c.cas, "chez_nous");
  assert.equal(c.cible, 500, "3000 payés par le client moins 2500 versés au prestataire");
  assert.equal(c.date, "2026-11-09", "le plus tardif des deux : le prestataire est payé après le client");
  assert.equal(c.pret, true);
  const inverse = cibleAgence(chezNous(), { net_paye: 2500, paye_le: "2026-11-05" }, { regle: true, date: "2026-11-08" });
  assert.equal(inverse.date, "2026-11-08", "le client paie après le prestataire : la date du paiement du client");
});

test("chez nous : pas de facture tant que le client n'a pas tout payé et que le prestataire n'est pas payé", () => {
  const net = { net_paye: 2500, paye_le: "2026-11-09" };
  const nonRegle = cibleAgence(chezNous(), net, { regle: false, date: null });
  assert.equal(nonRegle.pret, false);
  assert.deepEqual(nonRegle.manque, ["client_non_solde"]);
  const prestatairePasPaye = cibleAgence(chezNous(), { net_prevu: 2400 }, { regle: true, date: "2026-11-08" });
  assert.equal(prestatairePasPaye.pret, false);
  assert.deepEqual(prestatairePasPaye.manque, ["prestataire_non_paye"]);
  const sansPaiement = cibleAgence(chezNous(), net, null);
  assert.equal(sansPaiement.pret, false);
});

test("chez nous : une marge négative ou nulle ne donne pas de facture", () => {
  const perte = cibleAgence(chezNous(), { net_paye: 3200, paye_le: "2026-11-09" }, { regle: true, date: "2026-11-08" });
  assert.equal(perte.cible, 0);
  assert.equal(perte.pret, false);
  assert.deepEqual(perte.manque, ["marge_nulle"]);
});

test("Taxi : service payé au chauffeur, la commission reçue de VIP Taxi Lanta se facture comme un service sur place", () => {
  const course = surPlace({ montant_vente: 1200 });
  const c = cibleAgence(course, { commission_prevue: 100, commission_recue: 100, commission_recue_le: "2026-11-11" });
  assert.equal(c.cas, "sur_place");
  assert.equal(c.cible, 100);
});

test("commission partielle : on facture ce qui est reçu, l'écart reste visible, le complément se facture plus tard", () => {
  const net = { commission_prevue: 300, commission_recue: 200, commission_recue_le: "2026-11-12" };
  const c = cibleAgence(surPlace(), net);
  assert.equal(c.cible, 200);
  assert.equal(c.ecart, -100);
  assert.deepEqual(aEmettre(c, 0), { type: "facture", montant: 200 });
  // Le reste arrive plus tard : une seconde facture du complément, pas de doublon.
  const apres = cibleAgence(surPlace(), { ...net, commission_recue: 300, commission_recue_le: "2026-11-20" });
  assert.deepEqual(aEmettre(apres, 200), { type: "facture", montant: 100 });
  assert.equal(apres.date, "2026-11-20");
});

test("déjà facturé en entier : rien à émettre", () => {
  const c = cibleAgence(surPlace(), { commission_recue: 300, commission_recue_le: "2026-11-12" });
  assert.deepEqual(aEmettre(c, 300), { type: null, montant: 0 });
  assert.deepEqual(aEmettre(cibleAgence(surPlace(), {}), 0), { type: null, montant: 0 }, "rien de reçu, rien de facturé");
});

test("remboursement : annulé après facturation, un avoir du montant déjà facturé", () => {
  const annule = chezNous({ statut: "annule" });
  const c = cibleAgence(annule, { net_paye: 0, paye_le: null }, { regle: false, date: null }, 500);
  assert.equal(c.cible, 0);
  assert.equal(c.pret, true, "une annulation après facturation n'attend rien d'autre");
  assert.deepEqual(aEmettre(c, 500), { type: "avoir", montant: 500 });
  const sansFacture = cibleAgence(annule, {}, null, 0);
  assert.deepEqual(aEmettre(sansFacture, 0), { type: null, montant: 0 }, "jamais facturé, rien à annuler");
});

test("remboursement : commission corrigée à la baisse après facture, avoir de la différence", () => {
  const c = cibleAgence(surPlace(), { commission_recue: 250, commission_recue_le: "2026-11-12" });
  assert.deepEqual(aEmettre(c, 300), { type: "avoir", montant: 50 });
});

test("remboursement du client après facture : à revoir par une personne, jamais un avoir automatique", () => {
  const c = cibleAgence(chezNous(), { net_paye: 2500, paye_le: "2026-11-09" }, { regle: false, date: null }, 500);
  assert.equal(c.pret, false);
  assert.equal(c.a_revoir, true);
  assert.deepEqual(aEmettre(c, 500), { type: null, montant: 0 });
});

test("les montants s'arrondissent au centime", () => {
  const c = cibleAgence(chezNous({ montant_vente: 100.1 }), { net_paye: 33.33, paye_le: "2026-11-09" }, { regle: true, date: "2026-11-09" });
  assert.equal(c.cible, 66.77);
  assert.deepEqual(aEmettre(c, 0.1), { type: "facture", montant: 66.67 });
});

test("service annulé et jamais payé : aucune ligne à préparer", () => {
  const lignes = aPreparer([
    { reservation: surPlace({ id: "a", statut: "annule" }), net: null, paiement: null, deja: 0 },
    { reservation: surPlace({ id: "b" }), net: { commission_recue: 300, commission_recue_le: "2026-11-12" }, paiement: null, deja: 0 },
    { reservation: surPlace({ id: "c" }), net: { commission_prevue: 300 }, paiement: null, deja: 0 },
    { reservation: chezNous({ id: "d", statut: "annule" }), net: {}, paiement: null, deja: 500 },
  ]);
  assert.deepEqual(lignes.map((l) => [l.reservation.id, l.emission.type, l.emission.montant]), [["b", "facture", 300], ["d", "avoir", 500]]);
});

test("libellé : service, date, initiales du client et référence du dossier, sans le nom ni le net", () => {
  assert.equal(initiales("Jane", "Example"), "J.E.");
  assert.equal(initiales("", "Müller-Lang"), "M.");
  assert.equal(initiales("", ""), "");
  const l = libelleFacture({ libelle: "Longtail 4 Islands", date_service: "2026-11-10" }, { dossierRef: "INV-2026-012", prenom: "Jane", nom: "Example" });
  assert.equal(l, "Commission on Longtail 4 Islands, service of 10 Nov 2026, guest J.E. (booking INV-2026-012)");
  assert.doesNotMatch(l, /Jane|Example/);
  assert.equal(libelleFacture({ libelle: "Transfer", date_service: null }, { dossierRef: "", prenom: "", nom: "" }), "Commission on Transfer");
});

test("numéro : une série pour les factures, une pour les avoirs, trois chiffres par année", () => {
  assert.equal(formaterNumero("facture", 2026, 1), "COM-2026-001");
  assert.equal(formaterNumero("facture", 2026, 42), "COM-2026-042");
  assert.equal(formaterNumero("avoir", 2026, 3), "CN-2026-003");
  assert.equal(formaterNumero("facture", 2027, 1000), "COM-2027-1000");
});

test("le document de la fiduciaire reprend le gabarit des factures : une ligne, le destinataire, l'émetteur figé", () => {
  const facture = {
    numero: "COM-2026-001", type: "facture", date_facture: "2026-11-12", montant: 300, devise: "THB",
    libelle: "Commission on Longtail 4 Islands, service of 10 Nov 2026, guest J.E. (booking INV-2026-012)",
    destinataire: { nom: "Rattana Tour Co., Ltd.", adresse: "1 Moo 2, Koh Lanta, Krabi 81150" },
  };
  const { doc, client, dossier } = contenuDepuisFacture(facture);
  assert.equal(doc.type, "facture");
  assert.equal(doc.date_emission, "2026-11-12");
  assert.equal(doc.contenu.numero, "COM-2026-001");
  assert.equal(doc.contenu.langue, "en");
  assert.equal(doc.contenu.devise, "THB");
  assert.equal(doc.contenu.lignes.length, 1);
  assert.equal(doc.contenu.lignes[0].libelle, facture.libelle);
  assert.equal(doc.contenu.lignes[0].montant, 300);
  assert.equal(doc.contenu.paiement, undefined, "aucun mode de paiement client : c'est une facture entre entreprises");
  assert.equal(client.nom, "Rattana Tour Co., Ltd.");
  assert.equal(client.adresse, "1 Moo 2, Koh Lanta, Krabi 81150");
  assert.equal(dossier.ref, "COM-2026-001");
  // Un avoir s'affiche en négatif, avec son propre titre.
  const avoir = contenuDepuisFacture({ ...facture, numero: "CN-2026-001", type: "avoir", montant: -100, avoir_de_numero: "COM-2026-001" });
  assert.equal(avoir.doc.contenu.lignes[0].montant, -100);
  assert.match(avoir.doc.contenu.lignes[0].libelle, /COM-2026-001/);
});

const F = (extra) => ({ id: "x", entite_slug: "secret", date_facture: "2026-11-12", envoyee_le: null, type: "facture", montant: 100, ...extra });

test("liste : filtres par entreprise, par mois et par envoi", () => {
  const liste = [
    F({ id: "a", entite_slug: "secret", date_facture: "2026-11-03" }),
    F({ id: "b", entite_slug: "taxi", date_facture: "2026-11-20", envoyee_le: "2026-11-21" }),
    F({ id: "c", entite_slug: "secret", date_facture: "2026-10-30", envoyee_le: "2026-11-02" }),
  ];
  const ids = (f) => filtrerFactures(liste, f).map((x) => x.id);
  assert.deepEqual(ids({}), ["a", "b", "c"]);
  assert.deepEqual(ids({ entite: "taxi" }), ["b"]);
  assert.deepEqual(ids({ mois: "2026-11" }), ["a", "b"]);
  assert.deepEqual(ids({ envoyee: "non" }), ["a"]);
  assert.deepEqual(ids({ envoyee: "oui" }), ["b", "c"]);
  assert.deepEqual(ids({ entite: "secret", mois: "2026-10", envoyee: "oui" }), ["c"]);
});

import { TH, MANQUE, remplir } from "../src/gestion/js/fiduciaire-textes.mjs";
import { aPreparerLocal, emettreLocal, envoyerLocal, calculLocal } from "../src/gestion/js/fiduciaire-local.mjs";
import { aujourdhui, ajouterJours, totalDossier, sommePaiements } from "../src/gestion/js/calc.mjs";
import { donneesDemo } from "../src/gestion/js/defauts.mjs";
import { permissionsDans } from "../src/gestion/js/droits.mjs";

test("textes thaïs : chaque ligne a sa traduction française et les mêmes {variables}", () => {
  for (const [cle, v] of Object.entries(TH)) {
    assert.ok(v.th && v.fr, cle);
    assert.deepEqual((v.th.match(/\{\w+\}/g) || []).sort(), (v.fr.match(/\{\w+\}/g) || []).sort(), `variables de ${cle}`);
    assert.match(v.th, /[฀-๿]/, `${cle} est bien en thaï`);
  }
  assert.equal(remplir(TH.cree.th, { numero: "COM-2026-001" }), "ออกใบแจ้งหนี้ COM-2026-001 แล้ว");
});

test("chaque raison qui bloque une facture a son texte pour les responsables", () => {
  const codes = new Set();
  const cas = [
    [{ paye_sur_place: true }, {}, null],
    [{ paye_sur_place: true }, { commission_recue: 10 }, null],
    [{ paye_sur_place: false, montant_vente: null }, {}, null],
    [{ paye_sur_place: false, montant_vente: 100 }, { net_paye: 100, paye_le: "2026-11-01" }, { regle: true, date: "2026-11-01" }],
  ];
  for (const [r, n, p] of cas) cibleAgence(r, n, p).manque.forEach((m) => codes.add(m));
  assert.ok(codes.size >= 5);
  for (const c of codes) assert.ok(MANQUE[c], c);
});

// La démonstration applique les mêmes règles que la base : l'assistante prépare et envoie, les responsables corrigent.
function demo() {
  const data = donneesDemo(aujourdhui(), ajouterJours);
  data.fiduciaire_factures = [];
  const qui = (nom) => {
    const u = data.profils.find((p) => p.nom.includes(nom));
    const ctx = { profil: u, membres: data.membres, roles: data.roles };
    return {
      droit: (e, c) => permissionsDans(ctx, e).includes(c),
      resumeDe: (d) => ({ total: totalDossier(data.documents.filter((x) => x.dossier_id === d.id)), recu: sommePaiements(data.paiements.filter((p) => p.dossier_id === d.id)) }),
      utilisateurId: u.user_id,
      aujourdhui: aujourdhui(),
    };
  };
  return { data, mook: qui("vouchers seulement"), anais: qui("Administratrice") };
}

test("démo : l'assistante voit les montants qui reviennent à l'agence, sans écart ni net, et émet une facture", () => {
  const { data, mook } = demo();
  const l = aPreparerLocal(data, mook);
  assert.ok(l.length > 0);
  assert.ok(l.every((x) => x.ecart === null));
  const premiere = l.find((x) => x.type === "facture");
  const id = emettreLocal(data, mook, premiere.reservation_id);
  const f = data.fiduciaire_factures.find((x) => x.id === id);
  assert.equal(f.numero, `COM-${f.annee}-001`);
  assert.equal(f.montant, premiere.montant);
  assert.equal(f.emetteur.emetteur.nom, data.reglages[data.entites.find((e) => e.slug === "excursions").id].emetteur.nom);
  assert.throws(() => emettreLocal(data, mook, premiere.reservation_id), /déjà facturé|Rien à facturer/);
  const deuxieme = aPreparerLocal(data, mook).find((x) => x.type === "facture");
  const id2 = emettreLocal(data, mook, deuxieme.reservation_id);
  assert.equal(data.fiduciaire_factures.find((x) => x.id === id2).numero, `COM-${f.annee}-002`, "numéros consécutifs sans trou");
});

test("démo : l'assistante ne retire pas la mention d'envoi, ne revoit pas le calcul et n'émet pas d'avoir", () => {
  const { data, mook, anais } = demo();
  const l = aPreparerLocal(data, mook).find((x) => x.type === "facture" && x.cas === "sur_place" && x.destinataire_adresse);
  assert.ok(l, "la démonstration a des services payés sur place");
  const id = emettreLocal(data, mook, l.reservation_id);
  assert.equal(envoyerLocal(data, mook, [id], "2026-12-01"), 1);
  assert.throws(() => envoyerLocal(data, mook, [id], null), /responsables/);
  assert.equal(envoyerLocal(data, anais, [id], null), 1);
  assert.throws(() => calculLocal(data, mook, l.reservation_id), /Droit insuffisant/);
  assert.equal(calculLocal(data, anais, l.reservation_id).cible, l.montant);
  // La commission est corrigée à la baisse : seul un responsable émet l'avoir.
  const n = data.reservations_nets.find((x) => x.reservation_id === l.reservation_id);
  n.commission_recue = l.montant - 100;
  assert.throws(() => emettreLocal(data, mook, l.reservation_id), /responsables/);
  const idAvoir = emettreLocal(data, anais, l.reservation_id, "2026-12-05");
  const avoir = data.fiduciaire_factures.find((x) => x.id === idAvoir);
  assert.equal(avoir.montant, -100);
  assert.equal(avoir.numero, `CN-2026-001`);
  assert.equal(avoir.avoir_de, id);
});
