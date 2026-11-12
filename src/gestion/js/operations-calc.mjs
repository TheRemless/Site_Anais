// Logique pure des opérations : réservations auprès des partenaires, messages types, dû aux partenaires.
// Aucune dépendance au navigateur pour pouvoir la tester avec node --test.

import { langueActive, N_ } from "./i18n.mjs";
import { chiffres, estLigneSupplement, prefixeProgramme, libelleClient } from "./partenaires-calc.mjs";
import { SUR_PLACE, CHEZ_NOUS, modeReglement } from "./calc.mjs";
import { estTaxi } from "./taxi-calc.mjs";

export { SUR_PLACE, CHEZ_NOUS, modeReglement };

export const STATUTS_RESERVATION = { a_demander: N_("À demander"), demande: N_("Demandée, en attente"), confirme: N_("Confirmée"), annule: N_("Annulée") };

const nouvelId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const brut = (l) => (l.unite !== null && l.unite !== undefined && l.unite !== "" && l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.unite) * Number(l.qte) : l.montant !== null && l.montant !== undefined && l.montant !== "" ? Number(l.montant) : null);

// Une réservation par ligne de partenaire du document, sauf celles qui existent déjà (même ligne).
// Le net prévu est renvoyé à part : il va dans la table protégée.
// Les lignes adulte et enfant d'un même bateau ou d'une même excursion (même partenaire, même date, même nom
// sans le suffixe enfant) donnent une seule réservation, avec les adultes et les enfants réunis.
const estLigneEnfant = (l) => /enfant|child/i.test(l.intro || "") || /,\s*(child|enfant)\b/i.test(l.titre || l.libelle || "");
// Le nom du service sans ses variantes : « , enfant », « , Personne supplémentaire », « , Base 1-2 pers » : le prix de base, le supplément et les enfants font une seule réservation.
const nomSansEnfant = (l) => String(l.titre || l.libelle || "").replace(/,\s*(?:child|enfant|personne suppl[ée]mentaire|extra person|additional person|base\s*1\s*[-–]\s*2)\b.*$/i, "").trim();
export function reservationsDepuisDocument(doc, { existantes = [], uid = nouvelId, regleDe = null } = {}) {
  const deja = new Set(existantes.flatMap((r) => [r.ligne_id, ...((r.details && r.details.lignes_ids) || [])]));
  const groupes = new Map();
  const lignesDoc = (doc.contenu && doc.contenu.lignes) || [];
  // Un programme qui a une ligne de supplément se regroupe sous le nom du programme (« Programme B ») : base, supplément et enfants font une réservation.
  const base = (l) => `${l.trajet_id || ""}|${l.partenaire_id || ""}|${l.date_service || ""}`;
  const programmes = new Set(lignesDoc.filter((x) => estLigneSupplement(x) && prefixeProgramme(nomSansEnfant(x))).map((x) => `${base(x)}|${prefixeProgramme(nomSansEnfant(x))}`));
  for (const l of lignesDoc) {
    if (l.kind === "texte" || l.kind === "remise" || !(l.prestation_id || l.trajet_id || l.libre) || deja.has(l.id) || estFraisDeParc({ partenaire_id: l.partenaire_id, libelle: l.titre || l.libelle })) continue;
    const prog = prefixeProgramme(nomSansEnfant(l));
    const cle = `${base(l)}|${prog && programmes.has(`${base(l)}|${prog}`) ? prog : sansAccentsMin(nomSansEnfant(l))}`;
    const qte = l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.qte) : 1;
    const enfant = estLigneEnfant(l);
    const g = groupes.get(cle) || { lignes: [], adultes: 0, enfants: 0, jours: 0, vente: 0, net: null, premiere: null };
    if (!g.premiere || (!enfant && estLigneEnfant(g.premiere))) g.premiere = l;
    g.lignes.push(l);
    g.qtes = g.qtes || [];
    g.qtes.push({ l, qte, enfant });
    if (estLigneSupplement(l)) g.supplement = true;
    g.vente += brut(l) || 0;
    if (l.net !== null && l.net !== undefined) g.net = (g.net || 0) + Math.round(Number(l.net) * qte * 100) / 100;
    groupes.set(cle, g);
  }
  return [...groupes.values()].map((g) => {
    // Ce que compte la quantité de chaque ligne : seules les unités de personnes donnent des adultes et des enfants. La base d'un groupe qui a des
    // suppléments compte pour une personne de plus (ajoutée plus bas), comme avant.
    for (const { l: x, qte: q, enfant: e } of g.qtes || []) {
      const compte = compteDe(x) === "aucun" && g.supplement ? "personnes" : compteDe(x);
      if (compte === "jours") g.jours += q;
      else if (compte === "personnes") {
        if (e) g.enfants += q;
        else g.adultes += q;
      }
    }
    // Une base pour 1 ou 2 personnes plus des suppléments : la base compte pour deux personnes (elle est comptée une fois par sa quantité).
    if (g.supplement) g.adultes += 1;
    const l = g.premiere;
    return {
      // `titre` : le nom court de la prestation quand le libellé de la ligne porte aussi les personnes et la date.
      reservation: { id: uid(), dossier_id: doc.dossier_id, ligne_id: l.id, prestation_id: l.prestation_id || null, trajet_id: l.trajet_id || null, partenaire_id: l.partenaire_id || null, libelle: nomSansEnfant(l), date_service: l.date_service || null, heure_pickup: "", lieu_pickup: "", personnes: { adultes: g.adultes, enfants: g.enfants, bebes: 0 }, statut: "a_demander", reference_partenaire: "", montant_vente: g.lignes.some((x) => brut(x) !== null) ? Math.round(g.vente * 100) / 100 : null, notes: "", paye_sur_place: g.lignes.some((x) => !!x.paye_sur_place), details: { ...(g.lignes.length > 1 ? { lignes_ids: g.lignes.map((x) => x.id) } : {}), ...(g.jours ? { jours: g.jours } : {}) } },
      net: g.net,
      // Service payé sur place : la commission attendue se calcule d'après la règle du partenaire (`regleDe(partenaire_id)`), seulement quand elle est connue.
      ...commissionDuGroupe(g, l, regleDe),
    };
  });
}

function commissionDuGroupe(g, l, regleDe) {
  if (!regleDe || !g.lignes.some((x) => x.paye_sur_place)) return {};
  // Le net ne compte que s'il est connu pour toutes les lignes qui ont un prix : un net partiel gonflerait la commission.
  const netComplet = g.lignes.every((x) => !(brut(x) > 0) || (x.net !== null && x.net !== undefined));
  const c = commissionPrevue(regleDe(l.partenaire_id || null), { vente: g.vente, net: netComplet ? g.net : null, adultes: g.adultes, enfants: g.enfants });
  return c === null ? {} : { commission_prevue: c };
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
export function dateTexte(iso, langue = langueActive()) {
  if (!iso) return "";
  const [a, m, j] = iso.slice(0, 10).split("-").map(Number);
  if (langue === "th") return `${j}/${m}/${a}`;
  return langue === "en" ? `${j} ${MOIS_EN[m - 1]} ${a}` : `${j} ${MOIS_FR[m - 1]} ${a}`;
}

// Langue de ce que voit le client : l'anglais en excursions (Secret) et en taxi, toujours ; le français en voyages sur mesure (ZTP).
// Déduite du mode de l'entreprise, jamais du libellé de la facture.
export const langueClient = (regl) => (regl && (regl.fonctionnement === "excursions" || estTaxi(regl)) ? "en" : "fr");

// Remplit les {variables} d'un gabarit ; une variable inconnue reste telle quelle, une variable vide disparaît.
export function remplirGabarit(texte, vars = {}) {
  return String(texte || "")
    .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? (vars[k] === null || vars[k] === undefined ? "" : String(vars[k])) : m))
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// Les variables d'un message à partir d'une réservation ou d'un dossier.
// Destinataire d'un message type : enregistré, sinon déduit de l'usage (les anciens messages n'avaient pas le champ).
export const destinataireMessage = (m) => (m && m.pour) || (m && /partenaire|relance|modification|annulation|partner/i.test(m.cle || "") ? "partenaire" : "client");

