// tests/gestion-retour-depart.test.js : trajet « Retour au point de départ » de Secret et de VIP Taxi Lanta (16.11.2026).
// Le client est pris quelque part, fait un tour ou une course, et revient au même endroit : pas de drop-off, un programme et une durée facultative.
import test from "node:test";
import assert from "node:assert/strict";

// Un DOM minimal : de quoi rendre le voucher et la Booking confirmation (ui.mjs n'utilise que createElement, createTextNode et append).
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
  // Chaque paragraphe sur sa ligne : le voucher se lit comme un texte.
  get lignes() {
    return ["p", "h1", "h2"].includes(this.tag) ? [this.textContent] : this.children.flatMap((c) => (c instanceof El ? c.lignes : []));
  }
}
globalThis.Node = Node;
globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => new Texte(t) };

const T = await import("../src/gestion/js/trajet-calc.mjs");
const O = await import("../src/gestion/js/operations-calc.mjs");
const { champsBooking } = await import("../src/gestion/js/taxi-calc.mjs");
const { demandeDeTaxi } = await import("../src/gestion/js/taxi-calc.mjs");
const V = await import("../src/gestion/js/voucher-rapide-calc.mjs");
const C = await import("../src/gestion/js/creation-voucher-calc.mjs");
const D = await import("../src/gestion/js/demande-calc.mjs");
const { texteFeuillePartage } = await import("../src/gestion/js/feuille-calc.mjs");
const { construireCopie } = await import("../src/gestion/js/feuille-hors-ligne-calc.mjs");
const { renderVoucher } = await import("../src/gestion/js/views/voucher.mjs");

const AJD = "2026-11-16";
const RETOUR = { type_trajet: "retour_depart", programme_trajet: "Old Town, then the viewpoint for sunset", duree_h: 4 };
const course = (extra = {}) => ({ id: "R1", dossier_id: "D1", entite_id: "E", libelle: "Round trip from Lanta Sand Resort: Old Town, then the viewpoint for sunset", date_service: "2026-11-20", heure_pickup: "15:00", lieu_pickup: "Lanta Sand Resort", personnes: { adultes: 2, enfants: 0, bebes: 0 }, statut: "confirme", montant_vente: 1500, notes: "", details: { ...RETOUR }, ...extra });

// ---- Calcul ----------------------------------------------------------------------------------------------------------------
test("durée : heures par demi-heure, vide = non précisée, illisible = erreur", () => {
  for (const [v, n] of [["3", 3], ["3,5", 3.5], ["1.5 h", 1.5], ["4 hours", 4], ["about 2h", 2], [4, 4], ["2.3", 2.5]]) assert.equal(T.lireDuree(v), n, String(v));
  for (const v of ["", null, "trois", "0", "30", "-2"]) assert.equal(T.lireDuree(v), null, String(v));
  assert.equal(T.dureeInvalide(""), false, "vide n'est pas une erreur");
  assert.equal(T.dureeInvalide("trois"), true);
  assert.equal(T.dureeAnglais(4), "about 4 hours");
  assert.equal(T.dureeAnglais(1), "about 1 hour");
  assert.equal(T.dureeAnglais(1.5), "about 1.5 hours");
  assert.equal(T.dureeAnglais(""), "");
  assert.equal(T.dureeFrancais(1.5), "environ 1,5 h");
});

test("libellé : « Round trip from <lieu>: <programme> », jamais « X → X », coupé au mot", () => {
  assert.equal(T.libelleRetourDepart("Lanta Sand Resort", "Old Town tour"), "Round trip from Lanta Sand Resort: Old Town tour");
  assert.equal(T.libelleRetourDepart("Lanta Sand Resort", ""), "Round trip from Lanta Sand Resort");
  const long = T.libelleRetourDepart("Lanta Sand Resort", "Old Town, the viewpoint, the night market, then a long stop at the clinic in Saladan while the driver waits");
  assert.ok(long.length <= 90 && long.endsWith("…") && !long.includes("→"), long);
});

