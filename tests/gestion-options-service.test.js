// Options d'un service (INV-2026-055, 26.11.2026). Le 4 Islands privé et son extension Koh Kradan étaient deux prestations : l'Assistant a
// créé deux services et deux vouchers, refaits à la main en un seul. Une option est maintenant une ligne de facture rattachée à la ligne de
// son service (`option_de`) : une seule réservation, un seul voucher, total = base + options, partout.
// Ici : la règle pure, puis chaque chemin réel de la démo, de la carte de l'Assistant (fonction `agent`, executer) jusqu'à la réservation
// écrite, comparé champ par champ, dans Secret et dans Taxi ; ZTP n'a pas d'options. Libellés et prix inventés.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { installerDom } from "./aides-dom.mjs";

const O = await import("../src/gestion/js/operations-calc.mjs");
const P = await import("../src/gestion/js/partenaires-calc.mjs");

// ---- Règle pure ---------------------------------------------------------------------------------------------------------------------
const base = { id: "L1", kind: "ligne", titre: "Tour Exemple", libelle: "Tour Exemple", prestation_id: "pT", partenaire_id: "pa", par: "grp", unite: 6000, qte: 1, date_service: "2026-12-22", paye_sur_place: true, personnes: { adultes: 2, enfants: 0 } };
const ext = { id: "L2", kind: "ligne", titre: "Extension Exemple", libelle: "Extension Exemple", prestation_id: "pE", partenaire_id: "pa", unite: 700, qte: 1, date_service: "2026-12-22", paye_sur_place: true, option_de: "L1", net: 500 };
const doc = (lignes) => ({ dossier_id: "D1", contenu: { langue: "en", lignes } });

test("règle : une option rejoint la réservation de son service ; prix et net comptés, personnes non", () => {
  const [g, ...autres] = O.reservationsDepuisDocument(doc([{ ...base, net: 5000 }, ext]), { uid: () => "R1" });
  assert.equal(autres.length, 0, "une seule réservation");
  assert.equal(g.reservation.montant_vente, 6700);
  assert.equal(g.net, 5500);
  assert.deepEqual(g.reservation.details.lignes_ids, ["L1", "L2"]);
  assert.deepEqual([g.reservation.personnes.adultes, g.reservation.personnes.enfants], [2, 0]);
  // Ajoutée après coup : elle rejoint la réservation existante.
  const r = { id: "R1", dossier_id: "D1", ligne_id: "L1", statut: "confirme", details: {} };
  const [att] = O.rattachementsDepuisDocument(doc([base, ext]), [r]);
  assert.deepEqual(att.lignes_ids, ["L1", "L2"]);
  // La facture attendue : montant base + option, personnes de la base.
  const a = O.attenduDepuisFacture({ ...r, details: { lignes_ids: ["L1", "L2"] } }, doc([base, ext]));
  assert.equal(a.montant_vente, 6700);
  assert.deepEqual(a.personnes, { adultes: 2, enfants: 0 });
  assert.equal(O.ecartReservation({ ...r, montant_vente: 6700, personnes: { adultes: 2, enfants: 0 }, paye_sur_place: true, libelle: "Tour Exemple", partenaire_id: "pa", date_service: "2026-12-22", details: { lignes_ids: ["L1", "L2"] } }, doc([base, ext])), null, "aucun écart");
});

