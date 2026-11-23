// Le barème d'âge des enfants d'une option du site secrettravelandtour.com, tiré des prix de l'option (`prices[].ages` du fichier produit du site) : { min, max }.
// Lu par regenerer-produits-site.mjs, qui l'écrit dans src/gestion/js/site-produits.mjs (`options[].enfant`) ; testé par tests/gestion-carnet-aonang-lanta.test.js.
// Une ligne de prix est une ligne ENFANT si son libellé commence par « Child » ET (elle porte `ages` OU son libellé est exactement « Child », « Child, 4 to 11 » ou « Child 3 to 9, per person »).
// « Child seat », « Child menu » : ni l'un ni l'autre, ignorées.
//   - Une ligne enfant avec `ages` à deux bornes et un prix compte. Une ligne de gratuité (prix 0, « Child under 4 », `ages: { min: 0, max: 3 }`) ne compte jamais : ce n'est pas un barème.
//   - Une ligne enfant SANS `ages` : reliée à un tarif de Gestion (`reliee`), la génération échoue avec la ligne en cause (le prix de Gestion en dépend) ; non reliée, un avertissement.
//   - Des lignes enfant qui disent des âges différents (quad : conducteur et passager) : pas de barème (`ambigu`), la génération le dit.
const LIBELLE_ENFANT = /^child(?:,?\s+\d+\s*(?:to|-|–)\s*\d+)?(?:,\s*per person)?$/i;
export const estLigneEnfant = (r) => /^child\b/i.test((r && r.label) || "") && (!!(r && r.ages) || LIBELLE_ENFANT.test(r.label.trim()));

export function baremeDeOption(prices, ou = "option", { reliee = () => false } = {}) {
  const plages = new Set();
  const avertissements = [];
  let lignes = 0;
  for (const r of prices || []) {
    if (!estLigneEnfant(r)) continue;
    if (r.amount === 0) continue; // ligne de gratuité
    lignes++;
    const a = r.ages;
    if (!a || typeof a !== "object") {
      if (reliee(r.label)) throw new Error(`${ou} : la ligne enfant « ${r.label} » n'a pas d'âge (ages) sur le site alors qu'elle est reliée à un tarif de Gestion : le barème d'âge ne peut pas être généré.`);
      avertissements.push(`${ou} : la ligne enfant « ${r.label} » n'a pas d'âge (ages) sur le site et n'est reliée à aucun tarif de Gestion : ignorée pour le barème d'âge.`);
      continue;
    }
    if (Number.isFinite(a.min) && Number.isFinite(a.max)) plages.add(`${a.min}-${a.max}`);
  }
  if (plages.size === 1) {
    const [min, max] = [...plages][0].split("-").map(Number);
    return { bareme: { min, max }, ambigu: false, avertissements };
  }
  return { bareme: null, ambigu: plages.size > 1, lignes, avertissements };
}
