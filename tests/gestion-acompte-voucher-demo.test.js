// Acompte sur un service payé sur place, par le vrai chemin de la démo : dossier créé par l'écran de création, paiement
// « acompte » enregistré comme dans la fiche du dossier, voucher rendu d'après la base locale (résumé du dossier et ses réservations).
// Dans Secret (voucher) et dans Taxi (Booking confirmation). Noms et montants inventés.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { installerDom } from "./aides-dom.mjs";

installerDom();
globalThis.location.search = "?demo";
const E = await import("../src/gestion/js/etat.mjs");
await E.init();
const { creerDossierExcursions, refProposee } = await import("../src/gestion/js/views/creation-excursions.mjs");
const { vouchersDuDossier, renderVoucher } = await import("../src/gestion/js/views/voucher.mjs");
after(() => setTimeout(() => process.exit(process.exitCode || 0), 50).unref());

const dans = (slug) => E.changerEntite(E.etat.brut.entites.find((e) => e.slug === slug).id, { naviguer: false });
let n = 0;
async function dossierAvecAcompte({ prix, acompte, libelle }) {
  const ligne = { id: `L-${++n}`, kind: "ligne", libelle, libre: true, qte: 1, unite: prix, paye_sur_place: true, date_service: "2026-12-22", personnes: { adultes: 2, enfants: 0 } };
  const d = await creerDossierExcursions({ client: { prenom: "Jane", nom: `Example ${n}`, telephone: `+4477009001${10 + n}`, hotel: "Resort Exemple" }, lignes: [ligne], ref: refProposee(), silencieux: true });
  if (acompte) await E.inserer("paiements", { dossier_id: d.id, date: "2026-11-26", montant: acompte, type: "acompte", moyen: "wise", note: "" });
  return d;
}
const texte = (d) => vouchersDuDossier(d.id).map((x) => renderVoucher(x).textContent).join("\n");

test("Secret : le voucher coche « Deposit Paid » avec le mode sur place et imprime versé et reste", async () => {
  dans("excursions");
  const d = await dossierAvecAcompte({ prix: 6900, acompte: 1200, libelle: "Private longtail tour" });
  const t = texte(d);
  assert.match(t, /☒ Deposit Paid/);
  assert.match(t, /Amount Already Paid: THB 1'200|Amount Already Paid: 1'200/);
  assert.match(t, /Balance to Pay on Arrival: (THB )?5'700/);
  const sans = await dossierAvecAcompte({ prix: 6900, acompte: 0, libelle: "Private longtail tour" });
  assert.doesNotMatch(texte(sans), /☒ Deposit Paid|Amount Already Paid/);
});

test("Taxi : la Booking confirmation dit ce qui est déjà payé et le reste à payer au chauffeur", async () => {
  dans("taxi");
  const d = await dossierAvecAcompte({ prix: 1500, acompte: 500, libelle: "Private taxi to Krabi Airport" });
  const t = texte(d);
  assert.match(t, /ALREADY PAID\s*:?\s*500 THB/);
  assert.match(t, /BALANCE TO PAY\s*:?\s*1'000 THB/);
});

test("Secret : deux services sur place, acompte rattaché au bateau → seul son voucher le montre ; le dossier ne le compte pas chez nous", async () => {
  dans("excursions");
  const l1 = { id: `L-${++n}`, kind: "ligne", libelle: "Private longtail tour", libre: true, qte: 1, unite: 6900, paye_sur_place: true, date_service: "2026-12-22", personnes: { adultes: 2, enfants: 0 } };
  const l2 = { id: `L-${++n}`, kind: "ligne", libelle: "Private taxi to the pier", libre: true, qte: 1, unite: 800, paye_sur_place: true, date_service: "2026-12-22", personnes: { adultes: 2, enfants: 0 } };
  const d = await creerDossierExcursions({ client: { prenom: "Jane", nom: `Example ${n}`, telephone: `+4477009002${10 + n}`, hotel: "Resort Exemple" }, lignes: [l1, l2], ref: refProposee(), silencieux: true });
  const [bateau, taxi] = ["Private longtail tour", "Private taxi to the pier"].map((lib) => E.etat.db.reservations.find((r) => r.dossier_id === d.id && r.libelle === lib));
  await E.inserer("paiements", { dossier_id: d.id, date: "2026-11-26", montant: 1200, type: "acompte", moyen: "virement", note: "" });
  const textes = () => Object.fromEntries(vouchersDuDossier(d.id).map((x) => [x.reservation.libelle, renderVoucher(x).textContent]));
  let t = textes();
  assert.doesNotMatch(t[bateau.libelle] + t[taxi.libelle], /Amount Already Paid/, "non rattaché : aucun montant, sur aucun des deux");
  const p = E.etat.db.paiements.find((x) => x.dossier_id === d.id);
  await E.modifier("paiements", p.id, { reservation_id: bateau.id });
  t = textes();
  assert.match(t[bateau.libelle], /Amount Already Paid: THB 1'200/);
  assert.doesNotMatch(t[taxi.libelle], /Amount Already Paid|BALANCE/);
  assert.equal(E.resumeDossier(d.id).recu, 0, "le reçu des services chez nous ne compte pas l'acompte du bateau");
  // Un service d'un autre dossier est refusé, comme par la base.
  const autre = E.etat.db.reservations.find((r) => r.dossier_id !== d.id && r.entite_id === d.entite_id);
  await assert.rejects(() => E.modifier("paiements", p.id, { reservation_id: autre.id }), /son dossier/);
});
