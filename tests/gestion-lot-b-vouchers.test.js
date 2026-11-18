// Lot B du 17.11.2026 (audit d'autonomie du 16.11.2026) : vouchers figés à l'envoi, modèle choisi, Payment Pending, prix par personne,
// dossier annulé, chauffeur Taxi, check-in de la fiche, « Pas envoyé », textes réglables, fenêtre des commissions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { typeVoucher, typeVoucherDeduit, modeleChoisi, reservationsDepuisDocument, numerosVouchers, statutPaiementVoucher, prixParPersonneVoucher, empreinteVoucher, voucherFige, valeursFigees, detailsSansEnvoi, detailsAvecEnvoi, etatEnvoisVouchers, embarcadereFiche, consigneCheckinFiche } from "../src/gestion/js/operations-calc.mjs";
import { envoiANoter } from "../src/gestion/js/envoi-voucher-calc.mjs";
import { gestePrincipal, entreesMenu } from "../src/gestion/js/carte-reservation-calc.mjs";
import { actionSuivante } from "../src/gestion/js/dossier-resume-calc.mjs";
import { partenaireDeTaxi, chauffeurAChoisir, chauffeurRegle } from "../src/gestion/js/voucher-rapide-calc.mjs";
import { BUNDHAYA, DESTINATIONS } from "./fixtures/regles-partenaires-anais.mjs";
import { textesVoucher, DEFAUTS_TEXTES, GROUPES_VOUCHER, GROUPES_BOOKING, textesAEnregistrer } from "../src/gestion/js/textes-voucher.mjs";
import { champsBooking, prixBooking, joursCommission, commissionsADemander, PIED_BOOKING } from "../src/gestion/js/taxi-calc.mjs";

test("n° 23 : le modèle choisi sur la réservation passe avant la déduction par les mots du libellé", () => {
  const van = { libelle: "Private van to Krabi" };
  assert.equal(typeVoucher(van, null), "transfert", "sans choix : la déduction d'avant sert de défaut");
  assert.equal(typeVoucher({ ...van, details: { modele_voucher: "activite" } }, null), "activite");
  assert.equal(typeVoucher({ ...van, details: { modele_voucher: "aucun" } }, null), null, "« Pas de voucher »");
  assert.equal(typeVoucher({ ...van, details: { modele_voucher: "n'importe quoi" } }, null), "transfert", "une valeur inconnue est ignorée");
  assert.equal(typeVoucherDeduit({ ...van, details: { modele_voucher: "activite" } }, null), "transfert", "la déduction ne lit pas le choix");
  assert.equal(modeleChoisi({ details: { modele_voucher: "billet" } }), "billet");
  assert.equal(modeleChoisi({}), "");
});

test("n° 23 : « Autre prestation » donne son modèle et son net à la réservation créée", () => {
  const ligne = { id: "l1", kind: "ligne", libre: true, libelle: "Speedboat charter", unite: 5000, qte: 1, partenaire_id: "p1", date_service: "2026-12-01", net: 4000, modele_voucher: "bateau" };
  const [x] = reservationsDepuisDocument({ dossier_id: "d1", contenu: { lignes: [ligne] } }, { uid: () => "r1" });
  assert.equal(x.reservation.details.modele_voucher, "bateau");
  assert.equal(x.net, 4000, "le net part vers la table protégée, la marge ne compte plus toute la vente");
  const [y] = reservationsDepuisDocument({ dossier_id: "d1", contenu: { lignes: [{ ...ligne, modele_voucher: undefined }] } }, { uid: () => "r2" });
  assert.equal("modele_voucher" in y.reservation.details, false, "sans choix, rien n'est posé");
});

test("n° 25 : un numéro envoyé ne change plus ; les vouchers jamais envoyés prennent un numéro libre", () => {
  assert.deepEqual(numerosVouchers([{}, {}, {}]), [1, 2, 3], "sans envoi : l'ordre de création");
  // Le premier service est supprimé : le 2 (envoyé) le reste, le dernier garde 3 au lieu de prendre 2.
  assert.deepEqual(numerosVouchers([{ fige: 2 }, {}]), [2, 3]);
  // Un service passé en option avant un voucher envoyé n° 3 : le premier non envoyé reprend 1, l'autre 2.
  assert.deepEqual(numerosVouchers([{}, {}, { fige: 3 }]), [1, 2, 3]);
  assert.deepEqual(numerosVouchers([{}, { fige: 1 }]), [2, 1], "un rang déjà pris par un envoi passe au suivant libre");
  // Un voucher envoyé (n° 1) dont le service passe ensuite à « Pas de voucher » garde son numéro réservé (dernière entrée, hors liste).
  assert.deepEqual(numerosVouchers([{}, { fige: 1 }]).slice(0, 1), [2]);
});

