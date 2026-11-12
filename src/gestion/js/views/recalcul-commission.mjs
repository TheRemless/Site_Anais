// Recalculer la commission prévue de réservations qui existaient avant la règle chiffrée du partenaire.
// Un tap sur une réservation, ou un lot par partenaire avec l'aperçu de ce qui change avant d'appliquer.
import { etat, peut, netReservation, enregistrerLie, dossiersAnnules, nomPartenaire, nomClient } from "../etat.mjs";
import { h, modal, toast } from "../ui.mjs";
import { formatDate } from "../calc.mjs";
import { recalculerCommissions } from "../operations-calc.mjs";
import { regleCommissionDe } from "./mode-reglement.mjs";
import { voitNets, prix } from "./partenaires.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";

const contexte = () => ({ regleDe: regleCommissionDe, netDe: netReservation, ecartees: dossiersAnnules() });
const peutRecalculer = () => voitNets() && peut("dossiers.ecrire");
const enregistrer = (x) => enregistrerLie("reservations_nets", "reservation_id", x.reservation.id, { commission_prevue: x.apres });

// La réservation a-t-elle une commission à recalculer ? (sur place, règle complète, valeur différente de celle enregistrée)
export function commissionARecalculer(r) {
  if (!peutRecalculer()) return null;
  return recalculerCommissions([r], contexte()).changements[0] || null;
}

// Une commission déjà reçue dont la valeur prévue s'écarte de la règle du partenaire : signalée sur la carte, jamais modifiée.
export function ecartCommissionRecue(r) {
  if (!peutRecalculer()) return null;
  return recalculerCommissions([r], contexte()).ecartsRecus[0] || null;
}

// Un tap : applique la valeur calculée. Renvoie true si une commission a été enregistrée.
export async function recalculerUneCommission(r, apres = () => {}) {
  const t = recalculerCommissions([r], contexte());
  if (!t.changements.length) {
    toast(t.impossibles ? tr("Commission impossible à calculer : la règle du partenaire ou le net manque.") : tr("La commission est déjà à jour."), !!t.impossibles);
    return false;
  }
  try {
    await enregistrer(t.changements[0]);
    toast(tr("Commission recalculée : {montant}.", { montant: prix(t.changements[0].apres) }));
    apres();
    return true;
  } catch (err) {
    toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    return false;
  }
}

// Lot : toutes les réservations (d'un partenaire, ou de tous) avec un aperçu. Par défaut seules les commissions absentes sont remplies, pour ne pas
// écraser une valeur saisie à la main.
export function ouvrirRecalculCommissions(partenaireId = null, apres = () => {}) {
  if (!peutRecalculer()) return;
  const seulementVides = h("input", { type: "checkbox", id: "rc-vides", checked: true });
  const resume = h("p", { "aria-live": "polite" });
  const liste = h("ul", { class: "cartes liste-recalcul" });
  const bouton = h("button", { class: "principal", type: "submit" }, tr("Appliquer"));
  let courant = null;
  const maj = () => {
    courant = recalculerCommissions(etat.db.reservations, contexte(), { partenaireId, seulementVides: seulementVides.checked });
    const n = courant.changements.length;
    resume.textContent = `${pluriel(n, N_("{n} commission à enregistrer"), N_("{n} commissions à enregistrer"))}${courant.inchanges ? ` · ${tr("{n} déjà justes", { n: courant.inchanges })}` : ""}${courant.impossibles ? ` · ${tr("{n} impossibles (règle ou net manquant)", { n: courant.impossibles })}` : ""}`;
    liste.replaceChildren(...courant.changements.slice(0, 40).map((x) => {
      const d = etat.db.dossiers.find((y) => y.id === x.reservation.dossier_id);
      const client = d ? nomClient(etat.db.clients.find((c) => c.id === d.client_id)) : "";
      return h("li", { class: "carte" }, h("span", { class: "carte-titre" }, [client, x.reservation.libelle, x.reservation.date_service ? formatDate(x.reservation.date_service) : ""].filter(Boolean).join(" · ")), h("span", { class: "carte-droite" }, h("strong", null, x.avant === null ? prix(x.apres) : `${prix(x.avant)} → ${prix(x.apres)}`)));
    }));
    bouton.disabled = n === 0;
  };
  seulementVides.addEventListener("change", maj);
  maj();
  const fermer = modal(
    tr("Recalculer les commissions{partenaire}", { partenaire: partenaireId ? ` · ${nomPartenaire(partenaireId)}` : "" }),
    h(
      "form",
      {
        class: "modal-corps",
        onsubmit: async (e) => {
          e.preventDefault();
          bouton.disabled = true;
          try {
            for (const x of courant.changements) await enregistrer(x);
            fermer();
            toast(tr("Commissions recalculées."));
            apres();
          } catch (err) {
            toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
            bouton.disabled = false;
          }
        },
      },
      h("p", { class: "aide" }, tr("Pour les services payés sur place dont la commission n'est pas encore reçue : la règle du partenaire est appliquée aux réservations déjà créées.")),
      h("label", { class: "case", for: "rc-vides" }, seulementVides, tr("Seulement celles qui n'ont pas encore de commission prévue")),
      resume,
      liste,
      h("div", { class: "actions" }, h("button", { class: "secondaire", type: "button", onclick: () => fermer() }, tr("Annuler")), bouton)
    ),
    { protege: false }
  );
}
