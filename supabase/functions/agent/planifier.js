// Agent de Gestion : calcul des heures d'une course (pickup à rebours, ferry, marge, vol). Logique pure, sans dépendance.
// Le modèle ne calcule aucune heure : il donne les points et les contraintes, ce fichier rend le planning. Les temps de route viennent de
// Google Maps (Routes API, trafic prévu) ou, sans clé, d'une table de démonstration toujours marquée « simulation ».
//
// Ce fichier existe en deux exemplaires identiques : supabase/functions/agent/planifier.js (fonction Supabase) et
// src/gestion/js/agent-planifier.mjs (écran, démonstration). tests/gestion-agent.test.js vérifie qu'ils ne divergent pas.

// Marges par défaut, réglables par entreprise (reglages.agent_planning). Ce ne sont pas des faits pour le client : des hypothèses de travail
// que le planning affiche toujours, pour que Nani les voie et les corrige.
export const PLANNING_DEFAUT = {
  marge_pct: 10, // marge de sécurité par trajet, en pourcentage du temps de route
  marge_min: 10, // au moins tant de minutes par trajet
  ferry_attente_min: 30, // attente au ferry quand la route en prend un (la traversée elle-même est dans le temps de route)
  avance_vol_domestique_min: 120, // arrivée à l'aéroport au plus tard tant avant un vol intérieur
  avance_vol_international_min: 180, // et avant un vol international
  arrondi_min: 5, // le pickup est arrondi vers le bas à ce pas
};

const borne = (x, min, max, defaut) => (Number.isFinite(Number(x)) && x !== "" && x !== null ? Math.min(max, Math.max(min, Math.round(Number(x)))) : defaut);

// Les réglages de l'entreprise, bornés : une valeur absente ou absurde reprend le défaut.
export function reglagesPlanning(reglages) {
  const r = (reglages && reglages.agent_planning) || {};
  const d = PLANNING_DEFAUT;
  return {
    marge_pct: borne(r.marge_pct, 0, 50, d.marge_pct),
    marge_min: borne(r.marge_min, 0, 60, d.marge_min),
    ferry_attente_min: borne(r.ferry_attente_min, 0, 120, d.ferry_attente_min),
    avance_vol_domestique_min: borne(r.avance_vol_domestique_min, 30, 300, d.avance_vol_domestique_min),
    avance_vol_international_min: borne(r.avance_vol_international_min, 30, 360, d.avance_vol_international_min),
    arrondi_min: borne(r.arrondi_min, 1, 30, d.arrondi_min),
  };
}

// ---- Heures ---------------------------------------------------------------------------------------------------------------------------

export const heureValide = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const enMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const deux = (n) => String(n).padStart(2, "0");

// Ajoute des jours à une date AAAA-MM-JJ.
export function decalerDate(iso, jours) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

// Minutes depuis minuit du jour `date` (négatives ou au-delà de 24 h permises) vers { date, heure }.
export function versHeure(date, minutes) {
  const m = Math.round(minutes);
  const jours = Math.floor(m / 1440);
  const reste = m - jours * 1440;
  return { date: jours ? decalerDate(date, jours) : date, heure: `${deux(Math.floor(reste / 60))}:${deux(reste % 60)}` };
}

// Heure locale de Thaïlande (UTC+7, sans heure d'été) vers un instant ISO, pour Google.
export function instantBangkok(date, minutes) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + (Math.round(minutes) - 7 * 60) * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ---- Durées d'un trajet ------------------------------------------------------------------------------------------------------------

// Temps compté pour un trajet : route (trafic compris), attente au ferry s'il y en a un, marge de sécurité.
export function dureeAvecMarges(trajet, r = PLANNING_DEFAUT) {
  const route = Math.max(0, Math.round(Number(trajet.duree_min) || 0));
  const ferry = trajet.ferry ? r.ferry_attente_min : 0;
  const marge = Math.max(r.marge_min, Math.round((route * r.marge_pct) / 100));
  return { route_min: route, ferry_attente_min: ferry, marge_min: marge, total_min: route + ferry + marge };
}

