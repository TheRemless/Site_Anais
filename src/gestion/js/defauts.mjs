// Valeurs de départ, textes types et données de démonstration.
// Les vraies coordonnées (téléphone, e-mail, banque) ne sont pas dans ce fichier car il est servi publiquement :
// elles viennent de la table « reglages » (voir docs/gestion/schema.sql).

export const uid = () => crypto.randomUUID();

export const LIBELLES_FR = {
  devis: "DEVIS",
  facture: "FACTURE",
  ref_devis: "Devis: réf.",
  ref_facture: "Facture: réf.",
  date_emission: "Date d'émission:",
  unite: "UNITÉ",
  qte: "QTÉ",
  total: "TOTAL",
  sous_total: "SOUS-TOTAL",
  remise: "Remise",
  montant_recu: "Montant reçu",
  conditions: "CONDITIONS DE PAIEMENT",
  signature_1: "NOM, PRENOM, DATE ET SIGNATURE DU CLIENT",
  signature_2: "précédé de la mention “Bon pour accord”",
  coordonnees: "COORDONNÉES",
  infos_paiement: "INFORMATIONS DE PAIEMENT",
  pied_court: "voir les instructions de paiement transmises par e-mail.",
  qr_titre: "",
  cgv: "Le client reconnaît avoir pris connaissance des [Conditions Générales de Vente]({cgv_url}) de {entreprise} et les accepter sans réserve. La signature du présent devis vaut acceptation des CGV et engagement contractuel.",
};

export const LIBELLES_EN = {
  devis: "QUOTE",
  facture: "INVOICE",
  ref_devis: "Quote: ref.",
  ref_facture: "Invoice: ref.",
  date_emission: "Date of issue:",
  unite: "UNIT",
  qte: "QTY",
  total: "TOTAL",
  sous_total: "SUBTOTAL",
  remise: "Discount",
  montant_recu: "Amount received",
  conditions: "PAYMENT TERMS",
  signature_1: "FULL NAME, DATE AND SIGNATURE OF THE CLIENT",
  signature_2: "preceded by the words “Approved”",
  coordonnees: "CONTACT",
  infos_paiement: "PAYMENT DETAILS",
  pied_court: "see the payment instructions sent by e-mail.",
  qr_titre: "",
  cgv: "The client acknowledges having read the [Terms and Conditions]({cgv_url}) of {entreprise} and accepts them without reservation. Signing this quote constitutes acceptance of the Terms and Conditions and a binding commitment.",
};

export const MOYENS_DEFAUT = [
  { id: "virement", label: "Virement bancaire" },
  { id: "wise", label: "Wise" },
  { id: "paypal", label: "PayPal" },
  { id: "twint", label: "TWINT" },
  { id: "especes", label: "Espèces" },
  { id: "autre", label: "Autre" },
];

export const COND_QR = `Un acompte de {acompte}% de la facture (non-remboursable) est demandé à la signature du devis, payable à {delai} jours, le reste du montant est à verser à la réception du carnet de voyage.
Modes de paiement :
- Virement bancaire en CHF.
- Paiement en EUR (1 CHF = 1,10€) possible sur demande (via PayPal ou virement bancaire)
- **Paiement facile avec un compte Wise** : scannez le QR code et réglez dans votre devise habituelle (CHF ou Euro). Je pourrai alors le changer en THB pour moi, sans frais supplémentaires pour vous.`;

export const COND_EMAIL = `Un acompte de {acompte} % du montant total est demandé à la signature du devis. Cet acompte est **non remboursable** et doit être réglé dans un délai de {delai} jours suivant l'acceptation du devis.
Le solde de {solde} % est à régler à la réception du carnet de voyage final.

Le montant total de la prestation s'élève à **{total}**{indicatif}.
Afin d'éviter les frais liés aux virements internationaux, le paiement peut être effectué facilement via **Wise**, en CHF ou en EUR, selon votre préférence.
_Les coordonnées de paiement Wise sont indiquées dans l'e-mail accompagnant le devis._`;

