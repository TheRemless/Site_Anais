// Type du contact déduit par le sens de la conversation (migration 110, 22.11.2026), côté écran. Logique pure, sans navigateur. Même règle que
// la fonction (supabase/functions/whatsapp/type-contact.js : partenaireProbable, partenaireDeduit, typeDeNani), un test compare les deux.
//   - « déduit » : le type « partenaire » posé par la fonction (type_source = 'deduit'). Nani le confirme ou le change d'un tap ;
//   - « partenaire probable » : pas encore de type, la dernière décision du tri dit « partenaire » ou les repères sans IA sont nets. Rien
//     n'est posé et rien ne change pour ce contact (seul le prix reste à fixer, côté fonction) : l'écran le dit, Nani tape « Partenaire » si
//     c'est juste ;
//   - un type posé ou retiré par Nani n'est jamais touché ; un Contact personnel n'est jamais lu.
import { N_ } from "./i18n.mjs";

const TYPES = ["client", "partenaire", "apporteur", "personnel", "inconnu"];
// Seule la décision type_contact du tri compte (relecture du 22.11.2026 : l'ancien motif « partenaire » ne compte plus).
const decisionsDe = (conv) => (conv && conv.type_avis && Array.isArray(conv.type_avis.decisions) ? conv.type_avis.decisions.filter((x) => x && TYPES.includes(x.type)) : []);
const derniereNette = (decisions) => [...decisions].reverse().find((d) => d.type !== "inconnu") || null;
const signauxNets = (conv) => !!(conv && conv.type_signaux && conv.type_signaux.nets === true && !conv.type_signaux.jamais);

export const partenaireDeduit = (conv) => !!conv && conv.type_contact === "partenaire" && conv.type_source === "deduit";
export function partenaireProbable(conv) {
  if (!conv || conv.reponses === "jamais") return false;
  if (conv.type_contact === "partenaire" || conv.partenaire_id) return true;
  if (conv.type_contact || conv.type_source === "nani") return false;
  const derniere = derniereNette(decisionsDe(conv));
  return (!!derniere && derniere.type === "partenaire") || signauxNets(conv);
}
// Probable mais pas encore posé : ce que l'écran signale à Nani.
export const partenaireSuggere = (conv) => !!conv && !conv.type_contact && !conv.partenaire_id && partenaireProbable(conv);

// Les repères, dits à Nani (les codes de type_signaux, jamais un texte).
export const LIBELLES_REPERES = {
  transfert_demande: N_("vous lui transférez la demande d'un client"),
  dispo_demandee: N_("vous lui demandez s'il est disponible"),
  prix_du_contact: N_("il vous donne ses prix"),
  pax_prix: N_("il parle en « pax » avec un prix"),
  clients_nani: N_("vous lui parlez de vos clients"),
  clients_contact: N_("il parle de clients"),
  prise_en_charge: N_("il confirme une prise en charge"),
  sur_place: N_("il dit qu'il est sur place ou « done »"),
  thai_nani: N_("vous lui écrivez en thaï"),
  commission: N_("il est question de net ou de commission"),
};
// La raison à montrer : celle du tri (une phrase courte de Haiku), sinon deux repères au plus. Rend { texte } ou { cles: [...] } (à
// traduire à l'écran), ou null.
export function raisonPartenaire(conv) {
  const d = [...decisionsDe(conv)].reverse().find((x) => x.type === "partenaire" && x.raison);
  if (d) return { texte: String(d.raison).slice(0, 120) };
  const codes = (conv && conv.type_signaux && conv.type_signaux.codes) || {};
  const cles = Object.keys(LIBELLES_REPERES).filter((c) => codes[c]).slice(0, 2);
  return cles.length ? { cles: cles.map((c) => LIBELLES_REPERES[c]) } : null;
}
// Confirmer un type déduit : il devient celui de Nani (la base n'accepte que « nani » depuis l'outil).
export const patchConfirmerType = () => ({ type_source: "nani" });
