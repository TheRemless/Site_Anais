// Carte de réservation : un seul geste principal (l'étape suivante), le reste dans un menu « … ». Logique pure, testée avec node --test.
// `ctx` : { statut, ecrit, aPartenaire, aClient, voucher, liee }
//   voucher : null (pas de voucher) ou { envoye } ; liee : le service vient d'une ligne de facture en mode excursions (peut se dupliquer).

// L'étape suivante d'une réservation, ou null quand il n'y en a pas (annulée, lecture seule, voucher parti).
// Plus d'étapes de demande au prestataire (Jérémy, 14.11.2026) : une réservation saisie est confirmée, il ne reste qu'à envoyer son voucher.
export function gestePrincipal(ctx) {
  const { statut, ecrit, voucher } = ctx;
  if (!ecrit || statut === "annule") return null;
  return voucher && !voucher.envoye ? "voucher" : null;
}

// Les autres gestes, dans l'ordre du menu. Un geste qui est déjà le geste principal n'y revient pas.
export function entreesMenu(ctx) {
  const { statut, ecrit, aPartenaire, aClient, voucher, liee } = ctx;
  const principal = gestePrincipal(ctx);
  const l = [];
  if (aPartenaire) l.push("message_partenaire");
  if (aClient) l.push("message_client");
  if (ecrit) {
    l.push("modifier");
    if (liee) l.push("dupliquer");
    if (aPartenaire && statut !== "annule") l.push("changer");
    if (statut !== "annule" && voucher) l.push("voucher");
    l.push("statut");
  }
  return [...new Set(l)].filter((k) => k !== principal);
}
