// Demandes du site et conversations WhatsApp reliées (migration 72, demande de Jérémy du 21.11.2026 : « Oui, relie-les »).
// Calculs sans écran, partagés par l'outil, la démonstration (store-local) et les tests. La base refait les mêmes contrôles
// (demande_site_relier et whatsapp_relier_apres_demande) : l'outil propose, la base décide.
//   1. Un dossier créé depuis WhatsApp ou l'Assistant : les demandes du site « nouvelles » du même numéro, dans la même entreprise.
//   2. Une demande acceptée : la conversation WhatsApp du même numéro se relie au client et au dossier, sans jamais écraser une liaison.
//   3. Avant « Confirmer » : le dossier récent du même client, dans la même entreprise.
// Le numéro se compare sur ses 9 derniers chiffres, comme whatsapp_trouver_client (migrations 58 et 59) : « 081 234 5678 » et
// « +66 81 234 5678 » sont le même client. Pas de rapprochement par e-mail : la feuille du site ne demande pas d'e-mail
// (demandes_site n'a pas la colonne), un e-mail ne peut donc jamais confirmer qu'il s'agit du même client.

// Un dossier est « récent » : non annulé, et créé ces 30 derniers jours ou avec un service (ou un départ) à venir.
export const RECENT_JOURS = 30;

// Les 9 derniers chiffres d'un numéro ; vide pour un numéro trop court (rien à comparer).
export const cleTelephone = (t) => {
  const n = String(t ?? "").replace(/\D/g, "");
  return n.length >= 9 ? n.slice(-9) : "";
};
export const memeNumero = (a, b) => {
  const x = cleTelephone(a);
  return !!x && x === cleTelephone(b);
};

const jour = (v) => String(v || "").slice(0, 10);
const moinsJours = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

// Les numéros qui désignent le client d'un dossier : sa fiche, les conversations WhatsApp déjà reliées à ce dossier, et ceux donnés
// en plus (numéro de la carte de l'Assistant, conversation WhatsApp d'où vient la carte).
export function telephonesDuDossier({ dossier, clients = [], conversations = [], autres = [] } = {}) {
  if (!dossier) return [];
  const fiche = clients.find((c) => c.id === dossier.client_id);
  const tels = [fiche && fiche.telephone, ...conversations.filter((w) => w.dossier_id === dossier.id).map((w) => w.telephone), ...autres];
  return [...new Set(tels.map(cleTelephone).filter(Boolean))];
}

