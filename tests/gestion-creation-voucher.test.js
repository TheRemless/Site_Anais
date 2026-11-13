// Création d'un dossier Secret ou Taxi complète dès la création (13.11.2026) : les champs du voucher service par service,
// et la course Taxi hors catalogue, calculée comme l'écran « Nouveau voucher » de l'assistante.
import { test } from "node:test";
import assert from "node:assert/strict";
import { servicesCreation, boutsDuTrajet, saisieVide, champsCreation, nonVides, saisieDepuisDemande, saisieDuService, parServiceCreation, erreursCourse, courseHorsCatalogue, resumeSaisie, blocOuvert, libelleCourseSuivi } from "../src/gestion/js/creation-voucher-calc.mjs";
import { CHAMPS_VOUCHER, reservationsDepuisDocument, siegesVoucher } from "../src/gestion/js/operations-calc.mjs";
import { donneesVoucher, ligneVoucher, reservationVoucher, reservationApercu, partenaireDeTaxi, erreursVoucher, telephoneValide, clientsRecents, valeursDepuis } from "../src/gestion/js/voucher-rapide-calc.mjs";

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
  assert.deepEqual(champsCreation({ type: "transfert" }), ["heure", "lieu", "drop_off", "vol", "bagages", "sieges", "type_transfert", "remarques", "remarques_paiement"]);
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
  assert.deepEqual(ps, { ligneIds: ["L1"], heure: "14:30", lieu: "Pimalai Resort", bebes: 0, sieges: 1, personnes: { adultes: 2, enfants: 1 }, zonePickup: null, statut: "confirme", details: { drop_off: "Krabi Airport", vol: "FD 3217", bagages: "3" } });
});

test("partenaire d'une course : celui qui dit taxi, sinon le premier actif", () => {
  assert.equal(partenaireDeTaxi([{ id: "a", nom: "Chauffeurs" }, { id: "b", nom: "VIP Taxi Lanta" }]).id, "b");
  assert.equal(partenaireDeTaxi([{ id: "a", nom: "Vieux", actif: false }, { id: "c", nom: "Chauffeurs démo" }]).id, "c");
  assert.equal(partenaireDeTaxi([]), null);
});

test("course hors catalogue : le libellé suit le pickup et le drop-off saisis, garde l'ancien si l'un est vide", () => {
  const { ligne: l } = courseHorsCatalogue({ date: "2026-11-14", pickup: "Pimalai Resort", heure: "14:30", dropoff: "Krabi Airport", adultes: "2", prix: "2700" }, { id: "L1" });
  assert.equal(libelleCourseSuivi(l, { lieu: "Pimalai Resort", details: { drop_off: "Krabi Airport" } }), null, "rien ne change");
  assert.equal(libelleCourseSuivi(l, { lieu: "Lanta Sand Resort ", details: { drop_off: "Krabi Airport" } }), "Lanta Sand Resort → Krabi Airport");
  assert.equal(libelleCourseSuivi(l, { lieu: "", details: { drop_off: "Krabi Airport" } }), null);
  assert.equal(libelleCourseSuivi(l, { lieu: "Pimalai Resort", details: {} }), null);
});

test("blocs repliés sur téléphone : seul le dernier ajouté est ouvert à partir de deux services, résumé de ce qui est rempli", () => {
  const sv = { ligneIds: ["a", "b"] };
  assert.equal(blocOuvert({ telephone: false, nbServices: 3, service: sv, dernier: "z" }), true, "bureau : toujours ouvert");
  assert.equal(blocOuvert({ telephone: true, nbServices: 1, service: sv, dernier: "z" }), true);
  assert.equal(blocOuvert({ telephone: true, nbServices: 2, service: sv, dernier: "z" }), false);
  assert.equal(blocOuvert({ telephone: true, nbServices: 2, service: sv, dernier: "b" }), true);
  assert.equal(resumeSaisie({ heure: "08:30", lieu: "Lanta Sand Resort", details: {} }), "08:30 · Lanta Sand Resort");
  assert.equal(resumeSaisie({ heure: "", lieu: " ", details: { drop_off: "Krabi Airport" } }), "Krabi Airport");
  assert.equal(resumeSaisie({}), "");
});

test("course hors catalogue : les bagages s'écrivent en texte, comme sur l'écran de l'assistante", () => {
  const v = { date: "2026-11-14", pickup: "Pimalai Resort", heure: "14:30", dropoff: "Krabi Airport", adultes: "2", prix: "2700", bagages: "2 suitcases, 1 golf bag" };
  assert.deepEqual(erreursCourse(v), {});
  assert.equal(courseHorsCatalogue(v, { id: "L1" }).saisie.details.bagages, "2 suitcases, 1 golf bag");
});

test("Secret : les sièges enfant du transfert sur le voucher, à côté des enfants, rien quand il n'y en a pas", () => {
  assert.ok(CHAMPS_VOUCHER.transfert.includes("sieges"));
  assert.ok(!CHAMPS_VOUCHER.bateau.includes("sieges"));
  assert.equal(siegesVoucher(1), " (1 child seat)");
  assert.equal(siegesVoucher("2"), " (2 child seats)");
  assert.equal(siegesVoucher(0), "");
  assert.equal(siegesVoucher(undefined), "");
});

