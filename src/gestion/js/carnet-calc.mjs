// « Carnet envoyé » : la date d'envoi du carnet de voyage fixe l'échéance du solde (les conditions disent « à la réception du carnet »).
// Logique pure, testée avec node --test. L'échéance elle-même se calcule dans calc.mjs (echeanceSolde, aFaire).

// Les colonnes viennent de la migration 26. Tant qu'elle n'est pas appliquée, la base ne renvoie pas `carnet_envoye_le` : le bouton reste caché.
// Le mode démonstration (stockage local) l'a toujours.
export const disponible = (dossier, baseDistante) => !baseDistante || (!!dossier && "carnet_envoye_le" in dossier);

// On note l'envoi d'un carnet tant qu'il y a un solde à régler : dossier accepté ou acompte reçu, jamais annulé, soldé ou « tout sur place ».
export const peutNoter = ({ annule = false, statut = "", total = 0, reste = 0 } = {}) => !annule && (statut === "accepte" || statut === "acompte") && total > 0 && reste > 0;

// Une date saisie doit être une vraie date AAAA-MM-JJ, ni avant l'an 2000 ni dans le futur : un carnet « envoyé » l'est déjà (faute de frappe sinon).
export function dateValide(iso, aujourdhui) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return false;
  return iso >= "2000-01-01" && iso <= aujourdhui;
}

export const valeursCarnet = (iso) => ({ carnet_envoye_le: iso });
export const valeursRetirer = () => ({ carnet_envoye_le: null });
