// Trois demandes de Jérémy du 22.11.2026 sur l'Assistant. Données inventées, aucun appel réseau.
//   1. Calcul d'itinéraire seulement sur demande (supabase/functions/agent/itineraire.js).
//   2. Pas de long texte à la création d'un dossier : une ligne après la carte.
//   3. Message au client avec la Booking confirmation (Taxi) ou le voucher (Secret) : ses deux modèles, mot pour mot, adaptés au dossier
//      (src/gestion/js/message-voucher-calc.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OUTILS_ITINERAIRE, REFUS_RECALCUL, bloquerRecalcul, decisionItineraire, demandeItineraire, ligneItineraire, motsDeNani, naniAEcrit, parleDeLaDate, pickupDonnePourService } from "../supabase/functions/agent/itineraire.js";
import { executer, memoDepuis, OUTILS } from "../supabase/functions/agent/outils.js";
import { consignes, contexteDuJour } from "../supabase/functions/agent/prompt.js";
import { texteDepuisWhatsApp } from "../supabase/functions/agent/whatsapp.js";
import { variablesVoucher, sansLignesVides, pickupDuVoucher, phrasePaiement, PAIEMENT_CHAUFFEUR, DEJA_PAYE } from "../src/gestion/js/message-voucher-calc.mjs";
import { messageSousVoucher } from "../src/gestion/js/views/messages.mjs";
import { MESSAGES_DEFAUT, MESSAGES_TAXI, MESSAGES_VOUCHER_EXCURSIONS, messagesDefautPour } from "../src/gestion/js/defauts.mjs";
import { gabaritConfirmationVoucher, remplirGabarit } from "../src/gestion/js/operations-calc.mjs";

const lire = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ---- 1. Itinéraire seulement sur demande ---------------------------------------------------------------------------------------------
const CONV = { id: "00000000-0000-4000-8000-000000000001", telephone: "+447700900111" };
const joint = (messages, o = {}) => texteDepuisWhatsApp({ mode: "creer", conv: CONV, messages, ...o });
const msg = (texte, min = 0) => ({ sens: "entrant", texte, envoye_le: `2026-11-22T03:${String(min).padStart(2, "0")}:00Z` });

test("itinéraire : la demande de Nani se lit dans ses propres mots, en français, en anglais et en thaï (pour la ligne du contexte)", () => {
  for (const t of ["Combien de temps de l'hôtel au port ?", "À quelle heure partir pour le vol de 14h ?", "Calcule l'heure de pickup", "calcule-moi le pickup stp", "Quelle heure pour le pickup ?", "Quelle est la durée du trajet jusqu'à Ao Nang ?", "Est-ce tenable avec le ferry ?", "How long from the resort to Krabi Airport?", "How far is it?", "What time should they leave?", "ไปสนามบินใช้เวลากี่โมง"]) assert.equal(demandeItineraire(t), true, t);
  for (const t of ["Résume", "Résume l'itinéraire", "Qu'y a-t-il à faire ?", "Crée le dossier", "Le prix est 2500", "Merci"]) assert.equal(demandeItineraire(t), false, t);
  // Un client qui demande la durée dans l'échange joint ne compte pas ; la question de « Demander à l'assistant » compte.
  assert.equal(demandeItineraire(joint([msg("How long does the transfer take?")])), false);
  assert.equal(demandeItineraire(texteDepuisWhatsApp({ mode: "question", question: "Combien de temps jusqu'à l'aéroport ?", conv: CONV, messages: [] })), true);
  assert.match(ligneItineraire(decisionItineraire({ texte: "Résume l'itinéraire" })), /pas demandé dans ce message/);
});

