// Écran « WhatsApp » (#/whatsapp, migrations 58 et 59) : la boîte du numéro de Nani, un seul pour Secret et VIP Taxi Lanta.
// Nani répond depuis son app WhatsApp Business : ici elle lit, range la conversation dans la bonne entreprise d'un tap, relie le client et
// surtout copie la réponse préparée par l'agent, puis ouvre la conversation dans WhatsApp. L'envoi depuis Gestion reste secondaire.
// Téléphone : la liste, puis la conversation en plein écran avec retour, le bouton Copier en bas sous le pouce. Ordinateur : liste à gauche,
// conversation à droite (même mise en page que l'onglet Assistant).
// Réservé aux administrateurs de Secret et de Taxi (la base l'impose, le menu aussi) : Mook ne voit ni l'écran ni le menu.
// Une notification ouvre « #/whatsapp?c=<conversation>&entite=<entreprise> » : app.mjs passe dans l'entreprise, l'écran ouvre la conversation.
import { etat, modifier, entitesAccessibles, estSuperAdmin, permissionsDe, voitToutDans, nomClient, naviguer, changerEntite, reglagesDe, peut, modeTaxi } from "../etat.mjs";
import { h, toast, confirmer, icone, puces, modal, champ } from "../ui.mjs";
import { tr, N_, langueActive, localeActive } from "../i18n.mjs";
import { quand, bloquantsReponse, resteBloque, agentActif } from "../agent-calc.mjs";
import {
  CLE_DEMANDE_AGENT, modeDossier, paiementSignale, MOTIFS_PAIEMENT, lignesResume, tachesPromesse, piecesProposees, basculerPiece, PIECES_MAX, resumeEnRetard,
} from "../whatsapp-suivi-calc.mjs";
import { selecteurClient } from "./selecteur-client.mjs";
import { ecritConversation, avertissementsVisibles } from "../espace-unifie-calc.mjs";
import { directCoupe } from "../direct-reprise-calc.mjs";
import {
  marqueEntite, lecteurWhatsApp, trierConversations, filtrerConversations, chiffresFiltres, filtreDeDepart, FILTRES, propositionsCourantes,
  etatConversation, nomConversation, numeroAffiche, lienWhatsApp, lireAdresse, adresseConversation, fenetre, envoiPossible, avertissements,
  grouperParJour, heureBangkok, jourBangkok, etatMedia, LIBELLES_MEDIA, libelleType, ORIGINES, erreurEnvoi, envoiIncertain, propositionCourante,
  propositionAJour, entrepriseProposee, reponsesDe, preparationAuto, raisonSansReponse, erreurPreparer, libelleErreurProposition,
} from "../whatsapp-calc.mjs";

let filtre = null;
const rafraichir = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
// Ce qui doit survivre à un redessin de l'écran (synchronisation, Realtime), par identifiant de proposition :
//   brouillons : le texte modifié par Nani, remis dans la zone au rendu suivant ;
//   envoisIncertains : un envoi au résultat inconnu (délai dépassé, coupure), le bouton Envoyer ne se rallume pas ;
//   aRetirer : les montants et les noms que whatsapp-envoi a trouvés dans le texte (contenu_interne).
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
function ligneConversation(c, prop, ouverte) {
  const e = c.entite_id ? entite(c.entite_id) : null;
  const et = etatConversation(c, prop);
  const nonLus = Number(c.non_lus) || 0;
  return h(
    "li",
    null,
    h(
      "a",
      { href: adresseConversation(c), class: `wa-conv${nonLus ? " non-lue" : ""}`, "aria-current": ouverte ? "page" : null },
      h("span", { class: "wa-conv-ligne" }, h("strong", null, nomConversation(c, clientDe(c))), c.dernier_message_le ? h("time", { datetime: c.dernier_message_le }, quand(c.dernier_message_le, { langue: langueActive() })) : null),
      h(
        "span",
        { class: "wa-conv-ligne" },
        h("span", { class: `wa-conv-etat ${et.cle}` }, et.cle === "prete" ? icone("copier", 14) : null, et.libelle ? tr(et.libelle) : ""),
        h("span", { class: "wa-conv-droite" }, h("span", { class: `wa-marque${e ? "" : " a-trier"}` }, e ? e.nom : tr("À trier")), nonLus ? h("span", { class: "agent-pastille", "aria-label": tr("{n} non lus", { n: nonLus }) }, nonLus) : null)
      )
    )
  );
}

