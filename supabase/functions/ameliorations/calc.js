// Ce fichier existe en deux exemplaires identiques : supabase/functions/ameliorations/calc.js (fonctions) et src/gestion/js/ameliorations-calc.mjs (écran).
// Demandes d'amélioration de Gestion (20.11.2026) : logique pure, sans dépendance (fonctions « ameliorations », « agent » et « rappels »,
// tests node). Une administratrice valide dans l'Assistant une demande reformulée avec l'agent ; la fonction l'enregistre et ouvre une issue
// sur le dépôt du site, que l'Action « Amélioration Gestion » implémente dans une PR. Jérémy relit et décide de la fusion.
//
// Le dépôt est PUBLIC : le texte de l'issue se lit par tout le monde. Il ne contient que la demande sur l'outil, contrôlée ici : ni nom de
// client, ni téléphone, ni adresse, ni montant, ni prestataire, ni coordonnée bancaire ou accès. Un mot d'argent interne (net, commission) est signalé.

export const DEPOT = "TheRemless/Site_Anais";
export const LABEL = "amelioration-gestion";
export const LABEL_PR = "amelioration-pr-prete";
export const LABEL_SENSIBLE = "a-relire-de-pres";
export const LABEL_ECHEC = "amelioration-echec";
// Le compte qui écrit les commentaires de l'Action (jeton GITHUB_TOKEN du workflow). Un commentaire d'une autre personne n'est jamais lu
// comme un suivi : sur un dépôt public, n'importe qui peut commenter une issue.
export const AUTEUR_ACTION = "github-actions[bot]";
export const LIMITE_JOUR_DEFAUT = 3;
export const TITRE_MAX = 80;
export const TEXTE_MAX = 3000;
export const STATUTS = ["envoyee", "pr_prete", "en_ligne", "refusee", "echec"];
// Statuts encore suivis sur GitHub par la fonction « rappels » (les autres sont définitifs).
export const STATUTS_SUIVIS = ["envoyee", "pr_prete", "echec"];

const sansAccents = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const uneLigne = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

