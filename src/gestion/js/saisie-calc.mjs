// Saisie en cours (19.11.2026) : quand l'outil peut-il redessiner un écran ou se recharger sans rien faire perdre ?
// Logique pure, testée par node --test ; le suivi dans la page est dans saisie.mjs.
//
// Une saisie n'est « en cours » que si un champ VISIBLE a été changé PAR LA PERSONNE et n'a pas encore été enregistré :
//   * la valeur d'origine d'un champ est celle qu'il a au premier geste de la personne sur lui (focus, clic, touche), pas celle que le navigateur
//     croit d'origine (defaultValue). L'outil remplit ses champs par programme (h({ value }), champ.value = …) : avant le 19.11.2026, une fiche
//     dossier ou client ouverte sans rien toucher comptait comme une saisie, et toute liste déroulante aussi (aucune option « par défaut ») ;
//   * recherche, filtres, tris, onglets et choix de l'entreprise ne comptent jamais ;
//   * une fenêtre fermée ne compte jamais (elle n'est plus dans la page, ou elle est masquée) ;
//   * après un enregistrement, l'écran ou la fenêtre est redessiné ou fermé : ses champs repartent sans origine, donc propres.

// La valeur d'un champ, comparable d'un instant à l'autre.
export function signatureChamp(c) {
  if (!c) return "";
  if (c.isContentEditable) return `t:${c.textContent || ""}`;
  if (c.type === "checkbox" || c.type === "radio") return `c:${!!c.checked}`;
  if (c.multiple && c.options) return `m:${[...c.options].filter((o) => o.selected).map((o) => o.value).join("\u0001")}`;
  return `v:${c.value ?? ""}`;
}

// Zones et champs qui ne sont jamais une saisie : recherche (globale, d'une liste, d'un client existant), filtres, tris, onglets, choix de
// l'entreprise ou de la langue. Un écran peut aussi marquer une zone avec data-pas-saisie.
export const ZONES_HORS_SAISIE = "[data-pas-saisie], .barre-filtres, .feuille-filtres, .puces, .palette-fond, .menu, .barre-haut, .feuille-menu, .langues, .combo";
export function champHorsSaisie({ type = "", role = "", id = "", dansZoneHorsSaisie = false } = {}) {
  if (dansZoneHorsSaisie) return true;
  if (type === "search" || type === "button" || type === "submit" || type === "reset" || type === "hidden") return true;
  if (role === "combobox" || role === "searchbox") return true;
  return /^(tri|filtre|recherche)-/.test(id || "");
}

// Un champ suivi est modifié si sa valeur n'est plus celle de son origine. Un champ que la personne n'a jamais touché n'a pas d'origine.
export const champModifie = (origine, actuelle) => origine !== undefined && origine !== actuelle;