// Réglages d'une entreprise nouvellement créée : aucun fait propre à une entreprise réelle.
export const REGLAGES_NEUTRE = {
  emetteur: { nom: "", adresse: "", telephone: "", contact: "" },
  paiement: { texte: "" },
  devise: "",
  conditions: { acompte_pct: 0, delai_jours: 10, relance_jours: 7, tva_mention: "", cgv_url: "" },
  taux: { eur: 1.058, thb: 40.54 },
  numerotation: { mode: "sequence", prefixe: "" },
  dossier: { modele_bandeau: "{PAYS} - {PERIODE}", libelle_pays: "Pays" },
  listes: { pays: [], civilites: ["Madame", "Monsieur", "Mademoiselle"], moyens: MOYENS_DEFAUT },
  apparence: { couleur: "#0b9999", couleur_clair: "#53b7b7", logo: "", titre_image: "", type_images: null, titre_texte: "", qr_image: "", qr_pseudo: "" },
  libelles: LIBELLES_FR,
  textes: { variantes: [{ id: "standard", nom: "Standard", corps: "", cloture: "" }] },
};

const estObjet = (v) => v && typeof v === "object" && !Array.isArray(v);
function fusion(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) out[k] = estObjet(v) && estObjet(base[k]) ? fusion(base[k], v) : v;
  return out;
}

// Complète des réglages enregistrés avec les valeurs neutres et reprend l'ancien format (coordonnées en champs séparés).
export function completerReglages(brut) {
  const r = structuredClone(brut || {});
  const p = r.paiement || {};
  if (p.texte === undefined && (p.banque || p.iban)) {
    p.texte = [p.banque && `Banque: ${p.banque}`, p.iban && `IBAN: ${p.iban}`, p.swift && `Swift: ${p.swift}`, p.titulaire, p.ville_titulaire].filter(Boolean).join("\n");
    r.paiement = p;
  }
  r.apparence = { ...(r.apparence || {}) };
  if (r.apparence.qr_pseudo === undefined && p.wise_pseudo) r.apparence.qr_pseudo = p.wise_pseudo;
  const e = r.emetteur || {};
  if (e.contact === undefined && (e.contact_nom || e.whatsapp || e.email)) r.emetteur = { ...e, contact: [e.contact_nom, e.whatsapp, e.email].filter(Boolean).join("\n") };
  return fusion(REGLAGES_NEUTRE, r);
}

// Ce qu'il manque pour que les documents d'une entreprise soient présentables.
export function reglagesIncomplets(r) {
  const manque = [];
  if (!r.emetteur.nom.trim()) manque.push("le nom de l'entreprise");
  if (!r.emetteur.adresse.trim()) manque.push("l'adresse");
  if (!r.devise.trim()) manque.push("la devise");
  if (!r.emetteur.contact.trim()) manque.push("les coordonnées du pied de page");
  if (!r.paiement.texte.trim() && !r.apparence.qr_image) manque.push("les informations de paiement");
  if (!r.textes.variantes.some((v) => v.corps.trim())) manque.push("les conditions de paiement");
  return manque;
}

export const CONTENU_DEFAUT = () => ({
  bandeau: "",
  colonnes: "total",
  lignes: [],
  equivalents: { actif: false },
  pied: "qr",
  variante: "",
  tva: true,
  montant_recu: null,
});

export function nouvelleLigne(kind, props = {}) {
  return { id: uid(), kind, libelle: "", intro: "", puces: [], unite: null, qte: null, montant: null, pct: null, ...props };
}

