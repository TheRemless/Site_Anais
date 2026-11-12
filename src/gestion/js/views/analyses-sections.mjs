// Les huit sections des statistiques et la liste « derrière le chiffre ». Chaque section reçoit un contexte X (faits, période,
// devise, adresses) et rend des nœuds ; les calculs sont tous dans stats-calc.mjs. Tout chiffre ouvre la liste qui le compose.
import { h } from "../ui.mjs";
import { formatMontant, formatDate, ajouterJours } from "../calc.mjs";
import { tr, N_, pluriel, moisLong, moisCourt } from "../i18n.mjs";
import * as S from "../stats-calc.mjs";
import { MOYENS_DEFAUT } from "../defauts.mjs";
import { STATUTS_RESERVATION } from "../operations-calc.mjs";
import { nomFamille } from "../partenaires-calc.mjs";
import { tuile, graphiqueColonnes, legende, classement, tableauTrie, blocDefinitions } from "./analyses-widgets.mjs";

const SPECIAUX = [N_("Non renseigné"), N_("Sans responsable"), N_("Sans partenaire"), N_("Non précisé")];

// ---- Libellés des valeurs de dimension ---------------------------------------------------------------------------------
export const libelleMoisCourt = (m) => `${moisCourt(`${m}-01`)} ${m.slice(2, 4)}`;
const jourCourt = (iso) => `${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`;
export function libelleGroupe(dim, g) {
  const k = g.cle;
  switch (dim) {
    case "mois": return `${moisLong(`${k}-01`)} ${k.slice(0, 4)}`;
    case "semaine": return tr("Semaine du {date}", { date: jourCourt(k) });
    case "jour": return formatDate(k);
    case "saison": return moisLong(`2000-${k}-01`);
    case "tranche": return tr("{tranche} jours", { tranche: k });
    case "famille": return k === "billet" ? tr("Billets de bateau") : nomFamille(k);
    case "statut": return STATUTS_RESERVATION[k] ? tr(STATUTS_RESERVATION[k]) : k;
    case "moyen": { const m = MOYENS_DEFAUT.find((x) => x.id === k); return m ? tr(m.label) : SPECIAUX.includes(k) ? tr(k) : k; }
    case "paiement": return k === "place" ? tr("Payé sur place") : tr("Payé chez nous");
    case "nature": return tr(k);
    case "nouveaute": return k === "nouveau" ? tr("Nouveaux clients") : tr("Clients récurrents");
    default: return SPECIAUX.includes(k) ? tr(k) : g.libelle || String(k);
  }
}
const TITRE_DIM = { mois: N_("Mois"), semaine: N_("Semaine"), jour: N_("Jour"), saison: N_("Mois de l'année"), pays: N_("Destination"), responsable: N_("Responsable"), client: N_("Client"), partenaire: N_("Partenaire"), famille: N_("Type de service"), prestation: N_("Prestation"), moyen: N_("Moyen de paiement"), statut: N_("Statut"), tranche: N_("Ancienneté"), nature: N_("Nature"), paiement: N_("Paiement"), nouveaute: N_("Clientèle") };

const titreMesure = (id) => tr(S.DEFINITIONS[id][0]);
const compte = (n, id) => {
  if (id === "revenu") return pluriel(n, N_("mouvement d'argent"), N_("mouvements d'argent"));
  const src = S.MESURES[id].source;
  return src === "dossiers" ? pluriel(n, N_("dossier"), N_("dossiers")) : src === "paiements" ? pluriel(n, N_("paiement"), N_("paiements")) : pluriel(n, N_("service"), N_("services"));
};
const m$ = (X, v) => formatMontant(v, X.devise);

// ---- Briques communes ---------------------------------------------------------------------------------------------------
// Tuile d'une mesure : chiffre, écart, mini graphique, lien vers la liste.
function T(X, id, { libelle, valeur, detail, grande, href, mini = true } = {}) {
  const r = S.comparer(id, X.faits, X.c, X.cmp);
  const serie = mini && S.estFlux(id) ? S.serie(id, X.faits, X.c, X.gran).map((x) => x.montant) : null;
  return tuile({ libelle: libelle || titreMesure(id), valeur: valeur ?? m$(X, r.actuel.montant), detail: detail === undefined ? compte(r.actuel.nombre, id) : detail, ecart: r.ecart, precedent: r.precedent ? r.precedent.montant : null, devise: X.devise, serie, href: href === undefined ? X.href(id) : href, aide: S.DEFINITIONS[id], grande });
}

// Classement d'une mesure par dimension ; chaque ligne ouvre sa liste.
function rang(X, id, dim, { max = 7, tri } = {}) {
  const groupes = S.grouper(S.lignesFiltrees(id, X.faits, X.c), dim, { tri });
  const lignes = groupes.map((g) => ({ libelle: libelleGroupe(dim, g), valeur: g.montant, texte: m$(X, g.montant), detail: compte(g.nombre, id), href: X.href(id, `${dim}:${g.cle}`) }));
  for (const g of groupes) X.sortie.push([tr(TITRE_DIM[dim]), libelleGroupe(dim, g), X.devise, g.montant, g.nombre]);
  return classement({ lignes, max, total: (v) => m$(X, v) });
}

const titre = (texte, ...suite) => h("h2", { class: "st-titre" }, tr(texte), ...suite);
const bloc = (...enfants) => h("section", { class: "st-bloc" }, enfants);
const tuiles = (...t) => h("div", { class: "st-tuiles" }, t.filter(Boolean));

const puces = (X) => h("div", { class: "st-gran", role: "group", "aria-label": tr("Découpage du graphique") }, [["jour", N_("Jour")], ["semaine", N_("Semaine")], ["mois", N_("Mois")]].map(([g, l]) => h("a", { class: "st-puce petite", href: X.param({ g }), "aria-current": X.gran === g ? "true" : null }, tr(l))));

// Cases d'un graphique dans le découpage choisi : étiquette courte sous la colonne, libellé complet à la lecture.
function casesDe(X) {
  return S.casesDe(X.du, X.au, X.gran).map((k, i) => ({
    cle: k,
    court: X.gran === "mois" ? libelleMoisCourt(k) : X.gran === "semaine" ? jourCourt(k) : Number(k.slice(8)) === 1 || i === 0 ? `${Number(k.slice(8))} ${moisCourt(k)}` : String(Number(k.slice(8))),
    libelle: X.gran === "mois" ? libelleGroupe("mois", { cle: k }) : X.gran === "semaine" ? libelleGroupe("semaine", { cle: k }) : formatDate(k),
  }));
}

