// tests/gestion-calc.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../src/gestion/js/calc.mjs");

const reglages = { conditions: { acompte_pct: 50, delai_jours: 10, relance_jours: 7 } };
const devis = (lignes, extra = {}) => ({ type: "devis", date_emission: "2026-10-01", created_at: "1", contenu: { lignes }, ...extra });

test("totaux : devis par région (page 1 du modèle, CHF 540)", async () => {
  const { totaux } = await load();
  const t = totaux({
    lignes: [
      { kind: "bloc", libelle: "Formule par région" },
      { kind: "ligne", libelle: "Bangkok", montant: 120 },
      { kind: "ligne", libelle: "Chiang Mai", montant: 120 },
      { kind: "ligne", libelle: "Phuket", montant: 150 },
      { kind: "ligne", libelle: "Koh Lanta", montant: 150 },
    ],
  });
  assert.equal(t.net, 540);
  assert.equal(t.remises, 0);
});

test("totaux : tarif journalier avec remise d'un jour (CHF 774 - 43 = 731)", async () => {
  const { totaux, remiseJours } = await load();
  const lignes = [
    { kind: "bloc", unite: 43, qte: 18 },
    { kind: "remise", unite: 43, qte: remiseJours(18) },
  ];
  const t = totaux({ lignes });
  assert.equal(t.sousTotal, 774);
  assert.equal(t.remises, -43);
  assert.equal(t.net, 731);
});

test("totaux : remise en pourcentage (480 - 30% = 336)", async () => {
  const { totaux } = await load();
  const t = totaux({ lignes: [{ kind: "bloc", unite: 40, qte: 12 }, { kind: "remise", pct: 30 }] });
  assert.equal(t.sousTotal, 480);
  assert.equal(t.remises, -144);
  assert.equal(t.net, 336);
});

test("totaux : facture avec montant reçu donne le reste à payer", async () => {
  const { totaux, afficherSousTotal } = await load();
  const c = { lignes: [{ kind: "bloc", unite: 40, qte: 9 }] };
  const t = totaux(c, 180);
  assert.equal(t.net, 360);
  assert.equal(t.reste, 180);
  assert.equal(afficherSousTotal(c, 180), true);
  assert.equal(afficherSousTotal(c, 0), false);
});

test("remiseJours : un jour par tranche de 14", async () => {
  const { remiseJours } = await load();
  assert.equal(remiseJours(13), 0);
  assert.equal(remiseJours(14), 1);
  assert.equal(remiseJours(19), 1);
  assert.equal(remiseJours(28), 2);
});

test("formatMontant et formatDate", async () => {
  const { formatMontant, formatDate, setDevise } = await load();
  setDevise("CHF");
  assert.equal(formatMontant(540), "CHF 540");
  assert.equal(formatMontant(1234.5), "CHF 1'234.50");
  assert.equal(formatMontant(-43), "- CHF 43");
  assert.equal(formatDate("2026-10-09"), "09/10/2026");
});

test("genererRef : initiales, date AAAAMMJJ et pays comme dans les devis existants", async () => {
  const { genererRef } = await load();
  assert.equal(genererRef("Louis", "Dupont", "2026-10-09", "Thaïlande"), "LD20261009 Thaïlande");
  assert.equal(genererRef("Marie", "Dubois Martin", "2026-09-12", "Thaïlande"), "MD20260912 Thaïlande");
  assert.equal(genererRef("Lucie", "Bürgi", "2026-08-15", "Vietnam"), "LB20260815 Vietnam");
  assert.equal(genererRef("Gaëlle", "Dayer Rossi", "2026-01-23", "Thaïlande"), "GD20260123 Thaïlande");
});

