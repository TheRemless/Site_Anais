// Rappels de Gestion : la logique pure (dates et heures dans le fuseau de chaque organisation, heures réglées par entreprise, quelles entreprises voit une personne,
// texte des deux notifications dans sa langue).
// Aucune dépendance : le même fichier sert à la fonction Supabase et aux tests. Pas de nom de client dans les textes,
// car une notification passe par les serveurs d'Apple et de Google.

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

export const dateBangkok = (d = new Date()) => dateDans(FUSEAU_DEFAUT, d);
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
export const heureBangkok = (d = new Date()) => heureDans(FUSEAU_DEFAUT, d);

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

// Entreprises dont une personne reçoit les rappels : pour un super administrateur, celles de son organisation (toutes si la liste des entreprises
// n'est pas fournie) ; sinon celles où elle est administratrice (rôle « tous les droits » de la migration 38, ou droit « Modifier les réglages
// de l'entreprise »), avec un rôle qui lit tous les dossiers.
// Jérémy, 17.11.2026 : les rappels sont pour Anaïs, pas pour les autres utilisateurs (Mook, éditeurs, lecteurs). Même critère que estAdmin() dans l'outil.
// Un rôle « vouchers.seul » (l'assistante thaïe de Taxi, écran voucher seul) n'en reçoit pas non plus.
export function entitesLisibles({ profil, membres, roles, entites }) {
  if (!profil || !profil.actif) return [];
  if (profil.super_admin) return entites ? entites.filter((e) => e.organisation_id === profil.organisation_id).map((e) => e.id) : null;
  const roleDe = new Map(roles.map((r) => [r.id, r]));
  return membres
    .filter((m) => m.user_id === profil.user_id)
    .filter((m) => {
      const r = roleDe.get(m.role_id);
      if (!r || r.portee !== "toute") return false;
      const perms = r.permissions || [];
      const administratrice = r.tous_droits === true || perms.includes("reglages.ecrire");
      return administratrice && (r.tous_droits === true || perms.includes("dossiers.lire")) && !perms.includes("vouchers.seul");
    })
    .map((m) => m.entite_id);
}

