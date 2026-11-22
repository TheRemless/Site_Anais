// Fonction « whatsapp » : les messages de clients que Telnyx ne transmet pas au profil de messagerie (migration 100, 22.11.2026).
// Aucune dépendance : sert à la fonction et aux tests (tests/gestion-whatsapp-manquants.test.js).
//
// 1. Webhook du compte WhatsApp (WABA) : Telnyx y relaie les messages de Meta sous le type « whatsapp.messages » (doc Telnyx « Coexistence
//    Webhooks », lue le 22.11.2026). La forme du contenu n'est pas documentée : on cherche l'objet « value » de Meta (messages, contacts) dans
//    l'enveloppe Telnyx, ou dans le corps Meta relayé tel quel (calc.js, enveloppeMeta).
//      - un message déjà reçu par message.received (même wamid) : rien ;
//      - un message qui n'existe que sur ce canal : rangé normalement, c'est un rattrapage (après RATTRAPAGE_ATTENTE_MS, pour laisser
//        message.received arriver le premier avec l'id Telnyx dont les modifications et suppressions ont besoin) ;
//      - un « unsupported », ou l'erreur 131060 ou 131051 : la ligne « Message du client non transmis par WhatsApp » ;
//      - une modification ou une suppression : appliquée comme par message.received (rien de nouveau dans le fil) ;
//      - seulement pour le numéro de Nani (whatsapp_reglages.numero) : un autre numéro du compte, ou un numéro inconnu, est ignoré, et
//        un message dont l'expéditeur est le numéro de Nani aussi. Ce canal ne réécrit jamais whatsapp_reglages.numero (index.ts).
// 2. Repérage sans webhook, sur une réponse de Nani depuis l'app, pour un client seulement (jamais un partenaire, un chauffeur, un hôtel,
//    un apporteur, une fiche partenaire ni un Contact personnel) :
//      - le message d'avant était déjà à elle, date de plus de 6 heures, et sa réponse ressemble à une réponse (prix, oui ou non,
//        confirmation, heure, « how can I help ») et pas à une relance ni à un message commercial ;
//      - c'est le premier message connu de la conversation, et c'est une vraie réponse (oui ou non, prix, « how can I help ») ;
//      - ou elle cite un message passé par Telnyx (id Telnyx, donc reçu depuis le 20.11.2026) que Gestion n'a pas. Un wamid cité ne se date
//        pas : aucun repère.
//    Repère discret, sans IA ni notification.
import { e164, bsuidSur, nonTransmis, nomProfil, texteDe, mediasDe, dateMessage, texteSur, typeSur } from "./calc.js";

export const TYPES_WABA = ["whatsapp.messages", "whatsapp.message"];
export const RATTRAPAGE_ATTENTE_MS = 2 * 60_000;
export const SILENCE_MS = 6 * 3600_000;
export const REPERE = "semble_manquer";
const LOT_MAX = 20;

const estObjet = (v) => v && typeof v === "object" && !Array.isArray(v);

