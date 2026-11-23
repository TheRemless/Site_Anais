// Tous les chemins qui créent ou modifient une réservation depuis l'Assistant (et la demande du site), de bout en bout (23.11.2026).
// Un service du catalogue validé par une carte « dossier » gardait le pickup et les bagages mais perdait sa dépose (`vers`), que le voucher
// imprime (details.drop_off). Chaque test fait passer une carte complète par son chemin réel (fonction, calculs, fiche ou formulaire,
// écriture de la réservation) et compare champ par champ : drop-off, pickup, départ (`de`), heure, vol, sièges par type, bagages, remarque
// du voucher, personnes et prix.
// Le formulaire (« Vérifier avant », fenêtre de réservation) est rendu avec un DOM minimal : ses champs du voucher sont relus comme à
// l'enregistrement (champsVoucher().valeurs()). Données inventées : aucun client, hôtel ni partenaire réel.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---- Un DOM minimal : de quoi construire les champs du voucher et les relire -------------------------------------------------------
class Node {
  remove() {}
}
class Texte extends Node {
  constructor(t) {
    super();
    this.t = t;
  }
  get textContent() {
    return this.t;
  }
}
class El extends Node {
  constructor(tag) {
    super();
    Object.assign(this, { tag, id: "", children: [], attrs: {}, className: "", value: "", checked: false, hidden: false, style: {}, dataset: {} });
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  append(...xs) {
    this.children.push(...xs);
  }
  appendChild(x) {
    this.children.push(x);
    return x;
  }
  replaceChildren(...xs) {
    this.children = xs;
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
    if (k === "id") this.id = v;
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  hasAttribute(k) {
    return k in this.attrs;
  }
  addEventListener() {}
  querySelector(sel) {
    const tag = /^[a-z]+$/.test(sel) ? sel : null;
    const chercher = (el) => (el instanceof El ? (tag && el.tag === tag ? el : el.children.map(chercher).find(Boolean) || null) : null);
    return tag ? this.children.map(chercher).find(Boolean) || null : null;
  }
  querySelectorAll() {
    return [];
  }
  get firstChild() {
    return null;
  }
  get textContent() {
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(t) {
    this.children = [new Texte(t)];
  }
}
globalThis.Node = Node;
globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => new Texte(t), getElementById: () => null, querySelector: () => null, addEventListener() {}, documentElement: new El("html"), body: new El("body") };
// Le champ d'id `id` dans un bloc rendu.
const trouver = (el, id) => (el instanceof El ? (el.id === id ? el : el.children.map((c) => trouver(c, id)).find(Boolean) || null) : null);

const { executer, refDe } = await import("../supabase/functions/agent/outils.js");
const { tempsSimule } = await import("../supabase/functions/agent/planifier.js");
const { propositionDepuisCarte, reservationDepuisCarte, reservationModifiee } = await import("../src/gestion/js/agent-calc.mjs");
const { propositionVersDemande, lignesAuPrixCarte } = await import("../src/gestion/js/assistant-calc.mjs");
const { serviceDeLecture, saisieInitiale, entreeParService, champsReservation, boutsDuTrajet, ligneTransfertPrive, nonVides } = await import("../src/gestion/js/creation-voucher-calc.mjs");
const { siegesDemande, lireMessage, decouperServices } = await import("../src/gestion/js/demande-calc.mjs");
const { ligneDepuisPrestation, quantiteParDefaut } = await import("../src/gestion/js/partenaires-calc.mjs");
const { reservationsDepuisDocument } = await import("../src/gestion/js/operations-calc.mjs");
const { imposerTotal } = await import("../src/gestion/js/demandes-site-calc.mjs");
const { champsVoucher, blocServiceCreation } = await import("../src/gestion/js/views/champs-voucher.mjs");

const ici = path.dirname(fileURLToPath(import.meta.url));
const lire = (f) => fs.readFileSync(path.join(ici, "..", f), "utf8");

const PR = "a3000000-0000-4000-8000-000000000031";
const PR2 = "b3000000-0000-4000-8000-000000000032";
const DOS = "d3000000-0000-4000-8000-000000000031";
const RES = "e3000000-0000-4000-8000-000000000031";
const catalogue = {
  partenaires: [],
  prestations: [
    { id: PR, famille: "transfert", groupe: "Taxi", libelle: "Ville Exemple", libelle_en: "Ville Exemple", prix_vente: 2500, unite: "veh", actif: true },
    { id: PR2, famille: "excursion", groupe: "Tour", libelle: "Tour Exemple", libelle_en: "Tour Exemple", prix_vente: 1500, unite: "pp", actif: true },
  ],
  trajets: [],
  clients: [{ id: "c3000000-0000-4000-8000-000000000031", prenom: "Client", nom: "Exemple" }],
  dossiers: [{ id: DOS, ref: "2026-0031", client_id: "c3000000-0000-4000-8000-000000000031", annule: false }],
  reservations: [{ id: RES, dossier_id: DOS, libelle: "Ville Exemple", date_service: "2026-12-03", heure_pickup: "09:15", lieu_pickup: "Villa Exemple", personnes: { adultes: 2, enfants: 1 }, statut: "confirme" }],
};
const ctx = (fonctionnement) => ({ charger: async (n) => catalogue[n] || [], reglages: { fonctionnement }, simule: tempsSimule });
const PRIX = 3000;
const memo = () => ({ prix: new Set(), heures: new Set(), tapes: new Set([PRIX]), durees: new Set(), estimations: new Map(), signer: false, prestataires: [], entreprise: "Test", textes: ["Flight FD3217 tomorrow, 3000 THB, drop at Hotel Plage Exemple https://maps.app.goo.gl/exemple1"] });
const REMARQUE = "Driver waits in the lobby with a name sign.";
// Le service du cas réel du 23.11.2026, rendu fictif : un service du catalogue, une dépose d'hôtel (avec le lien Maps lu), 2 bagages, un prix tapé.
const service = (o = {}) => ({ texte: "Taxi to Ville Exemple", ref: refDe("P", PR), date: "2026-12-03", heure_pickup: "09:15", lieu_pickup: "Villa Exemple", de: "Koh Exemple", vers: "Hotel Plage Exemple https://maps.app.goo.gl/exemple1", adultes: 2, enfants: 1, sieges: 1, sieges_bebe: 1, sans_siege: false, bagages: 2, prix_saisi: String(PRIX), vol: "FD3217", remarque_voucher: REMARQUE, note_interne: "", ...o });
const dossierCarte = (services) => ({ titre: "Dossier", client_nom: "Client Exemple", client_telephone: "+41790000000", hotel: "", langue: "en", adultes: 2, enfants: 1, bebes: 1, services, apporteur: "" });
const contexte = { prestations: catalogue.prestations, trajets: [], partenaires: [] };
// Ce que la carte dit du service, dans les clés de la réservation : la référence de chaque comparaison.
const ATTENDU = { drop_off: "Hotel Plage Exemple", lieu_pickup: "Villa Exemple", heure_pickup: "09:15", vol: "FD3217", sieges: 1, sieges_bebe: 1, bagages: "2", remarques: REMARQUE, adultes: 2, enfants: 1, montant_vente: PRIX };
// Une réservation, dans ces mêmes clés (sans_siege seulement s'il est vrai).
const aplatir = (r) => ({ drop_off: (r.details || {}).drop_off, lieu_pickup: r.lieu_pickup, heure_pickup: r.heure_pickup, vol: (r.details || {}).vol, sieges: (r.details || {}).sieges, sieges_bebe: (r.details || {}).sieges_bebe, bagages: (r.details || {}).bagages, remarques: (r.details || {}).remarques, adultes: (r.personnes || {}).adultes, enfants: (r.personnes || {}).enfants, montant_vente: r.montant_vente });
const comparer = (r, attendu, quoi) => {
  for (const [k, v] of Object.entries(attendu)) assert.deepEqual(aplatir(r)[k], v, `${quoi} : ${k}`);
  assert.doesNotMatch(JSON.stringify(r.details || {}), /https?:|goo\.gl|maps\.app|www\./, `${quoi} : aucun lien`);
};
// Les champs du voucher relus comme le formulaire les enregistre (vides retirés) : rien ne se perd entre l'ouverture et l'enregistrement.
const relus = (details) => nonVides(champsVoucher({ details }).valeurs());

// La fiche de création, cachée ou ouverte par « Vérifier avant », puis creerDossierExcursions : la facture (lignes, dont le prix de chaque
// réservation) et le patch de chaque réservation créée. `bouts` : les deux bouts du trajet du catalogue, posés par la fiche de Taxi.
function cheminDossier(donnees, { excursions, taxi = false, bouts = null }) {
  const { d, services } = propositionVersDemande(propositionDepuisCarte(donnees), contexte);
  return services.map((t, i) => {
    const sv = serviceDeLecture({ ...t, offresIA: t.offres });
    const saisie = saisieInitiale(sv, { d, excursions, sd: siegesDemande(d) });
    if (taxi && bouts) boutsDuTrajet(saisie, bouts, { lieu: true });
    // Les lignes de la facture : celle du catalogue au prix de la carte, ou celle du transfert libre au prix tapé (demande.mjs, lignesDuService).
    const offre = (t.offres || [])[0] || null;
    const lignes = offre ? lignesAuPrixCarte([ligneDepuisPrestation(offre.source, null, { langue: "en", date: sv.date, qte: offre.vehicules || quantiteParDefaut(offre.source.unite, { adultes: sv.adultes, enfants: sv.enfants }), uid: () => `l${i}` })], offre.prixCarte) : sv.transfertLibre ? [ligneTransfertPrive({ ...sv.transfertLibre, prix: sv.prixLibre, date: sv.date }, null, { uid: () => `l${i}` })] : [];
    const [{ reservation: creee }] = reservationsDepuisDocument({ dossier_id: DOS, contenu: { lignes } }, { uid: () => `r${i}` });
    const r = { ...creee, personnes: { adultes: sv.adultes, enfants: sv.enfants } };
    return { sv, d, saisie, offre, reservation: { ...r, ...champsReservation(r, entreeParService(sv, saisie, { garderVol: true })) } };
  });
}

// ---- 1. Carte « dossier », service du catalogue (Taxi, Secret, ZTP) ---------------------------------------------------------------
for (const [nom, fonctionnement, excursions, taxi] of [
  ["Taxi", "taxi", true, true],
  ["Secret", "excursions", true, false],
  ["ZTP", "sur_mesure", false, false],
]) {
  test(`1. ${nom}, carte « dossier », service du catalogue : chaque champ de la carte arrive sur la réservation`, async () => {
    const carte = (await executer("proposer_dossier", dossierCarte([service()]), ctx(fonctionnement), memo())).carte;
    const s = carte.donnees.services[0];
    assert.equal(s.vers, "Hotel Plage Exemple", "la fonction retire déjà le lien");
    assert.deepEqual(s.offre, { genre: "prestation", id: PR });
    assert.equal(s.prix, PRIX);
    const [{ reservation: r }] = cheminDossier(carte.donnees, { excursions, taxi, bouts: { pickup: "Koh Exemple", dropoff: "Ville Exemple" } });
    // Les sièges ne vont jamais chez ZTP (ses vouchers n'en impriment pas) ; tout le reste, partout.
    const { sieges, sieges_bebe, ...sansSieges } = ATTENDU;
    comparer(r, excursions ? ATTENDU : { ...sansSieges, sieges: undefined, sieges_bebe: undefined }, nom);
    assert.equal(r.personnes.bebes, 1, "les bébés du dossier");
    assert.equal(r.prestation_id, PR);
  });
}

// ---- 2. Carte « dossier », service libre (hors catalogue) ---------------------------------------------------------------------
test("2. carte « dossier », transfert hors catalogue : dépose, pickup précis, prix tapé et le reste arrivent sur la réservation", async () => {
  const carte = (await executer("proposer_dossier", dossierCarte([service({ ref: "", texte: "Private transfer" })]), ctx("taxi"), memo())).carte;
  const s = carte.donnees.services[0];
  assert.equal(s.offre, null);
  const [{ sv, reservation: r }] = cheminDossier(carte.donnees, { excursions: true, taxi: true });
  assert.deepEqual(sv.transfertLibre, { de: "Villa Exemple", vers: "Hotel Plage Exemple" }, "le pickup de la carte n'est plus remplacé par la zone de départ");
  comparer(r, ATTENDU, "libre");
  assert.match(r.libelle, /Villa Exemple.*Hotel Plage Exemple/, "le libellé dit les deux bouts");
});

test("2 bis. sans lieu de pickup, le départ (« de ») devient le pickup ; une ancienne carte avec un lien garde la dépose sans le lien", () => {
  const donnees = { client: { nom: "Client Exemple" }, adultes: 2, services: [{ texte: "Taxi", offre: { genre: "prestation", id: PR }, date: "2026-12-03", heure_pickup: "10:00", lieu_pickup: "", de: "Resort Exemple", vers: "Hotel Plage Exemple https://maps.app.goo.gl/exemple2 www.exemple.test", adultes: 2 }] };
  const [{ saisie, reservation: r }] = cheminDossier(donnees, { excursions: true, taxi: true, bouts: { pickup: "Koh Exemple", dropoff: "Ville Exemple" } });
  assert.equal(saisie.lieu, "Resort Exemple");
  comparer(r, { drop_off: "Hotel Plage Exemple", lieu_pickup: "Resort Exemple", heure_pickup: "10:00" }, "de");
  // Sans dépose sur la carte, Taxi garde le bout du trajet du catalogue, comme avant.
  const [{ reservation: r2 }] = cheminDossier({ ...donnees, services: [{ ...donnees.services[0], vers: "" }] }, { excursions: true, taxi: true, bouts: { pickup: "Koh Exemple", dropoff: "Ville Exemple" } });
  assert.equal(r2.details.drop_off, "Ville Exemple");
});

// ---- 3. Carte mixte : deux dossiers liés ---------------------------------------------------------------------------------------
test("3. carte mixte : chaque dossier lié reçoit les champs de ses propres services", async () => {
  const tour = { ref: refDe("P", PR2), texte: "Tour", date: "2026-12-04", heure_pickup: "08:00", lieu_pickup: "Resort Exemple", vers: "Marina Exemple", vol: "", bagages: 0, sieges: 0, sieges_bebe: 0, prix_saisi: "" };
  const carte = (await executer("proposer_dossier", dossierCarte([service(), service(tour)]), ctx("excursions"), memo())).carte;
  // L'espace unifié prépare chaque dossier avec ses services (views/agent.mjs, `sous`), par la même fiche cachée.
  assert.match(lire("src/gestion/js/views/agent.mjs"), /const sous = \(e\) => \(\{ \.\.\.c, donnees: \{ \.\.\.donnees, services: e\.services \} \}\);/);
  assert.match(lire("src/gestion/js/views/agent.mjs"), /creer: \(e, i, clientId\) => dans\(e\.entite_id, \(\) => ouvrirDemande\(null, preparation\(sous\(e\)\)/);
  const [[a], [b]] = carte.donnees.services.map((x) => cheminDossier({ ...carte.donnees, services: [x] }, { excursions: true }));
  comparer(a.reservation, ATTENDU, "dossier 1");
  assert.equal(carte.donnees.services[1].prix, b.offre.total, "le prix de la carte est celui de la fiche");
  comparer(b.reservation, { drop_off: "Marina Exemple", lieu_pickup: "Resort Exemple", heure_pickup: "08:00", vol: undefined, bagages: undefined, remarques: REMARQUE, adultes: 2, enfants: 1, montant_vente: b.offre.total }, "dossier 2");
});

// ---- 4. Carte « reservation » (ajout à un dossier) ----------------------------------------------------------------------------
test("4. carte « reservation » : la réservation ouverte dans la fenêtre, puis relue à l'enregistrement, garde chaque champ", async () => {
  const carte = (await executer("proposer_reservation", { titre: "Ajout", dossier: refDe("D", DOS), service: service() }, ctx("taxi"), memo())).carte;
  const r = reservationDepuisCarte(carte.donnees);
  comparer(r, ATTENDU, "à l'ouverture");
  // L'enregistrement de la fenêtre (views/reservations.mjs) : les champs du voucher sont relus, le reste de `details` est gardé.
  const form = lire("src/gestion/js/views/reservations.mjs");
  assert.match(form, /const d = \{ \.\.\.Object\.fromEntries\(Object\.entries\(dt\)\.filter\(\(\[k\]\) => k !== "pickup_zone" && k !== "modele_voucher"\)\), \.\.\.zoneGardee\(\), \.\.\.cv\.valeurs\(\) \};/);
  assert.match(form, /heure_pickup: heure\.value, lieu_pickup: lieu\.value\.trim\(\), personnes: \{ adultes: nb\(adultes\.value\) \|\| 0, enfants: nb\(enfants\.value\) \|\| 0, bebes: nb\(bebes\.value\) \|\| 0 \}/);
  assert.match(form, /const vente = saisie\(h\("input", \{ id: "r-vente", value: r\.montant_vente \?\? "" \}\), "montant"\);/);
  comparer({ ...r, details: { ...r.details, ...relus(r.details) } }, ATTENDU, "à l'enregistrement");
  // Sans lieu de pickup : le départ lu, comme pour une carte « dossier ».
  const sans = (await executer("proposer_reservation", { titre: "Ajout", dossier: refDe("D", DOS), service: service({ lieu_pickup: "" }) }, ctx("taxi"), memo())).carte;
  assert.equal(reservationDepuisCarte(sans.donnees).lieu_pickup, "Koh Exemple");
});

// ---- 5. Carte « modification » ------------------------------------------------------------------------------------------------
test("5. carte « modification » : chaque champ proposé arrive sur la réservation, les autres restent", async () => {
  const base = { ...catalogue.reservations[0], montant_vente: PRIX, details: { drop_off: "Ancien Hotel Exemple", vol: "FD1000", bagages: "1", remarques: "Old note.", sieges: 1 } };
  const memoModif = () => ({ ...memo(), textes: ["Flight FD3217 now, 3 bags"] });
  const cas = [
    ["drop_off", "Hotel Plage Exemple", (r) => r.details.drop_off],
    ["lieu_pickup", "Resort Exemple", (r) => r.lieu_pickup],
    ["heure_pickup", "10:45", (r) => r.heure_pickup],
    ["date", "2026-12-05", (r) => r.date_service],
    ["vol", "FD3217", (r) => r.details.vol],
    ["bagages", "3", (r) => r.details.bagages],
    ["sieges", "2", (r) => r.details.sieges],
    ["sieges_bebe", "1", (r) => r.details.sieges_bebe],
    ["sans_siege", "oui", (r) => r.details.sans_siege],
    ["adultes", "3", (r) => r.personnes.adultes],
    ["enfants", "2", (r) => r.personnes.enfants],
    ["remarque_voucher", REMARQUE, (r) => r.details.remarques],
  ];
  const attendu = { drop_off: "Hotel Plage Exemple", lieu_pickup: "Resort Exemple", heure_pickup: "10:45", date: "2026-12-05", vol: "FD3217", bagages: "3", sieges: 2, sieges_bebe: 1, sans_siege: true, adultes: 3, enfants: 2, remarque_voucher: `Old note.\n${REMARQUE}` };
  for (const [champ, valeur, lu] of cas) {
    const c = await executer("proposer_modification", { titre: "Modif", reservation: refDe("R", RES), champ, valeur, raison: "" }, ctx("taxi"), memoModif());
    assert.ok(c.carte, `${champ} : ${JSON.stringify(c.contenu || c)}`);
    const r = reservationModifiee(base, c.carte.donnees);
    assert.deepEqual(lu(r), attendu[champ], champ);
    // Relue par la fenêtre de réservation (formulaireReservation, `base`) : rien ne se perd, le reste ne bouge pas.
    const enr = { ...r, details: { ...r.details, ...relus(r.details) } };
    assert.deepEqual(lu(enr), attendu[champ], `${champ} à l'enregistrement`);
    assert.equal(enr.montant_vente, PRIX, `${champ} : le prix reste`);
    for (const k of ["drop_off", "vol", "bagages", "remarques"]) if (!["drop_off", "vol", "bagages", "remarque_voucher"].includes(champ)) assert.equal(enr.details[k], base.details[k], `${champ} : details.${k} reste`);
  }
});

// ---- 6. « Vérifier avant » : la fiche de création ouverte, pré-remplie -------------------------------------------------------
test("6. « Vérifier avant » : le bloc du voucher montre chaque champ de la carte, et l'enregistrer sans retouche ne perd rien", async () => {
  const carte = (await executer("proposer_dossier", dossierCarte([service()]), ctx("taxi"), memo())).carte;
  const [{ sv, saisie, offre, reservation: r }] = cheminDossier(carte.donnees, { excursions: true, taxi: true, bouts: { pickup: "Koh Exemple", dropoff: "Ville Exemple" } });
  // Le bloc tel que la fiche le dessine (majService : blocServiceCreation, sauf heure et personnes qui ont leurs champs sur la ligne du service).
  const bloc = blocServiceCreation({ service: { type: "transfert", personnes: { adultes: 2, enfants: 1 }, pickup: "Koh Exemple", dropoff: "Ville Exemple", date: sv.date }, saisie, taxi: true, prefixe: "svc1-v", sauf: ["heure", "adultes", "enfants"], ouvert: false });
  const valeur = (id) => (trouver(bloc, `svc1-v-${id}`) || {}).value;
  assert.equal(valeur("drop"), "Hotel Plage Exemple");
  assert.equal(valeur("lieu"), "Villa Exemple");
  assert.equal(valeur("vol"), "FD3217");
  assert.equal(valeur("bagages"), "2");
  assert.equal(valeur("sieges"), "1");
  assert.equal(valeur("sieges-bebe"), "1");
  assert.equal(valeur("remarques"), REMARQUE);
  assert.equal(saisie.bebes, 1, "les bébés du dossier (pas de champ chez Taxi : ils viennent du dossier)");
  // L'heure, les personnes et le prix : sur la ligne du service (champ4 de construireService, prix de l'offre).
  assert.deepEqual([sv.heure, sv.adultes, sv.enfants, offre.total], ["09:15", 2, 1, PRIX]);
  assert.deepEqual(relus({ ...saisie.details, sieges: saisie.sieges }), { drop_off: "Hotel Plage Exemple", vol: "FD3217", bagages: "2", remarques: REMARQUE, sieges: 1, sieges_bebe: 1 });
  comparer(r, ATTENDU, "créée");
  // Secret : le bloc du voucher de transfert (champsVoucherDe), même pré-remplissage.
  const carteS = (await executer("proposer_dossier", dossierCarte([service()]), ctx("excursions"), memo())).carte;
  const [{ saisie: saisieS }] = cheminDossier(carteS.donnees, { excursions: true });
  const blocS = blocServiceCreation({ service: { type: "transfert", personnes: { adultes: 2, enfants: 1 }, date: sv.date }, saisie: saisieS, taxi: false, prefixe: "svc2-v", sauf: ["heure", "adultes", "enfants"], ouvert: false });
  const valeurS = (id) => (trouver(blocS, `svc2-v-${id}`) || {}).value;
  assert.deepEqual(["drop", "lieu", "vol", "bagages", "sieges", "sieges-bebe", "remarques"].map(valeurS), ["Hotel Plage Exemple", "Villa Exemple", "FD3217", "2", "1", "1", REMARQUE]);
  // « Vérifier avant » ouvre la même fiche, avec la même préparation que la validation d'un geste.
  const agent = lire("src/gestion/js/views/agent.mjs");
  assert.match(agent, /\(await import\("\.\/demande\.mjs"\)\)\.ouvrirDemande\(null, preparation\(vue\), \{ titre: c\.titre,/);
  assert.match(agent, /ouvrirDemande\(null, preparation\(\{ \.\.\.c, donnees: donneesCarte\(c\) \}\), \{ auto: true,/);
});

// ---- 7. Demande du site -------------------------------------------------------------------------------------------------------
test("7. demande du site (trajet) : chaque champ du formulaire arrive sur la réservation", () => {
  const texte = "Transfer request: Exemple Airport to Koh Exemple\nDate: Tue 15 Dec 2026\nPickup time: 14:30\nFlight or ferry: FD3217\nGuests: 2 adults, 1 child (age 5)\nChild seats: 1\nBags: 3\nPickup: Exemple Airport (EXA)\nDrop-off: Hotel Plage Exemple\nName: Client Exemple";
  const d = lireMessage(texte, "2026-11-23");
  assert.equal(d.type, "transfer");
  const [t] = decouperServices(texte, d, { ...contexte, nomPartenaire: () => "", taxi: true }, "2026-11-23");
  for (const [excursions, nom] of [[true, "Taxi ou Secret"], [false, "ZTP"]]) {
    const sv = serviceDeLecture(t);
    const saisie = saisieInitiale(sv, { d, excursions, sd: siegesDemande(d) });
    // reservationDe : un trajet du site donne son pickup (lieuFinal) ; le prix annoncé se pose par « Modifier » (prixImpose, imposerTotal).
    const lignes = imposerTotal([ligneTransfertPrive({ de: d.pickup, vers: d.dropoff, prix: 1, date: sv.date }, null, { uid: () => "l" })], 2800);
    const [{ reservation: creee }] = reservationsDepuisDocument({ dossier_id: DOS, contenu: { lignes } }, { uid: () => "r" });
    const r0 = { ...creee, personnes: { adultes: sv.adultes, enfants: sv.enfants } };
    const r = { ...r0, ...champsReservation(r0, entreeParService(sv, saisie, { lieuFinal: d.pickup })) };
    comparer(r, { drop_off: "Hotel Plage Exemple", lieu_pickup: "Exemple Airport (EXA)", heure_pickup: "14:30", vol: "FD3217", bagages: "3", sieges: excursions ? 1 : undefined, adultes: 2, enfants: 1, montant_vente: 2800 }, nom);
  }
});

test("la fiche de création passe par les fonctions testées ici", () => {
  const demande = lire("src/gestion/js/views/demande.mjs");
  assert.match(demande, /nouveauService\(serviceDeLecture\(t\)\)/);
  assert.match(demande, /sv\.saisie = saisieInitiale\(sv, \{ d, excursions: modeExcursions\(\), sd: siegesDemande\(d\) \}\);/);
  assert.match(demande, /return entreeParService\(sv, sv\.saisie \|\| saisieVide\(\), \{/);
  assert.match(demande, /: offre \? lignesAuPrixCarte\(lignesDe\(offre, \{ date: sv\.date, adultes: sv\.adultes, enfants: sv\.enfants \}, langue, devise\), offre\.prixCarte\) : \[\]\);/);
  assert.match(lire("src/gestion/js/views/creation-excursions.mjs"), /const champs = propre \? champsReservation\(r, propre\) : \{\};/);
});
