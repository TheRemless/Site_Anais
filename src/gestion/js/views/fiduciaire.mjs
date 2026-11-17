// Factures pour la fiduciaire (migration 28) : une facture par service, adressée à l'entreprise prestataire, pour la seule part qui revient à l'agence.
// Deux présentations d'un même écran :
//   • complet (droit « fiduciaire.gerer » : Anaïs, Jérémy) : filtres, calcul, écarts, avoirs, services à revoir ;
//   • simple (« fiduciaire.preparer » seul : Mook) : en thaï, deux blocs, aucun net, aucune information qu'elle n'a pas à décider.
// Les montants viennent de la base (le navigateur ne choisit jamais un montant) ; l'écran n'affiche que ce qu'elle renvoie.
// Chaque entreprise ne montre que ses services et ses factures : Secret dans Secret, VIP Taxi Lanta dans Taxi (Jérémy, 12.11.2026).
// La base renvoie tout ce que la personne a le droit de voir, toutes entreprises confondues : le tri se fait ici, sur l'entreprise ouverte.
// Taxi n'émet pas de factures pour la fiduciaire (Jérémy, 17.11.2026) : chaque entreprise a un réglage « actif », réglable en bas de cet écran,
// avec la date de départ, les préfixes des numéros, les titres et les mots du libellé (bloc réservé à qui a « gérer » et « réglages »).
import { etat, peut, reglages, enregistrerReglages, entiteActive } from "../etat.mjs";
import { h, modal, toast, barreAction, confirmer, champ } from "../ui.mjs";
import { aujourdhui, formatMontant, formatDate } from "../calc.mjs";
import { filtrerFactures, reglagesFid, formaterNumero, FID_DEFAUT } from "../fiduciaire-calc.mjs";
import { TH, MANQUE, remplir } from "../fiduciaire-textes.mjs";
import { fabriquerPdfFactures, feuilleFacture } from "./fiduciaire-pdf.mjs";
import { apercuA4, vide } from "./commun.mjs";
import { partageFichiers, partager, enregistrer } from "./partage.mjs";
import { tr } from "../i18n.mjs";

// Libellés des champs du bloc de réglages (fonctions : la langue de l'interface peut changer après le chargement du module).
const LIBELLES_REGLAGES = {
  prefixe_facture: () => tr("Préfixe des factures"),
  prefixe_avoir: () => tr("Préfixe des avoirs"),
  titre_facture: () => tr("Titre d'une facture"),
  titre_avoir: () => tr("Titre d'un avoir"),
  ref_facture: () => tr("Devant le numéro d'une facture"),
  ref_avoir: () => tr("Devant le numéro d'un avoir"),
  mot_commission: () => tr("Début du libellé d'une commission"),
  mot_marge: () => tr("Début du libellé d'une marge"),
};

const jjmmaaaa = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");

