// Logique pure des opérations : réservations auprès des partenaires, messages types, dû aux partenaires.
// Aucune dépendance au navigateur pour pouvoir la tester avec node --test.

export const STATUTS_RESERVATION = { a_demander: "À demander", demande: "Demandée", confirme: "Confirmée", annule: "Annulée" };

const nouvelId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const brut = (l) => (l.unite !== null && l.unite !== undefined && l.unite !== "" && l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.unite) * Number(l.qte) : l.montant !== null && l.montant !== undefined && l.montant !== "" ? Number(l.montant) : null);

// Une réservation par ligne de partenaire du document, sauf celles qui existent déjà (même ligne).
// Le net prévu est renvoyé à part : il va dans la table protégée.
// Les lignes adulte et enfant d'un même bateau ou d'une même excursion (même partenaire, même date, même nom
// sans le suffixe enfant) donnent une seule réservation, avec les adultes et les enfants réunis.
const estLigneEnfant = (l) => /enfant|child/i.test(l.intro || "") || /,\s*(child|enfant)\b/i.test(l.titre || l.libelle || "");
const nomSansEnfant = (l) => String(l.titre || l.libelle || "").replace(/,\s*(child|enfant)\b.*$/i, "").trim();
export function reservationsDepuisDocument(doc, { existantes = [], uid = nouvelId } = {}) {
  const deja = new Set(existantes.flatMap((r) => [r.ligne_id, ...((r.details && r.details.lignes_ids) || [])]));
  const groupes = new Map();
  for (const l of (doc.contenu && doc.contenu.lignes) || []) {
    if (l.kind === "texte" || l.kind === "remise" || !(l.prestation_id || l.trajet_id) || deja.has(l.id)) continue;
    const cle = `${l.trajet_id || ""}|${l.partenaire_id || ""}|${l.date_service || ""}|${sansAccentsMin(nomSansEnfant(l))}`;
    const qte = l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.qte) : 1;
    const enfant = estLigneEnfant(l);
    const g = groupes.get(cle) || { lignes: [], adultes: 0, enfants: 0, vente: 0, net: null, premiere: null };
    if (!g.premiere || (!enfant && estLigneEnfant(g.premiere))) g.premiere = l;
    g.lignes.push(l);
    if (enfant) g.enfants += qte;
    else g.adultes += qte;
    g.vente += brut(l) || 0;
    if (l.net !== null && l.net !== undefined) g.net = (g.net || 0) + Math.round(Number(l.net) * qte * 100) / 100;
    groupes.set(cle, g);
  }
  return [...groupes.values()].map((g) => {
    const l = g.premiere;
    return {
      // `titre` : le nom court de la prestation quand le libellé de la ligne porte aussi les personnes et la date.
      reservation: { id: uid(), dossier_id: doc.dossier_id, ligne_id: l.id, prestation_id: l.prestation_id || null, trajet_id: l.trajet_id || null, partenaire_id: l.partenaire_id || null, libelle: nomSansEnfant(l), date_service: l.date_service || null, heure_pickup: "", lieu_pickup: "", personnes: { adultes: g.adultes, enfants: g.enfants, bebes: 0 }, statut: "a_demander", reference_partenaire: "", montant_vente: g.lignes.some((x) => brut(x) !== null) ? Math.round(g.vente * 100) / 100 : null, notes: "", details: g.lignes.length > 1 ? { lignes_ids: g.lignes.map((x) => x.id) } : {} },
      net: g.net,
    };
  });
}

