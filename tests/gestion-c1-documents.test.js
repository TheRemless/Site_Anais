// tests/gestion-c1-documents.test.js : lot C1 de l'autonomie (17.11.2026), devis et factures.
// Facture envoyée figée et renvoyée, lignes sans prix et offertes, numéro unique, devise écrite, acompte figé, relance, période anglaise.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const calc = () => import("../src/gestion/js/calc.mjs");
const docs = () => import("../src/gestion/js/documents-calc.mjs");
const source = (f) => fs.readFileSync(path.join(__dirname, "..", "src", "gestion", "js", f), "utf8");

const REGL = {
  devise: "CHF",
  emetteur: { nom: "Agence", adresse: "1 rue", telephone: "+41", licence: "00/1", contact: "x" },
  paiement: { nom: "Principal", texte: "IBAN CH00", autres: [{ id: "thb", nom: "Banque THB", texte: "Bangkok Bank 000", qr_image: "", qr_pseudo: "" }] },
  apparence: { qr_image: "data:qr", qr_pseudo: "@wise" },
  conditions: { acompte_pct: 30, delai_jours: 10, relance_jours: 7 },
};
const facture = (lignes, extra = {}) => ({ id: "f1", type: "facture", date_emission: "2026-11-10", envoye_le: null, contenu: { devise: "CHF", lignes, ...extra } });

test("décision 1 : l'envoi fige l'émetteur, la banque, la devise et l'acompte, et garde une trace", async () => {
  const { patchEnvoi, etatEnvoi, reglagesDuDocument, paiementDuDocument } = await docs();
  const f = facture([{ id: "l1", kind: "ligne", libelle: "Tour", montant: 100 }]);
  const p = patchEnvoi(f, REGL, { date: "2026-11-11", paiements: [{ montant: 30 }] });
  assert.equal(p.envoye_le, "2026-11-11");
  assert.equal(p.contenu.montant_recu, 30, "le montant reçu se fige d'après les paiements");
  assert.deepEqual(p.contenu.fige.emetteur, REGL.emetteur);
  assert.equal(p.contenu.fige.paiement.texte, "IBAN CH00");
  assert.equal(p.contenu.fige.acompte_pct, 30);
  assert.equal(p.contenu.envois.length, 1);
  const envoyee = { ...f, ...p };
  assert.equal(etatEnvoi(envoyee).modifie, false);
  // Les réglages changent ensuite : le document garde ceux de l'envoi.
  const apres = { ...REGL, emetteur: { ...REGL.emetteur, adresse: "Nouvelle adresse" }, paiement: { ...REGL.paiement, texte: "IBAN NOUVEAU" }, conditions: { ...REGL.conditions, acompte_pct: 50 } };
  const r = reglagesDuDocument(apres, envoyee.contenu);
  assert.equal(r.emetteur.adresse, "1 rue");
  assert.equal(r.conditions.acompte_pct, 30);
  assert.equal(paiementDuDocument(apres, envoyee.contenu).texte, "IBAN CH00");
  // Un document jamais envoyé suit les réglages du jour.
  assert.equal(paiementDuDocument(apres, f.contenu).texte, "IBAN NOUVEAU");
});

test("décision 1 : une modification après l'envoi se voit, « Renvoyer » ajoute un envoi", async () => {
  const { patchEnvoi, etatEnvoi, reglagesChanges } = await docs();
  const f = facture([{ id: "l1", kind: "ligne", libelle: "Tour", montant: 100 }]);
  const envoyee = { ...f, ...patchEnvoi(f, REGL, { date: "2026-11-11" }) };
  envoyee.contenu.lignes[0].montant = 120;
  assert.equal(etatEnvoi(envoyee).modifie, true, "le prix a changé depuis l'envoi");
  const renvoyee = { ...envoyee, ...patchEnvoi(envoyee, REGL, { date: "2026-11-12" }) };
  const e = etatEnvoi(renvoyee);
  assert.equal(e.modifie, false);
  assert.deepEqual(e.envois.map((x) => x.le), ["2026-11-11", "2026-11-12"]);
  assert.equal(renvoyee.envoye_le, "2026-11-12");
  // Un ancien document envoyé avant cette version n'a pas d'empreinte : pas de fausse alerte.
  assert.equal(etatEnvoi({ ...f, envoye_le: "2026-10-01" }).modifie, false);
  assert.equal(reglagesChanges({ ...REGL, paiement: { ...REGL.paiement, texte: "AUTRE" } }, renvoyee.contenu), true);
  assert.equal(reglagesChanges(REGL, renvoyee.contenu), false);
});