test("règle : prix, date et personnes changés depuis la réservation ; options ajoutées, repricées, retirées", () => {
  const r = { id: "R1", ligne_id: "L1", details: { lignes_ids: ["L1", "L2"] }, personnes: { adultes: 2, enfants: 0 } };
  // Le montant vendu (7 000) moins l'option (700) : la base passe à 6 300, l'option ne bouge pas.
  const s = O.contenuAvecService(doc([base, ext]).contenu, r, { montant_vente: 7000 }, {});
  assert.deepEqual(s.contenu.lignes.map((l) => O.attenduDepuisFacture ? (l.unite ?? l.montant) : 0), [6300, 700]);
  // Le nom du service change : l'option garde le sien.
  const n = O.contenuAvecService(doc([base, ext]).contenu, r, { libelle: "Tour Exemple Privé" }, {});
  assert.equal(n.contenu.lignes[1].titre, "Extension Exemple");
  assert.deepEqual(n.reste, []);
  // Options voulues : l'extension à 600, une lunch box ajoutée (2 × 150), puis l'extension retirée.
  const lunch = { id: "pL", libelle: "Lunch box", libelle_en: "Lunch box", prix_vente: 150, unite: "pp", partenaire_id: "pa", option_de: ["pT"] };
  const o = O.contenuAvecService(doc([base, ext]).contenu, r, { options: [{ ligne_id: "L2", prestation_id: "pE", prix: 600 }, { ligne_id: "L3", prestation_id: "pL", prix: 300, nouvelle: true }], montant_vente: 6900 }, { prestationDe: (id) => (id === "pL" ? lunch : null), netDe: () => 100, personnes: { adultes: 2, enfants: 0 } });
  const [b, e2, l3] = o.contenu.lignes;
  assert.deepEqual([b.unite, e2.unite, l3.id, l3.option_de, l3.unite, l3.qte, l3.net, l3.paye_sur_place], [6000, 600, "L3", "L1", 150, 2, 100, true]);
  assert.deepEqual(o.ajoutees, ["L3"]);
  const sans = O.contenuAvecService(o.contenu, { ...r, details: { lignes_ids: ["L1", "L2", "L3"] } }, { options: [{ ligne_id: "L3", prestation_id: "pL", prix: 300 }] }, {});
  assert.deepEqual(sans.retirees, ["L2"]);
  assert.deepEqual(sans.contenu.lignes.map((l) => l.id), ["L1", "L3"]);
  // Date et personnes : l'option suit la date, une option par personne suit le nombre de personnes, la base garde ses règles.
  const pp = { ...ext, id: "L4", qte: 2, unite: 150 };
  const d = O.contenuAvecReservation(doc([base, pp]).contenu, { ...r, details: { lignes_ids: ["L1", "L4"] } }, { date_service: "2026-12-22", personnes: { adultes: 2, enfants: 0 } }, { date_service: "2026-12-23", personnes: { adultes: 3, enfants: 0 } });
  assert.deepEqual(d.contenu.lignes.map((l) => [l.date_service, l.qte]), [["2026-12-23", 1], ["2026-12-23", 3]]);
  // Dupliquer un service : l'option suit le double de sa ligne.
  let n2 = 0;
  const dup = O.contenuAvecServiceDuplique(doc([base, ext]).contenu, { ligne_id: "L1", details: { lignes_ids: ["L1", "L2"] } }, () => `N${++n2}`);
  assert.equal(dup.contenu.lignes[3].option_de, dup.contenu.lignes[2].id);
});

test("voucher et Booking confirmation : la ligne d'option en anglais, sans prix ni partenaire", () => {
  const p = { id: "pE", libelle: "Extension Kradan (FR)", libelle_en: "Koh Kradan extension" };
  assert.deepEqual(O.optionsVoucher([base, ext, { ...ext, id: "L5", prestation_id: null, titre: "Lunch box, per person", qte: 2 }], (id) => (id === "pE" ? p : null)), ["Koh Kradan extension", "Lunch box, per person (×2)"]);
});

test("ligneOption : même partenaire, date et mode que le service ; prix modifiable ; par personne", () => {
  const o = { id: "pL", libelle: "Lunch box", prix_vente: 150, unite: "pp", partenaire_id: "autre" };
  const l = P.ligneOption(o, base, { net: 100 }, { unitaire: 120, uid: () => "X" });
  assert.deepEqual([l.option_de, l.partenaire_id, l.date_service, l.paye_sur_place, l.qte, l.unite, l.net], ["L1", "pa", "2026-12-22", true, 2, 120, 100]);
  assert.equal(P.ligneOption(o, base, null, { prix: 100.01, uid: () => "Y" }).montant, 100.01, "un total qui ne tombe pas juste devient un montant");
  assert.equal(P.optionsDe("pT", [{ ...o, option_de: ["pT"] }, { id: "z", option_de: [] }]).length, 1);
});

// ---- Chemins réels de la démo ------------------------------------------------------------------------------------------------------
const dom = installerDom();
globalThis.location.search = "?demo";
const E = await import("../src/gestion/js/etat.mjs");
await E.init();
const { executer, refDe } = await import("../supabase/functions/agent/outils.js");
const { tempsSimule } = await import("../supabase/functions/agent/planifier.js");
const V = await import("../src/gestion/js/views/agent-valider.mjs");
const { reservationDepuisCarte, reservationModifiee } = await import("../src/gestion/js/agent-calc.mjs");
const { ouvrirDemande } = await import("../src/gestion/js/views/demande.mjs");
const { renderVoucher, vouchersDuDossier } = await import("../src/gestion/js/views/voucher.mjs");
after(() => setTimeout(() => process.exit(process.exitCode || 0), 50).unref());