// Graphique d'une ou deux mesures par période. Avec une comparaison et une seule mesure, la période de comparaison se superpose en gris.
function graphe(X, defs, nom) {
  const cases = casesDe(X);
  const brutes = defs.map((d) => S.serie(d.id, X.faits, X.c, X.gran));
  const series = defs.map((d, k) => ({ nom: d.nom, classe: d.classe, id: d.id, valeurs: brutes[k].map((x) => x.montant) }));
  const nombres = brutes.map((b) => b.map((x) => x.nombre));
  let avant = null;
  if (X.cmp && defs.length === 1) {
    const cc = { ...X.c, du: X.cmp[0], au: X.cmp[1] };
    const brut = S.serie(defs[0].id, X.faits, cc, X.gran).map((x) => x.montant);
    avant = cases.map((_, i) => brut[i] ?? 0);
    series.unshift({ nom: N_("Période de comparaison"), classe: "ref", id: null, valeurs: avant });
  }
  const sansRef = series.filter((x) => x.id);
  const lecture = (i) =>
    h("div", { class: "st-lecture-corps" }, h("strong", { class: "st-lecture-titre" }, cases[i].libelle), h("ul", null, [...series].sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1)).map((x) => {
      const k = defs.findIndex((d) => d.id === x.id);
      return h("li", null, h("i", { class: `st-echantillon ${x.classe}`, "aria-hidden": "true" }), h("span", { class: "st-lecture-valeur" }, m$(X, x.valeurs[i])), h("span", { class: "st-lecture-nom" }, tr(x.nom)), x.id ? h("span", { class: "st-lecture-nb" }, compte(nombres[k][i], x.id)) : null, x.id && defs.length > 1 ? h("a", { class: "st-lecture-lien", href: X.href(x.id, `${X.gran}:${cases[i].cle}`) }, tr("Voir la liste")) : null);
    })));
  X.sortie.push(...cases.flatMap((c, i) => sansRef.map((x) => [`${tr(nom)} · ${tr(x.nom)}`, c.libelle, X.devise, x.valeurs[i], nombres[defs.findIndex((d) => d.id === x.id)][i]])));
  const alternative = h("details", { class: "st-alt" }, h("summary", null, tr("Voir les chiffres")), h("div", { class: "tableau-defilant" }, h("table", { class: "tableau simple" }, h("thead", null, h("tr", null, h("th", { scope: "col" }, tr("Période")), series.map((x) => h("th", { scope: "col", class: "num" }, tr(x.nom))))), h("tbody", null, cases.map((c, i) => h("tr", null, h("td", { "data-label": tr("Période") }, c.libelle), series.map((x) => h("td", { class: "num", "data-label": tr(x.nom) }, m$(X, x.valeurs[i])))))))));
  return bloc(
    h("div", { class: "st-entete-graphe" }, titre(nom), puces(X)),
    legende(series),
    graphiqueColonnes({ cases, series, devise: X.devise, titre: tr(nom), lecture, lien: defs.length === 1 ? (i) => X.href(defs[0].id, `${X.gran}:${cases[i].cle}`) : null }),
    alternative
  );
}

// ---- Vue d'ensemble -----------------------------------------------------------------------------------------------------
function aTraiter(X) {
  const c = X.c;
  const n = (id) => S.lignes(id, X.faits, c);
  // Secret et Taxi n'ont pas de devis : rien à relancer.
  const vieux = X.excursions ? [] : n("devis_attente").filter((l) => l.age > 14);
  const impayes = n("a_encaisser").filter((l) => l.age > 30);
  const items = [
    vieux.length ? { texte: pluriel(vieux.length, N_("devis attend une réponse depuis plus de 14 jours"), N_("devis attendent une réponse depuis plus de 14 jours")), montant: S.somme(vieux).montant, href: X.href("devis_attente", null, { tri: "age", sens: "desc" }) } : null,
    impayes.length ? { texte: pluriel(impayes.length, N_("facture impayée depuis plus de 30 jours"), N_("factures impayées depuis plus de 30 jours")), montant: S.somme(impayes).montant, href: X.href("a_encaisser", null, { tri: "age", sens: "desc" }) } : null,
  ];
  const q = (id, un, plus, montant = true) => {
    const r = S.valeur(id, X.faits, c);
    return r.nombre ? { texte: pluriel(r.nombre, un, plus), montant: montant ? r.montant : null, href: X.href(id) } : null;
  };
  items.push(q("a_confirmer", N_("service à venir pas encore confirmé"), N_("services à venir pas encore confirmés")), q("sans_date", N_("service sans date de prestation"), N_("services sans date de prestation")));
  // Taxi : aucune commission par défaut, elle se note au cas par cas. Un service sans commission n'est pas un oubli.
  if (X.nets && !X.taxi) items.push(q("commission_a_renseigner", N_("service payé sur place sans commission notée"), N_("services payés sur place sans commission notée"), false));
  const lignes = items.filter(Boolean);
  return bloc(titre(N_("À traiter")), lignes.length ? h("ul", { class: "st-traiter" }, lignes.map((l) => h("li", null, h("a", { href: l.href }, h("span", null, l.texte), l.montant !== null ? h("strong", null, m$(X, l.montant)) : null)))) : h("p", { class: "vide-court" }, tr("Rien en attente, tout est à jour.")));
}

function tauxAcceptation(X) {
  const a = S.indicateursDevis(X.faits, X.c);
  const b = X.cmp ? S.indicateursDevis(X.faits, { ...X.c, du: X.cmp[0], au: X.cmp[1] }) : null;
  const ecart = b && a.taux !== null && b.taux !== null ? S.variation(a.taux, b.taux) : null;
  return tuile({ libelle: tr("Taux d'acceptation"), valeur: a.taux === null ? "—" : `${a.taux} %`, detail: a.emis ? tr("{acceptes} sur {emis}", { acceptes: a.acceptes, emis: a.emis }) : tr("Aucun devis émis"), ecart, ecartUnite: N_("pts"), precedent: b && b.taux !== null ? `${b.taux} %` : null, monnaie: false, href: X.href("devis_emis"), aide: S.DEFINITIONS.devis_acceptes });
}

