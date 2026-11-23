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

// ---- Le pickup : celui de la carte, l'hôtel du client, le bout du catalogue (Taxi), puis le départ lu --------------------------------
test("pickup d'une carte « dossier » : carte, puis hôtel du client, puis bout du catalogue chez Taxi, puis le départ lu", async () => {
  const { transfert } = await catalogueDe("taxi");
  dans("taxi");
  const cas = [
    ["la carte", { lieu_pickup: "Villa Exemple" }, { hotel: "Resort Exemple" }, "Villa Exemple"],
    ["l'hôtel du client", { lieu_pickup: "" }, { hotel: "Resort Exemple" }, "Resort Exemple"],
    ["le bout du catalogue", { lieu_pickup: "" }, { hotel: "" }, "Embarcadere Exemple"],
  ];
  for (const [quoi, s, dossier, attendu] of cas) {
    const c = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", transfert.id), ...s })], dossier));
    const r = await validerDossier(c);
    assert.equal(r.ok, true, `${quoi} : ${r.motif}`);
    assert.equal(reservationsDu(r.dossier.id)[0].lieu_pickup, attendu, quoi);
  }
  // Secret : pas de bout de trajet dans la fiche ; sans pickup ni hôtel, le départ lu sert en dernier recours.
  const { tour } = await catalogueDe("excursions");
  dans("excursions");
  const c = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", tour.id), lieu_pickup: "", prix_saisi: "" })]));
  const r = await validerDossier(c);
  assert.equal(r.ok, true, r.motif);
  assert.equal(reservationsDu(r.dossier.id)[0].lieu_pickup, "Koh Exemple", "le départ, faute de mieux");
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
  // Sans lieu de pickup : le lieu du dossier (l'hôtel du client), avant le bout du catalogue et le départ lu.
  const c2 = await carteDe("proposer_reservation", { titre: "Ajout", dossier: refDe("D", dossier.id), service: service({ ref: refDe("P", transfert.id), lieu_pickup: "", enfants: 2 }) });
  const r2 = await V.enregistrerReservation(reservationDepuisCarte(c2.donnees, V.optionsCarte(c2)), "Service ajouté au dossier.");
  assert.equal(ecrite(r2.reservation.id).lieu_pickup, "Villa Exemple", "le dernier lieu des services du dossier (lieuParDefaut)");
  const vide = await E.inserer("dossiers", { ref: "T-RES2", client_id: null, pays: "", bandeau: "", accepte_le: "2026-11-23", annule: false, notes: "" });
  const c3 = await carteDe("proposer_reservation", { titre: "Ajout", dossier: refDe("D", vide.id), service: service({ ref: refDe("P", transfert.id), lieu_pickup: "" }) });
  assert.equal(reservationDepuisCarte(c3.donnees, V.optionsCarte(c3)).lieu_pickup, "Embarcadere Exemple", "sans lieu au dossier : le bout du catalogue");
  dans("excursions");
  const vS = await E.inserer("dossiers", { ref: "S-RES", client_id: null, pays: "", bandeau: "", accepte_le: "2026-11-23", annule: false, notes: "" });
  const c4 = await carteDe("proposer_reservation", { titre: "Ajout", dossier: refDe("D", vS.id), service: service({ lieu_pickup: "", texte: "Tour", ref: refDe("P", (await catalogueDe("excursions")).tour.id) }) });
  dans("excursions");
  assert.equal(reservationDepuisCarte(c4.donnees, V.optionsCarte(c4)).lieu_pickup, "Koh Exemple", "rien d'autre : le départ lu");
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
Name: Client Exemple Course
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
