// Étapes d'une conversation WhatsApp de client (migration 105, demande de Jérémy du 22.11.2026, corrigée après la relecture). Calculs sans
// écran, partagés par l'écran, la démonstration et les tests. Aucun appel à l'IA : les faits des messages viennent de la fonction
// « whatsapp » (supabase/functions/whatsapp/etapes.js, colonne avancee), le reste des données de Gestion (dossiers, réservations, vouchers).
//
// Secret et Taxi partagent le numéro : la conversation d'un client appartient aux deux et l'étape suit chaque entreprise. Un client peut être
// « Réservé » chez Taxi et « Prix envoyé » chez Secret : les deux s'affichent. ZTP ne se mélange jamais : seuls les dossiers de Secret et de
// Taxi comptent, et un prix qui n'est pas en bahts n'est pas un prix d'ici (etapes.js).
//
// Par entreprise :
//   - le dernier dossier non annulé du client (fiche reliée, même numéro, ou dossier relié), sauf si un prix plus récent que lui a été donné
//     pour cette entreprise (client qui revient : arrivée, puis transfert retour) :
//       Terminé (tous les services passés), Voucher envoyé (chaque service a son voucher noté, ou un voucher envoyé depuis le téléphone a
//       suivi ce dossier), Réservé (dossier accepté ou un service confirmé), sinon Prix envoyé (devis) ;
//   - sinon les messages de cette entreprise : le plus récent l'emporte. Un refus ou une annulation : plus d'étape. Une nouvelle demande :
//     Nouvelle demande. Sinon Prêt à réserver (#313), À relancer (prix sans réponse du client depuis 48 h), Prix envoyé.
//   - « Sans entreprise » : un prix, un « prêt » ou une demande dont l'entreprise n'est pas connue, seulement si ni Secret ni Taxi n'ont d'étape.
// Nani peut forcer une étape par entreprise (etape_manuelle) : son choix l'emporte jusqu'au prochain événement daté de cette entreprise qui
// fait avancer (prix, réponse du client, demande, refus, dossier créé ou accepté, service confirmé, voucher). « Sans entreprise » tombe dès
// qu'une entreprise a une étape.
// Jamais pour un Contact personnel, un partenaire, un chauffeur, un hôtel, un apporteur, une fiche partenaire reliée, ou un tri
// « personnel », « partenaire » (donné par Haiku) ou « publicite », jugés sur leur valeur du moment.
//
// Performance (relecture n° 8) : clients, dossiers et réservations sont indexés une fois par tableau (WeakMap) ; l'écran calcule les étapes
// une fois par rendu (views/whatsapp-etapes.mjs).
import { N_ } from "./i18n.mjs";
import { memeNumero, cleTelephone } from "./demandes-whatsapp-calc.mjs";
import { decisionPret, TYPES_EXCLUS } from "./whatsapp-pret-calc.mjs";

export const ETAPES = [
  { valeur: "nouvelle", libelle: N_("Nouvelle demande") },
  { valeur: "prix_envoye", libelle: N_("Prix envoyé") },
  { valeur: "a_relancer", libelle: N_("À relancer") },
  { valeur: "pret", libelle: N_("Prêt à réserver") },
  { valeur: "reserve", libelle: N_("Réservé") },
  { valeur: "voucher_envoye", libelle: N_("Voucher envoyé") },
  { valeur: "termine", libelle: N_("Terminé") },
];
export const VALEURS_ETAPES = ETAPES.map((e) => e.valeur);
export const libelleEtape = (v) => (ETAPES.find((e) => e.valeur === v) || {}).libelle || "";
// Les clés d'entreprise d'une étape : « secret », « taxi », ou « aucune » (entreprise pas encore connue).
export const CLES_ENTREPRISE = ["secret", "taxi", "aucune"];
// Le tri écarte un contact qui n'est pas un client seulement pour ces motifs ; « non_client » (posé sans appel pour un contact typé) ne
// compte pas : c'est le type du moment qui décide.
export const MOTIFS_TRI_NON_CLIENT = ["personnel", "partenaire", "publicite", "contact_jamais"];
export const RELANCE_MS = 48 * 3600 * 1000;
// Un voucher envoyé par Nani juste avant que le dossier soit noté compte pour ce dossier (elle crée souvent le dossier après).
const MARGE_VOUCHER_MS = 15 * 60 * 1000;

const t = (iso) => {
  const x = Date.parse(iso || "");
  return Number.isNaN(x) ? null : x;
};
const jourBangkok = (jour) => t(`${jour}T00:00:00+07:00`);
const maxi = (...v) => v.filter((x) => typeof x === "number").reduce((a, b) => (b > a ? b : a), null);