test("enregistrement : un aller simple n'a ni type ni programme ; un retour au départ n'a pas de drop-off", () => {
  assert.deepEqual(T.detailsTrajet({ type_trajet: "" }), { type_trajet: "", programme_trajet: "", duree_h: "" });
  assert.deepEqual(T.detailsTrajet({ type_trajet: "retour_depart", programme_trajet: "  Clinic in Saladan,  the driver waits ", duree_h: "1,5" }), { type_trajet: "retour_depart", programme_trajet: "Clinic in Saladan, the driver waits", duree_h: 1.5, drop_off: "" });
  assert.deepEqual(T.erreursTrajet({ type_trajet: "retour_depart", programme_trajet: " ", duree_h: "trois" }), { programme_trajet: "e_programme", duree_h: "e_duree" });
  assert.deepEqual(T.erreursTrajet({ type_trajet: "retour_depart", programme_trajet: "Old Town" }), {}, "la durée est facultative");
  assert.deepEqual(T.erreursTrajet({ drop_off: "" }), {}, "un aller simple n'a rien à contrôler ici");
});

test("fiche d'une course hors catalogue : le libellé généré suit le type, un libellé réécrit ou une prestation ne bougent pas", () => {
  assert.equal(T.libelleSelonTrajet({ libelle: "Lanta Sand Resort → Krabi Airport", libre: true, lieu: "Lanta Sand Resort", details: RETOUR }), "Round trip from Lanta Sand Resort: Old Town, then the viewpoint for sunset");
  assert.equal(T.libelleSelonTrajet({ libelle: "Round trip from Lanta Sand Resort: Old Town", libre: true, lieu: "Lanta Sand Resort", details: { drop_off: "Krabi Airport" } }), "Lanta Sand Resort → Krabi Airport");
  assert.equal(T.libelleSelonTrajet({ libelle: "Tour of the island with Mr. Brown", libre: true, lieu: "Lanta Sand Resort", details: RETOUR }), null);
  assert.equal(T.libelleSelonTrajet({ libelle: "Krabi Airport → Koh Lanta", libre: false, lieu: "Lanta Sand Resort", details: RETOUR }), null);
});

test("opérations : un retour au départ est un transfert, sans drop-off déduit, contrôlé et dit dans les messages", () => {
  const r = course();
  assert.equal(O.typeVoucher(r, null, null), "transfert", "une course « Round trip from… » sans prestation garde le voucher de transfert");
  assert.equal(O.typeVoucher({ libelle: "Round trip from Hotel Sunset: market" }, null, null), "transfert", "avant même d'avoir ses détails (création)");
  assert.equal(O.dropOffDepuisLibelle({ ...r, libelle: "Krabi Airport → Koh Lanta" }, null, null), "", "le bout d'un libellé « A → B » n'est pas repris");
  assert.ok(O.champsVoucherDe("transfert").includes("programme_trajet"));
  assert.equal(O.variablesMessage({ reservation: r, langue: "en" }).dropoff, "back to the pickup place");
  assert.equal(O.variablesMessage({ reservation: r, langue: "fr" }).dropoff, "retour au point de départ");
  assert.equal(O.variablesMessage({ reservation: { ...r, details: { drop_off: "Krabi Airport" } }, langue: "en" }).dropoff, "Krabi Airport");
  assert.ok(O.controlesVoucher({ ...r, details: { type_trajet: "retour_depart" } }, {}, "transfert").includes("sans_programme"));
  assert.ok(!O.controlesVoucher(r, {}, "transfert").includes("sans_programme"));
});

// ---- Voucher et Booking confirmation ---------------------------------------------------------------------------------------
const REGL = { emetteur: { nom: "Secret Travel & Tour", adresse: "", telephone: "+66 00" }, apparence: {}, voucher: {}, devise: "THB" };
const voucher = (r, regl = REGL) => renderVoucher({ reservation: r, prestation: null, type: "transfert", index: 1 }, { reglages: regl, dossier: { ref: "INV-2026-099" }, client: { prenom: "Anna", nom: "Keller" }, resume: { total: 1500, recu: 0 }, trajet: null }).lignes;

test("voucher Secret : « Pickup and return », « Plan » et « Duration », jamais de drop-off ni « From X to X »", () => {
  const l = voucher(course());
  assert.ok(l.includes("Pickup and return: Lanta Sand Resort"), l.join("\n"));
  assert.ok(l.includes("Plan: Old Town, then the viewpoint for sunset"));
  assert.ok(l.includes("Duration: about 4 hours"));
  assert.ok(!l.some((x) => /drop-off|from lanta sand resort to|→/i.test(x)), l.join("\n"));
  // Sans durée, la ligne disparaît (ligneSi) ; le programme, obligatoire, reste à remplir à la main s'il manque.
  const sans = voucher(course({ details: { type_trajet: "retour_depart", programme_trajet: "" } }));
  assert.ok(!sans.some((x) => x.startsWith("Duration")));
  assert.ok(sans.includes("Plan: "));
  // Un aller simple ne change pas.
  const simple = voucher(course({ libelle: "Lanta Sand Resort → Krabi Airport", details: { drop_off: "Krabi Airport" } }));
  assert.ok(simple.includes("Pickup Location: Lanta Sand Resort") && simple.includes("Drop-off Location: Krabi Airport"));
  assert.ok(!simple.some((x) => /^(Plan|Duration|Pickup and return)/.test(x)));
});

