// Rendu du devis ou de la facture au format A4. Le même rendu sert à l'aperçu et au PDF.
// Tout ce qui est propre à une entreprise (textes, logo, couleurs, coordonnées) vient de ses réglages.
import { totaux, afficherSousTotal, formatMontant, formatDate, equivalents, lignesEquivalents, formatNombre, acompteDu } from "./calc.mjs";
import { h, markup, inline } from "./ui.mjs";
import { modePaiement, LIBELLES_EN, phraseCgv, conditionsDocument, mentionTva } from "./defauts.mjs";

const lignes = (texte) => (texte || "").split("\n").filter((l) => l.trim() !== "");

export function renderDocument({ type, doc, dossier, client, reglages, recu }) {
  const c = doc.contenu;
  const t = totaux(c, recu);
  const e = reglages.emetteur;
  const en = c.langue === "en";
  // Document en anglais : textes fixes anglais des réglages (ceux de la langue principale ne sont pas touchés).
  const lb = en ? { ...LIBELLES_EN, ...(reglages.libelles_en || {}) } : reglages.libelles;
  const ap = reglages.apparence;
  const detail = c.colonnes === "detail";
  const locale = type === "facture_locale";
  const estFacture = type === "facture" || locale;
  const mode = modePaiement(reglages, c.paiement);
  const numero = (c.numero || "").trim() || dossier.ref;
  const titreType = locale ? lb.facture_locale || lb.facture : estFacture ? lb.facture : lb.devis;
  const variante = conditionsDocument(reglages, c, en);

  const pct = Number(reglages.conditions.acompte_pct) || 0;
  // Devise propre au document, sinon celle de l'entreprise.
  const dev = c.devise || reglages.devise;
  // Deux équivalents : celui des conditions (« Le montant total s'élève à… ») sur le total, celui sous la barre finale sur le montant de cette barre, le reste à payer.
  const lignesEq = c.equivalents && c.equivalents.actif ? lignesEquivalents(c.equivalents, reglages.taux) : null;
  const eq = lignesEq ? equivalents(t.net, lignesEq) : [];
  const eqBarre = lignesEq ? equivalents(t.reste, lignesEq) : [];
  const SYMBOLES = { EUR: "€", USD: "$" };
  const texteEq = (x) => `${formatNombre(x.montant)} ${SYMBOLES[x.code] || x.code}`;
  const NOMS_DEVISES = { CHF: "Swiss Franc", EUR: "Euro", THB: "Thai Baht", USD: "US Dollar", GBP: "Pound Sterling" };
  const vars = {
    devise: dev,
    devise_nom: NOMS_DEVISES[dev] || dev,
    acompte: pct,
    solde: 100 - pct,
    delai: reglages.conditions.delai_jours,
    total: `${formatNombre(t.net)} ${dev}`.trim(),
    indicatif: eq.length ? (en ? ` (approx. ${eq.map(texteEq).join(", approx. ")}, for reference only)` : ` (soit ${eq.map(texteEq).join(", soit ")}, à titre indicatif)`) : "",
    acompte_chf: formatMontant(acompteDu(t.net, pct), dev),
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
    const unite = aDetail ? (l.kind === "remise" && l.pct != null ? `-${l.pct}%` : formatMontant(l.unite, dev)) : l.kind === "remise" && l.pct != null ? `-${l.pct}%` : "";
    const qte = aDetail ? String(l.qte) : l.kind === "remise" && l.pct != null && detail ? "1" : "";
    return h(
      "div",
      { class: `ligne ${l.kind}` },
      description,
      detail ? h("div", { class: "unite" }, unite) : null,
      detail ? h("div", { class: "qte" }, qte) : null,
      h("div", { class: l.texte_montant ? "montant txt" : "montant" }, l.texte_montant || (aMontant ? formatMontant(montant, dev) : ""))
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
  const tvaTexte = c.tva ? mentionTva(reglages.conditions, en) : "";

  // Pied de page : coordonnées, informations de paiement et QR code, selon ce qui est renseigné.
  const paiementLignes = lignes(mode.texte);
  const complet = c.pied === "qr";
  const avecQr = complet && !!mode.qr_image;
  const colonnes = [];
  if (lignes(e.contact).length) colonnes.push(h("div", { class: "pied-col" }, h("h4", null, lb.coordonnees), lignes(e.contact).map((l) => h("p", null, l))));
  if (complet ? paiementLignes.length : lb.pied_court) colonnes.push(h("div", { class: "pied-col" }, h("h4", null, lb.infos_paiement), complet ? paiementLignes.map((l) => h("p", null, inline(l))) : h("p", { class: "italique" }, lb.pied_court)));
  if (avecQr) colonnes.push(h("div", { class: "pied-col wise" }, lb.qr_titre ? h("h4", null, lb.qr_titre) : null, h("div", { class: "qr-ligne" }, h("img", { src: mode.qr_image, alt: "QR code" }), mode.qr_pseudo ? h("span", { class: "pseudo" }, mode.qr_pseudo) : null)));

  const phraseDesCgv = phraseCgv(lb, { estFacture, en, cgvUrl: reglages.conditions.cgv_url });
  const cgvTexte = c.cgv === false || !phraseDesCgv ? null : h("div", { class: "cgv" }, markup(phraseDesCgv, vars));

  const centre = ap.entete === "centre";
  const refTexte = `${estFacture ? lb.ref_facture : lb.ref_devis} ${numero}`;
  const dateTexte = `${lb.date_emission} ${formatDate(doc.date_emission)}`;
  const nomClient = client ? [client.civilite, [client.prenom, client.nom].filter(Boolean).join(" "), ...lignes(client.adresse)].filter(Boolean) : [];

  return h(
    "div",
    { class: `sheet ${detail ? "detail" : "total"}${centre ? " entete-centre" : ""}`, style: `--teal: ${ap.couleur}; --teal-clair: ${ap.couleur_clair}` },
    h(
      "header",
      { class: `sheet-tete${centre ? " centre" : ""}` },
      centre ? null : h("p", { class: "sheet-ref" }, refTexte),
      ap.logo ? h("img", { class: "sheet-logo", src: ap.logo, alt: e.nom }) : null,
      centre ? null : ap.titre_image ? h("img", { class: "sheet-titre", src: ap.titre_image, alt: e.nom }) : h("p", { class: "sheet-titre-texte" }, ap.titre_texte || e.nom),
      ap.type_images && ap.type_images[estFacture ? "facture" : "devis"] && !(locale && lb.facture_locale) ? h("img", { class: "sheet-type", src: ap.type_images[estFacture ? "facture" : "devis"], alt: titreType }) : h("p", { class: "sheet-type-texte" }, titreType),
      h(
        "div",
        { class: "sheet-emetteur" },
        h("strong", null, e.nom.toUpperCase()),
        e.sous_titre ? h("span", { class: "sous-titre" }, e.sous_titre.toUpperCase()) : null,
        lignes(e.adresse).map((l) => h("p", null, l)),
        e.telephone ? h("p", null, e.telephone) : null,
        e.licence ? h("p", { class: "sheet-licence" }, `${en ? "TAT licence" : "Licence TAT"}: ${e.licence}`) : null
      ),
      h(
        "div",
        { class: "sheet-client" },
        lb.facture_a && client ? h("p", { class: "etiquette" }, lb.facture_a) : null,
        nomClient.map((l) => h("p", { class: "gras" }, l)),
        client && client.telephone ? h("p", null, client.telephone) : null,
        c.prestataire && c.prestataire.trim() ? [lb.prestataire ? h("p", { class: "etiquette separe" }, lb.prestataire) : null, h("p", { class: lb.prestataire ? "gras" : "gras separe" }, c.prestataire.trim())] : null
      ),
      centre ? h("div", { class: "sheet-refdate" }, h("p", null, refTexte), h("p", null, dateTexte)) : h("p", { class: "sheet-date" }, dateTexte)
    ),
    h(
      "main",
      { class: "sheet-corps" },
      h("div", { class: "bandeau" }, h("div", { class: "bandeau-titre" }, c.bandeau), detail ? h("div", { class: "unite" }, lb.unite) : null, detail ? h("div", { class: "qte" }, lb.qte) : null, h("div", { class: "montant" }, lb.colonne_montant || lb.total)),
      h("div", { class: "lignes" }, normales),
      sousTotal ? barre(lb.sous_total, formatMontant(t.sousTotal, dev), "clair") : null,
      sousTotal && (remises.length || t.recu > 0)
        ? h(
            "div",
            { class: "lignes sous" },
            remises,
            t.recu > 0
              ? h("div", { class: "ligne recu" }, h("div", { class: "desc" }, h("strong", null, c.libelle_recu || lb.montant_recu)), detail ? h("div", { class: "unite" }) : null, detail ? h("div", { class: "qte" }) : null, h("div", { class: "montant" }, formatMontant(-t.recu, dev)))
              : null
          )
        : null,
      barre(lb.total_final || lb.total, formatMontant(t.reste, dev), "fonce"),
      eqBarre.length ? h("p", { class: "equivalent" }, `${lb.equivalent} ${eqBarre.map(texteEq).join(" · ")}`) : null,
      tvaTexte ? h("p", { class: "tva" }, tvaTexte) : null,
      lb.note_devise ? h("div", { class: "tva devise" }, markup(lb.note_devise, vars)) : null,
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
    h("footer", { class: `sheet-pied ${avecQr ? "qr" : "email"}${colonnes.length === 1 ? " seul" : ""}` }, colonnes, lb.pied_note ? h("div", { class: "pied-note" }, markup(lb.pied_note, vars)) : null)
  );
}