// Frais de parc : une somme à payer sur l'île, pas un service qui part (même règle que dans l'outil, operations-calc.mjs).
// Le libellé EST un frais (revue du 24.11.2026) : le mot-clé ouvre ou ferme la partie principale du libellé, celle avant une parenthèse ou une
// flèche. « Koh Rok park fee », « Frais d'entrée du parc », « National park fees: 4 Islands » sont des frais ; « Private taxi: Hotel → Tiger Cave
// Temple (entrance fee not included) », « Temple tour incl. entrance fee » ou une course vers un parc n'en sont pas. Même motif et même découpe
// dans src/gestion/js/operations-calc.mjs et la migration 128 (frais_de_parc_libelle) : un test compare les trois.
export const MOTIF_FRAIS_PARC = "frais (de|du) parc|frais d['’]entr[ée]e|(national )?park (entrance )?fees?|entrance fees?|droits? (d['’]entr[ée]e|(de|du) parc)";
const FRAIS_DEBUT = new RegExp(`^\\s*(${MOTIF_FRAIS_PARC})`, "i");
const FRAIS_FIN = new RegExp(`(${MOTIF_FRAIS_PARC})[\\s.!]*$`, "i");
const FRAIS_ACCOMPAGNE = new RegExp(`(incl\\.?|including|included|with|without|not|plus|avec|sans|compris|inclus|\\+)\\s*(${MOTIF_FRAIS_PARC})[\\s.!]*$`, "i");
export const partiePrincipale = (libelle) => String(libelle || "").split(/\(|→|->/)[0].trim();
export const libelleEstFrais = (libelle) => {
  const p = partiePrincipale(libelle);
  return FRAIS_DEBUT.test(p) || (FRAIS_FIN.test(p) && !FRAIS_ACCOMPAGNE.test(p));
};
// Ancien nom gardé pour les imports : le motif seul (il ne suffit plus, voir libelleEstFrais).
export const FRAIS_PARC = new RegExp(MOTIF_FRAIS_PARC, "i");
const estFraisDeParc = (r) => !r.partenaire_id && libelleEstFrais(r.libelle);

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

// Instant du début du service (millisecondes UTC), à l'heure du fuseau de son organisation (Bangkok par défaut).
export function debutService(r, fuseau = FUSEAU_DEFAUT) {
  const h = heureService(r);
  if (!h || !/^\d{4}-\d{2}-\d{2}$/.test((r && r.date_service) || "")) return null;
  const [a, m, j] = r.date_service.split("-").map(Number);
  return instantLocal(fuseau, a, m, j, +h.slice(0, 2), +h.slice(3, 5));
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
// puisqu'il a son propre interrupteur (rappels.h1). Une entreprise sans ligne de réglages n'en a pas (comme avant la fusion).
export const heureDepart = (rappels) => {
  const h = heuresRappels(rappels).veille;
  return h === null ? HEURES_DEFAUT.veille : h;
};
export function entitesDuDepart(heure, entiteIds, valeurs = {}) {
  return entiteIds.filter((id) => {
    if (!Object.prototype.hasOwnProperty.call(valeurs, id)) return false;
    const v = valeurs[id];
    if (!rappelAvantActif(v) || modeRappel(v) !== "depart") return false;
    return heure === null || heureDepart(v && v.rappels) === heure;
  });
}

// Services à notifier maintenant : pas annulés, dossier pas annulé, pas des frais de parc, avec une heure, début dans la fenêtre.
// `fuseauDe(entite_id)` : le fuseau de l'organisation de l'entreprise du service.
export function servicesH1(reservations, maintenant, { ecartes = new Set(), fenetre = FENETRE_H1, fuseauDe = () => FUSEAU_DEFAUT } = {}) {
  const out = [];
  for (const r of reservations) {
    if (r.statut === "annule" || ecartes.has(r.dossier_id) || estFraisDeParc(r)) continue;
    const debut = debutService(r, fuseauDe(r.entite_id));
    if (debut === null) continue;
    const minutes = Math.round((debut - maintenant) / 60000);
    if (minutes <= fenetre.max && minutes >= fenetre.min) out.push({ reservation: r, debut, minutes });
  }
  return out.sort((a, b) => a.debut - b.debut);
}

// Dates à charger pour trouver les services de l'heure qui vient : aujourd'hui et demain dans chaque fuseau (vers minuit, le service est déjà le lendemain).
export const datesH1 = (maintenant, fuseaux = [FUSEAU_DEFAUT]) => {
  const dates = new Set();
  for (const z of fuseaux.length ? fuseaux : [FUSEAU_DEFAUT]) {
    const ajd = dateDans(z, new Date(maintenant));
    dates.add(ajd).add(decaler(ajd, 1));
  }
  return [...dates].sort();
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
export function destinatairesH1({ profils, membres, roles, entites }, entiteId) {
  return profils.filter((p) => p.rappel_h1 !== false).filter((profil) => {
    const ids = entitesLisibles({ profil, membres, roles, entites });
    return ids === null ? !!(profil.actif) : ids.includes(entiteId);
  }).map((p) => p.user_id);
}

// Envoi forcé (après un déploiement, pour vérifier sur le téléphone d'Anaïs) : un service donné, tout de suite, hors de la fenêtre.
// Mêmes refus que le cron, sauf l'heure : service annulé, dossier annulé, frais de parc, pas d'heure, entreprise sans rappel une heure avant.
// Renvoie { service } (même forme que servicesH1) ou { erreur }.
export function serviceForce(r, maintenant, { dossierAnnule = false, reglages = null, fuseau = FUSEAU_DEFAUT } = {}) {
  if (!r) return { erreur: "service_introuvable" };
  if (r.statut === "annule" || dossierAnnule) return { erreur: "service_annule" };
  if (estFraisDeParc(r)) return { erreur: "frais_de_parc" };
  if (modeRappel(reglages) !== "service") return { erreur: "entreprise_sans_rappel_h1" };
  if (!rappelAvantActif(reglages)) return { erreur: "rappel_eteint" };
  const debut = debutService(r, fuseau);
  if (debut === null) return { erreur: "service_sans_heure" };
  return { service: { reservation: r, debut, minutes: Math.round((debut - maintenant) / 60000) } };
}
