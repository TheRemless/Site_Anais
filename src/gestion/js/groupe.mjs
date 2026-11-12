// Vue d'ensemble des sociétés : les chiffres de chaque entreprise (calculés par la base) sont ramenés dans une
// seule devise de consolidation pour pouvoir les comparer et les additionner. Logique pure, testée.
import { arrondi, ajouterJours, joursEntre } from "./calc.mjs";

const arrondi6 = (n) => Math.round(n * 1e6) / 1e6;

// Taux « 1 unité de la devise = x unités de la devise de consolidation », déduits des réglages des entreprises.
// Chaque entreprise connaît « 1 unité de sa devise en euros et en bahts » : on en tire ce qu'on peut, la première trouvée gagne.
export function tauxDepuisReglages(entreprises, cible) {
  const taux = { [cible]: 1 };
  const source = {};
  for (const r of entreprises) {
    const base = r.devise;
    const t = r.taux || {};
    if (base === cible) {
      for (const [k, v] of Object.entries(t)) {
        const code = k.toUpperCase();
        if (Number(v) > 0 && !(code in taux)) {
          taux[code] = arrondi6(1 / Number(v));
          source[code] = r.nom;
        }
      }
    } else if (base && Number(t[cible.toLowerCase()]) > 0 && !(base in taux)) {
      taux[base] = Number(t[cible.toLowerCase()]);
      source[base] = r.nom;
    }
  }
  return { taux, source };
}

export const convertir = (montant, devise, cible, taux) => (devise === cible ? Number(montant) : Number(taux[devise]) > 0 ? Number(montant) * Number(taux[devise]) : null);

// Somme de lignes {devise, montant} en devise de consolidation. Les devises sans taux sont mises de côté, jamais devinées.
export function sommeConvertie(lignes, cible, taux) {
  let total = 0;
  const manquantes = new Set();
  for (const l of lignes || []) {
    const v = convertir(l.montant, l.devise, cible, taux);
    if (v === null) manquantes.add(l.devise);
    else total += v;
  }
  return { montant: arrondi(total), manquantes: [...manquantes] };
}

// La période de même longueur qui précède immédiatement.
export function periodePrecedente(du, au) {
  const n = joursEntre(du, au) + 1;
  return [ajouterJours(du, -n), ajouterJours(du, -1)];
}

export const evolution = (actuel, precedent) => (precedent > 0 ? Math.round(((actuel - precedent) / precedent) * 100) : null);

const nombre = (lignes) => (lignes || []).reduce((t, x) => t + Number(x.nombre || 0), 0);

// Chiffres d'une entreprise sur la période, convertis dans la devise de consolidation.
export function syntheseEntite({ entite, donnees, precedent, cible, taux }) {
  const somme = (l) => sommeConvertie(l, cible, taux);
  const facture = somme(donnees.facture_par_mois);
  const encaisse = somme(donnees.encaisse_par_mois);
  const impayes = somme(donnees.impayes);
  const pipeline = somme(donnees.pipeline);
  const nbFactures = nombre(donnees.facture_par_mois);
  const prec = precedent ? { facture: somme(precedent.facture_par_mois).montant, encaisse: somme(precedent.encaisse_par_mois).montant } : null;
  const activite = donnees.activite || {};
  return {
    entite,
    facture: facture.montant,
    encaisse: encaisse.montant,
    impayes: impayes.montant,
    pipeline: pipeline.montant,
    nbFactures,
    nbImpayes: nombre(donnees.impayes),
    nbPipeline: nombre(donnees.pipeline),
    panierMoyen: nbFactures ? arrondi(facture.montant / nbFactures) : null,
    devisEmis: Number(donnees.devis.emis) || 0,
    devisAcceptes: Number(donnees.devis.acceptes) || 0,
    tauxAcceptation: donnees.devis.emis ? Math.round((donnees.devis.acceptes / donnees.devis.emis) * 100) : null,
    delaiMoyen: donnees.devis.delai_moyen_jours ?? null,
    dossiers: Number(activite.dossiers) || 0,
    clients: Number(activite.clients) || 0,
    evolFacture: prec ? evolution(facture.montant, prec.facture) : null,
    evolEncaisse: prec ? evolution(encaisse.montant, prec.encaisse) : null,
    precedent: prec,
    manquantes: [...new Set([...facture.manquantes, ...encaisse.manquantes, ...impayes.manquantes, ...pipeline.manquantes])],
  };
}

