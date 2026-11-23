// Modèle de réponse de prix (23.11.2026, demande de Jérémy) : quand un client demande le prix d'un service et que la réponse donne ce prix,
// l'Assistant reprend mot pour mot le texte type de l'entreprise marqué « Réponse de prix » (usage `prix` dans l'écran Messages). Il ne
// remplit que les variables ({total}, {prenom}, {entreprise}). Logique pure, sans dépendance : la fonction agent, la boîte WhatsApp et les
// tests node.
//
// Avant ce module, les textes types n'entraient jamais dans les consignes : l'Assistant ne les voyait qu'en appelant lire_reglages, outil
// présenté pour changer un réglage. Sa première réponse suivait donc la voix, puis il proposait de modifier la voix pour « imposer » le modèle.
//
// Chaque entreprise garde ses textes : seuls les réglages de l'entreprise active (ctx.reglages) sont lus. Le modèle de Taxi ne sert jamais
// chez Secret ni chez ZTP, même en espace unifié.

export const USAGE_PRIX = "prix";
const VARIABLES_PERMISES = ["total", "prenom", "entreprise"];
const MODELES_MAX = 6;
const CORPS_MAX = 2000;

const propre = (t) => String(t ?? "").replace(/\r\n?/g, "\n");
const ligne = (t, n) => propre(t).replace(/\s+/g, " ").trim().slice(0, n);

// Les modèles de prix de l'entreprise, au client, proposés (actif ≠ false), dans la langue demandée si elle est donnée.
export function modelesPrix(reglages, langue = "") {
  const liste = reglages && Array.isArray(reglages.messages) ? reglages.messages : [];
  return liste
    .filter((m) => m && m.cle === USAGE_PRIX && (m.pour || "client") === "client" && m.actif !== false && typeof m.corps === "string" && m.corps.trim())
    .filter((m) => !langue || m.langue === langue)
    .slice(0, MODELES_MAX)
    .map((m) => ({ id: String(m.id || ""), titre: ligne(m.titre, 120), langue: String(m.langue || ""), corps: propre(m.corps).trim().slice(0, CORPS_MAX) }))
    .filter((m) => m.id);
}

export const variablesDe = (corps) => [...new Set([...propre(corps).matchAll(/\{(\w+)\}/g)].map((x) => x[1]))];

// Le modèle rempli. Sans prénom, « Hello {prenom}, » devient « Hello, ». Rend { message } ou { erreur, conseil }.
export function remplirModelePrix(modele, { total = "", prenom = "", entreprise = "" } = {}) {
  const corps = propre(modele && modele.corps);
  const inconnues = variablesDe(corps).filter((v) => !VARIABLES_PERMISES.includes(v));
  if (inconnues.length) return { erreur: "modele_prix_variable", conseil: `Le modèle contient {${inconnues.join("}, {")}} que l'Assistant ne sait pas remplir : modele_prix « aucun », hors_modele « variable inconnue », et réponds avec la voix.` };
  const t = ligne(total, 40);
  if (corps.includes("{total}") && !/\d/.test(t)) return { erreur: "modele_prix_total", conseil: "Donne dans total le prix du service tel qu'il sera écrit au client (« 2,500 THB »), venu d'un outil ou de la personne." };
  const p = ligne(prenom, 40);
  let m = corps.replaceAll("{total}", t).replaceAll("{entreprise}", ligne(entreprise, 80));
  m = p ? m.replaceAll("{prenom}", p) : m.replace(/[ \t]*\{prenom\}/g, "");
  return { message: m.replace(/[ \t]+$/gm, "").trim() };
}

// Deux textes « pareils » : mêmes mots dans le même ordre, espaces et retours à la ligne mis à part.
const comparable = (t) => propre(t).replace(/\s+/g, " ").trim();
export const memeTexte = (a, b) => comparable(a) === comparable(b);

