// Étapes d'une conversation WhatsApp de client (migration 105, demande de Jérémy du 22.11.2026). Calculs sans écran, partagés par l'écran,
// la démonstration et les tests. Aucun appel à l'IA : les faits des messages viennent de la fonction « whatsapp »
// (supabase/functions/whatsapp/etapes.js, colonne avancee), le reste des données de Gestion (dossiers, réservations, vouchers).
//
// Secret et Taxi partagent le numéro : la conversation d'un client appartient aux deux entreprises et l'étape suit chaque entreprise. Un
// client peut être « Réservé » chez Taxi et « Prix envoyé » chez Secret : les deux s'affichent. ZTP n'entre jamais dans le calcul (seuls les
// dossiers d'une entreprise de marque Secret ou Taxi comptent).
//
// Par entreprise, dans l'ordre :
//   - un dossier non annulé du client (fiche reliée, même numéro, ou dossier relié à la conversation) :
//       Terminé (tous les services sont passés), Voucher envoyé (noté sur chaque réservation, ou confirmation envoyée par Nani depuis le
//       dossier), Réservé (dossier accepté ou un service confirmé), sinon Prix envoyé (devis) ;
//       un nouveau prix donné après la fin d'un dossier terminé repart des messages ;
//   - sinon les messages : Prêt à réserver (#313), À relancer (prix envoyé, aucune réponse du client depuis 48 h), Prix envoyé ;
//   - sans prix ni dossier, une conversation qui contient une demande : Nouvelle demande (entreprise du tri si connue).
// Nani peut forcer une étape (etape_manuelle, par entreprise) : son choix l'emporte jusqu'au prochain événement qui fait avancer
// (l'événement calculé est plus récent que son choix).
// Jamais pour un Contact personnel, un partenaire, un chauffeur, un hôtel, un apporteur, une fiche partenaire reliée, ou un tri
// « personnel », « partenaire » ou « publicite ».
import { N_ } from "./i18n.mjs";
import { memeNumero } from "./demandes-whatsapp-calc.mjs";
import { decisionPret, TYPES_EXCLUS, MOTIFS_TRI_EXCLUS } from "./whatsapp-pret-calc.mjs";

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
// Les clés d'entreprise d'une étape : « secret », « taxi », ou « aucune » (demande dont l'entreprise n'est pas encore connue).
export const CLES_ENTREPRISE = ["secret", "taxi", "aucune"];
export const RELANCE_MS = 48 * 3600 * 1000;
// Une confirmation envoyée par Nani juste avant que le dossier soit noté compte pour ce dossier (elle crée souvent le dossier après).
const MARGE_VOUCHER_MS = 15 * 60 * 1000;

const t = (iso) => {
  const x = Date.parse(iso || "");
  return Number.isNaN(x) ? null : x;
};
const finDeJour = (jour) => t(`${jour}T23:59:59+07:00`);

// Conversation d'un client : ni Contact personnel, ni contact typé non client, ni fiche partenaire, ni tri qui dit « pas un client ».
export function conversationClient(c) {
  if (!c || c.reponses === "jamais" || c.partenaire_id || TYPES_EXCLUS.includes(String(c.type_contact || ""))) return false;
  if (c.tri && typeof c.tri === "object" && MOTIFS_TRI_EXCLUS.includes(c.tri.motif)) return false;
  return !(c.avancee && c.avancee.client === false);
}

// Les faits des messages, lisibles (colonne absente ou abîmée : rien).
const faitsDe = (c) => {
  const f = c && c.avancee;
  return f && typeof f === "object" && f.client === true ? f : null;
};

// L'étape d'un dossier, ou null s'il ne compte pas. `aujourdhui` : AAAA-MM-JJ à Bangkok.
export function etapeDossier(d, { reservations = [], faits = null, aujourdhui }) {
  if (!d || d.annule) return null;
  const resas = reservations.filter((r) => r && r.dossier_id === d.id && r.statut !== "annule");
  const cree = t(d.created_at) || 0;
  const dates = resas.map((r) => r.date_service).filter(Boolean).sort();
  const fin = dates.at(-1) || null;
  if (resas.length && fin && dates.length === resas.length && fin < aujourdhui) return { etape: "termine", depuis: finDeJour(fin), fin };
  const envois = resas.map((r) => (r.details && r.details.envois && r.details.envois.client) || null);
  if (resas.length && envois.every(Boolean)) return { etape: "voucher_envoye", depuis: Math.max(...envois.map((x) => t(`${x}T00:00:00+07:00`) || cree)) };
  const vMessage = faits ? t(faits.voucher_le) : null;
  if (vMessage && vMessage >= cree - MARGE_VOUCHER_MS && resas.length) return { etape: "voucher_envoye", depuis: vMessage };
  if (d.accepte_le || resas.some((r) => r.statut === "confirme")) return { etape: "reserve", depuis: cree };
  return { etape: "prix_envoye", depuis: cree };
}

