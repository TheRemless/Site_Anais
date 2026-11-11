// Feuille du jour : ce qui manque avant d'envoyer, et le texte à envoyer quand une information manque encore. Testé avec node --test.
import { dateTexte, personnesTexte } from "./operations-calc.mjs";
import { libelleClient } from "./partenaires-calc.mjs";

// Les pickups d'une feuille (groupes de `feuilleDuJour`) sans heure ou sans hôtel : le chauffeur ne peut pas les faire.
// Renvoie [{ id, libelle, client, manque: ["heure", "hotel"] }], dans l'ordre de la feuille.
export function alertesFeuille(groupes) {
  const out = [];
  for (const g of groupes) {
    for (const l of g.lignes) {
      const manque = [];
      if (!String(l.heure || "").trim()) manque.push("heure");
      if (!String(l.hotel || "").trim()) manque.push("hotel");
      if (manque.length) out.push({ id: l.id, libelle: l.libelle, client: l.client, manque });
    }
  }
  return out;
}

// Texte WhatsApp d'un groupe, en anglais. Une heure ou un lieu inconnu est écrit « time TBC » ou « pickup TBC » plutôt que laissé vide,
// pour que le chauffeur sache qu'il manque quelque chose et ne le devine pas.
export function texteFeuillePartage(groupe, date) {
  const tete = `${groupe.nom ? `${groupe.nom}: ` : ""}${dateTexte(date, "en")}, ${personnesTexte({ adultes: groupe.adultes, enfants: groupe.enfants }, "en") || "0 passengers"}`;
  const lignes = groupe.lignes.map((l) =>
    [
      l.heure || "time TBC",
      libelleClient(l.libelle),
      l.client,
      l.telephone,
      [l.hotel, l.chambre ? `room ${l.chambre}` : ""].filter(Boolean).join(", ") || "pickup TBC",
      personnesTexte(l.personnes, "en"),
    ]
      .filter(Boolean)
      .join(" · ")
  );
  return [tete, ...lignes].join("\n");
}

// Les trois jours proposés en un tap : aujourd'hui, demain, après-demain.
export const joursProposes = (ajd) => [0, 1, 2].map((n) => new Date(Date.UTC(+ajd.slice(0, 4), +ajd.slice(5, 7) - 1, +ajd.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10));

const plus = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);
// Dates proposées pour reporter une tâche : demain, dans 2 jours, le prochain lundi (jamais aujourd'hui), dans une semaine.
export function reportsProposes(ajd) {
  const jourSemaine = new Date(`${ajd}T00:00:00Z`).getUTCDay();
  return { demain: plus(ajd, 1), deuxJours: plus(ajd, 2), lundi: plus(ajd, (8 - jourSemaine) % 7 || 7), semaine: plus(ajd, 7) };
}
