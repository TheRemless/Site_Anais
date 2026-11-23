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
const { contenuAvecService, contenuAvecReservation, attenduDepuisFacture, ecartReservation, descriptionService, estLigneEnfant } = await import("../src/gestion/js/operations-calc.mjs");
const { ligneDepuisPrestation, lignesDepuisTrajet } = await import("../src/gestion/js/partenaires-calc.mjs");
const { totaux, montantLigne } = await import("../src/gestion/js/calc.mjs");
const { partRemise } = await import("../src/gestion/js/fiduciaire-calc.mjs");
const { suitePrixDocument } = await import("../src/gestion/js/encaisser-calc.mjs");
const { raisonsNonAlignees } = await import("../src/gestion/js/views/suivi-facture.mjs");
const { carteReservation } = await import("../src/gestion/js/views/reservations.mjs");
after(() => setTimeout(() => process.exit(process.exitCode || 0), 50).unref());

// La ligne du cas réel, rendue fictive, faite comme l'outil la fait (ligneDepuisPrestation, sans `par` pour un tarif par personne) : un tour par
// personne, 3 passagers à 950. En excursions, la ligne porte son nom court (`titre`) et une description générée.
const TOUR = { id: "px", libelle: "Excursion Exemple", libelle_en: "Tour Exemple", prix_vente: 950, unite: "pp", partenaire_id: "p1" };
const prestationDe = (id) => (id === TOUR.id ? TOUR : null);
function ligne(o = {}, { langue = "en", qte = 3, prestation = TOUR } = {}) {
  const l = ligneDepuisPrestation(prestation, { net: 700 }, { langue, qte, date: "2026-12-12", uid: () => o.id || "l1" });
  const base = { ...l, titre: l.libelle, libelle: descriptionService(l, langue || "fr") };
  const fin = { ...base, ...o };
  return o.titre && !o.libelle ? { ...fin, libelle: descriptionService({ ...fin, libelle: fin.titre }, langue || "fr") } : fin;
}
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
  assert.equal(l.par, undefined, "une ligne par personne du catalogue n'a pas de `par` : la mention part quand même");
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

test("une ligne au prix total qui retombe juste repasse au prix unitaire, et un montant fixe sans quantité suit comme avant", () => {
  const forfait = facture([ligne({ unite: null, montant: 2900, intro: "" })]);
  const s = contenuAvecService(forfait, resa({ montant_vente: 3000 }), { montant_vente: 3000 }, { prestationDe });
  assert.deepEqual([s.contenu.lignes[0].unite, s.contenu.lignes[0].qte, s.contenu.lignes[0].montant, s.contenu.lignes[0].intro], [1000, 3, null, "(per person)"]);
  const toujours = contenuAvecService(forfait, resa({ montant_vente: 3100 }), { montant_vente: 3100 }).contenu.lignes[0];
  assert.deepEqual([toujours.unite, toujours.montant], [null, 3100], "3 100 / 3 ne tombe pas juste : le prix total reste");
  const sansQte = facture([{ id: "l1", kind: "ligne", libelle: "Tour Exemple", montant: 2500 }]);
  assert.equal(contenuAvecService(sansQte, resa(), { montant_vente: 2900 }).contenu.lignes[0].montant, 2900);
  // À encaisser (PR 331) passe par le même calcul : la facture locale suit aussi, au lieu de garder l'ancien prix.
  const loc = { id: "g", type: "facture_locale", contenu: facture([ligne()]) };
  const p = suitePrixDocument(loc, resa(), 2000);
  assert.equal(p.raison, null);
  assert.equal(p.contenu.lignes[0].montant, 2000);
  assert.equal(totaux(p.contenu).net, 2000);
});

