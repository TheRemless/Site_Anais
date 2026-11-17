// Gestes du dossier et de la fiche client qui se vérifient sans écran (testés avec node --test) :
// paiements (type, doublon, écart à solder), réactivation d'un dossier annulé, hôtel changé sur la fiche client,
// personnes d'un service ajouté, fusion de deux clients, ligne enfant ajoutée à la facture.
import { separerChambreLigne } from "./operations-calc.mjs";
import { estLigneSupplement } from "./partenaires-calc.mjs";

const arr = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sansAccentsMin = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// ---- Paiements ----------------------------------------------------------------------------------------------------
// Types d'un paiement, dans l'ordre du sélecteur de « Corriger ». « ecart » : petit reste soldé sans encaissement (frais Wise, change).
export const TYPES_PAIEMENT = ["acompte", "solde", "ecart", "autre"];

// Type d'un nouveau paiement : « solde » seulement quand il complète le total. Avant, en Secret (aucun acompte prévu), un premier versement
// partiel s'affichait « Solde » ; c'est désormais un acompte, comme un versement partiel en voyages sur mesure.
export function typePaiement({ montant, recu = 0, total = 0, rembourse = false }) {
  if (rembourse) return "remboursement";
  if (Number(total) > 0 && arr(Number(recu) + Number(montant)) >= arr(total)) return "solde";
  return "acompte";
}

// Un paiement du même montant, dans le même sens, à trois jours près : probablement le même saisi deux fois (relevé Wise relu, double clic).
// Renvoie le paiement déjà enregistré qui lui ressemble, ou null.
export function paiementEnDouble(paiements, { date, montant }, { jours = 3, sauf = null } = {}) {
  const ms = (iso) => Date.UTC(+String(iso).slice(0, 4), +String(iso).slice(5, 7) - 1, +String(iso).slice(8, 10));
  if (!date || !Number(montant)) return null;
  return (paiements || []).find((p) => p.id !== sauf && arr(p.montant) === arr(montant) && p.date && Math.abs(ms(p.date) - ms(date)) <= jours * 86400000) || null;
}

// Reste qu'« Solder l'écart » peut fermer : seulement quand quelque chose a déjà été reçu et qu'il reste un montant positif.
// `petit` : vrai quand ce reste ne dépasse pas 5 % du total (frais Wise, change) ; seul un petit reste propose « Solder l'écart ».
export function ecartASolder({ total = 0, recu = 0 }) {
  const reste = arr(Number(total) - Number(recu));
  if (!(Number(recu) > 0) || !(reste > 0)) return null;
  return { montant: reste, petit: reste <= arr(Number(total) * 0.05) };
}

// ---- Dossier annulé puis réactivé -----------------------------------------------------------------------------------
// À l'annulation d'un dossier, ses réservations annulées avec lui portent `details.annule_avec_dossier`. À la réactivation, celles-là sont
// proposées cochées ; les autres réservations annulées (annulées une à une avant, ou annulées avant ce marquage) sont listées sans être cochées.
export function reservationsAReactiver(reservations, dossierId) {
  const annulees = (reservations || []).filter((r) => r.dossier_id === dossierId && r.statut === "annule");
  const avec = annulees.filter((r) => r.details && r.details.annule_avec_dossier);
  return { cochees: avec, autres: annulees.filter((r) => !avec.includes(r)) };
}
// Champs d'une réservation qu'on réactive : confirmée (statut d'une réservation saisie), sans la marque de l'annulation groupée.
export function reactivation(r) {
  const { annule_avec_dossier, ...details } = r.details || {};
  return { statut: "confirme", details };
}

// ---- Hôtel ou chambre changés sur la fiche client ------------------------------------------------------------------
// Le lieu de pickup est copié de l'adresse du client à la création du service. Quand l'hôtel (ou la chambre) change sur la fiche, les services
// à venir qui partent encore de l'ancien hôtel sont proposés à la mise à jour : lieu de pickup et chambre du voucher.
//   `avant`, `apres` : l'adresse du client avant et après (« Baiyok Hotel, Room 6\n… ») ; `reservations` : celles des dossiers du client.
// Renvoie [{ reservation, champs }] ; vide quand rien ne part de l'ancien hôtel ou que l'hôtel et la chambre n'ont pas changé.
export function servicesSuivantAdresse({ avant = "", apres = "", reservations = [], aujourdhui = "" }) {
  const ligneAvant = String(avant || "").split("\n")[0].trim();
  const ligneApres = String(apres || "").split("\n")[0].trim();
  if (!ligneAvant || !ligneApres || ligneAvant === ligneApres) return [];
  const a = separerChambreLigne(ligneAvant);
  const b = separerChambreLigne(ligneApres);
  if (!a.hotel) return [];
  const memeHotel = (lieu) => sansAccentsMin(separerChambreLigne(lieu).hotel) === sansAccentsMin(a.hotel);
  const out = [];
  for (const r of reservations) {
    if (r.statut === "annule" || (r.date_service && aujourdhui && r.date_service < aujourdhui)) continue;
    const lieu = String(r.lieu_pickup || "").trim();
    if (!lieu || !memeHotel(lieu)) continue;
    const champs = {};
    // Le lieu garde sa forme : avec la chambre s'il la portait, sinon l'hôtel seul.
    const nouveauLieu = separerChambreLigne(lieu).chambre ? ligneApres : b.hotel || ligneApres;
    if (nouveauLieu !== lieu) champs.lieu_pickup = nouveauLieu;
    const ch = (r.details && r.details.chambre) || "";
    if (ch && a.chambre && ch === a.chambre && b.chambre !== a.chambre) champs.details = { ...(r.details || {}), chambre: b.chambre };
    if (Object.keys(champs).length) out.push({ reservation: r, champs });
  }
  return out;
}

