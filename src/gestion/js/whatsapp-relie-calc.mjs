// Assistant et WhatsApp reliés (PR B, 21.11.2026) : la logique pure de l'écran, sans IA ni dépendance au navigateur.
//   - « Demander à l'assistant » depuis une conversation : la conversation de l'Assistant déjà liée à rouvrir, les questions rapides ;
//   - « Aller au message » : l'adresse #/whatsapp?c=…&m=… lue et contrôlée ;
//   - la vue « À faire » de l'écran WhatsApp : les données de l'écran passées au calcul de la PR A (agent-whatsapp-lecture.mjs, aFaireWhatsApp),
//     le même que l'outil a_faire_whatsapp de l'Assistant, puis chaque ligne mise en mots ;
//   - la recherche de Gestion : les messages rendus par whatsapp_rechercher (migration 67) mis en résultats « WhatsApp ».
// Règles tenues ici : un contact réglé sur « jamais » (contact personnel) n'apparaît ni dans « À faire » ni dans la recherche ; un lien vient
// toujours de lienWhatsApp (identifiants contrôlés), jamais d'un texte libre. Testé par tests/gestion-assistant-whatsapp-ecran.test.js.
import { N_ } from "./i18n.mjs";
import { aFaireWhatsApp, contactPersonnel, extraitAutour, lienWhatsApp, MARQUE_PROMESSE, sansAccents } from "./agent-whatsapp-lecture.mjs";
import { nomConversation, reponsesDe } from "./whatsapp-calc.mjs";
import { demandeAgent, demandeRecente } from "./whatsapp-suivi-calc.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const estUuid = (x) => typeof x === "string" && UUID.test(x);

// ---- Demander à l'assistant ---------------------------------------------------------------------------------------------------------
// Les questions rapides proposées dans l'Assistant ouvert depuis une conversation, et la question de la vue « À faire ».
export const QUESTIONS_RAPIDES = [N_("Qu'y a-t-il à faire ?"), N_("Résume"), N_("Prépare les dossiers")];
export const QUESTION_A_FAIRE_BOITE = N_("Qu'y a-t-il à faire dans WhatsApp ?");
// Les questions rapides proposées : sans « Prépare les dossiers » en lecture seule (la fonction n'y proposerait aucune carte).
export const questionsProposees = (demande) => QUESTIONS_RAPIDES.filter((q) => !(demande && demande.lecture_seule && q === QUESTIONS_RAPIDES[2]));
export const QUESTION_MAX = 2000;
// La question de la vue « À faire » passe à l'Assistant par sessionStorage et part au clic, dans une nouvelle conversation.
export const CLE_QUESTION_AGENT = "gestion-agent-question";
// Le bouton n'existe pas pour un contact personnel : rien de lui ne part chez l'IA.
export const demandePermise = (conv) => !!conv && estUuid(conv.id) && reponsesDe(conv) !== "jamais";
// La conversation de l'Assistant déjà liée à cette conversation WhatsApp (migration 61), la plus récente qui est ouverte (`agent` : celles
// de la personne dans l'entreprise, store.agentConversations). Une seule discussion par conversation WhatsApp (règle de Jérémy du
// 22.11.2026) : « Demander à l'assistant », « Créer le dossier », « Mettre à jour le dossier » et « Prêt à réserver »
// la rouvrent tous. Archivée, elle ne se rouvre pas ; sans conversation ouverte, une nouvelle se crée au premier envoi.
export function conversationLiee(agent = [], whatsappId = "") {
  if (!estUuid(whatsappId)) return null;
  const liees = (agent || []).filter((c) => c && c.whatsapp_conversation_id === whatsappId && c.statut !== "archivee" && !!c.id);
  liees.sort((a, b) => String(b.maj_le || "").localeCompare(String(a.maj_le || "")));
  return liees[0] || null;
}

