// « Coller une confirmation » (Jérémy, 18.11.2026) : la confirmation de course que Jérémy écrit sur WhatsApp devient un dossier et sa
// Booking confirmation, en un collage. Logique pure, sans DOM, testée dans tests/gestion-coller-confirmation.test.js. Format type :
//
//   📢 New booking confirmation:
//   VIP TAXI LANTA
//   Name:  Enzo
//   Date: November 22nd 2026
//   Pick-up time: 4:30pm
//   Pick-up location: Manao villa no 24
//   Drop-off location: Rock bar restaurant (and round trip)
//   Number of passengers: 5 people no luggage
//   Price: 1000 THB
//   Remark: 50th birthday, they want to put music in the minivan on the way
//
// Libellés en anglais dans n'importe quel ordre, espaces et emoji en trop. Le résultat a la forme des valeurs de l'écran de Mook
// (voucher-rapide-calc.mjs, valeursVides) : la même création et le même contrôle (erreursVoucher) servent ensuite.
import { valeursVides, prixSaisi, erreursVoucher } from "./voucher-rapide-calc.mjs";
import { RETOUR_DEPART } from "./trajet-calc.mjs";

const MOIS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, janv: 1, fev: 2, fevr: 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, aout: 8, déc: 12 };
const sansAccents = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
// Emoji et pictogrammes (📢, ✨, 🚐…) et caractères invisibles : retirés avant toute lecture.
const sansEmoji = (s) => String(s || "").replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}‍️⃣]/gu, "");
const propre = (s) => sansEmoji(s).replace(/\s+/g, " ").trim();
const pad = (n) => String(n).padStart(2, "0");
const dateValide = (a, m, j) => {
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
};

// Libellé (sans accents, en minuscules, lettres seulement) -> champ. Un libellé inconnu laisse la ligne de côté (montrée à l'écran).
const LIBELLES = [
  [/^(name|client|customer|guest|guest ?name|client ?name|customer ?name|nom)$/, "nom"],
  [/^(date|day|pick ?up ?date|service ?date)$/, "date"],
  [/^(pick ?up ?time|time|hour|heure|pick ?up ?hour)$/, "heure"],
  [/^(pick ?up ?location|pick ?up|pick ?up ?place|pick ?up ?point|from|pick ?up ?address|lieu ?de ?prise ?en ?charge)$/, "pickup"],
  [/^(drop ?off ?location|drop ?off|drop ?off ?place|drop|to|destination|drop ?off ?point)$/, "dropoff"],
  [/^(number ?of ?passengers|passengers?|pax|people|persons|guests|number ?of ?people|nb ?of ?passengers)$/, "passagers"],
  [/^(luggage|luggages|bags?|baggage|suitcases?)$/, "bagages"],
  [/^(price|total ?price|total|amount|fare|prix)$/, "prix"],
  [/^(remarks?|notes?|comments?|special ?requests?|request|remarque)$/, "remarques"],
  [/^(flight|flight ?number|flight ?no|boat|ferry)$/, "vol"],
  [/^(phone|whats ?app|tel|telephone|mobile|contact|phone ?number)$/, "telephone"],
  [/^(child ?seats?|car ?seats?|baby ?seats?)$/, "sieges"],
  [/^(duration|hours)$/, "duree"],
  [/^(program|programme|plan|itinerary)$/, "programme"],
];
const champDuLibelle = (libelle) => {
  const l = sansAccents(propre(libelle)).toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  const trouve = LIBELLES.find(([re]) => re.test(l));
  return trouve ? trouve[1] : null;
};

