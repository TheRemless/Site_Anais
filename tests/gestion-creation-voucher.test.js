// Création d'un dossier Secret ou Taxi complète dès la création (13.11.2026) : les champs du voucher service par service,
// et la course Taxi hors catalogue, calculée comme l'écran « Nouveau voucher » de l'assistante.
import { test } from "node:test";
import assert from "node:assert/strict";
import { servicesCreation, champsCreation, nonVides, saisieDepuisDemande, saisieDuService, parServiceCreation, erreursCourse, courseHorsCatalogue } from "../src/gestion/js/creation-voucher-calc.mjs";
import { CHAMPS_VOUCHER, reservationsDepuisDocument } from "../src/gestion/js/operations-calc.mjs";
import { donneesVoucher, ligneVoucher, reservationVoucher, partenaireDeTaxi } from "../src/gestion/js/voucher-rapide-calc.mjs";

const prestations = [
  { id: "p-4iles", famille: "excursion", groupe: "4 Islands", libelle: "4 Islands speedboat", unite: "pp" },
  { id: "p-4iles-enf", famille: "excursion", groupe: "4 Islands", libelle: "4 Islands speedboat, child", unite: "pp" },
  { id: "p-transfert", famille: "transfert", groupe: "Private taxi", libelle: "Koh Lanta to Krabi Airport", unite: "veh" },
  { id: "p-scooter", famille: "location", groupe: "Scooter", libelle: "Scooter 125cc", unite: "jour" },
];
const ligne = (id, prestation_id, titre, extra = {}) => ({ id, kind: "ligne", prestation_id, partenaire_id: "pa", titre, libelle: titre, unite: 1500, qte: 2, date_service: "2026-11-20", ...extra });

test("une ligne adulte et sa ligne enfant font un seul service, avec le modèle de voucher de la prestation", () => {
  const lignes = [ligne("a", "p-4iles", "4 Islands speedboat", { par: "pp" }), ligne("b", "p-4iles-enf", "4 Islands speedboat, child", { par: "ch", qte: 1 }), ligne("c", "p-transfert", "Koh Lanta to Krabi Airport", { par: "veh", qte: 1 }), { id: "t", kind: "texte", libelle: "Park fee cash" }];
  const sv = servicesCreation(lignes, { prestations });
  assert.equal(sv.length, 2);
  assert.deepEqual(sv[0].ligneIds, ["a", "b"]);
  assert.equal(sv[0].cle, "a");
  assert.equal(sv[0].type, "bateau");
  assert.equal(sv[0].date, "2026-11-20");
  assert.equal(sv[1].type, "transfert");
  // Même regroupement que la création elle-même.
  const vraies = reservationsDepuisDocument({ dossier_id: "d", contenu: { lignes } }, { uid: () => "x" });
  assert.deepEqual(vraies.map((g) => g.reservation.ligne_id), sv.map((s) => s.cle));
});

test("champs à la création : ceux du modèle de voucher pour Secret, ceux de la Booking confirmation pour Taxi", () => {
  assert.deepEqual(champsCreation({ type: "bateau" }), ["heure", "lieu", ...CHAMPS_VOUCHER.bateau]);
  assert.deepEqual(champsCreation({ type: "transfert" }), ["heure", "lieu", "drop_off", "vol", "bagages", "type_transfert", "remarques", "remarques_paiement"]);
  assert.deepEqual(champsCreation({ type: "billet" }), ["heure", "lieu", "bebes", ...CHAMPS_VOUCHER.billet]);
  assert.deepEqual(champsCreation({ type: null }), ["heure", "lieu", "bebes"], "une option sans voucher garde heure, lieu et bébés, comme la fiche");
  // Taxi : prix par véhicule, les passagers se saisissent ; jamais de champ de Secret (type de tour, frais de parc).
  const taxi = champsCreation({ type: "transfert", personnes: { adultes: 0, enfants: 0 } }, { taxi: true });
  assert.deepEqual(taxi, ["heure", "lieu", "drop_off", "vol", "adultes", "enfants", "bagages", "sieges"]);
  assert.ok(!champsCreation({ type: "transfert", personnes: { adultes: 2, enfants: 0 } }, { taxi: true }).includes("adultes"), "déjà comptés par la ligne");
  for (const c of ["type_tour", "parc", "chambre", "remarques"]) assert.ok(!taxi.includes(c), c);
});

