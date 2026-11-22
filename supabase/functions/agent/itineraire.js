// Calcul d'itinéraire seulement sur demande (Jérémy, 22.11.2026 : « L'assistant me fait toujours le calcul d'itinéraires alors que je n'en ai
// pas besoin. Il faut qu'il calcule seulement quand j'en ai besoin ou que je lui demande. »). Logique pure, sans réseau.
// Les outils de route et de planning (temps_de_route, planifier_course, horaires_trajet, estimer_temps_web) ne s'exécutent que :
//   - quand la personne le demande dans son propre message (« combien de temps », « à quelle heure partir », « calcule l'heure de pickup »,
//     « how long », « what time should we leave »…) ; un client qui le demande dans l'échange WhatsApp joint ne compte pas ;
//   - ou quand une course se crée et qu'aucune heure de prise en charge n'est donnée nulle part (ni par le client, ni par la personne) :
//     elle ne peut alors venir que du calcul.
// Une heure de pickup donnée par le client ou par la personne n'est jamais recalculée. Ils restent dans la liste des outils (le cache et les
// appels déjà gardés dans l'historique ne changent pas) ; la fonction refuse l'exécution hors de ces deux cas et le dit au modèle.

export const OUTILS_ITINERAIRE = ["temps_de_route", "planifier_course", "horaires_trajet", "estimer_temps_web"];

const plat = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘]/g, "'");
// Le texte de la personne seulement : sans l'échange WhatsApp joint ni le résumé d'une discussion remplacée.
export const motsDeLaPersonne = (t) =>
  String(t || "")
    .replace(/<conversation>[\s\S]*?<\/conversation>/g, " ")
    .replace(/<resume_discussion>[\s\S]*?<\/resume_discussion>/g, " ");
// La question tapée dans « Demander à l'assistant » (entre <question> et </question>), sinon tout le texte de la personne.
const questionOuTexte = (t) => {
  const m = /<question>([\s\S]*?)<\/question>/.exec(String(t || ""));
  return m ? m[1] : motsDeLaPersonne(t);
};

const DEMANDE = new RegExp(
  [
    // français
    "combien de temps",
    "(?:quelle|quel) (?:est la |sera la )?duree",
    "temps de (?:route|trajet)",
    "a quelle heure (?:partir|faut-il partir|il faut partir|doit-il partir|on part|le pickup|le pick-up|la prise en charge|passer|venir|le chercher|les chercher|la chercher)",
    "(?:calcule|calculer|recalcule|recalculer|estime|estimer|planifie|planifier|verifie|verifier)\\s+(?:moi\\s+)?(?:l'|le |la |les )?(?:heure|horaire|pick-?up|prise en charge|itineraire|trajet|route|duree|course|planning)",
    "(?:quelle|quel) (?:heure|horaire) (?:de |du )?(?:pick-?up|prise en charge|depart)",
    "heure de (?:pick-?up|prise en charge|depart)\\s*\\?",
    "itineraire",
    "(?:horaires?|departs?) (?:des?|du) (?:bateaux?|ferry|ferries|speedboats?|minivans?)",
    "(?:est-ce|c'est) (?:tenable|jouable|faisable)",
    "(?:on a|il a|ils ont|elle a) le temps",
    // anglais
    "how long",
    "how much time",
    "travel time",
    "driving time",
    "what time (?:should|do|must|to|will)",
    "when should (?:we|they|he|she) (?:leave|go|be picked)",
    "(?:boat|ferry) (?:times|schedule)",
  ].join("|")
);
export const demandeItineraire = (texte) => DEMANDE.test(plat(questionOuTexte(texte)));

// Une heure de prise en charge donnée : « Pickup time: 11:00 », « pick up at 9.30 », « prise en charge à 8h », « pickup 10am ».
const HEURE = "(?:[01]?\\d|2[0-3])\\s*(?:[:h.]\\s*[0-5]\\d|h\\b|\\s?(?:am|pm)\\b)";
const PICKUP_DONNE = new RegExp(`(?:pick[\\s-]?up(?: time)?|prise en charge|ramassage|heure de depart|depart (?:de l'hotel|a l'hotel))[^\\n\\d]{0,25}${HEURE}`);
export const pickupDonne = (textes = []) => (Array.isArray(textes) ? textes : [textes]).some((t) => PICKUP_DONNE.test(plat(t)));