export function apercu(X) {
  const f = X.faits;
  const a7 = S.valeur("a_venir_7", f, X.c);
  const dv = S.valeur("devis_attente", f, X.c);
  const ar = S.valeur("a_encaisser", f, X.c);
  const cr = X.nets ? S.valeur("commission_a_recevoir", f, X.c) : null;
  const ind = S.indicateursDossiers(f, X.c);
  const panier = tuile({ libelle: tr("Panier moyen"), valeur: ind.panierMoyen === null ? "—" : m$(X, ind.panierMoyen), detail: tr("volume vendu par dossier"), href: X.href("vendu", null, { tri: "montant", sens: "desc" }), aide: [N_("Panier moyen"), N_("Volume vendu divisé par le nombre de dossiers vendus sur la période.")] });
  const dossiers = tuile({ libelle: tr("Dossiers vendus"), valeur: String(ind.dossiers), detail: pluriel(ind.clients, N_("client"), N_("clients")), href: X.href("vendu"), aide: S.DEFINITIONS.vendu });
  return [
    tuiles(
      T(X, "vendu", { grande: true }),
      X.taxi ? null : T(X, "encaisse"),
      X.nets ? T(X, "commission_recue", { detail: tr("{montant} à recevoir", { montant: m$(X, cr.montant) }), href: X.lien("commissions") }) : panier,
      // Taxi : rien ne s'encaisse chez nous et il n'y a jamais de devis.
      X.taxi ? null : T(X, "a_encaisser", { href: X.lien("encaissements", { liste: "a_encaisser" }) }),
      X.reservations ? T(X, "a_venir_7", { valeur: String(a7.nombre), detail: a7.montant ? tr("{montant} vendus", { montant: m$(X, a7.montant) }) : tr("services"), href: X.lien("avenir") }) : null,
      // Secret et Taxi facturent directement ou pas du tout : jamais de devis.
      X.excursions ? null : T(X, "devis_attente", { valeur: String(dv.nombre), detail: tr("valeur {montant}", { montant: m$(X, dv.montant) }), href: X.lien("devis") }),
      X.excursions ? null : tauxAcceptation(X),
      X.nets ? T(X, "revenu", { grande: true, href: X.lien("commissions") }) : null,
      X.nets ? panier : null,
      X.nets ? dossiers : null
    ),
    aTraiter(X),
    X.taxi ? graphe(X, [{ id: "vendu", nom: N_("Volume vendu"), classe: "s1" }], N_("Volume vendu")) : graphe(X, [{ id: "vendu", nom: N_("Volume vendu"), classe: "s1" }, { id: "encaisse", nom: N_("Encaissé chez nous"), classe: "s2" }], N_("Volume vendu et encaissé")),
    X.peutGroupe ? h("p", { class: "st-lien-groupe" }, h("a", { href: "#/groupe" }, tr("Comparer les entreprises"))) : null,
    blocDefinitions(["vendu", "encaisse", "a_encaisser", "commission_recue", "commission_a_recevoir", "revenu", "a_venir_7", "devis_attente"].filter((i) => S.disponible(i, f) && !(X.taxi && ["encaisse", "a_encaisser"].includes(i)) && !(X.excursions && i === "devis_attente") && !(!X.reservations && i === "a_venir_7")), S.DEFINITIONS),
  ];
}

// ---- Ventes -----------------------------------------------------------------------------------------------------------------
export function ventes(X) {
  const f = X.faits;
  const ind = S.indicateursDossiers(f, X.c);
  const prec = X.cmp ? S.indicateursDossiers(f, { ...X.c, du: X.cmp[0], au: X.cmp[1] }) : null;
  const rows = S.lignes("vendu", f, X.c);
  const nous = rows.reduce((t, l) => t + Number(l.src.total), 0);
  const place = rows.reduce((t, l) => t + Number(l.src.sur_place), 0);
  const part = nous + place > 0 ? Math.round((place / (nous + place)) * 100) : 0;
  const panierEcart = prec && ind.panierMoyen !== null && prec.panierMoyen !== null ? S.variation(ind.panierMoyen, prec.panierMoyen) : null;
  // Saisonnalité : le volume vendu par mois de l'année sur les douze derniers mois, quelle que soit la période choisie.
  const an = { ...X.c, du: S.debutMois(X.jour, -11), au: X.jour };
  const saison = S.grouper(S.lignes("vendu", f, an), "mois", { tri: "cle" });
  const casesSaison = S.casesDe(an.du, an.au, "mois");
  const valSaison = casesSaison.map((k) => (saison.find((g) => g.cle === k) || { montant: 0 }).montant);
  const nomSaison = N_("Volume vendu, douze derniers mois");
  X.sortie.push(...casesSaison.map((k, i) => [tr(nomSaison), libelleGroupe("mois", { cle: k }), X.devise, valSaison[i], (saison.find((g) => g.cle === k) || { nombre: 0 }).nombre]));
  return [
    tuiles(
      T(X, "vendu", { grande: true }),
      tuile({ libelle: tr("Panier moyen"), valeur: ind.panierMoyen === null ? "—" : m$(X, ind.panierMoyen), detail: tr("volume vendu par dossier"), ecart: panierEcart, precedent: prec ? prec.panierMoyen : null, devise: X.devise, href: X.href("vendu", null, { tri: "montant", sens: "desc" }), aide: [N_("Panier moyen"), N_("Volume vendu divisé par le nombre de dossiers vendus sur la période.")] }),
      tuile({ libelle: tr("Dossiers vendus"), valeur: String(ind.dossiers), detail: pluriel(ind.clients, N_("client"), N_("clients")), ecart: prec ? S.variation(ind.dossiers, prec.dossiers) : null, precedent: prec ? prec.dossiers : null, monnaie: false, href: X.href("vendu"), aide: S.DEFINITIONS.vendu }),
      tuile({ libelle: tr("Taux d'annulation"), valeur: ind.tauxAnnulation === null ? "—" : `${ind.tauxAnnulation} %`, detail: tr("{n} annulés sur {total} ouverts", { n: ind.annules, total: ind.ouverts }), href: X.href("annules"), aide: S.DEFINITIONS.annules }),
      !X.excursions && ind.sejourMoyen !== null ? tuile({ libelle: tr("Durée de séjour moyenne"), valeur: tr("{n} jours", { n: String(ind.sejourMoyen).replace(".", tr(",")) }), detail: tr("sur {n} dossiers avec dates", { n: ind.sejourN }), href: null, aide: [N_("Durée de séjour moyenne"), N_("Du jour du départ au jour du retour, sur les dossiers vendus dont les deux dates sont notées.")] }) : null
    ),
    // Payé chez nous ou sur place : n'existe qu'en Secret (ZTP encaisse tout, Taxi rien).
    X.excursions && !X.taxi ? bloc(titre(N_("Où va l'argent")), h("div", { class: "st-segment", role: "img", "aria-label": tr("{part} % du volume vendu est payé sur place", { part }) }, h("span", { class: "st-seg nous", style: `flex:${Math.max(nous, 0.0001)}` }), h("span", { class: "st-seg place", style: `flex:${Math.max(place, 0.0001)}` })), h("ul", { class: "st-legende" }, h("li", null, h("i", { class: "st-echantillon s1", "aria-hidden": "true" }), tr("Payé chez nous"), " ", h("strong", null, m$(X, nous))), h("li", null, h("i", { class: "st-echantillon place", "aria-hidden": "true" }), tr("Payé sur place"), " ", h("strong", null, m$(X, place)), ` (${part} %)`))) : null,
    graphe(X, [{ id: "vendu", nom: N_("Volume vendu"), classe: "s1" }], N_("Volume vendu")),
    // Les dossiers d'excursions n'ont pas de destination : on classe les services par type, à leur date de service.
    !X.excursions ? bloc(titre(N_("Par destination ou service")), rang(X, "vendu", "pays")) : X.reservations ? bloc(titre(N_("Par type de service")), h("p", { class: "aide" }, tr("Valeur des services dont la date de service tombe dans la période.")), rang(X, "services", "famille")) : null,
    bloc(titre(N_("Par responsable")), rang(X, "vendu", "responsable")),
    bloc(titre(nomSaison), h("p", { class: "aide" }, tr("Pour voir quels mois vendent le plus. Ne dépend pas de la période choisie.")), graphiqueColonnes({ cases: casesSaison.map((k) => ({ cle: k, court: libelleMoisCourt(k), libelle: libelleGroupe("mois", { cle: k }) })), series: [{ nom: N_("Volume vendu"), classe: "s1", valeurs: valSaison }], devise: X.devise, titre: tr(nomSaison), lecture: (i) => h("div", { class: "st-lecture-corps" }, h("strong", { class: "st-lecture-titre" }, libelleGroupe("mois", { cle: casesSaison[i] })), h("p", null, h("span", { class: "st-lecture-valeur" }, m$(X, valSaison[i])))), lien: (i) => X.href("vendu", `mois:${casesSaison[i]}`, { du: `${casesSaison[i]}-01`, au: S.finDeMois(`${casesSaison[i]}-01`), p: "perso" }) })),
    bloc(h("a", { class: "bouton secondaire", href: X.href("vendu") }, tr("Voir les {n} dossiers vendus", { n: rows.length }))),
    blocDefinitions(["vendu", "facture", "ouverts", "annules"].filter((i) => !(X.taxi && i === "facture")), S.DEFINITIONS),
  ];
}

