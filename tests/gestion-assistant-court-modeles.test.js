// Trois demandes de Jérémy du 22.11.2026 sur l'Assistant. Données inventées, aucun appel réseau.
//   1. Calcul d'itinéraire seulement sur demande (supabase/functions/agent/itineraire.js).
//   2. Pas de long texte à la création d'un dossier : une ligne après la carte.
//   3. Message au client avec la Booking confirmation (Taxi) ou le voucher (Secret) : ses deux modèles, mot pour mot, adaptés au dossier
//      (src/gestion/js/message-voucher-calc.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OUTILS_ITINERAIRE, demandeItineraire, pickupDonne, creationEnCours, itinerairePermis, refusItineraire, ligneItineraire, outilPermis, trajetAHoraires } from "../supabase/functions/agent/itineraire.js";
import { executer, memoDepuis, OUTILS } from "../supabase/functions/agent/outils.js";
import { consignes, contexteDuJour } from "../supabase/functions/agent/prompt.js";
import { texteDepuisWhatsApp } from "../supabase/functions/agent/whatsapp.js";
import { variablesVoucher, sansLignesVides, PAIEMENT_CHAUFFEUR, DEJA_PAYE } from "../src/gestion/js/message-voucher-calc.mjs";
import { MESSAGES_DEFAUT, MESSAGES_TAXI, messagesDefautPour } from "../src/gestion/js/defauts.mjs";
import { gabaritConfirmationVoucher, remplirGabarit } from "../src/gestion/js/operations-calc.mjs";

const lire = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ---- 1. Itinéraire seulement sur demande ---------------------------------------------------------------------------------------------
test("itinéraire : une demande explicite de la personne, en français ou en anglais", () => {
  for (const t of ["Combien de temps de l'hôtel au port ?", "À quelle heure partir pour le vol de 14h ?", "Calcule l'heure de pickup", "calcule moi le pickup stp", "Quel est le temps de trajet jusqu'à Ao Nang ?", "Est-ce tenable avec le ferry ?", "How long from the resort to Krabi Airport?", "What time should they leave?", "Horaires des bateaux pour Phi Phi demain ?"]) assert.equal(demandeItineraire(t), true, t);
  for (const t of ["Résume", "Qu'y a-t-il à faire ?", "Crée le dossier", "Le prix est 2500", "Elle arrive le 25 à 11:00", "Merci"]) assert.equal(demandeItineraire(t), false, t);
  // Un client qui demande la durée dans l'échange joint ne compte pas : seuls les mots de la personne.
  const joint = texteDepuisWhatsApp({ mode: "creer", conv: { id: "00000000-0000-4000-8000-000000000001", telephone: "+447700900111" }, messages: [{ sens: "entrant", texte: "How long does the transfer take?", envoye_le: "2026-11-22T03:00:00Z" }] });
  assert.equal(demandeItineraire(joint), false);
  // La question de « Demander à l'assistant » compte, l'échange non.
  const question = texteDepuisWhatsApp({ mode: "question", question: "Combien de temps jusqu'à l'aéroport ?", conv: { id: "00000000-0000-4000-8000-000000000001", telephone: "+447700900111" }, messages: [] });
  assert.equal(demandeItineraire(question), true);
});

