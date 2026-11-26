// Textes imprimés sur les vouchers de Secret et la Booking confirmation de Taxi, réglables dans Réglages > Vouchers (lot B du 17.11.2026).
// Une clé par ligne, avec le texte d'aujourd'hui comme défaut : un champ vidé revient au défaut. Toujours en anglais (le client les lit).
// Logique pure, sans DOM, testée dans tests/gestion-lot-b-vouchers.test.js.
import { N_ } from "./i18n.mjs";

// Groupes affichés dans les réglages. `titre` : en français (interface) ; chaque ligne : [clé, texte par défaut].
export const GROUPES_VOUCHER = [
  {
    titre: N_("Titres et en-tête"),
    cles: [
      ["titre_billet", "Boat Ticket Voucher"],
      ["titre_bateau", "Boat Tour Voucher"],
      ["titre_transfert", "Transfer Voucher"],
      ["titre_activite", "Activity & Tour Voucher"],
      ["titre_location", "Rental Voucher"],
      ["numero", "Voucher No."],
      ["date_emission", "Date"],
      ["licence", "Licence"],
      ["whatsapp", "Whatsapp"],
      ["email", "E-mail"],
      ["rubrique_client", "CUSTOMER DETAILS"],
      ["rubrique_reservation", "BOOKING DETAILS"],
      ["rubrique_paiement", "PAYMENT DETAILS"],
    ],
  },
  {
    titre: N_("Client"),
    cles: [
      ["nom_client", "Guest Name"],
      ["telephone", "WhatsApp / Phone"],
      ["hotel", "Hotel / Accommodation"],
      ["chambre", "Room No"],
    ],
  },
  {
    titre: N_("Lignes de la réservation"),
    cles: [
      ["route", "Route"],
      ["date_trajet", "Travel Date"],
      ["heure_depart", "Departure Time"],
      ["heure_arrivee", "Arrival Time"],
      ["bateau", "Boat"],
      ["compagnie", "Company"],
      ["embarcadere", "Departure Pier / Check-in Point"],
      ["pickup_hotel", "Hotel Pickup"],
      ["a_heure", "at"],
      ["passagers", "Number of Passengers"],
      ["invites", "Number of Guests"],
      ["adultes", "Adults"],
      ["enfants", "Children"],
      ["bebes", "Infants"],
      ["bagages", "Luggage"],
      ["nom_tour", "Tour Name"],
      ["date", "Date"],
      ["horaires", "Tour Hours"],
      ["quai", "Departure Pier"],
      ["heure_pickup", "Pickup Time"],
      ["lieu_pickup", "Pickup Location"],
      ["type_tour", "Tour Type"],
      ["join", "Join Tour"],
      ["prive", "Private Tour"],
      ["operateur", "Company / Operator"],
      ["pickup_retour", "Pickup and return"],
      ["programme_trajet", "Plan"],
      ["duree", "Duration"],
      ["drop_off", "Drop-off Location"],
      ["vol", "Flight Number"],
      ["type_transfert", "Transfer Type"],
      ["taxi_prive", "Private Taxi"],
      ["minivan_prive", "Private Minivan"],
      ["minivan_partage", "Shared Minivan"],
      ["vehicule", "Vehicle"],
      ["type_moteur", "Type / Engine"],
      ["prise", "Pickup Date & Time"],
      ["retour", "Return Date & Time"],
      ["lieu_retour", "Return Location"],
      ["duree_location", "Rental Duration"],
      ["jour", "day"],
      ["jours", "days"],
      ["conducteur", "Driver's Name"],
      ["permis", "Driving Licence"],
      ["equipement", "Equipment"],
      ["activite", "Activity / Tour"],
      ["programme", "Program / Option"],
      ["date_heure", "Date & Time"],
      ["remarques", "Remarks"],
      ["ref_operateur", "Operator ref."],
    ],
  },
  {
    titre: N_("Paiement"),
    cles: [
      ["prix_total", "Total Price"],
      ["montant_total", "Total Amount"],
      ["prix_personne", "Price per Person"],
      ["tarif_jour", "Daily Rate"],
      ["caution", "Security Deposit"],
      ["parc", "National Park Fee"],
      ["parc_inclus", "Included"],
      ["parc_non_inclus", "Not Included"],
      ["statut_paiement", "Payment Status"],
      ["paye", "Paid"],
      ["paye_tout", "Paid in Full"],
      ["acompte", "Deposit Paid"],
      ["en_attente", "Payment Pending"],
      ["sur_place_billet", "Pay at Counter"],
      ["sur_place_bateau", "Pay at Pier / Provider"],
      ["sur_place_transfert", "Pay Driver Directly"],
      ["sur_place_activite", "Pay on Arrival"],
      // Acompte versé sur un service payé sur place (26.11.2026).
      ["montant_verse", "Amount Already Paid"],
      ["reste_sur_place", "Balance to Pay on Arrival"],
    ],
  },
  {
    titre: N_("Consignes"),
    cles: [
      ["checkin", "Check-in"],
      ["lobby", "Please be ready in your hotel lobby 15 minutes before the pickup time, with this voucher and your passport or ID."],
      ["conditions_location", "Rental terms"],
    ],
  },
];

