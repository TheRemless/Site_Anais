// L'envoi d'une demande et le sort de sa carte (relecture n° 3 de la PR 366, migration 133). La carte est PRISE avant d'appeler GitHub
// (prendre_agent_carte_equipe, for update) et ne passe « validée » qu'une fois l'issue créée. GitHub en panne : la carte est rendue, la
// ligne effacée, la carte reste à envoyer et l'écran dit l'erreur. Une carte déjà décidée ou tenue par une autre personne : rien ne part.
// Chaque étape est passée par la fonction (base, GitHub) : la logique se teste sans réseau.
//   prendre()            → { ok } ou { ok: false, raison, par, depuis } ; { ok: true } sans la migration 133. Une prise expirée d'une autre
//                          personne rend « carte_expiree » (avec qui) : l'écran propose « Reprendre la carte » et renvoie avec `forcer`.
// Issue créée mais carte pas notée validée (deux essais) : { amelioration, carte: null, a_confirmer: true }. La ligne porte déjà son
// issue_numero et une carte n'envoie qu'une demande (index.ts, « deja ») : aucune issue ne repart en double.
//   creerIssue()         → { number, html_url } ou null (une exception compte comme une panne)
//   enregistrerIssue(i)  → la ligne « ameliorations » à jour
//   valider()            → la carte validée, ou null
//   relire()             → la carte telle qu'elle est en base, ou null : déjà « validee » (la fonction « rappels » l'a passée entre
//                          l'enregistrement de l'issue et la validation, valider_cartes_ameliorations_envoyees), c'est un succès
//   rendre(), effacerLigne()
export async function envoyerAvecCarte({ prendre, creerIssue, enregistrerIssue, valider, rendre, effacerLigne, relire = async () => null }) {
  const p = await prendre().catch(() => ({ ok: false, raison: "erreur" }));
  if (!p || p.ok !== true) {
    await effacerLigne();
    if (p && p.raison === "erreur") return { erreur: "base", statut: 500 };
    if (p && p.raison === "expiree") return { erreur: "carte_expiree", statut: 409, ...(p.par ? { par: p.par } : {}), ...(p.depuis ? { depuis: p.depuis } : {}) };
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
  // Une carte déjà validée par « rappels » (elle porte l'issue de cette ligne : rappels ne valide que les cartes dont la ligne a un
  // issue_numero) compte comme validée : jamais « à confirmer » à tort.
  const dejaValidee = async () => {
    const c = await relire().catch(() => null);
    return c && c.statut === "validee" ? c : null;
  };
  const carte = (await valider().catch(() => null)) || (await dejaValidee()) || (await valider().catch(() => null)) || (await dejaValidee());
  return carte ? { amelioration, carte } : { amelioration, carte: null, a_confirmer: true };
}