test("la mention par personne part sans `par`, en français (ZTP) comme en anglais, et sur une ligne de trajet ; un enfant reste un enfant", () => {
  // ZTP : document en français, ligne sans titre (« Excursion Exemple (par personne) »).
  const fr = { ...ligneDepuisPrestation(TOUR, null, { langue: "", qte: 3, uid: () => "l1" }) };
  assert.equal(fr.intro, "(par personne)");
  const sfr = contenuAvecService({ langue: "", lignes: [fr] }, resa(), { montant_vente: 2900 }).contenu.lignes[0];
  assert.deepEqual([sfr.intro, sfr.unite, sfr.montant, sfr.qte], ["", null, 2900, 3], "plus de « Excursion (par personne) … 2'900 »");
  for (const [unite, attendu] of [["ad", "(per adult)"], ["ch", "(per child)"]]) {
    const l = ligneDepuisPrestation({ ...TOUR, unite }, null, { langue: "en", qte: 3, uid: () => "l1" });
    assert.equal(l.intro, attendu);
    const n = contenuAvecService({ langue: "en", lignes: [l] }, resa(), { montant_vente: 2900 }).contenu.lignes[0];
    assert.equal(n.intro, unite === "ch" ? "(child)" : "", unite);
    assert.equal(estLigneEnfant(n), unite === "ch", "la ligne enfant reste une ligne enfant");
    const retour = contenuAvecService({ langue: "en", lignes: [n] }, resa(), { montant_vente: 3000 }, { prestationDe: () => ({ ...TOUR, unite }) }).contenu.lignes[0];
    assert.equal(retour.intro, attendu, "la mention revient avec le prix unitaire");
  }
  // Trajet (bateau, van) : ligne « (par adulte) », sans `par` ni prestation.
  const [trajet] = lignesDepuisTrajet({ id: "t1", mode: "Bateau", de: "Port A", vers: "Port B", depart: "09:00", prix_adulte: 950, prix_enfant: 500 }, null, { langue: "", adultes: 3, uid: () => "l1" });
  assert.equal(trajet.intro, "(par adulte)");
  const st = contenuAvecService({ langue: "", lignes: [trajet] }, resa(), { montant_vente: 2900 }).contenu;
  assert.deepEqual([st.lignes[0].intro, totaux(st).net], ["", 2900]);
  assert.equal(contenuAvecService(st, resa(), { montant_vente: 3000 }).contenu.lignes[0].intro, "(par adulte)");
});

test("un prix total suit les personnes : 3 personnes à 2 900, puis 4 adultes (2 900, « 4 passengers »), puis 3 800 (4 × 950)", () => {
  const r3 = resa();
  const c1 = contenuAvecService(facture([ligne()]), r3, { montant_vente: 2900 }).contenu;
  const c2 = contenuAvecReservation(c1, r3, { personnes: { adultes: 3, enfants: 0 } }, { personnes: { adultes: 4, enfants: 0 } });
  assert.deepEqual(c2.reste, [], "rien ne reste en écart");
  const l2 = c2.contenu.lignes[0];
  assert.deepEqual([l2.qte, l2.unite, l2.montant], [4, null, 2900], "la quantité suit, le montant ne bouge pas");
  assert.match(l2.libelle, /4 passengers/);
  const r4 = resa({ personnes: { adultes: 4, enfants: 0 }, montant_vente: 3800 });
  assert.equal(ecartReservation({ ...r4, montant_vente: 2900 }, { contenu: c2.contenu }), null, "réservation à 4 et 2 900 : aucun écart");
  const l3 = contenuAvecService(c2.contenu, r4, { montant_vente: 3800 }, { prestationDe }).contenu.lignes[0];
  assert.deepEqual([l3.qte, l3.unite, l3.montant, l3.intro], [4, 950, null, "(per person)"]);
  assert.equal(totaux({ lignes: [l3] }).net, 3800);
  // Une ligne au prix total d'un autre nombre que les personnes d'avant (réglée à la main) ne bouge pas, et c'est dit.
  const main = contenuAvecReservation(facture([ligne({ unite: null, montant: 2900, qte: 5 })]), r3, { personnes: { adultes: 3, enfants: 0 } }, { personnes: { adultes: 4, enfants: 0 } });
  assert.equal(main.contenu, null);
  assert.equal(main.reste[0].cle, "adultes");
});

