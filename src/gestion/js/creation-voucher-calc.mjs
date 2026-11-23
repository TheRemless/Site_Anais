// Création d'un dossier de Secret ou de Taxi avec tout ce que le voucher dit, service par service (13.11.2026) : la logique pure, sans DOM,
// testée dans tests/gestion-creation-voucher.test.js. Avant, il fallait créer le dossier, y revenir et éditer chaque réservation
// (heure et lieu de pickup, drop-off, vol, bagages, type de tour, remarques…).
import { reservationsDepuisDocument, typeVoucher, champsVoucherDe, pickupDepuisLibelle, dropOffDepuisLibelle, adresseEstHotel } from "./operations-calc.mjs";
import { zoneDuBout } from "./agent-calc.mjs";
import { libelleClient, ligneLibre } from "./partenaires-calc.mjs";
import { erreursVoucher, donneesVoucher, ligneVoucher, reservationVoucher, libelleTrajet } from "./voucher-rapide-calc.mjs";
import { estRetourDepartDetails, libelleRetourDepart, dureeFrancais, erreursTrajet, RETOUR_DEPART } from "./trajet-calc.mjs";
import { tr } from "./i18n.mjs";
import { SIEGES_MAX, siegesLus, siegesTotal, siegesAChoisir } from "./sieges-calc.mjs";

// Les services du dossier tels que la création en fera des réservations : une ligne adulte et sa ligne enfant font un seul service,
// avec un seul voucher. Le regroupement est celui de la création elle-même (reservationsDepuisDocument), pour ne jamais diverger.
// Rend [{ cle, ligneIds, libelle, date, personnes, type }] ; `type` est le modèle de voucher (null : pas de voucher, une option par exemple).
// `pickup` et `dropoff` : les deux bouts du trajet, tels que la Booking confirmation les imprimerait sans saisie.
export function servicesCreation(lignes, { prestations = [], partenaires = [], trajets = [] } = {}) {
  const prets = lignes.map((l) => (l.titre || l.kind === "texte" ? l : { ...l, titre: l.libelle }));
  return reservationsDepuisDocument({ dossier_id: "", contenu: { lignes: prets } }, { uid: () => "" }).map(({ reservation: r }) => {
    const prestation = r.prestation_id ? prestations.find((p) => p.id === r.prestation_id) || null : null;
    const partenaire = r.partenaire_id ? partenaires.find((p) => p.id === r.partenaire_id) || null : null;
    const trajet = r.trajet_id ? trajets.find((t) => t.id === r.trajet_id) || null : null;
    return { cle: r.ligne_id, ligneIds: (r.details && r.details.lignes_ids) || [r.ligne_id], libelle: r.libelle, date: r.date_service || "", personnes: r.personnes, type: typeVoucher(r, prestation, partenaire), trajet: !!trajet, pickup: libelleClient(pickupDepuisLibelle(r, prestation, trajet)), dropoff: libelleClient(dropOffDepuisLibelle(r, prestation, trajet)) };
  });
}

// Les champs à remplir pour ce service, dans l'ordre de l'écran. Heure et lieu de pickup pour tous ; puis, pour Secret, les champs du modèle
// de voucher (les bébés seulement sur un billet de bateau, comme dans la fiche de la réservation) ; pour Taxi, ce que la Booking
// confirmation imprime (dépose, vol, bagages, sièges), et les passagers quand le prix est par véhicule (la ligne ne les compte pas).
export function champsCreation(service, { taxi = false } = {}) {
  if (taxi) {
    const sansPersonnes = !((service.personnes || {}).adultes || (service.personnes || {}).enfants);
    // Type de trajet : un retour au point de départ remplace le drop-off par un programme et une durée (16.11.2026).
    // La remarque imprimée (« REMARKS », `details.remarques`, 19.11.2026) : la même que celle que la réservation modifie ensuite.
    return ["heure", "lieu", "type_trajet", "drop_off", "programme_trajet", "duree_h", "vol", ...(sansPersonnes ? ["adultes", "enfants"] : []), "bagages", "sieges", "remarques"];
  }
  const t = service.type;
  return ["heure", "lieu", ...(t === null || t === "billet" ? ["bebes"] : []), ...champsVoucherDe(t, { trajet: !!service.trajet })];
}

