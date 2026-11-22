// Boîte WhatsApp, type du contact compris par le sens de la conversation (migration 110, demande de Jérémy du 22.11.2026 : « l'outil ne détecte
// pas quand c'est un partenaire »). Logique pure, sans réseau ni import de l'Assistant : la fonction « whatsapp » (pret.ts, reponse.ts),
// l'Assistant (agent/outils.js, #318) et les tests l'importent. Corrigé après la relecture indépendante du 22.11.2026.
//   1. Repères sans IA (`signauxPartenaire`), sur toute la conversation lue (60 messages) : Nani transfère au contact la demande d'un client,
//      lui demande une disponibilité, lui écrit en thaï (si lui ne l'écrit pas), lui parle de ses clients ; le contact annonce un prix à Nani
//      (« around », « approximately », « propose a price of ») ; un net ou une commission avec un montant ; « N pax » avec un prix ; une
//      prise en charge (« picked up », « drop off done »). Jamais un mot isolé : un client qui écrit en thaï, qui parle de « my driver », de
//      « 4 guests » ou qui négocie reste un client. Gardés dans whatsapp_conversations.type_signaux (codes et nombres, jamais un texte). Ce
//      sont des indices, souvent trompeurs chez un client : ils ne posent jamais un type et ne changent jamais le traitement d'un client.
//   2. La décision « type du contact » du tri Haiku (même appel qu'avant, proposer.js) : client, partenaire, apporteur, personnel ou inconnu,
//      avec une raison courte et le message trié. Les 5 dernières sont gardées dans type_avis, ajoutées par la base
//      (whatsapp_ajouter_avis_type, migration 110 : deux tris en même temps ne perdent aucune décision).
//   3. `typeADeduire` : sans type posé par Nani, sans fiche client, sans dossier et sans fiche partenaire, « partenaire » sur au moins 2
//      décisions venues de 2 messages différents, et la dernière décision qui ne dit pas autre chose : le type est posé, marqué « déduit ».
//      Une seule décision ne suffit jamais, même avec des repères nets. Un type posé ou retiré par Nani n'est jamais écrasé
//      (whatsapp_type_source, migration 110, qui refuse aussi toute déduction sur une conversation reliée à un client ou à un dossier).
//   4. Deux effets séparés :
//      - `traiterEnPartenaire` : consigne partenaire, contexte client retiré, sortie des étapes, du « Prêt à réserver » et du tri. Seulement
//        pour un type posé (par Nani ou déduit) ou une fiche partenaire reliée. Jamais sur des repères ni sur une seule décision ;
//      - `prixDeVentePermis` (pour la #318 et la réponse préparée) : prudent. Faux aussi pour un partenaire seulement probable (la dernière
//        décision dit « partenaire », ou les repères sont nets). Le seul effet : le prix reste à fixer, aucun prix écrit dans la conversation
//        n'est repris comme prix de vente (le prix que Nani écrit à un partenaire est souvent un net).
// Un Contact personnel n'est jamais lu (aucun repère, aucune décision).
import { plat } from "./pret.js";

export const VERSION_SIGNAUX = 2;
export const TYPES_DECISION = ["client", "partenaire", "apporteur", "personnel", "inconnu"];
export const DECISIONS_GARDEES = 5;
// Poids de chaque repère. « Nets » : 4 points au moins, sur 2 repères différents au moins, dont un venu du CONTACT (relecture finale du
// 22.11.2026) : deux phrases de Nani (« Are you free at 9am? Most of our customers take this time ») ne suffisent jamais.
export const POIDS = { transfert_demande: 3, commission: 3, dispo_demandee: 2, prix_du_contact: 2, pax_prix: 2, clients_nani: 2, clients_contact: 2, prise_en_charge: 2, sur_place: 1, thai_nani: 1 };
export const SEUIL_NETS = 4;

const L = "(?<![\\p{L}\\p{N}])";
const R = "(?![\\p{L}\\p{N}])";
const re = (corps) => new RegExp(`${L}(?:${corps})${R}`, "u");
// Sans borne à droite : le motif finit sur un chiffre (« price of 12,500 »).
const reG = (corps) => new RegExp(`${L}(?:${corps})`, "u");
const texteDe = (m) => [m.texte || "", ...((m.medias || []).map((x) => (x && x.legende) || ""))].join("\n").trim();
const question = (t) => /[?？]|ไหม|มั้ย|หรือเปล่า/u.test(t);
// Un montant : trois chiffres au moins (« 3 people » n'en est pas un).
const MONTANT = "\\d(?:[\\d,.' ]*\\d){2,}";

