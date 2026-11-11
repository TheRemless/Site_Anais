// Statistiques de Gestion : logique pure, sans navigateur, testée dans tests/gestion-stats.test.js.
//
// La base (fonction SQL `analyse_faits`, migration 20) fournit des FAITS : un enregistrement par dossier, par paiement et par
// réservation, avec les montants déjà calculés. Ce module en tire les indicateurs. Chaque indicateur (une « mesure ») est défini
// UNE fois comme un filtre sur des lignes : le chiffre est la somme de ces lignes, et la liste qu'on ouvre en touchant le chiffre est
// exactement ces lignes. La somme de la liste égale donc toujours le chiffre, par construction.
//
// Définitions (voir aussi DEFINITIONS plus bas, affichées à l'écran) :
//  - Volume vendu : valeur des services vendus, y compris ceux que le client paie sur place au prestataire.
//  - Encaissé chez nous : l'argent passé par Anaïs (paiements des clients, remboursements en moins).
//  - Commission : ce que le prestataire reverse sur un service payé sur place (prévue, reçue, reste).
//  - Revenu : encaissé chez nous, moins les nets payés aux partenaires, plus les commissions reçues (flux de trésorerie de la période).
import { arrondi, ajouterJours, joursEntre } from "./calc.mjs";
import { N_ } from "./i18n.mjs";

const dans = (iso, du, au) => !!iso && iso >= du && iso <= au;
const nb = (v) => Number(v) || 0;

