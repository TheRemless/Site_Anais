// Point du soir (22.11.2026, demande de Jérémy) : une section de l'accueil « Aujourd'hui », visible de 17h à 6h à l'heure de
// l'organisation (Bangkok), et l'écran #/soir ouvert depuis le menu à toute heure. Rien n'y part tout seul et rien ne sonne sur le
// téléphone : la notification de 18h (« N services demain ») et le rappel H-1 restent ceux de la fonction « rappels », intacte.
// Trois listes :
//   - les pickups de demain (et, entre minuit et 6h, ceux de la matinée qui commence), avec le message « rappel » de l'entreprise
//     (Réglages > Messages) rempli et prêt à partir ; un service sans heure lisible, sans lieu ou sans modèle est signalé, sans message ;
//   - les vouchers (Booking confirmations chez Taxi) pas encore envoyés, ou modifiés depuis l'envoi, pour les mêmes jours et le suivant ;
//   - les clients WhatsApp sans réponse depuis plus de 12 heures (Secret et Taxi seulement : ZTP n'a pas la boîte).
// Un client ne reçoit jamais deux rappels : le point du soir et le bouton WhatsApp de la section « Demain » partagent la même trace
// (details.pickup_annonce). Logique pure, testée par tests/gestion-point-soir.test.js. L'écran est views/point-soir.mjs.
import { attenteClient, propositionCourante, lienWhatsApp, FENETRE_MS } from "./whatsapp-calc.mjs";
import { contactPersonnel } from "./agent-whatsapp-lecture.mjs";
import { resteBloque } from "./agent-calc.mjs";
import { e164 } from "./whatsapp-voucher-calc.mjs";
import { estRetourDepart } from "./trajet-calc.mjs";
import { nomsInterdits as nomsCommuns } from "./noms-interdits-calc.mjs";
import { estFraisDeParc, hotelEtChambre, separerChambreLigne, remplirGabarit, gabaritsPropose } from "./operations-calc.mjs";

// ---- Heure ---------------------------------------------------------------------------------------------------------------------------
// La section entre dans l'accueil à 17h, une heure avant la notification « N services demain » de la fonction « rappels », et y reste
// jusqu'à 6h : entre minuit et 6h, la matinée qui commence compte encore (revue de la PR 308, point 10).
export const HEURE_POINT_SOIR = 17;
export const FIN_NUIT = 6;
export const pointSoirVisible = (heureLocale) => {
  const h = Number(heureLocale);
  return heureLocale !== null && heureLocale !== "" && Number.isFinite(h) && (h >= HEURE_POINT_SOIR || h < FIN_NUIT);
};