// Nani transfère la demande d'un client : « Customer: … », « New customers: … », « -> … », un message entre guillemets, le formulaire du
// site, ou les coordonnées d'un client (un numéro étranger avec « Name: »).
const TRANSFERT_DEBUT = /^\s*(?:(?:new\s+)?(?:customers?|clients?)\s*:|(?:nouveaux?\s+)?clients?\s*:|->|→|[«"“]\s*\S|transfer request\s*:)/iu;
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
// Le contact annonce un prix à Nani, sans question et avec les mots d'un tarif annoncé : « round trip price is about 700 baht », « I can
// propose a price of 12,500 ». Un client qui répète le prix (« the price is 2,700 ok »), qui propose le sien (« 2000 baht please », « we
// can pay 2000 ») ou qui écrit un prix en thaï n'en annonce pas un.
const PRIX_CONTACT = reG(
  [
    `(?:the )?(?:round[- ]trip |one[- ]way |total )?price (?:is|will be|would be) (?:around|approximately|about|roughly) ${MONTANT}`,
    `(?:propose|offer|quote) (?:you )?(?:a |the |my )?price of ${MONTANT}`,
    `cost(?:s)? (?:is )?(?:around|approximately|about) ${MONTANT}`,
  ].join("|")
);
// Des clients à la 3e personne. Côté Nani : « some customers are interested », « the customers forgot… » ; côté contact : « drop off a
// client ». « Guest » n'en est pas un (« we are 4 guests », « 1,500 THB per guest ») ; un intitulé suivi de « : » non plus.
const CLIENTS_NANI = re("(?:customers?|clients?)(?!\\s*:)");
const SERVICE_CLIENT = re("customer (?:service|support|care)|service client");
const CLIENTS_CONTACT = re("(?:customers|clients)(?!\\s*:)|(?:a|the|this|that|my|one|new) (?:customer|client)(?!\\s*:)");
const SOI_CLIENT = re("(?:i am|i'm|im|we are|as) (?:a |your |the )?(?:customer|client)s?|your (?:customer|client)");
// Le contact confirme une prise en charge : « picked up », « drop off done », « on my way to pick up ». « Done » seul vaut peu (sur_place).
const PRISE = re(
  [
    "(?:on my way|on the way|heading) to (?:pick ?up|drop ?off|collect|get)",
    "picked (?:them |him |her |the (?:customers?|clients?) |a client )?up",
    "(?:picked|dropped) (?:up |off )?(?:the |a |your |our )?(?:customers?|clients?|them)",
    "(?:pick ?-?up|drop ?-?off|job|transfer) (?:is )?(?:done|finished)",
    "(?:brought|took|taking|bring|bringing|driving) (?:a |the |your |our )?(?:customers?|clients?|them)",
    "(?:waiting|wait) for (?:the |your |a |our )?(?:customers?|clients?)",
  ].join("|")
);
const SUR_PLACE = re("(?:i am|i'm|im) (?:already )?(?:at|in front of) the (?:pier|airport|hotel|lobby|port|resort)");
const FAIT_SEUL = /^\s*(?:ok\s+)?done\s*[.!✅👍🙏]*\s*$/iu;
// Net ou commission, comme montantsPresDuNet de l'Assistant (agent/outils.js, un test compare) : le mot et un montant dans la même phrase
// (« ok net 1,800 THB »), ou le mot « commission » seul. Pas « cost » ici : un client demande souvent le « cost ».
const MOT_NET = re("nets?|nett|net rates?|agent rates?|contract rates?|b2b|tarifs? agences?|prix agences?|prix d'?achat|marges?|margins?");
const COMMISSION = re("commissions?|ค่าคอม");
const AVEC_MONTANT = new RegExp(MONTANT);
const net = (p) => p.split(/\n+|(?<=[.!?;])\s+/).some((phrase) => MOT_NET.test(phrase) && AVEC_MONTANT.test(phrase));
// « 2 pax 1,350 THB » : le jargon des prestataires, avec un prix.
const PAX_PRIX = new RegExp(`${L}\\d{1,2} ?pax${R}[\\s\\S]{0,40}?${MONTANT}|${MONTANT}[\\s\\S]{0,40}?${L}\\d{1,2} ?pax${R}`, "u");
// Thaï : une phrase, pas une particule de politesse (« ค่ะ », « คะ », « ครับ »).
const PARTICULES = /ค่ะ|คะ|ค่า|ครับ|คับ|นะ|จ้า|จ้ะ/gu;
const thaiPhrase = (t) => (String(t).replace(PARTICULES, "").match(/[฀-๿]/gu) || []).length >= 12;

const vivants = (messages = []) => messages.filter((m) => m && !m.supprime_le && m.type !== "reaction" && m.type !== "non_transmis");

// Les repères d'une conversation : { v, codes: { code: nombre }, score, nets, calcule_le }. Jamais un texte. Contact personnel : rien.
export function signauxPartenaire(messages = [], { conv = null, maintenant = new Date().toISOString() } = {}) {
  if (conv && conv.reponses === "jamais") return { v: VERSION_SIGNAUX, jamais: true, calcule_le: maintenant };
  const codes = {};
  let duContact = 0;
  let entrant = false;
  const ajoute = (c) => {
    codes[c] = (codes[c] || 0) + 1;
    if (entrant) duContact++;
  };
  const lus = vivants(messages);
  // Nani qui écrit en thaï à quelqu'un qui lui écrit en thaï : rien de particulier (un client thaï).
  const contactThai = lus.some((m) => m.sens === "entrant" && thaiPhrase(texteDe(m)));
  for (const m of lus) {
    const brut = texteDe(m);
    if (!brut) continue;
    const p = plat(brut);
    entrant = m.sens === "entrant";
    // Le formulaire du site (« Transfer request: … Price on the site: … ») est celui d'un client.
    if (m.sens === "entrant" && /^\s*transfer request\s*:/i.test(brut)) continue;
    if (COMMISSION.test(p) || net(p)) ajoute("commission");
    if (PAX_PRIX.test(p)) ajoute("pax_prix");
    if (m.sens === "sortant") {
      if (transfert(brut)) ajoute("transfert_demande");
      if (question(brut) && DISPO.test(p)) ajoute("dispo_demandee");
      if (CLIENTS_NANI.test(p) && !SERVICE_CLIENT.test(p)) ajoute("clients_nani");
      if (!contactThai && thaiPhrase(brut)) ajoute("thai_nani");
    } else if (m.sens === "entrant") {
      if (!question(brut) && PRIX_CONTACT.test(p)) ajoute("prix_du_contact");
      if (CLIENTS_CONTACT.test(p) && !SOI_CLIENT.test(p) && !SERVICE_CLIENT.test(p)) ajoute("clients_contact");
      if (PRISE.test(p)) ajoute("prise_en_charge");
      if (SUR_PLACE.test(p) || FAIT_SEUL.test(brut)) ajoute("sur_place");
    }
  }
  const presents = Object.keys(codes);
  const score = presents.reduce((s, c) => s + (POIDS[c] || 0), 0);
  return { v: VERSION_SIGNAUX, codes, du_contact: duContact, score, nets: score >= SEUIL_NETS && presents.length >= 2 && duContact > 0, calcule_le: maintenant };
}

// Ce que le tri reçoit, sans aucun texte : une ligne courte par repère trouvé. Des indices, jamais des faits (relecture n° 3).
const LIBELLES_REPERES = {
  transfert_demande: "Nani transfère une demande de client",
  dispo_demandee: "Nani demande une disponibilité",
  prix_du_contact: "le contact annonce un prix",
  pax_prix: "« pax » avec un prix",
  clients_nani: "Nani parle de clients",
  clients_contact: "le contact parle de clients",
  prise_en_charge: "prise en charge",
  sur_place: "« sur place » ou « done »",
  thai_nani: "Nani écrit en thaï",
  commission: "net ou commission",
};
export function lignesReperes(signaux) {
  const codes = (signaux && !signaux.jamais && signaux.codes) || {};
  return Object.keys(LIBELLES_REPERES).filter((c) => codes[c]).map((c) => LIBELLES_REPERES[c]);
}

// La décision « type du contact » lue dans la réponse JSON du tri : { type, raison } ou null. La raison : 120 caractères, sans aucun chiffre
// (relecture finale : « gives net 1,800 THB » ne garde pas son montant), ni monnaie qui le suivait.
export function lireTypeDecision(j) {
  if (!j || typeof j !== "object" || !TYPES_DECISION.includes(j.type_contact)) return null;
  const raison = String(typeof j.raison_type === "string" ? j.raison_type : "")
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/g, " ")
    .replace(/(?:[฿$€]\s*)?\+?\d(?:[\d\s.,'’\-()/]*\d)?(?:\s*(?:thb|bahts?|฿|usd|eur(?:os?)?|chf|€|\$|k)(?![\p{L}]))?/giu, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return { type: j.type_contact, raison };
}
// La décision telle qu'elle part à la base (whatsapp_ajouter_avis_type) : avec l'id du message trié (« m »).
export const decisionPourBase = (decision, messageId = null) =>
  decision && TYPES_DECISION.includes(decision.type) ? { type: decision.type, raison: String(decision.raison || "").slice(0, 120), m: messageId ? String(messageId) : null } : null;

// type_avis après une nouvelle décision, comme whatsapp_ajouter_avis_type (un test PGlite compare) : une décision par message (la nouvelle
// remplace celle du même message), les 5 dernières, la plus récente en dernier. Sert à la démo et aux tests ; la fonction passe par la base.
export function avisApres(avis, decision, maintenant = new Date().toISOString()) {
  const avant = Array.isArray(avis && avis.decisions) ? avis.decisions.filter((d) => d && TYPES_DECISION.includes(d.type)) : [];
  if (!decision || !TYPES_DECISION.includes(decision.type)) return { v: 1, decisions: avant.slice(-DECISIONS_GARDEES) };
  const m = decision.m || null;
  const garde = m ? avant.filter((d) => d.m !== m) : avant;
  return { v: 1, decisions: [...garde, { type: decision.type, raison: decision.raison || "", m, le: maintenant }].slice(-DECISIONS_GARDEES) };
}

// Les décisions « type du contact » d'une conversation. Seule la décision type_contact du tri compte : l'ancien motif « partenaire » ne compte
// plus (relecture n° 3).
export function decisionsDe(conv) {
  return conv && conv.type_avis && Array.isArray(conv.type_avis.decisions) ? conv.type_avis.decisions.filter((x) => x && TYPES_DECISION.includes(x.type)) : [];
}
// La dernière décision qui dit quelque chose (« inconnu » ne dit rien : un « ok » d'un partenaire).
const derniereNette = (decisions) => [...decisions].reverse().find((d) => d.type !== "inconnu") || null;
// Des repères nets : jamais sans un repère venu du contact (les repères gardés avant la relecture finale n'ont pas ce compte : ils ne comptent
// pas, la reprise les refait).
const signauxNets = (conv) => !!(conv && conv.type_signaux && conv.type_signaux.nets === true && !conv.type_signaux.jamais && conv.type_signaux.du_contact > 0);
// Une conversation reliée à une fiche client ou à un dossier n'est jamais déduite partenaire : la base effacerait le lien client
// (whatsapp_reclasser) et les apprentissages (oublier_apprentissages). Relecture n° 1.
export const relieeAuClient = (conv) => !!conv && (!!conv.client_id || !!conv.dossier_id);

// Nani a posé (ou retiré) le type : jamais touché. Avant la migration 110, un type posé n'a pas de source : il est à Nani.
export const typeDeNani = (conv) => !!conv && (conv.type_source === "nani" || (!!conv.type_contact && conv.type_source !== "deduit"));

// Le type à poser par la fonction, ou null. Seul « partenaire » se déduit, sur 2 décisions du tri venues de 2 messages différents ; le client
// reste le défaut, un apporteur ou un contact personnel se choisissent toujours à la main.
export function typeADeduire(conv) {
  if (!conv || conv.type_contact || conv.type_source || conv.reponses === "jamais" || conv.partenaire_id || relieeAuClient(conv)) return null;
  const decisions = decisionsDe(conv);
  const derniere = derniereNette(decisions);
  if (!derniere || derniere.type !== "partenaire") return null;
  const messages = new Set(decisions.filter((d) => d.type === "partenaire" && d.m).map((d) => d.m));
  return messages.size >= 2 ? "partenaire" : null;
}

// Un partenaire posé (par Nani ou déduit) ou relié à une fiche partenaire : seul cas traité en partenaire (consigne partenaire, contexte client
// retiré, hors étapes, « Prêt à réserver » et tri). Jamais sur des repères ni sur une décision seule.
export const contactPartenaire = (conv) => !!conv && (conv.type_contact === "partenaire" || !!conv.partenaire_id);
export const traiterEnPartenaire = (conv) => !!conv && conv.reponses !== "jamais" && contactPartenaire(conv);
export const partenaireDeduit = (conv) => !!conv && conv.type_contact === "partenaire" && conv.type_source === "deduit";
// Partenaire posé, ou probable : pas encore de type, et la dernière décision du tri dit « partenaire », ou les repères sont nets. Sert
// seulement à la prudence sur le prix (prixDeVentePermis) et à la ligne « Partenaire probable » de l'écran.
export function partenaireProbable(conv) {
  if (!conv || conv.reponses === "jamais") return false;
  if (contactPartenaire(conv)) return true;
  if (conv.type_contact || conv.type_source === "nani") return false;
  const derniere = derniereNette(decisionsDe(conv));
  return (!!derniere && derniere.type === "partenaire") || signauxNets(conv);
}
// Un prix écrit par Nani dans cette conversation peut-il servir de prix de vente ? Jamais pour un partenaire, posé ou probable : le prix reste
// à fixer (règle à appeler par la #318 et par la réponse préparée).
export const prixDeVentePermis = (conv) => !!conv && conv.reponses !== "jamais" && !partenaireProbable(conv);
// La raison à montrer à Nani : celle de la dernière décision « partenaire », sinon les repères.
export function raisonPartenaire(conv) {
  const d = [...decisionsDe(conv)].reverse().find((x) => x.type === "partenaire" && x.raison);
  if (d) return d.raison;
  const l = lignesReperes(conv && conv.type_signaux);
  return l.length ? l.slice(0, 2).join(" ; ") : "";
}
