// Ce que l'écran d'envoi d'un voucher note comme envoyé après un geste, sans rien demander de plus.
// L'écran parle de « client » et de « partenaire », la trace (`details.envois`, voir etatEnvoisVouchers) de « client » et de « prestataire ».
export const CIBLE_ENVOI = { client: "client", partenaire: "prestataire" };

// `issue` : « partage » (la liste de partage du téléphone s'est fermée sur un envoi), « conversation » (la conversation WhatsApp du numéro
// s'est ouverte, l'image copiée), « manuel » (la personne dit l'avoir envoyé elle-même, image ou PDF enregistrés puis envoyés hors de WhatsApp :
// contrôle du 17.11.2026, D5), « gestion » (image envoyée par Gestion dans la conversation WhatsApp du client, confirmée par Telnyx,
// 21.11.2026), ou toute autre valeur (partage annulé ou en échec, copie refusée, onglet bloqué) qui ne note rien.
// `envois` : la trace actuelle de la réservation. Rien à écrire si l'envoi est déjà noté à cette date (image copiée une deuxième fois),
// sauf si le voucher a changé depuis (`modifie`, lot B du 17.11.2026) : le renvoi du jour doit figer la nouvelle version.
// Renvoie la clé à noter, ou null.
export function envoiANoter({ pour, issue, envois = {}, date, modifie = false }) {
  const cible = CIBLE_ENVOI[pour];
  if (!cible || !["partage", "conversation", "manuel", "gestion"].includes(issue)) return null;
  return envois && envois[cible] === date && !modifie ? null : cible;
}
