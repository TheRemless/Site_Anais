// Sauvegarde et restauration : ce qui part dans le fichier, et ce qui est refusé à l'import. Logique pure, testable avec node --test.

export const VERSION_SAUVEGARDE = 3;

// Colonnes que l'outil ajoute aux lignes en mémoire (le résumé d'un dossier tenu par la base) : elles n'existent pas dans la table,
// la base refuserait l'import d'une ligne qui les porte.
const DERIVEES = { dossiers: ["total", "devise", "recu"] };

export function pourSauvegarde(table, lignes) {
  return (lignes || []).map((ligne) => {
    const copie = { ...ligne };
    for (const k of DERIVEES[table] || []) delete copie[k];
    return copie;
  });
}