test("point 64 : retirer la date d'envoi oublie le dernier envoi seulement", async () => {
  const { patchEnvoi, patchRetraitEnvoi } = await docs();
  const f = facture([{ id: "l1", kind: "ligne", libelle: "Tour", montant: 100 }]);
  const une = { ...f, ...patchEnvoi(f, REGL, { date: "2026-11-11" }) };
  const deux = { ...une, ...patchEnvoi(une, REGL, { date: "2026-11-12" }) };
  const r1 = patchRetraitEnvoi(deux);
  assert.equal(r1.envoye_le, "2026-11-11", "on revient au premier envoi");
  assert.equal(r1.contenu.envois.length, 1);
  const r0 = patchRetraitEnvoi({ ...une });
  assert.equal(r0.envoye_le, null);
  assert.equal(r0.contenu.fige, undefined);
  assert.equal(r0.contenu.montant_recu, null);
  // Le retrait se confirme dans l'éditeur.
  assert.match(source("views/editeur.mjs"), /confirmer\(message, tr\("Retirer la date d'envoi"\), true\)/);
});

test("point 32 : au renvoi, l'écart entre le montant reçu imprimé et les paiements est proposé", async () => {
  const { ecartRecu } = await docs();
  const f = facture([], { montant_recu: 30 });
  assert.deepEqual(ecartRecu(f, [{ montant: 30 }, { montant: 70 }]), { imprime: 30, paiements: 100 });
  assert.equal(ecartRecu(f, [{ montant: 30 }]), null);
  assert.equal(ecartRecu(facture([]), [{ montant: 30 }]), null, "montant reçu non figé : il suit déjà les paiements");
});

test("décision 8 : une ligne sans prix bloque l'envoi d'une facture, une ligne offerte compte 0", async () => {
  const { lignesSansPrix, envoiBloque, ligneSansPrix } = await docs();
  const { totaux, montantLigne } = await calc();
  const lignes = [
    { id: "a", kind: "ligne", libelle: "Tour payé", montant: 100 },
    { id: "b", kind: "ligne", libelle: "Tour sans prix", montant: null },
    { id: "c", kind: "ligne", libelle: "Kayak offert", montant: 50, offert: true },
    { id: "d", kind: "ligne", libelle: "Inclus", texte_montant: "inclus" },
    { id: "e", kind: "bloc", libelle: "Formule (prix sur les lignes)" },
    { id: "f", kind: "ligne", libelle: "Prix × quantité", unite: 10, qte: 2 },
    { id: "g", kind: "ligne", libelle: "Prix zéro écrit", montant: 0 },
  ];
  assert.deepEqual(lignesSansPrix({ lignes }).map((l) => l.id), ["b"], "seul le prix vide manque ; 0 écrit est un prix");
  assert.equal(montantLigne(lignes[2]), 0, "offert compte 0");
  assert.equal(totaux({ lignes }).net, 120);
  assert.equal(envoiBloque(facture(lignes)), true);
  assert.equal(envoiBloque({ ...facture(lignes), type: "devis" }), false, "un devis peut partir");
  assert.equal(ligneSansPrix({ kind: "ligne", unite: 10 }), true, "un prix sans quantité ne suffit pas");
  // L'envoi refuse la facture, la saisie reste libre.
  assert.match(source("views/document-envoi.mjs"), /if \(refuserSansPrix\(doc\)\) return;/);
});

test("décision 8 : la ligne offerte s'imprime « Offert », « Complimentary » en anglais", async () => {
  const { texteOffert } = await docs();
  assert.equal(texteOffert(false), "Offert");
  assert.equal(texteOffert(true), "Complimentary");
  assert.match(source("document.mjs"), /l\.offert \? texteOffert\(enClient\)/);
});

