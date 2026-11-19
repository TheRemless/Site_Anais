// « Voir le message du client » (19.11.2026, demande de Jérémy) : le message que le client a envoyé depuis le formulaire du site, tel quel,
// en lecture seule. Ouvert depuis chaque carte des Demandes du site (à traiter, confirmée, refusée ou classée) et depuis la fiche du dossier
// créé par la demande. Rien ne s'y modifie ni ne part : on le relit ou on le copie. Module à part pour ne pas charger l'écran des demandes
// dans la fiche dossier.
import { h, modal, icone } from "../ui.mjs";
import { tr, localeActive } from "../i18n.mjs";
import { copierTexte } from "./partage.mjs";
import { messageClient, numeroWhatsApp, numeroAffiche, cheminPage, titreDemande } from "../demandes-site-calc.mjs";

// « jeu. 19 nov. 2026, 14:32 » dans la langue de l'interface.
export const recueLe = (iso) => (iso ? new Date(iso).toLocaleString(localeActive(), { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
// « 19 nov. 2026 » pour la ligne de la fiche dossier.
export const jourRecu = (iso) => (iso ? new Date(iso).toLocaleDateString(localeActive(), { day: "numeric", month: "short", year: "numeric" }) : "");

export function boutonMessageClient(d, { classe = "lien" } = {}) {
  return h("button", { class: classe, type: "button", onclick: () => ouvrirMessageClient(d) }, tr("Voir le message du client"));
}

export function ouvrirMessageClient(d) {
  const texte = messageClient(d);
  const numero = numeroWhatsApp(d);
  const reperes = h(
    "dl",
    { class: "dsite-message-reperes" },
    d.ref ? [h("dt", null, tr("Réf. WhatsApp")), h("dd", null, h("strong", null, d.ref))] : null,
    [h("dt", null, tr("Demande")), h("dd", null, titreDemande(d))],
    [h("dt", null, tr("Reçue le")), h("dd", null, recueLe(d.created_at) || tr("Date inconnue"))],
    [h("dt", null, tr("WhatsApp")), h("dd", null, numero ? numeroAffiche(numero) : d.telephone_saisi ? tr("Numéro à vérifier : {saisi}", { saisi: d.telephone_saisi }) : tr("Pas de numéro WhatsApp"))],
    d.page_url ? [h("dt", null, tr("Page d'origine")), h("dd", null, h("a", { href: d.page_url, target: "_blank", rel: "noopener" }, cheminPage(d.page_url)))] : null
  );
  const corps = h(
    "div",
    { class: "modal-corps dsite-message" },
    reperes,
    texte
      ? [h("p", { class: "aide" }, tr("Le message tel que le client l'a envoyé depuis le site, sans les changements faits ensuite.")), h("pre", { class: "dsite-message-texte", lang: "en", tabindex: "0" }, texte)]
      : h("p", { class: "aide" }, tr("Le message de cette demande n'a pas été gardé (envoyée avant que le site le transmette).")),
    h("div", { class: "barre-modal" }, texte ? h("button", { class: "principal", type: "button", onclick: () => copierTexte(texte) }, icone("copier", 18), tr("Copier")) : null, h("button", { class: "secondaire", type: "button", onclick: () => fermer() }, tr("Fermer")))
  );
  const fermer = modal(tr("Message du client"), corps, { protege: false });
  return fermer;
}
