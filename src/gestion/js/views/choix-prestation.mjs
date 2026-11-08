// Sélecteur de prestations et de trajets de partenaires pour l'éditeur de devis.
// La fenêtre reste ouverte pour enchaîner plusieurs ajouts ; chaque ajout renvoie des lignes prêtes pour le document.
import { etat, nomPartenaire, netPrestation, netTrajet } from "../etat.mjs";
import { h, champ, modal, toast } from "../ui.mjs";
import { formatMontant } from "../calc.mjs";
import { FAMILLES, nomFamille, libelleUnite, correspond, filtrerTrajets, ligneDepuisPrestation, lignesDepuisTrajet, ligneLibre } from "../partenaires-calc.mjs";
import { tr, pluriel, N_ } from "../i18n.mjs";

// `sansCompagnie` : le nom de la compagnie n'est pas répété dans le libellé des trajets (facture de Secret).
export function choisirPrestation({ langue = "", devise = "THB", onAjout, sansCompagnie = false }) {
  let onglet = etat.db.prestations.some((x) => x.actif !== false) ? "tarifs" : "trajets";
  const date = h("input", { id: "cp-date", type: "date", onchange: () => dessiner() });
  const q = h("input", { id: "cp-q", type: "search", placeholder: tr("Île, excursion, transfert, compagnie…"), autocomplete: "off", oninput: () => dessiner() });
  const liste = h("ul", { class: "choix-liste" });
  const compte = h("p", { class: "aide" });
  const onglets = h("div", { class: "onglets sous-onglets" }, [["tarifs", tr("Tarifs")], ["trajets", tr("Trajets")], ["libre", tr("Autre prestation")]].map(([code, libelle]) => h("button", { type: "button", "aria-pressed": code === onglet ? "true" : "false", onclick: (e) => { onglet = code; for (const b of onglets.children) b.setAttribute("aria-pressed", b === e.currentTarget ? "true" : "false"); dessiner(); } }, libelle)));
  const prix = (n) => (n === null || n === undefined ? tr("prix à définir") : formatMontant(n, devise));
  const ajoute = (lignes, nom) => {
    onAjout(lignes);
    toast(tr("{nom} ajouté au document.", { nom }));
  };
  const champRecherche = h("div", { class: "champ" }, h("label", { for: "cp-q" }, tr("Rechercher")), q);
  const noteBas = h("p", { class: "aide" }, langue === "en" ? tr("Document en anglais : le libellé anglais de la prestation est utilisé quand il existe.") : tr("Le libellé, le prix de vente et l'unité viennent de la base partenaires. Le net reste attaché à la ligne pour calculer la marge."));

  // Onglet « Autre prestation » : un service qui n'est pas dans la base, saisi à la main mais avec sa réservation et son voucher.
  const libelleLibre = h("input", { id: "cp-l-nom", autocomplete: "off" });
  const prixLibre = h("input", { id: "cp-l-prix", type: "number", min: "0", step: "any", inputmode: "decimal" });
  const qteLibre = h("input", { id: "cp-l-qte", type: "number", min: "1", step: "1", value: 1, inputmode: "numeric" });
  const partenaireLibre = h("select", { id: "cp-l-part" }, h("option", { value: "" }, tr("Aucun partenaire")), [...etat.db.partenaires].sort((a, b) => a.nom.localeCompare(b.nom)).map((p) => h("option", { value: p.id }, p.nom)));
  const erreurLibre = h("p", { class: "erreur-form", role: "alert" });
  const formulaireLibre = h(
    "form",
    {
      class: "choix-libre",
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        erreurLibre.textContent = "";
        if (!libelleLibre.value.trim()) return (erreurLibre.textContent = tr("Indiquez le nom de la prestation.")), libelleLibre.focus();
        if (prixLibre.value === "" || !(Number(prixLibre.value) >= 0)) return (erreurLibre.textContent = tr("Indiquez le prix de vente, 0 si la prestation est offerte.")), prixLibre.focus();
        const l = ligneLibre({ libelle: libelleLibre.value, prix: prixLibre.value, qte: qteLibre.value, partenaire_id: partenaireLibre.value, date: date.value });
        ajoute([l], l.libelle);
        libelleLibre.value = "";
        prixLibre.value = "";
        qteLibre.value = 1;
        libelleLibre.focus();
      },
    },
    h("p", { class: "aide" }, tr("Pour une prestation qui n'est pas dans la base. Elle va sur la facture avec sa réservation et son voucher. Pour la retrouver à chaque fois, créez-la plutôt dans la fiche du partenaire.")),
    champ(tr("Prestation"), libelleLibre, tr("Le nom tel que le client le lira sur la facture.")),
    h("div", { class: "grille-form compacte" }, champ(tr("Prix de vente ({devise})", { devise }), prixLibre, tr("Par unité.")), champ(tr("Quantité"), qteLibre)),
    champ(tr("Partenaire (facultatif)"), partenaireLibre, tr("Celui qui réalise la prestation, s'il y en a un.")),
    erreurLibre,
    h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, tr("Ajouter")))
  );
  const qte = (id, valeur, libelle) => h("label", { class: "choix-qte" }, h("span", null, libelle), h("input", { id, type: "number", min: "0", step: "1", value: valeur, inputmode: "numeric" }));

  function dessiner() {
    liste.replaceChildren();
    const libre = onglet === "libre";
    formulaireLibre.hidden = !libre;
    for (const x of [liste, compte, champRecherche, noteBas]) x.hidden = libre;
    if (libre) return;
    if (onglet === "tarifs") {
      const lignes = etat.db.prestations
        .filter((x) => x.actif !== false && correspond(`${x.libelle} ${x.libelle_en} ${x.groupe} ${nomFamille(x.famille)} ${nomPartenaire(x.partenaire_id)}`, q.value))
        .sort((a, b) => FAMILLES.findIndex(([c]) => c === a.famille) - FAMILLES.findIndex(([c]) => c === b.famille) || nomPartenaire(a.partenaire_id).localeCompare(nomPartenaire(b.partenaire_id)) || (a.ordre || 0) - (b.ordre || 0));
      compte.textContent = pluriel(lignes.length, N_("{n} tarif."), N_("{n} tarifs."));
      let famille = null;
      for (const x of lignes) {
        if (x.famille !== famille) {
          famille = x.famille;
          liste.append(h("li", { class: "choix-groupe" }, nomFamille(famille)));
        }
        const d = x.details || {};
        const champQte = x.sur_place ? null : qte(`cp-q-${x.id}`, 1, tr("Quantité"));
        liste.append(
          h(
            "li",
            { class: "choix" },
            h("div", { class: "choix-texte" }, h("strong", null, x.libelle), h("span", null, [nomPartenaire(x.partenaire_id), x.groupe, d.horaires || d.capacite || d.duree].filter(Boolean).join(" · "))),
            h("div", { class: "choix-prix" }, h("strong", null, prix(x.prix_vente)), h("span", null, x.sur_place ? tr("à payer sur place") : libelleUnite(x.unite))),
            h("div", { class: "choix-actions" }, champQte, h("button", { class: "principal petit", type: "button", onclick: () => ajoute([ligneDepuisPrestation(x, netPrestation(x), { langue, date: date.value, qte: champQte ? Number(champQte.querySelector("input").value) || 1 : 1, devise })], x.sur_place ? tr("Note sur les frais de parc") : x.libelle) }, x.sur_place ? tr("Ajouter la note") : tr("Ajouter")))
          )
        );
      }
    } else {
      const lignes = filtrerTrajets(etat.db.trajets, { date: date.value, q: q.value, nomPartenaire });
      compte.textContent = date.value ? pluriel(lignes.length, N_("{n} départ à cette date."), N_("{n} départs à cette date.")) : pluriel(lignes.length, N_("{n} départ."), N_("{n} départs."));
      for (const t of lignes) {
        const ad = qte(`cp-a-${t.id}`, 1, tr("Adultes"));
        const ch = qte(`cp-c-${t.id}`, 0, tr("Enfants"));
        liste.append(
          h(
            "li",
            { class: "choix" },
            h("div", { class: "choix-texte" }, h("strong", null, `${t.de} → ${t.vers}, ${t.depart}`), h("span", null, [nomPartenaire(t.partenaire_id), t.mode, t.duree, t.periode && t.periode !== "Toute la période du contrat" ? t.periode : ""].filter(Boolean).join(" · "))),
            h("div", { class: "choix-prix" }, h("strong", null, prix(t.prix_adulte)), h("span", null, t.prix_enfant !== null && t.prix_enfant !== undefined ? tr("enfant {prix}", { prix: prix(t.prix_enfant) }) : tr("par adulte"))),
            h("div", { class: "choix-actions" }, ad, ch, h("button", { class: "principal petit", type: "button", onclick: () => { const nbEnfants = Number(ch.querySelector("input").value) || 0; if (nbEnfants > 0 && (t.prix_enfant === null || t.prix_enfant === undefined)) return toast(tr("Ce trajet n'a pas de tarif enfant : les enfants ne seraient pas facturés. Ajoutez le tarif enfant au partenaire ou mettez-les en adultes."), true); const l = lignesDepuisTrajet(t, netTrajet(t), { langue, date: date.value, adultes: Number(ad.querySelector("input").value) || 0, enfants: Number(ch.querySelector("input").value) || 0, compagnie: sansCompagnie ? "" : nomPartenaire(t.partenaire_id) }); if (!l.length) return toast(tr("Indiquez au moins un adulte ou un enfant."), true); ajoute(l, `${t.de} → ${t.vers}`); } }, tr("Ajouter")))
          )
        );
      }
    }
    if (!liste.children.length) liste.append(h("li", { class: "choix-vide" }, tr("Rien ne correspond. Essayez un autre mot, une autre date ou l'autre onglet.")));
  }
  dessiner();
  const fermer = modal(
    tr("Prestation d'un partenaire"),
    h(
      "div",
      { class: "modal-corps choix-prestation" },
      h("div", { class: "grille-form" }, h("div", { class: "champ" }, h("label", { for: "cp-date" }, tr("Date du service (facultatif)")), date), champRecherche),
      onglets,
      formulaireLibre,
      compte,
      liste,
      noteBas
    ),
    { large: true }
  );
  setTimeout(() => q.focus(), 50);
  return fermer;
}
