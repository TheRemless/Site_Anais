// Le barème d'âge des enfants d'une option du site secrettravelandtour.com, tiré des prix de l'option (`prices[].ages` du fichier produit du site) : { min, max }.
// Lu par regenerer-produits-site.mjs, qui l'écrit dans src/gestion/js/site-produits.mjs (`options[].enfant`) ; testé par tests/gestion-carnet-aonang-lanta.test.js.
//   - Toutes les lignes « Child… » comptent, qu'elles soient reliées à un tarif de Gestion ou non (une ligne sans tarif en base ne fait pas disparaître le barème).
//   - Une ligne « Child… » sans `ages` fait ÉCHOUER la génération, avec la ligne en cause : le barème ne se devine pas du libellé.
//   - Une ligne qui ne donne qu'un côté (« Child under 4 », `ages: { max: 3 }`) est une ligne de gratuité : ignorée.
//   - Des lignes enfant qui disent des âges différents (quad : conducteur et passager) : pas de barème (`ambigu`), la génération le dit.
export function baremeDeOption(prices, ou = "option") {
  const plages = new Set();
  let lignes = 0;
  for (const r of prices || []) {
    if (!/^child\b/i.test(r.label || "")) continue;
    lignes++;
    const a = r.ages;
    if (!a || typeof a !== "object") throw new Error(`${ou} : la ligne enfant « ${r.label} » n'a pas d'âge (ages) sur le site : le barème d'âge de Gestion ne peut pas être généré.`);
    if (Number.isFinite(a.min) && Number.isFinite(a.max)) plages.add(`${a.min}-${a.max}`);
  }
  if (plages.size === 1) {
    const [min, max] = [...plages][0].split("-").map(Number);
    return { bareme: { min, max }, ambigu: false };
  }
  return { bareme: null, ambigu: plages.size > 1, lignes };
}
