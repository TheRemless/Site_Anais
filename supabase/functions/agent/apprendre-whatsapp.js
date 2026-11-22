// L'Assistant apprend des réponses que Nani écrit elle-même dans WhatsApp (22.11.2026, demande de Jérémy). Constat : les 16 réponses
// préparées traitées l'ont toutes été depuis l'app du téléphone (coexistence Telnyx) avec un texte de Nani très différent (plus court, autre
// ton, prix réels), que rien ne comparait ; agent_apprentissages restait vide.
//
// Appelé par la fonction « whatsapp » (index.ts) pour chaque nouveau message sortant écrit depuis l'app, et par « whatsapp-envoi » après un
// envoi parti depuis Gestion : une ligne, apprendreDeNani(db, conversation, message). Tout le reste est ici. Ne lève jamais.
// La correction est gardée (genre « reponse », source « whatsapp », migration 74) seulement si :
//   - la conversation est celle d'un client : ni partenaire, ni chauffeur, ni hôtel, ni apporteur, ni fiche partenaire reliée, ni
//     Contact personnel (reponses = 'jamais'). Un client sûr (typé « client », ou relié à une fiche client, clientPourApprendre ; un
//     dossier relié seul ne suffit pas) garde ses prix ; une conversation jamais typée (peut-être un chauffeur ou un hôtel pas encore classé, revue de
//     sécurité) ne garde aucune phrase avec un montant : seulement le ton et la tournure. Classée ensuite partenaire, chauffeur, hôtel,
//     apporteur ou Contact personnel, ses lignes sont effacées par la base (migration 74) ;
//   - l'IA est ouverte pour elle (réception active, agent allumé dans l'entreprise, comme iaPermise de whatsapp/proposer.js) et l'agent est
//     allumé dans l'entreprise où la ligne s'écrit : sinon rien de cette conversation ne doit finir dans un prompt ;
//   - une réponse préparée l'attendait : la plus récente de la conversation, encore à faire, en envoi ou traitée (pas remplacée, ignorée,
//     en échec ni en préparation), créée moins de FENETRE_APPRENDRE_MS avant le message de Nani ;
//   - le message de Nani est son premier vrai message après cette réponse préparée (un emoji ou un « ok » ne compte pas, le suivant
//     oui) et aucun message du client n'est arrivé entre les deux ;
//   - l'écart est réel (partModifiee) : seulement les phrases changées, masquées comme anonymiser() (noms du client, du contact, du client
//     du dossier relié, des partenaires et des contacts typés ; téléphone, e-mail, lien, IBAN, nom après un titre), sans phrase interne
//     (net, commission, banque, marge chiffrée) ni phrase dont un montant est égal à un net de l'entreprise (nets du catalogue et des
//     partenaires, et ceux du dossier relié). Nets ou noms illisibles : rien, ou aucune phrase avec un montant.
// Une seule ligne par réponse préparée (index unique de la migration 74) : un événement rejoué ne note rien de plus.
import { correctionReponse, nombresBruts, propre } from "./apprendre.js";
import { conversationDeClient, dossierPourControle, netsPourControle } from "./outils.js";
import { nomsABloquer } from "./apporteur.js";
import { CONTACTS_NOMMES } from "./whatsapp-lecture.js";
import { montantsDe } from "./apprentissages.js";

export const FENETRE_APPRENDRE_MS = 2 * 3600 * 1000;
// Un vrai message : au moins 12 lettres (un « ❤️ », un « ok » ou une photo ne remplacent pas une réponse).
export const LETTRES_MIN = 12;
const STATUTS_COMPARABLES = ["a_faire", "envoi", "traitee"];

const lettres = (t) => (String(t || "").match(/\p{L}/gu) || []).length;
export const vraiMessage = (m) => !!m && m.sens === "sortant" && ["app", "gestion"].includes(m.origine) && (m.type || "text") === "text" && !m.supprime_le && lettres(m.texte) >= LETTRES_MIN;
const ms = (x) => Date.parse(x || "") || 0;