// ---- Personnes d'un service ajouté ----------------------------------------------------------------------------------
// Un service facturé par véhicule, par bateau ou au forfait ne compte personne : sa réservation naissait « 0 adulte » (voucher et feuille du jour
// sans passagers). Il prend les personnes du dossier : celles du service actif qui en compte le plus (tout le groupe voyage dans le véhicule).
export function personnesDuDossier(reservations, sauf = null) {
  let meilleur = null;
  for (const r of reservations || []) {
    if (r.statut === "annule" || (sauf && r.id === sauf)) continue;
    const p = r.personnes || {};
    const n = (Number(p.adultes) || 0) + (Number(p.enfants) || 0);
    if (n > 0 && (!meilleur || n > meilleur.n)) meilleur = { n, adultes: Number(p.adultes) || 0, enfants: Number(p.enfants) || 0 };
  }
  return meilleur ? { adultes: meilleur.adultes, enfants: meilleur.enfants } : null;
}
export const sansPersonne = (p) => !((Number(p && p.adultes) || 0) + (Number(p && p.enfants) || 0));

// Les personnes d'un service créé d'après ses lignes, corrigées par celles du dossier (contrôle du 17.11.2026, D8) : un service sans personnes
// (véhicule, forfait) les prend toutes ; un service sans ligne enfant compte les enfants du dossier quand sa quantité est celle du dossier
// (par personne : adultes + enfants ; par adulte : les adultes). Renvoie { adultes, enfants }, ou null quand rien ne change.
// Les personnes du dossier pour un service créé : celles saisies au Nouveau dossier (`fixes`), sinon, pour un service ajouté à un dossier existant
// (`duDossier`), celles de ses réservations actuelles, relues à chaque service : une réservation créée juste avant dans la même boucle compte
// (revue de la PR 217 : un transfert par véhicule après une excursion pour 2 adultes naissait à 0 personne).
export const personnesPourService = ({ fixes = null, duDossier = false, reservations = [] } = {}) => (fixes && (Number(fixes.adultes) || 0) + (Number(fixes.enfants) || 0) ? fixes : duDossier ? personnesDuDossier(reservations) : null);

// `unite` : l'unité du tarif. Un tarif par adulte ne facture pas l'enfant : ses adultes égaux à ceux du dossier comptent aussi les enfants. Pour un
// tarif par personne, seule une quantité égale à adultes + enfants dit que les enfants y sont.
export function personnesSelonDossier(personnes, dossier, unite = "") {
  if (!dossier) return null;
  const da = Number(dossier.adultes) || 0;
  const de = Number(dossier.enfants) || 0;
  if (!(da + de)) return null;
  if (sansPersonne(personnes)) return { adultes: da, enfants: de };
  const a = Number(personnes.adultes) || 0;
  const e = Number(personnes.enfants) || 0;
  if (e || !de) return null;
  return a === da + de || (unite === "ad" && a === da) ? { adultes: da, enfants: de } : null;
}

// ---- Fusion de deux clients -------------------------------------------------------------------------------------------
// Ce que la fiche gardée reçoit de l'autre : chaque champ vide prend la valeur de l'autre fiche, les notes s'ajoutent. Rien d'écrit n'est écrasé.
// Même règle que la fonction fusionner_clients de la base (migration de fusion), pour que la démo et la production donnent la même fiche.
const CHAMPS_FUSION = ["civilite", "prenom", "nom", "telephone", "email", "adresse"];
export function fusionClients(garde, absorbe) {
  const patch = {};
  for (const k of CHAMPS_FUSION) if (!String(garde[k] || "").trim() && String(absorbe[k] || "").trim()) patch[k] = absorbe[k];
  const n1 = String(garde.notes || "").trim();
  const n2 = String(absorbe.notes || "").trim();
  if (n2 && n2 !== n1) patch.notes = n1 ? `${n1}\n${n2}` : n2;
  return patch;
}