test("statutDossier : le statut découle des faits", async () => {
  const { statutDossier } = await load();
  const base = { dossier: { id: "d1" }, reglages };
  const docs = [devis([{ kind: "bloc", unite: 40, qte: 9 }])]; // 360, acompte 180
  assert.equal(statutDossier({ ...base, documents: docs, paiements: [] }), "brouillon");
  const envoye = [{ ...docs[0], envoye_le: "2026-10-02" }];
  assert.equal(statutDossier({ ...base, documents: envoye, paiements: [] }), "devis_envoye");
  assert.equal(statutDossier({ dossier: { accepte_le: "2026-10-05" }, reglages, documents: envoye, paiements: [] }), "accepte");
  assert.equal(statutDossier({ dossier: { accepte_le: "2026-10-05" }, reglages, documents: envoye, paiements: [{ montant: 180 }] }), "acompte");
  assert.equal(statutDossier({ dossier: { accepte_le: "2026-10-05" }, reglages, documents: envoye, paiements: [{ montant: 180 }, { montant: 180 }] }), "solde");
  assert.equal(statutDossier({ dossier: { annule: true }, reglages, documents: envoye, paiements: [] }), "annule");
});

test("totalDossier : la facture prime sur le devis", async () => {
  const { totalDossier } = await load();
  const d = devis([{ kind: "bloc", montant: 400 }]);
  const f = { ...devis([{ kind: "bloc", montant: 450 }]), type: "facture", created_at: "2" };
  assert.equal(totalDossier([d]), 400);
  assert.equal(totalDossier([d, f]), 450);
});

test("aFaire : acompte en retard, devis à relancer, solde proche", async () => {
  const { aFaire, resume } = await load();
  const mk = (id, dossier, documents, paiements = []) => ({
    id,
    dossier: { id, ...dossier },
    documents,
    paiements,
    reste: 0,
    total: 400,
    devisEnvoyeLe: (documents.find((d) => d.type === "devis") || {}).envoye_le || null,
    statut: null,
  });
  const lignes = [{ kind: "bloc", unite: 40, qte: 10 }]; // 400
  const retard = mk("a", { accepte_le: "2026-10-01" }, [devis(lignes, { envoye_le: "2026-09-28" })]);
  retard.statut = "accepte";
  const relance = mk("b", {}, [devis(lignes, { envoye_le: "2026-10-10" })]);
  relance.statut = "devis_envoye";
  const solde = mk("c", { date_depart: "2026-11-10" }, [devis(lignes)], [{ montant: 200 }]);
  solde.statut = "acompte";
  solde.reste = 200;
  const items = aFaire([retard, relance, solde], "2026-10-28", reglages);
  assert.deepEqual(items.map((i) => i.type), ["acompte_retard", "solde_proche", "devis_relance"]);
  assert.equal(items[0].jours, 17); // échéance 11.10, aujourd'hui 28.10
  assert.ok(resume); // exporté
});

test("echeanceAcompte : date d'acceptation plus le délai", async () => {
  const { echeanceAcompte } = await load();
  assert.equal(echeanceAcompte({ accepte_le: "2026-10-05" }, reglages), "2026-10-15");
  assert.equal(echeanceAcompte({}, reglages), null);
});

test("periodeTexte : même mois, deux mois, deux années", async () => {
  const { periodeTexte } = await load();
  assert.equal(periodeTexte("2026-12-02", "2026-12-12"), "DU 2 AU 12 DÉCEMBRE 2026");
  assert.equal(periodeTexte("2027-03-27", "2027-04-10"), "DU 27 MARS AU 10 AVRIL 2027");
  assert.equal(periodeTexte("2026-12-28", "2027-01-10"), "DU 28 DÉCEMBRE 2026 AU 10 JANVIER 2027");
  assert.equal(periodeTexte("2026-11-05", ""), "NOVEMBRE 2026");
  assert.equal(periodeTexte("", ""), "");
});

test("formatMontant suit la devise de l'entreprise active", async () => {
  const { formatMontant, setDevise } = await load();
  setDevise("THB");
  assert.equal(formatMontant(1500), "THB 1'500");
  setDevise("CHF");
  assert.equal(formatMontant(1500), "CHF 1'500");
});

