// Modèle de réponse de prix (23.11.2026, demande de Jérémy) : quand un client demande le prix d'un service et que la première réponse de
// prix de l'échange donne ce prix, l'Assistant reprend mot pour mot le texte type de l'entreprise marqué « Réponse de prix » (usage `prix`
// dans l'écran Messages). Il ne remplit que les variables ({total}, {prenom}, {entreprise}). Une question ou une autre information part
// après, en message séparé. Logique pure, sans dépendance : la fonction agent, la boîte WhatsApp et les tests node (les montants sont lus
// par la fonction `lireMontants` passée par outils.js).
//
// Avant ce module, les textes types n'entraient jamais dans les consignes : l'Assistant ne les voyait qu'en appelant lire_reglages, outil
// présenté pour changer un réglage. Sa première réponse suivait donc la voix, puis il proposait de modifier la voix pour « imposer » le modèle.
//
// Chaque entreprise garde ses textes : seuls les réglages de l'entreprise active (ctx.reglages) sont lus. Le modèle de Taxi ne sert jamais
// chez Secret ni chez ZTP, même en espace unifié (où le total doit en plus venir du catalogue de l'entreprise active, voir outils.js).

export const USAGE_PRIX = "prix";
const VARIABLES_PERMISES = ["total", "prenom", "entreprise"];
const MODELES_MAX = 6;
// Un modèle plus long ne sert pas (jamais coupé) : il reste un texte type à copier à la main.
const CORPS_MAX = 4000;
const PRENOM_MAX = 40;
const SUITE_MAX = 1500;
// Ce que le modèle « transfert privé, prix total » ne couvre pas (relecture de la PR 342) : un prix par personne, un trajet partagé.
// Mots entiers, accents compris (« partagé » : \b ne voit pas la fin d'un mot accentué).
const HORS_MODELE = /(?<![\p{L}\p{N}])(?:per\s+(?:person|pax|adult|head)|par\s+personne|pp|shared|partag[ée]e?s?|songthaew|songtaew)(?![\p{L}\p{N}])/iu;

const propre = (t) => String(t ?? "").replace(/\r\n?/g, "\n");
const ligne = (t) => propre(t).replace(/\s+/g, " ").trim();

// Les modèles de prix de l'entreprise, au client, proposés (actif ≠ false), dans la langue demandée si elle est donnée.
export function modelesPrix(reglages, langue = "") {
  const liste = reglages && Array.isArray(reglages.messages) ? reglages.messages : [];
  return liste
    .filter((m) => m && m.cle === USAGE_PRIX && (m.pour || "client") === "client" && m.actif !== false && typeof m.corps === "string" && m.corps.trim() && m.corps.length <= CORPS_MAX)
    .filter((m) => !langue || m.langue === langue)
    .slice(0, MODELES_MAX)
    .map((m) => ({ id: String(m.id || ""), titre: ligne(m.titre).slice(0, 120), langue: String(m.langue || ""), corps: propre(m.corps).trim() }))
    .filter((m) => m.id);
}

export const variablesDe = (corps) => [...new Set([...propre(corps).matchAll(/\{(\w+)\}/g)].map((x) => x[1]))];

// Un montant au format du modèle : « 2,500 THB ».
export const formatTotal = (n, devise = "THB") => `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${devise || "THB"}`;

// Le modèle rempli. `total` est déjà formaté. Sans prénom, « Hello {prenom}, » devient « Hello, ». Rend { message } ou { erreur, conseil }.
export function remplirModelePrix(modele, { total = "", prenom = "", entreprise = "" } = {}) {
  const corps = propre(modele && modele.corps);
  const inconnues = variablesDe(corps).filter((v) => !VARIABLES_PERMISES.includes(v));
  if (inconnues.length) return { erreur: "modele_prix_variable", conseil: `Le modèle contient {${inconnues.join("}, {")}} que l'Assistant ne sait pas remplir : modele_prix « aucun », hors_modele « variable inconnue », et réponds avec la voix.` };
  // Un prénom trop long n'est jamais coupé : il n'est pas mis (« Hello, »).
  const p = ligne(prenom).length <= PRENOM_MAX ? ligne(prenom) : "";
  let m = corps.replaceAll("{total}", total).replaceAll("{entreprise}", ligne(entreprise));
  m = p ? m.replaceAll("{prenom}", p) : m.replace(/[ \t]*\{prenom\}/g, "");
  return { message: m.replace(/[ \t]+$/gm, "").trim() };
}

