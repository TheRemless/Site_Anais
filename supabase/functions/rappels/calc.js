// Rappels de Gestion : la logique pure (dates et heures à Bangkok, heures réglées par entreprise, quelles entreprises voit une personne,
// texte des deux notifications dans sa langue).
// Aucune dépendance : le même fichier sert à la fonction Supabase et aux tests. Pas de nom de client dans les textes,
// car une notification passe par les serveurs d'Apple et de Google.

const DECALAGE_BANGKOK = 7 * 3600 * 1000;

export const dateBangkok = (d = new Date()) => new Date(d.getTime() + DECALAGE_BANGKOK).toISOString().slice(0, 10);
export const decaler = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);

// Textes des notifications dans la langue de la personne (profils.langue, français par défaut). Les rôles « vouchers.seul » (écran thaï) n'en reçoivent pas.
const TEXTES = {
  fr: {
    service: ["service", "services"], demain: "demain", sansHeure: "sans heure de pickup", sansLieu: "sans lieu de pickup", toutVa: "Chaque pickup a une heure et un lieu.",
    client: ["client", "clients"], aRecontacter: "à recontacter", hier: "Services d'hier : demandez-leur comment c'était.",
  },
  en: {
    service: ["service", "services"], demain: "tomorrow", sansHeure: "without a pickup time", sansLieu: "without a pickup place", toutVa: "Every pickup has a time and a place.",
    client: ["client", "clients"], aRecontacter: "to contact again", hier: "Yesterday's services: ask them how it went.",
  },
};
const textes = (langue) => TEXTES[langue] || TEXTES.fr;
const pluriel = (n, [un, plusieurs]) => `${n} ${n > 1 ? plusieurs : un}`;

// Heures des rappels, réglables par entreprise (reglages.valeur.rappels = { veille, lendemain }, heure de Bangkok de 0 à 23, null = coupé).
// Sans réglage : 18 h la veille et 9 h le lendemain, comme avant (17.11.2026, audit section 2).
export const HEURES_DEFAUT = { veille: 18, lendemain: 9 };
export const TYPES = ["veille", "lendemain"];
export function heuresRappels(reglage) {
  const r = reglage && typeof reglage === "object" ? reglage : {};
  const heure = (v, defaut) => (v === undefined ? defaut : v === null || v === false || v === "" ? null : Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 23 ? Number(v) : defaut);
  return { veille: heure(r.veille, HEURES_DEFAUT.veille), lendemain: heure(r.lendemain, HEURES_DEFAUT.lendemain) };
}
export const heureBangkok = (d = new Date()) => new Date(d.getTime() + DECALAGE_BANGKOK).getUTCHours();

// Les entreprises dont le rappel `type` part à cette heure (`heure` = null : à toute heure, pour un envoi forcé), d'après { entite_id: réglage rappels }.
// Une entreprise où ce rappel est coupé n'est jamais retenue.
export function entitesDuRappel(type, heure, entiteIds, reglagesParEntite = {}) {
  return entiteIds.filter((id) => {
    const h = heuresRappels(reglagesParEntite[id])[type];
    return h !== null && (heure === null || h === heure);
  });
}
// Ce qu'une personne voit (`entiteIds`, null = tout) restreint aux entreprises du rappel en cours.
export const restreindre = (entiteIds, retenues) => (entiteIds === null ? [...retenues] : entiteIds.filter((id) => retenues.includes(id)));

// Entreprises dont une personne reçoit les rappels : toutes pour un super administrateur, sinon celles où son rôle lit tous les dossiers.
// Un rôle « vouchers.seul » (l'assistante thaïe de Taxi, écran voucher seul) n'en reçoit pas : la notification ouvre un écran qu'elle n'a pas et n'existe pas en thaï.
export function entitesLisibles({ profil, membres, roles }) {
  if (!profil || !profil.actif) return [];
  if (profil.super_admin) return null;
  const roleDe = new Map(roles.map((r) => [r.id, r]));
  return membres
    .filter((m) => m.user_id === profil.user_id)
    .filter((m) => {
      const r = roleDe.get(m.role_id);
      return r && r.portee === "toute" && (r.permissions || []).includes("dossiers.lire") && !(r.permissions || []).includes("vouchers.seul");
    })
    .map((m) => m.entite_id);
}

