// Partage d'un fichier (voucher, devis, facture) vers WhatsApp : quel chemin prendre, et comment dire ce qui s'est passé.
// Un lien WhatsApp (wa.me) ne peut JAMAIS joindre un fichier : seul le partage natif du téléphone (navigator.share avec `files`) le fait.
// Logique pure, testée avec node --test.

// « natif » : le navigateur sait joindre des fichiers, on ouvre la liste de partage. « ordinateur » : image copiée puis conversation
// ouverte, à coller soi-même. « telephone_sans_partage » : téléphone dont le navigateur ne partage pas de fichier (Firefox, navigateur
// intégré à WhatsApp ou Mail) : on ne peut pas joindre l'image, et on ne le cache pas en ouvrant WhatsApp avec un texte seul.
export function moyenPartage({ partageFichiers, tactile }) {
  if (partageFichiers) return "natif";
  return tactile ? "telephone_sans_partage" : "ordinateur";
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