test("nouvelleRef : séquence annuelle par entreprise", async () => {
  const { nouvelleRef } = await load();
  const numerotation = { mode: "sequence", prefixe: "ST" };
  const args = { numerotation, dateIso: "2026-11-02", prenom: "", nom: "", pays: "" };
  assert.equal(nouvelleRef({ ...args, refsExistantes: [] }), "ST-2026-0001");
  assert.equal(nouvelleRef({ ...args, refsExistantes: ["ST-2026-0001", "ST-2026-0009", "ST-2025-0040", "X"] }), "ST-2026-0010");
  assert.equal(nouvelleRef({ ...args, numerotation: { mode: "sequence", prefixe: "" }, refsExistantes: ["2026-0003"] }), "2026-0004");
  // Numéros à trois chiffres (INV-2026-001), la suite reprend après un numéro saisi à la main.
  const trois = { ...args, numerotation: { mode: "sequence", prefixe: "INV", chiffres: 3 } };
  assert.equal(nouvelleRef({ ...trois, refsExistantes: [] }), "INV-2026-001");
  assert.equal(nouvelleRef({ ...trois, refsExistantes: ["INV-2026-001", "INV-2026-009"] }), "INV-2026-010");
});

test("nouvelleRef : initiales, avec lettre si la référence existe déjà", async () => {
  const { nouvelleRef } = await load();
  const args = { numerotation: { mode: "initiales" }, dateIso: "2026-10-09", prenom: "Louis", nom: "Dupont", pays: "Thaïlande" };
  assert.equal(nouvelleRef({ ...args, refsExistantes: [] }), "LD20261009 Thaïlande");
  assert.equal(nouvelleRef({ ...args, refsExistantes: ["LD20261009 Thaïlande"] }), "LD20261009b Thaïlande");
});

test("aFaire : sans acompte demandé, pas d'alerte d'acompte en retard", async () => {
  const { aFaire } = await load();
  const regl0 = { conditions: { acompte_pct: 0, delai_jours: 10, relance_jours: 7 } };
  const r = { dossier: { id: "a", accepte_le: "2026-10-01" }, documents: [devis([{ kind: "bloc", montant: 100 }])], paiements: [], reste: 100, statut: "accepte", total: 100 };
  assert.deepEqual(aFaire([r], "2026-10-28", regl0), []);
});

test("formatMontant : devise propre au document et sommes en plusieurs devises", async () => {
  const { formatMontant, formatSommes, setDevise } = await load();
  setDevise("CHF");
  assert.equal(formatMontant(1200, "THB"), "THB 1'200");
  assert.equal(formatSommes([{ montant: 550, devise: "CHF" }, { montant: 1200, devise: "THB" }, { montant: 50, devise: "CHF" }], "CHF"), "CHF 600 · THB 1'200");
  assert.equal(formatSommes([], "THB"), "THB 0");
});

test("equivalents : plusieurs devises, ancien format converti", async () => {
  const { equivalents, lignesEquivalents } = await load();
  assert.deepEqual(equivalents(360, [{ code: "EUR", taux: 1.058 }, { code: "THB", taux: 40.54 }, { code: "USD", taux: "" }]), [{ code: "EUR", montant: 381 }, { code: "THB", montant: 14594 }]);
  const anciennes = lignesEquivalents({ actif: true, eur: 1.1 }, { eur: 1, thb: 40 });
  assert.deepEqual(anciennes, [{ code: "EUR", taux: 1.1 }, { code: "THB", taux: 40 }]);
  assert.deepEqual(lignesEquivalents({ actif: true, lignes: [{ code: "USD", taux: 1.2 }] }), [{ code: "USD", taux: 1.2 }]);
});

