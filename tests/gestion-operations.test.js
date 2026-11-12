import { test } from "node:test";
import { varsReponse } from "../src/gestion/js/demande-calc.mjs";
import assert from "node:assert/strict";
import { reservationsDepuisDocument, personnesTexte, remplirGabarit, variablesMessage, agenda, duParPartenaire, dateTexte, nomMoisCourt, typeVoucher, numeroVoucher, statutPaiementVoucher, estPrive, fraisDeParc, typeTransfert, hotelEtChambre, descriptionService, datesDepuisReservations, CHAMPS_VOUCHER, pointEmbarquement, consigneCheckin, destinataireMessage, cleMessageClient, ecartReservation, contenuSansReservation, controlesVoucher, feuilleDuJour, texteFeuille } from "../src/gestion/js/operations-calc.mjs";

test("vouchers : modèle d'après la prestation, numéro, statut de paiement", () => {
  assert.equal(typeVoucher({ trajet_id: "t" }, null), "billet", "un trajet de compagnie est un billet de bateau");
  assert.equal(typeVoucher({}, { famille: "transfert", groupe: "Speedboat Koh Lanta", libelle: "x" }), "billet");
  assert.equal(typeVoucher({}, { famille: "excursion", groupe: "Option Supplément", libelle: "Extension Koh Kradan" }), null, "une option n'a pas de voucher");
  assert.equal(typeVoucher({}, { famille: "excursion", groupe: "Excursions en taxi", libelle: "Krabi day trip" }), "activite", "une journée en taxi est une activité");
  assert.equal(typeVoucher({ libelle: "Speedboat transfer: Koh Lanta → Koh Lipe" }, null), "billet");
  assert.equal(typeVoucher({}, { famille: "excursion", groupe: "Excursions en groupe" }), "bateau");
  assert.equal(typeVoucher({}, { famille: "activite" }), "activite");
  assert.equal(typeVoucher({}, { famille: "location" }), "location");
  assert.ok(CHAMPS_VOUCHER.location.includes("retour_date") && !CHAMPS_VOUCHER.bateau.includes("vol"), "chaque modèle a ses champs");
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
  assert.deepEqual(fraisDeParc({ details: { parc: "Adulte étranger: 400 ฿ | Enfant: 200 ฿\n(Thaï: 40 ฿ / 20 ฿)" } }), { inclus: false, texte: "Adult 400 THB, child 200 THB (Thai nationals 40 / 20 THB), cash on the day" });
  assert.deepEqual(fraisDeParc({ details: { parc: "Compris dans la prestation" } }), { inclus: true, texte: "" });
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
  assert.deepEqual(r[0].reservation, { id: "R1", dossier_id: "D1", ligne_id: "l1", prestation_id: "x1", trajet_id: null, partenaire_id: "p1", libelle: "4 îles", date_service: "2026-12-10", heure_pickup: "", lieu_pickup: "", personnes: { adultes: 2, enfants: 0, bebes: 0 }, statut: "a_demander", reference_partenaire: "", montant_vente: 2400, notes: "", paye_sur_place: false, details: {} });
  assert.equal(r[0].net, 1600);
  assert.deepEqual(r[1].reservation.personnes, { adultes: 0, enfants: 1, bebes: 0 });
  assert.equal(r[1].reservation.trajet_id, "t1");
  assert.equal(r[1].net, 1200);
});

