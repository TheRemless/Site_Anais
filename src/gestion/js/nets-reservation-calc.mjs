// Nets et commission d'une réservation dans le formulaire : seuls les champs changés depuis l'ouverture s'écrivent.
// La base calcule elle-même le net et la commission prévus à la création et quand le tarif, les personnes ou le mode changent (migration 32) :
// réécrire la valeur lue à l'ouverture effacerait ce recalcul, et la base la prendrait ensuite pour une saisie à la main.
const vide = (v) => v === null || v === undefined || v === "";
const egal = (a, b) => (vide(a) ? vide(b) : !vide(b) && (typeof a === "number" || typeof b === "number" ? Number(a) === Number(b) : String(a) === String(b)));

// `avant` : la ligne de nets lue à l'ouverture (ou null) ; `saisis` : les valeurs du formulaire. Renvoie les seuls champs à écrire.
export function champsNetsChanges(avant, saisis) {
  const a = avant || {};
  return Object.fromEntries(Object.entries(saisis).filter(([k, v]) => !egal(a[k], v)));
}

// Saisie rapide d'un net ou d'une commission manquants (Jérémy, 17.11.2026 : « Anaïs se chargera de mettre le bon net par la suite, il faudrait
// qu'elle puisse mettre la commission facilement si elle n'est pas mise dans le dossier »). Un service saisi par Mook, ou dont un net de ligne
// manque, arrive sans net prévu (payé chez nous) ou sans commission prévue (payé sur place). Renvoie le champ à proposer, ou null.
// `droits` : { nets: droit « partenaires.nets », ecrit: droit « dossiers.ecrire », taxi: entreprise en mode Taxi }.
// Taxi n'a rien ici : pas de net (les clients paient le chauffeur), et sa commission se saisit par son propre geste.
// `dossierAnnule` : le dossier du service est annulé (rien à compléter, comme dans « À vérifier » et la base).
export function champSaisieRapide(r, n, { nets = false, ecrit = false, taxi = false, dossierAnnule = false } = {}) {
  if (!r || !nets || !ecrit || taxi || dossierAnnule || r.statut === "annule" || !r.partenaire_id) return null;
  const champ = r.paye_sur_place ? "commission_prevue" : "net_prevu";
  return vide(n && n[champ]) ? champ : null;
}

// Montant tapé dans la saisie rapide : « 1 200 », « 1'200 », « 1200,50 ». { valeur } ou { erreur: "vide" | "invalide" | "negatif" }.
export function montantSaisi(texte) {
  const t = String(texte ?? "").trim().replace(/[\s  ']/g, "").replace(",", ".");
  if (!t) return { erreur: "vide" };
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return { erreur: "invalide" };
  const v = Math.round(Number(t) * 100) / 100;
  return v < 0 ? { erreur: "negatif" } : { valeur: v };
}
