// Demandes du site et conversations WhatsApp reliées (migration 72, demande de Jérémy du 21.11.2026 : « Oui, relie-les »).
// Calculs sans écran, partagés par l'outil, la démonstration (store-local) et les tests. La base refait les mêmes contrôles
// (demande_site_relier et whatsapp_relier_apres_demande) : l'outil propose, la base décide.
//   1. Un dossier créé depuis WhatsApp ou l'Assistant : les demandes du site « nouvelles » du même numéro, dans la même entreprise.
//   2. Une demande acceptée : la conversation WhatsApp du même numéro se relie au client et au dossier, sans jamais écraser une liaison.
//   3. Avant « Confirmer » : le dossier récent du même client, dans la même entreprise.
// Le numéro (meme_telephone en base) : deux numéros avec indicatif (+ ou 00) se comparent en entier, +33 6 12 34 56 78 n'est pas
// +66 6 1234 5678 ; quand l'un des deux n'a pas d'indicatif (« 081 234 5678 » noté à la thaïe), les 9 derniers chiffres, comme
// whatsapp_trouver_client. Pas de rapprochement par e-mail : la feuille du site ne demande pas d'e-mail (demandes_site n'a pas la colonne).
// Limite connue (revue de la PR 302) : la création du dossier et la confirmation de la demande ne sont pas une seule transaction. Deux
// appareils à quelques millisecondes d'écart peuvent encore créer deux dossiers ; relecture, avertissement et refus de la base réduisent la
// fenêtre sans la fermer.

// Un dossier est « récent » : non annulé, et créé ces 30 derniers jours ou avec un service (ou un départ) à venir. Une demande confirmée
// depuis moins de 30 jours compte aussi avant de créer un dossier (« Créer quand même ? »). Un lien posé d'office se défait 24 heures.
export const RECENT_JOURS = 30;
export const DELIER_HEURES = 24;

// Les 9 derniers chiffres d'un numéro ; vide pour un numéro trop court (rien à comparer).
export const cleTelephone = (t) => {
  const n = String(t ?? "").replace(/\D/g, "");
  return n.length >= 9 ? n.slice(-9) : "";
};
// Les chiffres d'un numéro avec indicatif (« + » ou « 00 »), sans le « 00 » ; null sans indicatif.
const international = (t) => {
  const s = String(t ?? "").trim();
  if (s.startsWith("+")) return s.replace(/\D/g, "");
  if (/^00/.test(s.replace(/[\s().-]/g, ""))) return s.replace(/\D/g, "").slice(2);
  return null;
};
export const memeNumero = (a, b) => {
  const x = cleTelephone(a);
  const y = cleTelephone(b);
  if (!x || !y) return false;
  const ia = international(a);
  const ib = international(b);
  return ia !== null && ib !== null ? ia === ib : x === y;
};
// Une conversation qui dit le numéro du client : contact client (ou pas encore typé), sans fiche partenaire reliée, jamais un contact personnel.
export const conversationDeClient = (w) => !!w && (!w.type_contact || w.type_contact === "client") && !w.partenaire_id && w.reponses !== "jamais";

const jour = (v) => String(v || "").slice(0, 10);
const moinsJours = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

// Les numéros qui désignent le client d'un dossier : sa fiche et les conversations WhatsApp de CLIENT déjà reliées à ce dossier (une
// conversation de partenaire, d'apporteur ou un contact personnel ne donne jamais de numéro), plus `autres`.
export function telephonesDuDossier({ dossier, clients = [], conversations = [], autres = [] } = {}) {
  if (!dossier) return [];
  const fiche = clients.find((c) => c.id === dossier.client_id);
  const tels = [fiche && fiche.telephone, ...conversations.filter((w) => w.dossier_id === dossier.id && conversationDeClient(w)).map((w) => w.telephone), ...autres];
  return [...new Set(tels.filter((t) => cleTelephone(t)).map((t) => String(t).trim()))];
}

