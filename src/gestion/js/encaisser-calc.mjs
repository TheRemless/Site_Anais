// Encaisser les commissions des partenaires, dossier par dossier (20.11.2026, migration 57).
// Un partenaire a souvent plusieurs dossiers en cours : Anaïs coche ceux qu'il a payés, voit le total coché et encaisse la sélection d'un geste.
// Chaque dossier reçoit son propre enregistrement (date, moyen), sur chacun de ses services payés sur place chez ce partenaire.
// Rien ici ne touche à l'écran ni à la base : les vues appellent ces fonctions puis écrivent les lignes de `reservations_nets` rendues.
import { arrondi, formatDate } from "./calc.mjs";
import { N_, tr } from "./i18n.mjs";
import { contenuAvecService } from "./operations-calc.mjs";
import { contenuCourse } from "./taxi-calc.mjs";

// Les motifs d'un écart entre la commission reçue et celle prévue. La clé est enregistrée en base (contrainte de la migration 57).
export const MOTIFS_ECART = [
  ["rabais", N_("Rabais au client")],
  ["plus_cher", N_("Vendu plus cher")],
  ["autre", N_("Autre")],
];
export const NOTE_ECART_MAX = 300;

const nombre = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const actif = (r, ecartees) => r.paye_sur_place && r.statut !== "annule" && !ecartees.has(r.dossier_id);