test("itinéraire : une heure de pickup donnée n'est jamais recalculée ; une course sans pickup le calcule", () => {
  for (const t of ["Pickup time: 11:00", "pick up at 9.30 please", "prise en charge à 8h", "Pick-up 10am at the hotel", "Pickup: 07:45"]) assert.equal(pickupDonne([t]), true, t);
  for (const t of ["Flight at 14:30 from Krabi", "Arrival 11:00", "Pickup at the hotel"]) assert.equal(pickupDonne([t]), false, t);
  // Le cas qui a fait la demande : formulaire avec « Pickup time: 11:00 », puis « Créer le dossier » : aucun calcul.
  const avecPickup = texteDepuisWhatsApp({ mode: "creer", conv: { id: "00000000-0000-4000-8000-000000000001", telephone: "+447700900111" }, messages: [{ sens: "entrant", texte: "Transfer request: Test Lagoon Resort to Fictive Palms Hotel Date: Wed 25 Nov 2026 Pickup time: 11:00 Guests: 2 adults", envoye_le: "2026-11-22T03:00:00Z" }] });
  assert.deepEqual(itinerairePermis({ texte: avecPickup, modeWa: "creer" }), { permis: false, raison: "pickup_donne", horaires: false });
  // Un vol seul (aucun pickup) : la course a besoin du calcul.
  const avecVol = avecPickup.replace("Pickup time: 11:00", "Flight: 14:30 from Krabi Airport");
  assert.deepEqual(itinerairePermis({ texte: avecVol, modeWa: "creer" }), { permis: true, raison: "pickup_manquant", horaires: true });
  // Un pickup donné plus tôt dans la discussion compte aussi ; une demande explicite l'emporte toujours.
  assert.deepEqual(itinerairePermis({ texte: "Crée le dossier", precedents: ["Le client veut un pickup à 08:30"] }), { permis: false, raison: "pickup_donne", horaires: false });
  assert.deepEqual(itinerairePermis({ texte: "Recalcule le pickup avec le ferry de 10h", precedents: ["pickup at 08:30"] }), { permis: true, raison: "demande", horaires: true });
  // Ni demande, ni course : rien.
  assert.deepEqual(itinerairePermis({ texte: "Résume la conversation" }), { permis: false, raison: "non_demande", horaires: false });
  assert.equal(creationEnCours({ texte: "Prépare les dossiers" }), true);
  assert.equal(creationEnCours({ texte: "", modeWa: "maj" }), true);
});

