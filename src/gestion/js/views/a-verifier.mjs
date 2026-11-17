// « À vérifier » : les cas qui se règlent mieux au calme que devant un client, chacun avec un lien vers la fiche à corriger.
// Seuls un net ou une commission manquants se saisissent ici même (un champ, puis Enregistrer : Jérémy, 17.11.2026). Le reste se corrige sur la fiche.
import { etat, peut, entiteActive, modeTaxi, tousDocuments, estAdmin, reglages, enregistrerReglages } from "../etat.mjs";
import { h, champ, modal, toast } from "../ui.mjs";
import { aujourdhui } from "../calc.mjs";
import { aVerifier, CONTROLES, reglageAVerifier } from "../a-verifier-calc.mjs";
import { vide } from "./commun.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";
import { saisieRapideNet, reservationParId } from "./saisie-net.mjs";

// Contrôles dont chaque ligne se complète sur place, un champ puis Enregistrer (Jérémy, 17.11.2026).
const SAISIE_RAPIDE = new Set(["services_sans_net", "services_sans_commission"]);
// Contrôles dépliés par la personne : ils le restent quand l'écran se redessine après un enregistrement (elle ne perd pas sa place).
const ouverts = new Set();

const TITRES = {
  services_sans_heure: [N_("Services à venir sans heure de pickup"), N_("Dans les prochains jours (réglable). Le chauffeur ou le bateau ne sait pas quand passer.")],
  services_sans_lieu: [N_("Services à venir sans lieu de pickup"), N_("Dans les prochains jours (réglable). Ni lieu de pickup sur la réservation, ni hôtel sur la fiche du client.")],
  services_sans_prix: [N_("Services à venir sans prix"), N_("Le prix de vente de la réservation est vide. Une prestation offerte se note à 0 : elle n'apparaît pas ici.")],
  services_sans_net: [N_("Services à venir sans net"), N_("Payés chez nous, sans net prévu : la marge et ce que l'on doit au prestataire ne se calculent pas. Un service dont un des nets manque (adulte ou enfant) reste ici jusqu'à ce que le net total soit saisi.")],
  services_sans_commission: [N_("Services à venir sans commission"), N_("Payés sur place au prestataire, sans commission prévue : rien ne rappellera de la lui demander. Saisissez-la ici.")],
  clients_en_double: [N_("Clients peut-être en double"), N_("Même téléphone, même e-mail ou même prénom et nom. Si c'est la même personne, gardez une fiche et rattachez-y ses dossiers.")],
  trajets_sans_prix: [N_("Trajets sans prix de vente"), N_("Ces trajets actifs ne peuvent pas être vendus tant que leur prix de vente manque ou vaut zéro.")],
  prestations_prix_en_texte: [N_("Prix écrit seulement en texte"), N_("Le prix de vente est vide mais un prix figure dans le texte de la prestation : à reporter dans le champ du prix.")],
  prestations_a_zero: [N_("Prestations à zéro"), N_("Une prestation active vendue 0 : oubli, ou prix à saisir ?")],
  prestations_sur_place_hors_frais: [N_("Prestations notées « frais réglé sur place » sans être des frais"), N_("Elles entrent dans les dossiers comme une note hors total au lieu d'un service avec son prix. Ouvrez la prestation et enregistrez-la : elle redevient un service normal.")],
  notes_sur_place_hors_frais: [N_("Notes « à régler sur place » qui ne sont pas des frais"), N_("Laissées sur une facture ou un devis par une prestation mal cochée. Ouvrez le document et supprimez la ligne de note.")],
  factures_differentes_reservation: [N_("Facture différente de sa réservation"), N_("Le libellé, le partenaire, le montant ou le paiement de la réservation ne sont pas ceux de la facture. Sur la fiche du dossier, la réservation propose « Mettre la facture comme la réservation ».")],
  prestations_sans_net: [N_("Prestations sans prix net"), N_("Sans net, la marge et la commission ne se calculent pas.")],
  groupes_en_double: [N_("Groupes de tarifs écrits de deux façons"), N_("Même partenaire, même nom à une majuscule, un accent ou un espace près : à fondre en un seul ?")],
  partenaires_sans_telephone: [N_("Partenaires actifs sans téléphone"), N_("Impossible de leur écrire ou de les appeler depuis l'outil.")],
  partenaires_sans_whatsapp: [N_("Partenaires actifs sans numéro WhatsApp"), N_("Aucun de leurs numéros n'est noté WhatsApp : leur fiche n'a pas de bouton pour leur écrire. Si l'un des numéros a WhatsApp, indiquez-le sur la fiche.")],
  trajets_duree: [N_("Durée affichée qui ne colle pas avec les horaires"), N_("Un écart plus grand que le seuil réglé entre « arrivée moins départ » et la durée écrite. Un trajet à plusieurs étapes peut l'expliquer : à relire, pas forcément une erreur.")],
  clients_sans_contact: [N_("Clients sans téléphone ni e-mail"), N_("Impossible de les joindre.")],
  dossiers_sans_responsable: [N_("Dossiers sans responsable"), N_("Personne n'est désignée pour suivre ces dossiers.")],
};

// Taxi : les tarifs des courses n'ont jamais de net (Mr. Brown n'est pas payé par l'agence), le contrôle des nets n'y a pas de sens.
export const droitsVerification = () => ({ partenaires: peut("partenaires.ecrire"), dossiers: peut("dossiers.ecrire"), clients: peut("clients.ecrire"), nets: peut("partenaires.nets") && !modeTaxi() });
export const peutVerifier = () => Object.entries(droitsVerification()).some(([k, v]) => k !== "nets" && v);

