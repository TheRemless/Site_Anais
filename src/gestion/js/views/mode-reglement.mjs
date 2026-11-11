// Puce à deux états « Chez nous » / « Sur place » : le même geste sur chaque ligne de document et sur chaque réservation.
import { h } from "../ui.mjs";
import { partenaireDe, privePartenaire, peut } from "../etat.mjs";
import { SUR_PLACE, CHEZ_NOUS } from "../calc.mjs";
import { tr } from "../i18n.mjs";

// `valeur` : CHEZ_NOUS ou SUR_PLACE. `onchange(nouvelleValeur)` est appelé à chaque changement. Le nœud renvoyé porte `valeur()` pour lire l'état.
export function puceMode({ id, valeur = CHEZ_NOUS, onchange = () => {}, libelle = null, desactive = false }) {
  let courant = valeur === SUR_PLACE ? SUR_PLACE : CHEZ_NOUS;
  const boutons = {};
  const maj = () => {
    for (const [k, b] of Object.entries(boutons)) {
      b.setAttribute("aria-pressed", String(k === courant));
      b.classList.toggle("actif", k === courant);
    }
  };
  const bouton = (k, texte, titre) => {
    boutons[k] = h("button", { type: "button", class: "mode-bouton", disabled: desactive, title: titre, onclick: () => { if (k === courant) return; courant = k; maj(); onchange(k); } }, texte);
    return boutons[k];
  };
  const noeud = h(
    "div",
    { class: "mode-reglement", role: "group", id, "aria-label": libelle || tr("Règlement du service") },
    bouton(CHEZ_NOUS, tr("Chez nous"), tr("Le client règle l'agence : le prix entre dans le total à payer.")),
    bouton(SUR_PLACE, tr("Sur place"), tr("Le client paie le prestataire, qui reverse une commission : le prix reste affiché mais hors du total à payer."))
  );
  noeud.valeur = () => courant;
  noeud.definir = (v) => { courant = v === SUR_PLACE ? SUR_PLACE : CHEZ_NOUS; maj(); };
  maj();
  return noeud;
}

// Règle de commission chiffrée d'un partenaire (données privées : seulement pour qui voit les nets), ou null.
export function regleCommissionDe(partenaireId) {
  const p = partenaireId ? partenaireDe(partenaireId) : null;
  if (!p || !peut("partenaires.nets")) return null;
  const prive = privePartenaire(p);
  return (prive && prive.commission_regle) || null;
}
