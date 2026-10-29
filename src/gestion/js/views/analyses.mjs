// Tableau analytique : les chiffres viennent de la base (fonction tableau_analytique), jamais calculés ici
// sauf en démonstration. Réservé aux rôles qui ont les droits « analyses » et « montants ».
import { etat, peut, entiteActive, reglages } from "../etat.mjs";
import { h, vider } from "../ui.mjs";
import { aujourdhui, ajouterJours, formatNombre, formatMontant, nomMois } from "../calc.mjs";
import { vide, telecharger } from "./commun.mjs";

const NS = "http://www.w3.org/2000/svg";
export const s = (tag, attrs = {}, ...enfants) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...enfants.flat().filter((x) => x !== null && x !== undefined));
  return el;
};

export const periodes = {
  mois: ["Ce mois-ci", (j) => [`${j.slice(0, 7)}-01`, j]],
  trois: ["3 derniers mois", (j) => [debutMois(j, -2), j]],
  douze: ["12 derniers mois", (j) => [debutMois(j, -11), j]],
  annee: ["Cette année", (j) => [`${j.slice(0, 4)}-01-01`, j]],
  precedente: ["Année dernière", (j) => [`${Number(j.slice(0, 4)) - 1}-01-01`, `${Number(j.slice(0, 4)) - 1}-12-31`]],
  perso: ["Dates au choix", null],
};