test("n° 26 : rien reçu et pas payé sur place, c'est « Payment Pending », plus « à payer sur place »", () => {
  assert.equal(statutPaiementVoucher({ total: 2000, recu: 0 }), "en_attente");
  assert.equal(statutPaiementVoucher({ total: 2000, recu: 0, surPlace: true }), "sur_place");
  assert.equal(statutPaiementVoucher({ total: 2000, recu: 500 }), "acompte");
  assert.equal(statutPaiementVoucher({ total: 2000, recu: 2000 }), "paye");
});

test("n° 27 : le prix par personne ne s'imprime que s'il n'y a qu'un tarif connu", () => {
  const pp = { unite: "pp", prix_vente: 1200 };
  assert.equal(prixParPersonneVoucher({ prestation: pp, montant: 2400, adultes: 2 }), 1200);
  assert.equal(prixParPersonneVoucher({ prestation: pp, montant: 3000, adultes: 2, enfants: 1 }), null, "l'enfant paie moins : pas de moyenne");
  assert.equal(prixParPersonneVoucher({ prestation: pp, montant: 3600, adultes: 2, enfants: 1 }), 1200, "tout le monde au même prix");
  assert.equal(prixParPersonneVoucher({ prestation: { ...pp, details: { enfant: 1200 } }, montant: 3600, adultes: 2, enfants: 1, tarifEnfant: { unite: "ch", prix_vente: 1200 } }), null, "un tarif enfant est connu (prix enfant ou prestation séparée) : deux tarifs");
  assert.equal(prixParPersonneVoucher({ prestation: { unite: "grp", prix_vente: 5000 }, montant: 5000, adultes: 4 }), null, "prix de groupe");
  assert.equal(prixParPersonneVoucher({ prestation: null, montant: 5000, adultes: 4 }), null, "hors catalogue : peut-être un prix de groupe");
  assert.equal(prixParPersonneVoucher({ prestation: pp, montant: 1000, adultes: 3 }), null, "ne tombe pas juste au centime");
  assert.equal(prixParPersonneVoucher({ prestation: pp, montant: null, adultes: 2 }), null);
});

test("n° 24 : l'empreinte change avec ce qui s'imprime, pas avec les notes ni les traces", () => {
  const r = { libelle: "4 Islands", date_service: "2026-12-10", heure_pickup: "08:00", lieu_pickup: "Hotel A", personnes: { adultes: 2 }, montant_vente: 2400, partenaire_id: "p", details: { remarques: "Window seat" }, notes: "interne" };
  const c = { prenom: "Jane", nom: "Doe", telephone: "+44 1", adresse: "Hotel A\nRoom 2" };
  const base = empreinteVoucher({ reservation: r, client: c, statut: "paye", devise: "THB" });
  assert.match(base, /^[0-9a-f]{8}$/);
  const meme = (x, cc = c, statut = "paye") => empreinteVoucher({ reservation: x, client: cc, statut, devise: "THB" }) === base;
  assert.ok(meme({ ...r, notes: "autre note" }), "note interne");
  assert.ok(meme({ ...r, details: { ...r.details, envois: { client: "2026-11-17" }, voucher_fige: { index: 1 }, avis_demande_le: "2026-12-11" } }), "traces d'envoi et d'avis");
  assert.ok(meme({ ...r, heure_pickup: " 08:00 " }), "espaces autour");
  assert.ok(!meme({ ...r, heure_pickup: "09:00" }), "heure de pickup");
  assert.ok(!meme({ ...r, details: { remarques: "Aisle seat" } }), "remarques imprimées");
  assert.ok(!meme({ ...r, details: { ...r.details, modele_voucher: "activite" } }), "modèle choisi");
  assert.ok(!meme(r, { ...c, nom: "Smith" }), "nom du client");
  // Contrôle du 17.11.2026, D6 : un paiement reçu ne fait pas repasser le voucher « à renvoyer ». Seul le paiement sur place compte.
  assert.ok(meme(r, c, "acompte"), "statut de paiement de l'agence ignoré");
  assert.ok(meme(r, c, "paye"), "facture soldée ignorée");
  assert.ok(!meme(r, c, "sur_place"), "payé sur place : compte");
});

