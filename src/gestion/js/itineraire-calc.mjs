// Demande de prix et d'horaires (20.11.2026), côté outil : logique pure, sans écran.
// Le client donne ses hôtels et ses dates ; l'assistant a lu les étapes, Anaïs a placé chaque hôtel sur un lieu du catalogue. Ici :
//   1. les trajets entre deux étapes (« 25.01 : Koh Lanta → Koh Phi Phi ») ;
//   2. pour chacun, les départs du catalogue et la marge (vente moins net), calculée dans le navigateur avec les nets que la personne a le droit
//      de lire : la meilleure marge pour le groupe est mise en avant, avec tous les horaires de cette compagnie ; à marge égale, ceux de toutes ;
//   3. les faits envoyés pour rédiger la réponse : dates, lieux, horaires, prix de vente. Jamais un net, une marge ni un nom de compagnie.
//   4. les services qui ouvrent « Coller une demande » déjà remplie, pour créer le dossier d'un geste.
import { proposable, trajetDisponible, sansAccents, libelleClient } from "./partenaires-calc.mjs";

// ---- Lieux --------------------------------------------------------------------------------------------------------------------------------

// Clé souple d'un lieu : « Koh Phi Phi », « Phi Phi » et « Phi Phi Island » sont le même lieu ; « Krabi » et « Krabi Airport » ne le sont pas.
export const cleLieu = (s) =>
  sansAccents(s)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !["koh", "ko", "island", "isl"].includes(w))
    .join(" ");

// Les lieux où partent ou arrivent les trajets proposables (actifs, prestataire non masqué), une seule fois chacun.
export function lieuxDuCatalogue(trajets = [], partenaires = []) {
  const vus = new Map();
  for (const t of trajets) {
    if (!proposable(t, partenaires)) continue;
    for (const l of [t.de, t.vers]) {
      const propre = String(l || "").replace(/\s+/g, " ").trim();
      if (propre && !vus.has(cleLieu(propre))) vus.set(cleLieu(propre), propre);
    }
  }
  return [...vus.values()].sort((a, b) => a.localeCompare(b, "fr"));
}