test("réservations : les lignes adulte et enfant d'un même bateau donnent une seule réservation", () => {
  const doc = {
    dossier_id: "D1",
    contenu: {
      lignes: [
        { id: "a", kind: "ligne", titre: "Speedboat transfer: Koh Lanta → Koh Lipe, departure 10:30", libelle: "…", intro: "(per adult)", unite: 1900, qte: 2, net: 1500, trajet_id: "t1", partenaire_id: "B", date_service: "2026-12-12" },
        { id: "b", kind: "ligne", titre: "Speedboat transfer: Koh Lanta → Koh Lipe, departure 10:30, child", libelle: "…", intro: "(per child)", unite: 1500, qte: 1, net: 1200, trajet_id: "t1", partenaire_id: "B", date_service: "2026-12-12" },
        { id: "c", kind: "ligne", titre: "4 Islands (Koh Chuek), child (4-10)", libelle: "…", intro: "(per child)", unite: 900, qte: 1, net: 600, prestation_id: "x2", partenaire_id: "L", date_service: "2026-12-10" },
        { id: "d", kind: "ligne", titre: "4 Islands (Koh Chuek)", libelle: "…", intro: "(per person)", unite: 1200, qte: 2, net: 800, prestation_id: "x1", partenaire_id: "L", date_service: "2026-12-10" },
        { id: "e", kind: "ligne", titre: "4 Islands (Koh Chuek)", libelle: "…", intro: "(per person)", unite: 1200, qte: 1, net: 800, prestation_id: "x1", partenaire_id: "L", date_service: "2026-12-11" },
      ],
    },
  };
  let n = 0;
  const r = reservationsDepuisDocument(doc, { uid: () => `R${++n}` });
  assert.equal(r.length, 3, "bateau, 4 îles du 10, 4 îles du 11");
  assert.deepEqual([r[0].reservation.libelle, r[0].reservation.personnes, r[0].reservation.montant_vente, r[0].net, r[0].reservation.details], ["Speedboat transfer: Koh Lanta → Koh Lipe, departure 10:30", { adultes: 2, enfants: 1, bebes: 0 }, 5300, 4200, { lignes_ids: ["a", "b"] }]);
  assert.equal(r[1].reservation.ligne_id, "d", "la ligne adulte mène, même si la ligne enfant vient avant");
  assert.deepEqual(r[1].reservation.personnes, { adultes: 2, enfants: 1, bebes: 0 });
  assert.equal(r[1].reservation.prestation_id, "x1");
  assert.deepEqual(r[2].reservation.personnes, { adultes: 1, enfants: 0, bebes: 0 });
  assert.equal(reservationsDepuisDocument(doc, { existantes: [{ ligne_id: "d", details: { lignes_ids: ["c", "d"] } }, { ligne_id: "a", details: { lignes_ids: ["a", "b"] } }] }).length, 1, "les lignes déjà réservées ne reviennent pas");
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
  assert.deepEqual(v, { client: "Ben Walker", prenom: "Ben", date: "10 December 2026", hotel: "Hotel Sunset", heure: "08:00", a_heure: " at 08:00", personnes: "2 adults", prestation: "4 Islands", partenaire: "Longtail", reference: "LT-1", entreprise: "Secret", telephone: "+66", lien_avis: "" });
  const fr = variablesMessage({ reservation: {}, client: { prenom: "Ben", nom: "Walker", adresse: "Hotel Palm\nKoh Lanta" }, dossier: { ref: "EX-2", date_depart: "2027-01-05" } });
  assert.equal(fr.date, "5 janvier 2027");
  assert.equal(fr.hotel, "Hotel Palm");
  assert.equal(fr.reference, "EX-2");
  assert.equal(fr.a_heure, "");
  // Le modèle « réponse au client » a ses propres variables (services, total, formule d'appel) : celles de varsReponse.
  const connues = { ...v, ...varsReponse({ d: { nom: "A" }, services: [], entreprise: {} }) };
  for (const m of MESSAGES_DEFAUT) for (const k of m.corps.match(/\{(\w+)\}/g) || []) assert.ok(k.slice(1, -1) in connues, `${m.id} utilise une variable connue : ${k}`);
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
  assert.deepEqual(d[0], { partenaire_id: "p1", mois: "2026-12", nb: 2, vente: 3600, venteAvecNet: 2400, net_prevu: 1600, net_paye: 0, sansNet: 1, reservations: [R[0], R[1]], reste: 1600, marge: 800 }, "la marge ne compte que la vente dont le net est connu (2400 moins 1600), pas la vente sans net");
  assert.equal(d[1].reste, 0);
  assert.equal(nomMoisCourt("2026-12"), "Décembre 2026");
  assert.equal(dateTexte("2026-12-10", "th"), "10/12/2026");
});

