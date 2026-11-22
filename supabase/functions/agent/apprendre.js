// Apprentissages de l'agent, partie texte (22.11.2026). Ce fichier existe en deux exemplaires identiques : supabase/functions/agent/apprendre.js
// (fonctions « agent » et « whatsapp » : correction de Nani dans WhatsApp, lecture filtrée) et src/gestion/js/agent-apprendre-texte.mjs
// (écran : cartes corrigées, bouton « Pas bien »). tests/gestion-agent-apprendre-nani.test.js vérifie qu'ils sont identiques.
// Logique pure, sans dépendance.
//
// Ce qui ne part jamais dans un apprentissage : un net, une commission, une marge commerciale, une coordonnée bancaire (la phrase est
// écartée, ou toute la ligne pour un champ court), ni le nom, le téléphone, l'e-mail ou un lien d'un client (masqués avant l'écriture).
// « Marge » seule reste permise : c'est d'abord la marge de sécurité d'un pickup, ce que l'agent doit justement apprendre.
// Les apprentissages ne vont que dans le prompt de l'agent (prompt.js, blocApprentissages) : ils ne servent jamais à entraîner un modèle.

export const MOT_INTERNE = /\b(?:nets?|commissions?|marges? commerciales?|prix d'achat|co[uû]t d'achat|cost price|net price|iban|swift|bic|compte bancaire|num[ée]ro de compte|bank account|account (?:no|number)|routing|promptpay|kbank|kasikorn|scb|bangkok bank|gains?|b[ée]n[ée]fices?|profits?|revers(?:e|é|er|ement)s?)\b/i;
// Une raison « Pas bien » : courte, comme le champ de l'écran (la base le tient aussi).
export const RETOUR_MAX = 200;
// L'extrait de la réponse jugée mauvaise gardé avec la raison.
export const EXTRAIT_MAX = 400;

const sansAccents = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
export const propre = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
const echapper = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const memeTexte = (a, b) => sansAccents(propre(a)).toLowerCase() === sansAccents(propre(b)).toLowerCase();
export const limiter = (t, n) => {
  const x = propre(t);
  return x.length > n ? `${x.slice(0, n - 1)}…` : x;
};

