// Données du guide « Les excursions en bateau depuis Ao Nang » : tours privés en long tail boat, du plus économique au plus luxueux.
// Le HTML (_includes/carnet-guide.njk) et la feuille de réservation (js/carnet-booking.js) lisent tous deux ce fichier, comme pour Koh Samui.
// Prix de vente en THB, par bateau. Aucun nom de prestataire ici ni dans la page : les offres s'appellent « Option VIP », « Mini Luxury », « Luxury »
// (des noms d'offre), « option plus économique » et « option encore plus luxueuse ».
const { construire } = require("./guide-commun.js");

const reglages = {
  // Après l'envoi de la demande, ouvrir WhatsApp avec le message prérempli, comme Koh Samui.
  ouvrirWhatsApp: true,
  // Délai minimal entre l'ouverture de la feuille et l'envoi (anti-robot, en millisecondes). Pas de Turnstile pour l'instant.
  delaiMinimalMs: 3000,
  // Message envoyé à Gestion : le format du site des excursions (docs/gestion/demandes-site.md), en anglais, pour que Gestion lise les âges et retrouve le tarif.
  formatGestion: "excursions",
  prefixeRef: "AON"
};

// Entrée du parc national, TOUJOURS en plus du prix, payée sur place en espèces, jamais dans l'estimation. Enfant de 3 à 14 ans, gratuit avant 3 ans.
// Barème officiel du parc (tarif étranger) : enfant de 3 à 14 ans, gratuit avant 3 ans. `approx` : la ligne du message à Gestion dit « about ».
const parc = (adulte, enfant) => ({ adulte, enfant, enfantMin: 3, enfantMax: 14, regle: "de 3 à 14 ans", approx: true, fixe: true });
const PARC_4_ISLANDS = parc(200, 100);
const PARC_HONG = parc(300, 150);
const PARC_PHI_PHI = parc(400, 200);

const NOTE_HOTEL = "Le transfert aller-retour est compris pour les hôtels du centre d’Ao Nang. Pour un autre hôtel, Anaïs confirme au cas par cas sur WhatsApp.";
const DEPARTS = [
  { id: "matin", label: "8h à 14h", heure: "08:00", en: "8am to 2pm" },
  { id: "apres-midi", label: "14h30 au coucher du soleil", heure: "14:30", en: "2:30pm to sunset" }
];
// Identifiants du contrat avec Gestion (docs/gestion/carnet-aonang-lanta.md) : un produit par niveau et par destination, option « standard ».
const NOMS = { "4-islands": "4 Islands", "hong": "Hong Islands", "phi-phi": "Phi Phi Islands" };
const gest = (niveau, niveauEn, cle, nom) => ({ gestionProduit: `aonang-${niveau}-${cle}`, gestionProduitNom: `${nom || NOMS[cle]} from Ao Nang, ${niveauEn} option`, gestionId: "standard", gestionTitre: `${niveauEn} option` });
const DESTINATIONS = (prix, niveau, niveauEn) => [
  { id: "4-islands", label: "4 Islands", prix: prix[0], parc: PARC_4_ISLANDS, ...gest(niveau, niveauEn, "4-islands") },
  { id: "hong-islands", label: "Hong Islands", prix: prix[1], parc: PARC_HONG, ...gest(niveau, niveauEn, "hong") },
  { id: "phi-phi", label: "Phi Phi Islands", prix: prix[2], parc: PARC_PHI_PHI, ...gest(niveau, niveauEn, "phi-phi") }
];
const LUNCH_BOX = { id: "lunch-box", label: "Lunch box au choix", prix: 80, unite: "personne", en: "Lunch box" };
const COMMUN_PRIVE = { type: "bateau", variantesLabel: "Destination", variantesCaption: "Prix par bateau selon la destination", creneauxLabel: "Heure de départ", creneauxLabelEn: "Departure", pickupLabel: "Hôtel ou lieu de prise en charge", notePickup: NOTE_HOTEL };