// Modèles proposés pour un destinataire, une langue et un usage (« relance », « modification »…). Ceux de la base d'abord ; quand l'usage demandé n'y est
// pas (Secret n'a que la demande au partenaire), le modèle par défaut de cet usage est proposé à sa place, sans rien écrire en base. Jamais le premier
// modèle venu : une relance ne doit pas partir comme une nouvelle demande de réservation. Renvoie { liste, choisi } (`choisi` : null sans usage connu).
const memeUsage = (a, b) => destinataireMessage(a) === destinataireMessage(b) && (a.cle || "") === (b.cle || "") && a.langue === b.langue;
export function gabaritsPropose(stockes, defauts, { pour, langue, cle = "" }) {
  const base = (stockes || []).filter((m) => m && m.corps && destinataireMessage(m) === pour);
  const virtuels = cle ? (defauts || []).filter((d) => d.cle === cle && destinataireMessage(d) === pour && !base.some((m) => memeUsage(m, d))).map((d) => ({ ...d, id: `defaut:${d.id}`, defaut: true, titre: d.titre })) : [];
  const liste = [...virtuels, ...base];
  const deLangue = liste.filter((m) => m.langue === langue);
  if (!cle) return { liste, choisi: deLangue[0] || null };
  return { liste, choisi: deLangue.find((m) => m.cle === cle) || null };
}

// Champs enregistrés au tap « Confirmée » : le statut, plus l'heure de pickup et la référence du prestataire quand on les donne (jamais effacés quand on ne les donne pas).
export function champsConfirmation(r, { heure = "", reference = "" } = {}) {
  const champs = { statut: "confirme" };
  const h = String(heure || "").trim();
  const ref = String(reference || "").trim();
  if (h) champs.heure_pickup = h;
  if (ref) champs.reference_partenaire = ref;
  return champs;
}

// Modèles par défaut dont l'usage manque en base (même destinataire, même usage, même langue) : ce que « Ajouter les modèles manquants » ajoute,
// sans jamais écraser un modèle modifié.
export function gabaritsManquants(stockes, defauts) {
  const base = (stockes || []).filter((m) => m && m.corps);
  return (defauts || []).filter((d) => !base.some((m) => memeUsage(m, d))).map((d) => ({ ...d }));
}

// « Remettre ceux de départ » sans rien perdre : un modèle qui vient des modèles par défaut (même identifiant) reprend son texte d'origine,
// un modèle créé par l'entreprise reste tel quel, et les modèles par défaut absents (même destinataire, usage et langue) sont ajoutés.
// Renvoie { liste, remis, ajoutes, gardes } pour le dire avant d'enregistrer.
export function gabaritsRemis(stockes, defauts) {
  const base = (stockes || []).filter((m) => m && m.corps);
  const parId = new Map((defauts || []).map((d) => [d.id, d]));
  let remis = 0;
  let gardes = 0;
  const liste = base.map((m) => {
    const d = parId.get(m.id);
    if (!d) return (gardes++, { ...m });
    remis++;
    return { ...d };
  });
  const ajouts = (defauts || []).filter((d) => !liste.some((m) => m.id === d.id || memeUsage(m, d))).map((d) => ({ ...d }));
  return { liste: [...liste, ...ajouts], remis, ajoutes: ajouts.length, gardes };
}

