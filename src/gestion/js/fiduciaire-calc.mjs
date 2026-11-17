// Factures pour la fiduciaire : ce qui revient à l'agence sur chaque service, jamais ce que le client a payé en tout.
// Fonctions pures. La base calcule la même chose de son côté (migration 28, fonction fiduciaire_cible) : docs/gestion/verif-fiduciaire.mjs
// fait tourner les deux sur les mêmes cas et vérifie qu'elles donnent le même montant.
//
// Règles (Jérémy, 12.11.2026) :
//   service payé sur place    -> la commission reçue du prestataire (reservations_nets.commission_recue), datée du jour de réception ;
//   service payé chez nous    -> la marge : prix de vente moins net payé au prestataire, datée du plus tardif du paiement du client et du paiement du prestataire ;
//   rien n'est facturé tant que rien n'est reçu ; une commission partielle se facture pour ce qui est reçu, le complément plus tard ;
//   un montant déjà facturé n'est jamais modifié : un écart se corrige par une facture de complément ou par un avoir.
// Règles (Jérémy, 17.11.2026, lot H) :
//   une remise sur la facture du client baisse la marge déclarée (sa part, au prorata du prix de vente du service) ;
//   un dossier annulé se traite comme un service annulé, même si ses réservations ne sont pas annulées ;
//   « déjà facturé » se compte par destinataire : quand le prestataire d'un service change, l'ancien garde sa facture jusqu'à l'avoir, le nouveau reçoit tout ;
//   Taxi n'a pas de facture pour la fiduciaire (réglage « actif » de l'entreprise, faux par défaut en mode taxi).

const arrondi = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const nombre = (x) => (x === null || x === undefined || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
const plusTard = (a, b) => (a && b ? (a > b ? a : b) : a || b || null);

// Réglages de la fiduciaire d'une entreprise (reglages.fiduciaire), avec leurs valeurs par défaut. La base applique les mêmes (fiduciaire_reglages).
// `actif` : sans réglage, actif en mode excursions (Secret), inactif en mode taxi (décision du 17.11.2026 : pas de facture pour les courses de Taxi).
export const FID_DEFAUT = {
  depuis: "",
  prefixe_facture: "COM",
  prefixe_avoir: "CN",
  titre_facture: "INVOICE",
  titre_avoir: "CREDIT NOTE",
  ref_facture: "Invoice no.",
  ref_avoir: "Credit note no.",
  mot_commission: "Commission on",
  mot_marge: "Margin on",
};
const texte = (v, defaut) => (typeof v === "string" && v.trim() ? v.trim() : defaut);
export function reglagesFid(reglages) {
  const r = reglages || {};
  const f = r.fiduciaire || {};
  const out = { actif: typeof f.actif === "boolean" ? f.actif : r.fonctionnement === "excursions" };
  for (const [k, v] of Object.entries(FID_DEFAUT)) out[k] = texte(f[k], v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.depuis)) out.depuis = "";
  return out;
}

// Part de la remise de la facture du client qui revient à un service : la remise baisse le total payé par le client, donc la marge.
// Même calcul que total_document (migration 18) : les remises en pourcentage portent sur le total sans les lignes payées sur place.
// contenu : la facture du client qui porte les lignes du service ; ids : les lignes du service (ligne_id, details.lignes_ids) ; vente : son prix de vente.
const estNombre = (v) => v !== null && v !== undefined && v !== "" && /^-?[0-9]+(\.[0-9]+)?$/.test(String(v).trim());
const brutLigne = (l) => (l.paye_sur_place ? 0 : estNombre(l.unite) && estNombre(l.qte) ? arrondi(Number(l.unite) * Number(l.qte)) : estNombre(l.montant) ? arrondi(Number(l.montant)) : 0);
export function partRemise(contenu, ids, vente) {
  const lignes = (contenu && contenu.lignes) || [];
  const v = nombre(vente);
  const cles = new Set((ids || []).filter(Boolean));
  if (!(v > 0) || !lignes.some((l) => cles.has(l.id))) return 0;
  const sousTotal = arrondi(lignes.filter((l) => (l.kind || "ligne") !== "remise" && l.kind !== "texte").reduce((s, l) => s + brutLigne(l), 0));
  if (!(sousTotal > 0)) return 0;
  const remises = arrondi(lignes.filter((l) => l.kind === "remise").reduce((s, l) => s + (estNombre(l.pct) ? arrondi((sousTotal * Number(l.pct)) / 100) : brutLigne(l)), 0));
  if (!(remises > 0)) return 0;
  return Math.min(v, arrondi((v * remises) / sousTotal));
}

