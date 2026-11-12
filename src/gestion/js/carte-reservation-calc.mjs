// Carte de réservation : un seul geste principal (l'étape suivante), le reste dans un menu « … ». Logique pure, testée avec node --test.
// `ctx` : { statut, ecrit, aPartenaire, aClient, passee, relancer, jourDeDemande, voucher, liee }
//   passee : la date du service est passée ; relancer : le prestataire est en retard (relance proposée) ; jourDeDemande : demandée aujourd'hui ;
//   voucher : null (pas de voucher) ou { envoye } ; liee : le service vient d'une ligne de facture en mode excursions (peut se dupliquer).

// L'étape suivante d'une réservation, ou null quand il n'y en a pas (annulée, lecture seule, confirmée et voucher parti).
export function gestePrincipal(ctx) {
  const { statut, ecrit, aPartenaire, passee, relancer, voucher } = ctx;
  if (!ecrit || statut === "annule") return null;
  if (passee && (statut === "a_demander" || statut === "demande")) return "fait";
  if (statut === "a_demander") return aPartenaire ? "demander" : "modifier";
  if (statut === "demande") return aPartenaire ? (relancer ? "relancer" : "confirmer") : "modifier";
  if (statut === "confirme") return voucher && !voucher.envoye ? "voucher" : null;
  return null;
}

// Les autres gestes, dans l'ordre du menu. Un geste qui est déjà le geste principal n'y revient pas.
export function entreesMenu(ctx) {
  const { statut, ecrit, aPartenaire, aClient, jourDeDemande, voucher, liee } = ctx;
  const principal = gestePrincipal(ctx);
  const l = [];
  if (aPartenaire) l.push("message_partenaire");
  if (aClient) l.push("message_client");
  if (ecrit) {
    l.push("modifier");
    if (liee) l.push("dupliquer");
    if (aPartenaire && statut !== "annule") l.push("changer");
    if (aPartenaire && statut === "demande") l.push("confirmer", "autre_reponse", "relancer");
    if (aPartenaire && statut === "demande" && jourDeDemande) l.push("pas_envoyee");
    if (aPartenaire && statut === "a_demander") l.push("demander");
    if (statut === "confirme" && voucher) l.push("voucher");
    if (statut === "a_demander" || statut === "demande") l.push("fait");
    l.push("statut");
  }
  return [...new Set(l)].filter((k) => k !== principal);
}
