import { etat, resumeDossier, modifier, inserer, supprimer, nomClient, naviguer, reglages, peut, equipe, chargerDossier, moduleActif, modeExcursions } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, num } from "../ui.mjs";
import { formatMontant, formatDate, aujourdhui, acompteDu, echeanceAcompte, totaux, arrondi, nouvelleRef, tauxVers, convertirContenu } from "../calc.mjs";
import { uid, modesPaiement } from "../defauts.mjs";
import { selecteurClient } from "./selecteur-client.mjs";
import { sectionTachesDossier } from "./taches.mjs";
import { sectionPieces } from "./pieces.mjs";
import { pastille, vide, pdf, sousTitreDossier } from "./commun.mjs";
import { margeDocument } from "../partenaires-calc.mjs";
import { supprimerDocument } from "./document-suppression.mjs";
import { sectionReservationsDossier, formulaireReservation } from "./reservations.mjs";
import { vouchersDuDossier, imprimerTousLesVouchers } from "./voucher.mjs";
import { envoyerVoucher } from "./voucher-envoi.mjs";
import { envoyerDocument, sansImpression } from "./document-envoi.mjs";
import { numeroVoucher, TITRES_VOUCHER } from "../operations-calc.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";

const rafraichir = () => naviguer(location.hash);
const dernier = (docs, type) => docs.filter((d) => d.type === type).sort((a, b) => (a.created_at > b.created_at ? 1 : -1)).pop();

// Les documents et paiements d'un dossier se chargent à son ouverture.
export async function ficheDossier(id) {
  await chargerDossier(id);
  return ficheDossierVue(id);
}