// Booking confirmation du mode taxi : le modèle d'Anaïs (12.11.2026). `paiement_wise` reste tel quel (décision 6 du 17.11.2026) ; il est
// seulement modifiable comme le reste. `{ENTREPRISE}` : le nom de l'entreprise du voucher, en capitales (migration 44 : les textes d'Anaïs,
// avec sa marque écrite en toutes lettres, sont dans ses réglages).
export const GROUPES_BOOKING = [
  {
    titre: N_("Titre et rubriques"),
    cles: [
      ["b_titre_1", "BOOKING"],
      ["b_titre_2", "CONFIRMATION"],
      ["b_nom", "NAME"],
      ["b_date", "DATE"],
      ["b_pickup", "PICK UP LOCATION"],
      ["b_pickup_retour", "PICK UP AND RETURN"],
      ["b_heure", "PICK UP TIME"],
      ["b_programme", "PLAN"],
      ["b_duree", "DURATION"],
      ["b_dropoff", "DROP OFF LOCATION"],
      ["b_passagers", "PASSENGERS"],
      ["b_bagages", "LUGGAGE"],
      ["b_prix", "TOTAL PRICE"],
      ["b_remarques", "REMARKS"],
      ["b_verse", "ALREADY PAID"],
      ["b_reste", "BALANCE TO PAY"],
      ["b_tous_frais", "(all fees included)"],
      ["b_contact", "CONTACT US:"],
    ],
  },
  {
    titre: N_("Textes"),
    cles: [
      ["b_intro", "We’re happy to confirm your booking details as follows:"],
      ["b_paiement", "Payment will be collected in cash by the driver directly"],
      ["b_paiement_wise", "(or you can pay through Wise with a 3% fee, please inform us before)"],
      // Tout est déjà payé (26.11.2026) : rien à payer au chauffeur.
      ["b_paiement_paye", "Your transfer is fully paid: nothing to pay to the driver."],
      ["b_attente", "Your driver will be waiting for you at the meeting point."],
      ["b_changement", "If your plan changes, please let us know as soon as possible."],
      ["b_merci", "Thank you for choosing {ENTREPRISE} – we look forward to driving you safely and comfortably to your destination! 🚐✨"],
      ["b_salutation", "Kind regards,"],
      ["b_signature", "{ENTREPRISE} Team"],
    ],
  },
];

// Booking confirmation de Secret Travel & Tour (Jérémy, 18.11.2026) : le modèle « Minivan Booking Confirmation », mot pour mot, pour les transferts
// payés au chauffeur sans partenaire (taxi indépendant, voucher de Mook). Les rubriques (NAME, DATE…), le titre et « CONTACT US: » sont ceux de
// la Booking confirmation de Taxi (clés « b_… »). `{ENTREPRISE}` : le nom de l'entreprise du voucher, en capitales comme sur le modèle.
export const GROUPES_BOOKING_SECRET = [
  {
    titre: N_("Booking confirmation des transferts payés au chauffeur"),
    cles: [
      ["bs_intro", "We’re happy to confirm your transport reservation details:"],
      ["bs_info", "IMPORTANT INFORMATION & PAYMENT:"],
      ["bs_paiement", "Payment: To be paid directly in cash to your driver upon arrival/pickup."],
      ["bs_paiement_paye", "Payment: fully paid, nothing to pay to your driver."],
      ["bs_rencontre", "Meeting Point: Your assigned driver will be holding a sign with your name at the designated meeting area."],
      ["bs_assistance", "Assistance: For any urgent changes or flight delays, please contact us immediately on WhatsApp."],
      ["bs_merci", "Thank you for booking with {ENTREPRISE}!\nWe wish you a pleasant journey. ✨"],
      ["bs_signature", "{ENTREPRISE} Team"],
    ],
  },
];

// Le lieu sous la signature est l'adresse du bloc d'en-tête (« Adresse sur une ligne ») ; ce texte ne sert que quand elle est vide.
export const DEFAUTS_TEXTES = { ...Object.fromEntries([...GROUPES_VOUCHER, ...GROUPES_BOOKING, ...GROUPES_BOOKING_SECRET].flatMap((g) => g.cles)), b_lieu: "" };

// La fonction qui donne le texte d'une clé pour ces réglages : celui saisi dans `voucher.textes`, sinon le défaut. Un texte fait seulement
// d'espaces vaut le défaut (un champ vidé ne doit jamais imprimer un intitulé vide).
export function textesVoucher(reglages) {
  const saisis = (reglages && reglages.voucher && reglages.voucher.textes) || {};
  return (cle) => {
    const v = saisis[cle];
    return typeof v === "string" && v.trim() ? v.trim() : DEFAUTS_TEXTES[cle] ?? cle;
  };
}

// Ce qui s'enregistre : seulement les textes différents du défaut (un défaut qui change plus tard reste suivi).
export function textesAEnregistrer(saisis) {
  return Object.fromEntries(Object.entries(saisis || {}).filter(([k, v]) => typeof v === "string" && v.trim() && v.trim() !== DEFAUTS_TEXTES[k]).map(([k, v]) => [k, v.trim()]));
}