// Les objets « value » de Meta présents dans l'événement, quelle que soit l'enveloppe : la value elle-même, { value }, { changes },
// { entry: [{ changes }] }, ou une liste de ceux-ci.
export function valeursMeta(payload) {
  const out = [];
  const voir = (x, profondeur) => {
    if (profondeur > 8 || out.length >= LOT_MAX || !x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.slice(0, LOT_MAX).forEach((y) => voir(y, profondeur + 1));
    if (Array.isArray(x.messages) || Array.isArray(x.statuses)) return void out.push(x);
    if (estObjet(x.value)) return voir(x.value, profondeur + 1);
    if (Array.isArray(x.changes)) return voir(x.changes.filter((c) => !c || !c.field || c.field === "messages"), profondeur + 1);
    if (Array.isArray(x.entry)) return voir(x.entry, profondeur + 1);
    // Corps au format Telnyx : seulement un message entrant (un écho de Nani n'est jamais un message du client). Le numéro de l'entreprise
    // est son destinataire.
    if (estObjet(x.body) && x.direction !== "outbound" && !x.body.to_user_id && (x.body.from_user_id || x.body.from)) {
      const dest = Array.isArray(x.to) ? x.to[0] : x.to;
      return void out.push({ messages: [x.body], contacts: x.body.contacts || x.contacts, metadata: { display_phone_number: e164(dest) } });
    }
  };
  voir(payload, 0);
  return out;
}

// Le numéro de l'entreprise dans la value Meta (metadata.display_phone_number), s'il est là.
const numeroEntreprise = (v) => e164(v && v.metadata && v.metadata.display_phone_number);

// Ce que devient un événement du webhook WABA. null si ce n'en est pas un. Sinon { action: "lot", actions: [...] } (une action par message)
// ou { action: "ignorer", raison }. Les actions ont la forme de interpreter (calc.js) : « rattrapage », « non_transmis », « modifier » ou
// « supprimer ». numero : le numéro de Nani (whatsapp_reglages.numero) ; inconnu, rien n'est rangé.
export function interpreterWaba(ev, { numero = null } = {}) {
  if (!ev || !TYPES_WABA.includes(ev.type)) return null;
  const valeurs = valeursMeta(ev.payload || {});
  const nani = e164(numero);
  const actions = [];
  let autreNumero = false;
  for (const v of valeurs) {
    // Un autre numéro du compte WhatsApp (ou un numéro illisible) : jamais rangé dans la boîte de Nani.
    if (!nani || numeroEntreprise(v) !== nani) {
      if (Array.isArray(v.messages) && v.messages.length) autreNumero = true;
      continue;
    }
    const contacts = Array.isArray(v.contacts) ? v.contacts : [];
    for (const m of Array.isArray(v.messages) ? v.messages : []) {
      if (!estObjet(m) || actions.length >= LOT_MAX) continue;
      // Le contact du message ; le seul de la liste seulement s'il ne porte pas un autre numéro que l'expéditeur.
      const seul = contacts.length === 1 && contacts[0] && (!contacts[0].wa_id || contacts[0].wa_id === m.from) ? contacts[0] : null;
      const contact = contacts.find((c) => c && ((c.user_id && c.user_id === m.from_user_id) || (c.wa_id && c.wa_id === m.from))) || seul;
      const telephone = e164(m.from) || e164(contact && contact.wa_id);
      const bsuid = bsuidSur(m.from_user_id) || bsuidSur(contact && contact.user_id);
      if (!telephone && !bsuid) continue;
      // L'entreprise ne s'écrit pas à elle-même.
      if (telephone && telephone === nani) continue;
      // Corps au format Telnyx : le wamid est dans foreign_id ; au format Meta, dans id.
      const brutId = typeof m.foreign_id === "string" && m.foreign_id ? m.foreign_id : m.id;
      const wamid = typeof brutId === "string" && brutId ? brutId.slice(0, 200) : null;
      const quand = dateMessage(m, ev.survenu_le);
      // Modification ou suppression par le client : appliquée comme par message.received (sans effet si c'est déjà fait), jamais rangée
      // comme un nouveau message.
      if (m.type === "edit" || m.type === "revoke") {
        const original = m.type === "edit" ? m.edit?.original_message_id : m.revoke?.original_message_id;
        if (typeof original !== "string" || !original) continue;
        actions.push(m.type === "edit"
          ? { action: "modifier", telephone, bsuid, waba: true, original: original.slice(0, 200), texte: texteSur(m.edit?.message?.text?.body), quand }
          : { action: "supprimer", telephone, bsuid, waba: true, original: original.slice(0, 200), quand });
        continue;
      }
      const manque = nonTransmis(m);
      const rang = actions.length;
      actions.push({
        action: manque ? "non_transmis" : "rattrapage",
        telephone,
        bsuid,
        // Jamais réécrit depuis ce canal (index.ts) : waba marque l'origine.
        entreprise: null,
        waba: true,
        nom: nomProfil({ body: { contacts: contact ? [contact] : [] } }),
        message: {
          // Un événement ne range qu'un message (index unique sur evenement_id) : les suivants du même lot ont leur propre clé.
          evenement_id: rang ? `${ev.id}#${rang}` : ev.id,
          telnyx_id: null,
          meta_id: wamid,
          sens: "entrant",
          origine: "client",
          type: manque ? "non_transmis" : typeSur(m.type),
          // La ligne n'a pas de texte : l'écran l'écrit, et rien ne part à l'IA (ni le tri, ni la réponse, ni le suivi, ni l'Assistant).
          texte: manque ? null : texteDe(m),
          medias: manque ? [] : mediasDe(m),
          envoye_le: quand,
          repond_a: typeof m.context?.id === "string" ? m.context.id.slice(0, 200) : null,
        },
      });
    }
  }
  if (actions.length) return { action: "lot", actions };
  if (autreNumero) return { action: "ignorer", raison: "waba_autre_numero" };
  // Statuts d'envoi (déjà reçus par message.finalized), ou rien de lisible : gardé brut seulement.
  return { action: "ignorer", raison: valeurs.some((v) => Array.isArray(v.statuses) && v.statuses.length) ? "waba_statut" : "waba_vide" };
}

// Un rattrapage attend un peu que message.received arrive le premier (il porte l'id Telnyx). recuLe : réception de l'événement WABA.
export function rattrapageAttend(recuLe, maintenant = Date.now()) {
  const t = Date.parse(recuLe || "");
  return Number.isFinite(t) && maintenant - t < RATTRAPAGE_ATTENTE_MS;
}

// Repérage sans webhook : seulement pour un client (conversation non typée ou typée « client », sans fiche partenaire, pas un Contact
// personnel). Un partenaire, un chauffeur ou un hôtel reçoit souvent une relance de Nani après un long silence : jamais de repère.
export function repereAutorise(conv) {
  if (!conv) return false;
  if (conv.reponses === "jamais" || conv.partenaire_id) return false;
  return conv.type_contact === null || conv.type_contact === undefined || conv.type_contact === "client";
}

// Une réponse de Nani qui répond à quelque chose (prix, oui ou non, confirmation, disponibilité, heure), et pas une relance (« would you
// like to book », « any news », « just checking »…). Règle mesurée sur les messages du 20 au 22.11.2026 (docs/gestion/whatsapp.md).
const RELANCE = /\b(would you like|do you (?:still )?want|are you still|still interested|any news|any updates?|just (?:checking|following up)|following up|follow up|did you (?:have|get|see|receive|manage)|have you (?:had|decided|seen|received)|reminder|toujours (?:partant|intéressée?|ok)|des nouvelles|as-tu (?:pu|eu|vu)|avez-vous (?:pu|eu|vu)|revenir vers (?:vous|toi)|je me permets de (?:revenir|vous relancer|te relancer)|relancer)\b/i;
const PRIX = /\d[\d'’,.\s]*\s?(?:thb|baht|฿|chf|eur|€|usd|\$)|\b(?:price|prices|prix|tarif|cost|costs|total)\b/i;
const ACCORD = /^[^\p{L}\p{N}]*(?:(?:hello|hi|hey|bonjour|coucou|dear)\b[^\p{L}\p{N}]*(?:\p{L}+[^\p{L}\p{N}]+)?)?(?:yes|yeah|yep|sure|of course|ok|okay|no problem|noted|perfect|great|no|oui|non|d'accord|d’accord|bien sûr|parfait|c'est noté|c’est noté|pas de (?:souci|problème))\b/iu;
const CONFIRME = /\b(?:confirmed|booked|available|availability|dispo|disponib\p{L}*|confirmée?|réservée?|it'?s possible|we can|on peut|c'est possible|c’est possible)/iu;
const HEURE = /\b\d{1,2}[:h.]\d{2}\b|\bat \d{1,2}\s?(?:am|pm)\b|\bà \d{1,2}\s?h\b/i;
// « How can I help you? » répond à un premier message du client qu'on n'a pas.
const AIDE = /\b(?:how can (?:i|we) help|what can (?:i|we) do for you|how may (?:i|we) help|comment (?:puis-je|pouvons-nous) (?:vous|t)['’ ]?aider|en quoi (?:puis-je|pouvons-nous))/i;
// Un message que Nani lance elle-même : remerciement après le séjour, proposition commerciale. Jamais une réponse.
const COMMERCIAL = /\b(?:thank you (?:for|so much for) (?:choosing|staying|booking|your stay|your visit|travell?ing)|thanks for (?:choosing|staying|booking)|hope you (?:enjoyed|had|liked)|we (?:offer|propose)|special offer|promo(?:tion)?s?|discount|newsletter|merci (?:pour|de) votre (?:séjour|confiance|visite)|nous (?:proposons|offrons)|offre spéciale)\b/i;
export function ressembleReponse(texte, { premier = false } = {}) {
  const t = String(texte || "").trim();
  if (!t || RELANCE.test(t) || COMMERCIAL.test(t)) return false;
  // Premier message connu : seulement une vraie réponse (oui ou non, prix, « how can I help »). Une confirmation ou une heure seule peut être
  // un avis que Nani envoie d'elle-même (« your driver is confirmed tomorrow »), et une disponibilité, une question à un prestataire.
  if (premier) return ACCORD.test(t) || PRIX.test(t) || AIDE.test(t);
  return PRIX.test(t) || ACCORD.test(t) || CONFIRME.test(t) || HEURE.test(t) || AIDE.test(t);
}

// Un id Telnyx (UUID) : le message cité est passé par Telnyx, donc depuis le 20.11.2026, et Gestion devrait l'avoir. Un wamid ne se date pas.
export const citationDatable = (id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

// Repérage sans webhook, sur un message de Nani envoyé depuis l'app (écho). conv : la conversation (type_contact, partenaire_id, reponses) ;
// precedent : le message d'avant ({ sens, envoye_le }) ou null ; texte : la réponse de Nani ; citeInconnu : elle cite un id Telnyx que
// Gestion n'a pas. Rend la raison, ou null :
//   « cite_inconnu » ; « premier » : premier message connu de la conversation, et c'est une réponse (le client a écrit avant, Gestion ne
//   l'a pas) ; « silence » : le message d'avant était déjà à Nani, plus de 6 heures avant, et c'est une réponse.
export function sembleManquer({ conv = null, envoyeLe, texte = "", precedent = null, citeInconnu = false } = {}) {
  if (!repereAutorise(conv)) return null;
  if (citeInconnu) return "cite_inconnu";
  if (!precedent) return ressembleReponse(texte, { premier: true }) ? "premier" : null;
  if (precedent.sens !== "sortant") return null;
  const t = Date.parse(envoyeLe || "");
  const avant = Date.parse(precedent.envoye_le || "");
  if (!Number.isFinite(t) || !Number.isFinite(avant)) return null;
  return t - avant > SILENCE_MS && ressembleReponse(texte) ? "silence" : null;
}
