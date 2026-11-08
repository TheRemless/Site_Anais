// Les prix nets ne vivent pas dans le contenu d'un devis ou d'une facture (lisible avec le droit « finances ») mais dans la table
// documents_nets, lisible avec le droit « nets ». Ici, la séparation à l'écriture et la fusion à la lecture. Logique pure.

// { contenu sans nets, nets: { id de la ligne: net } }. Une ligne sans identifiant ne peut pas être rattachée : son net n'est pas gardé.
export function separerNets(contenu) {
  const nets = {};
  if (!contenu || !Array.isArray(contenu.lignes)) return { contenu, nets };
  const lignes = contenu.lignes.map((l) => {
    if (!l || typeof l !== "object" || !("net" in l)) return l;
    const { net, ...reste } = l;
    if (l.id && net !== null && net !== undefined && Number.isFinite(Number(net))) nets[l.id] = Number(net);
    return reste;
  });
  return { contenu: { ...contenu, lignes }, nets };
}

// Remet les nets connus sur les lignes (pour qui a le droit de les lire : les autres ne reçoivent aucune entrée).
export function fusionnerNets(contenu, nets) {
  if (!nets || !contenu || !Array.isArray(contenu.lignes)) return contenu;
  return { ...contenu, lignes: contenu.lignes.map((l) => (l && l.id && nets[l.id] !== undefined && nets[l.id] !== null ? { ...l, net: nets[l.id] } : l)) };
}
