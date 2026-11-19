// « Coller une confirmation » (Jérémy, 18.11.2026) : lecture de la confirmation de course écrite sur WhatsApp, entreprise, client, et création
// commune avec l'écran « Nouveau voucher » de Mook.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lireConfirmation, erreursConfirmation, lireDate, lireHeure, lirePassagers, lireAllerRetour, lireMarque, entreprisesConfirmation, clientExistant } from "../src/gestion/js/confirmation-calc.mjs";
import { donneesVoucher, reservationVoucher, reservationApercu, correctionReservation, valeursDepuis } from "../src/gestion/js/voucher-rapide-calc.mjs";
import { RETOUR_DEPART } from "../src/gestion/js/trajet-calc.mjs";

const AJD = "2026-11-18";
const JEREMY = `📢 New booking confirmation:
VIP TAXI LANTA
Name:  Enzo
Date: November 22nd 2026
Pick-up time: 4:30pm
Pick-up location: Manao villa no 24
Drop-off location: Rock bar restaurant (and round trip)
Number of passengers: 5 people no luggage
Price: 1000 THB
Remark: 50th birthday, they want to put music in the minivan on the way`;

test("le texte de Jérémy : tout est lu, retour au point de départ, aucune erreur", () => {
  const r = lireConfirmation(JEREMY, { aujourdhui: AJD });
  assert.equal(r.marque, "taxi");
  assert.deepEqual(r.ignorees, []);
  const v = r.valeurs;
  assert.equal(v.nom, "Enzo");
  assert.equal(v.date, "2026-11-22");
  assert.equal(v.heure, "16:30");
  assert.equal(v.pickup, "Manao villa no 24");
  assert.equal(v.trajet, RETOUR_DEPART);
  assert.equal(v.programme, "Rock bar restaurant");
  assert.equal(v.dropoff, "");
  assert.equal(v.adultes, "5");
  assert.equal(v.enfants, "");
  assert.equal(v.bagages, "");
  assert.equal(v.prix, "1000");
  assert.equal(v.remarques, "50th birthday, they want to put music in the minivan on the way");
  assert.deepEqual(erreursConfirmation(v), {});
  // Ce que la création pose : la course « Round trip from … », 5 adultes, 1000 THB, la remarque imprimée sur la Booking confirmation.
  const x = donneesVoucher(v);
  assert.match(x.libelle, /Round trip from Manao villa no 24/);
  assert.equal(x.prix, 1000);
  assert.deepEqual(x.personnes, { adultes: 5, enfants: 0, bebes: 0 });
  const res = reservationVoucher(x);
  assert.equal(res.details.type_trajet, RETOUR_DEPART);
  assert.equal(res.details.programme_trajet, "Rock bar restaurant");
  assert.equal(res.details.remarques, "50th birthday, they want to put music in the minivan on the way");
  assert.equal(reservationApercu(x).details.remarques, x.remarques);
});

test("variante : aller simple, heure en 24 h, date 22/11, ordre libre, espaces et emoji", () => {
  const t = `✅ Booking confirmed 🚐
Price:   2,700 thb
Drop-off location:   Krabi Airport ✈️
Pick-up time: 16:30
   Name: Emma   Wilson
Pick-up location: Pimalai Resort
Date: 22/11
Number of passengers: 2 adults + 1 kid + luggage
Flight: FD3217`;
  const r = lireConfirmation(t, { aujourdhui: AJD });
  const v = r.valeurs;
  assert.equal(r.marque, null, "pas de ligne de marque : Taxi par défaut à l'écran");
  assert.equal(v.nom, "Emma Wilson");
  assert.equal(v.date, "2026-11-22");
  assert.equal(v.heure, "16:30");
  assert.equal(v.trajet, "");
  assert.equal(v.dropoff, "Krabi Airport");
  assert.equal(v.adultes, "2");
  assert.equal(v.enfants, "1");
  assert.equal(v.bagages, "Yes");
  assert.equal(v.prix, "2700");
  assert.equal(v.vol, "FD3217");
  assert.deepEqual(r.ignorees, [], "l’en-tête « Booking confirmed » est sauté");
  assert.deepEqual(erreursConfirmation(v), {});
});

