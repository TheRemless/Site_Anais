// Brochure fictive d'un transporteur en minivan (24.11.2026), pour la démonstration et les tests de l'import. Elle reprend les cas de la vraie
// brochure essayée par Jérémy sans aucune de ses données : nom, numéros et prix sont inventés. Colonnes ROUTE, CLASS, DEPARTURE, ARRIVAL,
// PRICE, « เก็บ » (le net, écrit à la main) et NOTE ; un net sous du scotch, un prix sous du scotch, une case de prix fusionnée sur deux
// départs, une faute d'impression (« 12.0 AM »), des arrivées le lendemain, des lieux abrégés et une ligne coupée par le bord de la photo,
// oubliée à la première lecture et retrouvée à la relecture.
// La forme est celle que rend la fonction (validerBrochure, assistant/brochure.js) : un test le vérifie.

const trajet = (x) => ({
  imprime: "",
  de_imprime: "Lanta",
  vers_imprime: "",
  de: "Koh Lanta",
  vers: "",
  mode: "VIP Bus/Van",
  depart: "",
  arrivee: "",
  depart_precision: "",
  arrivee_precision: "",
  lendemain: false,
  duree: "",
  duree_calculee: false,
  periode: "",
  periode_debut: "",
  periode_fin: "",
  note: "",
  prix_texte: "",
  prix_adulte: null,
  prix_enfant: null,
  net_texte: "",
  net_adulte: null,
  net_enfant: null,
  net_source: "",
  net_cache: false,
  net_superieur: false,
  prix_repris: false,
  coupee: false,
  confiance: "haute",
  raison: "",
  lisible: true,
  illisible: "",
  relecture: "",
  relecture_raison: "",
  relecture_champs: [],
  net_a_saisir: false,
  ...x,
});
const ligne = (vers, versImprime, depart, arrivee, duree, prix, net, extra = {}) =>
  trajet({
    imprime: `Lanta - ${versImprime} | VIP Bus/Van | ${depart} | ${arrivee} | ${prix ? prix.toLocaleString("en-US") : "[scotch]"} | ${net ? net.toLocaleString("en-US") : "[scotch]"}`,
    vers,
    vers_imprime: versImprime,
    depart,
    arrivee,
    duree,
    prix_texte: prix ? prix.toLocaleString("en-US") : "",
    prix_adulte: prix,
    net_texte: net ? net.toLocaleString("en-US") : "",
    net_adulte: net,
    net_source: net ? "manuscrit" : "",
    net_a_saisir: !net,
    // Les durées de la brochure fictive sont celles que donnent les heures : « calculées » pour l'outil.
    duree_calculee: true,
    ...extra,
  });

const NAKON = () =>
  ligne("Nakhon Si Thammarat", "Nakon", "08:00", "12:00", "4 h", 750, 550, {
    coupee: true,
    imprime: "Lanta - Nakon | VIP Bus/Van | 08:00 | 12:00 | 750 | 550 (bas de la photo 2)",
    relecture: "ajoute",
    relecture_raison: "Ligne coupée par le bas de la deuxième photo, ses valeurs se lisent.",
    raison: "Ligne coupée par le bas de la deuxième photo, ses valeurs se lisent.",
  });

// La première lecture : dix lignes, la ligne coupée (Nakon) manque.
export function brochureDemoTransport() {
  return {
    partenaire_lu: "KOH DEMO TRANSPORT CO., LTD.",
    partenaire_thai: "บริษัท เกาะเดโม ทรานสปอร์ต จำกัด",
    lieu_depart: "Saladan office",
    contacts: {
      telephones: [
        { numero: "+66 81 000 0101", libelle: "Office", whatsapp: true, line: false },
        { numero: "081-000-0102", libelle: "Booking", whatsapp: false, line: true },
      ],
      emails: ["booking@demo-transport.test"],
      web: "",
      line: "@demotransport",
      adresse: "",
      personne: "",
    },
    devise: "THB",
    colonnes: [
      { entete: "ROUTE", contenu: "trajet", manuscrit: false },
      { entete: "CLASS", contenu: "type", manuscrit: false },
      { entete: "DEPARTURE", contenu: "depart", manuscrit: false },
      { entete: "ARRIVAL", contenu: "arrivee", manuscrit: false },
      { entete: "PRICE", contenu: "prix", manuscrit: true },
      { entete: "เก็บ", contenu: "net", manuscrit: true },
      { entete: "NOTE", contenu: "note", manuscrit: false },
    ],
    tarifs: [],
    trajets: [
      ligne("Bangkok (Khao San Road)", "Khaosan (BKK)", "08:00", "06:00", "22 h", 1650, 1300, { lendemain: true, raison: "Arrivée 06:00 le lendemain (trajet de nuit)." }),
      ligne("Hat Yai", "Hadyai", "08:00", "13:00", "5 h", 650, 500, { note: "change in Trang" }),
      ligne("Hat Yai", "Hadyai", "12:00", "17:00", "5 h", 650, null, { note: "change in Trang", prix_repris: true, net_cache: true, raison: "Case de prix fusionnée avec le départ de 08:00 ; net couvert par du scotch." }),
      ligne("Kuala Lumpur", "KL", "12:00", "05:00", "17 h", 1950, 1600, { lendemain: true, raison: "Arrivée 05:00 le lendemain." }),
      ligne("Ipoh", "Ipho", "12:00", "22:30", "10 h 30", 1750, 1400, { confiance: "moyenne", imprime: "Lanta - Ipho | VIP Bus/Van | 12.0 AM | 22:30 | 1,750 | 1,400", raison: "« 12.0 AM » lu 12:00 : départ de midi, entre les départs de 08:00 et de 14:00." }),
      ligne("Phatthalung", "Phatthalang", "08:00", "12:30", "4 h 30", 600, 450),
      ligne("Krabi Airport", "Krabi A/P", "08:00", "10:30", "2 h 30", 450, 350),
      ligne("Sungai Kolok", "Kolok", "08:00", "16:00", "8 h", 1100, 900),
      ligne("Padang Besar", "Padang", "08:00", "15:30", "7 h 30", null, null, { lisible: false, illisible: "Prix de vente caché par du scotch.", confiance: "basse" }),
      ligne("Bangkok", "BKK", "14:00", "08:00", "18 h", 1550, 1250, { lendemain: true }),
      // Un lieu hors table imprimé en capitales, sans durée imprimée : nom en casse de titre à l'écran, durée calculée des heures.
      ligne("TRANG TRAIN STATION", "TRANG TRAIN STATION", "10:00", "12:30", "2 h 30", 420, 320, { duree_calculee: true }),
    ],
    remarques: "",
    relue: false,
  };
}

// La relecture de la brochure fictive : la ligne coupée retrouvée. Une autre brochure (catalogue de démonstration) revient telle quelle.
export function relectureDemo(brochure) {
  const b = JSON.parse(JSON.stringify(brochure || {}));
  const compte = { corriges: 0, signales: 0, ajoutes: 0, fiche: false };
  if (b.partenaire_lu === brochureDemoTransport().partenaire_lu && !(b.trajets || []).some((t) => t.vers_imprime === "Nakon")) {
    b.trajets.push(NAKON());
    compte.ajoutes++;
  }
  b.relue = true;
  return { brochure: b, relecture: compte };
}
