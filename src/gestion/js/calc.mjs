// Logique pure de Gestion Zwald : montants, références, statuts, échéances.
// Aucune dépendance au navigateur pour pouvoir la tester avec node --test.

import { moisLong, tr, N_ } from "./i18n.mjs";

export const STATUTS = {
  brouillon: N_("Brouillon"),
  devis_envoye: N_("Devis envoyé"),
  accepte: N_("Accepté, paiement attendu"),
  acompte: N_("Acompte reçu"),
  solde: N_("Soldé"),
  annule: N_("Annulé"),
};
// Les clés restent en français dans STATUTS (exports, tests) ; l'écran affiche cette version traduite.
export const libelleStatut = (code) => tr(STATUTS[code]);

const ACCENTS = /[̀-ͯ]/g;
const sansAccents = (s) => (s || "").normalize("NFD").replace(ACCENTS, "").trim();
const estNombre = (v) => v !== null && v !== undefined && v !== "" && !Number.isNaN(Number(v));

// Écriture décimale exacte d'un nombre : « 7.5 » devient { v: 75n, e: 1 } (75 × 10^-1).
function decimal(x) {
  const s = String(Number(x));
  if (!Number.isFinite(Number(x)) || /e/i.test(s)) return null;
  const neg = s.startsWith("-");
  const [entier, frac = ""] = s.replace("-", "").split(".");
  return { v: BigInt(entier + frac) * (neg ? -1n : 1n), e: frac.length };
}

// a × b ÷ diviseur arrondi au centime, demi supérieur, sans l'erreur des flottants : 8,2 × 7,5 ÷ 100 = 0,615 donne 0,62
// (a * b en flottant donne 61,49999… et arrondit à 0,61, alors que la base, en numeric exact, donne 0,62).
export function produitArrondi(a, b, diviseur = 1) {
  const A = decimal(a);
  const B = decimal(b);
  if (!A || !B) return arrondi((Number(a) * Number(b)) / diviseur);
  const num = A.v * B.v * 100n;
  const den = 10n ** BigInt(A.e + B.e) * BigInt(diviseur);
  const absolu = num < 0n ? -num : num;
  const q = (2n * absolu + den) / (2n * den);
  return Number(num < 0n ? -q : q) / 100;
}

