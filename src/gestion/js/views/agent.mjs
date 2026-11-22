// Onglet « Assistant » (19.11.2026) : on discute avec l'agent comme dans une messagerie, une conversation par client ou par demande,
// plusieurs ouvertes en parallèle. L'agent cherche, calcule et propose ; chaque proposition est une carte que la personne valide.
// L'onglet est la seule entrée des demandes et des confirmations collées (20.11.2026, décision de Jérémy). « Valider » enregistre d'un geste
// par le code habituel de l'outil (fiche de création du dossier, confirmation de course, formulaire de réservation), sans le réécrire : la
// fenêtre ne s'ouvre que s'il manque quelque chose ; la carte garde alors le motif. « Tout valider » fait de même pour toutes les cartes.
// Téléphone d'abord : la liste, puis le fil en plein écran avec la zone de saisie en bas. Ordinateur : la liste à gauche, le fil à droite.
import { etat, reglages, peut, naviguer, exemple, nomPartenaire, modeTaxi, estAdmin, enregistrerReglages, modifier, supprimer as supprimerLigne, entitesAccessibles, changerEntite, confirmationPermise, permissionsDe, partageClientsPermis, reglagesDe } from "../etat.mjs";
import { h, toast, confirmer, modal, icone, vider, ajouter, squelette } from "../ui.mjs";
import { tr, N_, pluriel, langueActive } from "../i18n.mjs";
import { separerResume, siegesAVerifier, siegesAChoisir, siegesDeCarte, chauffeurCarte, payeSurPlaceCarte } from "../agent-calc.mjs";
import { modeParDefaut } from "../operations-calc.mjs";
import { agentActif, filDepuis, listeConversations, quand, propositionDepuisCarte, reservationDepuisCarte, reservationModifiee, lignesFrise, reglageApplique, prestationModifiee, listeAmeliorations, bloquantsReponse, resteBloque, CONTROLE_IMPOSSIBLE, MONTANT_MASQUE, titreConversation, titreAutomatique, nomDepuisCartes, chercherConversations, echangeWhatsApp, dossiersDeLaCarte, montantsDuTexte } from "../agent-calc.mjs";
import { texteDuree } from "../agent-planifier.mjs";
import { clePaire, detailMorceaux } from "../agent-temps.mjs";
import { propositionVersDemande } from "../assistant-calc.mjs";
import { lireMessage } from "../demande-calc.mjs";
import { lireConfirmation, ressembleAConfirmation } from "../confirmation-calc.mjs";
import { demandeDeTaxi, entrepriseTaxi } from "../taxi-calc.mjs";
import { partenaireDeTaxi, chauffeurRegle } from "../voucher-rapide-calc.mjs";
import { aujourdhui, formatMontant } from "../calc.mjs";
import { correctionsDepuisCarte, dossierDeLaCarte } from "../agent-apprendre.mjs";
import { phraseInterne } from "../agent-apprendre-texte.mjs";
import { rafraichirBandeauCredit } from "./bandeau-credit.mjs";
import { piecesSaisie, bullePieces, carteBrochure } from "./agent-pieces.mjs";
import { erreurFichier } from "../pieces-jointes.mjs";
import { espaceUnifie, carteUnifiee, avecCorrections, entrepriseSuivante, badgeModifiable, planCreation, creerDossiersLies, lierDossiers, carteDeLEntreprise, ouvrirDansEntreprise, conversationsDesDeux, ordreEnvois, marqueUnifiee, LIBELLES_MARQUES } from "../espace-unifie-calc.mjs";
import { CLE_DEMANDE_AGENT, liaisonApresDossier, ERREURS_AGENT_WHATSAPP } from "../whatsapp-suivi-calc.mjs";
import { morceauxCitations, nomConversation } from "../whatsapp-calc.mjs";
import { lienWhatsApp as lienBoiteWhatsApp } from "../agent-whatsapp-lecture.mjs";
import { apporteurConfirme, entreprisesSansFiche, lierDossierConversation, nomsApporteurAMasquer, poseApporteur } from "../apporteurs-calc.mjs";
import { QUESTIONS_RAPIDES, CLE_QUESTION_AGENT, QUESTION_MAX, demandeAOuvrir, questionBoiteAOuvrir, questionsProposees } from "../whatsapp-relie-calc.mjs";
import { cartesVouchers } from "./agent-cartes-voucher.mjs";
import { boutonPasBien } from "./agent-retour.mjs";
import { blocDevis, donneesAvecDevis } from "./devis-carte.mjs";
import { textesDeNani, bornesEchange } from "../devis-calc.mjs";
// Le nom du champ d'une carte « Modification » (22.11.2026 : sièges par type, bagages, remarque du voucher, note interne).
const LIBELLES_MODIF = { vol: N_("Numéro de vol"), sieges: N_("Sièges enfant"), sieges_bebe: N_("Sièges bébé"), sans_siege: N_("Aucun siège enfant ni bébé"), bagages: N_("Bagages"), drop_off: N_("Dépose"), remarque_voucher: N_("Remarque sur le voucher"), note_interne: N_("Note interne"), remarque: N_("Note interne") };

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
  // 22.11.2026 : le prix écrit par le client, que Nani n'a pas corrigé ensuite. Repère seulement, rien n'est bloqué.
  prix_client_non_corrige: N_("Un prix vient du client et Nani ne l'a pas corrigé : vérifiez-le avant de valider."),
  // 22.11.2026 : le prix écrit par Nani à un nouveau client, sans fiche encore (clientProbable). Repère seulement, rien n'est bloqué.
  prix_nani_a_verifier: N_("Un prix vient d'un message de Nani à un contact pas encore relié à une fiche client : vérifiez-le avant de valider."),
  prix_egal_net: N_("Un prix proposé est égal à un net interne : il a été laissé vide."),
  prix_client_sans_net: N_("Le prix écrit par le client n'a pas pu être comparé au net : il a été laissé vide."),
  prix_sous_net: N_("Le prix écrit par le client est au niveau du net ou en dessous : il a été laissé vide. Fixez-le avec « Vérifier avant »."),
  reference_inconnue: N_("Un service proposé n'existe pas au catalogue : choisissez-le à la main."),
  date_illisible: N_("Une date n'a pas pu être lue."),
  // Espace unifié Secret et Taxi (migration 63).
  entreprise_a_choisir: N_("Un service n'a pas d'entreprise : choisissez Secret ou Taxi sur le service."),
  catalogue_autre_entreprise: N_("Un tarif vient du catalogue de l'autre entreprise : vérifiez le service avant de l'ajouter."),
  // Contact WhatsApp apporteur (PR D) : la référence donnée par l'agent ne correspond à aucune fiche.
  apporteur_inconnu: N_("La référence donnée par l'assistant ne correspond à aucune fiche apporteur."),
  // Numéro de vol (21.11.2026) : contrôlé par la fonction, jamais deviné.
  vol_piece_jointe: N_("Numéro de vol lu sur une pièce jointe : vérifiez-le avant de valider."),
  // Relecture de la PR 315 : calculé par l'écran, jamais par la fonction.
  sieges_a_verifier: N_("Plus de sièges enfant ou bébé que d'enfants et de bébés : vérifiez avec « Vérifier avant »."),
  sieges_a_choisir: N_("Un enfant ou un bébé voyage : child seat, baby seat ou aucun siège ? Demandez-le au client, ou choisissez avec « Vérifier avant »."),
  lieu_a_verifier: N_("Un lien Google Maps de la conversation n'a pas pu être lu, ou un lieu portait un lien : vérifiez la prise en charge et la dépose."),
  remarque_voucher_interne: N_("La remarque prévue pour le voucher citait un net, une commission ou un partenaire : elle reste en note interne."),
  vol_sans_source: N_("Un numéro de vol proposé n'était pas écrit dans la conversation : il a été laissé vide."),
  vol_illisible: N_("Un numéro de vol proposé n'a pas la forme d'un numéro de vol : il a été laissé vide."),
};
function texteAvertissement(a) {
  const [code, valeur] = String(a).split(/:(.*)/s);
  if (code === "montant_non_source") return tr("Montant sans source dans la conversation : {v}. À vérifier.", { v: valeur });
  if (code === "heure_non_source") return tr("Heure sans source dans la conversation : {v}. À vérifier.", { v: valeur });
  if (code === "mot_interne") return tr("Mot interne dans la réponse : « {v} ». À retirer.", { v: valeur });
  // Sans le droit de voir les nets, la valeur est une empreinte : elle ne s'affiche pas (revue de la PR 306).
  if (code === "montant_interne" && valeur.startsWith("#")) return tr("Un montant interne (net, marge ou commission) est dans la réponse. À retirer.");
  if (code === "montant_interne") return tr("Montant interne (net, marge ou commission) dans la réponse : {v}. À retirer.", { v: valeur });
  // 21.11.2026 : le net d'un autre service du catalogue ne bloque pas la copie (coïncidence fréquente sur un chiffre rond).
  if (code === "montant_egal_net") return valeur ? tr("Le montant {v} est aussi le net d'un autre service du catalogue. Vérifiez que c'est bien un prix de vente.", { v: valeur }) : tr("Un montant de la réponse est égal à un net interne. Vérifiez que c'est bien un prix de vente.");
  if (code === "montant_illisible") return tr("Un montant de la réponse n'a pas pu être lu. Écrivez-le avec des chiffres simples, par exemple 1,000.");
  if (code === "controle_impossible") return tr("Les nets n'ont pas pu être relus pour contrôler la réponse : elle ne se copie pas. Préparez-la de nouveau.");
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
  chercher_conversations: N_("Je cherche dans WhatsApp"),
  lire_conversation: N_("Je lis la conversation WhatsApp"),
  a_faire_whatsapp: N_("Je regarde ce qui attend dans WhatsApp"),
  trouver_vouchers: N_("Je cherche les vouchers"),
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
  // Espace unifié (migration 63) : pour qui travaille dans Secret et Taxi, les conversations des deux entreprises, chacune avec son badge.
  const unifie = espaceUnifie({ entites: entitesAccessibles(), activeId: etat.entiteId, permissionsDe, agentActif: (id) => agentActif(reglagesDe(id)) });
  const [convLues, ameliorationsLues, convAutre] = await Promise.all([etat.store.agentConversations(etat.entiteId), estAdmin() ? etat.store.ameliorations(etat.entiteId) : null, unifie ? etat.store.agentConversations(unifie.autre.id).catch(() => null) : null]);
  let conversations = convLues ?? null;
  const conversationsAutre = convAutre || [];
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
  // Le titre montré : le nom du client dès qu'il est connu (lot 2, design n° 9). Le client du dossier relié, lu dans les dossiers chargés.
  const clientDuDossier = (id) => {
    const d = id ? (etat.brut.dossiers || []).find((x) => x.id === id) : null;
    return d ? (etat.brut.clients || []).find((x) => x.id === d.client_id) || null : null;
  };
  const titreDe = (c) => titreConversation(c, { client: clientDuDossier(c.dossier_id) });
  const refDe = (c) => ((c.dossier_id && (etat.brut.dossiers || []).find((x) => x.id === c.dossier_id)) || {}).ref || "";
  let recherche = "";
  const champRecherche = h("input", { type: "search", class: "agent-recherche", placeholder: tr("Nom du client ou dossier"), "aria-label": tr("Chercher une conversation"), autocomplete: "off", enterkeyhint: "search" });
  champRecherche.addEventListener("input", () => {
    recherche = champRecherche.value;
    const liste = colonneListe.querySelector(".agent-conversations, .agent-liste-vide");
    if (liste) liste.replaceWith(listeDessinee());
  });
  racine.classList.toggle("avec-fil", !!idOuvert);

  // ---- Liste ----------------------------------------------------------------------------------------------------------------------
  function listeDessinee() {
    const propres = conversations ? listeConversations(conversations, { enAttente: attente, archives }) : [];
    const toutes = unifie ? conversationsDesDeux([{ entite: unifie.active, conversations: propres }, { entite: unifie.autre, conversations: listeConversations(conversationsAutre, { archives }) }]) : propres;
    const liste = chercherConversations(toutes, recherche, (c) => `${titreDe(c)} ${c.titre || ""} ${c.apercu || ""} ${refDe(c)}`);
    // Une conversation de l'autre entreprise : on y passe (entreprise active), puis elle s'ouvre. La ligne touchée se marque tout de suite.
    const allerA = (c) => (e) => {
      for (const a of colonneListe.querySelectorAll(".agent-conv[aria-current]")) a.removeAttribute("aria-current");
      e.currentTarget.setAttribute("aria-current", "page");
      if (!unifie || c.entite_id === etat.entiteId) return;
      e.preventDefault();
      changerEntite(c.entite_id, { naviguer: false });
      naviguer(`#/agent/${c.id}`);
    };
    if (conversations === null) return h("p", { class: "aide agent-liste-vide" }, erreurTexte("migration_manquante"));
    if (!liste.length) return h("p", { class: "aide agent-liste-vide" }, recherche.trim() ? tr("Aucune conversation pour « {q} ».", { q: recherche.trim() }) : archives ? tr("Aucune conversation archivée.") : tr("Aucune conversation. Commencez par une demande de client : une conversation par client garde tout en ordre."));
    return h(
      "ul",
      { class: "agent-conversations" },
      liste.map((c) =>
        h(
          "li",
          null,
          h(
            "a",
            { href: `#/agent/${c.id}`, class: "agent-conv", "aria-current": c.id === idOuvert ? "page" : null, onclick: allerA(c) },
            h("span", { class: "agent-conv-ligne" }, h("strong", null, titreDe(c) || tr("Nouvelle conversation")), h("time", { datetime: c.maj_le }, quand(c.maj_le, { langue: langueActive() }))),
            unifie || c.whatsapp_conversation_id
              ? h(
                  "span",
                  { class: "agent-conv-marques" },
                  unifie ? h("span", { class: `agent-conv-entreprise ${marqueUnifiee(entitesAccessibles().find((x) => x.id === c.entite_id)) || ""}` }, c.entreprise) : null,
                  c.whatsapp_conversation_id ? h("span", { class: "agent-conv-wa" }, icone("whatsapp", 14), tr("WhatsApp")) : null
                )
              : null,
            h("span", { class: "agent-conv-ligne" }, h("span", { class: "agent-conv-apercu" }, c.apercu || ""), c.attente ? h("span", { class: "agent-pastille", "aria-label": pluriel(c.attente, N_("{n} proposition à valider"), N_("{n} propositions à valider")) }, c.attente) : null)
          )
        )
      )
    );
  }
  function dessinerListe() {
    vider(colonneListe);
    // La recherche dès deux conversations (design n° 9).
    const avecRecherche = !!conversations && conversations.length + conversationsAutre.length > 1;
    ajouter(colonneListe, [
      h("div", { class: "agent-liste-tete" }, h("h1", null, tr("Assistant")), h("button", { class: "principal", type: "button", onclick: () => ouvrir("") }, icone("ajouter", 18), tr("Nouvelle"))),
      avecRecherche ? champRecherche : null,
      listeDessinee(),
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
  // La conversation a été ouverte depuis l'écran WhatsApp (« Créer le dossier ») : la flèche retour y ramène.
  let depuisWhatsAppEcran = false;
  // « Demander à l'assistant » depuis une conversation WhatsApp (PR B) : la question attend que la personne la tape ou la choisisse.
  // { whatsapp_conversation_id, entite_id, agent_conversation_id } ; null ailleurs.
  let questionWa = null;
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

  async function ouvrir(id, { question = null } = {}) {
    depuisWhatsAppEcran = false;
    questionWa = question;
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
    if (conv) {
      // Un squelette tient la place du fil pendant sa lecture (lot 2, design n° 13) : le toucher montre tout de suite quelque chose.
      dessinerListe();
      colonneFil.replaceChildren(enTete(), zoneFil, formulaire);
      zoneFil.replaceChildren(squelette(3, { cartes: false }));
      fil = (await etat.store.agentFil(conv.id)) || fil;
    }
    dessinerListe();
    dessinerFil();
    // Message venu d'une autre entreprise (« Passer à … ») : il attend dans la zone de saisie, la personne l'envoie.
    // « Créer le dossier » ou « Mettre à jour le dossier » depuis l'écran WhatsApp (migration 61) : la demande part aussitôt, la fonction lit
    // elle-même l'échange (texte, photos, PDF). Seulement dans l'entreprise de la conversation, une seule fois, dans la conversation déjà
    // liée quand l'écran l'a désignée (une seule discussion par conversation WhatsApp, 22.11.2026).
    let depuisWhatsApp = null;
    let questionBoite = "";
    try {
      // La demande de l'écran WhatsApp est retirée à chaque lecture, qu'elle serve ou non (revue de sécurité de la PR 297) ; elle ne vaut que
      // deux minutes et pour la conversation ouverte (demandeAOuvrir).
      const brut = sessionStorage.getItem(CLE_DEMANDE_AGENT);
      sessionStorage.removeItem(CLE_DEMANDE_AGENT);
      const d = demandeAOuvrir(brut, { conv, entiteId: etat.entiteId });
      // « Demander à l'assistant » (PR B) : dans la nouvelle conversation, ou dans celle déjà liée à cette conversation WhatsApp.
      if (d && d.question) questionWa = d.question;
      if (d && d.dossier) depuisWhatsApp = d.dossier;
      const brutQ = sessionStorage.getItem(CLE_QUESTION_AGENT);
      sessionStorage.removeItem(CLE_QUESTION_AGENT);
      if (!conv) {
        const b = sessionStorage.getItem(CLE_BROUILLON);
        if (b) (sessionStorage.removeItem(CLE_BROUILLON), (champ.value = b), ajuster());
        // La vue « À faire » de WhatsApp : sa question part au clic de la personne, une seule fois.
        questionBoite = questionBoiteAOuvrir(brutQ, { entiteId: etat.entiteId });
      }
    } catch {
      // stockage refusé
    }
    saisieQuestion();
    if (depuisWhatsApp) {
      depuisWhatsAppEcran = true;
      return void envoyer({ whatsapp: depuisWhatsApp });
    }
    if (questionWa) {
      depuisWhatsAppEcran = true;
      dessinerFil();
    }
    if (questionBoite) return void envoyer({ texte: questionBoite });
    champ.focus({ preventScroll: true });
  }

  function fermer() {
    idOuvert = "";
    racine.classList.remove("avec-fil");
    history.replaceState(null, "", "#/agent");
    dessinerListe();
  }

  // La conversation WhatsApp liée (migration 61) ou en attente de la première question (PR B), et son lien, construit par lienWhatsApp
  // (identifiants contrôlés) : jamais une adresse libre.
  const waLiee = () => (conv && conv.whatsapp_conversation_id) || (questionWa && questionWa.whatsapp_conversation_id) || "";
  const lienWaLiee = () => {
    const id = waLiee();
    const wc = id ? (etat.brut.whatsapp_conversations || []).find((x) => x.id === id) : null;
    return lienBoiteWhatsApp({ conversation: id, entite: (wc && wc.entite_id) || "" });
  };
  // Le nom d'une conversation WhatsApp chargée pour la personne (migration 70 : le nom saisi par Nani d'abord), ou "".
  const nomWa = (id) => {
    const wc = id ? (etat.brut.whatsapp_conversations || []).find((x) => x.id === id) : null;
    return wc ? nomConversation(wc, wc.client_id ? (etat.brut.clients || []).find((x) => x.id === wc.client_id) || null : null) : "";
  };
  const nomWaLiee = () => nomWa(waLiee());
  function enTete() {
    const dossier = conv && conv.dossier_id ? etat.db.dossiers.find((d) => d.id === conv.dossier_id) : null;
    const lienWa = waLiee() ? lienWaLiee() : "";
    return h(
      "header",
      { class: "agent-fil-tete" },
      // Venue de WhatsApp, la flèche y ramène (design n° 4) ; sinon, à la liste.
      lienWa && depuisWhatsAppEcran
        ? h("a", { class: "bouton-icone lien agent-retour", href: lienWa, "aria-label": tr("Retour à la conversation WhatsApp") }, icone("retour", 22))
        : h("button", { class: "bouton-icone agent-retour", type: "button", onclick: fermer, "aria-label": tr("Retour aux conversations") }, icone("retour", 22)),
      h(
        "div",
        { class: "agent-fil-titre" },
        h("h2", null, conv ? titreDe(conv) : questionWa ? nomWaLiee() || tr("Nouvelle conversation") : tr("Nouvelle conversation")),
        dossier || lienWa
          ? h(
              "p",
              { class: "agent-fil-liens" },
              dossier ? h("a", { class: "agent-dossier", href: `#/dossier/${dossier.id}` }, tr("Dossier {ref}", { ref: dossier.ref })) : null,
              // Liée à WhatsApp (design n° 4, PR B) : un lien pour revenir à la conversation du client.
              lienWa ? h("a", { class: "agent-dossier", href: lienWa }, icone("whatsapp", 14), nomWaLiee() ? tr("Voir la conversation WhatsApp de {nom}", { nom: nomWaLiee() }) : tr("Voir la conversation WhatsApp")) : null
            )
          : null
      ),
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

  // Les questions rapides sur la conversation WhatsApp (PR B) : un tap envoie la question. Dans une conversation déjà liée, une nouvelle
  // conversation sur ce contact reste possible.
  function questionsRapides() {
    if (!questionWa) return null;
    const nouvelle = conv ? h("button", { class: "lien agent-wa-nouvelle", type: "button", onclick: () => ouvrir("", { question: { ...questionWa, agent_conversation_id: null } }) }, tr("Nouvelle conversation sur ce contact")) : null;
    return h(
      "div",
      { class: "agent-vide agent-wa-questions" },
      h("p", null, icone("whatsapp", 16), " ", tr("Les derniers messages de la conversation sont joints. Posez votre question ou choisissez :")),
      // En lecture seule (entreprise que la personne n'administre pas), aucune carte : « Prépare les dossiers » n'est pas proposé.
      h("ul", { class: "agent-wa-rapides" }, questionsProposees(questionWa).map((q) => h("li", null, h("button", { class: "secondaire", type: "button", onclick: () => envoyer({ texte: tr(q) }) }, tr(q))))),
      questionWa.lecture_seule ? h("p", { class: "aide" }, tr("Lecture seule : l'assistant répond, sans proposer de dossier.")) : null,
      nouvelle
    );
  }
  // La zone de saisie pendant qu'une question WhatsApp attend (revue de sécurité de la PR 297) : pas de pièce jointe (la question part avec
  // l'échange, sans fichier) et QUESTION_MAX caractères au plus, avec un message clair à la limite. Sinon, la saisie habituelle.
  const avertissementLongueur = h("p", { class: "agent-joints-erreur agent-wa-longueur", role: "status" });
  function saisieQuestion() {
    const attente = !!questionWa;
    pieces.bloquer(attente ? tr("Pièces jointes indisponibles pour une question sur WhatsApp : la question part avec les derniers messages. Joignez les photos dans le message suivant.") : "");
    champ.maxLength = attente ? QUESTION_MAX : 8000;
    if (!attente) avertissementLongueur.textContent = "";
    else if (!avertissementLongueur.isConnected) pieces.erreur.after(avertissementLongueur);
    verifierLongueur();
  }
  function verifierLongueur() {
    avertissementLongueur.textContent = questionWa && champ.value.length >= QUESTION_MAX ? tr("Une question sur WhatsApp tient en {max} caractères au plus.", { max: QUESTION_MAX }) : "";
  }
  champ.addEventListener("input", verifierLongueur);
  function dessinerFil() {
    const items = filDepuis(fil.messages, fil.cartes);
    zoneFil.replaceChildren(...[bandeauAutreEntreprise(), ...(items.length ? items.map((it, i) => element(it, i)) : questionWa ? [] : [suggestions()]), questionsRapides()].filter(Boolean));
    majToutValider();
    colonneFil.replaceChildren(enTete(), zoneFil, barreTout, formulaire);
    descendre();
  }
  const descendre = () => requestAnimationFrame(() => {
    zoneFil.scrollTop = zoneFil.scrollHeight;
    if (!matchMedia("(min-width: 900px)").matches) window.scrollTo({ top: document.documentElement.scrollHeight });
  });

  // « Pas bien » (migration 74) : dans l'entreprise de la conversation, pour qui peut y noter un apprentissage (agent-retour.mjs).
  const entiteDuFil = () => (conv && conv.entite_id) || etat.entiteId;
  // Les noms masqués d'un « Pas bien » sur une bulle : une réponse à l'équipe peut citer plusieurs clients (planning, vouchers, recherche) et
  // des partenaires. Tous les clients et partenaires chargés, en plus de ceux de la conversation (revue de sécurité).
  const nomsDuFil = () => {
    const m = nomsAMasquer();
    return { noms: [...m.noms, ...[...(etat.db.clients || []), ...(etat.brut.clients || [])].flatMap((x) => [x.prenom, x.nom])].filter(Boolean), entiers: m.entiers };
  };
  function element(it, i) {
    if (it.genre === "personne") {
      // Le premier message d'une conversation ouverte depuis WhatsApp : l'échange du client, à gauche et replié (design n° 4).
      // Le résumé d'une discussion pleine archivée (relecture de la PR 318) : une ligne discrète, puis le reste du message.
      const { resume, reste } = separerResume(it.texte);
      if (resume) {
        const suite = reste ? element({ ...it, texte: reste }, -1) : null;
        return h("div", null, h("p", { class: "agent-etape-wa" }, icone("dossiers", 16), tr("Suite d'une discussion pleine, archivée : client, dossiers et dernier prix accepté repris.")), suite);
      }
      const echange = i === 0 && conv && conv.whatsapp_conversation_id ? echangeWhatsApp(it.texte, { depuisWhatsApp: true }) : echangeWhatsApp(it.texte);
      // « Demander à l'assistant » (PR B) : l'échange replié, puis la question de la personne, à droite comme ses messages.
      if (echange && echange.question) return h("div", { class: "agent-question-wa" }, bulleWhatsApp(echange), h("div", { class: "agent-bulle de-personne" }, paragraphes(echange.question)));
      if (echange) return bulleWhatsApp(echange);
      return h("div", { class: "agent-bulle de-personne" }, paragraphes(it.texte));
    }
    // « Pas bien » : la raison et un extrait sans montant (la réponse à l'équipe peut citer des nets, des marges ou des gains), jamais la
    // question tapée (elle peut contenir le message d'un client collé). Relu par l'Assistant seulement, pas par la boîte WhatsApp.
    if (it.genre === "agent") return h("div", { class: "agent-bulle de-agent" }, paragraphes(it.texte), boutonPasBien({ entiteId: entiteDuFil(), reponse: it.texte, contexte: "réponse de l'Assistant à l'équipe", masques: nomsDuFil, prix: prixConnus, sansMontants: true }));
    if (it.genre === "pieces") return bullePieces(it.fichiers);
    if (it.genre === "planning") return frise(it.planning);
    // Les vouchers trouvés (trouver_vouchers) : une carte par dossier, avec l'aperçu et le bouton d'envoi.
    if (it.genre === "vouchers") return cartesVouchers(it.vouchers);
    return carte(it.carte);
  }
  // Les citations de la boîte WhatsApp (#/whatsapp?c=…&m=…) deviennent des liens ; le reste du texte reste du texte.
  // Avec le nom de la conversation citée quand elle est chargée (migration 70).
  const libelleCitation = (m) => {
    const nom = nomWa(m.conversation);
    if (m.message) return nom ? tr("voir le message ({nom})", { nom }) : tr("voir le message");
    return nom ? tr("voir la conversation ({nom})", { nom }) : tr("voir la conversation");
  };
  const avecCitations = (l) => morceauxCitations(l).map((m) => (m.lien ? h("a", { class: "agent-citation", href: m.lien }, libelleCitation(m)) : m.texte));
  const paragraphes = (t) => String(t).split(/\n{2,}/).map((p) => h("p", null, ...p.split("\n").flatMap((l, i) => (i ? [h("br"), ...avecCitations(l)] : avecCitations(l)))));
  function bulleWhatsApp(echange, { nom = nomWaLiee() || (conv ? titreDe(conv) : "") } = {}) {
    const n = echange.messages.length;
    return h(
      "details",
      { class: "agent-bulle agent-whatsapp" },
      h("summary", null, icone("whatsapp", 16), h("span", null, pluriel(n, N_("Échange WhatsApp avec {nom}, {n} message"), N_("Échange WhatsApp avec {nom}, {n} messages"), { nom: nom || tr("le client") }))),
      h("ol", { class: "agent-whatsapp-fil" }, echange.messages.map((m) => h("li", { class: m.deClient ? "client" : "nani" }, h("span", { class: "agent-whatsapp-qui" }, m.deClient ? tr("Client") : tr("Vous"), m.heure ? ` ${m.heure.slice(-5)}` : ""), h("span", null, m.texte))))
    );
  }

  // ---- Envoi ------------------------------------------------------------------------------------------------------------------
  async function envoyer({ whatsapp = null, texte: donne = "" } = {}) {
    const texte = whatsapp ? "" : (donne || champ.value).trim();
    // La première question sur une conversation WhatsApp (PR B) : la fonction joint l'échange elle-même, sans pièce jointe tapée ici.
    // Dans une conversation déjà liée et rouverte depuis WhatsApp (point 4 de la revue de la PR 297) : la fonction joint aussi l'échange frais.
    const question = questionWa && !whatsapp ? questionWa : null;
    const joints = whatsapp || question ? [] : pieces.noms();
    if ((!texte && !joints.length && !whatsapp) || enCours) return;
    if (question && texte.length > QUESTION_MAX) return void (avertissementLongueur.textContent = tr("Une question sur WhatsApp tient en {max} caractères au plus.", { max: QUESTION_MAX }));
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
    if (!donne) champ.value = "";
    ajuster();
    // Les questions rapides disparaissent dès qu'une question part.
    if (questionWa) {
      questionWa = null;
      const q = zoneFil.querySelector(".agent-wa-questions");
      if (q) q.remove();
      saisieQuestion();
    }
    if (!zoneFil.querySelector(".agent-bulle, .agent-frise, .agent-carte")) zoneFil.replaceChildren();
    if (joints.length) zoneFil.append(bullePieces(joints));
    if (texte) zoneFil.append(h("div", { class: "agent-bulle de-personne" }, paragraphes(texte)));
    if (whatsapp) zoneFil.append(h("p", { class: "agent-etape-wa" }, icone("whatsapp", 16), whatsapp.whatsapp_mode === "maj" ? tr("Mise à jour du dossier d'après la conversation WhatsApp") : tr("Dossier d'après la conversation WhatsApp")));
    if (question) zoneFil.append(h("p", { class: "agent-etape-wa" }, icone("whatsapp", 16), tr("Avec les derniers messages de la conversation WhatsApp")));
    // Les fichiers choisis restent en mémoire : si l'envoi échoue, ils reviennent dans la zone de saisie.
    const choisis = pieces.fichiers();
    pieces.vider();
    const etape = h("p", { class: "agent-etape", role: "status" }, h("span", { class: "agent-point", "aria-hidden": "true" }), tr("L'assistant réfléchit"));
    let bulle = null;
    let texteRecu = "";
    zoneFil.append(etape);
    descendre();
    const corps = whatsapp
      ? { entite_id: etat.entiteId, ...(conv ? { conversation_id: conv.id } : {}), whatsapp_conversation_id: whatsapp.whatsapp_conversation_id, whatsapp_mode: whatsapp.whatsapp_mode, whatsapp_pieces: whatsapp.whatsapp_pieces || [], texte: "" }
      : question
        ? { entite_id: etat.entiteId, ...(conv ? { conversation_id: conv.id } : {}), whatsapp_conversation_id: question.whatsapp_conversation_id, whatsapp_mode: "question", whatsapp_pieces: [], texte }
        : { entite_id: etat.entiteId, conversation_id: conv ? conv.id : null, texte, ...(fichiers.length ? { fichiers } : {}) };
    // Une exception (connexion coupée, écran qui lève) ne laisse jamais « L'assistant réfléchit » ni le bouton éteint (audit I7).
    const surEvenement = (ev) => {
      // La discussion liée était pleine (relecture de la PR 318) : la fonction l'a archivée et en a ouvert une nouvelle, qui prend sa place.
      if (ev.t === "conversation" && conv && ev.remplace && ev.remplace === conv.id && ev.id !== conv.id) {
        conversations = (conversations || []).map((c) => (c.id === ev.remplace ? { ...c, statut: "archivee" } : c));
        conv = null;
        toast(tr("La discussion était pleine : elle est archivée, une nouvelle reprend son résumé."));
      }
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
      } else if (ev.t === "vouchers") {
        etape.before(cartesVouchers(ev.vouchers));
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
    };
    let r = await etat.store.agentEnvoyer(corps, surEvenement).catch(() => ({ erreur: "coupure" }));
    // Compatibilité avec une fonction agent pas encore redéployée (22.11.2026) : elle ne connaît la discussion liée que pour une question
    // et répond « message_invalide » à un dossier envoyé dedans. L'écran retombe alors sur l'ancien chemin, une nouvelle discussion, sans
    // erreur affichée. Rien n'a été gardé par la fonction : la demande repart une fois, sans conversation_id.
    if (r && r.erreur === "message_invalide" && whatsapp && corps.conversation_id) {
      const { conversation_id: _liee, ...sansLiee } = corps;
      conv = null;
      idOuvert = "";
      r = await etat.store.agentEnvoyer(sansLiee, surEvenement).catch(() => ({ erreur: "coupure" }));
    }
    etape.remove();
    if (r && r.erreur) {
      // Plafond ou crédit : l'assistant le dit dans le fil, comme une réponse, pour que ce soit clair et non une panne obscure.
      if (r.erreur === "plafond_du_mois" || r.erreur === "credit_epuise") zoneFil.append(h("div", { class: "agent-bulle de-agent agent-arret", role: "alert" }, h("p", null, erreurTexte(r.erreur, r))));
      else zoneFil.append(h("p", { class: "agent-erreur", role: "alert" }, erreurTexte(r.erreur)));
      // Le texte revient dans la zone, sauf après une coupure en cours de réponse : le serveur l'a déjà gardé, la relecture le montre.
      if ((!conv || r.erreur !== "coupure") && !champ.value.trim()) champ.value = texte;
      // La question n'est pas partie : elle reste liée à WhatsApp pour le prochain essai (sauf contact personnel ou lecture seule refusée).
      if (question && !["contact_personnel", "whatsapp_introuvable"].includes(r.erreur)) (questionWa = question), saisieQuestion();
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
      // Le titre devient le nom du client dès qu'une carte le donne (design n° 9), sauf si la personne a renommé la conversation.
      const nom = titreAutomatique(conv.titre) ? nomDepuisCartes(fil.cartes) : "";
      if (nom && nom !== conv.titre) await etat.store.agentMajConversation(conv.id, { titre: nom }).catch(() => null);
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
      h("figcaption", null, tr("Course du {date}", { date }), plan.alertes.includes("temps_simules") ? h("span", { class: "agent-simule" }, tr("Durées de démonstration")) : plan.alertes.includes("estimation_web") ? h("span", { class: "agent-simule" }, tr("Durée trouvée sur le web")) : plan.alertes.includes("temps_a_verifier") ? h("span", { class: "agent-simule" }, tr("Durée à vérifier")) : null),
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
              p.trajet && p.trajet.source_url ? h("a", { class: "agent-trajet", href: p.trajet.source_url, target: "_blank", rel: "noopener noreferrer" }, tr("Source de l'estimation")) : null
            )
          )
        )
      ),
      verdict,
      // Mention exigée par OpenStreetMap et OSRM quand un itinéraire vient d'eux.
      plan.trajets.some((t) => t.source === "ors" || (t.morceaux || []).some((m) => m.source === "ors")) ? h("p", { class: "agent-mention" }, ((m) => (plan.trajets.some((t) => t.moteur === m || (t.morceaux || []).some((x) => x.moteur === m))))("google") ? tr("Itinéraire Google Maps") : plan.trajets.some((t) => t.moteur === "osrm" || (t.morceaux || []).some((m) => m.moteur === "osrm")) ? tr("Itinéraire OSRM, données © contributeurs OpenStreetMap") : tr("Itinéraire openrouteservice, données © contributeurs OpenStreetMap")) : null,
      // Le détail du calcul, replié : les hypothèses et les lieux tels que la carte les a compris (lot 2, design n° 12).
      h("details", { class: "agent-hypotheses" }, h("summary", null, tr("Comment les heures sont calculées")), h("ul", null, plan.hypotheses.map((x) => h("li", null, x)), plan.trajets.filter((t) => t.de_trouve).map((t) => h("li", null, tr("Lieux compris par la carte : {a} vers {b}", { a: t.de_trouve, b: t.vers_trouve }))))) 
    );
  }

  // ---- Cartes ---------------------------------------------------------------------------------------------------------------------
  const devise = () => reglages().devise || "THB";
  const jourCourt = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(langueActive() === "en" ? "en-GB" : "fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "");
  // Les prix comme partout dans Gestion (formatMontant, design n° 15) : « THB 2'300 ».
  const prixTexte = (s) => (s.prix === null || s.prix === undefined ? h("span", { class: "agent-prix vide" }, tr("Prix à fixer")) : h("span", { class: "agent-prix" }, formatMontant(Number(s.prix), devise()), h("small", null, s.origine_prix === "saisi" ? tr("donné par vous") : s.origine_prix === "devis" ? tr("devis calculé") : s.origine_prix === "client_non_corrige" ? [tr("prix du client, non corrigé par Nani"), s.prix_catalogue !== undefined && s.prix_catalogue !== null ? ` · ${tr("catalogue : {prix}", { prix: formatMontant(Number(s.prix_catalogue), devise()) })}` : ""].join("") : tr("catalogue"))));
  // L'heure de pickup manque : dit sur la carte, comme « Prix à fixer », avant de créer le dossier (design n° 5).
  // Les sièges enfant ou bébé lus par l'Assistant (22.11.2026), dits sur la carte avant de créer.
  // Par type depuis le 22.11.2026 : « 1 siège enfant, 1 siège bébé », « aucun siège », ou « sièges à choisir » pour un enfant sans choix.
  const siegesTexte = (s, d = {}) => {
    const x = siegesDeCarte(s);
    const liste = [x.enfant ? pluriel(x.enfant, N_("{n} siège enfant"), N_("{n} sièges enfant")) : "", x.bebe ? pluriel(x.bebe, N_("{n} siège bébé"), N_("{n} sièges bébé")) : ""].filter(Boolean).join(", ");
    if (liste) return liste;
    if (x.aucun) return tr("aucun siège");
    return siegesAChoisir({ genre: "reservation", donnees: { ...d, service: s } }) ? h("span", { class: "agent-a-fixer" }, tr("sièges à choisir")) : "";
  };
  const bagagesTexte = (s) => (Number(s.bagages) > 0 ? pluriel(Number(s.bagages), N_("{n} bagage"), N_("{n} bagages")) : "");
  // Les deux remarques d'un service (22.11.2026) : ce que le voucher imprime (vu par le client et le chauffeur) et ce qui reste interne.
  const remarquesCarte = (s) => {
    const voucher = String(s.remarque_voucher || "").trim();
    const interne = [s.note_interne, s.remarque].filter((x) => x && String(x).trim()).join(" ");
    if (!voucher && !interne) return null;
    return h("div", { class: "agent-remarques" }, h("p", null, h("strong", null, tr("Sur le voucher")), " ", voucher || tr("rien")), h("p", null, h("strong", null, tr("Interne")), " ", interne || tr("rien")));
  };
  const pickupTexte = (s) => (s.heure_pickup ? tr("pickup {h}", { h: s.heure_pickup }) : h("span", { class: "agent-a-fixer" }, tr("heure de pickup à fixer")));

  // Ce qu'une validation a créé pendant cette visite (dossier, course) : la carte validée montre ensuite le voucher et le message.
  const resultats = new Map();
  // Le motif d'une carte qui n'a pas pu être enregistrée d'un geste, avec l'entreprise où la passer s'il y a lieu.
  const motifs = new Map();
  // Espace unifié : l'entreprise d'un service corrigée d'un tap avant de valider (carte -> { index du service: { id, slug } }).
  const corrections = new Map();
  // Le devis calculé par Nani sur cette carte (devis-carte.mjs) passe aussi : « Créer le dossier » reprend ses véhicules et son total.
  // Le devis n'est repris que si l'échange n'a pas de nouveau message depuis son calcul (marqueFil).
  const marqueFil = () => {
    const m = fil.messages || [];
    return `${m.length}:${(m[m.length - 1] || {}).cree_le || ""}`;
  };
  const donneesCarte = (c) => donneesAvecDevis(c.id, carteUnifiee(c.donnees) ? avecCorrections(c.donnees, corrections.get(c.id) || {}) : c.donnees, { marque: marqueFil() });
  const entrepriseDe = (id) => entitesAccessibles().find((e) => e.id === id) || null;
  const libelleEntreprise = (id) => {
    const e = entrepriseDe(id);
    return e ? LIBELLES_MARQUES[marqueUnifiee(e)] || e.nom : tr("Choisissez Secret ou Taxi");
  };
  // Le badge Secret ou Taxi d'un service, corrigeable d'un tap tant que la carte attend (seulement pour qui travaille dans les deux).
  function badgeEntreprise(c, s, i) {
    const marque = marqueUnifiee(entrepriseDe(s.entite_id)) || "a-choisir";
    const libelle = libelleEntreprise(s.entite_id);
    // Une carte décidée ne garde pas le choix fait d'un tap (la carte enregistrée ne change que de statut) : pas de « à choisir » trompeur.
    if (c.statut !== "proposee" && !s.entite_id) return null;
    // Un service du catalogue garde l'entreprise de son catalogue : badge figé.
    if (!unifie || c.statut !== "proposee" || !badgeModifiable(s)) return h("span", { class: `agent-badge-entreprise ${marque}` }, libelle);
    return h(
      "button",
      {
        type: "button",
        class: `agent-badge-entreprise ${marque}`,
        "aria-label": tr("Entreprise du service : {nom}. Toucher pour changer.", { nom: libelle }),
        onclick: () => {
          const suivante = entrepriseSuivante(s, unifie.entites);
          if (!suivante) return;
          corrections.set(c.id, { ...(corrections.get(c.id) || {}), [i]: { id: suivante.id, slug: marqueUnifiee(suivante) } });
          motifs.delete(c.id);
          redessiner(c);
        },
      },
      libelle
    );
  }
  const estCourse = (c) => c.genre === "dossier" && !!(c.donnees && c.donnees.course);
  // « Envoyé par Jade », puis « Apporteur : pas de fiche chez Taxi » pour une entreprise de la carte sans fiche. Rien n'est bloqué : Nani
  // pourra créer la fiche plus tard. Écran interne seulement, jamais un document du client.
  const blocApporteurCarte = (apporteur, entiteIds) => [
    h("p", { class: "agent-carte-apporteur" }, icone("partenaires", 14), tr("Envoyé par {nom}", { nom: apporteur.nom })),
    ...entreprisesSansFiche(apporteur, entiteIds).map((id) => h("p", { class: "agent-carte-apporteur sans-fiche" }, tr("Apporteur : pas de fiche chez {nom}", { nom: libelleEntreprise(id) }))),
  ];
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
      const u = carteUnifiee(d);
      const du = donneesCarte(c);
      corps.push(h("p", { class: "agent-carte-client" }, [d.client && d.client.nom, d.client && d.client.hotel, pluriel(d.adultes || 0, N_("{n} adulte"), N_("{n} adultes")), d.enfants ? pluriel(d.enfants, N_("{n} enfant"), N_("{n} enfants")) : ""].filter(Boolean).join(", ")));
      corps.push(h("ul", { class: "agent-services" }, (du.services || []).map((s, i) => h("li", null, h("span", null, h("strong", null, s.libelle || s.texte), h("small", null, ...[jourCourt(s.date), pickupTexte(s), s.vol && tr("vol {v}", { v: s.vol }), siegesTexte(s, d), bagagesTexte(s)].filter(Boolean).flatMap((x, j) => (j ? [", ", x] : [x]))), u ? badgeEntreprise(c, s, i) : null, remarquesCarte(s)), prixTexte(s)))));
      // Espace unifié : deux entreprises, deux dossiers liés ; une seule autre entreprise, le dossier se crée chez elle.
      const ids = [...new Set((du.services || []).map((s) => s.entite_id).filter(Boolean))];
      const mixte = u && ids.length > 1;
      const ailleurs = u && ids.length === 1 && ids[0] !== etat.entiteId;
      // « Vérifier avant » n'existe que pour un dossier simple de l'entreprise active : pas pour une carte mixte, une autre entreprise, ni
      // tant qu'un service n'a pas d'entreprise.
      const aChoisir = u && (du.services || []).some((s) => !s.entite_id);
      action = { libelle: mixte ? tr("Créer les deux dossiers") : ailleurs ? tr("Créer le dossier chez {nom}", { nom: libelleEntreprise(ids[0]) }) : tr("Créer le dossier"), faire: () => valider(c), puis: mixte || ailleurs || aChoisir ? null : { libelle: tr("Vérifier avant"), faire: () => ouvrirDossier(c) } };
      // Envoyé par un apporteur (PR D) : son nom, et chaque entreprise de la carte où il n'a pas de fiche (le dossier s'y crée sans lui).
      if (d.apporteur && d.apporteur.nom) corps.push(...blocApporteurCarte(d.apporteur, u ? ids : [etat.entiteId]));
      // « Calculer le devis » (devis-carte.mjs) : lancé par Nani, seulement quand trajet, personnes et date sont connus.
      if (c.statut === "proposee") corps.push(blocDevis(du, { id: c.id, textes: () => textesDeNani(fil.messages, bornesEchange(c, fil.cartes)), marque: marqueFil }));
    } else if (c.genre === "reservation") {
      const s = d.service || {};
      corps.push(h("p", null, tr("Dossier {ref}", { ref: d.dossier_ref || "" })), h("ul", { class: "agent-services" }, h("li", null, h("span", null, h("strong", null, s.libelle || s.texte), h("small", null, ...[jourCourt(s.date), s.heure_pickup && tr("pickup {h}", { h: s.heure_pickup }), s.vol && tr("vol {v}", { v: s.vol }), siegesTexte(s), bagagesTexte(s)].filter(Boolean).flatMap((x, j) => (j ? [", ", x] : [x]))), remarquesCarte(s)), prixTexte(s))));
      action = { libelle: tr("Ajouter au dossier"), faire: () => valider(c), puis: { libelle: tr("Vérifier avant"), faire: () => ouvrirReservation(c) } };
    } else if (c.genre === "modification") {
      corps.push(h("p", null, h("strong", null, d.libelle)), h("p", { class: "agent-modif" }, LIBELLES_MODIF[d.champ] ? h("span", null, tr(LIBELLES_MODIF[d.champ]), " ") : null, h("del", null, d.avant || tr("vide")), " ", icone("fleche", 16), " ", h("ins", null, d.valeur)), d.raison ? h("p", { class: "aide" }, d.raison) : null);
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
      // Conversation liée à un apporteur (revue PR 298) : la carte dit à qui va la réponse.
      const versApporteur = d.destinataire === "apporteur";
      if (d.destinataire) corps.push(h("p", { class: `agent-destinataire ${versApporteur ? "apporteur" : "client"}` }, versApporteur ? tr("Réponse à {nom} (apporteur)", { nom: d.apporteur_nom || tr("l'apporteur") }) : tr("Réponse au client")));
      const zone = h("textarea", { class: "agent-reponse", rows: 8, "aria-label": versApporteur ? tr("Réponse à l'apporteur") : tr("Réponse au client"), lang: d.langue === "en" ? "en" : "fr" });
      zone.value = d.message || "";
      // Un montant interne ou un nom de partenaire signalé bloque la copie tant qu'il reste dans le texte (agent-calc.mjs, resteBloque).
      const bloquants = bloquantsReponse(c.avertissements);
      const alerte = h("p", { class: "erreur-form", role: "alert", hidden: true });
      corps.push(zone, alerte);
      // « Pas bien » sur la réponse au client préparée (la carte reste à copier ou à écarter).
      const pasBien = boutonPasBien({ entiteId: entiteDuFil(), reponse: d.message || "", contexte: d.langue === "en" ? "réponse au client en anglais préparée par l'Assistant" : "réponse au client préparée par l'Assistant", masques: () => nomsAMasquer(c), prix: prixConnus, carteId: c.id });
      if (pasBien) corps.push(pasBien);
      action = {
        libelle: tr("Copier la réponse"),
        faire: () => (resteBloque(zone.value, bloquants).length ? null : copier(c, zone.value)),
        lier: (bouton) => {
          const maj = () => {
            const reste = resteBloque(zone.value, bloquants);
            bouton.disabled = reste.length > 0;
            alerte.hidden = !reste.length;
            alerte.textContent = !reste.length ? "" : reste.includes(CONTROLE_IMPOSSIBLE) ? tr("Les nets n'ont pas pu être relus pour contrôler la réponse : elle ne se copie pas. Préparez-la de nouveau.") : tr("À retirer avant de copier : {liste}. Ces chiffres et ces noms ne vont jamais au client.", { liste: reste.map((x) => (x === MONTANT_MASQUE ? tr("un montant égal à un net interne") : x)).join(", ") });
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
    // Espace unifié : « entreprise à choisir » tombe dès que chaque service a son entreprise (corrigée d'un tap).
    const resolu = c.genre === "dossier" && carteUnifiee(d) && (c.statut !== "proposee" || (donneesCarte(c).services || []).every((s) => s.entite_id));
    const avertissements = [...(c.avertissements || []).filter((a) => !(resolu && a === "entreprise_a_choisir")), ...(c.statut === "proposee" && siegesAVerifier(c) ? ["sieges_a_verifier"] : []), ...(c.statut === "proposee" && siegesAChoisir(c) && !(c.avertissements || []).includes("sieges_a_choisir") ? ["sieges_a_choisir"] : [])];
    const avert = avertissements.length && c.genre !== "amelioration" ? h("ul", { class: "assistant-avertissements" }, avertissements.map((a) => h("li", null, texteAvertissement(a)))) : null;
    const libelles = { dossier: estCourse(c) ? N_("Course") : N_("Nouveau dossier"), reservation: N_("Service à ajouter"), modification: N_("Modification"), reponse: c.genre === "reponse" && d.destinataire === "apporteur" ? N_("Réponse à l'apporteur") : N_("Réponse au client"), temps: N_("Temps de trajet"), reglage: N_("Réglage"), amelioration: N_("Amélioration de l'outil"), brochure: N_("Brochure à importer") };
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

  // Après une validation : le dossier, son voucher (ou la Booking confirmation chez Taxi) et le message WhatsApp, d'un geste. Après un
  // rechargement ou un retour, la suite se retrouve par les dossiers réellement créés (dossier relié, dossier lié), pas par la mémoire de
  // la visite (design n° 5). Un bouton principal par document, « Ouvrir le dossier » en lien.
  function suite(c) {
    const r = resultats.get(c.id) || dossiersDeLaCarte(c, { conv, dossiers: etat.brut.dossiers || [], cartes: fil.cartes });
    if (!r || !r.dossier) return null;
    const dossier = r.dossier;
    // Deux dossiers liés (Secret et Taxi) ou un dossier créé dans l'autre entreprise : le voucher de Secret d'abord, puis la Booking
    // confirmation de Taxi, chacun dans son entreprise.
    const autres = (r.dossiers || [dossier]).filter(Boolean);
    if (autres.length > 1 || dossier.entite_id !== etat.entiteId) {
      const entites = entitesAccessibles();
      return h(
        "div",
        { class: "actions gauche agent-suite" },
        ordreEnvois(autres, entites).map((d, i) => {
          const taxi = marqueUnifiee(entites.find((e) => e.id === d.entite_id)) === "taxi";
          return h("button", { class: "principal", type: "button", onclick: () => voucherDans(d) }, icone("whatsapp", 18), taxi ? tr("Envoyer la Booking confirmation") : tr("Envoyer le voucher Secret"));
        }),
        h("p", { class: "agent-suite-liens" }, ordreEnvois(autres, entites).map((d) => h("a", { href: `#/dossier/${d.id}?entite=${d.entite_id}` }, tr("Ouvrir le dossier {ref}", { ref: d.ref || "" }))))
      );
    }
    if (r.course) return h("div", { class: "agent-suite" }, blocBooking(r.course), h("p", { class: "agent-suite-liens" }, h("a", { href: `#/dossier/${dossier.id}` }, tr("Ouvrir le dossier {ref}", { ref: dossier.ref || "" }))));
    return h(
      "div",
      { class: "actions gauche agent-suite" },
      h("button", { class: "principal", type: "button", onclick: () => voucher(dossier.id) }, icone("whatsapp", 18), modeTaxi() ? tr("Envoyer la Booking confirmation") : tr("Envoyer le voucher")),
      h("p", { class: "agent-suite-liens" }, h("a", { href: `#/dossier/${dossier.id}` }, tr("Ouvrir le dossier {ref}", { ref: dossier.ref || "" })))
    );
  }
  let blocBooking = () => null;
  // Le voucher d'un dossier d'une autre entreprise : l'écran d'envoi habituel, dans son entreprise (logo, textes, Booking confirmation),
  // puis retour à l'entreprise de la conversation quand la fenêtre se ferme.
  // Le retour est synchrone, dans le rappel de fermeture de la fenêtre, avant toute navigation (ouvrirDansEntreprise).
  const changerSansNaviguer = (id) => etat.entiteId !== id && changerEntite(id, { naviguer: false });
  const chargerVoucher = () => Promise.all([import("./creation-course.mjs"), import("./voucher-envoi.mjs")]);
  function ouvrirVoucher([{ courseDuDossier }, { envoyerVoucher }], dossierId, revenir) {
    const x = courseDuDossier(dossierId);
    if (!x.reservation) return void toast(tr("Ce dossier n'a pas encore de service à mettre sur un voucher."), true), false;
    if (revenir) envoyerVoucher(x, { avantNavigation: revenir });
    else envoyerVoucher(x);
    return true;
  }
  const voucherDans = (d) => ouvrirDansEntreprise({ id: d.entite_id, origine: etat.entiteId, changer: changerSansNaviguer, charger: chargerVoucher, ouvrir: (m, revenir) => ouvrirVoucher(m, d.id, revenir) });
  const voucher = async (dossierId) => ouvrirVoucher(await chargerVoucher(), dossierId, null);

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
  // `entiteId` : l'entreprise du dossier (espace unifié), où ses apprentissages sont gardés.
  // `typeLie` : le type du contact WhatsApp lié, relu (noterReussite) ; un apporteur ne relie pas la conversation au dossier (revue PR 298).
  // Les noms à masquer dans un apprentissage (correction ou « Pas bien ») : le client du dossier `idNoms` (celui de la carte, ou celui déjà
  // relié à la conversation), les noms donnés dans les cartes « dossier » de la conversation (une réponse copiée avant que la conversation
  // ait un dossier ne garde pas le nom du client), et les noms d'apporteur (revue PR 298) : fiche reliée à la conversation WhatsApp, toutes
  // les fiches « apporteur », noms des cartes. Aussi le nom de la conversation WhatsApp liée (le contact).
  function nomsAMasquer(c = null, idNoms = conv && conv.dossier_id) {
    const dossier = idNoms ? etat.db.dossiers.find((d) => d.id === idNoms) : null;
    const client = dossier ? etat.db.clients.find((x) => x.id === dossier.client_id) : null;
    const waLue = conv && conv.whatsapp_conversation_id ? (etat.brut.whatsapp_conversations || []).find((x) => x.id === conv.whatsapp_conversation_id) || null : null;
    const cartes = c ? [c, ...fil.cartes] : fil.cartes;
    // Un contact typé (partenaire, apporteur) ou relié à une fiche partenaire : son nom se masque en entier.
    const typee = (x) => !!x && (["partenaire", "apporteur"].includes(x.type_contact) || !!x.partenaire_id);
    return {
      // Les noms du client, masqués mot par mot (sauf mots courants et mots de deux lettres).
      noms: [client && client.prenom, client && client.nom, waLue && !typee(waLue) ? waLue.nom : "", ...fil.cartes.filter((x) => x.genre === "dossier").map((x) => ((x.donnees || {}).client || {}).nom)].filter(Boolean),
      // Les partenaires, les apporteurs et les contacts typés, masqués en entier (revue de la PR 312).
      entiers: [
        // Les apporteurs et les contacts typés sont souvent des personnes (« Somchai (driver) ») : aussi mot par mot, hors mots courants.
        ...nomsApporteurAMasquer({ partenaires: etat.brut.partenaires || [], conversationWa: waLue, cartes }).map((nom) => ({ nom, personne: true })),
        ...(etat.brut.partenaires || []).map((x) => x.nom),
        // Migration 110 : plus de type « hôtel », un contact typé est une personne.
        ...(etat.brut.whatsapp_conversations || []).filter(typee).map((x) => ({ nom: x.nom, personne: true })),
      ].filter((x) => x && (typeof x === "string" || x.nom)),
    };
  }
  // Les prix connus au moment d'un « Pas bien » (demande de Jérémy, 22.11.2026), dans l'entreprise de la conversation :
  //   - ventes : catalogue (prix de vente des prestations et des trajets), prix des cartes de la conversation (dont ceux que la règle des
  //     PR 306 et 307 a déjà repris de la conversation : « donné par vous », « prix du client non corrigé »), réservations du dossier relié,
  //     et les montants tapés par la personne dans cette conversation (règle de la PR 306, même lecture montantsDuTexte, jamais un échange
  //     WhatsApp joint ni une phrase qui parle de net) ;
  //   - nets : catalogue et dossier relié, seulement avec le droit de voir les nets (« partenaires.nets ») ; sinon null, et un montant qui
  //     serait un net devient une question.
  function prixConnus() {
    const ent = entiteDuFil();
    const ventes = new Set();
    const ajouter = (set, v) => {
      const n = Number(v);
      if (n > 0) set.add(n);
    };
    for (const p of etat.brut.prestations || []) if (p.entite_id === ent) ajouter(ventes, p.prix_vente);
    for (const t of etat.brut.trajets || []) if (t.entite_id === ent) for (const k of ["prix_adulte", "prix_enfant"]) ajouter(ventes, t[k]);
    for (const c of fil.cartes) {
      const d = c.donnees || {};
      for (const sv of [...(d.services || []), d.service].filter(Boolean)) ajouter(ventes, sv.prix);
    }
    const dossierId = conv && conv.dossier_id;
    for (const r of etat.brut.reservations || []) if (dossierId && r.dossier_id === dossierId) ajouter(ventes, r.montant_vente);
    filDepuis(fil.messages, []).forEach((it, i) => {
      if (it.genre !== "personne" || echangeWhatsApp(it.texte, { depuisWhatsApp: i === 0 && !!(conv && conv.whatsapp_conversation_id) }) || /<\/?(?:conversation|question)>/.test(it.texte)) return;
      // Le résumé d'une discussion pleine remplacée : du contexte, jamais un prix accepté.
      for (const phrase of String(separerResume(it.texte).reste).split(/\n+|(?<=[.!?;])\s+/)) if (!phraseInterne(phrase)) for (const n of montantsDuTexte(phrase)) ajouter(ventes, n);
    });
    if (!(permissionsDe(ent) || []).includes("partenaires.nets")) return { ventes, nets: null };
    const nets = new Set(dossierId ? netsDuDossier(dossierId) : []);
    const services = new Set([...(etat.brut.prestations || []), ...(etat.brut.trajets || [])].filter((x) => x.entite_id === ent).map((x) => x.id));
    for (const n of etat.brut.prestations_nets || []) if (services.has(n.prestation_id)) for (const k of ["net", "net_enfant"]) ajouter(nets, n[k]);
    for (const n of etat.brut.trajets_nets || []) if (services.has(n.trajet_id)) for (const k of ["net_adulte", "net_enfant"]) ajouter(nets, n[k]);
    return { ventes, nets };
  }
  // Les nets, marges et commissions du dossier (lus seulement par qui a le droit de les voir) : une remarque qui en cite un n'est pas apprise.
  function netsDuDossier(idNoms) {
    const resas = new Set((etat.brut.reservations || []).filter((r) => r.dossier_id === idNoms).map((r) => r.id));
    const out = new Set();
    for (const l of etat.brut.reservations_nets || []) if (resas.has(l.reservation_id)) for (const [k, v] of Object.entries(l)) if (/^(?:nets?|marges?|commissions?|gains?)(?:_|$)/.test(k) && Number(v) > 0) out.add(Number(v));
    return out;
  }
  async function apresValidation(c, { dossierId = null, enregistre = null, entiteId = etat.entiteId, typeLie = null, ecran = null } = {}) {
    try {
      const id = dossierDeLaCarte(c, { dossierId });
      if (id && conv && !conv.dossier_id && lierDossierConversation(c, typeLie)) {
        const maj = await etat.store.agentMajConversation(conv.id, { dossier_id: id });
        conversations = (conversations || []).map((x) => (x.id === maj.id ? { ...x, ...maj } : x));
        conv = conversations.find((x) => x.id === maj.id) || { ...conv, ...maj };
        const tete = colonneFil.querySelector(".agent-fil-tete");
        if (tete) tete.replaceWith(enTete());
      }
      // Les noms du client à masquer : ceux du dossier de la carte, ou du dossier déjà relié à la conversation (réponse au client).
      const idNoms = id || (conv && conv.dossier_id);
      // `ecran` : ce que « Vérifier avant » a fait de chaque service (prix_saisi), pour distinguer un prix tapé d'un recalcul.
      const vu = enregistre || (c.genre === "dossier" && id ? { reservations: etat.db.reservations.filter((r) => r.dossier_id === id), ...(ecran ? { ecran } : {}) } : null);
      const lignes = correctionsDepuisCarte(c, vu, { ...nomsAMasquer(c, idNoms), nets: idNoms ? netsDuDossier(idNoms) : new Set() });
      if (lignes.length && (await etat.store.agentNoterApprentissages(entiteId, c.id, lignes))) toast(lignes.length === 1 ? tr("Correction notée : l'assistant s'en servira la prochaine fois.") : tr("{n} corrections notées : l'assistant s'en servira la prochaine fois.", { n: lignes.length }));
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

  // Carte « dossier » de l'espace unifié (migration 63) : un dossier par entreprise, chacun avec sa numérotation et ses règles (Taxi sans
  // facture, avec Booking confirmation), la même fiche client (créée dans l'entreprise active, puis utilisée dans l'autre par le partage
  // réciproque), et dossier_lie_id des deux côtés. Tout est vérifié AVANT d'écrire : un service sans entreprise, un droit manquant ou une
  // fiche qui ne peut pas passer dans l'autre entreprise arrêtent tout, rien n'est créé à moitié.
  const MOTIFS_UNIFIE = {
    entreprise_a_choisir: () => tr("Choisissez Secret ou Taxi"),
    droit_dossier: (id) => tr("Votre rôle ne permet pas de créer un dossier chez {nom}. Rien n'a été créé.", { nom: libelleEntreprise(id) }),
    droit_client: (id) => tr("Votre rôle ne permet pas de créer la fiche client chez {nom}. Rien n'a été créé.", { nom: libelleEntreprise(id) }),
    partage: (id) => tr("La fiche client ne peut pas être utilisée chez {nom} : les fiches de Secret et de Taxi ne sont pas partagées pour vous. Rien n'a été créé.", { nom: libelleEntreprise(id) }),
    aucun_service: () => tr("Aucun service à créer."),
  };
  async function validerUnifie(c) {
    const donnees = donneesCarte(c);
    const plan = planCreation({ services: donnees.services || [], activeId: etat.entiteId, permissionsDe, nouveauClient: false, partagePermis: (a, b) => partageClientsPermis(a, b) });
    if (!plan.ok) {
      const [code, id] = String(plan.motif).split(":");
      return { ok: false, motif: (MOTIFS_UNIFIE[code] || MOTIFS_UNIFIE.aucun_service)(id) };
    }
    const origine = etat.entiteId;
    const { ouvrirDemande } = await import("./demande.mjs");
    // Chaque étape se prépare dans son entreprise (catalogue, numérotation, règles), par la fiche habituelle cachée.
    const dans = async (id, fn) => {
      changerSansNaviguer(id);
      try {
        return await fn();
      } finally {
        changerSansNaviguer(origine);
      }
    };
    const sous = (e) => ({ ...c, donnees: { ...donnees, services: e.services } });
    const r = await creerDossiersLies({
      etapes: plan.etapes,
      // Passe à blanc : préparation et contrôles de chaque dossier (prix à fixer, service introuvable, numéro), rien n'est écrit.
      essayer: (e, i) => dans(e.entite_id, () => ouvrirDemande(null, preparation(sous(e)), { auto: true, essai: true, clientAVenir: i > 0, titre: c.titre })),
      creer: (e, i, clientId) => dans(e.entite_id, () => ouvrirDemande(null, preparation(sous(e)), { auto: true, titre: c.titre, surCree: () => {}, clientId })),
      // Un dossier ne passe pas : ceux déjà créés vont à la corbeille (la suppression habituelle), dans leur entreprise.
      defaire: async (crees) => {
        for (const d of crees) await dans(d.entite_id, () => supprimerLigne("dossiers", d.id));
        return true;
      },
      lier: (a, b) => lierDossiers(a, b, modifier),
    });
    if (!r.ok) {
      const motif = r.motif || tr("Rien n'a été enregistré.");
      if (!r.ecrit) return { ok: false, motif };
      const premier = r.crees[0];
      const pourquoi = motif.replace(/[.\s]+$/, "");
      return {
        ok: false,
        motif: r.defait
          ? tr("Le dossier chez {nom} n'a pas pu être créé ({motif}). Le dossier {ref} déjà créé a été mis à la corbeille : rien n'est gardé, la carte reste à valider.", { nom: libelleEntreprise(plan.etapes[r.etape].entite_id), motif: pourquoi, ref: premier.ref || "" })
          : tr("Le dossier chez {nom} n'a pas pu être créé ({motif}). Le dossier {ref} n'a pas pu être mis à la corbeille : supprimez-le depuis sa fiche avant de valider à nouveau.", { nom: libelleEntreprise(plan.etapes[r.etape].entite_id), motif: pourquoi, ref: premier.ref || "" }),
      };
    }
    const crees = r.crees;
    if (crees.length === 2) {
      if (r.lies) toast(tr("Deux dossiers liés créés : {a} et {b}.", { a: crees[0].ref || "", b: crees[1].ref || "" }));
      else toast(tr("Les deux dossiers sont créés, mais le lien entre eux n'a pas pu être posé : {a} et {b}.", { a: crees[0].ref || "", b: crees[1].ref || "" }), true);
    }
    const ici = crees.find((x) => x.entite_id === origine) || crees[0];
    return { ok: true, dossier: ici, dossiers: crees };
  }

  // Le chauffeur d'une course ajoutée par carte (22.11.2026) : appelé une fois dans l'entreprise du dossier (dansEntreprise, dansFenetre).
  const chauffeurDeLaCarte = (c) => chauffeurCarte((c.donnees || {}).service, { taxi: modeTaxi(), defaut: modeTaxi() ? partenaireDeTaxi(etat.db.partenaires, chauffeurRegle(reglages())) : null, prestations: etat.db.prestations, trajets: etat.db.trajets });
  // Le chauffeur et le règlement sur place d'une course ajoutée par carte (relecture de la PR 329 : une course de Taxi se paie au chauffeur).
  const optionsCarte = (c) => {
    const partenaireId = chauffeurDeLaCarte(c);
    const partenaire = partenaireId ? etat.db.partenaires.find((p) => p.id === partenaireId) || null : null;
    return { partenaireId, surPlace: payeSurPlaceCarte({ taxi: modeTaxi(), partenaire, modeDe: modeParDefaut }) };
  };
  // L'entreprise visée par une carte « service » (le dossier) ou « modification » (le service), quand elle n'est pas l'entreprise active.
  function entiteVisee(c) {
    const d = c.donnees || {};
    if (c.genre === "reservation") return ((etat.brut.dossiers || []).find((x) => x.id === d.dossier_id) || {}).entite_id || (d.service || {}).entite_id || null;
    if (c.genre === "modification") return ((etat.brut.reservations || []).find((x) => x.id === d.reservation_id) || {}).entite_id || d.entite_id || null;
    return null;
  }
  const refusDroit = (id) => ({ ok: false, motif: tr("Votre rôle ne permet pas de modifier un dossier chez {nom}. Rien n'a été enregistré.", { nom: libelleEntreprise(id) }) });
  // Écrire dans l'entreprise `id` le temps de `fn`, puis revenir. Refus sans rien écrire si la personne n'y écrit pas de dossiers.
  async function dansEntreprise(id, fn) {
    const origine = etat.entiteId;
    if (!id || id === origine) return fn();
    if (!permissionsDe(id).includes("dossiers.ecrire")) return refusDroit(id);
    changerEntite(id, { naviguer: false });
    try {
      return await fn();
    } finally {
      if (etat.entiteId !== origine) changerEntite(origine, { naviguer: false });
    }
  }
  // Même chose pour une fenêtre « Vérifier avant » : bascule, attend l'import du formulaire, ouvre la fenêtre et revient dans son rappel de
  // fermeture. Refus sans rien ouvrir si la personne n'écrit pas de dossiers dans l'entreprise visée.
  function dansFenetre(id, ouvrir) {
    if (id && id !== etat.entiteId && !permissionsDe(id).includes("dossiers.ecrire")) return void toast(refusDroit(id).motif, true);
    return ouvrirDansEntreprise({ id, origine: etat.entiteId, changer: changerSansNaviguer, charger: () => import("./reservations.mjs"), ouvrir });
  }

  // ---- Valider d'un geste ---------------------------------------------------------------------------------------------------------
  // Chaque genre passe par le code habituel de l'outil, sans le montrer ; un motif d'arrêt reste sur la carte. Rend true si c'est enregistré.
  async function valider(c, { seule = true } = {}) {
    motifs.delete(c.id);
    let r = { ok: false, motif: "" };
    // Un numéro de vol lu sur une pièce jointe (la fonction ne peut pas le relire) se vérifie dans la fenêtre : jamais validé d'un geste.
    const volAVerifier = (c.avertissements || []).includes("vol_piece_jointe");
    try {
      if (volAVerifier) r = { ok: false, motif: tr("Numéro de vol lu sur une pièce jointe : vérifiez-le avec « Vérifier avant ».") };
      // Plus de sièges que d'enfants et de bébés (relecture de la PR 315) : jamais validé d'un geste, Nani confirme dans la fiche.
      else if (siegesAVerifier(c)) r = { ok: false, motif: tr("Plus de sièges enfant ou bébé que d'enfants et de bébés : vérifiez avec « Vérifier avant ».") };
      // Un enfant ou un bébé sans choix des sièges (Jérémy, 22.11.2026) : jamais validé d'un geste ; la fiche, elle, exige le choix.
      else if (siegesAChoisir(c)) r = { ok: false, motif: tr("Un enfant ou un bébé voyage : child seat, baby seat ou aucun siège ? Demandez-le au client, ou choisissez avec « Vérifier avant ».") };
      // Un prix du client sous le net (revue de la PR 307) : jamais validé d'un geste.
      else if ((c.avertissements || []).includes("prix_sous_net")) r = { ok: false, motif: tr("Le prix écrit par le client est au niveau du net ou en dessous : fixez-le avec « Vérifier avant ».") };
      else if (estCourse(c)) r = !confirmationPermise() ? { ok: false, motif: tr("Une course depuis une confirmation se crée par une administratrice.") } : !ressembleAConfirmation(c.donnees.course.texte || "", { aujourdhui: aujourdhui() }) ? { ok: false, motif: tr("Ce texte n'est pas une confirmation de course : c'est une demande de client.") } : await (await import("./confirmation.mjs")).ouvrirConfirmation(c.donnees.course.texte || "", { auto: true });
      // Migration 72 : une demande du site de ce client a déjà son dossier (moins de 30 jours) ? Nani dit « Créer quand même » ou rien n'est créé.
      else if (c.genre === "dossier" && !(await (await import("./demandes-whatsapp.mjs")).accordAvantDossier(donneesCarte(c), { whatsappId: conv && conv.whatsapp_conversation_id }))) r = { ok: false, motif: tr("Aucun dossier créé.") };
      else if (c.genre === "dossier" && carteUnifiee(c.donnees)) r = await validerUnifie(c);
      else if (c.genre === "dossier") r = await (await import("./demande.mjs")).ouvrirDemande(null, preparation({ ...c, donnees: donneesCarte(c) }), { auto: true, titre: c.titre, surCree: () => {} });
      // Un service ajouté ou modifié dans un dossier de l'autre entreprise (espace unifié) : écrit dans l'entreprise du dossier visé, avec ses
      // tarifs, après contrôle du droit. Sans entreprise visée, comme avant.
      else if (c.genre === "reservation") r = await dansEntreprise(entiteVisee(c), () => enregistrerReservation(c, reservationDepuisCarte(c.donnees, optionsCarte(c)), tr("Service ajouté au dossier.")));
      else if (c.genre === "modification") {
        r = await dansEntreprise(entiteVisee(c), () => {
          const ancienne = etat.db.reservations.find((x) => x.id === c.donnees.reservation_id);
          // Les notes d'avant : une remarque retouchée s'apprend par ce qui a été ajouté (agent-apprendre.mjs).
          return ancienne ? enregistrerReservation(c, reservationModifiee(ancienne, c.donnees), tr("Service modifié."), ancienne).then((x) => (x && x.ok ? { ...x, notesAvant: String(ancienne.notes || "") } : x)) : { ok: false, motif: tr("Ce service n'existe plus.") };
        });
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
    if (dossier) resultats.set(c.id, { dossier, course: r.fait || null, dossiers: r.dossiers || null });
    // Le contact WhatsApp lié, relu en base (revue PR 298) : l'apporteur ne se pose que s'il est toujours de type « apporteur ».
    const typeLie = await typeContactLie();
    if (dossier && c.genre === "dossier" && !estCourse(c) && c.donnees && c.donnees.apporteur) {
      if (typeLie === "apporteur") await noterApporteur(c.donnees.apporteur, r.dossiers || [dossier]);
      else toast(tr("Dossier créé sans apporteur : le contact WhatsApp n'est plus noté comme apporteur."));
    }
    if (dossier && c.genre === "dossier") await relierWhatsApp(dossier);
    // Migration 72 : la demande du site « nouvelle » du même numéro passe « confirmée » avec ce dossier (views/demandes-whatsapp.mjs).
    if (dossier && c.genre === "dossier") await (await import("./demandes-whatsapp.mjs")).relierDemandesApresDossier(r.dossiers || [dossier]);
    if (r.fait) blocBooking = (await import("./confirmation.mjs")).blocBookingConfirmation;
    const res = r.reservation || null;
    // Espace unifié : chaque dossier créé garde ses apprentissages dans son entreprise, avec seulement ses services.
    if (r.dossiers && c.genre === "dossier" && carteUnifiee(c.donnees)) {
      const donnees = donneesCarte(c);
      const origine = etat.entiteId;
      for (const d of [dossier, ...r.dossiers.filter((x) => x !== dossier)]) {
        changerSansNaviguer(d.entite_id);
        try {
          await apresValidation(carteDeLEntreprise(c, donnees, d.entite_id), { dossierId: d.id, entiteId: d.entite_id, typeLie });
        } finally {
          changerSansNaviguer(origine);
        }
      }
    } else await apresValidation(c, { dossierId: (dossier && dossier.id) || (res && res.dossier_id) || null, enregistre: res ? { reservation: res, ...(typeof r.notesAvant === "string" ? { notesAvant: r.notesAvant } : {}) } : null, ecran: Array.isArray(r.ecran) ? r.ecran : null, typeLie });
    await decider(c, "validee");
  }

  // Le type du contact de la conversation WhatsApp liée, relu en base : null sans liaison, illisible ou sans type.
  async function typeContactLie() {
    const waId = conv && conv.whatsapp_conversation_id;
    if (!waId || !etat.store.whatsappConversation) return null;
    try {
      const wc = await etat.store.whatsappConversation(waId);
      return apporteurConfirme(wc) ? "apporteur" : (wc && wc.type_contact) || null;
    } catch (err) {
      console.error("agent : type du contact WhatsApp", err);
      return null;
    }
  }
  // Carte d'un apporteur (PR D) : chaque dossier créé reçoit la fiche apporteur de sa propre entreprise (apporteurs-calc.mjs, poseApporteur),
  // après sa création. Un refus de la base (controler_apporteur_dossier, droits) laisse le dossier créé, sans apporteur : un message discret,
  // jamais la corbeille.
  async function noterApporteur(apporteur, dossiers) {
    for (const { dossier, apporteur_id } of poseApporteur(apporteur, dossiers, etat.brut.partenaires || [])) {
      try {
        await modifier("dossiers", dossier.id, { apporteur_id });
      } catch (err) {
        console.error("agent : apporteur du dossier", err);
        toast(tr("Dossier {ref} créé sans apporteur : {message}", { ref: dossier.ref || "", message: err.message }));
      }
    }
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
    // Migration 72 : même accord qu'à la validation d'un geste avant un second dossier pour ce client.
    if (!(await (await import("./demandes-whatsapp.mjs")).accordAvantDossier(donneesCarte(c), { whatsappId: conv && conv.whatsapp_conversation_id }))) return;
    // Les entreprises corrigées d'un tap comptent aussi dans la fenêtre.
    const vue = { ...c, donnees: donneesCarte(c) };
    // `services` : ce que l'écran a fait de chaque service (prix tapé à la place de celui du catalogue), pour les apprentissages.
    (await import("./demande.mjs")).ouvrirDemande(null, preparation(vue), { titre: c.titre, surCree: ({ dossier, services }) => noterReussite(c, { ok: true, dossier, ecran: services }) });
  }
  async function ouvrirCourse(c) {
    // Même règle que la validation d'un geste (et que l'ancien écran) : une course depuis une confirmation se crée par une administratrice.
    if (!confirmationPermise()) return toast(tr("Une course depuis une confirmation se crée par une administratrice."), true);
    (await import("./confirmation.mjs")).ouvrirConfirmation(c.donnees.course.texte || "", { surCree: (fait) => noterReussite(c, { ok: true, fait }) });
  }
  function ouvrirReservation(c) {
    return dansFenetre(entiteVisee(c), ({ formulaireReservation }, revenir) => {
      // « Annuler » rend null : la carte reste à valider. La fermeture ramène dans l'entreprise de la conversation.
      const ferme = modal(tr("Nouvelle réservation"), formulaireReservation(reservationDepuisCarte(c.donnees, optionsCarte(c)), async (res) => {
        ferme();
        if (!res) return;
        toast(tr("Service ajouté au dossier."));
        await noterReussite(c, { ok: true, reservation: res });
      }), { ferme: revenir });
      return true;
    });
  }
  function ouvrirModification(c) {
    return dansFenetre(entiteVisee(c), ({ formulaireReservation }, revenir) => {
      const r = etat.db.reservations.find((x) => x.id === c.donnees.reservation_id);
      if (!r) return void toast(tr("Ce service n'existe plus."), true), false;
      // La base de la fusion est la ligne d'origine (relecture de la PR 315) : une modification concurrente n'efface pas le changement proposé.
      const ferme = modal(tr("Modifier la réservation"), formulaireReservation(reservationModifiee(r, c.donnees), async (res) => {
        ferme();
        if (!res) return;
        toast(tr("Service modifié."));
        await noterReussite(c, { ok: true, reservation: { ...res, dossier_id: res.dossier_id || r.dossier_id }, notesAvant: String(r.notes || "") });
      }, { base: r }), { ferme: revenir });
      return true;
    });
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
      const form = formulaireReservation(valeurs, (res) => terminer(res ? (toast(message), { ok: true, reservation: { ...res, dossier_id: res.dossier_id || (ancienne && ancienne.dossier_id) || valeurs.dossier_id } }) : { ok: false, motif: tr("Rien n'a été enregistré.") }), { base: ancienne || valeurs });
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
