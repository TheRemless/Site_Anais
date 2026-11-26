// Calculs purs des composants mobiles (tri, filtres, pagination, clavier, brouillon). Aucun accès au navigateur : les tests Node les couvrent.

// Hauteur du clavier visible : ce que le viewport visuel a perdu par rapport à la fenêtre. Un zoom par pincement
// réduit aussi le viewport visuel : il ne compte pas comme un clavier. Sous 120 px (barre d'adresse qui bouge), rien.
// Le décalage du viewport visuel (offsetTop) n'entre pas dans le calcul (26.11.2026) : c'est une position, qui bouge quand la page change de
// hauteur. Le soustraire faisait boucler iOS sur une page courte (nouvelle discussion de l'Assistant) : hauteur 0, puis 212 px, puis 0…
// `reference` : la plus grande hauteur de fenêtre vue pour cette largeur. Dans l'app installée, iOS réduit parfois la fenêtre elle-même
// (innerHeight = hauteur visible) : sans elle, le clavier ouvert mesurerait 0.
// `petitSeuil` (un champ a le focus sur un écran tactile, relecture de la PR 355) : la barre de raccourcis d'un clavier matériel (45 à 70 px)
// compte aussi. Elle se mesure sur la fenêtre elle-même (la barre d'adresse qui bouge change les deux hauteurs, elle ne compte jamais).
export const SEUIL_CLAVIER = 120;
export const SEUIL_BARRE_RACCOURCIS = 40;
export function hauteurClavier(innerHeight, vv, reference = innerHeight, { petitSeuil = false } = {}) {
  if (!vv || (vv.scale || 1) > 1.01) return 0;
  const local = Math.round(innerHeight - vv.height);
  const total = Math.round(Math.max(innerHeight, reference || 0) - vv.height);
  if (petitSeuil && local > SEUIL_BARRE_RACCOURCIS) return Math.max(local, total);
  return total > SEUIL_CLAVIER ? total : 0;
}

// Distance entre le bas de la fenêtre (viewport de mise en page) et le bas de ce qui est visible au-dessus du clavier : ce qu'il faut
// ajouter au `bottom` d'un élément fixé ou collé en bas. iOS décale le viewport visuel (offsetTop) au lieu de défiler quand la page ne peut
// plus descendre : la distance baisse d'autant. Elle ne sert qu'à placer, jamais à changer la hauteur de la page (sinon iOS redécale et la
// valeur bouge encore). Sans clavier, 0.
// Plancher : 0 dans Safari (le rebond élastique pousse offsetTop au-delà, relecture de la PR 355) ; dans l'app installée, où iOS réduit
// aussi la fenêtre (619 px de fenêtre, 409 visibles décalés de 305, référence 812), la distance peut descendre jusqu'à ce que la fenêtre a
// perdu : -95 ici, sinon les barres passaient sous la barre d'outils du clavier.
export function basVisible(innerHeight, vv, reference = innerHeight, options = {}) {
  if (!hauteurClavier(innerHeight, vv, reference, options)) return 0;
  const brut = Math.round(innerHeight - vv.height - (vv.offsetTop || 0));
  const plancher = Math.min(0, Math.round(innerHeight - Math.max(innerHeight, reference || 0)));
  return Math.max(plancher, brut);
}

// L'état du clavier pour l'écran (ui.mjs, suivreClavier), relecture de la PR 355 :
//   - seulement sur un écran tactile ET quand un champ de saisie a le focus : une fenêtre d'ordinateur réduite (moitié d'écran, outils de
//     développement, Split View) n'est jamais un clavier ;
//   - une hauteur de référence par largeur (Map largeur → plus grande hauteur vue) : tourner l'app installée clavier ouvert puis revenir en
//     portrait retrouve la référence du portrait.
// Rend { clavier, bas, haut, references } (references : une nouvelle Map, l'ancienne n'est pas modifiée).
export function etatClavier({ largeur, innerHeight, vv, references = new Map(), tactile = false, saisie = false }) {
  const refs = new Map(references);
  refs.set(largeur, Math.max(refs.get(largeur) || 0, innerHeight || 0));
  const reference = refs.get(largeur);
  if (!tactile || !saisie || !vv) return { clavier: 0, bas: 0, haut: 0, references: refs };
  const options = { petitSeuil: true };
  const clavier = hauteurClavier(innerHeight, vv, reference, options);
  return { clavier, bas: clavier ? basVisible(innerHeight, vv, reference, options) : 0, haut: clavier ? Math.max(0, Math.round(vv.offsetTop || 0)) : 0, references: refs };
}

