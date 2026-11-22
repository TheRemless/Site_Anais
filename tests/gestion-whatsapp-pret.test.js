// Filtre « Prêt à réserver » de l'écran WhatsApp (migration 85, 22.11.2026). Chaque cas vient d'une des 48 conversations réelles lues le
// 22.11.2026 (numéros C1 à C48 de docs/gestion/whatsapp-pret-a-reserver.md) ; noms, hôtels et numéros sont changés, les tournures gardées.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { etatPret, signalDuMessage, carteDe, prixDonne, champsDe, contientPrix, questionReservation, pretChange, conversationPossible, TYPES_EXCLUS, MOTIFS_TRI_EXCLUS } from "../supabase/functions/whatsapp/pret.js";
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
const PRIX_TAXI = "Hello,\n\nThank you for your message. I am assisting with the bookings. 📝🚕\nThe total price for a private minivan for your journey is 2,300 THB, all fees included (including ferry fee).\nPaiement can be made by cash to the driver directly.\n\nLet me know if you have any questions and if you want to book the transfer 🙏🏼\nThank you ✨";
const DEMANDE_SITE = "Transfer request: Hotel A to Krabi Airport\nDate: Sun 22 Nov 2026\nPickup time: 15:00\nGuests: 2 adults\nBags: 2\nPickup: Hotel A\nDrop-off: Krabi Airport\nName: Paul Example\nWhatsApp: +4520000000";
const CONFIRMATION_TAXI = "Thank you for choosing VIP TAXI LANTA. ✨\n\nPlease see the attached confirmation and show it to the driver at pick-up.\nLet us know if everything is correct";

// ---- Les cas réels qui entrent ---------------------------------------------------------------------------------------------------
test("C36 : demande du site, prix, question de paiement, « Would you like to book it ? », « Yes », confirmation envoyée : prête", () => {
  const d = decide([
    ["entrant", DEMANDE_SITE],
    ["sortant", PRIX_TAXI],
    ["entrant", "Is there no way to pay by card?"],
    ["sortant", "Only bank transfer or Wise 😊"],
    ["sortant", "Would you like to book it ? 😊"],
    ["entrant", "Yes"],
    ["sortant", "", "image"],
    ["sortant", CONFIRMATION_TAXI],
    ["entrant", "We will pay in cash"],
  ]);
  assert.equal(d.pret, true);
  assert.equal(d.source, "nani");
  assert.equal(d.motif, "confirmation");
  assert.deepEqual(d.carte, { date: "Sun 22 Nov 2026", heure: "15:00", personnes: "2 adults", depart: "Hotel A", arrivee: "Krabi Airport", nom: "Paul Example", prix: "2,300 THB" });
  assert.ok(!JSON.stringify(d.carte).includes("4520000000"), "jamais le numéro WhatsApp de la demande dans la carte");
  assert.ok(d.depuis < d.le, "depuis : le prix donné, avant le signal");
});

test("C43 : prix, relance de Nani, « Yes we take it! », récapitulatif : prête avec la carte du récapitulatif", () => {
  const d = decide([
    ["entrant", "Hello,\n\nWe would like to book a private taxi transfer for 3 people on November 24, 2026.\n\nPickup: Saladan Pier\nArrival: 10:00 AM\nDestination: Hotel B\nPassengers: 3 adults with luggage\n\nCould you please confirm availability and your total price?\n\nThank you!\nLena"],
    ["sortant", "Hello we have a private Songthaew for 500 THB. 🙏🏼\nFrom the pier to your hotel directly 😊 would you like to book it ?"],
    ["sortant", "Hello would you like that I confirm the driver ? 😊"],
    ["entrant", "Yes we take it!\nThanks\nLena"],
    ["sortant", "Thank you ! ☀️\nThis is you confirmation:\nName: Lena\nDate: November 24th 2026\nPick-up time: 10am\nPick-up location: Saladan Pier\nDrop-off location: Hotel B\nNumber of passengers: 3 adults + luggage\nPrice: 500 THB"],
  ]);
  assert.equal(d.pret, true);
  assert.equal(d.carte.prix, "500 THB");
  assert.equal(d.carte.nom, "Lena");
  assert.equal(d.carte.arrivee, "Hotel B");
  assert.equal(d.carte.personnes, "3 adults + luggage");
});

