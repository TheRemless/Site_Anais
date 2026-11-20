// Agent de l'Action « Amélioration Gestion » : les outils de fichiers que Claude appelle (20.11.2026). Logique pure, sans dépendance, testée
// par tests/gestion-amelioration-agent.test.js.
//
// Claude lit, cherche et modifie des fichiers du dépôt, rien d'autre : aucune commande, aucun réseau, aucun code du dépôt n'est exécuté.
// Chaque chemin est ramené dans la racine du dépôt (ni « .. », ni chemin absolu, ni lien symbolique) ; l'écriture est refusée sur les
// fichiers qui changent la CI, Netlify, les dépendances, Claude Code ou cet agent lui-même. Le contrôle des fichiers du job « ouvrir-pr »
// reste la seconde barrière.
import fs from "node:fs";
import path from "node:path";

// Lecture interdite : l'historique git et les dossiers générés (rien d'utile, beaucoup de bruit).
// À tous les niveaux pour .git et node_modules (un sous-dossier peut avoir les siens).
const CACHES = /(^|\/)(\.git|node_modules)(\/|$)|^(_site|\.amelioration)(\/|$)/;
// Écriture interdite, en plus des caches.
export const INTERDITS = /^(\.github\/|\.claude\/|\.husky\/|scripts\/amelioration-agent\/|scripts\/netlify-ignore\.sh$|netlify\.toml$|package\.json$|package-lock\.json$|\.npmrc$|\.nvmrc$|supabase\/config\.toml$|CLAUDE(\.local)?\.md$|AGENTS\.md$|\.mcp\.json$)|(^|\/)\.gitattributes$|(^|\/)\.gitmodules$/;

export const LIGNES_MAX = 600; // par lecture
export const OCTETS_MAX_FICHIER = 1_000_000; // au-delà, le fichier n'est ni lu ni cherché
export const RESULTATS_MAX = 120;
export const MOTIF_MAX = 200;
// Une recherche s'arrête au bout de ce temps : un motif à retour arrière catastrophique ne bloque pas le job.
export const RECHERCHE_MS = 15_000;

// Le chemin relatif propre d'un chemin donné par Claude, ou une erreur.
export function cheminPermis(racine, chemin, { ecriture = false } = {}) {
  if (typeof chemin !== "string" || !chemin.trim() || chemin.length > 300) return { erreur: "chemin_invalide" };
  if (path.isAbsolute(chemin) || chemin.includes("\0")) return { erreur: "chemin_absolu" };
  const rel = path.posix.normalize(chemin.replace(/\\/g, "/").replace(/^\.\//, ""));
  if (rel === "." || rel.startsWith("../") || rel === "..") return { erreur: "hors_du_depot" };
  if (CACHES.test(rel)) return { erreur: "dossier_interdit" };
  if (ecriture && INTERDITS.test(rel)) return { erreur: "fichier_interdit" };
  // Aucun lien symbolique sur le trajet : un lien pourrait mener hors du dépôt.
  let courant = racine;
  for (const morceau of rel.split("/")) {
    courant = path.join(courant, morceau);
    try {
      if (fs.lstatSync(courant).isSymbolicLink()) return { erreur: "lien_symbolique" };
    } catch {
      break; // le reste n'existe pas encore (nouveau fichier)
    }
  }
  return { rel, absolu: path.join(racine, rel) };
}

// Tous les fichiers du dépôt (chemins relatifs), caches exclus, liens ignorés.
export function fichiersDuDepot(racine, depuis = "") {
  const out = [];
  const parcourir = (dossier) => {
    let entrees = [];
    try {
      entrees = fs.readdirSync(path.join(racine, dossier), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entrees) {
      const rel = dossier ? `${dossier}/${e.name}` : e.name;
      if (CACHES.test(rel) || e.isSymbolicLink()) continue;
      if (e.isDirectory()) parcourir(rel);
      else if (e.isFile()) out.push(rel);
    }
  };
  parcourir(depuis);
  return out.sort();
}

const obj = (properties, description) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}) });
const S = (description) => ({ type: "string", description });
const I = (description) => ({ type: "integer", description });

