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
const SYNONYMES = { aeroport: "airport", ville: "town", hopital: "hospital", embarcadere: "pier", jetee: "pier", ko: "koh", bkk: "suvarnabhumi", muang: "mueang", train: "railway", gare: "railway" };
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
// Un itinéraire calculé (trajets_ors) se garde par la position de ses deux bouts, arrondie à 0,001° (environ 110 m), dans le sens du
// trajet : deux écritures du même hôtel (« Jai Tiki », « Jai Tiki Retreat, Klong Nin ») retrouvent le même itinéraire.
export const cleItineraire = (a, b) => `${Number(a.lat).toFixed(3)},${Number(a.lon).toFixed(3)} > ${Number(b.lat).toFixed(3)},${Number(b.lon).toFixed(3)}`;
// Ce qu'OpenStreetMap a calculé (lieux, itinéraires) est recalculé après six mois : routes et données changent. Jamais un lieu saisi à la main.
export const VALIDITE_JOURS = 180;

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
  if (r && r.duree_min > 0) return { duree_min: r.duree_min, distance_km: r.distance_km ?? null, ferry: !!(r.ferry || (l && l.ferry)), marge_min: l ? l.marge_min || 0 : 0, source: "ors", moteur: MOTEURS.includes(r.moteur) ? r.moteur : "ors", a_verifier: false, de_trouve: r.de_trouve || "", vers_trouve: r.vers_trouve || "" };
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
  const morceau = (de_, vers_, r) => ({ genre: "route", de: de_, vers: vers_, duree_min: r.duree_min, source: r.source, ...(r.moteur ? { moteur: r.moteur } : {}), a_verifier: !!r.a_verifier });
  return {
    duree_min: avant.duree_min + apres.duree_min,
    ferry: true,
    ferry_fixe_min: ferry,
    marge_min: Math.max(avant.marge_min || 0, apres.marge_min || 0),
    source: moinsSure([avant.source, apres.source]),
    a_verifier: !!(avant.a_verifier || apres.a_verifier || l.a_verifier),
    morceaux: [morceau(de, portDepart, avant), { genre: "ferry", nom: l.nom, duree_min: ferry, a_verifier: !!l.a_verifier }, morceau(portArrivee, vers, apres)],
    ...(avant.moteur || apres.moteur ? { moteur: avant.moteur || apres.moteur } : {}),
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
// `hotels` (hotels_lieux) : un hôtel connu ajoute sa plage ou son quartier (« Klong Nin »), utile quand l'hôtel lui-même n'est pas dans
// OpenStreetMap. Jamais l'île seule : un point au milieu de l'île donnerait une durée fausse, l'agent demande plutôt.
export function variantesLieu(lieu, hotels = []) {
  const t = String(lieu || "").replace(/\s+/g, " ").trim();
  const m = /^(.*?)\s*\(([^)]+)\)\s*(.*)$/.exec(t);
  const out = [t];
  if (m) {
    const reste = m[3].replace(/^[,\s]+/, "");
    out.push([m[1], reste].filter(Boolean).join(", "), [m[2], reste].filter(Boolean).join(", "));
  }
  // Le nom seul, avant la première virgule (« Krabi Nakharin International Hospital ») : un lieu précis se trouve souvent mieux ainsi.
  if (/,/.test(t)) out.push(t.split(",")[0].trim());
  // OpenStreetMap écrit « Ko Lanta », pas « Koh Lanta » (vérifié avec Nominatim le 20.11.2026).
  for (const v of [...out]) if (/\bKoh\s/i.test(v)) out.push(v.replace(/\bKoh\s/gi, "Ko "));
  const brut = sansAccents(t).replace(/[^a-z0-9]+/g, " ").trim();
  const h = hotels.find((x) => x && x.cle && x.zone && brut.includes(x.cle));
  // La plage ou le quartier de l'hôtel, seul : « Klong Nin » se trouve, « Klong Nin, Koh Lanta » non.
  if (h) out.push(h.zone);
  return [...new Set(out.filter(Boolean))].slice(0, 6);
}

