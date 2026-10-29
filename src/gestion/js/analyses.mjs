// Tableau analytique calculé dans le navigateur. Sert à la démonstration et de référence pour la fonction SQL
// `analyse` : les deux doivent donner exactement les mêmes chiffres (voir tests/gestion-analyses.test.js).
import { totaux, arrondi, joursEntre } from "./calc.mjs";

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

  const facturesPeriode = documents.filter((x) => x.type === "facture" && dans(x.date_emission, du, au));
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
  };
}
