// Rappel une heure avant chaque service (migration 31) : la logique pure de l'outil.
// Heure et début d'un service (recopie de supabase/functions/rappels/calc.js, un test vérifie l'accord), services des deux prochaines heures,
// texte du rappel au client (prêt à copier, jamais envoyé seul) et détails utiles pour le partenaire. Rien n'est écrit pour le partenaire
// (Jérémy, 14.11.2026 : Anaïs lui écrit elle-même) : seulement son nom, son téléphone et ce qu'il faut lui dire.
import { personnesTexte, consigneCheckinFiche, notePasseport, fraisDeParc, typeVoucher, estFraisDeParc } from "./operations-calc.mjs";
import { libelleClient } from "./partenaires-calc.mjs";

// Fuseau de chaque organisation (organisations.fuseau, migration 42). Bangkok par défaut et pour un fuseau inconnu. Les heures d'été sont gérées
// (Intl), contrairement à l'ancien décalage fixe de +7 h qui ne valait que pour Bangkok.
export const FUSEAU_DEFAUT = "Asia/Bangkok";
const formats = new Map();
function format(fuseau) {
  if (!formats.has(fuseau)) formats.set(fuseau, new Intl.DateTimeFormat("en-CA", { timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }));
  return formats.get(fuseau);
}
export function fuseauValide(z) {
  try {
    if (typeof z === "string" && z) {
      format(z);
      return z;
    }
  } catch {
    // Fuseau inconnu : celui par défaut.
  }
  return FUSEAU_DEFAUT;
}
function parties(fuseau, ms) {
  const o = {};
  for (const p of format(fuseauValide(fuseau)).formatToParts(new Date(ms))) o[p.type] = p.value;
  return o;
}
export const dateDans = (fuseau, d = new Date()) => {
  const p = parties(fuseau, d.getTime());
  return `${p.year}-${p.month}-${p.day}`;
};
export const heureDans = (fuseau, d = new Date()) => Number(parties(fuseau, d.getTime()).hour) % 24;
// Décalage du fuseau sur UTC à cet instant (ms).
const decalageDans = (fuseau, ms) => {
  const p = parties(fuseau, ms);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
};
// Instant UTC (ms) d'une date et d'une heure locales dans ce fuseau.
export function instantLocal(fuseau, a, m, j, h, mi) {
  const naif = Date.UTC(a, m - 1, j, h, mi);
  const t = naif - decalageDans(fuseau, naif);
  return naif - decalageDans(fuseau, t);
}

// Heure du service : l'heure de pickup, sinon l'heure de l'activité ou le départ d'un billet. « TBC » ou vide : pas d'heure.
export function heureService(r) {
  const d = (r && r.details) || {};
  for (const brut of [r && r.heure_pickup, d.heure_service, d.depart]) {
    const m = /^\s*(\d{1,2})\s*[:.h]\s*(\d{2})(?!\d)/i.exec(String(brut || ""));
    if (m && +m[1] < 24 && +m[2] < 60) return `${m[1].padStart(2, "0")}:${m[2]}`;
  }
  return null;
}

// Instant du début du service (ms UTC), à l'heure du fuseau de l'organisation (Bangkok par défaut).
export function debutService(r, fuseau = FUSEAU_DEFAUT) {
  const h = heureService(r);
  if (!h || !/^\d{4}-\d{2}-\d{2}$/.test((r && r.date_service) || "")) return null;
  const [a, m, j] = r.date_service.split("-").map(Number);
  return instantLocal(fuseau, a, m, j, +h.slice(0, 2), +h.slice(3, 5));
}

// Allumé par défaut pour les trois entreprises (même règle que la fonction). Secret et Taxi : chaque service une heure avant ;
// ZTP : le départ du client, la veille à 18h (Jérémy, 17.11.2026).
export function rappelAvantActif(reglages) {
  const v = reglages && reglages.rappels && reglages.rappels.h1;
  return v === false ? false : true;
}
export const modeRappel = (reglages) => (["excursions", "taxi"].includes(reglages && reglages.fonctionnement) ? "service" : "depart");

// Ce qui a été fait pour le rappel d'un service (cases cochées par Anaïs, gardées dans reservations.details).
export const etatRappel = (r) => ({ client: ((r && r.details) || {}).rappel_client_le || null, partenaire: ((r && r.details) || {}).rappel_partenaire_le || null });