test("Booking confirmation de Taxi : PICK UP AND RETURN, PLAN et DURATION à la place du DROP OFF", () => {
  const l = voucher(course(), { ...REGL, fonctionnement: "taxi" });
  const apres = (cle) => l[l.indexOf(cle) + 1];
  assert.equal(apres("PICK UP AND RETURN"), "Lanta Sand Resort");
  assert.equal(apres("PLAN"), "Old Town, then the viewpoint for sunset");
  assert.equal(apres("DURATION"), "about 4 hours");
  assert.ok(!l.includes("DROP OFF LOCATION") && !l.includes("PICK UP LOCATION"));
  // Calcul seul : sans durée, pas de rang DURATION ; le vol rejoint le lieu de pickup (l'aéroport), il n'y a pas de dépose.
  const champs = champsBooking({ nom: "A", date: "2026-11-20", pickup: "Krabi Airport", heure: "10:00", dropoff: "Ignored", vol: "FD3217", retour: { programme: "Shopping in Krabi Town", duree: "" } });
  assert.deepEqual(champs.map((c) => c.cle), ["NAME", "DATE", "PICK UP AND RETURN", "PICK UP TIME", "PLAN", "PASSENGERS", "TOTAL PRICE"]);
  assert.equal(champs[2].valeur, "Krabi Airport, flight FD3217");
  assert.ok(!champs.some((c) => /Ignored/.test(c.valeur)));
});

// ---- Feuille du jour et copie hors ligne ------------------------------------------------------------------------------------
test("feuille du jour : le chauffeur lit le programme et la durée ; la copie hors ligne aussi, sans aucun montant", () => {
  const contexte = { client: () => ({ prenom: "Anna", nom: "Keller", telephone: "+41 79 000 00 00" }), partenaire: () => "VIP Taxi Lanta" };
  const [g] = O.feuilleDuJour([course({ partenaire_id: "P", libelle: "Private taxi, Saladan zone" })], "2026-11-20", contexte);
  assert.equal(g.lignes[0].trajet, "Back to the pickup place. Plan: Old Town, then the viewpoint for sunset. About 4 hours");
  for (const texte of [O.texteFeuille(g, "2026-11-20"), texteFeuillePartage(g, "2026-11-20")]) assert.match(texte, /Private taxi, Saladan zone · Anna Keller · .* · Lanta Sand Resort · Back to the pickup place\. Plan: Old Town, then the viewpoint for sunset\. About 4 hours/);
  // Programme déjà dans le libellé (course hors catalogue) : pas répété ; un point final ne se double pas.
  const [g3] = O.feuilleDuJour([course({ details: { ...RETOUR, programme_trajet: "Old Town, then the viewpoint for sunset." } })], "2026-11-20", contexte);
  assert.equal(g3.lignes[0].trajet, "Back to the pickup place. About 4 hours");
  const [g4] = O.feuilleDuJour([course({ libelle: "Private taxi", details: { ...RETOUR, programme_trajet: "Clinic. The driver waits." } })], "2026-11-20", contexte);
  assert.equal(g4.lignes[0].trajet, "Back to the pickup place. Plan: Clinic. The driver waits. About 4 hours");
  const [g2] = O.feuilleDuJour([course({ details: { drop_off: "Krabi Airport" } })], "2026-11-20", contexte);
  assert.equal(g2.lignes[0].trajet, "", "un aller simple n'ajoute rien");
  const copie = construireCopie({ brut: { reservations: [course({ date_service: AJD, libelle: "Private taxi" })], dossiers: [{ id: "D1", entite_id: "E", client_id: "C" }], clients: [{ id: "C", prenom: "Anna", nom: "Keller" }], partenaires: [] }, entites: [{ id: "E", nom: "VIP Taxi Lanta" }], utilisateur: "u", aujourdhui: AJD });
  const ligne = copie.entreprises[0].jours[0].groupes[0].lignes[0];
  assert.match(ligne.trajet, /^Back to the pickup place\. Plan: Old Town/);
  assert.ok(!JSON.stringify(copie).includes("1500"), "aucun montant");
});

