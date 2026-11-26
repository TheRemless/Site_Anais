// Le numéro du client d'une demande ou d'une carte de l'Assistant, repris de sa conversation WhatsApp (26.11.2026 : la carte
// avait un téléphone vide, le numéro a été recopié à la main et enregistré coupé, la conversation est restée sans client ni dossier).
//   - Conversation liée (l'Assistant ouvert depuis WhatsApp) : son numéro est repris en entier quand le champ est vide ou n'en est que le début.
//     Un autre numéro tapé à la main est gardé tel quel : c'est le choix de la personne.
//   - Sans conversation liée : les conversations dont le nom affiché est contenu dans le nom du client, pas encore reliées à une fiche, sont
//     proposées. Rien n'est repris sans un geste : un prénom courant peut désigner quelqu'un d'autre.
// Logique pure, testée par tests/gestion-telephone-complet.test.js.
import { sansAccents, nettoyerTelephone } from "./partenaires-calc.mjs";

const chiffresDe = (t) => nettoyerTelephone(t).replace(/\D/g, "").replace(/^00/, "");
const mots = (t) => sansAccents(t).replace(/[^a-z\s]/g, " ").split(/\s+/).filter((m) => m.length >= 2);
// Une conversation de client (pas un partenaire, un apporteur ni un contact personnel), comme la liaison après un dossier (whatsapp-suivi-calc).
const deClient = (c) => !!c && (!c.type_contact || c.type_contact === "client") && !c.partenaire_id && c.reponses !== "jamais";
// Le champ ne porte que le numéro de la conversation, ou son début (coupé), ou rien.
const debutDe = (saisi, complet) => !saisi || complet.startsWith(saisi);

// `saisi` : le téléphone de la carte ou du champ. `liee` : la conversation WhatsApp liée, ou null. `conversations` : celles que la personne voit.
// `nomClient` : le nom écrit sur la carte. `entites` : les entreprises où la conversation peut servir (celle du dossier, et l'autre de l'espace
// unifié Secret et Taxi). `depuis` : date ISO en deçà de laquelle une conversation n'est plus proposée (30 jours par défaut avant `aujourdhui`).
// Renvoie { telephone, whatsappId, candidats: [{ id, nom, telephone, dernier }] }.
export function telephoneDepuisWhatsApp({ saisi = "", liee = null, conversations = [], nomClient = "", entites = [], aujourdhui = "" } = {}) {
  const tel = String(saisi || "").trim();
  const lus = chiffresDe(tel);
  if (liee && deClient(liee) && chiffresDe(liee.telephone).length >= 8) {
    const complet = chiffresDe(liee.telephone);
    return { telephone: debutDe(lus, complet) ? liee.telephone : tel, whatsappId: liee.id, candidats: [] };
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