// ---- Enfant ajouté à un service : la ligne enfant de la facture ------------------------------------------------------
// « Changer la réservation » avec un enfant de plus : la facture n'avait qu'une ligne adulte, rien ne changeait. La facture gagne la ligne
// enfant au tarif enfant du catalogue (prix enfant de la prestation, prestation enfant séparée ou prix enfant du trajet).
//   `tarifEnfant(ligneAdulte)` : { unite, net, prestation_id? } ou null quand le catalogue n'a pas de tarif enfant ;
//   `uid()` : identifiant de la nouvelle ligne ; `langue` : celle du document (« en » pour Secret).
// Renvoie { contenu, ajoutee, retiree, raison } : `contenu` vaut null quand rien ne change ; `raison` dit pourquoi la facture ne suit pas :
//   « sans_tarif » (pas de tarif enfant), « prix_global » (prix par véhicule ou forfait, l'enfant ne change rien), « plusieurs_lignes ».
const qteDe = (l) => (l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.qte) : 1);
const estEnfant = (l) => /enfant|child/i.test(l.intro || "") || /,\s*(child|enfant)\b/i.test(l.titre || l.libelle || "");
const parPersonne = (l) => !["boat", "veh", "day", "ses", "grp"].includes(l.par) && !/bateau|v[ée]hicule|jour|session|groupe|boat|vehicle|day|group/i.test(l.intro || "");
export function contenuAvecEnfants(contenu, r, avant, apres, { tarifEnfant = () => null, uid = () => crypto.randomUUID(), decrire = null, langue = "" } = {}) {
  const rien = (raison = "") => ({ contenu: null, ajoutee: null, retiree: null, raison });
  const anciens = Number(avant && avant.personnes && avant.personnes.enfants) || 0;
  const nouveaux = Number(apres && apres.personnes && apres.personnes.enfants) || 0;
  if (anciens === nouveaux) return rien();
  const ids = new Set([r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean));
  const lignes = (contenu && contenu.lignes) || [];
  const cibles = lignes.filter((l) => ids.has(l.id) && l.kind !== "texte" && l.kind !== "remise");
  // Base + suppléments : le supplément suit déjà le nombre total de personnes (contenuAvecReservation).
  if (!cibles.length || cibles.some(estLigneSupplement)) return rien();
  const enfants = cibles.filter(estEnfant);
  // Plus d'enfant : la ligne enfant qui les comptait tous part de la facture.
  if (enfants.length) {
    if (nouveaux === 0 && enfants.length === 1 && qteDe(enfants[0]) === anciens) return { contenu: { ...contenu, lignes: lignes.filter((l) => l !== enfants[0]) }, ajoutee: null, retiree: enfants[0].id, raison: "" };
    return rien();
  }
  if (!nouveaux) return rien();
  const adultes = cibles.filter((l) => !estEnfant(l));
  if (adultes.length !== 1) return rien(adultes.length ? "plusieurs_lignes" : "");
  const adulte = adultes[0];
  if (!parPersonne(adulte)) return rien("prix_global");
  // Enfants déjà comptés au prix adulte sur cette ligne (contenuAvecReservation l'a mise au nombre total de personnes) : pas de ligne enfant en plus.
  const tot = (p) => (Number(p && p.adultes) || 0) + (Number(p && p.enfants) || 0);
  if (anciens > 0 && qteDe(adulte) === tot(apres && apres.personnes)) return rien();
  const t = tarifEnfant(adulte);
  if (!t || t.unite === null || t.unite === undefined || t.unite === "" || Number.isNaN(Number(t.unite))) return rien("sans_tarif");
  const en = langue === "en";
  const titreAdulte = String(adulte.titre || adulte.libelle || "").trim();
  const titre = `${titreAdulte}, ${en ? "child" : "enfant"}`;
  const ligne = {
    id: uid(),
    kind: "ligne",
    ...(adulte.titre ? { titre } : {}),
    libelle: titre,
    intro: `(${en ? "per child" : "par enfant"})`,
    puces: [],
    unite: Number(t.unite),
    qte: nouveaux,
    montant: null,
    pct: null,
    prestation_id: t.prestation_id !== undefined ? t.prestation_id : adulte.prestation_id || null,
    ...(adulte.trajet_id ? { trajet_id: adulte.trajet_id } : {}),
    partenaire_id: adulte.partenaire_id || null,
    date_service: adulte.date_service || null,
    ...(adulte.paye_sur_place ? { paye_sur_place: true } : {}),
    net: t.net === null || t.net === undefined ? null : Number(t.net),
  };
  // En excursions, la ligne porte la description générée comme sa ligne adulte (« Nom, child, 1 child, 20 November 2026 »).
  if (adulte.titre && decrire) ligne.libelle = decrire({ ...ligne, libelle: titre });
  const i = lignes.indexOf(adulte);
  return { contenu: { ...contenu, lignes: [...lignes.slice(0, i + 1), ligne, ...lignes.slice(i + 1)] }, ajoutee: ligne.id, retiree: null, raison: "" };
}
// Les lignes d'une réservation après l'ajout d'une ligne enfant : elle la compte désormais parmi les siennes.
export function lignesIdsAvec(r, id) {
  const actuels = (r.details && r.details.lignes_ids && r.details.lignes_ids.length ? r.details.lignes_ids : [r.ligne_id]).filter(Boolean);
  return actuels.includes(id) ? actuels : [...actuels, id];
}
