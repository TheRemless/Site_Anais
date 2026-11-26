// Écran « WhatsApp » (#/whatsapp, migrations 58 et 59) : la boîte du numéro de Nani, un seul pour Secret et VIP Taxi Lanta.
// Nani répond depuis son app WhatsApp Business : ici elle lit, range la conversation dans la bonne entreprise d'un tap, relie le client et
// surtout copie la réponse préparée par l'agent, puis ouvre la conversation dans WhatsApp. L'envoi depuis Gestion reste secondaire.
// Téléphone : la liste, puis la conversation en plein écran avec retour, le bouton Copier en bas sous le pouce. Ordinateur : liste à gauche,
// conversation à droite (même mise en page que l'onglet Assistant).
// Réservé aux administrateurs de Secret et de Taxi (la base l'impose, le menu aussi) : Mook ne voit ni l'écran ni le menu.
// Une notification ouvre « #/whatsapp?c=<conversation>&entite=<entreprise> » : app.mjs passe dans l'entreprise, l'écran ouvre la conversation.
import { etat, modifier, entitesAccessibles, estSuperAdmin, permissionsDe, voitToutDans, nomClient, naviguer, changerEntite, reglagesDe, peut, modeTaxi, resumeDossier } from "../etat.mjs";
import { h, toast, confirmer, icone, puces, modal, champ } from "../ui.mjs";
import { formatMontant, aujourdhui } from "../calc.mjs";
import { clientPourFaits, dossierPourFaits, faitsClient } from "../whatsapp-faits-calc.mjs";
import { tr, N_, langueActive, localeActive } from "../i18n.mjs";
import { quand, bloquantsReponse, resteBloque, agentActif, CONTROLE_IMPOSSIBLE, MONTANT_MASQUE } from "../agent-calc.mjs";
import {
  CLE_DEMANDE_AGENT, modeDossier, paiementSignale, MOTIFS_PAIEMENT, lignesResume, tachesPromesse, piecesProposees, basculerPiece, PIECES_MAX, resumeEnRetard,
} from "../whatsapp-suivi-calc.mjs";
import { selecteurClient } from "./selecteur-client.mjs";
import { ecritConversation, avertissementsVisibles } from "../espace-unifie-calc.mjs";
import { directCoupe } from "../direct-reprise-calc.mjs";
import {
  marqueEntite, lecteurWhatsApp, trierConversations, filtrerConversations, chiffresFiltres, filtreDeDepart, FILTRES, propositionsCourantes,
  etatConversation, nomConversation, numeroAffiche, lienWhatsApp, lireAdresse, adresseConversation, fenetre, envoiPossible, avertissements,
  grouperParJour, heureBangkok, jourBangkok, etatMedia, LIBELLES_MEDIA, libelleType, ORIGINES, erreurEnvoi, envoiIncertain, codeEnvoi, aConfirmerEnvoi, ficheAMettreAJour, LECTURE_IMPOSSIBLE, propositionCourante,
  propositionAJour, entrepriseProposee, reponsesDe, preparationAuto, raisonSansReponse, erreurPreparer, libelleErreurProposition,
  apercuConversation, attenteClient, LIBELLE_SUPPRIME, morceauxReponse, entreprisePourAssistant, nomSaisi, patchNom, NOM_MAX, aTraiter,
} from "../whatsapp-calc.mjs";
import { envoiAVerifier, envoiEnDoute, statutEnvoi, prochainChangement } from "../whatsapp-fiabilite-calc.mjs";
import { TYPES_CONTACT, typeContact, patchType, toastType } from "../apporteurs-calc.mjs";
import { blocApporteurWhatsApp } from "./apporteurs.mjs";
import { noteTypeDeduit } from "./whatsapp-type.mjs";
// Assistant et WhatsApp reliés (PR B, 21.11.2026) : « Demander à l'assistant », vue « À faire », aller au message.
import { demandePermise, conversationLiee, messageCible, SURBRILLANCE_MS, CLE_RETOUR_ENTITE, entiteDeRetour } from "../whatsapp-relie-calc.mjs";
import { aFaireDeLaBoite, listeAFaire } from "./whatsapp-a-faire.mjs";
// Messages manquants (migration 100) : ligne « non transmis » et repère discret, sans IA ni notification.
import { suivreFil, decisionArrivee, ratioMedia, cacheLiens, empreinteMessage } from "../fil-defilement.mjs";
import { ouvrirVisionneuse } from "../visionneuse.mjs";
import { estNonTransmis, repereManque, conversationManque, TEXTE_NON_TRANSMIS, LIBELLE_MANQUE, LIBELLE_NOUVEAU_NUMERO, ancienneConversation } from "../whatsapp-calc.mjs";
// Filtre « Prêt à réserver » (migration 85), à part dans whatsapp-pret.mjs.
import { clientCommun } from "../whatsapp-pret-calc.mjs";
import { FILTRE_PRET, filtrePretDisponible, filtrerPretes, nombrePretes, resumeLignePret, cartePret, videPret } from "./whatsapp-pret.mjs";
// Étapes des conversations de clients (migration 105), à part dans whatsapp-etapes.mjs.
import { etapesDisponibles, conversationClient, filtresEtapes, estFiltreEtape, filtrerParEtape, dansEntreprise, aTrierNonClient, pastillesEtapes, blocEtapes, basculerIA } from "./whatsapp-etapes.mjs";
import { boutonProposerExcursion } from "./proposer-excursion.mjs";

let filtre = null;
const rafraichir = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
// Ce qui doit survivre à un redessin de l'écran (synchronisation, Realtime), par identifiant de proposition :
//   brouillons : le texte modifié par Nani, remis dans la zone au rendu suivant ;
//   envoisIncertains : un envoi au résultat inconnu (délai dépassé, coupure), le bouton Envoyer ne se rallume pas ;
//   aRetirer : ce que whatsapp-envoi a trouvé dans le texte (contenu_interne), lu par bloquantsReponse (montants, empreintes, noms).
const brouillons = new Map();
const envoisIncertains = new Set();
const aRetirer = new Map();

// Les entreprises du numéro où la personne est administratrice : celles proposées par le sélecteur d'entreprise.
export function entitesWhatsApp() {
  if (!etat.brut) return [];
  return entitesAccessibles().filter((e) => lecteurWhatsApp({ entite: e, superAdmin: estSuperAdmin(), permissions: permissionsDe(e.id), voitTout: voitToutDans(e.id) }));
}
const entite = (id) => (etat.brut.entites || []).find((e) => e.id === id) || null;
const marqueDe = (id) => marqueEntite(entite(id));
const clientDe = (c) => (c && c.client_id ? (etat.brut.clients || []).find((x) => x.id === c.client_id) || null : null);
// Migration 63 : la boîte est commune en lecture. Agir sur une conversation (ranger, relier, marquer lue, traiter, envoyer, préparer) demande
// d'administrer son entreprise ; sinon l'écran la montre en lecture seule. `lectureSeule` vaut pour la conversation en cours de dessin.
const peutEcrire = (c) => ecritConversation(c, entitesWhatsApp().map((e) => e.id));
let lectureSeule = false;
const nomEntrepriseConv = (c) => (entite(c.entite_id) || {}).nom || tr("l'autre entreprise");
const dossierDe = (c) => (c && c.dossier_id ? (etat.brut.dossiers || []).find((x) => x.id === c.dossier_id) || null : null);

// ---- Liste ----------------------------------------------------------------------------------------------------------------------
// Comme dans WhatsApp (lot 2, design n° 2) : le nom et l'heure, puis le début du dernier message. À droite, depuis combien de temps le client
// attend (en couleur au-delà de 30 min), l'icône d'une réponse prête et les non-lus. Sans aperçu en base (migration 65 pas encore passée),
// l'état d'avant.
function ligneConversation(c, prop, ouverte) {
  const e = c.entite_id ? entite(c.entite_id) : null;
  const et = etatConversation(c, prop);
  const nonLus = Number(c.non_lus) || 0;
  const ap = apercuConversation(c);
  const att = attenteClient(c, prop);
  const texte = ap.texte || (ap.type === "supprime" ? tr(LIBELLE_SUPPRIME) : ap.type ? tr(libelleType(ap.type)) : "");
  const apercu = texte
    ? h("span", { class: `wa-conv-apercu${!ap.texte && ap.type === "supprime" ? " supprime" : ""}` }, ap.deNani ? h("span", { class: "wa-conv-vous" }, tr("Vous : ")) : null, texte)
    : h("span", { class: `wa-conv-etat ${et.cle}` }, et.libelle ? tr(et.libelle) : "");
  return h(
    "li",
    null,
    h(
      "a",
      // La ligne touchée se marque tout de suite, avant que la conversation arrive (lot 2, design n° 13).
      { href: adresseConversation(c), class: `wa-conv${nonLus ? " non-lue" : ""}`, "aria-current": ouverte ? "page" : null, onclick: (e) => marquerTouchee(e.currentTarget) },
      h(
        "span",
        { class: "wa-conv-ligne" },
        h("span", { class: "wa-conv-nom" }, h("strong", null, nomConversation(c, clientDe(c))), etapesDisponibles() && conversationClient(c) ? pastillesEtapes(c) : h("span", { class: `wa-marque${e ? ` ${marqueEntite(e) || ""}` : " a-trier"}` }, e ? e.nom : tr("À trier"))),
        c.dernier_message_le ? h("time", { datetime: c.dernier_message_le }, quand(c.dernier_message_le, { langue: langueActive() })) : null
      ),
      h(
        "span",
        { class: "wa-conv-ligne" },
        apercu,
        h(
          "span",
          { class: "wa-conv-droite" },
          et.cle === "prete" ? h("span", { class: "wa-conv-prete", title: tr("Réponse prête"), "aria-label": tr("Réponse prête") }, icone("copier", 16)) : null,
          att ? h("span", { class: `wa-attente${att.urgent ? " urgente" : ""}`, title: tr("Le client attend depuis {duree}", { duree: att.texte }), "aria-label": tr("Le client attend depuis {duree}", { duree: att.texte }) }, icone("horloge", 14), att.texte) : null,
          nonLus ? h("span", { class: "agent-pastille", "aria-label": tr("{n} non lus", { n: nonLus }) }, nonLus) : null
        )
      ),
      // Repère discret (migration 100) : effacé au prochain message du client.
      conversationManque(c) ? h("span", { class: "wa-conv-manque" }, tr(LIBELLE_MANQUE)) : null,
      c.meme_client_que ? h("span", { class: "wa-conv-manque" }, tr(LIBELLE_NOUVEAU_NUMERO)) : null,
      filtre === FILTRE_PRET.valeur || filtre === "etape:pret" ? resumeLignePret(c) : null
    )
  );
}

function marquerTouchee(lien) {
  for (const a of document.querySelectorAll(".wa-conv[aria-current]")) a.removeAttribute("aria-current");
  lien.setAttribute("aria-current", "page");
  lien.classList.add("en-ouverture");
}

// ---- Conversation : en-tête ----------------------------------------------------------------------------------------------------
// Secret | VIP Taxi Lanta en un tap. « Proposé par l'agent » quand l'agent l'a rangée ; pour une conversation à trier, l'entreprise
// que l'agent propose est marquée.
function selecteurEntreprise(c, prop) {
  const lecture = lectureSeule ? h("p", { class: "wa-lecture-seule", role: "status" }, icone("alerte", 16), tr("Lecture seule : conversation de {entreprise}", { entreprise: nomEntrepriseConv(c) })) : null;
  // Un client appartient à Secret et à Taxi (migration 105) : ses étapes à la place du choix de l'entreprise, qui se décide par dossier.
  if (etapesDisponibles() && conversationClient(c)) return [lecture, blocEtapes(c, { lectureSeule, rafraichir })];
  if (lectureSeule) return lecture;
  const choix = entitesWhatsApp();
  // L'agent ne range plus la conversation : il propose une entreprise et prépare la réponse avec ses données (migration 59).
  const proposee = !c.entite_id ? entrepriseProposee(prop, choix) : null;
  const ranger = async (e) => {
    if (e.id === c.entite_id) return;
    // La base remplace les propositions ouvertes préparées pour une autre entreprise : une réponse modifiée serait perdue.
    if (prop && prop.statut === "a_faire" && brouillons.has(prop.id) && prop.entite_id !== e.id && !(await confirmer(tr("Vous avez modifié la réponse préparée. La ranger dans {nom} la remplace et vos changements seront perdus. Continuer ?", { nom: e.nom }), tr("Ranger dans {nom}", { nom: e.nom }), true))) return;
    try {
      const r = await modifier("whatsapp_conversations", c.id, { entite_id: e.id });
      // Comme la base : les propositions ouvertes préparées pour une autre entreprise sont remplacées. On le montre sans attendre la relecture.
      for (const x of etat.brut.whatsapp_propositions || []) if (x.conversation_id === c.id && ["a_faire", "en_cours"].includes(x.statut) && x.entite_id !== e.id) (x.statut = "remplacee"), brouillons.delete(x.id);
      toast(tr("Conversation rangée dans {nom}.", { nom: e.nom }));
      naviguer(adresseConversation(r));
    } catch (err) {
      toast(err.message, true);
    }
  };
  return h(
    "div",
    { class: "wa-entreprise", "data-pas-saisie": "" },
    h("div", { class: "wa-segments", role: "group", "aria-label": tr("Entreprise de la conversation") }, choix.map((e) => h("button", { type: "button", class: `wa-segment${proposee && proposee.id === e.id ? " propose" : ""}`, "aria-pressed": e.id === c.entite_id ? "true" : "false", onclick: () => ranger(e) }, e.nom))),
    c.entite_id && c.entite_source === "agent" ? h("span", { class: "wa-note" }, tr("proposé par l'assistant")) : null,
    proposee ? h("span", { class: "wa-note propose" }, tr("Suggéré : {nom}", { nom: proposee.nom })) : null,
    // Avec les contacts typés (migration 68), « Personnel » est une des puces du type : la pastille est alors masquée par la feuille de style.
    reponsesDe(c) === "jamais" ? h("span", { class: "wa-jamais" }, tr("Contact personnel")) : null
  );
}