// Conversation d'un client : ni Contact personnel, ni contact typé non client, ni fiche partenaire, ni tri qui dit « pas un client ».
export function conversationClient(c) {
  if (!c || c.reponses === "jamais" || c.partenaire_id || TYPES_EXCLUS.includes(String(c.type_contact || ""))) return false;
  return !(c.tri && typeof c.tri === "object" && MOTIFS_TRI_NON_CLIENT.includes(c.tri.motif));
}
const faitsDe = (c) => {
  const f = c && c.avancee;
  return f && typeof f === "object" && !f.jamais ? f : null;
};

// ---- Index (une fois par tableau) ------------------------------------------------------------------------------------------------
const index = new WeakMap();
function indexDe(tableau, faire) {
  if (!Array.isArray(tableau)) return faire([]);
  let i = index.get(tableau);
  if (!i) index.set(tableau, (i = faire(tableau)));
  return i;
}
const grouper = (liste, cle) => {
  const m = new Map();
  for (const x of liste) if (x && x[cle]) (m.get(x[cle]) || m.set(x[cle], []).get(x[cle])).push(x);
  return m;
};
const clientsParNumero = (clients) => indexDe(clients, (l) => grouper(l.map((x) => (x ? { ...x, _cle: cleTelephone(x.telephone) } : x)), "_cle"));
const dossiersParClient = (dossiers) => indexDe(dossiers, (l) => ({ parClient: grouper(l, "client_id"), parId: new Map(l.filter(Boolean).map((d) => [d.id, d])) }));
const reservationsParDossier = (reservations) => indexDe(reservations, (l) => ({ parDossier: grouper(l, "dossier_id"), parId: new Map(l.filter(Boolean).map((r) => [r.id, r])) }));

// Les fiches du même client : la fiche reliée et celles du même numéro.
function fichesDe(c, clients) {
  const siens = new Set(c.client_id ? [c.client_id] : []);
  const cle = cleTelephone(c.telephone);
  if (cle) for (const x of clientsParNumero(clients).get(cle) || []) if (memeNumero(x.telephone, c.telephone)) siens.add(x.id);
  return siens;
}

// ---- Dossier --------------------------------------------------------------------------------------------------------------------
// L'étape d'un dossier et l'heure de son dernier événement (créé, accepté, service confirmé, voucher), ou null s'il ne compte pas.
// `parService` : réservation → heure du voucher envoyé depuis Gestion pour elle ; `telephone` : heures des vouchers envoyés depuis le
// téléphone après ce dossier (ils valent pour tout le dossier).
export function etapeDossier(d, { reservations = [], parService = new Map(), telephone = [], aujourdhui }) {
  if (!d || d.annule) return null;
  const resas = reservations.filter((r) => r && r.statut !== "annule");
  const cree = t(d.created_at) || 0;
  const accepte = d.accepte_le ? maxi(cree, jourBangkok(d.accepte_le)) : null;
  const confirme = maxi(...resas.filter((r) => r.statut === "confirme").map((r) => t(r.updated_at) || cree));
  const vMax = maxi(...telephone, ...resas.map((r) => parService.get(r.id)));
  const dernier = maxi(cree, accepte, confirme, vMax);
  const dates = resas.map((r) => r.date_service).filter(Boolean).sort();
  const fin = dates.at(-1) || null;
  if (resas.length && fin && dates.length === resas.length && fin < aujourdhui) return { etape: "termine", depuis: jourBangkok(fin) + 24 * 3600 * 1000, dernier: maxi(dernier, jourBangkok(fin) + 24 * 3600 * 1000) };
  // Voucher envoyé : chaque service a son voucher (noté sur la réservation, ou envoyé depuis Gestion pour elle), ou un voucher envoyé
  // depuis le téléphone a suivi ce dossier. Un récapitulatif écrit n'en est pas un (etapes.js).
  const tousNotes = resas.length && resas.every((r) => (r.details && r.details.envois && r.details.envois.client) || parService.has(r.id));
  if (resas.length && (tousNotes || telephone.length)) return { etape: "voucher_envoye", depuis: vMax || maxi(...resas.map((r) => jourBangkok(r.details && r.details.envois && r.details.envois.client))) || cree, dernier };
  if (accepte || confirme) return { etape: "reserve", depuis: maxi(accepte, confirme), dernier };
  return { etape: "prix_envoye", depuis: cree, dernier };
}

