// Point du soir (22.11.2026, demande de Jérémy) : une section de l'accueil « Aujourd'hui », visible à partir de 17h à l'heure de
// l'organisation (Bangkok), et l'écran #/soir ouvert depuis le menu à toute heure. Rien n'y part tout seul et rien ne sonne sur le
// téléphone : la notification de 18h (« N services demain ») et le rappel H-1 restent ceux de la fonction « rappels », intacte.
// Trois listes :
//   - les pickups de demain (heure, lieu, client, service), avec un message court au client, prêt à partir ; sans heure, le service est
//     signalé et aucun message n'est préparé ;
//   - les vouchers (Booking confirmations chez Taxi) pas encore envoyés, ou modifiés depuis l'envoi, pour demain et après-demain ;
//   - les clients WhatsApp sans réponse depuis plus de 12 heures (Secret et Taxi seulement : ZTP n'a pas la boîte).
// Logique pure, testée par tests/gestion-point-soir.test.js. L'écran est views/point-soir.mjs.
import { attenteClient, propositionCourante, lienWhatsApp, FENETRE_MS } from "./whatsapp-calc.mjs";
import { contactPersonnel } from "./agent-whatsapp-lecture.mjs";
import { resteBloque } from "./agent-calc.mjs";
import { libelleClient } from "./partenaires-calc.mjs";
import { estFraisDeParc, hotelEtChambre } from "./operations-calc.mjs";

// ---- Heure ---------------------------------------------------------------------------------------------------------------------------
// La section entre dans l'accueil à 17h, une heure avant la notification « N services demain » de la fonction « rappels ».
export const HEURE_POINT_SOIR = 17;
export const pointSoirVisible = (heureLocale) => Number.isFinite(Number(heureLocale)) && Number(heureLocale) >= HEURE_POINT_SOIR;

// ---- Pickups de demain ---------------------------------------------------------------------------------------------------------------
// Les services de `jour`, hors annulés, hors dossiers annulés, hors frais de parc (une somme à payer, pas un service qui part), triés
// par heure de pickup puis libellé. Un service sans heure passe en dernier : il est signalé.
export function pickupsDuJour(reservations = [], jour, { ecartes = new Set() } = {}) {
  return (reservations || [])
    .filter((r) => r && r.date_service === jour && r.statut !== "annule" && !ecartes.has(r.dossier_id) && !estFraisDeParc(r))
    .sort((a, b) => (a.heure_pickup || "99").localeCompare(b.heure_pickup || "99") || String(a.libelle || "").localeCompare(String(b.libelle || "")));
}

// « 09:30 » s'écrit « 9:30 » en anglais et « 9h30 » en français. Une heure illisible reste telle qu'elle a été saisie.
export function heureMessage(heure, langue = "en") {
  const m = /^(\d{1,2})[:hH.](\d{2})$/.exec(String(heure || "").trim());
  if (!m) return String(heure || "").trim();
  const h = String(Number(m[1]));
  return langue === "fr" ? `${h}h${m[2]}` : `${h}:${m[2]}`;
}

// Le lieu de pickup du message : celui de la réservation, sinon l'hôtel de la fiche du client (même règle que les messages et vouchers,
// hotelEtChambre : jamais l'adresse d'une fiche partagée par une autre entreprise). Sans chambre : le client la connaît.
export const lieuPickup = (reservation = {}, client = {}) => String(hotelEtChambre(client || {}, reservation || {}).hotel || "").trim();

// Le message au client pour un pickup de demain. `mode` : « taxi », « excursions » (Secret) ou autre (ZTP, en français, vouvoiement).
// Pas de signature : Nani écrit dans une conversation (fiche de voix, 19.11.2026). Aucun prix, aucun nom de partenaire :
//   - `noms` : les noms des partenaires et des contacts WhatsApp typés (partenaire, chauffeur, hôtel, apporteur), comme whatsapp-envoi. Un lieu qui en contient un (« … Pier » d'un partenaire) ne part pas : pas de
//     message, la raison « lieu_partenaire » ; un libellé de service qui en contient un (« par Mr. X ») est retiré du message ;
//   - sans heure (« heure ») ou sans lieu (« lieu »), pas de message non plus : le service est signalé.
// Rend { texte } ou { texte: null, raison }.
export function messagePickup({ reservation: r = {}, client = {}, langue = "en", mode = "excursions", noms = [] } = {}) {
  if (!String(r.heure_pickup || "").trim()) return { texte: null, raison: "heure" };
  const lieu = lieuPickup(r, client);
  if (!lieu) return { texte: null, raison: "lieu" };
  if (resteBloque(lieu, { noms }).length) return { texte: null, raison: "lieu_partenaire" };
  const heure = heureMessage(r.heure_pickup, langue);
  const prenom = String((client && (client.prenom || client.nom)) || "").trim();
  const brut = langue === "fr" ? String(r.libelle || "").trim() : libelleClient(r.libelle || "");
  const service = brut && !resteBloque(brut, { noms }).length ? brut : "";
  if (langue === "fr") {
    const bonjour = prenom ? `Bonjour ${prenom},` : "Bonjour,";
    return { texte: `${bonjour} ${service ? `demain, ${service} : ` : "pour demain : "}prise en charge à ${heure} à ${lieu}.` };
  }
  const hello = prenom ? `Hello ${prenom},` : "Hello,";
  if (mode === "taxi") {
    const dropoff = libelleClient(((r.details || {}).drop_off) || "");
    const vers = dropoff && !resteBloque(dropoff, { noms }).length ? `, drop-off at ${dropoff}` : "";
    return { texte: `${hello} your transfer tomorrow: pickup at ${heure} at ${lieu}${vers}.` };
  }
  return { texte: `${hello} ${service ? `see you tomorrow for ${service}. Pickup` : "see you tomorrow. Pickup"} at ${heure} at ${lieu}.` };
}

