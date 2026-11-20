// Espace unifié Secret Travel & Tour et VIP Taxi Lanta (migration 63, demande de Jérémy du 20.11.2026). Nani gère les deux entreprises avec
// le même numéro WhatsApp : l'Assistant cherche dans les deux catalogues et marque chaque service de son entreprise. Logique pure, sans
// dépendance (fonction Supabase, boîte WhatsApp et tests node).
//
// Le mode s'allume quand l'entreprise de la conversation est Secret ou Taxi et que la personne a aussi « partenaires.lire » et
// « dossiers.ecrire » dans l'autre (permissions_dans, lu avec sa session). La conversation reste rangée sous l'entreprise active. Sans ce
// mode, rien ne change : ZTP n'y entre jamais, ni une personne sans droits dans l'autre entreprise.
//
// ctx.entites       : [{ id, slug, nom }] des deux entreprises, l'entreprise active d'abord ;
// ctx.permissionsPar : { [entite_id]: permissions } ; les nets et partenaires d'une ligne suivent les droits dans l'entreprise de CETTE ligne.

export const ENTREPRISES_UNIFIEES = ["secret", "taxi"];
export const DROITS_UNIFIE = ["partenaires.lire", "dossiers.ecrire"];
// Le nom court d'une entreprise dans les résultats d'outils (« Secret » ou « Taxi »).
export const LIBELLES_UNIFIES = { secret: "Secret", taxi: "Taxi" };

const propre = (e) => ({ id: e.id, slug: e.slug, nom: String(e.nom || "") });
const deuxEntreprises = (active, autre) =>
  !!active &&
  !!autre &&
  !!active.id &&
  !!autre.id &&
  active.id !== autre.id &&
  ENTREPRISES_UNIFIEES.includes(active.slug) &&
  ENTREPRISES_UNIFIEES.includes(autre.slug) &&
  active.slug !== autre.slug &&
  // Même organisation quand elle est connue (la fonction lit l'autre entreprise dans l'organisation de l'active).
  (!active.organisation_id || !autre.organisation_id || active.organisation_id === autre.organisation_id);

// Le mode unifié d'une personne, ou null. `permissions` : ses droits dans l'entreprise active (déjà contrôlés par controlerAcces) ;
// `permissionsAutre` : ses droits dans l'autre.
export function modeUnifie({ active, autre, permissions = [], permissionsAutre = [] } = {}) {
  if (!deuxEntreprises(active, autre)) return null;
  const autres = Array.isArray(permissionsAutre) ? permissionsAutre : [];
  if (!DROITS_UNIFIE.every((d) => autres.includes(d))) return null;
  return { entites: [propre(active), propre(autre)], permissionsPar: { [active.id]: [...(permissions || [])], [autre.id]: [...autres] } };
}

// La boîte WhatsApp (préparation automatique, clé de service) : aucune personne, donc aucun droit sur les partenaires ni les nets.
export function modeUnifieSansDroits({ active, autre } = {}) {
  if (!deuxEntreprises(active, autre)) return null;
  return { entites: [propre(active), propre(autre)], permissionsPar: { [active.id]: [], [autre.id]: [] } };
}

export const estUnifie = (ctx) => !!(ctx && Array.isArray(ctx.entites) && ctx.entites.length > 1 && ctx.permissionsPar && typeof ctx.permissionsPar === "object");
export const idsEntites = (ctx) => (estUnifie(ctx) ? ctx.entites.map((e) => e.id) : []);
export const entrepriseDe = (ctx, entiteId) => (estUnifie(ctx) && entiteId ? ctx.entites.find((e) => e.id === entiteId) || null : null);
export const entrepriseParSlug = (ctx, slug) => (estUnifie(ctx) && slug ? ctx.entites.find((e) => e.slug === slug) || null : null);

// Les droits qui comptent pour une ligne : ceux de son entreprise en mode unifié (aucun si l'entreprise de la ligne est inconnue, on ferme
// plutôt que d'ouvrir), sinon ceux de la personne dans l'entreprise de la conversation.
export function permissionsDans(ctx, entiteId) {
  if (!estUnifie(ctx)) return (ctx && ctx.permissions) || [];
  return (entiteId && ctx.permissionsPar[entiteId]) || [];
}

// Les droits qui règlent la description des outils et les consignes : tout droit tenu dans l'une des deux entreprises (les champs, eux,
// ne sortent que pour les lignes de l'entreprise où la personne a le droit).
export function permissionsOutils(ctx) {
  if (!estUnifie(ctx)) return (ctx && ctx.permissions) || [];
  return [...new Set(Object.values(ctx.permissionsPar).flat())];
}

// Le champ « entreprise » d'une ligne de résultat (« Secret » ou « Taxi »), seulement en mode unifié.
export function marqueEntreprise(ctx, entiteId) {
  const e = entrepriseDe(ctx, entiteId);
  return e ? { entreprise: LIBELLES_UNIFIES[e.slug] || e.nom } : {};
}