// Total du groupe et part de chaque société dans le facturé.
export function consolider(syntheses) {
  const tot = { facture: 0, encaisse: 0, impayes: 0, pipeline: 0, nbFactures: 0, nbImpayes: 0, nbPipeline: 0, devisEmis: 0, devisAcceptes: 0, dossiers: 0, clients: 0, precFacture: 0, precEncaisse: 0, avecPrecedent: false, manquantes: [] };
  const manquantes = new Set();
  for (const s of syntheses) {
    for (const k of ["facture", "encaisse", "impayes", "pipeline", "nbFactures", "nbImpayes", "nbPipeline", "devisEmis", "devisAcceptes", "dossiers", "clients"]) tot[k] += s[k];
    if (s.precedent) {
      tot.avecPrecedent = true;
      tot.precFacture += s.precedent.facture;
      tot.precEncaisse += s.precedent.encaisse;
    }
    s.manquantes.forEach((d) => manquantes.add(d));
  }
  for (const k of ["facture", "encaisse", "impayes", "pipeline", "precFacture", "precEncaisse"]) tot[k] = arrondi(tot[k]);
  tot.manquantes = [...manquantes];
  tot.tauxAcceptation = tot.devisEmis ? Math.round((tot.devisAcceptes / tot.devisEmis) * 100) : null;
  tot.panierMoyen = tot.nbFactures ? arrondi(tot.facture / tot.nbFactures) : null;
  tot.evolFacture = tot.avecPrecedent ? evolution(tot.facture, tot.precFacture) : null;
  tot.evolEncaisse = tot.avecPrecedent ? evolution(tot.encaisse, tot.precEncaisse) : null;
  tot.parts = syntheses.map((s) => ({ entite: s.entite, part: tot.facture > 0 ? Math.round((s.facture / tot.facture) * 100) : null }));
  return tot;
}

// Séries mensuelles par société, converties : [{ entite, valeurs: { "2026-10": 1234 } }]. Les montants sans taux sont ignorés.
export function seriesMensuelles(parEntite, cle, cible, taux) {
  return parEntite.map(({ entite, donnees }) => {
    const valeurs = {};
    for (const x of donnees[cle] || []) {
      const v = convertir(x.montant, x.devise, cible, taux);
      if (v !== null) valeurs[x.mois] = arrondi((valeurs[x.mois] || 0) + v);
    }
    return { entite, valeurs };
  });
}

// Classement toutes sociétés confondues (meilleurs clients, destinations), converti.
export function classementGroupe(parEntite, cle, champ, cible, taux, limite = 8) {
  const lignes = [];
  for (const { entite, donnees } of parEntite) {
    for (const x of donnees[cle] || []) {
      const v = convertir(x.montant, x.devise, cible, taux);
      if (v !== null) lignes.push({ libelle: x[champ] || "—", entite: entite.nom, montant: arrondi(v), nombre: x.nombre });
    }
  }
  // Un même libellé peut apparaître en plusieurs devises dans une société : on regroupe.
  const m = new Map();
  for (const l of lignes) {
    const k = `${l.entite}\u0000${l.libelle}`;
    const e = m.get(k) || { ...l, montant: 0, nombre: 0 };
    e.montant = arrondi(e.montant + l.montant);
    e.nombre += l.nombre;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.montant - a.montant || a.libelle.localeCompare(b.libelle)).slice(0, limite);
}

// Entreprises proposées dans l'outil : VIP Taxi Lanta reste en dehors tant qu'il n'a aucun dossier (décision du 12.11.2026).
// Rien n'est supprimé : dès qu'un dossier existe pour lui, il réapparaît. Jamais de liste vide (une personne qui n'a que Taxi le garde).
export function entreprisesVisibles(entites, dossiers) {
  const avecDossier = new Set((dossiers || []).map((d) => d.entite_id));
  const gardees = entites.filter((e) => e.slug !== "taxi" || avecDossier.has(e.id));
  return gardees.length ? gardees : entites;
}
