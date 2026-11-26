// Les options d'une réservation dans sa fenêtre (26.11.2026, un dossier du 26.11.2026) : chaque option du service avec son prix modifiable (comme le
// prix du service), « Retirer », et « Ajouter une option » parmi celles du tarif. Le montant vendu affiché suit : prix du service + options.
// À l'enregistrement, `voulues()` donne la liste voulue (ou null si rien n'a changé) ; la facture et le devis suivent par le chemin commun
// (suivreFacture → contenuAvecService, `options`), la réservation garde les lignes ajoutées et perd les lignes retirées.
import { etat, chargerDossier } from "../etat.mjs";
import { h, num } from "../ui.mjs";
import { formatMontant } from "../calc.mjs";
import { estLigneOption, optionsDe, libelleUnite } from "../partenaires-calc.mjs";
import { uid } from "../defauts.mjs";
import { tr } from "../i18n.mjs";

const arr = (x) => Math.round(x * 100) / 100;
const brut = (l) => (l.unite !== null && l.unite !== undefined && l.unite !== "" && l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.unite) * Number(l.qte) : l.montant !== null && l.montant !== undefined && l.montant !== "" ? Number(l.montant) : 0);
const nb = (v) => {
  const x = num(v);
  return x === null || Number.isNaN(x) ? null : x;
};

// Les lignes d'option de la réservation, sur sa facture (sinon son devis).
export function lignesOptionsDe(r, documents = etat.db.documents) {
  const ids = new Set([r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean));
  const docs = (documents || []).filter((d) => d.dossier_id === r.dossier_id && d.contenu && Array.isArray(d.contenu.lignes));
  const doc = docs.find((d) => d.type !== "devis" && d.contenu.lignes.some((l) => ids.has(l.id))) || docs.find((d) => d.contenu.lignes.some((l) => ids.has(l.id)));
  return doc ? doc.contenu.lignes.filter((l) => ids.has(l.id) && estLigneOption(l)) : [];
}