// Garde les valeurs remplies : un champ vide ne s'écrit pas sur la réservation créée.
export const nonVides = (o = {}) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== null && v !== undefined && v !== 0 && !(typeof v === "string" && !v.trim())));

// Saisie vide d'un service : { heure, lieu, bebes, sieges, personnes, zonePickup, details }.
export const saisieVide = () => ({ heure: "", lieu: "", bebes: 0, sieges: 0, personnes: null, zonePickup: null, statut: "", details: {} });

// Taxi : le pickup et le drop-off se préremplissent avec les deux bouts du trajet (« Krabi Airport »), pour qu'Anaïs voie ce qui
// s'imprimera et n'ait qu'à préciser (« Krabi Airport, arrivals gate 3 »). Un champ déjà rempli reste tel quel, sauf s'il porte encore
// le bout d'un trajet choisi avant (autre offre). `lieu: false` : la demande donne déjà le lieu de pickup.
export function boutsDuTrajet(s, service, { lieu = true } = {}) {
  const auto = s.auto || {};
  const details = s.details || (s.details = {});
  if (lieu && service.pickup && (!(s.lieu || "").trim() || s.lieu === auto.lieu)) s.lieu = service.pickup;
  // Un retour au point de départ n'a pas de drop-off : le bout du trajet n'y est pas posé.
  // La dépose d'une carte de l'Assistant (`s.dropoffCarte`) reste, sauf si ce n'est qu'une zone que le bout du catalogue précise (relecture
  // de la PR 332 : « Ao Nang » pour « Ao Nang Beach ») ; un établissement l'emporte toujours.
  const zoneCarte = !!s.dropoffCarte && details.drop_off === s.dropoffCarte && zoneDuBout(details.drop_off, service.dropoff);
  if (service.dropoff && !estRetourDepartDetails(details) && (!(details.drop_off || "").trim() || details.drop_off === auto.drop_off || zoneCarte)) details.drop_off = service.dropoff;
  s.auto = { lieu: lieu ? service.pickup : auto.lieu, drop_off: service.dropoff };
  return s;
}

// Ce qu'une demande collée a déjà lu pour un service (entrée de `parService`) : heure, lieu, dépose, vol, bagages, sièges, bébés, zone de pickup,
// et les champs du voucher déjà remplis dans la fenêtre. Prérempli, et modifiable.
export function saisieDepuisDemande(entree = {}) {
  return {
    ...saisieVide(),
    heure: entree.heure || "",
    lieu: entree.lieu || "",
    bebes: Number(entree.bebes) || 0,
    sieges: Number(entree.sieges) || 0,
    personnes: entree.personnes || null,
    zonePickup: entree.zonePickup || null,
    details: nonVides({ drop_off: entree.dropoff || "", vol: entree.vol || "", bagages: entree.bagages ? String(entree.bagages) : "", ...(entree.details || {}) }),
  };
}

// Ce qui est déjà rempli, pour le résumé d'un bloc replié : « 08:30 · Lanta Sand Resort · Krabi Airport ».
// Un retour au point de départ : « 08:30 · Lanta Sand Resort · retour au départ, environ 3 h ».
export const resumeSaisie = (s = {}) => {
  const dt = s.details || {};
  const fin = estRetourDepartDetails(dt) ? [tr("retour au départ"), dureeFrancais(dt.duree_h)].filter(Boolean).join(", ") : (dt.drop_off || "").trim();
  return [s.heure, (s.lieu || "").trim(), fin].filter(Boolean).join(" · ");
};

