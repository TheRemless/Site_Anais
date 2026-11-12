// Lecture de la copie hors ligne de la feuille du jour. Aucune dépendance : cette page doit fonctionner sans le reste de l'application (hors-ligne.html, servie par le service worker
// quand le réseau manque). La construction de la copie est dans feuille-hors-ligne-calc.mjs.
export const CLE_HORS_LIGNE = "gestion-feuille-hors-ligne";
export const AGE_MAX_H = 48;

// Relit la copie stockée. Refusée (et à effacer) si elle est d'une autre personne, d'une autre version, illisible, ou plus vieille que 48 h.
export function lireCopie(brut, { maintenant = new Date(), utilisateur = null } = {}) {
  let copie;
  try {
    copie = typeof brut === "string" ? JSON.parse(brut) : brut;
  } catch {
    return { ok: false, raison: "illisible" };
  }
  if (!copie || copie.version !== 1 || !Array.isArray(copie.entreprises)) return { ok: false, raison: "illisible" };
  if (utilisateur && copie.utilisateur && copie.utilisateur !== utilisateur) return { ok: false, raison: "autre_personne" };
  const ageH = (new Date(maintenant).getTime() - new Date(copie.enregistre_le).getTime()) / 3600000;
  if (!(ageH >= 0) || ageH > AGE_MAX_H) return { ok: false, raison: "trop_ancienne" };
  return { ok: true, copie, ageH };
}
