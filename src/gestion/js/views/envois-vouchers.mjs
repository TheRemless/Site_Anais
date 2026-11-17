// Trace des envois de vouchers : à qui, quand. Un voucher « envoyé » n'est plus une supposition déduite du paiement.
// `noterEnvoi(r, cible)` est appelée par l'écran d'envoi (voucher-envoi.mjs) quand un voucher part : partage terminé ou conversation WhatsApp ouverte.
// « Noter les envois » sert à corriger : un envoi fait hors de Gestion, parti depuis le partage du système sans destinataire connu, ou noté par
// erreur (« Pas envoyé », audit du 16.11.2026, n° 62).
// Un envoi au client fige le voucher (numéro, modèle, ce qu'il lisait dans le catalogue, empreinte) : voir figerVoucher dans voucher.mjs.
import { etat, modifier, peut } from "../etat.mjs";
import { h, modal, toast } from "../ui.mjs";
import { aujourdhui, formatDate } from "../calc.mjs";
import { detailsAvecEnvoi, detailsSansEnvoi } from "../operations-calc.mjs";
import { vouchersDuDossier, figerVoucher } from "./voucher.mjs";
import { tr } from "../i18n.mjs";

// `cible` : « client » (« prestataire » reste lisible dans les anciennes traces). Renvoie true si c'est noté.
export async function noterEnvoi(r, cible, date = aujourdhui()) {
  try {
    const courante = etat.db.reservations.find((x) => x.id === r.id) || r;
    let details = detailsAvecEnvoi(courante.details, cible, date);
    if (cible === "client") {
      const x = vouchersDuDossier(courante.dossier_id).find((y) => y.reservation.id === courante.id);
      if (x) details = { ...details, voucher_fige: figerVoucher(x, date) };
    }
    await modifier("reservations", r.id, { details });
    return true;
  } catch (err) {
    toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    return false;
  }
}

// « Pas envoyé » : l'envoi noté par erreur s'efface, avec ce qui avait été figé. Renvoie true si c'est fait.
export async function annulerEnvoi(r, cible = "client") {
  try {
    const courante = etat.db.reservations.find((x) => x.id === r.id) || r;
    await modifier("reservations", r.id, { details: detailsSansEnvoi(courante.details, cible) });
    return true;
  } catch (err) {
    toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    return false;
  }
}

// Fenêtre « Noter les envois » : un voucher par ligne, envoyé ou non au client.
export function ouvrirEnvois(vouchers, apres) {
  const liste = h("ul", { class: "envois-liste" });
  const ecrit = peut("dossiers.ecrire");
  const dessiner = () => {
    // Relus à chaque dessin : un envoi noté ou retiré change l'état « modifié depuis l'envoi » et le numéro.
    const frais = new Map((vouchers.length ? vouchersDuDossier(vouchers[0].reservation.dossier_id) : []).map((x) => [x.reservation.id, x]));
    liste.replaceChildren(
      ...vouchers.map(({ reservation: r }) => {
        const courante = etat.db.reservations.find((x) => x.id === r.id) || r;
        const envois = (courante.details && courante.details.envois) || {};
        const x = frais.get(r.id);
        const modifie = !!(x && x.envoi && x.envoi.modifie);
        const cases = [["client", tr("Client")]];
        return h(
          "li",
          { class: "envois-ligne" },
          h("strong", null, r.libelle),
          h(
            "div",
            { class: "envois-cibles" },
            cases.map(([cle, nom]) =>
              envois[cle]
                ? h(
                    "span",
                    { class: "envois-fait" },
                    h("span", { class: "tag" }, tr("{nom} : envoyé le {date}", { nom, date: formatDate(envois[cle]) })),
                    modifie ? h("span", { class: "tag tag-alerte" }, tr("modifié depuis l'envoi")) : null,
                    " ",
                    h("button", { class: "lien petit", type: "button", disabled: !ecrit, title: tr("L'envoi a été noté par erreur : il s'efface, et le numéro du voucher n'est plus figé."), onclick: async () => { if (await annulerEnvoi(courante, cle)) { toast(tr("Envoi retiré.")); dessiner(); apres(); } } }, tr("Pas envoyé"))
                  )
                : h("button", { class: "secondaire petit", type: "button", disabled: !ecrit, onclick: async () => { if (await noterEnvoi(courante, cle)) { dessiner(); apres(); } } }, tr("{nom} : marquer envoyé", { nom }))
            )
          )
        );
      })
    );
  };
  dessiner();
  const fermer = modal(tr("Envois des vouchers"), h("div", { class: "modal-corps" }, h("p", { class: "aide" }, tr("Notez ici les vouchers vraiment partis chez le client. L'étape du dossier passe à « fait » quand tous sont envoyés. « Pas envoyé » retire un envoi noté par erreur.")), liste, h("div", { class: "actions" }, h("button", { class: "principal", type: "button", onclick: () => fermer() }, tr("Fermer")))), { protege: false });
}
