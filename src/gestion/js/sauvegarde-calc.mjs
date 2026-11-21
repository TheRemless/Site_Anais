// Alerte de la sauvegarde automatique (migration 66, 21.11.2026) : la GitHub Action du dépôt TheRemless/gestion-sauvegardes sauvegarde la base
// chaque nuit et note son résultat. L'outil alerte les administrateurs quand aucune sauvegarde n'a réussi depuis plus de 30 heures : une nuit
// manquée plus une marge pour un passage en retard. L'alerte sonne aussi quand GitHub ne lance rien du tout, puisqu'elle ne regarde que la
// dernière réussite.

export const DELAI_ALERTE_H = 30;

// `S` : la réponse de sauvegarde_etat() ({ dernier_succes, dernier_echec, message, maintenant }), ou null pour qui n'administre pas.
// Rend null quand tout va bien, sinon { heures, jamais, echec, message } pour le bandeau.
export function alerteSauvegarde(S, maintenant = null) {
  if (!S) return null;
  const now = Date.parse(maintenant || S.maintenant || "") || Date.now();
  const succes = Date.parse(S.dernier_succes || "");
  if (!Number.isNaN(succes) && now - succes <= DELAI_ALERTE_H * 3600 * 1000) return null;
  const echec = Date.parse(S.dernier_echec || "");
  return {
    jamais: Number.isNaN(succes),
    heures: Number.isNaN(succes) ? null : Math.floor((now - succes) / 3600000),
    echec: !Number.isNaN(echec) && (Number.isNaN(succes) || echec > succes),
    message: S.message ? String(S.message).slice(0, 200) : "",
  };
}
