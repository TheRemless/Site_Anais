// Réglages de l'entreprise active : tout ce qui apparaît sur les documents et le fonctionnement des dossiers.
import { etat, enregistrerReglages, recharger, resumes, resumeDossier, nomClient, naviguer, reglages, estAdmin, entiteActive, estSuperAdmin, peut, tousPaiements, tousDocuments } from "../etat.mjs";
import { h, champ, confirmer, toast, num, chargerImage, slug } from "../ui.mjs";
import { aujourdhui, formatDate, STATUTS } from "../calc.mjs";
import { LIBELLES_FR, LIBELLES_EN, CONTENU_DEFAUT, nouvelleLigne } from "../defauts.mjs";
import { renderDocument } from "../document.mjs";
import { telecharger, vide, apercuA4 } from "./commun.mjs";

// Les tables des partenaires font partie de la sauvegarde et de l'import (nets compris pour qui a le droit de les lire).
const TABLES = ["clients", "dossiers", "documents", "paiements", "catalogue", "partenaires", "partenaires_prives", "prestations", "prestations_nets", "trajets", "trajets_nets", "reservations", "reservations_nets", "taches"];

// ---- Exports et sauvegardes (limités à l'entreprise active) -------------------------------------------------
function csv(lignes) {
  // Une cellule qui commence par = + - @ serait lue comme une formule par Excel.
  const cellule = (v) => {
    const texte = String(v ?? "");
    return `"${(typeof v === "string" && /^[=+\-@]/.test(texte) ? `'${texte}` : texte).replaceAll('"', '""')}"`;
  };
  return "﻿" + lignes.map((l) => l.map(cellule).join(";")).join("\r\n");
}

const nomFichierEntite = (base, ext) => `${base}-${entiteActive().slug}-${aujourdhui()}.${ext}`;

function exporterDossiers() {
  const lignes = [["Référence", "Client", "Intitulé", "Statut", "Total", "Reçu", "Reste", "Devise", "Créé le", "Accepté le", "Début", "Fin"]];
  for (const r of resumes()) {
    lignes.push([r.dossier.ref, nomClient(r.client), r.dossier.pays, STATUTS[r.statut], r.total, r.recu, r.reste, r.devise || reglages().devise, formatDate(r.dossier.created_at), formatDate(r.dossier.accepte_le), formatDate(r.dossier.date_depart), formatDate(r.dossier.date_retour)]);
  }
  telecharger(nomFichierEntite("dossiers", "csv"), csv(lignes), "text/csv;charset=utf-8");
}

async function exporterPaiements() {
  const paiements = await tousPaiements();
  const lignes = [["Date", "Référence", "Client", "Type", "Moyen", "Montant", "Devise", "Montant d'origine", "Devise d'origine", "Note"]];
  for (const p of paiements) {
    const d = etat.db.dossiers.find((x) => x.id === p.dossier_id);
    const c = d && etat.db.clients.find((x) => x.id === d.client_id);
    lignes.push([formatDate(p.date), d ? d.ref : "", nomClient(c), p.type, p.moyen, p.montant, ((d && resumeDossier(d.id)) || {}).devise || reglages().devise, p.origine_montant ?? "", p.origine_devise, p.note]);
  }
  telecharger(nomFichierEntite("paiements", "csv"), csv(lignes), "text/csv;charset=utf-8");
}

async function exporterTout() {
  const sauvegarde = { version: 2, entreprise: entiteActive().slug, exporte_le: new Date().toISOString() };
  for (const t of TABLES) sauvegarde[t] = etat.db[t];
  // Documents et paiements ne sont pas en mémoire : on les lit dans la base.
  sauvegarde.documents = await tousDocuments();
  sauvegarde.paiements = await tousPaiements();
  telecharger(nomFichierEntite("sauvegarde", "json"), JSON.stringify(sauvegarde, null, 2), "application/json");
  toast("Sauvegarde téléchargée. Gardez ce fichier en lieu sûr : il contient les données clients.");
}

async function importer(fichier) {
  let data;
  try {
    data = JSON.parse(await fichier.text());
  } catch {
    toast("Ce fichier n'est pas une sauvegarde valide.", true);
    return;
  }
  if (!data || !TABLES.every((t) => data[t] === undefined || Array.isArray(data[t]))) {
    toast("Ce fichier n'a pas le format d'une sauvegarde.", true);
    return;
  }
  const resume = TABLES.map((t) => `${(data[t] || []).length} ${t}`).join(", ");
  if (!(await confirmer(`Importer ${resume} dans l'entreprise « ${entiteActive().nom} » ? Les éléments qui ont le même identifiant seront remplacés, les autres sont conservés.`, "Importer"))) return;
  try {
    const rows = {};
    for (const t of TABLES) rows[t] = (data[t] || []).map((r) => ({ ...r, entite_id: etat.entiteId }));
    await etat.store.importer(rows);
    await recharger();
    toast("Import terminé.");
    naviguer("#/dossiers");
  } catch (err) {
    toast(`Import impossible : ${err.message}`, true);
  }
}

// ---- Page de réglages ---------------------------------------------------------------------------------------
const LIBELLES = [
  ["devis", "Titre du devis"],
  ["facture", "Titre de la facture"],
  ["facture_locale", "Titre de la facture locale (vide : comme la facture)"],
  ["ref_devis", "Début de la référence (devis)"],
  ["ref_facture", "Début de la référence (facture)"],
  ["date_emission", "Libellé de la date"],
  ["unite", "Colonne du prix unitaire"],
  ["qte", "Colonne de la quantité"],
  ["total", "Total"],
  ["colonne_montant", "Colonne des montants (vide : comme le total)"],
  ["total_final", "Barre du total final (vide : comme le total)"],
  ["sous_total", "Sous-total"],
  ["remise", "Remise"],
  ["montant_recu", "Montant reçu"],
  ["equivalent", "Début de la ligne d'équivalent indicatif"],
  ["conditions", "Titre des conditions de paiement"],
  ["signature_1", "Signature du client, première ligne (devis)"],
  ["signature_2", "Signature du client, seconde ligne"],
  ["coordonnees", "Titre du bloc de contact (pied de page)"],
  ["infos_paiement", "Titre du bloc de paiement (pied de page)"],
  ["pied_court", "Message de paiement du pied de page court"],
  ["qr_titre", "Titre au-dessus du QR code"],
  ["facture_a", "Étiquette au-dessus du client (vide : aucune)"],
  ["prestataire", "Étiquette du prestataire du service"],
  ["note_devise", "Ligne sous le total (ex. Currency: {devise} ({devise_nom}))"],
  ["pied_note", "Note en bas de page, sous les coordonnées"],
];
// Textes que « Remplir en français / en anglais » ne doit pas écraser : ils sont propres à l'entreprise.
const LIBELLES_PROPRES = ["qr_titre", "facture_locale", "facture_a", "note_devise", "pied_note"];
const garder = (libelles) => Object.fromEntries(LIBELLES_PROPRES.map((k) => [k, libelles[k]]));

const lire = (o, chemin) => chemin.split(".").reduce((a, k) => (a ? a[k] : undefined), o);
function ecrire(o, chemin, v) {
  const ks = chemin.split(".");
  const dernier = ks.pop();
  ks.reduce((a, k) => a[k], o)[dernier] = v;
}

export function vueReglages() {
  if (!estAdmin()) return vide("Accès réservé", "Les réglages d'une entreprise sont réservés à ses administrateurs.", h("a", { class: "bouton secondaire", href: "#/" }, "Retour au tableau de bord"));
  const r = structuredClone(reglages());
  let modifie = false;
  const indicateur = h("span", { class: "etat-enregistrement", role: "status" }, "");
  const marque = () => {
    modifie = true;
    indicateur.textContent = "Modifications non enregistrées";
    redessinerApercu();
  };
  window.addEventListener("hashchange", () => (modifie = false), { once: true });
  window.addEventListener("beforeunload", (e) => modifie && e.preventDefault());

  // Champs liés à un chemin des réglages
  let compteur = 0;
  const uid = () => `rg${++compteur}`;
  const texte = (libelle, chemin, { aide, type = "text", multi = false, rows = 3, placeholder, step } = {}) => {
    const id = uid();
    const el = multi ? h("textarea", { id, rows, placeholder }) : h("input", { id, type, step, placeholder });
    el.value = lire(r, chemin) ?? "";
    el.addEventListener("input", () => {
      ecrire(r, chemin, type === "number" ? num(el.value) ?? 0 : el.value);
      marque();
    });
    return champ(libelle, el, aide);
  };
  const liste = (libelle, chemin, aide) => {
    const el = h("textarea", { id: uid(), rows: 4 });
    el.value = lire(r, chemin).join("\n");
    el.addEventListener("input", () => {
      ecrire(r, chemin, el.value.split("\n").map((x) => x.trim()).filter(Boolean));
      marque();
    });
    return champ(libelle, el, aide);
  };
  const image = (libelle, chemin, { maxPx = 800, aide } = {}) => {
    const apercu = h("div", { class: "vignette" });
    const info = h("p", { class: "aide" });
    const maj = () => {
      const v = lire(r, chemin);
      apercu.replaceChildren(v ? h("img", { src: v, alt: "" }) : h("span", { class: "aide" }, "Aucune image"));
      retirer.hidden = !v;
    };
    const retirer = h(
      "button",
      {
        class: "lien danger-texte",
        type: "button",
        onclick: () => {
          ecrire(r, chemin, "");
          maj();
          marque();
        },
      },
      "Retirer l'image"
    );
    const id = uid();
    const fichier = h("input", {
      id,
      type: "file",
      accept: "image/*",
      onchange: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          ecrire(r, chemin, await chargerImage(f, maxPx));
          info.textContent = "";
          maj();
          marque();
        } catch (err) {
          info.textContent = err.message;
        }
        e.target.value = "";
      },
    });
    maj();
    return h("div", { class: "champ" }, h("label", { for: id }, libelle), apercu, fichier, retirer, info, aide ? h("p", { class: "aide" }, aide) : null);
  };

  // Aperçu d'un document d'exemple avec les réglages en cours de saisie
  const exemple = () => {
    const modele = r.dossier.modele_bandeau.replace("{PAYS}", (r.listes.pays[0] || "").toUpperCase()).replace("{PERIODE}", "DU 2 AU 12 DÉCEMBRE").replace(/^[\s-]+|[\s-]+$/g, "");
    const doc = {
      date_emission: aujourdhui(),
      contenu: {
        ...CONTENU_DEFAUT(),
        bandeau: modele || "Titre du document",
        colonnes: "detail",
        variante: (r.textes.variantes[0] || {}).id || "",
        lignes: [nouvelleLigne("bloc", { libelle: "Prestation d'exemple", intro: "comprenant:", puces: ["premier détail", "second détail"], unite: 100, qte: 2 }), nouvelleLigne("ligne", { libelle: "Supplément d'exemple", montant: 50 }), nouvelleLigne("remise", { libelle: "exemple", pct: 10 })],
      },
    };
    return renderDocument({ type: "devis", doc, dossier: { ref: "EXEMPLE-0001" }, client: { civilite: r.listes.civilites[0] || "", prenom: "Prénom", nom: "Nom", adresse: "1 rue de l'Exemple\n00000 Ville", telephone: "+00 00 000 00 00" }, reglages: r, recu: 0 });
  };
  const { zone: zoneApercu, redessiner } = apercuA4(exemple);
  let minuteur = null;
  const redessinerApercu = () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(redessiner, 200);
  };

  // Variantes de conditions de paiement
  const blocVariantes = h("div");
  const dessinerVariantes = () => {
    blocVariantes.replaceChildren(
      ...r.textes.variantes.map((v, i) => {
        const nom = h("input", { id: `v${i}-nom`, value: v.nom, oninput: (e) => ((v.nom = e.target.value), marque()) });
        const corps = h("textarea", { id: `v${i}-corps`, rows: 8, oninput: (e) => ((v.corps = e.target.value), marque()) });
        corps.value = v.corps;
        const cloture = h("textarea", { id: `v${i}-clo`, rows: 3, oninput: (e) => ((v.cloture = e.target.value), marque()) });
        cloture.value = v.cloture;
        const corpsEn = h("textarea", { id: `v${i}-corps-en`, rows: 6, oninput: (e) => ((v.corps_en = e.target.value), marque()) });
        corpsEn.value = v.corps_en || "";
        const clotureEn = h("textarea", { id: `v${i}-clo-en`, rows: 3, oninput: (e) => ((v.cloture_en = e.target.value), marque()) });
        clotureEn.value = v.cloture_en || "";
        return h(
          "div",
          { class: "carte-ligne" },
          h("div", { class: "carte-ligne-tete" }, h("strong", null, `Variante ${i + 1}`), h("span", { class: "outils" }, r.textes.variantes.length > 1 ? h("button", { class: "lien danger-texte", type: "button", onclick: () => (r.textes.variantes.splice(i, 1), dessinerVariantes(), marque()) }, "Supprimer") : null)),
          champ("Nom (visible dans la liste du devis)", nom),
          champ("Conditions de paiement", corps),
          champ("Fin du texte", cloture),
          champ("Conditions de paiement en anglais (facultatif)", corpsEn, "Utilisées quand le document est écrit en anglais. Vide : le texte ci-dessus est repris."),
          champ("Fin du texte en anglais (facultatif)", clotureEn)
        );
      }),
      h("button", { class: "secondaire petit", type: "button", onclick: () => (r.textes.variantes.push({ id: `v-${Date.now().toString(36)}`, nom: "Nouvelle variante", corps: "", cloture: "" }), dessinerVariantes(), marque()) }, "Ajouter une variante")
    );
  };
  dessinerVariantes();

  // Autres informations de paiement (par exemple la banque thaïlandaise pour une facture en bahts). Chaque document choisit les siennes.
  const blocAutres = h("div");
  const dessinerAutres = () => {
    blocAutres.replaceChildren(
      ...r.paiement.autres.map((m, i) =>
        h(
          "div",
          { class: "carte-ligne" },
          h("div", { class: "carte-ligne-tete" }, h("strong", null, m.nom || `Informations ${i + 2}`), h("span", { class: "outils" }, h("button", { class: "lien danger-texte", type: "button", onclick: () => (r.paiement.autres.splice(i, 1), dessinerAutres(), marque()) }, "Supprimer"))),
          texte("Nom (visible dans la liste du document)", `paiement.autres.${i}.nom`, { placeholder: "Par exemple : Banque thaïlandaise (THB)" }),
          texte("Informations de paiement du pied de page", `paiement.autres.${i}.texte`, { multi: true, rows: 5, aide: "Une ligne par information. **gras** possible." }),
          image("QR code (facultatif)", `paiement.autres.${i}.qr_image`, { maxPx: 700 }),
          texte("Texte à côté du QR code", `paiement.autres.${i}.qr_pseudo`)
        )
      ),
      h("button", { class: "secondaire petit", type: "button", onclick: () => (r.paiement.autres.push({ id: `p-${Date.now().toString(36)}`, nom: "", texte: "", qr_image: "", qr_pseudo: "" }), dessinerAutres(), marque()) }, "Ajouter d'autres informations de paiement")
    );
  };
  dessinerAutres();

  const entete = h("select", { id: uid(), onchange: (e) => ((r.apparence.entete = e.target.value), marque()) }, h("option", { value: "classique" }, "Classique : logo à droite, titre en grand"), h("option", { value: "centre" }, "Centrée : logo et titre du document au centre"));
  entete.value = r.apparence.entete;

  const moyens = h("textarea", { id: uid(), rows: 5 });
  moyens.value = r.listes.moyens.map((m) => m.label).join("\n");
  moyens.addEventListener("input", () => {
    const anciens = new Map(r.listes.moyens.map((m) => [m.label.toLowerCase(), m.id]));
    const lignes = moyens.value.split("\n").map((x) => x.trim()).filter(Boolean);
    r.listes.moyens = lignes.map((label) => ({ id: anciens.get(label.toLowerCase()) || slug(label) || "autre", label }));
    marque();
  });

  const modeNum = h("select", { id: uid(), onchange: (e) => ((r.numerotation.mode = e.target.value), (prefixe.hidden = chiffres.hidden = e.target.value !== "sequence"), marque()) }, h("option", { value: "sequence" }, "Numéro de séquence par année (ex. ST-2026-0001)"), h("option", { value: "initiales" }, "Initiales, date et pays (ex. LD20261009 Thaïlande)"));
  modeNum.value = r.numerotation.mode;
  const prefixe = texte("Préfixe des numéros", "numerotation.prefixe", { aide: "Par exemple ST pour obtenir ST-2026-0001. Peut rester vide." });
  prefixe.hidden = r.numerotation.mode !== "sequence";
  const chiffres = texte("Nombre de chiffres du numéro", "numerotation.chiffres", { type: "number", aide: "4 donne ST-2026-0001, 3 donne ST-2026-001." });
  chiffres.hidden = r.numerotation.mode !== "sequence";

  const libellesGrille = h("div", { class: "grille-form" });
  // Les mêmes textes existent en deux versions : ceux de la langue principale et ceux des documents en anglais.
  let langueTextes = "principale";
  const cibleTextes = () => (langueTextes === "en" ? r.libelles_en : r.libelles);
  const dessinerLibelles = () => {
    const cible = cibleTextes();
    libellesGrille.replaceChildren(
      ...LIBELLES.map(([cle, nom]) => {
        const el = h("input", { id: `lb-${cle}`, value: cible[cle] ?? "", oninput: (e) => ((cible[cle] = e.target.value), marque()) });
        return champ(nom, el);
      })
    );
    const cgv = h("textarea", { id: "lb-cgv", rows: 4, oninput: (e) => ((cible.cgv = e.target.value), marque()) });
    cgv.value = cible.cgv ?? "";
    libellesGrille.append(h("div", { class: "pleine-largeur" }, champ("Phrase sur les conditions générales", cgv, "Laissez vide pour ne pas l'afficher. [texte](lien) crée un lien. {cgv_url} et {entreprise} se remplissent seuls.")));
  };
  const remplirTextes = (base) => {
    const cle = langueTextes === "en" ? "libelles_en" : "libelles";
    r[cle] = { ...r[cle], ...base, ...garder(r[cle]) };
    dessinerLibelles();
    marque();
  };
  const choixLangue = h(
    "select",
    { id: "lb-langue", "aria-label": "Langue des textes à modifier", onchange: (e) => ((langueTextes = e.target.value), dessinerLibelles()) },
    h("option", { value: "principale" }, "Textes de la langue principale (documents habituels)"),
    h("option", { value: "en" }, "Textes des documents en anglais")
  );
  dessinerLibelles();

  const sections = {
    entreprise: h(
      "div",
      null,
      h("fieldset", null, h("legend", null, "Identité sur les documents"), texte("Nom de l'entreprise", "emetteur.nom"), texte("Sous-titre sous le nom (facultatif)", "emetteur.sous_titre", { aide: "Par exemple « by Nom de la société mère »." }), texte("Adresse", "emetteur.adresse", { multi: true, rows: 3 }), texte("Téléphone affiché sous l'adresse", "emetteur.telephone")),
      h("fieldset", null, h("legend", null, "Bloc de contact du pied de page"), texte("Une ligne par information", "emetteur.contact", { multi: true, rows: 4, aide: "Nom de la personne, WhatsApp, e-mail, site… Ce que vous voulez voir en bas de chaque document." }))
    ),
    paiement: h(
      "div",
      null,
      h("fieldset", null, h("legend", null, "Devise et paiement"), texte("Devise des montants", "devise", { aide: "Code court affiché devant les montants, par exemple CHF, THB ou EUR. Changer la devise ne convertit pas les montants déjà saisis." }), texte("Informations de paiement du pied de page", "paiement.texte", { multi: true, rows: 5, aide: "Une ligne par information : banque, IBAN, titulaire… Ce texte s'affiche tel quel sur les documents." }), texte("Nom de ces informations (liste du document)", "paiement.nom", { placeholder: "Principal" })),
      h("fieldset", null, h("legend", null, "Autres informations de paiement"), h("p", { class: "aide" }, "Utile quand certains documents se paient ailleurs, par exemple une facture locale en bahts avec une banque thaïlandaise. Chaque devis ou facture choisit les informations à afficher."), blocAutres),
      h("fieldset", null, h("legend", null, "QR code de paiement"), image("Image du QR code", "apparence.qr_image", { maxPx: 700 }), texte("Texte à côté du QR code", "apparence.qr_pseudo", { aide: "Par exemple un pseudo Wise. Vide pour ne rien afficher." })),
      h("fieldset", null, h("legend", null, "Équivalents indicatifs"), h("p", { class: "aide" }, "Utilisés seulement quand vous affichez l'équivalent en euros et en bahts sur un devis. À mettre à jour de temps en temps."), h("div", { class: "grille-form" }, texte("1 unité de la devise en euros", "taux.eur", { type: "number", step: "0.001" }), texte("1 unité de la devise en bahts", "taux.thb", { type: "number", step: "0.01" })))
    ),
    fonctionnement: h(
      "div",
      null,
      h("fieldset", null, h("legend", null, "Conditions"), h("div", { class: "grille-form" }, texte("Acompte demandé (%, 0 si aucun)", "conditions.acompte_pct", { type: "number" }), texte("Délai de paiement de l'acompte (jours)", "conditions.delai_jours", { type: "number" }), texte("Relancer un devis sans réponse après (jours)", "conditions.relance_jours", { type: "number" })), texte("Mention de TVA", "conditions.tva_mention", { aide: "Par exemple « TVA non applicable ». Vide pour ne rien afficher." }), texte("Mention de TVA en anglais (facultatif)", "conditions.tva_mention_en", { aide: "Pour les documents écrits en anglais. Vide : la mention ci-dessus est reprise." }), texte("Lien des conditions générales", "conditions.cgv_url", { type: "url" })),
      h("fieldset", null, h("legend", null, "Dossiers"), champ("Numérotation", modeNum), prefixe, chiffres, texte("Nom du champ « pays »", "dossier.libelle_pays", { aide: "Par exemple Pays, Service ou Trajet. C'est la liste proposée à la création d'un dossier." }), liste("Valeurs proposées, une par ligne", "listes.pays"), texte("Modèle du titre du document", "dossier.modele_bandeau", { aide: "{PAYS} et {PERIODE} se remplissent avec le dossier. Exemple : VOYAGE EN {PAYS} - {PERIODE}." })),
      h("fieldset", null, h("legend", null, "Listes"), liste("Civilités des clients, une par ligne", "listes.civilites"), liste("Devises proposées pour un document, une par ligne", "listes.devises", "Codes courts comme CHF, EUR, THB, USD. Servent aussi pour les équivalents indicatifs."), champ("Moyens de paiement, un par ligne", moyens))
    ),
    textes: h(
      "div",
      null,
      h("fieldset", null, h("legend", null, "Textes fixes des documents"), h("div", { class: "actions gauche" }, h("button", { class: "secondaire petit", type: "button", onclick: () => remplirTextes(LIBELLES_FR) }, "Remplir en français"), h("button", { class: "secondaire petit", type: "button", onclick: () => remplirTextes(LIBELLES_EN) }, "Remplir en anglais")), champ("Langue des textes à modifier", choixLangue, "Un document peut être écrit en anglais depuis son en-tête (par exemple la facture locale). Il utilise alors la version anglaise de ces textes."), libellesGrille),
      h("fieldset", null, h("legend", null, "Conditions de paiement proposées"), h("p", { class: "aide" }, "Chaque devis choisit une de ces variantes, ou son propre texte. Une ligne commençant par « - » devient une puce. **gras**, _italique_. Les mots entre accolades se remplissent seuls : {acompte}, {solde}, {delai}, {total}, {indicatif}."), blocVariantes)
    ),
    apparence: h(
      "div",
      null,
      h("fieldset", null, h("legend", null, "Logo et titre"), champ("Disposition de l'en-tête", entete), image("Logo", "apparence.logo", { maxPx: 600 }), texte("Titre en grand sur le document", "apparence.titre_texte", { aide: "Le nom de l'entreprise si vide. Ignoré quand une image de titre est choisie." }), image("Image du titre (facultative)", "apparence.titre_image", { maxPx: 1600, aide: "Pour un lettrage particulier. Elle remplace le titre écrit." })),
      h(
        "fieldset",
        null,
        h("legend", null, "Couleurs"),
        h(
          "div",
          { class: "grille-form" },
          ...[["Couleur principale (barre de total, titres)", "apparence.couleur"], ["Couleur claire (bandeau)", "apparence.couleur_clair"]].map(([libelle, chemin]) => {
            const el = h("input", { id: uid(), type: "color", value: lire(r, chemin), oninput: (e) => (ecrire(r, chemin, e.target.value), marque()) });
            el.className = "couleur";
            return champ(libelle, el);
          })
        )
      ),
      r.apparence.type_images ? h("fieldset", null, h("legend", null, "Titres en images"), h("p", { class: "aide" }, "Les mots DEVIS et FACTURE sont des images. Retirez-les pour les remplacer par les textes de l'onglet « Textes »."), h("button", { class: "secondaire petit", type: "button", onclick: (e) => ((r.apparence.type_images = null), e.target.closest("fieldset").remove(), marque()) }, "Utiliser des textes à la place")) : null
    ),
    donnees: h(
      "div",
      null,
      h(
        "section",
        null,
        h("h2", null, "Sauvegarde et exports"),
        h("p", { class: "aide" }, `Ces fichiers concernent seulement l'entreprise « ${entiteActive().nom} ». Une sauvegarde contient les données clients : gardez-la en lieu sûr.`),
        h("div", { class: "actions gauche" }, h("button", { class: "secondaire", type: "button", onclick: exporterTout }, "Télécharger une sauvegarde complète"), h("button", { class: "secondaire", type: "button", onclick: exporterDossiers }, "Exporter les dossiers (Excel)"), h("button", { class: "secondaire", type: "button", onclick: exporterPaiements }, "Exporter les paiements (Excel)")),
        champ("Restaurer ou importer une sauvegarde", h("input", { id: "import-fichier", type: "file", accept: "application/json,.json", onchange: (e) => e.target.files[0] && importer(e.target.files[0]) }), `Elle sera importée dans « ${entiteActive().nom} ». Les éléments déjà présents avec le même identifiant sont remplacés.`)
      )
    ),
  };

  const ONGLETS = [
    ["entreprise", "Entreprise"],
    ["paiement", "Paiement"],
    ["fonctionnement", "Dossiers et listes"],
    ["textes", "Textes des documents"],
    ["apparence", "Apparence"],
    ...(peut("exports.faire") ? [["donnees", "Sauvegarde"]] : []),
  ];
  const barre = h("div", { class: "onglets sous-onglets" });
  const montrer = (cle) => {
    for (const [k, el] of Object.entries(sections)) el.hidden = k !== cle;
    for (const b of barre.children) b.setAttribute("aria-pressed", b.dataset.cle === cle ? "true" : "false");
    zoneApercu.hidden = cle === "donnees";
    boutonEnregistrer.hidden = cle === "donnees";
    if (cle !== "donnees") redessiner();
  };
  ONGLETS.forEach(([cle, libelle]) => barre.append(h("button", { type: "button", "data-cle": cle, "aria-pressed": "false", onclick: () => montrer(cle) }, libelle)));

  const boutonEnregistrer = h("button", { class: "principal", type: "submit" }, "Enregistrer les réglages");
  const enregistrer = async (e) => {
    e.preventDefault();
    if (!r.textes.variantes.length) return toast("Gardez au moins une variante de conditions de paiement.", true);
    r.devise = (r.devise || "").trim().toUpperCase();
    boutonEnregistrer.disabled = true;
    try {
      await enregistrerReglages(r);
      modifie = false;
      indicateur.textContent = "Enregistré";
      toast("Réglages enregistrés.");
    } catch (err) {
      toast(`Enregistrement impossible : ${err.message}`, true);
    } finally {
      boutonEnregistrer.disabled = false;
    }
  };

  const racine = h(
    "div",
    { "data-titre": "Réglages", "data-large": "1", "data-plein": "1" },
    h("div", { class: "entete" }, h("div", null, h("h1", null, "Réglages"), h("p", { class: "sous" }, entiteActive().nom)), estSuperAdmin() ? h("a", { class: "bouton secondaire", href: "#/admin" }, "Administration : entreprises et accès") : null),
    barre,
    h("form", { class: "reglages-grille", onsubmit: enregistrer }, h("div", { class: "reglages-colonne" }, ...Object.values(sections), h("div", { class: "actions barre-fixe" }, indicateur, boutonEnregistrer)), zoneApercu)
  );
  montrer("entreprise");
  return racine;
}
