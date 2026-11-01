// Articles du blog : ancres sur les intertitres, sommaire et tableaux lisibles sur mobile.
// - chaque <h2> du texte (.prose) reçoit un id stable tiré de son titre ;
// - un sommaire est inséré à gauche du texte (bureau, collant) et sous le chapeau (mobile, repliable) ;
// - chaque cellule de tableau reçoit l'en-tête de sa colonne (data-label) pour l'affichage empilé.
// Ne touche qu'aux pages qui contiennent un article (<div class="prose"> suivi de la colonne de texte).

const LABELS = {
  fr: { toc: "Sommaire" },
  en: { toc: "In this article" },
};

function slugify(text) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "section";
}

const strip = (h) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

function labelTables(segment) {
  return segment.replace(/<table([^>]*)>([\s\S]*?)<\/table>/g, (all, attrs, inner) => {
    const head = inner.match(/<thead>([\s\S]*?)<\/thead>/);
    if (!head) return all;
    const labels = [...head[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => strip(m[1]).replace(/"/g, "&quot;"));
    const body = inner.replace(/<tbody>([\s\S]*?)<\/tbody>/, (b, rows) =>
      "<tbody>" + rows.replace(/<tr([^>]*)>([\s\S]*?)<\/tr>/g, (r, ra, cells) => {
        let i = 0;
        return `<tr${ra}>` + cells.replace(/<td(?![^>]*data-label)([^>]*)>/g, (c, ca) => `<td data-label="${labels[i++] || ""}"${ca}>`) + "</tr>";
      }) + "</tbody>");
    return `<table${attrs}>${body}</table>`;
  });
}

module.exports = function articleEnhance(html, lang) {
  const open = html.match(/<div class="section-pad">\s*<div class="container">\s*<div class="prose">/);
  if (!open) return html;
  const start = open.index;
  const proseStart = start + open[0].length;
  const end = html.indexOf("<section", proseStart);
  if (end < 0) return html;
  const L = LABELS[lang] || LABELS.fr;

  let segment = html.slice(proseStart, end);
  const used = new Set();
  const toc = [];
  segment = segment.replace(/<h2(?![^>]*\sid=)([^>]*)>([\s\S]*?)<\/h2>/g, (m, attrs, inner) => {
    let id = slugify(inner), n = 2;
    while (used.has(id)) id = `${slugify(inner)}-${n++}`;
    used.add(id);
    toc.push({ id, text: strip(inner) });
    return `<h2 id="${id}"${attrs}>${inner}</h2>`;
  });
  segment = labelTables(segment);
  if (!toc.length) return html.slice(0, proseStart) + segment + html.slice(end);

  const list = `<ol>${toc.map((t) => `<li><a href="#${t.id}">${t.text}</a></li>`).join("")}</ol>`;
  const aside = `<nav class="art-toc" aria-label="${L.toc}"><p class="art-toc-title">${L.toc}</p>${list}</nav>`;
  const mobile = `<div class="container art-toc-wrap"><details class="art-toc-m"><summary>${L.toc}</summary>${list}</details></div>\n`;

  let out = html.slice(0, start)
    + `<div class="section-pad art-body">\n  <div class="container art-layout">\n    ${aside}\n    <div class="prose">`
    + segment + html.slice(end);
  // sommaire mobile : sous le chapeau, avant la photo de couverture
  // (avant la couverture si elle existe, sinon à la fin de l'en-tête de l'article)
  const coverAt = out.search(/<div class="container">\s*<div class="article-cover/);
  const headerEnd = out.indexOf("</header>", out.indexOf('class="article-hero'));
  const at = coverAt > 0 ? coverAt : headerEnd;
  if (at > 0) out = out.slice(0, at) + mobile + out.slice(at);
  return out;
};
