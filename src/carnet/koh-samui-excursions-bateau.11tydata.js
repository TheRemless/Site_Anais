// Données du guide « Les excursions en bateau à Koh Samui ».
// Le HTML (_includes/carnet-guide.njk) et la feuille de réservation (js/carnet-booking.js) lisent tous deux ce fichier :
// pour un autre guide du même style, copier ce fichier, changer les textes, les offres et les réglages.
//
// Règle de publication : rien de ce qui est ici n'est affiché tel quel. Seuls `guide` (le texte et les offres) et `carnetConfig`
// (ce que le navigateur reçoit pour calculer l'estimation) partent dans la page. Aucun nom de prestataire, aucune donnée de rémunération,
// aucun lien vers les documents d'un partenaire : ces informations restent dans Gestion.

const P = "/images/carnet-koh-samui-";
const MAPS = {
  angThong: "https://maps.app.goo.gl/XuUoeHM4gZWJhaS4A",
  pigIsland: "https://maps.app.goo.gl/wBUjjc7WoTnB51zb6",
  kohMadsum: "https://maps.app.goo.gl/anvNxGoBe9YG5FhV6",
  kohRap: "https://maps.app.goo.gl/BLXLRVwVgemphTn77"
  // Koh Tan : pas d'épingle vérifiée, aucun lien plutôt qu'un faux.
};
const VIDEO_ANG_THONG = "https://youtu.be/-47MiQZv8_4";

// Réglages à changer sans toucher au reste.
const reglages = {
  // Après l'envoi de la demande, ouvrir WhatsApp avec le message prérempli (comme le site des excursions). Jérémy n'a pas encore tranché.
  ouvrirWhatsApp: true,
  // Délai minimal entre l'ouverture de la feuille et l'envoi (anti-robot, en millisecondes). Pas de Turnstile pour l'instant.
  delaiMinimalMs: 3000,
  // Fermeture ANNUELLE du parc d'Ang Thong (mousson) : du 1er novembre au 15 décembre inclus, chaque année. UNE SEULE définition ici.
  // Une date de n'importe quelle année dans cette fenêtre est refusée pour les offres Ang Thong ; Pig Island, Koh Tan et Koh Rap ne sont pas concernés.
  // Jérémy a confirmé l'année 2026 (22.11.2026) : le message de cette année dit « jusqu'au 15 décembre 2026 ». Les années suivantes sont à reconfirmer
  // chaque saison avec Nani (anneeConfirmee à mettre à jour). fermetureAngThong: null supprime blocage et messages.
  fermetureAngThong: { debut: "11-01", fin: "12-15", libelleDebut: "1er novembre", libelleFin: "15 décembre", anneeConfirmee: 2026 },
  // Les deux speedboats privés de Pig Island viennent des documents du partenaire, pas du guide d'Anaïs. false : ils disparaissent.
  afficherSpeedboatsPigIsland: true,
  // Préfixe de la référence de la demande (SAM-7K3Q).
  prefixeRef: "SAM"
};

// Messages de la fermeture, calculés depuis la règle ci-dessus.
if (reglages.fermetureAngThong) {
  const f = reglages.fermetureAngThong;
  f.message = "Le parc national est fermé du " + f.libelleDebut + " au " + f.libelleFin + ".";
  f.messageAnnee = "Le parc national est fermé jusqu’au " + f.libelleFin + " " + f.anneeConfirmee + ".";
}

// Transfert depuis l'hôtel (prix par van, aller-retour). Indicatif, à confirmer par Anaïs.
const transfert = { prix: 1500, unite: "par van" };


