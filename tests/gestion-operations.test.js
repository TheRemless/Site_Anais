import { test } from "node:test";
import assert from "node:assert/strict";
import { reservationsDepuisDocument, personnesTexte, remplirGabarit, variablesMessage, agenda, duParPartenaire, dateTexte, nomMoisCourt, typeVoucher, numeroVoucher, statutPaiementVoucher, estPrive, fraisDeParc, typeTransfert, hotelEtChambre, descriptionService } from "../src/gestion/js/operations-calc.mjs";

test("vouchers : modèle d'après la prestation, numéro, statut de paiement", () => {
  assert.equal(typeVoucher({ trajet_id: "t" }, null), "transfert");
  assert.equal(typeVoucher({}, { famille: "excursion", groupe: "Excursions en groupe" }), "bateau");
  assert.equal(typeVoucher({}, { famille: "activite" }), "activite");
  assert.equal(typeVoucher({}, { famille: "transfert" }), "transfert");
  assert.equal(typeVoucher({}, { famille: "frais" }), null);
  assert.equal(typeVoucher({ libelle: "Koh Lanta → Krabi" }, null), "transfert");
  assert.equal(numeroVoucher("INV-2026-001", 2), "INV-2026-001-2");
  assert.equal(statutPaiementVoucher({ total: 2400, recu: 2400 }), "paye");
  assert.equal(statutPaiementVoucher({ total: 2400, recu: 1000 }), "acompte");
  assert.equal(statutPaiementVoucher({ total: 2400, recu: 0 }), "sur_place");
});

test("vouchers : privé ou join, frais de parc, type de transfert, hôtel et chambre", () => {
  assert.equal(estPrive({ groupe: "Privatisation", libelle: "Koh Rok" }, {}), true);
  assert.equal(estPrive({ groupe: "Excursions en groupe", libelle: "4 îles" }, {}), false);
  assert.deepEqual(fraisDeParc({ details: { parc: "Frais de parc 200 ฿ par adulte, à payer sur place." } }), { inclus: false, texte: "Frais de parc 200 ฿ par adulte, à payer sur place." });
  assert.equal(fraisDeParc({ details: { parc: "Park fees included" } }).inclus, true);
  assert.equal(fraisDeParc(null).inclus, null);
  assert.equal(typeTransfert({ groupe: "Navette partagée Hatyai" }, {}), "partage");
  assert.equal(typeTransfert({ groupe: "Taxis de Saladan" }, {}), "taxi");
  assert.equal(typeTransfert({ groupe: "Minivan privé" }, {}), "minivan");
  assert.deepEqual(hotelEtChambre({ adresse: "Hotel Sunset, Room 12\nKoh Lanta" }, {}), { hotel: "Hotel Sunset", chambre: "12" });
  assert.deepEqual(hotelEtChambre({ adresse: "Hotel Palm" }, { lieu_pickup: "Aéroport de Krabi" }), { hotel: "Aéroport de Krabi", chambre: "" });
});

test("description d'une ligne de facture en mode excursions", () => {
  assert.equal(descriptionService({ libelle: "Speedboat transfer: Koh Lanta → Koh Lipe", qte: 2, date_service: "2026-11-15" }, "en"), "Speedboat transfer: Koh Lanta → Koh Lipe, 2 passengers, 15 November 2026");
  assert.equal(descriptionService({ libelle: "4 îles", intro: "(par enfant)", qte: 1, date_service: "2026-12-10" }, "fr"), "4 îles, 1 enfant, 10 décembre 2026");
  assert.equal(descriptionService({ libelle: "Note", qte: null }), "Note");
});
import { MESSAGES_DEFAUT } from "../src/gestion/js/defauts.mjs";

test("réservations depuis un document : une par ligne de partenaire, ligne enfant distinguée, net à part", () => {
  const doc = {
    dossier_id: "D1",
    contenu: {
      lignes: [
        { id: "l1", kind: "ligne", libelle: "4 îles", intro: "(par personne)", unite: 1200, qte: 2, net: 800, prestation_id: "x1", partenaire_id: "p1", date_service: "2026-12-10" },
        { id: "l2", kind: "ligne", libelle: "Speedboat, enfant", intro: "(par enfant)", unite: 1500, qte: 1, net: 1200, trajet_id: "t1", partenaire_id: "p2" },
        { id: "l3", kind: "texte", libelle: "À régler sur place", prestation_id: "f1" },
        { id: "l4", kind: "ligne", libelle: "Saisie à la main", montant: 500 },
        { id: "l5", kind: "ligne", libelle: "Déjà réservée", unite: 100, qte: 1, prestation_id: "x2" },
      ],
    },
  };
  let n = 0;
  const r = reservationsDepuisDocument(doc, { existantes: [{ ligne_id: "l5" }], uid: () => `R${++n}` });
  assert.equal(r.length, 2);
  assert.deepEqual(r[0].reservation, { id: "R1", dossier_id: "D1", ligne_id: "l1", prestation_id: "x1", trajet_id: null, partenaire_id: "p1", libelle: "4 îles", date_service: "2026-12-10", heure_pickup: "", lieu_pickup: "", personnes: { adultes: 2, enfants: 0, bebes: 0 }, statut: "a_demander", reference_partenaire: "", montant_vente: 2400, notes: "", details: {} });
  assert.equal(r[0].net, 1600);
  assert.deepEqual(r[1].reservation.personnes, { adultes: 0, enfants: 1, bebes: 0 });
  assert.equal(r[1].reservation.trajet_id, "t1");
  assert.equal(r[1].net, 1200);
});

