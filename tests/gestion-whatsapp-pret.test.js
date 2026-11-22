// Filtre « Prêt à réserver » de l'écran WhatsApp (migration 85, 22.11.2026). Chaque cas reprend le modèle d'une des 48 conversations
// réelles lues le 22.11.2026 (C1 à C48 de docs/gestion/whatsapp-pret-a-reserver.md). Ce dépôt est public : les messages ci-dessous sont
// inventés et reformulés, aucun nom, aucun numéro, aucun hôtel ni aucune phrase de client réel.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { etatPret, carteDe, prixDonne, champsDe, contientPrix, questionReservation, pretChange, conversationPossible, TYPES_EXCLUS, MOTIFS_TRI_EXCLUS } from "../supabase/functions/whatsapp/pret.js";
import * as E from "../src/gestion/js/whatsapp-pret-calc.mjs";
import { conversationPret } from "../src/gestion/js/demo-pret.mjs";

// Une conversation : [sens, texte] dans l'ordre, une minute d'écart.
let n = 0;
const conv = (lignes, extra = {}) => {
  const depart = Date.parse("2026-11-21T01:00:00.000Z");
  const messages = lignes.map(([sens, texte, type = "text"], i) => ({ id: `m${++n}`, sens, type, texte, medias: [], envoye_le: new Date(depart + i * 60000).toISOString(), supprime_le: null }));
  return { conv: { id: "c", reponses: "auto", type_contact: null, partenaire_id: null, tri: { motif: "demande_client" }, ...extra }, messages };
};
const decide = (lignes, extra) => {
  const { conv: c, messages } = conv(lignes, extra);
  return etatPret(c, messages, "2026-11-22T00:00:00.000Z");
};
// Modèles inventés : la réponse type de Nani avec le prix, une demande du formulaire du site, la confirmation type de Taxi.
const PRIX_TAXI = "Hello and thanks for writing!\nA private minivan for this trip costs 1,900 THB, ferry included.\nYou can pay the driver in cash.\nTell me if you have questions or if you want to book the transfer 🙏";
const DEMANDE_SITE = "Transfer request: Hotel A to Airport B\nDate: Mon 7 Dec 2026\nPickup time: 09:00\nGuests: 3 adults\nBags: 3\nPickup: Hotel A\nDrop-off: Airport B\nName: Paul Example\nWhatsApp: +10000000000";
const CONFIRMATION_TAXI = "Thanks for booking with us ✨\nPlease see the attached confirmation and show it to your driver.\nTell us if anything needs a change.";

// ---- Les cas qui entrent ---------------------------------------------------------------------------------------------------------
test("modèle C36 : demande du site, prix, question de paiement, « would you like to book it ? », « Yes », confirmation : prête", () => {
  const d = decide([
    ["entrant", DEMANDE_SITE],
    ["sortant", PRIX_TAXI],
    ["entrant", "Can I pay with a credit card?"],
    ["sortant", "Cash or bank transfer only 😊"],
    ["sortant", "Would you like to book it? 😊"],
    ["entrant", "Yes"],
    ["sortant", "", "image"],
    ["sortant", CONFIRMATION_TAXI],
    ["entrant", "Great, cash is fine"],
  ]);
  assert.equal(d.pret, true);
  assert.equal(d.source, "nani");
  assert.equal(d.motif, "confirmation");
  assert.deepEqual(d.carte, { date: "Mon 7 Dec 2026", heure: "09:00", personnes: "3 adults", depart: "Hotel A", arrivee: "Airport B", nom: "Paul Example", prix: "1,900 THB" });
  assert.ok(!JSON.stringify(d.carte).includes("10000000000"), "jamais le numéro WhatsApp de la demande dans la carte");
  assert.ok(d.depuis < d.le, "depuis : le prix donné, avant le signal");
});