test("« (à payer sur place) » : en anglais sur une facture de Secret ou de Taxi, même en langue principale", () => {
  const doc = source("document.mjs");
  assert.match(doc, /const enClient = en \|\| \(!c\.langue && \(reglagesDuJour\.fonctionnement === "excursions" \|\| reglagesDuJour\.fonctionnement === "taxi"\)\);/);
  assert.match(doc, /const TXT_PLACE = enClient\s*\?\s*\{ court: "pay on arrival"/);
});

test("point 65 : un seul numéro dans le PDF, le message, l'objet et le nom du fichier", async () => {
  const { numeroDocument, varsEnvoi, SECOURS_ENVOI } = await docs();
  const { nomFichier } = await calc();
  const { remplirGabarit } = await import("../src/gestion/js/operations-calc.mjs");
  const doc = { type: "facture", contenu: { numero: "INV-2026-019-B", langue: "en" } };
  const dossier = { ref: "INV-2026-019" };
  assert.equal(numeroDocument(doc, dossier), "INV-2026-019-B");
  assert.equal(nomFichier("facture", doc, dossier, { nom: "Delalandre" }), "Invoice INV-2026-019-B - Delalandre");
  const v = varsEnvoi({ en: true, prenom: "Aurore", numero: numeroDocument(doc, dossier) });
  assert.equal(remplirGabarit(SECOURS_ENVOI.en.envoi_facture, v), "Hello Aurore, here is your invoice INV-2026-019-B.");
  assert.equal(remplirGabarit(SECOURS_ENVOI.en.objet_facture, v), "Your invoice INV-2026-019-B");
  assert.equal(remplirGabarit(SECOURS_ENVOI.fr.envoi_devis, varsEnvoi({ en: false, numero: "ZT-1" })), "Bonjour, voici votre devis ZT-1.");
  assert.equal(numeroDocument({ contenu: {} }, dossier), "INV-2026-019");
});

test("section 2 : message et objet de l'envoi sont des modèles de l'écran Messages", async () => {
  const { MESSAGES_DEFAUT, messagesDefautPour } = await import("../src/gestion/js/defauts.mjs");
  const { SECOURS_ENVOI } = await docs();
  for (const langue of ["fr", "en"]) for (const cle of ["envoi_devis", "envoi_facture", "objet_devis", "objet_facture"]) {
    const m = MESSAGES_DEFAUT.find((x) => x.cle === cle && x.langue === langue);
    assert.ok(m, `${cle} ${langue}`);
    assert.equal(m.corps, SECOURS_ENVOI[langue][cle], "le modèle par défaut donne le texte d'avant");
  }
  assert.ok(messagesDefautPour({ fonctionnement: "excursions" }).some((m) => m.cle === "envoi_facture" && m.langue === "en"));
  assert.match(source("views/document-envoi.mjs"), /gabaritsPropose\(messagesTypes\(\), messagesDefautPour\(regl\)/);
});

test("point 33 : le numéro d'un dossier dont un document est parti se verrouille", async () => {
  const { numeroVerrouille } = await docs();
  assert.equal(numeroVerrouille([{ type: "devis", envoye_le: null }]), false);
  assert.equal(numeroVerrouille([{ type: "facture", envoye_le: "2026-11-01" }]), true);
  const dossier = source("views/dossier.mjs");
  assert.match(dossier, /ref\.readOnly = refBloquee/);
  assert.match(dossier, /hidden: !refBloquee \|\| !estAdmin\(\)/, "seule l'administratrice déverrouille");
  assert.match(source("views/editeur.mjs"), /numeroDoc\.readOnly = bloque;/);
});

test("point 35 : la devise est toujours écrite, et les noms de devises se règlent", async () => {
  const { infoDevise, lireDevisesNoms, ecrireDevisesNoms } = await docs();
  assert.deepEqual(infoDevise({}, "EUR"), { nom: "Euro", symbole: "€" });
  assert.deepEqual(infoDevise({ devises_noms: { THB: { nom: "Baht thaïlandais", symbole: "฿" } } }, "THB"), { nom: "Baht thaïlandais", symbole: "฿" });
  assert.deepEqual(infoDevise({}, "SGD"), { nom: "SGD", symbole: "SGD" });
  const o = lireDevisesNoms("thb | Thai Baht | ฿\n\nEUR|Euro|€");
  assert.deepEqual(o, { THB: { nom: "Thai Baht", symbole: "฿" }, EUR: { nom: "Euro", symbole: "€" } });
  assert.equal(ecrireDevisesNoms(o), "THB | Thai Baht | ฿\nEUR | Euro | €");
  const editeur = source("views/editeur.mjs");
  assert.match(editeur, /c\.devise = e\.target\.value;/, "même la devise de l'entreprise s'écrit");
  assert.match(editeur, /if \(deviseAEcrire\) c\.devise = regl\.devise;/);
  assert.match(source("store-local.mjs"), /ligne\.contenu = \{ \.\.\.ligne\.contenu, devise:/);
  assert.match(source("views/reglages.mjs"), /tr\("Changer la devise"\)/, "avertissement avant de changer la devise de l'entreprise");
});

test("point 36 : l'acompte % est figé sur le dossier, pas relu dans les réglages", async () => {
  const { acomptePct, resume, statutDossier } = await calc();
  const reglages = { devise: "CHF", conditions: { acompte_pct: 50 } };
  const dossier = { id: "d", accepte_le: "2026-11-01", acompte_pct: 30 };
  const documents = [{ type: "devis", dossier_id: "d", date_emission: "2026-10-01", created_at: "1", envoye_le: "2026-10-02", contenu: { lignes: [{ kind: "ligne", montant: 1000 }] } }];
  const paiements = [{ dossier_id: "d", montant: 300 }];
  assert.equal(acomptePct(dossier, documents, reglages), 30);
  assert.equal(statutDossier({ dossier, documents, paiements, reglages }), "acompte", "300 reçus sur un acompte figé à 30 % : acompte reçu, même si les réglages disent 50 %");
  const r = resume(dossier, { documents, paiements, clients: [] }, reglages);
  assert.equal(r.pct, 30);
  assert.equal(r.statut, "acompte");
  // Sans colonne (migration pas encore appliquée), la copie figée du devis sert ; sinon les réglages.
  assert.equal(acomptePct({}, [{ type: "devis", contenu: { fige: { acompte_pct: 25 } } }], reglages), 25);
  assert.equal(acomptePct({}, [], reglages), 50);
});

test("point 86 : relance de devis, 0 jour veut dire jamais", async () => {
  const { joursRelance, aFaire } = await calc();
  assert.equal(joursRelance({ relance_jours: 0 }), 0);
  assert.equal(joursRelance({ relance_jours: "0" }), 0);
  assert.equal(joursRelance({ relance_jours: "" }), 7);
  assert.equal(joursRelance({}), 7);
  const r = { dossier: {}, statut: "devis_envoye", devisEnvoyeLe: "2026-10-01", total: 100, recu: 0, reste: 100 };
  assert.equal(aFaire([r], "2026-11-17", { conditions: { relance_jours: 0, acompte_pct: 0 } }).length, 0);
  assert.equal(aFaire([r], "2026-11-17", { conditions: { relance_jours: 7, acompte_pct: 0 } })[0].type, "devis_relance");
});

test("section 2 : le bandeau de période passe en anglais avec le document", async () => {
  const { periodeTexte } = await calc();
  const { bandeauDansLangue } = await docs();
  assert.equal(periodeTexte("2026-12-02", "2026-12-12"), "DU 2 AU 12 DÉCEMBRE 2026");
  assert.equal(periodeTexte("2026-12-02", "2026-12-12", "en"), "2 TO 12 DECEMBER 2026");
  assert.equal(periodeTexte("2026-11-28", "2026-12-05", "en"), "28 NOVEMBER TO 5 DECEMBER 2026");
  assert.equal(periodeTexte("2026-12-28", "2027-01-03", "en"), "28 DECEMBER 2026 TO 3 JANUARY 2027");
  assert.equal(periodeTexte("2026-12-02", null, "en"), "DECEMBER 2026");
  const d = { date_depart: "2026-12-02", date_retour: "2026-12-12" };
  assert.equal(bandeauDansLangue("VOYAGE EN THAÏLANDE - DU 2 AU 12 DÉCEMBRE 2026", d, "en"), "VOYAGE EN THAÏLANDE - 2 TO 12 DECEMBER 2026");
  assert.equal(bandeauDansLangue("VOYAGE EN THAÏLANDE - 2 TO 12 DECEMBER 2026", d, ""), "VOYAGE EN THAÏLANDE - DU 2 AU 12 DÉCEMBRE 2026");
  assert.equal(bandeauDansLangue("Titre libre", d, "en"), "Titre libre", "un titre sans la période ne change pas");
});

test("point 70 : la facture locale signale une facture corrigée depuis sa création", async () => {
  const { sourceLocale, localeEnRetard } = await docs();
  const f = facture([{ id: "l1", kind: "ligne", libelle: "Tour", montant: 100 }]);
  const locale = { type: "facture_locale", contenu: { source: sourceLocale(f, 36.5) } };
  assert.equal(localeEnRetard(locale, f), false);
  f.contenu.lignes[0].montant = 150;
  assert.equal(localeEnRetard(locale, f), true);
  assert.equal(locale.contenu.source.taux, 36.5, "le taux est gardé pour recréer la copie");
  assert.equal(localeEnRetard({ contenu: {} }, f), false, "une ancienne facture locale sans source : pas de fausse alerte");
});

test("points 13 et 50 : la facture d'un devis l'accepte, la facture recréée suit le gabarit anglais", () => {
  const dossier = source("views/dossier.mjs");
  assert.match(dossier, /if \(devis && !d\.accepte_le && !d\.annule\) \{\s*try \{\s*await modifier\("dossiers", d\.id, \{ accepte_le: ajd \}\);/);
  assert.match(dossier, /excursions \? \{ \.\.\.CONTENU_DEFAUT\(\), colonnes: "total", langue: langueClient\(regl\) === "en" \? "en" : ""/);
});

test("points 9 et 85 : corbeille des documents et suppression d'un dossier restaurable", () => {
  const dossier = source("views/dossier.mjs");
  assert.doesNotMatch(dossier, /irréversible/);
  assert.match(dossier, /Il reste 90 jours dans la corbeille/);
  assert.match(source("views/reglages.mjs"), /sectionCorbeilleDocuments\(\)/);
  assert.match(source("store-supabase.mjs"), /sb\.rpc\("restaurer_document", \{ p_document: documentId \}\)/);
  const sql = fs.readFileSync(path.join(__dirname, "..", "docs", "gestion", "migration-31-c1-documents.sql"), "utf8");
  assert.match(sql, /create or replace function restaurer_document\(p_document uuid\)/);
  assert.match(sql, /create or replace function fixer_prochain_numero\(/);
});

test("point 9 en démo : un document supprimé se restaure", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  const { creer } = await import("../src/gestion/js/store-local.mjs");
  const store = creer();
  const brut = await store.charger();
  const e = brut.entites[0].id;
  const d = brut.dossiers.find((x) => x.entite_id === e);
  const complet = await store.dossierComplet(d.id);
  const doc = complet.documents[0];
  assert.ok(doc, "le dossier de démo a un document");
  await store.supprimer("documents", doc.id);
  const liste = await store.documentsSupprimes(e);
  assert.ok(liste.some((x) => x.document_id === doc.id));
  assert.equal(await store.restaurerDocument(doc.id), d.id);
  assert.ok((await store.dossierComplet(d.id)).documents.some((x) => x.id === doc.id));
  assert.equal((await store.documentsSupprimes(e)).length, 0);
  // Prochain numéro : jamais sous un numéro déjà donné.
  const annee = new Date().getFullYear();
  const lu = await store.lireProchainNumero(e, annee);
  await assert.rejects(store.fixerProchainNumero(e, annee, lu.minimum - 1));
  assert.equal(await store.fixerProchainNumero(e, annee, lu.minimum + 40), lu.minimum + 40);
  assert.equal(await store.prochainNumeroRef(e, annee, 0), lu.minimum + 40);
  delete globalThis.localStorage;
});
