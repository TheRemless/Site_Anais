// Les âges des enfants d'une demande du carnet, en un seul endroit : la lecture de la ligne « Guests: » (ou « Personnes : » du récapitulatif de la page) du message et la règle « un enfant plus âgé que
// le barème de sa sortie paie le tarif adulte du partenaire ». Module léger (il n'importe que carnet-produits.mjs) : demande-calc.mjs (fenêtre de création) et
// demandes-site-calc.mjs (liste, changements, réponse de confirmation) l'utilisent sans s'importer l'un l'autre. Il n'importe que des modules de données (carnet-produits.mjs, site-produits.mjs).

import { PRODUITS_CARNET } from "./carnet-produits.mjs";
import { PRODUITS_SITE } from "./site-produits.mjs";

// La règle commune des invités, pour toutes les langues : les âges dits font les enfants (3 ans et plus) et les bébés (moins de 3 ans) ; sans âge, on garde le nombre d'enfants dit.
function invitesDe(adultes, nombre, ages) {
  const enfants = ages.length ? ages.filter((a) => a >= 3).length : nombre;
  return { adultes, enfants, bebes: ages.filter((a) => a < 3).length, ages };
}

// « 2 adults, 1 child (age 7) », « 2 adults, 3 children (ages under 1, 3 and 10) » : adultes, enfants (3 ans et plus), bébés (moins de 3 ans) et âges.
export function lireInvites(v) {
  const adultes = Number((/(\d+)\s+adults?/i.exec(v) || [])[1] || 0);
  const m = /(\d+)\s+child(?:ren)?(?:\s*\(ages?\s*([^)]*)\))?/i.exec(v);
  const ages = m && m[2] ? m[2].split(/,|\band\b/).map((x) => x.trim()).filter(Boolean).map((x) => (/under\s*1/i.test(x) ? 0 : parseInt(x, 10))).filter((n) => Number.isFinite(n)) : [];
  return invitesDe(adultes, m ? Number(m[1]) : 0, ages);
}

// « 2 adultes, 2 enfants (5 ans, moins d'1 an) » : la ligne « Personnes : » du récapitulatif que la page du carnet envoie comme message (elle l'écrit en français).
export function lireInvitesFrancais(v) {
  const adultes = Number((/(\d+)\s+adultes?/i.exec(v) || [])[1] || 0);
  const m = /(\d+)\s+enfants?(?:\s*\(([^)]*)\))?/i.exec(v);
  const ages = m && m[2] ? m[2].split(",").map((x) => x.trim()).filter(Boolean).map((x) => (/moins\s+d.?\s*1/i.test(x) ? 0 : parseInt(x, 10))).filter((n) => Number.isFinite(n)) : [];
  return invitesDe(adultes, m ? Number(m[1]) : 0, ages);
}

// Les invités dits par le message (ligne « Guests: » du contrat, ou « Personnes : » du récapitulatif de la page), ou null. C'est la seule source du nombre d'adultes, d'enfants et
// de bébés d'une demande du carnet : le compteur de la table compte tous les enfants, bébés compris.
export function agesDuMessage(message) {
  const m = /^Guests:\s*(.+)$/im.exec(message || "");
  if (m) return lireInvites(m[1]);
  const f = /^Personnes\s*:\s*(.+)$/im.exec(message || "");
  return f ? lireInvitesFrancais(f[1]) : null;
}

// La sortie d'un identifiant : une seule recherche, une seule priorité. Les sorties propres au carnet (carnet-produits.mjs : Ao Nang, Koh Samui) d'abord, puis celles du site
// Secret (site-produits.mjs : le guide de Koh Lanta envoie « 4-islands », « koh-rok-koh-haa »…). Un identifiant du carnet ne doit jamais être aussi un identifiant du site
// (un test le garde). Jamais par le nom.
export const sortieParId = (id) => PRODUITS_CARNET.find((p) => p.id === id) || PRODUITS_SITE.find((p) => p.id === id) || null;