test("modèle C43 : prix, deux relances, « Yes we take it! », récapitulatif : prête avec la carte du récapitulatif", () => {
  const d = decide([
    ["entrant", "Hi, we are 2 and need a taxi from the pier to our hotel on Friday around noon. Could you tell us if it's possible and the price?\nLena"],
    ["sortant", "Hi! A private songthaew is 400 THB from the pier to your hotel 😊 would you like to book it?"],
    ["sortant", "Hello, shall I confirm the driver for you? 😊"],
    ["entrant", "Yes we take it!\nThanks\nLena"],
    ["sortant", "Thank you! ☀️\nThis is your confirmation:\nName: Lena\nDate: Friday\nPick-up time: 12pm\nPick-up location: Pier\nDrop-off location: Hotel C\nNumber of passengers: 2 adults\nPrice: 400 THB"],
  ]);
  assert.equal(d.pret, true);
  assert.equal(d.motif, "confirmation");
  assert.deepEqual(d.carte, { nom: "Lena", date: "Friday", heure: "12pm", depart: "Pier", arrivee: "Hotel C", personnes: "2 adults", prix: "400 THB" });
});

test("modèle C43 sans le récapitulatif : l'accord du client suffit", () => {
  const d = decide([
    ["entrant", "Hi, how much for a taxi from the pier to our hotel?"],
    ["sortant", "Hi! It's 400 THB. Would you like to book it?"],
    ["entrant", "Yes we take it, thank you"],
  ]);
  assert.equal(d.pret, true);
  assert.equal(d.source, "client");
  assert.equal(d.motif, "accord");
  assert.equal(d.carte.prix, "400 THB");
});

test("modèle C7 : « yes I want to book », « I will send you the confirmation soon » : prête, et sort au dossier relié", () => {
  const d = decide([
    ["entrant", "Hello, we are a group of 9 and need a van.\nDate: 03.March 2027\nTime: 10:00 am\nWhat would it cost?"],
    ["sortant", "You will need 2 vans. One van is 3’000 THB, ferry included.\nSo 3000x2 =6’000 THB\nTell me if you want to book the transfer"],
    ["entrant", "Thanks a lot, yes I want to book the transfer"],
    ["entrant", "What details do you need?"],
    ["sortant", "Sure, I will send you the confirmation soon 🙏 I only need the name of your hotel"],
  ]);
  assert.equal(d.pret, true);
  assert.equal(d.carte.prix, "6'000 THB", "le total (« = 6’000 THB »), pas le prix d'un van");
  assert.equal(E.pretAReserver({ pret_reserver: d, dossier_id: "d1" }), null, "reliée à un dossier : hors du filtre");
  assert.ok(E.pretAReserver({ pret_reserver: d, dossier_id: null }));
});

test("modèle C41 : Nani écrit « I have already secured your booking », même après « please don't book yet » du client : prête", () => {
  const d = decide([
    ["entrant", "Hello, which boat is it and is the sunset included? We are still deciding, please don't book yet."],
    ["sortant", "Hi! It is a small speedboat, 12 people at most, and yes you come back at sunset."],
    ["sortant", "I have already secured your booking at the old price. If you cancel and book again later, the new price will apply 🙏"],
  ]);
  assert.equal(d.pret, true);
  assert.equal(d.motif, "confirmation");
  assert.deepEqual(d.carte, {}, "rien d'écrit à reprendre : carte vide, l'Assistant lira l'échange");
});

test("modèle C45 : « can you send the taxi? », « I will send you the taxi », puis le client annule : sort", () => {
  const avant = [
    ["entrant", "Hi! Is a taxi possible right now from our hotel to the night market? How much?"],
    ["sortant", "Yes, the driver is free. It's 600 THB return with a songthaew."],
    ["entrant", "Perfect. Can you send the taxi to pick us up?"],
    ["sortant", "Sure, I will send you the taxi 😊"],
    ["sortant", "He will arrive in about 10 minutes"],
    ["entrant", "Thanks a lot!"],
  ];
  assert.equal(decide(avant).pret, true, "entre au « send the taxi »");
  const d = decide([...avant, ["entrant", "Sorry, could we cancel? Something came up"], ["sortant", "No problem, I'll tell him 🙏"], ["entrant", "Maybe tomorrow instead, let's talk then"]]);
  assert.equal(d.pret, false);
  assert.equal(d.motif, "annule", "« let's talk » n'est pas un nouvel accord");
});

