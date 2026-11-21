// Démonstration de l'Assistant qui lit la boîte WhatsApp (PR A, 21.11.2026) : rien ne part chez Anthropic. Les vrais outils
// (agent-whatsapp-lecture.mjs, le même fichier que la fonction « agent ») tournent sur les données de la démo, avec les droits de la démo
// (store-local.mjs). Un agent simulé choisit l'outil d'après quelques mots, puis cite chaque point avec son lien, comme l'agent en service.
import { aFaireWhatsApp, chercherConversations, lireConversation, sansAccents } from "./agent-whatsapp-lecture.mjs";

// Une question sur la boîte : WhatsApp, une conversation, un message, ce qui attend.
export const questionWhatsApp = (texte) => /whatsapp|conversation (?:de|d'|avec)|qui (?:m'|nous )?a [ée]crit|qu(?:i|'est-ce qui) attend|pas (?:encore )?r[ée]pondu/i.test(String(texte || ""));
const demandeAFaire = (texte) => /[àa] faire|attend|en retard|promesse|urgent|pas r[ée]pondu|qui (?:m'|nous |a )?(?:a )?[ée]crit|to do|needs doing|waiting|pending/i.test(String(texte || ""));

// Même recherche que whatsapp_rechercher (migration 67), en mémoire : chaque mot de 3 lettres ou plus en préfixe d'un mot du message
// (texte et légende), un mot de 2 lettres en entier, six chiffres ou plus dans les chiffres du message. Les contacts « jamais », les messages supprimés et les réactions n'y sont jamais.
export function rechercheDemo(q, conversations = [], messages = [], lim = 50) {
  const propre = String(q || "").slice(0, 100);
  const mots = sansAccents(propre).split(/\s+/).map((m) => m.replace(/[^\p{L}\p{N}]+/gu, "")).filter((m) => m.length >= 2).slice(0, 6);
  const chiffres = propre.replace(/\D/g, "");
  if (!mots.length && chiffres.length < 6) return [];
  const permises = new Map(conversations.filter((c) => c && c.reponses !== "jamais").map((c) => [c.id, c]));
  const doc = (m) => `${m.texte || ""} ${(Array.isArray(m.medias) && m.medias[0] && m.medias[0].legende) || ""}`;
  return messages
    .filter((m) => m && permises.has(m.conversation_id) && !m.supprime_le && m.type !== "reaction")
    .filter((m) => {
      const jetons = sansAccents(doc(m)).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      const parMots = mots.length > 0 && mots.every((x) => jetons.some((j) => (x.length >= 3 ? j.startsWith(x) : j === x)));
      const parChiffres = chiffres.length >= 6 && String(m.texte || "").replace(/\D/g, "").includes(chiffres);
      return parMots || parChiffres;
    })
    .sort((a, b) => String(b.envoye_le).localeCompare(String(a.envoye_le)))
    .slice(0, lim)
    // Le texte entier, comme whatsapp_rechercher : l'outil le masque avant de couper l'extrait.
    .map((m) => ({ conversation_id: m.conversation_id, message_id: m.id, extrait: doc(m).trim(), envoye_le: m.envoye_le }));
}

// Ce qu'on cherche dans la question : les mots en majuscule (un prénom), sinon les mots qui restent sans les mots de la question.
const VIDES = new Set("la le les de du des un une a au aux et ou que qui quoi est sur dans pour avec me moi nous mon ma mes lis lire resume résume résumer montre dis cherche trouve conversation conversations message messages whatsapp what the of from with show read find please".split(" "));
export function sujetDe(texte) {
  const mots = String(texte || "").replace(/[?!.,;:«»"()]/g, " ").split(/\s+/).filter(Boolean);
  const noms = mots.slice(1).filter((m) => /^\p{Lu}/u.test(m) && !/^whatsapp$/i.test(m));
  if (noms.length) return noms.slice(0, 3).join(" ");
  return mots.filter((m) => m.length >= 3 && !VIDES.has(sansAccents(m))).slice(0, 3).join(" ");
}

const LIBELLES = {
  promesse: "Promesse échue",
  client_attend: "Attend une réponse",
  apporteur: "Nouveau client d'un apporteur",
  ferry_non_paye: "Trajet en bateau non payé",
  paiement_signale: "Paiement signalé",
};
const ENTREPRISES = { secret: "Secret", taxi: "Taxi", a_trier: "à trier", autre: "" };

// Un tour de l'agent simulé. `source` : { candidats, conversation, aFaire, qui } (store-local.mjs). Rend les événements de la fonction.
export async function repondreWhatsAppDemo(texte, source, { maintenant = Date.now() } = {}) {
  const ev = [];
  if (demandeAFaire(texte)) {
    ev.push({ t: "etape", outil: "a_faire_whatsapp" });
    const r = aFaireWhatsApp(await source.aFaire(), { maintenant });
    if (!r.elements.length) {
      ev.push({ t: "texte", delta: "Rien n'attend dans WhatsApp pour le moment." });
      return ev;
    }
    const lignes = r.elements.slice(0, 8).map((x) => {
      const detail = x.genre === "client_attend" || x.genre === "apporteur" ? `depuis ${x.attente}` : x.genre === "promesse" ? `échéance ${x.echeance}` : x.genre === "ferry_non_paye" ? `solde ${x.solde_du}${x.devise ? ` ${x.devise}` : ""}` : x.quoi;
      return `- ${x.niveau === "urgent" ? "Urgent, " : ""}${LIBELLES[x.genre]} : ${x.nom || x.quoi}${ENTREPRISES[x.entreprise] ? ` (${ENTREPRISES[x.entreprise]})` : ""}, ${detail} ${x.lien}`;
    });
    ev.push({ t: "texte", delta: `${r.nombre} chose${r.nombre > 1 ? "s" : ""} attend${r.nombre > 1 ? "ent" : ""} dans WhatsApp, dont ${r.urgents} urgente${r.urgents > 1 ? "s" : ""} :\n${lignes.join("\n")}` });
    return ev;
  }
  const sujet = sujetDe(texte);
  ev.push({ t: "etape", outil: "chercher_conversations" });
  const e = { texte: sujet, client: "", dossier: "", du: "", au: "", non_lus: false, attend_reponse: false };
  const trouvees = chercherConversations(e, await source.candidats(e));
  if (trouvees.erreur || !trouvees.conversations.length) {
    ev.push({ t: "texte", delta: sujet ? `Je ne trouve aucune conversation pour « ${sujet} » dans WhatsApp.` : "Dites-moi le prénom du contact ou un mot du message, je cherche la conversation." });
    return ev;
  }
  const c = trouvees.conversations[0];
  ev.push({ t: "etape", outil: "lire_conversation" });
  const lu = lireConversation({ conversation: c.conversation, depuis: "", derniers: 0 }, await source.conversation(c.conversation, { depuis: "", derniers: 40 }), { qui: source.qui || "Nani" });
  if (lu.erreur) {
    ev.push({ t: "texte", delta: lu.erreur === "contact_personnel" ? "Ce contact est réglé « Contact personnel » : je ne lis rien de lui." : "Je ne peux pas lire cette conversation." });
    return ev;
  }
  const derniers = lu.messages.filter((m) => m.texte || (m.medias && m.medias.length)).slice(-4);
  const lignes = derniers.map((m) => `- ${m.de === "client" ? "Client" : m.de} : « ${m.texte || m.medias.map((x) => x.legende || x.type).join(", ")} » ${m.lien}`);
  const autres = trouvees.conversations.length > 1 ? `\n${trouvees.conversations.length - 1} autre${trouvees.conversations.length > 2 ? "s" : ""} conversation${trouvees.conversations.length > 2 ? "s" : ""} correspond${trouvees.conversations.length > 2 ? "ent" : ""} aussi.` : "";
  ev.push({
    t: "texte",
    delta: `La conversation de ${lu.nom}${ENTREPRISES[lu.entreprise] ? ` (${ENTREPRISES[lu.entreprise]})` : ""} : ${lu.messages.length} message${lu.messages.length > 1 ? "s" : ""}${lu.attend_depuis ? ", le client attend une réponse" : ""}. ${lu.lien}\nEn démonstration, je cite les derniers messages tels quels ; en service, je les résume.\n${lignes.join("\n")}${autres}`,
  });
  return ev;
}

// ---- « Demander à l'assistant » depuis une conversation (PR B, 21.11.2026) -------------------------------------------------------------
// Le premier message tel que la fonction l'écrit (agent/whatsapp.js, texteDepuisWhatsApp en mode « question ») : la question entre
// <question> et </question>, puis l'échange entre <conversation> et </conversation>, une ligne « [Client 21.11.2026 10:00] texte ».
const heureDemo = (iso) => {
  const b = new Date(Date.parse(iso) + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(b.getUTCDate())}.${p(b.getUTCMonth() + 1)}.${b.getUTCFullYear()} ${p(b.getUTCHours())}:${p(b.getUTCMinutes())}`;
};
export function texteQuestionDemo(question, messages = [], { qui = "Nani" } = {}) {
  const q = String(question || "").replace(/[<>]/g, (c) => (c === "<" ? "‹" : "›")).trim();
  const lignes = [...messages]
    .filter((m) => m && !m.supprime_le && m.texte)
    .sort((a, b) => String(a.envoye_le).localeCompare(String(b.envoye_le)))
    .slice(-40)
    .map((m) => `[${m.sens === "entrant" ? "Client" : qui} ${heureDemo(m.envoye_le)}] ${String(m.texte).replace(/[\[\]<>]/g, " ").replace(/\s+/g, " ").trim()}`);
  return `${qui} te pose une question sur cette conversation WhatsApp.\n<question>\n${q}\n</question>\n\n<conversation>\n${lignes.join("\n") || "(aucun texte)"}\n</conversation>`;
}
const demandeResume = (t) => /r[ée]sum|summar|de quoi|quoi de neuf|what.*about/i.test(String(t || ""));
const demandeDossiers = (t) => /pr[ée]pare|dossier|cr[ée]er|booking|file/i.test(String(t || ""));
// Une question sur une conversation précise (`id`). Rend { evenements } quand la démonstration y répond, { preparer: true } pour « Prépare
// les dossiers » (la démonstration habituelle lit alors l'échange du client) ou null (autre suite de la conversation). `libre` : une question
// quelconque reçoit un résumé, comme la première question d'une conversation ouverte depuis WhatsApp.
// `lectureSeule` : la conversation appartient à une entreprise que la personne n'administre pas ; aucun dossier n'est préparé.
export async function repondreQuestionWhatsAppDemo(question, source, id, { maintenant = Date.now(), libre = false, lectureSeule = false } = {}) {
  if (!id) return null;
  if (demandeDossiers(question) && !demandeAFaire(question)) {
    if (lectureSeule) return { evenements: [{ t: "texte", delta: "Lecture seule : cette conversation appartient à une entreprise que vous n'administrez pas. Je réponds à vos questions, sans préparer de dossier." }] };
    return { preparer: true };
  }
  if (!source) return null;
  const ev = [];
  if (demandeAFaire(question)) {
    ev.push({ t: "etape", outil: "a_faire_whatsapp" });
    const r = aFaireWhatsApp(await source.aFaire(), { maintenant });
    const ici = r.elements.filter((x) => x.conversation === id);
    const ailleurs = r.nombre - ici.length;
    const lignes = ici.map((x) => `- ${x.niveau === "urgent" ? "Urgent, " : ""}${LIBELLES[x.genre]}${x.attente ? ` depuis ${x.attente}` : ""}${x.genre === "ferry_non_paye" ? `, solde ${x.solde_du}${x.devise ? ` ${x.devise}` : ""}` : ""} ${x.lien}`);
    const fin = ailleurs > 0 ? `\nAilleurs dans WhatsApp, ${ailleurs} autre${ailleurs > 1 ? "s" : ""} chose${ailleurs > 1 ? "s" : ""} attend${ailleurs > 1 ? "ent" : ""}.` : "";
    ev.push({ t: "texte", delta: `${lignes.length ? `Pour cette conversation :\n${lignes.join("\n")}` : "Rien n'attend dans cette conversation."}${fin}` });
    return { evenements: ev };
  }
  if (!demandeResume(question) && !libre) return null;
  ev.push({ t: "etape", outil: "lire_conversation" });
  const lu = lireConversation({ conversation: id, depuis: "", derniers: 0 }, await source.conversation(id, { depuis: "", derniers: 40 }), { qui: source.qui || "Nani" });
  if (lu.erreur) {
    ev.push({ t: "texte", delta: lu.erreur === "contact_personnel" ? "Ce contact est réglé « Contact personnel » : je ne lis rien de lui." : "Je ne peux pas lire cette conversation." });
    return { evenements: ev };
  }
  const derniers = lu.messages.filter((m) => m.texte).slice(-3);
  const lignes = derniers.map((m) => `- ${m.de === "client" ? "Client" : m.de} : « ${m.texte.length > 160 ? `${m.texte.slice(0, 159)}…` : m.texte} » ${m.lien}`);
  ev.push({
    t: "texte",
    delta: `${lu.nom} : ${lu.messages.length} message${lu.messages.length > 1 ? "s" : ""}${lu.attend_depuis ? ", le client attend une réponse" : ""}. ${lu.lien}\nEn démonstration, je cite les derniers messages ; en service, je les résume et je réponds à la question.\n${lignes.join("\n")}`,
  });
  return { evenements: ev };
}
