// Boîte WhatsApp, étapes d'une conversation de client (migration 105, 22.11.2026, corrigé après la relecture). Logique pure, sans réseau
// et sans IA : la fonction « whatsapp » (pret.ts) l'importe et garde le résultat dans whatsapp_conversations.avancee ; l'écran le combine
// avec les dossiers, les réservations et les vouchers (src/gestion/js/whatsapp-etapes-calc.mjs). Ici seulement ce que disent les messages,
// des dates et des entreprises, jamais un texte :
//   - premier et dernier message du client ;
//   - par entreprise (« secret », « taxi », « inconnu ») : dernier prix donné par Nani, dernière demande du client, dernier refus ou
//     annulation du client. Un prix ne compte qu'en bahts (THB, baht, ฿) : un prix en CHF, en euros ou en dollars est celui de ZTP, qui ne
//     se mélange jamais ;
//   - « Prêt à réserver » (pret.js, #313) et son entreprise ;
//   - les vouchers vraiment envoyés, à l'heure exacte : l'image rangée par whatsapp-envoi (média « voucher », réservation connue), ou une
//     image ou un PDF envoyé par Nani depuis son téléphone avec les mots « voucher » ou « booking confirmation » (dans sa légende ou dans un
//     texte envoyé dans les 3 minutes). Un récapitulatif écrit n'est pas un voucher.
// L'entreprise d'un message se lit dans ses mots (transfert ou excursion), puis dans le tri déjà calculé (aucun appel de plus), puis dans
// la demande du client juste avant ; sinon elle reste inconnue.
// Un Contact personnel n'est jamais lu : { jamais: true }. Le type du contact (partenaire, apporteur) est jugé à l'écran sur sa valeur du
// moment : un contact remis en Client est repris tout de suite.
import { plat, etatPret, contientPrix, MESSAGES_LUS } from "./pret.js";

export const ENTREPRISES = ["secret", "taxi"];
export const VERSION_FAITS = 2;
const L = "(?<![\\p{L}\\p{N}])";
const R = "(?![\\p{L}\\p{N}])";
const reG = (corps) => new RegExp(`${L}(?:${corps})${R}`, "gu");
const re = (corps) => new RegExp(`${L}(?:${corps})${R}`, "u");
// « round trip » est un aller-retour en voiture (cas C47) : compté pour Taxi, jamais pour Secret.
const MOTS_TAXI = reG("transfers?|taxis?|minivans?|mini van|vans?|cars?|drivers?|chauffeur|songthaew|airport|aeroport|pick-?up and drop-?off|one way|round trip|aller simple|aller-retour|trajet|course|ride|lift");
const MOTS_SECRET = reG("tours?|day trip|boat trip|island trip|islands?|iles?|boats?|speedboat|longtail|snorkel\\w*|kayak\\w*|excursions?|plongee|diving|dive|atv|elephants?|cooking|national park|parc national|sunset|mangroves?|viewpoint|beach day");
const compte = (r, t) => (t.match(r) || []).length;
// « secret », « taxi » ou null d'après les mots ; à égalité, on passe au texte suivant.
export function entrepriseDesMots(textes = []) {
  for (const t of textes) {
    const p = plat(t);
    if (!p) continue;
    const taxi = compte(MOTS_TAXI, p);
    const secret = compte(MOTS_SECRET, p);
    if (taxi > secret) return "taxi";
    if (secret > taxi) return "secret";
  }
  return null;
}