// Une course ou un dossier se crée : « Créer le dossier » ou « Mettre à jour le dossier » depuis WhatsApp, « Prépare les dossiers », ou la
// personne le demande avec ses mots.
const CREATION = /(?:cree|creer|creez|prepare|preparer|fais|faire|ouvre|ouvrir|ajoute|ajouter|mets? a jour)\b[^.\n]{0,40}\b(?:dossiers?|reservations?|course|transfert|service)|\b(?:reserve|reserver|book it|book the)\b/;
export const creationEnCours = ({ texte = "", modeWa = "" } = {}) => modeWa === "creer" || modeWa === "maj" || CREATION.test(plat(questionOuTexte(texte)));

// horaires_trajet n'est pas un calcul d'itinéraire : il lit les départs et les prix du catalogue (bateau, ferry, speedboat, minivan partagé).
// Il reste permis quand la demande porte sur un tel trajet, dans les mots de la personne ou dans l'échange joint (« Speedboat request »,
// « donne-moi les possibilités pour Koh Yao Noi », « le bateau pour Phi Phi ») : sans lui, aucun prix de bateau à proposer. Rejeu des
// 7 jours avant le 22.11.2026 : 6 de ses 8 appels servaient à ces devis.
const TRAJET_HORAIRE = /\b(?:bateaux?|boats?|ferry|ferries|speed ?boats?|longtails?|long-tails?|minivans? partages?|shared minivans?|joint (?:boat|minivan)|departs? (?:des? |du )?(?:bateaux?|ferry))\b/;
export const trajetAHoraires = (texte) => TRAJET_HORAIRE.test(plat(texte));

// La décision d'un échange. `texte` : le message de cet échange (avec l'échange WhatsApp joint s'il y en a un) ; `precedents` : les textes
// de la personne déjà gardés dans la discussion ; `modeWa` : « creer », « maj », « question » ou "".
// Rend { permis, raison, horaires } : raison « demande », « pickup_manquant », « pickup_donne » ou « non_demande » ; `horaires` : horaires_trajet
// permis (départs et prix du catalogue), même quand le calcul ne l'est pas.
export function itinerairePermis({ texte = "", precedents = [], modeWa = "" } = {}) {
  const horaires = trajetAHoraires(texte);
  if (demandeItineraire(texte)) return { permis: true, raison: "demande", horaires: true };
  if (pickupDonne([texte, ...(precedents || [])])) return { permis: false, raison: "pickup_donne", horaires };
  if (creationEnCours({ texte, modeWa })) return { permis: true, raison: "pickup_manquant", horaires: true };
  return { permis: false, raison: "non_demande", horaires };
}
// Un outil d'itinéraire est-il permis dans cet échange ? horaires_trajet suit `horaires`, les trois autres `permis`.
export const outilPermis = (nom, decision) => !decision || !OUTILS_ITINERAIRE.includes(nom) || (nom === "horaires_trajet" ? decision.horaires === true || decision.permis === true : decision.permis === true);

// Ce que rend un outil d'itinéraire refusé : rien n'est calculé, le modèle sait pourquoi et quoi faire.
export function refusItineraire(raison) {
  return {
    erreur: "itineraire_non_demande",
    conseil:
      raison === "pickup_donne"
        ? "L'heure de prise en charge est déjà donnée dans la conversation : reprends-la telle quelle, ne la recalcule pas."
        : "Le calcul d'itinéraire n'est fait que sur demande de la personne, ou quand une heure de prise en charge manque pour créer la course. Ne calcule rien ; si une heure manque, demande-la en une ligne.",
  };
}
// La ligne du contexte de l'échange (prompt.js, contexteDuJour) : le modèle sait d'avance si le calcul est permis.
export function ligneItineraire(decision) {
  if (!decision) return "";
  if (decision.raison === "demande") return "Calcul d'itinéraire : demandé par la personne dans ce message.";
  if (decision.raison === "pickup_manquant") return "Calcul d'itinéraire : seulement pour l'heure de prise en charge qui manque à la course, rien d'autre.";
  const horaires = decision.horaires ? " horaires_trajet reste permis pour les départs et les prix du bateau ou du minivan demandé." : " N'appelle pas non plus horaires_trajet.";
  if (decision.raison === "pickup_donne") return `Calcul d'itinéraire : non. L'heure de prise en charge est donnée : reprends-la telle quelle.${horaires}`;
  return `Calcul d'itinéraire : non demandé dans ce message. N'appelle ni temps_de_route, ni planifier_course, ni estimer_temps_web.${horaires}`;
}
