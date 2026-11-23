// « Mettre la facture comme la réservation » (23.11.2026). Sur un dossier de Secret, la ligne de facture disait 3 × 950 = 2 850 et la
// réservation 2 900 : 2 900 / 3 ne tombe pas juste, le prix partait dans `reste`, la facture ne changeait pas et l'écran affichait quand même
// « Facture alignée ». Une ligne unique prend maintenant le total (quantité gardée, prix unitaire effacé), plusieurs lignes disent pourquoi.
// Le calcul (operations-calc.mjs), puis le vrai bouton de la carte sur la démo et un DOM minimal (aides-dom.mjs).
// Données inventées : aucun client, hôtel ni partenaire réel.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { installerDom } from "./aides-dom.mjs";

const dom = installerDom();
globalThis.location.search = "?demo";
const E = await import("../src/gestion/js/etat.mjs");
await E.init();
const { contenuAvecService, attenduDepuisFacture, ecartReservation, descriptionService } = await import("../src/gestion/js/operations-calc.mjs");
const { totaux, montantLigne } = await import("../src/gestion/js/calc.mjs");
const { partRemise } = await import("../src/gestion/js/fiduciaire-calc.mjs");
const { suitePrixDocument } = await import("../src/gestion/js/encaisser-calc.mjs");
const { raisonsNonAlignees } = await import("../src/gestion/js/views/suivi-facture.mjs");
const { carteReservation } = await import("../src/gestion/js/views/reservations.mjs");
after(() => setTimeout(() => process.exit(process.exitCode || 0), 50).unref());

// La ligne du cas réel, rendue fictive : un tour par personne, 3 passagers à 950.
const ligne = (o = {}) => ({ id: "l1", kind: "ligne", titre: "Tour Exemple", libelle: "Tour Exemple, 3 passengers, 12 Dec 2026", intro: "(per person)", par: "pp", unite: 950, qte: 3, date_service: "2026-12-12", partenaire_id: "p1", net: 700, ...o });
const facture = (lignes, o = {}) => ({ langue: "en", devise: "THB", tva: true, lignes, ...o });
const resa = (o = {}) => ({ id: "r1", ligne_id: "l1", dossier_id: "D1", libelle: "Tour Exemple", partenaire_id: "p1", date_service: "2026-12-12", personnes: { adultes: 3, enfants: 0 }, montant_vente: 2900, ...o });

test("3 × 950 → 2 900 : la ligne prend le total, garde ses 3 passagers et n'invente pas de prix unitaire", () => {
  const c = facture([ligne()]);
  const r = resa();
  const s = contenuAvecService(c, r, { montant_vente: 2900 });
  assert.deepEqual(s.reste, [], "rien ne reste");
  const l = s.contenu.lignes[0];
  assert.equal(l.montant, 2900);
  assert.equal(l.unite, null, "pas de 966,67 arrondi");
  assert.equal(l.qte, 3, "la quantité compte toujours les personnes");
  assert.equal(l.intro, "", "la mention « (per person) » ne colle plus à un prix total");
  assert.equal(l.par, "pp", "l'unité du catalogue reste connue");
  assert.equal(l.net, 700, "le net ne bouge pas");
  assert.match(l.libelle, /3 passengers/, "le libellé dit toujours 3 passagers");
  assert.match(descriptionService(l, "en"), /3 passengers/);
  // Total, sous-total, reste à payer après un montant reçu, part d'une remise : tous partent de 2 900.
  assert.equal(montantLigne(l), 2900);
  const t = totaux(s.contenu, 1000);
  assert.equal(t.sousTotal, 2900);
  assert.equal(t.net, 2900);
  assert.equal(t.reste, 1900, "montant reçu 1 000 : il reste 1 900");
  assert.equal(s.contenu.tva, true, "la mention TVA du document ne change pas");
  assert.equal(s.contenu.devise, "THB");
  assert.equal(partRemise({ lignes: [l, { id: "x", kind: "remise", pct: 10 }] }, ["l1"], 2900), 290, "fiduciaire : la remise porte sur 2 900");
  // La réservation et la facture disent maintenant la même chose : plus d'écart, même nombre de personnes.
  const a = attenduDepuisFacture(r, { contenu: s.contenu });
  assert.equal(a.montant_vente, 2900);
  assert.deepEqual(a.personnes, { adultes: 3, enfants: 0 });
  assert.equal(ecartReservation(r, { contenu: s.contenu }), null, "aucun écart");
});

test("un prix qui tombe juste garde le prix unitaire (3 × 1 000)", () => {
  const s = contenuAvecService(facture([ligne()]), resa({ montant_vente: 3000 }), { montant_vente: 3000 });
  assert.deepEqual(s.reste, []);
  assert.equal(s.contenu.lignes[0].unite, 1000);
  assert.equal(s.contenu.lignes[0].qte, 3);
  assert.equal(s.contenu.lignes[0].intro, "(per person)");
  assert.equal(totaux(s.contenu).net, 3000);
});