// Type du contact (migration 68), d'un tap : client, apporteur, partenaire ou personnel (migration 110 : plus de chauffeur ni d'hôtel, nos
// chauffeurs sont des partenaires). Depuis la migration 69, le type ne coupe plus l'IA : partenaire et apporteur se lisent comme un client. Seul « Personnel » ferme (rien envoyé à l'IA) et
// vide le type ; quitter « Personnel » pour un type rouvre (patchType). Le réglage des réponses reste dans le menu « … ». La fonction
// « whatsapp » ne change jamais un type posé ici. Une conversation typée « apporteur » propose de créer ou de relier sa fiche apporteur.
function selecteurType(c) {
  if (etat.brut.whatsapp_contacts_disponible !== true) return null;
  const actuel = typeContact(c);
  const libelle = (k) => tr((TYPES_CONTACT.find(([x]) => x === k) || [, ""])[1]);
  if (lectureSeule) return actuel ? h("p", { class: "wa-note" }, tr("Contact : {type}", { type: libelle(actuel) })) : null;
  const choisir = async (t) => {
    if (t === actuel) return;
    try {
      await modifier("whatsapp_conversations", c.id, patchType(t, c));
      // Le toast dit si l'IA lit ce contact désormais : oui pour tout type, sauf « Personnel » ou un contact réglé « rien envoyé à l'IA ».
      toast(tr(toastType(t, c)));
      rafraichir();
    } catch (err) {
      toast(err.message, true);
    }
  };
  return h(
    "div",
    { class: "wa-contact", "data-pas-saisie": "" },
    h("div", { class: "wa-contacts", role: "group", "aria-label": tr("Type de contact") }, TYPES_CONTACT.map(([k, l]) => h("button", { type: "button", class: "wa-contact-puce", "aria-pressed": k === actuel ? "true" : "false", onclick: () => choisir(k) }, tr(l)))),
    // Migration 110 : partenaire déduit (« Confirmer ») ou probable, avec sa raison.
    noteTypeDeduit(c, { ecrit: !lectureSeule, apres: () => rafraichir() }),
    actuel === "apporteur" ? blocApporteurWhatsApp(c, { ecrit: !lectureSeule, apres: () => rafraichir() }) : null
  );
}

// Réponses préparées pour ce contact (migration 60) : sur demande ou automatiques (selon Réglages), ou jamais (Contact personnel : ami,
// famille). Rangé dans le menu « … » de l'en-tête (lot 2, design n° 7) : il ne sert que pour quelques contacts. Seule Nani le change.
async function basculerReponses(c) {
  const valeur = reponsesDe(c) === "jamais" ? "auto" : "jamais";
  const suggeree = !c.entite_id && c.tri ? entitesWhatsApp().find((e) => marqueEntite(e) === c.tri.entreprise) : null;
  const auto = !!(c.entite_id || suggeree) && preparationAuto(reglagesDe(c.entite_id || suggeree.id));
  try {
    await modifier("whatsapp_conversations", c.id, { reponses: valeur });
    toast(valeur === "jamais" ? tr("Contact personnel : plus rien n'est envoyé à l'IA.") : auto ? tr("Réponses préparées automatiques pour ce contact.") : tr("Réponses sur demande pour ce contact."));
    rafraichir();
  } catch (err) {
    toast(err.message, true);
  }
}

// Le menu « … » de l'en-tête : ce qui sert rarement (relier un autre client, réglage du contact), hors de la vue.
function menuConversation(c) {
  const ici = c.entite_id && c.entite_id === etat.entiteId;
  const client = clientDe(c);
  let fermer;
  const item = (libelle, faire, classe = "secondaire") => h("button", { class: classe, type: "button", onclick: () => (fermer(), faire()) }, libelle);
  const wa = lienWhatsApp(c.telephone);
  fermer = modal(
    nomConversation(c, client),
    h(
      "div",
      { class: "agent-menu" },
      ici && !lectureSeule ? item(client ? tr("Changer le client relié") : tr("Relier un client"), () => ouvrirRelier(c)) : null,
      client ? item(tr("Ouvrir la fiche du client"), () => naviguer(`#/client/${client.id}`)) : null,
      etat.brut.whatsapp_tri_disponible !== false && !lectureSeule ? item(reponsesDe(c) === "jamais" ? tr("Ce n'est plus un contact personnel") : tr("Marquer comme contact personnel (rien envoyé à l'IA)"), () => basculerReponses(c)) : null,
      // IA coupée pour cette conversation (migration 105), sans la classer en Contact personnel.
      etapesDisponibles() && !lectureSeule && reponsesDe(c) !== "jamais" ? item(c.ia_coupee ? tr("Rallumer l'IA pour cette conversation") : tr("Couper l'IA pour cette conversation"), () => basculerIA(c, rafraichir)) : null,
      wa ? h("a", { class: "bouton secondaire", href: wa, target: "_blank", rel: "noopener", onclick: () => fermer() }, icone("whatsapp", 18), tr("Ouvrir dans WhatsApp")) : null
    ),
    { feuille: true, protege: false }
  );
}

function ouvrirRelier(c) {
  // Seulement les fiches de l'entreprise de la conversation : ni une fiche partagée (ZTP) ni une autre entreprise, que la base retirerait.
  const sel = selecteurClient({ id: "wa-client", libelle: tr("Client"), valeur: c.client_id || "", surChangement: () => majDossiers(), filtre: (x) => x.entite_id === c.entite_id });
  const dossiers = h("select", { id: "wa-dossier" });
  const majDossiers = () => {
    const liste = (etat.db.dossiers || []).filter((d) => d.client_id === sel.valeur && d.entite_id === c.entite_id && !d.annule).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    dossiers.replaceChildren(h("option", { value: "" }, tr("Aucun dossier")), ...liste.map((d) => h("option", { value: d.id }, d.ref)));
    dossiers.value = liste.some((d) => d.id === c.dossier_id) ? c.dossier_id : liste[0] ? liste[0].id : "";
  };
  majDossiers();
  let fermer;
  const enregistrer = async () => {
    const choisi = sel.valeur || null;
    try {
      const r = await modifier("whatsapp_conversations", c.id, { client_id: choisi, dossier_id: (choisi && dossiers.value) || null });
      fermer();
      // La base retire un client d'une autre entreprise : on le dit au lieu d'annoncer un client relié.
      if (((r && r.client_id) || null) !== choisi) toast(tr("Ce client n'a pas pu être relié, sa fiche n'est pas dans {nom}.", { nom: (entite(c.entite_id) || {}).nom || "" }), true);
      else toast(choisi ? tr("Client relié.") : tr("Client retiré."));
      rafraichir();
    } catch (err) {
      toast(err.message, true);
    }
  };
  fermer = modal(
    tr("Relier un client"),
    h("div", { class: "modal-corps" }, h("p", { class: "aide" }, tr("Choisissez la fiche de {nom} du client qui écrit depuis {numero}.", { nom: (entite(c.entite_id) || {}).nom || "", numero: numeroAffiche(c.telephone) })), sel.noeud, champ(tr("Dossier"), dossiers), h("div", { class: "barre-modal" }, h("button", { class: "principal", type: "button", onclick: enregistrer }, tr("Enregistrer")))),
    { protege: false }
  );
}

// ---- Nom du contact (migration 70) -------------------------------------------------------------------------------------------------
// Telnyx n'envoie aucun nom : Nani l'écrit ici. Un tap sur le nom (ou le crayon) le change en champ, Entrée ou OK enregistre, Échap ou la
// croix annule. Vider le champ efface le nom saisi. Mêmes droits que pour ranger la conversation : en lecture seule, ni bouton ni crayon.
// La base nettoie le nom (60 caractères) et le protège de la fonction « whatsapp » (nom_source = 'manuel').
const nomModifiable = () => !lectureSeule && etat.brut.whatsapp_nom_disponible === true;
function titreNom(c) {
  const nom = nomConversation(c, clientDe(c));
  if (!nomModifiable()) return h("h2", null, nom);
  return h(
    "h2",
    null,
    h("button", { type: "button", class: "wa-nom-bouton", "aria-label": tr("Changer le nom de {nom}", { nom }), onclick: (e) => editerNom(c, e.currentTarget.closest(".wa-fil-titre")) }, h("span", { class: "wa-nom-texte" }, nom), icone("crayon", 16))
  );
}
// Un nom de source « whatsapp » est celui que le contact a écrit (tri de la fonction, 21.11.2026) : une mention discrète le dit.
function sousTitreNom(c) {
  const client = clientDe(c);
  const ecrit = !!c.nom && c.nom_source === "whatsapp";
  if (!client) return ecrit ? h("span", { class: "wa-nom-source" }, tr("écrit par le contact")) : null;
  if (nomSaisi(c)) return h("span", null, tr("fiche « {nom} »", { nom: nomClient(client) }));
  return c.nom ? h("span", { class: ecrit ? "wa-nom-source" : null }, ecrit ? tr("« {nom} » écrit par le contact", { nom: c.nom }) : tr("profil « {nom} »", { nom: c.nom })) : null;
}
function editerNom(c, zone) {
  if (!zone) return;
  const avant = [...zone.childNodes];
  const champNom = h("input", { id: "wa-nom", type: "text", value: nomSaisi(c), maxlength: NOM_MAX, placeholder: tr("Nom du contact"), "aria-label": tr("Nom du contact"), autocomplete: "off", autocapitalize: "words", enterkeyhint: "done", spellcheck: "false" });
  let fini = false;
  const annuler = () => {
    if (fini) return;
    fini = true;
    zone.replaceChildren(...avant);
    const b = zone.querySelector(".wa-nom-bouton");
    if (b) b.focus();
  };
  const enregistrer = async (e) => {
    e.preventDefault();
    if (fini) return;
    const patch = patchNom(c, champNom.value);
    if (!patch) return annuler();
    fini = true;
    ok.disabled = true;
    try {
      await modifier("whatsapp_conversations", c.id, patch);
      toast(patch.nom ? tr("Nom enregistré.") : tr("Nom effacé."));
      rafraichir();
    } catch (err) {
      fini = false;
      ok.disabled = false;
      toast(err.message, true);
    }
  };
  const ok = h("button", { class: "principal petit", type: "submit" }, tr("OK"));
  champNom.addEventListener("keydown", (e) => {
    if (e.key === "Escape") (e.preventDefault(), annuler());
  });
  zone.replaceChildren(
    h(
      "form",
      { class: "wa-nom-form", onsubmit: enregistrer, "data-pas-saisie": "" },
      champNom,
      ok,
      h("button", { class: "bouton-icone secondaire petit", type: "button", "aria-label": tr("Annuler"), onclick: annuler }, icone("fermer", 18))
    )
  );
  champNom.focus();
  champNom.select();
}