// Un texte comparé sans accents ni casse (« Join-in longtail » = « join in longtail », « & » = « and ») : la seule définition (demande-calc.mjs l'importe).
export const cleTexte = (s) => String(s === null || s === undefined ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
// Les extras d'une ligne « Extras: » du message : un extra par élément séparé par « , », « ; » ou « | », avec le séparateur qui le précède (rendu tel quel quand on en retire). Le « per boat »
// que la refonte du site écrit après « Add Koh Kradan » est une précision de l'extra qui le précède, pas un extra. Un élément est comparé ENTIER (cleTexte), jamais par morceau.
export function extrasEnElements(texte) {
  const morceaux = String(texte || "").split(/(\s*[,;|]\s*)/);
  const elements = [];
  for (let i = 0; i < morceaux.length; i += 2) {
    const t = morceaux[i].trim();
    if (!t) continue;
    if (/^per (boat|van|person)$/i.test(t) && elements.length) elements[elements.length - 1].precisions.push({ texte: t, sep: morceaux[i - 1] || ", " });
    else elements.push({ texte: t, sep: i ? morceaux[i - 1] : "", precisions: [] });
  }
  return elements;
}
// L'identifiant de la prestation d'un tarif du carnet, d'après sa clé (« sortie|option|ligne »), ou null : celui qui est écrit dans PRODUITS_CARNET (md5 de la clé).
export const idTarifCarnet = (cle) => { for (const p of PRODUITS_CARNET) for (const o of p.options) for (const t of o.tarifs) if (t.cle === cle) return t.prestation; return null; };
// Cette prestation de la base est-elle la ligne de cet extra (EXTRAS_DU_SITE) ? Par la clé écrite sur la ligne (details.cle_carnet) ou par l'identifiant du tarif du carnet.
export const estLExtra = (p, x) => !!p && ((p.details && p.details.cle_carnet === x.cle) || (!!idTarifCarnet(x.cle) && p.id === idTarifCarnet(x.cle)));
// Une ligne de prix « enfant » du site (« Child, 4 to 11 », « Child rider ») : la seule définition (demande-calc.mjs l'importe).
export const LIGNE_ENFANT = /^child\b/i;

// La sortie qu'une demande du carnet cite (`d.carnet.produit`), ou null : sortie inconnue, ou d'une autre marque que Secret.
export function resoudreProduit(d) {
  const c = d && d.carnet;
  const produit = c && c.produit ? sortieParId(c.produit) : null;
  return produit && produit.marque === "secret" ? produit : null;
}

// Les noms qu'une option se donne, normalisés (cleTexte) : son identifiant, son titre et les noms que la page du carnet lui donne (`alias`, en français pour le guide de Koh Samui).
// La seule liste de noms : le tarif, l'âge, « Modifier » et la réponse la comparent à un nom normalisé.
export const nomsDeOption = (o) => [o.id, o.titre, ...(o.alias || [])].map(cleTexte);

// LA résolution de la sortie et de l'option d'une demande du carnet (`d.carnet` : { produit, option } de la demande du site ; `d.option` : le titre écrit dans le message),
// pour le tarif (tarifsDuSite), l'âge (ajusterAgesCarnet, demandeTarifee), la fenêtre de création et la réponse de confirmation. L'option se retrouve par son titre
// d'abord (« Modifier » le change dans le message), ensuite par son identifiant (l'un et l'autre aussi par ses alias), puis une sortie à une seule option n'en demande pas.
// Sortie ou option inconnue : null, on ne devine rien.
export function resoudreSortie(d) {
  const produit = resoudreProduit(d);
  if (!produit) return null;
  const titre = cleTexte(d.option);
  const parTitre = titre ? produit.options.find((o) => nomsDeOption(o).includes(titre)) || produit.options.find((o) => (o.anciens || []).some((a) => cleTexte(a) === titre)) : null;
  const id = cleTexte(d.carnet.option);
  const option = parTitre || (id ? produit.options.find((o) => nomsDeOption(o).includes(id)) : null) || (produit.options.length === 1 ? produit.options[0] : null);
  return option ? { produit, option } : null;
}

// Le barème d'âge des enfants d'une sortie, { min, max } : celui que la sortie du carnet déclare (`enfant`, valable pour toute la sortie, option résolue ou non), sinon celui de
// l'option résolue d'une sortie du site Secret (`enfant` de l'option, généré par regenerer-produits-site.mjs depuis les âges du prix du site). Une option sans ligne enfant
// (bateau privé) ou dont les lignes enfant ne disent pas le même âge (quad : conducteur et passager) : aucun barème, rien n'est ajusté ni inventé. Sans option résolue, jamais
// le barème d'une autre option de la sortie ni une union.
export function baremeEnfant(produit, option) {
  if (!produit) return null;
  if (produit.enfant) return produit.enfant;
  return (option && option.enfant) || null;
}

// Un enfant plus âgé que le barème de la sortie paie le tarif adulte du partenaire (décision de Jérémy, 22.11.2026 : de 10 à 14 ans, l'entrée du parc d'Ang Thong
// reste au tarif enfant, c'est le voucher qui la dit). Le message du site compte comme « enfant » tout âge de 3 ans et plus : ces enfants-là passent adultes
// avant de choisir le tarif, de calculer le prix et de préparer les lignes, et quittent `d.ages` pour ne plus être comptés deux fois (paliers de groupe, âges
// affichés). `d.agesDeclares` garde les âges dits par le client (notes du dossier), `d.plusGrands` dit combien, `d.plusGrandsMax` le barème. Sans effet pour une
// sortie sans barème (bateau privé : un prix par bateau) ou sans âges. Se rejoue sans effet.
export function ajusterAgesCarnet(d) {
  const produit = resoudreProduit(d);
  const r = produit ? resoudreSortie(d) : null;
  const bareme = produit && baremeEnfant(produit, r && r.option);
  if (!bareme || d.plusGrands !== undefined || !(d.ages || []).length) return d;
  const plus = Math.min(d.enfants || 0, d.ages.filter((a) => a > bareme.max).length);
  if (!plus) return { ...d, plusGrands: 0 };
  return { ...d, adultes: (d.adultes || 0) + plus, enfants: (d.enfants || 0) - plus, ages: d.ages.filter((a) => a <= bareme.max), agesDeclares: d.ages, plusGrands: plus, plusGrandsMax: bareme.max };
}