// Les dossiers dont la commission reste à recevoir, regroupés par partenaire. Un service dont la réception est datée est réglé : il ne figure plus.
// `netDe(r)` : la ligne privée de la réservation ou null. `ajd` : la date du jour (AAAA-MM-JJ).
// Renvoie [{ partenaire_id, reste, dossiers: [{ dossier_id, partenaire_id, cle, reservations, prevue, dejaRecu, reste, sansCommission, aVenir,
//   partielLe, date, coche }] }]. Chaque `reste` de partenaire est la somme des `reste` de ses dossiers, au centime : l'écran affiche ces sommes.
export function aRecevoirParPartenaire(reservations, netDe, { ecartees = new Set(), ajd = "" } = {}) {
  const parCle = new Map();
  for (const r of reservations || []) {
    if (!actif(r, ecartees)) continue;
    const n = netDe(r) || {};
    if (n.commission_recue_le) continue;
    const cle = `${r.partenaire_id || ""}|${r.dossier_id}`;
    const d = parCle.get(cle) || { cle, dossier_id: r.dossier_id, partenaire_id: r.partenaire_id || null, reservations: [], prevue: 0, dejaRecu: 0, reste: 0, sansCommission: 0, aVenir: false, partielLe: null, date: null };
    const prevue = nombre(n.commission_prevue);
    const recu = nombre(n.commission_recue) || 0;
    d.reservations.push(r);
    if (prevue === null) d.sansCommission++;
    else {
      d.prevue += prevue;
      d.reste += Math.max(0, prevue - recu);
    }
    d.dejaRecu += recu;
    // Un service du jour ou à venir n'est pas encore dû : il reste dans la liste, sans être coché par « Tout cocher ».
    if (!r.date_service || !ajd || r.date_service >= ajd) d.aVenir = true;
    if (n.commission_partielle_le && (!d.partielLe || n.commission_partielle_le > d.partielLe)) d.partielLe = n.commission_partielle_le;
    if (r.date_service && (!d.date || r.date_service < d.date)) d.date = r.date_service;
    parCle.set(cle, d);
  }
  const parPartenaire = new Map();
  for (const d of parCle.values()) {
    d.prevue = arrondi(d.prevue);
    d.dejaRecu = arrondi(d.dejaRecu);
    d.reste = arrondi(d.reste);
    d.reservations.sort((a, b) => String(a.date_service || "9999").localeCompare(String(b.date_service || "9999")));
    // Coché par « Tout cocher » : passé, avec une commission prévue sur chaque service et quelque chose à recevoir.
    d.coche = !d.aVenir && d.sansCommission === 0 && d.reste > 0;
    const p = parPartenaire.get(d.partenaire_id || "") || { partenaire_id: d.partenaire_id, dossiers: [], reste: 0 };
    p.dossiers.push(d);
    parPartenaire.set(d.partenaire_id || "", p);
  }
  return [...parPartenaire.values()]
    .map((p) => ({ ...p, dossiers: p.dossiers.sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999"))), reste: sommeRestes(p.dossiers) }))
    .sort((a, b) => b.reste - a.reste);
}

// La somme au centime de ce qui est affiché : une liste de dossiers (leur `reste`) ou de montants. Les totaux de l'écran passent tous par ici.
export const sommeRestes = (dossiers) => arrondi((dossiers || []).reduce((s, d) => s + (Number(d.reste) || 0), 0));
export const sommeMontants = (montants) => arrondi((montants || []).reduce((s, m) => s + (Number(m) || 0), 0));

// Ce qu'un montant saisi pour un dossier demande à Anaïs. `montant` : nombre ou null.
//   egal     : le montant prévu, le dossier est soldé sans question ;
//   moins    : moins que le reste, il faut choisir « le reste viendra plus tard » ou « solder le dossier » (avec un motif) ;
//   plus     : plus que prévu, le dossier est soldé avec un motif ;
//   libre    : aucune commission prévue, le montant reçu solde le dossier sans motif ;
//   invalide : pas de montant, ou négatif.
export function natureMontant(dossier, montant) {
  if (montant === null || montant === undefined || Number.isNaN(Number(montant)) || Number(montant) < 0) return "invalide";
  const m = arrondi(Number(montant));
  if (dossier.sansCommission === dossier.reservations.length) return m > 0 ? "libre" : "invalide";
  if (m === dossier.reste) return "egal";
  return m < dossier.reste ? "moins" : "plus";
}

// Répartit `montant` sur les services du dossier, au prorata de ce qu'il reste à recevoir sur chacun (à parts égales quand rien n'est prévu).
// Le dernier prend l'arrondi : la somme des parts égale le montant au centime. Renvoie [{ reservation, part, prevue, recu }].
export function repartirSurDossier(dossier, netDe, montant) {
  const m = arrondi(Number(montant) || 0);
  const lignes = dossier.reservations.map((r) => {
    const n = netDe(r) || {};
    const prevue = nombre(n.commission_prevue);
    const recu = nombre(n.commission_recue) || 0;
    return { reservation: r, prevue, recu, poids: prevue === null ? 0 : Math.max(0, prevue - recu) };
  });
  const total = lignes.reduce((s, l) => s + l.poids, 0);
  const poids = total > 0 ? lignes.map((l) => l.poids) : lignes.map(() => 1);
  const somme = poids.reduce((s, x) => s + x, 0);
  let reste = m;
  return lignes.map((l, i) => {
    const part = i === lignes.length - 1 ? reste : arrondi((m * poids[i]) / somme);
    reste = arrondi(reste - part);
    return { reservation: l.reservation, part, prevue: l.prevue, recu: l.recu };
  });
}

// Les écritures d'un encaissement de dossier : une ligne de `reservations_nets` par service. `choix` :
//   { montant, date, moyen, suite: "solder" | "plus_tard", motif, note }
// « plus_tard » ajoute le versement au déjà reçu sans régler le service (le reste reste à recevoir) ; « solder » règle chaque service à la date,
// et garde le motif et la note quand le total reçu du dossier s'écarte du prévu. Sans aucune commission prévue, le reçu devient le prévu. Renvoie { ecritures: [{ reservation_id, valeurs }], erreur }.
export function ecrituresEncaissement(dossier, netDe, choix) {
  const nature = natureMontant(dossier, choix.montant);
  if (nature === "invalide") return { ecritures: [], erreur: "montant" };
  if (!choix.date) return { ecritures: [], erreur: "date" };
  const suite = nature === "moins" ? choix.suite : "solder";
  if (suite !== "solder" && suite !== "plus_tard") return { ecritures: [], erreur: "suite" };
  if (suite === "plus_tard" && !(arrondi(Number(choix.montant)) > 0)) return { ecritures: [], erreur: "montant" };
  // L'écart du dossier soldé : ce qu'il aura reçu en tout moins ce qui était prévu. Sans commission prévue, pas d'écart à justifier.
  const ecart = nature === "libre" ? 0 : arrondi(dossier.dejaRecu + Number(choix.montant) - dossier.prevue);
  const avecMotif = suite === "solder" && ecart !== 0;
  const motif = avecMotif ? choix.motif : null;
  if (avecMotif && !MOTIFS_ECART.some(([k]) => k === motif)) return { ecritures: [], erreur: "motif" };
  const note = avecMotif ? String(choix.note || "").trim().slice(0, NOTE_ECART_MAX) || null : null;
  const moyen = choix.moyen || null;
  const ecritures = repartirSurDossier(dossier, netDe, choix.montant).map(({ reservation, part, recu }) => ({
    reservation_id: reservation.id,
    valeurs:
      suite === "plus_tard"
        ? { commission_recue: arrondi(recu + part), commission_partielle_le: choix.date, commission_recue_moyen: moyen }
        : {
            // Aucune commission prévue sur le dossier : le montant reçu devient la commission du service (comme la commission saisie de Taxi),
            // sinon les statistiques et le dossier y verraient un écart égal à tout le montant.
            ...(nature === "libre" ? { commission_prevue: arrondi(recu + part) } : {}),
            commission_recue: arrondi(recu + part), commission_recue_le: choix.date, commission_recue_moyen: moyen, commission_ecart_motif: motif, commission_ecart_note: note,
          },
  }));
  return { ecritures, erreur: null, ecart, suite };
}

// Annuler une réception (réglée ou versement partiel) : montant, dates, moyen et motif effacés, la commission prévue ne change pas.
export const VALEURS_ANNULATION = { commission_recue: null, commission_recue_le: null, commission_partielle_le: null, commission_recue_moyen: null, commission_ecart_motif: null, commission_ecart_note: null, commission_soldee_par_correction: false };

// Les dossiers dont une commission a été reçue depuis `depuis` (réglée ou versement partiel), par partenaire, pour les revoir ou annuler une erreur.
// Renvoie [{ partenaire_id, dossiers: [{ cle, dossier_id, partenaire_id, reservations, recu, prevue, ecart, le, partiel, motif, note, moyen }] }].
export function recuesParPartenaire(reservations, netDe, { ecartees = new Set(), depuis = "" } = {}) {
  const parCle = new Map();
  for (const r of reservations || []) {
    if (!actif(r, ecartees)) continue;
    const n = netDe(r) || {};
    const le = n.commission_recue_le || (nombre(n.commission_recue) !== null ? n.commission_partielle_le : null);
    if (!le || (depuis && le < depuis)) continue;
    // Soldée par une correction sans rien de reçu (commission ramenée à 0) : rien n'a été encaissé, la ligne n'a pas sa place ici.
    if (n.commission_soldee_par_correction && !(nombre(n.commission_recue) > 0)) continue;
    const cle = `${r.partenaire_id || ""}|${r.dossier_id}`;
    const d = parCle.get(cle) || { cle, dossier_id: r.dossier_id, partenaire_id: r.partenaire_id || null, reservations: [], recu: 0, prevue: 0, le: null, partiel: false, motif: null, note: null, moyen: null, parCorrection: false };
    d.reservations.push(r);
    d.recu += nombre(n.commission_recue) || 0;
    d.prevue += nombre(n.commission_prevue) || 0;
    if (!n.commission_recue_le) d.partiel = true;
    if (!d.le || le > d.le) d.le = le;
    d.motif = d.motif || n.commission_ecart_motif || null;
    d.note = d.note || n.commission_ecart_note || null;
    d.moyen = d.moyen || n.commission_recue_moyen || null;
    if (n.commission_soldee_par_correction) d.parCorrection = true;
    parCle.set(cle, d);
  }
  const parPartenaire = new Map();
  for (const d of parCle.values()) {
    d.recu = arrondi(d.recu);
    d.prevue = arrondi(d.prevue);
    d.ecart = d.partiel ? 0 : arrondi(d.recu - d.prevue);
    const p = parPartenaire.get(d.partenaire_id || "") || { partenaire_id: d.partenaire_id, dossiers: [] };
    p.dossiers.push(d);
    parPartenaire.set(d.partenaire_id || "", p);
  }
  return [...parPartenaire.values()].map((p) => ({ ...p, dossiers: p.dossiers.sort((a, b) => String(b.le).localeCompare(String(a.le))) }));
}

// ---- Corriger une commission, ou le prix et la commission (23.11.2026, migration 119) --------------------------------------------------
// Un cas spécial (remboursement partiel au client, geste commercial, erreur de saisie) : Nani baisse ou monte la commission prévue d'un service,
// ou son prix de vente avec. Le motif est obligatoire ; l'ancien montant reste sur la ligne privée et dans le journal des nets (migration 37).
// Ce qui a déjà été reçu ne bouge jamais : le reste dû devient la nouvelle commission moins le déjà reçu.
// L'écriture passe par la fonction de la base corriger_commission (migration 119), en une transaction : ce fichier en tient les mêmes règles
// pour la feuille (erreurs avant l'envoi, récapitulatif) et pour le mode démo (corrigerLocal).
export const MOTIFS_CORRECTION = [
  ["remboursement_partiel", N_("Remboursement partiel")],
  ["geste_commercial", N_("Geste commercial")],
  ["erreur_saisie", N_("Erreur de saisie")],
  ["autre", N_("Autre")],
];
export const NOTE_CORRECTION_MAX = 200;

const deuxDecimales = (x) => Math.abs(Math.round(x * 100) - x * 100) < 1e-6;
const montantSaisi = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 && deuxDecimales(x) ? arrondi(x) : NaN;
};

// Ce que la feuille a lu à l'ouverture : la base refuse la correction si l'un de ces montants a changé depuis (encaissement, saisie, prix).
export const luCorrection = (r, n) => ({ commission_prevue: nombre((n || {}).commission_prevue), commission_recue: nombre((n || {}).commission_recue), montant_vente: nombre(r.montant_vente) });
const memeLu = (a, b) => ["commission_prevue", "commission_recue", "montant_vente"].every((k) => (a[k] === null ? null : arrondi(a[k])) === (b[k] === null || b[k] === undefined ? null : arrondi(Number(b[k]))));

// La correction d'un service, comme corriger_commission la contrôle. `r` : la réservation, `n` : sa ligne privée (ou null). `choix` :
//   { mode: "commission" | "prix", commission, prix, motif, note }
// Renvoie { erreur } ou { erreur: null, commission, prix (null : inchangé), avant, apres, recu, reste, solde }.
// Erreurs : commission, prix, sous_recu, au_dessus_prix, inchange, motif, note, reglee.
export function correctionCommission(r, n, choix) {
  const net = n || {};
  if (net.commission_recue_le) return { erreur: "reglee" };
  const mode = choix.mode === "prix" ? "prix" : "commission";
  const c = montantSaisi(choix.commission);
  if (c === null || Number.isNaN(c)) return { erreur: "commission" };
  const prixAvant = nombre(r.montant_vente);
  let prixApres = prixAvant;
  if (mode === "prix") {
    const p = montantSaisi(choix.prix);
    if (p === null || Number.isNaN(p) || p <= 0) return { erreur: "prix" };
    prixApres = p;
  }
  const recu = arrondi(nombre(net.commission_recue) || 0);
  if (c < recu) return { erreur: "sous_recu" };
  if (prixApres !== null && c > prixApres) return { erreur: "au_dessus_prix" };
  const avant = nombre(net.commission_prevue);
  const prixChange = mode === "prix" && prixApres !== prixAvant;
  if (avant !== null && arrondi(avant) === c && !prixChange) return { erreur: "inchange" };
  if (!MOTIFS_CORRECTION.some(([k]) => k === choix.motif)) return { erreur: "motif" };
  const note = String(choix.note || "").trim();
  if (note.length > NOTE_CORRECTION_MAX || (choix.motif === "autre" && !note)) return { erreur: "note" };
  return { erreur: null, commission: c, prix: prixChange ? prixApres : null, note: note || null, avant, apres: c, prixAvant, prixApres, recu, reste: arrondi(c - recu), solde: c === recu };
}

// Les valeurs que la correction écrit dans reservations_nets (celles de corriger_commission). Jamais commission_recue : un versement reste tel quel.
// Soldée (nouvelle commission égale au déjà reçu, ou 0 sans rien de reçu) : réglée au jour du dernier versement, ou aujourd'hui.
export function netsCorriges(r, n, res, { motif, ajd, maintenant }) {
  const net = n || {};
  return {
    commission_prevue: res.commission,
    commission_prevue_auto: null,
    commission_avant_correction: nombre(net.commission_prevue),
    prix_avant_correction: res.prix !== null ? nombre(r.montant_vente) : null,
    commission_apres_correction: res.commission,
    commission_corrigee_le: maintenant,
    commission_corrigee_motif: motif,
    commission_corrigee_note: res.note,
    commission_partenaire: null,
    commission_partenaire_le: null,
    commission_recue_le: res.solde ? net.commission_partielle_le || ajd : null,
    commission_soldee_par_correction: res.solde,
  };
}

// La correction est-elle encore en vigueur ? Oui tant que la commission prévue est celle que la correction a posée (sinon : modifiée depuis).
export { correctionEnVigueur } from "./operations-calc.mjs";

// La dernière correction d'un service, pour l'afficher : null s'il n'y en a pas. `modifieeDepuis` : la commission a changé ailleurs ensuite.
export function derniereCorrection(n) {
  if (!n || !n.commission_corrigee_le) return null;
  const posee = nombre(n.commission_apres_correction);
  const actuelle = nombre(n.commission_prevue);
  return {
    le: String(n.commission_corrigee_le).slice(0, 10),
    avant: nombre(n.commission_avant_correction),
    apres: posee === null ? actuelle : posee,
    actuelle,
    modifieeDepuis: posee !== null && (actuelle === null || arrondi(actuelle) !== arrondi(posee)),
    prixAvant: nombre(n.prix_avant_correction),
    motif: n.commission_corrigee_motif || null,
    note: n.commission_corrigee_note || null,
  };
}

// « Commission corrigée le 22/11/2026 : 1 000 → 800, remboursement partiel » ; « …, modifiée depuis : 900 » quand elle a changé ensuite.
// `prix` : le format des montants de l'écran.
export function texteCorrection(n, prix = (x) => String(x)) {
  const c = derniereCorrection(n);
  if (!c) return "";
  const libelle = (MOTIFS_CORRECTION.find(([k]) => k === c.motif) || [])[1];
  const montants = c.avant === null ? prix(c.apres) : `${prix(c.avant)} → ${prix(c.apres)}`;
  return [
    tr("Commission corrigée le {date} : {montants}", { date: formatDate(c.le), montants }),
    c.prixAvant !== null ? tr("prix d'avant {prix}", { prix: prix(c.prixAvant) }) : null,
    [libelle ? tr(libelle) : "", c.note].filter(Boolean).join(" : ") || null,
    c.modifieeDepuis ? tr("modifiée depuis : {montant}", { montant: c.actuelle === null ? tr("aucune") : prix(c.actuelle) }) : null,
  ].filter(Boolean).join(", ");
}

// Ce que devient un document du dossier quand le prix du service change. `taxi` : le prix interne d'une course (contenuCourse).
// Renvoie { contenu: nouveau contenu ou null, raison } ; `raison` dit pourquoi le document garde l'ancien prix :
//   plusieurs_lignes : le service y est réparti sur plusieurs lignes ; quantite : le prix ne se divise pas juste par la quantité de la ligne ;
//   null : il suit (ou le service n'y figure pas).
export function suitePrixDocument(doc, r, montant, { taxi = false, options = {} } = {}) {
  const contenu = doc && doc.contenu;
  if (!contenu) return { contenu: null, raison: null };
  if (taxi) return { contenu: contenuCourse(contenu, { ...r, montant_vente: montant }), raison: null };
  const s = contenuAvecService(contenu, r, { montant_vente: montant }, options);
  const reste = (s.reste || []).find((x) => x.cle === "montant_vente");
  if (!reste) return { contenu: s.contenu, raison: null };
  const ids = new Set([r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean));
  const lignes = (contenu.lignes || []).filter((l) => ids.has(l.id) && l.kind !== "texte" && l.kind !== "remise");
  return { contenu: s.contenu, raison: lignes.length > 1 ? "plusieurs_lignes" : "quantite", lignes: lignes.length, qte: lignes.length === 1 ? Number(lignes[0].qte) || null : null };
}

// ---- Revenir à À encaisser depuis un dossier (23.11.2026) ------------------------------------------------------------------------------
// La liste note sa hauteur, les dossiers cochés et le dossier ouvert ; la fiche de ce dossier propose « À encaisser » tant que la note a moins
// de RETOUR_MINUTES, même après un passage par un document du dossier. La liste la consomme à son retour.
export const CLE_RETOUR = "gestion-encaisser-retour";
export const RETOUR_MINUTES = 10;
export function retourEncaisser(brut, { maintenant = Date.now(), dossierId = null } = {}) {
  let v = null;
  try {
    v = brut ? JSON.parse(brut) : null;
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || !Number.isFinite(v.t) || maintenant - v.t > RETOUR_MINUTES * 60000 || v.t > maintenant + 60000) return null;
  if (dossierId && v.dossierId !== dossierId) return null;
  return { y: Number(v.y) || 0, coches: Array.isArray(v.coches) ? v.coches.filter((c) => typeof c === "string") : [], dossierId: v.dossierId || null };
}

// ---- Mode démo : corriger_commission sur les données du navigateur ---------------------------------------------------------------------
// `data` : les tables de la démo ; `droit(entiteId, code)` ; `args` : { reservationId, entiteId, mode, commission, prix, motif, note, lu, documents }
// (documents : [{ id, updated_at, complet }]). Mêmes refus que la base, avec le même code. Renvoie { nets, reservation, documents, solde }.
export function corrigerLocal(data, droit, args, { ajd, maintenant }) {
  const refus = (code) => {
    throw new Error(`corriger_commission:${code}`);
  };
  const r = (data.reservations || []).find((x) => x.id === args.reservationId);
  if (!r) refus("introuvable");
  if (!args.entiteId || r.entite_id !== args.entiteId) refus("entite");
  if (!(droit(r.entite_id, "partenaires.nets") && droit(r.entite_id, "dossiers.ecrire"))) refus("droits");
  let n = (data.reservations_nets || []).find((x) => x.reservation_id === r.id) || null;
  const lu = args.lu;
  if (!lu || typeof lu !== "object" || Array.isArray(lu) || !["commission_prevue", "commission_recue", "montant_vente"].every((k) => k in lu)) refus("lecture_manquante");
  if (!memeLu(luCorrection(r, n), lu)) refus("change");
  const res = correctionCommission(r, n, { mode: args.prix !== null && args.prix !== undefined ? "prix" : "commission", commission: args.commission, prix: args.prix, motif: args.motif, note: args.note });
  if (res.erreur) refus(res.erreur);
  const documents = args.documents || [];
  if (documents.length && (res.prix === null || !droit(r.entite_id, "documents.ecrire"))) refus("documents");
  const docs = documents.map((d) => {
    const doc = (data.documents || []).find((x) => x.id === d.id);
    if (!doc || doc.dossier_id !== r.dossier_id || doc.entite_id !== r.entite_id || !["facture", "facture_locale", "devis"].includes(doc.type)) refus("documents");
    if (doc.updated_at !== d.updated_at) refus("change");
    return { doc, contenu: d.complet };
  });
  // Tout est contrôlé : les écritures suivent, sans échec possible à mi-chemin.
  if (!n) {
    n = { id: `nets-${r.id}`, entite_id: r.entite_id, reservation_id: r.id, net_prevu: null, net_paye: null, paye_le: null, commission_recue: null, commission_recue_le: null };
    data.reservations_nets.push(n);
  }
  Object.assign(n, netsCorriges(r, n, res, { motif: args.motif, ajd, maintenant }));
  if (res.prix !== null) r.montant_vente = res.prix;
  for (const x of docs) Object.assign(x.doc, { contenu: x.contenu, updated_at: maintenant });
  return { nets: { ...n }, reservation: { id: r.id, montant_vente: r.montant_vente, updated_at: r.updated_at }, documents: docs.map((x) => ({ id: x.doc.id, updated_at: x.doc.updated_at })), solde: res.solde };
}
