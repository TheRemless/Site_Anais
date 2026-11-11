// Partage de fichiers (vouchers, devis, factures) : un seul endroit pour décider du chemin, appeler le partage natif dans le geste de la
// personne, et dire honnêtement ce qui s'est passé quand l'image ou le PDF ne peut pas partir. Voir partage-calc.mjs pour la logique pure.
import { h, toast } from "../ui.mjs";
import { telecharger } from "./commun.mjs";
import { moyenPartage, erreurLisible, resumeEnvironnement } from "../partage-calc.mjs";
import { tr } from "../i18n.mjs";

export const partageFichiers = (fichiers) => !!(fichiers && fichiers.length && navigator.canShare && navigator.canShare({ files: fichiers }));
const tactile = () => !window.matchMedia("(hover: hover)").matches;
export const moyen = (fichiers) => moyenPartage({ partageFichiers: partageFichiers(fichiers), tactile: tactile() });
export const environnement = (fichiers) =>
  resumeEnvironnement({ userAgent: navigator.userAgent, standalone: (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true, partageFichiers: partageFichiers(fichiers) });

export async function copierTexte(texte) {
  try {
    await navigator.clipboard.writeText(texte);
    toast(tr("Message copié."));
  } catch {
    toast(tr("Copie impossible dans ce navigateur : sélectionnez le texte à la main."), true);
  }
}

// Zone d'état d'un écran d'envoi : ce qui s'est passé, l'erreur exacte du navigateur, le détail technique à lire sur un téléphone.
// `fichiers()` : les fichiers prêts (vide tant qu'ils se préparent) ; `texte()` : le message à copier.
export function zoneEnvoi({ fichiers, texte }) {
  const message = h("div", { class: "partage-etat", role: "alert", hidden: true });
  const technique = h("p", { class: "partage-technique" });
  const journal = h("p", { class: "partage-technique", hidden: true });
  const details = h("details", { class: "partage-details" }, h("summary", null, tr("Détails techniques")), technique, journal);
  const majTechnique = () => (technique.textContent = environnement(fichiers()));
  majTechnique();
  return {
    noeud: h("div", { class: "partage-zone" }, message, details),
    maj: majTechnique,
    // Dit ce qui n'a pas marché et propose ce qui marche : jamais un silence, jamais un texte seul envoyé en faisant croire que l'image suit.
    echec({ titre, erreur = null, boutons = [] }) {
      majTechnique();
      message.replaceChildren(...[h("p", null, h("strong", null, titre)), erreur ? h("p", { class: "partage-erreur" }, tr("Réponse du navigateur : {erreur}", { erreur: erreurLisible(erreur) })) : null, h("div", { class: "actions gauche" }, boutons)].filter(Boolean));
      message.hidden = false;
      if (erreur) {
        journal.textContent = tr("Dernière erreur : {erreur}", { erreur: erreurLisible(erreur) });
        journal.hidden = false;
        details.open = true;
      }
    },
    effacer() {
      message.hidden = true;
      message.replaceChildren();
    },
  };
}

// Appelé dans le geste de la personne (un tap) : ouvre la liste de partage du téléphone avec les fichiers, sans texte. Un texte joint peut
// faire que WhatsApp ne garde que lui sur iPhone ; le message se copie à part. Renvoie "ok", "annule" ou { erreur }.
export async function partager(fichiers) {
  try {
    await navigator.share({ files: fichiers });
    return "ok";
  } catch (err) {
    if (err && err.name === "AbortError") return "annule";
    return { erreur: err };
  }
}

export const enregistrer = (fichiers) => fichiers.forEach((f) => telecharger(f.name, f, f.type));