test("dates du dossier déduites des réservations : première et dernière date de service, annulées exclues", () => {
  assert.deepEqual(datesDepuisReservations([{ date_service: "2026-11-15", statut: "confirme" }, { date_service: "2026-11-14", statut: "a_demander" }, { date_service: "2026-12-01", statut: "annule" }]), { date_depart: "2026-11-14", date_retour: "2026-11-15" });
  assert.deepEqual(datesDepuisReservations([{ date_service: "2026-11-15", statut: "confirme" }]), { date_depart: "2026-11-15", date_retour: null });
  assert.deepEqual(datesDepuisReservations([{ date_service: null, statut: "confirme" }]), { date_depart: null, date_retour: null });
});

test("billet de bateau : embarcadère de la compagnie et consigne de check-in en anglais", () => {
  const bund = { regles: { points_embarquement: [{ lieu: "Koh Lanta", ou: "Saladan Pier" }, { lieu: "Phuket", ou: "Rassada Pier, counter no. 11" }] } };
  assert.equal(pointEmbarquement(bund, "Koh Lanta"), "Saladan Pier");
  assert.equal(pointEmbarquement(bund, "Phuket"), "Rassada Pier, counter no. 11");
  assert.equal(pointEmbarquement(bund, "Koh Lipe"), "");
  assert.equal(pointEmbarquement(null, "Koh Lanta"), "");
  assert.match(consigneCheckin("Bundhaya Speed Boat", { de: "Koh Lanta", vers: "Koh Lipe" }), /45 minutes before departure/);
  assert.match(consigneCheckin("Bundhaya Speed Boat", { de: "Koh Lipe", vers: "Langkawi" }), /90 minutes.*passport/i);
  assert.match(consigneCheckin("Satun Pakbara Speed Boat Club", { de: "Koh Lanta", vers: "Koh Ngai" }), /30 minutes before departure/);
  assert.match(consigneCheckin("Ferry démo", {}), /30 minutes before departure/);
});

test("voucher : une réservation à la main chez une compagnie de bateaux est un billet", () => {
  assert.equal(typeVoucher({ libelle: "Koh Lanta → Koh Lipe" }, null, { nom: "Bundhaya Speed Boat", regles: { points_embarquement: [{ lieu: "Koh Lanta", ou: "Saladan Pier" }] } }), "billet");
  assert.equal(typeVoucher({ libelle: "Koh Lanta → Koh Lipe" }, null, { nom: "Satun Pakbara Speed Boat Club", regles: {} }), "billet");
  assert.equal(typeVoucher({ libelle: "Krabi Airport → Koh Lanta" }, null, { nom: "VIP Taxi Lanta", regles: {} }), "transfert");
});

test("messages : le destinataire est enregistré ou déduit de l'usage, et chaque message de départ en a un", () => {
  assert.equal(destinataireMessage({ cle: "partenaire" }), "partenaire");
  assert.equal(destinataireMessage({ cle: "confirmation" }), "client");
  assert.equal(destinataireMessage({ pour: "partenaire", cle: "confirmation" }), "partenaire");
  for (const m of MESSAGES_DEFAUT) {
    assert.ok(["client", "partenaire"].includes(m.pour), `${m.id} a un destinataire`);
    assert.ok(m.pour === "client" ? ["fr", "en"].includes(m.langue) : ["en", "th"].includes(m.langue), `${m.id} : langue selon le destinataire`);
    assert.ok(!/\{client\}/.test(m.corps) || m.pour === "partenaire", `${m.id} : {client} ne sert qu'au partenaire`);
  }
  assert.equal(MESSAGES_DEFAUT.filter((m) => m.pour === "partenaire" && m.langue === "en").length, 4);
});

