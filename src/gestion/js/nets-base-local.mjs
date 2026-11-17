// Le net et la commission prévus d'une réservation, calculés comme la base (migration 30 : net_reservation_calcule, calculer_nets_reservation,
// remplir_nets_reservation), pour la démo (store-local.mjs) : sans ce miroir, la démo ne recalculait rien et un enfant ajouté après coup laissait
// le net prévu à l'ancien montant (contrôle du 17.11.2026, D2). Logique pure, testée avec node --test et comparée à la base dans
// verif-securite-argent.mjs. Toute règle changée ici doit l'être aussi dans la migration (et l'inverse).
import { commissionPrevue } from "./operations-calc.mjs";
import { quantiteParDefaut } from "./partenaires-calc.mjs";

// `Number(x)` de la base (nombre_json) : un nombre, ou un texte qui en est un, sinon null.
export function nombre(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}
const arr = (x) => Math.round(x * 100) / 100;
const vide = (v) => v === null || v === undefined;

// Ligne enfant, comme la base : « (per child) » dans l'intro, ou « , child » à la fin du nom.
const ligneEnfant = (l) => /(enfant|child)/i.test(String(l.intro || "")) || /,\s*(child|enfant)\b/i.test(String((l.titre || "").trim() ? l.titre : l.libelle || ""));

// Net du catalogue pour une ligne : trajet (net adulte ou enfant), sinon prestation (net, ou net enfant s'il existe pour une ligne enfant).
// Un frais réglé sur place par le client n'a pas de net chez nous.
function netCatalogue(l, db, enfant) {
  if (l.trajet_id) {
    const n = (db.trajets_nets || []).find((x) => x.trajet_id === l.trajet_id);
    if (!n) return null;
    return nombre(enfant ? n.net_enfant : n.net_adulte);
  }
  if (l.prestation_id) {
    const p = (db.prestations || []).find((x) => x.id === l.prestation_id);
    const n = (db.prestations_nets || []).find((x) => x.prestation_id === l.prestation_id);
    if (!p || p.sur_place || !n) return null;
    return enfant ? nombre(n.net_enfant) ?? nombre(n.net) : nombre(n.net);
  }
  return null;
}

// { net, complet } : le net prévu d'après les lignes de facture qui ont donné la réservation, sinon d'après son tarif et ses personnes.
// `db` : { documents, prestations, prestations_nets, trajets, trajets_nets }. En démo, le net d'une ligne vit dans la ligne (`net`) : il tient
// le rôle de documents_nets.
export function netReservationCalcule(r, db) {
  let net = null;
  let complet = true;
  const p = r.personnes || {};
  const a = nombre(p.adultes) || 0;
  const e = nombre(p.enfants) || 0;
  const ids = [...new Set([r.ligne_id || null, ...(Array.isArray(r.details && r.details.lignes_ids) ? r.details.lignes_ids : [])].filter(Boolean))];
  let trouve = false;
  if (ids.length) {
    const doc = (db.documents || [])
      .filter((d) => d.dossier_id === r.dossier_id && ["facture", "devis"].includes(d.type) && Array.isArray(d.contenu && d.contenu.lignes) && d.contenu.lignes.some((l) => ids.includes(l.id)))
      .sort((x, y) => (y.type === "facture") - (x.type === "facture") || String(y.updated_at || "").localeCompare(String(x.updated_at || "")))[0];
    if (doc) {
      for (const l of doc.contenu.lignes.filter((x) => ids.includes(x.id) && !["texte", "remise"].includes(x.kind || "ligne"))) {
        trouve = true;
        const q = nombre(l.qte) ?? 1;
        const brut = nombre(l.unite) !== null && nombre(l.qte) !== null ? nombre(l.unite) * nombre(l.qte) : nombre(l.montant);
        const ln = nombre(l.net) ?? netCatalogue(l, db, ligneEnfant(l));
        if (ln !== null) net = (net || 0) + arr(ln * q);
        else if ((brut || 0) > 0) complet = false;
      }
    }
  }
  if (trouve) return { net: complet && net !== null ? arr(net) : null, complet };
  if (r.trajet_id) {
    const t = (db.trajets || []).find((x) => x.id === r.trajet_id) || {};
    const tn = (db.trajets_nets || []).find((x) => x.trajet_id === r.trajet_id) || {};
    if (a > 0) {
      if (nombre(tn.net_adulte) !== null) net = arr(nombre(tn.net_adulte) * a);
      else complet = false;
    }
    if (e > 0 && !vide(t.prix_enfant)) {
      if (nombre(tn.net_enfant) !== null) net = (net || 0) + arr(nombre(tn.net_enfant) * e);
      else complet = false;
    }
    return { net: complet ? net : null, complet };
  }
  if (r.prestation_id) {
    const x = (db.prestations || []).find((y) => y.id === r.prestation_id);
    if (!x || x.sur_place) return { net: null, complet: false };
    const pn = (db.prestations_nets || []).find((y) => y.prestation_id === x.id) || {};
    const jours = nombre(r.details && r.details.jours);
    const q = x.unite === "day" ? Math.max(1, jours || 1) : quantiteParDefaut(x.unite, { adultes: a, enfants: e });
    return nombre(pn.net) !== null ? { net: arr(nombre(pn.net) * q), complet: true } : { net: null, complet: false };
  }
  return { net: null, complet: false };
}