const texteDuree = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${deux(m)}` : ""}` : `${m} min`;
};
export { texteDuree };

// ---- Planning d'une course -----------------------------------------------------------------------------------------------------------

// points   : [{ lieu, arrivee_voulue?: "HH:MM", attente_min?: n }] (deux au moins, dans l'ordre de la course). Le premier point peut aussi
//            donner `depart_voulu` (pickup déjà fixé) : le planning se calcule alors vers l'avant seulement.
// trajets  : [{ duree_min, ferry, source, distance_km? }] entre chaque point et le suivant.
// vol      : { heure: "HH:MM", international: bool } ou null : l'heure de décollage, pour dire si c'est tenable.
// Rend { ok, pickup, etapes, trajets, vol, hypotheses, alertes } ou { ok: false, erreur }.
export function planifierCourse({ date, points = [], trajets = [], vol = null, reglages = PLANNING_DEFAUT }) {
  const r = { ...PLANNING_DEFAUT, ...reglages };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return { ok: false, erreur: "date_manquante" };
  if (points.length < 2) return { ok: false, erreur: "deux_points_au_moins" };
  if (trajets.length !== points.length - 1) return { ok: false, erreur: "trajets_incomplets" };
  const manque = trajets.findIndex((t) => !(Number(t.duree_min) > 0));
  if (manque >= 0) return { ok: false, erreur: "duree_inconnue", trajet: manque };

  const durees = trajets.map((t) => dureeAvecMarges(t, r));
  const attente = (i) => Math.max(0, Math.round(Number(points[i].attente_min) || 0));
  let ancre = points.findIndex((p) => heureValide(p.arrivee_voulue));
  let pickup;
  // Deux chaînes d'heures : « prévue » (route et ferry, sans marge) et « au plus tard » (marges comprises).
  const prevue = new Array(points.length).fill(null);
  const auPlusTard = new Array(points.length).fill(null);
  const depart = new Array(points.length).fill(null);

  if (ancre === 0) {
    // Une heure donnée au premier point : c'est le pickup, le planning va vers l'avant.
    pickup = enMinutes(points[0].arrivee_voulue) + attente(0);
    depart[0] = pickup;
  } else if (ancre > 0) {
    // À rebours depuis le rendez-vous : chaque trajet avant lui compte route, ferry et marge.
    const rdv = enMinutes(points[ancre].arrivee_voulue);
    let t = rdv;
    for (let i = ancre - 1; i >= 0; i--) {
      t -= durees[i].total_min;
      depart[i] = t;
      if (i > 0) t -= attente(i);
    }
    pickup = Math.floor(depart[0] / r.arrondi_min) * r.arrondi_min;
    // Le pickup arrondi vers le bas : les heures d'avant le rendez-vous se recalculent depuis lui.
    let p = pickup;
    let s = pickup;
    depart[0] = pickup;
    for (let i = 0; i < ancre; i++) {
      p += durees[i].route_min + durees[i].ferry_attente_min;
      s += durees[i].total_min;
      prevue[i + 1] = p;
      auPlusTard[i + 1] = s;
      if (i + 1 < ancre) {
        depart[i + 1] = s + attente(i + 1);
        p = depart[i + 1];
        s = depart[i + 1];
      }
    }
    // Le rendez-vous fait foi pour la suite : départ à l'heure du rendez-vous plus l'attente.
    prevue[ancre] = Math.min(prevue[ancre] ?? rdv, rdv);
    auPlusTard[ancre] = rdv;
  } else if (heureValide(points[0].depart_voulu)) {
    ancre = 0;
    pickup = enMinutes(points[0].depart_voulu);
    depart[0] = pickup;
  } else {
    return { ok: false, erreur: "heure_manquante" };
  }

  // Vers l'avant depuis le point d'ancrage. Après un arrêt, on repart à l'heure « au plus tard » plus l'attente : le chauffeur attend le
  // client, jamais l'inverse.
  if (ancre > 0) depart[ancre] = auPlusTard[ancre] + attente(ancre);
  let p = depart[ancre];
  let s = depart[ancre];
  for (let i = ancre; i < points.length - 1; i++) {
    p += durees[i].route_min + durees[i].ferry_attente_min;
    s += durees[i].total_min;
    prevue[i + 1] = p;
    auPlusTard[i + 1] = s;
    if (i + 1 < points.length - 1) {
      depart[i + 1] = s + attente(i + 1);
      p = s = depart[i + 1];
    }
  }

  const h = (m) => (m === null || m === undefined ? null : versHeure(date, m));
  const etapes = points.map((pt, i) => ({
    lieu: String(pt.lieu || "").slice(0, 160),
    arrivee_prevue: i === 0 ? null : h(prevue[i]),
    arrivee_au_plus_tard: i === 0 ? null : h(auPlusTard[i]),
    rendez_vous: heureValide(pt.arrivee_voulue) ? pt.arrivee_voulue : "",
    attente_min: attente(i),
    depart: i < points.length - 1 ? h(depart[i]) : null,
  }));
  const lignes = trajets.map((t, i) => ({
    de: etapes[i].lieu,
    vers: etapes[i + 1].lieu,
    ...durees[i],
    ferry: !!t.ferry,
    source: ["google", "simulation", "saisie"].includes(t.source) ? t.source : "saisie",
    distance_km: Number.isFinite(Number(t.distance_km)) && t.distance_km !== null ? Math.round(Number(t.distance_km)) : null,
  }));

  const alertes = [];
  if (lignes.some((l) => l.source === "simulation")) alertes.push("temps_simules");
  const pk = versHeure(date, pickup);
  if (pk.date !== date) alertes.push("pickup_la_veille");
  if (pickup % 1440 < 5 * 60 && pk.date === date) alertes.push("pickup_avant_5h");

  let verifVol = null;
  if (vol && heureValide(vol.heure)) {
    const avance = vol.international ? r.avance_vol_international_min : r.avance_vol_domestique_min;
    const fin = points.length - 1;
    // Le vol est le jour de la course, ou le lendemain s'il décolle avant l'arrivée (vol de nuit).
    let decollage = enMinutes(vol.heure);
    while (decollage < (prevue[fin] ?? 0) - 6 * 60) decollage += 1440;
    const limite = decollage - avance;
    const reste = limite - auPlusTard[fin];
    verifVol = {
      heure: vol.heure,
      international: !!vol.international,
      avance_min: avance,
      arrivee_limite: versHeure(date, limite),
      marge_restante_min: reste,
      // « juste » : tenable à l'heure prévue, pas si toutes les marges sont consommées.
      verdict: reste >= 0 ? "tenable" : limite - prevue[fin] >= 0 ? "juste" : "pas_tenable",
    };
    if (verifVol.verdict !== "tenable") alertes.push(`vol_${verifVol.verdict}`);
  }

  const hypotheses = [
    `marge de sécurité ${r.marge_pct} % du temps de route, ${r.marge_min} min au moins par trajet`,
    ...(lignes.some((l) => l.ferry) ? [`${r.ferry_attente_min} min d'attente au ferry`] : []),
    ...(verifVol ? [`arrivée à l'aéroport ${texteDuree(verifVol.avance_min)} avant un vol ${verifVol.international ? "international" : "intérieur"}`] : []),
    `pickup arrondi aux ${r.arrondi_min} min inférieures`,
  ];
  return { ok: true, date, pickup: pk, etapes, trajets: lignes, vol: verifVol, hypotheses, alertes };
}

