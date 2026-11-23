// Tous les chemins qui créent ou modifient une réservation depuis l'Assistant (et la demande du site), par le vrai code (relecture de la
// PR 332). Le 23.11.2026, un service du catalogue validé par une carte « dossier » avait perdu sa dépose (`vers`), que le voucher imprime.
// Chaque test part d'une carte faite par la fonction de l'Assistant (executer), la passe par l'écran réel (views/agent-valider.mjs,
// views/demande.mjs, views/reservations.mjs, views/confirmation.mjs) sur la démo (store-local.mjs, le magasin du mode démo) et un DOM
// minimal (aides-dom.mjs), puis compare champ par champ ce que l'écran a passé à `inserer` et `modifier` avec la carte : drop-off, pickup,
// départ (`de`), heure, vol, sièges par type, bagages, remarque du voucher, personnes, prix, partenaire et paiement sur place.
// Données inventées : aucun client, hôtel ni partenaire réel.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { installerDom } from "./aides-dom.mjs";

const dom = installerDom();
globalThis.location.search = "?demo";
const E = await import("../src/gestion/js/etat.mjs");
await E.init();
const { executer, refDe } = await import("../supabase/functions/agent/outils.js");
const { tempsSimule } = await import("../supabase/functions/agent/planifier.js");
const { reservationDepuisCarte, reservationModifiee } = await import("../src/gestion/js/agent-calc.mjs");
const V = await import("../src/gestion/js/views/agent-valider.mjs");
const { ouvrirDemande } = await import("../src/gestion/js/views/demande.mjs");
const { ouvrirConfirmation } = await import("../src/gestion/js/views/confirmation.mjs");
const { partenaireDeTaxi, chauffeurRegle } = await import("../src/gestion/js/voucher-rapide-calc.mjs");
after(() => setTimeout(() => process.exit(process.exitCode || 0), 50).unref());

// ---- Le banc : la démo, ses trois entreprises, et chaque écriture de l'écran ------------------------------------------------------
const entite = (slug) => E.etat.brut.entites.find((e) => e.slug === slug);
const dans = (slug) => E.changerEntite(entite(slug).id, { naviguer: false });
// Chaque appel au magasin : { op, table, id, valeurs } (valeurs : ce que l'écran a passé, tel quel).
const ecrits = [];
for (const op of ["inserer", "modifier"]) {
  const f = E.etat.store[op].bind(E.etat.store);
  E.etat.store[op] = async (table, ...a) => {
    const r = await f(table, ...a);
    ecrits.push(op === "inserer" ? { op, table, id: r.id, valeurs: structuredClone(a[0]) } : { op, table, id: a[0], valeurs: structuredClone(a[1]) });
    return r;
  };
}
// La réservation telle que l'écran l'a écrite : son `inserer`, puis chaque `modifier` par-dessus, dans l'ordre.
function ecrite(id) {
  const liste = ecrits.filter((e) => e.table === "reservations" && e.id === id);
  assert.ok(liste.length && liste[0].op === "inserer", "la réservation est créée par l'écran");
  return liste.reduce((r, e) => ({ ...r, ...e.valeurs, ...(e.valeurs.details ? { details: { ...(r.details || {}), ...e.valeurs.details } } : {}) }), {});
}
const reservationsDu = (dossierId) => E.etat.brut.reservations.filter((r) => r.dossier_id === dossierId).map((r) => ecrite(r.id));

// La fonction de l'Assistant lit le catalogue de l'entreprise active.
const ctx = () => ({ charger: async (n) => E.etat.db[n] || [], reglages: E.reglages(), simule: tempsSimule });
const PRIX = 3000;
const memo = (textes = []) => ({ prix: new Set(), heures: new Set(), tapes: new Set([PRIX]), durees: new Set(), estimations: new Map(), signer: false, prestataires: [], entreprise: "Test", textes: ["Flight FD3217 tomorrow, 3000 THB, drop at Hotel Plage Exemple https://maps.app.goo.gl/exemple1", ...textes] });
const REMARQUE = "Driver waits in the lobby with a name sign.";

