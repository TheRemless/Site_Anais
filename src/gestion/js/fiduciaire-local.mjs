// Démonstration : ce que font les fonctions des migrations 28 et 31 (fiduciaire_a_preparer, emettre_facture_fiduciaire, annuler_facture_fiduciaire,
// marquer_envoyee_fiduciaire, fiduciaire_calcul), sur les données du navigateur. Mêmes règles, mêmes messages d'erreur ; le calcul vient de fiduciaire-calc.mjs.
import { cibleAgence, aEmettre, libelleFacture, formaterNumero, reglagesFid, partRemise, parDestinataire, cleDestinataire, prefixeDe } from "./fiduciaire-calc.mjs";

// L'écran existe pour les entreprises en mode excursions ou taxi ; les factures ne s'y émettent que si le réglage « actif » est vrai (faux par défaut en Taxi).
const concernee = (data, entiteId) => ["excursions", "taxi"].includes(((data.reglages || {})[entiteId] || {}).fonctionnement);
const fid = (data, entiteId) => reglagesFid((data.reglages || {})[entiteId]);
// Date de départ (réglage de l'entreprise, fiduciaire.depuis) : un service dont la date de réception est antérieure, jamais facturé, n'est pas proposé.
const depuis = (data, entiteId) => fid(data, entiteId).depuis || null;
const pick = (o, cles) => Object.fromEntries(cles.filter((k) => o && o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]]));
const arrondi = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const idsLignes = (r) => [r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean);

// Le prestataire du service, s'il appartient à la même entreprise (sinon il n'est pas reconnu comme destinataire).
const partenaireDe = (data, r) => data.partenaires.find((x) => x.id === r.partenaire_id && x.entite_id === r.entite_id) || null;

