// Logique pure des opérations : réservations auprès des partenaires, messages types, dû aux partenaires.
// Aucune dépendance au navigateur pour pouvoir la tester avec node --test.

import { langueActive, N_ } from "./i18n.mjs";
import { chiffres, estLigneSupplement, estLigneOption, ligneOption, prefixeProgramme, libelleClient, libelleUnite, quantiteParDefaut } from "./partenaires-calc.mjs";
import { SUR_PLACE, CHEZ_NOUS, modeReglement } from "./calc.mjs";
import { estTaxi } from "./taxi-calc.mjs";
import { estRetourDepart, trajetPourChauffeur, DROPOFF_RETOUR } from "./trajet-calc.mjs";
import { siegesLus, siegesAnglais } from "./sieges-calc.mjs";

export { SUR_PLACE, CHEZ_NOUS, modeReglement };

// Anaïs demande au prestataire avant de saisir le dossier, qui n'entre dans l'outil qu'une fois confirmé par le client (Jérémy, 14.11.2026) :
// une réservation est confirmée ou annulée, sans étapes de demande. Les anciens statuts « à demander » et « demandée » se lisent comme confirmés.
export const STATUTS_RESERVATION = { confirme: N_("Confirmée"), annule: N_("Annulée") };
export const statutReservation = (code) => (code === "annule" ? "annule" : "confirme");

const nouvelId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const brut = (l) => (l.unite !== null && l.unite !== undefined && l.unite !== "" && l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.unite) * Number(l.qte) : l.montant !== null && l.montant !== undefined && l.montant !== "" ? Number(l.montant) : null);

// Une réservation par ligne de partenaire du document, sauf celles qui existent déjà (même ligne).
// Le net prévu est renvoyé à part : il va dans la table protégée.
// Les lignes adulte et enfant d'un même bateau ou d'une même excursion (même partenaire, même date, même nom
// sans le suffixe enfant) donnent une seule réservation, avec les adultes et les enfants réunis.
// « , driver child (6-12) », « , passenger child (4-12) » (ATV, 19.11.2026) : des tarifs enfant aussi.
export const estLigneEnfant = (l) => /enfant|child/i.test(l.intro || "") || /,\s*(?:(?:driver|passenger|conducteur|passager)\s+)?(child|enfant)\b/i.test(l.titre || l.libelle || "");
// Le nom du service sans ses variantes : « , enfant », « , Personne supplémentaire », « , Base 1-2 pers » : le prix de base, le supplément et les enfants font une seule réservation.
// Les rôles d'un même véhicule (ATV : « , driver », « , passenger », 19.11.2026) sont aussi des variantes : conducteur et passager font un seul voucher.
export const nomSansEnfant = (l) => String(l.titre || l.libelle || "").replace(/,\s*(?:child|enfant|driver|passenger|conducteur|passager|personne suppl[ée]mentaire|extra person|additional person|base\s*1\s*[-–]\s*2)\b.*$/i, "").trim();
// Le rôle d'une ligne (conducteur ou passager), ou "" : « P1: ATV 30 mins, passenger child (4-12) » → passenger.
const roleDeLigne = (l) => {
  const m = String(l.titre || l.libelle || "").match(/,\s*(driver|passenger|conducteur|passager)\b/i);
  return m ? (/^(driver|conducteur)$/i.test(m[1]) ? "driver" : "passenger") : "";
};
// Ce que le partenaire doit savoir d'un service à rôles : « 1 driver + 1 passenger » (le nombre de véhicules). "" sans rôle.
export function rolesDuService(lignes, langue = "en") {
  const compte = { driver: 0, passenger: 0 };
  for (const l of lignes || []) {
    if (l.kind === "texte" || l.kind === "remise") continue;
    const r = roleDeLigne(l);
    if (r) compte[r] += l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.qte) || 0 : 1;
  }
  const fr = langue === "fr";
  const mots = { driver: fr ? ["conducteur", "conducteurs"] : ["driver", "drivers"], passenger: fr ? ["passager", "passagers"] : ["passenger", "passengers"] };
  return ["driver", "passenger"].filter((k) => compte[k] > 0).map((k) => `${compte[k]} ${mots[k][compte[k] > 1 ? 1 : 0]}`).join(" + ");
}
export function reservationsDepuisDocument(doc, { existantes = [], uid = nouvelId, regleDe = null, prestationDe = null } = {}) {
  const deja = new Set(existantes.flatMap((r) => [r.ligne_id, ...((r.details && r.details.lignes_ids) || [])]));
  const groupes = new Map();
  const lignesDoc = (doc.contenu && doc.contenu.lignes) || [];
  // Un programme qui a une ligne de supplément se regroupe sous le nom du programme (« Programme B ») : base, supplément et enfants font une réservation.
  const base = (l) => `${l.trajet_id || ""}|${l.partenaire_id || ""}|${l.date_service || ""}`;
  const programmes = new Set(lignesDoc.filter((x) => estLigneSupplement(x) && prefixeProgramme(nomSansEnfant(x))).map((x) => `${base(x)}|${prefixeProgramme(nomSansEnfant(x))}`));
  // Une option (26.11.2026) rejoint le groupe de la ligne de son service (`option_de`) : ses lignes passent après celles des services.
  const cleDe = new Map();
  const options = [];
  for (const l of lignesDoc) {
    if (l.kind === "texte" || l.kind === "remise" || !(l.prestation_id || l.trajet_id || l.libre) || deja.has(l.id) || estFraisDeParc({ partenaire_id: l.partenaire_id, libelle: l.titre || l.libelle }, prestationDe && l.prestation_id ? prestationDe(l.prestation_id) : null)) continue;
    if (estLigneOption(l)) {
      options.push(l);
      continue;
    }
    const prog = prefixeProgramme(nomSansEnfant(l));
    const cle = `${base(l)}|${prog && programmes.has(`${base(l)}|${prog}`) ? prog : sansAccentsMin(nomSansEnfant(l))}`;
    cleDe.set(l.id, cle);
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
  // Les options : leur prix et leur net comptent dans le service ; elles ne comptent ni personnes, ni jours, ni rôles. Une option dont le
  // service n'est pas sur ce document (ou déjà réservé : rattachementsDepuisDocument s'en charge) ne crée pas de réservation à elle seule.
  for (const l of options) {
    const g = groupes.get(cleDe.get(l.option_de));
    if (!g) continue;
    const qte = l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.qte) : 1;
    g.lignes.push(l);
    g.options = [...(g.options || []), l];
    g.vente += brut(l) || 0;
    if (l.net !== null && l.net !== undefined) g.net = (g.net || 0) + Math.round(Number(l.net) * qte * 100) / 100;
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
    // Les participants gardés sur la ligne (18.11.2026) l'emportent sur la quantité facturée : le voucher montre qui vient, pas ce qui est payé.
    const participants = participantsDuService(g.lignes);
    if (participants) (g.adultes = participants.adultes), (g.enfants = participants.enfants);
    const l = g.premiere;
    const sansOptions = g.lignes.filter((x) => !estLigneOption(x));
    return {
      // `titre` : le nom court de la prestation quand le libellé de la ligne porte aussi les personnes et la date.
      reservation: { id: uid(), dossier_id: doc.dossier_id, ligne_id: l.id, prestation_id: l.prestation_id || null, trajet_id: l.trajet_id || null, partenaire_id: l.partenaire_id || null, libelle: nomSansEnfant(l), date_service: l.date_service || null, heure_pickup: "", lieu_pickup: "", personnes: { adultes: g.adultes, enfants: g.enfants, bebes: 0 }, statut: "confirme", reference_partenaire: "", montant_vente: g.lignes.some((x) => brut(x) !== null) ? Math.round(g.vente * 100) / 100 : null, notes: "", paye_sur_place: g.lignes.some((x) => !!x.paye_sur_place), details: { ...(g.lignes.length > 1 ? { lignes_ids: g.lignes.map((x) => x.id) } : {}), ...(g.jours ? { jours: g.jours } : {}), ...(rolesDuService(sansOptions) ? { roles: rolesDuService(sansOptions) } : {}), ...(modeleDeLigne(l) ? { modele_voucher: modeleDeLigne(l) } : {}) } },
      // Net partiel laissé vide (Jérémy, 17.11.2026 : « on mettra le net final au cas par cas ») : quand une ligne à prix du service n'a pas de net,
      // le net prévu reste vide plutôt que la somme des seuls nets connus. Le service apparaît alors dans « À vérifier ».
      net: netCompletDe(g) ? g.net : null,
      // Service payé sur place : la commission attendue se calcule d'après la règle du partenaire (`regleDe(partenaire_id)`), seulement quand elle est connue.
      ...commissionDuGroupe(g, l, regleDe),
      // Les personnes viennent des participants gardés sur la ligne : celles du dossier ne les remplacent pas.
      ...(participants ? { participants: true } : {}),
    };
  });
}

// Le modèle de voucher choisi dans « Autre prestation » (ligne hors catalogue) suit la ligne jusqu'à sa réservation.
const modeleDeLigne = (l) => modeleChoisi({ details: { modele_voucher: l && l.modele_voucher } });

// Le net d'un service n'est connu que s'il l'est pour chacune de ses lignes qui ont un prix (une ligne offerte ou sans prix ne compte pas).
const netCompletDe = (g) => g.lignes.every((x) => !(brut(x) > 0) || (x.net !== null && x.net !== undefined));

