// Fenêtres (feuilles, menus « … », confirmations) et historique du navigateur : logique pure, testée avec node --test.
// L'application (ui.mjs) l'appelle avec la pile des fenêtres ouvertes et l'état d'historique (history.state).
//
// Chaque fenêtre ouverte ajoute une entrée d'historique à la même adresse, marquée { feuille: n } (n croissant). Le retour arrière
// (geste iOS de l'app installée, bouton Android, history.back) ferme alors la fenêtre du dessus au lieu de quitter l'écran.
// Une fenêtre fermée autrement (bouton, Échap, enregistrement) laisse une entrée orpheline : elle est retirée au tour suivant,
// sauf si une fenêtre enchaînée la reprend aussitôt (relecture de la PR 363, preview groupée PR 365).

// Fenêtres à fermer quand le retour arrière arrive sur `etat` : toutes celles ouvertes après l'entrée atteinte, celle du dessus d'abord.
// `pile` : [{ n, modifie }] dans l'ordre d'ouverture. On s'arrête sur la première qui a une saisie non enregistrée : elle demande
// confirmation, les fenêtres du dessous restent ouvertes.
export function fermeturesAuRetour(pile, etat) {
  const atteinte = (etat && etat.feuille) || 0;
  const aFermer = [];
  for (let i = pile.length - 1; i >= 0; i--) {
    const f = pile[i];
    if (f.n <= atteinte) break;
    if (f.modifie) return { fermer: aFermer, demander: f.n };
    aFermer.push(f.n);
  }
  return { fermer: aFermer, demander: null };
}

// L'entrée courante appartient-elle à une fenêtre qui n'est plus ouverte (ou a-t-elle été libérée) ? Alors elle est à retirer.
// Une entrée de la visionneuse de photos a sa propre gestion (visionneuse.mjs) : on n'y touche pas.
export function entreeOrpheline(etat, ouvertes) {
  if (!etat || etat.visionneuse) return false;
  if (etat.feuilleLibre) return true;
  return Boolean(etat.feuille) && !ouvertes.includes(etat.feuille);
}

// Ouverture d'une fenêtre : reprendre l'entrée libérée par une fenêtre qui vient de se fermer (enchaînement), sinon en ajouter une.
// `ouvertes` : numéros des fenêtres déjà ouvertes (sans la nouvelle) ; l'entrée d'une fenêtre encore ouverte n'est jamais reprise.
export function entreePourOuverture(etat, n, ouvertes) {
  const base = { ...(etat || {}), feuille: n };
  delete base.feuilleLibre;
  return { remplacer: entreeOrpheline(etat, ouvertes), etat: base };
}

// Changement d'écran : les fenêtres ouvertes sur un autre écran se ferment (celle du dessus d'abord). Une fenêtre ouverte juste après
// la navigation, sur le nouvel écran, reste.
export function fermeturesAuChangementDEcran(pile, hash) {
  return pile.filter((f) => f.hash !== hash).map((f) => f.n).reverse();
}
