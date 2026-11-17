// Lot C2 de l'autonomie (17.11.2026) : dossiers, clients et paiements.
import test from "node:test";
import assert from "node:assert/strict";
import { typePaiement, paiementEnDouble, ecartASolder, reservationsAReactiver, reactivation, servicesSuivantAdresse, personnesDuDossier, sansPersonne, fusionClients, contenuAvecEnfants, lignesIdsAvec } from "../src/gestion/js/dossier-gestes-calc.mjs";
import { identiteDepuisSaisie, verifierNouveauClient, peutFusionnerClients } from "../src/gestion/js/client-calc.mjs";
import { contenuAvecReservation, ecartReservation, reservationsDepuisDocument } from "../src/gestion/js/operations-calc.mjs";
import { PERMISSIONS, DEPENDANCES, TOUTES_PERMISSIONS } from "../src/gestion/js/defauts.mjs";
import fs from "node:fs";

// ---- n° 68 : paiements ----------------------------------------------------------------------------------------------
test("n° 68 : un versement partiel est un acompte, seul celui qui complète le total est le solde (Secret, sans acompte prévu)", () => {
  assert.equal(typePaiement({ montant: 1000, recu: 0, total: 3000 }), "acompte", "avant : « Solde » affiché pour un tiers du total");
  assert.equal(typePaiement({ montant: 2000, recu: 1000, total: 3000 }), "solde");
  assert.equal(typePaiement({ montant: 3000, recu: 0, total: 3000 }), "solde", "tout payé d'un coup");
  assert.equal(typePaiement({ montant: 500, recu: 0, total: 0 }), "acompte", "sans facture, rien n'est soldé");
  assert.equal(typePaiement({ montant: 200, recu: 3000, total: 3000, rembourse: true }), "remboursement");
});

test("n° 68 : le même paiement saisi deux fois est repéré (même montant, même sens, trois jours au plus)", () => {
  const deja = [{ id: "p1", date: "2026-11-10", montant: 1500 }, { id: "p2", date: "2026-10-01", montant: 800 }];
  assert.equal(paiementEnDouble(deja, { date: "2026-11-10", montant: 1500 }).id, "p1");
  assert.equal(paiementEnDouble(deja, { date: "2026-11-13", montant: 1500 }).id, "p1", "relevé lu trois jours plus tard");
  assert.equal(paiementEnDouble(deja, { date: "2026-11-14", montant: 1500 }), null);
  assert.equal(paiementEnDouble(deja, { date: "2026-11-10", montant: 1499.5 }), null);
  assert.equal(paiementEnDouble(deja, { date: "2026-11-10", montant: -1500 }), null, "un remboursement n'est pas le double d'un paiement");
  assert.equal(paiementEnDouble(deja, { date: "2026-11-10", montant: 1500 }, { sauf: "p1" }), null, "un paiement corrigé n'est pas son propre double");
});

// ---- n° 69 : solder l'écart ------------------------------------------------------------------------------------------
test("n° 69 : « Solder l'écart » ferme le reste d'un dossier déjà payé en partie, et signale un reste trop gros", () => {
  assert.deepEqual(ecartASolder({ total: 10000, recu: 9950 }), { montant: 50, petit: true }, "frais Wise");
  assert.deepEqual(ecartASolder({ total: 10000, recu: 9000 }), { montant: 1000, petit: false });
  assert.equal(ecartASolder({ total: 10000, recu: 0 }), null, "rien reçu : ce n'est pas un écart");
  assert.equal(ecartASolder({ total: 10000, recu: 10000 }), null);
  assert.equal(ecartASolder({ total: 10000, recu: 10020 }), null, "trop-perçu : rien à solder");
});

// ---- n° 63 : réactiver un dossier annulé ------------------------------------------------------------------------------
test("n° 63 : à la réactivation, les réservations annulées avec le dossier sont proposées cochées, les autres non", () => {
  const rs = [
    { id: "a", dossier_id: "d", statut: "annule", details: { annule_avec_dossier: true, chambre: "4" } },
    { id: "b", dossier_id: "d", statut: "annule", details: {} },
    { id: "c", dossier_id: "d", statut: "confirme" },
    { id: "x", dossier_id: "autre", statut: "annule", details: { annule_avec_dossier: true } },
  ];
  const r = reservationsAReactiver(rs, "d");
  assert.deepEqual(r.cochees.map((x) => x.id), ["a"]);
  assert.deepEqual(r.autres.map((x) => x.id), ["b"]);
  assert.deepEqual(reactivation(rs[0]), { statut: "confirme", details: { chambre: "4" } }, "la marque part, le reste des détails demeure");
});

