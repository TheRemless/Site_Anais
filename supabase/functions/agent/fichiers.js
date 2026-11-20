// Agent de Gestion : les pièces jointes d'un message (photos, captures, PDF), 20.11.2026. Logique pure, sans dépendance : la fonction
// Supabase (index.ts) et les tests (node --test) s'en servent.
//
// Où vivent les fichiers : dans la table agent_fichiers (migration 55), une ligne par fichier, rattachée à la conversation et supprimée avec
// elle (90 jours sans message, ou « Supprimer »), et au plus tard 30 jours après l'envoi (purger_agent_fichiers). Le message garde seulement
// un bloc { type: "fichier", id, nom, media_type, taille } : le fil s'affiche sans télécharger les fichiers, et le bloc devient, au moment de
// l'appel à Claude, un bloc image ou document (versClaude).
//
// Ce qui part chez Anthropic : les fichiers tels que la personne les a choisis (images réduites dans le navigateur). Un fichier peut contenir
// un net ou un compte : c'est la personne qui le choisit, jamais la base.
import { TYPES_FICHIER, verifierFichiers } from "../assistant/brochure.js";
import { texte as texteOutils } from "./outils.js";

// Limites d'un message : celles de l'import de brochure (six fichiers, 5 Mo par image, 10 Mo en tout), plus 40 pages par PDF.
// Limites d'une conversation : 20 fichiers et 30 Mo gardés ; à l'appel, les fichiers les plus récents passent tant qu'ils tiennent dans
// 20 Mo (la requête à Claude reste sous sa limite de 32 Mo), les plus anciens deviennent une ligne de texte.
export const MAX_FICHIERS_MESSAGE = 6;
export const MAX_PAGES_PDF = 40;
export const MAX_FICHIERS_CONVERSATION = 20;
const b64 = (mo) => Math.floor((mo * 1024 * 1024 * 4) / 3);
export const MAX_CONVERSATION_B64 = b64(30);
export const BUDGET_APPEL_B64 = b64(20);
export { TYPES_FICHIER };

// Le texte des outils, caractères de contrôle d'un nom de fichier en plus retirés.
const texte = (x, max) => texteOutils(typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f]/g, " ") : x, max);

// Le nombre de pages d'un PDF, d'après ses objets « /Type /Page » ou le « /Count » de son arbre de pages, quand ils sont lisibles en clair.
// Un PDF compressé (flux d'objets) peut les cacher : la fonction rend alors 0, et seule la taille limite le fichier.
export function pagesPdf(data) {
  let brut = "";
  try {
    brut = typeof atob === "function" ? atob(data) : Buffer.from(data, "base64").toString("latin1");
  } catch {
    return 0;
  }
  const pages = (brut.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
  const comptes = [...brut.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)].map((m) => Number(m[1] || m[2]) || 0);
  return Math.max(pages, ...comptes, 0);
}

// Les fichiers envoyés avec un message : [{ nom, media_type, data }] (data en base64 sans préfixe). Rend { ok, fichiers } ou { ok: false, erreur }.
// `deja` : ce que la conversation garde déjà ({ nombre, taille }), pour la limite de la conversation.
export function verifierPieces(liste, deja = { nombre: 0, taille: 0 }) {
  if (liste === undefined || liste === null) return { ok: true, fichiers: [] };
  if (!Array.isArray(liste)) return { ok: false, erreur: "fichier_illisible" };
  if (!liste.length) return { ok: true, fichiers: [] };
  if (liste.length > MAX_FICHIERS_MESSAGE) return { ok: false, erreur: "trop_de_fichiers" };
  const v = verifierFichiers(liste.map((f) => ({ media_type: f && f.media_type, data: f && f.data })));
  if (!v.ok) return v;
  const fichiers = v.fichiers.map((f, i) => ({ ...f, nom: texte(liste[i].nom, 120) || (f.media_type === "application/pdf" ? "document.pdf" : "photo.jpg"), taille: f.data.length }));
  for (const f of fichiers) if (f.media_type === "application/pdf" && pagesPdf(f.data) > MAX_PAGES_PDF) return { ok: false, erreur: "pdf_trop_long" };
  const total = fichiers.reduce((s, f) => s + f.taille, 0);
  if ((deja.nombre || 0) + fichiers.length > MAX_FICHIERS_CONVERSATION || (deja.taille || 0) + total > MAX_CONVERSATION_B64) return { ok: false, erreur: "conversation_pleine" };
  return { ok: true, fichiers };
}

// Référence courte d'une pièce jointe, que Claude cite (proposer_import_brochure) : « F- » et les huit premiers caractères de l'identifiant.
export const refFichier = (id) => `F-${String(id || "").replace(/-/g, "").slice(0, 8)}`;

// Le bloc gardé dans agent_messages pour un fichier enregistré.
export const blocFichier = (f) => ({ type: "fichier", id: f.id, nom: f.nom, media_type: f.media_type, taille: f.taille });

// Les fichiers dont les données partent à cet appel : les plus récents d'abord, tant qu'ils tiennent dans le budget. `lignes` : les
// métadonnées de la conversation ({ id, taille, cree_le }), dans l'ordre d'envoi. Rend l'ensemble des identifiants retenus.
export function fichiersRetenus(lignes = [], budget = BUDGET_APPEL_B64) {
  const retenus = new Set();
  let reste = budget;
  for (const f of [...lignes].reverse()) {
    const t = Number(f.taille) || 0;
    if (t > reste) continue;
    reste -= t;
    retenus.add(f.id);
  }
  return retenus;
}

// Un contenu enregistré vers ce que reçoit Claude : chaque bloc « fichier » devient une ligne qui le nomme (avec sa référence F-…) suivie du
// bloc image ou document ; un fichier absent (supprimé après 30 jours, hors budget) devient une ligne de texte qui le dit.
// `donnees` : Map id → { media_type, data } des fichiers retenus.
export function contenuPourClaude(contenu, donnees = new Map()) {
  if (!Array.isArray(contenu) || !contenu.some((b) => b && b.type === "fichier")) return contenu;
  const out = [];
  for (const b of contenu) {
    if (!b || b.type !== "fichier") {
      out.push(b);
      continue;
    }
    const nom = texte(b.nom, 120) || "fichier";
    const d = donnees.get(b.id);
    if (!d || !TYPES_FICHIER.includes(d.media_type)) {
      out.push({ type: "text", text: `[Pièce jointe ${refFichier(b.id)} : ${nom}, plus jointe à ce message (trop ancienne ou trop lourde pour la conversation). Si tu en as besoin, demande de la joindre à nouveau.]` });
      continue;
    }
    out.push({ type: "text", text: `[Pièce jointe ${refFichier(b.id)} : ${nom}]` });
    out.push(d.media_type === "application/pdf" ? { type: "document", source: { type: "base64", media_type: d.media_type, data: d.data } } : { type: "image", source: { type: "base64", media_type: d.media_type, data: d.data } });
  }
  return out;
}

export const historiquePourClaude = (messages, donnees) => messages.map((m) => (m.role === "user" ? { ...m, content: contenuPourClaude(m.content, donnees) } : m));

// Le titre d'une conversation qui commence par des fichiers sans texte : le nom du premier.
export const titreFichiers = (fichiers) => (fichiers && fichiers.length ? `${fichiers[0].nom}${fichiers.length > 1 ? ` (+${fichiers.length - 1})` : ""}` : "");
