// Démonstration : ce que font les fonctions de la migration 28 (fiduciaire_a_preparer, emettre_facture_fiduciaire, marquer_envoyee_fiduciaire, fiduciaire_calcul),
// sur les données du navigateur. Mêmes règles, mêmes messages d'erreur ; le calcul vient de fiduciaire-calc.mjs.
import { cibleAgence, aEmettre, libelleFacture, formaterNumero } from "./fiduciaire-calc.mjs";

const eligible = (data, entiteId) => ["excursions", "taxi"].includes(((data.reglages || {})[entiteId] || {}).fonctionnement);
// Date de départ (réglages de Secret, fiduciaire.depuis) : un service dont la date de réception est antérieure, jamais facturé, n'est pas proposé.
const depuis = (data) => { const secret = data.entites.find((x) => ["secret", "excursions"].includes(x.slug)); return ((((data.reglages || {})[secret && secret.id] || {}).fiduciaire) || {}).depuis || null; };
const arrondi = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function entree(data, resumeDe, r) {
  const n = data.reservations_nets.find((x) => x.reservation_id === r.id) || {};
  const d = data.dossiers.find((x) => x.id === r.dossier_id);
  const rs = d ? resumeDe(d) : null;
  const dates = data.paiements.filter((p) => p.dossier_id === r.dossier_id).map((p) => p.date).sort();
  const deja = arrondi(data.fiduciaire_factures.filter((f) => f.reservation_id === r.id).reduce((s, f) => s + Number(f.montant), 0));
  return {
    reservation: { statut: r.statut, paye_sur_place: !!r.paye_sur_place, montant_vente: r.montant_vente === null || r.montant_vente === undefined ? null : Number(r.montant_vente) },
    net: n,
    paiement: rs ? { regle: Number(rs.total) > 0 && Number(rs.recu) >= Number(rs.total), date: dates.length ? dates[dates.length - 1] : null } : null,
    deja,
  };
}

function destinataire(data, r) {
  const p = data.partenaires.find((x) => x.id === r.partenaire_id);
  return p ? { nom: p.nom, adresse: ((p.contact || {}).adresse || "").trim() } : null;
}

function libelleDe(data, r) {
  const d = data.dossiers.find((x) => x.id === r.dossier_id) || {};
  const c = data.clients.find((x) => x.id === d.client_id) || {};
  return libelleFacture(r, { dossierRef: d.ref || "", prenom: c.prenom || "", nom: c.nom || "" });
}

// Ce qu'il y a à préparer pour les entreprises où la personne a « fiduciaire.preparer ». Aucun net ; l'écart seulement avec « partenaires.nets ».
export function aPreparerLocal(data, { droit, resumeDe }) {
  const lignes = [];
  const candidates = data.reservations
    .filter((r) => eligible(data, r.entite_id) && droit(r.entite_id, "fiduciaire.preparer"))
    .filter((r) => data.reservations_nets.some((n) => n.reservation_id === r.id && (Number(n.commission_recue) > 0 || (n.net_paye !== null && n.net_paye !== undefined))) || data.fiduciaire_factures.some((f) => f.reservation_id === r.id))
    .sort((a, b) => String(a.date_service || "9999").localeCompare(String(b.date_service || "9999")));
  for (const r of candidates) {
    const e = entree(data, resumeDe, r);
    const cible = cibleAgence(e.reservation, e.net, e.paiement, e.deja);
    const emission = aEmettre(cible, e.deja);
    if (e.deja === 0 && cible.date && depuis(data) && cible.date < depuis(data)) continue;
    if (!emission.type && !cible.a_revoir) continue;
    const dest = destinataire(data, r);
    lignes.push({
      reservation_id: r.id,
      entite_id: r.entite_id,
      entite_slug: (data.entites.find((x) => x.id === r.entite_id) || {}).slug,
      libelle: libelleDe(data, r),
      date_service: r.date_service || null,
      destinataire_nom: dest ? dest.nom : null,
      destinataire_adresse: dest ? dest.adresse : null,
      devise: ((data.reglages[r.entite_id] || {}).devise) || "THB",
      type: emission.type,
      montant: emission.montant,
      date_cible: cible.date,
      cas: cible.cas,
      ecart: droit(r.entite_id, "partenaires.nets") ? cible.ecart : null,
      a_revoir: cible.a_revoir,
      manque: cible.manque,
    });
  }
  return lignes;
}

