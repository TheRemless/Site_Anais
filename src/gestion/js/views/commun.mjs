import { h, vider, ajouter, modal, icone, saisie, puces as fabriquePuces } from "../ui.mjs";
import { trier, tranche, compterFiltres } from "../mobile-calc.mjs";
import { tr, pluriel, N_ } from "../i18n.mjs";
import { libelleStatut, sommePaiements, nomFichier } from "../calc.mjs";
import { etat, imprimer, nomPartenaire } from "../etat.mjs";
import { renderDocument } from "../document.mjs";

// Le statut est toujours écrit en toutes lettres, le point de couleur ne fait que l'accompagner.
export function pastille(code) {
  return h("span", { class: `statut s-${code}` }, h("span", { class: "point", "aria-hidden": "true" }), libelleStatut(code));
}

export function vide(titre, texte, action) {
  return h("div", { class: "vide" }, h("h2", null, titre), h("p", null, texte), action || null);
}

// « HM20261028 Thaïlande · novembre 2026 » : la référence puis l'intitulé, sans répéter le pays que la référence porte déjà.
export function sousTitreDossier(d) {
  const intitule = voyageTexte(d.bandeau, d.pays);
  const pays = (d.pays || "").trim();
  const complement = pays && intitule.toLowerCase().startsWith(pays.toLowerCase()) ? intitule.slice(pays.length).replace(/^\s*-\s*/, "") : intitule;
  return [d.ref, complement].filter(Boolean).join(" · ");
}

// Liste en cartes pour le téléphone, à côté d'un tableau réservé au grand écran (classe `seulement-bureau`).
// `carte` renvoie le contenu d'une carte : au besoin une case à cocher, puis un lien `.carte-lien`.
export function cartes(items, carte) {
  return h("ul", { class: "cartes seulement-mobile" }, items.map((x) => h("li", { class: "carte" }, carte(x))));
}