// ---- Conversation : en-tête ----------------------------------------------------------------------------------------------------
// Secret | VIP Taxi Lanta en un tap. « Proposé par l'agent » quand l'agent l'a rangée ; pour une conversation à trier, l'entreprise
// que l'agent propose est marquée.
function selecteurEntreprise(c, prop) {
  if (lectureSeule) return h("p", { class: "wa-lecture-seule", role: "status" }, icone("alerte", 16), tr("Lecture seule : conversation de {entreprise}", { entreprise: nomEntrepriseConv(c) }));
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
    c.entite_id && c.entite_source === "agent" ? h("span", { class: "wa-note" }, tr("proposé par l'agent")) : null,
    proposee ? h("span", { class: "wa-note propose" }, tr("L'agent propose {nom}", { nom: proposee.nom })) : null,
    !c.entite_id && !proposee ? h("span", { class: "wa-note" }, tr("À ranger dans une entreprise")) : null
  );
}

// Réponses préparées pour ce contact (migration 60) : automatiques (le tri décide) ou jamais (ami, famille, partenaire, chauffeur).
// Un tap, enregistré tout de suite. Seule Nani change ce réglage : la fonction ne le touche jamais.
function reglageReponses(c) {
  if (etat.brut.whatsapp_tri_disponible === false || lectureSeule) return null;
  const actuel = reponsesDe(c);
  // Réponses sur demande (Réglages > Assistant IA, décoché par défaut) : « auto » veut dire « au clic de Nani ». Le réglage lu est celui
  // que lit la fonction : l'entreprise de la conversation, ou pour une conversation à trier celle suggérée par le tri.
  const suggeree = !c.entite_id && c.tri ? entitesWhatsApp().find((e) => marqueEntite(e) === c.tri.entreprise) : null;
  const auto = !!(c.entite_id || suggeree) && preparationAuto(reglagesDe(c.entite_id || suggeree.id));
  const choisir = async (valeur, bouton) => {
    if (valeur === actuel || bouton.disabled) return;
    bouton.disabled = true;
    try {
      await modifier("whatsapp_conversations", c.id, { reponses: valeur });
      toast(valeur === "jamais" ? tr("Plus de réponse préparée pour ce contact.") : auto ? tr("Réponses préparées automatiques pour ce contact.") : tr("Réponses sur demande pour ce contact."));
      rafraichir();
    } catch (err) {
      bouton.disabled = false;
      toast(err.message, true);
    }
  };
  const segment = (valeur, libelle) => h("button", { type: "button", class: "wa-segment", "aria-pressed": valeur === actuel ? "true" : "false", onclick: (e) => choisir(valeur, e.currentTarget) }, libelle);
  return h(
    "div",
    { class: "wa-reponses", "data-pas-saisie": "" },
    h("span", { class: "wa-reponses-libelle", id: `wa-rep-${c.id}` }, tr("Réponses préparées")),
    h("div", { class: "wa-segments", role: "group", "aria-labelledby": `wa-rep-${c.id}` }, segment("auto", auto ? tr("Automatiques") : tr("Sur demande")), segment("jamais", tr("Jamais pour ce contact"))),
    h("span", { class: "wa-note" }, tr("Jamais : ami, famille, partenaire, chauffeur"))
  );
}

