// Textes thaïs de l'écran de Mook, modifiables dans Réglages avec le français en regard (lot D, 17.11.2026, section 2 de l'audit).
// Les textes de départ restent dans leur fichier (voucher-rapide-calc.mjs, fiduciaire-textes.mjs). Une entreprise peut en remplacer : ils sont
// enregistrés dans reglages.textes_thai = { voucher: { cle: texte }, fiduciaire: { cle: texte } } et posés sur les textes de départ à chaque
// changement d'entreprise (etat.mjs). Un texte vide ou qui perd une {variable} garde le texte de départ.
import { TH as TH_VOUCHER } from "./voucher-rapide-calc.mjs";
import { TH as TH_FIDUCIAIRE } from "./fiduciaire-textes.mjs";
import { N_ } from "./i18n.mjs";
import { remplirResponsable } from "./noms-calc.mjs";

// Le français de chaque texte de l'écran « Nouveau voucher » (les commentaires de voucher-rapide-calc.mjs).
const FR_VOUCHER = {
  titre: "Nouveau voucher",
  titre_modif: "Modifier le voucher",
  marque: "Logo sur le voucher",
  marque_aide: "Choisir l'entreprise qui figure sur le voucher. Dans les deux cas, le client paie le chauffeur",
  nom: "Nom du client",
  telephone: "WhatsApp du client",
  telephone_aide: "Facultatif, avec l'indicatif du pays, par exemple +44 7700 900123",
  client_connu: "Client déjà connu",
  utiliser_client: "Utiliser ce client",
  date: "Date",
  pickup: "Lieu de prise en charge",
  heure: "Heure de prise en charge",
  dropoff: "Lieu de dépose",
  trajet: "Type de trajet",
  trajet_simple: "Aller simple, dépose ailleurs",
  trajet_retour: "Aller puis retour au lieu de prise en charge",
  trajet_aide: "Le client fait un tour ou une course, puis le chauffeur le ramène au même endroit",
  programme: "Programme",
  programme_aide: "Où va le client, ce qu'il fait, en anglais, par exemple…",
  duree: "Environ combien d'heures",
  duree_aide: "Facultatif, un nombre, par exemple 3. Si on ne sait pas, laisser vide",
  vol: "Numéro de vol ou de bateau",
  vol_aide: "Si prise en charge ou dépose à l'aéroport ou au port, par exemple FD3217. Sinon, laisser vide",
  adultes: "Adultes",
  enfants: "Enfants",
  bagages: "Bagages",
  bagages_aide: "Un nombre, par exemple 3",
  sieges: "Sièges enfant ou bébé",
  sieges_aide: "Nombre de sièges enfant ou bébé. Laisser vide si aucun",
  prix: "Prix total (bahts)",
  prix_aide: "Le client paie en espèces au chauffeur",
  anglais_aide: "Écrire en anglais",
  apercu: "Voir l'aperçu",
  modifier: "Modifier",
  creer: "Créer et envoyer à {responsable}",
  enregistrer: "Enregistrer et envoyer à {responsable}",
  envoyer: "Envoyer l'image à {responsable}",
  enregistrer_image: "Enregistrer l'image",
  ouvrir_chat: "Ouvrir la conversation {de_responsable}",
  nouveau: "Faire un nouveau voucher",
  annuler: "Annuler",
  retour: "Retour",
  derniers: "Derniers vouchers",
  aucun: "Pas encore de voucher",
  renvoyer: "Renvoyer",
  annule: "Annulé",
  creation: "Création…",
  preparation: "Préparation de l'image…",
  cree: "Voucher créé",
  modifie: "Enregistré",
  choisir_anais: "Dans WhatsApp, choisir {responsable} puis envoyer",
  partage_impossible: "Ce téléphone ne peut pas envoyer l'image directement : enregistrer l'image puis l'envoyer dans WhatsApp",
  partage_echec: "L'envoi de l'image a échoué : enregistrer l'image puis l'envoyer dans WhatsApp",
  image_copiee: "Image copiée, la coller dans la conversation {de_responsable}",
  echec: "Échec, réessayer",
  image_echec: "L'image n'a pas pu être faite",
  reessayer: "Refaire l'image",
  deconnexion: "Se déconnecter",
  e_vide: "Remplir ce champ",
  e_thai: "Écrire en anglais : le client ne lit pas le thaï",
  e_date: "Choisir la date",
  e_heure: "Choisir l'heure",
  e_adultes: "Au moins 1 personne",
  e_nombre: "Écrire un nombre",
  e_prix: "Écrire le prix en chiffres",
  e_sieges: "Plus de sièges que d'enfants",
  e_tel: "Numéro incorrect",
  e_duree: "Écrire le nombre d'heures en chiffres, par exemple 3",
  remarques: "Remarque sur la Booking confirmation",
  remarques_aide: "Facultatif. Le client la voit. Écrire en anglais, par exemple 50th birthday",
  notes: "Note interne",
  notes_aide: "Facultatif. Jamais imprimée, le client ne la voit pas. Le thaï est accepté",
};

