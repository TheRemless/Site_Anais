// Valeurs de départ, textes types et données de démonstration.
// Les vraies coordonnées (téléphone, e-mail, banque) ne sont pas dans ce fichier car il est servi publiquement :
// elles viennent de la table « reglages » (voir docs/gestion/schema.sql).

export const uid = () => crypto.randomUUID();

// Catalogue des droits : chaque rôle est un ensemble de ces codes. Le même catalogue sert à la base (schema.sql)
// et à l'écran des rôles, pour qu'ils ne puissent pas diverger.
export const PERMISSIONS = [
  { code: "clients.lire", groupe: "Clients", libelle: "Voir les clients" },
  { code: "clients.ecrire", groupe: "Clients", libelle: "Créer et modifier les clients" },
  { code: "clients.supprimer", groupe: "Clients", libelle: "Supprimer un client" },
  { code: "dossiers.lire", groupe: "Dossiers", libelle: "Voir les dossiers" },
  { code: "dossiers.ecrire", groupe: "Dossiers", libelle: "Créer et modifier les dossiers" },
  { code: "dossiers.supprimer", groupe: "Dossiers", libelle: "Supprimer un dossier" },
  { code: "documents.ecrire", groupe: "Devis et factures", libelle: "Créer et modifier les devis et factures" },
  { code: "documents.supprimer", groupe: "Devis et factures", libelle: "Supprimer un devis ou une facture" },
  { code: "finances.voir", groupe: "Finances", libelle: "Voir les montants : devis, factures et paiements", aide: "Sans ce droit, la personne voit les clients et les dossiers mais aucun chiffre." },
  { code: "paiements.ecrire", groupe: "Finances", libelle: "Enregistrer et corriger les paiements" },
  { code: "taches.ecrire", groupe: "Tâches", libelle: "Créer et modifier les tâches et rappels", aide: "Chacun peut toujours cocher comme faites les tâches qui lui sont confiées." },
  { code: "catalogue.ecrire", groupe: "Catalogue", libelle: "Modifier le catalogue de formules et de prix" },
  { code: "partenaires.lire", groupe: "Partenaires", libelle: "Voir les partenaires, leurs tarifs et leurs trajets" },
  { code: "partenaires.ecrire", groupe: "Partenaires", libelle: "Modifier les partenaires, les tarifs et les trajets" },
  { code: "partenaires.nets", groupe: "Partenaires", libelle: "Voir les prix nets, les marges et les coordonnées bancaires des partenaires", aide: "Sans ce droit, la personne voit les prix de vente mais ni les nets ni les marges." },
  { code: "reglages.ecrire", groupe: "Administration", libelle: "Modifier les réglages de l'entreprise (coordonnées bancaires comprises)" },
  { code: "exports.faire", groupe: "Administration", libelle: "Exporter et sauvegarder les données" },
  { code: "analytics.voir", groupe: "Administration", libelle: "Voir le tableau analytique" },
  { code: "journal.voir", groupe: "Administration", libelle: "Voir le journal d'activité" },
];
export const TOUTES_PERMISSIONS = PERMISSIONS.map((p) => p.code);

// Un droit en suppose d'autres : on ne peut pas modifier ce qu'on ne peut pas voir.
export const DEPENDANCES = {
  "clients.ecrire": ["clients.lire"],
  "clients.supprimer": ["clients.lire"],
  "dossiers.ecrire": ["dossiers.lire", "clients.lire"],
  "dossiers.supprimer": ["dossiers.lire"],
  "documents.ecrire": ["dossiers.lire", "finances.voir"],
  "documents.supprimer": ["dossiers.lire", "finances.voir"],
  "paiements.ecrire": ["dossiers.lire", "finances.voir"],
  "analytics.voir": ["finances.voir"],
  "taches.ecrire": ["dossiers.lire"],
  "partenaires.ecrire": ["partenaires.lire"],
  "partenaires.nets": ["partenaires.lire"],
};