export function variablesMessage({ reservation = {}, client = {}, dossier = {}, partenaire = {}, entreprise = {}, langue = "fr" } = {}) {
  const nomClient = [client.prenom, client.nom].filter(Boolean).join(" ");
  return {
    client: nomClient,
    prenom: client.prenom || nomClient,
    date: dateTexte(reservation.date_service || dossier.date_depart, langue),
    // Le nom de l'hôtel sans le numéro de chambre : le partenaire n'en a pas besoin, le client le connaît.
    hotel: hotelEtChambre(client, reservation).hotel,
    heure: reservation.heure_pickup || "",
    a_heure: reservation.heure_pickup ? `${langue === "en" ? " at " : langue === "th" ? " เวลา " : " à "}${reservation.heure_pickup}` : "",
    personnes: personnesTexte(reservation.personnes, langue),
    // Message en anglais ou en thaï : le nom du service passe par la traduction, un libellé d'origine en français n'y part pas tel quel.
    prestation: langue === "fr" ? reservation.libelle || "" : libelleClient(reservation.libelle || ""),
    partenaire: partenaire.nom || "",
    // La personne à qui l'on écrit chez le partenaire (« Mr. Brown » pour VIP Taxi Lanta), sinon le nom du partenaire.
    contact: ((partenaire.contact || {}).personne || "").trim() || partenaire.nom || "",
    // Taxi : lieu de dépose et prix de la course (payé au chauffeur), tels que saisis sur la réservation.
    dropoff: libelleClient(((reservation.details || {}).drop_off) || ""),
    prix: reservation.montant_vente === null || reservation.montant_vente === undefined || reservation.montant_vente === "" ? "" : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(reservation.montant_vente))} ${entreprise.devise || "THB"}`,
    reference: reservation.reference_partenaire || dossier.ref || "",
    entreprise: entreprise.nom || "",
    telephone: entreprise.telephone || "",
    // Lien d'avis Google de l'entreprise (réglages) : jamais inventé, vide s'il n'est pas renseigné.
    lien_avis: entreprise.lien_avis || "",
  };
}

// Demandes d'avis : une par client, même avec plusieurs services ou plusieurs dossiers. `clientDe(r)` donne l'identifiant du client. Renvoie
// [{ clientId, reservations, premiere, demandeLe }] ; `demandeLe` : la date où l'avis a déjà été demandé (`details.avis_demande_le`), sinon null.
export function avisParClient(reservations, clientDe) {
  const groupes = new Map();
  for (const r of reservations) {
    if (r.statut === "annule") continue;
    const clientId = clientDe(r);
    if (!clientId) continue;
    const g = groupes.get(clientId) || { clientId, reservations: [], premiere: r, demandeLe: null };
    g.reservations.push(r);
    if (!g.demandeLe && r.details && r.details.avis_demande_le) g.demandeLe = r.details.avis_demande_le;
    groupes.set(clientId, g);
  }
  return [...groupes.values()];
}

// Agenda : aujourd'hui, demain, et ce qui reste à confirmer, hors annulées. Trié par heure de pickup puis libellé.
// `ecartees` : identifiants des dossiers annulés, dont les réservations ne comptent plus (annuler un dossier ne change pas leur statut).
// Envois de vouchers : la trace est gardée par réservation (`details.envois.client`, `details.envois.prestataire`, avec la date). `reservations` : celles qui ont un voucher.
// « Complet » : le client a reçu chaque voucher et chaque prestataire le sien (un voucher sans prestataire n'attend que le client).
export function etatEnvoisVouchers(reservations) {
  const envoi = (r, cle) => !!(r.details && r.details.envois && r.details.envois[cle]);
  const total = reservations.length;
  const avecPrestataire = reservations.filter((r) => r.partenaire_id);
  const client = reservations.filter((r) => envoi(r, "client")).length;
  const prestataires = avecPrestataire.filter((r) => envoi(r, "prestataire")).length;
  return { total, client, prestataires, totalPrestataires: avecPrestataire.length, complet: total > 0 && client === total && prestataires === avecPrestataire.length };
}

// Les détails d'une réservation avec un envoi de plus (« client » ou « prestataire »), sans effacer les autres.
export const detailsAvecEnvoi = (details, cible, date) => ({ ...(details || {}), envois: { ...((details && details.envois) || {}), [cible]: date } });

// Frais de parc : une somme à payer sur l'île, pas un service qui part. Ni heure de pickup, ni prestataire : ils ne figurent ni dans l'agenda, ni dans la feuille
// du jour, ni dans les alertes « pickup à compléter », et leur ligne de facture ne crée pas de réservation.
export const estFraisDeParc = (r) => !!r && !r.partenaire_id && /frais de parc|park fee|national park/i.test(r.libelle || "");

// Dernier jour d'un service : le retour d'une location (`details.retour_date`), sinon le jour du service. Un retour avant la prise est une erreur de saisie
// et ne compte pas. Les étapes d'après le service (avis, commission, « en retard », rappel de 9h) se calculent sur ce jour-là, pas sur celui de la prise.
export function dateFinService(r) {
  if (!r || !r.date_service) return null;
  const retour = r.details && r.details.retour_date;
  return /^\d{4}-\d{2}-\d{2}$/.test(retour || "") && retour > r.date_service ? retour : r.date_service;
}

// Une location commencée avant aujourd'hui et pas encore rendue (le jour du retour, elle l'est encore). Le jour de la prise, c'est un départ du jour.
export const locationEnCours = (r, ajd) => !!r && !!r.date_service && r.date_service < ajd && dateFinService(r) >= ajd;

// `netDe(r)` (facultatif) renvoie la ligne privée de la réservation : une commission reçue ou un net payé prouvent que le service a eu lieu.
export function agenda(reservations, ajd, ecartees = new Set(), { netDe = () => null } = {}) {
  const demain = ajouterJours(ajd, 1);
  const hier = ajouterJours(ajd, -1);
  const actives = reservations.filter((r) => r.statut !== "annule" && !ecartees.has(r.dossier_id) && !estFraisDeParc(r));
  const tri = (a, b) => (a.date_service || "").localeCompare(b.date_service || "") || (a.heure_pickup || "99").localeCompare(b.heure_pickup || "99") || a.libelle.localeCompare(b.libelle);
  return {
    aujourdhui: actives.filter((r) => r.date_service === ajd).sort(tri),
    demain: actives.filter((r) => r.date_service === demain).sort(tri),
    // Hier : les services terminés hier. Une location rendue hier y est, une location qui court encore non.
    hier: actives.filter((r) => dateFinService(r) === hier).sort(tri),
    // En cours : les locations commencées et pas encore rendues. Elles ne sont ni « à confirmer » ni « en retard ».
    enCours: actives.filter((r) => locationEnCours(r, ajd)).sort(tri),
    aConfirmer: actives.filter((r) => r.statut !== "confirme" && (!r.date_service || r.date_service >= ajd)).sort(tri),
    // En retard : passé et jamais confirmé. Un service marqué « s'est bien passé », dont la commission est reçue ou le net payé, n'est plus en retard.
    enRetard: actives.filter((r) => r.statut !== "confirme" && r.date_service && dateFinService(r) < ajd && !(r.details && r.details.fait_le) && !((n) => n && (n.commission_recue_le || (n.net_paye !== null && n.net_paye !== undefined)))(netDe(r))).sort(tri),
  };
}

// Dû aux partenaires : par partenaire et par mois du service, hors annulées. `netDe(r)` renvoie la ligne de nets ou null.
// La marge n'est calculée que sur les réservations dont le net est connu : une vente sans net ne doit pas gonfler la marge.
export function duParPartenaire(reservations, netDe, ecartees = new Set()) {
  const groupes = new Map();
  for (const r of reservations) {
    // Un service payé sur place au prestataire ne lui est rien dû : c'est lui qui nous reverse une commission (voir commissionsARecevoir).
    if (r.statut === "annule" || ecartees.has(r.dossier_id) || r.paye_sur_place) continue;
    const mois = (r.date_service || "").slice(0, 7) || "sans-date";
    const cle = `${r.partenaire_id || ""}|${mois}`;
    const g = groupes.get(cle) || { partenaire_id: r.partenaire_id || null, mois, nb: 0, vente: 0, venteAvecNet: 0, net_prevu: 0, net_paye: 0, sansNet: 0, reservations: [] };
    const n = netDe(r);
    g.nb++;
    g.vente += Number(r.montant_vente) || 0;
    if (n && n.net_prevu !== null && n.net_prevu !== undefined) {
      g.net_prevu += Number(n.net_prevu);
      g.venteAvecNet += Number(r.montant_vente) || 0;
    } else g.sansNet++;
    if (n && n.net_paye !== null && n.net_paye !== undefined) g.net_paye += Number(n.net_paye);
    g.reservations.push(r);
    groupes.set(cle, g);
  }
  return [...groupes.values()]
    .map((g) => ({ ...g, vente: arr(g.vente), net_prevu: arr(g.net_prevu), net_paye: arr(g.net_paye), reste: arr(g.net_prevu - g.net_paye), marge: arr(g.venteAvecNet - g.net_prevu) }))
    .sort((a, b) => b.mois.localeCompare(a.mois) || (b.reste - a.reste));
}

// Commissions à recevoir : les services payés sur place au prestataire, par partenaire et par mois du service, hors annulées.
// `netDe(r)` renvoie la ligne privée de la réservation (commission prévue, reçue, date de réception) ou null.
export function commissionsARecevoir(reservations, netDe, ecartees = new Set()) {
  const groupes = new Map();
  for (const r of reservations) {
    if (!r.paye_sur_place || r.statut === "annule" || ecartees.has(r.dossier_id)) continue;
    const mois = (r.date_service || "").slice(0, 7) || "sans-date";
    const cle = `${r.partenaire_id || ""}|${mois}`;
    const g = groupes.get(cle) || { partenaire_id: r.partenaire_id || null, mois, nb: 0, vente: 0, commission_prevue: 0, commission_recue: 0, reste: 0, ecart: 0, sansCommission: 0, nbARecevoir: 0, reservations: [] };
    const n = netDe(r);
    const prevue = n && n.commission_prevue !== null && n.commission_prevue !== undefined ? Number(n.commission_prevue) : null;
    const recue = n && n.commission_recue !== null && n.commission_recue !== undefined ? Number(n.commission_recue) : 0;
    // Une réservation dont la réception est datée est réglée : ce que le partenaire a versé en plus ou en moins reste en écart, pas en reste à recevoir.
    const reglee = !!(n && n.commission_recue_le);
    g.nb++;
    g.vente += Number(r.montant_vente) || 0;
    // Une réservation réglée n'a plus à être signalée « sans commission » : le partenaire a versé ce qu'il devait.
    if (prevue === null && !reglee) g.sansCommission++;
    g.commission_prevue += prevue || 0;
    g.commission_recue += recue;
    if (reglee) g.ecart += recue - (prevue || 0);
    else {
      g.reste += (prevue || 0) - recue;
      g.nbARecevoir++;
    }
    g.reservations.push(r);
    groupes.set(cle, g);
  }
  return [...groupes.values()]
    .map((g) => ({ ...g, vente: arr(g.vente), commission_prevue: arr(g.commission_prevue), commission_recue: arr(g.commission_recue), reste: arr(g.reste), ecart: arr(g.ecart) }))
    .sort((a, b) => b.mois.localeCompare(a.mois) || b.reste - a.reste);
}

// ---- Mode de règlement par partenaire et commission calculée ---------------------------------------------------
// Le mode par défaut d'un partenaire vit dans ses règles publiques (`regles.mode_reglement`) : « sur_place » quand ses clients le paient directement.
export const modeParDefaut = (partenaire) => (partenaire && partenaire.regles && partenaire.regles.mode_reglement === SUR_PLACE ? SUR_PLACE : CHEZ_NOUS);

// Les lignes de services d'un document prennent le mode de leur partenaire, sauf celles où quelqu'un a déjà choisi.
// `partenaireDe(id)` renvoie le partenaire. Renvoie les lignes (modifiées sur copie).
export function appliquerModeParDefaut(lignes, partenaireDe) {
  return (lignes || []).map((l) => {
    if (l.kind !== "ligne" || !l.partenaire_id || !(l.prestation_id || l.trajet_id || l.libre) || l.paye_sur_place !== undefined) return l;
    return modeParDefaut(partenaireDe(l.partenaire_id)) === SUR_PLACE ? { ...l, paye_sur_place: true } : l;
  });
}

// Règle de commission structurée (données privées du partenaire, droit nets) :
//   { type: "pourcent_vente" | "pourcent_net" | "fixe_personne" | "fixe_reservation", valeur: nombre }
export const TYPES_COMMISSION = { pourcent_vente: N_("% du prix de vente"), pourcent_net: N_("% du net"), fixe_personne: N_("Montant par personne"), fixe_reservation: N_("Montant par réservation"), vente_moins_net: N_("Prix de vente moins net") };

// Commission attendue pour une réservation, ou null quand la règle ou une donnée manque : on ne devine jamais.
export function commissionPrevue(regle, { vente = null, net = null, adultes = 0, enfants = 0 } = {}) {
  if (!regle || !TYPES_COMMISSION[regle.type]) return null;
  const arrondi = (x) => Math.round(x * 100) / 100;
  // Prix de vente moins net : la marge du service, sans valeur à saisir. Il faut les deux prix, et jamais de commission négative.
  if (regle.type === "vente_moins_net") {
    if (vente === null || vente === undefined || net === null || net === undefined) return null;
    const c = arrondi(Number(vente) - Number(net));
    return c >= 0 ? c : null;
  }
  const v = Number(regle.valeur);
  if (regle.valeur === "" || regle.valeur === null || regle.valeur === undefined || !(v >= 0)) return null;
  if (regle.type === "pourcent_vente") return vente === null || vente === undefined ? null : arrondi((Number(vente) * v) / 100);
  if (regle.type === "pourcent_net") return net === null || net === undefined ? null : arrondi((Number(net) * v) / 100);
  if (regle.type === "fixe_personne") {
    const n = (Number(adultes) || 0) + (Number(enfants) || 0);
    return n > 0 ? arrondi(v * n) : null;
  }
  return arrondi(v);
}

// Recalcule la commission prévue de réservations existantes d'après la règle chiffrée du partenaire (les règles posées après coup ne s'appliquent
// sinon qu'aux nouvelles réservations). Ne touche qu'aux services payés sur place, pas annulés, dont la commission n'est pas encore reçue.
// `contexte` : regleDe(partenaire_id), netDe(reservation) (net prévu ou null), ecartees (dossiers annulés). Renvoie
//   { changements: [{ reservation, avant, apres }], inchanges, impossibles }
// `impossibles` : la règle ou une donnée manque (jamais de commission devinée). `seulementVides` : ne remplit que les commissions encore absentes.
export function recalculerCommissions(reservations, { regleDe, netDe = () => null, ecartees = new Set() }, { partenaireId = null, seulementVides = false } = {}) {
  const changements = [];
  // Commissions déjà reçues dont la valeur prévue s'écarte de la règle : signalées à l'écran, jamais modifiées.
  const ecartsRecus = [];
  let inchanges = 0;
  let impossibles = 0;
  for (const r of reservations) {
    if (!r.paye_sur_place || r.statut === "annule" || ecartees.has(r.dossier_id)) continue;
    if (partenaireId && r.partenaire_id !== partenaireId) continue;
    const n = netDe(r) || {};
    if (n.commission_recue_le) {
      const attendue = commissionPrevue(regleDe(r.partenaire_id || null), { vente: r.montant_vente ?? null, net: n.net_prevu ?? null, adultes: Number((r.personnes || {}).adultes) || 0, enfants: Number((r.personnes || {}).enfants) || 0 });
      if (attendue !== null && n.commission_prevue !== null && n.commission_prevue !== undefined && Math.round(Number(n.commission_prevue) * 100) !== Math.round(attendue * 100)) ecartsRecus.push({ reservation: r, prevue: Number(n.commission_prevue), attendue, recue: n.commission_recue === null || n.commission_recue === undefined ? null : Number(n.commission_recue) });
      continue;
    }
    const avant = n.commission_prevue === undefined ? null : n.commission_prevue;
    if (seulementVides && avant !== null) continue;
    const p = r.personnes || {};
    const apres = commissionPrevue(regleDe(r.partenaire_id || null), { vente: r.montant_vente ?? null, net: n.net_prevu ?? null, adultes: Number(p.adultes) || 0, enfants: Number(p.enfants) || 0 });
    if (apres === null) { impossibles++; continue; }
    if (avant !== null && Math.round(Number(avant) * 100) === Math.round(apres * 100)) { inchanges++; continue; }
    changements.push({ reservation: r, avant, apres });
  }
  return { changements, inchanges, impossibles, ecartsRecus };
}

// Lieu de pickup d'un service ajouté à un dossier : le dernier lieu saisi sur ses autres réservations, sinon la première ligne de l'adresse du client.
export function lieuParDefaut(reservationsDuDossier, client = {}) {
  const avecLieu = (reservationsDuDossier || []).filter((r) => String(r.lieu_pickup || "").trim()).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  if (avecLieu.length) return String(avecLieu[0].lieu_pickup).trim();
  return String((client && client.adresse) || "").split("\n")[0].trim();
}

// Un partenaire a-t-il un mode et une règle de commission renseignés ? Sert à signaler ce qui reste à compléter.
export const regleDeCommissionComplete = (regle) => commissionPrevue(regle, { vente: 1, net: 1, adultes: 1 }) !== null;

// Le partenaire a versé `montant` pour ce groupe (partenaire et mois) : on le répartit sur ses réservations, proportionnellement à la commission
// prévue (à parts égales quand rien n'est prévu), et on date la réception. Le dernier prend l'arrondi. Renvoie
// [{ reservation_id, commission_recue }] et l'écart avec ce qui était attendu (positif : le partenaire a versé plus).
export function repartirReception(reservations, netDe, montant) {
  const m = Math.round(Number(montant) * 100) / 100;
  const cibles = reservations.filter((r) => {
    const n = netDe(r);
    return !(n && n.commission_recue_le);
  });
  const prevue = (r) => {
    const n = netDe(r);
    return n && n.commission_prevue !== null && n.commission_prevue !== undefined ? Number(n.commission_prevue) : 0;
  };
  const attendu = Math.round(cibles.reduce((s, r) => s + prevue(r), 0) * 100) / 100;
  if (!cibles.length || !(m >= 0)) return { repartition: [], ecart: 0, attendu };
  const poids = attendu > 0 ? cibles.map(prevue) : cibles.map(() => 1);
  const somme = poids.reduce((s, x) => s + x, 0);
  let reste = m;
  const repartition = cibles.map((r, i) => {
    const part = i === cibles.length - 1 ? reste : Math.round(((m * poids[i]) / somme) * 100) / 100;
    reste = Math.round((reste - part) * 100) / 100;
    return { reservation_id: r.id, commission_recue: part };
  });
  return { repartition, ecart: Math.round((m - attendu) * 100) / 100, attendu };
}

// ---- Locations (voiture, moto, scooter) ----------------------------------------------------------------------
// Une ligne louée « par jour » a pour quantité un nombre de jours, pas de personnes.
export const estLigneJours = (l) => !!l && (l.par === "day" || /par jour|per day/i.test(l.intro || ""));

// Ce que compte la quantité d'une ligne de service : des « personnes » (par personne, adulte, enfant, personne supplémentaire, ou une ligne
// saisie à la main sans unité), des « jours » (location par jour), ou « aucun » (par bateau, véhicule, session, groupe, kart, ou forfait sans
// unité) : seules les personnes alimentent le nombre de personnes d'une réservation, une quantité de véhicules ou de jours n'en est pas un.
export function compteDe(l) {
  if (!l) return "personnes";
  const intro = l.intro || "";
  if (estLigneJours(l)) return "jours";
  if (["boat", "veh", "ses", "grp"].includes(l.par) || /par (bateau|v[ée]hicule|session|groupe|kart)|per (boat|vehicle|session|group|kart)/i.test(intro)) return "aucun";
  if (["pp", "ad", "ch", "sup"].includes(l.par) || /par (personne|adulte|enfant)|per (person|adult|child|extra person)/i.test(intro)) return "personnes";
  // Sans unité reconnue (ligne libre, ancien document), la quantité garde la lecture d'avant : des personnes.
  return "personnes";
}

// Nombre de jours entre la prise et le retour (dates AAAA-MM-JJ), au moins 1 ; null quand une date manque ou que le retour précède la prise.
export function nbJoursLocation(debut, fin) {
  if (!debut || !fin) return null;
  const ms = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const n = Math.round((ms(fin) - ms(debut)) / 86400000);
  return n < 0 ? null : Math.max(1, n);
}

// Catégorie du véhicule, d'après le groupe de la prestation (« Scooters », « Grosses motos », « Voitures et SUV »). Vide si inconnue.
export function categorieVehicule(prestation) {
  const g = `${(prestation && prestation.groupe) || ""} ${(prestation && prestation.libelle) || ""}`;
  if (/scooter/i.test(g)) return "Scooter";
  if (/moto|bike/i.test(g)) return "Motorbike";
  if (/voiture|suv|pick-?up|\bcar\b/i.test(g)) return "Car / SUV";
  return "";
}

// Cylindrée telle que la base la donne (« 125 cc », « 1200 cc auto »), « auto » devient « automatic ».
export function moteurTexte(prestation) {
  const m = String((prestation && prestation.details && prestation.details.moteur) || "").trim();
  return m ? m.replace(/\s*\bauto\b/i, ", automatic") : "";
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
  location: ["chambre", "retour_date", "retour_heure", "retour_lieu", "permis", "equipement", "caution", "conditions", "remarques", "remarques_paiement"],
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
// Trajet vers ou depuis la Malaisie (Langkawi) : la note à lire par le client avant de partir. Le passeport valable au moins six mois vient de la consigne de
// Jérémy ; le check-in plus tôt est le texte de la compagnie (consigneCheckin), repris tel quel. Vide pour tout autre trajet.
export function notePasseport({ de = "", vers = "", libelle = "", compagnie = "" } = {}) {
  const lieux = `${de} ${vers} ${libelle}`;
  if (!/langkawi|malaysia|malaisie/i.test(lieux)) return "";
  const trajet = /langkawi/i.test(`${de} ${vers}`) ? { de, vers } : { de: "Langkawi", vers: "" };
  return `Travelling to or from Langkawi (Malaysia): please bring your passport, valid for at least six months. ${consigneCheckin(compagnie, trajet)}`;
}
const sansAccentsMin = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// Bundhaya se paie d'avance : les clients nous paient, et nous reversons au prestataire avant la veille du départ (jamais la veille : Bundhaya peut annuler).
// Règle pour les traversées qui ne partent pas de Koh Lanta. Renvoie { avant, date_service } (« avant » : la veille, premier jour où ce n'est plus assez tôt) ou null.
// Rien pour Rattana (payé sur place), ni pour un départ inconnu : on ne devine pas. `paye` : le net est déjà reversé.
export function alerteAvantVeille(r, { partenaire = "", trajet = null, paye = false } = {}) {
  if (!r || r.statut === "annule" || r.paye_sur_place || !r.date_service || paye || !/bundhaya/i.test(partenaire || "")) return null;
  const depart = trajet ? trajet.de : String(r.libelle || "").split(/→|->/).length > 1 ? String(r.libelle).split(/→|->/)[0] : "";
  if (!String(depart || "").trim() || /lanta/i.test(depart)) return null;
  const d = new Date(`${r.date_service}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return { avant: d.toISOString().slice(0, 10), date_service: r.date_service };
}

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
  if ((prestation && prestation.unite === "sup") || /^option|supplément|supplement|extension|\bextra (?:dive|person)\b/i.test(g)) return null;
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
export function statutPaiementVoucher({ total = 0, recu = 0, surPlace = false } = {}) {
  if (surPlace) return "sur_place";
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
  const inclus = /inclu|included|compris/i.test(texte) && !/non inclu|not included|pas inclu|non compris|jamais|never/i.test(texte);
  return { inclus, texte: inclus ? "" : texteParcEn(texte) };
}