// Bloc déplié au départ : toujours sur un grand écran ; sur téléphone, avec deux services ou plus, seulement celui ajouté en dernier.
export const blocOuvert = ({ telephone = false, nbServices = 1, service, dernier = null }) => !telephone || nbServices < 2 || (!!dernier && service.ligneIds.includes(dernier));

// Course hors catalogue : son libellé suit le pickup et le drop-off saisis, pour que la facture, le dossier et la fiduciaire disent le même
// trajet que la Booking confirmation. Rend le nouveau libellé, ou null s'il ne change pas (un des deux lieux vide : on garde l'ancien).
// Retour au point de départ : « Round trip from Lanta Sand Resort: Old Town tour », jamais « X → X ».
export function libelleCourseSuivi(ligne, saisie) {
  const p = (saisie.lieu || "").trim();
  const dt = saisie.details || {};
  const d = (dt.drop_off || "").trim();
  const retour = estRetourDepartDetails(dt);
  if (!p || (!retour && !d)) return null;
  const nouveau = retour ? libelleRetourDepart(p, dt.programme_trajet) : libelleTrajet(p, d);
  return nouveau === (ligne.titre || ligne.libelle) ? null : nouveau;
}

// La saisie d'un service, rangée sous l'identifiant d'une de ses lignes : retrouvée même si le regroupement change de première ligne.
export function saisieDuService(saisies, service) {
  const id = service.ligneIds.find((x) => saisies.has(x));
  if (id) return saisies.get(id);
  const s = saisieVide();
  saisies.set(service.cle, s);
  return s;
}

// Ce que creerDossierExcursions pose sur chaque réservation (`parService`).
export function parServiceCreation(services, saisies) {
  return services.map((sv) => {
    const s = saisies.get(sv.ligneIds.find((x) => saisies.has(x))) || saisieVide();
    return { ligneIds: sv.ligneIds, heure: s.heure || "", lieu: (s.lieu || "").trim(), bebes: Number(s.bebes) || 0, sieges: Number(s.sieges) || 0, personnes: s.personnes || null, zonePickup: s.zonePickup || null, ...(s.statut ? { statut: s.statut } : {}), details: nonVides(s.details) };
  });
}

// Avant de créer : le premier service en « retour au point de départ » sans programme ou avec une durée illisible.
// `parService` : la sortie de parServiceCreation (ou celle de la demande collée). Rend { index, ligneIds, champ, code } ou null.
// Sièges enfant ou bébé : 10 au plus, sans plafond silencieux (relecture de la PR 315). Au-delà, la création s'arrête sur le champ.
// Sièges par type (22.11.2026, sieges-calc.mjs) : enfant et bébé ensemble, 10 au plus. Un transfert dont la fiche montre les sièges
// (`siegesRequis`) avec au moins un enfant ou un bébé : child seat, baby seat ou « aucun siège », sinon la création s'arrête sur le champ.
export { SIEGES_MAX };
export function siegesIncomplets(parService = []) {
  for (const [index, x] of parService.entries()) {
    const s = siegesLus({ ...(x.details || {}), sieges: x.sieges });
    if (siegesTotal(s) > SIEGES_MAX) return { index, ligneIds: x.ligneIds || [], champ: "sieges", code: "e_sieges_max" };
    if (x.siegesRequis && siegesAChoisir({ enfants: (x.personnes || {}).enfants, bebes: x.bebes, sieges: s })) return { index, ligneIds: x.ligneIds || [], champ: "sieges", code: "e_sieges_choix" };
  }
  return null;
}
// La création complète (nouveau-excursions.mjs) : chaque service dont la fiche montre les sièges (transfert de Secret, toute course de Taxi)
// les exige avec un enfant ou un bébé ; ses personnes sont celles de la saisie, sinon celles des lignes du service.
export function avecSiegesRequis(services = [], parService = [], { taxi = false } = {}) {
  return parService.map((x, i) => {
    const sv = services[i] || {};
    return { ...x, personnes: x.personnes || sv.personnes || null, siegesRequis: champsCreation(sv, { taxi }).includes("sieges") };
  });
}
// Plus de sièges que d'enfants et de bébés : à vérifier (le nombre d'enfants peut être inconnu), jamais refusé.
export const siegesEnTrop = ({ sieges = 0, enfants = 0, bebes = 0 } = {}) => (Number(sieges) || 0) > (Number(enfants) || 0) + (Number(bebes) || 0);
export function trajetIncomplet(parService = []) {
  for (const [index, x] of parService.entries()) {
    const e = erreursTrajet(x.details || {});
    const champ = Object.keys(e)[0];
    if (champ) return { index, ligneIds: x.ligneIds || [], champ, code: e[champ] };
  }
  return null;
}

