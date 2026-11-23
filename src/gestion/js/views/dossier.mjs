import { etat, resumeDossier, modifier, inserer, supprimer, nomClient, naviguer, reglages, peut, equipe, chargerDossier, moduleActif, modeExcursions, modeTaxi, netReservation, estAdmin, clientParId, etiquetteClient } from "../etat.mjs";
import { estBookingConfirmation } from "../taxi-calc.mjs";
import { h, champ, modal, confirmer, toast, num, icone, barreAction } from "../ui.mjs";
import { formatMontant, formatDate, aujourdhui, acompteDu, echeanceAcompte, totaux, arrondi, nouvelleRef, tauxVers, acceptationAuPaiement, payeSansFacture } from "../calc.mjs";
import { uid, modesPaiement, CONTENU_DEFAUT } from "../defauts.mjs";
import { patchEnvoi, etatEnvoi, numeroVerrouille, localeEnRetard, ecartRecu } from "../documents-calc.mjs";
import { contenuLocale } from "./facture-locale.mjs";
import { langueClient } from "../operations-calc.mjs";
import { selecteurClient } from "./selecteur-client.mjs";
import { ouvrirFicheClientModal, peutModifierFiche } from "./clients.mjs";
import { sectionTachesDossier } from "./taches.mjs";
import { sectionPieces } from "./pieces.mjs";
import { pastille, vide, sousTitreDossier, plierSections, resumerEtapes } from "./commun.mjs";
import { margeDocument, chiffres as numeroDe } from "../partenaires-calc.mjs";
import { supprimerDocument } from "./document-suppression.mjs";
import { sectionReservationsDossier, formulaireReservation, ajouterServices } from "./reservations.mjs";
import { etatsServices, personnesDossier, commissionDossier, actionSuivante, varianteFacture } from "../dossier-resume-calc.mjs";
import { MOTIFS_ECART } from "../encaisser-calc.mjs";
import { vouchersDuDossier, imprimerTousLesVouchers } from "./voucher.mjs";
import { envoyerVoucher } from "./voucher-envoi.mjs";
import { envoyerDocument } from "./document-envoi.mjs";
import { numeroVoucher, TITRES_VOUCHER, etatEnvoisVouchers } from "../operations-calc.mjs";
import { ouvrirEnvois } from "./envois-vouchers.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";
import { agentActif } from "../agent-calc.mjs";
import { dossierLie } from "../espace-unifie-calc.mjs";
import { demandesDuDossier } from "../demandes-site-calc.mjs";
import { boutonMessageClient, jourRecu } from "./message-client.mjs";
import { ouvrirSansSuite, rouvrirDevis, baseDistante } from "./sans-suite.mjs";
import { marquerDossierAnnule } from "./annulation-dossier.mjs";
import { peutClasser, disponible as sansSuiteDisponible } from "../sans-suite-calc.mjs";
import { ouvrirCarnet, baseDistante as baseDistanteCarnet } from "./carnet.mjs";
import { disponible as carnetDisponible, peutNoter } from "../carnet-calc.mjs";
import { typePaiement, paiementEnDouble, ecartASolder, TYPES_PAIEMENT, reservationsAReactiver, reactivation } from "../dossier-gestes-calc.mjs";
import { champApporteur, patchApporteur, blocResumeApporteur } from "./apporteurs.mjs";
import { boutonProposerExcursion } from "./proposer-excursion.mjs";

const rafraichir = () => naviguer(location.hash);

// Le dossier vient d'une demande du site : « Demande du site du 19 nov. 2026 » et son message, tel que le client l'a envoyé (19.11.2026).
// Mêmes droits que l'écran des demandes : les lignes ne sont chargées que pour qui peut les lire (lit_demandes_site), avec le module actif.
function blocDemandesSite(d) {
  if (!moduleActif("demandes_site")) return null;
  const demandes = demandesDuDossier(etat.db.demandes_site, d.id);
  if (!demandes.length) return null;
  return h(
    "div",
    { class: "dossier-demandes-site" },
    demandes.map((x) => h("p", { class: "dossier-demande-site" }, h("span", null, tr("Demande du site du {date}", { date: jourRecu(x.created_at) }), x.ref ? ` · ${x.ref}` : ""), boutonMessageClient(x)))
  );
}

// Réactiver les réservations d'un dossier qu'on vient de réactiver. Celles annulées avec le dossier sont cochées ; celles annulées une à une
// avant restent décochées (leur service avait peut-être été retiré de la facture). Rien n'est envoyé au prestataire.
function proposerReactivation(d) {
  const { cochees, autres } = reservationsAReactiver(etat.db.reservations, d.id);
  if (!cochees.length && !autres.length) return Promise.resolve();
  const cases = [...cochees.map((x) => [x, true]), ...autres.map((x) => [x, false])].map(([x, coche]) => [x, h("input", { type: "checkbox", id: `react-${x.id}`, checked: coche })]);
  const quand = (x) => (x.date_service ? formatDate(x.date_service) : tr("date à fixer"));
  return new Promise((resolve) => {
    const valider = async (e) => {
      e.currentTarget.disabled = true;
      const choisies = cases.filter(([, c]) => c.checked).map(([x]) => x);
      try {
        for (const x of choisies) await modifier("reservations", x.id, reactivation(x));
        if (choisies.length) toast(pluriel(choisies.length, N_("{n} réservation réactivée. Le prestataire n'est pas prévenu par l'outil."), N_("{n} réservations réactivées. Les prestataires ne sont pas prévenus par l'outil.")));
      } catch (err) {
        toast(tr("Une réservation n'a pas pu être réactivée : {message}", { message: err.message }), true);
      }
      fermer();
    };
    const fermer = modal(
      tr("Réactiver aussi les réservations ?"),
      h(
        "div",
        { class: "modal-corps" },
        h("p", null, cochees.length ? tr("Les réservations cochées ont été annulées avec le dossier. Elles redeviennent confirmées.") : tr("Ce dossier a des réservations annulées. Cochez celles qui reprennent.")),
        cases.map(([x, c]) => h("label", { class: "case", for: c.id }, c, `${x.libelle} · ${quand(x)}`)),
        autres.length && cochees.length ? h("p", { class: "aide" }, tr("Les réservations décochées avaient été annulées avant le dossier.")) : null,
        h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, tr("Laisser annulées")), h("button", { type: "button", class: "principal", onclick: valider }, tr("Réactiver la sélection")))
      ),
      { protege: false, ferme: () => resolve() }
    );
  });
}

const dernier = (docs, type) => docs.filter((d) => d.type === type).sort((a, b) => (a.created_at > b.created_at ? 1 : -1)).pop();