// Le catalogue de chaque entreprise, créé une fois : un transfert dont le libellé donne ses deux bouts, et une excursion.
const catalogue = {};
async function catalogueDe(slug) {
  if (catalogue[slug]) return catalogue[slug];
  dans(slug);
  const transfert = await E.inserer("prestations", { famille: "transfert", groupe: "Taxi", libelle: "Embarcadere Exemple → Klong Exemple Beach", libelle_en: "Embarcadere Exemple → Klong Exemple Beach", prix_vente: 2500, unite: "veh", actif: true });
  const tour = await E.inserer("prestations", { famille: "excursion", groupe: "Tour", libelle: "Tour Exemple", libelle_en: "Tour Exemple", prix_vente: 1500, unite: "pp", actif: true });
  return (catalogue[slug] = { transfert, tour });
}
// Le service du cas réel du 23.11.2026, rendu fictif : un service du catalogue, une dépose d'hôtel (avec le lien Maps lu), 2 bagages, un prix tapé.
const service = (o = {}) => ({ texte: "Taxi to Ville Exemple", ref: "", date: "2026-12-03", heure_pickup: "09:15", lieu_pickup: "Villa Exemple", de: "Koh Exemple", vers: "Hotel Plage Exemple https://maps.app.goo.gl/exemple1", adultes: 2, enfants: 1, sieges: 1, sieges_bebe: 1, sans_siege: false, bagages: 2, prix_saisi: String(PRIX), vol: "FD3217", remarque_voucher: REMARQUE, note_interne: "", ...o });
let n = 0;
const dossierCarte = (services, o = {}) => ({ titre: "Dossier", client_nom: `Client Exemple ${++n}`, client_telephone: `+4179000${String(1000 + n)}`, hotel: "", langue: "en", adultes: 2, enfants: 1, bebes: 1, services, apporteur: "", ...o });
const carteDe = async (outil, e) => {
  const r = await executer(outil, e, ctx(), memo());
  assert.ok(r.carte, JSON.stringify(r.contenu || r));
  return { id: `carte-${++n}`, ...r.carte, statut: "proposee" };
};
const chauffeur = () => partenaireDeTaxi(E.etat.db.partenaires, chauffeurRegle(E.reglages()));

// Ce que la carte dit du service, dans les clés de la réservation, et la comparaison champ par champ avec ce que l'écran a écrit.
const CLES = ["drop_off", "lieu_pickup", "heure_pickup", "vol", "sieges", "sieges_bebe", "sans_siege", "bagages", "remarques", "adultes", "enfants", "bebes", "montant_vente", "partenaire_id", "paye_sur_place"];
const aplatir = (r) => {
  const d = r.details || {};
  const p = r.personnes || {};
  return { drop_off: d.drop_off, lieu_pickup: r.lieu_pickup, heure_pickup: r.heure_pickup, vol: d.vol, sieges: d.sieges, sieges_bebe: d.sieges_bebe, sans_siege: d.sans_siege, bagages: d.bagages, remarques: d.remarques, adultes: p.adultes, enfants: p.enfants, bebes: p.bebes, montant_vente: r.montant_vente, partenaire_id: r.partenaire_id ?? null, paye_sur_place: r.paye_sur_place };
};
function comparer(r, attendu, quoi) {
  const a = aplatir(r);
  for (const k of Object.keys(attendu)) {
    assert.ok(CLES.includes(k), k);
    assert.deepEqual(a[k], attendu[k], `${quoi} : ${k}`);
  }
  assert.doesNotMatch(JSON.stringify(r.details || {}), /https?:|goo\.gl|maps\.app|www\./, `${quoi} : aucun lien`);
}
const DE_LA_CARTE = { drop_off: "Hotel Plage Exemple", lieu_pickup: "Villa Exemple", heure_pickup: "09:15", vol: "FD3217", sieges: 1, sieges_bebe: 1, bagages: "2", remarques: REMARQUE, adultes: 2, enfants: 1, montant_vente: PRIX };
const sansSieges = ({ sieges, sieges_bebe, ...reste }) => ({ ...reste, sieges: undefined, sieges_bebe: undefined });

// Valider d'un geste une carte « dossier » simple : la fiche de création, cachée (views/agent.mjs, valider).
const validerDossier = (c) => ouvrirDemande(null, V.preparation(c), { auto: true, titre: c.titre, surCree: () => {} });

