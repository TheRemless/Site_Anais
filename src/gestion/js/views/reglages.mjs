// Réglages de l'entreprise active : tout ce qui apparaît sur les documents et le fonctionnement des dossiers.
import { etat, enregistrerReglages, corbeilleDossiers, restaurerDossier, recharger, resumes, resumeDossier, nomClient, naviguer, reglages, estAdmin, entiteActive, estSuperAdmin, peut, tousPaiements, tousDocuments, toutesTaches } from "../etat.mjs";
import { voucherExemple } from "./voucher.mjs";
import { h, champ, confirmer, toast, num, chargerImage, slug } from "../ui.mjs";
import { aujourdhui, formatDate, STATUTS } from "../calc.mjs";
import { LIBELLES_FR, LIBELLES_EN, CGV_FACTURE, CONTENU_DEFAUT, nouvelleLigne } from "../defauts.mjs";
import { renderDocument } from "../document.mjs";
import { telecharger, vide, apercuA4, plierGroupes } from "./commun.mjs";
import { tr, N_, localeActive } from "../i18n.mjs";
import { etatRappels } from "../rappels-etat.mjs";
import { VERSION_SAUVEGARDE, pourSauvegarde, verifierSauvegarde, absentsDeLaSauvegarde, reservationsPerdantLeurPrestataire } from "../sauvegarde.mjs";

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
  const lignes = [[tr("Référence"), tr("Client"), tr("Intitulé"), tr("Statut"), tr("Total"), tr("Reçu"), tr("Reste"), tr("Devise"), tr("Créé le"), tr("Accepté le"), tr("Début"), tr("Fin")]];
  for (const r of resumes()) {
    lignes.push([r.dossier.ref, nomClient(r.client), r.dossier.pays, STATUTS[r.statut], r.total, r.recu, r.reste, r.devise || reglages().devise, formatDate(r.dossier.created_at), formatDate(r.dossier.accepte_le), formatDate(r.dossier.date_depart), formatDate(r.dossier.date_retour)]);
  }
  telecharger(nomFichierEntite("dossiers", "csv"), csv(lignes), "text/csv;charset=utf-8");
}

async function exporterPaiements() {
  const paiements = await tousPaiements();
  const lignes = [[tr("Date"), tr("Référence"), tr("Client"), tr("Type"), tr("Moyen"), tr("Montant"), tr("Devise"), tr("Montant d'origine"), tr("Devise d'origine"), tr("Note")]];
  for (const p of paiements) {
    const d = etat.db.dossiers.find((x) => x.id === p.dossier_id);
    const c = d && etat.db.clients.find((x) => x.id === d.client_id);
    lignes.push([formatDate(p.date), d ? d.ref : "", nomClient(c), p.type, p.moyen, p.montant, ((d && resumeDossier(d.id)) || {}).devise || reglages().devise, p.origine_montant ?? "", p.origine_devise, p.note]);
  }
  telecharger(nomFichierEntite("paiements", "csv"), csv(lignes), "text/csv;charset=utf-8");
}

async function exporterTout() {
  const sauvegarde = { version: VERSION_SAUVEGARDE, entreprise: entiteActive().slug, exporte_le: new Date().toISOString() };
  for (const t of TABLES) sauvegarde[t] = pourSauvegarde(t, etat.db[t]);
  // Les réglages de l'entreprise (textes des documents, coordonnées de paiement, numérotation) font partie de la sauvegarde.
  if (peut("reglages.ecrire")) sauvegarde.reglages = reglages();
  // Documents et paiements ne sont pas en mémoire : on les lit dans la base.
  sauvegarde.documents = await tousDocuments();
  sauvegarde.paiements = await tousPaiements();
  // Toutes les tâches, pas seulement celles gardées en mémoire (les terminées depuis plus d'un mois n'y sont pas).
  sauvegarde.taches = pourSauvegarde("taches", await toutesTaches());
  telecharger(nomFichierEntite("sauvegarde", "json"), JSON.stringify(sauvegarde, null, 2), "application/json");
  toast(tr("Sauvegarde téléchargée. Gardez ce fichier en lieu sûr : il contient les données clients. Les fichiers joints n'y sont pas."));
}

async function importer(fichier) {
  let data;
  try {
    data = JSON.parse(await fichier.text());
  } catch {
    toast(tr("Ce fichier n'est pas une sauvegarde valide."), true);
    return;
  }
  const verif = verifierSauvegarde(data, entiteActive().slug);
  if (!verif.ok) {
    toast(verif.erreur === "autre_entreprise" ? tr("Cette sauvegarde est celle de l'entreprise « {autre} » : elle ne peut pas être importée dans « {nom} ».", { autre: verif.entreprise, nom: entiteActive().nom }) : tr("Ce fichier n'a pas le format d'une sauvegarde."), true);
    return;
  }
  const resume = TABLES.map((t) => `${(data[t] || []).length} ${t}`).join(", ");
  const remplace = !!(data.partenaires && data.partenaires.length) && document.getElementById("import-remplacer") && document.getElementById("import-remplacer").checked;
  // Remplacer : on importe d'abord, puis on retire seulement ce que le fichier ne contient plus. On dit combien de réservations perdraient leur lien.
  const absents = remplace ? absentsDeLaSauvegarde({ partenaires: etat.db.partenaires, prestations: etat.db.prestations, trajets: etat.db.trajets }, data) : null;
  const perdent = remplace ? reservationsPerdantLeurPrestataire(etat.db.reservations, absents).length : 0;
  const phrase = remplace
    ? tr(" Ce que le fichier ne contient plus sera supprimé après l'import : {p} partenaires, {s} tarifs et {t} trajets (avec leurs nets). {r} réservations perdraient le lien avec leur prestataire ou leur tarif.", { p: absents.partenaires.length, s: absents.prestations.length, t: absents.trajets.length, r: perdent })
    : tr(" Les éléments qui ont le même identifiant seront remplacés, les autres sont conservés.");
  if (!(await confirmer(tr("Importer {resume} dans l'entreprise « {nom} » ?", { resume, nom: entiteActive().nom }) + phrase, tr("Importer"), !!perdent))) return;
  try {
    const rows = {};
    // Les tables de nets n'ont pas de date de création : une sauvegarde ou un import plus ancien peut en porter une.
    const SANS_DATE = ["partenaires_prives", "prestations_nets", "trajets_nets", "reservations_nets"];
    for (const t of TABLES) rows[t] = pourSauvegarde(t, data[t]).map(({ created_at, ...r }) => ({ ...r, ...(SANS_DATE.includes(t) ? {} : { created_at }), entite_id: etat.entiteId }));
    await etat.store.importer(rows);
    // L'import a réussi : seulement maintenant on retire ce que le fichier ne contient plus. Une erreur plus haut n'a rien supprimé.
    if (remplace) await etat.store.supprimerAbsents(etat.entiteId, absents);
    const caseReglages = document.getElementById("import-reglages");
    if (data.reglages && caseReglages && caseReglages.checked) await enregistrerReglages(data.reglages);
    await recharger();
    toast(tr("Import terminé."));
    naviguer("#/dossiers");
  } catch (err) {
    toast(tr("Import impossible : {message}", { message: err.message }), true);
  }
}