test("un nom et une heure donnés après le prix, en réponse à la question de réservation : prête", () => {
  const d = decide([
    ["entrant", "How much from Hotel D to the pier tomorrow?"],
    ["sortant", "The price is 500 THB 😊 Would you like to book it?"],
    ["entrant", "My name is Anna Example, pick up at 9:30 from Hotel D please"],
  ]);
  assert.equal(d.pret, true);
  assert.equal(d.motif, "details");
});

test("français : « On prend, merci » après un prix ; « je prépare la confirmation » ; « je vous envoie le voucher »", () => {
  assert.equal(decide([["entrant", "Bonjour, combien pour l'excursion aux îles ?"], ["sortant", "Bonjour, c'est 1800 THB par personne 😊"], ["entrant", "On prend, merci !"]]).pret, true);
  assert.equal(decide([["entrant", "D'accord pour samedi"], ["sortant", "Parfait, je prépare la confirmation !"]]).pret, true);
  assert.equal(decide([["sortant", "Merci ! Je vous envoie le voucher dans la journée"]]).pret, true);
  assert.equal(decide([["sortant", "I send you the voucher now ☺️"]]).pret, true);
});

// ---- Les faux positifs évités ---------------------------------------------------------------------------------------------------------
test("modèles C22, C33, C9 : « we would like to book … what is the price » avant tout prix : une demande de prix, pas prête", () => {
  assert.equal(decide([["entrant", "Hello! We would like to book a van to the airport next week for 2 people. Could you tell us the price?"]]).pret, false);
  assert.equal(decide([["entrant", "We would like to book your island tour for Sunday. Is there still space?"]]).pret, false);
});

test("modèles C4, C37, C40 : un prix donné, aucune réponse : pas prête", () => {
  assert.equal(decide([["entrant", DEMANDE_SITE], ["sortant", PRIX_TAXI]]).pret, false);
  assert.equal(decide([["entrant", DEMANDE_SITE], ["sortant", "Hello, do you still need it? I'll check with our driver 🙏"], ["sortant", "The price is 2100 THB 😊"]]).pret, false);
});

test("modèles C14, C17, C42, C28 : une relance de Nani « would you like to book ? » sans réponse n'est pas une confirmation", () => {
  assert.equal(decide([["entrant", DEMANDE_SITE], ["sortant", PRIX_TAXI], ["sortant", "Hello, woud you like to book the transfer? ☀️"]]).pret, false);
  assert.equal(decide([["sortant", "Hello, are you interested in booking the driver? 😊"]]).pret, false);
  assert.equal(decide([["sortant", "Hello, would you like that I confirm the driver? 😊"]]).pret, false, "« I confirm » dans une question de Nani");
});

test("modèles C17, C48, C46 : refus après le prix", () => {
  assert.equal(decide([["entrant", DEMANDE_SITE], ["sortant", PRIX_TAXI], ["sortant", "Would you like to book the transfer?"], ["entrant", "No thanks, we found something else. Have a nice day"]]).pret, false);
  assert.equal(decide([["sortant", "Would you like to book it for Monday? I can do 1200 THB"], ["entrant", "No thank you\nWe changed our plans"]]).pret, false);
  assert.equal(decide([["entrant", "How much from the pier?"], ["sortant", "The price is 400 THB"], ["entrant", "No, we don't need it anymore"]]).pret, false);
});