test("variante : Secret Travel & Tour, round trip sur sa propre ligne, remarque sur deux lignes", () => {
  const t = `SECRET TRAVEL & TOUR
Name: Family Annet
Date: Feb 17, 2027
Pick-up time: 9am
Pick-up location: Chez Bure - Kanchanaburi
Drop-off location: Old Town and viewpoint
Round trip
Passengers: 2 adults, 1 child (1 child seat), 3 bags
Price: THB 2'400
Remarks: please call on arrival
and wait at the gate`;
  const r = lireConfirmation(t, { aujourdhui: AJD });
  const v = r.valeurs;
  assert.equal(r.marque, "secret");
  assert.equal(v.date, "2027-02-17");
  assert.equal(v.heure, "09:00");
  assert.equal(v.trajet, RETOUR_DEPART);
  assert.equal(v.programme, "Old Town and viewpoint");
  assert.equal(v.adultes, "2");
  assert.equal(v.enfants, "1");
  assert.equal(v.sieges, "1");
  assert.equal(v.bagages, "3");
  assert.equal(v.prix, "2400");
  assert.equal(v.remarques, "please call on arrival and wait at the gate");
  assert.deepEqual(erreursConfirmation(v), {});
});

test("champ manquant : signalé, jamais deviné (pas de prix, pas de passagers, date illisible)", () => {
  const t = `VIP TAXI LANTA
Name: Enzo
Date: next friday
Pick-up time: 4:30pm
Pick-up location: Manao villa
Drop-off location: Saladan pier`;
  const v = lireConfirmation(t, { aujourdhui: AJD }).valeurs;
  assert.equal(v.date, "next friday", "le texte illisible est gardé pour être montré");
  const e = erreursConfirmation(v);
  assert.equal(e.prix, "e_prix");
  assert.equal(e.adultes, "e_passagers");
  assert.equal(e.date, "e_date");
  assert.ok(!e.nom && !e.pickup && !e.dropoff && !e.heure);
  // Prix ambigu (plusieurs nombres) : jamais deviné, signalé.
  const ambigu = lireConfirmation("Name: A\nPrice: 2 cars x 1500 THB", { aujourdhui: AJD }).valeurs;
  assert.equal(ambigu.prix, "2 cars x 1500 THB");
  assert.equal(erreursConfirmation(ambigu).prix, "e_prix");
  assert.equal(lireConfirmation("Price: THB 1,000.50", { aujourdhui: AJD }).valeurs.prix, "1000.5");
  // Un aller-retour sans programme : le programme est demandé.
  const sans = lireConfirmation("Name: A\nDate: 22/11/2026\nPick-up time: 10:00\nPick-up location: Hotel\nDrop-off location: round trip\nPassengers: 2\nPrice: 500", { aujourdhui: AJD }).valeurs;
  assert.equal(sans.trajet, RETOUR_DEPART);
  assert.equal(erreursConfirmation(sans).programme, "e_vide");
});

test("dates : formats courants, sans année l'année en cours, ou la suivante pour une date déjà passée", () => {
  for (const [t, iso] of [
    ["November 22nd 2026", "2026-11-22"], ["Nov 22, 2026", "2026-11-22"], ["22 November 2026", "2026-11-22"], ["Sunday 22nd of November", "2026-11-22"],
    ["22/11", "2026-11-22"], ["22.11.2026", "2026-11-22"], ["2026-11-22", "2026-11-22"], ["22/11/26", "2026-11-22"], ["January 3rd", "2027-01-03"], ["3 janvier", "2027-01-03"],
  ]) assert.equal(lireDate(t, AJD), iso, t);
  assert.equal(lireDate("31/02/2026", AJD), "", "date impossible");
  assert.equal(lireDate("tomorrow", AJD), "");
});

test("heures : 4:30pm, 4.30 pm, 4pm, 12pm, 12am, 16:30, 16h30, 9 am ; rien de deviné sinon", () => {
  for (const [t, h] of [["4:30pm", "16:30"], ["4.30 pm", "16:30"], ["4pm", "16:00"], ["12pm", "12:00"], ["12am", "00:00"], ["16:30", "16:30"], ["16h30", "16:30"], ["9 am", "09:00"], ["around 7:15 AM please", "07:15"]]) assert.equal(lireHeure(t), h, t);
  assert.equal(lireHeure("after lunch"), "");
  assert.equal(lireHeure("25:00"), "");
});

