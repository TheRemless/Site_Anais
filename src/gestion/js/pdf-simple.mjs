// Fabrique un fichier PDF sans bibliothèque : une page A4 par image JPEG. Sert à envoyer un devis ou une facture depuis un téléphone,
// où « Imprimer » ne sait pas enregistrer un PDF. Le texte n'est pas sélectionnable (c'est l'image du document), ce qui suffit pour l'envoyer.
export const A4_PT = { largeur: 595.28, hauteur: 841.89 };

const encodeur = new TextEncoder();
const octets = (s) => encodeur.encode(s);

// pages : [{ jpeg: Uint8Array, largeur: px, hauteur: px }]. L'image occupe toute la largeur de la page, alignée en haut.
export function construirePdf(pages, { titre = "" } = {}) {
  if (!pages.length) throw new Error("Aucune page");
  const morceaux = [];
  const decalages = [];
  let longueur = 0;
  const ajouter = (x) => {
    const b = typeof x === "string" ? octets(x) : x;
    morceaux.push(b);
    longueur += b.length;
  };
  const objet = (n, entete, flux = null) => {
    decalages[n] = longueur;
    ajouter(`${n} 0 obj\n${entete}\n`);
    if (flux) {
      ajouter("stream\n");
      ajouter(flux);
      ajouter("\nendstream\n");
    }
    ajouter("endobj\n");
  };
  // Numéros d'objets : 1 catalogue, 2 pages, 3 info, puis pour chaque page : page, contenu, image.
  const nPage = (i) => 4 + i * 3;
  ajouter("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  objet(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objet(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${nPage(i)} 0 R`).join(" ")}] >>`);
  const info = titre ? `<< /Title ${chaineHex(titre)} /Producer (Gestion) >>` : "<< /Producer (Gestion) >>";
  objet(3, info);
  pages.forEach((p, i) => {
    const h = Math.round(((A4_PT.largeur * p.hauteur) / p.largeur) * 100) / 100;
    const y = Math.round((A4_PT.hauteur - h) * 100) / 100;
    const contenu = `q ${A4_PT.largeur} 0 0 ${h} 0 ${y} cm /Im0 Do Q`;
    objet(nPage(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_PT.largeur} ${A4_PT.hauteur}] /Resources << /XObject << /Im0 ${nPage(i) + 2} 0 R >> >> /Contents ${nPage(i) + 1} 0 R >>`);
    objet(nPage(i) + 1, `<< /Length ${octets(contenu).length} >>`, contenu);
    objet(nPage(i) + 2, `<< /Type /XObject /Subtype /Image /Width ${p.largeur} /Height ${p.hauteur} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`, p.jpeg);
  });
  const total = nPage(pages.length - 1) + 3;
  const xref = longueur;
  ajouter(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) ajouter(`${String(decalages[n]).padStart(10, "0")} 00000 n \n`);
  ajouter(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const sortie = new Uint8Array(longueur);
  let pos = 0;
  for (const m of morceaux) (sortie.set(m, pos), (pos += m.length));
  return sortie;
}

// Texte PDF en UTF-16 hexadécimal : accepte les accents sans règle d'échappement.
function chaineHex(s) {
  let hex = "FEFF";
  for (const c of s) {
    const cp = c.codePointAt(0);
    const unites = cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp];
    for (const u of unites) hex += u.toString(16).padStart(4, "0");
  }
  return `<${hex}>`;
}

// Hauteur d'une page A4 en pixels pour une largeur donnée, et découpe d'une hauteur totale en pages.
export const hauteurPage = (largeur) => Math.round((largeur * A4_PT.hauteur) / A4_PT.largeur);
export function decouperPages(hauteurTotale, largeur) {
  const hp = hauteurPage(largeur);
  const reste = hauteurTotale % hp;
  const n = Math.max(1, Math.floor(hauteurTotale / hp) + (reste > Math.round(hp * 0.02) ? 1 : 0));
  return Array.from({ length: n }, (_, i) => ({ debut: i * hp, hauteur: Math.min(hp, hauteurTotale - i * hp) })).filter((p) => p.hauteur > 0);
}