// reservation : { statut, paye_sur_place, montant_vente, remise (part de la remise, 0 par défaut), dossier_annule }
// net         : { net_paye, paye_le, commission_prevue, commission_recue, commission_recue_le } (ou null sans le droit « nets » : le calcul se fait alors dans la base)
// paiement    : { regle, date } pour le client : tout payé, et date du dernier paiement
// deja        : montant déjà facturé pour ce service au prestataire actuel (factures moins avoirs)
// Renvoie { cas, cible, date, pret, manque, ecart, a_revoir } : `cible` est le montant total qui doit avoir été facturé pour ce service.
// `manque` : codes de ce qui empêche de facturer (commission_non_recue, date_reception, prix_vente, client_non_solde, prestataire_non_paye, marge_nulle), traduits par l'écran.
export function cibleAgence(reservation, net, paiement, deja = 0) {
  const r = reservation || {};
  const n = net || {};
  const dejaFacture = arrondi(deja || 0);
  const sortie = { cas: r.paye_sur_place ? "sur_place" : "chez_nous", cible: 0, date: null, pret: false, manque: [], ecart: null, a_revoir: false };

  if (r.paye_sur_place) {
    // Ce que le prestataire a reversé fait foi, même si le service a été annulé ensuite.
    const recue = nombre(n.commission_recue);
    const prevue = nombre(n.commission_prevue);
    if (!(recue > 0)) sortie.manque.push("commission_non_recue");
    else if (!n.commission_recue_le) sortie.manque.push("date_reception");
    else {
      sortie.cible = arrondi(recue);
      sortie.date = n.commission_recue_le;
      sortie.pret = true;
      if (prevue !== null) sortie.ecart = arrondi(recue - prevue);
    }
  } else if (r.statut === "annule" || r.dossier_annule) {
    // Annulé et remboursé (le service ou tout le dossier) : plus de marge. S'il y avait une facture, un avoir la ramène à zéro.
    sortie.pret = dejaFacture > 0;
  } else {
    const brute = nombre(r.montant_vente);
    const vente = brute === null ? null : arrondi(brute - (nombre(r.remise) || 0));
    const netPaye = nombre(n.net_paye);
    if (vente === null) sortie.manque.push("prix_vente");
    if (!paiement || !paiement.regle) sortie.manque.push("client_non_solde");
    if (netPaye === null || !n.paye_le) sortie.manque.push("prestataire_non_paye");
    if (!sortie.manque.length) {
      const marge = arrondi(vente - netPaye);
      if (marge <= 0) sortie.manque.push("marge_nulle");
      else {
        sortie.cible = marge;
        sortie.date = plusTard(paiement.date, n.paye_le);
        sortie.pret = true;
      }
    }
  }
  // Déjà facturé, mais la situation ne permet plus de dire combien revient à l'agence : une personne regarde, rien ne part tout seul.
  sortie.a_revoir = !sortie.pret && dejaFacture > 0;
  return sortie;
}