// Rôles créés avec chaque entreprise. Ils se modifient ensuite librement dans l'écran Administration.
export const ROLES_SYSTEME = [
  { nom: "Administrateur", description: "Tous les droits dans l'entreprise.", portee: "toute", permissions: TOUTES_PERMISSIONS },
  { nom: "Éditeur", description: "Clients, dossiers, devis, factures et paiements. Ni réglages ni suppression.", portee: "toute", permissions: ["clients.lire", "clients.ecrire", "dossiers.lire", "dossiers.ecrire", "documents.ecrire", "finances.voir", "paiements.ecrire", "taches.ecrire", "catalogue.ecrire", "partenaires.lire", "partenaires.ecrire"] },
  { nom: "Lecteur", description: "Consultation seulement, montants visibles.", portee: "toute", permissions: ["clients.lire", "dossiers.lire", "finances.voir", "analytics.voir", "partenaires.lire"] },
];

export const LIBELLES_FR = {
  devis: "DEVIS",
  facture: "FACTURE",
  facture_locale: "",
  ref_devis: "Devis: réf.",
  ref_facture: "Facture: réf.",
  date_emission: "Date d'émission:",
  unite: "UNITÉ",
  qte: "QTÉ",
  total: "TOTAL",
  colonne_montant: "",
  total_final: "",
  sous_total: "SOUS-TOTAL",
  remise: "Remise",
  montant_recu: "Montant reçu",
  equivalent: "Équivalent indicatif :",
  conditions: "CONDITIONS DE PAIEMENT",
  signature_1: "NOM, PRENOM, DATE ET SIGNATURE DU CLIENT",
  signature_2: "précédé de la mention “Bon pour accord”",
  coordonnees: "COORDONNÉES",
  infos_paiement: "INFORMATIONS DE PAIEMENT",
  pied_court: "voir les instructions de paiement transmises par e-mail.",
  qr_titre: "",
  facture_a: "",
  prestataire: "Prestataire :",
  note_devise: "",
  pied_note: "",
  cgv: "Le client reconnaît avoir pris connaissance des [Conditions Générales de Vente]({cgv_url}) de {entreprise} et les accepter sans réserve. La signature du présent devis vaut acceptation des CGV et engagement contractuel.",
};

