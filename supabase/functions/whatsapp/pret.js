// Boîte WhatsApp, « Prêt à réserver » (migration 85, 22.11.2026). Logique pure, sans réseau et sans IA : la fonction « whatsapp »
// (pret.ts) et les tests (tests/gestion-whatsapp-pret.test.js) l'importent. L'écran lit le résultat gardé sur la conversation
// (whatsapp_conversations.pret_reserver) et décide seul s'il montre la conversation (src/gestion/js/whatsapp-pret-calc.mjs).
//
// Règle tirée des 48 conversations réelles lues le 22.11.2026 (tableau dans docs/gestion/whatsapp-pret-a-reserver.md) :
//   Une conversation est prête quand son signal le plus récent est l'un de ceux-ci, sans annulation après lui.
//   Client (message reçu), seulement après un prix donné par Nani :
//     - accord net : « yes I want to book », « we take it », « book it », « let's go », « please confirm the transfer », « send the taxi »,
//       « on prend », « je réserve »… ;
//     - « yes », « ok », « oui » en tête du message, seulement en réponse directe à une question de réservation de Nani (« would you like
//       to book », « shall I confirm », « if you want to book ») ;
//     - un nom et une heure (ou un hôtel) donnés après le prix.
//     Jamais avec un refus, une hésitation, une contre-proposition ou une question de prix dans le même message.
//   Nani (message envoyé) :
//     - « send you the confirmation », « je prépare la confirmation », « send you the voucher », « here is your confirmation »,
//       « attached confirmation », « secured your booking », « send you the taxi » ;
//     - un récapitulatif : trois champs ou plus parmi Name, Date, Pick-up, Drop-off, Passengers, Price.
//     Jamais une question (« shall I confirm the driver ? »), une demande d'avis Google, une demande transférée à un chauffeur
//     (« Transfer request: », « Customer: ») ni un rappel d'un service déjà réservé (« the driver is confirmed »).
//   Sort : une annulation du client après le signal (« cancel », « no longer need », « changed our plans »), ou une
//   annulation écrite par Nani (« I have cancelled »). Le dossier créé et le retrait par Nani se lisent à l'écran.
//   Exclu d'office ici : le Contact personnel (réponses « jamais ») seulement, dont rien n'est lu. Partenaire, chauffeur, hôtel, apporteur,
//   fiche partenaire reliée et tri « personnel », « partenaire » ou « publicite » sont écartés à l'écran (whatsapp-pret-calc.mjs), sur leur
//   valeur du moment : un contact remis en Client est repris tout de suite, sans attendre un nouveau message (relecture du 22.11.2026).

export const TYPES_EXCLUS = ["partenaire", "chauffeur", "hotel", "apporteur"];
export const MOTIFS_TRI_EXCLUS = ["personnel", "partenaire", "publicite", "contact_jamais"];
// Les messages relus pour décider (les plus récents) : une réservation se joue en quelques dizaines de messages.
export const MESSAGES_LUS = 60;
const CHAMP_MAX = 80;