// ---- 1. Carte « dossier », service du catalogue (Taxi, Secret, ZTP) ---------------------------------------------------------------
for (const [nom, slug] of [["Taxi", "taxi"], ["Secret", "excursions"], ["ZTP", "agence"]]) {
  test(`1. ${nom}, carte « dossier », service du catalogue : chaque champ de la carte arrive sur la réservation écrite`, async () => {
    const { transfert } = await catalogueDe(slug);
    dans(slug);
    const c = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", transfert.id) })]));
    assert.equal(c.donnees.services[0].vers, "Hotel Plage Exemple", "la fonction retire déjà le lien");
    const r = await validerDossier(c);
    assert.equal(r.ok, true, r.motif);
    const [resa] = reservationsDu(r.dossier.id);
    const taxi = slug === "taxi";
    // Les sièges ne vont jamais chez ZTP (ses vouchers n'en impriment pas). Chez Taxi, la course est au chauffeur réglé, payée sur place.
    comparer(resa, { ...(slug === "agence" ? sansSieges(DE_LA_CARTE) : DE_LA_CARTE), bebes: 1, partenaire_id: taxi ? (chauffeur() || {}).id || null : null, ...(taxi ? { paye_sur_place: true } : {}) }, nom);
    assert.equal(resa.prestation_id, transfert.id);
  });
}

// ---- Les lieux d'un transfert : arrivée, départ, embarcadère, inter-îles (relecture de la PR 332) ---------------------------------
// Une arrivée part de l'aéroport ou de l'embarcadère, jamais de l'hôtel du client, qui devient le drop-off ; un départ part de l'hôtel. Le
// lieu où se trouve l'hôtel (hotels_lieux, « Koh Exemple ») tranche un trajet entre deux îles. Jamais le même lieu en pickup et en drop-off.
const TRAJETS = {
  arrivee: "Exemple Airport → Koh Exemple",
  depart: "Koh Exemple → Exemple Airport",
  embarcadere: "Exemple Pier → Koh Exemple",
  versIle: "Koh Seconde → Koh Exemple",
  depuisIle: "Koh Exemple → Koh Seconde",
};
const prestationsTrajets = {};
async function trajetsDe(slug) {
  dans(slug);
  if (!prestationsTrajets[slug]) {
    prestationsTrajets[slug] = {};
    for (const [k, libelle] of Object.entries(TRAJETS)) prestationsTrajets[slug][k] = await E.inserer("prestations", { famille: "transfert", groupe: "Taxi", libelle, libelle_en: libelle, prix_vente: 2500, unite: "veh", actif: true });
    // L'hôtel de test est situé à Koh Exemple (hotels_lieux), comme l'Assistant le retrouve.
    await E.chargerHotelsLieux();
    await E.enregistrerHotelLieu({ cle: "resort exemple", nom: "Resort Exemple", lieu: "Koh Exemple", zone: "", localite: "", source_url: "", source_titre: "", certitude: "sure", verifie: true });
  }
  dans(slug);
  return prestationsTrajets[slug];
}
// [nom, trajet, hôtel du client, pickup attendu, drop-off attendu] ; la carte ne donne ni pickup, ni départ, ni dépose.
const MATRICE = [
  ["arrivée à l'aéroport, hôtel connu", "arrivee", "Resort Exemple", "Exemple Airport", "Resort Exemple"],
  ["arrivée à l'aéroport, sans hôtel", "arrivee", "", "Exemple Airport", "Koh Exemple"],
  ["départ de l'hôtel vers l'aéroport", "depart", "Resort Exemple", "Resort Exemple", "Exemple Airport"],
  ["embarcadère vers l'hôtel", "embarcadere", "Resort Exemple", "Exemple Pier", "Resort Exemple"],
  ["inter-îles, vers l'île de l'hôtel", "versIle", "Resort Exemple", "Koh Seconde", "Resort Exemple"],
  ["inter-îles, depuis l'île de l'hôtel", "depuisIle", "Resort Exemple", "Resort Exemple", "Koh Seconde"],
];
const sansLieux = { lieu_pickup: "", de: "", vers: "" };
const AUTRES = { heure_pickup: "09:15", vol: "FD3217", sieges: 1, sieges_bebe: 1, bagages: "2", remarques: REMARQUE, adultes: 2, montant_vente: PRIX };

