// Ce que la fiche du dossier dit des paiements (26.11.2026, migration 131). L'acompte reste au dossier : la base en impute la part à chaque
// service payé sur place (dossiers_resume.parts) et dit ce qui dépasse (à rembourser après une annulation, sinon trop-perçu). Rien ici ne
// recalcule depuis les paiements en mémoire : tout vient du résumé, le même que le dossier soit ouvert ou non (operations-calc.mjs).
import { etat } from "../etat.mjs";
import { h } from "../ui.mjs";
import { formatMontant, formatDate } from "../calc.mjs";
import { alertesPaiements } from "../operations-calc.mjs";
import { tr } from "../i18n.mjs";

// Le bloc d'alertes de la section « Paiements reçus ». Vide quand tout va bien.
export function alertesPaiementsDossier(d, resume) {
  const reservations = (etat.db.reservations || []).filter((r) => r.dossier_id === d.id);
  const devise = (resume && resume.devise) || "THB";
  const m = (x) => formatMontant(x, devise);
  const textes = alertesPaiements({ reservations, resume }).map((a) =>
    a.code === "remboursement"
      ? tr("Remboursement à traiter : {montant} reçus dépassent ce qui reste dû après l'annulation. Enregistrez le remboursement quand il est fait.", { montant: m(a.montant) })
      : a.code === "repartition"
        ? tr("Acompte réparti entre plusieurs prestataires : {detail}. Vérifiez avant d'envoyer les vouchers.", { detail: a.repartition.map((x) => tr("{montant} imputés à « {service} » du {date}", { montant: m(x.verse), service: x.libelle, date: x.date ? formatDate(x.date) : "?" })).join(", ") })
      : a.code === "trop_percu"
        ? tr("Trop-perçu de {montant} : le dossier a reçu plus que le prix de ses services.", { montant: m(a.montant) })
        : tr("La remarque de paiement de « {service} » donne un autre montant que l'acompte enregistré ({montant}) : elle n'est pas imprimée sur le voucher.", { montant: m(a.montant), service: a.libelle })
  );
  return textes.length ? h("div", { class: "bandeau-info alertes-paiements", role: "status" }, textes.map((t) => h("p", null, t))) : null;
}
