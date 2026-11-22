// Le message au client qui accompagne la Booking confirmation (Taxi) ou le voucher (Secret) : les deux modèles de Jérémy du 22.11.2026,
// rangés dans les messages de l'entreprise (defauts.mjs, usage « voucher »), modifiables dans l'écran Messages. Logique pure : les variables
// propres à ce message, d'après le dossier seulement, jamais un fait absent.
//   {paiement} (Taxi) : la phrase du paiement au chauffeur ; « Your transfer is already paid. » quand le dossier est payé ;
//   {pickup} (Secret) : une ligne par pickup connu (heure et lieu du dossier) ; rien sans pickup (rendez-vous sur place, location) : la
//     ligne disparaît, rien n'est inventé ;
//   {jour} (Secret) : « transfer » pour un transfert, « activity » sinon ;
//   {ENTREPRISE} : le nom de l'entreprise en capitales (« VIP TAXI LANTA », comme dans le modèle de Jérémy).
// Utilisé par l'envoi direct du voucher dans la conversation (PR 304), le lien wa.me et les cartes « Voucher » de l'Assistant, par
// messageClientVoucher (views/voucher-envoi.mjs). Le point du soir garde son modèle « rappel ». Tests : tests/gestion-message-voucher.test.js.

export const PAIEMENT_CHAUFFEUR = "Payment will be collected in cash directly by the driver (or you can pay through Wise before your transfer (3% fee), please let us know before.)";
export const DEJA_PAYE = "Your transfer is already paid.";

const propre = (v) => String(v || "").replace(/\s+/g, " ").trim();

// Une ligne de pickup : l'heure et le lieu du dossier, ce qui est connu seulement. `plusieurs` : le service et la date précisent la ligne.
function lignePickup({ heure, lieu, prestation, date }, plusieurs) {
  const h = propre(heure);
  const l = propre(lieu);
  if (!h && !l) return "";
  const ou = [h ? `at ${h}` : "", l ? `at ${l}` : ""].filter(Boolean).join(" ");
  const pour = plusieurs ? [propre(prestation) ? ` for ${propre(prestation)}` : "", propre(date) ? ` on ${propre(date)}` : ""].join("") : "";
  return `Your pickup${pour} will be ${ou}.`;
}

// `services` : [{ heure, lieu, prestation, date, type }] (un par réservation du voucher) ; `type` : celui du voucher (« transfert »,
// « location », une activité…) ; `paye` : le dossier est entièrement payé (statutPaiementVoucher rend « paye ») ; `entreprise` : son nom.
export function variablesVoucher({ services = [], type = "", paye = false, entreprise = "" } = {}) {
  const liste = (services || []).filter(Boolean);
  // Une location n'a pas de pickup : sa ligne ne s'écrit pas, même avec une heure de remise.
  const avecPickup = liste.filter((s) => (s.type || type) !== "location");
  const lignes = [...new Set(avecPickup.map((s) => lignePickup(s, avecPickup.length > 1)).filter(Boolean))];
  return {
    paiement: paye ? DEJA_PAYE : PAIEMENT_CHAUFFEUR,
    pickup: lignes.join("\n"),
    jour: type === "transfert" ? "transfer" : "activity",
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
