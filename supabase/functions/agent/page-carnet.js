// LE module qui reconnaît le message d'une page du carnet de ZTP (guides de Koh Samui, d'Ao Nang et de Koh Lanta), côté fonction et côté Gestion : une seule règle.
// Source : ce fichier (embarqué par les fonctions agent, whatsapp et whatsapp-envoi, qui n'importent rien hors de supabase/functions). Gestion en sert une copie IDENTIQUE,
// src/gestion/js/page-carnet.mjs (le navigateur ne lit pas supabase/) : un test échoue si les deux fichiers diffèrent ; la modifier se fait ici, puis
//   cp supabase/functions/agent/page-carnet.js src/gestion/js/page-carnet.mjs
// Sans import ni dépendance.
//
// Un message est celui d'une page quand il COMMENCE par sa ligne de demande (« Booking request: », « Demande de réservation : », précédée au plus de la phrase d'accueil du WhatsApp de la
// page) et FINIT par sa ligne de référence (« Ref: AON-AB12 », « Réf : SAM-AB12 ») dont le préfixe est dans REFS_CARNET. Un client qui écrit avant ou après, ou cite l'ancien message,
// écrit un message libre : le bloc n'est pas reconnu, rien n'est joint. Un message d'une autre page, d'un autre site (« SEC-… ») ou sans préfixe de la table n'est pas reconnu non plus.

// Le préfixe de la référence que chaque guide met dans son message (`prefixeRef` de src/carnet/*.11tydata.js) et le guide qu'il désigne : LA table.
export const REFS_CARNET = { SAM: "koh-samui", AON: "aonang", LAN: "koh-lanta" };

const LIGNE_REF = /^R[ée]f\s*:\s*(([A-Z]{3})-[A-Z0-9]{3,})$/i;
const LIGNE_DEMANDE = /^(?:Booking request:|Demande de réservation\s*:)/i;
const ACCUEIL = /^Bonjour Anaïs, voici ma demande de réservation\.?$/i;
// L'en-tête que l'agent met devant chaque message d'un échange WhatsApp joint (« [Client 14:02] texte »).
const ENTETE = /^\[[^\]\n]{1,80}\]\s+/;

// Le bloc d'UN message : { lignes (de la ligne de demande à la référence), ref, prefixe, guide }, ou null.
export function blocDeLaPage(texte) {
  const lignes = String(texte || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const debut = lignes.length && ACCUEIL.test(lignes[0]) ? 1 : 0;
  const ref = lignes.length ? LIGNE_REF.exec(lignes[lignes.length - 1]) : null;
  if (!ref || lignes.length - debut < 2 || !LIGNE_DEMANDE.test(lignes[debut])) return null;
  const prefixe = ref[2].toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(REFS_CARNET, prefixe)) return null;
  return { lignes: lignes.slice(debut), ref: ref[1].toUpperCase(), prefixe, guide: REFS_CARNET[prefixe] };
}

// Les messages d'un texte : un échange WhatsApp joint en a un par ligne d'en-tête « [Client 14:02] », le texte collé d'une personne est un seul message.
function messagesDe(texte) {
  const messages = [];
  for (const brute of String(texte || "").split(/\r?\n/)) {
    if (ENTETE.test(brute) || !messages.length) messages.push([brute.replace(ENTETE, "")]);
    else messages[messages.length - 1].push(brute);
  }
  return messages.map((l) => l.join("\n"));
}

// Les blocs de page d'une liste de textes (messages collés, messages d'un client) : [{ ref, guide, texte, rang }], le texte étant celui du bloc, tel qu'écrit, et le rang celui du message.
export function blocsDeLaPage(textes = []) {
  const blocs = [];
  textes.forEach((t, rang) => {
    for (const m of messagesDe(t)) {
      const b = blocDeLaPage(m);
      if (b) blocs.push({ ref: b.ref, guide: b.guide, texte: b.lignes.join("\n"), rang });
    }
  });
  return blocs;
}

// Le bloc à joindre à une carte, ou "" : celui des messages collés par la personne (`textes`) ou celui du dernier message du client (`client`, ses messages dans l'ordre : un client qui écrit
// APRÈS son message change peut-être sa demande, le bloc d'origine ne vaut plus). Un seul bloc (une seule référence), sinon rien : le modèle ne choisit pas entre deux demandes.
export function messageDeLaPage(textes = [], { client = [] } = {}) {
  const blocs = [...blocsDeLaPage(textes), ...blocsDeLaPage(client).filter((b) => b.rang === client.length - 1)];
  const refs = new Set(blocs.map((b) => b.ref));
  return refs.size === 1 ? blocs[blocs.length - 1].texte : "";
}
