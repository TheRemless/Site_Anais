// Filtres d'une liste gardés par entreprise (audit mobile du 26.11.2026, bloquant n° 1) : une recherche ou un onglet choisis
// dans une entreprise ne doivent pas suivre dans une autre, où ils vidaient la liste. On les retrouve en revenant.
export function filtreDeLEntite(memo, entiteId, defaut) {
  if (!memo.has(entiteId)) memo.set(entiteId, { ...defaut });
  return memo.get(entiteId);
}

// L'adresse de la liste des dossiers garde l'onglet et le tri avec l'entreprise à qui ils appartiennent (e=…) : un rechargement ou un favori
// retrouve la même liste, mais par le retour arrière l'onglet d'Agence ne s'applique plus à Excursions (relecture de la PR #357).
// La recherche n'y est pas écrite (des noms de clients dans l'historique du navigateur) : elle reste dans le filtre gardé par entreprise.
const marque = (entiteId) => String(entiteId ?? "-");
export function adresseListe(filtre, entiteId) {
  return `#/dossiers?e=${encodeURIComponent(marque(entiteId))}&onglet=${encodeURIComponent(filtre.onglet)}&tri=${encodeURIComponent(filtre.tri)}`;
}

// Ce que l'adresse change au filtre gardé. Notre propre adresse (e = entreprise active) rend l'onglet et le tri et garde la recherche : un
// redessin en direct ou un retour arrière ne la perd plus. Celle d'une autre entreprise ne change rien. Un lien venu d'ailleurs, sans e
// (chiffres du tableau de bord : #/dossiers?onglet=encaisser), ouvre son onglet sur une liste sans recherche, ou pose la sienne (?q=…).
export function filtreDepuisAdresse(params, entiteId, { onglets = [], tris = [] } = {}) {
  const e = params.get("e");
  if (e !== null && e !== marque(entiteId)) return {};
  const r = {};
  const onglet = params.get("onglet");
  const tri = params.get("tri");
  if (onglets.includes(onglet)) r.onglet = onglet;
  if (tris.includes(tri)) r.tri = tri;
  if (e === null) {
    if (params.has("q")) r.q = params.get("q");
    else if (r.onglet) r.q = "";
  }
  return r;
}
