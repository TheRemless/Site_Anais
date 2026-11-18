// Modèles métier (étape 3 du SaaS, 17.11.2026) : les réglages de départ d'une entreprise créée par un client du logiciel.
// Chaque modèle choisit une façon de travailler (reglages.fonctionnement) et lui donne des textes neutres, en anglais :
// aucun nom, lieu, chiffre ni moyen de paiement propre aux entreprises d'Anaïs (Koh Lanta, VIP Taxi Lanta, Mr. Brown, TWINT, PostFinance, Wise 3 %).
// Le client complète ensuite seul ses réglages (coordonnées, paiement, conditions, logo) après l'appel de mise en route.
// Les entreprises existantes ne passent jamais par ici : leurs réglages restent ceux de la base.

import { N_ } from "./i18n.mjs";
import { LIBELLES_EN, MESSAGES_DEFAUT, MOYENS_DEFAUT, ROLES_SYSTEME, completerReglages } from "./defauts.mjs";

export const MODELES = [
  {
    id: "travel_planner",
    fonctionnement: "sur_mesure",
    nom: N_("Voyages sur mesure"),
    description: N_("Devis, acompte, facture et carnet de voyage. Catalogue de formules et de prix."),
  },
  {
    id: "tour_agency",
    fonctionnement: "excursions",
    nom: N_("Excursions et activités"),
    description: N_("Facture directe sans devis, prestataires avec leurs prix nets, réservations et vouchers."),
  },
  {
    id: "transfers",
    fonctionnement: "taxi",
    nom: N_("Transferts et taxi"),
    description: N_("Booking confirmation sans facture, le client paie le chauffeur, commissions des chauffeurs."),
  },
];
export const MODELE_DEFAUT = "travel_planner";
export const modele = (id) => MODELES.find((m) => m.id === id) || MODELES.find((m) => m.id === MODELE_DEFAUT);
// Le modèle qui correspond à une façon de travailler déjà enregistrée (pour l'afficher dans Réglages).
export const modeleDuFonctionnement = (fonctionnement) => MODELES.find((m) => m.fonctionnement === fonctionnement) || modele(MODELE_DEFAUT);

export const DEVISES_PROPOSEES = ["USD", "EUR", "CHF", "GBP", "THB", "AUD", "CAD", "SGD", "IDR", "VND", "JPY", "MXN", "ZAR"];

// Messages anglais des modèles : les textes types sans les phrases propres à Koh Lanta (avis, frais de parc national).
const NEUTRE = {
  "rappel-en": "Hello {prenom},\n\nA quick reminder for tomorrow: {prestation}.\nPickup at {heure} from {hotel}. Please be ready a few minutes early, with your voucher on your phone.\n\nHave a great day,\n{entreprise}",
  "avis-en": "Hello {prenom},\n\nWe hope you enjoyed {prestation}! If you have two minutes, a Google review would help us a lot:\n{lien_avis}\nThank you in advance.\n\nHope to see you again,\n{entreprise}",
};
const messagesAnglais = (garder) => MESSAGES_DEFAUT.filter((m) => m.langue === "en" && garder(m)).map((m) => (NEUTRE[m.id] ? { ...m, corps: NEUTRE[m.id] } : { ...m }));