// « November 22nd 2026 », « Nov 22, 2026 », « 22 November », « Sunday 22nd of November », « 22/11 », « 22.11.2026 », « 2026-11-22 ».
// Sans année : l'année d'aujourd'hui, ou la suivante si la date est déjà passée de plus d'un mois (une course de janvier collée en décembre).
// Les dates en chiffres sont lues jour puis mois (Thaïlande et Europe). Renvoie AAAA-MM-JJ, ou "" si rien ne se lit.
export function lireDate(texte, aujourdhui = "") {
  const t = sansAccents(propre(texte)).toLowerCase().replace(/(\d)(st|nd|rd|th|er)\b/g, "$1").replace(/\bof\b/g, " ").replace(/,/g, " ");
  const ajd = /^\d{4}-\d{2}-\d{2}$/.test(aujourdhui) ? aujourdhui : new Date().toISOString().slice(0, 10);
  const annee = (a, m, j) => {
    if (a) return a < 100 ? 2000 + a : a;
    const y = Number(ajd.slice(0, 4));
    const iso = `${y}-${pad(m)}-${pad(j)}`;
    const limite = new Date(Date.parse(`${ajd}T00:00:00Z`) - 31 * 86400000).toISOString().slice(0, 10);
    return iso < limite ? y + 1 : y;
  };
  const fini = (a, m, j) => {
    const y = annee(a, m, j);
    return dateValide(y, m, j) ? `${y}-${pad(m)}-${pad(j)}` : "";
  };
  let m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(t);
  if (m) return fini(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/.exec(t);
  if (m) return fini(m[3] ? Number(m[3]) : 0, Number(m[2]), Number(m[1]));
  const mois = (mot) => {
    const k = Object.keys(MOIS).find((x) => mot.startsWith(x));
    return k ? MOIS[k] : 0;
  };
  // Mois en lettres, avant ou après le jour.
  m = /\b([a-z]{3,})\.?\s+(\d{1,2})(?:\s+(\d{4}))?\b/.exec(t);
  if (m && mois(m[1])) return fini(m[3] ? Number(m[3]) : 0, mois(m[1]), Number(m[2]));
  m = /\b(\d{1,2})\s+([a-z]{3,})\.?(?:\s+(\d{4}))?\b/.exec(t);
  if (m && mois(m[2])) return fini(m[3] ? Number(m[3]) : 0, mois(m[2]), Number(m[1]));
  return "";
}

// « 4:30pm », « 4.30 pm », « 4pm », « 16:30 », « 16h30 », « 9am », « 12 noon » -> « HH:MM » ; "" si rien ne se lit.
export function lireHeure(texte) {
  const t = propre(texte).toLowerCase().replace(/\s+/g, " ");
  if (/\bnoon\b|\bmidday\b/.test(t) && !/\d/.test(t)) return "12:00";
  let m = /\b(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/.exec(t);
  if (m) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h < 1 || h > 12 || min > 59) return "";
    const pm = m[3].startsWith("p");
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
    return `${pad(h)}:${pad(min)}`;
  }
  m = /\b(\d{1,2})[:.h](\d{2})\b/.exec(t);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return `${pad(Number(m[1]))}:${m[2]}`;
  return "";
}

const NOMBRES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1 };
const nombre = (s) => (/^\d+$/.test(s) ? Number(s) : NOMBRES[s] ?? null);
const N = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)";

// « 5 people no luggage », « 2 adults + 1 kid + luggage », « 3 pax, 2 bags », « 2 adults, 1 child (1 child seat) », « 4 people with luggage ».
// Les bébés comptent avec les enfants. Renvoie { adultes, enfants, bagages, sieges } en texte, "" quand ce n'est pas dit.
export function lirePassagers(texte) {
  const t = propre(texte).toLowerCase();
  const somme = (re) => {
    let n = 0;
    let vu = false;
    for (const m of t.matchAll(re)) {
      const v = nombre(m[1]);
      if (v !== null) (n += v), (vu = true);
    }
    return vu ? n : null;
  };
  const sieges = somme(new RegExp(`\\b${N}\\s*(?:child|car|baby|booster)\\s*seats?\\b`, "g"));
  // Les sièges retirés, pour que « 1 child seat » ne compte pas un enfant de plus.
  const sansSieges = t.replace(new RegExp(`\\b${N}\\s*(?:child|car|baby|booster)\\s*seats?\\b`, "g"), " ");
  const compte = (re) => {
    let n = 0;
    let vu = false;
    for (const m of sansSieges.matchAll(re)) {
      const v = nombre(m[1]);
      if (v !== null) (n += v), (vu = true);
    }
    return vu ? n : null;
  };
  const enfants = compte(new RegExp(`\\b${N}\\s*(?:kids?|child(?:ren)?|enfants?|babies|baby|infants?|toddlers?)\\b`, "g"));
  let adultes = compte(new RegExp(`\\b${N}\\s*(?:adults?|adultes?|grown-?ups?)\\b`, "g"));
  const gens = compte(new RegExp(`\\b${N}\\s*(?:people|persons?|pax|passengers?|guests?|personnes?|ppl)\\b`, "g"));
  if (adultes === null && gens !== null) adultes = Math.max(0, gens - (enfants || 0));
  // Un nombre seul (« Number of passengers: 4 ») : des adultes.
  if (adultes === null && enfants === null) {
    const seul = /^\s*(\d+)\s*$/.exec(sansSieges);
    if (seul) adultes = Number(seul[1]);
  }
  let bagages = "";
  if (/\b(no|without|zero|0)\s*(luggages?|bags?|baggages?|suitcases?)\b/.test(sansSieges)) bagages = "";
  else {
    const n = compte(new RegExp(`\\b${N}\\s*(?:pieces?\\s*of\\s*)?(?:luggages?|bags?|baggages?|suitcases?|pieces?)\\b`, "g"));
    if (n !== null) bagages = n ? String(n) : "";
    else if (/\b(luggages?|bags?|baggages?|suitcases?)\b/.test(sansSieges)) bagages = "yes";
  }
  return { adultes: adultes === null ? "" : String(adultes), enfants: enfants ? String(enfants) : "", bagages, sieges: sieges ? String(sieges) : "" };
}