test("modèles C35, C14 : hésitation (« let me think about the price », « I'll let you know »)", () => {
  assert.equal(decide([["sortant", "The total price is 1,900 THB. The driver can be there at 2pm 🙏"], ["entrant", "Let me think about the price, I'll write you later."]]).pret, false);
  assert.equal(decide([["sortant", PRIX_TAXI], ["entrant", "Thanks. And what would a return trip cost?"], ["sortant", "The return is 2300 THB 😊"], ["entrant", "ok thanks, I'll let you know"]]).pret, false);
});

test("modèles C42 et C47 : contre-proposition, « Alright … something cheaper? »", () => {
  assert.equal(decide([["sortant", "The total price is 2’500 THB. Tell me if you want to book the transfer"], ["sortant", "Hello, would you like to book the driver? 😊"], ["entrant", "Hi, could you do it for 2000 baht?"], ["sortant", "2300 is possible 😊"]]).pret, false);
  assert.equal(decide([["sortant", "The return trip is 600 THB with a songthaew."], ["entrant", "Alright, thanks; do you have anything cheaper?"]]).pret, false);
});

test("modèles C5 et C47 : « ok » qui ne répond pas à une question de réservation", () => {
  assert.equal(decide([["sortant", "En haute saison les chambres sont autour de 4000 THB la nuit"], ["entrant", "Ok merci pour l'info."]]).pret, false);
  assert.equal(decide([["sortant", "The return trip is 600 THB."], ["entrant", "Ok"]]).pret, false, "« Ok » après un prix sans question de Nani : un accusé de lecture");
});

test("modèles C24 à C30 : demande d'avis Google en fin de séjour : jamais prête", () => {
  assert.equal(decide([["sortant", "Thank you again for choosing us for your trip!\nIf you enjoyed it, a review on Google would help us a lot.\nhttps://g.page/r/exemple/review"]]).pret, false);
});

test("modèles C6, C38, C30 : un rappel d'un service déjà réservé n'est pas un signal", () => {
  assert.equal(decide([["sortant", "Your driver is confirmed for tomorrow, have a good flight ☀️"]]).pret, false);
  assert.equal(decide([["sortant", "Hi, yes the driver is confirmed ☀️"]]).pret, false);
  assert.equal(decide([["sortant", "All good, everything is confirmed on their side 🥰"]]).pret, false);
});

test("modèle C44 : « vous confirmez pour demain ? » (une question, sans prix)", () => {
  assert.equal(decide([["entrant", "Bonjour, vous confirmez bien pour demain matin ?"]]).pret, false);
});

test("modèles C13, C11 : partenaire (récapitulatif envoyé au chauffeur, « go ahead » d'une partenaire) : exclu", () => {
  const recap = [["sortant", "Customer:\nHow much for a return trip to the old town?"], ["entrant", "Around 600 baht return"], ["sortant", "New booking\nName: Lena\nDate: Friday\nPick-up time: 12pm\nPick-up location: Pier\nDrop-off location: Hotel C\nPrice: 400 THB"]];
  assert.equal(decide(recap, { type_contact: "partenaire" }).pret, false);
  assert.equal(decide(recap, { type_contact: "partenaire" }).motif, "exclue");
  for (const type of ["chauffeur", "hotel", "apporteur"]) assert.equal(decide(recap, { type_contact: type }).motif, "exclue", type);
  assert.equal(decide(recap, { partenaire_id: "p1" }).motif, "exclue", "une fiche partenaire reliée");
  assert.equal(decide([["sortant", "The ticket is 1500 THB"], ["entrant", "Please go ahead"]], { type_contact: "partenaire" }).pret, false);
});

test("modèle C34 : un « Yes » d'un bateau sur l'itinéraire (tri « partenaire ») : exclu", () => {
  assert.equal(decide([["sortant", "Hi, I have guests for Sunday. Is the viewpoint stop included?"], ["entrant", "Yes"]], { tri: { motif: "partenaire" } }).motif, "exclue");
});

