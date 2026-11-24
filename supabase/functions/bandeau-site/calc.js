// Fonction publique « bandeau-site » : la logique pure (quels bandeaux sont en ligne, forme JSON lue par le site, choix d'un seul bandeau par page).
// Aucune dépendance : le même fichier sert à la fonction Supabase et aux tests. Contrat avec le site : docs/gestion/bandeau-site.md.
// `choisirBandeau` est la règle de référence que le site recopie (une page n'affiche qu'un bandeau).

export const VERSION = 1;
const ORDRE_TYPE = { urgent: 0, sea: 1, season: 2, new: 3, info: 4 };

// En ligne : allumé, commencé, pas encore fini.
export const enLigne = (b, maintenant) => b.actif !== false && Date.parse(b.debut) <= maintenant && (!b.fin || Date.parse(b.fin) > maintenant);

// Message WhatsApp prérempli : le texte tel quel jusqu'à 140 caractères sur une ligne (comme avant) ; un texte long donne sa première
// ligne, coupée à 140 caractères sur un mot avec « … », pour que le visiteur n'envoie pas 600 caractères qu'il n'a pas écrits.
export function resumeWhatsApp(texte) {
  const t = String(texte || "");
  const n = (x) => Array.from(x).length;
  if (n(t) <= 140 && !/\n/.test(t)) return t;
  const ligne = t.split("\n")[0].trim();
  if (n(ligne) <= 140) return ligne === t ? ligne : `${ligne.replace(/[.:;,]$/, "")}…`;
  const coupe = Array.from(ligne).slice(0, 139).join("");
  return `${coupe.slice(0, Math.max(coupe.lastIndexOf(" "), 80)).replace(/[\s.:;,]+$/, "")}…`;
}

// Ce que le site reçoit d'un bandeau : jamais l'entreprise, l'auteur ni les valeurs internes.
export function bandeauPublic(b) {
  const v = b.valeurs || {};
  const lien =
    b.lien === "page" && b.lien_page
      ? { kind: "page", href: b.lien_page, label: v.lien_libelle || "See the page" }
      : b.lien === "whatsapp"
        ? { kind: "whatsapp", label: "Ask on WhatsApp", text: `Hi, I have a question about this: ${resumeWhatsApp(b.texte)}` }
        : null;
  const cible = b.cible === "sections" ? { kind: "sections", sections: b.sections || [] } : b.cible === "produits" ? { kind: "products", products: b.produits || [] } : { kind: "all" };
  return {
    id: b.id,
    brands: [...(b.marques || [])].sort(),
    type: b.type,
    text: b.texte,
    link: lien,
    target: cible,
    closable: b.fermable !== false,
    priority: b.priorite || 2,
    starts_at: new Date(b.debut).toISOString(),
    ends_at: b.fin ? new Date(b.fin).toISOString() : null,
    // Étiquette courte sur la carte des sorties visées (mer, saison) : seulement pour un bandeau qui vise des produits.
    card_label: b.cible === "produits" && (b.type === "sea" || b.type === "season") && v.etiquette ? String(v.etiquette).slice(0, 24) : null,
  };
}

const trier = (a, b) => a.priority - b.priority || ORDRE_TYPE[a.type] - ORDRE_TYPE[b.type] || Date.parse(b.starts_at) - Date.parse(a.starts_at) || (a.id < b.id ? -1 : 1);

// Réponse complète de la fonction : les bandeaux en ligne, déjà triés du plus important au moins important.
export function reponsePublique(lignes, maintenant = Date.now()) {
  const banners = lignes.filter((b) => enLigne(b, maintenant)).map(bandeauPublic).sort(trier);
  return { version: VERSION, generated_at: new Date(maintenant).toISOString(), banners };
}

// Le bandeau d'une page : la marque de la page (« secret » ou « taxi » pour /taxi/), sa section et son produit (slug) s'il y en a un.
// `fermes` : les identifiants que le visiteur a fermés (seulement pour un bandeau « closable »). Un seul bandeau, ou null.
export function choisirBandeau(banners, { brand, section = null, product = null, fermes = [] }, maintenant = Date.now()) {
  const vise = (b) => b.target.kind === "all" || (b.target.kind === "sections" && section && b.target.sections.includes(section)) || (b.target.kind === "products" && product && b.target.products.includes(product));
  const visible = banners
    .filter((b) => b.brands.includes(brand) && vise(b))
    .filter((b) => Date.parse(b.starts_at) <= maintenant && (!b.ends_at || Date.parse(b.ends_at) > maintenant))
    .filter((b) => !(b.closable && fermes.includes(b.id)))
    .sort(trier);
  return visible[0] || null;
}