// ---- n° 30 : hôtel ou chambre changés ----------------------------------------------------------------------------------
test("n° 30 : un hôtel changé sur la fiche client est proposé aux services à venir qui partent encore de l'ancien", () => {
  const rs = [
    { id: "1", statut: "confirme", date_service: "2026-11-20", lieu_pickup: "Baiyok Hotel, Room 6", details: {} },
    { id: "2", statut: "confirme", date_service: null, lieu_pickup: "baiyok hotel", details: { chambre: "6" } },
    { id: "3", statut: "confirme", date_service: "2026-11-01", lieu_pickup: "Baiyok Hotel, Room 6" },
    { id: "4", statut: "annule", date_service: "2026-11-20", lieu_pickup: "Baiyok Hotel" },
    { id: "5", statut: "confirme", date_service: "2026-11-21", lieu_pickup: "Saladan pier" },
  ];
  const out = servicesSuivantAdresse({ avant: "Baiyok Hotel, Room 6\nKlong Dao", apres: "Lanta Sand Resort, Room 12\nPhra Ae", reservations: rs, aujourdhui: "2026-11-17" });
  assert.deepEqual(out.map((x) => x.reservation.id), ["1", "2"], "ni le passé, ni l'annulé, ni un autre lieu");
  assert.equal(out[0].champs.lieu_pickup, "Lanta Sand Resort, Room 12", "le lieu avec chambre garde la chambre");
  assert.equal(out[1].champs.lieu_pickup, "Lanta Sand Resort", "le lieu sans chambre reste sans chambre");
  assert.equal(out[1].champs.details.chambre, "12", "la chambre du voucher suit");
  // Seule la chambre change : même hôtel, nouvelle chambre.
  const ch = servicesSuivantAdresse({ avant: "Baiyok Hotel, Room 6", apres: "Baiyok Hotel, Room 8", reservations: rs, aujourdhui: "2026-11-17" });
  assert.deepEqual(ch.map((x) => [x.reservation.id, x.champs.lieu_pickup, x.champs.details && x.champs.details.chambre]), [["1", "Baiyok Hotel, Room 8", undefined], ["2", "Baiyok Hotel", "8"]], "le nom de l'hôtel prend l'écriture de la fiche");
  assert.deepEqual(servicesSuivantAdresse({ avant: "Baiyok Hotel", apres: "Baiyok Hotel", reservations: rs, aujourdhui: "2026-11-17" }), []);
});

// ---- Réservation à 0 adulte ----------------------------------------------------------------------------------------------
test("service par véhicule ajouté à un dossier : la réservation prend les personnes du dossier au lieu de 0 adulte", () => {
  const doc = { dossier_id: "d", contenu: { lignes: [{ id: "v", kind: "ligne", prestation_id: "p", partenaire_id: "x", libelle: "Private van", intro: "(per vehicle)", par: "veh", unite: 1800, qte: 1 }] } };
  const [{ reservation }] = reservationsDepuisDocument(doc);
  assert.ok(sansPersonne(reservation.personnes), "le calcul seul donne 0 adulte (le défaut d'avant)");
  const autres = [{ id: "r1", dossier_id: "d", statut: "confirme", personnes: { adultes: 2, enfants: 1 } }, { id: "r2", dossier_id: "d", statut: "confirme", personnes: { adultes: 1, enfants: 0 } }, { id: "r3", statut: "annule", personnes: { adultes: 6 } }];
  assert.deepEqual(personnesDuDossier(autres), { adultes: 2, enfants: 1 }, "le service qui compte le plus de monde, hors annulé");
  assert.equal(personnesDuDossier([]), null);
});

