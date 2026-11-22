// Calcul d'itinéraire seulement sur demande (Jérémy, 22.11.2026 : « L'assistant me fait toujours le calcul d'itinéraires alors que je n'en ai
// pas besoin. Il faut qu'il calcule seulement quand j'en ai besoin ou que je lui demande. »). Logique pure, sans réseau. Revu après la
// relecture de la PR 328 : une expression régulière rate trop de demandes (thaï, relances, tournures libres), elle ne bloque donc jamais Nani.
//   - La consigne (prompt.js), la description des outils et une ligne du contexte de chaque message (ligneItineraire) disent au modèle de ne
//     calculer que sur demande, ou pour une heure de prise en charge qui manque. Dans le doute, on autorise.
//   - Un seul blocage à l'exécution (bloquerRecalcul) : pendant la création d'une carte sans aucun mot de Nani dans le message en cours ni
//     dans ses 2 messages précédents, planifier_course ne recalcule pas une heure de prise en charge déjà donnée pour CE service (même date,
//     même lieu de départ). Un retour sans heure se calcule ; le client B d'un apporteur n'est pas bloqué par le pickup du client A.
//   - horaires_trajet (départs et prix d'un bateau, d'un ferry ou d'un minivan partagé) n'est jamais bloqué (validé par Jérémy, 22.11.2026).

export const OUTILS_ITINERAIRE = ["temps_de_route", "planifier_course", "horaires_trajet", "estimer_temps_web"];

export const plat = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘]/g, "'");
const BLOC_CONVERSATION = /<conversation>[\s\S]*?<\/conversation>/g;
const BLOC_RESUME = /<resume_discussion>[\s\S]*?<\/resume_discussion>/g;
// Les consignes écrites par Gestion pour « Créer le dossier », « Mettre à jour le dossier » et les dossiers d'un apporteur (agent/whatsapp.js) :
// ce ne sont pas les mots de Nani.
const CONSIGNE_GENEREE = /^\s*(?:Crée le dossier de ce client|Mets à jour le dossier|Prépare les dossiers des clients que cet apporteur)/;

// Les mots de Nani dans un message : la question de « Demander à l'assistant », sinon son texte hors de l'échange joint, du résumé d'une
// discussion remplacée et des consignes générées. `modeWa` : « creer » ou « maj » : aucun mot d'elle.
export function motsDeNani(texte, { modeWa = "" } = {}) {
  const t = String(texte || "");
  const q = /<question>([\s\S]*?)<\/question>/.exec(t);
  if (q) return q[1].trim();
  if (modeWa === "creer" || modeWa === "maj" || CONSIGNE_GENEREE.test(t)) return "";
  return t.replace(BLOC_CONVERSATION, " ").replace(BLOC_RESUME, " ").trim();
}
// Nani a-t-elle écrit quelque chose dans le message en cours ou dans ses 2 messages précédents ?
export const naniAEcrit = ({ texte = "", precedents = [], modeWa = "" } = {}) => !!motsDeNani(texte, { modeWa }) || (precedents || []).slice(-2).some((p) => !!motsDeNani(p));

// Une demande de calcul, pour la ligne du contexte (jamais pour bloquer). « Résume l'itinéraire » n'en est pas une.
const DEMANDE = new RegExp(
  [
    "combien de temps",
    "(?:quelle|quel) (?:est la |sera la )?duree",
    "duree (?:du |de la )?(?:trajet|route|course)",
    "temps de (?:route|trajet)",
    "a quelle heure (?:partir|faut-il partir|il faut partir|doit-il partir|on part|le pickup|le pick-up|la prise en charge|passer|venir|le chercher|les chercher|la chercher)",
    "quelle heure (?:pour |de |du )?(?:le |la )?(?:pick-?up|prise en charge|depart)",
    "(?:re)?calcule(?:r|-moi| moi)?\\s+(?:l'|le |la |les )?(?:heure|horaire|pick-?up|prise en charge|itineraire|trajet|route|duree|course|planning)",
    "(?:estime|estimer|planifie|planifier|verifie|verifier)\\s+(?:l'|le |la |les )?(?:heure|horaire|pick-?up|prise en charge|itineraire|trajet|route|duree)",
    "(?:est-ce|c'est) (?:tenable|jouable|faisable)",
    "(?:on a|il a|ils ont|elle a) le temps",
    "how long",
    "how far",
    "how much time",
    "travel time",
    "driving time",
    "what time (?:should|do|must|to|will|for)",
    "when should (?:we|they|he|she) (?:leave|go|be picked)",
    // thaï : « กี่โมง » (à quelle heure), « ใช้เวลา » (combien de temps), « นานไหม » (c'est long ?)
    "กี่โมง",
    "ใช้เวลา",
    "นานไหม",
  ].join("|"),
  "u"
);
export const demandeItineraire = (texte, { modeWa = "" } = {}) => DEMANDE.test(plat(motsDeNani(texte, { modeWa })));