test("modèles C2, C3, C10 : Contact personnel : exclu sans même lire les messages", () => {
  assert.equal(decide([["sortant", "Ok pour 14h, 500 THB la séance"], ["entrant", "Oui parfait merci !"]], { reponses: "jamais" }).motif, "exclue");
  for (const motif of ["personnel", "publicite"]) assert.equal(decide([["sortant", "500 THB"], ["entrant", "we take it"]], { tri: { motif } }).motif, "exclue", motif);
});

test("une demande de client recopiée par Nani pour un chauffeur non typé n'est pas un récapitulatif", () => {
  const d = decide([["sortant", "Hello,\n\nWe would like to book a taxi for 2 people.\nPickup: Pier\nDestination: Hotel C\nPassengers: 2 adults\nDate: Friday\n\nCould you please confirm availability and the price?"]]);
  assert.equal(d.pret, false);
  assert.equal(decide([["sortant", "Transfer request: Hotel A to Hotel B\nDate: Sat 5 Dec 2026\nPickup time: 11:00\nGuests: 1 adult\nName: Mia Example"]]).pret, false);
});

test("modèle C1 : prix discuté avec un bateau non typé, refusé : rien", () => {
  assert.equal(decide([["sortant", "Isn't it 7000 THB for 8 people?"], ["entrant", "We can't do that price."], ["sortant", "Ok 😢 🙏"]]).pret, false);
});

test("une annulation écrite par Nani après le signal fait sortir ; « if you cancel » dans le message du signal, non", () => {
  assert.equal(decide([["sortant", "I have secured your booking 🙏"], ["sortant", "I have cancelled your booking as requested"]]).motif, "annule");
  assert.equal(decide([["sortant", "I have secured your booking. If you cancel and rebook, you will pay the full price."]]).pret, true);
  assert.equal(decide([["sortant", "I have secured your booking 🙏"], ["entrant", "What is the cancellation policy?"]]).pret, true, "« cancellation » n'est pas une annulation");
});

test("le signal le plus récent compte : un nouvel accord après une annulation fait revenir", () => {
  const d = decide([["sortant", "The price is 600 THB. Would you like to book it?"], ["entrant", "Yes please"], ["entrant", "Sorry we need to cancel"], ["sortant", "No problem. Tomorrow is 600 THB too, would you like to book it?"], ["entrant", "Yes, please book it for tomorrow"]]);
  assert.equal(d.pret, true);
});

test("messages supprimés et réactions ignorés", () => {
  const { conv: c, messages } = conv([["sortant", "The price is 600 THB. Would you like to book it?"], ["entrant", "Yes"], ["entrant", "👍", "reaction"]]);
  messages[1].supprime_le = "2026-11-21T02:00:00.000Z";
  assert.equal(etatPret(c, messages).pret, false, "le « Yes » supprimé ne compte plus");
});

// ---- Briques ---------------------------------------------------------------------------------------------------------------------
test("montants, questions de réservation et champs", () => {
  for (const t of ["2,300 THB", "5’000 THB", "500 baht", "฿ 800", "The price is 2400", "2000 THB per person", "15 €"]) assert.ok(contientPrix(t), t);
  for (const t of ["at 2:30", "for 3 people", "room 204", "Flight AB 123"]) assert.ok(!contientPrix(t), t);
  assert.ok(questionReservation("Would you like to book it ? 😊"));
  assert.ok(questionReservation("Souhaitez-vous réserver pour demain ?"));
  assert.ok(!questionReservation("Could you tell me the name of the hotel ?"));
  assert.deepEqual(champsDe("Name: Lena\nPick-up time: 10am\nWhatsApp: +10 000\nBags: 2"), { nom: "Lena", heure: "10am" });
  assert.equal(prixDonne([{ sens: "sortant", texte: "The price is 1800 THB per person + 300 THB for the park", envoye_le: "a" }]), "1800 THB / pers.");
  assert.equal(prixDonne([{ sens: "sortant", texte: "2,100 THB for 1 van. 2,100*2 = 4'200 THB (in total).", envoye_le: "a" }]), "4'200 THB");
  assert.equal(prixDonne([{ sens: "entrant", texte: "Price on the site: From 2,000 THB", envoye_le: "a" }]), null, "jamais le prix écrit par le client ou le site");
  const carte = carteDe([{ sens: "entrant", texte: "Name: Tom\nPickup: Hotel A\nPrice on the site: From 2,000 THB\nWhatsApp: +10000000000", envoye_le: "a" }]);
  assert.deepEqual(carte, { nom: "Tom", depart: "Hotel A" });
  assert.ok(conversationPossible({ reponses: "auto" }));
});

