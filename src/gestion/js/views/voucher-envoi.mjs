// Envoi d'un voucher en image : on le fabrique dans la page (l'impression ne fonctionne pas sur la plupart des téléphones), on l'aperçoit,
// puis on le partage (liste de partage du téléphone) ou on l'envoie sur WhatsApp depuis l'ordinateur.
// Sur téléphone, le partage de fichier ouvre la liste de WhatsApp : on y choisit le contact. Un lien WhatsApp ne peut pas joindre d'image, donc
// on ne peut pas écrire directement dans la conversation d'un numéro. Sur ordinateur, la conversation du numéro s'ouvre et l'image est copiée
// pour être collée (sinon téléchargée).
// Un envoi qui part se note tout seul dans le dossier (partage terminé, ou conversation ouverte avec l'image copiée) ; un partage annulé ou en
// échec ne note rien. « Noter les envois » (envois-vouchers.mjs) reste là pour corriger.
import { etat, nomClient, partenaireDe, resumeDossier, reglages, entiteActive, peut, naviguer } from "../etat.mjs";
import { estTaxi } from "../taxi-calc.mjs";
import { messagesDefautPour } from "../defauts.mjs";
import { h, modal, toast } from "../ui.mjs";
import { aujourdhui } from "../calc.mjs";
import { envoiANoter } from "../envoi-voucher-calc.mjs";
import { noterEnvoi } from "./envois-vouchers.mjs";
import { renderVoucher, imprimerVoucher, vouchersDuDossier } from "./voucher.mjs";
import { numeroVoucher, nomFichierVoucher, messageVoucher, gabaritConfirmationVoucher, variablesMessage, lienWhatsApp, controlesVoucher } from "../operations-calc.mjs";
import { chiffres } from "../partenaires-calc.mjs";
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
// `contexte` (facultatif) : client et dossier pas encore en base, pour l'aperçu de l'écran « Nouveau voucher » (voir renderVoucher).
export async function imageVoucher(x, contexte = undefined) {
  const { default: html2canvas } = await import("../../vendor/html2canvas.mjs");
  const hote = h("div", { class: "hote-image", "aria-hidden": "true" }, renderVoucher(x, contexte));
  document.body.append(hote);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    // decode() ne se résout jamais dans une page passée en arrière-plan (téléphone qui change d'application) : trois secondes au plus.
    const delai = () => new Promise((ok) => setTimeout(ok, 3000));
    await Promise.all([...hote.querySelectorAll("img")].map((i) => (i.decode ? Promise.race([i.decode().catch(() => {}), delai()]) : null)));
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
  const taxi = estTaxi(reglages());
  const nomFichier = nomFichierVoucher(numero, nomClient(client), { taxi });
  const telClient = chiffres(client.telephone);
  const devise = ((resumeDossier(dossier.id) || {}).devise) || reglages().devise || "THB";
  const message = {
    // Le message de confirmation en anglais de l'entreprise ouverte (« taxi-confirmation-en » pour Taxi), rempli comme les autres messages types.
    client: messageVoucher({
      pour: "client",
      prenom: client.prenom || "",
      gabarit: gabaritConfirmationVoucher((reglages().messages || []).filter((m) => m && m.corps), messagesDefautPour(reglages())),
      vars: variablesMessage({ reservation: r, client, dossier, partenaire: partenaire || {}, entreprise: { nom: (reglages().emetteur || {}).nom || (entiteActive() || {}).nom || "", telephone: (reglages().emetteur || {}).telephone || "", lien_avis: ((reglages().emetteur || {}).lien_avis || "").trim(), devise }, langue: "en" }),
    }),
  };

  const avertissements = controlesVoucher(r, client, x.type || "");
  const apercu = h("div", { class: "envoi-apercu", "aria-live": "polite" }, h("p", { class: "aide" }, tr("Préparation de l'image…")));
  const actions = h("div", { class: "actions envoi-actions" });
  const aide = h("p", { class: "aide" });
  let fichier = null;
  const zone = zoneEnvoi({ fichiers: () => (fichier ? [fichier] : []) });

  const enregistrerImage = () => enregistrer([fichier]);

  // Note l'envoi des vouchers `reservations` à `pour` (« client » ou « partenaire ») si le geste a abouti (`issue`, voir envoiANoter).
  // La fiche se redessine à la fermeture de la fenêtre, pour ne pas bouger la page pendant qu'on colle l'image (ou à la fin de l'écriture si
  // la fenêtre est déjà fermée).
  let note = false;
  async function noter(pour, issue, reservations = [r]) {
    if (!peut("dossiers.ecrire")) return;
    const date = aujourdhui();
    let n = 0;
    for (const y of reservations) {
      const courante = etat.db.reservations.find((z) => z.id === y.id) || y;
      const cible = envoiANoter({ pour, issue, envois: courante.details && courante.details.envois, date });
      if (!cible) continue;
      if (!(await noterEnvoi(courante, cible, date))) break;
      n++;
    }
    if (!n) return;
    note = true;
    // Fenêtre déjà fermée pendant l'écriture : la fiche se redessine maintenant.
    if (ferme) naviguer(location.hash);
    toast(tr("Envoi au client noté dans le dossier."));
  }
  // Ce qui reste possible quand l'image ne peut pas partir toute seule : l'enregistrer, copier le message, et seulement si on le dit
  // clairement, ouvrir WhatsApp avec le message seul.
  // Destinataires qui ont un message à envoyer : le client, et le prestataire quand son message existe (il porte le prix payé par le client).
  // Le client seulement : Anaïs écrit elle-même aux prestataires (Jérémy, 14.11.2026).
  const messages = () => [["client", tr("client"), telClient]];
  const boutonsCopie = () => messages().map(([pour, nom]) => h("button", { class: "lien", type: "button", onclick: () => copierTexte(message[pour]) }, messages().length > 1 ? tr("Copier le message : {nom}", { nom }) : tr("Copier le message")));
  // Toujours à l'écran, dans tous les cas (même pendant la préparation et même quand tout le reste échoue) : enregistrer l'image et copier le message.
  const secours = ({ principal = false } = {}) => [
    h("button", { class: principal ? "principal" : "secondaire", type: "button", disabled: !fichier, onclick: enregistrerImage }, tr("Enregistrer l'image")),
    ...boutonsCopie(),
  ];
  // Dans le cadre d'état : WhatsApp avec le message seul, étiqueté sans ambiguïté, jamais ouvert tout seul.
  const boutonsRepli = () => messages().map(([pour, nom, tel]) => h("a", { class: "bouton secondaire", href: lienWhatsApp(tel, message[pour]), target: "_blank", rel: "noopener" }, messages().length > 1 ? tr("Ouvrir WhatsApp ({nom}) avec le message seul, sans l'image", { nom }) : tr("Ouvrir WhatsApp avec le message seul, sans l'image")));

  // Partage natif : appelé directement par le tap, l'image est déjà prête (sinon le navigateur refuse, NotAllowedError).
  // `pour` : le destinataire du bouton touché ; sans destinataire connu, rien n'est noté.
  async function partagerImage(pour) {
    zone.effacer();
    const res = await partager([fichier]);
    if (res === "ok") return noter(pour, "partage");
    if (res === "annule") return;
    zone.echec({ titre: tr("Le partage a échoué : l'image n'est pas partie, enregistrez-la puis joignez-la dans WhatsApp."), erreur: res.erreur, boutons: boutonsRepli() });
  }

  // Ordinateur : l'image est copiée dans le presse-papiers (et on le vérifie), puis la conversation du numéro s'ouvre ; la personne colle l'image
  // avec Cmd+V ou Ctrl+V. Le message est déjà écrit dans la conversation. Si la copie échoue, on le dit avec la raison et rien ne s'ouvre tout seul.
  async function envoyerOrdinateur(pour, { ouvrir = true } = {}) {
    zone.effacer();
    const res = await copierImage(fichier);
    const tel = telClient;
    const lien = lienWhatsApp(tel, message[pour]);
    const nom = tr("le client");
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
    if (fenetre && ouvrir) {
      fenetre.opener = null;
      noter(pour, "conversation");
    }
    zone.succes({
      titre: tr("Image copiée. Dans WhatsApp, collez-la avec {raccourci}.", { raccourci: raccourci() }),
      etapes: [
        !ouvrir ? tr("Ouvrez la conversation avec {nom} avec le bouton « Ouvrir WhatsApp ».", { nom }) : fenetre ? tr("La conversation avec {nom} s'ouvre dans un nouvel onglet. Sinon, utilisez le bouton « Ouvrir WhatsApp ».", { nom }) : tr("Le navigateur a bloqué l'ouverture de l'onglet : cliquez sur « Ouvrir WhatsApp » pour ouvrir la conversation avec {nom}.", { nom }),
        tr("Cliquez dans la zone de message, collez l'image avec {raccourci}, puis envoyez-la.", { raccourci: raccourci() }),
        tr("Le message est déjà écrit dans la conversation : envoyez-le ensuite."),
      ],
      boutons: [
        h("a", { class: "bouton principal", href: lien, target: "_blank", rel: "noopener", onclick: () => noter(pour, "conversation") }, tr("Ouvrir WhatsApp")),
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
      fichiers.push(new File([blob], nomFichierVoucher(numeroVoucher(dossier.ref || "", y.index), nomClient(client), { taxi }), { type: "image/png" }));
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
    // Tous les vouchers dans une seule conversation : c'est celle du client (chaque prestataire n'a que le sien).
    if (res === "ok") return noter("client", "partage", freres.map((y) => y.reservation));
    if (res === "annule") return;
    zone.echec({ titre: tr("Le partage a échoué : les images ne sont pas parties, enregistrez-les puis joignez-les dans WhatsApp."), erreur: res.erreur, boutons: [h("button", { class: "principal", type: "button", onclick: () => enregistrer(fichiersTous) }, tr("Enregistrer les images")), ...boutonsCopie()] });
  });

  function afficherActions() {
    const chemin = moyen([fichier]);
    const destinataires = [["client"]];
    const imprimer = window.matchMedia("(hover: hover)").matches ? [h("button", { class: "lien", type: "button", onclick: () => imprimerVoucher(x) }, tr("PDF"))] : [];
    if (chemin === "natif") {
      // La liste de partage du téléphone choisit l'application et le contact, l'image y est jointe. Sans prestataire, un seul bouton évident ;
      // avec un prestataire, un bouton par destinataire, pour noter à qui le voucher est parti.
      actions.replaceChildren(
        ...(destinataires.length === 1
          ? [h("button", { class: "principal", type: "button", onclick: () => partagerImage("client") }, tr("Partager l'image du voucher"))]
          : destinataires.map(([pour], i) => h("button", { class: i === 0 ? "principal" : "secondaire", type: "button", onclick: () => partagerImage(pour) }, pour === "client" ? tr("Partager : client") : tr("Partager : client")))),
        boutonTous,
        ...secours(),
        ...imprimer
      );
      aide.textContent = tr("La liste de partage s'ouvre avec l'image : choisissez WhatsApp, puis le contact. Le message se copie à part, à coller sous l'image si vous le voulez.");
    } else if (chemin === "ordinateur") {
      actions.replaceChildren(
        ...destinataires.map(([pour], i) => h("button", { class: i === 0 ? "principal" : "secondaire", type: "button", onclick: () => envoyerOrdinateur(pour) }, tr("Envoyer sur WhatsApp"))),
        ...(partageFichiers([fichier]) ? [h("button", { class: "secondaire", type: "button", onclick: () => partagerImage(destinataires.length === 1 ? "client" : undefined) }, tr("Partager avec le système"))] : []),
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
      h("p", { class: "aide" }, [client.telephone ? `${nomClient(client)} ${client.telephone}` : nomClient(client)].filter(Boolean).join(" · ")),
      apercu,
      actions,
      aide,
      zone.noeud
    ),
    {
      large: true,
      protege: false,
      ferme: () => {
        ferme = true;
        if (note) naviguer(location.hash);
      },
    }
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
