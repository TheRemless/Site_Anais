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
// Entreprises dont le rappel du départ de demain (ZTP) part à cette heure (`heure` = null : envoi forcé de la veille, toutes), d'après
// { entite_id: reglages.valeur }. Il part avec le passage de la veille, à l'heure de la veille de l'entreprise ; si la veille est coupée, à 18 h,
// puisqu'il a son propre interrupteur (rappels.h1). Sans réglage : 18 h, comme avant le lot G.
export function entitesDuDepart(heure, entiteIds, valeurs = {}) {
  return entiteIds.filter((id) => {
    const v = valeurs[id];
    if (!rappelAvantActif(v) || modeRappel(v) !== "depart") return false;
    const h = heuresRappels(v && v.rappels).veille;
    return heure === null || (h === null ? HEURES_DEFAUT.veille : h) === heure;
  });
}

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

const personnesFr = (p = {}) => [p.adultes ? pluriel(p.adultes, ["adulte", "adultes"]) : "", p.enfants ? pluriel(p.enfants, ["enfant", "enfants"]) : "", p.bebes ? pluriel(p.bebes, ["bébé", "bébés"]) : ""].filter(Boolean).join(", ");

// « Dans 1 h : Sarah Miller, 4 Islands » / « 2 adultes, pickup 08:00, Hotel Sunset ». Le nom du client y est (Jérémy, 17.11.2026 : le téléphone
// d'Anaïs ne montre le contenu d'une notification qu'une fois déverrouillé). `entreprise` : ajouté pour qui suit plusieurs entreprises.
// Quand commence le service, dit comme le cron le dit (« Dans 1 h » de 55 à 60 minutes). Hors de la fenêtre, pour un envoi forcé : « Dans 2 h 05 »,
// « Maintenant », « Commencé il y a 10 min ».
export function quandH1(minutes) {
  if (minutes >= 55 && minutes <= 60) return "Dans 1 h";
  if (minutes > 60) return `Dans ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
  if (minutes > 0) return `Dans ${minutes} min`;
  if (minutes === 0) return "Maintenant";
  return `Commencé il y a ${-minutes} min`;
}

export function messageH1({ reservation: r, minutes }, { entreprise = "", client = "" } = {}) {
  const quand = quandH1(minutes);
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

// Qui reçoit le rappel d'un service d'une entreprise : ceux qui reçoivent ses rappels (entitesLisibles), sauf qui a coupé « Rappel 1 h avant » dans son profil.
export function destinatairesH1({ profils, membres, roles }, entiteId) {
  return profils.filter((p) => p.rappel_h1 !== false).filter((profil) => {
    const ids = entitesLisibles({ profil, membres, roles });
    return ids === null ? !!(profil.actif) : ids.includes(entiteId);
  }).map((p) => p.user_id);
}

// Envoi forcé (après un déploiement, pour vérifier sur le téléphone d'Anaïs) : un service donné, tout de suite, hors de la fenêtre.
// Mêmes refus que le cron, sauf l'heure : service annulé, dossier annulé, frais de parc, pas d'heure, entreprise sans rappel une heure avant.
// Renvoie { service } (même forme que servicesH1) ou { erreur }.
export function serviceForce(r, maintenant, { dossierAnnule = false, reglages = null } = {}) {
  if (!r) return { erreur: "service_introuvable" };
  if (r.statut === "annule" || dossierAnnule) return { erreur: "service_annule" };
  if (estFraisDeParc(r)) return { erreur: "frais_de_parc" };
  if (modeRappel(reglages) !== "service") return { erreur: "entreprise_sans_rappel_h1" };
  if (!rappelAvantActif(reglages)) return { erreur: "rappel_eteint" };
  const debut = debutService(r);
  if (debut === null) return { erreur: "service_sans_heure" };
  return { service: { reservation: r, debut, minutes: Math.round((debut - maintenant) / 60000) } };
}
