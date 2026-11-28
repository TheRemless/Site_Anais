// Tableaux larges (relecture de la PR 367) : logique pure, testée avec node --test ; app.mjs mesure et pose les classes.
// Un tableau qui ne tient pas dans sa place passe en lignes empilées (la présentation du téléphone, chaque cellule précédée de
// son intitulé) plutôt que de défiler ou de couper une colonne. La boîte qui défile ne sert plus que de filet.

// Mode d'un tableau : « empile » s'il dépasse sa boîte (tolérance d'un pixel pour les arrondis), sinon « normal ».
// Sous 720 px, le CSS empile déjà tous les tableaux : rien à décider.
export function modeTableau({ largeurTableau, largeurBoite, ecran }) {
  if (!largeurBoite || ecran < 720) return "normal";
  return largeurTableau > largeurBoite + 1 ? "empile" : "normal";
}

// La boîte défile-t-elle encore (contenu empilé trop large, très rare) ? Alors elle devient une région accessible au clavier.
export const boiteDefile = ({ largeurContenu, largeurBoite }) => Boolean(largeurBoite) && largeurContenu > largeurBoite + 1;

// Intitulés des cellules en mode empilé : repris des en-têtes de colonnes, sans écraser un intitulé déjà posé par l'écran.
// `entetes` : textes des th ; `cellules` : [{ index, label }] d'une ligne. Renvoie les intitulés à poser ([index, texte]).
export function intitulesManquants(entetes, cellules) {
  return cellules.filter((c) => !c.label && entetes[c.index]).map((c) => [c.index, entetes[c.index]]);
}