const entite = (slug) => E.etat.brut.entites.find((e) => e.slug === slug);
const dans = (slug) => E.changerEntite(entite(slug).id, { naviguer: false });
const ctx = () => ({ charger: async (n) => E.etat.db[n] || [], reglages: E.reglages(), simule: tempsSimule });
const memo = (tapes = []) => ({ prix: new Set(), heures: new Set(), tapes: new Set(tapes), durees: new Set(), estimations: new Map(), signer: false, prestataires: [], entreprise: "Test", textes: [tapes.join(" ")] });
const catalogue = {};
async function catalogueDe(slug) {
  dans(slug);
  if (catalogue[slug]) return catalogue[slug];
  const pa = await E.inserer("partenaires", { nom: `Bateaux Exemple ${slug}`, categorie: "", groupe: "", role: "", contact: {}, regles: {}, contrat: {}, notes: "", actif: true });
  const tour = await E.inserer("prestations", { partenaire_id: pa.id, famille: "excursion", groupe: "Private Exemple", libelle: "Private Island Exemple", libelle_en: "Private Island Exemple", prix_vente: 6000, unite: "grp", actif: true, option_de: [] });
  const ext = await E.inserer("prestations", { partenaire_id: pa.id, famille: "excursion", groupe: "Private Exemple", libelle: "Extension Kradan Exemple", libelle_en: "Kradan extension Exemple", prix_vente: 700, unite: "boat", actif: true, option_de: [tour.id] });
  return (catalogue[slug] = { pa, tour, ext });
}
let n = 0;
const service = (tour, ext, o = {}) => ({ texte: "Private island tour", ref: refDe("P", tour.id), date: "2026-12-22", heure_pickup: "08:00", lieu_pickup: "Resort Exemple", de: "", vers: "", adultes: 2, enfants: 0, prix_saisi: "", options: [{ ref: refDe("P", ext.id), prix_saisi: "" }], ...o });
const carteDossier = async (services, tapes = []) => {
  const r = await executer("proposer_dossier", { titre: "Dossier", client_nom: `Client Exemple ${++n}`, client_telephone: `+4179000${1000 + n}`, hotel: "", langue: "en", adultes: 2, enfants: 0, bebes: 0, services, apporteur: "" }, ctx(), memo(tapes));
  assert.ok(r.carte, JSON.stringify(r.contenu || r));
  return { id: `carte-${n}`, ...r.carte, statut: "proposee" };
};
const resasDu = (d) => E.etat.brut.reservations.filter((r) => r.dossier_id === d.id);
const factureDu = (d) => E.etat.brut.documents.find((x) => x.dossier_id === d.id && x.type === "facture");
function verifierUnService(d, { base = 6000, option = 700, partenaire }) {
  const rs = resasDu(d);
  assert.equal(rs.length, 1, "un seul service, un seul voucher");
  const [r] = rs;
  assert.equal(Number(r.montant_vente), base + option, "montant = base + option");
  assert.equal(r.partenaire_id, partenaire);
  const lignes = factureDu(d).contenu.lignes.filter((l) => (r.details.lignes_ids || [r.ligne_id]).includes(l.id));
  const opt = lignes.find((l) => l.option_de);
  assert.ok(opt, "la ligne d'option est sur la facture");
  assert.equal(opt.option_de, r.ligne_id);
  assert.equal((opt.unite ?? opt.montant) * (opt.unite != null ? opt.qte : 1), option);
  assert.equal(!!opt.paye_sur_place, !!r.paye_sur_place, "même mode de règlement que le service");
  assert.equal(vouchersDuDossier(d.id).length, 1);
  return r;
}

test("chercher_catalogue : l'option est dans « options » de son service, jamais une ligne à part ; trouvée par son nom", async () => {
  const { tour, ext } = await catalogueDe("excursions");
  const r = await executer("chercher_catalogue", { famille: "tout", recherche: "kradan" }, ctx(), memo());
  const lignes = r.contenu.lignes || r.resultat?.lignes || [];
  assert.ok(!lignes.some((l) => l.ref === refDe("P", ext.id)), "l'option n'est pas proposée seule");
  const l = lignes.find((x) => x.ref === refDe("P", tour.id));
  assert.ok(l, "le service est trouvé par le nom de son option");
  assert.deepEqual(l.options.map((o) => [o.ref, o.prix_vente]), [[refDe("P", ext.id), 700]]);
});

for (const [nom, slug] of [["Secret", "excursions"], ["Taxi", "taxi"]]) {
  test(`${nom} : carte « dossier » validée d'un geste → une réservation avec son option, au prix du catalogue`, async () => {
    const { tour, ext, pa } = await catalogueDe(slug);
    const c = await carteDossier([service(tour, ext)]);
    assert.deepEqual(c.donnees.services[0].options.map((o) => [o.offre.id, o.prix, o.origine_prix]), [[ext.id, 700, "catalogue"]]);
    const r = await ouvrirDemande(null, V.preparation(c), { auto: true, titre: c.titre, surCree: () => {} });
    assert.equal(r.ok, true, r.motif);
    const resa = verifierUnService(r.dossier, { partenaire: slug === "taxi" ? resasDu(r.dossier)[0].partenaire_id : pa.id });
    assert.equal(resa.prestation_id, tour.id);
    // Le voucher (ou la Booking confirmation) imprime l'option en anglais.
    assert.match(renderVoucher(vouchersDuDossier(r.dossier.id)[0]).textContent, /Kradan extension Exemple/);
  });
}

