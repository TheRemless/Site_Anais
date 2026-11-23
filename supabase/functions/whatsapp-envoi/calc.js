// Fonction « whatsapp-envoi » : la logique pure (demande, message Telnyx, contrôle du texte). Tests : tests/gestion-whatsapp.test.js.
import { controlerReponse, montantsDuTexte, netsDuControle } from "../agent/outils.js";
export const TEXTE_MAX_OCTETS = 4096; // limite de Telnyx pour un texte WhatsApp
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Les montants que la personne a confirmés après un refus « montant_a_confirmer » : une liste (JSON) ou « 10000,5000 » (multipart).
// 20 au plus, nombres positifs ; tout le reste est ignoré.
export function lireMontantsConfirmes(v) {
  const brut = Array.isArray(v) ? v : typeof v === "string" && v.trim() ? v.split(",") : [];
  return [...new Set(brut.slice(0, 20).map((x) => (typeof x === "number" ? x : typeof x === "string" && /^\s*\d+(?:\.\d+)?\s*$/.test(x) ? Number(x) : NaN)).filter((x) => Number.isFinite(x) && x > 0))];
}

// Rend { conversation_id, texte, proposition_id, montants_confirmes } ou { erreur }.
export function lireEnvoi(d) {
  if (!d || typeof d !== "object") return { erreur: "demande_invalide" };
  if (typeof d.conversation_id !== "string" || !UUID.test(d.conversation_id)) return { erreur: "conversation_invalide" };
  const texte = typeof d.texte === "string" ? d.texte.replace(/\r\n?/g, "\n").trim() : "";
  if (!texte) return { erreur: "texte_vide" };
  if (new TextEncoder().encode(texte).length > TEXTE_MAX_OCTETS) return { erreur: "texte_trop_long" };
  const proposition_id = typeof d.proposition_id === "string" && UUID.test(d.proposition_id) ? d.proposition_id : null;
  return { conversation_id: d.conversation_id, texte, proposition_id, montants_confirmes: lireMontantsConfirmes(d.montants_confirmes) };
}