// « Adulte étranger: 400 ฿ | Enfant: 200 ฿ (Thaï: 40 ฿ / 20 ฿) » → « Adult 400 THB, child 200 THB (Thai nationals 40 / 20 THB), cash on the day ».
export function texteParcEn(texte) {
  let s = String(texte || "").replace(/\s*\n\s*/g, " ").trim();
  s = s.replace(/^(?:Selon destination|Depending on destination)\s*\(([^)]*)\)\s*/i, "$1, depending on the destination");
  s = s.replace(/(\d+)\s*à\s*(\d+)/g, "$1 to $2");
  // Le texte de la base est en français (anciennes lignes) ou en anglais (depuis le 12.11.2026) : les deux donnent la même phrase.
  s = s.replace(/\(\s*([\d\s\/฿]+?)\s*(?:thaï|Thai)\s*\)/gi, "(Thai nationals $1)");
  s = s.replace(/\(\s*(?:Thaï|Thai)\s*:\s*/gi, "(Thai nationals ");
  s = s.replace(/(?:Enfant thaï|Thai child)\s*:\s*/gi, "Thai child ");
  s = s.replace(/(?:Adulte étranger|Foreign adult)\s*:\s*/gi, "adult ").replace(/(?:Enfant étranger|Foreign child)\s*:\s*/gi, "child ").replace(/\b(?:Enfant|Child)\s*:\s*/gi, "child ");
  s = s.replace(/\/\s*(?:adulte étranger|foreign adult)/gi, "per adult").replace(/\/\s*(?:enfant|child)/gi, "per child").replace(/\/\s*adulte/gi, "per adult");
  s = s.replace(/฿\s*\/\s*(\d+)\s*฿/g, "/ $1 THB").replace(/฿/g, "THB");
  s = s.replace(/\s*\|\s*/g, ", ").replace(/,?\s*(?:À régler en espèces sur place|To be paid in cash on site)/i, "");
  s = s.replace(/\s+/g, " ").replace(/\s+,/g, ",").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return /cash/i.test(s) ? s : `${s}, cash on the day`;
}

