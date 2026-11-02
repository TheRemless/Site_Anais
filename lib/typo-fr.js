// Typographie française : espace fine insécable (U+202F) avant « ; ! ? : » et à l'intérieur
// des guillemets « ». Ne touche qu'au texte visible du <body> des pages en français :
// ni le <head> (titre, méta), ni les attributs, ni <script>, <style>, <pre>, <code>, <textarea>.
const NNBSP = " ";
const SKIP = /^<(script|style|pre|code|textarea)\b/i;

function fixText(t) {
  return t
    // guillemets écrits en entités : ramenés aux caractères pour être traités comme les autres
    .replace(/&laquo;|&#171;|&#xab;/gi, "«").replace(/&raquo;|&#187;|&#xbb;/gi, "»")
    // espaces insécables déjà écrites en entités : remplacées par l'espace fine
    .replace(/(?:&nbsp;|&#160;|&#x0*a0;|&#8239;|&#x202f;)+(?=[;:!?»])/gi, NNBSP)
    .replace(/«(?:&nbsp;|&#160;|&#x0*a0;|&#8239;|&#x202f;)+/gi, "«")
    // « ; ! ? » collés ou précédés d'une espace (sauf entité HTML comme &amp;)
    .replace(/(?<!&#?[a-zA-Z0-9]{1,10})[ \u00A0\u202F]*([;!?])(?=[\s<»"')\].,;:!?]|$)/g, NNBSP + "$1")
    // « : » suivi d'une espace ou de la fin (pas 10:30, pas https://)
    .replace(/[ \u00A0\u202F]*:(?=\s|$)/g, NNBSP + ":")
    // Guillemets français
    .replace(/«[ \u00A0\u202F]*/g, "«" + NNBSP)
    .replace(/[ \u00A0\u202F]*»/g, NNBSP + "»");
}

module.exports = function typoFr(html) {
  const bodyStart = html.search(/<body[\s>]/i);
  if (bodyStart < 0) return html;
  const head = html.slice(0, bodyStart), body = html.slice(bodyStart);
  const parts = body.split(/(<[^>]*>)/);
  let skip = null;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i % 2 === 1) { // balise
      if (skip) { if (new RegExp("^</" + skip + "\\b", "i").test(p)) skip = null; continue; }
      const m = p.match(SKIP); if (m && !/\/>$/.test(p)) skip = m[1];
      continue;
    }
    if (skip || !p.trim()) continue;
    parts[i] = fixText(p);
  }
  return head + parts.join("");
};
