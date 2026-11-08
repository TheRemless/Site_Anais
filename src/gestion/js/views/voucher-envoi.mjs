// Envoi d'un voucher en image : on le fabrique dans la page (l'impression ne fonctionne pas sur la plupart des téléphones), on l'aperçoit,
// puis on le télécharge ou on l'envoie sur WhatsApp.
// Sur téléphone, le partage de fichier ouvre la liste de WhatsApp : on y choisit le contact. Un lien WhatsApp ne peut pas joindre d'image, donc
// on ne peut pas écrire directement dans la conversation d'un numéro. Sur ordinateur, la conversation du numéro s'ouvre et l'image est copiée
// pour être collée (sinon téléchargée).
import { etat, nomClient, partenaireDe, resumeDossier, reglages } from "../etat.mjs";
import { h, modal, toast } from "../ui.mjs";
import { renderVoucher, imprimerVoucher } from "./voucher.mjs";
import { telecharger } from "./commun.mjs";
import { numeroVoucher, nomFichierVoucher, messageVoucher, lienWhatsApp } from "../operations-calc.mjs";
import { chiffres, telWhatsApp } from "../partenaires-calc.mjs";
import { tr } from "../i18n.mjs";

// Image PNG d'un voucher, à deux fois la taille de l'écran pour rester nette. Sans la hauteur minimale d'une page A4 : l'image s'arrête au contenu.
export async function imageVoucher(x) {
  const { default: html2canvas } = await import("../../vendor/html2canvas.mjs");
  const hote = h("div", { class: "hote-image", "aria-hidden": "true" }, renderVoucher(x));
  document.body.append(hote);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await Promise.all([...hote.querySelectorAll("img")].map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
    const canvas = await html2canvas(hote.firstChild, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
    return await new Promise((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error(tr("L'image n'a pas pu être fabriquée.")))), "image/png"));
  } finally {
    hote.remove();
  }
}

let adresseApercu = null;

export function envoyerVoucher(x) {
  const r = x.reservation;
  const dossier = etat.db.dossiers.find((d) => d.id === r.dossier_id) || {};
  const client = etat.db.clients.find((c) => c.id === dossier.client_id) || {};
  const partenaire = partenaireDe(r.partenaire_id);
  const numero = numeroVoucher(dossier.ref || "", x.index);
  const nomFichier = nomFichierVoucher(numero, nomClient(client));
  const telClient = chiffres(client.telephone);
  const telPartenaire = chiffres(telWhatsApp(partenaire));
  const devise = ((resumeDossier(dossier.id) || {}).devise) || reglages().devise || "THB";
  const message = {
    client: messageVoucher({ pour: "client", prenom: client.prenom || "" }),
    partenaire: messageVoucher({ pour: "partenaire", montant: r.montant_vente, devise }),
  };

  const apercu = h("div", { class: "envoi-apercu", "aria-live": "polite" }, h("p", { class: "aide" }, tr("Préparation de l'image…")));
  const actions = h("div", { class: "actions envoi-actions" });
  const aide = h("p", { class: "aide" });
  let fichier = null;
  const peutPartager = () => !!(fichier && navigator.canShare && navigator.canShare({ files: [fichier] }));

  const telechargerImage = () => telecharger(nomFichier, fichier, "image/png");
  async function envoyer(pour) {
    const tel = pour === "partenaire" ? telPartenaire : telClient;
    if (peutPartager()) {
      try {
        await navigator.share({ files: [fichier], text: message[pour] });
      } catch (err) {
        if (err.name === "AbortError") return;
        telechargerImage();
        toast(tr("Le partage a échoué : l'image est téléchargée, joignez-la dans WhatsApp."), true);
      }
      return;
    }
    // Ordinateur : l'image est copiée pour être collée dans la conversation (sinon téléchargée), puis la conversation s'ouvre.
    let copiee = false;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": fichier })]);
      copiee = true;
    } catch {
      telechargerImage();
    }
    window.open(lienWhatsApp(tel, message[pour]), "_blank", "noopener");
    toast(copiee ? tr("Image copiée : collez-la dans la conversation WhatsApp (Ctrl+V).") : tr("Image téléchargée : joignez-la dans la conversation WhatsApp."));
  }

  const etiquette = (pour) => (pour === "client" ? tr("WhatsApp : client") : tr("WhatsApp : prestataire"));
  function afficherActions() {
    const destinataires = [["client", telClient]];
    if (partenaire) destinataires.push(["partenaire", telPartenaire]);
    actions.replaceChildren(
      ...destinataires.map(([pour], i) => h("button", { class: i === 0 ? "principal" : "secondaire", type: "button", onclick: () => envoyer(pour) }, destinataires.length === 1 ? tr("Envoyer sur WhatsApp") : etiquette(pour))),
      h("button", { class: "secondaire", type: "button", onclick: telechargerImage }, tr("Télécharger l'image")),
      ...(window.matchMedia("(hover: hover)").matches ? [h("button", { class: "lien", type: "button", onclick: () => imprimerVoucher(x) }, tr("PDF"))] : [])
    );
    aide.textContent = peutPartager()
      ? tr("WhatsApp s'ouvre avec l'image : choisissez le contact dans sa liste.")
      : tr("WhatsApp ne reçoit pas d'image par un lien : l'image est copiée, collez-la dans la conversation qui s'ouvre. Sans numéro, WhatsApp propose de choisir le contact.");
  }

  modal(
    tr("Voucher {numero}", { numero }),
    h(
      "div",
      { class: "modal-corps envoi-voucher" },
      h("p", { class: "aide" }, [client.telephone ? `${nomClient(client)} ${client.telephone}` : nomClient(client), partenaire ? `${partenaire.nom}${telPartenaire ? ` ${telPartenaire}` : ""}` : ""].filter(Boolean).join(" · ")),
      apercu,
      actions,
      aide
    ),
    { large: true }
  );

  imageVoucher(x)
    .then((blob) => {
      fichier = new File([blob], nomFichier, { type: "image/png" });
      if (adresseApercu) URL.revokeObjectURL(adresseApercu);
      adresseApercu = URL.createObjectURL(blob);
      apercu.replaceChildren(h("img", { src: adresseApercu, alt: tr("Voucher {numero}", { numero }) }));
      afficherActions();
    })
    .catch((err) => {
      apercu.replaceChildren(h("p", { class: "erreur-form", role: "alert" }, tr("L'image n'a pas pu être fabriquée : {message}", { message: err.message })));
      actions.replaceChildren(...(window.matchMedia("(hover: hover)").matches ? [h("button", { class: "secondaire", type: "button", onclick: () => imprimerVoucher(x) }, tr("PDF"))] : []));
    });
}
