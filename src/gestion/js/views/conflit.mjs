// Fenêtre « modifiée entre-temps par X » : quand deux personnes changent le même champ d'une fiche, les deux valeurs sont montrées côte à côte
// et la personne choisit. Les champs que l'autre seul a changés ne passent jamais ici (conflit-calc.mjs les garde sans rien demander).
import { h, modal } from "../ui.mjs";
import { tr } from "../i18n.mjs";

// `etiquettes` : { champ: libellé lisible } ; `format(cle, valeur)` : texte d'une valeur (nom du partenaire, date, oui ou non…). Renvoie « sien », « miens » ou null.
export function demanderArbitrage({ conflits, par = "", titreFiche = "", etiquettes = {}, format = () => null }) {
  const montre = (cle, v) => {
    const f = format(cle, v);
    if (f !== null && f !== undefined) return f;
    if (v === null || v === undefined || v === "") return tr("(vide)");
    if (typeof v === "boolean") return v ? tr("oui") : tr("non");
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  };
  const nom = (cle) => etiquettes[cle] || etiquettes[cle.split(".")[0]] || cle;
  return new Promise((resolve) => {
    let choix = null;
    const fin = (c) => { choix = c; fermer(); };
    const intro = par
      ? tr("{titre} a été modifiée entre-temps par {par}. Pour les champs ci-dessous vous avez tous les deux changé la valeur.", { titre: titreFiche || tr("Cette fiche"), par })
      : tr("{titre} a été modifiée entre-temps par quelqu'un d'autre. Pour les champs ci-dessous vous avez tous les deux changé la valeur.", { titre: titreFiche || tr("Cette fiche") });
    const fermer = modal(
      tr("Modifiée entre-temps"),
      h(
        "div",
        { class: "modal-corps" },
        h("p", null, intro),
        h("p", { class: "aide" }, tr("Le reste de votre saisie est gardé, et ce que l'autre personne a changé ailleurs aussi.")),
        h("table", { class: "tableau-conflit" },
          h("thead", null, h("tr", null, h("th", null, tr("Champ")), h("th", null, par ? tr("Version de {par}", { par }) : tr("Version enregistrée")), h("th", null, tr("Votre version")))),
          h("tbody", null, conflits.map((c) => h("tr", null, h("th", { scope: "row" }, nom(c.cle)), h("td", null, montre(c.cle, c.sienne)), h("td", null, montre(c.cle, c.mienne)))))
        ),
        h("div", { class: "actions colonne" },
          h("button", { class: "principal", type: "button", onclick: () => fin("miens") }, tr("Garder la mienne")),
          h("button", { class: "secondaire", type: "button", onclick: () => fin("sien") }, par ? tr("Garder celle de {par}", { par }) : tr("Garder celle enregistrée")),
          h("button", { class: "lien", type: "button", onclick: () => fin(null) }, tr("Ne pas enregistrer"))
        )
      ),
      { protege: false, ferme: () => resolve(choix) }
    );
  });
}
