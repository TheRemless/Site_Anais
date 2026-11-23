// Les âges des enfants d'une demande du carnet, en un seul endroit : la lecture de la ligne « Guests: » du message du site et la règle « un enfant plus âgé que
// le barème de sa sortie paie le tarif adulte du partenaire ». Module léger (il n'importe que carnet-produits.mjs) : demande-calc.mjs (fenêtre de création) et
// demandes-site-calc.mjs (liste, changements, réponse de confirmation) l'utilisent sans s'importer l'un l'autre. Il n'importe que des modules de données (carnet-produits.mjs, site-produits.mjs).

import { PRODUITS_CARNET } from "./carnet-produits.mjs";
import { PRODUITS_SITE } from "./site-produits.mjs";

// « 2 adults, 1 child (age 7) », « 2 adults, 3 children (ages under 1, 3 and 10) » : adultes, enfants (3 ans et plus), bébés (moins de 3 ans) et âges.
export function lireInvites(v) {
  const adultes = Number((/(\d+)\s+adults?/i.exec(v) || [])[1] || 0);
  const m = /(\d+)\s+child(?:ren)?(?:\s*\(ages?\s*([^)]*)\))?/i.exec(v);
  let ages = [];
  if (m && m[2]) ages = m[2].split(/,|\band\b/).map((x) => x.trim()).filter(Boolean).map((x) => (/under\s*1/i.test(x) ? 0 : parseInt(x, 10))).filter((n) => Number.isFinite(n));
  const enfants = ages.length ? ages.filter((a) => a >= 3).length : m ? Number(m[1]) : 0;
  return { adultes, enfants, bebes: ages.filter((a) => a < 3).length, ages };
}

// Les invités dits par le message du site (ligne « Guests: »), ou null. C'est la seule source du nombre d'adultes, d'enfants et de bébés d'une demande du carnet :
// le compteur de la table compte tous les enfants, bébés compris.
export function agesDuMessage(message) {
  const m = /^Guests:\s*(.+)$/im.exec(message || "");
  return m ? lireInvites(m[1]) : null;
}

// La sortie d'un identifiant : une seule recherche, une seule priorité. Les sorties propres au carnet (carnet-produits.mjs : Ao Nang, Koh Samui) d'abord, puis celles du site
// Secret (site-produits.mjs : le guide de Koh Lanta envoie « 4-islands », « koh-rok-koh-haa »…). Un identifiant du carnet ne doit jamais être aussi un identifiant du site
// (un test le garde). Jamais par le nom.
export const sortieParId = (id) => PRODUITS_CARNET.find((p) => p.id === id) || PRODUITS_SITE.find((p) => p.id === id) || null;

// Un titre d'option comparé sans accents ni casse (« Join-in longtail » = « join in longtail »).
const cleTitre = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

// LA résolution de la sortie et de l'option d'une demande du carnet (`d.carnet` : { produit, option } de la demande du site ; `d.option` : le titre écrit dans le message),
// pour le tarif (tarifsDuSite), l'âge (ajusterAgesCarnet, demandeTarifee), la fenêtre de création et la réponse de confirmation. L'option se retrouve par son titre
// d'abord (« Modifier » le change dans le message), ensuite par son identifiant, puis une sortie à une seule option n'en demande pas. Sortie ou option inconnue : null,
// on ne devine rien.
export function resoudreSortie(d) {
  const c = d && d.carnet;
  const produit = c && c.produit ? sortieParId(c.produit) : null;
  if (!produit || produit.marque !== "secret") return null;
  const titre = cleTitre(d.option);
  const option = (titre ? produit.options.find((o) => cleTitre(o.titre) === titre) || produit.options.find((o) => (o.anciens || []).some((a) => cleTitre(a) === titre)) : null) || produit.options.find((o) => c.option && o.id === c.option) || (produit.options.length === 1 ? produit.options[0] : null);
  return option ? { produit, option } : null;
}

// Le barème d'âge des enfants d'une option, { min, max } : celui que la sortie du carnet déclare (`enfant`), sinon celui de ses lignes « Child » du site (`ages`, structuré par
// regenerer-produits-site.mjs depuis le prix du site). Des lignes enfant qui ne disent pas le même âge (quad : conducteur et passager) ou une option sans ligne enfant
// (bateau privé) : aucun barème, rien n'est ajusté ni inventé. Sans option résolue, jamais de barème de la sortie entière.
export function baremeEnfant(produit, option) {
  if (!produit || !option) return null;
  if (produit.enfant) return produit.enfant;
  const bornes = (option.tarifs || []).filter((t) => /^child\b/i.test(t.ligne) && t.ages && Number.isFinite(t.ages.min) && Number.isFinite(t.ages.max)).map((t) => `${t.ages.min}-${t.ages.max}`);
  if (!bornes.length || new Set(bornes).size > 1) return null;
  const [min, max] = bornes[0].split("-").map(Number);
  return { min, max };
}

// Un enfant plus âgé que le barème de la sortie paie le tarif adulte du partenaire (décision de Jérémy, 22.11.2026 : de 10 à 14 ans, l'entrée du parc d'Ang Thong
// reste au tarif enfant, c'est le voucher qui la dit). Le message du site compte comme « enfant » tout âge de 3 ans et plus : ces enfants-là passent adultes
// avant de choisir le tarif, de calculer le prix et de préparer les lignes, et quittent `d.ages` pour ne plus être comptés deux fois (paliers de groupe, âges
// affichés). `d.agesDeclares` garde les âges dits par le client (notes du dossier), `d.plusGrands` dit combien, `d.plusGrandsMax` le barème. Sans effet pour une
// sortie sans barème (bateau privé : un prix par bateau) ou sans âges. Se rejoue sans effet.
export function ajusterAgesCarnet(d) {
  const r = resoudreSortie(d);
  const bareme = r && baremeEnfant(r.produit, r.option);
  if (!bareme || d.plusGrands !== undefined || !(d.ages || []).length) return d;
  const plus = Math.min(d.enfants || 0, d.ages.filter((a) => a > bareme.max).length);
  if (!plus) return { ...d, plusGrands: 0 };
  return { ...d, adultes: (d.adultes || 0) + plus, enfants: (d.enfants || 0) - plus, ages: d.ages.filter((a) => a <= bareme.max), agesDeclares: d.ages, plusGrands: plus, plusGrandsMax: bareme.max };
}
