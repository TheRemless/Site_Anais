// Filtre « Prêt à réserver » de l'écran WhatsApp (migration 85, 22.11.2026). Chaque cas reprend le modèle d'une des 48 conversations
// réelles lues le 22.11.2026 (C1 à C48 de docs/gestion/whatsapp-pret-a-reserver.md). Ce dépôt est public : les messages ci-dessous sont
// inventés et reformulés, aucun nom, aucun numéro, aucun hôtel ni aucune phrase de client réel.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { etatPret, carteDe, prixDonne, champsDe, contientPrix, questionReservation, pretChange, conversationPossible, TYPES_EXCLUS, MOTIFS_TRI_EXCLUS } from "../supabase/functions/whatsapp/pret.js";
import * as E from "../src/gestion/js/whatsapp-pret-calc.mjs";
import { conversationPret } from "../src/gestion/js/demo-pret.mjs";

const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
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
const PRIX_TAXI = "Hi! The minivan is 1,900 THB for the whole group, ferry included, paid to the driver.\nJust tell me if you want to book.";
const DEMANDE_SITE = "Transfer request: Hotel A to Airport B\nDate: Mon 7 Dec 2026\nPickup time: 09:00\nGuests: 3 adults\nBags: 3\nPickup: Hotel A\nDrop-off: Airport B\nName: Paul Example\nWhatsApp: +10000000000";
const CONFIRMATION_TAXI = "All set ✨\nYou can find the attached confirmation, keep it for the driver.";

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
    ["entrant", "Cash works for us"],
  ]);
  assert.equal(d.pret, true);
  assert.equal(d.source, "nani");
  assert.equal(d.motif, "confirmation");
  assert.deepEqual(d.carte, { date: "Mon 7 Dec 2026", heure: "09:00", personnes: "3 adults", depart: "Hotel A", arrivee: "Airport B", nom: "Paul Example", prix: "1,900 THB" });
  assert.ok(!JSON.stringify(d.carte).includes("10000000000"), "jamais le numéro WhatsApp de la demande dans la carte");
  assert.ok(d.depuis < d.le, "depuis : le prix donné, avant le signal");
});

test("modèle C43 : prix, deux relances, le client accepte, récapitulatif : prête avec la carte du récapitulatif", () => {
  const d = decide([
    ["entrant", "Good morning, two of us land at the pier on Friday at noon. Any car to our hotel, and how much?\nLena"],
    ["sortant", "A songthaew from the pier costs 400 THB. Shall I book it for you?"],
    ["sortant", "Hello, shall I confirm the driver for you? 😊"],
    ["entrant", "Great, we'll take it!\nLena"],
    ["sortant", "Booked ✅\nHere is your confirmation:\nName: Lena\nDate: Friday\nPick-up time: 12pm\nPick-up location: Pier\nDrop-off location: Hotel C\nNumber of passengers: 2 adults\nPrice: 400 THB"],
  ]);
  assert.equal(d.pret, true);
  assert.equal(d.motif, "confirmation");
  assert.deepEqual(d.carte, { nom: "Lena", date: "Friday", heure: "12pm", depart: "Pier", arrivee: "Hotel C", personnes: "2 adults", prix: "400 THB" });
});

test("modèle C43 sans le récapitulatif : l'accord du client suffit", () => {
  const d = decide([
    ["entrant", "Hi, how much for a taxi from the pier to our hotel?"],
    ["sortant", "Hi! It's 400 THB. Would you like to book it?"],
    ["entrant", "Sounds good, we'll take it"],
  ]);
  assert.equal(d.pret, true);
  assert.equal(d.source, "client");
  assert.equal(d.motif, "accord");
  assert.equal(d.carte.prix, "400 THB");
});

