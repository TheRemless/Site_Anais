// Temps de trajet de l'agent (décision de Jérémy du 19.11.2026 : pas de Google Maps). Logique pure, sans dépendance.
// D'où vient la durée d'un trajet en voiture, dans cet ordre (Jérémy, 19.11.2026 : « fie-toi plutôt à OpenStreetMap, c'est plus précis ») :
//   1. openrouteservice (ORS, OpenStreetMap, gratuit), avec la marge conseillée de la ligne de la table s'il y en a une ; ce qu'ORS a compris
//      de chaque lieu est toujours montré ;
//   2. sinon (pas de clé, lieu introuvable, quota) la table de référence de l'entreprise (temps_trajets), ligne confirmée ;
//   3. sinon une ligne de la table encore « à vérifier » (pré-remplie) ;
//   4. sinon rien : l'agent le dit et demande la durée. En dernier recours, une estimation par la recherche web, marquée comme telle.
// Jamais de durée inventée. Rien d'un client ne part chez ORS : seulement des noms de lieux ou des coordonnées.
//
// Ce fichier existe en deux exemplaires identiques : supabase/functions/agent/temps.js et src/gestion/js/agent-temps.mjs (écran de la table).

export const sansAccents = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Mots d'un lieu, sans les mots qui ne le distinguent pas (« Koh », « Island ») ; « aéroport » s'écrit « airport », « ville » « town ».
const SYNONYMES = { aeroport: "airport", ville: "town", hopital: "hospital", embarcadere: "pier", jetee: "pier", ko: "koh" };
export function motsLieu(s) {
  return sansAccents(s)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((w) => SYNONYMES[w] || w)
    .filter((w) => w && !["koh", "island", "isl", "the", "de", "du", "la", "le", "of", "international", "intl"].includes(w));
}
// Les mots rangés : « aéroport de Krabi » et « Krabi Airport » ont la même clé.
export const cleZone = (s) => [...new Set(motsLieu(s))].sort().join(" ");
// Clé d'une paire, la même dans les deux sens : une ligne « Koh Lanta → Krabi Airport » sert aussi au retour.
export const clePaire = (a, b) => [cleZone(a), cleZone(b)].sort().join(" | ");

// La zone de la table qui correspond le mieux à un lieu : tous les mots de la zone sont dans le lieu, la zone la plus précise l'emporte
// (« Krabi Airport » plutôt que « Krabi » pour « Krabi International Airport »). Un hôtel connu (hotels_lieux) passe par sa zone puis son lieu.
export function zoneDuLieu(lieu, zones = [], hotels = []) {
  const candidats = [String(lieu || "")];
  const brut = sansAccents(lieu).replace(/[^a-z0-9]+/g, " ").trim();
  const h = hotels.find((x) => x.cle && brut.includes(x.cle));
  if (h) candidats.push(`${h.zone || ""} ${h.lieu || ""}`.trim(), h.lieu || "");
  let meilleure = null;
  for (const texte of candidats) {
    const mots = new Set(motsLieu(texte));
    for (const z of zones) {
      const mz = motsLieu(z);
      if (mz.length && mz.every((w) => mots.has(w)) && (!meilleure || mz.length > motsLieu(meilleure).length)) meilleure = z;
    }
    if (meilleure) return meilleure;
  }
  return null;
}

// Les zones de la table (côté « de » et « vers » des lignes en voiture).
export const zonesDeLaTable = (lignes = []) => [...new Set(lignes.filter((l) => (l.mode || "route") === "route").flatMap((l) => [l.de, l.vers]))];

// La ligne de la table pour deux lieux, dans un sens ou dans l'autre, ou null.
export function ligneDeLaTable(de, vers, lignes = [], hotels = []) {
  const route = lignes.filter((l) => (l.mode || "route") === "route");
  const zones = zonesDeLaTable(route);
  const zd = zoneDuLieu(de, zones, hotels);
  const zv = zoneDuLieu(vers, zones, hotels);
  if (!zd || !zv) return null;
  const cle = clePaire(zd, zv);
  return route.find((l) => clePaire(l.de, l.vers) === cle) || null;
}

