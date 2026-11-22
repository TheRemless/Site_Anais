// Les âges des enfants d'une demande du carnet, en un seul endroit : la lecture de la ligne « Guests: » du message du site et la règle « un enfant plus âgé que
// le barème de sa sortie paie le tarif adulte du partenaire ». Module léger (il n'importe que carnet-produits.mjs) : demande-calc.mjs (fenêtre de création) et
// demandes-site-calc.mjs (liste, changements, réponse de confirmation) l'utilisent sans s'importer l'un l'autre.

import { PRODUITS_CARNET } from "./carnet-produits.mjs";

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

// Un enfant plus âgé que le barème de la sortie paie le tarif adulte du partenaire (décision de Jérémy, 22.11.2026 : de 10 à 14 ans, l'entrée du parc d'Ang Thong
// reste au tarif enfant, c'est le voucher qui la dit). Le message du site compte comme « enfant » tout âge de 3 ans et plus : ces enfants-là passent adultes
// avant de choisir le tarif, de calculer le prix et de préparer les lignes, et quittent `d.ages` pour ne plus être comptés deux fois (paliers de groupe, âges
// affichés). `d.agesDeclares` garde les âges dits par le client (notes du dossier), `d.plusGrands` dit combien, `d.plusGrandsMax` le barème. Sans effet pour une
// sortie sans barème (bateau privé : un prix par bateau) ou sans âges. Se rejoue sans effet.
export function ajusterAgesCarnet(d) {
  const produit = d && d.carnet && d.carnet.produit ? PRODUITS_CARNET.find((p) => p.id === d.carnet.produit) : null;
  const bareme = produit && produit.enfant;
  if (!bareme || d.plusGrands !== undefined || !(d.ages || []).length) return d;
  const plus = Math.min(d.enfants || 0, d.ages.filter((a) => a > bareme.max).length);
  if (!plus) return { ...d, plusGrands: 0 };
  return { ...d, adultes: (d.adultes || 0) + plus, enfants: (d.enfants || 0) - plus, ages: d.ages.filter((a) => a <= bareme.max), agesDeclares: d.ages, plusGrands: plus, plusGrandsMax: bareme.max };
}