// Un prix de Secret ou de Taxi : en bahts seulement. « price is 2400 » sans monnaie compte aussi (Nani écrit en bahts).
const PRIX_BAHT = /(?:฿\s*\d[\d,.' ]*\d|\d(?:[\d,.']*\d)?\s*(?:thb|bahts?|฿)(?![\p{L}])|(?:price|prix|tarif)\s+(?:is|est|de|:)\s*\d{3,}(?![\d,.']*\s*(?:chf|eur|euros?|€|usd|\$)))/u;
export const prixEnBahts = (texte) => PRIX_BAHT.test(plat(texte));

// Une demande du client : le formulaire du site, ou une question (un « ? » ou une formule de demande) sur un prix, une réservation, une
// disponibilité. Pas « disponible » en français : il revient dans les messages privés (cas C16). « I'll think about the price » n'est pas une
// demande (cas C35) : ni question ni formule.
const DEMANDE = re("how much|price|prices|cost|quote|offer|book|booking|reserve|reservation|available|availability|combien|prix|tarif|devis|reserver|transfer|taxi|tour|trip|excursion");
const FORMULAIRE = /^\s*transfer request\s*:/i;
const FORMULE = re("(?:i|we)(?:'d| would)? (?:like|want|need|wanna)|could you|can you|can we|is it possible|je voudrais|nous voudrions|j'aimerais|nous aimerions|je souhaite|nous souhaitons|pouvez-vous|est-ce possible");
const estDemande = (texte, p) => FORMULAIRE.test(texte) || (DEMANDE.test(p) && (/\?/.test(texte) || FORMULE.test(p)));
// Un refus ou une annulation du client, pour l'échange en cours : « No need for a child seat » ou « don't need a car seat » ne sont pas des
// refus (relecture n° 5).
const REFUS = re(
  [
    "no,? thanks?",
    "no,? thank you",
    "no,? but thank",
    "non,? merci",
    "no longer need",
    "(?:do not|don'?t|not) need (?:it|this|that|the (?:taxi|transfer|tour|trip|car|driver|boat)) ?(?:anymore|any more)?(?![\\p{L}\\p{N}] (?:for|a|an))",
    "no need (?:anymore|any more)",
    "not need it",
    "changed (?:our|my) plans?",
    "plans? (?:are|is) different",
    "found (?:another|something else)",
    "plus besoin",
    "(?:please )?cancel (?:it|this|that|the (?:booking|reservation|trip|transfer|tour|taxi|driver)|our|my)",
    "(?:want|would like|need) to cancel",
    "(?:possible|can we|could we|can i|could i) (?:to )?cancel",
    "please cancel",
    "annul(?:er|ez|e|ee)(?: (?:la|le|notre|ma|mon|la reservation))?",
  ].join("|")
);
// Les mots d'un voucher ou d'une Booking confirmation envoyés en image ou en PDF.
const MOTS_VOUCHER = re("voucher|vouchers|booking confirmation|confirmation de reservation|bon de reservation|(?:your|votre|ta) confirmation|attached confirmation|confirmation (?:attached|ci-jointe)");
const texteDe = (m) => [m.texte || "", ...((m.medias || []).map((x) => (x && x.legende) || ""))].join("\n").trim();
const vivants = (messages = []) => messages.filter((m) => m && !m.supprime_le && m.type !== "reaction" && m.type !== "non_transmis").sort((a, b) => String(a.envoye_le).localeCompare(String(b.envoye_le)));
const entrepriseTri = (conv) => (conv && conv.tri && ENTREPRISES.includes(conv.tri.entreprise) ? conv.tri.entreprise : null);

// L'entreprise d'un message de Nani : ses propres mots, puis le tri (déjà calculé), puis les mots des messages du client juste avant.
function entrepriseDuMessage(v, i, conv) {
  const avant = [];
  for (let j = i - 1; j >= 0 && avant.length < 3; j--) if (v[j].sens === "entrant") avant.push(texteDe(v[j]));
  return entrepriseDesMots([texteDe(v[i])]) || entrepriseTri(conv) || entrepriseDesMots(avant);
}
// L'entreprise d'un message du client : ses mots, puis le tri.
const entrepriseDuClient = (m, conv) => entrepriseDesMots([texteDe(m)]) || entrepriseTri(conv);
const estMedia = (m) => ["image", "document"].includes(m.type) || (m.medias || []).some((x) => x && ["image", "document"].includes(x.type));
const TROIS_MIN = 3 * 60 * 1000;
const t = (iso) => Date.parse(iso || "") || 0;

// Les faits gardés sur la conversation (colonne avancee).
export function faitsAvancee(conv, messages = [], maintenant = new Date().toISOString()) {
  if (!conv || conv.reponses === "jamais") return { v: VERSION_FAITS, jamais: true, calcule_le: maintenant };
  const v = vivants(messages).slice(-MESSAGES_LUS);
  const entrants = v.filter((m) => m.sens === "entrant");
  const par = { secret: {}, taxi: {}, inconnu: {} };
  // L'entreprise du dernier échange (prix de Nani ou demande du client) : celle que vise un refus.
  let dernierEchange = null;
  const vouchers = [];
  v.forEach((m, i) => {
    const texte = texteDe(m);
    if (m.sens === "sortant") {
      if (prixEnBahts(texte)) {
        const cle = entrepriseDuMessage(v, i, conv) || "inconnu";
        par[cle].prix_le = m.envoye_le;
        dernierEchange = cle;
      }
      // Voucher envoyé depuis Gestion : le média rangé par whatsapp-envoi, sauf un envoi en échec.
      const media = (m.medias || []).find((x) => x && x.statut === "voucher");
      if (media) {
        if (m.statut_envoi !== "echec") vouchers.push({ le: m.envoye_le, reservation_id: media.reservation_id || null });
      }
      // Depuis le téléphone : une image ou un PDF, avec les mots d'un voucher dans sa légende ou dans un texte de Nani à 3 minutes près.
      else if (estMedia(m)) {
        const proches = v.filter((x) => x.sens === "sortant" && Math.abs(t(x.envoye_le) - t(m.envoye_le)) <= TROIS_MIN).map(texteDe);
        if (proches.some((x) => MOTS_VOUCHER.test(plat(x)))) vouchers.push({ le: m.envoye_le, reservation_id: null });
      }
      return;
    }
    if (m.sens !== "entrant") return;
    const p = plat(texte);
    if (REFUS.test(p)) {
      // Le refus vise l'échange en cours : l'entreprise du dernier prix ou de la dernière demande, sinon celle du message, sinon inconnue.
      const cle = dernierEchange || entrepriseDuClient(m, conv) || "inconnu";
      par[cle].refus_le = m.envoye_le;
    } else if (estDemande(texte, p)) {
      const cle = entrepriseDuClient(m, conv) || "inconnu";
      par[cle].demande_le = m.envoye_le;
      dernierEchange = cle;
    }
  });
  const p = etatPret(conv, v, maintenant);
  let pret = null;
  if (p.pret) {
    const i = v.findIndex((m) => m.envoye_le === p.depuis && m.sens === "sortant");
    const j = v.findIndex((m) => m.envoye_le === p.le);
    // Un « prêt » sur un prix qui n'est pas en bahts (ZTP) n'a pas d'entreprise ici. Sans prix dans le message (« secured your booking »),
    // l'entreprise se lit comme pour un autre message.
    const ref = i >= 0 ? texteDe(v[i]) : "";
    const enBahts = !(contientPrix(ref) && !prixEnBahts(ref));
    pret = { le: p.le, depuis: p.depuis, entreprise: enBahts ? (i >= 0 ? entrepriseDuMessage(v, i, conv) : null) || (j >= 0 ? entrepriseDuMessage(v, j, conv) : null) : "ztp" };
  }
  for (const cle of Object.keys(par)) if (!Object.keys(par[cle]).length) delete par[cle];
  return {
    v: VERSION_FAITS,
    premier_client_le: entrants.length ? entrants[0].envoye_le : null,
    dernier_client_le: entrants.length ? entrants.at(-1).envoye_le : null,
    par,
    pret,
    vouchers: vouchers.slice(-6),
    calcule_le: maintenant,
  };
}
