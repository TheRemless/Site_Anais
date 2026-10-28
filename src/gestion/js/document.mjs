// Rendu du devis ou de la facture au format A4. Le même rendu sert à l'aperçu et au PDF.
// Tout ce qui est propre à une entreprise (textes, logo, couleurs, coordonnées) vient de ses réglages.
import { totaux, afficherSousTotal, formatMontant, formatDate, equivalents, formatNombre, acompteDu } from "./calc.mjs";
import { h, markup } from "./ui.mjs";

const lignes = (texte) => (texte || "").split("\n").filter((l) => l.trim() !== "");

export function renderDocument({ type, doc, dossier, client, reglages, recu }) {
  const c = doc.contenu;
  const t = totaux(c, recu);
  const e = reglages.emetteur;
  const lb = reglages.libelles;
  const ap = reglages.apparence;
  const detail = c.colonnes === "detail";
  const estFacture = type === "facture";
  const variantes = reglages.textes.variantes;
  const variante = c.variante === "perso" ? { corps: c.conditions_corps || "", cloture: c.conditions_cloture || "" } : variantes.find((v) => v.id === c.variante) || variantes[0] || { corps: "", cloture: "" };

  const pct = Number(reglages.conditions.acompte_pct) || 0;
  const eq = c.equivalents && c.equivalents.actif ? equivalents(t.net, { eur: c.equivalents.eur ?? reglages.taux.eur, thb: c.equivalents.thb ?? reglages.taux.thb }) : null;
  const vars = {
    acompte: pct,
    solde: 100 - pct,
    delai: reglages.conditions.delai_jours,
    total: `${formatNombre(t.net)} ${reglages.devise}`.trim(),
    indicatif: eq ? ` (soit ${formatNombre(eq.eur)} €, soit ${formatNombre(eq.thb)} THB, à titre indicatif)` : "",
    acompte_chf: formatMontant(acompteDu(t.net, pct)),
    entreprise: e.nom,
    cgv_url: reglages.conditions.cgv_url || "",
  };

  const ligneDoc = (l, i) => {
    const montant = t.montants[i];
    const aMontant = l.kind === "remise" || montant !== 0 || l.unite != null || l.montant != null || !!l.texte_montant;
    const aDetail = detail && l.unite != null && l.qte != null;
    const description =
      l.kind === "remise"
        ? h("div", { class: "desc remise" }, h("strong", null, lb.remise), l.libelle ? ": " : "", l.libelle ? h("em", null, l.libelle) : null)
        : h(
            "div",
            { class: l.kind === "bloc" ? "desc bloc" : "desc" },
            h("strong", null, l.libelle),
            l.intro ? ` ${l.intro}` : null,
            l.puces && l.puces.length ? h("ul", null, l.puces.map((x) => h("li", null, x))) : null
          );
    const unite = aDetail ? (l.kind === "remise" && l.pct != null ? `-${l.pct}%` : formatMontant(l.unite)) : l.kind === "remise" && l.pct != null ? `-${l.pct}%` : "";
    const qte = aDetail ? String(l.qte) : l.kind === "remise" && l.pct != null && detail ? "1" : "";
    return h(
      "div",
      { class: `ligne ${l.kind}` },
      description,
      detail ? h("div", { class: "unite" }, unite) : null,
      detail ? h("div", { class: "qte" }, qte) : null,
      h("div", { class: l.texte_montant ? "montant txt" : "montant" }, l.texte_montant || (aMontant ? formatMontant(montant) : ""))
    );
  };

  // Les remises passent après le sous-total, les notes à la fin.
  const normales = [];
  const remises = [];
  const notes = [];
  c.lignes.forEach((l, i) => {
    if (l.kind === "texte") notes.push(h("p", { class: "note" }, l.libelle));
    else (l.kind === "remise" ? remises : normales).push(ligneDoc(l, i));
  });
  const sousTotal = afficherSousTotal(c, recu);

  const barre = (libelle, valeur, classe) => h("div", { class: `barre ${classe}` }, h("span", { class: "barre-libelle" }, libelle), h("span", { class: "barre-valeur" }, valeur));
  const tvaTexte = c.tva ? reglages.conditions.tva_mention : "";

  // Pied de page : coordonnées, informations de paiement et QR code, selon ce qui est renseigné.
  const paiementLignes = lignes(reglages.paiement.texte);
  const complet = c.pied === "qr";
  const avecQr = complet && !!ap.qr_image;
  const colonnes = [];
  if (lignes(e.contact).length) colonnes.push(h("div", { class: "pied-col" }, h("h4", null, lb.coordonnees), lignes(e.contact).map((l) => h("p", null, l))));
  if (complet ? paiementLignes.length : lb.pied_court) colonnes.push(h("div", { class: "pied-col" }, h("h4", null, lb.infos_paiement), complet ? paiementLignes.map((l) => h("p", null, l)) : h("p", { class: "italique" }, lb.pied_court)));
  if (avecQr) colonnes.push(h("div", { class: "pied-col wise" }, lb.qr_titre ? h("h4", null, lb.qr_titre) : null, h("div", { class: "qr-ligne" }, h("img", { src: ap.qr_image, alt: "QR code" }), ap.qr_pseudo ? h("span", { class: "pseudo" }, ap.qr_pseudo) : null)));

  const cgvTexte = c.cgv === false || !lb.cgv ? null : h("div", { class: "cgv" }, markup(lb.cgv, vars));

  return h(
    "div",
    { class: `sheet ${detail ? "detail" : "total"}`, style: `--teal: ${ap.couleur}; --teal-clair: ${ap.couleur_clair}` },
    h(
      "header",
      { class: "sheet-tete" },
      h("p", { class: "sheet-ref" }, `${estFacture ? lb.ref_facture : lb.ref_devis} ${dossier.ref}`),
      ap.logo ? h("img", { class: "sheet-logo", src: ap.logo, alt: e.nom }) : null,
      ap.titre_image ? h("img", { class: "sheet-titre", src: ap.titre_image, alt: e.nom }) : h("p", { class: "sheet-titre-texte" }, ap.titre_texte || e.nom),
      ap.type_images && ap.type_images[type] ? h("img", { class: "sheet-type", src: ap.type_images[type], alt: estFacture ? lb.facture : lb.devis }) : h("p", { class: "sheet-type-texte" }, estFacture ? lb.facture : lb.devis),
      h("div", { class: "sheet-emetteur" }, h("strong", null, e.nom.toUpperCase()), lignes(e.adresse).map((l) => h("p", null, l)), e.telephone ? h("p", null, e.telephone) : null),
      h(
        "div",
        { class: "sheet-client" },
        client ? [client.civilite, [client.prenom, client.nom].filter(Boolean).join(" "), ...lignes(client.adresse)].filter(Boolean).map((l) => h("p", { class: "gras" }, l)) : null,
        client && client.telephone ? h("p", null, client.telephone) : null
      ),
      h("p", { class: "sheet-date" }, `${lb.date_emission} ${formatDate(doc.date_emission)}`)
    ),
    h(
      "main",
      { class: "sheet-corps" },
      h("div", { class: "bandeau" }, h("div", { class: "bandeau-titre" }, c.bandeau), detail ? h("div", { class: "unite" }, lb.unite) : null, detail ? h("div", { class: "qte" }, lb.qte) : null, h("div", { class: "montant" }, lb.total)),
      h("div", { class: "lignes" }, normales),
      sousTotal ? barre(lb.sous_total, formatMontant(t.sousTotal), "clair") : null,
      sousTotal && (remises.length || t.recu > 0)
        ? h(
            "div",
            { class: "lignes sous" },
            remises,
            t.recu > 0
              ? h("div", { class: "ligne recu" }, h("div", { class: "desc" }, h("strong", null, c.libelle_recu || lb.montant_recu)), detail ? h("div", { class: "unite" }) : null, detail ? h("div", { class: "qte" }) : null, h("div", { class: "montant" }, formatMontant(-t.recu)))
              : null
          )
        : null,
      barre(lb.total, formatMontant(t.reste), "fonce"),
      tvaTexte ? h("p", { class: "tva" }, tvaTexte) : null,
      notes,
      h(
        "section",
        { class: "conditions" },
        variante.corps || variante.cloture ? h("h3", null, lb.conditions) : null,
        variante.corps ? h("div", { class: "texte" }, markup(variante.corps, vars)) : null,
        variante.cloture ? h("div", { class: "texte cloture" }, markup(variante.cloture, vars)) : null,
        cgvTexte,
        estFacture || !lb.signature_1 ? null : h("p", { class: "signature" }, h("strong", null, lb.signature_1), h("br"), h("strong", null, h("em", null, lb.signature_2)))
      )
    ),
    h("footer", { class: `sheet-pied ${avecQr ? "qr" : "email"}` }, colonnes)
  );
}
