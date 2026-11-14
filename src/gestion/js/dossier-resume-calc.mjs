// Calculs du résumé en tête de la fiche dossier. Aucun accès au navigateur : chaque chiffre vient des fonctions existantes
// (resumeDossier pour le total, le reçu, le reste et le sur place ; commissionsARecevoir pour les commissions), rien n'est deviné.
import { commissionsARecevoir } from "./operations-calc.mjs";

const arr = (n) => Math.round(n * 100) / 100;
const actives = (reservations) => (reservations || []).filter((r) => r.statut !== "annule");

// Nombre de services du dossier (hors annulés).
export function etatsServices(reservations) {
  return { total: actives(reservations).length };
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

// Un voucher est parti quand il a été envoyé au client (même règle que etatEnvoisVouchers) : l'envoi au prestataire n'est plus suivi.
const envoye = (r, cle) => !!(r.details && r.details.envois && r.details.envois[cle]);
const voucherAEnvoyer = (x) => !envoye(x.reservation, "client");

// La prochaine chose à faire, une seule, dans l'ordre où elle se présente.
//   ZTP : envoyer le document pas encore envoyé, noter l'acceptation du devis, créer la facture dès l'acompte reçu, enregistrer un paiement.
//   Secret et Taxi (`excursions`) : envoyer le voucher, puis envoyer la facture et enregistrer un paiement. Le dossier n'entre dans l'outil
//         qu'une fois la place prise chez le prestataire et le client d'accord (Jérémy, 14.11.2026) : plus d'étapes « demander » ni « confirmer ».
// Un dossier « tout sur place » n'a rien à encaisser : jamais d'invitation à enregistrer un paiement. Taxi n'a ni facture ni paiement.
export function actionSuivante({ annule = false, statut, aEnvoyer = null, avecDevis = false, devisEnvoye = false, accepte = false, facture = false, acompteRecu = false, reservations = [], vouchers = [], reste = 0, excursions = false, taxi = false, droit = {} }) {
  // Un devis classé sans suite n'a plus de prochaine étape : seule la réouverture est proposée.
  if (annule || statut === "sans_suite") return null;
  const paiement = droit.paiements && droit.finances && !taxi && (accepte || facture) && reste > 0 && statut !== "sur_place" && statut !== "solde" ? { cle: "paiement" } : null;
  if (excursions) {
    const voucher = droit.finances ? (vouchers || []).find((x) => x.reservation.statut !== "annule" && voucherAEnvoyer(x)) : null;
    if (voucher) return { cle: "voucher", voucher };
    if (droit.docs && aEnvoyer && !taxi) return { cle: "envoyer", type: aEnvoyer.type };
    return paiement;
  }
  if (droit.docs && aEnvoyer) return { cle: "envoyer", type: aEnvoyer.type };
  if (droit.dossiers && avecDevis && devisEnvoye && !accepte) return { cle: "accepter" };
  if (droit.docs && !facture && acompteRecu) return { cle: "facture" };
  return paiement;
}

// Conditions de paiement d'une facture créée depuis le devis. Les variantes des réglages servent aux devis et aux factures ; celle du devis
// parle de « la signature du devis ». Une variante dont le nom dit « facture » est prise à sa place ; sans elle, la facture garde la variante
// du devis (rien n'est inventé) et `manque` le signale. Une variante « perso » écrite à la main pour ce devis est gardée telle quelle.
export function varianteFacture(variantes, actuelle) {
  if (actuelle === "perso") return { variante: "perso", manque: false };
  const sansAccent = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const pourFacture = (variantes || []).find((v) => /\b(facture|invoice)\b/.test(sansAccent(v.nom)));
  return pourFacture ? { variante: pourFacture.id, manque: false } : { variante: actuelle || "", manque: true };
}
