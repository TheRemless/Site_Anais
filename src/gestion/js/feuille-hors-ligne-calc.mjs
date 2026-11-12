// Copie de la feuille du jour pour la lire sans réseau : aujourd'hui et demain, seulement ce qu'un chauffeur ou un capitaine doit savoir (heures, lieux, personnes, téléphones,
// partenaires). JAMAIS de montant, de net ni de commission : la liste des champs gardés est écrite ci-dessous, ce qui n'y figure pas ne part pas sur le téléphone.
// Logique pure, testée avec node --test ; le stockage (localStorage) et l'affichage sont dans etat.mjs et hors-ligne.mjs.
import { feuilleDuJour } from "./operations-calc.mjs";
import { CLE_HORS_LIGNE, AGE_MAX_H, lireCopie } from "./feuille-hors-ligne-lecture.mjs";

export { CLE_HORS_LIGNE, AGE_MAX_H, lireCopie };
const jourPlus = (jour, n) => new Date(Date.UTC(+jour.slice(0, 4), +jour.slice(5, 7) - 1, +jour.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);

const LIGNE = ["heure", "libelle", "client", "telephone", "hotel", "chambre", "reference", "statut"];
const garder = (o, cles) => Object.fromEntries(cles.map((k) => [k, o[k] ?? ""]));

// `brut` : les données chargées (toutes les entreprises accessibles) ; `entites` : celles que la personne peut lire.
export function construireCopie({ brut, entites, utilisateur, aujourdhui, maintenant = new Date() }) {
  const jours = [aujourdhui, jourPlus(aujourdhui, 1)];
  return {
    version: 1,
    utilisateur: utilisateur || "",
    enregistre_le: new Date(maintenant).toISOString(),
    entreprises: entites.map((e) => {
      const reservations = (brut.reservations || []).filter((r) => r.entite_id === e.id);
      const dossiers = (brut.dossiers || []).filter((d) => d.entite_id === e.id);
      const annules = new Set(dossiers.filter((d) => d.annule).map((d) => d.id));
      const clientDe = (r) => {
        const d = dossiers.find((x) => x.id === r.dossier_id);
        return d ? (brut.clients || []).find((c) => c.id === d.client_id) || null : null;
      };
      const partenaire = (id) => (brut.partenaires || []).find((p) => p.id === id) || null;
      const contexte = { client: clientDe, partenaire: (id) => (partenaire(id) || {}).nom || "" };
      return {
        id: e.id,
        nom: e.nom,
        jours: jours.map((date) => ({
          date,
          groupes: feuilleDuJour(reservations, date, contexte, annules).map((g) => {
            const tels = ((partenaire(g.partenaire_id) || {}).contact || {}).telephones || [];
            const tel = tels.find((t) => t.whatsapp) || tels[0];
            return {
              nom: g.nom,
              telephone: tel ? tel.numero || "" : "",
              adultes: g.adultes,
              enfants: g.enfants,
              lignes: g.lignes.map((l) => ({ ...garder(l, LIGNE), adultes: Number(l.personnes && l.personnes.adultes) || 0, enfants: Number(l.personnes && l.personnes.enfants) || 0, bebes: Number(l.personnes && l.personnes.bebes) || 0 })),
            };
          }),
        })),
      };
    }),
  };
}
