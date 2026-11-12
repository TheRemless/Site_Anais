// Classer un devis « sans suite » en un tap, avec un motif court, et le rouvrir. Utilisé par « À faire » (accueil) et par la fiche dossier.
import { etat, modifier } from "../etat.mjs";
import { h, modal, toast } from "../ui.mjs";
import { aujourdhui } from "../calc.mjs";
import { tr } from "../i18n.mjs";
import { MOTIFS, LONGUEUR_MAX, valeursSansSuite, valeursRouvrir } from "../sans-suite-calc.mjs";

async function classer(d, motif, apres) {
  try {
    await modifier("dossiers", d.id, valeursSansSuite(motif, aujourdhui()));
  } catch (err) {
    return toast(tr("Le devis n'a pas pu être classé : {message}", { message: err.message }), true);
  }
  toast(tr("Classé sans suite : le dossier sort des relances."));
  if (apres) apres();
}

// Feuille du bas : un tap sur un motif classe le devis tout de suite. « Autre motif » ouvre un champ court.
export function ouvrirSansSuite(d, apres) {
  const autre = h("input", { id: "ss-autre", maxlength: String(LONGUEUR_MAX), autocomplete: "off", placeholder: tr("Motif en quelques mots") });
  const blocAutre = h("form", { class: "ss-autre", hidden: true, onsubmit: (e) => (e.preventDefault(), fermer(), classer(d, autre.value, apres)) }, h("label", { for: "ss-autre" }, tr("Autre motif")), autre, h("button", { class: "principal", type: "submit" }, tr("Classer sans suite")));
  const choisir = (motif) => () => (fermer(), classer(d, motif, apres));
  const fermer = modal(
    tr("Classer ce devis sans suite"),
    h(
      "div",
      { class: "modal-corps" },
      h("p", { class: "aide" }, tr("Le dossier sort des relances et des devis en attente. Il reste consultable, et vous pouvez rouvrir le devis à tout moment.")),
      h("div", { class: "ss-motifs" }, MOTIFS.map((m) => h("button", { class: "secondaire", type: "button", onclick: choisir(m) }, tr(m))), h("button", { class: "secondaire", type: "button", onclick: () => ((blocAutre.hidden = false), autre.focus()) }, tr("Autre motif…"))),
      blocAutre
    ),
    { feuille: true, protege: false }
  );
}

export async function rouvrirDevis(d, apres) {
  try {
    await modifier("dossiers", d.id, valeursRouvrir());
  } catch (err) {
    return toast(tr("Le devis n'a pas pu être rouvert : {message}", { message: err.message }), true);
  }
  toast(tr("Devis rouvert."));
  if (apres) apres();
}

// Le bouton ne s'affiche que si la base connaît les colonnes (migration 25) et si le rôle peut modifier les dossiers.
export const baseDistante = () => etat.store.mode === "supabase";