// ---- n° 66 : fusion de clients -------------------------------------------------------------------------------------------
test("n° 66 : la fusion remplit les champs vides et ajoute les notes, sans rien écraser", () => {
  const garde = { prenom: "Jane", nom: "Example", telephone: "", email: "", adresse: "Hotel A", notes: "VIP" };
  const autre = { prenom: "J.", nom: "Example", telephone: "+41791234567", email: "jane@example.test", adresse: "Hotel B", notes: "Allergie" };
  assert.deepEqual(fusionClients(garde, autre), { telephone: "+41791234567", email: "jane@example.test", notes: "VIP\nAllergie" });
  assert.deepEqual(fusionClients(garde, { ...garde }), {}, "deux fiches identiques : rien à reprendre");
});

test("n° 66 : le droit « Fusionner deux fiches » existe, suppose de modifier les dossiers, et l'ancien couple de droits suffit", () => {
  assert.ok(PERMISSIONS.some((p) => p.code === "clients.fusionner"));
  assert.ok(TOUTES_PERMISSIONS.includes("clients.fusionner"), "l'administrateur l'a");
  assert.deepEqual(DEPENDANCES["clients.fusionner"], ["clients.lire", "clients.ecrire", "dossiers.lire", "dossiers.ecrire"]);
  const avec = (...codes) => (c) => codes.includes(c);
  assert.equal(peutFusionnerClients(avec("clients.fusionner")), true);
  assert.equal(peutFusionnerClients(avec("clients.supprimer", "dossiers.ecrire")), true);
  assert.equal(peutFusionnerClients(avec("clients.ecrire", "dossiers.ecrire", "partenaires.ecrire")), false, "rôle actuel de Mook dans Secret");
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-31-fusion-clients.sql", import.meta.url), "utf8");
  assert.match(sql, /'clients\.fusionner'/);
  assert.match(sql, /a_permission\(g\.entite_id, 'clients\.supprimer'\) and a_permission\(g\.entite_id, 'dossiers\.ecrire'\)/, "même règle que l'interface");
});