// Services qui commencent dans les `heures` prochaines heures (ou ont commencé il y a moins de `apres` minutes), pas annulés, avec une heure.
export function prochainsServices(reservations, maintenant, { heures = 2, apres = 15, ecartes = new Set(), fuseau = FUSEAU_DEFAUT } = {}) {
  return reservations
    .filter((r) => r.statut !== "annule" && !ecartes.has(r.dossier_id) && !estFraisDeParc(r))
    .map((r) => ({ reservation: r, debut: debutService(r, fuseau) }))
    .filter((x) => x.debut !== null && x.debut - maintenant <= heures * 3600000 && maintenant - x.debut <= apres * 60000)
    .map((x) => ({ ...x, minutes: Math.round((x.debut - maintenant) / 60000) }))
    .sort((a, b) => a.debut - b.debut);
}

// Ce qu'on sait de ce qu'il faut emporter ou prévoir, tiré des données (jamais inventé) : passeport pour une destination à passeport
// (`destinations` : reglages.destinations_passeport), check-in d'un billet de bateau,
// frais de parc non inclus, remarques du voucher. En anglais pour Secret et Taxi, comme les vouchers.
export function aPrevoir(r, { prestation = null, partenaire = null, trajet = null, destinations = [] } = {}) {
  const out = [];
  const d = (r && r.details) || {};
  const passeport = notePasseport({ de: trajet && trajet.de, vers: trajet && trajet.vers, libelle: r.libelle, partenaire, destinations });
  if (passeport) out.push(passeport);
  else if (typeVoucher(r, prestation, partenaire) === "billet") out.push(consigneCheckinFiche(partenaire, trajet || {}, destinations));
  const parc = fraisDeParc(prestation);
  const parcTexte = (parc.texte || "").replace(/\.\s*,/g, ",").replace(/\.$/, "");
  if (parc.inclus === false && parcTexte) out.push(/park fee/i.test(parcTexte) ? `${parcTexte}.` : `National park fee not included: ${parcTexte}.`);
  if ((d.remarques || "").trim()) out.push(d.remarques.trim());
  return out;
}

// Rappel au client, une heure avant : l'heure, le lieu de prise en charge, les personnes, ce qu'il faut prévoir s'il est connu.
export function texteRappelClient(r, { prenom = "", lieu = "", entreprise = "", langue = "en", prevoir = [] } = {}) {
  const heure = heureService(r);
  const service = langue === "fr" ? r.libelle : libelleClient(r.libelle || "");
  const gens = personnesTexte(r.personnes, langue);
  if (langue === "fr")
    return [`Bonjour ${prenom || ""}`.trim() + ",", "", `Petit rappel pour tout à l'heure : ${service}.`, heure ? `Prise en charge à ${heure}${lieu ? ` à ${lieu}` : ""}. Merci d'être prêt quelques minutes avant.` : "", gens ? `Pour ${gens}.` : "", ...prevoir, "", "À tout à l'heure,", entreprise].filter((l, i, t) => l !== "" || (t[i - 1] !== "" && i > 0)).join("\n").trim();
  return [`Hello ${prenom || ""}`.trim() + ",", "", `A quick reminder for today: ${service}.`, heure ? `Pickup at ${heure}${lieu ? ` from ${lieu}` : ""}. Please be ready a few minutes early.` : "", gens ? `For ${gens}.` : "", ...prevoir, "", "See you soon,", entreprise].filter((l, i, t) => l !== "" || (t[i - 1] !== "" && i > 0)).join("\n").trim();
}

// Pour le partenaire : rien de rédigé, seulement ce qu'Anaïs doit avoir sous les yeux pour lui écrire ou l'appeler elle-même.
export function detailsPartenaire(r, partenaire) {
  if (!partenaire) return null;
  const c = partenaire.contact || {};
  const telephones = (c.telephones || []).map((t) => (typeof t === "string" ? { numero: t } : t)).filter((t) => t && String(t.numero || "").trim());
  return { nom: partenaire.nom || "", personne: (c.personne || "").trim(), telephones, heure: heureService(r), date: r.date_service || "", personnes: r.personnes || {}, lieu: (r.lieu_pickup || "").trim(), service: r.libelle || "" };
}
