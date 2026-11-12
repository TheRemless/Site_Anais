// Factures pour la fiduciaire : ce qui revient à l'agence sur chaque service, jamais ce que le client a payé en tout.
// Fonctions pures. La base calcule la même chose de son côté (migration 28, fonction fiduciaire_cible) : docs/gestion/verif-fiduciaire.mjs
// fait tourner les deux sur les mêmes cas et vérifie qu'elles donnent le même montant.
//
// Règles (Jérémy, 12.11.2026) :
//   service payé sur place    -> la commission reçue du prestataire (reservations_nets.commission_recue), datée du jour de réception ;
//   service payé chez nous    -> la marge : prix de vente moins net payé au prestataire, datée du plus tardif du paiement du client et du paiement du prestataire ;
//   rien n'est facturé tant que rien n'est reçu ; une commission partielle se facture pour ce qui est reçu, le complément plus tard ;
//   un montant déjà facturé n'est jamais modifié : un écart se corrige par une facture de complément ou par un avoir.

const arrondi = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const nombre = (x) => (x === null || x === undefined || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
const plusTard = (a, b) => (a && b ? (a > b ? a : b) : a || b || null);

// reservation : { statut, paye_sur_place, montant_vente }
// net         : { net_paye, paye_le, commission_prevue, commission_recue, commission_recue_le } (ou null sans le droit « nets » : le calcul se fait alors dans la base)
// paiement    : { regle, date } pour le client : tout payé, et date du dernier paiement
// deja        : montant déjà facturé pour ce service (factures moins avoirs)
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
  } else if (r.statut === "annule") {
    // Annulé et remboursé : plus de marge. S'il y avait une facture, un avoir la ramène à zéro.
    sortie.pret = dejaFacture > 0;
  } else {
    const vente = nombre(r.montant_vente);
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
export function libelleFacture(reservation, { dossierRef = "", prenom = "", nom = "" } = {}) {
  let texte = `Commission on ${reservation.libelle}`;
  if (reservation.date_service) texte += `, service of ${dateEn(reservation.date_service)}`;
  const ini = initiales(prenom, nom);
  if (ini) texte += `, guest ${ini}`;
  if (dossierRef) texte += ` (booking ${dossierRef})`;
  return texte;
}

// Numéro : une série pour les factures, une pour les avoirs, par année, sans trou (la base attribue le numéro dans la même transaction que la facture).
export const PREFIXES = { facture: "COM", avoir: "CN" };
export const formaterNumero = (type, annee, seq) => `${PREFIXES[type] || PREFIXES.facture}-${annee}-${String(seq).padStart(3, "0")}`;

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

// Réglages d'affichage : ceux de l'entreprise émettrice, avec l'émetteur et le compte bancaire tels qu'ils étaient le jour de l'émission.
export function reglagesFiduciaire(reglages, facture) {
  const figes = facture.emetteur || {};
  return {
    ...reglages,
    emetteur: { ...reglages.emetteur, ...(figes.emetteur || {}) },
    paiement: { ...(reglages.paiement || {}), ...(figes.paiement || {}) },
    libelles_en: { ...(reglages.libelles_en || {}), facture: facture.type === "avoir" ? "CREDIT NOTE" : "INVOICE", ref_facture: facture.type === "avoir" ? "Credit note no." : "Invoice no." },
  };
}

// Liste des factures : entreprise d'origine du service, mois de la facture, envoyée ou non à la fiduciaire.
export function filtrerFactures(liste, { entite = "", mois = "", envoyee = "" } = {}) {
  return liste.filter((f) => (!entite || f.entite_slug === entite) && (!mois || String(f.date_facture || "").startsWith(mois)) && (envoyee === "oui" ? !!f.envoyee_le : envoyee === "non" ? !f.envoyee_le : true));
}