// ---- Encaissements ------------------------------------------------------------------------------------------------------------
export function encaissements(X) {
  const f = X.faits;
  const gros = S.lignes("a_encaisser", f, X.c).sort((a, b) => b.montant - a.montant).slice(0, 5);
  return [
    tuiles(T(X, "encaisse", { grande: true }), T(X, "facture"), T(X, "a_encaisser")),
    X.excursions ? h("p", { class: "aide st-note" }, tr("Les services payés sur place au prestataire ne passent pas par nous, ils ne sont ni facturés ni à encaisser. Ils figurent dans le volume vendu.")) : null,
    graphe(X, [{ id: "facture", nom: N_("Facturé"), classe: "s1" }, { id: "encaisse", nom: N_("Encaissé chez nous"), classe: "s2" }], N_("Facturé et encaissé")),
    bloc(titre(N_("Reste à encaisser, par ancienneté")), rang(X, "a_encaisser", "tranche", { tri: "cle" }), h("p", { class: "aide" }, tr("L'ancienneté se compte depuis la date de la facture."))),
    bloc(titre(N_("Plus gros restes à encaisser")), gros.length ? classement({ lignes: gros.map((l) => ({ libelle: l.titre, valeur: l.montant, texte: m$(X, l.montant), detail: tr("facture de {n} jours", { n: l.age }), href: `#/dossier/${l.dossier_id}` })), max: 5 }) : h("p", { class: "vide-court" }, tr("Aucun reste à encaisser."))),
    bloc(titre(N_("Encaissé par moyen de paiement")), rang(X, "encaisse", "moyen")),
    blocDefinitions(["encaisse", "facture", "a_encaisser"], S.DEFINITIONS),
  ];
}

// ---- Commissions et marge -----------------------------------------------------------------------------------------------------
function tableauPartenaires(X) {
  const parts = new Map();
  const ligne = (cle) => parts.get(cle) || (parts.set(cle, { cle, nom: cle, services: 0, vendu: 0, place: 0, marge: 0, prevue: 0, recue: 0, reste: 0 }), parts.get(cle));
  const add = (id, champ, comptage) => {
    for (const g of S.grouper(S.lignesFiltrees(id, X.faits, X.c), "partenaire")) {
      const l = ligne(g.cle);
      l[champ] = g.montant;
      if (comptage) l.services = g.nombre;
    }
  };
  add("services", "vendu", true);
  add("services_place", "place");
  add("marge", "marge");
  add("commission_prevue", "prevue");
  add("commission_recue", "recue");
  add("commission_a_recevoir", "reste");
  const lignes = [...parts.values()].map((l) => ({ ...l, nom: libelleGroupe("partenaire", { cle: l.cle }) }));
  const lien = (id, cle) => X.href(id, `partenaire:${cle}`);
  const somme = (champ) => (vues) => m$(X, vues.reduce((t, l) => t + l[champ], 0));
  for (const l of lignes) X.sortie.push([tr("Par partenaire"), l.nom, X.devise, l.marge, l.services]);
  return tableauTrie({
    colonnes: [
      { cle: "nom", titre: N_("Partenaire"), valeur: (l) => l.nom, rendu: (l) => l.nom },
      { cle: "services", titre: N_("Services"), num: true, valeur: (l) => l.services, rendu: (l) => String(l.services), lien: (l) => lien("services", l.cle), somme: (v) => String(v.reduce((t, l) => t + l.services, 0)) },
      { cle: "vendu", titre: N_("Vendu"), num: true, valeur: (l) => l.vendu, rendu: (l) => m$(X, l.vendu), lien: (l) => lien("services", l.cle), somme: somme("vendu") },
      { cle: "marge", titre: N_("Marge prévue"), num: true, valeur: (l) => l.marge, rendu: (l) => m$(X, l.marge), lien: (l) => lien("marge", l.cle), somme: somme("marge") },
      { cle: "prevue", titre: N_("Commission prévue"), num: true, valeur: (l) => l.prevue, rendu: (l) => m$(X, l.prevue), lien: (l) => lien("commission_prevue", l.cle), somme: somme("prevue") },
      { cle: "recue", titre: N_("Commission reçue"), num: true, valeur: (l) => l.recue, rendu: (l) => m$(X, l.recue), lien: (l) => lien("commission_recue", l.cle), somme: somme("recue") },
      { cle: "reste", titre: N_("À recevoir"), num: true, valeur: (l) => l.reste, rendu: (l) => m$(X, l.reste), lien: (l) => lien("commission_a_recevoir", l.cle), somme: somme("reste") },
    ],
    lignes,
    etatInitial: { tri: X.tri || "vendu", sens: X.sens, q: X.q },
    onEtat: X.surEtat,
    recherche: (l) => l.nom,
    pied: true,
    vide: tr("Aucun service sur la période."),
  });
}

