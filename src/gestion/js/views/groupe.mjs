// Vue d'ensemble : toutes les sociétés sur une même période, dans une devise de consolidation.
// Chaque société est calculée par la base avec ses propres droits ; ici on convertit, on additionne et on compare.
import { etat, entitesAnalysables, peut } from "../etat.mjs";
import { completerReglages } from "../defauts.mjs";
import { h, vider, toast } from "../ui.mjs";
import { aujourdhui, formatNombre, nomMois } from "../calc.mjs";
import { tauxDepuisReglages, periodePrecedente, syntheseEntite, consolider, seriesMensuelles, classementGroupe } from "../groupe.mjs";
import { s, periodes, listeMois, libelleMois, libelleSpecial, barresHorizontales } from "./analyses.mjs";
import { vide, telecharger } from "./commun.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";

const CLE_TAUX = "gestion-groupe-taux";
const montant = (n, dev) => `${dev} ${formatNombre(Math.round(Number(n) || 0))}`;

const lireTauxPerso = (cible) => {
  try {
    return JSON.parse(localStorage.getItem(`${CLE_TAUX}:${cible}`) || "{}");
  } catch {
    return {};
  }
};
const ecrireTauxPerso = (cible, v) => {
  try {
    localStorage.setItem(`${CLE_TAUX}:${cible}`, JSON.stringify(v));
  } catch {
    // sans importance
  }
};

// Évolution par rapport à la période précédente, avec le signe en toutes lettres pour les lecteurs d'écran.
function evol(pct) {
  if (pct === null || pct === undefined) return h("span", { class: "evol neutre" }, "—");
  const signe = pct > 0 ? "+" : "";
  return h("span", { class: pct > 0 ? "evol plus" : pct < 0 ? "evol moins" : "evol neutre", "aria-label": `${pct > 0 ? "en hausse de" : pct < 0 ? "en baisse de" : "stable,"} ${Math.abs(pct)} %` }, tr("{signe}{pct} %", { signe, pct }));
}

// Barres empilées par mois : une couleur par société.
function graphiqueEmpile(mois, series, devise) {
  const L = 760, H = 280, g = 56, b = 34, h0 = H - b - 16;
  const totalMois = (m) => series.reduce((t, x) => t + (x.valeurs[m] || 0), 0);
  const max = Math.max(1, ...mois.map(totalMois));
  const pas = 10 ** Math.floor(Math.log10(max));
  const plafond = Math.ceil(max / pas) * pas;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(plafond * t));
  const largeur = (L - g) / mois.length;
  const bw = Math.max(8, Math.min(36, largeur / 1.8));
  const y = (v) => 16 + h0 - (v / plafond) * h0;
  return s(
    "svg",
    { viewBox: `0 0 ${L} ${H}`, class: "graphique", role: "img", "aria-label": tr("Montants par mois et par société, en {devise}. Les chiffres sont dans le tableau en dessous.", { devise }) },
    ticks.map((t) => s("g", {}, s("line", { x1: g, x2: L, y1: y(t), y2: y(t), class: "grille" }), s("text", { x: g - 8, y: y(t) + 4, class: "axe", "text-anchor": "end" }, formatNombre(t)))),
    mois.map((m, i) => {
      const x = g + i * largeur + largeur / 2;
      let cumul = 0;
      const rects = series.map((serie, k) => {
        const v = serie.valeurs[m] || 0;
        const haut = y(cumul + v);
        const bas = y(cumul);
        cumul += v;
        return v > 0 ? s("rect", { x: x - bw / 2, y: haut, width: bw, height: Math.max(0, bas - haut), class: `serie-${k % 5}` }, s("title", {}, `${libelleMois(m)} · ${serie.entite.nom} : ${formatNombre(v)} ${devise}`)) : null;
      });
      return s("g", {}, rects, s("text", { x, y: H - 14, class: "axe", "text-anchor": "middle" }, libelleMois(m)));
    })
  );
}

