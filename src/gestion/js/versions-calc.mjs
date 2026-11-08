// Comparaison d'une ancienne version d'un devis ou d'une facture avec le document actuel : ce qui changerait si on la restaure.
// Logique pure, testée avec node --test. Les nets des lignes ne sont jamais comparés (ils sont confidentiels).
import { totaux } from "./calc.mjs";

const vide = (v) => v === null || v === undefined || v === "";
const texte = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).join("\n") : vide(v) ? "" : String(v).trim());
const memes = (a, b) => (typeof a === "number" || typeof b === "number" ? (vide(a) ? null : Number(a)) === (vide(b) ? null : Number(b)) : texte(a) === texte(b));

// Champs d'une ligne comparés, dans l'ordre où ils sont annoncés.
const CHAMPS_LIGNE = ["libelle", "intro", "puces", "unite", "qte", "montant", "pct", "date_service"];
// Champs du contenu hors lignes : le montant reçu et les équivalents se recalculent, ils ne sont pas annoncés.
const CHAMPS_CONTENU = ["bandeau", "colonnes", "pied", "variante", "langue", "prestataire", "tva", "devise", "paiement", "titre_perso", "texte_perso", "cgv"];

const intitule = (l) => texte(l.titre) || texte(l.libelle) || (l.kind === "bloc" ? "Bloc" : "Ligne");

// `version` et `actuel` : { contenu, date_emission }. Renvoie { total, changements } du point de vue de la version :
// `version` est ce que le document deviendrait, `actuel` ce qu'il est.
// `defaut` : la devise de l'entreprise, que prend un document dont la devise n'est pas fixée.
export function comparerDocuments(version, actuel, { defaut = "" } = {}) {
  const v = { ...(version.contenu || {}) };
  const a = { ...(actuel.contenu || {}) };
  v.devise = v.devise || defaut;
  a.devise = a.devise || defaut;
  const changements = [];
  const tv = totaux(v).net;
  const ta = totaux(a).net;
  if (tv !== ta) changements.push({ type: "total", version: tv, actuel: ta, deviseVersion: v.devise, deviseActuel: a.devise });
  if ((version.date_emission || "") !== (actuel.date_emission || "")) changements.push({ type: "date_emission", version: version.date_emission, actuel: actuel.date_emission });
  for (const cle of CHAMPS_CONTENU) if (!memes(v[cle], a[cle])) changements.push({ type: "champ", cle, version: v[cle] ?? "", actuel: a[cle] ?? "" });
  const lv = v.lignes || [];
  const la = a.lignes || [];
  const parId = new Map(la.map((l) => [l.id, l]));
  const idsV = new Set(lv.map((l) => l.id));
  for (const l of lv) {
    const cour = parId.get(l.id);
    if (!cour) {
      changements.push({ type: "ligne_retrouvee", intitule: intitule(l), ligne: l });
      continue;
    }
    const champs = CHAMPS_LIGNE.filter((k) => !memes(l[k], cour[k])).map((k) => ({ cle: k, version: l[k] ?? "", actuel: cour[k] ?? "" }));
    if (champs.length) changements.push({ type: "ligne_modifiee", intitule: intitule(l), champs, deviseVersion: v.devise, deviseActuel: a.devise });
  }
  for (const l of la) if (!idsV.has(l.id)) changements.push({ type: "ligne_retiree", intitule: intitule(l), ligne: l });
  return { identique: !changements.length, changements };
}