test("resume : sans documents chargés, le dossier s'appuie sur le résumé tenu par la base", async () => {
  const { resume } = await load();
  const regl = { devise: "CHF", conditions: { acompte_pct: 50, delai_jours: 10, relance_jours: 7 } };
  const dossier = { id: "d", client_id: "c", accepte_le: "2026-10-01", annule: false, total: 360, recu: 180, devise: "THB", devis_envoye_le: "2026-09-20", a_facture: false };
  const r = resume(dossier, { documents: [], paiements: [], clients: [{ id: "c" }] }, regl);
  assert.equal(r.total, 360);
  assert.equal(r.reste, 180);
  assert.equal(r.devise, "THB");
  assert.equal(r.devisEnvoyeLe, "2026-09-20");
  assert.equal(r.statut, "acompte");
  const sansChiffres = resume({ ...dossier, total: undefined, recu: undefined, devise: undefined }, { documents: [], paiements: [], clients: [] }, regl);
  assert.equal(sansChiffres.statut, "accepte");
  assert.equal(sansChiffres.devise, "CHF");
});

test("réglages : nouvelles options complétées pour une entreprise existante", async () => {
  const { completerReglages } = await import("../src/gestion/js/defauts.mjs");
  const r = completerReglages({ emetteur: { nom: "X" }, libelles: { facture: "INVOICE" } });
  assert.equal(r.apparence.entete, "classique");
  assert.equal(r.numerotation.chiffres, 4);
  assert.equal(r.emetteur.sous_titre, "");
  assert.equal(r.libelles.facture, "INVOICE");
  assert.equal(r.libelles.colonne_montant, "");
  assert.equal(r.libelles.prestataire, "Prestataire :");
  assert.equal(r.libelles_en.facture, "INVOICE");
  assert.equal(r.libelles_en.prestataire, "Service provider:");
  assert.equal(r.conditions.tva_mention_en, "");
});

test("facture locale : taux entre devises et conversion du contenu", async () => {
  const { tauxVers, convertirContenu, totaux, resume } = await load();
  const regl = { devise: "CHF", taux: { eur: 1.058, thb: 40.54 }, conditions: { acompte_pct: 0 } };
  assert.equal(tauxVers(regl, "CHF", "THB"), 40.54);
  assert.equal(tauxVers(regl, "THB", "CHF"), Math.round((1 / 40.54) * 1000000) / 1000000);
  assert.equal(tauxVers(regl, "EUR", "THB"), Math.round((40.54 / 1.058) * 1000000) / 1000000);
  assert.equal(tauxVers(regl, "CHF", "USD"), null);

  const source = { devise: "CHF", colonnes: "detail", montant_recu: 100, libelle_recu: "Acompte", equivalents: { actif: true, eur: 1.05 }, lignes: [{ id: "a", kind: "formule", libelle: "Bateau", unite: 10, qte: 2, montant: 20 }, { id: "b", kind: "texte", libelle: "Note", montant: null, unite: null }] };
  const c = convertirContenu(source, 40, "THB");
  assert.equal(c.devise, "THB");
  assert.equal(c.lignes[0].montant, 800);
  assert.equal(c.lignes[0].unite, 400);
  assert.equal(c.lignes[1].montant, null);
  assert.equal(c.montant_recu, null);
  assert.equal(c.libelle_recu, undefined);
  assert.equal(c.equivalents.actif, false);
  assert.equal(source.lignes[0].montant, 20, "la source n'est pas modifiée");

  // Une facture locale ne compte ni dans le total ni dans le reste à payer du dossier.
  const dossier = { id: "d1", client_id: "c1", accepte_le: "2026-10-01", annule: false };
  const docs = [
    { dossier_id: "d1", type: "facture", date_emission: "2026-10-02", created_at: "1", contenu: { devise: "CHF", lignes: [{ kind: "formule", montant: 20 }] } },
    { dossier_id: "d1", type: "facture_locale", date_emission: "2026-10-02", created_at: "2", contenu: c },
  ];
  const r = resume(dossier, { documents: docs, paiements: [], clients: [] }, regl);
  assert.equal(r.total, 20);
});

