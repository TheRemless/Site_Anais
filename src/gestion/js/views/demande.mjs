// Fiche de création d'un dossier (ancien écran « Coller une demande », sans zone de collage depuis le 20.11.2026 : l'onglet Assistant est
// la seule entrée, décision de Jérémy). Elle reçoit une demande déjà lue : une demande du formulaire du site (« Demandes du site ») ou une
// carte « Nouveau dossier » de l'agent. Elle montre le client, les services avec leur prix de la base, les zones de pickup, les champs du
// voucher. Elle crée client, dossier, facture et réservations. Tout se corrige sur place ; le prix suit. Une carte validée d'un geste passe
// par la même fiche sans l'afficher (`auto`) : la fiche ne s'ouvre que s'il manque quelque chose, avec le motif.
import { etat, exemple, entiteActive, reglages, modeExcursions, modeTaxi, nomPartenaire, partenaireDe, netPrestation, netTrajet, peut, naviguer, nomClient, clientParId, clientsProposes, chargerHotelsLieux, zoneDeHotel, partageClientsPermis } from "../etat.mjs";
import { h, modal, toast, champ } from "../ui.mjs";
import { aujourdhui, formatMontant } from "../calc.mjs";
import { lireDuTexte, demandeEnregistree, serviceCree, offresDuService, decouperServices, varsReponse, langueReponse, notesDemande, siegesDemande, separerNom, clientsProches } from "../demande-calc.mjs";
import { lignesDepuisTrajet, ligneDepuisPrestation, chiffres, quantiteParDefaut } from "../partenaires-calc.mjs";
import { appliquerModeParDefaut, lieuParDefaut } from "../operations-calc.mjs";
import { ouvrirMessage } from "./messages.mjs";
import { choisirPrestation } from "./choix-prestation.mjs";
import { blocZonesPickup } from "./pickup-zones.mjs";
import { heureAPoser } from "../pickup-calc.mjs";
import { creerDossierExcursions, langueDocuments, refProposee, refExiste, refDefinitive } from "./creation-excursions.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";
import { servicesCreation, serviceDeLecture, saisieInitiale, reservationDuService, hotelDuClient as hotelDuClientCalc, boutsDuTrajet, trajetIncomplet, siegesIncomplets, siegesEnTrop, ligneRetourDepart, ligneTransfertPrive, champsCreation, avecSensLu, lieuxAVerifierFiche } from "../creation-voucher-calc.mjs";
import { lieuxExiges } from "../agent-calc.mjs";
import { siegesLus, siegesTotal, siegesAChoisir } from "../sieges-calc.mjs";
import { blocServiceCreation, ERREURS_TRAJET } from "./champs-voucher.mjs";
import { badgeConfiance } from "./assistant-demande.mjs";
import { offresRecalculees, lignesAuPrixCarte } from "../assistant-calc.mjs";
import { RETOUR_DEPART, dureeFrancais } from "../trajet-calc.mjs";
import { partenaireDeTaxi, chauffeurRegle } from "../voucher-rapide-calc.mjs";
import { imposerTotal, estCarnet } from "../demandes-site-calc.mjs";
import { refDeLaPage } from "../carnet-colle.mjs";
import { telephoneDepuisWhatsApp } from "../telephone-carte-calc.mjs";
import { verifierTelephoneClient, messageTelephone } from "../client-calc.mjs";

// Le plus long qu'une validation d'un geste attend la liste des hôtels situés avant de créer le dossier.
export const HOTELS_DELAI_MS = 3000;
// Une promesse attendue au plus `ms` : rend sa valeur, ou null à l'échéance ou en cas d'erreur (la minuterie est levée dès la réponse).
export function avecDelai(promesse, ms) {
  let minuterie;
  const echeance = new Promise((ok) => (minuterie = setTimeout(() => ok(null), ms)));
  return Promise.race([Promise.resolve(promesse).catch(() => null), echeance]).finally(() => clearTimeout(minuterie));
}

// Brouillon passé à l'écran « Nouveau dossier » : lu une seule fois.
let brouillon = null;
// Il reste en mémoire tant que le dossier n'est pas créé : l'écran peut se redessiner (synchronisation) sans perdre la demande.
export const lireBrouillon = () => brouillon;
export const viderBrouillon = () => {
  brouillon = null;
};

const AVERTISSEMENTS = {
  sans_tarif_enfant: N_("Pas de tarif enfant pour ce trajet : le prix ne compte que les adultes."),
  prix_a_definir: N_("Prix à définir dans la base."),
  sur_place: N_("À payer sur place."),
  enfant_plein_tarif: N_("Pas de tarif enfant : les enfants sont comptés au tarif adulte."),
  enfant_non_compte: N_("Tarif par adulte sans prix enfant : les enfants ne sont pas comptés."),
  supplement_a_definir: N_("Prix de la personne supplémentaire à définir dans la base : le prix ne compte que la base."),
  groupe_hors_tranche: N_("Le groupe ne tient dans aucune tranche de ce tarif : prix à vérifier avec le prestataire."),
  // Revue de la PR 307 : le prix de la carte valait pour d'autres personnes.
  extra_sans_tarif: N_("Extra demandé mais aucune ligne créée (tarif absent de la base ou extra impossible pour cette sortie). Vérifiez, puis ajoutez-le à la main avec « Ajouter un service » si besoin."),
  prix_carte_personnes: N_("Le nombre de personnes a changé : le prix repart du catalogue. Vérifiez le prix convenu dans la conversation."),
};

// Message collé chez Taxi sans pickup ou sans drop-off lisible (relecture de la PR 332) : rien n'est deviné, ni l'hôtel ni le nom du tarif.
// Sous le service, tant que le lieu manque :
const LIEUX_A_VERIFIER = {
  pickup_a_verifier: N_("Pickup à vérifier : le message ne dit pas d'où part la course."),
  dropoff_a_verifier: N_("Drop-off à vérifier : le message ne dit pas où va la course."),
};
// Une ligne étiquetée d'un lieu : « Pickup: … », « Drop-off: … », « From: … », « Prise en charge : … ».
const ETIQUETTE_LIEU = /^[ \t]*(?:pick[- ]?up(?:[ \t]+(?:place|location|point|address))?|drop[- ]?off(?:[ \t]+(?:place|location|point|address))?|from|to|prise en charge|d[ée]pose|d[ée]part|destination|lieu de [\p{L} ]+)[ \t]*:/iu;
// Les trajets lus dans le texte libre, un par service, dans l'ordre : chacun va au premier service suivant dont la phrase cite un de ses
// lieux ; sinon, à nombre égal, dans l'ordre des services. Un trajet sans service, ou un compte qui ne colle pas : aucune proposition.
export function repartirTrajets(trajets = [], phrases = []) {
  const cite = (phrase, lieu) => !!lieu && phrase.toLowerCase().includes(lieu.toLowerCase());
  const out = phrases.map(() => null);
  let dernier = -1;
  let ok = trajets.length > 0;
  for (const t of trajets) {
    const i = phrases.findIndex((p, k) => k > dernier && (cite(p, t.pickup) || cite(p, t.dropoff)));
    if (i < 0) {
      ok = false;
      break;
    }
    out[i] = t;
    dernier = i;
  }
  if (ok) return out;
  return trajets.length === phrases.length ? [...trajets] : phrases.map(() => null);
}
// Même manque, avec un trajet lu dans le texte libre et proposé sous le champ (« Utiliser ») :
const LIEUX_PROPOSES = {
  pickup_a_verifier: N_("Pickup à vérifier : utilisez le trajet lu dans le message, ou remplissez le champ."),
  dropoff_a_verifier: N_("Drop-off à vérifier : utilisez le trajet lu dans le message, ou remplissez le champ."),
};
// À la création, quand le lieu manque toujours (le champ du bloc du voucher prend le focus) :
const ERREURS_LIEUX = {
  pickup_a_verifier: N_("Pickup à vérifier : remplissez le lieu de pickup du service avant de créer."),
  dropoff_a_verifier: N_("Drop-off à vérifier : remplissez le drop-off du service avant de créer."),
};

// Quantité d'une prestation selon son unité (les bébés ne comptent pas).
const quantite = (p, d) => quantiteParDefaut(p.unite, d);

// Chaque service prend le mode de règlement habituel de son partenaire (chez nous ou sur place).
// Chez Taxi, une ligne du catalogue sans partenaire est une course du chauffeur réglé, comme un transfert hors catalogue de cette fiche et une
// carte « reservation » (chauffeurCarte) : relecture de la PR 332, la carte « dossier » créait la course sans chauffeur.
function avecChauffeur(lignes) {
  const p = modeTaxi() ? partenaireDeTaxi(etat.db.partenaires, chauffeurRegle(reglages())) : null;
  return p ? lignes.map((l) => (l && l.kind === "ligne" && !l.partenaire_id ? { ...l, partenaire_id: p.id } : l)) : lignes;
}
function lignesDe(offre, d, langue, devise) {
  return appliquerModeParDefaut(avecChauffeur(lignesBrutes(offre, d, langue, devise)), partenaireDe);
}

