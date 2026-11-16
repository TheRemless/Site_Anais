// « À vérifier » : les cas qui se règlent mieux au calme que devant un client, chacun avec un lien vers la fiche à corriger. Lecture seule : rien n'est corrigé ici.
import { etat, peut, entiteActive, modeTaxi, tousDocuments } from "../etat.mjs";
import { h } from "../ui.mjs";
import { aujourdhui } from "../calc.mjs";
import { aVerifier } from "../a-verifier-calc.mjs";
import { vide } from "./commun.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";

const TITRES = {
  trajets_sans_prix: [N_("Trajets sans prix de vente"), N_("Ces trajets actifs ne peuvent pas être vendus tant que leur prix de vente manque ou vaut zéro.")],
  prestations_prix_en_texte: [N_("Prix écrit seulement en texte"), N_("Le prix de vente est vide mais un prix figure dans le texte de la prestation : à reporter dans le champ du prix.")],
  prestations_a_zero: [N_("Prestations à zéro"), N_("Une prestation active vendue 0 : oubli, ou prix à saisir ?")],
  prestations_sur_place_hors_frais: [N_("Prestations notées « frais réglé sur place » sans être des frais"), N_("Elles entrent dans les dossiers comme une note hors total au lieu d'un service avec son prix. Ouvrez la prestation et enregistrez-la : elle redevient un service normal.")],
  notes_sur_place_hors_frais: [N_("Notes « à régler sur place » qui ne sont pas des frais"), N_("Laissées sur une facture ou un devis par une prestation mal cochée. Ouvrez le document et supprimez la ligne de note.")],
  factures_differentes_reservation: [N_("Facture différente de sa réservation"), N_("Le libellé, le partenaire, le montant ou le paiement de la réservation ne sont pas ceux de la facture. Sur la fiche du dossier, la réservation propose « Mettre la facture comme la réservation ».")],
  prestations_sans_net: [N_("Prestations sans prix net"), N_("Sans net, la marge et la commission ne se calculent pas.")],
  groupes_en_double: [N_("Groupes de tarifs écrits de deux façons"), N_("Même partenaire, même nom à une majuscule, un accent ou un espace près : à fondre en un seul ?")],
  partenaires_sans_telephone: [N_("Partenaires actifs sans téléphone"), N_("Impossible de leur écrire ou de les appeler depuis l'outil.")],
  partenaires_sans_whatsapp: [N_("Partenaires actifs sans numéro WhatsApp"), N_("Le message de demande ne s'ouvre pas directement dans WhatsApp.")],
  trajets_duree: [N_("Durée affichée qui ne colle pas avec les horaires"), N_("Plus de 20 minutes d'écart entre « arrivée moins départ » et la durée écrite. Un trajet à plusieurs étapes peut l'expliquer : à relire, pas forcément une erreur.")],
  clients_sans_contact: [N_("Clients sans téléphone ni e-mail"), N_("Impossible de les joindre.")],
  dossiers_sans_responsable: [N_("Dossiers sans responsable"), N_("Personne n'est désignée pour suivre ces dossiers.")],
};

// Taxi : les tarifs des courses n'ont jamais de net (Mr. Brown n'est pas payé par l'agence), le contrôle des nets n'y a pas de sens.
export const droitsVerification = () => ({ partenaires: peut("partenaires.ecrire"), dossiers: peut("dossiers.ecrire"), clients: peut("clients.ecrire"), nets: peut("partenaires.nets") && !modeTaxi() });
export const peutVerifier = () => Object.entries(droitsVerification()).some(([k, v]) => k !== "nets" && v);

export async function vueAVerifier() {
  if (!peutVerifier()) return vide(tr("Accès réservé"), tr("Cet écran est réservé aux rôles qui peuvent corriger les fiches."), h("a", { class: "bouton secondaire", href: "#/" }, tr("Retour au tableau de bord")));
  // Les factures ne sont en mémoire que pour les dossiers ouverts : l'écran les charge toutes (sans le droit de les voir, la base n'en renvoie aucune).
  let documents = [];
  if (peut("dossiers.ecrire")) {
    try {
      documents = await tousDocuments();
    } catch (err) {
      console.error(err);
    }
  }
  const controles = aVerifier({ ...etat.db, documents }, { droits: droitsVerification(), aujourdhui: aujourdhui(), tr, taxi: modeTaxi() });
  const total = controles.reduce((s, c) => s + c.elements.length, 0);
  return h(
    "div",
    { "data-titre": tr("À vérifier") },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("À vérifier")), h("p", { class: "sous" }, entiteActive().nom))),
    h("p", { class: "aide" }, tr("Les cas qui se règlent mieux au calme que devant un client. L'outil ne corrige rien tout seul : chaque ligne ouvre la fiche à corriger.")),
    !controles.length
      ? vide(tr("Rien à vérifier"), tr("Aucun des contrôles ne signale quoi que ce soit pour cette entreprise."))
      : h(
          "div",
          { class: "a-verifier" },
          h("p", { class: "aide", role: "status" }, pluriel(total, N_("{n} point à vérifier"), N_("{n} points à vérifier"))),
          controles.map((c) => {
            const [titre, aide] = TITRES[c.cle];
            return h(
              "details",
              { class: "controle", open: controles.length <= 3 },
              h("summary", null, h("strong", null, tr(titre)), " ", h("span", { class: "tag" }, String(c.elements.length)), c.aRelire ? h("span", { class: "tag" }, tr("à relire")) : null),
              h("p", { class: "aide" }, tr(aide)),
              h("ul", { class: "cartes" }, c.elements.slice(0, 100).map((e) => h("li", { class: "carte" }, h("a", { class: "carte-lien", href: e.lien }, h("span", { class: "carte-titre" }, e.texte), e.detail ? h("span", { class: "carte-sous" }, e.detail) : null)))),
              c.elements.length > 100 ? h("p", { class: "aide" }, tr("Les 100 premiers sont affichés ({n} au total).", { n: c.elements.length })) : null
            );
          })
        )
  );
}