// Ce que l'Assistant fait de la demande déposée par l'écran WhatsApp (sessionStorage, déjà retirée par l'appelant). Revue de sécurité de la
// PR 297 : seulement une demande de moins de deux minutes, pour l'entreprise ouverte, et qui correspond à la conversation ouverte :
//   - une question (« Demander à l'assistant »), « Créer le dossier » ou « Mettre à jour le dossier » : dans la conversation de l'Assistant
//     désignée par l'écran, liée à la même conversation WhatsApp, ou dans une nouvelle conversation si l'écran n'en a désigné aucune
//     (une seule discussion par conversation WhatsApp, 22.11.2026).
// Rend { question }, { dossier } ou null.
export function demandeAOuvrir(brut, { conv = null, entiteId = "", maintenant = Date.now() } = {}) {
  if (!brut || !demandeRecente(brut, maintenant)) return null;
  const w = demandeAgent(brut);
  if (!w || (w.entite_id && w.entite_id !== entiteId)) return null;
  const ok = conv ? !!conv.id && w.agent_conversation_id === conv.id && conv.whatsapp_conversation_id === w.whatsapp_conversation_id : !w.agent_conversation_id;
  if (!ok) return null;
  return w.whatsapp_mode === "question" ? { question: w } : { dossier: w };
}
// La question de la vue « À faire » (CLE_QUESTION_AGENT) : datée elle aussi, pour l'entreprise ouverte. Rend le texte ou "".
export function questionBoiteAOuvrir(brut, { entiteId = "", maintenant = Date.now() } = {}) {
  if (!brut || !demandeRecente(brut, maintenant)) return "";
  let q = null;
  try {
    q = JSON.parse(brut);
  } catch {
    return "";
  }
  if (!q || typeof q.texte !== "string" || !q.texte.trim() || (q.entite && q.entite !== entiteId)) return "";
  return q.texte.trim().slice(0, QUESTION_MAX);
}

// ---- Aller au message ---------------------------------------------------------------------------------------------------------------
// Le message à montrer : seulement un identifiant bien formé (lireAdresse rend la valeur brute de `m`).
export const messageCible = (adresse = {}) => (estUuid(adresse.message) ? adresse.message : "");
// Le message est-il dans le fil chargé ? Sinon l'écran relit plus loin dans le temps (store.whatsappMessages, `inclure`).
export const messagePresent = (messages = [], id = "") => !!id && (messages || []).some((m) => m && m.id === id);
export const SURBRILLANCE_MS = 2000;
// La fenêtre lue autour d'un message plus ancien que les 500 derniers : 100 messages avant, 100 après.
export const FENETRE_MESSAGE = 100;
// Les derniers messages et la fenêtre autour du message cité, sans doublon, dans l'ordre d'envoi.
export function fusionnerFenetre(derniers = [], fenetre = []) {
  const vus = new Map();
  for (const m of [...(fenetre || []), ...(derniers || [])]) if (m && m.id && !vus.has(m.id)) vus.set(m.id, m);
  return [...vus.values()].sort((a, b) => String(a.envoye_le || "").localeCompare(String(b.envoye_le || "")));
}

// ---- Vue « À faire » -----------------------------------------------------------------------------------------------------------------
// Les données de l'écran (etat.brut : déjà lues avec les droits de la personne, RLS des migrations 58 et 63) au format de aFaireWhatsApp.
// `resumeDe(dossier)` : { total, recu, devise } ; `finances(entiteId)` : la personne voit-elle les montants de cette entreprise.
// `entites` : celles de la boîte (Secret et Taxi) où la personne lit WhatsApp.
export function donneesAFaire(brut = {}, { entites = [], resumeDe = (d) => d, finances = () => false } = {}) {
  const ids = new Set(entites.map((e) => e.id));
  const conversations = (brut.whatsapp_conversations || []).filter(Boolean);
  const reliees = new Set(conversations.filter((c) => !contactPersonnel(c) && c.dossier_id).map((c) => c.dossier_id));
  const dossiers = (brut.dossiers || []).filter((d) => d && reliees.has(d.id));
  const reservations = (brut.reservations || []).filter((r) => r && reliees.has(r.dossier_id) && r.statut !== "annule");
  const sert = (table, cle) => (brut[table] || []).filter((x) => x && reservations.some((r) => r[cle] === x.id));
  return {
    conversations,
    taches: (brut.taches || []).filter((t) => t && !t.fait && t.description === MARQUE_PROMESSE && ids.has(t.entite_id)),
    paiements: (brut.paiements || []).filter((p) => p && reliees.has(p.dossier_id)),
    resumes: dossiers.filter((d) => finances(d.entite_id)).map((d) => {
      const r = resumeDe(d) || {};
      return { dossier_id: d.id, total: Number(r.total) || 0, recu: Number(r.recu) || 0, devise: r.devise || null };
    }),
    reservations,
    trajets: sert("trajets", "trajet_id"),
    prestations: sert("prestations", "prestation_id"),
    dossiers,
    clients: (brut.clients || []).filter((c) => c && conversations.some((v) => v.client_id === c.id)),
    entites: entites.map((e) => ({ id: e.id, slug: e.slug })),
  };
}
// `typeContact(conv)` : le type du contact (« apporteur ») quand les contacts typés existeront (PR C, migration 68). D'ici là il ne rend rien
// et l'emplacement « Nouveau client d'un apporteur » reste vide.
export const aFaireEcran = (donnees, { maintenant = Date.now(), typeContact = () => null } = {}) => aFaireWhatsApp(donnees, { maintenant, typeContact });

