// Demande de trajet venue d'une page /taxi/ du site (VIP Taxi Lanta) : le tarif du catalogue Taxi de la page, dans les deux sens (19.11.2026).
// Avant, « Transfer request: Koh Lanta to Krabi Airport » ne trouvait aucun tarif (le catalogue dit seulement « Krabi Airport ») : le service
// sortait « À préciser » et la création du dossier était refusée. Les messages sont ceux que fabrique le code du site (src/js/booking.js,
// origin/main 7fb6c40) ; les tarifs sont ceux du catalogue Taxi (identifiant, libellé, unité, prix de vente public), sans aucun net.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lireMessage, decouperServices, proposerOffres, pageTaxiDuSite, tarifsTaxiDuSite } from "../src/gestion/js/demande-calc.mjs";
import { PRODUITS_SITE } from "../src/gestion/js/site-produits.mjs";
import { titreDemande, reponseConfirmation, reponseRefus } from "../src/gestion/js/demandes-site-calc.mjs";

const AJD = "2026-11-18";
const VIP = "p-vip-taxi-lanta";
// Catalogue de l'entreprise Taxi : des copies du catalogue de Secret, l'identifiant de l'original dans details.copie_de (c'est lui que portent les clés du site).
const t = (id, libelle, prix_vente, copie_de, famille = "transfert", groupe = "Private Taxi") => ({ id, partenaire_id: VIP, famille, groupe, libelle, libelle_en: libelle, unite: "veh", prix_vente, actif: true, sur_place: false, details: { copie_de } });
const PRESTATIONS = [
  t("f3912dd7-e289-cc65-522d-4b650016a866", "Krabi Airport", 2300, "58252c98-7e6c-57b5-ae50-bb8c566a06e5"),
  t("1e6bb8d6-ef3a-f4cc-aa59-ca776fb3dd1a", "Krabi Town", 2500, "4eb24d5d-8261-5e1f-a4bf-ca215987d2ce"),
  t("f0d184b7-307c-64a8-c29c-8e9210cbd49b", "Ao Nang", 2700, "e55d4dbf-c69d-5e2d-aeb9-2eaf07e15dbd"),
  t("2d039cf2-2b15-1cce-44c0-1bcb45098187", "Phuket Airport and town", 4500, "f54dc944-fea2-5ee3-a382-8674cd705c2a"),
  t("03eee7a1-4c0d-fba9-7a47-31c22983cd43", "Patong, Kata and Karon", 5000, "067f78bb-df8b-5151-a6d1-3cad04ccd1ed"),
  t("cb63a233-994d-a941-604f-1838794b84f8", "Surat Thani (town, airport, station)", 4500, "0af08f17-b1fd-512e-a414-d914e0cc7abf"),
  t("62fba83c-ba4b-d41b-d018-92781b4f228a", "Donsak Pier", 5000, "f81dbd59-8777-56f6-a22f-bd3fdcb7bbbd"),
  t("238f7dc0-f6a3-c1af-2baf-52f63c4ba982", "Krabi Airport to Ao Nang", 700, "762abdf2-2c38-5689-a838-ad8fa1b49fba", "transfert", "Other routes mentioned"),
  t("01f33f37-47db-6338-ee74-976d81a51546", "Koh Lanta to Khao Lak", null, "1fd677dc-1985-50bc-a6b3-8caccdd4da37", "transfert", "Other routes mentioned"),
  t("86d40ffd-06e4-2c7d-3769-cc1925ec5b0a", "Full-day trip, Emerald Pool and Krabi Hot Springs", 3500, "b8418ad0-0eec-5345-ab63-73a0a1ddd5d6", "excursion", "Taxi excursions"),
];
const PARTENAIRES = [{ id: VIP, nom: "VIP Taxi Lanta", actif: true }];
const CONTEXTE = { prestations: PRESTATIONS, trajets: [], partenaires: PARTENAIRES, nomPartenaire: () => "VIP Taxi Lanta" };

const offresDe = (message) => {
  const d = lireMessage(message, AJD);
  return { d, services: decouperServices(message, d, CONTEXTE, AJD) };
};
const premiere = (message) => offresDe(message).services[0].offres[0];