test("n° 22 et 25 : la trace figée garde le numéro du premier envoi, et ne vaut que pour le même service", () => {
  const r = { prestation_id: "pr1", trajet_id: null, partenaire_id: "p1" };
  const premier = voucherFige({ reservation: r, index: 2, numero: "INV-1-2", empreinte: "aaaa", valeurs: { modele: "bateau" }, date: "2026-11-17" });
  assert.equal(premier.numero, "INV-1-2");
  const renvoi = voucherFige({ reservation: r, index: 1, numero: "INV-1-1", empreinte: "bbbb", valeurs: { modele: "bateau" }, date: "2026-11-18", avant: premier });
  assert.deepEqual([renvoi.index, renvoi.numero, renvoi.empreinte, renvoi.le, renvoi.premier_le], [2, "INV-1-2", "bbbb", "2026-11-18", "2026-11-17"]);
  assert.deepEqual(valeursFigees({ ...r, details: { voucher_fige: premier } }), { modele: "bateau" });
  assert.equal(valeursFigees({ ...r, partenaire_id: "p2", details: { voucher_fige: premier } }), null, "autre partenaire choisi sur la réservation : le voucher suit");
  assert.equal(valeursFigees(r), null);
});

test("n° 62 : « Pas envoyé » efface l'envoi et ce qui avait été figé", () => {
  const d = { remarques: "x", envois: { client: "2026-11-17", prestataire: "2026-11-16" }, voucher_fige: { index: 1 } };
  assert.deepEqual(detailsSansEnvoi(d), { remarques: "x", envois: { prestataire: "2026-11-16" } });
  assert.deepEqual(detailsSansEnvoi({ envois: { client: "2026-11-17" }, voucher_fige: {} }), {});
  assert.deepEqual(detailsSansEnvoi(detailsAvecEnvoi({}, "client", "2026-11-17")), {});
});

test("n° 24 : un voucher modifié depuis l'envoi redevient l'étape suivante et le geste principal", () => {
  const r1 = { id: "a", statut: "confirme", details: { envois: { client: "2026-11-17" } } };
  const r2 = { id: "b", statut: "confirme", details: { envois: { client: "2026-11-17" } } };
  assert.deepEqual(etatEnvoisVouchers([r1, r2]), { total: 2, client: 2, complet: true });
  assert.deepEqual(etatEnvoisVouchers([r1, r2], { modifies: new Set(["b"]) }), { total: 2, client: 1, complet: false, aRenvoyer: 1 });
  assert.equal(gestePrincipal({ statut: "confirme", ecrit: true, voucher: { envoye: true } }), null);
  assert.equal(gestePrincipal({ statut: "confirme", ecrit: true, voucher: { envoye: true, modifie: true } }), "voucher");
  assert.ok(!entreesMenu({ statut: "confirme", ecrit: true, voucher: { envoye: true, modifie: true } }).includes("voucher"), "pas deux fois");
  const droit = { finances: true, docs: true, paiements: true };
  const vx = (modifie) => [{ reservation: r1, envoi: { le: "2026-11-17", modifie } }];
  assert.equal(actionSuivante({ excursions: true, vouchers: vx(false), droit }), null);
  assert.equal(actionSuivante({ excursions: true, vouchers: vx(true), droit }).cle, "voucher");
  assert.equal(envoiANoter({ pour: "client", issue: "partage", envois: { client: "2026-11-17" }, date: "2026-11-17" }), null, "image recopiée le même jour");
  assert.equal(envoiANoter({ pour: "client", issue: "partage", envois: { client: "2026-11-17" }, date: "2026-11-17", modifie: true }), "client", "renvoi du jour d'une version modifiée : à figer");
});

test("n° 48 : embarcadère et check-in lus dans la fiche de la compagnie avant les règles écrites en dur", () => {
  const avecPoints = { nom: "Bundhaya Speed Boat", contact: { embarcadere: "Pakbara Pier" }, regles: { points_embarquement: [{ lieu: "Koh Lanta", ou: "Saladan Pier" }] } };
  assert.equal(embarcadereFiche(avecPoints, "Koh Lanta"), "Saladan Pier");
  assert.equal(embarcadereFiche(avecPoints, "Koh Lipe"), "", "des points par lieu, aucun pour ce départ : rien de deviné");
  assert.equal(embarcadereFiche({ contact: { embarcadere: "Bureau Satun au Pakbara Pier" } }, "Koh Lipe"), "Satun office at Pakbara Pier", "embarcadère général, en anglais");
  assert.equal(embarcadereFiche(null, "x"), "");
  const avecConsigne = { nom: "Bundhaya Speed Boat", regles: { checkin_voucher: "Check-in 1 hour before, counter 3." } };
  assert.equal(consigneCheckinFiche(avecConsigne, { de: "Koh Lanta", vers: "Koh Lipe" }), "Check-in 1 hour before, counter 3.");
  assert.match(consigneCheckinFiche(avecConsigne, { de: "Koh Lipe", vers: "Langkawi" }, DESTINATIONS), /passport/i, "Langkawi (destination à passeport des réglages) garde la consigne de l'immigration");
  assert.match(consigneCheckinFiche(BUNDHAYA, { de: "Koh Lanta" }, DESTINATIONS), /45 minutes before departure/, "la consigne écrite par la migration 43 sur la fiche de Bundhaya");
  assert.match(consigneCheckinFiche({ nom: "Bundhaya Speed Boat", regles: {} }, { de: "Koh Lanta" }), /30 minutes before departure/, "sans consigne dans la fiche : la consigne générale, plus rien d'après le nom");
});