function lignesBrutes(offre, d, langue, devise) {
  if (offre.genre === "trajet") return lignesDepuisTrajet(offre.source, netTrajet(offre.source), { langue, date: d.date, adultes: d.adultes || (d.enfants ? 0 : 1), enfants: d.enfants, compagnie: "" });
  // Les véhicules du devis calculé par Nani (offre.vehicules, assistant-calc.mjs avecVehicules) : la ligne en prend la quantité.
  const adulte = ligneDepuisPrestation(offre.source, netPrestation(offre.source), { langue, date: d.date, qte: offre.vehicules || (offre.enfant ? d.adultes || 1 : quantite(offre.source, d)), devise });
  // Prix de base pour 1 ou 2 personnes, puis une ligne de supplément par personne en plus (aucune ligne à une ou deux personnes).
  const supplement = offre.supplement ? [ligneDepuisPrestation(offre.supplement.source, netPrestation(offre.supplement.source), { langue, date: d.date, qte: offre.supplement.qte, devise })] : [];
  // Extras du site qui ont un tarif (Add Koh Kradan) : une ligne chacun, une seule fois (un prix par bateau).
  const extras = (offre.extras || []).map((x) => ligneDepuisPrestation(x.source, netPrestation(x.source), { langue, date: d.date, qte: x.qte, devise }));
  if (!offre.enfant) return [adulte, ...supplement, ...extras];
  // Une ligne par adulte et une ligne enfant au même nom : elles donnent une seule réservation, comme pour un trajet.
  const en = langue === "en";
  const e = ligneDepuisPrestation(offre.enfant, netPrestation(offre.enfant), { langue, date: d.date, qte: d.enfants, devise });
  return [adulte, { ...e, libelle: `${adulte.libelle}, ${en ? "child" : "enfant"}`, intro: `(${en ? "per child" : "par enfant"})` }, ...supplement, ...extras];
}

// L'hôtel du client connu : la première ligne de son adresse (« Hotel Sunset, Room 12 » → « Hotel Sunset »).
// L'hôtel noté sur la fiche. Une fiche partagée par une autre entreprise (ZTP) porte une adresse postale : pas d'hôtel.
const hotelDuClient = (c) => hotelDuClientCalc(c, etat.entiteId);

// Ce que le formulaire du site a dit en plus du prix à calculer : option, lieux, vol, âges, prix annoncé. Lu, jamais deviné.
function lignesSite(d) {
  if (!d.site) return [];
  return [
    d.option ? tr("Option demandée : {option}", { option: d.option }) : "",
    d.pickup && d.type === "transfer" ? tr("Prise en charge : {lieu}", { lieu: d.pickup }) : "",
    d.dropoff ? tr("Dépose : {lieu}", { lieu: d.dropoff }) : "",
    // Retour au point de départ (formulaire taxi du site) : le programme et la durée tels que le client les a écrits.
    d.retourDepart ? tr("Retour au point de départ : {programme}", { programme: d.retourDepart.programme || tr("programme à demander") }) : "",
    d.retourDepart && d.dureeTexte ? tr("Durée indiquée : {duree}", { duree: d.dureeTexte }) : "",
    d.vol ? tr("Vol ou bateau : {vol}", { vol: d.vol }) : "",
    d.plusGrands ? tr("{n} enfant de plus de {max} ans compté au tarif adulte du partenaire. L'entrée du parc reste au tarif enfant.", { n: d.plusGrands, max: d.plusGrandsMax }) : "",
    d.ages && d.ages.length ? tr("Âges des enfants : {ages}", { ages: d.ages.map((a) => (a === 0 ? tr("moins de 1 an") : a)).join(", ") }) : "",
    d.prixSite ? tr("Prix indiqué sur le site : {prix}", { prix: d.prixSite }) : "",
    d.sorties && d.sorties.length ? tr("Liste de {n} sorties : seule la première est préparée, les autres sont dans les notes du dossier.", { n: d.sorties.length + 1 }) : "",
    d.type === "location" ? tr("Location : vérifiez la durée et le nombre de véhicules sur la facture.") : "",
  ].filter(Boolean);
}

