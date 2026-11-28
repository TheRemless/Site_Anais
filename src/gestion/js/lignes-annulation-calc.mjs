// Supprimer une ligne de devis ou de facture, puis l'annuler depuis le toast (relecture de la PR #360, 26.11.2026).
// Un service emporte ses options (lignes rattachées par `option_de`, PR #359). L'annulation remet SEULEMENT les lignes retirées, chacune
// juste après la ligne qui la précédait avant la suppression : une ligne ajoutée ou modifiée entre-temps reste. Quand cette ligne voisine
// n'est plus là (supprimée ou remplacée), la place n'est plus sûre : remettreLignes rend null et l'éditeur le dit au lieu de deviner.

// Retire la ligne `i` et ses options. Rend { lignes, retirees: [{ ligne, avant }], options } : `avant` est la ligne qui précédait celle-ci
// dans la liste d'origine (null en tête), `options` le nombre d'options parties avec le service.
export function retirerLigne(lignes, i) {
  const liste = lignes || [];
  const service = liste[i];
  if (!service) return { lignes: [...liste], retirees: [], options: 0 };
  const part = (l) => l === service || (service.id && l && l.option_de === service.id);
  const retirees = [];
  liste.forEach((l, k) => {
    if (part(l)) retirees.push({ ligne: l, avant: k > 0 ? liste[k - 1] : null });
  });
  return { lignes: liste.filter((l) => !part(l)), retirees, options: retirees.length - 1 };
}

// Remet les lignes retirées dans `actuelles` (la liste d'aujourd'hui). Rend la nouvelle liste, ou null si la réinsertion est ambiguë :
// une ligne retirée est déjà revenue, ou la ligne qui la précédait n'est plus dans la liste.
export function remettreLignes(actuelles, retrait) {
  const liste = [...(actuelles || [])];
  if (!retrait || !retrait.retirees || !retrait.retirees.length) return null;
  if (retrait.retirees.some((x) => liste.includes(x.ligne))) return null;
  for (const { ligne, avant } of retrait.retirees) {
    if (avant === null) {
      liste.unshift(ligne);
      continue;
    }
    const k = liste.indexOf(avant);
    if (k < 0) return null;
    liste.splice(k + 1, 0, ligne);
  }
  return liste;
}