// Choisit la durée d'un trajet. `ors(de, vers)` : { duree_min, distance_km, ferry, de_trouve, vers_trouve } ou null (sans clé, quota, lieu introuvable).
// `simule(de, vers)` : temps de démonstration, seulement si la fonction l'autorise. Rend { duree_min, ferry, marge_min, source, a_verifier, … } ou null.
export async function dureeEntre(de, vers, { lignes = [], hotels = [], ors = null, simule = null, coords = null } = {}) {
  const l = ligneDeLaTable(de, vers, lignes, hotels);
  const deLigne = (x, a_verifier) => ({ duree_min: x.duree_min, ferry: !!x.ferry, marge_min: x.marge_min || 0, source: a_verifier ? "table_a_verifier" : "table", a_verifier, ligne: { de: x.de, vers: x.vers, source: x.source || "", source_date: x.source_date || "" } });
  const r = ors ? await ors(de, vers, coords) : null;
  if (r && r.duree_min > 0) return { duree_min: r.duree_min, distance_km: r.distance_km ?? null, ferry: !!(r.ferry || (l && l.ferry)), marge_min: l ? l.marge_min || 0 : 0, source: "ors", a_verifier: false, de_trouve: r.de_trouve || "", vers_trouve: r.vers_trouve || "" };
  if (l && !l.a_verifier && l.duree_min > 0) return deLigne(l, false);
  if (l && l.duree_min > 0) return deLigne(l, true);
  const s = simule ? simule(de, vers) : null;
  return s ? { ...s, marge_min: 0, a_verifier: true } : null;
}

// ---- Ferry : trois morceaux (règle de Jérémy du 19.11.2026) --------------------------------------------------------------------------
// Un trajet dont un seul bout est sur l'île d'une liaison de ferry se calcule toujours en trois morceaux : route jusqu'au port de départ,
// ferry à durée fixe (traversée et attente comprises, 60 min par défaut, réglée par liaison dans la table), route depuis le port d'arrivée.
// Les ports et la liaison sont des données de la table (liaisons_ferry), jamais une supposition du modèle. La marge vient ensuite (planifier.js).

export const FERRY_DEFAUT_MIN = 60;

// « 7.6213, 99.0402 » → { lat, lon } ; autre chose → null.
export function coordDe(texte) {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(String(texte || ""));
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

// La liaison à prendre entre deux lieux : celle dont l'île porte un seul des deux bouts. Rend { liaison, depuisIle } ou null.
export function liaisonPour(de, vers, liaisons = [], hotels = []) {
  for (const l of liaisons) {
    if (!l || !l.cote_ile) continue;
    const a = !!zoneDuLieu(de, [l.cote_ile], hotels);
    const b = !!zoneDuLieu(vers, [l.cote_ile], hotels);
    if (a !== b) return { liaison: l, depuisIle: a };
  }
  return null;
}

// Du moins sûr au plus sûr : la source affichée pour un trajet en morceaux est celle de son morceau le moins sûr.
const FIABILITE = ["simulation", "estimation_web", "table_a_verifier", "personne", "table", "ors"];
const moinsSure = (sources) => sources.slice().sort((a, b) => FIABILITE.indexOf(a) - FIABILITE.indexOf(b))[0];

// La durée d'un trajet, en trois morceaux s'il passe par un ferry de la table. Rend la durée (route seule dans duree_min, ferry dans
// ferry_fixe_min, et le détail dans « morceaux »), { manque: "A → B" } quand un morceau n'a pas de durée, ou null sans aucune durée.
export async function dureeAvecFerry(de, vers, opts = {}) {
  const lf = liaisonPour(de, vers, opts.liaisons || [], opts.hotels || []);
  if (!lf) return dureeEntre(de, vers, opts);
  const l = lf.liaison;
  const [portDepart, portArrivee] = lf.depuisIle ? [l.port_ile, l.port_continent] : [l.port_continent, l.port_ile];
  const [coordDepart, coordArrivee] = (lf.depuisIle ? [l.port_ile_coord, l.port_continent_coord] : [l.port_continent_coord, l.port_ile_coord]).map(coordDe);
  const avant = await dureeEntre(de, portDepart, { ...opts, coords: coordDepart ? { vers: coordDepart } : null });
  if (!avant) return { manque: `${de} → ${portDepart}` };
  const apres = await dureeEntre(portArrivee, vers, { ...opts, coords: coordArrivee ? { de: coordArrivee } : null });
  if (!apres) return { manque: `${portArrivee} → ${vers}` };
  const ferry = Number(l.duree_min) > 0 ? Math.round(Number(l.duree_min)) : FERRY_DEFAUT_MIN;
  const morceau = (de_, vers_, r) => ({ genre: "route", de: de_, vers: vers_, duree_min: r.duree_min, source: r.source, a_verifier: !!r.a_verifier });
  return {
    duree_min: avant.duree_min + apres.duree_min,
    ferry: true,
    ferry_fixe_min: ferry,
    marge_min: Math.max(avant.marge_min || 0, apres.marge_min || 0),
    source: moinsSure([avant.source, apres.source]),
    a_verifier: !!(avant.a_verifier || apres.a_verifier || l.a_verifier),
    morceaux: [morceau(de, portDepart, avant), { genre: "ferry", nom: l.nom, duree_min: ferry, a_verifier: !!l.a_verifier }, morceau(portArrivee, vers, apres)],
  };
}

// Le détail d'un trajet pour Nani : « Jai Tiki → port de Lanta : 25 min, ferry : 1 h, port en face → Krabi Nakharin : 1 h 10 ».
export function detailMorceaux(morceaux = [], texteDuree = (m) => `${m} min`) {
  return morceaux.map((m) => (m.genre === "ferry" ? `ferry : ${texteDuree(m.duree_min)}` : `${m.de} → ${m.vers} : ${texteDuree(m.duree_min)}`)).join(", ");
}

// ---- Durées écrites -------------------------------------------------------------------------------------------------------------

// « 50 min », « 1 h 30 », « 1h30 », « 2 hours », « about 2 to 3 hours », « 1.5 h », « 1h30 to 2 hours » → minutes. Une fourchette donne sa
// borne haute (un pickup calculé avec la borne haute n'est jamais en retard). Illisible : null.
export function minutesDe(texte) {
  const t = sansAccents(texte).replace(/,/g, ".");
  const valeurs = [];
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(?:h|hours?|heures?|hrs?)\s*(\d{1,2})?(?!\d)|(\d+)\s*(?:min|minutes?|mn)\b/g)) {
    if (m[3]) valeurs.push(Number(m[3]));
    else valeurs.push(Math.round(Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0)));
  }
  // « 2 to 3 hours » : le premier nombre sans unité prend celle du second.
  const f = /(\d+(?:\.\d+)?)\s*(?:to|a|-|–)\s*(\d+(?:\.\d+)?)\s*(h|hours?|heures?)/.exec(t);
  if (f) valeurs.push(Math.round(Number(f[2]) * 60));
  const ok = valeurs.filter((v) => v > 0 && v <= 24 * 60);
  return ok.length ? Math.max(...ok) : null;
}

