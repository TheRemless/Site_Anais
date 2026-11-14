// Rappels de Gestion : la logique pure (dates à Bangkok, quelles entreprises voit une personne, texte des deux notifications).
// Aucune dépendance : le même fichier sert à la fonction Supabase et aux tests. Pas de nom de client dans les textes,
// car une notification passe par les serveurs d'Apple et de Google.

const DECALAGE_BANGKOK = 7 * 3600 * 1000;

export const dateBangkok = (d = new Date()) => new Date(d.getTime() + DECALAGE_BANGKOK).toISOString().slice(0, 10);
export const decaler = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

// Entreprises dont une personne reçoit les rappels : toutes pour un super administrateur, sinon celles où son rôle lit tous les dossiers.
// Un rôle « vouchers.seul » (l'assistante thaïe de Taxi, écran voucher seul) n'en reçoit pas : la notification est en français et ouvre un écran qu'elle n'a pas.
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

// `fin` : on cherche les services qui se terminent ce jour-là (rappel de 9h) et non ceux qui commencent ce jour-là (rappel de 18h).
function servicesDuJour(reservations, date, { entiteIds, ecartes }, fin = false) {
  return reservations.filter((r) => (fin ? dateFinService(r) : r.date_service) === date && r.statut !== "annule" && !ecartes.has(r.dossier_id) && !estFraisDeParc(r) && (entiteIds === null || entiteIds.includes(r.entite_id)));
}

function ventilation(liste, nomEntite, compter = (rs) => rs.length) {
  const ids = [...new Set(liste.map((r) => r.entite_id))];
  if (ids.length < 2) return "";
  return ids.map((id) => `${nomEntite(id)} ${compter(liste.filter((r) => r.entite_id === id))}`).join(", ") + ".";
}

// 18h : les services du lendemain et ce qui manque pour qu'ils partent bien.
export function rappelVeille(reservations, demain, { entiteIds, ecartes = new Set(), nomEntite = () => "" }) {
  const liste = servicesDuJour(reservations, demain, { entiteIds, ecartes });
  if (!liste.length) return null;
  const sansHeure = liste.filter((r) => !(r.heure_pickup || "").trim()).length;
  const manque = [];
  if (sansHeure) manque.push(`${sansHeure} sans heure de pickup`);
  const etat = manque.length ? `${manque.join(", ")}.` : "Chaque pickup a une heure.";
  return { titre: `${pluriel(liste.length, "service", "services")} demain`, corps: [ventilation(liste, nomEntite), etat].filter(Boolean).join(" "), tag: "veille" };
}

// 9h : les clients dont un service s'est terminé la veille (le retour pour une location), à qui écrire pour savoir comment c'était.
export function rappelLendemain(reservations, hier, { entiteIds, ecartes = new Set(), nomEntite = () => "" }) {
  const liste = servicesDuJour(reservations, hier, { entiteIds, ecartes }, true);
  if (!liste.length) return null;
  const dossiers = (rs) => new Set(rs.map((r) => r.dossier_id)).size;
  return { titre: `${pluriel(dossiers(liste), "client", "clients")} à recontacter`, corps: [ventilation(liste, nomEntite, dossiers), "Services d'hier : demandez-leur comment c'était."].filter(Boolean).join(" "), tag: "lendemain" };
}

export function rappelDuType(type, reservations, aujourdhui, options) {
  if (type === "veille") return rappelVeille(reservations, decaler(aujourdhui, 1), options);
  if (type === "lendemain") return rappelLendemain(reservations, decaler(aujourdhui, -1), options);
  return null;
}

// Dates de services à charger pour un type de rappel.
export const dateCible = (type, aujourdhui) => (type === "veille" ? decaler(aujourdhui, 1) : type === "lendemain" ? decaler(aujourdhui, -1) : null);
