// Calculs purs du geste « tirer pour actualiser » (application installée sur l'iPhone). Aucun accès au navigateur :
// les tests Node couvrent le seuil, la résistance, les bords et les cas où le geste ne doit pas démarrer.

export const SEUIL = 70; // distance du doigt, en px, à partir de laquelle relâcher lance l'actualisation
export const MAX = 96; // course maximale de l'indicateur
export const ZONE_BORD = 24; // le geste de retour d'iOS part des bords gauche et droit, la zone du haut est celle des notifications
export const ZONE_MORTE = 8; // avant ce déplacement, on ne sait pas encore si le doigt tire, défile ou glisse de côté
export const POSITION_ATTENTE = 60; // où l'indicateur reste pendant l'actualisation

// Course de l'indicateur pour un déplacement du doigt : proportionnelle au début puis de plus en plus dure, jamais au-delà de MAX.
export function decalage(dy) {
  if (!(dy > 0)) return 0;
  return Math.round(MAX * (1 - Math.exp(-dy / MAX)) * 10) / 10;
}

// De 0 à 1 jusqu'au seuil (rotation de la flèche, opacité de l'indicateur).
export const progression = (dy) => (dy > 0 ? Math.min(1, dy / SEUIL) : 0);

// Que fait le doigt ? « attente » tant qu'il a peu bougé, « bas » s'il tire presque droit vers le bas, « autre » s'il remonte ou part de côté.
export function direction(dx, dy) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < ZONE_MORTE) return "attente";
  if (dy > 0 && Math.abs(dx) < 0.6 * dy) return "bas";
  return "autre";
}

// Le geste peut-il démarrer ? `bloque` regroupe ce que seul le navigateur sait (fenêtre ouverte, champ en saisie, actualisation en cours).
// `defilee` : un conteneur défilant sous le doigt n'est pas tout en haut.
export function peutDemarrer({ scrollY = 0, x = 0, y = 0, largeur = 0, touches = 1, bloque = false, defilee = false }) {
  if (bloque || defilee || touches !== 1) return false;
  if (scrollY > 0) return false;
  if (x < ZONE_BORD || x > largeur - ZONE_BORD) return false;
  if (y < ZONE_BORD / 2) return false;
  return true;
}

// Fait avancer le geste. `etat` : { phase: "attente" | "tire" | "refuse", dy, arme }. Une fois refusé, le geste reste refusé jusqu'à ce que le doigt se lève :
// un défilement normal ne devient jamais une actualisation, même si le doigt revient ensuite vers le bas.
export const DEPART = Object.freeze({ phase: "attente", dy: 0, arme: false });
export function suivre(etat, dx, dy, scrollY = 0) {
  if (etat.phase === "refuse") return etat;
  if (scrollY > 0) return { phase: "refuse", dy: 0, arme: false };
  if (etat.phase === "tire") {
    const d = Math.max(0, dy);
    return { phase: "tire", dy: d, arme: d >= SEUIL };
  }
  const sens = direction(dx, dy);
  if (sens === "attente") return etat;
  if (sens === "autre") return { phase: "refuse", dy: 0, arme: false };
  return { phase: "tire", dy, arme: dy >= SEUIL };
}

// Au relâchement : lance l'actualisation seulement si le seuil est atteint.
export const declenche = (etat) => etat.phase === "tire" && etat.arme;

// Texte de l'indicateur selon l'étape (les clés sont traduites par tr() côté écran).
export function etape(etat) {
  if (etat.phase !== "tire") return "repos";
  return etat.arme ? "relacher" : "tirer";
}

// Fin de l'actualisation : le message dit la vérité. Hors connexion, on le dit ; sinon l'erreur réelle est affichée.
// `resultat` : « modifie », « propre », « inchange » (la base a été relue), « ignore » (rien relu : démo ou lecture déjà en cours).
export function bilan({ resultat, erreur = null, horsLigne = false, demo = false }) {
  if (horsLigne) return { type: "erreur", cle: "hors_ligne" };
  if (erreur) return { type: "erreur", cle: "erreur", message: (erreur && erreur.message) || String(erreur) };
  if (resultat === "ignore" && !demo) return { type: "info", cle: "deja_en_cours" };
  return { type: "ok", cle: "a_jour" };
}