test("modèle C7 : « we want to book », « I'll prepare the confirmation » : prête, et sort au dossier relié", () => {
  const d = decide([
    ["entrant", "Hello, our family of 9 needs a ride from the airport.\nDate: 03.March 2027\nTime: 10:00 am\nPrice please?"],
    ["sortant", "For 9 people it's 2 vans at 3’000 THB each, total = 6’000 THB.\nShall I book them?"],
    ["entrant", "Perfect, we want to book the vans"],
    ["entrant", "Which details should I send?"],
    ["sortant", "Great, I'll prepare the confirmation, just tell me your hotel name"],
  ]);
  assert.equal(d.pret, true);
  assert.equal(d.carte.prix, "6'000 THB", "le total (« = 6’000 THB »), pas le prix d'un van");
  assert.equal(E.pretAReserver({ pret_reserver: d, dossier_id: "d1" }), null, "reliée à un dossier : hors du filtre");
  assert.ok(E.pretAReserver({ pret_reserver: d, dossier_id: null }));
});

test("modèle C41 : Nani écrit « secured your booking », même après une demande d'attendre du client : prête", () => {
  const d = decide([
    ["entrant", "How long is the trip and is lunch included? We have not decided yet, so please wait before booking."],
    ["sortant", "The trip lasts about 7 hours and lunch is included."],
    ["sortant", "Good news, I secured your booking for that day 🙏 If you cancel and book again later, a new price may apply."],
  ]);
  assert.equal(d.pret, true);
  assert.equal(d.motif, "confirmation");
  assert.deepEqual(d.carte, {}, "rien d'écrit à reprendre : carte vide, l'Assistant lira l'échange");
});

test("modèle C45 : « send the taxi », « I'll send you the taxi », puis le client annule : sort", () => {
  const avant = [
    ["entrant", "Can we get a ride to the night market this evening? What's the cost?"],
    ["sortant", "The driver can take you for 600 THB, there and back."],
    ["entrant", "Great, please send the taxi to our hotel."],
    ["sortant", "OK, I'll send you the taxi now 😊"],
    ["sortant", "He is on his way"],
    ["entrant", "Super, thanks"],
  ];
  assert.equal(decide(avant).pret, true, "entre au « send the taxi »");
  const d = decide([...avant, ["entrant", "Change of plan, please cancel it, sorry!"], ["sortant", "No problem, I'll tell him 🙏"], ["entrant", "We might go another day, I'll write again"]]);
  assert.equal(d.pret, false);
  assert.equal(d.motif, "annule", "« I'll write again » n'est pas un nouvel accord");
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
  assert.equal(decide([["entrant", DEMANDE_SITE], ["sortant", "Let me check with the driver 🙏"], ["sortant", "The price is 2100 THB 😊"]]).pret, false);
});

test("modèles C14, C17, C42, C28 : une relance de Nani « would you like to book ? » sans réponse n'est pas une confirmation", () => {
  assert.equal(decide([["entrant", DEMANDE_SITE], ["sortant", PRIX_TAXI], ["sortant", "Still woud you like to book the transfer for Friday?"]]).pret, false);
  assert.equal(decide([["sortant", "Are you still interested in booking a driver for Friday?"]]).pret, false);
  assert.equal(decide([["sortant", "Do you want me to confirm the driver for you?"]]).pret, false, "« I confirm » dans une question de Nani");
});

test("modèles C17, C48, C46 : refus après le prix", () => {
  assert.equal(decide([["entrant", DEMANDE_SITE], ["sortant", PRIX_TAXI], ["sortant", "Would you like to book the transfer?"], ["entrant", "No thanks, we found something else. Have a nice day"]]).pret, false);
  assert.equal(decide([["sortant", "Would you like to book it for Monday? I can do 1200 THB"], ["entrant", "Thanks, but our plans are different now"]]).pret, false);
  assert.equal(decide([["entrant", "How much from the pier?"], ["sortant", "The price is 400 THB"], ["entrant", "We got a lift from our hotel, no need anymore, thanks"]]).pret, false);
});

test("modèles C35, C14 : hésitation (« think about it », « let you know »)", () => {
  assert.equal(decide([["sortant", "The total price is 1,900 THB. The driver can be there at 2pm 🙏"], ["entrant", "Hmm, we need to think about it, I'll come back to you"]]).pret, false);
  assert.equal(decide([["sortant", PRIX_TAXI], ["entrant", "Thanks. And what would a return trip cost?"], ["sortant", "The return is 2300 THB 😊"], ["entrant", "Noted, we will let you know tomorrow"]]).pret, false);
});