test("la décision ne s'écrit que si elle change (calcule_le ne compte pas) et tient dans la contrainte de la migration 85", () => {
  const a = decide([["sortant", "I have secured your booking"]]);
  assert.equal(pretChange(null, a), true);
  assert.equal(pretChange(a, { ...a, calcule_le: "autre" }), false);
  assert.equal(pretChange(a, { pret: false, motif: "annule" }), true);
  const longue = decide([["entrant", `Name: ${"N".repeat(300)}\nDate: ${"D".repeat(300)}\nPickup: ${"P".repeat(300)}\nDrop-off: ${"A".repeat(300)}\nGuests: ${"G".repeat(300)}\nFlight: ${"F".repeat(300)}`], ["sortant", `${"9".repeat(300)} THB`], ["entrant", "we take it"]]);
  assert.equal(longue.pret, true);
  assert.ok(JSON.stringify(longue).length <= 2000, `décision de ${JSON.stringify(longue).length} caractères`);
  assert.ok(!JSON.stringify(a).includes("secured"), "aucun texte de message dans la décision");
});

// ---- Écran ------------------------------------------------------------------------------------------------------------------------
const DEC = { pret: true, le: "2026-11-21T02:16:00.000Z", depuis: "2026-11-20T08:55:00.000Z", source: "nani", motif: "confirmation", carte: { depart: "Hotel A", arrivee: "Airport B", date: "Mon 7 Dec 2026", prix: "1,900 THB" } };
const C = (o = {}) => ({ id: "c1", telephone: "+10 000 000 001", entite_id: null, reponses: "auto", type_contact: null, partenaire_id: null, tri: { motif: "remerciement" }, dossier_id: null, client_id: null, pret_reserver: DEC, pret_retire_le: null, ...o });

test("écran : entre avec la décision « prêt », jamais pour un contact exclu, même si la décision est restée", () => {
  assert.ok(E.pretAReserver(C()));
  assert.equal(E.pretAReserver(C({ pret_reserver: null })), null, "migration ou calcul pas encore passés");
  assert.equal(E.pretAReserver(C({ pret_reserver: { pret: false, motif: "aucun" } })), null);
  assert.equal(E.pretAReserver(C({ pret_reserver: { pret: true, le: "pas une date" } })), null);
  assert.equal(E.pretAReserver(C({ reponses: "jamais" })), null, "passé en Contact personnel après le calcul");
  assert.equal(E.pretAReserver(C({ type_contact: "chauffeur" })), null);
  assert.equal(E.pretAReserver(C({ partenaire_id: "p" })), null);
  assert.equal(E.pretAReserver(C({ tri: { motif: "publicite" } })), null);
});