// La demande en production du 18.11.2026 (a318f5e6), nom et téléphone remplacés : page Krabi Airport to Koh Lanta, trajet demandé dans l'autre sens.
const DEMANDE_PROD = `Transfer request: Koh Lanta to Krabi Airport
Date: Fri 20 Nov 2026
Pickup time: 18:00
Guests: 2 adults
Bags: 2
Pickup: Lanta Riviera Beach Resort
Drop-off: Krabi Airport (KBV)
Price on the site: From 2,300 THB per vehicle
Name: Client Essai
WhatsApp: +66 00 000 0000`;

test("demande du 18.11 (Koh Lanta → Krabi Airport) : le tarif Krabi Airport à 2 300 THB par véhicule, plus « À préciser »", () => {
  const { d, services } = offresDe(DEMANDE_PROD);
  assert.equal(services.length, 1);
  assert.equal(pageTaxiDuSite(d).id, "krabi-airport-koh-lanta");
  const o = services[0].offres[0];
  assert.equal(o.id, "f3912dd7-e289-cc65-522d-4b650016a866");
  assert.equal(o.titre, "Krabi Airport");
  assert.equal(o.total, 2300);
  assert.equal(o.pageSite, "krabi-airport-koh-lanta");
  // La prise en charge et la dépose restent celles du message, dans son sens.
  assert.equal(d.pickup, "Lanta Riviera Beach Resort");
  assert.equal(d.dropoff, "Krabi Airport (KBV)");
});

test("aller depuis l'aéroport (Krabi Airport → Koh Lanta) : même page, même tarif", () => {
  const o = premiere(`Transfer request: Krabi Airport to Koh Lanta
Date: Fri 20 Nov 2026
Pickup time: 18:00 (landing)
Flight or ferry: FD3047
Guests: 2 adults
Bags: 2
Pickup: Krabi Airport (KBV)
Drop-off: Lanta Sand Resort
Price on the site: From 2,300 THB per vehicle
Name: Client Essai`);
  assert.equal(o.titre, "Krabi Airport");
  assert.equal(o.total, 2300);
});

test("un hôtel sans « Lanta » dans son nom : le bout Koh Lanta se lit dans le titre", () => {
  const o = premiere(`Transfer request: Koh Lanta to Krabi Town
Date: Fri 20 Nov 2026
Pickup time: 09:00
Guests: 3 adults
Pickup: Pimalai Resort
Drop-off: Krabi Town
Price on the site: From 2,500 THB per vehicle
Name: Client Essai`);
  assert.equal(o.titre, "Krabi Town");
  assert.equal(o.total, 2500);
});

test("Koh Lanta to Phuket : la dépose à Patong prend la ligne « Patong, Kata and Karon », Phuket Town la sienne", () => {
  const msg = (depose) => `Transfer request: Koh Lanta to Phuket
Date: Fri 20 Nov 2026
Pickup time: 18:00
Guests: 2 adults
Bags: 2
Pickup: Lanta Sand Resort
Drop-off: ${depose}
Price on the site: From 4,500 THB per vehicle
Name: Client Essai`;
  const patong = offresDe(msg("Patong Beach Hotel")).services[0].offres;
  assert.equal(patong[0].titre, "Patong, Kata and Karon");
  assert.equal(patong[0].total, 5000);
  assert.ok(patong.some((o) => o.titre === "Phuket Airport and town"), "l'autre ligne de la page reste proposée");
  assert.equal(premiere(msg("Phuket Town, Old Town Hostel")).titre, "Phuket Airport and town");
});

test("Surat Thani, retour vers Donsak Pier : la ligne Donsak Pier de la page", () => {
  const o = premiere(`Transfer request: Koh Lanta to Surat Thani Airport
Date: Fri 20 Nov 2026
Pickup time: 18:00
Guests: 2 adults
Bags: 2
Pickup: Lanta Sand Resort
Drop-off: Donsak Pier
Price on the site: From 4,500 THB per vehicle
Name: Client Essai`);
  assert.equal(o.titre, "Donsak Pier");
  assert.equal(o.total, 5000);
});