test("modèles C42 et C47 : contre-proposition, demande de moins cher", () => {
  assert.equal(decide([["sortant", "The total price is 2’500 THB. Tell me if you want to book the transfer"], ["sortant", "Hello, would you like to book the driver? 😊"], ["entrant", "Is 2000 possible if we pay cash?"], ["sortant", "2300 is possible 😊"]]).pret, false);
  assert.equal(decide([["sortant", "The return trip is 600 THB with a songthaew."], ["entrant", "Ok, is there a cheaper way to get there?"]]).pret, false);
});

test("modèles C5 et C47 : « ok » qui ne répond pas à une question de réservation", () => {
  assert.equal(decide([["sortant", "En haute saison les chambres sont autour de 4000 THB la nuit"], ["entrant", "Ok merci pour l'info."]]).pret, false);
  assert.equal(decide([["sortant", "The return trip is 600 THB."], ["entrant", "Ok"]]).pret, false, "« Ok » après un prix sans question de Nani : un accusé de lecture");
});

test("modèles C24 à C30 : demande d'avis Google en fin de séjour : jamais prête", () => {
  assert.equal(decide([["sortant", "We hope you enjoyed your holiday! A short review on Google would help us a lot.\nhttps://g.page/r/exemple/review"]]).pret, false);
});

test("modèles C6, C38, C30 : un rappel d'un service déjà réservé n'est pas un signal", () => {
  assert.equal(decide([["sortant", "Reminder: the driver picks you up tomorrow at 8, he is confirmed."]]).pret, false);
  assert.equal(decide([["sortant", "Yes, all set, your driver is confirmed for the morning"]]).pret, false);
  assert.equal(decide([["sortant", "The boat team confirmed everything for today"]]).pret, false);
});

test("modèle C44 : une question de confirmation, sans prix", () => {
  assert.equal(decide([["entrant", "Bonsoir, c'est toujours bon pour le rendez-vous de demain ?"]]).pret, false);
});

test("modèles C13, C11 : partenaire (récapitulatif envoyé au chauffeur, « go ahead » d'une partenaire) : exclu à l'écran, sur le type du moment", () => {
  const recap = [["sortant", "Customer:\nHow much for a return trip to the old town?"], ["entrant", "Around 600 baht return"], ["sortant", "New booking\nName: Lena\nDate: Friday\nPick-up time: 12pm\nPick-up location: Pier\nDrop-off location: Hotel C\nPrice: 400 THB"]];
  // La fonction calcule pour tout contact sauf un Contact personnel ; l'écran écarte le contact typé tant qu'il l'est.
  for (const extra of [{ type_contact: "partenaire" }, { type_contact: "partenaire", type_source: "deduit" }, { type_contact: "apporteur" }, { partenaire_id: "p1" }]) {
    const d = decide(recap, extra);
    assert.equal(E.pretAReserver({ pret_reserver: d, reponses: "auto", ...extra }), null, JSON.stringify(extra));
  }
  assert.equal(E.pretAReserver({ pret_reserver: decide([["sortant", "The ticket is 1500 THB"], ["entrant", "Please go ahead"]], { type_contact: "partenaire" }), type_contact: "partenaire" }), null);
});

test("relecture n° 9 : un contact remis en Client est repris tout de suite, sans attendre un nouveau message", () => {
  const lignes = [["sortant", "A songthaew from the pier costs 400 THB. Shall I book it for you?"], ["entrant", "Great, we'll take it!"]];
  const d = decide(lignes, { type_contact: "partenaire" });
  assert.equal(d.pret, true, "la décision est déjà calculée pendant que le contact est typé « partenaire »");
  assert.equal(E.pretAReserver({ pret_reserver: d, reponses: "auto", type_contact: "partenaire" }), null);
  assert.ok(E.pretAReserver({ pret_reserver: d, reponses: "auto", type_contact: "client" }), "remis en Client : dans le filtre aussitôt");
  // Un Contact personnel n'est jamais lu ; remis en « auto », la reprise le recalcule (FILTRE_RATTRAPAGE).
  assert.equal(decide(lignes, { reponses: "jamais" }).motif, "exclue");
  assert.match(lire("supabase/functions/whatsapp/pret.ts"), /FILTRE_RATTRAPAGE = "pret_reserver\.is\.null,and\(pret_reserver->>motif\.eq\.exclue,reponses\.neq\.jamais\)"/);
});

