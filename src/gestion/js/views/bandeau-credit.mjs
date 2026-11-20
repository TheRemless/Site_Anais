// Bandeau du crédit de l'assistant (migration 54) : pour les administratrices, en haut de l'outil, dès que la dépense du mois de l'assistant
// passe le seuil d'alerte (80 % du plafond par défaut), puis quand le plafond est atteint. Relu à l'ouverture, toutes les 15 minutes et après
// chaque échange avec l'assistant. Rien pour les autres rôles : la base ne leur rend pas la dépense.
import { etat, entitesAccessibles, permissionsDe, estSuperAdmin } from "../etat.mjs";
import { h } from "../ui.mjs";
import { tr, localeActive } from "../i18n.mjs";
import { etatCredit, entreprisesSuivies } from "../assistant-suivi-calc.mjs";

const noeud = h("div", { class: "bandeau-credit", role: "status", hidden: true });
let ferme = "";
let minuterie = null;

const administre = () => estSuperAdmin() || entreprisesSuivies({ entites: entitesAccessibles(), permissionsDe }).length > 0;
const montant = (x) => tr("{montant} $", { montant: Number(x).toLocaleString(localeActive(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) });

export async function rafraichirBandeauCredit() {
  if (!administre() || !etat.store || !etat.store.assistantBudget) return void (noeud.hidden = true);
  let C = null;
  try {
    C = etatCredit(await etat.store.assistantBudget());
  } catch {
    C = null;
  }
  // Fermé pour ce niveau : il revient au niveau suivant (plafond atteint) ou le mois suivant.
  const niveau = C ? `${C.atteint ? "plafond" : "seuil"}:${C.plafond}` : "";
  if (!C || !C.alerte || niveau === ferme) return void (noeud.hidden = true);
  noeud.replaceChildren(
    h("span", null, C.atteint ? tr("Plafond du mois de l'assistant atteint ({cout} sur {plafond}) : l'assistant est arrêté jusqu'au 1er du mois prochain.", { cout: montant(C.cout), plafond: montant(C.plafond) }) : tr("L'assistant a dépensé {pct} % du plafond du mois ({cout} sur {plafond}).", { pct: C.pct, cout: montant(C.cout), plafond: montant(C.plafond) })),
    h("a", { class: "bouton secondaire petit", href: "#/assistant" }, C.peutRegler ? tr("Régler le plafond") : tr("Voir le suivi")),
    h("button", { class: "bouton-icone", type: "button", "aria-label": tr("Masquer"), onclick: () => ((ferme = niveau), (noeud.hidden = true)) }, "×")
  );
  noeud.classList.toggle("atteint", C.atteint);
  noeud.hidden = false;
}

export function bandeauCredit() {
  rafraichirBandeauCredit();
  if (!minuterie) minuterie = setInterval(rafraichirBandeauCredit, 15 * 60 * 1000);
  return noeud;
}
