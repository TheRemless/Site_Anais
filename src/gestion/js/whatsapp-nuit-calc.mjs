// Message automatique de nuit (migration 132, demande de Jérémy du 27.11.2026) : logique pure, sans réseau. La base décide (whatsapp_nuit_motif,
// contrainte unique par conversation et par nuit) ; ces fonctions servent à l'écran de réglage, aux tests et à lire la réponse de Telnyx.
// Tests : tests/gestion-whatsapp-nuit.test.js.

// Le texte de Jérémy du 27.11.2026, mot pour mot (emojis, espaces avant « ! », apostrophe typographique). Le même que le défaut de la migration 132.
export const TEXTE_NUIT = "🌴 Hello and thank you for contacting us !\n\nOur team is currently away, but we’ll get back to you as soon as possible around 7:00 AM (Thailand time).\n\nIn the meantime, please feel free to send us all the details of your request so we can assist you more efficiently.\n\nThe more details you share, the more accurately we can assist you when we get back to you !\n\nThank you for your patience. We look forward to helping you discover Thailand ! 🇹🇭🌴";
export const DEBUT_NUIT = "22:00";
export const FIN_NUIT = "06:00";
export const TEXTE_NUIT_MAX_OCTETS = 4096;
// Une nuit dure 12 heures au plus (whatsapp_nuit_minutes, migration 132) : 06:00 à 22:00 répondrait toute la journée.
export const NUIT_MAX_MINUTES = 720;
export const ZONE = "Asia/Bangkok";

// « HH:MM » en minutes depuis minuit, ou null.
export function minutes(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/.exec(String(hhmm || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Date (AAAA-MM-JJ) et minutes de l'instant, heure de Bangkok (UTC+7 toute l'année).
export function heureBangkok(quand) {
  const t = quand instanceof Date ? quand.getTime() : Date.parse(quand);
  if (!Number.isFinite(t)) return null;
  const local = new Date(t + 7 * 3600_000);
  return { date: local.toISOString().slice(0, 10), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

const veille = (date) => new Date(Date.parse(`${date}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);

// Clé de la nuit (date du soir où elle commence) d'un instant, ou null de jour. Même règle que whatsapp_nuit_cle (migration 132).
export function cleDeNuit(quand, debut = DEBUT_NUIT, fin = FIN_NUIT) {
  const d = minutes(debut);
  const f = minutes(fin);
  const h = heureBangkok(quand);
  if (d === null || f === null || d === f || !h) return null;
  if (d > f) {
    if (h.minutes >= d) return h.date;
    if (h.minutes < f) return veille(h.date);
    return null;
  }
  return h.minutes >= d && h.minutes < f ? h.date : null;
}

// Réponse de Telnyx à l'envoi : « envoye » (id lu), « echec » (refus sûr, repris par le cron), « incertain » (délai dépassé, coupure, 5xx ou
// 2xx illisible : il est peut-être parti, jamais renvoyé). Même lecture que whatsapp-envoi.
export function resultatTelnyx(statut, corps, { exception = false } = {}) {
  if (exception) return { resultat: "incertain", erreur: "delai" };
  const id = corps && corps.data && typeof corps.data.id === "string" ? corps.data.id : null;
  if (statut >= 200 && statut < 300 && id) return { resultat: "envoye", id };
  if (statut >= 500 || (statut >= 200 && statut < 300)) return { resultat: "incertain", erreur: `http_${statut}` };
  const code = corps && Array.isArray(corps.errors) && corps.errors[0] ? String(corps.errors[0].code || "").replace(/[^0-9A-Za-z_-]/g, "").slice(0, 20) : "";
  return { resultat: "echec", erreur: `telnyx_refuse${code ? ` ${code}` : ""}` };
}

// Une plage de nuit (en minutes) : chaque borne entre 18:00 et 08:00 (avec la limite de 12 heures). Même règle que
// whatsapp_nuit_plage_valide (migration 132) : 12:00 à 00:00 ou 23:00 à 11:00 ne sont pas des nuits.
// Le début est strict (avant 08:00) : une nuit ne commence pas à 08:00, sinon 08:00 à 20:00 (12 heures pile) passerait.
// Relecture n° 4 : sans passer minuit, la plage commence le soir ou finit le matin (07:00 à 19:00 est une journée).
export const plageDeNuit = (d, f) => (d >= 18 * 60 || d < 8 * 60) && (f >= 18 * 60 || f <= 8 * 60) && (d > f || d >= 1080 || f <= 480);

// Formulaire de Réglages > WhatsApp : { ok, valeurs } ou { erreur } (texte français, traduit par l'écran). Le serveur refait ces contrôles.
export function lireReglageNuit({ active, texte, debut, fin } = {}) {
  const t = typeof texte === "string" ? texte.replace(/\r\n?/g, "\n") : "";
  if (!t.trim()) return { erreur: "Le message ne peut pas être vide." };
  if (new TextEncoder().encode(t).length > TEXTE_NUIT_MAX_OCTETS) return { erreur: "Le message est trop long pour WhatsApp (4 096 octets au plus)." };
  const d = minutes(debut);
  const f = minutes(fin);
  if (d === null || f === null) return { erreur: "Indiquez les heures au format 22:00." };
  if (d === f) return { erreur: "L'heure de début et l'heure de fin doivent être différentes." };
  if ((f - d + 1440) % 1440 > NUIT_MAX_MINUTES) return { erreur: "La plage dure plus de 12 heures : le message partirait aussi le jour. Vérifiez l'heure de début et l'heure de fin." };
  // Même règle que whatsapp_nuit_plage_valide (migration 132) : 08:00 à 20:00 n'est pas une nuit.
  if (!plageDeNuit(d, f)) return { erreur: "La plage doit être la nuit : le début et la fin entre 18:00 et 08:00." };
  return { ok: true, valeurs: { active: active !== false, texte: t, debut: String(debut).slice(0, 5), fin: String(fin).slice(0, 5) } };
}

// Les réglages lus en base (time « 22:00:00 »), avec les valeurs par défaut tant que la migration 132 manque.
export function reglageNuit(r) {
  const hh = (v, defaut) => (minutes(v) === null ? defaut : String(v).slice(0, 5));
  return {
    disponible: !!r && "nuit_active" in r,
    active: r && "nuit_active" in r ? r.nuit_active !== false : true,
    texte: r && typeof r.nuit_texte === "string" && r.nuit_texte ? r.nuit_texte : TEXTE_NUIT,
    debut: hh(r && r.nuit_debut, DEBUT_NUIT),
    fin: hh(r && r.nuit_fin, FIN_NUIT),
    // Lu avec le réglage, renvoyé à l'enregistrement : changé ailleurs entre-temps, l'enregistrement est refusé.
    modifieLe: (r && r.nuit_modifie_le) || null,
  };
}
