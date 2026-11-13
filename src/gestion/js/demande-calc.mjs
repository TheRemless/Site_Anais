// Demande d'un client reçue par WhatsApp : lecture du message que rédigent les formulaires des sites Secret et Taxi, propositions de prix
// d'après la base partenaires, et réponse prête à envoyer. Logique pure, testée avec node --test.
// Rien n'est inventé : un prix vient d'une ligne de la base, et sans correspondance on propose seulement de chercher à la main.
import { sansAccents, trajetDisponible, libelleUnite, libelleClient, personnesSupplementaires, prefixeProgramme } from "./partenaires-calc.mjs";
import { dateTexte, personnesTexte, notePasseport } from "./operations-calc.mjs";

const MOIS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (a, m, j) => `${a}-${String(m).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
const jourPlus = (isoDate, n) => new Date(Date.UTC(+isoDate.slice(0, 4), +isoDate.slice(5, 7) - 1, +isoDate.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);

// « Fri 12 Dec 2026 », « Tomorrow (Fri 12 Dec) », « Today (Mon 9 Nov) » : la date ISO, l'année manquante étant la prochaine occurrence.
export function lireDate(texte, aujourdhui) {
  const m = /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(20\d\d))?/i.exec(String(texte || ""));
  if (!m) return "";
  const mois = MOIS.indexOf(m[2].toLowerCase()) + 1;
  const jour = Number(m[1]);
  let annee = m[3] ? Number(m[3]) : Number(aujourdhui.slice(0, 4));
  let resultat = iso(annee, mois, jour);
  if (!m[3] && resultat < jourPlus(aujourdhui, -7)) resultat = iso(++annee, mois, jour);
  const d = new Date(`${resultat}T00:00:00Z`);
  return d.getUTCMonth() + 1 === mois && d.getUTCDate() === jour ? resultat : "";
}

const entier = (v) => (Number(v) > 0 ? Math.floor(Number(v)) : 0);

// ---- Messages du site actuel (secrettravelandtour.com, src/js/booking.js) ---------------------------------------------------------
// La première ligne dit ce qui est demandé : « Booking request: », « Transfer request: », « Shared minivan request (marque): », « Rental request: »,
// « Speedboat request: » ou « Trip list: ». Les lignes suivantes sont « Clé: valeur ». Les messages réels du site sont en fixtures
// (tests/fixtures/messages-site.json, fabriquées par docs/gestion/regenerer-messages-site.mjs) : un test casse si le site change.
const ENTETES_SITE = [
  [/^booking request:\s*(.+)$/i, "tour"],
  [/^transfer request:\s*(.+)$/i, "transfert"],
  [/^shared minivan request\s*\((.+?)\):\s*(.+)$/i, "partage"],
  [/^rental request:\s*(.+)$/i, "location"],
  [/^speedboat request:\s*(.+)$/i, "speedboat"],
  [/^trip list:\s*(\d+)/i, "liste"],
];
// Le site sépare la route et l'option par un tiret long (–) : un tiret court entre espaces fait partie d'un nom de lieu.
const SEP = /\s+[–—]\s+/;
const heureDe = (v) => {
  const m = /(\d{1,2}):(\d{2})/.exec(v || "");
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
};
const BOUT_SANS_HOTEL = /\b(?:airport|pier|ferry|bus|terminal|KBV|HKT|port)\b/i;

// « 2 adults, 1 child (age 7) », « 2 adults, 3 children (ages under 1, 3 and 10) » : adultes, enfants (3 ans et plus), bébés (moins de 3 ans) et âges.
function lireInvites(v) {
  const adultes = Number((/(\d+)\s+adults?/i.exec(v) || [])[1] || 0);
  const m = /(\d+)\s+child(?:ren)?(?:\s*\(ages?\s*([^)]*)\))?/i.exec(v);
  let ages = [];
  if (m && m[2]) ages = m[2].split(/,|\band\b/).map((x) => x.trim()).filter(Boolean).map((x) => (/under\s*1/i.test(x) ? 0 : parseInt(x, 10))).filter((n) => Number.isFinite(n));
  const enfants = ages.length ? ages.filter((a) => a >= 3).length : m ? Number(m[1]) : 0;
  return { adultes, enfants, bebes: ages.filter((a) => a < 3).length, ages };
}

function trajetDe(texte) {
  const m = /^(.+?) to (.+)$/.exec(texte.trim());
  return m ? { de: m[1].trim(), vers: m[2].trim() } : { de: "", vers: texte.trim() };
}

function lireSite(lignes, aujourdhui) {
  let genre = "";
  let m = null;
  for (const [re, g] of ENTETES_SITE) if ((m = re.exec(lignes[0]))) { genre = g; break; }
  if (!genre) return null;
  const d = { site: true, marque: "", type: "", nom: "", prestation: "", option: "", de: "", vers: "", date: "", dateTexte: "", heure: "", adultes: 0, enfants: 0, bebes: 0, ages: [], vehicule: "", mode: "", siegeEnfant: false, siegeBebe: false, sieges: 0, hotel: "", pickup: "", dropoff: "", vol: "", bagages: 0, extras: "", depart: "", billet: "", retour: "", saison: "", vehiculeNom: "", vehicules: 0, jusqua: "", prixSite: "", sorties: [] };
  const optionVers = (txt) => {
    if (/join/i.test(txt)) d.mode = "join";
    else if (/private/i.test(txt)) d.mode = "private";
    else if (/shared/i.test(txt)) d.mode = "shared";
    if (/speed\s*boat/i.test(txt)) d.vehicule = "speedboat";
    else if (/van|taxi|car\b/i.test(txt)) d.vehicule = "minivan";
  };
  if (genre === "tour") {
    d.type = "tour";
    const [produit, ...option] = m[1].split(SEP);
    d.prestation = produit.trim();
    d.option = option.join(" – ").trim();
    optionVers(d.option);
  } else if (genre === "transfert" || genre === "partage" || genre === "speedboat") {
    d.type = "transfer";
    let route = genre === "partage" ? m[2] : m[1];
    if (genre === "partage") {
      d.marque = m[1].trim();
      d.mode = "shared";
      d.vehicule = "minivan";
    } else if (genre === "speedboat") d.vehicule = "speedboat";
    const sep = SEP.exec(route);
    const paren = /^(.*?)\s*\((.+)\)$/.exec(route);
    if (sep) {
      d.option = route.slice(sep.index + sep[0].length).trim();
      route = route.slice(0, sep.index);
    } else if (paren) {
      route = paren[1];
      d.option = paren[2].trim();
    }
    if (d.option) optionVers(d.option);
    Object.assign(d, trajetDe(route));
  } else if (genre === "location") {
    d.type = "location";
    d.prestation = m[1].trim();
  } else if (genre === "liste") d.type = "tour";

  // Lignes « Clé: valeur ». Dans une liste de sorties, chaque sortie a sa date, son titre et ses lignes : la première est la demande, les autres vont dans les notes.
  const sorties = [];
  let sortie = null;
  for (const l of lignes.slice(1)) {
    if (genre === "liste") {
      const jour = /^(?:[A-Za-z]{3} \d{1,2} [A-Za-z]{3} \d{4}|Date to choose)$/.exec(l);
      if (jour) { sortie = { date: /^Date/.test(l) ? "" : lireDate(l, aujourdhui), texte: l, titre: "" }; sorties.push(sortie); continue; }
      if (sortie && !sortie.titre && !/^[A-Za-z ,]+:\s/.test(l)) { sortie.titre = l; continue; }
    }
    const k = /^([^:]+):\s*(.*)$/.exec(l);
    if (!k) continue;
    const cle = k[1].trim().toLowerCase();
    const v = k[2].trim();
    if (cle === "date") { d.dateTexte = v; d.date = lireDate(v, aujourdhui); }
    else if (cle === "pickup time" || cle === "preferred pickup time") d.heure = heureDe(v) || d.heure;
    else if (cle === "flight or ferry") d.vol = v;
    else if (cle === "guests") Object.assign(d, lireInvites(v));
    else if (cle === "child seats") { d.siegeEnfant = Number(v) > 0 || d.siegeEnfant; d.sieges = Number(v) || 0; }
    else if (cle === "bags") d.bagages = Number(v) || 0;
    else if (cle === "pickup") { d.pickup = v; if (genre === "tour" || genre === "liste") d.hotel = v; }
    else if (cle === "drop-off") d.dropoff = v;
    else if (cle === "hotel on koh lanta") d.hotel = v;
    else if (cle === "name") d.nom = v;
    else if (cle === "extras") d.extras = v;
    else if (cle === "departure") { d.depart = v; if (genre === "speedboat") d.heure = heureDe(v) || d.heure; }
    else if (cle === "ticket") d.billet = /^return/i.test(v) ? "return" : "one way";
    else if (cle === "return") d.retour = v;
    else if (cle === "season") d.saison = v;
    else if (cle === "vehicle") d.vehiculeNom = v;
    else if (cle === "vehicles") d.vehicules = Number(v) || 0;
    else if (cle === "from" && genre === "location") { d.dateTexte = v; d.date = lireDate(v, aujourdhui); d.heure = heureDe(v) || d.heure; }
    else if (cle === "to" && genre === "location") d.jusqua = lireDate(v, aujourdhui);
    else if (cle.startsWith("estimated total")) d.prixSite = v;
    else if ((cle === "price on the site" || cle === "price") && !d.prixSite) d.prixSite = v;
  }
  if (genre === "liste" && sorties.length) {
    const [premiere, ...autres] = sorties;
    const [produit, ...option] = (premiere.titre || "").split(SEP);
    d.prestation = (produit || "").trim();
    d.option = option.join(" – ").trim();
    optionVers(d.option);
    d.date = premiere.date;
    d.dateTexte = premiere.texte;
    d.sorties = autres.map((x) => `${x.texte}: ${x.titre}`.trim());
  }
  // L'hôtel d'un trajet est le bout qui n'est pas un aéroport ou un embarcadère.
  if (!d.hotel && genre !== "tour" && genre !== "liste") {
    const bouts = [d.pickup, d.dropoff].filter(Boolean);
    const hotels = bouts.filter((b) => !BOUT_SANS_HOTEL.test(b));
    if (hotels.length === 1) d.hotel = hotels[0];
  }
  return d;
}

// Lit le message d'un formulaire. Renvoie null si le texte ne ressemble à aucune demande.
export function lireDemande(texte, aujourdhui) {
  const lignes = String(texte || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lignes.length) return null;
  const site = lireSite(lignes, aujourdhui);
  if (site) return site;
  const d = { marque: "", type: "", nom: "", prestation: "", de: "", vers: "", date: "", dateTexte: "", heure: "", adultes: 0, enfants: 0, bebes: 0, vehicule: "", mode: "", siegeEnfant: false, siegeBebe: false, hotel: "" };
  for (const l of lignes) {
    let m;
    if ((m = /^hi\s+(.+?)\s*!?$/i.exec(l))) d.marque = m[1].replace(/!$/, "").trim();
    else if (/price for a transfer/i.test(l)) d.type = "transfer";
    else if ((m = /boat tour:\s*(.+?)\.?$/i.exec(l))) (d.type = "boat"), (d.prestation = m[1].trim());
    else if ((m = /an activity:\s*(.+?)\.?$/i.exec(l))) (d.type = "activity"), (d.prestation = m[1].trim());
    else if ((m = /^name:\s*(.*)$/i.exec(l))) d.nom = m[1].trim();
    else if ((m = /^from:\s*(.*)$/i.exec(l))) d.de = m[1].trim();
    else if ((m = /^to:\s*(.*)$/i.exec(l))) d.vers = m[1].trim();
    else if ((m = /^date:\s*(.*)$/i.exec(l))) (d.dateTexte = m[1].trim()), (d.date = lireDate(m[1], aujourdhui));
    else if ((m = /^pickup time:\s*(.*)$/i.exec(l))) d.heure = m[1].trim();
    else if ((m = /^adults:\s*(\d+)/i.exec(l))) d.adultes = entier(m[1]);
    else if ((m = /^children[^:]*:\s*(\d+)/i.exec(l))) d.enfants = entier(m[1]);
    else if ((m = /^babies[^:]*:\s*(\d+)/i.exec(l))) d.bebes = entier(m[1]);
    else if ((m = /^people:\s*(\d+)/i.exec(l))) d.adultes = entier(m[1]);
    else if ((m = /^hotel[^:]*:\s*(.*)$/i.exec(l))) d.hotel = m[1].trim();
    else if (/child seat needed/i.test(l)) d.siegeEnfant = true;
    else if (/baby seat needed/i.test(l)) d.siegeBebe = true;
    else if (/join-in/i.test(l)) d.mode = "join";
    else if (/^(shared|private)\b/i.test(l)) {
      d.mode = /^shared/i.test(l) ? "shared" : "private";
      d.vehicule = /speedboat/i.test(l) ? "speedboat" : /minivan/i.test(l) ? "minivan" : "";
    } else if (/^private boat/i.test(l)) d.mode = "private";
  }
  return d.type || d.de || d.vers || d.prestation ? d : null;
}

// ---- Message libre (WhatsApp, sans formulaire) ----------------------------------------------------------------------
// Un client écrit souvent à sa façon : « 4 islands tour on 12 December, 2 adults 1 child, Hotel Sunset ». On en tire ce qui se reconnaît
// sans ambiguïté. Ce qui n'est pas reconnu reste vide : rien n'est deviné, Anaïs corrige en un geste dans la fenêtre.
const MOIS_TXT = "janvier|january|jan|fevrier|february|feb|fev|mars|march|mar|avril|april|apr|avr|mai|may|juin|june|jun|juillet|july|jul|juil|aout|august|aug|septembre|september|sept|sep|octobre|october|oct|novembre|november|nov|decembre|december|dec";
const NUM_MOIS = { jan: 1, fev: 2, feb: 2, mar: 3, avr: 4, apr: 4, mai: 5, may: 5, jui: 6, aou: 8, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const numeroMois = (t) => (t === "juin" || t === "june" || t === "jun" ? 6 : t === "juillet" || t === "july" || t === "jul" || t === "juil" ? 7 : NUM_MOIS[t.slice(0, 3)]);
const sansAcc = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const TELEPHONE = /(?:\+|00)?\d[\d\s().-]{7,}\d/g;

const dateValide = (annee, mois, jour) => {
  const d = new Date(`${iso(annee, mois, jour)}T00:00:00Z`);
  return d.getUTCFullYear() === annee && d.getUTCMonth() + 1 === mois && d.getUTCDate() === jour;
};
const avecAnnee = (jour, mois, anneeTxt, aujourdhui) => {
  let annee = anneeTxt ? (anneeTxt.length === 2 ? 2000 + Number(anneeTxt) : Number(anneeTxt)) : Number(aujourdhui.slice(0, 4));
  if (!dateValide(annee, mois, jour)) return "";
  let r = iso(annee, mois, jour);
  if (!anneeTxt && r < jourPlus(aujourdhui, -7)) r = dateValide(annee + 1, mois, jour) ? iso(annee + 1, mois, jour) : "";
  return r;
};

// Date citée dans une phrase : « 12 December », « December 12th », « le 3 janvier », « demain », « 20/12 ». Vide si rien de sûr.
export function lireDateLibre(texte, aujourdhui, reference = "") {
  const t = sansAcc(texte).replace(TELEPHONE, " ");
  if (/\bapres[- ]?demain\b|day after tomorrow/.test(t)) return jourPlus(aujourdhui, 2);
  if (/\bdemain\b|\btomorrow\b/.test(t)) return jourPlus(aujourdhui, 1);
  if (/\baujourd'?hui\b|\btoday\b|\bce soir\b|\btonight\b/.test(t)) return aujourdhui;
  const TROP_AMBIGU = /^(?:be|have|not|i|we|you|get|also|take|do|like|help|come)\b/;
  let m;
  const a = new RegExp(`(\\d{1,2})(?:st|nd|rd|th|er)?\\s*(?:of\\s+|de\\s+)?(${MOIS_TXT})\\b(?:\\.?\\s*,?\\s*(20\\d\\d))?`, "g");
  while ((m = a.exec(t))) {
    if (m[2] === "may" && TROP_AMBIGU.test(t.slice(m.index + m[0].length).trim())) continue;
    const r = avecAnnee(Number(m[1]), numeroMois(m[2]), m[3], aujourdhui);
    if (r) return r;
  }
  const b = new RegExp(`\\b(${MOIS_TXT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s*,?\\s*(20\\d\\d))?`, "g");
  while ((m = b.exec(t))) {
    const r = avecAnnee(Number(m[2]), numeroMois(m[1]), m[3], aujourdhui);
    if (r) return r;
  }
  const c = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(20\d\d|\d\d))?(?![\d/])/g;
  while ((m = c.exec(t))) {
    const r = avecAnnee(Number(m[1]), Number(m[2]), m[3], aujourdhui);
    if (r) return r;
  }
  // « the 22nd », « le 1er » : le jour seul prend le mois de la date citée avant (`reference`), jamais un mois deviné.
  if (reference) {
    const o = /\b(?:the\s+|le\s+)?(\d{1,2})(?:st|nd|rd|th|er)\b/.exec(t);
    if (o && dateValide(Number(reference.slice(0, 4)), Number(reference.slice(5, 7)), Number(o[1]))) return iso(Number(reference.slice(0, 4)), Number(reference.slice(5, 7)), Number(o[1]));
  }
  return "";
}

const NOMBRES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10 };
const UNITES_PERSONNES = "adults?|adultes?|children|child|kids?|enfants?|babies|baby|bebes?|infants?|people|persons?|personnes?|pax|ppl|guests?";
const chiffresPourMots = (t) => t.replace(new RegExp(`\\b(${Object.keys(NOMBRES).join("|")})\\s+(?=(?:${UNITES_PERSONNES})\\b)`, "g"), (_, w) => `${NOMBRES[w]} `);

const MAJ = "A-ZÀ-ÖØ-Ý";
const MOT_NOM = `[${MAJ}][\\p{L}'’-]+`;
// Mots qui ouvrent une phrase avec une majuscule sans faire partie d'un nom d'hôtel (« Pickup Lanta Sand Resort », « The Sea Breeze Bungalows »).
const DEBUTS_PHRASE = /^(?:hi|hello|hey|dear|we|our|my|the|at|from|in|to|near|pickup|pick|staying|stay|please|also|and|then|bonjour|nous|notre|le|la|au|chez|dans)$/i;
const NON_NOMS = /^(merci|thanks?|thank|hello|hi|hey|bonjour|bonsoir|salut|cordialement|regards|best|cheers|hotel|hôtel|resort|villa|bungalow|koh|phuket|krabi|lanta)\b/i;

// Heure citée dans une phrase : « 9am », « 9 am », « 9.30am », « 9:30 pm », « 21h », « 21h30 », « 14:45 ». Un nombre sans marqueur (« at 9 », « 22.11 »,
// « 10 adults », une date) n'est jamais une heure.
export function lireHeureLibre(texte) {
  const t = sansAcc(texte).replace(TELEPHONE, " ").replace(/\b20\d\d-\d{2}-\d{2}\b/g, " ");
  const deux = (n) => String(n).padStart(2, "0");
  let m = /(?<![\d.:/])(\d{1,2})(?:[:.h]([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/.exec(t);
  if (m) {
    let h = Number(m[1]);
    if (h < 1 || h > 12) return "";
    const pm = m[3].startsWith("p");
    h = pm ? (h === 12 ? 12 : h + 12) : h === 12 ? 0 : h;
    return `${deux(h)}:${m[2] || "00"}`;
  }
  m = /(?<![\d.:/])([01]?\d|2[0-3])\s*h\s*([0-5]\d)?(?![a-z\d])/.exec(t);
  // « 2h » seul est plus souvent une durée qu'une heure : sans minutes, à partir de 5 h.
  if (m && (m[2] || Number(m[1]) >= 5)) return `${deux(m[1])}:${m[2] || "00"}`;
  m = /(?<![\d.:/])([01]?\d|2[0-3]):([0-5]\d)(?!\d)/.exec(t);
  return m ? `${deux(m[1])}:${m[2]}` : "";
}

// Adultes, enfants et bébés d'une phrase : « 2 adults », « 1 child », « 4 personnes dont 2 enfants », « for 3 ». Zéro quand la phrase n'en dit rien.
export function lirePersonnes(brut) {
  const t = chiffresPourMots(sansAcc(brut));
  const nb = (re) => { const x = re.exec(t); return x ? Number(x[1]) : 0; };
  const enfants = nb(/(\d{1,2})\s*(?:children|child|kids?|enfants?)\b/);
  const bebes = nb(/(\d{1,2})\s*(?:babies|baby|bebes?|infants?)\b/);
  let adultes = nb(/(\d{1,2})\s*(?:adults?|adultes?)\b/);
  const total = nb(/(\d{1,2})\s*(?:people|persons?|personnes?|pax|ppl|guests?|voyageurs?)\b/);
  const apresMois = `(?!\\d|\\s*(?:st|nd|rd|th|er)?\\s*(?:${MOIS_TXT})\\b|\\s*[/:h]\\d?)`;
  const pour = nb(new RegExp(`(?:\\bfor|\\bpour|we are|we're|nous sommes|on est|party of|group of|groupe de)\\s+(\\d{1,2})\\b${apresMois}`));
  const nousSommes = nb(/(\d{1,2})\s+of us\b/);
  if (!adultes) {
    const base = total || pour || nousSommes;
    const dont = /(?:dont|including|of whom|of which|whom)\s+\d/.test(t);
    adultes = base ? (dont && enfants < base ? base - enfants : base) : 0;
  }
  return { adultes, enfants, bebes };
}

// Mode et véhicule cités dans une phrase (« private », « join-in », « taxi », « speedboat »).
function modeEtVehicule(brut) {
  const t = sansAcc(brut);
  const out = { vehicule: "", mode: "" };
  if (/speed ?boat/.test(t)) out.vehicule = "speedboat";
  else if (/minivan|mini van|minibus|\bvan\b|\btaxi\b/.test(t)) out.vehicule = "minivan";
  if (/\bprivate\b|\bprive\b|\bprivatif/.test(t)) out.mode = "private";
  else if (/join[- ]?in|collectif|shared|partage|group tour/.test(t)) out.mode = "join";
  return out;
}

export function lireLibre(texte, aujourdhui) {
  const brut = String(texte || "").trim();
  if (!brut) return null;
  const t = chiffresPourMots(sansAcc(brut));
  const d = { libre: true, marque: "", type: "", nom: "", prestation: "", de: "", vers: "", date: lireDateLibre(brut, aujourdhui), dateTexte: "", heure: "", adultes: 0, enfants: 0, bebes: 0, vehicule: "", mode: "", siegeEnfant: false, siegeBebe: false, hotel: "", telephone: "" };

  // Téléphone : une suite de 8 à 15 chiffres qui n'est pas une date.
  for (const m of brut.matchAll(TELEPHONE)) {
    const n = m[0].replace(/\D/g, "").length;
    if (n >= 8 && n <= 15 && !/\d{4}-\d{2}-\d{2}/.test(m[0]) && (/^(\+|00|0)/.test(m[0].trim()) || n >= 9)) {
      d.telephone = m[0].trim().replace(/[\s.-]+$/, "");
      break;
    }
  }

  // Personnes : « 2 adults », « 1 child », « 4 personnes dont 2 enfants », « for 3 ».
  Object.assign(d, lirePersonnes(brut));
  d.siegeEnfant = /child seat|siege enfant|rehausseur|booster/.test(t);
  d.siegeBebe = /baby seat|siege bebe/.test(t);

  d.heure = lireHeureLibre(brut);
  Object.assign(d, modeEtVehicule(brut));

  // Hôtel : un mot-clé d'hébergement suivi d'un nom propre, ou « staying at » suivi d'un nom propre.
  // Espaces et tabulations seulement : un nom ou un hôtel s'arrête à la fin de sa ligne (`\\s` avalait le retour à la ligne et le mot de la ligne suivante).
  const cap = `${MOT_NOM}(?:[ \\t]+${MOT_NOM})*`;
  const suite = `(?:,[ \\t]*${cap})?`;
  const capEn = new RegExp(cap, "uy");
  // Lecture après un mot d'introduction (casse libre), le nom propre lui-même doit avoir ses majuscules.
  const apres = (intro) => {
    for (const m of brut.matchAll(intro)) {
      capEn.lastIndex = m.index + m[0].length;
      const x = capEn.exec(brut);
      if (x) return { texte: x[0], debut: m.index };
    }
    return null;
  };
  const MOT_HEBERGEMENT = "hotel|hôtel|resort|bungalows?|villa|guest ?house|homestay|lodge|hostel|apartments?";
  const mot = apres(new RegExp(`\\b(?:${MOT_HEBERGEMENT})[ \\t]+(?=[${MAJ}])`, "giu"));
  let hote = "";
  if (mot) {
    const debut = mot.debut;
    const reste = new RegExp(`${cap}${suite}`, "uy");
    const motTxt = /^\S+\s+/.exec(brut.slice(debut))[0];
    reste.lastIndex = debut + motTxt.length;
    const x = reste.exec(brut);
    hote = x ? `${motTxt}${x[0]}`.trim() : "";
  }
  if (!hote) {
    const h2 = apres(/(?:staying|stay|stayed|logeons|loge|hébergés?|hebergés?)[ \t]+(?:at|in|à|au|chez|dans)[ \t]+(?:the[ \t]+|l['’][ \t]*|le[ \t]+|la[ \t]+)?/giu);
    if (h2) {
      const reste = new RegExp(`${cap}${suite}`, "uy");
      const fin = /(?:staying|stay|stayed|logeons|loge|hébergés?|hebergés?)[ \t]+(?:at|in|à|au|chez|dans)[ \t]+(?:the[ \t]+|l['’][ \t]*|le[ \t]+|la[ \t]+)?/giu;
      fin.lastIndex = h2.debut;
      const mm = fin.exec(brut);
      reste.lastIndex = mm.index + mm[0].length;
      const x = reste.exec(brut);
      hote = x ? x[0].trim() : "";
    }
  }
  // « Hotel: Sunset Resort, Klong Dao » : tout le reste de la ligne (jusqu'à un point suivi d'une phrase).
  if (!hote) {
    const c = /\bh[oô]tel[ \t]*:[ \t]*([^\n]+?)(?=\.[ \t]+\S|\.[ \t]*$|\n|$)/iu.exec(brut);
    if (c) hote = c[1].trim().replace(/\.$/, "");
  }
  // « pickup at Lanta Sand Resort », « pick us up from Pimalai » : le nom propre qui suit. Un aéroport, un embarcadère ou Koh Lanta n'est pas un hôtel.
  if (!hote) {
    for (const m of brut.matchAll(/\bpick(?:[- ]?up|[ \t]+(?:me|us)[ \t]+up)[ \t]+(?:at|from)[ \t]+(?:the[ \t]+)?/giu)) {
      capEn.lastIndex = m.index + m[0].length;
      const x = capEn.exec(brut);
      if (x && !BOUT_SANS_HOTEL.test(x[0]) && !estMaison(x[0])) { hote = x[0].trim(); break; }
    }
  }
  // « Lanta Sand Resort », « Sea Breeze Bungalows » : des noms propres suivis du mot-clé. Les mots d'une phrase (« We », « Pickup ») ne font pas partie du nom.
  if (!hote) {
    const re = new RegExp(`((?:${MOT_NOM}[ \\t]+){1,4})(?:Resort|Hotel|Bungalows?|Villas?|Lodge|Guest ?house|Hostel|Homestay|Residence)(?:[ \\t]*&[ \\t]*Spa)?(?![\\p{L}])`, "gu");
    for (const m of brut.matchAll(re)) {
      const mots1 = m[1].trim().split(/[ \t]+/);
      while (mots1.length && (DEBUTS_PHRASE.test(mots1[0]) || /['’]/.test(mots1[0]))) mots1.shift();
      if (!mots1.length) continue;
      const nom = `${mots1.join(" ")} ${m[0].slice(m[1].length)}`;
      if (!estMaison(nom)) { hote = nom; break; }
    }
  }
  // « hotel sunset » écrit en minuscules : le mot-clé et au plus quatre mots, jusqu'à un mot de liaison, un chiffre ou une ponctuation.
  if (!hote) {
    const STOP = new Set(["on", "for", "from", "and", "the", "with", "at", "to", "please", "tomorrow", "demain", "le", "la", "les", "pour", "du", "de", "et", "avec", "dans", "since", "until", "till", "we", "i", "nous", "je", "is", "est", "are", "pickup", "pick", "pick-up", "transfer", "transfers", "near", "nearby", "close", "proche", "navette", "ramassage", "tour", "trip", "booking", "reservation", "address", "adresse", "room", "chambre"]);
    const k = new RegExp(`\\b(?:${MOT_HEBERGEMENT})[ \\t]+((?:[\\p{L}'’-]+[ \\t]*){1,5})`, "iu").exec(brut);
    if (k) {
      const mots4 = [];
      for (const w of k[1].trim().split(/[ \t]+/)) {
        if (STOP.has(w.toLowerCase()) || mots4.length >= 4) break;
        mots4.push(w);
      }
      if (mots4.length) hote = `${/^\S+/.exec(k[0])[0]} ${mots4.join(" ")}`;
    }
  }
  d.hotel = hote;

  // Nom : « my name is Sophie Martin », « je suis Marc », sinon une signature en fin de message.
  const n1 = apres(/(?:my name is|i am|i'm|je m['’]appelle|je suis|this is|c['’]est|name:)[ \t]+/giu);
  if (n1 && !NON_NOMS.test(n1.texte)) d.nom = n1.texte.trim();
  else {
    // Signature : après une formule de politesse, ou seule sur sa ligne ou après un point. Le téléphone en fin de message ne compte pas.
    const sansTel = d.telephone ? brut.split(d.telephone).join(" ").trim() : brut;
    const politesse = new RegExp(`(?:merci|thanks?|thank you|cordialement|regards|best regards|best wishes|best|cheers|bien à vous|salutations)\\s*[,.!]?\\s+(${cap})\\s*$`, "iu");
    const m = politesse.exec(sansTel);
    const fin = m ? m[1] : sansTel.split(/[\n.!?]\s*/).map((x) => x.trim()).filter(Boolean).pop() || "";
    if (new RegExp(`^${cap}$`, "u").test(fin) && fin.split(/\s+/).length <= 3 && !NON_NOMS.test(fin)) d.nom = fin;
  }

  const reconnu = d.date || d.adultes || d.enfants || d.telephone || d.hotel || d.nom;
  if (!reconnu && brut.split(/\s+/).length < 4) return null;
  return d;
}

// Lecture d'un message : le formulaire des sites d'abord (lecture exacte), sinon le message libre.
export function lireMessage(texte, aujourdhui) {
  return lireDemande(texte, aujourdhui) || lireLibre(texte, aujourdhui);
}

// Koh Lanta est le point de départ implicite d'un transfert (« un taxi vers l'aéroport de Phuket ») : ces mots ne sont pas exigés dans la phrase.
const MAISON = new Set(["koh", "lanta", "ko"]);
const estMaison = (lieu) => mots(lieu).length > 0 && mots(lieu).every((w) => MAISON.has(w));
const recouvrementSansMaison = (lib, texte) => {
  const utiles = mots(lib).filter((w) => !MAISON.has(w));
  if (!utiles.length || utiles.length === mots(lib).length) return 0;
  return recouvrement(utiles.join(" "), texte);
};

// Un lieu se reconnaît à ses mots distinctifs : « Koh » seul ne fait pas trouver Koh Lipe dans « from Koh Lanta ».
const motsLieu = (lieu) => {
  const m = mots(lieu);
  const utiles = m.filter((w) => w !== "koh" && w !== "ko");
  return utiles.length ? utiles : m;
};
const memeMot = (x, m) => x === m || (x.length > 3 && m.length > 3 && (x.startsWith(m) || m.startsWith(x)));
const lieuCite = (lieu, texte) => {
  const a = motsLieu(lieu);
  if (!a.length) return false;
  const t = mots(texte);
  return a.filter((m) => t.some((x) => memeMot(x, m))).length / a.length >= 0.5;
};
// Deux bouts d'un tarif de transfert : « Krabi Airport → Koh Lanta », « Koh Lanta to Phuket Airport ». Null si le libellé n'est pas un trajet.
const boutsLibelle = (lib) => {
  const b = String(lib || "").split(/\s*(?:→|->|\bto\b|\bvers\b)\s*/i).map((x) => x.trim()).filter(Boolean);
  return b.length === 2 ? { de: b[0], vers: b[1] } : null;
};
// Chaque bout est cité dans la phrase, ou, quand la phrase cite l'autre, sous-entendu (Koh Lanta) ou cité ailleurs dans le message.
const boutsCites = (de, vers, texte, contexte) => {
  const cDe = lieuCite(de, texte);
  const cVers = lieuCite(vers, texte);
  const ok = (cite, lieu, autre) => cite || (!!contexte && autre && (estMaison(lieu) || lieuCite(lieu, contexte)));
  return { ok: ok(cDe, de, cVers) && ok(cVers, vers, cDe), lesDeux: cDe && cVers };
};

// Sens d'un trajet dans la phrase : « from Koh Lanta to Krabi airport » est l'inverse de Krabi Airport → Koh Lanta. « from » et « to » font foi,
// sinon l'ordre des deux lieux. Vide quand un bout manque.
const DEPUIS = new Set(["from", "depuis"]);
const VERS_MOTS = new Set(["to", "vers", "towards", "au"]);
const ENTRE_MOT_ET_LIEU = new Set(["the", "l", "le", "la", "les", "de", "du", "d", "of", "airport", "aeroport", "pier", "port", "jetty", "terminal", "koh", "ko"]);
export function sensTrajet(de, vers, texte) {
  const jetons = sansAccents(texte).replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean).map((m) => SYNONYMES[m] || m);
  const position = (lieu) => {
    const cles = motsLieu(lieu);
    const i = jetons.findIndex((x) => cles.some((m) => memeMot(x, m)));
    if (i < 0) return null;
    let j = i - 1;
    while (j >= 0 && ENTRE_MOT_ET_LIEU.has(jetons[j])) j--;
    return { i, avant: j >= 0 ? jetons[j] : "" };
  };
  const a = position(de);
  const b = position(vers);
  if (!a || !b || a.i === b.i) return "";
  const direct = DEPUIS.has(a.avant) || VERS_MOTS.has(b.avant);
  const inverse = DEPUIS.has(b.avant) || VERS_MOTS.has(a.avant);
  if (direct !== inverse) return direct ? "direct" : "inverse";
  return a.i < b.i ? "direct" : "inverse";
}

// Offres de la base citées dans un message libre : tous les mots distinctifs d'un tarif (ou les deux bouts d'un trajet) doivent apparaître.
// `contexte` : le reste du message, qui complète une phrase où un seul bout du trajet est cité (« un taxi vers l'aéroport de Phuket » : l'autre bout est l'hôtel).
export function proposerOffresLibres(d, texte, { prestations = [], trajets = [], nomPartenaire = () => "", contexte = "" } = {}) {
  const pax = { adultes: d.adultes || (d.enfants ? 0 : 1), enfants: d.enfants };
  const offres = [];
  // L'hôtel et le nom du client ne désignent pas le service : « Klong Dao » dans l'adresse ne doit pas faire trouver un trajet.
  for (const x of [d.hotel, d.nom, d.telephone]) if (x) texte = texte.replace(new RegExp(`(?<![\\p{L}\\d])${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\d])`, "gu"), " ");
  const mt = mots(texte);
  const rang = (mot) => mt.findIndex((x) => x === mot || (x.length > 3 && mot.length > 3 && (x.startsWith(mot) || mot.startsWith(x))));
  for (const t of trajets) {
    if (t.actif === false || (d.date && !trajetDisponible(t, d.date))) continue;
    const de = mots(t.de);
    const vers = mots(t.vers);
    let rDe = recouvrement(t.de, texte);
    let rVers = recouvrement(t.vers, texte);
    // Un bout cité dans la phrase, l'autre dans le reste du message : le trajet compte, jamais sur le seul contexte.
    if (contexte && Math.max(rDe, rVers) >= 0.5 && Math.min(rDe, rVers) < 0.5) {
      const ensemble = `${texte} ${contexte}`;
      if (rDe < 0.5) rDe = Math.max(recouvrement(t.de, ensemble), estMaison(t.de) ? 0.5 : 0);
      else rVers = Math.max(recouvrement(t.vers, ensemble), estMaison(t.vers) ? 0.5 : 0);
    }
    if (!de.length || !vers.length || Math.min(rDe, rVers) < 0.5) continue;
    // Les deux bouts par leurs mots distinctifs, et jamais dans le sens inverse de la demande (on ne réserve pas Krabi → Lanta pour Lanta → Krabi).
    const bouts = boutsCites(t.de, t.vers, texte, contexte);
    if (!bouts.ok || (bouts.lesDeux && sensTrajet(t.de, t.vers, texte) === "inverse")) continue;
    let score = Math.min(rDe, rVers);
    const iDe = Math.min(...de.map(rang).filter((i) => i >= 0), 1e9);
    const iVers = Math.min(...vers.map(rang).filter((i) => i >= 0), 1e9);
    if (iDe > iVers) score -= 0.1;
    const mode = sansAccents(t.mode);
    // « speedboat » demandé : le speedboat d'abord, le ferry reste proposé derrière (même trajet, autre bateau).
    if (d.vehicule === "speedboat") score += /speed/.test(mode) ? 0.3 : /bateau|boat|ferry/.test(mode) ? 0.1 : -0.6;
    if (d.vehicule === "minivan") score += /van|minibus|voiture|car|taxi/.test(mode) ? 0.3 : -0.6;
    if (score < 0.5) continue;
    if (d.mode === "join" && /partag|shared/.test(mode)) score += 0.1;
    if (d.mode === "private" && /priv/.test(mode)) score += 0.1;
    const { total, avertissement } = prixTrajet(t, pax);
    offres.push({ genre: "trajet", id: t.id, source: t, titre: `${t.de} → ${t.vers}${t.depart ? `, ${t.depart}` : ""}`, detail: [t.mode, nomPartenaire(t.partenaire_id)].filter(Boolean).join(" · "), total, avertissement, score });
  }
  for (const p of prestations) {
    // Les frais de parc (à payer sur place) et les tarifs enfant se rattachent à une excursion, ils ne se proposent pas seuls.
    if (p.actif === false || p.famille === "option" || p.famille === "frais" || p.sur_place || p.unite === "ch" || p.unite === "sup") continue;
    const groupe = sansAccents(p.groupe || p.libelle);
    let score = 0;
    let motsCommuns = 0;
    for (const lib of [p.libelle_en, p.libelle]) {
      if (!lib) continue;
      let r = recouvrement(lib, texte);
      // Une prestation de transfert dont un seul bout est dans la phrase : le reste du message complète l'autre.
      if (contexte && p.famille === "transfert" && r < 0.5) r = Math.max(r, r > 0 ? recouvrement(lib, `${texte} ${contexte}`) : 0, recouvrementSansMaison(lib, texte) >= 1 ? 0.6 : 0);
      if (r > score) {
        score = r;
        motsCommuns = Math.round(r * mots(lib).length);
      }
    }
    // Un seul mot commun ne suffit que si le tarif n'en a qu'un et qu'il est assez long pour être précis.
    if (score < 0.5 || (motsCommuns < 2 && !(mots(p.libelle_en || p.libelle).length === 1 && mots(p.libelle_en || p.libelle)[0].length >= 5))) continue;
    // Un tarif de transfert : ses deux bouts cités (Koh Lanta → Phuket Airport ne répond pas à « Koh Lanta to Krabi airport »), dans le bon sens.
    const bouts = p.famille === "transfert" ? boutsLibelle(p.libelle_en) || boutsLibelle(p.libelle) : null;
    if (bouts) {
      const c = boutsCites(bouts.de, bouts.vers, texte, contexte);
      if (!c.ok || (c.lesDeux && sensTrajet(bouts.de, bouts.vers, texte) === "inverse")) continue;
    }
    if (d.mode === "join") score += groupeJoin(groupe) ? 0.2 : -0.1;
    if (d.mode === "private") score += groupePrive(groupe) ? 0.2 : -0.1;
    offres.push({ genre: "prestation", id: p.id, source: p, titre: p.libelle_en || libelleClient(p.libelle), detail: [p.groupe, libelleUnite(p.unite, true), nomPartenaire(p.partenaire_id)].filter(Boolean).join(" · "), total: prixPrestation(p, pax), avertissement: p.sur_place ? "sur_place" : "", score });
  }
  return offres.map((o) => completerSupplement(completerEnfant(o, pax, prestations), pax, prestations)).sort((a, b) => b.score - a.score || (a.total ?? Infinity) - (b.total ?? Infinity)).slice(0, 6);
}

// ---- Plusieurs services dans un même message ------------------------------------------------------------------------------------
// « le tour des 4 îles le 20 novembre, du kayak le 22 et un taxi vers l'aéroport de Phuket le 24 à 9h » : trois services, chacun avec sa date, son
// heure et ses personnes, rattachés par la phrase où le service est cité. Rien n'est deviné : une date, une heure ou un service que la phrase ne
// donne pas reste vide, et un service que la base ne connaît pas devient une ligne « à préciser ».
const VERBES_DEMANDE = /\b(?:want|wants|would like|we'd like|i'd like|need|book|reserve|looking for|interested|price|quote|how much|souhait\w*|voudr\w*|aimer\w*|besoin|r[ée]serv\w*|cherch\w*|int[ée]ress\w*|prix|tarif|devis|combien)/i;
const COUPURES = /\s*(?:[,;]|\b(?:and|et|then|puis|plus|also|aussi)\b)\s*/i;

// Le texte sans ce qui n'est pas un service : l'hôtel, le nom et le téléphone (« Sunset » ne doit pas faire trouver un coucher de soleil).
function sansIdentite(texte, d) {
  let t = texte;
  for (const x of [d.hotel, d.nom, d.telephone]) if (x) t = t.replace(new RegExp(`(?<![\\p{L}\\d])${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\d])`, "gu"), " ");
  return t.replace(/\bh[oô]tel[ \t]*:?/giu, " ");
}

// « and again on 25 november », « et encore le 25 » : un fragment sans autre mot que sa date et un « encore » demande le même service à une autre date.
// « 1 child (8 years) on 20 November », « with 2 kids aged 5 and 7 » : un fragment qui ne dit que des personnes, des âges ou une date complète le service
// d'avant. Un fragment daté qui nomme autre chose (« paragliding on 21 november ») est un service que la base ne connaît pas.
const MARQUES_REPETITION = /\b(?:again|also|same|once more|encore|aussi|de nouveau|idem|pareil|egalement)\b/i;
const MOTS_COMPLEMENT = new RegExp(`\\b(?:${UNITES_PERSONNES}|years?|yrs?|y\\.?o|old|aged?|ages|ans|months?|mois|with|avec|pour|including|dont|only|just|seulement|more|morning|afternoon|evening|night|matin|soir|apres-midi|tomorrow|demain|today|tonight|please|thanks?)\\b`, "g");
function estRepetition(fragment) {
  if (MARQUES_REPETITION.test(sansAcc(fragment))) return true;
  const reste = sansAcc(fragment).replace(new RegExp(`\\b(?:${MOIS_TXT})\\b`, "g"), " ").replace(MOTS_COMPLEMENT, " ").replace(/\b\d+(?:st|nd|rd|th|er)?\b/g, " ");
  return !mots(reste).some((m) => m.length >= 4);
}
// Un fragment daté qui nomme un transport ou une sortie est un service, même quand la base n'en a pas le tarif (ou seulement dans l'autre sens).
const MOTS_SERVICE = /\b(?:transfers?|transferts?|taxi|minivan|van|ferry|speed ?boat|boat|bateau|tour|trip|excursion|activity|activite|navette|shuttle|ride|rental|location|scooter)\b/;

// Offres d'un service du message, recalculées à chaque correction de sa date ou de ses personnes (les prix en dépendent, les départs aussi).
// `service` : { phrase, date, adultes, enfants }. Le message du formulaire du site se lit par ses lignes, le message libre par la phrase du service.
export function offresDuService(d, texte, service, contexte) {
  if (!d.libre) return offresPour({ ...d, date: service.date, adultes: service.adultes, enfants: service.enfants }, texte, contexte).slice(0, 4);
  const base = { adultes: service.adultes, enfants: service.enfants, bebes: d.bebes, date: service.date || "", hotel: "", nom: "", telephone: "" };
  return proposerOffresLibres({ ...base, ...modeEtVehicule(service.phrase) }, service.phrase, { ...contexte, contexte: sansIdentite(texte, d) }).slice(0, 4);
}

export function decouperServices(texte, d, contexte, aujourdhui) {
  if (!d) return [];
  const offresDe = (phrase, sur = {}) => offresDuService(d, texte, { phrase, adultes: d.adultes, enfants: d.enfants, date: "", ...sur }, contexte);
  // Message du formulaire du site (ou de l'ancien) : une seule demande, lue par ses lignes.
  if (!d.libre) return [{ phrase: texte, date: d.date || "", heure: d.heure || "", adultes: d.adultes, enfants: d.enfants, offres: offresDuService(d, texte, { phrase: texte, date: d.date || "", adultes: d.adultes, enfants: d.enfants }, contexte), copie: false }];

  const sans = sansIdentite(texte, d);
  const phrases = sans.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const dateDe = (t, ref = "") => lireDateLibre(t, aujourdhui, ref);
  const groupes = []; // dans l'ordre du message
  for (const phrase of phrases) {
    const frags = phrase.split(COUPURES).map((x) => x.trim()).filter(Boolean);
    const dansPhrase = [];
    const libres = [];
    frags.forEach((f, i) => {
      const offres = offresDe(f);
      if (offres.length) dansPhrase.push({ texte: f, i, copie: false });
      else libres.push({ f, i });
    });
    for (const { f, i } of libres) {
      // Le plus proche avant et le plus proche après : `dansPhrase` n'est pas trié tant que les services inconnus s'y ajoutent.
      const avant = dansPhrase.filter((g) => g.i < i).sort((a, b) => b.i - a.i)[0];
      const apres = dansPhrase.filter((g) => g.i > i).sort((a, b) => a.i - b.i)[0];
      const dateF = dateDe(f);
      if (avant) {
        // Un nouveau service que la base ne connaît pas : une ligne à préciser. Sinon la même chose à une autre date (« et encore le 25 ») : une copie.
        if (VERBES_DEMANDE.test(f) || (dateF && !estRepetition(f))) dansPhrase.push({ texte: f, i, inconnu: true });
        else if (dateF && (avant.dateFixe || dateDe(avant.texte)) && (avant.dateFixe || dateDe(avant.texte)) !== dateF) dansPhrase.push({ texte: `${avant.base || avant.texte} ${f}`, base: avant.base || avant.texte, i, copie: true, dateFixe: dateF, heureFixe: lireHeureLibre(f) });
        else avant.texte += ` ${f}`;
      } else if (apres && !(dateF && !estRepetition(f) && MOTS_SERVICE.test(sansAcc(f)))) apres.texte = `${f} ${apres.texte}`;
      else if (VERBES_DEMANDE.test(f) || (dateF && MOTS_SERVICE.test(sansAcc(f)))) dansPhrase.push({ texte: f, i, inconnu: true });
    }
    dansPhrase.sort((a, b) => a.i - b.i);
    // Une seule date dans la phrase : tous ses services la prennent.
    const datesPhrase = [...new Set(dansPhrase.map((g) => g.dateFixe || dateDe(g.texte)).filter(Boolean))];
    for (const g of dansPhrase) {
      g.dateSurPhrase = datesPhrase.length === 1 ? datesPhrase[0] : "";
      groupes.push(g);
    }
  }
  if (!groupes.length) return [];
  // Une seule date dans tout le message : les services sans date la prennent.
  const toutesDates = [...new Set(groupes.map((g) => g.dateFixe || dateDe(g.texte) || g.dateSurPhrase).filter(Boolean))];
  let derniere = "";
  return groupes.map((g) => {
    const propre = g.dateFixe || dateDe(g.texte, derniere) || g.dateSurPhrase;
    const date = propre || (toutesDates.length === 1 ? toutesDates[0] : "");
    if (date) derniere = date;
    const gens = lirePersonnes(g.texte);
    const adultes = gens.adultes || d.adultes;
    // « for 2 adults » dans le fragment, « and 1 child » ailleurs : le même groupe garde ses enfants. Un autre nombre d'adultes est un autre groupe.
    const enfants = gens.enfants || (gens.adultes && gens.adultes !== d.adultes ? 0 : d.enfants);
    // Une heure ne se partage pas entre services : elle vaut pour celui dont la phrase la donne.
    const heure = g.heureFixe || lireHeureLibre(g.texte) || (groupes.length === 1 ? d.heure : "");
    return { phrase: g.texte.replace(/\s+([.,!?])/g, "$1").replace(/\s{2,}/g, " ").trim(), date, heure, adultes, enfants, offres: g.inconnu ? [] : offresDe(g.texte, { date, adultes, enfants }), copie: !!g.copie };
  });
}

// Langue de la réponse à une demande collée : en excursions (Secret et Taxi) toujours l'anglais, comme tout ce que voit le client ;
// ailleurs, celle du message du client.
export const langueReponse = (texte, excursions = false) => (excursions ? "en" : langueDuMessage(texte));

// Langue du client d'après son message : le français quand il l'emporte, l'anglais sinon (les documents de Secret sont en anglais).
export function langueDuMessage(texte) {
  const t = ` ${sansAcc(texte)} `;
  const compte = (re) => (t.match(re) || []).length;
  const fr = compte(/\b(?:bonjour|bonsoir|nous|voudrions|voulons|aimerions|souhaitons|merci|pour|avec|adultes?|enfants?|demain|le|la|les|des|une?|svp|sommes|logeons|serait|aussi|encore)\b/g);
  const en = compte(/\b(?:hello|hi|we|would|like|want|please|thanks?|thank|adults?|children|the|for|with|tomorrow|are|and|tour|trip|also|again)\b/g);
  return fr > en ? "fr" : "en";
}

const nombreLangue = (n, langue) => (langue === "fr" ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n).replace(/[  ]/g, " ") : nombre(n));
const NOTE_LANGKAWI_FR = "Trajet vers ou depuis Langkawi (Malaisie) : prévoyez votre passeport, valable au moins six mois.";

// Variables du modèle « réponse au client » : un seul message qui reprend chaque service avec SA date, son prix, et le total. Tout est dans la langue
// demandée, un prix ou une date inconnus sont dits en toutes lettres, jamais laissés vides. `services` : [{ offre, phrase, date, adultes, enfants, bebes }].
export function varsReponse({ d, services, devise = "THB", langue = "en", entreprise = {}, nomPartenaire = () => "" }) {
  const fr = langue === "fr";
  const prenom = prenomDe(d.nom);
  let total = 0;
  let complet = services.length > 0;
  const blocs = services.map((s) => {
    const o = s.offre;
    const titre = o ? (fr && o.genre === "prestation" && o.source && o.source.libelle ? o.source.libelle : o.titre) : `${fr ? "Service à préciser : " : "Service to be specified: "}« ${(s.phrase || "").trim()} »`;
    const date = s.date ? dateTexte(s.date, langue) : fr ? "date à confirmer" : "date to be confirmed";
    const gens = personnesTexte({ adultes: s.adultes, enfants: s.enfants, bebes: s.bebes }, langue) || (fr ? "personnes à confirmer" : "people to be confirmed");
    const prixConnu = o && o.total !== null && o.total !== undefined;
    if (prixConnu) total += o.total;
    else complet = false;
    const prix = prixConnu ? `${devise} ${nombreLangue(o.total, langue)}` : fr ? "prix à confirmer" : "price to be confirmed";
    let bloc = `• ${titre}\n  ${date} · ${gens} · ${prix}`;
    // Trajet vers ou depuis Langkawi : passeport et check-in à lire avant de réserver.
    const note = o ? notePasseport({ de: o.source && o.source.de, vers: o.source && o.source.vers, libelle: o.titre, compagnie: o.source ? nomPartenaire(o.source.partenaire_id) : "" }) : "";
    if (note) bloc += `\n  ${fr ? `${NOTE_LANGKAWI_FR} ${note.split(/months\.\s*/)[1] || ""}`.trim() : note}`;
    return bloc;
  });
  return {
    bonjour: `${fr ? "Bonjour" : "Hello"}${prenom ? ` ${prenom}` : ""},`,
    prenom: prenom || "",
    client: d.nom || "",
    services: blocs.join("\n"),
    total: complet ? `${devise} ${nombreLangue(total, langue)}` : fr ? "à confirmer" : "to be confirmed",
    entreprise: entreprise.nom || "",
    telephone: entreprise.telephone || "",
  };
}

// Les offres d'une lecture, quelle que soit son origine : formulaire du site ou message libre.
export const offresPour = (d, texte, contexte) => (d.libre ? proposerOffresLibres(d, texte, contexte) : proposerOffres(d, contexte));

// Clients déjà connus qui ressemblent à celui du message : même téléphone d'abord, puis même nom. Évite les doublons.
const cleTelephone = (t) => {
  const n = String(t || "").replace(/\D/g, "");
  return n.length >= 8 ? n.slice(-9) : "";
};
const cleNom = (c) => sansAcc(`${c.prenom || ""} ${c.nom || ""}`).split(/\s+/).filter(Boolean).sort().join(" ");
export function clientsProches(d, clients) {
  const tel = cleTelephone(d.telephone);
  const nom = cleNom({ prenom: "", nom: d.nom || "" });
  const trouves = [];
  for (const c of clients) {
    if (tel && cleTelephone(c.telephone) === tel) trouves.push({ client: c, raison: "telephone", rang: 0 });
    else if (nom && cleNom(c) === nom) trouves.push({ client: c, raison: "nom", rang: 1 });
  }
  return trouves.sort((a, b) => a.rang - b.rang).map(({ client, raison }) => ({ client, raison }));
}

// ---- Propositions de prix --------------------------------------------------------------------------------------------
const MOTS_VIDES = new Set(["the", "a", "an", "and", "to", "from", "of", "with", "in", "at", "by", "for", "on", "per", "or", "into", "par", "pour", "sur", "aeroport", "aeroports", "de", "du", "la", "le", "les", "et", "en", "tour", "trip", "airport", "pier"]);
// Passage de l'anglais du formulaire au français de la base, pour les mots qui reviennent le plus.
const SYNONYMES = { islands: "iles", island: "ile", boat: "bateau", sunset: "coucher", mangroves: "mangrove", diving: "plongee", scuba: "plongee", cooking: "cuisine", elephant: "elephant", rental: "location", scooter: "scooter" };
const mots = (texte) =>
  sansAccents(texte)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((m) => m && !MOTS_VIDES.has(m))
    .map((m) => SYNONYMES[m] || m);
const recouvrement = (cherche, texte) => {
  const a = mots(cherche);
  if (!a.length) return 0;
  const t = new Set(mots(texte));
  return a.filter((m) => t.has(m) || [...t].some((x) => x.length > 3 && m.length > 3 && (x.startsWith(m) || m.startsWith(x)))).length / a.length;
};

// Prix total d'une prestation selon son unité. Les bébés ne comptent pas. `null` : prix à définir ou à payer sur place.
export function prixPrestation(p, { adultes, enfants }) {
  if (p.sur_place || p.prix_vente === null || p.prix_vente === undefined) return null;
  const prix = Number(p.prix_vente);
  switch (p.unite) {
    case "pp": return prix * (adultes + enfants);
    case "ad": return prix * adultes;
    case "ch": return prix * enfants;
    case "sup": return prix * personnesSupplementaires({ adultes, enfants });
    default: return prix; // par bateau, véhicule, groupe, session, jour : un seul prix
  }
}

export function prixTrajet(t, { adultes, enfants }) {
  const adulte = Number(t.prix_adulte);
  if (t.prix_adulte === null || t.prix_adulte === undefined || Number.isNaN(adulte)) return { total: null, avertissement: "prix_a_definir" };
  const enfantPrix = t.prix_enfant === null || t.prix_enfant === undefined ? null : Number(t.prix_enfant);
  if (enfants > 0 && enfantPrix === null) return { total: adulte * adultes, avertissement: "sans_tarif_enfant" };
  return { total: adulte * adultes + (enfantPrix || 0) * enfants, avertissement: "" };
}

// Le groupe d'une prestation dit si l'excursion est en groupe (join) ou privée, en français (anciennes données) comme en anglais. `groupe` est sans accents, en minuscules.
export const groupeJoin = (groupe) => /join|collectif|partag|shared/.test(groupe);
export const groupePrive = (groupe) => /priv/.test(groupe);

// Tarif enfant d'une excursion : la prestation « enfant » du même partenaire et du même groupe, au même nom avant la virgule.
const nomCourt = (l) => sansAccents(l).split(",")[0].trim();
export function prestationEnfant(p, prestations = []) {
  if (!["pp", "ad"].includes(p.unite)) return null;
  return prestations.find((q) => q.id !== p.id && q.actif !== false && q.unite === "ch" && q.partenaire_id === p.partenaire_id && q.famille === p.famille && (q.groupe || "") === (p.groupe || "") && nomCourt(q.libelle) === nomCourt(p.libelle)) || null;
}

// Prix d'une prestation avec ses enfants : adultes au tarif adulte, enfants au tarif enfant s'il existe. Sans tarif enfant, les enfants
// sont comptés au tarif adulte (par personne) et l'avertissement le dit.
export function completerEnfant(offre, pax, prestations) {
  const p = offre.source;
  if (offre.genre !== "prestation" || !pax.enfants || p.sur_place) return offre;
  const e = prestationEnfant(p, prestations);
  if (e && e.prix_vente !== null && e.prix_vente !== undefined && offre.total !== null) return { ...offre, enfant: e, total: Number(p.prix_vente) * pax.adultes + Number(e.prix_vente) * pax.enfants };
  if (!e && p.unite === "pp" && offre.total !== null) return { ...offre, avertissement: offre.avertissement || "enfant_plein_tarif" };
  return offre;
}

// Supplément « par personne supplémentaire » d'une excursion : la prestation du même partenaire, du même groupe et du même nom avant la virgule
// (« Programme B : Private Fishing & Seafood, Base 1-2 pers » et « …, Personne supplémentaire »).
export function prestationSupplement(p, prestations = []) {
  if (p.unite !== "grp") return null;
  const memes = prestations.filter((q) => q.id !== p.id && q.actif !== false && q.unite === "sup" && q.partenaire_id === p.partenaire_id && q.famille === p.famille && (q.groupe || "") === (p.groupe || ""));
  // Le même nom avant la virgule d'abord, le nom du programme (« Programme B ») seulement à défaut.
  return memes.find((q) => nomCourt(q.libelle) === nomCourt(p.libelle)) || memes.find((q) => prefixeProgramme(q.libelle) && prefixeProgramme(q.libelle) === prefixeProgramme(p.libelle)) || null;
}

// Prix de base pour 1 ou 2 personnes, puis le supplément pour chaque personne en plus : le total de l'offre les additionne, `supplement` garde la
// prestation et la quantité pour fabriquer la ligne de facture. Sans prix de supplément, l'offre est signalée plutôt que sous-estimée.
export function completerSupplement(offre, pax, prestations) {
  const p = offre.source;
  if (offre.genre !== "prestation" || p.sur_place) return offre;
  const s = prestationSupplement(p, prestations);
  const qte = personnesSupplementaires(pax);
  if (!s || !qte) return offre;
  if (s.prix_vente === null || s.prix_vente === undefined || offre.total === null) return { ...offre, avertissement: offre.avertissement || "supplement_a_definir" };
  return { ...offre, supplement: { source: s, qte }, total: offre.total + Number(s.prix_vente) * qte };
}

// Offres de la base qui correspondent à la demande, la plus proche en premier. Au plus six.
// `nomPartenaire(id)` renvoie le nom du partenaire.
export function proposerOffres(d, { prestations = [], trajets = [], nomPartenaire = () => "" } = {}) {
  const pax = { adultes: d.adultes || (d.enfants ? 0 : 1), enfants: d.enfants };
  const offres = [];
  if (d.type === "transfer" || (d.de && d.vers)) {
    for (const t of trajets) {
      if (t.actif === false || (d.date && !trajetDisponible(t, d.date))) continue;
      const direct = Math.min(recouvrement(d.de, t.de), recouvrement(d.vers, t.vers));
      const inverse = Math.min(recouvrement(d.de, t.vers), recouvrement(d.vers, t.de));
      let score = Math.max(direct, inverse);
      if (score < 0.5) continue;
      if (inverse > direct) score -= 0.1;
      const mode = sansAccents(t.mode);
      if (d.vehicule === "speedboat") score += /speed|bateau|boat|ferry/.test(mode) ? 0.3 : -0.6;
      if (d.vehicule === "minivan") score += /van|minibus|voiture|car|taxi/.test(mode) ? 0.3 : -0.6;
      // Le véhicule demandé écarte les autres : un minivan ne se propose pas en speedboat.
      if (score < 0.5) continue;
      if (d.mode === "shared" && /partag|shared/.test(mode)) score += 0.1;
      if (d.mode === "private" && /priv/.test(mode)) score += 0.1;
      const { total, avertissement } = prixTrajet(t, pax);
      offres.push({ genre: "trajet", id: t.id, source: t, titre: `${t.de} → ${t.vers}${t.depart ? `, ${t.depart}` : ""}`, detail: [t.mode, nomPartenaire(t.partenaire_id)].filter(Boolean).join(" · "), total, avertissement, score });
    }
    for (const p of prestations) {
      if (p.actif === false || p.famille !== "transfert" || p.unite === "sup") continue;
      const texte = `${p.libelle} ${p.libelle_en || ""} ${p.groupe || ""}`;
      const score = Math.min(recouvrement(d.de, texte), recouvrement(d.vers, texte));
      if (score < 0.5) continue;
      offres.push({ genre: "prestation", id: p.id, source: p, titre: p.libelle_en || libelleClient(p.libelle), detail: [libelleUnite(p.unite, true), nomPartenaire(p.partenaire_id)].filter(Boolean).join(" · "), total: prixPrestation(p, pax), avertissement: p.sur_place ? "sur_place" : "", score });
    }
  } else if (d.prestation) {
    for (const p of prestations) {
      // Le tarif enfant d'une excursion se rattache à son tarif adulte (completerEnfant) : il ne se propose pas seul, et ne passe jamais en tête.
      if (p.actif === false || p.unite === "sup" || p.unite === "ch") continue;
      const texte = `${p.libelle} ${p.libelle_en || ""} ${p.groupe || ""}`;
      let score = recouvrement(d.type === "location" && d.vehiculeNom ? `${d.prestation} ${d.vehiculeNom}` : d.prestation, texte);
      if (score < 0.5) continue;
      const groupe = sansAccents(p.groupe || p.libelle);
      if (d.mode === "join") score += groupeJoin(groupe) ? 0.2 : -0.1;
      if (d.mode === "private") score += groupePrive(groupe) ? 0.2 : -0.1;
      offres.push({ genre: "prestation", id: p.id, source: p, titre: p.libelle_en || libelleClient(p.libelle), detail: [p.groupe, libelleUnite(p.unite, true), nomPartenaire(p.partenaire_id)].filter(Boolean).join(" · "), total: prixPrestation(p, pax), avertissement: p.sur_place ? "sur_place" : "", score });
    }
  }
  return offres.map((o) => completerSupplement(completerEnfant(o, pax, prestations), pax, prestations)).sort((a, b) => b.score - a.score || (a.total ?? Infinity) - (b.total ?? Infinity)).slice(0, 6);
}

// ---- Réponse au client ---------------------------------------------------------------------------------------------
const prenomDe = (nom) => (nom || "").trim().split(/\s+/)[0] || "";
const nombre = (n) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

// Texte anglais à envoyer au client : ce qui a été demandé, le prix de la base, et la question de la réservation. Rien d'autre.
export function reponsePrix(d, offre, { devise = "THB", compagnie = "" } = {}) {
  const prenom = prenomDe(d.nom);
  const lignes = [`Hello${prenom ? ` ${prenom}` : ""},`, ""];
  lignes.push(offre.titre);
  if (d.date) lignes.push(`Date: ${dateTexte(d.date, "en")}`);
  if (d.heure) lignes.push(`Pickup time: ${d.heure}`);
  const gens = personnesTexte({ adultes: d.adultes, enfants: d.enfants, bebes: d.bebes }, "en");
  if (gens) lignes.push(`People: ${gens}`);
  if (offre.total !== null && offre.total !== undefined) lignes.push(`Price: ${devise} ${nombre(offre.total)}`);
  // Trajet vers ou depuis Langkawi : passeport et check-in à lire avant de réserver.
  const passeport = notePasseport({ de: offre.source && offre.source.de, vers: offre.source && offre.source.vers, libelle: offre.titre, compagnie });
  if (passeport) lignes.push("", passeport);
  lignes.push("", "Would you like me to book it?");
  return lignes.join("\n");
}

// Notes internes d'un dossier créé depuis une demande : ce que le client a demandé et qui n'a pas de champ à lui.
export function notesDemande(d) {
  return [
    d.heure ? `Pickup time: ${d.heure}` : "",
    d.vol ? `Flight or ferry: ${d.vol}` : "",
    d.siegeEnfant ? "Child seat needed" : "",
    d.siegeBebe ? "Baby seat needed" : "",
    d.bebes ? `Babies (0-2): ${d.bebes}` : "",
    d.ages && d.ages.length ? `Child ages: ${d.ages.map((a) => (a === 0 ? "under 1" : a)).join(", ")}` : "",
    d.bagages ? `Bags: ${d.bagages}` : "",
    d.extras ? `Extras: ${d.extras}` : "",
    d.vehiculeNom ? `Vehicle: ${d.vehiculeNom}${d.vehicules > 1 ? ` × ${d.vehicules}` : ""}` : "",
    d.jusqua ? `Rental until: ${d.jusqua}` : "",
    d.billet ? `Ticket: ${d.billet}${d.retour ? `, return ${d.retour}` : ""}` : "",
    d.saison ? `Season: ${d.saison}` : "",
    d.sorties && d.sorties.length ? `Other trips: ${d.sorties.join(" | ")}` : "",
    d.prixSite ? `Price on the site: ${d.prixSite}` : "",
  ]
    .filter(Boolean)
    .join(". ");
}

// Prénom et nom d'un nom saisi sur le site (« Anna Keller ») : le premier mot est le prénom, le reste le nom.
export function separerNom(nom) {
  const m = (nom || "").trim().split(/\s+/).filter(Boolean);
  return m.length <= 1 ? { prenom: "", nom: m[0] || "" } : { prenom: m[0], nom: m.slice(1).join(" ") };
}