test("itinéraire : horaires_trajet reste permis pour les départs et les prix d'un bateau ou d'un minivan partagé demandé", () => {
  // Les deux cas du rejeu des 7 jours : un devis de bateau, sans calcul de route.
  for (const t of ["j'ai des clients qui veulent aller de Koh Lanta à Koh Yao Noi en bateau, donne moi toutes les possibilités avec prix", "Ils veulent aussi aller à Koh Phi Phi en bateau le 26 novembre. Prépare la réponse au client", "Speedboat request: Koh Lanta to Phuket Departure: 14:30", "shared minivan to Krabi Airport?"]) {
    assert.equal(trajetAHoraires(t), true, t);
    const d = itinerairePermis({ texte: t });
    assert.equal(outilPermis("horaires_trajet", d), true, t);
    assert.equal(outilPermis("planifier_course", d), d.permis, t);
  }
  // Un taxi privé sans demande : ni horaires, ni calcul.
  const taxi = itinerairePermis({ texte: "Résume la demande de taxi privé" });
  assert.deepEqual([outilPermis("horaires_trajet", taxi), outilPermis("temps_de_route", taxi), outilPermis("planifier_course", taxi), outilPermis("estimer_temps_web", taxi)], [false, false, false, false]);
  // Un pickup donné bloque le calcul, pas la lecture des départs du bateau demandé.
  const bateau = itinerairePermis({ texte: "Speedboat request: Koh Lanta to Phi Phi Pickup time: 08:00" });
  assert.deepEqual([bateau.raison, outilPermis("horaires_trajet", bateau), outilPermis("planifier_course", bateau)], ["pickup_donne", true, false]);
  assert.match(ligneItineraire(bateau), /horaires_trajet reste permis pour les départs et les prix/);
  assert.match(ligneItineraire(taxi), /N'appelle pas non plus horaires_trajet/);
  assert.equal(outilPermis("chercher_catalogue", taxi), true, "les autres outils ne changent pas");
});

test("itinéraire : l'exécution refuse hors demande, sans rien calculer, et le dit au modèle", async () => {
  assert.deepEqual(OUTILS_ITINERAIRE, ["temps_de_route", "planifier_course", "horaires_trajet", "estimer_temps_web"]);
  let appels = 0;
  const ctx = { permissions: [], charger: async () => (appels++, []), reglages: {}, itineraire: { permis: false, raison: "pickup_donne" } };
  for (const nom of OUTILS_ITINERAIRE) {
    const r = await executer(nom, { de: "A", vers: "B", date: "", adultes: 0, enfants: 0, points: [], heure_depart: "", heure_vol: "", vol_international: false }, ctx, memoDepuis([], {}));
    assert.equal(r.erreur, true, nom);
    assert.equal(r.contenu.erreur, "itineraire_non_demande", nom);
    assert.match(r.contenu.conseil, /reprends-la telle quelle/, nom);
  }
  assert.equal(appels, 0, "rien n'est lu ni calculé");
  assert.match(refusItineraire("non_demande").conseil, /demande-la en une ligne/);
  // Permis : l'outil s'exécute comme avant (ici sans données, il rend son résultat habituel).
  const permis = await executer("horaires_trajet", { de: "A", vers: "B", date: "", adultes: 0, enfants: 0 }, { ...ctx, itineraire: { permis: true, raison: "demande" } }, memoDepuis([], {}));
  assert.notEqual(permis.contenu.erreur, "itineraire_non_demande");
  // Les outils restent dans la liste (cache et historique inchangés), leurs descriptions disent « seulement sur demande ».
  for (const nom of OUTILS_ITINERAIRE) assert.match(OUTILS.find((o) => o.name === nom).description, /Calcul d'itinéraire/, nom);
  assert.doesNotMatch(OUTILS.find((o) => o.name === "planifier_course").description, /Toujours utiliser cet outil pour donner une heure de pickup/);
});

test("itinéraire : consigne, contexte de l'échange et branchement de la fonction", () => {
  const c = consignes({ entreprise: "VIP Taxi Lanta", reglages: { fonctionnement: "taxi" }, prenomEquipe: "Nani" });
  assert.match(c, /Calcul d'itinéraire seulement sur demande/);
  assert.match(c, /Une heure de pickup donnée par le client ou par Nani se reprend telle quelle dans la carte : jamais recalculée/);
  assert.doesNotMatch(c, /Une heure de pickup se calcule toujours avec planifier_course/);
  assert.doesNotMatch(c, /chercher une durée, regarder les horaires/);
  assert.match(contexteDuJour({ aujourdhui: "2026-11-22", jour: "dimanche", itineraire: ligneItineraire({ permis: false, raison: "non_demande" }) }), /Calcul d'itinéraire : non demandé dans ce message/);
  assert.doesNotMatch(contexteDuJour({ aujourdhui: "2026-11-22", jour: "dimanche" }), /Calcul d'itinéraire/);
  const f = lire("supabase/functions/agent/index.ts");
  assert.match(f, /const itineraire = itinerairePermis\(\{ texte: message, precedents: textesGardes, modeWa: waId \? waMode : "" \}\);/);
  assert.match(f, /itineraire: ligneItineraire\(itineraire\)/);
  assert.match(f, /const ctx = \{ itineraire, /);
  // « Créer le dossier » ne réclame plus des « pickups calculés ».
  const t = texteDepuisWhatsApp({ mode: "creer", conv: { id: "00000000-0000-4000-8000-000000000001", telephone: "+447700900111" }, messages: [] });
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
const rendu = (reglages, { services = [], type = "", paye = false, entreprise }) => sansLignesVides(remplirGabarit(gabaritConfirmationVoucher([], messagesDefautPour(reglages)), { entreprise, ...variablesVoucher({ services, type, paye, entreprise }) }));
export const EXEMPLES = {
  taxi_paye_chauffeur: rendu({ fonctionnement: "taxi" }, { entreprise: "VIP Taxi Lanta", type: "transfert", paye: false, services: [{ heure: "11:00", lieu: "Test Lagoon Resort" }] }),
  taxi_deja_paye: rendu({ fonctionnement: "taxi" }, { entreprise: "VIP Taxi Lanta", type: "transfert", paye: true, services: [{ heure: "11:00", lieu: "Test Lagoon Resort" }] }),
  secret_excursion: rendu({ fonctionnement: "excursions" }, { entreprise: "Secret Travel & Tour", type: "activite", services: [{ heure: "08:30", lieu: "Lanta Resort" }] }),
  secret_transfert: rendu({ fonctionnement: "excursions" }, { entreprise: "Secret Travel & Tour", type: "transfert", services: [{ heure: "09:15", lieu: "Fictive Palms Hotel" }] }),
};

test("Taxi : le modèle de Jérémy mot pour mot, la phrase de paiement seulement si le client paie le chauffeur", () => {
  assert.equal(EXEMPLES.taxi_paye_chauffeur, TAXI_JEREMY, "mot pour mot, signature comprise");
  assert.equal(EXEMPLES.taxi_deja_paye, TAXI_JEREMY.replace(PAIEMENT_CHAUFFEUR, DEJA_PAYE));
  assert.doesNotMatch(EXEMPLES.taxi_deja_paye, /cash|Wise/);
  assert.equal(DEJA_PAYE, "Your transfer is already paid.");
  // Rangé dans les messages de Taxi (usage « voucher »), modifiable dans l'écran Messages ; le rappel du point du soir ne change pas.
  const m = MESSAGES_TAXI.find((x) => x.id === "taxi-voucher-en");
  assert.deepEqual([m.pour, m.cle, m.langue], ["client", "voucher", "en"]);
  assert.ok(MESSAGES_TAXI.some((x) => x.id === "taxi-rappel-en" && x.cle === "rappel"));
});

test("Secret : le modèle de Jérémy mot pour mot, la ligne de pickup du dossier, « transfer » pour un transfert", () => {
  assert.equal(EXEMPLES.secret_excursion, SECRET_JEREMY, "mot pour mot, signature comprise");
  assert.match(EXEMPLES.secret_transfert, /for the day of your transfer\.\n/);
  assert.match(EXEMPLES.secret_transfert, /\n\nYour pickup will be at 09:15 at Fictive Palms Hotel\.\n\n/);
  // Sans pickup (rendez-vous sur place sans heure ni lieu, location) : la ligne disparaît, rien n'est inventé.
  const sans = rendu({ fonctionnement: "excursions" }, { entreprise: "Secret Travel & Tour", type: "activite", services: [{ heure: "", lieu: "" }] });
  assert.equal(sans, SECRET_JEREMY.replace("Your pickup will be at 08:30 at Lanta Resort.\n\n", ""));
  const location = rendu({ fonctionnement: "excursions" }, { entreprise: "Secret Travel & Tour", type: "location", services: [{ heure: "09:00", lieu: "Lanta Resort" }] });
  assert.doesNotMatch(location, /pickup/i);
  // Ce qui est connu seulement : une heure sans lieu, un lieu sans heure.
  assert.match(rendu({ fonctionnement: "excursions" }, { entreprise: "Secret Travel & Tour", services: [{ heure: "08:30", lieu: "" }] }), /\nYour pickup will be at 08:30\.\n/);
  assert.match(rendu({ fonctionnement: "excursions" }, { entreprise: "Secret Travel & Tour", services: [{ heure: "", lieu: "Saladan Pier" }] }), /\nYour pickup will be at Saladan Pier\.\n/);
  // Plusieurs services : une ligne par pickup, avec le service et la date.
  const deux = rendu({ fonctionnement: "excursions" }, { entreprise: "Secret Travel & Tour", services: [{ heure: "08:30", lieu: "Lanta Resort", prestation: "4 Islands", date: "25 November 2026" }, { heure: "07:00", lieu: "Lanta Resort", prestation: "Koh Rok", date: "27 November 2026" }] });
  assert.match(deux, /\n\nYour pickup for 4 Islands on 25 November 2026 will be at 08:30 at Lanta Resort\.\nYour pickup for Koh Rok on 27 November 2026 will be at 07:00 at Lanta Resort\.\n\n/);
  const m = MESSAGES_DEFAUT.find((x) => x.id === "voucher-en");
  assert.deepEqual([m.pour, m.cle, m.langue], ["client", "voucher", "en"]);
});

test("message avec le voucher : l'envoi direct, le lien wa.me et les cartes de l'Assistant passent par le même message", () => {
  const vue = lire("src/gestion/js/views/voucher-envoi.mjs");
  assert.match(vue, /\.\.\.variablesVoucher\(\{ services, type: x\.type, paye, entreprise: nomEntreprise \}\)/);
  assert.match(vue, /const paye = statutPaiementVoucher\(\{ \.\.\.res, surPlace: !!r\.paye_sur_place \}\) === "paye";/);
  assert.match(vue, /return sansLignesVides\(message\);/);
  assert.match(vue, /const message = \{ client: messageClientVoucher\(x\) \};/, "lien wa.me et envoi depuis l'écran");
  assert.match(lire("src/gestion/js/views/agent-cartes-voucher.mjs"), /legende: messageClientVoucher\(x\)/, "cartes « Voucher » de l'Assistant");
  // Le modèle « voucher » passe avant la « confirmation » ; l'écran Messages propose l'usage et ses variables.
  assert.match(lire("src/gestion/js/operations-calc.mjs"), /for \(const cle of \["voucher", "confirmation"\]\)/);
  const messages = lire("src/gestion/js/views/messages.mjs");
  assert.match(messages, /\{ cle: "voucher", pour: "client", libelle: N_\("Message avec le voucher"\), modes: \["excursions", "taxi"\] \}/);
  assert.match(messages, /Message avec le voucher : \{pickup\} \{jour\} \{paiement\} \{ENTREPRISE\}/);
  assert.match(lire("src/gestion/js/i18n-en.mjs"), /"Message avec le voucher": "Message with the voucher"/);
});
