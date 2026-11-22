// Démonstration du filtre « Prêt à réserver » (migration 85) : une conversation de taxi où la cliente dit oui après le prix, puis Nani
// envoie le récapitulatif. Inventée d'après le cas réel C43 (22.11.2026), sans aucune donnée réelle. La décision (pret_reserver) est
// celle que rend la fonction « whatsapp » sur ces messages : tests/gestion-whatsapp-pret.test.js le vérifie.
import { apercuDepuisMessages } from "./whatsapp-calc.mjs";

export const TELEPHONE_DEMO_PRET = "+447700900633";
export function conversationPret({ taxi, uid, organisation, maintenant = Date.now() }) {
  const il_y_a = (minutes) => new Date(maintenant - minutes * 60000).toISOString();
  const c = { id: uid(), created_at: il_y_a(60 * 5), updated_at: il_y_a(20), organisation_id: organisation, telephone: TELEPHONE_DEMO_PRET, nom: "Sophie", entite_id: taxi ? taxi.id : null, entite_source: "manuel", client_id: null, dossier_id: null, dernier_message_le: null, dernier_sens: null, non_lus: 0, reponses: "auto", tri: { preparer: false, motif: "remerciement", entreprise: "taxi", le: il_y_a(19) }, pret_retire_le: null };
  const messages = [
    { minutes: 60 * 4, sens: "entrant", texte: "Hello, we would like a private taxi for 3 people on Saturday.\nPickup: Saladan Pier, arrival 10:00 AM\nDestination: our hotel on Long Beach\nCould you confirm availability and the total price? Thank you! Sophie" },
    { minutes: 60 * 3, sens: "sortant", texte: "Hello we have a private songthaew for 500 THB, from the pier to your hotel directly 😊 would you like to book it ?" },
    { minutes: 60 * 2, sens: "sortant", texte: "Hello would you like that I confirm the driver ? 😊" },
    { minutes: 45, sens: "entrant", texte: "Yes we take it!\nThanks\nSophie" },
    { minutes: 20, sens: "sortant", texte: "Thank you ! ☀️\nThis is your confirmation:\nName: Sophie\nDate: Saturday\nPick-up time: 10am\nPick-up location: Saladan Pier\nDrop-off location: hotel on Long Beach\nNumber of passengers: 3 adults + luggage\nPrice: 500 THB" },
  ].map((x) => ({ id: uid(), conversation_id: c.id, sens: x.sens, origine: x.sens === "entrant" ? "client" : "app", type: "text", texte: x.texte, medias: [], envoye_le: il_y_a(x.minutes), recu_le: il_y_a(x.minutes), modifie_le: null, supprime_le: null }));
  const dernier = messages[messages.length - 1];
  c.pret_reserver = {
    pret: true,
    le: dernier.envoye_le,
    depuis: messages[1].envoye_le,
    message_id: dernier.id,
    source: "nani",
    motif: "confirmation",
    carte: { nom: "Sophie", date: "Saturday", heure: "10am", depart: "Saladan Pier", arrivee: "hotel on Long Beach", personnes: "3 adults + luggage", prix: "500 THB" },
    calcule_le: dernier.envoye_le,
  };
  Object.assign(c, { dernier_message_le: dernier.envoye_le, dernier_sens: dernier.sens }, apercuDepuisMessages(messages));
  return { whatsapp_conversations: [c], whatsapp_messages: messages };
}