// Entrée du parc national d'Ang Thong (tarif étranger, mai 2026, site officiel des parcs nationaux) : toujours EN PLUS du prix, à payer sur place
// en espèces, jamais dans l'estimation. Enfant au tarif du parc : 3 à 14 ans ET moins de 1,40 m ; gratuit avant 3 ans.
// Ce seuil est indépendant de l'âge « enfant » de l'excursion : un enfant de 12 ans paie l'excursion au tarif adulte et le parc au tarif enfant.
// Le document du partenaire dit « plus de 130 cm = adulte » : contradiction avec le 1,40 m officiel, la règle officielle est affichée.
const PARC = { adulte: 300, enfant: 150, enfantMin: 3, enfantMax: 14, regle: "de 3 à 14 ans et de moins de 1,40 m" };
const droitPig = "Entrée de Pig Island (Koh Madsum) : 50 THB par personne";
const droitRap = "Entrée de Koh Rap : 50 THB par personne";

const offres = {
  "ang-thong-big-boat": {
    produit: "Ang Thong en big boat, journée en groupe",
    titre: "Big boat",
    meta: "~80 personnes",
    texte: "plus lent mais plus confortable et économique",
    type: "personne",
    angThong: true,
    faits: ["Journée complète", "Prise en charge à l’hôtel à 07:30, retour à l’hôtel vers 17:00"],
    variantes: [
      { id: "avec-kayak", label: "Avec kayak", adulte: 1850, enfant: 1000 },
      { id: "sans-kayak", label: "Sans kayak", adulte: 1300, enfant: 700 }
    ],
    enfant: { min: 4, max: 11, regle: "Enfant de 4 à 11 ans" },
    pickupLabel: "Hôtel (prise en charge et retour)",
    inclus: ["Transfert (hôtel vers le pier à 07:30, retour à l’hôtel vers 17:00)", "Petit déjeuner léger", "Déjeuner buffet à bord", "Eau potable", "Masque de snorkeling", "Gilet de sauvetage", "Kayak (formule avec kayak)", "Guide", "Assurance"],
    parc: PARC,
    avis: ["Femmes enceintes non admises à bord."],
    programme: [
      ["07:30", "Prise en charge à l’hôtel, direction le pier"],
      ["08:30", "Départ de Samui, petit déjeuner léger à bord"],
      ["09:50", "Île Wua Ta Lap : montée au point de vue (environ 500 m) sur les 42 îles, ou grotte Lotus, puis baignade ou snorkeling"],
      ["12:30", "Déjeuner buffet à bord"],
      ["13:30", "Île Mae Koh : kayak, visite de Talay Nai (lac émeraude)"],
      ["15:30", "Départ vers Samui"],
      ["17:00", "Transfert retour à l’hôtel"]
    ],
    note: "Programme sujet à changement selon la météo et l’état de la mer."
  },
  "ang-thong-speedboat-groupe": {
    produit: "Ang Thong en speedboat, journée en groupe",
    titre: "Speedboat",
    meta: "~40 personnes",
    texte: "plus rapide, mais moins confortable",
    type: "personne",
    angThong: true,
    faits: ["Journée complète", "Prise en charge à l’hôtel à 07:30, retour à l’hôtel vers 17:00"],
    adulte: 2200,
    enfant: { min: 4, max: 10, prix: 1700, regle: "Enfant de 4 à 10 ans, 120 cm au plus" },
    pickupLabel: "Hôtel (prise en charge et retour)",
    inclus: ["Transfert", "Petit déjeuner léger", "Déjeuner buffet", "Eau potable", "Masque de snorkeling", "Gilet de sauvetage", "Kayak", "Guide", "Assurance"],
    parc: PARC,
    avis: ["Femmes enceintes non admises à bord."],
    programme: [
      ["07:30", "Prise en charge à l’hôtel, direction le pier, petit déjeuner léger"],
      ["09:00", "Départ de Samui"],
      ["10:00", "Snorkeling à Wao Island, environ 45 min"],
      ["11:00", "Tour du parc en bateau, 20 min"],
      ["11:30", "Île Mae Koh (Talay Nai), lac"],
      ["12:15", "Déjeuner buffet et kayak"],
      ["14:00", "Montée au point de vue à 500 m, île Wua Ta Lap"],
      ["16:00", "Départ vers Samui"],
      ["17:00", "Transfert retour à l’hôtel"]
    ],
    note: "Programme sujet à changement selon la météo et l’état de la mer."
  },
  "ang-thong-petit-groupe-speedboat": {
    produit: "Ang Thong en petit groupe, speedboat",
    meta: "~20 personnes",
    texte: "plus “privée” avec guide/agence francophone",
    texteSuite: "Meilleure organisation, moins de monde car ils évitent les zones/horaires touristiques, transfert et bon lunch inclus",
    parc: PARC,
    type: "personne",
    angThong: true,
    faits: ["Tous les jours, de 08:30 à 16:00 environ", "Prise en charge et dépose à l’hôtel"],
    adulte: 4400,
    adulteRegle: "Adulte, dès 10 ans",
    enfant: { min: 3, max: 9, prix: 2700, regle: "Enfant de 3 à 9 ans" },
    bebe: { max: 2, regle: "Bébé de moins de 3 ans" },
    pickupLabel: "Hôtel (prise en charge et dépose)",
    inclus: ["Transport aller-retour, prise en charge et dépose à l’hôtel", "Assurance", "Guide anglais ou français", "Boissons sans alcool à volonté", "Déjeuner dans un restaurant thaï traditionnel, sur une île de pêcheurs", "Matériel de snorkeling", "Plateau de fruits"],
    nonInclus: ["Boissons alcoolisées", "Serviettes de plage", "Crème solaire"],
    creneaux: [{ id: "journee", label: "Journée, 08:30 à 16:00", heure: "08:30" }]
  },
  "ang-thong-speedboat-prive": {
    produit: "Ang Thong en speedboat privé, journée",
    titre: "Speedboat privé",
    meta: "max 9 personnes",
    texte: "plusieurs horaires disponibles",
    texteSuite: "plus gros budget car il faut aussi rajouter le repas, transferts, entrée au parc,…",
    type: "bateau",
    angThong: true,
    faits: ["Journée complète, 8 h", "Boisson sans alcool et fruits inclus"],
    paliers: [{ min: 1, max: 9, prix: 20000 }],
    capacite: 9,
    transfert,
    pickupLabel: "Hôtel ou lieu de prise en charge",
    inclus: ["Boisson sans alcool", "Fruits", "Assurance", "Matériel de snorkeling", "Gilet de sauvetage"],
    nonInclus: ["Repas", "Kayak de mer", "Matériel de pêche sur demande", "Transfert aller-retour depuis l’hôtel : 1 500 THB par van"],
    parc: PARC,
    creneaux: [{ id: "journee", label: "Journée, 09:00 à 17:00", heure: "09:00" }]
  },
  "pig-island-longtail-prive-4h": {
    produit: "Pig Island et Koh Tan en longtail privé, 4 h",
    titre: "durant 4h",
    meta: "max 12 personnes",
    type: "bateau",
    faits: ["Demi-journée, 4 h", "Pig Island (Koh Madsum) et Koh Tan"],
    paliers: [
      { min: 1, max: 3, prix: 3500 },
      { min: 4, max: 5, prix: 4500 },
      { min: 6, max: 7, prix: 5500 },
      { min: 8, max: 10, prix: 6500 },
      { min: 11, max: 12, prix: 7500 }
    ],
    capacite: 12,
    transfert,
    pickupLabel: "Hôtel ou lieu de prise en charge",
    inclus: ["Matériel de snorkeling", "Gilet de sauvetage", "Assurance"],
    nonInclus: ["Repas (restaurant sur place ou pique-nique)", "Transfert depuis l’hôtel : 1 500 THB par van"],
    surPlace: [droitPig],
    creneaux: [
      { id: "matin", label: "Matin, 09:00 à 13:00", heure: "09:00" },
      { id: "apres-midi", label: "Après-midi, 14:00 à 18:00", heure: "14:00" }
    ]
  },
  "pig-island-longtail-prive-5h": {
    produit: "Pig Island, Koh Tan et Koh Rap en longtail privé, 5 h",
    titre: "durant 5h",
    titreMeta: "(avec Koh Rap en plus)",
    meta: "max 12 personnes",
    type: "bateau",
    faits: ["Demi-journée, 5 h", "Pig Island (Koh Madsum), Koh Tan et Koh Rap"],
    paliers: [
      { min: 1, max: 3, prix: 5000 },
      { min: 4, max: 5, prix: 5500 },
      { min: 6, max: 8, prix: 6500 },
      { min: 9, max: 10, prix: 7500 },
      { min: 11, max: 12, prix: 8500 }
    ],
    capacite: 12,
    transfert,
    pickupLabel: "Hôtel ou lieu de prise en charge",
    inclus: ["Matériel de snorkeling", "Gilet de sauvetage", "Assurance"],
    nonInclus: ["Repas (restaurant sur place ou pique-nique)", "Transfert depuis l’hôtel : 1 500 THB par van"],
    surPlace: [droitPig, droitRap],
    creneaux: [
      { id: "matin", label: "Matin, 08:00 à 13:00", heure: "08:00" },
      { id: "apres-midi", label: "Après-midi, 14:00 à 19:00", heure: "14:00" }
    ]
  },
  "pig-island-speedboat-prive-4h": {
    produit: "Pig Island en speedboat privé, 4 h",
    titre: "durant 4h",
    meta: "max 9 personnes",
    isole: true,
    type: "bateau",
    faits: ["Demi-journée, 4 h", "Koh Tan et Pig Island"],
    paliers: [{ min: 1, max: 9, prix: 11500 }],
    capacite: 9,
    transfert,
    pickupLabel: "Hôtel ou lieu de prise en charge",
    inclus: ["Boisson sans alcool", "Assurance", "Matériel de snorkeling", "Gilet de sauvetage"],
    nonInclus: ["Repas", "Kayak de mer", "Matériel de pêche sur demande", "Transfert depuis l’hôtel : 1 500 THB par van"],
    surPlace: [droitPig],
    creneaux: [
      { id: "matin", label: "Matin, 09:00 à 13:00", heure: "09:00" },
      { id: "apres-midi", label: "Après-midi, 14:00 à 18:00", heure: "14:00" }
    ]
  },
  "pig-island-speedboat-prive-5h": {
    produit: "Pig Island en speedboat privé, 5 h",
    titre: "durant 5h",
    titreMeta: "(avec Koh Rap en plus)",
    meta: "max 9 personnes",
    isole: true,
    type: "bateau",
    faits: ["Demi-journée, 5 h", "Koh Tan, Pig Island et Koh Rap"],
    paliers: [{ min: 1, max: 9, prix: 13500 }],
    capacite: 9,
    transfert,
    pickupLabel: "Hôtel ou lieu de prise en charge",
    inclus: ["Boisson sans alcool", "Assurance", "Matériel de snorkeling", "Gilet de sauvetage"],
    nonInclus: ["Repas", "Kayak de mer", "Matériel de pêche sur demande", "Transfert depuis l’hôtel : 1 500 THB par van"],
    surPlace: [droitPig, droitRap],
    creneaux: [
      { id: "matin", label: "Matin, 08:00 à 13:00", heure: "08:00" },
      { id: "apres-midi", label: "Après-midi, 13:30 à 18:30", heure: "13:30" }
    ]
  },
  "pig-island-groupe": {
    produit: "Pig Island et Koh Tan en groupe, big boat",
    texte: "En big boat avec repas léger à bord et transferts inclus",
    type: "personne",
    faits: ["Demi-journée, 4 h", "Départs le mardi, le jeudi, le samedi et le dimanche"],
    jours: [2, 4, 6, 0],
    joursTexte: "le mardi, le jeudi, le samedi et le dimanche",
    adulte: 1500,
    enfant: { min: 4, max: 10, prix: 1000, regle: "Enfant de 4 à 10 ans" },
    pickupLabel: "Hôtel",
    inclus: ["Repas léger à bord"],
    surPlace: [droitPig],
    creneaux: [
      { id: "matin", label: "Matin, départ 09:00, retour 13:30", heure: "09:00" },
      { id: "apres-midi", label: "Après-midi, départ 14:00, retour 18:00", heure: "14:00" }
    ]
  }
};