// « 2 adultes, 1 enfant », « 2 adults, 1 child », « ผู้ใหญ่ 2 คน เด็ก 1 คน ».
export function personnesTexte(p = {}, langue = "fr") {
  const a = Number(p.adultes) || 0;
  const e = Number(p.enfants) || 0;
  const b = Number(p.bebes) || 0;
  if (langue === "th") return [a ? `ผู้ใหญ่ ${a} คน` : "", e ? `เด็ก ${e} คน` : "", b ? `ทารก ${b} คน` : ""].filter(Boolean).join(" ");
  const en = langue === "en";
  const mot = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
  return [a ? mot(a, en ? "adult" : "adulte", en ? "adults" : "adultes") : "", e ? mot(e, en ? "child" : "enfant", en ? "children" : "enfants") : "", b ? mot(b, en ? "baby" : "bébé", en ? "babies" : "bébés") : ""].filter(Boolean).join(", ");
}

const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function dateTexte(iso, langue = "fr") {
  if (!iso) return "";
  const [a, m, j] = iso.slice(0, 10).split("-").map(Number);
  if (langue === "th") return `${j}/${m}/${a}`;
  return langue === "en" ? `${j} ${MOIS_EN[m - 1]} ${a}` : `${j} ${MOIS_FR[m - 1]} ${a}`;
}

// Remplit les {variables} d'un gabarit ; une variable inconnue reste telle quelle, une variable vide disparaît.
export function remplirGabarit(texte, vars = {}) {
  return String(texte || "")
    .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? (vars[k] === null || vars[k] === undefined ? "" : String(vars[k])) : m))
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// Les variables d'un message à partir d'une réservation ou d'un dossier.
export function variablesMessage({ reservation = {}, client = {}, dossier = {}, partenaire = {}, entreprise = {}, langue = "fr" } = {}) {
  const nomClient = [client.prenom, client.nom].filter(Boolean).join(" ");
  return {
    client: nomClient,
    prenom: client.prenom || nomClient,
    date: dateTexte(reservation.date_service || dossier.date_depart, langue),
    hotel: reservation.lieu_pickup || (client.adresse || "").split("\n")[0] || "",
    heure: reservation.heure_pickup || "",
    a_heure: reservation.heure_pickup ? `${langue === "en" ? " at " : langue === "th" ? " เวลา " : " à "}${reservation.heure_pickup}` : "",
    personnes: personnesTexte(reservation.personnes, langue),
    prestation: reservation.libelle || "",
    partenaire: partenaire.nom || "",
    reference: reservation.reference_partenaire || dossier.ref || "",
    entreprise: entreprise.nom || "",
    telephone: entreprise.telephone || "",
  };
}

// Agenda : aujourd'hui, demain, et ce qui reste à confirmer, hors annulées. Trié par heure de pickup puis libellé.
export function agenda(reservations, ajd) {
  const demain = ajouterJours(ajd, 1);
  const actives = reservations.filter((r) => r.statut !== "annule");
  const tri = (a, b) => (a.date_service || "").localeCompare(b.date_service || "") || (a.heure_pickup || "99").localeCompare(b.heure_pickup || "99") || a.libelle.localeCompare(b.libelle);
  return {
    aujourdhui: actives.filter((r) => r.date_service === ajd).sort(tri),
    demain: actives.filter((r) => r.date_service === demain).sort(tri),
    aConfirmer: actives.filter((r) => r.statut !== "confirme" && (!r.date_service || r.date_service >= ajd)).sort(tri),
    enRetard: actives.filter((r) => r.statut !== "confirme" && r.date_service && r.date_service < ajd).sort(tri),
  };
}

