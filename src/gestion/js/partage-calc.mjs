// Partage d'un fichier (voucher, devis, facture) vers WhatsApp : quel chemin prendre, et comment dire ce qui s'est passé.
// Un lien WhatsApp (wa.me) ne peut JAMAIS joindre un fichier : seul le partage natif du téléphone (navigator.share avec `files`) le fait.
// Logique pure, testée avec node --test.

// « natif » : le navigateur sait joindre des fichiers, on ouvre la liste de partage. « ordinateur » : image copiée puis conversation
// ouverte, à coller soi-même. « telephone_sans_partage » : téléphone dont le navigateur ne partage pas de fichier (Firefox, navigateur
// intégré à WhatsApp ou Mail) : on ne peut pas joindre l'image, et on ne le cache pas en ouvrant WhatsApp avec un texte seul.
// Sur ordinateur, WhatsApp Web ou l'application de bureau reçoit l'image collée (Cmd+V ou Ctrl+V) bien plus sûrement que par la feuille de
// partage du système : le chemin « ordinateur » passe donc par le presse-papiers, et le partage natif, s'il existe, reste une alternative.
export function moyenPartage({ partageFichiers, tactile }) {
  if (tactile) return partageFichiers ? "natif" : "telephone_sans_partage";
  return "ordinateur";
}

// Raccourci pour coller, d'après le système : Cmd+V sur Mac, iPhone et iPad, Ctrl+V ailleurs.
export const raccourciColler = (plateforme = "") => (/Mac|iPhone|iPad|iPod/i.test(String(plateforme)) ? "Cmd+V" : "Ctrl+V");

// Pourquoi une copie dans le presse-papiers a échoué, dit simplement. `erreur` : l'exception du navigateur, ou null si l'API n'existe pas.
export function raisonCopieRefusee(erreur) {
  if (!erreur) return "ce navigateur ne sait pas copier une image";
  const nom = erreur.name || "";
  if (nom === "NotAllowedError") return "le navigateur a refusé l'accès au presse-papiers, page non active ou autorisation retirée";
  if (nom === "SecurityError") return "le navigateur bloque le presse-papiers sur cette page";
  if (nom === "TypeError" || nom === "DataError" || nom === "NotSupportedError") return "ce navigateur ne sait pas copier une image PNG";
  return erreur.message || "raison inconnue";
}

export function erreurLisible(err) {
  if (!err) return "Erreur inconnue";
  if (typeof err === "string") return err;
  const nom = err.name || "Erreur";
  return err.message ? `${nom} : ${err.message}` : nom;
}

// Nom court du navigateur, pour qu'une capture d'écran de l'erreur dise où elle s'est produite.
export function navigateurLisible(ua) {
  const u = String(ua || "");
  if (!u) return "Navigateur inconnu";
  const iphone = /iPhone|iPad|iPod/.test(u);
  const android = /Android/.test(u);
  const appareil = iphone ? "iPhone" : android ? "Android" : "ordinateur";
  if (/WhatsApp|FBAN|FBAV|Instagram|Line\/|; wv\)|GSA\//.test(u)) return `Navigateur intégré ${appareil}`;
  if (/FxiOS|Firefox/.test(u)) return `Firefox ${appareil}`;
  if (/EdgiOS|EdgA|Edg\//.test(u)) return `Edge ${appareil}`;
  if (/CriOS|Chrome/.test(u)) return `Chrome ${appareil}`;
  if (/Safari/.test(u)) return `Safari ${appareil}`;
  return `Navigateur ${appareil}`;
}

export function resumeEnvironnement({ userAgent = "", standalone = false, partageFichiers = false } = {}) {
  return [navigateurLisible(userAgent), standalone ? "application installée" : "dans le navigateur", `partage de fichiers : ${partageFichiers ? "oui" : "non"}`].join(" · ");
}
