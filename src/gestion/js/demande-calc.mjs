// Demande d'un client reçue par WhatsApp : lecture du message que rédigent les formulaires des sites Secret et Taxi, propositions de prix
// d'après la base partenaires, et réponse prête à envoyer. Logique pure, testée avec node --test.
// Rien n'est inventé : un prix vient d'une ligne de la base, et sans correspondance on propose seulement de chercher à la main.
import { sansAccents, trajetDisponible, libelleUnite, libelleClient } from "./partenaires-calc.mjs";
import { dateTexte, personnesTexte } from "./operations-calc.mjs";

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

// Lit le message d'un formulaire. Renvoie null si le texte ne ressemble à aucune demande.
export function lireDemande(texte, aujourdhui) {
  const lignes = String(texte || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lignes.length) return null;
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
export function lireDateLibre(texte, aujourdhui) {
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
  return "";
}

const NOMBRES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10 };
const UNITES_PERSONNES = "adults?|adultes?|children|child|kids?|enfants?|babies|baby|bebes?|infants?|people|persons?|personnes?|pax|ppl|guests?";
const chiffresPourMots = (t) => t.replace(new RegExp(`\\b(${Object.keys(NOMBRES).join("|")})\\s+(?=(?:${UNITES_PERSONNES})\\b)`, "g"), (_, w) => `${NOMBRES[w]} `);

