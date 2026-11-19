// VIP Taxi Lanta : une course hors catalogue (pickup et drop-off saisis à la main) depuis l'écran « Nouveau dossier » (13.11.2026).
// Les mêmes champs que l'écran thaï « Nouveau voucher » de l'assistante, en français et anglais ; le contrôle et le calcul sont ceux
// de voucher-rapide-calc.mjs (voir courseHorsCatalogue). Le client vient du sélecteur de l'écran, pas de cette fenêtre.
import { etat, reglages, exemple } from "../etat.mjs";
import { h, champ, modal, saisie, erreurChamp, focusPremiereErreur } from "../ui.mjs";
import { uid } from "../defauts.mjs";
import { valeursVides, suggestionsLieux, partenaireDeTaxi, chauffeurRegle } from "../voucher-rapide-calc.mjs";
import { erreursCourse, courseHorsCatalogue } from "../creation-voucher-calc.mjs";
import { tr, N_ } from "../i18n.mjs";
import { RETOUR_DEPART } from "../trajet-calc.mjs";

// Codes d'erreur de voucher-rapide-calc.mjs, dits en français (et en anglais par tr).
const ERREURS = { e_vide: N_("Remplissez ce champ."), e_thai: N_("Écrivez en anglais : le client ne lit pas le thaï."), e_date: N_("Choisissez la date."), e_heure: N_("Choisissez l'heure."), e_adultes: N_("Au moins 1 personne."), e_nombre: N_("Saisissez un nombre."), e_prix: N_("Indiquez le prix en chiffres."), e_sieges: N_("Plus de sièges que d'enfants."), e_duree: N_("Indiquez la durée en heures, par exemple 3 ou 1,5. Vide si elle n'est pas connue.") };

// `date` : la date proposée (celle du service précédent). `onAjout({ ligne, saisie })` reçoit la ligne de la course et sa réservation.
export function ouvrirCourseLibre({ date = "", onAjout }) {
  const v = { ...valeursVides(), date };
  const lieux = h("datalist", { id: "cl-lieux" }, suggestionsLieux(etat.db.prestations, etat.db.reservations).map((l) => h("option", { value: l })));
  const entree = (cle, attrs = {}) => h("input", { id: `cl-${cle}`, value: v[cle], autocomplete: "off", ...attrs });
  const c = {
    date: entree("date", { type: "date" }),
    pickup: entree("pickup", { list: "cl-lieux", placeholder: exemple("hotel") }),
    heure: entree("heure", { type: "time" }),
    // Aller simple ou retour au point de départ (16.11.2026) : le second remplace le drop-off par le programme et la durée.
    trajet: h("select", { id: "cl-trajet" }, h("option", { value: "" }, tr("Aller simple")), h("option", { value: RETOUR_DEPART }, tr("Retour au point de départ"))),
    dropoff: entree("dropoff", { list: "cl-lieux", placeholder: exemple("aeroport") }),
    programme: (() => {
      const t = h("textarea", { id: "cl-programme", rows: 2, placeholder: tr("Old Town and viewpoint tour, the driver waits") });
      t.value = v.programme;
      return t;
    })(),
    duree: entree("duree", { inputmode: "decimal", placeholder: "3" }),
    vol: entree("vol", { placeholder: "FD3217" }),
    adultes: saisie(entree("adultes"), "entier"),
    enfants: saisie(entree("enfants"), "entier"),
    bagages: entree("bagages"),
    sieges: saisie(entree("sieges"), "entier"),
    prix: saisie(entree("prix"), "montant"),
  };
  for (const x of Object.values(c)) x.addEventListener("input", () => erreurChamp(x, null));
  const anglais = tr("En anglais, comme sur la Booking confirmation.");
  const blocDropoff = champ(tr("Drop-off"), c.dropoff, anglais);
  const blocRetour = h("div", { class: "grille-form" }, champ(tr("Programme"), c.programme, tr("Obligatoire. En anglais, imprimé sur la Booking confirmation : ce que le client veut faire.")), champ(tr("Durée en heures"), c.duree, tr("Facultatif. Vide : non précisée.")));
  const majTrajet = () => {
    const retour = c.trajet.value === RETOUR_DEPART;
    blocDropoff.hidden = retour;
    blocRetour.hidden = !retour;
  };
  c.trajet.addEventListener("change", majTrajet);
  majTrajet();
  let fermer = () => {};
  const form = h(
    "form",
    {
      class: "modal-corps formulaire-course",
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const valeurs = Object.fromEntries(Object.entries(c).map(([k, x]) => [k, x.value]));
        const erreurs = erreursCourse(valeurs);
        for (const [k, x] of Object.entries(c)) erreurChamp(x, erreurs[k] ? tr(ERREURS[erreurs[k]]) : null);
        if (focusPremiereErreur(form)) return;
        const p = partenaireDeTaxi(etat.db.partenaires, chauffeurRegle(reglages()));
        onAjout(courseHorsCatalogue(valeurs, { id: uid(), partenaireId: p ? p.id : null }));
        fermer();
      },
    },
    h("p", { class: "aide" }, tr("Pour une course hors catalogue : prise en charge et dépose saisies à la main. Le prix est payé au chauffeur.")),
    lieux,
    h("div", { class: "grille-form compacte" }, champ(tr("Date de la course"), c.date), champ(tr("Heure de pickup"), c.heure)),
    champ(tr("Type de trajet"), c.trajet, tr("Retour au point de départ : un tour ou une course, puis le chauffeur ramène le client au lieu de pickup. Le prix se fixe au cas par cas.")),
    h("div", { class: "grille-form" }, champ(tr("Lieu de pickup"), c.pickup, anglais), blocDropoff),
    blocRetour,
    champ(tr("Numéro de vol ou de bateau"), c.vol, tr("Si le pickup ou le drop-off est à l'aéroport ou au port. Sinon, laisser vide.")),
    h("div", { class: "grille-form compacte" }, champ(tr("Adultes"), c.adultes), champ(tr("Enfants"), c.enfants), champ(tr("Bagages"), c.bagages, tr("Un nombre ou du texte, en anglais : 3, ou 2 suitcases, 1 golf bag.")), champ(tr("Sièges enfant ou bébé"), c.sieges, tr("Vide si aucun."))),
    champ(tr("Prix de la course ({devise})", { devise: reglages().devise || "THB" }), c.prix, tr("Payé en espèces au chauffeur.")),
    h("div", { class: "actions" }, h("button", { class: "secondaire", type: "button", onclick: () => fermer() }, tr("Annuler")), h("button", { class: "principal", type: "submit" }, tr("Ajouter la course")))
  );
  fermer = modal(tr("Course hors catalogue"), form);
  c.date.focus();
}
