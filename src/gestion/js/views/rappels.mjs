// Fenêtre « Rappels » : activer ou couper les notifications de ce téléphone et, pour l'administratrice, régler leurs heures dans l'entreprise ouverte.
import { etat, estAdmin, reglages, enregistrerReglages, entiteActive } from "../etat.mjs";
import { h, modal, toast, champ } from "../ui.mjs";
import { tr } from "../i18n.mjs";
import { situation, activer, desactiver, essai } from "../rappels.mjs";
import { heuresRappels } from "../rappels-etat.mjs";


// Heures de l'entreprise ouverte (Bangkok). La fonction passe chaque heure et envoie les rappels des entreprises réglées sur cette heure-là.
function reglageHeures(apres) {
  const hrs = heuresRappels(reglages().rappels);
  const choix = (id, valeur) => h("select", { id }, h("option", { value: "", selected: valeur === null }, tr("Coupé")), Array.from({ length: 24 }, (_, n) => h("option", { value: String(n), selected: valeur === n }, `${n} h`)));
  const veille = choix("rp-veille", hrs.veille);
  const lendemain = choix("rp-lendemain", hrs.lendemain);
  return h(
    "form",
    {
      class: "formulaire",
      onsubmit: async (e) => {
        e.preventDefault();
        const lire = (sel) => (sel.value === "" ? null : Number(sel.value));
        try {
          await enregistrerReglages({ ...reglages(), rappels: { veille: lire(veille), lendemain: lire(lendemain) } });
          toast(tr("Heures des rappels enregistrées."));
          apres();
        } catch (err) {
          toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
        }
      },
    },
    h("h3", null, tr("Heures des rappels de {nom}", { nom: entiteActive().nom })),
    h("p", { class: "aide" }, tr("Heure de Bangkok. Elles valent pour tous les téléphones abonnés qui voient cette entreprise.")),
    h("div", { class: "grille-form" }, champ(tr("La veille"), veille), champ(tr("Le lendemain"), lendemain)),
    h("div", { class: "actions gauche" }, h("button", { class: "secondaire", type: "submit" }, tr("Enregistrer les heures")))
  );
}

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
    const hrs = heuresRappels(reglages().rappels);
    corps.replaceChildren(
      h("ul", { class: "liste-aide" },
        h("li", null, h("strong", null, hrs.veille === null ? tr("La veille : coupé") : tr("{heure}, la veille", { heure: `${hrs.veille} h` })), " ", tr("Les services du lendemain, avec ceux qui n'ont pas d'heure ou pas de lieu de pickup.")),
        h("li", null, h("strong", null, hrs.lendemain === null ? tr("Le lendemain : coupé") : tr("{heure}, le lendemain", { heure: `${hrs.lendemain} h` })), " ", tr("Les clients dont un service a eu lieu la veille, à recontacter pour avoir leur avis."))
      ),
      h("p", { class: "aide" }, tr("Heure de Bangkok. La notification ne contient aucun nom de client : le détail s'ouvre dans l'outil.")),
      h("p", { class: "rappels-etat", role: "status" }, etatTexte),
      h("div", { class: "actions gauche" },
        s === "inactif" ? actionner(tr("Activer les rappels"), "principal", async () => { const reg = await activer(etat.store); await essai(reg); }, tr("Rappels activés sur cet appareil.")) : null,
        s === "actif" ? actionner(tr("Envoyer un essai"), "secondaire", essai) : null,
        s === "actif" ? actionner(tr("Désactiver"), "secondaire", () => desactiver(etat.store), tr("Rappels désactivés sur cet appareil.")) : null,
        h("button", { class: "secondaire", type: "button", onclick: fermer }, tr("Fermer"))
      ),
      estAdmin() ? reglageHeures(dessiner) : null
    );
  }
  dessiner();
}
