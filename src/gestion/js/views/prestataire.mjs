// Changer le jour, l'heure, le lieu ou les personnes d'une réservation depuis sa carte. Rien n'est envoyé au prestataire : Anaïs lui écrit
// elle-même (Jérémy, 14.11.2026), et le dossier n'entre dans l'outil qu'une fois la place confirmée.
import { etat, modifier } from "../etat.mjs";
import { h, champ, modal, toast } from "../ui.mjs";
import { suivreFacture, appliquerChangements, synchroniserDatesDossier } from "./suivi-facture.mjs";
import { tr } from "../i18n.mjs";


// Renvoie true si c'est enregistré. La réservation relue ici est la version courante : une synchronisation peut avoir changé la carte affichée.
const courante = (r) => etat.db.reservations.find((x) => x.id === r.id) || r;
const enregistrer = async (r, champs, apres, message) => {
  try {
    await modifier("reservations", r.id, typeof champs === "function" ? champs(courante(r)) : champs);
    if (message) toast(message);
    apres();
    return true;
  } catch (err) {
    toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    return false;
  }
};

// Changer le jour, l'heure, le lieu ou les personnes sans ouvrir tout le formulaire. Sur une réservation déjà demandée au prestataire, on peut
// enregistrer.
export function changerReservation(r, apres) {
  const p = r.personnes || {};
  const date = h("input", { id: "ch-date", type: "date", value: r.date_service || "" });
  const heure = h("input", { id: "ch-heure", type: "time", value: r.heure_pickup || "" });
  const lieu = h("input", { id: "ch-lieu", value: r.lieu_pickup || "", autocomplete: "off", placeholder: tr("Hôtel, chambre, vol") });
  const adultes = h("input", { id: "ch-ad", type: "number", min: "0", step: "1", inputmode: "numeric", value: p.adultes ?? 0 });
  const enfants = h("input", { id: "ch-enf", type: "number", min: "0", step: "1", inputmode: "numeric", value: p.enfants ?? 0 });
  const nombre = (i) => Math.max(0, Math.floor(Number(i.value) || 0));
  const champs = () => ({ date_service: date.value || null, heure_pickup: heure.value, lieu_pickup: lieu.value.trim(), personnes: { ...p, adultes: nombre(adultes), enfants: nombre(enfants) } });
  // Un seul chemin : la facture suit la date et les personnes (total montré, confirmation si elle est partie), puis la réservation.
  async function sauver() {
    const valeurs = champs();
    const suivi = await suivreFacture(r, valeurs, { avant: { date_service: r.date_service, personnes: r.personnes }, apres: { date_service: valeurs.date_service, personnes: valeurs.personnes }, montantSuit: true });
    if (!suivi) return false;
    try {
      await appliquerChangements(suivi.changements);
    } catch (err) {
      toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
      return false;
    }
    const extra = suivi.montantVente !== null ? { montant_vente: suivi.montantVente } : {};
    const fait = await enregistrer(r, { ...valeurs, ...extra }, apres, suivi.ecartRestant && suivi.ecartRestant.length ? `${tr("Réservation modifiée.")} ${tr("La facture garde l'ancienne valeur, à corriger dans la facture :")} ${suivi.ecartRestant.join(" ; ")}` : tr("Réservation modifiée."));
    if (fait && (valeurs.date_service || null) !== (r.date_service || null)) await synchroniserDatesDossier(r.dossier_id);
    return fait;
  }
  const fermer = modal(
    tr("Changer la réservation"),
    h(
      "div",
      { class: "modal-corps changer-reservation" },
      h("p", { class: "aide" }, r.libelle),
      h("div", { class: "grille-form compacte" }, champ(tr("Date du service"), date), champ(tr("Heure de pickup"), heure)),
      champ(tr("Lieu de pickup"), lieu),
      h("div", { class: "grille-form compacte" }, champ(tr("Adultes"), adultes), champ(tr("Enfants"), enfants)),
      h("p", { class: "aide" }, tr("La facture suit la date et les personnes : le nouveau total s'affiche avant l'enregistrement.")),
      h("div", { class: "actions" },
        h("button", { class: "principal", type: "button", onclick: async () => { if (await sauver()) { fermer(); } } }, tr("Enregistrer"))
      )
    ),
    { protege: false }
  );
}

// Ce que la carte de réservation propose : changer le jour, l'heure ou les personnes.
export function gestesPrestataire(r, { apres }) {
  if (!r.partenaire_id || r.statut === "annule") return { faire: {} };
  return { faire: { changer: () => changerReservation(r, apres) } };
}
