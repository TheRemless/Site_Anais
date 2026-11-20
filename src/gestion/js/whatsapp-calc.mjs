// Boîte WhatsApp de Gestion (migrations 58 et 59, 20.11.2026) : le numéro de Nani, un seul pour Secret Travel & Tour et VIP Taxi Lanta.
// Nani répond surtout depuis son app WhatsApp Business. L'écran sert à lire, à ranger la conversation dans la bonne entreprise et à copier
// la réponse préparée par l'agent, puis à ouvrir la conversation dans WhatsApp. L'envoi depuis Gestion existe mais reste secondaire.
// Logique pure, testée par tests/gestion-whatsapp-boite.test.js.
import { N_ } from "./i18n.mjs";
import { numeroAffiche } from "./demandes-site-calc.mjs";

export { numeroAffiche };

// Tables suivies en direct (Supabase Realtime, migrations 58 et 59), sur un canal à part de celui des demandes du site.
export const TABLES_WHATSAPP = ["whatsapp_conversations", "whatsapp_messages", "whatsapp_propositions"];

// Entreprises du numéro : la base ne connaît que les slugs « secret » et « taxi » (whatsapp_admin). La démonstration appelle Secret « excursions ».
const MARQUES = { secret: "secret", excursions: "secret", taxi: "taxi" };
export const marqueEntite = (e) => (e && MARQUES[e.slug]) || null;

// Qui lit la boîte : un administrateur de Secret ou de Taxi (réglages et toute l'entreprise), ou le super admin. Mook n'a pas « reglages.ecrire ».
export const lecteurWhatsApp = ({ entite, superAdmin = false, permissions = [], voitTout = false, voucherSeul = false } = {}) =>
  !!marqueEntite(entite) && !voucherSeul && (superAdmin || (permissions.includes("reglages.ecrire") && voitTout));

// ---- Fenêtre de 24 h ------------------------------------------------------------------------------------------------------------
// WhatsApp n'accepte un message libre d'une entreprise que dans les 24 h qui suivent le dernier message du client.
export const FENETRE_MS = 24 * 3600 * 1000;
export function dernierEntrant(messages = []) {
  let dernier = null;
  for (const m of messages) if (m && m.sens === "entrant" && m.envoye_le && (!dernier || Date.parse(m.envoye_le) > Date.parse(dernier))) dernier = m.envoye_le;
  return dernier;
}
export function fenetre(messages = [], maintenant = Date.now()) {
  const depuis = dernierEntrant(messages);
  if (!depuis) return { ouverte: false, reste_ms: 0, depuis: null };
  const reste = Date.parse(depuis) + FENETRE_MS - maintenant;
  return { ouverte: reste > 0, reste_ms: Math.max(0, reste), depuis };
}
// L'envoi depuis Gestion : une proposition non vide, la fenêtre ouverte. `raison` dit pourquoi le bouton est éteint.
export function envoiPossible({ texte = "", fenetre: f = null } = {}) {
  if (!String(texte || "").trim()) return { ok: false, raison: "vide" };
  if (!f || !f.ouverte) return { ok: false, raison: "fenetre_fermee" };
  return { ok: true, raison: null };
}

// ---- Numéro et lien ---------------------------------------------------------------------------------------------------------------
export const chiffres = (tel) => String(tel || "").replace(/\D/g, "");
// Ouvre la conversation du client dans WhatsApp (app de Nani sur téléphone, WhatsApp Web sur ordinateur). Le texte se colle à la main.
export const lienWhatsApp = (tel) => (chiffres(tel).length >= 7 ? `https://wa.me/${chiffres(tel)}` : null);

// Nom affiché : le client relié d'abord (fiche de Gestion), sinon le nom du profil WhatsApp, sinon le numéro.
export function nomConversation(conv, client = null) {
  const nomClient = client ? [client.prenom, client.nom].filter(Boolean).join(" ").trim() : "";
  return nomClient || (conv && conv.nom ? String(conv.nom).trim() : "") || numeroAffiche((conv && conv.telephone) || "");
}