// ---- 1. Dossier créé : les demandes du site à relier -------------------------------------------------------------------------------
// Seulement les demandes « nouvelles » de l'entreprise du dossier (chaque entreprise ses éléments : une demande de Secret ne va jamais à
// un dossier de Taxi, même pour une fiche partagée), au même numéro. La plus récente d'abord.
export function demandesPourDossier({ demandes = [], dossier, telephones = [] } = {}) {
  if (!dossier || !dossier.id || dossier.annule) return [];
  const cles = new Set(telephones.map(cleTelephone).filter(Boolean));
  if (!cles.size) return [];
  return demandes
    .filter((d) => d.statut === "nouvelle" && d.entite_id === dossier.entite_id && cles.has(cleTelephone(d.telephone)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
// Une seule demande : reliée d'office. Plusieurs : Nani coche. Aucune : rien.
export const choixDemandes = (liste) => (!liste.length ? "aucune" : liste.length === 1 ? "relier" : "choisir");

// Ce que la base vérifie avant de relier une demande à un dossier (demande_site_relier). null : permis ; sinon le motif du refus.
export function refusLienDemande({ demande, dossier, telephones = [], lit = true, ecrit = true } = {}) {
  if (!demande || !lit) return "introuvable";
  if (!ecrit) return "droit";
  if (demande.statut !== "nouvelle") return "deja_traitee";
  if (!dossier) return "introuvable";
  if (dossier.entite_id !== demande.entite_id) return "autre_entreprise";
  if (dossier.annule) return "annule";
  const cle = cleTelephone(demande.telephone);
  if (!cle || !telephones.map(cleTelephone).includes(cle)) return "numero";
  return null;
}

// ---- 2. Demande acceptée : la conversation WhatsApp ---------------------------------------------------------------------------------
// Les conversations de l'organisation au même numéro (une seule attendue : une par numéro et par organisation).
export function conversationsDuNumero({ conversations = [], telephone, organisationId } = {}) {
  const cle = cleTelephone(telephone);
  if (!cle) return [];
  return conversations.filter((w) => (!organisationId || w.organisation_id === organisationId) && cleTelephone(w.telephone) === cle);
}

// La liaison après une demande acceptée, dans l'ordre exact de whatsapp_relier_apres_demande (migration 72).
//   demande : la demande confirmée ({ entite_id, statut, dossier_id, telephone }) ;
//   dossier : son dossier ({ id, entite_id, client_id }) ; clientEntiteId : l'entreprise de la fiche du dossier (une fiche partagée peut
//     venir de l'autre entreprise : la conversation garde alors seulement le dossier, la base retire une fiche d'une autre entreprise) ;
//   boite : l'entreprise a la boîte WhatsApp (Secret ou Taxi ; jamais ZTP) ; ecrit : la personne administre la boîte de cette entreprise ;
//   conversations : celles du même numéro dans l'organisation.
// Rend { action: "relier" | "rien", motif, conversation, patch }.
export function liaisonApresDemande({ demande, dossier, clientEntiteId = null, boite = true, ecrit = true, conversations = [] } = {}) {
  const rien = (motif, conversation = null) => ({ action: "rien", motif, conversation, patch: null });
  if (!demande || demande.statut !== "confirmee" || !demande.dossier_id || !dossier || dossier.id !== demande.dossier_id) return rien("non_confirmee");
  if (!boite) return rien("sans_boite");
  if (!cleTelephone(demande.telephone)) return rien("numero");
  // Avant de chercher : qui n'écrit pas dans la boîte de cette entreprise n'apprend pas si une conversation existe.
  if (!ecrit) return rien("droit_whatsapp");
  if (!conversations.length) return rien("aucune");
  if (conversations.length > 1) return rien("plusieurs");
  const w = conversations[0];
  // Contact personnel : rien de lui ne se relie tout seul. Partenaire, chauffeur, hôtel ou apporteur : ce n'est pas le client.
  if (w.reponses === "jamais") return rien("personnel", w);
  if (w.type_contact && w.type_contact !== "client") return rien("autre_contact", w);
  if (w.entite_id && w.entite_id !== demande.entite_id) return rien("autre_entreprise", w);
  // Remise « à trier » par Nani elle-même : son choix reste.
  if (!w.entite_id && w.entite_source === "manuel") return rien("a_trier_par_nani", w);
  // Une liaison déjà posée (par Nani, ou trouvée par le numéro) ne s'écrase jamais.
  if (w.dossier_id) return rien(w.dossier_id === dossier.id ? "deja_fait" : "deja_relie", w);
  if (w.client_id && w.client_id !== dossier.client_id) return rien("deja_relie", w);
  const patch = { dossier_id: dossier.id };
  if (!w.entite_id) patch.entite_id = demande.entite_id;
  if (!w.client_id && dossier.client_id && clientEntiteId === demande.entite_id) patch.client_id = dossier.client_id;
  return { action: "relier", motif: "relie", conversation: w, patch };
}

// ---- 3. Avant « Confirmer » : un dossier récent du même client ----------------------------------------------------------------------
// Les dossiers de l'entreprise de la demande, non annulés, au même numéro (fiche du client ou conversation WhatsApp reliée), créés ces
// 30 derniers jours ou avec une date de service à venir (un service non annulé, ou la date de départ ou de retour). Le plus récent d'abord.
export function dossiersRecents({ demande, dossiers = [], clients = [], reservations = [], conversations = [], aujourdhui } = {}) {
  if (!demande || demande.statut !== "nouvelle" || !aujourdhui) return [];
  const cle = cleTelephone(demande.telephone);
  if (!cle) return [];
  const depuis = moinsJours(aujourdhui, RECENT_JOURS);
  const telDe = new Map(clients.map((c) => [c.id, cleTelephone(c.telephone)]));
  const parConv = new Set(conversations.filter((w) => w.dossier_id && cleTelephone(w.telephone) === cle).map((w) => w.dossier_id));
  const aVenir = new Set(reservations.filter((r) => r.statut !== "annule" && jour(r.date_service) >= aujourdhui).map((r) => r.dossier_id));
  return dossiers
    .filter((d) => d.entite_id === demande.entite_id && !d.annule && (telDe.get(d.client_id) === cle || parConv.has(d.id)))
    .filter((d) => jour(d.created_at) >= depuis || aVenir.has(d.id) || jour(d.date_depart) >= aujourdhui || jour(d.date_retour) >= aujourdhui)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
