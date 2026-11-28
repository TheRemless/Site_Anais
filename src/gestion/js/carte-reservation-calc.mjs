// Carte de réservation : un seul geste principal (l'étape suivante), le reste dans un menu « … ». Logique pure, testée avec node --test.
// `ctx` : { statut, ecrit, aPartenaire, aClient, voucher, liee }
//   voucher : null (pas de voucher) ou { envoye, modifie } (modifié depuis l'envoi : « Renvoyer » redevient le geste principal) ; liee : le service vient d'une ligne de facture en mode excursions (peut se dupliquer).

// L'étape suivante d'une réservation, ou null quand il n'y en a pas (annulée, lecture seule, voucher parti).
// Plus d'étapes de demande au prestataire (Jérémy, 14.11.2026) : une réservation saisie est confirmée, il ne reste qu'à envoyer son voucher.
export function gestePrincipal(ctx) {
  const { statut, ecrit, voucher } = ctx;
  if (!ecrit || statut === "annule") return null;
  return voucher && (!voucher.envoye || voucher.modifie) ? "voucher" : null;
}

// Les autres gestes, dans l'ordre du menu. Un geste qui est déjà le geste principal n'y revient pas.
export function entreesMenu(ctx) {
  const { statut, ecrit, aPartenaire, aClient, voucher, liee } = ctx;
  const principal = gestePrincipal(ctx);
  const l = [];
  // Le rappel du service (fiche avec le texte pour le client et ce qu'il faut dire au partenaire) : pour un service pas annulé.
  if (statut !== "annule") l.push("rappel");
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

// Les gestes du menu « … » par groupe : le voucher en tête, puis ce qui touche le client, puis la réservation elle-même (audit mobile
// n° 38, relecture de la PR 361). Le titre est une clé de traduction déjà au dictionnaire, traduite par tr() dans la vue. Toute clé de entreesMenu doit être dans un groupe :
// sinon elle disparaît du menu sans erreur (tests/gestion-carte-reservation.test.js).
export const GROUPES_MENU = [
  [null, ["voucher"]],
  ["Client", ["message_client", "rappel"]],
  ["Réservation", ["modifier", "changer", "dupliquer", "statut"]],
];
// Les groupes d'une liste de clés, sans groupe vide, dans l'ordre ci-dessus.
export const groupesMenu = (cles) => GROUPES_MENU.map(([titre, liste]) => [titre, liste.filter((k) => cles.includes(k))]).filter(([, liste]) => liste.length);

// ---- Enregistrement de la fiche d'une réservation (relecture de la PR 315) ---------------------------------------------------------
// Ce qui a changé depuis la ligne d'origine `base` : la date, les personnes, le mode de règlement, l'annulation, et l'« avant » que la
// facture compare (suivreFacture). Une carte « Modification » de l'Assistant ouvre la fiche avec la réservation déjà modifiée : la
// comparer à elle-même ne voyait aucun changement, et la facture ne suivait pas.
export function comparaisonEnregistrement(base = {}, valeurs = {}, { surPlace = !!base.paye_sur_place } = {}) {
  const pa = base.personnes || {};
  const pb = valeurs.personnes || {};
  return {
    avant: { date_service: base.date_service, personnes: base.personnes },
    apres: { date_service: valeurs.date_service, personnes: valeurs.personnes },
    dateChangee: (valeurs.date_service || null) !== (base.date_service || null),
    personnesChangees: (Number(pb.adultes) || 0) !== (Number(pa.adultes) || 0) || (Number(pb.enfants) || 0) !== (Number(pa.enfants) || 0),
    modeChange: !!surPlace !== !!base.paye_sur_place,
    annulee: !!base.id && valeurs.statut === "annule" && base.statut !== "annule",
  };
}
