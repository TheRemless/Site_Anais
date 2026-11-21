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

// ---- Voucher en image dans la conversation du client (21.11.2026, demande de Jérémy) ------------------------------------------------
// Doc lue le 21.11.2026 : developers.telnyx.com/docs/messaging/whatsapp/send-messages (image par lien, légende de 1024 octets),
// developers.telnyx.com/api-reference/whatsapp-phone-numbers (coexistence_state, conversation_window), Meta (PNG, JPEG ou WebP, 5 Mo,
// cache de 10 minutes d'un média envoyé par lien). Tests : tests/gestion-whatsapp-voucher.test.js.
export const LEGENDE_MAX_OCTETS = 1024;
export const IMAGE_MAX_OCTETS = 5 * 1024 * 1024;
// Bucket privé de la migration 73 : l'image n'y reste que le temps que Telnyx la télécharge.
export const BUCKET_SORTANT = "whatsapp-sortant";
// URL signée de 15 minutes : Telnyx ne dit pas quand il télécharge, Meta le fait d'ordinaire dans la minute.
export const URL_SIGNEE_S = 15 * 60;
// Un fichier encore là après une heure est effacé par la purge de la fonction « whatsapp » (toutes les 5 minutes avec la reprise).
export const SORTANT_DUREE_MS = 3600_000;
// L'état de coexistence du numéro est relu au plus toutes les 3 minutes par instance.
export const COEXISTENCE_CACHE_MS = 3 * 60_000;
// Le même voucher vers la même conversation ne repart pas pendant 2 minutes (double tap, nouvel essai après un délai).
export const VERROU_VOUCHER_MS = 2 * 60_000;
const MIMES_IMAGE = ["image/png", "image/jpeg", "image/webp"];

// Rend { conversation_id, reservation_id, legende } ou { erreur }. La légende peut être vide (l'image part seule).
export function lireEnvoiVoucher(d) {
  if (!d || typeof d !== "object") return { erreur: "demande_invalide" };
  if (typeof d.conversation_id !== "string" || !UUID.test(d.conversation_id)) return { erreur: "conversation_invalide" };
  if (typeof d.reservation_id !== "string" || !UUID.test(d.reservation_id)) return { erreur: "reservation_invalide" };
  const legende = typeof d.legende === "string" ? d.legende.replace(/\r\n?/g, "\n").trim() : "";
  if (new TextEncoder().encode(legende).length > LEGENDE_MAX_OCTETS) return { erreur: "legende_trop_longue" };
  return { conversation_id: d.conversation_id, reservation_id: d.reservation_id, legende };
}