// ---- 1. Dossier créé : les demandes du site à relier -------------------------------------------------------------------------------
// Seulement les demandes « nouvelles » de l'entreprise du dossier (chaque entreprise ses éléments : une demande de Secret ne va jamais à
// un dossier de Taxi, même pour une fiche partagée), au même numéro. La plus récente d'abord.
export function demandesPourDossier({ demandes = [], dossier, telephones = [] } = {}) {
  if (!dossier || !dossier.id || dossier.annule) return [];
  if (!telephones.length) return [];
  return demandes
    .filter((d) => d.statut === "nouvelle" && d.entite_id === dossier.entite_id && telephones.some((t) => memeNumero(t, d.telephone)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
// Un service du dossier correspond-il à la demande ? Même date de service, ou même produit (prestation de la page du site) ou trajet,
// ou le nom du produit dans le libellé du service. Les services annulés ne comptent pas.
export function serviceCorrespond({ demande, reservations = [], produits = [] } = {}) {
  if (!demande) return false;
  const res = reservations.filter((r) => r.statut !== "annule");
  if (demande.date_service && res.some((r) => jour(r.date_service) === jour(demande.date_service))) return true;
  if (!demande.produit_id) return false;
  const p = produits.find((x) => x.id === demande.produit_id);
  const ids = new Set(p ? [...(p.tarifs || []), ...(p.options || []).flatMap((o) => o.tarifs || [])].flatMap((t) => [t.prestation, t.trajet]).filter(Boolean) : []);
  const nom = String((p && p.nom) || demande.produit || "").trim().toLowerCase();
  return res.some((r) => ids.has(r.prestation_id) || ids.has(r.trajet_id) || (nom.length >= 4 && String(r.libelle || "").toLowerCase().includes(nom)));
}
// Une seule demande dont un service correspond : reliée d'office. Sinon (plusieurs, ou une seule sans service qui corresponde), Nani coche.
export const choixDemandes = (liste, { correspond = () => true } = {}) => (!liste.length ? "aucune" : liste.length === 1 && correspond(liste[0]) ? "relier" : "choisir");

// Avant de créer un dossier : les demandes du même client, dans ces entreprises, confirmées depuis moins de 30 jours avec un dossier
// qui existe encore et n'est pas annulé. Rend [{ demande, dossier }], la plus récente d'abord. `exclure` : la demande qu'on confirme.
export function confirmeesRecentes({ demandes = [], telephones = [], entites = [], dossiers = [], aujourdhui, exclure = null } = {}) {
  if (!telephones.length || !aujourdhui) return [];
  const depuis = moinsJours(aujourdhui, RECENT_JOURS);
  return demandes
    .filter((d) => d.id !== exclure && d.statut === "confirmee" && d.dossier_id && entites.includes(d.entite_id) && jour(d.traitee_le || d.updated_at || d.created_at) >= depuis && telephones.some((t) => memeNumero(t, d.telephone)))
    .map((d) => ({ demande: d, dossier: dossiers.find((x) => x.id === d.dossier_id) || null }))
    .filter((x) => x.dossier && !x.dossier.annule)
    .sort((a, b) => String(b.demande.traitee_le || "").localeCompare(String(a.demande.traitee_le || "")));
}

// Un lien posé d'office (decision.relie) se défait dans les 24 heures (demande_site_delier). null : permis ; sinon le motif.
export function refusDelier(demande, { maintenant = Date.now(), lit = true, ecrit = true } = {}) {
  if (!demande || !lit) return "introuvable";
  if (!ecrit) return "droit";
  const relie = demande.decision && demande.decision.relie;
  if (demande.statut !== "confirmee" || !relie || typeof relie !== "object") return "pas_relie";
  const le = Date.parse(relie.le);
  if (!(le >= maintenant - DELIER_HEURES * 3600000)) return "trop_tard";
  return null;
}

// Ce que la base vérifie avant de relier une demande à un dossier (demande_site_relier). null : permis ; sinon le motif du refus.
// `litDossier` : la personne lit les dossiers de l'entreprise du dossier ; sinon il est « introuvable » (pas d'oracle).
export function refusLienDemande({ demande, dossier, telephones = [], lit = true, ecrit = true, litDossier = true } = {}) {
  if (!demande || !lit) return "introuvable";
  if (!ecrit) return "droit";
  if (demande.statut !== "nouvelle") return "deja_traitee";
  if (!dossier || !litDossier) return "introuvable";
  if (dossier.entite_id !== demande.entite_id) return "autre_entreprise";
  if (dossier.annule) return "annule";
  if (!telephones.some((t) => memeNumero(t, demande.telephone))) return "numero";
  return null;
}

// ---- 2. Demande acceptée : la conversation WhatsApp ---------------------------------------------------------------------------------
// Les conversations de l'organisation au même numéro (une seule attendue : une par numéro et par organisation).
export function conversationsDuNumero({ conversations = [], telephone, organisationId } = {}) {
  if (!cleTelephone(telephone)) return [];
  return conversations.filter((w) => (!organisationId || w.organisation_id === organisationId) && memeNumero(w.telephone, telephone));
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
  // Contact personnel : rien de lui ne se relie tout seul. Partenaire ou apporteur : ce n'est pas le client.
  if (w.reponses === "jamais") return rien("personnel", w);
  if ((w.type_contact && w.type_contact !== "client") || w.partenaire_id) return rien("autre_contact", w);
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
  if (!cleTelephone(demande.telephone)) return [];
  const depuis = moinsJours(aujourdhui, RECENT_JOURS);
  const telDe = new Map(clients.map((c) => [c.id, c.telephone]));
  const parConv = new Set(conversations.filter((w) => w.dossier_id && conversationDeClient(w) && memeNumero(w.telephone, demande.telephone)).map((w) => w.dossier_id));
  const aVenir = new Set(reservations.filter((r) => r.statut !== "annule" && jour(r.date_service) >= aujourdhui).map((r) => r.dossier_id));
  return dossiers
    .filter((d) => d.entite_id === demande.entite_id && !d.annule && (memeNumero(telDe.get(d.client_id), demande.telephone) || parConv.has(d.id)))
    .filter((d) => jour(d.created_at) >= depuis || aVenir.has(d.id) || jour(d.date_depart) >= aujourdhui || jour(d.date_retour) >= aujourdhui)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
