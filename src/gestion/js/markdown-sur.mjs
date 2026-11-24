// Le gras Markdown des réponses de l'Assistant (« **Koh Lanta → Bangkok** »), rendu sans HTML (24.11.2026) : le texte est découpé en morceaux
// { texte, gras } que l'écran pose en nœuds de texte, dans un <strong> pour le gras. Rien n'est jamais interprété comme du HTML : « <b> » ou
// « <script> » restent du texte. Seule une paire d'astérisques doubles sur la même ligne, avec du texte collé à l'intérieur, fait du gras ;
// un « ** » seul reste tel quel.
const GRAS = /\*\*(?=\S)([^*\n]*?\S)\*\*/g;
export function morceauxGras(texte = "") {
  const t = String(texte ?? "");
  const out = [];
  let i = 0;
  for (const m of t.matchAll(GRAS)) {
    if (m.index > i) out.push({ texte: t.slice(i, m.index), gras: false });
    out.push({ texte: m[1], gras: true });
    i = m.index + m[0].length;
  }
  if (i < t.length) out.push({ texte: t.slice(i), gras: false });
  return out;
}
