// Tableaux larges (relecture de la PR 367) : logique pure, testée avec node --test ; app.mjs mesure et pose les attributs.
// Sur ordinateur, un tableau qui ne tient pas défile dans sa boîte. La boîte devient alors une région prise au clavier, avec un
// fondu au bord qui montre la suite. Les lignes empilées restent réservées à la coque téléphone (CSS, sous 720 px).

// La boîte défile-t-elle ? Tolérance d'un pixel pour les arrondis ; une boîte masquée (largeur 0) ne défile pas.
export const boiteDefile = ({ largeurContenu, largeurBoite }) => Boolean(largeurBoite) && largeurContenu > largeurBoite + 1;

// Fin de défilement atteinte (le fondu au bord droit disparaît).
export const finDefilement = ({ gauche, largeurBoite, largeurContenu }) => gauche + largeurBoite >= largeurContenu - 1;
