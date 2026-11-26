// Le service qu'un paiement règle (26.11.2026, migration 131) : dans la fiche du dossier, un acompte se rattache à un service payé sur place,
// et le dossier dit ce qui reste à régler côté paiements (acompte à rattacher, trop-perçu, remboursement à traiter, remarque de paiement
// contradictoire). La règle elle-même est dans operations-calc.mjs (paiementDuService, alertesPaiements), la même pour les vouchers.
import { etat } from "../etat.mjs";
import { h, champ } from "../ui.mjs";
import { formatMontant, formatDate } from "../calc.mjs";
import { alertesPaiements, statutReservation } from "../operations-calc.mjs";
import { tr } from "../i18n.mjs";

// Les services payés sur place, non annulés, du dossier : ceux auxquels un acompte peut se rattacher.
export const servicesSurPlace = (dossierId) =>
  (etat.db.reservations || []).filter((r) => r.dossier_id === dossierId && r.paye_sur_place && statutReservation(r.statut) !== "annule").sort((a, b) => (a.date_service || "9999").localeCompare(b.date_service || "9999"));

// Le champ « Service payé ». `valeur` : le rattachement actuel (correction d'un paiement). `totalChezNous` : ce que le dossier encaisse pour
// ses services chez nous ; sans eux, un seul service sur place est choisi d'office (l'argent ne peut payer que lui). Avec des services chez
// nous, rien n'est choisi d'office : un paiement sert d'abord ceux-là. Rend null quand le dossier n'a aucun service sur place.
export function champServicePaiement(dossierId, { valeur = null, totalChezNous = 0, devise = "THB", id = "p-service" } = {}) {
  const services = servicesSurPlace(dossierId);
  const actuel = valeur ? (etat.db.reservations || []).find((r) => r.id === valeur) || null : null;
  if (!services.length && !actuel) return null;
  const liste = actuel && !services.includes(actuel) ? [...services, actuel] : services;
  const select = h(
    "select",
    { id },
    h("option", { value: "" }, tr("Le dossier (services chez nous)")),
    liste.map((r) => h("option", { value: r.id }, [r.libelle, r.date_service ? formatDate(r.date_service) : "", r.montant_vente !== null && r.montant_vente !== undefined ? formatMontant(r.montant_vente, devise) : ""].filter(Boolean).join(" · ")))
  );
  select.value = valeur || (services.length === 1 && !(Number(totalChezNous) > 0) ? services[0].id : "");
  const noeud = champ(tr("Service payé"), select, tr("Un acompte pour un service payé sur place : choisissez-le. Son voucher montre alors ce qui est déjà payé et le reste à payer sur place."));
  return { noeud, valeur: () => select.value || null };
}

// Le bloc d'alertes de la section « Paiements reçus ». Vide quand tout va bien.
export function alertesPaiementsDossier(d, resume) {
  const reservations = (etat.db.reservations || []).filter((r) => r.dossier_id === d.id);
  const paiements = (etat.db.paiements || []).filter((p) => p.dossier_id === d.id);
  const devise = (resume && resume.devise) || "THB";
  const m = (x) => formatMontant(x, devise);
  const textes = alertesPaiements({ reservations, paiements, resume }).map((a) =>
    a.code === "a_rattacher"
      ? tr("Acompte à rattacher : {montant} reçus ne sont attribués à aucun des services payés sur place. Corrigez le paiement et choisissez le service, sinon aucun voucher ne montre ce montant.", { montant: m(a.montant) })
      : a.code === "trop_percu"
        ? tr("Trop-perçu de {montant} sur « {service} » : ce qui a été versé dépasse son prix.", { montant: m(a.montant), service: a.libelle })
        : a.code === "remboursement"
          ? tr("Remboursement à traiter : {montant} versés pour « {service} », qui est annulé.", { montant: m(a.montant), service: a.libelle })
          : tr("La remarque de paiement de « {service} » donne un autre montant que l'acompte enregistré ({montant}) : elle n'est pas imprimée sur le voucher.", { montant: m(a.montant), service: a.libelle })
  );
  return textes.length ? h("div", { class: "bandeau-info alertes-paiements", role: "status" }, textes.map((t) => h("p", null, t))) : null;
}

// Le champ `reservation_id` d'un paiement à écrire, seulement quand un service est choisi (la colonne vient de la migration 131).
export const avecService = (valeurs, reservationId) => (reservationId ? { ...valeurs, reservation_id: reservationId } : valeurs);
