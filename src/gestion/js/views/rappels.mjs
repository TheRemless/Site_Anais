// Fenêtre « Rappels » : activer ou couper les notifications de ce téléphone, et son propre « Rappel 1 h avant » (migration 31, réglage du profil).
import { etat, reglages } from "../etat.mjs";
import { rappelAvantActif, modeRappel } from "../rappel-h1-calc.mjs";
import { h, modal, toast } from "../ui.mjs";
import { tr } from "../i18n.mjs";
import { situation, activer, desactiver, essai } from "../rappels.mjs";

export function ouvrirRappels() {
  const corps = h("div", { class: "modal-corps rappels" });
  const fermer = modal(tr("Rappels"), corps);
  // Interrupteur du profil : suit la personne sur tous ses appareils. Le réglage de l'entreprise passe avant (Réglages, « Rappel 1 h avant »).
  function blocH1() {
    const actif = etat.moi.rappel_h1 !== false;
    const entreprise = rappelAvantActif(reglages());
    const depart = modeRappel(reglages()) === "depart";
    const caseH1 = h("input", { type: "checkbox", id: "rappel-h1-moi", checked: actif, onchange: async (e) => {
      const voulu = e.target.checked;
      e.target.disabled = true;
      try {
        await etat.store.definirRappelH1(voulu);
        etat.moi.rappel_h1 = voulu;
        const p = etat.brut.profils.find((x) => x.user_id === etat.moi.user_id);
        if (p) p.rappel_h1 = voulu;
        toast(voulu ? tr("Rappel 1 h avant activé pour vous.") : tr("Rappel 1 h avant coupé pour vous."));
      } catch (err) {
        e.target.checked = !voulu;
        toast(/rappel_h1|definir_rappel_h1|function|column/i.test(err.message) ? tr("Ce réglage attend la migration 31 de la base.") : tr("Réglage impossible : {message}", { message: err.message }), true);
      }
      e.target.disabled = false;
    } });
    return h(
      "div",
      { class: "rappel-h1-profil" },
      h("label", { class: "case" }, caseH1, h("span", null, h("strong", null, depart ? tr("Rappel la veille du départ") : tr("Rappel 1 h avant chaque service")), h("br"), depart ? tr("La veille à 18h, une notification pour chaque voyage accepté qui part le lendemain.") : tr("Une notification une heure avant chaque réservation qui a une heure, pour rappeler le client et le partenaire."))),
      entreprise ? null : h("p", { class: "aide" }, tr("Éteint pour cette entreprise dans les réglages : vous ne recevrez rien ici tant qu'il n'y est pas allumé."))
    );
  }
  async function dessiner() {
    corps.replaceChildren(h("p", { class: "aide" }, tr("Chargement…")));
    if (etat.store.mode !== "supabase") {
      corps.replaceChildren(blocH1(), h("p", { class: "aide" }, tr("Démonstration : aucune notification ne part de cet appareil. Le réglage ci-dessus est gardé dans la démo.")), h("div", { class: "actions gauche" }, h("button", { class: "secondaire", type: "button", onclick: fermer }, tr("Fermer"))));
      return;
    }
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
      blocH1(),
      h("ul", { class: "liste-aide" },
        h("li", null, h("strong", null, tr("18h, la veille")), tr("Les services du lendemain, avec ceux qui n'ont pas d'heure de pickup.")),
        modeRappel(reglages()) === "depart" ? h("li", null, h("strong", null, tr("18h, la veille du départ")), tr("Chaque voyage accepté qui part le lendemain : un tap ouvre le dossier.")) : h("li", null, h("strong", null, tr("1 h avant")), tr("Chaque service qui a une heure : un tap ouvre la réservation et son rappel.")),
        h("li", null, h("strong", null, tr("9h, le lendemain")), tr("Les clients dont un service a eu lieu la veille, à recontacter pour avoir leur avis."))
      ),
      h("p", { class: "aide" }, tr("Heure de Bangkok. Les rappels du soir et du matin ne contiennent aucun nom de client ; ceux d'une heure avant et de la veille du départ le contiennent, lisible une fois le téléphone déverrouillé.")),
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