// Un champ qui ouvre le clavier : zone de texte, champ texte (pas une case, un bouton radio, un sélecteur de fichier…) ou contenu modifiable.
const TYPES_SANS_CLAVIER = new Set(["checkbox", "radio", "button", "submit", "reset", "file", "image", "range", "color", "hidden"]);
export function ouvreClavier(el) {
  if (!el || el.disabled || el.readOnly) return false;
  const tag = String(el.tagName || "").toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") return !TYPES_SANS_CLAVIER.has(String(el.type || "text").toLowerCase());
  return el.isContentEditable === true;
}

const sansAccents = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const normaliser = sansAccents;

// Comparaison pour le tri : nombres comme des nombres, dates ISO et textes à la française (accents et chiffres justes), vides à la fin.
export function comparer(a, b) {
  const vide = (v) => v === null || v === undefined || v === "" || Number.isNaN(v);
  if (vide(a) && vide(b)) return 0;
  if (vide(a)) return 1;
  if (vide(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "fr", { numeric: true, sensitivity: "base" });
}

// Trie une copie. `cle` renvoie la valeur de tri d'une ligne. Les vides restent à la fin dans les deux sens.
export function trier(items, cle, decroissant = false) {
  if (!cle) return items.slice();
  const vide = (v) => v === null || v === undefined || v === "" || Number.isNaN(v);
  return items
    .map((x, i) => ({ x, i, v: cle(x) }))
    .sort((p, q) => {
      if (vide(p.v) || vide(q.v)) return comparer(p.v, q.v) || p.i - q.i;
      const c = comparer(p.v, q.v);
      return (decroissant ? -c : c) || p.i - q.i;
    })
    .map((e) => e.x);
}

// Affichage progressif : les `pas` premières lignes, puis `pas` de plus à chaque demande.
export function tranche(items, pas, pages = 1) {
  const n = Math.min(items.length, Math.max(1, pas) * Math.max(1, pages));
  return { visibles: items.slice(0, n), reste: items.length - n, total: items.length };
}

// Une valeur de filtre compte comme active quand elle diffère de la valeur neutre (vide, « tous »).
export function filtreActif(valeur, neutre = "") {
  if (valeur === null || valeur === undefined) return false;
  if (Array.isArray(valeur)) return valeur.length > 0;
  return String(valeur) !== String(neutre);
}

// Nombre de filtres actifs dans la feuille « Filtrer » (les puces et la recherche se voient déjà à l'écran, elles ne comptent pas).
export function compterFiltres(definitions, valeurs) {
  return definitions.filter((d) => filtreActif(valeurs[d.cle], d.neutre ?? "")).length;
}

// Filtre texte : tous les mots saisis doivent apparaître, sans tenir compte des accents ni de la casse.
export function correspond(texte, requete) {
  const mots = sansAccents(requete).split(/\s+/).filter(Boolean);
  if (!mots.length) return true;
  const t = sansAccents(texte);
  return mots.every((m) => t.includes(m));
}

// Brouillon d'une fenêtre : les valeurs des champs dans l'ordre, rendues si le nombre de champs est le même.
export function lireBrouillon(brut, nbChamps) {
  try {
    const v = JSON.parse(brut);
    return Array.isArray(v) && v.length === nbChamps ? v : null;
  } catch {
    return null;
  }
}
export const ecrireBrouillon = (valeurs) => JSON.stringify(valeurs);

// Une saisie a changé si une valeur actuelle diffère de la valeur de départ ou si un champ est apparu avec du contenu.
export function aChange(depart, actuel) {
  const n = Math.max(depart.length, actuel.length);
  for (let i = 0; i < n; i++) if ((depart[i] ?? "") !== (actuel[i] ?? "")) return true;
  return false;
}

// Réglages d'un champ de saisie selon son sens : le bon clavier sur téléphone, la bonne saisie automatique.
export const SAISIES = {
  texte: { type: "text", autocomplete: "off", enterkeyhint: "next" },
  nom: { type: "text", autocomplete: "name", autocapitalize: "words", enterkeyhint: "next" },
  tel: { type: "tel", inputmode: "tel", autocomplete: "tel", enterkeyhint: "next" },
  email: { type: "email", inputmode: "email", autocomplete: "email", autocapitalize: "none", autocorrect: "off", spellcheck: "false", enterkeyhint: "next" },
  montant: { type: "text", inputmode: "decimal", autocomplete: "off", enterkeyhint: "done", pattern: "[0-9]*[.,]?[0-9]*" },
  entier: { type: "text", inputmode: "numeric", autocomplete: "off", enterkeyhint: "done", pattern: "[0-9]*" },
  date: { type: "date", autocomplete: "off" },
  recherche: { type: "search", inputmode: "search", autocomplete: "off", autocapitalize: "none", autocorrect: "off", spellcheck: "false", enterkeyhint: "search" },
  adresse: { type: "text", autocomplete: "street-address", autocapitalize: "sentences", enterkeyhint: "next" },
};