test("prestation hors base : la ligne libre a sa réservation, sans prestation ni partenaire imposés", async () => {
  const { ligneLibre } = await import("../src/gestion/js/partenaires-calc.mjs");
  let n = 0;
  const uid = () => `u${++n}`;
  const l = ligneLibre({ libelle: "  Cooking class  ", prix: "1200", qte: "2", partenaire_id: "", date: "2026-12-05" }, { uid });
  assert.deepEqual(l, { id: "u1", kind: "ligne", libre: true, libelle: "Cooking class", intro: "", puces: [], unite: 1200, qte: 2, montant: null, pct: null, prestation_id: null, trajet_id: null, partenaire_id: null, date_service: "2026-12-05", net: null });
  const r = reservationsDepuisDocument({ dossier_id: "D1", contenu: { lignes: [l, { id: "x", kind: "ligne", libelle: "Ligne écrite à la main", unite: 100, qte: 1 }] } }, { uid });
  assert.equal(r.length, 1, "seule la ligne libre devient une réservation, pas une ligne écrite dans l'éditeur");
  assert.equal(r[0].reservation.libelle, "Cooking class");
  assert.equal(r[0].reservation.ligne_id, "u1");
  assert.equal(r[0].reservation.prestation_id, null);
  assert.equal(r[0].reservation.partenaire_id, null);
  assert.deepEqual(r[0].reservation.personnes, { adultes: 2, enfants: 0, bebes: 0 });
  assert.equal(r[0].reservation.date_service, "2026-12-05");
  assert.equal(typeVoucher(r[0].reservation, null), "activite", "un voucher d'activité par défaut");
  assert.equal(typeVoucher({ libelle: "Private taxi to Krabi" }, null), "transfert");
  assert.equal(reservationsDepuisDocument({ dossier_id: "D1", contenu: { lignes: [l] } }, { existantes: [{ ligne_id: "u1" }] }).length, 0, "elle ne se réserve qu'une fois");
  const avecPartenaire = ligneLibre({ libelle: "Massage", prix: 0, partenaire_id: "p9" }, { uid });
  assert.equal(avecPartenaire.unite, 0, "une prestation offerte garde son prix à 0");
  assert.equal(reservationsDepuisDocument({ dossier_id: "D1", contenu: { lignes: [avecPartenaire] } }, { uid })[0].reservation.partenaire_id, "p9");
});

test("hôtel et chambre : « Beach Resort » n'est pas une chambre, « Room 12 » ou « Ch. 5 » en fin de ligne en est une", () => {
  const h = (adresse, pickup = "") => hotelEtChambre({ adresse }, { lieu_pickup: pickup });
  assert.deepEqual(h("Klong Dao Beach Resort"), { hotel: "Klong Dao Beach Resort", chambre: "" });
  assert.deepEqual(h("Time Beach Bungalow"), { hotel: "Time Beach Bungalow", chambre: "" });
  assert.deepEqual(h("Mama Beach Hut 3"), { hotel: "Mama Beach Hut 3", chambre: "" });
  assert.deepEqual(h("Hotel Sunset, Room 12"), { hotel: "Hotel Sunset", chambre: "12" });
  assert.deepEqual(h("Lanta Castaway Beach Resort, Ch. 5"), { hotel: "Lanta Castaway Beach Resort", chambre: "5" });
  assert.deepEqual(h("Sunset Hotel, Room A12"), { hotel: "Sunset Hotel", chambre: "A12" });
  assert.deepEqual(h("Sunset Hotel chambre 7B"), { hotel: "Sunset Hotel", chambre: "7B" });
  assert.deepEqual(h("Rue du Lac 12", "Hotel Sunset, Room 4"), { hotel: "Hotel Sunset", chambre: "4" }, "le pickup prime sur l'adresse du client");
});