export async function vueFiduciaire() {
  const simple = !peut("fiduciaire.gerer");
  // Texte thaï en écran simple, texte de l'interface sinon (le texte français passe déjà par tr).
  const t = (cle, traduit, vars) => (simple ? remplir(TH[cle].th, vars) : traduit);
  const date = (iso) => (simple ? jjmmaaaa(iso) : formatDate(iso));
  const titre = t("titre", tr("Factures pour la fiduciaire"));
  const racine = h("div", { "data-titre": titre, "data-large": true, class: "fiduciaire", lang: simple ? "th" : undefined });
  const etatEcran = { filtres: { mois: "", envoyee: simple ? "non" : "" }, choisies: new Set(), liste: [], preparer: [], occupe: false, nbPrep: 12, nbEmises: 30, reglagesOuverts: false, m36: null };

  async function charger() {
    const liste = await etat.store.fiduciaireListe();
    if (liste === null) return false;
    const ici = (x) => x.entite_id === etat.entiteId;
    etatEcran.liste = liste.filter(ici);
    etatEcran.preparer = (await etat.store.fiduciaireAPreparer()).filter(ici);
    // Les réglages de l'écran n'ont d'effet qu'avec la migration 36 (préfixes, titres, mots, émetteur, entreprise active).
    if (etatEcran.m36 === null) etatEcran.m36 = etat.store.fiduciaireMigration36 ? await etat.store.fiduciaireMigration36() : true;
    return true;
  }

  async function agir(travail, succes) {
    if (etatEcran.occupe) return;
    etatEcran.occupe = true;
    rendre();
    let retour;
    let erreur = null;
    try {
      retour = await travail();
    } catch (err) {
      erreur = err;
    }
    // Le rechargement est séparé de l'action : une action réussie n'est jamais annoncée comme un échec parce que la liste n'a pas pu se rafraîchir.
    let rechargement = null;
    try {
      await charger();
    } catch (err) {
      rechargement = err;
    }
    if (erreur) toast(simple ? remplir(TH.echec.th, { erreur: erreur.message }) : erreur.message, true);
    else if (succes) toast(succes(retour));
    if (rechargement) toast(simple ? remplir(TH.echec.th, { erreur: rechargement.message }) : tr("L'action est faite, mais la liste n'a pas pu être rechargée : {erreur}", { erreur: rechargement.message }), true);
    etatEcran.occupe = false;
    rendre();
  }

  // « Revoir le calcul » : le détail, nets compris, pour les responsables qui ont le droit « nets ».
  async function revoirCalcul(ligne) {
    let c;
    try {
      c = await etat.store.fiduciaireCalcul(ligne.reservation_id);
    } catch (err) {
      return toast(err.message, true);
    }
    const m = (v) => (v === null || v === undefined ? "–" : formatMontant(v, ligne.devise));
    const d = (v) => (v ? formatDate(v) : "–");
    const lignes = c.cas === "sur_place"
      ? [[tr("Service payé"), tr("sur place, chez le prestataire")], [tr("Commission prévue"), m(c.commission_prevue)], [tr("Commission reçue"), m(c.commission_recue)], [tr("Reçue le"), d(c.commission_recue_le)]]
      : [[tr("Service payé"), tr("chez nous")], [tr("Prix de vente (payé par le client)"), m(c.montant_vente)], [tr("Net prévu au prestataire"), m(c.net_prevu)], [tr("Net payé au prestataire"), m(c.net_paye)], [tr("Prestataire payé le"), d(c.paye_le)]];
    if (c.cas !== "sur_place" && Number(c.remise) > 0) lignes.splice(2, 0, [tr("Part de la remise de la facture du client"), `− ${m(c.remise)}`]);
    if (c.dossier_annule && c.cas !== "sur_place") lignes.push([tr("Dossier"), tr("annulé : aucune marge, le déjà facturé s'annule par un avoir")]);
    lignes.push([tr("Montant qui revient à l'agence"), m(c.cible)], [tr("Déjà facturé"), m(c.deja_facture)], [tr("Date de la facture"), d(c.date)]);
    if (c.manque && c.manque.length) lignes.push([tr("Ce qui manque"), c.manque.map((x) => tr(MANQUE[x] || x)).join(" ; ")]);
    const fermer = modal(
      tr("Calcul de la facture"),
      h("div", { class: "modal-corps" }, h("p", { class: "aide" }, ligne.libelle), h("dl", { class: "calcul-fiduciaire" }, lignes.map(([a, b]) => [h("dt", null, a), h("dd", null, b)])), h("div", { class: "actions" }, h("button", { class: "principal", type: "button", onclick: () => fermer() }, tr("Fermer"))))
    );
  }

  function ouvrirApercu(facture) {
    const fermer = modal(
      facture.numero,
      h("div", { class: "modal-corps" }, apercuA4(() => feuilleFacture(facture)).zone, h("div", { class: "actions" }, h("button", { class: "secondaire", type: "button", onclick: () => fermer() }, t("fermer", tr("Fermer"))))),
      { large: true }
    );
  }

  const carteAPreparer = (l) => {
    const manqueDest = !l.destinataire_nom ? t("sans_prestataire", tr("Ce service n'a pas de prestataire : l'ajouter à la réservation.")) : !l.destinataire_adresse ? t("adresse_manque", tr("L'adresse de {nom} manque dans sa fiche partenaire.", { nom: l.destinataire_nom }), { nom: l.destinataire_nom }) : null;
    const est_avoir = l.type === "avoir";
    const revoir = l.a_revoir && !l.type;
    const ancien = (l.manque || []).includes("partenaire_change");
    const detail = [];
    detail.push(h("p", { class: "ligne-a" }, h("span", { class: "etiquette" }, t("a", tr("À"))), " ", h("strong", null, l.destinataire_nom || "–")));
    if (l.date_cible) detail.push(h("p", { class: "ligne-date" }, h("span", { class: "etiquette" }, t("recu_le", tr("Reçu le"))), " ", date(l.date_cible)));
    if (!simple) {
      detail.push(h("p", { class: "ligne-cas" }, l.cas === "sur_place" ? tr("Commission reçue du prestataire") : tr("Marge : prix de vente moins net payé")));
      if (l.ecart !== null && l.ecart !== undefined && Number(l.ecart) !== 0) detail.push(h("p", { class: "ligne-ecart" }, tr("Écart avec la commission prévue : {ecart}", { ecart: formatMontant(l.ecart, l.devise) })));
      if (ancien) detail.push(h("p", { class: "avertissement" }, tr("Le prestataire de ce service a changé. {nom} a déjà reçu une facture de {montant} pour ce service : annulez-la par un avoir. La facture au nouveau prestataire se prépare à part, pour le montant entier.", { nom: l.destinataire_nom || "–", montant: formatMontant(l.deja_facture, l.devise) })));
      else if (revoir) detail.push(h("p", { class: "avertissement" }, tr("Déjà facturé, mais le calcul ne permet plus de dire ce qui revient à l'agence. Corrigez la réservation ou ses montants, puis un avoir se proposera."), " ", (l.manque || []).map((x) => tr(MANQUE[x] || x)).join(" ; ")));
      if (est_avoir) detail.push(h("p", { class: "avertissement" }, tr("Le montant facturé est supérieur à ce qui revient à l'agence : un avoir ramène le total au bon montant.")));
    }
    if (manqueDest && !revoir) detail.push(h("p", { class: "avertissement" }, manqueDest));
    const annulerTout = () => agir(async () => {
      const question = ancien
        ? tr("Annuler par un avoir à {nom} les {montant} déjà facturés pour ce service ? L'avoir est définitif.", { nom: l.destinataire_nom || "–", montant: formatMontant(l.deja_facture, l.devise) })
        : tr("Annuler par un avoir les {montant} déjà facturés pour ce service ? L'avoir est définitif.", { montant: formatMontant(l.deja_facture, l.devise) });
      if (!(await confirmer(question, tr("Émettre l'avoir"), true))) return null;
      return etat.store.fiduciaireAnnuler(l.reservation_id, null, l.destinataire_cle || null);
    }, (id) => { const f = id && etatEcran.liste.find((x) => x.id === id); return f ? tr("Avoir {numero} émis.", { numero: f.numero }) : ""; });
    const bouton = revoir
      ? (!simple ? h("button", { class: "secondaire", type: "button", disabled: etatEcran.occupe, onclick: annulerTout }, ancien ? tr("Avoir à {nom} ({montant})", { nom: l.destinataire_nom || "–", montant: formatMontant(l.deja_facture, l.devise) }) : tr("Annuler par un avoir ({montant})", { montant: formatMontant(l.deja_facture, l.devise) })) : null)
      : h("button", { class: est_avoir ? "secondaire" : "principal", type: "button", disabled: !!manqueDest || etatEcran.occupe, onclick: () => agir(() => etat.store.fiduciaireEmettre(l.reservation_id, null, l.type), (id) => { const f = etatEcran.liste.find((x) => x.id === id); return t("cree", tr("Facture {numero} créée.", { numero: f ? f.numero : "" }), { numero: f ? f.numero : "" }); }) }, est_avoir ? tr("Émettre l'avoir") : t("creer", tr("Créer la facture")));
    return h(
      "article",
      { class: `fid-carte${est_avoir ? " avoir" : ""}${revoir ? " a-revoir" : ""}` },
      h("div", { class: "fid-carte-haut" }, h("div", null, h("h3", null, l.libelle), detail), h("div", { class: "fid-montant" }, revoir ? null : h("strong", null, formatMontant(est_avoir ? -l.montant : l.montant, l.devise)), est_avoir ? h("span", { class: "tag" }, tr("Avoir")) : null)),
      h("div", { class: "actions" }, bouton, !simple && peut("partenaires.nets") && !ancien && !(l.manque || []).includes("service_supprime") ? h("button", { class: "lien", type: "button", onclick: () => revoirCalcul(l) }, tr("Revoir le calcul")) : null)
    );
  }

  // Une longue liste ne cache pas ce qui suit : on en montre une partie, le reste à la demande.
  const plus = (total, montre, suite) => (total > montre ? h("p", { class: "fid-plus" }, h("button", { class: "secondaire", type: "button", onclick: suite }, t("voir_plus", tr("Voir la suite ({n})", { n: total - montre }), { n: total - montre }))) : null);

  const carteFacture = (f) => {
    const coche = h("input", { type: "checkbox", id: `fid-${f.id}`, checked: etatEcran.choisies.has(f.id), onchange: (e) => { e.target.checked ? etatEcran.choisies.add(f.id) : etatEcran.choisies.delete(f.id); rendre(); } });
    return h(
      "article",
      { class: `fid-facture${f.type === "avoir" ? " avoir" : ""}` },
      h("label", { class: "fid-coche", for: `fid-${f.id}` }, coche, h("span", { class: "sr-seulement" }, f.numero)),
      h(
        "div",
        { class: "fid-corps" },
        h("div", { class: "fid-ligne" }, h("button", { class: "lien fid-numero", type: "button", onclick: () => ouvrirApercu(f) }, f.numero), f.type === "avoir" ? h("span", { class: "tag" }, t("avoir", tr("Avoir"))) : null, h("strong", { class: "fid-montant" }, formatMontant(f.montant, f.devise))),
        h("p", { class: "fid-a" }, h("span", { class: "etiquette" }, t("a", tr("À"))), " ", f.destinataire.nom),
        h("p", { class: "fid-meta" }, date(f.date_facture)),
        h("p", { class: `fid-envoi${f.envoyee_le ? " fait" : ""}` }, f.envoyee_le ? t("envoyee_le", tr("Envoyée le {date}", { date: formatDate(f.envoyee_le) }), { date: jjmmaaaa(f.envoyee_le) }) : t("non_envoyee", tr("Pas encore envoyée")))
      )
    );
  };

  async function telecharger({ partage = false } = {}) {
    const choisies = etatEcran.liste.filter((f) => etatEcran.choisies.has(f.id)).sort((a, b) => (a.numero < b.numero ? -1 : 1));
    if (!choisies.length) return toast(t("choisir_une", tr("Choisissez au moins une facture.")), true);
    toast(t("pdf_en_cours", tr("Préparation du PDF…")));
    try {
      const { blob, nom } = await fabriquerPdfFactures(choisies);
      const fichier = new File([blob], nom, { type: "application/pdf" });
      if (partage && partageFichiers([fichier])) {
        const res = await partager([fichier]);
        if (res !== "ok" && res !== "annule") enregistrer([fichier]);
      } else enregistrer([fichier]);
    } catch (err) {
      toast(err.message, true);
    }
  }

  function marquerEnvoyees() {
    const choisies = etatEcran.liste.filter((f) => etatEcran.choisies.has(f.id));
    if (!choisies.length) return toast(t("choisir_une", tr("Choisissez au moins une facture.")), true);
    const champ = h("input", { type: "date", id: "fid-date-envoi", value: aujourdhui(), max: aujourdhui() });
    const fermer = modal(
      t("marquer", tr("Marquer envoyée à la fiduciaire")),
      h(
        "div",
        { class: "modal-corps" },
        h("p", null, t("choisies", tr("{n} facture(s) choisie(s)", { n: choisies.length }), { n: choisies.length })),
        h("label", { for: "fid-date-envoi" }, t("date_envoi", tr("Date d'envoi"))),
        champ,
        h("div", { class: "actions" }, h("button", { class: "secondaire", type: "button", onclick: () => fermer() }, simple ? "✕" : tr("Annuler")), h("button", { class: "principal", type: "button", onclick: () => { const jour = champ.value; fermer(); agir(() => etat.store.fiduciaireEnvoyer(choisies.map((f) => f.id), jour), (n) => { etatEcran.choisies.clear(); return t("marquees", tr("{n} facture(s) marquée(s) envoyée(s).", { n }), { n }); }); } }, t("marquer", tr("Marquer envoyée à la fiduciaire"))))
      )
    );
  }

  // Réglages de la fiduciaire de l'entreprise ouverte (reglages.fiduciaire) : ce qui demandait un développeur (audit du 16.11.2026, section 2).
  // L'émetteur, le compte et le QR code viennent des Réglages de l'entreprise ; ils sont copiés sur chaque facture le jour de l'émission.
  function blocReglages() {
    if (simple || !(peut("fiduciaire.gerer") && peut("reglages.ecrire"))) return null;
    const r = reglages();
    const f = reglagesFid(r);
    const brut = (r.fiduciaire || {});
    const entreprise = (entiteActive() || {}).nom || "";
    const id = (k) => `fid-reg-${k}`;
    // Les champs sont gardés ici : l'écran n'est pas encore dans la page au premier affichage (pas de document.getElementById).
    const champs = {};
    const texte = (k, aide) => champ(LIBELLES_REGLAGES[k](), (champs[k] = h("input", { type: "text", id: id(k), value: typeof brut[k] === "string" ? brut[k] : "", placeholder: FID_DEFAUT[k], maxlength: k.startsWith("prefixe") ? 12 : 60, disabled: !etatEcran.m36 })), aide);
    const caseActif = h("input", { type: "checkbox", id: id("actif"), checked: f.actif, disabled: !etatEcran.m36 });
    const depuis = h("input", { type: "date", id: id("depuis"), value: f.depuis || "", disabled: !etatEcran.m36 });
    const exemple = h("p", { class: "aide" });
    const montrerExemple = () => {
      const val = (k) => (champs[k] && champs[k].value) || FID_DEFAUT[k];
      const annee = aujourdhui().slice(0, 4);
      exemple.textContent = tr("Exemple de numéros, {facture} pour une facture et {avoir} pour un avoir.", { facture: formaterNumero("facture", annee, 1, val("prefixe_facture").trim()), avoir: formaterNumero("avoir", annee, 1, val("prefixe_avoir").trim()) });
    };
    const enregistrer = async (e) => {
      e.preventDefault();
      const lu = (k) => ((champs[k] && champs[k].value) || "").trim();
      const pf = lu("prefixe_facture") || FID_DEFAUT.prefixe_facture;
      const pa = lu("prefixe_avoir") || FID_DEFAUT.prefixe_avoir;
      if (![pf, pa].every((x) => /^[A-Za-z0-9-]{1,12}$/.test(x))) return toast(tr("Un préfixe ne contient que des lettres, des chiffres ou des tirets (12 au plus)."), true);
      if (pf.toUpperCase() === pa.toUpperCase()) return toast(tr("Les factures et les avoirs ont chacun leur préfixe."), true);
      const nouveau = { actif: caseActif.checked, depuis: depuis.value || "" };
      for (const k of Object.keys(FID_DEFAUT)) if (k !== "depuis") { const v = lu(k); if (v && v !== FID_DEFAUT[k]) nouveau[k] = v; }
      if (f.actif && !nouveau.actif && !(await confirmer(tr("Arrêter les factures pour la fiduciaire dans {entreprise} ? Plus aucune facture ne sera proposée ; celles déjà émises restent et se corrigent par un avoir.", { entreprise }), tr("Arrêter"), true))) return;
      if ((pf !== f.prefixe_facture || pa !== f.prefixe_avoir) && etatEcran.liste.length && !(await confirmer(tr("Changer de préfixe démarre une nouvelle série de numéros, à partir de 1. Les factures déjà émises gardent leur numéro. Continuer ?"), tr("Changer")))) return;
      try {
        await enregistrerReglages({ ...structuredClone(r), fiduciaire: nouveau });
        toast(tr("Réglages de la fiduciaire enregistrés."));
        etatEcran.reglagesOuverts = true;
        await agir(async () => null, null);
      } catch (err) {
        toast(err.message, true);
      }
    };
    const details = h(
      "details",
      { class: "fid-reglages", open: etatEcran.reglagesOuverts || undefined, ontoggle: (e) => { etatEcran.reglagesOuverts = e.target.open; } },
      h("summary", null, tr("Réglages des factures pour la fiduciaire")),
      h(
        "form",
        { class: "fid-reglages-corps", oninput: montrerExemple, onsubmit: enregistrer },
        etatEcran.m36 ? null : h("p", { class: "avertissement" }, tr("Ces réglages ne s'appliquent pas encore, la base attend sa mise à jour (migration 36).")),
        h("label", { class: "case", for: id("actif") }, caseActif, " ", tr("{entreprise} émet des factures pour la fiduciaire", { entreprise })),
        h("p", { class: "aide" }, tr("Case décochée, aucune facture n'est proposée dans cette entreprise. Ce qui a déjà été facturé reste ici et se corrige par un avoir.")),
        champ(tr("Date de départ"), depuis, tr("Un service reçu avant cette date et jamais facturé n'est pas proposé. Laissée vide, la date ne limite rien.")),
        h("div", { class: "fid-reglages-grille" }, texte("prefixe_facture"), texte("prefixe_avoir")),
        exemple,
        h("div", { class: "fid-reglages-grille" }, texte("titre_facture"), texte("titre_avoir"), texte("ref_facture"), texte("ref_avoir")),
        h("div", { class: "fid-reglages-grille" }, texte("mot_commission", tr("Pour un service payé sur place, la commission reçue du prestataire.")), texte("mot_marge", tr("Pour un service payé chez nous, la marge (prix de vente moins net payé)."))),
        h("p", { class: "aide" }, tr("L'émetteur est {nom}. Son identité, son compte bancaire et son QR code se règlent dans Réglages. Ils sont copiés sur chaque facture le jour de l'émission, les changer ensuite ne modifie pas les factures déjà émises.", { nom: (r.emetteur || {}).nom || entreprise })),
        h("p", { class: "aide" }, tr("Les textes de la facture sont en anglais, la fiduciaire les lit tels quels. Un champ vide reprend le texte par défaut.")),
        h("div", { class: "actions" }, h("button", { class: "principal", type: "submit", disabled: !etatEcran.m36 }, tr("Enregistrer")))
      )
    );
    montrerExemple();
    return details;
  }

  function rendre() {
    if (!etatEcran.choisies.size) document.documentElement.classList.remove("a-barre-action");
    const f = etatEcran.filtres;
    const visibles = filtrerFactures(etatEcran.liste, f);
    // Mook ne voit ni avoirs à émettre ni services à revoir : ce sont des décisions de responsable.
    const aPreparer = etatEcran.preparer.filter((l) => (l.type === "facture" || !simple) && !(simple && l.a_revoir && !l.type));
    const factures = aPreparer.filter((l) => l.type === "facture" && l.destinataire_nom && l.destinataire_adresse);
    const mois = [...new Set(etatEcran.liste.map((x) => String(x.date_facture).slice(0, 7)))].sort().reverse();
    const nomMois = (m) => { const [a, mm] = m.split("-"); return simple ? `${mm}/${a}` : `${formatDate(`${m}-01`).replace(/^\d+\s/, "")}`; };
    const choix = (id, libelle, options, valeur, onchange) => h("label", { class: "fid-filtre", for: id }, h("span", null, libelle), h("select", { id, onchange: (e) => onchange(e.target.value) }, options.map(([v, l]) => h("option", { value: v, selected: v === valeur }, l))));
    const actif = reglagesFid(reglages()).actif;
    // replaceChildren écrirait « null » : les blocs absents sont retirés.
    racine.replaceChildren(...[
      h("div", { class: "entete" }, h("div", null, h("h1", null, titre), h("p", { class: "sous" }, simple ? TH.intro.th : tr("Une facture par service, adressée à l'entreprise prestataire, pour la seule part qui revient à l'agence : la commission reçue, ou la marge quand le client a payé chez nous. Jamais ce que le client a payé en tout.")))),
      actif ? null : h("p", { class: "avertissement fid-inactif" }, t("inactif", tr("{entreprise} n'émet pas de factures pour la fiduciaire. Ce qui a déjà été facturé reste ici et se corrige par un avoir.", { entreprise: (entiteActive() || {}).nom || "" }))),
      // Entreprise inactive sans rien à corriger : pas de bloc « À préparer », dont le texte d'aide laisserait croire que des factures viendront.
      !actif && !aPreparer.length ? null : h(
        "section",
        { class: "fid-bloc", "aria-labelledby": "fid-titre-prep" },
        h("div", { class: "fid-bloc-tete" }, h("h2", { id: "fid-titre-prep" }, t("a_preparer", tr("À préparer")), aPreparer.length ? h("span", { class: "badge-compte" }, String(aPreparer.length)) : null), factures.length > 1 ? h("button", { class: "secondaire", type: "button", disabled: etatEcran.occupe, onclick: async () => { if (!(await confirmer(t("confirmer_tout", tr("Créer {n} factures ? Leurs numéros se suivent et une facture émise ne se supprime pas : une erreur se corrige par un avoir.", { n: factures.length }), { n: factures.length }), t("creer", tr("Créer la facture")), false, simple ? "✕" : tr("Annuler")))) return; agir(async () => { let n = 0; try { for (const l of factures) { await etat.store.fiduciaireEmettre(l.reservation_id, null, "facture"); n++; } } catch (err) { throw new Error(n ? `${err.message} (${tr("{n} facture(s) créée(s) avant l'erreur", { n })})` : err.message); } return n; }, (n) => t("creees", tr("{n} facture(s) créée(s).", { n }), { n })); } }, t("creer_tout", tr("Tout créer ({n})", { n: factures.length }), { n: factures.length })) : null),
        aPreparer.length ? [h("div", { class: "fid-liste" }, aPreparer.slice(0, etatEcran.nbPrep).map(carteAPreparer)), plus(aPreparer.length, etatEcran.nbPrep, () => { etatEcran.nbPrep += 24; rendre(); })] : vide(t("rien", tr("Rien à préparer pour le moment")), simple ? "" : tr("Une facture se prépare quand l'agence a reçu de l'argent sur un service : la commission du prestataire, ou la marge une fois le client et le prestataire payés."))
      ),
      h(
        "section",
        { class: "fid-bloc", "aria-labelledby": "fid-titre-emises" },
        h("div", { class: "fid-bloc-tete" }, h("h2", { id: "fid-titre-emises" }, t("emises", tr("Factures émises")))),
        h(
          "div",
          { class: "fid-filtres" },
          choix("fid-f-mois", t("mois", tr("Mois")), [["", t("tous_mois", tr("Tous les mois"))], ...mois.map((m) => [m, nomMois(m)])], f.mois, (v) => { f.mois = v; rendre(); }),
          choix("fid-f-envoi", t("envoi", tr("Envoi")), [["", t("toutes", tr("Toutes"))], ["non", t("non_envoyees", tr("Pas encore envoyées"))], ["oui", t("envoyees", tr("Envoyées"))]], f.envoyee, (v) => { f.envoyee = v; rendre(); })
        ),
        visibles.length
          ? [
              h("div", { class: "fid-selection" }, h("button", { class: "lien", type: "button", onclick: () => { for (const x of visibles.filter((y) => !y.envoyee_le)) etatEcran.choisies.add(x.id); rendre(); } }, t("choisir_non_envoyees", tr("Choisir toutes celles pas encore envoyées"))), etatEcran.choisies.size ? h("span", { class: "aide" }, t("choisies", tr("{n} facture(s) choisie(s)", { n: etatEcran.choisies.size }), { n: etatEcran.choisies.size })) : null),
              h("div", { class: "fid-liste" }, visibles.slice(0, etatEcran.nbEmises).map(carteFacture)),
              plus(visibles.length, etatEcran.nbEmises, () => { etatEcran.nbEmises += 60; rendre(); }),
              !etatEcran.choisies.size ? null : barreAction(
                h("button", { class: "principal", type: "button", disabled: !etatEcran.choisies.size, onclick: () => telecharger() }, t("telecharger", tr("Télécharger la sélection (PDF)"))),
                partageFichiers([new File([""], "a.pdf", { type: "application/pdf" })]) ? h("button", { class: "secondaire", type: "button", disabled: !etatEcran.choisies.size, onclick: () => telecharger({ partage: true }) }, t("partager", tr("Partager le PDF"))) : null,
                h("button", { class: "secondaire", type: "button", disabled: !etatEcran.choisies.size, onclick: marquerEnvoyees }, t("marquer", tr("Marquer envoyée à la fiduciaire")))
              ),
            ]
          : vide(t("aucune", tr("Aucune facture pour le moment")), simple ? "" : tr("Les factures créées apparaissent ici, à télécharger et à marquer comme envoyées."))
      ),
      blocReglages(),
    ].filter(Boolean));
  }

  let pret;
  try {
    pret = await charger();
  } catch (err) {
    racine.append(vide(titre, err.message));
    return racine;
  }
  if (!pret) {
    racine.append(h("div", { class: "entete" }, h("h1", null, titre)), vide(t("pas_prete", tr("Cette fonction n'est pas encore prête")), simple ? "" : tr("La migration 28 de la base n'est pas appliquée. Voir docs/gestion/migration-28-fiduciaire.sql.")));
    return racine;
  }
  rendre();
  return racine;
}