const MAJ = "A-ZÀ-ÖØ-Ý";
const MOT_NOM = `[${MAJ}][\\p{L}'’-]+`;
const NON_NOMS = /^(merci|thanks?|thank|hello|hi|hey|bonjour|bonsoir|salut|cordialement|regards|best|cheers|hotel|hôtel|resort|villa|bungalow|koh|phuket|krabi|lanta)\b/i;

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
  d.adultes = adultes;
  d.enfants = enfants;
  d.bebes = bebes;
  d.siegeEnfant = /child seat|siege enfant|rehausseur|booster/.test(t);
  d.siegeBebe = /baby seat|siege bebe/.test(t);

  const h = /\b([01]?\d|2[0-3])\s*[:h]\s*([0-5]\d)\b/.exec(t);
  if (h) d.heure = `${h[1].padStart(2, "0")}:${h[2]}`;

  if (/speed ?boat/.test(t)) d.vehicule = "speedboat";
  else if (/minivan|mini van|minibus|\bvan\b|\btaxi\b/.test(t)) d.vehicule = "minivan";
  if (/\bprivate\b|\bprive\b|\bprivatif/.test(t)) d.mode = "private";
  else if (/join[- ]?in|collectif|shared|partage|group tour/.test(t)) d.mode = "join";

  // Hôtel : un mot-clé d'hébergement suivi d'un nom propre, ou « staying at » suivi d'un nom propre.
  const cap = `${MOT_NOM}(?:\\s+${MOT_NOM})*`;
  const suite = `(?:,\\s*${cap})?`;
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
  const mot = apres(new RegExp(`\\b(?:${MOT_HEBERGEMENT})\\s+(?=[${MAJ}])`, "giu"));
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
    const h2 = apres(/(?:staying|stay|stayed|logeons|loge|hébergés?|hebergés?)\s+(?:at|in|à|au|chez|dans)\s+(?:the\s+|l['’]\s*|le\s+|la\s+)?/giu);
    if (h2) {
      const reste = new RegExp(`${cap}${suite}`, "uy");
      const fin = /(?:staying|stay|stayed|logeons|loge|hébergés?|hebergés?)\s+(?:at|in|à|au|chez|dans)\s+(?:the\s+|l['’]\s*|le\s+|la\s+)?/giu;
      fin.lastIndex = h2.debut;
      const mm = fin.exec(brut);
      reste.lastIndex = mm.index + mm[0].length;
      const x = reste.exec(brut);
      hote = x ? x[0].trim() : "";
    }
  }
  d.hotel = hote;

  // Nom : « my name is Sophie Martin », « je suis Marc », sinon une signature en fin de message.
  const n1 = apres(/(?:my name is|i am|i'm|je m['’]appelle|je suis|this is|c['’]est|name:)\s+/giu);
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

// Offres de la base citées dans un message libre : tous les mots distinctifs d'un tarif (ou les deux bouts d'un trajet) doivent apparaître.
export function proposerOffresLibres(d, texte, { prestations = [], trajets = [], nomPartenaire = () => "" } = {}) {
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
    const rDe = recouvrement(t.de, texte);
    const rVers = recouvrement(t.vers, texte);
    if (!de.length || !vers.length || Math.min(rDe, rVers) < 0.5) continue;
    let score = Math.min(rDe, rVers);
    const iDe = Math.min(...de.map(rang).filter((i) => i >= 0), 1e9);
    const iVers = Math.min(...vers.map(rang).filter((i) => i >= 0), 1e9);
    if (iDe > iVers) score -= 0.1;
    const mode = sansAccents(t.mode);
    if (d.vehicule === "speedboat") score += /speed|bateau|boat|ferry/.test(mode) ? 0.3 : -0.6;
    if (d.vehicule === "minivan") score += /van|minibus|voiture|car|taxi/.test(mode) ? 0.3 : -0.6;
    if (score < 0.5) continue;
    if (d.mode === "join" && /partag|shared/.test(mode)) score += 0.1;
    if (d.mode === "private" && /priv/.test(mode)) score += 0.1;
    const { total, avertissement } = prixTrajet(t, pax);
    offres.push({ genre: "trajet", id: t.id, source: t, titre: `${t.de} → ${t.vers}${t.depart ? `, ${t.depart}` : ""}`, detail: [t.mode, nomPartenaire(t.partenaire_id)].filter(Boolean).join(" · "), total, avertissement, score });
  }
  for (const p of prestations) {
    // Les frais de parc (à payer sur place) et les tarifs enfant se rattachent à une excursion, ils ne se proposent pas seuls.
    if (p.actif === false || p.famille === "option" || p.famille === "frais" || p.sur_place || p.unite === "ch") continue;
    const groupe = sansAccents(p.groupe || p.libelle);
    let score = 0;
    let motsCommuns = 0;
    for (const lib of [p.libelle_en, p.libelle]) {
      if (!lib) continue;
      const r = recouvrement(lib, texte);
      if (r > score) {
        score = r;
        motsCommuns = Math.round(r * mots(lib).length);
      }
    }
    // Un seul mot commun ne suffit que si le tarif n'en a qu'un et qu'il est assez long pour être précis.
    if (score < 0.5 || (motsCommuns < 2 && !(mots(p.libelle_en || p.libelle).length === 1 && mots(p.libelle_en || p.libelle)[0].length >= 5))) continue;
    if (d.mode === "join") score += /join|collectif|partag/.test(groupe) ? 0.2 : -0.1;
    if (d.mode === "private") score += /priv/.test(groupe) ? 0.2 : -0.1;
    offres.push({ genre: "prestation", id: p.id, source: p, titre: p.libelle_en || libelleClient(p.libelle), detail: [p.groupe, libelleUnite(p.unite, true), nomPartenaire(p.partenaire_id)].filter(Boolean).join(" · "), total: prixPrestation(p, pax), avertissement: p.sur_place ? "sur_place" : "", score });
  }
  return offres.map((o) => completerEnfant(o, pax, prestations)).sort((a, b) => b.score - a.score || (a.total ?? Infinity) - (b.total ?? Infinity)).slice(0, 6);
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
const MOTS_VIDES = new Set(["the", "a", "an", "and", "to", "from", "of", "with", "in", "at", "by", "for", "on", "per", "or", "into", "par", "pour", "sur", "de", "du", "la", "le", "les", "et", "en", "tour", "trip", "airport", "pier"]);
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
      if (p.actif === false || p.famille !== "transfert") continue;
      const texte = `${p.libelle} ${p.libelle_en || ""} ${p.groupe || ""}`;
      const score = Math.min(recouvrement(d.de, texte), recouvrement(d.vers, texte));
      if (score < 0.5) continue;
      offres.push({ genre: "prestation", id: p.id, source: p, titre: p.libelle_en || libelleClient(p.libelle), detail: [libelleUnite(p.unite, true), nomPartenaire(p.partenaire_id)].filter(Boolean).join(" · "), total: prixPrestation(p, pax), avertissement: p.sur_place ? "sur_place" : "", score });
    }
  } else if (d.prestation) {
    for (const p of prestations) {
      if (p.actif === false) continue;
      const texte = `${p.libelle} ${p.libelle_en || ""} ${p.groupe || ""}`;
      let score = recouvrement(d.prestation, texte);
      if (score < 0.5) continue;
      const groupe = sansAccents(p.groupe || p.libelle);
      if (d.mode === "join") score += /join|collectif|partag/.test(groupe) ? 0.2 : -0.1;
      if (d.mode === "private") score += /priv/.test(groupe) ? 0.2 : -0.1;
      offres.push({ genre: "prestation", id: p.id, source: p, titre: p.libelle_en || libelleClient(p.libelle), detail: [p.groupe, libelleUnite(p.unite, true), nomPartenaire(p.partenaire_id)].filter(Boolean).join(" · "), total: prixPrestation(p, pax), avertissement: p.sur_place ? "sur_place" : "", score });
    }
  }
  return offres.map((o) => completerEnfant(o, pax, prestations)).sort((a, b) => b.score - a.score || (a.total ?? Infinity) - (b.total ?? Infinity)).slice(0, 6);
}

// ---- Réponse au client ---------------------------------------------------------------------------------------------
const prenomDe = (nom) => (nom || "").trim().split(/\s+/)[0] || "";
const nombre = (n) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

// Texte anglais à envoyer au client : ce qui a été demandé, le prix de la base, et la question de la réservation. Rien d'autre.
export function reponsePrix(d, offre, { devise = "THB" } = {}) {
  const prenom = prenomDe(d.nom);
  const lignes = [`Hello${prenom ? ` ${prenom}` : ""},`, ""];
  lignes.push(offre.titre);
  if (d.date) lignes.push(`Date: ${dateTexte(d.date, "en")}`);
  if (d.heure) lignes.push(`Pickup time: ${d.heure}`);
  const gens = personnesTexte({ adultes: d.adultes, enfants: d.enfants, bebes: d.bebes }, "en");
  if (gens) lignes.push(`People: ${gens}`);
  if (offre.total !== null && offre.total !== undefined) lignes.push(`Price: ${devise} ${nombre(offre.total)}`);
  lignes.push("", "Would you like me to book it?");
  return lignes.join("\n");
}

// Notes internes d'un dossier créé depuis une demande : ce que le client a demandé et qui n'a pas de champ à lui.
export function notesDemande(d) {
  return [d.heure ? `Pickup time: ${d.heure}` : "", d.siegeEnfant ? "Child seat needed" : "", d.siegeBebe ? "Baby seat needed" : "", d.bebes ? `Babies (0-2): ${d.bebes}` : ""].filter(Boolean).join(". ");
}

// Prénom et nom d'un nom saisi sur le site (« Anna Keller ») : le premier mot est le prénom, le reste le nom.
export function separerNom(nom) {
  const m = (nom || "").trim().split(/\s+/).filter(Boolean);
  return m.length <= 1 ? { prenom: "", nom: m[0] || "" } : { prenom: m[0], nom: m.slice(1).join(" ") };
}
