// PDF des factures pour la fiduciaire : un seul fichier, une facture par page (ou plus si elle déborde), le plus simple à envoyer par e-mail ou WhatsApp.
// Même rendu que l'aperçu et que les factures des clients : renderDocument avec l'émetteur copié le jour de l'émission.
import { etat } from "../etat.mjs";
import { h } from "../ui.mjs";
import { renderDocument } from "../document.mjs";
import { contenuDepuisFacture, reglagesFiduciaire } from "../fiduciaire-calc.mjs";
import { construirePdf, decouperPages, hauteurPage } from "../pdf-simple.mjs";
import { tr } from "../i18n.mjs";

const LARGEUR = 794; // A4 à 96 dpi
const ECHELLE = 2;

// Réglages d'apparence (logo, couleurs, libellés) de l'entreprise émettrice : Secret, quelle que soit l'entreprise active.
export function reglagesEmetteur() {
  const brut = etat.brut || {};
  const secret = (brut.entites || []).find((e) => e.slug === "secret" || e.slug === "excursions");
  return (secret && brut.reglages && brut.reglages[secret.id]) || etat.db.reglages;
}

export function feuilleFacture(facture) {
  const { doc, client, dossier } = contenuDepuisFacture(facture);
  return renderDocument({ type: "facture", doc, dossier, client, reglages: reglagesFiduciaire(reglagesEmetteur(), facture), recu: 0 });
}

export const nomFichierFacture = (facture) => `${facture.numero}.pdf`;

// factures : liste triée comme elle doit apparaître. Renvoie { blob, nom }.
export async function fabriquerPdfFactures(factures) {
  const { default: html2canvas } = await import("../../vendor/html2canvas.mjs");
  const pages = [];
  for (const facture of factures) {
    const hote = h("div", { class: "hote-image hote-document", "aria-hidden": "true" }, feuilleFacture(facture));
    document.body.append(hote);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await Promise.all([...hote.querySelectorAll("img")].map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
      const plein = await html2canvas(hote.firstChild, { scale: ECHELLE, backgroundColor: "#ffffff", useCORS: true, logging: false, width: LARGEUR, windowWidth: LARGEUR });
      const hp = hauteurPage(LARGEUR) * ECHELLE;
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
    } finally {
      hote.remove();
    }
  }
  const nom = factures.length === 1 ? factures[0].numero : `${factures[0].numero}_${factures[factures.length - 1].numero}`;
  return { nom: `${nom}.pdf`, blob: new Blob([construirePdf(pages, { titre: nom })], { type: "application/pdf" }) };
}