// Demande collée lue comme un retour au point de départ : la ligne du prix convenu, tapé à la main (aucune grille). Prix de la course, pas par
// personne (« par: veh ») : la quantité 1 n'est pas une personne, les adultes et enfants de la demande se posent sur la réservation.
// `ligne` : la ligne déjà faite, mise à jour (même identifiant) quand le prix, le lieu ou le programme changent.
export function ligneRetourDepart({ lieu = "", programme = "", prix, date = "", partenaireId = null }, ligne = null, { uid } = {}) {
  const base = ligne || ligneLibre({ libelle: "-", prix, qte: 1, partenaire_id: partenaireId, date }, uid ? { uid } : {});
  return Object.assign(base, { libelle: libelleRetourDepart(lieu, programme), unite: Number(prix), qte: 1, date_service: date || null, par: "veh" });
}

// Transfert privé hors catalogue lu par l'assistant (« Lanta Sand Resort → The Scene Cliff View Villas, Ao Nang ») : la ligne du prix tapé à la
// main. Prix de la course (« par: veh »), comme un retour au point de départ. `ligne` : la ligne déjà faite, mise à jour (même identifiant).
export function ligneTransfertPrive({ de = "", vers = "", prix, date = "", partenaireId = null }, ligne = null, { uid } = {}) {
  const base = ligne || ligneLibre({ libelle: "-", prix, qte: 1, partenaire_id: partenaireId, date }, uid ? { uid } : {});
  return Object.assign(base, { libelle: libelleTrajet(de || "?", vers || "?"), unite: Number(prix), qte: 1, date_service: date || null, par: "veh" });
}

// ---- Taxi : une course hors catalogue (pickup et drop-off saisis), comme l'écran « Nouveau voucher » de l'assistante ---------------------
// Le contrôle et le calcul sont ceux de voucher-rapide-calc.mjs ; seul le nom manque ici, il vient du client choisi dans l'écran.
export const erreursCourse = (v) => {
  const { nom, ...e } = erreursVoucher({ ...v, nom: "-" });
  return e;
};

// La ligne du prix interne de la course (payée au chauffeur) et la saisie de sa réservation, prête à modifier dans l'écran.
export function courseHorsCatalogue(v, { id, partenaireId = null }) {
  const x = donneesVoucher({ ...v, nom: "-" });
  const r = reservationVoucher(x);
  return {
    ligne: ligneVoucher(x, { id, partenaireId }),
    // Une course saisie à la main est déjà convenue avec le chauffeur (décision de Jérémy, 13.11.2026) : confirmée dès sa création.
    saisie: { ...saisieVide(), heure: r.heure, lieu: r.lieu, sieges: r.sieges, personnes: r.personnes, statut: r.statut, details: nonVides({ drop_off: r.dropoff, vol: r.vol, bagages: r.bagages, ...(r.details || {}) }) },
  };
}