test("C43 sans le récapitulatif : le « Yes we take it! » du client suffit", () => {
  const d = decide([
    ["entrant", "We would like to book a private taxi for 3 people. Could you please confirm availability and your total price?"],
    ["sortant", "Hello we have a private Songthaew for 500 THB. would you like to book it ?"],
    ["entrant", "Yes we take it!\nThanks\nLena"],
  ]);
  assert.equal(d.pret, true);
  assert.equal(d.source, "client");
  assert.equal(d.motif, "accord");
  assert.equal(d.carte.prix, "500 THB");
});

test("C7 : « yes I want to book the transfer », puis « I will send you the confirmation soon » : prête (et sort au dossier relié)", () => {
  const lignes = [
    ["entrant", "Hi, we are 11 people and need a transfer by mini van.\nDate: 02.January 2027\nTime: 9:30 am\nCan you make us an offer?"],
    ["sortant", "Your will need 2 minivans for your group.\nThe total price for a private minivan for your journey is 5’000 THB, all fees included.\nSo 5000x2 =10’000 THB\nLet me know if you want to book the transfer"],
    ["entrant", "Many thanks, yes I want to book the transfer"],
    ["entrant", "What do you need?"],
    ["sortant", "Sure I will send you the confirmation soon 🙏🏼 I just need the hotel drop off"],
  ];
  const d = decide(lignes);
  assert.equal(d.pret, true);
  assert.equal(d.carte.prix, "10'000 THB", "le total (« = 10’000 THB »), pas le prix d'une voiture");
  // À l'écran : relié à un dossier, la conversation n'est plus dans le filtre.
  assert.equal(E.pretAReserver({ pret_reserver: d, dossier_id: "d1" }), null);
  assert.ok(E.pretAReserver({ pret_reserver: d, dossier_id: null }));
});

test("C41 : « I have already secured your booking » (Nani), même si le client avait écrit « please don't book » avant : prête", () => {
  const d = decide([
    ["entrant", "Hi! Could you confirm the boat type, whether sunset is included and the cancellation deadline? Just checking before deciding, please don't book or hold seats. Thanks!"],
    ["sortant", "Hello thank you for your message. It will be a Sunset Trip, maximum of 15 people. Pick up and drop off included."],
    ["sortant", "I have already secured your booking, but their prices have increased in the meantime. If you cancel and rebook it, you will have to pay the full price 🙏"],
  ]);
  assert.equal(d.pret, true);
  assert.equal(d.motif, "confirmation");
  assert.deepEqual(d.carte, {}, "rien d'écrit à reprendre : carte vide, l'Assistant lira l'échange");
});

test("C45 : « Could you send the taxi to pick us up? », « I will send you the taxi », puis le client annule : sort", () => {
  const avant = [
    ["entrant", "Hello, good night!!! I wanted to know if a taxi is possible now from Hotel C to old town. And what would be the price?"],
    ["sortant", "Hello, yes he is available, the round trip is 800 THB with a local songthaew."],
    ["entrant", "Okay, perfect. Could you send the taxi to pick us up?"],
    ["sortant", "Yes sure I will send you the taxi 😊 🙏🏼"],
    ["sortant", "He will he there in around 15min"],
    ["entrant", "Okay, thank you very much!!!"],
  ];
  assert.equal(decide(avant).pret, true, "entre au « send the taxi »");
  const d = decide([...avant, ["entrant", "Is it possible to cancel the trip? We had an inconvenience"], ["entrant", "I’m very sorry"], ["sortant", "Oh yes I will inform him 😢"], ["entrant", "Likewise, we would go tomorrow. So let’s talk"]]);
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
  assert.equal(decide([["entrant", "Bonjour, combien pour Koh Phi Phi ?"], ["sortant", "Bonjour, c'est 2000 THB par personne 😊"], ["entrant", "On prend, merci !"]]).pret, true);
  assert.equal(decide([["entrant", "D'accord pour samedi"], ["sortant", "Parfait, je prépare la confirmation !"]]).pret, true);
  assert.equal(decide([["sortant", "Merci ! Je vous envoie le voucher dans la journée"]]).pret, true);
  assert.equal(decide([["sortant", "I send you the voucher now ☺️"]]).pret, true);
});