// Deux textes « pareils » : mêmes mots dans le même ordre, espaces et retours à la ligne mis à part.
const comparable = (t) => propre(t).replace(/\s+/g, " ").trim();
export const memeTexte = (a, b) => comparable(a) === comparable(b);

// Les questions du brouillon qui ne sont ni dans le modèle ni déjà dans la suite (hôtel, heure, sièges, bagages) : elles ne se perdent pas
// quand le modèle remplace le brouillon. Une ligne qui porte un montant reste dehors (le prix est dans le modèle).
export function questionsEnPlus(brouillon, { modele = "", suite = "", lireMontants = () => [] } = {}) {
  const deja = comparable(`${modele}\n${suite}`).toLowerCase();
  return propre(brouillon)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /\?\s*\S{0,3}$/.test(l) && !lireMontants(l).some((n) => n > 0) && !deja.includes(comparable(l).toLowerCase()));
}

// L'entrée de proposer_reponse vue par le modèle de prix. Rend { message, avertissements } ou { erreur, conseil }.
//   - `controle` faux (réponse à un partenaire, un chauffeur, au personnel ou à l'apporteur lui-même ; ou un prix déjà donné au client) :
//     rien n'est imposé, le message reste tel quel ;
//   - modele_prix = un id de modèle de prix de l'entreprise, dans la langue de la réponse : le message devient le modèle rempli, quoi qu'ait
//     écrit l'Assistant, suivi de `suite` (et des questions du brouillon) en message séparé. Hors des cas couverts (plusieurs montants ou
//     plusieurs prix, prix par personne, trajet partagé, prix hors du catalogue de l'entreprise en espace unifié), le brouillon reste (la
//     voix) avec un avertissement « hors_modele_prix ». Le total doit être un prix de vente sourcé, jamais un montant interne ;
//   - modele_prix = « aucun » : hors_modele dit pourquoi en une ligne, montrée à la personne (« hors_modele_prix ») ; le message reste ;
//   - modele_prix vide : si la réponse donne un prix alors qu'un modèle existe dans sa langue, avertissement d'information
//     « modele_prix_a_choisir » ; le message reste.
// Options : `montants` (les prix lus dans le brouillon, outils.js montantsDePrix), `lireMontants` (montantsDuTexte), `permis` (prix de
// vente sourcés : outils et montants de Nani), `internes` (nets, marges, commissions), `devise`, `prixEntreprise` (en espace unifié, les prix
// du catalogue de l'entreprise active ; null hors de ce mode).
export function appliquerModelePrix(e, { reglages = null, entreprise = "", montants = [], lireMontants = () => [], permis = new Set(), internes = new Set(), devise = "THB", prixEntreprise = null, controle = true } = {}) {
  const message = typeof (e && e.message) === "string" ? e.message : "";
  if (!controle) return { message, avertissements: [] };
  const choix = ligne(e && e.modele_prix).slice(0, 80);
  const langue = (e && e.langue) || "";
  const tous = modelesPrix(reglages);
  const dansLangue = tous.filter((m) => m.langue === langue);
  const prixDuBrouillon = [...new Set(montants.filter((n) => n > 0))];
  const voix = (raison) => ({ message, avertissements: [`hors_modele_prix:${raison}`] });
  if (!choix) return { message, avertissements: dansLangue.length && prixDuBrouillon.length ? [`modele_prix_a_choisir:${dansLangue[0].titre}`] : [] };
  if (choix === "aucun") {
    const raison = ligne(e.hors_modele).slice(0, 100);
    if (dansLangue.length && !raison) return { erreur: "hors_modele_sans_raison", conseil: "Dis en une ligne dans hors_modele pourquoi le modèle de prix ne convient pas (plusieurs options, minivan partagé, prix inconnu…)." };
    return { message, avertissements: dansLangue.length ? [`hors_modele_prix:${raison}`] : [] };
  }
  const modele = tous.find((m) => m.id === choix);
  if (!modele) return { erreur: "modele_prix_inconnu", conseil: tous.length ? `Les modèles de prix de cette entreprise : ${tous.map((m) => `${m.id} (${m.langue})`).join(", ")}. Aucun autre texte type ne sert de modèle de prix.` : "Cette entreprise n'a pas de modèle de réponse de prix : laisse modele_prix vide et suis la voix." };
  if (modele.langue && langue && modele.langue !== langue) return { erreur: "modele_prix_langue", conseil: `Ce modèle est en ${modele.langue} : réponds dans sa langue, ou modele_prix « aucun » avec la raison.` };
  // Les cas que le modèle ne couvre pas : la voix, et Nani le sait.
  const total = propre(e.total);
  const lus = [...new Set(lireMontants(total).filter((n) => n > 0))];
  if (lus.length > 1) return voix("plusieurs montants dans le total");
  if (HORS_MODELE.test(total) || HORS_MODELE.test(message)) return voix("prix par personne ou trajet partagé");
  if (prixDuBrouillon.length > 1) return voix("plusieurs prix dans la réponse");
  if (modele.corps.includes("{total}")) {
    const n = lus[0];
    if (!n || internes.has(n) || !permis.has(n)) return { erreur: "modele_prix_total", conseil: "Le total doit être le prix de vente du service, tel que rendu par un outil ou écrit par la personne : un seul montant, jamais un net, une marge ou une commission. Sinon modele_prix « aucun » avec la raison." };
    if (prixEntreprise && !prixEntreprise.has(n)) return voix(`prix hors du catalogue de ${ligne(entreprise) || "l'entreprise"}`);
  }
  const r = remplirModelePrix(modele, { total: lus.length ? formatTotal(lus[0], devise) : "", prenom: e.prenom, entreprise });
  if (r.erreur) return r;
  const suite = propre(e.suite).trim();
  if (suite.length > SUITE_MAX) return { erreur: "suite_trop_longue", conseil: "La suite est un court message séparé (une question, une information) : raccourcis-la." };
  const enPlus = questionsEnPlus(message, { modele: r.message, suite, lireMontants });
  const reste = [suite, ...enPlus].filter(Boolean).join("\n");
  const avert = [`${memeTexte(message, r.message) ? "modele_prix" : "modele_prix_remplace"}:${modele.titre}`];
  return { message: reste ? `${r.message}\n\n${reste}` : r.message, avertissements: avert };
}

