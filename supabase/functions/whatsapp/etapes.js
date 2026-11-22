// Boîte WhatsApp, étapes d'une conversation de client (migration 105, 22.11.2026). Logique pure, sans réseau et sans IA : la fonction
// « whatsapp » (pret.ts) l'importe et garde le résultat dans whatsapp_conversations.avancee ; l'écran le combine avec les dossiers, les
// réservations et les vouchers (src/gestion/js/whatsapp-etapes-calc.mjs). Ici seulement ce que disent les messages :
//   - premier et dernier message du client, première demande (formulaire du site, question de prix, de réservation, de disponibilité) ;
//   - dernier prix donné par Nani, par entreprise (Taxi pour un transfert, Secret pour une excursion) ;
//   - « Prêt à réserver » (pret.js, #313) et son entreprise ;
//   - dernier voucher ou confirmation envoyé par Nani depuis son téléphone (un envoi depuis Gestion est déjà noté sur la réservation).
// L'entreprise d'un prix se lit dans le message de Nani puis dans la demande du client qui le précède (mots du transfert ou de l'excursion),
// sinon dans le tri existant (tri.entreprise, déjà calculé, aucun appel de plus), sinon elle reste inconnue.
import { plat, contientPrix, etatPret, conversationPossible, estRecapitulatif, MESSAGES_LUS } from "./pret.js";

export const ENTREPRISES = ["secret", "taxi"];
const L = "(?<![\\p{L}\\p{N}])";
const R = "(?![\\p{L}\\p{N}])";
const re = (corps) => new RegExp(`${L}(?:${corps})${R}`, "gu");
// « round trip » est un aller-retour en voiture (cas C47) : compté pour Taxi, jamais pour Secret.
const MOTS_TAXI = re("transfers?|taxis?|minivans?|mini van|vans?|cars?|drivers?|chauffeur|songthaew|airport|aeroport|pick-?up and drop-?off|one way|round trip|aller simple|aller-retour|trajet|course|ride|lift");
const MOTS_SECRET = re("tours?|day trip|boat trip|island trip|islands?|iles?|boats?|speedboat|longtail|snorkel\\w*|kayak\\w*|excursions?|plongee|diving|dive|atv|elephants?|cooking|national park|parc national|sunset|mangroves?|viewpoint|beach day");
const compte = (r, t) => (t.match(r) || []).length;
// « secret », « taxi » ou null d'après les mots ; à égalité, null.
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

// Une demande du client : le formulaire du site, ou une question sur un prix, une réservation, une disponibilité. Pas « disponible » en
// français : il revient dans les messages privés (cas C16, un rendez-vous).
const DEMANDE = re("transfer request|how much|price|prices|cost|quote|offer|book|booking|reserve|reservation|available|availability|combien|prix|tarif|devis|reserver");
// Un refus ou une annulation du client : l'échange s'arrête là (cas C17, C46, C48).
const REFUS = re("no,? thanks?|no,? thank you|no,? but thank|non merci|not need|no longer need|don'?t need|no need|changed (?:our|my) plans?|plans? (?:are|is) different|found (?:another|something else)|plus besoin|pas besoin|cancel(?!lation)\\w*|annul\\w*");
const ENVOYEE = re(
  [
    "(?:see|find) (?:the )?attached (?:booking )?(?:confirmation|voucher)",
    "(?:this is|here is|here's|voici|voila)\\s+(?:you |your |votre |ta |la |le )?(?:booking )?(?:confirmation|voucher)",
    "(?:votre|ta) (?:confirmation|voucher) (?:est )?(?:en piece jointe|ci-joint)",
  ].join("|")
);
const texteDe = (m) => [m.texte || "", ...((m.medias || []).map((x) => (x && x.legende) || ""))].join("\n").trim();
const vivants = (messages = []) => messages.filter((m) => m && !m.supprime_le && m.type !== "reaction").sort((a, b) => String(a.envoye_le).localeCompare(String(b.envoye_le)));
const entrepriseTri = (conv) => (conv && conv.tri && ENTREPRISES.includes(conv.tri.entreprise) ? conv.tri.entreprise : null);

// L'entreprise d'un message de Nani : ses propres mots, puis le tri (déjà calculé), puis les mots des messages du client juste avant (trois
// au plus).
function entrepriseDuMessage(v, i, conv) {
  const avant = [];
  for (let j = i - 1; j >= 0 && avant.length < 3; j--) if (v[j].sens === "entrant") avant.push(texteDe(v[j]));
  return entrepriseDesMots([texteDe(v[i])]) || entrepriseTri(conv) || entrepriseDesMots(avant);
}

// Les faits gardés sur la conversation (colonne avancee) : dates et entreprises seulement, jamais un texte de message.
export function faitsAvancee(conv, messages = [], maintenant = new Date().toISOString()) {
  if (!conversationPossible(conv)) return { v: 1, client: false, calcule_le: maintenant };
  const v = vivants(messages).slice(-MESSAGES_LUS);
  const entrants = v.filter((m) => m.sens === "entrant");
  const prix = { secret: null, taxi: null, inconnu: null };
  let voucher = null;
  v.forEach((m, i) => {
    if (m.sens !== "sortant") return;
    const t = texteDe(m);
    if (contientPrix(t)) prix[entrepriseDuMessage(v, i, conv) || "inconnu"] = m.envoye_le;
    if (ENVOYEE.test(plat(t)) || estRecapitulatif(t)) voucher = m.envoye_le;
    ENVOYEE.lastIndex = 0;
  });
  const refus = [...entrants].reverse().find((m) => {
    const ok = REFUS.test(plat(texteDe(m)));
    REFUS.lastIndex = 0;
    return ok;
  });
  const demande = entrants.find((m) => {
    const ok = DEMANDE.test(plat(texteDe(m)));
    DEMANDE.lastIndex = 0;
    return ok;
  });
  const p = etatPret(conv, v, maintenant);
  let pret = null;
  if (p.pret) {
    const i = v.findIndex((m) => m.envoye_le === p.depuis && m.sens === "sortant");
    const j = v.findIndex((m) => m.envoye_le === p.le);
    pret = { le: p.le, depuis: p.depuis, entreprise: (i >= 0 ? entrepriseDuMessage(v, i, conv) : null) || (j >= 0 ? entrepriseDuMessage(v, j, conv) : null) || null };
  }
  const annule = p.pret === false && p.motif === "annule";
  return {
    v: 1,
    client: true,
    premier_client_le: entrants.length ? entrants[0].envoye_le : null,
    dernier_client_le: entrants.length ? entrants.at(-1).envoye_le : null,
    demande_le: demande ? demande.envoye_le : null,
    prix,
    pret,
    annule: annule || undefined,
    refus_le: refus ? refus.envoye_le : null,
    voucher_le: voucher,
    calcule_le: maintenant,
  };
}
