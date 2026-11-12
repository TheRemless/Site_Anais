// Statistiques : une page par section (vue d'ensemble, ventes, encaissements, commissions et marge, clients, services,
// réservations à venir, devis), la période et la comparaison dans l'adresse, une liste derrière chaque chiffre.
// Les faits viennent de la base (fonction analyse_faits), un appel par section ; les indicateurs sont dans stats-calc.mjs.
// Réservé aux rôles qui ont les droits « analyses » et « montants » ; commissions, nets et marge demandent aussi « nets ».
import { etat, peut, entiteActive, reglages, entitesAnalysables, modeExcursions } from "../etat.mjs";
import { h, vider, modal, toast } from "../ui.mjs";
import { aujourdhui, formatDate, formatMontant } from "../calc.mjs";
import { vide, telecharger } from "./commun.mjs";
import { tr, moisCourt, N_, pluriel } from "../i18n.mjs";
import * as S from "../stats-calc.mjs";
import { resumeMois } from "../analyses-resume.mjs";
import { SECTIONS, liste } from "./analyses-sections.mjs";
import { squelette, s } from "./analyses-widgets.mjs";

export { s };

export const periodes = {
  mois: [N_("Ce mois-ci"), (j) => [`${j.slice(0, 7)}-01`, j]],
  trois: [N_("3 derniers mois"), (j) => [debutMois(j, -2), j]],
  douze: [N_("12 derniers mois"), (j) => [debutMois(j, -11), j]],
  annee: [N_("Cette année"), (j) => [`${j.slice(0, 4)}-01-01`, j]],
  precedente: [N_("Année dernière"), (j) => [`${Number(j.slice(0, 4)) - 1}-01-01`, `${Number(j.slice(0, 4)) - 1}-12-31`]],
  perso: [N_("Dates au choix"), null],
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

// « janv. 26 », « mars 26 » / « Jan 26 » : abréviation du mois dans la langue de l'interface.
// Libellés que la base écrit elle-même en français quand l'information manque : on les traduit à l'affichage.
const SPECIAUX = [N_("Non renseigné"), N_("Sans responsable")];
export const libelleSpecial = (s) => (SPECIAUX.includes(s) ? tr(s) : s);

export const libelleMois = (m) => {
  return `${moisCourt(`${m}-01`)} ${m.slice(2, 4)}`;
};


export function barresHorizontales(lignes, devise) {
  const max = Math.max(1, ...lignes.map((l) => l.montant));
  return h(
    "table",
    { class: "tableau simple analyse-table" },
    h("tbody", null, lignes.map((l) => h("tr", null, h("td", { "data-label": tr("Libellé") }, l.libelle), h("td", { class: "barre-cellule", "aria-hidden": "true" }, h("span", { class: "barre-h", style: `width:${Math.max(2, (l.montant / max) * 100)}%` })), h("td", { class: "num", "data-label": tr("Montant") }, formatMontant(l.montant, devise)), h("td", { class: "num sec", "data-label": tr("Dossiers") }, pluriel(l.nombre, N_("dossier"), N_("dossiers"))))))
  );
}


// ---- Données : un appel par section, gardés quelques secondes pour que le retour depuis une liste soit instantané ----------
const CACHE = new Map();
const DUREE_CACHE = 45000;
const PARTIES = ["dossiers", "paiements", "reservations"];
async function obtenir(entiteId, debut, fin, jour, parties) {
  const besoin = parties || PARTIES;
  const cle = `${etat.session ? etat.session.id : ""}|${entiteId}|${debut}|${fin}|${jour}`;
  let e = CACHE.get(cle);
  if (e && Date.now() - e.at > DUREE_CACHE) e = null;
  const manque = e ? besoin.filter((x) => !e.parts.has(x)) : besoin;
  if (e && !manque.length) return e.faits;
  const r = await etat.store.analyseFaits({ entiteId, debut, fin, jour, parties: manque });
  if (!e) e = { at: Date.now(), parts: new Set(), faits: { nets: !!r.nets, devise_defaut: r.devise_defaut || "", dossiers: [], paiements: [], reservations: [] } };
  for (const k of manque) {
    e.faits[k] = r[k] || [];
    e.parts.add(k);
  }
  CACHE.set(cle, e);
  return e.faits;
}

// Position de défilement de chaque adresse quittée, pour que « retour » retrouve l'endroit où l'on était.
const DEFILEMENTS = new Map();
window.addEventListener("hashchange", (e) => {
  try {
    const ancien = new URL(e.oldURL).hash;
    if (ancien.startsWith("#/analyses")) DEFILEMENTS.set(ancien, window.scrollY);
  } catch {
    // adresse illisible : sans importance
  }
});

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const BASE = "#/analyses";

// Adresse d'une page : section, période, comparaison, devise, et (pour une liste) la mesure et son filtre.
function adresse(section, p) {
  const q = new URLSearchParams();
  for (const k of ["p", "du", "au", "cmp", "dev", "g", "liste", "filtre", "tri", "sens", "q"]) if (p[k] !== undefined && p[k] !== null && p[k] !== "") q.set(k, p[k]);
  const suite = q.toString();
  return `${BASE}${section === "apercu" ? "" : `/${section}`}${suite ? `?${suite}` : ""}`;
}

export function vueAnalyses(sectionArg) {
  if (!(peut("analytics.voir") && peut("finances.voir"))) return vide(tr("Accès réservé"), tr("Le tableau analytique est réservé aux rôles qui ont les droits « analyses » et « montants »."), h("a", { class: "bouton secondaire", href: "#/" }, tr("Retour au tableau de bord")));
  const jour = aujourdhui();
  const q = new URLSearchParams(location.hash.includes("?") ? location.hash.slice(location.hash.indexOf("?") + 1) : "");
  const section = SECTIONS[sectionArg] ? sectionArg : "apercu";
  const def = SECTIONS[section];
  let cle = S.PERIODES.some(([k]) => k === q.get("p")) ? q.get("p") : "mois";
  let du, au;
  if (cle === "perso") [du, au] = [q.get("du"), q.get("au")];
  else [du, au] = S.periodeRapide(cle, jour);
  if (!ISO.test(du || "") || !ISO.test(au || "") || du > au) ((cle = "mois"), ([du, au] = S.periodeRapide("mois", jour)));
  const cmpMode = ["aucune", "prec", "an"].includes(q.get("cmp")) ? q.get("cmp") : "prec";
  const cmp = def.futur ? null : S.periodeComparee(du, au, cmpMode);
  const gran = ["jour", "semaine", "mois"].includes(q.get("g")) ? q.get("g") : S.granularite(du, au);
  const mesure = q.get("liste") && (S.MESURES[q.get("liste")] || q.get("liste") === "revenu") ? q.get("liste") : null;
  const filtre = q.get("filtre") || null;
  const base = { p: cle, du: cle === "perso" ? du : null, au: cle === "perso" ? au : null, cmp: cmpMode === "prec" ? null : cmpMode, dev: q.get("dev"), g: q.get("g") };
  const lien = (nom, extra = {}) => adresse(nom, { ...base, g: null, ...extra });
  // Une agence sans partenaires payants (ZTP) n'a ni net ni marge : pas de section Commissions, pas de tuile Revenu, le revenu est l'encaissé.
  const nets = peut("partenaires.nets") && modeExcursions();
  const sections = Object.entries(SECTIONS).filter(([, v]) => !v.nets || nets);
  const entiteId = etat.entiteId;
  const corps = h("div", { class: "st-corps", "aria-live": "polite" });
  const outilsDroite = h("div", { class: "entete-actions st-actions-haut" });
  const outilsBas = h("div", { class: "st-actions-bas" });
  const choixDevise = h("div", { class: "st-devise champ" });
  let sortie = [];
  let nomExport = "analyses";

  // ---- En-tête, sections, période --------------------------------------------------------------------------------------------------
  const nav = h("nav", { class: "st-nav", "aria-label": tr("Sections des statistiques") }, h("ul", null, sections.map(([k, v]) => h("li", null, h("a", { href: lien(k), class: "st-onglet", "aria-current": k === section ? "page" : null }, tr(v.titre))))));
  // « Dates au choix » garde les dates en cours : sans elles, l'adresse retomberait sur « Ce mois ».
  const puce = (k, libelle) => h("a", { class: "st-puce", href: adresse(section, { ...base, p: k, du: k === "perso" ? du : null, au: k === "perso" ? au : null, g: null }), "aria-current": cle === k ? "true" : null }, tr(libelle));
  const dateDu = h("input", { id: "st-du", type: "date", value: du, max: au, onchange: (e) => (location.hash = adresse(section, { ...base, p: "perso", du: e.target.value, au })) });
  const dateAu = h("input", { id: "st-au", type: "date", value: au, min: du, onchange: (e) => (location.hash = adresse(section, { ...base, p: "perso", du, au: e.target.value })) });
  const selCmp = h("select", { id: "st-cmp", onchange: (e) => (location.hash = adresse(section, { ...base, cmp: e.target.value === "prec" ? null : e.target.value })) }, S.COMPARAISONS.map(([k, l]) => h("option", { value: k, selected: k === cmpMode }, tr(l))));
  const barre = def.futur
    ? h("p", { class: "aide st-barre-futur" }, tr("Cette section regarde devant, la période choisie ailleurs ne s'applique pas."))
    : h("div", { class: "st-barre" }, h("div", { class: "st-puces", role: "group", "aria-label": tr("Période") }, S.PERIODES.map(([k, l]) => puce(k, l))), h("div", { class: "st-reglages" }, cle === "perso" ? [h("div", { class: "champ" }, h("label", { for: "st-du" }, tr("Du")), dateDu), h("div", { class: "champ" }, h("label", { for: "st-au" }, tr("Au")), dateAu)] : null, h("div", { class: "champ" }, h("label", { for: "st-cmp" }, h("span", { class: "st-long" }, tr("Comparer à")), h("span", { class: "st-court", "aria-hidden": "true" }, "vs")), selCmp), choixDevise));
  const periodeTexte = def.futur ? null : h("p", { class: "aide st-periode" }, du === au ? formatDate(du) : tr("du {du} au {au}", { du: formatDate(du), au: formatDate(au) }), cmp ? ` ${tr("comparé à la période du {du} au {au}", { du: formatDate(cmp[0]), au: formatDate(cmp[1]) })}` : null);

  const exporter = () => {
    // Un texte qui commencerait par = + - @ serait lu comme une formule par Excel : on le fait précéder d'une apostrophe (les montants restent des nombres).
    const cellule = (v) => {
      const t = String(v ?? "");
      const sur = typeof v === "string" && /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
      return `"${sur.replaceAll('"', '""')}"`;
    };
    const lignes = [[tr("Sujet"), tr("Libellé"), tr("Devise"), tr("Montant"), tr("Nombre")], ...sortie];
    telecharger(`${nomExport}-${entiteActive().slug}-${du}-${au}.csv`, "﻿" + lignes.map((l) => l.map(cellule).join(";")).join("\r\n"), "text/csv;charset=utf-8");
  };

  async function copierResume() {
    try {
      const [du0] = S.periodeRapide("mois", jour);
      const c0 = S.periodeComparee(du0, jour, "prec");
      const faitsBruts = await obtenir(entiteId, c0[0] < du0 ? c0[0] : du0, jour, jour, null);
      const faits = modeExcursions() ? faitsBruts : { ...faitsBruts, nets: false };
      const devs = S.devises(faits, faits.devise_defaut || reglages().devise);
      const dev = devs.includes(q.get("dev")) ? q.get("dev") : devs.includes(reglages().devise) ? reglages().devise : devs[0] || reglages().devise;
      const texte = resumeMois({ faits, jour, devise: dev, entite: entiteActive().nom });
      const zone = h("textarea", { class: "st-resume", readonly: true, rows: 12, "aria-label": tr("Résumé du mois") }, texte);
      const copier = async () => {
        try {
          await navigator.clipboard.writeText(texte);
        } catch {
          zone.select();
          document.execCommand("copy");
        }
        toast(tr("Résumé copié. Collez-le dans WhatsApp."));
      };
      modal(tr("Résumé du mois"), h("div", { class: "modal-corps" }, h("p", { class: "aide" }, tr("Relisez avant d'envoyer, les chiffres viennent de l'outil à l'instant.")), zone, h("div", { class: "actions" }, h("button", { class: "principal", type: "button", onclick: copier }, tr("Copier le texte")), navigator.share ? h("button", { class: "secondaire", type: "button", onclick: () => navigator.share({ text: texte }).catch(() => {}) }, tr("Partager")) : null)), { feuille: true });
      zone.focus();
    } catch (err) {
      toast(tr("Impossible de préparer le résumé : {message}", { message: err.message }), true);
    }
  }

  const surEtat = (e) => history.replaceState(null, "", adresse(section, { ...base, liste: mesure, filtre, tri: e.tri, sens: e.tri ? e.sens : null, q: e.q }));

  // ---- Chargement et dessin -----------------------------------------------------------------------------------------------------
  async function charger() {
    vider(corps).append(squelette({ tuiles: mesure ? 2 : 8, graphique: !mesure }));
    const t0 = performance.now();
    try {
      let debut = cmp && cmp[0] < du ? cmp[0] : du;
      let fin = au;
      if (def.douze) debut = S.debutMois(jour, -11) < debut ? S.debutMois(jour, -11) : debut;
      if (def.futur) ((debut = jour), (fin = S.finDeMois(jour) > jour ? S.finDeMois(jour) : jour));
      let parties = def.parties;
      if (mesure) {
        const src = mesure === "revenu" ? "revenu" : S.MESURES[mesure].source;
        parties = src === "revenu" ? ["paiements", "reservations"] : [src];
        if (!def.futur && src === "reservations" && parties.length === 1) parties = ["reservations"];
      }
      const faitsBruts = await obtenir(entiteId, debut, fin, jour, parties);
      const faits = modeExcursions() ? faitsBruts : { ...faitsBruts, nets: false };
      const devs = S.devises(faits, faits.devise_defaut || reglages().devise);
      const devise = devs.includes(q.get("dev")) ? q.get("dev") : devs.includes(reglages().devise) ? reglages().devise : devs[0] || reglages().devise;
      vider(choixDevise);
      if (devs.length > 1) choixDevise.append(h("label", { for: "st-dev" }, tr("Devise")), h("select", { id: "st-dev", onchange: (e) => (location.hash = adresse(section, { ...base, dev: e.target.value, liste: mesure, filtre })) }, devs.map((x) => h("option", { value: x, selected: x === devise }, x))));
      const X = {
        faits, du, au, jour, devise, cmp, gran, nets: !!faits.nets, section, entite: entiteActive().nom,
        c: { du, au, jour, devise }, tri: q.get("tri"), sens: q.get("sens"), q: q.get("q") || "", surEtat, sortie: [],
        peutGroupe: entitesAnalysables().length > 1,
        param: (extra) => adresse(section, { ...base, ...extra, liste: mesure, filtre }),
        href: (id, f, extra = {}) => adresse(section, { ...base, liste: id, filtre: f || null, ...extra }),
        lien: (nom, extra) => lien(nom, { ...extra, dev: q.get("dev") }),
      };
      vider(corps);
      if (mesure) {
        const L = liste(X, mesure, filtre);
        sortie = L.rows.map((l) => [L.titre, l.titre, l.devise, l.montant, 1]);
        nomExport = `liste-${mesure}`;
        const retour = h("a", { class: "retour", href: adresse(section, { ...base }) }, tr("Retour à {section}", { section: tr(def.titre) }));
        corps.append(retour, h("div", { class: "st-liste-tete" }, h("h2", { class: "st-titre" }, L.titre, L.filtre ? h("span", { class: "st-filtre" }, L.filtre) : null), h("p", { class: "st-liste-somme" }, h("strong", null, formatMontant(L.total.montant, devise)), h("span", null, ` · ${L.total.nombre === 1 ? tr("1 ligne") : tr("{n} lignes", { n: L.total.nombre })}`)), S.estFlux(mesure) && !def.futur ? h("p", { class: "aide" }, du === au ? formatDate(du) : tr("du {du} au {au}", { du: formatDate(du), au: formatDate(au) })) : h("p", { class: "aide" }, tr("à ce jour")), h("details", { class: "st-defs" }, h("summary", null, tr("Comment c'est calculé")), h("p", null, tr(S.DEFINITIONS[mesure][1])))), L.noeud);
      } else {
        const aucun = !faits.dossiers.length && !faits.paiements.length && !faits.reservations.length;
        if (aucun && section !== "commissions") {
          corps.append(h("div", { class: "vide" }, h("h2", null, tr("Rien à compter pour l'instant")), h("p", null, tr("Aucun dossier, paiement ni réservation ne tombe dans cette période. Essayez une période plus large.")), h("div", { class: "actions" }, h("a", { class: "bouton secondaire", href: adresse(section, { ...base, p: "annee", du: null, au: null }) }, tr("Voir l'année")), peut("dossiers.ecrire") ? h("a", { class: "bouton principal", href: "#/dossiers/nouveau" }, tr("Nouveau dossier")) : null)));
        } else {
          corps.append(...def.rendre(X).filter(Boolean));
          sortie = X.sortie;
          nomExport = `statistiques-${section}`;
        }
      }
      corps.dataset.ms = String(Math.round(performance.now() - t0));
      const y = DEFILEMENTS.get(location.hash);
      if (y) requestAnimationFrame(() => window.scrollTo(0, y));
      const actif = nav.querySelector("[aria-current]");
      if (actif && actif.scrollIntoView) nav.scrollLeft = Math.max(0, actif.offsetLeft - 16);
    } catch (err) {
      // La base n'a pas encore reçu la migration 20 : message clair plutôt que l'erreur brute.
      const manque = /analyse_faits|schema cache|could not find the function/i.test(err.message || "");
      vider(corps).append(h("p", { class: "erreur-form", role: "alert" }, manque ? tr("Les statistiques demandent une mise à jour de la base de données (migration 20). Demandez à la personne qui administre l'outil de l'appliquer.") : tr("Impossible de calculer les analyses : {message}", { message: err.message })), h("button", { class: "secondaire", type: "button", onclick: () => ((CACHE.clear()), charger()) }, tr("Réessayer")));
    }
  }

  // Deux fois les mêmes boutons : en haut sur ordinateur, en bas sur téléphone où ils ne doivent pas repousser les chiffres.
  const boutons = () => [h("button", { class: "secondaire petit", type: "button", onclick: copierResume }, tr("Copier le résumé du mois")), peut("exports.faire") ? h("button", { class: "secondaire petit", type: "button", onclick: exporter }, tr("Exporter (Excel)")) : null];
  outilsDroite.append(...boutons());
  outilsBas.append(...boutons());
  charger();
  // La barre de sections colle sous la barre du haut du téléphone, dont la hauteur dépend de l'appareil (encoche comprise).
  requestAnimationFrame(() => {
    const barreHaut = document.querySelector(".barre-haut");
    const racine = document.querySelector(".st");
    if (racine) racine.style.setProperty("--st-haut", `${barreHaut ? Math.round(barreHaut.getBoundingClientRect().height) : 0}px`);
  });
  return h("div", { class: `st${mesure ? " st-en-liste" : ""}`, "data-titre": tr("Statistiques"), "data-large": "1" }, h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Statistiques")), h("p", { class: "sous" }, `${entiteActive().nom} · ${tr(def.complet || def.titre)}`)), outilsDroite), nav, barre, periodeTexte, corps, outilsBas);
}
