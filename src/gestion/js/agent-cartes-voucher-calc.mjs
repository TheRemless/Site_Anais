// Cartes « Voucher » de l'Assistant (views/agent-cartes-voucher.mjs) : la logique sans écran, testée à part (revue de sécurité de la PR 303).

// Faire `fn` dans l'entreprise `id`, d'un trait (rien d'asynchrone dedans), puis revenir. La bascule est dans le `try` : si elle lève, le
// retour se fait quand même. Le voucher fait sous un autre logo (etat.voucherDepuis, écran de Mook) est gardé et remis tel quel, car
// changerEntite l'efface. `changer(id)` : changerEntite(id, { naviguer: false }).
export function dansEntreprise(etat, changer, id, fn) {
  const origine = etat.entiteId;
  if (!id || id === origine) return fn();
  const depuis = etat.voucherDepuis;
  try {
    changer(id);
    return fn();
  } finally {
    if (etat.entiteId !== origine) changer(origine);
    etat.voucherDepuis = depuis;
  }
}

// Les lignes groupées par entreprise, dans l'ordre de leur première apparition : une seule bascule par entreprise.
export function parEntreprise(lignes = [], entrepriseDe = (x) => x.ent) {
  const groupes = new Map();
  for (const x of lignes) {
    const k = entrepriseDe(x) || "";
    if (!groupes.has(k)) groupes.set(k, []);
    groupes.get(k).push(x);
  }
  return [...groupes.entries()].map(([ent, liste]) => ({ ent, liste }));
}

// Une empreinte courte (djb2) : la clé du cache d'image ne garde pas un logo entier en mémoire.
export function empreinte(t) {
  let h = 5381;
  const s = String(t || "");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
// La clé du cache d'une image : la réservation et sa version, le voucher figé, le client et le dossier tels qu'ils s'impriment, l'en-tête
// et le logo de l'entreprise. Un changement de l'un d'eux refait l'image.
export function cleImage({ reservation: r = {}, client = {}, dossier = {}, reglages = {} } = {}) {
  const fige = (r.details && r.details.voucher_fige && r.details.voucher_fige.empreinte) || "";
  const imprime = JSON.stringify([
    r.updated_at || "",
    JSON.stringify(r.details || {}),
    [client.id, client.prenom, client.nom, client.telephone, client.updated_at],
    [dossier.id, dossier.ref, dossier.updated_at],
    [reglages.apparence || {}, reglages.voucher || {}, reglages.emetteur || {}],
  ]);
  return `${r.id || ""}|${fige}|${empreinte(imprime)}`;
}
