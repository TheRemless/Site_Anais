// Devis « sans suite » : un devis resté sans réponse sort des relances et des devis en attente, sans effacer le dossier. Réversible.
// Logique pure, testée avec node --test. Le statut « sans_suite » est calculé dans calc.mjs (statutDepuis) à partir de `sans_suite_le`.
import { N_ } from "./i18n.mjs";

// Motifs courts proposés d'un tap. Un autre motif se tape à la main (120 caractères au plus).
export const MOTIFS = [N_("Pas de réponse"), N_("Parti ailleurs"), N_("Trop cher"), N_("Voyage reporté")];
export const LONGUEUR_MAX = 120;

// Seul un devis encore sans suite possible peut être classé : jamais un dossier accepté, payé ou annulé.
export const peutClasser = ({ annule = false, statut = "" } = {}) => !annule && (statut === "brouillon" || statut === "devis_envoye");

// Les colonnes viennent de la migration 25. Tant qu'elle n'est pas appliquée, la base ne renvoie pas `sans_suite_le` : le bouton reste caché
// plutôt que de proposer une action qui échouerait. Le mode démonstration (stockage local) l'a toujours.
export const disponible = (dossier, baseDistante) => !baseDistante || (!!dossier && "sans_suite_le" in dossier);

export const estSansSuite = (dossier) => !!(dossier && dossier.sans_suite_le);

export function valeursSansSuite(motif, aujourdhui) {
  return { sans_suite_le: aujourdhui, sans_suite_motif: String(motif || "").replace(/\s+/g, " ").trim().slice(0, LONGUEUR_MAX) };
}
export const valeursRouvrir = () => ({ sans_suite_le: null, sans_suite_motif: null });
