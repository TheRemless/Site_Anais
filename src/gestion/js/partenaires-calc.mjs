// Logique pure du module Partenaires : familles, unités, marges, recherche de trajets.
// Aucune dépendance au navigateur pour pouvoir la tester avec node --test.
import { N_, tr, langueActive } from "./i18n.mjs";

export const FAMILLES = [
  ["excursion", N_("Excursions")],
  ["activite", N_("Activités")],
  ["location", N_("Locations")],
  ["transfert", N_("Transferts")],
  ["frais", N_("Frais de parc")],
  ["autre", N_("Autres")],
];
// « Réglé sur place par le client » (note hors total) n'a de sens que pour un frais : droit de parc, entrée (16.11.2026).
export const surPlacePossible = (famille) => famille === "frais";
export const nomFamille = (code) => {
  const f = FAMILLES.find(([c]) => c === code);
  return f ? tr(f[1]) : code;
};

// Unité d'un prix : code court en base, libellé en français et en anglais pour les documents.
export const UNITES = {
  pp: ["par personne", "per person"],
  ad: ["par adulte", "per adult"],
  ch: ["par enfant", "per child"],
  boat: ["par bateau", "per boat"],
  veh: ["par véhicule", "per vehicle"],
  day: ["par jour", "per day"],
  ses: ["par session", "per session"],
  grp: ["par groupe", "per group"],
  sup: ["par personne supplémentaire", "per extra person"],
  "": ["", ""],
};
// Personnes au-delà des deux premières, pour un tarif « prix de base pour 1 ou 2 personnes, puis un supplément par personne en plus ». Les bébés ne comptent pas.
export const PERSONNES_DE_BASE = 2;
export const personnesSupplementaires = ({ adultes = 0, enfants = 0 } = {}) => Math.max(0, (Number(adultes) || 0) + (Number(enfants) || 0) - PERSONNES_DE_BASE);
// Quantité proposée pour un tarif selon son unité : par personne, par adulte, par enfant, par personne supplémentaire (0 possible), sinon une seule.
export const quantiteParDefaut = (unite, p = {}) => {
  const a = Number(p.adultes) || 0;
  const e = Number(p.enfants) || 0;
  if (unite === "sup") return personnesSupplementaires(p);
  return (unite === "pp" ? a + e : unite === "ad" ? a : unite === "ch" ? e : 1) || 1;
};
// « Programme B : Private Fishing & Seafood, Base 1-2 pers » → « programme b » : le nom d'un programme est ce qui précède les deux-points. Les libellés d'un même
// programme n'ont pas toujours la même suite (la base dit « Fresh Seafood Lunch (4 heures) », le supplément seulement « Seafood »).
export const prefixeProgramme = (libelle) => {
  const t = String(libelle || "");
  const i = t.indexOf(":");
  if (i <= 0 || i >= 40) return "";
  // Seulement la convention « Programme A », « Program B » : un autre « xxx : » (« Speedboat transfer: Lanta → Lipe ») ne désigne pas un programme.
  const p = sansAccents(t.slice(0, i)).trim();
  return /^(programme|program)\s+[a-z0-9]{1,3}$/.test(p) ? p : "";
};
// Une ligne de supplément (« par personne supplémentaire ») se reconnaît à son drapeau `supplement`, ou à son unité écrite dans l'intro (l'intro est vidée quand la ligne
// entre dans une facture : le drapeau seul survit).
export const estLigneSupplement = (l) => !!l && (l.supplement === true || /suppl[ée]mentaire|extra person/i.test(l.intro || ""));
export const libelleUnite = (code, en = langueActive() === "en") => (UNITES[code] || UNITES[""])[en ? 1 : 0];

// La période d'un trajet quand elle couvre tout le contrat : rien à afficher. Les anciens trajets la disent en français, les nouveaux en anglais.
export const PERIODE_TOUTE = ["Toute la période du contrat", "Whole contract period"];
export const periodeSpecifique = (periode) => (periode && !PERIODE_TOUTE.includes(periode) ? periode : "");

// Devine l'unité d'après un texte de brochure (« Par personne », « Par bateau », « 4 à 6 personnes »).
export function uniteDepuisTexte(texte) {
  const t = sansAccents(texte);
  if (/supplementaire|extra person|additional person/.test(t)) return "sup";
  if (/bateau|boat|privatif/.test(t)) return "boat";
  if (/vehicule|voiture|van|car\b/.test(t)) return "veh";
  if (/jour|day/.test(t)) return "day";
  if (/enfant|child/.test(t)) return "ch";
  if (/adulte|adult/.test(t)) return "ad";
  if (/\d\s*(a|-|–)\s*\d+\s*(personnes|pax)|\d+\s*personnes/.test(t)) return "grp";
  if (/personne|person|pax|public/.test(t)) return "pp";
  return "";
}

export const sansAccents = (s) => (s === null || s === undefined ? "" : String(s)).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Tous les mots saisis doivent apparaître dans le texte (recherche sans accents ni casse).
export function correspond(texte, q) {
  const mots = sansAccents(q).split(/\s+/).filter(Boolean);
  if (!mots.length) return true;
  const h = sansAccents(texte);
  return mots.every((m) => h.includes(m));
}

