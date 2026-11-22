// Boîte WhatsApp de Gestion (migrations 58 et 59, 20.11.2026) : le numéro de Nani, un seul pour Secret Travel & Tour et VIP Taxi Lanta.
// Nani répond surtout depuis son app WhatsApp Business. L'écran sert à lire, à ranger la conversation dans la bonne entreprise et à copier
// la réponse préparée par l'agent, puis à ouvrir la conversation dans WhatsApp. L'envoi depuis Gestion existe mais reste secondaire.
// Logique pure, testée par tests/gestion-whatsapp-boite.test.js.
import { N_ } from "./i18n.mjs";
import { numeroAffiche } from "./demandes-site-calc.mjs";
import { nomContact, nomSaisi } from "./agent-whatsapp-lecture.mjs";
import { montantsDuTexte } from "./agent-calc.mjs";

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
// Ouvre la conversation du client dans WhatsApp (app de Nani sur téléphone, WhatsApp Web sur ordinateur). Avec `texte`, la réponse est
// déjà écrite dans le champ (wa.me/<numéro>?text=, lot 2 du 20.11.2026) : Nani n'a plus qu'à envoyer. Un texte trop long pour un lien
// (TEXTE_LIEN_MAX une fois encodé) n'est pas mis : le lien ouvre la conversation et le texte se colle.
export const TEXTE_LIEN_MAX = 1800;
export function lienWhatsApp(tel, texte = "") {
  if (chiffres(tel).length < 7) return null;
  const t = String(texte || "").trim();
  const code = t ? encodeURIComponent(t) : "";
  return `https://wa.me/${chiffres(tel)}${code && code.length <= TEXTE_LIEN_MAX ? `?text=${code}` : ""}`;
}
// Une réponse en plusieurs messages courts (lot 2) : l'agent sépare ses messages par une ligne vide. Chaque morceau se copie seul.
export const morceauxReponse = (texte) => String(texte || "").split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);

// Nom affiché (migration 70) : le nom saisi à la main par Nani, sinon le client relié (fiche de Gestion), sinon le nom du profil WhatsApp,
// sinon le numéro. Même ordre que l'Assistant (agent-whatsapp-lecture.mjs, nomContact), qui n'envoie jamais le numéro.
export { nomSaisi };
export function nomConversation(conv, client = null) {
  // Client sans numéro (migration 100) : son BSUID, faute de mieux (le nom du profil WhatsApp arrive presque toujours avec).
  return nomContact(conv, client) || numeroAffiche((conv && conv.telephone) || "") || ((conv && conv.bsuid) || "");
}
// Le nom tel que la base le garde (déclencheur whatsapp_nom_manuel, migration 70) : caractères invisibles (U+200B à U+200F, U+202A à U+202E,
// U+2060 à U+2069, U+FEFF) retirés, espaces et caractères de contrôle réduits à une espace, 60 caractères au plus. Vide : null (le nom
// manuel est effacé).
export const NOM_MAX = 60;
export const INVISIBLES = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
export function nettoyerNom(v) {
  const t = Array.from(String(v ?? "").replace(INVISIBLES, "").replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim()).slice(0, NOM_MAX).join("").trim();
  return t || null;
}
// Le nom écrit par le client (tri de la fonction « whatsapp », 21.11.2026, nom_source 'whatsapp') et une fiche client reliée sans nom de
// famille : l'écran propose de mettre la fiche à jour, jamais seul. Rend { prenom, nom } ou null. Seulement une conversation de client, une
// fiche de la même entreprise (une fiche partagée garde son nom), un nom d'au moins deux mots dont le prénom de la fiche fait partie.
const motsPlats = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/\s+/).filter(Boolean);
export function ficheAMettreAJour(conv, client) {
  if (!conv || !client || conv.nom_source !== "whatsapp" || conv.reponses === "jamais" || (conv.type_contact && conv.type_contact !== "client") || conv.partenaire_id) return null;
  if (String(client.nom || "").trim() || (conv.entite_id && client.entite_id && client.entite_id !== conv.entite_id)) return null;
  const mots = String(conv.nom || "").trim().split(/\s+/).filter(Boolean);
  if (mots.length < 2) return null;
  const prenom = String(client.prenom || "").trim();
  if (!prenom) return { prenom: mots[0], nom: mots.slice(1).join(" ") };
  const p = motsPlats(prenom);
  const plats = motsPlats(conv.nom);
  const i = plats.findIndex((m, k) => p.every((x, j) => plats[k + j] === x));
  if (i !== 0 || p.length >= mots.length) return null;
  return { prenom, nom: mots.slice(p.length).join(" ") };
}