// Arrondi au centime, demi supérieur, comme `round(numeric, 2)` de la base : 8,325 donne 8,33 et 1,005 donne 1,01.
// On passe par l'écriture décimale (« 8.325e2 ») plutôt que par x * 100, qui donne 832,4999… et arrondit à 8,32.
export function arrondi(n) {
  const x = Number(n) || 0;
  const s = String(Math.abs(x));
  const centimes = s.includes("e") ? Math.round(Math.abs(x) * 100) : Math.round(Number(`${s}e2`));
  return (Math.sign(x) * centimes) / 100;
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

// `code` permet d'afficher un montant dans la devise propre à un document.
// Sans le droit « finances », les montants ne s'affichent pas : tirets à la place des chiffres.
let masquer = false;
export function setMasquerMontants(oui) {
  masquer = !!oui;
}

export function formatMontant(n, code) {
  if (masquer) return "—";
  const v = arrondi(n);
  return `${v < 0 ? "- " : ""}${code || devise} ${formatNombre(v)}`;
}

export const devisePar = () => devise;

// Somme de montants en plusieurs devises : « CHF 550 · THB 1'200 ».
export function formatSommes(paires, defaut) {
  const sommes = new Map();
  for (const { montant, devise: d } of paires) {
    const code = d || defaut || devise;
    sommes.set(code, arrondi((sommes.get(code) || 0) + (Number(montant) || 0)));
  }
  if (!sommes.size) return formatMontant(0, defaut);
  return [...sommes].map(([code, v]) => formatMontant(v, code)).join(" · ");
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

// Dernier jour du mois de la date donnée (« 2026-11-01 » donne « 2026-11-30 »).
export function finDuMois(iso) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7), 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function ajouterJours(iso, n) {
  const d = new Date(enMs(iso) + n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Montant d'une ligne hors remise en pourcentage.
// Prix d'une ligne tel qu'il est écrit, qu'il soit encaissé par nous ou payé au prestataire.
export function montantLigne(l) {
  if (!l || l.kind === "texte") return 0;
  if (estNombre(l.unite) && estNombre(l.qte)) return produitArrondi(l.unite, l.qte);
  return estNombre(l.montant) ? arrondi(l.montant) : 0;
}

// Ce que la ligne ajoute au total à régler : rien quand le client la paie directement au prestataire (`paye_sur_place`).
export function montantBrut(l) {
  return l && l.paye_sur_place ? 0 : montantLigne(l);
}

// Somme des prix payés directement aux prestataires, hors du total à régler.
export function montantSurPlace(contenu) {
  return arrondi(((contenu && contenu.lignes) || []).filter((l) => l.paye_sur_place && l.kind !== "remise" && l.kind !== "texte").reduce((s, l) => s + montantLigne(l), 0));
}

// Les remises sont saisies en positif et comptées en négatif.
export function totaux(contenu, recu = 0) {
  const lignes = (contenu && contenu.lignes) || [];
  const sousTotal = arrondi(lignes.filter((l) => l.kind !== "remise").reduce((s, l) => s + montantBrut(l), 0));
  const montants = lignes.map((l) => {
    if (l.kind !== "remise") return montantBrut(l);
    if (estNombre(l.pct)) return -produitArrondi(sousTotal, l.pct, 100);
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

// Lignes d'équivalent indicatif d'un document. L'ancien format (eur et thb) est converti.
export function lignesEquivalents(eq, taux) {
  if (!eq) return [];
  if (Array.isArray(eq.lignes)) return eq.lignes;
  return [
    { code: "EUR", taux: eq.eur ?? (taux && taux.eur) },
    { code: "THB", taux: eq.thb ?? (taux && taux.thb) },
  ];
}

export function equivalents(total, lignes) {
  return (lignes || []).filter((l) => l.code && Number(l.taux) > 0).map((l) => ({ code: l.code, montant: Math.round(total * Number(l.taux)) }));
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

// Mois dans la langue de l'interface (les bandeaux de documents gardent le français, voir periodeTexte).
export function nomMois(iso) {
  return moisLong(iso);
}

export function initiales(prenom, nom) {
  const p = sansAccents(prenom).charAt(0);
  const n = sansAccents(nom).split(/\s+/)[0].charAt(0);
  return (p + n).toUpperCase();
}

export function genererRef(prenom, nom, dateIso, pays) {
  return `${initiales(prenom, nom)}${dateIso.replaceAll("-", "")} ${pays}`.trim();
}

// Séquence annuelle d'après les références que la personne voit : début commun (« ST-2026- ») et plus grand numéro déjà pris.
export function sequenceRef({ numerotation, dateIso, refsExistantes }) {
  const prefixe = ((numerotation && numerotation.prefixe) || "").trim();
  const annee = Number(dateIso.slice(0, 4));
  const debut = `${prefixe ? prefixe + "-" : ""}${annee}-`;
  const pris = refsExistantes.filter((r) => r.startsWith(debut)).map((r) => parseInt(r.slice(debut.length), 10)).filter(Number.isFinite);
  return { debut, annee, dernier: pris.length ? Math.max(...pris) : 0 };
}
export const refDepuisNumero = (numerotation, debut, n) => `${debut}${String(n).padStart(Number(numerotation && numerotation.chiffres) || 4, "0")}`;

// Référence d'un nouveau dossier : initiales, date et pays, ou séquence annuelle (ST-2026-0001).
// En séquence, ce numéro n'est qu'une proposition : à la création, la base attribue le numéro définitif (voir numeroSuivant).
export function nouvelleRef({ numerotation, prenom, nom, dateIso, pays, refsExistantes }) {
  const existe = (r) => refsExistantes.includes(r);
  if (numerotation && numerotation.mode === "sequence") {
    const s = sequenceRef({ numerotation, dateIso, refsExistantes });
    return refDepuisNumero(numerotation, s.debut, s.dernier + 1);
  }
  const base = genererRef(prenom, nom, dateIso, pays);
  if (!existe(base)) return base;
  const [code, ...reste] = base.split(" ");
  for (const l of "bcdefghij") if (!existe(`${code}${l} ${reste.join(" ")}`.trim())) return `${code}${l} ${reste.join(" ")}`.trim();
  return base;
}

export function nomFichier(type, doc, dossier, client) {
  const nom = sansAccents(client && client.nom).split(/\s+/)[0] || "client";
  const t = type === "facture_locale" ? "Facture locale" : type === "facture" ? "Facture" : "Devis";
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

// Statut à partir de faits déjà connus : c'est ce qui permet de l'afficher sans charger les documents du dossier.
export function statutDepuis({ annule, total, recu, accepteLe, devisEnvoyeLe, pct }) {
  if (annule) return "annule";
  if (total > 0 && recu >= total) return "solde";
  const acompte = acompteDu(total, pct);
  if (acompte > 0 && recu >= acompte) return "acompte";
  if (accepteLe) return "accepte";
  if (devisEnvoyeLe) return "devis_envoye";
  return "brouillon";
}

export function statutDossier({ dossier, documents, paiements, reglages }) {
  const devis = dernier(documents, "devis");
  return statutDepuis({ annule: dossier.annule, total: totalDossier(documents), recu: sommePaiements(paiements), accepteLe: dossier.accepte_le, devisEnvoyeLe: devis && devis.envoye_le, pct: reglages.conditions.acompte_pct });
}

// Résumé d'un dossier pour les listes et le tableau de bord. Quand ses documents et paiements ne sont pas chargés
// (cas courant avec la vraie base), on s'appuie sur le résumé tenu à jour par la base (total, encaissé, devise).
export function resume(dossier, db, reglages) {
  const documents = db.documents.filter((d) => d.dossier_id === dossier.id);
  const paiements = db.paiements.filter((p) => p.dossier_id === dossier.id);
  const charge = documents.length > 0 || paiements.length > 0;
  const devis = dernier(documents, "devis");
  const doc = dernier(documents, "facture") || devis;
  const total = charge ? totalDossier(documents) : Number(dossier.total) || 0;
  const recu = charge ? sommePaiements(paiements) : Number(dossier.recu) || 0;
  const devisEnvoyeLe = charge ? (devis && devis.envoye_le) || null : dossier.devis_envoye_le || null;
  return {
    dossier,
    client: db.clients.find((c) => c.id === dossier.client_id) || null,
    documents,
    paiements,
    // Devise du dossier : celle de son dernier document, sinon celle de l'entreprise.
    devise: (doc && doc.contenu.devise) || (!charge && dossier.devise) || reglages.devise || null,
    total,
    recu,
    reste: arrondi(total - recu),
    devisEnvoyeLe,
    statut: statutDepuis({ annule: dossier.annule, total, recu, accepteLe: dossier.accepte_le, devisEnvoyeLe, pct: reglages.conditions.acompte_pct }),
  };
}

// Ce qui demande une action, du plus urgent au moins urgent.
export function aFaire(resumes, today, reglages) {
  const relance = Number(reglages.conditions.relance_jours) || 7;
  const items = [];
  for (const r of resumes) {
    const d = r.dossier;
    // Argent à rendre : un dossier payé au-delà de son total. (Un dossier annulé avec un acompte conservé reste hors de la liste : on ne
    // peut pas distinguer l'acompte gardé d'un remboursement oublié, la fiche du dossier le rappelle.)
    if (r.statut !== "annule" && r.total > 0 && arrondi(r.recu - r.total) > 0) items.push({ type: "trop_percu", resume: r, jours: 0 });
    if (r.statut === "accepte" && acompteDu(r.total, reglages.conditions.acompte_pct) > 0) {
      const ech = echeanceAcompte(d, reglages);
      if (ech && ech < today) items.push({ type: "acompte_retard", resume: r, jours: joursEntre(ech, today) });
    }
    if (r.statut === "devis_envoye") {
      const depuis = r.devisEnvoyeLe ? joursEntre(r.devisEnvoyeLe, today) : 0;
      if (r.devisEnvoyeLe && depuis >= relance) items.push({ type: "devis_relance", resume: r, jours: depuis });
    }
    if (r.statut === "acompte" && d.date_depart) {
      const avant = joursEntre(today, d.date_depart);
      if (avant >= 0 && avant <= 30 && r.reste > 0) items.push({ type: "solde_proche", resume: r, jours: avant });
    }
  }
  const ordre = { trop_percu: 0, acompte_retard: 1, solde_proche: 2, devis_relance: 3 };
  return items.sort((a, b) => ordre[a.type] - ordre[b.type] || b.jours - a.jours);
}

// Taux pour passer d'une devise à une autre d'après les taux des réglages (exprimés par rapport à la devise de l'entreprise).
// Renvoie null si l'une des deux devises n'a pas de taux : la personne le saisit alors à la main.
export function tauxVers(reglages, de, vers) {
  const base = reglages.devise;
  const taux = (code) => (code === base ? 1 : Number(reglages.taux[String(code).toLowerCase()]) || null);
  const a = taux(de);
  const b = taux(vers);
  return a && b ? Math.round((b / a) * 1000000) / 1000000 : null;
}

// Copie d'un document convertie dans une autre devise : tous les montants sont multipliés par le taux.
// En bahts les montants sont arrondis à l'unité, comme sur les factures locales.
export function convertirContenu(contenu, taux, devise) {
  const conv = (v) => (v == null ? v : devise === "THB" ? Math.round(Number(v) * taux) : produitArrondi(v, taux));
  const c = structuredClone(contenu);
  c.lignes = c.lignes.map((l) => ({ ...l, montant: conv(l.montant), unite: conv(l.unite) }));
  c.devise = devise;
  c.montant_recu = null;
  delete c.libelle_recu;
  c.equivalents = { ...(c.equivalents || {}), actif: false };
  return c;
}
