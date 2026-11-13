// Écran « Nouveau voucher » de VIP Taxi Lanta (12.11.2026) : contrôle de la saisie en thaï, ce qui est créé, droits de l'assistante.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TH, CHAMPS, contientThai, prixSaisi, valeursVides, erreursVoucher, donneesVoucher, ligneVoucher, reservationVoucher, reservationApercu, correctionReservation, valeursDepuis, suggestionsLieux, mesVouchers, dateCourteTh, DROIT_VOUCHER_SEUL } from "../src/gestion/js/voucher-rapide-calc.mjs";
import { PERMISSIONS, TOUTES_PERMISSIONS, DEPENDANCES, ROLES_SYSTEME, donneesDemo } from "../src/gestion/js/defauts.mjs";
import { permissionsDans } from "../src/gestion/js/droits.mjs";
import { reservationsDepuisDocument } from "../src/gestion/js/operations-calc.mjs";
import { champsBooking, contenuCourse } from "../src/gestion/js/taxi-calc.mjs";

const bon = { nom: "Emma Wilson", date: "2026-11-14", pickup: "Pimalai Resort", heure: "14:30", dropoff: "Krabi Airport", adultes: "2", enfants: "1", bagages: "3", prix: "2,700" };

test("chaque texte de l'écran existe en thaï, chaque erreur a son texte", () => {
  for (const [cle, texte] of Object.entries(TH)) assert.ok(String(texte).trim(), `texte vide : ${cle}`);
  const codes = new Set();
  for (const v of [valeursVides(), { ...bon, nom: "เอ็มมา", adultes: "0", enfants: "x", prix: "abc", date: "14/11", heure: "", bagages: "สองใบ" }]) for (const c of Object.values(erreursVoucher(v))) codes.add(c);
  for (const c of codes) assert.ok(TH[c], `erreur sans texte thaï : ${c}`);
});

test("saisie complète : aucune erreur ; champs vides : une erreur sous chacun, dans l'ordre du voucher", () => {
  assert.deepEqual(erreursVoucher(bon), {});
  const e = erreursVoucher(valeursVides());
  assert.deepEqual(Object.keys(e).sort(), ["date", "dropoff", "heure", "nom", "pickup", "prix"].sort());
  assert.deepEqual(CHAMPS, ["nom", "date", "pickup", "heure", "dropoff", "vol", "adultes", "enfants", "bagages", "sieges", "prix"]);
});

test("le voucher est en anglais : un mot thaï dans un champ imprimé est refusé", () => {
  assert.equal(contientThai("โรงแรม Pimalai"), true);
  assert.equal(contientThai("Pimalai Resort"), false);
  const e = erreursVoucher({ ...bon, pickup: "โรงแรมพิมาลัย", bagages: "3 ใบ" });
  assert.equal(e.pickup, "e_thai");
  assert.equal(e.bagages, "e_thai");
  assert.equal(e.nom, undefined);
});

test("passagers : au moins un adulte, des nombres entiers ; enfants et bagages facultatifs", () => {
  assert.equal(erreursVoucher({ ...bon, adultes: "0" }).adultes, "e_adultes");
  assert.equal(erreursVoucher({ ...bon, adultes: "deux" }).adultes, "e_nombre");
  assert.equal(erreursVoucher({ ...bon, enfants: "1.5" }).enfants, "e_nombre");
  assert.deepEqual(erreursVoucher({ ...bon, enfants: "", bagages: "" }), {});
  assert.deepEqual(erreursVoucher({ ...bon, bagages: "2 big + 1 surfboard" }), {}, "les bagages restent un texte court en anglais");
});

test("prix : tapé comme on veut, lu comme un nombre positif", () => {
  assert.equal(prixSaisi("2,700"), 2700);
  assert.equal(prixSaisi("2'700"), 2700);
  assert.equal(prixSaisi("2 700"), 2700);
  assert.equal(prixSaisi("2700 บาท"), 2700);
  assert.equal(prixSaisi("1500.50"), 1500.5);
  assert.equal(prixSaisi("12,5"), 12.5);
  assert.equal(prixSaisi("0"), null);
  assert.equal(prixSaisi("-50"), null);
  assert.equal(prixSaisi("abc"), null);
  assert.equal(prixSaisi(""), null);
});

test("ce qui est créé : une course libre payée au chauffeur, prix pour le véhicule, personnes de la saisie", () => {
  const x = donneesVoucher({ ...bon, nom: "  Emma   Wilson " });
  assert.equal(x.nom, "Emma Wilson");
  assert.equal(x.libelle, "Pimalai Resort → Krabi Airport");
  const l = ligneVoucher(x, { id: "L1", partenaireId: "P" });
  assert.equal(l.paye_sur_place, true);
  assert.equal(l.unite, 2700);
  assert.equal(l.qte, 1);
  // La ligne donne bien une réservation (libre, du partenaire), au prix saisi, sans compter la quantité comme une personne.
  const [res] = reservationsDepuisDocument({ dossier_id: "D", contenu: { lignes: [l] } }, { uid: () => "R" });
  assert.equal(res.reservation.partenaire_id, "P");
  assert.equal(res.reservation.montant_vente, 2700);
  assert.equal(res.reservation.paye_sur_place, true);
  assert.equal(res.reservation.date_service, "2026-11-14");
  assert.deepEqual(res.reservation.personnes, { adultes: 0, enfants: 0, bebes: 0 });
  assert.deepEqual(reservationVoucher(x), { heure: "14:30", lieu: "Pimalai Resort", dropoff: "Krabi Airport", vol: "", bagages: "3", sieges: 0, personnes: { adultes: 2, enfants: 1 } });
});