// ---- Les faux positifs évités ---------------------------------------------------------------------------------------------------------
test("C22, C33, C9 : « We would like to book … could you let us know the price » avant tout prix : une demande de prix, pas prête", () => {
  assert.equal(decide([["entrant", "Hello! We would like to book a private van transfer from Koh Lanta to Phuket on November 25th for 2 people. Could you please let us know the price?"]]).pret, false);
  assert.equal(decide([["entrant", "My girlfriend and I would like to book your Phi Phi Islands day trip. Do you still have availability?"]]).pret, false);
});

test("C4, C37, C40 : un prix donné, aucune réponse : pas prête", () => {
  assert.equal(decide([["entrant", DEMANDE_SITE], ["sortant", PRIX_TAXI]]).pret, false);
  assert.equal(decide([["entrant", DEMANDE_SITE], ["sortant", "Hello do you still need it ? I will ask our driver 🙏🏼"], ["sortant", "The price is 2400 THB 😊"]]).pret, false);
});

test("C14, C17, C42, C28 : une relance de Nani « would you like to book ? » sans réponse n'est pas une confirmation", () => {
  assert.equal(decide([["entrant", DEMANDE_SITE], ["sortant", PRIX_TAXI], ["sortant", "Hello woud you like to book the transfer ? ☀️"]]).pret, false);
  assert.equal(decide([["sortant", "Hello are you interested in booking the driver ? 😊"]]).pret, false);
  assert.equal(decide([["sortant", "Hello would you like that I confirm the driver ? 😊"]]).pret, false, "« I confirm » dans une question de Nani");
});

test("C17, C48, C46 : refus après le prix", () => {
  assert.equal(decide([["entrant", DEMANDE_SITE], ["sortant", PRIX_TAXI], ["sortant", "Hello would you like to book the transfer ?"], ["entrant", "No, but thank you for the help! Have a good day"]]).pret, false);
  assert.equal(decide([["sortant", "Would you like to book it for tomorrow ? 😊 ☀️ I can offer it for 1400 THB"], ["entrant", "No thank you\nWe changed our plans"]]).pret, false);
  assert.equal(decide([["entrant", "How much from the pier?"], ["sortant", "The price is 400 THB"], ["entrant", "No not need it anymore"]]).pret, false);
});

test("C35, C14 : hésitation (« I'll think about the price », « I'll let you know »)", () => {
  assert.equal(decide([["sortant", "The total price is 2,300 THB. The driver is ready and available at 1:30pm 🙏🏼"], ["entrant", "I’ll think about the price and let you know in an hour."]]).pret, false);
  assert.equal(decide([["sortant", PRIX_TAXI], ["entrant", "Thank you. What would the round trip cost?"], ["sortant", "To Ao Nang the price is 2700 THB 😊"], ["entrant", "i see, thank you. I'll let you know"]]).pret, false);
});

test("C42 : contre-proposition (« can you do it for 2400 baht? ») et C47 : « Alright… do you have a cheaper option? »", () => {
  assert.equal(decide([["sortant", "The total price is 2’700 THB. Let me know if you want to book the transfer"], ["sortant", "Hello, would you like to book the driver ? 😊"], ["entrant", "Hello, can you do it for 2400 baht? Thx"], ["sortant", "2600 I can 😊"]]).pret, false);
  assert.equal(decide([["sortant", "Ok perfect the round trip is 800 THB with a local songthaew."], ["entrant", "Alright, thanks for your response; do you have a cheaper option?"]]).pret, false);
});

