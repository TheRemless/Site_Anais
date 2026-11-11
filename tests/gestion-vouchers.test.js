import { test } from "node:test";
import assert from "node:assert/strict";
import { nbJoursLocation, categorieVehicule, moteurTexte, estLigneJours, compteDe, descriptionService, attenduDepuisFacture, reservationsDepuisDocument, ecartReservation, variablesMessage, CHAMPS_VOUCHER } from "../src/gestion/js/operations-calc.mjs";
import { libelleClient, modeEn, ligneDepuisPrestation, lignesDepuisTrajet } from "../src/gestion/js/partenaires-calc.mjs";

test("location : jours entre la prise et le retour, au moins un, rien quand une date manque ou que le retour précède la prise", () => {
  assert.equal(nbJoursLocation("2026-12-10", "2026-12-13"), 3);
  assert.equal(nbJoursLocation("2026-12-10", "2026-12-10"), 1);
  assert.equal(nbJoursLocation("2026-12-30", "2027-01-02"), 3, "à cheval sur deux années");
  assert.equal(nbJoursLocation("2026-12-10", ""), null);
  assert.equal(nbJoursLocation(null, "2026-12-13"), null);
  assert.equal(nbJoursLocation("2026-12-13", "2026-12-10"), null);
});

test("location : catégorie et cylindrée viennent de la prestation de la base, rien n'est inventé", () => {
  assert.equal(categorieVehicule({ groupe: "Scooters", libelle: "Honda Click 125" }), "Scooter");
  assert.equal(categorieVehicule({ groupe: "Grosses motos", libelle: "Kawasaki KLX 150" }), "Motorbike");
  assert.equal(categorieVehicule({ groupe: "Voitures et SUV", libelle: "Suzuki Swift" }), "Car / SUV");
  assert.equal(categorieVehicule({ groupe: "Locations", libelle: "Location d'une GoPro Hero" }), "", "une GoPro n'est pas un véhicule");
  assert.equal(categorieVehicule(null), "");
  assert.equal(moteurTexte({ details: { moteur: "125 cc" } }), "125 cc");
  assert.equal(moteurTexte({ details: { moteur: "1200 cc auto" } }), "1200 cc, automatic");
  assert.equal(moteurTexte({ details: {} }), "");
  assert.equal(moteurTexte(null), "");
});

const ligneJours = (extra = {}) => ({ id: "l1", kind: "ligne", libelle: "Honda Click 125", intro: "(par jour)", unite: 250, qte: 3, prestation_id: "p1", partenaire_id: "noom", date_service: "2026-12-10", ...extra });

test("location facturée par jour : la quantité est un nombre de jours, aucune personne inventée", () => {
  assert.equal(estLigneJours(ligneJours()), true);
  assert.equal(estLigneJours(ligneJours({ intro: "(per day)" })), true);
  assert.equal(estLigneJours(ligneJours({ intro: "(par personne)" })), false);
  const [x] = reservationsDepuisDocument({ dossier_id: "d1", contenu: { lignes: [ligneJours()] } }, { uid: () => "r1" });
  assert.equal(x.reservation.personnes.adultes, 0, "3 jours ne font ni 3 adultes ni 1 adulte inventé");
  assert.equal(x.reservation.personnes.enfants, 0);
  assert.equal(x.reservation.details.jours, 3);
  assert.equal(x.reservation.montant_vente, 750);
});

test("unités de quantité : seules les unités de personnes alimentent le nombre de personnes", () => {
  const l = (intro, extra = {}) => ({ id: "x", kind: "ligne", libelle: "Service", intro, unite: 1000, qte: 4, prestation_id: "p", ...extra });
  for (const intro of ["(par personne)", "(per person)", "(par adulte)", "(per adult)", "(par enfant)", "(per child)", "(par personne supplémentaire)", "(per extra person)", ""]) assert.equal(compteDe(l(intro)), "personnes", intro || "sans unité");
  for (const intro of ["(par véhicule)", "(per vehicle)", "(par bateau)", "(per boat)", "(par groupe)", "(per group)", "(par session)", "(per session)", "(par kart)", "(per kart)"]) assert.equal(compteDe(l(intro)), "aucun", intro);
  assert.equal(compteDe(l("(par jour)")), "jours");
  assert.equal(compteDe(l("", { par: "veh" })), "aucun");
  assert.equal(compteDe(l("", { par: "pp" })), "personnes");
  for (const intro of ["(par véhicule)", "(par bateau)", "(par groupe)", "(par kart)"]) {
    const [x] = reservationsDepuisDocument({ dossier_id: "d1", contenu: { lignes: [l(intro, { qte: 2 })] } }, { uid: () => "r" });
    assert.deepEqual(x.reservation.personnes, { adultes: 0, enfants: 0, bebes: 0 }, `${intro} : 2 véhicules ne sont pas 2 personnes`);
  }
  const [mixte] = reservationsDepuisDocument({ dossier_id: "d1", contenu: { lignes: [l("(par personne)", { qte: 2 }), l("(par enfant)", { qte: 1, libelle: "Service, child" })] } }, { uid: () => "r" });
  assert.deepEqual(mixte.reservation.personnes, { adultes: 2, enfants: 1, bebes: 0 });
});

