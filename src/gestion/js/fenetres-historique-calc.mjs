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

// Entrée sans fenêtre vivante : fantôme d'une fenêtre fermée, entrée d'une fenêtre qui n'est plus ouverte (rechargement de la page),
// ou ancienne entrée de la visionneuse quand aucune photo n'est ouverte (Avancer qui y arrive ne changerait rien à l'écran).
export function entreeVide(etat, ouvertes, visionneuseOuverte = false) {
  if (!etat) return false;
  if (etat.visionneuse) return !visionneuseOuverte;
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
// Jamais de premier pas en quittant l'entrée de la visionneuse : fermer une photo (retour ou bouton) laisse l'écran tel quel, même
// posée sur un fantôme ; un pas déjà en cours (`sens`) traverse en revanche une ancienne entrée de photo. Un pas en arrière seulement
// quand une entrée de Gestion existe derrière, prouvé par la position connue de l'entrée atteinte (`pos` > 0) : sinon l'app installée
// pourrait se fermer (Android).
// Position d'une entrée depuis le lancement de Gestion (0 : l'entrée de départ). Inconnue si l'état a été remplacé par un état vide.
export const aUneEntreeDerriere = (etat) => Boolean(etat) && typeof etat.pos === "number" && etat.pos > 0;
const posApres = (etat) => (etat && typeof etat.pos === "number" ? etat.pos + 1 : undefined);
const avecPos = (e, pos) => {
  delete e.pos;
  if (pos !== undefined) e.pos = pos;
  return e;
};

export function pasSuivant(quitte, atteint, ouvertes, sens = null, visionneuseOuverte = false) {
  if (!memeEcran(quitte, atteint) || (!sens && quitte && quitte.visionneuse)) return null;
  if (!entreeVide(quitte, ouvertes, visionneuseOuverte) && !entreeVide(atteint, ouvertes, visionneuseOuverte)) return null;
  const pas = sens || ((atteint.rang || 0) < (quitte.rang || 0) ? "retour" : "avance");
  return pas === "retour" && !aUneEntreeDerriere(atteint) ? null : pas;
}
// Garde-fou : au plus ce nombre de pas automatiques d'affilée.
export const PAS_MAX = 12;

// Adresse à afficher après un déplacement dans l'historique : sur le même écran, celle que la personne voyait (un filtre ou l'Assistant
// a pu réécrire l'adresse de l'entrée du dessus seulement). Sinon celle de l'entrée atteinte.
export function adresseApresDeplacement(quitte, atteint, adresseQuittee, adresseAtteinte) {
  return memeEcran(quitte, atteint) && adresseQuittee ? adresseQuittee : adresseAtteinte;
}

// Ouverture d'une fenêtre n : reprendre une entrée vide (fenêtre enchaînée, fantôme), sinon en ajouter une au-dessus.
// `etiquette` : étiquette neuve si l'entrée de l'écran n'en a pas encore. L'entrée d'une photo encore affichée (`visionneuseOuverte`)
// n'est jamais reprise : un seul retour fermerait sinon la photo et la fenêtre d'un coup.
export function entreePourOuverture(etat, n, ouvertes, rang, etiquette, visionneuseOuverte = false) {
  const base = { ...(etat || {}) };
  delete base.fantome;
  delete base.visionneuse;
  const ecran = base.ecran || etiquette;
  const remplacer = entreeVide(etat, ouvertes, visionneuseOuverte);
  return { etiquetterEcran: !base.ecran, remplacer, etat: avecPos({ ...base, ecran, feuille: n, rang }, remplacer ? base.pos : posApres(etat)) };
}

// Fermeture d'une fenêtre n autrement que par le retour : son entrée, si elle est l'entrée courante, devient un fantôme.
export function entreeApresFermeture(etat, n) {
  if (!etat || etat.feuille !== n) return null;
  const e = { ...etat, fantome: true };
  delete e.feuille;
  return e;
}

// Entrée ajoutée par un autre module (visionneuse) : jamais un fantôme, même recopiée de l'entrée du dessous (sinon fermer une photo
// posée sur un fantôme faisait quitter l'écran) ; rang neuf, position suivante. Les fantômes ne s'empilent donc jamais.
// `courant` : état de l'entrée courante, pour la position.
export function entreeAjoutee(etat, rang, courant = etat) {
  if (!etat || typeof etat !== "object") return etat;
  const e = { ...etat, rang };
  delete e.fantome;
  return avecPos(e, posApres(courant));
}

// Lien ou location.replace : un remplacement ne change jamais la longueur de l'historique, une entrée ajoutée la change (plus longue,
// ou plus courte quand elle écrase les entrées « suivantes »). Longueur égale : remplacement, ou lien qui écrase exactement une entrée ;
// on garde alors la position, l'erreur ne va que dans le sens sûr (un pas automatique en moins, jamais un de trop).
export function posApresChangementDAdresse(avant, longueurAvant, longueurApres) {
  if (!avant || typeof avant.pos !== "number") return undefined;
  return longueurApres !== longueurAvant ? avant.pos + 1 : avant.pos;
}

// Démarrage. Rechargement avec une fenêtre ouverte : l'entrée garde { feuille } sans fenêtre, elle devient un fantôme.
// Lancement (app installée, lien, nouvel onglet) : l'entrée est la position 0, aucun pas automatique ne repart en arrière d'ici.
export function entreeAuDemarrage(etat, lancement = false) {
  let e = etat && etat.feuille && !etat.visionneuse ? entreeApresFermeture(etat, etat.feuille) : null;
  if (lancement && !(etat && etat.pos === 0)) e = { ...(e || etat || {}), pos: 0 };
  return e;
}

// Changement d'écran par un lien ou une adresse : les fenêtres ouvertes sur une autre adresse se ferment (celle du dessus d'abord).
// L'adresse de chaque fenêtre suit les réécritures de son écran (filtres) ; un hashchange simulé (rafraîchir) ne ferme rien.
export function fermeturesAuChangementDEcran(pile, hash) {
  return pile.filter((f) => f.hash !== hash).map((f) => f.n).reverse();
}