// Ce qu'il faut émettre pour amener le total facturé au montant dû : une facture du complément, un avoir de l'excédent, ou rien.
export function aEmettre(cible, deja = 0) {
  if (!cible || !cible.pret) return { type: null, montant: 0 };
  const ecart = arrondi(cible.cible - (deja || 0));
  if (ecart > 0) return { type: "facture", montant: ecart };
  if (ecart < 0) return { type: "avoir", montant: arrondi(-ecart) };
  return { type: null, montant: 0 };
}

// items : [{ reservation, net, paiement, deja }] -> les lignes qui ont quelque chose à émettre, avec le calcul.
export function aPreparer(items) {
  const lignes = [];
  for (const it of items) {
    const cible = cibleAgence(it.reservation, it.net, it.paiement, it.deja || 0);
    const emission = aEmettre(cible, it.deja || 0);
    if (emission.type) lignes.push({ ...it, cible, emission });
  }
  return lignes;
}

// « Jane Example » -> « J.E. ». Seules les initiales vont à la fiduciaire.
export function initiales(prenom, nom) {
  const premiere = (s) => {
    const m = String(s || "").trim().match(/\p{L}/u);
    return m ? `${m[0].toLocaleUpperCase("en")}.` : "";
  };
  return premiere(prenom) + premiere(nom);
}