test("description d'une ligne de service : « 4 passengers » seulement pour des personnes, « 4 days » pour une location", () => {
  const base = { libelle: "Honda Click 125", date_service: "2026-12-10", unite: 250, qte: 4 };
  assert.equal(descriptionService({ ...base, intro: "(per day)" }, "en"), "Honda Click 125, 4 days, 10 December 2026");
  assert.equal(descriptionService({ ...base, intro: "(par jour)" }, "fr"), "Honda Click 125, 4 jours, 10 décembre 2026");
  assert.equal(descriptionService({ ...base, intro: "(per person)" }, "en"), "Honda Click 125, 4 passengers, 10 December 2026");
  assert.equal(descriptionService({ ...base, intro: "(per child)" }, "en"), "Honda Click 125, 4 children, 10 December 2026");
  assert.equal(descriptionService({ ...base, intro: "(per vehicle)", qte: 2 }, "en"), "Honda Click 125, 10 December 2026", "deux véhicules ne sont pas deux passagers");
  assert.equal(descriptionService({ ...base, intro: "(per boat)", qte: 1 }, "en"), "Honda Click 125, 10 December 2026");
});

test("réservations déjà créées avec une quantité prise pour des personnes : proposées à la correction, sans toucher ce qui est saisi à la main", () => {
  const doc = { contenu: { lignes: [ligneJours()] } };
  const ancienne = { ligne_id: "l1", date_service: "2026-12-10", personnes: { adultes: 3, enfants: 0 }, montant_vente: 750, paye_sur_place: false, details: {} };
  const e = ecartReservation(ancienne, doc);
  assert.deepEqual(e.champs.map((c) => c.cle), ["personnes"]);
  assert.deepEqual(e.attendu.personnes, { adultes: 0, enfants: 0 }, "l'alignement remet zéro personne, pas un nombre inventé");
  assert.equal(e.attendu.jours, 3, "et garde la durée");
  // Un nombre saisi à la main (2 personnes pour 3 jours) n'est pas la quantité facturée : on n'y touche pas.
  assert.equal(ecartReservation({ ...ancienne, personnes: { adultes: 2, enfants: 0 } }, doc), null);
  // Une réservation déjà corrigée n'est plus signalée.
  assert.equal(ecartReservation({ ...ancienne, personnes: { adultes: 0, enfants: 0 }, details: { jours: 3 } }, doc), null);
  const autreMontant = ecartReservation({ ...ancienne, personnes: { adultes: 0, enfants: 0 }, montant_vente: 700 }, doc);
  assert.deepEqual(autreMontant.champs.map((c) => c.cle), ["montant_vente"], "le reste est toujours comparé");
  // Un véhicule loué à la pièce (par véhicule) : même défaut, même correction.
  const vehicule = { contenu: { lignes: [ligneJours({ intro: "(par véhicule)", qte: 2 })] } };
  assert.deepEqual(ecartReservation({ ligne_id: "l1", date_service: "2026-12-10", personnes: { adultes: 2, enfants: 0 }, montant_vente: 500, details: {} }, vehicule).champs.map((c) => c.cle), ["personnes"]);
  assert.equal(attenduDepuisFacture({ ligne_id: "l1", details: {} }, vehicule).jours, null);
});

test("les champs de la location couvrent la prise, le retour, le conducteur et le loueur", () => {
  const champs = CHAMPS_VOUCHER.location;
  for (const c of ["retour_date", "retour_heure", "retour_lieu", "permis", "equipement", "caution", "conditions", "remarques_paiement"]) assert.ok(champs.includes(c), c);
  assert.ok(champs.indexOf("retour_lieu") > champs.indexOf("retour_heure"), "le lieu suit la date et l'heure de retour");
});