// ---- Pickup donné pour CE service ----------------------------------------------------------------------------------------------------
const HEURE = "(?:[01]?\\d|2[0-3])\\s*(?:[:h.]\\s*[0-5]\\d|h\\b|\\s?(?:am|pm)\\b)";
const PICKUP_DONNE = new RegExp(`(?:pick[\\s-]?up(?: time)?|prise en charge|ramassage|heure de depart|depart (?:de l'hotel|a l'hotel))[^\\n\\d]{0,25}${HEURE}`);
const MOIS = [
  ["jan", "janv", "january", "janvier"],
  ["feb", "fev", "february", "fevrier"],
  ["mar", "march", "mars"],
  ["apr", "avr", "april", "avril"],
  ["may", "mai"],
  ["jun", "june", "juin"],
  ["jul", "july", "juil", "juillet"],
  ["aug", "august", "aout"],
  ["sep", "sept", "september", "septembre"],
  ["oct", "october", "octobre"],
  ["nov", "november", "novembre"],
  ["dec", "december", "decembre"],
];
// Le segment parle-t-il de cette date (« 25 Nov », « Wed 25 Nov 2026 », « 25/11 », « 25.11 », « November 25 », « 2026-11-25 ») ?
export function parleDeLaDate(segment, iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return false;
  const p = plat(segment);
  const jour = String(Number(m[3]));
  const mois = Number(m[2]);
  const noms = MOIS[mois - 1].join("|");
  return (
    p.includes(iso) ||
    new RegExp(`(?<!\\d)0?${jour}(?:st|nd|rd|th|er)?\\s+(?:${noms})\\b`).test(p) ||
    new RegExp(`\\b(?:${noms})\\.?\\s+0?${jour}(?!\\d)`).test(p) ||
    new RegExp(`(?<!\\d)0?${jour}[./-]0?${mois}(?!\\d)`).test(p)
  );
}
const MOTS_VIDES = new Set(["hotel", "resort", "beach", "koh", "lanta", "krabi", "town", "airport", "pier", "the", "and", "from", "with", "villa", "bungalow", "bungalows", "house", "room"]);
const motsDuLieu = (t) => plat(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !MOTS_VIDES.has(w));
// Les segments d'un texte : chaque message d'un échange joint (« [Client …] … ») et chaque paragraphe du reste.
const segments = (textes) => (textes || []).flatMap((t) => String(t || "").split(/\n+/)).map((s) => s.trim()).filter(Boolean);
// Une heure de prise en charge est-elle déjà donnée pour ce service ? Seulement si un même segment donne une heure de pickup, parle de la date
// de la course et nomme son lieu de départ (deux de ses mots distinctifs quand il en a deux : « Sunny Test Bungalows » n'est pas « Test
// Lagoon Resort »). Dans le doute (date ou lieu inconnus, segment ambigu) : non.
export function pickupDonnePourService(textes = [], { date = "", lieu = "" } = {}) {
  const mots = motsDuLieu(lieu);
  if (!date || !mots.length) return false;
  const requis = Math.min(2, mots.length);
  return segments(textes).some((s) => {
    const p = plat(s);
    const mots_s = new Set(p.split(/[^a-z0-9]+/));
    return PICKUP_DONNE.test(p) && parleDeLaDate(s, date) && mots.filter((w) => mots_s.has(w)).length >= requis;
  });
}

// Le seul blocage dur. `entree` : celle de planifier_course ; `decision` : celle de l'échange (decisionItineraire).
export function bloquerRecalcul(nom, entree, decision) {
  if (nom !== "planifier_course" || !decision || decision.naniAEcrit) return false;
  const e = entree || {};
  // Une heure de départ fournie : le calcul part du pickup donné (arrivées), il ne le recalcule pas.
  if (String(e.heure_depart || "").trim()) return false;
  const premier = Array.isArray(e.points) && e.points[0] ? e.points[0].lieu : "";
  return pickupDonnePourService(decision.textes || [], { date: e.date, lieu: premier });
}

// La décision d'un échange. `texte` : le message de cet échange (avec l'échange WhatsApp joint s'il y en a un) ; `precedents` : les textes de
// la personne déjà gardés dans la discussion ; `modeWa` : « creer », « maj », « question » ou "".
export function decisionItineraire({ texte = "", precedents = [], modeWa = "" } = {}) {
  return {
    demande: demandeItineraire(texte, { modeWa }),
    naniAEcrit: naniAEcrit({ texte, precedents, modeWa }),
    creation: modeWa === "creer" || modeWa === "maj",
    // Les textes où chercher un pickup donné : ce message (échange compris) et les précédents de la discussion.
    textes: [texte, ...(precedents || [])],
  };
}

// Ce que rend planifier_course bloqué : rien n'est calculé, le modèle sait pourquoi et quoi faire.
export const REFUS_RECALCUL = {
  erreur: "pickup_deja_donne",
  conseil: "L'heure de prise en charge de ce service est déjà donnée dans la conversation : reprends-la telle quelle dans la carte, ne la recalcule pas. Si une autre course n'a pas d'heure, calcule seulement celle-là.",
};
// La ligne du contexte de l'échange (prompt.js, contexteDuJour).
export function ligneItineraire(decision) {
  if (!decision) return "";
  if (decision.demande) return "Calcul d'itinéraire : demandé par la personne dans ce message.";
  if (decision.creation) return "Calcul d'itinéraire : seulement pour une heure de prise en charge qui manque à une course. Une heure donnée pour un service se reprend telle quelle, sans calcul.";
  return "Calcul d'itinéraire : pas demandé dans ce message. Ne calcule ni route, ni pickup, sauf si la personne le demande (relance comprise, avec ses mots ou en thaï) ou si une heure de prise en charge manque pour créer une course.";
}