// Part de la remise : la facture du client la plus récente du dossier qui porte une ligne du service.
function remiseDe(data, r) {
  const ids = new Set(idsLignes(r));
  if (!ids.size) return 0;
  const doc = (data.documents || [])
    .filter((x) => x.dossier_id === r.dossier_id && x.type === "facture" && ((x.contenu || {}).lignes || []).some((l) => ids.has(l.id)))
    .sort((a, b) => String(b.date_emission || "").localeCompare(String(a.date_emission || "")) || String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
  return doc ? partRemise(doc.contenu, [...ids], r.montant_vente) : 0;
}

function entree(data, resumeDe, r) {
  const n = data.reservations_nets.find((x) => x.reservation_id === r.id) || {};
  const d = data.dossiers.find((x) => x.id === r.dossier_id);
  const rs = d ? resumeDe(d) : null;
  const dates = data.paiements.filter((p) => p.dossier_id === r.dossier_id).map((p) => p.date).sort();
  const partenaire = partenaireDe(data, r);
  const { deja, anciens } = parDestinataire(data.fiduciaire_factures.filter((f) => f.reservation_id === r.id), partenaire);
  return {
    reservation: { statut: r.statut, paye_sur_place: !!r.paye_sur_place, montant_vente: r.montant_vente === null || r.montant_vente === undefined ? null : Number(r.montant_vente), remise: remiseDe(data, r), dossier_annule: !!(d && d.annule) },
    net: n,
    paiement: rs ? { regle: Number(rs.total) > 0 && Number(rs.recu) >= Number(rs.total), date: dates.length ? dates[dates.length - 1] : null } : null,
    deja,
    anciens,
    partenaire,
  };
}

const destinataire = (p) => (p ? { nom: p.nom, adresse: ((p.contact || {}).adresse || "").trim() } : null);

function libelleDe(data, r, cas) {
  const d = data.dossiers.find((x) => x.id === r.dossier_id) || {};
  const c = data.clients.find((x) => x.id === d.client_id) || {};
  return libelleFacture(r, { dossierRef: d.ref || "", prenom: c.prenom || "", nom: c.nom || "", cas, reglages: data.reglages[r.entite_id] });
}

// Prochain numéro d'une série (préfixe et année), sans trou.
const prochainSeq = (data, prefixe, annee) => Math.max(0, ...data.fiduciaire_factures.filter((f) => String(f.numero).startsWith(`${prefixe}-${annee}-`)).map((f) => f.seq)) + 1;

// Copie de l'émetteur le jour de l'émission : l'identité de l'entreprise du service, son compte, son QR code (apparence) et les titres de la fiduciaire.
function copieEmetteur(data, entiteId) {
  const reg = data.reglages[entiteId] || {};
  const f = reglagesFid(reg);
  const app = reg.apparence || {};
  return {
    entite_id: entiteId,
    emetteur: pick(reg.emetteur, ["nom", "sous_titre", "adresse", "telephone", "licence", "contact"]),
    paiement: { ...pick(reg.paiement, ["nom", "texte"]), qr_image: app.qr_image || "", qr_pseudo: app.qr_pseudo || "" },
    titres: { facture: f.titre_facture, avoir: f.titre_avoir, ref_facture: f.ref_facture, ref_avoir: f.ref_avoir },
  };
}

// Ce qu'il y a à préparer pour les entreprises où la personne a « fiduciaire.preparer ». Aucun net ; l'écart seulement avec « partenaires.nets ».
export function aPreparerLocal(data, { droit, resumeDe, voit }) {
  const lignes = [];
  const candidates = data.reservations
    .filter((r) => concernee(data, r.entite_id) && droit(r.entite_id, "fiduciaire.preparer") && voit(r.entite_id, r.dossier_id))
    .filter((r) => data.reservations_nets.some((n) => n.reservation_id === r.id && (Number(n.commission_recue) > 0 || (n.net_paye !== null && n.net_paye !== undefined))) || data.fiduciaire_factures.some((f) => f.reservation_id === r.id))
    .sort((a, b) => String(a.date_service || "9999").localeCompare(String(b.date_service || "9999")));
  for (const r of candidates) {
    const e = entree(data, resumeDe, r);
    const cible = cibleAgence(e.reservation, e.net, e.paiement, e.deja);
    let emission = aEmettre(cible, e.deja);
    // Entreprise sans factures pour la fiduciaire (Taxi) : aucune nouvelle facture, seulement la correction de ce qui existe.
    if (emission.type === "facture" && !fid(data, r.entite_id).actif) emission = { type: null, montant: 0 };
    const avant = e.deja === 0 && cible.date && depuis(data, r.entite_id) && cible.date < depuis(data, r.entite_id);
    const base = { reservation_id: r.id, entite_id: r.entite_id, entite_slug: (data.entites.find((x) => x.id === r.entite_id) || {}).slug, libelle: libelleDe(data, r, cible.cas), date_service: r.date_service || null, devise: ((data.reglages[r.entite_id] || {}).devise) || "THB", cas: cible.cas };
    if (!avant && (emission.type || cible.a_revoir)) {
      const dest = destinataire(e.partenaire);
      lignes.push({
        ...base,
        destinataire_cle: e.partenaire ? e.partenaire.id : null,
        destinataire_nom: dest ? dest.nom : null,
        destinataire_adresse: dest ? dest.adresse : null,
        type: emission.type,
        montant: emission.montant,
        date_cible: cible.date,
        ecart: droit(r.entite_id, "partenaires.nets") ? cible.ecart : null,
        a_revoir: cible.a_revoir,
        manque: cible.manque,
        deja_facture: e.deja,
      });
    }
    // Le prestataire a changé : l'ancien garde une facture pour ce service, à annuler par un avoir (réservé aux responsables).
    if (droit(r.entite_id, "fiduciaire.gerer")) {
      for (const a of e.anciens) lignes.push({ ...base, destinataire_cle: a.cle, destinataire_nom: a.nom, destinataire_adresse: a.adresse, type: null, montant: 0, date_cible: null, ecart: null, a_revoir: true, manque: ["partenaire_change"], deja_facture: a.total });
    }
  }
  // Services supprimés mais encore facturés : à annuler par un avoir, destinataire par destinataire (réservé aux responsables).
  const ids = new Set(data.reservations.map((r) => r.id));
  const orphelins = new Map();
  for (const f of data.fiduciaire_factures) {
    if (!f.reservation_id || ids.has(f.reservation_id) || !droit(f.entite_id, "fiduciaire.gerer")) continue;
    const cle = `${f.reservation_id}|${cleDestinataire(f)}`;
    orphelins.set(cle, [...(orphelins.get(cle) || []), f]);
  }
  for (const fs of orphelins.values()) {
    const total = arrondi(fs.reduce((x, f) => x + Number(f.montant), 0));
    if (!total) continue;
    const derniere = fs[fs.length - 1];
    lignes.push({ reservation_id: derniere.reservation_id, entite_id: derniere.entite_id, entite_slug: derniere.entite_slug, libelle: derniere.libelle, date_service: null, destinataire_cle: cleDestinataire(derniere), destinataire_nom: derniere.destinataire.nom, destinataire_adresse: derniere.destinataire.adresse, devise: derniere.devise, type: null, montant: 0, date_cible: null, cas: derniere.cas, ecart: null, a_revoir: true, manque: ["service_supprime"], deja_facture: total });
  }
  return lignes;
}

// Émet la facture ou l'avoir d'un service. Les messages d'erreur sont ceux de la base.
export function emettreLocal(data, { droit, resumeDe, voit, utilisateurId, aujourdhui }, reservationId, dateAvoir = null, attendu = null) {
  const r = data.reservations.find((x) => x.id === reservationId);
  if (!r) throw new Error("Service introuvable : s'il est supprimé et déjà facturé, annulez la facture par un avoir");
  const entite = data.entites.find((x) => x.id === r.entite_id);
  if (!concernee(data, r.entite_id)) throw new Error("Les factures pour la fiduciaire ne concernent que les entreprises d'excursions");
  if (!(droit(r.entite_id, "fiduciaire.preparer") && voit(r.entite_id, r.dossier_id))) throw new Error("Droit insuffisant");
  const e = entree(data, resumeDe, r);
  const cible = cibleAgence(e.reservation, e.net, e.paiement, e.deja);
  if (!cible.pret) throw new Error(`Rien à facturer pour ce service : ${cible.manque.join(", ") || "à revoir"}`);
  const emission = aEmettre(cible, e.deja);
  if (e.deja === 0 && depuis(data, r.entite_id) && cible.date < depuis(data, r.entite_id)) throw new Error(`Ce service est antérieur à la date de départ des factures pour la fiduciaire (${depuis(data, r.entite_id)})`);
  if (!emission.type) throw new Error("Ce service est déjà facturé pour ce montant");
  if (attendu && attendu !== emission.type) throw new Error("La situation de ce service a changé depuis l'affichage : rechargez l'écran");
  if (emission.type === "facture" && !fid(data, r.entite_id).actif) throw new Error(`${entite.nom} n'émet pas de factures pour la fiduciaire (réglage de l'écran Fiduciaire)`);
  if (emission.type === "avoir" && !droit(r.entite_id, "fiduciaire.gerer")) throw new Error("Seuls les responsables émettent un avoir");
  const dest = destinataire(e.partenaire);
  if (!dest) throw new Error("Ce service n'a pas de prestataire : le destinataire de la facture manque");
  if (!dest.adresse) throw new Error(`L'adresse de ${dest.nom} manque dans sa fiche partenaire`);
  const reg = data.reglages[r.entite_id] || {};
  const precedenteFacture = [...data.fiduciaire_factures].reverse().find((f) => f.reservation_id === r.id && f.type === "facture" && cleDestinataire(f) === e.partenaire.id);
  if (emission.type === "facture" && cible.date > aujourdhui) throw new Error(`La date de réception (${cible.date}) est dans le futur : corrigez-la avant de facturer`);
  const jour = emission.type === "facture" ? cible.date : dateAvoir || aujourdhui;
  if (emission.type === "avoir" && (jour > aujourdhui || (precedenteFacture && jour < precedenteFacture.date_facture))) throw new Error("La date de l'avoir doit se situer entre la date de la facture et aujourd'hui");
  const annee = Number(String(jour).slice(0, 4));
  const prefixe = prefixeDe(emission.type, reg);
  const seq = prochainSeq(data, prefixe, annee);
  const precedente = emission.type === "avoir" ? precedenteFacture : null;
  const ligne = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    entite_id: r.entite_id,
    entite_slug: entite.slug,
    reservation_id: r.id,
    type: emission.type,
    annee,
    seq,
    numero: formaterNumero(emission.type, annee, seq, prefixe),
    date_facture: jour,
    montant: emission.type === "avoir" ? -emission.montant : emission.montant,
    devise: reg.devise || "THB",
    libelle: libelleDe(data, r, cible.cas),
    cas: cible.cas,
    destinataire: dest,
    destinataire_id: e.partenaire.id,
    emetteur: copieEmetteur(data, r.entite_id),
    avoir_de: precedente ? precedente.id : null,
    avoir_de_numero: precedente ? precedente.numero : null,
    envoyee_le: null,
    envoyee_par: null,
    cree_par: utilisateurId,
  };
  data.fiduciaire_factures.push(ligne);
  return ligne.id;
}