test("préparation de la #314 : les messages « non transmis » ne sont pas lus", () => {
  assert.match(lire("supabase/functions/whatsapp/pret.ts"), /\.neq\("type", "non_transmis"\)/);
});

test("modèle C34 : un « Yes » d'un bateau sur l'itinéraire : pas « prêt » (la question n'est pas un prix) ; exclu à l'écran une fois typé partenaire", () => {
  const d = decide([["sortant", "Do you stop at the snorkeling spot on the Sunday trip?"], ["entrant", "Yes"]], { tri: { motif: "partenaire" } });
  assert.equal(E.pretAReserver({ pret_reserver: d, tri: { motif: "partenaire" } }), null);
  assert.equal(E.pretAReserver({ pret_reserver: d, type_contact: "partenaire", type_source: "deduit" }), null);
});

test("relecture finale (migration 110) : le motif « partenaire » d'un seul tri ne sort plus une conversation du « Prêt à réserver »", () => {
  const d = decide([["entrant", "How much to the pier for 2?"], ["sortant", "450 THB by songthaew"], ["entrant", "Yes please book it"]]);
  assert.equal(d.pret, true);
  assert.ok(E.pretAReserver({ pret_reserver: d, reponses: "auto", tri: { motif: "partenaire" } }), "un seul tri « partenaire » : reste");
  assert.equal(E.pretAReserver({ pret_reserver: d, reponses: "auto", type_contact: "partenaire", type_source: "deduit" }), null, "type déduit : sort");
  assert.equal(E.pretAReserver({ pret_reserver: d, reponses: "auto", type_contact: "partenaire", type_source: "nani" }), null, "type de Nani : sort");
  assert.ok(!E.MOTIFS_TRI_EXCLUS.includes("partenaire") && !MOTIFS_TRI_EXCLUS.includes("partenaire"));
});

