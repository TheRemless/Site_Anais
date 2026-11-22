// Boîte WhatsApp, type du contact compris par le sens de la conversation (migration 110, demande de Jérémy du 22.11.2026 : « l'outil ne détecte
// pas quand c'est un partenaire »). Logique pure, sans réseau : la fonction « whatsapp » (pret.ts, reponse.ts), l'Assistant (agent/outils.js,
// #318) et les tests l'importent.
//   1. Repères sans IA (`signauxPartenaire`), sur toute la conversation lue (60 messages) : Nani transfère au contact la demande d'un client,
//      lui demande une disponibilité, lui écrit en thaï, lui parle de ses clients ; le contact donne un prix à Nani, confirme une prise en
//      charge, parle d'un client à la 3e personne ; une commission. Jamais un mot isolé : un client qui écrit en thaï, qui parle de « my
//      driver » ou qui demande « could you do 2300 baht? » reste un client. Gardés dans whatsapp_conversations.type_signaux (codes et
//      nombres, jamais un texte).
//   2. La décision « type du contact » du tri Haiku (même appel qu'avant, proposer.js) : client, partenaire, apporteur, personnel ou inconnu,
//      avec une raison courte. Les 5 dernières sont gardées dans type_avis.
//   3. `typeADeduire` : sans type posé par Nani, « partenaire » sur au moins 2 décisions, ou sur une seule avec des repères nets, et la
//      dernière décision qui ne dit pas autre chose : le type est posé, marqué « déduit » (type_source, la base le pose). Un type posé ou
//      retiré par Nani n'est jamais écrasé (whatsapp_type_source, migration 110).
//   4. `partenaireProbable` : pour la #318 et la réponse préparée. Un contact partenaire, déduit ou probable ne reprend jamais un prix écrit
//      par Nani comme prix de vente (le prix qu'elle écrit à un partenaire est souvent un net).
// Un Contact personnel n'est jamais lu (aucun repère, aucune décision).
import { plat } from "./pret.js";

export const VERSION_SIGNAUX = 1;
export const TYPES_DECISION = ["client", "partenaire", "apporteur", "personnel", "inconnu"];
export const DECISIONS_GARDEES = 5;
// Poids de chaque repère. « Nets » : 4 points au moins, sur 2 repères différents au moins.
export const POIDS = { transfert_demande: 3, commission: 3, dispo_demandee: 2, prix_du_contact: 2, clients_nani: 2, clients_contact: 2, prise_en_charge: 2, sur_place: 1, thai_nani: 1 };
export const SEUIL_NETS = 4;

const L = "(?<![\\p{L}\\p{N}])";
const R = "(?![\\p{L}\\p{N}])";
const re = (corps) => new RegExp(`${L}(?:${corps})${R}`, "u");
// Sans borne à droite : le motif finit sur un chiffre (« price of 12,500 »).
const reG = (corps) => new RegExp(`${L}(?:${corps})`, "u");
const texteDe = (m) => [m.texte || "", ...((m.medias || []).map((x) => (x && x.legende) || ""))].join("\n").trim();
const question = (t) => /[?？]|ไหม|มั้ย|หรือเปล่า/u.test(t);

