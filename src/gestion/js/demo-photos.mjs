// Démonstration des photos de la boîte WhatsApp (23.11.2026, « ça bugue de ouf quand il y a des images ») : une conversation de 18 photos,
// pour vérifier sur bureau et sur téléphone que le fil s'ouvre sur le dernier message et ne saute pas pendant le chargement des images.
// Les images sont dessinées ici (formes et couleurs, aucune vraie photo). Numéro de fiction (+44 7700 900…), aucun vrai client.
import { apercuDepuisMessages } from "./whatsapp-calc.mjs";

export const PREFIXE_PHOTO_DEMO = "demo/photos/";
// Formats variés, comme les photos d'un téléphone : portrait, paysage, carré, capture d'écran.
const FORMATS = [
  [900, 1200],
  [1200, 900],
  [1000, 1000],
  [720, 1560],
  [1600, 900],
];
const TEINTES = [168, 24, 205, 340, 95, 45, 270];

export function conversationPhotos({ secret, uid, organisation, maintenant = Date.now(), nombre = 18 }) {
  const il_y_a = (minutes) => new Date(maintenant - minutes * 60000).toISOString();
  const c = { id: uid(), created_at: il_y_a(60 * 24 * 3), updated_at: il_y_a(3), organisation_id: organisation, telephone: "+447700900966", nom: "Nina (photos)", entite_id: secret ? secret.id : null, entite_source: "manuel", client_id: null, dossier_id: null, dernier_message_le: null, dernier_sens: null, non_lus: 0, reponses: "auto", tri: {} };
  const messages = [];
  const ajouter = (minutes, sens, texte, o = {}) => messages.push({ id: uid(), conversation_id: c.id, sens, origine: sens === "entrant" ? "client" : "app", type: "text", texte, medias: [], envoye_le: il_y_a(minutes), recu_le: il_y_a(minutes), modifie_le: null, supprime_le: null, ...o });
  ajouter(60 * 26, "entrant", "Hi Nani! Here are the photos from our trip, as promised.");
  for (let i = 0; i < nombre; i++) {
    const minutes = 60 * 25 - i * 70;
    const legende = i % 5 === 2 ? `Day ${1 + Math.floor(i / 5)}, view from the boat` : null;
    const [largeur, hauteur] = FORMATS[i % FORMATS.length];
    // Les premières photos ont leurs dimensions (média récent), les autres non : les deux cas de la place réservée.
    const dims = i % 2 ? {} : { largeur, hauteur };
    ajouter(minutes, "entrant", legende, { type: "image", texte: null, medias: [{ type: "image", mime: "image/jpeg", legende, nom: `photo-${i + 1}.jpg`, chemin: `${PREFIXE_PHOTO_DEMO}${i + 1}-${largeur}x${hauteur}.svg`, statut: "copie", taille: 150000 + i * 1000, ...dims }] });
    if (i === 6) ajouter(minutes - 20, "sortant", "Beautiful! Thank you for sharing.", { origine: "app" });
  }
  ajouter(4, "entrant", "And the last one, the sunset on our last evening.");
  ajouter(3, "sortant", "Lovely, thank you. Have a safe trip home!", { origine: "app" });
  const dernier = messages[messages.length - 1];
  Object.assign(c, { dernier_message_le: dernier.envoye_le, dernier_sens: dernier.sens }, apercuDepuisMessages(messages));
  return { whatsapp_conversations: [c], whatsapp_messages: messages };
}

// Une image dessinée pour un chemin de démonstration : ses dimensions viennent du nom (« 3-1000x1000.svg »). null pour un autre chemin.
export function imagePhotoDemo(chemin) {
  const m = String(chemin || "").match(/^demo\/photos\/(\d+)-(\d+)x(\d+)\.svg$/);
  if (!m) return null;
  const [n, l, h] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = TEINTES[n % TEINTES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${l}" height="${h}" viewBox="0 0 ${l} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${t},60%,72%)"/><stop offset="1" stop-color="hsl(${(t + 40) % 360},55%,38%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${l * 0.7}" cy="${h * 0.32}" r="${Math.min(l, h) * 0.12}" fill="hsl(45,95%,80%)"/><path d="M0 ${h * 0.75} Q ${l * 0.3} ${h * 0.6} ${l * 0.55} ${h * 0.72} T ${l} ${h * 0.68} V ${h} H 0 Z" fill="hsl(${(t + 180) % 360},35%,25%)" opacity="0.8"/><text x="50%" y="${h * 0.9}" font-family="sans-serif" font-size="${Math.round(Math.min(l, h) * 0.08)}" fill="#fff" text-anchor="middle">Photo ${n}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
