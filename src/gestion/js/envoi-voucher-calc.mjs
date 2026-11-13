// Ce que l'écran d'envoi d'un voucher note comme envoyé après un geste, sans rien demander de plus.
// L'écran parle de « client » et de « partenaire », la trace (`details.envois`, voir etatEnvoisVouchers) de « client » et de « prestataire ».
export const CIBLE_ENVOI = { client: "client", partenaire: "prestataire" };

// `issue` : « partage » (la liste de partage du téléphone s'est fermée sur un envoi), « conversation » (la conversation WhatsApp du numéro
// s'est ouverte, l'image copiée), ou toute autre valeur (partage annulé ou en échec, copie refusée, onglet bloqué) qui ne note rien.
// `envois` : la trace actuelle de la réservation. Rien à écrire si l'envoi est déjà noté à cette date (image copiée une deuxième fois).
// Renvoie la clé à noter, ou null.
export function envoiANoter({ pour, issue, envois = {}, date }) {
  const cible = CIBLE_ENVOI[pour];
  if (!cible || (issue !== "partage" && issue !== "conversation")) return null;
  return envois && envois[cible] === date ? null : cible;
}