// ---- Propositions -----------------------------------------------------------------------------------------------------------------
// La proposition courante d'une conversation : la plus récente, une « remplacee » ne compte jamais.
export function propositionsCourantes(propositions = []) {
  const par = new Map();
  for (const p of propositions) {
    if (!p || p.statut === "remplacee") continue;
    const avant = par.get(p.conversation_id);
    if (!avant || Date.parse(p.cree_le) > Date.parse(avant.cree_le)) par.set(p.conversation_id, p);
  }
  return par;
}
export const propositionCourante = (propositions, conversationId) => propositionsCourantes((propositions || []).filter((p) => p && p.conversation_id === conversationId)).get(conversationId) || null;

// Une conversation demande quelque chose : des messages non lus, ou une réponse prête à copier.
export const aTraiter = (conv, prop) => !!conv && ((Number(conv.non_lus) || 0) > 0 || (!!prop && prop.statut === "a_faire"));
// Badge du menu : le nombre de conversations qui demandent quelque chose.
export function badgeWhatsApp(conversations = [], propositions = []) {
  const props = propositionsCourantes(propositions);
  return conversations.filter((c) => aTraiter(c, props.get(c.id))).length;
}

// ---- Liste ------------------------------------------------------------------------------------------------------------------------
export const FILTRES = [
  { valeur: "a_trier", libelle: N_("À trier") },
  { valeur: "secret", libelle: N_("Secret") },
  { valeur: "taxi", libelle: N_("Taxi") },
  { valeur: "toutes", libelle: N_("Toutes") },
];
// La plus récente en haut ; sans message (conversation neuve) en bas, par date de création.
export function trierConversations(conversations = []) {
  const t = (c) => Date.parse(c.dernier_message_le || "") || 0;
  return [...conversations].sort((a, b) => t(b) - t(a) || (Date.parse(b.created_at || "") || 0) - (Date.parse(a.created_at || "") || 0));
}
// `marqueDe(entite_id)` : « secret », « taxi » ou null. Une conversation rangée dans une entreprise inconnue reste dans « Toutes ».
export function filtrerConversations(conversations = [], filtre = "toutes", marqueDe = () => null) {
  if (filtre === "a_trier") return conversations.filter((c) => !c.entite_id);
  if (filtre === "secret" || filtre === "taxi") return conversations.filter((c) => c.entite_id && marqueDe(c.entite_id) === filtre);
  return conversations;
}
// Le chiffre de chaque filtre : toutes les conversations à trier (chacune attend un tap), ailleurs celles qui demandent quelque chose.
export function chiffresFiltres(conversations = [], propositions = [], marqueDe = () => null) {
  const props = propositionsCourantes(propositions);
  const compte = (liste) => liste.filter((c) => aTraiter(c, props.get(c.id))).length;
  return {
    a_trier: filtrerConversations(conversations, "a_trier", marqueDe).length,
    secret: compte(filtrerConversations(conversations, "secret", marqueDe)),
    taxi: compte(filtrerConversations(conversations, "taxi", marqueDe)),
    toutes: compte(conversations),
  };
}
// Filtre de départ : « À trier » s'il y a quelque chose à ranger, sinon toutes.
export const filtreDeDepart = (conversations = []) => (conversations.some((c) => !c.entite_id) ? "a_trier" : "toutes");

// Ligne d'état sous le nom dans la liste.
export function etatConversation(conv, prop) {
  if (prop && prop.statut === "a_faire") return { cle: "prete", libelle: N_("Réponse prête") };
  if (prop && prop.statut === "en_cours") return { cle: "en_cours", libelle: N_("Réponse en préparation") };
  if (prop && prop.statut === "echec") return { cle: "echec", libelle: N_("Pas de réponse préparée") };
  if (conv && conv.dernier_sens === "sortant") return { cle: "repondu", libelle: N_("Répondu") };
  if (conv && conv.dernier_sens === "entrant") return { cle: "attend", libelle: N_("Le client attend une réponse") };
  return { cle: "", libelle: "" };
}