test("écran : sort au retrait de Nani, revient sur un signal plus récent que le retrait", () => {
  assert.equal(E.pretAReserver(C({ pret_retire_le: "2026-11-21T03:00:00.000Z" })), null);
  assert.ok(E.pretAReserver(C({ pret_retire_le: "2026-11-21T01:00:00.000Z" })), "retirée avant ce signal-ci");
  assert.ok(E.pretAReserver(C({ pret_retire_le: "2026-11-21T03:00:00.000Z", pret_reserver: { ...DEC, le: "2026-11-21T05:00:00.000Z" } })));
  assert.equal(E.pretRetire(C({ pret_retire_le: "2026-11-21T03:00:00.000Z" })), true, "retirée : « Remettre dans la liste » proposé");
  assert.equal(E.pretRetire(C({ pret_retire_le: "2026-11-21T03:00:00.000Z", dossier_id: "d" })), false, "retirée puis dossier relié : rien à remettre");
  assert.equal(E.pretRetire(C()), false);
  assert.deepEqual(Object.keys(E.patchRetirer()), ["pret_retire_le"]);
  assert.deepEqual(E.patchRemettre(), { pret_retire_le: null });
});

test("écran, modèle C36 : dossier créé deux minutes avant la confirmation mais pas relié : reste dans le filtre avec « Relier au dossier »", () => {
  const clients = [{ id: "k1", telephone: "+10000000001", entite_id: "taxi" }];
  const dossier = (o) => ({ id: "d", ref: "2026-0001", entite_id: "taxi", client_id: "k1", annule: false, created_at: "2026-11-21T02:14:00.000Z", ...o });
  assert.ok(E.pretAReserver(C()), "toujours dans le filtre tant que la conversation n'est pas reliée");
  assert.equal(E.dossierARelier(C(), { clients, dossiers: [dossier()] }).id, "d", "même numéro, dossier créé après le prix donné");
  assert.equal(E.dossierARelier(C(), { clients, dossiers: [dossier({ created_at: "2026-10-28T10:00:00.000Z" })] }), null, "un ancien dossier du client n'est pas proposé");
  assert.equal(E.dossierARelier(C(), { clients, dossiers: [dossier({ annule: true })] }), null, "un dossier annulé non plus");
  assert.equal(E.dossierARelier(C(), { clients: [{ id: "k1", telephone: "+20 999 999 999" }], dossiers: [dossier()] }), null, "un autre client");
  assert.equal(E.dossierARelier(C({ client_id: "k9" }), { clients: [], dossiers: [dossier({ client_id: "k9" })] }).id, "d", "la fiche reliée suffit");
  assert.equal(E.dossierARelier(C(), { clients, dossiers: [dossier(), dossier({ id: "d2", created_at: "2026-11-21T03:00:00.000Z" })] }).id, "d2", "le plus récent");
  // Relier : une conversation à trier est rangée dans l'entreprise du dossier ; rangée ailleurs, elle n'est pas déplacée.
  assert.deepEqual(E.patchRelier(C(), dossier()), { entite_id: "taxi", client_id: "k1", dossier_id: "d" });
  assert.deepEqual(E.patchRelier(C({ entite_id: "taxi" }), dossier()), { client_id: "k1", dossier_id: "d" });
  assert.equal(E.patchRelier(C({ entite_id: "secret" }), dossier()), null);
  // Une fois reliée, elle sort.
  assert.equal(E.pretAReserver(C({ entite_id: "taxi", client_id: "k1", dossier_id: "d" })), null);
  assert.equal(E.conversationsPretes([C(), C({ id: "c2", dossier_id: "x" })]).length, 1);
});

test("écran : carte et ligne de la liste", () => {
  assert.equal(E.resumeCarte(DEC.carte), "Mon 7 Dec 2026 · 1,900 THB · Hotel A → Airport B");
  assert.deepEqual(E.lignesCarte({ nom: "Lena", prix: "400 THB", inconnu: "x", heure: 10, date: " ​ " }).map((l) => [l.cle, l.valeur]), [["nom", "Lena"], ["prix", "400 THB"]]);
  assert.equal(E.resumeCarte(null), "");
  assert.equal(E.motifPret({ motif: "accord" }), E.MOTIFS_PRET.accord);
  assert.equal(E.motifPret({ motif: "bizarre" }), E.MOTIFS_PRET.confirmation);
});

