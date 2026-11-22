// Sièges enfant ou bébé d'un transfert, par type (Jérémy, 22.11.2026) : « Quand il y a au moins un enfant, il faut préciser s'il faut un
// child ou un baby seat. S'il y a un enfant et qu'il ne faut pas de siège, il faut le mettre aussi. »
// Dans `details` de la réservation :
//   - `sieges` : les sièges enfant (« child seat »). C'est l'ancienne clé, qui s'imprimait déjà « N child seat(s) » : une réservation d'avant
//     garde le même voucher ;
//   - `sieges_bebe` : les sièges bébé (« baby seat ») ;
//   - `sans_siege` : true quand il ne faut aucun siège (dit par le client ou par Nani). Posé seulement sans siège.
// Pur : aucune dépendance, lu par les vouchers, la Booking confirmation, l'écran de Mook, celui du chauffeur et l'Assistant.

export const SIEGES_MAX = 10;
const entier = (n) => Math.max(0, Math.floor(Number(n) || 0));

// Les sièges d'une réservation (ou d'un service de carte, mêmes clés) : { enfant, bebe, aucun }. `aucun` n'est vrai que sans aucun siège.
export function siegesLus(dt = {}) {
  const d = dt || {};
  const enfant = entier(d.sieges);
  const bebe = entier(d.sieges_bebe);
  return { enfant, bebe, aucun: !enfant && !bebe && (d.sans_siege === true || d.sans_siege === "true") };
}
export const siegesTotal = (s) => entier(s && s.enfant) + entier(s && s.bebe);
// Le choix est fait : au moins un siège, ou « aucun siège » dit explicitement.
export const siegesChoisis = (s) => siegesTotal(s) > 0 || !!(s && s.aucun);

// « 1 child seat, 1 baby seat », « 2 child seats », « no child seat needed », "" sans rien de dit.
export function siegesAnglais(s) {
  if (!s) return "";
  const n = (k, un, plusieurs) => (k ? `${k} ${k > 1 ? plusieurs : un}` : "");
  const liste = [n(entier(s.enfant), "child seat", "child seats"), n(entier(s.bebe), "baby seat", "baby seats")].filter(Boolean).join(", ");
  return liste || (s.aucun ? "no child seat needed" : "");
}

// Les clés de `details` d'après un choix { enfant, bebe, aucun } : les anciennes sont retirées, rien de vide n'est écrit.
export function detailsAvecSieges(details = {}, s = {}) {
  const { sieges, sieges_bebe, sans_siege, ...reste } = details || {};
  const enfant = entier(s.enfant);
  const bebe = entier(s.bebe);
  return { ...reste, ...(enfant ? { sieges: enfant } : {}), ...(bebe ? { sieges_bebe: bebe } : {}), ...(!enfant && !bebe && s.aucun ? { sans_siege: true } : {}) };
}

// Le choix reste à faire : au moins un enfant ou un bébé, et ni siège ni « aucun siège ».
export const siegesAChoisir = ({ enfants = 0, bebes = 0, sieges = null } = {}) => entier(enfants) + entier(bebes) > 0 && !siegesChoisis(sieges || {});