// Annule par un avoir tout ce qui a été facturé pour un service à un destinataire (responsables seulement).
// `cle` : le destinataire (identifiant du partenaire, ou « nom:… » pour une ancienne facture) ; facultative quand un seul destinataire a un total non nul.
export function annulerLocal(data, { droit, aujourdhui }, reservationId, date = null, cle = null) {
  const factures = data.fiduciaire_factures.filter((f) => f.reservation_id === reservationId);
  const groupes = new Map();
  for (const f of factures) groupes.set(cleDestinataire(f), [...(groupes.get(cleDestinataire(f)) || []), f]);
  const ouverts = [...groupes.entries()].filter(([, fs]) => arrondi(fs.reduce((s, f) => s + Number(f.montant), 0)) !== 0);
  let choisis;
  if (cle) choisis = groupes.get(cle) || [];
  else if (ouverts.length > 1) throw new Error("Ce service est facturé à plusieurs prestataires : choisissez celui dont la facture s'annule");
  else choisis = ouverts.length ? ouverts[0][1] : factures;
  const derniere = [...choisis].reverse().find((f) => f.type === "facture");
  if (!derniere) throw new Error("Aucune facture pour ce service");
  if (!droit(derniere.entite_id, "fiduciaire.gerer")) throw new Error("Seuls les responsables émettent un avoir");
  const total = arrondi(choisis.reduce((s, f) => s + Number(f.montant), 0));
  if (total <= 0) throw new Error("Rien à annuler : le total facturé pour ce service est déjà à zéro");
  const jour = date || aujourdhui;
  if (jour > aujourdhui || jour < derniere.date_facture) throw new Error("La date de l'avoir doit se situer entre la date de la facture et aujourd'hui");
  const annee = Number(String(jour).slice(0, 4));
  const prefixe = prefixeDe("avoir", data.reglages[derniere.entite_id]);
  const seq = prochainSeq(data, prefixe, annee);
  const ligne = { ...structuredClone(derniere), id: crypto.randomUUID(), created_at: new Date().toISOString(), type: "avoir", annee, seq, numero: formaterNumero("avoir", annee, seq, prefixe), date_facture: jour, montant: -total, avoir_de: derniere.id, avoir_de_numero: derniere.numero, envoyee_le: null, envoyee_par: null };
  data.fiduciaire_factures.push(ligne);
  return ligne.id;
}

