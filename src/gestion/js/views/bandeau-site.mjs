// « Bandeau du site » : l'information en haut des pages de secrettravelandtour.com (mer agitée, saison, nouveauté, perturbation), allumée
// et éteinte par Anaïs (migration 30). Elle choisit un modèle anglais et le remplit, l'outil écrit le texte, propose la fin automatique
// et montre le rendu dans les deux marques (Secret, VIP Taxi Lanta « Laque et or ») avant publication. Un tap l'éteint.
// Le site lit les bandeaux en ligne par la fonction publique « bandeau-site » (docs/gestion/bandeau-site.md).
import { etat, inserer, modifier, supprimer, peut, modeTaxi } from "../etat.mjs";
import { h, modal, toast, champ, puces, confirmer, icone } from "../ui.mjs";
import { aujourdhui } from "../calc.mjs";
import { tr, N_, localeActive } from "../i18n.mjs";
import { vide } from "./commun.mjs";
import {
  TEXTE_MAX, TYPES_BANDEAU, SECTIONS_SITE, MODELES, modele, modelesDuType, texteBandeau, verifierBandeau, finProposee, ligneBandeau, etatBandeau,
  ETATS_BANDEAU, pagesLien, libelleLien, produitSite, produitsDeMarques, ordreAffichage,
} from "../bandeau-calc.mjs";

const rafraichir = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
const MARQUES = { secret: "Secret Travel & Tour", taxi: "VIP Taxi Lanta" };
const PRIORITES = { 1: N_("Haute"), 2: N_("Normale"), 3: N_("Basse") };
const CHAMPS_LIBELLES = { trip: N_("Sortie"), option: N_("Option"), date: N_("Date"), date2: N_("Nouvelle date"), de: N_("De"), a: N_("À"), texte: N_("Texte en anglais") };
const ERREURS = {
  champ_vide: N_("Remplissez : {champs}."),
  trop_long: N_("Le texte fait {n} caractères : 140 au plus."),
  marque: N_("Choisissez au moins une marque."),
  produits: N_("Choisissez au moins une sortie."),
  sections: N_("Choisissez au moins une section."),
  lien: N_("Choisissez la page du lien."),
  dates: N_("La fin doit venir après le début."),
  date2: N_("La nouvelle date doit venir après la première."),
};

// ---- Rendu, comme sur le site ----------------------------------------------------------------------------------------
// Même structure HTML que celle décrite pour le site (docs/gestion/bandeau-site.md) ; les couleurs de chaque marque sont dans app.css (.site-notice).
const SVG = "http://www.w3.org/2000/svg";
const ICONES = {
  info: ["M12 8h.01", "M11 12h1v5h1", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"],
  sea: ["M2 9c2 0 2-1.5 4-1.5S8 9 10 9s2-1.5 4-1.5S16 9 18 9s2-1.5 4-1.5", "M2 14c2 0 2-1.5 4-1.5S8 14 10 14s2-1.5 4-1.5S16 14 18 14s2-1.5 4-1.5", "M2 19c2 0 2-1.5 4-1.5S8 19 10 19s2-1.5 4-1.5S16 19 18 19s2-1.5 4-1.5"],
  season: ["M7 3v3", "M17 3v3", "M4 8h16", "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"],
  new: ["M12 3l2.4 5.6L20 9.3l-4.3 3.9 1.2 5.8L12 16l-4.9 3 1.2-5.8L4 9.3l5.6-.7z"],
  urgent: ["M12 9v4", "M12 17h.01", "M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"],
};
function svgIcone(type) {
  const s = document.createElementNS(SVG, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "site-notice__icon" })) s.setAttribute(k, v);
  for (const d of ICONES[type] || ICONES.info) {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    s.append(p);
  }
  return s;
}
export function noeudBandeau(b, marque) {
  const lien = b.lien === "page" && b.lien_page ? h("a", { class: "site-notice__link", href: "#", tabindex: "-1", onclick: (e) => e.preventDefault() }, libelleLien(b.lien_page)) : b.lien === "whatsapp" ? h("a", { class: "site-notice__link", href: "#", tabindex: "-1", onclick: (e) => e.preventDefault() }, "Ask on WhatsApp") : null;
  return h(
    "div",
    { class: `site-notice site-notice--${b.type} marque-${marque}`, lang: "en" },
    h("div", { class: "site-notice__inner" }, svgIcone(b.type), h("p", { class: "site-notice__text" }, b.texte || "…", lien ? " " : null, lien), b.fermable !== false ? h("span", { class: "site-notice__close", "aria-hidden": "true" }, "×") : null)
  );
}
// Aperçu dans les marques choisies, chacune dans un cadre de téléphone (375 px) sous un faux en-tête de la marque.
function apercu(b) {
  const marques = b.marques && b.marques.length ? b.marques : ["secret"];
  return h(
    "div",
    { class: "bsite-apercus" },
    marques.map((m) => h("figure", { class: `bsite-apercu marque-${m}` }, h("figcaption", null, MARQUES[m]), h("div", { class: "bsite-ecran" }, h("div", { class: "bsite-entete" }, h("span", null, MARQUES[m])), noeudBandeau(b, m), h("div", { class: "bsite-page", "aria-hidden": "true" }, h("span"), h("span"), h("span")))))
  );
}