// Un client sûr pour garder des montants appris (revue de la PR 312) : typé « client », ou relié à une fiche client. Un dossier relié seul
// ne suffit pas (un concierge ou un hôtel non typé peut être relié à un dossier). clientConfirme (outils.js) ne change pas pour ses autres
// appelants.
export const clientPourApprendre = (c) => conversationDeClient(c) && (c.type_contact === "client" || !!c.client_id);

// Même règle que iaPermise (whatsapp/proposer.js, un test les compare) : réception active, conversation qui n'est pas un Contact personnel,
// agent allumé dans son entreprise (ou dans l'une des deux pour une conversation à trier).
// IA coupée pour la conversation (migration 105) ou client connu par son seul BSUID (migration 100) : fermée aussi. Client commun de Secret
// et Taxi (PR 316) : l'agent de l'une des deux suffit.
const clientCommunPour = (c) => !!c && (!c.type_contact || c.type_contact === "client") && !c.partenaire_id && c.reponses !== "jamais";
export function iaOuvertePour({ receptionActive, conv, agents = {} }) {
  if (receptionActive !== true || !conv || conv.reponses === "jamais" || conv.ia_coupee === true) return false;
  if (conv.telephone === null && !conv.type_contact) return false;
  if (conv.entite_id && !clientCommunPour(conv)) return agents[conv.entite_id] === true;
  return Object.values(agents).some((v) => v === true);
}

// La réponse préparée que le message de Nani remplace, ou null. `propositions` et `messages` : ceux de la conversation (dans n'importe
// quel ordre) ; `message` : celui de Nani.
export function propositionAComparer({ propositions = [], messages = [], message } = {}) {
  if (!vraiMessage(message)) return null;
  const t = ms(message.envoye_le);
  const avant = (propositions || []).filter((p) => p && ms(p.cree_le) <= t).sort((a, b) => ms(b.cree_le) - ms(a.cree_le));
  const p = avant[0];
  if (!p || !STATUTS_COMPARABLES.includes(p.statut) || !propre(p.texte)) return null;
  if (t - ms(p.cree_le) > FENETRE_APPRENDRE_MS) return null;
  const entre = (messages || []).filter((m) => m && m.id !== message.id && ms(m.envoye_le) > ms(p.cree_le) && (ms(m.envoye_le) < t || (ms(m.envoye_le) === t && String(m.id) < String(message.id))));
  if (entre.some((m) => m.sens === "entrant" && !m.supprime_le)) return null;
  if (entre.some((m) => vraiMessage(m))) return null;
  return p;
}

// La ligne à écrire, ou null. `nets` : nombres (nets du catalogue, nets et marges du dossier relié) ; `netsIllisibles` : aucune phrase avec
// un montant ne passe.
// `sansMontants` : conversation jamais typée ou nets illisibles, aucune phrase avec un montant.
// `noms` : client et contact, masqués mot par mot ; `entiers` : partenaires et contacts typés, masqués en entier.
export function ligneDeNani({ proposition, message, noms = [], entiers = [], nets = new Set(), sansMontants = false }) {
  const exclure = (phrase) => {
    const m = montantsDe({ avant: phrase });
    if (sansMontants) return m.length > 0;
    // Un net se reconnaît aussi collé ou petit (« 2x1200 », « net85 ») : tous les nombres bruts de la phrase.
    return m.some((n) => n === 0 || nets.has(n)) || nombresBruts(phrase).some((x) => nets.has(x.valeur));
  };
  const contexte = proposition.langue === "fr" ? "réponse WhatsApp en français" : proposition.langue === "en" ? "réponse WhatsApp en anglais" : "réponse WhatsApp";
  return correctionReponse(proposition.texte, message.texte, { noms, entiers, contexte, exclure });
}

