import { etat, resumeDossier, modifier, inserer, supprimer, nomClient, naviguer, reglages, peut, equipe, chargerDossier } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, num } from "../ui.mjs";
import { formatMontant, formatDate, aujourdhui, acompteDu, echeanceAcompte, totaux, arrondi, nouvelleRef, tauxVers, convertirContenu } from "../calc.mjs";
import { uid, modesPaiement } from "../defauts.mjs";
import { selecteurClient } from "./selecteur-client.mjs";
import { sectionTachesDossier } from "./taches.mjs";
import { sectionPieces } from "./pieces.mjs";
import { pastille, vide, pdf, sousTitreDossier } from "./commun.mjs";

const rafraichir = () => naviguer(location.hash);
const dernier = (docs, type) => docs.filter((d) => d.type === type).sort((a, b) => (a.created_at > b.created_at ? 1 : -1)).pop();

// Les documents et paiements d'un dossier se chargent à son ouverture.
export async function ficheDossier(id) {
  await chargerDossier(id);
  return ficheDossierVue(id);
}

function ficheDossierVue(id) {
  const r = resumeDossier(id);
  if (!r) return vide("Dossier introuvable", "Il a peut-être été supprimé.", h("a", { class: "bouton secondaire", href: "#/dossiers" }, "Retour aux dossiers"));
  const { dossier: d, client, paiements } = r;
  const fm = (n, code) => formatMontant(n, code || r.devise);
  // Ce que le rôle de la personne permet de faire sur ce dossier.
  const droit = { dossiers: peut("dossiers.ecrire"), docs: peut("documents.ecrire"), paiements: peut("paiements.ecrire"), finances: peut("finances.voir"), supprimer: peut("dossiers.supprimer") };
  const responsable = h("span", null);
  equipe().then((gens) => {
    const p = gens.find((x) => x.user_id === d.responsable_id);
    responsable.textContent = p ? ` · Responsable : ${p.nom || p.email}` : "";
  });
  const regl = reglages();
  const MOYENS = regl.listes.moyens.map((m) => [m.id, m.label]);
  const devis = dernier(r.documents, "devis");
  const facture = dernier(r.documents, "facture");
  const locale = dernier(r.documents, "facture_locale");
  const avecDevis = !!devis || !facture;
  const acompte = acompteDu(r.total, regl.conditions.acompte_pct);
  const echeance = echeanceAcompte(d, regl);
  const ajd = aujourdhui();

  // Étapes du dossier : le statut en découle, ces boutons ne font qu'enregistrer des faits.
  const etape = (fait, titre, detail, action) => h("li", { class: fait ? "etape fait" : "etape" }, h("span", { class: "etape-etat" }, fait ? "Fait" : "À faire"), h("div", { class: "etape-texte" }, h("strong", null, titre), detail ? h("span", null, detail) : null), action || null);

  const marquerEnvoye = async () => {
    await modifier("documents", devis.id, { envoye_le: ajd });
    toast("Devis marqué comme envoyé.");
    rafraichir();
  };
  const accepter = () => {
    const date = h("input", { id: "date-accept", type: "date", value: ajd });
    const fermer = modal(
      "Le client a accepté le devis",
      h(
        "form",
        {
          class: "modal-corps",
          onsubmit: async (e) => {
            e.preventDefault();
            await modifier("dossiers", d.id, { accepte_le: date.value });
            fermer();
            toast("Acceptation enregistrée.");
            rafraichir();
          },
        },
        champ("Date d'acceptation", date, `L'acompte est attendu ${regl.conditions.delai_jours} jours plus tard.`),
        h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, "Annuler"), h("button", { type: "submit", class: "principal" }, "Enregistrer"))
      )
    );
  };
  const creerFacture = async () => {
    const base = devis ? structuredClone(devis.contenu) : { bandeau: d.bandeau, colonnes: "total", lignes: [], equivalents: { actif: false }, pied: "qr", variante: "qr", tva: true };
    base.montant_recu = null;
    const f = await inserer("documents", { dossier_id: d.id, type: "facture", date_emission: ajd, envoye_le: null, updated_at: new Date().toISOString(), contenu: base });
    naviguer(`#/doc/${f.id}`);
  };

  // Facture locale : la même facture dans la devise du pays (bahts) et avec d'autres informations de paiement, pour la comptabilité thaïlandaise.
  // Elle ne compte ni dans le total du dossier ni dans les statistiques.
  const creerLocale = () => {
    const devSource = facture.contenu.devise || regl.devise;
    const devises = [...new Set([regl.devise, ...regl.listes.devises])].filter((x) => x !== devSource);
    const modes = modesPaiement(regl);
    const cible = h("select", { id: "loc-devise", onchange: () => majTaux() }, (devises.length ? devises : [devSource]).map((x) => h("option", { value: x }, x)));
    cible.value = devises.includes("THB") ? "THB" : cible.value;
    const taux = h("input", { id: "loc-taux", type: "number", step: "0.0001", min: "0" });
    const majTaux = () => (taux.value = tauxVers(regl, devSource, cible.value) ?? "");
    majTaux();
    const mode = h("select", { id: "loc-mode" }, modes.map((m) => h("option", { value: m.id }, m.nom)));
    mode.value = modes[modes.length - 1].id;
    const langue = h("select", { id: "loc-langue" }, h("option", { value: "en" }, "English"), h("option", { value: "" }, "Langue principale"));
    const numero = h("input", { id: "loc-numero", value: `${d.ref}-L` });
    const fermer = modal(
      "Créer la facture locale",
      h(
        "form",
        {
          class: "modal-corps",
          onsubmit: async (e) => {
            e.preventDefault();
            const t = num(taux.value);
            if (!t || t <= 0) return toast("Indiquez le taux de conversion.", true);
            const contenu = convertirContenu(facture.contenu, t, cible.value);
            contenu.lignes = contenu.lignes.map((l) => ({ ...l, id: uid() }));
            contenu.paiement = mode.value;
            contenu.numero = numero.value.trim();
            contenu.langue = langue.value;
            const f = await inserer("documents", { dossier_id: d.id, type: "facture_locale", date_emission: facture.date_emission, envoye_le: null, updated_at: new Date().toISOString(), contenu });
            fermer();
            naviguer(`#/doc/${f.id}`);
          },
        },
        h("p", { class: "aide" }, `Copie de la facture avec les montants convertis. Vous pouvez ensuite tout corriger ligne par ligne. Les paiements restent sur la facture du client (${devSource}).`),
        h("div", { class: "grille-form" }, champ("Devise de la facture locale", cible), champ(`Taux (1 ${devSource} = … )`, taux, "Pré-rempli d'après les réglages, modifiable.")),
        modes.length > 1 ? champ("Informations de paiement", mode) : null,
        champ("Langue de la facture", langue, "Les titres, libellés et conditions de paiement passent en anglais. Les textes des lignes (intitulés, descriptions) sont copiés tels quels : à traduire dans l'éditeur."),
        champ("Numéro affiché", numero, "Remplace la référence du dossier sur cette facture."),
        h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, "Annuler"), h("button", { type: "submit", class: "principal" }, "Créer la facture locale"))
      )
    );
  };

  // Une copie du devis pour un nouveau dossier, comme dupliquer une page dans l'ancien fichier.
  const dupliquer = () => {
    const modele = devis || facture;
    if (!modele) return toast("Ce dossier n'a pas encore de document à copier.", true);
    const sel = selecteurClient({ id: "dup-client", libelle: "Pour quel client ?", valeur: d.client_id });
    const fermer = modal(
      "Dupliquer ce dossier",
      h(
        "form",
        {
          class: "modal-corps",
          onsubmit: async (e) => {
            e.preventDefault();
            const cl = etat.db.clients.find((x) => x.id === sel.valeur);
            try {
              const ref = nouvelleRef({ numerotation: regl.numerotation, prenom: cl.prenom, nom: cl.nom, dateIso: ajd, pays: d.pays || "", refsExistantes: etat.db.dossiers.map((x) => x.ref) });
              const nd = await inserer("dossiers", { ref, client_id: cl.id, pays: d.pays, bandeau: d.bandeau, date_depart: null, date_retour: null, accepte_le: null, annule: false, notes: "" });
              const contenu = structuredClone(modele.contenu);
              contenu.lignes = contenu.lignes.map((l) => ({ ...l, id: uid() }));
              contenu.montant_recu = null;
              delete contenu.libelle_recu;
              const nouveau = await inserer("documents", { dossier_id: nd.id, type: "devis", date_emission: ajd, envoye_le: null, updated_at: new Date().toISOString(), contenu });
              fermer();
              toast("Dossier dupliqué. Adaptez maintenant le devis.");
              naviguer(`#/doc/${nouveau.id}`);
            } catch (err) {
              toast(`Duplication impossible : ${err.message}`, true);
            }
          },
        },
        sel.noeud,
        h("p", { class: "aide" }, "Le document est copié avec toutes ses lignes, sans paiement ni date d'envoi. Créez d'abord le client s'il n'existe pas encore."),
        h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, "Annuler"), h("button", { type: "submit", class: "principal" }, "Créer la copie"))
      )
    );
  };

  const modifierDossier = () => {
    const selClient = selecteurClient({ id: "m-client", valeur: d.client_id });
    const pays = h("input", { id: "m-pays", value: d.pays || "" });
    const depart = h("input", { id: "m-depart", type: "date", value: d.date_depart || "" });
    const retour = h("input", { id: "m-retour", type: "date", value: d.date_retour || "" });
    const accepte = h("input", { id: "m-accepte", type: "date", value: d.accepte_le || "" });
    const respSel = h("select", { id: "m-resp" }, h("option", { value: d.responsable_id || "" }, "Chargement…"));
    equipe().then((gens) => {
      respSel.replaceChildren(h("option", { value: "" }, "Personne"), ...gens.map((p) => h("option", { value: p.user_id }, p.nom || p.email)));
      respSel.value = d.responsable_id || "";
    });
    const ref = h("input", { id: "m-ref", value: d.ref });
    const fermer = modal(
      "Modifier le dossier",
      h(
        "form",
        {
          class: "modal-corps",
          onsubmit: async (e) => {
            e.preventDefault();
            if (etat.db.dossiers.some((x) => x.id !== d.id && x.ref === ref.value.trim())) {
              toast("Cette référence existe déjà.", true);
              return;
            }
            await modifier("dossiers", d.id, { client_id: selClient.valeur || d.client_id, pays: pays.value.trim(), date_depart: depart.value || null, date_retour: retour.value || null, accepte_le: accepte.value || null, ref: ref.value.trim(), responsable_id: respSel.value || null });
            fermer();
            toast("Dossier modifié.");
            rafraichir();
          },
        },
        selClient.noeud,
        h("div", { class: "grille-form" }, champ(regl.dossier.libelle_pays || "Pays", pays), champ("Référence", ref), champ("Début", depart), champ("Fin", retour), champ("Date d'acceptation du devis", accepte, "Laissez vide si le client n'a pas encore accepté."), champ("Responsable du dossier", respSel, "Avec un rôle limité à « ses dossiers », la personne ne voit que ceux dont elle est responsable.")),
        h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, "Annuler"), h("button", { type: "submit", class: "principal" }, "Enregistrer"))
      )
    );
  };

  // Paiements
  const dateP = h("input", { id: "p-date", type: "date", value: ajd, required: true });
  const montantP = h("input", { id: "p-montant", type: "number", step: "0.01", min: "0", required: true, inputmode: "decimal" });
  const manque = r.recu < acompte ? arrondi(acompte - r.recu) : Math.max(0, r.reste);
  if (manque > 0) montantP.value = manque;
  const moyenP = h("select", { id: "p-moyen" }, MOYENS.map(([v, l]) => h("option", { value: v }, l)));
  const origineM = h("input", { id: "p-orig-m", type: "number", step: "0.01", min: "0", inputmode: "decimal" });
  const origineD = h("select", { id: "p-orig-d" }, ["", "EUR", "THB", "USD"].map((v) => h("option", { value: v }, v || "Aucune")));
  const noteP = h("input", { id: "p-note" });
  const formPaiement = h(
    "form",
    {
      class: "formulaire en-ligne",
      id: "form-paiement",
      onsubmit: async (e) => {
        e.preventDefault();
        const montant = num(montantP.value);
        if (!montant || montant <= 0) {
          toast("Indiquez un montant supérieur à zéro.", true);
          return;
        }
        await inserer("paiements", {
          dossier_id: d.id,
          date: dateP.value,
          montant,
          type: r.recu < acompte ? "acompte" : "solde",
          moyen: moyenP.value,
          origine_montant: num(origineM.value),
          origine_devise: origineD.value,
          note: noteP.value.trim(),
        });
        toast("Paiement enregistré.");
        rafraichir();
      },
    },
    h("div", { class: "grille-form" }, champ("Date de réception", dateP), champ("Montant reçu (CHF)", montantP), champ("Moyen de paiement", moyenP), champ("Note", noteP), champ("Montant d'origine, si payé en devise", origineM), champ("Devise d'origine", origineD)),
    h("div", { class: "actions" }, h("button", { type: "submit", class: "principal" }, "Enregistrer le paiement"))
  );

  const nomMoyen = (v) => (MOYENS.find(([k]) => k === v) || [0, v])[1];
  const tableauPaiements = paiements.length
    ? h(
        "table",
        { class: "tableau simple" },
        h("thead", null, h("tr", null, ["Date", "Type", "Moyen", "Note", "Montant", ""].map((t, i) => h("th", { scope: "col", class: i === 4 ? "num" : null }, t)))),
        h(
          "tbody",
          null,
          [...paiements]
            .sort((a, b) => (a.date > b.date ? 1 : -1))
            .map((p) =>
              h(
                "tr",
                null,
                h("td", { "data-label": "Date" }, formatDate(p.date)),
                h("td", { "data-label": "Type" }, p.type === "acompte" ? "Acompte" : p.type === "solde" ? "Solde" : "Autre"),
                h("td", { "data-label": "Moyen" }, nomMoyen(p.moyen)),
                h("td", { "data-label": "Note" }, [p.note, p.origine_montant ? `${p.origine_montant} ${p.origine_devise}` : ""].filter(Boolean).join(", ")),
                h("td", { class: "num", "data-label": "Montant" }, fm(p.montant)),
                h(
                  "td",
                  { class: "action-cellule" },
                  !droit.paiements ? null : h(
                    "button",
                    {
                      class: "lien danger-texte",
                      type: "button",
                      "aria-label": `Supprimer le paiement du ${formatDate(p.date)}`,
                      onclick: async () => {
                        if (await confirmer(`Supprimer le paiement de ${fm(p.montant)} du ${formatDate(p.date)} ?`, "Supprimer", true)) {
                          await supprimer("paiements", p.id);
                          rafraichir();
                        }
                      },
                    },
                    "Supprimer"
                  )
                )
              )
            )
        )
      )
    : h("p", { class: "vide-court" }, "Aucun paiement enregistré.");

  const ligneDoc = (doc, libelle) => {
    const t = totaux(doc.contenu, doc.type === "facture" && doc.contenu.montant_recu != null ? doc.contenu.montant_recu : 0);
    return h(
      "tr",
      null,
      h("td", { "data-label": "Document" }, h("a", { href: `#/doc/${doc.id}` }, libelle)),
      h("td", { "data-label": "Émis le" }, formatDate(doc.date_emission)),
      h("td", { "data-label": "Envoyé le" }, doc.envoye_le ? formatDate(doc.envoye_le) : "Pas encore"),
      h("td", { class: "num", "data-label": "Total" }, fm(t.net, doc.contenu.devise)),
      h("td", { class: "action-cellule" }, h("a", { class: "bouton secondaire petit", href: `#/doc/${doc.id}` }, "Ouvrir"), h("button", { class: "secondaire petit", type: "button", onclick: () => pdf(doc) }, "PDF"))
    );
  };

  const notes = h("textarea", {
    id: "notes",
    readonly: !droit.dossiers,
    rows: 3,
    value: d.notes || "",
    onblur: async (e) => {
      if (e.target.value !== (d.notes || "")) {
        await modifier("dossiers", d.id, { notes: e.target.value });
        toast("Notes enregistrées.");
      }
    },
  });
  notes.value = d.notes || "";

  return h(
    "div",
    { "data-titre": nomClient(client) },
    h("a", { class: "retour", href: "#/dossiers" }, "Dossiers"),
    h(
      "div",
      { class: "entete" },
      h("div", null, h("h1", null, nomClient(client)), h("p", { class: "sous" }, sousTitreDossier(d), responsable)),
      h("div", { class: "entete-actions" }, pastille(r.statut), droit.dossiers && droit.docs ? h("button", { class: "secondaire", type: "button", onclick: dupliquer }, "Dupliquer") : null, droit.dossiers ? h("button", { class: "secondaire", type: "button", onclick: modifierDossier }, "Modifier le dossier") : null)
    ),
    !droit.finances ? null : h(
      "div",
      { class: "chiffres compacts" },
      ...[["Total", fm(r.total)], ...(acompte > 0 ? [[`Acompte (${regl.conditions.acompte_pct}%)`, fm(acompte)]] : []), ["Reçu", fm(r.recu)], ["Reste à payer", fm(r.reste)]].map(([l, v]) => h("div", { class: "chiffre" }, h("p", { class: "chiffre-libelle" }, l), h("p", { class: "chiffre-valeur" }, v)))
    ),
    h(
      "section",
      null,
      h("h2", null, "Avancement"),
      h(
        "ol",
        { class: "etapes" },
        ...(avecDevis ? [etape(!!devis, "Devis créé", devis ? `Émis le ${formatDate(devis.date_emission)}` : "", devis ? h("a", { class: "bouton secondaire petit", href: `#/doc/${devis.id}` }, "Ouvrir le devis") : null)] : []),
        ...(avecDevis ? [etape(!!(devis && devis.envoye_le), "Devis envoyé au client", devis && devis.envoye_le ? `Le ${formatDate(devis.envoye_le)}` : "Une fois le PDF expédié, notez-le ici pour suivre les relances.", devis && !devis.envoye_le && droit.docs ? h("button", { class: "secondaire petit", type: "button", onclick: marquerEnvoye }, "Marquer comme envoyé") : null)] : []),
        ...(avecDevis ? [etape(!!d.accepte_le, "Devis accepté", d.accepte_le ? `Le ${formatDate(d.accepte_le)}${echeance && r.recu < acompte ? `, acompte attendu avant le ${formatDate(echeance)}` : ""}` : "", !d.accepte_le && droit.dossiers ? h("button", { class: "secondaire petit", type: "button", onclick: accepter }, "Le client a accepté") : null)] : []),
        ...(acompte > 0 && droit.finances ? [etape(r.recu >= acompte, "Acompte reçu", r.recu >= acompte && acompte > 0 ? `${fm(r.recu)} reçus` : acompte ? `${fm(acompte)} attendus` : "Le total du devis est à zéro.", r.recu < acompte && droit.paiements ? h("a", { class: "bouton secondaire petit", href: "#form-paiement", onclick: (e) => { e.preventDefault(); document.getElementById("p-montant").focus(); } }, "Enregistrer un paiement") : null)] : []),
        etape(!!facture, "Facture", facture ? `Émise le ${formatDate(facture.date_emission)}${facture.envoye_le ? `, envoyée le ${formatDate(facture.envoye_le)}` : ""}` : "À créer quand la prestation est prête, ou dès l'acompte reçu.", facture ? h("a", { class: "bouton secondaire petit", href: `#/doc/${facture.id}` }, "Ouvrir la facture") : droit.docs ? h("button", { class: "secondaire petit", type: "button", onclick: creerFacture }, "Créer la facture") : null),
        etape(r.statut === "solde", "Dossier soldé", r.statut === "solde" ? "Tout est encaissé." : r.total ? `Reste ${fm(r.reste)} à encaisser.` : "")
      )
    ),
    !droit.finances ? null : h(
      "section",
      null,
      h("h2", null, "Documents"),
      r.documents.length
        ? h(
            "table",
            { class: "tableau simple" },
            h("thead", null, h("tr", null, ["Document", "Émis le", "Envoyé le", "Total", ""].map((t, i) => h("th", { scope: "col", class: i === 3 ? "num" : null }, t)))),
            h("tbody", null, r.documents.filter((x) => x.type === "devis").map((x) => ligneDoc(x, "Devis")), r.documents.filter((x) => x.type === "facture").map((x) => ligneDoc(x, "Facture")), r.documents.filter((x) => x.type === "facture_locale").map((x) => ligneDoc(x, "Facture locale")))
          )
        : h("p", { class: "vide-court" }, "Aucun document."),
      facture && !locale && droit.docs ? h("div", { class: "actions gauche" }, h("button", { class: "secondaire", type: "button", onclick: creerLocale }, "Créer la facture locale")) : null
    ),
    droit.finances ? h("section", null, h("h2", null, "Paiements reçus"), tableauPaiements, droit.paiements ? [h("h3", null, "Enregistrer un paiement"), formPaiement] : null) : null,
    sectionTachesDossier(d.id),
    sectionPieces(d),
    h("section", null, h("h2", null, "Notes internes"), champ("Visibles seulement ici, jamais sur les documents", notes)),
    !(droit.dossiers || droit.supprimer) ? null : h(
      "section",
      { class: "zone-danger" },
      h("h2", null, d.annule ? "Dossier annulé" : "Annuler ou supprimer"),
      h(
        "div",
        { class: "actions gauche" },
        !droit.dossiers ? null : h(
          "button",
          {
            class: "secondaire",
            type: "button",
            onclick: async () => {
              if (d.annule || (await confirmer("Marquer ce dossier comme annulé ? Il sortira des totaux à encaisser mais restera consultable.", "Marquer comme annulé"))) {
                await modifier("dossiers", d.id, { annule: !d.annule });
                rafraichir();
              }
            },
          },
          d.annule ? "Réactiver le dossier" : "Marquer comme annulé"
        ),
        !droit.supprimer ? null : h(
          "button",
          {
            class: "danger",
            type: "button",
            onclick: async () => {
              if (await confirmer("Supprimer définitivement ce dossier avec ses documents et ses paiements ? Cette action est irréversible.", "Supprimer définitivement", true)) {
                await supprimer("dossiers", d.id);
                naviguer("#/dossiers");
                toast("Dossier supprimé.");
              }
            },
          },
          "Supprimer le dossier"
        )
      )
    )
  );
}