test("n° 43 : les courses Taxi vont au chauffeur réglé, la case « taxi par défaut » de la fiche n'est plus qu'un défaut", () => {
  const P = [{ id: "a", nom: "Lanta Cars" }, { id: "b", nom: "VIP Taxi Lanta", taxi_defaut: true }, { id: "c", nom: "Second Taxi", actif: false, taxi_defaut: true }];
  assert.equal(partenaireDeTaxi(P).id, "b", "défaut d'avant");
  assert.equal(partenaireDeTaxi(P, "a").id, "a", "le réglage l'emporte");
  assert.equal(partenaireDeTaxi(P, "c").id, "b", "un chauffeur réglé mais désactivé ne reçoit plus de course");
  assert.equal(chauffeurAChoisir(P, null), true, "deux actifs sans réglage : à choisir");
  assert.equal(chauffeurAChoisir(P, "a"), false);
  assert.equal(chauffeurAChoisir([P[1]], null), false, "un seul partenaire : rien à choisir");
  assert.equal(chauffeurRegle({ taxi: { chauffeur_id: "a" } }), "a");
  assert.equal(chauffeurRegle({}), null);
});

test("n° 46 : la fenêtre des commissions à demander se règle, sans limite par défaut", () => {
  assert.equal(joursCommission({}), null);
  assert.equal(joursCommission({ taxi: { jours_commission: 30 } }), 30);
  assert.equal(joursCommission({ taxi: { jours_commission: 0 } }), null);
  assert.equal(joursCommission({ taxi: { jours_commission: "abc" } }), null);
  const R = [{ id: "vieille", date_service: "2026-08-01", statut: "confirme", paye_sur_place: true }];
  assert.equal(commissionsADemander(R, "2026-11-17").length, 1, "une course de trois mois sans commission reste à demander");
  assert.equal(commissionsADemander(R, "2026-11-17", { jours: 30 }).length, 0);
});

test("textes réglables : un défaut par clé, le texte saisi le remplace, un texte vide revient au défaut", () => {
  const cles = [...GROUPES_VOUCHER, ...GROUPES_BOOKING].flatMap((g) => g.cles.map(([k]) => k));
  assert.equal(new Set(cles).size, cles.length, "aucune clé en double");
  const t = textesVoucher({ voucher: { textes: { nom_client: "Name", licence: "  ", b_tous_frais: "(fees included)" } } });
  assert.equal(t("nom_client"), "Name");
  assert.equal(t("licence"), "TAT licence", "espaces seuls : le défaut");
  assert.equal(t("titre_bateau"), "Boat Tour Voucher");
  assert.equal(textesVoucher(null)("en_attente"), "Payment Pending");
  assert.equal(PIED_BOOKING.paiement_wise, DEFAUTS_TEXTES.b_paiement_wise, "la mention Wise reste telle quelle (décision 6)");
  assert.equal(prixBooking(2700, "THB"), "2'700 THB (all fees included)");
  assert.equal(prixBooking(2700, "THB", t), "2'700 THB (fees included)");
  assert.deepEqual(textesAEnregistrer({ nom_client: "Guest Name", chambre: "Room", hotel: " " }), { chambre: "Room" }, "seul ce qui diffère du défaut s'enregistre");
});

test("Booking confirmation : intitulés réglables et champ « Remarks » imprimé seulement s'il est rempli", () => {
  const base = { nom: "A", date: "2026-11-20", pickup: "Hotel", heure: "10:00", dropoff: "Airport", personnes: { adultes: 2 }, montant: 1500 };
  const sans = champsBooking(base);
  assert.deepEqual(sans.map((c) => c.cle), ["NAME", "DATE", "PICK UP LOCATION", "PICK UP TIME", "DROP OFF LOCATION", "PASSENGERS", "TOTAL PRICE"], "le modèle d'Anaïs, inchangé");
  const avec = champsBooking({ ...base, remarques: " Baby seat ready " });
  assert.deepEqual(avec[avec.length - 1], { cle: "REMARKS", valeur: "Baby seat ready" });
  const t = textesVoucher({ voucher: { textes: { b_nom: "GUEST" } } });
  assert.equal(champsBooking({ ...base, t })[0].cle, "GUEST");
});