// Égalité de deux montants de la base : deux valeurs vides ne sont pas égales (comme `=` en SQL).
const egal = (x, y) => !vide(x) && !vide(y) && Number(x) === Number(y);

// Les valeurs à écrire dans reservations_nets pour la réservation `r` (`n` : sa ligne de nets actuelle, ou null), ou null quand rien ne change.
// `db` : en plus de netReservationCalcule, { dossiers, partenaires_prives, excursions(entite_id) }. Mêmes règles que calculer_nets_reservation :
// une valeur saisie à la main (différente de la dernière valeur calculée) n'est jamais réécrite, un net payé ou une commission reçue ne bouge plus.
export function calculerNets(r, n, db, { videsSeulement = false, suivreNet = true } = {}) {
  if (!r || r.statut === "annule" || !db.excursions(r.entite_id)) return null;
  if ((db.dossiers || []).some((d) => d.id === r.dossier_id && d.annule)) return null;
  const netGere = !n || (vide(n.net_paye) && vide(n.paye_le) && (vide(n.net_prevu) || (suivreNet && !videsSeulement && egal(n.net_prevu, n.net_prevu_auto))));
  const comGere = !n || (vide(n.commission_recue) && vide(n.commission_recue_le) && (vide(n.commission_prevue) || (!videsSeulement && egal(n.commission_prevue, n.commission_prevue_auto))));
  if (!netGere && !comGere) return null;
  const c = netReservationCalcule(r, db);
  let net = netGere ? c.net : n.net_prevu ?? null;
  let netAuto = netGere ? c.net : n.net_prevu_auto ?? null;
  let com = n ? n.commission_prevue ?? null : null;
  let comAuto = n ? n.commission_prevue_auto ?? null : null;
  if (comGere) {
    let v = null;
    if (r.paye_sur_place && r.partenaire_id) {
      const regle = ((db.partenaires_prives || []).find((x) => x.partenaire_id === r.partenaire_id) || {}).commission_regle || null;
      const netPourCom = netGere ? (c.complet ? c.net : null) : n.net_prevu ?? null;
      const p = r.personnes || {};
      v = commissionPrevue(regle, { vente: vide(r.montant_vente) ? null : Number(r.montant_vente), net: vide(netPourCom) ? null : Number(netPourCom), adultes: nombre(p.adultes) || 0, enfants: nombre(p.enfants) || 0 });
    }
    com = comAuto = v ?? null;
  }
  if (videsSeulement) {
    if (vide(net)) netAuto = n ? n.net_prevu_auto ?? null : null;
    if (vide(com)) comAuto = n ? n.commission_prevue_auto ?? null : null;
  }
  const valeurs = { net_prevu: net, net_prevu_auto: netAuto, commission_prevue: com, commission_prevue_auto: comAuto };
  if (!n) return vide(net) && vide(com) ? null : valeurs;
  const meme = (x, y) => (vide(x) ? vide(y) : !vide(y) && Number(x) === Number(y));
  return Object.keys(valeurs).every((k) => meme(valeurs[k], n[k])) ? null : valeurs;
}

// JSON comparé comme jsonb : l'ordre des clés ne compte pas.
const stable = (v) => (v && typeof v === "object" ? (Array.isArray(v) ? `[${v.map(stable).join(",")}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`) : JSON.stringify(v ?? null));
const differe = (x, y) => stable(x) !== stable(y);

// Ce que fait le déclencheur remplir_nets après une écriture de réservation (`avant` : null pour une création). null : rien à recalculer ;
// sinon { suivreNet } (faux quand seuls le prix vendu, le mode ou le partenaire changent : le net calculé reste celui de la vente).
export function suiviDeclencheur(avant, apres) {
  if (!avant) return { suivreNet: true };
  const d = (r) => r.details || {};
  const net = ["prestation_id", "trajet_id", "personnes", "ligne_id", "statut"].some((k) => differe(avant[k], apres[k])) || differe(d(avant).jours, d(apres).jours) || differe(d(avant).lignes_ids, d(apres).lignes_ids);
  const autre = ["partenaire_id", "paye_sur_place", "montant_vente"].some((k) => differe(k === "paye_sur_place" ? !!avant[k] : avant[k], k === "paye_sur_place" ? !!apres[k] : apres[k]));
  return net || autre ? { suivreNet: net } : null;
}
