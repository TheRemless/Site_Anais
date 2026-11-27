// Fenêtres (feuilles, menus « … », confirmations) et historique du navigateur : logique pure, testée avec node --test.
// L'application (ui.mjs) l'appelle avec la pile des fenêtres ouvertes et les états d'historique (history.state).
//
// Chaque fenêtre ouverte ajoute une entrée d'historique à l'adresse de l'écran, marquée { feuille: n, ecran, rang }. Le retour arrière
// (geste iOS de l'app installée, bouton Android, history.back) ferme alors la fenêtre du dessus au lieu de quitter l'écran.
// `ecran` : étiquette de l'entrée de l'écran, recopiée dans les entrées de ses fenêtres (deux entrées du même écran se reconnaissent,
// même si l'adresse a été réécrite entre-temps par un filtre ou par l'Assistant). `rang` : ordre des entrées, pour savoir dans quel sens
// on se déplace.
// Une fenêtre fermée autrement (bouton, Échap, enregistrement) laisse une entrée « fantôme » : jamais de history.back() différé, qui
// se mêlait aux navigations (Avancer cassé, navigation annulée). Un retour ou un Avancer qui tombe sur un fantôme sans rien changer
// à l'écran continue d'un pas dans le même sens (relecture de la PR 363, preview groupée PR 365).

// Entrée sans fenêtre vivante : fantôme d'une fenêtre fermée, ou entrée d'une fenêtre qui n'est plus ouverte (rechargement de la page).
// L'entrée de la visionneuse de photos a sa propre gestion (visionneuse.mjs).
export function entreeVide(etat, ouvertes) {
  if (!etat || etat.visionneuse) return false;
  if (etat.fantome) return true;
  return Boolean(etat.feuille) && !ouvertes.includes(etat.feuille);
}

export const memeEcran = (a, b) => Boolean(a && b && a.ecran && a.ecran === b.ecran);

// Fenêtres à fermer quand le retour arrive sur `atteint` : celles ouvertes après l'entrée atteinte, celle du dessus d'abord.
// `pile` : [{ n, ecran, modifie }] dans l'ordre d'ouverture. Une fenêtre d'un autre écran que l'entrée atteinte se ferme en quittant
// l'écran (saisie gardée en brouillon). Sinon on s'arrête sur la première qui a une saisie non enregistrée : elle demande confirmation.
export function fermeturesAuRetour(pile, atteint) {
  const atteinte = (atteint && atteint.feuille) || 0;
  const quitter = [];
  const aFermer = [];
  for (let i = pile.length - 1; i >= 0; i--) {
    const f = pile[i];
    if (!memeEcran(f, atteint)) {
      quitter.push(f.n);
      continue;
    }
    if (f.n <= atteinte) break;
    if (f.modifie) return { quitter, fermer: aFermer, demander: f.n };
    aFermer.push(f.n);
  }
  return { quitter, fermer: aFermer, demander: null };
}

// Rien n'a bougé à l'écran (même écran, aucune fenêtre fermée) et l'une des deux entrées est vide : on continue d'un pas, dans le sens
// du déplacement. Renvoie "retour", "avance" ou null. `sens` : sens du pas automatique précédent, gardé jusqu'au bout (sinon deux
// entrées de même rang, une ancienne entrée de la visionneuse par exemple, renverraient d'un sens à l'autre).
export function pasSuivant(quitte, atteint, ouvertes, sens = null) {
  if (!memeEcran(quitte, atteint)) return null;
  if (!entreeVide(quitte, ouvertes) && !entreeVide(atteint, ouvertes)) return null;
  return sens || ((atteint.rang || 0) < (quitte.rang || 0) ? "retour" : "avance");
}
// Garde-fou : au plus ce nombre de pas automatiques d'affilée.
export const PAS_MAX = 12;

// Adresse à afficher après un déplacement dans l'historique : sur le même écran, celle que la personne voyait (un filtre ou l'Assistant
// a pu réécrire l'adresse de l'entrée du dessus seulement). Sinon celle de l'entrée atteinte.
export function adresseApresDeplacement(quitte, atteint, adresseQuittee, adresseAtteinte) {
  return memeEcran(quitte, atteint) && adresseQuittee ? adresseQuittee : adresseAtteinte;
}

// Ouverture d'une fenêtre n : reprendre une entrée vide (fenêtre enchaînée, fantôme), sinon en ajouter une au-dessus.
// `etiquette` : étiquette neuve si l'entrée de l'écran n'en a pas encore.
export function entreePourOuverture(etat, n, ouvertes, rang, etiquette) {
  const base = { ...(etat || {}) };
  delete base.fantome;
  delete base.visionneuse;
  const ecran = base.ecran || etiquette;
  return { etiquetterEcran: !base.ecran, remplacer: entreeVide(etat, ouvertes), etat: { ...base, ecran, feuille: n, rang } };
}

// Fermeture d'une fenêtre n autrement que par le retour : son entrée, si elle est l'entrée courante, devient un fantôme.
export function entreeApresFermeture(etat, n) {
  if (!etat || etat.feuille !== n) return null;
  const e = { ...etat, fantome: true };
  delete e.feuille;
  return e;
}

// Rechargement avec une fenêtre ouverte : l'entrée garde { feuille } sans fenêtre ; elle devient un fantôme.
export function entreeAuDemarrage(etat) {
  if (!etat || !etat.feuille || etat.visionneuse) return null;
  return entreeApresFermeture(etat, etat.feuille);
}

// Changement d'écran par un lien ou une adresse : les fenêtres ouvertes sur une autre adresse se ferment (celle du dessus d'abord).
// L'adresse de chaque fenêtre suit les réécritures de son écran (filtres) ; un hashchange simulé (rafraîchir) ne ferme rien.
export function fermeturesAuChangementDEcran(pile, hash) {
  return pile.filter((f) => f.hash !== hash).map((f) => f.n).reverse();
}