// Les contrôles que l'entreprise ouverte peut afficher : pas de net ni de commission en Taxi, pas de facture comparée en Taxi.
const controlesProposes = () => CONTROLES.filter((c) => !(modeTaxi() && ["services_sans_net", "services_sans_commission", "prestations_sans_net", "factures_differentes_reservation", "notes_sur_place_hors_frais"].includes(c)));

// Réglages de l'écran, réservés à l'administratrice : quels contrôles afficher et leurs seuils. Enregistrés dans les réglages de l'entreprise ouverte.
function ouvrirReglagesVerification(apres) {
  const r = reglageAVerifier(reglages().a_verifier);
  const cases = controlesProposes().map((cle) => h("label", { class: "case" }, h("input", { type: "checkbox", value: cle, checked: !r.desactives.includes(cle) }), " ", tr(TITRES[cle][0])));
  const nombre = (id, valeur, min, max) => h("input", { id, type: "number", inputmode: "numeric", min, max, step: 1, value: valeur });
  const horizon = nombre("av-horizon", r.horizon_jours, 0, 365);
  const ecart = nombre("av-ecart", r.ecart_duree_min, 0, 1440);
  const chiffres = nombre("av-chiffres", r.chiffres_telephone, 1, 20);
  const lignes = nombre("av-lignes", r.lignes_max, 10, 1000);
  const form = h(
    "form",
    {
      class: "modal-corps",
      onsubmit: async (e) => {
        e.preventDefault();
        // Un contrôle d'une autre entreprise (Taxi n'en a pas tous) garde son état : seuls ceux de cet écran changent.
        const autres = r.desactives.filter((c) => !controlesProposes().includes(c));
        const valeur = reglageAVerifier({
          horizon_jours: horizon.value, ecart_duree_min: ecart.value, chiffres_telephone: chiffres.value, lignes_max: lignes.value,
          desactives: [...autres, ...cases.map((l) => l.querySelector("input")).filter((i) => !i.checked).map((i) => i.value)],
        });
        try {
          await enregistrerReglages({ ...reglages(), a_verifier: valeur });
          fermer(true);
          toast(tr("Réglages de « À vérifier » enregistrés."));
          apres();
        } catch (err) {
          toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
        }
      },
    },
    h("p", { class: "aide" }, tr("Pour {nom}. Un contrôle décoché disparaît de l'écran ; il revient dès qu'on le recoche.", { nom: entiteActive().nom })),
    h("fieldset", null, h("legend", null, tr("Contrôles affichés")), h("div", null, cases)),
    h("fieldset", null, h("legend", null, tr("Seuils")), h("div", { class: "grille-form" },
      champ(tr("Heure et lieu : jours à l'avance"), horizon, tr("0 : seulement aujourd'hui. Par défaut 7.")),
      champ(tr("Écart de durée toléré (minutes)"), ecart, tr("Par défaut 20.")),
      champ(tr("Chiffres minimum d'un téléphone"), chiffres, tr("En dessous, le numéro ne compte pas. Par défaut 6.")),
      champ(tr("Lignes affichées par contrôle"), lignes, tr("Par défaut 100."))
    )),
    h("div", { class: "actions" }, h("button", { class: "secondaire", type: "button", onclick: () => fermer() }, tr("Annuler")), h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))
  );
  const fermer = modal(tr("Régler « À vérifier »"), form);
}

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
  const regle = reglageAVerifier(reglages().a_verifier);
  const controles = aVerifier({ ...etat.db, documents }, { droits: droitsVerification(), aujourdhui: aujourdhui(), tr, taxi: modeTaxi(), reglage: regle });
  const coupes = regle.desactives.filter((c) => controlesProposes().includes(c)).length;
  const rafraichir = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
  const total = controles.reduce((s, c) => s + c.elements.length, 0);
  return h(
    "div",
    { "data-titre": tr("À vérifier") },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("À vérifier")), h("p", { class: "sous" }, entiteActive().nom)), estAdmin() ? h("div", { class: "entete-actions" }, h("button", { class: "secondaire", type: "button", onclick: () => ouvrirReglagesVerification(rafraichir) }, tr("Régler les contrôles"))) : null),
    h("p", { class: "aide" }, tr("Les cas qui se règlent mieux au calme que devant un client. L'outil ne corrige rien tout seul : chaque ligne ouvre la fiche à corriger.")),
    coupes ? h("p", { class: "aide" }, pluriel(coupes, N_("{n} contrôle est coupé dans les réglages de cet écran."), N_("{n} contrôles sont coupés dans les réglages de cet écran."))) : null,
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
              { class: "controle", open: controles.length <= 3 || ouverts.has(c.cle), ontoggle: (e) => (e.target.open ? ouverts.add(c.cle) : ouverts.delete(c.cle)) },
              h("summary", null, h("strong", null, tr(titre)), " ", h("span", { class: "tag" }, String(c.elements.length)), c.aRelire ? h("span", { class: "tag" }, tr("à relire")) : null),
              h("p", { class: "aide" }, tr(aide)),
              h("ul", { class: "cartes" }, c.elements.slice(0, regle.lignes_max).map((e) => h("li", { class: "carte" }, h("a", { class: "carte-lien", href: e.lien }, h("span", { class: "carte-titre" }, e.texte), e.detail ? h("span", { class: "carte-sous" }, e.detail) : null), SAISIE_RAPIDE.has(c.cle) ? ((r) => (r ? saisieRapideNet(r, { apres: rafraichir }) : null))(reservationParId(e.id)) : null))),
              c.elements.length > regle.lignes_max ? h("p", { class: "aide" }, tr("Les {max} premiers sont affichés ({n} au total).", { max: regle.lignes_max, n: c.elements.length })) : null
            );
          })
        )
  );
}
