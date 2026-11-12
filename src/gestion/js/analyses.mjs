// Tableau analytique calculé dans le navigateur. Sert à la démonstration et de référence pour la fonction SQL
// `analyse` : les deux doivent donner exactement les mêmes chiffres (voir tests/gestion-analyses.test.js).
import { totaux, arrondi, joursEntre, montantSurPlace } from "./calc.mjs";
import { dateFinService } from "./operations-calc.mjs";

const mois = (iso) => iso.slice(0, 7);
const dans = (iso, du, au) => !!iso && iso >= du && iso <= au;
const nomPersonne = (p) => ((p && (p.nom || p.email)) || "").trim();

function groupe(lignes, cle, valeurs) {
  const m = new Map();
  for (const l of lignes) {
    const k = cle(l);
    const v = valeurs(l);
    const e = m.get(k.join("\u0000")) || { cle: k, montant: 0, nombre: 0 };
    e.montant += v;
    e.nombre += 1;
    m.set(k.join("\u0000"), e);
  }
  return [...m.values()];
}

export function analyserLocal({ dossiers, documents, paiements, clients, profils, reglages }, du, au, jour) {
  const devDefaut = reglages.devise || "";
  const plusRecent = (id, type) =>
    documents
      .filter((d) => d.dossier_id === id && d.type === type)
      .sort((a, b) => (a.date_emission === b.date_emission ? (a.created_at < b.created_at ? 1 : -1) : a.date_emission < b.date_emission ? 1 : -1))[0];

  const dos = dossiers.map((d) => ({ d, f: plusRecent(d.id, "facture"), v: plusRecent(d.id, "devis") }));
  const tot = dos
    .filter((x) => x.f || x.v)
    .map((x) => {
      const doc = x.f || x.v;
      const total = totaux(doc.contenu).net;
      const recu = arrondi(paiements.filter((p) => p.dossier_id === x.d.id).reduce((s, p) => s + Number(p.montant), 0));
      return { ...x, total, recu, devise: doc.contenu.devise || devDefaut, dateRef: (x.f && x.f.date_emission) || x.d.accepte_le || (x.v && x.v.date_emission) };
    });
  const parId = new Map(tot.map((t) => [t.d.id, t]));
  const retenus = tot.filter((t) => !t.d.annule && (t.d.accepte_le || t.f) && dans(t.dateRef, du, au));

  const trier = (a, b) => a.cle[0].localeCompare(b.cle[0]) || (a.cle[1] || "").localeCompare(b.cle[1] || "");
  const parMois = (lignes, cleMois, devise, valeur) =>
    groupe(lignes, (l) => [cleMois(l), devise(l)], valeur)
      .sort(trier)
      .map((g) => ({ mois: g.cle[0], devise: g.cle[1], montant: arrondi(g.montant), nombre: g.nombre }));

  // Une facture par dossier (la dernière) et pas de dossier annulé : « Facturé » moins « Encaissé » retombe alors sur les impayés.
  const facturesPeriode = dos.filter((x) => x.f && !x.d.annule && dans(x.f.date_emission, du, au)).map((x) => x.f);
  const devisPeriode = dos.filter((x) => x.v && dans(x.v.date_emission, du, au));
  const delais = devisPeriode.filter((x) => x.d.accepte_le && x.d.accepte_le >= x.v.date_emission).map((x) => joursEntre(x.v.date_emission, x.d.accepte_le));

  const tranche = (age) => (age <= 30 ? [1, "0-30"] : age <= 60 ? [2, "31-60"] : age <= 90 ? [3, "61-90"] : [4, "90+"]);
  const impayes = groupe(
    tot.filter((t) => !t.d.annule && t.f && arrondi(t.total - t.recu) > 0),
    (t) => [tranche(joursEntre(t.f.date_emission, jour)).join("|"), t.devise],
    (t) => t.total - t.recu
  )
    .map((g) => {
      const [ordre, nom] = g.cle[0].split("|");
      return { ordre: Number(ordre), tranche: nom, devise: g.cle[1], montant: arrondi(g.montant), nombre: g.nombre };
    })
    .sort((a, b) => a.ordre - b.ordre || a.devise.localeCompare(b.devise))
    .map(({ tranche: t, devise, montant, nombre }) => ({ tranche: t, devise, montant, nombre }));

  const clientNom = (id) => {
    const c = clients.find((x) => x.id === id);
    return [c && c.prenom, c && c.nom].filter(Boolean).join(" ").trim();
  };
  const classer = (g) => g.sort((a, b) => b.montant - a.montant || String(a.cle[0]).localeCompare(String(b.cle[0])));
  const sortie = (g, nomCle) => g.map((x) => ({ [nomCle]: x.cle[0], devise: x.cle[1], montant: arrondi(x.montant), nombre: x.nombre }));

  return {
    facture_par_mois: parMois(facturesPeriode, (x) => mois(x.date_emission), (x) => x.contenu.devise || devDefaut, (x) => totaux(x.contenu).net),
    encaisse_par_mois: parMois(paiements.filter((p) => dans(p.date, du, au)), (p) => mois(p.date), (p) => (parId.get(p.dossier_id) || {}).devise || devDefaut, (p) => Number(p.montant)),
    devis: {
      emis: devisPeriode.length,
      acceptes: devisPeriode.filter((x) => x.d.accepte_le).length,
      delai_moyen_jours: delais.length ? Math.round((delais.reduce((s, n) => s + n, 0) / delais.length) * 10) / 10 : null,
    },
    impayes,
    top_clients: sortie(classer(groupe(retenus, (t) => [t.d.client_id, t.devise], (t) => t.total)), "client").slice(0, 10).map((x) => ({ ...x, client: clientNom(x.client) })),
    par_pays: sortie(classer(groupe(retenus, (t) => [t.d.pays || "Non renseigné", t.devise], (t) => t.total)), "pays"),
    par_responsable: sortie(
      classer(groupe(retenus, (t) => [nomPersonne(profils.find((p) => p.user_id === t.d.responsable_id)) || "Sans responsable", t.devise], (t) => t.total)),
      "responsable"
    ),
    // Devis en attente au jour donné : émis, ni acceptés, ni annulés, ni facturés.
    pipeline: groupe(
      tot.filter((t) => !t.d.annule && !t.d.accepte_le && !t.f && t.v && t.v.date_emission <= jour),
      (t) => [t.devise],
      (t) => t.total
    )
      .sort((a, b) => a.cle[0].localeCompare(b.cle[0]))
      .map((g) => ({ devise: g.cle[0], montant: arrondi(g.montant), nombre: g.nombre })),
    activite: { dossiers: retenus.length, clients: new Set(retenus.map((t) => t.d.client_id)).size },
  };
}