// Les coordonnées d'un lieu. D'abord par son nom (variantesLieu). Introuvable (un hôtel absent d'OpenStreetMap, comme Jai Tiki) : l'hôtel est
// situé par une recherche web sur son nom seul (situerHotel, sources contrôlées), puis sa plage ou son quartier est cherché dans OpenStreetMap.
// Jamais l'île seule. Le libellé dit que la position vient du web et d'où, pour que la personne la vérifie d'un coup d'œil.
// Demande de Jérémy (20.11.2026) : l'agent cherche lui-même où est l'hôtel, sans demander, pour faire gagner du temps à Anaïs.
const hoteDe = (url) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
};
export async function situerLieu(lieu, { chercher, hotels = [], situerHotel = null }) {
  for (const v of variantesLieu(lieu, hotels)) {
    const g = await chercher(v);
    if (g) return { ...g, par: "nom" };
  }
  if (!situerHotel) return null;
  const nom = String(lieu || "").split(",")[0].trim();
  if (nom.length < 3) return null;
  const h = await situerHotel(nom);
  if (!h || !h.source || !h.source.url || !h.zone) return null;
  const essais = [...new Set([h.localite ? `${h.zone}, ${h.localite}` : "", h.localite ? `${h.zone}, ${String(h.localite).replace(/\bKoh\s/gi, "Ko ")}` : "", h.zone].filter(Boolean))];
  for (const v of essais) {
    const g = await chercher(v);
    if (g) return { ...g, label: `${nom} : ${h.zone}${h.localite ? `, ${h.localite}` : ""} d'après le web (${hoteDe(h.source.url)})`.slice(0, 200), par: "web", source_url: h.source.url };
  }
  return null;
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

// ---- OSRM public et Nominatim (décision de Jérémy du 20.11.2026, en attendant openrouteservice) -------------------------------------------
// Pour l'organisation de Koh Lanta seulement : quelques recherches d'Anaïs, jamais pour une autre agence. Le serveur public d'OSRM se dit
// réservé aux usages non commerciaux, sans garantie de service ; Jérémy a choisi de s'en servir à ce faible volume (20.11.2026).
// Règles tenues : une requête par seconde au plus par serveur, l'outil identifié (User-Agent), résultats gardés en base, mention
// d'OpenStreetMap et d'OSRM à l'écran. Nominatim (OSMF) admet ce petit volume déclenché par une personne, avec les mêmes règles.
export const ORGANISATIONS_OSRM = ["00000000-0000-0000-0000-00000000a000"];
export const OSRM_BASE = "https://router.project-osrm.org";
export const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
export const USER_AGENT = "Gestion-agent-planification/1.0 (outil interne d'agence, Koh Lanta)";
export const MENTION_OSM = "Itinéraire OSRM, données © contributeurs OpenStreetMap";

// Itinéraire en voiture : GET /route/v1/driving/{lon},{lat};{lon},{lat}?overview=false (documentation OSRM v5).
// Avec les étapes, pour repérer un ferry (mode « ferry » d'une étape).
export const cheminOsrm = (a, b) => `/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false&steps=true`;
// Réponse : code « Ok », routes[0].duration (secondes), routes[0].distance (mètres), legs[].steps[].mode. Un ferry repéré ici alors qu'aucune
// liaison de la table n'a servi veut dire qu'un bout du trajet n'a pas été reconnu sur l'île : le planning le signale (ferry_sans_liaison).
export function lireOsrm(json) {
  const r = json && json.code === "Ok" && Array.isArray(json.routes) ? json.routes[0] : null;
  if (!r || !Number.isFinite(r.duration) || r.duration <= 0) return null;
  const ferry = (r.legs || []).some((l) => (l.steps || []).some((s) => s && s.mode === "ferry"));
  return { duree_min: Math.round(r.duration / 60), distance_km: Number.isFinite(r.distance) ? Math.round(r.distance / 100) / 10 : null, ferry };
}

// Recherche d'un lieu par Nominatim : le nom seul, en Thaïlande, un résultat. Jamais une recherche à la frappe (interdite par Nominatim).
export const parametresNominatim = (lieu) => new URLSearchParams({ q: String(lieu || "").slice(0, 200), format: "jsonv2", limit: "1", countrycodes: "th" });
export function lireNominatim(json) {
  const r = Array.isArray(json) ? json[0] : null;
  const lat = r ? Number(r.lat) : NaN;
  const lon = r ? Number(r.lon) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lon, lat, label: String(r.display_name || r.name || "").slice(0, 200), confiance: Number.isFinite(Number(r.importance)) ? Number(r.importance) : null };
}