// Le type réel d'une image, lu dans ses premiers octets (le type annoncé par le navigateur ne compte pas). null si ce n'en est pas une.
export function typeImage(o) {
  if (!o || !o.length) return null;
  if (o.length > 8 && o[0] === 0x89 && o[1] === 0x50 && o[2] === 0x4e && o[3] === 0x47 && o[4] === 0x0d && o[5] === 0x0a && o[6] === 0x1a && o[7] === 0x0a) return "image/png";
  if (o.length > 3 && o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff) return "image/jpeg";
  if (o.length > 12 && String.fromCharCode(...o.slice(0, 4)) === "RIFF" && String.fromCharCode(...o.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
// L'image reçue : PNG, JPEG ou WebP, 5 Mo au plus. Rend { ok, mime } ou { erreur }.
export function imageAcceptee(octets) {
  if (!octets || !octets.length) return { erreur: "image_invalide" };
  if (octets.length > IMAGE_MAX_OCTETS) return { erreur: "image_trop_grosse" };
  const mime = typeImage(octets);
  return mime && MIMES_IMAGE.includes(mime) ? { ok: true, mime } : { erreur: "image_invalide" };
}

// Chemin dans le bucket privé : <organisation>/<horodatage>-<id>.<ext>, à plat (la purge liste un seul dossier). Rien du client dedans.
export function cheminSortant(organisation, id, mime = "image/png", maintenant = Date.now()) {
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  return `${String(organisation).replace(/[^0-9a-f-]/gi, "")}/${maintenant}-${String(id).replace(/[^0-9a-z-]/gi, "")}.${ext}`;
}

// Seule la conversation du client du dossier peut recevoir son voucher. Jamais celle d'un prestataire ni un contact personnel.
//   * reliée au dossier (dossier_id), ou au client du dossier (client_id) ; un client relié qui n'est pas celui du dossier ferme ;
//   * type « client », ou pas encore typée sans être un contact personnel (reponses = 'jamais' sans type, migration 68).
// Même règle à l'écran : src/gestion/js/whatsapp-voucher-calc.mjs (un test compare les deux).
export function contactVoucher(conv, dossier) {
  if (!conv || !dossier || !dossier.id) return { ok: false, erreur: "conversation_autre_dossier" };
  const memeClient = !!conv.client_id && !!dossier.client_id && conv.client_id === dossier.client_id;
  const memeDossier = !!conv.dossier_id && conv.dossier_id === dossier.id && (!conv.client_id || memeClient);
  if (!memeClient && !memeDossier) return { ok: false, erreur: "conversation_autre_dossier" };
  const type = conv.type_contact ?? null;
  if (type === null && conv.reponses === "jamais") return { ok: false, erreur: "contact_personnel" };
  if (type !== null && type !== "client") return { ok: false, erreur: "contact_non_client" };
  return { ok: true };
}

// Corps de POST https://api.telnyx.com/v2/messages/whatsapp pour une image par lien (seule voie documentée de bout en bout).
export const corpsTelnyxImage = ({ de, vers, lien, legende, webhook }) => ({
  from: de,
  to: vers,
  whatsapp_message: { type: "image", image: { link: lien, ...(legende ? { caption: legende } : {}) } },
  ...(typeof webhook === "string" && /^https:\/\//.test(webhook) ? { webhook_url: webhook } : {}),
});
// Meta garde 10 minutes en cache un média envoyé par lien : « v » rend chaque lien unique.
export const lienAvecVersion = (url, v) => `${url}${String(url).includes("?") ? "&" : "?"}v=${encodeURIComponent(String(v))}`;

// GET /v2/whatsapp/phone_numbers/{numero} : { etat } lu, ou { etat: null } si la réponse ne dit rien de sûr. Seul « active » permet d'envoyer.
export function lireCoexistence(statut, corps) {
  const etat = statut >= 200 && statut < 300 && corps && corps.data && typeof corps.data.coexistence_state === "string" ? corps.data.coexistence_state.slice(0, 40) : null;
  return { etat, active: etat === "active" };
}
// GET /v2/whatsapp/phone_numbers/{numero}/conversation_window : ouverte seulement si Telnyx le dit clairement. En cas de doute, fermée.
export function lireFenetreTelnyx(statut, corps, maintenant = Date.now()) {
  if (!(statut >= 200 && statut < 300) || !corps || !corps.data || corps.data.window_active !== true) return false;
  const fin = corps.data.window_expires_at ? Date.parse(corps.data.window_expires_at) : NaN;
  return Number.isNaN(fin) ? !corps.data.window_expires_at : fin > maintenant;
}
export const adresseCoexistence = (numero) => `https://api.telnyx.com/v2/whatsapp/phone_numbers/${encodeURIComponent(numero)}`;
export const adresseFenetre = (numero, client) => `${adresseCoexistence(numero)}/conversation_window?destination_number=${encodeURIComponent(client)}`;

// Le média rangé dans le fil : une image envoyée depuis Gestion, sans fichier gardé. `chemin_sortant` : le fichier temporaire, vidé quand
// il est effacé (jamais « chemin » : rien ne doit le chercher dans le stockage « whatsapp »). reservation_id sert au verrou.
export const mediaVoucher = ({ nom, taille, mime, chemin, reservation_id }) => ({ type: "image", mime, taille, nom: String(nom || "").slice(0, 120), statut: "voucher", chemin_sortant: chemin, reservation_id });
// Les fichiers temporaires d'une liste de médias, et la liste une fois les fichiers effacés.
export const cheminsSortants = (medias = []) => (Array.isArray(medias) ? medias : []).map((m) => m && m.chemin_sortant).filter((c) => typeof c === "string" && c);
export const sansFichierSortant = (medias = []) => (Array.isArray(medias) ? medias : []).map((m) => (m && m.chemin_sortant ? { ...m, chemin_sortant: null } : m));
// Un statut qui prouve que Meta a pris l'image (remis, lu) ou qu'elle ne partira plus (échec) : le fichier peut être effacé.
export const statutLibereFichier = (statut) => ["remis", "lu", "echec"].includes(statut);
// La purge : les fichiers de plus d'une heure (liste du stockage, { name, created_at }) d'un dossier d'organisation.
export function sortantsAPurger(objets = [], dossier, maintenant = Date.now(), duree = SORTANT_DUREE_MS) {
  return (objets || [])
    .filter((o) => o && typeof o.name === "string" && o.name && o.id !== null)
    .filter((o) => {
      const t = Date.parse(o.created_at || "") || Number(String(o.name).split("-")[0]) || NaN;
      return Number.isFinite(t) && maintenant - t > duree;
    })
    .map((o) => `${dossier}/${o.name}`);
}
// Le verrou : un voucher de cette réservation parti de Gestion dans cette conversation depuis moins de 2 minutes.
export const voucherRecent = (messages = [], reservationId) => (messages || []).some((m) => Array.isArray(m.medias) && m.medias.some((x) => x && x.reservation_id === reservationId));
export const cleVerrouVoucher = (reservationId, maintenant = Date.now()) => `gestion-voucher:${reservationId}:${Math.floor(maintenant / VERROU_VOUCHER_MS)}`;
