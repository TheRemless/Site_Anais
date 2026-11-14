// Création d'un dossier de Secret ou de Taxi avec tout ce que le voucher dit, service par service (13.11.2026) : la logique pure, sans DOM,
// testée dans tests/gestion-creation-voucher.test.js. Avant, il fallait créer le dossier, y revenir et éditer chaque réservation
// (heure et lieu de pickup, drop-off, vol, bagages, type de tour, remarques…).
import { reservationsDepuisDocument, typeVoucher, champsVoucherDe, pickupDepuisLibelle, dropOffDepuisLibelle } from "./operations-calc.mjs";
import { libelleClient } from "./partenaires-calc.mjs";
import { erreursVoucher, donneesVoucher, ligneVoucher, reservationVoucher, libelleTrajet } from "./voucher-rapide-calc.mjs";

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
    return ["heure", "lieu", "drop_off", "vol", ...(sansPersonnes ? ["adultes", "enfants"] : []), "bagages", "sieges"];
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
  if (service.dropoff && (!(details.drop_off || "").trim() || details.drop_off === auto.drop_off)) details.drop_off = service.dropoff;
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
export const resumeSaisie = (s = {}) => [s.heure, (s.lieu || "").trim(), ((s.details || {}).drop_off || "").trim()].filter(Boolean).join(" · ");

// Bloc déplié au départ : toujours sur un grand écran ; sur téléphone, avec deux services ou plus, seulement celui ajouté en dernier.
export const blocOuvert = ({ telephone = false, nbServices = 1, service, dernier = null }) => !telephone || nbServices < 2 || (!!dernier && service.ligneIds.includes(dernier));

// Course hors catalogue : son libellé suit le pickup et le drop-off saisis, pour que la facture, le dossier et la fiduciaire disent le même
// trajet que la Booking confirmation. Rend le nouveau libellé, ou null s'il ne change pas (un des deux lieux vide : on garde l'ancien).
export function libelleCourseSuivi(ligne, saisie) {
  const p = (saisie.lieu || "").trim();
  const d = ((saisie.details || {}).drop_off || "").trim();
  if (!p || !d) return null;
  const nouveau = libelleTrajet(p, d);
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
    saisie: { ...saisieVide(), heure: r.heure, lieu: r.lieu, sieges: r.sieges, personnes: r.personnes, statut: r.statut, details: nonVides({ drop_off: r.dropoff, vol: r.vol, bagages: r.bagages }) },
  };
}
