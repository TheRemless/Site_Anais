// Modules de Gestion (SaaS, 17.11.2026) : chaque écran propre à un métier est un module, plus un test de mode écrit dans l'écran.
// Un module dit pour quelles façons de travailler il existe (pour), ce qu'il demande (requiert, site) et s'il s'allume seul.
// Règle de Jérémy (12.11.2026) : chaque entreprise n'a que ses écrans. Le réglage « Écrans » éteint ou rallume un module là où il existe,
// il ne l'ouvre jamais ailleurs (un écran de partenaires n'a pas de sens dans une entreprise de devis sur mesure).
// Le déroulé propre à une façon de travailler (facture directe, Booking confirmation, paiement au chauffeur) reste réglé par reglages.fonctionnement.
// Logique pure, testée par tests/gestion-modules.test.js.

import { N_ } from "./i18n.mjs";

export const FONCTIONNEMENTS = ["sur_mesure", "excursions", "taxi"];
export const fonctionnementDe = (r) => (r && FONCTIONNEMENTS.includes(r.fonctionnement) ? r.fonctionnement : "sur_mesure");

// ecrans : clés des écrans (routes et entrées du menu) que le module ouvre. Un module sans écran ajoute un bouton ou une section.
// reglable : false pour un module qui a déjà son propre réglage (la fiduciaire s'allume dans ses réglages).
export const MODULES = [
  { id: "catalogue", nom: N_("Catalogue de formules"), aide: N_("Les formules et leurs prix, à ajouter aux devis."), ecrans: ["catalogue"], pour: ["sur_mesure"] },
  { id: "partenaires", nom: N_("Partenaires et tarifs"), aide: N_("Les prestataires, leurs prix de vente et leurs nets."), ecrans: ["partenaires", "tarifs"], pour: ["excursions", "taxi"] },
  { id: "trajets", nom: N_("Trajets et règles"), aide: N_("Horaires des bateaux et conditions des partenaires (parc, enfants, annulation)."), ecrans: ["trajets", "regles"], pour: ["excursions"], requiert: "partenaires" },
  { id: "du", nom: N_("Dû aux partenaires"), aide: N_("Ce qui reste à payer à chaque partenaire."), ecrans: ["du"], pour: ["excursions"], requiert: "partenaires" },
  { id: "reservations", nom: N_("Réservations et agenda du jour"), aide: N_("Une réservation par service, avec son voucher, et l'agenda sur l'accueil."), ecrans: ["reservations"], pour: ["excursions", "taxi"] },
  { id: "messages", nom: N_("Messages types"), aide: N_("Les messages à copier pour le client et le partenaire."), ecrans: ["messages"], pour: ["excursions", "taxi"] },
  { id: "demande_collee", nom: N_("Coller une demande"), aide: N_("Un message WhatsApp du client devient un dossier."), ecrans: [], pour: ["excursions", "taxi"] },
  { id: "commissions", nom: N_("Commissions de la veille"), aide: N_("Sur l'accueil, les courses d'hier dont la commission est à demander."), ecrans: [], pour: ["taxi"], requiert: "reservations" },
  { id: "demandes_site", nom: N_("Demandes du site"), aide: N_("Les demandes envoyées par le formulaire du site."), ecrans: ["demandes"], pour: ["excursions", "taxi"], site: true },
  { id: "bandeau_site", nom: N_("Bandeau du site"), aide: N_("Le message affiché en haut des pages du site."), ecrans: ["bandeau"], pour: ["excursions", "taxi"], site: true },
  { id: "fiduciaire", nom: N_("Factures pour la fiduciaire"), aide: "", ecrans: ["fiduciaire"], pour: ["excursions", "taxi"], reglable: false },
];

const PAR_ID = new Map(MODULES.map((m) => [m.id, m]));
export const moduleDe = (id) => PAR_ID.get(id) || null;
// Module qui ouvre un écran donné (null : écran commun à toutes les entreprises).
export const moduleDeLEcran = (cle) => MODULES.find((m) => m.ecrans.includes(cle)) || null;

// Le module existe-t-il pour cette entreprise (façon de travailler, module requis, site) ? Le réglage « Écrans » n'y change rien.
// publieSite : entites.publie_site. Une valeur absente (données d'avant la migration 41, démo) ne ferme rien.
export function moduleDisponible(id, { reglages, publieSite } = {}) {
  const m = moduleDe(id);
  // Un id inconnu (faute de frappe à l'appel) ferme : un écran ne s'ouvre jamais par erreur dans une entreprise qui ne l'a pas.
  if (!m) return false;
  if (!m.pour.includes(fonctionnementDe(reglages))) return false;
  if (m.site && publieSite === false) return false;
  if (m.requiert && !moduleAllume(m.requiert, { reglages, publieSite })) return false;
  return true;
}

// Disponible, et pas éteint dans « Écrans ». Sans choix (null ou absent), un module disponible est allumé.
export function moduleAllume(id, contexte = {}) {
  if (!moduleDisponible(id, contexte)) return false;
  const v = ((contexte.reglages && contexte.reglages.modules) || {})[id];
  return v !== false;
}

// Modules proposés dans Réglages, Écrans, pour cette entreprise.
export const modulesReglables = (contexte = {}) => MODULES.filter((m) => m.reglable !== false && moduleDisponible(m.id, { ...contexte, reglages: { ...(contexte.reglages || {}), modules: {} } }));