export function commissions(X) {
  if (!X.nets) return [h("div", { class: "vide" }, h("h2", null, tr("Accès réservé")), h("p", null, tr("Les commissions, les nets et la marge demandent le droit « prix nets des partenaires ».")))];
  const f = X.faits;
  const ar = S.lignes("commission_a_recevoir", f, X.c);
  const echues = ar.filter((l) => l.src.date_service && (l.src.date_fin || l.src.date_service) < X.jour);
  const inconnue = S.valeur("marge_inconnue", f, X.c);
  const sansCom = S.valeur("commission_a_renseigner", f, X.c);
  const ecart = S.valeur("commission_ecart", f, X.c);
  const revenu = [["encaisse", 1], ["net_paye", -1], ["commission_recue", 1]].map(([id, k]) => [id, S.valeur(id, f, X.c).montant * k]);
  return [
    tuiles(
      T(X, "commission_recue", { grande: true }),
      T(X, "commission_prevue"),
      T(X, "commission_a_recevoir", { detail: echues.length ? tr("dont {n} déjà échues pour {montant}", { n: echues.length, montant: m$(X, S.somme(echues).montant) }) : compte(ar.length, "commission_a_recevoir") }),
      // Taxi : le client paie le chauffeur, il n'y a ni net à payer ni marge, seulement des commissions.
      X.taxi ? null : T(X, "marge"),
      T(X, "revenu"),
      X.taxi ? null : T(X, "net_a_payer")
    ),
    bloc(titre(N_("Revenu de la période")), h("p", { class: "aide" }, X.taxi ? tr("Le client paie le chauffeur, le revenu vient donc des commissions reçues.") : tr("L'argent qui a vraiment bougé, soit l'encaissé chez nous, moins les nets payés aux partenaires, plus les commissions reçues.")), h("ul", { class: "st-equation" }, X.taxi ? null : h("li", null, h("span", null, tr("Encaissé chez nous")), h("a", { href: X.href("encaisse") }, m$(X, revenu[0][1]))), X.taxi ? null : h("li", null, h("span", null, tr("moins nets payés aux partenaires")), h("a", { href: X.href("net_paye") }, m$(X, revenu[1][1]))), h("li", null, h("span", null, tr("plus commissions reçues")), h("a", { href: X.href("commission_recue") }, m$(X, revenu[2][1]))), h("li", { class: "total" }, h("span", null, tr("Revenu")), h("a", { href: X.href("revenu") }, m$(X, revenu.reduce((t, x) => t + x[1], 0)))))),
    ecart.nombre || (!X.taxi && (inconnue.nombre || sansCom.nombre)) ? bloc(titre(N_("Données à compléter")), h("ul", { class: "st-traiter" }, ecart.nombre ? h("li", null, h("a", { href: X.href("commission_ecart") }, h("span", null, pluriel(ecart.nombre, N_("commission reçue différente du montant prévu"), N_("commissions reçues différentes du montant prévu"))), h("strong", null, m$(X, ecart.montant)))) : null, !X.taxi && inconnue.nombre ? h("li", null, h("a", { href: X.href("marge_inconnue") }, h("span", null, pluriel(inconnue.nombre, N_("service de la période sans net ni commission notés, marge non comptée"), N_("services de la période sans net ni commission notés, marge non comptée"))))) : null, !X.taxi && sansCom.nombre ? h("li", null, h("a", { href: X.href("commission_a_renseigner") }, h("span", null, pluriel(sansCom.nombre, N_("service payé sur place sans commission notée"), N_("services payés sur place sans commission notée"))))) : null)) : null,
    graphe(X, [{ id: "commission_prevue", nom: N_("Commissions prévues"), classe: "s1" }, { id: "commission_recue", nom: N_("Commissions reçues"), classe: "s2" }], N_("Commissions prévues et reçues")),
    // Taxi n'a qu'un prestataire : un classement par partenaire n'apprend rien.
    X.taxi ? null : bloc(titre(N_("Par partenaire")), tableauPartenaires(X)),
    blocDefinitions(["commission_prevue", "commission_recue", "commission_a_recevoir", "commission_ecart", "marge", "revenu", "net_paye", "net_a_payer"].filter((i) => !(X.taxi && ["marge", "net_paye", "net_a_payer"].includes(i))), S.DEFINITIONS),
  ];
}