// Transferts : confirmation et avis du lendemain réécrits sans la marque d'Anaïs, messages au chauffeur repris du mode taxi en anglais.
const MESSAGES_TRANSFERTS = [
  { id: "taxi-confirmation-en", pour: "client", cle: "confirmation", titre: "Booking confirmation sent", langue: "en", corps: "Thank you for choosing {entreprise}.\n\nPlease see the attached confirmation and show it to the driver at pick-up.\nLet us know if everything is correct.\n\nPayment will be collected directly by the driver.\n\nIf you have any changes, please inform us as soon as possible.\n\nHave a nice day,\n{entreprise}" },
  { id: "taxi-avis-en", pour: "client", cle: "avis", titre: "Review request the day after", langue: "en", corps: "Thank you again for choosing {entreprise} today.\n\nWe hope you had a comfortable journey. If you were satisfied with our service, a Google review would help us a lot:\n{lien_avis}\n\nThank you for your trust, and safe travels!\n{entreprise}" },
  { id: "taxi-partenaire-en", pour: "partenaire", cle: "partenaire", titre: "New transfer", langue: "en", corps: "Hello {contact},\n\nNew transfer:\n• {prestation}\n• Date: {date}\n• Pickup: {hotel}{a_heure}\n• Drop-off: {dropoff}\n• {personnes}\n• Guest: {client}\n• Price: {prix}, paid to the driver\n• Ref: {reference}\n\nCan you confirm? Thank you" },
  { id: "taxi-annulation-en", pour: "partenaire", cle: "annulation", titre: "Cancellation", langue: "en", corps: "Hello {contact},\n\nPlease cancel transfer {reference}: {prestation} on {date}, guest {client}.\nSorry for the change, thank you" },
  { id: "taxi-commission-en", pour: "partenaire", cle: "commission", titre: "Commission for yesterday's transfer", langue: "en", corps: "Hello {contact},\n\nAbout yesterday's transfer: {prestation} on {date}, guest {client} ({prix}).\nHow much is the commission for this one?\n\nThank you" },
  { id: "taxi-commissions-en", pour: "partenaire", cle: "commissions", titre: "Commissions for the last transfers", langue: "en", corps: "Hello {contact},\n\nCould you tell me the commission for these transfers?\n{courses}\n\nThank you" },
];

// Sans TWINT ni PostFinance (suisses, propres à ZTP). Espèces d'abord quand le client paie sur place.
const moyens = (ids) => ids.map((id) => MOYENS_DEFAUT.find((m) => m.id === id));
const CIVILITES_EN = ["Mrs", "Mr", "Ms"];
const APPARENCE_NEUTRE = { couleur: "#2f4858", couleur_clair: "#8aa1b1" };

// Réglages bruts d'une nouvelle entreprise (completerReglages les complète ensuite avec les valeurs neutres).
export function reglagesModele(id, { nom = "", devise = "" } = {}) {
  const r = reglagesBruts(id, { nom, devise });
  // Les devises proposées dans un document : celle du client d'abord (la liste par défaut est celle de ZTP : CHF, EUR, THB, USD).
  if (devise) r.listes.devises = [...new Set([devise, "USD", "EUR"])];
  return r;
}