test("modes de paiement : le principal puis les autres", async () => {
  const { modesPaiement, modePaiement, completerReglages } = await import("../src/gestion/js/defauts.mjs");
  const r = completerReglages({ paiement: { texte: "IBAN CH", autres: [{ id: "thb", nom: "Banque thaïlandaise", texte: "Account 123" }] }, apparence: { qr_image: "qr.png" } });
  const modes = modesPaiement(r);
  assert.equal(modes.length, 2);
  assert.equal(modes[0].nom, "Principal");
  assert.equal(modes[0].qr_image, "qr.png");
  assert.equal(modePaiement(r, "thb").texte, "Account 123");
  assert.equal(modePaiement(r, "inconnu").texte, "IBAN CH", "un mode supprimé retombe sur le principal");
  assert.equal(modePaiement(r, "").qr_image, "qr.png");
});

test("finDuMois : le dernier jour réel de chaque mois, bissextile compris", async () => {
  const { finDuMois } = await load();
  assert.equal(finDuMois("2026-11-01"), "2026-11-30");
  assert.equal(finDuMois("2026-11-30"), "2026-11-30");
  assert.equal(finDuMois("2026-10-15"), "2026-10-31");
  assert.equal(finDuMois("2026-02-10"), "2026-02-28");
  assert.equal(finDuMois("2028-02-10"), "2028-02-29");
  assert.equal(finDuMois("2026-12-31"), "2026-12-31");
});

test("arrondi : demi supérieur exact, comme le numeric de la base (remises, unité × quantité)", async () => {
  const { arrondi, produitArrondi, totaux } = await load();
  assert.equal(arrondi(8.325), 8.33);
  assert.equal(arrondi(1.005), 1.01);
  assert.equal(arrondi(-8.325), -8.33, "demi supérieur en valeur absolue, comme round() de Postgres");
  assert.equal(arrondi(0.1 + 0.2), 0.3);
  assert.equal(produitArrondi(8.2, 7.5, 100), 0.62, "8,2 × 7,5 % = 0,615 donne 0,62, pas 0,61");
  // cas relevés par l'audit : JavaScript et SQL divergeaient d'un centime
  assert.equal(totaux({ lignes: [{ kind: "ligne", montant: 111 }, { kind: "remise", pct: 7.5 }] }).net, 102.67);
  assert.equal(totaux({ lignes: [{ kind: "ligne", montant: 100.3 }, { kind: "remise", pct: 5 }] }).remises, -5.02);
  assert.equal(totaux({ lignes: [{ kind: "ligne", unite: 1.005, qte: 1 }] }).net, 1.01);
  // grille : chaque remise correspond au calcul entier exact (centimes, demi supérieur)
  let ecarts = 0;
  for (let s = 1; s <= 20000; s += 7)
    for (const p of [2.5, 7.5, 12.5, 15, 3.3, 8.75, 33.33]) {
      const attendu = Math.floor((s * Math.round(p * 100) + 5000) / 10000);
      const r = totaux({ lignes: [{ kind: "ligne", montant: s / 100 }, { kind: "remise", pct: p }] });
      if (Math.round(-r.remises * 100) !== attendu) ecarts++;
    }
  assert.equal(ecarts, 0);
});

test("numérotation : séquence annuelle, numéro proposé et numéro formaté", async () => {
  const { sequenceRef, refDepuisNumero, nouvelleRef } = await load();
  const num = { mode: "sequence", prefixe: "ST", chiffres: 4 };
  const refs = ["ST-2026-0001", "ST-2026-0007", "ST-2025-0099", "autre"];
  const s = sequenceRef({ numerotation: num, dateIso: "2026-11-06", refsExistantes: refs });
  assert.deepEqual(s, { debut: "ST-2026-", annee: 2026, dernier: 7 });
  assert.equal(refDepuisNumero(num, s.debut, 8), "ST-2026-0008");
  assert.equal(nouvelleRef({ numerotation: num, dateIso: "2026-11-06", refsExistantes: refs }), "ST-2026-0008");
  assert.equal(nouvelleRef({ numerotation: { mode: "sequence", prefixe: "", chiffres: 3 }, dateIso: "2027-01-02", refsExistantes: [] }), "2027-001");
  assert.equal(sequenceRef({ numerotation: num, dateIso: "2026-11-06", refsExistantes: [] }).dernier, 0);
});