// ---- Clients ------------------------------------------------------------------------------------------------------------------------
export function clients(X) {
  const rows = S.lignesFiltrees("vendu", X.faits, X.c);
  const ind = S.indicateursClients(X.faits, X.c);
  const dos = S.indicateursDossiers(X.faits, X.c);
  const parClient = S.grouper(rows, "client");
  const lignes = parClient.map((g) => ({ cle: g.cle, nom: g.libelle, dossiers: g.nombre, montant: g.montant, dernier: g.rows.reduce((d, l) => (l.date > d ? l.date : d), ""), nouveau: g.rows.some((l) => !l.src.client_depuis || l.src.client_depuis >= X.du) }));
  for (const l of lignes) X.sortie.push([tr("Par client"), l.nom, X.devise, l.montant, l.dossiers]);
  return [
    tuiles(
      tuile({ libelle: tr("Clients actifs"), valeur: String(ind.clients), detail: tr("avec au moins un dossier vendu"), href: X.href("vendu", null, { tri: "client" }), aide: [N_("Clients actifs"), N_("Clients qui ont au moins un dossier vendu sur la période, hors dossiers annulés.")] }),
      tuile({ libelle: tr("Nouveaux clients"), valeur: String(ind.nouveaux), detail: tr("premier achat dans la période"), href: X.href("vendu", "nouveaute:nouveau"), aide: [N_("Nouveaux clients"), N_("Clients dont le premier dossier vendu tombe dans la période.")] }),
      tuile({ libelle: tr("Clients récurrents"), valeur: String(ind.recurrents), detail: tr("déjà clients avant la période"), href: X.href("vendu", "nouveaute:recurrent"), aide: [N_("Clients récurrents"), N_("Clients qui avaient déjà un dossier vendu avant le début de la période.")] }),
      tuile({ libelle: tr("Panier moyen"), valeur: dos.panierMoyen === null ? "—" : m$(X, dos.panierMoyen), detail: tr("volume vendu par dossier"), href: X.href("vendu", null, { tri: "montant", sens: "desc" }), aide: [N_("Panier moyen"), N_("Volume vendu divisé par le nombre de dossiers vendus sur la période.")] })
    ),
    bloc(titre(N_("Meilleurs clients")), classement({ lignes: parClient.map((g) => ({ libelle: g.libelle, valeur: g.montant, texte: m$(X, g.montant), detail: pluriel(g.nombre, N_("dossier"), N_("dossiers")), href: X.href("vendu", `client:${g.cle}`) })), max: 8, total: (v) => m$(X, v) })),
    bloc(titre(N_("Nouveaux et récurrents")), rang(X, "vendu", "nouveaute")),
    bloc(titre(N_("Tous les clients de la période")), tableauTrie({
      colonnes: [
        { cle: "nom", titre: N_("Client"), valeur: (l) => l.nom, rendu: (l) => l.nom, lien: (l) => X.href("vendu", `client:${l.cle}`) },
        { cle: "dossiers", titre: N_("Dossiers"), num: true, valeur: (l) => l.dossiers, rendu: (l) => String(l.dossiers), somme: (v) => String(v.reduce((t, l) => t + l.dossiers, 0)) },
        { cle: "montant", titre: N_("Volume vendu"), num: true, valeur: (l) => l.montant, rendu: (l) => m$(X, l.montant), somme: (v) => m$(X, v.reduce((t, l) => t + l.montant, 0)) },
        { cle: "dernier", titre: N_("Dernier achat"), valeur: (l) => l.dernier, rendu: (l) => formatDate(l.dernier) },
        { cle: "nouveau", titre: N_("Clientèle"), valeur: (l) => (l.nouveau ? 1 : 0), rendu: (l) => (l.nouveau ? tr("Nouveau") : tr("Récurrent")) },
      ],
      lignes, etatInitial: { tri: X.tri || "montant", sens: X.sens, q: X.q }, onEtat: X.surEtat, recherche: (l) => l.nom, pied: true, vide: tr("Aucun client sur la période."),
    })),
    blocDefinitions(["vendu"], S.DEFINITIONS),
  ];
}

// ---- Services et partenaires -----------------------------------------------------------------------------------------------------
export function services(X) {
  const f = X.faits;
  const rows = S.lignesFiltrees("services", f, X.c);
  if (!f.reservations.length) return [h("div", { class: "vide" }, h("h2", null, tr("Pas de réservations")), h("p", null, X.taxi ? tr("Cette section se remplit avec les réservations auprès des partenaires. Elles se créent depuis une réservation, ou à la main.") : X.excursions ? tr("Cette section se remplit avec les réservations auprès des partenaires. Elles se créent depuis une facture, ou à la main.") : tr("Cette section se remplit avec les réservations auprès des partenaires. Elles se créent depuis un devis ou une facture, ou à la main.")), h("a", { class: "bouton secondaire", href: "#/reservations" }, tr("Ouvrir les réservations")))];
  const pers = rows.reduce((t, l) => t + (l.personnes || 0), 0);
  const place = S.valeur("services_place", f, X.c);
  const tot = S.valeur("services", f, X.c);
  const parPrest = S.grouper(rows, "prestation");
  const lignes = parPrest.map((g) => ({ cle: g.cle, nom: g.libelle, partenaire: g.rows[0].partenaire || "", services: g.nombre, personnes: g.personnes, montant: g.montant, place: g.rows.filter((l) => l.sur_place).length }));
  for (const l of lignes) X.sortie.push([tr("Par prestation"), l.nom, X.devise, l.montant, l.services]);
  const partenaires = new Set(rows.map((l) => l.src.partenaire_id).filter(Boolean)).size;
  return [
    tuiles(
      T(X, "services", { grande: true, detail: tot.nombre ? tr("{n} personnes", { n: pers }) : "" }),
      tuile({ libelle: tr("Personnes"), valeur: String(pers), detail: tr("places réservées, adultes et enfants"), href: X.href("services", null, { tri: "personnes", sens: "desc" }), aide: [N_("Personnes"), N_("Adultes et enfants des réservations dont la date de service tombe dans la période. Les bébés ne sont pas comptés.")] }),
      // Payé sur place : propre à Secret (en Taxi tout est payé au chauffeur, en ZTP rien).
      X.excursions && !X.taxi ? T(X, "services_place", { detail: tot.nombre ? tr("{part} % des services", { part: Math.round((place.nombre / tot.nombre) * 100) }) : "" }) : null,
      X.taxi ? null : tuile({ libelle: tr("Partenaires utilisés"), valeur: String(partenaires), detail: tr("sur la période"), href: X.href("services", null, { tri: "partenaire" }), aide: [N_("Partenaires utilisés"), N_("Partenaires qui ont au moins un service dans la période.")] })
    ),
    graphe(X, [{ id: "services", nom: N_("Services"), classe: "s1" }], N_("Valeur des services par date de service")),
    bloc(titre(N_("Par type de service")), rang(X, "services", "famille")),
    X.taxi ? null : bloc(titre(N_("Par partenaire")), rang(X, "services", "partenaire")),
    bloc(titre(N_("Par prestation")), tableauTrie({
      colonnes: [
        { cle: "nom", titre: N_("Prestation"), valeur: (l) => l.nom, rendu: (l) => l.nom, lien: (l) => X.href("services", `prestation:${l.cle}`) },
        { cle: "partenaire", titre: N_("Partenaire"), valeur: (l) => l.partenaire, rendu: (l) => l.partenaire || "—" },
        { cle: "services", titre: N_("Services"), num: true, valeur: (l) => l.services, rendu: (l) => String(l.services), somme: (v) => String(v.reduce((t, l) => t + l.services, 0)) },
        { cle: "personnes", titre: N_("Personnes"), num: true, valeur: (l) => l.personnes, rendu: (l) => String(l.personnes), somme: (v) => String(v.reduce((t, l) => t + l.personnes, 0)) },
        { cle: "montant", titre: N_("Vendu"), num: true, valeur: (l) => l.montant, rendu: (l) => m$(X, l.montant), somme: (v) => m$(X, v.reduce((t, l) => t + l.montant, 0)) },
        { cle: "place", titre: N_("Payés sur place"), num: true, valeur: (l) => l.place, rendu: (l) => String(l.place), somme: (v) => String(v.reduce((t, l) => t + l.place, 0)) },
      ],
      lignes, etatInitial: { tri: X.tri || "montant", sens: X.sens, q: X.q }, onEtat: X.surEtat, recherche: (l) => `${l.nom} ${l.partenaire}`, pied: true, vide: tr("Aucun service sur la période."),
    })),
    blocDefinitions(["services", "services_nous", "services_place"].filter((i) => i === "services" || (X.excursions && !X.taxi)), S.DEFINITIONS),
  ];
}