// Capacité du bateau quand la base en donne une en personnes (« 1 à 2 personnes »), rien pour « Par personne ».
export function capaciteBateau(prestation) {
  const c = (prestation && prestation.details && prestation.details.capacite) || "";
  return /\d/.test(c) && !/^(par|per)\b/i.test(c) ? c.replace(/\s*(à|-)\s*/g, " to ").replace(/personnes?/i, "people") : "";
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
const PARENTHESES = [[/journée|full day/i, "full day"], [/flexible/i, "flexible"], [/(?:trajet|ride)\s*~?\s*(\d{1,2}h\d{2})/i, "about $1 ride"], [/départ|departure/i, "departure"], [/bateau|boat/i, "boat"]];
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

// Message type proposé au client d'après la date du service : le rappel la veille, la demande d'avis après, la confirmation sinon.
export function cleMessageClient(dateService, ajd) {
  if (!dateService) return "confirmation";
  if (dateService === ajouterJours(ajd, 1)) return "rappel";
  return dateService < ajd ? "avis" : "confirmation";
}

// Le message prêt d'une réservation : l'avis se demande après la fin du service (le retour d'une location), jamais pendant qu'elle court.
export function cleMessageReservation(r, ajd) {
  if (locationEnCours(r, ajd)) return "confirmation";
  const fin = dateFinService(r);
  return cleMessageClient(fin && fin < ajd ? fin : r.date_service, ajd);
}

// Hôtel et numéro de chambre d'après l'adresse du client (« Hotel Sunset, Room 12 ») ou le lieu de pickup.
export function hotelEtChambre(client = {}, reservation = {}) {
  const source = reservation.lieu_pickup || (client.adresse || "").split("\n")[0] || "";
  // « Room 12 », « Ch. 5 », « Chambre A12 » en fin de ligne : le mot est entier et suivi d'un numéro (« Beach Resort » n'est pas une chambre).
  const m = source.match(/(?:^|[,\s])(?:room|chambre|ch\.?)\s*(?:no\.?\s*)?(\d+[A-Za-z]?|[A-Za-z]\d+)\s*$/i);
  return { hotel: m ? source.slice(0, m.index).replace(/[,\s]+$/, "").trim() : source.trim(), chambre: m ? m[1] : "" };
}

// Libellé d'une ligne de facture en mode excursions : prestation, personnes et date.
export function descriptionService(ligne, langue = "en") {
  const en = langue === "en";
  const qte = ligne.qte !== null && ligne.qte !== undefined && ligne.qte !== "" ? Number(ligne.qte) : 0;
  const enfant = /enfant|child/i.test(ligne.intro || "");
  // La quantité n'est un nombre de personnes que pour une unité de personnes : 4 jours de location ne sont pas « 4 passengers », un véhicule ou un forfait non plus.
  const compte = compteDe(ligne);
  const jours = compte === "jours" && qte ? `${qte} ${en ? (qte > 1 ? "days" : "day") : qte > 1 ? "jours" : "jour"}` : "";
  const pax = compte === "personnes" && qte ? `${qte} ${enfant ? (en ? (qte > 1 ? "children" : "child") : qte > 1 ? "enfants" : "enfant") : en ? (qte > 1 ? "passengers" : "passenger") : qte > 1 ? "personnes" : "personne"}` : "";
  return [ligne.libelle, pax, jours, ligne.date_service ? dateTexte(ligne.date_service, langue) : ""].filter(Boolean).join(", ");
}

const arr = (n) => Math.round(n * 100) / 100;
export function ajouterJours(iso, n) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000);
  return d.toISOString().slice(0, 10);
}
export function nomMoisCourt(iso, langue = langueActive()) {
  if (!iso || iso === "sans-date") return langue === "en" ? "No date" : "Sans date";
  const [a, m] = iso.split("-").map(Number);
  const mois = langue === "en" ? MOIS_EN[m - 1] : MOIS_FR[m - 1];
  return `${mois.charAt(0).toUpperCase() + mois.slice(1)} ${a}`;
}