test("aperçu : la Booking confirmation lit les champs saisis tels quels", () => {
  const x = donneesVoucher(bon);
  const r = reservationApercu(x);
  const champs = Object.fromEntries(champsBooking({ nom: x.nom, date: r.date_service, pickup: r.lieu_pickup, heure: r.heure_pickup, dropoff: r.details.drop_off, personnes: r.personnes, bagages: r.details.bagages, montant: r.montant_vente }).map((c) => [c.cle, c.valeur]));
  assert.equal(champs.NAME, "Emma Wilson");
  assert.equal(champs.DATE, "November 14th 2026");
  assert.equal(champs["PICK UP LOCATION"], "Pimalai Resort");
  assert.equal(champs["PICK UP TIME"], "2:30 pm");
  assert.equal(champs["DROP OFF LOCATION"], "Krabi Airport");
  assert.equal(champs.PASSENGERS, "2 adults, 1 child + 3 pieces of luggage");
  assert.equal(champs["TOTAL PRICE"], "2'700 THB (all fees included)");
});

test("correction : seuls les champs changés partent, et le prix interne suit", () => {
  const r = { id: "R", ligne_id: "L1", libelle: "Pimalai Resort → Krabi Airport", date_service: "2026-11-14", heure_pickup: "14:30", lieu_pickup: "Pimalai Resort", montant_vente: 2700, personnes: { adultes: 2, enfants: 1, bebes: 0 }, details: { drop_off: "Krabi Airport", bagages: "3" } };
  assert.equal(correctionReservation(r, donneesVoucher(bon)), null, "rien de changé, rien à écrire");
  const suite = correctionReservation(r, donneesVoucher({ ...bon, heure: "15:00", prix: "3000", bagages: "" }));
  assert.equal(suite.heure_pickup, "15:00");
  assert.equal(suite.montant_vente, 3000);
  assert.equal(suite.details.bagages, undefined, "bagages effacés");
  const contenu = contenuCourse({ lignes: [{ id: "L1", kind: "ligne", unite: 2700, qte: 1, date_service: "2026-11-14", paye_sur_place: true }] }, { ...r, ...suite });
  assert.equal(contenu.lignes[0].unite, 3000);
  // Aller-retour : le formulaire se rouvre avec les valeurs du voucher.
  const v = valeursDepuis(r, { prenom: "", nom: "Emma Wilson" });
  assert.deepEqual(erreursVoucher(v), {});
  assert.equal(correctionReservation(r, donneesVoucher(v)), null);
  assert.equal(valeursDepuis({ ...r, heure_pickup: "9:05" }).heure, "09:05", "le sélecteur d'heure veut deux chiffres");
});

test("lieux suggérés : ceux déjà saisis d'abord, puis les destinations du catalogue, sans les excursions ni le thaï", () => {
  const prestations = [{ libelle: "Krabi Airport" }, { libelle: "Koh Lanta to Khao Lak" }, { libelle: "Full-day trip, visa run (Malaysian border)" }, { libelle: "Ao Nang", actif: false }];
  const reservations = [{ created_at: "2026-11-10", lieu_pickup: "Pimalai Resort", details: { drop_off: "krabi airport" } }, { created_at: "2026-11-11", lieu_pickup: "โรงแรม", details: {} }];
  assert.deepEqual(suggestionsLieux(prestations, reservations), ["Pimalai Resort", "krabi airport", "Koh Lanta", "Khao Lak"]);
});

test("derniers vouchers : seulement ceux des dossiers créés par la personne, du plus récent au plus ancien", () => {
  const dossiers = [{ id: "D1", cree_par: "mook", client_id: "C1" }, { id: "D2", cree_par: "anais", client_id: "C2" }, { id: "D3", cree_par: "mook", client_id: "C3", annule: true }];
  const reservations = [{ id: "R1", dossier_id: "D1", created_at: "2026-11-10" }, { id: "R2", dossier_id: "D2", created_at: "2026-11-12" }, { id: "R3", dossier_id: "D3", created_at: "2026-11-11" }];
  const liste = mesVouchers({ reservations, dossiers, clients: [{ id: "C1", nom: "Emma" }], moi: "mook" });
  assert.deepEqual(liste.map((v) => v.reservation.id), ["R3", "R1"]);
  assert.equal(liste[0].annule, true);
  assert.equal(liste[1].client.nom, "Emma");
  assert.equal(dateCourteTh("2026-11-14"), "14 พ.ย.");
});