const guide = {
  intro: [
    "Depuis Koh Samui, il existe plusieurs excursions en bateau différentes.",
    "Le choix dépend surtout de votre budget, du confort recherché et votre façon de voyager (famille, couple, etc.):"
  ],
  resume: [
    { titre: "Parc national d’Ang Thong", texte: "paysages spectaculaires, journée complète, pas mal de randonnées assez escarpées (facultatives) pour aller voir les points de vue (qui sont la clef de cette excursion)" },
    { titre: "Pig Island (Koh Madsum) & Koh Tan", texte: "plus ludique, parfait avec des enfants, île paradisiaque, demi-journée en général, activité plus calme" }
  ],
  modes: [
    { titre: "Groupe", texte: "moins cher mais plus de monde, planning prédéfini, tout inclus, petits ou très grands groupes selon le budget mis" },
    { titre: "Privé", texte: "un peu plus cher mais plus de confort, de flexibilité, et une expérience plus exclusive, en général ce sont des long tail boat", italique: "(à moins d’avoir un très gros budget)" }
  ],
  sections: [
    {
      id: "ang-thong",
      num: 1,
      titre: "Parc National d’Ang Thong",
      intro: "Archipel de 42 îles avec plages, snorkeling et points de vue incroyables.",
      liens: [
        { label: "Voir sur la carte", url: MAPS.angThong, nom: "Ang Thong" },
        { label: "Voir la vidéo", url: VIDEO_ANG_THONG, nom: "Ang Thong" }
      ],
      photos: [
        { src: P + "ang-thong-lagune.jpg", alt: "Eau claire entre deux parois calcaires, deux baigneurs au loin" },
        { src: P + "ang-thong-big-boat.jpg", alt: "Rocher de l’archipel vu depuis le pont d’un bateau, bancs orange au premier plan" },
        { src: P + "ang-thong-grotte.jpg", alt: "Falaise calcaire avec une grotte au ras de l’eau turquoise" },
        { src: P + "ang-thong-plage.jpg", alt: "Plage de sable clair entre deux pointes rocheuses" }
      ],
      groupes: [
        { id: "at-groupe", titre: "En groupe", note: "(classique, tout inclus sauf entrées dans les parcs nationaux)", offres: ["ang-thong-big-boat", "ang-thong-speedboat-groupe"] },
        { id: "at-petit", titre: "En petit groupe (speedboat)", offres: ["ang-thong-petit-groupe-speedboat"] },
        { id: "at-prive", titre: "En speedboat privé (haut de gamme)", offres: ["ang-thong-speedboat-prive"] }
      ],
      conseils: [
        "à faire plutôt pour les points de vue, les paysages et la beauté du parc national",
        "prévoir des baskets, de l’eau et un sac à dos si vous voulez faire les points de vue",
        "excursion assez longue, peut être fatiguant pour les enfants, mais c’est mon coup de cœur! → départ tôt, retour fin de journée"
      ]
    },
    {
      id: "pig-island",
      num: 2,
      titre: "Pig Island & Koh Tan (+ Koh Rap)",
      intro: "Excursion plus courte, plus détente et appréciée des familles (surtout des enfants!)",
      photos: [
        { src: P + "pig-island-cochons.jpg", alt: "Cochons sur le sable, à l’ombre d’un arbre" },
        { src: P + "pig-island-panneau.jpg", alt: "Panneau de la plage de Koh Madsum avec un cochon dessous" },
        { src: P + "koh-tan-cote.jpg", alt: "Côte boisée et eau turquoise vues du bateau" },
        { src: P + "koh-tan-ponton.jpg", alt: "Ponton en bois avec transats au-dessus d’un lagon turquoise" },
        { src: P + "koh-rap-kayaks.jpg", alt: "Banc de sable avec des kayaks alignés, speedboats et îles au fond" },
        { src: P + "koh-rap-longtail.jpg", alt: "Bateau longtail amarré dans une eau turquoise au bord de la plage" }
      ],
      iles: {
        titre: "Les îles visitées durant l’excursion",
        liste: [
          { nom: "Koh Madsum", texte: "plage paradisiaque, cochons en liberté et restaurant", prix: 50, unite: "/pers", carte: MAPS.kohMadsum },
          { nom: "Koh Tan", texte: "arrêt pour faire du snorkeling" },
          { avant: "(optionnel)", nom: "Koh Rap", texte: "plus sauvage, un peu plus loin donc moins de monde, aussi quelques cochons sur la plage, pas grand chose, juste pour se reposer", prix: 50, unite: "/pers", carte: MAPS.kohRap }
        ]
      },
      groupes: [
        {
          id: "pi-longtail",
          titre: "Longtail privé",
          note: "(matin ou après-midi)",
          texte: "Bateau privé avec capitaine local, sans repas (restaurant sur place ou pique-nique à emporter), entrée sur les îles et transferts non inclus",
          texteItalique: "(je peux vous les réserver)",
          offres: ["pig-island-longtail-prive-4h", "pig-island-longtail-prive-5h"]
        },
        { id: "pi-speedboat", titre: "Speedboat privé", offres: ["pig-island-speedboat-prive-4h", "pig-island-speedboat-prive-5h"], isole: true },
        { id: "pi-groupe", titre: "En groupe", offres: ["pig-island-groupe"] }
      ],
      conseils: [
        "prévoir du cash pour le restaurant et le paiement de l’entrée sur les îles",
        "prévoir des chaussures d’eau pour ne pas se couper avec le corail",
        "privilégier le matin pour des meilleures conditions météo",
        "recommandé à faire avec des enfants car c’est une excursion facile (pas de marche), pas trop longue (demi-journée) et les enfants adorent partir à la rencontre des cochons et profiter de l’eau turquoise"
      ],
      conseilsItalique: { index: 0, texte: "(50 THB/pers)" }
    }
  ]
};

