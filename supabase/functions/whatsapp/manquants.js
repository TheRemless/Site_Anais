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
//      - une modification ou une suppression : appliquée comme par message.received (rien de nouveau dans le fil).
// 2. Repérage sans webhook : Nani répond depuis l'app alors que le dernier message de la conversation était déjà à elle et date de plus de
//    6 heures, ou elle cite un message inconnu de Gestion. Repère discret, sans IA ni notification.
import { e164, bsuidSur, nonTransmis, texteNonTransmis, nomProfil, texteDe, mediasDe, dateMessage, texteSur, typeSur } from "./calc.js";

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
    // Corps au format Telnyx : seulement un message entrant (un écho de Nani n'est jamais un message du client).
    if (estObjet(x.body) && x.direction !== "outbound" && !x.body.to_user_id && (x.body.from_user_id || x.body.from)) return void out.push({ messages: [x.body], contacts: x.body.contacts || x.contacts });
  };
  voir(payload, 0);
  return out;
}

// Le numéro de l'entreprise dans la value Meta (metadata.display_phone_number), s'il est là.
const numeroEntreprise = (v) => e164(v && v.metadata && v.metadata.display_phone_number);

// Ce que devient un événement du webhook WABA. null si ce n'en est pas un. Sinon { action: "lot", actions: [...] } (une action par message)
// ou { action: "ignorer", raison }. Les actions ont la forme de interpreter (calc.js) : « rattrapage » ou « non_transmis ».
export function interpreterWaba(ev) {
  if (!ev || !TYPES_WABA.includes(ev.type)) return null;
  const valeurs = valeursMeta(ev.payload || {});
  const actions = [];
  for (const v of valeurs) {
    const contacts = Array.isArray(v.contacts) ? v.contacts : [];
    for (const m of Array.isArray(v.messages) ? v.messages : []) {
      if (!estObjet(m) || actions.length >= LOT_MAX) continue;
      // Le contact du message ; le seul de la liste s'il n'y en a qu'un (jamais le premier d'un lot de plusieurs clients).
      const contact = contacts.find((c) => c && ((c.user_id && c.user_id === m.from_user_id) || (c.wa_id && c.wa_id === m.from))) || (contacts.length === 1 ? contacts[0] : null);
      const telephone = e164(m.from) || e164(contact && contact.wa_id);
      const bsuid = bsuidSur(m.from_user_id) || bsuidSur(contact && contact.user_id);
      if (!telephone && !bsuid) continue;
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
          ? { action: "modifier", telephone, bsuid, original: original.slice(0, 200), texte: texteSur(m.edit?.message?.text?.body), quand }
          : { action: "supprimer", telephone, bsuid, original: original.slice(0, 200), quand });
        continue;
      }
      const manque = nonTransmis(m);
      const rang = actions.length;
      actions.push({
        action: manque ? "non_transmis" : "rattrapage",
        telephone,
        bsuid,
        entreprise: numeroEntreprise(v),
        nom: nomProfil({ body: { contacts: contact ? [contact] : [] } }),
        message: {
          // Un événement ne range qu'un message (index unique sur evenement_id) : les suivants du même lot ont leur propre clé.
          evenement_id: rang ? `${ev.id}#${rang}` : ev.id,
          telnyx_id: null,
          meta_id: wamid,
          sens: "entrant",
          origine: "client",
          type: manque ? "non_transmis" : typeSur(m.type),
          texte: manque ? texteNonTransmis(quand) : texteDe(m),
          medias: manque ? [] : mediasDe(m),
          envoye_le: quand,
          repond_a: typeof m.context?.id === "string" ? m.context.id.slice(0, 200) : null,
        },
      });
    }
  }
  if (actions.length) return { action: "lot", actions };
  // Statuts d'envoi (déjà reçus par message.finalized), ou rien de lisible : gardé brut seulement.
  return { action: "ignorer", raison: valeurs.some((v) => Array.isArray(v.statuses) && v.statuses.length) ? "waba_statut" : "waba_vide" };
}

// Un rattrapage attend un peu que message.received arrive le premier (il porte l'id Telnyx). recuLe : réception de l'événement WABA.
export function rattrapageAttend(recuLe, maintenant = Date.now()) {
  const t = Date.parse(recuLe || "");
  return Number.isFinite(t) && maintenant - t < RATTRAPAGE_ATTENTE_MS;
}

// Repérage sans webhook, sur un message de Nani envoyé depuis l'app (écho). precedent : le message d'avant dans la conversation
// ({ sens, envoye_le }) ou null ; citeInconnu : il cite un message que Gestion n'a pas. Rend la raison, ou null.
export function sembleManquer({ envoyeLe, precedent = null, citeInconnu = false } = {}) {
  if (citeInconnu) return "cite_inconnu";
  if (!precedent || precedent.sens !== "sortant") return null;
  const t = Date.parse(envoyeLe || "");
  const avant = Date.parse(precedent.envoye_le || "");
  if (!Number.isFinite(t) || !Number.isFinite(avant)) return null;
  return t - avant > SILENCE_MS ? "silence" : null;
}