// ---- Réservations à venir ------------------------------------------------------------------------------------------------------------
export function avenir(X) {
  const f = X.faits;
  // ZTP sans réservations : seuls comptent les départs à venir.
  if (!X.reservations) {
    const dep = S.valeur("departs", f, X.c);
    X.sortie.push([titreMesure("departs"), titreMesure("departs"), X.devise, dep.montant, dep.nombre]);
    return [tuiles(T(X, "departs", { grande: true, mini: false })), blocDefinitions(["departs"], S.DEFINITIONS)];
  }
  // Cette section regarde devant : huit semaines à partir de cette semaine, quelle que soit la période choisie ailleurs.
  const debut = S.cleDe(X.jour, "semaine");
  const fin = ajouterJours(debut, 8 * 7 - 1);
  const cc = { ...X.c, du: debut, au: fin };
  const cases = S.casesDe(debut, fin, "semaine");
  const serie = S.serie("services", f, cc, "semaine");
  const nombres = serie.map((x) => x.nombre);
  const nom = N_("Services des huit prochaines semaines");
  X.sortie.push(...cases.map((k, i) => [tr(nom), libelleGroupe("semaine", { cle: k }), X.devise, serie[i].montant, nombres[i]]));
  const sur7 = S.valeur("a_venir_7", f, X.c);
  const toutes = S.valeur("a_venir", f, X.c);
  const conf = S.valeur("a_confirmer", f, X.c);
  const sd = S.valeur("sans_date", f, X.c);
  const dep = S.valeur("departs", f, X.c);
  const prochains = S.grouper(S.lignesFiltrees("a_venir", f, X.c).filter((l) => l.date <= ajouterJours(X.jour, 13)), "jour", { tri: "cle" });
  return [
    tuiles(
      T(X, "a_venir_7", { grande: true, mini: false }),
      T(X, "a_venir", { mini: false }),
      T(X, "a_confirmer", { mini: false }),
      sd.nombre ? T(X, "sans_date", { mini: false }) : null,
      !X.excursions && dep.nombre ? T(X, "departs", { mini: false }) : null
    ),
    bloc(titre(nom), graphiqueColonnes({ cases: cases.map((k) => ({ cle: k, court: jourCourt(k), libelle: libelleGroupe("semaine", { cle: k }) })), series: [{ nom: N_("Valeur des services"), classe: "s1", valeurs: serie.map((x) => x.montant) }], devise: X.devise, titre: tr(nom), lecture: (i) => h("div", { class: "st-lecture-corps" }, h("strong", { class: "st-lecture-titre" }, libelleGroupe("semaine", { cle: cases[i] })), h("p", null, h("span", { class: "st-lecture-valeur" }, m$(X, serie[i].montant)), " ", h("span", { class: "st-lecture-nom" }, compte(nombres[i], "services")))), lien: (i) => X.href("a_venir", `semaine:${cases[i]}`) })),
    bloc(titre(N_("Jour par jour, deux semaines")), prochains.length ? classement({ lignes: prochains.map((g) => ({ libelle: formatDate(g.cle), valeur: g.nombre, texte: compte(g.nombre, "services"), detail: tr("{montant} vendus", { montant: m$(X, g.montant) }), href: X.href("a_venir", `jour:${g.cle}`) })), max: 14 }) : h("p", { class: "vide-court" }, tr("Aucun service prévu dans les deux semaines."))),
    bloc(titre(N_("Par statut")), rang(X, "a_venir", "statut", { tri: "cle" })),
    X.taxi ? null : bloc(titre(N_("Par partenaire")), rang(X, "a_venir", "partenaire")),
    h("p", { class: "aide" }, tr("{n} services à venir au total.", { n: toutes.nombre })),
    blocDefinitions(["a_venir", "a_venir_7", "a_confirmer", "sans_date", "departs"].filter((i) => !(X.excursions && i === "departs")), S.DEFINITIONS),
  ];
}

// ---- Devis ---------------------------------------------------------------------------------------------------------------------------------
export function devis(X) {
  const f = X.faits;
  const a = S.indicateursDevis(f, X.c);
  const b = X.cmp ? S.indicateursDevis(f, { ...X.c, du: X.cmp[0], au: X.cmp[1] }) : null;
  const delaiEcart = b && a.delaiMoyen !== null && b.delaiMoyen !== null ? S.variation(a.delaiMoyen, b.delaiMoyen) : null;
  const attente = S.valeur("devis_attente", f, X.c);
  const lignes = S.lignes("devis_attente", f, X.c).sort((x, y) => y.age - x.age);
  return [
    tuiles(
      T(X, "devis_emis", { grande: true }),
      tauxAcceptation(X),
      tuile({ libelle: tr("Délai moyen d'acceptation"), valeur: a.delaiMoyen === null ? "—" : tr("{n} jours", { n: String(a.delaiMoyen).replace(".", tr(",")) }), detail: a.delaiN ? tr("sur {n} devis acceptés", { n: a.delaiN }) : tr("aucun devis accepté"), ecart: delaiEcart, ecartUnite: N_("j"), ecartInverse: true, precedent: b && b.delaiMoyen !== null ? tr("{n} jours", { n: String(b.delaiMoyen).replace(".", tr(",")) }) : null, monnaie: false, href: X.href("devis_acceptes"), aide: [N_("Délai moyen d'acceptation"), N_("Jours entre la date du devis et l'acceptation, sur les devis émis dans la période et acceptés.")] }),
      T(X, "devis_attente", { valeur: String(attente.nombre), detail: tr("valeur {montant}", { montant: m$(X, attente.montant) }) })
    ),
    graphe(X, [{ id: "devis_emis", nom: N_("Devis émis"), classe: "s1" }, { id: "devis_acceptes", nom: N_("Devis acceptés"), classe: "s2" }], N_("Devis émis et acceptés")),
    bloc(titre(N_("Devis en attente, par ancienneté")), rang(X, "devis_attente", "tranche", { tri: "cle" }), h("p", { class: "aide" }, tr("Au-delà de deux semaines sans réponse, une relance se justifie."))),
    bloc(titre(N_("Les plus anciens, à relancer")), lignes.length ? classement({ lignes: lignes.slice(0, 6).map((l) => ({ libelle: l.titre, valeur: l.age, texte: tr("{n} jours", { n: l.age }), detail: m$(X, l.montant), href: `#/dossier/${l.dossier_id}` })), max: 6 }) : h("p", { class: "vide-court" }, tr("Aucun devis en attente."))),
    blocDefinitions(["devis_emis", "devis_acceptes", "devis_attente"], S.DEFINITIONS),
  ];
}

