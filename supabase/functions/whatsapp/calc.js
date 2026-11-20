// Fonction « whatsapp » : la logique pure (signature Telnyx, lecture des événements, messages à ranger, médias à copier).
// Aucune dépendance : le même fichier sert à la fonction Supabase et aux tests (tests/gestion-whatsapp.test.js).
// Doc : docs/gestion/whatsapp.md. Événements Telnyx (coexistence) : message.received, message.echo, whatsapp.account.update.

export const TAILLE_MAX = 1_000_000; // octets d'un événement ; un message WhatsApp en fait quelques milliers
export const TOLERANCE_S = 300; // Telnyx : refuser un horodatage de plus de 5 minutes
export const MEDIA_MAX = 20 * 1024 * 1024; // même limite que le stockage « whatsapp »
export const TEXTE_MAX = 8000;
export const TYPES_MEDIA = ["image", "video", "audio", "document", "sticker"];

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export function base64VersOctets(b64) {
  const s = String(b64 || "").trim();
  if (!s || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return null;
  const normal = s.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const bin = atob(normal);
    const o = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
    return o;
  } catch {
    return null;
  }
}

// Clé publique Telnyx (portail, « Public Key ») : 32 octets en base64, ou la même clé enveloppée en SPKI (44 octets, préfixe Ed25519).
const SPKI_ED25519 = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
export function cleBrute(b64) {
  const o = base64VersOctets(b64);
  if (!o) return null;
  if (o.length === 32) return o;
  if (o.length === 44 && SPKI_ED25519.every((b, i) => o[i] === b)) return o.slice(12);
  return null;
}

// Vérifie la signature Ed25519 de Telnyx : message signé = « <telnyx-timestamp>|<corps brut> ».
// subtle : crypto.subtle (Deno ou Node). Rend { ok: true } ou { ok: false, raison }.
export async function verifierSignature({ subtle, cle, signature, horodatage, corps, maintenant = Date.now() }) {
  const brute = cleBrute(cle);
  if (!brute) return { ok: false, raison: "cle" };
  if (!/^\d{9,12}$/.test(String(horodatage || ""))) return { ok: false, raison: "horodatage" };
  const ecart = Math.abs(maintenant / 1000 - Number(horodatage));
  if (ecart > TOLERANCE_S) return { ok: false, raison: "perime" };
  const sig = base64VersOctets(signature);
  if (!sig || sig.length !== 64) return { ok: false, raison: "signature" };
  try {
    const k = await subtle.importKey("raw", brute, { name: "Ed25519" }, false, ["verify"]);
    const octets = typeof corps === "string" ? encoder.encode(corps) : corps;
    const signe = new Uint8Array(String(horodatage).length + 1 + octets.length);
    signe.set(encoder.encode(`${horodatage}|`), 0);
    signe.set(octets, String(horodatage).length + 1);
    const ok = await subtle.verify({ name: "Ed25519" }, k, sig, signe);
    return ok ? { ok: true } : { ok: false, raison: "signature" };
  } catch {
    return { ok: false, raison: "signature" };
  }
}

// Lit l'enveloppe d'un événement : { id, type, survenu_le, payload }. Lève « invalide » si ce n'est pas un événement Telnyx.
export function lireEnveloppe(corps) {
  let j;
  try {
    j = JSON.parse(typeof corps === "string" ? corps : decoder.decode(corps));
  } catch {
    throw erreur("json");
  }
  const d = j && typeof j === "object" ? j.data : null;
  if (!d || typeof d !== "object") throw erreur("invalide");
  const id = typeof d.id === "string" ? d.id : "";
  const type = typeof d.event_type === "string" ? d.event_type : "";
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(id) || !/^[a-z0-9._]{1,60}$/i.test(type)) throw erreur("invalide");
  const survenu = dateIso(d.occurred_at);
  return { id, type, survenu_le: survenu, payload: d.payload && typeof d.payload === "object" ? d.payload : {}, brut: j };
}