// ---- Fiche de création (views/demande.mjs) : la saisie de départ d'un service et ce qui part sur sa réservation ----------------------
// Sorties de la fiche pour être testées de bout en bout (carte « dossier » de l'Assistant jusqu'à la réservation, 23.11.2026 : un service
// du catalogue venu d'une carte perdait sa dépose).

// Un service lu (par règles, par l'Assistant, ou une carte « dossier » par propositionVersDemande) tel que la fiche le crée (nouveauService).
export const serviceDeLecture = (t = {}) => ({ phrase: t.phrase, date: t.date, heure: t.heure, adultes: t.adultes, enfants: t.enfants, vehicule: t.vehicule || "", mode: t.mode || "", copie: !!t.copie, retourDepart: t.retourDepart || null, transfertLibre: t.transfertLibre || null, prixLibre: t.prixLibre ?? null, prixOrigine: t.prixOrigine || null, hotelDepart: t.hotelDepart || "", depart: t.depart || "", vol: t.vol || "", dropoff: t.dropoff || "", sieges: Number(t.sieges) || 0, voucherCarte: t.voucherCarte || null, siegesRequis: t.siegesRequis === true, ...(t.offresIA ? { offresIA: t.offresIA, confiance: t.confiance } : {}) });

// La saisie de départ d'un service : ce que la demande ou la carte dit déjà pour le voucher, modifiable dans la fenêtre.
// `d` : la demande lue ; `excursions` : Secret ou Taxi (sièges) ; `sd` : les sièges du formulaire du site (siegesDemande).
// `sv.dropoff` : la dépose de la carte de l'Assistant (« vers », sans lien), pour un service du catalogue comme pour un transfert libre.
export function saisieInitiale(sv = {}, { d = {}, excursions = false, sd = { sieges: 0, sieges_bebe: 0 } } = {}) {
  const site = d.type === "transfer";
  // Les sièges du service (carte de l'Assistant, 22.11.2026) passent avant ceux du formulaire du site. Jamais chez ZTP.
  const carteSieges = Number(sv.sieges) > 0 || !!(sv.voucherCarte && (sv.voucherCarte.sieges_bebe || sv.voucherCarte.sans_siege));
  const saisie = {
    ...saisieVide(),
    bebes: d.bebes || 0,
    sieges: excursions ? Number(sv.sieges) || (carteSieges ? 0 : sd.sieges) : 0,
    details: { ...(site ? nonVides({ drop_off: d.dropoff || "", vol: d.vol || "" }) : {}), ...(excursions ? nonVides({ bagages: d.bagages ? String(d.bagages) : "", sieges_bebe: carteSieges ? 0 : sd.sieges_bebe }) : site ? nonVides({ bagages: d.bagages ? String(d.bagages) : "" }) : {}) },
  };
  // Trajet venu de « Prix et horaires », ou lieu de pickup de la carte : le pickup se fait là.
  if (sv.hotelDepart) saisie.lieu = sv.hotelDepart;
  // Numéro de vol et dépose lus par l'Assistant (carte « dossier ») : dans le bloc du voucher, comme ceux du formulaire du site.
  if (sv.vol) saisie.details = { ...saisie.details, vol: sv.vol };
  if (sv.dropoff) (saisie.details = { ...saisie.details, drop_off: sv.dropoff }), (saisie.dropoffCarte = sv.dropoff);
  // Sièges bébé, « aucun siège », bagages et remarque du voucher de la carte (22.11.2026) : sur le voucher. Les sièges jamais chez ZTP.
  if (sv.voucherCarte) {
    const { sieges_bebe, sans_siege, ...autres } = sv.voucherCarte;
    saisie.details = { ...saisie.details, ...autres, ...(excursions ? nonVides({ sieges_bebe: sieges_bebe || 0, sans_siege: sans_siege === true ? true : "" }) : {}) };
  }
  if (sv.transfertLibre) {
    saisie.lieu = sv.transfertLibre.de || d.hotel || "";
    saisie.details = { ...nonVides({ ...saisie.details, drop_off: sv.transfertLibre.vers || sv.dropoff || "" }) };
    saisie.ouvert = true;
  }
  if (sv.retourDepart) {
    saisie.details = { ...nonVides({ ...saisie.details, drop_off: "" }), type_trajet: RETOUR_DEPART, ...nonVides({ programme_trajet: sv.retourDepart.programme || "", duree_h: sv.retourDepart.duree || "" }) };
    saisie.lieu = (site && d.pickup) || d.hotel || "";
    saisie.ouvert = true;
  }
  return saisie;
}