// `depuisSite` (boîte « Demandes du site ») : { texte, titre, telephone, prixImpose, carnet, avantCreer, surCree } (`carnet` : { produit, option } d'une demande venue d'une page du carnet). Le message vient de la demande, pas du presse-papiers ni du brouillon
// de l'appareil ; « Vérifier avant de créer », la réponse et le passage à une autre entreprise sont retirés (la demande appartient à son entreprise,
// la réponse au client se prépare après la création) ; `avantCreer()` (migration 72) relit la demande juste avant d'écrire et rend le motif
// d'arrêt (traitée entre-temps, second dossier refusé) ou null pour créer ; une fois le dossier créé, `surCree({ dossier, services, total })`
// prend la suite.
// `depuisItineraire` (écran « Prix et horaires », carte de l'onglet Assistant) : { texte, d, services, surCree? } déjà prêts, un service par trajet dont l'horaire est choisi, avec l'hôtel
// de départ (`hotelDepart`) comme lieu de pickup. Le message du client est repris tel quel, les services ne sont pas relus.
// `options` (carte de l'agent) : { titre, auto, surCree, essai, clientId, clientAVenir }. `auto` crée sans afficher la fiche et rend { ok, dossier } ; s'il manque quelque
// chose (prix d'un transfert privé, service à choisir, retour sans programme…), rien n'est créé et la fiche rend { ok: false, motif }.
// `surCree({ dossier, services, total })` prend la suite d'une création, d'un geste ou depuis la fiche affichée.
export function ouvrirDemande(depuisSite = null, depuisItineraire = null, options = {}) {
  if (!depuisSite || typeof depuisSite.texte !== "string") depuisSite = null;
  // Plus de saisie libre : sans demande du site ni demande déjà lue, il n'y a rien à créer (l'onglet Assistant lit les messages).
  if (!depuisSite && !depuisItineraire) return null;
  const auto = !!options.auto;
  const regl = reglages();
  const devise = regl.devise || "THB";
  const langue = langueDocuments(regl);
  // `taxi` : chez VIP Taxi Lanta, toute demande est une course en voiture (un « wait for us » suffit à lire un retour au point de départ).
  const contexte = () => ({ prestations: etat.db.prestations, trajets: etat.db.trajets, partenaires: etat.db.partenaires, nomPartenaire, taxi: modeTaxi() });
  let d = null;
  let texte = "";
  // `options.clientId` (espace unifié, migration 63) : le second dossier d'une demande mixte reprend la fiche créée pour le premier.
  let clientId = options.clientId || ""; // client existant retenu ; vide pour un nouveau client
  let refuse = new Set(); // clients proposés que la personne a écartés
  let creation = false;
  let whatsappId = null; // conversation WhatsApp à relier au client et au dossier créés
  let candidatsWa = []; // conversations au nom du client, proposées sous le champ WhatsApp
  const prixImpose = depuisSite && depuisSite.prixImpose !== null && depuisSite.prixImpose !== undefined && depuisSite.prixImpose !== "" ? Number(depuisSite.prixImpose) : null;
  let services = []; // un par service cité dans le message : { id, coche, phrase, date, heure, adultes, enfants, offreId, lignesCustom, copie, noeuds }
  let compteur = 0;

  const zone = h("textarea", { id: "demande-texte", rows: 4, placeholder: `Hi ${(entiteActive() || {}).nom || "there"}!\nI'd like a price for a transfer.\nName: …`, oninput: () => lire(zone.value) });
  const reconnu = h("div", { class: "demande-reconnu", "aria-live": "polite" });
  // Les champs corrigeables sont posés une fois par message : les redessiner à chaque correction ferait perdre le doigt au champ suivant.
  const champs = h("div", { class: "demande-champs" });
  const clientBloc = h("div", { class: "demande-client-bloc" });
  const listeBloc = h("ul", { class: "services-liste", "aria-label": tr("Services trouvés") });
  const totalBloc = h("p", { class: "services-total", "aria-live": "polite" });
  const dynamique = h("div", { class: "demande-dynamique" });
  const saisies = {};
  const erreur = h("p", { class: "erreur-form", role: "alert" });

  const clefOffre = (o) => `${o.genre}:${o.id}`;
  const familleDesLignes = (ls) => {
    const l = ls.find((x) => x.prestation_id);
    return (l && (etat.db.prestations.find((p) => p.id === l.prestation_id) || {}).famille) || "";
  };
  const entier = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const clientsConnus = () => (d ? clientsProches(d, clientsProposes()).filter((x) => !refuse.has(x.client.id)) : []);

  // ---- Les services --------------------------------------------------------------------------------------------------------------
  // Un service lu par l'assistant garde les lignes de la base qu'il a choisies, recalculées pour ses personnes.
  // Retour au point de départ : aucune grille, le prix se saisit à la main sur le service (décision de Jérémy, 16.11.2026).
  const offresDe = (sv) => (sv.lignesCustom || sv.retourDepart || sv.transfertLibre ? [] : sv.offresIA ? offresRecalculees(sv.offresIA, sv, contexte()) : offresDuService(d, texte, sv, contexte()));
  const choisie = (sv, offres) => offres.find((o) => clefOffre(o) === sv.offreId) || offres[0] || null;
  const sommeCustom = (sv) => sv.lignesCustom.filter((l) => l.kind !== "texte").reduce((t, l) => t + (Number(l.unite) || 0) * (Number(l.qte) || 0), 0);
  // Ce que le service donne : son offre choisie, ou les lignes prises à la main dans la base.
  function etatDe(sv) {
    // Chez Taxi, la famille du tarif pris dans la base suit l'offre : une excursion garde l'hôtel en pickup, une course jamais (reservationDuService).
    // Secret et ZTP ne changent pas.
    if (sv.lignesCustom) return { offre: { genre: "prestation", id: sv.id, titre: sv.lignesCustom.filter((l) => l.kind !== "texte").map((l) => l.libelle).join(" + ") || tr("Service choisi"), total: sommeCustom(sv), source: { libelle: sv.lignesCustom.map((l) => l.libelle).join(" + "), ...(modeTaxi() ? { famille: familleDesLignes(sv.lignesCustom) } : {}) } }, offres: [] };
    const offres = offresDe(sv);
    return { offre: choisie(sv, offres), offres };
  }
  // Lignes prises à la main : la date corrigée sur la ligne du service passe aux lignes (elle date la réservation), sauf si le service n'a pas de date.
  // Une offre au prix de la carte (prix venu de la conversation) : ses lignes prennent ce prix (assistant-calc.mjs, lignesAuPrixCarte).
  // Les lignes prises avec « Choisir dans la base » reçoivent aussi le chauffeur réglé chez Taxi (avecChauffeur, relecture de la PR 332).
  const lignesDuService = (sv, offre) => (sv.lignesCustom ? avecChauffeur(sv.lignesCustom.map((l) => ({ ...l, titre: l.kind === "texte" ? undefined : l.libelle, ...(l.kind !== "texte" && sv.date ? { date_service: sv.date } : {}) }))) : offre ? lignesAuPrixCarte(lignesDe(offre, { date: sv.date, adultes: sv.adultes, enfants: sv.enfants }, langue, devise), offre.prixCarte) : []);
  // Le partenaire du service : celui de l'offre, ou de la première ligne prise dans la base. Sa grille de pickup donne les zones.
  const partenaireDeOffre = (sv, offre) => (sv.lignesCustom ? (sv.lignesCustom.find((l) => l.partenaire_id) || {}).partenaire_id : offre && offre.source && offre.source.partenaire_id) || "";
  const partenaireDuService = (sv) => partenaireDeOffre(sv, sv.lignesCustom ? null : etatDe(sv).offre);

  // Réservation de ce service : heure, lieu de prise en charge, dépose, vol, bagages (creation-voucher-calc.mjs, reservationDuService).
  const reservationDe = (sv, offre) => reservationDuService(sv, offre, { d, client: clientId ? clientParId(clientId) : null, taxi: modeTaxi(), entiteId: etat.entiteId });
  // Chez Taxi, les lieux qu'une course doit avoir (agent-calc.mjs, lieuxExiges, la règle des cartes de l'Assistant) : un transfert, le pickup et
  // le drop-off ; une excursion (aller-retour) ou un retour au point de départ, le pickup seul. Ailleurs : rien (Secret et ZTP ne changent pas).
  function lieuxAVerifierDe(sv, offre) {
    if (!modeTaxi()) return [];
    const ligne = sv.lignesCustom ? sv.lignesCustom.find((l) => l.prestation_id) : null;
    const o = sv.transfertLibre ? null : ligne ? { genre: "prestation", id: ligne.prestation_id } : offre ? { genre: offre.genre, id: offre.id } : null;
    const exiges = sv.retourDepart ? { pickup: true, dropoff: false } : lieuxExiges({ offre: o }, { prestations: etat.db.prestations, taxi: true });
    const entree = reservationDe(sv, offre);
    // Excursion (aller-retour) ou retour au départ : sans autre lieu dit, le pickup est l'hôtel du client, comme sur master (lieuParDefaut) ;
    // un client connu n'est pas bloqué à tort. Jamais pour une course : son pickup vient du message, de la carte ou de Nani.
    const hotel = !exiges.dropoff ? lieuParDefaut([], clientId ? clientParId(clientId) : { adresse: (d && d.hotel) || "" }, etat.entiteId) : "";
    return lieuxAVerifierFiche({ ...entree, lieu: entree.lieu || hotel }, exiges);
  }
  // Le trajet lu dans le texte libre du message (lireTrajetsLibres), proposé sous le champ vide : seul « Utiliser » le pose, dans les champs
  // vides seulement. Rien quand les deux champs qu'il remplirait sont déjà remplis.
  const propositionDe = (sv) => {
    const p = modeTaxi() && !sv.retourDepart && !sv.transfertLibre ? sv.proposition : null;
    const s = sv.saisie || {};
    if (!p) return null;
    const utile = (p.pickup && !(s.lieu || "").trim()) || (p.dropoff && !((s.details || {}).drop_off || "").trim());
    return utile ? p : null;
  };
  function utiliserProposition(sv) {
    const p = sv.proposition;
    if (!p) return;
    avecSensLu(sv.saisie, p);
    sv.proposition = null;
    sv.saisie.ouvert = true;
    // Le bloc du voucher se redessine avec les champs remplis (la saisie survit au redessin).
    sv.cleVoucher = null;
    majService(sv);
  }
  function blocProposition(sv) {
    const p = propositionDe(sv);
    if (!p) return null;
    const texte = `${p.pickup || "?"} → ${p.dropoff || "?"}`;
    return h("p", { class: "dsv-proposition", role: "status" }, h("span", null, tr("Lu dans le message : {trajet}", { trajet: texte })), h("button", { class: "secondaire petit", type: "button", "aria-label": tr("Utiliser {trajet}", { trajet: texte }), onclick: () => utiliserProposition(sv) }, tr("Utiliser")));
  }

  const coches = () => services.filter((sv) => sv.coche);
  function totalGeneral() {
    let total = 0;
    let complet = true;
    for (const sv of coches()) {
      const { offre } = etatDe(sv);
      if (offre && offre.total !== null && offre.total !== undefined) total += offre.total;
      else complet = false;
    }
    return { total, complet };
  }

  // Les alertes d'un service (date, personnes, sièges) : redites à chaque frappe dans le bloc du voucher, pour les sièges.
  function majAlertes(sv, offre = etatDe(sv).offre) {
    const n = sv.noeuds;
    const alertes = [];
    if (!sv.date) alertes.push(tr("Date à préciser."));
    else if (sv.date < aujourdhui()) alertes.push(tr("La date du service est passée."));
    if (sv.adultes + sv.enfants === 0) alertes.push(tr("Nombre de personnes à préciser."));
    // Âges des enfants (carnet de ZTP, PR 324) : âges manquants, sortie sans tarif enfant, âge hors du barème.
    if (offre && offre.avertissement === "ages_manquants") alertes.push(tr("Âges des enfants manquants : le tarif enfant dépend de l'âge. Demandez-les au client."));
    else if (offre && offre.avertissement === "age_enfant_sans_tarif" && offre.bareme) alertes.push(tr("Cette sortie n'a pas de tarif enfant : un enfant de moins de {min} ans n'a aucun tarif propre. Vérifiez avec le partenaire.", { min: offre.bareme.min }));
    else if (offre && offre.avertissement === "age_enfant" && offre.bareme) alertes.push(tr("Âge d'un enfant hors du barème de cette sortie ({min} à {max} ans) : vérifiez le tarif avec le partenaire.", { min: offre.bareme.min, max: offre.bareme.max }));
    else if (offre && offre.avertissement && AVERTISSEMENTS[offre.avertissement]) alertes.push(tr(AVERTISSEMENTS[offre.avertissement]));
    // Un extra demandé qui ne crée aucune ligne (sans tarif en base, ou impossible pour la sortie) : dit EN PLUS de l'avertissement ci-dessus (un groupe hors tranche ne le cache pas).
    if (offre && offre.extrasManquants && offre.extrasManquants.length) alertes.push(tr(AVERTISSEMENTS.extra_sans_tarif));
    if (sv.copie) alertes.push(tr("Même service, autre date."));
    // Le message de la page du client n'a été rattaché à aucun service de la carte (carteAvecLaPage) : la carte reste celle du modèle, à vérifier avec le message.
    if (sv.avertissementPage) alertes.push(tr("Le message de la page du client n'a pas pu être rattaché à un service de la carte : vérifiez la sortie, les personnes et les extras dans son message."));
    // Plus de sièges que d'enfants et de bébés : à vérifier avant de créer (relecture de la PR 315).
    const saisie = sv.saisie || {};
    if (siegesEnTrop({ sieges: siegesTotal(siegesLus({ ...(saisie.details || {}), sieges: saisie.sieges })), enfants: sv.enfants, bebes: saisie.bebes })) alertes.push(tr("Plus de sièges que d'enfants et de bébés : vérifiez."));
    // Un enfant ou un bébé sans choix des sièges (22.11.2026) : à faire avant de créer.
    // Un lieu que le message ne dit pas (relecture de la PR 332) : jamais l'hôtel par défaut, Nani le remplit dans le bloc du voucher.
    // Un trajet lu dans le message attend le clic de Nani : l'alerte le dit, sans prétendre que le message n'en parle pas.
    if (sv.coche) for (const code of lieuxAVerifierDe(sv, offre)) alertes.push(tr((propositionDe(sv) ? LIEUX_PROPOSES : LIEUX_A_VERIFIER)[code]));
    if (sv.siegesVisibles && siegesAChoisir({ enfants: sv.enfants, bebes: saisie.bebes, sieges: siegesLus({ ...(saisie.details || {}), sieges: saisie.sieges }) })) alertes.push(tr("Enfant ou bébé : choisissez child seat, baby seat ou aucun siège."));
    n.alertes.replaceChildren(...alertes.map((a) => h("span", { class: "demande-attention" }, a)));
    n.alertes.hidden = !alertes.length;
  }

  function majService(sv) {
    const { offre, offres } = etatDe(sv);
    const n = sv.noeuds;
    n.titre.replaceChildren();
    // Retour au point de départ à prix tapé : le titre garde le champ du prix (les lignes prises dans la base, elles, ont le cas général).
    if (sv.retourDepart && (!sv.lignesCustom || sv.ligneRetour)) n.titre.append(h("strong", null, tr("Retour au point de départ")), h("span", { class: "dsv-detail" }, texteRetour(sv)), prixRetour(sv), h("button", { class: "lien", type: "button", onclick: () => choisirDansBase(sv) }, tr("Choisir dans la base")));
    // Transfert privé hors catalogue lu par l'assistant : départ et arrivée déjà posés, le prix convenu se tape ici.
    else if (sv.transfertLibre && (!sv.lignesCustom || sv.ligneLibre)) n.titre.append(h("strong", null, tr("Transfert privé hors catalogue")), h("span", { class: "dsv-detail" }, texteLibre(sv)), prixLibre(sv), h("button", { class: "lien", type: "button", onclick: () => choisirDansBase(sv) }, tr("Choisir dans la base")));
    else if (sv.lignesCustom) n.titre.append(h("strong", null, offre.titre), h("button", { class: "lien", type: "button", onclick: () => choisirDansBase(sv) }, tr("Ajouter une ligne")));
    else if (!offres.length) n.titre.append(h("strong", { class: "a-preciser" }, tr("À préciser")), h("span", { class: "dsv-phrase" }, `« ${sv.phrase.length > 90 ? `${sv.phrase.slice(0, 90)}…` : sv.phrase} »`), h("button", { class: "secondaire petit", type: "button", onclick: () => choisirDansBase(sv) }, tr("Choisir dans la base")));
    else if (offres.length === 1) n.titre.append(h("strong", null, offres[0].titre), h("span", { class: "dsv-detail" }, offres[0].detail));
    else {
      const sel = h("select", { "aria-label": tr("Service proposé"), onchange: (e) => ((sv.offreId = e.target.value), majService(sv), majTotal()) }, offres.map((o) => h("option", { value: clefOffre(o) }, `${o.titre} · ${o.total === null ? "-" : formatMontant(o.total, devise)}`)));
      sel.value = offre ? clefOffre(offre) : "";
      n.titre.append(sel, offre ? h("span", { class: "dsv-detail" }, offre.detail) : null);
    }
    if (sv.confiance) n.titre.append(badgeConfiance(sv.confiance));
    n.prix.textContent = offre && offre.total !== null && offre.total !== undefined ? formatMontant(offre.total, devise) : "-";
    // Le prix de la conversation l'emporte ; celui du catalogue s'affiche à côté quand il diffère (Jérémy, 22.11.2026).
    if (offre && offre.prixCarte !== undefined && offre.totalCatalogue !== null && offre.totalCatalogue !== undefined && offre.totalCatalogue !== offre.total) n.prix.append(h("small", { class: "dsv-catalogue" }, ` ${tr("catalogue : {prix}", { prix: formatMontant(offre.totalCatalogue, devise) })}`));
    const service = servicesCreation(lignesDuService(sv, offre), { prestations: etat.db.prestations, partenaires: etat.db.partenaires, trajets: etat.db.trajets })[0] || null;
    // Les sièges se choisissent là où la fiche les montre (transfert de Secret, Taxi ; jamais ZTP).
    sv.siegesVisibles = !!service && modeExcursions() && champsCreation(service, { taxi: modeTaxi() }).includes("sieges");
    n.li.classList.toggle("decoche", !sv.coche);
    // Le bloc du voucher suit le modèle du service choisi (billet de bateau, excursion, transfert…) ; la saisie, elle, est gardée.
    const cle = service ? `${service.type}|${service.personnes.adultes + service.personnes.enfants > 0}|${service.pickup}|${service.dropoff}` : "";
    if (cle !== sv.cleVoucher) {
      sv.cleVoucher = cle;
      // Taxi : sans lieu donné par la demande, le pickup et le drop-off montrent les deux bouts du trajet choisi, dans un champ vide seulement
      // (un lieu de la carte ou saisi par Nani n'est jamais remplacé).
      if (service && modeTaxi()) boutsDuTrajet(sv.saisie, service, { lieu: !(d.type === "transfer" && d.pickup) });
      // Un lieu qui manque ou un trajet proposé : le bloc s'ouvre, pour que Nani le voie (sauf un repli fait à la main).
      const aOuvrir = !!service && modeTaxi() && (!!propositionDe(sv) || lieuxAVerifierDe(sv, offre).length > 0);
      n.voucher.replaceChildren(...(service ? [blocServiceCreation({ service, saisie: sv.saisie, taxi: modeTaxi(), prefixe: `svc${sv.id}-v`, sauf: ["heure", "adultes", "enfants"], aideLieu: modeTaxi() ? tr("Recopié d'une ligne « Pickup: » du message, sinon à remplir.") : tr("Vide : celui de la demande, ou l'hôtel."), ouvert: aOuvrir, surSaisie: (s) => {
        // Les sièges choisis effacent l'alerte « child seat, baby seat ou aucun siège ».
        majAlertes(sv);
        // Repassé en aller simple : ce n'est plus un retour au départ, les offres de la base et le cas général reviennent.
        if (sv.retourDepart && (s.details || {}).type_trajet !== RETOUR_DEPART) return quitterRetour(sv);
        // Le prix tapé suit le lieu et le programme (libellé de la ligne) ; le titre du service redit le programme lu.
        majLigneRetour(sv);
        if (sv.retourDepart) majTitreRetour(sv);
        // Transfert hors catalogue : le libellé suit le pickup et le drop-off corrigés dans le bloc du voucher.
        if (sv.transfertLibre) (majLigneLibre(sv), majTitreLibre(sv));
      } })].filter(Boolean) : []));
    }
    // Les alertes après le bloc du voucher : les bouts d'un trajet viennent d'y être posés (lieux à vérifier).
    majAlertes(sv, offre);
    // La proposition du message, sous le champ du pickup (ou en tête du bloc s'il n'a pas ce champ).
    for (const x of n.voucher.querySelectorAll(".dsv-proposition")) x.remove();
    const prop = blocProposition(sv);
    if (prop) {
      // Cherché dans le bloc lui-même : au premier dessin, le service n'est pas encore dans la page.
      const lieu = n.voucher.querySelector(`#svc${sv.id}-v-lieu`);
      const place = lieu ? lieu.parentElement : null;
      if (place) place.append(prop);
      else n.voucher.prepend(prop);
    }
    // Le partenaire a changé (autre offre choisie) : ses zones de pickup remplacent les précédentes.
    const pid = partenaireDeOffre(sv, offre);
    if (sv.zones && pid !== sv.partenaireId) {
      sv.partenaireId = pid;
      sv.zones.rafraichir();
    }
  }

  function construireService(sv) {
    const noeuds = { titre: h("div", { class: "dsv-titre" }), prix: h("strong", { class: "dsv-prix" }), alertes: h("p", { class: "dsv-alertes" }), voucher: h("div", { class: "dsv-voucher" }) };
    sv.noeuds = noeuds;
    // Ce que la demande dit déjà pour le voucher (un trajet du site donne la dépose, le vol, les bagages et les sièges ; une carte de
    // l'Assistant sa dépose, son vol, ses sièges, ses bagages et sa remarque), modifiable dans la fenêtre : creation-voucher-calc.mjs.
    // Formulaire du site et message collé (relecture de la PR 327) : « Child seat needed » ou « Baby seat needed » sans nombre donnent un siège.
    sv.saisie = saisieInitiale(sv, { d, excursions: modeExcursions(), sd: siegesDemande(d) });
    // Message collé chez Taxi : le pickup et le drop-off qu'il écrit (« from Krabi Airport to … »), recopiés dans un champ vide seulement.
    if (modeTaxi() && !sv.transfertLibre) avecSensLu(sv.saisie, sv.sensLu);
    const champ4 = (cle, libelle, valeur, opts = {}) => {
      const input = h("input", { id: `svc${sv.id}-${cle}`, value: valeur, autocomplete: "off", ...opts, onchange: (e) => ((sv[cle] = opts.type === "number" ? entier(e.target.value) : e.target.value), majService(sv), majTotal()) });
      return champ(libelle, input);
    };
    sv.partenaireId = partenaireDuService(sv);
    // Zone de l'hôtel : choisir la zone et le départ remplit l'heure de pickup d'après la grille du partenaire, sans écraser une heure déjà écrite.
    sv.zones = blocZonesPickup({
      id: `svc${sv.id}-zones`,
      partenaire: () => partenaireDe(partenaireDuService(sv)),
      hotel: () => sv.hotelDepart || (d && d.hotel) || "",
      // La plage ou le quartier noté pour cet hôtel (table des hôtels situés, migration 48).
      zoneHotel: () => zoneDeHotel(sv.hotelDepart || (d && d.hotel) || ""),
      trajet: () => {
        const { offre } = etatDe(sv);
        return offre && offre.genre === "trajet" ? offre.source : null;
      },
      surChoix: ({ heure, gardee }) => {
        sv.zonePickup = gardee;
        // L'heure du message qui est celle du bateau n'est pas l'heure de pickup : la grille la remplace.
        const { offre } = etatDe(sv);
        const heureBateau = offre && offre.genre === "trajet" && offre.source.depart ? offre.source.depart.slice(0, 5) : "";
        const nouvelle = heureAPoser({ actuelle: sv.heure === heureBateau ? "" : sv.heure, derniereGrille: sv.heureGrille, nouvelle: heure });
        if (nouvelle !== null) {
          sv.heure = nouvelle;
          sv.heureGrille = nouvelle;
          const input = document.getElementById(`svc${sv.id}-heure`);
          if (input) input.value = nouvelle;
        }
        majService(sv);
      },
    });
    const coche = h("input", { type: "checkbox", checked: sv.coche, "aria-label": tr("Créer ce service"), onchange: (e) => ((sv.coche = e.target.checked), majService(sv), majTotal()) });
    noeuds.li = h(
      "li",
      { class: "dsv" },
      h("div", { class: "dsv-tete" }, h("label", { class: "case-tache" }, coche), noeuds.titre, noeuds.prix),
      noeuds.alertes,
      h("div", { class: "dsv-champs" }, champ4("date", tr("Date du service"), sv.date || "", { type: "date" }), champ4("heure", tr("Heure de pickup"), sv.heure || "", { type: "time" }), champ4("adultes", tr("Adultes"), String(sv.adultes), { type: "number", min: "0", step: "1", inputmode: "numeric" }), champ4("enfants", tr("Enfants"), String(sv.enfants), { type: "number", min: "0", step: "1", inputmode: "numeric" })),
      sv.zones.noeud,
      noeuds.voucher
    );
    majService(sv);
    return noeuds.li;
  }

  // Le prix du service vient de la personne (prix convenu tapé, lignes prises à la main dans la base), pas d'une offre du catalogue.
  const prixALaMain = (sv) => !!(sv.lignesCustom || sv.transfertLibre || sv.retourDepart);
  const prixSaisiIci = (sv) => !sv.prixALaMainAuDepart && prixALaMain(sv);
  function nouveauService(base) {
    const sv = { id: ++compteur, coche: true, phrase: "", date: "", heure: "", adultes: d ? d.adultes : 0, enfants: d ? d.enfants : 0, offreId: null, lignesCustom: null, copie: false, noeuds: null, ...base };
    // Un prix déjà à la main dès l'ouverture (transfert libre, retour au départ) : pas un changement fait ici (prixSaisiIci).
    sv.prixALaMainAuDepart = prixALaMain(sv);
    services.push(sv);
    listeBloc.append(construireService(sv));
    // Prix déjà convenu (tapé par la personne dans la conversation de l'Assistant) : la ligne du transfert privé se fait tout de suite.
    if (sv.transfertLibre && sv.prixLibre !== null && sv.prixLibre !== undefined) (majLigneLibre(sv), majService(sv));
    return sv;
  }

  // Retour au point de départ : le prix convenu, tapé ici, devient la ligne du service (« Round trip from Lanta Sand Resort: Old Town tour »).
  // Le libellé suit le lieu et le programme saisis dans le bloc du voucher ; chez Taxi, la course est celle du chauffeur de l'entreprise.
  function prixRetour(sv) {
    const input = h("input", { id: `svc${sv.id}-prix`, type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: tr("Prix ({devise})", { devise }), "aria-label": tr("Prix convenu ({devise})", { devise }), value: sv.prixRetour ?? "", onchange: (e) => {
      const v = e.target.value.trim();
      sv.prixRetour = v === "" ? null : Number(v);
      majLigneRetour(sv);
      majService(sv);
      majTotal();
    } });
    return input;
  }
  // Transfert privé hors catalogue : « Lanta Sand Resort → The Scene, Ao Nang · Hors catalogue : indiquez le prix convenu. »
  const deVersLibre = (sv) => ({ de: ((sv.saisie && sv.saisie.lieu) || sv.transfertLibre.de || "").trim(), vers: (((sv.saisie && sv.saisie.details) || {}).drop_off || sv.transfertLibre.vers || "").trim() });
  const texteLibre = (sv) => {
    const { de, vers } = deVersLibre(sv);
    return [`${de || tr("Départ à préciser")} → ${vers || tr("Arrivée à préciser")}`, sv.prixLibre === null || sv.prixLibre === undefined ? tr("Hors catalogue : indiquez le prix convenu.") : ""].filter(Boolean).join(" · ");
  };
  const majTitreLibre = (sv) => {
    const n = sv.noeuds && sv.noeuds.titre && sv.noeuds.titre.querySelector(".dsv-detail");
    if (n && sv.transfertLibre && (!sv.lignesCustom || sv.ligneLibre)) n.textContent = texteLibre(sv);
  };
  function prixLibre(sv) {
    return h("input", { id: `svc${sv.id}-prix`, type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: tr("Prix ({devise})", { devise }), "aria-label": tr("Prix convenu ({devise})", { devise }), value: sv.prixLibre ?? "", onchange: (e) => {
      const v = e.target.value.trim();
      sv.prixLibre = v === "" ? null : Number(v);
      majLigneLibre(sv);
      majService(sv);
      majTotal();
    } });
  }
  function majLigneLibre(sv) {
    if (!sv.transfertLibre || (sv.lignesCustom && !sv.ligneLibre)) return;
    if (sv.prixLibre === null || sv.prixLibre === undefined || !(sv.prixLibre >= 0)) {
      if (sv.ligneLibre) sv.lignesCustom = null;
      sv.ligneLibre = null;
      return;
    }
    const p = modeTaxi() ? partenaireDeTaxi(etat.db.partenaires, chauffeurRegle(reglages())) : null;
    sv.ligneLibre = ligneTransfertPrive({ ...deVersLibre(sv), prix: sv.prixLibre, date: sv.date, partenaireId: p ? p.id : null }, sv.ligneLibre);
    sv.lignesCustom = [sv.ligneLibre];
  }

  // « « Old Town, the driver waits » · environ 3 h · Aucune grille… » : ce que le service porte déjà, sous son titre.
  const texteRetour = (sv) => {
    const dt = (sv.saisie && sv.saisie.details) || {};
    return [dt.programme_trajet ? `« ${dt.programme_trajet} »` : tr("Programme à préciser dans le bloc du voucher."), dureeFrancais(dt.duree_h), tr("Aucune grille : indiquez le prix convenu pour ce programme.")].filter(Boolean).join(" · ");
  };
  function quitterRetour(sv) {
    sv.retourDepart = null;
    if (sv.ligneRetour) sv.lignesCustom = null;
    sv.ligneRetour = null;
    sv.prixRetour = null;
    // Le bloc du voucher se refait sur la nouvelle offre (après l'événement en cours) ; la saisie (lieu, drop-off, aller simple) est gardée.
    setTimeout(() => (majService(sv), majTotal()));
  }
  const majTitreRetour = (sv) => {
    const n = sv.noeuds && sv.noeuds.titre && sv.noeuds.titre.querySelector(".dsv-detail");
    if (n) n.textContent = texteRetour(sv);
  };
  function majLigneRetour(sv) {
    if (!sv.retourDepart) return;
    if (sv.prixRetour === null || sv.prixRetour === undefined || !(sv.prixRetour >= 0)) {
      if (sv.ligneRetour) sv.lignesCustom = null;
      sv.ligneRetour = null;
      return;
    }
    const p = modeTaxi() ? partenaireDeTaxi(etat.db.partenaires, chauffeurRegle(reglages())) : null;
    const dt = (sv.saisie && sv.saisie.details) || {};
    sv.ligneRetour = ligneRetourDepart({ lieu: (sv.saisie && sv.saisie.lieu) || (d && (d.pickup || d.hotel)) || "", programme: dt.programme_trajet || "", prix: sv.prixRetour, date: sv.date, partenaireId: p ? p.id : null }, sv.ligneRetour);
    const l = sv.ligneRetour;
    sv.lignesCustom = [l];
  }

  // Service que la base ne propose pas tel quel : la fenêtre des tarifs reprend sa date et ses personnes, chaque ajout devient une ligne du service.
  function choisirDansBase(sv) {
    choisirPrestation({ langue, devise, sansCompagnie: true, dossierId: null, defauts: { date: sv.date, adultes: sv.adultes, enfants: sv.enfants }, onAjout: (lignes) => {
      // Une ligne prise dans la base remplace le prix tapé d'un retour au point de départ ou d'un transfert hors catalogue.
      if (sv.ligneRetour) (sv.lignesCustom = null), (sv.ligneRetour = null), (sv.prixRetour = null);
      if (sv.ligneLibre) (sv.lignesCustom = null), (sv.ligneLibre = null), (sv.prixLibre = null);
      sv.lignesCustom = [...(sv.lignesCustom || []), ...lignes];
      const premiere = lignes.find((l) => l.date_service);
      if (!sv.date && premiere) {
        sv.date = premiere.date_service;
        const input = document.getElementById(`svc${sv.id}-date`);
        if (input) input.value = sv.date;
      }
      majService(sv);
      majTotal();
    } });
  }

  function majTotal() {
    const n = coches().length;
    // Prix convenu dans « Modifier » : c'est lui que la facture prendra (un seul service).
    const { total, complet } = prixImpose !== null && n === 1 ? { total: prixImpose, complet: true } : totalGeneral();
    totalBloc.textContent = n ? (complet ? tr("Total : {montant}", { montant: formatMontant(total, devise) }) : tr("Total : prix à confirmer pour au moins un service")) : tr("Aucun service coché.");
    if (bouton) {
      bouton.textContent = n ? (complet ? tr("Créer le dossier · {n} · {montant}", { n: pluriel(n, N_("{n} service"), N_("{n} services")), montant: formatMontant(total, devise) }) : tr("Créer le dossier · {n}", { n: pluriel(n, N_("{n} service"), N_("{n} services")) })) : tr("Créer le dossier sans service");
      reponse.disabled = !n;
    }
  }

  // ---- Client, champs et message de réponse --------------------------------------------------------------------------------------
  function retenirClient() {
    const proches = clientsConnus();
    if (clientId && clientId !== options.clientId && !proches.some((x) => x.client.id === clientId)) clientId = "";
    if (!clientId && proches[0] && proches[0].raison === "telephone") clientId = proches[0].client.id;
    const c = clientId ? clientParId(clientId) : null;
    if (c && !d.hotel && !d.hotelSaisi) d.hotel = hotelDuClient(c);
  }

  function dessinerClient() {
    clientBloc.replaceChildren();
    if (!d) return;
    retenirClient();
    // L'hôtel a pu changer (corrigé, ou repris de la fiche du client) : les zones proposées pour cet hôtel suivent.
    for (const sv of services) if (sv.zones) sv.zones.rafraichir();
    // Le client retenu (ou quitté) change le pickup par défaut d'une excursion Taxi : les alertes de lieu suivent.
    for (const sv of services) if (sv.noeuds) majAlertes(sv);
    if (saisies.hotel && saisies.hotel.value !== (d.hotel || "")) saisies.hotel.value = d.hotel || "";
    const proches = clientsConnus();
    const connu = clientId ? clientParId(clientId) : null;
    const propose = !connu ? proches.find((x) => x.raison === "nom") : null;
    clientBloc.append(
      ...[
        connu
          ? h("p", { class: "demande-client connu", role: "status" }, h("span", null, tr("Client déjà connu : {nom}", { nom: nomClient(connu) }), connu.telephone ? ` · ${connu.telephone}` : ""), h("button", { class: "lien", type: "button", onclick: () => (refuse.add(connu.id), (clientId = ""), !d.hotelSaisi && d.hotel === hotelDuClient(connu) && (d.hotel = ""), dessinerClient()) }, tr("Nouveau client")))
          : propose
            ? h("p", { class: "demande-client", role: "status" }, h("span", null, tr("Un client porte le même nom : {nom}", { nom: nomClient(propose.client) }), propose.client.telephone ? ` · ${propose.client.telephone}` : ""), h("button", { class: "secondaire petit", type: "button", onclick: () => ((clientId = propose.client.id), dessinerClient()) }, tr("C'est lui")))
            : d.nom
              ? h("p", { class: "aide" }, tr("Nouveau client : il sera créé avec le dossier."))
              : null,
        ...(connu ? [] : propositionsWhatsApp()),
      ].filter(Boolean)
    );
  }

  // Les conversations WhatsApp au nom du client : un bouton par conversation, qui reprend son numéro en entier et la reliera au dossier.
  function propositionsWhatsApp() {
    return candidatsWa.map((c) =>
      h(
        "p",
        { class: "demande-client demande-wa", role: "status" },
        h("span", null, whatsappId === c.id ? tr("Numéro repris de la conversation WhatsApp « {nom} » : {telephone}", { nom: c.nom, telephone: c.telephone }) : tr("Conversation WhatsApp « {nom} » : {telephone}", { nom: c.nom, telephone: c.telephone })),
        whatsappId === c.id
          ? null
          : h("button", { class: "secondaire petit", type: "button", onclick: () => {
              d.telephone = c.telephone;
              whatsappId = c.id;
              if (saisies.tel) saisies.tel.value = c.telephone;
              dessinerClient();
            } }, tr("Reprendre ce numéro"))
      )
    );
  }

  // Un seul message de réponse, avec chaque service, SA date, son prix et le total, dans la langue du client. Aperçu et corrections avant l'envoi.
  function repondre() {
    const emetteur = regl.emetteur || {};
    const entreprise = { nom: emetteur.nom || entiteActive().nom, telephone: emetteur.telephone || "" };
    ouvrirMessage({
      titre: tr("Réponse à {nom}", { nom: d.nom || tr("la personne") }),
      pour: "client",
      cle: "reponse",
      // Secret et Taxi répondent toujours en anglais, avec les libellés anglais des services.
      langue: langueReponse(texte, modeExcursions()),
      telephone: d.telephone || "",
      vars: (l) => varsReponse({ d, services: coches().map((sv) => ({ ...sv, offre: etatDe(sv).offre, bebes: d.bebes })), devise, langue: l === "fr" && !modeExcursions() ? "fr" : "en", entreprise, partenaireDe, destinations: reglages().destinations_passeport }),
    });
  }

  // ---- Création --------------------------------------------------------------------------------------------------------------------
  function preparer() {
    const nom = separerNom(d.nom);
    const lignes = [];
    const parService = [];
    for (const sv of coches()) {
      majLigneRetour(sv);
      const { offre } = etatDe(sv);
      const ls = lignesDuService(sv, offre);
      if (!ls.length) return { manque: sv };
      lignes.push(...ls);
      parService.push({ ligneIds: ls.map((l) => l.id), ...reservationDe(sv, offre) });
    }
    // Retour au point de départ sans programme : on ne crée pas, le champ est montré.
    const incomplet = trajetIncomplet(parService) || siegesIncomplets(parService);
    if (incomplet) return { incomplet: coches()[incomplet.index], code: incomplet.code, champ: incomplet.champ };
    // Chez Taxi, un pickup ou un drop-off que le message ne dit pas : rien n'est créé, le champ est montré (relecture de la PR 332).
    for (const sv of coches()) {
      const [code] = lieuxAVerifierDe(sv, etatDe(sv).offre);
      if (code) return { incomplet: sv, code, champ: code === "pickup_a_verifier" ? "lieu" : "drop_off" };
    }
    const plusieurs = parService.length > 1;
    // Prix convenu dans « Modifier » (un seul service) : la facture prend ce total, l'écart va sur la première ligne.
    const finales = prixImpose !== null && !plusieurs ? imposerTotal(lignes, prixImpose) : lignes;
    return { prenom: nom.prenom, nom: nom.nom, telephone: d.telephone || "", hotel: d.hotel, client_id: clientId, personnes: { adultes: d.adultes, enfants: d.enfants }, notes: [notesDemande(plusieurs ? { ...d, heure: "" } : d, { surLeVoucher: modeExcursions() }), d.remarquesIA].filter(Boolean).join("\n"), lignes: finales, parService, reservation: parService[0] || {} };
  }

  // Un retour au point de départ sans programme (ou à durée illisible) : le bloc du service se déplie et le champ prend le focus.
  function montrerIncomplet(b) {
    erreur.textContent = tr(ERREURS_TRAJET[b.code] || ERREURS_LIEUX[b.code]);
    const sv = b.incomplet;
    const champ_ = document.getElementById(`svc${sv.id}-v-${{ duree_h: "duree-h", sieges: "sieges", lieu: "lieu", drop_off: "drop" }[b.champ] || "programme-trajet"}`);
    if (!champ_) return;
    const bloc = champ_.closest("details");
    if (bloc) bloc.open = true;
    champ_.focus();
  }

  // Création directe : client, dossier, facture et une réservation par service, sans passer par l'écran « Nouveau dossier ».
  // `auto` (carte de l'agent validée d'un geste) : la fiche n'est pas affichée ; un motif d'arrêt la ferme et revient à la carte.
  async function creerMaintenant(btn, { auto: direct = false } = {}) {
    if (direct) {
      const r = await creerMaintenant(btn);
      if (r && r.ok) return r;
      const motif = erreur.textContent || tr("Le dossier n'a pas pu être créé.");
      fermer();
      return { ok: false, motif };
    }
    // Une recherche de la demande enregistrée est en cours : la création attend sa réponse, puis crée d'après la fiche telle qu'elle est alors.
    if (recherche) await recherche;
    erreur.textContent = "";
    // `options.clientAVenir` (passe à blanc du second dossier d'une carte mixte) : la fiche viendra du premier dossier, pas de contrôle de fiche.
    const nouveauClient = !clientId && !options.clientAVenir;
    if (nouveauClient && !d.nom.trim()) return (erreur.textContent = tr("Indiquez le nom du client.")), document.getElementById("dem-nom").focus();
    if (nouveauClient && !peut("clients.ecrire")) return (erreur.textContent = tr("Votre rôle ne permet pas de créer un client : choisissez un client existant."));
    // Le numéro se contrôle ici, champ en main, plutôt qu'à l'écriture (un numéro coupé ou en double n'est jamais enregistré).
    const verifTel = nouveauClient ? verifierTelephoneClient(d.telephone || "", "") : { ok: true };
    if (!verifTel.ok) return (erreur.textContent = tr("Téléphone du client : {message}", { message: messageTelephone(verifTel.raison) })), saisies.tel && saisies.tel.focus();
    const b = preparer();
    if (b.manque && b.manque.retourDepart) return (erreur.textContent = tr("Indiquez le prix convenu du retour au point de départ, ou décochez cette ligne.")), (document.getElementById(`svc${b.manque.id}-prix`) || {}).focus?.();
    if (b.manque && b.manque.transfertLibre) return (erreur.textContent = tr("Indiquez le prix du transfert privé, ou décochez cette ligne.")), (document.getElementById(`svc${b.manque.id}-prix`) || {}).focus?.();
    if (b.manque) return (erreur.textContent = tr("Choisissez le service de « {phrase} » ou décochez cette ligne.", { phrase: b.manque.phrase.slice(0, 60) }));
    if (b.incomplet) return montrerIncomplet(b);
    const ref = refProposee(regl);
    if (!ref.trim() || refExiste(ref)) return (erreur.textContent = tr("Le numéro de facture n'a pas pu être proposé : créez le dossier depuis « Nouveau dossier »."));
    // `options.essai` (espace unifié, migration 63) : passe à blanc, tous les contrôles ont passé, rien n'est écrit.
    if (options.essai) {
      fermer();
      return { ok: true, essai: true };
    }
    creation = true;
    btn.disabled = true;
    btn.textContent = tr("Création…");
    const arret = depuisSite && depuisSite.avantCreer ? await depuisSite.avantCreer().catch(() => null) : null;
    if (arret) {
      creation = false;
      btn.disabled = false;
      majTotal();
      return (erreur.textContent = arret);
    }
    try {
      const numero = await refDefinitive(ref, ref, regl);
      const dossier = await creerDossierExcursions({ client: clientId ? { id: clientId } : { prenom: b.prenom, nom: b.nom, telephone: b.telephone, hotel: b.hotel, chambre: "" }, lignes: b.lignes, notes: b.notes, ref: numero, reservation: b.reservation, parService: b.parService });
      // prix_saisi : la personne a remplacé ici le prix de l'offre du catalogue par un prix à elle (onglet Assistant, agent-apprendre.mjs).
      // Les extras et le total de chaque service sont ceux de ses lignes réellement créées (une ligne supprimée dans la fenêtre n'est ni annoncée au client ni comptée).
      const finals = coches().map((sv, i) => {
        const ids = new Set((b.parService[i] || {}).ligneIds || []);
        return { ...serviceCree({ date: sv.date, heure: sv.heure, adultes: sv.adultes, enfants: sv.enfants, titre: (etatDe(sv).offre || {}).titre || "" }, b.lignes.filter((l) => ids.has(l.id)), etat.db.prestations), prix_saisi: prixSaisiIci(sv) };
      });
      const somme = b.lignes.filter((l) => l.kind !== "texte").reduce((t, l) => t + (Number(l.unite) || 0) * (Number(l.qte) || 0), 0);
      fermer();
      toast(tr("Dossier {ref} créé.", { ref: dossier.ref }));
      const total = Math.round(somme * 100) / 100;
      if (depuisSite && depuisSite.surCree) return void depuisSite.surCree({ dossier, services: finals, total, whatsappId });
      // Depuis une carte de l'onglet Assistant : la conversation se relie au dossier et garde les corrections (agent.mjs).
      if (depuisItineraire && depuisItineraire.surCree) depuisItineraire.surCree({ dossier });
      if (options.surCree) options.surCree({ dossier, services: finals, total, whatsappId });
      if ((depuisItineraire && depuisItineraire.surCree) || options.surCree) return { ok: true, dossier };
      naviguer(`#/dossier/${dossier.id}`);
      return { ok: true, dossier };
    } catch (err) {
      erreur.textContent = /duplicate|unique|23505/i.test(err.message) ? tr("Ce numéro existe déjà. Réessayez.") : err.message;
      creation = false;
      btn.disabled = false;
      majTotal();
    }
  }

  // Ouvre l'écran « Nouveau dossier » déjà rempli, pour vérifier ou compléter avant de créer.
  // Jamais depuis une carte de l'Assistant (`options.surCree`, relecture de la PR 337) : « Nouveau dossier » créerait le dossier sans que la
  // carte soit notée, et « Tout valider » pourrait en créer un second. La fiche de la carte crée elle-même, avec la carte prise.
  function verifierAvant() {
    if (options.surCree) return;
    const b = preparer();
    if (b.manque && b.manque.retourDepart) return (erreur.textContent = tr("Indiquez le prix convenu du retour au point de départ, ou décochez cette ligne.")), (document.getElementById(`svc${b.manque.id}-prix`) || {}).focus?.();
    if (b.manque && b.manque.transfertLibre) return (erreur.textContent = tr("Indiquez le prix du transfert privé, ou décochez cette ligne.")), (document.getElementById(`svc${b.manque.id}-prix`) || {}).focus?.();
    if (b.manque) return (erreur.textContent = tr("Choisissez le service de « {phrase} » ou décochez cette ligne.", { phrase: b.manque.phrase.slice(0, 60) }));
    if (b.incomplet) return montrerIncomplet(b);
    brouillon = b;
    fermer();
    naviguer("#/dossiers/nouveau?demande=1");
  }

  const modifier = (cle, valeur) => {
    // Un retour au point de départ a pris l'hôtel lu comme lieu de pickup : corrigé ici, il suit (sauf un lieu réécrit dans le bloc du voucher).
    if (cle === "hotel")
      for (const sv of services.filter((x) => x.retourDepart && x.saisie && (x.saisie.lieu || "") === (d.hotel || ""))) {
        sv.saisie.lieu = valeur;
        const input = document.getElementById(`svc${sv.id}-v-lieu`);
        if (input) input.value = valeur;
        majLigneRetour(sv);
      }
    d[cle] = valeur;
    if (cle === "hotel") d.hotelSaisi = true;
    // Le nom corrigé : les conversations WhatsApp proposées suivent.
    if (cle === "nom") lireWhatsApp();
    dessinerClient();
  };

  // Champs du client : posés une fois par message lu. La date, l'heure et les personnes sont dans chaque service.
  function construire() {
    const saisie = (cle, libelle, valeur, surChangement, opts = {}) => {
      const input = h("input", { id: `dem-${cle}`, value: valeur, autocomplete: "off", ...opts, onchange: (e) => surChangement(e.target.value) });
      saisies[cle] = input;
      return champ(libelle, input);
    };
    champs.replaceChildren(
      saisie("nom", tr("Nom du client"), d.nom, (v) => modifier("nom", v.trim())),
      saisie("tel", tr("WhatsApp"), d.telephone || "", (v) => {
        // Un autre numéro tapé après « Reprendre ce numéro » : la conversation proposée ne sera pas reliée.
        const choisie = candidatsWa.find((c) => c.id === whatsappId);
        if (choisie && v.trim() !== choisie.telephone) whatsappId = null;
        modifier("telephone", v.trim());
      }, { type: "tel", inputmode: "tel", placeholder: "+33 6 00 00 00 00" }),
      saisie("hotel", tr("Hôtel"), d.hotel || "", (v) => modifier("hotel", v.trim()), { placeholder: exemple("hotel") })
    );
  }

  let bouton = null;
  const reponse = h("button", { class: "secondaire", type: "button", onclick: () => repondre() }, tr("Répondre au client"));

  function poserLesBoutons() {
    const ecrit = peut("dossiers.ecrire");
    bouton = h("button", { class: "principal", type: "button", onclick: (e) => creerMaintenant(e.currentTarget) });
    bouton.disabled = !!recherche;
    const marque = (d.marque || "").toLowerCase();
    const mauvaise = marque && !entiteActive().nom.toLowerCase().includes(marque.split(" ")[0]);
    const sitesLignes = lignesSite(d);
    dynamique.replaceChildren(
      ...[
        mauvaise && !depuisSite ? h("p", { class: "bandeau-info", role: "status" }, tr("Cette demande est adressée à {marque}. Changez d'entreprise en haut de l'écran pour utiliser sa base de prix.", { marque: d.marque })) : null,
        prixImpose !== null ? h("p", { class: "bandeau-info", role: "status" }, coches().length > 1 ? tr("Prix convenu : {prix}. Plusieurs services : ajustez la facture dans le dossier.", { prix: formatMontant(prixImpose, devise) }) : tr("Prix convenu : {prix}. La facture prendra ce total.", { prix: formatMontant(prixImpose, devise) })) : null,
        d.siegeEnfant || d.siegeBebe || d.bebes ? h("p", { class: "aide" }, [d.bebes ? tr("{n} bébé : noté dans le dossier.", { n: d.bebes }) : "", d.siegeEnfant ? tr("Siège enfant demandé.") : "", d.siegeBebe ? tr("Siège bébé demandé.") : ""].filter(Boolean).join(" ")) : null,
        sitesLignes.length ? h("ul", { class: "demande-site" }, sitesLignes.map((l) => h("li", null, l))) : null,
        clientBloc,
        h("h3", { class: "services-titre" }, tr("Services trouvés")),
        listeBloc,
        h("button", { class: "secondaire petit", type: "button", onclick: () => { const sv = nouveauService({ phrase: tr("Service ajouté") }); choisirDansBase(sv); } }, tr("Ajouter un service")),
        totalBloc,
        erreur,
        h("div", { class: "barre-modal" }, ...[ecrit ? bouton : null, depuisSite ? null : reponse, ecrit && !depuisSite && !options.surCree ? h("button", { class: "lien", type: "button", onclick: () => verifierAvant() }, tr("Vérifier avant de créer")) : null].filter(Boolean)),
      ].filter(Boolean)
    );
  }

  // Les demandes que la page du carnet a enregistrées et que l'utilisateur peut lire (la liste de l'écran, ses droits), plus celle que la base a rendue pour la référence du texte.
  let demandeDeLaBase = null;
  const demandesLues = () => [...(etat.db.demandes_site || []), ...(demandeDeLaBase ? [demandeDeLaBase] : [])];
  // La fiche telle qu'elle est : tout ce qu'une personne peut y avoir corrigé (client, services, dates, personnes, prix, offre choisie). Une réponse tardive de la base la compare à celle
  // du départ : changée, elle n'écrase rien.
  const empreinte = () => {
    try {
      return JSON.stringify([clientId, d && [d.nom, d.telephone, d.hotel], services.map((sv) => [sv.coche, sv.phrase, sv.date, sv.heure, sv.adultes, sv.enfants, sv.offreId, !!sv.lignesCustom, sv.lignesCustom && sv.lignesCustom.length, sv.saisie])]);
    } catch {
      return `inconnue-${Math.random()}`;
    }
  };
  let sequence = 0;
  let recherche = null;
  const bloquerBouton = (oui) => { if (bouton) bouton.disabled = oui; };
  // Un texte collé que son titre ne suffit pas à identifier et qui porte la référence d'une page du carnet : la demande enregistrée par la page (même référence, même entreprise) est lue en base
  // quand la liste de l'écran ne l'a pas (les droits de la personne s'appliquent). Elle ne dit que la sortie et l'option (carnet-colle.mjs, lireParDemande). La réponse n'écrase JAMAIS une
  // saisie : ignorée si un autre texte a été lu entre-temps (jeton) ou si la fiche a été touchée ; sinon la fiche est refaite avec l'identification, et rien d'autre. Le bouton « Créer » attend la réponse.
  function chercherLaDemande(t) {
    const ref = refDeLaPage(t);
    if (!ref || demandeEnregistree(t, demandesLues(), { entiteId: etat.entiteId }) || !etat.store.demandeSiteParRef) return;
    const mien = sequence;
    const depart = empreinte();
    bloquerBouton(true);
    const p = (async () => {
      const trouvee = await etat.store.demandeSiteParRef(ref, etat.entiteId).catch(() => null);
      if (mien !== sequence || texte !== t || !trouvee || !estCarnet(trouvee) || empreinte() !== depart) return;
      const lu = lireDuTexte(t, aujourdhui(), depuisSite, { demandes: [trouvee], entiteId: etat.entiteId });
      if (!lu || !lu.carnet || (d && d.carnet)) return;
      demandeDeLaBase = trouvee;
      appliquer(lu, decouperServices(t, lu, contexte(), aujourdhui()));
    })().finally(() => {
      if (recherche === p) {
        recherche = null;
        bloquerBouton(false);
      }
    });
    recherche = p;
  }

  // Relire le texte : tout ce qui avait été corrigé à la main est perdu, c'est un autre message.
  function lire(valeur) {
    texte = valeur;
    sequence++;
    erreur.textContent = "";
    // Demande d'une page du carnet : sa sortie et son option sont connues ; un texte collé à la main se lit d'après son propre contenu (sortie par son titre), avec la détection par la référence
    // de la page (lireDuTexte). Un enfant plus âgé que le barème de la sortie paie le tarif adulte du partenaire : il est compté adulte (son entrée de parc reste au tarif enfant).
    const lu = texte.trim() ? lireDuTexte(texte, aujourdhui(), depuisSite, { demandes: demandesLues(), entiteId: etat.entiteId }) : null;
    if (lu) appliquer(lu, decouperServices(texte, lu, contexte(), aujourdhui()));
    else {
      d = null;
      vider();
      corps.classList.remove("lu");
      if (texte.trim()) reconnu.append(h("p", { class: "erreur-form", role: "alert" }, tr("Rien de reconnu dans ce texte. Collez le message du client tel qu'il est arrivé sur WhatsApp.")));
    }
    // La recherche de la demande enregistrée part de la fiche telle qu'elle vient d'être posée (son empreinte sert à reconnaître une saisie faite depuis).
    if (texte.trim() && !(lu && lu.carnet) && !(depuisSite && depuisSite.carnet)) chercherLaDemande(texte);
  }

  // Le numéro de la conversation WhatsApp (INV-2026-055) : celui de la conversation liée (`options.whatsappLie`, l'Assistant ouvert depuis
  // WhatsApp) remplace un champ vide ou coupé ; sinon les conversations au nom du client se proposent sous le champ, reprises d'un geste.
  // La conversation retenue se relie au client et au dossier après la création (surCree reçoit `whatsappId`).
  function lireWhatsApp() {
    const voisines = (etat.brut.entites || []).filter((e) => e.id !== etat.entiteId && partageClientsPermis(e.id, etat.entiteId)).map((e) => e.id);
    const lu = telephoneDepuisWhatsApp({ saisi: d.telephone || "", liee: options.whatsappLie || null, conversations: etat.brut.whatsapp_conversations || [], nomClient: d.nom || "", entites: [etat.entiteId, ...voisines], aujourdhui: aujourdhui() });
    const garde = whatsappId;
    d.telephone = lu.telephone;
    candidatsWa = lu.candidats;
    whatsappId = lu.whatsappId || (candidatsWa.some((c) => c.id === garde) ? garde : null);
  }

  function vider() {
    clientId = options.clientId || "";
    refuse = new Set();
    services = [];
    listeBloc.replaceChildren();
    reconnu.replaceChildren();
  }

  // Une lecture (par règles ou par l'assistant IA) et ses services : tout ce qui avait été corrigé à la main repart de zéro.
  // Un service lu par l'assistant porte `offresIA` (les lignes de la base qu'il a choisies) et `confiance`.
  function appliquer(d2, trouves) {
    erreur.textContent = "";
    d = { ...d2, hotelSaisi: false };
    // Demande du site : le numéro WhatsApp donné dans la feuille (migration 41) n'est pas dans le message, il va dans la fiche du client
    // (et retrouve un client déjà connu par son numéro). Lecture par règles comme par l'assistant.
    if (depuisSite && depuisSite.telephone && !d.telephone) d.telephone = depuisSite.telephone;
    vider();
    lireWhatsApp();
    corps.classList.add("lu");
    construire();
    poserLesBoutons();
    reconnu.append(champs, dynamique);
    // Rien de reconnu comme service : une ligne « à préciser » plutôt que le silence.
    // Le sens de la course lu dans le message (d.sens) ; plusieurs services : celui de la phrase de chacun, jamais celui d'un autre.
    // Les lignes étiquetées (« Pickup: », « Drop-off: ») se recopient quand le message n'a qu'un service ; les trajets du texte libre se
    // proposent, dans l'ordre, un par service, et seulement si leur nombre est celui des services (sinon rien n'est proposé).
    // Une phrase qui n'est qu'une ligne étiquetée (« Pickup: Krabi Airport ») n'est pas un service à part chez Taxi : elle part décochée.
    const ligneEtiquetee = (t) => modeTaxi() && ((!!d.sens && !!(d.sens.pickup || d.sens.dropoff)) || !!(d.trajetsLus || []).length) && ETIQUETTE_LIEU.test(t.phrase || "");
    const reels = trouves.map((t, i) => i).filter((i) => !ligneEtiquetee(trouves[i]));
    const nb = Math.max(reels.length, 1);
    const sensLu = nb === 1 ? d.sens || null : null;
    const parService = repartirTrajets(d.trajetsLus || [], reels.map((i) => trouves[i].phrase || ""));
    const propose = (i) => (reels.includes(i) ? parService[reels.indexOf(i)] || null : null);
    if (!trouves.length) nouveauService({ phrase: texte.trim().replace(/\s+/g, " ").slice(0, 140), date: d.date || "", heure: d.heure || "", sensLu, proposition: (d.trajetsLus || []).length === 1 ? d.trajetsLus[0] : null });
    trouves.forEach((t, i) => nouveauService({ ...serviceDeLecture(t), ...(ligneEtiquetee(t) ? { coche: false } : { sensLu: reels.length === 1 ? sensLu : null }), proposition: propose(i) }));
    dessinerClient();
    majTotal();
  }

  const corps = h("div", { class: "modal-corps demande" });
  // Demande du site : son message reste sous les yeux (il se relit si on le corrige). Carte de l'agent : la demande est déjà lue.
  corps.append(...(depuisSite ? [h("div", { class: "champ demande-message" }, h("label", { for: "demande-texte" }, tr("Message du client")), zone)] : []), reconnu);
  // `options.ferme` (carte de l'Assistant, « Vérifier avant ») : appelé à la fermeture de la fiche, créée ou non (la carte se rend si rien n'est créé).
  const fermer = modal(depuisSite ? depuisSite.titre : options.titre || tr("Créer le dossier"), corps, { large: true, protege: false, cache: auto, ferme: options.ferme || null });

  // Hôtels situés (migration 48) : lus en arrière-plan, leurs zones complètent ensuite les propositions de zone de pickup.
  // Une validation d'un geste les attend (leurs zones servent aux zones de pickup), jamais plus de HOTELS_DELAI_MS : une lecture lente ou
  // bloquée ne retient pas la création (relecture de la PR 332).
  const hotelsLus = avecDelai(chargerHotelsLieux(), HOTELS_DELAI_MS).then(() => services.forEach((sv) => sv.zones && sv.zones.rafraichir()));

  // Demande déjà lue (carte de l'agent) : le message et les services, sans relecture. `auto` crée tout de suite, la fiche reste cachée.
  if (depuisItineraire) {
    zone.value = depuisItineraire.texte || "";
    texte = zone.value;
    appliquer(depuisItineraire.d, depuisItineraire.services.map((s) => (s.depuisPage ? s : { ...s, offresIA: s.offres })));
    // D'un geste : la création attend les hôtels situés, au plus HOTELS_DELAI_MS.
    if (auto) return hotelsLus.then(() => creerMaintenant(bouton, { auto: true }));
    return Promise.resolve({ ok: false, ouverte: true });
  }
  zone.value = depuisSite.texte;
  lire(depuisSite.texte);
  return null;
}