// ---- Dates -----------------------------------------------------------------------------------------------------------
// datetime-local dans l'heure du téléphone d'Anaïs (Bangkok) ; la base garde l'instant exact.
const versLocal = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const depuisLocal = (v) => (v ? new Date(v).toISOString() : null);
const quand = (iso) => new Date(iso).toLocaleString(localeActive(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// ---- Fenêtre de saisie -----------------------------------------------------------------------------------------------
function ouvrirSaisie(existant = null) {
  const ajd = aujourdhui();
  const marqueEntreprise = modeTaxi() ? "taxi" : "secret";
  const b = existant
    ? { ...structuredClone(existant), valeurs: { ...(existant.valeurs || {}) } }
    : { type: "sea", modele: "sea-today", valeurs: {}, marques: [marqueEntreprise], cible: "tout", sections: [], produits: [], lien: "aucun", lien_page: null, debut: new Date().toISOString(), fin: finProposee("sea-today", {}, ajd), fermable: true, priorite: 2, actif: true };
  let finManuelle = !!existant;
  const zoneApercu = h("div", { "aria-live": "polite" });
  const compteur = h("p", { class: "aide bsite-compteur" });
  const erreur = h("p", { class: "erreur-form", role: "alert" });
  const blocModeles = h("div", { class: "bsite-modeles", role: "radiogroup", "aria-label": tr("Modèle") });
  const blocChamps = h("div", { class: "bsite-champs" });
  const blocCible = h("div", { class: "bsite-cible-detail" });
  const blocLien = h("div");
  const debut = h("input", { type: "datetime-local", value: versLocal(b.debut), onchange: (e) => ((b.debut = depuisLocal(e.target.value) || new Date().toISOString()), maj()) });
  const fin = h("input", { type: "datetime-local", value: versLocal(b.fin), onchange: (e) => ((finManuelle = true), (b.fin = depuisLocal(e.target.value)), maj()) });
  const sansFin = h("input", { type: "checkbox", checked: !b.fin, onchange: (e) => ((finManuelle = true), (b.fin = e.target.checked ? null : finProposee(b.modele, b.valeurs, ajd) || new Date(Date.now() + 86400000).toISOString()), (fin.value = versLocal(b.fin)), maj()) });

  const texte = () => texteBandeau(b.modele, b.valeurs, ajd).texte;
  function maj() {
    b.type = (modele(b.modele) || {}).type || b.type;
    if (!finManuelle) {
      b.fin = finProposee(b.modele, b.valeurs, ajd);
      fin.value = versLocal(b.fin);
      sansFin.checked = !b.fin;
    }
    fin.disabled = sansFin.checked;
    const t = texte();
    compteur.textContent = tr("{n} caractères sur {max}", { n: t.length, max: TEXTE_MAX });
    compteur.classList.toggle("trop", t.length > TEXTE_MAX);
    zoneApercu.replaceChildren(apercu({ ...b, texte: t }));
  }

  // Modèles du type choisi : le texte anglais, tel qu'il paraîtra (avec les blancs à remplir).
  function dessinerModeles() {
    blocModeles.replaceChildren(
      ...modelesDuType(b.type).map((m) =>
        h(
          "label",
          { class: "bsite-modele" },
          h("input", { type: "radio", name: "bsite-modele", value: m.id, checked: m.id === b.modele, onchange: () => ((b.modele = m.id), dessinerChamps(), maj()) }),
          h("span", { lang: "en" }, m.id === "libre" ? tr("Texte libre, en anglais") : m.texte.replace(/\{trip\}/g, "[trip]").replace(/\{option\}/g, "[option]").replace(/\{date2\}/g, "[new date]").replace(/\{date\}/g, "[date]").replace(/\{de\}/g, "[from]").replace(/\{a\}/g, "[to]"))
        )
      )
    );
  }

  function dessinerChamps() {
    const m = modele(b.modele);
    const produits = produitsDeMarques(b.marques);
    const valeur = (k) => b.valeurs[k] || "";
    const poser = (k, v) => {
      b.valeurs[k] = v || undefined;
      if (k === "trip") {
        delete b.valeurs.option;
        // La sortie choisie devient la page visée et le lien proposé, sauf choix déjà fait à la main.
        if (v && b.cible === "tout" && ["sea", "season"].includes(b.type)) ((b.cible = "produits"), (b.produits = [v]), dessinerCible());
        dessinerChamps();
      }
      maj();
    };
    const controles = m.champs.map((k) => {
      if (k === "trip")
        return champ(tr(CHAMPS_LIBELLES[k]), h("select", { onchange: (e) => poser(k, e.target.value) }, h("option", { value: "" }, tr("Choisir…")), produits.map((p) => h("option", { value: p.id, selected: p.id === valeur(k) }, p.nom))));
      if (k === "option") {
        const p = produitSite(b.valeurs.trip);
        return champ(tr(CHAMPS_LIBELLES[k]), h("select", { disabled: !p, onchange: (e) => poser(k, e.target.value) }, h("option", { value: "" }, tr("Choisir…")), (p ? p.options : []).map((o) => h("option", { value: o.id, selected: o.id === valeur(k) }, o.titre))));
      }
      if (k === "date" || k === "date2") return champ(tr(CHAMPS_LIBELLES[k]), h("input", { type: "date", value: valeur(k), min: ajd, onchange: (e) => poser(k, e.target.value) }));
      if (k === "de" || k === "a") return champ(tr(CHAMPS_LIBELLES[k]), h("input", { type: "time", value: valeur(k), onchange: (e) => poser(k, e.target.value) }));
      return champ(tr(CHAMPS_LIBELLES[k]), h("textarea", { rows: 2, maxlength: String(TEXTE_MAX), lang: "en", oninput: (e) => ((b.valeurs.texte = e.target.value), maj()) }, valeur(k)), tr("Écrit tel quel sur le site."));
    });
    blocChamps.replaceChildren(...controles);
  }

  const choixType = puces({ libelle: tr("Type"), valeur: b.type, options: Object.entries(TYPES_BANDEAU).map(([valeur, t]) => ({ valeur, libelle: tr(t.libelle) })), onchange: (v) => {
    b.type = v;
    if ((modele(b.modele) || {}).type !== v && b.modele !== "libre") b.modele = modelesDuType(v)[0].id;
    finManuelle = finManuelle && !!existant;
    aideType.textContent = tr(TYPES_BANDEAU[v].aide);
    dessinerModeles();
    dessinerChamps();
    maj();
  } });
  const aideType = h("p", { class: "aide" }, tr(TYPES_BANDEAU[b.type].aide));

  const caseMarque = (m) => h("label", { class: "case" }, h("input", { type: "checkbox", checked: b.marques.includes(m), onchange: (e) => {
    b.marques = e.target.checked ? [...new Set([...b.marques, m])] : b.marques.filter((x) => x !== m);
    b.produits = b.produits.filter((id) => (produitSite(id) || {}).marque && b.marques.includes(produitSite(id).marque));
    dessinerChamps();
    dessinerCible();
    dessinerLien();
    maj();
  } }), MARQUES[m]);

  function dessinerCible() {
    if (b.cible === "sections")
      blocCible.replaceChildren(
        h("div", { class: "bsite-cases" }, Object.entries(SECTIONS_SITE).filter(([k]) => (k === "taxi" ? b.marques.includes("taxi") : b.marques.includes("secret"))).map(([k, l]) => h("label", { class: "case" }, h("input", { type: "checkbox", checked: b.sections.includes(k), onchange: (e) => ((b.sections = e.target.checked ? [...b.sections, k] : b.sections.filter((x) => x !== k)), maj()) }), tr(l))))
      );
    else if (b.cible === "produits")
      blocCible.replaceChildren(
        h("div", { class: "bsite-cases defilant" }, produitsDeMarques(b.marques).map((p) => h("label", { class: "case" }, h("input", { type: "checkbox", checked: b.produits.includes(p.id), onchange: (e) => ((b.produits = e.target.checked ? [...b.produits, p.id] : b.produits.filter((x) => x !== p.id)), maj()) }), p.nom)))
      );
    else blocCible.replaceChildren();
    choixCible.definir(b.cible);
  }
  const choixCible = puces({ libelle: tr("Pages"), valeur: b.cible, options: [{ valeur: "tout", libelle: tr("Tout le site") }, { valeur: "sections", libelle: tr("Une section") }, { valeur: "produits", libelle: tr("Des sorties choisies") }], onchange: (v) => ((b.cible = v), dessinerCible(), maj()) });

  function dessinerLien() {
    const pages = pagesLien(b.marques);
    if (b.lien === "page" && !pages.some((p) => p.href === b.lien_page)) b.lien_page = (b.valeurs.trip && (produitSite(b.valeurs.trip) || {}).url) || (pages[0] || {}).href || null;
    blocLien.replaceChildren(
      ...[
      b.lien === "page" ? champ(tr("Page du site"), h("select", { onchange: (e) => ((b.lien_page = e.target.value), maj()) }, pages.map((p) => h("option", { value: p.href, selected: p.href === b.lien_page }, p.section ? tr(p.nom) : p.nom))), tr("Le lien s'appellera « {libelle} ».", { libelle: libelleLien(b.lien_page) })) : null,
      b.lien === "whatsapp" ? h("p", { class: "aide" }, tr("Le lien « Ask on WhatsApp » ouvre la conversation avec Anaïs.")) : null,
      ].filter(Boolean)
    );
    choixLien.definir(b.lien);
  }
  const choixLien = puces({ libelle: tr("Lien"), valeur: b.lien, options: [{ valeur: "aucun", libelle: tr("Aucun") }, { valeur: "page", libelle: tr("Une page du site") }, { valeur: "whatsapp", libelle: "Ask on WhatsApp" }], onchange: (v) => ((b.lien = v), dessinerLien(), maj()) });
  const choixPriorite = puces({ libelle: tr("Priorité"), valeur: String(b.priorite), options: Object.entries(PRIORITES).map(([valeur, l]) => ({ valeur, libelle: tr(l) })), onchange: (v) => ((b.priorite = Number(v)), maj()) });
  const fermable = h("label", { class: "case" }, h("input", { type: "checkbox", checked: b.fermable !== false, onchange: (e) => ((b.fermable = e.target.checked), maj()) }), tr("Le visiteur peut le fermer"));

  let fermer;
  const enregistrer = async (btn) => {
    const erreurs = verifierBandeau(b, ajd);
    if (erreurs.length) {
      const e = erreurs[0];
      erreur.textContent = tr(ERREURS[e.code], { champs: (e.champs || []).map((c) => tr(CHAMPS_LIBELLES[c] || c).toLowerCase()).join(", "), n: e.longueur });
      return;
    }
    erreur.textContent = "";
    btn.disabled = true;
    try {
      const ligne = ligneBandeau(b, ajd);
      if (existant) await modifier("bandeaux_site", existant.id, ligne);
      else await inserer("bandeaux_site", ligne);
      fermer();
      toast(etatBandeau(ligne) === "en_ligne" ? tr("Bandeau en ligne : le site l'affiche dans la minute.") : tr("Bandeau enregistré."));
      rafraichir();
    } catch (err) {
      erreur.textContent = err.message;
      btn.disabled = false;
    }
  };

  const corps = h(
    "div",
    { class: "modal-corps bsite-saisie" },
    h("fieldset", { class: "dsite-groupe" }, h("legend", null, tr("Type d'information")), choixType.noeud, aideType),
    h("fieldset", { class: "dsite-groupe" }, h("legend", null, tr("Texte (anglais, prêt à l'emploi)")), blocModeles, blocChamps, compteur),
    h("fieldset", { class: "dsite-groupe" }, h("legend", null, tr("Où")), h("div", { class: "bsite-cases" }, caseMarque("secret"), caseMarque("taxi")), choixCible.noeud, blocCible),
    h("fieldset", { class: "dsite-groupe" }, h("legend", null, tr("Lien")), choixLien.noeud, blocLien),
    h("fieldset", { class: "dsite-groupe" }, h("legend", null, tr("Quand")), h("div", { class: "grille-form compacte" }, champ(tr("Début"), debut), champ(tr("Fin"), fin)), h("label", { class: "case" }, sansFin, tr("Sans fin (à éteindre à la main)")), h("p", { class: "aide" }, tr("La fin est proposée d'après le modèle : le bandeau disparaît seul du site."))),
    h("fieldset", { class: "dsite-groupe" }, h("legend", null, tr("Affichage")), fermable, h("p", { class: "aide" }, tr("Un seul bandeau par page : la priorité départage, puis le type (perturbation d'abord).")), choixPriorite.noeud),
    h("section", { class: "bsite-apercu-bloc" }, h("h3", null, tr("Aperçu sur le site")), zoneApercu),
    erreur,
    h("div", { class: "barre-modal" }, h("button", { class: "principal", type: "button", onclick: (e) => enregistrer(e.currentTarget) }, existant ? tr("Enregistrer") : tr("Publier sur le site")))
  );
  dessinerModeles();
  dessinerChamps();
  dessinerCible();
  dessinerLien();
  maj();
  fermer = modal(existant ? tr("Modifier le bandeau") : tr("Nouveau bandeau"), corps, { large: true, protege: false });
}

// ---- Liste ----------------------------------------------------------------------------------------------------------------
function carte(b, ecrit) {
  const etatB = etatBandeau(b);
  const cibles = b.cible === "tout" ? tr("Tout le site") : b.cible === "sections" ? b.sections.map((s) => tr(SECTIONS_SITE[s] || s)).join(", ") : b.produits.map((id) => (produitSite(id) || { nom: id }).nom).join(", ");
  const periode = [tr("Depuis {date}", { date: quand(b.debut) }), b.fin ? tr("jusqu'au {date}", { date: quand(b.fin) }) : tr("sans fin")].join(" ");
  return h(
    "li",
    { class: `bsite-carte e-${etatB}` },
    apercu(b),
    h("p", { class: "bsite-meta" }, h("span", { class: `tag bsite-etat e-${etatB}` }, tr(ETATS_BANDEAU[etatB])), " ", [b.marques.map((m) => MARQUES[m]).join(" + "), cibles].join(" · ")),
    h("p", { class: "bsite-meta" }, periode),
    ecrit
      ? h(
          "div",
          { class: "dsite-actions" },
          b.actif !== false && etatB !== "termine"
            ? h("button", { class: "principal", type: "button", onclick: async () => (await modifier("bandeaux_site", b.id, { actif: false }), toast(tr("Bandeau éteint.")), rafraichir()) }, tr("Éteindre"))
            : null,
          b.actif === false ? h("button", { class: "secondaire", type: "button", onclick: async () => (await modifier("bandeaux_site", b.id, { actif: true }), rafraichir()) }, tr("Rallumer")) : null,
          h("button", { class: "secondaire", type: "button", onclick: () => ouvrirSaisie(b) }, tr("Modifier")),
          h("button", { class: "lien", type: "button", onclick: async () => {
            if (!(await confirmer(tr("Supprimer ce bandeau ? Il disparaît du site et de cette liste."), tr("Supprimer"), true))) return;
            await supprimer("bandeaux_site", b.id);
            rafraichir();
          } }, tr("Supprimer"))
        )
      : null
  );
}

export async function vueBandeauSite() {
  // Même droit que la base (publie_sur_le_site, migration 40) : « Modifier les réglages » en plus des dossiers.
  const ecrit = peut("dossiers.ecrire") && peut("reglages.ecrire");
  const tous = [...(etat.db.bandeaux_site || [])];
  const actifs = tous.filter((b) => ["en_ligne", "programme"].includes(etatBandeau(b))).sort(ordreAffichage);
  const anciens = tous.filter((b) => !actifs.includes(b)).sort((a, b) => String(b.debut).localeCompare(String(a.debut))).slice(0, 20);
  const enLigne = (m) => actifs.filter((b) => etatBandeau(b) === "en_ligne" && b.marques.includes(m)).length;
  const concurrents = ["secret", "taxi"].filter((m) => enLigne(m) > 1);
  return h(
    "div",
    { "data-titre": tr("Bandeau du site"), class: "bsite" },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Bandeau du site")), h("p", { class: "sous" }, tr("Une information en haut des pages de secrettravelandtour.com. Le site la montre dans la minute, un tap l'éteint."))), ecrit ? h("div", { class: "entete-actions" }, h("button", { class: "principal", type: "button", onclick: () => ouvrirSaisie() }, icone("ajouter", 18), tr("Nouveau bandeau"))) : null),
    etat.brut.site_disponible === false ? h("p", { class: "bandeau-info", role: "status" }, tr("La base n'a pas encore le bandeau du site (migration 30 à appliquer).")) : null,
    concurrents.length ? h("p", { class: "bandeau-info", role: "status" }, tr("Plusieurs bandeaux en ligne pour {marques} : une page n'en montre qu'un, le premier de la liste qui la vise.", { marques: concurrents.map((m) => MARQUES[m]).join(", ") })) : null,
    h("section", null, h("h2", null, tr("En ligne et programmés"), h("span", { class: "tag" }, actifs.length)), actifs.length ? h("ul", { class: "bsite-liste" }, actifs.map((b) => carte(b, ecrit))) : vide(tr("Aucun bandeau sur le site"), tr("Mer agitée, sortie fermée pour la saison, nouveauté : choisissez un modèle, l'outil écrit le texte anglais."))),
    anciens.length ? h("details", { class: "bsite-anciens" }, h("summary", null, tr("Terminés et éteints ({n})", { n: anciens.length })), h("ul", { class: "bsite-liste" }, anciens.map((b) => carte(b, ecrit)))) : null
  );
}