const offres = {
  "ao-nang-vip": {
    ...COMMUN_PRIVE,
    produit: "Ao Nang, long tail boat privé, option VIP",
    titre: "Option VIP",
    capacite: 4,
    variantes: DESTINATIONS([4100, 4600, 9600], "vip", "VIP"),
    creneaux: DEPARTS,
    extras: [LUNCH_BOX],
    faits: ["Long tail boat privé, de 1 à 4 personnes", "Départ à 8h ou à 14h30", "Transfert aller-retour compris pour les hôtels du centre d’Ao Nang"],
    inclus: ["Fruits de saison", "Eau", "Transfert aller-retour (hôtels du centre d’Ao Nang)", "Masque et tuba", "Gilets de sauvetage", "Assurance voyage"],
    nonInclus: ["Frais d’entrée au parc national", "Lunch (une lunch box à 80 THB par personne, ou votre propre pique-nique)"],
    gestion: { produit: "ao-nang-vip", produitNom: "Ao Nang private longtail, VIP option" }
  },
  "ao-nang-mini-luxury": {
    ...COMMUN_PRIVE,
    produit: "Ao Nang, long tail boat privé, option Mini Luxury",
    titre: "Option Mini Luxury",
    capacite: 4,
    variantes: DESTINATIONS([4600, 5400, 10600], "mini-luxury", "Mini Luxury"),
    creneaux: DEPARTS,
    extras: [LUNCH_BOX],
    faits: ["Long tail boat privé, de 1 à 4 personnes", "Départ à 8h ou à 14h30", "Transfert aller-retour compris pour les hôtels du centre d’Ao Nang"],
    inclus: ["Tout ce que comprend l’option VIP", "Soft drinks", "Jus d’orange", "Snack", "Paddle board"],
    nonInclus: ["Frais d’entrée au parc national", "Lunch (une lunch box à 80 THB par personne, ou votre propre pique-nique)"],
    gestion: { produit: "ao-nang-mini-luxury", produitNom: "Ao Nang private longtail, Mini Luxury option" }
  },
  "ao-nang-luxury": {
    ...COMMUN_PRIVE,
    produit: "Ao Nang, long tail boat privé, option Luxury",
    titre: "Option Luxury",
    capacite: 4,
    variantes: DESTINATIONS([5900, 6900, 11900], "luxury", "Luxury"),
    creneaux: DEPARTS,
    faits: ["Long tail boat privé, de 1 à 4 personnes", "Départ à 8h ou à 14h30", "Transfert aller-retour compris pour les hôtels du centre d’Ao Nang"],
    inclus: ["Tout ce que comprend l’option VIP", "Repas de midi sur un beau set de pique-nique", "Paddle board", "Personnel à bord"],
    nonInclus: ["Frais d’entrée au parc national"],
    gestion: { produit: "ao-nang-luxury", produitNom: "Ao Nang private longtail, Luxury option" }
  },
  "ao-nang-economique": {
    ...COMMUN_PRIVE,
    produit: "Ao Nang, bateau privé, option plus économique",
    titre: "Option plus économique",
    capacite: 6,
    variantes: [
      { id: "4-islands", label: "4 Islands, 8h à 14h", prix: 2900, parc: PARC_4_ISLANDS, heure: "08:00", detail: "Railay Beach, Separate Sea, Poda Island, Chicken Island", ...gest("economique", "Economy", "4-islands") },
      { id: "hong-island-lagoon", label: "Hong Island et lagon, 8h à 15h", prix: 3200, parc: PARC_HONG, heure: "08:00", detail: "Koh Hong Lagoon et point de vue à 360 degrés", ...gest("economique", "Economy", "hong-lagoon", "Hong Island and Lagoon") },
      { id: "hong-island-islands", label: "Hong Island et autres îles, 8h à 15h", prix: 3700, parc: PARC_HONG, heure: "08:00", detail: "Koh Hong Lagoon, point de vue à 360 degrés, Koh Pak Bia et Koh Lao Lading", ...gest("economique", "Economy", "hong-autres-iles", "Hong Island and other islands (Koh Pak Bia, Koh Lao Lading)") }
    ],
    extras: [
      LUNCH_BOX,
      { id: "vip-set", label: "« VIP Set » : coussins, snacks et une boisson", prix: 1000, unite: "bateau", en: "VIP Set" }
    ],
    faits: ["Bateau privé, de 1 à 6 personnes", "Départ à 8h", "Transfert aller-retour à votre hôtel"],
    inclus: ["Eau", "Fruits", "Équipement de snorkeling", "Gilets de sauvetage", "Assurance bateau", "Transfert aller-retour à votre hôtel"],
    nonInclus: ["Frais d’entrée au parc national", "Lunch (une lunch box à 80 THB par personne)"],
    gestion: { produit: "ao-nang-economique", produitNom: "Ao Nang private boat, budget option" }
  },
  "ao-nang-luxe": {
    ...COMMUN_PRIVE,
    produit: "Ao Nang, bateau privé de luxe",
    titre: "Bateau de luxe",
    capacite: 6,
    variantes: [
      { id: "hong-islands", label: "Hong Islands, 6 h", prix: 8900, parc: PARC_HONG, heure: "07:30", detail: "Koh Hong Beach, point de vue à 360 degrés, Koh Lading, lagon de Hong, île de Pak Bia", ...gest("prestige", "Prestige", "hong") },
      { id: "4-islands", label: "4 Islands, 6 h", prix: 6900, parc: PARC_4_ISLANDS, heure: "07:30", detail: "Railay Beach, Separate Sea, Poda Island, Chicken Island", ...gest("prestige", "Prestige", "4-islands") },
      { id: "phi-phi", label: "Phi Phi, 7h30 à 16h", prix: 13900, parc: PARC_PHI_PHI, heure: "07:30", detail: "Bamboo Island, Phi Phi Don, Viking Cave, Maya Bay, Monkey Bay, Loh Samah Bay, Pi Leh Lagoon", ...gest("prestige", "Prestige", "phi-phi") }
    ],
    faits: ["Bateau de luxe privé, de 1 à 6 personnes", "Départ à 7h30", "Transfert aller-retour à votre hôtel"],
    inclus: ["Eau", "Glacière et glace", "Fruits", "Jus de fruits", "Soft drinks", "Eau de coco", "Snacks et nappe de pique-nique", "Enceintes Bluetooth", "Personnel sur le bateau", "Équipement de snorkeling", "Appareils photo sous-marins et GoPro", "Gilets de sauvetage", "Palmes", "Serviettes", "Assurance bateau", "Assurance touristique", "Transfert aller-retour à votre hôtel"],
    nonInclus: ["Frais d’entrée au parc national"],
    note: "Le personnel s’occupe des photos et des vidéos et vous les envoie à la fin.",
    gestion: { produit: "ao-nang-luxe", produitNom: "Ao Nang private luxury boat" }
  }
};

