// Onglet « Assistant » (19.11.2026) : on discute avec l'agent comme dans une messagerie, une conversation par client ou par demande,
// plusieurs ouvertes en parallèle. L'agent cherche, calcule et propose ; chaque proposition est une carte que la personne valide.
// L'onglet est la seule entrée des demandes et des confirmations collées (20.11.2026, décision de Jérémy). « Valider » enregistre d'un geste
// par le code habituel de l'outil (fiche de création du dossier, confirmation de course, formulaire de réservation), sans le réécrire : la
// fenêtre ne s'ouvre que s'il manque quelque chose ; la carte garde alors le motif. « Tout valider » fait de même pour toutes les cartes.
// Téléphone d'abord : la liste, puis le fil en plein écran avec la zone de saisie en bas. Ordinateur : la liste à gauche, le fil à droite.
import { etat, reglages, peut, naviguer, exemple, nomPartenaire, modeTaxi, estAdmin, enregistrerReglages, modifier, entitesAccessibles, changerEntite, confirmationPermise } from "../etat.mjs";
import { h, toast, confirmer, modal, icone, vider, ajouter } from "../ui.mjs";
import { tr, N_, pluriel, langueActive } from "../i18n.mjs";
import { agentActif, filDepuis, listeConversations, quand, propositionDepuisCarte, reservationDepuisCarte, reservationModifiee, lignesFrise, reglageApplique, prestationModifiee, listeAmeliorations, bloquantsReponse, resteBloque } from "../agent-calc.mjs";
import { texteDuree } from "../agent-planifier.mjs";
import { clePaire, detailMorceaux } from "../agent-temps.mjs";
import { propositionVersDemande } from "../assistant-calc.mjs";
import { lireMessage } from "../demande-calc.mjs";
import { lireConfirmation, ressembleAConfirmation } from "../confirmation-calc.mjs";
import { demandeDeTaxi, entrepriseTaxi } from "../taxi-calc.mjs";
import { aujourdhui } from "../calc.mjs";
import { correctionsDepuisCarte, dossierDeLaCarte } from "../agent-apprendre.mjs";
import { rafraichirBandeauCredit } from "./bandeau-credit.mjs";
import { piecesSaisie, bullePieces, carteBrochure } from "./agent-pieces.mjs";
import { erreurFichier } from "../pieces-jointes.mjs";
import { CLE_DEMANDE_AGENT, demandeAgent, liaisonApresDossier, ERREURS_AGENT_WHATSAPP } from "../whatsapp-suivi-calc.mjs";

// Une demande collée dans une autre entreprise que la sienne (« Transfer request » du site VIP Taxi Lanta dans Secret) : le message passe à
// l'Assistant de l'autre entreprise, dans une nouvelle conversation, prêt à être envoyé.
const CLE_BROUILLON = "gestion-agent-brouillon";