// Liste adaptative : une seule description des colonnes, rendue en tableau sur ordinateur (dès 720 px) et en cartes empilées sur
// téléphone. Tri (en-têtes cliquables ou menu « Trier par »), affichage progressif au-delà de `pas` lignes (50 par défaut).
//   listeAdaptative({
//     items,                       // les lignes
//     colonnes: [{ cle, titre, rendu: (x) => Node|texte, tri: (x) => valeur, num: true, mobile: "titre"|"droite"|"sous"|"pied"|false }],
//     lien: (x) => "#/dossier/…",  // la carte entière et le texte de la première colonne mènent à cette adresse
//     actions: (x) => Node,        // boutons de fin de ligne (pied de carte sur téléphone)
//     tri: { cle, decroissant },   // tri de départ
//     vide: Node,                  // affiché sans ligne
//     pas: 50,
//   })  →  { noeud, mettre(items) }
// Rôle mobile : « titre » (une colonne, la première par défaut), « droite » (montant ou date), « sous » (détails sur une ligne,
// séparés par · ), « pied » (statuts, étiquettes), `false` (colonne réservée au tableau).
export function listeAdaptative({ items, colonnes, lien = null, actions = null, tri = null, vide = null, pas = 50 }) {
  let lignes = items;
  let pages = 1;
  let ordre = tri ? { cle: tri.cle, decroissant: !!tri.decroissant } : { cle: null, decroissant: false };
  const triables = colonnes.filter((c) => c.tri);
  const racine = h("div", { class: "liste-adaptative" });
  const contenu = (c, x) => {
    const v = c.rendu ? c.rendu(x) : x[c.cle];
    return v === null || v === undefined || v === "" ? null : v;
  };
  const roleMobile = (c, i) => (c.mobile !== undefined ? c.mobile : i === 0 ? "titre" : "sous");
  const carte = (x) => {
    const parRole = (r) => colonnes.filter((c, i) => roleMobile(c, i) === r).map((c) => contenu(c, x)).filter((v) => v !== null);
    const titre = parRole("titre");
    const droite = parRole("droite");
    const sous = parRole("sous");
    const pied = parRole("pied");
    const act = actions ? actions(x) : null;
    const corps = [
      h("span", { class: "carte-titre" }, titre),
      droite.length ? h("span", { class: "carte-droite" }, droite.map((v) => (v instanceof Node ? v : h("strong", null, v)))) : null,
      sous.length ? h("span", { class: "carte-sous" }, sous.flatMap((v, i) => (i ? [" · ", v] : [v]))) : null,
      pied.length ? h("span", { class: "carte-pied" }, pied) : null,
    ];
    const href = lien ? lien(x) : null;
    return h("li", { class: "carte" }, href ? h("a", { class: "carte-lien", href }, corps) : h("div", { class: "carte-lien statique" }, corps), act ? h("div", { class: "carte-actions-fin" }, act) : null);
  };
  const dessiner = () => {
    const tries = trier(lignes, ordre.cle ? triables.find((c) => c.cle === ordre.cle)?.tri : null, ordre.decroissant);
    const { visibles, reste, total } = tranche(tries, pas, pages);
    vider(racine);
    if (!total) return void racine.append(vide || h("p", { class: "vide-court" }, tr("Rien à afficher.")));
    if (triables.length) {
      racine.append(
        h(
          "div",
          { class: "tri-mobile seulement-mobile" },
          h("label", { for: "tri-liste" }, tr("Trier par")),
          h(
            "select",
            { id: "tri-liste", onchange: (e) => ((ordre = { cle: e.target.value.split(":")[0], decroissant: e.target.value.endsWith(":desc") }), (pages = 1), dessiner(), document.getElementById("tri-liste")?.focus()) },
            h("option", { value: ":asc", selected: !ordre.cle }, tr("Ordre d'origine")),
            triables.flatMap((c) => [
              h("option", { value: `${c.cle}:asc`, selected: ordre.cle === c.cle && !ordre.decroissant }, tr("{colonne}, croissant", { colonne: c.titre })),
              h("option", { value: `${c.cle}:desc`, selected: ordre.cle === c.cle && ordre.decroissant }, tr("{colonne}, décroissant", { colonne: c.titre })),
            ])
          )
        )
      );
    }
    racine.append(
      h("ul", { class: "cartes seulement-mobile" }, visibles.map(carte)),
      h(
        "table",
        { class: "tableau seulement-bureau" },
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            colonnes.map((c) =>
              h(
                "th",
                { scope: "col", class: c.num ? "num" : null, "aria-sort": ordre.cle === c.cle ? (ordre.decroissant ? "descending" : "ascending") : c.tri ? "none" : null },
                c.tri
                  ? h("button", { type: "button", class: "tri-entete", onclick: () => ((ordre = { cle: c.cle, decroissant: ordre.cle === c.cle && !ordre.decroissant }), (pages = 1), dessiner()) }, c.titre, h("span", { class: "tri-sens", "aria-hidden": "true" }, ordre.cle === c.cle ? (ordre.decroissant ? "↓" : "↑") : ""))
                  : c.titre
              )
            ),
            actions ? h("th", { scope: "col" }, h("span", { class: "visuellement-cache" }, tr("Actions"))) : null
          )
        ),
        h(
          "tbody",
          null,
          visibles.map((x) =>
            h(
              "tr",
              null,
              colonnes.map((c, i) => {
                const v = contenu(c, x);
                const href = lien && i === 0 && v !== null && !(v instanceof Node && v.querySelector && v.querySelector("a")) ? lien(x) : null;
                return h("td", { class: c.num ? "num" : null, "data-label": c.titre }, href ? h("a", { href }, v) : v);
              }),
              actions ? h("td", { class: "action-cellule" }, actions(x)) : null
            )
          )
        )
      )
    );
    if (reste > 0) {
      racine.append(
        h(
          "div",
          { class: "liste-suite" },
          h("p", { class: "aide", role: "status" }, tr("{n} affichés sur {total}", { n: visibles.length, total })),
          h("button", { type: "button", class: "secondaire", onclick: () => (pages++, dessiner()) }, tr("Afficher {n} de plus", { n: Math.min(pas, reste) }))
        )
      );
    }
  };
  dessiner();
  return {
    noeud: racine,
    mettre(nouveaux) {
      lignes = nouveaux;
      pages = 1;
      dessiner();
    },
  };
}

