// L'envoi d'une demande et le sort de sa carte (relecture n° 3 de la PR 366, migration 133). La carte est PRISE avant d'appeler GitHub
// (prendre_agent_carte_equipe, for update) et ne passe « validée » qu'une fois l'issue créée. GitHub en panne : la carte est rendue, la
// ligne effacée, la carte reste à envoyer et l'écran dit l'erreur. Une carte déjà décidée ou tenue par une autre personne : rien ne part.
// Chaque étape est passée par la fonction (base, GitHub) : la logique se teste sans réseau.
//   prendre()            → { ok } ou { ok: false, raison } ; { ok: true } sans la migration 133
//   creerIssue()         → { number, html_url } ou null (une exception compte comme une panne)
//   enregistrerIssue(i)  → la ligne « ameliorations » à jour
//   valider()            → la carte validée, ou null
//   rendre(), effacerLigne()
export async function envoyerAvecCarte({ prendre, creerIssue, enregistrerIssue, valider, rendre, effacerLigne }) {
  const p = await prendre().catch(() => ({ ok: false, raison: "erreur" }));
  if (!p || p.ok !== true) {
    await effacerLigne();
    if (p && p.raison === "erreur") return { erreur: "base", statut: 500 };
    return { erreur: p && p.raison === "decidee" ? "deja_decidee" : "carte_prise", statut: 409 };
  }
  let issue = null;
  try {
    issue = await creerIssue();
  } catch {
    issue = null;
  }
  if (!issue || !issue.number || !issue.html_url) {
    await rendre().catch(() => {});
    await effacerLigne();
    return { erreur: "github_indisponible", statut: 502 };
  }
  const amelioration = await enregistrerIssue(issue);
  const carte = await valider().catch(() => null);
  return { amelioration, carte };
}
