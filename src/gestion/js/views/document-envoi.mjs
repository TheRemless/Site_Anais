// Envoi d'un devis ou d'une facture en PDF depuis un téléphone, où « Imprimer » ne sait pas enregistrer un PDF : le document est
// photographié dans la page (même rendu que l'aperçu), découpé en pages A4 et mis dans un fichier PDF, à télécharger ou à partager.
// Sur téléphone, le partage de fichier ouvre la liste de WhatsApp (on y choisit le contact). Sur ordinateur, le PDF est téléchargé et la
// conversation du numéro s'ouvre : un lien WhatsApp ne peut pas joindre de fichier.
import { etat, nomClient, peut } from "../etat.mjs";
import { h, modal, toast, confirmer } from "../ui.mjs";
import { aujourdhui, nomFichier, aMarquerEnvoye } from "../calc.mjs";
import { feuille, pdf } from "./commun.mjs";
import { moyen, partageFichiers, partager, enregistrer, copierTexte, zoneEnvoi } from "./partage.mjs";
import { lienWhatsApp } from "../operations-calc.mjs";
import { chiffres } from "../partenaires-calc.mjs";
import { construirePdf, decouperPages, hauteurPage } from "../pdf-simple.mjs";
import { tr } from "../i18n.mjs";

const LARGEUR = 794; // A4 à 96 dpi
const ECHELLE = 2;

// Vrai sur un téléphone ou une tablette (pas de survol) : l'impression n'y produit pas de fichier.
export const sansImpression = () => !window.matchMedia("(hover: hover)").matches;

// Fichier PDF (Blob) du document : une page A4 par tranche de 297 mm.
export async function fabriquerPdf(doc) {
  const { default: html2canvas } = await import("../../vendor/html2canvas.mjs");
  const { noeud, dossier, client } = feuille(doc);
  const hote = h("div", { class: "hote-image hote-document", "aria-hidden": "true" }, noeud);
  document.body.append(hote);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await Promise.all([...hote.querySelectorAll("img")].map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
    const cible = hote.firstChild;
    const plein = await html2canvas(cible, { scale: ECHELLE, backgroundColor: "#ffffff", useCORS: true, logging: false, width: LARGEUR, windowWidth: LARGEUR });
    const hp = hauteurPage(LARGEUR) * ECHELLE;
    const pages = [];
    for (const p of decouperPages(Math.round(plein.height / ECHELLE), LARGEUR)) {
      const c = document.createElement("canvas");
      c.width = plein.width;
      c.height = hp;
      const g = c.getContext("2d");
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(plein, 0, p.debut * ECHELLE, plein.width, p.hauteur * ECHELLE, 0, 0, plein.width, p.hauteur * ECHELLE);
      const blob = await new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error(tr("Le PDF n'a pas pu être fabriqué.")))), "image/jpeg", 0.92));
      pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), largeur: c.width, hauteur: c.height });
    }
    const nom = nomFichier(doc.type, doc, dossier, client);
    return { nom: `${nom}.pdf`, blob: new Blob([construirePdf(pages, { titre: nom })], { type: "application/pdf" }), apercu: pages[0] };
  } finally {
    hote.remove();
  }
}

// Message qui accompagne le document, dans la langue du document, avec son numéro.
const messageDocument = (doc, prenom, ref = "") => {
  const en = doc.contenu.langue === "en";
  const nom = doc.type === "devis" ? (en ? "quote" : "devis") : en ? "invoice" : "facture";
  const numero = ref ? ` ${ref}` : "";
  return en ? `Hello${prenom ? ` ${prenom}` : ""}, here is your ${nom}${numero}.` : `Bonjour${prenom ? ` ${prenom}` : ""}, voici votre ${nom}${numero}.`;
};