export const OUTILS = [
  {
    name: "lister_fichiers",
    description: "Liste les fichiers du dépôt dont le chemin contient un des mots donnés (sans accents ni casse), sous un dossier. 120 résultats au plus.",
    input_schema: obj({ dossier: S("Dossier de départ (« src/gestion/js »), ou \"\" pour tout le dépôt."), contient: S("Mots du chemin séparés par des espaces (« agent calc »), ou \"\" pour tout lister.") }),
  },
  {
    name: "lire_fichier",
    description: "Lit un fichier du dépôt, lignes numérotées. 600 lignes au plus par appel : relire avec « debut » pour la suite.",
    input_schema: obj({ chemin: S("Chemin depuis la racine du dépôt."), debut: I("Première ligne à lire (1 pour le début).") }),
  },
  {
    name: "chercher",
    description: "Cherche une expression régulière JavaScript dans les fichiers du dépôt (sous un dossier). Rend chemin:ligne: texte, 120 résultats au plus.",
    input_schema: obj({ motif: S("Expression régulière (« proposer_reglage », « function vueAgent »)."), dossier: S("Dossier où chercher, ou \"\" pour tout le dépôt.") }),
  },
  {
    name: "remplacer",
    description: "Remplace un passage exact d'un fichier par un autre. Le passage doit apparaître une seule fois (sinon donne plus de contexte). Lis le fichier avant.",
    input_schema: obj({ chemin: S("Chemin depuis la racine du dépôt."), ancien: S("Le passage exact à remplacer, espaces et retours à la ligne compris."), nouveau: S("Le nouveau passage.") }),
  },
  {
    name: "ecrire_fichier",
    description: "Crée un fichier, ou remplace un fichier entier. Pour une petite modification d'un fichier existant, préfère « remplacer ».",
    input_schema: obj({ chemin: S("Chemin depuis la racine du dépôt."), contenu: S("Le contenu complet du fichier.") }),
  },
  {
    name: "terminer",
    description: "Termine le travail. À appeler une seule fois, à la fin, avec le résumé en français (ce qui a changé et où, comment le vérifier dans l'outil, ce qui reste à décider, la migration s'il y en a une).",
    input_schema: obj({ resume: S("Le résumé, en Markdown simple.") }),
  },
];
export const NOMS = OUTILS.map((o) => o.name);

const sansAccents = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Contrôle des entrées : tous les champs du schéma, du bon type. Rend l'entrée ou null.
export function entreeValide(nom, e) {
  const def = OUTILS.find((o) => o.name === nom);
  if (!def || !e || typeof e !== "object" || Array.isArray(e)) return null;
  for (const [k, s] of Object.entries(def.input_schema.properties)) {
    const v = e[k];
    if (s.type === "string" && typeof v !== "string") return null;
    if (s.type === "integer" && !(Number.isInteger(v) && v >= 0)) return null;
  }
  return e;
}

const lireTexte = (absolu) => {
  const st = fs.statSync(absolu);
  if (!st.isFile()) return { erreur: "pas_un_fichier" };
  if (st.size > OCTETS_MAX_FICHIER) return { erreur: "fichier_trop_gros" };
  const t = fs.readFileSync(absolu, "utf8");
  if (t.includes("\0")) return { erreur: "fichier_binaire" };
  return { texte: t };
};