test("lieux d'un transfert, chemin 1 (carte « dossier » du catalogue, Taxi) : arrivée, départ, embarcadère, inter-îles", async () => {
  const t = await trajetsDe("taxi");
  for (const [quoi, k, hotel, pickup, dropoff] of MATRICE) {
    const c = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", t[k].id), ...sansLieux })], { hotel }));
    const r = await validerDossier(c);
    assert.equal(r.ok, true, `${quoi} : ${r.motif}`);
    comparer(reservationsDu(r.dossier.id)[0], { ...AUTRES, enfants: 1, bebes: 1, lieu_pickup: pickup, drop_off: dropoff, partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, quoi);
  }
  // Le pickup de la carte l'emporte toujours ; un départ lu (« de ») qui est un aéroport part de l'aéroport.
  const c = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", t.arrivee.id), lieu_pickup: "Villa Exemple", de: "", vers: "" })], { hotel: "Resort Exemple" }));
  comparer(reservationsDu((await validerDossier(c)).dossier.id)[0], { lieu_pickup: "Villa Exemple", drop_off: "Resort Exemple" }, "pickup de la carte");
  // Secret : la même règle pour le pickup ; l'hôtel devient le drop-off d'une arrivée (aucun bout d'arrivée imprimé chez Secret).
  const tS = await trajetsDe("excursions");
  const cS = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", tS.arrivee.id), ...sansLieux })], { hotel: "Resort Exemple" }));
  comparer(reservationsDu((await validerDossier(cS)).dossier.id)[0], { lieu_pickup: "Exemple Airport", drop_off: "Resort Exemple" }, "Secret, arrivée");
  const cS2 = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", tS.arrivee.id), ...sansLieux })], { hotel: "" }));
  comparer(reservationsDu((await validerDossier(cS2)).dossier.id)[0], { lieu_pickup: "Exemple Airport", drop_off: undefined }, "Secret, arrivée sans hôtel");
});

test("lieux d'un transfert, chemin 4 (carte « reservation », Taxi) : la même règle, avec l'hôtel du dossier", async () => {
  const t = await trajetsDe("taxi");
  for (const [quoi, k, hotel, pickup, dropoff] of MATRICE) {
    const client = await E.inserer("clients", { civilite: "", prenom: "Client", nom: `Exemple ${++n}`, adresse: hotel, telephone: `+4179001${1000 + n}`, email: "", notes: "" });
    const dossier = await E.inserer("dossiers", { ref: `T-L${n}`, client_id: client.id, pays: "", bandeau: "", accepte_le: "2026-11-23", annule: false, notes: "" });
    const c = await carteDe("proposer_reservation", { titre: "Ajout", dossier: refDe("D", dossier.id), service: service({ ref: refDe("P", t[k].id), enfants: 2, ...sansLieux }) });
    // La liste des hôtels situés en mémoire est celle d'une autre entreprise, comme après une fiche ouverte ailleurs : la validation la relit.
    dans("excursions");
    await E.chargerHotelsLieux();
    dans("taxi");
    const r = await V.ajouterParCarte(c, "Service ajouté au dossier.");
    assert.equal(r.ok, true, `${quoi} : ${r.motif}`);
    comparer(ecrite(r.reservation.id), { ...AUTRES, enfants: 2, lieu_pickup: pickup, drop_off: dropoff, partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, quoi);
  }
});

test("lieux d'un transfert, message collé (Taxi) : une arrivée lue dans le message part de l'aéroport, l'hôtel est le drop-off", async () => {
  const t = await trajetsDe("taxi");
  for (const [quoi, k] of [["arrivée", "arrivee"], ["départ", "depart"]]) {
    const [de, vers] = TRAJETS[k].split(" → ");
    const texte = `Hello, we need a private taxi from ${de} to ${vers} on 15/12/2026, pickup 14:30, 2 adults. We stay at Resort Exemple. Name: Client Exemple ${++n}`;
    let cree = null;
    ouvrirDemande({ texte, titre: "Message", telephone: `+4179002${1000 + n}`, surCree: ({ dossier }) => (cree = dossier) });
    await dom.attendre(10);
    const [bouton] = dom.boutons("Créer le dossier").slice(-1);
    bouton.click();
    await dom.attendre(60);
    assert.ok(cree, `${quoi} : dossier créé`);
    const [resa] = reservationsDu(cree.id);
    // Un message libre ne dit pas le sens du trajet à la lecture (ni « de » ni « vers ») : le trajet retenu vient de la recherche par mots du
    // catalogue. Quel qu'il soit, ses lieux suivent la règle : une arrivée part de l'aéroport, un départ de l'hôtel.
    const retenu = Object.keys(t).find((x) => t[x].id === resa.prestation_id);
    assert.ok(["arrivee", "depart"].includes(retenu), `${quoi} : un des deux trajets`);
    const [lieuPickup, lieuDepose] = retenu === "arrivee" ? ["Exemple Airport", "Resort Exemple"] : ["Resort Exemple", "Exemple Airport"];
    comparer(resa, { lieu_pickup: lieuPickup, drop_off: lieuDepose, heure_pickup: "14:30", adultes: 2, partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, `message, ${quoi}`);
  }
});

// ---- La dépose : un établissement l'emporte sur le bout du catalogue, une simple zone non ---------------------------------------
test("dépose chez Taxi : l'établissement de la carte l'emporte sur le bout du catalogue ; une zone que le bout précise lui cède la place", async () => {
  const { transfert } = await catalogueDe("taxi");
  dans("taxi");
  for (const [vers, attendu] of [["Hotel Plage Exemple", "Hotel Plage Exemple"], ["Klong Exemple", "Klong Exemple Beach"], ["", "Klong Exemple Beach"]]) {
    const c = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", transfert.id), vers })]));
    const r = await validerDossier(c);
    assert.equal(r.ok, true, r.motif);
    assert.equal(reservationsDu(r.dossier.id)[0].details.drop_off, attendu, `dossier, vers « ${vers} »`);
  }
  // Carte « reservation » : la même règle (optionsCarte donne les bouts du catalogue chez Taxi).
  const dossier = await E.inserer("dossiers", { ref: "T-ZONE", client_id: null, pays: "", bandeau: "", accepte_le: "2026-11-23", annule: false, notes: "" });
  for (const [vers, attendu] of [["Hotel Plage Exemple", "Hotel Plage Exemple"], ["Klong Exemple", "Klong Exemple Beach"]]) {
    const c = await carteDe("proposer_reservation", { titre: "Ajout", dossier: refDe("D", dossier.id), service: service({ ref: refDe("P", transfert.id), vers }) });
    assert.equal(reservationDepuisCarte(c.donnees, V.optionsCarte(c)).details.drop_off, attendu, `reservation, vers « ${vers} »`);
  }
});

// ---- 2. Carte « dossier », transfert libre ------------------------------------------------------------------------------------
test("2. carte « dossier », transfert hors catalogue : dépose, pickup, prix tapé, chauffeur et le reste arrivent sur la réservation", async () => {
  dans("taxi");
  const c = await carteDe("proposer_dossier", dossierCarte([service({ texte: "Private transfer" })]));
  assert.equal(c.donnees.services[0].offre, null);
  const r = await validerDossier(c);
  assert.equal(r.ok, true, r.motif);
  const [resa] = reservationsDu(r.dossier.id);
  comparer(resa, { ...DE_LA_CARTE, bebes: 1, partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, "libre");
  assert.match(resa.libelle, /Villa Exemple.*Hotel Plage Exemple/, "le libellé dit les deux bouts");
  // Sans lieu de pickup : le départ lu (« de ») d'un transfert libre.
  const c2 = await carteDe("proposer_dossier", dossierCarte([service({ texte: "Private transfer", lieu_pickup: "" })], { hotel: "Resort Exemple" }));
  const r2 = await validerDossier(c2);
  assert.equal(reservationsDu(r2.dossier.id)[0].lieu_pickup, "Koh Exemple");
});

// ---- 3. Carte mixte : deux dossiers liés (espace unifié) -----------------------------------------------------------------------
test("3. carte mixte : validerUnifie crée deux dossiers liés, chacun avec les champs de ses propres services", async () => {
  const cs = await catalogueDe("excursions");
  const ct = await catalogueDe("taxi");
  // La carte de l'espace unifié : chaque service porte son entreprise (celle de son catalogue).
  dans("excursions");
  const s1 = (await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", cs.tour.id), texte: "Tour", date: "2026-12-04", heure_pickup: "08:00", lieu_pickup: "Resort Exemple", vers: "Marina Exemple", vol: "", bagages: 0, sieges: 0, sieges_bebe: 0, prix_saisi: "", enfants: 0 })]))).donnees.services[0];
  dans("taxi");
  const base = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", ct.transfert.id) })]));
  const s2 = base.donnees.services[0];
  const donnees = { ...base.donnees, services: [{ ...s1, entite_id: entite("excursions").id, entreprise: "secret" }, { ...s2, entite_id: entite("taxi").id, entreprise: "taxi" }], entreprises: ["secret", "taxi"] };
  const c = { ...base, donnees };
  // Le partage réciproque des fiches Secret et Taxi (migration 63, posé par la base pour Zwald ; la démo le pose à la première carte mixte).
  for (const [a, b] of [["excursions", "taxi"], ["taxi", "excursions"]]) await E.etat.store.partagerClients(entite(a).id, entite(b).id, true);
  await E.recharger();
  dans("taxi");
  const r = await V.validerUnifie(c, { donnees, libelleEntreprise: (id) => id });
  assert.equal(r.ok, true, r.motif);
  assert.equal(r.dossiers.length, 2);
  const [dS, dT] = ["excursions", "taxi"].map((slug) => r.dossiers.find((d) => d.entite_id === entite(slug).id));
  assert.equal(E.etat.brut.dossiers.find((d) => d.id === dS.id).dossier_lie_id, dT.id, "liés des deux côtés");
  assert.equal(E.etat.brut.dossiers.find((d) => d.id === dT.id).dossier_lie_id, dS.id);
  const [rS] = reservationsDu(dS.id);
  const [rT] = reservationsDu(dT.id);
  // Une excursion sans tarif enfant compte les enfants au tarif adulte (règle de la facture, « enfant_plein_tarif ») : ce service n'en a pas.
  comparer(rS, { drop_off: "Marina Exemple", lieu_pickup: "Resort Exemple", heure_pickup: "08:00", vol: undefined, bagages: undefined, remarques: REMARQUE, adultes: 2, enfants: 0, bebes: 1, montant_vente: s1.prix, partenaire_id: null }, "dossier Secret");
  comparer(rT, { ...DE_LA_CARTE, bebes: 1, partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, "dossier Taxi");
});

// ---- 4. Carte « reservation » : la fenêtre de réservation, enregistrée telle quelle ------------------------------------------
test("4. carte « reservation » : formulaireReservation par enregistrerReservation, avec le chauffeur, le règlement et le lieu du dossier", async () => {
  const { transfert } = await catalogueDe("taxi");
  dans("taxi");
  const client = await E.inserer("clients", { civilite: "", prenom: "Client", nom: "Exemple R", adresse: "Resort Exemple", telephone: "+41790001999", email: "", notes: "" });
  const dossier = await E.inserer("dossiers", { ref: "T-RES", client_id: client.id, pays: "", bandeau: "", accepte_le: "2026-11-23", annule: false, notes: "" });
  const c = await carteDe("proposer_reservation", { titre: "Ajout", dossier: refDe("D", dossier.id), service: service({ ref: refDe("P", transfert.id), enfants: 2 }) });
  const r = await V.enregistrerReservation(reservationDepuisCarte(c.donnees, V.optionsCarte(c)), "Service ajouté au dossier.");
  assert.equal(r.ok, true, r.motif);
  // Deux enfants pour un child seat et un baby seat (une carte « reservation » n'a pas les bébés du dossier).
  comparer(ecrite(r.reservation.id), { ...DE_LA_CARTE, enfants: 2, partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, "ajout");
  assert.equal(ecrite(r.reservation.id).dossier_id, dossier.id);
  // Sans lieu de pickup : la règle des transferts (test « lieux d'un transfert, chemin 4 ») ; un service qui n'est pas un transfert prend le
  // lieu du dossier (lieuParDefaut), sinon le départ lu.
  dans("excursions");
  const { tour } = await catalogueDe("excursions");
  const cS = await E.inserer("clients", { civilite: "", prenom: "Client", nom: "Exemple S", adresse: "Resort Exemple", telephone: "+41790001998", email: "", notes: "" });
  const dS = await E.inserer("dossiers", { ref: "S-RES", client_id: cS.id, pays: "", bandeau: "", accepte_le: "2026-11-23", annule: false, notes: "" });
  const c4 = await carteDe("proposer_reservation", { titre: "Ajout", dossier: refDe("D", dS.id), service: service({ lieu_pickup: "", texte: "Tour", ref: refDe("P", tour.id) }) });
  assert.equal(reservationDepuisCarte(c4.donnees, V.optionsCarte(c4)).lieu_pickup, "Resort Exemple", "excursion : l'hôtel du client");
  const vS = await E.inserer("dossiers", { ref: "S-RES2", client_id: null, pays: "", bandeau: "", accepte_le: "2026-11-23", annule: false, notes: "" });
  const c5 = await carteDe("proposer_reservation", { titre: "Ajout", dossier: refDe("D", vS.id), service: service({ lieu_pickup: "", texte: "Tour", ref: refDe("P", tour.id) }) });
  assert.equal(reservationDepuisCarte(c5.donnees, V.optionsCarte(c5)).lieu_pickup, "Koh Exemple", "rien d'autre : le départ lu");
});

// ---- 5. Carte « modification » : chaque champ, par la même fenêtre ---------------------------------------------------------------
test("5. carte « modification » : chaque champ proposé arrive par modifier, le reste ne bouge pas", async () => {
  const { transfert } = await catalogueDe("taxi");
  dans("taxi");
  const dossier = await E.inserer("dossiers", { ref: "T-MOD", client_id: null, pays: "", bandeau: "", accepte_le: "2026-11-23", annule: false, notes: "" });
  const base = await E.inserer("reservations", { dossier_id: dossier.id, prestation_id: transfert.id, libelle: "Embarcadere Exemple → Klong Exemple Beach", date_service: "2026-12-03", heure_pickup: "09:15", lieu_pickup: "Villa Exemple", personnes: { adultes: 2, enfants: 3 }, statut: "confirme", montant_vente: PRIX, paye_sur_place: true, details: { drop_off: "Ancien Hotel Exemple", vol: "FD1000", bagages: "1", remarques: "Old note.", sieges: 1 } });
  const cas = [
    ["drop_off", "Hotel Plage Exemple", (r) => r.details.drop_off, "Hotel Plage Exemple"],
    ["lieu_pickup", "Resort Exemple", (r) => r.lieu_pickup, "Resort Exemple"],
    ["heure_pickup", "10:45", (r) => r.heure_pickup, "10:45"],
    ["date", "2026-12-05", (r) => r.date_service, "2026-12-05"],
    ["vol", "FD3217", (r) => r.details.vol, "FD3217"],
    ["bagages", "3", (r) => r.details.bagages, "3"],
    ["sieges", "2", (r) => r.details.sieges, 2],
    ["sieges_bebe", "1", (r) => r.details.sieges_bebe, 1],
    ["sans_siege", "oui", (r) => r.details.sans_siege, true],
    ["adultes", "3", (r) => r.personnes.adultes, 3],
    ["enfants", "4", (r) => r.personnes.enfants, 4],
    ["remarque_voucher", REMARQUE, (r) => r.details.remarques, `Old note.\n${REMARQUE}`],
  ];
  for (const [champ, valeur, lu, attendu] of cas) {
    const avant = structuredClone(E.etat.brut.reservations.find((x) => x.id === base.id));
    const c = await executer("proposer_modification", { titre: "Modif", reservation: refDe("R", base.id), champ, valeur, raison: "" }, ctx(), memo(["Flight FD3217 now, 3 bags"]));
    assert.ok(c.carte, `${champ} : ${JSON.stringify(c.contenu || c)}`);
    const depuis = ecrits.length;
    const r = await V.enregistrerReservation(reservationModifiee(avant, c.carte.donnees), "Service modifié.", avant);
    assert.equal(r.ok, true, `${champ} : ${r.motif}`);
    const patchs = ecrits.slice(depuis).filter((e) => e.table === "reservations" && e.id === base.id);
    assert.ok(patchs.length, `${champ} : écrit par modifier`);
    const apres = E.etat.brut.reservations.find((x) => x.id === base.id);
    assert.deepEqual(lu(apres), attendu, champ);
    // Le reste ne bouge pas : prix, partenaire, paiement sur place, et les autres champs du voucher.
    assert.equal(apres.montant_vente, PRIX, `${champ} : prix`);
    assert.equal(apres.paye_sur_place, true, `${champ} : paiement sur place`);
    for (const k of ["drop_off", "vol", "bagages"]) if (!(champ === k || (champ === "drop_off" && k === "drop_off"))) assert.equal(apres.details[k], avant.details[k], `${champ} : details.${k}`);
  }
});

// ---- 6. « Vérifier avant » : la fiche affichée, pré-remplie, puis « Créer le dossier » ----------------------------------------
test("6. « Vérifier avant » : la fiche montre chaque champ de la carte, et la créer sans retouche ne perd rien", async () => {
  const { transfert } = await catalogueDe("taxi");
  dans("taxi");
  const c = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", transfert.id) })]));
  let cree = null;
  const ouverte = await ouvrirDemande(null, V.preparation(c), { titre: c.titre, surCree: ({ dossier }) => (cree = dossier) });
  assert.equal(ouverte.ouverte, true);
  const champ = (suffixe) => dom.document.documentElement.descendants().filter((e) => e.id.endsWith(suffixe)).pop();
  assert.equal(champ("-v-drop").value, "Hotel Plage Exemple");
  assert.equal(champ("-v-lieu").value, "Villa Exemple");
  assert.equal(champ("-v-vol").value, "FD3217");
  assert.equal(champ("-v-bagages").value, "2");
  assert.equal(champ("-v-sieges").value, "1");
  assert.equal(champ("-v-sieges-bebe").value, "1");
  assert.equal(champ("-v-remarques").value, REMARQUE);
  assert.equal(champ("-heure").value, "09:15");
  const [bouton] = dom.boutons("Créer le dossier").slice(-1);
  assert.ok(bouton, "le bouton de création");
  bouton.click();
  await dom.attendre(60);
  assert.ok(cree, "dossier créé");
  comparer(reservationsDu(cree.id)[0], { ...DE_LA_CARTE, bebes: 1, partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, "Vérifier avant");
});

// ---- 6 bis. « Choisir dans la base » : une ligne du catalogue prise à la main reçoit aussi le chauffeur chez Taxi -------------------
test("6 bis. « Vérifier avant », « Choisir dans la base » chez Taxi : la course prise dans le catalogue va au chauffeur réglé", async () => {
  const t = await trajetsDe("taxi");
  const c = await carteDe("proposer_dossier", dossierCarte([service({ texte: "Private transfer", lieu_pickup: "", de: "", vers: "", prix_saisi: "" })], { hotel: "Resort Exemple" }));
  let cree = null;
  await ouvrirDemande(null, V.preparation(c), { titre: c.titre, surCree: ({ dossier }) => (cree = dossier) });
  dom.boutons("Choisir dans la base").slice(-1)[0].click();
  await dom.attendre(10);
  const ligne = dom.document.querySelectorAll("li.choix").filter((li) => li.querySelector("strong").textContent === TRAJETS.arrivee).pop();
  assert.ok(ligne, "le trajet dans la liste du catalogue");
  ligne.querySelector(".choix-actions button").click();
  dom.boutons("Terminé").slice(-1)[0].click();
  await dom.attendre(10);
  dom.boutons("Créer le dossier").slice(-1)[0].click();
  await dom.attendre(60);
  assert.ok(cree, "dossier créé");
  const [resa] = reservationsDu(cree.id);
  assert.equal(resa.prestation_id, t.arrivee.id);
  comparer(resa, { lieu_pickup: "Exemple Airport", drop_off: "Resort Exemple", partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, "choisi dans la base");
  assert.ok(chauffeur(), "la démo de Taxi a un chauffeur réglé");
});

// ---- 7. Demande du site ------------------------------------------------------------------------------------------------------
test("7. demande du site (trajet) : la fiche lit le formulaire, et la réservation créée en garde chaque champ", async () => {
  dans("taxi");
  const texte = "Transfer request: Exemple Airport to Koh Exemple\nDate: Tue 15 Dec 2026\nPickup time: 14:30\nFlight or ferry: FD3217\nGuests: 2 adults, 1 child (age 5)\nChild seats: 1\nBags: 3\nPickup: Exemple Airport (EXA)\nDrop-off: Hotel Plage Exemple\nName: Client Exemple Site";
  let cree = null;
  ouvrirDemande({ texte, titre: "Demande", telephone: "+41790002000", prixImpose: 2800, surCree: ({ dossier }) => (cree = dossier) });
  await dom.attendre(10);
  const [bouton] = dom.boutons("Créer le dossier").slice(-1);
  assert.ok(bouton, "le bouton de création");
  bouton.click();
  await dom.attendre(60);
  assert.ok(cree, "dossier créé");
  comparer(reservationsDu(cree.id)[0], { drop_off: "Hotel Plage Exemple", lieu_pickup: "Exemple Airport (EXA)", heure_pickup: "14:30", vol: "FD3217", bagages: "3", sieges: 1, adultes: 2, enfants: 1, montant_vente: 2800, partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, "site");
});

// ---- 8. Carte « course » : une confirmation collée, validée d'un geste -----------------------------------------------------------
test("8. carte « course » : ouvrirConfirmation crée la course avec chaque champ de la confirmation", async () => {
  dans("taxi");
  const texte = `VIP TAXI LANTA
Name: Zelie Testeuse
Date: 03/12/2026
Pick-up time: 09:15
Pick-up location: Villa Exemple
Drop-off location: Hotel Plage Exemple
Flight: FD3217
Passengers: 2 adults, 2 children, 2 bags, 1 child seat, 1 baby seat
Price: 3000 THB
Remarks: ${REMARQUE}`;
  const r = await ouvrirConfirmation(texte, { auto: true });
  assert.equal(r.ok, true, r.motif);
  const dossier = r.fait.dossier;
  comparer(reservationsDu(dossier.id)[0], { ...DE_LA_CARTE, enfants: 2, partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, "course");
});
