// « Coller une confirmation » (Jérémy, 18.11.2026), pour Jérémy et les administratrices : la confirmation de course écrite sur WhatsApp
// (« 📢 New booking confirmation: VIP TAXI LANTA, Name:…, Date:… ») devient un dossier et sa Booking confirmation, d'un collage et d'un bouton.
// Lecture : confirmation-calc.mjs. Création : creation-course.mjs, la même que l'écran « Nouveau voucher » de Mook. Rien n'est envoyé tout seul :
// l'image se partage ou se télécharge d'un geste, le dossier s'ouvre d'un lien.
import { etat, naviguer, changerEntite, entitesAccessibles, reglagesDe, permissionsDe, nomClient } from "../etat.mjs";
import { h, modal, toast, icone } from "../ui.mjs";
import { tr, N_ } from "../i18n.mjs";
import { aujourdhui, formatDate } from "../calc.mjs";
import { lireConfirmation, erreursConfirmation, entreprisesConfirmation, clientExistant } from "../confirmation-calc.mjs";
import { donneesVoucher, valeursVides } from "../voucher-rapide-calc.mjs";
import { RETOUR_DEPART } from "../trajet-calc.mjs";
import { estBookingConfirmation } from "../taxi-calc.mjs";
import { nomFichierVoucher, numeroVoucher } from "../operations-calc.mjs";
import { creerCourse } from "./creation-course.mjs";
import { imageVoucher } from "./voucher-envoi.mjs";
import { moyen, partager, enregistrer, copierImage } from "./partage.mjs";

const EXEMPLE = "📢 New booking confirmation:\nVIP TAXI LANTA\nName: Enzo\nDate: November 22nd 2026\nPick-up time: 4:30pm\nPick-up location: Manao villa no 24\nDrop-off location: Rock bar restaurant (and round trip)\nNumber of passengers: 5 people no luggage\nPrice: 1000 THB\nRemark: 50th birthday";

// Les erreurs de l'écran de Mook, en français pour qui colle la confirmation.
const ERREURS = {
  e_vide: N_("À remplir."),
  e_thai: N_("En anglais : le client ne lit pas le thaï."),
  e_date: N_("Date illisible : choisissez-la."),
  e_heure: N_("Heure illisible : choisissez-la."),
  e_adultes: N_("Au moins un adulte."),
  e_passagers: N_("Nombre de passagers absent : indiquez au moins un adulte."),
  e_nombre: N_("Un nombre entier."),
  e_prix: N_("Prix absent ou illisible : écrivez-le en chiffres."),
  e_sieges: N_("Plus de sièges que d'enfants."),
  e_tel: N_("Numéro incorrect."),
  e_duree: N_("Durée en heures, par exemple 3."),
};

const entreprises = (marque) => entreprisesConfirmation({ entites: entitesAccessibles(), reglages: (id) => reglagesDe(id), permissions: (id) => permissionsDe(id), marque });