function commissionDuGroupe(g, l, regleDe) {
  if (!regleDe || !g.lignes.some((x) => x.paye_sur_place)) return {};
  // Le net ne compte que s'il est connu pour toutes les lignes qui ont un prix : un net partiel gonflerait la commission.
  const c = commissionPrevue(regleDe(l.partenaire_id || null), { vente: g.vente, net: netCompletDe(g) ? g.net : null, adultes: g.adultes, enfants: g.enfants });
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
  // Un message désactivé (lot D) n'est pas proposé, et il empêche aussi le modèle de départ du même usage de revenir.
  const liste = [...virtuels, ...base.filter((m) => m.actif !== false)];
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
    // La personne à qui l'on écrit chez le partenaire (le contact de sa fiche), sinon le nom du partenaire.
    contact: ((partenaire.contact || {}).personne || "").trim() || partenaire.nom || "",
    // Taxi : lieu de dépose et prix de la course (payé au chauffeur), tels que saisis sur la réservation.
    // Retour au point de départ (16.11.2026) : pas de dépose, on le dit plutôt que de laisser un blanc.
    dropoff: estRetourDepart(reservation) ? DROPOFF_RETOUR[langue] || DROPOFF_RETOUR.en : libelleClient(((reservation.details || {}).drop_off) || ""),
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
// « Complet » : le client a reçu chaque voucher. Anaïs écrit elle-même aux prestataires (Jérémy, 14.11.2026) : l'outil ne suit plus que le client.
// `modifies` (facultatif) : identifiants des réservations dont le voucher a changé depuis l'envoi (voir empreinteVoucher). Un voucher
// modifié compte comme à renvoyer : le dossier ne reste pas « Vouchers envoyés » (audit du 16.11.2026, n° 24).
export function etatEnvoisVouchers(reservations, { modifies = new Set() } = {}) {
  const envoi = (r, cle) => !!(r.details && r.details.envois && r.details.envois[cle]);
  const total = reservations.length;
  const client = reservations.filter((r) => envoi(r, "client") && !modifies.has(r.id)).length;
  const aRenvoyer = reservations.filter((r) => envoi(r, "client") && modifies.has(r.id)).length;
  return { total, client, complet: total > 0 && client === total, ...(aRenvoyer ? { aRenvoyer } : {}) };
}

// Les détails d'une réservation avec un envoi de plus (« client » ou « prestataire »), sans effacer les autres.
export const detailsAvecEnvoi = (details, cible, date) => ({ ...(details || {}), envois: { ...((details && details.envois) || {}), [cible]: date } });

// Frais de parc : une somme à payer sur l'île, pas un service qui part. Ni heure de pickup, ni prestataire : ils ne figurent ni dans l'agenda, ni dans la feuille
// du jour, ni dans les alertes « pickup à compléter », et leur ligne de facture ne crée pas de réservation.
// Le libellé EST un frais (revues du 24.11.2026) : il COMMENCE par le mot-clé, dans sa partie principale (avant une parenthèse ou une flèche).
// « Frais d'entrée du parc », « National park fees: 4 Islands », « Entrance fee Koh Phi Phi » sont des frais. « Koh Rok park fee » ne l'est
// plus par son libellé seul (« Private taxi to Emerald Pool and entrance fee », « Taxi Hotel - Tiger Cave Temple, entrance fee » finissent
// aussi par le mot-clé) : un frais nommé autrement se reconnaît par la famille de sa prestation, « frais ». Même motif et même découpe dans
// supabase/functions/rappels/calc.js et la migration 128 (frais_de_parc_libelle) : un test compare les trois.
export const MOTIF_FRAIS_PARC = "frais (de|du) parc|frais d['’]entr[ée]e|(national )?park (entrance )?fees?|entrance fees?|droits? (d['’]entr[ée]e|(de|du) parc)";
const FRAIS_DEBUT = new RegExp(`^\\s*(${MOTIF_FRAIS_PARC})`, "i");
export const partiePrincipale = (libelle) => String(libelle || "").split(/\(|→|->/)[0].trim();
export const libelleEstFrais = (libelle) => FRAIS_DEBUT.test(partiePrincipale(libelle));
// Ancien nom gardé pour les imports : le motif seul (il ne suffit plus, voir libelleEstFrais).
export const FRAIS_PARC = new RegExp(MOTIF_FRAIS_PARC, "i");
// `prestation` (facultatif) : la prestation de la réservation ; une prestation de la famille « frais » est toujours un frais.
export const estFraisDeParc = (r, prestation = null) => !!r && ((!!prestation && prestation.famille === "frais") || (!r.partenaire_id && libelleEstFrais(r.libelle)));
// Le test des frais avec la prestation de chaque réservation : `prestationDe(id)` rend la prestation (ou rien).
export const fraisAvec = (prestationDe = null) => (r) => estFraisDeParc(r, prestationDe && r && r.prestation_id ? prestationDe(r.prestation_id) : null);

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
export function agenda(reservations, ajd, ecartees = new Set(), { netDe = () => null, prestationDe = null } = {}) {
  const estFrais = fraisAvec(prestationDe);
  const demain = ajouterJours(ajd, 1);
  const hier = ajouterJours(ajd, -1);
  const actives = reservations.filter((r) => r.statut !== "annule" && !ecartees.has(r.dossier_id) && !estFrais(r));
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
// Une correction de commission (migration 119) encore en vigueur : la commission prévue est celle que la correction a posée. Changée ensuite
// ailleurs (Taxi du lendemain, fiche du service), elle redevient une commission ordinaire.
export const correctionEnVigueur = (n) =>
  !!(n && n.commission_corrigee_le) && n.commission_apres_correction !== null && n.commission_apres_correction !== undefined && n.commission_prevue !== null && n.commission_prevue !== undefined && Math.round(Number(n.commission_prevue) * 100) === Math.round(Number(n.commission_apres_correction) * 100);

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
    // Corrigée à la main (remboursement partiel, geste commercial…, migration 119) et pas modifiée depuis : la règle du partenaire ne la défait
    // pas, et ne la signale pas non plus comme un écart, même une fois reçue.
    if (correctionEnVigueur(n)) { inchanges++; continue; }
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

// L'adresse de la fiche sert-elle d'hôtel pour un service de l'entreprise `entiteId` ? Non pour une fiche partagée par une autre entreprise
// (fiche ZTP sur un service de Secret, migration 46) : son adresse est postale. Sans entreprise connue, oui (comme avant).
export const adresseEstHotel = (client, entiteId) => !(client && client.entite_id && entiteId && client.entite_id !== entiteId);
const adresseHotel = (client, entiteId) => (client && adresseEstHotel(client, entiteId) ? String(client.adresse || "") : "");

// Lieu de pickup d'un service ajouté à un dossier : le dernier lieu saisi sur ses autres réservations, sinon la première ligne de l'adresse du client.
// `entiteId` : l'entreprise du dossier. Une fiche partagée par une autre entreprise (ZTP) a une adresse postale, pas un lieu de pickup.
export function lieuParDefaut(reservationsDuDossier, client = {}, entiteId = null) {
  const avecLieu = (reservationsDuDossier || []).filter((r) => String(r.lieu_pickup || "").trim()).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  if (avecLieu.length) return String(avecLieu[0].lieu_pickup).trim();
  return adresseHotel(client, entiteId).split("\n")[0].trim();
}

// Un partenaire a-t-il un mode et une règle de commission renseignés ? Sert à signaler ce qui reste à compléter.
export const regleDeCommissionComplete = (regle) => commissionPrevue(regle, { vente: 1, net: 1, adultes: 1 }) !== null;

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

// Participants d'un service (Jérémy, 18.11.2026) : les adultes et enfants réels, gardés sur la ligne (`personnes`) quand elle est ajoutée,
// distincts de la quantité facturée (un tuk-tuk à 1 200 pour le groupe : quantité 1, participants 2 adultes et 2 enfants).
export function participantsLigne(l) {
  const p = l && l.personnes;
  if (!p) return null;
  const a = Math.max(0, Math.floor(Number(p.adultes) || 0));
  const e = Math.max(0, Math.floor(Number(p.enfants) || 0));
  return a + e ? { adultes: a, enfants: e } : null;
}
// Une ligne seule qui facture tout le service porte ses participants : prix par groupe ou par véhicule, prestation hors catalogue, ou tarif
// par personne dont la quantité est bien le nombre de participants (enfants au prix adulte). Sinon (ligne adulte et ligne enfant séparées,
// quantité changée à la main) la quantité d'une ligne par personne reste son nombre de personnes, comme avant.
export function participantsDuService(lignes) {
  // Les options (26.11.2026) ne disent rien des personnes : un service et son extension restent « une ligne ».
  const utiles = (lignes || []).filter((l) => l && l.kind !== "texte" && l.kind !== "remise" && !estLigneOption(l));
  if (utiles.length !== 1) return null;
  const l = utiles[0];
  const p = participantsLigne(l);
  if (!p || estLigneEnfant(l) || estLigneJours(l)) return null;
  const qte = l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.qte) : 1;
  return compteDe(l) !== "personnes" || l.libre || qte === p.adultes + p.enfants ? p : null;
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
  billet: ["de", "vers", "depart", "arrivee", "bateau", "embarquement", "checkin", "bagages", "remarques", "remarques_paiement"],
  bateau: ["hotel", "chambre", "type_tour", "bateau", "parc", "parc_texte", "remarques", "remarques_paiement"],
  // `type_trajet` : aller simple (drop-off) ou retour au point de départ (programme et durée à la place du drop-off, trajet-calc.mjs).
  transfert: ["type_trajet", "drop_off", "programme_trajet", "duree_h", "vol", "bagages", "sieges", "type_transfert", "remarques", "remarques_paiement"],
  activite: ["hotel", "chambre", "programme", "heure_service", "remarques", "remarques_paiement"],
  location: ["hotel", "chambre", "retour_date", "retour_heure", "retour_lieu", "permis", "equipement", "caution", "conditions", "remarques", "remarques_paiement"],
};
// Un billet lié à un trajet de la base en tire le départ, l'arrivée, les horaires et le bateau : ces champs ne se demandent que pour un billet
// saisi à la main (partenaire ajouté sans trajet, Jérémy le 14.11.2026 : « un intitulé Route mais je ne vois pas où mettre le départ et l'arrivée »).
const DU_TRAJET = ["de", "vers", "depart", "arrivee", "bateau"];
// Un trajet du catalogue par la route (voucher de transfert depuis la PR 337) garde la règle de son ancien billet et celle de l'Assistant
// (siegesRequisDuService, agent/outils.js) : pas de sièges exigés, pas de « retour au point de départ » (le trajet a ses deux bouts).
// Décision de la relecture de la PR 337 (23.11.2026). Le nombre de bébés reste demandé (bebesDemandes).
const HORS_TRAJET_ROUTE = ["type_trajet", "programme_trajet", "duree_h", "sieges"];
export const champsVoucherDe = (type, { trajet = false } = {}) => (CHAMPS_VOUCHER[type] || []).filter((c) => !(trajet && ((type === "billet" && DU_TRAJET.includes(c)) || (type === "transfert" && HORS_TRAJET_ROUTE.includes(c)))));
// Le nombre de bébés se demande pour un billet de bateau, et pour tout trajet du catalogue (même passé en transfert par la route).
export const bebesDemandes = (type, { trajet = false } = {}) => type === null || type === "billet" || (trajet && type === "transfert");
// Les deux bouts d'un transfert d'après son trajet, sinon d'après le libellé « A → B » (de la prestation, sinon de la réservation) :
// ce que le voucher et la Booking confirmation impriment quand le pickup ou le drop-off n'a pas été saisi.
export const dropOffDepuisLibelle = (r, p, trajet) => (estRetourDepart(r) ? "" : trajet ? trajet.vers : ((p && p.libelle) || r.libelle || "").includes("→") ? ((p && p.libelle) || r.libelle).split("→").pop().trim() : "");
export const pickupDepuisLibelle = (r, p, trajet) => (trajet ? trajet.de : ((p && p.libelle) || r.libelle || "").includes("→") ? ((p && p.libelle) || r.libelle).split("→")[0].replace(/^[^:]*:\s*/, "").trim() : "");

// Sièges enfant ou bébé d'un transfert, imprimés après le nombre d'enfants : « 1 (1 child seat, 1 baby seat) », « 1 (no child seat needed) ».
// `x` : les `details` de la réservation (sièges par type, sieges-calc.mjs) ou un nombre de sièges enfant (ancienne forme). Rien sans rien de dit.
export const siegesVoucher = (x) => {
  const t = siegesAnglais(x && typeof x === "object" ? siegesLus(x) : { enfant: Math.max(0, Math.floor(Number(x) || 0)) });
  return t ? ` (${t})` : "";
};
export const TITRES_VOUCHER = { billet: "Boat Ticket Voucher", bateau: "Boat Tour Voucher", transfert: "Transfer Voucher", activite: "Activity & Tour Voucher", location: "Rental Voucher" };

// Point d'embarquement de la compagnie pour un lieu de départ, d'après les points de sa fiche.
export function pointEmbarquement(partenaire, lieu) {
  const points = (partenaire && partenaire.regles && partenaire.regles.points_embarquement) || [];
  const cible = sansAccentsMin(lieu);
  const p = points.find((x) => sansAccentsMin(x.lieu) === cible) || points.find((x) => cible && (sansAccentsMin(x.lieu).includes(cible) || cible.includes(sansAccentsMin(x.lieu))));
  return p ? pointEmbarquementEn(p.ou) : "";
}

// Les points d'embarquement de la base sont écrits en français (« Bureau X au Y Pier ») : en anglais pour le voucher.
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

// Embarcadère d'une compagnie, d'après sa fiche (audit n° 48) : le point d'embarquement du lieu de départ, sinon l'embarcadère général
// de la fiche (« Embarcadère ou point de départ »), mis en anglais comme les points d'embarquement.
// L'embarcadère général ne sert qu'à une compagnie sans points par lieu : avec des points, un départ d'un autre lieu n'a pas d'embarcadère connu.
export function embarcadereFiche(partenaire, lieu) {
  const points = (partenaire && partenaire.regles && partenaire.regles.points_embarquement) || [];
  if (points.length) return pointEmbarquement(partenaire, lieu);
  return pointEmbarquementEn(String((partenaire && partenaire.contact && partenaire.contact.embarcadere) || "").trim());
}

// ---- Règles des partenaires et des destinations (migration 43, 18.11.2026) -------------------------------------------------
// Plus aucun nom de compagnie ni de lieu dans ces règles : chacune se lit sur la fiche du partenaire (Partenaires) ou dans les
// destinations à passeport des réglages de l'entreprise (`reglages.destinations_passeport`).
export const CHECKIN_DEFAUT = "Please arrive at the pier 30 minutes before departure with this voucher and your passport or ID.";
export const CHECKIN_PASSEPORT_DEFAUT = "Check-in 90 minutes before departure for immigration formalities. Passport of each passenger required.";

// Destination à passeport : la première règle dont un mot figure dans `textes` (sans accents ni majuscules). Une règle :
// { lieux: ["…"], mentions: ["…"], note_en, note_fr }. `lieux` : un départ ou une arrivée qui demande la consigne de check-in « passeport ».
// `mentions` (avec `avecMentions`) : des mots qui, n'importe où dans le trajet ou le libellé, ajoutent la note sans être un lieu de la ligne.
const termes = (x) => (Array.isArray(x) ? x : String(x || "").split(",")).map(sansAccentsMin).filter(Boolean);
export function destinationPasseport(destinations, textes, { avecMentions = false } = {}) {
  const t = sansAccentsMin(textes.filter(Boolean).join(" "));
  if (!t) return null;
  return (destinations || []).find((d) => d && [...termes(d.lieux), ...(avecMentions ? termes(d.mentions) : [])].some((l) => t.includes(l))) || null;
}

// Consigne de check-in de la compagnie (anglais) : celle de sa fiche, sinon la consigne générale. Sur une ligne vers ou depuis une destination
// à passeport : la consigne « passeport » de la fiche (`checkin_passeport`), sinon celle de l'immigration, qui vaut pour toutes.
export function consigneCheckin(partenaire, { passeport = false } = {}) {
  const p = partenaire || {};
  if (passeport) return String(p.checkin_passeport || "").trim() || CHECKIN_PASSEPORT_DEFAUT;
  return String((p.regles && p.regles.checkin_voucher) || "").trim() || CHECKIN_DEFAUT;
}
// Consigne imprimée sur le billet : la ligne passe par une destination à passeport quand son départ ou son arrivée en est une.
export const consigneCheckinFiche = (partenaire, trajet = {}, destinations = []) => consigneCheckin(partenaire, { passeport: !!destinationPasseport(destinations, [trajet.de, trajet.vers]) });

// Trajet vers ou depuis une destination à passeport : la note à lire par le client avant de partir (texte de la règle), suivie de la consigne
// de check-in « passeport » de la compagnie. Vide pour tout autre trajet. `langue` : « fr » pour la note française (le check-in reste anglais).
export function notePasseport({ de = "", vers = "", libelle = "", partenaire = null, destinations = [], langue = "en" } = {}) {
  const d = destinationPasseport(destinations, [de, vers, libelle], { avecMentions: true });
  if (!d) return "";
  const note = String((langue === "fr" ? d.note_fr || d.note_en : d.note_en || d.note_fr) || "").trim();
  return `${note} ${consigneCheckin(partenaire, { passeport: true })}`.trim();
}
const sansAccentsMin = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// Partenaire payé d'avance (case « À payer avant la veille » de la fiche) : les clients nous paient, et nous reversons au prestataire avant
// la veille du départ (jamais la veille : il peut annuler). Sauf pour un départ de l'un des lieux de `payer_avant_veille_sauf` (séparés par
// des virgules). Renvoie { avant, date_service } (« avant » : la veille, premier jour où ce n'est plus assez tôt) ou null.
// Rien pour un service payé sur place, ni pour un départ inconnu : on ne devine pas. `paye` : le net est déjà reversé.
export function alerteAvantVeille(r, { partenaire = null, trajet = null, paye = false } = {}) {
  if (!r || r.statut === "annule" || r.paye_sur_place || !r.date_service || paye || !(partenaire && partenaire.payer_avant_veille)) return null;
  const depart = trajet ? trajet.de : String(r.libelle || "").split(/→|->/).length > 1 ? String(r.libelle).split(/→|->/)[0] : "";
  if (!String(depart || "").trim()) return null;
  const d0 = sansAccentsMin(depart);
  if (termes(partenaire.payer_avant_veille_sauf).some((l) => d0.includes(l))) return null;
  const d = new Date(`${r.date_service}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return { avant: d.toISOString().slice(0, 10), date_service: r.date_service };
}

// Tarifs par zone (case « Tarifs par zone » de la fiche) : une prestation sans « A → B » n'a pas de départ fixe, le pickup et le drop-off
// se remplissent à la main sur le voucher.
export const estTarifZone = (prestation, partenaire) => !!prestation && !!(partenaire && partenaire.tarif_zone) && !String(prestation.libelle || "").includes("→");

// Dates du dossier déduites de ses réservations (hors annulées) : la première et la dernière date de service.
export function datesDepuisReservations(reservations) {
  const dates = reservations.filter((r) => r.statut !== "annule" && r.date_service).map((r) => r.date_service).sort();
  if (!dates.length) return { date_depart: null, date_retour: null };
  return { date_depart: dates[0], date_retour: dates.length > 1 && dates[dates.length - 1] !== dates[0] ? dates[dates.length - 1] : null };
}

// Modèle de voucher choisi sur la réservation (`details.modele_voucher`, lot B du 17.11.2026) : il passe avant toute déduction.
// « aucun » : pas de voucher pour ce service (une option, un supplément). Vide : automatique, d'après la prestation et le libellé.
export const MODELES_VOUCHER = ["billet", "bateau", "transfert", "activite", "location"];
export const SANS_VOUCHER = "aucun";
export const modeleChoisi = (reservation) => {
  const m = (reservation && reservation.details && reservation.details.modele_voucher) || "";
  return m === SANS_VOUCHER || MODELES_VOUCHER.includes(m) ? m : "";
};

// Le mode d'un trajet du catalogue, d'après son champ « mode » (« Speedboat », « Minivan + minivan (departs Krabi Town at 11:30) »,
// « Shared van + speedboat ») : « bateau » (que de l'eau), « route » (minivan, bus, taxi, sans bateau), « mixte » (les deux), "" (inconnu).
// INV-2026-047 (23.11.2026) : un trajet Lanta → Khao Sok en minivans recevait un billet de bateau parce que tout trajet en était un.
const EAU = /speed ?boat|ferry|\bboat|catamaran|longtail|long-tail|bateau|express boat|ship/i;
const ROUTE = /mini ?van|\bvan\b|mini ?bus|\bbus\b|taxi|\bcar\b|pick-?up|voiture|songthaew|sawngthaew/i;
export function modeTrajet(trajet) {
  const m = String((trajet && trajet.mode) || "");
  const eau = EAU.test(m);
  const route = ROUTE.test(m);
  return eau && route ? "mixte" : eau ? "bateau" : route ? "route" : "";
}

// `partenaire` (facultatif) : pour une réservation à la main chez une compagnie de bateaux (points d'embarquement sur sa fiche), un billet.
// `trajet` (facultatif) : le trajet de la base lié à la réservation, pour un trajet par la route (voucher de transfert, pas un billet de bateau).
export function typeVoucher(reservation, prestation, partenaire = null, trajet = null) {
  const choisi = modeleChoisi(reservation);
  if (choisi) return choisi === SANS_VOUCHER ? null : choisi;
  return typeVoucherDeduit(reservation, prestation, partenaire, trajet);
}

// La déduction d'avant (prestation, trajet, mots du libellé) : la valeur par défaut du menu « Modèle de voucher ».
// Un trajet de la base : un billet de bateau, sauf un trajet tout par la route (minivan, bus) qui reçoit le voucher de transfert. Un trajet
// mixte (bateau puis minivan, ou l'inverse) garde le billet : le client embarque et le check-in au quai s'imprime. Trajet inconnu : billet.
export function typeVoucherDeduit(reservation, prestation, partenaire = null, trajet = null) {
  if (reservation.trajet_id) return trajet && modeTrajet(trajet) === "route" ? "transfert" : "billet";
  if (!prestation && partenaire && ((partenaire.regles && partenaire.regles.points_embarquement && partenaire.regles.points_embarquement.length) || /speed ?boat|ferry/i.test(partenaire.nom || ""))) return "billet";
  const f = prestation ? prestation.famille : "";
  const g = `${(prestation && prestation.groupe) || ""} ${(prestation && prestation.libelle) || ""}`;
  if (f === "frais") return null;
  // Une option (extension d'île, supplément) se note sur le voucher du tour, elle n'a pas le sien.
  if ((prestation && prestation.unite === "sup") || /^option|supplément|supplement|extension|\bextra (?:dive|person)\b/i.test(g)) return null;
  // Retour au point de départ : toujours un transfert (une course hors catalogue « Round trip from … » n'a ni prestation ni flèche).
  if (estRetourDepart(reservation) && f !== "excursion" && f !== "activite" && f !== "location") return "transfert";
  if (f === "transfert") return /speedboat|ferry|bateau|boat/i.test(g) ? "billet" : "transfert";
  if (f === "location") return "location";
  if (f === "activite") return "activite";
  // Une excursion à la journée en taxi (VIP Taxi) est une activité, pas un transfert.
  if (f === "excursion") return /taxi|van/i.test((prestation && prestation.groupe) || "") ? "activite" : "bateau";
  if (/speedboat|ferry/i.test(reservation.libelle || "")) return "billet";
  return /transfer|taxi|van|→|^round trip from\b/i.test(reservation.libelle || "") ? "transfert" : "activite";
}

export const numeroVoucher = (ref, index) => `${ref}-${index}`;

// Numéros des vouchers d'un dossier. `liste` : dans l'ordre de création, chacun avec `fige` (son numéro gardé au premier envoi, ou null).
// Un numéro parti chez le client ne change plus (audit du 16.11.2026, n° 25) : supprimer un service ou le passer en option ne renumérote
// que les vouchers jamais envoyés, qui gardent leur rang quand il est libre, sinon prennent le premier numéro libre au-dessus.
// Renvoie les index (1, 2, 3…) dans l'ordre de `liste`.
export function numerosVouchers(liste) {
  const pris = new Set(liste.map((x) => (x && x.fige ? Number(x.fige) : null)).filter((n) => n > 0));
  const donnes = new Set();
  return liste.map((x, i) => {
    if (x && Number(x.fige) > 0) return Number(x.fige);
    let n = i + 1;
    while (pris.has(n) || donnes.has(n)) n++;
    donnes.add(n);
    return n;
  });
}

// Statut de paiement imprimé sur le voucher, d'après ce que le dossier a encaissé.
// « en_attente » (Payment Pending) : rien n'est encore reçu et le client ne paie pas le prestataire. Ce n'est pas « sur place » : il paiera
// Anaïs, par virement ou autrement (audit du 16.11.2026, n° 26).
export function statutPaiementVoucher({ total = 0, recu = 0, surPlace = false } = {}) {
  if (surPlace) return "sur_place";
  if (total > 0 && recu >= total) return "paye";
  if (recu > 0) return "acompte";
  return "en_attente";
}

// Les options d'un service sur le voucher et la Booking confirmation (26.11.2026) : le nom anglais de chaque option (celui de la prestation,
// sinon le libellé passé par la traduction), suivi du nombre quand l'option en compte plusieurs (lunch box ×2). Jamais de net, de prix ni de
// partenaire : le prix total du service les comprend déjà. `lignes` : les lignes de facture du service ; `prestationDe` : la prestation d'un id.
export function optionsVoucher(lignes = [], prestationDe = () => null) {
  return (lignes || [])
    .filter((l) => estLigneOption(l) && l.kind !== "texte" && l.kind !== "remise")
    .map((l) => {
      const p = l.prestation_id ? prestationDe(l.prestation_id) : null;
      const nom = (p && p.libelle_en) || libelleClient(l.titre || (p && p.libelle) || l.libelle || "");
      const q = l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.qte) : 1;
      return q > 1 ? `${nom} (×${q})` : nom;
    })
    .filter(Boolean);
}

// Prix par personne imprimé sur le voucher d'activité : seulement quand il n'y a qu'un tarif connu (audit n° 27). Une moyenne
// vente ÷ personnes serait fausse si l'enfant paie moins, ou si le prix est celui d'un groupe.
//   - prestation du catalogue vendue à la personne (pas de prix de groupe, de véhicule ni de service hors catalogue) ;
//   - sans enfant : le prix réellement vendu par adulte, s'il tombe juste au centime ;
//   - avec enfants : seulement si aucun tarif enfant n'est connu (`tarifEnfant` : prestationEnfant de demande-calc.mjs, qui lit le prix enfant
//     de la prestation ou l'ancienne prestation enfant séparée) et que tout le monde a payé le prix de la prestation.
// Renvoie le prix, ou null quand il ne faut rien imprimer.
export function prixParPersonneVoucher({ prestation = null, montant = null, adultes = 0, enfants = 0, tarifEnfant = null } = {}) {
  if (!prestation || !["pp", "ad", "pers"].includes(prestation.unite)) return null;
  if (montant === null || montant === undefined || montant === "" || !Number.isFinite(Number(montant))) return null;
  const a = Number(adultes) || 0;
  const e = Number(enfants) || 0;
  if (a + e <= 0) return null;
  const unite = Math.round((Number(montant) / (a + e)) * 100) / 100;
  if (Math.round(unite * (a + e) * 100) !== Math.round(Number(montant) * 100)) return null;
  if (!e) return unite;
  if (tarifEnfant) return null;
  return prestation.prix_vente !== null && prestation.prix_vente !== undefined && Number(prestation.prix_vente) === unite ? unite : null;
}

// ---- Voucher figé à l'envoi (audit n° 22, 24, 25) ------------------------------------------------------------------------------
// Ce qui part chez le client ne change plus quand le catalogue change : au premier envoi, la réservation garde dans `details.voucher_fige`
// le numéro, le modèle, l'opérateur et ce que le voucher lisait dans la prestation, le trajet et la fiche du partenaire, plus une empreinte
// de ce qu'il imprimait. Ensuite, une réservation, un client ou un paiement qui change donne une autre empreinte : « modifié depuis l'envoi ».
// Seuls les champs que le voucher imprime comptent : une note interne, un net ou une trace d'avis ne changent pas l'empreinte.
const CHAMPS_EMPREINTE_DETAILS = [...new Set([...Object.values(CHAMPS_VOUCHER).flat(), "modele_voucher", "jours"])];
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}` : JSON.stringify(v === undefined ? null : v));
// FNV-1a sur 32 bits : assez pour reconnaître un changement, sans dépendance.
function hacher(texte) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
const videOuTexte = (v) => (v === null || v === undefined ? "" : typeof v === "string" ? v.trim() : v);
// `statut` : le statut de paiement imprimé (statutPaiementVoucher). `devise` : celle du dossier.
// `options` : ce que les options du service impriment et coûtent (views/voucher.mjs) ; vide sans option, l'empreinte d'avant ne change pas.
export function empreinteVoucher({ reservation: r = {}, client = {}, statut = "", devise = "", options = "" } = {}) {
  const dt = r.details || {};
  const p = r.personnes || {};
  const donnees = {
    libelle: videOuTexte(r.libelle), date: r.date_service || "", heure: videOuTexte(r.heure_pickup), lieu: videOuTexte(r.lieu_pickup),
    personnes: [Number(p.adultes) || 0, Number(p.enfants) || 0, Number(p.bebes) || 0],
    vente: r.montant_vente === null || r.montant_vente === undefined || r.montant_vente === "" ? null : Math.round(Number(r.montant_vente) * 100),
    partenaire: r.partenaire_id || null, prestation: r.prestation_id || null, trajet: r.trajet_id || null, surPlace: !!r.paye_sur_place, ref: videOuTexte(r.reference_partenaire),
    details: Object.fromEntries(CHAMPS_EMPREINTE_DETAILS.filter((k) => videOuTexte(dt[k]) !== "" && dt[k] !== undefined).map((k) => [k, videOuTexte(dt[k])])),
    // Fiche partagée par une autre entreprise (ZTP sur un voucher de Secret) : son nom seulement. Le voucher n'imprime ni son WhatsApp ni son
    // adresse postale, et l'assistante, qui n'en a que le nom, doit calculer la même empreinte que l'administration.
    client: adresseEstHotel(client, r.entite_id) ? [videOuTexte(client.prenom), videOuTexte(client.nom), videOuTexte(client.telephone), videOuTexte(String(client.adresse || "").split("\n")[0])] : [videOuTexte(client.prenom), videOuTexte(client.nom), "", ""],
    // Le statut de paiement de l'agence ne compte pas (contrôle du 17.11.2026, D6) : un paiement reçu ne fait pas repasser les vouchers
    // « à renvoyer ». Seul ce que le client paie sur place compte (`surPlace`, ci-dessus).
    statut: statut === "sur_place" ? statut : "", devise,
    ...(options ? { options } : {}),
  };
  return hacher(stable(donnees));
}

// La trace figée d'un envoi, à poser dans `details.voucher_fige`. `valeurs` : ce que le voucher a lu ailleurs que dans la réservation
// (voir valeursCatalogue dans views/voucher.mjs). Un renvoi garde le numéro du premier envoi.
export function voucherFige({ reservation: r = {}, index, numero, empreinte, valeurs = {}, date, avant = null }) {
  return { le: date, premier_le: (avant && avant.premier_le) || (avant && avant.le) || date, index: (avant && avant.index) || index, numero: (avant && avant.numero) || numero, empreinte, prestation_id: r.prestation_id || null, trajet_id: r.trajet_id || null, partenaire_id: r.partenaire_id || null, valeurs };
}

// Les valeurs figées ne valent que pour le même service : un autre partenaire, une autre prestation ou un autre trajet choisis sur la
// réservation sont une modification de la réservation (le voucher suit, et l'empreinte le signale).
export const valeursFigees = (r) => {
  const f = r && r.details && r.details.voucher_fige;
  if (!f || !f.valeurs) return null;
  const meme = (f.prestation_id || null) === (r.prestation_id || null) && (f.trajet_id || null) === (r.trajet_id || null) && (f.partenaire_id || null) === (r.partenaire_id || null);
  return meme ? f.valeurs : null;
};

// « Pas envoyé » : l'envoi noté par erreur s'efface, avec ce qui avait été figé (le numéro redevient libre).
export function detailsSansEnvoi(details, cible = "client") {
  const d = { ...(details || {}) };
  const envois = { ...(d.envois || {}) };
  delete envois[cible];
  if (Object.keys(envois).length) d.envois = envois;
  else delete d.envois;
  if (cible === "client") delete d.voucher_fige;
  return d;
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


// Type de transfert d'après le trajet de la base, sinon le groupe de la prestation et le libellé.
// Un trajet du catalogue se vend à la place (prix par adulte) : un minivan partagé, sauf si son mode dit « private », « privé » ou « charter »
// (INV-2026-047, 23.11.2026 : « Minivan + minivan » s'imprimait « Private minivan »). « Taxi » seul ne rend pas privé (« Minivan + pick-up
// taxi + longtail » se partage) : seulement « private taxi » ou « taxi privé » (relecture de la PR 337).
export function typeTransfert(prestation, reservation, trajet = null) {
  if (trajet && reservation && reservation.trajet_id) {
    const m = String(trajet.mode || "");
    if (/priv|charter/i.test(m)) return /\bpriv(?:ate|é|e)?\s+(?:taxi|car)\b|\b(?:taxi|voiture)\s+priv/i.test(m) ? "taxi" : "minivan";
    return "partage";
  }
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
// Une fiche partagée par une autre entreprise (ZTP sur un service de Secret) ne donne jamais le lieu : voir adresseEstHotel.
// L'hôtel imprimé dans les détails du client (« Hotel / Accommodation ») : celui saisi sur la réservation (`details.hotel`, même vide :
// effacé exprès), sinon celui de la fiche client si elle est de l'entreprise du service (une fiche ZTP partagée porte une adresse postale
// en Europe, adresseEstHotel). Jamais le lieu de pickup (INV-2026-035, 18.11.2026 : « Ayutthaya Train Station »
// s'imprimait comme hébergement). `chambre` : celle saisie, sinon celle de la fiche ou du pickup quand un hôtel s'imprime.
export function hebergementVoucher(client = {}, reservation = {}) {
  const dt = reservation.details || {};
  const fiche = hotelEtChambre(client, { entite_id: reservation.entite_id });
  const hotel = "hotel" in dt ? String(dt.hotel || "").trim() : fiche.hotel;
  const chambre = String(dt.chambre || "").trim() || (hotel ? hotelEtChambre(client, reservation).chambre : "");
  return { hotel, chambre };
}
export function hotelEtChambre(client = {}, reservation = {}) {
  const fiche = separerChambreLigne(adresseHotel(client, reservation.entite_id).split("\n")[0] || "");
  const lieu = separerChambreLigne(reservation.lieu_pickup || "");
  if (!lieu.hotel && !lieu.chambre) return fiche;
  // La chambre de la fiche client vaut pour un pickup à son hôtel (« Baiyok Hotel » et « Baiyok Hotel, Room 6 »), jamais pour un autre lieu.
  const meme = !!fiche.chambre && !!fiche.hotel && (sansAccentsMin(lieu.hotel).includes(sansAccentsMin(fiche.hotel)) || sansAccentsMin(fiche.hotel).includes(sansAccentsMin(lieu.hotel)));
  return { hotel: lieu.hotel, chambre: lieu.chambre || (meme ? fiche.chambre : "") };
}
// « Room 12 », « Ch. 5 », « Chambre A12 » en fin de ligne : le mot est entier et suivi d'un numéro (« Beach Resort » n'est pas une chambre).
export function separerChambreLigne(ligne) {
  const source = String(ligne || "");
  const m = source.match(/(?:^|[,\s])(?:room|chambre|ch\.?)\s*(?:no\.?\s*)?(\d+[A-Za-z]?|[A-Za-z]\d+)\s*$/i);
  return { hotel: m ? source.slice(0, m.index).replace(/[,\s]+$/, "").trim() : source.trim(), chambre: m ? m[1] : "" };
}

// Libellé d'une ligne de facture en mode excursions : prestation, participants et date (Jérémy, 18.11.2026).
// Les participants sont ceux du service, jamais la quantité facturée : « Full day tour - Tuk Tuk, 2 adults, 2 children, 22 November 2026 »
// pour un prix par groupe (quantité 1). Une ligne par personne d'un tarif du catalogue dit ce qu'elle facture : « 2 adults » (ligne adulte),
// « 2 children » (ligne enfant). Une location dit ses jours. Une ligne sans participants gardés (document d'avant) se lit comme avant.
export function descriptionService(ligne, langue = "en") {
  const en = langue === "en";
  const qte = ligne.qte !== null && ligne.qte !== undefined && ligne.qte !== "" ? Number(ligne.qte) : 0;
  const enfant = /enfant|child/i.test(ligne.intro || "");
  const compte = compteDe(ligne);
  const jours = compte === "jours" && qte ? `${qte} ${en ? (qte > 1 ? "days" : "day") : qte > 1 ? "jours" : "jour"}` : "";
  const participants = participantsLigne(ligne);
  const mot = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
  let pax = "";
  if (compte !== "jours") {
    if (participants && !enfant && (compte !== "personnes" || ligne.libre || qte === participants.adultes + participants.enfants)) pax = personnesTexte(participants, en ? "en" : "fr");
    else if (compte === "personnes" && qte) {
      if (enfant) pax = mot(qte, en ? "child" : "enfant", en ? "children" : "enfants");
      else if (participants) pax = mot(qte, en ? "adult" : "adulte", en ? "adults" : "adultes");
      // Ligne d'avant, sans participants gardés : le libellé d'avant (« 4 passengers »).
      else pax = mot(qte, en ? "passenger" : "personne", en ? "passengers" : "personnes");
    }
  }
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

// Le modèle du message client joint au voucher : le message « voucher » en anglais de l'entreprise (22.11.2026, modèles de Jérémy), sinon
// sa « confirmation » (ses messages, sinon son modèle par défaut). Chaîne vide quand il n'y en a pas : messageVoucher prend alors son texte
// de secours.
export function gabaritConfirmationVoucher(stockes, defauts) {
  for (const cle of ["voucher", "confirmation"]) {
    const choisi = gabaritsPropose(stockes, defauts, { pour: "client", langue: "en", cle }).choisi;
    if (choisi && choisi.corps) return choisi.corps;
  }
  return "";
}

// Lien WhatsApp : la conversation du numéro, ou le choix du contact quand on n'a pas de numéro. Un lien ne peut pas joindre d'image.
export function lienWhatsApp(telephone, message, options) {
  const numero = chiffres(telephone, options).replace("+", "");
  return `https://wa.me/${numero}?text=${encodeURIComponent(message)}`;
}

// ---- Variante ajoutée après coup à un service ------------------------------------------------------------------
// Un passager d'ATV (ou un enfant) ajouté à un dossier dont le service a déjà sa réservation : la nouvelle ligne rejoint cette réservation au lieu
// d'en créer une deuxième, avec un deuxième voucher (Jérémy, 19.11.2026). Seules les variantes (enfant, conducteur, passager, supplément) se
// rattachent : deux lignes identiques du même service restent deux réservations, comme avant.
// Renvoie [{ reservation, lignes_ids }] : la réservation existante et toutes ses lignes une fois la nouvelle ajoutée.
export function rattachementsDepuisDocument(doc, existantes = []) {
  const lignesDoc = (doc && doc.contenu && doc.contenu.lignes) || [];
  const idsDe = (r) => [r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean);
  const deja = new Set(existantes.flatMap(idsDe));
  const cle = (l) => `${l.trajet_id || ""}|${l.partenaire_id || ""}|${l.date_service || ""}|${sansAccentsMin(nomSansEnfant(l))}`;
  const parCle = new Map();
  for (const r of existantes) {
    if (r.statut === "annule") continue;
    const ids = new Set(idsDe(r));
    const siennes = lignesDoc.filter((l) => ids.has(l.id) && l.kind !== "texte" && l.kind !== "remise");
    const premiere = siennes.find((l) => !estLigneEnfant(l)) || siennes[0];
    // Les lignes de la réservation, sans doublon : `lignes_ids` compte déjà `ligne_id` quand il existe (lignesIdsAvec).
    const actuelles = r.details && r.details.lignes_ids && r.details.lignes_ids.length ? r.details.lignes_ids : [r.ligne_id].filter(Boolean);
    if (premiere && !parCle.has(cle(premiere))) parCle.set(cle(premiere), { reservation: r, lignes_ids: [...new Set(actuelles)] });
  }
  const touchees = new Map();
  // Une option ajoutée après coup (26.11.2026) rejoint la réservation qui porte la ligne de son service.
  const parReservation = new Map([...parCle.values()].map((x) => [x.reservation.id, x]));
  const parLigne = new Map();
  for (const r of existantes) {
    if (r.statut === "annule") continue;
    if (!parReservation.has(r.id)) parReservation.set(r.id, { reservation: r, lignes_ids: [...new Set(r.details && r.details.lignes_ids && r.details.lignes_ids.length ? r.details.lignes_ids : [r.ligne_id].filter(Boolean))] });
    for (const id of idsDe(r)) parLigne.set(id, parReservation.get(r.id));
  }
  for (const l of lignesDoc) {
    if (l.kind === "texte" || l.kind === "remise" || !(l.prestation_id || l.trajet_id || l.libre) || deja.has(l.id)) continue;
    if (estLigneOption(l)) {
      const cibleOption = parLigne.get(l.option_de);
      if (!cibleOption) continue;
      cibleOption.lignes_ids = [...new Set([cibleOption.reservation.ligne_id, ...cibleOption.lignes_ids, l.id].filter(Boolean))];
      touchees.set(cibleOption.reservation.id, cibleOption);
      continue;
    }
    const variante = nomSansEnfant(l) !== String(l.titre || l.libelle || "").trim();
    const cible = variante && parCle.get(cle(l));
    if (!cible) continue;
    cible.lignes_ids = [...cible.lignes_ids, l.id];
    touchees.set(cible.reservation.id, cible);
  }
  return [...touchees.values()];
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
  const toutes = lignes.filter((l) => l.kind !== "texte" && l.kind !== "remise");
  // Les options (26.11.2026) comptent dans le montant vendu, jamais dans les personnes, les jours ni le nom du service.
  const utiles = toutes.filter((l) => !estLigneOption(l));
  if (!utiles.length) return { retiree: true };
  const premiere = utiles.find((l) => !estLigneEnfant(l)) || utiles[0];
  const qte = (l) => (l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.qte) : 1);
  // Mêmes participants qu'à la création (participantsDuService) : un tuk-tuk par groupe pour 2 adultes et 2 enfants n'est pas un écart.
  const participants = participantsDuService(utiles);
  return {
    date_service: premiere.date_service || null,
    // Une location « par jour » : la quantité est un nombre de jours, la facture ne dit rien des personnes.
    sansPersonnes: !utiles.some((l) => compteDe(l) === "personnes") && !utiles.some(estLigneSupplement),
    jours: utiles.filter(estLigneJours).reduce((s, l) => s + qte(l), 0) || null,
    // Base pour 1 ou 2 personnes + suppléments : la base compte pour deux personnes, comme à la création de la réservation.
    personnes: { adultes: utiles.filter((l) => !estLigneEnfant(l) && (compteDe(l) === "personnes" || (compteDe(l) === "aucun" && utiles.some(estLigneSupplement)))).reduce((s, l) => s + qte(l), 0) + (utiles.some(estLigneSupplement) ? 1 : 0), enfants: utiles.filter((l) => compteDe(l) === "personnes" && estLigneEnfant(l)).reduce((s, l) => s + qte(l), 0) },
    montant_vente: toutes.some((l) => brut(l) !== null) ? arr(toutes.reduce((s, l) => s + (brut(l) || 0), 0)) : null,
    paye_sur_place: utiles.some((l) => !!l.paye_sur_place),
    // Le nom du service et son partenaire, tels que la réservation les a pris à sa création (16.11.2026).
    libelle: nomSansEnfant(premiere),
    // Une ligne ancienne, saisie dans l'éditeur, ne porte pas de partenaire (clé absente) : rien à comparer.
    partenaire_id: premiere.partenaire_id === undefined ? undefined : premiere.partenaire_id || null,
    // Le tarif du catalogue de la ligne (non comparé : il ne s'affiche pas, mais l'alignement en a besoin).
    prestation_id: premiere.prestation_id || null,
    trajet_id: premiere.trajet_id || null,
    ...(participants ? { sansPersonnes: false, personnes: participants } : {}),
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
  const quantiteFacturee = (doc && doc.contenu ? doc.contenu.lignes : []).filter((l) => (new Set([r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean))).has(l.id) && l.kind !== "texte" && l.kind !== "remise" && !estLigneOption(l) && compteDe(l) !== "personnes").reduce((s, l) => s + (l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.qte) : 1), 0);
  // Des personnes reprises du dossier sur un service par véhicule (lot C2, 17.11.2026) ne sont pas cette erreur.
  const fausse = a.sansPersonnes && !(r.details && r.details.personnes_du_dossier) && (Number(pr.adultes) || 0) > 0 && (Number(pr.adultes) || 0) === quantiteFacturee && !(Number(pr.enfants) || 0);
  // Enfants repris du dossier sur un service sans ligne enfant (contrôle du 17.11.2026, D8) : un tarif par personne compte tout le monde au prix
  // adulte (2 adultes + 1 enfant = 3 personnes facturées), un tarif par adulte ne facture pas l'enfant. Ce n'est pas un écart.
  const enfantsDuDossier = !!(r.details && r.details.personnes_du_dossier) && !a.personnes.enfants && (Number(pr.enfants) || 0) > 0 && ((Number(pr.adultes) || 0) + (Number(pr.enfants) || 0) === a.personnes.adultes || (Number(pr.adultes) || 0) === a.personnes.adultes);
  if (fausse || (!a.sansPersonnes && !enfantsDuDossier && ((Number(pr.adultes) || 0) !== a.personnes.adultes || (Number(pr.enfants) || 0) !== a.personnes.enfants))) champs.push({ cle: "personnes", reservation: { adultes: Number(pr.adultes) || 0, enfants: Number(pr.enfants) || 0 }, document: { adultes: a.personnes.adultes, enfants: a.personnes.enfants } });
  if (arr(Number(r.montant_vente) || 0) !== arr(Number(a.montant_vente) || 0)) champs.push({ cle: "montant_vente", reservation: Number(r.montant_vente) || 0, document: Number(a.montant_vente) || 0 });
  if (!!r.paye_sur_place !== a.paye_sur_place) champs.push({ cle: "paye_sur_place", reservation: !!r.paye_sur_place, document: a.paye_sur_place });
  // Libellé et partenaire changés dans la réservation sans que la facture suive (16.11.2026 : la facture gardait le service et le partenaire d'avant).
  // Comparés seulement quand la réservation les porte (toute réservation enregistrée a ces deux champs).
  // Une réservation créée avant le 19.11.2026 garde sa variante dans son nom (« P2: ATV 1 hour, driver ») : ce n'est pas un écart.
  if (typeof r.libelle === "string" && r.libelle.trim() && r.libelle.trim() !== a.libelle && nomSansEnfant({ libelle: r.libelle }) !== a.libelle) champs.push({ cle: "libelle", reservation: r.libelle.trim(), document: a.libelle });
  if (r.partenaire_id !== undefined && a.partenaire_id !== undefined && (r.partenaire_id || null) !== a.partenaire_id) champs.push({ cle: "partenaire_id", reservation: r.partenaire_id || null, document: a.partenaire_id });
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
// `tarifEnfant(ligne)` : le tarif enfant du catalogue de la ligne ({ unite, net }) ou null. Il dit si des enfants comptés au prix adulte le sont faute
// de prix enfant ; sans lui, seule une réservation aux personnes reprises du dossier prend ce chemin.
export function contenuAvecReservation(contenu, r, avant, apres, { tarifEnfant = null } = {}) {
  const ids = new Set([r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean));
  const lignes = (contenu && contenu.lignes) || [];
  const toutes = lignes.filter((l) => ids.has(l.id) && l.kind !== "texte" && l.kind !== "remise");
  // Les options (26.11.2026) suivent la date ; une option par personne suit le nombre de personnes. Elles restent hors des règles des personnes.
  const options = toutes.filter(estLigneOption);
  const cibles = toutes.filter((l) => !estLigneOption(l));
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
    for (const l of toutes) if ((l.date_service || null) !== dateApres) modif(l, { date_service: dateApres });
    for (const l of lignes) {
      if (l.kind === "texte" && l.sur_place && (l.date_service || null) === dateAvant && cibles.some((x) => (x.prestation_id || null) === (l.prestation_id || null) && (x.trajet_id || null) === (l.trajet_id || null))) modif(l, { date_service: dateApres });
    }
  }
  // Participants gardés sur les lignes (18.11.2026) : ils suivent la réservation, et le libellé avec eux.
  const pApres = { adultes: nb(apres.personnes && apres.personnes.adultes), enfants: nb(apres.personnes && apres.personnes.enfants) };
  const totalPers = (p) => nb(p && p.adultes) + nb(p && p.enfants);
  for (const o of options) {
    if (compteDe(o) === "personnes" && totalPers(apres.personnes) > 0 && totalPers(avant.personnes) !== totalPers(apres.personnes) && qte(o) === totalPers(avant.personnes)) modif(o, { qte: totalPers(apres.personnes) });
    if (participantsLigne(o) && totalPers(apres.personnes) > 0) modif(o, { personnes: pApres });
  }
  const participantsChanges = (l) => { const p = participantsLigne(l); return !!p && pApres.adultes + pApres.enfants > 0 && (p.adultes !== pApres.adultes || p.enfants !== pApres.enfants); };
  for (const l of cibles) if (participantsChanges(l)) modif(l, { personnes: pApres });
  // Une ligne seule hors catalogue ou à prix de groupe : la facture ne compte pas les personnes, seul le libellé change. Un prix par personne hors
  // catalogue suit le nombre de participants tant que la quantité était ce nombre.
  const seule = participantsDuService(cibles) && (cibles[0].libre || compteDe(cibles[0]) !== "personnes") ? cibles[0] : null;
  // Ligne hors catalogue d'avant ce choix (sans `par` ni participants, INV-2026-035) : lue comme un prix de groupe, le choix sûr. Les
  // personnes changées entrent comme participants, la quantité et le total ne bougent pas (1 200 ne devient pas 2 400 avec un adulte de plus).
  const ancienneLibre = cibles.length === 1 && cibles[0].libre && !cibles[0].par && !participantsLigne(cibles[0]) && !estLigneSupplement(cibles[0]) ? cibles[0] : null;
  if (ancienneLibre) {
    const pAvant = { adultes: nb(avant.personnes && avant.personnes.adultes), enfants: nb(avant.personnes && avant.personnes.enfants) };
    if (pApres.adultes + pApres.enfants > 0 && (pAvant.adultes !== pApres.adultes || pAvant.enfants !== pApres.enfants)) modif(ancienneLibre, { personnes: pApres });
    if (!miseAJour.size) return { contenu: null, reste };
    return { contenu: { ...contenu, lignes: lignes.map((l) => (miseAJour.has(l) ? avecDescription(l, { ...l, ...miseAJour.get(l) }, contenu.langue) : l)) }, reste };
  }
  if (seule) {
    const p = participantsLigne(seule);
    if (participantsChanges(seule) && compteDe(seule) === "personnes" && qte(seule) === p.adultes + p.enfants) modif(seule, { qte: pApres.adultes + pApres.enfants });
    if (!miseAJour.size) return { contenu: null, reste };
    return { contenu: { ...contenu, lignes: lignes.map((l) => (miseAJour.has(l) ? avecDescription(l, { ...l, ...miseAJour.get(l) }, contenu.langue) : l)) }, reste };
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
    return miseAJour.size ? { contenu: { ...contenu, lignes: lignes.map((l) => (miseAJour.has(l) ? avecDescription(l, { ...l, ...miseAJour.get(l) }, contenu.langue) : l)) }, reste } : { contenu: null, reste };
  }
  // Enfants comptés au prix adulte (pas de ligne enfant, la quantité est adultes + enfants : tarif sans prix enfant, personnes reprises du dossier,
  // contrôle du 17.11.2026, D8 et D9) : la ligne suit le nombre total de personnes.
  const total = (p) => nb(p && p.adultes) + nb(p && p.enfants);
  const seuleAdulte = cibles.length === 1 && !estLigneEnfant(cibles[0]) ? cibles[0] : null;
  // Seulement quand le tarif n'a pas de prix enfant, ou que les enfants viennent du dossier (revue de la PR 217) : sinon l'enfant ajouté reçoit
  // sa ligne enfant (contenuAvecEnfants), au lieu d'un adulte de plus.
  const sansPrixEnfant = (l) => { const t = tarifEnfant ? tarifEnfant(l) : undefined; return t === null || (!!t && (t.unite === null || t.unite === undefined || t.unite === "")); };
  // Une ligne au prix total (estPrixTotal) suit aussi les personnes : sa quantité et son libellé changent, son montant non.
  const compteLesPersonnes = (l) => (l.unite !== null && l.unite !== undefined && l.unite !== "") || estPrixTotal(l);
  const enfantsAuPrixAdulte = !!seuleAdulte && nb(avant.personnes && avant.personnes.enfants) > 0 && parPersonne(seuleAdulte) && compteLesPersonnes(seuleAdulte) && qte(seuleAdulte) === total(avant.personnes) && (!!(r.details && r.details.personnes_du_dossier) || sansPrixEnfant(seuleAdulte));
  if (enfantsAuPrixAdulte) {
    if (total(apres.personnes) !== total(avant.personnes) && total(apres.personnes) > 0) modif(seuleAdulte, { qte: total(apres.personnes) });
    if (!miseAJour.size) return { contenu: null, reste };
    return { contenu: { ...contenu, lignes: lignes.map((l) => (miseAJour.has(l) ? avecDescription(l, { ...l, ...miseAJour.get(l) }, contenu.langue) : l)) }, reste };
  }
  // Personnes : une ligne adulte et une ligne enfant au plus.
  const parGroupe = [["adultes", cibles.filter((l) => !estLigneEnfant(l))], ["enfants", cibles.filter(estLigneEnfant)]];
  for (const [cle, groupe] of parGroupe) {
    const anciens = nb(avant.personnes && avant.personnes[cle]);
    const nouveaux = nb(apres.personnes && apres.personnes[cle]);
    if (anciens === nouveaux) continue;
    const proportionnelles = groupe.filter((l) => compteLesPersonnes(l) && parPersonne(l) && qte(l) === anciens);
    if (groupe.length === 1 && proportionnelles.length === 1 && nouveaux > 0) modif(proportionnelles[0], { qte: nouveaux });
    else reste.push({ cle, reservation: nouveaux, facture: groupe.reduce((somme, l) => somme + (qte(l) || 0), 0) });
  }
  if (!miseAJour.size) return { contenu: null, reste };
  return { contenu: { ...contenu, lignes: lignes.map((l) => (miseAJour.has(l) ? avecDescription(l, { ...l, ...miseAJour.get(l) }, contenu.langue) : l)) }, reste };
}

// ---- Description d'une ligne de service ---------------------------------------------------------------------------
// En excursions, la ligne porte le nom court (`titre`) et une description générée : « Nom, 2 passengers, 20 November 2026 ». Quand la date, la quantité
// ou le nom changent, la description générée suit ; une description réécrite à la main reste telle quelle.
const descriptionGeneree = (l, langue) => {
  if (!l.titre) return null;
  const en = langue === "en";
  return descriptionService({ ...l, libelle: l.titre, intro: estLigneEnfant(l) ? (en ? "(per child)" : "(par enfant)") : l.intro }, en ? "en" : "fr");
};
export function avecDescription(avant, apres, langue = "") {
  const ancienne = descriptionGeneree(avant, langue);
  if (ancienne === null || avant.libelle !== ancienne) return apres;
  return { ...apres, libelle: descriptionGeneree(apres, langue) };
}

// ---- Ligne au prix total (23.11.2026) -----------------------------------------------------------------------------
// Une ligne au prix total : une quantité (les personnes), pas de prix unitaire, un montant. Elle s'imprime sans « 3 × … ».
const vide = (v) => v === null || v === undefined || v === "";
export const estPrixTotal = (l) => !!l && vide(l.unite) && !vide(l.montant) && !vide(l.qte);
// La mention d'un prix par personne (catalogue « (par personne) », « (par adulte) », « (par enfant) », trajet « (per adult) », en français comme en
// anglais) ne va pas sur un prix total. Celle d'un enfant devient « (enfant) » : la ligne reste une ligne enfant (estLigneEnfant lit l'intro).
const MENTIONS_PAR_PERSONNE = /^\((?:par|per) (?:personne|person|adulte|adult|enfant|child)\)$/i;
export function sansMentionParPersonne(intro, en) {
  const t = String(intro || "").trim();
  if (!MENTIONS_PAR_PERSONNE.test(t)) return intro;
  return /enfant|child/i.test(t) ? (en ? "(child)" : "(enfant)") : "";
}
// La mention retirée est gardée sur la ligne (`mention_retiree`, jamais imprimée ni comparée) et revient seule quand la ligne repasse au prix
// unitaire : une intro vide au départ (facture Secret, ligne libre) reste vide, rien n'est déduit du catalogue (relecture de la PR 336).

// ---- Libellé, partenaire, tarif ou prix changés depuis la réservation ----------------------------------------------
// Les lignes du document qui correspondent à la réservation suivent ce qui a changé (16.11.2026 : Anaïs avait pris le tarif d'un autre partenaire,
// puis changé libellé, partenaire et prix dans la réservation ; la facture gardait l'ancien service, l'ancien partenaire et 2 500 au lieu de 2 000).
//   `cible` : { libelle, partenaire_id, prestation_id, trajet_id, montant_vente }, seulement les clés à suivre (undefined : on n'y touche pas).
//   `prestationDe(id)` : la prestation du catalogue ; `netDe(prestation)` : son net (undefined quand on ne le voit pas) ; `personnes` : celles de la réservation ;
//   `nomPartenaire(id)` : pour garder à jour la mention du prestataire quand elle n'a pas été réécrite.
// Le nom suit sur toutes les lignes (adulte, enfant, supplément), comme le partenaire. Le tarif et le prix ne se reportent que sur un service d'une
// seule ligne : réparti sur plusieurs lignes, le report serait deviné, il est laissé et signalé dans `reste`.
// Renvoie { contenu, reste } : `contenu` vaut null quand rien ne change. Rien n'est modifié sur place.
// `tarifEnfantDe(pid)` : le tarif enfant d'une prestation ({ net, prestation_id }) pour les lignes enfant d'un service adulte + enfant
// (contrôle du 17.11.2026, D4 : un service changé de partenaire ne garde pas le net de l'ancien sur sa ligne enfant).
export function contenuAvecService(contenu, r, cible = {}, { prestationDe = () => null, netDe = () => undefined, tarifEnfantDe = () => null, personnes = null, nomPartenaire = null, langueDoc = null } = {}) {
  const ids = new Set([r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean));
  const lignes = (contenu && contenu.lignes) || [];
  const toutes = lignes.filter((l) => ids.has(l.id) && l.kind !== "texte" && l.kind !== "remise");
  // Les options (26.11.2026) gardent leur nom, leur tarif et leur prix : le nom, le tarif et le prix demandés sont ceux du service. Le
  // montant vendu de la réservation compte les options : le prix du service est ce montant moins les options. Le partenaire suit partout.
  const options = toutes.filter(estLigneOption);
  const cibles = toutes.filter((l) => !estLigneOption(l));
  const reste = [];
  if (!cibles.length) return { contenu: null, reste };
  const langue = contenu.langue || "";
  const en = langue === "en";
  const premiere = cibles.find((l) => !estLigneEnfant(l)) || cibles[0];
  const nouvelles = new Map(toutes.map((l) => [l, { ...l }]));
  const seule = cibles.length === 1 ? cibles[0] : null;

  if (cible.libelle !== undefined) {
    const ancien = nomSansEnfant(premiere);
    const nouveau = String(cible.libelle || "").trim();
    // Une ligne sans nom (ancienne) : le nouveau nom va sur la ligne principale, sans rien coller devant un autre texte.
    if (nouveau && !ancien) nouvelles.get(premiere)[premiere.titre !== undefined ? "titre" : "libelle"] = nouveau;
    else if (nouveau && nouveau !== ancien) {
      for (const l of cibles) {
        const n = nouvelles.get(l);
        let fait = false;
        for (const k of ["titre", "libelle"]) if (typeof l[k] === "string" && l[k].startsWith(ancien)) (n[k] = nouveau + l[k].slice(ancien.length)), (fait = true);
        if (!fait) reste.push({ cle: "libelle", reservation: nouveau, facture: l.titre || l.libelle });
      }
    }
  }

  if (cible.partenaire_id !== undefined) for (const l of toutes) if ((l.partenaire_id || null) !== (cible.partenaire_id || null)) nouvelles.get(l).partenaire_id = cible.partenaire_id || null;

  // Tarif : la prestation (ou le trajet) du catalogue. Sans l'un ni l'autre, le service devient « hors catalogue » (`libre`), sur toutes ses lignes.
  const prestationDemandee = cible.prestation_id !== undefined ? cible.prestation_id || null : undefined;
  const trajetDemande = cible.trajet_id !== undefined ? cible.trajet_id || null : undefined;
  const tarifChange = (prestationDemandee !== undefined && prestationDemandee !== (premiere.prestation_id || null)) || (trajetDemande !== undefined && trajetDemande !== (premiere.trajet_id || null));
  if (tarifChange) {
    const pid = prestationDemandee !== undefined ? prestationDemandee : premiere.prestation_id || null;
    const tid = trajetDemande !== undefined ? trajetDemande : premiere.trajet_id || null;
    if (!pid && !tid) {
      for (const l of cibles) Object.assign(nouvelles.get(l), { prestation_id: null, trajet_id: null, libre: true, net: null });
    } else if (seule || cibles.filter((l) => !estLigneEnfant(l)).length === 1) {
      // Une ligne adulte et ses lignes enfant : l'adulte prend le tarif et son net, chaque ligne enfant le tarif enfant et son net (ou aucun net).
      const adulte = seule || cibles.find((l) => !estLigneEnfant(l));
      for (const l of cibles.filter((x) => x !== adulte)) {
        const t = pid ? tarifEnfantDe(pid) : null;
        Object.assign(nouvelles.get(l), { prestation_id: (t && t.prestation_id) || pid, trajet_id: tid, net: t && t.net !== null && t.net !== undefined ? Number(t.net) : null });
        delete nouvelles.get(l).libre;
      }
      const n = nouvelles.get(adulte);
      const p = pid ? prestationDe(pid) : null;
      Object.assign(n, { prestation_id: pid, trajet_id: tid });
      delete n.libre;
      // Un autre tarif : la mention gardée d'un prix total (`mention_retiree`) était celle de l'ancien.
      delete n.mention_retiree;
      const net = p ? netDe(p) : undefined;
      n.net = net === undefined || net === null ? null : Number(net);
      if (p) {
        const avantCompte = compteDe(adulte);
        if (["boat", "veh", "day", "ses", "grp"].includes(p.unite)) n.par = p.unite;
        else delete n.par;
        if (p.unite === "sup") n.supplement = true;
        else delete n.supplement;
        if (adulte.intro) n.intro = p.unite ? `(${libelleUnite(p.unite, en)})` : "";
        // Une unité qui ne compte plus la même chose (personnes, véhicule, jours) : la quantité repart de la réservation.
        if (compteDe(n) !== avantCompte) n.qte = p.unite === "day" ? Math.max(1, Number(r.details && r.details.jours) || 1) : quantiteParDefaut(p.unite, personnes || r.personnes || {});
      }
    } else reste.push({ cle: "prestation_id", reservation: pid, facture: premiere.prestation_id || null });
  }

  // Options demandées depuis la réservation (26.11.2026) : `cible.options` = [{ ligne_id, prestation_id, prix, qte, nouvelle }], la liste voulue
  // (`prix` : le total de l'option ; `qte` : sa quantité, quand elle est donnée).
  // Une option absente de la liste quitte la facture ; le prix d'une option gardée devient son total (prix unitaire s'il tombe juste) ; une
  // option nouvelle prend la ligne `ligne_id` donnée (le même identifiant sur la facture et le devis), sous les lignes du service.
  const retirees = new Set();
  const ajouts = [];
  // Un autre partenaire sans liste d'options donnée (alignement, carte) : les options d'un autre partenaire quittent le service, et c'est dit.
  if (cible.partenaire_id !== undefined && !Array.isArray(cible.options)) {
    for (const o of options) {
      if ((o.partenaire_id || null) === (cible.partenaire_id || null)) continue;
      retirees.add(o.id);
      reste.push({ cle: "options", reservation: null, facture: o.titre || o.libelle });
    }
  }
  if (Array.isArray(cible.options)) {
    const voulues = new Map(cible.options.filter((o) => o && o.ligne_id).map((o) => [o.ligne_id, o]));
    for (const o of options) {
      const v = voulues.get(o.id);
      if (!v) {
        retirees.add(o.id);
        continue;
      }
      // La quantité voulue (un seul plongeur sur deux, relecture de la PR 359) : posée avant le prix, qui se répartit sur elle.
      const qv = Number(v.qte);
      if (Number.isFinite(qv) && qv > 0) nouvelles.get(o).qte = Math.round(qv);
      if (v.prix !== null && v.prix !== undefined && v.prix !== "" && Number.isFinite(Number(v.prix))) prixLigne(nouvelles.get(o), arr(Number(v.prix)));
    }
    const parent = nouvelles.get(premiere);
    for (const v of cible.options.filter((o) => o && o.nouvelle && o.ligne_id && !lignes.some((l) => l.id === o.ligne_id))) {
      const p = v.prestation_id ? prestationDe(v.prestation_id) : null;
      if (!p) {
        reste.push({ cle: "options", reservation: v.prestation_id || null, facture: null });
        continue;
      }
      const net = netDe(p);
      // La langue des documents de l'entreprise quand le document ne la porte pas (anciens documents de Secret, sans `langue`).
      const langueOption = langue || langueDoc || "";
      const l = ligneOption(p, parent, net === undefined || net === null ? null : { net }, { langue: langueOption, personnes: personnes || r.personnes || null, prix: v.prix, qte: v.qte, uid: () => v.ligne_id });
      // Comme les autres lignes du dossier : le nom court (`titre`) et la description générée.
      const titre = l.libelle;
      ajouts.push(descriptionGeneree({ ...l, titre }, langueOption) !== null ? { ...l, titre, libelle: descriptionGeneree({ ...l, titre }, langueOption) } : l);
    }
  }
  const optionsApres = options.filter((o) => !retirees.has(o.id)).map((o) => nouvelles.get(o));

  // Prix : le montant vendu de la réservation devient celui de la ligne. Prix unitaire = montant / quantité quand il tombe juste ; sinon la ligne
  // devient un prix total (23.11.2026 : 2 900 pour 3 passagers à 950 ne donne pas un prix unitaire juste, la facture gardait 2 850 sans rien dire).
  // Prix total : la quantité reste (elle compte les personnes, « 3 passengers » reste dans le libellé), le prix unitaire et la mention « (par personne) »
  // s'effacent, le montant porte le total. Jamais de prix unitaire arrondi : 3 × 966,67 ferait 2 900,01. Un prix total qui redevient divisible
  // (4 personnes, 3 800) repasse au prix unitaire, avec la mention qu'il avait (`mention_retiree`), et seulement celle-là. Plusieurs lignes (adulte, enfant) : la répartition serait devinée, le prix
  // reste dans `reste`.
  if (cible.montant_vente !== undefined && cible.montant_vente !== null && cible.montant_vente !== "" && Number.isFinite(Number(cible.montant_vente))) {
    const montant = arr(Number(cible.montant_vente) - [...optionsApres, ...ajouts].reduce((s, o) => s + (brut(o) || 0), 0));
    const total = arr(cibles.reduce((s, l) => s + (brut(nouvelles.get(l)) || 0), 0));
    if (total !== montant || cibles.every((l) => brut(nouvelles.get(l)) === null)) {
      const n = seule ? nouvelles.get(seule) : null;
      const q = n && n.qte !== null && n.qte !== undefined && n.qte !== "" ? Number(n.qte) : null;
      if (n && q !== null && q > 0 && arr(arr(montant / q) * q) === montant) {
        n.unite = arr(montant / q);
        if (n.montant !== null && n.montant !== undefined && n.montant !== "") n.montant = null;
        if (n.mention_retiree !== undefined) {
          n.intro = n.mention_retiree;
          delete n.mention_retiree;
        }
      } else if (n) {
        n.montant = montant;
        if (q !== null) {
          n.unite = null;
          const intro = sansMentionParPersonne(n.intro, en);
          if (intro !== n.intro && n.mention_retiree === undefined) n.mention_retiree = n.intro;
          n.intro = intro;
        }
      } else reste.push({ cle: "montant_vente", reservation: montant, facture: total });
    }
  }

  const changees = toutes.filter((l) => !retirees.has(l.id) && (Object.keys(nouvelles.get(l)).some((k) => nouvelles.get(l)[k] !== l[k]) || Object.keys(l).some((k) => !(k in nouvelles.get(l)))));
  if (!changees.length && !retirees.size && !ajouts.length) return { contenu: null, reste, ajoutees: [], retirees: [] };
  // Les options ajoutées se placent après la dernière ligne du service.
  const derniere = Math.max(...toutes.map((l) => lignes.indexOf(l)));
  const suiteLignes = [];
  lignes.forEach((l, i) => {
    if (!retirees.has(l.id)) suiteLignes.push(changees.includes(l) ? avecDescription(l, nouvelles.get(l), langue) : l);
    if (i === derniere) suiteLignes.push(...ajouts);
  });
  const suite = { ...contenu, lignes: suiteLignes };
  // Le prestataire affiché est posé à l'ajout des services : il suit seulement s'il n'a pas été réécrit à la main.
  if (nomPartenaire && contenu.prestataire) {
    const liste = (ls) => [...new Set(ls.map((l) => nomPartenaire(l.partenaire_id)).filter(Boolean))].join(", ");
    if (contenu.prestataire === liste(lignes)) suite.prestataire = liste(suite.lignes);
  }
  return { contenu: suite, reste, ajoutees: ajouts.map((l) => l.id), retirees: [...retirees] };
}

// Le prix total d'une ligne : prix unitaire quand il tombe juste pour sa quantité, sinon un montant (comme le prix d'un service).
function prixLigne(n, total) {
  const q = n.qte !== null && n.qte !== undefined && n.qte !== "" ? Number(n.qte) : null;
  if (q !== null && q > 0 && arr(arr(total / q) * q) === total) Object.assign(n, { unite: arr(total / q), montant: null });
  else Object.assign(n, { montant: total, unite: q !== null ? null : n.unite });
  if (total === 0) n.offert = true;
  else delete n.offert;
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
  const nouveaux = new Map(sources.map((l) => [l.id, uid()]));
  // Une option du double se rattache au double de son service (26.11.2026).
  const doubles = sources.map((l) => ({ ...structuredClone(l), id: nouveaux.get(l.id), ...(estLigneOption(l) && nouveaux.has(l.option_de) ? { option_de: nouveaux.get(l.option_de) } : {}) }));
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
    // L'adresse d'une fiche partagée par une autre entreprise (ZTP) n'est pas un hôtel : le voucher n'a alors pas de lieu.
    if (!String(r.lieu_pickup || "").trim()) codes.push(adresseHotel(client, r.entite_id).trim() ? "lieu_adresse_client" : "sans_lieu");
  }
  // Retour au point de départ sans programme : le chauffeur ne saurait pas ce qui est prévu.
  if (estRetourDepart(r) && !String((r.details || {}).programme_trajet || "").trim()) codes.push("sans_programme");
  return codes;
}

// ---- Feuille du jour ---------------------------------------------------------------------------------------------
// Les réservations d'une date, par partenaire, pour le chauffeur ou le capitaine : heure, client, téléphone, hôtel, personnes, prestation.
// `contexte.client(r)` renvoie le client d'une réservation, `contexte.partenaire(id)` son nom, `contexte.prestation(id)` (facultatif) sa prestation.
export function feuilleDuJour(reservations, date, contexte, ecartees = new Set()) {
  const groupes = new Map();
  const estFrais = fraisAvec(contexte.prestation || null);
  for (const r of reservations) {
    if (r.date_service !== date || r.statut === "annule" || ecartees.has(r.dossier_id) || estFrais(r)) continue;
    const cle = r.partenaire_id || "";
    const g = groupes.get(cle) || { partenaire_id: r.partenaire_id || null, nom: (r.partenaire_id && contexte.partenaire(r.partenaire_id)) || "", lignes: [], adultes: 0, enfants: 0 };
    const c = contexte.client(r) || {};
    const lieu = hotelEtChambre(c, r);
    g.lignes.push({ id: r.id, heure: r.heure_pickup || "", client: [c.prenom, c.nom].filter(Boolean).join(" "), telephone: c.telephone || "", hotel: lieu.hotel, chambre: lieu.chambre, personnes: r.personnes || {}, libelle: r.libelle, reference: r.reference_partenaire || "", statut: r.statut, trajet: trajetPourChauffeur(r) });
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
  const passagers = personnesTexte({ adultes: groupe.adultes, enfants: groupe.enfants }, "en");
  const tete = `${groupe.nom ? `${groupe.nom}: ` : ""}${dateTexte(date, "en")}${passagers ? `, ${passagers}` : ""}`;
  const lignes = groupe.lignes.map((l) => [l.heure, libelleClient(l.libelle), l.client, l.telephone, [l.hotel, l.chambre ? `room ${l.chambre}` : ""].filter(Boolean).join(", "), l.trajet, personnesTexte(l.personnes, "en")].filter(Boolean).join(" · "));
  return [tete, ...lignes].join("\n");
}