// Nani transfère la demande d'un client : « Customer: … », « New customers: … », « -> … », un message entre guillemets, le formulaire du
// site, ou les coordonnées d'un client (un numéro étranger avec « Name: »).
const TRANSFERT_DEBUT = /^\s*(?:(?:new\s+)?(?:customers?|clients?|guests?)\s*:|(?:nouveaux?\s+)?clients?\s*:|->|→|[«"“]\s*\S|transfer request\s*:)/iu;
const NUMERO_ETRANGER = /\+(?!66)\d[\d\s.\-()]{7,}\d/;
const transfert = (t) => TRANSFERT_DEBUT.test(t) || (NUMERO_ETRANGER.test(t) && (/name\s*:|nom\s*:/i.test(t) || t.replace(NUMERO_ETRANGER, "").trim().length < 4));
// Nani demande une disponibilité au contact (une question).
const DISPO = re(
  [
    "(?:are|r) (?:you|u) (?:available|free)",
    "is (?:your|the) (?:boat|car|van|minivan|driver|songthaew|taxi|guide|atv|kayak|room|bungalow)s? (?:still )?(?:available|free)",
    "(?:still )?available (?:now|today|tonight|tomorrow|on \\w+)",
    "(?:do|can) you (?:have|take) (?:a |one |two )?(?:car|van|boat|driver|space|seats?) (?:available|free|for)",
    "(?:es-tu|tu es|etes-vous|vous etes) (?:libre|disponible)",
  ].join("|")
);
// Le contact donne un prix à Nani, sans question : « round trip price is about 700 baht », « I can propose a price of 12,500 »,
// « 700 baht please ». « Could you do 2300 baht? » est un client qui négocie.
const PRIX_CONTACT = reG(
  [
    "(?:the )?(?:round[- ]trip |one[- ]way |total )?price (?:is|will be|would be) (?:around|approximately|about|roughly)?\\s*\\d",
    "(?:propose|offer|quote) (?:you )?(?:a |the |my )?price of \\d",
    "(?:i|we) can (?:do|make) it (?:for|at) \\d",
    "\\d[\\d,.]*\\s*(?:baht|thb|฿)\\.?\\s*please",
    "cost(?:s)? (?:is )?(?:around|approximately|about) \\d",
  ].join("|")
);
const PRIX_THAI = /\d[\d,.]*\s*บาท/u;
// Des clients à la 3e personne. Côté Nani : « some customers are interested », « the customers forgot… » ; côté contact : « drop off a
// client », « maybe your clients would like it ». Un client qui dit « as a customer » ou « I'm your client » n'en parle pas à la 3e personne.
// « Guests: 2 adults » ou « Passengers: » (le formulaire, une confirmation) n'en parlent pas : un intitulé suivi de « : » ne compte pas.
const CLIENTS_NANI = re("(?:customers?|clients?|guests?)(?!\\s*:)");
const SERVICE_CLIENT = re("customer (?:service|support|care)|service client");
const CLIENTS_CONTACT = re("(?:customers|clients|guests)(?!\\s*:)|(?:a|the|this|that|my|one|new) (?:customer|client|guest)(?!\\s*:)");
const SOI_CLIENT = re("(?:i am|i'm|im|we are|as) (?:a |your |the )?(?:customer|client|guest)s?|your (?:customer|client|guest)");
// Le contact confirme une prise en charge pour un client.
const PRISE = re(
  [
    "(?:on my way|on the way|heading) to (?:pick ?up|drop ?off|collect|get)",
    "(?:picked|dropped) (?:up |off )?(?:the |a |your |our )?(?:customers?|clients?|guests?|them)",
    "(?:brought|took|taking|bring|bringing|driving) (?:a |the |your |our )?(?:customers?|clients?|guests?|them)",
    "(?:waiting|wait) for (?:the |your |a |our )?(?:customers?|clients?|guests?)",
  ].join("|")
);
const SUR_PLACE = re("(?:i am|i'm|im) (?:already )?(?:at|in front of) the (?:pier|airport|hotel|lobby|port|resort)");
const COMMISSION = re("commissions?|net price|net rate|prix net|tarif net|ค่าคอม");
// Thaï écrit par Nani : une phrase, pas une particule de politesse (« ค่ะ », « คะ », « ครับ »).
const PARTICULES = /ค่ะ|คะ|ค่า|ครับ|คับ|นะ|จ้า|จ้ะ/gu;
const thaiPhrase = (t) => (String(t).replace(PARTICULES, "").match(/[฀-๿]/gu) || []).length >= 12;

const vivants = (messages = []) => messages.filter((m) => m && !m.supprime_le && m.type !== "reaction" && m.type !== "non_transmis");

// Les repères d'une conversation : { v, codes: { code: nombre }, score, nets, calcule_le }. Jamais un texte. Contact personnel : rien.
export function signauxPartenaire(messages = [], { conv = null, maintenant = new Date().toISOString() } = {}) {
  if (conv && conv.reponses === "jamais") return { v: VERSION_SIGNAUX, jamais: true, calcule_le: maintenant };
  const codes = {};
  const ajoute = (c) => (codes[c] = (codes[c] || 0) + 1);
  for (const m of vivants(messages)) {
    const brut = texteDe(m);
    if (!brut) continue;
    const p = plat(brut);
    if (m.sens === "sortant") {
      if (transfert(brut)) ajoute("transfert_demande");
      if (question(brut) && DISPO.test(p)) ajoute("dispo_demandee");
      if (CLIENTS_NANI.test(p) && !SERVICE_CLIENT.test(p)) ajoute("clients_nani");
      if (thaiPhrase(brut)) ajoute("thai_nani");
      if (COMMISSION.test(p)) ajoute("commission");
    } else if (m.sens === "entrant") {
      // Le formulaire du site (« Transfer request: … Price on the site: … ») est celui d'un client.
      if (/^\s*transfer request\s*:/i.test(brut)) continue;
      if (!question(brut) && (PRIX_CONTACT.test(p) || PRIX_THAI.test(brut))) ajoute("prix_du_contact");
      if (CLIENTS_CONTACT.test(p) && !SOI_CLIENT.test(p) && !SERVICE_CLIENT.test(p)) ajoute("clients_contact");
      if (PRISE.test(p)) ajoute("prise_en_charge");
      if (SUR_PLACE.test(p)) ajoute("sur_place");
      if (COMMISSION.test(p)) ajoute("commission");
    }
  }
  const presents = Object.keys(codes);
  const score = presents.reduce((s, c) => s + (POIDS[c] || 0), 0);
  return { v: VERSION_SIGNAUX, codes, score, nets: score >= SEUIL_NETS && presents.length >= 2, calcule_le: maintenant };
}

// Ce que le tri reçoit, sans aucun texte : une ligne par repère trouvé sur toute la conversation.
const LIBELLES_REPERES = {
  transfert_demande: "Nani transfère au contact la demande ou les coordonnées d'un client",
  dispo_demandee: "Nani demande au contact s'il est disponible (son bateau, sa voiture)",
  prix_du_contact: "le contact donne un prix à Nani, sans le demander",
  clients_nani: "Nani parle au contact de ses clients, à la 3e personne",
  clients_contact: "le contact parle de clients à la 3e personne",
  prise_en_charge: "le contact confirme une prise en charge de clients",
  sur_place: "le contact dit qu'il est au port, à l'aéroport ou à l'hôtel",
  thai_nani: "Nani écrit au contact en thaï",
  commission: "il est question de commission ou de prix net",
};
export function lignesReperes(signaux) {
  const codes = (signaux && signaux.codes) || {};
  return Object.keys(LIBELLES_REPERES).filter((c) => codes[c]).map((c) => `- ${LIBELLES_REPERES[c]}${codes[c] > 1 ? ` (${codes[c]} fois)` : ""}`);
}

// La décision « type du contact » lue dans la réponse JSON du tri : { type, raison } ou null. La raison : 120 caractères, sans chiffre long.
export function lireTypeDecision(j) {
  if (!j || typeof j !== "object" || !TYPES_DECISION.includes(j.type_contact)) return null;
  const raison = String(typeof j.raison_type === "string" ? j.raison_type : "")
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/g, " ")
    .replace(/\+?\d[\d\s.\-()/]{5,}\d/g, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return { type: j.type_contact, raison };
}

// type_avis après une nouvelle décision : les 5 dernières, la plus récente en dernier.
export function avisApres(avis, decision, maintenant = new Date().toISOString()) {
  const avant = Array.isArray(avis && avis.decisions) ? avis.decisions.filter((d) => d && TYPES_DECISION.includes(d.type)) : [];
  if (!decision || !TYPES_DECISION.includes(decision.type)) return { v: 1, decisions: avant.slice(-DECISIONS_GARDEES) };
  return { v: 1, decisions: [...avant, { type: decision.type, raison: decision.raison || "", le: maintenant }].slice(-DECISIONS_GARDEES) };
}

// Les décisions d'une conversation. Avant la migration 110, le tri ne donnait que son motif : « partenaire » y compte pour une décision.
export function decisionsDe(conv) {
  const d = conv && conv.type_avis && Array.isArray(conv.type_avis.decisions) ? conv.type_avis.decisions.filter((x) => x && TYPES_DECISION.includes(x.type)) : [];
  if (d.length) return d;
  return conv && conv.tri && conv.tri.motif === "partenaire" ? [{ type: "partenaire", raison: "", le: conv.tri.le || null, ancien: true }] : [];
}
// La dernière décision qui dit quelque chose (« inconnu » ne dit rien : un « ok » d'un partenaire).
const derniereNette = (decisions) => [...decisions].reverse().find((d) => d.type !== "inconnu") || null;
const signauxNets = (conv) => !!(conv && conv.type_signaux && conv.type_signaux.nets === true && !conv.type_signaux.jamais);

// Nani a posé (ou retiré) le type : jamais touché. Avant la migration 110, un type posé n'a pas de source : il est à Nani.
export const typeDeNani = (conv) => !!conv && (conv.type_source === "nani" || (!!conv.type_contact && conv.type_source !== "deduit"));

// Le type à poser par la fonction, ou null. Seul « partenaire » se déduit ; le client reste le défaut, un apporteur ou un contact personnel
// se choisissent toujours à la main.
export function typeADeduire(conv) {
  if (!conv || conv.type_contact || conv.type_source || conv.reponses === "jamais" || conv.partenaire_id) return null;
  const decisions = decisionsDe(conv);
  const derniere = derniereNette(decisions);
  if (!derniere || derniere.type !== "partenaire") return null;
  const n = decisions.filter((d) => d.type === "partenaire").length;
  return n >= 2 || (n >= 1 && signauxNets(conv)) ? "partenaire" : null;
}

// Un partenaire : posé (par Nani ou déduit) ou relié à une fiche partenaire.
export const contactPartenaire = (conv) => !!conv && (conv.type_contact === "partenaire" || !!conv.partenaire_id);
export const partenaireDeduit = (conv) => !!conv && conv.type_contact === "partenaire" && conv.type_source === "deduit";
// Partenaire posé, ou probable : pas encore de type, et la dernière décision du tri dit « partenaire », ou les repères sont nets. Un type
// choisi par Nani (client, apporteur) l'emporte toujours ; un Contact personnel n'est jamais lu. Règle à appeler par la #318 (client
// probable, prix de vente) et par la réponse préparée (consigne partenaire).
export function partenaireProbable(conv) {
  if (!conv || conv.reponses === "jamais") return false;
  if (contactPartenaire(conv)) return true;
  if (conv.type_contact || conv.type_source === "nani") return false;
  const derniere = derniereNette(decisionsDe(conv));
  return (!!derniere && derniere.type === "partenaire") || signauxNets(conv);
}
// Un prix écrit par Nani dans cette conversation peut-il servir de prix de vente ? Jamais pour un partenaire, posé ou probable.
export const prixDeVentePermis = (conv) => !!conv && conv.reponses !== "jamais" && !partenaireProbable(conv);
// La raison à montrer à Nani : celle de la dernière décision « partenaire », sinon les repères.
export function raisonPartenaire(conv) {
  const d = [...decisionsDe(conv)].reverse().find((x) => x.type === "partenaire" && x.raison);
  if (d) return d.raison;
  const l = lignesReperes(conv && conv.type_signaux);
  return l.length ? l.slice(0, 2).map((x) => x.replace(/^- /, "")).join(" ; ") : "";
}