export const GENRES_A_FAIRE = {
  promesse: N_("Promesse échue"),
  client_attend: N_("Attend une réponse"),
  apporteur: N_("Nouveau client d'un apporteur"),
  ferry_non_paye: N_("Ferry non payé"),
  paiement_signale: N_("Paiement signalé"),
};
// Ce que la ligne dit, en textes à traduire : [{ texte, vars }]. Les montants et les dates arrivent formatés par l'écran (`montant`, `jour`).
export function detailAFaire(x, { montant = (n, d) => `${n}${d ? ` ${d}` : ""}`, jour = (iso) => iso } = {}) {
  if (!x) return [];
  if (x.genre === "client_attend" || x.genre === "apporteur") return [{ texte: N_("depuis {duree}"), vars: { duree: x.attente || "" } }];
  if (x.genre === "promesse")
    return [
      { texte: x.quoi || "", brut: true },
      { texte: x.retard_jours > 1 ? N_("échéance {date}, {n} jours de retard") : N_("échéance {date}, hier"), vars: { date: jour(x.echeance), n: x.retard_jours } },
    ];
  if (x.genre === "paiement_signale") return [{ texte: /photo|PDF/.test(x.quoi || "") ? N_("Photo ou PDF à vérifier") : N_("Le client dit avoir payé") }];
  if (x.genre === "ferry_non_paye") {
    const quand = x.dans_jours === 0 ? N_("bateau aujourd'hui") : x.dans_jours === 1 ? N_("bateau demain") : Number.isInteger(x.dans_jours) ? N_("bateau dans {n} jours") : null;
    return [{ texte: N_("solde {montant}"), vars: { montant: montant(x.solde_du, x.devise) } }, ...(quand ? [{ texte: quand, vars: { n: x.dans_jours } }] : [])];
  }
  return [];
}

// ---- Recherche de Gestion --------------------------------------------------------------------------------------------------------------
export const RECHERCHE_DELAI_MS = 300;
export const RECHERCHE_MIN = 2;
export const RECHERCHE_MAX = 8;
export const PAR_CONVERSATION_MAX = 3;
export const rechercheValable = (q) => String(q || "").trim().length >= RECHERCHE_MIN;
// Une ligne de la palette : le mot cherché tombe dans le premier tiers, visible aussi à 390 px.
export const EXTRAIT_MAX = 72;
// Les mots cherchés, sans accents ni ponctuation, deux lettres au moins.
export const motsCherches = (q = "") => sansAccents(q).split(/\s+/).map((m) => m.replace(/[^\p{L}\p{N}]+/gu, "")).filter((m) => m.length >= RECHERCHE_MIN).slice(0, 6);
// L'extrait découpé pour l'affichage, chaque mot qui commence par un mot cherché marqué « trouve » : [{ texte, trouve }]. Sans délimiteur
// venu de la base (whatsapp_rechercher rend le texte entier, la revue de sécurité de la PR 295) : le surlignage se fait ici, sur l'extrait
// déjà masqué par extraitAutour (agent-whatsapp-lecture.mjs).
export function morceauxSurlignes(extrait = "", q = "") {
  const t = String(extrait || "");
  const mots = motsCherches(q);
  if (!mots.length || !t) return t ? [{ texte: t, trouve: false }] : [];
  const out = [];
  // Les jetons (lettres et chiffres) et ce qui les sépare, dans l'ordre : un jeton trouvé si sa forme sans accents commence par un mot.
  for (const m of t.matchAll(/([\p{L}\p{N}]+)|([^\p{L}\p{N}]+)/gu)) {
    const trouve = !!m[1] && mots.some((x) => sansAccents(m[1]).startsWith(x));
    const dernier = out[out.length - 1];
    if (dernier && dernier.trouve === trouve && !trouve) dernier.texte += m[0];
    else out.push({ texte: m[0], trouve });
  }
  return out;
}
// Les messages trouvés (whatsapp_rechercher : conversation_id, message_id, extrait, envoye_le) mis en résultats : seulement les conversations
// de la boîte chargée pour la personne (`conversations`, mêmes droits que l'écran), jamais un contact personnel, trois messages au plus par
// conversation, huit en tout, du plus récent au plus ancien. Chaque résultat ouvre la conversation au message.
export function resultatsRechercheWhatsApp(trouves = [], { conversations = [], clients = [], q = "" } = {}) {
  const convs = new Map((conversations || []).filter((c) => c && estUuid(c.id) && !contactPersonnel(c)).map((c) => [c.id, c]));
  const fiches = new Map((clients || []).filter(Boolean).map((c) => [c.id, c]));
  const parConv = new Map();
  const out = [];
  const tries = [...(trouves || [])].filter(Boolean).sort((a, b) => String(b.envoye_le || "").localeCompare(String(a.envoye_le || "")));
  for (const t of tries) {
    const c = convs.get(t.conversation_id);
    if (!c || !estUuid(t.message_id) || out.length >= RECHERCHE_MAX) continue;
    const n = parConv.get(c.id) || 0;
    if (n >= PAR_CONVERSATION_MAX) continue;
    parConv.set(c.id, n + 1);
    out.push({
      conversation: c.id,
      message: t.message_id,
      nom: nomConversation(c, c.client_id ? fiches.get(c.client_id) || null : null),
      entite_id: c.entite_id || null,
      // Masqué d'abord (numéros, comptes, IBAN), puis coupé autour du premier mot cherché.
      extrait: extraitAutour(t.extrait, motsCherches(q), EXTRAIT_MAX),
      le: t.envoye_le || null,
      lien: lienWhatsApp({ conversation: c.id, message: t.message_id, entite: c.entite_id || "" }),
    });
  }
  return out;
}

