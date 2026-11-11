// Envoi d'un voucher en image : on le fabrique dans la page (l'impression ne fonctionne pas sur la plupart des téléphones), on l'aperçoit,
// puis on le télécharge ou on l'envoie sur WhatsApp.
// Sur téléphone, le partage de fichier ouvre la liste de WhatsApp : on y choisit le contact. Un lien WhatsApp ne peut pas joindre d'image, donc
// on ne peut pas écrire directement dans la conversation d'un numéro. Sur ordinateur, la conversation du numéro s'ouvre et l'image est copiée
// pour être collée (sinon téléchargée).
import { etat, nomClient, partenaireDe, resumeDossier, reglages } from "../etat.mjs";
import { h, modal, toast } from "../ui.mjs";
import { renderVoucher, imprimerVoucher, vouchersDuDossier } from "./voucher.mjs";
import { telecharger } from "./commun.mjs";
import { numeroVoucher, nomFichierVoucher, messageVoucher, lienWhatsApp, controlesVoucher } from "../operations-calc.mjs";
import { chiffres, telWhatsApp } from "../partenaires-calc.mjs";
import { tr, N_ } from "../i18n.mjs";

const AVERTISSEMENTS = {
  non_confirmee: N_("La réservation n'est pas confirmée par le partenaire."),
  sans_date: N_("La date du service n'est pas renseignée."),
  sans_heure: N_("L'heure de pickup n'est pas renseignée."),
  sans_lieu: N_("Le lieu de pickup n'est pas renseigné."),
  lieu_adresse_client: N_("Le lieu de pickup n'est pas renseigné : le voucher affichera l'adresse du client."),
};

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

  const avertissements = controlesVoucher(r, client, x.type || "");
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

  // Tous les vouchers du dossier dans une seule conversation : les images se préparent en arrière-plan, puis un seul tap les envoie.
  // Le partage doit partir d'un tap, pas après plusieurs secondes de calcul : d'où le bouton qui n'apparaît actif qu'une fois tout prêt.
  const freres = vouchersDuDossier(dossier.id);
  const boutonTous = h("button", { class: "secondaire", type: "button", disabled: true, hidden: freres.length < 2 });
  let fichiersTous = null;
  async function preparerTous() {
    const fichiers = [];
    for (const [i, y] of freres.entries()) {
      boutonTous.textContent = tr("Préparation des vouchers {i} sur {n}…", { i: i + 1, n: freres.length });
      const blob = y.reservation.id === r.id && fichier ? fichier : await imageVoucher(y);
      fichiers.push(new File([blob], nomFichierVoucher(numeroVoucher(dossier.ref || "", y.index), nomClient(client)), { type: "image/png" }));
    }
    fichiersTous = fichiers;
    boutonTous.disabled = false;
    boutonTous.textContent = tr("Envoyer les {n} vouchers du dossier", { n: freres.length });
  }
  boutonTous.addEventListener("click", async () => {
    if (!fichiersTous) return;
    if (navigator.canShare && navigator.canShare({ files: fichiersTous })) {
      try {
        await navigator.share({ files: fichiersTous, text: message.client });
      } catch (err) {
        if (err.name === "AbortError") return;
        for (const f of fichiersTous) telecharger(f.name, f, "image/png");
        toast(tr("Le partage a échoué : les images sont téléchargées, joignez-les dans WhatsApp."), true);
      }
      return;
    }
    for (const f of fichiersTous) telecharger(f.name, f, "image/png");
    toast(tr("Images téléchargées : joignez-les dans la conversation WhatsApp."));
  });
  const copierMessage = async () => {
    try {
      await navigator.clipboard.writeText(message.client);
      toast(tr("Message copié."));
    } catch {
      toast(tr("Copie impossible dans ce navigateur : sélectionnez le texte à la main."), true);
    }
  };
  const etiquette = (pour) => (pour === "client" ? tr("WhatsApp : client") : tr("WhatsApp : prestataire"));
  function afficherActions() {
    const destinataires = [["client", telClient]];
    if (partenaire) destinataires.push(["partenaire", telPartenaire]);
    actions.replaceChildren(
      ...destinataires.map(([pour], i) => h("button", { class: i === 0 ? "principal" : "secondaire", type: "button", onclick: () => envoyer(pour) }, destinataires.length === 1 ? tr("Envoyer sur WhatsApp") : etiquette(pour))),
      boutonTous,
      h("button", { class: "secondaire", type: "button", onclick: telechargerImage }, tr("Télécharger l'image")),
      h("button", { class: "lien", type: "button", onclick: copierMessage }, tr("Copier le message")),
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
      avertissements.length ? h("ul", { class: "bandeau-info avertissements-voucher", role: "status" }, avertissements.map((c) => h("li", null, tr(AVERTISSEMENTS[c])))) : null,
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
      if (freres.length > 1) preparerTous().catch((err) => (boutonTous.textContent = tr("Les autres vouchers n'ont pas pu être préparés : {message}", { message: err.message })));
    })
    .catch((err) => {
      apercu.replaceChildren(h("p", { class: "erreur-form", role: "alert" }, tr("L'image n'a pas pu être fabriquée : {message}", { message: err.message })));
      actions.replaceChildren(...(window.matchMedia("(hover: hover)").matches ? [h("button", { class: "secondaire", type: "button", onclick: () => imprimerVoucher(x) }, tr("PDF"))] : []));
    });
}