test("Secret : prix tapés (service et option) gardés ; une option inconnue n'est pas reprise", async () => {
  const { tour, ext, pa } = await catalogueDe("excursions");
  const c = await carteDossier([service(tour, ext, { prix_saisi: "6400", options: [{ ref: refDe("P", ext.id), prix_saisi: "1000" }, { ref: refDe("P", tour.id), prix_saisi: "" }] })], [6400, 1000]);
  assert.ok(c.donnees.services[0].avertissements.includes("option_inconnue"));
  const r = await ouvrirDemande(null, V.preparation(c), { auto: true, titre: c.titre, surCree: () => {} });
  assert.equal(r.ok, true, r.motif);
  verifierUnService(r.dossier, { base: 6400, option: 1000, partenaire: pa.id });
});

test("Secret : une option proposée comme service à part est signalée sur la carte", async () => {
  const { ext } = await catalogueDe("excursions");
  const c = await carteDossier([{ ...service({ id: ext.id }, ext), ref: refDe("P", ext.id), options: [] }]);
  assert.ok(c.donnees.services[0].avertissements.includes("option_seule"));
});

test("Secret : « Vérifier avant » (fenêtre visible) crée aussi un seul service avec l'option", async () => {
  const { tour, ext, pa } = await catalogueDe("excursions");
  const c = await carteDossier([service(tour, ext)]);
  let cree = null;
  ouvrirDemande(null, V.preparation(c), { titre: c.titre, surCree: ({ dossier }) => (cree = dossier) });
  dom.boutons("Créer le dossier").slice(-1)[0].click();
  for (let i = 0; i < 60 && !cree; i++) await new Promise((x) => setTimeout(x, 10));
  assert.ok(cree, "dossier créé");
  verifierUnService(cree, { partenaire: pa.id });
});

test("Secret : carte « reservation » (service ajouté à un dossier) → option dans le montant et sur le voucher", async () => {
  const { tour, ext } = await catalogueDe("excursions");
  const c0 = await carteDossier([service(tour, ext, { options: [] })]);
  const r0 = await ouvrirDemande(null, V.preparation(c0), { auto: true, titre: c0.titre, surCree: () => {} });
  const ref = refDe("D", r0.dossier.id);
  const s = await executer("proposer_reservation", { titre: "Service", dossier: ref, service: service(tour, ext, { date: "2026-12-23" }) }, { ...ctx(), parRef: async () => E.etat.db.dossiers }, memo());
  assert.ok(s.carte, JSON.stringify(s.contenu || s));
  const valeurs = reservationDepuisCarte(s.carte.donnees, {});
  assert.equal(valeurs.montant_vente, 6700);
  assert.deepEqual(valeurs.details.options.map((o) => [o.prestation_id, o.prix]), [[ext.id, 700]]);
});

test("Secret : carte « modification » champ option → la ligne d'option rejoint la facture et la réservation", async () => {
  const { tour, ext, pa } = await catalogueDe("excursions");
  const c0 = await carteDossier([service(tour, ext, { options: [] })]);
  const r0 = await ouvrirDemande(null, V.preparation(c0), { auto: true, titre: c0.titre, surCree: () => {} });
  const [resa] = resasDu(r0.dossier);
  assert.equal(Number(resa.montant_vente), 6000);
  const m = await executer("proposer_modification", { titre: "Option", reservation: refDe("R", resa.id), champ: "option", valeur: refDe("P", ext.id), raison: "" }, { ...ctx(), parRef: async () => E.etat.db.reservations }, memo());
  assert.ok(m.carte, JSON.stringify(m.contenu || m));
  const res = await V.enregistrerReservation(reservationModifiee(resa, m.carte.donnees), "ok", resa);
  assert.equal(res.ok, true, res.motif);
  verifierUnService(r0.dossier, { partenaire: pa.id });
});

test("Taxi : la fenêtre de réservation n'ouvre pas les options (la course suit sa propre facture)", async () => {
  await catalogueDe("taxi");
  const { formulaireReservation } = await import("../src/gestion/js/views/reservations.mjs");
  const [r] = E.etat.db.reservations;
  const f = formulaireReservation(r, () => {});
  assert.equal(f.querySelector(".options-resa"), null);
});