// ---- Messages -------------------------------------------------------------------------------------------------------------------
// L'étape d'une entreprise d'après ses messages (clé « secret », « taxi » ou « inconnu »), ou null. Le plus récent l'emporte.
function etapeMessages(f, cle, { pretRetire = null, maintenant }) {
  if (!f || !f.par) return null;
  const m = f.par[cle] || {};
  const prix = t(m.prix_le);
  const demande = t(m.demande_le);
  const refus = t(m.refus_le);
  const pretCle = f.pret ? f.pret.entreprise || "inconnu" : null;
  const pretLe = f.pret && pretCle === cle && !(pretRetire && pretRetire >= t(f.pret.le)) ? t(f.pret.le) : null;
  const dernier = maxi(prix, demande, refus, pretLe);
  if (dernier === null) return null;
  if (refus === dernier) return null;
  if (demande === dernier && demande > (prix || 0) && demande > (pretLe || 0)) return { etape: "nouvelle", depuis: demande };
  if (pretLe && pretLe >= (prix || 0)) return { etape: "pret", depuis: pretLe };
  if (prix) {
    const reponse = t(f.dernier_client_le);
    if ((!reponse || reponse < prix) && maintenant - prix >= RELANCE_MS) return { etape: "a_relancer", depuis: prix + RELANCE_MS };
    return { etape: "prix_envoye", depuis: prix };
  }
  return demande ? { etape: "nouvelle", depuis: demande } : null;
}

// Les vouchers d'un dossier, à l'heure exacte : ceux envoyés depuis Gestion pour une de ses réservations (par service), et ceux envoyés
// depuis le téléphone, rattachés au dossier du client créé le plus récemment avant eux (quelle que soit son entreprise).
function vouchersDuDossier(d, f, resasIdx, dossiersClient) {
  const parService = new Map();
  const telephone = [];
  for (const v of (f && f.vouchers) || []) {
    const le = t(v.le);
    if (!le) continue;
    if (v.reservation_id) {
      const r = resasIdx.parId.get(v.reservation_id);
      if (r && r.dossier_id === d.id) parService.set(r.id, maxi(parService.get(r.id), le));
      continue;
    }
    const avant = dossiersClient.filter((x) => x && !x.annule && (t(x.created_at) || 0) - MARGE_VOUCHER_MS <= le).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (avant[0] && avant[0].id === d.id) telephone.push(le);
  }
  return { parService, telephone };
}