test("la dépose du message l'emporte sur le titre de la page : Ao Nang écrit sur la page Krabi Airport → Koh Lanta", () => {
  const d = lireMessage(`Transfer request: Krabi Airport to Koh Lanta
Date: Fri 20 Nov 2026
Pickup time: 10:00 (landing)
Guests: 2 adults
Pickup: Krabi Airport (KBV)
Drop-off: Ao Nang
Price on the site: From 2,300 THB per vehicle
Name: Client Essai`, AJD);
  assert.equal(pageTaxiDuSite(d).id, "krabi-airport-ao-nang");
  assert.equal(proposerOffres(d, CONTEXTE)[0].titre, "Krabi Airport to Ao Nang");
});

test("demande du hub /taxi/ (lieux libres) : la page se trouve par la prise en charge et la dépose", () => {
  const o = premiere(`Transfer request: Lanta Riviera Beach Resort to Krabi Airport (KBV)
Date: Fri 20 Nov 2026
Pickup time: 18:00
Guests: 2 adults
Bags: 2
Pickup: Lanta Riviera Beach Resort
Drop-off: Krabi Airport (KBV)
Name: Client Essai`);
  assert.equal(o.titre, "Krabi Airport");
  assert.equal(o.total, 2300);
});

test("tarif sans prix dans le catalogue (Koh Lanta to Khao Lak, « about 5,000 ») : proposé, prix à saisir", () => {
  const o = premiere(`Transfer request: Koh Lanta to Khao Lak
Date: Fri 20 Nov 2026
Pickup time: 18:00
Guests: 2 adults
Pickup: Lanta Sand Resort
Drop-off: Khao Lak Laguna Resort
Price on the site: About 5,000 THB per vehicle
Name: Client Essai`);
  assert.equal(o.titre, "Koh Lanta to Khao Lak");
  assert.equal(o.total, null);
});

test("excursion à la journée vers Krabi : le tarif de l'excursion, pas un transfert", () => {
  const { d, services } = offresDe(`Transfer request: Koh Lanta to Krabi – Day trip
Stops (2): Emerald Pool, Krabi Hot Springs
Date: Fri 20 Nov 2026
Pickup time: 08:00
Guests: 2 adults
Pickup: Lanta Sand Resort (and back at the end of the day)
Price on the site: From 3,500 THB per vehicle, depending on stops and hours
Name: Client Essai`);
  assert.equal(pageTaxiDuSite(d).id, "koh-lanta-krabi-day-trip");
  assert.equal(services[0].offres[0].titre, "Full-day trip, Emerald Pool and Krabi Hot Springs");
  assert.equal(services[0].offres[0].total, 3500);
});

test("page sans tarif dans Gestion (Krabi to Khao Sok) : rien n'est inventé, le service reste à préciser", () => {
  const { d, services } = offresDe(`Transfer request: Krabi to Khao Sok
Date: Fri 20 Nov 2026
Pickup time: 18:00
Guests: 2 adults
Pickup: Krabi Town
Drop-off: Cheow Lan Pier
Price on the site: From 2,800 THB per vehicle
Name: Client Essai`);
  assert.equal(pageTaxiDuSite(d).id, "krabi-khao-sok");
  assert.deepEqual(tarifsTaxiDuSite(d, CONTEXTE), []);
  assert.deepEqual(services[0].offres, []);
});

test("tarif masqué ou partenaire masqué : la page ne l'impose pas", () => {
  const d = lireMessage(DEMANDE_PROD, AJD);
  const masque = PRESTATIONS.map((p) => (p.libelle === "Krabi Airport" ? { ...p, actif: false } : p));
  assert.deepEqual(tarifsTaxiDuSite(d, { ...CONTEXTE, prestations: masque }), []);
  assert.deepEqual(tarifsTaxiDuSite(d, { ...CONTEXTE, partenaires: [{ ...PARTENAIRES[0], actif: false }] }), []);
});

