// Saisie rapide d'un net ou d'une commission manquants : un champ, puis Enregistrer, sans ouvrir la fiche de la réservation (Jérémy, 17.11.2026).
// Proposée depuis « À vérifier » (contrôles « sans net » et « sans commission ») et sur la carte du service dans le dossier.
// Réservée au droit « partenaires.nets » (avec l'écriture des dossiers). Rien en Taxi.
import { etat, peut, modeTaxi, netReservation, enregistrerLie } from "../etat.mjs";
import { h, toast, saisie, erreurChamp } from "../ui.mjs";
import { champSaisieRapide, montantSaisi } from "../nets-reservation-calc.mjs";
import { personnesTexte } from "../operations-calc.mjs";
import { tr } from "../i18n.mjs";

export const droitsSaisieRapide = () => ({ nets: peut("partenaires.nets"), ecrit: peut("dossiers.ecrire"), taxi: modeTaxi() });

const ERREURS = { vide: () => tr("Indiquez un montant."), invalide: () => tr("Montant non reconnu : des chiffres seulement, par exemple 1200 ou 1200,50."), negatif: () => tr("Le montant ne peut pas être négatif.") };

// Le petit formulaire d'un service, ou null quand il n'y a rien à compléter. `apres` : appelé une fois enregistré (rafraîchir l'écran).
export function saisieRapideNet(r, { apres = () => {} } = {}) {
  const n = netReservation(r);
  const quoi = champSaisieRapide(r, n, droitsSaisieRapide());
  if (!quoi) return null;
  const net = quoi === "net_prevu";
  const id = `sr-${net ? "net" : "com"}-${r.id}`;
  const entree = saisie(h("input", { id, placeholder: net ? tr("Net total") : tr("Commission") }), "montant");
  const bouton = h("button", { class: "principal petit", type: "submit" }, tr("Enregistrer"));
  const personnes = personnesTexte(r.personnes || {});
  const aide = net
    ? tr("Le net du prestataire pour tout le service{personnes}.", { personnes: personnes ? ` (${personnes})` : "" })
    : tr("Ce que le prestataire reverse pour ce service payé sur place.");
  return h(
    "form",
    {
      class: "saisie-rapide",
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        const m = montantSaisi(entree.value);
        if (m.erreur) {
          erreurChamp(entree, ERREURS[m.erreur]());
          return entree.focus();
        }
        erreurChamp(entree, null);
        bouton.disabled = true;
        try {
          // Seul ce champ s'écrit : le reste de la ligne de nets (net payé, commission reçue…) ne bouge pas.
          await enregistrerLie("reservations_nets", "reservation_id", r.id, { [quoi]: m.valeur });
          toast(net ? tr("Net enregistré pour « {libelle} ».", { libelle: r.libelle }) : tr("Commission enregistrée pour « {libelle} ».", { libelle: r.libelle }));
          apres();
        } catch (err) {
          bouton.disabled = false;
          toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
        }
      },
    },
    h("label", { class: "etiquette", for: id }, net ? tr("Net prévu manquant") : tr("Commission prévue manquante")),
    h("div", { class: "saisie-rapide-ligne" }, entree, bouton),
    h("p", { class: "aide" }, aide)
  );
}

// La réservation d'une entrée de « À vérifier » (l'identifiant de l'entrée est celui de la réservation).
export const reservationParId = (id) => (etat.db.reservations || []).find((r) => r.id === id) || null;
