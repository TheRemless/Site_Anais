// Données du guide « Les excursions et activités à Koh Lanta » : les sorties en bateau et les activités du site des excursions de Koh Lanta,
// réservables depuis la page. Les identifiants envoyés à Gestion (produit et option) sont ceux de ce site (src/gestion/js/site-produits.mjs) :
// `gestion: { produit, produitNom, option, optionTitre }` en dit le nom anglais, que le message de la demande reprend tel quel.
// Prix de vente en THB. Aucun nom de prestataire ici ni dans la page.
const { construire } = require("./guide-commun.js");

const reglages = {
  ouvrirWhatsApp: true,
  delaiMinimalMs: 3000,
  formatGestion: "excursions",
  prefixeRef: "LAN"
};

const PARC_4_ISLANDS = { adulte: 200, enfant: 100, enfantMin: 4, enfantMax: 11, regle: "de 4 à 11 ans", fixe: true };
const PARC_GRAND = { adulte: 400, enfant: 200, enfantMin: 4, enfantMax: 11, regle: "de 4 à 11 ans", fixe: true };
// Phi Phi : le site publie 400 et 200 THB sans âge ni gratuité : aucun âge présumé, tout enfant au tarif enfant (« about » dans le message).
const PARC_PHI_PHI = { adulte: 400, enfant: 200, approx: true, fixe: true };
// Koh Rok : de la mi-octobre à la mi-mai (site). Les dates hors saison sont refusées, comme la fermeture d'Ang Thong à Koh Samui.
const SAISON_KOH_ROK = { debut: "05-16", fin: "10-14", message: "Cette sortie a lieu de la mi-octobre à la mi-mai." };

const HAUTE_SAISON = "Réservez suffisamment à l’avance : en haute saison, les prix peuvent varier selon les demandes.";
const PICKUP = "Hôtel ou lieu de prise en charge";
const L = { lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6 };

const enfant = (min, max, prix) => ({ min, max, prix, regle: `Enfant de ${min} à ${max} ans` });
const bebe = (max) => ({ max, regle: `Enfant de moins de ${max + 1} ans` });
const g = (produit, produitNom, option, optionTitre) => ({ produit, produitNom, option, optionTitre });
const pers = (adulte, e, b) => ({ type: "personne", adulte, ...(e ? { enfant: e } : {}), ...(b ? { bebe: b } : {}) });
// seuilGroupe : un enfant de moins de 4 ans ne compte pas dans le groupe qui fixe la tranche (comme chez Gestion).
const tiers = (liste, capacite) => ({ type: "bateau", paliers: liste.map(([min, max, prix]) => ({ min, max, prix })), capacite, seuilGroupe: 4 });
const radeau = (base, adulte, e) => ({ type: "radeau", base: { max: 2, prix: base }, supplement: { adulte, enfant: e } });
const demande = { type: "surDemande" };
const matinApresMidi = (label = "Horaire") => ({ id: "slot", label, en: "Time", valeurs: [
  { id: "morning", label: "Matin, de 9h30 à 12h30", en: "Morning, 09:30–12:30", heure: "09:30" },
  { id: "afternoon", label: "Après-midi, de 14h à 17h", en: "Afternoon, 14:00–17:00", heure: "14:00" }
] });

const VILLAGE = "Droit d’entrée en plus : 40 THB par adulte et 20 THB par enfant de 4 à 11 ans, à payer sur place.";
const TRANSFERT_VIEILLE_VILLE = "Transfert aller-retour depuis votre hôtel jusqu’à l’embarcadère de la vieille ville de Koh Lanta";

