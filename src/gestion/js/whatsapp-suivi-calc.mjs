// Suivi des conversations WhatsApp (migrations 61 et 62, 20.11.2026, « Lance tout » de Jérémy) : créer ou mettre à jour le dossier depuis
// l'échange, voucher, signal de paiement, ferrys payés d'avance à relancer, promesses en tâches, résumé. Logique pure, testée par
// tests/gestion-whatsapp-fonctions.test.js.
import { N_ } from "./i18n.mjs";

// ---- Créer ou mettre à jour le dossier (fonction « agent », mode WhatsApp) ---------------------------------------------------------------
// La demande passe de l'écran WhatsApp à l'Assistant par sessionStorage : l'Assistant l'envoie aussitôt, sans texte, avec ces deux champs.
export const CLE_DEMANDE_AGENT = "gestion-agent-whatsapp";
export const MODES_DOSSIER = ["creer", "maj"];
export const modeDossier = (conv) => (conv && conv.dossier_id ? "maj" : "creer");
export function demandeAgent(valeur) {
  let v = valeur;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || typeof v.id !== "string" || !v.id || !MODES_DOSSIER.includes(v.mode)) return null;
  return { whatsapp_conversation_id: v.id, whatsapp_mode: v.mode, entite_id: typeof v.entite === "string" ? v.entite : null };
}
// Après validation d'une carte « dossier » : ce qu'on écrit sur la conversation WhatsApp (client et dossier créés ; entreprise si elle était
// à trier). null : rien à écrire (pas de dossier, ou déjà relié à ce dossier).
export function liaisonApresDossier(conv, dossier, entiteId) {
  if (!conv || !dossier || !dossier.id) return null;
  if (conv.dossier_id === dossier.id && conv.client_id === dossier.client_id) return null;
  return { ...(conv.entite_id ? {} : { entite_id: entiteId }), client_id: dossier.client_id || null, dossier_id: dossier.id };
}
export const ERREURS_AGENT_WHATSAPP = {
  whatsapp_introuvable: N_("Cette conversation WhatsApp n'est plus lisible ou appartient à une autre entreprise."),
  dossier_introuvable: N_("Aucun dossier n'est relié à cette conversation : utilisez « Créer le dossier »."),
};

// ---- Signal de paiement -----------------------------------------------------------------------------------------------------------------
// paiement_signale : { message_id, le, motif: texte | piece }. null ou absent : rien à montrer.
export function paiementSignale(conv) {
  const p = conv && conv.paiement_signale;
  if (!p || typeof p !== "object") return null;
  return { motif: p.motif === "piece" ? "piece" : "texte", le: p.le || null, message_id: p.message_id || null };
}
export const MOTIFS_PAIEMENT = {
  texte: N_("D'après son message."),
  piece: N_("D'après la photo ou le PDF qu'il a envoyé."),
};

// ---- Ferrys payés d'avance à relancer ----------------------------------------------------------------------------------------------------
// Un bateau : le mode du trajet contient l'un de ces mots, sans tenir compte de la casse.
export const BATEAU = /ferry|speedboat|expressboat|boat|catamaran|longtail/i;
export const estBateau = (trajet) => !!trajet && BATEAU.test(String(trajet.mode || ""));
// Les réservations confirmées, à venir, pas payées sur place, dont le trajet est un bateau, dans un dossier non soldé (reçu < total).
// dossiers : avec leur résumé (total, recu). Un dossier sans total connu (droit « montants » absent) n'est jamais compté.
export function ferrysARelancer({ reservations = [], trajets = [], dossiers = [], aujourdhui = "" } = {}) {
  const parTrajet = new Map(trajets.map((t) => [t.id, t]));
  const parDossier = new Map(dossiers.map((d) => [d.id, d]));
  const out = [];
  for (const r of reservations) {
    if (!r || r.statut !== "confirme" || r.paye_sur_place || !r.date_service || r.date_service < aujourdhui) continue;
    const t = parTrajet.get(r.trajet_id);
    if (!estBateau(t)) continue;
    const d = parDossier.get(r.dossier_id);
    if (!d || d.annule) continue;
    const total = Number(d.total);
    const recu = Number(d.recu) || 0;
    if (!(total > 0) || !(recu < total)) continue;
    out.push({ reservation: r, trajet: t, dossier: d });
  }
  return out.sort((a, b) => String(a.reservation.date_service).localeCompare(String(b.reservation.date_service)));
}
// Les ferrys de chaque conversation WhatsApp, par son dossier relié.
export function ferrysParConversation(conversations = [], ferrys = []) {
  const out = new Map();
  for (const c of conversations) {
    if (!c.dossier_id) continue;
    const liste = ferrys.filter((f) => f.dossier.id === c.dossier_id);
    if (liste.length) out.set(c.id, liste);
  }
  return out;
}
// « ferry from Koh Lanta to Koh Phi Phi » : le mode du trajet en minuscules, ou « boat » s'il manque.
export function nomTrajet(trajet, reservation = null) {
  const mode = String((trajet && trajet.mode) || "boat").trim().toLowerCase();
  if (trajet && trajet.de && trajet.vers) return `${mode} from ${trajet.de} to ${trajet.vers}`;
  return (reservation && reservation.libelle) || mode;
}
// « Saturday 22 November », en anglais : le message part au client.
export function dateAnglaise(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}
// Le message de relance, en anglais, sans signature ni coordonnée bancaire (Nani les envoie quand le client a choisi).
export function messageRelanceFerry({ prenom = "", trajet = null, reservation = null } = {}) {
  const salut = String(prenom || "").trim() ? `Hi ${String(prenom).trim()},` : "Hi,";
  const date = dateAnglaise(reservation && reservation.date_service);
  return `${salut} just a reminder that your ${nomTrajet(trajet, reservation)}${date ? ` on ${date}` : ""} is confirmed once payment is received. You can pay in advance by Wise, international bank transfer or in cash at our office. Let me know which you prefer and I'll send you the payment details.`;
}
// Prénom pour le message : celui du client relié, sinon le premier mot du nom WhatsApp.
export function prenomPourMessage(conv, client = null) {
  if (client && client.prenom) return String(client.prenom).trim();
  const n = String((conv && conv.nom) || "").trim().split(/\s+/)[0] || "";
  return /^[\p{L}'-]{2,}$/u.test(n) ? n : "";
}

// ---- Résumé --------------------------------------------------------------------------------------------------------------------------------
// Les trois lignes du résumé, sans lignes vides ni puces.
export function lignesResume(resume) {
  return String(resume || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-•*\d.)]+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

// ---- Promesses en tâches --------------------------------------------------------------------------------------------------------------------
// Les tâches créées par la fonction pour une promesse de Nani (« WhatsApp, Prénom : … »), encore à faire, liées à la conversation : par son
// dossier, sinon par le prénom ou le nom WhatsApp dans le titre, dans la même entreprise.
export function tachesPromesse(taches = [], conv = null, client = null) {
  if (!conv) return [];
  const noms = [client && client.prenom, conv.nom].filter(Boolean).map((n) => String(n).trim().toLowerCase());
  return taches.filter((t) => {
    if (!t || t.fait || !String(t.titre || "").startsWith("WhatsApp, ")) return false;
    if (conv.dossier_id && t.dossier_id) return t.dossier_id === conv.dossier_id;
    if (conv.entite_id && t.entite_id !== conv.entite_id) return false;
    const qui = String(t.titre).slice("WhatsApp, ".length).split(" : ")[0].trim().toLowerCase();
    return !!qui && noms.some((n) => n === qui || n.startsWith(`${qui} `));
  });
}
