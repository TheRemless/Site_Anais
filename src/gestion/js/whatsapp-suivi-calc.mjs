// Suivi des conversations WhatsApp (migrations 61 et 62, 20.11.2026, « Lance tout » de Jérémy) : créer ou mettre à jour le dossier depuis
// l'échange, voucher, signal de paiement, promesses en tâches, résumé. Logique pure, testée par
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
  const pieces = Array.isArray(v.pieces) ? [...new Set(v.pieces.filter((x) => typeof x === "string" && x))].slice(0, PIECES_MAX) : [];
  return { whatsapp_conversation_id: v.id, whatsapp_mode: v.mode, entite_id: typeof v.entite === "string" ? v.entite : null, whatsapp_pieces: pieces };
}

// ---- Pièces à joindre (fonction « agent », 20.11.2026 : rien n'est joint d'office) -----------------------------------------------------------
// Une capture de virement ou de compte contient des coordonnées bancaires : la personne coche elle-même les photos et PDF à joindre, aucun
// par défaut, six au plus. Mêmes règles que la fonction (agent/whatsapp.js, candidatsPieces) : copiés, jpeg, png, webp ou pdf, image ≤ 4,5 Mo.
export const TYPES_PIECES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const PIECES_MAX = 6;
const OCTETS_IMAGE_MAX = 4.5 * 1024 * 1024;
export function piecesProposees(messages = []) {
  const out = [];
  const recents = [...messages].filter((m) => m && !m.supprime_le).sort((a, b) => String(b.envoye_le).localeCompare(String(a.envoye_le)));
  for (const m of recents) {
    for (const x of m.medias || []) {
      const type = String(x.mime || "").split(";")[0].trim().toLowerCase();
      if (x.statut !== "copie" || !x.chemin || !TYPES_PIECES.includes(type)) continue;
      const taille = Number(x.taille) || 0;
      if (taille <= 0 || (type !== "application/pdf" && taille > OCTETS_IMAGE_MAX)) continue;
      out.push({ chemin: x.chemin, media_type: type, nom: x.nom || (type === "application/pdf" ? "document.pdf" : "photo.jpg"), legende: x.legende || "", sens: m.sens, envoye_le: m.envoye_le, media: x });
    }
  }
  return out;
}
// Cocher ou décocher une pièce : jamais plus de six.
export function basculerPiece(cochees = [], chemin) {
  if (cochees.includes(chemin)) return cochees.filter((c) => c !== chemin);
  return cochees.length >= PIECES_MAX ? cochees : [...cochees, chemin];
}

// Après validation d'une carte « dossier » : ce qu'on écrit sur la conversation WhatsApp, relue en base juste avant (conv).
//   « rien » : introuvable, dans une autre entreprise, ou déjà reliée à ce client et ce dossier ;
//   « ecrire » : client et dossier vides remplis ; une conversation à trier (lot 2 du 20.11.2026 : on crée le dossier sans ranger d'abord)
//     est rangée en même temps dans l'entreprise du dossier ;
//   « demander » : un autre client ou un autre dossier est déjà relié, la personne décide avant de le remplacer.
export function liaisonApresDossier(conv, dossier, entiteId) {
  if (!conv || !dossier || !dossier.id) return { action: "rien", patch: null };
  if (!conv.entite_id) {
    const ent = dossier.entite_id || entiteId;
    return ent ? { action: "ecrire", patch: { entite_id: ent, client_id: dossier.client_id || null, dossier_id: dossier.id } } : { action: "rien", patch: null };
  }
  if (conv.entite_id !== entiteId) return { action: "rien", patch: null };
  const client = dossier.client_id || null;
  const conflit = (conv.client_id && client && conv.client_id !== client) || (conv.dossier_id && conv.dossier_id !== dossier.id);
  if (conflit) return { action: "demander", patch: { client_id: client, dossier_id: dossier.id } };
  const patch = {};
  if (!conv.client_id && client) patch.client_id = client;
  if (!conv.dossier_id) patch.dossier_id = dossier.id;
  return Object.keys(patch).length ? { action: "ecrire", patch } : { action: "rien", patch: null };
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

// ---- Résumé --------------------------------------------------------------------------------------------------------------------------------
// Les trois lignes du résumé, sans lignes vides ni puces.
export function lignesResume(resume) {
  return String(resume || "")
    .split(/\r?\n/)
    // Seulement les puces (« - », « • », « * ») et les numéros de liste (« 1. », « 2) ») : une date ou un nombre en tête reste (« 22.11 : ferry »).
    .map((l) => l.trim().replace(/^[-•*]\s+/, "").replace(/^\d+[.)]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

// Le résumé est plus ancien que le dernier message de la conversation : « (avant le dernier message) ».
export const resumeEnRetard = (conv) => !!conv && !!conv.resume_le && !!conv.dernier_message_le && Date.parse(conv.resume_le) < Date.parse(conv.dernier_message_le);

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