function erreur(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

function dateIso(v) {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(typeof v === "number" ? v * 1000 : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Horodatage Meta (body.timestamp, secondes Unix en texte) ; sinon la date de l'événement.
export function dateMessage(body, survenu) {
  const t = body && body.timestamp;
  if (t !== undefined && t !== null && /^\d{9,12}$/.test(String(t))) return new Date(Number(t) * 1000).toISOString();
  return survenu || new Date().toISOString();
}

// Numéro au format E.164 : « +66812345678 ». Telnyx l'envoie déjà ainsi ; Meta parfois sans « + » (« 66812345678 »).
export function e164(v) {
  const brut = typeof v === "string" ? v : v && typeof v === "object" ? v.phone_number : null;
  if (typeof brut !== "string") return null;
  const n = brut.trim().replace(/[\s.\-()]/g, "");
  const avecPlus = n.startsWith("+") ? n : /^\d+$/.test(n) ? `+${n}` : n;
  return /^\+[1-9]\d{6,15}$/.test(avecPlus) ? avecPlus : null;
}

const CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export function texteSur(v, max = TEXTE_MAX) {
  if (typeof v !== "string") return null;
  const s = v.replace(CONTROLE, "").replace(/\r\n?/g, "\n");
  if (!s.trim()) return null;
  return Array.from(s).slice(0, max).join("");
}

const nomSur = (v) => (typeof v === "string" ? texteSur(v, 100)?.replace(/\s+/g, " ").trim() || null : null);

// Nom du profil du client, s'il est présent (forme Meta « contacts[0].profile.name », ou champs Telnyx éventuels).
export function nomProfil(payload) {
  const b = payload.body || {};
  const c = Array.isArray(b.contacts) ? b.contacts[0] : Array.isArray(payload.contacts) ? payload.contacts[0] : null;
  return nomSur(c?.profile?.name) || nomSur(b.profile?.name) || nomSur(payload.from?.name) || nomSur(payload.from?.profile_name) || null;
}

// Les médias d'un message, à copier. Chaque entrée garde la source (url Telnyx ou id Meta), jamais téléchargée ici.
export function mediasDe(body) {
  const out = [];
  for (const t of TYPES_MEDIA) {
    const m = body && body[t];
    if (!m || typeof m !== "object") continue;
    const url = typeof m.url === "string" && /^https:\/\//.test(m.url) ? m.url : null;
    const id = typeof m.id === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(m.id) ? m.id : null;
    out.push({
      type: t,
      mime: typeof m.mime_type === "string" ? m.mime_type.slice(0, 100) : null,
      sha256: typeof m.sha256 === "string" ? m.sha256.slice(0, 100) : null,
      legende: texteSur(m.caption, 1024),
      nom: nomSur(m.filename),
      source_url: url,
      source_id: id,
      statut: url || id ? "a_copier" : "echec",
    });
  }
  return out;
}

// Texte affichable d'un message, selon son type.
export function texteDe(body) {
  if (!body || typeof body !== "object") return null;
  switch (body.type) {
    case "text":
      return texteSur(body.text?.body ?? body.text);
    case "reaction":
      return texteSur(body.reaction?.emoji, 20);
    case "button":
      return texteSur(body.button?.text);
    case "interactive": {
      const i = body.interactive || {};
      return texteSur(i.button_reply?.title || i.list_reply?.title || i.nfm_reply?.body || null);
    }
    case "location": {
      const l = body.location || {};
      if (l.latitude === undefined || l.longitude === undefined) return null;
      return texteSur(`${l.name ? l.name + " " : ""}${l.address ? l.address + " " : ""}https://maps.google.com/?q=${Number(l.latitude)},${Number(l.longitude)}`.trim(), 500);
    }
    case "contacts": {
      const c = Array.isArray(body.contacts) ? body.contacts : [];
      return texteSur(c.map((x) => [x.name?.formatted_name, ...(x.phones || []).map((p) => p.phone)].filter(Boolean).join(" ")).join("\n"), 1000);
    }
    default:
      for (const t of TYPES_MEDIA) if (body[t]) return texteSur(body[t].caption, 1024);
      return null;
  }
}

const typeSur = (t) => (typeof t === "string" && /^[a-z_]{1,30}$/.test(t) ? t : "inconnu");

// Ce qu'il faut faire d'un événement. Rend l'une de :
//   { action: "message", telephone, entreprise, nom, message }    nouveau message entrant ou sortant à ranger
//   { action: "modifier", original, texte, quand }                 le client a modifié un message (15 minutes chez Meta)
//   { action: "supprimer", original, quand }                       le client a supprimé un message pour tous
//   { action: "compte", etat }                                     whatsapp.account.update
//   { action: "ignorer", raison }                                  autre événement (statut d'envoi, WABA…) : gardé brut seulement
export function interpreter(ev) {
  const p = ev.payload || {};
  if (ev.type === "whatsapp.account.update") {
    const etat = typeof p.event === "string" && /^[A-Z_]{1,40}$/.test(p.event) ? p.event : null;
    return etat ? { action: "compte", etat } : { action: "ignorer", raison: "etat" };
  }
  if (ev.type !== "message.received" && ev.type !== "message.echo") return { action: "ignorer", raison: "type" };
  if (p.type && String(p.type).toUpperCase() !== "WHATSAPP") return { action: "ignorer", raison: "canal" };
  const body = p.body && typeof p.body === "object" ? p.body : {};
  const echo = ev.type === "message.echo";
  // Entrant : le client est l'expéditeur, l'entreprise le destinataire. Écho : l'inverse.
  const destinataire = Array.isArray(p.to) ? p.to[0] : p.to;
  const client = e164(echo ? destinataire : p.from) || (!echo ? e164(body.from) : null);
  const entreprise = e164(echo ? p.from : destinataire);
  if (!client) return { action: "ignorer", raison: "numero" };
  const quand = dateMessage(body, ev.survenu_le);
  if (body.type === "edit") {
    const original = body.edit?.original_message_id;
    if (typeof original !== "string" || !original) return { action: "ignorer", raison: "edit" };
    return { action: "modifier", telephone: client, original: original.slice(0, 200), texte: texteSur(body.edit?.message?.text?.body), quand };
  }
  if (body.type === "revoke") {
    const original = body.revoke?.original_message_id;
    if (typeof original !== "string" || !original) return { action: "ignorer", raison: "revoke" };
    return { action: "supprimer", telephone: client, original: original.slice(0, 200), quand };
  }
  const telnyxId = typeof p.id === "string" ? p.id.slice(0, 100) : null;
  const metaId = typeof body.foreign_id === "string" ? body.foreign_id.slice(0, 200) : typeof body.id === "string" && body.id.startsWith("wamid.") ? body.id.slice(0, 200) : null;
  return {
    action: "message",
    telephone: client,
    entreprise,
    nom: echo ? null : nomProfil(p),
    message: {
      evenement_id: ev.id,
      telnyx_id: telnyxId,
      meta_id: metaId,
      sens: echo ? "sortant" : "entrant",
      origine: echo ? "app" : "client",
      type: typeSur(body.type),
      texte: texteDe(body),
      medias: mediasDe(body),
      envoye_le: quand,
      repond_a: typeof body.context?.id === "string" ? body.context.id.slice(0, 200) : null,
    },
  };
}

// Extension de fichier sûre selon le type MIME (le nom envoyé par le client n'entre jamais dans le chemin).
const EXTENSIONS = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic",
  "video/mp4": "mp4", "video/3gpp": "3gp", "video/quicktime": "mov",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr",
  "application/pdf": "pdf", "text/plain": "txt",
  "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
export function extension(mime) {
  const m = String(mime || "").split(";")[0].trim().toLowerCase();
  return EXTENSIONS[m] || "bin";
}
export function cheminMedia(organisation, conversation, message, rang, mime) {
  return `${organisation}/${conversation}/${message}-${rang}.${extension(mime)}`;
}

// Adresse à demander pour un média : l'url déjà prise par Telnyx, sinon son API (id Meta). La clé API ne part que vers api.telnyx.com,
// ou vers une adresse Telnyx d'un média (jamais vers une autre machine, même si l'événement signé en nommait une).
export function sourceMedia(media, numeroEntreprise) {
  if (media.source_url) return { url: media.source_url, cle: hoteTelnyx(media.source_url) };
  if (media.source_id && numeroEntreprise) return { url: `https://api.telnyx.com/v2/whatsapp/media/${encodeURIComponent(numeroEntreprise)}/${encodeURIComponent(media.source_id)}`, cle: true };
  return null;
}
export function hoteTelnyx(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "telnyx.com" || u.hostname.endsWith(".telnyx.com"));
  } catch {
    return false;
  }
}

// Une copie réussie ou non : ce qui reste du média dans le message (la source part, elle expire de toute façon).
export function mediaCopie(media, resultat) {
  const { source_url, source_id, ...reste } = media;
  return { ...reste, ...resultat };
}

// Réponses : Telnyx ne lit que le code. 200 dès que l'événement est gardé, même si son traitement échoue ensuite (il sera rejoué).
export const REPONSES = {
  ok: { status: 200, corps: { ok: true } },
  methode: { status: 405, corps: { ok: false } },
  signature: { status: 401, corps: { ok: false } },
  trop_gros: { status: 413, corps: { ok: false } },
  invalide: { status: 400, corps: { ok: false } },
  serveur: { status: 500, corps: { ok: false } },
};