// ---- Corbeille des dossiers supprimés ------------------------------------------------------------------------
// Un dossier supprimé reste récupérable 90 jours (migration 15) avec ses documents, paiements, réservations et tâches.
function sectionCorbeille() {
  const liste = h("div", null, h("p", { class: "aide" }, tr("Chargement…")));
  const dessiner = async () => {
    let lignes;
    try {
      lignes = await corbeilleDossiers();
    } catch (err) {
      liste.replaceChildren(h("p", { class: "aide" }, tr("Corbeille indisponible : {message}", { message: err.message })));
      return;
    }
    if (!lignes.length) return liste.replaceChildren(h("p", { class: "vide-court" }, tr("Aucun dossier supprimé ces 90 derniers jours.")));
    liste.replaceChildren(
      h(
        "ul",
        { class: "cartes" },
        lignes.map((x) => {
          const client = etat.db.clients.find((c) => c.id === x.ligne.client_id);
          return h(
            "li",
            { class: "carte" },
            h(
              "div",
              { class: "carte-lien statique" },
              h("span", { class: "carte-titre" }, x.ligne.ref),
              h("span", { class: "carte-sous" }, [client ? nomClient(client) : "", x.ligne.pays || x.ligne.bandeau || ""].filter(Boolean).join(" · ")),
              h(
                "span",
                { class: "carte-pied" },
                h("span", null, tr("Supprimé le {date}", { date: formatDate(x.supprime_le) })),
                h(
                  "span",
                  { class: "carte-actions" },
                  h(
                    "button",
                    {
                      class: "secondaire petit",
                      type: "button",
                      onclick: async () => {
                        if (!(await confirmer(tr("Restaurer le dossier « {ref} » avec ses documents, paiements et réservations ?", { ref: x.ligne.ref }), tr("Restaurer")))) return;
                        try {
                          const id = await restaurerDossier(x.id);
                          toast(tr("Dossier restauré."));
                          naviguer(`#/dossier/${id}`);
                        } catch (err) {
                          toast(tr("Restauration impossible : {message}", { message: err.message }), true);
                        }
                      },
                    },
                    tr("Restaurer")
                  )
                )
              )
            )
          );
        })
      )
    );
  };
  dessiner();
  return h("section", null, h("h2", null, tr("Dossiers supprimés")), h("p", { class: "aide" }, tr("Un dossier supprimé reste récupérable pendant 90 jours, avec ses documents, ses paiements, ses réservations et ses tâches. Les fichiers joints ne sont pas conservés.")), liste);
}

// ---- Page de réglages ---------------------------------------------------------------------------------------
const LIBELLES = [
  ["devis", N_("Titre du devis")],
  ["facture", N_("Titre de la facture")],
  ["facture_locale", N_("Titre de la facture locale (vide : comme la facture)")],
  ["ref_devis", N_("Début de la référence (devis)")],
  ["ref_facture", N_("Début de la référence (facture)")],
  ["date_emission", N_("Libellé de la date")],
  ["unite", N_("Colonne du prix unitaire")],
  ["qte", N_("Colonne de la quantité")],
  ["total", N_("Total")],
  ["colonne_montant", N_("Colonne des montants (vide : comme le total)")],
  ["total_final", N_("Barre du total final (vide : comme le total)")],
  ["sous_total", N_("Sous-total")],
  ["remise", N_("Remise")],
  ["montant_recu", N_("Montant reçu")],
  ["equivalent", N_("Début de la ligne d'équivalent indicatif")],
  ["conditions", N_("Titre des conditions de paiement")],
  ["signature_1", N_("Signature du client, première ligne (devis)")],
  ["signature_2", N_("Signature du client, seconde ligne")],
  ["coordonnees", N_("Titre du bloc de contact (pied de page)")],
  ["infos_paiement", N_("Titre du bloc de paiement (pied de page)")],
  ["pied_court", N_("Message de paiement du pied de page court")],
  ["qr_titre", N_("Titre au-dessus du QR code")],
  ["facture_a", N_("Étiquette au-dessus du client (vide : aucune)")],
  ["prestataire", N_("Étiquette du prestataire du service")],
  ["note_devise", N_("Ligne sous le total (ex. Currency: {devise} ({devise_nom}))")],
  ["pied_note", N_("Note en bas de page, sous les coordonnées")],
];
// Textes que « Remplir en français / en anglais » ne doit pas écraser : ils sont propres à l'entreprise.
const LIBELLES_PROPRES = ["qr_titre", "facture_locale", "facture_a", "note_devise", "pied_note"];
// Textes qui n'existent que sur un devis ZTP (ou sa facture locale) : absents des réglages de Secret.
const LIBELLES_DEVIS = ["devis", "ref_devis", "facture_locale", "equivalent", "signature_1", "signature_2"];
const garder = (libelles) => Object.fromEntries(LIBELLES_PROPRES.map((k) => [k, libelles[k]]));