// Marge entre prix de vente et net : montant et pourcentage du prix de vente. Null quand il manque un des deux.
export function marge(vente, net) {
  if (vente === null || vente === undefined || net === null || net === undefined || vente === "" || net === "") return null;
  const v = Number(vente);
  const n = Number(net);
  if (Number.isNaN(v) || Number.isNaN(n)) return null;
  const montant = Math.round((v - n) * 100) / 100;
  return { montant, pct: v ? Math.round(((v - n) / v) * 100) : 0 };
}

// Un trajet sans fenêtre circule toute la période du contrat ; sinon la date doit tomber dans une fenêtre.
export function trajetDisponible(t, dateIso) {
  if (!dateIso) return true;
  const f = Array.isArray(t.fenetres) ? t.fenetres : [];
  if (!f.length) return true;
  return f.some(([debut, fin]) => dateIso >= debut && dateIso <= fin);
}

// Fenêtres de circulation saisies en paires de dates (« du », « au ») : une ligne vide est ignorée, une ligne à moitié remplie ou à l'envers est une erreur
// dite à la personne, jamais ignorée en silence (audit n° 47 : une ligne mal tapée donnait un trajet valable toute l'année).
// Rend { fenetres: [[du, au], …], erreur: "" | "incomplete" | "ordre" | "date", ligne: index de la ligne en cause }.
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
export function lireFenetres(paires) {
  const fenetres = [];
  for (let i = 0; i < paires.length; i++) {
    const du = String(paires[i][0] || "").trim();
    const au = String(paires[i][1] || "").trim();
    if (!du && !au) continue;
    if (!du || !au) return { fenetres: [], erreur: "incomplete", ligne: i };
    if (!DATE_ISO.test(du) || !DATE_ISO.test(au)) return { fenetres: [], erreur: "date", ligne: i };
    if (au < du) return { fenetres: [], erreur: "ordre", ligne: i };
    fenetres.push([du, au]);
  }
  return { fenetres, erreur: "", ligne: -1 };
}

// Ordre des tarifs d'un même groupe : monter ou descendre une prestation échange sa place avec sa voisine. Les ordres égaux ou manquants
// (anciennes données) sont renumérotés à la suite du plus petit, dans l'ordre affiché. Rend la liste des changements { id, ordre } à enregistrer.
export function deplacer(lignes, id, sens) {
  const liste = [...lignes];
  const i = liste.findIndex((x) => x.id === id);
  const j = i + (sens < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= liste.length) return [];
  [liste[i], liste[j]] = [liste[j], liste[i]];
  const base = Math.min(...lignes.map((x) => Number(x.ordre) || 0));
  return liste.map((x, k) => ({ id: x.id, ordre: base + k })).filter((c) => (lignes.find((x) => x.id === c.id) || {}).ordre !== c.ordre);
}

// Ce qui utilise un partenaire, une prestation ou un trajet : les services enregistrés (réservations, annulées comprises).
// Un élément utilisé ne se supprime pas, il se masque (audit n° 14 et 15) : la suppression viderait le lien des réservations,
// le voucher perdrait son opérateur, ses horaires et ses frais de parc, et les statistiques passeraient en « autre ».
export function utilisations({ partenaire = null, prestation = null, trajet = null }, { reservations = [], prestations = [], trajets = [] } = {}) {
  if (prestation) return reservations.filter((r) => r.prestation_id === prestation.id).length;
  if (trajet) return reservations.filter((r) => r.trajet_id === trajet.id).length;
  if (!partenaire) return 0;
  const sesPrestations = new Set(prestations.filter((x) => x.partenaire_id === partenaire.id).map((x) => x.id));
  const sesTrajets = new Set(trajets.filter((x) => x.partenaire_id === partenaire.id).map((x) => x.id));
  return reservations.filter((r) => r.partenaire_id === partenaire.id || sesPrestations.has(r.prestation_id) || sesTrajets.has(r.trajet_id)).length;
}

// Unité proposée à l'ouverture du formulaire : celle de la prestation (« sans unité » compris, audit n° 11) ; pour une nouvelle,
// « par véhicule » en Taxi (une course se paie à la voiture, audit n° 20), « par personne » ailleurs.
export const uniteInitiale = (x, taxi = false) => (x && x.id ? x.unite || "" : (x && x.unite) || (taxi ? "veh" : "pp"));
export const familleInitiale = (x, taxi = false) => (x && x.famille) || (taxi ? "transfert" : "excursion");

export const lieux = (trajets) => [...new Set(trajets.flatMap((t) => [t.de, t.vers]))].filter(Boolean).sort((a, b) => a.localeCompare(b, "fr"));