// Les documents et paiements d'un dossier se chargent à son ouverture.
// Espace unifié (migration 63) : « Dossier lié : Taxi T-2026-… » vers l'autre dossier de la même demande, quand la personne peut le lire.
// L'adresse porte l'entreprise du dossier lié : l'ouvrir bascule l'entreprise active (app.mjs).
function lienDossierLie(d) {
  const l = dossierLie(d, etat.brut.dossiers || [], etat.brut.entites || []);
  if (!l) return null;
  return h("p", { class: "dossier-lie" }, icone("dossiers", 16), h("a", { href: `#/dossier/${l.id}?entite=${l.entite_id}` }, tr("Dossier lié : {entreprise} {ref}", { entreprise: l.entreprise, ref: l.ref })));
}

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
  // La conversation de l'onglet Assistant qui a préparé ou touché ce dossier (migration 54) : un lien pour la rouvrir et retrouver le
  // pourquoi d'une heure ou d'un prix. Seulement les miennes (comme dans l'onglet), et seulement si l'agent est allumé ici.
  const lienAgent = h("span", { class: "dossier-agent" });
  if (agentActif(reglages()) && peut("dossiers.ecrire") && peut("partenaires.lire") && etat.store.agentConversationsDuDossier) {
    etat.store.agentConversationsDuDossier(d.id).then((liste) => {
      if (!liste.length) return;
      lienAgent.replaceChildren(
        " · ",
        h("a", { href: `#/agent/${liste[0].id}`, title: liste[0].titre || "" }, liste.length > 1 ? tr("Conversations avec l'assistant ({n})", { n: liste.length }) : tr("Conversation avec l'assistant"))
      );
    }, () => {});
  }
  const regl = reglages();
  // Un moyen archivé (lot D) garde son nom sur les paiements déjà enregistrés, mais n'est plus proposé pour un nouveau.
  const MOYENS = regl.listes.moyens.map((m) => [m.id, tr(m.label), !!m.archive]);
  const devis = dernier(r.documents, "devis");
  const facture = dernier(r.documents, "facture");
  const locale = dernier(r.documents, "facture_locale");
  // Mode excursions (Secret) : pas de devis, la facture vient en premier, puis les vouchers.
  const excursions = modeExcursions();
  // Mode taxi (VIP Taxi Lanta) : le prix vit sur un document interne jamais montré ; ni facture, ni paiement à enregistrer.
  const taxi = modeTaxi();
  const avecDevis = !excursions && (!!devis || !facture);
  // Acompte figé à l'envoi du devis (r.pct), pas celui des Réglages du jour.
  const acompte = acompteDu(r.total, r.pct ?? regl.conditions.acompte_pct);
  const echeance = echeanceAcompte(d, regl);
  const ajd = aujourdhui();
  // Marge du dossier : total du document qui fait foi moins les nets des lignes de partenaires, pour qui voit les nets.
  const docMarge = facture || devis;
  const marge = droit.finances && peut("partenaires.nets") && docMarge ? margeDocument(docMarge.contenu, totaux(docMarge.contenu).net) : null;
  const ligneMarge = marge && marge.avecNet ? [[tr("Marge"), fm(marge.marge), `${marge.pct} %${marge.sansNet ? ", " + pluriel(marge.sansNet, N_("ligne sans net connu"), N_("lignes sans net connu")) : ""}`]] : [];
  const reservations = etat.db.reservations.filter((x) => x.dossier_id === d.id && x.statut !== "annule");
  const vouchers = excursions ? vouchersDuDossier(d.id) : [];
  // Une vraie trace d'envoi par voucher (client, prestataire), pas une supposition tirée du paiement.
  // Un voucher modifié depuis son envoi est à renvoyer : l'étape « Vouchers envoyés » ne reste pas cochée (lot B, audit n° 24).
  // « 1 modifié depuis l'envoi, à renvoyer » : un voucher parti puis changé ne compte plus comme envoyé (lot B).
  const aRenvoyerTexte = (e) => (e.aRenvoyer ? pluriel(e.aRenvoyer, N_("{n} modifié depuis l'envoi, à renvoyer"), N_("{n} modifiés depuis l'envoi, à renvoyer")) : "");
  const envoisVouchers = etatEnvoisVouchers(vouchers.map((x) => x.reservation), { modifies: new Set(vouchers.filter((x) => x.envoi && x.envoi.modifie).map((x) => x.reservation.id)) });

  // Étapes du dossier : le statut en découle, ces boutons ne font qu'enregistrer des faits.
  const etape = (fait, titre, detail, action) => h("li", { class: fait ? "etape fait" : "etape" }, h("span", { class: "etape-etat" }, fait ? tr("Fait") : tr("À faire")), h("div", { class: "etape-texte" }, h("strong", null, tr(titre)), detail ? h("span", null, detail) : null), action || null);

  // Un document qui part chez le client se fige : émetteur, banque, devise, acompte (documents-calc.mjs). Le devis fige aussi l'acompte % du dossier.
  const noterEnvoi = async (doc, recu = null) => {
    await modifier("documents", doc.id, patchEnvoi(doc, regl, { date: ajd, paiements, recu }));
    if (doc.type === "devis" && "acompte_pct" in d && d.acompte_pct == null) {
      try {
        await modifier("dossiers", d.id, { acompte_pct: Number(regl.conditions.acompte_pct) || 0 });
      } catch (err) {
        toast(tr("Acompte non figé sur le dossier : {message}", { message: err.message }), true);
      }
    }
  };
  const marquerEnvoye = async () => {
    await noterEnvoi(devis);
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
    // Sans devis (Secret, ou facture recréée après une suppression) : le même gabarit que « Ajouter un service », en anglais pour Secret.
    const base = devis ? structuredClone(devis.contenu) : excursions ? { ...CONTENU_DEFAUT(), colonnes: "total", langue: langueClient(regl) === "en" ? "en" : "", variante: (regl.textes.variantes[0] || {}).id || "", equivalents: { actif: false }, lignes: [] } : { bandeau: d.bandeau, colonnes: "total", lignes: [], equivalents: { actif: false }, pied: "qr", variante: "qr", tva: true };
    base.montant_recu = null;
    // La facture repart sans trace d'envoi du devis ; elle écrit toujours sa devise.
    delete base.fige;
    delete base.envois;
    delete base.source;
    base.devise = base.devise || regl.devise;
    // Les conditions du devis parlent de « la signature du devis » : la facture prend la variante des réglages prévue pour les factures.
    const cond = varianteFacture(regl.textes.variantes, base.variante);
    base.variante = cond.variante;
    const f = await inserer("documents", { dossier_id: d.id, type: "facture", date_emission: ajd, envoye_le: null, updated_at: new Date().toISOString(), contenu: base });
    if (cond.manque && !excursions) toast(tr("Aucune variante de conditions pour les factures dans les réglages : la facture garde celle du devis. Vérifiez la phrase avant l'envoi."), true);
    // Facturer un devis, c'est qu'il est accepté : sans cela le dossier restait « Devis envoyé », hors de « À encaisser » et relancé comme un devis.
    if (devis && !d.accepte_le && !d.annule) {
      try {
        await modifier("dossiers", d.id, { accepte_le: ajd });
      } catch (err) {
        toast(tr("Acceptation non enregistrée : {message}", { message: err.message }), true);
      }
    }
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
            // La facture locale garde l'empreinte de la facture copiée et le taux : si la facture change, l'écart se voit et la copie se recrée.
            const contenu = contenuLocale(facture, { taux: t, devise: cible.value, paiement: mode.value, numero: numero.value.trim(), langue: langue.value });
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
            const cl = clientParId(sel.valeur);
            try {
              const ref = nouvelleRef({ numerotation: regl.numerotation, prenom: cl.prenom, nom: cl.nom, dateIso: ajd, pays: d.pays || "", refsExistantes: etat.db.dossiers.map((x) => x.ref) });
              const nd = await inserer("dossiers", { ref, client_id: cl.id, pays: d.pays, bandeau: d.bandeau, date_depart: null, date_retour: null, accepte_le: null, annule: false, notes: "" });
              const contenu = structuredClone(modele.contenu);
              contenu.lignes = contenu.lignes.map((l) => ({ ...l, id: uid() }));
              contenu.montant_recu = null;
              delete contenu.libelle_recu;
              delete contenu.fige;
              delete contenu.envois;
              delete contenu.source;
              delete contenu.numero;
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
    // « Modifier la fiche client » suit le client choisi : corrigé sur place, sans quitter le dossier ni perdre la saisie (Jérémy, 18.11.2026).
    let ficheModifiee = false;
    const selClient = selecteurClient({ id: "m-client", valeur: d.client_id, surChangement: () => majFiche() });
    const boutonFiche = h("button", { class: "lien", type: "button", onclick: () => {
      const c = clientParId(selClient.valeur);
      ouvrirFicheClientModal(c, (maj) => {
        ficheModifiee = true;
        selClient.choisirId(maj.id || c.id);
      });
    } }, tr("Modifier la fiche client"));
    const sigleFiche = h("span", { class: "etiquette-partage" });
    const blocFiche = h("p", { class: "fiche-depuis-dossier" }, boutonFiche, sigleFiche);
    function majFiche() {
      const c = clientParId(selClient.valeur);
      blocFiche.hidden = !peutModifierFiche(c);
      const s = c ? etiquetteClient(c) : "";
      sigleFiche.textContent = s ? tr("fiche {sigle}", { sigle: s }) : "";
      sigleFiche.hidden = !s;
    }
    majFiche();
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
    // Un devis ou une facture est parti avec ce numéro : il ne change plus, sauf par l'administratrice après confirmation.
    const refBloquee = numeroVerrouille(r.documents);
    ref.readOnly = refBloquee;
    const deverrouiller = h("button", { class: "lien", type: "button", hidden: !refBloquee || !estAdmin(), onclick: async () => {
      if (!(await confirmer(tr("Un document est déjà parti chez le client avec le numéro {ref}. Le changer renumérote le devis, la facture et les vouchers de ce dossier : le client aura deux numéros pour le même dossier. Le changer quand même ?", { ref: d.ref }), tr("Changer le numéro"), true))) return;
      ref.readOnly = false;
      deverrouiller.hidden = true;
      ref.focus();
    } }, tr("Changer le numéro"));
    const aideRef = refBloquee ? tr("Document déjà envoyé : le numéro ne change plus.") : null;
    // Apporteur d'affaires (migration 68) : Secret et Taxi seulement, quand l'entreprise a une fiche apporteur.
    const apporteur = excursions ? champApporteur(d) : null;
    const fermer = modal(
      tr("Modifier le dossier"),
      h(
        "form",
        {
          class: "modal-corps",
          onsubmit: async (e) => {
            e.preventDefault();
            if (ref.readOnly && ref.value.trim() !== d.ref) ref.value = d.ref;
            if (etat.db.dossiers.some((x) => x.id !== d.id && x.ref === ref.value.trim())) {
              toast(tr("Cette référence existe déjà."), true);
              return;
            }
            ficheModifiee = false;
            await modifier("dossiers", d.id, excursions ? { client_id: selClient.valeur || d.client_id, ref: ref.value.trim(), responsable_id: respSel.value || null, ...patchApporteur(apporteur, d) } : { client_id: selClient.valeur || d.client_id, pays: pays.value.trim(), date_depart: depart.value || null, date_retour: retour.value || null, accepte_le: accepte.value || null, ref: ref.value.trim(), responsable_id: respSel.value || null });
            fermer();
            toast(tr("Dossier modifié."));
            rafraichir();
          },
        },
        selClient.noeud,
        blocFiche,
        excursions ? h("div", { class: "grille-form" }, h("div", null, champ(taxi ? tr("Numéro de réservation") : tr("Numéro de facture"), ref, aideRef), deverrouiller), champ(tr("Responsable"), respSel), apporteur ? apporteur.noeud : null, h("p", { class: "aide pleine-largeur" }, tr("Les dates du dossier sont celles de ses réservations, elles se mettent à jour toutes seules."))) : h("div", { class: "grille-form" }, champ(regl.dossier.libelle_pays || tr("Pays"), pays), h("div", null, champ(tr("Référence"), ref, aideRef), deverrouiller), champ(tr("Début"), depart), champ(tr("Fin"), retour), champ(tr("Date d'acceptation du devis"), accepte, tr("Laissez vide si le client n'a pas encore accepté.")), champ(tr("Responsable du dossier"), respSel, tr("Avec un rôle limité à « ses dossiers », la personne ne voit que ceux dont elle est responsable."))),
        h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, tr("Annuler")), h("button", { type: "submit", class: "principal" }, tr("Enregistrer")))
      ),
      { ferme: () => ficheModifiee && rafraichir() }
    );
  };

  // Paiements
  // Le même montant déjà saisi à trois jours près : on demande avant d'enregistrer un second paiement identique.
  const pasEnDouble = async ({ date, montant }, sauf = null) => {
    const x = paiementEnDouble(paiements, { date, montant }, { sauf });
    return !x || (await confirmer(tr("Un paiement de {montant} du {date} est déjà enregistré sur ce dossier. Enregistrer ce second paiement quand même ?", { montant: fm(x.montant), date: formatDate(x.date) }), tr("Enregistrer les deux")));
  };
  const LIBELLES_TYPE = { acompte: N_("Acompte"), solde: N_("Solde"), ecart: N_("Écart soldé (frais, change)"), autre: N_("Autre"), remboursement: N_("Remboursement") };
  const libelleType = (t) => tr(LIBELLES_TYPE[t] || LIBELLES_TYPE.autre);
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
  const moyenP = h("select", { id: "p-moyen" }, MOYENS.filter(([, , archive]) => !archive).map(([v, l]) => h("option", { value: v }, l)));
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
        if (!(await pasEnDouble({ date: dateP.value, montant: rembourse ? -montant : montant }))) return;
        boutonPaiement.disabled = true;
        try {
          await inserer("paiements", {
            dossier_id: d.id,
            date: dateP.value,
            montant: rembourse ? -montant : montant,
            type: typePaiement({ montant, recu: r.recu, total: r.total, rembourse }),
            moyen: moyenP.value,
            origine_montant: rembourse ? null : num(origineM.value),
            origine_devise: rembourse ? "" : origineD.value,
            note: noteP.value.trim(),
          });
          // Un premier paiement vaut acceptation (sans quoi le dossier soldé reste « devis en attente »).
          const acceptation = acceptationAuPaiement(d, dateP.value, rembourse);
          if (acceptation) await modifier("dossiers", d.id, { accepte_le: acceptation });
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

  // Corriger un paiement mal saisi (date, montant, type, moyen, note, montant et devise d'origine) sans le supprimer et le ressaisir. Le sens (reçu ou remboursé) ne change pas.
  const corrigerPaiement = (p) => {
    const rembourse = Number(p.montant) < 0;
    const f = {
      date: h("input", { id: "pc-date", type: "date", value: p.date, required: true }),
      montant: h("input", { id: "pc-montant", type: "number", step: "0.01", min: "0", required: true, inputmode: "decimal", value: Math.abs(Number(p.montant)) }),
      moyen: h("select", { id: "pc-moyen" }, MOYENS.filter(([v, , archive]) => !archive || v === p.moyen).map(([v, l]) => h("option", { value: v }, l))),
      note: h("input", { id: "pc-note", value: p.note || "" }),
      // Le type se corrige (un acompte affiché « Solde », un écart saisi comme paiement) ; un remboursement reste un remboursement.
      type: h("select", { id: "pc-type", disabled: rembourse }, (rembourse ? ["remboursement"] : TYPES_PAIEMENT).map((t) => h("option", { value: t }, libelleType(t)))),
      origineM: h("input", { id: "pc-orig-m", type: "number", step: "0.01", min: "0", inputmode: "decimal", value: p.origine_montant ?? "" }),
      origineD: h("select", { id: "pc-orig-d" }, [...new Set(["", ...(reglages().listes.devises || ["CHF", "EUR", "THB", "USD"]), ...(p.origine_devise ? [p.origine_devise] : [])])].map((v) => h("option", { value: v }, v || tr("Aucune")))),
    };
    f.moyen.value = p.moyen || "";
    f.type.value = rembourse ? "remboursement" : TYPES_PAIEMENT.includes(p.type) ? p.type : "autre";
    const typeInitial = f.type.value;
    f.origineD.value = p.origine_devise || "";
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
            if ((f.date.value !== p.date || arrondi(montant) !== arrondi(Math.abs(Number(p.montant)))) && !(await pasEnDouble({ date: f.date.value, montant: rembourse ? -montant : montant }, p.id))) return;
            enregistrer.disabled = true;
            try {
              await modifier("paiements", p.id, { date: f.date.value, montant: rembourse ? -montant : montant, moyen: f.moyen.value, note: f.note.value.trim(), ...(f.type.value !== typeInitial ? { type: f.type.value } : {}), origine_montant: rembourse ? null : num(f.origineM.value), origine_devise: rembourse ? "" : f.origineD.value });
              fermer();
              toast(tr("Paiement corrigé."));
              rafraichir();
            } catch (err) {
              enregistrer.disabled = false;
              toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
            }
          },
        },
        h("div", { class: "grille-form" }, champ(tr("Date de réception"), f.date), champ(rembourse ? tr("Montant remboursé ({x})", { x: r.devise || regl.devise }) : tr("Montant reçu ({x})", { x: r.devise || regl.devise }), f.montant), champ(tr("Type"), f.type), champ(tr("Moyen de paiement"), f.moyen), champ(tr("Note"), f.note), rembourse ? null : champ(tr("Montant d'origine, si payé en devise"), f.origineM), rembourse ? null : champ(tr("Devise d'origine"), f.origineD)),
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
                h("td", { "data-label": tr("Type") }, libelleType(p.type)),
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

  // Un petit reste qui ne viendra jamais (frais Wise, écart de change) : on le solde en un geste, et le dossier sort de « À encaisser ».
  // Il s'enregistre comme un paiement de type « écart », sans moyen de paiement, pour que le reste tombe à zéro et que la trace demeure.
  // Seulement pour un petit reste (5 % du total au plus) : un solde ZTP encore attendu après l'acompte n'est pas un écart. Un reste plus gros
  // qui ne viendra pas se solde quand même : « Corriger » un paiement permet de lui donner le type « Écart soldé ».
  const ecartBrut = !d.annule ? ecartASolder({ total: r.total, recu: r.recu }) : null;
  const ecart = ecartBrut && ecartBrut.petit ? ecartBrut : null;
  const solderEcart = ecart && droit.paiements
    ? h("div", { class: "actions gauche solder-ecart" }, h("button", { class: "secondaire", type: "button", onclick: async () => {
        const phrase = tr("Solder l'écart de {montant} ? Il s'enregistre comme « écart soldé » (frais Wise, change) : le dossier est soldé et sort de « À encaisser ». Supprimez cette ligne si l'argent arrive finalement.", { montant: fm(ecart.montant) });
        if (!(await confirmer(phrase, tr("Solder l'écart")))) return;
        try {
          await inserer("paiements", { dossier_id: d.id, date: ajd, montant: ecart.montant, type: "ecart", moyen: "", origine_montant: null, origine_devise: "", note: tr("Frais ou écart de change") });
          toast(tr("Écart soldé."));
          rafraichir();
        } catch (err) {
          toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
        }
      } }, tr("Solder l'écart ({montant})", { montant: fm(ecart.montant) })), h("p", { class: "aide" }, tr("Pour un petit reste qui ne sera pas payé : frais Wise, écart de change.")))
    : null;

  // « Envoyer » sur tous les appareils : PDF prêt, conversation WhatsApp ou e-mail ouverts avec le message (« Imprimer » reste dans la fenêtre d'envoi).
  // Une facture envoyée fige son montant reçu, comme dans l'éditeur.
  // Modifié depuis l'envoi : c'est un renvoi, et le montant reçu imprimé peut d'abord se mettre à jour d'après les paiements.
  const envoyerDoc = async (doc) => {
    const renvoi = etatEnvoi(doc).modifie;
    const ecart = renvoi ? ecartRecu(doc, paiements) : null;
    // Le nouveau montant reçu part dans le PDF et ne s'enregistre qu'avec l'envoi : fermer la fenêtre sans envoyer ne change rien.
    let recu = null;
    if (ecart && (await confirmer(tr("La facture envoyée indique {imprime} reçus. Les paiements enregistrés font {paiements}. Mettre {paiements} sur la facture renvoyée ?", { imprime: fm(ecart.imprime, doc.contenu.devise), paiements: fm(ecart.paiements, doc.contenu.devise) }), tr("Mettre à jour le montant reçu")))) {
      recu = ecart.paiements;
      doc = { ...doc, contenu: { ...doc.contenu, montant_recu: recu } };
    }
    envoyerDocument(doc, {
      renvoi,
      marquerEnvoye: async () => {
        await noterEnvoi(doc, recu);
        rafraichir();
      },
    });
  };
  const ligneDoc = (doc, libelle) => {
    const t = totaux(doc.contenu, doc.type === "facture" && doc.contenu.montant_recu != null ? doc.contenu.montant_recu : 0);
    return h(
      "tr",
      null,
      h("td", { "data-label": tr("Document") }, h("a", { href: `#/doc/${doc.id}` }, tr(libelle))),
      h("td", { "data-label": tr("Émis le") }, formatDate(doc.date_emission)),
      // Modifié depuis l'envoi : le client a encore l'ancienne version (« Renvoyer » dans l'éditeur). Facture locale en retard sur la facture.
      h("td", { "data-label": tr("Envoyé le") }, doc.envoye_le ? formatDate(doc.envoye_le) : tr("Pas encore"), etatEnvoi(doc).modifie ? h("span", { class: "tag alerte" }, tr("modifié depuis l'envoi")) : null, doc.type === "facture_locale" && localeEnRetard(doc, facture) ? h("span", { class: "tag alerte" }, tr("facture modifiée depuis")) : null),
      h("td", { class: "num", "data-label": tr("Total") }, fm(t.net, doc.contenu.devise)),
      h("td", { class: "action-cellule" }, h("a", { class: "bouton secondaire petit", href: `#/doc/${doc.id}` }, tr("Ouvrir")), h("button", { class: "secondaire petit", type: "button", onclick: () => envoyerDoc(doc) }, doc.type === "facture_locale" ? "PDF" : tr("Envoyer")), peut("documents.supprimer") ? h("button", { class: "secondaire petit danger-texte", type: "button", onclick: () => supprimerDocument(doc, rafraichir) }, tr("Supprimer")) : null)
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

  // ---- Résumé : l'essentiel du dossier d'un coup d'œil ------------------------------------------------------------
  // Chaque chiffre vient de resumeDossier (total, reçu, reste, sur place) ou de commissionsARecevoir (commissions) : rien n'est recalculé ici.
  const rsDossier = etat.db.reservations.filter((x) => x.dossier_id === d.id);
  const nets = droit.finances && peut("partenaires.nets");
  const aEnvoyer = droit.docs && !taxi ? [devis, facture].find((x) => x && !x.envoye_le) : null;
  const tel = numeroDe(client.telephone);
  const aller = (id, apres) => (e) => {
    e.preventDefault();
    const cible = document.getElementById(id);
    if (!cible) return;
    // Le champ visé peut se trouver dans une section que la personne a repliée : on ouvre la section avant d'y aller.
    const section = cible.tagName === "DETAILS" ? cible : cible.closest("details");
    if (section) section.open = true;
    cible.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    if (apres) apres();
  };
  const bloc = (classe, libelle, ...contenu) => h("div", { class: `resume-bloc ${classe}` }, h("p", { class: "resume-libelle" }, libelle), ...contenu);
  const ligne = (libelle, valeur, classe) => h("div", { class: ["resume-ligne", classe].filter(Boolean).join(" ") }, h("dt", null, libelle), h("dd", null, valeur));
  const etats = etatsServices(rsDossier);
  const effectif = personnesDossier(rsDossier);
  const commission = nets ? commissionDossier(rsDossier, netReservation) : null;
  const dates = d.date_depart ? (d.date_retour && d.date_retour !== d.date_depart ? tr("Du {debut} au {fin}", { debut: formatDate(d.date_depart), fin: formatDate(d.date_retour) }) : tr("Le {date}", { date: formatDate(d.date_depart) })) : tr("Dates à fixer");
  const effectifTexte = effectif ? (effectif.min === effectif.max ? pluriel(effectif.max, N_("{n} personne"), N_("{n} personnes")) : tr("de {min} à {max} personnes", effectif)) : null;
  const acompteRecu = acompte > 0 ? r.recu >= acompte : r.recu > 0;
  const suivante = actionSuivante({ annule: !!d.annule, statut: r.statut, aEnvoyer, avecDevis, devisEnvoye: !!(devis && devis.envoye_le), accepte: !!d.accepte_le, facture: !!facture, acompteRecu, reservations: rsDossier, vouchers, reste: r.reste, excursions, taxi, droit });
  // Devis sans réponse : « Sans suite » à côté de l'étape suivante. Une fois classé, le résumé dit depuis quand et pourquoi, et propose de rouvrir.
  const sansSuiteOk = droit.dossiers && sansSuiteDisponible(d, baseDistante());
  const boutonSansSuite = sansSuiteOk && peutClasser({ annule: !!d.annule, statut: r.statut }) && devis && devis.envoye_le ? h("button", { class: "secondaire", type: "button", onclick: () => ouvrirSansSuite(d, rafraichir) }, tr("Classer sans suite")) : null;
  const blocSansSuite =
    r.statut === "sans_suite"
      ? h(
          "div",
          { class: "resume-action resume-sans-suite" },
          h("p", { class: "resume-libelle" }, tr("Sans suite")),
          h("p", { class: "resume-valeur" }, d.sans_suite_motif ? tr("Classé sans suite le {date} : {motif}", { date: formatDate(d.sans_suite_le), motif: tr(d.sans_suite_motif) }) : tr("Classé sans suite le {date}", { date: formatDate(d.sans_suite_le) })),
          sansSuiteOk ? h("button", { class: "principal", type: "button", onclick: () => rouvrirDevis(d, rafraichir) }, tr("Rouvrir le devis")) : null
        )
      : null;
  // Solde : une fois le carnet de voyage envoyé, le solde est dû ce jour-là (les conditions disent « à la réception du carnet »).
  const carnetOk = droit.dossiers && !excursions && carnetDisponible(d, baseDistanteCarnet());
  const boutonCarnet = carnetOk && !d.carnet_envoye_le && peutNoter({ annule: !!d.annule, statut: r.statut, total: r.total, reste: r.reste }) ? h("button", { class: "secondaire", type: "button", onclick: () => ouvrirCarnet(d, rafraichir) }, tr("Carnet envoyé")) : null;
  const ligneCarnet = carnetOk && d.carnet_envoye_le && !d.annule ? h("div", { class: "resume-sous-action resume-carnet" }, h("p", { class: "resume-detail" }, tr("Carnet envoyé le {date}", { date: formatDate(d.carnet_envoye_le) })), h("button", { class: "lien", type: "button", onclick: () => ouvrirCarnet(d, rafraichir) }, tr("Modifier"))) : null;
  // Le geste de l'étape suivante : un libellé complet dans le résumé, un libellé court dans la barre du bas du téléphone
  // (à 375 px, le bouton principal tient environ 15 caractères ; le libellé complet reste dans le title).
  const gesteSuivant = (() => {
    if (!suivante) return null;
    switch (suivante.cle) {
      case "envoyer":
        return { long: suivante.type === "devis" ? tr("Envoyer le devis") : tr("Envoyer la facture"), court: suivante.type === "devis" ? tr("Envoyer le devis") : excursions ? tr("Envoyer") : tr("Envoyer la facture"), faire: () => envoyerDoc(aEnvoyer) };
      case "accepter":
        return { long: tr("Le client a accepté"), court: tr("Accepté"), faire: () => accepter() };
      case "voucher":
        return { long: suivante.voucher.envoi && suivante.voucher.envoi.modifie ? tr("Renvoyer le voucher modifié : {libelle}", { libelle: suivante.voucher.reservation.libelle }) : taxi ? tr("Envoyer la Booking confirmation : {libelle}", { libelle: suivante.voucher.reservation.libelle }) : tr("Envoyer le voucher : {libelle}", { libelle: suivante.voucher.reservation.libelle }), court: taxi ? tr("Confirmation") : tr("Voucher"), faire: () => envoyerVoucher(suivante.voucher) };
      case "facture":
        return { long: tr("Créer la facture"), court: tr("Créer la facture"), faire: creerFacture };
      default:
        return { long: tr("Enregistrer un paiement"), court: tr("Paiement"), faire: aller("form-paiement", () => document.getElementById("p-montant") && document.getElementById("p-montant").focus({ preventScroll: true })) };
    }
  })();
  const boutonSuivant = !gesteSuivant
    ? null
    : h(
        "div",
        // Sur téléphone, l'étape suivante est déjà dans la barre du bas : on ne la répète pas.
        { class: "resume-action seulement-bureau" },
        h("p", { class: "resume-libelle" }, tr("Prochaine étape")),
        h("button", { class: "principal", type: "button", onclick: gesteSuivant.faire }, gesteSuivant.long)
      );
  const blocs = [
    bloc("resume-client", tr("Client"), h("a", { class: "resume-titre", href: `#/client/${client.id}` }, nomClient(client)), tel ? h("a", { class: "resume-contact", href: `tel:${tel}` }, icone("telephone", 16), client.telephone) : client.telephone ? h("p", { class: "resume-detail" }, tr("{numero} : numéro sans indicatif, appel et WhatsApp indisponibles. Ajoutez +41, +33, +66…", { numero: client.telephone })) : null, client.email ? h("a", { class: "resume-contact", href: `mailto:${client.email}` }, client.email) : null),
    // Taxi : une course ; Secret : les dates de ses services ; ZTP : le séjour.
    bloc("resume-sejour", taxi ? tr("Course") : excursions ? tr("Dates des services") : tr("Séjour"), h("p", { class: "resume-valeur" }, dates), effectifTexte ? h("p", { class: "resume-detail" }, effectifTexte) : null),
    moduleActif("reservations")
      ? bloc("resume-services", tr("Services"), h("a", { class: "resume-lien", href: "#services", onclick: aller("services") }, etats.total ? h("strong", null, pluriel(etats.total, N_("{n} service"), N_("{n} services"))) : h("strong", null, tr("Aucun service")), null))
      : null,
    !droit.finances
      ? null
      : taxi
        ? bloc("resume-argent", tr("Prix de la course"), h("dl", null, ligne(tr("Payé au chauffeur"), fm(r.surPlace))), h("p", { class: "resume-detail" }, tr("En espèces, ou par Wise avant le transfert avec 3 % de frais.")))
      : bloc(
          "resume-argent",
          tr("À régler"),
          h(
            "dl",
            null,
            ligne(tr("Total"), fm(r.total)),
            acompte > 0 && r.statut !== "sur_place" ? ligne(tr("Acompte ({acompte_pct}%)", { acompte_pct: r.pct ?? regl.conditions.acompte_pct }), fm(acompte)) : null,
            ligne(tr("Reçu"), fm(r.recu)),
            // « Tout sur place » : rien à encaisser chez nous, ni reste ni couleur d'alerte.
            r.statut === "sur_place" ? ligne(tr("Reste à payer"), tr("Rien chez nous"), "resume-ok") : ligne(tr("Reste à payer"), fm(r.reste), r.reste > 0 ? "resume-reste" : null),
            r.surPlace > 0 ? ligne(tr("À payer sur place"), fm(r.surPlace)) : null,
            // Solde dû dès l'envoi du carnet (seulement quand il reste quelque chose à régler).
            d.carnet_envoye_le && r.reste > 0 && !d.annule && r.statut !== "sur_place" ? ligne(tr("Solde dû dès le"), formatDate(d.carnet_envoye_le)) : null,
            ...ligneMarge.map(([l, v, det]) => ligne(l, det ? `${v} · ${det}` : v))
          ),
          // De l'argent reçu sans facture : à régulariser, sinon rien ne le rattache à un document.
          payeSansFacture({ recu: r.recu, documents: r.documents, annule: !!d.annule }) ? h("p", { class: "resume-detail" }, tr("Payé sans facture : créez la facture de ce dossier.")) : null
        ),
    !nets
      ? null
      : commission
        ? h(
            "div",
            { class: "resume-bloc resume-commission" },
            h("p", { class: "resume-libelle" }, tr("Commission")),
            h("dl", null, ligne(tr("Prévue"), fm(commission.prevue)), ligne(tr("Reçue"), fm(commission.recue)), ligne(tr("À recevoir"), fm(commission.reste), commission.reste > 0 ? "resume-reste" : "resume-ok"), commission.ecart ? ligne(tr("Écart sur les commissions réglées"), fm(commission.ecart)) : null),
            commission.motifs.length ? h("p", { class: "resume-detail" }, tr("Motif de l'écart : {motifs}", { motifs: commission.motifs.map((m) => [tr((MOTIFS_ECART.find(([k]) => k === m.motif) || [, m.motif])[1]), m.note].filter(Boolean).join(", ")).join(" ; ") })) : null,
            commission.sansCommission > 0 ? h("p", { class: "resume-detail" }, pluriel(commission.sansCommission, N_("{n} service payé sur place sans commission renseignée"), N_("{n} services payés sur place sans commission renseignée"))) : null,
            h("a", { class: "resume-lien-bas", href: "#services", onclick: aller("services") }, tr("Voir dans les services"), icone("fleche", 14))
          )
        : rsDossier.length ? bloc("resume-commission", tr("Commission"), h("p", { class: "resume-detail" }, tr("Aucun service payé sur place : pas de commission à recevoir."))) : null,
    blocResumeApporteur(d),
  ].filter(Boolean);
  const resume = h("div", { class: "resume-dossier", role: "region", "aria-label": tr("Résumé du dossier") }, h("div", { class: "resume-grille" }, blocs), boutonSuivant, blocSansSuite || (boutonSansSuite || boutonCarnet ? h("div", { class: "resume-sous-action" }, boutonSansSuite || boutonCarnet) : ligneCarnet));

  const racine = h(
    "div",
    { "data-titre": nomClient(client) },
    // Ouvert depuis À encaisser : « Retour » y ramène, la liste se retrouve à la même hauteur (encaisser-commissions.mjs).
    new URLSearchParams(location.hash.split("?")[1] || "").get("depuis") === "encaisser" ? h("a", { class: "retour", href: "#/encaisser" }, tr("À encaisser")) : h("a", { class: "retour", href: "#/dossiers" }, tr("Dossiers")),
    h(
      "div",
      { class: "entete" },
      h("div", null, h("h1", null, nomClient(client)), h("p", { class: "sous" }, excursions && rsDossier.length > 1 ? [d.ref, pluriel(rsDossier.filter((x) => x.statut !== "annule").length, N_("{n} service"), N_("{n} services"))].join(" · ") : sousTitreDossier(d), responsable, lienAgent), lienDossierLie(d)),
      h("div", { class: "entete-actions" }, pastille(r.statut), boutonProposerExcursion({ dossier: d, classe: "secondaire" }), droit.dossiers && droit.docs && !excursions ? h("button", { class: "secondaire", type: "button", onclick: dupliquer }, tr("Dupliquer")) : null, droit.dossiers ? h("button", { class: "secondaire", type: "button", onclick: modifierDossier }, tr("Modifier le dossier")) : null)
    ),
    blocDemandesSite(d),
    resume,
    h(
      "section",
      null,
      h("h2", null, tr("Avancement")),
      taxi
        ? h(
            "ol",
            { class: "etapes" },
            etape(true, N_("Course enregistrée"), tr("{montant}, payé au chauffeur en espèces ou par Wise avant le transfert (3 % de frais).", { montant: fm(r.surPlace) })),
            etape(envoisVouchers.client >= vouchers.length && vouchers.length > 0, N_("Booking confirmation envoyée"), !vouchers.length ? tr("Elle se prépare depuis la course ci-dessous.") : [pluriel(vouchers.length, N_("{c} sur {n} envoyée au client"), N_("{c} sur {n} envoyées au client"), { c: envoisVouchers.client }), aRenvoyerTexte(envoisVouchers)].filter(Boolean).join(" · "), vouchers.length && droit.dossiers ? h("button", { class: "secondaire petit", type: "button", onclick: () => ouvrirEnvois(vouchers, rafraichir) }, tr("Noter les envois")) : null),
            etape(reservations.length > 0 && reservations.every((x) => x.date_service && x.date_service < ajd), N_("Course faite"), d.date_depart ? tr("Service le {date}", { date: formatDate(d.date_depart) }) : "", null)
          )
        : excursions
        ? h(
            "ol",
            // Secret : dans l'ordre du travail, comme l'étape suivante (vouchers, puis facture et paiement).
            { class: "etapes" },
            etape(envoisVouchers.complet, N_("Vouchers envoyés"), !vouchers.length ? tr("Les vouchers se préparent depuis les réservations du dossier.") : envoisVouchers.client || envoisVouchers.aRenvoyer ? [pluriel(envoisVouchers.total, N_("{c} sur {n} envoyé au client"), N_("{c} sur {n} envoyés au client"), { c: envoisVouchers.client }), aRenvoyerTexte(envoisVouchers)].filter(Boolean).join(" · ") : pluriel(vouchers.length, N_("{n} voucher à envoyer au client, rien n'est encore noté comme envoyé."), N_("{n} vouchers à envoyer au client, rien n'est encore noté comme envoyé.")), vouchers.length ? h("span", { class: "carte-actions" }, h("a", { class: "bouton secondaire petit", href: "#vouchers", onclick: (e) => { e.preventDefault(); document.getElementById("vouchers").scrollIntoView({ behavior: "smooth" }); } }, tr("Voir les vouchers")), droit.dossiers ? h("button", { class: "secondaire petit", type: "button", onclick: () => ouvrirEnvois(vouchers, rafraichir) }, tr("Noter les envois")) : null) : null),
            etape(!!facture, N_("Facture"), facture ? tr("Émise le {date}", { date: formatDate(facture.date_emission) }) + (facture.envoye_le ? tr(", envoyée le {date}", { date: formatDate(facture.envoye_le) }) : tr(", pas encore marquée envoyée")) : tr("À créer."), facture ? h("a", { class: "bouton secondaire petit", href: `#/doc/${facture.id}` }, tr("Ouvrir la facture")) : droit.docs ? h("button", { class: "secondaire petit", type: "button", onclick: creerFacture }, tr("Créer la facture")) : null),
            etape(r.statut === "solde" || r.statut === "sur_place", N_("Payée"), r.statut === "sur_place" ? tr("Rien à encaisser : le client paie les prestataires sur place.") : r.statut === "solde" ? tr("{montant} reçus", { montant: fm(r.recu) }) : r.recu > 0 ? tr("Partiellement payé : reçu {recu}, reste {reste}", { recu: fm(r.recu), reste: fm(r.reste) }) : tr("En attente du paiement (virement, Wise ou espèces)."), r.statut !== "solde" && r.statut !== "sur_place" && droit.paiements ? h("a", { class: "bouton secondaire petit", href: "#form-paiement", onclick: (e) => { e.preventDefault(); document.getElementById("p-montant").focus(); } }, tr("Enregistrer un paiement")) : null),
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
          h("div", { class: "entete petit-entete" }, h("h2", null, taxi ? tr("Booking confirmation") : tr("Vouchers")), vouchers.length > 1 && window.matchMedia("(hover: hover)").matches ? h("button", { class: "secondaire petit", type: "button", onclick: () => imprimerTousLesVouchers(d.id) }, taxi ? tr("Toutes les Booking confirmations en PDF") : tr("Tous les vouchers en PDF")) : null),
          vouchers.length
            ? h("ul", { class: "cartes" }, vouchers.map((x) => h("li", { class: "carte" }, h("div", { class: "carte-lien statique" }, h("span", { class: "carte-titre" }, x.reservation.libelle), h("span", { class: "carte-droite" }, h("strong", null, x.numero || numeroVoucher(d.ref, x.index))), h("span", { class: "carte-sous" }, `${estBookingConfirmation(x.reservation, x.type, reglages()) ? "Booking confirmation" : TITRES_VOUCHER[x.type] || "Voucher"} · ${x.reservation.date_service ? formatDate(x.reservation.date_service) : tr("date à fixer")}${x.reservation.heure_pickup ? ` · pickup ${x.reservation.heure_pickup}` : ""}`), h("span", { class: "carte-pied" }, h("span", null, taxi ? tr("Payé au chauffeur") : r.statut === "solde" ? tr("Payé") : r.recu > 0 ? tr("Partiellement payé") : tr("À payer sur place ou en attente")), x.envoi && x.envoi.modifie ? h("span", { class: "tag tag-alerte" }, tr("modifié depuis l'envoi")) : null, h("span", { class: "carte-actions" }, droit.dossiers ? h("button", { class: "secondaire petit", type: "button", onclick: () => { const fermer = modal(tr("Réservation et voucher"), formulaireReservation(x.reservation, () => (fermer(), rafraichir())), { brouillon: `reservation:${x.reservation.id}` }); } }, tr("Modifier")) : null, h("button", { class: x.envoi && x.envoi.le && !x.envoi.modifie ? "secondaire petit" : "principal petit", type: "button", onclick: () => envoyerVoucher(x) }, x.envoi && x.envoi.le ? tr("Renvoyer") : taxi ? tr("Envoyer la Booking confirmation") : tr("Envoyer le voucher"))))))))
            : h("p", { class: "vide-court" }, tr("Un voucher par réservation (les frais de parc n'en ont pas). Créez d'abord les réservations ci-dessous.")),
          taxi ? h("p", { class: "aide" }, tr("La même confirmation se donne au client et au chauffeur. « Modifier » ouvre la course : lieu et heure de pickup, drop-off, passagers, bagages, prix.")) : h("details", { class: "aide-repli" }, h("summary", null, tr("Comment ça marche ?")), h("p", { class: "aide" }, tr("Le même voucher se donne au client et au prestataire. Les cases Paid, Deposit ou Pay on site suivent les paiements enregistrés sur la facture. « Modifier » ouvre la réservation avec les champs du voucher : chambre, drop-off, vol, bagages, type de tour ou de transfert, frais de parc, remarques.")))
        )
      : null,
    !droit.finances || taxi ? null : h(
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
    droit.finances && !taxi ? h("section", null, h("h2", null, tr("Paiements reçus")), tableauPaiements, solderEcart, droit.paiements ? [h("h3", null, tr("Enregistrer un paiement")), formPaiement] : null) : null,
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
              if (d.annule) {
                await modifier("dossiers", d.id, { annule: false });
                // Dossier réactivé : ses réservations annulées avec lui sont proposées à la réactivation, les autres sont listées sans être cochées.
                await proposerReactivation(d);
                rafraichir();
              } else if (await confirmer(r.recu > 0 ? tr("Marquer ce dossier comme annulé ? Il sortira des totaux à encaisser mais restera consultable. {montant} ont déjà été encaissés. Si vous les rendez, enregistrez un remboursement dans les paiements.", { montant: fm(r.recu) }) : tr("Marquer ce dossier comme annulé ? Il sortira des totaux à encaisser mais restera consultable."), tr("Marquer comme annulé"), true)) {
                await marquerDossierAnnule(d);
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
              // La base garde le dossier 90 jours dans la corbeille (Réglages, onglet Sauvegarde) : le message le dit (17.11.2026).
              if (await confirmer(etat.store.mode === "supabase" ? tr("Supprimer ce dossier avec ses documents, ses paiements et ses réservations ? Il reste 90 jours dans la corbeille (Réglages, onglet Sauvegarde) et peut être restauré pendant ce temps.") : tr("Supprimer ce dossier avec ses documents et ses paiements ? En démonstration, il ne peut pas être restauré."), tr("Supprimer le dossier"), true)) {
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
  // Hiérarchie de la fiche : l'état et la prochaine étape d'abord, puis les services, les documents et les paiements ouverts,
  // le reste replié. Au téléphone, une barre collante porte les gestes principaux (envoyer, écrire au client, ajouter un service).
  const TITRE_SERVICES = tr("Services");
  const sectionDe = (nom) => [...racine.children].find((e) => e.tagName === "SECTION" && ((e.querySelector(":scope > h2, :scope > .petit-entete > h2") || {}).textContent === nom));
  const avancement = sectionDe(tr("Avancement"));
  const services = sectionDe(TITRE_SERVICES);
  if (services) services.id = "services";
  // Les réservations juste après l'avancement, avant les vouchers.
  if (services && avancement) avancement.after(services);
  const etapes = racine.querySelector(".etapes");
  if (etapes) resumerEtapes(etapes);
  plierSections(racine, { cle: d.id, ouverts: new Set([tr("Avancement"), TITRE_SERVICES, tr("Vouchers"), tr("Booking confirmation"), tr("Documents"), tr("Paiements reçus")]) });

  const gestes = [
    gesteSuivant ? h("button", { class: "principal", type: "button", title: gesteSuivant.long, onclick: gesteSuivant.faire }, gesteSuivant.court) : null,
    tel ? h("a", { class: "bouton secondaire", href: `https://wa.me/${tel.replace(/\D/g, "")}`, target: "_blank", rel: "noopener" }, icone("whatsapp", 18), tr("WhatsApp")) : null,
    droit.dossiers && modeExcursions() && moduleActif("reservations") ? h("button", { class: "secondaire", type: "button", onclick: () => ajouterServices(d, facture || devis || null, rafraichir) }, icone("ajouter", 18), tr("Service")) : null,
  ].filter(Boolean);
  if (gestes.length) {
    const barre = barreAction(...gestes);
    barre.classList.add("seulement-mobile", "barre-dossier");
    racine.append(barre);
  }
  // « Noter un paiement » depuis l'écran WhatsApp (preuve de paiement envoyée par le client) : « #/dossier/<id>?paiement=1 » ouvre la section
  // des paiements et met le curseur sur le montant, déjà prérempli avec ce qui reste à payer. Après le placement du défilement par app.mjs.
  if (/[?&]paiement=1(&|$)/.test(location.hash) && droit.paiements)
    setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      const form = document.getElementById("form-paiement");
      if (!form || !form.isConnected) return;
      const section = form.closest("details");
      if (section) section.open = true;
      form.scrollIntoView({ block: "center" });
      const montant = document.getElementById("p-montant");
      if (montant) montant.focus({ preventScroll: true });
    })), 0);
  return racine;
}
