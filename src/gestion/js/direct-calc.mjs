// Gestion en direct (demande de Jérémy, 19.11.2026) : une nouvelle demande du site et une nouvelle version de l'outil arrivent sans rafraîchir.
// Logique pure, testée par node --test : quels écrans se redessinent seuls, et quand recharger l'outil sans jamais perdre une saisie.

// Écrans de lecture : la synchronisation peut les redessiner quand la base a changé (aucune saisie possible hors des fenêtres et des champs,
// que saisieEnCours surveille à part). « Demandes du site » en fait partie : avant le 19.11.2026, une nouvelle demande n'y arrivait qu'en
// rafraîchissant la page. « WhatsApp » aussi (20.11.2026) : la réponse préparée en cours de modification est une saisie, que saisieEnCours protège.
export const ECRANS_DE_LECTURE = /^#?\/?$|^#\/(dossiers|clients|taches|reservations|du|partenaires|trajets|tarifs|catalogue|analyses|groupe|journal|demandes|whatsapp)(\?.*)?$|^#\/analyses(\/[a-z]+)?(\?.*)?$|^#\/(dossier|client|partenaire)\/[\w-]+(\?.*)?$/;
export const ecranDeLecture = (hash) => ECRANS_DE_LECTURE.test(hash || "#/");

// Tables suivies en direct (Supabase Realtime, migration 47). Les autres changements arrivent par la relecture de chaque minute.
export const TABLES_EN_DIRECT = ["demandes_site"];

// Une nouvelle version est en ligne : recharger maintenant ? Jamais pendant une saisie (fenêtre ouverte, champ modifié ou en cours).
// Sinon, au premier moment sûr :
//   * l'onglet est caché (personne ne le regarde) ;
//   * l'onglet revient au premier plan ;
//   * personne n'a touché l'outil depuis `inactif` (cinq minutes : une lecture n'est pas coupée) ;
//   * une saisie qui bloquait vient d'être enregistrée ou abandonnée (`apresSaisie`, dans les trente secondes) et rien n'a bougé depuis
//     `calme` (trois secondes, le temps de lire le message « enregistré »).
export const INACTIF_MS = 5 * 60 * 1000;
export const CALME_MS = 3 * 1000;
export function momentDeRecharger({ nouvelle = false, saisie = false, cache = false, retour = false, inactifMs = 0, apresSaisie = false } = {}) {
  if (!nouvelle || saisie) return false;
  if (cache || retour) return true;
  if (inactifMs >= INACTIF_MS) return true;
  return apresSaisie && inactifMs >= CALME_MS;
}

// Demandes à traiter avant et après une relecture, dans la même entreprise : celles qui n'y étaient pas s'annoncent (« Nouvelle demande du
// site »). Par identifiant, pas par compte : une demande traitée ailleurs pendant qu'une autre arrive n'efface pas l'arrivée.
export const nouvellesDemandes = (avant, apres) => {
  if (!avant || !apres || avant.entite !== apres.entite) return 0;
  const vues = new Set(avant.ids || []);
  return (apres.ids || []).filter((id) => !vues.has(id)).length;
};