// ---- Envoi d'un voucher par WhatsApp --------------------------------------------------------------------------
// Nom du fichier image : « Voucher EX-2026-0003-1 - Keller.png » (sans caractère interdit dans un nom de fichier).
// En taxi (`taxi` vrai) le document s'appelle « Booking confirmation », comme ce qui s'imprime dessus.
export function nomFichierVoucher(numero, nomClient, { taxi = false } = {}) {
  const prenomOuNom = String(nomClient || "").trim().split(/\s+/)[0] || "client";
  return `${taxi ? "Booking confirmation" : "Voucher"} ${numero} - ${prenomOuNom}`.replace(/[\\/:*?"<>|]/g, "").trim() + ".png";
}

// Message qui accompagne l'image, en anglais comme le voucher. Au client : la confirmation de sa réservation. Au prestataire : seulement
// le prix que le client paiera (sans numéro de voucher, le voucher est déjà dans l'image).
// `gabarit` : le modèle « confirmation » en anglais de l'entreprise (ses messages types), rempli avec `vars` ; le texte écrit ici n'est qu'un secours.
export function messageVoucher({ pour = "client", prenom = "", montant = null, devise = "", gabarit = "", vars = {} }) {
  if (pour === "partenaire") {
    if (montant === null || montant === undefined || montant === "") return "";
    const nombre = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(montant));
    return `Price the guest pays: ${devise ? `${devise} ` : ""}${nombre}`;
  }
  const rempli = gabarit ? remplirGabarit(gabarit, { prenom, ...vars }) : "";
  if (rempli) return rempli;
  return `Hello${prenom ? ` ${prenom}` : ""}, here is your booking confirmation for your program. We wish you an excellent day!`;
}

// Le modèle du message client joint au voucher : la « confirmation » en anglais de l'entreprise (ses messages, sinon son modèle par défaut).
// Chaîne vide quand il n'y en a pas : messageVoucher prend alors son texte de secours.
export function gabaritConfirmationVoucher(stockes, defauts) {
  const choisi = gabaritsPropose(stockes, defauts, { pour: "client", langue: "en", cle: "confirmation" }).choisi;
  return (choisi && choisi.corps) || "";
}

// Lien WhatsApp : la conversation du numéro, ou le choix du contact quand on n'a pas de numéro. Un lien ne peut pas joindre d'image.
export function lienWhatsApp(telephone, message, options) {
  const numero = chiffres(telephone, options).replace("+", "");
  return `https://wa.me/${numero}?text=${encodeURIComponent(message)}`;
}

// ---- Écart entre une réservation et sa facture ------------------------------------------------------------------
// La réservation est créée d'après les lignes de la facture, puis modifiée à part : une quantité, une date ou un montant changé d'un côté
// laisse l'autre en retard. Renvoie null (rien à signaler), { retiree: true } (la ligne n'est plus dans le document) ou { champs: [...] }.
// Ce que la facture dit d'une réservation : date, personnes, montant vendu, paiement. null quand la réservation n'est pas liée à une ligne,
// { retiree: true } quand sa ligne n'y est plus.
export function attenduDepuisFacture(r, doc) {
  const ids = new Set([r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean));
  if (!ids.size || !doc || !doc.contenu) return null;
  const lignes = (doc.contenu.lignes || []).filter((l) => ids.has(l.id));
  if (!lignes.length) return { retiree: true };
  // Mêmes règles qu'à la création : adultes et enfants réunis, vente = somme des lignes, date de la première ligne adulte. (On ne regroupe pas
  // par date : une ligne dont la date a changé doit apparaître comme un écart, pas comme une deuxième réservation.)
  const utiles = lignes.filter((l) => l.kind !== "texte" && l.kind !== "remise");
  if (!utiles.length) return { retiree: true };
  const premiere = utiles.find((l) => !estLigneEnfant(l)) || utiles[0];
  const qte = (l) => (l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.qte) : 1);
  return {
    date_service: premiere.date_service || null,
    // Une location « par jour » : la quantité est un nombre de jours, la facture ne dit rien des personnes.
    sansPersonnes: !utiles.some((l) => compteDe(l) === "personnes") && !utiles.some(estLigneSupplement),
    jours: utiles.filter(estLigneJours).reduce((s, l) => s + qte(l), 0) || null,
    // Base pour 1 ou 2 personnes + suppléments : la base compte pour deux personnes, comme à la création de la réservation.
    personnes: { adultes: utiles.filter((l) => !estLigneEnfant(l) && (compteDe(l) === "personnes" || (compteDe(l) === "aucun" && utiles.some(estLigneSupplement)))).reduce((s, l) => s + qte(l), 0) + (utiles.some(estLigneSupplement) ? 1 : 0), enfants: utiles.filter((l) => compteDe(l) === "personnes" && estLigneEnfant(l)).reduce((s, l) => s + qte(l), 0) },
    montant_vente: utiles.some((l) => brut(l) !== null) ? arr(utiles.reduce((s, l) => s + (brut(l) || 0), 0)) : null,
    paye_sur_place: utiles.some((l) => !!l.paye_sur_place),
  };
}