// ---- Google Maps (décision de Jérémy du 20.11.2026) -------------------------------------------------------------------------------
// Test sur les 48 lieux de pickup réels : OpenStreetMap en place juste une vingtaine, Photon se trompe une fois sur trois, et Nominatim
// comme Photon refusent les serveurs de Supabase. Google Places (Text Search, « Pro » : 5 000 gratuits par mois) situe le lieu, Google
// Routes (Compute Routes « Essentials », sans trafic : 10 000 gratuits par mois) donne la durée. Clé GOOGLE_MAPS_API_KEY, quotas bloqués
// sous le gratuit dans la console Google. Coordonnées gardées 30 jours au plus (conditions de Google), jamais au-delà.
export const MOTEURS = ["ors", "osrm", "google"];
export const GOOGLE_PLACES = "https://places.googleapis.com/v1/places:searchText";
export const GOOGLE_ROUTES = "https://routes.googleapis.com/directions/v2:computeRoutes";
export const CHAMPS_PLACES = "places.displayName,places.formattedAddress,places.location";
export const CHAMPS_ROUTES = "routes.duration,routes.distanceMeters,routes.legs.steps.navigationInstruction.maneuver";
export const VALIDITE_GOOGLE_JOURS = 30;
// Thaïlande entière en biais (pas en limite) : Google préfère ces résultats sans exclure le reste.
export const corpsPlaces = (texte) => ({ textQuery: String(texte || "").slice(0, 200), languageCode: "en", regionCode: "TH", pageSize: 1, locationBias: { rectangle: { low: { latitude: 5.6, longitude: 97.3 }, high: { latitude: 20.5, longitude: 105.7 } } } });
// Un résultat n'est gardé que si son nom concorde avec le lieu demandé : tous les mots distinctifs d'un nom court (« Seahorse » ne suffit pas
// pour « Kantiang Seahorse »), les deux tiers d'un nom plus long ; un mot qui en prolonge un autre compte (« Baiyok », « Baiyoke »), de
// même qu'un mot long à une lettre près (« Chili », « Chilli »).
const MOTS_VAGUES_LIEU = new Set(["hotel", "resort", "beach", "retreat", "villa", "villas", "bungalow", "bungalows", "house", "road", "town", "province", "spa", "pier", "lanta", "krabi", "thailand", "suite", "suites", "boutique", "residence", "hostel", "lodge", "bay", "bangkok", "phuket", "samui", "station"]);
// Deux mots à une lettre près (ajoutée, retirée ou changée) : « Chili » et « Chilli ».
function unPres(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
}
export function nomConcorde(demande, trouve) {
  const t = new Set(motsLieu(trouve));
  const mots = [...new Set(motsLieu(String(demande || "").split(",")[0]))].filter((w) => w.length >= 3 && !MOTS_VAGUES_LIEU.has(w));
  const vu = (w) => t.has(w) || (w.length >= 4 && [...t].some((x) => x.length >= 4 && (x.startsWith(w) || w.startsWith(x) || (w.length >= 5 && unPres(w, x)))));
  if (!mots.length) return motsLieu(demande).some((w) => w.length >= 4 && vu(w));
  const n = mots.filter(vu).length;
  return mots.length <= 2 ? n === mots.length : n * 3 >= mots.length * 2;
}
export function lirePlaces(json, texte = "") {
  const p = json && Array.isArray(json.places) ? json.places[0] : null;
  const lat = p && p.location ? Number(p.location.latitude) : NaN;
  const lon = p && p.location ? Number(p.location.longitude) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const nom = p.displayName && p.displayName.text ? String(p.displayName.text) : "";
  const label = [nom, p.formattedAddress].filter(Boolean).join(", ").slice(0, 200);
  if (texte && !nomConcorde(texte, label)) return null;
  return { lon, lat, label, confiance: null };
}
export const corpsRoutes = (a, b) => ({ origin: { location: { latLng: { latitude: a.lat, longitude: a.lon } } }, destination: { location: { latLng: { latitude: b.lat, longitude: b.lon } } }, travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE", languageCode: "en", units: "METRIC" });
// « 4380s » → 73 min (arrondi au-dessus), un ferry repéré par la manœuvre FERRY d'une étape.
export function lireRoutes(json) {
  const r = json && Array.isArray(json.routes) ? json.routes[0] : null;
  const sec = r ? Number(String(r.duration || "").replace(/s$/, "")) : NaN;
  if (!Number.isFinite(sec) || sec <= 0) return null;
  const etapes = (r.legs || []).flatMap((l) => l.steps || []);
  const ferry = etapes.some((e) => /FERRY/.test(String((e.navigationInstruction && e.navigationInstruction.maneuver) || "")));
  return { duree_min: Math.max(1, Math.ceil(sec / 60)), distance_km: Number.isFinite(Number(r.distanceMeters)) ? Math.round(Number(r.distanceMeters) / 100) / 10 : null, ferry };
}

// Relais de Nominatim (20.11.2026) : Nominatim refuse les serveurs de Supabase (403 à chaque requête, vu en production). Photon (Komoot,
// mêmes données OpenStreetMap, sans clé) répond. GET /api/?q=…&limit=1&lang=en, limité à la Thaïlande (bbox), réponse GeoJSON.
// Plus appelé depuis le 20.11.2026 : refusé aux serveurs de Supabase, et un résultat faux une fois sur trois sur les lieux réels.
export const PHOTON_BASE = "https://photon.komoot.io";
export const parametresPhoton = (texte) => new URLSearchParams({ q: String(texte || "").slice(0, 160), limit: "1", lang: "en", bbox: "97.3,5.6,105.7,20.5" }).toString();
// Photon cherche large : un résultat n'est gardé que s'il partage un vrai mot (pas « hotel », « beach »…) avec le lieu demandé.
const MOTS_VAGUES = new Set(["hotel", "resort", "beach", "retreat", "villa", "villas", "bungalow", "bungalows", "house", "road", "town", "province", "spa", "pier"]);
export function lirePhoton(json, texte = "") {
  const f = json && Array.isArray(json.features) ? json.features[0] : null;
  const c = f && f.geometry && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : [];
  const lon = Number(c[0]);
  const lat = Number(c[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const p = f.properties || {};
  const label = [p.name, p.street, p.district, p.city, p.state].filter((x, i, t) => x && t.indexOf(x) === i).join(", ");
  if (texte) {
    const trouves = new Set(motsLieu(label));
    if (!motsLieu(texte).some((w) => w.length >= 4 && !MOTS_VAGUES.has(w) && trouves.has(w))) return null;
  }
  return { lon, lat, label: String(label).slice(0, 200), confiance: null };
}

// Une requête par seconde au plus vers chaque serveur : rend le temps à attendre (ms) avant le prochain appel et note celui-ci.
export function delaiAvant(derniers, hote, maintenant, ecartMs = 1100) {
  const attente = derniers.has(hote) ? Math.max(0, derniers.get(hote) + ecartMs - maintenant) : 0;
  derniers.set(hote, maintenant + attente);
  return attente;
}