// Barre de recherche et de filtres d'une liste : recherche collante en haut, puces pour le filtre principal, bouton « Filtrer »
// qui ouvre une feuille pour les autres filtres sur téléphone ; sur ordinateur tous les champs restent à plat.
//   barreFiltres({
//     recherche: { valeur, placeholder, libelle },            // facultatif
//     puces: { options: [{ valeur, libelle, nombre }], valeur, libelle },   // facultatif
//     filtres: [{ cle, libelle, type: "select"|"date"|"texte", options: [{ valeur, libelle }], valeur, neutre: "" }],
//     onchange: (valeurs) => …   // valeurs : { recherche, puces, [cle]: valeur }, appelée à chaque changement
//   })  →  { noeud, valeurs(), definir(partiel) }
export function barreFiltres({ recherche = null, puces = null, filtres = [], onchange }) {
  const v = { recherche: recherche ? recherche.valeur || "" : "", puces: puces ? puces.valeur : null };
  for (const f of filtres) v[f.cle] = f.valeur ?? f.neutre ?? "";
  const prevenir = () => onchange && onchange({ ...v });
  const champRecherche = recherche ? h("div", { class: "champ recherche" }, h("label", { for: "filtre-recherche", class: "visuellement-cache" }, recherche.libelle || tr("Rechercher")), saisie(h("input", { id: "filtre-recherche", type: "search", placeholder: recherche.placeholder || tr("Rechercher"), value: v.recherche, oninput: (e) => ((v.recherche = e.target.value), prevenir()) }), "recherche")) : null;
  const rangeePuces = puces ? fabriquePuces({ options: puces.options, valeur: puces.valeur, libelle: puces.libelle, onchange: (x) => ((v.puces = x), prevenir()) }) : null;
  const controle = (f, id) => {
    const maj = (e) => {
      v[f.cle] = e.target.value;
      miseAJourBouton();
      prevenir();
    };
    if (f.type === "select") return h("select", { id, onchange: maj, value: v[f.cle] }, f.options.map((o) => h("option", { value: o.valeur }, o.libelle)));
    if (f.type === "date") return h("input", { id, type: "date", value: v[f.cle], onchange: maj });
    return saisie(h("input", { id, type: "text", value: v[f.cle], oninput: maj }), "texte");
  };
  const enLigne = filtres.length ? h("div", { class: "filtres-ligne seulement-bureau" }, filtres.map((f, i) => h("div", { class: "champ" }, h("label", { for: `filtre-b-${i}` }, f.libelle), controle(f, `filtre-b-${i}`)))) : null;
  const bouton = filtres.length ? h("button", { type: "button", class: "secondaire bouton-filtrer seulement-mobile", onclick: ouvrirFeuille, "aria-haspopup": "dialog" }) : null;
  function miseAJourBouton() {
    if (!bouton) return;
    const n = compterFiltres(filtres, v);
    ajouter(vider(bouton), [icone("filtrer", 18), h("span", null, tr("Filtrer")), n ? h("span", { class: "puce-nombre", "aria-label": pluriel(n, N_("filtre actif"), N_("filtres actifs")) }, n) : null]);
  }
  function ouvrirFeuille() {
    let ferme;
    const champs = filtres.map((f, i) => h("div", { class: "champ" }, h("label", { for: `filtre-f-${i}` }, f.libelle), controle(f, `filtre-f-${i}`)));
    ferme = modal(
      tr("Filtrer"),
      h(
        "div",
        { class: "modal-corps feuille-filtres" },
        champs,
        h(
          "div",
          { class: "actions" },
          h("button", { type: "button", class: "secondaire", onclick: () => (definir(Object.fromEntries(filtres.map((f) => [f.cle, f.neutre ?? ""]))), ferme()) }, tr("Réinitialiser")),
          h("button", { type: "button", class: "principal", "data-autofocus": "", onclick: () => ferme() }, tr("Appliquer"))
        )
      ),
      { protege: false }
    );
  }
  function definir(partiel) {
    Object.assign(v, partiel);
    if (champRecherche && "recherche" in partiel) champRecherche.querySelector("input").value = v.recherche;
    if (rangeePuces && "puces" in partiel) rangeePuces.definir(v.puces);
    if (enLigne) filtres.forEach((f, i) => { const c = enLigne.querySelector(`#filtre-b-${i}`); if (c) c.value = v[f.cle]; });
    miseAJourBouton();
    prevenir();
  }
  miseAJourBouton();
  const noeud = h("div", { class: "barre-filtres" }, h("div", { class: "barre-filtres-haut" }, champRecherche, bouton), rangeePuces ? rangeePuces.noeud : null, enLigne);
  return { noeud, valeurs: () => ({ ...v }), definir };
}

