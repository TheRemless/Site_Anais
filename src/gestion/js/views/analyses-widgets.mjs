// Composants des statistiques : tuile avec variation, graphique en colonnes lisible au doigt, classement en barres,
// tableau triable avec recherche et total, squelettes de chargement. Aucune règle de calcul ici (voir stats-calc.mjs).
import { h, vider, modal } from "../ui.mjs";
import { formatMontant, formatNombre } from "../calc.mjs";
import { tr } from "../i18n.mjs";

const NS = "http://www.w3.org/2000/svg";
export const s = (tag, attrs = {}, ...enfants) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...enfants.flat().filter((x) => x !== null && x !== undefined));
  return el;
};

// Petits pictogrammes en traits : variation, information, tri.
const PICTOS = {
  haut: ["M12 19V5", "m5 12 7-7 7 7"],
  bas: ["M12 5v14", "m19 12-7 7-7-7"],
  egal: ["M5 12h14"],
  nouveau: ["M12 3v4", "M12 17v4", "M3 12h4", "M17 12h4"],
  info: ["M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18", "M12 16v-4", "M12 8h.01"],
  tri: ["m7 15 5 5 5-5", "m7 9 5-5 5 5"],
};
export function picto(nom, taille = 16) {
  return s("svg", { viewBox: "0 0 24 24", width: String(taille), height: String(taille), fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" }, PICTOS[nom].map((d) => s("path", { d })));
}

// 12 400 → « 12,4 k » : pour les étiquettes serrées d'un graphique. Le tableau et les tuiles gardent les chiffres entiers.
export function compact(n) {
  const v = Math.abs(n);
  const signe = n < 0 ? "-" : "";
  if (v >= 1e6) return `${signe}${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(".0", "")}M`;
  if (v >= 1e4) return `${signe}${Math.round(v / 1e3)}k`;
  if (v >= 1e3) return `${signe}${(v / 1e3).toFixed(1).replace(".0", "")}k`;
  return `${signe}${Math.round(v)}`;
}

// Écart face à la période de comparaison : flèche et texte, jamais la couleur seule.
export function ecartTexte(ecart, precedent, devise, { monnaie = true, unite = "", inverse = false } = {}) {
  if (!ecart) return null;
  const nom = ecart.delta > 0 ? "haut" : ecart.delta < 0 ? "bas" : "egal";
  const bon = ecart.sens === "hausse" || ecart.sens === "nouveau" ? !inverse : ecart.sens === "baisse" ? inverse : null;
  const classe = bon === null ? "neutre" : bon ? "plus" : "moins";
  const arrondi1 = Math.round(ecart.delta * 10) / 10;
  const texte = unite ? (arrondi1 === 0 ? tr("stable") : `${arrondi1 > 0 ? "+" : ""}${String(arrondi1).replace(".", tr(","))} ${tr(unite)}`) : ecart.pct === null ? (ecart.sens === "nouveau" ? tr("nouveau") : tr("stable")) : `${ecart.pct > 0 ? "+" : ""}${ecart.pct} %`;
  const avant = precedent !== null && precedent !== undefined ? tr("avant {valeur}", { valeur: monnaie ? formatMontant(precedent, devise) : String(precedent) }) : "";
  return h("span", { class: `st-ecart ${classe}` }, picto(nom, 14), h("span", null, texte), avant ? h("span", { class: "st-ecart-avant" }, avant) : null);
}

function minigraphe(valeurs) {
  if (!valeurs || valeurs.length < 2) return null;
  const W = 120, H = 30, p = 3;
  const max = Math.max(...valeurs, 0);
  const min = Math.min(...valeurs, 0);
  const etendue = max - min || 1;
  const x = (i) => p + (i * (W - 2 * p)) / (valeurs.length - 1);
  const y = (v) => H - p - ((v - min) / etendue) * (H - 2 * p);
  const points = valeurs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  return s("svg", { class: "st-mini", viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", focusable: "false", preserveAspectRatio: "none" }, s("polyline", { points: points.join(" "), class: "st-mini-ligne" }), s("circle", { cx: x(valeurs.length - 1).toFixed(1), cy: y(valeurs[valeurs.length - 1]).toFixed(1), r: "2.6", class: "st-mini-point" }));
}

// Tuile cliquable : valeur, variation, mini graphique. `aide` = [titre, texte] ouvre « Comment c'est calculé ».
export function tuile({ libelle, valeur, detail, ecart, precedent, devise, monnaie = true, ecartUnite = "", ecartInverse = false, serie, href, aide, grande = false }) {
  const corps = [h("span", { class: "st-tuile-libelle" }, libelle), h("strong", { class: "st-tuile-valeur" }, valeur), ecart ? ecartTexte(ecart, precedent, devise, { monnaie, unite: ecartUnite, inverse: ecartInverse }) : null, detail ? h("span", { class: "st-tuile-detail" }, detail) : null, minigraphe(serie)];
  return h(
    "div",
    { class: `st-tuile${grande ? " grande" : ""}` },
    href ? h("a", { class: "st-tuile-lien", href }, corps) : h("div", { class: "st-tuile-lien" }, corps),
    aide ? h("button", { class: "st-info bouton-icone", type: "button", "aria-label": tr("Comment c'est calculé : {nom}", { nom: libelle }), title: tr("Comment c'est calculé"), onclick: () => ouvrirAide(aide) }, picto("info", 18)) : null
  );
}

export function ouvrirAide([titre, texte], lien) {
  modal(tr(titre), h("div", { class: "modal-corps" }, h("p", null, tr(texte)), lien ? h("p", null, h("a", { class: "bouton secondaire", href: lien }, tr("Voir la liste"))) : null), { feuille: true });
}

// Bloc « Comment c'est calculé » en fin de section.
export function blocDefinitions(ids, DEFINITIONS) {
  return h("details", { class: "st-defs" }, h("summary", null, tr("Comment c'est calculé")), h("dl", null, ids.filter((i) => DEFINITIONS[i]).flatMap((i) => [h("dt", null, tr(DEFINITIONS[i][0])), h("dd", null, tr(DEFINITIONS[i][1]))])));
}

// ---- Graphique en colonnes ----------------------------------------------------------------------------------------
function chemin(x, y, w, hh, r) {
  if (hh <= 0) return "";
  const rr = Math.min(r, hh, w / 2);
  return `M${x},${y + hh} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + hh} Z`;
}
// Un pas d'axe « rond » (1, 2, 2,5, 5 fois une puissance de dix) qui donne environ quatre intervalles.
function pasRond(x) {
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}

// cases : [{ cle, libelle }] ; series : [{ nom, valeurs: [], classe: "s1"|"s2"|"ref" }].
// lecture(i) → nœud affiché sous le graphique pour la colonne choisie ; lien(i) → adresse de la liste derrière la colonne.
export function graphiqueColonnes({ cases, series, devise, titre, lecture, lien, etiquettes = true, hauteur = 230 }) {
  const n = cases.length;
  const enveloppe = h("div", { class: "st-graphe" });
  const defile = h("div", { class: "st-graphe-defile", role: "group", "aria-label": titre });
  const lectureEl = h("div", { class: "st-lecture", "aria-live": "polite" });
  // L'axe des montants reste fixe à gauche pendant que les colonnes défilent.
  const axe = h("div", { class: "st-graphe-axe", "aria-hidden": "true" });
  enveloppe.append(h("div", { class: "st-graphe-corps" }, axe, defile), lectureEl);
  let choisi = -1;

  const lire = (i) => {
    choisi = i;
    vider(lectureEl);
    if (i < 0) return lectureEl.append(h("p", { class: "aide" }, tr("Touchez une colonne pour lire ses chiffres et ouvrir la liste.")));
    lectureEl.append(lecture(i), lien && lien(i) ? h("a", { class: "bouton secondaire petit", href: lien(i) }, tr("Voir la liste")) : null);
  };

  const dessiner = () => {
    const gauche = 6, haut = 24, bas = 30, droite = 8, largeurAxe = 46;
    const pas = Math.max(series.length > 1 ? 56 : 44, 0);
    const disponible = Math.max((enveloppe.clientWidth || 340) - largeurAxe, 240);
    const W = Math.max(disponible, gauche + droite + n * pas);
    const H = hauteur;
    const hh = H - haut - bas;
    const valeurs = series.flatMap((x) => x.valeurs);
    const maxV = Math.max(0, ...valeurs);
    const minV = Math.min(0, ...valeurs);
    const pasAxe = pasRond((maxV - minV) / 4 || 1);
    const plafond = Math.ceil(maxV / pasAxe) * pasAxe || pasAxe;
    const plancher = Math.floor(minV / pasAxe) * pasAxe;
    const etendue = plafond - plancher || 1;
    const graduations = [];
    for (let v = plancher; v <= plafond + pasAxe / 2; v += pasAxe) graduations.push(v);
    const y = (v) => haut + hh - ((v - plancher) / etendue) * hh;
    const ligneZero = y(0);
    const largeurCase = (W - gauche - droite) / n;
    const bw = Math.max(6, Math.min(30, (largeurCase - 12) / series.length - 2));
    const svg = s("svg", { class: "st-svg", viewBox: `0 0 ${W} ${H}`, width: String(W), height: String(H), role: "group", "aria-label": titre });
    const svgAxe = s("svg", { class: "st-svg", viewBox: `0 0 ${largeurAxe} ${H}`, width: String(largeurAxe), height: String(H), "aria-hidden": "true" });
    for (const v of graduations) {
      svg.append(s("line", { x1: 0, x2: W - droite, y1: y(v), y2: y(v), class: "st-grille" }));
      svgAxe.append(s("text", { x: largeurAxe - 8, y: y(v) + 4, class: "st-axe", "text-anchor": "end" }, compact(v)));
    }
    vider(axe).append(svgAxe);
    const sautEtiquette = largeurCase < 40 ? Math.ceil(40 / largeurCase) : 1;
    cases.forEach((c, i) => {
      const x0 = gauche + i * largeurCase;
      const centre = x0 + largeurCase / 2;
      const total = series.length * bw + (series.length - 1) * 2;
      const fond = s("rect", { x: x0 + 1, y: haut - 4, width: largeurCase - 2, height: hh + 8, class: `st-fond${i === choisi ? " actif" : ""}`, rx: "6" });
      const groupe = s("g", { class: "st-colonne", tabindex: "0", role: "button", "aria-pressed": i === choisi ? "true" : "false", "aria-label": `${c.libelle} : ${series.map((x) => `${tr(x.nom)} ${formatNombre(x.valeurs[i])}`).join(", ")}` }, fond);
      series.forEach((x, k) => {
        const v = x.valeurs[i];
        const bx = centre - total / 2 + k * (bw + 2);
        const top = v >= 0 ? y(v) : ligneZero;
        const hauteurBarre = Math.abs(y(v) - ligneZero);
        groupe.append(s("path", { d: chemin(bx, top, bw, hauteurBarre, 4), class: `st-barre ${x.classe}` }));
        if (etiquettes && v !== 0 && x.classe !== "ref" && bw >= 20) groupe.append(s("text", { x: bx + bw / 2, y: Math.max(11, top - 5), class: "st-valeur", "text-anchor": "middle" }, compact(v)));
      });
      if (i % sautEtiquette === 0) groupe.append(s("text", { x: centre, y: H - 10, class: "st-axe", "text-anchor": "middle" }, c.court || c.libelle));
      // Zone de toucher : toute la colonne, bien plus large que la barre.
      groupe.append(s("rect", { x: x0, y: 0, width: largeurCase, height: H, class: "st-zone" }));
      const choisir = () => {
        if (choisi === i && lien && lien(i)) {
          location.hash = lien(i);
          return;
        }
        lire(i);
        dessiner();
        const g = svg.parentNode && svg.parentNode.querySelectorAll(".st-colonne")[i];
        if (g) g.focus({ preventScroll: true });
      };
      groupe.addEventListener("click", choisir);
      groupe.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") (e.preventDefault(), choisir());
      });
      svg.append(groupe);
    });
    if (minV < 0) svg.append(s("line", { x1: 0, x2: W - droite, y1: ligneZero, y2: ligneZero, class: "st-zero" }));
    vider(defile).append(svg);
    svg.style.width = `${W}px`;
    defile.classList.toggle("deborde", W > disponible + 1);
  };
  // Les graphiques se dessinent quand le conteneur a une largeur : au montage, puis quand la fenêtre change de taille.
  let largeur = 0;
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    if (enveloppe.clientWidth && enveloppe.clientWidth !== largeur) ((largeur = enveloppe.clientWidth), dessiner());
  }) : null;
  requestAnimationFrame(() => {
    if (!enveloppe.isConnected) return;
    largeur = enveloppe.clientWidth;
    dessiner();
    if (observer) observer.observe(enveloppe);
  });
  lire(-1);
  // Le plus récent à droite : on fait défiler jusqu'à lui.
  requestAnimationFrame(() => requestAnimationFrame(() => (defile.scrollLeft = defile.scrollWidth)));
  return enveloppe;
}