// Libellés tels qu'ils sont en base : ils s'impriment sur des vouchers toujours en anglais.
const FRANCAIS = /[àâäçéèêëîïôöùûüœ]|\b(avec|départ|pour|jour|jours|personne|adulte|enfant|bateau|journée|privé|partagé|gare|routière|aéroport|ville|dès|plongées?|pêche|ou|vers|sans)\b/i;
test("vouchers : aucun mot français ne reste dans les libellés de trajets et de prestations de la base", () => {
  const modes = ["Minivan partagé, dépose à l'hôtel comprise", "Minivan partagé", "Minivan + speedboat (départ de Nopparat Thara à 11h20 et 16h00)", "Minivan + minibus ou bus (départ de la gare routière de Krabi à 10h00)", "Minivan + minivan (départ d'Ao Nang à 10h30)", "Minivan + bus (le bus de 36 places part de la gare routière de Krabi à 17h00)", "Minivan + minivan ou minibus (départ de Krabi Town à 11h30 et 14h30), à partir de 2 personnes, par personne", "Van partagé + speedboat + Ferry"];
  const lieux = ["Hatyai (aéroport)", "Hatyai (ville et aéroport)", "Koh Samui par ferry Seatran (Nathon Pier)", "Koh Tao par Lomprayah (Mae Haad Pier)", "Surat Thani (ville, aéroport, gare)", "Aéroport de Krabi"];
  const prestations = ["Scuba Explorer (dès 8 ans, 2 plongées)", "Koh Haa, 2 plongées (gros bateau)", "Plongée supplémentaire", "Refresher, ajouté à un trip local", "Snorkeling sur le bateau de plongée (dès 12 ans)", "Snorkeling sur le bateau de plongée, Enfant de moins de 5 ans", "Open Water Diver (18 m, 3 jours, 4 plongées)", "Spécialité Nitrox (théorie seulement)", "Program 7 : Mangrove tour (kayak ou longtail) + fishing park", "One Day Trip Koh Maa, pêche et snorkeling, 6 personnes maximum", "Nanny à bord pour vos enfants", "Location d'un ordinateur de plongée", "Northern trip, 3 plongées (retour 16h30)", "Program B : Private Fishing & Seafood, Personne supplémentaire, en plus des 2 premières personnes"];
  const restes = [...modes.map(modeEn), ...lieux.map(libelleClient), ...prestations.map(libelleClient)].filter((t) => FRANCAIS.test(t));
  assert.deepEqual(restes, []);
  assert.equal(modeEn("Minivan partagé, dépose à l'hôtel comprise"), "Shared minivan, hotel drop-off included");
  assert.equal(libelleClient("Koh Haa, 2 plongées (gros bateau)"), "Koh Haa, 2 dives (big boat)");
  assert.equal(modeEn("Minivan + bus (le bus de 36 places part de la gare routière de Krabi à 17h00)"), "Minivan + bus (the 36-seat bus leaves Krabi bus station at 17h00)");
});

test("libellés d'un document ou d'un message en anglais : libelle_en d'abord, jamais de français ni de parenthèses de description fusionnées", () => {
  const x = { id: "p1", libelle: "Yaris (neuve), location", libelle_en: "Toyota Yaris", prix_vente: 1500, unite: "day", partenaire_id: "noom", details: {} };
  assert.equal(ligneDepuisPrestation(x, null, { langue: "en", uid: () => "l" }).libelle, "Toyota Yaris", "libelle_en prime");
  assert.equal(ligneDepuisPrestation({ ...x, libelle_en: "" }, null, { langue: "en", uid: () => "l" }).libelle, libelleClient("Yaris (neuve), location"), "sans libelle_en, la traduction du libellé");
  assert.equal(ligneDepuisPrestation(x, null, { langue: "", uid: () => "l" }).libelle, "Yaris (neuve), location", "document français : le libellé de la base");
  const t = { id: "t1", mode: "Minivan partagé, dépose à l'hôtel comprise", de: "Koh Lanta", vers: "Hatyai (aéroport)", depart: "08:00", prix_adulte: 700 };
  const [l] = lignesDepuisTrajet(t, null, { langue: "en", adultes: 2, uid: () => "l" });
  assert.equal(l.libelle, "Shared minivan, hotel drop-off included transfer: Koh Lanta → Hatyai (airport), departure 08:00");
  const v = variablesMessage({ reservation: { libelle: "4 îles", date_service: "2026-12-10" }, langue: "en" });
  assert.equal(v.prestation, "4 Islands", "message en anglais : le nom du service est traduit");
  assert.equal(variablesMessage({ reservation: { libelle: "4 îles", date_service: "2026-12-10" }, langue: "fr" }).prestation, "4 îles", "message en français : inchangé");
});