// ---- n° 67 : nouveau client depuis un nouveau dossier ------------------------------------------------------------------
test("n° 67 : le nom tapé est repris et le téléphone sans indicatif est refusé, comme sur la fiche client", () => {
  assert.deepEqual(identiteDepuisSaisie("  Jane   Example "), { prenom: "Jane", nom: "Example" });
  assert.equal(verifierNouveauClient({ nom: "Example", telephone: "081 234 5678" }).raison, "sans_indicatif");
  assert.equal(verifierNouveauClient({ nom: "Example", telephone: "+66 81 234 5678" }).valeurs.telephone, "+66812345678");
  const ecran = fs.readFileSync(new URL("../src/gestion/js/views/nouveau-excursions.mjs", import.meta.url), "utf8");
  assert.match(ecran, /identiteDepuisSaisie\(selClient\.texteSaisi\)/, "l'écran Excursions reprend le nom tapé");
  assert.match(ecran, /verifierNouveauClient\(/, "et contrôle l'indicatif");
  const creation = fs.readFileSync(new URL("../src/gestion/js/views/creation-excursions.mjs", import.meta.url), "utf8");
  assert.match(creation, /verifierNouveauClient\(/, "la création (aussi par « Coller une demande ») refuse un numéro sans indicatif");
});

// ---- n° 54 : textes du nouveau dossier ------------------------------------------------------------------------------------
test("n° 54 : le nouveau dossier Excursions ne parle plus de « réservations auprès des partenaires »", () => {
  const ecran = fs.readFileSync(new URL("../src/gestion/js/views/nouveau-excursions.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(ecran, /auprès des partenaires/);
  assert.match(ecran, /Les services et la facture se créent en même temps/);
  assert.match(ecran, /h\("legend", null, tr\("Services"\)\)/);
});

// ---- Enfant ajouté : la ligne enfant de la facture --------------------------------------------------------------------------
const adulte = { id: "la", kind: "ligne", titre: "Koh Rok snorkeling", libelle: "Koh Rok snorkeling, 2 passengers, 20 November 2026", intro: "", unite: 1500, qte: 2, prestation_id: "p", partenaire_id: "x", date_service: "2026-11-20", net: 1100 };
const rRes = { id: "r", ligne_id: "la", details: {}, personnes: { adultes: 2, enfants: 0 }, date_service: "2026-11-20", montant_vente: 3000, paye_sur_place: false, libelle: "Koh Rok snorkeling", partenaire_id: "x" };
const n = { i: 0 };
const uid = () => `nouv${++n.i}`;
const avant = { date_service: "2026-11-20", personnes: { adultes: 2, enfants: 0 } };
const apres = { date_service: "2026-11-20", personnes: { adultes: 2, enfants: 1 } };

test("enfant ajouté : la facture gagne la ligne enfant au tarif enfant, et la réservation la compte (plus d'écart)", () => {
  const contenu = { langue: "en", lignes: [adulte, { id: "t", kind: "texte", libelle: "Note" }] };
  const avantEnfant = contenuAvecReservation(contenu, rRes, avant, apres);
  assert.equal(avantEnfant.contenu, null, "le défaut : rien ne changeait sur la facture");
  const e = contenuAvecEnfants(contenu, rRes, avant, apres, { tarifEnfant: () => ({ unite: 900, net: 600, prestation_id: "pe" }), uid, langue: "en", decrire: (l) => `${l.libelle}, 1 child` });
  assert.equal(e.raison, "");
  const ligne = e.contenu.lignes[1];
  assert.equal(ligne.id, e.ajoutee, "juste après la ligne adulte");
  assert.deepEqual({ unite: ligne.unite, qte: ligne.qte, net: ligne.net, prestation_id: ligne.prestation_id, intro: ligne.intro, date: ligne.date_service }, { unite: 900, qte: 1, net: 600, prestation_id: "pe", intro: "(per child)", date: "2026-11-20" });
  assert.equal(ligne.libelle, "Koh Rok snorkeling, child, 1 child");
  const r2 = { ...rRes, personnes: apres.personnes, montant_vente: 3900, details: { lignes_ids: lignesIdsAvec(rRes, e.ajoutee) } };
  assert.deepEqual(r2.details.lignes_ids, ["la", e.ajoutee]);
  assert.equal(ecartReservation(r2, { contenu: e.contenu }), null, "réservation et facture d'accord : 2 adultes, 1 enfant, 3 900");
});

test("enfant ajouté sans tarif enfant, ou prix par véhicule : la facture ne bouge pas et la raison est donnée", () => {
  const contenu = { lignes: [adulte] };
  assert.equal(contenuAvecEnfants(contenu, rRes, avant, apres, { tarifEnfant: () => null, uid }).raison, "sans_tarif");
  const vehicule = { lignes: [{ ...adulte, par: "veh", intro: "(per vehicle)", qte: 1 }] };
  assert.equal(contenuAvecEnfants(vehicule, rRes, avant, apres, { tarifEnfant: () => ({ unite: 1 }), uid }).raison, "prix_global");
  const deux = { lignes: [adulte, { ...adulte, id: "lb" }] };
  assert.equal(contenuAvecEnfants(deux, { ...rRes, details: { lignes_ids: ["la", "lb"] } }, avant, apres, { tarifEnfant: () => ({ unite: 1 }), uid }).raison, "plusieurs_lignes");
  assert.equal(contenuAvecEnfants(contenu, rRes, avant, avant, { uid }).contenu, null, "rien ne change sans enfant de plus");
});

test("enfant retiré : la ligne enfant qui le comptait part de la facture ; une ligne enfant existante suit le nombre", () => {
  const enfant = { ...adulte, id: "le", titre: "Koh Rok snorkeling, child", intro: "(per child)", unite: 900, qte: 1 };
  const contenu = { lignes: [adulte, enfant] };
  const r = { ...rRes, details: { lignes_ids: ["la", "le"] } };
  const e = contenuAvecEnfants(contenu, r, apres, avant, { uid });
  assert.equal(e.retiree, "le");
  assert.deepEqual(e.contenu.lignes.map((l) => l.id), ["la"]);
  // 1 → 2 enfants : contenuAvecReservation met déjà la quantité de la ligne enfant à jour, rien à ajouter ici.
  const deuxEnfants = { date_service: "2026-11-20", personnes: { adultes: 2, enfants: 2 } };
  assert.equal(contenuAvecEnfants(contenu, r, apres, deuxEnfants, { uid }).contenu, null);
  assert.equal(contenuAvecReservation(contenu, r, apres, deuxEnfants).contenu.lignes[1].qte, 2);
});
