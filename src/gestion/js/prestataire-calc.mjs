// Demande au prestataire et attente de sa réponse : ce qui se calcule sans écran, testé avec node --test.
// La date de la demande vit dans `details.demande_le` (jour AAAA-MM-JJ) : pas de colonne de plus, pas de migration.

const jourMs = 86400000;
const enJours = (iso) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / jourMs);

// Jours écoulés depuis la demande (0 le jour même). Sans date de demande, la date de dernière modification de la réservation sert de repli.
export function joursDepuisDemande(r, aujourdhui) {
  const d = (r.details && r.details.demande_le) || (r.statut === "demande" ? String(r.updated_at || r.created_at || "").slice(0, 10) : "");
  return d ? Math.max(0, enJours(aujourdhui) - enJours(d)) : null;
}

// Depuis combien de temps on attend, et si c'est long. Passé 2 jours sans réponse, on propose de relancer.
export const DELAI_RELANCE = 2;
export function attente(r, aujourdhui) {
  if (r.statut !== "demande") return null;
  const jours = joursDepuisDemande(r, aujourdhui);
  if (jours === null) return { jours: null, relancer: false };
  const relance = r.details && r.details.relance_le;
  const depuisRelance = relance ? enJours(aujourdhui) - enJours(relance) : jours;
  return { jours, relancer: depuisRelance >= DELAI_RELANCE, relances: (r.details && r.details.relances) || 0 };
}

// Détails à poser quand le message part, ou quand la réponse arrive.
export const detailsDemande = (r, aujourdhui) => ({ ...(r.details || {}), demande_le: aujourdhui, relance_le: null, relances: 0, refus_le: null });
export const detailsRelance = (r, aujourdhui) => ({ ...(r.details || {}), relance_le: aujourdhui, relances: ((r.details && r.details.relances) || 0) + 1 });
export const detailsRefus = (r, aujourdhui) => ({ ...(r.details || {}), refus_le: aujourdhui, demande_le: null, relance_le: null, relances: 0 });

// Une réservation refusée par le partenaire redevient « à demander » (il faut trouver un autre prestataire) mais garde la trace du refus.
export const refusee = (r) => r.statut === "a_demander" && !!(r.details && r.details.refus_le);