const MOIS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dateEn(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${Number(m[3])} ${MOIS_EN[Number(m[2]) - 1]} ${m[1]}` : "";
}

// Libellé de la ligne : le service, sa date, le client en initiales et la référence du dossier (qui renvoie à la facture du client).
// « Commission on » pour une commission reçue, « Margin on » pour une marge (service payé chez nous) : mots réglables (reglagesFid).
export function libelleFacture(reservation, { dossierRef = "", prenom = "", nom = "", cas = "sur_place", reglages = null } = {}) {
  const fid = reglagesFid(reglages);
  let texte = `${cas === "chez_nous" ? fid.mot_marge : fid.mot_commission} ${reservation.libelle}`;
  if (reservation.date_service) texte += `, service of ${dateEn(reservation.date_service)}`;
  const ini = initiales(prenom, nom);
  if (ini) texte += `, guest ${ini}`;
  if (dossierRef) texte += ` (booking ${dossierRef})`;
  return texte;
}

// Numéro : une série par préfixe et par année, sans trou (la base attribue le numéro dans la même transaction que la facture).
// Préfixes réglables (COM pour les factures, CN pour les avoirs par défaut) : un nouveau préfixe démarre sa propre série.
export const PREFIXES = { facture: FID_DEFAUT.prefixe_facture, avoir: FID_DEFAUT.prefixe_avoir };
export const prefixeDe = (type, reglages = null) => { const f = reglagesFid(reglages); return type === "avoir" ? f.prefixe_avoir : f.prefixe_facture; };
export const formaterNumero = (type, annee, seq, prefixe = null) => `${prefixe || PREFIXES[type] || PREFIXES.facture}-${annee}-${String(seq).padStart(3, "0")}`;

// Destinataire d'une facture : le partenaire (destinataire_id), ou son nom pour une facture émise avant la migration 31.
export const cleDestinataire = (f) => (f.destinataire_id ? String(f.destinataire_id) : `nom:${(f.destinataire || {}).nom || ""}`);
export const pourPartenaire = (f, partenaire) => !!partenaire && (f.destinataire_id ? f.destinataire_id === partenaire.id : (f.destinataire || {}).nom === partenaire.nom);

// Les factures d'un service, regroupées par destinataire : ce qui est facturé au prestataire actuel, et ce qui reste chez les anciens.
// factures : celles du service ; partenaire : { id, nom } ou null. Renvoie { deja, anciens: [{ cle, destinataire_id, nom, adresse, total }] } (anciens au total non nul).
export function parDestinataire(factures, partenaire) {
  let deja = 0;
  const autres = new Map();
  for (const f of factures || []) {
    if (pourPartenaire(f, partenaire)) deja += Number(f.montant);
    else {
      const cle = cleDestinataire(f);
      const a = autres.get(cle) || { cle, destinataire_id: f.destinataire_id || null, nom: (f.destinataire || {}).nom || "", adresse: (f.destinataire || {}).adresse || "", total: 0 };
      a.total += Number(f.montant);
      autres.set(cle, a);
    }
  }
  const anciens = [...autres.values()].map((a) => ({ ...a, total: arrondi(a.total) })).filter((a) => a.total !== 0);
  return { deja: arrondi(deja), anciens };
}

// Le document que l'outil sait déjà afficher (renderDocument) : une ligne, le destinataire en « facturé à », l'émetteur de la facture figée.
// `facture.emetteur` et `facture.paiement` sont la copie des réglages au jour de l'émission (voir migration 28) ; les passer à `reglagesFiduciaire`.
export function contenuDepuisFacture(f) {
  const montant = Number(f.montant);
  const libelle = f.type === "avoir" ? `Credit note for invoice ${f.avoir_de_numero || ""}: ${f.libelle || ""}`.replace(/\s+:/, ":").trim() : f.libelle;
  const dest = f.destinataire || {};
  return {
    doc: {
      id: f.id || f.numero,
      type: "facture",
      date_emission: f.date_facture,
      contenu: {
        numero: f.numero,
        langue: "en",
        devise: f.devise,
        bandeau: "DESCRIPTION",
        colonnes: "total",
        pied: "qr",
        cgv: false,
        tva: false,
        variante: "perso",
        conditions_corps: "",
        conditions_cloture: "",
        lignes: [{ id: "l1", kind: "ligne", libelle, montant }],
      },
    },
    client: { civilite: "", prenom: "", nom: dest.nom || "", adresse: dest.adresse || "", telephone: "" },
    dossier: { ref: f.numero },
  };
}

// Réglages d'affichage : ceux de l'entreprise émettrice, avec l'émetteur, le compte bancaire, le QR code et les titres tels qu'ils étaient le jour de l'émission.
// Le QR d'une facture se lit dans `apparence` (modesPaiement) : la copie figée le remplace, même vide (une facture émise sans QR reste sans QR).
// Une facture émise avant la migration 31 n'a pas de copie du QR ni des titres : elle garde l'affichage d'avant (QR et titres actuels, mots par défaut).
export function reglagesFiduciaire(reglages, facture) {
  const figes = facture.emetteur || {};
  const paie = figes.paiement || {};
  const avoir = facture.type === "avoir";
  const titres = figes.titres || {};
  const qrFige = Object.prototype.hasOwnProperty.call(paie, "qr_image");
  return {
    ...reglages,
    emetteur: { ...reglages.emetteur, ...(figes.emetteur || {}) },
    paiement: { ...(reglages.paiement || {}), texte: paie.texte !== undefined ? paie.texte : (reglages.paiement || {}).texte, ...(paie.nom ? { nom: paie.nom } : {}) },
    apparence: { ...(reglages.apparence || {}), ...(qrFige ? { qr_image: paie.qr_image || "", qr_pseudo: paie.qr_pseudo || "" } : {}) },
    libelles_en: { ...(reglages.libelles_en || {}), facture: (avoir ? titres.avoir : titres.facture) || (avoir ? FID_DEFAUT.titre_avoir : FID_DEFAUT.titre_facture), ref_facture: (avoir ? titres.ref_avoir : titres.ref_facture) || (avoir ? FID_DEFAUT.ref_avoir : FID_DEFAUT.ref_facture) },
  };
}

// Liste des factures : entreprise d'origine du service, mois de la facture, envoyée ou non à la fiduciaire.
export function filtrerFactures(liste, { entite = "", mois = "", envoyee = "" } = {}) {
  return liste.filter((f) => (!entite || f.entite_slug === entite) && (!mois || String(f.date_facture || "").startsWith(mois)) && (envoyee === "oui" ? !!f.envoyee_le : envoyee === "non" ? !f.envoyee_le : true));
}
