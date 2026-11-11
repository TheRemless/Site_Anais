// Calculs purs des composants mobiles (tri, filtres, pagination, clavier, brouillon). Aucun accès au navigateur : les tests Node les couvrent.

// Hauteur du clavier visible : ce que le viewport visuel a perdu par rapport à la fenêtre. Un zoom par pincement
// réduit aussi le viewport visuel : il ne compte pas comme un clavier. Sous 120 px (barre d'adresse qui bouge), rien.
export function hauteurClavier(innerHeight, vv) {
  if (!vv || (vv.scale || 1) > 1.01) return 0;
  const perdu = Math.round(innerHeight - vv.height - (vv.offsetTop || 0));
  return perdu > 120 ? perdu : 0;
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