module.exports = {
  guide,
  reglages,
  eleventyComputed: {
    // Ce que le navigateur reçoit : les offres réservables et les réglages, rien d'autre.
    carnetConfig: (data) => {
      const garder = ["parc", "produit", "titre", "titreMeta", "type", "angThong", "variantes", "adulte", "adulteRegle", "enfant", "bebe", "paliers", "capacite", "creneaux", "jours", "joursTexte", "transfert", "pickupLabel"];
      const publiques = {};
      for (const [id, o] of Object.entries(offres)) {
        if (o.isole && !reglages.afficherSpeedboatsPigIsland) continue;
        publiques[id] = { id, droits: !!(o.surPlace && o.surPlace.length) };
        for (const k of garder) if (o[k] !== undefined) publiques[id][k] = o[k];
      }
      const numero = String((data.business && data.business.telephone) || "").replace(/\D/g, "");
      return {
        whatsapp: numero,
        reglages: {
          ouvrirWhatsApp: reglages.ouvrirWhatsApp,
          delaiMinimalMs: reglages.delaiMinimalMs,
          fermetureAngThong: reglages.fermetureAngThong,
          prefixeRef: reglages.prefixeRef
        },
        offres: publiques
      };
    },
    // Les offres affichables dans la page, dans l'ordre des groupes.
    offres: () => {
      const out = {};
      for (const [id, o] of Object.entries(offres)) {
        if (o.isole && !reglages.afficherSpeedboatsPigIsland) continue;
        out[id] = { id, ...o };
      }
      return out;
    }
  }
};
