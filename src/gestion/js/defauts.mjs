// Valeurs de départ du mode démo et textes types.
// Les vraies coordonnées (téléphone, e-mail, banque) ne sont pas dans ce fichier car il est servi publiquement :
// elles viennent de la table « reglages » (voir docs/gestion/schema.sql).

export const uid = () => crypto.randomUUID();

const COND_QR = `Un acompte de {acompte}% de la facture (non-remboursable) est demandé à la signature du devis, payable à {delai} jours, le reste du montant est à verser à la réception du carnet de voyage.
Modes de paiement :
- Virement bancaire en CHF.
- Paiement en EUR (1 CHF = 1,10€) possible sur demande (via PayPal ou virement bancaire)
- **Paiement facile avec un compte Wise** : scannez le QR code et réglez dans votre devise habituelle (CHF ou Euro). Je pourrai alors le changer en THB pour moi, sans frais supplémentaires pour vous.`;

const COND_EMAIL = `Un acompte de {acompte} % du montant total est demandé à la signature du devis. Cet acompte est **non remboursable** et doit être réglé dans un délai de {delai} jours suivant l'acceptation du devis.
Le solde de {solde} % est à régler à la réception du carnet de voyage final.

Le montant total de la prestation s'élève à **{total}**{indicatif}.
Afin d'éviter les frais liés aux virements internationaux, le paiement peut être effectué facilement via **Wise**, en CHF ou en EUR, selon votre préférence.
_Les coordonnées de paiement Wise sont indiquées dans l'e-mail accompagnant le devis._`;

export const REGLAGES_DEFAUT = {
  emetteur: {
    nom: "Zwald Travel Planner Co., Ltd.",
    adresse: "Adresse de l'entreprise\n81150, Koh Lanta, Krabi",
    telephone: "+ 66 00 000 00 00",
    contact_nom: "Prénom Nom",
    whatsapp: "+66 00 000 00 00 (WhatsApp)",
    email: "contact@exemple.com",
  },
  paiement: {
    banque: "Banque (pays)",
    iban: "CH00 0000 0000 0000 0000 0",
    swift: "XXXXXXXXXXX",
    titulaire: "Prénom Nom",
    ville_titulaire: "0000 Ville",
    wise_pseudo: "@pseudo-wise",
  },
  conditions: {
    acompte_pct: 50,
    delai_jours: 10,
    relance_jours: 7,
    tva_mention: "TVA non applicable",
    cgv_url: "https://zwaldtravelplanner.com/cgv/",
  },
  taux: { eur: 1.058, thb: 40.54 },
  textes: {
    variantes: [
      {
        id: "qr",
        nom: "Avec QR Wise dans le pied de page",
        corps: COND_QR,
        cloture: "Merci pour votre confiance !\nJe reste à votre disposition pour toute question ou demande supplémentaire.\nCordialement,",
      },
      {
        id: "email",
        nom: "Coordonnées de paiement envoyées par e-mail",
        corps: COND_EMAIL,
        cloture: "Merci pour votre confiance !\nNous restons à votre disposition pour toute question ou demande supplémentaire.\nCordialement,",
      },
    ],
  },
};

export const CONTENU_DEFAUT = () => ({
  bandeau: "",
  colonnes: "total",
  lignes: [],
  equivalents: { actif: false },
  pied: "qr",
  variante: "qr",
  tva: true,
  montant_recu: null,
});

export function nouvelleLigne(kind, props = {}) {
  return { id: uid(), kind, libelle: "", intro: "", puces: [], unite: null, qte: null, montant: null, pct: null, ...props };
}

export const CATALOGUE_DEMO = [
  { kind: "formule", libelle: "Formule “par région”", intro: "comprenant:", puces: ["création de l'itinéraire personnalisé", "sélection d'hébergements par région", "carnet de voyage personnalisé"], prix: null, ordre: 1, actif: true },
  { kind: "formule", libelle: "Formule complète DUO", intro: "comprenant:", puces: ["conception de l'itinéraire sur mesure", "sélection d'hébergements par ville", "carnet de voyage personnalisé"], prix: 40, ordre: 2, actif: true },
  { kind: "region", libelle: "Bangkok", intro: "", puces: [], prix: 120, ordre: 10, actif: true },
  { kind: "region", libelle: "Chiang Mai", intro: "", puces: [], prix: 120, ordre: 11, actif: true },
  { kind: "region", libelle: "Koh Lanta", intro: "", puces: [], prix: 150, ordre: 12, actif: true },
  { kind: "supplement", libelle: "Réservation train + transports minivan", intro: "", puces: [], prix: null, ordre: 20, actif: true },
];