// Frais de parc : une somme à payer sur l'île, pas un service qui part (même règle que dans l'outil, operations-calc.mjs).
const estFraisDeParc = (r) => !r.partenaire_id && /frais de parc|park fee|national park/i.test(r.libelle || "");

// Dernier jour d'un service : le retour d'une location (details.retour_date), sinon le jour du service (même règle que dans l'outil, operations-calc.mjs).
const dateFinService = (r) => {
  const retour = r.details && r.details.retour_date;
  return /^\d{4}-\d{2}-\d{2}$/.test(retour || "") && retour > r.date_service ? retour : r.date_service;
};

// `fin` : on cherche les services qui se terminent ce jour-là (rappel du lendemain) et non ceux qui commencent ce jour-là (rappel de la veille).
function servicesDuJour(reservations, date, { entiteIds, ecartes }, fin = false) {
  return reservations.filter((r) => (fin ? dateFinService(r) : r.date_service) === date && r.statut !== "annule" && !ecartes.has(r.dossier_id) && !estFraisDeParc(r) && (entiteIds === null || entiteIds.includes(r.entite_id)));
}

function ventilation(liste, nomEntite, compter = (rs) => rs.length) {
  const ids = [...new Set(liste.map((r) => r.entite_id))];
  if (ids.length < 2) return "";
  return ids.map((id) => `${nomEntite(id)} ${compter(liste.filter((r) => r.entite_id === id))}`).join(", ") + ".";
}

// La veille : les services du lendemain et ce qui manque pour qu'ils partent bien (heure et lieu de pickup). Le lieu est celui de la feuille du jour :
// le lieu de pickup, sinon l'hôtel de la fiche client (`adresse_client`, ajoutée par la fonction).
export function rappelVeille(reservations, demain, { entiteIds, ecartes = new Set(), nomEntite = () => "", langue = "fr" }) {
  const t = textes(langue);
  const liste = servicesDuJour(reservations, demain, { entiteIds, ecartes });
  if (!liste.length) return null;
  const sansHeure = liste.filter((r) => !(r.heure_pickup || "").trim()).length;
  const sansLieu = liste.filter((r) => !(r.lieu_pickup || "").trim() && !(r.adresse_client || "").trim()).length;
  const manque = [sansHeure ? `${sansHeure} ${t.sansHeure}` : "", sansLieu ? `${sansLieu} ${t.sansLieu}` : ""].filter(Boolean);
  const etat = manque.length ? `${manque.join(", ")}.` : t.toutVa;
  return { titre: `${pluriel(liste.length, t.service)} ${t.demain}`, corps: [ventilation(liste, nomEntite), etat].filter(Boolean).join(" "), tag: "veille" };
}

// Le lendemain : les clients dont un service s'est terminé la veille (le retour pour une location), à qui écrire pour savoir comment c'était.
export function rappelLendemain(reservations, hier, { entiteIds, ecartes = new Set(), nomEntite = () => "", langue = "fr" }) {
  const t = textes(langue);
  const liste = servicesDuJour(reservations, hier, { entiteIds, ecartes }, true);
  if (!liste.length) return null;
  const dossiers = (rs) => new Set(rs.map((r) => r.dossier_id)).size;
  return { titre: `${pluriel(dossiers(liste), t.client)} ${t.aRecontacter}`, corps: [ventilation(liste, nomEntite, dossiers), t.hier].filter(Boolean).join(" "), tag: "lendemain" };
}

export function rappelDuType(type, reservations, aujourdhui, options) {
  if (type === "veille") return rappelVeille(reservations, decaler(aujourdhui, 1), options);
  if (type === "lendemain") return rappelLendemain(reservations, decaler(aujourdhui, -1), options);
  return null;
}

// Dates de services à charger pour un type de rappel.
export const dateCible = (type, aujourdhui) => (type === "veille" ? decaler(aujourdhui, 1) : type === "lendemain" ? decaler(aujourdhui, -1) : null);