test("une ligne déjà au prix total le reste, et un montant fixe sans quantité suit comme avant", () => {
  const forfait = facture([ligne({ unite: null, montant: 2900, intro: "" })]);
  const s = contenuAvecService(forfait, resa({ montant_vente: 3000 }), { montant_vente: 3000 });
  assert.equal(s.contenu.lignes[0].montant, 3000, "3 000 tomberait juste, mais la ligne ne redevient pas 3 × 1 000 en douce");
  assert.equal(s.contenu.lignes[0].unite, null);
  const sansQte = facture([{ id: "l1", kind: "ligne", libelle: "Tour Exemple", montant: 2500 }]);
  assert.equal(contenuAvecService(sansQte, resa(), { montant_vente: 2900 }).contenu.lignes[0].montant, 2900);
  // À encaisser (PR 331) passe par le même calcul : la facture locale suit aussi, au lieu de garder l'ancien prix.
  const loc = { id: "g", type: "facture_locale", contenu: facture([ligne()]) };
  const p = suitePrixDocument(loc, resa(), 2000);
  assert.equal(p.raison, null);
  assert.equal(p.contenu.lignes[0].montant, 2000);
  assert.equal(totaux(p.contenu).net, 2000);
});

test("plusieurs lignes (adulte, enfant) : rien n'est deviné, le prix reste et la raison est dite", () => {
  const c = facture([ligne({ qte: 2, libelle: "Tour Exemple, 2 adults" }), ligne({ id: "l2", titre: "Tour Exemple, child", libelle: "Tour Exemple, child, 1 child", intro: "(child)", par: "ch", unite: 500, qte: 1 })]);
  const r = resa({ details: { lignes_ids: ["l2"] }, personnes: { adultes: 2, enfants: 1 } });
  const s = contenuAvecService(c, r, { montant_vente: 2900 });
  assert.equal(s.contenu, null, "les lignes ne bougent pas");
  assert.deepEqual(s.reste, [{ cle: "montant_vente", reservation: 2900, facture: 2400 }]);
  assert.equal(totaux(c).net, 2400);
  const champs = ecartReservation(r, { contenu: c }).champs;
  const non = raisonsNonAlignees({ nonAlignes: champs.map((x) => ({ cle: x.cle, texte: x.cle })), reste: s.reste, lignes: 2 });
  assert.deepEqual(non.ecarts, ["montant_vente"]);
  assert.equal(non.raisons.length, 1);
  assert.match(non.raisons[0], /réparti sur 2 lignes/);
  assert.match(non.raisons[0], /Corrigez les prix dans la facture, ou alignez la réservation sur la facture/);
  assert.deepEqual(raisonsNonAlignees({}), { ecarts: [], raisons: [] }, "tout aligné : rien à dire");
  // Le tarif sur plusieurs lignes adultes n'est pas un écart affiché : il est dit à part.
  const t = raisonsNonAlignees({ reste: [{ cle: "prestation_id", reservation: "p2", facture: "p1" }], lignes: 2 });
  assert.equal(t.ecarts.length, 1);
  assert.match(t.raisons[0], /plusieurs lignes adultes/);
});

// ---- Le vrai bouton, sur la démo ----------------------------------------------------------------------------------------------------
const entite = (slug) => E.etat.brut.entites.find((e) => e.slug === slug);
E.changerEntite(entite("excursions").id, { naviguer: false });
let n = 0;
async function dossierAvec(lignes, resaEn, docEn = {}) {
  const client = await E.inserer("clients", { civilite: "", prenom: "Client", nom: `Aligner ${++n}`, adresse: "", telephone: `+4179002${1000 + n}`, email: "", notes: "" });
  const dossier = await E.inserer("dossiers", { ref: `AF-${n}`, client_id: client.id, pays: "", bandeau: "", accepte_le: "2026-11-23", annule: false, notes: "" });
  const doc = await E.inserer("documents", { dossier_id: dossier.id, type: "facture", date_emission: "2026-11-23", envoye_le: null, updated_at: new Date().toISOString(), contenu: facture(lignes), ...docEn });
  const r = await E.inserer("reservations", { dossier_id: dossier.id, statut: "confirme", paye_sur_place: false, notes: "", ...resaEn });
  return { dossier, doc, r };
}
const docDe = (id) => E.etat.db.documents.find((x) => x.id === id);
const resaDe = (id) => E.etat.db.reservations.find((x) => x.id === id);
const textesToasts = () => (dom.parId("toasts") ? dom.parId("toasts").childNodes.map((t) => t.textContent) : []);
const viderToasts = () => dom.parId("toasts") && dom.parId("toasts").childNodes.slice().forEach((t) => t.remove());
async function cliquerAligner(doc, r) {
  const carte = carteReservation(resaDe(r.id), { avecDossier: false, ecart: (x) => ecartReservation(x, docDe(doc.id)) });
  dom.document.body.append(carte);
  const [bouton] = dom.boutons("Mettre la facture comme la réservation", carte);
  assert.ok(bouton, "le bandeau propose d'aligner la facture");
  viderToasts();
  bouton.click();
  await dom.attendre(40);
  carte.remove();
}
const fenetre = () => dom.document.querySelectorAll(".modal-corps").slice(-1)[0] || null;
const fermerFenetres = () => dom.boutons("Fermer").concat(dom.boutons("Annuler")).forEach((b) => b.click());

