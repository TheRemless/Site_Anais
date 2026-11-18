// tests/gestion-voucher-logo.test.js : logo du voucher de Mook (Jérémy, 18.11.2026). VIP Taxi Lanta par défaut (Mr. Brown) ou Secret Travel & Tour
// (taxi indépendant, sans partenaire) : le dossier, la course et le voucher vont dans l'entreprise du logo, avec ses réglages et ses droits.
import test from "node:test";
import assert from "node:assert/strict";

// Un DOM minimal : de quoi rendre le voucher de Secret (ui.mjs n'utilise que createElement, createTextNode et append).
class Node {}
class Texte extends Node {
  constructor(t) {
    super();
    this.t = t;
  }
  get textContent() {
    return this.t;
  }
}
class El extends Node {
  constructor(tag) {
    super();
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.className = "";
  }
  append(...xs) {
    this.children.push(...xs);
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener() {}
  get textContent() {
    return this.children.map((c) => c.textContent).join("");
  }
  get lignes() {
    return ["p", "h1", "h2"].includes(this.tag) ? [this.textContent] : this.children.flatMap((c) => (c instanceof El ? c.lignes : []));
  }
}
globalThis.Node = Node;
globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => new Texte(t) };

const V = await import("../src/gestion/js/voucher-rapide-calc.mjs");
const { donneesDemo } = await import("../src/gestion/js/defauts.mjs");
const { permissionsDans } = await import("../src/gestion/js/droits.mjs");
const { renderVoucher } = await import("../src/gestion/js/views/voucher.mjs");
const { cibleAgence } = await import("../src/gestion/js/fiduciaire-calc.mjs");

const ajouterJours = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
const bon = { nom: "Emma Wilson", date: "2026-11-21", pickup: "Pimalai Resort", heure: "09:30", dropoff: "Saladan Speedboat Pier", adultes: "2", enfants: "", bagages: "3", prix: "600" };

// ---- Entreprises proposées --------------------------------------------------------------------------------------------------
test("logos proposés : l'entreprise Taxi d'abord, puis celles en mode excursions où la personne crée clients, dossiers et documents", () => {
  const entites = [
    { id: "ZTP", nom: "Zwald Travel Planner", actif: true },
    { id: "SEC", nom: "Secret Travel & Tour", actif: true },
    { id: "TAX", nom: "VIP Taxi Lanta", actif: true },
    { id: "AUT", nom: "Autre taxi", actif: true },
    { id: "OFF", nom: "Excursions fermées", actif: false },
  ];
  const reglages = { ZTP: { fonctionnement: "voyages" }, SEC: { fonctionnement: "excursions" }, TAX: { fonctionnement: "taxi" }, AUT: { fonctionnement: "taxi" }, OFF: { fonctionnement: "excursions" } };
  const tout = ["clients.ecrire", "dossiers.ecrire", "documents.ecrire", "dossiers.lire"];
  const liste = V.entreprisesVoucher({ entites, origine: "TAX", permissions: () => tout, reglages: (id) => reglages[id] });
  assert.deepEqual(liste, [{ id: "TAX", nom: "VIP Taxi Lanta" }, { id: "SEC", nom: "Secret Travel & Tour" }], "ni Zwald (voyages), ni un autre taxi, ni une entreprise fermée");
  // Un seul droit manquant dans Secret (lecture seule, par exemple) : pas de logo Secret, l'écran reste comme avant.
  for (const manque of V.DROITS_CREATION_VOUCHER) {
    const sans = V.entreprisesVoucher({ entites, origine: "TAX", permissions: (id) => (id === "SEC" ? tout.filter((d) => d !== manque) : tout), reglages: (id) => reglages[id] });
    assert.deepEqual(sans.map((e) => e.id), ["TAX"], manque);
  }
  assert.deepEqual(V.entreprisesVoucher({ entites, origine: "INCONNUE", permissions: () => tout, reglages: (id) => reglages[id] }), []);
});