test("passagers et bagages", () => {
  assert.deepEqual(lirePassagers("5 people no luggage"), { adultes: "5", enfants: "", bagages: "", sieges: "" });
  assert.deepEqual(lirePassagers("2 adults + 1 kid + luggage"), { adultes: "2", enfants: "1", bagages: "Yes", sieges: "" });
  assert.deepEqual(lirePassagers("4 pax, 3 bags"), { adultes: "4", enfants: "", bagages: "3", sieges: "" });
  assert.deepEqual(lirePassagers("2 adults, 2 children (1 child seat)"), { adultes: "2", enfants: "2", bagages: "", sieges: "1" });
  assert.deepEqual(lirePassagers("two adults and one baby"), { adultes: "2", enfants: "1", bagages: "", sieges: "" });
  assert.deepEqual(lirePassagers("6 people including 2 kids, 4 suitcases"), { adultes: "4", enfants: "2", bagages: "4", sieges: "" });
  assert.deepEqual(lirePassagers("3"), { adultes: "3", enfants: "", bagages: "", sieges: "" });
});

test("aller-retour et marque", () => {
  assert.deepEqual(lireAllerRetour("Rock bar restaurant (and round trip)"), { retour: true, reste: "Rock bar restaurant" });
  assert.deepEqual(lireAllerRetour("Old Town, round-trip"), { retour: true, reste: "Old Town" });
  assert.deepEqual(lireAllerRetour("Krabi Airport"), { retour: false, reste: "Krabi Airport" });
  assert.equal(lireMarque("VIP TAXI LANTA"), "taxi");
  assert.equal(lireMarque("🚐 Vip Taxi Lanta"), "taxi");
  assert.equal(lireMarque("SECRET TRAVEL & TOUR"), "secret");
  assert.equal(lireMarque("Secret Travel and Tours"), "secret");
  assert.equal(lireMarque("New booking confirmation:"), null);
});

test("entreprise : par la marque et le nom, Taxi par défaut, jamais une entreprise sans droit de création", () => {
  const entites = [
    { id: "ZTP", nom: "Zwald Travel Planner" },
    { id: "SEC", nom: "Secret Travel & Tour" },
    { id: "TAX", nom: "VIP Taxi Lanta" },
  ];
  const reglages = { ZTP: { fonctionnement: "voyages" }, SEC: { fonctionnement: "excursions" }, TAX: { fonctionnement: "taxi" } };
  const tout = ["clients.ecrire", "dossiers.ecrire", "documents.ecrire"];
  const avec = (marque, permissions = () => tout) => entreprisesConfirmation({ entites, reglages: (id) => reglages[id], permissions, marque });
  assert.deepEqual(avec(null).liste.map((e) => e.id), ["SEC", "TAX"], "pas Zwald (voyages sur mesure)");
  assert.equal(avec(null).choisie.id, "TAX");
  assert.equal(avec("taxi").choisie.id, "TAX");
  assert.equal(avec("secret").choisie.id, "SEC");
  // Sans droit de création dans Secret : Secret n'est pas proposé, et une confirmation Secret n'est pas créée dans Taxi d'office.
  const sansSecret = avec("secret", (id) => (id === "SEC" ? ["dossiers.lire"] : tout));
  assert.deepEqual(sansSecret.liste.map((e) => e.id), ["TAX"]);
  assert.equal(sansSecret.choisie, null);
  assert.equal(sansSecret.introuvable, true);
  // Démo : noms « Taxi démo » et « Excursions démo », trouvés par leur façon de travailler.
  const demo = entreprisesConfirmation({ entites: [{ id: "E2", nom: "Excursions démo" }, { id: "E3", nom: "Taxi démo" }], reglages: (id) => ({ E2: { fonctionnement: "excursions" }, E3: { fonctionnement: "taxi" } })[id], permissions: () => tout, marque: "secret" });
  assert.equal(demo.choisie.id, "E2");
});