test("itinéraire : jamais de refus quand Nani a écrit dans ce message ou ses 2 précédents ; dans le doute, on autorise", () => {
  assert.equal(motsDeNani(joint([msg("Pickup time: 11:00")])), "", "« Créer le dossier » : aucun mot de Nani");
  assert.equal(naniAEcrit({ texte: joint([]), modeWa: "creer" }), false);
  assert.equal(naniAEcrit({ texte: joint([]), modeWa: "creer", precedents: ["Note : c'est pour la famille Test", "ok", joint([])] }), true, "un de ses 2 messages précédents");
  assert.equal(naniAEcrit({ texte: joint([]), modeWa: "creer", precedents: ["c'est pour la famille Test", joint([]), joint([])] }), false, "au-delà de 2 messages, plus rien");
  // Avec des mots de Nani, même une formule que l'expression ne comprend pas : rien n'est bloqué.
  const formulaire = joint([msg("Transfer request: Test Lagoon Resort Koh Lanta to Fictive Palms Hotel Krabi Date: Wed 25 Nov 2026 Pickup time: 11:00 Guests: 2 adults")]);
  const appel = { date: "2026-11-25", points: [{ lieu: "Test Lagoon Resort, Koh Lanta" }, { lieu: "Fictive Palms Hotel, Krabi" }], heure_depart: "", heure_vol: "" };
  const avecNani = decisionItineraire({ texte: `${formulaire}`, precedents: ["ช่วยดูเวลารับให้หน่อย"], modeWa: "creer" });
  assert.equal(bloquerRecalcul("planifier_course", appel, avecNani), false);
  // Seuls ces outils existent ; temps_de_route, horaires_trajet et estimer_temps_web ne sont jamais bloqués.
  const sansNani = decisionItineraire({ texte: formulaire, modeWa: "creer" });
  for (const nom of ["temps_de_route", "horaires_trajet", "estimer_temps_web"]) assert.equal(bloquerRecalcul(nom, appel, sansNani), false, nom);
  assert.deepEqual(OUTILS_ITINERAIRE, ["temps_de_route", "planifier_course", "horaires_trajet", "estimer_temps_web"]);
});

test("itinéraire : le seul blocage, un pickup déjà donné pour CE service, recalculé pendant la création d'une carte", () => {
  const formulaire = joint([msg("Transfer request: Test Lagoon Resort Koh Lanta to Fictive Palms Hotel Krabi Date: Wed 25 Nov 2026 Pickup time: 11:00 Guests: 2 adults")]);
  const d = decisionItineraire({ texte: formulaire, modeWa: "creer" });
  const aller = { date: "2026-11-25", points: [{ lieu: "Test Lagoon Resort, Koh Lanta" }, { lieu: "Fictive Palms Hotel, Krabi" }], heure_depart: "", heure_vol: "" };
  assert.equal(bloquerRecalcul("planifier_course", aller, d), true, "même date, même lieu de départ : déjà donné");
  // Une heure de départ fournie : le calcul part du pickup donné, il ne le recalcule pas.
  assert.equal(bloquerRecalcul("planifier_course", { ...aller, heure_depart: "11:00" }, d), false);
  // Le retour, sans heure : se calcule (autre date, autre lieu de départ).
  assert.equal(bloquerRecalcul("planifier_course", { date: "2026-11-29", points: [{ lieu: "Fictive Palms Hotel, Krabi" }, { lieu: "Krabi Airport" }], heure_depart: "", heure_vol: "16:00" }, d), false);
  // Le client B d'un apporteur, même jour, autre hôtel : pas bloqué par le pickup du client A.
  const apporteur = joint([msg("Client A: Test Lagoon Resort, 25 Nov, pickup 08:00, 2 pax"), msg("Client B: Sunny Test Bungalows, 25 Nov, 2 pax, flight 15:30", 1)], { apporteur: true });
  const da = decisionItineraire({ texte: apporteur, modeWa: "creer" });
  assert.equal(bloquerRecalcul("planifier_course", { date: "2026-11-25", points: [{ lieu: "Sunny Test Bungalows, Koh Lanta" }], heure_depart: "", heure_vol: "15:30" }, da), false);
  assert.equal(bloquerRecalcul("planifier_course", { date: "2026-11-25", points: [{ lieu: "Test Lagoon Resort" }], heure_depart: "", heure_vol: "" }, da), true);
  // Dans le doute (date sans pickup, lieu introuvable, lieu vide) : on autorise.
  assert.equal(pickupDonnePourService(["Pickup time: 11:00"], { date: "2026-11-25", lieu: "Test Lagoon Resort" }), false, "sans date dans le segment");
  assert.equal(pickupDonnePourService(["25 Nov pickup 11:00 at the resort"], { date: "2026-11-25", lieu: "" }), false, "sans lieu de départ");
  for (const [s, iso] of [["Wed 25 Nov 2026", "2026-11-25"], ["25/11", "2026-11-25"], ["25.11.2026", "2026-11-25"], ["November 25th", "2026-11-25"], ["le 3 décembre", "2026-12-03"]]) assert.equal(parleDeLaDate(s, iso), true, s);
  assert.equal(parleDeLaDate("125 Nov", "2026-11-25"), false);
  assert.equal(parleDeLaDate("25 Dec", "2026-11-25"), false);
});