function ficheDossierVue(id) {
  const r = resumeDossier(id);
  if (!r) return vide(tr("Dossier introuvable"), tr("Il a peut-être été supprimé."), h("a", { class: "bouton secondaire", href: "#/dossiers" }, tr("Retour aux dossiers")));
  const { dossier: d, client, paiements } = r;
  const fm = (n, code) => formatMontant(n, code || r.devise);
  // Ce que le rôle de la personne permet de faire sur ce dossier.
  const droit = { dossiers: peut("dossiers.ecrire"), docs: peut("documents.ecrire"), paiements: peut("paiements.ecrire"), finances: peut("finances.voir"), supprimer: peut("dossiers.supprimer") };
  const responsable = h("span", null);
  equipe().then((gens) => {
    const p = gens.find((x) => x.user_id === d.responsable_id);
    responsable.textContent = p ? tr(" · Responsable : {x}", { x: p.nom || p.email }) : "";
  });
  const regl = reglages();
  const MOYENS = regl.listes.moyens.map((m) => [m.id, tr(m.label)]);
  const devis = dernier(r.documents, "devis");
  const facture = dernier(r.documents, "facture");
  const locale = dernier(r.documents, "facture_locale");
  // Mode excursions (Secret) : pas de devis, la facture vient en premier, puis les vouchers.
  const excursions = modeExcursions();
  const avecDevis = !excursions && (!!devis || !facture);
  const acompte = acompteDu(r.total, regl.conditions.acompte_pct);
  const echeance = echeanceAcompte(d, regl);
  const ajd = aujourdhui();
  // Marge du dossier : total du document qui fait foi moins les nets des lignes de partenaires, pour qui voit les nets.
  const docMarge = facture || devis;
  const marge = droit.finances && peut("partenaires.nets") && docMarge ? margeDocument(docMarge.contenu, totaux(docMarge.contenu).net) : null;
  const ligneMarge = marge && marge.avecNet ? [[tr("Marge"), fm(marge.marge), `${marge.pct} %${marge.sansNet ? ", " + pluriel(marge.sansNet, N_("ligne sans net connu"), N_("lignes sans net connu")) : ""}`]] : [];
  const reservations = etat.db.reservations.filter((x) => x.dossier_id === d.id && x.statut !== "annule");
  const vouchers = excursions ? vouchersDuDossier(d.id) : [];

  // Étapes du dossier : le statut en découle, ces boutons ne font qu'enregistrer des faits.
  const etape = (fait, titre, detail, action) => h("li", { class: fait ? "etape fait" : "etape" }, h("span", { class: "etape-etat" }, fait ? tr("Fait") : tr("À faire")), h("div", { class: "etape-texte" }, h("strong", null, tr(titre)), detail ? h("span", null, detail) : null), action || null);

  const marquerEnvoye = async () => {
    await modifier("documents", devis.id, { envoye_le: ajd });
    toast(tr("Devis marqué comme envoyé."));
    rafraichir();
  };
  const accepter = () => {
    const date = h("input", { id: "date-accept", type: "date", value: ajd });
    const fermer = modal(
      tr("Le client a accepté le devis"),
      h(
        "form",
        {
          class: "modal-corps",
          onsubmit: async (e) => {
            e.preventDefault();
            await modifier("dossiers", d.id, { accepte_le: date.value });
            fermer();
            toast(tr("Acceptation enregistrée."));
            rafraichir();
          },
        },
        champ(tr("Date d'acceptation"), date, tr("L'acompte est attendu {delai_jours} jours plus tard.", { delai_jours: regl.conditions.delai_jours })),
        h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, tr("Annuler")), h("button", { type: "submit", class: "principal" }, tr("Enregistrer")))
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
    const langue = h("select", { id: "loc-langue" }, h("option", { value: "en" }, tr("English")), h("option", { value: "" }, tr("Langue principale")));
    const numero = h("input", { id: "loc-numero", value: `${d.ref}-L` });
    const fermer = modal(
      tr("Créer la facture locale"),
      h(
        "form",
        {
          class: "modal-corps",
          onsubmit: async (e) => {
            e.preventDefault();
            const t = num(taux.value);
            if (!t || t <= 0) return toast(tr("Indiquez le taux de conversion."), true);
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
        h("p", { class: "aide" }, tr("Copie de la facture avec les montants convertis. Vous pouvez ensuite tout corriger ligne par ligne. Les paiements restent sur la facture du client ({devSource}).", { devSource })),
        h("div", { class: "grille-form" }, champ(tr("Devise de la facture locale"), cible), champ(tr("Taux (1 {devSource} = … )", { devSource }), taux, tr("Pré-rempli d'après les réglages, modifiable."))),
        modes.length > 1 ? champ(tr("Informations de paiement"), mode) : null,
        champ(tr("Langue de la facture"), langue, tr("Les titres, libellés et conditions de paiement passent en anglais. Les textes des lignes (intitulés, descriptions) sont copiés tels quels : à traduire dans l'éditeur.")),
        champ(tr("Numéro affiché"), numero, tr("Remplace la référence du dossier sur cette facture.")),
        h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, tr("Annuler")), h("button", { type: "submit", class: "principal" }, tr("Créer la facture locale")))
      )
    );
  };

  // Une copie du devis pour un nouveau dossier, comme dupliquer une page dans l'ancien fichier.
  const dupliquer = () => {
    const modele = devis || facture;
    if (!modele) return toast(tr("Ce dossier n'a pas encore de document à copier."), true);
    const sel = selecteurClient({ id: "dup-client", libelle: tr("Pour quel client ?"), valeur: d.client_id });
    const fermer = modal(
      tr("Dupliquer ce dossier"),
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
              toast(tr("Dossier dupliqué. Adaptez maintenant le devis."));
              naviguer(`#/doc/${nouveau.id}`);
            } catch (err) {
              toast(tr("Duplication impossible : {message}", { message: err.message }), true);
            }
          },
        },
        sel.noeud,
        h("p", { class: "aide" }, tr("Le document est copié avec toutes ses lignes, sans paiement ni date d'envoi. Créez d'abord le client s'il n'existe pas encore.")),
        h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, tr("Annuler")), h("button", { type: "submit", class: "principal" }, tr("Créer la copie")))
      )
    );
  };

  const modifierDossier = () => {
    const selClient = selecteurClient({ id: "m-client", valeur: d.client_id });
    const pays = h("input", { id: "m-pays", value: d.pays || "" });
    const depart = h("input", { id: "m-depart", type: "date", value: d.date_depart || "" });
    const retour = h("input", { id: "m-retour", type: "date", value: d.date_retour || "" });
    const accepte = h("input", { id: "m-accepte", type: "date", value: d.accepte_le || "" });
    const respSel = h("select", { id: "m-resp" }, h("option", { value: d.responsable_id || "" }, tr("Chargement…")));
    equipe().then((gens) => {
      respSel.replaceChildren(h("option", { value: "" }, tr("Personne")), ...gens.map((p) => h("option", { value: p.user_id }, p.nom || p.email)));
      respSel.value = d.responsable_id || "";
    });
    const ref = h("input", { id: "m-ref", value: d.ref });
    const fermer = modal(
      tr("Modifier le dossier"),
      h(
        "form",
        {
          class: "modal-corps",
          onsubmit: async (e) => {
            e.preventDefault();
            if (etat.db.dossiers.some((x) => x.id !== d.id && x.ref === ref.value.trim())) {
              toast(tr("Cette référence existe déjà."), true);
              return;
            }
            await modifier("dossiers", d.id, excursions ? { client_id: selClient.valeur || d.client_id, ref: ref.value.trim(), responsable_id: respSel.value || null } : { client_id: selClient.valeur || d.client_id, pays: pays.value.trim(), date_depart: depart.value || null, date_retour: retour.value || null, accepte_le: accepte.value || null, ref: ref.value.trim(), responsable_id: respSel.value || null });
            fermer();
            toast(tr("Dossier modifié."));
            rafraichir();
          },
        },
        selClient.noeud,
        excursions ? h("div", { class: "grille-form" }, champ(tr("Numéro de facture"), ref), champ(tr("Responsable"), respSel), h("p", { class: "aide pleine-largeur" }, tr("Les dates du dossier sont celles de ses réservations, elles se mettent à jour toutes seules."))) : h("div", { class: "grille-form" }, champ(regl.dossier.libelle_pays || tr("Pays"), pays), champ(tr("Référence"), ref), champ(tr("Début"), depart), champ(tr("Fin"), retour), champ(tr("Date d'acceptation du devis"), accepte, tr("Laissez vide si le client n'a pas encore accepté.")), champ(tr("Responsable du dossier"), respSel, tr("Avec un rôle limité à « ses dossiers », la personne ne voit que ceux dont elle est responsable."))),
        h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, tr("Annuler")), h("button", { type: "submit", class: "principal" }, tr("Enregistrer")))
      )
    );
  };

  // Paiements
  const dateP = h("input", { id: "p-date", type: "date", value: ajd, required: true });
  const montantP = h("input", { id: "p-montant", type: "number", step: "0.01", min: "0", required: true, inputmode: "decimal" });
  const manque = r.recu < acompte ? arrondi(acompte - r.recu) : Math.max(0, r.reste);
  if (manque > 0) montantP.value = manque;
  // Un remboursement au client s'enregistre comme un paiement négatif : l'encaissé, le reste et les analyses le comptent tout seuls.
  const sensP = h("select", { id: "p-sens", onchange: () => majSens() }, h("option", { value: "recu" }, tr("Paiement reçu")), h("option", { value: "rembourse" }, tr("Remboursement au client")));
  const majSens = () => {
    const rembourse = sensP.value === "rembourse";
    montantP.previousElementSibling.textContent = rembourse ? tr("Montant remboursé ({x})", { x: r.devise || regl.devise }) : tr("Montant reçu ({x})", { x: r.devise || regl.devise });
    montantP.value = rembourse ? (r.recu > 0 ? r.recu : "") : manque > 0 ? manque : "";
    boutonPaiement.textContent = rembourse ? tr("Enregistrer le remboursement") : tr("Enregistrer le paiement");
  };
  const moyenP = h("select", { id: "p-moyen" }, MOYENS.map(([v, l]) => h("option", { value: v }, l)));
  const origineM = h("input", { id: "p-orig-m", type: "number", step: "0.01", min: "0", inputmode: "decimal" });
  const origineD = h("select", { id: "p-orig-d" }, ["", ...(reglages().listes.devises || ["CHF", "EUR", "THB", "USD"])].map((v) => h("option", { value: v }, v || tr("Aucune"))));
  const noteP = h("input", { id: "p-note" });
  const boutonPaiement = h("button", { type: "submit", class: "principal" }, tr("Enregistrer le paiement"));
  const formPaiement = h(
    "form",
    {
      class: "formulaire en-ligne",
      id: "form-paiement",
      onsubmit: async (e) => {
        e.preventDefault();
        const montant = num(montantP.value);
        const rembourse = sensP.value === "rembourse";
        if (!montant || montant <= 0) {
          toast(tr("Indiquez un montant supérieur à zéro."), true);
          return;
        }
        if (rembourse && montant > r.recu) {
          toast(tr("Le remboursement dépasse ce qui a été encaissé ({recu}).", { recu: fm(r.recu) }), true);
          return;
        }
        // Un montant au-delà du reste à payer est le plus souvent une faute de frappe : on demande avant d'enregistrer.
        if (!rembourse && r.total > 0 && arrondi(montant - Math.max(0, r.reste)) > 0 && !(await confirmer(tr("Ce montant dépasse le reste à payer ({reste}). L'enregistrer quand même ?", { reste: fm(Math.max(0, r.reste)) }), tr("Enregistrer")))) return;
        boutonPaiement.disabled = true;
        try {
          await inserer("paiements", {
            dossier_id: d.id,
            date: dateP.value,
            montant: rembourse ? -montant : montant,
            type: rembourse ? "remboursement" : r.recu < acompte ? "acompte" : "solde",
            moyen: moyenP.value,
            origine_montant: rembourse ? null : num(origineM.value),
            origine_devise: rembourse ? "" : origineD.value,
            note: noteP.value.trim(),
          });
          toast(rembourse ? tr("Remboursement enregistré.") : tr("Paiement enregistré."));
          rafraichir();
        } catch (err) {
          boutonPaiement.disabled = false;
          // Sans la migration 14, la base refuse un montant négatif.
          toast(rembourse && /check|montant/i.test(err.message) ? tr("La base refuse encore les remboursements : exécutez la migration 14.") : tr("Enregistrement impossible : {message}", { message: err.message }), true);
        }
      },
    },
    h("div", { class: "grille-form" }, champ(tr("Sens du paiement"), sensP), champ(tr("Date de réception"), dateP), champ(tr("Montant reçu ({x})", { x: r.devise || regl.devise }), montantP), champ(tr("Moyen de paiement"), moyenP), champ(tr("Note"), noteP), champ(tr("Montant d'origine, si payé en devise"), origineM), champ(tr("Devise d'origine"), origineD)),
    h("div", { class: "actions" }, boutonPaiement)
  );

  // Corriger un paiement mal saisi (date, montant, moyen, note) sans le supprimer et le ressaisir. Le sens (reçu ou remboursé) ne change pas.
  const corrigerPaiement = (p) => {
    const rembourse = Number(p.montant) < 0;
    const f = {
      date: h("input", { id: "pc-date", type: "date", value: p.date, required: true }),
      montant: h("input", { id: "pc-montant", type: "number", step: "0.01", min: "0", required: true, inputmode: "decimal", value: Math.abs(Number(p.montant)) }),
      moyen: h("select", { id: "pc-moyen" }, MOYENS.map(([v, l]) => h("option", { value: v }, l))),
      note: h("input", { id: "pc-note", value: p.note || "" }),
    };
    f.moyen.value = p.moyen || "";
    const enregistrer = h("button", { type: "submit", class: "principal" }, tr("Enregistrer"));
    const fermer = modal(
      rembourse ? tr("Corriger le remboursement") : tr("Corriger le paiement"),
      h(
        "form",
        {
          class: "formulaire",
          onsubmit: async (e) => {
            e.preventDefault();
            const montant = num(f.montant.value);
            if (!montant || montant <= 0) return toast(tr("Indiquez un montant supérieur à zéro."), true);
            // Même garde-fous que pour un nouveau paiement, en retirant l'ancien montant du calcul.
            const autres = arrondi(r.recu - Number(p.montant));
            if (rembourse && montant > autres) return toast(tr("Le remboursement dépasse ce qui a été encaissé ({recu}).", { recu: fm(autres) }), true);
            if (!rembourse && r.total > 0 && arrondi(autres + montant - r.total) > 0 && !(await confirmer(tr("Avec ce montant, le dossier serait payé au-delà de son total. L'enregistrer quand même ?"), tr("Enregistrer")))) return;
            enregistrer.disabled = true;
            try {
              await modifier("paiements", p.id, { date: f.date.value, montant: rembourse ? -montant : montant, moyen: f.moyen.value, note: f.note.value.trim() });
              fermer();
              toast(tr("Paiement corrigé."));
              rafraichir();
            } catch (err) {
              enregistrer.disabled = false;
              toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
            }
          },
        },
        h("div", { class: "grille-form" }, champ(tr("Date de réception"), f.date), champ(rembourse ? tr("Montant remboursé ({x})", { x: r.devise || regl.devise }) : tr("Montant reçu ({x})", { x: r.devise || regl.devise }), f.montant), champ(tr("Moyen de paiement"), f.moyen), champ(tr("Note"), f.note)),
        h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, tr("Annuler")), enregistrer)
      )
    );
  };

  const nomMoyen = (v) => (MOYENS.find(([k]) => k === v) || [0, v])[1];
  const tableauPaiements = paiements.length
    ? h(
        "table",
        { class: "tableau simple" },
        h("thead", null, h("tr", null, [tr("Date"), tr("Type"), tr("Moyen"), tr("Note"), tr("Montant"), ""].map((t, i) => h("th", { scope: "col", class: i === 4 ? "num" : null }, t)))),
        h(
          "tbody",
          null,
          [...paiements]
            .sort((a, b) => (a.date > b.date ? 1 : -1))
            .map((p) =>
              h(
                "tr",
                null,
                h("td", { "data-label": tr("Date") }, formatDate(p.date)),
                h("td", { "data-label": tr("Type") }, p.type === "acompte" ? tr("Acompte") : p.type === "solde" ? tr("Solde") : p.type === "remboursement" ? tr("Remboursement") : tr("Autre")),
                h("td", { "data-label": tr("Moyen") }, nomMoyen(p.moyen)),
                h("td", { "data-label": tr("Note") }, [p.note, p.origine_montant ? `${p.origine_montant} ${p.origine_devise}` : ""].filter(Boolean).join(", ")),
                h("td", { class: "num", "data-label": tr("Montant") }, fm(p.montant)),
                h(
                  "td",
                  { class: "action-cellule" },
                  !droit.paiements ? null : h("button", { class: "lien", type: "button", "aria-label": tr("Corriger le paiement du {date}", { date: formatDate(p.date) }), onclick: () => corrigerPaiement(p) }, tr("Corriger")),
                  !droit.paiements ? null : h(
                    "button",
                    {
                      class: "lien danger-texte",
                      type: "button",
                      "aria-label": tr("Supprimer le paiement du {date}", { date: formatDate(p.date) }),
                      onclick: async () => {
                        if (await confirmer(tr("Supprimer le paiement de {fm} du {date} ?", { fm: fm(p.montant), date: formatDate(p.date) }), tr("Supprimer"), true)) {
                          await supprimer("paiements", p.id);
                          rafraichir();
                        }
                      },
                    },
                    tr("Supprimer")
                  )
                )
              )
            )
        )
      )
    : h("p", { class: "vide-court" }, tr("Aucun paiement enregistré."));

  const ligneDoc = (doc, libelle) => {
    const t = totaux(doc.contenu, doc.type === "facture" && doc.contenu.montant_recu != null ? doc.contenu.montant_recu : 0);
    return h(
      "tr",
      null,
      h("td", { "data-label": tr("Document") }, h("a", { href: `#/doc/${doc.id}` }, tr(libelle))),
      h("td", { "data-label": tr("Émis le") }, formatDate(doc.date_emission)),
      h("td", { "data-label": tr("Envoyé le") }, doc.envoye_le ? formatDate(doc.envoye_le) : tr("Pas encore")),
      h("td", { class: "num", "data-label": tr("Total") }, fm(t.net, doc.contenu.devise)),
      h("td", { class: "action-cellule" }, h("a", { class: "bouton secondaire petit", href: `#/doc/${doc.id}` }, tr("Ouvrir")), h("button", { class: "secondaire petit", type: "button", onclick: () => (sansImpression() ? envoyerDocument(doc, { marquerEnvoye: async () => { await modifier("documents", doc.id, { envoye_le: aujourdhui() }); rafraichir(); } }) : pdf(doc)) }, "PDF"), peut("documents.supprimer") ? h("button", { class: "secondaire petit danger-texte", type: "button", onclick: () => supprimerDocument(doc, rafraichir) }, tr("Supprimer")) : null)
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
        toast(tr("Notes enregistrées."));
      }
    },
  });
  notes.value = d.notes || "";

  return h(
    "div",
    { "data-titre": nomClient(client) },
    h("a", { class: "retour", href: "#/dossiers" }, tr("Dossiers")),
    h(
      "div",
      { class: "entete" },
      h("div", null, h("h1", null, nomClient(client)), h("p", { class: "sous" }, sousTitreDossier(d), responsable)),
      h("div", { class: "entete-actions" }, pastille(r.statut), droit.dossiers && droit.docs && !excursions ? h("button", { class: "secondaire", type: "button", onclick: dupliquer }, tr("Dupliquer")) : null, droit.dossiers ? h("button", { class: "secondaire", type: "button", onclick: modifierDossier }, tr("Modifier le dossier")) : null)
    ),
    !droit.finances ? null : h(
      "div",
      { class: "chiffres compacts" },
      ...[[tr("Total"), fm(r.total)], ...(acompte > 0 ? [[tr("Acompte ({acompte_pct}%)", { acompte_pct: regl.conditions.acompte_pct }), fm(acompte)]] : []), [tr("Reçu"), fm(r.recu)], [tr("Reste à payer"), fm(r.reste)], ...(r.surPlace > 0 ? [[tr("À payer sur place"), fm(r.surPlace)]] : []), ...ligneMarge].map(([l, v, det]) => h("div", { class: "chiffre" }, h("p", { class: "chiffre-libelle" }, l), h("p", { class: "chiffre-valeur" }, v), det ? h("p", { class: "chiffre-detail" }, det) : null))
    ),
    h(
      "section",
      null,
      h("h2", null, tr("Avancement")),
      excursions
        ? h(
            "ol",
            { class: "etapes" },
            etape(!!facture, N_("Facture"), facture ? tr("Émise le {date}", { date: formatDate(facture.date_emission) }) + (facture.envoye_le ? tr(", envoyée le {date}", { date: formatDate(facture.envoye_le) }) : tr(", pas encore marquée envoyée")) : tr("À créer."), facture ? h("a", { class: "bouton secondaire petit", href: `#/doc/${facture.id}` }, tr("Ouvrir la facture")) : droit.docs ? h("button", { class: "secondaire petit", type: "button", onclick: creerFacture }, tr("Créer la facture")) : null),
            etape(r.statut === "solde" || r.statut === "sur_place", N_("Payée"), r.statut === "sur_place" ? tr("Rien à encaisser : le client paie les prestataires sur place.") : r.statut === "solde" ? tr("{montant} reçus", { montant: fm(r.recu) }) : r.recu > 0 ? tr("Acompte de {recu} reçu, reste {reste}", { recu: fm(r.recu), reste: fm(r.reste) }) : tr("En attente du paiement (virement, Wise ou espèces)."), r.statut !== "solde" && r.statut !== "sur_place" && droit.paiements ? h("a", { class: "bouton secondaire petit", href: "#form-paiement", onclick: (e) => { e.preventDefault(); document.getElementById("p-montant").focus(); } }, tr("Enregistrer un paiement")) : null),
            etape(vouchers.length > 0 && (r.statut === "solde" || r.statut === "sur_place"), N_("Vouchers envoyés"), vouchers.length ? pluriel(vouchers.length, N_("{n} voucher pour le client et les prestataires, à envoyer une fois payé."), N_("{n} vouchers pour le client et les prestataires, à envoyer une fois payé.")) : tr("Les vouchers se préparent depuis les réservations du dossier."), vouchers.length ? h("a", { class: "bouton secondaire petit", href: "#vouchers", onclick: (e) => { e.preventDefault(); document.getElementById("vouchers").scrollIntoView({ behavior: "smooth" }); } }, tr("Voir les vouchers")) : null),
            etape(reservations.length > 0 && reservations.every((x) => x.statut === "confirme"), N_("Confirmé par les partenaires"), reservations.length ? pluriel(reservations.length, N_("{confirmees} sur {n} confirmée"), N_("{confirmees} sur {n} confirmées"), { confirmees: reservations.filter((x) => x.statut === "confirme").length }) : tr("Aucune réservation."), null),
            etape(reservations.length > 0 && reservations.every((x) => x.date_service && x.date_service < ajd), N_("Service fait"), d.date_depart ? (d.date_retour && d.date_retour !== d.date_depart ? tr("Services du {debut} au {fin}", { debut: formatDate(d.date_depart), fin: formatDate(d.date_retour) }) : tr("Service le {date}", { date: formatDate(d.date_depart) })) : "", null)
          )
        : h(
        "ol",
        { class: "etapes" },
        ...(avecDevis ? [etape(!!devis, N_("Devis créé"), devis ? tr("Émis le {date}", { date: formatDate(devis.date_emission) }) : "", devis ? h("a", { class: "bouton secondaire petit", href: `#/doc/${devis.id}` }, tr("Ouvrir le devis")) : null)] : []),
        ...(avecDevis ? [etape(!!(devis && devis.envoye_le), N_("Devis envoyé au client"), devis && devis.envoye_le ? tr("Le {date}", { date: formatDate(devis.envoye_le) }) : tr("Une fois le PDF expédié, notez-le ici pour suivre les relances."), devis && !devis.envoye_le && droit.docs ? h("button", { class: "secondaire petit", type: "button", onclick: marquerEnvoye }, tr("Marquer comme envoyé")) : null)] : []),
        ...(avecDevis ? [etape(!!d.accepte_le, N_("Devis accepté"), d.accepte_le ? tr("Le {date}", { date: formatDate(d.accepte_le) }) + (echeance && r.recu < acompte ? tr(", acompte attendu avant le {date}", { date: formatDate(echeance) }) : "") : "", !d.accepte_le && droit.dossiers ? h("button", { class: "secondaire petit", type: "button", onclick: accepter }, tr("Le client a accepté")) : null)] : []),
        ...(acompte > 0 && droit.finances ? [etape(r.recu >= acompte, N_("Acompte reçu"), r.recu >= acompte && acompte > 0 ? tr("{montant} reçus", { montant: fm(r.recu) }) : acompte ? tr("{montant} attendus", { montant: fm(acompte) }) : tr("Le total du devis est à zéro."), r.recu < acompte && droit.paiements ? h("a", { class: "bouton secondaire petit", href: "#form-paiement", onclick: (e) => { e.preventDefault(); document.getElementById("p-montant").focus(); } }, tr("Enregistrer un paiement")) : null)] : []),
        etape(!!facture, N_("Facture"), facture ? tr("Émise le {date}", { date: formatDate(facture.date_emission) }) + (facture.envoye_le ? tr(", envoyée le {date}", { date: formatDate(facture.envoye_le) }) : "") : tr("À créer quand la prestation est prête, ou dès l'acompte reçu."), facture ? h("a", { class: "bouton secondaire petit", href: `#/doc/${facture.id}` }, tr("Ouvrir la facture")) : droit.docs ? h("button", { class: "secondaire petit", type: "button", onclick: creerFacture }, tr("Créer la facture")) : null),
        etape(r.statut === "solde" || r.statut === "sur_place", N_("Dossier soldé"), r.statut === "sur_place" ? tr("Rien à encaisser, tout est payé sur place.") : r.statut === "solde" ? tr("Tout est encaissé.") : r.total ? tr("Reste {montant} à encaisser.", { montant: fm(r.reste) }) : "")
      )
    ),
    excursions && droit.finances
      ? h(
          "section",
          { id: "vouchers" },
          h("div", { class: "entete petit-entete" }, h("h2", null, tr("Vouchers")), vouchers.length > 1 && window.matchMedia("(hover: hover)").matches ? h("button", { class: "secondaire petit", type: "button", onclick: () => imprimerTousLesVouchers(d.id) }, tr("Tous les vouchers en PDF")) : null),
          vouchers.length
            ? h("ul", { class: "cartes" }, vouchers.map((x) => h("li", { class: "carte" }, h("div", { class: "carte-lien statique" }, h("span", { class: "carte-titre" }, x.reservation.libelle), h("span", { class: "carte-droite" }, h("strong", null, numeroVoucher(d.ref, x.index))), h("span", { class: "carte-sous" }, `${TITRES_VOUCHER[x.type] || "Voucher"} · ${x.reservation.date_service ? formatDate(x.reservation.date_service) : tr("date à fixer")}${x.reservation.heure_pickup ? ` · pickup ${x.reservation.heure_pickup}` : ""}`), h("span", { class: "carte-pied" }, h("span", null, r.statut === "solde" ? tr("Payé") : r.recu > 0 ? tr("Acompte") : tr("À payer sur place ou en attente")), h("span", { class: "carte-actions" }, droit.dossiers ? h("button", { class: "secondaire petit", type: "button", onclick: () => { const fermer = modal(tr("Réservation et voucher"), formulaireReservation(x.reservation, () => (fermer(), rafraichir()))); } }, tr("Modifier")) : null, h("button", { class: "principal petit", type: "button", onclick: () => envoyerVoucher(x) }, tr("Envoyer le voucher"))))))))
            : h("p", { class: "vide-court" }, tr("Un voucher par réservation (les frais de parc n'en ont pas). Créez d'abord les réservations ci-dessous.")),
          h("p", { class: "aide" }, tr("Le même voucher se donne au client et au prestataire. Les cases Paid, Deposit ou Pay on site suivent les paiements enregistrés sur la facture. « Modifier » ouvre la réservation avec les champs du voucher : chambre, drop-off, vol, bagages, type de tour ou de transfert, frais de parc, remarques."))
        )
      : null,
    !droit.finances ? null : h(
      "section",
      null,
      h("h2", null, tr("Documents")),
      r.documents.length
        ? h(
            "table",
            { class: "tableau simple" },
            h("thead", null, h("tr", null, [tr("Document"), tr("Émis le"), tr("Envoyé le"), tr("Total"), ""].map((t, i) => h("th", { scope: "col", class: i === 3 ? "num" : null }, t)))),
            h("tbody", null, r.documents.filter((x) => x.type === "devis").map((x) => ligneDoc(x, N_("Devis"))), r.documents.filter((x) => x.type === "facture").map((x) => ligneDoc(x, N_("Facture"))), r.documents.filter((x) => x.type === "facture_locale").map((x) => ligneDoc(x, N_("Facture locale"))))
          )
        : h("p", { class: "vide-court" }, tr("Aucun document.")),
      facture && !locale && droit.docs && !excursions ? h("div", { class: "actions gauche" }, h("button", { class: "secondaire", type: "button", onclick: creerLocale }, tr("Créer la facture locale"))) : null
    ),
    droit.finances ? h("section", null, h("h2", null, tr("Paiements reçus")), tableauPaiements, droit.paiements ? [h("h3", null, tr("Enregistrer un paiement")), formPaiement] : null) : null,
    moduleActif("reservations") ? sectionReservationsDossier(d, facture || devis || null) : null,
    sectionTachesDossier(d.id),
    sectionPieces(d),
    h("section", null, h("h2", null, tr("Notes internes")), champ(tr("Visibles seulement ici, jamais sur les documents"), notes)),
    !(droit.dossiers || droit.supprimer) ? null : h(
      "section",
      { class: "zone-danger" },
      h("h2", null, d.annule ? tr("Dossier annulé") : tr("Annuler ou supprimer")),
      d.annule && r.recu > 0 ? h("p", { class: "aide" }, tr("{montant} encaissés sur ce dossier. Si vous les rendez, enregistrez un remboursement dans les paiements.", { montant: fm(r.recu) })) : null,
      h(
        "div",
        { class: "actions gauche" },
        !droit.dossiers ? null : h(
          "button",
          {
            class: "secondaire",
            type: "button",
            onclick: async () => {
              if (d.annule || (await confirmer(r.recu > 0 ? tr("Marquer ce dossier comme annulé ? Il sortira des totaux à encaisser mais restera consultable. {montant} ont déjà été encaissés. Si vous les rendez, enregistrez un remboursement dans les paiements.", { montant: fm(r.recu) }) : tr("Marquer ce dossier comme annulé ? Il sortira des totaux à encaisser mais restera consultable."), tr("Marquer comme annulé"), true))) {
                const aAnnuler = d.annule ? [] : etat.db.reservations.filter((x) => x.dossier_id === d.id && x.statut !== "annule");
                await modifier("dossiers", d.id, { annule: !d.annule });
                // Les réservations d'un dossier annulé ne comptent déjà plus dans l'agenda ni dans le dû ; on propose de les marquer aussi, pour que la liste et les vouchers soient justes.
                if (aAnnuler.length && (await confirmer(pluriel(aAnnuler.length, N_("Ce dossier a {n} réservation active. La marquer aussi comme annulée ? Le prestataire n'est pas prévenu par l'outil."), N_("Ce dossier a {n} réservations actives. Les marquer aussi comme annulées ? Les prestataires ne sont pas prévenus par l'outil.")), tr("Marquer les réservations annulées"), true))) {
                  try {
                    for (const x of aAnnuler) await modifier("reservations", x.id, { statut: "annule" });
                  } catch (err) {
                    toast(tr("Une réservation n'a pas pu être annulée : {message}", { message: err.message }), true);
                  }
                }
                rafraichir();
              }
            },
          },
          d.annule ? tr("Réactiver le dossier") : tr("Marquer comme annulé")
        ),
        !droit.supprimer ? null : h(
          "button",
          {
            class: "danger",
            type: "button",
            onclick: async () => {
              if (await confirmer(tr("Supprimer définitivement ce dossier avec ses documents et ses paiements ? Cette action est irréversible."), tr("Supprimer définitivement"), true)) {
                await supprimer("dossiers", d.id);
                naviguer("#/dossiers");
                toast(tr("Dossier supprimé."));
              }
            },
          },
          tr("Supprimer le dossier")
        )
      )
    )
  );
}