// ---- Saisie : écran thaï de Mook et course hors catalogue ------------------------------------------------------------------
const BON = { nom: "Emma Wilson", telephone: "", client_id: "", date: "2026-11-20", pickup: "Pimalai Resort", heure: "09:00", trajet: "retour_depart", dropoff: "", programme: "Clinic in Saladan, the driver waits", duree: "2", vol: "", adultes: "2", enfants: "", bagages: "", sieges: "", prix: "800" };

test("écran voucher : un retour au départ demande le programme (en anglais) à la place du drop-off, la durée est facultative", () => {
  assert.deepEqual(V.erreursVoucher(BON), {});
  assert.deepEqual(V.erreursVoucher({ ...BON, duree: "" }), {});
  const e = V.erreursVoucher({ ...BON, programme: "", duree: "สองชั่วโมง" });
  assert.equal(e.programme, "e_vide");
  assert.equal(e.duree, "e_duree");
  assert.ok(!("dropoff" in e));
  assert.equal(V.erreursVoucher({ ...BON, programme: "ไปคลินิก" }).programme, "e_thai");
  assert.ok(V.TH.e_duree && V.TH.trajet_retour && V.TH.programme, "chaque texte a sa version thaïe");
  // Aller simple : le drop-off reste obligatoire, le programme n'est pas demandé.
  assert.deepEqual(Object.keys(V.erreursVoucher({ ...BON, trajet: "", programme: "" })), ["dropoff"]);
});

test("écran voucher : ce qui est créé, l'aperçu, la correction et la relecture d'un retour au départ", () => {
  const x = V.donneesVoucher({ ...BON, dropoff: "Krabi Airport" });
  assert.equal(x.libelle, "Round trip from Pimalai Resort: Clinic in Saladan, the driver waits");
  assert.equal(x.dropoff, "", "un drop-off resté dans le champ caché ne part pas");
  assert.deepEqual([x.type_trajet, x.programme_trajet, x.duree_h], ["retour_depart", "Clinic in Saladan, the driver waits", 2]);
  // Ce que la création pose sur la réservation (creerDossierExcursions lit `details`) : le type, le programme et la durée, sans drop-off.
  assert.deepEqual(V.reservationVoucher(x).details, { type_trajet: "retour_depart", programme_trajet: "Clinic in Saladan, the driver waits", duree_h: 2 });
  assert.equal(V.reservationVoucher(x).dropoff, "");
  assert.equal(V.reservationVoucher({ ...x, type_trajet: "" }).details, undefined, "un aller simple garde la forme d'avant");
  const r = V.reservationApercu(x);
  assert.deepEqual(r.details, { type_trajet: "retour_depart", programme_trajet: "Clinic in Saladan, the driver waits", duree_h: 2 });
  const ancienne = { libelle: "Pimalai Resort → Krabi Airport", date_service: "2026-11-20", heure_pickup: "09:00", lieu_pickup: "Pimalai Resort", montant_vente: 800, personnes: { adultes: 2, enfants: 0, bebes: 0 }, details: { drop_off: "Krabi Airport", bagages: "2" } };
  const corr = V.correctionReservation(ancienne, x);
  assert.equal(corr.libelle, x.libelle);
  assert.deepEqual(corr.details, { type_trajet: "retour_depart", programme_trajet: "Clinic in Saladan, the driver waits", duree_h: 2 }, "le drop-off et les bagages vidés partent");
  const relu = V.valeursDepuis({ ...ancienne, ...corr });
  assert.deepEqual([relu.trajet, relu.programme, relu.duree, relu.dropoff], ["retour_depart", "Clinic in Saladan, the driver waits", "2", ""]);
  // La course hors catalogue de Gestion passe par le même calcul.
  const { ligne, saisie } = C.courseHorsCatalogue(BON, { id: "L1" });
  assert.equal(ligne.libelle, "Round trip from Pimalai Resort: Clinic in Saladan, the driver waits");
  assert.deepEqual(saisie.details, { type_trajet: "retour_depart", programme_trajet: "Clinic in Saladan, the driver waits", duree_h: 2 });
});

