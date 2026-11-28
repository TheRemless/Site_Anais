// Le numéro du client d'une demande ou d'une carte de l'Assistant, repris de sa conversation WhatsApp : un numéro recopié à la main peut
// être coupé, et la conversation rester sans client ni dossier.
//   - Conversation liée (l'Assistant ouvert depuis WhatsApp) : la règle du serveur (telephoneDeCarte, fonction agent, PR 355), à l'identique :
//     vide, le même numéro ou sa forme locale (« 081… », les derniers chiffres) → le numéro complet de la conversation ; un autre numéro est
//     gardé (celui d'un proche).
//   - Sans conversation liée : les conversations dont le nom affiché est contenu dans le nom du client, pas encore reliées à une fiche, sont
//     proposées. Rien n'est repris sans un geste : un prénom courant peut désigner quelqu'un d'autre.
// Logique pure, testée par tests/gestion-telephone-complet.test.js.
import { sansAccents, nettoyerTelephone } from "./partenaires-calc.mjs";

const chiffresDe = (t) => nettoyerTelephone(t).replace(/\D/g, "").replace(/^00/, "");
// Les civilités et les mots génériques ne désignent personne : « Mr Hotel » ne propose pas toutes les conversations d'un « Hotel ».
const GENERIQUES = new Set(["mr", "mrs", "ms", "miss", "mister", "madame", "mme", "mlle", "monsieur", "dr", "sir", "hotel", "villa", "villas", "resort", "room", "guest", "client", "family", "famille", "the", "and", "et", "de", "du", "la", "le", "les", "khun", "nong", "pi", "boat", "taxi", "tour", "tours"]);
const mots = (t) => sansAccents(t).replace(/[^a-z\s]/g, " ").split(/\s+/).filter((m) => m.length >= 2 && !GENERIQUES.has(m));
// Une conversation de client (pas un partenaire, un apporteur ni un contact personnel), comme la liaison après un dossier (whatsapp-suivi-calc).
const deClient = (c) => !!c && (!c.type_contact || c.type_contact === "client") && !c.partenaire_id && c.reponses !== "jamais";
// Le champ ne porte que le numéro de la conversation, ou son début (coupé), ou rien.
const debutDe = (saisi, complet) => !saisi || complet.startsWith(saisi);

// Copie exacte de telephoneDeCarte (supabase/functions/agent/outils.js) : l'écran et le serveur suivent la même règle (testé).
export function telephoneDeCarte(saisi, telWa) {
  const s = String(saisi || "").trim();
  const wa = String(telWa || "").trim();
  const chiffresWa = wa.replace(/\D/g, "");
  if (chiffresWa.length < 6 || chiffresWa.length > 15) return s;
  const complet = `+${chiffresWa}`;
  const chiffres = s.replace(/\D/g, "").replace(/^0+/, "");
  if (!chiffres) return complet;
  if (chiffres === chiffresWa || (chiffres.length >= 6 && chiffresWa.endsWith(chiffres))) return complet;
  return s;
}

// Copie exacte de conversationDansEntreprise (supabase/functions/agent/whatsapp.js) : la conversation liée ne sert (numéro, liaison) que dans
// l'entreprise de l'Assistant, ou encore à trier chez Secret et Taxi.
export function conversationDansEntreprise(conv, entiteId, slugActif = "") {
  if (!conv || !entiteId) return false;
  if (conv.entite_id === entiteId) return true;
  return conv.entite_id === null && ["secret", "taxi"].includes(slugActif);
}

// Les entreprises voisines où une conversation peut être proposée : seulement l'autre entreprise de l'espace unifié (Secret et Taxi),
// jamais ZTP, même pour un administrateur qui voit tout. `entites` : [{ id, slug }].
export function entreprisesVoisines(entites, entiteId) {
  const active = (entites || []).find((e) => e.id === entiteId);
  if (!active || !["secret", "taxi"].includes(active.slug)) return [];
  return (entites || []).filter((e) => e.id !== entiteId && ["secret", "taxi"].includes(e.slug)).map((e) => e.id);
}

// `saisi` : le téléphone de la carte ou du champ. `liee` : la conversation WhatsApp liée, ou null. `conversations` : celles que la personne voit.
// `nomClient` : le nom écrit sur la carte. `entites` : les entreprises où la conversation peut servir (celle du dossier, et l'autre de l'espace
// unifié Secret et Taxi). `depuis` : date ISO en deçà de laquelle une conversation n'est plus proposée (30 jours par défaut avant `aujourdhui`).
// Renvoie { telephone, whatsappId, candidats: [{ id, nom, telephone, dernier }] }.
export function telephoneDepuisWhatsApp({ saisi = "", liee = null, conversations = [], nomClient = "", entites = [], aujourdhui = "" } = {}) {
  const tel = String(saisi || "").trim();
  const lus = chiffresDe(tel);
  if (liee && deClient(liee) && chiffresDe(liee.telephone).length >= 8) {
    // La règle du serveur ; en plus, un numéro coupé (le début du numéro de la conversation) est complété.
    const serveur = telephoneDeCarte(tel, liee.telephone);
    const complet = chiffresDe(liee.telephone);
    return { telephone: serveur === tel && lus && debutDe(lus, complet) ? `+${complet}` : serveur, whatsappId: liee.id, candidats: [] };
  }
  const nom = new Set(mots(nomClient));
  if (!nom.size) return { telephone: tel, whatsappId: null, candidats: [] };
  const limite = aujourdhui ? new Date(Date.parse(`${aujourdhui}T00:00:00Z`) - 30 * 86400000).toISOString() : "";
  const candidats = (conversations || [])
    .filter((c) => deClient(c) && !c.client_id && c.id && chiffresDe(c.telephone).length >= 8)
    .filter((c) => !c.entite_id || entites.includes(c.entite_id))
    .filter((c) => !limite || String(c.dernier_message_le || "") >= limite)
    .filter((c) => {
      const m = mots(c.nom);
      return m.length > 0 && m.every((x) => nom.has(x));
    })
    .filter((c) => debutDe(lus, chiffresDe(c.telephone)))
    .sort((a, b) => String(b.dernier_message_le || "").localeCompare(String(a.dernier_message_le || "")))
    .slice(0, 3)
    .map((c) => ({ id: c.id, nom: c.nom || "", telephone: c.telephone, dernier: String(c.dernier_message_le || "").slice(0, 10) }));
  return { telephone: tel, whatsappId: null, candidats };
}