test("message au client : rappel la veille, avis après le service, confirmation sinon", () => {
  assert.equal(cleMessageClient("2026-11-07", "2026-11-06"), "rappel");
  assert.equal(cleMessageClient("2026-11-06", "2026-11-06"), "confirmation", "le jour même, le rappel de la veille n'a plus de sens");
  assert.equal(cleMessageClient("2026-11-20", "2026-11-06"), "confirmation");
  assert.equal(cleMessageClient("2026-11-05", "2026-11-06"), "avis");
  assert.equal(cleMessageClient("2026-12-01", "2026-11-30"), "rappel", "la veille d'un changement de mois");
  assert.equal(cleMessageClient(null, "2026-11-06"), "confirmation");
});

test("phrase des CGV : propre à la facture, sans crochets bruts quand le lien manque, absente si les réglages la vident", async () => {
  const { phraseCgv, CGV_FACTURE } = await import("../src/gestion/js/defauts.mjs");
  const fr = { facture: "Facture", cgv: "Le client accepte les [CGV]({cgv_url}). La signature du présent devis vaut acceptation." };
  assert.equal(phraseCgv(fr, { cgvUrl: "https://x.ch/cgv" }), fr.cgv, "sur un devis : la phrase des réglages");
  assert.equal(phraseCgv(fr, { estFacture: true, cgvUrl: "https://x.ch/cgv" }), CGV_FACTURE.fr, "sur une facture : plus de signature du devis");
  assert.ok(!/devis/.test(CGV_FACTURE.fr) && !/quote/i.test(CGV_FACTURE.en));
  assert.equal(phraseCgv(fr, { cgvUrl: "" }), "Le client accepte les CGV. La signature du présent devis vaut acceptation.", "sans lien : texte simple");
  assert.equal(phraseCgv({ facture: "Invoice", cgv: "x" }, { estFacture: true, cgvUrl: "u" }), CGV_FACTURE.en, "libellés anglais (Secret)");
  assert.equal(phraseCgv({ facture: "Facture", cgv: "x" }, { estFacture: true, en: true, cgvUrl: "u" }), CGV_FACTURE.en, "document en anglais");
  assert.equal(phraseCgv({ ...fr, cgv_facture: "Sur mesure [ici]({cgv_url})." }, { estFacture: true, cgvUrl: "u" }), "Sur mesure [ici]({cgv_url}).", "phrase de facture personnalisée");
  assert.equal(phraseCgv({ facture: "Facture", cgv: "" }, { estFacture: true, cgvUrl: "u" }), "", "phrase vidée dans les réglages : rien sur le document");
});

test("envoi d'un voucher par WhatsApp : nom du fichier, message, lien avec ou sans numéro", async () => {
  const { nomFichierVoucher, messageVoucher, lienWhatsApp } = await import("../src/gestion/js/operations-calc.mjs");
  const { chiffres, telWhatsApp } = await import("../src/gestion/js/partenaires-calc.mjs");
  assert.equal(nomFichierVoucher("EX-2026-0003-1", "Anna Keller"), "Voucher EX-2026-0003-1 - Anna.png");
  assert.equal(nomFichierVoucher("EX-2026-0003-1", ""), "Voucher EX-2026-0003-1 - client.png");
  assert.equal(nomFichierVoucher("A/B:1", 'Jo*"x'), "Voucher AB1 - Jox.png", "aucun caractère interdit dans un nom de fichier");
  assert.equal(messageVoucher({ pour: "client", prenom: "Anna" }), "Hello Anna, here is your booking confirmation for your program. We wish you an excellent day!");
  assert.equal(messageVoucher({ pour: "client" }), "Hello, here is your booking confirmation for your program. We wish you an excellent day!");
  assert.equal(messageVoucher({ pour: "partenaire", montant: 2400, devise: "THB" }), "Price the guest pays: THB 2,400", "au prestataire : seulement le prix payé par le client");
  assert.equal(messageVoucher({ pour: "partenaire", montant: "1200.5", devise: "THB" }), "Price the guest pays: THB 1,200.5");
  assert.equal(messageVoucher({ pour: "partenaire", montant: null, devise: "THB" }), "", "sans prix, pas de message");
  assert.ok(!/EX-|voucher \d|\d{4}-\d{4}/i.test(messageVoucher({ pour: "client", prenom: "Anna" }) + messageVoucher({ pour: "partenaire", montant: 100, devise: "THB" })), "jamais de numéro de voucher dans le message");
  assert.equal(lienWhatsApp("+49 160 123456", "Hi & bye"), "https://wa.me/49160123456?text=Hi%20%26%20bye");
  assert.equal(lienWhatsApp("081-9789025", "x", { thaiLocal: true }), "https://wa.me/66819789025?text=x", "un numéro de partenaire thaïlandais en 0 prend l'indicatif +66");
  assert.equal(lienWhatsApp("", "Hello"), "https://wa.me/?text=Hello", "sans numéro, WhatsApp laisse choisir le contact");
  assert.equal(chiffres("pas de numéro"), "");
  assert.equal(telWhatsApp({ contact: { telephones: [{ numero: "02 000", whatsapp: false }, { numero: "081 111 2222", whatsapp: true }] } }), "081 111 2222", "le numéro marqué WhatsApp prime");
  assert.equal(telWhatsApp({ contact: { telephones: [{ numero: "02 000" }] } }), "02 000");
  assert.equal(telWhatsApp(null), "");
});