// ---- Faits pour les statistiques détaillées -----------------------------------------------------------------------
// Miroir de la fonction SQL `analyse_faits` (migration 20) : un enregistrement par dossier, paiement et réservation, avec les
// montants déjà calculés. Les indicateurs sont tirés de ces faits par stats-calc.mjs. Les deux versions doivent donner
// exactement les mêmes faits (voir tests/gestion-stats.test.js et docs/gestion/verif-analyses.mjs).
//   debut, fin : fenêtre de dates à couvrir ; jour : aujourd'hui ; nets : la personne a le droit « nets des partenaires ».
const nombreOuNull = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const entier = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function faitsLocal(source, { debut, fin, jour, nets }) {
  const { dossiers, documents, paiements, clients, profils, reglages } = source;
  const reservations = source.reservations || [];
  const reservationsNets = source.reservations_nets || [];
  const partenaires = source.partenaires || [];
  const prestations = source.prestations || [];
  const devDefaut = reglages.devise || "";
  const plusRecent = (id, type) =>
    documents
      .filter((d) => d.dossier_id === id && d.type === type)
      .sort((a, b) => (a.date_emission === b.date_emission ? (a.created_at < b.created_at ? 1 : -1) : a.date_emission < b.date_emission ? 1 : -1))[0];
  const clientNom = (id) => {
    const c = clients.find((x) => x.id === id);
    return [c && c.prenom, c && c.nom].filter(Boolean).join(" ").trim();
  };
  const dans = (iso, du, au) => !!iso && iso >= du && iso <= au;

  const tous = dossiers.map((d) => {
    const f = plusRecent(d.id, "facture");
    const v = plusRecent(d.id, "devis");
    const doc = f || v;
    const total = doc ? totaux(doc.contenu).net : 0;
    const surPlace = doc ? montantSurPlace(doc.contenu) : 0;
    const recu = arrondi(paiements.filter((p) => p.dossier_id === d.id).reduce((s, p) => s + Number(p.montant), 0));
    const p = profils.find((x) => x.user_id === d.responsable_id);
    return {
      id: d.id,
      ref: d.ref || "",
      client_id: d.client_id,
      client: clientNom(d.client_id),
      pays: d.pays || null,
      responsable: ((p && (p.nom || "").trim()) || (p && (p.email || "").trim()) || null) || null,
      accepte_le: d.accepte_le || null,
      annule: !!d.annule,
      date_depart: d.date_depart || null,
      date_retour: d.date_retour || null,
      f_date: f ? f.date_emission : null,
      v_date: v ? v.date_emission : null,
      devise: (doc && doc.contenu.devise) || devDefaut,
      total,
      sur_place: surPlace,
      recu,
      client_depuis: null,
      _doc: !!doc,
    };
  });
  const parId = new Map(tous.map((x) => [x.id, x]));
  const avecDoc = tous.filter((x) => x._doc);
  const depuis = new Map();
  for (const x of avecDoc) {
    if (x.annule || !(x.accepte_le || x.f_date)) continue;
    const r = x.f_date || x.accepte_le || x.v_date;
    if (!depuis.has(x.client_id) || r < depuis.get(x.client_id)) depuis.set(x.client_id, r);
  }
  for (const x of avecDoc) x.client_depuis = depuis.get(x.client_id) || null;

  const pertinent = (x) => {
    const r = x.f_date || x.accepte_le || x.v_date;
    const reste = arrondi(x.total - x.recu);
    return (
      dans(r, debut, fin) || dans(x.v_date, debut, fin) || dans(x.accepte_le, debut, fin) || dans(x.f_date, debut, fin) ||
      (!x.annule && !!x.f_date && reste > 0) ||
      (!x.annule && !x.accepte_le && !x.f_date && !!x.v_date && x.v_date <= jour) ||
      (!!x.date_depart && x.date_depart >= jour)
    );
  };
  const dossiersFaits = avecDoc.filter(pertinent).map(({ _doc, ...x }) => x);

  const paiementsFaits = paiements
    .filter((p) => dans(p.date, debut, fin) && parId.has(p.dossier_id))
    .map((p) => {
      const x = parId.get(p.dossier_id);
      return { id: p.id, dossier_id: p.dossier_id, ref: x.ref, client: x.client, date: p.date, montant: Number(p.montant), moyen: p.moyen || null, type: p.type || null, devise: x.devise };
    });

  const netsDe = new Map(reservationsNets.map((n) => [n.reservation_id, n]));
  const reservationsFaits = reservations
    .filter((r) => parId.has(r.dossier_id))
    .map((r) => {
      const x = parId.get(r.dossier_id);
      const n = nets ? netsDe.get(r.id) || {} : {};
      const pr = prestations.find((p) => p.id === r.prestation_id);
      const pa = partenaires.find((p) => p.id === r.partenaire_id);
      const pers = r.personnes || {};
      return {
        id: r.id,
        dossier_id: r.dossier_id,
        ref: x.ref,
        client: x.client,
        devise: x.devise,
        dossier_annule: x.annule,
        libelle: r.libelle || "",
        partenaire_id: r.partenaire_id || null,
        partenaire: pa ? pa.nom : null,
        famille: (pr && pr.famille) || (r.trajet_id ? "billet" : "autre"),
        date_service: r.date_service || null,
        date_fin: dateFinService(r),
        statut: r.statut,
        montant_vente: nombreOuNull(r.montant_vente),
        paye_sur_place: !!r.paye_sur_place,
        adultes: entier(pers.adultes),
        enfants: entier(pers.enfants),
        bebes: entier(pers.bebes),
        net_prevu: nombreOuNull(n.net_prevu),
        net_paye: nombreOuNull(n.net_paye),
        paye_le: n.paye_le || null,
        commission_prevue: nombreOuNull(n.commission_prevue),
        commission_recue: nombreOuNull(n.commission_recue),
        commission_recue_le: n.commission_recue_le || null,
      };
    })
    .filter((r) => {
      const actif = r.statut !== "annule" && !r.dossier_annule;
      return (
        !r.date_service || dans(r.date_service, debut, fin) || r.date_service >= jour ||
        (nets && (dans(r.commission_recue_le, debut, fin) || dans(r.paye_le, debut, fin))) ||
        (nets && actif && r.paye_sur_place && !r.commission_recue_le && (r.commission_prevue === null || arrondi(r.commission_prevue - (r.commission_recue || 0)) > 0)) ||
        (nets && actif && !r.paye_sur_place && r.net_prevu !== null && arrondi(r.net_prevu - (r.net_paye || 0)) > 0)
      );
    });

  return { nets: !!nets, devise_defaut: devDefaut, dossiers: dossiersFaits, paiements: paiementsFaits, reservations: reservationsFaits };
}