export function debutMois(jour, decalage) {
  const d = new Date(`${jour.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + decalage);
  return d.toISOString().slice(0, 10);
}

export function listeMois(du, au) {
  const m = [];
  const d = new Date(`${du.slice(0, 7)}-01T12:00:00Z`);
  while (d.toISOString().slice(0, 7) <= au.slice(0, 7)) {
    m.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return m;
}

// « janv. 26 », « mars 26 », « juil. 26 » : abréviation courante du mois, les mois courts restent entiers.
export const libelleMois = (m) => {
  const nom = nomMois(`${m}-01`);
  const court = nom.length <= 4 ? nom : `${nom.slice(0, nom.startsWith("juil") ? 4 : 3)}.`;
  return `${court} ${m.slice(2, 4)}`;
};

// Graphique en barres groupées : facturé et encaissé par mois.
function graphiqueMensuel(mois, facture, encaisse, devise) {
  const L = 760, H = 280, g = 52, b = 34, h0 = H - b - 16;
  const max = Math.max(1, ...mois.map((m) => Math.max(facture.get(m) || 0, encaisse.get(m) || 0)));
  const pas = 10 ** Math.floor(Math.log10(max));
  const plafond = Math.ceil(max / pas) * pas;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(plafond * t));
  const largeur = (L - g) / mois.length;
  const bw = Math.max(6, Math.min(28, largeur / 2.6));
  const y = (v) => 16 + h0 - (v / plafond) * h0;
  return s(
    "svg",
    { viewBox: `0 0 ${L} ${H}`, class: "graphique", role: "img", "aria-label": `Facturé et encaissé par mois, en ${devise}. Les chiffres sont dans le tableau en dessous.` },
    ticks.map((t) => s("g", {}, s("line", { x1: g, x2: L, y1: y(t), y2: y(t), class: "grille" }), s("text", { x: g - 8, y: y(t) + 4, class: "axe", "text-anchor": "end" }, formatNombre(t)))),
    mois.map((m, i) => {
      const x = g + i * largeur + largeur / 2;
      const f = facture.get(m) || 0;
      const e = encaisse.get(m) || 0;
      return s(
        "g",
        {},
        s("rect", { x: x - bw - 1, y: y(f), width: bw, height: Math.max(0, 16 + h0 - y(f)), class: "barre-facture" }, s("title", {}, `${libelleMois(m)} : facturé ${formatNombre(f)} ${devise}`)),
        s("rect", { x: x + 1, y: y(e), width: bw, height: Math.max(0, 16 + h0 - y(e)), class: "barre-encaisse" }, s("title", {}, `${libelleMois(m)} : encaissé ${formatNombre(e)} ${devise}`)),
        s("text", { x, y: H - 14, class: "axe", "text-anchor": "middle" }, libelleMois(m))
      );
    })
  );
}

export function barresHorizontales(lignes, devise) {
  const max = Math.max(1, ...lignes.map((l) => l.montant));
  return h(
    "table",
    { class: "tableau simple analyse-table" },
    h("tbody", null, lignes.map((l) => h("tr", null, h("td", { "data-label": "Libellé" }, l.libelle), h("td", { class: "barre-cellule", "aria-hidden": "true" }, h("span", { class: "barre-h", style: `width:${Math.max(2, (l.montant / max) * 100)}%` })), h("td", { class: "num", "data-label": "Montant" }, formatMontant(l.montant, devise)), h("td", { class: "num sec", "data-label": "Dossiers" }, `${l.nombre} dossier${l.nombre > 1 ? "s" : ""}`))))
  );
}

export function vueAnalyses() {
  if (!(peut("analytics.voir") && peut("finances.voir"))) return vide("Accès réservé", "Le tableau analytique est réservé aux rôles qui ont les droits « analyses » et « montants ».", h("a", { class: "bouton secondaire", href: "#/" }, "Retour au tableau de bord"));
  const jour = aujourdhui();
  const etatVue = { periode: "douze", du: periodes.douze[1](jour)[0], au: jour, devise: reglages().devise };
  const corps = h("div", { "aria-live": "polite" });

  const selPeriode = h("select", { id: "an-periode", onchange: (e) => { etatVue.periode = e.target.value; perso.hidden = e.target.value !== "perso"; if (e.target.value !== "perso") { [etatVue.du, etatVue.au] = periodes[e.target.value][1](jour); charger(); } } }, Object.entries(periodes).map(([k, [l]]) => h("option", { value: k }, l)));
  selPeriode.value = etatVue.periode;
  const du = h("input", { id: "an-du", type: "date", value: etatVue.du, onchange: (e) => ((etatVue.du = e.target.value), charger()) });
  const au = h("input", { id: "an-au", type: "date", value: etatVue.au, onchange: (e) => ((etatVue.au = e.target.value), charger()) });
  const perso = h("div", { class: "grille-form filtres", hidden: true }, h("div", { class: "champ" }, h("label", { for: "an-du" }, "Du"), du), h("div", { class: "champ" }, h("label", { for: "an-au" }, "Au"), au));
  const choixDevise = h("div", { class: "champ" });

  let donnees = null;
  async function charger() {
    if (!etatVue.du || !etatVue.au || etatVue.du > etatVue.au) return;
    vider(corps).append(h("p", { class: "aide" }, "Calcul en cours…"));
    try {
      donnees = await etat.store.analyses({ entiteId: etat.entiteId, du: etatVue.du, au: etatVue.au, jour });
      dessiner();
    } catch (err) {
      vider(corps).append(h("p", { class: "erreur-form", role: "alert" }, `Impossible de calculer les analyses : ${err.message}`));
    }
  }

  function dessiner() {
    const d = donnees;
    const devises = [...new Set([...d.facture_par_mois, ...d.encaisse_par_mois, ...d.impayes, ...d.top_clients, ...d.par_pays].map((x) => x.devise))];
    if (!devises.length) devises.push(reglages().devise);
    if (!devises.includes(etatVue.devise)) etatVue.devise = devises[0];
    const dev = etatVue.devise;
    vider(choixDevise);
    if (devises.length > 1) choixDevise.append(h("label", { for: "an-devise" }, "Devise"), h("select", { id: "an-devise", onchange: (e) => ((etatVue.devise = e.target.value), dessiner()) }, devises.map((x) => h("option", { value: x, selected: x === dev }, x))));
    const somme = (lignes) => lignes.filter((x) => x.devise === dev).reduce((t, x) => t + Number(x.montant), 0);
    const facture = new Map(d.facture_par_mois.filter((x) => x.devise === dev).map((x) => [x.mois, Number(x.montant)]));
    const encaisse = new Map(d.encaisse_par_mois.filter((x) => x.devise === dev).map((x) => [x.mois, Number(x.montant)]));
    const mois = listeMois(etatVue.du, etatVue.au);
    const impayes = d.impayes.filter((x) => x.devise === dev);
    const totalImpayes = impayes.reduce((t, x) => t + Number(x.montant), 0);
    const conv = d.devis.emis ? Math.round((d.devis.acceptes / d.devis.emis) * 100) : null;
    const chiffre = (libelle, valeur, detail) => h("div", { class: "chiffre" }, h("p", { class: "chiffre-libelle" }, libelle), h("p", { class: "chiffre-valeur" }, valeur), h("p", { class: "chiffre-detail" }, detail || " "));
    const classement = (liste, cle) => liste.filter((x) => x.devise === dev).map((x) => ({ libelle: x[cle] || "—", montant: Number(x.montant), nombre: x.nombre }));

    vider(corps).append(
      h("div", { class: "chiffres" }, chiffre("Facturé", formatMontant(somme(d.facture_par_mois), dev), `${d.facture_par_mois.filter((x) => x.devise === dev).reduce((t, x) => t + x.nombre, 0)} facture(s) émise(s)`), chiffre("Encaissé", formatMontant(somme(d.encaisse_par_mois), dev), `${d.encaisse_par_mois.filter((x) => x.devise === dev).reduce((t, x) => t + x.nombre, 0)} paiement(s)`), chiffre("Reste à encaisser", formatMontant(totalImpayes, dev), "tous dossiers acceptés ou facturés")),
      h("div", { class: "chiffres" }, chiffre("Devis émis", String(d.devis.emis), "sur la période"), chiffre("Devis acceptés", conv === null ? "—" : `${d.devis.acceptes} (${conv} %)`, "part des devis émis"), chiffre("Délai moyen d'acceptation", d.devis.delai_moyen_jours === null ? "—" : `${String(d.devis.delai_moyen_jours).replace(".", ",")} jours`, "entre l'envoi et l'acceptation")),
      h("section", null, h("h2", null, "Facturé et encaissé par mois"), h("div", { class: "legende" }, h("span", null, h("i", { class: "pastille-facture" }), " Facturé"), h("span", null, h("i", { class: "pastille-encaisse" }), " Encaissé")), graphiqueMensuel(mois, facture, encaisse, dev),
        h("details", null, h("summary", null, "Voir les chiffres"), h("table", { class: "tableau simple" }, h("thead", null, h("tr", null, h("th", { scope: "col" }, "Mois"), h("th", { scope: "col", class: "num" }, "Facturé"), h("th", { scope: "col", class: "num" }, "Encaissé"))), h("tbody", null, mois.map((m) => h("tr", null, h("td", { "data-label": "Mois" }, libelleMois(m)), h("td", { class: "num", "data-label": "Facturé" }, formatMontant(facture.get(m) || 0, dev)), h("td", { class: "num", "data-label": "Encaissé" }, formatMontant(encaisse.get(m) || 0, dev)))))))),
      h("section", null, h("h2", null, "Impayés par ancienneté"), impayes.length ? barresHorizontales(impayes.map((x) => ({ libelle: `${x.tranche} jours`, montant: Number(x.montant), nombre: x.nombre })), dev) : h("p", { class: "vide-court" }, "Aucun impayé."), h("p", { class: "aide" }, "L'ancienneté se compte depuis l'émission de la facture, ou depuis l'acceptation du devis s'il n'y a pas de facture.")),
      h("div", { class: "deux-colonnes" },
        h("section", null, h("h2", null, "Meilleurs clients"), classement(d.top_clients, "client").length ? barresHorizontales(classement(d.top_clients, "client"), dev) : h("p", { class: "vide-court" }, "Aucune donnée sur la période.")),
        h("section", null, h("h2", null, "Par destination ou service"), classement(d.par_pays, "pays").length ? barresHorizontales(classement(d.par_pays, "pays"), dev) : h("p", { class: "vide-court" }, "Aucune donnée sur la période."))),
      h("section", null, h("h2", null, "Par responsable"), classement(d.par_responsable, "responsable").length ? barresHorizontales(classement(d.par_responsable, "responsable"), dev) : h("p", { class: "vide-court" }, "Aucune donnée sur la période."), h("p", { class: "aide" }, "Dossiers acceptés ou facturés sur la période, hors dossiers annulés.")),
      peut("exports.faire") ? h("div", { class: "actions gauche" }, h("button", { class: "secondaire", type: "button", onclick: () => exporter() }, "Exporter ces chiffres (Excel)")) : null
    );
  }

  function exporter() {
    const lignes = [["Sujet", "Libellé", "Devise", "Montant", "Nombre"]];
    for (const x of donnees.facture_par_mois) lignes.push(["Facturé par mois", x.mois, x.devise, x.montant, x.nombre]);
    for (const x of donnees.encaisse_par_mois) lignes.push(["Encaissé par mois", x.mois, x.devise, x.montant, x.nombre]);
    for (const x of donnees.impayes) lignes.push(["Impayés", `${x.tranche} jours`, x.devise, x.montant, x.nombre]);
    for (const x of donnees.top_clients) lignes.push(["Meilleurs clients", x.client, x.devise, x.montant, x.nombre]);
    for (const x of donnees.par_pays) lignes.push(["Par destination", x.pays, x.devise, x.montant, x.nombre]);
    for (const x of donnees.par_responsable) lignes.push(["Par responsable", x.responsable, x.devise, x.montant, x.nombre]);
    const cellule = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    telecharger(`analyses-${entiteActive().slug}-${etatVue.du}-${etatVue.au}.csv`, "﻿" + lignes.map((l) => l.map(cellule).join(";")).join("\r\n"), "text/csv;charset=utf-8");
  }

  charger();
  return h(
    "div",
    { "data-titre": "Analyses" },
    h("div", { class: "entete" }, h("div", null, h("h1", null, "Analyses"), h("p", { class: "sous" }, entiteActive().nom))),
    h("div", { class: "barre-outils" }, h("div", { class: "grille-form filtres" }, h("div", { class: "champ" }, h("label", { for: "an-periode" }, "Période"), selPeriode), choixDevise), perso),
    corps
  );
}
