// Le message au client qui accompagne la Booking confirmation (Taxi) ou le voucher (Secret) : les deux modèles de Jérémy du 22.11.2026,
// rangés dans les messages de l'entreprise (defauts.mjs, usage « voucher »), modifiables dans l'écran Messages. Logique pure : les variables
// propres à ce message, d'après la réservation et le dossier seulement, jamais un fait absent.
//   {paiement} (Taxi) : la phrase de Jérémy sur le paiement au chauffeur ; « The remaining … THB will be collected in cash directly by the
//     driver. » après un acompte ; « Your transfer is already paid. » quand le dossier est payé ;
//   {pickup} (Secret) : la ligne de pickup, seulement si la réservation elle-même porte une heure ou un lieu de pickup et que le voucher
//     l'imprime (pickupInclus de views/voucher.mjs) : jamais l'hôtel de la fiche client, jamais pour une location ni pour un billet sans
//     pickup inclus ; sinon la ligne disparaît ;
//   {jour} (Secret) : « trip » pour un billet ou un bateau de transport, « transfer » pour un transfert, « activity » sinon ;
//   {ENTREPRISE} : le nom de l'entreprise en capitales (« VIP TAXI LANTA », comme dans le modèle de Jérémy).
// Un voucher porte une réservation (vouchersDuDossier, views/voucher.mjs) : une seule ligne de pickup.
// Utilisé par l'envoi direct du voucher dans la conversation (PR 304), le lien wa.me et les cartes « Voucher » de l'Assistant, par
// messageClientVoucher (views/voucher-envoi.mjs). Le point du soir garde son modèle « rappel ». Tests : tests/gestion-assistant-court-modeles.test.js.

export const PAIEMENT_CHAUFFEUR = "Payment will be collected in cash directly by the driver (or you can pay through Wise before your transfer (3% fee), please let us know before.)";
export const DEJA_PAYE = "Your transfer is already paid.";
export const TYPES_TRAJET = ["billet", "bateau"];

const propre = (v) => String(v || "").replace(/\s+/g, " ").trim();
const montant = (n) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

// Le voucher imprime-t-il un pickup ? Comme views/voucher.mjs (pickupInclus) : une heure ou un lieu saisis sur la réservation ; pour un
// billet ou un bateau, seulement avec un trajet du catalogue ou un lieu de pickup saisi. Une location n'en a jamais.
export function pickupDuVoucher(reservation, { type = "", trajet = false } = {}) {
  const r = reservation || {};
  if (type === "location") return null;
  const heure = propre(r.heure_pickup);
  const lieu = propre(r.lieu_pickup);
  if (!heure && !lieu) return null;
  if (TYPES_TRAJET.includes(type) && !trajet && !lieu) return null;
  return { heure, lieu };
}
export function lignePickup(p) {
  if (!p) return "";
  const ou = [p.heure ? `at ${p.heure}` : "", p.lieu ? `at ${p.lieu}` : ""].filter(Boolean).join(" ");
  return ou ? `Your pickup will be ${ou}.` : "";
}

// `paiement` : statutPaiementVoucher (« paye », « acompte », « sur_place », « en_attente ») ; `solde` : ce qui reste dû sur le dossier ;
// `devise` : celle du dossier (THB par défaut).
export function phrasePaiement({ paiement = "", solde = null, devise = "THB" } = {}) {
  if (paiement === "paye") return DEJA_PAYE;
  if (paiement === "acompte" && Number(solde) > 0) return `The remaining ${montant(Number(solde))} ${devise || "THB"} will be collected in cash directly by the driver.`;
  return PAIEMENT_CHAUFFEUR;
}

export function variablesVoucher({ reservation = null, type = "", trajet = false, paiement = "", solde = null, devise = "THB", entreprise = "" } = {}) {
  return {
    paiement: phrasePaiement({ paiement, solde, devise }),
    pickup: lignePickup(pickupDuVoucher(reservation, { type, trajet })),
    jour: TYPES_TRAJET.includes(type) ? "trip" : type === "transfert" ? "transfer" : "activity",
    ENTREPRISE: propre(entreprise).toUpperCase(),
  };
}

// Après remplissage : une variable vide ne laisse ni ligne vide en trop ni paragraphe vide (« {pickup} » sans pickup).
export const sansLignesVides = (t) =>
  String(t || "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