test("client déjà connu : même WhatsApp, sinon même nom ; le plus récent", () => {
  const clients = [
    { id: "C1", prenom: "", nom: "Enzo", telephone: "", created_at: "2026-10-01" },
    { id: "C2", prenom: "", nom: "Enzo", telephone: "+33612345678", created_at: "2026-11-01" },
    { id: "C3", prenom: "Emma", nom: "Wilson", telephone: "+447700900123", created_at: "2026-09-01" },
  ];
  assert.equal(clientExistant({ nom: "enzo", clients }).id, "C2");
  assert.equal(clientExistant({ nom: "Someone", telephone: "07700 900123", clients }).id, "C3");
  assert.equal(clientExistant({ nom: "Nobody", clients }), null);
});

test("remarque : posée à la création, reprise dans la correction de Mook, changée ou effacée comme saisie (19.11.2026)", () => {
  const x = donneesVoucher({ nom: "A", date: "2026-11-22", pickup: "Hotel", heure: "10:00", dropoff: "Airport", adultes: "2", prix: "500", remarques: "Birthday" });
  const r = { ...reservationApercu(x), id: "R1" };
  assert.equal(r.details.remarques, "Birthday");
  // L'écran de Mook montre la remarque (valeursDepuis) : une correction qui ne la touche pas la garde.
  const garde = donneesVoucher({ ...valeursDepuis(r, { nom: "A" }), heure: "11:00" });
  assert.equal(correctionReservation(r, garde).details.remarques, "Birthday");
  assert.equal(correctionReservation(r, { ...garde, remarques: "50th birthday" }).details.remarques, "50th birthday");
  assert.equal("remarques" in correctionReservation(r, { ...garde, remarques: "" }).details, false);
});

test("création commune : l'écran de Mook et la confirmation collée passent par creation-course.mjs", () => {
  const lire = (f) => readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");
  assert.match(lire("views/voucher-rapide.mjs"), /import \{ creerCourse, courseDuDossier, majClientCourse \} from "\.\/creation-course\.mjs"/);
  assert.match(lire("views/confirmation.mjs"), /import \{ creerCourse \} from "\.\/creation-course\.mjs"/);
  assert.doesNotMatch(lire("views/voucher-rapide.mjs"), /creerDossierExcursions/);
  // Le « + » ne la propose qu'aux administratrices et à l'administratrice générale (règle commune dans etat.mjs).
  assert.match(lire("etat.mjs"), /const confirmationPermise = \(\) => !!etat\.brut && \(estSuperAdmin\(\) \|\| estAdmin\(\)\)/);
});

// ---- Trouver l'outil sur ordinateur, et la bascule depuis « Coller une demande » (18.11.2026) -------------------------------------
test("bascule : une confirmation collée dans « Coller une demande » est reconnue, une demande de client ne l'est jamais", async () => {
  const { ressembleAConfirmation } = await import("../src/gestion/js/confirmation-calc.mjs");
  assert.equal(ressembleAConfirmation(JEREMY, { aujourdhui: AJD }), true, "le texte de Jérémy");
  assert.equal(ressembleAConfirmation("SECRET TRAVEL & TOUR\nName: Family Annet\nDate: 17/02/2027", { aujourdhui: AJD }), true, "marque et deux libellés");
  assert.equal(ressembleAConfirmation("Name: Enzo\nDate: 22/11\nPick-up time: 4pm\nPick-up location: Manao villa\nPrice: 1000 THB", { aujourdhui: AJD }), true, "libellés de course et prix, sans marque");
  // Demandes : un message de client, une demande du site (taxi et excursion), jamais une confirmation.
  assert.equal(ressembleAConfirmation("Hi! Can you pick us up at Krabi airport on the 22nd at 4pm? We are 5 people. How much?", { aujourdhui: AJD }), false);
  assert.equal(ressembleAConfirmation(["Transfer request: Krabi Airport → Koh Lanta", "Date: Sat 22 Nov 2026", "Pickup time: 14:30 (landing)", "Guests: 2 adults, 1 child (age 5)", "Pickup: Krabi Airport (KBV)", "Drop-off: Lanta Sand Resort", "Name: Paul Martin"].join("\n"), { aujourdhui: AJD }), false);
  assert.equal(ressembleAConfirmation(["Booking request: 4 Islands – Longtail", "Date: Sat 22 Nov 2026", "Guests: 2 adults", "Pickup: Lanta Sand Resort", "Name: Paul Martin", "Estimated total: 3,000 THB"].join("\n"), { aujourdhui: AJD }), false);
  // Quatre libellés sans prix (une demande écrite à la main) : pas de bascule proposée.
  assert.equal(ressembleAConfirmation("Name: Enzo\nDate: 22/11\nPick-up time: 4pm\nPick-up location: Manao villa", { aujourdhui: AJD }), false);
  assert.equal(ressembleAConfirmation("", { aujourdhui: AJD }), false);
});