function reglagesBruts(id, { nom, devise }) {
  const m = modele(id);
  const commun = {
    fonctionnement: m.fonctionnement,
    emetteur: { nom },
    devise: devise || "",
    libelles: { ...LIBELLES_EN },
    libelles_en: { ...LIBELLES_EN },
    apparence: { ...APPARENCE_NEUTRE },
    // La fiduciaire (factures de commission à un partenaire) est propre à la Thaïlande : éteinte au départ, le client l'allume s'il en a besoin.
    fiduciaire: { actif: false },
  };
  if (m.id === "travel_planner")
    return {
      ...commun,
      messages: messagesAnglais((x) => x.pour === "client" && ["reponse", "envoi_devis", "envoi_facture", "objet_devis", "objet_facture", "renvoi_facture", "objet_renvoi_facture", "avis"].includes(x.cle)),
      conditions: { acompte_pct: 0, delai_jours: 10, relance_jours: 7, solde_jours: 30, tva_mention: "", tva_mention_en: "", cgv_url: "" },
      numerotation: { mode: "sequence", prefixe: "", chiffres: 4 },
      dossier: { modele_bandeau: "{PAYS} - {PERIODE}", libelle_pays: "Destination" },
      listes: { pays: [], civilites: CIVILITES_EN, moyens: moyens(["virement", "paypal", "wise", "especes", "autre"]) },
      textes: { variantes: [{ id: "standard", nom: "Standard", corps: "", cloture: "Thank you for your trust.\nKind regards," }] },
    };
  if (m.id === "tour_agency")
    return {
      ...commun,
      messages: messagesAnglais(() => true),
      conditions: { acompte_pct: 0, delai_jours: 5, relance_jours: 7, tva_mention: "", tva_mention_en: "", cgv_url: "" },
      numerotation: { mode: "sequence", prefixe: "", chiffres: 4 },
      dossier: { modele_bandeau: "{PAYS} - {PERIODE}", libelle_pays: "Service" },
      listes: { pays: ["Tour", "Transfer"], civilites: CIVILITES_EN, moyens: moyens(["especes", "virement", "paypal", "wise", "autre"]) },
      modules: { partenaires: true, reservations: true, messages: true, catalogue: null },
      voucher: { nom },
      textes: { variantes: [{ id: "standard", nom: "Standard", corps: "Payment is due before the service.", cloture: "Thank you for booking with us!" }] },
    };
  return {
    ...commun,
    messages: MESSAGES_TRANSFERTS.map((x) => ({ ...x })),
    conditions: { acompte_pct: 0, delai_jours: 5, relance_jours: 7, tva_mention: "", tva_mention_en: "", cgv_url: "" },
    numerotation: { mode: "sequence", prefixe: "", chiffres: 4 },
    dossier: { modele_bandeau: "{PAYS} - {PERIODE}", libelle_pays: "Route" },
    listes: { pays: [], civilites: CIVILITES_EN, moyens: moyens(["especes", "virement", "autre"]) },
    modules: { partenaires: true, reservations: true, messages: true, catalogue: null },
    // Pied de la booking confirmation : sans la marque, le lieu ni le paiement Wise d'Anaïs (textes-voucher.mjs, clés « b_… »).
    voucher: {
      nom,
      textes: {
        b_paiement: "Payment will be collected by the driver directly",
        b_paiement_wise: "If you prefer to pay in advance, please let us know.",
        b_merci: `Thank you for choosing ${nom || "us"}, we look forward to driving you to your destination!`,
        b_signature: nom ? `${nom} Team` : "The team",
        b_lieu: nom || "Booking confirmation",
      },
    },
    textes: { variantes: [{ id: "standard", nom: "Standard", corps: "Payment on arrival.", cloture: "Thank you!" }] },
  };
}

// Catalogue d'exemple (formules d'un travel planner) : des intitulés en anglais, sans prix. Le client met les siens pendant l'appel,
// ou supprime les lignes. Les excursions et les transferts n'en ont pas : leurs prix vivent dans les partenaires.
const CATALOGUE_TRAVEL_PLANNER = [
  { kind: "formule", libelle: "Itinerary design", intro: "including:", puces: ["discovery call", "day-by-day itinerary", "transport options between stops"], prix: null },
  { kind: "formule", libelle: "Full trip planning", intro: "including:", puces: ["day-by-day itinerary", "accommodation selection", "transport and activity bookings", "support during the trip"], prix: null },
  { kind: "supplement", libelle: "Extra destination", intro: "", puces: [], prix: null },
];
export const catalogueModele = (id) => (modele(id).id === "travel_planner" ? CATALOGUE_TRAVEL_PLANNER.map((c) => ({ ...c, puces: [...c.puces] })) : []);

// Code court de la première entreprise : tiré du nom (« Agence Bleue » donne « agence-bleue »).
export const codeCourt = (nom) =>
  String(nom || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "agence";

// Tout le départ d'une entreprise créée depuis un modèle (migration 45) : la seule source pour la base (installer_entreprise),
// pour l'écran « Nouvelle entreprise » et pour la démo. Réglages complets, trois rôles (Administrateur d'abord), catalogue d'exemple.
export function departModele(id, { nom = "", devise = "" } = {}) {
  return {
    reglages: completerReglages(reglagesModele(id, { nom, devise })),
    roles: ROLES_SYSTEME.map((r) => ({ nom: r.nom, description: r.description, portee: r.portee, permissions: [...r.permissions], tous_droits: !!r.tous_droits })),
    catalogue: catalogueModele(id),
  };
}
