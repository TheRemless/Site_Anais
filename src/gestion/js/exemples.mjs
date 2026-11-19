// Exemples en gris dans les champs et les aides (SaaS, 19.11.2026).
// L'organisation d'Anaïs (Koh Lanta) et sa démo gardent les lieux de Lanta : rien ne change pour elles.
// Toute autre agence voit des exemples neutres, sans lieu ni monnaie de Thaïlande.
// Logique pure, testée par tests/gestion-exemples.test.js.

import { N_ } from "./i18n.mjs";

// Zwald Travel Planner (migration 42) et la démo d'Anaïs (store-local.mjs, ORG_DEMO).
export const ORGS_LANTA = ["00000000-0000-0000-0000-00000000a000", "demo-organisation"];

// Sans organisation (base d'avant la migration 42), c'est forcément l'outil d'Anaïs.
export const estLanta = (organisationId) => !organisationId || ORGS_LANTA.includes(organisationId);

// [exemple de Lanta, exemple neutre]. Les deux passent par tr() à l'affichage.
const EXEMPLES = {
  hotel: [N_("Hotel Sunset, Klong Dao"), N_("Hotel Sunset, Beach Road")],
  telephone_partenaire: ["081-000-0000", "+1 202 555 0100"],
  aeroport: [N_("Krabi Airport"), N_("City Airport")],
  lieu: [N_("Koh Lanta"), N_("Plage nord")],
  point_embarquement: [N_("Saladan Pier, comptoir n° 3"), N_("Port principal, comptoir n° 3")],
  titre_pickup: [N_("Pickup à Lanta"), N_("Pickup en ville")],
  zone: [N_("Klong Dao"), N_("Plage nord")],
  embarquement: [N_("Saladan Pier"), N_("Main Pier")],
  de: ["Koh Lanta", "Main Pier"],
  vers: ["Phuket", "Turtle Island"],
  parc: [N_("400 THB per adult, 200 THB per child, cash on the island"), N_("Park fee paid in cash on the island")],
  paiement: [N_("Deposit 1,000 THB received, balance at the pier"), N_("Deposit received, balance at the pier")],
  caution: [N_("3,000 THB, returned at drop-off"), N_("Cash deposit, returned at drop-off")],
  banque: [N_("Par exemple : Banque thaïlandaise (THB)"), N_("Par exemple : Banque locale ({devise})")],
  lieu_entreprise: [
    N_("Par exemple « Phuket (Thaïlande) ». Il sert à lire les dates (« demain ») et à situer l'agence."),
    N_("Par exemple « Lisbonne (Portugal) ». Il sert à lire les dates (« demain ») et à situer l'agence."),
  ],
};

export const CLES_EXEMPLES = Object.keys(EXEMPLES);

// Texte source (à passer à tr) de l'exemple demandé. Une clé inconnue rend une chaîne vide : jamais un lieu de Lanta par erreur.
export function exempleDe(cle, organisationId) {
  const paire = EXEMPLES[cle];
  if (!paire) return "";
  return paire[estLanta(organisationId) ? 0 : 1];
}

// Données du voucher d'exemple de l'aperçu des réglages (views/voucher.mjs).
export function voucherExempleDonnees(organisationId) {
  if (estLanta(organisationId)) {
    return {
      billet: "Speedboat transfer: Koh Lanta → Koh Lipe", transfert: "Private minivan: Krabi Airport → Koh Lanta", location: "Honda Click 125",
      activite: "Thai cooking class, market visit and lunch", bateau: "4 Islands by longtail, full day", hotel: "Hotel Example, Klong Dao",
      vol: "FD 3217", embarquement: "Saladan Pier", parc: "400 THB per adult, 200 THB per child, cash on the island", typeBateau: "Longtail",
      de: "Koh Lanta", vers: "Koh Lipe",
    };
  }
  return {
    billet: "Speedboat transfer: Main Pier → Turtle Island", transfert: "Private minivan: City Airport → North Beach", location: "Scooter 125 cc",
    activite: "Cooking class, market visit and lunch", bateau: "Island hopping by boat, full day", hotel: "Hotel Example, North Beach",
    vol: "AB 1234", embarquement: "Main Pier", parc: "Park fee paid in cash on the island", typeBateau: "Speedboat",
    de: "Main Pier", vers: "Turtle Island",
  };
}

// Exemple de « Coller une confirmation » (views/confirmation.mjs). Celui de Lanta est un vrai message de VIP Taxi Lanta, inchangé.
export function confirmationExemple(organisationId, { marque = "", devise = "" } = {}) {
  if (estLanta(organisationId)) {
    return "📢 New booking confirmation:\nVIP TAXI LANTA\nName: Enzo\nDate: November 22nd 2026\nPick-up time: 4:30pm\nPick-up location: Manao villa no 24\nDrop-off location: Rock bar restaurant (and round trip)\nNumber of passengers: 5 people no luggage\nPrice: 1000 THB\nRemark: 50th birthday";
  }
  return `📢 New booking confirmation:\n${String(marque || "City Transfers").toUpperCase()}\nName: Enzo\nDate: November 22nd 2026\nPick-up time: 4:30pm\nPick-up location: Hotel Sunset, Beach Road\nDrop-off location: City Airport\nNumber of passengers: 2 adults, 2 suitcases\nPrice: 50 ${devise || "USD"}\nRemark: flight AB 1234`;
}