test("création d'un dossier : champs, résumé, libellé suivi, bouts du trajet et contrôle avant de créer", () => {
  assert.deepEqual(C.champsCreation({ type: "transfert", personnes: { adultes: 2 } }, { taxi: true }).slice(0, 6), ["heure", "lieu", "type_trajet", "drop_off", "programme_trajet", "duree_h"]);
  assert.ok(!C.champsCreation({ type: "bateau" }).includes("type_trajet"), "pas pour une excursion en bateau");
  const s = { heure: "15:00", lieu: "Lanta Sand Resort", details: { ...RETOUR, drop_off: "" } };
  assert.equal(C.resumeSaisie(s), "15:00 · Lanta Sand Resort · retour au départ, environ 4 h");
  assert.equal(C.libelleCourseSuivi({ libelle: "Lanta Sand Resort → Krabi Airport" }, s), "Round trip from Lanta Sand Resort: Old Town, then the viewpoint for sunset");
  const b = C.boutsDuTrajet({ lieu: "", details: { type_trajet: "retour_depart" } }, { pickup: "Lanta Sand Resort", dropoff: "Krabi Airport" });
  assert.equal(b.details.drop_off, undefined, "le bout du trajet n'est pas posé en drop-off");
  assert.equal(b.lieu, "Lanta Sand Resort");
  assert.equal(C.trajetIncomplet([{ ligneIds: ["a"], details: { drop_off: "X" } }, { ligneIds: ["b"], details: { type_trajet: "retour_depart", programme_trajet: "" } }]).index, 1);
  assert.equal(C.trajetIncomplet([{ ligneIds: ["b"], details: { ...RETOUR } }]), null);
});

test("demande collée : la ligne du prix convenu est un transfert à la course, les personnes de la demande ne sont pas écrasées", () => {
  const l = C.ligneRetourDepart({ lieu: "Lanta Sand Resort", programme: "Old Town tour", prix: 1500, date: "2026-11-20" }, null, { uid: () => "L1" });
  assert.deepEqual([l.libelle, l.unite, l.qte, l.par, l.libre], ["Round trip from Lanta Sand Resort: Old Town tour", 1500, 1, "veh", true]);
  const [{ reservation: r }] = O.reservationsDepuisDocument({ dossier_id: "D", contenu: { lignes: [{ ...l, titre: l.libelle }] } }, { uid: () => "R" });
  assert.deepEqual(r.personnes, { adultes: 0, enfants: 0, bebes: 0 }, "la quantité 1 n'est pas une personne");
  assert.equal(O.typeVoucher(r, null, null), "transfert");
  // Prix ou programme changés : la même ligne (même identifiant) suit.
  const l2 = C.ligneRetourDepart({ lieu: "Lanta Sand Resort", programme: "Clinic in Saladan", prix: 900, date: "2026-11-21" }, l);
  assert.equal(l2, l);
  assert.deepEqual([l2.id, l2.libelle, l2.unite, l2.date_service], ["L1", "Round trip from Lanta Sand Resort: Clinic in Saladan", 900, "2026-11-21"]);
});

// ---- Demande collée --------------------------------------------------------------------------------------------------------
const SITE = `Round trip, back to the pickup place
Pickup: Lanta Sand Resort
Plan: Old Town, then the viewpoint for sunset
Time needed: about 4 hours
Vehicle: songthaew
Date: Fri 20 Nov 2026
Pickup time: 15:00
Guests: 2 adults, 1 child (age 7)
Name: Anna Keller`;
const CTX = { prestations: [], trajets: [] };
const lire = (texte, ctx = CTX) => {
  const d = D.lireMessage(texte, AJD);
  return { d, services: D.decouperServices(texte, d, ctx, AJD) };
};

test("message du site : lu tel quel, sans drop-off ni offre de la base, et rangé chez Taxi", () => {
  const { d, services } = lire(SITE);
  assert.equal(d.type, "transfer");
  assert.deepEqual([d.pickup, d.dropoff, d.vers, d.date, d.heure, d.adultes, d.enfants, d.nom, d.vehiculeNom], ["Lanta Sand Resort", "", "", "2026-11-20", "15:00", 2, 1, "Anna Keller", "songthaew"]);
  assert.deepEqual(d.retourDepart, { programme: "Old Town, then the viewpoint for sunset", duree: 4 });
  assert.equal(services.length, 1);
  assert.deepEqual(services[0].offres, [], "aucune grille : le prix se fixe à la main");
  assert.deepEqual(services[0].retourDepart, d.retourDepart);
  assert.equal(demandeDeTaxi(SITE, d), true);
});