// ---- Avertissements de l'agent -------------------------------------------------------------------------------------------------------
// « montant_non_source:1500 », « heure_non_source:08:30 », « mot_interne:net », « signature_retiree », « nom_prestataire », « prenom_equipe ».
// niveau « alerte » : à corriger avant d'envoyer ; « info » : l'agent a déjà corrigé, Nani le sait.
const AVERTISSEMENTS = {
  montant_non_source: { texte: N_("Le montant {valeur} ne vient ni du dossier ni du catalogue. Vérifiez-le avant d'envoyer."), niveau: "alerte" },
  heure_non_source: { texte: N_("L'heure {valeur} ne vient ni du dossier ni des horaires. Vérifiez-la avant d'envoyer."), niveau: "alerte" },
  mot_interne: { texte: N_("Le mot interne « {valeur} » est dans le texte. Retirez-le avant d'envoyer."), niveau: "alerte" },
  nom_prestataire: { texte: N_("Un nom de partenaire est dans le texte. Retirez-le avant d'envoyer."), niveau: "alerte" },
  // PR 278 : un montant égal à un net, une marge ou une commission bloque la copie et l'envoi tant qu'il reste dans le texte.
  montant_interne: { texte: N_("Montant interne (net, marge ou commission) dans la réponse : {valeur}. À retirer."), niveau: "alerte" },
  prenom_equipe: { texte: N_("Un prénom de l'équipe est dans le texte. Vérifiez qu'il doit y être."), niveau: "alerte" },
  signature_retiree: { texte: N_("La signature a été retirée, les messages partent sans signature."), niveau: "info" },
};
export function libelleAvertissement(code) {
  const brut = String(code || "");
  const i = brut.indexOf(":");
  const cle = i >= 0 ? brut.slice(0, i) : brut;
  const valeur = i >= 0 ? brut.slice(i + 1) : "";
  const def = AVERTISSEMENTS[cle];
  if (cle === "nom_prestataire" && valeur) return { cle, texte: N_("La réponse cite le partenaire « {valeur} » : à retirer."), vars: { valeur }, niveau: "alerte" };
  if (!def) return { cle, texte: N_("Point à vérifier ({valeur})"), vars: { valeur: brut }, niveau: "alerte" };
  return { cle, texte: def.texte, vars: { valeur }, niveau: def.niveau };
}
// Les alertes d'abord, puis les informations.
export const avertissements = (prop) => ((prop && prop.avertissements) || []).map(libelleAvertissement).sort((a, b) => (a.niveau === b.niveau ? 0 : a.niveau === "alerte" ? -1 : 1));

// ---- Messages ---------------------------------------------------------------------------------------------------------------------------
// Ce que montre un média : une vignette (image copiée), un lien (document, son, vidéo copiés), ou pourquoi il manque.
export function etatMedia(media) {
  const m = media || {};
  if (m.statut === "efface") return "expire";
  if (m.statut === "trop_gros") return "trop_gros";
  if (m.statut === "echec") return "echec";
  if (m.statut === "a_copier" || !m.chemin) return m.statut === "copie" ? "echec" : "attente";
  const type = m.type || String(m.mime || "").split("/")[0];
  if (type === "image" || type === "sticker") return "image";
  if (type === "audio") return "audio";
  if (type === "video") return "video";
  return "document";
}
export const LIBELLES_MEDIA = {
  expire: N_("Média expiré"),
  trop_gros: N_("Fichier trop gros pour être gardé"),
  echec: N_("Média non récupéré"),
  attente: N_("Média en cours de copie"),
};
// Un message sans texte : son type en clair.
export const LIBELLES_TYPE = {
  image: N_("Photo"),
  document: N_("Document"),
  audio: N_("Message vocal"),
  video: N_("Vidéo"),
  sticker: N_("Autocollant"),
  reaction: N_("Réaction"),
  location: N_("Position"),
  contacts: N_("Contact"),
  inconnu: N_("Message que Gestion ne sait pas afficher"),
};
export const libelleType = (type) => LIBELLES_TYPE[type] || LIBELLES_TYPE.inconnu;
export const ORIGINES = { app: N_("depuis l'app"), gestion: N_("depuis Gestion") };