test("démo comme en production : Mook a les deux logos, Taxi puis Excursions ; ses droits dans Excursions ne changent pas", () => {
  const data = donneesDemo("2026-11-18", ajouterJours);
  const mook = data.profils.find((p) => p.email === "vouchers@demo.local");
  const taxi = data.entites.find((e) => e.slug === "taxi");
  const excursions = data.entites.find((e) => e.slug === "excursions");
  const ctx = { profil: mook, membres: data.membres, roles: data.roles };
  const liste = V.entreprisesVoucher({ entites: data.entites, origine: taxi.id, permissions: (id) => permissionsDans(ctx, id), reglages: (id) => data.reglages[id] });
  assert.deepEqual(liste.map((e) => e.id), [taxi.id, excursions.id]);
  // Rien de plus ne lui est ouvert : ni nets, ni prix de vente, ni écran voucher dans Excursions.
  const p = permissionsDans(ctx, excursions.id);
  for (const d of ["partenaires.nets", "partenaires.prix", "reglages.ecrire", V.DROIT_VOUCHER_SEUL]) assert.ok(!p.includes(d), d);
});

// ---- Ce qui est créé sous le logo de Secret -----------------------------------------------------------------------------------
test("Secret : course d'un taxi indépendant, payée au chauffeur, confirmée, modèle Transfer et Private Taxi ; Taxi ne change pas", () => {
  const x = V.donneesVoucher(bon);
  const sec = V.reservationVoucher(x, { independant: true });
  assert.equal(sec.statut, "confirme");
  assert.deepEqual(sec.details, { taxi_independant: true, type_transfert: "taxi", modele_voucher: "transfert" });
  const apercu = V.reservationApercu(x, { independant: true });
  assert.equal(apercu.paye_sur_place, true);
  assert.equal(apercu.details.taxi_independant, true);
  assert.equal(apercu.details.modele_voucher, "transfert", "jamais un billet de bateau déduit de « Speedboat Pier »");
  // Pas de partenaire : la ligne de prix interne est payée sur place, sans partenaire.
  const ligne = V.ligneVoucher(x, { id: "L1", partenaireId: null });
  assert.equal(ligne.partenaire_id, null);
  assert.equal(ligne.paye_sur_place, true);
  // Taxi : exactement comme avant (aucun détail en plus sur un aller simple).
  assert.equal(V.reservationVoucher(x).details, undefined);
  assert.ok(!("taxi_independant" in V.reservationApercu(x).details));
  // Retour au point de départ sous le logo de Secret : les deux détails se cumulent.
  const retour = V.reservationVoucher(V.donneesVoucher({ ...bon, trajet: "retour_depart", programme: "Old Town tour", duree: "3", dropoff: "" }), { independant: true });
  assert.equal(retour.details.type_trajet, "retour_depart");
  assert.equal(retour.details.taxi_independant, true);
  // Une correction garde le marquage (les détails de la course sont repris).
  const r = { ...V.reservationApercu(x, { independant: true }), id: "R1" };
  const corr = V.correctionReservation(r, { ...x, heure: "10:00" });
  assert.equal(corr.details.taxi_independant, true);
  assert.equal(corr.details.modele_voucher, "transfert");
});

const SECRET = { emetteur: { nom: "Secret Travel & Tour", adresse: "Saladan, Koh Lanta", telephone: "+66 00 000 0001", licence: "33/00000" }, apparence: { logo: "logo-secret.webp" }, voucher: {}, devise: "THB", fonctionnement: "excursions" };
const TAXI = { emetteur: { nom: "VIP Taxi Lanta", adresse: "", telephone: "+66 00 000 0002" }, apparence: { logo: "logo-taxi.webp" }, voucher: {}, devise: "THB", fonctionnement: "taxi" };
const rendu = (r, regl, ref = "EX-2026-0124") => renderVoucher({ reservation: r, prestation: null, type: "transfert", index: 1 }, { reglages: regl, dossier: { ref }, client: { prenom: "", nom: "Emma Wilson", telephone: "+44 7700 900123" }, resume: null, trajet: null });