export function envoyerLocal(data, { droit, utilisateurId, aujourdhui }, ids, date) {
  if (date && aujourdhui && date > aujourdhui) throw new Error("La date d'envoi ne peut pas être dans le futur");
  let n = 0;
  for (const f of data.fiduciaire_factures.filter((x) => ids.includes(x.id))) {
    if (!droit(f.entite_id, "fiduciaire.preparer")) throw new Error("Droit insuffisant");
    if ((!date || f.envoyee_le) && !droit(f.entite_id, "fiduciaire.gerer")) throw new Error("Seuls les responsables retirent ou corrigent la mention d'envoi");
    f.envoyee_le = date || null;
    f.envoyee_par = date ? utilisateurId : null;
    n++;
  }
  return n;
}

// « Revoir le calcul » : le détail avec les nets, pour « fiduciaire.gerer » et « partenaires.nets ».
export function calculLocal(data, { droit, resumeDe, voit }, reservationId) {
  const r = data.reservations.find((x) => x.id === reservationId);
  if (!r) return null;
  if (!(droit(r.entite_id, "fiduciaire.gerer") && droit(r.entite_id, "partenaires.nets") && voit(r.entite_id, r.dossier_id))) throw new Error("Droit insuffisant");
  const e = entree(data, resumeDe, r);
  const c = cibleAgence(e.reservation, e.net, e.paiement, e.deja);
  const n = e.net;
  return { cas: c.cas, montant_vente: e.reservation.montant_vente, remise: e.reservation.remise || 0, dossier_annule: e.reservation.dossier_annule, net_prevu: n.net_prevu ?? null, net_paye: n.net_paye ?? null, paye_le: n.paye_le ?? null, commission_prevue: n.commission_prevue ?? null, commission_recue: n.commission_recue ?? null, commission_recue_le: n.commission_recue_le ?? null, cible: c.cible, date: c.date, deja_facture: e.deja, pret: c.pret, manque: c.manque, ecart: c.ecart, a_revoir: c.a_revoir };
}

export const facturesVisibles = (data, { droit, voit }) => data.fiduciaire_factures.filter((f) => droit(f.entite_id, "fiduciaire.preparer") && (voit(f.entite_id, (data.reservations.find((r) => r.id === f.reservation_id) || {}).dossier_id))).sort((a, b) => (a.numero < b.numero ? 1 : -1));
