// Sièges enfant ou bébé (22.11.2026) : saisis depuis l'Assistant, ils se perdaient (aucun champ dans les outils proposer_*, la fiche de
// création ne les reprenait que d'une demande du site). Chaque chemin de création garde désormais details.sieges, l'Assistant les lit et
// les modifie, la fiche de réservation les montre, et ils s'impriment. Données fictives.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executer, normaliserEntree, refDe, OUTILS } from "../supabase/functions/agent/outils.js";
import { tempsSimule } from "../supabase/functions/agent/planifier.js";
import { propositionDepuisCarte, reservationDepuisCarte, reservationModifiee, siegesCarte } from "../src/gestion/js/agent-calc.mjs";
import { propositionVersDemande } from "../src/gestion/js/assistant-calc.mjs";
import { lireConfirmation } from "../src/gestion/js/confirmation-calc.mjs";
import { donneesVoucher, reservationVoucher, valeursDepuis, valeursVides } from "../src/gestion/js/voucher-rapide-calc.mjs";
import { siegesVoucher } from "../src/gestion/js/operations-calc.mjs";
import { champsBooking, passagersBooking } from "../src/gestion/js/taxi-calc.mjs";
import { lireMessage } from "../src/gestion/js/demande-calc.mjs";
import { saisieDepuisDemande, parServiceCreation } from "../src/gestion/js/creation-voucher-calc.mjs";

const ici = path.dirname(fileURLToPath(import.meta.url));
const lire = (f) => fs.readFileSync(path.join(ici, "..", f), "utf8");

const PA = "aaaaaaaa-0000-4000-8000-000000000001";
const RES = "e1000000-0000-4000-8000-000000000001";
const donnees = {
  partenaires: [{ id: PA, nom: "Transports Démo", actif: true }],
  prestations: [{ id: "a1000000-0000-4000-8000-000000000001", famille: "transfert", groupe: "Private minivan", libelle: "Minivan privé", libelle_en: "Private minivan", prix_vente: 2500, unite: "veh", partenaire_id: PA, actif: true }],
  trajets: [],
  clients: [{ id: "c1000000-0000-4000-8000-000000000001", prenom: "Test", nom: "Client" }],
  dossiers: [{ id: "d1000000-0000-4000-8000-000000000001", ref: "2026-0001", client_id: "c1000000-0000-4000-8000-000000000001", annule: false }],
  reservations: [{ id: RES, dossier_id: "d1000000-0000-4000-8000-000000000001", libelle: "Transfer Lanta → Krabi Airport", date_service: "2026-12-03", heure_pickup: "09:00", lieu_pickup: "Hotel Test", personnes: { adultes: 2, enfants: 2 }, statut: "confirme", sieges: "1" }],
};
const ctx = (extra = {}) => ({ charger: async (n) => donnees[n] || [], reglages: {}, simule: tempsSimule, ...extra });
const memo = () => ({ prix: new Set(), heures: new Set(), tapes: new Set(), durees: new Set(), estimations: new Map(), signer: false, prestataires: [], entreprise: "Test" });
const service = (o = {}) => ({ texte: "Transfert", ref: "", date: "2026-12-03", heure_pickup: "09:00", lieu_pickup: "Hotel Test", de: "Koh Lanta", vers: "Krabi Airport", adultes: 2, enfants: 2, prix_saisi: "", vol: "", remarque: "", ...o });