// Ce que l'écran envoie à la base, ou null s'il n'y a rien à changer : le même nom manuel, ou un champ vide sans nom manuel. Un nom de profil
// retapé à l'identique s'envoie : la base le marque alors manuel (protégé de la fonction « whatsapp »).
export function patchNom(conv, saisie) {
  const nom = nettoyerNom(saisie);
  if (nom === (nomSaisi(conv) || null)) return null;
  if (nom === null && !nomSaisi(conv)) return null;
  return { nom };
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

// ---- Tri (migration 60) ------------------------------------------------------------------------------------------------------------
// tri : { preparer, motif, entreprise, le }, écrit par la fonction « whatsapp » à chaque message du client. reponses : « auto » ou « jamais ».
// Le tri a dit non (pas de réponse à préparer) : la conversation n'est pas « à répondre ». Une proposition créée après la décision du tri
// (Nani a touché « Préparer une réponse ») compte de nouveau.
export const REPONSES = ["auto", "jamais"];
export const reponsesDe = (conv) => (conv && conv.reponses === "jamais" ? "jamais" : "auto");
// Réglages > Assistant IA : l'agent prépare-t-il seul les réponses (décoché par défaut, 20.11.2026) ?
export const preparationAuto = (reglages) => !!(reglages && typeof reglages === "object" && reglages.whatsapp_reponses_auto === true);
export function triDitNon(conv, prop = null) {
  const t = conv && conv.tri && typeof conv.tri === "object" ? conv.tri : null;
  if (!t || t.preparer !== false) return false;
  if (prop && t.le && Date.parse(prop.cree_le || "") > Date.parse(t.le)) return false;
  return true;
}
// Ce que le tri a vu dans le dernier message du client, en clair et sans ton d'anomalie : depuis le 20.11.2026, aucune réponse n'est
// préparée sans un clic de Nani (sauf réglage contraire), l'absence de réponse est donc l'état normal. null : pas de tri à jour.
export const MOTIFS_TRI = {
  demande_client: N_("Le client pose une question"),
  suivi_reservation: N_("Question sur sa réservation"),
  remerciement: N_("Un remerciement"),
  personnel: N_("Message personnel"),
  partenaire: N_("Un partenaire"),
  publicite: N_("Publicité"),
  media_seul: N_("Photo ou vocal sans texte"),
  contact_jamais: N_("Contact personnel"),
  limite: N_("Limite du jour des réponses atteinte"),
  tri_illisible: N_("Message non trié"),
  ia_coupee: N_("Assistant éteint ou réception suspendue : message non trié"),
  autre: N_("Rien à répondre"),
};
// Pourquoi l'agent n'a pas préparé de réponse (whatsapp_propositions.erreur), en clair.
export const ERREURS_PROPOSITION = {
  a_trier: N_("L'assistant ne sait pas si c'est pour Secret ou Taxi : touchez l'entreprise en haut, puis Préparer une réponse."),
  agent_eteint: N_("L'assistant est éteint pour cette entreprise (Réglages)."),
  interrompue: N_("La préparation a été interrompue."),
  pas_de_reponse: N_("L'assistant n'a pas proposé de réponse."),
  credit_epuise: N_("Le crédit de l'assistant est épuisé."),
};
export const libelleErreurProposition = (code) => ERREURS_PROPOSITION[code] || (String(code || "").startsWith("erreur") ? N_("Erreur de l'assistant.") : null);
// Le libellé du tri pour le dernier message du client (MOTIFS_TRI), ou null.
export function raisonSansReponse(conv, messages = []) {
  const t = conv && conv.tri && typeof conv.tri === "object" ? conv.tri : null;
  const dernier = dernierEntrant(messages);
  const aJour = !!t && typeof t.motif === "string" && (!dernier || !t.le || Date.parse(t.le) >= Date.parse(dernier));
  // Contact repassé sur « Automatiques » depuis : le motif « Jamais » ne vaut plus, la raison générale reprend.
  if (aJour && t.motif === "contact_jamais" && reponsesDe(conv) === "auto") return null;
  if (aJour) return MOTIFS_TRI[t.motif] || MOTIFS_TRI.autre;
  if (reponsesDe(conv) === "jamais") return MOTIFS_TRI.contact_jamais;
  return null;
}

// Une conversation demande quelque chose : des messages non lus, ou une réponse prête à copier (sauf si le tri a dit non).
export const aTraiter = (conv, prop) => !!conv && ((Number(conv.non_lus) || 0) > 0 || (!!prop && prop.statut === "a_faire" && !triDitNon(conv, prop)));
// Badge du menu : le nombre de conversations qui demandent quelque chose.
export function badgeWhatsApp(conversations = [], propositions = []) {
  const props = propositionsCourantes(propositions);
  return conversations.filter((c) => aTraiter(c, props.get(c.id))).length;
}

// ---- Liste ------------------------------------------------------------------------------------------------------------------------
// Toutes d'abord (lot 2, design n° 14) : on n'attend plus de ranger une conversation pour agir. Les quatre tiennent en 390 px.
export const FILTRES = [
  { valeur: "toutes", libelle: N_("Toutes") },
  { valeur: "a_trier", libelle: N_("À trier") },
  { valeur: "secret", libelle: N_("Secret") },
  { valeur: "taxi", libelle: N_("Taxi") },
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
// Filtre de départ : toutes (lot 2 : une conversation à trier se traite comme les autres, rien n'oblige à la ranger d'abord).
export const filtreDeDepart = () => "toutes";

// Ligne d'état sous le nom dans la liste.
export function etatConversation(conv, prop) {
  if (prop && prop.statut === "a_faire" && !triDitNon(conv, prop)) return { cle: "prete", libelle: N_("Réponse prête") };
  if (prop && prop.statut === "en_cours") return { cle: "en_cours", libelle: N_("Réponse en préparation") };
  if (prop && prop.statut === "envoi") return { cle: "envoi", libelle: N_("Envoi en cours") };
  if (prop && prop.statut === "echec") return { cle: "echec", libelle: N_("Pas de réponse préparée") };
  // Le tri a écarté le dernier message (personnel, partenaire, remerciement, contact réglé sur « Jamais ») : rien à répondre ici.
  if (conv && conv.dernier_sens === "entrant" && triDitNon(conv, prop) && !(prop && ["en_cours", "envoi"].includes(prop.statut))) return { cle: "sans", libelle: N_("Pas besoin de répondre") };
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
  // 21.11.2026 : un montant égal au net d'un autre service du catalogue ne bloque pas (coïncidence fréquente sur un chiffre rond).
  montant_egal_net: { texte: N_("Le montant {valeur} est aussi le net d'un autre service du catalogue. Vérifiez que c'est bien un prix de vente."), niveau: "info" },
  // Revue de sécurité de la PR 306 : un montant illisible ou des nets illisibles ferment le contrôle (copie et envoi bloqués).
  montant_illisible: { texte: N_("Un montant de la réponse n'a pas pu être lu. Écrivez-le avec des chiffres simples, par exemple 1,000."), niveau: "alerte" },
  controle_impossible: { texte: N_("Les nets n'ont pas pu être relus pour contrôler la réponse : elle ne se copie pas. Préparez-la de nouveau."), niveau: "alerte" },
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
  // Sans le droit de voir les nets, la fonction ne donne pas la valeur (revue de la PR 306).
  if (cle === "montant_interne" && valeur.startsWith("#")) return { cle, texte: N_("Un montant interne (net, marge ou commission) est dans la réponse. À retirer."), vars: {}, niveau: "alerte" };
  if (cle === "montant_egal_net" && !valeur) return { cle, texte: N_("Un montant de la réponse est égal à un net interne. Vérifiez que c'est bien un prix de vente."), vars: {}, niveau: "info" };
  if (!def) return { cle, texte: N_("Point à vérifier ({valeur})"), vars: { valeur: brut }, niveau: "alerte" };
  return { cle, texte: def.texte, vars: { valeur }, niveau: def.niveau };
}
// Les alertes d'abord, puis les informations. L'élément « services: » (références gardées pour l'envoi, whatsapp/proposer.js) ne se montre pas.
export const SERVICES_PROPOSITION = "services:";
export const avertissements = (prop) => ((prop && prop.avertissements) || []).filter((a) => !String(a).trim().toLowerCase().startsWith(SERVICES_PROPOSITION)).map(libelleAvertissement).sort((a, b) => (a.niveau === b.niveau ? 0 : a.niveau === "alerte" ? -1 : 1));

// ---- Messages ---------------------------------------------------------------------------------------------------------------------------
// Ce que montre un média : une vignette (image copiée), un lien (document, son, vidéo copiés), ou pourquoi il manque.
export function etatMedia(media) {
  const m = media || {};
  // Voucher envoyé depuis Gestion (migration 73) : l'image n'est pas gardée, seul son envoi est montré.
  if (m.statut === "voucher") return "voucher_envoye";
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
  voucher_envoye: N_("Voucher envoyé depuis Gestion (image non gardée)"),
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
  non_transmis: N_("Message non transmis"),
};

// Messages manquants (migration 100). Ligne gardée quand WhatsApp n'a pas transmis le message du client (type non_transmis), et repère
// discret sur une réponse de Nani avant laquelle un message du client semble manquer (repere) ou sur la carte (manque_le). Sans IA.
export const TEXTE_NON_TRANSMIS = N_("Message du client non transmis par WhatsApp, {heure}. Ouvre WhatsApp sur le téléphone pour le lire.");
export const LIBELLE_MANQUE = N_("Un message du client semble manquer");
export const estNonTransmis = (m) => !!m && m.type === "non_transmis";
export const repereManque = (m) => !!m && m.repere === "semble_manquer";
export const conversationManque = (c) => !!c && !!c.manque_le;
// Même client (même BSUID) qui écrit depuis un autre numéro : la conversation de l'ancien numéro (migration 100). Jamais de changement de
// numéro automatique : Nani décide.
export const LIBELLE_NOUVEAU_NUMERO = N_("Nouveau numéro pour ce client");
export const ancienneConversation = (c, conversations = []) => (c && c.meme_client_que ? conversations.find((x) => x.id === c.meme_client_que) || null : null);
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
  contenu_interne: N_("Le texte contient un net, une commission ou un nom de partenaire. Retirez-le, rien n'est parti."),
  // whatsapp-envoi (409) : un montant égal à un net du catalogue, à confirmer avant de partir.
  montant_a_confirmer: N_("Un montant du texte est égal à un net interne. Confirmez-le pour envoyer, rien n'est parti."),
  // whatsapp-envoi n'a pas pu relire les nets (revue de la PR 306) : il ferme.
  controle_impossible: N_("Les nets n'ont pas pu être relus pour contrôler le texte. Rien n'est parti, réessayez dans un instant."),
  // whatsapp-envoi n'a pas pu relire les fiches partenaires (revue PR 298) : il ferme, le texte n'est pas en cause.
  partenaires_illisibles: N_("Les fiches partenaires n'ont pas pu être relues pour contrôler le texte. Rien n'est parti, réessayez dans un instant."),
  fenetre_fermee: N_("Le client a écrit il y a plus de 24 h et WhatsApp refuse alors un message libre. Répondez depuis l'app."),
  non_configure: N_("L'envoi depuis Gestion n'est pas encore configuré. Copiez la réponse et envoyez-la depuis l'app."),
  numero_inconnu: N_("Le numéro de l'entreprise n'est pas encore connu de Gestion. Copiez la réponse et envoyez-la depuis l'app."),
  telnyx_refuse: N_("WhatsApp a refusé le message. Copiez la réponse et envoyez-la depuis l'app."),
  base: N_("Erreur de la base. Rien n'est parti, réessayez dans un instant."),
  deja_traitee: N_("Cette réponse n'est plus à faire. Rien n'est parti depuis Gestion."),
  // Résultat inconnu : jamais de « réessayez », le message est peut-être parti (whatsapp-envoi, délai dépassé ou connexion coupée).
  verifier_whatsapp: N_("Délai dépassé : le message est peut-être parti. Vérifiez dans WhatsApp avant de réessayer."),
};
// Erreurs après lesquelles rien n'est parti à coup sûr. Toutes les autres (délai dépassé, connexion coupée pendant l'envoi, réponse illisible,
// code inconnu) laissent un doute : le bouton Envoyer reste éteint et l'écran demande de vérifier dans WhatsApp.
const RIEN_PARTI = new Set(["non_connecte", "droit_manquant", "contenu_interne", "montant_a_confirmer", "controle_impossible", "partenaires_illisibles", "fenetre_fermee", "non_configure", "numero_inconnu", "telnyx_refuse", "base", "deja_traitee"]);
export const envoiIncertain = (code) => !RIEN_PARTI.has(code);
// Le code à afficher après un refus « contenu_interne » : « partenaires_illisibles » quand la fonction n'a pas pu relire les fiches
// (a_retirer « nom_prestataire:lecture_impossible »), sinon le code tel quel.
export const LECTURE_IMPOSSIBLE = "nom_prestataire:lecture_impossible";
// Refus « montant_a_confirmer » (whatsapp-envoi, 409) : ce que la personne confirme d'un clic et le texte de la question, ou null.
//   - valeurs connues : les montants rendus, renvoyés tels quels (montants_confirmes) ;
//   - valeurs masquées (pas le droit de voir les nets) : tous les montants du texte, même règle de lecture que la fonction ;
//   - « catalogue » (ni dossier relié ni proposition) : le texte dit « net du catalogue », pas « autre service ».
export function aConfirmerEnvoi(r, texte = "") {
  if (!r || r.erreur !== "montant_a_confirmer") return null;
  if (r.masque) {
    const tous = [...new Set(montantsDuTexte(texte))].filter((x) => x > 0);
    return tous.length ? { renvoi: tous, texte: N_("Un montant du texte est égal à un net interne. Envoyez-le seulement si c'est bien le prix de vente pour ce client."), vars: {} } : null;
  }
  const liste = (Array.isArray(r.a_confirmer) ? r.a_confirmer : []).map(Number).filter((x) => Number.isFinite(x) && x > 0);
  if (!liste.length) return null;
  const texteQuestion = r.portee === "autre_service" ? N_("Le montant {liste} est aussi le net d'un autre service du catalogue. Envoyez-le seulement si c'est bien le prix de vente pour ce client.") : N_("Le montant {liste} est aussi un net du catalogue. Envoyez-le seulement si c'est bien le prix de vente pour ce client.");
  return { renvoi: liste, texte: texteQuestion, vars: { liste: liste.join(", ") } };
}
export const montantsAConfirmer = (r, texte = "") => (aConfirmerEnvoi(r, texte) || { renvoi: [] }).renvoi;
export const codeEnvoi = (code, aRetirer = []) => (code === "contenu_interne" && (aRetirer || []).includes("controle_impossible") ? "controle_impossible" : (code === "contenu_interne" && (aRetirer || []).includes(LECTURE_IMPOSSIBLE) ? "partenaires_illisibles" : code));
// « Préparer une réponse » (fonction whatsapp-preparer, 202 puis préparation en tâche de fond).
export const ERREURS_PREPARER = {
  non_connecte: N_("Session expirée. Reconnectez-vous puis réessayez."),
  droit_manquant: N_("Votre rôle ne permet pas de préparer une réponse pour cette conversation."),
  contact_personnel: N_("Contact personnel : rien n'est envoyé à l'IA. Répondez depuis l'app."),
  rien_a_repondre: N_("Le dernier message n'est pas du client. Rien à préparer."),
  limite: N_("Limite atteinte (plafond du mois ou limite du jour). Répondez depuis l'app."),
  agent_eteint: N_("L'assistant est éteint pour cette entreprise. Allumez-le dans les Réglages."),
  non_configure: N_("La préparation des réponses n'est pas encore configurée."),
};
export const erreurPreparer = (code) => ERREURS_PREPARER[code] || N_("Préparation impossible pour l'instant. Réessayez dans un instant.");
export const erreurEnvoi = (code) => (envoiIncertain(code) ? ERREURS_ENVOI.verifier_whatsapp : ERREURS_ENVOI[code]);

// Adresse de l'écran : « #/whatsapp?c=<conversation>&entite=<entreprise> » (la notification l'ouvre ainsi).
// `m` : le message cité par l'Assistant (lien #/whatsapp?c=…&m=…, agent/whatsapp-lecture.js). L'écran défilera jusqu'à lui (PR suivante).
export function lireAdresse(hash = "") {
  const q = new URLSearchParams(String(hash).split("?")[1] || "");
  return { conversation: q.get("c") || "", entite: q.get("entite") || "", message: q.get("m") || "" };
}
// La ligne « fait » (traitée, ignorée, répondu depuis l'app) ne vaut que pour le dernier message du client : une proposition plus ancienne
// que lui ne dit rien de la réponse à ce message. Sans date, on ne conclut rien.
export function propositionAJour(prop, messages = []) {
  if (!prop) return false;
  const dernier = dernierEntrant(messages);
  if (!dernier) return true;
  return Date.parse(prop.cree_le || "") >= Date.parse(dernier);
}

// L'entreprise que l'agent propose pour une conversation à trier : « entreprise_proposee » (secret ou taxi), sinon l'entreprise pour laquelle
// la proposition a été préparée (p.entite_id).
export function entrepriseProposee(prop, entites = []) {
  if (!prop) return null;
  if (prop.entreprise_proposee) return entites.find((e) => marqueEntite(e) === prop.entreprise_proposee) || null;
  return prop.entite_id ? entites.find((e) => e.id === prop.entite_id) || null : null;
}

// Les liens que l'Assistant cite (#/whatsapp?c=…&m=…&entite=…, agent/whatsapp-lecture.js, lienWhatsApp), découpés dans un texte pour que
// l'écran de l'Assistant les rende cliquables. Seulement la forme exacte des liens de l'outil, identifiants compris : rien d'autre ne
// devient un lien. Rend [{ texte }] et [{ lien, message }] dans l'ordre.
const UUID_LIEN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LIEN_CITATION = new RegExp(`#/whatsapp\\?c=${UUID_LIEN}(?:&m=${UUID_LIEN})?(?:&entite=${UUID_LIEN})?(?![0-9a-z&=-])`, "gi");
export function morceauxCitations(texte = "") {
  const t = String(texte || "");
  const out = [];
  let i = 0;
  for (const m of t.matchAll(LIEN_CITATION)) {
    if (m.index > i) out.push({ texte: t.slice(i, m.index) });
    // La conversation citée (migration 70) : l'écran met son nom à côté du lien.
    out.push({ lien: m[0], message: /&m=/.test(m[0]), conversation: m[0].slice(m[0].indexOf("c=") + 2, m[0].indexOf("c=") + 38).toLowerCase() });
    i = m.index + m[0].length;
  }
  if (i < t.length || !out.length) out.push({ texte: t.slice(i) });
  return out;
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

// ---- Aperçu de la liste (migration 65, lot 2 du 20.11.2026) ---------------------------------------------------------------------------
// Ce que la base tient à jour (whatsapp_apercu) : le début du dernier message, son type, et depuis quand le client attend. Même calcul que
// le déclencheur, pour la démonstration et les tests.
export const APERCU_MAX = 140;
export function apercuDepuisMessages(messages = []) {
  const tries = [...messages].filter((m) => m && m.type !== "reaction").sort((a, b) => Date.parse(a.envoye_le) - Date.parse(b.envoye_le));
  const dernier = tries[tries.length - 1] || null;
  let reponse = -Infinity;
  // Un envoi depuis Gestion en échec (migration 64) n'est pas une réponse.
  for (const m of tries) if (m.sens === "sortant" && m.statut_envoi !== "echec") reponse = Math.max(reponse, Date.parse(m.envoye_le));
  const attente = tries.find((m) => m.sens === "entrant" && !m.supprime_le && Date.parse(m.envoye_le) > reponse) || null;
  // Une photo sans texte mais avec une légende : la légende.
  const legende = dernier && Array.isArray(dernier.medias) ? (dernier.medias.find((x) => x && x.legende) || {}).legende || "" : "";
  const texte = dernier && !dernier.supprime_le ? String(dernier.texte || legende || "").trim().replace(/\s+/g, " ").slice(0, APERCU_MAX) : "";
  return { dernier_texte: texte || null, dernier_type: dernier ? (dernier.supprime_le ? "supprime" : dernier.type || "text") : null, attend_depuis: attente ? attente.envoye_le : null };
}
// La deuxième ligne d'une conversation dans la liste, comme dans WhatsApp : le début du dernier message, « Vous : » quand c'est Nani.
// Un média sans texte se dit par son type. `texte` vide : rien à montrer (base sans la migration 65).
export function apercuConversation(conv) {
  if (!conv) return { texte: "", deNani: false, type: null };
  const deNani = conv.dernier_sens === "sortant";
  if (conv.dernier_type === "supprime") return { texte: "", deNani, type: "supprime" };
  if (conv.dernier_texte) return { texte: String(conv.dernier_texte), deNani, type: null };
  return { texte: "", deNani, type: conv.dernier_type || null };
}
export const LIBELLE_SUPPRIME = N_("Message supprimé");
// Depuis combien de temps le client attend une réponse : son premier message resté sans réponse (attend_depuis, migration 65 ; à défaut
// son dernier message). null quand Nani a répondu ou que le tri a vu un message sans réponse à faire (merci, emoji). `urgent` au-delà de
// ATTENTE_URGENTE_MIN minutes.
export const ATTENTE_URGENTE_MIN = 30;
export function attenteClient(conv, prop = null, maintenant = Date.now()) {
  if (!conv || conv.dernier_sens !== "entrant" || triDitNon(conv, prop)) return null;
  const depuis = Date.parse(conv.attend_depuis || conv.dernier_message_le || "");
  if (!Number.isFinite(depuis)) return null;
  const minutes = Math.max(0, Math.floor((maintenant - depuis) / 60000));
  return { minutes, texte: dureeCourte(minutes), urgent: minutes >= ATTENTE_URGENTE_MIN };
}
// « 4 min », « 1 h 20 », « 3 h », « 2 j » : court, pour la liste.
export function dureeCourte(minutes) {
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) return m % 60 && m < 10 * 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${Math.floor(m / 60)} h`;
  return `${Math.floor(m / (24 * 60))} j`;
}

// ---- Assistant depuis une conversation à trier (lot 2) ---------------------------------------------------------------------------------
// Lot 2 (usage n° 1) : une conversation à trier ne bloque plus. L'Assistant s'ouvre sans la ranger, dans l'entreprise suggérée par le tri,
// ou dans l'entreprise ouverte quand l'Assistant marche dans Secret et Taxi (l'espace unifié choisit l'entreprise de chaque service par le
// catalogue). La conversation se range seule quand le dossier est validé (relierWhatsApp, agent.mjs). La question n'est posée que si rien
// ne permet de choisir.
export function entreprisePourAssistant({ conv, prop = null, choix = [], activeId = null }) {
  if (conv && conv.entite_id) return choix.find((e) => e.id === conv.entite_id) || null;
  const suggeree = entrepriseProposee(prop, choix) || (conv && conv.tri && conv.tri.entreprise ? choix.find((e) => marqueEntite(e) === conv.tri.entreprise) || null : null);
  if (suggeree) return suggeree;
  if (choix.length > 1) return choix.find((e) => e.id === activeId) || choix[0];
  return choix.length === 1 ? choix[0] : null;
}