// L'entrée `parService` d'un service (creerDossierExcursions) depuis sa saisie : les champs du voucher remplis l'emportent, un lieu vide
// reste `lieuFinal` (celui de la demande). `garderVol` : faux pour une excursion hors Taxi (un vol ne reste que sur un transfert).
// `prixClient` : un prix repris du client sans correction de Nani (revue de la PR 307), gardé dans details.prix_origine.
// `lieuSecours` : le départ lu sur la carte (« de ») d'un service du catalogue, posé seulement si la réservation n'a aucun lieu après la
// création (ni celui de la carte, ni l'hôtel du client, ni le bout du catalogue chez Taxi ; relecture de la PR 332).
export function entreeParService(sv = {}, v = saisieVide(), { lieuFinal = "", garderVol = true, prixClient = false, siegesRequis = false } = {}) {
  const details = nonVides(v.details);
  if (prixClient) details.prix_origine = "client_non_corrige";
  if (details.vol && !garderVol) delete details.vol;
  const secours = !sv.transfertLibre && !sv.retourDepart && sv.depart ? { lieuSecours: sv.depart } : {};
  return { heure: sv.heure || "", lieu: (v.lieu || "").trim() || lieuFinal, ...secours, bebes: v.bebes, personnes: { adultes: sv.adultes, enfants: sv.enfants }, sieges: v.sieges, details, zonePickup: sv.zonePickup || null, siegesRequis };
}

// L'hôtel de la fiche client (« Hotel Sunset, Room 12 » → « Hotel Sunset »), pour l'entreprise `entiteId`. Une fiche partagée par une autre
// entreprise (ZTP) porte une adresse postale : pas d'hôtel.
export const hotelDuClient = (c, entiteId) => (c && !adresseEstHotel(c, entiteId) ? "" : ((c && c.adresse) || "").split("\n")[0].replace(/,?\s*Room\s+\S+\s*$/i, "").trim());
// Un transfert : une demande de trajet du site, un trajet du catalogue, ou une prestation de la famille « transfert ».
export const estTransfertOffre = (d = {}, offre = null) => d.type === "transfer" || !!(offre && (offre.genre === "trajet" || (offre.source && offre.source.famille === "transfert")));
// L'entrée `parService` d'un service de la fiche de création (views/demande.mjs, preparer) : heure, lieu de pickup, dépose, vol, bagages.
// Un trajet du site donne ses deux bouts. `d` : la demande lue ; `client` : la fiche retenue (ou null) ; `taxi` : modeTaxi() ; `entiteId` :
// l'entreprise active (hotelDuClient).
export function reservationDuService(sv = {}, offre = null, { d = {}, client = null, taxi = false, entiteId = null } = {}) {
  const lieu = d.type === "transfer" ? d.pickup || "" : offre && !estTransfertOffre(d, offre) && d.hotel && d.hotel !== hotelDuClient(client, entiteId) ? d.hotel : "";
  // Une zone de pickup choisie veut dire un pickup à l'hôtel : le lieu est l'hôtel, ce qui permet de retrouver la zone au prochain séjour.
  const hotelPickup = sv.hotelDepart || d.hotel;
  const lieuFinal = lieu || (sv.zonePickup && hotelPickup ? hotelPickup : "");
  // Un numéro de vol ne reste que sur un transfert : une offre changée pour une excursion ne le garde pas caché.
  // Un prix repris du client sans correction de Nani (revue de la PR 307) : la réservation le garde (details.prix_origine).
  // `siegesRequis` : un transfert dont la fiche montre les sièges (Taxi, Secret) : avec un enfant ou un bébé, le choix est obligatoire.
  return entreeParService(sv, sv.saisie || saisieVide(), {
    lieuFinal,
    garderVol: taxi || !!sv.transfertLibre || !!sv.retourDepart || !offre || estTransfertOffre(d, offre),
    prixClient: !!((offre && offre.prixCarte !== undefined && offre.prixOrigine === "client_non_corrige") || (sv.transfertLibre && sv.prixOrigine === "client_non_corrige")),
    siegesRequis: !!sv.siegesVisibles,
  });
}

