// Aide des tests : un montant interne est-il bloqué par ces avertissements ? Avec le droit de voir les nets, « montant_interne:1350 » ;
// sans lui, une empreinte salée (revue de sécurité de la PR 306), que l'écran recalcule sur le texte. Pas un fichier de test.
import { bloquantsReponse, resteBloque } from "../src/gestion/js/agent-calc.mjs";
export const bloqueMontant = (avertissements = [], montant) => resteBloque(`${Number(montant).toLocaleString("en")} THB`, bloquantsReponse(avertissements)).length > 0 && (avertissements || []).some((a) => String(a).startsWith("montant_interne:"));
