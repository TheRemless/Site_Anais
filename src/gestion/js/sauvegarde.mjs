// Sauvegarde et restauration : ce qui part dans le fichier, et ce qui est refusé à l'import. Logique pure, testable avec node --test.

export const VERSION_SAUVEGARDE = 3;

// Colonnes que l'outil ajoute aux lignes en mémoire (le résumé d'un dossier tenu par la base) : elles n'existent pas dans la table,
// la base refuserait l'import d'une ligne qui les porte.
// Une seule liste : le magasin Supabase fusionne ces colonnes dans chaque dossier (`fusion`), et la sauvegarde les retire. Y ajouter une colonne ici suffit aux deux.
export const COLONNES_RESUME = ["total", "devise", "recu", "sur_place"];
const DERIVEES = { dossiers: COLONNES_RESUME };

export function pourSauvegarde(table, lignes) {
  return (lignes || []).map((ligne) => {
    const copie = { ...ligne };
    for (const k of DERIVEES[table] || []) delete copie[k];
    return copie;
  });
}

const TABLES_FORMAT = ["clients", "dossiers", "documents", "paiements", "catalogue", "partenaires", "partenaires_prives", "prestations", "prestations_nets", "trajets", "trajets_nets", "reservations", "reservations_nets", "taches"];

// Le fichier est-il une sauvegarde de cette entreprise ? Une ancienne sauvegarde sans nom d'entreprise est acceptée.
// Chaque rubrique est un tableau d'objets, et partenaires, tarifs et trajets portent un identifiant (sans lui, « remplacer » prendrait tout pour absent).
export function verifierSauvegarde(data, slugActif) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, erreur: "format" };
  const presentes = TABLES_FORMAT.filter((t) => data[t] !== undefined);
  if (!presentes.length) return { ok: false, erreur: "format" };
  for (const t of presentes) {
    if (!Array.isArray(data[t]) || !data[t].every((x) => x && typeof x === "object" && !Array.isArray(x))) return { ok: false, erreur: "format" };
  }
  for (const t of ["partenaires", "prestations", "trajets"]) {
    if ((data[t] || []).some((x) => typeof x.id !== "string" || !x.id)) return { ok: false, erreur: "format" };
  }
  if (data.entreprise && slugActif && data.entreprise !== slugActif) return { ok: false, erreur: "autre_entreprise", entreprise: data.entreprise };
  return { ok: true };
}

// « Remplacer la base partenaires » : ce qui existe aujourd'hui et n'est pas dans le fichier. Un fichier sans la rubrique ne dit rien.
// Supprimer un partenaire supprime aussi, en cascade, ses tarifs et ses trajets : ils sont comptés avec lui.
export function absentsDeLaSauvegarde(actuel, fichier) {
  const absents = (cle) => {
    if (!Array.isArray(fichier[cle])) return [];
    const gardes = new Set(fichier[cle].map((x) => x.id));
    return (actuel[cle] || []).filter((x) => !gardes.has(x.id)).map((x) => x.id);
  };
  const partenaires = absents("partenaires");
  const retires = new Set(partenaires);
  const avecCascade = (cle) => [...new Set([...absents(cle), ...(actuel[cle] || []).filter((x) => retires.has(x.partenaire_id)).map((x) => x.id)])];
  return { partenaires, prestations: avecCascade("prestations"), trajets: avecCascade("trajets") };
}

// Les réservations qui perdraient leur partenaire, leur prestation ou leur trajet (la base remet le lien à vide quand l'élément disparaît).
export function reservationsPerdantLeurPrestataire(reservations, absents) {
  const p = new Set(absents.partenaires);
  const s = new Set(absents.prestations);
  const t = new Set(absents.trajets);
  return (reservations || []).filter((r) => p.has(r.partenaire_id) || s.has(r.prestation_id) || t.has(r.trajet_id));
}