test("message du site : « not sure », ligne absente, ligne plus bas et repli sans JavaScript", () => {
  assert.equal(lire(SITE.replace("about 4 hours", "not sure")).d.retourDepart.duree, null);
  assert.equal(lire(SITE.replace("Time needed: about 4 hours\n", "")).d.retourDepart.duree, null);
  const plusBas = lire("Transfer request: Lanta Sand Resort to Lanta Sand Resort – Round trip, back to the pickup place\nDate: Fri 20 Nov 2026\nPickup: Lanta Sand Resort\nPlan: Clinic in Saladan\nGuests: 1 adult").d;
  assert.deepEqual([plusBas.vers, plusBas.dropoff, plusBas.retourDepart.programme], ["", "", "Clinic in Saladan"]);
  const vide = lire("Round trip, back to the pickup place\nPickup: \nPlan: \nTime needed: ").d;
  assert.deepEqual(vide.retourDepart, { programme: "", duree: null });
});

test("message libre : un retour au point de départ, avec son programme, sa durée et son lieu de pickup", () => {
  const a = lire("Hi, can you take us from Lanta Sand Resort to Old Town and back on 20 November? 2 adults. Thanks, Marc");
  assert.equal(a.services.length, 1);
  assert.ok(a.services[0].retourDepart);
  assert.match(a.services[0].retourDepart.programme, /Old Town and back/);
  assert.equal(a.d.hotel, "Lanta Sand Resort");
  const b = lire("Hello, on 20 Nov at 9am we would like a driver to take us to the clinic in Saladan and wait for us, about 2 hours. Hotel Sunset. Sophie");
  assert.equal(b.services[0].retourDepart.duree, 2);
  assert.match(b.services[0].retourDepart.programme, /^on 20 Nov at 9am we would like a driver to take us to the clinic in Saladan and wait for us/);
  const c = lire("Bonjour, un taxi le 20 novembre pour aller au marché de Saladan et nous ramener à l'hôtel, 2 adultes");
  assert.ok(c.services[0].retourDepart, "en français aussi");
  const e = lire("Hi! We are staying at Pimalai Resort. Tomorrow we want a taxi to drive us around the island for 5 hours, with stops at viewpoints. 4 adults");
  assert.equal(e.services[0].retourDepart.duree, 5);
  // Chez Taxi, toute demande est une course : « wait for us » suffit, même sans mot de véhicule.
  const f = "On 20 Nov please bring us to Long Beach market and wait for us, then back. 2 adults";
  assert.ok(lire(f, { ...CTX, taxi: true }).services.some((s) => s.retourDepart));
});

test("message libre : un aller-retour classique (deux dates), un transfert depuis l'aéroport ou un bateau ne sont pas des retours au départ", () => {
  const a = lire("We need a taxi to Krabi Airport on 12 December and back on 15 December, 2 adults");
  assert.equal(a.services.length, 2, "deux services, comme avant (règle RETOUR)");
  assert.ok(a.services.every((s) => !s.retourDepart));
  const b = lire("Taxi from Krabi Airport back to the hotel on 20 Nov please, 2 adults");
  assert.ok(b.services.every((s) => !s.retourDepart), "« from the airport back to the hotel » est un aller simple");
  const c = lire("Speedboat to Phi Phi and back on 20 Nov, 2 adults");
  assert.ok(c.services.every((s) => !s.retourDepart), "un bateau aller-retour est un billet");
  const d = lire("Taxi to Krabi Town on 20 Nov and we come back on 22 Nov, 2 adults");
  assert.ok(d.services.every((s) => !s.retourDepart), "deux dates : aller puis retour un autre jour");
  assert.equal(T.indiceRetourDepart("Private taxi from Lanta Sand Resort to Krabi Airport"), "", "un transfert simple avec pickup");
});

test("message libre : une sortie de la base qui ramène à l'hôtel reste une sortie", () => {
  const prestations = [{ id: "P2", partenaire_id: "X", famille: "activite", groupe: "Elephants", libelle: "Elephant sanctuary visit", prix_vente: 1500, unite: "pp", actif: true }];
  const { services } = lire("Elephant sanctuary visit on 20 Nov, pick us up at Lanta Sand Resort and drive us back to the hotel, 2 adults", { prestations, trajets: [] });
  assert.equal(services.length, 1);
  assert.equal(services[0].offres.length, 1, "l'offre de la base est gardée");
  assert.equal(services[0].retourDepart, null);
});