// Masque ce qui désigne un client : ses noms (ceux donnés), un e-mail, un IBAN, un numéro de téléphone ou de compte (7 chiffres ou plus), un
// lien, et le prénom après « Bonjour » ou « Hello ». Le reste du texte (lieux, heures, tournures) est ce qui sert d'exemple.
export function anonymiser(texte, noms = []) {
  let t = String(texte ?? "");
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "{e-mail}");
  t = t.replace(/https?:\/\/\S+/g, "{lien}");
  t = t.replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, "{compte}");
  // Un numéro de 7 chiffres ou plus, sauf une date (20.11.2026, 2026-11-20).
  t = t.replace(/\+?\d[\d ().-]{5,}\d/g, (m) => (m.replace(/\D/g, "").length >= 7 && !/^\d{1,4}[./-]\d{1,2}[./-]\d{2,4}$/.test(m) ? "{téléphone}" : m));
  const mots = [...new Set(noms.flatMap((n) => String(n || "").split(/\s+/)).map((m) => m.replace(/[^\p{L}'-]/gu, "")).filter((m) => m.length >= 2))].sort((a, b) => b.length - a.length);
  for (const m of mots) t = t.replace(new RegExp(`(^|[^\\p{L}])${echapper(m)}(?=$|[^\\p{L}])`, "giu"), "$1{client}");
  // Un nom après un titre (« Mr. Brown », « Mme Martin ») ou un prénom après une salutation ou un remerciement (« Thanks Sarah »).
  t = t.replace(/\b(Mr|Mrs|Ms|Miss|Dr|Mme|Mlle|Mister|Madame|Monsieur|M)(\.?\s+)(?!\{)[\p{Lu}][\p{L}'-]+/gu, "$1$2{nom}");
  t = t.replace(/\b(Bonjour|Bonsoir|Hello|Hi|Hey|Dear|Cher|Chère|Thanks|Thank you|Thx|Merci)(,?\s+)(?!\{)([\p{Lu}][\p{L}'-]+)/gu, "$1$2{prénom}");
  return t;
}

// Un montant écrit en chiffres : 100 ou plus, séparateurs de milliers compris (une heure, une durée ou « 2 pax » n'en sont pas).
export const aMontant = (t) => /\d{1,3}(?:[ ,.'’\u00a0\u202f]\d{3})+(?!\d)|\d{3,}/.test(String(t || "").replace(/\b\d{1,2}[:h.]\d{2}\b/g, " "));
// Une phrase qui ne part jamais : mot interne (net, banque, gain…), coordonnée bancaire masquée, ou « marge » avec un montant (une marge
// commerciale chiffrée ; « marge de 15 min » d'un pickup reste permise).
export const phraseInterne = (t) => {
  const x = String(t || "");
  return MOT_INTERNE.test(x) || /\{compte\}/.test(x) || (/\b(?:marges?|margins?)\b/i.test(x) && aMontant(x));
};

// La part de mots changés entre deux textes, de 0 à 100 (même calcul que partModifiee de src/gestion/js/assistant-suivi-calc.mjs, un test
// les compare).
export function partModifiee(brouillon, envoye) {
  const mots = (t) => String(t || "").split(/\s+/).filter(Boolean).slice(0, 3000);
  const a = mots(brouillon);
  const b = mots(envoye);
  if (!a.length && !b.length) return 0;
  let prec = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cour = [i];
    for (let j = 1; j <= b.length; j++) cour[j] = Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prec = cour;
  }
  const d = prec[b.length];
  if (!d) return 0;
  return Math.min(100, Math.max(1, Math.round((d / Math.max(a.length, b.length)) * 100)));
}

// Fin de phrase : un retour à la ligne, ou une ponctuation finale suivie d'une espace, sauf après « Mr. », « Mrs. », « Dr. », « M. »…
const FIN_DE_PHRASE = /\n+|(?<=[.!?])(?<!\b(?:Mr|Mrs|Ms|Dr|St|M|Mme|Mlle|Mgr)\.)\s+/;

// Les phrases d'un texte présentes d'un côté seulement : une réponse corrigée se garde par ses phrases changées, pas en entier.
export function phrasesChangees(avant, apres) {
  const decouper = (t) =>
    String(t || "")
      .split(FIN_DE_PHRASE)
      .map(propre)
      .filter(Boolean);
  const a = decouper(avant);
  const b = decouper(apres);
  return { enlevees: a.filter((l) => !b.some((x) => memeTexte(x, l))), ajoutees: b.filter((l) => !a.some((x) => memeTexte(x, l))) };
}

// Une ligne d'apprentissage, masquée et bornée. null si elle parle de net ou de banque, ou si rien n'a changé.
export function ligneApprise(genre, contexte, avant, apres, noms = []) {
  const l = { genre, contexte: limiter(anonymiser(contexte, noms), 300), avant: limiter(anonymiser(avant, noms), 1500), apres: limiter(anonymiser(apres, noms), 1500) };
  if (phraseInterne(`${l.contexte} ${l.avant} ${l.apres}`)) return null;
  if (memeTexte(l.avant, l.apres)) return null;
  return l;
}

// Une réponse au client retouchée (carte « réponse » de l'Assistant, ou réponse WhatsApp préparée puis écrite autrement par Nani) :
// seulement les phrases changées. Une phrase interne (net, banque) est écartée, comme une phrase que `exclure` refuse (montant égal à un net,
// côté serveur) ; le reste peut encore servir. Le masquage passe AVANT le filtre : un IBAN se reconnaît aussi masqué.
// Rend une ligne « reponse » ou null.
export function correctionReponse(avant, apres, { noms = [], contexte = "", exclure = null } = {}) {
  if (!propre(apres) || partModifiee(avant, apres) === 0) return null;
  const ch = phrasesChangees(avant, apres);
  const garder = (p) => {
    const m = anonymiser(p, noms);
    return !phraseInterne(m) && !(typeof exclure === "function" && exclure(m));
  };
  const enlevees = ch.enlevees.filter(garder);
  const ajoutees = ch.ajoutees.filter(garder);
  // Un côté vidé par le filtre ferait croire à une phrase retirée ou ajoutée pour rien (« … », Nani a mis « rien ») : rien n'est gardé.
  if ((ch.enlevees.length && !enlevees.length) || (ch.ajoutees.length && !ajoutees.length)) return null;
  if (!enlevees.length && !ajoutees.length) return null;
  return ligneApprise("reponse", contexte, enlevees.join(" / "), ajoutees.join(" / "), noms);
}

// « Pas bien » sur une réponse de l'agent : la raison de la personne (200 caractères au plus), un extrait masqué de la réponse et son
// contexte. L'extrait perd ses phrases internes (net, banque, marge chiffrée) ; avec `sansMontants` (réponse de l'agent à l'équipe, qui peut
// citer des nets, des marges ou des gains), aussi toute phrase qui porte un montant. Une raison interne n'est pas notée.
// Rend { ligne } ou { erreur: "vide" | "longue" | "interne" }.
export function ligneRetour({ reponse = "", raison = "", contexte = "", noms = [], sansMontants = false } = {}) {
  const r = propre(raison);
  if (!r) return { erreur: "vide" };
  if (r.length > RETOUR_MAX) return { erreur: "longue" };
  const raisonMasquee = anonymiser(r, noms);
  if (phraseInterne(raisonMasquee)) return { erreur: "interne" };
  const phrases = String(reponse || "")
    .split(FIN_DE_PHRASE)
    .map(propre)
    .filter(Boolean)
    .map((p) => anonymiser(p, noms))
    .filter((p) => !phraseInterne(p) && !(sansMontants && aMontant(p)));
  const ctx = anonymiser(contexte, noms);
  return {
    ligne: {
      genre: "retour",
      contexte: phraseInterne(ctx) ? "" : limiter(ctx, 300),
      avant: limiter(phrases.join(" "), EXTRAIT_MAX),
      apres: limiter(raisonMasquee, RETOUR_MAX),
    },
  };
}
