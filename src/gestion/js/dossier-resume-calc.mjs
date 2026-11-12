// Calculs du résumé en tête de la fiche dossier. Aucun accès au navigateur : chaque chiffre vient des fonctions existantes
// (resumeDossier pour le total, le reçu, le reste et le sur place ; commissionsARecevoir pour les commissions), rien n'est deviné.
import { commissionsARecevoir } from "./operations-calc.mjs";

const arr = (n) => Math.round(n * 100) / 100;
const actives = (reservations) => (reservations || []).filter((r) => r.statut !== "annule");

// Les services du dossier par état de demande au prestataire (hors annulés).
export function etatsServices(reservations) {
  const rs = actives(reservations);
  const n = (s) => rs.filter((r) => r.statut === s).length;
  return { total: rs.length, a_demander: n("a_demander"), demande: n("demande"), confirme: n("confirme") };
}

// Nombre de personnes d'un service : adultes, enfants et bébés. Un dossier dont les services n'ont pas tous le même groupe donne une fourchette.
export function personnesDossier(reservations) {
  const effectifs = actives(reservations)
    .map((r) => ["adultes", "enfants", "bebes"].reduce((s, k) => s + (Number(r.personnes && r.personnes[k]) || 0), 0))
    .filter((n) => n > 0);
  return effectifs.length ? { min: Math.min(...effectifs), max: Math.max(...effectifs) } : null;
}

// Commission d'un dossier : prévue, reçue et à recevoir, sur ses services payés sur place. `null` quand aucun service n'est payé sur place.
// `netDe(r)` renvoie la ligne privée de la réservation (droit « nets »). Les commissions réglées gardent leur écart, jamais un reste.
export function commissionDossier(reservations, netDe) {
  const groupes = commissionsARecevoir(actives(reservations), netDe);
  if (!groupes.length) return null;
  const somme = (cle) => arr(groupes.reduce((s, g) => s + g[cle], 0));
  return {
    services: groupes.reduce((s, g) => s + g.nb, 0),
    prevue: somme("commission_prevue"),
    recue: somme("commission_recue"),
    reste: somme("reste"),
    ecart: somme("ecart"),
    sansCommission: groupes.reduce((s, g) => s + g.sansCommission, 0),
    aRecevoir: groupes.reduce((s, g) => s + g.nbARecevoir, 0),
  };
}

// La prochaine chose à faire, une seule, dans l'ordre où elle se présente :
//   envoyer le document pas encore envoyé, noter l'acceptation du devis, demander le premier service à demander, enregistrer un paiement.
// Un dossier « tout sur place » n'a rien à encaisser : jamais d'invitation à enregistrer un paiement.
export function actionSuivante({ annule = false, statut, aEnvoyer = null, avecDevis = false, devisEnvoye = false, accepte = false, facture = false, reservations = [], reste = 0, droit = {} }) {
  // Un devis classé sans suite n'a plus de prochaine étape : seule la réouverture est proposée.
  if (annule || statut === "sans_suite") return null;
  if (droit.docs && aEnvoyer) return { cle: "envoyer", type: aEnvoyer.type };
  if (droit.dossiers && avecDevis && devisEnvoye && !accepte) return { cle: "accepter" };
  const aDemander = droit.dossiers ? actives(reservations).find((r) => r.statut === "a_demander" && r.partenaire_id) : null;
  if (aDemander) return { cle: "demander", reservation: aDemander };
  if (droit.paiements && droit.finances && (accepte || facture) && reste > 0 && statut !== "sur_place" && statut !== "solde") return { cle: "paiement" };
  return null;
}
