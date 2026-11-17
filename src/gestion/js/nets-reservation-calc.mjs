// Nets et commission d'une réservation dans le formulaire : seuls les champs changés depuis l'ouverture s'écrivent.
// La base calcule elle-même le net et la commission prévus à la création et quand le tarif, les personnes ou le mode changent (migration 31) :
// réécrire la valeur lue à l'ouverture effacerait ce recalcul, et la base la prendrait ensuite pour une saisie à la main.
const vide = (v) => v === null || v === undefined || v === "";
const egal = (a, b) => (vide(a) ? vide(b) : !vide(b) && (typeof a === "number" || typeof b === "number" ? Number(a) === Number(b) : String(a) === String(b)));

// `avant` : la ligne de nets lue à l'ouverture (ou null) ; `saisis` : les valeurs du formulaire. Renvoie les seuls champs à écrire.
export function champsNetsChanges(avant, saisis) {
  const a = avant || {};
  return Object.fromEntries(Object.entries(saisis).filter(([k, v]) => !egal(a[k], v)));
}