// Client et dossier reliés, avec le lien vers leur fiche. Relier un client se fait dans l'entreprise ouverte (celle de la conversation).
function blocRelations(c) {
  if (!c.entite_id) return h("p", { class: "wa-relations aide" }, tr("Rangez la conversation pour la relier à un client."));
  const client = clientDe(c);
  const dossier = dossierDe(c);
  const ici = c.entite_id === etat.entiteId;
  if (lectureSeule && !client && !dossier) return null;
  return h(
    "div",
    { class: "wa-relations", "data-pas-saisie": "" },
    client ? h("a", { href: `#/client/${client.id}`, class: "wa-lien-fiche" }, icone("clients", 16), nomClient(client)) : h("span", { class: "wa-sans" }, tr("Client non relié")),
    dossier ? h("a", { href: `#/dossier/${dossier.id}`, class: "wa-lien-fiche" }, icone("dossiers", 16), tr("Dossier {ref}", { ref: dossier.ref })) : null,
    lectureSeule ? null : ici ? h("button", { type: "button", class: "lien", onclick: () => ouvrirRelier(c) }, client ? tr("Changer") : tr("Relier un client")) : h("a", { class: "lien", href: adresseConversation(c) }, tr("Ouvrir dans {nom}", { nom: (entite(c.entite_id) || {}).nom || "" }))
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

function enTete(c, prop) {
  const wa = lienWhatsApp(c.telephone);
  // Sur téléphone, seule la ligne du nom reste collée en haut : l'entreprise et le client défilent avec les messages.
  return [
    h(
      "header",
      { class: "wa-fil-tete" },
      h("a", { class: "bouton-icone lien wa-retour", href: "#/whatsapp", "aria-label": tr("Retour aux conversations") }, icone("retour", 22)),
      h("div", { class: "wa-fil-titre" }, h("h2", null, nomConversation(c, clientDe(c))), h("p", { class: "wa-numero" }, numeroAffiche(c.telephone), c.nom && clientDe(c) ? h("span", null, tr("profil « {nom} »", { nom: c.nom })) : null)),
      wa ? h("a", { class: "bouton secondaire petit wa-ouvrir-tete", href: wa, target: "_blank", rel: "noopener", "aria-label": tr("Ouvrir dans WhatsApp") }, icone("whatsapp", 18), h("span", { class: "wa-ouvrir-texte" }, tr("Ouvrir dans WhatsApp"))) : null
    ),
    h("div", { class: "wa-fil-infos" }, selecteurEntreprise(c, prop), blocRelations(c), reglageReponses(c), actionsDossier(c, prop)),
    blocResume(c),
  ];
}

// ---- Suivi (migrations 61 et 62) ------------------------------------------------------------------------------------------------------
// « Créer le dossier » ou « Mettre à jour le dossier » : l'Assistant de l'entreprise de la conversation s'ouvre et lit l'échange lui-même
// (texte, photos, PDF). Proposé seulement là où l'Assistant est allumé et permis (comme son onglet).
const assistantDans = (id) => !!id && agentActif(reglagesDe(id)) && ["partenaires.lire", "dossiers.ecrire"].every((d) => permissionsDe(id).includes(d));
function choisirEntreprise(c, prop) {
  const choix = entitesWhatsApp().filter((e) => assistantDans(e.id));
  const proposee = entrepriseProposee(prop, choix);
  return new Promise((resoudre) => {
    let fermer;
    // Résolue avant de fermer : la fermeture rend « null » (fenêtre fermée sans choix), sans effet après un choix.
    const prendre = (e) => (resoudre(e), fermer());
    fermer = modal(
      tr("Dans quelle entreprise ?"),
      h("div", { class: "modal-corps" }, h("p", { class: "aide" }, tr("La conversation est à trier. Elle sera rangée dans l'entreprise choisie, puis l'Assistant prépare le dossier.")), h("div", { class: "barre-modal" }, choix.map((e) => h("button", { class: proposee && proposee.id === e.id ? "principal" : "secondaire", type: "button", onclick: () => prendre(e) }, e.nom)))),
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
        etat.store.whatsappLienMedia(p.media).then((lien) => lien && vignette.replaceChildren(h("img", { src: lien, alt: "" })), () => {});
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
  let entreprise = null;
  if (!entiteId) {
    entreprise = await choisirEntreprise(c, prop);
    if (!entreprise) return;
    if (prop && prop.statut === "a_faire" && brouillons.has(prop.id) && prop.entite_id !== entreprise.id && !(await confirmer(tr("Vous avez modifié la réponse préparée. La ranger dans {nom} la remplace et vos changements seront perdus. Continuer ?", { nom: entreprise.nom }), tr("Ranger dans {nom}", { nom: entreprise.nom }), true))) return;
  }
  // Les pièces d'abord : fermer la feuille annule tout, sans ranger la conversation.
  const pieces = await choisirPieces(c);
  if (pieces === null) return;
  if (entreprise) {
    try {
      await modifier("whatsapp_conversations", c.id, { entite_id: entreprise.id });
    } catch (err) {
      return toast(err.message, true);
    }
    entiteId = entreprise.id;
  }
  try {
    sessionStorage.setItem(CLE_DEMANDE_AGENT, JSON.stringify({ id: c.id, mode: modeDossier(c), entite: entiteId, pieces }));
  } catch {
    return toast(tr("Ce navigateur refuse le stockage de la page : ouvrez l'Assistant et collez l'échange."), true);
  }
  if (entiteId !== etat.entiteId) changerEntite(entiteId, { naviguer: false });
  naviguer("#/agent/nouvelle");
}
// Le voucher du dossier relié (Booking confirmation chez Taxi), par l'écran d'envoi habituel (partage de l'image sur iPhone).
async function envoyerVoucherDuDossier(dossierId) {
  const [{ courseDuDossier }, { envoyerVoucher }] = await Promise.all([import("./creation-course.mjs"), import("./voucher-envoi.mjs")]);
  const x = courseDuDossier(dossierId);
  if (!x.reservation) return toast(tr("Ce dossier n'a pas encore de service à mettre sur un voucher."), true);
  envoyerVoucher(x);
}
function actionsDossier(c, prop) {
  if (lectureSeule) return null;
  const ici = c.entite_id && c.entite_id === etat.entiteId;
  const dossier = ici ? dossierDe(c) : null;
  const assistant = c.entite_id ? assistantDans(c.entite_id) : entitesWhatsApp().some((e) => assistantDans(e.id));
  const boutons = [
    assistant && (!c.entite_id || ici) ? h("button", { type: "button", class: "secondaire petit", onclick: () => versAssistant(c, prop) }, icone("assistant", 16), dossier ? tr("Mettre à jour le dossier") : tr("Créer le dossier")) : null,
    dossier ? h("button", { type: "button", class: "secondaire petit", onclick: () => envoyerVoucherDuDossier(dossier.id) }, icone("whatsapp", 16), modeTaxi() ? tr("Envoyer la Booking confirmation") : tr("Envoyer le voucher")) : null,
  ].filter(Boolean);
  return boutons.length ? h("div", { class: "wa-actions-dossier", "data-pas-saisie": "" }, boutons) : null;
}

// Le résumé en trois lignes (fonction « whatsapp », Claude Haiku), repliable ; replié ou non est gardé pour la session.
const resumesReplies = new Set();
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
function blocMedia(media) {
  const e = etatMedia(media);
  const legende = media.legende ? h("figcaption", null, media.legende) : null;
  if (LIBELLES_MEDIA[e]) return h("p", { class: `wa-media-absent ${e}` }, icone(e === "attente" ? "horloge" : "alerte", 16), tr(LIBELLES_MEDIA[e]));
  if (e === "image") {
    const zone = h("span", { class: "wa-vignette-vide" }, icone("image", 22), h("span", null, etat.store.mode === "demo" ? tr("Aperçu indisponible en démonstration") : tr("Photo en chargement")));
    const fig = h("figure", { class: "wa-image" }, h("button", { type: "button", class: "wa-vignette", "aria-label": tr("Ouvrir la photo"), onclick: () => ouvrirMedia(media) }, zone), legende);
    // La vignette se charge après l'affichage : un lien par photo, sans retenir l'écran.
    etat.store.whatsappLienMedia(media).then((lien) => {
      if (!lien) return void (etat.store.mode !== "demo" && zone.replaceChildren(icone("image", 22), h("span", null, tr("Photo indisponible"))));
      zone.replaceWith(h("img", { src: lien, alt: media.legende || tr("Photo envoyée par le client"), loading: "lazy" }));
    }, () => {});
    return fig;
  }
  const libelle = media.nom || tr(libelleType(e));
  return h("figure", { class: "wa-fichier" }, h("button", { type: "button", class: "secondaire petit", onclick: () => ouvrirMedia(media) }, icone(e === "document" ? "trombone" : "fleche", 16), libelle), legende);
}

function bulle(m) {
  const medias = Array.isArray(m.medias) ? m.medias : [];
  const texte = m.texte && !(medias.length && medias.some((x) => x.legende === m.texte)) ? m.texte : "";
  const meta = [heureBangkok(m.envoye_le), m.sens === "sortant" && ORIGINES[m.origine] ? tr(ORIGINES[m.origine]) : "", m.modifie_le ? tr("modifié") : ""].filter(Boolean).join(" · ");
  return h(
    "div",
    { class: `wa-bulle ${m.sens}${m.supprime_le ? " supprime" : ""}${m.type === "reaction" ? " reaction" : ""}` },
    m.supprime_le ? h("p", { class: "wa-supprime" }, tr("Supprimé par le client")) : null,
    medias.map(blocMedia),
    texte ? h("p", { class: "wa-texte" }, m.type === "reaction" ? `${tr("Réaction")} ${texte}` : texte) : !medias.length ? h("p", { class: "wa-texte wa-type" }, tr(libelleType(m.type))) : null,
    h("p", { class: "wa-meta" }, meta)
  );
}

// ---- Proposition de l'agent -------------------------------------------------------------------------------------------------------
async function copier(c, p, zone, bouton) {
  if (bouton.disabled) return;
  // Comme pour l'envoi (audit dev B2) : une réponse remplacée entre-temps (le client a réécrit) ne se copie pas sans le dire.
  if (!toujoursCourante(c, p)) {
    toast(tr("Cette réponse n'est plus la dernière préparée. Rien n'a été copié."), true);
    return rafraichir();
  }
  try {
    await navigator.clipboard.writeText(zone.value);
    bouton.classList.add("fait");
    bouton.replaceChildren(icone("coche", 20), tr("Copié"));
    setTimeout(() => bouton.isConnected && (bouton.classList.remove("fait"), bouton.replaceChildren(icone("copier", 20), tr("Copier"))), 2500);
    toast(tr("Réponse copiée. Collez-la dans WhatsApp."));
  } catch {
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
  const r = await etat.store.whatsappEnvoyer({ conversation_id: c.id, texte: zone.value, proposition_id: p.id });
  if (r && r.demo) {
    bouton.disabled = false;
    return toast(tr("En démo, rien n'est envoyé."));
  }
  if (!r || !r.ok) {
    const code = r && r.erreur;
    // Résultat inconnu (délai dépassé, connexion coupée) : le bouton reste éteint et l'écran dit de vérifier dans WhatsApp, jamais « réessayez ».
    if (envoiIncertain(code)) envoisIncertains.add(p.id);
    else bouton.disabled = false;
    if (code === "contenu_interne") aRetirer.set(p.id, (r && r.a_retirer) || []);
    toast(tr(erreurEnvoi(code)), true);
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
    bouton.replaceChildren(tr("Préparation demandée…"));
    return toast(tr("Préparation demandée. La réponse arrive dans un instant."));
  }
  bouton.disabled = false;
  toast(tr(erreurPreparer(r && r.erreur)), true);
}

// Aucune réponse préparée pour le dernier message du client : l'état normal depuis le 20.11.2026 (réponses sur demande). Le bouton
// « Préparer une réponse », et à côté ce que le tri a vu, sans icône d'alerte.
function ligneSansReponse(c, messages) {
  const dernier = messages.length ? messages[messages.length - 1] : null;
  const bouton = !lectureSeule && dernier && dernier.sens === "entrant" && etat.store.whatsappPreparer ? h("button", { class: "secondaire petit", type: "button", onclick: (e) => preparer(c, e.currentTarget) }, tr("Préparer une réponse")) : null;
  const raison = raisonSansReponse(c, messages);
  if (!bouton && !raison) return null;
  return h("div", { class: "wa-sans-reponse" }, bouton, raison ? h("p", { class: "wa-note" }, tr(raison)) : null);
}

function carteProposition(c, p, messages) {
  // Le client attend et aucune réponse n'est préparée (tri, contact réglé sur « Jamais », agent qui n'a pas su trier) : on le dit.
  if (!p) return etat.brut.whatsapp_propositions_disponible !== false && messages.length && messages[messages.length - 1].sens === "entrant" ? ligneSansReponse(c, messages) : null;
  if (p.statut === "envoi") return h("section", { class: "wa-prop en-cours", "aria-live": "polite" }, h("p", { class: "agent-etape" }, h("span", { class: "agent-point", "aria-hidden": "true" }), tr("Envoi en cours depuis Gestion…")));
  // « Fait » ne vaut que pour une proposition au moins aussi récente que le dernier message du client.
  // Nani a déjà répondu depuis (dernier message sortant) : rien à dire.
  const repondu = messages.length > 0 && messages[messages.length - 1].sens === "sortant";
  if ((p.statut === "traitee" || p.statut === "ignoree") && repondu && !propositionAJour(p, messages)) return null;
  if ((p.statut === "traitee" || p.statut === "ignoree") && !propositionAJour(p, messages)) return ligneSansReponse(c, messages);
  if (p.statut === "en_cours") return h("section", { class: "wa-prop en-cours", "aria-live": "polite" }, h("p", { class: "agent-etape" }, h("span", { class: "agent-point", "aria-hidden": "true" }), tr("Réponse en préparation…")));
  if (p.statut === "echec")
    return h("section", { class: "wa-prop echec", role: "status" }, h("p", null, h("strong", null, tr("L'agent n'a pas pu préparer de réponse.")), " ", tr("Répondez depuis l'app comme d'habitude.")), p.erreur ? h("p", { class: "wa-detail" }, libelleErreurProposition(p.erreur) ? tr(libelleErreurProposition(p.erreur)) : p.erreur) : null);
  if (p.statut === "traitee" || p.statut === "ignoree")
    return h("p", { class: "wa-prop-fait" }, icone(p.statut === "traitee" ? "coche" : "fermer", 16), p.statut === "ignoree" ? tr("Réponse préparée ignorée") : tr(TRAITEE_PAR[p.traitee_par_quoi] || N_("Répondu")), p.traitee_le ? h("time", { datetime: p.traitee_le }, ` ${quand(p.traitee_le, { langue: langueActive() })}`) : null);
  if (p.statut !== "a_faire") return null;

  const zone = h("textarea", { id: "wa-reponse", rows: 7, lang: p.langue || "en", spellcheck: "true", "aria-label": tr("Réponse préparée") });
  // Le texte modifié survit au redessin de l'écran (synchronisation, nouveau message dans une autre conversation).
  zone.value = brouillons.has(p.id) ? brouillons.get(p.id) : p.texte || "";
  const f = fenetre(messages);
  const boutonCopier = h("button", { class: "principal wa-copier", type: "button", onclick: (e) => copier(c, p, zone, e.currentTarget) }, icone("copier", 20), tr("Copier"));
  const wa = lienWhatsApp(c.telephone);
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
    const serveur = aRetirer.get(p.id) || [];
    const duServeur = resteBloque(zone.value, { montants: serveur.filter((x) => Number.isFinite(Number(x))).map(Number), noms: serveur.filter((x) => !Number.isFinite(Number(x))) });
    const reste = [...new Set([...resteBloque(zone.value, bloquants), ...duServeur])];
    const incertain = envoisIncertains.has(p.id);
    alerte.hidden = !reste.length;
    alerte.textContent = !reste.length ? "" : filtre.masques ? tr("Un montant ou un nom interne est dans la réponse : à retirer avant de copier.") : tr("À retirer avant de copier : {liste}. Ces chiffres et ces noms ne vont jamais au client.", { liste: reste.join(", ") });
    boutonEnvoyer.disabled = !ok.ok || reste.length > 0 || incertain;
    pourquoi.textContent = incertain ? tr(erreurEnvoi("verifier_whatsapp")) : ok.raison === "fenetre_fermee" ? tr("Envoi depuis Gestion fermé, le client a écrit il y a plus de 24 h.") : ok.raison === "vide" ? tr("La réponse est vide.") : "";
    pourquoi.hidden = !pourquoi.textContent;
    boutonCopier.disabled = !zone.value.trim() || reste.length > 0;
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
  const avs = avertissements({ ...p, avertissements: filtre.visibles });
  // Préparée avec les données d'une autre entreprise que celle de la conversation (à trier, ou rangée ailleurs depuis) : on le dit.
  const pour = p.entite_id && p.entite_id !== c.entite_id ? entite(p.entite_id) : null;
  const boutonTraitee = h("button", { class: "lien", type: "button" }, tr("Marquer traitée"));
  const boutonIgnorer = h("button", { class: "lien", type: "button" }, tr("Ignorer"));
  boutonTraitee.addEventListener("click", () => traiter(p, "traitee", [boutonTraitee, boutonIgnorer]));
  boutonIgnorer.addEventListener("click", () => traiter(p, "ignoree", [boutonTraitee, boutonIgnorer]));
  return h(
    "section",
    // Hors saisie (audit dev B2) : le texte modifié survit au redessin (Map brouillons), il ne doit donc pas figer l'écran. Seul le curseur
    // dans le champ retient le redessin (curseurDansUnChamp).
    { class: "wa-prop", "aria-label": tr("Réponse préparée"), "data-pas-saisie": "" },
    h("h3", null, tr("Réponse préparée"), p.langue ? h("span", { class: "tag" }, p.langue.toUpperCase()) : null, pour ? h("span", { class: "wa-pour" }, tr("préparée pour {nom}", { nom: pour.nom })) : null),
    avs.length ? h("ul", { class: "wa-avertissements" }, avs.map((a) => h("li", { class: a.niveau }, icone(a.niveau === "alerte" ? "alerte" : "coche", 16), h("span", null, tr(a.texte, a.vars))))) : null,
    zone,
    alerte,
    h("div", { class: "wa-prop-actions" }, boutonCopier, wa ? h("a", { class: "bouton secondaire wa-ouvrir", href: wa, target: "_blank", rel: "noopener" }, icone("whatsapp", 18), tr("Ouvrir dans WhatsApp")) : null),
    lectureSeule ? null : h("div", { class: "wa-prop-suite" }, boutonTraitee, boutonIgnorer, boutonEnvoyer),
    pourquoi
  );
}

async function fil(c, prop) {
  let messages = [];
  let erreur = null;
  try {
    messages = await etat.store.whatsappMessages(c.id);
  } catch (err) {
    erreur = err;
  }
  const jours = grouperParJour(messages);
  lectureSeule = !peutEcrire(c);
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
      cartePaiement(c)
    ),
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
  // L'écran tel qu'il était avant ce rendu (redessin à la même adresse) : la position de la liste et de la conversation à garder.
  const avant = document.querySelector("#principal > .wa");
  const defilListe = avant ? (avant.querySelector(".wa-liste") || {}).scrollTop || 0 : 0;
  const defilMessages = avant ? (avant.querySelector(".wa-messages") || {}).scrollTop || 0 : 0;
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
  const filtrer = (liste, f) => filtrerConversations(liste, f, marqueDe);
  if (filtre === null) filtre = filtreDeDepart(conversations);
  // La conversation ouverte (notification, lien) reste visible dans la liste, quel que soit le filtre choisi.
  if (ouverte && !filtrer([ouverte], filtre).length) filtre = "toutes";
  const liste = filtrer(conversations, filtre);
  const nombres = chiffresFiltres(conversations, propositions, marqueDe);
  const reglage = (etat.brut.whatsapp_reglages || [])[0] || null;

  const choix = puces({ libelle: tr("Afficher"), valeur: filtre, options: FILTRES.map((f) => ({ valeur: f.valeur, libelle: tr(f.libelle), nombre: nombres[f.valeur] || null })), onchange: (v) => ((filtre = v), rafraichir()) });
  const colonneListe = h(
    "section",
    { class: "wa-liste", "aria-label": tr("Conversations") },
    h(
      "div",
      { class: "wa-liste-tete" },
      h("h1", null, tr("WhatsApp")),
      reglage && reglage.numero ? h("p", { class: "sous" }, numeroAffiche(reglage.numero)) : null,
      // Le canal temps réel est coupé : l'écran se relit toutes les 5 s en attendant (app.mjs). La pastille suit l'état du canal sur place.
      h("span", { class: "wa-direct", role: "status", title: tr("Le temps réel est coupé : l'écran se met à jour toutes les 5 secondes en attendant qu'il revienne."), hidden: !directCoupe(etat.store.etatDirect ? etat.store.etatDirect().whatsapp : "abonne") }, tr("Direct coupé"))
    ),
    reglage && reglage.reception_active === false ? h("p", { class: "bandeau-info", role: "status" }, tr("Réception coupée dans les Réglages. Les nouveaux messages n'arrivent plus ici.")) : null,
    etat.brut.whatsapp_propositions_disponible === false ? h("p", { class: "bandeau-info", role: "status" }, tr("Les réponses préparées arriveront avec la migration 59.")) : null,
    choix.noeud,
    liste.length
      ? h("ul", { class: "wa-conversations" }, liste.map((c) => ligneConversation(c, courantes.get(c.id), c.id === idOuvert)))
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
    // Le défilement ne se replace qu'au premier affichage de la conversation ou à l'arrivée d'un nouveau message. Un redessin pour autre
    // chose (synchronisation, Realtime) laisse Nani où elle lisait.
    const dernier = messages.length ? messages[messages.length - 1].id : "";
    racine.dataset.conversation = ouverte.id;
    racine.dataset.dernier = dernier;
    const replacer = !avant || avant.dataset.conversation !== ouverte.id || avant.dataset.dernier !== dernier;
    // Les derniers messages et la réponse préparée en vue, après le placement du défilement par app.mjs (deux images d'affichage, comme lui).
    const placer = () => {
      if (!racine.isConnected) return;
      const zone = racine.querySelector(".wa-messages");
      const colonne = racine.querySelector(".wa-liste");
      if (colonne && defilListe) colonne.scrollTop = defilListe;
      if (!replacer) return void (zone && (zone.scrollTop = defilMessages));
      if (window.matchMedia("(min-width: 900px)").matches) zone && (zone.scrollTop = zone.scrollHeight);
      else {
        // Téléphone : le dernier message en haut de l'écran, la réponse préparée et Copier juste dessous.
        const derniere = [...racine.querySelectorAll(".wa-bulle")].pop();
        const tete = racine.querySelector(".wa-fil-tete");
        // L'en-tête est collé en haut une fois la page défilée : sa hauteur plus sa position collée.
        const haut = tete ? tete.offsetHeight + (parseFloat(getComputedStyle(tete).top) || 0) : 0;
        window.scrollTo(0, derniere ? Math.max(0, window.scrollY + derniere.getBoundingClientRect().top - haut - 12) : document.documentElement.scrollHeight);
      }
    };
    setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(placer)), 0);
  } else {
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