const ERREURS = {
  assistant_eteint: N_("L'assistant est éteint pour cette entreprise (Réglages)."),
  agent_eteint: N_("L'onglet Assistant est éteint pour cette entreprise (Réglages)."),
  droit_manquant: N_("Votre rôle ne permet pas d'utiliser l'assistant ici."),
  limite_du_jour: N_("Limite d'échanges du jour atteinte : l'assistant reprend demain."),
  plafond_du_mois: N_("Le plafond du mois de l'assistant est atteint : il reprend le 1er du mois prochain, ou plus tôt si l'administration relève le plafond."),
  credit_epuise: N_("Le crédit Anthropic de l'assistant est épuisé : l'administration doit le recharger. Le reste de l'outil marche normalement."),
  non_configure: N_("L'assistant n'est pas encore activé sur le serveur."),
  occupe: N_("L'assistant est très demandé : réessayez dans une minute."),
  refus: N_("L'assistant n'a pas traité ce message."),
  coupe: N_("La réponse était trop longue : demandez la suite."),
  trop_long: N_("L'assistant a pris trop de temps : demandez-lui de continuer."),
  hors_ligne: N_("Pas de connexion : le message n'est pas parti."),
  coupure: N_("La connexion a coupé pendant la réponse : rouvrez la conversation."),
  migration_manquante: N_("Les conversations ne sont pas encore installées dans la base."),
  conversation_introuvable: N_("Cette conversation n'existe plus."),
  message_invalide: N_("Le message est vide ou trop long."),
};
// Le plafond du mois atteint : la fonction dit combien a été dépensé et quand l'assistant reprend.
function erreurTexte(code, detail = null) {
  if (code === "plafond_du_mois" && detail && Number(detail.plafond) > 0 && detail.reprise) {
    const montant = (x) => `${Number(x).toLocaleString(langueActive() === "en" ? "en-US" : "fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
    const jour = new Date(`${detail.reprise}T12:00:00Z`).toLocaleDateString(langueActive() === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
    return tr("Le plafond du mois de l'assistant est atteint ({depense} dépensés sur {plafond}). Il reprend le {jour}, ou plus tôt si l'administration relève le plafond dans « Suivi de l'assistant ».", { depense: montant(detail.depense ?? detail.plafond), plafond: montant(detail.plafond), jour });
  }
  return erreurFichier(code) || tr(ERREURS[code] || ERREURS_AGENT_WHATSAPP[code] || N_("L'assistant ne répond pas."));
}

// Demandes d'amélioration (fonction « ameliorations ») : motifs d'un refus et statut de chaque demande.
const ERREURS_AMELIORATION = {
  reserve_admin: N_("Seule une administratrice peut demander une amélioration."),
  carte_introuvable: N_("Cette proposition n'existe plus."),
  deja_decidee: N_("Cette demande a déjà été envoyée ou écartée."),
  limite_du_jour: N_("Assez de demandes pour aujourd'hui : envoyez celle-ci demain."),
  titre_vide: N_("Donnez un titre à la demande."),
  texte_refuse: N_("Le texte sera public : retirez les noms, numéros, montants et liens, puis renvoyez."),
  non_configure: N_("Les demandes d'amélioration ne sont pas encore activées sur le serveur."),
  github_indisponible: N_("GitHub ne répond pas : rien n'est parti, réessayez plus tard."),
  migration_manquante: N_("Les demandes d'amélioration ne sont pas encore installées dans la base."),
  hors_ligne: N_("Pas de connexion : la demande n'est pas partie."),
};
const MOTIFS_TEXTE = {
  courriel: N_("une adresse e-mail"),
  telephone: N_("un numéro de téléphone"),
  lien: N_("un lien"),
  montant: N_("un montant ou un numéro"),
  acces: N_("une coordonnée bancaire ou un accès"),
  montant_interne: N_("un chiffre près d'un net ou d'une commission"),
  nom_propre: N_("un nom de client ou de prestataire"),
  texte_vide: N_("un texte vide"),
  texte_trop_long: N_("un texte trop long"),
};
const STATUTS_AMELIORATION = {
  envoyee: N_("Envoyée, en préparation"),
  pr_prete: N_("Prête, Jérémy relit"),
  en_ligne: N_("Acceptée, en ligne"),
  refusee: N_("Non retenue"),
  echec: N_("En attente de Jérémy"),
};

const AVERTISSEMENTS = {
  signature_retiree: N_("La signature en bas a été retirée : la réponse ne signe pas."),
  nom_prestataire: N_("Le message cite un partenaire : à retirer avant d'envoyer."),
  prenom_equipe: N_("Le message nomme quelqu'un de l'équipe : à retirer, la réponse ne signe pas."),
  prix_non_tape: N_("Un prix proposé ne venait ni du catalogue ni de vous : il a été laissé vide."),
  reference_inconnue: N_("Un service proposé n'existe pas au catalogue : choisissez-le à la main."),
  date_illisible: N_("Une date n'a pas pu être lue."),
};
function texteAvertissement(a) {
  const [code, valeur] = String(a).split(/:(.*)/s);
  if (code === "montant_non_source") return tr("Montant sans source dans la conversation : {v}. À vérifier.", { v: valeur });
  if (code === "heure_non_source") return tr("Heure sans source dans la conversation : {v}. À vérifier.", { v: valeur });
  if (code === "mot_interne") return tr("Mot interne dans la réponse : « {v} ». À retirer.", { v: valeur });
  if (code === "montant_interne") return tr("Montant interne (net, marge ou commission) dans la réponse : {v}. À retirer.", { v: valeur });
  if (code === "nom_prestataire" && valeur) return tr("La réponse cite le partenaire « {v} » : à retirer.", { v: valeur });
  return tr(AVERTISSEMENTS[code] || N_("À vérifier."));
}

// Ce que l'agent est en train de faire, par outil (la fonction envoie le nom de l'outil).
const ETAPES = {
  chercher_catalogue: N_("Je cherche dans le catalogue"),
  horaires_trajet: N_("Je regarde les horaires"),
  situer_hotels: N_("Je situe les hôtels"),
  temps_de_route: N_("Je calcule le temps de route"),
  planifier_course: N_("Je calcule les horaires de la course"),
  chercher_clients: N_("Je cherche le client"),
  lire_dossier: N_("Je lis le dossier"),
  proposer_dossier: N_("Je prépare le dossier"),
  proposer_reservation: N_("Je prépare le service"),
  proposer_modification: N_("Je prépare la modification"),
  proposer_reponse: N_("Je prépare la réponse"),
  estimer_temps_web: N_("Je cherche une estimation sur le web"),
  proposer_temps_trajet: N_("Je prépare la durée pour la table"),
  proposer_course: N_("Je prépare la course"),
  proposer_import_brochure: N_("Je prépare l'import de la brochure"),
  lire_reglages: N_("Je lis les réglages"),
  proposer_reglage: N_("Je prépare le réglage"),
  proposer_amelioration: N_("Je prépare la demande d'amélioration"),
};

const disponible = () => agentActif(reglages()) && peut("partenaires.lire") && peut("dossiers.ecrire");

// ---- Écran -----------------------------------------------------------------------------------------------------------------------

export async function vueAgent(idOuvert = "") {
  if (!disponible()) {
    const racine = h("div", { "data-titre": tr("Assistant") });
    racine.append(
      h("h1", null, tr("Assistant")),
      h("div", { class: "vide" }, h("p", null, peut("dossiers.ecrire") ? tr("L'assistant n'est pas allumé pour cette entreprise.") : tr("Votre rôle ne permet pas d'utiliser l'assistant ici.")), peut("reglages.ecrire") ? h("a", { href: "#/reglages" }, tr("Ouvrir les réglages")) : null)
    );
    return racine;
  }

  const racine = h("div", { class: "agent", "data-titre": tr("Assistant") });
  // Conversations et demandes d'amélioration (administratrices) lues ensemble.
  const [convLues, ameliorationsLues] = await Promise.all([etat.store.agentConversations(etat.entiteId), estAdmin() ? etat.store.ameliorations(etat.entiteId) : null]);
  let conversations = convLues ?? null;
  let attente = new Map();
  let archives = false;
  const rafraichirAttente = async () => {
    const lignes = await etat.store.agentAttente(etat.entiteId);
    attente = new Map();
    for (const l of lignes) attente.set(l.conversation_id, (attente.get(l.conversation_id) || 0) + 1);
  };
  await rafraichirAttente();

  const colonneListe = h("section", { class: "agent-liste", "aria-label": tr("Conversations") });
  const colonneFil = h("section", { class: "agent-fil", "aria-live": "off" });
  racine.append(colonneListe, colonneFil);
  racine.classList.toggle("avec-fil", !!idOuvert);

  // ---- Liste ----------------------------------------------------------------------------------------------------------------------
  function dessinerListe() {
    const liste = conversations ? listeConversations(conversations, { enAttente: attente, archives }) : [];
    vider(colonneListe);
    ajouter(colonneListe, [
      h("div", { class: "agent-liste-tete" }, h("h1", null, tr("Assistant")), h("button", { class: "principal", type: "button", onclick: () => ouvrir("") }, icone("ajouter", 18), tr("Nouvelle"))),
      conversations === null
        ? h("p", { class: "aide" }, erreurTexte("migration_manquante"))
        : liste.length
          ? h(
              "ul",
              { class: "agent-conversations" },
              liste.map((c) =>
                h(
                  "li",
                  null,
                  h(
                    "a",
                    { href: `#/agent/${c.id}`, class: "agent-conv", "aria-current": c.id === idOuvert ? "page" : null },
                    h("span", { class: "agent-conv-ligne" }, h("strong", null, c.titre || tr("Nouvelle conversation")), h("time", { datetime: c.maj_le }, quand(c.maj_le, { langue: langueActive() }))),
                    h("span", { class: "agent-conv-ligne" }, h("span", { class: "agent-conv-apercu" }, c.apercu || ""), c.attente ? h("span", { class: "agent-pastille", "aria-label": pluriel(c.attente, N_("{n} proposition à valider"), N_("{n} propositions à valider")) }, c.attente) : null)
                  )
                )
              )
            )
          : h("p", { class: "aide agent-liste-vide" }, archives ? tr("Aucune conversation archivée.") : tr("Aucune conversation. Commencez par une demande de client : une conversation par client garde tout en ordre.")),
      conversations && conversations.some((c) => c.statut === "archivee") ? h("button", { class: "lien agent-archives", type: "button", onclick: () => ((archives = !archives), dessinerListe()) }, archives ? tr("Conversations ouvertes") : tr("Conversations archivées")) : null,
      blocAmeliorations(),
    ]);
  }

  // Demandes d'amélioration de l'outil (administratrices) : leur statut, suivi sur GitHub par la fonction « rappels ».
  let ameliorations = ameliorationsLues ?? null;
  function blocAmeliorations() {
    if (!ameliorations || !ameliorations.length) return null;
    const liste = listeAmeliorations(ameliorations);
    const enCours = liste.filter((a) => ["envoyee", "pr_prete", "echec"].includes(a.statut)).length;
    return h(
      "details",
      { class: "agent-ameliorations", open: enCours ? true : null },
      h("summary", null, tr("Améliorations demandées"), enCours ? h("span", { class: "agent-pastille" }, enCours) : null),
      h(
        "ul",
        null,
        liste.slice(0, 20).map((a) =>
          h(
            "li",
            { class: `agent-amelioration ${a.statut}` },
            h("strong", null, a.titre),
            h("span", { class: "agent-conv-ligne" }, h("span", null, tr(STATUTS_AMELIORATION[a.statut] || N_("Envoyée, en préparation"))), h("time", { datetime: a.cree_le }, quand(a.cree_le, { langue: langueActive() }))),
            a.pr_url ? h("a", { href: a.pr_url, target: "_blank", rel: "noopener" }, tr("Voir la PR")) : a.issue_url ? h("a", { href: a.issue_url, target: "_blank", rel: "noopener" }, tr("Voir la demande")) : null
          )
        )
      )
    );
  }

  // ---- Fil ------------------------------------------------------------------------------------------------------------------------
  let enCours = false;
  let conv = null; // la conversation ouverte (null : nouvelle)
  let fil = { messages: [], cartes: [] };
  const zoneFil = h("div", { class: "agent-messages" });
  const champ = h("textarea", { id: "agent-message", rows: 1, maxlength: 8000, "aria-label": tr("Message à l'assistant"), placeholder: tr("Écrire à l'assistant") });
  const envoyerBouton = h("button", { class: "principal agent-envoyer", type: "submit", "aria-label": tr("Envoyer") }, icone("fleche", 20));
  // Pièces jointes : trombone à gauche du champ, vignettes au-dessus, dépôt sur toute la colonne, capture collée dans le champ.
  const pieces = piecesSaisie();
  const formulaire = h("form", { class: "agent-saisie", onsubmit: (e) => (e.preventDefault(), envoyer()) }, pieces.liste, pieces.erreur, pieces.entree, pieces.bouton, champ, envoyerBouton);
  pieces.attacher(colonneFil);
  pieces.coller(champ);
  const ajuster = () => {
    champ.style.height = "auto";
    champ.style.height = `${Math.min(champ.scrollHeight, 220)}px`;
  };
  champ.addEventListener("input", ajuster);
  // Ordinateur : Entrée envoie, Maj+Entrée va à la ligne. Téléphone : Entrée va à la ligne, le bouton envoie.
  champ.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(hover: hover) and (pointer: fine)").matches) {
      e.preventDefault();
      envoyer();
    }
  });

  async function ouvrir(id) {
    if (id !== idOuvert) {
      idOuvert = id;
      history.replaceState(null, "", id ? `#/agent/${id}` : "#/agent/nouvelle");
    }
    racine.classList.add("avec-fil");
    conv = id && conversations ? conversations.find((c) => c.id === id) || null : null;
    fil = { messages: [], cartes: [] };
    if (id && !conv) {
      dessinerFil();
      zoneFil.replaceChildren(h("p", { class: "aide" }, erreurTexte("conversation_introuvable")));
      return;
    }
    if (conv) fil = (await etat.store.agentFil(conv.id)) || fil;
    dessinerListe();
    dessinerFil();
    // Message venu d'une autre entreprise (« Passer à … ») : il attend dans la zone de saisie, la personne l'envoie.
    // « Créer le dossier » ou « Mettre à jour le dossier » depuis l'écran WhatsApp (migration 61) : la demande part aussitôt, la fonction lit
    // elle-même l'échange (texte, photos, PDF). Seulement dans l'entreprise de la conversation, une seule fois.
    let depuisWhatsApp = null;
    if (!conv) {
      try {
        const b = sessionStorage.getItem(CLE_BROUILLON);
        if (b) (sessionStorage.removeItem(CLE_BROUILLON), (champ.value = b), ajuster());
        const w = demandeAgent(sessionStorage.getItem(CLE_DEMANDE_AGENT));
        sessionStorage.removeItem(CLE_DEMANDE_AGENT);
        if (w && (!w.entite_id || w.entite_id === etat.entiteId)) depuisWhatsApp = w;
      } catch {
        // stockage refusé
      }
    }
    if (depuisWhatsApp) return void envoyer({ whatsapp: depuisWhatsApp });
    champ.focus({ preventScroll: true });
  }

  function fermer() {
    idOuvert = "";
    racine.classList.remove("avec-fil");
    history.replaceState(null, "", "#/agent");
    dessinerListe();
  }

  function enTete() {
    const dossier = conv && conv.dossier_id ? etat.db.dossiers.find((d) => d.id === conv.dossier_id) : null;
    return h(
      "header",
      { class: "agent-fil-tete" },
      h("button", { class: "bouton-icone agent-retour", type: "button", onclick: fermer, "aria-label": tr("Retour aux conversations") }, icone("retour", 22)),
      h("div", { class: "agent-fil-titre" }, h("h2", null, conv ? conv.titre : tr("Nouvelle conversation")), dossier ? h("a", { class: "agent-dossier", href: `#/dossier/${dossier.id}` }, tr("Dossier {ref}", { ref: dossier.ref })) : null),
      conv ? h("button", { class: "bouton-icone secondaire", type: "button", onclick: menuConversation, "aria-label": tr("Options de la conversation") }, icone("ellipsis", 20)) : null
    );
  }

  function menuConversation() {
    const ferme = modal(
      tr("Conversation"),
      h(
        "div",
        { class: "agent-menu" },
        h("button", { class: "secondaire", type: "button", onclick: () => (ferme(), renommer()) }, tr("Renommer")),
        h("button", { class: "secondaire", type: "button", onclick: () => (ferme(), relier()) }, conv.dossier_id ? tr("Changer le dossier relié") : tr("Relier à un dossier")),
        h("button", { class: "secondaire", type: "button", onclick: () => (ferme(), archiver()) }, conv.statut === "archivee" ? tr("Rouvrir") : tr("Archiver")),
        h("button", { class: "danger", type: "button", onclick: () => (ferme(), supprimer()) }, tr("Supprimer"))
      ),
      { feuille: true, protege: false }
    );
  }
  async function majConv(patch) {
    const c = await etat.store.agentMajConversation(conv.id, patch);
    conversations = conversations.map((x) => (x.id === c.id ? { ...x, ...c } : x));
    conv = conversations.find((x) => x.id === c.id);
    dessinerListe();
    dessinerFil();
  }
  function renommer() {
    const champTitre = h("input", { id: "agent-titre", value: conv.titre, maxlength: 120 });
    const ferme = modal(tr("Renommer"), h("form", { onsubmit: async (e) => (e.preventDefault(), await majConv({ titre: champTitre.value.trim().slice(0, 120) || conv.titre }), ferme()) }, h("label", { for: "agent-titre" }, tr("Titre")), champTitre, h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))), { protege: false });
  }
  function relier() {
    const recherche = h("input", { id: "agent-dossier-q", type: "search", placeholder: tr("Référence ou nom du client"), autocomplete: "off" });
    const liste = h("ul", { class: "agent-choix-dossier" });
    const nomClient = (d) => {
      const c = etat.db.clients.find((x) => x.id === d.client_id);
      return c ? [c.prenom, c.nom].filter(Boolean).join(" ") : "";
    };
    const dessiner = () => {
      const q = recherche.value.trim().toLowerCase();
      const trouves = etat.db.dossiers.filter((d) => !q || `${d.ref} ${nomClient(d)}`.toLowerCase().includes(q)).sort((a, b) => String(b.date_depart || "").localeCompare(String(a.date_depart || ""))).slice(0, 12);
      liste.replaceChildren(...trouves.map((d) => h("li", null, h("button", { class: "secondaire", type: "button", onclick: async () => (ferme(), await majConv({ dossier_id: d.id })) }, `${d.ref} ${nomClient(d)}`))));
    };
    recherche.addEventListener("input", dessiner);
    const ferme = modal(tr("Relier à un dossier"), h("div", null, h("label", { for: "agent-dossier-q" }, tr("Dossier")), recherche, liste, conv.dossier_id ? h("button", { class: "lien", type: "button", onclick: async () => (ferme(), await majConv({ dossier_id: null })) }, tr("Retirer le lien")) : null), { protege: false });
    dessiner();
  }
  const archiver = () => majConv({ statut: conv.statut === "archivee" ? "ouverte" : "archivee" });
  async function supprimer() {
    if (!(await confirmer(tr("Supprimer cette conversation et ses propositions ? Les dossiers déjà créés restent."), tr("Supprimer"), true))) return;
    await etat.store.agentSupprimerConversation(conv.id);
    conversations = conversations.filter((c) => c.id !== conv.id);
    fermer();
  }

  // Suggestions d'une conversation vide : des exemples de l'agence (exemple(), jamais un lieu écrit en dur).
  function suggestions() {
    const s = [
      tr("Course samedi : pickup à {hotel}, rendez-vous à 16:00, une heure d'attente, puis {aeroport}.", { hotel: exemple("hotel"), aeroport: exemple("aeroport") }),
      tr("Le client demande les horaires et les prix de ses trajets entre ses hôtels : je colle son message."),
      tr("Retrouve le dossier de ce client et propose de décaler son pickup."),
    ];
    return h("div", { class: "agent-vide" }, h("p", null, tr("Une conversation par client. Écrivez la demande comme à une collègue, ou collez le message du client.")), h("ul", { class: "agent-suggestions" }, s.map((x) => h("li", null, h("button", { class: "secondaire", type: "button", onclick: () => ((champ.value = x), ajuster(), champ.focus()) }, x)))));
  }

  function dessinerFil() {
    const items = filDepuis(fil.messages, fil.cartes);
    zoneFil.replaceChildren(...[bandeauAutreEntreprise(), ...(items.length ? items.map(element) : [suggestions()])].filter(Boolean));
    majToutValider();
    colonneFil.replaceChildren(enTete(), zoneFil, barreTout, formulaire);
    descendre();
  }
  const descendre = () => requestAnimationFrame(() => {
    zoneFil.scrollTop = zoneFil.scrollHeight;
    if (!matchMedia("(min-width: 900px)").matches) window.scrollTo({ top: document.documentElement.scrollHeight });
  });

  function element(it) {
    if (it.genre === "personne") return h("div", { class: "agent-bulle de-personne" }, paragraphes(it.texte));
    if (it.genre === "agent") return h("div", { class: "agent-bulle de-agent" }, paragraphes(it.texte));
    if (it.genre === "pieces") return bullePieces(it.fichiers);
    if (it.genre === "planning") return frise(it.planning);
    return carte(it.carte);
  }
  const paragraphes = (t) => String(t).split(/\n{2,}/).map((p) => h("p", null, ...p.split("\n").flatMap((l, i) => (i ? [h("br"), l] : [l]))));

  // ---- Envoi ------------------------------------------------------------------------------------------------------------------
  async function envoyer({ whatsapp = null } = {}) {
    const texte = whatsapp ? "" : champ.value.trim();
    const joints = whatsapp ? [] : pieces.noms();
    if ((!texte && !joints.length && !whatsapp) || enCours) return;
    // Bloqué dès maintenant : un second appui pendant la réduction des images n'envoie pas deux fois.
    enCours = true;
    // Les fichiers sont préparés (images réduites) avant l'envoi ; une erreur les garde joints et dit quoi faire.
    let fichiers = [];
    if (joints.length) {
      try {
        envoyerBouton.setAttribute("aria-busy", "true");
        fichiers = await pieces.prets();
      } catch (err) {
        envoyerBouton.removeAttribute("aria-busy");
        pieces.erreur.textContent = erreurFichier(err && err.message) || erreurFichier("fichier_illisible");
        enCours = false;
        return;
      }
    }
    envoyerBouton.disabled = true;
    envoyerBouton.setAttribute("aria-busy", "true");
    champ.value = "";
    ajuster();
    if (!zoneFil.querySelector(".agent-bulle, .agent-frise, .agent-carte")) zoneFil.replaceChildren();
    if (joints.length) zoneFil.append(bullePieces(joints));
    if (texte) zoneFil.append(h("div", { class: "agent-bulle de-personne" }, paragraphes(texte)));
    if (whatsapp) zoneFil.append(h("div", { class: "agent-bulle de-personne" }, h("p", null, whatsapp.whatsapp_mode === "maj" ? tr("Mettre à jour le dossier d'après la conversation WhatsApp.") : tr("Créer le dossier d'après la conversation WhatsApp."))));
    // Les fichiers choisis restent en mémoire : si l'envoi échoue, ils reviennent dans la zone de saisie.
    const choisis = pieces.fichiers();
    pieces.vider();
    const etape = h("p", { class: "agent-etape", role: "status" }, h("span", { class: "agent-point", "aria-hidden": "true" }), tr("L'assistant réfléchit"));
    let bulle = null;
    let texteRecu = "";
    zoneFil.append(etape);
    descendre();
    const corps = whatsapp ? { entite_id: etat.entiteId, whatsapp_conversation_id: whatsapp.whatsapp_conversation_id, whatsapp_mode: whatsapp.whatsapp_mode, whatsapp_pieces: whatsapp.whatsapp_pieces || [], texte: "" } : { entite_id: etat.entiteId, conversation_id: conv ? conv.id : null, texte, ...(fichiers.length ? { fichiers } : {}) };
    const r = await etat.store.agentEnvoyer(corps, (ev) => {
      if (ev.t === "conversation" && !conv) {
        conv = { id: ev.id, entite_id: etat.entiteId, titre: ev.titre, apercu: "", dossier_id: ev.dossier_id || null, statut: "ouverte", maj_le: new Date().toISOString(), whatsapp_conversation_id: ev.whatsapp_conversation_id || null };
        conversations = [conv, ...(conversations || [])];
        idOuvert = ev.id;
        history.replaceState(null, "", `#/agent/${ev.id}`);
        colonneFil.querySelector(".agent-fil-tete").replaceWith(enTete());
      } else if (ev.t === "etape") {
        etape.lastChild.textContent = `${tr(ETAPES[ev.outil] || N_("L'assistant réfléchit"))}…`;
        bulle = null;
        texteRecu = "";
      } else if (ev.t === "texte") {
        if (!bulle) {
          bulle = h("div", { class: "agent-bulle de-agent" });
          etape.before(bulle);
        }
        texteRecu += ev.delta;
        bulle.replaceChildren(...paragraphes(texteRecu));
      } else if (ev.t === "planning") {
        etape.before(frise(ev.planning));
        bulle = null;
        texteRecu = "";
      } else if (ev.t === "carte") {
        fil.cartes.push(ev.carte);
        etape.before(carte(ev.carte));
        bulle = null;
        texteRecu = "";
      } else if (ev.t === "erreur") {
        if (ev.erreur === "credit_epuise") etape.before(h("div", { class: "agent-bulle de-agent agent-arret", role: "alert" }, h("p", null, erreurTexte(ev.erreur))));
        else etape.before(h("p", { class: "agent-erreur", role: "alert" }, erreurTexte(ev.erreur), ev.detail ? h("small", { class: "agent-erreur-detail" }, ev.detail) : null));
      }
      descendre();
    });
    etape.remove();
    if (r && r.erreur) {
      // Plafond ou crédit : l'assistant le dit dans le fil, comme une réponse, pour que ce soit clair et non une panne obscure.
      if (r.erreur === "plafond_du_mois" || r.erreur === "credit_epuise") zoneFil.append(h("div", { class: "agent-bulle de-agent agent-arret", role: "alert" }, h("p", null, erreurTexte(r.erreur, r))));
      else zoneFil.append(h("p", { class: "agent-erreur", role: "alert" }, erreurTexte(r.erreur)));
      if (!conv) champ.value = texte;
      if (choisis.length) pieces.ajouter(choisis);
    }
    enCours = false;
    // La dépense vient de bouger : le bandeau du crédit (administratrices) se relit.
    rafraichirBandeauCredit();
    envoyerBouton.disabled = false;
    envoyerBouton.removeAttribute("aria-busy");
    if (conv) {
      // Relecture depuis la base : le fil affiché est exactement celui qui repartira chez l'assistant.
      fil = (await etat.store.agentFil(conv.id)) || fil;
      conversations = (await etat.store.agentConversations(etat.entiteId)) || conversations;
      conv = conversations.find((c) => c.id === conv.id) || conv;
      await rafraichirAttente();
      dessinerListe();
      dessinerFil();
    }
  }

  // ---- Frise d'une course -------------------------------------------------------------------------------------------------------
  function frise(plan) {
    const points = lignesFrise(plan);
    const ORIGINE_DUREE = { table: N_("table des temps"), ors: N_("OpenStreetMap"), table_a_verifier: N_("table, ligne à vérifier"), personne: N_("durée donnée par vous"), estimation_web: N_("estimation trouvée sur le web"), simulation: N_("simulée") };
    const sousTrajet = (t) =>
      [
        tr("{d} de route ({source})", { d: texteDuree(t.route_min), source: tr(ORIGINE_DUREE[t.source] || N_("source inconnue")) }),
        t.ferry ? tr("ferry, {m} min d'attente comptées", { m: t.ferry_attente_min }) : "",
        tr("{m} min de marge", { m: t.marge_min }),
      ]
        .filter(Boolean)
        .join(", ");
    const v = plan.vol;
    const verdict = v
      ? h(
          "p",
          { class: `agent-vol ${v.verdict}` },
          icone(v.verdict === "tenable" ? "coche" : "alerte", 18),
          v.verdict === "tenable"
            ? tr("Vol de {h} tenable : arrivée limite {l}, {m} min de marge.", { h: v.heure, l: v.arrivee_limite.heure, m: v.marge_restante_min })
            : v.verdict === "juste"
              ? tr("Vol de {h} juste : arrivée limite {l}, toutes les marges y passent.", { h: v.heure, l: v.arrivee_limite.heure })
              : tr("Vol de {h} pas tenable : arrivée limite {l}.", { h: v.heure, l: v.arrivee_limite.heure })
        )
      : null;
    const date = new Date(`${plan.date}T12:00:00Z`).toLocaleDateString(langueActive() === "en" ? "en-GB" : "fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    return h(
      "figure",
      { class: "agent-frise" },
      h("figcaption", null, tr("Course du {date}", { date }), plan.alertes.includes("temps_simules") ? h("span", { class: "agent-simule" }, tr("Temps simulés")) : plan.alertes.includes("estimation_web") ? h("span", { class: "agent-simule" }, tr("Estimation web")) : plan.alertes.includes("temps_a_verifier") ? h("span", { class: "agent-simule" }, tr("Durée à vérifier")) : null),
      h(
        "ol",
        null,
        points.map((p, i) =>
          h(
            "li",
            { class: ["agent-point-course", i === 0 ? "depart" : "", p.rendezVous ? "rdv" : ""].filter(Boolean).join(" ") },
            h("span", { class: "agent-heure" }, p.heure),
            h(
              "div",
              { class: "agent-lieu" },
              h("strong", null, p.lieu),
              i === 0 ? h("span", null, tr("Pickup")) : null,
              p.rendezVous ? h("span", null, p.fourchette ? tr("Rendez-vous, arrivée prévue vers {h}", { h: p.fourchette[0] }) : tr("Rendez-vous")) : p.fourchette ? h("span", null, tr("Arrivée entre {a} et {b}", { a: p.fourchette[0], b: p.fourchette[1] })) : null,
              p.attente ? h("span", null, tr("{m} min sur place, départ à {h}", { m: p.attente, h: p.depart })) : null,
              p.trajet ? h("span", { class: "agent-trajet" }, p.trajet.morceaux ? detailMorceaux(p.trajet.morceaux, texteDuree) : sousTrajet(p.trajet)) : null,
              p.trajet && p.trajet.morceaux ? h("span", { class: "agent-trajet" }, tr("{m} min de marge", { m: p.trajet.marge_min })) : null,
              p.trajet && p.trajet.de_trouve ? h("span", { class: "agent-trajet" }, tr("OpenStreetMap a compris : {a} → {b}", { a: p.trajet.de_trouve, b: p.trajet.vers_trouve })) : null,
              p.trajet && p.trajet.source_url ? h("a", { class: "agent-trajet", href: p.trajet.source_url, target: "_blank", rel: "noopener noreferrer" }, tr("Source de l'estimation")) : null
            )
          )
        )
      ),
      verdict,
      // Mention exigée par OpenStreetMap et OSRM quand un itinéraire vient d'eux.
      plan.trajets.some((t) => t.source === "ors" || (t.morceaux || []).some((m) => m.source === "ors")) ? h("p", { class: "agent-mention" }, ((m) => (plan.trajets.some((t) => t.moteur === m || (t.morceaux || []).some((x) => x.moteur === m))))("google") ? tr("Itinéraire Google Maps") : plan.trajets.some((t) => t.moteur === "osrm" || (t.morceaux || []).some((m) => m.moteur === "osrm")) ? tr("Itinéraire OSRM, données © contributeurs OpenStreetMap") : tr("Itinéraire openrouteservice, données © contributeurs OpenStreetMap")) : null,
      h("details", { class: "agent-hypotheses" }, h("summary", null, tr("Hypothèses du calcul")), h("ul", null, plan.hypotheses.map((x) => h("li", null, x))))
    );
  }

  // ---- Cartes ---------------------------------------------------------------------------------------------------------------------
  const devise = () => reglages().devise || "THB";
  const jourCourt = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(langueActive() === "en" ? "en-GB" : "fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "");
  const prixTexte = (s) => (s.prix === null || s.prix === undefined ? h("span", { class: "agent-prix vide" }, tr("Prix à fixer")) : h("span", { class: "agent-prix" }, `${Number(s.prix).toLocaleString("en-US")} ${devise()}`, h("small", null, s.origine_prix === "saisi" ? tr("donné par vous") : tr("catalogue"))));

  // Ce qu'une validation a créé pendant cette visite (dossier, course) : la carte validée montre ensuite le voucher et le message.
  const resultats = new Map();
  // Le motif d'une carte qui n'a pas pu être enregistrée d'un geste, avec l'entreprise où la passer s'il y a lieu.
  const motifs = new Map();
  const estCourse = (c) => c.genre === "dossier" && !!(c.donnees && c.donnees.course);
  // « Tout valider » : les cartes qui s'enregistrent par le code habituel. Une réponse se copie à la main (le presse-papiers n'en garde
  // qu'une) ; un réglage, une demande d'amélioration et une brochure se relisent une à une.
  const VALIDABLES = ["dossier", "reservation", "modification", "temps"];
  const enAttente = () => fil.cartes.filter((c) => c.statut === "proposee" && VALIDABLES.includes(c.genre));

  function carte(c) {
    const d = c.donnees || {};
    const corps = [];
    let action = null;
    if (estCourse(c)) {
      // Course de taxi : ce que la lecture habituelle des confirmations a compris, avant de créer le dossier et la Booking confirmation.
      const lu = lireConfirmation(d.course.texte || "", { aujourdhui: aujourdhui() }).valeurs || {};
      corps.push(h("p", { class: "agent-carte-client" }, [lu.nom, lu.telephone].filter(Boolean).join(", ")), h("ul", { class: "agent-services" }, h("li", null, h("span", null, h("strong", null, [lu.pickup, lu.dropoff].filter(Boolean).join(" → ") || lu.programme || tr("Course")), h("small", null, [jourCourt(lu.date), lu.heure && tr("pickup {h}", { h: lu.heure }), lu.adultes ? pluriel(Number(lu.adultes) || 0, N_("{n} adulte"), N_("{n} adultes")) : ""].filter(Boolean).join(", "))), lu.prix ? h("span", { class: "agent-prix" }, `${lu.prix} ${devise()}`) : h("span", { class: "agent-prix vide" }, tr("Prix à fixer")))));
      action = { libelle: tr("Créer le dossier et la Booking confirmation"), faire: () => valider(c), puis: { libelle: tr("Vérifier avant"), faire: () => ouvrirCourse(c) } };
    } else if (c.genre === "dossier") {
      corps.push(h("p", { class: "agent-carte-client" }, [d.client && d.client.nom, d.client && d.client.hotel, pluriel(d.adultes || 0, N_("{n} adulte"), N_("{n} adultes")), d.enfants ? pluriel(d.enfants, N_("{n} enfant"), N_("{n} enfants")) : ""].filter(Boolean).join(", ")));
      corps.push(h("ul", { class: "agent-services" }, (d.services || []).map((s) => h("li", null, h("span", null, h("strong", null, s.libelle || s.texte), h("small", null, [jourCourt(s.date), s.heure_pickup && tr("pickup {h}", { h: s.heure_pickup }), s.remarque].filter(Boolean).join(", "))), prixTexte(s)))));
      action = { libelle: tr("Créer le dossier"), faire: () => valider(c), puis: { libelle: tr("Vérifier avant"), faire: () => ouvrirDossier(c) } };
    } else if (c.genre === "reservation") {
      const s = d.service || {};
      corps.push(h("p", null, tr("Dossier {ref}", { ref: d.dossier_ref || "" })), h("ul", { class: "agent-services" }, h("li", null, h("span", null, h("strong", null, s.libelle || s.texte), h("small", null, [jourCourt(s.date), s.heure_pickup && tr("pickup {h}", { h: s.heure_pickup })].filter(Boolean).join(", "))), prixTexte(s))));
      action = { libelle: tr("Ajouter au dossier"), faire: () => valider(c), puis: { libelle: tr("Vérifier avant"), faire: () => ouvrirReservation(c) } };
    } else if (c.genre === "modification") {
      corps.push(h("p", null, h("strong", null, d.libelle)), h("p", { class: "agent-modif" }, h("del", null, d.avant || tr("vide")), " ", icone("fleche", 16), " ", h("ins", null, d.valeur)), d.raison ? h("p", { class: "aide" }, d.raison) : null);
      action = { libelle: tr("Appliquer"), faire: () => valider(c), puis: { libelle: tr("Vérifier avant"), faire: () => ouvrirModification(c) } };
    } else if (c.genre === "temps") {
      corps.push(h("p", { class: "agent-modif" }, h("strong", null, d.de), " ", icone("inverser", 16), " ", h("strong", null, d.vers), " ", h("span", null, texteDuree(d.duree_min))), h("p", { class: "aide" }, [d.ferry ? tr("ferry") : "", d.marge_min ? tr("marge {m} min", { m: d.marge_min }) : "", d.source].filter(Boolean).join(", ")));
      action = { libelle: tr("Ajouter à la table"), faire: () => valider(c) };
    } else if (c.genre === "reglage") {
      const long = String(d.valeur || "").length > 60 || String(d.avant || "").length > 60;
      corps.push(h("p", null, h("strong", null, d.nom)));
      if (long) corps.push(d.avant ? h("details", { class: "agent-avant" }, h("summary", null, tr("Texte actuel")), h("p", { class: "agent-texte-long" }, d.avant)) : null, h("p", { class: "agent-texte-long" }, d.valeur));
      else corps.push(h("p", { class: "agent-modif" }, h("del", null, d.avant || (d.sujet === "voix" && d.champ !== "lieu" ? tr("voix par défaut") : tr("vide"))), " ", icone("fleche", 16), " ", h("ins", null, d.valeur)));
      if (d.raison) corps.push(h("p", { class: "aide" }, d.raison));
      const permis = d.sujet === "catalogue" ? peut("catalogue.ecrire") : peut("reglages.ecrire");
      action = permis ? { libelle: tr("Appliquer"), faire: () => appliquerReglage(c) } : null;
      if (!permis) corps.push(h("p", { class: "aide" }, tr("Seule une administratrice peut appliquer ce changement.")));
    } else if (c.genre === "amelioration" && c.statut !== "proposee") {
      // Envoyée ou écartée : le texte tel qu'il est parti (relu et corrigé par la personne), en lecture seule.
      const envoyee = (ameliorations || []).find((a) => a.carte_id === c.id);
      const titreEnvoye = envoyee ? envoyee.titre : d.titre || c.titre;
      corps.push(titreEnvoye !== c.titre ? h("p", null, h("strong", null, titreEnvoye)) : null, h("p", { class: "agent-texte-long" }, envoyee && envoyee.texte ? envoyee.texte : d.texte || ""));
      if (envoyee && (envoyee.pr_url || envoyee.issue_url)) corps.push(h("p", null, h("a", { href: envoyee.pr_url || envoyee.issue_url, target: "_blank", rel: "noopener" }, envoyee.pr_url ? tr("Voir la PR") : tr("Voir la demande"))));
    } else if (c.genre === "amelioration") {
      const titre = h("input", { type: "text", class: "agent-amelioration-titre", maxlength: 80, "aria-label": tr("Titre de la demande") });
      titre.value = d.titre || c.titre || "";
      const zone = h("textarea", { class: "agent-reponse", rows: 9, maxlength: 3000, "aria-label": tr("Texte de la demande") });
      zone.value = d.texte || "";
      corps.push(titre, zone, h("p", { class: "aide" }, tr("Ce texte sera public sur GitHub, sur le dépôt du site : rien d'un client, d'un prestataire ni aucun montant. Jérémy relit l'amélioration préparée et décide de la mettre en ligne.")));
      if ((c.avertissements || []).some((a) => String(a).startsWith("mot_interne"))) corps.push(h("p", { class: "aide" }, tr("Le texte parle d'argent interne (net, commission) : vérifiez qu'aucun chiffre n'y figure.")));
      action = estAdmin() ? { libelle: tr("Demander cette amélioration"), faire: (bouton) => demanderAmelioration(c, titre.value, zone.value, bouton) } : null;
      if (!estAdmin()) corps.push(h("p", { class: "aide" }, tr("Seule une administratrice peut demander une amélioration.")));
    } else if (c.genre === "reponse") {
      const zone = h("textarea", { class: "agent-reponse", rows: 8, "aria-label": tr("Réponse au client"), lang: d.langue === "en" ? "en" : "fr" });
      zone.value = d.message || "";
      // Un montant interne ou un nom de partenaire signalé bloque la copie tant qu'il reste dans le texte (agent-calc.mjs, resteBloque).
      const bloquants = bloquantsReponse(c.avertissements);
      const alerte = h("p", { class: "erreur-form", role: "alert", hidden: true });
      corps.push(zone, alerte);
      action = {
        libelle: tr("Copier la réponse"),
        faire: () => (resteBloque(zone.value, bloquants).length ? null : copier(c, zone.value)),
        lier: (bouton) => {
          const maj = () => {
            const reste = resteBloque(zone.value, bloquants);
            bouton.disabled = reste.length > 0;
            alerte.hidden = !reste.length;
            alerte.textContent = reste.length ? tr("À retirer avant de copier : {liste}. Ces chiffres et ces noms ne vont jamais au client.", { liste: reste.join(", ") }) : "";
          };
          zone.addEventListener("input", maj);
          maj();
        },
      };
    } else if (c.genre === "brochure") {
      const b = carteBrochure(c, { valider: () => decider(c, "validee") });
      corps.push(...b.corps);
      action = b.action;
    }
    const avert = (c.avertissements || []).length && c.genre !== "amelioration" ? h("ul", { class: "assistant-avertissements" }, c.avertissements.map((a) => h("li", null, texteAvertissement(a)))) : null;
    const libelles = { dossier: estCourse(c) ? N_("Course") : N_("Nouveau dossier"), reservation: N_("Service à ajouter"), modification: N_("Modification"), reponse: N_("Réponse au client"), temps: N_("Temps de trajet"), reglage: N_("Réglage"), amelioration: N_("Amélioration de l'outil"), brochure: N_("Brochure à importer") };
    // Une demande envoyée montre son suivi (envoyée, PR prête, en ligne, refusée).
    const suivi = c.genre === "amelioration" && c.statut === "validee" ? (ameliorations || []).find((a) => a.carte_id === c.id) : null;
    const decidee = c.statut !== "proposee";
    const motif = motifs.get(c.id);
    return h(
      "article",
      { class: `agent-carte ${c.statut}`, "data-carte": c.id },
      h("header", null, h("span", { class: "agent-carte-genre" }, tr(libelles[c.genre] || N_("Proposition"))), c.titre && c.titre !== tr(libelles[c.genre] || "") ? h("h3", null, c.titre) : null),
      ...corps,
      avert,
      decidee
        ? h("div", { class: "agent-carte-fin" }, h("p", { class: "agent-carte-sort" }, icone(c.statut === "validee" ? "coche" : "fermer", 16), suivi ? tr(STATUTS_AMELIORATION[suivi.statut] || N_("Envoyée, en préparation")) : c.statut === "validee" ? (c.genre === "amelioration" ? tr("Envoyée") : c.genre === "reglage" ? tr("Appliqué") : tr("Validée")) : tr("Écartée")), c.statut === "validee" ? suite(c) : null)
        : h(
            "div",
            { class: "actions gauche" },
            motif ? h("p", { class: "erreur-form pleine-largeur", role: "alert" }, motif.motif) : null,
            motif && motif.entreprise ? h("button", { class: "principal", type: "button", onclick: () => passerA(motif.entreprise, d.course ? d.course.texte : "") }, tr("Passer à {nom}", { nom: motif.entreprise.nom })) : null,
            action ? lierBouton(h("button", { class: motif && motif.entreprise ? "secondaire" : "principal", type: "button", onclick: (e) => action.faire(e.currentTarget) }, action.libelle), action) : null,
            action && action.puis ? h("button", { class: "secondaire", type: "button", onclick: () => action.puis.faire() }, action.puis.libelle) : null,
            h("button", { class: "secondaire", type: "button", onclick: () => decider(c, "ecartee") }, tr("Écarter"))
          )
    );
  }

  function lierBouton(bouton, action) {
    if (action.lier) action.lier(bouton);
    return bouton;
  }

  // Après une validation : le dossier, son voucher (ou la Booking confirmation chez Taxi) et le message WhatsApp, d'un geste.
  function suite(c) {
    const r = resultats.get(c.id);
    if (!r || !r.dossier) return null;
    const dossier = r.dossier;
    if (r.course) return h("div", { class: "agent-suite" }, blocBooking(r.course), h("div", { class: "actions gauche" }, h("button", { class: "secondaire", type: "button", onclick: () => naviguer(`#/dossier/${dossier.id}`) }, tr("Ouvrir le dossier {ref}", { ref: dossier.ref || "" }))));
    return h(
      "div",
      { class: "actions gauche agent-suite" },
      h("button", { class: "principal", type: "button", onclick: () => voucher(dossier.id) }, icone("whatsapp", 18), modeTaxi() ? tr("Booking confirmation et WhatsApp") : tr("Voucher et WhatsApp")),
      h("button", { class: "secondaire", type: "button", onclick: () => naviguer(`#/dossier/${dossier.id}`) }, tr("Ouvrir le dossier {ref}", { ref: dossier.ref || "" }))
    );
  }
  let blocBooking = () => null;
  async function voucher(dossierId) {
    const [{ courseDuDossier }, { envoyerVoucher }] = await Promise.all([import("./creation-course.mjs"), import("./voucher-envoi.mjs")]);
    const x = courseDuDossier(dossierId);
    if (!x.reservation) return toast(tr("Ce dossier n'a pas encore de service à mettre sur un voucher."), true);
    envoyerVoucher(x);
  }

  function redessiner(c) {
    const ancien = zoneFil.querySelector(`[data-carte="${c.id}"]`);
    if (ancien) ancien.replaceWith(carte(c));
    majToutValider();
  }
  async function decider(c, statut) {
    const maj = await etat.store.agentCarte(c.id, statut);
    fil.cartes = fil.cartes.map((x) => (x.id === maj.id ? maj : x));
    await rafraichirAttente();
    dessinerListe();
    redessiner(maj);
    return maj;
  }

  // Après chaque carte enregistrée (migration 54) : la conversation se relie au dossier qu'elle a créé ou touché (si elle n'en a pas déjà
  // un), et ce que la personne a changé par rapport à la proposition est gardé pour l'entreprise. `enregistre` : ce qui a vraiment été
  // enregistré ({ reservations } pour un dossier, { reservation } pour un service, { message } pour une réponse) ; pour un dossier sans
  // `enregistre`, ses réservations sont relues. Une panne ici ne gêne jamais la validation.
  async function apresValidation(c, { dossierId = null, enregistre = null } = {}) {
    try {
      const id = dossierDeLaCarte(c, { dossierId });
      if (id && conv && !conv.dossier_id) {
        const maj = await etat.store.agentMajConversation(conv.id, { dossier_id: id });
        conversations = (conversations || []).map((x) => (x.id === maj.id ? { ...x, ...maj } : x));
        conv = conversations.find((x) => x.id === maj.id) || { ...conv, ...maj };
        const tete = colonneFil.querySelector(".agent-fil-tete");
        if (tete) tete.replaceWith(enTete());
      }
      // Les noms du client à masquer : ceux du dossier de la carte, ou du dossier déjà relié à la conversation (réponse au client).
      const idNoms = id || (conv && conv.dossier_id);
      const dossier = idNoms ? etat.db.dossiers.find((d) => d.id === idNoms) : null;
      const client = dossier ? etat.db.clients.find((x) => x.id === dossier.client_id) : null;
      const vu = enregistre || (c.genre === "dossier" && id ? { reservations: etat.db.reservations.filter((r) => r.dossier_id === id) } : null);
      // Aussi les noms donnés dans les cartes « dossier » de la conversation : une réponse copiée avant que la conversation ait un dossier
      // ne garde pas le nom du client.
      const noms = [client && client.prenom, client && client.nom, ...fil.cartes.filter((x) => x.genre === "dossier").map((x) => ((x.donnees || {}).client || {}).nom)].filter(Boolean);
      const lignes = correctionsDepuisCarte(c, vu, { noms });
      if (lignes.length && (await etat.store.agentNoterApprentissages(etat.entiteId, c.id, lignes))) toast(lignes.length === 1 ? tr("Correction notée : l'assistant s'en servira la prochaine fois.") : tr("{n} corrections notées : l'assistant s'en servira la prochaine fois.", { n: lignes.length }));
    } catch (err) {
      console.error("agent : après la validation", err);
    }
  }

  // Conversation ouverte depuis l'écran WhatsApp (migration 61) : le dossier validé se relie à la conversation WhatsApp, avec son client
  // (et l'entreprise si elle était à trier). Une panne ici ne gêne jamais la validation ; elle est dite.
  async function relierWhatsApp(dossier) {
    const waId = conv && conv.whatsapp_conversation_id;
    if (!waId) return;
    try {
      // Relue en base juste avant : quelqu'un a pu la relier ou la ranger ailleurs pendant la conversation avec l'Assistant.
      const wc = etat.store.whatsappConversation ? await etat.store.whatsappConversation(waId) : null;
      const { action, patch } = liaisonApresDossier(wc, dossier, etat.entiteId);
      if (action === "rien") return;
      if (action === "demander" && !(await confirmer(tr("Remplacer le dossier relié ? La conversation WhatsApp est déjà reliée à un autre client ou un autre dossier. Elle sera reliée au dossier {ref}.", { ref: dossier.ref || "" }), tr("Remplacer"), true))) return;
      await modifier("whatsapp_conversations", waId, patch);
      toast(tr("Conversation WhatsApp reliée au dossier {ref}.", { ref: dossier.ref || "" }));
    } catch (err) {
      toast(tr("Dossier créé, mais la conversation WhatsApp n'a pas pu être reliée : {message}", { message: err.message }), true);
    }
  }

  // ---- Valider d'un geste ---------------------------------------------------------------------------------------------------------
  // Chaque genre passe par le code habituel de l'outil, sans le montrer ; un motif d'arrêt reste sur la carte. Rend true si c'est enregistré.
  async function valider(c, { seule = true } = {}) {
    motifs.delete(c.id);
    let r = { ok: false, motif: "" };
    try {
      if (estCourse(c)) r = !confirmationPermise() ? { ok: false, motif: tr("Une course depuis une confirmation se crée par une administratrice.") } : !ressembleAConfirmation(c.donnees.course.texte || "", { aujourdhui: aujourdhui() }) ? { ok: false, motif: tr("Ce texte n'est pas une confirmation de course : c'est une demande de client.") } : await (await import("./confirmation.mjs")).ouvrirConfirmation(c.donnees.course.texte || "", { auto: true });
      else if (c.genre === "dossier") r = await (await import("./demande.mjs")).ouvrirDemande(null, preparation(c), { auto: true, titre: c.titre, surCree: () => {} });
      else if (c.genre === "reservation") r = await enregistrerReservation(c, reservationDepuisCarte(c.donnees), tr("Service ajouté au dossier."));
      else if (c.genre === "modification") {
        const ancienne = etat.db.reservations.find((x) => x.id === c.donnees.reservation_id);
        r = ancienne ? await enregistrerReservation(c, reservationModifiee(ancienne, c.donnees), tr("Service modifié."), ancienne) : { ok: false, motif: tr("Ce service n'existe plus.") };
      } else if (c.genre === "temps") r = await ajouterTemps(c);
    } catch (err) {
      r = { ok: false, motif: err.message };
    }
    if (!r || !r.ok) {
      motifs.set(c.id, { motif: (r && r.motif) || tr("Rien n'a été enregistré."), entreprise: (r && r.entreprise) || null });
      redessiner(c);
      if (seule) toast((r && r.motif) || tr("Rien n'a été enregistré."), true);
      return false;
    }
    await noterReussite(c, r);
    return true;
  }
  // Une carte enregistrée : la conversation se relie au dossier et les corrections sont gardées (apresValidation), puis la carte est validée.
  async function noterReussite(c, r) {
    const dossier = r.dossier || (r.fait && r.fait.dossier) || null;
    if (dossier) resultats.set(c.id, { dossier, course: r.fait || null });
    if (dossier && c.genre === "dossier") await relierWhatsApp(dossier);
    if (r.fait) blocBooking = (await import("./confirmation.mjs")).blocBookingConfirmation;
    const res = r.reservation || null;
    await apresValidation(c, { dossierId: (dossier && dossier.id) || (res && res.dossier_id) || null, enregistre: res ? { reservation: res } : null });
    await decider(c, "validee");
  }

  // « Tout valider » : les cartes en attente, dans l'ordre du fil. Celles qui passent sont validées, une carte qui échoue garde son motif.
  const barreTout = h("div", { class: "agent-tout-valider", hidden: true });
  function majToutValider() {
    const n = enAttente().length;
    barreTout.hidden = n < 2;
    barreTout.replaceChildren(h("button", { class: "principal", type: "button", onclick: (e) => toutValider(e.currentTarget) }, icone("coche", 18), tr("Tout valider ({n})", { n })));
  }
  async function toutValider(btn) {
    btn.disabled = true;
    let faites = 0;
    let echecs = 0;
    for (const c of enAttente()) (await valider(c, { seule: false })) ? faites++ : echecs++;
    majToutValider();
    toast(echecs ? tr("{ok} validées, {ko} à reprendre : le motif est sur la carte.", { ok: faites, ko: echecs }) : tr("{ok} validées.", { ok: faites }), !!echecs);
  }

  // ---- Vérifier avant : la fenêtre habituelle, affichée ------------------------------------------------------------------------
  const preparation = (c) => {
    const contexte = { prestations: etat.db.prestations, trajets: etat.db.trajets, partenaires: etat.db.partenaires, nomPartenaire, taxi: modeTaxi() };
    return { texte: "", ...propositionVersDemande(propositionDepuisCarte(c.donnees), contexte) };
  };
  async function ouvrirDossier(c) {
    (await import("./demande.mjs")).ouvrirDemande(null, preparation(c), { titre: c.titre, surCree: ({ dossier }) => noterReussite(c, { ok: true, dossier }) });
  }
  async function ouvrirCourse(c) {
    // Même règle que la validation d'un geste (et que l'ancien écran) : une course depuis une confirmation se crée par une administratrice.
    if (!confirmationPermise()) return toast(tr("Une course depuis une confirmation se crée par une administratrice."), true);
    (await import("./confirmation.mjs")).ouvrirConfirmation(c.donnees.course.texte || "", { surCree: (fait) => noterReussite(c, { ok: true, fait }) });
  }
  async function ouvrirReservation(c) {
    const { formulaireReservation } = await import("./reservations.mjs");
    // « Annuler » rend null : la carte reste à valider.
    const ferme = modal(tr("Nouvelle réservation"), formulaireReservation(reservationDepuisCarte(c.donnees), async (res) => {
      ferme();
      if (!res) return;
      toast(tr("Service ajouté au dossier."));
      await noterReussite(c, { ok: true, reservation: res });
    }));
  }
  async function ouvrirModification(c) {
    const r = etat.db.reservations.find((x) => x.id === c.donnees.reservation_id);
    if (!r) return toast(tr("Ce service n'existe plus."), true);
    const { formulaireReservation } = await import("./reservations.mjs");
    const ferme = modal(tr("Modifier la réservation"), formulaireReservation(reservationModifiee(r, c.donnees), async (res) => {
      ferme();
      if (!res) return;
      toast(tr("Service modifié."));
      await noterReussite(c, { ok: true, reservation: { ...res, dossier_id: res.dossier_id || r.dossier_id } });
    }));
  }

  // Le formulaire de réservation habituel, rempli et envoyé sans être montré : ses contrôles, la facture qui suit, les questions qu'il pose
  // (annulation d'un service facturé…) restent les siens. Un champ refusé, ou rien d'enregistré, devient le motif de la carte.
  async function enregistrerReservation(c, valeurs, message, ancienne = null) {
    const { formulaireReservation } = await import("./reservations.mjs");
    return new Promise((fin) => {
      let fini = false;
      let minuterie = null;
      let ferme = () => {};
      const terminer = (r) => {
        if (fini) return;
        fini = true;
        clearTimeout(minuterie);
        ferme();
        fin(r);
      };
      const form = formulaireReservation(valeurs, (res) => terminer(res ? (toast(message), { ok: true, reservation: { ...res, dossier_id: res.dossier_id || (ancienne && ancienne.dossier_id) || valeurs.dossier_id } }) : { ok: false, motif: tr("Rien n'a été enregistré.") }));
      ferme = modal(tr("Réservation"), form, { cache: true });
      minuterie = setTimeout(() => terminer({ ok: false, motif: tr("Rien n'a été enregistré : ouvrez « Vérifier avant ».") }), 60_000);
      form.requestSubmit();
      // Les contrôles du formulaire passent avant tout enregistrement : un champ en erreur arrête tout de suite.
      queueMicrotask(() => {
        const refus = form.querySelector('[aria-invalid="true"]');
        if (refus) terminer({ ok: false, motif: tr("À corriger : {champ}.", { champ: ((form.querySelector(`label[for="${refus.id}"]`) || {}).textContent || "").trim() || tr("un champ") }) });
      });
    });
  }

  // Une durée donnée dans la conversation entre dans la table de référence, confirmée (Nani l'a donnée elle-même).
  async function ajouterTemps(c) {
    const d = c.donnees;
    try {
      await etat.store.enregistrerTempsTrajets(etat.entiteId, [{ de: d.de, vers: d.vers, cle: clePaire(d.de, d.vers), mode: "route", duree_min: d.duree_min, ferry: !!d.ferry, marge_min: d.marge_min || 0, source: d.source || "", source_date: new Date().toISOString().slice(0, 10), a_verifier: false, origine: "agent" }]);
      toast(tr("Durée ajoutée à la table des temps de trajet."));
      return { ok: true };
    } catch (err) {
      return { ok: false, motif: err.message };
    }
  }
  // Carte « reglage » : appliquée par les écritures habituelles de l'outil (réglages de l'entreprise, fiche du tarif), sous les droits RLS.
  async function appliquerReglage(c) {
    const d = c.donnees || {};
    try {
      if (d.sujet === "catalogue") {
        const p = (etat.db.prestations || []).find((x) => x.id === d.cible_id);
        const r = prestationModifiee(p, d);
        if (!r.ok) return toast(r.erreur === "change" ? tr("Ce tarif a changé depuis la proposition : demandez à l'assistant de la refaire.") : tr("Ce changement ne peut pas s'appliquer."), true);
        await modifier("prestations", p.id, r.patch);
      } else {
        const r = reglageApplique(reglages(), d);
        if (!r.ok) return toast(r.erreur === "change" ? tr("Ce réglage a changé depuis la proposition : demandez à l'assistant de la refaire.") : tr("Ce changement ne peut pas s'appliquer."), true);
        await enregistrerReglages(r.valeur);
      }
      toast(tr("Changement appliqué."));
      await decider(c, "validee");
    } catch (err) {
      toast(err.message, true);
    }
  }
  // Carte « amelioration » : envoyée telle que relue dans la carte (titre et texte), par la fonction « ameliorations ».
  async function demanderAmelioration(c, titre, texte, bouton) {
    if (bouton) bouton.disabled = true;
    const r = await etat.store.demanderAmelioration({ entite_id: etat.entiteId, carte_id: c.id, titre, texte });
    if (bouton) bouton.disabled = false;
    if (!r || r.erreur) {
      const motifs = r && r.motifs ? r.motifs.map((m) => tr(MOTIFS_TEXTE[m] || N_("un texte refusé"))).join(", ") : "";
      return toast(`${tr(ERREURS_AMELIORATION[r && r.erreur] || N_("La demande n'est pas partie."))}${motifs ? ` (${motifs})` : ""}`, true);
    }
    ameliorations = [r.amelioration, ...(ameliorations || []).filter((a) => a.id !== r.amelioration.id)];
    toast(tr("Demande envoyée : vous verrez son avancement ici."));
    const maj = r.carte || { ...c, statut: "validee" };
    fil.cartes = fil.cartes.map((x) => (x.id === maj.id ? maj : x));
    await rafraichirAttente();
    dessinerListe();
    const ancien = zoneFil.querySelector(`[data-carte="${c.id}"]`);
    if (ancien) ancien.replaceWith(carte(maj));
  }
  async function copier(c, texte) {
    try {
      await navigator.clipboard.writeText(texte);
      toast(tr("Réponse copiée : collez-la dans WhatsApp."));
      await apresValidation(c, { enregistre: { message: texte } });
      await decider(c, "validee");
    } catch {
      toast(tr("Copie impossible : sélectionnez le texte et copiez-le."), true);
    }
  }

  // Une demande ou une course qui relève d'une autre entreprise : on y passe, le message attend dans une nouvelle conversation.
  function passerA(entreprise, texte) {
    try {
      if (texte) sessionStorage.setItem(CLE_BROUILLON, texte);
    } catch {
      // stockage refusé : le message reste à recoller
    }
    changerEntite(entreprise.id, { naviguer: false });
    location.hash = "#/agent/nouvelle";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  // « Transfer request » du site VIP Taxi Lanta collée ailleurs : le dossier se crée chez Taxi, comme avant dans « Coller une demande ».
  function bandeauAutreEntreprise() {
    const premier = (fil.messages || []).find((m) => m.role === "user");
    const t = premier ? texteDe(premier) : "";
    if (!t || !demandeDeTaxi(t, lireMessage(t, aujourdhui()))) return null;
    const taxi = entrepriseTaxi(entitesAccessibles(), (id) => etat.brut.reglages[id], etat.entiteId);
    if (!taxi) return null;
    return h("div", { class: "bandeau-info agent-bascule", role: "status" }, h("p", null, tr("Demande de transfert du site de {nom} : le dossier se crée dans {nom}.", { nom: taxi.nom })), h("button", { class: "principal petit", type: "button", onclick: () => passerA(taxi, t) }, tr("Passer à {nom}", { nom: taxi.nom })));
  }
  const texteDe = (m) => (typeof m.contenu === "string" ? m.contenu : Array.isArray(m.contenu) ? m.contenu.filter((b) => b && b.type === "text").map((b) => b.text).join("\n") : "");

  dessinerListe();
  if (idOuvert) await ouvrir(idOuvert === "nouvelle" ? "" : idOuvert);
  else if (matchMedia("(min-width: 900px)").matches) {
    // Ordinateur : le fil d'une nouvelle conversation est prêt à droite.
    colonneFil.replaceChildren(enTete(), zoneFil, formulaire);
    zoneFil.replaceChildren(suggestions());
  }
  return racine;
}