export function ecartReservation(r, doc) {
  const a = attenduDepuisFacture(r, doc);
  if (!a) return null;
  if (a.retiree) return { retiree: true, champs: [] };
  const champs = [];
  if ((r.date_service || null) !== (a.date_service || null)) champs.push({ cle: "date_service", reservation: r.date_service || null, document: a.date_service || null });
  const pr = r.personnes || {};
  // Une facture sans personnes (location, véhicule, forfait) : on ne compare pas, sauf quand la réservation porte une quantité prise à tort pour des personnes
  // (4 jours devenus « 4 passagers »). Elle se corrige alors, en gardant ce qui a été saisi à la main (autre nombre que la quantité facturée).
  const quantiteFacturee = (doc && doc.contenu ? doc.contenu.lignes : []).filter((l) => (new Set([r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean))).has(l.id) && l.kind !== "texte" && l.kind !== "remise" && compteDe(l) !== "personnes").reduce((s, l) => s + (l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.qte) : 1), 0);
  const fausse = a.sansPersonnes && (Number(pr.adultes) || 0) > 0 && (Number(pr.adultes) || 0) === quantiteFacturee && !(Number(pr.enfants) || 0);
  if (fausse || (!a.sansPersonnes && ((Number(pr.adultes) || 0) !== a.personnes.adultes || (Number(pr.enfants) || 0) !== a.personnes.enfants))) champs.push({ cle: "personnes", reservation: { adultes: Number(pr.adultes) || 0, enfants: Number(pr.enfants) || 0 }, document: { adultes: a.personnes.adultes, enfants: a.personnes.enfants } });
  if (arr(Number(r.montant_vente) || 0) !== arr(Number(a.montant_vente) || 0)) champs.push({ cle: "montant_vente", reservation: Number(r.montant_vente) || 0, document: Number(a.montant_vente) || 0 });
  if (!!r.paye_sur_place !== a.paye_sur_place) champs.push({ cle: "paye_sur_place", reservation: !!r.paye_sur_place, document: a.paye_sur_place });
  return champs.length ? { retiree: false, champs, attendu: a } : null;
}

// ---- Paiement sur place changé depuis la réservation --------------------------------------------------------------
// Les lignes d'un document qui correspondent à la réservation passent « payé sur place » (ou n'y sont plus). Renvoie le nouveau contenu,
// ou null quand le document ne porte aucune ligne de ce service ou qu'il est déjà réglé ainsi. Rien n'est modifié sur place.
export function contenuAvecSurPlace(contenu, r, valeur) {
  const ids = new Set([r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean));
  const lignes = (contenu && contenu.lignes) || [];
  const cibles = lignes.filter((l) => ids.has(l.id) && l.kind !== "texte" && l.kind !== "remise");
  if (!cibles.length || cibles.every((l) => !!l.paye_sur_place === !!valeur)) return null;
  const change = (l) => {
    if (valeur) return { ...l, paye_sur_place: true };
    const { paye_sur_place, ...reste } = l;
    return reste;
  };
  return { ...contenu, lignes: lignes.map((l) => (cibles.includes(l) ? change(l) : l)) };
}

// ---- Date ou personnes changées depuis la réservation -------------------------------------------------------------
// Les lignes du document qui correspondent à la réservation prennent sa nouvelle date et ses nouveaux nombres d'adultes et d'enfants.
// `avant` et `apres` : { date_service, personnes: { adultes, enfants } }. Une ligne n'est mise à l'échelle que si sa quantité était bien le nombre de
// personnes d'avant (prix par personne) : un prix de groupe, un montant fixe ou une quantité réglée à la main ne bougent pas, et sont signalés.
// Renvoie { contenu, reste } : `contenu` vaut null quand rien ne change sur le document ; `reste` liste ce que la facture garde en l'état
// ({ cle: "date_service" | "adultes" | "enfants", ... }). Rien n'est modifié sur place. L'heure du pickup ne figure pas sur la facture.
export function contenuAvecReservation(contenu, r, avant, apres) {
  const ids = new Set([r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean));
  const lignes = (contenu && contenu.lignes) || [];
  const cibles = lignes.filter((l) => ids.has(l.id) && l.kind !== "texte" && l.kind !== "remise");
  const reste = [];
  if (!cibles.length) return { contenu: null, reste };
  const nb = (x) => Number(x) || 0;
  const qte = (l) => (l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.qte) : 1);
  // Un prix « par bateau », « par véhicule », « par jour », « par session » ou « par groupe » ne dépend pas du nombre de personnes.
  const parPersonne = (l) => !["boat", "veh", "day", "ses", "grp"].includes(l.par) && !/bateau|v[ée]hicule|jour|session|groupe|boat|vehicle|day|group/i.test(l.intro || "");
  const miseAJour = new Map();
  const modif = (l, champs) => miseAJour.set(l, { ...(miseAJour.get(l) || {}), ...champs });
  // Date : toutes les lignes du service, et la note « à payer sur place » de la même prestation à la même date.
  const dateAvant = avant.date_service || null;
  const dateApres = apres.date_service || null;
  if (dateAvant !== dateApres) {
    for (const l of cibles) if ((l.date_service || null) !== dateApres) modif(l, { date_service: dateApres });
    for (const l of lignes) {
      if (l.kind === "texte" && l.sur_place && (l.date_service || null) === dateAvant && cibles.some((x) => (x.prestation_id || null) === (l.prestation_id || null) && (x.trajet_id || null) === (l.trajet_id || null))) modif(l, { date_service: dateApres });
    }
  }
  // Base pour 1 ou 2 personnes + suppléments : le nombre total de personnes règle la quantité du supplément (au-delà de deux), la base ne bouge pas.
  const supplement = cibles.find(estLigneSupplement);
  if (supplement) {
    const total = (p) => nb(p && p.adultes) + nb(p && p.enfants);
    const avantTotal = total(avant.personnes);
    const apresTotal = total(apres.personnes);
    if (avantTotal !== apresTotal) {
      if (qte(supplement) === Math.max(0, avantTotal - 2)) modif(supplement, { qte: Math.max(0, apresTotal - 2) });
      else reste.push({ cle: "adultes", reservation: nb(apres.personnes && apres.personnes.adultes), facture: qte(supplement) + 2 });
    }
    return miseAJour.size ? { contenu: { ...contenu, lignes: lignes.map((l) => (miseAJour.has(l) ? { ...l, ...miseAJour.get(l) } : l)) }, reste } : { contenu: null, reste };
  }
  // Personnes : une ligne adulte et une ligne enfant au plus.
  const parGroupe = [["adultes", cibles.filter((l) => !estLigneEnfant(l))], ["enfants", cibles.filter(estLigneEnfant)]];
  for (const [cle, groupe] of parGroupe) {
    const anciens = nb(avant.personnes && avant.personnes[cle]);
    const nouveaux = nb(apres.personnes && apres.personnes[cle]);
    if (anciens === nouveaux) continue;
    const proportionnelles = groupe.filter((l) => l.unite !== null && l.unite !== undefined && l.unite !== "" && parPersonne(l) && qte(l) === anciens);
    if (groupe.length === 1 && proportionnelles.length === 1 && nouveaux > 0) modif(proportionnelles[0], { qte: nouveaux });
    else reste.push({ cle, reservation: nouveaux, facture: groupe.reduce((somme, l) => somme + (qte(l) || 0), 0) });
  }
  if (!miseAJour.size) return { contenu: null, reste };
  return { contenu: { ...contenu, lignes: lignes.map((l) => (miseAJour.has(l) ? { ...l, ...miseAJour.get(l) } : l)) }, reste };
}

