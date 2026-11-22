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

// Les mots qui ne sont jamais masqués seuls, même s'ils font partie du nom d'un client : un mot de deux lettres ou moins, et les mots
// courants des lieux et des services (sinon « speed boat », « taxi » ou « Lanta » devenaient {client} et l'exemple ne servait plus à rien).
export const MOTS_COURANTS = new Set(
  "les des une aux pour par sur avec chez dans the and for with from you your our are koh lanta krabi phuket phi trang lipe ngai muk rok ao nang long tail boat boats speed speedboat ferry taxi van minivan car bus songthaew tour tours trip travel transfer transfers private shared pickup drop hotel hotels resort resorts villa villas beach bay island islands pier airport town old new big small north south east west family famille group groupe team vip secret mister madame monsieur miss driver chauffeur guide agent agency agence service services company happy best good sea sun star golden royal paradise green blue white sky".split(" ")
);
// Le motif d'un nom, insensible aux accents (texte et nom mis en NFD : chaque lettre suivie de ses accents éventuels) et à la casse ; avec
// `majuscule`, la première lettre doit être une majuscule dans le texte (un mot seul : « Book » est un prénom, « book the boat » non).
const lettre = (c, { majuscule = false } = {}) => {
  const b = c.toLowerCase();
  const h = c.toUpperCase();
  return `${b === h ? echapper(b) : majuscule ? echapper(h) : `[${echapper(b)}${echapper(h)}]`}\\p{M}*`;
};
const motifNom = (nom, { majuscule = false } = {}) =>
  [...sansAccents(nom).trim()]
    .map((c, i) => (/\s/.test(c) ? "\\s+" : /[\p{L}\p{N}]/u.test(c) ? lettre(c, { majuscule: majuscule && i === 0 }) : echapper(c)))
    .join("");
const remplacer = (t, nom, par, options = {}) => t.replace(new RegExp(`(^|[^\\p{L}\\p{N}\\p{M}])${motifNom(nom, options)}(?=$|[^\\p{L}\\p{N}\\p{M}])`, "gu"), `$1${par}`);