test("Assistant : le schéma des services a les sièges ; proposer_dossier et proposer_reservation les gardent sur la carte", async () => {
  const schema = OUTILS.find((o) => o.name === "proposer_dossier").input_schema.properties.services.items;
  assert.ok(schema.properties.sieges, "proposer_dossier");
  assert.ok(schema.required.includes("sieges"));
  // Par type depuis le 22.11.2026 : « sieges » pour les child seats, « sieges_bebe » pour les baby seats, « sans_siege » pour aucun.
  assert.match(schema.properties.sieges.description, /child seat.*car seat/);
  assert.match(schema.properties.sieges_bebe.description, /baby seat/);
  assert.equal(schema.properties.sans_siege.type, "boolean");
  assert.ok(OUTILS.find((o) => o.name === "proposer_reservation").input_schema.properties.service.properties.sieges);
  assert.equal(normaliserEntree("proposer_dossier", { titre: "x", services: [service({ sieges: 2 })] }).services[0].sieges, 2);
  const carte = await executer("proposer_dossier", { titre: "Dossier", client_nom: "", client_telephone: "", hotel: "", langue: "en", adultes: 2, enfants: 2, bebes: 0, services: [service({ sieges: 2 }), service({ sieges: 0 })], apporteur: "" }, ctx(), memo());
  assert.deepEqual(carte.carte.donnees.services.map((s) => s.sieges), [2, 0]);
  // Plus de 10 : refusé avec un motif, jamais ramené à 10 en silence (relecture de la PR 315).
  const trop = await executer("proposer_dossier", { titre: "Dossier", client_nom: "", client_telephone: "", hotel: "", langue: "en", adultes: 2, enfants: 0, bebes: 0, services: [service({ sieges: 40 })], apporteur: "" }, ctx(), memo());
  assert.equal(trop.contenu.erreur, "sieges_trop_nombreux");
  assert.equal((await executer("proposer_reservation", { titre: "Ajout", dossier: refDe("D", donnees.dossiers[0].id), service: service({ sieges: 11 }) }, ctx(), memo())).contenu.erreur, "sieges_trop_nombreux");
  const dix = await executer("proposer_dossier", { titre: "Dossier", client_nom: "", client_telephone: "", hotel: "", langue: "en", adultes: 2, enfants: 0, bebes: 0, services: [service({ sieges: 10 })], apporteur: "" }, ctx(), memo());
  assert.equal(dix.carte.donnees.services[0].sieges, 10);
  const ajout = await executer("proposer_reservation", { titre: "Ajout", dossier: refDe("D", donnees.dossiers[0].id), service: service({ sieges: 1 }) }, ctx(), memo());
  assert.equal(ajout.carte.donnees.service.sieges, 1);
});

test("Assistant : lire_dossier montre les sièges, proposer_modification les change (champ « sieges »)", async () => {
  const lu = await executer("lire_dossier", { dossier: "2026-0001" }, ctx(), memo());
  assert.equal(lu.contenu.services[0].sieges, 1);
  const ref = refDe("R", RES);
  const enum_ = OUTILS.find((o) => o.name === "proposer_modification").input_schema.properties.champ.enum;
  assert.ok(enum_.includes("sieges"));
  const m = await executer("proposer_modification", { titre: "Sièges", reservation: ref, champ: "sieges", valeur: "2", raison: "Deux sièges demandés." }, ctx(), memo());
  assert.deepEqual([m.carte.donnees.champ, m.carte.donnees.avant, m.carte.donnees.valeur], ["sieges", "1", "2"]);
  for (const v of ["deux", "11", ""]) assert.equal((await executer("proposer_modification", { titre: "x", reservation: ref, champ: "sieges", valeur: v, raison: "" }, ctx(), memo())).contenu.erreur, "valeur_invalide", v);
  // L'écran applique la modification dans details.sieges ; 0 les retire.
  const r = { id: RES, personnes: { adultes: 2, enfants: 2 }, details: { vol: "FD3217", sieges: 1 } };
  assert.deepEqual(reservationModifiee(r, { champ: "sieges", valeur: "2" }).details, { vol: "FD3217", sieges: 2 });
  assert.deepEqual(reservationModifiee(r, { champ: "sieges", valeur: "0" }).details, { vol: "FD3217" });
  // La fonction lit la colonne sieges:details->>sieges.
  assert.match(lire("supabase/functions/agent/index.ts"), /sieges:details->>sieges/);
});