test("écran : 3 × 950 et une réservation à 2 900, le clic écrit 2 900 sur la facture et dit « Facture alignée »", async () => {
  const lid = "la-1";
  const { doc, r } = await dossierAvec([ligne({ id: lid })], { ligne_id: lid, libelle: "Tour Exemple", partenaire_id: null, date_service: "2026-12-12", personnes: { adultes: 3, enfants: 0 }, montant_vente: 2900 });
  // La ligne n'a pas de partenaire dans la démo : on aligne la réservation dessus pour ne garder que l'écart de prix.
  await E.modifier("documents", doc.id, { contenu: { ...docDe(doc.id).contenu, lignes: [{ ...ligne({ id: lid }), partenaire_id: null }] } });
  assert.deepEqual(ecartReservation(resaDe(r.id), docDe(doc.id)).champs.map((c) => c.cle), ["montant_vente"]);
  await cliquerAligner(doc, r);
  const l = docDe(doc.id).contenu.lignes[0];
  assert.equal(l.montant, 2900);
  assert.equal(l.unite, null);
  assert.equal(l.qte, 3);
  assert.equal(totaux(docDe(doc.id).contenu).net, 2900);
  assert.equal(ecartReservation(resaDe(r.id), docDe(doc.id)), null, "plus d'écart sur la carte");
  assert.ok(textesToasts().includes("Facture alignée sur la réservation."), textesToasts().join(" | "));
});

test("écran : adulte et enfant, rien n'est écrit, la fenêtre dit ce qui reste et pourquoi, jamais « Facture alignée »", async () => {
  const { doc, r } = await dossierAvec([ligne({ id: "lb-1", qte: 2, partenaire_id: null }), ligne({ id: "lb-2", titre: "Tour Exemple, child", libelle: "Tour Exemple, child", intro: "(child)", par: "ch", unite: 500, qte: 1, partenaire_id: null })], { ligne_id: "lb-1", details: { lignes_ids: ["lb-2"] }, libelle: "Tour Exemple", partenaire_id: null, date_service: "2026-12-12", personnes: { adultes: 2, enfants: 1 }, montant_vente: 2900 });
  const avant = structuredClone(docDe(doc.id).contenu);
  await cliquerAligner(doc, r);
  assert.deepEqual(docDe(doc.id).contenu, avant, "la facture ne change pas");
  assert.ok(!textesToasts().includes("Facture alignée sur la réservation."), "pas de « Facture alignée » quand rien n'a suivi");
  const f = fenetre();
  assert.ok(f, "une fenêtre reste ouverte");
  assert.match(f.textContent, /Rien n'a pu être reporté sur la facture/);
  assert.match(f.textContent, /Montant vendu/);
  assert.match(f.textContent, /réparti sur 2 lignes/);
  assert.ok(dom.boutons("Ouvrir la facture", f).length, "un bouton mène à la facture");
  fermerFenetres();
});

test("écran : facture déjà envoyée, la confirmation est demandée et « Annuler » ne change rien", async () => {
  const { doc, r } = await dossierAvec([ligne({ id: "lc-1", partenaire_id: null })], { ligne_id: "lc-1", libelle: "Tour Exemple", partenaire_id: null, date_service: "2026-12-12", personnes: { adultes: 3, enfants: 0 }, montant_vente: 2900 }, { envoye_le: "2026-11-20" });
  const avant = structuredClone(docDe(doc.id).contenu);
  const carte = carteReservation(resaDe(r.id), { avecDossier: false, ecart: (x) => ecartReservation(x, docDe(doc.id)) });
  dom.document.body.append(carte);
  dom.boutons("Mettre la facture comme la réservation", carte)[0].click();
  await dom.attendre(20);
  const f = fenetre();
  assert.match(f.textContent, /2'850 à THB 2'900/);
  assert.match(f.textContent, /envoyée au client le/);
  dom.boutons("Annuler", f)[0].click();
  await dom.attendre(20);
  assert.deepEqual(docDe(doc.id).contenu, avant, "renoncer laisse la facture telle quelle");
  // Puis on confirme : la facture prend le total.
  dom.boutons("Mettre la facture comme la réservation", carte)[0].click();
  await dom.attendre(20);
  dom.boutons("Enregistrer", fenetre())[0].click();
  await dom.attendre(40);
  assert.equal(docDe(doc.id).contenu.lignes[0].montant, 2900);
  carte.remove();
});
