// Partage de fichiers (vouchers, devis, factures) : un seul endroit pour décider du chemin, appeler le partage natif dans le geste de la
// personne, et dire honnêtement ce qui s'est passé quand l'image ou le PDF ne peut pas partir. Voir partage-calc.mjs pour la logique pure.
import { h, toast } from "../ui.mjs";
import { telecharger } from "./commun.mjs";
import { moyenPartage, erreurLisible, resumeEnvironnement, raccourciColler, raisonCopieRefusee } from "../partage-calc.mjs";
import { tr } from "../i18n.mjs";

export const partageFichiers = (fichiers) => !!(fichiers && fichiers.length && navigator.canShare && navigator.canShare({ files: fichiers }));
const tactile = () => !window.matchMedia("(hover: hover)").matches;
export const moyen = (fichiers) => moyenPartage({ partageFichiers: partageFichiers(fichiers), tactile: tactile() });
export const environnement = (fichiers) =>
  resumeEnvironnement({ userAgent: navigator.userAgent, standalone: (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true, partageFichiers: partageFichiers(fichiers) });

// Raccourci pour coller selon le système de la personne (Cmd+V sur Mac, Ctrl+V ailleurs).
export const raccourci = () => raccourciColler(navigator.userAgentData && navigator.userAgentData.platform ? navigator.userAgentData.platform : navigator.platform || navigator.userAgent);

// Le navigateur sait-il copier une image ? Safari, Chrome récent et Firefox 127 et plus : oui. Sinon on le dit et on propose d'enregistrer.
export const copieImagePossible = () => typeof ClipboardItem !== "undefined" && !!navigator.clipboard && typeof navigator.clipboard.write === "function" && (typeof ClipboardItem.supports !== "function" || ClipboardItem.supports("image/png"));

// Copie l'image dans le presse-papiers et ne renvoie ok que si l'écriture a réussi (la promesse résolue est la seule preuve que le navigateur donne).
export async function copierImage(fichier) {
  if (!copieImagePossible()) return { ok: false, raison: raisonCopieRefusee(null), erreur: null };
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": fichier })]);
    return { ok: true };
  } catch (erreur) {
    return { ok: false, raison: raisonCopieRefusee(erreur), erreur };
  }
}

export async function copierTexte(texte) {
  try {
    await navigator.clipboard.writeText(texte);
    toast(tr("Message copié."));
  } catch {
    toast(tr("Copie impossible dans ce navigateur : sélectionnez le texte à la main."), true);
  }
}

// Zone d'état d'un écran d'envoi : ce qui s'est passé, l'erreur exacte du navigateur, le détail technique à lire sur un téléphone.
// `fichiers()` : les fichiers prêts (vide tant qu'ils se préparent).
export function zoneEnvoi({ fichiers }) {
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
      message.classList.remove("ok");
      message.replaceChildren(...[h("p", null, h("strong", null, titre)), erreur ? h("p", { class: "partage-erreur" }, tr("Réponse du navigateur : {erreur}", { erreur: erreurLisible(erreur) })) : null, h("div", { class: "actions gauche" }, boutons)].filter(Boolean));
      message.hidden = false;
      message.scrollIntoView({ block: "nearest" });
      if (erreur) {
        journal.textContent = tr("Dernière erreur : {erreur}", { erreur: erreurLisible(erreur) });
        journal.hidden = false;
        details.open = true;
      }
    },
    // Ce qui a marché et ce qu'il reste à faire, à l'écran jusqu'à ce que la personne passe à autre chose : un toast de 3 secondes disparaît pendant qu'elle change de fenêtre.
    succes({ titre, etapes = [], boutons = [] }) {
      majTechnique();
      message.replaceChildren(...[h("p", null, h("strong", null, titre)), etapes.length ? h("ol", { class: "partage-etapes" }, etapes.map((e) => h("li", null, e))) : null, boutons.length ? h("div", { class: "actions gauche" }, boutons) : null].filter(Boolean));
      message.classList.add("ok");
      message.hidden = false;
      message.scrollIntoView({ block: "nearest" });
    },
    effacer() {
      message.classList.remove("ok");
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
