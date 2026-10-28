import { etat, enregistrerReglages, recharger, resumes, nomClient, naviguer } from "../etat.mjs";
import { h, champ, confirmer, toast, num } from "../ui.mjs";
import { aujourdhui, formatDate, STATUTS } from "../calc.mjs";
import { telecharger } from "./commun.mjs";

const TABLES = ["clients", "dossiers", "documents", "paiements", "catalogue"];

function csv(lignes) {
  // Une cellule qui commence par = + - @ serait lue comme une formule par Excel.
  const cellule = (v) => {
    const texte = String(v ?? "");
    return `"${(typeof v === "string" && /^[=+\-@]/.test(texte) ? `'${texte}` : texte).replaceAll('"', '""')}"`;
  };
  return "﻿" + lignes.map((l) => l.map(cellule).join(";")).join("\r\n");
}

function exporterDossiers() {
  const lignes = [["Référence", "Client", "Pays", "Statut", "Total CHF", "Reçu CHF", "Reste CHF", "Devis émis le", "Accepté le", "Départ", "Retour"]];
  for (const r of resumes()) {
    const devis = r.documents.find((d) => d.type === "devis");
    lignes.push([r.dossier.ref, nomClient(r.client), r.dossier.pays, STATUTS[r.statut], r.total, r.recu, r.reste, devis ? formatDate(devis.date_emission) : "", formatDate(r.dossier.accepte_le), formatDate(r.dossier.date_depart), formatDate(r.dossier.date_retour)]);
  }
  telecharger(`dossiers-${aujourdhui()}.csv`, csv(lignes), "text/csv;charset=utf-8");
}

function exporterPaiements() {
  const lignes = [["Date", "Référence", "Client", "Type", "Moyen", "Montant CHF", "Montant d'origine", "Devise", "Note"]];
  for (const p of [...etat.db.paiements].sort((a, b) => (a.date > b.date ? 1 : -1))) {
    const d = etat.db.dossiers.find((x) => x.id === p.dossier_id);
    const c = d && etat.db.clients.find((x) => x.id === d.client_id);
    lignes.push([formatDate(p.date), d ? d.ref : "", nomClient(c), p.type, p.moyen, p.montant, p.origine_montant ?? "", p.origine_devise, p.note]);
  }
  telecharger(`paiements-${aujourdhui()}.csv`, csv(lignes), "text/csv;charset=utf-8");
}

function exporterTout() {
  const sauvegarde = { version: 1, exporte_le: new Date().toISOString(), ...etat.db };
  telecharger(`sauvegarde-gestion-zwald-${aujourdhui()}.json`, JSON.stringify(sauvegarde, null, 2), "application/json");
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
    toast("Ce fichier n'a pas le format d'une sauvegarde Gestion Zwald.", true);
    return;
  }
  const resume = TABLES.map((t) => `${(data[t] || []).length} ${t}`).join(", ");
  if (!(await confirmer(`Importer ${resume} ? Les éléments qui ont le même identifiant seront remplacés, les autres sont conservés.`, "Importer"))) return;
  try {
    await etat.store.importer(data);
    await recharger();
    toast("Import terminé.");
    naviguer("#/dossiers");
  } catch (err) {
    toast(`Import impossible : ${err.message}`, true);
  }
}

export function vueReglages() {
  const r = structuredClone(etat.db.reglages);
  const inp = (id, valeur, extra = {}) => h("input", { id, value: valeur ?? "", ...extra });
  const champs = {
    nom: inp("r-nom", r.emetteur.nom),
    adresse: h("textarea", { id: "r-adresse", rows: 2 }),
    telephone: inp("r-tel", r.emetteur.telephone),
    contact: inp("r-contact", r.emetteur.contact_nom),
    whatsapp: inp("r-wa", r.emetteur.whatsapp),
    email: inp("r-email", r.emetteur.email, { type: "email" }),
    banque: inp("r-banque", r.paiement.banque),
    iban: inp("r-iban", r.paiement.iban),
    swift: inp("r-swift", r.paiement.swift),
    titulaire: inp("r-titulaire", r.paiement.titulaire),
    villeTitulaire: inp("r-ville", r.paiement.ville_titulaire),
    wise: inp("r-wise", r.paiement.wise_pseudo),
    acompte: inp("r-acompte", r.conditions.acompte_pct, { type: "number", min: "0", max: "100" }),
    delai: inp("r-delai", r.conditions.delai_jours, { type: "number", min: "0" }),
    relance: inp("r-relance", r.conditions.relance_jours, { type: "number", min: "1" }),
    tva: inp("r-tva", r.conditions.tva_mention),
    cgv: inp("r-cgv", r.conditions.cgv_url, { type: "url" }),
    eur: inp("r-eur", r.taux.eur, { type: "number", step: "0.001" }),
    thb: inp("r-thb", r.taux.thb, { type: "number", step: "0.01" }),
  };
  champs.adresse.value = r.emetteur.adresse;
  const variantes = r.textes.variantes.map((v) => {
    const nom = inp(`v-${v.id}-nom`, v.nom);
    const corps = h("textarea", { id: `v-${v.id}-corps`, rows: 9 });
    corps.value = v.corps;
    const cloture = h("textarea", { id: `v-${v.id}-cloture`, rows: 3 });
    cloture.value = v.cloture;
    return { v, nom, corps, cloture };
  });

  const enregistrer = async (e) => {
    e.preventDefault();
    const nouveau = {
      emetteur: { nom: champs.nom.value.trim(), adresse: champs.adresse.value.trim(), telephone: champs.telephone.value.trim(), contact_nom: champs.contact.value.trim(), whatsapp: champs.whatsapp.value.trim(), email: champs.email.value.trim() },
      paiement: { banque: champs.banque.value.trim(), iban: champs.iban.value.trim(), swift: champs.swift.value.trim(), titulaire: champs.titulaire.value.trim(), ville_titulaire: champs.villeTitulaire.value.trim(), wise_pseudo: champs.wise.value.trim() },
      conditions: { acompte_pct: num(champs.acompte.value) ?? 50, delai_jours: num(champs.delai.value) ?? 10, relance_jours: num(champs.relance.value) ?? 7, tva_mention: champs.tva.value.trim(), cgv_url: champs.cgv.value.trim() },
      taux: { eur: num(champs.eur.value) ?? r.taux.eur, thb: num(champs.thb.value) ?? r.taux.thb },
      textes: { variantes: variantes.map(({ v, nom, corps, cloture }) => ({ id: v.id, nom: nom.value.trim(), corps: corps.value, cloture: cloture.value })) },
    };
    try {
      await enregistrerReglages(nouveau);
      toast("Réglages enregistrés.");
    } catch (err) {
      toast(`Enregistrement impossible : ${err.message}`, true);
    }
  };

  const fichier = h("input", { id: "import-fichier", type: "file", accept: "application/json,.json", onchange: (e) => e.target.files[0] && importer(e.target.files[0]) });

  return h(
    "div",
    { "data-titre": "Réglages" },
    h("div", { class: "entete" }, h("h1", null, "Réglages")),
    h(
      "form",
      { class: "formulaire", onsubmit: enregistrer },
      h("fieldset", null, h("legend", null, "Entreprise sur les documents"), h("div", { class: "grille-form" }, champ("Raison sociale", champs.nom), champ("Téléphone", champs.telephone), champ("Nom de contact", champs.contact), champ("WhatsApp, tel qu'affiché", champs.whatsapp), champ("E-mail", champs.email)), champ("Adresse", champs.adresse)),
      h("fieldset", null, h("legend", null, "Informations de paiement"), h("div", { class: "grille-form" }, champ("Banque", champs.banque), champ("IBAN", champs.iban), champ("Swift", champs.swift), champ("Titulaire", champs.titulaire), champ("Adresse du titulaire", champs.villeTitulaire), champ("Pseudo Wise sous le QR code", champs.wise))),
      h("fieldset", null, h("legend", null, "Conditions"), h("div", { class: "grille-form" }, champ("Acompte (%)", champs.acompte), champ("Délai de paiement de l'acompte (jours)", champs.delai), champ("Relancer un devis sans réponse après (jours)", champs.relance), champ("Mention de TVA", champs.tva), champ("Lien des CGV", champs.cgv))),
      h("fieldset", null, h("legend", null, "Taux de change indicatifs"), h("p", { class: "aide" }, "Utilisés seulement quand vous affichez l'équivalent en euros et en bahts sur un devis. À mettre à jour de temps en temps."), h("div", { class: "grille-form" }, champ("1 CHF en euros", champs.eur), champ("1 CHF en bahts", champs.thb))),
      variantes.map(({ v, nom, corps, cloture }) =>
        h(
          "fieldset",
          null,
          h("legend", null, `Texte des conditions : ${v.nom}`),
          h("p", { class: "aide" }, "Une ligne commençant par « - » devient une puce. **gras**, _italique_. Les mots entre accolades se remplissent seuls : {acompte}, {solde}, {delai}, {total}, {indicatif}."),
          champ("Nom de la variante", nom),
          champ("Conditions de paiement", corps),
          champ("Formule de politesse en fin de texte", cloture)
        )
      ),
      h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, "Enregistrer les réglages"))
    ),
    h(
      "section",
      null,
      h("h2", null, "Sauvegarde et exports"),
      h("p", { class: "aide" }, "Un fichier de sauvegarde contient toutes les données, y compris les clients. Faites-en une de temps en temps et gardez-la en lieu sûr."),
      h("div", { class: "actions gauche" }, h("button", { class: "secondaire", type: "button", onclick: exporterTout }, "Télécharger une sauvegarde complète"), h("button", { class: "secondaire", type: "button", onclick: exporterDossiers }, "Exporter les dossiers (Excel)"), h("button", { class: "secondaire", type: "button", onclick: exporterPaiements }, "Exporter les paiements (Excel)")),
      champ("Restaurer ou importer une sauvegarde", fichier, "Les éléments déjà présents avec le même identifiant sont remplacés.")
    )
  );
}