test("C5 et C47 : « ok » ou « alright » qui ne répond pas à une question de réservation", () => {
  assert.equal(decide([["sortant", "Les prix sont très élevés en haute saison, environ 5000 THB la nuit"], ["entrant", "Ok merci pour les infos."]]).pret, false);
  assert.equal(decide([["sortant", "The round trip is 800 THB."], ["entrant", "Ok"]]).pret, false, "« Ok » après un prix sans question de Nani : un accusé de lecture");
});

test("C24 à C30 : demandes d'avis « Thank you again for choosing … » envoyées à la fin d'un séjour : jamais prêtes", () => {
  assert.equal(decide([["sortant", "Thank you again for choosing Secret Travel & Tour.\n\nWe hope you had a great time. If you were happy with our service, we would really appreciate a review on Google.\nhttps://g.page/r/exemple/review"]]).pret, false);
});

test("C6, C38, C30 : un rappel d'un service déjà réservé (« your driver is confirmed tomorrow ») n'est pas un signal", () => {
  assert.equal(decide([["sortant", "Your driver is confirmed tomorrow, have a safe flight ☀️"]]).pret, false);
  assert.equal(decide([["sortant", "Hello yes the driver is confirmed ☀️"]]).pret, false);
  assert.equal(decide([["sortant", "Thank you so much, everything is confirmed on their side 🥰"]]).pret, false);
});

test("C44 : « vous confirmez pour demain matin ? » (une question, sans prix)", () => {
  assert.equal(decide([["entrant", "Bonjour à tous, vous confirmez pour demain matin ?"]]).pret, false);
});

test("C13, C11 : partenaire (récapitulatif « New confirmation » envoyé au chauffeur, « Ok I book » pour un billet) : exclu", () => {
  const recap = [["sortant", "Customer:\nHello, we would like to know your price for a trip?"], ["entrant", "The round-trip price is approximately 800 baht please 😊"], ["sortant", "New confirmation\nName: Lena\nDate: November 24th 2026\nPick-up time: 10am\nPick-up location: Saladan Pier\nDrop-off location: Hotel B\nPrice: 500 THB"]];
  assert.equal(decide(recap, { type_contact: "partenaire" }).pret, false);
  assert.equal(decide(recap, { type_contact: "partenaire" }).motif, "exclue");
  for (const type of ["chauffeur", "hotel", "apporteur"]) assert.equal(decide(recap, { type_contact: type }).motif, "exclue", type);
  assert.equal(decide(recap, { partenaire_id: "p1" }).motif, "exclue", "une fiche partenaire reliée");
  assert.equal(decide([["sortant", "Flight is 1665 THB"], ["entrant", "Please go ahead"]], { type_contact: "partenaire" }).pret, false);
});

test("C34 : un « Yes » sur une question d'itinéraire posée à un bateau (tri « partenaire ») : exclu", () => {
  assert.equal(decide([["sortant", "Hello I have customers interested for November 24th. Is the viewpoint included?"], ["entrant", "Yes"]], { tri: { motif: "partenaire" } }).motif, "exclue");
});

test("C2, C3, C10 : Contact personnel (« Oui super merci ! » pour un cours) : exclu sans même lire les messages", () => {
  assert.equal(decide([["sortant", "Ok pour 14h, 500 THB le cours"], ["entrant", "Oui super merci !"]], { reponses: "jamais" }).motif, "exclue");
  for (const motif of ["personnel", "publicite"]) assert.equal(decide([["sortant", "500 THB"], ["entrant", "we take it"]], { tri: { motif } }).motif, "exclue", motif);
});