// ---- Service dupliqué : de nouvelles lignes pour un deuxième exemplaire -------------------------------------------
// Copie les lignes du document qui correspondent à la réservation (même prestation, partenaire, date, quantités, prix), avec de nouveaux identifiants,
// à la suite des autres : la réservation du double se crée ensuite comme pour tout service ajouté. Les notes « à payer sur place » ne sont pas copiées
// (une note par prestation et par date suffit). Renvoie { contenu, ids } ou null quand le document ne porte aucune ligne de ce service.
export function contenuAvecServiceDuplique(contenu, r, uid = nouvelId) {
  const ids = new Set([r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean));
  const lignes = (contenu && contenu.lignes) || [];
  const sources = lignes.filter((l) => ids.has(l.id) && l.kind !== "texte" && l.kind !== "remise");
  if (!sources.length) return null;
  const doubles = sources.map((l) => ({ ...structuredClone(l), id: uid() }));
  return { contenu: { ...contenu, lignes: [...lignes, ...doubles] }, ids: doubles.map((l) => l.id) };
}

// ---- Service supprimé : ce que la facture doit perdre ------------------------------------------------------------
// Une réservation est créée d'après des lignes de la facture (`ligne_id`, et `details.lignes_ids` quand adulte et enfant sont réunis).
// Quand on la supprime, ces lignes partent de la facture, ainsi que la note « à payer sur place » de la même prestation si plus aucune ligne
// de cette prestation, à la même date, ne la justifie, et le nom du prestataire s'il ne sert plus. Rien n'est modifié sur place : la fonction
// renvoie un nouveau contenu (ou null quand la facture ne porte aucune ligne de ce service).
export function contenuSansReservation(contenu, r, { nomPartenaire = () => "" } = {}) {
  const ids = new Set([r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean));
  const lignes = (contenu && contenu.lignes) || [];
  if (!ids.size || !lignes.some((l) => ids.has(l.id))) return null;
  const retirees = lignes.filter((l) => ids.has(l.id));
  const memeService = (a, b) => (a.prestation_id || null) === (b.prestation_id || null) && (a.trajet_id || null) === (b.trajet_id || null) && (a.date_service || null) === (b.date_service || null);
  const reste = lignes.filter((l) => !ids.has(l.id));
  // Les notes sur place portent la prestation et la date du service : elles partent avec lui, sauf si une autre ligne du même service reste.
  const notes = reste.filter((l) => l.kind === "texte" && l.sur_place && retirees.some((x) => memeService(x, l)) && !reste.some((x) => x.kind !== "texte" && memeService(x, l)));
  const restantes = reste.filter((l) => !notes.includes(l));
  const prestataires = (liste) => [...new Set(liste.map((l) => nomPartenaire(l.partenaire_id)).filter(Boolean))].join(", ");
  const suite = { ...contenu, lignes: restantes };
  // Le prestataire affiché est posé à l'ajout des services : on le suit seulement s'il n'a pas été réécrit à la main.
  if (contenu.prestataire && contenu.prestataire === prestataires(lignes)) suite.prestataire = prestataires(restantes);
  return { contenu: suite, retirees: [...retirees, ...notes] };
}

// ---- Contrôles avant d'envoyer un voucher ------------------------------------------------------------------------
// Ce qui manque ou reste à vérifier sur la réservation. Renvoie des codes ; l'écran les traduit. Un voucher peut être envoyé quand même.
export function controlesVoucher(r, client = {}, type = "") {
  const codes = [];
  if (r.statut !== "confirme") codes.push("non_confirmee");
  if (!r.date_service) codes.push("sans_date");
  if (type !== "location") {
    if (!String(r.heure_pickup || "").trim()) codes.push("sans_heure");
    if (!String(r.lieu_pickup || "").trim()) codes.push((client.adresse || "").trim() ? "lieu_adresse_client" : "sans_lieu");
  }
  return codes;
}

// ---- Feuille du jour ---------------------------------------------------------------------------------------------
// Les réservations d'une date, par partenaire, pour le chauffeur ou le capitaine : heure, client, téléphone, hôtel, personnes, prestation.
// `contexte.client(r)` renvoie le client d'une réservation, `contexte.partenaire(id)` son nom.
export function feuilleDuJour(reservations, date, contexte, ecartees = new Set()) {
  const groupes = new Map();
  for (const r of reservations) {
    if (r.date_service !== date || r.statut === "annule" || ecartees.has(r.dossier_id) || estFraisDeParc(r)) continue;
    const cle = r.partenaire_id || "";
    const g = groupes.get(cle) || { partenaire_id: r.partenaire_id || null, nom: (r.partenaire_id && contexte.partenaire(r.partenaire_id)) || "", lignes: [], adultes: 0, enfants: 0 };
    const c = contexte.client(r) || {};
    const lieu = hotelEtChambre(c, r);
    g.lignes.push({ id: r.id, heure: r.heure_pickup || "", client: [c.prenom, c.nom].filter(Boolean).join(" "), telephone: c.telephone || "", hotel: lieu.hotel, chambre: lieu.chambre, personnes: r.personnes || {}, libelle: r.libelle, reference: r.reference_partenaire || "", statut: r.statut });
    g.adultes += Number(r.personnes && r.personnes.adultes) || 0;
    g.enfants += Number(r.personnes && r.personnes.enfants) || 0;
    groupes.set(cle, g);
  }
  return [...groupes.values()]
    .map((g) => ({ ...g, lignes: g.lignes.sort((a, b) => (a.heure || "99").localeCompare(b.heure || "99") || a.client.localeCompare(b.client)) }))
    .sort((a, b) => (a.nom || "~").localeCompare(b.nom || "~"));
}

// Texte à coller dans WhatsApp, en anglais comme les messages aux partenaires.
export function texteFeuille(groupe, date) {
  const tete = `${groupe.nom ? `${groupe.nom}: ` : ""}${dateTexte(date, "en")}, ${personnesTexte({ adultes: groupe.adultes, enfants: groupe.enfants }, "en") || "0 passengers"}`;
  const lignes = groupe.lignes.map((l) => [l.heure, libelleClient(l.libelle), l.client, l.telephone, [l.hotel, l.chambre ? `room ${l.chambre}` : ""].filter(Boolean).join(", "), personnesTexte(l.personnes, "en")].filter(Boolean).join(" · "));
  return [tete, ...lignes].join("\n");
}