// Les deux bouts du trajet du catalogue d'un service ({ libelle, prestation_id, trajet_id }), tels que la Booking confirmation les imprimerait
// sans saisie : { pickup, dropoff } (servicesCreation fait de même pour une ligne de facture).
export function boutsDuService(r = {}, { prestations = [], trajets = [] } = {}) {
  const prestation = r.prestation_id ? prestations.find((p) => p.id === r.prestation_id) || null : null;
  const trajet = r.trajet_id ? trajets.find((t) => t.id === r.trajet_id) || null : null;
  const base = { libelle: r.libelle || "", details: r.details || {} };
  return { pickup: libelleClient(pickupDepuisLibelle(base, prestation, trajet)), dropoff: libelleClient(dropOffDepuisLibelle(base, prestation, trajet)) };
}

// Ce que creerDossierExcursions écrit sur une réservation qui vient d'être créée (`r`), depuis l'entrée `parService` de son service :
// heure, lieu de pickup, dépose, vol, bagages, sièges, bébés, zone de pickup et champs du voucher. Rend le patch (vide : rien à écrire).
export function champsReservation(r, { heure = "", lieu = "", lieuSecours = "", bebes = 0, dropoff = "", vol = "", bagages = 0, sieges = 0, personnes = null, zonePickup = null, statut = "", details: saisis = {} } = {}) {
  // `zonePickup` : la zone de l'hôtel choisie sur la grille du partenaire, gardée pour proposer la même zone au prochain séjour dans cet hôtel.
  const details = { ...nonVides(saisis), ...(dropoff ? { drop_off: dropoff } : {}), ...(vol ? { vol } : {}), ...(bagages ? { bagages: String(bagages) } : {}), ...(sieges ? { sieges: Number(sieges) } : {}), ...(zonePickup ? { pickup_zone: zonePickup } : {}) };
  // Des personnes reprises du dossier (Adultes et Enfants du Nouveau dossier) cèdent la place à celles que le service donne lui-même.
  const repris = !!(r.details && r.details.personnes_du_dossier);
  const dejaDesGens = !repris && ((r.personnes || {}).adultes || (r.personnes || {}).enfants);
  const propres = !!personnes && !dejaDesGens;
  const detailsBase = propres && repris ? Object.fromEntries(Object.entries(r.details || {}).filter(([k]) => k !== "personnes_du_dossier")) : r.details || {};
  return {
    ...(statut ? { statut } : {}),
    ...(heure ? { heure_pickup: heure } : {}),
    ...(lieu ? { lieu_pickup: lieu } : lieuSecours && !String(r.lieu_pickup || "").trim() ? { lieu_pickup: lieuSecours } : {}),
    ...(bebes || personnes ? { personnes: { ...(r.personnes || {}), ...(propres ? { adultes: personnes.adultes, enfants: personnes.enfants } : {}), ...(bebes ? { bebes } : {}) } } : {}),
    ...(Object.keys(details).length || detailsBase !== (r.details || {}) ? { details: { ...detailsBase, ...details } } : {}),
  };
}