// ---- Périodes ------------------------------------------------------------------------------------------------------
export const debutMois = (jour, decalage = 0) => {
  const d = new Date(`${jour.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + decalage);
  return d.toISOString().slice(0, 10);
};
export const finDeMois = (jour) => ajouterJours(debutMois(jour, 1), -1);
const joursDuMois = (jour) => Number(finDeMois(jour).slice(8, 10));
// Même jour du mois, N mois plus tard, ramené à la fin du mois si le jour n'existe pas (31 → 30, 29 février).
export function decalerMois(jour, n) {
  const debut = debutMois(jour, n);
  return `${debut.slice(0, 8)}${String(Math.min(Number(jour.slice(8, 10)), joursDuMois(debut))).padStart(2, "0")}`;
}

export const PERIODES = [
  ["aujourdhui", N_("Aujourd'hui")],
  ["sept", N_("7 jours")],
  ["mois", N_("Ce mois")],
  ["mois_dernier", N_("Mois dernier")],
  ["trois", N_("3 mois")],
  ["annee", N_("Année")],
  ["perso", N_("Dates au choix")],
];

export function periodeRapide(cle, jour) {
  switch (cle) {
    case "aujourdhui": return [jour, jour];
    case "sept": return [ajouterJours(jour, -6), jour];
    case "mois": return [`${jour.slice(0, 7)}-01`, jour];
    case "mois_dernier": return [debutMois(jour, -1), finDeMois(debutMois(jour, -1))];
    case "trois": return [debutMois(jour, -2), jour];
    case "annee": return [`${jour.slice(0, 4)}-01-01`, jour];
    default: return null;
  }
}

export const COMPARAISONS = [
  ["aucune", N_("Sans comparaison")],
  ["prec", N_("Période précédente")],
  ["an", N_("Même période l'an dernier")],
];

// Période de comparaison. « Précédente » suit le calendrier quand la période commence un 1er (un mois, trois mois, une année),
// sinon elle prend la même durée juste avant. Un mois en cours se compare aux mêmes jours du mois précédent.
export function periodeComparee(du, au, mode) {
  if (!du || !au || !mode || mode === "aucune") return null;
  const an = [decalerMois(du, -12), decalerMois(au, -12)];
  if (mode === "an") return an;
  if (du.slice(5) === "01-01") return an;
  if (du.slice(8) === "01") {
    const n = (Number(au.slice(0, 4)) - Number(du.slice(0, 4))) * 12 + Number(au.slice(5, 7)) - Number(du.slice(5, 7)) + 1;
    return [debutMois(du, -n), au === finDeMois(au) ? finDeMois(debutMois(au, -n)) : decalerMois(au, -n)];
  }
  const longueur = joursEntre(du, au) + 1;
  return [ajouterJours(du, -longueur), ajouterJours(du, -1)];
}

// Granularité des séries : au jour jusqu'à un mois, à la semaine jusqu'à quatre mois, ensuite au mois.
export function granularite(du, au) {
  const n = joursEntre(du, au) + 1;
  return n <= 31 ? "jour" : n <= 125 ? "semaine" : "mois";
}
const lundi = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return ajouterJours(iso, -((d.getUTCDay() + 6) % 7));
};
export const cleDe = (iso, gran) => (gran === "jour" ? iso : gran === "semaine" ? lundi(iso) : iso.slice(0, 7));
export function casesDe(du, au, gran) {
  const cles = [];
  if (gran === "mois") {
    for (let m = debutMois(du, 0); m.slice(0, 7) <= au.slice(0, 7); m = debutMois(m, 1)) cles.push(m.slice(0, 7));
    return cles;
  }
  const pas = gran === "jour" ? 1 : 7;
  for (let d = gran === "jour" ? du : lundi(du); d <= au; d = ajouterJours(d, pas)) cles.push(d);
  return cles;
}

// ---- Faits de base ------------------------------------------------------------------------------------------------
export const dateRef = (D) => D.f_date || D.accepte_le || D.v_date;
export const vente = (D) => arrondi(nb(D.total) + nb(D.sur_place));
export const resteDu = (D) => arrondi(nb(D.total) - nb(D.recu));
export const personnesDe = (R) => nb(R.adultes) + nb(R.enfants);

const nomCourt = (D) => `${D.ref} · ${D.client || "—"}`;

// ---- Mesures --------------------------------------------------------------------------------------------------------
// Chaque mesure : d'où viennent les lignes (`source`), lesquelles comptent (`garde`), combien elles valent (`montant`),
// à quelle date elles tombent dans une série (`date`) et si le chiffre dépend d'une période (`flux`) ou de l'état à ce jour (stock).
const tranche = (age, bornes) => {
  const [a, b, c] = bornes;
  return age <= a ? `0-${a}` : age <= b ? `${a + 1}-${b}` : age <= c ? `${b + 1}-${c}` : `${c}+`;
};
const actifR = (R) => R.statut !== "annule" && !R.dossier_annule;

export const MESURES = {
  vendu: {
    source: "dossiers", flux: true,
    garde: (D, c) => !D.annule && (D.accepte_le || D.f_date) && dans(dateRef(D), c.du, c.au),
    montant: vente, date: dateRef,
  },
  facture: {
    source: "dossiers", flux: true,
    garde: (D, c) => !D.annule && D.f_date && dans(D.f_date, c.du, c.au),
    montant: (D) => nb(D.total), date: (D) => D.f_date,
  },
  encaisse: { source: "paiements", flux: true, garde: (P, c) => dans(P.date, c.du, c.au), montant: (P) => nb(P.montant), date: (P) => P.date },
  a_encaisser: {
    source: "dossiers", flux: false,
    garde: (D) => !D.annule && D.f_date && resteDu(D) > 0,
    montant: resteDu, date: (D) => D.f_date,
  },
  devis_emis: { source: "dossiers", flux: true, garde: (D, c) => D.v_date && dans(D.v_date, c.du, c.au), montant: vente, date: (D) => D.v_date },
  devis_acceptes: { source: "dossiers", flux: true, garde: (D, c) => D.v_date && D.accepte_le && dans(D.v_date, c.du, c.au), montant: vente, date: (D) => D.v_date },
  devis_attente: {
    source: "dossiers", flux: false,
    garde: (D, c) => !D.annule && !D.accepte_le && !D.f_date && D.v_date && D.v_date <= c.jour,
    montant: vente, date: (D) => D.v_date,
  },
  ouverts: { source: "dossiers", flux: true, garde: (D, c) => dateRef(D) && dans(dateRef(D), c.du, c.au), montant: vente, date: dateRef },
  annules: { source: "dossiers", flux: true, garde: (D, c) => D.annule && dateRef(D) && dans(dateRef(D), c.du, c.au), montant: vente, date: dateRef },
  departs: { source: "dossiers", flux: false, garde: (D, c) => !D.annule && D.date_depart && D.date_depart >= c.jour && (D.accepte_le || D.f_date), montant: vente, date: (D) => D.date_depart },
  services: { source: "reservations", flux: true, garde: (R, c) => actifR(R) && dans(R.date_service, c.du, c.au), montant: (R) => nb(R.montant_vente), date: (R) => R.date_service },
  services_nous: { source: "reservations", flux: true, garde: (R, c) => actifR(R) && !R.paye_sur_place && dans(R.date_service, c.du, c.au), montant: (R) => nb(R.montant_vente), date: (R) => R.date_service },
  services_place: { source: "reservations", flux: true, garde: (R, c) => actifR(R) && R.paye_sur_place && dans(R.date_service, c.du, c.au), montant: (R) => nb(R.montant_vente), date: (R) => R.date_service },
  a_venir: { source: "reservations", flux: false, garde: (R, c) => actifR(R) && R.date_service && R.date_service >= c.jour, montant: (R) => nb(R.montant_vente), date: (R) => R.date_service },
  a_venir_7: { source: "reservations", flux: false, garde: (R, c) => actifR(R) && R.date_service && dans(R.date_service, c.jour, ajouterJours(c.jour, 6)), montant: (R) => nb(R.montant_vente), date: (R) => R.date_service },
  a_confirmer: { source: "reservations", flux: false, garde: (R, c) => actifR(R) && R.date_service && R.date_service >= c.jour && R.statut !== "confirme", montant: (R) => nb(R.montant_vente), date: (R) => R.date_service },
  sans_date: { source: "reservations", flux: false, garde: (R) => actifR(R) && !R.date_service, montant: (R) => nb(R.montant_vente), date: () => null },
  // Les mesures ci-dessous demandent le droit « nets » : sans lui, les champs sont vides et la mesure est indisponible.
  commission_prevue: {
    nets: true, source: "reservations", flux: true,
    garde: (R, c) => actifR(R) && R.paye_sur_place && R.commission_prevue !== null && dans(R.date_service, c.du, c.au),
    montant: (R) => nb(R.commission_prevue), date: (R) => R.date_service,
  },
  commission_recue: {
    nets: true, source: "reservations", flux: true,
    garde: (R, c) => R.commission_recue !== null && dans(R.commission_recue_le, c.du, c.au),
    montant: (R) => nb(R.commission_recue), date: (R) => R.commission_recue_le,
  },
  commission_a_recevoir: {
    nets: true, source: "reservations", flux: false,
    garde: (R) => actifR(R) && R.paye_sur_place && R.commission_prevue !== null && arrondi(nb(R.commission_prevue) - nb(R.commission_recue)) > 0,
    montant: (R) => arrondi(nb(R.commission_prevue) - nb(R.commission_recue)), date: (R) => R.date_service,
  },
  commission_a_renseigner: {
    nets: true, source: "reservations", flux: false,
    garde: (R) => actifR(R) && R.paye_sur_place && R.commission_prevue === null,
    montant: (R) => nb(R.montant_vente), date: (R) => R.date_service,
  },
  net_paye: {
    nets: true, source: "reservations", flux: true,
    garde: (R, c) => R.net_paye !== null && dans(R.paye_le, c.du, c.au),
    montant: (R) => nb(R.net_paye), date: (R) => R.paye_le,
  },
  net_a_payer: {
    nets: true, source: "reservations", flux: false,
    garde: (R) => actifR(R) && !R.paye_sur_place && R.net_prevu !== null && arrondi(nb(R.net_prevu) - nb(R.net_paye)) > 0,
    montant: (R) => arrondi(nb(R.net_prevu) - nb(R.net_paye)), date: (R) => R.date_service,
  },
  // Marge prévue des services de la période : vente moins net quand le client paie chez nous, commission quand il paie sur place.
  // Les services dont le net ou la commission n'est pas saisi sont à part (marge_inconnue) : on ne devine pas.
  marge: {
    nets: true, source: "reservations", flux: true,
    garde: (R, c) => actifR(R) && dans(R.date_service, c.du, c.au) && (R.paye_sur_place ? R.commission_prevue !== null : R.net_prevu !== null && R.montant_vente !== null),
    montant: (R) => (R.paye_sur_place ? nb(R.commission_prevue) : arrondi(nb(R.montant_vente) - nb(R.net_prevu))), date: (R) => R.date_service,
  },
  marge_inconnue: {
    nets: true, source: "reservations", flux: true,
    garde: (R, c) => actifR(R) && dans(R.date_service, c.du, c.au) && (R.paye_sur_place ? R.commission_prevue === null : R.net_prevu === null || R.montant_vente === null),
    montant: (R) => nb(R.montant_vente), date: (R) => R.date_service,
  },
};

// Mesure composée : encaissé, moins les nets payés, plus les commissions reçues. Chaque ligne garde son signe et sa nature.
export const REVENU = { nets: true, flux: true, parts: [["encaisse", 1, N_("Paiement client")], ["net_paye", -1, N_("Net payé au partenaire")], ["commission_recue", 1, N_("Commission reçue")]] };

const aDroit = (m, faits) => !m.nets || faits.nets;

// Ligne normalisée : ce que les listes affichent et ce que les groupes additionnent.
function ligneDe(id, m, src, c) {
  const base = { mesure: id, src, montant: arrondi(m.montant(src)), devise: src.devise, date: m.date(src) || null };
  if (m.source === "dossiers") {
    const age = id === "a_encaisser" ? joursEntre(src.f_date, c.jour) : id === "devis_attente" ? joursEntre(src.v_date, c.jour) : null;
    return { ...base, genre: "dossier", id: src.id, dossier_id: src.id, ref: src.ref, client: src.client, titre: nomCourt(src), age, tranche: age === null ? null : tranche(age, id === "a_encaisser" ? [30, 60, 90] : [7, 14, 30]) };
  }
  if (m.source === "paiements") return { ...base, genre: "paiement", id: src.id, dossier_id: src.dossier_id, ref: src.ref, client: src.client, titre: src.ref ? nomCourt(src) : "—", moyen: src.moyen || "" };
  return { ...base, genre: "reservation", id: src.id, dossier_id: src.dossier_id, ref: src.ref, client: src.client, titre: src.libelle || "—", partenaire: src.partenaire || "", personnes: personnesDe(src), statut: src.statut, sur_place: !!src.paye_sur_place };
}

// Lignes d'une mesure pour un contexte {du, au, jour, devise}. Sans devise : toutes les devises.
export function lignes(id, faits, ctx) {
  if (id === "revenu") {
    return REVENU.parts.flatMap(([sous, signe, nature]) => lignes(sous, faits, ctx).map((l) => ({ ...l, mesure: "revenu", montant: arrondi(l.montant * signe), nature })));
  }
  const m = MESURES[id];
  if (!m || !aDroit(m, faits)) return [];
  const out = [];
  for (const src of faits[m.source] || []) {
    if (ctx.devise && src.devise !== ctx.devise) continue;
    if (m.garde(src, ctx)) out.push(ligneDe(id, m, src, ctx));
  }
  return out;
}

export const disponible = (id, faits) => id === "revenu" || (MESURES[id] ? aDroit(MESURES[id], faits) : false);
export const estFlux = (id) => (id === "revenu" ? true : !!(MESURES[id] && MESURES[id].flux));

export function somme(rows) {
  return { montant: arrondi(rows.reduce((s, l) => s + l.montant, 0)), nombre: rows.length };
}
export const valeur = (id, faits, ctx) => somme(lignes(id, faits, ctx));

export function variation(actuel, precedent) {
  const delta = arrondi(actuel - precedent);
  if (precedent === 0) return { delta, pct: null, sens: actuel === 0 ? "stable" : actuel > 0 ? "nouveau" : "baisse" };
  const pct = Math.round((delta / Math.abs(precedent)) * 100);
  return { delta, pct, sens: delta === 0 || pct === 0 ? "stable" : delta > 0 ? "hausse" : "baisse" };
}

// Chiffre, chiffre de la période de comparaison et écart. Les mesures « à ce jour » n'ont pas de comparaison.
export function comparer(id, faits, ctx, cmp) {
  const actuel = valeur(id, faits, ctx);
  if (!cmp || !estFlux(id)) return { actuel, precedent: null, ecart: null };
  const precedent = valeur(id, faits, { ...ctx, du: cmp[0], au: cmp[1] });
  return { actuel, precedent, ecart: variation(actuel.montant, precedent.montant) };
}

// Série de la mesure sur la période, cases vides comprises : [{ cle, montant, nombre }].
export function serie(id, faits, ctx, gran = granularite(ctx.du, ctx.au)) {
  const cases = new Map(casesDe(ctx.du, ctx.au, gran).map((k) => [k, { cle: k, montant: 0, nombre: 0 }]));
  for (const l of lignes(id, faits, ctx)) {
    if (!l.date) continue;
    const e = cases.get(cleDe(l.date, gran));
    if (e) (e.montant = arrondi(e.montant + l.montant)), e.nombre++;
  }
  return [...cases.values()];
}

// ---- Groupes (dimensions) ----------------------------------------------------------------------------------------
export const SANS = { pays: N_("Non renseigné"), responsable: N_("Sans responsable"), partenaire: N_("Sans partenaire"), famille: N_("autre"), moyen: N_("Non précisé") };

export const DIMENSIONS = {
  mois: (l) => (l.date || "").slice(0, 7) || null,
  semaine: (l) => (l.date ? lundi(l.date) : null),
  jour: (l) => l.date,
  saison: (l) => (l.date ? l.date.slice(5, 7) : null),
  pays: (l) => l.src.pays || SANS.pays,
  responsable: (l) => l.src.responsable || SANS.responsable,
  client: (l) => l.src.client_id || l.client || "—",
  partenaire: (l) => l.partenaire || SANS.partenaire,
  famille: (l) => l.src.famille || "autre",
  prestation: (l) => l.titre,
  moyen: (l) => l.moyen || SANS.moyen,
  statut: (l) => l.statut || "—",
  tranche: (l) => l.tranche,
  nature: (l) => l.nature || "—",
  paiement: (l) => (l.sur_place ? "place" : "nous"),
  nouveaute: (l) => (l.src.client_depuis && l.src.client_depuis < l.ctxDu ? "recurrent" : "nouveau"),
};
const TEMPORELLES = new Set(["mois", "semaine", "jour", "saison", "tranche"]);

// Libellé lisible d'une valeur de dimension (le client ou la prestation portent leur propre nom).
export function libelleCle(dim, cle, rows) {
  if (dim === "client") return (rows.find((l) => (l.src.client_id || l.client) === cle) || {}).client || cle;
  return cle;
}

export function grouper(rows, dim, { tri } = {}) {
  const f = DIMENSIONS[dim];
  const m = new Map();
  for (const l of rows) {
    const cle = f(l);
    if (cle === null || cle === undefined) continue;
    const e = m.get(cle) || { cle, libelle: null, montant: 0, nombre: 0, personnes: 0, rows: [] };
    e.montant = arrondi(e.montant + l.montant);
    e.nombre++;
    e.personnes += l.personnes || 0;
    e.rows.push(l);
    m.set(cle, e);
  }
  const out = [...m.values()].map((e) => ({ ...e, libelle: libelleCle(dim, e.cle, e.rows) }));
  const par = tri || (TEMPORELLES.has(dim) ? "cle" : "montant");
  return out.sort((a, b) => (par === "cle" ? String(a.cle).localeCompare(String(b.cle)) : b.montant - a.montant || b.nombre - a.nombre || String(a.libelle).localeCompare(String(b.libelle))));
}

// Les lignes derrière une barre ou une ligne de tableau : la mesure, filtrée sur une valeur de dimension (« mois:2026-10 »).
export function lignesFiltrees(id, faits, ctx, filtre) {
  const rows = lignes(id, faits, ctx).map((l) => ({ ...l, ctxDu: ctx.du }));
  if (!filtre) return rows;
  const i = filtre.indexOf(":");
  const dim = filtre.slice(0, i);
  const cle = filtre.slice(i + 1);
  const f = DIMENSIONS[dim];
  return f ? rows.filter((l) => String(f(l)) === cle) : rows;
}

// ---- Synthèses par section ----------------------------------------------------------------------------------------
// Les devises présentes dans les faits, la plus utilisée d'abord.
export function devises(faits, defaut) {
  const n = new Map();
  for (const k of ["dossiers", "paiements", "reservations"]) for (const x of faits[k] || []) n.set(x.devise, (n.get(x.devise) || 0) + 1);
  const liste = [...n.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
  if (defaut && !liste.includes(defaut)) liste.push(defaut);
  return liste.length ? liste : defaut ? [defaut] : [];
}

// Taux d'acceptation, délai moyen entre l'envoi du devis et son acceptation, taux d'annulation, panier moyen, durée de séjour.
export function indicateursDevis(faits, ctx) {
  const emis = lignes("devis_emis", faits, ctx);
  const acceptes = lignes("devis_acceptes", faits, ctx);
  const delais = acceptes.filter((l) => l.src.accepte_le >= l.src.v_date).map((l) => joursEntre(l.src.v_date, l.src.accepte_le));
  return {
    emis: emis.length,
    acceptes: acceptes.length,
    taux: emis.length ? Math.round((acceptes.length / emis.length) * 100) : null,
    delaiMoyen: delais.length ? Math.round((delais.reduce((s, n) => s + n, 0) / delais.length) * 10) / 10 : null,
    delaiN: delais.length,
  };
}
export function indicateursDossiers(faits, ctx) {
  const vendus = lignes("vendu", faits, ctx);
  const ouverts = lignes("ouverts", faits, ctx);
  const annules = lignes("annules", faits, ctx);
  const total = arrondi(vendus.reduce((s, l) => s + l.montant, 0));
  const sejours = vendus.filter((l) => l.src.date_depart && l.src.date_retour && l.src.date_retour >= l.src.date_depart).map((l) => joursEntre(l.src.date_depart, l.src.date_retour) + 1);
  return {
    dossiers: vendus.length,
    panierMoyen: vendus.length ? arrondi(total / vendus.length) : null,
    clients: new Set(vendus.map((l) => l.src.client_id)).size,
    ouverts: ouverts.length,
    annules: annules.length,
    tauxAnnulation: ouverts.length ? Math.round((annules.length / ouverts.length) * 100) : null,
    sejourMoyen: sejours.length ? Math.round((sejours.reduce((s, n) => s + n, 0) / sejours.length) * 10) / 10 : null,
    sejourN: sejours.length,
  };
}
export function indicateursClients(faits, ctx) {
  const vendus = lignesFiltrees("vendu", faits, ctx);
  const par = grouper(vendus, "client");
  const nouveaux = new Set(vendus.filter((l) => !l.src.client_depuis || l.src.client_depuis >= ctx.du).map((l) => l.src.client_id));
  return { clients: par.length, nouveaux: nouveaux.size, recurrents: par.length - nouveaux.size };
}

// ---- Définitions affichées à l'écran (« Comment c'est calculé ») ------------------------------------------------------
export const DEFINITIONS = {
  vendu: [N_("Volume vendu"), N_("Valeur des services vendus sur la période, y compris ceux que le client paie directement au prestataire. Dossiers acceptés ou facturés, hors dossiers annulés. La date retenue est celle de la facture, sinon celle de l'acceptation, sinon celle du devis.")],
  facture: [N_("Facturé"), N_("Total à régler chez nous des factures émises sur la période, hors dossiers annulés. Les services payés sur place n'y sont pas : le client ne nous les paie pas.")],
  encaisse: [N_("Encaissé chez nous"), N_("Argent passé par nous : les paiements des clients datés de la période, remboursements déduits.")],
  a_encaisser: [N_("Reste à encaisser"), N_("Ce que les clients nous doivent encore sur les factures émises, à ce jour. Les services payés sur place n'entrent pas dans ce chiffre.")],
  devis_emis: [N_("Devis émis"), N_("Devis datés de la période, quel que soit leur sort.")],
  devis_acceptes: [N_("Devis acceptés"), N_("Parmi les devis émis sur la période, ceux dont le dossier est accepté. Le taux est la part des devis émis.")],
  devis_attente: [N_("Devis en attente"), N_("Devis ni acceptés, ni facturés, ni annulés, à ce jour. C'est le chiffre d'affaires possible.")],
  ouverts: [N_("Dossiers ouverts"), N_("Dossiers dont la date de référence tombe dans la période, annulés compris. Sert au taux d'annulation.")],
  annules: [N_("Dossiers annulés"), N_("Dossiers annulés dont la date de référence tombe dans la période.")],
  departs: [N_("Départs à venir"), N_("Dossiers acceptés ou facturés dont le départ est à venir.")],
  services: [N_("Services"), N_("Réservations auprès des partenaires dont la date de service tombe dans la période, hors annulées. Le montant est le prix de vente.")],
  services_nous: [N_("Services payés chez nous"), N_("Services dont le client nous paie le prix. Nous réglons ensuite le net au partenaire.")],
  services_place: [N_("Services payés sur place"), N_("Services que le client règle directement au prestataire. Le prestataire nous reverse ensuite une commission.")],
  a_venir: [N_("Services à venir"), N_("Réservations non annulées dont la date de service est aujourd'hui ou plus tard.")],
  a_venir_7: [N_("Services des 7 prochains jours"), N_("Réservations non annulées dont la date de service tombe entre aujourd'hui et dans six jours.")],
  a_confirmer: [N_("Services à confirmer"), N_("Réservations non annulées, à venir, que le partenaire n'a pas encore confirmées.")],
  sans_date: [N_("Services sans date"), N_("Réservations non annulées dont la date de service n'est pas encore fixée.")],
  commission_prevue: [N_("Commissions prévues"), N_("Commissions attendues sur les services payés sur place dont la date de service tombe dans la période. Montant saisi sur chaque réservation.")],
  commission_recue: [N_("Commissions reçues"), N_("Commissions encaissées, datées par leur jour de réception.")],
  commission_a_recevoir: [N_("Commissions à recevoir"), N_("Commission prévue moins commission reçue, sur tous les services payés sur place non annulés, à ce jour.")],
  commission_a_renseigner: [N_("Commission non saisie"), N_("Services payés sur place dont la commission prévue n'est pas encore notée sur la réservation.")],
  net_paye: [N_("Nets payés aux partenaires"), N_("Nets réglés aux partenaires, datés par leur jour de paiement.")],
  net_a_payer: [N_("Nets à payer"), N_("Net prévu moins net payé sur les services payés chez nous, à ce jour.")],
  marge: [N_("Marge prévue"), N_("Services de la période : prix de vente moins net quand le client paie chez nous, commission prévue quand il paie sur place. Les services sans net ni commission saisis sont comptés à part.")],
  marge_inconnue: [N_("Marge inconnue"), N_("Services de la période dont le net ou la commission n'est pas saisi. Leur marge n'est pas devinée.")],
  revenu: [N_("Revenu"), N_("Encaissé chez nous, moins les nets payés aux partenaires, plus les commissions reçues. Chaque élément est daté par le jour où l'argent a bougé.")],
};
