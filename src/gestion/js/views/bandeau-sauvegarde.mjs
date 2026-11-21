// Bandeau de la sauvegarde automatique (migration 66) : pour les administrateurs, en haut de l'outil, quand aucune sauvegarde de la base n'a réussi
// depuis plus de 30 heures (sauvegarde-calc.mjs). Relu à l'ouverture puis toutes les heures. Il ne se ferme pas : il disparaît dès qu'une sauvegarde
// réussit. Rien pour les autres rôles : la base ne leur rend pas l'état.
import { etat } from "../etat.mjs";
import { h } from "../ui.mjs";
import { tr } from "../i18n.mjs";
import { alerteSauvegarde } from "../sauvegarde-calc.mjs";

const DEPOT = "https://github.com/TheRemless/gestion-sauvegardes/actions";
const noeud = h("div", { class: "bandeau-credit atteint bandeau-sauvegarde", role: "alert", hidden: true });
let minuterie = null;

export async function rafraichirBandeauSauvegarde() {
  if (!etat.store || !etat.store.sauvegardeEtat || etat.store.mode === "demo") return void (noeud.hidden = true);
  let A = null;
  try {
    A = alerteSauvegarde(await etat.store.sauvegardeEtat());
  } catch {
    A = null;
  }
  if (!A) return void (noeud.hidden = true);
  const texte = A.jamais
    ? tr("Aucune sauvegarde automatique de la base n'a encore réussi.")
    : tr("Aucune sauvegarde de la base n'a réussi depuis {heures} heures.", { heures: A.heures });
  noeud.replaceChildren(
    h("span", null, texte, A.echec && A.message ? h("span", { class: "bandeau-detail" }, ` ${tr("Dernière erreur : {message}", { message: A.message })}`) : null),
    h("a", { class: "bouton secondaire petit", href: DEPOT, target: "_blank", rel: "noopener" }, tr("Voir les sauvegardes"))
  );
  noeud.hidden = false;
}

export function bandeauSauvegarde() {
  rafraichirBandeauSauvegarde();
  if (!minuterie) minuterie = setInterval(rafraichirBandeauSauvegarde, 60 * 60 * 1000);
  return noeud;
}