// ---- Retour dans l'entreprise d'origine (relecture de la PR 355) ------------------------------------------------------------------------
// L'Assistant d'une conversation Secret ouvert depuis Taxi fait passer l'application chez Secret. Au retour sur la même conversation, on
// revient chez Taxi. `brut` : ce que l'écran WhatsApp a rangé ({ conversation, entite, le }) ; rend l'entreprise à rétablir, ou "".
// Seulement pour la même conversation, dans les quinze minutes, vers une entreprise encore accessible et différente de l'active.
export const CLE_RETOUR_ENTITE = "gestion-wa-retour-entite";
// Quinze minutes (contre-relecture de la PR 355) : au-delà, une notification qui ouvre la conversation garde l'entreprise qu'elle désigne.
export const RETOUR_ENTITE_MS = 15 * 60 * 1000;
export function entiteDeRetour(brut, { conversation = "", active = "", accessibles = [], maintenant = Date.now() } = {}) {
  let d = null;
  try {
    d = typeof brut === "string" ? JSON.parse(brut) : brut;
  } catch {
    return "";
  }
  if (!d || !estUuid(d.conversation) || !estUuid(d.entite) || d.conversation !== conversation) return "";
  if (!(Number(d.le) > 0) || maintenant - Number(d.le) > RETOUR_ENTITE_MS || maintenant < Number(d.le)) return "";
  if (d.entite === active || !accessibles.includes(d.entite)) return "";
  return d.entite;
}

// L'entreprise à afficher avant de construire l'écran (app.mjs, afficher), contre-relecture de la PR 355 :
//   - retour de l'Assistant d'une autre entreprise sur la même conversation WhatsApp (entiteDeRetour) : il passe avant « ?entite= » de
//     l'adresse (le lien « Voir la conversation » de l'Assistant porte l'entreprise de la conversation), et « entite » est retiré de
//     l'adresse : un redessin (nouveau message) ne rebascule plus ;
//   - sinon « ?entite= » d'une notification, si la personne y a accès.
// `retourBrut` : ce que l'écran WhatsApp a rangé (CLE_RETOUR_ENTITE). Rend { entite, adresse, consommer } : `entite` à activer ("" : rien
// à changer), `adresse` à mettre à la place de l'adresse courante ("" : inchangée), `consommer` : la mémoire du retour est à effacer.
export function entrepriseAAfficher({ hash = "", active = "", accessibles = [], retourBrut = null, maintenant = Date.now() } = {}) {
  const [chemin, requete = ""] = String(hash).split("?");
  const params = new URLSearchParams(requete);
  const surWhatsApp = /^#\/whatsapp$/.test(chemin);
  // La mémoire ne sert qu'une fois : toute visite de WhatsApp l'efface, qu'elle serve ou non.
  const consommer = surWhatsApp && !!retourBrut;
  const retour = surWhatsApp && retourBrut ? entiteDeRetour(retourBrut, { conversation: params.get("c") || "", active, accessibles, maintenant }) : "";
  if (retour) {
    params.delete("entite");
    const reste = params.toString();
    return { entite: retour, adresse: `${chemin}${reste ? `?${reste}` : ""}`, consommer };
  }
  const demandee = params.get("entite") || "";
  const entite = demandee && demandee !== active && accessibles.includes(demandee) ? demandee : "";
  return { entite, adresse: "", consommer };
}