// Durées tapées par la personne dans la conversation (« 2h30 », « 45 min », « 3 heures ») : seules admises quand elle donne une durée.
// Une heure d'horloge (« vol à 20h00 », « at 4pm », « vers 16h ») n'est pas une durée : elle est écartée, comme toute durée de plus de 12 heures.
export function dureesTapees(textes = []) {
  const out = new Set();
  for (const t of textes) {
    const s = sansAccents(t);
    for (const m of s.matchAll(/\d+(?:[.,]\d+)?\s*(?:h|hours?|heures?|hrs?)\s*\d{0,2}|\d+\s*(?:min|minutes?|mn)\b/g)) {
      const avant = s.slice(Math.max(0, m.index - 12), m.index);
      if (/(?:\ba|\bat|vers|for|from|des|jusqu'a|avant|apres|before|after|around)\s*$/.test(avant)) continue;
      const v = minutesDe(m[0]);
      if (v && v <= 720) out.add(v);
    }
  }
  return out;
}

// ---- Pré-remplissage de la table (lignes « à vérifier ») ------------------------------------------------------------------------

// Durées des pages taxi du site (src/_data/taxiRoutes.json, champ « drive ») : approximatives, relevées le 30.10.2026 sur des sites de
// transport, à affiner avec VIP Taxi Lanta. `routes` : les entrées { from, to, drive }.
export function lignesDuSite(routes = [], date = "2026-10-30") {
  return routes
    .filter((r) => r && r.from && r.to && typeof r.drive === "string")
    .map((r) => ({ de: r.from, vers: r.to, mode: "route", duree_min: minutesDe(r.drive), ferry: /lanta/i.test(`${r.from} ${r.to}`), marge_min: 0, source: `Page taxi du site : « ${r.drive} »`, source_date: date, a_verifier: true, origine: "site" }))
    .filter((l) => l.duree_min);
}

// Durées des trajets du catalogue (colonne « duree »), une ligne par paire de lieux, la plus longue gardée. Aucun nom de compagnie.
export function lignesDesBateaux(trajets = [], date = "") {
  const parPaire = new Map();
  for (const t of trajets) {
    if (t.actif === false) continue;
    const d = minutesDe(t.duree);
    if (!d || !t.de || !t.vers) continue;
    const cle = `${cleZone(t.de)}>${cleZone(t.vers)}`;
    const avant = parPaire.get(cle);
    if (!avant || d > avant.duree_min) parPaire.set(cle, { de: t.de, vers: t.vers, mode: "bateau", duree_min: d, ferry: false, marge_min: 0, source: "Catalogue des trajets (durée annoncée)", source_date: date, a_verifier: true, origine: "bateau" });
  }
  return [...parPaire.values()];
}

// Grilles de pickup des partenaires : pour chaque zone, le temps entre le passage du véhicule et le départ du bateau (enregistrement compris),
// le plus long gardé. `grilles` : [{ colonnes: ["Bateau 10h30", …], zones: [{ nom, heures: ["09:40", …] }] }] (pickup-calc.mjs, grillesDe).
// `depart` : le lieu de départ des bateaux de ce partenaire (« Koh Lanta »). Le nom du partenaire n'entre jamais dans la ligne.
export function lignesDesZones(grilles = [], depart = "", date = "") {
  const hm = (s) => {
    const m = /(\d{1,2})\s*[:h.]\s*(\d{2})/.exec(String(s || ""));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const parZone = new Map();
  for (const g of grilles) {
    g.colonnes.forEach((col, ci) => {
      const bateau = hm(col);
      if (bateau === null) return;
      for (const z of g.zones) {
        const p = hm(z.heures[ci]);
        if (p === null || p >= bateau || bateau - p > 300) continue;
        const d = bateau - p;
        const avant = parZone.get(z.nom);
        if (!avant || d > avant) parZone.set(z.nom, d);
      }
    });
  }
  const vers = depart ? `Embarcadère, ${depart}` : "Embarcadère";
  return [...parZone.entries()].map(([zone, d]) => ({ de: zone, vers, mode: "route", duree_min: d, ferry: false, marge_min: 0, source: "Grille de pickup : temps avant le départ du bateau, enregistrement compris", source_date: date, a_verifier: true, origine: "zones" }));
}

// Les lignes à ajouter : celles dont la paire (et le mode) n'est pas encore dans la table. Une ligne de Nani n'est jamais écrasée.
export function lignesNouvelles(proposees = [], existantes = []) {
  const vues = new Set(existantes.map((l) => `${l.mode || "route"}|${clePaire(l.de, l.vers)}`));
  const out = [];
  for (const l of proposees) {
    const k = `${l.mode}|${clePaire(l.de, l.vers)}`;
    if (vues.has(k)) continue;
    vues.add(k);
    out.push({ ...l, cle: clePaire(l.de, l.vers) });
  }
  return out;
}

// ---- openrouteservice --------------------------------------------------------------------------------------------------------------
// Adresses vérifiées dans le client officiel (openrouteservice-py, 19.11.2026) : base https://api.heigit.org, clé dans l'en-tête Authorization,
// itinéraire POST /openrouteservice/v2/directions/driving-car/json avec { coordinates: [[lon, lat], …] } ; géocodage GET /pelias/v1/search.
// Réponse de l'itinéraire : routes[0].summary.duration (secondes) et .distance (mètres) ; extras.waycategory, bit 8 = ferry.
export const ORS_BASE = "https://api.heigit.org";
export const ORS_ITINERAIRE = "/openrouteservice/v2/directions/driving-car/json";
export const ORS_GEOCODE = "/pelias/v1/search";

// Les noms à essayer pour géocoder un lieu, du plus précis au plus simple : tel qu'écrit, sans la partie entre parenthèses, puis la partie
// entre parenthèses suivie du reste (« ท่าเรือคลองหมาก (Khlong Mak Pier), Koh Lanta Noi » → « ท่าเรือคลองหมาก, Koh Lanta Noi »,
// « Khlong Mak Pier, Koh Lanta Noi »).
export function variantesLieu(lieu) {
  const t = String(lieu || "").replace(/\s+/g, " ").trim();
  const m = /^(.*?)\s*\(([^)]+)\)\s*(.*)$/.exec(t);
  const out = [t];
  if (m) {
    const reste = m[3].replace(/^[,\s]+/, "");
    out.push([m[1], reste].filter(Boolean).join(", "), [m[2], reste].filter(Boolean).join(", "));
  }
  return [...new Set(out.filter(Boolean))].slice(0, 3);
}

// Requête de géocodage : le nom du lieu seul (jamais un nom de client), en Thaïlande, un résultat.
export const parametresGeocode = (lieu) => new URLSearchParams({ text: String(lieu || "").slice(0, 200), "boundary.country": "TH", size: "1" });
export function lireGeocode(json) {
  const f = json && Array.isArray(json.features) ? json.features[0] : null;
  const c = f && f.geometry && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : null;
  if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  const p = f.properties || {};
  return { lon: c[0], lat: c[1], label: String(p.label || p.name || "").slice(0, 200), confiance: Number.isFinite(p.confidence) ? p.confidence : null };
}

export const corpsItineraire = (a, b) => ({ coordinates: [[a.lon, a.lat], [b.lon, b.lat]], extra_info: ["waycategory"] });
export function lireItineraire(json) {
  const r = json && Array.isArray(json.routes) ? json.routes[0] : null;
  const s = r && r.summary;
  if (!s || !Number.isFinite(s.duration) || s.duration <= 0) return null;
  const valeurs = (r.extras && r.extras.waycategory && Array.isArray(r.extras.waycategory.values) ? r.extras.waycategory.values : []).map((v) => (Array.isArray(v) ? v[2] : 0));
  return { duree_min: Math.round(s.duration / 60), distance_km: Number.isFinite(s.distance) ? Math.round(s.distance / 100) / 10 : null, ferry: valeurs.some((v) => (Number(v) & 8) === 8) };
}