// ---- Contrôle du texte envoyé (PR 278, faux blocage du 21.11.2026) ---------------------------------------------------------------
// Le texte ou la légende d'un voucher, contrôlés avant tout envoi (contenuInterne, index.ts). Rend { a_retirer, a_confirmer } :
//   - a_retirer bloque (422 « contenu_interne ») : un net d'un service du dossier relié à la conversation, un net, une marge ou une
//     commission du dossier relié (`internes`), un nom de partenaire ou de contact typé ;
//   - a_confirmer (409 « montant_a_confirmer ») : un montant égal au net d'un autre service du catalogue, qui n'est ni un prix de vente du
//     catalogue ou du dossier relié, ni un total : des prix du catalogue qui figurent aussi dans le texte, ou des services du dossier relié
//     (comme la carte de dossier pour l'Assistant). La personne confirme d'un clic, l'écran renvoie la même liste.
// `nets` : netsPourControle ; `servicesEnCours`, `internes`, `ventesDossier` : dossierPourControle (agent/outils.js).
// Revue de sécurité de la PR 306 :
//   - `refs` : les services de la proposition envoyée (whatsapp/proposer.js, servicesDeProposition). Leurs nets bloquent comme ceux du
//     dossier relié, même sans dossier ;
//   - un net bloquant n'est levé que par un prix de vente d'une réservation du dossier relié (`ventesDossier`), jamais par le catalogue ;
//   - `masquer` : la personne n'a pas le droit de voir les nets ; le 409 ne dit pas la valeur et la confirmation porte sur tous les montants
//     du texte ;
//   - `controleImpossible` : les nets n'ont pas pu être relus, rien ne part ;
//   - `portee` : « autre_service » quand des services de la demande sont connus (dossier ou proposition), sinon « catalogue ».
const BLOQUANTS = /^(?:montant_interne|montant_illisible|nom_prestataire|controle_impossible)(?::|$)/;
export function controleEnvoi(texte, { nets = [], refs = new Set(), servicesEnCours = new Set(), internes = new Set(), ventes = new Set(), ventesDossier = [], prestataires = [], masquer = false, controleImpossible = false } = {}) {
  const n = netsDuControle({ nets, refs, servicesEnCours });
  const c = controlerReponse(texte, { signer: true, internes: new Set([...internes, ...n.bloquants]), ventes: new Set([...ventes, ...ventesDossier]), leveInternes: new Set(ventesDossier), netsAutres: n.autres, elementsVente: [...ventes], composants: ventesDossier, prestataires, masquerNets: masquer, controleImpossible });
  const av = c.avertissements || [];
  const a_confirmer = [...new Set(av.filter((a) => a.startsWith("montant_egal_net:")).flatMap((a) => a.slice("montant_egal_net:".length).split(",").map(Number)))].filter(Number.isFinite).sort((x, y) => x - y);
  const portee = refs.size || servicesEnCours.size ? "autre_service" : "catalogue";
  const montants = [...new Set(montantsDuTexte(c.message || ""))].filter((x) => x > 0);
  return { a_retirer: av.filter((a) => BLOQUANTS.test(a)), a_confirmer, ...(av.includes("montant_egal_net") ? { masque: true } : {}), portee, montants };
}
// La même liste, l'ordre et les doublons mis à part.
export const memesMontants = (a = [], b = []) => {
  const x = [...new Set(a.map(Number))].sort((p, q) => p - q);
  const y = [...new Set(b.map(Number))].sort((p, q) => p - q);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
// Le refus d'un envoi d'après le contrôle, ou null quand il n'y a rien à retirer et que les montants à confirmer sont exactement ceux que
// la personne a confirmés (une liste différente, plus courte ou plus longue, redemande la confirmation). Valeurs masquées : la personne
// confirme tous les montants du texte, la liste doit être exactement celle-là (aucun net n'est dit).
export function refusEnvoi(controle, confirmes = []) {
  const aRetirer = (controle && controle.a_retirer) || [];
  const aConfirmer = (controle && controle.a_confirmer) || [];
  const portee = (controle && controle.portee) || "catalogue";
  if (aRetirer.length) return { status: 422, corps: { erreur: "contenu_interne", a_retirer: aRetirer } };
  if (controle && controle.masque) return memesMontants(controle.montants || [], confirmes) ? null : { status: 409, corps: { erreur: "montant_a_confirmer", a_confirmer: [], masque: true, portee } };
  if (aConfirmer.length && !memesMontants(aConfirmer, confirmes)) return { status: 409, corps: { erreur: "montant_a_confirmer", a_confirmer: aConfirmer, portee } };
  return null;
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
// 4096 px par côté, cache de 10 minutes d'un média envoyé par lien). Tests : tests/gestion-whatsapp-voucher.test.js.
export const LEGENDE_MAX_OCTETS = 1024;
export const IMAGE_MAX_OCTETS = 5 * 1024 * 1024;
// Corps d'une demande en multipart : l'image et quelques champs. Lu en flux, jamais plus (comme lireCorps de la fonction « whatsapp »).
export const CORPS_MAX_OCTETS = 6 * 1024 * 1024;
export const IMAGE_MAX_PX = 4096;
// Bucket privé de la migration 73 : l'image n'y reste que le temps que Telnyx la télécharge.
export const BUCKET_SORTANT = "whatsapp-sortant";
// URL signée de 15 minutes : Telnyx ne dit pas quand il télécharge, Meta le fait d'ordinaire dans la minute.
export const URL_SIGNEE_S = 15 * 60;
// Un fichier encore là après une heure est effacé par la purge de la fonction « whatsapp » (toutes les 5 minutes avec la reprise).
export const SORTANT_DUREE_MS = 3600_000;
// L'état de coexistence du numéro est relu au plus toutes les 3 minutes par instance.
export const COEXISTENCE_CACHE_MS = 3 * 60_000;
const MIMES_IMAGE = ["image/png", "image/jpeg", "image/webp"];

// Rend { conversation_id, reservation_id, essai_id, legende, numero_confirme } ou { erreur }. La légende peut être vide (l'image part seule).
// essai_id : identifiant créé par l'écran à l'ouverture de la confirmation (clé du verrou). numero_confirme : le numéro de la conversation,
// exigé quand il diffère de celui de la fiche client.
export function lireEnvoiVoucher(d) {
  if (!d || typeof d !== "object") return { erreur: "demande_invalide" };
  if (typeof d.conversation_id !== "string" || !UUID.test(d.conversation_id)) return { erreur: "conversation_invalide" };
  if (typeof d.reservation_id !== "string" || !UUID.test(d.reservation_id)) return { erreur: "reservation_invalide" };
  if (typeof d.essai_id !== "string" || !UUID.test(d.essai_id)) return { erreur: "demande_invalide" };
  const legende = typeof d.legende === "string" ? d.legende.replace(/\r\n?/g, "\n").trim() : "";
  if (new TextEncoder().encode(legende).length > LEGENDE_MAX_OCTETS) return { erreur: "legende_trop_longue" };
  const numero_confirme = typeof d.numero_confirme === "string" && /^\+[1-9][0-9]{6,15}$/.test(d.numero_confirme) ? d.numero_confirme : null;
  return { conversation_id: d.conversation_id, reservation_id: d.reservation_id, essai_id: d.essai_id.toLowerCase(), legende, numero_confirme, montants_confirmes: lireMontantsConfirmes(d.montants_confirmes) };
}

// ---- Image : type et dimensions lus dans l'en-tête, jamais ce qu'annonce le navigateur ------------------------------------------------
const u32be = (o, i) => ((o[i] << 24) >>> 0) + (o[i + 1] << 16) + (o[i + 2] << 8) + o[i + 3];
const u16be = (o, i) => (o[i] << 8) + o[i + 1];
const u16le = (o, i) => o[i] + (o[i + 1] << 8);
const u24le = (o, i) => o[i] + (o[i + 1] << 8) + (o[i + 2] << 16);
const ascii = (o, i, n) => String.fromCharCode(...o.slice(i, i + n));

// PNG : signature, IHDR en premier, des blocs bien formés jusqu'à IEND, et rien après IEND (aucun fichier caché à la suite de l'image).
function lirePng(o) {
  if (o.length < 33 || ascii(o, 12, 4) !== "IHDR") return null;
  const largeur = u32be(o, 16);
  const hauteur = u32be(o, 20);
  let i = 8;
  while (i + 12 <= o.length) {
    const longueur = u32be(o, i);
    const type = ascii(o, i + 4, 4);
    const suite = i + 12 + longueur;
    if (suite > o.length || !/^[A-Za-z]{4}$/.test(type)) return null;
    if (type === "IEND") return suite === o.length ? { mime: "image/png", largeur, hauteur } : { mime: "image/png", largeur, hauteur, apresFin: true };
    i = suite;
  }
  return null;
}
// JPEG : les segments jusqu'au premier SOF (SOF0 à SOF15, sauf DHT C4, JPG C8 et DAC CC), qui porte la hauteur puis la largeur.
function lireJpeg(o) {
  let i = 2;
  while (i + 4 <= o.length) {
    if (o[i] !== 0xff) return null;
    const m = o[i + 1];
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    if (m === 0xd9 || m === 0xda) return null;
    const longueur = u16be(o, i + 2);
    if (longueur < 2) return null;
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return i + 9 <= o.length ? { mime: "image/jpeg", hauteur: u16be(o, i + 5), largeur: u16be(o, i + 7) } : null;
    i += 2 + longueur;
  }
  return null;
}
// WebP : le premier bloc dit le format. VP8 (avec perte), VP8L (sans perte), VP8X (étendu, taille du canevas).
function lireWebp(o) {
  if (o.length < 30 || ascii(o, 0, 4) !== "RIFF" || ascii(o, 8, 4) !== "WEBP") return null;
  const bloc = ascii(o, 12, 4);
  if (bloc === "VP8 ") {
    if (o[23] !== 0x9d || o[24] !== 0x01 || o[25] !== 0x2a) return null;
    return { mime: "image/webp", largeur: u16le(o, 26) & 0x3fff, hauteur: u16le(o, 28) & 0x3fff };
  }
  if (bloc === "VP8L") {
    if (o[20] !== 0x2f) return null;
    const b = o[21] + (o[22] << 8) + (o[23] << 16) + ((o[24] << 24) >>> 0);
    return { mime: "image/webp", largeur: (b & 0x3fff) + 1, hauteur: ((b >>> 14) & 0x3fff) + 1 };
  }
  if (bloc === "VP8X") return { mime: "image/webp", largeur: u24le(o, 24) + 1, hauteur: u24le(o, 27) + 1 };
  return null;
}
// Le type réel d'une image, lu dans ses premiers octets. null si ce n'en est pas une.
export function typeImage(o) {
  if (!o || !o.length) return null;
  if (o.length > 8 && o[0] === 0x89 && ascii(o, 1, 3) === "PNG" && o[4] === 0x0d && o[5] === 0x0a && o[6] === 0x1a && o[7] === 0x0a) return "image/png";
  if (o.length > 3 && o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff) return "image/jpeg";
  if (o.length > 12 && ascii(o, 0, 4) === "RIFF" && ascii(o, 8, 4) === "WEBP") return "image/webp";
  return null;
}
// L'image reçue : PNG, JPEG ou WebP, 5 Mo au plus, 4096 px au plus par côté, en-tête lisible. Rend { ok, mime, largeur, hauteur } ou { erreur }.
export function imageAcceptee(octets) {
  if (!octets || !octets.length) return { erreur: "image_invalide" };
  if (octets.length > IMAGE_MAX_OCTETS) return { erreur: "image_trop_grosse" };
  const mime = typeImage(octets);
  if (!mime || !MIMES_IMAGE.includes(mime)) return { erreur: "image_invalide" };
  const lu = mime === "image/png" ? lirePng(octets) : mime === "image/jpeg" ? lireJpeg(octets) : lireWebp(octets);
  if (!lu || lu.apresFin || !(lu.largeur > 0) || !(lu.hauteur > 0)) return { erreur: "image_invalide" };
  if (lu.largeur > IMAGE_MAX_PX || lu.hauteur > IMAGE_MAX_PX) return { erreur: "image_trop_grande" };
  return { ok: true, mime, largeur: lu.largeur, hauteur: lu.hauteur };
}

// Orientation EXIF d'un JPEG (1 à 8), 1 sans indication. 5 à 8 : la photo s'affiche tournée d'un quart de tour, largeur et hauteur échangées.
export function orientationJpeg(o) {
  let i = 2;
  while (o && i + 4 <= o.length && o[i] === 0xff) {
    const m = o[i + 1];
    if (m === 0xda || m === 0xd9) break;
    const longueur = u16be(o, i + 2);
    if (longueur < 2) break;
    if (m === 0xe1 && i + 10 <= o.length && ascii(o, i + 4, 6) === "Exif\0\0") {
      const t = i + 10;
      const le = ascii(o, t, 2) === "II";
      const u16 = (k) => (le ? u16le(o, k) : u16be(o, k));
      const u32 = (k) => (le ? (o[k] + (o[k + 1] << 8) + (o[k + 2] << 16) + ((o[k + 3] << 24) >>> 0)) : u32be(o, k));
      if (t + 8 > o.length) return 1;
      const ifd = t + u32(t + 4);
      if (ifd + 2 > o.length) return 1;
      const n = u16(ifd);
      for (let e = 0; e < n && ifd + 2 + e * 12 + 12 <= o.length; e++) {
        const k = ifd + 2 + e * 12;
        if (u16(k) === 0x0112) {
          const v = u16(k + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    i += 2 + longueur;
  }
  return 1;
}
// Les dimensions d'une photo reçue telles qu'elle s'affiche (orientation EXIF comprise), lues dans l'en-tête : la place de la vignette est
// réservée avant son chargement dans Gestion (23.11.2026). null si l'en-tête est illisible ou si ce n'est pas une image.
export function dimensionsImage(octets) {
  const mime = typeImage(octets);
  if (!mime) return null;
  const lu = mime === "image/png" ? lirePng(octets) : mime === "image/jpeg" ? lireJpeg(octets) : lireWebp(octets);
  if (!lu || !(lu.largeur > 0) || !(lu.hauteur > 0)) return null;
  const tournee = mime === "image/jpeg" && orientationJpeg(octets) >= 5;
  return tournee ? { largeur: lu.hauteur, hauteur: lu.largeur } : { largeur: lu.largeur, hauteur: lu.hauteur };
}

// ---- Fichier temporaire -------------------------------------------------------------------------------------------------------------
// Chemin dans le bucket privé : <organisation>/<horodatage>-<id>.<ext>, à plat (la purge liste un seul dossier). Rien du client dedans.
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export function cheminSortant(organisation, id, mime = "image/png", maintenant = Date.now()) {
  return `${String(organisation).replace(/[^0-9a-f-]/gi, "")}/${Math.trunc(maintenant)}-${String(id).replace(/[^0-9a-f-]/gi, "")}.${EXT[mime] || "png"}`;
}
const UUID_TXT = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// Seul un chemin de cette forme, dans le dossier de cette organisation, est jamais effacé (jamais « .. », jamais un autre dossier).
export const cheminSortantValide = (chemin, organisation) =>
  typeof chemin === "string" && UUID.test(String(organisation)) && new RegExp(`^${String(organisation).toLowerCase()}/\\d+-${UUID_TXT}\\.(png|jpg|webp)$`).test(chemin);

// ---- Le bon contact -----------------------------------------------------------------------------------------------------------------
// Seule la conversation du client du dossier peut recevoir son voucher. Jamais celle d'un prestataire ni un contact personnel.
//   * rangée dans l'entreprise de la réservation, ou à trier (revue de sécurité de la PR 304 : la légende est contrôlée dans cette entreprise) ;
//   * reliée au dossier (dossier_id), ou au client du dossier (client_id) ; un client relié qui n'est pas celui du dossier ferme ;
//   * type « client », ou pas encore typée sans être un contact personnel (reponses = 'jamais' sans type, migration 68).
// Même règle à l'écran : src/gestion/js/whatsapp-voucher-calc.mjs (un test compare les deux).
export function contactVoucher(conv, dossier, entiteVoucher = null) {
  if (!conv || !dossier || !dossier.id) return { ok: false, erreur: "conversation_autre_dossier" };
  if (conv.entite_id && conv.entite_id !== (entiteVoucher || dossier.entite_id)) return { ok: false, erreur: "conversation_autre_entreprise" };
  const memeClient = !!conv.client_id && !!dossier.client_id && conv.client_id === dossier.client_id;
  const memeDossier = !!conv.dossier_id && conv.dossier_id === dossier.id && (!conv.client_id || memeClient);
  if (!memeClient && !memeDossier) return { ok: false, erreur: "conversation_autre_dossier" };
  const type = conv.type_contact ?? null;
  if (type === null && conv.reponses === "jamais") return { ok: false, erreur: "contact_personnel" };
  if (type !== null && type !== "client") return { ok: false, erreur: "contact_non_client" };
  return { ok: true };
}
// Le téléphone de la fiche client en E.164 (« +… » ou « 00… »), sinon null (numéro local, sans indicatif : on ne peut pas comparer).
export function e164(tel) {
  const t = String(tel || "").trim();
  const chiffres = t.replace(/\D/g, "");
  if (/^\+/.test(t)) return chiffres ? `+${chiffres}` : null;
  if (/^00/.test(t)) return chiffres.length > 2 ? `+${chiffres.slice(2)}` : null;
  return null;
}
// La conversation est-elle sur un autre numéro que celui de la fiche client ? Sans téléphone sur la fiche, rien à comparer. Un numéro de
// fiche sans indicatif compte comme différent : l'écran montre alors le numéro complet et la personne le confirme.
export function numeroDifferent(telConversation, telFiche) {
  if (!String(telFiche || "").trim()) return false;
  const e = e164(telFiche);
  return !e || e !== telConversation;
}

// ---- Telnyx -------------------------------------------------------------------------------------------------------------------------
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
// GET /v2/whatsapp/phone_numbers/{numero}/conversation_window : ouverte seulement si Telnyx le dit clairement, avec une fin dans le futur.
// En cas de doute (fin absente ou illisible), fermée.
export function lireFenetreTelnyx(statut, corps, maintenant = Date.now()) {
  if (!(statut >= 200 && statut < 300) || !corps || !corps.data || corps.data.window_active !== true) return false;
  const fin = Date.parse(corps.data.window_expires_at || "");
  return Number.isFinite(fin) && fin > maintenant;
}
export const adresseCoexistence = (numero) => `https://api.telnyx.com/v2/whatsapp/phone_numbers/${encodeURIComponent(numero)}`;
export const adresseFenetre = (numero, client) => `${adresseCoexistence(numero)}/conversation_window?destination_number=${encodeURIComponent(client)}`;

// ---- Fil et purge -------------------------------------------------------------------------------------------------------------------
// Le média rangé dans le fil : une image envoyée depuis Gestion, sans fichier gardé. `chemin_sortant` : le fichier temporaire, vidé quand
// il est effacé (jamais « chemin » : rien ne doit le chercher dans le stockage « whatsapp »). reservation_id sert au verrou.
export const mediaVoucher = ({ nom, taille, mime, chemin, reservation_id }) => ({ type: "image", mime, taille, nom: String(nom || "").slice(0, 120), statut: "voucher", chemin_sortant: chemin, reservation_id });
// Les fichiers temporaires d'une liste de médias (seulement ceux de la forme attendue, dans le dossier de l'organisation), et la liste une
// fois les fichiers effacés.
export const cheminsSortants = (medias = [], organisation) =>
  (Array.isArray(medias) ? medias : []).map((m) => m && m.chemin_sortant).filter((c) => cheminSortantValide(c, organisation));
export const sansFichierSortant = (medias = []) => (Array.isArray(medias) ? medias : []).map((m) => (m && m.chemin_sortant ? { ...m, chemin_sortant: null } : m));
// Un statut qui prouve que Meta a pris l'image (remis, lu) ou qu'elle ne partira plus (échec) : le fichier peut être effacé.
export const statutLibereFichier = (statut) => ["remis", "lu", "echec"].includes(statut);
// La purge : les fichiers de plus d'une heure (liste du stockage, { name, created_at }) du dossier de l'organisation, de la forme attendue.
export function sortantsAPurger(objets = [], dossier, maintenant = Date.now(), duree = SORTANT_DUREE_MS) {
  return (objets || [])
    .filter((o) => o && typeof o.name === "string" && o.name && o.id !== null)
    .filter((o) => {
      const t = Date.parse(o.created_at || "") || Number(String(o.name).split("-")[0]) || NaN;
      return Number.isFinite(t) && maintenant - t > duree;
    })
    .map((o) => `${dossier}/${o.name}`)
    .filter((c) => cheminSortantValide(c, dossier));
}
// La clé du verrou : la réservation et l'identifiant de la confirmation ouverte par la personne (un rejeu de la même demande ne range rien).
export const cleVerrouVoucher = (reservationId, essaiId) => `gestion-voucher:${reservationId}:${essaiId}`;
// Refus de whatsapp_ranger_voucher (migration 73) : a_verifier (un envoi précédent du voucher au résultat inconnu, levé seulement par
// « C'est parti » ou « Pas parti »), recent (parti depuis moins de 2 minutes), deja (même confirmation rejouée).
export const REFUS_VERROU = ["a_verifier", "recent", "deja"];

// Les entreprises dont le texte d'un envoi est contrôlé (nets, prix de vente, noms de partenaires). Secret et Taxi partagent leurs clients et
// un message de l'une peut porter le contenu de l'autre (« Proposer une excursion » : une sortie de Secret depuis une conversation Taxi,
// revue de la PR 310) : une conversation de Secret, de Taxi ou à trier est contrôlée dans les deux. Une conversation d'une autre entreprise :
// la sienne seule. `entites` : les lignes { id, slug } de l'organisation lues pour « secret » et « taxi ».
export function entitesControlees(conv, entites = []) {
  const paire = (entites || []).filter((e) => e && ["secret", "taxi"].includes(e.slug)).map((e) => e.id);
  if (!conv || !conv.entite_id) return paire;
  return paire.includes(conv.entite_id) ? paire : [conv.entite_id];
}