test("dossier annulé : ses réservations sortent de l'agenda et du dû aux partenaires, sans changer leur statut", () => {
  const R = [
    { id: 1, dossier_id: "A", partenaire_id: "p1", date_service: "2026-11-06", statut: "confirme", libelle: "Tour A", montant_vente: 100 },
    { id: 2, dossier_id: "B", partenaire_id: "p1", date_service: "2026-11-06", statut: "confirme", libelle: "Tour B", montant_vente: 200 },
    { id: 3, dossier_id: "B", partenaire_id: "p1", date_service: "2026-11-07", statut: "a_demander", libelle: "Tour C", montant_vente: 300 },
  ];
  const sans = agenda(R, "2026-11-06");
  assert.equal(sans.aujourdhui.length, 2);
  const avec = agenda(R, "2026-11-06", new Set(["B"]));
  assert.deepEqual(avec.aujourdhui.map((r) => r.id), [1], "le tour du dossier annulé n'est plus au programme du jour");
  assert.deepEqual(avec.demain, []);
  assert.deepEqual(avec.aConfirmer, [], "ni à confirmer auprès des partenaires");
  const nets = { 1: { net_prevu: 60 }, 2: { net_prevu: 150 }, 3: { net_prevu: 220 } };
  const du = duParPartenaire(R, (r) => nets[r.id] || null, new Set(["B"]));
  assert.equal(du.length, 1);
  assert.equal(du[0].nb, 1);
  assert.equal(du[0].net_prevu, 60, "le dû ne compte plus les réservations du dossier annulé");
});

test("écart entre réservation et facture : date, personnes, montant, ligne retirée", () => {
  const ligne = (id, extra = {}) => ({ id, kind: "ligne", libelle: "Tour des îles", unite: 1200, qte: 2, prestation_id: "x", partenaire_id: "p1", date_service: "2026-12-10", ...extra });
  const doc = { dossier_id: "D", contenu: { lignes: [ligne("l1"), ligne("l2", { libelle: "Tour des îles, enfant", intro: "(par enfant)", unite: 900, qte: 1 })] } };
  const [{ reservation }] = reservationsDepuisDocument(doc, { uid: () => "R1" });
  assert.equal(ecartReservation(reservation, doc), null, "une réservation fraîchement créée n'a aucun écart");
  // la facture change : une personne en plus, une autre date
  const doc2 = { dossier_id: "D", contenu: { lignes: [ligne("l1", { qte: 3, date_service: "2026-12-11" }), doc.contenu.lignes[1]] } };
  const e = ecartReservation(reservation, doc2);
  assert.deepEqual(e.champs.map((c) => c.cle), ["date_service", "personnes", "montant_vente"]);
  assert.deepEqual(e.attendu.personnes, { adultes: 3, enfants: 1 });
  assert.equal(e.champs.find((c) => c.cle === "montant_vente").document, 4500);
  // la réservation change seule : on le voit aussi
  assert.deepEqual(ecartReservation({ ...reservation, personnes: { adultes: 4, enfants: 1 } }, doc).champs.map((c) => c.cle), ["personnes"]);
  // la ligne a disparu du document
  assert.deepEqual(ecartReservation(reservation, { dossier_id: "D", contenu: { lignes: [] } }), { retiree: true, champs: [] });
  // réservation faite à la main, sans ligne : rien à comparer
  assert.equal(ecartReservation({ ...reservation, ligne_id: "", details: {} }, doc), null);
});