// Rend ce qui a été fait (pour les tests et les journaux) : { note: true } ou { rien: motif }.
// `auteur` : la personne qui a envoyé depuis Gestion (whatsapp-envoi, session vérifiée) ; la ligne porte son user_id et l'agent dit son nom.
// Un message écrit depuis l'app du téléphone n'a pas d'auteur connu : user_id nul, l'agent dit « l'équipe ».
export async function apprendreDeNani(db, conversationId, messageId, { auteur = null } = {}) {
  try {
    if (!db || !conversationId || !messageId) return { rien: "entree" };
    const { data: message, error: errM } = await db.from("whatsapp_messages").select("id, conversation_id, sens, origine, type, texte, envoye_le, supprime_le").eq("id", messageId).eq("conversation_id", conversationId).maybeSingle();
    if (errM || !message) return { rien: "message" };
    if (!vraiMessage(message)) return { rien: "pas_une_reponse" };
    const { data: conv, error: errC } = await db.from("whatsapp_conversations").select("id, organisation_id, entite_id, nom, telephone, client_id, dossier_id, reponses, type_contact, partenaire_id, ia_coupee").eq("id", conversationId).maybeSingle();
    if (errC || !conv) return { rien: "conversation" };
    if (!conversationDeClient(conv)) return { rien: "pas_un_client" };
    const agents = await agentsOuverts(db, conv);
    if (!agents) return { rien: "ia_fermee" };
    const t = ms(message.envoye_le);
    const depuis = new Date(t - FENETRE_APPRENDRE_MS).toISOString();
    const { data: propositions, error: errP } = await db.from("whatsapp_propositions").select("id, cree_le, statut, texte, langue, entite_id").eq("conversation_id", conv.id).gte("cree_le", depuis).lte("cree_le", message.envoye_le).order("cree_le", { ascending: false }).limit(5);
    if (errP || !propositions || !propositions.length) return { rien: "aucune_proposition" };
    // Les 200 plus récents de la fenêtre, remis dans l'ordre chronologique.
    const { data: recents, error: errL } = await db.from("whatsapp_messages").select("id, sens, origine, type, texte, envoye_le, supprime_le").eq("conversation_id", conv.id).gte("envoye_le", depuis).lte("envoye_le", message.envoye_le).order("envoye_le", { ascending: false }).limit(200);
    if (errL) return { rien: "messages" };
    const messages = [...(recents || [])].reverse();
    const proposition = propositionAComparer({ propositions, messages, message });
    if (!proposition) return { rien: "rien_a_comparer" };
    const entiteId = proposition.entite_id || conv.entite_id;
    if (!entiteId) return { rien: "entreprise" };
    const { data: ent, error: errE } = await db.from("entites").select("id").eq("id", entiteId).eq("organisation_id", conv.organisation_id).maybeSingle();
    if (errE || !ent) return { rien: "entreprise" };
    // L'agent de l'entreprise où la ligne s'écrit doit être allumé (une conversation à trier passe avec l'autre).
    if (agents[entiteId] !== true) return { rien: "ia_fermee" };
    // Les noms à masquer : le contact (nom de la conversation), la fiche client reliée, le client du dossier relié, les partenaires de
    // l'entreprise et les contacts typés de l'organisation. Une lecture en échec : rien n'est noté.
    const dossier = conv.dossier_id ? await db.from("dossiers").select("client_id").eq("id", conv.dossier_id).eq("entite_id", entiteId).maybeSingle() : { data: null, error: null };
    const idsClients = [...new Set([conv.client_id, dossier.data && dossier.data.client_id].filter(Boolean))];
    const [clients, partenaires, types] = await Promise.all([
      idsClients.length ? db.from("clients").select("prenom, nom").in("id", idsClients) : Promise.resolve({ data: [], error: null }),
      db.from("partenaires").select("id, nom").eq("entite_id", entiteId).limit(2000),
      // Les contacts typés de l'organisation (comme nomsContactsTypes d'apporteur.js), avec leur type : un hôtel n'est pas une personne.
      db.from("whatsapp_conversations").select("id, nom, type_contact, partenaire_id").eq("organisation_id", conv.organisation_id).or(`type_contact.in.(${CONTACTS_NOMMES.join(",")}),partenaire_id.not.is.null`).limit(2000),
    ]);
    if (dossier.error || clients.error || partenaires.error || types.error) return { rien: "noms" };
    const noms = [conv.nom, ...(clients.data || []).flatMap((c) => [c.prenom, c.nom])].filter(Boolean);
    // Les partenaires en entier ; les contacts typés (souvent des personnes, « Prénom (driver) ») aussi mot par mot, hors mots courants.
    const typees = (types.data || []).filter((c) => c && c.id !== conv.id && typeof c.nom === "string" && c.nom.trim());
    const entiers = [...nomsABloquer(partenaires.data || []), ...typees.map((c) => ({ nom: c.nom.trim(), personne: c.type_contact !== "hotel" }))];
    const [lusNets, relie] = await Promise.all([netsPourControle(db, [entiteId]), dossierPourControle(db, conv.dossier_id || null, [entiteId])]);
    const nets = new Set([...lusNets.nets.map((n) => Number(n.montant)), ...relie.internes]);
    const ligne = ligneDeNani({ proposition, message, noms, entiers, nets, sansMontants: !clientPourApprendre(conv) || lusNets.erreur || relie.services.has("*") });
    if (!ligne) return { rien: "aucun_ecart" };
    const { error } = await db.from("agent_apprentissages").insert({
      entite_id: entiteId, genre: ligne.genre, contexte: ligne.contexte, avant: ligne.avant, apres: ligne.apres, source: "whatsapp",
      proposition_id: proposition.id, whatsapp_conversation_id: conv.id, user_id: message.origine === "gestion" && auteur ? auteur : null,
    });
    if (error) {
      // Déjà notée (événement rejoué) : rien de plus. Sans la migration 74 : dit dans les journaux, rien d'autre ne change.
      if (error.code === "23505") return { rien: "deja_notee" };
      console.error("apprendre : correction de Nani non notée", String(error.message || "").slice(0, 160));
      return { rien: "ecriture" };
    }
    return { note: true };
  } catch (err) {
    console.error("apprendre : correction de Nani", String((err && err.message) || err).slice(0, 160));
    return { rien: "panne" };
  }
}

