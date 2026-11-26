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

test("Secret : deux services sur place, un acompte au dossier → le plus tôt d'abord, chaque voucher sa part ; annulé puis remboursé", async () => {
  dans("excursions");
  const l1 = { id: `L-${++n}`, kind: "ligne", libelle: "Private longtail tour", libre: true, qte: 1, unite: 6900, paye_sur_place: true, date_service: "2026-12-22", personnes: { adultes: 2, enfants: 0 } };
  const l2 = { id: `L-${++n}`, kind: "ligne", libelle: "Private taxi to the pier", libre: true, qte: 1, unite: 800, paye_sur_place: true, date_service: "2026-12-21", personnes: { adultes: 2, enfants: 0 } };
  const d = await creerDossierExcursions({ client: { prenom: "Jane", nom: `Example ${n}`, telephone: `+4477009002${10 + n}`, hotel: "Resort Exemple" }, lignes: [l1, l2], ref: refProposee(), silencieux: true });
  const [bateau, taxi] = ["Private longtail tour", "Private taxi to the pier"].map((lib) => E.etat.db.reservations.find((r) => r.dossier_id === d.id && r.libelle === lib));
  await E.inserer("paiements", { dossier_id: d.id, date: "2026-11-26", montant: 1200, type: "acompte", moyen: "virement", note: "" });
  const textes = () => Object.fromEntries(vouchersDuDossier(d.id).map((x) => [x.reservation.libelle, renderVoucher(x).textContent]));
  let t = textes();
  // Le transfert (le 21) est payé en entier ; le bateau (le 22) reçoit les 400 qui restent. 800 + 400 = 1 200, jamais plus.
  assert.match(t[taxi.libelle], /800/);
  assert.doesNotMatch(t[taxi.libelle], /1'200/);
  assert.match(t[bateau.libelle], /Amount Already Paid: THB 400/);
  assert.match(t[bateau.libelle], /Balance to Pay on Arrival: THB 6'500/);
  // Le bateau annulé : il ne reçoit rien ; les 400 sont à rembourser, puis le remboursement saisi solde l'alerte (le reste ne devient pas négatif).
  await E.modifier("reservations", bateau.id, { statut: "annule" });
  assert.equal(Number(E.etat.db.dossiers.find((x) => x.id === d.id).a_rembourser), 400);
  await E.inserer("paiements", { dossier_id: d.id, date: "2026-11-27", montant: -400, type: "remboursement", moyen: "virement", note: "" });
  const apres = E.resumeDossier(d.id);
  assert.equal(Number(apres.dossier.a_rembourser), 0);
  assert.ok(apres.reste >= 0, "le reste ne devient pas négatif");
  assert.match(textes()[taxi.libelle], /800/);
});

test("dossier non chargé (store Supabase simulé) : le voucher lit la part du résumé de la base, sans aucun paiement en mémoire", async () => {
  const { creer } = await import("../src/gestion/js/store-supabase.mjs");
  const { resume } = await import("../src/gestion/js/calc.mjs");
  const { paiementDuService } = await import("../src/gestion/js/operations-calc.mjs");
  const tables = {
    dossiers: [{ id: "D9", entite_id: "SECRET", ref: "INV-2026-901", client_id: "C9" }],
    dossiers_resume: [{ dossier_id: "D9", total: "0", devise: "THB", recu: "1200", sur_place: "6900", parts: { R9: { verse: 1200, reste: 5700 } }, a_rembourser: "0", trop_percu: "0" }],
  };
  const requete = (t) => {
    let lignes = tables[t] || [];
    const q = { select: () => q, eq: (k, v) => ((lignes = lignes.filter((x) => x[k] === v)), q), maybeSingle: async () => ({ data: lignes[0] || null, error: null }) };
    return q;
  };
  const store = creer({}, { client: { from: requete, auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } });
  const d = await store.resumeDossier("D9");
  assert.deepEqual(d.parts, { R9: { verse: 1200, reste: 5700 } });
  const r = { id: "R9", dossier_id: "D9", paye_sur_place: true, statut: "confirme", montant_vente: 6900 };
  // Aucun document ni paiement chargé : le résumé de la base fait foi.
  const res = resume(d, { documents: [], paiements: [], clients: [], reservations: [r] }, { devise: "THB" });
  assert.equal(res.paiements.length, 0);
  assert.deepEqual(paiementDuService(r, { resume: res }), { statut: "acompte", verse: 1200, reste: 5700, surPlace: true });
  // Un service chez nous payé, dossier non ouvert : « Paid », pas « Payment Pending ».
  assert.equal(paiementDuService({ id: "R8", paye_sur_place: false }, { resume: resume({ ...d, total: 2000, recu: 2000 }, { documents: [], paiements: [], clients: [], reservations: [] }, { devise: "THB" }) }).statut, "paye");
});
