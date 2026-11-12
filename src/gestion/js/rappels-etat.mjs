// État des rappels sur téléphone, d'après la table de suivi (migration 23) : logique pure, testée avec node --test.

export const DELAI_ALERTE_H = 24;

const reussi = (l) => !l.erreur && !(l.echecs > 0);

// `lignes` : les dernières exécutions, la plus récente d'abord. `maintenant` : date de référence (ms ou Date).
// Renvoie { statut: "aucune" | "ok" | "alerte", derniere, dernierReussi, message } : alerte si aucune exécution réussie depuis 24 h.
export function etatRappels(lignes, maintenant = Date.now()) {
  const t = new Date(maintenant).getTime();
  const tri = [...(lignes || [])].sort((a, b) => String(b.cree_le).localeCompare(String(a.cree_le)));
  if (!tri.length) return { statut: "aucune", derniere: null, dernierReussi: null, message: "aucune_execution" };
  const derniere = tri[0];
  const dernierReussi = tri.find(reussi) || null;
  const age = (l) => (t - new Date(l.cree_le).getTime()) / 3600000;
  if (!dernierReussi || age(dernierReussi) > DELAI_ALERTE_H) return { statut: "alerte", derniere, dernierReussi, message: "aucun_reussi_24h" };
  if (!reussi(derniere)) return { statut: "alerte", derniere, dernierReussi, message: "derniere_en_echec" };
  return { statut: "ok", derniere, dernierReussi, message: "ok" };
}