const guide = {
  paragraphes: [
    "Des tours en long tail boat privé depuis Ao Nang, avec plusieurs niveaux de confort selon votre budget. Départ de 8h à 14h ou de 14h30 au coucher du soleil."
  ],
  sections: [
    {
      id: "tours-prives",
      num: 1,
      titre: "Les tours privés",
      photos: [
        { src: "/images/carnet-ao-nang-bateau-interieur.jpg", alt: "Intérieur d’un bateau privé, bancs blancs et rideaux" },
        { src: "/images/carnet-ao-nang-fruits.jpg", alt: "Plateau de fruits découpés tenu à la main au-dessus du sable, au bord d’une eau peu profonde" },
      ],
      notePrix: "Réservez suffisamment à l’avance : en haute saison, les prix peuvent varier selon les demandes.",
      optionsTitre: "Les options",
      blocs: [
        {
          titre: "Avant de réserver",
          liste: [
            "Le transfert aller-retour est compris pour les hôtels du centre d’Ao Nang. Pour un hôtel plus loin, je confirme au cas par cas sur WhatsApp.",
            "Le prix est celui d’un bateau, de 1 à 4 personnes sur les options VIP, Mini Luxury et Luxury, de 1 à 6 sur les autres. Pour un groupe plus grand, il faut plusieurs bateaux : je vous réponds sur WhatsApp.",
            "Le droit d’entrée du parc national est fixé par le parc : il se règle sur place en espèces et n’est jamais dans le prix."
          ]
        }
      ],
      groupes: [
        { id: "an-vip", titre: "Option VIP", note: "(la moins chère des trois niveaux)", texte: "Long tail boat privé, de 1 à 4 personnes.", offres: ["ao-nang-vip"] },
        { id: "an-mini", titre: "Option Mini Luxury", texte: "L’option VIP avec en plus des soft drinks, du jus d’orange, un snack et un paddle board.", offres: ["ao-nang-mini-luxury"] },
        { id: "an-luxury", titre: "Option Luxury", texte: "L’option VIP avec en plus un repas de midi sur un beau set de pique-nique, un paddle board et du personnel à bord.", offres: ["ao-nang-luxury"] },
        { id: "an-eco", titre: "Une option plus économique", note: "(privé, de 1 à 6 personnes)", texte: "Un bateau privé pour un budget plus serré. Pour 1 000 THB de plus, vous pouvez ajouter le « VIP Set » avec coussins, snacks et une boisson.", offres: ["ao-nang-economique"] },
        { id: "an-luxe", titre: "Une option encore plus luxueuse", note: "(bateaux de luxe, de 1 à 6 personnes)", texte: "Toujours en long tail boat, mais en version plus luxueuse selon votre budget.", offres: ["ao-nang-luxe"] }
      ]
    },
    {
      id: "francais",
      num: 2,
      titre: "En français",
      blocs: [
        {
          paragraphes: [
            "Il existe une agence française qui propose des excursions en groupe pas trop chères (lunch non inclus).",
            "Une autre agence, un peu plus chère, propose aussi des tours en français (privé ou groupe).",
            "Contactez-moi pour les coordonnées."
          ]
        }
      ]
    }
  ]
};

module.exports = construire({ guide, reglages, offres });