// Émet la facture ou l'avoir d'un service. Les messages d'erreur sont ceux de la base.
export function emettreLocal(data, { droit, resumeDe, utilisateurId, aujourdhui }, reservationId, dateAvoir = null) {
  const r = data.reservations.find((x) => x.id === reservationId);
  if (!r) throw new Error("Service introuvable");
  const entite = data.entites.find((x) => x.id === r.entite_id);
  if (!eligible(data, r.entite_id)) throw new Error("Les factures pour la fiduciaire ne concernent que Secret et VIP Taxi Lanta");
  if (!droit(r.entite_id, "fiduciaire.preparer")) throw new Error("Droit insuffisant");
  const e = entree(data, resumeDe, r);
  const cible = cibleAgence(e.reservation, e.net, e.paiement, e.deja);
  if (!cible.pret) throw new Error(`Rien à facturer pour ce service : ${cible.manque.join(", ") || "à revoir"}`);
  const emission = aEmettre(cible, e.deja);
  if (e.deja === 0 && depuis(data) && cible.date < depuis(data)) throw new Error(`Ce service est antérieur à la date de départ des factures pour la fiduciaire (${depuis(data)})`);
  if (!emission.type) throw new Error("Ce service est déjà facturé pour ce montant");
  if (emission.type === "avoir" && !droit(r.entite_id, "fiduciaire.gerer")) throw new Error("Seuls les responsables émettent un avoir");
  const dest = destinataire(data, r);
  if (!dest) throw new Error("Ce service n'a pas de prestataire : le destinataire de la facture manque");
  if (!dest.adresse) throw new Error(`L'adresse de ${dest.nom} manque dans sa fiche partenaire`);
  const secret = data.entites.find((x) => ["secret", "excursions"].includes(x.slug)) || entite;
  const reg = data.reglages[secret.id] || {};
  const jour = emission.type === "facture" ? cible.date : dateAvoir || aujourdhui;
  const annee = Number(String(jour).slice(0, 4));
  const seq = Math.max(0, ...data.fiduciaire_factures.filter((f) => f.type === emission.type && f.annee === annee).map((f) => f.seq)) + 1;
  const precedente = emission.type === "avoir" ? [...data.fiduciaire_factures].reverse().find((f) => f.reservation_id === r.id && f.type === "facture") : null;
  const ligne = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    entite_id: r.entite_id,
    entite_slug: entite.slug,
    reservation_id: r.id,
    type: emission.type,
    annee,
    seq,
    numero: formaterNumero(emission.type, annee, seq),
    date_facture: jour,
    montant: emission.type === "avoir" ? -emission.montant : emission.montant,
    devise: reg.devise || "THB",
    libelle: libelleDe(data, r),
    cas: cible.cas,
    destinataire: dest,
    emetteur: { emetteur: structuredClone(reg.emetteur || {}), paiement: structuredClone(reg.paiement || {}) },
    avoir_de: precedente ? precedente.id : null,
    avoir_de_numero: precedente ? precedente.numero : null,
    envoyee_le: null,
    envoyee_par: null,
    cree_par: utilisateurId,
  };
  data.fiduciaire_factures.push(ligne);
  return ligne.id;
}

export function envoyerLocal(data, { droit, utilisateurId }, ids, date) {
  let n = 0;
  for (const f of data.fiduciaire_factures.filter((x) => ids.includes(x.id))) {
    if (!droit(f.entite_id, "fiduciaire.preparer")) throw new Error("Droit insuffisant");
    if (!date && !droit(f.entite_id, "fiduciaire.gerer")) throw new Error("Seuls les responsables retirent la mention d'envoi");
    f.envoyee_le = date || null;
    f.envoyee_par = date ? utilisateurId : null;
    n++;
  }
  return n;
}

// « Revoir le calcul » : le détail avec les nets, pour « fiduciaire.gerer » et « partenaires.nets ».
export function calculLocal(data, { droit, resumeDe }, reservationId) {
  const r = data.reservations.find((x) => x.id === reservationId);
  if (!r) return null;
  if (!(droit(r.entite_id, "fiduciaire.gerer") && droit(r.entite_id, "partenaires.nets"))) throw new Error("Droit insuffisant");
  const e = entree(data, resumeDe, r);
  const c = cibleAgence(e.reservation, e.net, e.paiement, e.deja);
  const n = e.net;
  return { cas: c.cas, montant_vente: e.reservation.montant_vente, net_prevu: n.net_prevu ?? null, net_paye: n.net_paye ?? null, paye_le: n.paye_le ?? null, commission_prevue: n.commission_prevue ?? null, commission_recue: n.commission_recue ?? null, commission_recue_le: n.commission_recue_le ?? null, cible: c.cible, date: c.date, deja_facture: e.deja, pret: c.pret, manque: c.manque, ecart: c.ecart, a_revoir: c.a_revoir };
}

export const facturesVisibles = (data, { droit }) => data.fiduciaire_factures.filter((f) => droit(f.entite_id, "fiduciaire.preparer")).sort((a, b) => (a.numero < b.numero ? 1 : -1));