// « Rock bar restaurant (and round trip) », « Old Town, round trip », « round trip » : le retour au point de départ (PR 202), avec ce qui reste
// comme programme. Renvoie { retour, reste }.
const ROUND_TRIP = /\(?\s*(?:and|&|\+|,|-)?\s*(?:a\s+)?(?:round[\s-]*trip|return\s+trip|aller[\s-]*retour)\s*\)?/i;
export function lireAllerRetour(texte) {
  const t = propre(texte);
  if (!ROUND_TRIP.test(t)) return { retour: false, reste: t };
  const reste = t.replace(ROUND_TRIP, " ").replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").replace(/^[\s,;:&+-]+|[\s,;:&+(-]+$/g, "").replace(/\s+(and|&)$/i, "").trim();
  return { retour: true, reste };
}

// La ligne de marque : « VIP TAXI LANTA » -> « taxi », « SECRET TRAVEL & TOUR » -> « secret » ; null si aucune ligne ne la dit.
export function lireMarque(ligne) {
  const t = sansAccents(propre(ligne)).toLowerCase();
  if (/\bsecret\b|travel\s*(?:&|and)\s*tours?/.test(t)) return "secret";
  if (/\bvip\b.*\btaxi\b|\btaxi\s+lanta\b|\bvip\s+taxi\b/.test(t)) return "taxi";
  return null;
}

