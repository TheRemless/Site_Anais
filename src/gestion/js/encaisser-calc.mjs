// Encaisser les commissions des partenaires, dossier par dossier (20.11.2026, migration 57).
// Un partenaire a souvent plusieurs dossiers en cours : Anaïs coche ceux qu'il a payés, voit le total coché et encaisse la sélection d'un geste.
// Chaque dossier reçoit son propre enregistrement (date, moyen), sur chacun de ses services payés sur place chez ce partenaire.
// Rien ici ne touche à l'écran ni à la base : les vues appellent ces fonctions puis écrivent les lignes de `reservations_nets` rendues.
import { arrondi } from "./calc.mjs";
import { N_ } from "./i18n.mjs";

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
export const VALEURS_ANNULATION = { commission_recue: null, commission_recue_le: null, commission_partielle_le: null, commission_recue_moyen: null, commission_ecart_motif: null, commission_ecart_note: null };

// Les dossiers dont une commission a été reçue depuis `depuis` (réglée ou versement partiel), par partenaire, pour les revoir ou annuler une erreur.
// Renvoie [{ partenaire_id, dossiers: [{ cle, dossier_id, partenaire_id, reservations, recu, prevue, ecart, le, partiel, motif, note, moyen }] }].
export function recuesParPartenaire(reservations, netDe, { ecartees = new Set(), depuis = "" } = {}) {
  const parCle = new Map();
  for (const r of reservations || []) {
    if (!actif(r, ecartees)) continue;
    const n = netDe(r) || {};
    const le = n.commission_recue_le || (nombre(n.commission_recue) !== null ? n.commission_partielle_le : null);
    if (!le || (depuis && le < depuis)) continue;
    const cle = `${r.partenaire_id || ""}|${r.dossier_id}`;
    const d = parCle.get(cle) || { cle, dossier_id: r.dossier_id, partenaire_id: r.partenaire_id || null, reservations: [], recu: 0, prevue: 0, le: null, partiel: false, motif: null, note: null, moyen: null };
    d.reservations.push(r);
    d.recu += nombre(n.commission_recue) || 0;
    d.prevue += nombre(n.commission_prevue) || 0;
    if (!n.commission_recue_le) d.partiel = true;
    if (!d.le || le > d.le) d.le = le;
    d.motif = d.motif || n.commission_ecart_motif || null;
    d.note = d.note || n.commission_ecart_note || null;
    d.moyen = d.moyen || n.commission_recue_moyen || null;
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