// Un partenaire masqué (inactif) : ses tarifs et ses trajets ne se proposent plus pour une nouvelle saisie (16.11.2026, audit n° 16).
export const partenaireInactif = (id, partenaires = []) => !!id && partenaires.some((p) => p.id === id && p.actif === false);
// Une prestation ou un trajet qu'on peut proposer pour une nouvelle saisie : actif, et d'un partenaire actif (ou sans partenaire).
export const proposable = (x, partenaires = []) => !!x && x.actif !== false && !partenaireInactif(x.partenaire_id, partenaires);

// `avecInactifs` : l'écran Trajets montre aussi les trajets masqués (en gris) pour les retrouver et les réactiver ; ailleurs, seuls les trajets proposables.
export function filtrerTrajets(trajets, { de = "", vers = "", partenaireId = "", date = "", q = "", nomPartenaire = () => "", partenaires = [], avecInactifs = false } = {}) {
  return trajets
    .filter((t) => avecInactifs || proposable(t, partenaires))
    .filter((t) => (!de || t.de === de) && (!vers || t.vers === vers) && (!partenaireId || t.partenaire_id === partenaireId) && trajetDisponible(t, date))
    .filter((t) => correspond([t.de, t.vers, t.mode, t.depart, t.arrivee, t.periode, nomPartenaire(t.partenaire_id)].join(" "), q))
    .sort((a, b) => `${a.de}${a.vers}`.localeCompare(`${b.de}${b.vers}`, "fr") || (a.depart || "").localeCompare(b.depart || ""));
}

// Pour un départ et une arrivée donnés : les trajets au net adulte le plus bas, seulement quand les compagnies
// n'ont pas le même minimum (sinon le repère n'apporte rien). `netDe(t)` renvoie le net adulte ou null.
export function meilleursNets(trajets, netDe) {
  const parCie = new Map();
  for (const t of trajets) {
    const n = netDe(t);
    if (n === null || n === undefined) continue;
    parCie.set(t.partenaire_id, Math.min(parCie.get(t.partenaire_id) ?? Infinity, Number(n)));
  }
  const minima = [...parCie.values()];
  if (minima.length < 2 || new Set(minima).size < 2) return new Set();
  const min = Math.min(...minima);
  return new Set(trajets.filter((t) => Number(netDe(t)) === min).map((t) => t.id));
}

// Résumé par compagnie d'une liste de trajets déjà filtrés : nombre de départs, heures, prix adulte le plus bas.
export function resumeParCompagnie(trajets, netDe) {
  const out = new Map();
  for (const t of trajets) {
    const r = out.get(t.partenaire_id) || { partenaire_id: t.partenaire_id, departs: 0, heures: new Set(), vente: Infinity, net: Infinity };
    r.departs++;
    if (t.depart) r.heures.add(t.depart.slice(0, 5));
    if (t.prix_adulte !== null && t.prix_adulte !== undefined) r.vente = Math.min(r.vente, Number(t.prix_adulte));
    const n = netDe(t);
    if (n !== null && n !== undefined) r.net = Math.min(r.net, Number(n));
    out.set(t.partenaire_id, r);
  }
  return [...out.values()].map((r) => ({ ...r, heures: [...r.heures].sort(), vente: Number.isFinite(r.vente) ? r.vente : null, net: Number.isFinite(r.net) ? r.net : null }));
}

// Contrats qui arrivent à échéance dans `jours` jours (ou déjà passés), pour l'écran Aujourd'hui.
export function contratsAEcheance(partenaires, ajd, jours = 30) {
  const limite = ajouter(ajd, jours);
  return partenaires
    .filter((p) => p.actif !== false && p.contrat && p.contrat.fin && p.contrat.fin <= limite)
    .map((p) => ({ partenaire: p, fin: p.contrat.fin, passe: p.contrat.fin < ajd }))
    .sort((a, b) => a.fin.localeCompare(b.fin));
}

