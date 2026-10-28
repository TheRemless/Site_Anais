// Rendu du devis ou de la facture au format A4. Le même rendu sert à l'aperçu et au PDF.
import { totaux, afficherSousTotal, formatChf, formatDate, equivalents, formatNombre, acompteDu } from "./calc.mjs";
import { h, markup } from "./ui.mjs";

const lignes = (texte) => (texte || "").split("\n").filter((l) => l.trim() !== "");

export function renderDocument({ type, doc, dossier, client, reglages, recu }) {
  const c = doc.contenu;
  const t = totaux(c, recu);
  const e = reglages.emetteur;
  const p = reglages.paiement;
  const detail = c.colonnes === "detail";
  const estFacture = type === "facture";
  const variante = c.variante === "perso" ? { corps: c.conditions_corps || "", cloture: c.conditions_cloture || "" } : reglages.textes.variantes.find((v) => v.id === c.variante) || reglages.textes.variantes[0];

  const pct = Number(reglages.conditions.acompte_pct) || 0;
  const eq = c.equivalents && c.equivalents.actif ? equivalents(t.net, { eur: c.equivalents.eur ?? reglages.taux.eur, thb: c.equivalents.thb ?? reglages.taux.thb }) : null;
  const vars = {
    acompte: pct,
    solde: 100 - pct,
    delai: reglages.conditions.delai_jours,
    total: `${formatNombre(t.net)} CHF`,
    indicatif: eq ? ` (soit ${formatNombre(eq.eur)} €, soit ${formatNombre(eq.thb)} THB, à titre indicatif)` : "",
    acompte_chf: formatChf(acompteDu(t.net, pct)),
  };

  const ligneDoc = (l, i) => {
    const montant = t.montants[i];
    const aMontant = l.kind === "remise" || montant !== 0 || l.unite != null || l.montant != null || !!l.texte_montant;
    const aDetail = detail && l.unite != null && l.qte != null;
    const description =
      l.kind === "remise"
        ? h("div", { class: "desc remise" }, h("strong", null, "Remise"), l.libelle ? ": " : "", l.libelle ? h("em", null, l.libelle) : null)
        : h(
            "div",
            { class: l.kind === "bloc" ? "desc bloc" : "desc" },
            h("strong", null, l.libelle),
            l.intro ? ` ${l.intro}` : null,
            l.puces && l.puces.length ? h("ul", null, l.puces.map((x) => h("li", null, x))) : null
          );
    const unite = aDetail ? (l.kind === "remise" && l.pct != null ? `-${l.pct}%` : formatChf(l.unite)) : l.kind === "remise" && l.pct != null ? `-${l.pct}%` : "";
    const qte = aDetail ? String(l.qte) : l.kind === "remise" && l.pct != null && detail ? "1" : "";
    return h(
      "div",
      { class: `ligne ${l.kind}` },
      description,
      detail ? h("div", { class: "unite" }, unite) : null,
      detail ? h("div", { class: "qte" }, qte) : null,
      h("div", { class: l.texte_montant ? "montant txt" : "montant" }, l.texte_montant || (aMontant ? formatChf(montant) : ""))
    );
  };

  // Les remises passent après le sous-total.
  const normales = [];
  const remises = [];
  const notes = [];
  c.lignes.forEach((l, i) => {
    if (l.kind === "texte") notes.push(h("p", { class: "note" }, l.libelle));
    else (l.kind === "remise" ? remises : normales).push(ligneDoc(l, i));
  });
  const sousTotal = afficherSousTotal(c, recu);

  const barre = (libelle, valeur, classe) =>
    h("div", { class: `barre ${classe}` }, h("span", { class: "barre-libelle" }, libelle), h("span", { class: "barre-valeur" }, valeur));

  const tvaTexte = c.tva ? reglages.conditions.tva_mention : "";
  const colonnesPied = c.pied === "qr";

  return h(
    "div",
    { class: `sheet ${detail ? "detail" : "total"}` },
    h(
      "header",
      { class: "sheet-tete" },
      h("p", { class: "sheet-ref" }, `${estFacture ? "Facture" : "Devis"}: réf. ${dossier.ref}`),
      h("img", { class: "sheet-logo", src: "assets/logo.png", alt: "Zwald Travel Planner" }),
      h("img", { class: "sheet-titre", src: "assets/title.png", alt: "Zwald Travel Planner" }),
      h("img", { class: "sheet-type", src: estFacture ? "assets/facture.png" : "assets/devis.png", alt: estFacture ? "Facture" : "Devis" }),
      h(
        "div",
        { class: "sheet-emetteur" },
        h("strong", null, e.nom.toUpperCase()),
        lignes(e.adresse).map((l) => h("p", null, l)),
        h("p", null, e.telephone)
      ),
      h(
        "div",
        { class: "sheet-client" },
        client ? [client.civilite, [client.prenom, client.nom].filter(Boolean).join(" "), ...lignes(client.adresse)].filter(Boolean).map((l) => h("p", { class: "gras" }, l)) : null,
        client && client.telephone ? h("p", null, client.telephone) : null
      ),
      h("p", { class: "sheet-date" }, `Date d'émission: ${formatDate(doc.date_emission)}`)
    ),
    h(
      "main",
      { class: "sheet-corps" },
      h(
        "div",
        { class: "bandeau" },
        h("div", { class: "bandeau-titre" }, c.bandeau),
        detail ? h("div", { class: "unite" }, "UNITÉ") : null,
        detail ? h("div", { class: "qte" }, "QTÉ") : null,
        h("div", { class: "montant" }, "TOTAL")
      ),
      h("div", { class: "lignes" }, normales),
      sousTotal ? barre("SOUS-TOTAL", formatChf(t.sousTotal), "clair") : null,
      sousTotal && (remises.length || t.recu > 0)
        ? h(
            "div",
            { class: "lignes sous" },
            remises,
            t.recu > 0
              ? h("div", { class: "ligne recu" }, h("div", { class: "desc" }, h("strong", null, c.libelle_recu || "Montant reçu")), detail ? h("div", { class: "unite" }) : null, detail ? h("div", { class: "qte" }) : null, h("div", { class: "montant" }, formatChf(-t.recu)))
              : null
          )
        : null,
      barre("TOTAL", formatChf(t.reste), "fonce"),
      tvaTexte ? h("p", { class: "tva" }, tvaTexte) : null,
      notes,
      h(
        "section",
        { class: "conditions" },
        h("h3", null, "CONDITIONS DE PAIEMENT"),
        h("div", { class: "texte" }, markup(variante.corps, vars)),
        h("div", { class: "texte cloture" }, markup(variante.cloture, vars)),
        c.cgv === false
          ? null
          : h(
              "p",
              { class: "cgv" },
              "Le client reconnaît avoir pris connaissance des ",
              h("a", { href: reglages.conditions.cgv_url }, "Conditions Générales de Vente"),
              " de Zwald Travel Planner CO., LTD. et les accepter sans réserve. La signature du présent devis vaut acceptation des CGV et engagement contractuel."
            ),
        estFacture ? null : h("p", { class: "signature" }, h("strong", null, "NOM, PRENOM, DATE ET SIGNATURE DU CLIENT"), h("br"), h("strong", null, h("em", null, "précédé de la mention “Bon pour accord”")))
      )
    ),
    h(
      "footer",
      { class: `sheet-pied ${colonnesPied ? "qr" : "email"}` },
      h(
        "div",
        { class: "pied-col" },
        h("h4", null, "COORDONNÉES"),
        h("p", null, e.contact_nom),
        h("p", null, e.whatsapp),
        h("p", null, e.email)
      ),
      h(
        "div",
        { class: "pied-col" },
        h("h4", null, "INFORMATIONS DE PAIEMENT"),
        colonnesPied
          ? [h("p", null, `Banque: ${p.banque}`), h("p", null, `IBAN: ${p.iban}`), h("p", null, `Swift: ${p.swift}`), h("p", null, p.titulaire), h("p", null, p.ville_titulaire)]
          : h("p", { class: "italique" }, "voir les instructions de paiement transmises par e-mail.")
      ),
      colonnesPied ? h("div", { class: "pied-col wise" }, h("h4", null, "WISE - virements internationaux"), h("div", { class: "qr-ligne" }, h("img", { src: "assets/qr-wise.png", alt: "QR code Wise" }), h("span", { class: "pseudo" }, p.wise_pseudo))) : null
    )
  );
}
