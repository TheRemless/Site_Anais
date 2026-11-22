// Une discussion de l'Assistant liée à une conversation WhatsApp qui se remplit (relecture de la PR 318). Une seule discussion par
// conversation WhatsApp : au lieu d'échouer en « conversation_pleine » (20 pièces ou 30 Mo, migration 55) ou de perdre le début de
// l'historique (les 400 derniers messages seulement sont relus), la fonction agent archive la discussion pleine et en ouvre une nouvelle,
// liée à la même conversation WhatsApp, qui commence par un court résumé : le client, les dossiers, le dernier prix accepté. Logique pure.
import { MAX_CONVERSATION_B64, MAX_FICHIERS_CONVERSATION } from "./fichiers.js";

// Au-delà, la discussion est pleine : une marge sous les 400 messages relus (index.ts), pour qu'aucun échange ne soit coupé.
export const HISTORIQUE_PLEIN = 360;

// `messages` : le nombre de messages gardés ; `fichiers` : { nombre, taille } déjà gardés ; `nouveaux` : les pièces de cet envoi
// ({ taille } en base64, comme verifierPieces).
export function discussionPleine({ messages = 0, fichiers = { nombre: 0, taille: 0 }, nouveaux = [] } = {}) {
  if ((Number(messages) || 0) >= HISTORIQUE_PLEIN) return "historique";
  const n = (Number(fichiers && fichiers.nombre) || 0) + (nouveaux || []).length;
  const t = (Number(fichiers && fichiers.taille) || 0) + (nouveaux || []).reduce((s, f) => s + (Number(f && f.taille) || String((f && f.data) || "").length), 0);
  if ((nouveaux || []).length && (n > MAX_FICHIERS_CONVERSATION || t > MAX_CONVERSATION_B64)) return "pieces";
  return "";
}

const propre = (v, max) =>
  String(v || "")
    .replace(/[<>\[\]\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

// Le dernier prix de vente accepté : celui d'un service d'une carte validée (dossier, réservation ou modification), la plus récente.
// Seulement `prix` (le prix de vente de la carte), jamais un net ni une marge. `cartes` : { genre, statut, donnees, cree_le, decide_le }.
export function dernierPrixAccepte(cartes = []) {
  const validees = (cartes || [])
    .filter((c) => c && c.statut === "validee" && ["dossier", "reservation", "modification"].includes(c.genre))
    .sort((a, b) => String(b.decide_le || b.cree_le || "").localeCompare(String(a.decide_le || a.cree_le || "")));
  for (const c of validees) {
    const d = c.donnees && typeof c.donnees === "object" ? c.donnees : {};
    const services = [...(Array.isArray(d.services) ? d.services : []), d.service].filter((s) => s && typeof s === "object");
    for (const s of services.slice().reverse()) if (typeof s.prix === "number" && s.prix > 0) return { prix: s.prix, service: propre(s.libelle || s.texte, 120) };
  }
  return null;
}

const montant = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

// Le résumé qui ouvre la nouvelle discussion. `client` : { prenom, nom } ou null ; `dossiers` : [{ ref }] ; `prix` : dernierPrixAccepte.
export function resumeReport({ client = null, dossiers = [], prix = null, raison = "" } = {}) {
  const nom = client ? propre([client.prenom, client.nom].filter(Boolean).join(" "), 80) : "";
  const refs = [...new Set((dossiers || []).map((d) => propre(d && d.ref, 30)).filter(Boolean))].slice(0, 6);
  const lignes = [
    `La discussion précédente sur ce client était pleine (${raison === "pieces" ? "pièces jointes" : "historique"}) : elle est archivée. Résumé repris d'elle :`,
    `- Client : ${nom || "pas encore de fiche"}`,
    `- Dossiers : ${refs.length ? refs.join(", ") : "aucun"}`,
    `- Dernier prix accepté : ${prix ? `${montant(prix.prix)} THB${prix.service ? ` (${prix.service})` : ""}` : "aucun"}`,
  ];
  return `<resume_discussion>\n${lignes.join("\n")}\n</resume_discussion>`;
}
