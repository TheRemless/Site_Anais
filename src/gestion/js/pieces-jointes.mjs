// Pièces jointes (20.11.2026) : préparer une photo, une capture ou un PDF avant de l'envoyer à l'assistant (onglet Assistant, Importer une
// brochure). Une photo de téléphone (4 000 pixels, plusieurs Mo) est réduite à 2 000 pixels de côté en JPEG : les chiffres restent nets et
// l'envoi léger. Un PDF part tel quel. Les limites sont celles que la fonction contrôle de son côté (supabase/functions/agent/fichiers.js).
import { tr, N_, langueActive } from "./i18n.mjs";

export const LIMITES = { fichiers: 6, totalMo: 10, pdfMo: 8, cote: 2000, pagesPdf: 40 };
export const ACCEPTE = "image/*,application/pdf";

export const ERREURS_FICHIER = {
  trop_de_fichiers: N_("Six fichiers au plus par message."),
  fichier_type: N_("Ce type de fichier ne se lit pas : joignez une photo, une capture ou un PDF."),
  fichier_illisible: N_("Un fichier n'a pas pu être ouvert : reprenez la photo ou exportez-la en JPEG."),
  fichier_trop_lourd: N_("Les fichiers dépassent 10 Mo : joignez moins de pages, ou des captures à la place du PDF."),
  pdf_trop_long: N_("Ce PDF dépasse 40 pages : joignez seulement les pages utiles."),
  conversation_pleine: N_("Cette conversation garde déjà 20 fichiers (ou 30 Mo) : ouvrez une nouvelle conversation."),
  fichiers_absents: N_("Ces fichiers ne sont plus gardés (30 jours au plus) : joignez-les à nouveau dans la conversation."),
};
export const erreurFichier = (code) => (ERREURS_FICHIER[code] ? tr(ERREURS_FICHIER[code]) : "");

// Le type d'un fichier choisi : certains navigateurs n'en donnent pas pour un PDF ou une photo HEIC, l'extension sert alors.
export function typeDe(f) {
  const t = String((f && f.type) || "").toLowerCase();
  if (t) return t;
  const n = String((f && f.name) || "").toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (/\.(jpe?g|png|webp|heic|heif|gif)$/.test(n)) return "image/*";
  return "";
}
export const accepte = (f) => {
  const t = typeDe(f);
  return t === "application/pdf" || t.startsWith("image/");
};

// Ajouter des fichiers choisis à ceux déjà joints : rend ceux qui entrent et la raison du refus des autres (type, nombre, taille d'un PDF).
export function trierAjout(deja = [], nouveaux = []) {
  const gardes = [];
  let refus = "";
  for (const f of nouveaux) {
    if (!accepte(f)) {
      refus = refus || "fichier_type";
      continue;
    }
    if (typeDe(f) === "application/pdf" && f.size > LIMITES.pdfMo * 1024 * 1024) {
      refus = refus || "fichier_trop_lourd";
      continue;
    }
    if (deja.length + gardes.length >= LIMITES.fichiers) {
      refus = refus || "trop_de_fichiers";
      continue;
    }
    gardes.push(f);
  }
  return { gardes, refus };
}

// Le poids des fichiers prêts (en caractères base64, comme la fonction le compte) : au-delà de 10 Mo, l'envoi est refusé avant de partir.
export const tropLourd = (prets = []) => prets.reduce((s, p) => s + String(p.data || "").length, 0) > Math.floor((LIMITES.totalMo * 1024 * 1024 * 4) / 3);

export const tailleTexte = (octets) => {
  if (octets < 1024 * 1024) return tr("{n} ko", { n: Math.max(1, Math.round(octets / 1024)) });
  const mo = (octets / 1024 / 1024).toFixed(1);
  return tr("{n} Mo", { n: langueActive() === "en" ? mo : mo.replace(".", ",") });
};

const enBase64 = (blob) =>
  new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).slice(String(r.result).indexOf(",") + 1));
    r.onerror = () => ko(new Error("fichier_illisible"));
    r.readAsDataURL(blob);
  });

// Décode une image : createImageBitmap (avec l'orientation de la photo, puis sans option pour un navigateur qui la refuse), sinon un élément
// <img>. Rend un objet qui a une largeur, une hauteur et se dessine sur une toile.
async function decoder(fichier) {
  for (const options of [{ imageOrientation: "from-image" }, undefined]) {
    try {
      if (typeof createImageBitmap === "function") return await createImageBitmap(fichier, options);
    } catch {
      /* essai suivant */
    }
  }
  const adresse = URL.createObjectURL(fichier);
  try {
    const img = new Image();
    img.src = adresse;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight, image: img, close: null };
  } catch {
    throw new Error("fichier_illisible");
  } finally {
    setTimeout(() => URL.revokeObjectURL(adresse), 0);
  }
}

// Rend { nom, media_type, data } (data en base64 sans préfixe). Lève une erreur dont le message est le code (fichier_type, fichier_illisible…).
export async function preparer(fichier) {
  const nom = String(fichier.name || "").slice(0, 120);
  const type = typeDe(fichier);
  if (type === "application/pdf") {
    if (fichier.size > LIMITES.pdfMo * 1024 * 1024) throw new Error("fichier_trop_lourd");
    return { nom: nom || "document.pdf", media_type: "application/pdf", data: await enBase64(fichier) };
  }
  if (!type.startsWith("image/")) throw new Error("fichier_type");
  const image = await decoder(fichier);
  const echelle = Math.min(1, LIMITES.cote / Math.max(image.width, image.height));
  const toile = document.createElement("canvas");
  toile.width = Math.max(1, Math.round(image.width * echelle));
  toile.height = Math.max(1, Math.round(image.height * echelle));
  const ctx = toile.getContext("2d");
  // Fond blanc : une capture PNG transparente ne devient pas noire en JPEG.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, toile.width, toile.height);
  ctx.drawImage(image.image || image, 0, 0, toile.width, toile.height);
  if (image.close) image.close();
  const blob = await new Promise((ok) => toile.toBlob(ok, "image/jpeg", 0.86));
  if (!blob) throw new Error("fichier_illisible");
  // Le nom garde son début, avec l'extension du JPEG produit.
  const base = nom.replace(/\.[a-z0-9]{2,5}$/i, "") || "photo";
  return { nom: `${base}.jpg`, media_type: "image/jpeg", data: await enBase64(blob) };
}
