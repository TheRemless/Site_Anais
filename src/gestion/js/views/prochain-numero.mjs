// Prochain numéro de la séquence annuelle (ST-2026-0001), réservé à l'administratrice : un saut de numérotation ou une reprise après un autre
// logiciel se fait ici, sans SQL. Jamais en dessous d'un numéro déjà donné cette année (dossiers de la corbeille compris). Migration 31.
import { etat, estAdmin } from "../etat.mjs";
import { h, champ, toast, confirmer, num } from "../ui.mjs";
import { refDepuisNumero } from "../calc.mjs";
import { tr } from "../i18n.mjs";

// `numerotation` : les réglages en cours d'édition (préfixe et nombre de chiffres servent à l'aperçu du numéro).
export function blocProchainNumero(numerotation) {
  if (!estAdmin()) return null;
  const annee = new Date().getFullYear();
  const debut = () => `${(numerotation.prefixe || "").trim() ? `${numerotation.prefixe.trim()}-` : ""}${annee}-`;
  const saisie = h("input", { type: "number", min: "1", step: "1", inputmode: "numeric", disabled: true });
  const apercu = h("p", { class: "aide" }, tr("Chargement…"));
  let minimum = 1;
  const majApercu = () => {
    const n = num(saisie.value);
    apercu.textContent = n >= 1 ? tr("Le prochain dossier de {annee} prendra le numéro {ref}. Plus petit numéro possible : {minimum}.", { annee, ref: refDepuisNumero(numerotation, debut(), n), minimum }) : tr("Indiquez un numéro.");
  };
  saisie.addEventListener("input", majApercu);
  const bouton = h("button", { class: "secondaire petit", type: "button", disabled: true }, tr("Enregistrer ce numéro"));
  bouton.addEventListener("click", async () => {
    const n = num(saisie.value);
    if (!(n >= minimum)) return toast(tr("Le numéro {pris} est déjà donné cette année : choisissez {minimum} ou plus.", { pris: minimum - 1, minimum }), true);
    if (!(await confirmer(tr("Le prochain dossier de {annee} prendra le numéro {ref}. Les numéros sautés ne seront pas donnés. Continuer ?", { annee, ref: refDepuisNumero(numerotation, debut(), n) }), tr("Enregistrer ce numéro")))) return;
    bouton.disabled = true;
    try {
      await etat.store.fixerProchainNumero(etat.entiteId, annee, n);
      toast(tr("Numérotation enregistrée."));
    } catch (err) {
      toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    } finally {
      bouton.disabled = false;
    }
  });
  etat.store
    .lireProchainNumero(etat.entiteId, annee)
    .then((r) => {
      minimum = r.minimum;
      saisie.value = r.prochain;
      saisie.min = String(r.minimum);
      saisie.disabled = false;
      bouton.disabled = false;
      majApercu();
    })
    .catch((err) => (apercu.textContent = tr("Numérotation indisponible : {message}", { message: err.message })));
  return h("div", { class: "prochain-numero" }, champ(tr("Prochain numéro de {annee}", { annee }), saisie), apercu, h("div", { class: "actions gauche" }, bouton));
}