test("écran et fonction : mêmes contacts exclus", () => {
  assert.deepEqual(E.TYPES_EXCLUS, TYPES_EXCLUS);
  assert.deepEqual(E.MOTIFS_TRI_EXCLUS, MOTIFS_TRI_EXCLUS);
});

test("démonstration : la décision posée est celle que rend la fonction sur ses messages", () => {
  let i = 0;
  const demo = conversationPret({ taxi: { id: "taxi" }, uid: () => `u${++i}`, organisation: "o", maintenant: Date.parse("2026-11-22T10:00:00.000Z") });
  const c = demo.whatsapp_conversations[0];
  const calc = etatPret(c, demo.whatsapp_messages, c.pret_reserver.calcule_le);
  assert.deepEqual(calc, c.pret_reserver);
  assert.ok(E.pretAReserver(c));
});

// ---- Branchements et dépôt public -----------------------------------------------------------------------------------------------------
const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
test("branchements : fonction, reprise, écran, stores, CI", () => {
  const index = lire("supabase/functions/whatsapp/index.ts");
  assert.match(index, /enFond\(pretApresMessage\(db, data\.conversation_id\)\)/, "après chaque nouveau message");
  assert.match(index, /enFond\(pretApresMessage\(db, conv\.id\)\)/, "après un message modifié ou supprimé");
  assert.match(index, /if \(!idCourant\) await rattraperPret\(db, ORGANISATION\)/, "rattrapage à la reprise seulement");
  const ts = lire("supabase/functions/whatsapp/pret.ts");
  assert.doesNotMatch(ts, /@anthropic-ai|messages\.create/, "aucun appel à l'IA");
  assert.doesNotMatch(lire("supabase/functions/whatsapp/pret.js"), /^import/m, "la règle n'importe rien (pas de réseau, pas d'IA)");
  assert.match(ts, /update\(\{ pret_reserver: decision \}\)/, "seule la colonne pret_reserver est écrite");
  const vue = lire("src/gestion/js/views/whatsapp.mjs");
  assert.match(vue, /filtrePretDisponible\(\) \? \[FILTRE_PRET\]/);
  assert.match(vue, /cartePret\(c, \{ lectureSeule, creerDossier: creerPret\(c, prop\), peutRelierDans: \(id\) => entitesWhatsApp\(\)\.some\(\(e\) => e\.id === id\), rafraichir \}\)/);
  assert.match(lire("src/gestion/js/store-supabase.mjs"), /whatsapp_pret_disponible: conversations !== null && pretDisponible/);
  assert.match(lire("src/gestion/js/store-local.mjs"), /"nom", "pret_retire_le"\]\.includes\(k\)/);
  assert.match(lire(".github/workflows/ci.yml"), /verif-whatsapp-pret/);
  const agent = fs.readdirSync(new URL("../supabase/functions/agent/", import.meta.url)).map((f) => lire(`supabase/functions/agent/${f}`)).join("\n");
  assert.doesNotMatch(agent, /pret_reserver|pret_retire_le/, "l'Assistant ne lit pas ces colonnes");
});

test("dépôt public : aucun numéro de téléphone plausible dans les fichiers de « Prêt à réserver »", () => {
  const fichiers = ["tests/gestion-whatsapp-pret.test.js", "docs/gestion/whatsapp-pret-a-reserver.md", "src/gestion/js/demo-pret.mjs", "supabase/functions/whatsapp/pret.js", "docs/gestion/verif-whatsapp-pret.mjs"];
  for (const f of fichiers) {
    const numeros = (lire(f).match(/\+\d[\d ]{8,}\d/g) || []).filter((x) => !/^\+1\s?0{2}|^\+10|^\+20 9|^\+447700900/.test(x));
    assert.deepEqual(numeros, [], `${f} : seulement des numéros fictifs (+10…, +447700900…)`);
  }
});