// Le bloc des consignes (prompt.js) : les modèles de prix de l'entreprise active et la règle qui les impose. Vide sans modèle.
export function consignesModelesPrix(reglages, { entreprise = "", qui = "l'équipe" } = {}) {
  const tous = modelesPrix(reglages);
  if (!tous.length) return "";
  const nom = entreprise || "l'entreprise";
  const indente = (t) => t.split("\n").map((l) => `      ${l}`).join("\n");
  return `
- Modèles de réponse de prix de ${nom} (textes types « Réponse de prix », écrits par ${qui}) :
${tous.map((m) => `  - ${m.id}, « ${m.titre} », langue ${m.langue || "?"} :\n${indente(m.corps)}`).join("\n")}
- Première réponse de prix à un client : quand il demande un prix et que ta réponse lui donne le prix total d'un seul service de ${nom} qui correspond au titre d'un de ces modèles, dans la langue du modèle, appelle proposer_reponse avec modele_prix = l'id du modèle, total = ce prix (« 2,500 THB ») et prenom = le prénom du client s'il est connu, sinon "". Écris dans message le modèle rempli, mot pour mot : ne reformule rien, ne change pas l'ordre, n'ajoute aucune ligne. L'outil remet de toute façon le modèle tel quel.
- Si la réponse doit aussi poser une question (hôtel, heure de pickup, sièges enfant, bagages) ou donner une autre information, mets-la dans suite et pas dans le modèle : elle part en message séparé, après une ligne vide.
- Ce modèle passe avant la voix et avant tout autre texte type, « Réponse à une demande » (« Reply to a request ») compris. Il ne sert que pour les services de ${nom}, jamais pour ceux d'une autre entreprise, et seulement au client : jamais à un partenaire, un chauffeur ou un apporteur.
- Quand le modèle ne convient pas (plusieurs options ou plusieurs prix, prix par personne, minivan partagé, autre service, prix inconnu) : modele_prix = « aucun » et hors_modele = la raison en une ligne pour ${qui} ; la réponse suit alors la voix. Une réponse qui ne donne aucun prix, ou qui confirme un prix déjà donné : modele_prix vide.
- Ne propose jamais de changer la voix ou un texte type pour faire respecter un modèle : il s'applique déjà tout seul.`;
}

// Une voix qui recopie un modèle de prix (une de ses lignes d'au moins 20 caractères, ou {total}) : refusée par proposer_reglage.
export function voixCopieModele(valeur, reglages) {
  const v = comparable(valeur);
  const tous = modelesPrix(reglages);
  if (!v || !tous.length) return false;
  return v.includes("{total}") || tous.some((m) => propre(m.corps).split("\n").map(comparable).some((l) => l.length >= 20 && v.includes(l)));
}