test("éditeur : une ligne au prix total montre « Total fixe » et dit que la quantité ne change pas le prix", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../src/gestion/js/views/editeur.mjs", import.meta.url), "utf8");
  assert.match(src, /prixTotal \? tr\("Total fixe"\) : tr\("Total fixe \(si pas de quantité\)"\)/);
  assert.match(src, /detail && prixTotal \? tr\("La quantité ne change pas le prix\."\)/);
});

test("plusieurs lignes (adulte, enfant) : rien n'est deviné, le prix reste et la raison est dite", () => {
  const c = facture([ligne({}, { qte: 2 }), ligne({ id: "l2", titre: "Tour Exemple, child", intro: "(per child)", unite: 500 }, { qte: 1 })]);
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
  const { doc, r } = await dossierAvec([ligne({ id: lid, prestation_id: null })], { ligne_id: lid, libelle: "Tour Exemple", partenaire_id: null, date_service: "2026-12-12", personnes: { adultes: 3, enfants: 0 }, montant_vente: 2900 });
  // La ligne n'a pas de partenaire dans la démo : on aligne la réservation dessus pour ne garder que l'écart de prix.
  await E.modifier("documents", doc.id, { contenu: { ...docDe(doc.id).contenu, lignes: [{ ...ligne({ id: lid, prestation_id: null }), partenaire_id: null }] } });
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
  const { doc, r } = await dossierAvec([ligne({ id: "lb-1", partenaire_id: null, prestation_id: null }, { qte: 2 }), ligne({ id: "lb-2", titre: "Tour Exemple, child", intro: "(per child)", unite: 500, partenaire_id: null, prestation_id: null }, { qte: 1 })], { ligne_id: "lb-1", details: { lignes_ids: ["lb-2"] }, libelle: "Tour Exemple", partenaire_id: null, date_service: "2026-12-12", personnes: { adultes: 2, enfants: 1 }, montant_vente: 2900 });
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

test("écran : seul le devis peut suivre, les écarts se lisent sur la facture (pas de « Facture alignée »)", async () => {
  const { doc, r } = await dossierAvec([ligne({ id: "ld-1", partenaire_id: null, prestation_id: null }, { qte: 2 }), ligne({ id: "ld-2", titre: "Tour Exemple, child", intro: "(per child)", unite: 500, partenaire_id: null, prestation_id: null }, { qte: 1 })], { ligne_id: "ld-1", details: { lignes_ids: ["ld-2"] }, libelle: "Tour Exemple", partenaire_id: null, date_service: "2026-12-12", personnes: { adultes: 2, enfants: 1 }, montant_vente: 2900 });
  // Le devis du même dossier n'a gardé que la ligne adulte : lui peut suivre le prix.
  const devis = await E.inserer("documents", { dossier_id: doc.dossier_id, type: "devis", date_emission: "2026-11-20", envoye_le: null, updated_at: new Date().toISOString(), contenu: facture([ligne({ id: "ld-1", partenaire_id: null, prestation_id: null }, { qte: 2 })]) });
  const avant = structuredClone(docDe(doc.id).contenu);
  await cliquerAligner(doc, r);
  assert.equal(totaux(docDe(devis.id).contenu).net, 2900, "le devis a suivi (2 × 1 450)");
  assert.deepEqual(docDe(doc.id).contenu, avant, "la facture n'a pas changé");
  assert.ok(!textesToasts().includes("Facture alignée sur la réservation."), textesToasts().join(" | "));
  const f = fenetre();
  assert.match(f.textContent, /La facture n'a pas changé|Rien n'a pu être reporté sur la facture/);
  assert.match(f.textContent, /THB 2'400 sur la facture/);
  assert.match(f.textContent, /réparti sur 2 lignes/);
  fermerFenetres();
});

test("écran : facture déjà envoyée, la confirmation est demandée et « Annuler » ne change rien", async () => {
  const { doc, r } = await dossierAvec([ligne({ id: "lc-1", partenaire_id: null, prestation_id: null })], { ligne_id: "lc-1", libelle: "Tour Exemple", partenaire_id: null, date_service: "2026-12-12", personnes: { adultes: 3, enfants: 0 }, montant_vente: 2900 }, { envoye_le: "2026-11-20" });
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