// Légende : un échantillon, jamais la couleur seule (le nom suit).
export function legende(series) {
  return h("ul", { class: "st-legende" }, series.map((x) => h("li", null, h("i", { class: `st-echantillon ${x.classe}`, "aria-hidden": "true" }), tr(x.nom))));
}

// ---- Classement en barres horizontales -------------------------------------------------------------------------------
// lignes : [{ libelle, valeur, texte, detail, href }] déjà triées. Les plus petites sont repliées derrière « Voir les N autres ».
export function classement({ lignes, max = 7, total, vide }) {
  if (!lignes.length) return h("p", { class: "vide-court" }, vide || tr("Aucune donnée sur la période."));
  const plus = Math.max(1, ...lignes.map((l) => Math.abs(l.valeur)));
  const ligne = (l) => {
    const contenu = [h("span", { class: "st-rang-nom" }, l.libelle), h("span", { class: "st-rang-valeur" }, l.texte), h("span", { class: "st-rang-piste", "aria-hidden": "true" }, h("span", { class: `st-rang-barre${l.valeur < 0 ? " negatif" : ""}`, style: `width:${Math.max(2, (Math.abs(l.valeur) / plus) * 100)}%` })), l.detail ? h("span", { class: "st-rang-detail" }, l.detail) : null];
    return h("li", null, l.href ? h("a", { class: "st-rang-ligne", href: l.href }, contenu) : h("div", { class: "st-rang-ligne" }, contenu));
  };
  const visibles = lignes.slice(0, max);
  const autres = lignes.slice(max);
  const sommeAutres = autres.reduce((t, l) => t + l.valeur, 0);
  return h(
    "div",
    { class: "st-rang" },
    h("ol", null, visibles.map(ligne)),
    autres.length ? h("details", { class: "st-autres" }, h("summary", null, tr("Voir les {n} autres", { n: autres.length }), total ? h("span", { class: "st-autres-somme" }, total(sommeAutres)) : null), h("ol", null, autres.map(ligne))) : null,
    total ? h("p", { class: "st-rang-total" }, h("span", null, tr("Total")), h("strong", null, total(lignes.reduce((t, l) => t + l.valeur, 0)))) : null
  );
}