test("écran de l'assistante : WhatsApp facultatif, et le client du même nom vu ces 30 derniers jours proposé", () => {
  assert.equal(telephoneValide(""), true);
  assert.equal(telephoneValide("+66 81 234 5678"), true);
  assert.equal(telephoneValide("0812345678"), true);
  assert.equal(telephoneValide("12345"), false);
  assert.equal(telephoneValide("Emma"), false);
  const bon = { nom: "Emma Wilson", date: "2026-11-14", pickup: "Pimalai Resort", heure: "14:30", dropoff: "Krabi Airport", adultes: "2", prix: "2700" };
  assert.equal(erreursVoucher({ ...bon, telephone: "abc" }).telephone, "e_tel");
  const x = donneesVoucher({ ...bon, telephone: " +44 7700  900123 ", client_id: "c1" });
  assert.equal(x.telephone, "+44 7700 900123");
  assert.equal(x.clientId, "c1");
  const clients = [{ id: "c1", prenom: "", nom: "Emma Wilson", telephone: "+447700900123" }, { id: "c2", prenom: "Emma", nom: "Wilson" }, { id: "c3", prenom: "", nom: "émma  wilson" }, { id: "c4", prenom: "", nom: "John Doe" }];
  const dossiers = [{ id: "d1", client_id: "c1", created_at: "2026-11-10T08:00:00Z" }, { id: "d2", client_id: "c2", created_at: "2026-09-01T08:00:00Z" }, { id: "d3", client_id: "c3", created_at: "2026-11-12T08:00:00Z" }, { id: "d4", client_id: "c4", created_at: "2026-11-12T08:00:00Z" }];
  const reservations = [{ dossier_id: "d1", date_service: "2026-11-20" }];
  const r = clientsRecents({ nom: "Emma  Wilson", clients, dossiers, reservations, aujourdhui: "2026-11-13" });
  assert.deepEqual(r.map((c) => c.id), ["c1", "c3"], "c2 vu il y a plus de 30 jours, c4 d'un autre nom ; course à venir d'abord");
  assert.deepEqual(clientsRecents({ nom: "E", clients, dossiers, reservations, aujourdhui: "2026-11-13" }), []);
  // Corriger un voucher garde le client et son WhatsApp.
  const v = valeursDepuis({ date_service: "2026-11-14", personnes: {} }, clients[0]);
  assert.equal(v.client_id, "c1");
  assert.equal(v.telephone, "+447700900123");
});

test("courses de l'assistante et courses hors catalogue : confirmées dès la création ; un trajet du catalogue garde le statut normal", () => {
  const v = { nom: "Emma", date: "2026-11-14", pickup: "Pimalai Resort", heure: "14:30", dropoff: "Krabi Airport", adultes: "2", prix: "2700" };
  const x = donneesVoucher(v);
  assert.equal(reservationVoucher(x).statut, "confirme");
  assert.equal(reservationApercu(x).statut, "confirme", "la reprise après un échec pose aussi « confirme »");
  assert.equal(courseHorsCatalogue(v, { id: "L1" }).saisie.statut, "confirme");
  const catalogue = ligne("c", "p-transfert", "Koh Lanta to Krabi Airport", { par: "veh", qte: 1 });
  const [sv] = servicesCreation([catalogue], { prestations });
  assert.ok(!("statut" in parServiceCreation([sv], new Map())[0]));
});

test("Taxi : le pickup et le drop-off se préremplissent avec les deux bouts du trajet, sans écraser une saisie", () => {
  const taxi = [{ id: "t1", famille: "transfert", groupe: "Private minivan", libelle: "Krabi Airport → Koh Lanta", unite: "veh" }];
  const [sv] = servicesCreation([ligne("a", "t1", "Krabi Airport → Koh Lanta, private minivan", { par: "veh", qte: 1 })], { prestations: taxi });
  assert.equal(sv.pickup, "Krabi Airport");
  assert.equal(sv.dropoff, "Koh Lanta");
  const s = boutsDuTrajet(saisieVide(), sv);
  assert.equal(s.lieu, "Krabi Airport");
  assert.equal(s.details.drop_off, "Koh Lanta");
  // Anaïs précise : sa saisie reste au prochain redessin.
  s.lieu = "Krabi Airport, arrivals gate 3";
  boutsDuTrajet(s, sv);
  assert.equal(s.lieu, "Krabi Airport, arrivals gate 3");
  // Autre trajet choisi : les bouts encore automatiques suivent, pas ce qui a été tapé.
  boutsDuTrajet(s, { pickup: "Koh Lanta", dropoff: "Phuket Airport" });
  assert.equal(s.lieu, "Krabi Airport, arrivals gate 3");
  assert.equal(s.details.drop_off, "Phuket Airport");
  // La demande donne le lieu : seul le drop-off se préremplit.
  const d = boutsDuTrajet({ ...saisieVide(), lieu: "" }, sv, { lieu: false });
  assert.equal(d.lieu, "");
  assert.equal(d.details.drop_off, "Koh Lanta");
  // Sans « → » ni trajet, rien à deviner.
  const [libre] = servicesCreation([ligne("b", null, "Airport transfer", { libre: true, par: "veh", qte: 1 })], {});
  assert.equal(libre.pickup, "");
  assert.deepEqual(boutsDuTrajet(saisieVide(), libre).details, {});
});
