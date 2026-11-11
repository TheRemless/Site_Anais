// Galerie des composants mobiles, visible seulement en mode démonstration (/gestion/?demo#/composants).
// Sert de mode d'emploi vivant : chaque bloc montre comment appeler un composant de ui.mjs ou de commun.mjs.
import { h, modal, champ, saisie, erreurChamp, focusPremiereErreur, barreAction, squelette, puces, toast } from "../ui.mjs";
import { listeAdaptative, barreFiltres, pastille } from "./commun.mjs";
import { etat } from "../etat.mjs";
import { correspond } from "../mobile-calc.mjs";
// Page de documentation pour les développeurs, en français seulement : ses textes ne passent pas par t().
const t = (texte) => texte;

const STATUTS = ["brouillon", "devis_envoye", "accepte", "acompte", "solde"];
const lignes = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, nom: `Client ${String(i + 1).padStart(3, "0")}`, ref: `HM2026${1000 + i}`, montant: 100 + ((i * 37) % 900), statut: STATUTS[i % STATUTS.length], pays: ["Thaïlande", "Bali", "Japon"][i % 3] }));

function ouvrirFormulaire() {
  const nom = saisie(h("input", { id: "g-nom", required: true }), "nom");
  const tel = saisie(h("input", { id: "g-tel" }), "tel");
  const mail = saisie(h("input", { id: "g-mail" }), "email");
  const montant = saisie(h("input", { id: "g-montant" }), "montant");
  const date = saisie(h("input", { id: "g-date" }), "date");
  const note = h("textarea", { id: "g-note", rows: 3 });
  const form = h(
    "form",
    {
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        erreurChamp(nom, nom.value.trim() ? null : t("Indiquez le nom du client."));
        erreurChamp(mail, !mail.value || /^\S+@\S+\.\S+$/.test(mail.value) ? null : t("Cette adresse e-mail n'est pas valide."));
        if (focusPremiereErreur(form)) return;
        fermer();
        toast(t("Enregistré."));
      },
    },
    champ(t("Nom du client"), nom),
    champ(t("Téléphone"), tel),
    champ(t("Adresse e-mail"), mail),
    champ(t("Montant"), montant, t("Clavier à chiffres avec virgule.")),
    champ(t("Date de départ"), date),
    champ(t("Note"), note),
    h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, t("Annuler")), h("button", { type: "submit", class: "principal" }, t("Enregistrer")))
  );
  const fermer = modal(t("Nouveau client"), form, { brouillon: "galerie-client" });
}

export async function vueComposants() {
  if (etat.store.mode !== "demo") return h("div", { class: "vide" }, h("h1", null, t("Galerie des composants")), h("p", null, t("Cette page n'existe qu'en mode démonstration.")));
  let liste;
  const maj = (v) => {
    const sel = lignes.filter((l) => (!v.puces || v.puces === "tous" || l.statut === v.puces) && (!v.pays || l.pays === v.pays) && correspond(`${l.nom} ${l.ref}`, v.recherche));
    liste.mettre(sel);
  };
  const filtres = barreFiltres({
    recherche: { placeholder: t("Client ou référence"), libelle: t("Rechercher un client") },
    puces: { options: [{ valeur: "tous", libelle: t("Tous"), nombre: lignes.length }, ...STATUTS.map((s) => ({ valeur: s, libelle: s.replace("_", " ") }))], valeur: "tous", libelle: t("Statut") },
    filtres: [{ cle: "pays", libelle: t("Pays"), type: "select", neutre: "", valeur: "", options: [{ valeur: "", libelle: t("Tous les pays") }, ...["Thaïlande", "Bali", "Japon"].map((p) => ({ valeur: p, libelle: p }))] }],
    onchange: maj,
  });
  liste = listeAdaptative({
    items: lignes,
    colonnes: [
      { cle: "nom", titre: t("Client"), tri: (x) => x.nom },
      { cle: "montant", titre: t("Montant"), num: true, mobile: "droite", tri: (x) => x.montant, rendu: (x) => `CHF ${x.montant}` },
      { cle: "ref", titre: t("Référence"), mobile: "sous" },
      { cle: "pays", titre: t("Pays"), mobile: "sous" },
      { cle: "statut", titre: t("Statut"), mobile: "pied", rendu: (x) => pastille(x.statut) },
    ],
    lien: (x) => `#/dossiers?q=${x.ref}`,
    tri: { cle: "nom" },
  });
  return h(
    "div",
    { "data-titre": t("Composants"), "data-large": "1" },
    h("div", { class: "entete" }, h("div", null, h("h1", null, t("Composants mobiles")), h("p", { class: "sous" }, t("Mode d'emploi vivant des composants de ui.mjs et commun.mjs.")))),
    h("section", null, h("h2", null, t("Feuille du bas et formulaire")), h("p", { class: "aide" }, t("Remplissez un champ puis fermez : une confirmation s'affiche, et la saisie est reprise à la réouverture.")), h("button", { type: "button", class: "principal", onclick: ouvrirFormulaire }, t("Ouvrir la fenêtre"))),
    h("section", null, h("h2", null, t("Recherche, puces et filtres")), filtres.noeud, liste.noeud),
    h("section", null, h("h2", null, t("Puces seules")), puces({ options: ["Une", "Deux", "Trois", "Quatre", "Cinq", "Six"].map((x) => ({ valeur: x, libelle: x })), valeur: "Une", libelle: t("Exemple") }).noeud),
    h("section", null, h("h2", null, t("Squelette de chargement")), squelette(3)),
    barreAction(h("button", { type: "button", class: "secondaire", onclick: () => toast(t("Annulé.")) }, t("Annuler")), h("button", { type: "button", class: "principal", onclick: () => toast(t("Enregistré.")) }, t("Enregistrer")))
  );
}