function enTete(c, prop) {
  // Sur téléphone, seule la ligne du nom reste collée en haut : l'entreprise et les faits défilent avec les messages.
  // Les réglages tiennent sur une ligne (lot 2, design n° 6 et 7) : l'entreprise en segments, le reste dans le menu « … ».
  return [
    h(
      "header",
      { class: "wa-fil-tete" },
      h("a", { class: "bouton-icone lien wa-retour", href: "#/whatsapp", "aria-label": tr("Retour aux conversations") }, icone("retour", 22)),
      h("div", { class: "wa-fil-titre" }, titreNom(c), h("p", { class: "wa-numero" }, numeroAffiche(c.telephone), sousTitreNom(c))),
      // L'Assistant de l'entreprise de la conversation, toujours à portée dans l'en-tête collé (26.11.2026) : le bouton des faits restait
      // tout en haut de la conversation, hors de l'écran dès qu'elle s'ouvre sur le dernier message.
      boutonAssistantTete(c, prop),
      h("button", { class: "bouton-icone secondaire wa-menu", type: "button", "aria-label": tr("Options de la conversation"), onclick: () => menuConversation(c) }, icone("ellipsis", 20))
    ),
    h("div", { class: "wa-fil-infos" }, selecteurEntreprise(c, prop), selecteurType(c)),
    bandeauFiche(c),
    blocFaits(c, prop),
    blocResume(c),
    // Même client depuis un autre numéro (migration 100).
    noteNouveauNumero(c),
  ];
}

// Même client (même BSUID) qui écrit depuis un autre numéro (migration 100) : le numéro n'est jamais changé seul, Nani voit l'ancienne
// conversation et décide.
function noteNouveauNumero(c) {
  if (!c.meme_client_que) return null;
  const ancienne = ancienneConversation(c, etat.brut.whatsapp_conversations || []);
  return h(
    "p",
    { class: "wa-nouveau-numero", role: "note" },
    icone("alerte", 16),
    tr(LIBELLE_NOUVEAU_NUMERO),
    ancienne ? h("a", { href: adresseConversation(ancienne), class: "lien" }, tr("Voir la conversation de l'ancien numéro")) : null
  );
}

// ---- Nom écrit par le client (21.11.2026) -------------------------------------------------------------------------------------------
// La fonction « whatsapp » a noté sur la conversation le nom que le client a écrit ; la fiche reliée n'a pas de nom de famille. L'écran le
// propose, Nani décide : rien n'est écrit sur la fiche sans son clic. « Pas maintenant » le cache jusqu'au rechargement de la page.
const fichesIgnorees = new Set();
function bandeauFiche(c) {
  const client = clientDe(c);
  const maj = !lectureSeule && peut("clients.ecrire") && !fichesIgnorees.has(c.id) ? ficheAMettreAJour(c, client) : null;
  if (!maj) return null;
  const oui = h("button", { class: "secondaire petit", type: "button" }, tr("Mettre à jour la fiche"));
  const non = h("button", { class: "lien", type: "button" }, tr("Pas maintenant"));
  oui.addEventListener("click", async () => {
    oui.disabled = non.disabled = true;
    try {
      await modifier("clients", client.id, maj);
      toast(tr("Fiche du client mise à jour."));
      rafraichir();
    } catch (err) {
      oui.disabled = non.disabled = false;
      toast(err.message, true);
    }
  });
  non.addEventListener("click", () => {
    fichesIgnorees.add(c.id);
    rafraichir();
  });
  return h("div", { class: "bandeau-info wa-fiche-nom", role: "status" }, h("p", null, tr("{prenom} a écrit {nom} : mettre à jour la fiche ?", { prenom: client.prenom || maj.prenom, nom: c.nom })), h("div", { class: "wa-prop-suite" }, oui, non));
}

