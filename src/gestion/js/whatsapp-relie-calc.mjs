// Assistant et WhatsApp reliés (PR B, 21.11.2026) : la logique pure de l'écran, sans IA ni dépendance au navigateur.
//   - « Demander à l'assistant » depuis une conversation : la conversation de l'Assistant déjà liée à rouvrir, les questions rapides ;
//   - « Aller au message » : l'adresse #/whatsapp?c=…&m=… lue et contrôlée ;
//   - la vue « À faire » de l'écran WhatsApp : les données de l'écran passées au calcul de la PR A (agent-whatsapp-lecture.mjs, aFaireWhatsApp),
//     le même que l'outil a_faire_whatsapp de l'Assistant, puis chaque ligne mise en mots ;
//   - la recherche de Gestion : les messages rendus par whatsapp_rechercher (migration 67) mis en résultats « WhatsApp ».
// Règles tenues ici : un contact réglé sur « jamais » (contact personnel) n'apparaît ni dans « À faire » ni dans la recherche ; un lien vient
// toujours de lienWhatsApp (identifiants contrôlés), jamais d'un texte libre. Testé par tests/gestion-assistant-whatsapp-ecran.test.js.
import { N_ } from "./i18n.mjs";
import { aFaireWhatsApp, contactPersonnel, lienWhatsApp, MARQUE_PROMESSE, sansAccents } from "./agent-whatsapp-lecture.mjs";
import { nomConversation, reponsesDe } from "./whatsapp-calc.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const estUuid = (x) => typeof x === "string" && UUID.test(x);

// ---- Demander à l'assistant ---------------------------------------------------------------------------------------------------------
// Les questions rapides proposées dans l'Assistant ouvert depuis une conversation, et la question de la vue « À faire ».
export const QUESTIONS_RAPIDES = [N_("Qu'y a-t-il à faire ?"), N_("Résume"), N_("Prépare les dossiers")];
export const QUESTION_A_FAIRE_BOITE = N_("Qu'y a-t-il à faire dans WhatsApp ?");
export const QUESTION_MAX = 2000;
// La question de la vue « À faire » passe à l'Assistant par sessionStorage et part au clic, dans une nouvelle conversation.
export const CLE_QUESTION_AGENT = "gestion-agent-question";
// Le bouton n'existe pas pour un contact personnel : rien de lui ne part chez l'IA.
export const demandePermise = (conv) => !!conv && estUuid(conv.id) && reponsesDe(conv) !== "jamais";
// La conversation de l'Assistant déjà liée à cette conversation WhatsApp (migration 61), la plus récente, archivée ou non (`agent` : celles
// de la personne dans l'entreprise, store.agentConversations). Sans elle, une nouvelle conversation se crée au premier envoi.
export function conversationLiee(agent = [], whatsappId = "") {
  if (!estUuid(whatsappId)) return null;
  const liees = (agent || []).filter((c) => c && c.whatsapp_conversation_id === whatsappId);
  liees.sort((a, b) => Number(a.statut === "archivee") - Number(b.statut === "archivee") || String(b.maj_le || "").localeCompare(String(a.maj_le || "")));
  return liees[0] || null;
}

// ---- Aller au message ---------------------------------------------------------------------------------------------------------------
// Le message à montrer : seulement un identifiant bien formé (lireAdresse rend la valeur brute de `m`).
export const messageCible = (adresse = {}) => (estUuid(adresse.message) ? adresse.message : "");
// Le message est-il dans le fil chargé ? Sinon l'écran relit plus loin dans le temps (store.whatsappMessages, `inclure`).
export const messagePresent = (messages = [], id = "") => !!id && (messages || []).some((m) => m && m.id === id);
export const SURBRILLANCE_MS = 2000;

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
// L'extrait centré sur le premier mot trouvé, ce mot entre « et » (comme ts_headline de whatsapp_rechercher). Un extrait déjà marqué par la
// base est seulement raccourci.
export function extraitAutour(texte = "", q = "", n = 110) {
  const t = String(texte || "").replace(/\s+/g, " ").trim();
  if (/«[^»]+»/.test(t)) return t.length > n + 20 ? `${t.slice(0, n + 19)}…` : t;
  const mots = sansAccents(q).split(/\s+/).map((m) => m.replace(/[^\p{L}\p{N}]+/gu, "")).filter((m) => m.length >= RECHERCHE_MIN);
  const plat = sansAccents(t);
  // sansAccents garde la longueur d'un texte en caractères composés : les positions valent pour le texte d'origine.
  const memeLongueur = plat.length === t.length;
  let i = -1;
  let long = 0;
  for (const m of mots) {
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "u");
    const r = re.exec(plat);
    if (r && memeLongueur && (i < 0 || r.index < i)) {
      i = r.index + r[0].length - r[1].length;
      const fin = /[^\p{L}\p{N}]/u.exec(plat.slice(i));
      long = fin ? fin.index : plat.length - i;
    }
  }
  if (i < 0) return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  let debut = Math.max(0, i - Math.floor((n - long) / 3));
  // Commencer au début d'un mot.
  const espace = debut > 0 ? t.slice(debut, i).search(/\s/) : -1;
  if (espace >= 0) debut += espace + 1;
  const finX = Math.min(t.length, debut + n);
  return `${debut > 0 ? "…" : ""}${t.slice(debut, i)}«${t.slice(i, i + long)}»${t.slice(i + long, finX)}${finX < t.length ? "…" : ""}`;
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
      extrait: extraitAutour(t.extrait, q),
      le: t.envoye_le || null,
      lien: lienWhatsApp({ conversation: c.id, message: t.message_id, entite: c.entite_id || "" }),
    });
  }
  return out;
}
