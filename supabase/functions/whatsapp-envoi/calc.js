// Fonction « whatsapp-envoi » : la logique pure (demande, message Telnyx). Tests : tests/gestion-whatsapp.test.js.
export const TEXTE_MAX_OCTETS = 4096; // limite de Telnyx pour un texte WhatsApp
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Rend { conversation_id, texte, proposition_id } ou { erreur }.
export function lireEnvoi(d) {
  if (!d || typeof d !== "object") return { erreur: "demande_invalide" };
  if (typeof d.conversation_id !== "string" || !UUID.test(d.conversation_id)) return { erreur: "conversation_invalide" };
  const texte = typeof d.texte === "string" ? d.texte.replace(/\r\n?/g, "\n").trim() : "";
  if (!texte) return { erreur: "texte_vide" };
  if (new TextEncoder().encode(texte).length > TEXTE_MAX_OCTETS) return { erreur: "texte_trop_long" };
  const proposition_id = typeof d.proposition_id === "string" && UUID.test(d.proposition_id) ? d.proposition_id : null;
  return { conversation_id: d.conversation_id, texte, proposition_id };
}

// Corps de POST https://api.telnyx.com/v2/messages/whatsapp (texte libre, possible dans la fenêtre de 24 h).
// webhook : adresse des statuts de ce message (message.sent, message.finalized, message.read), sinon celle du profil de messagerie.
export const corpsTelnyx = ({ de, vers, texte, webhook }) => ({
  from: de,
  to: vers,
  whatsapp_message: { type: "text", text: { body: texte, preview_url: false } },
  ...(typeof webhook === "string" && /^https:\/\//.test(webhook) ? { webhook_url: webhook } : {}),
});

// Réponse de Telnyx : l'id du message, ou l'erreur (code court, jamais la clé).
export function lireReponseTelnyx(statut, corps) {
  const id = corps && corps.data && typeof corps.data.id === "string" ? corps.data.id : null;
  if (statut >= 200 && statut < 300 && id) return { ok: true, id };
  const code = corps && Array.isArray(corps.errors) && corps.errors[0] ? String(corps.errors[0].code || "") : "";
  return { ok: false, erreur: "telnyx_refuse", code: code.replace(/[^0-9A-Za-z_-]/g, "").slice(0, 20), statut };
}