// ---- Tableau triable, filtrable, avec total ------------------------------------------------------------------------------
// colonnes : [{ cle, titre, num?, valeur(ligne) pour trier, rendu(ligne) → texte ou nœud, somme?(lignes) → texte pour le pied }]
// etatInitial : { tri, sens, q } ; onEtat(etat) est appelé à chaque changement (pour garder l'adresse à jour).
export function tableauTrie({ colonnes, lignes, etatInitial = {}, onEtat, recherche, pied, ligneHref, vide, classe = "" }) {
  const et = { tri: etatInitial.tri && colonnes.some((c) => c.cle === etatInitial.tri) ? etatInitial.tri : null, sens: etatInitial.sens === "asc" ? "asc" : "desc", q: etatInitial.q || "" };
  const racine = h("div", { class: "st-tableau" });
  const zone = h("div", { class: "st-tableau-zone" });
  const sansAccents = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const signale = () => onEtat && onEtat({ ...et });

  // Le champ de recherche et le menu de tri sont créés une fois : seule la zone du tableau est redessinée à chaque frappe ou changement de tri.
  const selTri = h("select", { onchange: (e) => { const [cle, sens] = e.target.value.split(":"); et.tri = cle || null; if (sens) et.sens = sens; signale(); rendre(); } }, h("option", { value: "" }, tr("Ordre d'origine")), colonnes.flatMap((c) => [h("option", { value: `${c.cle}:desc` }, `${tr(c.titre)} ↓`), h("option", { value: `${c.cle}:asc` }, `${tr(c.titre)} ↑`)]));
  const barre = h("div", { class: "st-tableau-outils" }, recherche ? h("input", { type: "search", class: "st-recherche", placeholder: tr("Rechercher dans la liste"), "aria-label": tr("Rechercher dans la liste"), value: et.q, oninput: (e) => { et.q = e.target.value; signale(); rendre(); } }) : null, h("label", { class: "st-tri-mobile seulement-mobile" }, h("span", null, tr("Trier par")), selTri));
  racine.append(barre, zone);

  function rendre() {
    vider(zone);
    selTri.value = et.tri ? `${et.tri}:${et.sens}` : "";
    const q = sansAccents(et.q).trim();
    let vues = lignes;
    if (q && recherche) vues = lignes.filter((l) => sansAccents(recherche(l)).includes(q));
    const col = colonnes.find((c) => c.cle === et.tri);
    if (col) {
      const f = col.valeur || ((l) => l[col.cle]);
      const dir = et.sens === "asc" ? 1 : -1;
      vues = [...vues].sort((a, b) => {
        const x = f(a), y = f(b);
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""))) * dir;
      });
    }
    if (!vues.length) return zone.append(h("p", { class: "vide-court" }, vide || tr("Aucune ligne.")));
    const changer = (cle) => {
      if (et.tri === cle) et.sens = et.sens === "desc" ? "asc" : "desc";
      else ((et.tri = cle), (et.sens = colonnes.find((c) => c.cle === cle).num ? "desc" : "asc"));
      signale();
      rendre();
    };
    const entete = h("tr", null, colonnes.map((c) => h("th", { scope: "col", class: c.num ? "num" : "", "aria-sort": et.tri === c.cle ? (et.sens === "asc" ? "ascending" : "descending") : "none" }, h("button", { class: "st-tri lien", type: "button", onclick: () => changer(c.cle) }, tr(c.titre), picto("tri", 12)))));
    const corps = vues.map((l) => {
      const href = ligneHref && ligneHref(l);
      return h("tr", { class: href ? "st-ligne-lien" : "" }, colonnes.map((c, i) => {
        const r = c.rendu ? c.rendu(l) : l[c.cle];
        const lienCol = c.lien && c.lien(l);
        const cible = lienCol || (i === 0 && href);
        return h("td", { class: c.num ? "num" : "", "data-label": tr(c.titre) }, cible ? h("a", { href: cible }, r) : r);
      }));
    });
    const bas = pied ? h("tfoot", null, h("tr", { class: "st-pied" }, colonnes.map((c, i) => h("td", { class: c.num ? "num" : "", "data-label": tr(c.titre) }, i === 0 ? tr("Total ({n})", { n: vues.length }) : c.somme ? c.somme(vues) : "")))) : null;
    zone.append(h("div", { class: "tableau-defilant" }, h("table", { class: `tableau simple st-table ${classe}` }, h("thead", null, entete), h("tbody", null, corps), bas)));
  }
  rendre();
  return racine;
}

// Squelette : mêmes dimensions que le contenu, pour que rien ne saute à l'arrivée des chiffres.
export function squelette({ tuiles = 8, graphique = true }) {
  return h("div", { class: "st-squelette", "aria-busy": "true", "aria-label": tr("Calcul en cours…") }, h("div", { class: "st-tuiles" }, Array.from({ length: tuiles }, () => h("div", { class: "st-tuile st-sq" }))), graphique ? h("div", { class: "st-sq st-sq-graphe" }) : null);
}