// Dû aux partenaires : par partenaire et par mois du service, hors annulées. `netDe(r)` renvoie la ligne de nets ou null.
export function duParPartenaire(reservations, netDe) {
  const groupes = new Map();
  for (const r of reservations) {
    if (r.statut === "annule") continue;
    const mois = (r.date_service || "").slice(0, 7) || "sans-date";
    const cle = `${r.partenaire_id || ""}|${mois}`;
    const g = groupes.get(cle) || { partenaire_id: r.partenaire_id || null, mois, nb: 0, vente: 0, net_prevu: 0, net_paye: 0, sansNet: 0, reservations: [] };
    const n = netDe(r);
    g.nb++;
    g.vente += Number(r.montant_vente) || 0;
    if (n && n.net_prevu !== null && n.net_prevu !== undefined) g.net_prevu += Number(n.net_prevu);
    else g.sansNet++;
    if (n && n.net_paye !== null && n.net_paye !== undefined) g.net_paye += Number(n.net_paye);
    g.reservations.push(r);
    groupes.set(cle, g);
  }
  return [...groupes.values()]
    .map((g) => ({ ...g, vente: arr(g.vente), net_prevu: arr(g.net_prevu), net_paye: arr(g.net_paye), reste: arr(g.net_prevu - g.net_paye), marge: arr(g.vente - g.net_prevu) }))
    .sort((a, b) => b.mois.localeCompare(a.mois) || (b.reste - a.reste));
}

// ---- Vouchers (mode excursions) ------------------------------------------------------------------------------
// Trois modèles : bateau (excursions en mer), transfert, activité. Les frais de parc n'ont pas de voucher.
// Quatre modèles : bateau, transfert, activité, location. Chacun a ses champs propres sur la réservation.
// Cinq modèles : billet de bateau (trajets des compagnies), excursion en bateau, transfert terrestre, activité, location.
export const CHAMPS_VOUCHER = {
  billet: ["embarquement", "checkin", "bagages", "remarques", "remarques_paiement"],
  bateau: ["chambre", "type_tour", "bateau", "parc", "parc_texte", "remarques", "remarques_paiement"],
  transfert: ["drop_off", "vol", "bagages", "type_transfert", "remarques", "remarques_paiement"],
  activite: ["chambre", "programme", "heure_service", "remarques", "remarques_paiement"],
  location: ["chambre", "retour_date", "retour_heure", "permis", "caution", "remarques", "remarques_paiement"],
};
export const TITRES_VOUCHER = { billet: "Boat Ticket Voucher", bateau: "Boat Tour Voucher", transfert: "Transfer Voucher", activite: "Activity & Tour Voucher", location: "Rental Voucher" };

// Point d'embarquement de la compagnie pour un lieu de départ (« Koh Lanta » → « Saladan Pier »).
export function pointEmbarquement(partenaire, lieu) {
  const points = (partenaire && partenaire.regles && partenaire.regles.points_embarquement) || [];
  const cible = sansAccentsMin(lieu);
  const p = points.find((x) => sansAccentsMin(x.lieu) === cible) || points.find((x) => cible && (sansAccentsMin(x.lieu).includes(cible) || cible.includes(sansAccentsMin(x.lieu))));
  return p ? pointEmbarquementEn(p.ou) : "";
}