test("une demande collée préremplit la saisie de son service, et la saisie part sur la bonne réservation", () => {
  const s = saisieDepuisDemande({ ligneIds: ["c"], heure: "09:30", lieu: "Pimalai Resort", dropoff: "Krabi Airport", vol: "FD3217", bagages: 3, sieges: 1, bebes: 0, personnes: { adultes: 2, enfants: 1 }, zonePickup: "z1", details: { remarques: "Big bags" } });
  assert.equal(s.heure, "09:30");
  assert.deepEqual(s.details, { drop_off: "Krabi Airport", vol: "FD3217", bagages: "3", remarques: "Big bags" });
  assert.equal(s.sieges, 1);
  const lignes = [ligne("a", "p-4iles", "4 Islands speedboat", { par: "pp" }), ligne("c", "p-transfert", "Koh Lanta to Krabi Airport", { par: "veh", qte: 1 })];
  const services = servicesCreation(lignes, { prestations });
  const saisies = new Map([["c", s]]);
  // Le premier service n'a rien de la demande : une saisie vide est créée, remplie ensuite dans l'écran.
  const tour = saisieDuService(saisies, services[0]);
  tour.heure = "08:00";
  tour.details = { type_tour: "prive", remarques: "", chambre: "12" };
  assert.equal(saisieDuService(saisies, services[0]), tour, "la même saisie au redessin");
  const ps = parServiceCreation(services, saisies);
  assert.deepEqual(ps[0], { ligneIds: ["a"], heure: "08:00", lieu: "", bebes: 0, sieges: 0, personnes: null, zonePickup: null, details: { type_tour: "prive", chambre: "12" } });
  assert.equal(ps[1].lieu, "Pimalai Resort");
  assert.equal(ps[1].zonePickup, "z1");
  assert.deepEqual(ps[1].details, { drop_off: "Krabi Airport", vol: "FD3217", bagages: "3", remarques: "Big bags" });
});

test("la saisie se retrouve quand une ligne enfant passe devant la ligne adulte", () => {
  const enfant = ligne("b", "p-4iles-enf", "4 Islands speedboat, child", { par: "ch", qte: 1 });
  const adulte = ligne("a", "p-4iles", "4 Islands speedboat", { par: "pp" });
  const saisies = new Map([["a", { heure: "07:45", lieu: "", bebes: 0, sieges: 0, personnes: null, zonePickup: null, details: {} }]]);
  const [sv] = servicesCreation([enfant, adulte], { prestations });
  assert.equal(saisieDuService(saisies, sv).heure, "07:45");
  assert.equal(parServiceCreation([sv], saisies)[0].heure, "07:45");
});

test("nonVides : les champs vides ne s'écrivent pas sur la réservation", () => {
  assert.deepEqual(nonVides({ a: "", b: "  ", c: "x", d: 0, e: 2, f: null, g: undefined }), { c: "x", e: 2 });
});

test("course Taxi hors catalogue : même contrôle et même calcul que l'écran de l'assistante, le nom vient du client choisi", () => {
  const v = { date: "2026-11-14", pickup: "Pimalai Resort", heure: "14:30", dropoff: "Krabi Airport", vol: "FD 3217", adultes: "2", enfants: "1", bagages: "3", sieges: "1", prix: "2,700" };
  assert.deepEqual(erreursCourse(v), {});
  assert.ok(!("nom" in erreursCourse({ ...v, nom: "" })), "pas de nom à saisir ici");
  assert.equal(erreursCourse({ ...v, pickup: "" }).pickup, "e_vide");
  assert.equal(erreursCourse({ ...v, dropoff: "สนามบิน" }).dropoff, "e_thai");
  assert.equal(erreursCourse({ ...v, sieges: "3" }).sieges, "e_sieges");
  assert.equal(erreursCourse({ ...v, prix: "" }).prix, "e_prix");
  const { ligne: l, saisie } = courseHorsCatalogue(v, { id: "L1", partenaireId: "taxi" });
  const x = donneesVoucher({ ...v, nom: "-" });
  assert.deepEqual(l, ligneVoucher(x, { id: "L1", partenaireId: "taxi" }), "la ligne de l'écran de l'assistante");
  assert.equal(l.libelle, "Pimalai Resort → Krabi Airport");
  assert.equal(l.unite, 2700);
  assert.equal(l.paye_sur_place, true);
  const r = reservationVoucher(x);
  assert.equal(saisie.heure, r.heure);
  assert.equal(saisie.lieu, "Pimalai Resort");
  assert.equal(saisie.sieges, 1);
  assert.deepEqual(saisie.personnes, { adultes: 2, enfants: 1 });
  assert.deepEqual(saisie.details, { drop_off: "Krabi Airport", vol: "FD 3217", bagages: "3" });
  // La course devient bien un service avec sa Booking confirmation, passagers à saisir (prix par véhicule).
  const [sv] = servicesCreation([l], {});
  assert.deepEqual(sv.ligneIds, ["L1"]);
  assert.ok(champsCreation(sv, { taxi: true }).includes("adultes"));
  const [ps] = parServiceCreation([sv], new Map([["L1", saisie]]));
  assert.deepEqual(ps, { ligneIds: ["L1"], heure: "14:30", lieu: "Pimalai Resort", bebes: 0, sieges: 1, personnes: { adultes: 2, enfants: 1 }, zonePickup: null, details: { drop_off: "Krabi Airport", vol: "FD 3217", bagages: "3" } });
});

test("partenaire d'une course : celui qui dit taxi, sinon le premier actif", () => {
  assert.equal(partenaireDeTaxi([{ id: "a", nom: "Chauffeurs" }, { id: "b", nom: "VIP Taxi Lanta" }]).id, "b");
  assert.equal(partenaireDeTaxi([{ id: "a", nom: "Vieux", actif: false }, { id: "c", nom: "Chauffeurs démo" }]).id, "c");
  assert.equal(partenaireDeTaxi([]), null);
});