// ---- Faits du client (lot 2, usage n° 2) --------------------------------------------------------------------------------------------
// Le dossier relié (ou le plus proche dans le temps du client), ses dates, l'hôtel, le prochain pickup et son heure, les prix donnés et ce
// qui reste à payer. Chaque fait se copie d'un tap. Données de Gestion seulement : aucun appel à l'IA, jamais de net ni de partenaire.
const faitsReplies = new Set();
const jourCourt = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(localeActive(), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
// Le presse-papiers, puis, s'il refuse (navigateur ancien, page sans droit), la copie par une zone de texte sélectionnée.
async function versPressePapiers(texte) {
  try {
    await navigator.clipboard.writeText(texte);
    return;
  } catch {
    const zone = h("textarea", { readonly: "", "aria-hidden": "true", style: "position:fixed;top:0;left:-9999px;opacity:0" });
    zone.value = texte;
    document.body.append(zone);
    zone.select();
    zone.setSelectionRange(0, texte.length);
    const ok = document.execCommand && document.execCommand("copy");
    zone.remove();
    if (!ok) throw new Error("copie");
  }
}
async function copierFait(bouton, texte) {
  try {
    await versPressePapiers(texte);
    bouton.classList.add("copie");
    bouton.setAttribute("aria-label", tr("Copié : {texte}", { texte }));
    const marque = bouton.querySelector(".wa-fait-copier");
    if (marque) marque.replaceChildren(icone("coche", 16));
    setTimeout(() => {
      if (!bouton.isConnected) return;
      bouton.classList.remove("copie");
      bouton.removeAttribute("aria-label");
      if (marque) marque.replaceChildren(icone("copier", 16));
    }, 1600);
  } catch {
    toast(tr("Copie impossible dans ce navigateur."), true);
  }
}
function blocFaits(c, prop) {
  // Les fiches et dossiers des entreprises de la boîte (Secret et Taxi) : une conversation à trier retrouve un client déjà connu par son numéro.
  const ids = new Set(entitesWhatsApp().map((e) => e.id));
  const dansBoite = (x) => !c.entite_id ? ids.has(x.entite_id) : x.entite_id === c.entite_id;
  const client = clientPourFaits(c, (etat.brut.clients || []).filter(dansBoite));
  const dossier = dossierPourFaits({ conv: c, client, dossiers: (etat.brut.dossiers || []).filter(dansBoite), reservations: etat.brut.reservations || [], aujourdhui: aujourdhui() });
  const r = dossier && dossier.entite_id === etat.entiteId ? resumeDossier(dossier.id) : null;
  const taxi = !!dossier && marqueEntite(entite(dossier.entite_id)) === "taxi";
  const lignes = faitsClient({ dossier, reservations: etat.brut.reservations || [], resume: r, aujourdhui: aujourdhui(), taxi, jour: jourCourt, montant: (n, d) => formatMontant(n, d || undefined), intervalle: (a, b) => tr("{debut} au {fin}", { debut: a, fin: b }) });
  // En lecture seule, « Demander à l'assistant » reste quand l'Assistant de l'entreprise de la conversation est permis (PR B).
  const demanderSeul = lectureSeule ? boutonDemander(c, prop) : null;
  const actions = actionsDossier(c, prop, dossier) || (demanderSeul ? h("div", { class: "wa-actions-dossier", "data-pas-saisie": "" }, demanderSeul) : null);
  if (!dossier && !client && !actions) return null;
  const tete = h(
    "div",
    { class: "wa-faits-tete" },
    dossier
      ? h("a", { class: "wa-lien-fiche", href: `#/dossier/${dossier.id}${dossier.entite_id !== etat.entiteId ? `?entite=${dossier.entite_id}` : ""}` }, icone("dossiers", 16), tr("Dossier {ref}", { ref: dossier.ref }))
      : client
        ? h("span", { class: "wa-sans" }, tr("{nom}, aucun dossier", { nom: nomClient(client) }))
        : h("span", { class: "wa-sans" }, tr("Aucun dossier relié")),
    actions,
    // « Proposer une excursion » (composant à part, views/proposer-excursion.mjs) : séjour de plusieurs jours après un transfert ; jamais en
    // lecture seule.
    dossier && !lectureSeule ? boutonProposerExcursion({ dossier, conversation: c }) : null
  );
  if (!lignes.length) return h("section", { class: "wa-faits", "aria-label": tr("Faits du client") }, tete);
  const valeurDe = (l) => (l.cle === "reste" && l.paye ? tr("Payé") : l.aFixer ? `${l.valeur}, ${tr("heure à fixer")}` : l.valeur);
  const bloc = h(
    "details",
    { class: "wa-faits", open: !faitsReplies.has(c.id) },
    h("summary", null, h("span", null, tr("Faits du client")), h("span", { class: "wa-faits-aide" }, tr("touchez pour copier"))),
    tete,
    h(
      "ul",
      { class: "wa-faits-liste" },
      lignes.map((l) =>
        h(
          "li",
          null,
          h(
            "button",
            { type: "button", class: `wa-fait${l.aFixer || (l.cle === "reste" && !l.paye) ? " a-voir" : ""}`, onclick: (e) => copierFait(e.currentTarget, valeurDe(l)) },
            h("span", { class: "wa-fait-libelle" }, tr(l.libelle)),
            h("strong", { class: "wa-fait-valeur" }, valeurDe(l)),
            l.sousTitre ? h("span", { class: "wa-fait-sous" }, l.sousTitre) : null,
            h("span", { class: "wa-fait-copier", "aria-hidden": "true" }, icone("copier", 16))
          )
        )
      )
    )
  );
  bloc.addEventListener("toggle", () => (bloc.open ? faitsReplies.delete(c.id) : faitsReplies.add(c.id)));
  return bloc;
}

// ---- Suivi (migrations 61 et 62) ------------------------------------------------------------------------------------------------------
// « Créer le dossier » ou « Mettre à jour le dossier » : l'Assistant de l'entreprise de la conversation s'ouvre et lit l'échange lui-même
// (texte, photos, PDF). Proposé seulement là où l'Assistant est allumé et permis (comme son onglet).
const assistantDans = (id) => !!id && agentActif(reglagesDe(id)) && ["partenaires.lire", "dossiers.ecrire"].every((d) => permissionsDe(id).includes(d));
// `suggeree` : l'entreprise présélectionnée (bouton principal), toujours modifiable. Pour un client, la question est toujours posée.
function choisirEntreprise(c, prop, suggeree = null) {
  const choix = entitesWhatsApp().filter((e) => assistantDans(e.id));
  const proposee = suggeree || entrepriseProposee(prop, choix);
  return new Promise((resoudre) => {
    let fermer;
    // Résolue avant de fermer : la fermeture rend « null » (fenêtre fermée sans choix), sans effet après un choix.
    const prendre = (e) => (resoudre(e), fermer());
    fermer = modal(
      tr("Dans quelle entreprise ?"),
      h("div", { class: "modal-corps" }, h("p", { class: "aide" }, clientCommun(c) ? tr("Ce client est commun à Secret et à Taxi : le dossier appartient à l'entreprise choisie, la conversation reste aux deux.") : tr("La conversation est à trier. Elle sera rangée dans l'entreprise du dossier une fois le dossier validé.")), h("div", { class: "barre-modal" }, choix.map((e) => h("button", { class: proposee && proposee.id === e.id ? "principal" : "secondaire", type: "button", onclick: () => prendre(e) }, e.nom)))),
      { protege: false, ferme: () => resoudre(null) }
    );
  });
}
// Les photos et PDF à joindre pour l'Assistant : la personne les coche elle-même, aucun par défaut, six au plus. Une capture de virement, de
// compte ou de QR de paiement contient des coordonnées bancaires : elle ne part jamais chez Anthropic. Rend la liste des chemins cochés
// (vide : sans pièce), ou null si la personne a fermé la feuille. Sans photo ni PDF dans la conversation, rien à demander.
async function choisirPieces(c) {
  let messages = [];
  try {
    messages = await etat.store.whatsappMessages(c.id);
  } catch {
    messages = [];
  }
  const pieces = piecesProposees(messages);
  if (!pieces.length) return [];
  let cochees = [];
  return new Promise((resoudre) => {
    const compte = h("p", { class: "aide wa-pieces-compte", "aria-live": "polite" });
    const cases = [];
    const maj = () => {
      compte.textContent = tr("{n} sur {max} cochées", { n: cochees.length, max: PIECES_MAX });
      for (const x of cases) x.disabled = !x.checked && cochees.length >= PIECES_MAX;
    };
    const ligne = (p, i) => {
      const id = `wa-piece-${i}`;
      const caseP = h("input", { type: "checkbox", id, onchange: () => ((cochees = basculerPiece(cochees, p.chemin)), (caseP.checked = cochees.includes(p.chemin)), maj()) });
      cases.push(caseP);
      const vignette = h("span", { class: "wa-piece-vignette", "aria-hidden": "true" }, icone(p.media_type === "application/pdf" ? "regles" : "image", 22));
      if (p.media_type !== "application/pdf")
        lienPhoto(p.media).then((lien) => lien && vignette.replaceChildren(h("img", { src: lien, alt: "" })));
      const qui = p.sens === "entrant" ? tr("Envoyé par le client") : tr("Envoyé par Nani");
      return h("li", null, h("label", { class: "wa-piece", for: id }, caseP, vignette, h("span", { class: "wa-piece-texte" }, h("strong", null, p.legende || p.nom), h("span", null, `${qui} · ${new Date(p.envoye_le).toLocaleString(localeActive(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })}`))));
    };
    let fermer;
    const fin = (valeur) => (resoudre(valeur), fermer());
    fermer = modal(
      tr("Pièces à joindre"),
      h(
        "div",
        { class: "modal-corps wa-pieces" },
        h("p", { class: "bandeau-info", role: "note" }, tr("Ne cochez jamais une capture de virement, de compte ou de QR de paiement.")),
        h("p", { class: "aide" }, tr("Cochez les photos et PDF utiles au dossier (billet, passeport, réservation d'hôtel), {max} au plus. Rien n'est joint sans votre choix.", { max: PIECES_MAX })),
        h("ul", { class: "wa-pieces-liste" }, pieces.map(ligne)),
        compte,
        h("div", { class: "barre-modal" }, h("button", { class: "principal", type: "button", onclick: () => fin([...cochees]) }, tr("Continuer")))
      ),
      { protege: false, ferme: () => resoudre(null) }
    );
    maj();
  });
}

async function versAssistant(c, prop) {
  let entiteId = c.entite_id;
  // Un client appartient à Secret et à Taxi : « Créer le dossier » demande toujours l'entreprise, la suggestion du tri présélectionnée et
  // modifiable (une excursion ne se crée plus chez Taxi en silence). Une conversation rangée dans l'autre entreprise redevient commune.
  const commun = clientCommun(c);
  if (!entiteId || commun) {
    const choix = entitesWhatsApp().filter((e) => assistantDans(e.id));
    const suggeree = entreprisePourAssistant({ conv: commun ? { ...c, entite_id: null } : c, prop, choix, activeId: etat.entiteId });
    const entreprise = commun ? await choisirEntreprise(c, prop, suggeree) : suggeree || (await choisirEntreprise(c, prop));
    if (!entreprise) return;
    entiteId = entreprise.id;
    if (commun && c.entite_id && c.entite_id !== entiteId) {
      try {
        await modifier("whatsapp_conversations", c.id, { entite_id: null });
      } catch (err) {
        return toast(err.message, true);
      }
    }
  }
  // Les pièces d'abord : fermer la feuille annule tout.
  const pieces = await choisirPieces(c);
  if (pieces === null) return;
  // Une seule discussion par conversation WhatsApp (22.11.2026) : la plus récente ouverte de cette entreprise est rouverte.
  let liee = null;
  try {
    liee = conversationLiee(await etat.store.agentConversations(entiteId), c.id);
  } catch {
    liee = null;
  }
  try {
    sessionStorage.setItem(CLE_DEMANDE_AGENT, JSON.stringify({ id: c.id, mode: modeDossier(c), entite: entiteId, pieces, le: Date.now(), ...(liee ? { agent: liee.id } : {}) }));
  } catch {
    return toast(tr("Ce navigateur refuse le stockage de la page : ouvrez l'Assistant et collez l'échange."), true);
  }
  passerDansEntreprise(c, entiteId);
  naviguer(liee ? `#/agent/${liee.id}` : "#/agent/nouvelle");
}
// ---- Demander à l'assistant (PR B, 21.11.2026) ----------------------------------------------------------------------------------------
// L'Assistant s'ouvre lié à cette conversation (agent_conversations.whatsapp_conversation_id, comme « Créer le dossier »), dans l'entreprise de
// la conversation, sinon celle proposée par le tri. Une conversation de l'Assistant déjà liée est rouverte. Rien ne part avant que la
// personne tape ou choisisse sa question ; la fonction joint alors les derniers messages. Jamais pour un contact personnel.
function boutonDemander(c, prop) {
  // IA coupée (migration 105) : seul l'automatique est coupé, la demande de Nani reste permise (décision du 22.11.2026).
  if (!demandePermise(c)) return null;
  const possible = c.entite_id ? assistantDans(c.entite_id) : entitesWhatsApp().some((e) => assistantDans(e.id));
  return possible ? h("button", { type: "button", class: "secondaire petit wa-demander", onclick: () => demanderAssistant(c, prop) }, icone("assistant", 16), tr("Demander à l'assistant")) : null;
}
// Le même « Demander à l'assistant », en tête de la conversation : 44 px, libellé court, mêmes conditions que boutonDemander.
function boutonAssistantTete(c, prop) {
  if (!boutonDemander(c, prop)) return null;
  return h("button", { type: "button", class: "secondaire wa-assistant", "aria-label": tr("Demander à l'assistant"), onclick: (e) => demanderAssistant(c, prop, e.currentTarget) }, icone("assistant", 18), h("span", null, tr("Assistant")));
}
async function demanderAssistant(c, prop, bouton = null) {
  if (!demandePermise(c)) return;
  // Un seul départ par toucher : la lecture des conversations liées prend un instant, un second toucher est ignoré.
  if (bouton) {
    if (bouton.disabled) return;
    bouton.disabled = true;
  }
  try {
    await ouvrirAssistantQuestion(c, prop);
  } finally {
    // Rallumé à la fin, quoi qu'il arrive (fenêtre fermée, erreur) : jamais après un délai fixe (relecture de la PR 355).
    if (bouton) bouton.disabled = false;
  }
}
// L'entreprise quittée pour ouvrir l'Assistant d'une autre : rangée pour le retour sur cette conversation, et le changement est dit.
function passerDansEntreprise(c, entiteId) {
  if (entiteId === etat.entiteId) return;
  try {
    sessionStorage.setItem(CLE_RETOUR_ENTITE, JSON.stringify({ conversation: c.id, entite: etat.entiteId, le: Date.now() }));
  } catch {
    // stockage refusé : on reste dans la nouvelle entreprise
  }
  changerEntite(entiteId, { naviguer: false });
  const e = entite(entiteId);
  if (e) toast(tr("Assistant ouvert dans {nom}.", { nom: e.nom }));
}
async function ouvrirAssistantQuestion(c, prop) {
  let entiteId = c.entite_id;
  if (!entiteId) {
    const choix = entitesWhatsApp().filter((e) => assistantDans(e.id));
    const entreprise = entreprisePourAssistant({ conv: c, prop, choix, activeId: etat.entiteId }) || (await choisirEntreprise(c, prop));
    if (!entreprise) return;
    entiteId = entreprise.id;
  }
  let liee = null;
  try {
    liee = conversationLiee(await etat.store.agentConversations(entiteId), c.id);
  } catch {
    liee = null;
  }
  try {
    // Datée (valable deux minutes) ; `lecture` : conversation d'une entreprise que la personne n'administre pas.
    sessionStorage.setItem(CLE_DEMANDE_AGENT, JSON.stringify({ id: c.id, mode: "question", entite: entiteId, le: Date.now(), ...(peutEcrire(c) ? {} : { lecture: true }), ...(liee ? { agent: liee.id } : {}) }));
  } catch {
    return toast(tr("Ce navigateur refuse le stockage de la page : ouvrez l'Assistant et collez l'échange."), true);
  }
  passerDansEntreprise(c, entiteId);
  naviguer(liee ? `#/agent/${liee.id}` : "#/agent/nouvelle");
}

// Le suivi du défilement de la conversation affichée (fil-defilement.mjs), repris d'un rendu à l'autre.
let suiviFil = null;
// Les bulles inchangées du rendu précédent remplacent les neuves : même nœud, image déjà chargée, aucune hauteur qui bouge.
function reprendreBulles(ancienne, nouvelle) {
  const anciennes = new Map([...ancienne.querySelectorAll("[data-message]")].map((b) => [b.dataset.message, b]));
  for (const b of nouvelle.querySelectorAll("[data-message]")) {
    const a = anciennes.get(b.dataset.message);
    if (a && a.empreinte && a.empreinte === b.empreinte) b.replaceWith(a);
  }
}

// Aller au message (#/whatsapp?c=…&m=…) : le message cité est amené au centre et mis en évidence deux secondes, une fois par adresse.
let messageMontre = "";
function montrerMessage(racine, id) {
  const cible = id ? [...racine.querySelectorAll(".wa-bulle[data-message]")].find((b) => b.dataset.message === id) : null;
  if (!cible) return false;
  cible.scrollIntoView({ block: "center", behavior: "auto" });
  cible.classList.add("wa-bulle-ciblee");
  setTimeout(() => cible.classList.remove("wa-bulle-ciblee"), SURBRILLANCE_MS);
  return true;
}

// Le voucher du dossier relié (Booking confirmation chez Taxi), par l'écran d'envoi habituel (partage de l'image sur iPhone).
async function envoyerVoucherDuDossier(dossierId) {
  const [{ courseDuDossier }, { envoyerVoucher }] = await Promise.all([import("./creation-course.mjs"), import("./voucher-envoi.mjs")]);
  const x = courseDuDossier(dossierId);
  if (!x.reservation) return toast(tr("Ce dossier n'a pas encore de service à mettre sur un voucher."), true);
  envoyerVoucher(x);
}
// « Prêt à réserver » (migration 85) : le même « Créer le dossier » que la fiche des faits, ou null.
// Pour un client, l'entreprise est demandée à chaque fois (versAssistant) : il suffit qu'un des deux Assistants soit permis.
const creerPret = (c, prop) =>
  // Jamais pour un Contact personnel (relecture de la PR 317) : rien de lui ne part chez l'IA.
  !lectureSeule && reponsesDe(c) !== "jamais" && (clientCommun(c) ? entitesWhatsApp().some((e) => assistantDans(e.id)) : (!c.entite_id || c.entite_id === etat.entiteId) && (c.entite_id ? assistantDans(c.entite_id) : entitesWhatsApp().some((e) => assistantDans(e.id)))) ? () => versAssistant(c, prop) : null;
// `dossier` : celui de la fiche des faits (relié, ou trouvé par le client). « Mettre à jour » demande un dossier relié (l'Assistant ne lit que
// lui) ; le voucher se fait dans l'entreprise ouverte.
function actionsDossier(c, prop, dossier = null) {
  if (lectureSeule) return null;
  const demander = boutonDemander(c, prop);
  // Un client est commun à Secret et à Taxi : « Créer le dossier » reste proposé où que la conversation soit rangée (l'entreprise est demandée).
  const commun = clientCommun(c);
  const ici = commun || !c.entite_id || c.entite_id === etat.entiteId;
  const relie = c.entite_id === etat.entiteId ? dossierDe(c) : null;
  // IA coupée pour cette conversation (migration 105) : l'Assistant s'ouvre toujours à la demande (décision du 22.11.2026).
  // Jamais pour un Contact personnel (relecture de la PR 317).
  const assistant = reponsesDe(c) !== "jamais" && (commun || !c.entite_id ? entitesWhatsApp().some((e) => assistantDans(e.id)) : assistantDans(c.entite_id));
  const voucherDe = dossier && dossier.entite_id === etat.entiteId ? dossier : null;
  const boutons = [
    assistant && ici ? h("button", { type: "button", class: "secondaire petit", onclick: () => versAssistant(c, prop) }, icone("assistant", 16), relie ? tr("Mettre à jour le dossier") : tr("Créer le dossier")) : null,
    voucherDe ? h("button", { type: "button", class: "secondaire petit", onclick: () => envoyerVoucherDuDossier(voucherDe.id) }, icone("whatsapp", 16), modeTaxi() ? tr("Envoyer la Booking confirmation") : tr("Envoyer le voucher")) : null,
    demander,
  ].filter(Boolean);
  return boutons.length ? h("div", { class: "wa-actions-dossier", "data-pas-saisie": "" }, boutons) : null;
}

// Le résumé en trois lignes (fonction « whatsapp », Claude Haiku), repliable ; replié ou non est gardé pour la session.
const resumesReplies = new Set();
// Sur téléphone, le choix de la personne pour chaque réponse préparée (audit mobile n° 4, 26.11.2026) : id → dépliée (vrai) ou repliée
// (faux), gardé d'un redessin à l'autre. Sans choix, la réponse est repliée, sauf texte modifié ou contenu interne qui bloque la copie.
const choixReponses = new Map();
function blocResume(c) {
  const lignes = lignesResume(c.resume);
  if (!lignes.length) return null;
  const bloc = h(
    "details",
    { class: "wa-resume", open: !resumesReplies.has(c.id) },
    h(
      "summary",
      null,
      h("span", null, tr("Résumé automatique, à vérifier")),
      c.resume_le ? h("span", { class: "wa-resume-le" }, tr("mis à jour à {heure}", { heure: heureBangkok(c.resume_le) }), resumeEnRetard(c) ? ` ${tr("(avant le dernier message)")}` : null) : null
    ),
    h("ul", null, lignes.map((l) => h("li", null, l)))
  );
  bloc.addEventListener("toggle", () => (bloc.open ? resumesReplies.delete(c.id) : resumesReplies.add(c.id)));
  return bloc;
}

// « Le client a peut-être envoyé une preuve de paiement » : noter le paiement dans le dossier relié (formulaire habituel, prérempli avec le
// reste à payer), ou ignorer (le signal est remis à vide). Nani décide, rien n'est noté seul.
function cartePaiement(c) {
  const p = paiementSignale(c);
  if (!p) return null;
  const ici = c.entite_id === etat.entiteId;
  const dossier = ici ? dossierDe(c) : null;
  const peutNoter = !!dossier && peut("paiements.ecrire") && peut("finances.voir") && !modeTaxi();
  const ignorer = async (e) => {
    e.currentTarget.disabled = true;
    try {
      await modifier("whatsapp_conversations", c.id, { paiement_signale: null });
      rafraichir();
    } catch (err) {
      e.target.disabled = false;
      toast(err.message, true);
    }
  };
  return h(
    "section",
    { class: "wa-suivi wa-suivi-paiement", "aria-label": tr("Paiement") },
    h("p", null, icone("du", 16), h("strong", null, tr("Le client a peut-être envoyé une preuve de paiement.")), " ", tr(MOTIFS_PAIEMENT[p.motif])),
    lectureSeule
      ? null
      : h(
      "div",
      { class: "wa-suivi-actions", "data-pas-saisie": "" },
      peutNoter ? h("button", { class: "secondaire petit", type: "button", onclick: () => naviguer(`#/dossier/${dossier.id}?paiement=1`) }, tr("Noter un paiement")) : null,
      h("button", { class: "lien", type: "button", onclick: ignorer }, tr("Ignorer"))
    )
  );
}

// Promesses de Nani devenues des tâches (« WhatsApp, Prénom : … ») : une ligne et un lien vers Tâches.
function lignesTaches(c) {
  const t = tachesPromesse(etat.brut.taches || [], c, clientDe(c));
  return t.map((x) => h("p", { class: "wa-tache" }, icone("taches", 16), h("span", null, tr("Tâche créée : {titre}", { titre: x.titre.replace(/^WhatsApp, /, "") })), h("a", { href: "#/taches" }, tr("Tâches"))));
}

// ---- Conversation : messages ----------------------------------------------------------------------------------------------------
function libelleJour(jour) {
  const auj = jourBangkok(new Date().toISOString());
  const hier = jourBangkok(new Date(Date.now() - 86400000).toISOString());
  if (jour === auj) return tr("Aujourd'hui");
  if (jour === hier) return tr("Hier");
  return new Date(`${jour}T00:00:00Z`).toLocaleDateString(localeActive(), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

// Un lien court du stockage privé, demandé au moment du geste (il expire en cinq minutes). L'onglet s'ouvre tout de suite, sinon Safari le bloque.
async function ouvrirMedia(media) {
  const onglet = window.open("", "_blank");
  const lien = await etat.store.whatsappLienMedia(media, { telecharger: etatMedia(media) === "document" });
  if (lien && onglet) onglet.location.href = lien;
  else {
    if (onglet) onglet.close();
    toast(etat.store.mode === "demo" ? tr("Aperçu indisponible en démonstration.") : tr("Ce fichier n'est plus disponible."), true);
  }
}
// Les liens signés des photos, gardés quatre minutes (fil-defilement.mjs) : un redessin reprend la même adresse, l'image ne se recharge pas.
const liensMedia = cacheLiens();
const lienEnCache = (media) => liensMedia.lire(media && media.chemin);
async function lienPhoto(media, { neuf = false } = {}) {
  const deja = neuf ? null : lienEnCache(media);
  if (deja) return deja;
  const lien = await etat.store.whatsappLienMedia(media).catch(() => null);
  liensMedia.garder(media.chemin, lien);
  return lien;
}
// La photo en grand, par-dessus la conversation (visionneuse.mjs) : on revient exactement où on lisait.
let agrandissement = false;
async function agrandirPhoto(media, alt) {
  // Un second toucher pendant la lecture du lien n'ouvre pas une deuxième photo.
  if (agrandissement) return;
  agrandissement = true;
  const lien = await lienPhoto(media).finally(() => (agrandissement = false));
  if (!lien) return toast(etat.store.mode === "demo" ? tr("Aperçu indisponible en démonstration.") : tr("Ce fichier n'est plus disponible."), true);
  ouvrirVisionneuse({ src: lien, alt, original: /^https:/.test(lien) ? lien : null });
}
function blocMedia(media) {
  const e = etatMedia(media);
  const legende = media.legende ? h("figcaption", null, media.legende) : null;
  if (LIBELLES_MEDIA[e]) return h("p", { class: `wa-media-absent ${e}` }, icone(e === "attente" ? "horloge" : e === "voucher_envoye" ? "image" : "alerte", 16), tr(LIBELLES_MEDIA[e]));
  if (e === "image") {
    // La place de la photo est réservée avant son chargement (proportions du média, sinon un carré) : la boîte ne change jamais de taille.
    const alt = media.legende || tr("Photo envoyée par le client");
    const boite = h("span", { class: "wa-vignette-boite", style: `--ratio: ${ratioMedia(media)}` });
    const attente = (texte) => boite.replaceChildren(h("span", { class: "wa-vignette-vide" }, icone("image", 22), h("span", null, texte)));
    let reessai = false;
    const montrer = (lien) =>
      boite.replaceChildren(
        h("img", {
          src: lien,
          alt,
          loading: "lazy",
          decoding: "async",
          // Un lien expiré avant le chargement (photo loin dans le fil) : un nouveau lien, une seule fois.
          onerror: async () => {
            if (reessai) return attente(tr("Photo indisponible"));
            reessai = true;
            const neuf = await lienPhoto(media, { neuf: true });
            if (neuf) montrer(neuf);
            else attente(tr("Photo indisponible"));
          },
        })
      );
    const deja = lienEnCache(media);
    if (deja) montrer(deja);
    else {
      attente(tr("Photo en chargement"));
      // La vignette se charge après l'affichage : un lien par photo, sans retenir l'écran.
      lienPhoto(media).then((lien) => (lien ? montrer(lien) : attente(etat.store.mode === "demo" ? tr("Aperçu indisponible en démonstration") : tr("Photo indisponible"))));
    }
    return h("figure", { class: "wa-image" }, h("button", { type: "button", class: "wa-vignette", "aria-label": tr("Ouvrir la photo"), onclick: () => agrandirPhoto(media, alt) }, boite), legende);
  }
  const libelle = media.nom || tr(libelleType(e));
  return h("figure", { class: "wa-fichier" }, h("button", { type: "button", class: "secondaire petit", onclick: () => ouvrirMedia(media) }, icone(e === "document" ? "trombone" : "fleche", 16), libelle), legende);
}

function bulle(m) {
  // Repère discret avant une réponse de Nani : un message du client semble manquer avant elle (migration 100).
  const repere = repereManque(m) ? h("p", { class: "wa-repere-manque" }, tr(LIBELLE_MANQUE)) : null;
  // WhatsApp n'a pas transmis ce message du client : une ligne qui renvoie au téléphone, à la place de la bulle.
  const noeud = estNonTransmis(m) ? h("p", { class: "wa-bulle entrant wa-non-transmis", "data-message": m.id, role: "note" }, icone("alerte", 16), tr(TEXTE_NON_TRANSMIS, { heure: heureBangkok(m.envoye_le) })) : bulleMessage(m);
  // Ce que la bulle montre : un redessin reprend la bulle déjà affichée si rien n'a changé (reprendreBulles).
  noeud.empreinte = `${langueActive()}|${empreinteMessage(m)}`;
  return repere && !estNonTransmis(m) ? [repere, noeud] : noeud;
}

function bulleMessage(m) {
  const medias = Array.isArray(m.medias) ? m.medias : [];
  const texte = m.texte && !(medias.length && medias.some((x) => x.legende === m.texte)) ? m.texte : "";
  // Statut d'envoi (migration 64) : envoyé, remis, lu, ou non remis avec la raison de WhatsApp. Discret, à la suite de l'heure.
  const statut = statutEnvoi(m);
  const meta = [heureBangkok(m.envoye_le), m.sens === "sortant" && ORIGINES[m.origine] ? tr(ORIGINES[m.origine]) : "", m.modifie_le ? tr("modifié") : ""].filter(Boolean).join(" · ");
  return h(
    "div",
    { class: `wa-bulle ${m.sens}${m.supprime_le ? " supprime" : ""}${m.type === "reaction" ? " reaction" : ""}${statut && statut.cle === "echec" ? " non-remis" : ""}`, "data-message": m.id },
    m.supprime_le ? h("p", { class: "wa-supprime" }, tr("Supprimé par le client")) : null,
    medias.map(blocMedia),
    texte ? h("p", { class: "wa-texte" }, m.type === "reaction" ? `${tr("Réaction")} ${texte}` : texte) : !medias.length ? h("p", { class: "wa-texte wa-type" }, tr(libelleType(m.type))) : null,
    h("p", { class: "wa-meta" }, meta, statut ? h("span", { class: `wa-statut ${statut.cle}` }, ` · ${tr(statut.libelle)}`) : null),
    statut && statut.cle === "echec" && m.statut_envoi === "echec" && m.erreur_envoi !== "sans_confirmation" ? h("p", { class: "wa-statut-detail" }, statut.detail ? tr(statut.detail) : m.erreur_envoi || tr("WhatsApp n'a pas remis ce message.")) : null
  );
}

// ---- Proposition de l'agent -------------------------------------------------------------------------------------------------------
async function copier(c, p, zone, bouton, deplier = null) {
  if (bouton.disabled) return;
  // Comme pour l'envoi (audit dev B2) : une réponse remplacée entre-temps (le client a réécrit) ne se copie pas sans le dire.
  if (!toujoursCourante(c, p)) {
    toast(tr("Cette réponse n'est plus la dernière préparée. Rien n'a été copié."), true);
    return rafraichir();
  }
  try {
    await versPressePapiers(zone.value);
    bouton.classList.add("fait");
    // Le libellé reste dans son span (caché sous 380 px, audit mobile n° 3) ; l'étiquette accessible suit.
    bouton.replaceChildren(icone("coche", 20), h("span", { class: "wa-copier-texte" }, tr("Copié")));
    bouton.setAttribute("aria-label", tr("Copié"));
    setTimeout(() => bouton.isConnected && (bouton.classList.remove("fait"), bouton.replaceChildren(icone("copier", 20), h("span", { class: "wa-copier-texte" }, tr("Copier"))), bouton.setAttribute("aria-label", tr("Copier"))), 2500);
    toast(tr("Réponse copiée. Collez-la dans WhatsApp."));
  } catch {
    // Un champ replié (display: none) ne se sélectionne pas : on déplie d'abord (relecture de la PR 355).
    if (deplier) deplier();
    zone.focus();
    zone.select();
    toast(tr("Copie impossible dans ce navigateur. Le texte est sélectionné, copiez-le à la main."), true);
  }
}

// Marquer traitée ou ignorer : les deux boutons sont éteints pendant l'écriture (un double appui ne fait qu'une écriture et un message).
// Un refus n'est « déjà traitée » que si la proposition relue n'est vraiment plus à faire, sinon le vrai message d'erreur.
async function traiter(p, statut, boutons) {
  if (boutons.some((b) => b.disabled)) return;
  boutons.forEach((b) => (b.disabled = true));
  try {
    await modifier("whatsapp_propositions", p.id, { statut });
    brouillons.delete(p.id);
    toast(statut === "traitee" ? tr("Réponse marquée traitée.") : tr("Réponse ignorée."));
    return rafraichir();
  } catch (err) {
    let relue = null;
    try {
      relue = await etat.store.whatsappProposition(p.id);
    } catch {
      // relecture impossible : le message d'origine reste le plus juste
    }
    if (relue && relue.statut !== "a_faire") {
      toast(tr("Cette réponse a déjà été traitée ailleurs."), true);
      return rafraichir();
    }
    toast(err.message, true);
  }
  boutons.forEach((b) => (b.disabled = false));
}

// La proposition affichée est-elle toujours la proposition courante, encore à faire ? Un nouveau message du client la remplace.
const toujoursCourante = (c, p) => {
  const courante = propositionCourante(etat.brut.whatsapp_propositions || [], c.id);
  return !!courante && courante.id === p.id && courante.statut === "a_faire";
};
async function envoyer(c, p, zone, bouton, apres) {
  const perimee = () => {
    toast(tr("Cette réponse n'est plus la dernière préparée. Rien n'est parti."), true);
    rafraichir();
  };
  if (bouton.disabled) return;
  if (!toujoursCourante(c, p)) return perimee();
  if (!(await confirmer(tr("Envoyer cette réponse à {nom} depuis Gestion ? Elle part tout de suite du numéro de l'entreprise.", { nom: nomConversation(c, clientDe(c)) }), tr("Envoyer")))) return;
  if (!toujoursCourante(c, p)) return perimee();
  bouton.disabled = true;
  let r = await etat.store.whatsappEnvoyer({ conversation_id: c.id, texte: zone.value, proposition_id: p.id });
  // Un montant égal au net d'un autre service du catalogue (whatsapp-envoi, 409) : rien n'est parti. Nani confirme d'un clic, le même texte
  // repart avec cette liste, que la fonction revérifie.
  const texte = zone.value;
  const question = aConfirmerEnvoi(r, texte);
  if (question) {
    if (!(await confirmer(tr(question.texte, question.vars), tr("Envoyer quand même")))) {
      bouton.disabled = false;
      toast(tr("Rien n'est parti."));
      return apres();
    }
    if (!toujoursCourante(c, p)) return perimee();
    r = await etat.store.whatsappEnvoyer({ conversation_id: c.id, texte, proposition_id: p.id, montants_confirmes: question.renvoi });
  }
  if (r && r.demo) {
    bouton.disabled = false;
    return toast(tr("En démo, rien n'est envoyé."));
  }
  if (!r || !r.ok) {
    const code = r && r.erreur;
    // Résultat inconnu (délai dépassé, connexion coupée) : le bouton reste éteint et l'écran dit de vérifier dans WhatsApp, jamais « réessayez ».
    // Le message est déjà dans le fil (rangé « envoi » avant l'appel, migration 64) : après 30 secondes, « C'est parti » ou « Pas parti ».
    if (envoiIncertain(code)) {
      envoisIncertains.add(p.id);
      if (p.statut === "a_faire") p.statut = "envoi";
      toast(tr(erreurEnvoi(code)), true);
      return rafraichir();
    }
    bouton.disabled = false;
    // Fiches partenaires illisibles côté serveur (revue PR 298) : un message clair, rien à retirer du texte.
    // « montant_interne:1500 » ou « nom_prestataire:Jade » : la valeur seule, cherchée dans le texte (une valeur sans code reste telle quelle).
    if (code === "contenu_interne") {
      const brut = ((r && r.a_retirer) || []).filter((x) => x !== LECTURE_IMPOSSIBLE && x !== CONTROLE_IMPOSSIBLE);
      const b = bloquantsReponse(brut);
      // Les codes tels quels (une empreinte de montant masqué se recalcule sur le texte, revue de la PR 306), plus les valeurs sans code.
      aRetirer.set(p.id, { ...b, noms: [...b.noms, ...brut.filter((x) => !/^[a-z_]+:/.test(String(x)))] });
    }
    toast(tr(erreurEnvoi(codeEnvoi(code, r && r.a_retirer))), true);
    if (code === "deja_traitee") return rafraichir();
    return apres();
  }
  // La fonction a rangé le message et soldé les propositions ouvertes de la conversation : on le montre sans attendre la relecture.
  const maintenant = new Date().toISOString();
  for (const x of etat.brut.whatsapp_propositions || []) if (x.conversation_id === c.id && ["a_faire", "en_cours", "envoi"].includes(x.statut)) Object.assign(x, { statut: "traitee", traitee_le: maintenant, traitee_par_quoi: "gestion" });
  brouillons.delete(p.id);
  toast(tr("Message envoyé."));
  rafraichir();
}

const TRAITEE_PAR = { app: N_("Répondu depuis l'app"), gestion: N_("Envoyé depuis Gestion"), outil: N_("Marquée traitée dans Gestion") };

// Demander une réponse quand le tri n'en a pas préparé (fonction whatsapp-preparer) : elle arrive « en_cours » puis « à faire » par Realtime.
async function preparer(c, bouton) {
  if (bouton.disabled) return;
  bouton.disabled = true;
  const r = await etat.store.whatsappPreparer(c.id);
  if (r && r.ok) {
    bouton.replaceChildren(h("span", { class: "agent-point", "aria-hidden": "true" }), tr("Préparation demandée…"));
    return toast(tr("Préparation demandée. La réponse arrive dans un instant."));
  }
  bouton.disabled = false;
  toast(tr(erreurPreparer(r && r.erreur)), true);
}

// ---- Envoi au résultat inconnu (migration 64) --------------------------------------------------------------------------------------
// Le message est rangé avant l'appel à Telnyx. Sans réponse sûre après 30 secondes, Nani vérifie dans WhatsApp et le dit : « C'est parti »
// garde le message et solde la réponse ; « Pas parti » retire le message du fil et la réponse revient, prête à renvoyer.
let minuterieEnvoi = null;
async function confirmerEnvoi(c, parti, boutons) {
  if (boutons.some((b) => b.disabled)) return;
  boutons.forEach((b) => (b.disabled = true));
  try {
    await etat.store.whatsappConfirmerEnvoi(c.id, parti);
    const maintenant = new Date().toISOString();
    for (const x of etat.brut.whatsapp_propositions || []) {
      if (x.conversation_id !== c.id) continue;
      if (parti && ["a_faire", "en_cours", "envoi"].includes(x.statut)) Object.assign(x, { statut: "traitee", traitee_le: maintenant, traitee_par_quoi: "gestion" });
      else if (!parti && x.statut === "envoi") (x.statut = "a_faire", envoisIncertains.delete(x.id));
    }
    toast(parti ? tr("Noté : le message est parti.") : tr("Noté : rien n'est parti. La réponse est de nouveau prête."));
    return rafraichir();
  } catch (err) {
    toast(err.message, true);
    boutons.forEach((b) => (b.disabled = false));
  }
}
function carteVerifier(c, doute) {
  const expire = !!doute && envoiAVerifier(doute) === "expire";
  const oui = h("button", { class: "principal petit", type: "button" }, icone("coche", 16), tr("C'est parti"));
  const non = h("button", { class: "secondaire petit", type: "button" }, tr("Pas parti"));
  oui.addEventListener("click", () => confirmerEnvoi(c, true, [oui, non]));
  non.addEventListener("click", () => confirmerEnvoi(c, false, [oui, non]));
  const wa = lienWhatsApp(c.telephone);
  return h(
    "section",
    { class: `wa-prop wa-verifier${expire ? " echec" : ""}`, role: "status", "aria-label": tr("Vérifiez dans WhatsApp") },
    h("p", null, icone("alerte", 16), h("strong", null, tr("Vérifiez dans WhatsApp")), " ", expire ? tr("WhatsApp n'a jamais confirmé cet envoi depuis Gestion.") : tr("L'envoi depuis Gestion n'est pas confirmé.")),
    h("p", { class: "wa-detail" }, tr("Si le message est dans la conversation de l'app, touchez « C'est parti ». Sinon « Pas parti » : il sort du fil et la réponse revient pour un nouvel essai.")),
    lectureSeule ? null : h("div", { class: "wa-prop-actions" }, oui, non, wa ? h("a", { class: "bouton secondaire wa-ouvrir", href: wa, target: "_blank", rel: "noopener" }, icone("whatsapp", 18), tr("Ouvrir dans WhatsApp")) : null)
  );
}

// Aucune réponse préparée pour le dernier message du client : l'état normal depuis le 20.11.2026 (réponses sur demande). « Préparer une
// réponse » est le geste principal (lot 2, design n° 3) : bouton plein, collé en bas sous le pouce comme Copier. Ce que le tri a vu passe
// au-dessus, en petit. Jamais pour un Contact personnel : rien de lui n'est envoyé à l'IA (revue de sécurité de la PR 299).
function ligneSansReponse(c, messages) {
  const dernier = messages.length ? messages[messages.length - 1] : null;
  const bouton = !lectureSeule && reponsesDe(c) !== "jamais" && dernier && dernier.sens === "entrant" && etat.store.whatsappPreparer ? h("button", { class: "principal wa-preparer", type: "button", onclick: (e) => preparer(c, e.currentTarget) }, icone("assistant", 20), tr("Préparer une réponse")) : null;
  const raison = raisonSansReponse(c, messages);
  if (!bouton && !raison) return null;
  return h("div", { class: `wa-sans-reponse${bouton ? " avec-bouton" : ""}` }, raison ? h("p", { class: "wa-note" }, tr(raison)) : null, bouton);
}

function carteProposition(c, p, messages) {
  // Le client attend et aucune réponse n'est préparée (tri, Contact personnel, agent qui n'a pas su trier) : on le dit.
  if (!p) return etat.brut.whatsapp_propositions_disponible !== false && messages.length && messages[messages.length - 1].sens === "entrant" ? ligneSansReponse(c, messages) : null;
  if (p.statut === "envoi") {
    // Moins de 30 secondes : l'appel est peut-être encore en cours. Au-delà, la carte « Vérifiez dans WhatsApp » du fil prend le relais ;
    // une réponse restée « envoi » sans message (avant la migration 64) l'a aussi.
    if (messages.some((m) => envoiAVerifier(m) === "attente")) return h("section", { class: "wa-prop en-cours", "aria-live": "polite" }, h("p", { class: "agent-etape" }, h("span", { class: "agent-point", "aria-hidden": "true" }), tr("Envoi en cours depuis Gestion…")));
    return envoiEnDoute(messages) ? null : carteVerifier(c, null);
  }
  // « Fait » ne vaut que pour une proposition au moins aussi récente que le dernier message du client.
  // Nani a déjà répondu depuis (dernier message sortant) : rien à dire.
  const repondu = messages.length > 0 && messages[messages.length - 1].sens === "sortant";
  if ((p.statut === "traitee" || p.statut === "ignoree") && repondu && !propositionAJour(p, messages)) return null;
  if ((p.statut === "traitee" || p.statut === "ignoree") && !propositionAJour(p, messages)) return ligneSansReponse(c, messages);
  if (p.statut === "en_cours") return h("section", { class: "wa-prop en-cours", "aria-live": "polite" }, h("p", { class: "agent-etape" }, h("span", { class: "agent-point", "aria-hidden": "true" }), tr("Réponse en préparation…")));
  if (p.statut === "echec")
    return h("section", { class: "wa-prop echec", role: "status" }, h("p", null, h("strong", null, tr("L'assistant n'a pas pu préparer de réponse.")), " ", tr("Répondez depuis l'app comme d'habitude.")), p.erreur ? h("p", { class: "wa-detail" }, libelleErreurProposition(p.erreur) ? tr(libelleErreurProposition(p.erreur)) : p.erreur) : null, ligneSansReponse(c, messages));
  if (p.statut === "traitee" || p.statut === "ignoree")
    return h("p", { class: "wa-prop-fait" }, icone(p.statut === "traitee" ? "coche" : "fermer", 16), p.statut === "ignoree" ? tr("Réponse préparée ignorée") : tr(TRAITEE_PAR[p.traitee_par_quoi] || N_("Répondu")), p.traitee_le ? h("time", { datetime: p.traitee_le }, ` ${quand(p.traitee_le, { langue: langueActive() })}`) : null);
  if (p.statut !== "a_faire") return null;

  const zone = h("textarea", { id: "wa-reponse", rows: 4, lang: p.langue || "en", spellcheck: "true", "aria-label": tr("Réponse préparée") });
  // Le texte modifié survit au redessin de l'écran (synchronisation, nouveau message dans une autre conversation).
  zone.value = brouillons.has(p.id) ? brouillons.get(p.id) : p.texte || "";
  const f = fenetre(messages);
  const boutonCopier = h("button", { class: "secondaire wa-copier", type: "button", onclick: (e) => copier(c, p, zone, e.currentTarget, () => plier(true, { choisi: true })) }, icone("copier", 20), h("span", { class: "wa-copier-texte" }, tr("Copier")));
  boutonCopier.setAttribute("aria-label", tr("Copier"));
  // « Ouvrir dans WhatsApp » avec la réponse déjà écrite (wa.me/<numéro>?text=, lot 2, usage n° 3) : un tap, Nani n'a plus qu'à envoyer.
  // Le texte est aussi copié, au cas où l'app ne reprend pas le texte du lien.
  const boutonOuvrir = lienWhatsApp(c.telephone)
    ? h("a", { class: "bouton principal wa-ouvrir", target: "_blank", rel: "noopener", onclick: (e) => {
        if (boutonOuvrir.getAttribute("aria-disabled") === "true") return e.preventDefault();
        // Comme Copier : une réponse remplacée entre-temps (le client a réécrit) ne part pas sans le dire.
        if (!toujoursCourante(c, p)) {
          e.preventDefault();
          toast(tr("Cette réponse n'est plus la dernière préparée. Rien n'a été copié."), true);
          return rafraichir();
        }
        if (navigator.clipboard) navigator.clipboard.writeText(zone.value).catch(() => {});
      } }, icone("whatsapp", 20), tr("Ouvrir dans WhatsApp"))
    : null;
  // Plusieurs messages courts (lot 2) : chacun se copie seul, pour les envoyer l'un après l'autre.
  const morceaux = h("div", { class: "wa-morceaux" });
  const majMorceaux = () => {
    const m = morceauxReponse(zone.value);
    morceaux.hidden = m.length < 2;
    morceaux.replaceChildren(...(m.length < 2 ? [] : [h("span", { class: "wa-note" }, tr("{n} messages courts", { n: m.length })), ...m.map((x, i) => h("button", { class: "lien", type: "button", onclick: (e) => copierFait(e.currentTarget, x) }, tr("Copier le {n}", { n: i + 1 })))]));
  };
  const boutonEnvoyer = h("button", { class: "secondaire petit", type: "button", onclick: (e) => envoyer(c, p, zone, e.currentTarget, majEnvoi) }, tr("Envoyer depuis Gestion"));
  const pourquoi = h("p", { class: "wa-detail" });
  // Garde-fou de la PR 278 : un net, une marge, une commission ou un nom de partenaire signalé bloque la copie et l'envoi tant qu'il reste.
  // S'y ajoute ce que whatsapp-envoi a trouvé dans le texte (contenu_interne, « a_retirer »).
  const bloquants = bloquantsReponse(p.avertissements);
  // Lecture seule d'une réponse d'une autre entreprise (migration 63) : un net ou un nom de partenaire n'est montré qu'à qui a le droit de le
  // voir dans l'entreprise de la réponse. La copie reste bloquée, sans dire ce qui est caché.
  const filtre = lectureSeule ? avertissementsVisibles(p.avertissements || [], permissionsDe(p.entite_id || c.entite_id)) : { visibles: p.avertissements || [], masques: 0 };
  const alerte = h("p", { class: "erreur-form", role: "alert", hidden: true });
  function majEnvoi() {
    const ok = envoiPossible({ texte: zone.value, fenetre: f });
    const duServeur = resteBloque(zone.value, aRetirer.get(p.id) || {});
    const reste = [...new Set([...resteBloque(zone.value, bloquants), ...duServeur])];
    const incertain = envoisIncertains.has(p.id);
    alerte.hidden = !reste.length;
    alerte.textContent = !reste.length ? "" : reste.includes(CONTROLE_IMPOSSIBLE) ? tr("Les nets n'ont pas pu être relus pour contrôler la réponse : elle ne se copie pas. Préparez-la de nouveau.") : filtre.masques ? tr("Un montant ou un nom interne est dans la réponse : à retirer avant de copier.") : tr("À retirer avant de copier : {liste}. Ces chiffres et ces noms ne vont jamais au client.", { liste: reste.map((x) => (x === MONTANT_MASQUE ? tr("un montant égal à un net interne") : x)).join(", ") });
    boutonEnvoyer.disabled = !ok.ok || reste.length > 0 || incertain;
    pourquoi.textContent = incertain ? tr(erreurEnvoi("verifier_whatsapp")) : ok.raison === "fenetre_fermee" ? tr("Envoi depuis Gestion fermé, le client a écrit il y a plus de 24 h.") : ok.raison === "vide" ? tr("La réponse est vide.") : "";
    pourquoi.hidden = !pourquoi.textContent;
    const bloque = !zone.value.trim() || reste.length > 0;
    boutonCopier.disabled = bloque;
    if (boutonOuvrir) {
      // Un net ou un nom de partenaire encore dans le texte : le lien ne part pas avec (comme Copier).
      boutonOuvrir.setAttribute("href", lienWhatsApp(c.telephone, bloque ? "" : zone.value));
      boutonOuvrir.setAttribute("aria-disabled", reste.length > 0 ? "true" : "false");
    }
    majMorceaux();
  }
  // Brouillon : la page ne se recharge pas seule tant qu'il existe (app.mjs, rienAPerdre).
  const marquerBrouillon = () => zone.toggleAttribute("data-brouillon", brouillons.has(p.id));
  zone.addEventListener("input", () => {
    if (zone.value !== (p.texte || "")) brouillons.set(p.id, zone.value);
    else brouillons.delete(p.id);
    marquerBrouillon();
    majEnvoi();
  });
  marquerBrouillon();
  majEnvoi();
  // Téléphone (audit mobile n° 4, 26.11.2026) : la réponse se replie sur deux lignes, « Voir la réponse » la déplie ; dépliée, le champ
  // grandit avec son texte au lieu de défiler dans une page qui défile. Dépliée d'office quand le texte a été modifié ou qu'un montant ou un
  // nom interne bloque la copie. Ordinateur : rien ne change (la colonne a sa propre hauteur).
  const telephone = () => typeof matchMedia === "function" && matchMedia("(max-width: 899px)").matches;
  const ajusterZone = () => {
    if (!telephone() || !zone.isConnected || !zone.offsetParent) return;
    zone.style.height = "auto";
    zone.style.height = `${zone.scrollHeight + 2}px`;
  };
  zone.addEventListener("input", ajusterZone);
  const texteApercu = h("span", { class: "wa-apercu-texte" });
  const apercu = h("button", { class: "wa-apercu", type: "button", "aria-expanded": "false", "aria-controls": "wa-reponse" }, texteApercu, h("span", { class: "wa-apercu-voir" }, tr("Voir la réponse")));
  const replier = h("button", { class: "lien wa-replier", type: "button", "aria-controls": "wa-reponse" }, tr("Replier"));
  const plier = (deplie, { choisi = false } = {}) => {
    if (choisi) choixReponses.set(p.id, deplie);
    section.classList.toggle("repliee", !deplie);
    apercu.setAttribute("aria-expanded", deplie ? "true" : "false");
    texteApercu.textContent = zone.value.replace(/\s+/g, " ").trim();
    if (deplie) requestAnimationFrame(ajusterZone);
  };
  apercu.addEventListener("click", () => plier(true, { choisi: true }));
  replier.addEventListener("click", () => plier(false, { choisi: true }));
  const avs = avertissements({ ...p, avertissements: filtre.visibles });
  // Préparée avec les données d'une autre entreprise que celle de la conversation (à trier, ou rangée ailleurs depuis) : on le dit.
  const pour = p.entite_id && p.entite_id !== c.entite_id ? entite(p.entite_id) : null;
  const boutonTraitee = h("button", { class: "lien", type: "button" }, tr("Marquer traitée"));
  const boutonIgnorer = h("button", { class: "lien", type: "button" }, tr("Ignorer"));
  boutonTraitee.addEventListener("click", () => traiter(p, "traitee", [boutonTraitee, boutonIgnorer]));
  boutonIgnorer.addEventListener("click", () => traiter(p, "ignoree", [boutonTraitee, boutonIgnorer]));
  const section = h(
    "section",
    // Hors saisie (audit dev B2) : le texte modifié survit au redessin (Map brouillons), il ne doit donc pas figer l'écran. Seul le curseur
    // dans le champ retient le redessin (curseurDansUnChamp).
    { class: "wa-prop", "aria-label": tr("Réponse préparée"), "data-pas-saisie": "" },
    h("h3", null, tr("Réponse préparée"), p.langue ? h("span", { class: "tag" }, p.langue.toUpperCase()) : null, pour ? h("span", { class: "wa-pour" }, tr("préparée pour {nom}", { nom: pour.nom })) : null, replier),
    avs.length ? h("ul", { class: "wa-avertissements" }, avs.map((a) => h("li", { class: a.niveau }, icone(a.niveau === "alerte" ? "alerte" : "coche", 16), h("span", null, tr(a.texte, a.vars))))) : null,
    apercu,
    zone,
    alerte,
    morceaux,
    h("div", { class: "wa-prop-actions" }, boutonOuvrir, boutonCopier),
    lectureSeule ? null : h("div", { class: "wa-prop-suite" }, boutonTraitee, boutonIgnorer, boutonEnvoyer),
    pourquoi
  );
  plier(choixReponses.has(p.id) ? choixReponses.get(p.id) : brouillons.has(p.id) || !alerte.hidden);
  // Le champ suit sa largeur (rotation, fenêtre redimensionnée) et sa première mise en page, sans limite de temps (relecture de la PR 355) :
  // l'observateur s'arrête quand la réponse quitte l'écran.
  if (typeof ResizeObserver === "function") {
    let largeur = 0;
    const ro = new ResizeObserver(() => {
      if (!section.isConnected) return ro.disconnect();
      const l = Math.round(zone.getBoundingClientRect().width);
      if (l && l !== largeur) ((largeur = l), ajusterZone());
    });
    ro.observe(zone);
  }
  return section;
}

async function fil(c, prop) {
  let messages = [];
  let erreur = null;
  try {
    // Le message cité par l'adresse est chargé même s'il est ancien (PR B).
    messages = await etat.store.whatsappMessages(c.id, { inclure: messageCible(lireAdresse(location.hash)) });
  } catch (err) {
    erreur = err;
  }
  const jours = grouperParJour(messages);
  lectureSeule = !peutEcrire(c);
  const doute = envoiEnDoute(messages);
  // Un envoi qui passera « à vérifier » (30 s) ou « expiré » (5 min) : l'écran se redessine à ce moment-là, une seule minuterie à la fois.
  clearTimeout(minuterieEnvoi);
  const delai = prochainChangement(messages);
  if (delai !== null) minuterieEnvoi = setTimeout(() => /^#\/whatsapp/.test(location.hash) && rafraichir(), delai);
  const noeud = h(
    "section",
    { class: "wa-fil", "aria-label": tr("Conversation") },
    enTete(c, prop),
    h(
      "div",
      { class: "wa-messages" },
      erreur ? h("p", { class: "agent-erreur" }, tr("Les messages n'ont pas pu être lus ({message})", { message: erreur.message })) : null,
      !erreur && !messages.length ? h("p", { class: "aide" }, tr("Aucun message gardé pour cette conversation.")) : null,
      jours.map((g) => h("div", { class: "wa-jour" }, h("p", { class: "wa-jour-titre" }, h("span", null, libelleJour(g.jour))), g.messages.map(bulle))),
      lignesTaches(c),
      cartePaiement(c),
      cartePret(c, { lectureSeule, creerDossier: creerPret(c, prop), peutRelierDans: (id) => entitesWhatsApp().some((e) => e.id === id), rafraichir })
    ),
    doute ? carteVerifier(c, doute) : null,
    carteProposition(c, prop, messages)
  );
  return { noeud, messages };
}

// Marquer lue une conversation ouverte, seulement si l'écran est vraiment sous les yeux (onglet visible). Au retour sur l'onglet, la
// conversation ouverte est marquée à ce moment-là. Un échec (réseau) n'empêche pas de lire : le compteur reste jusqu'à la prochaine fois.
async function marquerLue(id) {
  const c = (etat.brut.whatsapp_conversations || []).find((x) => x.id === id && (Number(x.non_lus) || 0) > 0);
  if (!c || document.visibilityState !== "visible") return false;
  // Une conversation d'une entreprise que la personne n'administre pas reste non lue (lecture seule, migration 63).
  if (!peutEcrire(c)) return false;
  try {
    await modifier("whatsapp_conversations", c.id, { non_lus: 0 });
    return true;
  } catch (err) {
    console.warn(err);
    return false;
  }
}
let visibiliteSuivie = false;
let affiche = null;
function suivreVisibilite() {
  if (visibiliteSuivie) return;
  visibiliteSuivie = true;
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || !/^#\/whatsapp/.test(location.hash)) return;
    const { conversation } = lireAdresse(location.hash);
    if (!conversation) return;
    // Laisser le temps à la relecture du retour sur l'onglet, puis marquer lu seulement si l'écran montre le dernier message de la
    // conversation (audit dev B2). Un redessin qui attend (curseur dans la réponse) ou un message arrivé depuis le rendu : c'est le rendu
    // suivant qui marquera la conversation (vueWhatsApp).
    await new Promise((ok) => setTimeout(ok, 1500));
    if (etat.redessinEnAttente || document.visibilityState !== "visible" || lireAdresse(location.hash).conversation !== conversation) return;
    const c = (etat.brut.whatsapp_conversations || []).find((x) => x.id === conversation);
    if (!c || !affiche || affiche.id !== conversation || affiche.dernier !== (c.dernier_message_le || null)) return;
    if (!(await marquerLue(conversation))) return;
    // La pastille de la liste tombe sur place ; le badge du menu suit la relecture que le retour sur l'onglet déclenche.
    for (const a of document.querySelectorAll(".wa-conv[aria-current]")) {
      a.classList.remove("non-lue");
      const pastille = a.querySelector(".agent-pastille");
      if (pastille) pastille.remove();
    }
  });
}

// ---- Écran -------------------------------------------------------------------------------------------------------------------------
export async function vueWhatsApp() {
  const racine = h("div", { class: "wa", "data-titre": tr("WhatsApp") });
  if (!etat.brut.whatsapp_disponible) {
    racine.append(h("h1", null, tr("WhatsApp")), h("p", { class: "bandeau-info", role: "status" }, tr("La base n'a pas encore la boîte WhatsApp (migration 58 à appliquer).")));
    racine.classList.add("wa-indisponible");
    return racine;
  }
  suivreVisibilite();
  const { conversation: idOuvert } = lireAdresse(location.hash);
  // Retour de l'Assistant d'une autre entreprise sur la même conversation : l'entreprise d'origine revient (relecture de la PR 355). La
  // mémoire ne sert qu'une fois : toute autre visite de WhatsApp l'efface.
  try {
    const brut = sessionStorage.getItem(CLE_RETOUR_ENTITE);
    if (brut) {
      sessionStorage.removeItem(CLE_RETOUR_ENTITE);
      const retour = entiteDeRetour(brut, { conversation: idOuvert, active: etat.entiteId, accessibles: entitesAccessibles().map((e) => e.id) });
      if (retour) {
        changerEntite(retour, { naviguer: false });
        const e = entite(retour);
        if (e) toast(tr("De retour dans {nom}.", { nom: e.nom }));
      }
    }
  } catch {
    // stockage refusé
  }
  // L'écran tel qu'il était avant ce rendu (redessin à la même adresse) : la position de la liste et de la conversation à garder.
  const avant = document.querySelector("#principal > .wa");
  const defilListe = avant ? (avant.querySelector(".wa-liste") || {}).scrollTop || 0 : 0;
  // Ouvrir la conversation la marque lue (onglet visible), avant de dessiner la liste et le badge.
  if (idOuvert) await marquerLue(idOuvert);
  // Ce que ce rendu montre de la conversation ouverte : le retour sur l'onglet ne marque lu que si rien n'est arrivé depuis.
  const vue = idOuvert ? (etat.brut.whatsapp_conversations || []).find((x) => x.id === idOuvert) : null;
  affiche = vue ? { id: idOuvert, dernier: vue.dernier_message_le || null } : null;
  const conversations = trierConversations(etat.brut.whatsapp_conversations || []);
  const propositions = etat.brut.whatsapp_propositions || [];
  const courantes = propositionsCourantes(propositions);
  // Un brouillon ne survit pas à sa proposition (traitée, ignorée, remplacée), un envoi incertain non plus.
  const aFaire = new Set(propositions.filter((p) => p.statut === "a_faire").map((p) => p.id));
  for (const id of [...brouillons.keys()]) if (!aFaire.has(id)) brouillons.delete(id);
  for (const id of [...envoisIncertains]) if (!aFaire.has(id)) envoisIncertains.delete(id);
  for (const id of [...aRetirer.keys()]) if (!aFaire.has(id)) aRetirer.delete(id);
  const ouverte = idOuvert ? conversations.find((c) => c.id === idOuvert) || null : null;
  const etapes = etapesDisponibles();
  const filtrer = (liste, f) =>
    f === FILTRE_PRET.valeur
      ? filtrerPretes(liste)
      : estFiltreEtape(f)
      ? filtrerParEtape(liste, f)
      : etapes && (f === "secret" || f === "taxi")
      ? liste.filter((c) => dansEntreprise(c, f))
      : etapes && f === "a_trier"
      ? liste.filter(aTrierNonClient)
      : filtrerConversations(liste, f, marqueDe);
  if (filtre === null) filtre = filtreDeDepart(conversations);
  // La conversation ouverte (notification, lien) reste visible dans la liste, quel que soit le filtre choisi.
  if (ouverte && !filtrer([ouverte], filtre).length) filtre = "toutes";
  const liste = filtrer(conversations, filtre);
  const nombres = chiffresFiltres(conversations, propositions, marqueDe);
  const reglage = (etat.brut.whatsapp_reglages || [])[0] || null;
  // « À faire » (PR B) : tout ce qui attend, trié par urgence, sans IA. Placé après « Toutes ».
  const aFaireBoite = aFaireDeLaBoite(entitesWhatsApp());
  nombres.a_faire = aFaireBoite.nombre;
  if (filtrePretDisponible()) nombres[FILTRE_PRET.valeur] = nombrePretes(conversations);
  // Migration 105 : un filtre par étape (« Prêt à réserver » en devient un) ; Secret et Taxi comptent les clients qui ont une étape chez
  // elles ; « À trier » ne garde que les contacts qui ne sont pas des clients, et disparaît s'il est vide.
  const parEtape = etapes ? filtresEtapes(conversations, filtre) : [];
  for (const f of parEtape) nombres[f.valeur] = f.nombre;
  if (etapes) {
    for (const m of ["secret", "taxi"]) nombres[m] = conversations.filter((c) => dansEntreprise(c, m) && aTraiter(c, courantes.get(c.id))).length;
    nombres.a_trier = conversations.filter(aTrierNonClient).length;
  }
  const suite = FILTRES.slice(1).filter((f) => !etapes || f.valeur !== "a_trier" || nombres.a_trier || filtre === "a_trier");
  const filtres = [FILTRES[0], { valeur: "a_faire", libelle: N_("À faire") }, ...(etapes ? parEtape : filtrePretDisponible() ? [FILTRE_PRET] : []), ...suite];

  const choix = puces({ libelle: tr("Afficher"), valeur: filtre, options: filtres.map((f) => ({ valeur: f.valeur, libelle: tr(f.libelle), nombre: nombres[f.valeur] || null })), onchange: (v) => ((filtre = v), rafraichir()) });
  const colonneListe = h(
    "section",
    { class: "wa-liste", "aria-label": tr("Conversations") },
    h(
      "div",
      { class: "wa-liste-tete" },
      h("h1", null, tr("WhatsApp")),
      reglage && reglage.numero ? h("p", { class: "sous" }, numeroAffiche(reglage.numero)) : null,
      // Le canal temps réel est coupé : l'écran se relit toutes les 5 s en attendant (app.mjs). La pastille suit l'état du canal sur place.
      h("span", { class: "wa-direct", role: "status", title: tr("Le temps réel est coupé : l'écran se met à jour toutes les 5 secondes en attendant qu'il revienne."), hidden: !directCoupe(etat.store.etatDirect ? etat.store.etatDirect().whatsapp : "abonne") }, tr("Mise à jour toutes les 5 s"))
    ),
    reglage && reglage.reception_active === false ? h("p", { class: "bandeau-info", role: "status" }, tr("Réception coupée dans les Réglages. Les nouveaux messages n'arrivent plus ici.")) : null,
    etat.brut.whatsapp_propositions_disponible === false ? h("p", { class: "bandeau-info", role: "status" }, tr("Les réponses préparées arriveront avec la migration 59.")) : null,
    choix.noeud,
    filtre === "a_faire"
      ? listeAFaire(aFaireBoite, { entites: entitesWhatsApp(), idOuvert })
      : liste.length
      ? h("ul", { class: "wa-conversations" }, liste.map((c) => ligneConversation(c, courantes.get(c.id), c.id === idOuvert)))
      : filtre === FILTRE_PRET.valeur
      ? videPret()
      : estFiltreEtape(filtre)
      ? h("p", { class: "aide wa-liste-vide" }, tr("Aucune conversation à cette étape."))
      : h("p", { class: "aide wa-liste-vide" }, filtre === "a_trier" ? tr("Rien à trier. Les conversations d'un numéro inconnu arrivent ici.") : tr("Aucune conversation. Les messages reçus sur le numéro arrivent ici, avec une notification si la cloche est activée."))
  );
  racine.append(colonneListe);
  if (idOuvert && !ouverte) {
    racine.classList.add("avec-fil");
    racine.append(h("section", { class: "wa-fil wa-fil-vide" }, h("a", { class: "bouton-icone lien wa-retour", href: "#/whatsapp", "aria-label": tr("Retour aux conversations") }, icone("retour", 22)), h("p", { class: "aide" }, tr("Cette conversation n'existe plus ou n'est pas dans vos entreprises."))));
  } else if (ouverte) {
    racine.classList.add("avec-fil");
    const { noeud, messages } = await fil(ouverte, courantes.get(ouverte.id) || null);
    racine.append(noeud);
    // Défilement (23.11.2026) : à l'ouverture, le dernier message ; ensuite, la conversation reste en bas tant que Nani n'a pas fait défiler
    // elle-même (images qui arrivent, message reçu). Si elle lit plus haut, rien ne la déplace : « Nouveaux messages ↓ » apparaît.
    const dernier = messages.length ? messages[messages.length - 1].id : "";
    racine.dataset.conversation = ouverte.id;
    racine.dataset.dernier = dernier;
    const meme = !!avant && avant.dataset.conversation === ouverte.id;
    const zone = noeud.querySelector(".wa-messages");
    const ancienneZone = meme ? avant.querySelector(".wa-messages") : null;
    const precedent = meme && suiviFil && suiviFil.zone === ancienneZone && !suiviFil.ctrl.arrete ? suiviFil : null;
    const nouveau = meme && avant.dataset.dernier !== dernier;
    const decision = decisionArrivee({ premiere: !precedent, nouveau, colle: precedent ? precedent.ctrl.colle : true, deMoi: nouveau && messages.length > 0 && messages[messages.length - 1].sens === "sortant" && messages[messages.length - 1].origine === "gestion" });
    // Ce que Nani lit, relevé sur l'écran encore affiché : la bulle lue est retrouvée après le redessin.
    const lectureAvant = precedent ? precedent.ctrl.instantane() : null;
    // Redessin sans message neuf, Nani en bas : elle y reste, à la même distance sous le dernier message (téléphone).
    const ecartAvant = precedent && !nouveau ? precedent.ctrl.ecart : 0;
    const dejaAnnonce = !!(precedent && precedent.bouton && !precedent.bouton.hidden);
    const bouton = h("button", { class: "wa-nouveaux", type: "button", hidden: true }, tr("Nouveaux messages"), h("span", { "aria-hidden": "true" }, " ↓"));
    zone.append(bouton);
    // Le message cité par l'adresse (PR B), montré une seule fois pour cette adresse : un redessin ne ramène pas Nani dessus.
    const cible = messageCible(lireAdresse(location.hash));
    const cle = cible ? `${ouverte.id}|${cible}` : "";
    if (!cible) messageMontre = "";
    // Téléphone (la page défile) : le dernier message en haut de l'écran, la réponse préparée et Copier juste dessous.
    const cibleTelephone = () => {
      const derniere = [...zone.querySelectorAll(".wa-bulle")].pop();
      if (!derniere) return Infinity;
      const tete = noeud.querySelector(".wa-fil-tete");
      // L'en-tête est collé en haut une fois la page défilée : sa hauteur plus sa position collée.
      const haut = tete ? tete.offsetHeight + (parseFloat(getComputedStyle(tete).top) || 0) : 0;
      return window.scrollY + derniere.getBoundingClientRect().top - haut - 12;
    };
    // Appelé par app.mjs juste après la mise en place de l'écran, avant l'affichage : la position est rendue sans image intermédiaire.
    racine.apresInsertion = () => {
      // Un redessin (message reçu, synchronisation) reprend les bulles inchangées de l'écran qu'il remplace : leurs photos restent chargées.
      // Fait ici seulement, une fois l'ancien écran retiré : un rendu abandonné (un plus récent a pris le relais) ne lui vole rien.
      if (ancienneZone) reprendreBulles(ancienneZone, zone);
      const colonne = racine.querySelector(".wa-liste");
      if (colonne && defilListe) colonne.scrollTop = defilListe;
      if (suiviFil) suiviFil.ctrl.arreter();
      const ctrl = suivreFil(zone, { cibleFenetre: cibleTelephone, bouton });
      suiviFil = { zone, ctrl, bouton };
      // Montré, le message quitte l'adresse : un rechargement ou un redessin ne ramène plus dessus.
      if (cle && cle !== messageMontre && montrerMessage(racine, cible)) {
        messageMontre = cle;
        history.replaceState(null, "", adresseConversation(ouverte));
        return void ctrl.garder(ctrl.instantane());
      }
      if (decision === "bas") ctrl.bas({ ecart: ecartAvant });
      else ctrl.garder(lectureAvant, { annoncer: decision === "annoncer" || dejaAnnonce });
    };
  } else {
    if (suiviFil) (suiviFil.ctrl.arreter(), (suiviFil = null));
    racine.append(h("section", { class: "wa-fil wa-fil-vide seulement-bureau" }, h("p", { class: "aide" }, tr("Choisissez une conversation."))));
    // La liste garde sa position entre deux rendus.
    if (defilListe)
      setTimeout(() => requestAnimationFrame(() => {
        const colonne = racine.isConnected && racine.querySelector(".wa-liste");
        if (colonne) colonne.scrollTop = defilListe;
      }), 0);
  }
  return racine;
}
