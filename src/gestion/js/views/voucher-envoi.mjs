// Envoi d'un voucher en image : on le fabrique dans la page (l'impression ne fonctionne pas sur la plupart des téléphones), on l'aperçoit,
// puis on le partage (liste de partage du téléphone) ou on l'envoie sur WhatsApp depuis l'ordinateur.
// Sur téléphone, le partage de fichier ouvre la liste de WhatsApp : on y choisit le contact. Un lien WhatsApp ne peut pas joindre d'image, donc
// on ne peut pas écrire directement dans la conversation d'un numéro. Sur ordinateur, la conversation du numéro s'ouvre et l'image est copiée
// pour être collée (sinon téléchargée).
import { etat, nomClient, partenaireDe, resumeDossier, reglages } from "../etat.mjs";
import { h, modal } from "../ui.mjs";
import { renderVoucher, imprimerVoucher, vouchersDuDossier } from "./voucher.mjs";
import { numeroVoucher, nomFichierVoucher, messageVoucher, lienWhatsApp, controlesVoucher } from "../operations-calc.mjs";
import { chiffres, telWhatsApp } from "../partenaires-calc.mjs";
import { moyen, partageFichiers, partager, enregistrer, copierTexte, copierImage, raccourci, zoneEnvoi } from "./partage.mjs";
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
  const zone = zoneEnvoi({ fichiers: () => (fichier ? [fichier] : []) });

  const enregistrerImage = () => enregistrer([fichier]);
  // Ce qui reste possible quand l'image ne peut pas partir toute seule : l'enregistrer, copier le message, et seulement si on le dit
  // clairement, ouvrir WhatsApp avec le message seul.
  // Destinataires qui ont un message à envoyer : le client, et le prestataire quand son message existe (il porte le prix payé par le client).
  const messages = () => [["client", tr("client"), telClient], ...(partenaire && message.partenaire ? [["partenaire", tr("prestataire"), telPartenaire]] : [])];
  const boutonsCopie = () => messages().map(([pour, nom]) => h("button", { class: "lien", type: "button", onclick: () => copierTexte(message[pour]) }, messages().length > 1 ? tr("Copier le message : {nom}", { nom }) : tr("Copier le message")));
  // Toujours à l'écran, dans tous les cas (même pendant la préparation et même quand tout le reste échoue) : enregistrer l'image et copier le message.
  const secours = ({ principal = false } = {}) => [
    h("button", { class: principal ? "principal" : "secondaire", type: "button", disabled: !fichier, onclick: enregistrerImage }, tr("Enregistrer l'image")),
    ...boutonsCopie(),
  ];
  // Dans le cadre d'état : WhatsApp avec le message seul, étiqueté sans ambiguïté, jamais ouvert tout seul.
  const boutonsRepli = () => messages().map(([pour, nom, tel]) => h("a", { class: "bouton secondaire", href: lienWhatsApp(tel, message[pour]), target: "_blank", rel: "noopener" }, messages().length > 1 ? tr("Ouvrir WhatsApp ({nom}) avec le message seul, sans l'image", { nom }) : tr("Ouvrir WhatsApp avec le message seul, sans l'image")));

  // Partage natif : appelé directement par le tap, l'image est déjà prête (sinon le navigateur refuse, NotAllowedError).
  async function partagerImage() {
    zone.effacer();
    const res = await partager([fichier]);
    if (res === "ok" || res === "annule") return;
    zone.echec({ titre: tr("Le partage a échoué : l'image n'est pas partie, enregistrez-la puis joignez-la dans WhatsApp."), erreur: res.erreur, boutons: boutonsRepli() });
  }

  // Ordinateur : l'image est copiée dans le presse-papiers (et on le vérifie), puis la conversation du numéro s'ouvre ; la personne colle l'image
  // avec Cmd+V ou Ctrl+V. Le message est déjà écrit dans la conversation. Si la copie échoue, on le dit avec la raison et rien ne s'ouvre tout seul.
  async function envoyerOrdinateur(pour, { ouvrir = true } = {}) {
    zone.effacer();
    const res = await copierImage(fichier);
    const tel = pour === "partenaire" ? telPartenaire : telClient;
    const lien = lienWhatsApp(tel, message[pour]);
    const nom = pour === "partenaire" ? tr("le prestataire") : tr("le client");
    if (!res.ok) {
      zone.echec({
        titre: tr("L'image n'a pas pu être copiée ({raison}) : enregistrez-la, puis joignez-la dans WhatsApp.", { raison: res.raison }),
        erreur: res.erreur,
        boutons: [
          h("button", { class: "secondaire", type: "button", onclick: () => envoyerOrdinateur(pour) }, tr("Réessayer la copie")),
          h("a", { class: "bouton secondaire", href: lien, target: "_blank", rel: "noopener" }, tr("Ouvrir WhatsApp avec le message seul, sans l'image")),
        ],
      });
      return;
    }
    // window.open renvoie null quand le navigateur bloque l'onglet (fréquent après une attente) : on le dit au lieu d'annoncer une ouverture qui n'a pas eu lieu.
    const fenetre = ouvrir ? window.open(lien, "_blank") : {};
    if (fenetre && ouvrir) fenetre.opener = null;
    zone.succes({
      titre: tr("Image copiée. Dans WhatsApp, collez-la avec {raccourci}.", { raccourci: raccourci() }),
      etapes: [
        !ouvrir ? tr("Ouvrez la conversation avec {nom} avec le bouton « Ouvrir WhatsApp ».", { nom }) : fenetre ? tr("La conversation avec {nom} s'ouvre dans un nouvel onglet. Sinon, utilisez le bouton « Ouvrir WhatsApp ».", { nom }) : tr("Le navigateur a bloqué l'ouverture de l'onglet : cliquez sur « Ouvrir WhatsApp » pour ouvrir la conversation avec {nom}.", { nom }),
        tr("Cliquez dans la zone de message, collez l'image avec {raccourci}, puis envoyez-la.", { raccourci: raccourci() }),
        tr("Le message est déjà écrit dans la conversation : envoyez-le ensuite."),
      ],
      boutons: [
        h("a", { class: "bouton principal", href: lien, target: "_blank", rel: "noopener" }, tr("Ouvrir WhatsApp")),
        h("button", { class: "secondaire", type: "button", onclick: () => envoyerOrdinateur(pour, { ouvrir: false }) }, tr("Copier l'image de nouveau")),
        h("button", { class: "secondaire", type: "button", onclick: () => copierTexte(message[pour]) }, tr("Copier le message")),
        h("button", { class: "secondaire", type: "button", onclick: enregistrerImage }, tr("Enregistrer l'image")),
      ],
    });
  }

  // Plusieurs images ne tiennent pas dans le presse-papiers : on les copie une à une, chaque image à son tour, avec l'état à l'écran.
  async function copierUne(f) {
    const res = await copierImage(f);
    const boutons = fichiersTous.map((g) => h("button", { class: g === f && res.ok ? "principal" : "secondaire", type: "button", onclick: () => copierUne(g) }, tr("Copier : {nom}", { nom: g.name })));
    const tousEnregistrer = h("button", { class: "secondaire", type: "button", onclick: () => enregistrer(fichiersTous) }, tr("Enregistrer toutes les images"));
    if (!res.ok) return zone.echec({ titre: tr("L'image n'a pas pu être copiée ({raison}) : enregistrez les images, puis joignez-les dans WhatsApp.", { raison: res.raison }), erreur: res.erreur, boutons: [h("button", { class: "principal", type: "button", onclick: () => enregistrer(fichiersTous) }, tr("Enregistrer toutes les images"))] });
    zone.succes({ titre: tr("Image copiée : {nom}. Collez-la avec {raccourci}.", { nom: f.name, raccourci: raccourci() }), etapes: [tr("Collez l'image dans la conversation WhatsApp et envoyez-la."), tr("Revenez ici et copiez l'image suivante.")], boutons: [...boutons, tousEnregistrer] });
  }

  // Tous les vouchers du dossier dans une seule conversation : les images se préparent en arrière-plan, puis un seul tap les envoie.
  // Le partage doit partir d'un tap, pas après plusieurs secondes de calcul : d'où le bouton qui n'apparaît actif qu'une fois tout prêt.
  const freres = vouchersDuDossier(dossier.id);
  const boutonTous = h("button", { class: "secondaire", type: "button", disabled: true, hidden: freres.length < 2 });
  let fichiersTous = null;
  let ferme = false; // fenêtre fermée : on arrête de fabriquer des images dont personne ne se servira
  async function preparerTous() {
    const fichiers = [];
    for (const [i, y] of freres.entries()) {
      if (ferme) return;
      boutonTous.textContent = tr("Préparation des vouchers {i} sur {n}…", { i: i + 1, n: freres.length });
      const blob = y.reservation.id === r.id && fichier ? fichier : await imageVoucher(y);
      fichiers.push(new File([blob], nomFichierVoucher(numeroVoucher(dossier.ref || "", y.index), nomClient(client)), { type: "image/png" }));
    }
    fichiersTous = fichiers;
    boutonTous.disabled = false;
    const chemin = moyen(fichiers);
    boutonTous.textContent = chemin === "natif" ? tr("Partager les {n} vouchers du dossier", { n: freres.length }) : chemin === "ordinateur" ? tr("Copier les {n} images une à une", { n: freres.length }) : tr("Enregistrer les {n} images du dossier", { n: freres.length });
  }
  boutonTous.addEventListener("click", async () => {
    if (!fichiersTous) return;
    zone.effacer();
    const chemin = moyen(fichiersTous);
    if (chemin === "ordinateur") {
      zone.succes({ titre: tr("Choisissez l'image à copier, puis collez-la dans la conversation."), boutons: [...fichiersTous.map((g) => h("button", { class: "secondaire", type: "button", onclick: () => copierUne(g) }, tr("Copier : {nom}", { nom: g.name }))), h("button", { class: "secondaire", type: "button", onclick: () => enregistrer(fichiersTous) }, tr("Enregistrer toutes les images"))] });
      return;
    }
    if (chemin !== "natif") return enregistrer(fichiersTous);
    const res = await partager(fichiersTous);
    if (res === "ok" || res === "annule") return;
    zone.echec({ titre: tr("Le partage a échoué : les images ne sont pas parties, enregistrez-les puis joignez-les dans WhatsApp."), erreur: res.erreur, boutons: [h("button", { class: "principal", type: "button", onclick: () => enregistrer(fichiersTous) }, tr("Enregistrer les images")), ...boutonsCopie()] });
  });

  const etiquette = (pour) => (pour === "client" ? tr("WhatsApp : client") : tr("WhatsApp : prestataire"));
  function afficherActions() {
    const chemin = moyen([fichier]);
    const destinataires = [["client"]];
    if (partenaire) destinataires.push(["partenaire"]);
    const imprimer = window.matchMedia("(hover: hover)").matches ? [h("button", { class: "lien", type: "button", onclick: () => imprimerVoucher(x) }, tr("PDF"))] : [];
    if (chemin === "natif") {
      // Un seul bouton évident : la liste de partage du téléphone choisit l'application et le contact, l'image y est jointe.
      actions.replaceChildren(
        h("button", { class: "principal", type: "button", onclick: partagerImage }, tr("Partager l'image du voucher")),
        boutonTous,
        ...secours(),
        ...imprimer
      );
      aide.textContent = tr("La liste de partage s'ouvre avec l'image : choisissez WhatsApp, puis le contact. Le message se copie à part, à coller sous l'image si vous le voulez.");
    } else if (chemin === "ordinateur") {
      actions.replaceChildren(
        ...destinataires.map(([pour], i) => h("button", { class: i === 0 ? "principal" : "secondaire", type: "button", onclick: () => envoyerOrdinateur(pour) }, destinataires.length === 1 ? tr("Envoyer sur WhatsApp") : etiquette(pour))),
        ...(partageFichiers([fichier]) ? [h("button", { class: "secondaire", type: "button", onclick: partagerImage }, tr("Partager avec le système"))] : []),
        boutonTous,
        ...secours(),
        ...imprimer
      );
      aide.textContent = tr("Un lien WhatsApp ne peut pas joindre d'image : l'image est copiée, puis la conversation s'ouvre et vous la collez avec {raccourci}. Sans numéro, WhatsApp propose de choisir le contact.", { raccourci: raccourci() });
    } else {
      // Téléphone dont le navigateur ne partage pas de fichier : on le dit tout de suite, sans ouvrir WhatsApp avec un texte seul.
      actions.replaceChildren(...secours({ principal: true }), boutonTous, ...imprimer);
      aide.textContent = tr("Appuyez longuement sur l'image pour l'enregistrer dans Photos, puis joignez-la dans WhatsApp.");
      zone.echec({ titre: tr("Ce navigateur ne peut pas joindre l'image : enregistrez-la, puis joignez-la dans WhatsApp (Safari le fait d'un tap)."), boutons: boutonsRepli() });
    }
  }

  // Dès l'ouverture, le message se copie ; l'image s'enregistre dès qu'elle est prête.
  actions.replaceChildren(...secours());
  modal(
    tr("Voucher {numero}", { numero }),
    h(
      "div",
      { class: "modal-corps envoi-voucher" },
      avertissements.length ? h("ul", { class: "bandeau-info avertissements-voucher", role: "status" }, avertissements.map((c) => h("li", null, tr(AVERTISSEMENTS[c])))) : null,
      h("p", { class: "aide" }, [client.telephone ? `${nomClient(client)} ${client.telephone}` : nomClient(client), partenaire ? `${partenaire.nom}${telPartenaire ? ` ${telPartenaire}` : ""}` : ""].filter(Boolean).join(" · ")),
      apercu,
      actions,
      aide,
      zone.noeud
    ),
    { large: true, protege: false, ferme: () => (ferme = true) }
  );

  imageVoucher(x)
    .then((blob) => {
      fichier = new File([blob], nomFichier, { type: "image/png" });
      if (adresseApercu) URL.revokeObjectURL(adresseApercu);
      adresseApercu = URL.createObjectURL(blob);
      apercu.replaceChildren(h("img", { src: adresseApercu, alt: tr("Voucher {numero}", { numero }) }));
      afficherActions();
      zone.maj();
      if (freres.length > 1) preparerTous().catch((err) => zone.echec({ titre: tr("Les autres vouchers n'ont pas pu être préparés."), erreur: err }));
    })
    .catch((err) => {
      apercu.replaceChildren(h("p", { class: "erreur-form", role: "alert" }, tr("L'image n'a pas pu être fabriquée : {message}", { message: err.message })));
      zone.echec({ titre: tr("L'image n'a pas pu être fabriquée."), erreur: err });
      actions.replaceChildren(...boutonsCopie(), ...(window.matchMedia("(hover: hover)").matches ? [h("button", { class: "secondaire", type: "button", onclick: () => imprimerVoucher(x) }, tr("PDF"))] : []));
    });
}
