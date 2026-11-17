// Rappel une heure avant chaque service (migration 31) : la logique pure de l'outil.
// Heure et début d'un service (recopie de supabase/functions/rappels/calc.js, un test vérifie l'accord), services des deux prochaines heures,
// texte du rappel au client (prêt à copier, jamais envoyé seul) et détails utiles pour le partenaire. Rien n'est écrit pour le partenaire
// (Jérémy, 14.11.2026 : Anaïs lui écrit elle-même) : seulement son nom, son téléphone et ce qu'il faut lui dire.
import { personnesTexte, consigneCheckin, notePasseport, fraisDeParc, typeVoucher, estFraisDeParc } from "./operations-calc.mjs";
import { libelleClient } from "./partenaires-calc.mjs";

const DECALAGE_BANGKOK = 7 * 3600 * 1000;

// Heure du service : l'heure de pickup, sinon l'heure de l'activité ou le départ d'un billet. « TBC » ou vide : pas d'heure.
export function heureService(r) {
  const d = (r && r.details) || {};
  for (const brut of [r && r.heure_pickup, d.heure_service, d.depart]) {
    const m = /^\s*(\d{1,2})\s*[:.h]\s*(\d{2})(?!\d)/i.exec(String(brut || ""));
    if (m && +m[1] < 24 && +m[2] < 60) return `${m[1].padStart(2, "0")}:${m[2]}`;
  }
  return null;
}

// Instant du début du service (ms UTC), Bangkok à UTC+7 toute l'année.
export function debutService(r) {
  const h = heureService(r);
  if (!h || !/^\d{4}-\d{2}-\d{2}$/.test((r && r.date_service) || "")) return null;
  const [a, m, j] = r.date_service.split("-").map(Number);
  return Date.UTC(a, m - 1, j, +h.slice(0, 2), +h.slice(3, 5)) - DECALAGE_BANGKOK;
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
export function prochainsServices(reservations, maintenant, { heures = 2, apres = 15, ecartes = new Set() } = {}) {
  return reservations
    .filter((r) => r.statut !== "annule" && !ecartes.has(r.dossier_id) && !estFraisDeParc(r))
    .map((r) => ({ reservation: r, debut: debutService(r) }))
    .filter((x) => x.debut !== null && x.debut - maintenant <= heures * 3600000 && maintenant - x.debut <= apres * 60000)
    .map((x) => ({ ...x, minutes: Math.round((x.debut - maintenant) / 60000) }))
    .sort((a, b) => a.debut - b.debut);
}

// Ce qu'on sait de ce qu'il faut emporter ou prévoir, tiré des données (jamais inventé) : passeport pour Langkawi, check-in d'un billet de bateau,
// frais de parc non inclus, remarques du voucher. En anglais pour Secret et Taxi, comme les vouchers.
export function aPrevoir(r, { prestation = null, partenaire = null, trajet = null } = {}) {
  const out = [];
  const d = (r && r.details) || {};
  const passeport = notePasseport({ de: trajet && trajet.de, vers: trajet && trajet.vers, libelle: r.libelle, compagnie: (partenaire && partenaire.nom) || "" });
  if (passeport) out.push(passeport);
  else if (typeVoucher(r, prestation, partenaire) === "billet") out.push(consigneCheckin((partenaire && partenaire.nom) || "", trajet || {}));
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
