// L'Assistant en équipe (migration 133, demande de Jérémy du 27.11.2026) : une administratrice reprend la conversation d'une collègue et y
// écrit comme elle. La fonction « agent » prend la conversation (prendre_agent_conversation, verrou lu en base avec « for update ») avant
// d'écrire quoi que ce soit, et la rend à la fin : deux personnes dans la même conversation n'obtiennent jamais deux réponses mêlées.
// Logique pure, sans dépendance (fonction Supabase et tests node).

// La fonction SQL n'existe pas encore (migration 133 pas appliquée) : l'échange se fait comme avant, sans verrou.
export const fonctionAbsente = (error) => !!error && (error.code === "PGRST202" || error.code === "42883" || /Could not find the function|does not exist/i.test(error.message || ""));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Le résultat de prendre_agent_conversation ({ data, error } du client Supabase), lu une fois :
//   { jeton }  : cette demande a pris la conversation ; la fonction la rendra avec ce jeton ;
//   { libre }  : pas de verrou en base (migration absente), l'échange continue comme avant ;
//   { refus: { corps, status } } : conversation occupée (409, avec qui l'occupe, l'écran le dit), introuvable (404) ou erreur de base (500).
export function lirePrise({ data = null, error = null } = {}) {
  if (error) return fonctionAbsente(error) ? { libre: true } : { refus: { corps: { erreur: "base" }, status: 500 } };
  const r = data && typeof data === "object" ? data : {};
  if (r.ok === true && typeof r.jeton === "string" && UUID.test(r.jeton)) return { jeton: r.jeton };
  if (r.raison === "occupee") {
    const par = typeof r.par === "string" && UUID.test(r.par) ? r.par : null;
    return { refus: { corps: { erreur: "conversation_occupee", ...(par ? { par } : {}) }, status: 409 } };
  }
  if (r.raison === "introuvable") return { refus: { corps: { erreur: "conversation_introuvable" }, status: 404 } };
  return { refus: { corps: { erreur: "base" }, status: 500 } };
}

// La propriétaire d'une nouvelle discussion qui remplace une discussion pleine : celle de l'ancienne, quand une autre personne (l'administration)
// écrit. La base n'accepte ce nom que de l'administration de l'entreprise et pour une personne de l'entreprise (migration 133).
export function proprietaireSuite(ancienne, userId) {
  const u = ancienne && typeof ancienne.user_id === "string" && UUID.test(ancienne.user_id) ? ancienne.user_id : null;
  return u && u !== userId ? { user_id: u } : {};
}