// Titre d'issue : une ligne, sans crochets (« [preview] » ou « [skip ci] » changeraient ce que font Netlify et la CI) ni mention.
export function titreIssue(titre) {
  const t = uneLigne(titre, TITRE_MAX).replace(/[[\]{}<>`@#]/g, "").trim();
  return t ? `Gestion : ${t}` : "";
}

// Texte de la demande : lignes gardées, espaces en trop retirés, commentaires HTML et mentions neutralisés.
export function nettoyerTexte(texte) {
  return String(texte || "")
    .replace(/\r\n?/g, "\n")
    .replace(/<!--|-->/g, "")
    .replace(/@(?=[A-Za-z0-9])/g, "@​")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Mots d'argent interne : la demande peut parler de la fonction (« une colonne commission »), jamais d'une valeur. Signalés à la personne.
const INTERNE = /\b(nets?|net price|commissions?|marges?|margins?|prix d'achat|cost price)\b/i;
// Coordonnées bancaires et accès : jamais dans une issue publique.
const ACCES = /\b(iban|swift|bic|num[eé]ro de compte|account number|mot de passe|password|cl[eé] d'api|api key|token)\b/i;
const COURRIEL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const TELEPHONE = /(?:\+|\b)\d[\d .()-]{7,}\d\b/;
const LIEN = /\bhttps?:\/\/|\bwww\./i;
// Un montant ou un numéro : une monnaie à côté d'un chiffre, ou un nombre de trois chiffres ou plus (« 900 », « 1 500 ») hors années.
const MONTANT = /(?:฿|thb|chf|eur|€|\$|usd|baht)\s*\d|\d\s*(?:฿|thb|chf|eur|€|\$|usd|baht)\b|\b\d{1,3}(?:[ ,']\d{3})+\b|\b\d{3,}\b/i;

// Contrôle du texte public. `noms` : prestataires de l'entreprise et noms de clients vus dans la conversation.
// Rend { ok, erreurs (bloquent l'envoi), avertissements (montrés à la personne) }.
export function controlerTexte(texte, { noms = [] } = {}) {
  const t = String(texte || "");
  const erreurs = [];
  const avertissements = [];
  if (!t.trim()) erreurs.push("texte_vide");
  if (t.length > TEXTE_MAX) erreurs.push("texte_trop_long");
  if (COURRIEL.test(t)) erreurs.push("courriel");
  const sansDates = t.replace(/\b20[2-3]\d-\d\d-\d\d\b/g, " ").replace(/\b\d{1,2}[/.]\d{1,2}[/.]20[2-3]\d\b/g, " ");
  if (TELEPHONE.test(sansDates)) erreurs.push("telephone");
  if (LIEN.test(t)) erreurs.push("lien");
  if (MONTANT.test(sansDates.replace(/\b20[2-3]\d\b/g, " "))) erreurs.push("montant");
  if (ACCES.test(sansAccents(t))) erreurs.push("acces");
  const plat = ` ${sansAccents(t).replace(/[^a-z0-9]+/g, " ")} `;
  const nom = noms.map((n) => sansAccents(n).replace(/[^a-z0-9]+/g, " ").trim()).find((n) => n.length > 2 && plat.includes(` ${n} `));
  if (nom) erreurs.push("nom_propre");
  const interne = INTERNE.exec(sansAccents(t));
  if (interne) avertissements.push(`mot_interne:${interne[0]}`);
  return { ok: !erreurs.length, erreurs, avertissements };
}

// Le texte de la demande, assemblé par l'agent à partir de la conversation (la personne le relit et le corrige dans la carte).
export function texteDemande({ besoin = "", ecran = "", changements = [], portee = "cette_entreprise", entreprise = "", fonctionnement = "" }) {
  const mode = { sur_mesure: "voyages sur mesure", excursions: "excursions et transferts", taxi: "taxi" }[fonctionnement] || "";
  const lignes = [`Besoin : ${uneLigne(besoin, 600)}`];
  if (uneLigne(ecran, 160)) lignes.push(`Écran : ${uneLigne(ecran, 160)}`);
  const pts = (Array.isArray(changements) ? changements : []).map((c) => uneLigne(c, 300)).filter(Boolean).slice(0, 12);
  if (pts.length) lignes.push("", "Ce qui changera :", ...pts.map((c) => `- ${c}`));
  lignes.push("", portee === "toutes" ? "Concerne : toutes les entreprises de l'outil." : `Concerne : ${entreprise || "cette entreprise"} seulement${mode ? ` (mode ${mode})` : ""}, sans rien changer chez les autres.`);
  return lignes.join("\n");
}

// Corps de l'issue. La première ligne est le repère que lit l'Action ; l'identifiant relie l'issue à la ligne de la table.
export function corpsIssue({ id, texte, entreprise = "", fonctionnement = "", date = "" }) {
  return [
    `<!-- gestion-amelioration id=${id} -->`,
    `Demande d'amélioration de Gestion, validée par une administratrice dans l'onglet Assistant${date ? ` le ${date}` : ""}.`,
    `Entreprise : ${uneLigne(entreprise, 80) || "non précisée"}${fonctionnement ? ` (fonctionnement « ${fonctionnement} »)` : ""}.`,
    "",
    "## Demande",
    "",
    nettoyerTexte(texte),
    "",
    "---",
    "L'Action « Amélioration Gestion » prépare une PR en brouillon. Elle ne fusionne rien, ne déploie rien et n'applique aucune migration : Jérémy relit et décide.",
  ].join("\n");
}

// Contrôle d'une demande avant son envoi (fonction « ameliorations »). Rend { ok, titre, texte } ou { ok: false, erreur, statut }.
export function controlerDemande({ permissions = [], carte = null, entiteId = "", titre = "", texte = "", demandesDuJour = 0, limiteJour = LIMITE_JOUR_DEFAUT, noms = [] }) {
  if (!permissions.includes("reglages.ecrire")) return { ok: false, statut: 403, erreur: "reserve_admin" };
  if (!carte || carte.genre !== "amelioration" || carte.entite_id !== entiteId) return { ok: false, statut: 404, erreur: "carte_introuvable" };
  if (carte.statut !== "proposee") return { ok: false, statut: 409, erreur: "deja_decidee" };
  if (demandesDuJour >= limiteJour) return { ok: false, statut: 429, erreur: "limite_du_jour", limite: limiteJour };
  const t = titreIssue(titre);
  const corps = nettoyerTexte(texte);
  if (!t) return { ok: false, statut: 400, erreur: "titre_vide" };
  const c = controlerTexte(`${titre}\n${corps}`, { noms });
  if (!c.ok) return { ok: false, statut: 400, erreur: "texte_refuse", motifs: c.erreurs };
  return { ok: true, titre: uneLigne(titre, TITRE_MAX), texte: corps };
}

// ---- Suivi sur GitHub (fonction « rappels », toutes les 10 minutes) -----------------------------------------------------------------

const PR = new RegExp(`^https://github\\.com/${DEPOT.replace("/", "\\/")}/pull/(\\d+)$`);
// Repères posés par l'Action dans ses commentaires :
//   <!-- gestion-pr url=https://github.com/TheRemless/Site_Anais/pull/123 sensible=1 tests=ok -->
//   <!-- gestion-echec -->
export function lireSuivi(issue, commentaires = []) {
  if (!issue || typeof issue !== "object") return null;
  let pr = null;
  let echec = false;
  for (const c of commentaires || []) {
    if (!c || !c.user || c.user.login !== AUTEUR_ACTION) continue;
    const corps = String(c.body || "");
    const m = /<!-- gestion-pr url=(\S+) sensible=([01]) tests=(ok|echec) -->/.exec(corps);
    if (m && PR.test(m[1])) {
      pr = { url: m[1], numero: Number(PR.exec(m[1])[1]), sensible: m[2] === "1", tests: m[3] };
      echec = false;
    } else if (corps.includes("<!-- gestion-echec -->")) echec = true;
  }
  const base = { pr_url: pr ? pr.url : null, sensible: pr ? pr.sensible : false, tests: pr ? pr.tests : null };
  if (issue.state === "closed") return { ...base, statut: issue.state_reason === "not_planned" ? "refusee" : "en_ligne" };
  if (echec) return { ...base, statut: "echec" };
  if (pr) return { ...base, statut: "pr_prete" };
  return { ...base, statut: "envoyee" };
}

// Ce qui change entre la ligne enregistrée et le suivi lu, puis qui prévenir : Jérémy (administration générale) quand la PR est prête ou que
// l'Action a échoué, l'autrice quand la demande est en ligne ou refusée.
export function changement(ligne, suivi) {
  if (!suivi) return null;
  const patch = {};
  if (suivi.statut !== ligne.statut) patch.statut = suivi.statut;
  if (suivi.pr_url && suivi.pr_url !== ligne.pr_url) patch.pr_url = suivi.pr_url;
  if (suivi.sensible !== !!ligne.sensible && suivi.pr_url) patch.sensible = suivi.sensible;
  if (!Object.keys(patch).length) return null;
  const prevenir = patch.statut === "pr_prete" || patch.statut === "echec" ? "administration" : patch.statut === "en_ligne" || patch.statut === "refusee" ? "autrice" : null;
  return { patch, prevenir };
}

// Notification d'une demande (aucun nom de client : le titre est celui, contrôlé, de l'issue). Même forme que les rappels (sw.js) :
// { titre, corps, url, tag }. Le lien de la PR ou de l'issue s'ouvre hors de l'outil (sw.js n'ouvre que github.com au dehors).
export function notification(statut, ligne, options = {}) {
  const m = notificationBrute(statut, ligne, options);
  return m ? { ...m, tag: `amelioration-${ligne.id || ""}` } : null;
}
function notificationBrute(statut, ligne, { langue = "fr", tests = null } = {}) {
  const en = langue === "en";
  const titre = uneLigne(ligne.titre, TITRE_MAX);
  if (statut === "pr_prete")
    return { titre: en ? "Improvement ready to review" : "Amélioration prête à relire", corps: `${titre}${ligne.sensible ? (en ? " · review closely" : " · à relire de près") : ""}${tests === "echec" ? (en ? " · tests failing" : " · tests en échec") : ""}`, url: ligne.pr_url || ligne.issue_url || "/gestion/#/agent" };
  if (statut === "echec") return { titre: en ? "Improvement failed" : "Amélioration en échec", corps: en ? `${titre}: the Action stopped, see the issue.` : `${titre} : l'Action s'est arrêtée, voir l'issue.`, url: ligne.issue_url || "/gestion/#/agent" };
  if (statut === "en_ligne") return { titre: en ? "Improvement accepted" : "Amélioration acceptée", corps: en ? `${titre}: it will be online with the next update.` : `${titre} : elle sera en ligne à la prochaine mise à jour.`, url: "/gestion/#/agent" };
  if (statut === "refusee") return { titre: en ? "Improvement not kept" : "Amélioration non retenue", corps: en ? `${titre}: it was not kept, ask Jérémy why.` : `${titre} : elle n'a pas été retenue, demandez à Jérémy pourquoi.`, url: "/gestion/#/agent" };
  return null;
}