test("démonstration (identifiants différents) : le tarif se retrouve par son libellé", () => {
  const demo = PRESTATIONS.map((p) => ({ ...p, id: `demo-${p.libelle}`, details: {} }));
  const o = proposerOffres(lireMessage(DEMANDE_PROD, AJD), { ...CONTEXTE, prestations: demo })[0];
  assert.equal(o.id, "demo-Krabi Airport");
  assert.equal(o.total, 2300);
});

test("hors pages trajet : retour au point de départ, minivan partagé et message libre ne prennent pas de page", () => {
  const retour = lireMessage("Round trip, back to the pickup place\nPickup: Lanta Sand Resort\nPlan: Old Town and back\nTime needed: about 3 hours\nDate: Fri 20 Nov 2026\nGuests: 2 adults\nName: Client Essai", AJD);
  assert.equal(pageTaxiDuSite(retour), null);
  const partage = lireMessage("Shared minivan request (Secret Travel & Tour): Koh Lanta to Krabi Airport\nDate: Fri 20 Nov 2026\nGuests: 2 adults\nName: Client Essai", AJD);
  assert.equal(pageTaxiDuSite(partage), null);
  assert.equal(pageTaxiDuSite(lireMessage("Hi, we need a taxi from Koh Lanta to Krabi airport on the 20th, 2 people", AJD)), null);
});

test("site-produits.mjs : chaque page trajet du site a ses deux bouts, ses tarifs portent un identifiant et un libellé, jamais un prix", () => {
  const pages = PRODUITS_SITE.filter((p) => p.marque === "taxi");
  assert.ok(pages.length >= 19, `${pages.length} pages taxi seulement`);
  for (const p of pages) {
    assert.ok(p.de && p.vers, `${p.id} : bouts du trajet`);
    assert.match(p.url, /^\/taxi\/[a-z0-9-]+\/$/, p.id);
    for (const x of p.tarifs || []) {
      assert.deepEqual(Object.keys(x).sort(), ["libelle", "ligne", "prestation"], p.id);
      assert.match(x.prestation, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, p.id);
    }
  }
  // Le regroupement southern-thailand n'est pas une page du site : ses trajets ont chacun la leur.
  assert.ok(!pages.some((p) => p.id === "southern-thailand"));
  assert.ok(pages.some((p) => p.id === "krabi-airport-ao-nang"));
});

// La demande telle que la base la garde (demandes_site), nom et téléphone remplacés : la page est Krabi Airport to Koh Lanta, le trajet est l'inverse.
const LIGNE_PROD = { marque: "taxi", ref: null, produit_id: "taxi-krabi-airport-koh-lanta", produit: "Krabi Airport to Koh Lanta", option_id: null, option_titre: null, date_service: "2026-11-20", heure: "18:00", adultes: 2, enfants: 0, pickup: "Lanta Riviera Beach Resort", nom: "Client Essai", devise: "THB", total_estime: 2300, message: DEMANDE_PROD };

test("réponse au client : le trajet du message (Koh Lanta to Krabi Airport), pas le nom de la page", () => {
  assert.equal(titreDemande(LIGNE_PROD), "Koh Lanta to Krabi Airport");
  const r = reponseConfirmation(LIGNE_PROD, { date: "2026-11-20", heure: "18:00", adultes: 2, enfants: 0, total: 2300, devise: "THB" }, { aujourdhui: AJD });
  assert.match(r, /\nKoh Lanta to Krabi Airport\n/);
  assert.doesNotMatch(r, /Krabi Airport to Koh Lanta/);
  assert.match(r, /Pickup: Lanta Riviera Beach Resort/);
  assert.match(r, /Total: 2,300 THB/);
  assert.match(reponseRefus(LIGNE_PROD, { motif: "complet" }, { aujourdhui: AJD }), /request for Koh Lanta to Krabi Airport/);
  // Sans message (ancien site) ou hors taxi : le nom de la page, comme avant.
  assert.equal(titreDemande({ ...LIGNE_PROD, message: "" }), "Krabi Airport to Koh Lanta");
  assert.equal(titreDemande({ marque: "secret", produit: "4 Islands", message: "Booking request: 4 Islands – Join-in longtail" }), "4 Islands");
});