// L'entrée de proposer_reponse vue par le modèle de prix. Rend { message, avertissements } ou { erreur, conseil }.
//   - modele_prix = un id de modèle de prix de l'entreprise, dans la langue de la réponse : le message devient le modèle rempli, quoi qu'ait
//     écrit l'Assistant (avertissement « modele_prix_remplace » s'il s'en écartait, sinon « modele_prix ») ;
//   - modele_prix = « aucun » : hors_modele dit pourquoi en une ligne, montrée à la personne (« hors_modele_prix ») ; le message reste ;
//   - modele_prix vide : la réponse ne donne pas de prix. Si elle en donne un alors qu'un modèle existe dans sa langue, l'outil demande de
//     choisir (le modèle ou « aucun » avec sa raison) : jamais de modèle ignoré en silence.
// `montants` : les montants lus dans le message proposé (montantsDuTexte), pour reconnaître une réponse qui donne un prix.
export function appliquerModelePrix(e, { reglages = null, entreprise = "", montants = [] } = {}) {
  const choix = ligne(e && e.modele_prix, 80);
  const langue = (e && e.langue) || "";
  const tous = modelesPrix(reglages);
  const dansLangue = tous.filter((m) => m.langue === langue);
  const message = typeof (e && e.message) === "string" ? e.message : "";
  if (!choix) {
    if (dansLangue.length && montants.some((n) => n > 0))
      return { erreur: "modele_prix_a_choisir", conseil: `La réponse donne un prix et l'entreprise a un modèle de réponse de prix dans cette langue (${dansLangue.map((m) => `${m.id} « ${m.titre} »`).join(", ")}). Reprends proposer_reponse avec modele_prix = cet id (et total, prenom), ou modele_prix « aucun » avec hors_modele = la raison en une ligne.` };
    return { message, avertissements: [] };
  }
  if (choix === "aucun") {
    const raison = ligne(e.hors_modele, 100);
    if (dansLangue.length && !raison) return { erreur: "hors_modele_sans_raison", conseil: "Dis en une ligne dans hors_modele pourquoi le modèle de prix ne convient pas (plusieurs options, minivan partagé, prix inconnu…)." };
    return { message, avertissements: dansLangue.length ? [`hors_modele_prix:${raison}`] : [] };
  }
  const modele = tous.find((m) => m.id === choix);
  if (!modele) return { erreur: "modele_prix_inconnu", conseil: tous.length ? `Les modèles de prix de cette entreprise : ${tous.map((m) => `${m.id} (${m.langue})`).join(", ")}. Aucun autre texte type ne sert de modèle de prix.` : "Cette entreprise n'a pas de modèle de réponse de prix : laisse modele_prix vide et suis la voix." };
  if (modele.langue && langue && modele.langue !== langue) return { erreur: "modele_prix_langue", conseil: `Ce modèle est en ${modele.langue} : réponds dans sa langue, ou modele_prix « aucun » avec la raison.` };
  const r = remplirModelePrix(modele, { total: e.total, prenom: e.prenom, entreprise });
  if (r.erreur) return r;
  return { message: r.message, avertissements: [`${memeTexte(message, r.message) ? "modele_prix" : "modele_prix_remplace"}:${modele.titre}`] };
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
- Quand le client demande un prix et que ta réponse lui donne le prix d'un seul service de ${nom} qui correspond au titre d'un de ces modèles, dans la langue du modèle : appelle proposer_reponse avec modele_prix = l'id du modèle, total = ce prix tel qu'il sera écrit (« 2,500 THB ») et prenom = le prénom du client s'il est connu, sinon "". Écris dans message le modèle rempli, mot pour mot : ne reformule rien, ne change pas l'ordre, n'ajoute aucune ligne. L'outil remet de toute façon le modèle tel quel. Dès le premier message, et à chaque nouveau prix demandé.
- Ce modèle passe avant la voix et avant tout autre texte type, « Réponse à une demande » (« Reply to a request ») compris. Il ne sert que pour les services de ${nom}, jamais pour ceux d'une autre entreprise.
- Quand le modèle ne convient pas (plusieurs options ou plusieurs prix demandés, minivan partagé, autre service, prix inconnu) : modele_prix = « aucun » et hors_modele = la raison en une ligne pour ${qui} ; la réponse suit alors la voix. Une réponse qui ne donne aucun prix : modele_prix vide.
- Ne propose jamais de changer la voix ou un texte type pour faire respecter un modèle : il s'applique déjà tout seul.`;
}

// Une voix qui recopie un modèle de prix (une de ses lignes d'au moins 20 caractères, ou {total}) : refusée par proposer_reglage.
export function voixCopieModele(valeur, reglages) {
  const v = comparable(valeur);
  if (!v) return false;
  return modelesPrix(reglages).some((m) => v.includes("{total}") || propre(m.corps).split("\n").map(comparable).some((l) => l.length >= 20 && v.includes(l)));
}