export function telecharger(nom, contenu, type) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = h("a", { href: url, download: nom });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Montant reçu affiché sur une facture : valeur figée si le document est envoyé, sinon somme des paiements.
export function montantRecu(doc, paiements) {
  if (doc.type !== "facture") return 0;
  return doc.contenu.montant_recu != null ? Number(doc.contenu.montant_recu) : sommePaiements(paiements);
}

export function feuille(doc) {
  const dossier = etat.db.dossiers.find((d) => d.id === doc.dossier_id);
  const client = etat.db.clients.find((c) => c.id === dossier.client_id);
  const paiements = etat.db.paiements.filter((p) => p.dossier_id === dossier.id);
  return { noeud: renderDocument({ type: doc.type, doc, dossier, client, reglages: etat.db.reglages, recu: montantRecu(doc, paiements), nomPartenaire }), dossier, client };
}

export function pdf(doc) {
  const { noeud, dossier, client } = feuille(doc);
  imprimer(noeud, nomFichier(doc.type, doc, dossier, client));
}

// « VOYAGE EN THAÏLANDE - DÉCEMBRE 2026 » devient « Thaïlande - décembre 2026 ».
export function voyageTexte(bandeau, pays) {
  if (!bandeau) return pays || "";
  // Un titre tout en capitales (« VOYAGE EN THAÏLANDE - DÉCEMBRE 2026 ») est remis en minuscules ; un titre déjà
  // écrit normalement (liste de services en mode excursions) reste tel quel.
  const sans = bandeau.replace(/^VOYAGE (EN|AU)\s+/i, "");
  const t = sans === sans.toUpperCase() ? sans.toLowerCase() : sans;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Aperçu A4 réduit à la largeur disponible. `fabrique` renvoie une feuille neuve à chaque appel.
export function apercuA4(fabrique) {
  const echelle = h("div", { class: "apercu-echelle" });
  const cadre = h("div", { class: "apercu-cadre" }, echelle);
  const zone = h("div", { class: "apercu" }, cadre);
  const ajuster = () => {
    const largeur = zone.clientWidth;
    if (!largeur || !echelle.firstChild) return;
    const s = Math.min(1, (largeur - 2) / 794);
    echelle.style.transform = `scale(${s})`;
    cadre.style.height = `${echelle.firstChild.offsetHeight * s}px`;
    cadre.style.width = `${794 * s}px`;
  };
  const redessiner = () => {
    vider(echelle).append(fabrique());
    ajuster();
  };
  new ResizeObserver(() => requestAnimationFrame(ajuster)).observe(zone);
  redessiner();
  return { zone, redessiner };
}
