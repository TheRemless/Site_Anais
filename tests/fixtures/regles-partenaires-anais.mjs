// Partenaires d'Anaïs tels que la migration 43 les laisse (docs/gestion/migration-43-regles-partenaires.sql) : les règles qui étaient
// écrites dans le code d'après leur nom sont sur leur fiche. Les textes sont recopiés de la migration, mot pour mot.
export const CHECKIN_BUNDHAYA = "Check-in at the pier 45 minutes before departure, counter closes 15 minutes before. Please bring this voucher and your passport or ID.";
export const CHECKIN_SATUN = "Please present this voucher at the counter 30 minutes before departure, counter closes 20 minutes before. Passport or ID required.";
export const PASSEPORT_BUNDHAYA = "Check-in 90 minutes before departure, counter closes 45 minutes before. Passport of each passenger required (immigration), kept by the captain during the crossing.";

const neutre = { payer_avant_veille: false, payer_avant_veille_sauf: "", checkin_passeport: "", tarif_zone: false, taxi_defaut: false };
export const BUNDHAYA = { id: "bund", nom: "Bundhaya Speed Boat", regles: { checkin_voucher: CHECKIN_BUNDHAYA }, ...neutre, payer_avant_veille: true, payer_avant_veille_sauf: "Lanta", checkin_passeport: PASSEPORT_BUNDHAYA };
export const SATUN = { id: "satun", nom: "Satun Pakbara Speed Boat Club", regles: { checkin_voucher: CHECKIN_SATUN }, ...neutre };
export const NAN = { id: "nan", nom: "Mr. Nan Taxi", regles: {}, ...neutre, tarif_zone: true, taxi_defaut: true };
export const VIP = { id: "vip", nom: "VIP Taxi Lanta", regles: {}, ...neutre, taxi_defaut: true };
export const RATTANA = { id: "rattana", nom: "Rattana Tour", regles: {}, ...neutre };
export const SANS_REGLE = { id: "autre", nom: "Ferry démo", regles: {}, ...neutre };
export const PARTENAIRES = [BUNDHAYA, SATUN, NAN, VIP, RATTANA, SANS_REGLE];

// reglages.valeur.destinations_passeport et reglages.valeur.compagnies des trois entreprises de Zwald.
export const COMPAGNIES = ["Lomprayah", "Seatran"];
export const DESTINATIONS = [
  {
    lieux: ["Langkawi"],
    mentions: ["Malaysia", "Malaisie"],
    note_en: "Travelling to or from Langkawi (Malaysia): please bring your passport, valid for at least six months.",
    note_fr: "Trajet vers ou depuis Langkawi (Malaisie) : prévoyez votre passeport, valable au moins six mois.",
  },
];