// Heures et jours de Bangkok (le fuseau de Nani), comme le suivi de l'assistant.
const bangkok = (iso) => new Date(Date.parse(iso) + 7 * 3600000).toISOString();
export const jourBangkok = (iso) => (iso && !Number.isNaN(Date.parse(iso)) ? bangkok(iso).slice(0, 10) : "");
export const heureBangkok = (iso) => (iso && !Number.isNaN(Date.parse(iso)) ? bangkok(iso).slice(11, 16) : "");
// Les messages dans l'ordre d'envoi, groupés par jour.
export function grouperParJour(messages = []) {
  const tries = [...messages].sort((a, b) => Date.parse(a.envoye_le) - Date.parse(b.envoye_le));
  const out = [];
  for (const m of tries) {
    const jour = jourBangkok(m.envoye_le);
    if (!out.length || out[out.length - 1].jour !== jour) out.push({ jour, messages: [] });
    out[out.length - 1].messages.push(m);
  }
  return out;
}

// ---- Envoi depuis Gestion --------------------------------------------------------------------------------------------------------------
export const ERREURS_ENVOI = {
  non_connecte: N_("Session expirée. Reconnectez-vous puis réessayez."),
  droit_manquant: N_("Votre rôle ne permet pas d'envoyer depuis Gestion pour cette conversation."),
  contenu_interne: N_("La réponse contient un net, une commission ou un nom de partenaire. Retirez-le avant d'envoyer."),
  fenetre_fermee: N_("Le client a écrit il y a plus de 24 h et WhatsApp refuse alors un message libre. Répondez depuis l'app."),
  non_configure: N_("L'envoi depuis Gestion n'est pas encore configuré. Copiez la réponse et envoyez-la depuis l'app."),
  numero_inconnu: N_("Le numéro de l'entreprise n'est pas encore connu de Gestion. Copiez la réponse et envoyez-la depuis l'app."),
  telnyx_refuse: N_("WhatsApp a refusé le message. Copiez la réponse et envoyez-la depuis l'app."),
  telnyx_injoignable: N_("WhatsApp ne répond pas pour l'instant. Réessayez ou envoyez depuis l'app."),
  hors_ligne: N_("Pas de réseau. Rien n'est parti."),
  base: N_("Erreur de la base. Rien n'est parti, réessayez dans un instant."),
};
export const erreurEnvoi = (code) => ERREURS_ENVOI[code] || N_("Envoi impossible. Copiez la réponse et envoyez-la depuis l'app.");

// Adresse de l'écran : « #/whatsapp?c=<conversation>&entite=<entreprise> » (la notification l'ouvre ainsi).
export function lireAdresse(hash = "") {
  const q = new URLSearchParams(String(hash).split("?")[1] || "");
  return { conversation: q.get("c") || "", entite: q.get("entite") || "" };
}
export const adresseConversation = (conv) => (conv ? `#/whatsapp?c=${conv.id}${conv.entite_id ? `&entite=${conv.entite_id}` : ""}` : "#/whatsapp");

// ---- Réglages -------------------------------------------------------------------------------------------------------------------------
// État du compte vu par Telnyx (whatsapp.account.update, par exemple « ACCOUNT_OFFBOARDED »), en clair. Un code inconnu s'affiche tel quel.
export function etatCompte(code) {
  const c = String(code || "");
  if (!c) return { cle: "inconnu", libelle: N_("Aucun changement d'état reçu depuis la mise en service") };
  if (/OFFBOARD|REMOVED|DELETED|BANNED/.test(c)) return { cle: "retire", libelle: N_("Compte retiré de Telnyx") };
  if (/DISCONNECT|SUSPEND|RESTRICT/.test(c)) return { cle: "deconnecte", libelle: N_("Compte déconnecté") };
  if (/CONNECT|ONBOARD|ACTIVE|VERIFIED|APPROVED/.test(c)) return { cle: "connecte", libelle: N_("Compte connecté") };
  return { cle: "autre", libelle: N_("État reçu de Telnyx ({code})"), vars: { code: c } };
}