// ---- Libellé pour le client ----------------------------------------------------------------------------------
// Les libellés importés viennent des brochures en français, avec des notes internes (« Base 1-2 pers », thaï entre
// parenthèses, « Adulte » en fin de ligne). Le client reçoit un libellé propre, en anglais, sans ces notes.
const TRADUCTIONS = [
  [/\s*\([^()]*[฀-๿][^()]*\)/g, ""],
  [/\bTour Partagé \(Join\)/gi, "Join tour"],
  [/\bTour Partagé \(Speedboat\)/gi, "Join speedboat tour"],
  [/\bPrivatisation \(Charter\)/gi, "Private charter"],
  [/\bPrivatisation Speedboat\b/gi, "Private speedboat"],
  [/\bPrivé \(Radeau Bois\)/gi, "Private wooden raft"],
  [/\bOption Supplément\b/gi, "Option"],
  [/\bPrivatisation\b/g, "Private"],
  [/\bExcursion d'une journée\b/gi, "Full-day trip"],
  [/\bExcursion d'une demi-journée\b/gi, "Half-day trip"],
  [/\bfrontière malaisienne\b/gi, "Malaysian border"],
  // Tout le lieu jusqu'à une virgule, une parenthèse ou la fin (« Association des taxis de Koh Lanta » → « Koh Lanta Taxi Association »).
  [/\bAssociation des taxis de ([^,()]+?)(?=\s*[,(]|\s*$)/gi, "$1 Taxi Association"],
  [/\bdécouverte de\b/gi, "discovery of"],
  [/\bvan partagé/gi, "shared van"],
  [/\bAéroport de Hat ?yai\b/gi, "Hat Yai Airport"],
  [/\bAéroport de Krabi\b/gi, "Krabi Airport"],
  [/\bAéroport de Trang\b/gi, "Trang Airport"],
  [/\bvisa run\b/gi, "visa run"],
  [/\bExtension Koh Kradan sur tour 4 îles privé/gi, "Koh Kradan extension on the private 4 Islands tour"],
  [/\bAu choix\s*:\s*/gi, ""],
  [/\s+OU\s+/g, " or "],
  [/4 Îles/gi, "4 Islands"],
  [/\bÎles?\b/g, "Islands"],
  [/\bCoucher de soleil & Vin\b/gi, "sunset & wine"],
  [/\bCoucher de soleil\b/gi, "sunset"],
  [/\bLever de soleil dans la mangrove\b/gi, "sunrise in the mangrove"],
  [/\bLever de soleil\b/gi, "sunrise"],
  [/,?\s*Base 1-2 pers\b/gi, ", for 1 to 2 people"],
  [/,?\s*Personne supplémentaire\b/gi, ", extra person"],
  [/,?\s*À partir de (\d+) personnes\b/gi, ", from $1 people"],
  [/\((\d+) heures?\)/gi, "($1 hours)"],
  [/\b(\d+) Heures?\b/gi, "$1 hour"],
  [/\bProgramme\b/g, "Program"],
  [/\bSanctuaire Éléphants\b/gi, "Elephant sanctuary"],
  [/\bQuad Tout-Terrain\b/gi, "ATV"],
  [/\bQuad & Kayak Mangrove\b/gi, "ATV & mangrove kayak"],
  [/\bKarting Électrique\b/gi, "Electric go-kart"],
  [/\(Zone circuit sécurisée\)/gi, "(safe track)"],
  [/\(Forêt & Point de vue panoramique\)/gi, "(forest & viewpoint)"],
  [/\(1 place enfant\/ado\)/gi, "(single seat, child or teen)"],
  [/\(2 places format compact\)/gi, "(compact double seat)"],
  [/\(1 place adulte grand format\)/gi, "(large single seat)"],
  [/\(2 places adulte biplace\)/gi, "(large double seat)"],
  [/\bSculpture sur fruits et légumes\b/gi, "Fruit and vegetable carving"],
  [/\bMarché et déjeuner\b/gi, "Market visit and lunch class"],
  [/\bDîner\b/g, "Dinner class"],
  [/\bConducteur\b/g, "driver"],
  [/\bPassager\b/g, "passenger"],
  [/,?\s*Tout public\b/gi, ""],
  [/\bEnfant \((\d+)-(\d+) ans\)/gi, "child ($1-$2)"],
  [/,?\s*Adulte\b/g, ""],
  [/\bEnfant\b/g, "child"],
  [/\bAéroport de Hatyai\b/gi, "Hat Yai Airport"],
  [/\bAéroport de (\w+)/gi, "$1 Airport"],
  [/\bAéroport et ville de Phuket\b/gi, "Phuket Airport and town"],
  [/\bPakbara pier\b/gi, "Pakbara Pier"],
  [/\bTour de l'île en une journée\b/gi, "Island tour, full day"],
  [/\bvers\b/g, "to"],
  [/\(Phra Ae Nord\)/gi, "(Phra Ae North)"],
  [/\(Centre plage\)/gi, "(beach centre)"],
  [/\b(\d+) places\b/gi, "$1 seats"],
  [/\((\d+)\s*(?:à|-|–)\s*(\d+) personnes\)/gi, "($1 to $2 people)"],
  [/\b(\d+)\s*(?:à|-|–)\s*(\d+) personnes\b/gi, "$1 to $2 people"],
  [/\bpersonnes\b/g, "people"],
  [/\bpersonne\b/g, "person"],
  [/\bMinivan privé\b/gi, "Private minivan"],
  [/\bBerline privée\b/gi, "Private car"],
  [/\bNavette partagée\b/gi, "Shared minivan"],
  [/\bdemi-journée(?![\p{L}])/giu, "half day"],
  [/\bjournée\b/g, "full day"],
  // Trajets : horaires de départ, gares, ferries. Ces textes s'impriment sur les vouchers, qui sont toujours en anglais.
  [/\bMinivan partagé, dépose à l'hôtel comprise\b/gi, "Shared minivan, hotel drop-off included"],
  [/\bdépose à l'hôtel comprise\b/gi, "hotel drop-off included"],
  [/\bMinivan partagé(?![\p{L}])/giu, "Shared minivan"],
  [/\(le bus de (\d+) (?:places|seats) part de la gare routière de ([^()]+?) à ([^()]+)\)/gi, "(the $1-seat bus leaves $2 bus station at $3)"],
  [/\(départ de la gare routière de ([^()]+?) à ([^()]+)\)/gi, "(departs from $1 bus station at $2)"],
  [/\(départ (?:de |d')([^()]+?) à ([^()]+)\)/gi, "(departs from $1 at $2)"],
  [/\bgare routière\b/gi, "bus station"],
  [/\bgare\b/gi, "station"],
  [/\bville\b/gi, "city"],
  [/\baéroport\b/gi, "airport"],
  // « par ferry » et « par » suivi d'une compagnie connue de l'entreprise (ses partenaires et `reglages.compagnies`, voir reglerCompagnies) : « by … ».
  [() => regexCompagnies, "by $1"],
  [/,?\s*par person(?:ne)?\b/gi, ", per person"],
  [/\s+ou\s+/g, " or "],
  // Plongée, locations et programmes.
  [/\b1 plongée\b/gi, "1 dive"],
  [/\b(\d+) plongées\b/gi, "$1 dives"],
  [/\bPlongée supplémentaire\b/gi, "Extra dive"],
  [/\bsur le bateau de plongée(?![\p{L}])/giu, "on the dive boat"],
  [/\bplongées?\b/gi, "dive"],
  [/\bdès (\d+) ans\b/gi, "from age $1"],
  [/\bde moins de (\d+) ans\b/gi, "under $1 years old"],
  [/\bgros bateau\b/gi, "big boat"],
  [/\bajouté à un trip local\b/gi, "added to a local trip"],
  [/\ben plus des (\d+) premières people\b/gi, "beyond the first $1 people"],
  [/\ben plus d'une sortie spéciale\b/gi, "on top of a special trip"],
  [/\bNanny à bord pour vos enfants\b/gi, "Nanny on board for your children"],
  [/\bLocation d'un ordinateur de plongée\b/gi, "Dive computer rental"],
  [/\bLocation d'un bloc nitrox (\d+) L\b/gi, "Nitrox tank rental, $1 L"],
  [/\bLocation d'une GoPro Hero et accessoires\b/gi, "GoPro Hero rental with accessories"],
  [/\(ordinateur requis\)/gi, "(dive computer required)"],
  [/\bSpécialité (\w+)/gi, "$1 specialty"],
  [/\bthéorie seulement\b/gi, "theory only"],
  [/\b1 jour\b/gi, "1 day"],
  [/\b(\d+) jours\b/gi, "$1 days"],
  [/\bpêche\b/gi, "fishing"],
  [/\(retour (\d+h\d+)\)/gi, "(back at $1)"],
  [/\s*[,;]\s*$/g, ""],
  [/\s{2,}/g, " "],
  // En dernier, pour ne pas casser les règles qui contiennent « et ».
  [/(\S)\s+et\s+(\S)/g, "$1 and $2"],
];
export function libelleClient(libelle) {
  let t = String(libelle || "");
  for (const [re, par] of TRADUCTIONS) t = t.replace(typeof re === "function" ? re() : re, par);
  return t.trim();
}

// Compagnies que « par X » traduit en « by X » (migration 43) : les noms des partenaires de l'entreprise active et la liste de ses réglages
// (`reglages.compagnies`, pour une compagnie citée dans les libellés sans être partenaire). Aucun nom écrit dans le code. Réglé par etat.mjs à
// chaque changement d'entreprise ou de données ; sans appel, seul « par ferry » se traduit.
const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let regexCompagnies = /\bpar (ferry)(?![\p{L}])/giu;
export function reglerCompagnies(noms = []) {
  const liste = [...new Set((noms || []).map((n) => String(n || "").trim()).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length).map(echapper);
  regexCompagnies = new RegExp(`\\bpar (ferry${liste.length ? `|${liste.join("|")}` : ""})(?![\\p{L}])`, "giu");
}

// ---- Lignes de devis depuis une prestation ou un trajet ------------------------------------------------------
// La ligne garde la prestation, le partenaire, le net et la date du service : le document reste lisible seul
// (le net n'est visible que par qui lit le document, donc qui a déjà le droit « montants »).
const nouvelId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const texteMontant = (n, devise) => `${Number(n).toLocaleString("fr-CH").replace(/ | |,/g, "'")} ${devise}`;

// Note « à régler sur place » d'un frais que le client paie lui-même (droit de parc, entrée). Le montant n'est écrit que s'il est connu, avec l'unité
// du tarif (par adulte, par personne, par véhicule…) ; le prix enfant (`details.enfant`) ne s'ajoute qu'à un tarif par adulte ou par personne.
// Sans prix : « à régler sur place », sans montant (16.11.2026 : une prestation sans prix sortait « 0 THB per adult »).
const montantConnu = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) > 0;
export function noteSurPlace(x, langue = "", devise = "THB") {
  const d = x.details || {};
  const en = langue === "en";
  const lib = en ? x.libelle_en || x.libelle : x.libelle;
  const unite = libelleUnite(x.unite || "", en);
  const prix = montantConnu(x.prix_vente) ? `${texteMontant(x.prix_vente, devise)}${unite ? ` ${unite}` : ""}` : "";
  const enfant = prix && ["ad", "pp"].includes(x.unite) && montantConnu(d.enfant) ? `${en ? " and" : " et"} ${texteMontant(d.enfant, devise)} ${libelleUnite("ch", en)}` : "";
  if (en) return `To be paid on site in cash: ${lib}${prix ? `, ${prix}${enfant}` : ""}. Never included by the operators.`;
  return `À régler sur place, en espèces : ${lib}${prix ? `, ${prix}${enfant}` : ""}. Jamais inclus par les prestataires.`;
}

// Net d'une ligne : le net du tarif ; pour la ligne enfant d'une prestation qui porte son « Prix enfant » (`enfant_de`), le net enfant
// (audit n° 19 : il s'enregistrait sans jamais être lu). Pas de net enfant connu : aucun net, plutôt que le net adulte.
const valeur = (v) => (v !== null && v !== undefined && v !== "" ? Number(v) : null);
export const netDeLigne = (x, net) => (!net ? null : x && x.enfant_de ? valeur(net.net_enfant) : valeur(net.net));

export function ligneDepuisPrestation(x, net, { langue = "", date = "", qte = 1, devise = "THB", uid = nouvelId } = {}) {
  const en = langue === "en";
  const base = { id: uid(), intro: "", puces: [], unite: null, qte: null, montant: null, pct: null, prestation_id: x.id, partenaire_id: x.partenaire_id || null, date_service: date || null };
  if (x.sur_place) return { ...base, kind: "texte", libelle: noteSurPlace(x, langue, devise), sur_place: true };
  // En anglais : le libellé anglais de la prestation, sinon le libellé nettoyé et traduit pour le client.
  // `par` garde l'unité du tarif (grp, boat, sup…) : l'intro est vidée dans la facture, et un prix de groupe ne se met pas à l'échelle des personnes.
  // Prestation à 0 au catalogue : offerte au client (décision 8, contrôle du 17.11.2026, D7). La ligne compte 0 et s'imprime « Offert » / « Complimentary ».
  const offert = x.prix_vente !== null && x.prix_vente !== undefined && x.prix_vente !== "" && Number(x.prix_vente) === 0 ? { offert: true } : {};
  return { ...base, ...offert, ...(x.unite === "sup" ? { supplement: true } : {}), ...(["boat", "veh", "day", "ses", "grp"].includes(x.unite) ? { par: x.unite } : {}), kind: "ligne", libelle: en ? x.libelle_en || libelleClient(x.libelle) : x.libelle, intro: x.unite ? `(${libelleUnite(x.unite, en)})` : "", unite: x.prix_vente, qte: x.unite === "sup" ? Math.max(0, Number(qte) || 0) : Number(qte) || 1, net: netDeLigne(x, net) };
}

// ---- Options d'un service (26.11.2026) ---------------------------------------------------------------------------------
// Une prestation peut être l'option d'une ou plusieurs autres (« Koh Kradan extension » du 4 Islands privé, une lunch box, un transfert
// d'hôtel) : `prestations.option_de` (migration 130) liste les prestations qu'elle complète. Elle ne se vend pas seule : elle se choisit sous
// son service. Sur la facture, l'option est une ligne à elle (son prix, son net), rattachée à la ligne du service par `option_de` (l'id de
// cette ligne) : une seule réservation, un seul voucher, le total du service = base + options.
export const estPrestationOption = (p) => !!p && Array.isArray(p.option_de) && p.option_de.length > 0;
export const estLigneOption = (l) => !!l && typeof l.option_de === "string" && l.option_de !== "";
// Les options proposables d'une prestation, dans l'ordre du catalogue.
export const optionsDe = (prestationId, prestations = [], partenaires = []) =>
  !prestationId ? [] : (prestations || []).filter((o) => estPrestationOption(o) && o.option_de.includes(prestationId) && proposable(o, partenaires)).sort((a, b) => (a.ordre || 0) - (b.ordre || 0) || String(a.libelle).localeCompare(String(b.libelle)));
// La ligne d'une option sous la ligne `parent` du service : même partenaire, même date, même mode de règlement, mêmes participants. Une
// option par personne compte les personnes du service ; les autres comptent 1. `prix` : le prix total de l'option, s'il remplace celui du
// catalogue (modifiable comme le prix du service).
// `unitaire` : le prix unitaire tapé (par bateau, par personne…), `prix` : le prix total de l'option ; l'un ou l'autre remplace le catalogue.
export function ligneOption(o, parent, net, { langue = "", personnes = null, prix = null, unitaire = null, uid = nouvelId } = {}) {
  const p = personnes || parent.personnes || {};
  const nbPers = Math.max(0, Math.floor(Number(p.adultes) || 0)) + Math.max(0, Math.floor(Number(p.enfants) || 0));
  const qte = ["pp", "ad"].includes(o.unite) ? Math.max(1, nbPers || Number(parent.qte) || 1) : 1;
  const l = ligneDepuisPrestation(o, net, { langue, date: parent.date_service || "", qte, uid });
  const out = { ...l, option_de: parent.id, partenaire_id: parent.partenaire_id || o.partenaire_id || null, ...(parent.paye_sur_place !== undefined ? { paye_sur_place: !!parent.paye_sur_place } : {}) };
  if (unitaire !== null && unitaire !== undefined && unitaire !== "" && Number.isFinite(Number(unitaire))) {
    Object.assign(out, { unite: Math.round(Number(unitaire) * 100) / 100, montant: null });
    delete out.offert;
    if (Number(unitaire) === 0) out.offert = true;
  } else if (prix !== null && prix !== undefined && prix !== "" && Number.isFinite(Number(prix))) {
    const total = Math.round(Number(prix) * 100) / 100;
    const unitaire = Math.round((total / qte) * 100) / 100;
    if (Math.round(unitaire * qte * 100) === Math.round(total * 100)) Object.assign(out, { unite: unitaire, montant: null });
    else Object.assign(out, { unite: null, montant: total });
    delete out.offert;
    if (total === 0) out.offert = true;
  }
  return out;
}

// Prestation hors base : une ligne saisie à la main qui a pourtant sa réservation (donc son voucher), repérée par `libre`.
// `par` (18.11.2026) : "grp", prix total du groupe (quantité 1), ou "pp", prix par personne (quantité = participants, modifiable). Absent : la
// lecture d'avant (quantité de personnes). `personnes` : { adultes, enfants } qui viennent, gardés à part de la quantité facturée.
export function ligneLibre({ libelle, prix, qte = 1, partenaire_id = null, date = "", par = "", personnes = null }, { uid = nouvelId } = {}) {
  const a = personnes ? Math.max(0, Math.floor(Number(personnes.adultes) || 0)) : 0;
  const e = personnes ? Math.max(0, Math.floor(Number(personnes.enfants) || 0)) : 0;
  return { id: uid(), kind: "ligne", libre: true, libelle: String(libelle).trim(), intro: "", puces: [], unite: Number(prix), qte: par === "grp" ? 1 : Number(qte) || 1, montant: null, pct: null, prestation_id: null, trajet_id: null, partenaire_id: partenaire_id || null, date_service: date || null, net: null, ...(par === "grp" || par === "pp" ? { par } : {}), ...(a + e ? { personnes: { adultes: a, enfants: e } } : {}) };
}

// Un trajet donne une ligne par adulte et, s'il y a des enfants et un prix enfant, une ligne enfant.
// `compagnie` vide : le prestataire n'est pas répété dans le libellé (il figure déjà sur la facture de Secret).
// « Van partagé + speedboat » → « Shared van + speedboat », avec une majuscule au début.
export const modeEn = (mode) => { const m = libelleClient(mode || "Boat"); return m.charAt(0).toUpperCase() + m.slice(1); };
export function lignesDepuisTrajet(t, net, { langue = "", date = "", adultes = 1, enfants = 0, compagnie = "", uid = nouvelId } = {}) {
  const en = langue === "en";
  // Document en anglais : les lieux passent aussi par la traduction (« Hatyai (aéroport) » devient « Hatyai (airport) »).
  const de = en ? libelleClient(t.de) : t.de;
  const vers = en ? libelleClient(t.vers) : t.vers;
  const titre = en ? `${modeEn(t.mode)} transfer: ${de} → ${vers}, departure ${t.depart}${compagnie ? ` with ${compagnie}` : ""}` : `${t.mode || "Bateau"} ${t.de} → ${t.vers}, départ ${t.depart}${compagnie ? ` avec ${compagnie}` : ""}`;
  const base = { intro: "", puces: [], montant: null, pct: null, trajet_id: t.id, partenaire_id: t.partenaire_id || null, date_service: date || null };
  const out = [];
  if (Number(adultes) > 0) out.push({ ...base, id: uid(), kind: "ligne", libelle: titre, intro: `(${en ? "per adult" : "par adulte"})`, unite: t.prix_adulte, qte: Number(adultes), net: net && net.net_adulte !== null && net.net_adulte !== undefined ? Number(net.net_adulte) : null });
  if (Number(enfants) > 0 && t.prix_enfant !== null && t.prix_enfant !== undefined) out.push({ ...base, id: uid(), kind: "ligne", libelle: `${titre}, ${en ? "child" : "enfant"}`, intro: `(${en ? "per child" : "par enfant"})`, unite: t.prix_enfant, qte: Number(enfants), net: net && net.net_enfant !== null && net.net_enfant !== undefined ? Number(net.net_enfant) : null });
  return out;
}

// Marge d'un document : son total moins les nets connus des lignes de partenaires.
// `sansNet` compte les lignes à montant dont le net n'est pas connu : la marge affichée est alors un plafond.
export function margeDocument(contenu, totalDocument) {
  const lignes = (contenu && contenu.lignes) || [];
  const brut = (l) => (l.unite !== null && l.unite !== undefined && l.qte !== null && l.qte !== undefined && l.unite !== "" && l.qte !== "" ? Number(l.unite) * Number(l.qte) : l.montant !== null && l.montant !== undefined && l.montant !== "" ? Number(l.montant) : 0);
  let nets = 0;
  let sansNet = 0;
  let avecNet = 0;
  for (const l of lignes) {
    // Une ligne payée sur place au prestataire n'a ni vente ni net chez nous : sa commission se suit dans « Commissions à recevoir ».
    if (l.kind === "texte" || l.kind === "remise" || l.paye_sur_place) continue;
    if (l.net !== null && l.net !== undefined && (l.prestation_id || l.trajet_id)) {
      nets += Number(l.net) * (l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.qte) : 1);
      avecNet++;
    } else if (brut(l) > 0) sansNet++;
  }
  const vente = totalDocument !== undefined ? Number(totalDocument) : lignes.filter((l) => l.kind !== "texte" && l.kind !== "remise" && !l.paye_sur_place).reduce((s, l) => s + brut(l), 0);
  const marge = Math.round((vente - nets) * 100) / 100;
  return { vente, nets: Math.round(nets * 100) / 100, marge, pct: vente ? Math.round((marge / vente) * 100) : 0, avecNet, sansNet };
}

function ajouter(iso, n) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Une seule normalisation des numéros, pour les liens d'appel et WhatsApp. Renvoie { numero: "+41791234567" | "", raison: "" | "vide" | "trop_court" | "sans_indicatif" }.
// Un numéro commençant par 0 n'a pas d'indicatif : il n'est jamais deviné pour un client (« sans_indicatif »). Seuls les numéros de partenaires thaïs au
// format local (« 081-9789025 » devient +66819789025) passent avec `{ thaiLocal: true }`.
export function normaliserTelephone(brut, { thaiLocal = false } = {}) {
  const texte = String(brut || "");
  const m = texte.match(/\+?\d[\d\s\-()]{6,}\d/);
  if (!m) return { numero: "", raison: /\d/.test(texte) ? "trop_court" : "vide" };
  const d = m[0].replace(/[^\d+]/g, "");
  if (d[0] === "+") return { numero: d, raison: "" };
  if (d.startsWith("00")) return { numero: `+${d.slice(2)}`, raison: "" };
  if (d[0] === "0") return thaiLocal ? { numero: `+66${d.slice(1)}`, raison: "" } : { numero: "", raison: "sans_indicatif" };
  // Indicatif écrit sans le plus (« 41 79 123 45 67 », « 66819789025 ») : le numéro est déjà international.
  return { numero: `+${d}`, raison: "" };
}

// Le numéro seulement, sous la forme « +41791234567 » (vide quand il manque l'indicatif ou que le numéro est illisible). `thaiLocal` : numéros de partenaires thaïs.
export const chiffres = (numero, options) => normaliserTelephone(numero, options).numero;

// Numéro WhatsApp d'un partenaire : le premier marqué WhatsApp, sinon le premier numéro.
export function telWhatsApp(p) {
  const t = (p && p.contact && p.contact.telephones) || [];
  const w = t.find((x) => x.whatsapp) || t[0];
  return w ? w.numero : "";
}

// Commissions et mode de paiement d'un partenaire : données privées (migration 16), réservées à qui voit les nets (`prive` est alors renseigné).
// Avant la migration, elles sont encore dans les règles publiques : on les lit de là pour ne rien faire disparaître.
// `autorise` : la personne a le droit de voir les nets (sans lui, rien n'est rendu). Par défaut, `prive` renseigné.
export const commissionsPartenaire = (p, prive, autorise = !!prive) => (!autorise ? [] : prive && Array.isArray(prive.commissions) && prive.commissions.length ? prive.commissions : (p.regles && p.regles.commissions) || []);
export const paiementPartenaire = (p, prive, autorise = !!prive) => (!autorise ? "" : (prive && prive.paiement) || (p.regles && p.regles.paiement) || "");

// Décision 3 du 17.11.2026, étendue à la réservation et à la facture (contrôle du 17.11.2026, D3) : sans le droit « partenaires.prix », un prix
// venu du catalogue ne se change pas (« Vendu au client » d'une réservation, prix ou montant d'une ligne qui vient d'un tarif). Un prix vide
// (tarif « prix à saisir ») ou un service hors catalogue se remplit toujours. `x` : une réservation ({ prestation_id, trajet_id, montant_vente })
// ou une ligne de document ({ prestation_id, trajet_id, unite, montant }). `catalogue` : { prestations, trajets }. Renvoie vrai si le prix est figé.
const prixConnu = (v) => v !== null && v !== undefined && v !== "";
export function prixVenteFige(x, catalogue, { droitPrix = false } = {}) {
  if (droitPrix || !x) return false;
  const actuel = "montant_vente" in x ? x.montant_vente : prixConnu(x.unite) ? x.unite : x.montant;
  if (!prixConnu(actuel)) return false;
  if (x.trajet_id) {
    const t = ((catalogue && catalogue.trajets) || []).find((y) => y.id === x.trajet_id);
    return !!t && prixConnu(t.prix_adulte);
  }
  if (x.prestation_id) {
    const p = ((catalogue && catalogue.prestations) || []).find((y) => y.id === x.prestation_id);
    return !!p && !p.sur_place && prixConnu(p.prix_vente);
  }
  return false;
}
