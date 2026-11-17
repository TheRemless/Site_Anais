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

// ---- Rappel une heure avant chaque service (« h1 », migration 31) ------------------------------------------------------------------
// pg_cron appelle la fonction toutes les 5 minutes. Un service part dans la notification quand son début (date + heure, à Bangkok) arrive
// dans 60 minutes au plus. La borne basse est à 40 minutes et non à 55 : une exécution en retard ou manquée (pg_net, coupure) rattrape le
// service au passage suivant au lieu de le perdre ; le marquage (table rappels_h1_envois, une ligne par service et par heure) garantit
// qu'il n'est notifié qu'une fois. La même logique est recopiée dans l'outil (src/gestion/js/rappel-h1-calc.mjs), un test vérifie l'accord.
export const FENETRE_H1 = { max: 60, min: 40 };

// Heure du service : l'heure de pickup, sinon l'heure de l'activité ou le départ d'un billet de bateau (champs du voucher).
// « 8:00 », « 08.30 », « 9h15 » sont lus ; « TBC », vide ou une heure impossible : pas d'heure, donc pas de rappel une heure avant.
export function heureService(r) {
  const d = (r && r.details) || {};
  for (const brut of [r && r.heure_pickup, d.heure_service, d.depart]) {
    const m = /^\s*(\d{1,2})\s*[:.h]\s*(\d{2})(?!\d)/i.exec(String(brut || ""));
    if (m && +m[1] < 24 && +m[2] < 60) return `${m[1].padStart(2, "0")}:${m[2]}`;
  }
  return null;
}

// Instant du début du service (millisecondes UTC). Bangkok est à UTC+7 toute l'année.
export function debutService(r) {
  const h = heureService(r);
  if (!h || !/^\d{4}-\d{2}-\d{2}$/.test((r && r.date_service) || "")) return null;
  const [a, m, j] = r.date_service.split("-").map(Number);
  return Date.UTC(a, m - 1, j, +h.slice(0, 2), +h.slice(3, 5)) - DECALAGE_BANGKOK;
}

// Réglage de l'entreprise (valeur.rappels.h1), allumé par défaut partout. Ce qu'il rappelle dépend du métier (Jérémy, 17.11.2026) :
// Secret et Taxi, chaque service une heure avant ; ZTP (voyages sur mesure), le départ du client la veille, au passage de 18h.
export function rappelAvantActif(reglages) {
  const v = reglages && reglages.rappels && reglages.rappels.h1;
  return v === false ? false : true;
}
export const modeRappel = (reglages) => (["excursions", "taxi"].includes(reglages && reglages.fonctionnement) ? "service" : "depart");

// Services à notifier maintenant : pas annulés, dossier pas annulé, pas des frais de parc, avec une heure, début dans la fenêtre.
export function servicesH1(reservations, maintenant, { ecartes = new Set(), fenetre = FENETRE_H1 } = {}) {
  const out = [];
  for (const r of reservations) {
    if (r.statut === "annule" || ecartes.has(r.dossier_id) || estFraisDeParc(r)) continue;
    const debut = debutService(r);
    if (debut === null) continue;
    const minutes = Math.round((debut - maintenant) / 60000);
    if (minutes <= fenetre.max && minutes >= fenetre.min) out.push({ reservation: r, debut, minutes });
  }
  return out.sort((a, b) => a.debut - b.debut);
}

// Dates à charger pour trouver les services de l'heure qui vient : aujourd'hui et demain à Bangkok (vers minuit, le service est déjà le lendemain).
export const datesH1 = (maintenant) => {
  const ajd = dateBangkok(new Date(maintenant));
  return [ajd, decaler(ajd, 1)];
};

const personnesFr = (p = {}) => [p.adultes ? pluriel(p.adultes, "adulte", "adultes") : "", p.enfants ? pluriel(p.enfants, "enfant", "enfants") : "", p.bebes ? pluriel(p.bebes, "bébé", "bébés") : ""].filter(Boolean).join(", ");

// « Dans 1 h : Sarah Miller, 4 Islands » / « 2 adultes, pickup 08:00, Hotel Sunset ». Le nom du client y est (Jérémy, 17.11.2026 : le téléphone
// d'Anaïs ne montre le contenu d'une notification qu'une fois déverrouillé). `entreprise` : ajouté pour qui suit plusieurs entreprises.
export function messageH1({ reservation: r, minutes }, { entreprise = "", client = "" } = {}) {
  const quand = minutes >= 55 ? "Dans 1 h" : `Dans ${minutes} min`;
  const heure = heureService(r);
  const corps = [entreprise, personnesFr(r.personnes || {}), heure ? `pickup ${heure}` : "", (r.lieu_pickup || "").trim()].filter(Boolean).join(", ");
  return { titre: `${quand} : ${[client, r.libelle].filter(Boolean).join(", ")}`, corps, tag: `h1-${r.id}`, url: `/gestion/#/reservation/${r.id}?entite=${r.entite_id}` };
}

export const nomClient = (c) => (c ? [c.prenom, c.nom].filter(Boolean).join(" ").trim() : "");
// Titre d'un voyage d'après le dossier (même règle que voyageTexte dans l'outil) : « VOYAGE EN THAÏLANDE - DÉCEMBRE 2026 » → « Thaïlande - décembre 2026 ».
export function voyageTexte(bandeau, pays) {
  if (!bandeau) return pays || "";
  const sans = bandeau.replace(/^VOYAGE (EN|AU)\s+/i, "");
  const t = sans === sans.toUpperCase() ? sans.toLowerCase() : sans;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ---- ZTP : la veille du départ (18h, avec le rappel « veille ») ----------------------------------------------------------------------
// Un voyage part demain : dossier accepté, pas annulé, pas classé sans suite, avec cette date de départ. Une notification par dossier et par
// date de départ (table rappels_depart_envois) : une date changée en donne une nouvelle.
export function departsDemain(dossiers, demain) {
  return dossiers.filter((d) => d.date_depart === demain && !d.annule && d.accepte_le && !d.sans_suite_le);
}
// « Demain : départ de famille Dupont » / « Thaïlande - décembre 2026 ». Le dossier ne dit ni l'itinéraire ni le nombre de voyageurs : rien d'inventé.
export function messageDepart(d, { client = "", entreprise = "" } = {}) {
  const corps = [entreprise, voyageTexte(d.bandeau, d.pays), d.ref].filter(Boolean).join(", ");
  return { titre: `Demain : départ de ${client || d.ref}`, corps, tag: `depart-${d.id}`, url: `/gestion/#/dossier/${d.id}?entite=${d.entite_id}` };
}

// Notification test (bouton de Jérémy dans les réglages) : exactement la forme d'un rappel « Dans 1 h », marquée [TEST], avec des détails fictifs.
// Elle ouvre les réglages, jamais une vraie réservation.
export function messageTest() {
  return { titre: "[TEST] Dans 1 h : Sarah Miller, 4 Islands", corps: "2 adultes, pickup 08:00, Hotel Sunset", tag: "test", url: "/gestion/#/reglages" };
}

// Qui reçoit le rappel d'un service d'une entreprise : ceux qui reçoivent ses rappels (entitesLisibles), sauf qui a coupé « Rappel 1 h avant » dans son profil.
export function destinatairesH1({ profils, membres, roles }, entiteId) {
  return profils.filter((p) => p.rappel_h1 !== false).filter((profil) => {
    const ids = entitesLisibles({ profil, membres, roles });
    return ids === null ? !!(profil.actif) : ids.includes(entiteId);
  }).map((p) => p.user_id);
}
