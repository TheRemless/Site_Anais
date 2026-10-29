// Langue de l'interface : français (par défaut) ou anglais.
// Les textes du code sont écrits en français et servent de clé : tr("Nouveau dossier") rend le texte français tel quel
// ou sa traduction (i18n-en.mjs). Une clé sans traduction s'affiche en français et se retrouve dans manquants().
// Le fichier ne dépend pas du navigateur, pour que la logique pure et les tests puissent l'utiliser.
import { EN } from "./i18n-en.mjs";

export const LANGUES = [
  { code: "fr", nom: "Français", locale: "fr-CH" },
  { code: "en", nom: "English", locale: "en-GB" },
];
const CLE_STOCKAGE = "gestion-langue";

let langue = "fr";
const absents = new Set();

export const langueActive = () => langue;
export const estLangue = (code) => LANGUES.some((l) => l.code === code);
export const localeActive = () => LANGUES.find((l) => l.code === langue).locale;

// Langue gardée dans ce navigateur : elle sert avant la connexion et quand le compte n'en a pas encore.
export function langueStockee() {
  try {
    const v = localStorage.getItem(CLE_STOCKAGE);
    return estLangue(v) ? v : null;
  } catch {
    return null;
  }
}

export function definirLangue(code) {
  if (!estLangue(code)) return false;
  langue = code;
  try {
    localStorage.setItem(CLE_STOCKAGE, code);
  } catch {
    // stockage refusé : la langue vaut pour cette visite seulement
  }
  if (typeof document !== "undefined") document.documentElement.lang = code;
  return true;
}

// Pour les tests et la première ouverture : change la langue sans toucher au stockage.
export function forcerLangue(code) {
  if (estLangue(code)) langue = code;
}

const remplacer = (texte, vars) => (vars ? texte.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : texte);

// Texte de l'interface dans la langue active. Les variables {nom} sont remplacées par vars.nom.
export function tr(fr, vars) {
  if (langue === "fr") return remplacer(fr, vars);
  const en = EN[fr];
  if (en === undefined) {
    absents.add(fr);
    return remplacer(fr, vars);
  }
  return remplacer(en, vars);
}

// Marque un texte à traduire plus tard (constantes de module, listes) : on le traduit à l'affichage avec tr().
export const N_ = (fr) => fr;

// « 3 jours » : la règle du pluriel change d'une langue à l'autre (0 jour en français, 0 days en anglais).
// Un texte contenant {n} est une phrase complète (« {n} dossier sélectionné »), sinon le nombre est placé devant.
export function pluriel(n, un, plusieurs, vars) {
  const plur = langue === "fr" ? n > 1 : n !== 1;
  const cle = plur ? plusieurs : un;
  return cle.includes("{n}") ? tr(cle, { n, ...vars }) : `${n} ${tr(cle, vars)}`;
}

export const manquants = () => [...absents];

// Noms de mois et de jours dans la langue de l'interface (les documents et messages gardent leur propre langue).
const enUtc = (iso) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +(iso.slice(8, 10) || 1)));
const format = (iso, options) => enUtc(iso).toLocaleDateString(localeActive(), { ...options, timeZone: "UTC" });
export const moisLong = (iso) => format(iso, { month: "long" });
export const moisCourt = (iso) => format(iso, { month: "short" });
// « mercredi 29 octobre » / « Wednesday 29 October », avec une majuscule initiale.
export function dateLongue(d = new Date()) {
  const t = d.toLocaleDateString(localeActive(), { weekday: "long", day: "numeric", month: "long" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
// « 29 octobre 2026 » / « 29 October 2026 ».
export const dateComplete = (iso) => format(iso, { day: "numeric", month: "long", year: "numeric" });