test("une demande de client recopiée par Nani pour un chauffeur non typé n'est pas un récapitulatif", () => {
  const d = decide([["sortant", "Hello,\n\nWe would like to book a private taxi transfer for 3 people.\nPickup: Saladan Pier\nDestination: Hotel B\nPassengers: 3 adults\nDate: Nov 24\n\nCould you please confirm availability and your total price?"]]);
  assert.equal(d.pret, false);
  assert.equal(decide([["sortant", "Transfer request: Hotel A to Hotel B\nDate: Sat 21 Nov 2026\nPickup time: 11:15\nGuests: 1 adult\nName: Mia Example"]]).pret, false);
});

test("C1 : prix discuté avec un bateau non typé (« We cannot offer this price ») : rien", () => {
  assert.equal(decide([["sortant", "The price is not 8000 THB for 10?"], ["entrant", "We cannot offer this price."], ["sortant", "Ok 😢 🙏🏼"]]).pret, false);
});

test("une annulation écrite par Nani après le signal fait sortir ; « if you cancel » dans le message du signal, non", () => {
  assert.equal(decide([["sortant", "I have secured your booking 🙏"], ["sortant", "I have cancelled your booking as requested"]]).motif, "annule");
  assert.equal(decide([["sortant", "I have secured your booking. If you cancel and rebook, you will pay the full price."]]).pret, true);
  assert.equal(decide([["sortant", "I have secured your booking 🙏"], ["entrant", "What is the cancellation policy?"]]).pret, true, "« cancellation » n'est pas une annulation");
});

test("le signal le plus récent compte : un nouvel accord après une annulation fait revenir", () => {
  const d = decide([["sortant", "The price is 800 THB. Would you like to book it?"], ["entrant", "Yes please"], ["entrant", "Sorry we need to cancel"], ["sortant", "No problem. Tomorrow it is 800 THB too, would you like to book it?"], ["entrant", "Yes, please book it for tomorrow"]]);
  assert.equal(d.pret, true);
});

test("messages supprimés et réactions ignorés", () => {
  const { conv: c, messages } = conv([["sortant", "The price is 800 THB. Would you like to book it?"], ["entrant", "Yes"], ["entrant", "👍", "reaction"]]);
  messages[1].supprime_le = "2026-11-21T02:00:00.000Z";
  assert.equal(etatPret(c, messages).pret, false, "le « Yes » supprimé ne compte plus");
});

// ---- Briques ---------------------------------------------------------------------------------------------------------------------
test("montants, questions de réservation et champs", () => {
  for (const t of ["2,300 THB", "5’000 THB", "500 baht", "฿ 800", "The price is 2400", "2000 THB per person", "15 €"]) assert.ok(contientPrix(t), t);
  for (const t of ["at 2:30", "for 3 people", "room 204", "Flight TR 682"]) assert.ok(!contientPrix(t), t);
  assert.ok(questionReservation("Would you like to book it ? 😊"));
  assert.ok(questionReservation("Souhaitez-vous réserver pour demain ?"));
  assert.ok(!questionReservation("Could you tell me the name of the hotel ?"));
  assert.deepEqual(champsDe("Name: Lena\nPick-up time: 10am\nWhatsApp: +49 177\nBags: 2"), { nom: "Lena", heure: "10am" });
  assert.equal(prixDonne([{ sens: "sortant", texte: "The price is 2000 THB per person + 400 THB for the national park", envoye_le: "a" }]), "2000 THB / pers.");
  assert.equal(prixDonne([{ sens: "sortant", texte: "2,400 THB for 1 minivan. 2,400*2 = 4'800 THB (in total).", envoye_le: "a" }]), "4'800 THB");
  assert.equal(prixDonne([{ sens: "entrant", texte: "Price on the site: From 2,500 THB", envoye_le: "a" }]), null, "jamais le prix écrit par le client ou le site");
  const carte = carteDe([{ sens: "entrant", texte: "Name: Tom\nPickup: Hotel A\nPrice on the site: From 2,500 THB\nWhatsApp: +447000000000", envoye_le: "a" }]);
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
const DEC = { pret: true, le: "2026-11-21T02:16:00.000Z", depuis: "2026-11-20T08:55:00.000Z", source: "nani", motif: "confirmation", carte: { depart: "Hotel A", arrivee: "Krabi Airport", date: "Sun 22 Nov 2026", prix: "2,300 THB" } };
const C = (o = {}) => ({ id: "c1", telephone: "+45 20 00 00 00", reponses: "auto", type_contact: null, partenaire_id: null, tri: { motif: "remerciement" }, dossier_id: null, client_id: null, pret_reserver: DEC, pret_retire_le: null, ...o });

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
  assert.equal(E.pretRetire(C({ pret_retire_le: "2026-11-21T03:00:00.000Z", dossier_id: "d" })), false, "retirée puis dossier créé : rien à remettre");
  assert.equal(E.pretRetire(C()), false);
  assert.deepEqual(Object.keys(E.patchRetirer()), ["pret_retire_le"]);
  assert.deepEqual(E.patchRemettre(), { pret_retire_le: null });
});

