// Démonstration du type du contact déduit (migration 110) : le propriétaire d'un bateau, pas encore typé par Nani, que l'outil reconnaît
// comme partenaire par le sens de l'échange. Inventée sur le modèle du cas C12 (22.11.2026) : aucun nom, aucune phrase ni aucun lieu réel.
// Les repères (type_signaux) sont ceux que rend la fonction « whatsapp » sur ces messages : tests/gestion-whatsapp-type.test.js le vérifie.
import { apercuDepuisMessages } from "./whatsapp-calc.mjs";

export const TELEPHONE_DEMO_TYPE = "+447700900717";
export const MESSAGES_DEMO_TYPE = [
  { minutes: 60 * 6, sens: "sortant", texte: "Hi! Is your boat free on Thursday?" },
  { minutes: 60 * 6 - 3, sens: "entrant", texte: "Thursday the 26th?" },
  { minutes: 60 * 6 - 4, sens: "sortant", texte: "สวัสดีค่ะ พฤหัสนี้มีเรือว่างไหมคะ ลูกค้าอยากไปดำน้ำทั้งวัน" },
  { minutes: 60 * 5, sens: "entrant", texte: "Yes it is free. For 8 people I can propose a price of 9,500 with lunch and drinks." },
  { minutes: 60 * 5 - 2, sens: "sortant", texte: "Thank you, I will ask my customers and come back to you 🙏" },
];
export function conversationTypeDeduit({ secret, uid, organisation, maintenant = Date.now() }) {
  const il_y_a = (minutes) => new Date(maintenant - minutes * 60000).toISOString();
  const c = { id: uid(), created_at: il_y_a(60 * 7), updated_at: il_y_a(60 * 5), organisation_id: organisation, telephone: TELEPHONE_DEMO_TYPE, nom: "Boat Lanta", entite_id: secret ? secret.id : null, entite_source: "manuel", client_id: null, dossier_id: null, dernier_message_le: null, dernier_sens: null, non_lus: 0, reponses: "auto" };
  const messages = MESSAGES_DEMO_TYPE.map((x) => ({ id: uid(), conversation_id: c.id, sens: x.sens, origine: x.sens === "entrant" ? "client" : "app", type: "text", texte: x.texte, medias: [], envoye_le: il_y_a(x.minutes), recu_le: il_y_a(x.minutes), modifie_le: null, supprime_le: null }));
  Object.assign(c, {
    type_contact: "partenaire",
    type_source: "deduit",
    tri: { preparer: false, motif: "partenaire", entreprise: "secret", contact: "partenaire", le: il_y_a(60 * 5) },
    // Deux décisions du tri, sur deux messages différents du contact : la règle pose « partenaire » (type-contact.js, typeADeduire).
    type_avis: { v: 1, decisions: [messages[1], messages[3]].map((m, i) => ({ type: "partenaire", raison: i ? "donne ses disponibilités et ses prix à Nani" : "répond à une demande de disponibilité", m: m.id, le: m.envoye_le })) },
    type_signaux: { v: 2, codes: { dispo_demandee: 1, thai_nani: 1, prix_du_contact: 1, clients_nani: 1 }, score: 7, nets: true, calcule_le: il_y_a(60 * 5) },
  });
  Object.assign(c, { dernier_message_le: messages.at(-1).envoye_le, dernier_sens: messages.at(-1).sens }, apercuDepuisMessages(messages));
  return { whatsapp_conversations: [c], whatsapp_messages: messages };
}