// Lecture du texte collé. `aujourdhui` : AAAA-MM-JJ (année d'une date qui n'en a pas).
// Renvoie { marque, valeurs, lus, ignorees } : `valeurs` a la forme de l'écran de Mook, plus `remarques` ; `lus` : les champs trouvés ;
// `ignorees` : les lignes qui n'ont rien donné (montrées à l'écran, pour que rien ne se perde sans le dire).
export function lireConfirmation(texte, { aujourdhui = "" } = {}) {
  const valeurs = { ...valeursVides(), adultes: "", remarques: "" };
  const lus = new Set();
  const ignorees = [];
  let marque = null;
  let dernier = null;
  let retourVu = false;
  const lignes = String(texte || "").replace(/\r/g, "").split("\n").map(propre).filter(Boolean);
  for (const ligne of lignes) {
    const m = /^([^:：]{1,40})[:：]\s*(.*)$/.exec(ligne);
    const champ = m ? champDuLibelle(m[1]) : null;
    if (!champ) {
      // Ligne sans libellé connu : la marque, l'en-tête « New booking confirmation », « Round trip », ou la suite d'une remarque.
      const mq = lireMarque(ligne);
      if (mq && !marque) {
        marque = mq;
        dernier = null;
        continue;
      }
      if (/booking\s+confirm|new\s+booking/i.test(ligne)) continue;
      if (!m && lireAllerRetour(ligne).retour && !lireAllerRetour(ligne).reste) {
        retourVu = true;
        continue;
      }
      if (dernier === "remarques") {
        valeurs.remarques = `${valeurs.remarques} ${ligne}`.trim();
        continue;
      }
      ignorees.push(ligne);
      dernier = null;
      continue;
    }
    const v = m[2].trim();
    dernier = champ;
    if (!v) continue;
    lus.add(champ);
    if (champ === "date") valeurs.date = lireDate(v, aujourdhui) || v;
    else if (champ === "heure") valeurs.heure = lireHeure(v) || v;
    else if (champ === "passagers") {
      const p = lirePassagers(v);
      valeurs.adultes = p.adultes;
      valeurs.enfants = p.enfants;
      if (p.bagages || !lus.has("bagages")) valeurs.bagages = p.bagages;
      if (p.sieges) valeurs.sieges = p.sieges;
    } else if (champ === "bagages") {
      const p = lirePassagers(/\d/.test(v) && !/(luggage|bag|suitcase|piece)/i.test(v) ? `${v} luggage` : v);
      valeurs.bagages = p.bagages || (/^(yes|y|oui)$/i.test(v) ? "yes" : "");
    } else if (champ === "sieges") valeurs.sieges = (/\d+/.exec(v) || [""])[0];
    else if (champ === "prix") {
      const n = prixSaisi(v.replace(/[^\d.,'’\s]/g, " ").trim().split(/\s+/)[0] || "");
      valeurs.prix = n === null ? v : String(n);
    } else if (champ === "dropoff") {
      const r = lireAllerRetour(v);
      if (r.retour) {
        retourVu = true;
        valeurs.programme = r.reste;
      } else valeurs.dropoff = v;
    } else if (champ === "pickup") valeurs.pickup = lireAllerRetour(v).retour ? ((retourVu = true), lireAllerRetour(v).reste) : v;
    else valeurs[champ] = v;
  }
  if (retourVu) {
    valeurs.trajet = RETOUR_DEPART;
    // Un drop-off lu à part (« Round trip » sur sa propre ligne) devient le programme.
    if (!valeurs.programme && valeurs.dropoff) valeurs.programme = valeurs.dropoff;
    valeurs.dropoff = "";
  }
  return { marque, valeurs, lus: [...lus], ignorees };
}

// Contrôle avant création, avec ce que l'écran doit dire : les erreurs de l'écran de Mook (champ vide, date, heure, prix…), plus l'adulte
// manquant quand le texte n'a pas dit combien de passagers il y avait (rien n'est deviné).
export function erreursConfirmation(valeurs) {
  const e = erreursVoucher({ ...valeurs, adultes: valeurs.adultes === "" ? "0" : valeurs.adultes });
  if (String(valeurs.adultes || "").trim() === "") e.adultes = "e_passagers";
  return e;
}

// Les entreprises où la confirmation peut être créée : Taxi (mode taxi) et Secret (mode excursions), où la personne crée clients, dossiers et
// documents. `marque` (« taxi » ou « secret ») désigne la sienne : par son nom (« Secret Travel & Tour »), sinon par sa façon de travailler.
// Par défaut, Taxi. Renvoie { liste, choisie, introuvable }.
export const DROITS_CONFIRMATION = ["clients.ecrire", "dossiers.ecrire", "documents.ecrire"];
export function entreprisesConfirmation({ entites = [], reglages = () => null, permissions = () => [], marque = null }) {
  const liste = entites
    .filter((e) => e.actif !== false)
    .map((e) => ({ id: e.id, nom: e.nom, mode: ((reglages(e.id) || {}).fonctionnement === "taxi" ? "taxi" : (reglages(e.id) || {}).fonctionnement === "excursions" ? "secret" : null) }))
    .filter((e) => e.mode && DROITS_CONFIRMATION.every((d) => (permissions(e.id) || []).includes(d)));
  const parNom = (re) => liste.find((e) => re.test(sansAccents(e.nom).toLowerCase()));
  const deMode = (mode) => liste.filter((e) => e.mode === mode);
  const pour = (mode) => (mode === "secret" ? parNom(/secret/) || deMode("secret")[0] : parNom(/taxi/) || deMode("taxi")[0]) || null;
  // Une marque lue mais sans entreprise à elle (Secret sans accès) : rien n'est choisi d'office, l'écran demande.
  const choisie = pour(marque || "taxi") || (marque ? null : liste[0] || null);
  return { liste, choisie, introuvable: !!marque && !choisie };
}

// Client déjà connu dans l'entreprise de la confirmation : même WhatsApp (les 8 derniers chiffres, l'indicatif peut manquer), sinon même nom
// (sans accents ni casse). Le plus récent d'abord. Un seul est proposé : l'écran laisse choisir « Nouveau client ».
const cleNom = (s) => sansAccents(s).toLowerCase().replace(/\s+/g, " ").trim();
export function clientExistant({ nom = "", telephone = "", clients = [] }) {
  const recents = [...clients].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const tel = String(telephone || "").replace(/\D/g, "");
  if (tel.length >= 8) {
    const parTel = recents.find((c) => String(c.telephone || "").replace(/\D/g, "").slice(-8) === tel.slice(-8));
    if (parTel) return parTel;
  }
  const n = cleNom(nom);
  return n.length >= 2 ? recents.find((c) => cleNom([c.prenom, c.nom].filter(Boolean).join(" ")) === n) || null : null;
}
