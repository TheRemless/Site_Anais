import { etat, inserer, modifier, supprimer, naviguer } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, num } from "../ui.mjs";
import { formatMontant } from "../calc.mjs";

const GENRES = [
  ["formule", "Formules", "Un bloc avec son titre et sa liste de prestations, éventuellement avec un prix par jour."],
  ["region", "Régions et villes", "Une ligne par région ou ville, avec son prix."],
  ["supplement", "Suppléments", "Lignes à ajouter au besoin, comme une réservation de train."],
];

function formulaire(entree, apres) {
  const genre = h("select", { id: "k-genre" }, GENRES.map(([v, l]) => h("option", { value: v }, l)));
  genre.value = entree.kind || "formule";
  const libelle = h("input", { id: "k-lib", value: entree.libelle || "", required: true });
  const intro = h("input", { id: "k-intro", value: entree.intro || "", placeholder: "comprenant:" });
  const puces = h("textarea", { id: "k-puces", rows: 5 });
  puces.value = (entree.puces || []).join("\n");
  const prix = h("input", { id: "k-prix", type: "number", step: "0.01", min: "0", value: entree.prix ?? "" });
  const actif = h("input", { id: "k-actif", type: "checkbox", checked: entree.actif !== false });
  const bloc = h("div", null, champ("Complément après le libellé", intro), champ("Prestations comprises, une par ligne", puces));
  const maj = () => (bloc.hidden = genre.value !== "formule");
  genre.addEventListener("change", maj);
  maj();
  return h(
    "form",
    {
      class: "modal-corps",
      onsubmit: async (e) => {
        e.preventDefault();
        const valeurs = {
          kind: genre.value,
          libelle: libelle.value.trim(),
          intro: genre.value === "formule" ? intro.value.trim() : "",
          puces: genre.value === "formule" ? puces.value.split("\n").map((x) => x.trim()).filter(Boolean) : [],
          prix: num(prix.value),
          actif: actif.checked,
        };
        if (entree.id) await modifier("catalogue", entree.id, valeurs);
        else await inserer("catalogue", { ...valeurs, ordre: Math.max(0, ...etat.db.catalogue.map((x) => x.ordre || 0)) + 1 });
        toast("Catalogue mis à jour.");
        apres();
      },
    },
    champ("Genre", genre),
    champ("Libellé", libelle),
    bloc,
    champ("Prix en CHF (prix par jour pour une formule)", prix, "Laissez vide quand le prix dépend du dossier."),
    h("label", { class: "case", for: "k-actif" }, actif, "Proposé dans l'éditeur de devis"),
    h("div", { class: "actions" }, entree.id ? h("button", { class: "danger", type: "button", onclick: async () => { if (await confirmer(`Supprimer « ${entree.libelle} » du catalogue ? Les devis déjà créés ne changent pas.`, "Supprimer", true)) { await supprimer("catalogue", entree.id); apres(); } } }, "Supprimer") : null, h("button", { class: "principal", type: "submit" }, "Enregistrer"))
  );
}

export function catalogue() {
  const ouvrir = (entree) => {
    const fermer = modal(entree.id ? "Modifier l'entrée" : "Nouvelle entrée", formulaire(entree, () => (fermer(), naviguer(location.hash))));
  };
  return h(
    "div",
    { "data-titre": "Catalogue" },
    h("div", { class: "entete" }, h("h1", null, "Catalogue"), h("button", { class: "principal", type: "button", onclick: () => ouvrir({}) }, "Nouvelle entrée")),
    h("p", { class: "sous" }, "Les formules et les prix que vous reprenez souvent dans les devis. Un prix modifié ici ne change pas les documents déjà créés."),
    GENRES.map(([genre, titre, aide]) => {
      const lignes = etat.db.catalogue.filter((x) => x.kind === genre).sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
      return h(
        "section",
        null,
        h("h2", null, titre),
        h("p", { class: "aide" }, aide),
        lignes.length
          ? h(
              "table",
              { class: "tableau simple" },
              h("thead", null, h("tr", null, h("th", { scope: "col" }, "Libellé"), h("th", { scope: "col", class: "num" }, "Prix"), h("th", { scope: "col" }, "Éditeur"), h("th", null))),
              h("tbody", null, lignes.map((x) => h("tr", null, h("td", { "data-label": "Libellé" }, x.libelle), h("td", { class: "num", "data-label": "Prix" }, x.prix != null ? formatMontant(x.prix) : "variable"), h("td", { "data-label": "Éditeur" }, x.actif ? "Proposé" : "Masqué"), h("td", { class: "action-cellule" }, h("button", { class: "secondaire petit", type: "button", onclick: () => ouvrir(x) }, "Modifier")))))
            )
          : h("p", { class: "vide-court" }, "Aucune entrée.")
      );
    })
  );
}