test("itinéraire : l'exécution ne refuse que le recalcul, sans rien lire ; sinon tout passe comme avant", async () => {
  let appels = 0;
  const ctx = (itineraire) => ({ permissions: [], charger: async () => (appels++, []), reglages: {}, itineraire });
  const formulaire = joint([msg("Transfer request: Test Lagoon Resort Koh Lanta to Fictive Palms Hotel Date: Wed 25 Nov 2026 Pickup time: 11:00")]);
  const d = decisionItineraire({ texte: formulaire, modeWa: "creer" });
  const entree = { date: "2026-11-25", points: [{ lieu: "Test Lagoon Resort, Koh Lanta", attente_min: 0, source_duree: "", arrivee_voulue: "", duree_vers_suivant_min: 0 }], heure_depart: "", heure_vol: "", vol_international: false };
  const r = await executer("planifier_course", entree, ctx(d), memoDepuis([], {}));
  assert.deepEqual([r.erreur, r.contenu.erreur], [true, "pickup_deja_donne"]);
  assert.equal(r.contenu, REFUS_RECALCUL);
  assert.match(REFUS_RECALCUL.conseil, /reprends-la telle quelle/);
  assert.equal(appels, 0, "rien n'est lu ni calculé");
  // Hors de ce cas (ici une question de Nani), l'outil s'exécute.
  const libre = await executer("horaires_trajet", { de: "A", vers: "B", date: "", adultes: 0, enfants: 0 }, ctx(decisionItineraire({ texte: "Résume" })), memoDepuis([], {}));
  assert.notEqual(libre.contenu.erreur, "pickup_deja_donne");
  for (const nom of OUTILS_ITINERAIRE) assert.match(OUTILS.find((o) => o.name === nom).description, /Calcul d'itinéraire/, nom);
  assert.doesNotMatch(OUTILS.find((o) => o.name === "planifier_course").description, /Toujours utiliser cet outil pour donner une heure de pickup/);
});

test("itinéraire : consigne, contexte de l'échange et branchement de la fonction", () => {
  const c = consignes({ entreprise: "VIP Taxi Lanta", reglages: { fonctionnement: "taxi" }, prenomEquipe: "Nani" });
  assert.match(c, /Calcul d'itinéraire seulement sur demande/);
  assert.match(c, /Une demande peut venir en thaï, d'une relance ou d'une tournure libre : dans le doute, calcule\./);
  assert.match(c, /Une heure de pickup donnée par le client ou par Nani se reprend telle quelle dans la carte : jamais recalculée/);
  assert.doesNotMatch(c, /Une heure de pickup se calcule toujours avec planifier_course/);
  assert.doesNotMatch(c, /hors de ces cas, l'outil refuse/);
  assert.match(contexteDuJour({ aujourdhui: "2026-11-22", jour: "dimanche", itineraire: ligneItineraire(decisionItineraire({ texte: "Résume" })) }), /Calcul d'itinéraire : pas demandé dans ce message/);
  assert.match(ligneItineraire(decisionItineraire({ texte: joint([]), modeWa: "creer" })), /seulement pour une heure de prise en charge qui manque/);
  assert.doesNotMatch(contexteDuJour({ aujourdhui: "2026-11-22", jour: "dimanche" }), /Calcul d'itinéraire/);
  const f = lire("supabase/functions/agent/index.ts");
  assert.match(f, /const textesGardes = \(\[\.\.\.\(anciens\.data \|\| \[\]\)\]\.reverse\(\)/, "dans l'ordre : les 2 derniers sont les plus récents");
  assert.match(f, /const itineraire = decisionItineraire\(\{ texte: message, precedents: textesGardes, modeWa: waId \? waMode : "" \}\);/);
  assert.match(f, /const ctx = \{ itineraire, /);
  const t = joint([]);
  assert.doesNotMatch(t, /pickups calculés/);
  assert.match(t, /pickup repris de la conversation \(calculé seulement s'il manque\)/);
});

// ---- 2. Une ligne après la carte ----------------------------------------------------------------------------------------------------
test("après une carte dossier, réservation ou course : une ligne, la seule question utile, aucun récapitulatif", () => {
  const c = consignes({ entreprise: "Secret Travel & Tour", reglages: { fonctionnement: "excursions" }, prenomEquipe: "Nani" });
  assert.match(c, /Après une carte dossier, réservation ou course \(proposer_dossier, proposer_reservation, proposer_course\), ta réponse tient en une ligne : « Dossier prêt, à vérifier\. », plus, s'il le faut, la seule question dont la réponse change la réservation\. Aucun récapitulatif, aucune liste, aucun détail de trajet : la carte montre déjà tout/);
  // Plus de consigne qui pousse à détailler le trajet après coup.
  assert.doesNotMatch(c, /Donne le pickup, l'heure d'arrivée à chaque point \(prévue et au plus tard\) et les hypothèses de marge/);
  assert.match(c, /Quand Nani demande le détail, montre-le/);
  assert.match(c, /pour que Nani le vérifie d'un coup d'œil, sauf quand une carte le montre déjà/);
});

// ---- 3. Message avec la confirmation ou le voucher -----------------------------------------------------------------------------------
const TAXI_JEREMY = `Thank you for choosing VIP TAXI LANTA. ✨

Please see the attached confirmation and show it to the driver at pick-up.
Let us know if everything is correct

Payment will be collected in cash directly by the driver (or you can pay through Wise before your transfer (3% fee), please let us know before.)

If you have any changes, please inform us as soon as possible.

Have a nice day ☀️
VIP TAXI LANTA 🌴`;
const SECRET_JEREMY = `Thank you for booking with Secret Travel & Tour. ✨

Please find your voucher attached and keep it on your phone for the day of your activity.
Let us know if everything is correct.

Your pickup will be at 08:30 at Lanta Resort.

If anything changes, please let us know as soon as possible.

Have a nice day ☀️
Secret Travel & Tour 🌴`;
// Le même chemin que l'écran (views/voucher-envoi.mjs, messageClientVoucher) : le modèle de l'entreprise, ses variables, sans ligne vide.
const rendu = (reglages, { reservation = {}, type = "", trajet = false, paiement = "en_attente", solde = null, entreprise }) => sansLignesVides(remplirGabarit(gabaritConfirmationVoucher([], messagesDefautPour(reglages)), { entreprise, ...variablesVoucher({ reservation, type, trajet, paiement, solde, devise: "THB", entreprise }) }));
const TAXI = { fonctionnement: "taxi" };
const SECRET = { fonctionnement: "excursions" };
export const EXEMPLES = {
  taxi_paye_chauffeur: rendu(TAXI, { entreprise: "VIP Taxi Lanta", type: "transfert", paiement: "sur_place", reservation: { heure_pickup: "11:00", lieu_pickup: "Test Lagoon Resort" } }),
  taxi_deja_paye: rendu(TAXI, { entreprise: "VIP Taxi Lanta", type: "transfert", paiement: "paye", reservation: { heure_pickup: "11:00", lieu_pickup: "Test Lagoon Resort" } }),
  taxi_acompte: rendu(TAXI, { entreprise: "VIP Taxi Lanta", type: "transfert", paiement: "acompte", solde: 1500, reservation: { heure_pickup: "11:00" } }),
  secret_excursion: rendu(SECRET, { entreprise: "Secret Travel & Tour", type: "excursion", reservation: { heure_pickup: "08:30", lieu_pickup: "Lanta Resort" } }),
  secret_transfert: rendu(SECRET, { entreprise: "Secret Travel & Tour", type: "transfert", reservation: { heure_pickup: "09:15", lieu_pickup: "Fictive Palms Hotel" } }),
};

test("Taxi : le modèle de Jérémy mot pour mot ; déjà payé ou acompte, la phrase de paiement change", () => {
  assert.equal(EXEMPLES.taxi_paye_chauffeur, TAXI_JEREMY, "mot pour mot, signature comprise");
  assert.equal(rendu(TAXI, { entreprise: "VIP Taxi Lanta", type: "transfert", paiement: "en_attente" }), TAXI_JEREMY, "rien reçu : la phrase de Jérémy telle quelle");
  assert.equal(EXEMPLES.taxi_deja_paye, TAXI_JEREMY.replace(PAIEMENT_CHAUFFEUR, DEJA_PAYE));
  assert.doesNotMatch(EXEMPLES.taxi_deja_paye, /cash|Wise/);
  assert.equal(DEJA_PAYE, "Your transfer is already paid.");
  // Acompte reçu, solde réel du dossier (relecture de la PR 328, point 4).
  assert.equal(EXEMPLES.taxi_acompte, TAXI_JEREMY.replace(PAIEMENT_CHAUFFEUR, "The remaining 1,500 THB will be collected in cash directly by the driver."));
  assert.equal(phrasePaiement({ paiement: "acompte", solde: 0 }), PAIEMENT_CHAUFFEUR, "un acompte sans solde connu : la phrase de Jérémy");
  assert.equal(phrasePaiement({ paiement: "acompte", solde: 2250.5, devise: "THB" }), "The remaining 2,250.5 THB will be collected in cash directly by the driver.");
  const m = MESSAGES_TAXI.find((x) => x.id === "taxi-voucher-en");
  assert.deepEqual([m.pour, m.cle, m.langue], ["client", "voucher", "en"]);
  assert.ok(MESSAGES_TAXI.some((x) => x.id === "taxi-rappel-en" && x.cle === "rappel"), "le point du soir garde son rappel");
});

test("Secret : le modèle de Jérémy mot pour mot ; le pickup de la réservation seulement, comme le voucher l'imprime", () => {
  assert.equal(EXEMPLES.secret_excursion, SECRET_JEREMY, "mot pour mot, signature comprise");
  assert.match(EXEMPLES.secret_transfert, /for the day of your transfer\.\n/);
  assert.match(EXEMPLES.secret_transfert, /\n\nYour pickup will be at 09:15 at Fictive Palms Hotel\.\n\n/);
  // Rien sur la réservation : pas de ligne, jamais l'hôtel de la fiche client (le calcul ne reçoit que la réservation).
  const sans = rendu(SECRET, { entreprise: "Secret Travel & Tour", type: "excursion", reservation: { heure_pickup: "", lieu_pickup: "" } });
  assert.equal(sans, SECRET_JEREMY.replace("Your pickup will be at 08:30 at Lanta Resort.\n\n", ""));
  assert.equal(pickupDuVoucher({ heure_pickup: "", lieu_pickup: "" }, { type: "excursion" }), null);
  // Location : jamais de ligne. Billet ou bateau sans pickup inclus (pas de trajet, pas de lieu) : pas de ligne non plus.
  assert.doesNotMatch(rendu(SECRET, { entreprise: "Secret Travel & Tour", type: "location", reservation: { heure_pickup: "09:00", lieu_pickup: "Lanta Resort" } }), /pickup/i);
  assert.equal(pickupDuVoucher({ heure_pickup: "10:30" }, { type: "billet", trajet: false }), null);
  assert.deepEqual(pickupDuVoucher({ heure_pickup: "08:00" }, { type: "billet", trajet: true }), { heure: "08:00", lieu: "" }, "trajet du catalogue avec pickup inclus");
  assert.deepEqual(pickupDuVoucher({ lieu_pickup: "Saladan Pier" }, { type: "bateau" }), { heure: "", lieu: "Saladan Pier" });
  // Ce qui est connu seulement : une heure sans lieu, un lieu sans heure.
  assert.match(rendu(SECRET, { entreprise: "Secret Travel & Tour", type: "excursion", reservation: { heure_pickup: "08:30" } }), /\nYour pickup will be at 08:30\.\n/);
  assert.match(rendu(SECRET, { entreprise: "Secret Travel & Tour", type: "excursion", reservation: { lieu_pickup: "Saladan Pier" } }), /\nYour pickup will be at Saladan Pier\.\n/);
  // {jour} : « trip » pour un billet ou un bateau de transport, « transfer » pour un transfert, « activity » sinon.
  for (const [type, jour] of [["billet", "trip"], ["bateau", "trip"], ["transfert", "transfer"], ["excursion", "activity"], ["activite", "activity"], ["location", "activity"]]) assert.equal(variablesVoucher({ type }).jour, jour, type);
  // Rangé avec les modèles des excursions, à part de MESSAGES_DEFAUT (la migration 44 a enregistré ceux-là pour ZTP, verif-noms-marques).
  const m = MESSAGES_VOUCHER_EXCURSIONS.find((x) => x.id === "voucher-en");
  assert.ok(!MESSAGES_DEFAUT.some((x) => x.cle === "voucher"), "ZTP et les voyages sur mesure ne reçoivent pas ce modèle");
  assert.ok(messagesDefautPour(SECRET).some((x) => x.id === "voucher-en"));
  assert.deepEqual([m.pour, m.cle, m.langue], ["client", "voucher", "en"]);
});

test("message avec le voucher : l'envoi direct, le lien wa.me et les cartes de l'Assistant ; une réservation par voucher", () => {
  const vue = lire("src/gestion/js/views/voucher-envoi.mjs");
  assert.match(vue, /const trajet = !!sourcesVoucher\(r, x\.prestation \|\| null\)\.trajet;/);
  assert.match(vue, /\.\.\.variablesVoucher\(\{ reservation: r, type: x\.type, trajet, paiement, solde: pay\.surPlace \|\| pay\.verse !== null \? pay\.reste : res\.reste > 0 \? res\.reste : null, devise, entreprise: nomEntreprise \}\)/);
  assert.match(vue, /const pay = paiementDuService\(r, \{ resume: res \}\);\n  const paiement = pay\.statut;/);
  assert.doesNotMatch(vue, /hotelEtChambre/, "jamais l'hôtel de la fiche client pour le pickup");
  assert.doesNotMatch(vue, /x\.reservations/, "plus de code pour un voucher à plusieurs réservations : vouchersDuDossier en rend une par voucher");
  assert.match(vue, /return sansLignesVides\(message\);/);
  assert.match(vue, /const message = \{ client: messageClientVoucher\(x\) \};/, "lien wa.me et envoi depuis l'écran");
  assert.match(lire("src/gestion/js/views/agent-cartes-voucher.mjs"), /legende: messageClientVoucher\(x\)/, "cartes « Voucher » de l'Assistant");
  const voucher = lire("src/gestion/js/views/voucher.mjs");
  assert.match(voucher, /export function sourcesVoucher\(r, prestationLive\)/);
  assert.match(voucher, /const pickupInclus = !!\(r\.heure_pickup \|\| r\.lieu_pickup\) && \(!!trajet \|\| !!r\.lieu_pickup\);/, "la même règle que pickupDuVoucher");
  assert.match(voucher, /return \{ reservation: r, prestation, type: modeleDe\(r, sourcesVoucher\(r, prestation\), taxi\) \};/, "une réservation par voucher");
  assert.match(lire("src/gestion/js/operations-calc.mjs"), /for \(const cle of \["voucher", "confirmation"\]\)/);
});

test("écran Messages : l'usage « Message avec le voucher » et la note « Utilisé sous le voucher »", () => {
  const messages = lire("src/gestion/js/views/messages.mjs");
  assert.match(messages, /\{ cle: "voucher", pour: "client", libelle: N_\("Message avec le voucher"\), modes: \["excursions", "taxi"\] \}/);
  assert.match(messages, /Message avec le voucher : \{pickup\} \{jour\} \{paiement\} \{ENTREPRISE\}/);
  assert.match(messages, /sousVoucher && !sousVoucher\.defaut && sousVoucher\.id === m\.id \? h\("span", \{ class: "tag tag-voucher" \}, tr\("Utilisé sous le voucher"\)\) : null/);
  assert.match(messages, /tr\("Utilisé sous le voucher : le modèle de départ « \{titre\} »\.", \{ titre: sousVoucher\.titre \}\)/);
  // Le message choisi, comme gabaritConfirmationVoucher : un « voucher » enregistré, sinon le modèle de départ, sinon la confirmation.
  const conf = { id: "c1", pour: "client", cle: "confirmation", langue: "en", titre: "Confirmation", corps: "Hello {prenom}" };
  const vouch = { id: "v1", pour: "client", cle: "voucher", langue: "en", titre: "Mine", corps: "Thanks" };
  assert.equal(messageSousVoucher([conf, vouch], messagesDefautPour(SECRET)).id, "v1");
  const defaut = messageSousVoucher([conf], messagesDefautPour(SECRET));
  assert.deepEqual([defaut.defaut, defaut.titre], [true, "Message with the voucher"]);
  assert.equal(messageSousVoucher([conf], []).id, "c1");
  const en = lire("src/gestion/js/i18n-en.mjs");
  assert.match(en, /"Utilisé sous le voucher": "Used with the voucher"/);
  assert.match(en, /"Message avec le voucher": "Message with the voucher"/);
});
