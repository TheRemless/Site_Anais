import { etat, modifier, nomClient, reglages } from "../etat.mjs";
import { h, champ, toast, num, vider } from "../ui.mjs";
import { totaux, formatChf, formatDate, aujourdhui, remiseJours, sommePaiements } from "../calc.mjs";
import { nouvelleLigne } from "../defauts.mjs";
import { vide, feuille, pdf, montantRecu } from "./commun.mjs";

const LARGEUR_FEUILLE = 794; // 210 mm à 96 dpi

export function editeur(id) {
  const source = etat.db.documents.find((d) => d.id === id);
  if (!source) return vide("Document introuvable", "Il a peut-être été supprimé.", h("a", { class: "bouton secondaire", href: "#/dossiers" }, "Retour aux dossiers"));
  const doc = structuredClone(source);
  const dossier = etat.db.dossiers.find((d) => d.id === doc.dossier_id);
  const client = etat.db.clients.find((c) => c.id === dossier.client_id);
  const paiements = etat.db.paiements.filter((p) => p.dossier_id === dossier.id);
  const c = doc.contenu;
  const estFacture = doc.type === "facture";
  const regl = reglages();
  const libelleType = estFacture ? "facture" : "devis";

  const statut = h("span", { class: "etat-enregistrement", role: "status" }, "Enregistré");
  const cadre = h("div", { class: "apercu-cadre" });
  const echelle = h("div", { class: "apercu-echelle" });
  cadre.append(echelle);
  const zoneApercu = h("div", { class: "apercu" }, cadre);

  let minuteur = null;
  const ecrire = async () => {
    minuteur = null;
    try {
      await modifier("documents", id, { contenu: doc.contenu, date_emission: doc.date_emission, envoye_le: doc.envoye_le, updated_at: new Date().toISOString() });
      statut.textContent = `Enregistré à ${new Date().toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" })}`;
    } catch (err) {
      statut.textContent = "Échec de l'enregistrement";
      toast(`Enregistrement impossible : ${err.message}`, true);
    }
  };
  const sauver = () => {
    // Les autres écrans lisent la copie en mémoire : on la met à jour tout de suite.
    const courant = etat.db.documents.find((d) => d.id === id);
    Object.assign(courant, { contenu: structuredClone(doc.contenu), date_emission: doc.date_emission, envoye_le: doc.envoye_le });
    clearTimeout(minuteur);
    minuteur = setTimeout(ecrire, 600);
  };
  window.addEventListener("hashchange", () => minuteur && (clearTimeout(minuteur), ecrire()), { once: true });
  window.addEventListener("beforeunload", (e) => {
    if (minuteur) e.preventDefault();
  });

  const recuActuel = () => montantRecu(doc, paiements);

  function ajusterEchelle() {
    const largeur = zoneApercu.clientWidth;
    if (!largeur) return;
    const s = Math.min(1, (largeur - 2) / LARGEUR_FEUILLE);
    echelle.style.transform = `scale(${s})`;
    cadre.style.height = `${echelle.firstChild ? echelle.firstChild.offsetHeight * s : 0}px`;
    cadre.style.width = `${LARGEUR_FEUILLE * s}px`;
  }

  function dessinerApercu() {
    vider(echelle).append(feuille(doc).noeud);
    ajusterEchelle();
  }

  const change = () => {
    statut.textContent = "Enregistrement…";
    sauver();
    dessinerApercu();
    majMontants();
  };

  // Champs généraux
  const date = h("input", { id: "d-date", type: "date", value: doc.date_emission, oninput: (e) => ((doc.date_emission = e.target.value), change()) });
  const bandeau = h("input", { id: "d-bandeau", value: c.bandeau, oninput: (e) => ((c.bandeau = e.target.value), change()) });
  const colonnes = h(
    "select",
    {
      id: "d-col",
      value: c.colonnes,
      onchange: (e) => {
        c.colonnes = e.target.value;
        dessinerLignes();
        change();
      },
    },
    h("option", { value: "total" }, "Montant seulement"),
    h("option", { value: "detail" }, "Unité, quantité et total")
  );
  const pied = h("select", { id: "d-pied", value: c.pied, onchange: (e) => ((c.pied = e.target.value), change()) }, h("option", { value: "qr" }, "Coordonnées bancaires et QR Wise"), h("option", { value: "email" }, "Renvoi vers l'e-mail de paiement"));
  const textePerso = h("div");
  const corpsPerso = h("textarea", { id: "d-perso-corps", rows: 9, oninput: (e) => ((c.conditions_corps = e.target.value), change()) });
  const cloturePerso = h("textarea", { id: "d-perso-cloture", rows: 3, oninput: (e) => ((c.conditions_cloture = e.target.value), change()) });
  corpsPerso.value = c.conditions_corps || "";
  cloturePerso.value = c.conditions_cloture || "";
  textePerso.append(champ("Conditions de paiement de ce document", corpsPerso, "Une ligne commençant par « - » devient une puce. **gras**, _italique_."), champ("Fin de texte", cloturePerso));
  textePerso.hidden = c.variante !== "perso";
  const variante = h(
    "select",
    {
      id: "d-var",
      value: c.variante,
      onchange: (e) => {
        if (e.target.value === "perso" && !c.conditions_corps) {
          const base = regl.textes.variantes.find((v) => v.id === c.variante) || regl.textes.variantes[0];
          c.conditions_corps = base.corps;
          c.conditions_cloture = base.cloture;
          corpsPerso.value = c.conditions_corps;
          cloturePerso.value = c.conditions_cloture;
        }
        c.variante = e.target.value;
        textePerso.hidden = c.variante !== "perso";
        change();
      },
    },
    regl.textes.variantes.map((v) => h("option", { value: v.id }, v.nom)),
    h("option", { value: "perso" }, "Texte propre à ce document")
  );
  const cgv = h("input", { id: "d-cgv", type: "checkbox", checked: c.cgv !== false, onchange: (e) => ((c.cgv = e.target.checked), change()) });
  const tva = h("input", { id: "d-tva", type: "checkbox", checked: c.tva, onchange: (e) => ((c.tva = e.target.checked), change()) });
  if (!c.tva) tva.checked = false;
  const eq = c.equivalents || (c.equivalents = { actif: false });
  const eqActif = h("input", { id: "d-eq", type: "checkbox", checked: !!eq.actif, onchange: (e) => ((eq.actif = e.target.checked), (eqTaux.hidden = !eq.actif), change()) });
  if (!eq.actif) eqActif.checked = false;
  const eqEur = h("input", { id: "d-eur", type: "number", step: "0.001", value: eq.eur ?? regl.taux.eur, oninput: (e) => ((eq.eur = num(e.target.value)), change()) });
  const eqThb = h("input", { id: "d-thb", type: "number", step: "0.01", value: eq.thb ?? regl.taux.thb, oninput: (e) => ((eq.thb = num(e.target.value)), change()) });
  const eqTaux = h("div", { class: "grille-form" }, champ("1 CHF en euros", eqEur), champ("1 CHF en bahts", eqThb));
  eqTaux.hidden = !eq.actif;

  // Montant reçu (facture)
  let blocRecu = null;
  if (estFacture) {
    const manuel = h("input", { id: "d-recu-manuel", type: "checkbox", checked: c.montant_recu != null });
    if (c.montant_recu == null) manuel.checked = false;
    const valeur = h("input", { id: "d-recu", type: "number", step: "0.01", min: "0", value: c.montant_recu ?? "", disabled: c.montant_recu == null });
    if (c.montant_recu != null) valeur.disabled = false;
    else valeur.disabled = true;
    const info = h("p", { class: "aide" });
    const majInfo = () => (info.textContent = c.montant_recu == null ? `Calculé d'après les paiements enregistrés : ${formatChf(sommePaiements(paiements))}.` : "Valeur saisie à la main.");
    manuel.addEventListener("change", () => {
      if (manuel.checked) {
        c.montant_recu = sommePaiements(paiements);
        valeur.value = c.montant_recu;
        valeur.disabled = false;
      } else {
        c.montant_recu = null;
        valeur.value = "";
        valeur.disabled = true;
      }
      majInfo();
      change();
    });
    valeur.addEventListener("input", () => {
      c.montant_recu = num(valeur.value) ?? 0;
      change();
    });
    majInfo();
    const libelleRecu = h("input", { id: "d-recu-lib", value: c.libelle_recu || "", placeholder: "Montant reçu", oninput: (e) => ((c.libelle_recu = e.target.value.trim() || null), change()) });
    blocRecu = h("fieldset", null, h("legend", null, "Montant reçu"), info, h("label", { class: "case", for: "d-recu-manuel" }, manuel, "Saisir le montant à la main"), champ("Montant reçu (CHF)", valeur), champ("Intitulé affiché sur la facture", libelleRecu, "Par exemple « Acompte reçu »."));
  }

  // Lignes
  const listeLignes = h("div", { class: "lignes-edition" });
  const totalTexte = h("p", { class: "total-edition", "aria-live": "polite" });

  function majMontants() {
    const t = totaux(c, recuActuel());
    totalTexte.textContent = estFacture ? `Total de la facture : ${formatChf(t.net)}, reste à payer ${formatChf(t.reste)}` : `Total du devis : ${formatChf(t.net)}`;
    c.lignes.forEach((l, i) => {
      const el = listeLignes.querySelector(`[data-calc="${l.id}"]`);
      if (el) el.textContent = formatChf(t.montants[i]);
    });
  }

  function deplacer(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= c.lignes.length) return;
    [c.lignes[i], c.lignes[j]] = [c.lignes[j], c.lignes[i]];
    dessinerLignes();
    change();
  }

  function editeurLigne(l, i) {
    const detail = c.colonnes === "detail";
    const maj = (champNom, conv = (v) => v) => (e) => ((l[champNom] = conv(e.target.value)), change());
    const libelle = h("input", { id: `l${l.id}-lib`, value: l.libelle, oninput: maj("libelle") });
    const kindTexte = { bloc: "Bloc de formule", ligne: "Ligne", remise: "Remise", texte: "Note sous le tableau" }[l.kind];
    const champs = [champ(l.kind === "remise" ? "Intitulé de la remise" : l.kind === "texte" ? "Texte de la note" : "Libellé", libelle)];
    if (l.kind === "bloc") {
      champs.push(champ("Complément après le libellé", h("input", { id: `l${l.id}-intro`, value: l.intro, placeholder: "comprenant:", oninput: maj("intro") })));
      const puces = h("textarea", { id: `l${l.id}-puces`, rows: 4, oninput: (e) => ((l.puces = e.target.value.split("\n").map((x) => x.trim()).filter(Boolean)), change()) });
      puces.value = (l.puces || []).join("\n");
      champs.push(champ("Détail, une ligne par puce", puces));
    }
    const montants = [];
    if (l.kind === "remise") {
      const mode = h("select", { id: `l${l.id}-mode`, onchange: (e) => {
        if (e.target.value === "pct") {
          l.pct = l.pct ?? 10;
          l.unite = null;
          l.qte = null;
          l.montant = null;
        } else {
          l.pct = null;
        }
        dessinerLignes();
        change();
      } }, h("option", { value: "montant" }, "En francs"), h("option", { value: "pct" }, "En pourcentage"));
      mode.value = l.pct != null ? "pct" : "montant";
      montants.push(champ("Type de remise", mode));
      if (l.pct != null) montants.push(champ("Pourcentage", h("input", { id: `l${l.id}-pct`, type: "number", step: "0.1", min: "0", value: l.pct, oninput: maj("pct", num) })));
    }
    if (l.kind !== "texte" && l.pct == null) {
      if (detail) {
        montants.push(champ("Prix unitaire (CHF)", h("input", { id: `l${l.id}-u`, type: "number", step: "0.01", value: l.unite ?? "", oninput: maj("unite", num) })));
        montants.push(champ("Quantité", h("input", { id: `l${l.id}-q`, type: "number", step: "1", value: l.qte ?? "", oninput: maj("qte", num) })));
      }
      montants.push(champ(detail ? "Total fixe (si pas de quantité)" : l.kind === "bloc" ? "Montant (vide si le prix est sur les lignes suivantes)" : "Montant (CHF)", h("input", { id: `l${l.id}-m`, type: "number", step: "0.01", value: l.montant ?? "", oninput: maj("montant", num) })));
      montants.push(champ("Texte à la place du montant", h("input", { id: `l${l.id}-t`, value: l.texte_montant ?? "", placeholder: "inclus, offert", oninput: (e) => ((l.texte_montant = e.target.value.trim() || null), change()) })));
    }
    const presetRemise =
      l.kind === "remise" && detail
        ? h(
            "button",
            {
              class: "secondaire petit",
              type: "button",
              onclick: () => {
                const ref = c.lignes.find((x) => x.kind !== "remise" && x.unite != null && x.qte != null);
                if (!ref) {
                  toast("Ajoutez d'abord une ligne avec prix unitaire et quantité.", true);
                  return;
                }
                l.libelle = "1 jour tous les 14 jours de voyage";
                l.pct = null;
                l.unite = ref.unite;
                l.qte = remiseJours(ref.qte);
                dessinerLignes();
                change();
              },
            },
            "Remplir : 1 jour tous les 14 jours"
          )
        : null;
    return h(
      "div",
      { class: "carte-ligne", "data-id": l.id },
      h(
        "div",
        { class: "carte-ligne-tete" },
        h("strong", null, kindTexte),
        h("span", { class: "calc", "data-calc": l.id }),
        h(
          "span",
          { class: "outils" },
          h("button", { class: "lien", type: "button", "aria-label": `Monter la ligne ${i + 1}`, onclick: () => deplacer(i, -1) }, "Monter"),
          h("button", { class: "lien", type: "button", "aria-label": `Descendre la ligne ${i + 1}`, onclick: () => deplacer(i, 1) }, "Descendre"),
          h(
            "button",
            {
              class: "lien danger-texte",
              type: "button",
              "aria-label": `Supprimer la ligne ${i + 1}`,
              onclick: () => {
                c.lignes.splice(i, 1);
                dessinerLignes();
                change();
              },
            },
            "Supprimer"
          )
        )
      ),
      ...champs,
      h("div", { class: "grille-form compacte" }, montants),
      presetRemise
    );
  }

  function dessinerLignes() {
    vider(listeLignes);
    if (!c.lignes.length) listeLignes.append(h("p", { class: "vide-court" }, "Aucune ligne. Ajoutez un bloc de formule ou une ligne depuis le catalogue ci-dessous."));
    c.lignes.forEach((l, i) => listeLignes.append(editeurLigne(l, i)));
    majMontants();
  }

  const ajoute = (l) => {
    c.lignes.push(l);
    dessinerLignes();
    change();
    const carte = listeLignes.querySelector(`[data-id="${l.id}"] input`);
    if (carte) carte.focus();
  };
  const catalogueActif = [...etat.db.catalogue].filter((x) => x.actif).sort((a, b) => a.ordre - b.ordre);
  const depuisCatalogue = h(
    "select",
    {
      id: "d-cat",
      onchange: (e) => {
        const entree = etat.db.catalogue.find((x) => x.id === e.target.value);
        e.target.value = "";
        if (!entree) return;
        const detail = c.colonnes === "detail";
        if (entree.kind === "formule") {
          const prix = entree.prix != null && detail;
          ajoute(nouvelleLigne("bloc", { libelle: entree.libelle, intro: entree.intro, puces: [...entree.puces], unite: prix ? entree.prix : null, qte: prix ? 1 : null, montant: entree.prix != null && !detail ? entree.prix : null }));
        } else {
          ajoute(nouvelleLigne("ligne", { libelle: entree.libelle, montant: entree.prix }));
        }
      },
    },
    h("option", { value: "" }, "Ajouter depuis le catalogue…"),
    ["formule", "region", "supplement"].map((k) =>
      h("optgroup", { label: { formule: "Formules", region: "Régions et villes", supplement: "Suppléments" }[k] }, catalogueActif.filter((x) => x.kind === k).map((x) => h("option", { value: x.id }, x.prix != null ? `${x.libelle} (CHF ${x.prix})` : x.libelle)))
    )
  );

  // Actions
  const boutonEnvoi = h("button", { class: "secondaire", type: "button" });
  function majBoutonEnvoi() {
    boutonEnvoi.textContent = doc.envoye_le ? `${estFacture ? "Envoyée" : "Envoyé"} le ${formatDate(doc.envoye_le)}` : `Marquer comme ${estFacture ? "envoyée" : "envoyé"}`;
    boutonEnvoi.title = doc.envoye_le ? "Cliquer pour retirer la date d'envoi" : "";
  }
  boutonEnvoi.addEventListener("click", () => {
    if (doc.envoye_le) {
      doc.envoye_le = null;
      if (estFacture) c.montant_recu = null;
    } else {
      doc.envoye_le = aujourdhui();
      if (estFacture && c.montant_recu == null) c.montant_recu = sommePaiements(paiements);
    }
    majBoutonEnvoi();
    change();
    if (blocRecu) toast(doc.envoye_le ? "Facture envoyée : le montant reçu est figé." : "Date d'envoi retirée.");
  });
  majBoutonEnvoi();

  dessinerLignes();
  dessinerApercu();
  window.addEventListener("resize", ajusterEchelle);
  window.addEventListener("hashchange", () => window.removeEventListener("resize", ajusterEchelle), { once: true });
  new ResizeObserver(() => requestAnimationFrame(ajusterEchelle)).observe(zoneApercu);

  const formulaire = h(
    "div",
    { class: "editeur-form" },
    h("fieldset", null, h("legend", null, "En-tête"), h("div", { class: "grille-form" }, champ("Date d'émission", date), champ("Colonnes", colonnes)), champ("Titre dans la bande de couleur", bandeau)),
    h("fieldset", null, h("legend", null, "Contenu"), listeLignes, h("div", { class: "ajouts" }, h("button", { class: "secondaire petit", type: "button", onclick: () => ajoute(nouvelleLigne("bloc", { intro: "comprenant:" })) }, "Ajouter un bloc de formule"), h("button", { class: "secondaire petit", type: "button", onclick: () => ajoute(nouvelleLigne("ligne")) }, "Ajouter une ligne"), h("button", { class: "secondaire petit", type: "button", onclick: () => ajoute(nouvelleLigne("remise")) }, "Ajouter une remise"), h("button", { class: "secondaire petit", type: "button", onclick: () => ajoute(nouvelleLigne("texte")) }, "Ajouter une note")), champ("Catalogue", depuisCatalogue), totalTexte),
    blocRecu,
    h(
      "fieldset",
      null,
      h("legend", null, "Bas de page et mentions"),
      champ("Conditions de paiement", variante),
      textePerso,
      champ("Pied de page", pied),
      h("label", { class: "case", for: "d-cgv" }, cgv, "Afficher la phrase sur les Conditions Générales de Vente"),
      h("label", { class: "case", for: "d-tva" }, tva, `Afficher « ${regl.conditions.tva_mention} »`),
      h("label", { class: "case", for: "d-eq" }, eqActif, "Afficher l'équivalent en euros et en bahts, à titre indicatif"),
      eqTaux
    )
  );

  return h(
    "div",
    { "data-titre": `${estFacture ? "Facture" : "Devis"} ${dossier.ref}`, "data-large": "1" },
    h("a", { class: "retour", href: `#/dossier/${dossier.id}` }, nomClient(client)),
    h(
      "div",
      { class: "entete editeur-entete" },
      h("div", null, h("h1", null, estFacture ? "Facture" : "Devis"), h("p", { class: "sous" }, h("span", { class: "ref" }, dossier.ref), " · ", nomClient(client))),
      h("div", { class: "entete-actions" }, statut, boutonEnvoi, h("button", { class: "principal", type: "button", onclick: () => pdf({ ...doc, type: doc.type }) }, "Télécharger le PDF"))
    ),
    h("p", { class: "aide-pdf" }, `Dans la fenêtre d'impression, choisissez « Enregistrer au format PDF ». Le fichier portera déjà le nom « ${estFacture ? "Facture" : "Devis"} ${dossier.ref} ».`),
    h("div", { class: "editeur" }, formulaire, zoneApercu)
  );
}