// Exécute un outil. Rend { contenu (texte rendu à Claude), erreur?, fin?, resume?, ecrit? (chemin modifié) }.
export function executer(nom, entree, { racine }) {
  const e = entreeValide(nom, entree);
  if (!e) return { contenu: "Entrée invalide : reprends l'appel avec tous les champs, du bon type.", erreur: true };
  try {
    if (nom === "terminer") {
      const resume = String(e.resume || "").trim().slice(0, 8000);
      return resume ? { contenu: "Terminé.", fin: true, resume } : { contenu: "Le résumé est vide.", erreur: true };
    }
    if (nom === "lister_fichiers") {
      const d = e.dossier ? cheminPermis(racine, e.dossier) : { rel: "" };
      if (d.erreur) return { contenu: `Refusé : ${d.erreur}`, erreur: true };
      const mots = sansAccents(e.contient).split(/\s+/).filter(Boolean);
      const liste = fichiersDuDepot(racine, d.rel).filter((f) => mots.every((m) => sansAccents(f).includes(m)));
      return { contenu: liste.length ? `${liste.slice(0, RESULTATS_MAX).join("\n")}${liste.length > RESULTATS_MAX ? `\n… ${liste.length - RESULTATS_MAX} de plus : précise.` : ""}` : "Aucun fichier." };
    }
    if (nom === "lire_fichier") {
      const c = cheminPermis(racine, e.chemin);
      if (c.erreur) return { contenu: `Refusé : ${c.erreur}`, erreur: true };
      if (!fs.existsSync(c.absolu)) return { contenu: "Fichier introuvable.", erreur: true };
      const l = lireTexte(c.absolu);
      if (l.erreur) return { contenu: `Refusé : ${l.erreur}`, erreur: true };
      const lignes = l.texte.split("\n");
      const debut = Math.max(1, e.debut || 1);
      const morceau = lignes.slice(debut - 1, debut - 1 + LIGNES_MAX);
      const suite = debut - 1 + LIGNES_MAX < lignes.length ? `\n… ${lignes.length} lignes en tout : relis avec debut = ${debut + LIGNES_MAX}.` : "";
      return { contenu: `${morceau.map((x, i) => `${debut + i}\t${x}`).join("\n")}${suite}` };
    }
    if (nom === "chercher") {
      let re;
      if (e.motif.length > MOTIF_MAX) return { contenu: "Motif trop long.", erreur: true };
      try {
        re = new RegExp(e.motif);
      } catch {
        return { contenu: "Expression régulière invalide.", erreur: true };
      }
      const d = e.dossier ? cheminPermis(racine, e.dossier) : { rel: "" };
      if (d.erreur) return { contenu: `Refusé : ${d.erreur}`, erreur: true };
      const trouves = [];
      const limite = Date.now() + RECHERCHE_MS;
      let coupee = false;
      for (const f of fichiersDuDepot(racine, d.rel)) {
        const l = lireTexte(path.join(racine, f));
        if (l.erreur) continue;
        // Lignes de plus de 2 000 caractères (fichiers minifiés) ignorées : c'est là qu'un motif s'emballe.
        for (const [i, ligne] of l.texte.split("\n").entries()) {
          if (ligne.length > 2000) continue;
          if (re.test(ligne)) trouves.push(`${f}:${i + 1}: ${ligne.slice(0, 240)}`);
          if (trouves.length > RESULTATS_MAX) break;
        }
        if (trouves.length > RESULTATS_MAX) break;
        if (Date.now() > limite) {
          coupee = true;
          break;
        }
      }
      const fin = trouves.length > RESULTATS_MAX ? "\n… d'autres résultats : précise le motif ou le dossier." : coupee ? "\n… recherche arrêtée (trop longue) : précise le dossier ou simplifie le motif." : "";
      return { contenu: trouves.length ? `${trouves.slice(0, RESULTATS_MAX).join("\n")}${fin}` : `Aucun résultat.${fin}` };
    }
    if (nom === "remplacer") {
      const c = cheminPermis(racine, e.chemin, { ecriture: true });
      if (c.erreur) return { contenu: `Refusé : ${c.erreur}`, erreur: true };
      if (!fs.existsSync(c.absolu)) return { contenu: "Fichier introuvable : pour un nouveau fichier, utilise ecrire_fichier.", erreur: true };
      const l = lireTexte(c.absolu);
      if (l.erreur) return { contenu: `Refusé : ${l.erreur}`, erreur: true };
      if (!e.ancien) return { contenu: "Le passage à remplacer est vide.", erreur: true };
      const n = l.texte.split(e.ancien).length - 1;
      if (n === 0) return { contenu: "Passage introuvable : relis le fichier et copie le passage exact.", erreur: true };
      if (n > 1) return { contenu: `Le passage apparaît ${n} fois : donne plus de contexte pour qu'il soit unique.`, erreur: true };
      fs.writeFileSync(c.absolu, l.texte.replace(e.ancien, () => e.nouveau));
      return { contenu: "Remplacé.", ecrit: c.rel };
    }
    if (nom === "ecrire_fichier") {
      const c = cheminPermis(racine, e.chemin, { ecriture: true });
      if (c.erreur) return { contenu: `Refusé : ${c.erreur}`, erreur: true };
      if (e.contenu.length > OCTETS_MAX_FICHIER) return { contenu: "Contenu trop long.", erreur: true };
      fs.mkdirSync(path.dirname(c.absolu), { recursive: true });
      fs.writeFileSync(c.absolu, e.contenu);
      return { contenu: "Écrit.", ecrit: c.rel };
    }
  } catch (err) {
    return { contenu: `Erreur : ${err instanceof Error ? err.message.slice(0, 200) : "inconnue"}`, erreur: true };
  }
  return { contenu: "Outil inconnu.", erreur: true };
}