test("service supprimé : ses lignes, sa note sur place et son prestataire quittent la facture, le reste demeure", () => {
  const ligne = (id, extra = {}) => ({ id, kind: "ligne", libelle: "Tour des îles", unite: 1200, qte: 2, prestation_id: "x", partenaire_id: "p1", date_service: "2026-12-10", ...extra });
  const note = (id, extra = {}) => ({ id, kind: "texte", sur_place: true, libelle: "Park fee on site", prestation_id: "x", partenaire_id: "p1", date_service: "2026-12-10", ...extra });
  const autre = ligne("a1", { prestation_id: "y", partenaire_id: "p2", libelle: "Cooking class", date_service: "2026-12-12" });
  const remise = { id: "r1", kind: "remise", libelle: "Remise", montant: 100 };
  const nom = (id) => ({ p1: "Alpha", p2: "Beta" })[id] || "";
  const contenu = { prestataire: "Alpha, Beta", devise: "THB", lignes: [ligne("l1"), ligne("l2", { libelle: "Tour des îles, enfant", unite: 900, qte: 1 }), note("n1"), autre, remise] };
  const [{ reservation }] = reservationsDepuisDocument({ dossier_id: "D", contenu: { lignes: [contenu.lignes[0], contenu.lignes[1], autre] } }, { uid: () => "R1" });
  const r = contenuSansReservation(contenu, reservation, { nomPartenaire: nom });
  assert.deepEqual(r.contenu.lignes.map((l) => l.id), ["a1", "r1"], "adulte, enfant et note sur place partent, l'autre service et la remise restent");
  assert.deepEqual(r.retirees.map((l) => l.id), ["l1", "l2", "n1"]);
  assert.equal(r.contenu.prestataire, "Beta", "le prestataire qui ne sert plus disparaît");
  assert.equal(contenu.lignes.length, 5, "le contenu d'origine n'est pas modifié");
  // prestataire réécrit à la main : on n'y touche pas
  assert.equal(contenuSansReservation({ ...contenu, prestataire: "Alpha Co." }, reservation, { nomPartenaire: nom }).contenu.prestataire, "Alpha Co.");
  // même prestation, même date, deuxième groupe de personnes : la note sur place reste
  const deux = { ...contenu, lignes: [ligne("l1"), ligne("l3"), note("n1")] };
  const garde = contenuSansReservation(deux, { ligne_id: "l1", details: {} }, { nomPartenaire: nom });
  assert.deepEqual(garde.contenu.lignes.map((l) => l.id), ["l3", "n1"]);
  // réservation à la main, ou ligne déjà retirée : rien à faire
  assert.equal(contenuSansReservation(contenu, { ligne_id: "", details: {} }), null);
  assert.equal(contenuSansReservation({ lignes: [] }, reservation), null);
});