// Faux clients et dossiers couvrant chaque statut, datés par rapport à aujourd'hui.
export function donneesDemo(ajd, ajouterJours) {
  const j = (n) => ajouterJours(ajd, n);
  const reglages = REGLAGES_DEFAUT;
  const clients = [
    { id: uid(), created_at: j(-40), civilite: "Madame", prenom: "Hélène", nom: "Marchand", adresse: "Rue du Lac 12\n1204 Genève, Suisse", telephone: "+41 79 000 00 01", email: "", notes: "" },
    { id: uid(), created_at: j(-30), civilite: "Monsieur", prenom: "Julien", nom: "Rochat", adresse: "Chemin des Vignes 4\n1004 Lausanne, Suisse", telephone: "+41 79 000 00 02", email: "", notes: "" },
    { id: uid(), created_at: j(-25), civilite: "Madame", prenom: "Sophie", nom: "Perrin", adresse: "12 rue des Fleurs\n74000 Annecy, FR", telephone: "+33 6 00 00 00 03", email: "", notes: "" },
    { id: uid(), created_at: j(-60), civilite: "Monsieur", prenom: "Marc", nom: "Delaye", adresse: "Rue Centrale 8\n1700 Fribourg, Suisse", telephone: "+41 79 000 00 04", email: "", notes: "Voyage en famille" },
  ];
  const regions = (liste) => [
    { id: uid(), kind: "bloc", libelle: "Formule “par région”", intro: "comprenant:", puces: ["création de l'itinéraire personnalisé", "sélection d'hébergements par région", "carnet de voyage personnalisé"], unite: null, qte: null, montant: null, pct: null },
    ...liste.map(([libelle, montant]) => ({ id: uid(), kind: "ligne", libelle, intro: "", puces: [], unite: null, qte: null, montant, pct: null })),
  ];
  const duo = (jours) => [
    { id: uid(), kind: "bloc", libelle: "Formule complète DUO", intro: "comprenant:", puces: ["conception de l'itinéraire sur mesure", "sélection d'hébergements par ville", "carnet de voyage personnalisé"], unite: 40, qte: jours, montant: null, pct: null },
  ];
  const contenu = (bandeau, lignes, colonnes) => ({ ...CONTENU_DEFAUT(), bandeau, colonnes, lignes });
  const dossiers = [];
  const documents = [];
  const paiements = [];
  const ajoute = (d, devis, facture, pais) => {
    dossiers.push(d);
    documents.push({ id: uid(), created_at: d.created_at, updated_at: d.created_at, dossier_id: d.id, type: "devis", date_emission: d.created_at, envoye_le: null, ...devis });
    if (facture) documents.push({ id: uid(), created_at: j(0), updated_at: j(0), dossier_id: d.id, type: "facture", date_emission: ajd, envoye_le: null, ...facture });
    (pais || []).forEach((p) => paiements.push({ id: uid(), created_at: p.date, dossier_id: d.id, type: "acompte", moyen: "virement", origine_montant: null, origine_devise: "", note: "", ...p }));
  };
  const dossier = (client, creeLe, pays, bandeau, extra) => {
    const ref = `${client.prenom[0]}${client.nom[0]}${creeLe.replaceAll("-", "")} ${pays}`;
    return { id: uid(), created_at: creeLe, ref, client_id: client.id, pays, bandeau, date_depart: null, date_retour: null, accepte_le: null, annule: false, notes: "", ...extra };
  };
  const b1 = "VOYAGE EN THAÏLANDE - DÉCEMBRE 2026";
  ajoute(dossier(clients[0], j(-1), "Thaïlande", b1, {}), { contenu: contenu(b1, regions([["Bangkok", 120], ["Chiang Mai", 120], ["Koh Lanta", 150]]), "total") });
  const b2 = "VOYAGE EN THAÏLANDE - JANVIER 2027";
  ajoute(dossier(clients[1], j(-9), "Thaïlande", b2, {}), { envoye_le: j(-9), contenu: contenu(b2, duo(12), "detail") });
  const b3 = "VOYAGE EN THAÏLANDE - FÉVRIER 2027";
  ajoute(dossier(clients[2], j(-20), "Thaïlande", b3, { accepte_le: j(-14), date_depart: j(95) }), { envoye_le: j(-20), contenu: contenu(b3, regions([["Bangkok", 120], ["Koh Lanta", 150]]), "total") });
  const b4 = "VOYAGE EN THAÏLANDE - NOVEMBRE 2026";
  ajoute(dossier(clients[3], j(-50), "Thaïlande", b4, { accepte_le: j(-45), date_depart: j(18), date_retour: j(32) }),
    { envoye_le: j(-50), contenu: contenu(b4, duo(14), "detail") },
    { contenu: contenu(b4, duo(14), "detail") },
    [{ date: j(-40), montant: 280 }]);
  const b5 = "VOYAGE EN THAÏLANDE - SEPTEMBRE 2026";
  ajoute(dossier(clients[0], j(-80), "Thaïlande", b5, { accepte_le: j(-75), date_depart: j(-20), date_retour: j(-6) }),
    { envoye_le: j(-80), contenu: contenu(b5, regions([["Chiang Mai", 120], ["Koh Lanta", 150]]), "total") },
    null,
    [{ date: j(-70), montant: 135 }, { date: j(-25), montant: 135, type: "solde" }]);
  return { clients, dossiers, documents, paiements, catalogue: CATALOGUE_DEMO.map((c) => ({ id: uid(), created_at: j(-90), ...c })), reglages };
}