// Masque ce qui désigne un client ou un tiers. `noms` : les noms du client et du contact, masqués mot par mot ({client}), sauf un mot de deux
// lettres ou moins et un mot courant (MOTS_COURANTS). `entiers` : les noms des partenaires, masqués en entier comme une seule expression
// ({partenaire}), tels quels et sans ce qui est entre parenthèses, les emoji ni la ponctuation. Un élément { nom, personne: true } (contact
// typé ou apporteur, souvent un prénom avec un suffixe, « Prénom (driver) ») est aussi masqué mot par mot, hors mots courants. Un nom d'un
// seul mot courant (« Taxi ») n'est jamais masqué. Un mot seul (client ou personne) n'est masqué que s'il commence par une majuscule dans
// le texte (« Book » ou « May » sont des prénoms, « book the boat » et « you may pay » non) ; un prénom composé l'est aussi par ses parties.
// Puis un e-mail, un IBAN, un numéro de téléphone ou de compte (7 chiffres ou plus), un lien, un nom après un titre et le prénom après
// « Bonjour » ou « Hello ». Le reste du texte (lieux, heures, tournures) sert d'exemple. Les accents ne comptent pas, la casse non plus pour
// un nom entier (« Léa » masque aussi « Lea » et « LÉA »).
export function anonymiser(texte, noms = [], entiers = []) {
  let t = String(texte ?? "");
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "{e-mail}");
  t = t.replace(/https?:\/\/\S+/g, "{lien}");
  t = t.replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, "{compte}");
  // Un numéro de 7 chiffres ou plus, sauf une date (20.11.2026, 2026-11-20).
  t = t.replace(/\+?\d[\d ().-]{5,}\d/g, (m) => (m.replace(/\D/g, "").length >= 7 && !/^\d{1,4}[./-]\d{1,2}[./-]\d{2,4}$/.test(m) ? "{téléphone}" : m));
  t = t.normalize("NFD");
  const elements = (entiers || []).map((e) => (e && typeof e === "object" ? { nom: String(e.nom || ""), personne: !!e.personne } : { nom: String(e || ""), personne: false }));
  const nettoye = (n) => propre(String(n).replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/[^\p{L}\p{N}\p{M}' -]/gu, " "));
  const utile = (n) => {
    const lettres = sansAccents(n).replace(/[^\p{L}\p{N}]/gu, "");
    return lettres.length >= 3 && !(!/\s/.test(propre(n)) && MOTS_COURANTS.has(sansAccents(propre(n)).toLowerCase()));
  };
  const expressions = [...new Set(elements.flatMap((e) => [propre(e.nom), nettoye(e.nom)]).filter(utile))].sort((a, b) => b.length - a.length);
  // Un nom d'un seul mot se traite comme un mot seul : majuscule exigée.
  for (const e of expressions) t = remplacer(t, e, "{partenaire}", { majuscule: !/\s/.test(e) });
  // Les mots d'un nom : chaque mot, et chaque partie d'un mot composé (« Jean-Pierre » : « Jean-Pierre », « Jean », « Pierre »).
  const motsDe = (n) => String(n || "").split(/[\s,/]+/).flatMap((m) => [m, ...(m.includes("-") ? m.split("-") : [])]).map((m) => m.replace(/[^\p{L}\p{M}'-]/gu, "").replace(/^-+|-+$/g, ""));
  const gardable = (m) => sansAccents(m).replace(/[^\p{L}]/gu, "").length >= 3 && !MOTS_COURANTS.has(sansAccents(m).toLowerCase());
  const motsPersonnes = [...new Set(elements.filter((e) => e.personne).flatMap((e) => motsDe(nettoye(e.nom))).filter(gardable))].sort((a, b) => b.length - a.length);
  for (const m of motsPersonnes) t = remplacer(t, m, "{partenaire}", { majuscule: true });
  const mots = [...new Set((noms || []).flatMap(motsDe).filter(gardable))].sort((a, b) => b.length - a.length);
  for (const m of mots) t = remplacer(t, m, "{client}", { majuscule: true });
  t = t.normalize("NFC");
  // Un nom après un titre (« Mr. Brown », « Mme Martin ») ou un prénom après une salutation ou un remerciement (« Thanks Sarah »).
  t = t.replace(/\b(Mr|Mrs|Ms|Miss|Dr|Mme|Mlle|Mister|Madame|Monsieur|M)(\.?\s+)(?!\{)[\p{Lu}][\p{L}'-]+/gu, "$1$2{nom}");
  t = t.replace(/\b(Bonjour|Bonsoir|Hello|Hi|Hey|Dear|Cher|Chère|Thanks|Thank you|Thx|Merci)(,?\s+)(?!\{)([\p{Lu}][\p{L}'-]+)/gu, "$1$2{prénom}");
  return t;
}

// Les montants écrits d'un texte, avec leur place (pour les masquer) : un nombre de 100 ou plus (séparateurs de milliers compris), ou tout
// nombre avec une devise (« 85 CHF », « ฿900 ») ou un « k » (« 1.8k »). Une date, une heure (15:00, 8h30), une durée ou une quantité
// (« 120 min », « 2 pax », « 3 nights ») n'en sont pas. Rend [{ debut, fin, valeur }].
const DEVISE = "(?:฿|thb|chf|eur|euros?|€|usd|\\$|baht)";
const MONTANT_ECRIT = new RegExp(
  `(${DEVISE}\\s?)?(\\d{1,3}(?:[ ,.'’\\u00a0\\u202f]\\d{3})+(?:[.,]\\d{1,2}(?!\\d))?|\\d+(?:[.,]\\d+)?)(\\s?k\\b)?(?!\\s?(?:min|mins|minutes?|h\\b|hrs?|hours?|heures?|km|pax|pers|personnes?|people|adults?|adultes?|kids?|enfants?|children|nights?|nuits?|jours?|days?|%|x\\b))(\\s?${DEVISE}(?![\\p{L}]))?`,
  "giu"
);
const blanchir = (t) =>
  String(t || "")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, (m) => " ".repeat(m.length))
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, (m) => " ".repeat(m.length))
    .replace(/\b\d{1,2}[:h]\d{2}\b/g, (m) => " ".repeat(m.length));
const valeurDe = (chiffres) => {
  const x = String(chiffres);
  const milliers = /^\d{1,3}(?:[ ,.'’  ]\d{3})+/.exec(x);
  if (milliers) {
    const reste = x.slice(milliers[0].length);
    return Number(milliers[0].replace(/\D/g, "") + (reste ? `.${reste.slice(1)}` : ""));
  }
  return Number(x.replace(",", "."));
};
export function montantsEcrits(texte) {
  const t = String(texte || "");
  const out = [];
  for (const m of blanchir(t).matchAll(MONTANT_ECRIT)) {
    const avecDevise = !!(m[1] || m[4]);
    const k = !!m[3];
    let valeur = valeurDe(m[2]);
    if (k) valeur = Math.round(valeur * 1000);
    if (!(valeur > 0) || (!avecDevise && !k && valeur < 100)) continue;
    // Pas un nombre collé à une lettre (« T2026 », « Room 214B ») ni un morceau d'un plus grand nombre (ceux-là, rangerMontants les
    // compare quand même aux nets).
    const fin = m.index + m[0].replace(/\s+$/, "").length;
    const avant = t[m.index - 1] || "";
    const apres = t[fin] || "";
    if (/[\p{L}\d/-]/u.test(avant) && !m[1]) continue;
    if (/[\p{L}\d]/u.test(apres) && !k && !m[4]) continue;
    // Ni une année (« en 2026 »), ni un numéro de chambre ou de vol (« Room 214 », « vol TG 2034 »).
    if (!avecDevise && !k && (/^20[23]\d$/.test(m[2]) || /(?:room|chambre|vol|flight|n°|no\.?|#)\s*(?:[a-z]{1,3}\s*)?$/i.test(t.slice(Math.max(0, m.index - 14), m.index)))) continue;
    out.push({ debut: m.index, fin, valeur });
  }
  return out;
}
export const aMontant = (t) => montantsEcrits(t).length > 0;
// Tous les nombres d'un texte, même collés à une lettre, à « / », « - » ou « x » (« 2,500/1,200 », « 2x1200 », « net1200 »), milliers
// et décimales lus ; dates et heures écartées. Sert à comparer aux nets : un net se reconnaît partout. [{ debut, fin, valeur, colle }].
export function nombresBruts(texte) {
  const t = String(texte || "");
  const b = blanchir(t);
  return [...b.matchAll(/\d{1,3}(?:[ ,'’  ]\d{3})+(?:[.,]\d{1,2}(?!\d))?(?!\d)|\d{1,3}(?:\.\d{3})+(?!\d)|\d+(?:[.,]\d+)?/g)]
    .map((m) => ({ debut: m.index, fin: m.index + m[0].length, valeur: valeurDe(m[0]), colle: /[/x×-]/i.test(t[m.index - 1] || "") || /[/x×-]/i.test(t[m.index + m[0].length] || "") }))
    .filter((x) => x.valeur > 0);
}
// Remplace par {montant} : tous les nombres (`valeurs` = "tous", comme la base pour une ligne interne), ou ceux dont la valeur est dans
// `valeurs` (un net connu), où qu'ils soient écrits.
export function masquerMontants(texte, valeurs = []) {
  const t = String(texte || "");
  const garder = valeurs === "tous" ? null : new Set([...valeurs].map(Number));
  let sortie = "";
  let i = 0;
  for (const m of nombresBruts(t)) {
    if (garder && !garder.has(m.valeur)) continue;
    sortie += `${t.slice(i, m.debut)}{montant}`;
    i = m.fin;
  }
  return sortie + t.slice(i);
}
// Les montants d'une raison « Pas bien », rangés au moment du clic (demande de Jérémy, 22.11.2026) : `ventes` (prix de vente connus) et
// `nets` (nets connus, null sans le droit de les voir).
//   - un nombre égal à un net est un net, où qu'il soit écrit (collé, petit, sans devise) et même s'il est aussi un prix de vente (on ferme) ;
//   - un montant (montantsEcrits), ou un nombre de 100 ou plus collé à « / », « - » ou « x », est un prix de vente connu ou un inconnu.
// Rend { nets, ventes, inconnus } (valeurs, sans doublon). La raison est à passer déjà resserrée (propre), comme ligneRetour la garde.
export function rangerMontants(texte, { ventes = new Set(), nets = null } = {}) {
  const v = new Set([...ventes].map(Number));
  const n = nets ? new Set([...nets].map(Number)) : null;
  const out = { nets: [], ventes: [], inconnus: [] };
  const bruts = nombresBruts(texte);
  if (n) for (const x of new Set(bruts.map((b) => b.valeur))) if (n.has(x)) out.nets.push(x);
  const candidats = new Set([...montantsEcrits(texte).map((m) => m.valeur), ...bruts.filter((b) => b.colle && b.valeur >= 100 && !/^20[23]\d$/.test(String(b.valeur))).map((b) => b.valeur)]);
  for (const valeur of candidats) {
    if (out.nets.includes(valeur)) continue;
    if (v.has(valeur)) out.ventes.push(valeur);
    else out.inconnus.push(valeur);
  }
  return out;
}
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
export function ligneApprise(genre, contexte, avant, apres, noms = [], entiers = []) {
  const l = { genre, contexte: limiter(anonymiser(contexte, noms, entiers), 300), avant: limiter(anonymiser(avant, noms, entiers), 1500), apres: limiter(anonymiser(apres, noms, entiers), 1500) };
  if (phraseInterne(`${l.contexte} ${l.avant} ${l.apres}`)) return null;
  if (memeTexte(l.avant, l.apres)) return null;
  return l;
}

// Une réponse au client retouchée (carte « réponse » de l'Assistant, ou réponse WhatsApp préparée puis écrite autrement par Nani) :
// seulement les phrases changées. Une phrase interne (net, banque) est écartée, comme une phrase que `exclure` refuse (montant égal à un net,
// côté serveur) ; le reste peut encore servir. Le masquage passe AVANT le filtre : un IBAN se reconnaît aussi masqué.
// Rend une ligne « reponse » ou null.
export function correctionReponse(avant, apres, { noms = [], entiers = [], contexte = "", exclure = null } = {}) {
  if (!propre(apres) || partModifiee(avant, apres) === 0) return null;
  const ch = phrasesChangees(avant, apres);
  const garder = (p) => {
    const m = anonymiser(p, noms, entiers);
    return !phraseInterne(m) && !(typeof exclure === "function" && exclure(m));
  };
  const enlevees = ch.enlevees.filter(garder);
  const ajoutees = ch.ajoutees.filter(garder);
  // Un côté vidé par le filtre ferait croire à une phrase retirée ou ajoutée pour rien (« … », Nani a mis « rien ») : rien n'est gardé.
  if ((ch.enlevees.length && !enlevees.length) || (ch.ajoutees.length && !ajoutees.length)) return null;
  if (!enlevees.length && !ajoutees.length) return null;
  return ligneApprise("reponse", contexte, enlevees.join(" / "), ajoutees.join(" / "), noms, entiers);
}

// « Pas bien » sur une réponse de l'agent : la raison de la personne (200 caractères au plus), un extrait masqué de la réponse et son
// contexte. L'extrait perd ses phrases internes (net, banque, marge chiffrée) ; avec `sansMontants` (réponse de l'agent à l'équipe, qui peut
// citer des nets, des marges ou des gains), aussi toute phrase qui porte un montant. Une raison qui parle de net ou de banque n'est pas notée.
// Les montants de la raison sont rangés à l'écran (rangerMontants) : `masquer`, les valeurs à remplacer par {montant} (nets connus) ;
// `interne`, la personne a dit « prix d'achat » : la ligne est interne (jamais dans un prompt) et tous ses montants sont masqués (la base
// le refait de toute façon).
// Rend { ligne } ou { erreur: "vide" | "longue" | "interne" }.
export function ligneRetour({ reponse = "", raison = "", contexte = "", noms = [], entiers = [], sansMontants = false, masquer = [], interne = false } = {}) {
  const r = propre(raison);
  if (!r) return { erreur: "vide" };
  if (r.length > RETOUR_MAX) return { erreur: "longue" };
  const raisonMasquee = anonymiser(r, noms, entiers);
  if (phraseInterne(raisonMasquee)) return { erreur: "interne" };
  const phrases = String(reponse || "")
    .split(FIN_DE_PHRASE)
    .map(propre)
    .filter(Boolean)
    .map((p) => anonymiser(p, noms, entiers))
    .filter((p) => !phraseInterne(p) && !(sansMontants && aMontant(p)));
  const ctx = anonymiser(contexte, noms, entiers);
  const masque = (t) => masquerMontants(t, interne ? "tous" : masquer);
  return {
    ligne: {
      genre: "retour",
      contexte: phraseInterne(ctx) ? "" : limiter(masque(ctx), 300),
      avant: limiter(masque(phrases.join(" ")), EXTRAIT_MAX),
      apres: limiter(masque(raisonMasquee), RETOUR_MAX),
      ...(interne ? { interne: true } : {}),
    },
  };
}
