// Recopie, des fichiers de données des guides d'Ao Nang et de Koh Lanta (src/carnet/*.11tydata.js, publics), ce qu'il faut pour lire en français le WhatsApp que leur page fabrique :
// le titre français de chaque offre (la première ligne « Demande de réservation : … ») donne la sortie et l'option de Gestion, et les libellés français de ses formules, créneaux, choix,
// options et lignes donnent leur nom anglais (celui du message envoyé à Gestion). Un seul fichier, src/gestion/js/carnet-correspondance.mjs, lu par carnet-colle.mjs.
// À relancer quand une offre, une formule, un créneau, un choix, une option ou une ligne est ajouté, renommé ou retiré dans l'un de ces deux guides :
//   node docs/gestion/regenerer-correspondance-carnet.mjs
// Ni prix, ni partenaire, ni net : seulement des textes que la page affiche déjà. Les offres sans feuille de réservation (renvoi vers WhatsApp) n'ont pas de message et n'y figurent pas.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const ici = path.dirname(fileURLToPath(import.meta.url));
const GUIDES = [
  { guide: "aonang", fichier: "../../src/carnet/ao-nang-excursions-bateau.11tydata.js" },
  { guide: "koh-lanta", fichier: "../../src/carnet/koh-lanta-excursions-activites.11tydata.js" },
];
const sans = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)));
const g = (x) => sans({ produit: x.produit, produitNom: x.produitNom, option: x.option, optionTitre: x.optionTitre });

export function correspondanceDes({ guide, donnees }) {
  const config = donnees.eleventyComputed.carnetConfig({ business: { telephone: "+66958683846" } });
  return Object.values(config.offres).map((o) => sans({
    guide,
    id: o.id,
    titre: o.produit,
    type: o.type,
    variantesLabel: o.variantes && o.variantes.length ? o.variantesLabel || "Formule" : undefined,
    variantes: (o.variantes || []).map((v) => sans({ label: v.label, produit: v.gestionProduit || (o.gestion || {}).produit, produitNom: v.gestionProduitNom || (o.gestion || {}).produitNom, option: v.gestionId || (o.gestion || {}).option, optionTitre: v.gestionTitre || (o.gestion || {}).optionTitre })),
    gestion: o.gestion && !(o.variantes && o.variantes.length) ? g(o.gestion) : undefined,
    creneauxLabel: o.creneaux && o.creneaux.length ? o.creneauxLabel || "Créneau" : undefined,
    creneauxLabelEn: o.creneaux && o.creneaux.length ? o.creneauxLabelEn || "Time" : undefined,
    creneaux: (o.creneaux || []).map((c) => sans({ label: c.label, en: c.en })),
    choix: (o.choix || []).map((c) => sans({ label: c.label, en: c.en, valeurs: (c.valeurs || []).map((v) => sans({ label: v.label, en: v.en })) })),
    extras: (o.extras || []).map((x) => sans({ label: x.label, en: x.en })),
    lignesLabel: o.lignes && o.lignes.length ? o.lignesLabel || "Personnes" : undefined,
    lignesLabelEn: o.lignes && o.lignes.length ? o.lignesLabelEn || "Riders and passengers" : undefined,
    lignes: (o.lignes || []).map((l) => sans({ label: l.label, en: l.en, role: l.role, places: l.places })),
  }));
}

export function fichierGenere() {
  const lignes = GUIDES.flatMap(({ guide, fichier }) => correspondanceDes({ guide, donnees: require(path.join(ici, fichier)) }));
  return `// GÉNÉRÉ par docs/gestion/regenerer-correspondance-carnet.mjs : ne pas modifier à la main. Les offres des guides d'Ao Nang et de Koh Lanta, lues dans leurs fichiers de données publics
// (src/carnet/*.11tydata.js) : titre français de la page, sortie et option de Gestion, noms français et anglais des formules, créneaux, choix, options et lignes. Aucun prix, aucun partenaire.
export const CORRESPONDANCE_CARNET = [\n${lignes.map((l) => `  ${JSON.stringify(l)}`).join(",\n")}\n];\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(path.join(ici, "../../src/gestion/js/carnet-correspondance.mjs"), fichierGenere());
  console.log("src/gestion/js/carnet-correspondance.mjs écrit");
}