// Une heure saisie librement (« 8h », « 9.30 », « 09:30 », « 14h05 ») en « HH:MM », ou "" si elle ne se lit pas.
export function heureNormalisee(heure) {
  const m = /^(\d{1,2})(?:\s*[:hH.]\s*(\d{2})?)?\s*$/.exec(String(heure || "").trim());
  if (!m) return "";
  const h = Number(m[1]);
  const mi = Number(m[2] || 0);
  if (h > 23 || mi > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}
// Minutes depuis minuit, pour trier en vraies heures (« 8h » avant « 10:00 »). Sans heure lisible : à la fin.
export const minutesDe = (heure) => {
  const n = heureNormalisee(heure);
  return n ? Number(n.slice(0, 2)) * 60 + Number(n.slice(3)) : 24 * 60;
};

// ---- Pickups -------------------------------------------------------------------------------------------------------------------------
// Les jours que couvre le point : demain ; entre minuit et 6h, aussi aujourd'hui (la matinée qui commence).
export const joursDuPoint = (ajd, demain, heureLocale) => (Number(heureLocale) < FIN_NUIT ? [ajd, demain] : [demain]);

// Les services des `jours`, hors annulés, hors dossiers annulés, hors frais de parc (une somme à payer, pas un service qui part). Ceux
// d'aujourd'hui dont l'heure est passée (`minuteMaintenant`) n'y sont pas. Triés par jour puis en vraies heures ; sans heure, à la fin.
export function pickupsDuPoint(reservations = [], jours = [], { ecartes = new Set(), ajd = "", minuteMaintenant = 0 } = {}) {
  const voulus = new Set(jours);
  return (reservations || [])
    .filter((r) => r && voulus.has(r.date_service) && r.statut !== "annule" && !ecartes.has(r.dossier_id) && !estFraisDeParc(r))
    .filter((r) => r.date_service !== ajd || !heureNormalisee(r.heure_pickup) || minutesDe(r.heure_pickup) >= minuteMaintenant)
    .sort((a, b) => a.date_service.localeCompare(b.date_service) || minutesDe(a.heure_pickup) - minutesDe(b.heure_pickup) || String(a.libelle || "").localeCompare(String(b.libelle || "")));
}

// Le lieu de pickup du message (revue de la PR 308, points 1 et 2) :
//   - celui saisi sur la réservation, sans la chambre ;
//   - sinon, en mode excursions (Secret) seulement, l'hôtel de la fiche du client (hotelEtChambre : jamais l'adresse d'une fiche partagée
//     par une autre entreprise) ;
//   - chez Taxi, seulement pour un aller-retour depuis l'hôtel (« Round trip from my place », type_trajet « retour_depart ») : le client part
//     de son hôtel et y revient (précision de Jérémy, 22.11.2026) ;
//   - sinon rien : à l'arrivée (aéroport → hôtel), l'hôtel du client est la dépose, pas la prise en charge ; chez ZTP l'adresse est postale.
//     Le service est signalé, « lieu à saisir ».
export function lieuPickup(reservation = {}, client = {}, mode = "excursions") {
  const saisi = String((reservation && reservation.lieu_pickup) || "").trim();
  if (saisi) return separerChambreLigne(saisi).hotel;
  if (mode !== "excursions" && !(mode === "taxi" && estRetourDepart(reservation))) return "";
  return String(hotelEtChambre(client || {}, { ...(reservation || {}), lieu_pickup: "" }).hotel || "").trim();
}

// Le modèle de l'entreprise (Réglages > Messages, sinon son modèle par défaut) pour ce pickup : « rappel » pour demain ; le matin même,
// « confirmation » (même règle que le bouton WhatsApp de l'accueil, cleMessageClient). Taxi n'a qu'un rappel, daté : toujours « rappel ».
// Rend le corps du modèle, ou "".
export function modeleDuPickup({ stockes = [], defauts = [], langue = "en", mode = "excursions", jour = "", demain = "" } = {}) {
  const cle = mode === "taxi" || jour === demain ? "rappel" : "confirmation";
  const { choisi } = gabaritsPropose(stockes, defauts, { pour: "client", langue, cle });
  return (choisi && choisi.corps) || "";
}

// Le message au client pour un pickup. `vars` : les variables de la réservation (operations-calc.mjs, variablesMessage : dépose, retour
// au point de départ, date, prestation…). L'heure et le lieu sont remplacés par ceux du point du soir (heure normalisée, lieu selon le
// mode). Aucun nom de partenaire ne part : s'il y en a un dans le texte (lieu, service, dépose, modèle), pas de message ; Nani l'écrit
// elle-même (vider le service laisserait une phrase cassée dans le modèle).
// Rend { texte } ou { texte: null, raison } : « heure », « lieu », « modele », « nom_partenaire ».
export function messagePickup({ reservation: r = {}, client = {}, mode = "excursions", langue = "en", modele = "", vars = {}, noms = [] } = {}) {
  const heure = heureNormalisee(r.heure_pickup);
  if (!heure) return { texte: null, raison: "heure" };
  const lieu = lieuPickup(r, client, mode);
  if (!lieu) return { texte: null, raison: "lieu" };
  if (resteBloque(lieu, { noms }).length) return { texte: null, raison: "nom_partenaire" };
  if (!String(modele || "").trim()) return { texte: null, raison: "modele" };
  // Une variable du modèle restée vide (dépose, service…) laisserait une phrase cassée : le service est signalé, avec ce qui manque.
  const remplies = { ...vars, heure, hotel: lieu };
  const manque = [...new Set([...String(modele).matchAll(/\{(\w+)\}/g)].map((x) => x[1]))].filter((k) => k in remplies && !["a_heure", "telephone", "partenaire", "contact"].includes(k) && !String(remplies[k] ?? "").trim());
  if (manque.length) return { texte: null, raison: "variables", manque };
  const texte = remplirGabarit(modele, { ...vars, partenaire: "", contact: "", heure, a_heure: `${langue === "fr" ? " à " : " at "}${heure}`, hotel: lieu });
  if (resteBloque(texte, { noms }).length) return { texte: null, raison: "nom_partenaire" };
  return { texte };
}

// ---- Envoi ---------------------------------------------------------------------------------------------------------------------------
// Le numéro du client en « +… », même règle que l'envoi du voucher (whatsapp-voucher-calc.mjs, e164) : seulement un numéro écrit avec son
// indicatif (« +41… » ou « 0041… »). « 79 123 45 67 » ou « 079… » ne sont jamais devinés (normaliserTelephone y lirait +7, la Russie).
export const numeroClient = (tel) => e164(tel) || "";

// Comment le message part, d'un geste :
//   - « direct » : la conversation WhatsApp du client existe, Nani peut y écrire et le client a écrit il y a moins de 24 h. Le message
//     part par whatsapp-envoi (Telnyx), le même chemin que les réponses et les vouchers. Jamais un modèle Meta payant ;
//   - « lien » : sinon, un lien wa.me ouvre la conversation sur le téléphone de Nani avec le message déjà écrit ;
//   - { genre: null, raison: "numero" } : le numéro est absent ou sans indicatif, à corriger sur la fiche.
// `fenetre` : { ouverte } d'après le dernier message du client, null tant qu'il n'est pas lu.
export function moyenEnvoi({ conversation = null, fenetre = null, telephone = "", texte = "" } = {}) {
  if (!String(texte || "").trim()) return null;
  if (conversation && fenetre && fenetre.ouverte) return { genre: "direct", conversation_id: conversation.id };
  const n = numeroClient(conversation && conversation.telephone ? conversation.telephone : telephone);
  const lien = n ? lienWhatsApp(n, texte) : null;
  return lien ? { genre: "lien", lien } : { genre: null, raison: "numero" };
}

// La fenêtre de 24 h d'après le dernier message du client (une seule ligne lue : whatsappDernierEntrant). null s'il n'a jamais écrit.
export function fenetreDepuis(dernierEntrant, maintenant = Date.now()) {
  const t = Date.parse(dernierEntrant || "");
  return Number.isFinite(t) ? { ouverte: t + FENETRE_MS > maintenant } : { ouverte: false };
}

// La trace sur la réservation (details.pickup_annonce), partagée avec le bouton WhatsApp de la section « Demain » de l'accueil :
//   - « direct » : parti par la conversation ; « lien » : WhatsApp ouvert avec le texte ;
//   - « incertain » : résultat inconnu (délai dépassé) ou trace pas écrite après un envoi ; le bouton reste bloqué.
// Elle n'efface rien d'autre.
const PARS = ["direct", "lien", "incertain"];
export const detailsAvecAnnonce = (details, { le, par }) => ({ ...(details || {}), pickup_annonce: { le, par: PARS.includes(par) ? par : "lien" } });
export const annonceDe = (r) => {
  const a = r && r.details && r.details.pickup_annonce;
  return a && typeof a.le === "string" ? a : null;
};
// Ce que l'écran fait de la trace : `bloque` (incertain : le bouton d'envoi reste éteint, seul « Renvoyer quand même » demande une
// confirmation explicite) et `aConfirmer` (déjà parti ou ouvert : tout nouvel envoi se confirme).
export function etatAnnonce(a) {
  if (!a) return { bloque: false, aConfirmer: false };
  return { bloque: a.par === "incertain", aConfirmer: true };
}

// ---- Vouchers et confirmations à envoyer ----------------------------------------------------------------------------------------------
// `vouchers` : ceux des dossiers (views/voucher.mjs, vouchersDuDossier), chacun { reservation, envoi: { le, modifie } }. Restent ceux des
// `jours` jamais envoyés au client ou modifiés depuis l'envoi, triés par jour puis en vraies heures.
export function envoisAFaire(vouchers = [], jours = []) {
  const voulus = new Set(jours);
  return (vouchers || [])
    .filter((x) => x && x.reservation && voulus.has(x.reservation.date_service) && x.reservation.statut !== "annule" && (!x.envoi || !x.envoi.le || x.envoi.modifie))
    .sort((a, b) => a.reservation.date_service.localeCompare(b.reservation.date_service) || minutesDe(a.reservation.heure_pickup) - minutesDe(b.reservation.heure_pickup));
}

// ---- Clients WhatsApp sans réponse ----------------------------------------------------------------------------------------------------
// Depuis plus de 12 heures, Nani n'a pas répondu au premier message resté sans réponse (attend_depuis, migration 65 ; même règle que la
// liste WhatsApp, attenteClient : un « merci » que le tri a vu sans réponse à faire ne compte pas). Seulement les clients : un contact
// réglé sur « Contact personnel », typé partenaire, chauffeur, hôtel ou apporteur, ou relié à une fiche partenaire (partenaire_id, même
// sans type) n'y est pas. Dans l'entreprise ouverte, plus les conversations pas encore rangées (à trier). Les plus anciennes d'abord.
export const ATTENTE_SOIR_H = 12;
export function sansReponse({ conversations = [], propositions = [], entiteId = null, maintenant = Date.now(), heures = ATTENTE_SOIR_H } = {}) {
  const seuil = heures * 60;
  const sortie = [];
  for (const c of conversations || []) {
    if (!c || !c.id || contactPersonnel(c) || estContactPartenaire(c)) continue;
    if (c.entite_id && c.entite_id !== entiteId) continue;
    const a = attenteClient(c, propositionCourante(propositions, c.id), maintenant);
    if (!a || a.minutes < seuil) continue;
    sortie.push({ conversation: c, minutes: a.minutes, attente: a.texte, aTrier: !c.entite_id });
  }
  return sortie.sort((x, y) => y.minutes - x.minutes);
}

// Une conversation de partenaire : typée autrement que « client », ou reliée à une fiche partenaire même sans type (revue de la PR 308,
// point 9). Même règle partout : liste des clients sans réponse et noms interdits.
export const estContactPartenaire = (c) => !!c && ((!!c.type_contact && c.type_contact !== "client") || !!c.partenaire_id);

// Les noms qui ne partent jamais vers un client : fiches partenaires (plus de deux lettres, comme nomsABloquer de la fonction agent) et
// conversations de partenaires (comme nomsContactsTypes de whatsapp-envoi). Le lien wa.me ne passe par aucun contrôle du serveur.
// Fonction commune avec « Proposer une excursion » (noms-interdits-calc.mjs) ; ici sans noms courts ni fiche du client.
export const nomsInterdits = ({ partenaires = [], conversations = [] } = {}) => nomsCommuns({ partenaires, conversations, contactInterdit: estContactPartenaire });