// Les points d'embarquement de la base sont en français (« Bureau Bundhaya au Pakbara Pier ») : en anglais pour le voucher.
const POINTS_EN = [
  [/^Bureau (.+?) (?:à|au) (.+)$/i, "$1 office at $2"],
  [/^Bureau ([^,]+)(,.*)?$/i, "$1 office$2"],
  [/^Siège (.+)$/i, "$1 head office"],
  [/^Pickup à l'hôtel de (.+)$/i, "Hotel pickup on $1"],
  [/^Pickup à l'hôtel, zone (.+)$/i, "Hotel pickup, $1 area"],
  [/^Plage devant le parc national$/i, "Beach in front of the national park"],
  [/^Plage devant (.+)$/i, "Beach in front of $1"],
  [/comptoir n°\s*(\d+)/i, "counter no. $1"],
  [/derrière le 7-11/i, "behind the 7-Eleven"],
  [/pont d'accostage/i, "landing jetty"],
  [/ponton flottant/i, "floating pontoon"],
  [/niveau (\d+)/i, "level $1"],
];
export const pointEmbarquementEn = (texte) => POINTS_EN.reduce((s, [re, en]) => s.replace(re, en), String(texte || "")).replace(/undefined/g, "");
export const estPickupHotel = (embarquement) => /hotel pickup|pickup at (your|the) hotel/i.test(embarquement || "");

// Consigne de check-in en anglais, d'après la compagnie et la ligne (Langkawi demande les passeports).
export function consigneCheckin(nomCompagnie, trajet = {}) {
  const c = sansAccentsMin(nomCompagnie);
  const langkawi = /langkawi/i.test(`${trajet.de || ""} ${trajet.vers || ""}`);
  if (langkawi) return c.includes("bundhaya") ? "Check-in 90 minutes before departure, counter closes 45 minutes before. Passport of each passenger required (immigration), kept by the captain during the crossing." : "Check-in 90 minutes before departure for immigration formalities. Passport of each passenger required.";
  if (c.includes("bundhaya")) return "Check-in at the pier 45 minutes before departure, counter closes 15 minutes before. Please bring this voucher and your passport or ID.";
  if (c.includes("satun")) return "Please present this voucher at the counter 30 minutes before departure, counter closes 20 minutes before. Passport or ID required.";
  return "Please arrive at the pier 30 minutes before departure with this voucher and your passport or ID.";
}
const sansAccentsMin = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// Dates du dossier déduites de ses réservations (hors annulées) : la première et la dernière date de service.
export function datesDepuisReservations(reservations) {
  const dates = reservations.filter((r) => r.statut !== "annule" && r.date_service).map((r) => r.date_service).sort();
  if (!dates.length) return { date_depart: null, date_retour: null };
  return { date_depart: dates[0], date_retour: dates.length > 1 && dates[dates.length - 1] !== dates[0] ? dates[dates.length - 1] : null };
}

// `partenaire` (facultatif) : pour une réservation à la main chez une compagnie de bateaux (Bundhaya, Satun), un billet.
export function typeVoucher(reservation, prestation, partenaire = null) {
  if (reservation.trajet_id) return "billet";
  if (!prestation && partenaire && ((partenaire.regles && partenaire.regles.points_embarquement && partenaire.regles.points_embarquement.length) || /speed ?boat|ferry/i.test(partenaire.nom || ""))) return "billet";
  const f = prestation ? prestation.famille : "";
  const g = `${(prestation && prestation.groupe) || ""} ${(prestation && prestation.libelle) || ""}`;
  if (f === "frais") return null;
  // Une option (extension d'île, supplément) se note sur le voucher du tour, elle n'a pas le sien.
  if (/^option|supplément|supplement|extension/i.test(g)) return null;
  if (f === "transfert") return /speedboat|ferry|bateau|boat/i.test(g) ? "billet" : "transfert";
  if (f === "location") return "location";
  if (f === "activite") return "activite";
  // Une excursion à la journée en taxi (VIP Taxi) est une activité, pas un transfert.
  if (f === "excursion") return /taxi|van/i.test((prestation && prestation.groupe) || "") ? "activite" : "bateau";
  if (/speedboat|ferry/i.test(reservation.libelle || "")) return "billet";
  return /transfer|taxi|van|→/i.test(reservation.libelle || "") ? "transfert" : "activite";
}

export const numeroVoucher = (ref, index) => `${ref}-${index}`;

// Statut de paiement imprimé sur le voucher, d'après ce que le dossier a encaissé.
export function statutPaiementVoucher({ total = 0, recu = 0 } = {}) {
  if (total > 0 && recu >= total) return "paye";
  if (recu > 0) return "acompte";
  return "sur_place";
}

// Join ou privé, d'après le groupe ou le libellé de la prestation.
export const estPrive = (prestation, reservation) => /priv|charter/i.test(`${(prestation && prestation.groupe) || ""} ${(prestation && prestation.libelle) || ""} ${(reservation && reservation.libelle) || ""}`);

// Frais de parc : inclus seulement si la prestation le dit (« compris », « inclus »), sinon « non inclus » avec le
// texte de la base traduit en anglais pour le client.
export function fraisDeParc(prestation) {
  const texte = (prestation && prestation.details && prestation.details.parc) || "";
  if (!texte) return { inclus: null, texte: "" };
  const inclus = /inclu|included|compris/i.test(texte) && !/non inclu|not included|pas inclu|non compris|jamais/i.test(texte);
  return { inclus, texte: inclus ? "" : texteParcEn(texte) };
}

// « Adulte étranger: 400 ฿ | Enfant: 200 ฿ (Thaï: 40 ฿ / 20 ฿) » → « Adult 400 THB, child 200 THB (Thai nationals 40 / 20 THB), cash on the day ».
export function texteParcEn(texte) {
  let s = String(texte || "").replace(/\s*\n\s*/g, " ").trim();
  s = s.replace(/^Selon destination\s*\(([^)]*)\)\s*/i, "$1, depending on the destination");
  s = s.replace(/(\d+)\s*à\s*(\d+)/g, "$1 to $2");
  s = s.replace(/\(\s*([\d\s\/฿]+?)\s*thaï\s*\)/gi, "(Thai nationals $1)");
  s = s.replace(/\(\s*Thaï\s*:\s*/gi, "(Thai nationals ");
  s = s.replace(/Enfant thaï\s*:\s*/gi, "Thai child ");
  s = s.replace(/Adulte étranger\s*:\s*/gi, "adult ").replace(/Enfant étranger\s*:\s*/gi, "child ").replace(/Enfant\s*:\s*/gi, "child ");
  s = s.replace(/\/\s*adulte étranger/gi, "per adult").replace(/\/\s*enfant/gi, "per child").replace(/\/\s*adulte/gi, "per adult");
  s = s.replace(/฿\s*\/\s*(\d+)\s*฿/g, "/ $1 THB").replace(/฿/g, "THB");
  s = s.replace(/\s*\|\s*/g, ", ").replace(/,?\s*À régler en espèces sur place/i, "");
  s = s.replace(/\s+/g, " ").replace(/\s+,/g, ",").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return /cash/i.test(s) ? s : `${s}, cash on the day`;
}

// Capacité du bateau quand la base en donne une en personnes (« 1 à 2 personnes »), rien pour « Par personne ».
export function capaciteBateau(prestation) {
  const c = (prestation && prestation.details && prestation.details.capacite) || "";
  return /\d/.test(c) && !/^par\b/i.test(c) ? c.replace(/\s*(à|-)\s*/g, " to ").replace(/personnes?/i, "people") : "";
}

// « Speedboat Privé\nRattana Pier » → bateau en anglais et quai de départ.
const BATEAUX = [[/Speedboat Privé/i, "Private speedboat"], [/Longtail Privé/i, "Private longtail"], [/Longtail Traditionnel/i, "Traditional longtail"], [/Radeau Traditionnel/i, "Traditional wooden raft"], [/Radeau/i, "Wooden raft"]];
export function bateauEtQuai(prestation) {
  const lignes = String((prestation && prestation.details && prestation.details.bateau) || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const bateau = BATEAUX.reduce((s, [re, en]) => s.replace(re, en), lignes[0] || "");
  const quai = lignes.slice(1).find((l) => /pier|quai|jetty/i.test(l)) || "";
  return { bateau, quai };
}

// Horaires de la base quand ils sont une plage d'heures (« 09h00 - 16h00 (Journée) » → « 09:00 - 16:00 (full day) »),
// rien quand ce sont des jours d'ouverture, qui n'ont pas leur place sur un voucher.
const PARENTHESES = [[/journée/i, "full day"], [/flexible/i, "flexible"], [/trajet\s*~?\s*(\d{1,2}h\d{2})/i, "about $1 ride"], [/départ/i, "departure"], [/bateau/i, "boat"]];
export function horairesTexte(horaires) {
  const premiere = String(horaires || "").split("\n")[0].trim();
  const m = premiere.match(/^(\d{1,2})[h:](\d{0,2})\s*(?:-|–|>|→)\s*(\d{1,2})[h:](\d{0,2})\s*(\(.*\))?$/);
  if (!m) return "";
  const hh = (h, mn) => `${h.padStart(2, "0")}:${(mn || "00").padEnd(2, "0")}`;
  const suite = m[5] ? ` ${PARENTHESES.reduce((s, [re, en]) => s.replace(re, en), m[5]).replace(/(departure \d{1,2})h(\d{2})/i, "$1:$2")}` : "";
  return `${hh(m[1], m[2])} - ${hh(m[3], m[4])}${suite}`;
}

// Durée de la base en anglais (« 2 heures (1h+1h) » → « 2 hours (1h+1h) », « Environ 3h00 » → « About 3h00 »).
export function dureeTexte(duree) {
  const premiere = String(duree || "").split("\n")[0].trim();
  return premiere.replace(/journée complète/i, "Full day").replace(/environ/i, "About").replace(/heures?/i, "hours").replace(/session (\d+) minutes/i, "$1-minute session");
}

// Prix affiché par personne seulement quand la prestation se vend à la personne (adulte, enfant) ou qu'elle n'est pas connue (trajet).
export const venduParPersonne = (prestation) => !prestation || !prestation.unite || ["pp", "ad", "ch", "pers"].includes(prestation.unite);

// Un transfert qui parle d'aéroport ou de vol a une ligne « numéro de vol », les autres non.
export const concerneUnVol = (...textes) => /airport|aéroport|aeroport|flight|vol\b/i.test(textes.filter(Boolean).join(" "));

// Type de transfert d'après le groupe de la prestation.
export function typeTransfert(prestation, reservation) {
  const t = `${(prestation && prestation.groupe) || ""} ${(reservation && reservation.libelle) || ""}`;
  if (/partag|shared|navette|join/i.test(t)) return "partage";
  if (/taxi|berline|voiture|car\b/i.test(t)) return "taxi";
  return "minivan";
}

// Hôtel et numéro de chambre d'après l'adresse du client (« Hotel Sunset, Room 12 ») ou le lieu de pickup.
export function hotelEtChambre(client = {}, reservation = {}) {
  const source = reservation.lieu_pickup || (client.adresse || "").split("\n")[0] || "";
  const m = source.match(/(?:room|chambre|ch\.?)\s*(?:no\.?\s*)?([A-Za-z0-9-]+)/i);
  return { hotel: source.replace(/[,\s]*(?:room|chambre|ch\.?)\s*(?:no\.?\s*)?[A-Za-z0-9-]+\s*$/i, "").trim(), chambre: m ? m[1] : "" };
}

// Libellé d'une ligne de facture en mode excursions : prestation, personnes et date.
export function descriptionService(ligne, langue = "en") {
  const en = langue === "en";
  const qte = ligne.qte !== null && ligne.qte !== undefined && ligne.qte !== "" ? Number(ligne.qte) : 0;
  const enfant = /enfant|child/i.test(ligne.intro || "");
  const pax = qte ? `${qte} ${enfant ? (en ? (qte > 1 ? "children" : "child") : qte > 1 ? "enfants" : "enfant") : en ? (qte > 1 ? "passengers" : "passenger") : qte > 1 ? "personnes" : "personne"}` : "";
  return [ligne.libelle, pax, ligne.date_service ? dateTexte(ligne.date_service, langue) : ""].filter(Boolean).join(", ");
}

const arr = (n) => Math.round(n * 100) / 100;
export function ajouterJours(iso, n) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000);
  return d.toISOString().slice(0, 10);
}
export function nomMoisCourt(iso, langue = "fr") {
  if (!iso || iso === "sans-date") return langue === "en" ? "No date" : "Sans date";
  const [a, m] = iso.split("-").map(Number);
  const mois = langue === "en" ? MOIS_EN[m - 1] : MOIS_FR[m - 1];
  return `${mois.charAt(0).toUpperCase() + mois.slice(1)} ${a}`;
}