export const SECTIONS = {
  apercu: { titre: N_("Vue d'ensemble"), rendre: apercu, parties: null },
  ventes: { titre: N_("Ventes"), rendre: ventes, parties: ["dossiers"], douze: true },
  encaissements: { titre: N_("Encaissements"), rendre: encaissements, parties: ["dossiers", "paiements"], sansTaxi: true },
  commissions: { titre: N_("Commissions et marge"), titreTaxi: N_("Commissions"), rendre: commissions, parties: ["paiements", "reservations"], nets: true },
  clients: { titre: N_("Clients"), rendre: clients, parties: ["dossiers"] },
  services: { titre: N_("Services"), complet: N_("Services et partenaires"), rendre: services, parties: ["reservations"], reservations: true },
  avenir: { titre: N_("À venir"), complet: N_("Réservations à venir"), rendre: avenir, parties: ["reservations", "dossiers"], futur: true, departs: true },
  devis: { titre: N_("Devis"), rendre: devis, parties: ["dossiers"], sansTaxi: true, sansExcursions: true },
};

// Une section a-t-elle un sens pour l'entreprise ouverte ? m : { taxi, excursions, reservations }.
// « À venir » reste en ZTP sans réservations pour les départs ; Services demande le module Réservations ; Devis n'existe qu'en ZTP.
export function sectionVisible(v, m) {
  if (!v) return false;
  if (m.taxi && v.sansTaxi) return false;
  if (m.excursions && v.sansExcursions) return false;
  if (v.reservations && !m.reservations) return false;
  if (v.departs && !m.reservations && m.excursions) return false;
  return true;
}

// ---- Liste derrière un chiffre ------------------------------------------------------------------------------------------------------------
export function liste(X, id, filtre) {
  const rows = S.lignesFiltrees(id, X.faits, X.c, filtre);
  const total = S.somme(rows);
  const source = id === "revenu" ? "revenu" : S.MESURES[id].source;
  const ligneDossier = (l) => `#/dossier/${l.dossier_id}`;
  const cles = { titre: N_("Dossier"), date: N_("Date"), montant: N_("Montant") };
  const colMontant = { cle: "montant", titre: cles.montant, num: true, valeur: (l) => l.montant, rendu: (l) => m$(X, l.montant), somme: (v) => m$(X, v.reduce((t, l) => t + l.montant, 0)) };
  const colDossier = { cle: "titre", titre: cles.titre, valeur: (l) => l.titre, rendu: (l) => l.titre, lien: (l) => ligneDossier(l) };
  const colDate = { cle: "date", titre: cles.date, valeur: (l) => l.date || "", rendu: (l) => (l.date ? formatDate(l.date) : "—") };
  let colonnes;
  if (source === "dossiers") {
    colonnes = [colDossier, colDate, ...(id === "a_encaisser" || id === "devis_attente" ? [{ cle: "age", titre: N_("Ancienneté"), num: true, valeur: (l) => l.age, rendu: (l) => tr("{n} jours", { n: l.age }) }] : []), ...(X.excursions ? [] : [{ cle: "pays", titre: N_("Destination"), valeur: (l) => l.src.pays || "", rendu: (l) => l.src.pays || "—" }]), colMontant];
  } else if (source === "paiements") {
    colonnes = [colDate, colDossier, { cle: "moyen", titre: N_("Moyen de paiement"), valeur: (l) => l.moyen || "", rendu: (l) => libelleGroupe("moyen", { cle: l.moyen || tr("Non précisé") }) }, colMontant];
  } else if (source === "revenu") {
    colonnes = [colDate, { cle: "nature", titre: N_("Nature"), valeur: (l) => l.nature, rendu: (l) => tr(l.nature) }, { cle: "titre", titre: N_("Dossier ou service"), valeur: (l) => l.titre, rendu: (l) => l.titre, lien: (l) => ligneDossier(l) }, colMontant];
  } else {
    colonnes = [{ cle: "titre", titre: N_("Service"), valeur: (l) => l.titre, rendu: (l) => l.titre, lien: (l) => ligneDossier(l) }, colDate, { cle: "partenaire", titre: N_("Partenaire"), valeur: (l) => l.partenaire || "", rendu: (l) => l.partenaire || "—" }, { cle: "client", titre: N_("Dossier"), valeur: (l) => l.ref, rendu: (l) => `${l.ref} · ${l.client || "—"}` }, { cle: "personnes", titre: N_("Personnes"), num: true, valeur: (l) => l.personnes, rendu: (l) => String(l.personnes) }, { cle: "statut", titre: N_("Statut"), valeur: (l) => l.statut, rendu: (l) => libelleGroupe("statut", { cle: l.statut }) }, { cle: "paiement", titre: N_("Paiement"), valeur: (l) => (l.sur_place ? 1 : 0), rendu: (l) => libelleGroupe("paiement", { cle: l.sur_place ? "place" : "nous" }) }, colMontant];
  }
  const dim = filtre ? filtre.slice(0, filtre.indexOf(":")) : null;
  const cle = filtre ? filtre.slice(filtre.indexOf(":") + 1) : null;
  const valeurFiltre = dim ? libelleGroupe(dim, { cle, libelle: (rows[0] && (dim === "client" ? rows[0].client : dim === "prestation" ? rows[0].titre : null)) || cle }) : null;
  return {
    titre: titreMesure(id),
    filtre: dim ? `${tr(TITRE_DIM[dim])} : ${valeurFiltre}` : null,
    total,
    colonnes,
    rows,
    noeud: tableauTrie({ colonnes, lignes: rows, etatInitial: { tri: X.tri || (source === "dossiers" || source === "reservations" ? "montant" : "date"), sens: X.sens, q: X.q }, onEtat: X.surEtat, recherche: (l) => `${l.titre} ${l.client || ""} ${l.partenaire || ""} ${l.ref || ""}`, pied: true, vide: tr("Aucune ligne derrière ce chiffre."), classe: "st-liste" }),
  };
}