// La même chose en tâche de fond, gardée en vie par le runtime après la réponse (whatsapp-envoi : l'envoi ne l'attend pas).
export function apprendreEnFond(db, conversationId, messageId, options = {}) {
  const tache = apprendreDeNani(db, conversationId, messageId, options);
  const runtime = globalThis.EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") runtime.waitUntil(tache);
  return tache;
}

// Réception et agent relus à chaque fois : une lecture impossible ferme. Rend la carte des agents allumés (entreprise → vrai), ou null si
// l'IA est fermée pour cette conversation.
async function agentsOuverts(db, conv) {
  const [recep, ents] = await Promise.all([
    db.from("whatsapp_reglages").select("reception_active").eq("organisation_id", conv.organisation_id).maybeSingle(),
    db.from("entites").select("id").eq("organisation_id", conv.organisation_id).in("slug", ["secret", "taxi"]),
  ]);
  if (recep.error || ents.error || !recep.data) return null;
  const ids = (ents.data || []).map((e) => e.id);
  if (!ids.length) return null;
  const regl = await db.from("reglages").select("entite_id, valeur").in("entite_id", ids);
  if (regl.error) return null;
  const agents = {};
  for (const l of regl.data || []) agents[l.entite_id] = !!(l.valeur && l.valeur.agent_ia === true);
  return iaOuvertePour({ receptionActive: recep.data.reception_active === true, conv, agents }) ? agents : null;
}

