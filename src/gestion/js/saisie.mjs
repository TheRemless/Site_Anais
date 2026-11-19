// Suivi des saisies dans la page (19.11.2026) : règles dans saisie-calc.mjs.
// La valeur d'origine d'un champ est notée au premier geste de la personne sur lui (focus, clic, touche, avant la frappe) : ce que l'outil y a
// mis lui-même (fiche ouverte, montant proposé, liste réglée) n'est jamais pris pour une saisie.
import { signatureChamp, champHorsSaisie, champModifie, ZONES_HORS_SAISIE } from "./saisie-calc.mjs";

const CHAMPS = "input, textarea, select, [contenteditable]";
const origine = new WeakMap();
let suivi = false;

const estChamp = (el) => !!el && el.nodeType === 1 && el.matches(CHAMPS);
// Le champ est-il hors saisie (recherche, filtre, tri, onglet, entreprise) ?
const horsSaisie = (c) => champHorsSaisie({ type: (c.type || "").toLowerCase(), role: c.getAttribute("role") || "", id: c.id || "", dansZoneHorsSaisie: !!c.closest(ZONES_HORS_SAISIE) });
// Visible : dans la page, ni lui ni un parent masqué ou hors affichage (une fenêtre fermée mais restée dans le DOM ne compte jamais).
// Un écran rendu inerte par une fenêtre ouverte par-dessus reste visible : sa saisie compte toujours.
const visible = (el) => el.isConnected && !el.closest("[hidden]") && el.getClientRects().length > 0;

function noter(e) {
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
  for (const ev of ["focusin", "pointerdown", "keydown", "beforeinput"]) doc.addEventListener(ev, noter, true);
}

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
export function curseurDansUnChamp(doc = document) {
  const a = doc.activeElement;
  return !!a && estChamp(a) && visible(a);
}