test("contrôles avant d'envoyer un voucher : ce qui manque, sans rien interdire", () => {
  const ok = { statut: "confirme", date_service: "2026-12-10", heure_pickup: "08:00", lieu_pickup: "Hotel Sunset" };
  assert.deepEqual(controlesVoucher(ok, { adresse: "x" }, "bateau"), []);
  assert.deepEqual(controlesVoucher({ ...ok, statut: "demande" }, {}, "bateau"), ["non_confirmee"]);
  assert.deepEqual(controlesVoucher({ ...ok, date_service: null, heure_pickup: "  " }, {}, "bateau"), ["sans_date", "sans_heure"]);
  assert.deepEqual(controlesVoucher({ ...ok, lieu_pickup: "" }, { adresse: "Rue du Lac 12" }, "transfert"), ["lieu_adresse_client"], "le lieu retombe sur l'adresse du client : à vérifier");
  assert.deepEqual(controlesVoucher({ ...ok, lieu_pickup: "" }, {}, "activite"), ["sans_lieu"]);
  assert.deepEqual(controlesVoucher({ statut: "confirme", date_service: "2026-12-10" }, {}, "location"), [], "une location n'a pas de pickup");
});

test("feuille du jour : par partenaire, triée par heure, sans les annulées, avec un texte pour WhatsApp", () => {
  const clients = { A: { prenom: "Anna", nom: "Keller", telephone: "+49 160 123", adresse: "Hotel Sunset, Room 12" }, B: { prenom: "Ben", nom: "Walker", telephone: "+44 7000", adresse: "Lanta Sand Resort" } };
  const contexte = { client: (r) => clients[r.dossier_id], partenaire: (id) => ({ p1: "Longtail démo", p2: "Speedboat démo" })[id] };
  const R = [
    { id: 1, dossier_id: "B", partenaire_id: "p1", date_service: "2026-12-10", heure_pickup: "08:30", lieu_pickup: "", statut: "confirme", libelle: "4 îles", personnes: { adultes: 2, enfants: 0 } },
    { id: 2, dossier_id: "A", partenaire_id: "p1", date_service: "2026-12-10", heure_pickup: "08:00", lieu_pickup: "", statut: "demande", libelle: "4 îles", personnes: { adultes: 2, enfants: 1 } },
    { id: 3, dossier_id: "A", partenaire_id: "p2", date_service: "2026-12-10", heure_pickup: "10:00", lieu_pickup: "", statut: "confirme", libelle: "Speedboat", personnes: { adultes: 1, enfants: 0 } },
    { id: 4, dossier_id: "A", partenaire_id: "p1", date_service: "2026-12-10", heure_pickup: "07:00", statut: "annule", libelle: "Annulé", personnes: { adultes: 9, enfants: 0 } },
    { id: 5, dossier_id: "A", partenaire_id: "p1", date_service: "2026-12-11", heure_pickup: "08:00", statut: "confirme", libelle: "Autre jour", personnes: { adultes: 1, enfants: 0 } },
  ];
  const f = feuilleDuJour(R, "2026-12-10", contexte);
  assert.deepEqual(f.map((g) => [g.nom, g.lignes.length, g.adultes, g.enfants]), [["Longtail démo", 2, 4, 1], ["Speedboat démo", 1, 1, 0]]);
  assert.deepEqual(f[0].lignes.map((l) => l.heure), ["08:00", "08:30"], "triées par heure de pickup");
  assert.equal(f[0].lignes[0].hotel, "Hotel Sunset");
  assert.equal(f[0].lignes[0].chambre, "12");
  assert.deepEqual(feuilleDuJour(R, "2026-12-10", contexte, new Set(["B"]))[0].lignes.map((l) => l.client), ["Anna Keller"], "un dossier annulé n'est plus sur la feuille");
  assert.equal(texteFeuille(f[0], "2026-12-10"), "Longtail démo: 10 December 2026, 4 adults, 1 child\n08:00 · 4 Islands · Anna Keller · +49 160 123 · Hotel Sunset, room 12 · 2 adults, 1 child\n08:30 · 4 Islands · Ben Walker · +44 7000 · Lanta Sand Resort · 2 adults");
});