// Texte comparable : minuscules, sans accents, apostrophes droites, espaces simples. Les bornes de mots sont faites à la main (\b ne marche
// pas après une lettre accentuée ni autour du thaï).
export function plat(t) {
  return String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
const L = "(?<![\\p{L}\\p{N}])";
const R = "(?![\\p{L}\\p{N}])";
const re = (corps) => new RegExp(`${L}(?:${corps})${R}`, "u");

// Un montant : chiffres avec une monnaie (« 2,300 THB », « 5'000 THB », « 500 baht », « ฿ 800 »), ou « price is 2400 ».
const MONNAIE = "(?:thb|bahts?|฿|eur|euros?|€|chf|usd|\\$)(?![\\p{L}])";
const MONTANT = new RegExp(`(?:฿\\s*\\d[\\d,.' ]*\\d|\\d(?:[\\d,.']*\\d)?\\s*${MONNAIE}|(?:price|prix|tarif)\\s+(?:is|est|de|:)\\s*\\d{3,}(?![\\d,.']*\\s*${MONNAIE}))`, "u");
const MONTANT_G = new RegExp(MONTANT.source, "gu");
export const contientPrix = (texte) => MONTANT.test(plat(texte));

// Nani demande si le client réserve.
const QUESTION_RESA = new RegExp(
  `${L}(?:would you like|woud you like|do you want|would you want|shall i|should i|can i|are you interested|still interested|souhaitez[- ]vous|voulez[- ]vous|vous souhaitez|veux[- ]tu|tu veux)${R}[^?]{0,60}${L}(?:book|reserv|confirm)|if you (?:want|would like) to book|let me know if you want|dites[- ]moi si (?:vous )?(?:souhaitez|voulez) reserver`,
  "u"
);
export const questionReservation = (texte) => QUESTION_RESA.test(plat(texte));

// Accord net du client (il suffit qu'un prix ait été donné avant).
const ACCORD = re(
  [
    "(?:we|i)(?:'ll| will)? take (?:it|this|that|the)",
    "(?:i|we)(?: really)? (?:want|would like|'d like|wanna|would love|'d love) to (?:book|reserve|confirm)",
    "book it",
    "please book",
    "go ahead",
    "let'?s (?:go|do it|book)",
    "(?:yes|ok|okay),? (?:please )?(?:book|confirm|reserve)",
    "please confirm (?:it|the (?:booking|transfer|driver|taxi|trip|tour|boat))",
    "(?:i|we) confirm",
    "(?:could|can) you send (?:us |me )?the (?:taxi|driver|car|van|minivan)",
    "send (?:us |me )?the (?:taxi|driver|car|van|minivan)",
    "je (?:le |la |vous le |vous la )?(?:reserve|prends|confirme)",
    "on (?:le |la |vous le |vous la )?(?:reserve|prend|confirme)",
    "c'est (?:bon|ok|d'accord) pour (?:nous|moi)",
    "ca marche",
    "d'accord pour",
    "ok pour (?:nous|moi|le|la|demain)",
    "on y va",
  ].join("|")
);
// « yes », « ok », « oui » en tête : seulement en réponse à une question de réservation.
const ACCORD_COURT = new RegExp(`^(?:yes|yep|yeah|yup|oui|si|ja|sure|ok|okay|okey|d'accord|parfait|perfect|great|absolutely|of course|bien sur|avec plaisir|alright|tres bien)${R}`, "u");
// Ce qui défait un accord dans le même message : refus, hésitation, contre-proposition, question de prix.
const NEGATIF = re(
  [
    "no",
    "non",
    "nope",
    "not",
    "don'?t",
    "pas besoin",
    "cancel(?!lation)\\w*",
    "annul\\w*",
    "cheaper",
    "discount",
    "lower",
    "reduce",
    "best price",
    "moins cher",
    "reduction",
    "remise",
    "(?:can|could) you do (?:it |that )?(?:for|at)",
    "think about",
    "let you know",
    "i'll see",
    "we'll see",
    "maybe",
    "perhaps",
    "peut[- ]etre",
    "reflechi\\w*",
    "on verra",
    "not sure",
    "pas sur",
    "how much",
    "combien",
    "what(?: is|'s) the (?:price|cost)",
    "quel (?:est le )?prix",
  ].join("|")
);
// Un nom, une heure, un lieu donnés après le prix.
const NOM = re("my name is|name ?:|nom ?:|je m'appelle");
const HEURE = /(?<![\p{N}])(?:[01]?\d|2[0-3])(?::|h|\.)[0-5]\d(?![\p{N}])|(?<![\p{N}])(?:1[0-2]|0?\d)\s?(?:am|pm)(?![\p{L}])/u;
const LIEU = re("hotel|resort|bungalows?|villa|guesthouse|hostel|staying at|pick ?up (?:at|from)|drop ?off");

// Nani confirme la réservation.
const CONFIRMATION = re(
  [
    "(?:i(?:'ll| will| am going to)?|let me|je(?: vais| vous| te| vous les?)?|on(?: vous)?|nous(?: vous)?)\\s+(?:prepare|send|sending|preparing|envoi|envoie|envoyer|envoyons|prepare|prepar\\w*)\\s+(?:you |vous |te )?(?:the |your |a |la |le |votre |ta |ton |les |vos )?(?:booking )?(?:confirmation|voucher|recap\\w*)",
    "(?:this is|here is|here's|voici|voila)\\s+(?:you |your |votre |ta |la |le )?(?:booking )?(?:confirmation|voucher|recap\\w*)",
    "(?:see|find) (?:the )?attached (?:confirmation|voucher)",
    "secured your (?:booking|reservation|seats?)",
    "(?:your )?(?:booking|reservation) is (?:confirmed|done|secured)",
    "(?:votre |ta )?reservation est (?:confirmee|faite|validee)",
    "c'est reserve",
    "i(?: have|'ve)? (?:booked|reserved) (?:it|you|your|the)",
    "j'ai (?:bien )?reserve",
    "i(?:'ll| will) send you the (?:taxi|driver|car|van|minivan)",
    "je vous envoie (?:le )?(?:taxi|chauffeur)",
  ].join("|")
);
// Pas un signal : demande d'avis, demande transférée à un chauffeur ou un bateau, rappel d'un service déjà réservé.
const PAS_CONFIRMATION = re("review|avis|g\\.page|transfer request ?:|customer ?:|client ?:");
const ANNULE_CLIENT = re("cancel(?!lation)\\w*|annul\\w*|no longer need|not need it|don'?t need (?:it|the|a)|changed (?:our|my) plans?|plus besoin|found another");
const ANNULE_NANI = re("i(?: have|'ve)? cancell?ed|is cancell?ed|has been cancell?ed|j'ai annule|est annulee?");

// Les champs d'un récapitulatif ou d'une demande du site, ligne par ligne (« Name: Lena »).
const CHAMPS = [
  ["nom", /^(?:name|nom|client name|customer name)$/],
  ["date", /^(?:date|jour|day)$/],
  ["heure", /^(?:pick-?up time|pickup time|time|heure|heure de prise en charge|landing)$/],
  ["depart", /^(?:pick-?up(?: location| point| place)?|pickup|from|depart|lieu de prise en charge)$/],
  ["arrivee", /^(?:drop-?off(?: location| point| place)?|dropoff|destination|to|arrivee)$/],
  ["personnes", /^(?:(?:number of )?passengers|guests|pax|persons|people|personnes|participants)$/],
  ["vol", /^(?:flight(?: or ferry)?|flight number|vol|numero de vol)$/],
  ["prix", /^(?:price|prix|total|total price|tarif)$/],
];
export function champsDe(texte) {
  const trouves = {};
  for (const ligne of String(texte || "").split(/\r?\n/)) {
    const m = ligne.match(/^\s*[-*•]?\s*([^:\n]{2,30}?)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const cle = plat(m[1]);
    const champ = CHAMPS.find(([, r]) => r.test(cle));
    if (champ && !(champ[0] in trouves)) trouves[champ[0]] = m[2];
  }
  return trouves;
}
const estDemandeTransferee = (texte) => /^\s*(?:transfer request|customer|client)\s*:/i.test(String(texte || ""));
// Une demande de client recopiée par Nani pour un chauffeur (« we would like to book… could you confirm availability? ») a les mêmes
// champs : elle pose une question, un récapitulatif n'en pose pas.
const DEMANDE_RECOPIEE = re("we would like|i would like|could you|can you|please let (?:us|me) know|availability|disponibilite");
export const estRecapitulatif = (texte) => !estDemandeTransferee(texte) && !DEMANDE_RECOPIEE.test(plat(texte)) && !/\?/.test(String(texte || "")) && Object.keys(champsDe(texte)).length >= 3;

// ---- Messages --------------------------------------------------------------------------------------------------------------------
const texteDe = (m) => [m.texte || "", ...((m.medias || []).map((x) => (x && x.legende) || ""))].join("\n").trim();
const vivants = (messages = []) =>
  messages
    .filter((m) => m && !m.supprime_le && m.type !== "reaction")
    .sort((a, b) => String(a.envoye_le).localeCompare(String(b.envoye_le)));

// La conversation est-elle lue ? Jamais un Contact personnel. Le type du contact et le tri sont jugés à l'écran, sur leur valeur du moment.
export function conversationPossible(conv) {
  return !!conv && conv.reponses !== "jamais";
}

// Le signal porté par un message, ou null. `avant` : les messages vivants qui le précèdent (du plus ancien au plus récent).
export function signalDuMessage(m, avant = []) {
  const brut = texteDe(m);
  const t = plat(brut);
  if (!t) return null;
  if (m.sens === "sortant") {
    if (PAS_CONFIRMATION.test(t) || questionReservation(t)) return null;
    if (CONFIRMATION.test(t)) return { source: "nani", motif: "confirmation" };
    if (estRecapitulatif(brut)) return { source: "nani", motif: "recapitulatif" };
    return null;
  }
  if (m.sens !== "entrant") return null;
  const sortants = avant.filter((x) => x.sens === "sortant" && texteDe(x));
  if (!sortants.some((x) => contientPrix(texteDe(x)))) return null;
  if (NEGATIF.test(t)) return null;
  if (ACCORD.test(t)) return { source: "client", motif: "accord" };
  const precedent = sortants.at(-1);
  if (ACCORD_COURT.test(t) && precedent && questionReservation(texteDe(precedent))) return { source: "client", motif: "accord" };
  if (!estDemandeTransferee(brut)) {
    const indices = [NOM.test(t), HEURE.test(t), LIEU.test(t)].filter(Boolean).length;
    if (indices >= 2 && (NOM.test(t) || questionReservation(texteDe(precedent || {})))) return { source: "client", motif: "details" };
  }
  return null;
}
const annulation = (m) => {
  const t = plat(texteDe(m));
  return !!t && (m.sens === "entrant" ? ANNULE_CLIENT.test(t) : ANNULE_NANI.test(t));
};

// Le dernier montant donné par Nani jusqu'au message `jusque` compris : le total (« = 10'000 THB », « in total ») s'il y en a un, sinon le
// premier montant du message (« 2000 THB per person + 400 THB for the national park » donne 2000 THB par personne).
export function prixDonne(messages = [], jusque = null) {
  const v = vivants(messages).filter((m) => m.sens === "sortant" && (!jusque || String(m.envoye_le) <= String(jusque)));
  for (let i = v.length - 1; i >= 0; i--) {
    const brut = texteDe(v[i]);
    const recap = champsDe(brut).prix;
    if (recap && contientPrix(recap)) return court(recap);
    const t = plat(brut);
    const tous = [...t.matchAll(MONTANT_G)];
    if (!tous.length) continue;
    // Un total : précédé de « = » ou « total » (« total = 6'000 THB »), ou suivi de « (in total) ».
    const total = tous.find((x) => /(?:=|total|soit)\s*:?\s*$/.test(t.slice(Math.max(0, x.index - 12), x.index)) || /^\s*\(?(?:in )?total/.test(t.slice(x.index + x[0].length)));
    const choisi = total || tous[0];
    const parPersonne = /^\s*(?:per person|pp|par personne|\/ ?person)/.test(t.slice(choisi.index + choisi[0].length));
    return court(`${choisi[0].trim().toUpperCase().replace(/BAHTS?/, "THB")}${parPersonne ? " / pers." : ""}`);
  }
  return null;
}
const court = (s) => {
  const x = String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return x.length > CHAMP_MAX ? `${x.slice(0, CHAMP_MAX - 1)}…` : x;
};
// Jamais de numéro de téléphone ni de compte dans la carte.
const sansNumero = (s) => court(String(s || "").replace(/\+?\d[\d\s().-]{7,}\d/g, "…"));

// La carte pré-remplie : le dernier récapitulatif de Nani, sinon la dernière demande du site ou du client avec des champs, puis le prix
// donné par Nani. Seulement ce qui est écrit, rien de déduit. Jamais le numéro WhatsApp (« WhatsApp: +44… ») ni un champ inconnu.
export function carteDe(messages = [], jusque = null) {
  const v = vivants(messages).filter((m) => !jusque || String(m.envoye_le) <= String(jusque));
  const recap = [...v].reverse().find((m) => m.sens === "sortant" && estRecapitulatif(texteDe(m)));
  const demande = [...v].reverse().find((m) => m.sens === "entrant" && Object.keys(champsDe(texteDe(m))).length >= 2);
  const carte = {};
  for (const source of [recap, demande]) {
    if (!source) continue;
    const champs = champsDe(texteDe(source));
    for (const [cle, val] of Object.entries(champs)) {
      // Le prix d'une demande du site est celui affiché sur le site (« From 2,300 THB »), pas celui donné par Nani.
      if (cle === "prix" && source !== recap) continue;
      if (!(cle in carte) && val) carte[cle] = sansNumero(val);
    }
  }
  if (!carte.prix) {
    const p = prixDonne(v);
    if (p) carte.prix = p;
  }
  return carte;
}

// La décision gardée sur la conversation (colonne pret_reserver) : courte, sans texte de message.
//   { pret: true, le, depuis, message_id, source, motif, carte, calcule_le } ou { pret: false, motif, calcule_le }.
export function etatPret(conv, messages = [], maintenant = new Date().toISOString()) {
  if (!conversationPossible(conv)) return { pret: false, motif: "exclue", calcule_le: maintenant };
  const v = vivants(messages).slice(-MESSAGES_LUS);
  let signal = null;
  for (let i = v.length - 1; i >= 0 && !signal; i--) {
    const s = signalDuMessage(v[i], v.slice(0, i));
    if (s) signal = { ...s, message: v[i], index: i };
  }
  if (!signal) return { pret: false, motif: "aucun", calcule_le: maintenant };
  if (v.slice(signal.index + 1).some(annulation)) return { pret: false, motif: "annule", calcule_le: maintenant };
  // `depuis` : le prix donné par Nani avant le signal. Un dossier du client créé depuis ce moment est celui de cette réservation (Nani crée
  // souvent le dossier avant d'envoyer la confirmation : deux minutes avant, dans la conversation réelle C36).
  const prix = v.slice(0, signal.index).filter((m) => m.sens === "sortant" && contientPrix(texteDe(m))).at(-1);
  return {
    pret: true,
    le: signal.message.envoye_le,
    depuis: prix ? prix.envoye_le : signal.message.envoye_le,
    message_id: signal.message.id || null,
    source: signal.source,
    motif: signal.motif,
    carte: carteDe(v),
    calcule_le: maintenant,
  };
}

// À écrire ? Seulement si la décision change (pas d'écriture à chaque message pour rien). `calcule_le` ne compte pas.
export function pretChange(avant, apres) {
  const sans = (x) => {
    if (!x || typeof x !== "object") return null;
    const { calcule_le: _c, ...reste } = x;
    return JSON.stringify(reste);
  };
  return !avant || sans(avant) !== sans(apres);
}
