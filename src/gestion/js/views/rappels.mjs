// Fenêtre « Rappels » : activer ou couper les notifications de ce téléphone.
import { etat } from "../etat.mjs";
import { h, modal, toast } from "../ui.mjs";
import { tr } from "../i18n.mjs";
import { situation, activer, desactiver, essai } from "../rappels.mjs";

export function ouvrirRappels() {
  const corps = h("div", { class: "modal-corps rappels" });
  const fermer = modal(tr("Rappels sur ce téléphone"), corps);
  async function dessiner() {
    corps.replaceChildren(h("p", { class: "aide" }, tr("Chargement…")));
    let s;
    try {
      s = await situation(etat.store);
    } catch (err) {
      s = "indisponible";
    }
    const actionner = (libelle, classe, travail, succes) =>
      h("button", {
        class: classe,
        type: "button",
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await travail();
            if (succes) toast(succes);
          } catch (err) {
            toast(tr("Rappels impossibles : {message}", { message: err.message }), true);
          }
          dessiner();
        },
      }, libelle);
    const etatTexte = {
      installer: tr("Sur iPhone, ajoutez d'abord Gestion à l'écran d'accueil (bouton Partager, puis « Sur l'écran d'accueil »), puis ouvrez-la depuis cette icône pour activer les rappels."),
      refuse: tr("Les notifications sont refusées pour Gestion. Réactivez-les dans les réglages du téléphone (Notifications), puis revenez ici."),
      indisponible: tr("Ce navigateur ne sait pas recevoir de rappels. Essayez depuis l'app ajoutée à l'écran d'accueil."),
      inactif: tr("Les rappels ne sont pas activés sur cet appareil."),
      actif: tr("Les rappels sont actifs sur cet appareil."),
    }[s];
    corps.replaceChildren(
      h("ul", { class: "liste-aide" },
        h("li", null, h("strong", null, tr("18h, la veille")), tr("Les services du lendemain, avec ceux qui n'ont pas d'heure de pickup ou pas de confirmation.")),
        h("li", null, h("strong", null, tr("9h, le lendemain")), tr("Les clients dont un service a eu lieu la veille, à recontacter pour avoir leur avis."))
      ),
      h("p", { class: "aide" }, tr("Heure de Bangkok. La notification ne contient aucun nom de client : le détail s'ouvre dans l'outil.")),
      h("p", { class: "rappels-etat", role: "status" }, etatTexte),
      h("div", { class: "actions gauche" },
        s === "inactif" ? actionner(tr("Activer les rappels"), "principal", async () => { const reg = await activer(etat.store); await essai(reg); }, tr("Rappels activés sur cet appareil.")) : null,
        s === "actif" ? actionner(tr("Envoyer un essai"), "secondaire", essai) : null,
        s === "actif" ? actionner(tr("Désactiver"), "secondaire", () => desactiver(etat.store), tr("Rappels désactivés sur cet appareil.")) : null,
        h("button", { class: "secondaire", type: "button", onclick: fermer }, tr("Fermer"))
      )
    );
  }
  dessiner();
}
