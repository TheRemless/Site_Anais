// Les options d'une réservation dans sa fenêtre : chaque option du service avec son prix modifiable, « Retirer », et « Ajouter l'option »
// parmi celles du tarif. Le prix s'écrit comme partout ailleurs (ajout d'un service, « Vérifier avant », carte de l'Assistant) : le prix
// UNITAIRE, avec son unité à côté (« par bateau », « par personne × 2 »). « Vendu au client » suit : prix du service + options.
// À l'enregistrement, `voulues()` donne la liste voulue (ou null si rien n'a changé) ; la facture et le devis suivent par le chemin commun
// (suivreFacture → contenuAvecService, `options`), la réservation garde les lignes ajoutées et perd les lignes retirées.
// Un autre partenaire choisi : les options de l'ancien quittent le service (une option est toujours du partenaire de son service). Un autre
// tarif : la liste des options proposées est celle du nouveau tarif ; celles déjà prises restent.
import { etat, chargerDossier } from "../etat.mjs";
import { h, num, toast } from "../ui.mjs";
import { formatMontant } from "../calc.mjs";
import { estLigneOption, optionsDe, libelleUnite } from "../partenaires-calc.mjs";
import { uid } from "../defauts.mjs";
import { tr } from "../i18n.mjs";

const arr = (x) => Math.round(x * 100) / 100;
const nb = (v) => {
  const x = num(v);
  return x === null || Number.isNaN(x) ? null : x;
};
const vide = (v) => v === null || v === undefined || v === "";
// Le prix unitaire et la quantité d'une ligne de facture (un montant sans prix unitaire : la quantité 1).
const unitaireDe = (l) => (!vide(l.unite) ? { unitaire: Number(l.unite), qte: vide(l.qte) ? 1 : Number(l.qte) } : { unitaire: vide(l.montant) ? 0 : Number(l.montant), qte: 1 });

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
  let prestationId = r.prestation_id || null;
  const prestation = (id) => etat.db.prestations.find((p) => p.id === id) || null;
  const totalDe = (o) => (nb(o.unitaire) || 0) * (Number(o.qte) || 1);
  const somme = (liste) => arr(liste.reduce((s, o) => s + totalDe(o), 0));
  const majVente = (avant) => {
    const v = nb(vente.value);
    if (v === null) return;
    vente.value = String(arr(v - avant + somme(etatOptions)));
    vente.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const qtePour = (o) => {
    const p = personnes();
    return ["pp", "ad"].includes(o.unite) ? Math.max(1, (Number(p.adultes) || 0) + (Number(p.enfants) || 0)) : 1;
  };
  function dessiner() {
    const dispo = optionsDe(prestationId, etat.db.prestations, etat.db.partenaires).filter((o) => !etatOptions.some((x) => x.prestation_id === o.id));
    noeud.hidden = !etatOptions.length && !dispo.length;
    if (noeud.hidden) return noeud.replaceChildren();
    const choix = h("select", { id: "r-opt-ajout", "aria-label": tr("Option à ajouter") }, dispo.map((o) => h("option", { value: o.id }, `${o.libelle} · ${vide(o.prix_vente) ? tr("prix à saisir") : `${formatMontant(o.prix_vente, devise)} ${libelleUnite(o.unite)}`}`)));
    // replaceChildren écrirait « null » pour une partie absente : seules les parties présentes passent.
    noeud.replaceChildren(
      ...[
        h("p", { class: "etiquette" }, tr("Options")),
        etatOptions.length
          ? h(
              "ul",
              { class: "options-resa-liste" },
              etatOptions.map((o) => {
                const prix = h("input", { id: `r-opt-${o.ligne_id}`, type: "text", inputmode: "decimal", value: o.unitaire, "aria-label": tr("Prix de l'option {nom}", { nom: o.nom }) });
                prix.addEventListener("input", () => {
                  const avant = somme(etatOptions);
                  o.unitaire = prix.value;
                  majVente(avant);
                });
                return h(
                  "li",
                  null,
                  h("span", { class: "options-resa-nom" }, o.nom),
                  h("span", { class: "options-resa-prix" }, prix, h("small", null, `${libelleUnite(o.unite)}${o.qte > 1 ? ` × ${o.qte}` : ""}`)),
                  h("button", { class: "secondaire", type: "button", onclick: () => { const avant = somme(etatOptions); etatOptions = etatOptions.filter((x) => x !== o); majVente(avant); dessiner(); } }, tr("Retirer"))
                );
              })
            )
          : null,
        dispo.length
          ? h("div", { class: "options-resa-ajout" }, choix, h("button", { class: "secondaire", type: "button", onclick: () => {
              const o = dispo.find((x) => x.id === choix.value);
              if (!o) return;
              const avant = somme(etatOptions);
              etatOptions = [...etatOptions, { ligne_id: uid(), prestation_id: o.id, nom: o.libelle, unite: o.unite || "", qte: qtePour(o), unitaire: vide(o.prix_vente) ? "" : String(o.prix_vente), nouvelle: true }];
              majVente(avant);
              dessiner();
            } }, tr("Ajouter l'option")))
          : null,
        h("p", { class: "aide" }, tr("Le prix de chaque option est son prix unitaire, comme au catalogue. « Vendu au client » compte le service et ses options ; une seule réservation, un seul voucher.")),
      ].filter(Boolean)
    );
    return noeud;
  }
  const remplir = () => {
    initiales = lignesOptionsDe(r).map((l) => {
      const p = prestation(l.prestation_id);
      const { unitaire, qte } = unitaireDe(l);
      return { ligne_id: l.id, prestation_id: l.prestation_id || null, nom: (p && p.libelle) || l.titre || l.libelle || "", unite: (p && p.unite) || "", qte, unitaire: String(arr(unitaire)) };
    });
    etatOptions = initiales.map((o) => ({ ...o }));
    // Une option venue d'une carte « modification » de l'Assistant (r.options_ajout) : ajoutée comme si elle avait été choisie ici.
    for (const a of Array.isArray(r.options_ajout) ? r.options_ajout : []) {
      if (!a || !a.prestation_id || etatOptions.some((x) => x.prestation_id === a.prestation_id)) continue;
      const o = prestation(a.prestation_id);
      if (!o) continue;
      const avant = somme(etatOptions);
      const qte = Math.max(1, Number(a.qte) || qtePour(o));
      etatOptions.push({ ligne_id: uid(), prestation_id: o.id, nom: o.libelle, unite: o.unite || "", qte, unitaire: vide(a.prix) ? (vide(o.prix_vente) ? "" : String(o.prix_vente)) : String(arr(Number(a.prix) / qte)), nouvelle: true });
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
    // Le total des options en cours (prix unitaire × quantité), pour « Vendu au client » quand le tarif change.
    somme: () => somme(etatOptions),
    // Un autre tarif choisi : les options proposées sont les siennes.
    tarif(id) {
      prestationId = id || null;
      if (pret) dessiner();
    },
    // Un autre partenaire : les options d'un autre partenaire quittent le service, et on le dit.
    partenaire(pid) {
      const parties = etatOptions.filter((o) => ((prestation(o.prestation_id) || {}).partenaire_id || null) !== (pid || null));
      if (!parties.length) return;
      const avant = somme(etatOptions);
      etatOptions = etatOptions.filter((o) => !parties.includes(o));
      majVente(avant);
      dessiner();
      toast(tr("Autre partenaire : {liste} retirée du service (une option est toujours du partenaire de son service).", { liste: parties.map((o) => o.nom).join(", ") }));
    },
    // null : rien n'a changé (ou les lignes n'étaient pas encore lues). Sinon la liste voulue pour contenuAvecService (prix total de chaque option).
    voulues() {
      if (!pret) return null;
      const meme = etatOptions.length === initiales.length && etatOptions.every((o) => { const i = initiales.find((x) => x.ligne_id === o.ligne_id); return i && nb(i.unitaire) === nb(o.unitaire); });
      return meme ? null : etatOptions.map((o) => ({ ligne_id: o.ligne_id, prestation_id: o.prestation_id, prix: arr(totalDe(o)), ...(o.nouvelle ? { nouvelle: true } : {}) }));
    },
    // Un prix d'option illisible : le message, ou "".
    erreur() {
      const mauvaise = etatOptions.find((o) => nb(o.unitaire) === null || nb(o.unitaire) < 0);
      return mauvaise ? tr("Indiquez le prix de l'option « {nom} », 0 si elle est offerte.", { nom: mauvaise.nom }) : "";
    },
  };
}