// ---------------------------------------------------------------------------------------------
// Démonstration : trois entreprises fictives, deux utilisateurs, des dossiers à tous les statuts.
// ---------------------------------------------------------------------------------------------
const REGLAGES_DEMO_AGENCE = completerReglages({
  emetteur: { nom: "Agence démo", adresse: "1 rue de l'Exemple\n00000 Ville", telephone: "+00 00 000 00 00", contact: "Prénom Nom\n+00 00 000 00 00 (WhatsApp)\ncontact@exemple.com" },
  paiement: { texte: "Banque: Banque démo\nIBAN: CH00 0000 0000 0000 0000 0\nSwift: XXXXXXXXXXX\nPrénom Nom\n0000 Ville", },
  devise: "CHF",
  conditions: { acompte_pct: 50, delai_jours: 10, relance_jours: 7, tva_mention: "TVA non applicable", cgv_url: "" },
  numerotation: { mode: "initiales", prefixe: "" },
  dossier: { modele_bandeau: "VOYAGE EN {PAYS} - {PERIODE}", libelle_pays: "Pays" },
  listes: { pays: ["Thaïlande", "Indonésie", "Vietnam"] },
  apparence: { logo: "assets/logo.png", titre_image: "assets/title.png", type_images: { devis: "assets/devis.png", facture: "assets/facture.png" }, qr_image: "assets/qr-wise.png", qr_pseudo: "@pseudo-wise" },
  libelles: { qr_titre: "WISE - virements internationaux" },
  textes: {
    variantes: [
      { id: "qr", nom: "Avec QR Wise dans le pied de page", corps: COND_QR, cloture: "Merci pour votre confiance !\nJe reste à votre disposition pour toute question ou demande supplémentaire.\nCordialement," },
      { id: "email", nom: "Coordonnées de paiement envoyées par e-mail", corps: COND_EMAIL, cloture: "Merci pour votre confiance !\nNous restons à votre disposition pour toute question ou demande supplémentaire.\nCordialement," },
    ],
  },
});

const REGLAGES_DEMO_TOURS = completerReglages({
  emetteur: { nom: "Excursions démo", adresse: "2 chemin de la Plage\n00000 Ville", telephone: "+00 00 000 00 01", contact: "Équipe démo\ncontact@exemple.com" },
  paiement: { texte: "Banque: Banque démo\nNuméro de compte: 000-0-00000-0\nTitulaire: Excursions démo" },
  devise: "THB",
  conditions: { acompte_pct: 0, delai_jours: 5, relance_jours: 7, tva_mention: "", cgv_url: "" },
  numerotation: { mode: "sequence", prefixe: "EX" },
  dossier: { modele_bandeau: "{PAYS} - {PERIODE}", libelle_pays: "Service" },
  listes: { pays: ["Excursion", "Transfert"] },
  libelles: LIBELLES_EN,
  textes: { variantes: [{ id: "standard", nom: "Standard", corps: "Payment is due on the day of the service.\nBank transfer or cash accepted.", cloture: "Thank you for your trust!" }] },
});

const REGLAGES_DEMO_TAXI = completerReglages({
  emetteur: { nom: "Taxi démo", adresse: "3 route de l'Aéroport\n00000 Ville", telephone: "+00 00 000 00 02", contact: "Taxi démo\ncontact@exemple.com" },
  paiement: { texte: "Paiement en espèces ou par virement." },
  devise: "THB",
  conditions: { acompte_pct: 0, delai_jours: 5, relance_jours: 7, tva_mention: "", cgv_url: "" },
  numerotation: { mode: "sequence", prefixe: "TX" },
  dossier: { modele_bandeau: "{PAYS} - {PERIODE}", libelle_pays: "Trajet" },
  listes: { pays: ["Aéroport", "Hôtel", "Excursion"] },
  libelles: LIBELLES_EN,
  textes: { variantes: [{ id: "standard", nom: "Standard", corps: "Payment on arrival.", cloture: "Thank you!" }] },
});

