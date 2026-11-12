// Ne plus écraser le travail de l'autre. Le formulaire d'une fiche réécrit tous ses champs : si quelqu'un d'autre a enregistré entre-temps,
// on compare trois versions, celle que la personne a ouverte (`base`), ce qu'elle veut écrire (`miennes`) et celle de la base maintenant
// (`courante`). Un champ que seule l'une des deux personnes a changé se garde sans rien demander ; seul un champ changé des deux côtés
// avec deux valeurs différentes est un conflit. Les objets (personnes, details) se comparent clé par clé. Logique pure, testée.

const IGNORES = new Set(["updated_at", "modifie_par"]);
const egal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const simple = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Fusionne une valeur (scalaire, tableau ou objet) : renvoie { valeur, aEcrire, conflits } ; `aEcrire` : la valeur diffère de la courante.
function fusionnerValeur(cle, base, mienne, courante, conflits) {
  if (egal(mienne, base)) return courante; // je n'y ai pas touché : la version de l'autre reste
  if (egal(courante, base) || egal(courante, mienne)) return mienne; // l'autre n'y a pas touché (ou a écrit la même chose)
  if (simple(mienne) && simple(courante)) {
    const b = simple(base) ? base : {};
    const sortie = {};
    for (const k of new Set([...Object.keys(courante), ...Object.keys(mienne)])) {
      if (!(k in mienne)) { sortie[k] = courante[k]; continue; }
      const v = fusionnerValeur(`${cle}.${k}`, b[k], mienne[k], courante[k], conflits);
      if (v !== undefined) sortie[k] = v;
    }
    return sortie;
  }
  conflits.push({ cle, base: base ?? null, sienne: courante ?? null, mienne: mienne ?? null });
  return courante; // en attendant le choix, la version de l'autre reste
}

// Renvoie { patch, conflits } : `patch` ne contient que les champs à écrire pour garder le travail des deux (les champs en conflit n'y sont pas, ils
// restent à la version de l'autre jusqu'au choix) ; `conflits` : [{ cle, base, sienne, mienne }] avec les trois valeurs, `cle` en « champ.sous-champ ».
export function fusionner(base, miennes, courante) {
  const patch = {};
  const conflits = [];
  for (const [k, mienne] of Object.entries(miennes)) {
    if (IGNORES.has(k)) continue;
    const avant = conflits.length;
    const v = fusionnerValeur(k, base[k], mienne, courante[k], conflits);
    // Un champ dont tous les conflits restent à trancher n'est pas écrit tel quel : on n'écrit que ce qui change vraiment.
    if (conflits.length > avant && !simple(mienne)) continue;
    if (!egal(v, courante[k])) patch[k] = v;
  }
  return { patch, conflits };
}

// Le choix de la personne : « sien » garde la version de l'autre pour les champs en conflit, « miens » impose les siens.
export function appliquerChoix({ patch, conflits }, choix, courante = null) {
  if (choix !== "miens" || !conflits.length) return { ...patch };
  const sortie = JSON.parse(JSON.stringify(patch));
  for (const c of conflits) {
    const [champ, ...chemin] = c.cle.split(".");
    if (!chemin.length) { sortie[champ] = c.mienne; continue; }
    let o = (sortie[champ] = simple(sortie[champ]) ? sortie[champ] : { ...((courante && courante[champ]) || {}) });
    for (const k of chemin.slice(0, -1)) o = o[k] = simple(o[k]) ? o[k] : {};
    o[chemin[chemin.length - 1]] = c.mienne;
  }
  return sortie;
}
