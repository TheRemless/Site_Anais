// « Carnet envoyé » : noter la date d'envoi du carnet de voyage, ou la corriger ou la retirer. Le solde devient dû à cette date.
import { etat, modifier } from "../etat.mjs";
import { h, modal, toast, erreurChamp } from "../ui.mjs";
import { aujourdhui, formatDate } from "../calc.mjs";
import { tr } from "../i18n.mjs";
import { dateValide, valeursCarnet, valeursRetirer } from "../carnet-calc.mjs";

export const baseDistante = () => etat.store.mode === "supabase";

async function enregistrer(d, valeurs, message, apres) {
  try {
    await modifier("dossiers", d.id, valeurs);
  } catch (err) {
    return toast(tr("Le carnet n'a pas pu être enregistré : {message}", { message: err.message }), true);
  }
  toast(message);
  if (apres) apres();
}

export function ouvrirCarnet(d, apres) {
  const ajd = aujourdhui();
  const date = h("input", { id: "carnet-date", type: "date", value: d.carnet_envoye_le || ajd, max: ajd });
  const retirer = d.carnet_envoye_le ? h("button", { class: "secondaire", type: "button", onclick: () => (fermer(), enregistrer(d, valeursRetirer(), tr("Date d'envoi du carnet retirée."), apres)) }, tr("Retirer la date")) : null;
  const fermer = modal(
    d.carnet_envoye_le ? tr("Date d'envoi du carnet") : tr("Carnet de voyage envoyé"),
    h(
      "form",
      {
        class: "modal-corps",
        onsubmit: (e) => {
          e.preventDefault();
          erreurChamp(date, "");
          if (!dateValide(date.value, ajd)) return erreurChamp(date, tr("Indiquez une date valide, au plus tard aujourd'hui."));
          fermer();
          enregistrer(d, valeursCarnet(date.value), tr("Carnet noté au {date} : le solde est à régler dès cette date.", { date: formatDate(date.value) }), apres);
        },
      },
      h("p", { class: "aide" }, tr("Le solde est à régler à la réception du carnet. Il passera dans « À faire » à partir de cette date. Sans carnet envoyé, il est relevé 30 jours avant le départ.")),
      h("div", { class: "champ" }, h("label", { for: "carnet-date" }, tr("Carnet envoyé le")), date),
      h("div", { class: "actions" }, retirer, h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))
    ),
    { feuille: true, protege: false }
  );
}