test("carte de l'Assistant (et carte WhatsApp, la même) : les sièges vont jusqu'au service de la fiche de création, puis à la réservation", async () => {
  const donneesCarte = { client: { nom: "Test" }, adultes: 2, enfants: 2, services: [{ texte: "Transfert", offre: null, date: "2026-12-03", de: "Koh Lanta", vers: "Krabi Airport", adultes: 2, enfants: 2, sieges: 2 }, { texte: "Retour", offre: null, date: "2026-12-10", de: "Krabi Airport", vers: "Koh Lanta", adultes: 2, enfants: 2 }] };
  const prop = propositionDepuisCarte(donneesCarte);
  assert.deepEqual(prop.services.map((s) => s.sieges), [2, 0]);
  const { services } = propositionVersDemande(prop, { prestations: [], trajets: [], partenaires: [] });
  assert.deepEqual(services.map((s) => s.sieges), [2, undefined]);
  // Fiche de création (views/demande.mjs) : le service garde ses sièges dans sa saisie, posée sur la réservation (creation-excursions.mjs).
  const demande = lire("src/gestion/js/views/demande.mjs");
  // Les sièges de la carte passent avant ceux de la demande (formulaire du site ou message collé, siegesDemande), jamais chez ZTP.
  const { saisieInitiale } = await import("../src/gestion/js/creation-voucher-calc.mjs");
  assert.equal(saisieInitiale({ sieges: 2 }, { excursions: true, sd: { sieges: 1, sieges_bebe: 0 } }).sieges, 2, "plus seulement pour une demande du site");
  assert.equal(saisieInitiale({}, { excursions: true, sd: { sieges: 1, sieges_bebe: 0 } }).sieges, 1);
  assert.equal(saisieInitiale({ sieges: 2 }, { excursions: false }).sieges, 0, "jamais chez ZTP");
  assert.match(demande, /sv\.saisie = saisieInitiale\(sv, \{ d, excursions: modeExcursions\(\), sd: siegesDemande\(d\) \}\);/);
  assert.equal((await import("../src/gestion/js/creation-voucher-calc.mjs")).serviceDeLecture({ sieges: "2" }).sieges, 2, "le service de l'Assistant porte ses sièges");
  assert.match(demande, /nouveauService\(\{ \.\.\.serviceDeLecture\(t\), /);
  const { entreeParService, champsReservation } = await import("../src/gestion/js/creation-voucher-calc.mjs");
  assert.equal(entreeParService({}, { ...saisieInitiale({ sieges: 2 }, { excursions: true }) }).sieges, 2, "la réservation reçoit la saisie");
  assert.deepEqual(champsReservation({}, { sieges: 2 }).details, { sieges: 2 });
  // « Vérifier avant » : même fiche, champ visible et modifiable pour un transfert.
  const parService = parServiceCreation([{ ligneIds: ["l1"] }], new Map([["l1", saisieDepuisDemande({ sieges: 2 })]]));
  assert.equal(parService[0].sieges, 2);
  // Ajout à un dossier existant : details.sieges sur la réservation ouverte.
  assert.deepEqual(reservationDepuisCarte({ dossier_id: "d", service: { texte: "Transfert", sieges: 1, vol: "FD3217" } }).details, { vol: "FD3217", sieges: 1 });
  assert.equal(reservationDepuisCarte({ dossier_id: "d", service: { texte: "Transfert" } }).details, undefined);
  assert.equal(siegesCarte({ sieges: "3" }), 3);
});

test("course Taxi collée, saisie rapide de Mook, demande du site : les sièges sont lus et gardés", () => {
  // Confirmation collée (carte « Course » de l'Assistant).
  const lu = lireConfirmation("Name: Test\nDate: 3 December 2026\nPick-up: Hotel Test\nDrop-off: Krabi Airport\nTime: 09:00\nPassengers: 2 adults, 2 children, 2 child seats", { aujourdhui: "2026-11-22" });
  assert.equal(lu.valeurs.sieges, "2");
  // Saisie rapide (écran thaï de Mook) : details.sieges posé, relu pour une correction.
  const x = donneesVoucher({ ...valeursVides(), nom: "Test", date: "2026-12-03", pickup: "Hotel Test", heure: "09:00", trajet: "aller", dropoff: "Krabi Airport", adultes: "2", enfants: "2", sieges: "2" });
  const r = reservationVoucher(x);
  assert.equal(r.sieges, 2);
  assert.equal(valeursDepuis({ ...r, details: { sieges: 2 }, personnes: { adultes: 2, enfants: 2 } }).sieges, "2");
  // Demande d'un transfert du site.
  const site = lireMessage("Transfer request: Koh Lanta → Krabi Airport\nDate: Thu 3 Dec 2026\nGuests: 2 adults, 2 children\nChild seats: 2\nName: Test", "2026-11-22");
  assert.equal(site.sieges, 2);
});

test("impression : voucher de transfert, Booking confirmation (Taxi et Secret), voucher de Mook", () => {
  assert.equal(siegesVoucher(2), " (2 child seats)");
  assert.equal(passagersBooking({ adultes: 2, enfants: 2 }, "", 1), "2 adults, 2 children (1 child seat)");
  const champs = champsBooking({ nom: "Test", date: "2026-12-03", pickup: "Hotel Test", heure: "09:00", dropoff: "Krabi Airport", personnes: { adultes: 2, enfants: 2 }, sieges: 2 });
  assert.ok(champs.some((c) => /2 child seats/.test(c.valeur)), "Booking confirmation");
  // Les trois rendus lisent details.sieges de la réservation.
  // Les trois rendus lisent les sièges par type de la réservation (details.sieges, sieges_bebe, sans_siege).
  assert.match(lire("src/gestion/js/views/voucher.mjs"), /siegesVoucher\(dt\)/);
  assert.match(lire("src/gestion/js/views/voucher-taxi.mjs"), /sieges: siegesLus\(dt\)/);
  assert.match(lire("src/gestion/js/views/voucher-secret.mjs"), /sieges: siegesLus\(dt\)/);
});

test("relecture 2 : un service du catalogue (offre non nulle) garde ses sièges jusqu'à la fiche de création", () => {
  const contexte = { prestations: donnees.prestations, trajets: [], partenaires: donnees.partenaires };
  const carte = { client: { nom: "Test" }, adultes: 2, enfants: 2, services: [{ texte: "Transfert", offre: { genre: "prestation", id: donnees.prestations[0].id }, date: "2026-12-03", adultes: 2, enfants: 2, sieges: 2, prix: 2500, origine_prix: "catalogue" }] };
  const { services } = propositionVersDemande(propositionDepuisCarte(carte), contexte);
  assert.equal(services[0].offres.length, 1, "l'offre du catalogue est là");
  assert.equal(services[0].sieges, 2, "et les sièges aussi");
});

test("relecture 3 et 7 : le champ sièges suit l'impression (transfert chez Secret, toujours chez Taxi, jamais chez ZTP) et reste visible tant qu'il a une valeur", async () => {
  const vue = lire("src/gestion/js/views/reservations.mjs");
  // Taxi : la Booking confirmation imprime toujours les sièges.
  assert.match(vue, /CHAMPS\.vol\(\), CHAMPS\.bagages\(\), CHAMPS\.sieges\(\)\), CHAMPS\.remarques\(\)\)/);
  // Secret : seulement le modèle « transfert » (voucher de transfert, Booking confirmation de Secret : estBookingSecret exige un transfert).
  assert.match(lire("src/gestion/js/taxi-calc.mjs"), /estBookingSecret = \(r, type, reglages\) => .*type === "transfert"/);
  assert.match(lire("src/gestion/js/operations-calc.mjs"), /transfert: \[[^\]]*"sieges"/);
  assert.doesNotMatch(lire("src/gestion/js/operations-calc.mjs"), /(?:bateau|activite|location|billet): \[[^\]]*"sieges"/);
  // Ailleurs, seulement tant qu'une valeur reste (transfert devenu excursion, location devenue transfert) ; jamais dans la grille des personnes.
  // Relecture de la PR 337 : hors des champs du modèle (un trajet du catalogue en transfert ne les demande pas), visible tant qu'il a une valeur.
  assert.match(vue, /const siegesHorsModele = m && !champsVoucherDe\(m, \{ trajet: !!r\.trajet_id \}\)\.includes\("sieges"\) && siegesSaisis\(\) > 0;/);
  assert.doesNotMatch(vue, /type === "location" \? null : CHAMPS\.sieges\(\)/);
  // ZTP : pas de voucher, pas de champ ; et la fiche de création n'y reprend jamais de sièges.
  assert.match(vue, /const avecVoucher = modeExcursions\(\) && !modeTaxi\(\);/);
  assert.equal((await import("../src/gestion/js/creation-voucher-calc.mjs")).saisieInitiale({ sieges: 2 }, { excursions: false }).sieges, 0);
  assert.match(lire("src/gestion/js/views/demande.mjs"), /saisieInitiale\(sv, \{ d, excursions: modeExcursions\(\)/);
  // Fiche de création : des sièges saisis restent visibles même si le modèle n'en imprime pas.
  assert.match(lire("src/gestion/js/views/champs-voucher.mjs"), /siegesTotal\(siegesLus\(\{ \.\.\.\(s\.details \|\| \{\}\), sieges: s\.sieges \}\)\) > 0 && !base\.includes\("sieges"\) \? \["sieges"\] : \[\]/);
});

test("relecture 4 : plus de sièges que d'enfants et de bébés, à vérifier (carte bloquée d'un geste, fiche à confirmer) ; au-delà de 10, refusé", async () => {
  const { siegesAVerifier } = await import("../src/gestion/js/agent-calc.mjs");
  const { siegesEnTrop, siegesIncomplets, SIEGES_MAX } = await import("../src/gestion/js/creation-voucher-calc.mjs");
  const dossier = (s, plus = {}) => ({ genre: "dossier", donnees: { adultes: 2, enfants: 1, bebes: 0, services: [{ adultes: 2, enfants: 1, ...s }], ...plus } });
  assert.equal(siegesAVerifier(dossier({ sieges: 1 })), false);
  assert.equal(siegesAVerifier(dossier({ sieges: 2 })), true);
  assert.equal(siegesAVerifier(dossier({ sieges: 2 }, { bebes: 1 })), false, "un bébé compte");
  assert.equal(siegesAVerifier({ genre: "reservation", donnees: { service: { adultes: 2, enfants: 0, sieges: 1 } } }), true);
  assert.equal(siegesEnTrop({ sieges: 3, enfants: 1, bebes: 1 }), true);
  assert.equal(siegesEnTrop({ sieges: 2, enfants: 1, bebes: 1 }), false);
  assert.equal(SIEGES_MAX, 10);
  assert.deepEqual(siegesIncomplets([{ sieges: 2 }, { ligneIds: ["l2"], sieges: 11 }]), { index: 1, ligneIds: ["l2"], champ: "sieges", code: "e_sieges_max" });
  assert.equal(siegesIncomplets([{ sieges: 10 }]), null);
  const agent = lire("src/gestion/js/views/agent.mjs");
  assert.match(agent, /else if \(siegesAVerifier\(c\)\) r = \{ ok: false, motif:/, "jamais validé d'un geste");
  assert.match(agent, /c\.statut === "proposee" && siegesAVerifier\(c\) \? \["sieges_a_verifier"\] : \[\]/, "dit sur la carte");
  const vue = lire("src/gestion/js/views/reservations.mjs");
  assert.match(vue, /if \(s > SIEGES_MAX\) erreurChamp\(champSieges/);
  assert.match(vue, /else if \(s > petits && siegesConfirmes !== cle\)/, "la fiche demande une confirmation, pas un refus");
  const demande = lire("src/gestion/js/views/demande.mjs");
  assert.match(demande, /trajetIncomplet\(parService\) \|\| siegesIncomplets\(parService\)/);
  assert.match(demande, /if \(siegesEnTrop\(\{ sieges: siegesTotal\(siegesLus\(\{ \.\.\.\(saisie\.details \|\| \{\}\), sieges: saisie\.sieges \}\)\), enfants: sv\.enfants, bebes: saisie\.bebes \}\)\) alertes\.push/);
  // Côté écran, plus de plafond silencieux.
  assert.equal(siegesCarte({ sieges: 12 }), 12);
});

test("relecture 5 et 6 : la duplication garde les sièges ; une modification se fusionne depuis la ligne d'origine", () => {
  const vue = lire("src/gestion/js/views/reservations.mjs");
  // Les sièges par type (enfant, bébé, « aucun ») suivent la copie.
  assert.match(vue, /\.\.\.detailsAvecSieges\(\{\}, siegesLus\(r\.details \|\| \{\}\)\), \.\.\.\(copie\.ids/);
  assert.match(vue, /export function formulaireReservation\(r, apres, \{ base = r, avantEnregistrer = null \} = \{\}\)/);
  assert.match(vue, /modifierProtege\("reservations", r\.id, valeurs, \{ base, arbitrer/);
  const agent = lire("src/gestion/js/views/agent.mjs");
  // Migration 133 : contrôle de la prise avant d'écrire, carte rendue à la fermeture.
  assert.match(agent, /\}, \{ base: r, avantEnregistrer: avantFenetre\(c\) \}\), \{ ferme: \(\) => \(rendreSiRien\(c\)\(\), revenir\(\)\) \}\);/, "Vérifier avant d'une modification");
  // Migration 133 : avec le contrôle de la carte juste avant d'écrire (avantEnregistrer).
  assert.match(lire("src/gestion/js/views/agent-valider.mjs"), /\{ base: ancienne \|\| valeurs, avantEnregistrer: /, "modification d'un geste");
});

test("fiche de réservation : le champ « Sièges enfant ou bébé » existe et la carte de l'Assistant dit les sièges", () => {
  assert.match(lire("src/gestion/js/views/champs-voucher.mjs"), /sieges: \(\) => champ\(tr\("Sièges enfant ou bébé"\)/);
  assert.match(lire("src/gestion/js/views/agent.mjs"), /siegesTexte\(s\)/);
});

test("carte « Modification » de l'Assistant : la date, puis les personnes changées font suivre la facture (comparaison à la ligne d'origine)", async () => {
  const { comparaisonEnregistrement } = await import("../src/gestion/js/carte-reservation-calc.mjs");
  const origine = { id: RES, dossier_id: "d1", date_service: "2026-12-03", personnes: { adultes: 2, enfants: 1 }, statut: "confirme", paye_sur_place: false, details: { ligne_id: "l1" } };
  // La fiche s'ouvre avec la réservation déjà modifiée par la carte ; ses valeurs enregistrées sont celles-là.
  const valeursDe = (x) => ({ date_service: x.date_service, personnes: x.personnes, statut: x.statut });
  const date = reservationModifiee(origine, { champ: "date", valeur: "2026-12-05" });
  const cDate = comparaisonEnregistrement(origine, valeursDe(date));
  assert.deepEqual([cDate.dateChangee, cDate.personnesChangees, cDate.avant.date_service, cDate.apres.date_service], [true, false, "2026-12-03", "2026-12-05"]);
  // L'ancien calcul (comparer à la réservation déjà modifiée) ne voyait rien : la facture ne suivait pas.
  assert.equal(comparaisonEnregistrement(date, valeursDe(date)).dateChangee, false);
  const gens = reservationModifiee(origine, { champ: "adultes", valeur: "4" });
  const cGens = comparaisonEnregistrement(origine, valeursDe(gens));
  assert.deepEqual([cGens.personnesChangees, cGens.dateChangee, cGens.avant.personnes.adultes, cGens.apres.personnes.adultes], [true, false, 2, 4]);
  assert.equal(comparaisonEnregistrement(gens, valeursDe(gens)).personnesChangees, false);
  // Une annulation proposée pose enfin la question de la facture (le formulaire habituel).
  assert.equal(comparaisonEnregistrement(origine, valeursDe(reservationModifiee(origine, { champ: "annulation", valeur: "annule" }))).annulee, true);
  // La fiche s'en sert : suivreFacture reçoit la ligne d'origine et son « avant ».
  const vue = lire("src/gestion/js/views/reservations.mjs");
  assert.match(vue, /const cmp = comparaisonEnregistrement\(base, valeurs, \{ surPlace: estSurPlace\(\) \}\);/);
  assert.match(vue, /await suivreFacture\(base, valeurs, \{ avant: cmp\.avant, apres: cmp\.apres,/);
  assert.match(vue, /if \(r\.id && \(dateChangee \|\| annulee\)\) await synchroniserDatesDossier/);
  // Et suivreFacture fait suivre la facture dès que la date ou les personnes diffèrent entre « avant » et « après ».
  assert.match(lire("src/gestion/js/views/suivi-facture.mjs"), /const dateChangee = \(apres\.date_service \|\| null\) !== \(avant\.date_service \|\| null\);/);
});