// ---- Google Maps (Routes API) -------------------------------------------------------------------------------------------------------

export const URL_ROUTES = "https://routes.googleapis.com/directions/v2:computeRoutes";
// Seuls ces champs sont demandés (et facturés) : durée avec trafic, durée sans trafic, distance, et les manœuvres pour repérer un ferry.
export const CHAMPS_ROUTES = "routes.duration,routes.staticDuration,routes.distanceMeters,routes.legs.steps.navigationInstruction.maneuver,routes.legs.steps.staticDuration";

// Le corps de la requête : adresses en texte (Google les géocode), en voiture, trafic prévu à l'heure de départ (dans le futur).
export function requeteRoutes({ de, vers, departIso }) {
  return {
    origin: { address: String(de).slice(0, 200) },
    destination: { address: String(vers).slice(0, 200) },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    ...(departIso ? { departureTime: departIso } : {}),
    languageCode: "fr",
    regionCode: "th",
    units: "METRIC",
  };
}

const secondes = (s) => {
  const m = /^(\d+(?:\.\d+)?)s$/.exec(String(s || ""));
  return m ? Number(m[1]) : null;
};

// La réponse de Google : minutes avec trafic, distance, présence et durée du ferry. null si aucune route.
export function lireRoutes(json) {
  const route = json && Array.isArray(json.routes) ? json.routes[0] : null;
  if (!route) return null;
  const duree = secondes(route.duration) ?? secondes(route.staticDuration);
  if (duree === null) return null;
  let ferrySec = 0;
  let ferry = false;
  for (const leg of route.legs || []) {
    for (const st of leg.steps || []) {
      const m = st && st.navigationInstruction && st.navigationInstruction.maneuver;
      if (m === "FERRY" || m === "FERRY_TRAIN") {
        ferry = true;
        ferrySec += secondes(st.staticDuration) || 0;
      }
    }
  }
  return {
    duree_min: Math.round(duree / 60),
    sans_trafic_min: secondes(route.staticDuration) !== null ? Math.round(secondes(route.staticDuration) / 60) : null,
    distance_km: Number.isFinite(route.distanceMeters) ? Math.round(route.distanceMeters / 100) / 10 : null,
    ferry,
    ferry_min: Math.round(ferrySec / 60),
    source: "google",
  };
}

