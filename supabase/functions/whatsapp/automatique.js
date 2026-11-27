// Message automatique de nuit (migration 132) dans les lectures de la boîte : il est rangé comme un envoi de l'équipe, mais il n'est jamais
// une réponse de Nani. Toute décision sur « le dernier message » (tri, réponse préparée, « Préparer une réponse », résumé, Prêt à réserver,
// ton de Nani, prix validé par Nani) se prend sans lui ; l'Assistant le voit marqué comme tel. Relecture de la PR 364, point B1.
// Tant que la migration 132 manque, la colonne n'existe pas : la lecture se refait sans elle (42703, PGRST204).
export const estAutomatique = (m) => !!(m && m.automatique);
export const sansAutomatiques = (messages) => (Array.isArray(messages) ? messages : []).filter((m) => !estAutomatique(m));
export const colonneAutomatiqueAbsente = (e) => !!e && (e.code === "42703" || e.code === "PGRST204" || /automatique/.test(String(e.message || "")));
// `lire(colonnes)` construit la requête entière ; rendue avec la colonne automatique, ou sans elle si la migration manque.
export async function avecAutomatique(lire, colonnes) {
  const r = await lire(`${colonnes}, automatique`);
  return colonneAutomatiqueAbsente(r.error) ? await lire(colonnes) : r;
}