test("modèles C2, C3, C10 : Contact personnel : exclu sans même lire les messages ; tri personnel ou publicité : exclu à l'écran", () => {
  assert.equal(decide([["sortant", "Ok pour 14h, 500 THB la séance"], ["entrant", "Oui parfait merci !"]], { reponses: "jamais" }).motif, "exclue");
  for (const motif of ["personnel", "publicite"]) assert.equal(E.pretAReserver({ pret_reserver: decide([["sortant", "500 THB"], ["entrant", "we take it"]], { tri: { motif } }), tri: { motif } }), null, motif);
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
  assert.equal(E.pretAReserver(C({ type_contact: "partenaire", type_source: "deduit" })), null);
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

const MARQUES = { taxi: "taxi", secret: "secret", ztp: null };
const marqueDe = (id) => MARQUES[id] || null;
test("écran, modèle C36 : dossier créé deux minutes avant la confirmation mais pas relié : reste dans le filtre avec « Relier au dossier »", () => {
  const clients = [{ id: "k1", telephone: "+10000000001", entite_id: "taxi" }];
  const dossier = (o) => ({ id: "d", ref: "2026-0001", entite_id: "taxi", client_id: "k1", annule: false, created_at: "2026-11-21T02:14:00.000Z", ...o });
  const ctx = (o = {}) => ({ clients, dossiers: [dossier()], marqueDe, ...o });
  assert.ok(E.pretAReserver(C(), ctx()), "toujours dans le filtre tant que la conversation n'est pas reliée");
  assert.equal(E.dossierARelier(C(), ctx()).id, "d", "même numéro, dossier créé après le prix donné");
  assert.equal(E.dossierARelier(C(), ctx({ dossiers: [dossier({ created_at: "2026-10-28T10:00:00.000Z" })] })), null, "un ancien dossier du client n'est pas proposé");
  assert.equal(E.dossierARelier(C(), ctx({ dossiers: [dossier({ annule: true })] })), null, "un dossier annulé non plus");
  assert.equal(E.dossierARelier(C(), ctx({ clients: [{ id: "k1", telephone: "+20 999 999 999" }] })), null, "un autre client");
  assert.equal(E.dossierARelier(C({ client_id: "k9" }), ctx({ clients: [], dossiers: [dossier({ client_id: "k9" })] })).id, "d", "la fiche reliée suffit");
  assert.equal(E.dossierARelier(C(), ctx({ dossiers: [dossier(), dossier({ id: "d2", created_at: "2026-11-21T03:00:00.000Z" })] })).id, "d2", "le plus récent");
  // Une fois reliée à ce dossier (créé depuis le prix), elle sort.
  assert.equal(E.pretAReserver(C({ client_id: "k1", dossier_id: "d" }), ctx()), null);
  assert.equal(E.conversationsPretes([C(), C({ id: "c2", dossier_id: "d" })], ctx()).length, 1);
});

test("relecture n° 2 : ZTP ne se mélange jamais : un dossier ZTP n'est ni proposé à la liaison, ni pris pour celui de la réservation", () => {
  const clients = [{ id: "kz", telephone: "+10000000001", entite_id: "ztp" }];
  const ztp = { id: "dz", ref: "ZTP-1", entite_id: "ztp", client_id: "kz", annule: false, created_at: "2026-11-21T02:14:00.000Z" };
  assert.equal(E.dossierARelier(C(), { clients, dossiers: [ztp], marqueDe }), null);
  assert.ok(E.pretAReserver(C({ dossier_id: "dz" }), { dossiers: [ztp], marqueDe }), "un dossier ZTP relié ne fait pas sortir");
  assert.equal(E.dossierARelier(C(), { clients, dossiers: [ztp] }), null, "sans marqueDe, aucun dossier ne compte");
  // « Créer le dossier » n'est jamais masqué par un dossier déjà là (peut-être de l'autre entreprise).
  const vue = lire("src/gestion/js/views/whatsapp-pret.mjs");
  assert.match(vue, /creerDossier \? h\("button", \{ class: patch \? "secondaire petit" : "principal petit"/);
  assert.match(vue, /const contexte = \(\) => \(\{ dossiers: .*marqueDe \}\)/);
});

test("relecture n° 6 : un client qui revient (arrivée puis transfert retour) : un dossier relié plus ancien n'exclut pas la nouvelle demande", () => {
  const ancien = { id: "d0", entite_id: "taxi", client_id: "k1", annule: false, created_at: "2026-11-10T02:00:00.000Z" };
  assert.ok(E.pretAReserver(C({ dossier_id: "d0" }), { dossiers: [ancien], marqueDe }), "dossier de l'arrivée, antérieur au prix du retour");
  const nouveau = { ...ancien, id: "d1", created_at: "2026-11-21T03:00:00.000Z" };
  assert.equal(E.dossierARelier(C({ dossier_id: "d0" }), { clients: [{ id: "k1", telephone: "+10000000001" }], dossiers: [ancien, nouveau], marqueDe }).id, "d1", "le dossier du retour est proposé, pas celui déjà relié");
  assert.equal(E.pretAReserver(C({ dossier_id: "d1" }), { dossiers: [ancien, nouveau], marqueDe }), null, "relié au dossier du retour : sort");
  assert.equal(E.pretAReserver(C({ dossier_id: "d0" })), null, "sans les dossiers chargés, un dossier relié compte comme celui-ci (prudent)");
});

test("relecture n° 1 : relier ne range jamais la conversation d'un client ; un dossier Secret ou Taxi se relie pareil", () => {
  const dT = { id: "dt", entite_id: "taxi", client_id: "kt" };
  const dS = { id: "ds", entite_id: "secret", client_id: "ks" };
  assert.deepEqual(E.patchRelier(C(), dT), { client_id: "kt", dossier_id: "dt" }, "à trier : reliée, pas rangée");
  assert.deepEqual(E.patchRelier(C(), dS), { client_id: "ks", dossier_id: "ds" });
  assert.deepEqual(E.patchRelier(C({ entite_id: "taxi" }), dT), { client_id: "kt", dossier_id: "dt" }, "déjà chez Taxi, dossier Taxi : rien ne change d'entreprise");
  assert.deepEqual(E.patchRelier(C({ entite_id: "taxi" }), dS), { entite_id: null, client_id: "ks", dossier_id: "ds" }, "rangée chez Taxi, dossier Secret : redevient commune");
  assert.equal(E.patchRelier(C({ type_contact: "partenaire" }), dT), null, "pas pour un contact qui n'est pas un client");
  // « Créer le dossier » demande toujours l'entreprise pour un client, la suggestion présélectionnée.
  const vue = lire("src/gestion/js/views/whatsapp.mjs");
  assert.match(vue, /const entreprise = commun \? await choisirEntreprise\(c, prop, suggeree\)/);
  assert.match(vue, /if \(commun && c\.entite_id && c\.entite_id !== entiteId\)/);
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
test("branchements : fonction, reprise, écran, stores, CI", () => {
  const index = lire("supabase/functions/whatsapp/index.ts");
  assert.match(index, /enFond\(pretApresMessage\(db, data\.conversation_id\)\)/, "après chaque nouveau message");
  assert.match(index, /enFond\(pretApresMessage\(db, conv\.id\)\)/, "après un message modifié ou supprimé");
  assert.match(index, /if \(!idCourant\) await rattraperPret\(db, ORGANISATION\)/, "rattrapage à la reprise seulement");
  const ts = lire("supabase/functions/whatsapp/pret.ts");
  assert.doesNotMatch(ts, /@anthropic-ai|messages\.create/, "aucun appel à l'IA");
  assert.doesNotMatch(lire("supabase/functions/whatsapp/pret.js"), /^import/m, "la règle n'importe rien (pas de réseau, pas d'IA)");
  assert.match(ts, /patch\.pret_reserver = decision/, "pret_reserver écrite seulement si la décision change");
  const vue = lire("src/gestion/js/views/whatsapp.mjs");
  assert.match(vue, /filtrePretDisponible\(\) \? \[FILTRE_PRET\]/);
  assert.match(vue, /cartePret\(c, \{ lectureSeule, creerDossier: creerPret\(c, prop\), peutRelierDans: \(id\) => entitesWhatsApp\(\)\.some\(\(e\) => e\.id === id\), rafraichir \}\)/);
  assert.match(lire("src/gestion/js/store-supabase.mjs"), /whatsapp_pret_disponible: conversations !== null && pretDisponible/);
  assert.match(lire("src/gestion/js/store-local.mjs"), /"nom", "pret_retire_le"[,\]]/);
  assert.match(lire(".github/workflows/ci.yml"), /verif-whatsapp-pret/);
  const agent = fs.readdirSync(new URL("../supabase/functions/agent/", import.meta.url)).map((f) => lire(`supabase/functions/agent/${f}`)).join("\n");
  assert.doesNotMatch(agent, /pret_reserver|pret_retire_le/, "l'Assistant ne lit pas ces colonnes");
});

test("dépôt public : aucun numéro de téléphone plausible dans les fichiers de « Prêt à réserver »", () => {
  const fichiers = ["tests/gestion-whatsapp-pret.test.js", "docs/gestion/whatsapp-pret-a-reserver.md", "src/gestion/js/demo-pret.mjs", "supabase/functions/whatsapp/pret.js", "docs/gestion/verif-whatsapp-pret.mjs"];
  for (const f of fichiers) {
    const numeros = (lire(f).match(/\+\d[\d ]{8,}\d/g) || []).filter((x) => !/^\+1\s?0{2}|^\+10|^\+20 9|^\+447700900/.test(x.replace(/ (?=\d)/g, "")) && !/^\+20 9/.test(x));
    assert.deepEqual(numeros, [], `${f} : seulement des numéros fictifs (+10…, +447700900…)`);
  }
});