test("droit « vouchers.seul » : choisi rôle par rôle, jamais dans « tous les droits » ni pour l'administratrice générale", () => {
  assert.ok(PERMISSIONS.some((p) => p.code === DROIT_VOUCHER_SEUL), "proposé dans l'écran des rôles");
  assert.ok(!TOUTES_PERMISSIONS.includes(DROIT_VOUCHER_SEUL));
  assert.ok(!ROLES_SYSTEME.some((r) => r.permissions.includes(DROIT_VOUCHER_SEUL)));
  const profil = { user_id: "A", super_admin: true, actif: true };
  assert.ok(!permissionsDans({ profil, membres: [], roles: [] }, "E").includes(DROIT_VOUCHER_SEUL));
  // Ce qu'il faut pour créer client, dossier, prix interne et réservation, sans nets ni réglages.
  const requis = DEPENDANCES[DROIT_VOUCHER_SEUL];
  for (const c of ["clients.ecrire", "dossiers.ecrire", "documents.ecrire", "partenaires.lire"]) assert.ok(requis.includes(c), c);
  for (const c of ["partenaires.nets", "reglages.ecrire", "paiements.ecrire"]) assert.ok(!requis.includes(c), c);
});

test("démo : l'assistante taxi n'a que le voucher et les factures fiduciaire dans Taxi, toutes les courses, et reste éditrice dans Excursions", () => {
  const ajouterJours = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
  const data = donneesDemo("2026-11-12", ajouterJours);
  const mook = data.profils.find((p) => p.email === "vouchers@demo.local");
  const taxi = data.entites.find((e) => e.slug === "taxi");
  const excursions = data.entites.find((e) => e.slug === "excursions");
  const ctx = { profil: mook, membres: data.membres, roles: data.roles };
  const pTaxi = permissionsDans(ctx, taxi.id);
  assert.ok(pTaxi.includes(DROIT_VOUCHER_SEUL));
  assert.ok(!pTaxi.includes("partenaires.nets"));
  // Les factures fiduciaire de Taxi sont son travail (Jérémy, 12.11.2026) : elle voit toutes les courses de Taxi, jamais les nets ni les avoirs.
  assert.equal(data.roles.find((r) => r.permissions.includes(DROIT_VOUCHER_SEUL)).portee, "toute");
  assert.ok(pTaxi.includes("fiduciaire.preparer"));
  assert.ok(!pTaxi.includes("fiduciaire.gerer"));
  assert.ok(!permissionsDans(ctx, excursions.id).includes(DROIT_VOUCHER_SEUL));
  for (const c of DEPENDANCES[DROIT_VOUCHER_SEUL]) assert.ok(pTaxi.includes(c), `rôle de démo sans ${c}`);
});

test("sièges enfant ou bébé et numéro de vol (13.11.2026) : saisis par Mook, imprimés sur la Booking confirmation", () => {
  const v = { ...bon, vol: " fd 3217 ", sieges: "1" };
  assert.deepEqual(erreursVoucher(v), {});
  assert.equal(erreursVoucher({ ...v, sieges: "2" }).sieges, "e_sieges", "plus de sièges que d'enfants");
  assert.equal(erreursVoucher({ ...v, sieges: "un" }).sieges, "e_nombre");
  assert.equal(erreursVoucher({ ...v, vol: "เที่ยวบิน" }).vol, "e_thai");
  const x = donneesVoucher(v);
  assert.equal(x.vol, "fd 3217");
  assert.equal(x.sieges, 1);
  const r = reservationApercu(x);
  assert.deepEqual(r.details, { drop_off: "Krabi Airport", bagages: "3", vol: "fd 3217", sieges: 1 });
  const champs = Object.fromEntries(champsBooking({ nom: x.nom, date: r.date_service, pickup: r.lieu_pickup, heure: r.heure_pickup, dropoff: r.details.drop_off, personnes: r.personnes, bagages: r.details.bagages, sieges: r.details.sieges, vol: r.details.vol, montant: r.montant_vente }).map((c) => [c.cle, c.valeur]));
  assert.equal(champs.PASSENGERS, "2 adults, 1 child (1 child seat) + 3 pieces of luggage");
  assert.equal(champs["PICK UP LOCATION"], "Pimalai Resort", "le vol va avec l'aéroport, pas avec l'hôtel");
  assert.equal(champs["DROP OFF LOCATION"], "Krabi Airport, flight fd 3217");
  // Correction : le vol et les sièges se corrigent et s'effacent comme les bagages ; le formulaire se rouvre avec eux.
  const res = { id: "R", libelle: x.libelle, date_service: x.date, heure_pickup: x.heure, lieu_pickup: x.pickup, montant_vente: x.prix, personnes: { adultes: 2, enfants: 1, bebes: 0 }, details: r.details };
  assert.equal(correctionReservation(res, donneesVoucher(valeursDepuis(res, { nom: "Emma Wilson" }))), null);
  const vide = correctionReservation(res, donneesVoucher({ ...v, vol: "", sieges: "" }));
  assert.equal(vide.details.vol, undefined);
  assert.equal(vide.details.sieges, undefined);
});
