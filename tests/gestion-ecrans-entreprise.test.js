// Chaque entreprise ses éléments : droits proposés dans la fenêtre d'un rôle et données de démonstration par fonctionnement.
import test from "node:test";
import assert from "node:assert/strict";
import { droitsProposes } from "../src/gestion/js/droits.mjs";
import { PERMISSIONS, donneesDemo } from "../src/gestion/js/defauts.mjs";

const ajouterJours = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const codes = (mode) => droitsProposes(mode).map((p) => p.code);

test("droits proposés : fiduciaire hors Zwald, voucher seul pour Taxi, catalogue pour Zwald", () => {
  assert.ok(!codes("sur_mesure").some((c) => c.startsWith("fiduciaire.")));
  assert.ok(codes("excursions").includes("fiduciaire.preparer") && codes("taxi").includes("fiduciaire.gerer"));
  assert.deepEqual([codes("sur_mesure"), codes("excursions"), codes("taxi")].map((l) => l.includes("vouchers.seul")), [false, false, true]);
  assert.deepEqual([codes("sur_mesure"), codes("excursions"), codes("taxi")].map((l) => l.includes("catalogue.ecrire")), [true, false, false]);
  // Un fonctionnement inconnu ou absent vaut « sur mesure ».
  assert.deepEqual(codes(undefined), codes("sur_mesure"));
});

test("droits proposés : devis et factures pour Zwald, factures pour Secret, vouchers et courses pour Taxi", () => {
  const groupe = (mode, code) => (droitsProposes(mode).find((p) => p.code === code) || {}).groupe;
  assert.equal(groupe("sur_mesure", "documents.ecrire"), "Devis et factures");
  assert.equal(groupe("excursions", "documents.ecrire"), "Factures");
  assert.equal(groupe("excursions", "documents.supprimer"), "Factures");
  assert.equal(groupe("taxi", "documents.ecrire"), "Vouchers et courses");
  // Taxi n'a aucun document client à supprimer : le droit n'est pas proposé (il reste sur un rôle qui l'a déjà).
  assert.ok(!codes("taxi").includes("documents.supprimer"));
  // Le catalogue partagé n'est jamais modifié.
  assert.equal(PERMISSIONS.find((p) => p.code === "documents.ecrire").groupe, "Devis et factures");
});

test("démo Excursions : facture directe sans devis ni catalogue, acceptée le jour de la facture", () => {
  const d = donneesDemo("2026-11-12", ajouterJours);
  const e2 = d.entites.find((e) => e.slug === "excursions");
  const dossiers = d.dossiers.filter((x) => x.entite_id === e2.id);
  const docs = d.documents.filter((x) => x.entite_id === e2.id);
  assert.ok(dossiers.length > 100);
  assert.equal(docs.filter((x) => x.type === "devis").length, 0);
  assert.equal(d.catalogue.filter((x) => x.entite_id === e2.id).length, 0);
  for (const x of dossiers) {
    const f = docs.find((y) => y.dossier_id === x.id && y.type === "facture");
    assert.ok(f, `${x.ref} a sa facture`);
    assert.equal(x.accepte_le, f.date_emission, `${x.ref} accepté le jour de la facture`);
  }
  // Noms de services en anglais.
  const libelles = d.prestations.filter((x) => x.entite_id === e2.id).map((x) => x.libelle);
  for (const l of ["4 Islands by longtail, full day", "Discover Scuba Diving", "Krabi Airport → Koh Lanta"]) assert.ok(libelles.includes(l), l);
  assert.ok(!libelles.some((l) => /[éèàîç]|journée|Aéroport/.test(l)), "aucun nom de service en français");
});

test("démo Taxi : ni texte de paiement ni liste de pays", () => {
  const d = donneesDemo("2026-11-12", ajouterJours);
  const r = d.reglages[d.entites.find((e) => e.slug === "taxi").id];
  assert.equal(r.paiement.texte, "");
  assert.deepEqual(r.listes.pays, []);
});