// Les étapes de la conversation : [{ entreprise: "secret" | "taxi" | null, etape, depuis, dossier, manuel }]. Vide pour un contact qui
// n'est pas un client. `marqueDe(entite_id)` rend « secret », « taxi » ou null (ZTP : null, jamais compté).
export function etapesConversation(c, { dossiers = [], clients = [], reservations = [], marqueDe = () => null, maintenant = Date.now(), aujourdhui } = {}) {
  if (!conversationClient(c)) return [];
  const f = faitsDe(c);
  const jour = aujourdhui || new Date(maintenant + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const dIdx = dossiersParClient(dossiers);
  const rIdx = reservationsParDossier(reservations);
  const siens = fichesDe(c, clients);
  const duClient = [];
  for (const k of siens) for (const d of dIdx.parClient.get(k) || []) duClient.push(d);
  const relie = c.dossier_id ? dIdx.parId.get(c.dossier_id) : null;
  if (relie && !duClient.includes(relie)) duClient.push(relie);
  const pret = decisionPret(c);
  const pretRetire = pret && c.pret_retire_le ? t(c.pret_retire_le) : null;
  const auto = {};
  const derniers = {};
  // ZTP reste à part : un client qui a un dossier hors de Secret et de Taxi (ZTP) n'a pas d'étape « Nouvelle demande » ici tant qu'aucun
  // prix en bahts ni aucun dossier de Secret ou de Taxi n'existe pour lui (sa demande est celle de ZTP).
  const ailleurs = duClient.some((d) => d && !d.annule && !marqueDe(d.entite_id)) || !!(f && f.pret && f.pret.entreprise === "ztp");
  for (const cle of ["secret", "taxi"]) {
    const ici = duClient.filter((d) => d && !d.annule && marqueDe(d.entite_id) === cle).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const d = ici[0] || null;
    const resas = d ? rIdx.parDossier.get(d.id) || [] : [];
    const parDossier = d ? etapeDossier(d, { reservations: resas, ...vouchersDuDossier(d, f, rIdx, duClient), aujourdhui: jour }) : null;
    const parMessages = etapeMessages(f, cle, { pretRetire, maintenant });
    // Un prix donné après la création du dossier : une nouvelle demande (client qui revient : arrivée, puis transfert retour), les messages
    // reprennent. La confirmation de ce dossier n'est pas un prix : elle ne le fait pas.
    const m = (f && f.par && f.par[cle]) || {};
    const prixApres = d && (t(m.prix_le) || 0) > (t(d.created_at) || 0);
    // Une question sans prix, posée pendant qu'un dossier de l'autre entreprise est en cours (« le transfert du retour est-il inclus ? »,
    // cas C18) : un suivi de ce dossier, pas une nouvelle demande ici.
    const suiviAutre = parMessages && parMessages.etape === "nouvelle" && !d && duClient.some((x) => x && !x.annule && ["secret", "taxi"].includes(marqueDe(x.entite_id)) && marqueDe(x.entite_id) !== cle && (t(x.created_at) || 0) <= parMessages.depuis);
    const messages = parMessages && !(ailleurs && !d && parMessages.etape === "nouvelle") && !suiviAutre ? parMessages : null;
    const e = parDossier && !(prixApres && messages) ? { ...parDossier, dossier: d } : messages ? { ...messages, dossier: null } : null;
    if (e) auto[cle] = e;
    derniers[cle] = maxi(e && e.depuis, parDossier && parDossier.dernier, t(m.prix_le), t(m.demande_le), t(m.refus_le), t(f && f.dernier_client_le));
  }
  // Une étape sans entreprise : seulement si ni Secret ni Taxi n'en ont.
  if (!auto.secret && !auto.taxi) {
    const e = etapeMessages(f, "inconnu", { pretRetire, maintenant });
    const triDemande = c.tri && ["demande_client", "suivi_reservation"].includes(c.tri.motif);
    // ZTP reste à part : un client qui n'a de dossier que chez ZTP n'a pas d'étape « sans entreprise » ici.
    if (e && !ailleurs) auto.aucune = { ...e, dossier: null };
    else if (!e && !ailleurs && triDemande && !(f && f.par && Object.values(f.par).some((x) => x.refus_le))) auto.aucune = { etape: "nouvelle", depuis: t(f && f.premier_client_le) || t(c.created_at) || 0, dossier: null };
    // La demande dont le tri a reconnu l'entreprise s'affiche chez elle.
    if (auto.aucune && auto.aucune.etape === "nouvelle" && c.tri && ["secret", "taxi"].includes(c.tri.entreprise)) {
      auto[c.tri.entreprise] = auto.aucune;
      delete auto.aucune;
    }
    derniers.aucune = maxi(auto.aucune && auto.aucune.depuis, t(f && f.dernier_client_le));
  }
  // Le choix de Nani l'emporte jusqu'au prochain événement daté de l'entreprise (ou une réponse du client).
  const manuel = c.etape_manuelle && typeof c.etape_manuelle === "object" ? c.etape_manuelle : {};
  for (const cle of CLES_ENTREPRISE) {
    const m = manuel[cle];
    if (!m || !VALEURS_ETAPES.includes(m.etape)) continue;
    if (cle === "aucune" && (auto.secret || auto.taxi)) continue;
    const le = t(m.le);
    if (le === null) continue;
    const a = auto[cle];
    const evenement = cle === "aucune" ? derniers.aucune : maxi(derniers[cle], t(f && f.dernier_client_le));
    if (evenement === null || le > evenement) auto[cle] = { etape: m.etape, depuis: le, dossier: a ? a.dossier : null, manuel: true };
  }
  return CLES_ENTREPRISE.filter((cle) => auto[cle]).map((cle) => ({ entreprise: cle === "aucune" ? null : cle, manuel: false, ...auto[cle] }));
}

// La conversation est-elle dans le filtre de cette étape ? « aucune » : un client sans étape, ou un contact qui n'est pas un client.
export const aEtape = (etapes, etape) => (etape === "aucune" ? !etapes.length : etapes.some((e) => e.etape === etape));
// Le patch d'un choix manuel : l'entreprise choisie part sans heure (la base pose l'heure du moment, même si l'étape est la même) ; les
// autres choix sont renvoyés tels quels et gardent leur heure. `etape` vide : retour au calcul automatique pour cette entreprise.
export function patchEtapeManuelle(c, cle, etape) {
  const actuel = c && c.etape_manuelle && typeof c.etape_manuelle === "object" ? { ...c.etape_manuelle } : {};
  if (!CLES_ENTREPRISE.includes(cle)) return null;
  if (etape && !VALEURS_ETAPES.includes(etape)) return null;
  if (etape) actuel[cle] = { etape, le: null };
  else delete actuel[cle];
  return { etape_manuelle: Object.keys(actuel).length ? actuel : null };
}