const offres = {
  // ---------- 4 Islands ----------
  "4-islands--join-in-longtail": {
    produit: "4 Islands, longtail partagé", titre: "En longtail partagé", ...pers(1000, enfant(4, 11, 600), bebe(3)), parc: PARC_4_ISLANDS, pickupLabel: PICKUP,
    faits: ["Journée complète", "Prise en charge à l’hôtel entre 7h45 et 8h30, départ du bateau à 9h", "Koh Chuek, Koh Mook (grotte d’Émeraude), Koh Ngai et Koh Ma"],
    programme: [["8h00", "Prise en charge à votre hôtel et transfert vers l’embarcadère de Lanta Old Town"], ["9h10", "Départ vers Koh Chuek pour une première session de snorkeling (45 min)"], ["10h45", "Koh Mook et traversée de la grotte d’Émeraude"], ["12h00", "Déjeuner buffet thaïlandais sur la plage de Koh Ngai, puis temps libre"], ["13h45", "Snorkeling à Koh Ma (30 min)"], ["14h30", "Retour au port et transfert à votre hôtel"]],
    inclus: ["Équipement de snorkeling", "Déjeuner buffet thaïlandais sur la plage", TRANSFERT_VIEILLE_VILLE, "Guide local expérimenté", "Eau potable", "Fruits de saison", "Assurance accident"],
    note: "Les itinéraires sont indicatifs : ils peuvent changer selon la météo, l’état de la mer et la fréquentation des sites.",
    gestion: g("4-islands", "4 Islands", "join-in-longtail", "Join-in longtail")
  },
  "4-islands--join-in-speedboat": {
    produit: "4 Islands, speedboat partagé", titre: "En speedboat partagé", ...pers(2000, enfant(4, 11, 1000), bebe(3)), parc: PARC_4_ISLANDS, pickupLabel: PICKUP,
    faits: ["Journée complète", "Prise en charge à l’hôtel entre 7h45 et 8h30", "Koh Chuek, Koh Mook (grotte d’Émeraude), Koh Kradan et Koh Ngai"],
    inclus: ["Transfert aller-retour depuis votre hôtel", "Petit déjeuner léger au ponton", "Déjeuner buffet sur la plage de Koh Kradan", "Masque, tuba et gilet de sauvetage", "Guide local qui parle anglais", "Assurance"],
    gestion: g("4-islands", "4 Islands", "join-in-speedboat", "Join-in speedboat")
  },
  "4-islands--private-longtail": {
    produit: "4 Islands, longtail privé", titre: "En longtail privé", ...tiers([[1, 2, 5900], [3, 4, 6400], [5, 6, 7400]], 6), parc: PARC_4_ISLANDS, pickupLabel: PICKUP,
    extras: [{ id: "koh-kradan", label: "Ajouter Koh Kradan à la journée", prix: 700, unite: "bateau", en: "Add Koh Kradan" }],
    faits: ["Bateau, capitaine et itinéraire rien que pour votre groupe", "De 8h à 15h ou 16h environ, avec des horaires plus libres", "Koh Mook (grotte d’Émeraude), Koh Ngai, Koh Chuek et Koh Ma"],
    inclus: ["Long tail boat 100 % privé", "Capitaine", TRANSFERT_VIEILLE_VILLE, "Petit buffet thaïlandais sur la plage", "Fruits de saison", "Eau potable", "Masques et équipement de snorkeling", "Assurance accident"],
    gestion: g("4-islands", "4 Islands", "private-longtail", "Private longtail")
  },
  "4-islands--private-speedboat": {
    produit: "4 Islands, speedboat privé", titre: "En speedboat privé", ...demande, parc: PARC_4_ISLANDS, pickupLabel: PICKUP,
    faits: ["Journée à composer selon vos envies"],
    gestion: g("4-islands", "4 Islands", "private-speedboat", "Private speedboat")
  },
  // ---------- Koh Rok et Koh Haa ----------
  "koh-rok-koh-haa--join-in-speedboat": {
    produit: "Koh Rok et Koh Haa, journée en speedboat partagé", titre: "Journée en speedboat partagé", ...pers(2000, enfant(4, 11, 1000), bebe(3)), parc: PARC_GRAND, fermeture: SAISON_KOH_ROK, pickupLabel: PICKUP,
    faits: ["Journée complète", "Prise en charge à l’hôtel vers 8h", "Koh Rok Nok, Koh Rok Nai et Koh Haa"],
    inclus: ["Transfert aller-retour depuis votre hôtel", "Déjeuner buffet thaïlandais sur la plage", "Boissons et fruits de saison", "Petit déjeuner léger au ponton", "Masque, tuba et gilet de sauvetage", "Guide qui parle anglais", "Assurance"],
    gestion: g("koh-rok-koh-haa", "Koh Rok & Koh Haa", "join-in-speedboat", "Day trip")
  },
  "koh-rok-koh-haa--sunset": {
    produit: "Koh Rok et Koh Haa, sortie jusqu’au coucher du soleil", titre: "Sortie jusqu’au coucher du soleil", ...pers(2900, enfant(4, 11, 1900)), parc: PARC_GRAND, fermeture: SAISON_KOH_ROK, pickupLabel: PICKUP,
    faits: ["Retour au coucher du soleil", "Koh Rok et Koh Haa"],
    inclus: ["Prise en charge et retour en voiture", "Snacks sur le bateau", "Déjeuner buffet thaïlandais sur la plage de Koh Rok", "Boissons sur le bateau au retour"],
    gestion: g("koh-rok-koh-haa", "Koh Rok & Koh Haa", "sunset", "Sunset trip")
  },
  "koh-rok-koh-haa--private-longtail": {
    produit: "Koh Rok et Koh Haa, longtail privé", titre: "En longtail privé", ...tiers([[1, 3, 7400], [4, 6, 7900], [7, 8, 8400], [9, 10, 9400]], 10), parc: PARC_GRAND, fermeture: SAISON_KOH_ROK, pickupLabel: PICKUP,
    faits: ["Environ 1h30 de trajet en longtail, plus de temps en bateau", "Koh Rok Nok et Koh Rok Nai"],
    inclus: ["Long tail boat 100 % privé", "Capitaine", TRANSFERT_VIEILLE_VILLE, "Petit buffet thaïlandais sur la plage", "Fruits de saison", "Eau potable", "Masques et équipement de snorkeling", "Assurance accident"],
    note: "Au-delà de 10 personnes, écrivez-moi : je vous réponds sur WhatsApp.",
    gestion: g("koh-rok-koh-haa", "Koh Rok & Koh Haa", "private-longtail", "Private longtail")
  },
  "koh-rok-koh-haa--private-speedboat": {
    produit: "Koh Rok et Koh Haa, speedboat privé", titre: "En speedboat privé", ...demande, parc: PARC_GRAND, fermeture: SAISON_KOH_ROK, pickupLabel: PICKUP,
    faits: ["Journée à composer selon vos envies"],
    gestion: g("koh-rok-koh-haa", "Koh Rok & Koh Haa", "private-speedboat", "Private speedboat")
  },
  // ---------- Koh Phi Phi ----------
  "koh-phi-phi--join-in-speedboat": {
    produit: "Koh Phi Phi, journée en speedboat partagé", titre: "Journée en speedboat partagé", ...pers(2000, enfant(4, 11, 1000), bebe(3)), parc: PARC_PHI_PHI, pickupLabel: PICKUP,
    faits: ["Journée complète", "Prise en charge à l’hôtel entre 8h et 9h", "Environ 1 h de traversée en speedboat", "Maya Bay, Viking Cave, Pileh Lagoon, Monkey Beach, Phi Phi Don et Bamboo Island"],
    inclus: ["Transfert aller-retour depuis votre hôtel", "Déjeuner buffet, boissons et fruits de saison", "Petit déjeuner léger au ponton", "Masque, tuba et gilet de sauvetage", "Guide qui parle anglais", "Assurance"],
    gestion: g("koh-phi-phi", "Koh Phi Phi", "join-in-speedboat", "Day trip")
  },
  "koh-phi-phi--sunset": {
    produit: "Koh Phi Phi, sortie jusqu’au coucher du soleil", titre: "Sortie jusqu’au coucher du soleil", ...pers(2900, enfant(4, 11, 1900)), parc: PARC_PHI_PHI, pickupLabel: PICKUP,
    faits: ["Retour au coucher du soleil"],
    inclus: ["Prise en charge et retour en voiture", "Snacks sur le bateau", "Déjeuner buffet thaïlandais sur Bamboo Island", "Boissons et dîner au retour"],
    gestion: g("koh-phi-phi", "Koh Phi Phi", "sunset", "Sunset trip")
  },
  "koh-phi-phi--private-longtail": {
    produit: "Koh Phi Phi, longtail privé", titre: "En longtail privé", ...demande, parc: PARC_PHI_PHI, pickupLabel: PICKUP,
    faits: ["Bateau rien que pour votre groupe", "Journée à composer selon vos envies"],
    gestion: g("koh-phi-phi", "Koh Phi Phi", "private-longtail", "Private longtail")
  },
  "koh-phi-phi--private-speedboat": {
    produit: "Koh Phi Phi, speedboat privé", titre: "En speedboat privé", ...demande, parc: PARC_PHI_PHI, pickupLabel: PICKUP,
    faits: ["Bateau rien que pour votre groupe", "Journée à composer selon vos envies"],
    gestion: g("koh-phi-phi", "Koh Phi Phi", "private-speedboat", "Private speedboat")
  },
  // ---------- Mangroves ----------
  "mangroves--longtail-half-day": {
    produit: "Mangroves, demi-journée en longtail avec déjeuner", titre: "Demi-journée en longtail avec déjeuner", ...pers(1000, enfant(4, 11, 700)), pickupLabel: PICKUP, choix: [matinApresMidi()],
    faits: ["Thung Yee Peng, côte est de Koh Lanta", VILLAGE],
    inclus: ["Transfert aller-retour depuis votre hôtel", "Déjeuner, boissons et fruits de saison", "Guide local expérimenté", "Assurance"],
    gestion: g("mangroves", "Mangroves by longtail", "longtail-half-day", "Half day by longtail, with lunch")
  },
  "mangroves--longtail-old-town-viewpoint": {
    produit: "Mangroves, longtail puis vieille ville et point de vue", titre: "Longtail, vieille ville et point de vue", ...pers(1300, enfant(4, 11, 900)), pickupLabel: PICKUP, choix: [matinApresMidi()],
    faits: ["La mangrove en longtail, puis Lanta Old Town et un point de vue", VILLAGE],
    gestion: g("mangroves", "Mangroves by longtail", "longtail-old-town-viewpoint", "Longtail through the mangrove, then Old Town and a viewpoint")
  },
  "mangroves--fishing-park": {
    produit: "Mangroves, kayak ou longtail puis parc de pêche", titre: "Kayak ou longtail, puis parc de pêche", ...pers(1800, enfant(4, 11, 1200)), pickupLabel: PICKUP,
    choix: [matinApresMidi(), { id: "way", label: "En kayak ou en longtail", en: "By", valeurs: [{ id: "kayak", label: "En kayak", en: "Kayak" }, { id: "longtail", label: "En longtail", en: "Longtail" }] }],
    faits: ["La mangrove, puis un parc de pêche", VILLAGE],
    gestion: g("mangroves", "Mangroves by longtail", "fishing-park", "Mangrove by kayak or longtail, then a fishing park")
  },
  // ---------- Pêche et radeaux ----------
  "fishing-trip--private-raft": {
    produit: "Pêche sur un radeau privé et déjeuner de fruits de mer", titre: "Radeau privé, pêche et déjeuner de fruits de mer", ...radeau(3900, 1800, enfant(3, 9, 1500)), pickupLabel: PICKUP,
    faits: ["Demi-journée, radeau de 9h30 à 14h à Ao Lanta", "Embarquement au ponton de Thung Yee Peng, enregistrement à 10h"],
    inclus: ["Transfert aller-retour depuis votre hôtel, dans la zone de Koh Lanta", "Matériel de pêche", "Appâts, guide local, gilets de sauvetage et assurance", "Déjeuner de fruits de mer, eau, soft drinks et fruits de saison"],
    gestion: g("fishing-trip", "Fishing trip", "private-raft", "Private raft, fishing and seafood lunch")
  },
  "sunrise-raft--raft-sunrise": {
    produit: "Radeau privé au lever du soleil", titre: "Radeau privé au lever du soleil", ...radeau(3500, 1500, enfant(3, 9, 1200)), pickupLabel: PICKUP,
    faits: ["Prise en charge vers 4h40", "Retour au ponton à 7h30", "Petit déjeuner léger, café et thé à bord"],
    inclus: ["Transfert aller-retour depuis votre hôtel", "Petit déjeuner léger, café, thé et snacks sur le radeau", "Le radeau rien que pour votre groupe"],
    gestion: g("sunrise-raft", "Sunrise raft", "raft-sunrise", "Private raft at sunrise")
  },
  "sunset-dinner-raft--raft-sunset-dinner": {
    produit: "Radeau privé, dîner au coucher du soleil", titre: "Radeau privé, dîner au coucher du soleil", ...radeau(3900, 1800, enfant(3, 9, 1500)), pickupLabel: PICKUP,
    faits: ["Prise en charge à 16h30", "Retour à 20h depuis le ponton de Thung Yee Peng", "Dîner de fruits de mer aux chandelles"],
    inclus: ["Transfert aller-retour depuis votre hôtel, dans la zone de Koh Lanta", "Dîner de fruits de mer, eau potable et fruits de saison", "Matériel de pêche à bord", "Guide local et gilets de sauvetage", "Le radeau rien que pour votre groupe"],
    gestion: g("sunset-dinner-raft", "Sunset dinner raft", "raft-sunset-dinner", "Private raft, sunset dinner")
  },
  "speedboat-ferry": {
    produit: "Speedboat et ferry depuis Koh Lanta", titre: "Speedboat et ferry", ...demande, messageObligatoire: true, messageAide: "votre trajet, avec le départ, l’arrivée et le jour", pickupLabel: PICKUP,
    faits: ["Des speedboats depuis Koh Lanta vers Phi Phi, Phuket, les îles et Langkawi", "Les horaires et les prix dépendent de la saison et de la destination : dites-moi votre trajet dans le message"],
    gestion: g("speedboat-ferry", "Speedboat and ferry", "", "")
  },
  // ---------- Activités ----------
  ...["track-30-min", "forest-1-hr", "beach-bridge-2-hr", "atv-kayak-2-hr"].reduce((acc, id, i) => {
    const P = [
      ["30 minutes sur une piste fermée", "ATV, 30 minutes", [1200, 900, 900, 600], [5, 3], "30 minutes on a closed track", ["Piste d’entraînement, pour les débutants", "Quad automatique 250 cc"]],
      ["1 heure jusqu’à la plage de Lung Sod", "ATV, 1 heure", [1800, 1300, 1500, 1000], [5, 3], "1 hour to Lung Sod Beach", ["Pour les pilotes expérimentés", "Quad automatique 250 cc"]],
      ["2 heures, la plage et le pont", "ATV, 2 heures", [2500, 1800, 2200, 1500], [5, 3], "2 hours, beach and bridge", ["Plage de Lung Sod et pont Siri Lanta, pour les pilotes expérimentés", "Quad automatique 250 cc"]],
      ["1 heure de quad et 1 heure de kayak", "ATV et kayak, 2 heures", [2800, 2000, 2500, 1700], [6, 4], "1 hour of ATV and 1 hour of kayak", ["Pour les pilotes expérimentés"]]
    ][i];
    acc["atv--" + id] = {
      produit: "Quad, " + P[0].charAt(0).toLowerCase() + P[0].slice(1), titre: P[0], type: "lignes", lignesLabel: "Pilotes et passagers", lignesLabelEn: "Riders and passengers", pickupLabel: PICKUP,
      lignes: [
        { id: "adulte-pilote", label: "Adulte pilote", en: "Adult rider", prix: P[2][0], role: "adulte" },
        { id: "adulte-passager", label: "Adulte passager", en: "Adult passenger", prix: P[2][1], role: "adulte" },
        { id: "enfant-pilote", label: "Enfant pilote", en: "Child rider", prix: P[2][2], role: "enfant", regle: `de ${P[3][0]} à 12 ans` },
        { id: "enfant-passager", label: "Enfant passager", en: "Child passenger", prix: P[2][3], role: "enfant", regle: `de ${P[3][1]} à 12 ans` }
      ],
      faits: P[5].concat(["Dites dans votre message l’expérience de chaque pilote"]),
      gestion: g("atv", "ATV (quad bike)", id, P[4])
    };
    return acc;
  }, {}),
  "batik--morning-or-afternoon": {
    produit: "Batik, cours du matin ou de l’après-midi", titre: "Cours du matin ou de l’après-midi", ...pers(1500, enfant(3, 10, 1000)), pickupLabel: PICKUP,
    choix: [{ id: "course", label: "Cours", en: "Course", valeurs: [
      { id: "morning", label: "Matin, prise en charge entre 8h et 9h, retour vers 13h", en: "Morning course, pickup 08:00–09:00, back around 13:00", heure: "08:00" },
      { id: "afternoon", label: "Après-midi, prise en charge entre 12h et 13h, retour avant 17h", en: "Afternoon course, pickup 12:00–13:00, back by 17:00", heure: "12:00" }
    ] }],
    faits: ["Atelier sur Koh Lanta Noi, prise en charge à l’hôtel en voiture", "Votre toile est vernie et livrée le lendemain"],
    gestion: g("batik", "Batik painting", "morning-or-afternoon", "Morning or afternoon course")
  },
  "batik--kayak-and-painting": {
    produit: "Batik, kayak et peinture", titre: "Kayak et peinture", ...pers(2200, enfant(3, 10, 1600)), pickupLabel: PICKUP,
    faits: ["Journée complète : prise en charge entre 8h et 9h, Koh Talabeng en longtail et en kayak, peinture à partir de 13h, retour vers 17h"],
    gestion: g("batik", "Batik painting", "kayak-and-painting", "Kayaking and painting")
  },
  "batik--private-course": {
    produit: "Batik, cours privé", titre: "Cours privé, pour votre groupe seulement", ...demande, pickupLabel: PICKUP,
    gestion: g("batik", "Batik painting", "private-course", "Private course, your group only")
  },
  ...["10-minutes", "15-minutes"].reduce((acc, id, i) => {
    const prix = [[399, 499, 499, 599], [599, 699, 699, 799]][i];
    acc["go-kart--" + id] = {
      produit: "Go-kart électrique, " + (i ? "15" : "10") + " minutes", titre: i ? "15 minutes" : "10 minutes", type: "lignes", lignesLabel: "Karts", lignesLabelEn: "Karts", pickupLabel: PICKUP,
      lignes: [
        { id: "petit-simple", label: "Petit, une place", en: "Small single seat", prix: prix[0], places: 1 },
        { id: "petit-double", label: "Petit, deux places", en: "Small double seat", prix: prix[1], places: 2 },
        { id: "grand-simple", label: "Grand, une place", en: "Large single seat", prix: prix[2], places: 1 },
        { id: "grand-double", label: "Grand, deux places", en: "Large double seat", prix: prix[3], places: 2 }
      ],
      faits: ["Près de Sala Dan, au nord de Koh Lanta Yai", "Dès 4 ans", "Des carpes koï à nourrir", "Transfert non compris : demandez-le-moi"],
      gestion: g("go-kart", "Electric go-kart", id, id === "10-minutes" ? "10 minutes" : "15 minutes")
    };
    return acc;
  }, {}),
  ...[
    ["programme-a", "Programme A, 1 h 30 à 2 h avec les éléphants", [1800, 1400], "Programme A, 1 hr 30 min to 2 hours with the elephants", [["0900", "9h, prise en charge entre 8h et 9h", "9am, pickup between 8am and 9am", "09:00"], ["1200", "12h, prise en charge entre 11h et 12h", "12 noon, pickup between 11am and 12 noon", "12:00"], ["1500", "15h, prise en charge entre 14h et 15h", "3pm, pickup between 2pm and 3pm", "15:00"]]],
    ["programme-b", "Programme B, les éléphants et la plage de Klong Jark", [2000, 1600], "Programme B, the elephants and Klong Jark beach", [["0900", "9h", "9am", "09:00"], ["1200", "12h", "12 noon", "12:00"]]],
    ["programme-c", "Programme C, les éléphants, une cascade et une grotte cachée", [2200, 1800], "Programme C, the elephants, a waterfall and a hidden cave", [["0900", "9h", "9am", "09:00"], ["1200", "12h", "12 noon", "12:00"]]],
    ["programme-d", "Programme D, une journée sur Koh Lanta avec les éléphants", [4500, 3000], "Programme D, a day on Koh Lanta with the elephants", null]
  ].reduce((acc, [id, titre, prix, en, seances]) => {
    acc["elephant-sanctuary--" + id] = {
      produit: "Sanctuaire d’éléphants, " + titre.charAt(0).toLowerCase() + titre.slice(1), titre, ...pers(prix[0], enfant(4, 10, prix[1]), bebe(3)), adulteRegle: "Adulte dès 11 ans", pickupLabel: PICKUP,
      ...(seances ? { choix: [{ id: "session", label: "Séance", en: "Session", valeurs: seances.map(([sid, label, en, heure]) => ({ id: sid, label, en, heure })) }] } : {}),
      faits: ["Pas de promenade à dos d’éléphant, pas de spectacle", "Près de la cascade de Klong Jark"],
      gestion: g("elephant-sanctuary", "Elephant sanctuary", id, en)
    };
    return acc;
  }, {}),
  "mangrove-kayaking--mangrove-kayak-half-day": {
    produit: "Kayak dans la mangrove, demi-journée avec déjeuner", titre: "Demi-journée avec déjeuner", ...pers(1000, enfant(4, 11, 700)), pickupLabel: PICKUP, choix: [matinApresMidi()],
    faits: ["Départ du ponton de Thung Yee Peng, côte est", VILLAGE],
    gestion: g("mangrove-kayaking", "Mangrove kayaking", "mangrove-kayak-half-day", "Mangrove kayaking with lunch, half day")
  },
  "kayak--sea-cave-island-hopping-1-day": {
    produit: "Kayak, grottes marines et îles, 1 jour", titre: "Grottes marines et îles, 1 jour", ...pers(1300, enfant(4, 11, 900)), pickupLabel: PICKUP,
    faits: ["Journée de 9h à 15h ou de 9h à 15h30", "Départ du ponton de Thung Yee Peng, côte est", VILLAGE],
    gestion: g("kayak", "Sea cave kayaking", "sea-cave-island-hopping-1-day", "Sea cave kayaking and island hopping, 1 day")
  },
  "kayak--love-kayak-1-day": {
    produit: "Kayak, deux lieux, 1 jour", titre: "Deux lieux, 1 jour", ...pers(1500, enfant(4, 11, 1000)), pickupLabel: PICKUP,
    faits: ["Journée complète", "Départ du ponton de Thung Yee Peng, côte est", VILLAGE],
    gestion: g("kayak", "Sea cave kayaking", "love-kayak-1-day", "Love kayak, two places, 1 day")
  },
  "kayak--sea-cave-mangrove-half-day": {
    produit: "Kayak, grottes marines et mangrove, demi-journée", titre: "Grottes marines et mangrove, demi-journée", ...pers(1000, enfant(4, 11, 700)), pickupLabel: PICKUP, choix: [matinApresMidi()],
    faits: ["Départ du ponton de Thung Yee Peng, côte est", VILLAGE],
    gestion: g("kayak", "Sea cave kayaking", "sea-cave-mangrove-half-day", "Sea cave kayaking and mangrove, half day")
  },
  ...[
    ["single-chef", "Un cuisinier pour vous", 1900, "Single chef", "class", "Class", [
      { id: "lunch", label: "Marché et déjeuner, lundi, mercredi et samedi, de 9h à 14h", en: "Market tour and lunch, Monday, Wednesday, Saturday, 09:00–14:00", jours: [L.lun, L.mer, L.sam], joursTexte: "le lundi, le mercredi et le samedi", heure: "09:00" },
      { id: "dinner", label: "Dîner, mardi, jeudi et vendredi, de 16h à 21h", en: "Dinner, Tuesday, Thursday, Friday, 16:00–21:00", jours: [L.mar, L.jeu, L.ven], joursTexte: "le mardi, le jeudi et le vendredi", heure: "16:00" }]],
    ["partner-chef", "Un cuisinier pour plusieurs personnes", 1650, "Partner chef", "class", "Class", [
      { id: "lunch", label: "Marché et déjeuner, lundi, mercredi et samedi, de 9h à 14h", en: "Market tour and lunch, Monday, Wednesday, Saturday, 09:00–14:00", jours: [L.lun, L.mer, L.sam], joursTexte: "le lundi, le mercredi et le samedi", heure: "09:00" },
      { id: "dinner", label: "Dîner, mardi, jeudi et vendredi, de 16h à 21h", en: "Dinner, Tuesday, Thursday, Friday, 16:00–21:00", jours: [L.mar, L.jeu, L.ven], joursTexte: "le mardi, le jeudi et le vendredi", heure: "16:00" }]],
    ["carving", "Sculpture de fruits et légumes", 1800, "Fruit and vegetable carving", "class", "Class", [
      { id: "afternoon", label: "Après-midi, lundi, mercredi et samedi, de 15h à 18h", en: "Afternoon carving, Monday, Wednesday, Saturday, 15:00–18:00", jours: [L.lun, L.mer, L.sam], joursTexte: "le lundi, le mercredi et le samedi", heure: "15:00" },
      { id: "morning", label: "Matin, mardi, jeudi et vendredi, de 9h à 12h", en: "Morning carving, Tuesday, Thursday, Friday, 09:00–12:00", jours: [L.mar, L.jeu, L.ven], joursTexte: "le mardi, le jeudi et le vendredi", heure: "09:00" }]]
  ].reduce((acc, [id, titre, prix, en, gid, glabel, valeurs]) => {
    acc["cooking-class--" + id] = {
      produit: "Cours de cuisine thaïe, " + titre.charAt(0).toLowerCase() + titre.slice(1), titre, type: "personne", adulte: prix, adulteRegle: "Par personne", pickupLabel: PICKUP,
      choix: [{ id: gid, label: "Cours", en: glabel, valeurs }],
      faits: ["À Khlong Khong, sur Koh Lanta", "Quatre plats et une pâte ou une sauce faite à la main, au poulet ou végétarien"],
      gestion: g("cooking-class", "Thai cooking class", id, en)
    };
    return acc;
  }, {}),
  "scuba-diving--one-day-experience": {
    produit: "Plongée, journée découverte, 2 plongées", titre: "Journée découverte, 2 plongées", ...pers(4500, null), adulteRegle: "Par personne", pickupLabel: PICKUP,
    choix: [{ id: "programme", label: "Formule", en: "Programme", valeurs: [
      { id: "explorer", label: "Scuba Explorer, dès 8 ans", en: "Scuba Explorer, from age 8", ageMin: 8, nom: "Scuba Explorer" },
      { id: "basic", label: "Discover Basic Diver, dès 10 ans", en: "Discover Basic Diver, from age 10", ageMin: 10, nom: "Discover Basic Diver" }
    ] }],
    faits: ["Aucune expérience nécessaire, sites proches de Koh Lanta", "Droits d’entrée du parc national et assurance plongée en plus : 150 THB d’assurance par jour, droits du parc payés sur place", "Il faut être apte médicalement et remplir un questionnaire médical"],
    gestion: g("scuba-diving", "Scuba diving", "one-day-experience", "One-day experience, 2 dives")
  },
  "scuba-diving--fun-dives": {
    produit: "Plongée, 2 plongées pour plongeurs certifiés", titre: "2 plongées pour plongeurs certifiés", ...pers(3500, null), adulteRegle: "Par personne", pickupLabel: PICKUP,
    choix: [{ id: "site", label: "Lieu", en: "Site", valeurs: [
      { id: "koh-haa", label: "Koh Haa", en: "Koh Haa" },
      { id: "phi-phi-bida", label: "Phi Phi et Koh Bida", en: "Phi Phi and Koh Bida" }
    ] }],
    faits: ["Grand bateau, sites proches de Koh Lanta", "Quatre plongeurs au plus par groupe", "Droits d’entrée du parc national et assurance plongée (150 THB par jour) en plus"],
    gestion: g("scuba-diving", "Scuba diving", "fun-dives", "Fun dives for certified divers")
  },
  "scuba-diving--snorkelling-on-dive-boat": {
    produit: "Plongée, snorkeling sur le bateau de plongée", titre: "Snorkeling sur le bateau de plongée", ...pers(1800, enfant(5, 11, 1300), bebe(4)), adulteRegle: "Adulte dès 12 ans", pickupLabel: PICKUP,
    faits: ["Sites proches de Koh Lanta, le bateau est partagé avec les plongeurs", "Une nounou à bord est possible pour vos enfants : 800 THB, dites-le-moi dans le message", "Droits d’entrée du parc national en plus, payés sur place"],
    gestion: g("scuba-diving", "Scuba diving", "snorkelling-on-dive-boat", "Snorkelling on the dive boat")
  },
  "scuba-diving--catamaran-special-trips": {
    produit: "Plongée, sorties spéciales en catamaran, 3 plongées", titre: "Sorties spéciales en catamaran, 3 plongées", ...demande, messageObligatoire: true, messageAide: "la sortie voulue et votre niveau de plongée", pickupLabel: PICKUP,
    faits: ["Sortie au nord ou au sud, trois plongées", "Brevet Adventure Diver (30 mètres) au moins, dernière plongée il y a moins de six mois", "Dites-moi la sortie voulue et votre niveau dans le message"],
    gestion: g("scuba-diving", "Scuba diving", "catamaran-special-trips", "Special trips by catamaran, 3 dives")
  },
  "scuba-diving--courses": {
    produit: "Plongée, formations", titre: "Formations", ...demande, messageObligatoire: true, messageAide: "la formation voulue", pickupLabel: PICKUP,
    faits: ["Open Water, Advanced Open Water, React Right, Stress and Rescue, Deep Diver et Nitrox", "Dites-moi la formation voulue dans le message"],
    gestion: g("scuba-diving", "Scuba diving", "courses", "Courses")
  },
  "scuba-diving--rentals-and-discounts": {
    produit: "Plongée, location de matériel et forfaits", titre: "Location de matériel et forfaits", ...demande, messageObligatoire: true, messageAide: "le matériel ou le forfait voulu", pickupLabel: PICKUP,
    faits: ["Ordinateur de plongée, GoPro, forfaits de plusieurs jours de plongée", "Dites-moi ce que vous cherchez dans le message"],
    gestion: g("scuba-diving", "Scuba diving", "rentals-and-discounts", "Rentals and discounts")
  },
  ...[
    ["cars-and-pick-ups", "Voitures et pick-up", "Cars and pick-ups", 1200],
    ["big-bikes", "Grosses motos", "Big bikes", 600],
    ["scooters-and-small-bikes", "Scooters et petites motos", "Scooters and small bikes", 250]
  ].reduce((acc, [id, titre, en, mini]) => {
    acc["rental--" + id] = {
      produit: "Location, " + titre.toLowerCase(), titre, ...demande, messageObligatoire: true, messageAide: "le véhicule voulu et vos dates de début et de fin", pickupLabel: "Hôtel où livrer le véhicule",
      faits: ["À partir de " + mini + " THB par 24 heures, selon le modèle", "Dites-moi le véhicule et vos dates dans le message : je confirme qu’il est disponible", "Livraison gratuite à moins de 5 km de Long Beach, ailleurs je vous indique le tarif avant la réservation", "Caution : votre passeport. Casque fourni. Aucune assurance accident incluse"],
      gestion: g("rental", "Car and scooter rental", id, en)
    };
    return acc;
  }, {}),
  "island-day-tour": {
    wa: true, produit: "Tour de l’île en songthaew", titre: "Tour de l’île en songthaew",
    texte: "Lanta Old Town, des points de vue et des plages autour de Koh Lanta, dans un songthaew local, pour une journée.", waLabel: "Demander le tarif"
  }
};

