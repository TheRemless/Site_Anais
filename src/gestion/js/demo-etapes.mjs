// Démonstration des étapes WhatsApp (migration 105) : ce que la base et la fonction « whatsapp » font en vrai, en plus simple, pour la démo
// enregistrée dans le navigateur. Aucune donnée réelle.
//   - etapeManuelleLocale : comme whatsapp_etape_outil (clés secret, taxi, aucune ; étapes connues ; heure du moment ; un choix inchangé garde
//     son heure ; vide, plus de choix). Une valeur refusée lève, comme la base.
//   - faitsDemo : les faits d'une conversation de démo (premier et dernier message du client, dernier prix et dernière demande, voucher
//     envoyé). L'entreprise d'un prix est celle de la conversation, ou celle du tri. La vraie règle est dans supabase/functions/whatsapp/etapes.js.
import { VALEURS_ETAPES, CLES_ENTREPRISE } from "./whatsapp-etapes-calc.mjs";

export function etapeManuelleLocale(ancien, nouveau) {
  if (nouveau === null || nouveau === undefined) return null;
  if (typeof nouveau !== "object" || Array.isArray(nouveau)) throw new Error("Étape manuelle illisible.");
  const propre = {};
  for (const [cle, v] of Object.entries(nouveau)) {
    if (!CLES_ENTREPRISE.includes(cle) || !v || typeof v !== "object" || !VALEURS_ETAPES.includes(v.etape)) throw new Error("Étape manuelle inconnue.");
    const avant = ancien && ancien[cle];
    // Renvoyée telle quelle (même étape, même heure) : garde son heure ; rechoisie (heure vide) ou changée : l'heure du moment.
    propre[cle] = { etape: v.etape, le: avant && avant.etape === v.etape && v.le && v.le === avant.le ? avant.le : new Date().toISOString() };
  }
  return Object.keys(propre).length ? propre : null;
}

const PRIX = /\d[\d,.'’]*\s*(?:thb|baht|฿)/i;
const DEMANDE = /\?|how much|price|book/i;
export function faitsDemo(c, messages = [], marque = null) {
  const v = messages.filter((m) => m.conversation_id === c.id && !m.supprime_le && m.type !== "reaction").sort((a, b) => String(a.envoye_le).localeCompare(String(b.envoye_le)));
  const entrants = v.filter((m) => m.sens === "entrant");
  const cle = marque || (c.tri && ["secret", "taxi"].includes(c.tri.entreprise) ? c.tri.entreprise : "inconnu");
  const par = {};
  const vouchers = [];
  for (const m of v) {
    if (m.sens === "sortant" && PRIX.test(m.texte || "")) (par[cle] = par[cle] || {}).prix_le = m.envoye_le;
    if (m.sens === "entrant" && DEMANDE.test(m.texte || "")) (par[cle] = par[cle] || {}).demande_le = m.envoye_le;
    const media = (m.medias || []).find((x) => x && x.statut === "voucher");
    if (m.sens === "sortant" && media) vouchers.push({ le: m.envoye_le, reservation_id: media.reservation_id || null });
  }
  const pret = c.pret_reserver && c.pret_reserver.pret ? { le: c.pret_reserver.le, depuis: c.pret_reserver.depuis, entreprise: cle === "inconnu" ? null : cle } : null;
  return {
    v: 2,
    premier_client_le: entrants.length ? entrants[0].envoye_le : null,
    dernier_client_le: entrants.length ? entrants.at(-1).envoye_le : null,
    par,
    pret,
    vouchers,
    calcule_le: new Date().toISOString(),
  };
}