test("voucher Secret : logo, nom et coordonnées de Secret, numéro du dossier, rien de VIP Taxi ni de ligne Operator vide", () => {
  const r = { ...V.reservationApercu(V.donneesVoucher(bon), { independant: true }), id: "R1", dossier_id: "D1" };
  const v = rendu(r, SECRET);
  const l = v.lignes;
  const texte = l.join("\n");
  assert.ok(l.includes("Transfer Voucher"), texte);
  assert.ok(l.includes("Secret Travel & Tour"), texte);
  assert.match(v.textContent, /Voucher No\.: EX-2026-0124-1/, "le numéro du dossier, pas « -1 »");
  assert.ok(!/VIP Taxi|Mr\. Brown|Booking confirmation/i.test(texte), texte);
  assert.ok(!l.some((x) => /Operator/.test(x)), "pas de ligne Operator vide pour un taxi indépendant");
  assert.ok(l.some((x) => /Transfer Type: ☒ Private Taxi ☐ Private Minivan/.test(x)), texte);
  assert.ok(l.some((x) => /Pay Driver Directly/.test(x)), texte);
  // Le logo est celui des réglages de Secret.
  const images = [];
  const chercher = (n) => (n instanceof El ? (n.tag === "img" && images.push(n.attrs.src), n.children.forEach(chercher)) : null);
  chercher(v);
  assert.deepEqual(images, ["logo-secret.webp"]);
  // Le même service sans le marquage (un transfert de Secret saisi à la main) garde sa ligne Operator à compléter.
  const manuel = rendu({ ...r, details: { drop_off: "Saladan Speedboat Pier" } }, SECRET).lignes;
  assert.ok(manuel.some((x) => /Operator/.test(x)));
});

test("voucher Taxi : la Booking confirmation de VIP Taxi Lanta, sans rien de Secret", () => {
  const r = { ...V.reservationApercu(V.donneesVoucher(bon)), id: "R2", dossier_id: "D2" };
  const l = rendu(r, TAXI, "TX-2026-0001").lignes.join("\n");
  assert.match(l, /BOOKING/);
  assert.ok(!/Secret Travel/.test(l));
});

// ---- Liste des derniers vouchers -----------------------------------------------------------------------------------------
test("derniers vouchers : ceux de Taxi et de Secret ensemble, chacun avec son entreprise ; jamais ceux d'une autre", () => {
  const dossiers = [
    { id: "D1", entite_id: "TAX", cree_par: "mook", client_id: "C1" },
    { id: "D2", entite_id: "SEC", cree_par: "mook", client_id: "C2" },
    { id: "D3", entite_id: "ZTP", cree_par: "mook", client_id: "C3" },
    { id: "D4", entite_id: "SEC", cree_par: "anais", client_id: "C4" },
  ];
  const reservations = [
    { id: "R1", dossier_id: "D1", created_at: "2026-11-18T08:00:00Z" },
    { id: "R2", dossier_id: "D2", created_at: "2026-11-18T09:00:00Z" },
    { id: "R3", dossier_id: "D3", created_at: "2026-11-18T10:00:00Z" },
    { id: "R4", dossier_id: "D4", created_at: "2026-11-18T11:00:00Z" },
  ];
  const clients = [{ id: "C1", nom: "Taxi" }, { id: "C2", nom: "Secret" }];
  const liste = V.mesVouchers({ reservations, dossiers, clients, moi: "mook", entites: ["TAX", "SEC"] });
  assert.deepEqual(liste.map((v) => [v.reservation.id, v.entite_id, v.client.nom]), [["R2", "SEC", "Secret"], ["R1", "TAX", "Taxi"]]);
  // Sans liste d'entreprises (appel d'avant), rien ne change : toutes celles qu'on lui donne.
  assert.equal(V.mesVouchers({ reservations, dossiers, clients, moi: "mook" }).length, 3);
});

// ---- Contrôles en aval -------------------------------------------------------------------------------------------------------
test("fiduciaire de Secret : une course payée au chauffeur n'est facturée qu'une fois une commission reçue, jamais d'office", () => {
  const c = cibleAgence({ statut: "confirme", paye_sur_place: true, montant_vente: 600 }, { commission_prevue: null, commission_recue: null }, null, 0);
  assert.equal(c.pret, false);
  assert.deepEqual(c.manque, ["commission_non_recue"]);
});

