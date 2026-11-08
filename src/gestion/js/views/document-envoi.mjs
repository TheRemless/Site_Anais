// Envoi d'un devis ou d'une facture en PDF depuis un téléphone, où « Imprimer » ne sait pas enregistrer un PDF : le document est
// photographié dans la page (même rendu que l'aperçu), découpé en pages A4 et mis dans un fichier PDF, à télécharger ou à partager.
// Sur téléphone, le partage de fichier ouvre la liste de WhatsApp (on y choisit le contact). Sur ordinateur, le PDF est téléchargé et la
// conversation du numéro s'ouvre : un lien WhatsApp ne peut pas joindre de fichier.
import { etat, nomClient, peut } from "../etat.mjs";
import { h, modal, toast, confirmer } from "../ui.mjs";
import { aujourdhui, nomFichier } from "../calc.mjs";
import { feuille, telecharger, pdf } from "./commun.mjs";
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

const messageDocument = (doc, prenom) => {
  const en = doc.contenu.langue === "en";
  const nom = doc.type === "devis" ? (en ? "quote" : "devis") : en ? "invoice" : "facture";
  return en ? `Hello${prenom ? ` ${prenom}` : ""}, here is your ${nom}.` : `Bonjour${prenom ? ` ${prenom}` : ""}, voici votre ${nom}.`;
};

// `marquerEnvoye` (facultatif) : appelé si la personne confirme que le document est parti ; il pose la date d'envoi d'un devis.
export function envoyerDocument(doc, { marquerEnvoye = null } = {}) {
  const dossier = etat.db.dossiers.find((d) => d.id === doc.dossier_id) || {};
  const client = etat.db.clients.find((c) => c.id === dossier.client_id) || {};
  const tel = chiffres(client.telephone);
  const message = messageDocument(doc, client.prenom || "");
  const apercu = h("div", { class: "envoi-apercu", "aria-live": "polite" }, h("p", { class: "aide" }, tr("Préparation du PDF…")));
  const actions = h("div", { class: "actions envoi-actions" });
  const aide = h("p", { class: "aide" });
  let fichier = null;
  let adresse = null;
  const peutPartager = () => !!(fichier && navigator.canShare && navigator.canShare({ files: [fichier] }));

  // Un devis qui part sans date d'envoi n'est jamais relancé : on propose de la poser.
  async function apres() {
    if (marquerEnvoye && doc.type === "devis" && !doc.envoye_le && peut("documents.ecrire") && (await confirmer(tr("Ce devis est-il parti chez le client ? Marqué comme envoyé, il apparaît dans « À faire » pour la relance."), tr("Marquer comme envoyé")))) await marquerEnvoye();
  }
  const telechargerPdf = () => telecharger(fichier.name, fichier, "application/pdf");
  async function whatsapp() {
    if (peutPartager()) {
      try {
        await navigator.share({ files: [fichier], text: message });
      } catch (err) {
        if (err.name === "AbortError") return;
        telechargerPdf();
        toast(tr("Le partage a échoué : le PDF est téléchargé, joignez-le dans WhatsApp."), true);
      }
    } else {
      telechargerPdf();
      window.open(lienWhatsApp(tel, message), "_blank", "noopener");
      toast(tr("PDF téléchargé : joignez-le dans la conversation WhatsApp."));
    }
    await apres();
  }

  function afficherActions() {
    actions.replaceChildren(
      h("button", { class: "principal", type: "button", onclick: whatsapp }, tr("Envoyer sur WhatsApp")),
      h("button", { class: "secondaire", type: "button", onclick: async () => (telechargerPdf(), await apres()) }, tr("Télécharger le PDF")),
      ...(sansImpression() ? [] : [h("button", { class: "lien", type: "button", onclick: () => pdf({ ...doc }) }, tr("Imprimer"))])
    );
    aide.textContent = peutPartager() ? tr("WhatsApp s'ouvre avec le PDF : choisissez le contact dans sa liste.") : tr("WhatsApp ne reçoit pas de fichier par un lien : le PDF est téléchargé, joignez-le dans la conversation qui s'ouvre.");
  }

  const titre = doc.type === "devis" ? tr("Envoyer le devis") : tr("Envoyer la facture");
  modal(titre, h("div", { class: "modal-corps envoi-voucher" }, h("p", { class: "aide" }, [nomClient(client), client.telephone].filter(Boolean).join(" ")), apercu, actions, aide), { large: true });

  fabriquerPdf(doc)
    .then(({ nom, blob, apercu: page }) => {
      fichier = new File([blob], nom, { type: "application/pdf" });
      // Aperçu : la première page, redessinée depuis le JPEG déjà fabriqué.
      if (adresse) URL.revokeObjectURL(adresse);
      adresse = URL.createObjectURL(new Blob([page.jpeg], { type: "image/jpeg" }));
      apercu.replaceChildren(h("img", { src: adresse, alt: nom }));
      afficherActions();
    })
    .catch((err) => {
      apercu.replaceChildren(h("p", { class: "erreur-form", role: "alert" }, tr("Le PDF n'a pas pu être fabriqué : {message}", { message: err.message })));
      actions.replaceChildren(...(sansImpression() ? [] : [h("button", { class: "secondaire", type: "button", onclick: () => pdf({ ...doc }) }, tr("Imprimer"))]));
    });
}
