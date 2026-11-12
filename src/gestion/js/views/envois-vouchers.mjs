// Trace des envois de vouchers : à qui, quand. Un voucher « envoyé » n'est plus une supposition déduite du paiement.
// `noterEnvoi(r, cible)` peut être appelée par l'écran d'envoi quand un voucher part ; en attendant, « Noter les envois » le fait à la main.
import { etat, modifier, peut, nomPartenaire } from "../etat.mjs";
import { h, modal, toast } from "../ui.mjs";
import { aujourdhui, formatDate } from "../calc.mjs";
import { detailsAvecEnvoi } from "../operations-calc.mjs";
import { tr } from "../i18n.mjs";

// `cible` : « client » ou « prestataire ». Renvoie true si c'est noté.
export async function noterEnvoi(r, cible, date = aujourdhui()) {
  try {
    const courante = etat.db.reservations.find((x) => x.id === r.id) || r;
    await modifier("reservations", r.id, { details: detailsAvecEnvoi(courante.details, cible, date) });
    return true;
  } catch (err) {
    toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    return false;
  }
}

// Fenêtre « Noter les envois » : un voucher par ligne, avec le client et le prestataire.
export function ouvrirEnvois(vouchers, apres) {
  const liste = h("ul", { class: "envois-liste" });
  const dessiner = () => {
    liste.replaceChildren(
      ...vouchers.map(({ reservation: r }) => {
        const courante = etat.db.reservations.find((x) => x.id === r.id) || r;
        const envois = (courante.details && courante.details.envois) || {};
        const cases = [["client", tr("Client")], ...(r.partenaire_id ? [["prestataire", nomPartenaire(r.partenaire_id) || tr("Prestataire")]] : [])];
        return h(
          "li",
          { class: "envois-ligne" },
          h("strong", null, r.libelle),
          h("div", { class: "envois-cibles" }, cases.map(([cle, nom]) => (envois[cle] ? h("span", { class: "tag" }, tr("{nom} : envoyé le {date}", { nom, date: formatDate(envois[cle]) })) : h("button", { class: "secondaire petit", type: "button", disabled: !peut("dossiers.ecrire"), onclick: async () => { if (await noterEnvoi(courante, cle)) { dessiner(); apres(); } } }, tr("{nom} : marquer envoyé", { nom })))))
        );
      })
    );
  };
  dessiner();
  const fermer = modal(tr("Envois des vouchers"), h("div", { class: "modal-corps" }, h("p", { class: "aide" }, tr("Notez ici ce qui est vraiment parti, par client et par prestataire. L'étape du dossier ne passe à « fait » que lorsque tout est envoyé.")), liste, h("div", { class: "actions" }, h("button", { class: "principal", type: "button", onclick: () => fermer() }, tr("Fermer")))), { protege: false });
}