test("À vérifier de Secret : une course sans partenaire ne demande ni net ni commission", async () => {
  const { aVerifier } = await import("../src/gestion/js/a-verifier-calc.mjs");
  const db = {
    dossiers: [{ id: "D2", ref: "EX-2026-0124", client_id: "C2", annule: false, responsable_id: "mook" }],
    clients: [{ id: "C2", prenom: "", nom: "Emma Wilson", telephone: "+447700900123", email: "" }],
    reservations: [{ id: "R2", dossier_id: "D2", partenaire_id: null, paye_sur_place: true, statut: "confirme", date_service: "2026-11-21", heure_pickup: "09:30", lieu_pickup: "Pimalai Resort", montant_vente: 600, libelle: "Pimalai Resort → Krabi Airport", details: { taxi_independant: true } }],
    reservations_nets: [],
    documents: [],
    partenaires: [],
    prestations: [],
    trajets: [],
  };
  const controles = aVerifier(db, { droits: { partenaires: true, dossiers: true, clients: true, nets: true }, aujourdhui: "2026-11-18" });
  assert.deepEqual(controles.map((c) => c.cle), [], JSON.stringify(controles));
});

// ---- État partagé : l'écran reste celui de Taxi, le voucher se fait dans l'entreprise du logo ---------------------------------
test("état : sous le logo de Secret, Mook reste sur l'écran voucher, écrit dans Secret avec ses droits de Secret, et revient à Taxi", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  globalThis.location = { origin: "http://localhost", pathname: "/gestion/", search: "?demo", hash: "" };
  try {
    // L'assistante taxi de démo, ouverte dans Taxi (comme Mook en production).
    const { creer } = await import("../src/gestion/js/store-local.mjs");
    const prep = creer();
    const mook = prep.utilisateursDemo().find((u) => /vouchers et factures/.test(u.nom));
    prep.changerUtilisateurDemo(mook.id);
    const brut = await prep.charger();
    const taxi = brut.entites.find((e) => e.slug === "taxi");
    const secret = brut.entites.find((e) => e.slug === "excursions");
    stockage.set("gestion-zwald-entite", taxi.id);
    const E = await import("../src/gestion/js/etat.mjs");
    await E.init();
    assert.equal(E.etat.entiteId, taxi.id);
    assert.ok(E.ecranVoucherSeul());
    assert.deepEqual(E.entitesVoucher().map((e) => e.id), [taxi.id, secret.id]);

    E.travaillerPourVoucher(secret.id);
    assert.equal(E.etat.entiteId, secret.id, "le dossier se crée dans Secret");
    assert.equal(E.etat.voucherDepuis, taxi.id);
    assert.ok(E.ecranVoucherSeul(), "toujours l'écran voucher, jamais l'outil complet de Secret");
    assert.equal(E.entiteVoucherOrigine(), taxi.id);
    assert.equal(E.modeTaxi(), false);
    assert.ok(E.peut("dossiers.ecrire") && !E.peut("partenaires.nets") && !E.peut("vouchers.seul"), "ses droits de Secret, rien de plus");
    assert.equal(stockage.get("gestion-zwald-entite"), taxi.id, "un rechargement revient à Taxi");
    // Les réglages lus sont ceux de Secret (voucher, numérotation) ; ceux de Taxi restent lisibles pour le WhatsApp d'Anaïs.
    assert.equal(E.reglages().emetteur.nom, "Excursions démo");
    assert.equal(E.reglagesDe(taxi.id).emetteur.nom, "Taxi démo");
    const c = await E.inserer("clients", { civilite: "", prenom: "", nom: "Emma Wilson", adresse: "", telephone: "", email: "", notes: "" });
    assert.equal(c.entite_id, secret.id);

    // Une entreprise qui n'est pas proposée (ou inconnue) ne change rien.
    E.travaillerPourVoucher("inconnue");
    assert.equal(E.etat.entiteId, secret.id);
    // Retour au logo Taxi.
    E.travaillerPourVoucher(taxi.id);
    assert.equal(E.etat.entiteId, taxi.id);
    assert.equal(E.etat.voucherDepuis, null);
    assert.ok(E.ecranVoucherSeul() && E.modeTaxi());
    // Choisir Secret dans le bandeau des entreprises (pas le logo) ouvre l'outil complet de Secret, comme avant.
    E.travaillerPourVoucher(secret.id);
    E.changerEntite(secret.id, { naviguer: false });
    assert.equal(E.etat.voucherDepuis, null);
    assert.ok(!E.ecranVoucherSeul());
    assert.deepEqual(E.entitesVoucher(), [], "hors de l'écran Taxi, pas de logo à choisir");
  } finally {
    delete globalThis.localStorage;
    delete globalThis.location;
  }
});
