// Sélecteur de prestations et de trajets de partenaires pour l'éditeur de devis.
// La fenêtre reste ouverte pour enchaîner plusieurs ajouts ; chaque ajout renvoie des lignes prêtes pour le document.
import { etat, nomPartenaire, netPrestation, netTrajet } from "../etat.mjs";
import { h, modal, toast } from "../ui.mjs";
import { formatMontant } from "../calc.mjs";
import { FAMILLES, nomFamille, libelleUnite, correspond, filtrerTrajets, ligneDepuisPrestation, lignesDepuisTrajet } from "../partenaires-calc.mjs";

// `sansCompagnie` : le nom de la compagnie n'est pas répété dans le libellé des trajets (facture de Secret).
export function choisirPrestation({ langue = "", devise = "THB", onAjout, sansCompagnie = false }) {
  let onglet = etat.db.prestations.some((x) => x.actif !== false) ? "tarifs" : "trajets";
  const date = h("input", { id: "cp-date", type: "date", onchange: () => dessiner() });
  const q = h("input", { id: "cp-q", type: "search", placeholder: "Île, excursion, transfert, compagnie…", autocomplete: "off", oninput: () => dessiner() });
  const liste = h("ul", { class: "choix-liste" });
  const compte = h("p", { class: "aide" });
  const onglets = h("div", { class: "onglets sous-onglets" }, [["tarifs", "Tarifs"], ["trajets", "Trajets"]].map(([code, libelle]) => h("button", { type: "button", "aria-pressed": code === onglet ? "true" : "false", onclick: (e) => { onglet = code; for (const b of onglets.children) b.setAttribute("aria-pressed", b === e.currentTarget ? "true" : "false"); dessiner(); } }, libelle)));
  const prix = (n) => (n === null || n === undefined ? "prix à définir" : formatMontant(n, devise));
  const ajoute = (lignes, nom) => {
    onAjout(lignes);
    toast(`${nom} ajouté au document.`);
  };
  const qte = (id, valeur, libelle) => h("label", { class: "choix-qte" }, h("span", null, libelle), h("input", { id, type: "number", min: "0", step: "1", value: valeur, inputmode: "numeric" }));

  function dessiner() {
    liste.replaceChildren();
    if (onglet === "tarifs") {
      const lignes = etat.db.prestations
        .filter((x) => x.actif !== false && correspond(`${x.libelle} ${x.libelle_en} ${x.groupe} ${nomFamille(x.famille)} ${nomPartenaire(x.partenaire_id)}`, q.value))
        .sort((a, b) => FAMILLES.findIndex(([c]) => c === a.famille) - FAMILLES.findIndex(([c]) => c === b.famille) || nomPartenaire(a.partenaire_id).localeCompare(nomPartenaire(b.partenaire_id)) || (a.ordre || 0) - (b.ordre || 0));
      compte.textContent = `${lignes.length} tarif${lignes.length > 1 ? "s" : ""}.`;
      let famille = null;
      for (const x of lignes) {
        if (x.famille !== famille) {
          famille = x.famille;
          liste.append(h("li", { class: "choix-groupe" }, nomFamille(famille)));
        }
        const d = x.details || {};
        const champQte = x.sur_place ? null : qte(`cp-q-${x.id}`, 1, "Quantité");
        liste.append(
          h(
            "li",
            { class: "choix" },
            h("div", { class: "choix-texte" }, h("strong", null, x.libelle), h("span", null, [nomPartenaire(x.partenaire_id), x.groupe, d.horaires || d.capacite || d.duree].filter(Boolean).join(" · "))),
            h("div", { class: "choix-prix" }, h("strong", null, prix(x.prix_vente)), h("span", null, x.sur_place ? "à payer sur place" : libelleUnite(x.unite))),
            h("div", { class: "choix-actions" }, champQte, h("button", { class: "principal petit", type: "button", onclick: () => ajoute([ligneDepuisPrestation(x, netPrestation(x), { langue, date: date.value, qte: champQte ? Number(champQte.querySelector("input").value) || 1 : 1, devise })], x.sur_place ? "Note sur les frais de parc" : x.libelle) }, x.sur_place ? "Ajouter la note" : "Ajouter"))
          )
        );
      }
    } else {
      const lignes = filtrerTrajets(etat.db.trajets, { date: date.value, q: q.value, nomPartenaire });
      compte.textContent = `${lignes.length} départ${lignes.length > 1 ? "s" : ""}${date.value ? " à cette date" : ""}.`;
      for (const t of lignes) {
        const ad = qte(`cp-a-${t.id}`, 1, "Adultes");
        const ch = qte(`cp-c-${t.id}`, 0, "Enfants");
        liste.append(
          h(
            "li",
            { class: "choix" },
            h("div", { class: "choix-texte" }, h("strong", null, `${t.de} → ${t.vers}, ${t.depart}`), h("span", null, [nomPartenaire(t.partenaire_id), t.mode, t.duree, t.periode && t.periode !== "Toute la période du contrat" ? t.periode : ""].filter(Boolean).join(" · "))),
            h("div", { class: "choix-prix" }, h("strong", null, prix(t.prix_adulte)), h("span", null, t.prix_enfant !== null && t.prix_enfant !== undefined ? `enfant ${prix(t.prix_enfant)}` : "par adulte")),
            h("div", { class: "choix-actions" }, ad, ch, h("button", { class: "principal petit", type: "button", onclick: () => { const l = lignesDepuisTrajet(t, netTrajet(t), { langue, date: date.value, adultes: Number(ad.querySelector("input").value) || 0, enfants: Number(ch.querySelector("input").value) || 0, compagnie: sansCompagnie ? "" : nomPartenaire(t.partenaire_id) }); if (!l.length) return toast("Indiquez au moins un adulte ou un enfant.", true); ajoute(l, `${t.de} → ${t.vers}`); } }, "Ajouter"))
          )
        );
      }
    }
    if (!liste.children.length) liste.append(h("li", { class: "choix-vide" }, "Rien ne correspond. Essayez un autre mot, une autre date ou l'autre onglet."));
  }
  dessiner();
  const fermer = modal(
    "Prestation d'un partenaire",
    h(
      "div",
      { class: "modal-corps choix-prestation" },
      h("div", { class: "grille-form" }, h("div", { class: "champ" }, h("label", { for: "cp-date" }, "Date du service (facultatif)"), date), h("div", { class: "champ" }, h("label", { for: "cp-q" }, "Rechercher"), q)),
      onglets,
      compte,
      liste,
      h("p", { class: "aide" }, langue === "en" ? "Document en anglais : le libellé anglais de la prestation est utilisé quand il existe." : "Le libellé, le prix de vente et l'unité viennent de la base partenaires. Le net reste attaché à la ligne pour calculer la marge.")
    ),
    { large: true }
  );
  setTimeout(() => q.focus(), 50);
  return fermer;
}
