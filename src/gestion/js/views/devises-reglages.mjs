// Noms et symboles des devises imprimés sur les documents ({devise_nom} des conditions, symbole des équivalents), réglables sans développeur.
// Une ligne par devise : « CODE | nom | symbole ». Vide : les valeurs par défaut (Swiss Franc, Euro €, Thai Baht, US Dollar $…).
import { h, champ } from "../ui.mjs";
import { lireDevisesNoms, ecrireDevisesNoms, DEVISES_DEFAUT } from "../documents-calc.mjs";
import { tr } from "../i18n.mjs";

// `r` : les réglages en cours d'édition ; `marque` : signale une modification non enregistrée.
export function champDevisesNoms(r, marque) {
  const zone = h("textarea", { rows: 4, placeholder: ecrireDevisesNoms(DEVISES_DEFAUT) });
  zone.value = ecrireDevisesNoms(r.devises_noms);
  zone.addEventListener("input", () => {
    r.devises_noms = lireDevisesNoms(zone.value);
    marque();
  });
  return champ(tr("Noms et symboles des devises, une par ligne : code | nom | symbole"), zone, tr("Le nom remplace {devise_nom} dans les conditions de paiement, le symbole s'affiche dans les équivalents. Vide : les valeurs grisées."));
}