test("écran, C36 : un dossier du même client créé deux minutes avant la confirmation (depuis le prix donné) fait sortir", () => {
  const clients = [{ id: "k1", telephone: "+4520000000" }];
  const dossier = (o) => ({ id: "d", client_id: "k1", annule: false, created_at: "2026-11-21T02:14:00.000Z", ...o });
  assert.equal(E.pretAReserver(C(), { clients, dossiers: [dossier()] }), null, "même numéro, dossier créé après le prix donné");
  assert.ok(E.pretAReserver(C(), { clients, dossiers: [dossier({ created_at: "2026-10-28T10:00:00.000Z" })] }), "un ancien dossier du client ne compte pas");
  assert.ok(E.pretAReserver(C(), { clients, dossiers: [dossier({ annule: true })] }), "un dossier annulé ne compte pas");
  assert.ok(E.pretAReserver(C(), { clients: [{ id: "k1", telephone: "+66 81 234 5678" }], dossiers: [dossier()] }), "un autre client");
  assert.equal(E.pretAReserver(C({ client_id: "k9" }), { clients: [], dossiers: [dossier({ client_id: "k9" })] }), null, "la fiche reliée suffit");
  assert.equal(E.conversationsPretes([C(), C({ id: "c2", dossier_id: "x" })]).length, 1);
});

test("écran : carte et ligne de la liste", () => {
  assert.equal(E.resumeCarte(DEC.carte), "Sun 22 Nov 2026 · 2,300 THB · Hotel A → Krabi Airport");
  assert.deepEqual(E.lignesCarte({ nom: "Lena", prix: "500 THB", inconnu: "x", heure: 10, date: " ​ " }).map((l) => [l.cle, l.valeur]), [["nom", "Lena"], ["prix", "500 THB"]]);
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

// ---- Branchements -------------------------------------------------------------------------------------------------------------------
test("branchements : fonction, reprise, écran, stores, CI", () => {
  const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
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
  assert.match(vue, /cartePret\(c, \{ lectureSeule, creerDossier: creerPret\(c, prop\), rafraichir \}\)/);
  assert.match(lire("src/gestion/js/store-supabase.mjs"), /whatsapp_pret_disponible: conversations !== null && pretDisponible/);
  assert.match(lire("src/gestion/js/store-local.mjs"), /"nom", "pret_retire_le"\]\.includes\(k\)/);
  assert.match(lire(".github/workflows/ci.yml"), /verif-whatsapp-pret/);
  const agent = fs.readdirSync(new URL("../supabase/functions/agent/", import.meta.url)).map((f) => lire(`supabase/functions/agent/${f}`)).join("\n");
  assert.doesNotMatch(agent, /pret_reserver|pret_retire_le/, "l'Assistant ne lit pas ces colonnes");
});