// `texteInitial` : une confirmation déjà collée ailleurs (« Coller une demande » propose la bascule), lue dès l'ouverture.
export function ouvrirConfirmation(texteInitial = "") {
  const depart = etat.entiteId;
  let fermer;
  let essai = { clientId: null, dossierId: null, entite: null };
  let lu = null;
  const zone = h("textarea", { id: "cc-texte", rows: 9, placeholder: EXEMPLE, autocomplete: "off", spellcheck: "false" });
  const apercu = h("div", { class: "cc-apercu", "aria-live": "polite" });

  // ---- Champs modifiables -------------------------------------------------------------------------------------------------
  const champs = {};
  const erreurs = {};
  const champ = (cle, libelle, controle, classe = "") => {
    controle.id = `cc-${cle}`;
    champs[cle] = controle;
    erreurs[cle] = h("p", { class: "cc-erreur", id: `cc-${cle}-erreur`, role: "alert", hidden: true });
    controle.setAttribute("aria-describedby", `cc-${cle}-erreur`);
    controle.addEventListener("input", () => {
      erreurs[cle].hidden = true;
      controle.removeAttribute("aria-invalid");
    });
    return h("div", { class: `champ ${classe}`.trim() }, h("label", { for: controle.id }, libelle), controle, erreurs[cle]);
  };
  const texte = () => h("input", { type: "text", autocomplete: "off" });
  const nombre = () => h("input", { type: "text", inputmode: "numeric", autocomplete: "off" });
  const blocChamps = h(
    "div",
    { class: "grille-form" },
    champ("nom", tr("Nom du client"), texte()),
    champ("telephone", tr("WhatsApp du client (facultatif)"), h("input", { type: "tel", autocomplete: "off" })),
    champ("date", tr("Date"), h("input", { type: "date" })),
    champ("heure", tr("Heure de prise en charge"), h("input", { type: "time", step: 300 })),
    champ("trajet", tr("Trajet"), h("select", null, h("option", { value: "" }, tr("Aller simple")), h("option", { value: RETOUR_DEPART }, tr("Aller puis retour au point de départ")))),
    champ("pickup", tr("Prise en charge"), texte()),
    champ("dropoff", tr("Dépose"), texte(), "cc-si-simple"),
    champ("programme", tr("Programme (en anglais)"), texte(), "cc-si-retour"),
    champ("duree", tr("Durée en heures (facultatif)"), h("input", { type: "text", inputmode: "decimal", autocomplete: "off" }), "cc-si-retour"),
    champ("vol", tr("Vol ou bateau (facultatif)"), texte()),
    champ("adultes", tr("Adultes"), nombre()),
    champ("enfants", tr("Enfants"), nombre()),
    champ("bagages", tr("Bagages"), texte()),
    champ("sieges", tr("Sièges enfant"), nombre()),
    champ("prix", tr("Prix (payé au chauffeur)"), h("input", { type: "text", inputmode: "decimal", autocomplete: "off" })),
    champ("remarques", tr("Remarque imprimée sur la Booking confirmation"), h("textarea", { rows: 2 }), "cc-large"),
    champ("notes", tr("Note interne du dossier (jamais imprimée)"), h("textarea", { rows: 2 }), "cc-large")
  );
  const majTrajet = () => {
    const retour = champs.trajet.value === RETOUR_DEPART;
    for (const n of blocChamps.querySelectorAll(".cc-si-simple")) n.hidden = retour;
    for (const n of blocChamps.querySelectorAll(".cc-si-retour")) n.hidden = !retour;
  };
  champs.trajet.addEventListener("change", majTrajet);

  // Entreprise : celle de la ligne de marque (« VIP TAXI LANTA », « SECRET TRAVEL & TOUR »), Taxi par défaut, modifiable.
  const choixEntreprise = h("div", { class: "cc-entreprises" });
  const entrepriseChoisie = () => (choixEntreprise.querySelector("input:checked") || {}).value || null;
  const dessinerEntreprises = (marque) => {
    const { liste, choisie, introuvable } = entreprises(marque);
    choixEntreprise.replaceChildren(...liste.map((e) => h("label", { class: "cc-entreprise" }, h("input", { type: "radio", name: "cc-entreprise", value: e.id, checked: !!choisie && e.id === choisie.id, onchange: () => dessinerClient() }), h("span", null, e.nom))));
    if (introuvable) choixEntreprise.append(h("p", { class: "cc-erreur" }, tr("La confirmation est pour une entreprise où vous ne créez pas de dossier : choisissez-en une.")));
  };

  // Client déjà connu dans l'entreprise choisie (même WhatsApp, sinon même nom) : proposé d'office, « Nouveau client » reste possible.
  const blocClient = h("div", { class: "cc-client", "aria-live": "polite" });
  let clientTrouve = null;
  const dessinerClient = () => {
    const id = entrepriseChoisie();
    clientTrouve = id ? clientExistant({ nom: champs.nom.value, telephone: champs.telephone.value, clients: etat.brut.clients.filter((c) => c.entite_id === id) }) : null;
    blocClient.replaceChildren(
      ...(clientTrouve
        ? [
            h("p", null, tr("Client déjà connu : {nom}", { nom: [nomClient(clientTrouve), clientTrouve.telephone].filter(Boolean).join(" · ") })),
            h("label", { class: "case" }, h("input", { type: "radio", name: "cc-client", value: "existant", checked: true }), tr("Utiliser ce client")),
            h("label", { class: "case" }, h("input", { type: "radio", name: "cc-client", value: "nouveau" }), tr("Créer un nouveau client")),
          ]
        : [])
    );
  };
  champs.nom.addEventListener("change", dessinerClient);
  champs.telephone.addEventListener("change", dessinerClient);

  const ignorees = h("div", { class: "cc-ignorees" });
  const etatCreation = h("div", { class: "cc-etat", role: "status" });
  const bouton = h("button", { class: "principal", type: "button", onclick: () => creer() }, tr("Créer le dossier et la Booking confirmation"));

  // ---- Lecture du texte ---------------------------------------------------------------------------------------------------
  function lire() {
    const t = zone.value;
    if (!t.trim()) {
      lu = null;
      apercu.replaceChildren();
      return;
    }
    lu = lireConfirmation(t, { aujourdhui: aujourdhui() });
    const v = lu.valeurs;
    for (const cle of Object.keys(champs)) {
      if (cle === "notes") continue;
      const val = v[cle] ?? "";
      // Une date ou une heure illisible reste vide : le champ le signale, et ce qui a été écrit est montré à côté.
      champs[cle].value = (cle === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(val)) || (cle === "heure" && !/^\d{2}:\d{2}$/.test(val)) ? "" : val;
      erreurs[cle].hidden = true;
      champs[cle].removeAttribute("aria-invalid");
    }
    majTrajet();
    dessinerEntreprises(lu.marque);
    dessinerClient();
    ignorees.replaceChildren(...(lu.ignorees.length ? [h("p", { class: "aide" }, tr("Lignes non reprises (à recopier dans un champ si besoin) :")), h("ul", null, lu.ignorees.map((l) => h("li", null, l)))] : []));
    // Rien de vérifié avant le premier essai de création : les erreurs s'affichent alors toutes, sous chaque champ.
    verifier(false);
    apercu.replaceChildren(
      h("h3", null, tr("Ce qui a été compris")),
      h("p", { class: "aide" }, tr("Corrigez ce qui doit l'être. Rien n'est créé avant le bouton.")),
      h("fieldset", { class: "cc-groupe" }, h("legend", null, tr("Entreprise")), choixEntreprise),
      blocChamps,
      blocClient,
      ignorees,
      etatCreation,
      h("div", { class: "actions" }, bouton)
    );
  }
  zone.addEventListener("input", () => {
    clearTimeout(zone._t);
    zone._t = setTimeout(lire, 250);
  });

  // Les valeurs du formulaire, au format de l'écran de Mook ; `afficher` : les erreurs sous les champs.
  const valeurs = () => ({ ...valeursVides(), ...Object.fromEntries(Object.keys(champs).map((c) => [c, champs[c].value])) });
  function verifier(afficher = true) {
    const v = valeurs();
    const e = erreursConfirmation(v);
    if (!afficher) return e;
    for (const c of Object.keys(champs)) {
      erreurs[c].hidden = !e[c];
      erreurs[c].textContent = e[c] ? tr(ERREURS[e[c]] || ERREURS.e_vide) : "";
      champs[c].toggleAttribute("aria-invalid", !!e[c]);
    }
    return e;
  }

  // ---- Création -----------------------------------------------------------------------------------------------------------
  async function creer() {
    const e = verifier(true);
    const premiere = Object.keys(champs).find((c) => e[c]);
    if (premiere) return champs[premiere].focus();
    const cible = entrepriseChoisie();
    if (!cible) return toast(tr("Choisissez l'entreprise du dossier."), true);
    // Une autre entreprise que lors du premier essai : on repart de zéro (le client et le dossier déjà créés appartiennent à l'autre).
    if (essai.entite !== cible) essai = { clientId: null, dossierId: null, entite: cible };
    bouton.disabled = true;
    bouton.textContent = tr("Création…");
    etatCreation.replaceChildren();
    try {
      // La création se fait dans l'entreprise du dossier, avec ses réglages, sa numérotation et ses droits.
      if (etat.entiteId !== cible) changerEntite(cible, { naviguer: false });
      const v = valeurs();
      const existant = clientTrouve && (blocClient.querySelector("input[name=cc-client]:checked") || {}).value === "existant" ? clientTrouve.id : "";
      const x = donneesVoucher({ ...v, client_id: existant });
      const fait = await creerCourse(x, essai, { notes: champs.notes.value.trim() });
      resultat(fait);
    } catch (err) {
      console.error(err);
      const nom = (entitesAccessibles().find((x) => x.id === cible) || {}).nom || "";
      etatCreation.replaceChildren(h("p", { class: "cc-erreur" }, tr("La création dans {entreprise} n'a pas abouti : {message}. Rien n'est créé deux fois : réessayez.", { entreprise: nom, message: err.message })));
      bouton.disabled = false;
      bouton.textContent = tr("Créer le dossier et la Booking confirmation");
    }
  }

  // Après création : la Booking confirmation, à partager ou télécharger d'un geste, et le lien du dossier. Rien ne part tout seul.
  function resultat(v) {
    const d = v.dossier;
    const ouvrir = h("button", { class: "principal", type: "button", onclick: () => (fermer(), naviguer(`#/dossier/${d.id}`)) }, tr("Ouvrir le dossier {ref}", { ref: d.ref || "" }));
    const image = h("div", { class: "cc-image" }, h("p", { class: "aide" }, tr("Préparation de l'image…")));
    const actions = h("div", { class: "actions" });
    const message = h("div", { role: "status" });
    corps.replaceChildren(
      h("p", { class: "cc-succes" }, icone("coche", 20), tr("Dossier {ref} créé pour {nom}, le {date}.", { ref: d.ref || "", nom: nomClient(v.client), date: formatDate(v.reservation.date_service) })),
      image,
      message,
      actions,
      h("div", { class: "actions" }, ouvrir)
    );
    imageVoucher({ reservation: v.reservation, prestation: null, type: v.type || "transfert", index: v.index || 1, numero: v.numero }, { client: v.client, dossier: d, resume: null })
      .then((blob) => {
        const nom = nomFichierVoucher(v.numero || numeroVoucher(d.ref || "", v.index || 1), nomClient(v.client), { taxi: estBookingConfirmation(v.reservation, v.type, etat.db.reglages) });
        const fichier = new File([blob], nom, { type: "image/png" });
        const url = URL.createObjectURL(blob);
        image.replaceChildren(h("img", { src: url, alt: "Booking confirmation" }));
        const chemin = moyen([fichier]);
        const dire = (t, erreur = false) => message.replaceChildren(h("p", { class: erreur ? "cc-erreur" : "aide" }, t));
        // replaceChildren écrirait « null » : seulement les boutons qui ont un sens sur cet appareil.
        actions.replaceChildren(...[
          chemin === "natif"
            ? h("button", { class: "secondaire", type: "button", onclick: async () => {
                const r = await partager([fichier]);
                if (r !== "ok" && r !== "annule") dire(tr("Le partage n'a pas abouti : téléchargez l'image."), true);
              } }, icone("whatsapp", 18), tr("Partager (WhatsApp…)"))
            : null,
          chemin === "ordinateur"
            ? h("button", { class: "secondaire", type: "button", onclick: async () => dire((await copierImage(fichier)).ok ? tr("Image copiée : collez-la dans WhatsApp.") : tr("Copie impossible : téléchargez l'image."), false) }, tr("Copier l'image"))
            : null,
          h("button", { class: "secondaire", type: "button", onclick: () => enregistrer([fichier]) }, tr("Télécharger l'image")),
        ].filter(Boolean));
      })
      .catch((err) => image.replaceChildren(h("p", { class: "cc-erreur" }, tr("L'image n'a pas pu être faite ({message}) : elle reste disponible depuis le dossier.", { message: err.message }))));
  }

  const corps = h(
    "div",
    { class: "modal-corps confirmation-collee" },
    h("p", { class: "aide" }, tr("Collez la confirmation de course telle qu'elle est écrite sur WhatsApp. L'entreprise se lit sur la ligne de marque (VIP TAXI LANTA, SECRET TRAVEL & TOUR), Taxi par défaut.")),
    h("div", { class: "champ" }, h("label", { for: "cc-texte" }, tr("Confirmation")), zone),
    apercu
  );
  // Fermée après une création dans une autre entreprise : l'écran se redessine dans celle du dossier.
  fermer = modal(tr("Coller une confirmation"), corps, { large: true, protege: false, ferme: () => etat.entiteId !== depart && window.dispatchEvent(new HashChangeEvent("hashchange")) });
  if (typeof texteInitial === "string" && texteInitial.trim()) {
    zone.value = texteInitial;
    lire();
  } else zone.focus();
}