export function donneesDemo(ajd, ajouterJours) {
  const j = (n) => ajouterJours(ajd, n);
  const e1 = { id: uid(), created_at: j(-90), slug: "agence", nom: "Agence démo", actif: true, ordre: 1 };
  const e2 = { id: uid(), created_at: j(-90), slug: "excursions", nom: "Excursions démo", actif: true, ordre: 2 };
  const e3 = { id: uid(), created_at: j(-90), slug: "taxi", nom: "Taxi démo", actif: true, ordre: 3 };
  const admin = { user_id: uid(), email: "admin@demo.local", nom: "Administratrice démo", super_admin: true, actif: true };
  const assistante = { user_id: uid(), email: "assistante@demo.local", nom: "Assistante démo", super_admin: false, actif: true };
  const membres = [
    { user_id: assistante.user_id, entite_id: e2.id, role: "editeur" },
    { user_id: assistante.user_id, entite_id: e3.id, role: "editeur" },
  ];
  const reglages = { [e1.id]: REGLAGES_DEMO_AGENCE, [e2.id]: REGLAGES_DEMO_TOURS, [e3.id]: REGLAGES_DEMO_TAXI };

  const clients = [];
  const dossiers = [];
  const documents = [];
  const paiements = [];
  const catalogue = [];
  const client = (e, civilite, prenom, nom, adresse, tel) => {
    const c = { id: uid(), created_at: j(-30), entite_id: e.id, civilite, prenom, nom, adresse, telephone: tel, email: "", notes: "" };
    clients.push(c);
    return c;
  };
  const contenu = (bandeau, lignes, colonnes, extra = {}) => ({ ...CONTENU_DEFAUT(), bandeau, colonnes, lignes, variante: extra.variante || "", ...extra });
  const ligne = (libelle, montant) => nouvelleLigne("ligne", { libelle, montant });
  const bloc = (libelle, puces, unite, qte) => nouvelleLigne("bloc", { libelle, intro: "comprenant:", puces, unite, qte });
  const ajoute = (e, c, creeLe, pays, bandeau, extra, devis, facture, pais) => {
    const rg = reglages[e.id];
    const initiales = `${c.prenom[0]}${c.nom[0]}`;
    const ref = rg.numerotation.mode === "sequence" ? `${rg.numerotation.prefixe}-${creeLe.slice(0, 4)}-${String(dossiers.filter((d) => d.entite_id === e.id).length + 1).padStart(4, "0")}` : `${initiales}${creeLe.replaceAll("-", "")} ${pays}`;
    const d = { id: uid(), created_at: creeLe, entite_id: e.id, ref, client_id: c.id, pays, bandeau, date_depart: null, date_retour: null, accepte_le: null, annule: false, notes: "", ...extra };
    dossiers.push(d);
    if (devis) documents.push({ id: uid(), created_at: creeLe, updated_at: creeLe, entite_id: e.id, dossier_id: d.id, type: "devis", date_emission: creeLe, envoye_le: null, ...devis });
    if (facture) documents.push({ id: uid(), created_at: j(0), updated_at: j(0), entite_id: e.id, dossier_id: d.id, type: "facture", date_emission: ajd, envoye_le: null, ...facture });
    (pais || []).forEach((p) => paiements.push({ id: uid(), created_at: p.date, entite_id: e.id, dossier_id: d.id, type: "acompte", moyen: "virement", origine_montant: null, origine_devise: "", note: "", ...p }));
  };

  // Entreprise 1 : cinq dossiers à tous les statuts
  const c1 = client(e1, "Madame", "Hélène", "Marchand", "Rue du Lac 12\n1204 Genève, Suisse", "+41 79 000 00 01");
  const c2 = client(e1, "Monsieur", "Julien", "Rochat", "Chemin des Vignes 4\n1004 Lausanne, Suisse", "+41 79 000 00 02");
  const c3 = client(e1, "Madame", "Sophie", "Perrin", "12 rue des Fleurs\n74000 Annecy, FR", "+33 6 00 00 00 03");
  const c4 = client(e1, "Monsieur", "Marc", "Delaye", "Rue Centrale 8\n1700 Fribourg, Suisse", "+41 79 000 00 04");
  const regions = (l) => [bloc("Formule “par région”", ["création de l'itinéraire personnalisé", "sélection d'hébergements par région", "carnet de voyage personnalisé"]), ...l.map(([n, m]) => ligne(n, m))];
  const duo = (jours) => [bloc("Formule complète DUO", ["conception de l'itinéraire sur mesure", "sélection d'hébergements par ville", "carnet de voyage personnalisé"], 40, jours)];
  const b = (m) => `VOYAGE EN THAÏLANDE - ${m}`;
  ajoute(e1, c1, j(-1), "Thaïlande", b("DÉCEMBRE 2026"), {}, { contenu: contenu(b("DÉCEMBRE 2026"), regions([["Bangkok", 120], ["Chiang Mai", 120], ["Koh Lanta", 150]]), "total", { variante: "qr" }) });
  ajoute(e1, c2, j(-9), "Thaïlande", b("JANVIER 2027"), {}, { envoye_le: j(-9), contenu: contenu(b("JANVIER 2027"), duo(12), "detail", { variante: "qr" }) });
  ajoute(e1, c3, j(-20), "Thaïlande", b("FÉVRIER 2027"), { accepte_le: j(-14), date_depart: j(95) }, { envoye_le: j(-20), contenu: contenu(b("FÉVRIER 2027"), regions([["Bangkok", 120], ["Koh Lanta", 150]]), "total", { variante: "qr" }) });
  ajoute(e1, c4, j(-50), "Thaïlande", b("NOVEMBRE 2026"), { accepte_le: j(-45), date_depart: j(18), date_retour: j(32) }, { envoye_le: j(-50), contenu: contenu(b("NOVEMBRE 2026"), duo(14), "detail", { variante: "qr" }) }, { contenu: contenu(b("NOVEMBRE 2026"), duo(14), "detail", { variante: "qr" }) }, [{ date: j(-40), montant: 280 }]);
  ajoute(e1, c1, j(-80), "Thaïlande", b("SEPTEMBRE 2026"), { accepte_le: j(-75), date_depart: j(-20), date_retour: j(-6) }, { envoye_le: j(-80), contenu: contenu(b("SEPTEMBRE 2026"), regions([["Chiang Mai", 120], ["Koh Lanta", 150]]), "total", { variante: "qr" }) }, null, [{ date: j(-70), montant: 135 }, { date: j(-25), montant: 135, type: "solde" }]);
  [["formule", "Formule “par région”", null], ["formule", "Formule complète DUO", 40], ["region", "Bangkok", 120], ["region", "Chiang Mai", 120], ["region", "Koh Lanta", 150]].forEach(([kind, libelle, prix], i) => {
    catalogue.push({ id: uid(), created_at: j(-90), entite_id: e1.id, kind, libelle, intro: kind === "formule" ? "comprenant:" : "", puces: kind === "formule" ? ["création de l'itinéraire personnalisé", "carnet de voyage personnalisé"] : [], prix, ordre: i + 1, actif: true });
  });

  // Entreprise 2 : excursions, facturation directe en bahts
  const c5 = client(e2, "Monsieur", "Ben", "Walker", "Hotel Sunset, Room 12\nKoh Lanta", "+44 7000 000000");
  const c6 = client(e2, "Madame", "Anna", "Keller", "Hotel Palm, Bungalow 3\nKoh Lanta", "+49 160 0000000");
  ajoute(e2, c5, j(-6), "Excursion", "Excursion - 4 îles", { accepte_le: j(-6) }, null, { envoye_le: j(-6), contenu: contenu("Excursion - 4 îles", [nouvelleLigne("ligne", { libelle: "Tour des 4 îles, par personne", unite: 1200, qte: 2 })], "detail") });
  ajoute(e2, c6, j(-2), "Transfert", "Transfert aéroport", { accepte_le: j(-2) }, null, { contenu: contenu("Transfert aéroport", [ligne("Transfert Krabi aéroport, Koh Lanta", 1500)], "total") }, [{ date: j(-1), montant: 1500, type: "solde", moyen: "especes" }]);
  [["region", "Tour des 4 îles", 1200], ["region", "Transfert aéroport", 1500]].forEach(([kind, libelle, prix], i) => catalogue.push({ id: uid(), created_at: j(-90), entite_id: e2.id, kind, libelle, intro: "", puces: [], prix, ordre: i + 1, actif: true }));

  // Entreprise 3 : taxi
  const c7 = client(e3, "Madame", "Lea", "Moreau", "Hotel Sea, Koh Lanta", "+33 6 00 00 00 07");
  ajoute(e3, c7, j(-1), "Aéroport", "Trajet aéroport", { accepte_le: j(-1) }, null, { contenu: contenu("Trajet aéroport", [ligne("Taxi Krabi aéroport, Koh Lanta", 1800)], "total") });
  catalogue.push({ id: uid(), created_at: j(-90), entite_id: e3.id, kind: "region", libelle: "Taxi Krabi aéroport, Koh Lanta", intro: "", puces: [], prix: 1800, ordre: 1, actif: true });

  return { entites: [e1, e2, e3], profils: [admin, assistante], membres, reglages, clients, dossiers, documents, paiements, catalogue };
}
