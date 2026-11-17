// Droits d'une personne dans une entreprise, calculés comme le fait la base (fonctions permissions_dans et voit_tout).
// La base reste l'autorité : ce fichier sert à adapter l'interface et à simuler les droits en démonstration.
import { TOUTES_PERMISSIONS, PERMISSIONS } from "./defauts.mjs";
import { N_ } from "./i18n.mjs";

const actif = (p) => !!(p && p.actif);

export function roleDans({ profil, membres, roles }, entiteId) {
  if (!actif(profil)) return null;
  const m = membres.find((x) => x.user_id === profil.user_id && x.entite_id === entiteId);
  return (m && roles.find((r) => r.id === m.role_id)) || null;
}

// Un rôle « tous les droits » (l'Administrateur de chaque entreprise, migration 38) reçoit la liste complète, calculée comme pour
// l'administratrice générale : un droit ajouté au code lui arrive sans toucher au rôle.
export const droitsDuRole = (r) => (r ? (r.tous_droits ? TOUTES_PERMISSIONS : r.permissions || []) : []);

export function permissionsDans(ctx, entiteId) {
  if (actif(ctx.profil) && ctx.profil.super_admin) return TOUTES_PERMISSIONS;
  return droitsDuRole(roleDans(ctx, entiteId));
}

// Ce qu'un rôle perd entre deux listes de droits, dans l'ordre de l'écran : la confirmation le nomme (audit n° 40).
// « vouchers.seul » est un droit d'interface : le perdre fait passer la personne de l'écran simple en thaï à l'outil complet.
export const droitsRetires = (avant, apres) => PERMISSIONS.filter((p) => (avant || []).includes(p.code) && !(apres || []).includes(p.code));

export function voitTout(ctx, entiteId) {
  if (actif(ctx.profil) && ctx.profil.super_admin) return true;
  const r = roleDans(ctx, entiteId);
  return !!r && r.portee === "toute";
}

// Les droits que la fenêtre d'un rôle propose, selon le fonctionnement de l'entreprise du rôle (sur_mesure, excursions ou taxi).
// Fiduciaire pour Secret et Taxi, l'écran « Nouveau voucher » seul pour Taxi, le catalogue de devis pour Zwald.
// Secret n'a que des factures ; Taxi n'a ni devis ni facture client : « documents.ecrire » y crée les vouchers et garde le prix
// interne de la course, « documents.supprimer » n'y ouvre rien. Seul l'affichage change : l'écran garde tel quel un droit masqué ici.
const DOCUMENTS_PAR_MODE = {
  excursions: { groupe: N_("Factures"), "documents.ecrire": N_("Créer et modifier les factures"), "documents.supprimer": N_("Supprimer une facture") },
  taxi: { groupe: N_("Vouchers et courses"), "documents.ecrire": N_("Créer les vouchers et modifier le prix des courses") },
};
export function droitsProposes(fonctionnement) {
  const mode = fonctionnement === "excursions" || fonctionnement === "taxi" ? fonctionnement : "sur_mesure";
  const docs = DOCUMENTS_PAR_MODE[mode];
  return PERMISSIONS.filter((p) => {
    if (p.code.startsWith("fiduciaire.")) return mode !== "sur_mesure";
    if (p.code === "vouchers.seul") return mode === "taxi";
    if (p.code === "catalogue.ecrire") return mode === "sur_mesure";
    if (p.code.startsWith("documents.") && docs) return !!docs[p.code];
    return true;
  }).map((p) => (p.code.startsWith("documents.") && docs ? { ...p, groupe: docs.groupe, libelle: docs[p.code] } : p));
}
