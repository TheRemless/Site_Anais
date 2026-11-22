// Démonstration du filtre « Prêt à réserver » (migration 85) : une conversation de taxi où la cliente dit oui après le prix, puis Nani
// envoie le récapitulatif. Inventée sur le modèle du cas C43 (22.11.2026) : aucun nom, aucune phrase ni aucun lieu réel. La décision (pret_reserver) est
// celle que rend la fonction « whatsapp » sur ces messages : tests/gestion-whatsapp-pret.test.js le vérifie.
import { apercuDepuisMessages } from "./whatsapp-calc.mjs";

export const TELEPHONE_DEMO_PRET = "+447700900633";
export function conversationPret({ taxi, uid, organisation, maintenant = Date.now() }) {
  const il_y_a = (minutes) => new Date(maintenant - minutes * 60000).toISOString();
  const c = { id: uid(), created_at: il_y_a(60 * 5), updated_at: il_y_a(20), organisation_id: organisation, telephone: TELEPHONE_DEMO_PRET, nom: "Sophie", entite_id: taxi ? taxi.id : null, entite_source: "manuel", client_id: null, dossier_id: null, dernier_message_le: null, dernier_sens: null, non_lus: 0, reponses: "auto", tri: { preparer: false, motif: "remerciement", entreprise: "taxi", le: il_y_a(19) }, pret_retire_le: null };
  const messages = [
    { minutes: 60 * 4, sens: "entrant", texte: "Hi! We are 3 and arrive by boat on Saturday morning. Could you take us from the pier to our hotel on the beach? What would it cost? Sophie" },
    { minutes: 60 * 3, sens: "sortant", texte: "Hi Sophie! A private songthaew from the pier to your hotel is 450 THB 😊 would you like to book it?" },
    { minutes: 60 * 2, sens: "sortant", texte: "Hello, shall I confirm the driver for Saturday? 😊" },
    { minutes: 45, sens: "entrant", texte: "Yes please, book it!\nSophie" },
    { minutes: 20, sens: "sortant", texte: "Done ☀️\nThis is your confirmation:\nName: Sophie\nDate: Saturday\nPick-up time: 10am\nPick-up location: Pier\nDrop-off location: beach hotel\nNumber of passengers: 3 adults\nPrice: 450 THB" },
  ].map((x) => ({ id: uid(), conversation_id: c.id, sens: x.sens, origine: x.sens === "entrant" ? "client" : "app", type: "text", texte: x.texte, medias: [], envoye_le: il_y_a(x.minutes), recu_le: il_y_a(x.minutes), modifie_le: null, supprime_le: null }));
  const dernier = messages[messages.length - 1];
  c.pret_reserver = {
    pret: true,
    le: dernier.envoye_le,
    depuis: messages[1].envoye_le,
    message_id: dernier.id,
    source: "nani",
    motif: "confirmation",
    carte: { nom: "Sophie", date: "Saturday", heure: "10am", depart: "Pier", arrivee: "beach hotel", personnes: "3 adults", prix: "450 THB" },
    calcule_le: dernier.envoye_le,
  };
  Object.assign(c, { dernier_message_le: dernier.envoye_le, dernier_sens: dernier.sens }, apercuDepuisMessages(messages));
  return { whatsapp_conversations: [c], whatsapp_messages: messages };
}