const BATEAU_AVANT = "Les itinéraires indiqués sont donnés à titre indicatif. Ils peuvent être adaptés ou modifiés selon la météo, l’état de la mer et la fréquentation des sites. Les étapes ne peuvent donc pas être garanties à l’avance.";
const MIN = (prefixe, liste) => liste.map((id) => prefixe + "--" + id);

const guide = {
  paragraphes: [
    "Envie de découvrir les îles autour de Koh Lanta ? Voici une sélection d’excursions et d’activités proposées par des équipes locales, avec différentes options selon votre budget et vos envies.",
    BATEAU_AVANT
  ],
  sections: [
    {
      id: "bateau",
      num: 1,
      titre: "Les tours en bateau",
      photos: [
        { src: "/images/carnet-koh-lanta-rochers.jpg", alt: "Deux rochers calcaires qui sortent de la mer, vus depuis un bateau" },
        { src: "/images/carnet-koh-lanta-plage-koh-rok.jpg", alt: "Plage de sable blanc et eau turquoise, une île boisée au fond" },
        { src: "/images/carnet-koh-lanta-plage-kradan.jpg", alt: "Plage de sable clair, branche d’arbre mort et visiteurs en gilet orange au bord de l’eau" },
        { src: "/images/carnet-koh-lanta-mangroves.jpg", alt: "Long tail boat sur un canal de la mangrove" }
      ],
      notePrix: HAUTE_SAISON,
      optionsTitre: "Les sorties",
      groupes: [
        { id: "ll-4-islands", titre: "Les 4 Islands", repliable: true, texte: "La grotte d’Émeraude de Koh Mook, Koh Chuek, Koh Ma et Koh Ngai, avec le déjeuner sur la plage. En longtail ou en speedboat, en groupe ou en privé.", offres: MIN("4-islands", ["join-in-longtail", "join-in-speedboat", "private-longtail", "private-speedboat"]) },
        { id: "ll-koh-rok", titre: "Koh Rok et Koh Haa", repliable: true, texte: "Deux îles du parc national de Mu Ko Lanta, ouvertes de la mi-octobre à la mi-mai, avec des arrêts snorkeling et le déjeuner sur la plage de Koh Rok. Environ 1h30 de trajet en longtail.", offres: MIN("koh-rok-koh-haa", ["join-in-speedboat", "sunset", "private-longtail", "private-speedboat"]) },
        { id: "ll-phi-phi", titre: "Koh Phi Phi", repliable: true, texte: "Maya Bay, Pileh Lagoon, Viking Cave et Monkey Beach le matin, puis le déjeuner sur Phi Phi Don, Bamboo Island et du temps libre. En speedboat partagé ou en bateau privé.", offres: MIN("koh-phi-phi", ["join-in-speedboat", "sunset", "private-longtail", "private-speedboat"]) },
        { id: "ll-mangroves", titre: "La mangrove", repliable: true, texte: "Une demi-journée dans la mangrove de la côte est de Koh Lanta, en longtail dans des canaux étroits où vivent des singes et des oiseaux, avec le déjeuner.", offres: MIN("mangroves", ["longtail-half-day", "longtail-old-town-viewpoint", "fishing-park"]) },
        { id: "ll-peche", titre: "Pêche sur un radeau privé", repliable: true, texte: "Une demi-journée de pêche sur un radeau en bois dans le calme d’Ao Lanta, avec un déjeuner de fruits de mer frais sur le radeau.", offres: ["fishing-trip--private-raft"] },
        { id: "ll-lever", titre: "Radeau au lever du soleil", repliable: true, texte: "Un radeau en bois rien que pour votre groupe, dans la mangrove de Thung Yee Peng avant le lever du soleil, avec le petit déjeuner à bord.", offres: ["sunrise-raft--raft-sunrise"] },
        { id: "ll-diner", titre: "Radeau et dîner au coucher du soleil", repliable: true, texte: "La mangrove en fin de journée, un dîner de fruits de mer aux chandelles sur votre radeau, puis le plancton qui brille dans l’eau noire.", offres: ["sunset-dinner-raft--raft-sunset-dinner"] },
        { id: "ll-speedboat", titre: "Speedboat et ferry", repliable: true, texte: "Un trajet en speedboat ou en ferry depuis Koh Lanta vers Phi Phi, Phuket, les autres îles ou Langkawi.", offres: ["speedboat-ferry"] }
      ]
    },
    {
      id: "activites",
      num: 2,
      titre: "Les activités",
      photos: [
        { src: "/images/carnet-koh-lanta-quad.jpg", alt: "Quads garés sur une piste en terre avec vue sur la campagne" },
        { src: "/images/carnet-koh-lanta-elephants.jpg", alt: "Deux éléphants dans la végétation, au bord d’un point d’eau" },
        { src: "/images/carnet-koh-lanta-batik.jpg", alt: "Peinture de batik colorée d’une femme à la coiffe ornée, un artiste y ajoute des détails" },
        { src: "/images/carnet-koh-lanta-recif.jpg", alt: "Corail et petits poissons sur un récif" },
        { src: "/images/carnet-koh-lanta-vieille-ville.jpg", alt: "Rue de Lanta Old Town avec ses maisons en bois" }
      ],
      notePrix: HAUTE_SAISON,
      optionsTitre: "Les activités",
      groupes: [
        { id: "la-atv", titre: "Quad (ATV)", repliable: true, texte: "Une balade en quad sur les pistes de terre de Koh Lanta. La piste de 30 minutes convient aux débutants, les balades plus longues sont réservées aux pilotes expérimentés.", offres: MIN("atv", ["track-30-min", "forest-1-hr", "beach-bridge-2-hr", "atv-kayak-2-hr"]) },
        { id: "la-elephants", titre: "Sanctuaire d’éléphants", repliable: true, texte: "Nourrir les éléphants et marcher avec eux, sans les monter.", offres: MIN("elephant-sanctuary", ["programme-a", "programme-b", "programme-c", "programme-d"]) },
        { id: "la-cuisine", titre: "Cours de cuisine thaïe", repliable: true, texte: "Une visite du marché local, puis de la cuisine thaïe avec un cuisinier local. Convient aux enfants.", offres: MIN("cooking-class", ["single-chef", "partner-chef", "carving"]) },
        { id: "la-batik", titre: "Peinture sur batik", repliable: true, texte: "Peindre votre propre toile de batik avec un instructeur local, ou ajouter une sortie en kayak vers la grotte marine.", offres: MIN("batik", ["morning-or-afternoon", "kayak-and-painting", "private-course"]) },
        { id: "la-kart", titre: "Go-kart électrique", repliable: true, texte: "Des karts électriques, petits et grands, à une ou deux places, et des carpes koï à nourrir.", offres: MIN("go-kart", ["10-minutes", "15-minutes"]) },
        { id: "la-kayak", titre: "Kayak", repliable: true, texte: "Les grottes marines, la mangrove et les îles en kayak, d’une demi-journée à une journée.", offres: MIN("kayak", ["sea-cave-mangrove-half-day", "sea-cave-island-hopping-1-day", "love-kayak-1-day"]).concat(["mangrove-kayaking--mangrove-kayak-half-day"]) },
        { id: "la-plongee", titre: "Plongée", repliable: true, texte: "Une première plongée sans expérience (dès 8 ans), des plongées pour plongeurs certifiés et du snorkeling sur le bateau de plongée, en petits groupes.", offres: MIN("scuba-diving", ["one-day-experience", "fun-dives", "snorkelling-on-dive-boat", "catamaran-special-trips", "courses", "rentals-and-discounts"]) },
        { id: "la-location", titre: "Voitures et scooters", repliable: true, texte: "Des scooters, de grosses motos, des voitures et des pick-up pour explorer l’île.", offres: MIN("rental", ["cars-and-pick-ups", "big-bikes", "scooters-and-small-bikes"]) },
        { id: "la-tour", titre: "Tour de l’île", repliable: true, offres: ["island-day-tour"] }
      ]
    },
    {
      id: "choisir",
      num: 3,
      titre: "Pour choisir",
      blocs: [
        {
          paragraphes: [
            "Vous hésitez entre plusieurs options ? Dites-moi combien vous êtes, votre budget et ce que vous recherchez (snorkeling, plages, tranquillité, journée privée, petit budget…) et je peux vous orienter vers l’option la plus adaptée.",
            "Il existe beaucoup d’autres options à Koh Lanta, des tours, des activités et des transferts."
          ],
          lien: { avant: "Elles sont présentées sur", label: "secrettravelandtour.com", url: "https://secrettravelandtour.com/", apres: "(le site est en anglais)." }
        }
      ]
    }
  ]
};

module.exports = construire({ guide, reglages, offres });