// ---- Temps simulés (démonstration, ou fonction sans clé Google avec AGENT_TRAJETS_SIMULES=1) ---------------------------------------------
// Ordres de grandeur pour faire tourner la démo, jamais montrés comme réels : le planning porte l'alerte « temps_simules ».
const cle = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const ZONES = [
  ["aeroport_krabi", /krabi.*(airport|aeroport|kbv)|(airport|aeroport).*krabi/],
  ["aeroport_phuket", /phuket.*(airport|aeroport|hkt)|(airport|aeroport).*phuket/],
  ["ao_nang", /ao nang/],
  ["krabi_ville", /krabi/],
  ["lanta", /lanta|saladan|klong (dao|nin|khong)|long beach|phra ae|kantiang|jai tiki/],
  ["phuket", /phuket|patong|kata|karon/],
];
const zone = (lieu) => (ZONES.find(([, re]) => re.test(cle(lieu))) || [null])[0];
const TABLE_SIMULEE = {
  "lanta|aeroport_krabi": { duree_min: 150, ferry: true, distance_km: 105 },
  "lanta|krabi_ville": { duree_min: 160, ferry: true, distance_km: 110 },
  "lanta|ao_nang": { duree_min: 175, ferry: true, distance_km: 125 },
  "lanta|aeroport_phuket": { duree_min: 270, ferry: true, distance_km: 265 },
  "lanta|phuket": { duree_min: 285, ferry: true, distance_km: 280 },
  "krabi_ville|aeroport_krabi": { duree_min: 25, ferry: false, distance_km: 16 },
  "ao_nang|aeroport_krabi": { duree_min: 40, ferry: false, distance_km: 30 },
  "ao_nang|krabi_ville": { duree_min: 30, ferry: false, distance_km: 20 },
  "lanta|lanta": { duree_min: 20, ferry: false, distance_km: 10 },
  "krabi_ville|krabi_ville": { duree_min: 15, ferry: false, distance_km: 6 },
};
export function tempsSimule(de, vers) {
  const a = zone(de);
  const b = zone(vers);
  if (!a || !b) return null;
  const t = TABLE_SIMULEE[`${a}|${b}`] || TABLE_SIMULEE[`${b}|${a}`];
  return t ? { ...t, sans_trafic_min: t.duree_min, ferry_min: t.ferry ? 25 : 0, source: "simulation" } : null;
}
