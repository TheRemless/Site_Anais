// Envoi par lien : durée, état d'un lien, chemin du fichier et texte du message. Logique pure, testée avec node --test.
// Le fichier est déposé dans un stockage privé (bucket « envois », migration 22) ; le client reçoit une adresse signée qui expire.
import { dateTexte } from "./operations-calc.mjs";

// Durée par défaut d'un lien, en jours. Au-delà, le fichier est retiré du stockage.
export const DUREE_JOURS = 30;

export const expiration = (maintenant, jours = DUREE_JOURS) => new Date(new Date(maintenant).getTime() + jours * 86400000).toISOString();

// Chemin du fichier dans le stockage : l'entreprise, puis un identifiant aléatoire. Aucun nom de client, rien de devinable.
export const cheminLien = (entiteId, uuid, type = "") => `${entiteId}/${uuid}.${type === "application/pdf" ? "pdf" : type === "image/jpeg" ? "jpg" : "png"}`;

// Un lien est actif tant qu'il n'est ni révoqué, ni nettoyé, ni expiré.
export const lienActif = (lien, maintenant = Date.now()) => !lien.revoque_le && !lien.nettoye_le && new Date(lien.expire_le).getTime() > new Date(maintenant).getTime();

// Secondes de validité restantes, pour signer l'adresse jusqu'à la même échéance que la ligne.
export const secondesRestantes = (lien, maintenant = Date.now()) => Math.max(0, Math.floor((new Date(lien.expire_le).getTime() - new Date(maintenant).getTime()) / 1000));

// Texte du message WhatsApp : le lien est dans le texte, donc le message ne prétend jamais joindre un fichier.
// `liens` : [{ nom, url }] ; `genre` : « voucher », « devis » ou « facture » ; `langue` : « fr » ou « en ».
export function messageLien({ genre, langue = "en", prenom = "", liens, expire }) {
  const en = langue === "en";
  const jusque = expire ? dateTexte(String(expire).slice(0, 10), en ? "en" : "fr") : "";
  const tete = en ? `Hello${prenom ? ` ${prenom}` : ""},` : `Bonjour${prenom ? ` ${prenom}` : ""},`;
  const noms = { voucher: ["voucher", "vouchers", "voucher", "vouchers"], devis: ["quote", "quotes", "devis", "devis"], facture: ["invoice", "invoices", "facture", "factures"] }[genre] || ["document", "documents", "document", "documents"];
  const plusieurs = liens.length > 1;
  const nom = noms[(en ? 0 : 2) + (plusieurs ? 1 : 0)];
  const intro = en ? `here ${plusieurs ? "are" : "is"} your ${nom}:` : `voici ${plusieurs ? "vos" : "votre"} ${nom} :`;
  const corps = plusieurs ? liens.map((l, i) => `${i + 1}. ${l.url}`).join("\n") : liens[0].url;
  const validite = jusque ? (en ? `The link is valid until ${jusque}.` : `Le lien est valable jusqu'au ${jusque}.`) : "";
  return [tete, "", intro, corps, validite && "", validite].filter((x, i, a) => !(x === "" && (i === a.length - 1))).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