test("personnes en texte dans les trois langues", () => {
  assert.equal(personnesTexte({ adultes: 2, enfants: 1 }), "2 adultes, 1 enfant");
  assert.equal(personnesTexte({ adultes: 1, enfants: 2, bebes: 1 }, "en"), "1 adult, 2 children, 1 baby");
  assert.equal(personnesTexte({ adultes: 2 }, "th"), "ผู้ใหญ่ 2 คน");
  assert.equal(personnesTexte({}), "");
});

test("gabarits : variables remplies, inconnues gardées, vides effacées", () => {
  assert.equal(remplirGabarit("Bonjour {prenom}, pickup {hotel}{a_heure}. {inconnue}", { prenom: "Ben", hotel: "Hotel Sunset", a_heure: " à 08:00" }), "Bonjour Ben, pickup Hotel Sunset à 08:00. {inconnue}");
  assert.equal(remplirGabarit("Pickup : {hotel}{a_heure} \n", { hotel: "", a_heure: "" }), "Pickup :");
});

test("variables d'un message depuis une réservation", () => {
  const v = variablesMessage({ reservation: { libelle: "4 îles", date_service: "2026-12-10", heure_pickup: "08:00", lieu_pickup: "Hotel Sunset", personnes: { adultes: 2 }, reference_partenaire: "LT-1" }, client: { prenom: "Ben", nom: "Walker" }, dossier: { ref: "EX-1" }, partenaire: { nom: "Longtail" }, entreprise: { nom: "Secret", telephone: "+66" }, langue: "en" });
  assert.deepEqual(v, { client: "Ben Walker", prenom: "Ben", date: "10 December 2026", hotel: "Hotel Sunset", heure: "08:00", a_heure: " at 08:00", personnes: "2 adults", prestation: "4 îles", partenaire: "Longtail", reference: "LT-1", entreprise: "Secret", telephone: "+66" });
  const fr = variablesMessage({ reservation: {}, client: { prenom: "Ben", nom: "Walker", adresse: "Hotel Palm\nKoh Lanta" }, dossier: { ref: "EX-2", date_depart: "2027-01-05" } });
  assert.equal(fr.date, "5 janvier 2027");
  assert.equal(fr.hotel, "Hotel Palm");
  assert.equal(fr.reference, "EX-2");
  assert.equal(fr.a_heure, "");
  for (const m of MESSAGES_DEFAUT) for (const k of m.corps.match(/\{(\w+)\}/g) || []) assert.ok(k.slice(1, -1) in v, `${m.id} utilise une variable connue : ${k}`);
});

test("agenda : aujourd'hui, demain, à confirmer et en retard, annulées exclues", () => {
  const R = [
    { id: 1, libelle: "a", date_service: "2026-10-29", heure_pickup: "09:00", statut: "confirme" },
    { id: 2, libelle: "b", date_service: "2026-10-29", heure_pickup: "08:00", statut: "a_demander" },
    { id: 3, libelle: "c", date_service: "2026-10-30", statut: "demande" },
    { id: 4, libelle: "d", date_service: "2026-10-20", statut: "a_demander" },
    { id: 5, libelle: "e", date_service: "2026-10-29", statut: "annule" },
    { id: 6, libelle: "f", date_service: null, statut: "a_demander" },
  ];
  const ag = agenda(R, "2026-10-29");
  assert.deepEqual(ag.aujourdhui.map((r) => r.id), [2, 1]);
  assert.deepEqual(ag.demain.map((r) => r.id), [3]);
  assert.deepEqual(ag.aConfirmer.map((r) => r.id), [6, 2, 3]);
  assert.deepEqual(ag.enRetard.map((r) => r.id), [4]);
});

test("dû aux partenaires par mois : net prévu, payé, reste, marge, lignes sans net", () => {
  const R = [
    { id: 1, partenaire_id: "p1", date_service: "2026-12-10", statut: "confirme", montant_vente: 2400 },
    { id: 2, partenaire_id: "p1", date_service: "2026-12-20", statut: "confirme", montant_vente: 1200 },
    { id: 3, partenaire_id: "p1", date_service: "2026-11-02", statut: "confirme", montant_vente: 4500 },
    { id: 4, partenaire_id: "p1", date_service: "2026-12-21", statut: "annule", montant_vente: 999 },
  ];
  const nets = { 1: { net_prevu: 1600 }, 2: null, 3: { net_prevu: 4050, net_paye: 4050 } };
  const d = duParPartenaire(R, (r) => nets[r.id] || null);
  assert.equal(d.length, 2);
  assert.deepEqual(d[0], { partenaire_id: "p1", mois: "2026-12", nb: 2, vente: 3600, net_prevu: 1600, net_paye: 0, sansNet: 1, reservations: [R[0], R[1]], reste: 1600, marge: 2000 });
  assert.equal(d[1].reste, 0);
  assert.equal(nomMoisCourt("2026-12"), "Décembre 2026");
  assert.equal(dateTexte("2026-12-10", "th"), "10/12/2026");
});
