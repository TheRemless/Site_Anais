// Filtres d'une liste gardés par entreprise (audit mobile du 26.11.2026, bloquant n° 1) : une recherche ou un onglet choisis
// dans une entreprise ne doivent pas suivre dans une autre, où ils vidaient la liste. On les retrouve en revenant.
export function filtreDeLEntite(memo, entiteId, defaut) {
  if (!memo.has(entiteId)) memo.set(entiteId, { ...defaut });
  return memo.get(entiteId);
}