export function vueGroupe() {
  const entites = entitesAnalysables();
  if (!entites.length) return vide(tr("Accès réservé"), tr("La vue d'ensemble est réservée aux personnes qui ont les droits « analyses » et « montants » dans au moins une société."), h("a", { class: "bouton secondaire", href: "#/" }, tr("Retour au tableau de bord")));
  const jour = aujourdhui();
  const reglagesDe = (e) => completerReglages(etat.brut.reglages[e.id]);
  const entreprises = entites.map((e) => ({ entite: e, nom: e.nom, reglages: reglagesDe(e), devise: reglagesDe(e).devise, taux: reglagesDe(e).taux }));
  const devisesConnues = [...new Set(entreprises.map((x) => x.devise).filter(Boolean))];
  const etatVue = { periode: "douze", du: periodes.douze[1](jour)[0], au: jour, cible: devisesConnues[0] || "CHF", serie: "facture_par_mois" };
  const corps = h("div", { "aria-live": "polite" });
  let brut = null; // [{ entite, donnees, precedent }]

  const selPeriode = h(
    "select",
    {
      id: "gr-periode",
      onchange: (e) => {
        etatVue.periode = e.target.value;
        perso.hidden = e.target.value !== "perso";
        if (e.target.value !== "perso") {
          [etatVue.du, etatVue.au] = periodes[e.target.value][1](jour);
          du.value = etatVue.du;
          au.value = etatVue.au;
          charger();
        }
      },
    },
    Object.entries(periodes).map(([k, [l]]) => h("option", { value: k }, tr(l)))
  );
  selPeriode.value = etatVue.periode;
  const du = h("input", { id: "gr-du", type: "date", value: etatVue.du, onchange: (e) => ((etatVue.du = e.target.value), charger()) });
  const au = h("input", { id: "gr-au", type: "date", value: etatVue.au, onchange: (e) => ((etatVue.au = e.target.value), charger()) });
  const perso = h("div", { class: "grille-form filtres", hidden: true }, h("div", { class: "champ" }, h("label", { for: "gr-du" }, tr("Du")), du), h("div", { class: "champ" }, h("label", { for: "gr-au" }, tr("Au")), au));
  const choixDevise = h("div", { class: "champ" });

  async function charger() {
    if (!etatVue.du || !etatVue.au || etatVue.du > etatVue.au) return;
    vider(corps).append(h("p", { class: "aide" }, tr("Calcul en cours pour chaque société…")));
    const [duPrec, auPrec] = periodePrecedente(etatVue.du, etatVue.au);
    try {
      brut = await Promise.all(
        entites.map(async (entite) => {
          const [donnees, precedent] = await Promise.all([etat.store.analyses({ entiteId: entite.id, du: etatVue.du, au: etatVue.au, jour }), etat.store.analyses({ entiteId: entite.id, du: duPrec, au: auPrec, jour })]);
          return { entite, donnees, precedent };
        })
      );
      dessiner();
    } catch (err) {
      vider(corps).append(h("p", { class: "erreur-form", role: "alert" }, tr("Impossible de calculer la vue d'ensemble : {message}", { message: err.message })));
    }
  }

  function tauxActuels() {
    const { taux, source } = tauxDepuisReglages(entreprises, etatVue.cible);
    const perso = lireTauxPerso(etatVue.cible);
    for (const [k, v] of Object.entries(perso)) if (Number(v) > 0) (taux[k] = Number(v)), (source[k] = "saisi ici");
    return { taux, source };
  }

  function dessiner() {
    const cible = etatVue.cible;
    const devisesVues = [...new Set([...devisesConnues, ...brut.flatMap(({ donnees }) => [...donnees.facture_par_mois, ...donnees.encaisse_par_mois, ...donnees.impayes, ...(donnees.pipeline || [])].map((x) => x.devise))])].filter(Boolean);
    vider(choixDevise).append(h("label", { for: "gr-devise" }, tr("Tout ramener en")), h("select", { id: "gr-devise", onchange: (e) => ((etatVue.cible = e.target.value), dessiner()) }, devisesVues.map((x) => h("option", { value: x, selected: x === cible }, x))));
    const { taux, source } = tauxActuels();
    const syntheses = brut.map(({ entite, donnees, precedent }) => syntheseEntite({ entite, donnees, precedent, cible, taux }));
    const groupe = consolider(syntheses);
    const mois = listeMois(etatVue.du, etatVue.au);
    const series = seriesMensuelles(brut, etatVue.serie, cible, taux);
    const manquantes = devisesVues.filter((d) => d !== cible && !(Number(taux[d]) > 0));

    const chiffre = (libelle, valeur, detail) => h("div", { class: "chiffre" }, h("p", { class: "chiffre-libelle" }, libelle), h("p", { class: "chiffre-valeur" }, valeur), h("p", { class: "chiffre-detail" }, detail || " "));
    const pastille = (k) => h("i", { class: `pastille serie-${k % 5}`, "aria-hidden": "true" });
    const num = (v, extra) => h("td", { class: "num", ...extra }, v);

    const ligneSociete = (sy, k) =>
      h(
        "tr",
        null,
        h("td", { "data-label": tr("Société") }, pastille(k), " ", h("strong", null, sy.entite.nom), sy.manquantes.length ? h("span", { class: "aide-inline" }, tr(" (hors {liste})", { liste: sy.manquantes.join(", ") })) : null),
        num(montant(sy.facture, cible), { "data-label": tr("Facturé") }),
        num(evol(sy.evolFacture), { "data-label": tr("Évolution") }),
        h("td", { class: "num part-cellule", "data-label": tr("Part") }, groupe.parts[k].part === null ? "—" : [h("span", { class: `barre-h serie-${k % 5}`, style: `width:${Math.max(2, groupe.parts[k].part)}%`, "aria-hidden": "true" }), `${groupe.parts[k].part} %`]),
        num(montant(sy.encaisse, cible), { "data-label": tr("Encaissé") }),
        num(sy.nbImpayes ? montant(sy.impayes, cible) : "—", { "data-label": tr("Impayés") }),
        num(sy.nbPipeline ? `${montant(sy.pipeline, cible)} (${sy.nbPipeline})` : "—", { "data-label": tr("Devis en attente") }),
        num(sy.devisEmis ? `${sy.devisAcceptes} / ${sy.devisEmis}${sy.tauxAcceptation !== null ? ` (${sy.tauxAcceptation} %)` : ""}` : "—", { "data-label": tr("Devis acceptés / émis") }),
        num(`${sy.dossiers} · ${sy.clients}`, { "data-label": tr("Dossiers · clients") }),
        num(sy.panierMoyen === null ? "—" : montant(sy.panierMoyen, cible), { "data-label": tr("Facture moyenne") })
      );
    const ligneTotal = h(
      "tr",
      { class: "total-ligne" },
      h("td", { "data-label": tr("Société") }, h("strong", null, tr("Toutes les sociétés"))),
      num(h("strong", null, montant(groupe.facture, cible)), { "data-label": tr("Facturé") }),
      num(evol(groupe.evolFacture), { "data-label": tr("Évolution") }),
      num("100 %", { "data-label": tr("Part") }),
      num(h("strong", null, montant(groupe.encaisse, cible)), { "data-label": tr("Encaissé") }),
      num(groupe.nbImpayes ? montant(groupe.impayes, cible) : "—", { "data-label": tr("Impayés") }),
      num(groupe.nbPipeline ? `${montant(groupe.pipeline, cible)} (${groupe.nbPipeline})` : "—", { "data-label": tr("Devis en attente") }),
      num(groupe.devisEmis ? `${groupe.devisAcceptes} / ${groupe.devisEmis}${groupe.tauxAcceptation !== null ? ` (${groupe.tauxAcceptation} %)` : ""}` : "—", { "data-label": tr("Devis acceptés / émis") }),
      num(`${groupe.dossiers} · ${groupe.clients}`, { "data-label": tr("Dossiers · clients") }),
      num(groupe.panierMoyen === null ? "—" : montant(groupe.panierMoyen, cible), { "data-label": tr("Facture moyenne") })
    );

    // Taux de conversion : d'où ils viennent, et la possibilité de les corriger ici.
    const champsTaux = devisesVues
      .filter((d) => d !== cible)
      .map((d) => {
        const input = h("input", { id: `gr-taux-${d}`, type: "number", step: "0.000001", min: "0", value: Number(taux[d]) > 0 ? taux[d] : "", placeholder: tr("Taux manquant") });
        input.addEventListener("change", () => {
          const perso = lireTauxPerso(cible);
          if (Number(input.value) > 0) perso[d] = Number(input.value);
          else delete perso[d];
          ecrireTauxPerso(cible, perso);
          dessiner();
        });
        return h("div", { class: "champ" }, h("label", { for: `gr-taux-${d}` }, `1 ${d} =`), h("div", { class: "taux-ligne" }, input, h("span", null, cible)), h("p", { class: "aide" }, source[d] === "saisi ici" ? tr("Taux saisi ici (remplace celui des réglages).") : source[d] ? tr("D'après les réglages de {x}.", { x: source[d] }) : tr("Aucun taux dans les réglages : à saisir.")));
      });

    const tableauMois = h(
      "table",
      { class: "tableau simple" },
      h("thead", null, h("tr", null, h("th", { scope: "col" }, tr("Mois")), series.map((x) => h("th", { scope: "col", class: "num" }, x.entite.nom)), h("th", { scope: "col", class: "num" }, tr("Total")))),
      h(
        "tbody",
        null,
        mois.map((m) =>
          h("tr", null, h("td", null, `${nomMois(`${m}-01`)} ${m.slice(0, 4)}`), series.map((x) => h("td", { class: "num" }, formatNombre(x.valeurs[m] || 0))), h("td", { class: "num" }, h("strong", null, formatNombre(series.reduce((t, x) => t + (x.valeurs[m] || 0), 0)))))
        )
      )
    );

    const topClients = classementGroupe(brut, "top_clients", "client", cible, taux).map((x) => ({ libelle: `${libelleSpecial(x.libelle)} · ${x.entite}`, montant: x.montant, nombre: x.nombre }));
    const parService = classementGroupe(brut, "par_pays", "pays", cible, taux, 10).map((x) => ({ libelle: `${libelleSpecial(x.libelle)} · ${x.entite}`, montant: x.montant, nombre: x.nombre }));
    const meilleureSociete = [...syntheses].sort((a, b) => b.facture - a.facture)[0];
    const meilleurMois = mois.map((m) => [m, series.reduce((t, x) => t + (x.valeurs[m] || 0), 0)]).sort((a, b) => b[1] - a[1])[0];

    vider(corps).append(
      ...[
      manquantes.length ? h("p", { class: "bandeau-info", role: "status" }, tr("Les montants en {liste} ne sont pas convertis en {cible} (taux manquant) et n'entrent pas dans les totaux. Indiquez le taux dans la section « Taux de conversion » en bas de page.", { liste: manquantes.join(", "), cible })) : null,
      h(
        "div",
        { class: "chiffres" },
        chiffre(tr("Facturé, toutes sociétés"), montant(groupe.facture, cible), h("span", null, evol(groupe.evolFacture), tr(" par rapport à la période précédente · {nbFactures} facture(s)", { nbFactures: groupe.nbFactures }))),
        chiffre(tr("Encaissé"), montant(groupe.encaisse, cible), h("span", null, evol(groupe.evolEncaisse), tr(" par rapport à la période précédente"))),
        chiffre(tr("Impayés en cours"), groupe.nbImpayes ? montant(groupe.impayes, cible) : "—", groupe.nbImpayes ? pluriel(groupe.nbImpayes, N_("{n} facture non soldée, à ce jour"), N_("{n} factures non soldées, à ce jour")) : tr("Aucune facture en attente de paiement"))
      ),
      h(
        "div",
        { class: "chiffres" },
        chiffre(tr("Devis en attente"), groupe.nbPipeline ? montant(groupe.pipeline, cible) : "—", groupe.nbPipeline ? pluriel(groupe.nbPipeline, N_("{n} devis envoyé sans réponse, chiffre d'affaires possible"), N_("{n} devis envoyés sans réponse, chiffre d'affaires possible")) : tr("Aucun devis en attente")),
        chiffre(tr("Devis acceptés"), groupe.devisEmis ? tr("{acceptes} sur {emis}", { acceptes: groupe.devisAcceptes, emis: groupe.devisEmis }) : "—", groupe.tauxAcceptation !== null ? tr("{taux} % des devis émis sur la période", { taux: groupe.tauxAcceptation }) : tr("Aucun devis émis sur la période")),
        chiffre(tr("Facture moyenne"), groupe.panierMoyen === null ? "—" : montant(groupe.panierMoyen, cible), tr("{dossiers} pour {clients}", { dossiers: pluriel(groupe.dossiers, N_("dossier"), N_("dossiers")), clients: pluriel(groupe.clients, N_("client"), N_("clients")) }))
      ),
      h(
        "section",
        null,
        h("h2", null, tr("Par société")),
        meilleureSociete && meilleureSociete.facture > 0 ? h("p", { class: "aide" }, tr("{nom} représente {part} % du facturé du groupe sur la période.", { nom: meilleureSociete.entite.nom, part: groupe.parts.find((p) => p.entite.id === meilleureSociete.entite.id).part })) : null,
        h("div", { class: "tableau-defilant" }, h("table", { class: "tableau tableau-groupe" }, h("thead", null, h("tr", null, [tr("Société"), tr("Facturé"), tr("Évolution"), tr("Part"), tr("Encaissé"), tr("Impayés"), tr("Devis en attente"), tr("Devis acceptés / émis"), tr("Dossiers · clients"), tr("Facture moyenne")].map((t, i) => h("th", { scope: "col", class: i ? "num" : null }, t)))), h("tbody", null, syntheses.map(ligneSociete), ligneTotal)))
      ),
      h(
        "section",
        null,
        h("div", { class: "entete-section" }, h("h2", null, tr("Par mois et par société")), h("div", { class: "champ" }, h("label", { for: "gr-serie" }, tr("Afficher")), h("select", { id: "gr-serie", onchange: (e) => ((etatVue.serie = e.target.value), dessiner()) }, h("option", { value: "facture_par_mois", selected: etatVue.serie === "facture_par_mois" }, tr("Le facturé")), h("option", { value: "encaisse_par_mois", selected: etatVue.serie === "encaisse_par_mois" }, tr("L'encaissé"))))),
        h("div", { class: "legende" }, series.map((x, k) => h("span", null, pastille(k), ` ${x.entite.nom}`))),
        graphiqueEmpile(mois, series, cible),
        meilleurMois && meilleurMois[1] > 0 ? h("p", { class: "aide" }, tr("Meilleur mois : {mois} {annee}, {montant}.", { mois: nomMois(`${meilleurMois[0]}-01`), annee: meilleurMois[0].slice(0, 4), montant: montant(meilleurMois[1], cible) })) : null,
        h("details", null, h("summary", null, tr("Voir les chiffres")), tableauMois)
      ),
      h(
        "div",
        { class: "deux-colonnes" },
        h("section", null, h("h2", null, tr("Meilleurs clients, toutes sociétés")), topClients.length ? barresHorizontales(topClients, cible) : h("p", { class: "vide-court" }, tr("Aucune donnée sur la période."))),
        h("section", null, h("h2", null, tr("Destinations et services")), parService.length ? barresHorizontales(parService, cible) : h("p", { class: "vide-court" }, tr("Aucune donnée sur la période.")))
      ),
      h(
        "section",
        null,
        h("h2", null, tr("Taux de conversion")),
        h("p", { class: "aide" }, tr("Les montants sont ramenés en {cible} à titre indicatif, avec les taux ci-dessous. Chaque société garde ses chiffres exacts dans sa propre devise (écran Analyses).", { cible })),
        champsTaux.length ? h("div", { class: "taux-grille" }, champsTaux) : h("p", { class: "vide-court" }, tr("Toutes les sociétés travaillent dans la même devise.")),
        Object.keys(lireTauxPerso(cible)).length ? h("button", { class: "lien", type: "button", onclick: () => (ecrireTauxPerso(cible, {}), dessiner(), toast(tr("Taux des réglages rétablis."))) }, tr("Rétablir les taux des réglages")) : null
      ),
      peut("exports.faire") ? h("div", { class: "actions gauche" }, h("button", { class: "secondaire", type: "button", onclick: () => exporter(syntheses, groupe, series, mois, cible) }, tr("Exporter ces chiffres (Excel)"))) : null,
      ].filter(Boolean)
    );
  }

  function exporter(syntheses, groupe, series, mois, cible) {
    const cellule = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const lignes = [[tr("Société"), tr("Facturé ({cible})", { cible }), tr("Évolution %"), tr("Part %"), tr("Encaissé ({cible})", { cible }), tr("Impayés ({cible})", { cible }), tr("Devis en attente ({cible})", { cible }), tr("Devis émis"), tr("Devis acceptés"), tr("Dossiers"), tr("Clients"), tr("Facture moyenne ({cible})", { cible })]];
    syntheses.forEach((sy, k) => lignes.push([sy.entite.nom, sy.facture, sy.evolFacture ?? "", groupe.parts[k].part ?? "", sy.encaisse, sy.impayes, sy.pipeline, sy.devisEmis, sy.devisAcceptes, sy.dossiers, sy.clients, sy.panierMoyen ?? ""]));
    lignes.push([tr("Toutes les sociétés"), groupe.facture, groupe.evolFacture ?? "", 100, groupe.encaisse, groupe.impayes, groupe.pipeline, groupe.devisEmis, groupe.devisAcceptes, groupe.dossiers, groupe.clients, groupe.panierMoyen ?? ""]);
    lignes.push([]);
    lignes.push([tr("Mois"), ...series.map((x) => `${x.entite.nom} (${cible})`), tr("Total ({cible})", { cible })]);
    for (const m of mois) lignes.push([m, ...series.map((x) => x.valeurs[m] || 0), series.reduce((t, x) => t + (x.valeurs[m] || 0), 0)]);
    telecharger(`vue-ensemble-${etatVue.du}-${etatVue.au}.csv`, "﻿" + lignes.map((l) => l.map(cellule).join(";")).join("\r\n"), "text/csv;charset=utf-8");
  }

  charger();

  return h(
    "div",
    { "data-titre": tr("Vue d'ensemble"), "data-large": "1" },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Vue d'ensemble")), h("p", { class: "sous" }, tr("{n} société(s) : {liste}", { n: entites.length, liste: entites.map((e) => e.nom).join(", ") })))),
    h("div", { class: "barre-outils" }, h("div", { class: "grille-form filtres" }, h("div", { class: "champ" }, h("label", { for: "gr-periode" }, tr("Période")), selPeriode), choixDevise), perso),
    corps
  );
}
