// Modèles métier (étape 3 du SaaS) : une entreprise créée depuis un modèle n'hérite d'aucun fait propre aux entreprises d'Anaïs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELES, modele, modeleDuFonctionnement, reglagesModele } from "../src/gestion/js/modeles-metier.mjs";
import { completerReglages, reglagesIncomplets } from "../src/gestion/js/defauts.mjs";
import { textesVoucher } from "../src/gestion/js/textes-voucher.mjs";

const INTERDITS = /Lanta|Krabi|VIP TAXI|Mr\.? Brown|Anaïs|Zwald|Secret Travel|TWINT|PostFinance|3 ?%|national park/i;

test("trois modèles, un par façon de travailler", () => {
  assert.deepEqual(MODELES.map((m) => m.fonctionnement).sort(), ["excursions", "sur_mesure", "taxi"]);
  assert.equal(modele("inconnu").id, "travel_planner");
  assert.equal(modeleDuFonctionnement("taxi").id, "transfers");
});

for (const m of MODELES) {
  test(`modèle ${m.id} : façon de travailler, anglais, aucun fait d'Anaïs`, () => {
    const r = completerReglages(reglagesModele(m.id, { nom: "Agence B", devise: "EUR" }));
    assert.equal(r.fonctionnement, m.fonctionnement);
    assert.equal(r.emetteur.nom, "Agence B");
    assert.equal(r.devise, "EUR");
    assert.equal(r.libelles.facture, "INVOICE");
    assert.ok(r.messages.length > 0);
    assert.ok(r.messages.every((x) => x.langue === "en"), "messages en anglais seulement");
    assert.deepEqual(r.listes.civilites, ["Mrs", "Mr", "Ms"]);
    assert.ok(!r.listes.moyens.some((x) => ["twint", "postfinance"].includes(x.id)), "ni TWINT ni PostFinance");
    assert.equal(r.fiduciaire.actif, false);
    assert.doesNotMatch(JSON.stringify({ messages: r.messages, voucher: r.voucher, textes: r.textes }), INTERDITS);
    // Ce qui manque est ce que le client remplit pendant l'appel de mise en route.
    assert.ok(reglagesIncomplets(r).includes("l'adresse"));
  });
}

test("transferts : la booking confirmation ne garde ni la marque ni le lieu ni le Wise d'Anaïs", () => {
  const t = textesVoucher(completerReglages(reglagesModele("transfers", { nom: "Ride Co" })));
  for (const cle of ["b_paiement", "b_paiement_wise", "b_merci", "b_signature", "b_lieu"]) assert.doesNotMatch(t(cle), INTERDITS, cle);
  assert.match(t("b_merci"), /Ride Co/);
  assert.equal(t("b_signature"), "Ride Co Team");
});

test("sans modèle, rien ne change pour une entreprise d'Anaïs", () => {
  assert.equal(completerReglages({ emetteur: { nom: "X" } }).fonctionnement, "sur_mesure");
});