// `marquerEnvoye` (facultatif) : appelé si la personne confirme que le document est parti ; il pose la date d'envoi d'un devis.
export function envoyerDocument(doc, { marquerEnvoye = null } = {}) {
  const dossier = etat.db.dossiers.find((d) => d.id === doc.dossier_id) || {};
  const client = etat.db.clients.find((c) => c.id === dossier.client_id) || {};
  const tel = chiffres(client.telephone);
  const message = messageDocument(doc, client.prenom || "", dossier.ref || "");
  const apercu = h("div", { class: "envoi-apercu", "aria-live": "polite" }, h("p", { class: "aide" }, tr("Préparation du PDF…")));
  const actions = h("div", { class: "actions envoi-actions" });
  const aide = h("p", { class: "aide" });
  let fichier = null;
  let adresse = null;
  const zone = zoneEnvoi({ fichiers: () => (fichier ? [fichier] : []) });

  // Un devis qui part sans date d'envoi n'est jamais relancé : on propose de la poser.
  async function apres() {
    if (marquerEnvoye && aMarquerEnvoye(doc) && peut("documents.ecrire") && (await confirmer(doc.type === "devis" ? tr("Ce devis est-il parti chez le client ? Marqué comme envoyé, il apparaît dans « À faire » pour la relance.") : tr("Cette facture est-elle partie chez le client ? Marquée comme envoyée, elle n'apparaît plus comme « pas encore envoyée »."), doc.type === "devis" ? tr("Marquer comme envoyé") : tr("Marquer comme envoyée")))) await marquerEnvoye();
  }
  const telechargerPdf = () => enregistrer([fichier]);
  // Toujours à l'écran, dans tous les cas (même pendant la préparation et même quand tout le reste échoue) : enregistrer le PDF et copier le message.
  const secours = ({ principal = false } = {}) => [
    h("button", { class: principal ? "principal" : "secondaire", type: "button", disabled: !fichier, onclick: async () => (telechargerPdf(), await apres()) }, tr("Enregistrer le PDF")),
    h("button", { class: "secondaire", type: "button", onclick: () => copierTexte(message) }, tr("Copier le message")),
  ];
  // Dans le cadre d'état : WhatsApp avec le message seul, étiqueté sans ambiguïté, jamais ouvert tout seul.
  const boutonsRepli = () => [h("a", { class: "bouton secondaire", href: lienWhatsApp(tel, message), target: "_blank", rel: "noopener" }, tr("Ouvrir WhatsApp avec le message seul, sans le PDF"))];
  // Partage natif : appelé directement par le tap, sans texte joint (le message se copie à part). Ordinateur : PDF téléchargé et conversation ouverte.
  async function whatsapp() {
    zone.effacer();
    if (moyen([fichier]) === "natif") {
      const res = await partager([fichier]);
      if (res !== "ok" && res !== "annule") return zone.echec({ titre: tr("Le partage a échoué : le PDF n'est pas parti, enregistrez-le puis joignez-le dans WhatsApp."), erreur: res.erreur, boutons: boutonsRepli() });
      if (res === "annule") return;
    } else {
      await ouvrirConversation();
    }
    await apres();
  }

  // Alternative sur ordinateur : la feuille de partage du système (macOS, Windows), quand le navigateur la propose.
  async function partagerSysteme() {
    zone.effacer();
    const res = await partager([fichier]);
    if (res !== "ok" && res !== "annule") return zone.echec({ titre: tr("Le partage a échoué : le PDF n'est pas parti, enregistrez-le puis joignez-le dans WhatsApp."), erreur: res.erreur, boutons: boutonsRepli() });
    if (res === "ok") await apres();
  }

  // Ordinateur : le PDF ne peut pas se coller (le presse-papiers du navigateur ne prend pas les PDF) : il est enregistré, la conversation s'ouvre,
  // et l'état reste à l'écran avec le nom du fichier à joindre.
  async function ouvrirConversation() {
    telechargerPdf();
    const lien = lienWhatsApp(tel, message);
    const fenetre = window.open(lien, "_blank");
    if (fenetre) fenetre.opener = null;
    zone.succes({
      titre: tr("Fichier à joindre : {nom}. Il est envoyé dans vos téléchargements.", { nom: fichier.name }),
      etapes: [
        fenetre ? tr("La conversation s'ouvre dans un nouvel onglet. Sinon, utilisez le bouton « Ouvrir WhatsApp ».") : tr("Le navigateur a bloqué l'ouverture de l'onglet : cliquez sur « Ouvrir WhatsApp »."),
        tr("Si le fichier n'apparaît pas dans vos téléchargements, cliquez sur « Enregistrer de nouveau »."),
        tr("Glissez le fichier dans la conversation, ou cliquez sur le trombone puis « Document » et choisissez-le dans vos téléchargements."),
        tr("Le message est déjà écrit dans la conversation : envoyez-le avec le fichier."),
      ],
      boutons: [
        h("a", { class: "bouton principal", href: lien, target: "_blank", rel: "noopener" }, tr("Ouvrir WhatsApp")),
        h("button", { class: "secondaire", type: "button", onclick: telechargerPdf }, tr("Enregistrer de nouveau")),
        h("button", { class: "secondaire", type: "button", onclick: () => copierTexte(message) }, tr("Copier le message")),
      ],
    });
  }

  // Sur ordinateur, le PDF est téléchargé puis le courrier s'ouvre : un lien mailto ne peut pas joindre de fichier.
  async function courriel() {
    telechargerPdf();
    const objet = doc.type === "devis" ? (doc.contenu.langue === "en" ? "Your quote" : "Votre devis") : doc.contenu.langue === "en" ? "Your invoice" : "Votre facture";
    window.location.href = `mailto:${encodeURIComponent(client.email).replace(/%40/g, "@")}?subject=${encodeURIComponent(`${objet} ${dossier.ref || ""}`.trim())}&body=${encodeURIComponent(message)}`;
    toast(tr("PDF téléchargé : joignez-le au courrier qui s'ouvre."));
    await apres();
  }
  function afficherActions() {
    const chemin = moyen([fichier]);
    const imprimer = sansImpression() ? [] : [h("button", { class: "lien", type: "button", onclick: () => pdf({ ...doc }) }, tr("Imprimer"))];
    const courrielBtn = client.email && chemin !== "natif" ? [h("button", { class: "secondaire", type: "button", onclick: courriel }, tr("Envoyer par e-mail"))] : [];
    if (chemin === "telephone_sans_partage") {
      // Téléphone dont le navigateur ne partage pas de fichier : on le dit tout de suite, sans ouvrir WhatsApp avec un texte seul.
      actions.replaceChildren(...secours({ principal: true }), ...courrielBtn, ...imprimer);
      aide.textContent = "";
      zone.echec({ titre: tr("Ce navigateur ne peut pas joindre le PDF : enregistrez-le, puis joignez-le dans WhatsApp (Safari le fait d'un tap)."), boutons: boutonsRepli() });
      return;
    }
    actions.replaceChildren(
      // Avec le partage du téléphone, la liste propose WhatsApp, Mail, Messages : le libellé ne promet pas une seule application.
      h("button", { class: "principal", type: "button", onclick: whatsapp }, chemin === "natif" ? tr("Partager le PDF") : tr("Envoyer sur WhatsApp")),
      ...(chemin === "ordinateur" && partageFichiers([fichier]) ? [h("button", { class: "secondaire", type: "button", onclick: partagerSysteme }, tr("Partager avec le système"))] : []),
      ...courrielBtn,
      ...secours(),
      ...imprimer
    );
    aide.textContent = chemin === "natif" ? tr("La liste de partage s'ouvre avec le PDF : choisissez WhatsApp, Mail ou Messages, puis le contact. Le message se copie à part.") : tr("WhatsApp ne reçoit pas de fichier par un lien : le PDF est téléchargé, joignez-le dans la conversation qui s'ouvre.");
  }

  // Dès l'ouverture, le message se copie ; le PDF s'enregistre dès qu'il est prêt.
  actions.replaceChildren(...secours());
  const titre = doc.type === "devis" ? tr("Envoyer le devis") : tr("Envoyer la facture");
  modal(titre, h("div", { class: "modal-corps envoi-voucher" }, h("p", { class: "envoi-resume" }, h("strong", null, `${doc.type === "devis" ? tr("Devis") : tr("Facture")} ${dossier.ref || ""}`.trim()), h("span", null, [nomClient(client), client.telephone || client.email].filter(Boolean).join(" · "))), apercu, actions, h("p", { class: "envoi-message" }, message), aide, zone.noeud), { large: true, protege: false });

  fabriquerPdf(doc)
    .then(({ nom, blob, apercu: page }) => {
      fichier = new File([blob], nom, { type: "application/pdf" });
      // Aperçu : la première page, redessinée depuis le JPEG déjà fabriqué.
      if (adresse) URL.revokeObjectURL(adresse);
      adresse = URL.createObjectURL(new Blob([page.jpeg], { type: "image/jpeg" }));
      apercu.replaceChildren(h("img", { src: adresse, alt: nom }));
      afficherActions();
      zone.maj();
    })
    .catch((err) => {
      apercu.replaceChildren(h("p", { class: "erreur-form", role: "alert" }, tr("Le PDF n'a pas pu être fabriqué : {message}", { message: err.message })));
      zone.echec({ titre: tr("Le PDF n'a pas pu être fabriqué."), erreur: err });
      actions.replaceChildren(h("button", { class: "secondaire", type: "button", onclick: () => copierTexte(message) }, tr("Copier le message")), ...(sansImpression() ? [] : [h("button", { class: "secondaire", type: "button", onclick: () => pdf({ ...doc }) }, tr("Imprimer"))]));
    });
}