export const LIBELLES_EN = {
  devis: "QUOTE",
  facture: "INVOICE",
  facture_locale: "",
  ref_devis: "Quote: ref.",
  ref_facture: "Invoice: ref.",
  date_emission: "Date of issue:",
  unite: "UNIT",
  qte: "QTY",
  total: "TOTAL",
  colonne_montant: "",
  total_final: "",
  sous_total: "SUBTOTAL",
  remise: "Discount",
  montant_recu: "Amount received",
  equivalent: "Indicative equivalent:",
  conditions: "PAYMENT TERMS",
  signature_1: "FULL NAME, DATE AND SIGNATURE OF THE CLIENT",
  signature_2: "preceded by the words “Approved”",
  coordonnees: "CONTACT",
  infos_paiement: "PAYMENT DETAILS",
  pied_court: "see the payment instructions sent by e-mail.",
  qr_titre: "",
  facture_a: "",
  prestataire: "Service provider:",
  note_devise: "",
  pied_note: "",
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

// Messages types proposés au départ, modifiables dans l'écran Messages. Variables : {client}, {prenom}, {date}, {hotel},
// {heure}, {a_heure} (« à 08:00 », vide sans heure), {personnes}, {prestation}, {partenaire}, {reference}, {entreprise}, {telephone}.
// Les textes thaïs sont des propositions à faire relire par une personne qui lit le thaï avant usage réel.
export const MESSAGES_DEFAUT = [
  { id: "confirmation-fr", cle: "confirmation", titre: "Confirmation au client", langue: "fr", corps: "Bonjour {prenom},\n\nVotre réservation est confirmée :\n• {prestation}\n• Date : {date}\n• {personnes}\n• Prise en charge : {hotel}{a_heure}\n\nMerci de votre confiance, à très vite !\n{entreprise}\n{telephone}" },
  { id: "confirmation-en", cle: "confirmation", titre: "Confirmation to the client", langue: "en", corps: "Hello {prenom},\n\nYour booking is confirmed:\n• {prestation}\n• Date: {date}\n• {personnes}\n• Pickup: {hotel}{a_heure}\n\nThank you for your trust, see you soon!\n{entreprise}\n{telephone}" },
  { id: "rappel-fr", cle: "rappel", titre: "Rappel de la veille", langue: "fr", corps: "Bonjour {prenom},\n\nPetit rappel pour demain : {prestation}.\nPrise en charge à {heure} à {hotel}. Merci d'être prêt·e quelques minutes avant.\nPensez à l'eau, la crème solaire et les espèces pour les frais de parc.\n\nBonne journée,\n{entreprise}" },
  { id: "rappel-en", cle: "rappel", titre: "Reminder for tomorrow", langue: "en", corps: "Hello {prenom},\n\nA quick reminder for tomorrow: {prestation}.\nPickup at {heure} at {hotel}. Please be ready a few minutes early.\nBring water, sunscreen and cash for the national park fees.\n\nHave a great day,\n{entreprise}" },
  { id: "avis-fr", cle: "avis", titre: "Demande d'avis après le voyage", langue: "fr", corps: "Bonjour {prenom},\n\nNous espérons que vous avez aimé {prestation}. Un petit avis en ligne nous aiderait énormément, merci d'avance !\n\nÀ bientôt à Koh Lanta,\n{entreprise}" },
  { id: "avis-en", cle: "avis", titre: "Review request after the trip", langue: "en", corps: "Hello {prenom},\n\nWe hope you enjoyed {prestation}. A short online review would help us a lot, thank you in advance!\n\nSee you again in Koh Lanta,\n{entreprise}" },
  { id: "meteo-fr", cle: "meteo", titre: "Météo, report ou annulation", langue: "fr", corps: "Bonjour {prenom},\n\nLa météo de {date} ne permet pas de maintenir {prestation} en toute sécurité. Nous vous proposons de reporter à une autre date ou de vous rembourser intégralement. Dites-nous ce que vous préférez.\n\n{entreprise}" },
  { id: "meteo-en", cle: "meteo", titre: "Weather, postponement or cancellation", langue: "en", corps: "Hello {prenom},\n\nThe weather on {date} does not allow us to run {prestation} safely. We can move it to another date or refund you in full. Let us know what you prefer.\n\n{entreprise}" },
  { id: "partenaire-en", cle: "partenaire", titre: "Booking request to the partner", langue: "en", corps: "Hello {partenaire},\n\nBooking request from {entreprise}:\n• {prestation}\n• Date: {date}\n• {personnes}\n• Pickup: {hotel}{a_heure}\n• Client: {client}\n• Our ref: {reference}\n\nPlease confirm. Thank you!" },
  { id: "partenaire-th", cle: "partenaire", titre: "ขอจองกับพาร์ทเนอร์ (à relire)", langue: "th", corps: "สวัสดีค่ะ {partenaire}\n\nขอจองจาก {entreprise}:\n• {prestation}\n• วันที่ {date}\n• {personnes}\n• รับที่ {hotel}{a_heure}\n• ลูกค้า: {client}\n• อ้างอิง: {reference}\n\nรบกวนยืนยันด้วยนะคะ ขอบคุณค่ะ" },
  { id: "rappel-th", cle: "rappel", titre: "เตือนก่อนวันเดินทาง (à relire)", langue: "th", corps: "สวัสดีค่ะ {prenom}\n\nขอเตือนสำหรับพรุ่งนี้: {prestation}\nรถรับเวลา {heure} ที่ {hotel} กรุณาเตรียมตัวล่วงหน้าเล็กน้อยนะคะ\n\nขอบคุณค่ะ\n{entreprise}" },
];

// Réglages d'une entreprise nouvellement créée : aucun fait propre à une entreprise réelle.
export const REGLAGES_NEUTRE = {
  messages: MESSAGES_DEFAUT,
  // Écrans propres à l'entreprise : null = automatique (Partenaires dès qu'il y a un partenaire, Réservations et Messages
  // avec Partenaires, Catalogue toujours), true = affiché, false = masqué.
  modules: { partenaires: null, reservations: null, messages: null, catalogue: null },
  // « sur_mesure » : voyages sur mesure avec devis, acompte et facture (Zwald). « excursions » : excursions et transferts
  // facturés directement, puis vouchers pour le client et le prestataire (Secret Travel & Tour).
  fonctionnement: "sur_mesure",
  // Vouchers (mode excursions) : en-tête et textes fixes, en anglais.
  voucher: { licence: "", email: "", merci: "Thank you for booking with {entreprise}!\nWe wish you a wonderful day.", note_transfert: "Your driver will be waiting for you at the meeting point.\nIf your plan changes, please let us know as soon as possible." },
  emetteur: { nom: "", sous_titre: "", adresse: "", telephone: "", contact: "" },
  paiement: { texte: "", nom: "", autres: [] },
  devise: "",
  conditions: { acompte_pct: 0, delai_jours: 10, relance_jours: 7, tva_mention: "", tva_mention_en: "", cgv_url: "" },
  taux: { eur: 1.058, thb: 40.54 },
  numerotation: { mode: "sequence", prefixe: "", chiffres: 4 },
  dossier: { modele_bandeau: "{PAYS} - {PERIODE}", libelle_pays: "Pays" },
  listes: { pays: [], civilites: ["Madame", "Monsieur", "Mademoiselle"], moyens: MOYENS_DEFAUT, devises: ["CHF", "EUR", "THB", "USD"] },
  apparence: { couleur: "#0b9999", couleur_clair: "#53b7b7", entete: "classique", logo: "", titre_image: "", type_images: null, titre_texte: "", qr_image: "", qr_pseudo: "" },
  libelles: LIBELLES_FR,
  libelles_en: LIBELLES_EN,
  textes: { variantes: [{ id: "standard", nom: "Standard", corps: "", cloture: "" }] },
};

// Informations de paiement proposées pour un document : celles de l'entreprise (avec le QR code des réglages), puis les autres.
export function modesPaiement(r) {
  const principal = { id: "", nom: r.paiement.nom || "Principal", texte: r.paiement.texte, qr_image: r.apparence.qr_image, qr_pseudo: r.apparence.qr_pseudo };
  const autres = (r.paiement.autres || []).map((m) => ({ id: m.id, nom: m.nom || "Sans nom", texte: m.texte || "", qr_image: m.qr_image || "", qr_pseudo: m.qr_pseudo || "" }));
  return [principal, ...autres];
}
export const modePaiement = (r, id) => modesPaiement(r).find((m) => m.id === (id || "")) || modesPaiement(r)[0];

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
  langue: "",
  prestataire: "",
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
  fonctionnement: "excursions",
  voucher: { licence: "11/00000", email: "contact@exemple.com" },
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
  const stagiaire = { user_id: uid(), email: "stagiaire@demo.local", nom: "Stagiaire démo", super_admin: false, actif: true };
  const comptable = { user_id: uid(), email: "comptable@demo.local", nom: "Comptable démo", super_admin: false, actif: true };
  const roles = [];
  const roleDe = {};
  for (const e of [e1, e2, e3]) {
    for (const r of ROLES_SYSTEME) {
      const ro = { id: uid(), created_at: j(-90), entite_id: e.id, nom: r.nom, description: r.description, portee: r.portee, permissions: [...r.permissions], systeme: true };
      roles.push(ro);
      roleDe[`${e.id}:${r.nom}`] = ro.id;
    }
  }
  const rSans = { id: uid(), created_at: j(-30), entite_id: e3.id, nom: "Sans chiffres", description: "Voit les clients et les dossiers, jamais les montants.", portee: "toute", permissions: ["clients.lire", "dossiers.lire"], systeme: false };
  const rSes = { id: uid(), created_at: j(-30), entite_id: e2.id, nom: "Ses dossiers", description: "Travaille uniquement sur les dossiers dont elle est responsable.", portee: "mes_dossiers", permissions: ["clients.lire", "clients.ecrire", "dossiers.lire", "dossiers.ecrire", "documents.ecrire", "finances.voir", "paiements.ecrire"], systeme: false };
  roles.push(rSans, rSes);
  const membres = [
    { user_id: assistante.user_id, entite_id: e2.id, role_id: roleDe[`${e2.id}:Éditeur`] },
    { user_id: assistante.user_id, entite_id: e3.id, role_id: roleDe[`${e3.id}:Éditeur`] },
    { user_id: stagiaire.user_id, entite_id: e2.id, role_id: rSes.id },
    { user_id: comptable.user_id, entite_id: e3.id, role_id: rSans.id },
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
  ajoute(e2, c5, j(-6), "Excursion", "Excursion - 4 îles", { accepte_le: j(-6), responsable_id: assistante.user_id }, null, { envoye_le: j(-6), contenu: contenu("Excursion - 4 îles", [nouvelleLigne("ligne", { libelle: "Tour des 4 îles, par personne", unite: 1200, qte: 2 })], "detail") });
  ajoute(e2, c6, j(-2), "Transfert", "Transfert aéroport", { accepte_le: j(-2), responsable_id: stagiaire.user_id }, null, { contenu: contenu("Transfert aéroport", [ligne("Transfert Krabi aéroport, Koh Lanta", 1500)], "total") }, [{ date: j(-1), montant: 1500, type: "solde", moyen: "especes" }]);
  [["region", "Tour des 4 îles", 1200], ["region", "Transfert aéroport", 1500]].forEach(([kind, libelle, prix], i) => catalogue.push({ id: uid(), created_at: j(-90), entite_id: e2.id, kind, libelle, intro: "", puces: [], prix, ordre: i + 1, actif: true }));

  // Entreprise 3 : taxi
  const c7 = client(e3, "Madame", "Lea", "Moreau", "Hotel Sea, Koh Lanta", "+33 6 00 00 00 07");
  ajoute(e3, c7, j(-1), "Aéroport", "Trajet aéroport", { accepte_le: j(-1), responsable_id: assistante.user_id }, null, { contenu: contenu("Trajet aéroport", [ligne("Taxi Krabi aéroport, Koh Lanta", 1800)], "total") });
  catalogue.push({ id: uid(), created_at: j(-90), entite_id: e3.id, kind: "region", libelle: "Taxi Krabi aéroport, Koh Lanta", intro: "", puces: [], prix: 1800, ordre: 1, actif: true });

  // Entreprise 2 : quatre partenaires fictifs avec leurs tarifs, leurs nets et les trajets de deux compagnies de bateaux.
  const partenaires = [];
  const partenaires_prives = [];
  const prestations = [];
  const prestations_nets = [];
  const trajets = [];
  const trajets_nets = [];
  const partenaire = (nom, categorie, groupe, role, extra = {}) => {
    const p = { id: uid(), created_at: j(-90), updated_at: j(-90), entite_id: e2.id, nom, nom_thai: "", categorie, groupe, role, contact: {}, regles: {}, contrat: {}, notes: "", ordre: partenaires.length + 1, actif: true, ...extra };
    partenaires.push(p);
    return p;
  };
  const prestation = (p, famille, groupe, libelle, prix, unite, net, details = {}, extra = {}) => {
    const x = { id: uid(), created_at: j(-90), updated_at: j(-90), entite_id: e2.id, partenaire_id: p ? p.id : null, famille, groupe, libelle, libelle_en: "", details, prix_vente: prix, unite, sur_place: false, ordre: prestations.length + 1, actif: true, ...extra };
    prestations.push(x);
    if (net != null) prestations_nets.push({ id: uid(), entite_id: e2.id, prestation_id: x.id, net, net_enfant: null, note: "" });
    return x;
  };
  const trajet = (p, de, vers, mode, depart, arrivee, duree, ad, adn, ch, chn, fenetres = [], periode = "Toute la période du contrat") => {
    const t = { id: uid(), created_at: j(-90), entite_id: e2.id, partenaire_id: p.id, numero: trajets.length + 1, de, vers, mode, depart, arrivee, duree, prix_adulte: ad, prix_enfant: ch, bebe: "Gratuit", periode, fenetres, actif: true };
    trajets.push(t);
    trajets_nets.push({ id: uid(), entite_id: e2.id, trajet_id: t.id, net_adulte: adn, net_enfant: chn });
    return t;
  };
  const longtail = partenaire("Longtail démo", "Excursions bateaux", "mer", "Excursions en longtail, 4 îles et Koh Rok (groupe et privé)", {
    contact: { personne: "M. Démo", telephones: [{ numero: "081-000-0001", libelle: "Réservations", whatsapp: true }], emails: ["longtail@demo.local"], adresse: "66 Moo 2, Koh Lanta", embarcadere: "Old Town Pier", guichets: [] },
    regles: { annulation: "Plus de 24 h avant le départ, sans frais. Ensuite 100 %.", enfants: ["3 à 9 ans, tarif enfant. Moins de 3 ans gratuit."], commissions: ["Net fixe par personne, frais de parc jamais inclus."] },
    contrat: { statut: "Tarifs nets confirmés", etat: "ok", saison: "Octobre 2026 à mai 2027", validite: "Oct 2026 – Mai 2027", fin: j(45), documents: ["Contrat Longtail démo.pdf"], evenements: [] },
    notes: "Petit-déjeuner léger offert sur les tours en groupe.",
  });
  partenaires_prives.push({ id: uid(), entite_id: e2.id, partenaire_id: longtail.id, banque: { banque: "Banque démo", compte: "000-0-00000-0", titulaire: "Longtail démo" }, paiement: "Virement local après chaque tour." });
  const speed = partenaire("Speedboat démo", "Ferries et speedboats", "mer", "Liaisons en speedboat entre Lanta, Phi Phi, Lipe et Phuket", {
    contact: { personne: "Équipe réservations", telephones: [{ numero: "088-000-0002", libelle: "", whatsapp: true }], emails: ["info@speedboat.demo"], guichets: [{ lieu: "Saladan Pier", adresse: "Koh Lanta", telephones: ["075-000-000"], line: "", email: "" }] },
    regles: { annulation: "Plus de 24 h avant, sans frais. No show 100 %.", enfants: ["3 à 9 ans, tarif enfant. Moins de 3 ans gratuit sur les genoux."], checkin: ["Ouverture 45 min avant le départ, fermeture 15 min avant."], points_embarquement: [{ lieu: "Koh Lanta", ou: "Saladan Pier" }, { lieu: "Koh Phi Phi", ou: "Tonsai Bay, derrière le 7-11" }], pickups: [{ titre: "Pickup à Lanta", colonnes: ["Bateau 10h30", "Bateau 13h00"], lignes: [["Klong Dao", "09:40", "12:10"], ["Long Beach", "09:30", "12:00"], ["Old Town", "09:00", "11:30"]] }] },
    contrat: { statut: "Tarifs agents reçus", etat: "ok", saison: "Haute saison 2026-2027", validite: "15 oct 2026 – 20 mai 2027", fin: "2027-05-20", documents: [], evenements: [{ date: "15 oct 2026", libelle: "Début de la haute saison", genre: "debut" }] },
  });
  const ferry = partenaire("Ferry démo", "Ferries et speedboats", "mer", "Ferry lent entre Lanta et Phi Phi", { contact: { telephones: [{ numero: "089-000-0003", libelle: "", whatsapp: false }] }, contrat: { statut: "Sans contrat, tarifs publics", etat: "attention", fin: null } });
  const taxi = partenaire("Transferts démo", "Transferts terrestres et taxis", "transport", "Minivans privés depuis et vers les aéroports", { contact: { telephones: [{ numero: "083-000-0004", libelle: "", whatsapp: true }] }, regles: { commissions: ["Marge de 10 % en attendant un accord."] }, contrat: { statut: "Accord oral", etat: "attention", fin: j(-5) } });
  prestation(longtail, "excursion", "Excursions en groupe", "4 îles en longtail, journée", 1200, "pp", 800, { horaires: "08h00 - 15h30 (départ 09h00)", inclus: "Pickup à l'hôtel, déjeuner, masque et tuba, fruits.", parc: "Frais de parc 200 ฿ par adulte, à payer sur place.", conditions: "Selon la météo." });
  prestation(longtail, "excursion", "Excursions en groupe", "4 îles en longtail, enfant 3 à 9 ans", 900, "ch", 600, {});
  prestation(longtail, "excursion", "Privatisation", "Koh Rok en longtail privé, 1 à 6 personnes", 6500, "boat", 5000, { capacite: "1 à 6 personnes", inclus: "Bateau, skipper, déjeuner, matériel de snorkeling." });
  prestation(null, "frais", "Frais de parc national", "Koh Rok et Koh Ha", 400, "ad", null, { enfant: 200, thai_adulte: 40, thai_enfant: 20, note: "À payer en espèces au garde sur l'île." }, { sur_place: true });
  prestation(null, "frais", "Frais de parc national", "4 îles", 200, "ad", null, { enfant: 100, note: "À payer en espèces sur place." }, { sur_place: true });
  prestation(taxi, "transfert", "Minivan privé", "Aéroport de Krabi → Koh Lanta", 2500, "veh", 2250, { note: "Jusqu'à 9 personnes, bagages compris." });
  prestation(taxi, "transfert", "Minivan privé", "Koh Lanta → Aéroport de Phuket", 4500, "veh", 4050, {});
  prestation(taxi, "transfert", "Taxi local", "Saladan → Klong Dao", 80, "pp", null, { note: "Grille de l'association des taxis." });
  prestation(longtail, "activite", "Sortie coucher de soleil", "Coucher de soleil en longtail, 2 h", 700, "pp", 500, { duree: "17h00 - 19h00" });
  trajet(speed, "Koh Lanta", "Koh Phi Phi", "Speedboat", "10:30", "11:30", "1 h", 900, 700, 700, 500);
  trajet(speed, "Koh Lanta", "Koh Phi Phi", "Speedboat", "13:00", "14:00", "1 h", 900, 700, 700, 500);
  trajet(speed, "Koh Phi Phi", "Koh Lanta", "Speedboat", "15:00", "16:00", "1 h", 900, 700, 700, 500);
  trajet(speed, "Koh Lanta", "Koh Lipe", "Speedboat", "10:30", "13:30", "3 h", 1900, 1500, 1500, 1200, [[j(10), j(190)]], "Haute saison seulement");
  trajet(speed, "Koh Lanta", "Phuket", "Speedboat", "10:30", "13:00", "2 h 30", 1700, 1300, 1300, 1000);
  trajet(ferry, "Koh Lanta", "Koh Phi Phi", "Ferry", "11:00", "12:30", "1 h 30", 800, 650, 600, 500);
  trajet(ferry, "Koh Phi Phi", "Koh Lanta", "Ferry", "14:30", "16:00", "1 h 30", 800, 650, 600, 500);

  // Réservations auprès des partenaires pour les dossiers de l'entreprise 2.
  const reservations = [];
  const reservations_nets = [];
  const reservation = (dossier, x, libelle, date, extra, nets) => {
    const r = { id: uid(), created_at: j(-2), updated_at: j(-2), entite_id: e2.id, dossier_id: dossier.id, ligne_id: "", prestation_id: x ? x.id : null, trajet_id: null, partenaire_id: x ? x.partenaire_id : null, libelle, date_service: date, heure_pickup: "", lieu_pickup: "", personnes: { adultes: 2, enfants: 0, bebes: 0 }, statut: "a_demander", reference_partenaire: "", montant_vente: null, notes: "", cree_par: admin.user_id, ...extra };
    reservations.push(r);
    if (nets) reservations_nets.push({ id: uid(), entite_id: e2.id, reservation_id: r.id, net_prevu: null, net_paye: null, paye_le: null, ...nets });
    return r;
  };
  reservation(dossiers[5], prestations[0], "4 îles en longtail, journée", j(1), { heure_pickup: "08:00", lieu_pickup: "Hotel Sunset, Klong Dao", statut: "confirme", reference_partenaire: "LT-2211", montant_vente: 2400 }, { net_prevu: 1600 });
  reservation(dossiers[5], prestations[3], "Koh Rok et Koh Ha, frais de parc", j(1), { statut: "confirme", personnes: { adultes: 2, enfants: 0, bebes: 0 }, notes: "À payer en espèces sur l'île." }, null);
  reservation(dossiers[6], prestations[5], "Aéroport de Krabi → Koh Lanta", j(0), { heure_pickup: "14:30", lieu_pickup: "Aéroport de Krabi, vol FD3217", statut: "demande", montant_vente: 2500, personnes: { adultes: 1, enfants: 1, bebes: 0 } }, { net_prevu: 2250 });
  reservation(dossiers[5], prestations[8], "Coucher de soleil en longtail, 2 h", j(3), { montant_vente: 1400 }, { net_prevu: 1000 });
  reservation(dossiers[6], prestations[6], "Koh Lanta → Aéroport de Phuket", j(-20), { statut: "confirme", heure_pickup: "06:00", lieu_pickup: "Hotel Palm", montant_vente: 4500 }, { net_prevu: 4050, net_paye: 4050, paye_le: j(-15) });

  const tache = (e, titre, jours, assignee, dossier, extra = {}) => ({ id: uid(), created_at: j(-3), entite_id: e.id, dossier_id: dossier ? dossier.id : null, partenaire_id: null, titre, description: "", echeance: jours === null ? null : j(jours), assignee_id: assignee ? assignee.user_id : null, fait: false, fait_le: null, fait_par: null, cree_par: admin.user_id, ...extra });
  const taches = [
    tache(e1, "Relancer Julien Rochat pour son devis", 0, admin, dossiers[1]),
    tache(e1, "Envoyer le carnet de voyage de Marc Delaye", 6, admin, dossiers[3]),
    tache(e1, "Mettre à jour les prix de la haute saison", null, null, null),
    tache(e2, "Confirmer l'heure de prise en charge", 1, assistante, dossiers[5]),
    tache(e2, "Envoyer la facture du transfert", -1, stagiaire, dossiers[6]),
    tache(e2, "[À vérifier] Obtenir le contrat signé de Longtail démo", null, null, null, { partenaire_id: longtail.id, description: "Le contrat du dossier n'est pas contresigné." }),
    tache(e3, "Vérifier le planning de la semaine", 2, assistante, null),
  ];
  return { entites: [e1, e2, e3], profils: [admin, assistante, stagiaire, comptable], roles, membres, reglages, clients, dossiers, documents, paiements, catalogue, taches, partenaires, partenaires_prives, prestations, prestations_nets, trajets, trajets_nets, reservations, reservations_nets, pieces: [], fichiers: {}, journal: [] };
}
