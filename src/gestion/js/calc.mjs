// Logique pure de Gestion Zwald : montants, références, statuts, échéances.
// Aucune dépendance au navigateur pour pouvoir la tester avec node --test.

export const STATUTS = {
  brouillon: "Brouillon",
  devis_envoye: "Devis envoyé",
  accepte: "Accepté, paiement attendu",
  acompte: "Acompte reçu",
  solde: "Soldé",
  annule: "Annulé",
};

const ACCENTS = /[̀-ͯ]/g;
const sansAccents = (s) => (s || "").normalize("NFD").replace(ACCENTS, "").trim();
const estNombre = (v) => v !== null && v !== undefined && v !== "" && !Number.isNaN(Number(v));

export function arrondi(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function formatNombre(n) {
  const v = Math.abs(arrondi(n));
  const [ent, dec] = v.toFixed(2).split(".");
  const milliers = ent.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return dec === "00" ? milliers : `${milliers}.${dec}`;
}

// La devise est celle de l'entreprise active, posée une fois à son changement.
let devise = "CHF";
export function setDevise(code) {
  devise = code || "CHF";
}

export function formatMontant(n) {
  const v = arrondi(n);
  return `${v < 0 ? "- " : ""}${devise} ${formatNombre(v)}`;
}

export function formatDate(iso) {
  if (!iso) return "";
  const [a, m, j] = iso.slice(0, 10).split("-");
  return `${j}/${m}/${a}`;
}

export function aujourdhui(d = new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const j = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${j}`;
}

const enMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

export function joursEntre(debutIso, finIso) {
  return Math.round((enMs(finIso) - enMs(debutIso)) / 86400000);
}

export function ajouterJours(iso, n) {
  const d = new Date(enMs(iso) + n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Montant d'une ligne hors remise en pourcentage.
export function montantBrut(l) {
  if (!l || l.kind === "texte") return 0;
  if (estNombre(l.unite) && estNombre(l.qte)) return arrondi(Number(l.unite) * Number(l.qte));
  return estNombre(l.montant) ? arrondi(l.montant) : 0;
}

// Les remises sont saisies en positif et comptées en négatif.
export function totaux(contenu, recu = 0) {
  const lignes = (contenu && contenu.lignes) || [];
  const sousTotal = arrondi(lignes.filter((l) => l.kind !== "remise").reduce((s, l) => s + montantBrut(l), 0));
  const montants = lignes.map((l) => {
    if (l.kind !== "remise") return montantBrut(l);
    if (estNombre(l.pct)) return -arrondi((sousTotal * Number(l.pct)) / 100);
    return -montantBrut(l);
  });
  const remises = arrondi(lignes.reduce((s, l, i) => (l.kind === "remise" ? s + montants[i] : s), 0));
  const net = arrondi(sousTotal + remises);
  const r = arrondi(recu);
  return { sousTotal, remises, net, recu: r, reste: arrondi(net - r), montants };
}

export function afficherSousTotal(contenu, recu = 0) {
  const lignes = (contenu && contenu.lignes) || [];
  return lignes.some((l) => l.kind === "remise") || arrondi(recu) > 0;
}

// Une remise « 1 jour tous les 14 jours de voyage » : quantité = jours entiers de 14.
export function remiseJours(qteJours) {
  return Math.floor((Number(qteJours) || 0) / 14);
}

export function equivalents(total, taux) {
  return {
    eur: Math.round(total * (Number(taux && taux.eur) || 0)),
    thb: Math.round(total * (Number(taux && taux.thb) || 0)),
  };
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

// « DU 2 AU 12 DÉCEMBRE 2026 », pour le bandeau du document.
export function periodeTexte(debut, fin) {
  if (!debut) return "";
  const [a1, m1, j1] = debut.split("-").map(Number);
  if (!fin) return `${MOIS[m1 - 1]} ${a1}`.toUpperCase();
  const [a2, m2, j2] = fin.split("-").map(Number);
  if (a1 === a2 && m1 === m2) return `DU ${j1} AU ${j2} ${MOIS[m2 - 1]} ${a2}`.toUpperCase();
  if (a1 === a2) return `DU ${j1} ${MOIS[m1 - 1]} AU ${j2} ${MOIS[m2 - 1]} ${a2}`.toUpperCase();
  return `DU ${j1} ${MOIS[m1 - 1]} ${a1} AU ${j2} ${MOIS[m2 - 1]} ${a2}`.toUpperCase();
}

export function nomMois(iso) {
  return MOIS[Number(iso.slice(5, 7)) - 1];
}

export function initiales(prenom, nom) {
  const p = sansAccents(prenom).charAt(0);
  const n = sansAccents(nom).split(/\s+/)[0].charAt(0);
  return (p + n).toUpperCase();
}

export function genererRef(prenom, nom, dateIso, pays) {
  return `${initiales(prenom, nom)}${dateIso.replaceAll("-", "")} ${pays}`.trim();
}

// Référence d'un nouveau dossier : initiales, date et pays, ou séquence annuelle (ST-2026-0001).
export function nouvelleRef({ numerotation, prenom, nom, dateIso, pays, refsExistantes }) {
  const existe = (r) => refsExistantes.includes(r);
  if (numerotation && numerotation.mode === "sequence") {
    const prefixe = (numerotation.prefixe || "").trim();
    const annee = dateIso.slice(0, 4);
    const debut = `${prefixe ? prefixe + "-" : ""}${annee}-`;
    const dernier = refsExistantes.filter((r) => r.startsWith(debut)).map((r) => parseInt(r.slice(debut.length), 10)).filter(Number.isFinite);
    return `${debut}${String((dernier.length ? Math.max(...dernier) : 0) + 1).padStart(4, "0")}`;
  }
  const base = genererRef(prenom, nom, dateIso, pays);
  if (!existe(base)) return base;
  const [code, ...reste] = base.split(" ");
  for (const l of "bcdefghij") if (!existe(`${code}${l} ${reste.join(" ")}`.trim())) return `${code}${l} ${reste.join(" ")}`.trim();
  return base;
}

export function nomFichier(type, doc, dossier, client) {
  const nom = sansAccents(client && client.nom).split(/\s+/)[0] || "client";
  const t = type === "facture" ? "Facture" : "Devis";
  return `${t} ${dossier.ref} - ${nom}`;
}

export function sommePaiements(paiements) {
  return arrondi((paiements || []).reduce((s, p) => s + (Number(p.montant) || 0), 0));
}

const dernier = (docs, type) =>
  (docs || [])
    .filter((d) => d.type === type)
    .sort((a, b) => (a.date_emission + a.created_at > b.date_emission + b.created_at ? 1 : -1))
    .pop();

// Le montant du dossier est celui de la facture si elle existe, sinon celui du devis.
export function totalDossier(documents) {
  const doc = dernier(documents, "facture") || dernier(documents, "devis");
  return doc ? totaux(doc.contenu).net : 0;
}

export function acompteDu(total, pct) {
  return arrondi((total * (Number(pct) || 0)) / 100);
}

export function echeanceAcompte(dossier, reglages) {
  if (!dossier.accepte_le) return null;
  return ajouterJours(dossier.accepte_le, Number(reglages.conditions.delai_jours) || 0);
}

export function statutDossier({ dossier, documents, paiements, reglages }) {
  if (dossier.annule) return "annule";
  const total = totalDossier(documents);
  const recu = sommePaiements(paiements);
  if (total > 0 && recu >= total) return "solde";
  const acompte = acompteDu(total, reglages.conditions.acompte_pct);
  if (acompte > 0 && recu >= acompte) return "acompte";
  if (dossier.accepte_le) return "accepte";
  const devis = dernier(documents, "devis");
  if (devis && devis.envoye_le) return "devis_envoye";
  return "brouillon";
}

// Résumé d'un dossier pour les listes et le tableau de bord.
export function resume(dossier, db, reglages) {
  const documents = db.documents.filter((d) => d.dossier_id === dossier.id);
  const paiements = db.paiements.filter((p) => p.dossier_id === dossier.id);
  const total = totalDossier(documents);
  const recu = sommePaiements(paiements);
  return {
    dossier,
    client: db.clients.find((c) => c.id === dossier.client_id) || null,
    documents,
    paiements,
    total,
    recu,
    reste: arrondi(total - recu),
    statut: statutDossier({ dossier, documents, paiements, reglages }),
  };
}

// Ce qui demande une action, du plus urgent au moins urgent.
export function aFaire(resumes, today, reglages) {
  const relance = Number(reglages.conditions.relance_jours) || 7;
  const items = [];
  for (const r of resumes) {
    const d = r.dossier;
    if (r.statut === "accepte" && acompteDu(r.total, reglages.conditions.acompte_pct) > 0) {
      const ech = echeanceAcompte(d, reglages);
      if (ech && ech < today) items.push({ type: "acompte_retard", resume: r, jours: joursEntre(ech, today) });
    }
    if (r.statut === "devis_envoye") {
      const devis = dernier(r.documents, "devis");
      const depuis = joursEntre(devis.envoye_le, today);
      if (depuis >= relance) items.push({ type: "devis_relance", resume: r, jours: depuis });
    }
    if (r.statut === "acompte" && d.date_depart) {
      const avant = joursEntre(today, d.date_depart);
      if (avant >= 0 && avant <= 30 && r.reste > 0) items.push({ type: "solde_proche", resume: r, jours: avant });
    }
  }
  const ordre = { acompte_retard: 0, solde_proche: 1, devis_relance: 2 };
  return items.sort((a, b) => ordre[a.type] - ordre[b.type] || b.jours - a.jours);
}