// `vente` : le champ « Vendu au client » du formulaire, qui suit le total. `personnes()` : { adultes, enfants } saisis, pour une option par personne.
export function blocOptionsReservation(r, { vente, personnes = () => r.personnes || {}, devise = "THB" } = {}) {
  const noeud = h("div", { class: "champ options-resa", hidden: true });
  let initiales = [];
  let etatOptions = [];
  let pret = false;
  const somme = (liste) => arr(liste.reduce((s, o) => s + (nb(o.prix) || 0), 0));
  const majVente = (avant) => {
    const v = nb(vente.value);
    if (v === null) return;
    vente.value = String(arr(v - avant + somme(etatOptions)));
    vente.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const nomDe = (pid, l) => ((etat.db.prestations.find((p) => p.id === pid) || {}).libelle || (l && (l.titre || l.libelle)) || "");
  function dessiner() {
    const dispo = optionsDe(r.prestation_id, etat.db.prestations, etat.db.partenaires).filter((o) => !etatOptions.some((x) => x.prestation_id === o.id));
    noeud.hidden = !etatOptions.length && !dispo.length;
    if (noeud.hidden) return noeud.replaceChildren();
    const choix = h("select", { id: "r-opt-ajout", "aria-label": tr("Option à ajouter") }, dispo.map((o) => h("option", { value: o.id }, `${o.libelle} · ${o.prix_vente === null || o.prix_vente === undefined ? tr("prix à saisir") : `${formatMontant(o.prix_vente, devise)} ${libelleUnite(o.unite)}`}`)));
    // replaceChildren écrirait « null » pour une partie absente : seules les parties présentes passent.
    noeud.replaceChildren(
      ...[h("p", { class: "etiquette" }, tr("Options")),
      etatOptions.length
        ? h(
            "ul",
            { class: "options-resa-liste" },
            etatOptions.map((o) => {
              const prix = h("input", { id: `r-opt-${o.ligne_id}`, type: "text", inputmode: "decimal", value: o.prix, "aria-label": tr("Prix de l'option {nom}", { nom: o.nom }) });
              prix.addEventListener("input", () => {
                const avant = somme(etatOptions);
                o.prix = prix.value;
                majVente(avant);
              });
              return h(
                "li",
                null,
                h("span", { class: "options-resa-nom" }, o.nom),
                prix,
                h("button", { class: "secondaire", type: "button", onclick: () => { const avant = somme(etatOptions); etatOptions = etatOptions.filter((x) => x !== o); majVente(avant); dessiner(); } }, tr("Retirer"))
              );
            })
          )
        : null,
      dispo.length
        ? h("div", { class: "options-resa-ajout" }, choix, h("button", { class: "secondaire", type: "button", onclick: () => {
            const o = dispo.find((x) => x.id === choix.value);
            if (!o) return;
            const p = personnes();
            const nbPers = (Number(p.adultes) || 0) + (Number(p.enfants) || 0);
            const q = ["pp", "ad"].includes(o.unite) ? Math.max(1, nbPers) : 1;
            const avant = somme(etatOptions);
            etatOptions = [...etatOptions, { ligne_id: uid(), prestation_id: o.id, nom: o.libelle, prix: o.prix_vente === null || o.prix_vente === undefined ? "" : String(arr(Number(o.prix_vente) * q)), nouvelle: true }];
            majVente(avant);
            dessiner();
          } }, tr("Ajouter l'option")))
        : null,
      h("p", { class: "aide" }, tr("Le prix de chaque option est son total. « Vendu au client » compte le service et ses options ; une seule réservation, un seul voucher."))].filter(Boolean)
    );
    return noeud;
  }
  const remplir = () => {
    initiales = lignesOptionsDe(r).map((l) => ({ ligne_id: l.id, prestation_id: l.prestation_id || null, nom: nomDe(l.prestation_id, l), prix: String(arr(brut(l))) }));
    etatOptions = initiales.map((o) => ({ ...o }));
    // Une option venue d'une carte « modification » de l'Assistant (r.options_ajout) : ajoutée comme si elle avait été choisie ici.
    for (const a of Array.isArray(r.options_ajout) ? r.options_ajout : []) {
      if (!a || !a.prestation_id || etatOptions.some((x) => x.prestation_id === a.prestation_id)) continue;
      const o = etat.db.prestations.find((x) => x.id === a.prestation_id);
      if (!o) continue;
      const avant = somme(etatOptions);
      etatOptions.push({ ligne_id: uid(), prestation_id: o.id, nom: o.libelle, prix: a.prix === null || a.prix === undefined ? (o.prix_vente === null || o.prix_vente === undefined ? "" : String(o.prix_vente)) : String(a.prix), nouvelle: true });
      majVente(avant);
    }
    pret = true;
    dessiner();
  };
  // Un service sans réservation enregistrée, sans tarif ni lignes de facture : pas d'options ici (elles s'ajoutent avec le service).
  if (r.id && r.dossier_id && (r.ligne_id || (r.details && r.details.lignes_ids && r.details.lignes_ids.length))) {
    if (etat.db.documents.some((d) => d.dossier_id === r.dossier_id)) remplir();
    else chargerDossier(r.dossier_id).then(remplir).catch((err) => console.error("options de la réservation", err));
  }
  return {
    noeud,
    // null : rien n'a changé (ou les lignes n'étaient pas encore lues). Sinon la liste voulue pour contenuAvecService.
    voulues() {
      if (!pret) return null;
      const meme = etatOptions.length === initiales.length && etatOptions.every((o) => { const i = initiales.find((x) => x.ligne_id === o.ligne_id); return i && nb(i.prix) === nb(o.prix); });
      return meme ? null : etatOptions.map((o) => ({ ligne_id: o.ligne_id, prestation_id: o.prestation_id, prix: nb(o.prix), ...(o.nouvelle ? { nouvelle: true } : {}) }));
    },
    // Un prix d'option illisible : le message, ou "".
    erreur() {
      const mauvaise = etatOptions.find((o) => nb(o.prix) === null || nb(o.prix) < 0);
      return mauvaise ? tr("Indiquez le prix de l'option « {nom} », 0 si elle est offerte.", { nom: mauvaise.nom }) : "";
    },
  };
}
