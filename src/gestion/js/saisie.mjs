// Suivi des saisies dans la page (19.11.2026) : règles dans saisie-calc.mjs.
// La valeur d'origine d'un champ est notée au premier geste de la personne sur lui (clic, touche, avant la frappe ou le collage) : ce que l'outil
// y a mis lui-même (fiche ouverte, montant proposé, liste réglée, texte prérempli, même après avoir donné le focus) n'est jamais pris pour une saisie.
import { signatureChamp, champHorsSaisie, champModifie, ZONES_HORS_SAISIE } from "./saisie-calc.mjs";

const CHAMPS = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const origine = new WeakMap();
let suivi = false;
// Écran touché : un geste de la personne sur l'écran ou dans une fenêtre depuis son affichage (un service ajouté par un bouton n'est dans aucun
// champ). Remis à zéro à chaque affichage d'écran (nouvelEcran). Sert aux écrans de saisie : vides et intouchés, ils ne retiennent rien.
let touche = false;

const estChamp = (el) => !!el && el.nodeType === 1 && el.matches(CHAMPS);
// Le champ est-il hors saisie (recherche, filtre, tri, onglet, entreprise) ?
const horsSaisie = (c) => champHorsSaisie({ type: (c.type || "").toLowerCase(), role: c.getAttribute("role") || "", id: c.id || "", dansZoneHorsSaisie: !!c.closest(ZONES_HORS_SAISIE) });
// Visible : dans la page, ni lui ni un parent masqué ou hors affichage (une fenêtre fermée mais restée dans le DOM ne compte jamais).
// Un écran rendu inerte par une fenêtre ouverte par-dessus reste visible : sa saisie compte toujours.
const visible = (el) => el.isConnected && !el.closest("[hidden]") && el.getClientRects().length > 0;

function noter(e) {
  const zone = e.target && e.target.closest ? e.target.closest("#principal, .modal-fond") : null;
  if (zone && !e.target.closest(ZONES_HORS_SAISIE)) touche = true;
  const cible = e.target && e.target.closest ? e.target : null;
  // Un clic sur le libellé d'une case ou d'un bouton radio change le champ sans le toucher : on note le champ du libellé.
  const libelle = cible && cible.closest("label");
  const c = cible ? cible.closest(CHAMPS) || (libelle && libelle.control) || null : null;
  if (!estChamp(c) || origine.has(c)) return;
  origine.set(c, signatureChamp(c));
}

// À installer une fois, au démarrage : les gestes sont écoutés à la capture, avant que la valeur ne change.
export function suivreSaisies(doc = document) {
  if (suivi) return;
  suivi = true;
  // Pas « focusin » : l'outil donne lui-même le focus (fenêtre qui s'ouvre), puis peut remplir le champ.
  for (const ev of ["pointerdown", "keydown", "beforeinput"]) doc.addEventListener(ev, noter, true);
}
export const nouvelEcran = () => void (touche = false);
export const ecranTouche = () => touche;

// Les champs visibles changés par la personne et pas encore enregistrés : sur l'écran ou dans une fenêtre ouverte.
export function champsModifies(doc = document) {
  const zones = [doc.getElementById("principal"), ...doc.querySelectorAll(".modal-fond")].filter(Boolean);
  const vus = new Set();
  const out = [];
  for (const z of zones) {
    for (const c of z.querySelectorAll(CHAMPS)) {
      if (vus.has(c)) continue;
      vus.add(c);
      if (champModifie(origine.get(c), signatureChamp(c)) && !horsSaisie(c) && visible(c)) out.push(c);
    }
  }
  return out;
}

// Un champ de saisie a le curseur : redessiner l'écran le lui ferait perdre (filtre ou recherche compris). Sert à retenir un redessin,
// jamais à dire qu'une saisie est en cours.
// Le menu (entreprise, langue) n'en fait pas partie : il est redessiné avec l'écran sans rien perdre.
export function curseurDansUnChamp(doc = document) {
  const a = doc.activeElement;
  return !!a && estChamp(a) && visible(a) && !a.closest(".menu, .barre-haut, .langues");
}