// Comment le message part, d'un geste :
//   - « direct » : la conversation WhatsApp du client existe, Nani peut y écrire et le client a écrit il y a moins de 24 h. Le message
//     part par whatsapp-envoi (Telnyx), le même chemin que les réponses et les vouchers. Jamais un modèle Meta payant ;
//   - « lien » : sinon, un lien wa.me ouvre la conversation sur le téléphone de Nani avec le message déjà écrit ;
//   - null : ni conversation ni numéro de téléphone utilisable.
// `fenetre` : { ouverte } d'après les messages de la conversation (whatsapp-calc.mjs, fenetre), null tant qu'ils ne sont pas lus.
export function moyenEnvoi({ conversation = null, fenetre = null, telephone = "", texte = "" } = {}) {
  if (!String(texte || "").trim()) return null;
  if (conversation && fenetre && fenetre.ouverte) return { genre: "direct", conversation_id: conversation.id };
  const tel = conversation && conversation.telephone ? conversation.telephone : telephone;
  const lien = lienWhatsApp(tel, texte);
  return lien ? { genre: "lien", lien } : null;
}

// La fenêtre de 24 h sans lire les messages, quand la conversation le dit déjà : son dernier message est du client. Sinon null (il faut
// lire les messages pour trouver le dernier message du client).
export function fenetreDepuisConversation(conv, maintenant = Date.now()) {
  if (!conv || conv.dernier_sens !== "entrant" || !conv.dernier_message_le) return null;
  const t = Date.parse(conv.dernier_message_le);
  if (!Number.isFinite(t)) return null;
  return { ouverte: t + FENETRE_MS > maintenant };
}

// La trace sur la réservation (details.pickup_annonce) : quand et comment le message est parti ou a été ouvert. Elle n'efface rien d'autre.
export const detailsAvecAnnonce = (details, { le, par }) => ({ ...(details || {}), pickup_annonce: { le, par: par === "direct" ? "direct" : "lien" } });
export const annonceDe = (r) => {
  const a = r && r.details && r.details.pickup_annonce;
  return a && typeof a.le === "string" ? a : null;
};

// ---- Vouchers et confirmations à envoyer ----------------------------------------------------------------------------------------------
// `vouchers` : ceux des dossiers (views/voucher.mjs, vouchersDuDossier), chacun { reservation, envoi: { le, modifie } }. Restent ceux des
// `jours` jamais envoyés au client ou modifiés depuis l'envoi, triés par jour puis heure de pickup.
export function envoisAFaire(vouchers = [], jours = []) {
  const voulus = new Set(jours);
  return (vouchers || [])
    .filter((x) => x && x.reservation && voulus.has(x.reservation.date_service) && x.reservation.statut !== "annule" && (!x.envoi || !x.envoi.le || x.envoi.modifie))
    .sort((a, b) => a.reservation.date_service.localeCompare(b.reservation.date_service) || (a.reservation.heure_pickup || "99").localeCompare(b.reservation.heure_pickup || "99"));
}

// ---- Clients WhatsApp sans réponse ----------------------------------------------------------------------------------------------------
// Depuis plus de 12 heures, Nani n'a pas répondu au premier message resté sans réponse (attend_depuis, migration 65 ; même règle que la
// liste WhatsApp, attenteClient : un « merci » que le tri a vu sans réponse à faire ne compte pas). Seulement les clients : un contact
// réglé sur « Contact personnel » ou typé partenaire, chauffeur, hôtel ou apporteur n'y est pas. Dans l'entreprise ouverte, plus les
// conversations pas encore rangées (à trier). Les plus anciennes d'abord.
export const ATTENTE_SOIR_H = 12;
export function sansReponse({ conversations = [], propositions = [], entiteId = null, maintenant = Date.now(), heures = ATTENTE_SOIR_H } = {}) {
  const seuil = heures * 60;
  const sortie = [];
  for (const c of conversations || []) {
    if (!c || !c.id || contactPersonnel(c)) continue;
    if (c.type_contact && c.type_contact !== "client") continue;
    if (c.entite_id && c.entite_id !== entiteId) continue;
    const a = attenteClient(c, propositionCourante(propositions, c.id), maintenant);
    if (!a || a.minutes < seuil) continue;
    sortie.push({ conversation: c, minutes: a.minutes, attente: a.texte, aTrier: !c.entite_id });
  }
  return sortie.sort((x, y) => y.minutes - x.minutes);
}


// Les noms qui ne partent jamais vers un client : fiches partenaires (plus de deux lettres, comme nomsABloquer de la fonction agent) et
// conversations WhatsApp typées autrement que « client » ou reliées à une fiche partenaire (comme nomsContactsTypes). Le lien wa.me ne
// passe par aucun contrôle du serveur : l'écran les retire lui-même.
export function nomsInterdits({ partenaires = [], conversations = [] } = {}) {
  const noms = [
    ...(partenaires || []).map((p) => p && p.nom),
    ...(conversations || []).filter((c) => c && ((c.type_contact && c.type_contact !== "client") || c.partenaire_id)).map((c) => c.nom),
  ];
  return [...new Set(noms.map((n) => String(n || "").trim()).filter((n) => n.length > 2))];
}