// Textes de départ, relevés une fois au chargement, avant tout changement.
const DEPART_VOUCHER = { ...TH_VOUCHER };
const DEPART_FIDUCIAIRE = Object.fromEntries(Object.entries(TH_FIDUCIAIRE).map(([k, v]) => [k, v.th]));
const FR_FIDUCIAIRE = Object.fromEntries(Object.entries(TH_FIDUCIAIRE).map(([k, v]) => [k, v.fr]));

// `modes` : les façons de travailler où l'écran existe. Le voucher simple n'existe qu'en Taxi ; les factures pour la fiduciaire en Secret et en Taxi.
export const ECRANS_THAI = [
  { id: "voucher", nom: N_("Écran « Nouveau voucher »"), modes: ["taxi"], lignes: Object.keys(DEPART_VOUCHER).map((cle) => ({ cle, fr: FR_VOUCHER[cle] || "", depart: DEPART_VOUCHER[cle] })) },
  { id: "fiduciaire", nom: N_("Écran « Factures pour la fiduciaire »"), modes: ["excursions", "taxi"], lignes: Object.keys(DEPART_FIDUCIAIRE).map((cle) => ({ cle, fr: FR_FIDUCIAIRE[cle], depart: DEPART_FIDUCIAIRE[cle] })) },
];
export const ecransThaiPour = (fonctionnement) => ECRANS_THAI.filter((e) => e.modes.includes(fonctionnement));

// {responsable} et {de_responsable} (le prénom de la personne responsable, migration 44) sont facultatifs : un texte
// enregistré avant, qui écrit le prénom en toutes lettres, reste valable.
const FACULTATIVES = new Set(["responsable", "de_responsable"]);
const variables = (t) => [...String(t || "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((v) => !FACULTATIVES.has(v)).sort().join(",");
// Le texte enregistré s'il est utilisable : pas vide, et avec exactement les mêmes {variables} que le texte de départ. Sinon null.
export function texteValide(depart, texte) {
  const t = typeof texte === "string" ? texte.trim() : "";
  if (!t) return null;
  return variables(t) === variables(depart) ? t : null;
}
export const variablesDe = (t) => variables(t).split(",").filter(Boolean);

// Le responsable vu par un texte thaï de la fiduciaire : son prénom écrit en thaï quand il est réglé.
export const prenomThai = (resp) => resp && { ...resp, prenom: resp.prenom_th || resp.prenom };

// Pose les textes d'une entreprise sur les textes de départ (et remet ceux de départ là où elle n'a rien changé).
// `responsable` : { prenom, prenom_th } de responsableDe (noms-calc.mjs), inséré à la place de {responsable} ({de_responsable} :
// « d'Anaïs »). L'écran du voucher écrit le prénom en lettres latines, celui de la fiduciaire en thaï.
export function appliquerTextesThai(textes, responsable = null) {
  const v = (textes && textes.voucher) || {};
  const f = (textes && textes.fiduciaire) || {};
  for (const [cle, depart] of Object.entries(DEPART_VOUCHER)) TH_VOUCHER[cle] = remplirResponsable(texteValide(depart, v[cle]) ?? depart, responsable, { thai: true });
  for (const [cle, depart] of Object.entries(DEPART_FIDUCIAIRE)) {
    // Texte thaï : le prénom écrit en thaï quand il est réglé (« อานาอิส »).
    TH_FIDUCIAIRE[cle].th = remplirResponsable(texteValide(depart, f[cle]) ?? depart, prenomThai(responsable), { thai: true });
    TH_FIDUCIAIRE[cle].fr = remplirResponsable(FR_FIDUCIAIRE[cle], responsable);
  }
}