test("À faire : un trop-perçu apparaît, un dossier annulé ou juste soldé n'y est pas", async () => {
  const { aFaire } = await load();
  const regl = { conditions: { acompte_pct: 0, relance_jours: 7, delai_jours: 10 } };
  const r = (statut, total, recu) => ({ dossier: { id: statut + total + recu }, statut, total, recu, reste: total - recu });
  const items = aFaire([r("solde", 1000, 1200), r("solde", 1000, 1000), r("annule", 1000, 1000), r("acompte", 1000, 400)], "2026-11-06", regl);
  assert.deepEqual(items.map((i) => i.type), ["trop_percu"]);
  assert.equal(items[0].resume.recu - items[0].resume.total, 200);
});

test("conditions d'un document en anglais : version anglaise de la variante, sinon celle de départ si le texte n'a pas été modifié, sinon signalé", async () => {
  const { conditionsDocument, mentionTva, COND_QR, COND_EMAIL, COND_QR_EN, COND_EMAIL_EN, CLOTURE_EN } = await import("../src/gestion/js/defauts.mjs");
  const cloture = "Merci pour votre confiance !\nJe reste à votre disposition pour toute question ou demande supplémentaire.\nCordialement,";
  const regl = { textes: { variantes: [{ id: "qr", corps: COND_QR, cloture }, { id: "email", corps: COND_EMAIL, cloture }, { id: "modifiee", corps: "Texte modifié par Anaïs", cloture: "Merci" }, { id: "traduite", corps: "FR", corps_en: "EN", cloture: "Merci", cloture_en: "Thanks" }] } };
  assert.deepEqual(conditionsDocument(regl, { variante: "qr" }, false), { corps: COND_QR, cloture, manqueEn: false }, "en français rien ne change");
  assert.deepEqual(conditionsDocument(regl, { variante: "qr" }, true), { corps: COND_QR_EN, cloture: CLOTURE_EN, manqueEn: false });
  assert.equal(conditionsDocument(regl, { variante: "email" }, true).corps, COND_EMAIL_EN);
  const modifiee = conditionsDocument(regl, { variante: "modifiee" }, true);
  assert.deepEqual(modifiee, { corps: "Texte modifié par Anaïs", cloture: "Merci", manqueEn: true }, "un texte modifié n'est jamais remplacé par un texte que la personne n'a pas écrit : il est signalé");
  assert.deepEqual(conditionsDocument(regl, { variante: "traduite" }, true), { corps: "EN", cloture: "Thanks", manqueEn: false }, "la version anglaise des réglages prime");
  assert.deepEqual(conditionsDocument(regl, { variante: "perso", conditions_corps: "Sur mesure", conditions_cloture: "" }, true), { corps: "Sur mesure", cloture: "", manqueEn: false }, "un texte propre au document est tel quel");
  // les textes de départ ne contiennent ni taux de change écrit en dur ni de prénom à la première personne
  assert.ok(!/1,10|1\.10/.test(COND_QR + COND_QR_EN), "aucun taux de change en dur dans les conditions");
  assert.ok(/\{indicatif\}/.test(COND_QR) && /\{indicatif\}/.test(COND_QR_EN), "le montant indicatif vient du taux du document");
  assert.equal(mentionTva({ tva_mention: "TVA non applicable", tva_mention_en: "" }, false), "TVA non applicable");
  assert.equal(mentionTva({ tva_mention: "TVA non applicable", tva_mention_en: "" }, true), "VAT not applicable");
  assert.equal(mentionTva({ tva_mention: "TVA non applicable", tva_mention_en: "Not subject to VAT" }, true), "Not subject to VAT");
  assert.equal(mentionTva({ tva_mention: "Exonéré art. 21", tva_mention_en: "" }, true), "Exonéré art. 21", "une mention particulière n'est pas devinée");
});