test("ordinateur : « Coller une confirmation » à côté de « Coller une demande », dans la recherche et au clavier, mêmes règles qu'au téléphone", () => {
  const lire = (f) => readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");
  // Une seule règle, dans etat.mjs, pour le « + », les boutons d'en-tête, la recherche et le raccourci.
  assert.match(lire("etat.mjs"), /export const confirmationPermise = \(\) => !!etat\.brut && \(estSuperAdmin\(\) \|\| estAdmin\(\)\)/);
  for (const f of ["views/dashboard.mjs", "views/dossiers.mjs"]) assert.match(lire(f), /tr\("Coller une demande"\)\) : null, boutonConfirmation\(\), h\("a"/, f);
  assert.match(lire("views/commun.mjs"), /export const boutonConfirmation = \(\) =>\s+confirmationPermise\(\)\s+\? h\("button", \{ class: "secondaire seulement-bureau"/);
  const app = lire("app.mjs");
  assert.match(app, /confirmationPermise\(\) \? choix\("whatsapp", tr\("Coller une confirmation"\)/, "le « + » du téléphone");
  assert.match(app, /k === "b" && confirmationPermise\(\)/, "raccourci « b »");
  assert.match(app, /confirmationPermise\(\) \? \[actionConfirmation\(\)\]/, "recherche sans saisie");
  assert.match(app, /if \(r\.action\) return void r\.action\(\);/, "une action de la recherche ouvre sa fenêtre");
  // La bascule propose, ne crée rien : elle ouvre la fenêtre avec le texte, seulement pour qui y a droit, jamais pour une demande du site.
  const demande = lire("views/demande.mjs");
  assert.match(demande, /const oui = !depuisSite && confirmationPermise\(\) && ressembleAConfirmation\(texte/);
  assert.match(demande, /\(await import\("\.\/confirmation\.mjs"\)\)\.ouvrirConfirmation\(t\)/);
  assert.match(lire("views/confirmation.mjs"), /export function ouvrirConfirmation\(texteInitial = ""\)/);
});

// ---- Fiche du client sans WhatsApp, fiches ZTP partagées (18.11.2026, après la PR 234) -------------------------------------------
test("client : même WhatsApp -> choisi d'office ; sinon même nom -> proposé sans présélection (homonyme, Varrin)", async () => {
  const { clientsCandidats, reperesClient, whatsappMasque, villeDe, nomARemplacer } = await import("../src/gestion/js/confirmation-calc.mjs");
  const TAXI = "TAX";
  const ZTP = "ZTP";
  const propres = [
    { id: "T1", entite_id: TAXI, prenom: "", nom: "Varrin", telephone: "", created_at: "2026-10-01" },
    { id: "T2", entite_id: TAXI, prenom: "Emma", nom: "Wilson", telephone: "+447700900123", created_at: "2026-09-01" },
  ];
  const partages = [
    { id: "Z1", entite_id: ZTP, prenom: "Jean", nom: "Varrin", telephone: "+33 6 12 34 56 78", adresse: "12 rue du Lac\n1000 Lausanne", created_at: "2026-05-01" },
    { id: "Z2", entite_id: ZTP, prenom: "Emma", nom: "Wilson", telephone: "+41 79 000 11 22", adresse: "", created_at: "2026-06-01" },
  ];
  const dossiers = [{ id: "D1", client_id: "Z1", ref: "JV20260611 Thaïlande", date_depart: "2026-06-11", created_at: "2026-05-02" }];
  // Varrin, sans WhatsApp : la fiche Taxi « Varrin » et la fiche ZTP « Jean Varrin » sont proposées, aucune choisie.
  const varrin = clientsCandidats({ nom: "Varrin", telephone: "", propres, partages, dossiers });
  assert.equal(varrin.parTelephone, null);
  assert.deepEqual(varrin.parNom.map((c) => c.id).sort(), ["T1", "Z1"]);
  // Homonyme : « Emma Wilson » existe dans Taxi et dans ZTP, avec des numéros différents ; sans numéro collé, les deux sont proposées.
  assert.deepEqual(clientsCandidats({ nom: "emma  WILSON", propres, partages, dossiers }).parNom.map((c) => c.id).sort(), ["T2", "Z2"]);
  // « Wilson Emma » (nom puis prénom) aussi.
  assert.equal(clientsCandidats({ nom: "Wilson Emma", propres, partages }).parNom.length, 2);
  // Même WhatsApp : la fiche est retrouvée (ici la ZTP) et choisie d'office, sans liste par le nom.
  const tel = clientsCandidats({ nom: "Emma Wilson", telephone: "+41790001122", propres, partages, dossiers });
  assert.equal(tel.parTelephone.id, "Z2");
  assert.deepEqual(tel.parNom, []);
  // Même numéro dans l'entreprise et dans ZTP : la fiche de l'entreprise passe devant.
  const double = clientsCandidats({ nom: "", telephone: "+41790001122", propres: [{ id: "T9", entite_id: TAXI, nom: "Emma", telephone: "+41 79 000 11 22", created_at: "2026-01-01" }], partages, dossiers });
  assert.equal(double.parTelephone.id, "T9");
  // Un numéro inconnu ne choisit rien : on retombe sur les fiches au même nom, non présélectionnées.
  assert.equal(clientsCandidats({ nom: "Emma Wilson", telephone: "+66 81 999 0000", propres, partages }).parTelephone, null);
  // Rien en commun : rien de proposé.
  assert.deepEqual(clientsCandidats({ nom: "Nobody", propres, partages }), { parTelephone: null, parNom: [] });
  // Repères : étiquette, WhatsApp masqué, ville sans code postal, dernier dossier.
  assert.deepEqual(reperesClient(partages[0], { dossiers, sigle: "ZTP" }), { sigle: "ZTP", whatsapp: "+33 ••• 5678", ville: "Lausanne", dernier: { ref: "JV20260611 Thaïlande", date: "2026-06-11" } });
  assert.equal(whatsappMasque(""), "");
  assert.equal(villeDe("Villa Demo"), "", "une adresse d'une ligne ne donne pas de ville");
  assert.equal(villeDe("Rue du Lac 12\n1204 Genève, Suisse"), "Genève, Suisse");
  assert.equal(villeDe("12 rue du Lac, 1000 Lausanne"), "Lausanne");
  // La fiche choisie garde son nom le plus complet : « Varrin » ne renomme pas « Jean Varrin ».
  assert.equal(nomARemplacer("Jean Varrin", "Varrin"), false);
  assert.equal(nomARemplacer("Emma Wilsn", "Emma Wilson"), true);
  assert.equal(nomARemplacer("Emma Wilson", "emma wilson"), false);
});

test("client : l'écran demande un choix quand des fiches au même nom sont proposées ; les fiches ZTP restent réservées à l'administration", () => {
  const lire = (f) => readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");
  const ecran = lire("views/confirmation.mjs");
  assert.match(ecran, /candidats\.parNom\.map\(\(c\) => ligneClient\(c, id, false\)\)/, "aucune fiche au même nom n'est cochée");
  assert.match(ecran, /ligneClient\(candidats\.parTelephone, id, true\)/, "même WhatsApp : cochée");
  assert.match(ecran, /if \(fichesAffichees && !choixClient\(\)\)/, "création refusée tant que rien n'est choisi");
  // Les fiches partagées viennent de clientsPartages (règle de la PR 234 : administratrices seulement, jamais Mook).
  assert.match(ecran, /partages: clientsPartages\(id\)/);
  assert.match(lire("views/creation-course.mjs"), /nomARemplacer\(\[c\.prenom, c\.nom\]/);
});