// Nom d'hôtel en clé : la table des hôtels (migration 48) le garde sous cette forme, pour retrouver « Paradise Resort Phi Phi » écrit autrement.
export const cleHotel = (s) =>
  sansAccents(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// L'hôtel déjà situé (table hotels_lieux de l'entreprise), ou null.
export const hotelConnu = (nom, lignes = []) => {
  const c = cleHotel(nom);
  return c ? lignes.find((l) => l.cle === c) || null : null;
};

// La ligne à enregistrer pour un hôtel situé par la recherche (verifie faux) ou par Anaïs (verifie vrai).
export function ligneHotel({ nom, lieu = "", zone = "", localite = "", source = null, certitude = "inconnue", verifie = false }) {
  return {
    cle: cleHotel(nom),
    nom: String(nom || "").trim().slice(0, 120),
    lieu: String(lieu || "").trim().slice(0, 80),
    zone: String(zone || "").trim().slice(0, 80),
    localite: String(localite || "").trim().slice(0, 80),
    source_url: source && source.url ? String(source.url).slice(0, 500) : "",
    source_titre: source && source.titre ? String(source.titre).slice(0, 160) : "",
    certitude: ["sure", "probable", "inconnue"].includes(certitude) ? certitude : "inconnue",
    verifie: !!verifie,
  };
}

// Les hôtels à faire chercher : ceux qui ont un nom et pas encore de lieu, sauf un hôtel déjà situé dans la table ou vérifié par une personne.
// Un hôtel que la recherche n'a pas tranché la dernière fois (ligne sans lieu, non vérifiée) peut être relancé.
export const hotelsAChercher = (etapes, lignes = []) =>
  [
    ...new Set(
      etapes
        .filter((e) => {
          if (!e.hotel || e.lieu) return false;
          const connu = hotelConnu(e.hotel, lignes);
          return !connu || (!connu.lieu && !connu.verifie);
        })
        .map((e) => e.hotel.trim())
    ),
  ].slice(0, 8);

// Une étape lue par l'assistant, complétée par ce que l'entreprise sait déjà : l'hôtel de la table, sinon le lieu écrit par le client
// s'il est un lieu du catalogue (« Koh Lanta »). `origine` dit d'où vient le lieu, pour l'afficher.
export function completerEtape(e, { lignes = [], lieux = [] } = {}) {
  const base = { hotel: e.hotel || "", lieu_ecrit: e.lieu_ecrit || "", du: e.du || "", au: e.au || "", lieu: "", zone: "", localite: "", source: null, certitude: "", explication: "", verifie: false, origine: "" };
  const connu = hotelConnu(base.hotel, lignes);
  if (connu && (connu.lieu || connu.verifie)) return { ...base, lieu: connu.lieu, zone: connu.zone || "", localite: connu.localite || "", source: connu.source_url ? { url: connu.source_url, titre: connu.source_titre || connu.source_url } : null, certitude: connu.certitude || "", verifie: !!connu.verifie, origine: "table" };
  const ecrit = base.lieu_ecrit && lieux.find((l) => cleLieu(l) === cleLieu(base.lieu_ecrit));
  if (ecrit) return { ...base, lieu: ecrit, origine: "message" };
  return base;
}

// ---- 1. Trajets entre les étapes -------------------------------------------------------------------------------------------------------

// Un trajet entre chaque étape et la suivante, le jour où le client change d'hôtel. Deux hôtels du même lieu : pas de trajet de bateau
// (`memeLieu`), un transfert d'hôtel à hôtel éventuel se règle à la main. Une étape sans lieu laisse le trajet incomplet.
export function trajetsEntreEtapes(etapes = []) {
  const out = [];
  for (let i = 0; i + 1 < etapes.length; i++) {
    const a = etapes[i];
    const b = etapes[i + 1];
    const date = b.du || a.au || "";
    out.push({
      index: i,
      date,
      de: a.lieu || "",
      vers: b.lieu || "",
      deHotel: a.hotel || "",
      versHotel: b.hotel || "",
      incomplet: !a.lieu || !b.lieu,
      memeLieu: !!a.lieu && !!b.lieu && cleLieu(a.lieu) === cleLieu(b.lieu),
      // « du 21 au 25 » puis « du 26 au 28 » : une nuit manque ou les dates se chevauchent, à vérifier avec le client.
      ecartDates: !!a.au && !!b.du && a.au !== b.du,
    });
  }
  return out;
}

// ---- 2. Départs du catalogue et marge ------------------------------------------------------------------------------------------------

const nombre = (x) => (x === null || x === undefined || x === "" || Number.isNaN(Number(x)) ? null : Number(x));
const heure = (s) => String(s || "").slice(0, 5);

// La marge d'un départ pour le groupe : adultes × marge adulte + enfants × marge enfant. Sans personnes connues, un adulte.
// null quand un net manque (la personne n'a pas le droit de les lire, ou le net n'est pas saisi) : le départ n'est pas classé.
export function margeDepart(t, net, { adultes = 0, enfants = 0 } = {}) {
  const pa = nombre(t.prix_adulte);
  const na = net ? nombre(net.net_adulte) : null;
  if (pa === null || na === null) return null;
  const adulte = pa - na;
  const pe = nombre(t.prix_enfant);
  const ne = net ? nombre(net.net_enfant) : null;
  const enfant = pe !== null && ne !== null ? pe - ne : null;
  if (enfants > 0 && pe !== null && enfant === null) return null;
  const a = adultes > 0 || enfants > 0 ? adultes : 1;
  return { adulte, enfant, groupe: a * adulte + (enfants > 0 && enfant !== null ? enfants * enfant : 0) };
}

// Les départs d'un trajet (lieux comparés par clé souple, date dans une fenêtre de circulation) et la proposition :
//   retenus : les départs des compagnies à la meilleure marge pour le groupe (à marge égale, plusieurs compagnies), rangés par heure ;
//   autres  : le reste, par compagnie, pour qu'Anaïs voie ce qu'elle écarte ;
//   sansMarge : aucun net lisible, tous les départs sont retenus sans classement.
// `netDe(t)` : la ligne de trajets_nets du trajet ou null. `nomPartenaire(id)` : son nom, pour l'écran seulement.
export function departsDuTrajet(leg, { trajets = [], partenaires = [], netDe = () => null, nomPartenaire = () => "", adultes = 0, enfants = 0 } = {}) {
  if (!leg || leg.incomplet || leg.memeLieu) return { candidats: [], retenus: [], autres: [], sansMarge: false };
  const de = cleLieu(leg.de);
  const vers = cleLieu(leg.vers);
  const candidats = trajets
    .filter((t) => proposable(t, partenaires) && cleLieu(t.de) === de && cleLieu(t.vers) === vers && trajetDisponible(t, leg.date))
    .map((t) => ({ trajet: t, marge: margeDepart(t, netDe(t), { adultes, enfants }) }))
    .sort((a, b) => heure(a.trajet.depart).localeCompare(heure(b.trajet.depart)));
  if (!candidats.length) return { candidats, retenus: [], autres: [], sansMarge: false };
  const parCie = new Map();
  for (const c of candidats) {
    const id = c.trajet.partenaire_id || "";
    const r = parCie.get(id) || { partenaireId: id, nom: nomPartenaire(id) || "", departs: [], meilleure: null };
    r.departs.push(c);
    if (c.marge && (!r.meilleure || c.marge.groupe > r.meilleure.groupe)) r.meilleure = c.marge;
    parCie.set(id, r);
  }
  const cies = [...parCie.values()];
  const connues = cies.filter((c) => c.meilleure);
  if (!connues.length) return { candidats, retenus: candidats, autres: [], sansMarge: true };
  const top = Math.max(...connues.map((c) => c.meilleure.groupe));
  const gagnantes = new Set(connues.filter((c) => c.meilleure.groupe === top).map((c) => c.partenaireId));
  const retenus = candidats.filter((c) => gagnantes.has(c.trajet.partenaire_id || ""));
  const autres = cies.filter((c) => !gagnantes.has(c.partenaireId)).sort((a, b) => (b.meilleure ? b.meilleure.groupe : -Infinity) - (a.meilleure ? a.meilleure.groupe : -Infinity));
  return { candidats, retenus, autres, sansMarge: false, meilleure: connues.find((c) => c.meilleure.groupe === top).meilleure };
}

// ---- 3. Faits pour la réponse --------------------------------------------------------------------------------------------------------

// Les faits envoyés à la fonction pour rédiger. Seuls ces champs (la fonction refuse toute autre clé) : pas de net, pas de marge, pas de
// compagnie. Les départs retenus de même prix et même mode forment un trajet ; des prix différents (deux compagnies à marge égale) en font deux.
// `propositions` : [{ leg, departs }] avec `departs` = departsDuTrajet(leg). Les trajets « même lieu » ne sont pas dans la réponse.
// `compagnies` : les noms des prestataires, retirés du mode s'ils y sont écrits (« Satun speedboat » devient « speedboat »).
export function faitsReponse({ itineraire = {}, propositions = [], devise = "THB", langue = "fr", compagnies = [] }) {
  const en = langue === "en";
  const lieu = (l) => (en ? libelleClient(l) : l);
  const echappe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const noms = compagnies.map((c) => String(c || "").trim()).filter((c) => c.length > 1).sort((a, b) => b.length - a.length);
  const sansCompagnie = (m) => noms.reduce((t, n) => t.replace(new RegExp(echappe(n), "gi"), " "), String(m || "")).replace(/\s+/g, " ").replace(/^[\s,·+-]+|[\s,·+-]+$/g, "").trim();
  const trajets = [];
  for (const { leg, departs } of propositions) {
    if (!leg || leg.memeLieu || leg.incomplet) continue;
    if (!departs.retenus.length) {
      trajets.push({ date: leg.date, de: lieu(leg.de), vers: lieu(leg.vers), au_catalogue: false, mode: "", duree: "", horaires: [], prix_adulte: null, prix_enfant: null, a_payer_sur_place: false });
      continue;
    }
    const groupes = new Map();
    for (const { trajet: t } of departs.retenus) {
      const cle = [nombre(t.prix_adulte), nombre(t.prix_enfant), t.mode || "", t.duree || ""].join("|");
      const mode = sansCompagnie(t.mode);
      const g = groupes.get(cle) || { date: leg.date, de: lieu(leg.de), vers: lieu(leg.vers), au_catalogue: true, mode: en ? libelleClient(mode) : mode, duree: t.duree || "", horaires: [], prix_adulte: nombre(t.prix_adulte), prix_enfant: nombre(t.prix_enfant), a_payer_sur_place: false };
      if (t.depart && !g.horaires.some((h) => h.depart === heure(t.depart))) g.horaires.push({ depart: heure(t.depart), arrivee: heure(t.arrivee) });
      groupes.set(cle, g);
    }
    trajets.push(...groupes.values());
  }
  return { langue: en ? "en" : "fr", prenom: itineraire.prenom || "", adultes: itineraire.adultes || 0, enfants: itineraire.enfants || 0, bebes: itineraire.bebes || 0, devise, trajets };
}

// ---- 4. Création du dossier ----------------------------------------------------------------------------------------------------------

// Les choix encore valables : un horaire par trajet existant, parmi ceux affichés (`propositions` : [{ leg, departs }]). Un choix devenu caché
// (autre compagnie devenue la meilleure après un changement de personnes) ou d'un trajet disparu (étape retirée) est oublié.
export function choixValables(choix = {}, propositions = []) {
  const out = {};
  for (const { leg, departs } of propositions) {
    const id = choix[leg.index];
    if (id && departs.retenus.some((c) => c.trajet.id === id)) out[leg.index] = id;
  }
  return out;
}

// Les services à ouvrir dans « Coller une demande » : un par trajet dont Anaïs a choisi l'horaire (`choix[index]` = id du trajet), avec l'hôtel
// de départ comme lieu de pickup. Les trajets absents du catalogue ou sans choix ne deviennent pas des services.
export function servicesDepuisChoix({ itineraire = {}, legs = [], choix = {} }) {
  const adultes = itineraire.adultes || 0;
  const enfants = itineraire.enfants || 0;
  const services = legs
    .filter((l) => choix[l.index])
    .map((l) => ({ phrase: `${l.de} → ${l.vers}`, date: l.date || "", heure: "", adultes: adultes || (enfants ? 0 : 1), enfants, offres: [{ genre: "trajet", id: choix[l.index] }], hotelDepart: l.deHotel || "", confiance: "haute" }));
  const premier = legs.find((l) => choix[l.index]);
  const d = {
    libre: true,
    ia: true,
    marque: "",
    type: "",
    nom: itineraire.prenom || "",
    prestation: "",
    de: "",
    vers: "",
    date: (services[0] || {}).date || "",
    dateTexte: "",
    heure: "",
    adultes,
    enfants,
    bebes: itineraire.bebes || 0,
    ages: itineraire.ages_enfants || [],
    vehicule: "",
    mode: "",
    siegeEnfant: false,
    siegeBebe: false,
    hotel: premier ? premier.deHotel || "" : "",
    telephone: "",
    langue: itineraire.langue || "",
    remarquesIA: itineraire.remarques || "",
  };
  return { d, services };
}

// ---- Démonstration ------------------------------------------------------------------------------------------------------------------
// En démo, rien ne part chez Anthropic : les trois réponses sont simulées dans la forme exacte de la fonction.

const MOIS = { jan: 1, janv: 1, janvier: 1, january: 1, feb: 2, fev: 2, fevr: 2, fevrier: 2, february: 2, mar: 3, mars: 3, march: 3, apr: 4, avr: 4, avril: 4, april: 4, mai: 5, may: 5, jun: 6, juin: 6, june: 6, jul: 7, juil: 7, juillet: 7, july: 7, aug: 8, aou: 8, aout: 8, august: 8, sep: 9, sept: 9, septembre: 9, september: 9, oct: 10, octobre: 10, october: 10, nov: 11, novembre: 11, november: 11, dec: 12, decembre: 12, december: 12 };
const iso = (j, m, aujourdhui) => {
  let a = Number(aujourdhui.slice(0, 4));
  const d = `${a}-${String(m).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
  if (d < aujourdhui) a++;
  return `${a}-${String(m).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
};

// « du 18 au 21 janvier Krabi Front Bay Resort, du 21 au 25 Breizh Cape Beach Bungalows, du 31 janvier au 3 février Dugong Libong Resort ».
export function simulerItineraire(texte, aujourdhui) {
  const t = String(texte || "");
  // Un mot de mois seulement (« janvier », « févr. ») : le premier mot de l'hôtel n'est jamais pris pour un mois.
  const mois = "(janvier|janv\\.?|février|fevrier|févr\\.?|fevr\\.?|mars|avril|avr\\.?|mai|juin|juillet|juil\\.?|août|aout|septembre|sept\\.?|octobre|oct\\.?|novembre|nov\\.?|décembre|decembre|déc\\.?|dec\\.?|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep)";
  const re = new RegExp(`(?:du|from)\\s+(\\d{1,2})(?:\\s+${mois})?\\s+(?:au|to)\\s+(\\d{1,2})(?:\\s+${mois}(?![a-zà-ÿ]))?\\s*[:,]?\\s*([^,;\\n]+?)(?=,|;|\\n|\\.\\s|$)`, "gi");
  const etapes = [];
  let moisCourant = null;
  const trouves = [...t.matchAll(re)];
  // Le mois écrit une seule fois (« du 18 au 21 janvier … ») vaut pour les étapes suivantes.
  for (const m of trouves) {
    const m1 = m[2] && MOIS[sansAccents(m[2]).replace(/\.$/, "")];
    const m2 = m[4] && MOIS[sansAccents(m[4]).replace(/\.$/, "")];
    const fin = m2 || m1 || moisCourant;
    const debut = m1 || (Number(m[1]) > Number(m[3]) && fin ? (fin === 1 ? 12 : fin - 1) : fin);
    if (!fin) continue;
    moisCourant = fin;
    const hotel = m[5].replace(/^(?:at|à|au)\s+/i, "").trim();
    etapes.push({ hotel, lieu_ecrit: "", du: iso(m[1], debut, aujourdhui), au: iso(m[3], fin, aujourdhui) });
  }
  const fr = /\b(bonjour|merci|nous|vous|nos|hôtels?)\b/i.test(t);
  return { ok: true, usage: "itineraire", modele: "simulation", itineraire: { prenom: "", langue: fr ? "fr" : "en", adultes: 0, enfants: 0, ages_enfants: [], bebes: 0, etapes, remarques: "Réponse simulée (mode démo) : aucun appel à Claude." }, avertissements: [] };
}

// Situe un hôtel quand son nom contient un lieu du catalogue (« Paradise Resort Phi Phi ») ; sinon la recherche « ne tranche pas ».
export function simulerSituer(hotels, lieux) {
  return {
    ok: true,
    usage: "situer",
    modele: "simulation",
    hotels: hotels.map((nom) => {
      const n = ` ${cleLieu(nom)} `;
      const lieu = lieux.filter((l) => cleLieu(l) && n.includes(` ${cleLieu(l)} `)).sort((a, b) => cleLieu(b).length - cleLieu(a).length)[0] || "";
      return lieu
        ? { nom, lieu, zone: "", localite: lieu, source: { url: "https://example.com/demo", titre: "Source simulée (démo)" }, certitude: "probable", explication: "Démo : le nom de l'hôtel contient le lieu." }
        : { nom, lieu: "", zone: "", localite: "", source: null, certitude: "inconnue", explication: "Démo : aucune source, le lieu reste à choisir." };
    }),
  };
}

const fmt = (n, devise) => `${Number(n).toLocaleString("en-US")} ${devise}`;
const dateCourte = (d, en) => {
  if (!d) return "";
  const x = new Date(`${d}T12:00:00Z`);
  return x.toLocaleDateString(en ? "en-GB" : "fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
};

export function simulerReponse(faits) {
  const en = faits.langue === "en";
  const blocs = faits.trajets.map((t) => {
    const tete = `${en ? "📍" : "📍"} ${dateCourte(t.date, en)}, ${t.de} → ${t.vers}`;
    if (!t.au_catalogue) return [tete, en ? "We don't offer this route, but I can look into it for you." : "Nous ne proposons pas ce trajet, mais je peux me renseigner."].join("\n");
    const prix = [t.prix_adulte !== null ? `${fmt(t.prix_adulte, faits.devise)} ${en ? "per adult" : "par adulte"}` : "", t.prix_enfant !== null ? `${fmt(t.prix_enfant, faits.devise)} ${en ? "per child" : "par enfant"}` : ""].filter(Boolean).join(", ");
    const horaires = t.horaires.map((h) => `→ ${h.depart}${h.arrivee ? ` - ${h.arrivee}` : ""}`);
    return [tete, ...horaires, prix].filter(Boolean).join("\n");
  });
  const prenom = faits.prenom ? ` ${faits.prenom}` : "";
  const message = en
    ? [`Hello${prenom},`, "", "Thank you for your message 😊 Here are the times and prices for your transfers:", "", blocs.join("\n\n"), "", "Let me know which departure times suit you best."].join("\n")
    : [`Bonjour${prenom},`, "", "Merci beaucoup pour votre message 😊 Voici les horaires et les tarifs de vos trajets :", "", blocs.join("\n\n"), "", "Dites-moi quels horaires vous conviennent le mieux."].join("\n");
  return { ok: true, usage: "repondre_itineraire", modele: "simulation", message, manques: faits.adultes ? [] : [en ? "number of people" : "nombre de personnes"], avertissements: [] };
}