// L'étape tirée des messages pour une entreprise (« secret », « taxi », ou « inconnu » pour un prix sans entreprise), ou null.
function etapeMessages(f, cle, { pretRetire = null, maintenant }) {
  if (!f || f.annule) return null;
  const prix = t(f.prix && f.prix[cle]);
  const pretCle = f.pret ? f.pret.entreprise || "inconnu" : null;
  const pretLe = f.pret && pretCle === cle ? t(f.pret.le) : null;
  // Le client a refusé ou annulé après le dernier prix et le dernier « prêt » : l'échange s'arrête là.
  const refus = t(f.refus_le);
  if (refus && refus >= (prix || 0) && refus >= (pretLe || 0)) return null;
  if (pretLe && !(pretRetire && pretRetire >= pretLe) && (!prix || pretLe >= prix)) return { etape: "pret", depuis: pretLe };
  if (!prix) return null;
  const reponse = t(f.dernier_client_le);
  if ((!reponse || reponse < prix) && maintenant - prix >= RELANCE_MS) return { etape: "a_relancer", depuis: prix + RELANCE_MS };
  return { etape: "prix_envoye", depuis: prix };
}

// Les étapes de la conversation : [{ entreprise: "secret" | "taxi" | null, etape, depuis, dossier, manuel }]. Vide pour un contact qui
// n'est pas un client. `marqueDe(entite_id)` rend « secret », « taxi » ou null (ZTP : null, jamais compté).
export function etapesConversation(c, { dossiers = [], clients = [], reservations = [], marqueDe = () => null, maintenant = Date.now(), aujourdhui } = {}) {
  if (!conversationClient(c)) return [];
  const f = faitsDe(c);
  const jour = aujourdhui || new Date(maintenant + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const siens = new Set(clients.filter((x) => x && ((c.client_id && x.id === c.client_id) || memeNumero(x.telephone, c.telephone))).map((x) => x.id));
  if (c.client_id) siens.add(c.client_id);
  const pret = decisionPret(c);
  const pretRetire = pret && c.pret_retire_le ? t(c.pret_retire_le) : null;
  const auto = {};
  for (const cle of ["secret", "taxi"]) {
    const siensIci = dossiers
      .filter((d) => d && !d.annule && marqueDe(d.entite_id) === cle && (d.id === c.dossier_id || siens.has(d.client_id)))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const d = siensIci[0] || null;
    const parDossier = d ? etapeDossier(d, { reservations, faits: f, aujourdhui: jour }) : null;
    const parMessages = etapeMessages(f, cle, { pretRetire, maintenant });
    // Un dossier terminé et un nouveau prix donné après : la nouvelle demande repart des messages.
    const nouveauPrix = parDossier && parDossier.etape === "termine" && f && t(f.prix && f.prix[cle]) > parDossier.depuis;
    const e = parDossier && !nouveauPrix ? { ...parDossier, dossier: d } : parMessages ? { ...parMessages, dossier: null } : null;
    if (e) auto[cle] = e;
  }
  // Un prix (ou un « prêt ») dont l'entreprise est inconnue, sans étape ailleurs.
  if (!auto.secret && !auto.taxi) {
    const e = etapeMessages(f, "inconnu", { pretRetire, maintenant });
    const demande = f && t(f.demande_le);
    const triDemande = c.tri && ["demande_client", "suivi_reservation"].includes(c.tri.motif);
    const refus = f && t(f.refus_le);
    // ZTP reste à part : un client qui n'a de dossier que chez ZTP (ou une autre entreprise hors du numéro) n'a pas d'étape ici.
    const ailleurs = dossiers.some((d) => d && !d.annule && !marqueDe(d.entite_id) && (d.id === c.dossier_id || siens.has(d.client_id)));
    if (e) auto.aucune = { ...e, dossier: null };
    else if (!(f && f.annule) && !ailleurs && (demande || triDemande) && !(refus && refus >= (demande || 0))) auto.aucune = { etape: "nouvelle", depuis: demande || (f && t(f.premier_client_le)) || t(c.created_at) || 0, dossier: null };
    // La demande dont le tri a reconnu l'entreprise s'affiche chez elle.
    if (auto.aucune && auto.aucune.etape === "nouvelle" && c.tri && ["secret", "taxi"].includes(c.tri.entreprise)) {
      auto[c.tri.entreprise] = auto.aucune;
      delete auto.aucune;
    }
  }
  // Le choix de Nani l'emporte jusqu'au prochain événement qui fait avancer.
  const manuel = c.etape_manuelle && typeof c.etape_manuelle === "object" ? c.etape_manuelle : {};
  for (const cle of CLES_ENTREPRISE) {
    const m = manuel[cle];
    if (!m || !VALEURS_ETAPES.includes(m.etape)) continue;
    const le = t(m.le);
    if (le === null) continue;
    const a = auto[cle];
    if (!a || le >= a.depuis) auto[cle] = { etape: m.etape, depuis: le, dossier: a ? a.dossier : null, manuel: true };
  }
  return CLES_ENTREPRISE.filter((cle) => auto[cle]).map((cle) => ({ entreprise: cle === "aucune" ? null : cle, manuel: false, ...auto[cle] }));
}

// La conversation est-elle dans le filtre de cette étape ?
export const aEtape = (etapes, etape) => etapes.some((e) => e.etape === etape);
// Le patch d'un choix manuel (la base date le choix) ; `etape` vide : retour au calcul automatique pour cette entreprise.
export function patchEtapeManuelle(c, cle, etape) {
  const actuel = c && c.etape_manuelle && typeof c.etape_manuelle === "object" ? { ...c.etape_manuelle } : {};
  if (!CLES_ENTREPRISE.includes(cle)) return null;
  if (etape && !VALEURS_ETAPES.includes(etape)) return null;
  if (etape) actuel[cle] = { etape, le: new Date().toISOString() };
  else delete actuel[cle];
  return { etape_manuelle: Object.keys(actuel).length ? actuel : null };
}