const lire = (o, chemin) => chemin.split(".").reduce((a, k) => (a ? a[k] : undefined), o);
function ecrire(o, chemin, v) {
  const ks = chemin.split(".");
  const dernier = ks.pop();
  ks.reduce((a, k) => a[k], o)[dernier] = v;
}

export function vueReglages() {
  if (!estAdmin()) return vide(tr("Accès réservé"), tr("Les réglages d'une entreprise sont réservés à ses administrateurs."), h("a", { class: "bouton secondaire", href: "#/" }, tr("Retour au tableau de bord")));
  const r = structuredClone(reglages());
  // Chaque entreprise ne règle que ce qui la concerne (Jérémy, 12.11.2026) : ZTP (voyages sur mesure, devis), Secret (excursions, facture
  // directe et vouchers), Taxi (Booking confirmation payée au chauffeur, sans facture). Le mode lu est celui enregistré.
  const fon = ["excursions", "taxi"].includes(r.fonctionnement) ? r.fonctionnement : "sur_mesure";
  const ztp = fon === "sur_mesure";
  const taxi = fon === "taxi";
  let versionLue = (etat.brut.reglages_maj || {})[etat.entiteId];
  let modifie = false;
  const indicateur = h("span", { class: "etat-enregistrement", role: "status" }, "");
  const marque = () => {
    modifie = true;
    indicateur.textContent = tr("Modifications non enregistrées");
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
    return champ(tr(libelle), el, aide);
  };
  const liste = (libelle, chemin, aide) => {
    const el = h("textarea", { id: uid(), rows: 4 });
    el.value = lire(r, chemin).join("\n");
    el.addEventListener("input", () => {
      ecrire(r, chemin, el.value.split("\n").map((x) => x.trim()).filter(Boolean));
      marque();
    });
    return champ(tr(libelle), el, aide);
  };
  const image = (libelle, chemin, { maxPx = 800, aide } = {}) => {
    const apercu = h("div", { class: "vignette" });
    const info = h("p", { class: "aide" });
    const maj = () => {
      const v = lire(r, chemin);
      apercu.replaceChildren(v ? h("img", { src: v, alt: "" }) : h("span", { class: "aide" }, tr("Aucune image")));
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
      tr("Retirer l'image")
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
    return h("div", { class: "champ" }, h("label", { for: id }, tr(libelle)), apercu, fichier, retirer, info, aide ? h("p", { class: "aide" }, aide) : null);
  };

  // Aperçu d'un document d'exemple avec les réglages en cours de saisie
  const exemple = () => {
    const modele = r.dossier.modele_bandeau.replace("{PAYS}", (r.listes.pays[0] || "").toUpperCase()).replace("{PERIODE}", "DU 2 AU 12 DÉCEMBRE").replace(/^[\s-]+|[\s-]+$/g, "");
    const doc = {
      date_emission: aujourdhui(),
      contenu: {
        ...CONTENU_DEFAUT(),
        langue: ztp ? "" : "en",
        bandeau: modele || "Titre du document",
        colonnes: "detail",
        variante: (r.textes.variantes[0] || {}).id || "",
        lignes: [nouvelleLigne("bloc", { libelle: "Prestation d'exemple", intro: "comprenant:", puces: ["premier détail", "second détail"], unite: 100, qte: 2 }), nouvelleLigne("ligne", { libelle: "Supplément d'exemple", montant: 50 }), nouvelleLigne("remise", { libelle: "exemple", pct: 10 })],
      },
    };
    return renderDocument({ type: ztp ? "devis" : "facture", doc, dossier: { ref: "EXEMPLE-0001" }, client: { civilite: r.listes.civilites[0] || "", prenom: "Prénom", nom: "Nom", adresse: "1 rue de l'Exemple\n00000 Ville", telephone: "+00 00 000 00 00" }, reglages: r, recu: 0 });
  };
  const { zone: zoneApercu, redessiner } = apercuA4(exemple);
  let typeApercuVoucher = taxi ? "transfert" : "bateau";
  const choixApercuVoucher = h("select", { id: "apercu-voucher-type", onchange: (e) => ((typeApercuVoucher = e.target.value), redessinerVoucher()) }, [["billet", tr("Boat Ticket")], ["bateau", tr("Boat Tour")], ["transfert", tr("Transfer")], ["activite", tr("Activity & Tour")], ["location", tr("Rental")]].map(([v, l]) => h("option", { value: v }, l)));
  const { zone: zoneVoucher, redessiner: redessinerVoucher } = apercuA4(() => voucherExemple(r, typeApercuVoucher));
  zoneVoucher.hidden = true;
  let minuteur = null;
  const redessinerApercu = () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => (zoneVoucher.hidden ? redessiner() : redessinerVoucher()), 200);
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
          h("div", { class: "carte-ligne-tete" }, h("strong", null, tr("Variante {x}", { x: i + 1 })), h("span", { class: "outils" }, r.textes.variantes.length > 1 ? h("button", { class: "lien danger-texte", type: "button", onclick: () => (r.textes.variantes.splice(i, 1), dessinerVariantes(), marque()) }, tr("Supprimer")) : null)),
          champ(tr("Nom (visible dans la liste du devis)"), nom),
          champ(tr("Conditions de paiement"), corps),
          champ(tr("Fin du texte"), cloture),
          champ(tr("Conditions de paiement en anglais (facultatif)"), corpsEn, tr("Utilisées quand le document est écrit en anglais. Vide : le texte ci-dessus est repris.")),
          champ(tr("Fin du texte en anglais (facultatif)"), clotureEn)
        );
      }),
      h("button", { class: "secondaire petit", type: "button", onclick: () => (r.textes.variantes.push({ id: `v-${Date.now().toString(36)}`, nom: tr("Nouvelle variante"), corps: "", cloture: "" }), dessinerVariantes(), marque()) }, tr("Ajouter une variante"))
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
          h("div", { class: "carte-ligne-tete" }, h("strong", null, m.nom || tr("Informations {x}", { x: i + 2 })), h("span", { class: "outils" }, h("button", { class: "lien danger-texte", type: "button", onclick: () => (r.paiement.autres.splice(i, 1), dessinerAutres(), marque()) }, tr("Supprimer")))),
          texte(N_("Nom (visible dans la liste du document)"), `paiement.autres.${i}.nom`, { placeholder: tr("Par exemple : Banque thaïlandaise (THB)") }),
          texte(N_("Informations de paiement du pied de page"), `paiement.autres.${i}.texte`, { multi: true, rows: 5, aide: tr("Une ligne par information. **gras** possible.") }),
          image(N_("QR code (facultatif)"), `paiement.autres.${i}.qr_image`, { maxPx: 700 }),
          texte(N_("Texte à côté du QR code"), `paiement.autres.${i}.qr_pseudo`)
        )
      ),
      h("button", { class: "secondaire petit", type: "button", onclick: () => (r.paiement.autres.push({ id: `p-${Date.now().toString(36)}`, nom: "", texte: "", qr_image: "", qr_pseudo: "" }), dessinerAutres(), marque()) }, tr("Ajouter d'autres informations de paiement"))
    );
  };
  dessinerAutres();

  const entete = h("select", { id: uid(), onchange: (e) => ((r.apparence.entete = e.target.value), marque()) }, h("option", { value: "classique" }, tr("Classique : logo à droite, titre en grand")), h("option", { value: "centre" }, tr("Centrée : logo et titre du document au centre")));
  entete.value = r.apparence.entete;

  const moyens = h("textarea", { id: uid(), rows: 5 });
  moyens.value = r.listes.moyens.map((m) => m.label).join("\n");
  moyens.addEventListener("input", () => {
    const anciens = new Map(r.listes.moyens.map((m) => [m.label.toLowerCase(), m.id]));
    const lignes = moyens.value.split("\n").map((x) => x.trim()).filter(Boolean);
    r.listes.moyens = lignes.map((label) => ({ id: anciens.get(label.toLowerCase()) || slug(label) || "autre", label }));
    marque();
  });

  const modeNum = h("select", { id: uid(), onchange: (e) => ((r.numerotation.mode = e.target.value), (prefixe.hidden = chiffres.hidden = e.target.value !== "sequence"), marque()) }, h("option", { value: "sequence" }, tr("Numéro de séquence par année (ex. ST-2026-0001)")), ztp || r.numerotation.mode === "initiales" ? h("option", { value: "initiales" }, tr("Initiales, date et pays (ex. LD20261009 Thaïlande)")) : null);
  modeNum.value = r.numerotation.mode;
  const prefixe = texte(N_("Préfixe des numéros"), "numerotation.prefixe", { aide: tr("Par exemple ST pour obtenir ST-2026-0001. Peut rester vide.") });
  prefixe.hidden = r.numerotation.mode !== "sequence";
  const chiffres = texte(N_("Nombre de chiffres du numéro"), "numerotation.chiffres", { type: "number", aide: tr("4 donne ST-2026-0001, 3 donne ST-2026-001.") });
  chiffres.hidden = r.numerotation.mode !== "sequence";

  const libellesGrille = h("div", { class: "grille-form" });
  // Les mêmes textes existent en deux versions : ceux de la langue principale et ceux des documents en anglais.
  // Secret et Taxi écrivent leurs documents en anglais (contenu.langue = "en") : leurs textes à modifier sont les textes anglais.
  let langueTextes = ztp ? "principale" : "en";
  const cibleTextes = () => (langueTextes === "en" ? r.libelles_en : r.libelles);
  const dessinerLibelles = () => {
    const cible = cibleTextes();
    libellesGrille.replaceChildren(
      ...LIBELLES.filter(([cle]) => ztp || !LIBELLES_DEVIS.includes(cle)).map(([cle, nom]) => {
        const el = h("input", { id: `lb-${cle}`, value: cible[cle] ?? "", oninput: (e) => ((cible[cle] = e.target.value), marque()) });
        return champ(tr(nom), el);
      })
    );
    const cgv = h("textarea", { id: "lb-cgv", rows: 4, oninput: (e) => ((cible.cgv = e.target.value), marque()) });
    cgv.value = cible.cgv ?? "";
    // La phrase des conditions générales « du devis » (signature valant acceptation) ne concerne que ZTP.
    if (ztp) libellesGrille.append(h("div", { class: "pleine-largeur" }, champ(tr("Phrase sur les conditions générales"), cgv, tr("Laissez vide pour ne pas l'afficher. [texte](lien) crée un lien. {cgv_url} et {entreprise} se remplissent seuls."))));
    const cgvFacture = h("textarea", { id: "lb-cgv-facture", rows: 2, placeholder: CGV_FACTURE[langueTextes === "en" ? "en" : "fr"], oninput: (e) => ((cible.cgv_facture = e.target.value), marque()) });
    cgvFacture.value = cible.cgv_facture ?? "";
    libellesGrille.append(h("div", { class: "pleine-largeur" }, champ(tr("Phrase sur les conditions générales, facture"), cgvFacture, tr("Laissez vide pour la phrase par défaut de la facture. Même syntaxe que ci-dessus."))));
  };
  const remplirTextes = (base) => {
    const cle = langueTextes === "en" ? "libelles_en" : "libelles";
    r[cle] = { ...r[cle], ...base, ...garder(r[cle]) };
    dessinerLibelles();
    marque();
  };
  const choixLangue = h(
    "select",
    { id: "lb-langue", "aria-label": tr("Langue des textes à modifier"), onchange: (e) => ((langueTextes = e.target.value), dessinerLibelles()) },
    h("option", { value: "principale" }, tr("Textes de la langue principale (documents habituels)")),
    h("option", { value: "en" }, tr("Textes des documents en anglais"))
  );
  dessinerLibelles();

  // État des rappels sur téléphone (migration 23) : dernière exécution et alerte s'il n'y a eu aucun rappel réussi depuis 24 h.
  const sectionRappels = h("div", { class: "etat-rappels" });
  if (etat.store.suiviRappels) {
    etat.store.suiviRappels().then((lignes) => {
      if (!lignes) return;
      const e = etatRappels(lignes);
      const quand = (l) => new Date(l.cree_le).toLocaleString(localeActive(), { dateStyle: "short", timeStyle: "short" });
      const texte = e.message === "aucune_execution" ? tr("Aucun rappel n'a encore été envoyé depuis la mise en place du suivi.")
        : e.statut === "ok" ? tr("Dernier rappel le {date} : {envoyes} envoyé(s), {echecs} échec(s).", { date: quand(e.derniere), envoyes: e.derniere.envoyes, echecs: e.derniere.echecs })
        : e.message === "derniere_en_echec" ? tr("Le dernier rappel (le {date}) a échoué : {erreur}", { date: quand(e.derniere), erreur: e.derniere.erreur || tr("{n} échec(s) d'envoi", { n: e.derniere.echecs }) })
        : tr("Aucun rappel n'a réussi depuis plus de 24 h. Dernière exécution : le {date}.", { date: quand(e.derniere) });
      sectionRappels.replaceChildren(h("h3", null, tr("Rappels sur téléphone")), h("p", { class: e.statut === "alerte" ? "ecart-facture alerte-rappels" : "aide", role: "status" }, texte));
    });
  }

  const sections = {
    entreprise: h(
      "div",
      null,
      h("fieldset", null, h("legend", null, tr("Identité sur les documents")), texte(N_("Nom de l'entreprise"), "emetteur.nom"), texte(N_("Sous-titre sous le nom (facultatif)"), "emetteur.sous_titre", { aide: tr("Par exemple « by Nom de la société mère ».") }), texte(N_("Adresse"), "emetteur.adresse", { multi: true, rows: 3 }), texte(N_("Téléphone affiché sous l'adresse"), "emetteur.telephone"), taxi ? null : texte(N_("Numéro de licence TAT"), "emetteur.licence", { aide: ztp ? tr("Affiché sous l'adresse sur les devis et factures.") : tr("Affiché sous l'adresse sur les factures et sur les vouchers (sauf si le bloc Vouchers a le sien).") })),
      // L'avis Google se demande par les messages et les cartes « Hier » de l'accueil : Secret et Taxi seulement.
      ztp ? null : h("fieldset", null, h("legend", null, tr("Avis des clients")), texte(N_("Lien d'avis Google"), "emetteur.lien_avis", { placeholder: "https://g.page/r/…/review", aide: tr("Le message « avis » le met dans le texte (variable {lien_avis}). Les cartes « Hier » de l'accueil proposent de le demander une fois par client.") })),
      h("fieldset", null, h("legend", null, tr("Bloc de contact du pied de page")), texte(N_("Une ligne par information"), "emetteur.contact", { multi: true, rows: 4, aide: tr("Nom de la personne, WhatsApp, e-mail, site… Ce que vous voulez voir en bas de chaque document.") }))
    ),
    paiement: h(
      "div",
      null,
      h("fieldset", null, h("legend", null, taxi ? tr("Devise") : tr("Devise et paiement")), texte(N_("Devise des montants"), "devise", { aide: tr("Code court affiché devant les montants, par exemple CHF, THB ou EUR. Changer la devise ne convertit pas les montants déjà saisis.") }), taxi ? null : texte(N_("Informations de paiement du pied de page"), "paiement.texte", { multi: true, rows: 5, aide: tr("Une ligne par information : banque, IBAN, titulaire… Ce texte s'affiche tel quel sur les documents.") }), taxi ? null : texte(N_("Nom de ces informations (liste du document)"), "paiement.nom", { placeholder: tr("Principal") })),
      // Taxi n'émet aucune facture client : ni autres informations de paiement, ni QR, ni équivalents.
      taxi ? null : h("fieldset", null, h("legend", null, tr("Autres informations de paiement")), h("p", { class: "aide" }, ztp ? tr("Utile quand certains documents se paient ailleurs, par exemple une facture locale en bahts avec une banque thaïlandaise. Chaque devis ou facture choisit les informations à afficher.") : tr("Utile quand certaines factures se paient ailleurs. Chaque facture choisit les informations à afficher.")), blocAutres),
      taxi ? null : h("fieldset", null, h("legend", null, tr("QR code de paiement")), image(N_("Image du QR code"), "apparence.qr_image", { maxPx: 700 }), texte(N_("Texte à côté du QR code"), "apparence.qr_pseudo", { aide: tr("Par exemple un pseudo Wise. Vide pour ne rien afficher.") })),
      !ztp ? null : h("fieldset", null, h("legend", null, tr("Équivalents indicatifs")), h("p", { class: "aide" }, tr("Utilisés seulement quand vous affichez l'équivalent en euros et en bahts sur un devis. À mettre à jour de temps en temps.")), h("div", { class: "grille-form" }, texte(N_("1 unité de la devise en euros"), "taux.eur", { type: "number", step: "0.001" }), texte(N_("1 unité de la devise en bahts"), "taux.thb", { type: "number", step: "0.01" })))
    ),
    fonctionnement: h(
      "div",
      null,
      // Acompte et relance de devis : ZTP seulement. Taxi n'a ni facture ni conditions.
      taxi ? null : h("fieldset", null, h("legend", null, tr("Conditions")), ztp ? h("div", { class: "grille-form" }, texte(N_("Acompte demandé (%, 0 si aucun)"), "conditions.acompte_pct", { type: "number" }), texte(N_("Délai de paiement de l'acompte (jours)"), "conditions.delai_jours", { type: "number" }), texte(N_("Relancer un devis sans réponse après (jours)"), "conditions.relance_jours", { type: "number" })) : null, texte(N_("Mention de TVA"), "conditions.tva_mention", { aide: tr("Par exemple « TVA non applicable ». Vide pour ne rien afficher.") }), texte(N_("Mention de TVA en anglais (facultatif)"), "conditions.tva_mention_en", { aide: tr("Pour les documents écrits en anglais. Vide : la mention ci-dessus est reprise.") }), texte(N_("Lien des conditions générales"), "conditions.cgv_url", { type: "url" })),
      h("fieldset", null, h("legend", null, tr("Dossiers")), champ(tr("Numérotation"), modeNum), prefixe, chiffres, ...(ztp ? [texte(N_("Nom du champ « pays »"), "dossier.libelle_pays", { aide: tr("Par exemple Pays, Service ou Trajet. C'est la liste proposée à la création d'un dossier.") }), liste(N_("Valeurs proposées, une par ligne"), "listes.pays"), texte(N_("Modèle du titre du document"), "dossier.modele_bandeau", { aide: tr("{PAYS} et {PERIODE} se remplissent avec le dossier. Exemple : VOYAGE EN {PAYS} - {PERIODE}.") })] : [])),
      // Civilités : formulaire client de ZTP seulement. Devises et moyens de paiement : pas en Taxi (rien n'est payé chez nous).
      taxi ? null : h("fieldset", null, h("legend", null, tr("Listes")), ztp ? liste(N_("Civilités des clients, une par ligne"), "listes.civilites") : null, liste(N_("Devises proposées pour un document, une par ligne"), "listes.devises", tr("Codes courts comme CHF, EUR, THB, USD. Servent aussi pour les équivalents indicatifs.")), champ(tr("Moyens de paiement, un par ligne"), moyens))
    ),
    textes: h(
      "div",
      null,
      h("fieldset", null, h("legend", null, tr("Textes fixes des documents")), h("div", { class: "actions gauche" }, ztp ? h("button", { class: "secondaire petit", type: "button", onclick: () => remplirTextes(LIBELLES_FR) }, tr("Remplir en français")) : null, h("button", { class: "secondaire petit", type: "button", onclick: () => remplirTextes(LIBELLES_EN) }, tr("Remplir en anglais"))), ztp ? champ(tr("Langue des textes à modifier"), choixLangue, tr("Un document peut être écrit en anglais depuis son en-tête (par exemple la facture locale). Il utilise alors la version anglaise de ces textes.")) : null, libellesGrille),
      h("fieldset", null, h("legend", null, tr("Conditions de paiement proposées")), h("p", { class: "aide" }, ztp ? tr("Chaque devis choisit une de ces variantes, ou son propre texte. Une ligne commençant par « - » devient une puce. **gras**, _italique_. Les mots entre accolades se remplissent seuls : {acompte}, {solde}, {delai}, {total}, {indicatif}.") : tr("Chaque facture choisit une de ces variantes, ou son propre texte. Une ligne commençant par « - » devient une puce. **gras**, _italique_. Les mots entre accolades se remplissent seuls : {delai}, {total}.")), blocVariantes)
    ),
    apparence: h(
      "div",
      null,
      h("fieldset", null, h("legend", null, tr("Logo et titre")), champ(tr("Disposition de l'en-tête"), entete), image(N_("Logo"), "apparence.logo", { maxPx: 600 }), texte(N_("Titre en grand sur le document"), "apparence.titre_texte", { aide: tr("Le nom de l'entreprise si vide. Ignoré quand une image de titre est choisie.") }), image(N_("Image du titre (facultative)"), "apparence.titre_image", { maxPx: 1600, aide: tr("Pour un lettrage particulier. Elle remplace le titre écrit.") })),
      h(
        "fieldset",
        null,
        h("legend", null, tr("Couleurs")),
        h(
          "div",
          { class: "grille-form" },
          ...[[tr("Couleur principale (barre de total, titres)"), "apparence.couleur"], [tr("Couleur claire (bandeau)"), "apparence.couleur_clair"]].map(([libelle, chemin]) => {
            const el = h("input", { id: uid(), type: "color", value: lire(r, chemin), oninput: (e) => (ecrire(r, chemin, e.target.value), marque()) });
            el.className = "couleur";
            return champ(libelle, el);
          })
        )
      ),
      r.apparence.type_images ? h("fieldset", null, h("legend", null, tr("Titres en images")), h("p", { class: "aide" }, tr("Les mots DEVIS et FACTURE sont des images. Retirez-les pour les remplacer par les textes de l'onglet « Textes ».")), h("button", { class: "secondaire petit", type: "button", onclick: (e) => ((r.apparence.type_images = null), e.target.closest("fieldset").remove(), marque()) }, tr("Utiliser des textes à la place"))) : null
    ),
    ecrans: h(
      "div",
      null,
      h(
        "fieldset",
        null,
        h("legend", null, tr("Écrans de cette entreprise")),
        h("p", { class: "aide" }, ztp ? tr("Les écrans choisis ici n'apparaissent que pour « {nom} ». Le catalogue de formules sert aux devis.", { nom: entiteActive().nom }) : tr("Les écrans choisis ici n'apparaissent que pour « {nom} ». En automatique, Partenaires, Réservations et Messages sont affichés.", { nom: entiteActive().nom })),
        h(
          "div",
          { class: "grille-form" },
          ...(ztp ? [["catalogue", tr("Catalogue de formules")]] : [["partenaires", taxi ? tr("Partenaires et tarifs") : tr("Partenaires, tarifs, trajets, règles et dû")], ["reservations", tr("Réservations et agenda du jour")], ["messages", tr("Messages types")]]).map(([cle, libelle]) => {
            const v = (r.modules || {})[cle];
            const sel = h("select", { id: `mod-${cle}`, onchange: (e) => { r.modules = r.modules || {}; r.modules[cle] = { auto: null, oui: true, non: false }[e.target.value]; marque(); } }, h("option", { value: "auto" }, tr("Automatique")), h("option", { value: "oui" }, tr("Affiché")), h("option", { value: "non" }, tr("Masqué")));
            sel.value = v === true ? "oui" : v === false ? "non" : "auto";
            return champ(libelle, sel);
          })
        ),
        h("p", { class: "aide" }, tr("Le menu se met à jour après l'enregistrement. Les droits des rôles s'appliquent toujours en plus."))
      ),
      h(
        "fieldset",
        null,
        h("legend", null, tr("Fonctionnement")),
        champ(
          tr("Façon de travailler"),
          (() => {
            const sel = h("select", { id: "fonctionnement", onchange: (e) => ((r.fonctionnement = e.target.value), marque()) }, h("option", { value: "sur_mesure" }, tr("Voyages sur mesure : devis, acompte, facture")), h("option", { value: "excursions" }, tr("Excursions et transferts : facture directe, puis vouchers")), h("option", { value: "taxi" }, tr("Taxi : réservations et voucher, payé au chauffeur, sans facture")));
            sel.value = ["excursions", "taxi"].includes(r.fonctionnement) ? r.fonctionnement : "sur_mesure";
            return sel;
          })(),
          tr("En mode excursions, un nouveau dossier crée la facture et les réservations d'un coup, sans devis ni acompte, et chaque réservation a son voucher pour le client et le prestataire. En mode taxi, pas de facture : chaque course a sa « Booking confirmation » et se paie au chauffeur.")
        )
      ),
      // Assistant IA : éteint par défaut, allumé par entreprise. Il ne fonctionne qu'une fois la fonction « assistant » déployée avec sa clé.
      // Il vit dans « Coller une demande », qui n'existe qu'en Secret et en Taxi.
      ztp ? null : h(
        "fieldset",
        null,
        h("legend", null, tr("Assistant IA")),
        h("label", { class: "case", for: "assistant-ia" }, h("input", { id: "assistant-ia", type: "checkbox", checked: r.assistant_ia === true, onchange: (e) => ((r.assistant_ia = e.target.checked), marque()) }), tr("Proposer l'assistant dans « Coller une demande » : lire un message libre et rédiger la réponse")),
        h("p", { class: "aide" }, tr("L'assistant (Claude, d'Anthropic) reçoit le message collé, la liste des tarifs de vente et, pour une réponse, le prénom du client et les services avec leurs prix. Jamais de net, de commission ni de coordonnée bancaire. Il propose, vous vérifiez : rien n'est créé ni envoyé sans vous."))
      ),
      ztp ? null : h(
        "fieldset",
        null,
        h("legend", null, taxi ? tr("Booking confirmation") : tr("Vouchers")),
        h("p", { class: "aide" }, tr("Les vouchers sont en anglais. Un champ vide reprend la valeur de l'onglet Entreprise (nom, sous-titre, adresse, téléphone) ; le logo est celui de l'onglet Apparence. L'aperçu à droite suit vos modifications.")),
        h("div", { class: "grille-form" }, texte(N_("Nom affiché"), "voucher.nom", { placeholder: r.emetteur.nom }), texte(N_("Sous-titre"), "voucher.sous_titre", { placeholder: r.emetteur.sous_titre || "" }), taxi ? null : texte(N_("Numéro de licence TAT"), "voucher.licence"), texte(N_("WhatsApp affiché"), "voucher.whatsapp", { placeholder: r.emetteur.telephone }), texte(N_("E-mail affiché"), "voucher.email", { type: "email" })),
        texte(N_("Adresse sur une ligne"), "voucher.adresse", { placeholder: (r.emetteur.adresse || "").split("\n").join(", ") }),
        // Taxi : l'assistante envoie les vouchers de l'écran « Nouveau voucher » à Anaïs, qui les transmet au client.
        r.fonctionnement === "taxi" ? texte(N_("WhatsApp d'Anaïs (reçoit les vouchers de l'assistante)"), "voucher.whatsapp_anais", { type: "tel", placeholder: "+66 …", aide: tr("Avec l'indicatif. Sur ordinateur, l'image est copiée et cette conversation s'ouvre ; sur téléphone, un bouton ouvre la conversation après l'envoi de l'image. Vide : l'assistante choisit Anaïs dans WhatsApp.") }) : null,
        // La Booking confirmation de Taxi a un seul modèle et ses propres textes de pied : ni choix de modèle, ni textes de fin.
        taxi ? null : champ(tr("Modèle de l'aperçu"), choixApercuVoucher),
        taxi ? null : texte(N_("Texte de fin"), "voucher.merci", { multi: true, rows: 2, aide: tr("{entreprise} est remplacé par le nom affiché.") }),
        taxi ? null : texte(N_("Texte de fin des vouchers de transfert"), "voucher.merci_transfert", { multi: true, rows: 2 }),
        taxi ? null : texte(N_("Note des vouchers de transfert"), "voucher.note_transfert", { multi: true, rows: 2 })
      )
    ),
    // Sécurité du compte : « Se déconnecter » ne ferme que cet appareil ; ici, tous les appareils d'un coup (téléphone perdu, appareil prêté).
    compte: h(
      "div",
      null,
      h(
        "section",
        null,
        h("h2", null, tr("Sécurité du compte")),
        h("p", { class: "aide" }, tr("« Se déconnecter » ne ferme que l'appareil que vous utilisez : l'iPhone reste connecté quand vous quittez l'ordinateur. Pour fermer vos sessions partout, utilisez le bouton ci-dessous.")),
        h("div", { class: "actions gauche" }, h("button", { class: "secondaire", type: "button", onclick: async () => {
          if (!(await confirmer(tr("Tous vos appareils seront déconnectés, celui-ci compris. Il faudra se reconnecter avec l'e-mail et le mot de passe."), tr("Déconnecter partout"), true))) return;
          try {
            await etat.store.deconnecterPartout();
            location.reload();
          } catch (err) {
            toast(tr("Déconnexion impossible : {message}", { message: err.message }), true);
          }
        } }, tr("Déconnecter tous mes appareils"))),
        sectionRappels,
        h("h3", null, tr("Téléphone perdu ou volé")),
        h("ol", { class: "aide" },
          h("li", null, tr("Sur un autre appareil, ouvrez Réglages, Compte, puis « Déconnecter tous mes appareils ». Les sessions sont fermées, mais un appareil déjà ouvert peut encore servir jusqu'à une heure.")),
          h("li", null, tr("Pour couper l'accès tout de suite, l'administratrice générale décoche « Compte actif » pour cette personne dans Administration.")),
          h("li", null, tr("Changez ensuite le mot de passe, puis réactivez le compte."))
        )
      )
    ),
    donnees: h(
      "div",
      null,
      h(
        "section",
        null,
        h("h2", null, tr("Sauvegarde et exports")),
        h("p", { class: "aide" }, tr("Ces fichiers concernent seulement l'entreprise « {nom} ». Une sauvegarde contient les données clients : gardez-la en lieu sûr.", { nom: entiteActive().nom })),
        h("div", { class: "actions gauche" }, h("button", { class: "secondaire", type: "button", onclick: exporterTout }, tr("Télécharger une sauvegarde complète")), h("button", { class: "secondaire", type: "button", onclick: exporterDossiers }, tr("Exporter les dossiers (Excel)")), taxi ? null : h("button", { class: "secondaire", type: "button", onclick: exporterPaiements }, tr("Exporter les paiements (Excel)"))),
        // Remplacer la base partenaires efface en cascade les nets et les commissions : seulement pour qui les voit.
        peut("partenaires.ecrire") && peut("partenaires.nets") ? h("label", { class: "case", for: "import-remplacer" }, h("input", { id: "import-remplacer", type: "checkbox" }), tr("Si le fichier contient des partenaires, remplacer la base partenaires (après l'import, supprime les partenaires, tarifs et trajets que le fichier ne contient plus)")) : null,
        peut("reglages.ecrire") ? h("label", { class: "case", for: "import-reglages" }, h("input", { id: "import-reglages", type: "checkbox" }), tr("Si le fichier contient les réglages, les restaurer aussi (remplace les textes des documents, les coordonnées de paiement et la numérotation actuels)")) : null,
        champ(tr("Restaurer ou importer une sauvegarde"), h("input", { id: "import-fichier", type: "file", accept: "application/json,.json", onchange: (e) => e.target.files[0] && importer(e.target.files[0]) }), tr("Elle sera importée dans « {nom} ». Les éléments déjà présents avec le même identifiant sont remplacés.", { nom: entiteActive().nom }))
      ),
      !peut("dossiers.supprimer") ? null : sectionCorbeille()
    ),
  };

  if (taxi) delete sections.textes;
  const ONGLETS = [
    ["entreprise", tr("Entreprise")],
    ["paiement", taxi ? tr("Devise") : tr("Paiement")],
    ["fonctionnement", tr("Dossiers et listes")],
    ...(taxi ? [] : [["textes", tr("Textes des documents")]]),
    ["apparence", tr("Apparence")],
    ["ecrans", tr("Écrans")],
    ...(peut("exports.faire") ? [["donnees", tr("Sauvegarde")]] : []),
    ...(etat.store.mode === "supabase" ? [["compte", tr("Compte")]] : []),
  ];
  const barre = h("div", { class: "onglets sous-onglets" });
  // Groupes repliables sur téléphone, et recherche d'un réglage dans tous les onglets.
  const groupes = plierGroupes(h("div", null, ...Object.values(sections)));
  const aucun = h("p", { class: "vide-court", hidden: true, role: "status" }, tr("Aucun réglage ne correspond."));
  const recherche = h("input", { type: "search", class: "recherche-reglages", placeholder: tr("Rechercher un réglage"), "aria-label": tr("Rechercher un réglage"), autocomplete: "off", enterkeyhint: "search" });
  recherche.addEventListener("input", () => {
    const q = recherche.value.trim();
    if (!q) return montrer(ongletCourant);
    const n = groupes.filtrer(q);
    for (const el of Object.values(sections)) el.hidden = !el.querySelector("fieldset:not([hidden])");
    zoneApercu.hidden = true;
    zoneVoucher.hidden = true;
    aucun.hidden = n > 0;
  });
  let ongletCourant = "entreprise";
  const montrer = (cle) => {
    ongletCourant = cle;
    recherche.value = "";
    groupes.filtrer("");
    aucun.hidden = true;
    for (const [k, el] of Object.entries(sections)) el.hidden = k !== cle;
    for (const b of barre.children) b.setAttribute("aria-pressed", b.dataset.cle === cle ? "true" : "false");
    // Taxi n'a aucun document A4 ; ZTP n'a pas de voucher.
    zoneApercu.hidden = taxi || cle === "donnees" || cle === "ecrans" || cle === "compte";
    zoneVoucher.hidden = ztp || cle !== "ecrans";
    if (cle === "ecrans") redessinerVoucher();
    boutonEnregistrer.hidden = cle === "donnees" || cle === "compte";
    if (cle !== "donnees" && cle !== "compte") redessiner();
  };
  ONGLETS.forEach(([cle, libelle]) => barre.append(h("button", { type: "button", "data-cle": cle, "aria-pressed": "false", onclick: () => montrer(cle) }, libelle)));

  const boutonEnregistrer = h("button", { class: "principal", type: "submit" }, tr("Enregistrer les réglages"));
  const enregistrer = async (e) => {
    e.preventDefault();
    if (!taxi && !r.textes.variantes.length) return toast(tr("Gardez au moins une variante de conditions de paiement."), true);
    r.devise = (r.devise || "").trim().toUpperCase();
    boutonEnregistrer.disabled = true;
    try {
      await enregistrerReglages(r, versionLue);
      modifie = false;
      indicateur.textContent = tr("Enregistré");
      toast(tr("Réglages enregistrés."));
      // La version enregistrée devient la nouvelle référence : on peut continuer à modifier sans conflit avec soi-même.
      versionLue = (etat.brut.reglages_maj || {})[etat.entiteId];
    } catch (err) {
      if (err.conflit) toast(tr("Quelqu'un d'autre a enregistré les réglages pendant que vous les modifiiez. Rechargez la page pour voir sa version, puis refaites vos changements."), true);
      else toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    } finally {
      boutonEnregistrer.disabled = false;
    }
  };

  const racine = h(
    "div",
    { "data-titre": tr("Réglages"), "data-large": "1", "data-plein": "1" },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Réglages")), h("p", { class: "sous" }, entiteActive().nom)), estSuperAdmin() ? h("a", { class: "bouton secondaire", href: "#/admin" }, tr("Administration : entreprises et accès")) : null),
    barre,
    recherche,
    h("form", { class: "reglages-grille", onsubmit: enregistrer }, h("div", { class: "reglages-colonne" }, aucun, ...Object.values(sections), h("div", { class: "actions barre-fixe" }, indicateur, boutonEnregistrer)), zoneApercu, zoneVoucher)
  );
  montrer("entreprise");
  return racine;
}
