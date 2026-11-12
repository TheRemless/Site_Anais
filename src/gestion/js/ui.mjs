
// Petits outils d'interface partagés par les écrans.
import { tr } from "./i18n.mjs";
import { confirmation } from "./confirmation.mjs";
import { hauteurClavier, aChange, lireBrouillon, ecrireBrouillon, SAISIES } from "./mobile-calc.mjs";

export function h(tag, attrs, ...enfants) {
  const el = document.createElement(tag);
  let valeur;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value") valeur = v;
    else if (k === "checked" || k === "disabled" || k === "selected") el[k] = true;
    else el.setAttribute(k, v === true ? "" : v);
  }
  ajouter(el, enfants);
  // La valeur d'un select se pose après ses options.
  if (valeur !== undefined) el.value = valeur;
  return el;
}

export function ajouter(parent, enfants) {
  for (const e of enfants.flat(Infinity)) {
    if (e === null || e === undefined || e === false) continue;
    parent.append(e instanceof Node ? e : document.createTextNode(String(e)));
  }
}

export function vider(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

// Champ de formulaire avec libellé visible.
export function champ(libelle, controle, aide) {
  const id = controle.id || `c${Math.random().toString(36).slice(2, 8)}`;
  controle.id = id;
  return h("div", { class: "champ" }, h("label", { for: id }, libelle), controle, aide ? h("p", { class: "aide" }, aide) : null);
}

export function toast(message, erreur = false) {
  let zone = document.getElementById("toasts");
  if (!zone) {
    zone = h("div", { id: "toasts", "aria-live": "polite" });
    document.body.append(zone);
  }
  const t = h("div", { class: erreur ? "toast erreur" : "toast", role: erreur ? "alert" : "status" }, message);
  zone.append(t);
  setTimeout(() => t.remove(), erreur ? 6000 : 3000);
}

// ---- Clavier et viewport visuel ----------------------------------------------------------------------------------
// Sur iPhone le clavier ne redimensionne pas la page : il recouvre le bas. On mesure ce qu'il prend (--clavier) et la
// hauteur réellement visible (--vv) pour que les feuilles et les barres d'action restent au-dessus de lui.
function suivreClavier() {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return;
  const racine = document.documentElement;
  const maj = () => {
    const clavier = hauteurClavier(window.innerHeight, vv);
    racine.style.setProperty("--clavier", `${clavier}px`);
    racine.style.setProperty("--vv", `${Math.round(vv.height)}px`);
    racine.classList.toggle("clavier", clavier > 0);
  };
  vv.addEventListener("resize", maj);
  vv.addEventListener("scroll", maj);
  maj();
}
suivreClavier();

// ---- Fenêtres ---------------------------------------------------------------------------------------------------
// Fenêtre modale. Renvoie une fonction de fermeture, qui ferme toujours tout de suite (après un enregistrement par exemple).
// Fermer par la croix, Échap, le fond ou un glissement vers le bas demande confirmation quand la saisie a été modifiée.
// Sur téléphone la fenêtre est une feuille ancrée en bas : poignée, croix de 44 px, un seul défilement, zone sûre.
// Options : `large` (fenêtre plus large sur ordinateur), `feuille` (conservé : toutes les fenêtres sont des feuilles sous 720 px),
// `protege: false` pour fermer sans confirmation, `brouillon: "clé"` pour garder la saisie d'une fenêtre fermée par erreur
// (rendue à la réouverture dans la même session), `ferme` appelée une fois la fenêtre fermée.
let ouvertes = 0;
const clesBrouillon = (cle) => `gestion-brouillon:${cle}`;
// À la déconnexion : un brouillon peut porter des montants confidentiels, il ne reste pas pour la personne suivante sur cet appareil.
export function purgerBrouillons() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith("gestion-brouillon:")) sessionStorage.removeItem(k);
  } catch {}
}
const valeurDe = (c) => (c.type === "checkbox" || c.type === "radio" ? (c.checked ? "1" : "0") : c.value);
const CHAMPS = "input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=file]):not([type=search]), textarea, select";
export function modal(titre, contenu, { large = false, feuille = false, protege = true, brouillon = null, ferme: apres = null } = {}) {
  const precedent = document.activeElement;
  let close = false;
  let touche = false;
  let confirmation = false;
  const champs = () => [...corps.querySelectorAll(CHAMPS)];
  let depart = [];
  const fermer = (garder = false) => {
    if (close) return;
    close = true;
    if (brouillon && !garder) effacer();
    fond.remove();
    document.removeEventListener("keydown", surTouche);
    ouvertes = Math.max(0, ouvertes - 1);
    if (!ouvertes) document.documentElement.classList.remove("modal-ouverte");
    if (precedent && precedent.focus && document.contains(precedent)) precedent.focus();
    if (apres) apres();
  };
  const modifie = () => protege && touche && aChange(depart, champs().map(valeurDe));
  const effacer = () => {
    try {
      sessionStorage.removeItem(clesBrouillon(brouillon));
    } catch {
      // stockage refusé : pas de brouillon, rien d'autre à faire
    }
  };
  const garderBrouillon = () => {
    if (!brouillon) return;
    try {
      sessionStorage.setItem(clesBrouillon(brouillon), ecrireBrouillon(champs().map(valeurDe)));
    } catch {
      // idem
    }
  };
  // Fermeture voulue par la personne : on vérifie qu'il n'y a pas de saisie à perdre.
  const demanderFermeture = async () => {
    if (close || confirmation) return;
    if (!modifie()) return fermer();
    confirmation = true;
    const ok = await confirmer(tr("Vous avez commencé à remplir cette fenêtre. Fermer sans enregistrer ?"), tr("Fermer sans enregistrer"), true, tr("Continuer la saisie"));
    confirmation = false;
    if (!ok) return;
    garderBrouillon();
    fermer(true);
  };
  const surTouche = (e) => {
    if (e.key !== "Escape") return;
    const fonds = document.querySelectorAll(".modal-fond");
    if (fonds[fonds.length - 1] !== fond) return;
    e.preventDefault();
    demanderFermeture();
  };
  // Glissement de la poignée vers le bas : la feuille suit le doigt, elle se ferme au-delà de 90 px.
  const poignee = h("div", { class: "modal-poignee", "aria-hidden": "true" }, h("span"));
  let y0 = null;
  let dy = 0;
  poignee.addEventListener("pointerdown", (e) => {
    y0 = e.clientY;
    dy = 0;
    poignee.setPointerCapture(e.pointerId);
    boite.style.transition = "none";
    boite.style.animation = "none";
  });
  poignee.addEventListener("pointermove", (e) => {
    if (y0 === null) return;
    dy = Math.max(0, e.clientY - y0);
    boite.style.transform = `translateY(${dy}px)`;
  });
  const lacher = () => {
    if (y0 === null) return;
    y0 = null;
    boite.style.transition = "";
    boite.style.transform = "";
    if (dy > 90) demanderFermeture();
  };
  poignee.addEventListener("pointerup", lacher);
  poignee.addEventListener("pointercancel", lacher);
  const corps = h("div", { class: "modal-defile" }, contenu);
  const boite = h(
    "div",
    { class: ["modal", large && "large", feuille && "feuille"].filter(Boolean).join(" "), role: "dialog", "aria-modal": "true", "aria-label": titre },
    poignee,
    h("div", { class: "modal-tete" }, h("h2", null, titre), h("button", { class: "bouton-icone lien", type: "button", onclick: demanderFermeture, "aria-label": tr("Fermer"), title: tr("Fermer") }, icone("fermer", 20))),
    corps
  );
  const fond = h("div", { class: "modal-fond", onmousedown: (e) => e.target === fond && demanderFermeture() }, boite);
  document.body.append(fond);
  document.documentElement.classList.add("modal-ouverte");
  ouvertes++;
  document.addEventListener("keydown", surTouche);
  // Ce que la personne a modifié elle-même : un champ rempli par le code à l'ouverture n'est pas une saisie à protéger.
  depart = champs().map(valeurDe);
  const marquer = (e) => {
    if (e.isTrusted && e.target.matches && e.target.matches(CHAMPS)) touche = true;
  };
  boite.addEventListener("input", marquer);
  boite.addEventListener("change", marquer);
  if (brouillon) {
    let brut = null;
    try {
      brut = sessionStorage.getItem(clesBrouillon(brouillon));
    } catch {
      // pas de brouillon
    }
    const valeurs = brut ? lireBrouillon(brut, depart.length) : null;
    if (valeurs) {
      champs().forEach((c, i) => {
        if (c.type === "checkbox" || c.type === "radio") c.checked = valeurs[i] === "1";
        else c.value = valeurs[i];
      });
      touche = true;
      const note = h(
        "p",
        { class: "brouillon-note", role: "status" },
        tr("Votre saisie précédente a été reprise."),
        h("button", { class: "lien", type: "button", onclick: () => (champs().forEach((c, i) => (c.type === "checkbox" || c.type === "radio" ? (c.checked = depart[i] === "1") : (c.value = depart[i]))), effacer(), (touche = false), note.remove()) }, tr("Repartir de zéro"))
      );
      corps.prepend(note);
    }
  }
  // Au doigt, ouvrir le clavier tout de suite cacherait la feuille : on ne met le focus que sur un bouton, sauf champ marqué data-autofocus.
  const tactile = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const premier = tactile ? boite.querySelector("[data-autofocus], button.principal") : boite.querySelector("[data-autofocus], input:not([type=hidden]), select, textarea, button.principal");
  if (premier) premier.focus();
  else (boite.setAttribute("tabindex", "-1"), boite.focus({ preventScroll: true }));
  return fermer;
}

// `annuler` : texte du bouton qui garde la fenêtre ouverte (« Annuler » par défaut).
export function confirmer(message, libelle = tr("Confirmer"), danger = false, annuler = tr("Annuler")) {
  return confirmation(({ fin, annuler: non }) =>
    modal(
      tr("Confirmation"),
      h(
        "div",
        { class: "modal-corps" },
        h("p", null, message),
        h(
          "div",
          { class: "actions" },
          h("button", { type: "button", class: "secondaire", onclick: () => fin(false) }, annuler),
          h("button", { type: "button", class: danger ? "danger" : "principal", onclick: () => fin(true) }, libelle)
        )
      ),
      { protege: false, ferme: non }
    )
  );
}

// ---- Champs adaptés au téléphone ----------------------------------------------------------------------------------
// Pose le bon clavier et la bonne saisie automatique : saisie(h("input", …), "tel" | "email" | "montant" | "entier" | "date" | "recherche" | "nom" | "adresse").
// Le texte fait au moins 16 px (règle globale), sinon iOS zoomerait au focus.
export function saisie(controle, sens = "texte") {
  const r = SAISIES[sens] || SAISIES.texte;
  for (const [k, v] of Object.entries(r)) if (!controle.hasAttribute(k)) controle.setAttribute(k, v);
  return controle;
}

// Erreur sous un champ : message lié au champ (aria-describedby), champ marqué invalide, annoncée aux lecteurs d'écran.
// `erreurChamp(champEl, null)` efface. Renvoie le champ, pour enchaîner.
export function erreurChamp(controle, message) {
  const id = `${controle.id || (controle.id = `c${Math.random().toString(36).slice(2, 8)}`)}-erreur`;
  const ancien = document.getElementById(id);
  if (ancien) ancien.remove();
  if (!message) {
    controle.removeAttribute("aria-invalid");
    controle.removeAttribute("aria-describedby");
    return controle;
  }
  controle.setAttribute("aria-invalid", "true");
  controle.setAttribute("aria-describedby", id);
  const p = h("p", { id, class: "erreur-champ", role: "alert" }, message);
  const zone = controle.closest(".champ") || controle.parentElement;
  zone.append(p);
  return controle;
}

// Met le focus sur le premier champ invalide d'un formulaire et le fait défiler à l'écran. Renvoie ce champ (ou null).
export function focusPremiereErreur(racine) {
  const c = racine.querySelector('[aria-invalid="true"]');
  if (!c) return null;
  c.focus({ preventScroll: true });
  c.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  return c;
}

// ---- Barre d'action collante ------------------------------------------------------------------------------------
// Enregistrer, Annuler : toujours visible en bas d'un écran de saisie. Au téléphone elle est fixée au-dessus de la barre d'onglets,
// et quand le clavier s'ouvre elle monte juste au-dessus de lui (la barre d'onglets se cache). Un espace est réservé à la fin
// du contenu pour que le dernier champ ne passe jamais dessous. Sur ordinateur elle colle en bas de la zone de contenu.
export function barreAction(...enfants) {
  document.documentElement.classList.add("a-barre-action");
  return h("div", { class: "barre-action-groupe" }, h("div", { class: "barre-action", role: "group", "aria-label": tr("Actions") }, enfants), h("div", { class: "barre-action-espace", "aria-hidden": "true" }));
}

// ---- Squelette de chargement ------------------------------------------------------------------------------------
// Des lignes grises à la place du contenu : pas de saut de mise en page à l'arrivée des données, et rien qui tourne.
export function squelette(lignes = 4, { cartes = true } = {}) {
  const ligne = (i) => h("div", { class: cartes ? "squelette-carte" : "squelette-ligne", style: `--l: ${[78, 62, 88, 70][i % 4]}%` }, h("span"), h("span"));
  return h("div", { class: "squelette", role: "status", "aria-label": tr("Chargement…"), "aria-busy": "true" }, Array.from({ length: lignes }, (_, i) => ligne(i)));
}

// ---- Puces de filtre ----------------------------------------------------------------------------------------------
// Rangée défilante de choix exclusifs (comme « En cours / Soldés / Annulés »). `options` : [{ valeur, libelle, nombre? }].
// Renvoie { noeud, definir(valeur) }. Chaque puce a une zone de 44 px de haut ; la puce choisie reste visible dans la rangée.
export function puces({ options, valeur, onchange, libelle }) {
  let courant = valeur;
  const boutons = new Map();
  const liste = h("div", { class: "puces", role: "group", "aria-label": libelle || tr("Filtrer") });
  const dessiner = () => {
    for (const [v, b] of boutons) b.setAttribute("aria-pressed", v === courant ? "true" : "false");
  };
  for (const o of options) {
    const b = h("button", { type: "button", class: "puce", "aria-pressed": "false", onclick: () => definir(o.valeur, true) }, o.libelle, o.nombre !== undefined && o.nombre !== null ? h("span", { class: "puce-nombre" }, o.nombre) : null);
    boutons.set(o.valeur, b);
    liste.append(b);
  }
  function definir(v, notifier = false) {
    courant = v;
    dessiner();
    const b = boutons.get(v);
    if (b && b.scrollIntoView) b.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    if (notifier && onchange) onchange(v);
  }
  dessiner();
  return { noeud: liste, definir: (v) => definir(v), valeur: () => courant };
}

// Mini-langage des textes de conditions : lignes « - » en liste, **gras**, _italique_, [texte](lien), {variables}.
export function markup(texte, vars = {}) {
  const remplace = texte.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const racine = document.createDocumentFragment();
  let liste = null;
  for (const ligne of remplace.split("\n")) {
    if (ligne.startsWith("- ")) {
      if (!liste) {
        liste = h("ul");
        racine.append(liste);
      }
      liste.append(h("li", null, inline(ligne.slice(2))));
      continue;
    }
    liste = null;
    racine.append(ligne.trim() === "" ? h("div", { class: "espace" }) : h("p", null, inline(ligne)));
  }
  return racine;
}

export function inline(texte) {
  const frag = document.createDocumentFragment();
  const re = /\*\*(.+?)\*\*|_(.+?)_|\[(.+?)\]\((.+?)\)/g;
  let dernier = 0;
  for (const m of texte.matchAll(re)) {
    if (m.index > dernier) frag.append(texte.slice(dernier, m.index));
    if (m[1] !== undefined) frag.append(h("strong", null, m[1]));
    else if (m[2] !== undefined) frag.append(h("em", null, m[2]));
    else frag.append(/^https?:\/\//.test(m[4]) ? h("a", { href: m[4], target: "_blank", rel: "noopener" }, m[3]) : m[3]);
    dernier = m.index + m[0].length;
  }
  if (dernier < texte.length) frag.append(texte.slice(dernier));
  return frag;
}

export const num = (v) => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

// Charge une image choisie par l'utilisateur, la réduit et la renvoie en adresse de données (stockée dans les réglages).
export function chargerImage(fichier, maxPx = 800) {
  return new Promise((resolve, reject) => {
    if (!fichier || !fichier.type.startsWith("image/")) return reject(new Error(tr("Ce fichier n'est pas une image.")));
    if (fichier.size > 5 * 1024 * 1024) return reject(new Error(tr("Image trop lourde (5 Mo maximum).")));
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error(tr("Lecture de l'image impossible.")));
    lecteur.onload = () => {
      // Un SVG reste tel quel, il ne pèse presque rien et reste net à l'impression.
      if (fichier.type === "image/svg+xml") return resolve(lecteur.result);
      const img = new Image();
      img.onerror = () => reject(new Error(tr("Image illisible.")));
      img.onload = () => {
        const echelle = Math.min(1, maxPx / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * echelle);
        canvas.height = Math.round(img.height * echelle);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = lecteur.result;
    };
    lecteur.readAsDataURL(fichier);
  });
}

export function slug(texte) {
  return (texte || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Petites icônes en traits (même famille que Lucide), héritent la couleur du texte.
const ICONES = {
  annuler: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"],
  retablir: ["m15 14 5-5-5-5", "M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"],
  soleil: ["M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8", "M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41"],
  dossiers: ["M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"],
  clients: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 3a4 4 0 1 0 0 8 4 4 0 1 0 0-8", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  partenaires: ["m11 17 2 2a1 1 0 1 0 3-3", "m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4", "m21 3 1 11h-2", "M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3", "M3 4h8"],
  plus: ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M14 14h7v7h-7z", "M3 14h7v7H3z"],
  recherche: ["M11 3a8 8 0 1 0 0 16 8 8 0 1 0 0-16", "m21 21-4.3-4.3"],
  taches: ["m9 11 3 3L22 4", "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"],
  catalogue: ["M12 7v14", "M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"],
  analyses: ["M3 3v16a2 2 0 0 0 2 2h16", "M18 17V9", "M13 17V5", "M8 17v-3"],
  journal: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  reglages: ["M21 4h-6", "M11 4H3", "M21 12h-9", "M8 12H3", "M21 20h-4", "M12 20H3", "M15 2v4", "M8 10v4", "M17 18v4"],
  admin: ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"],
  groupe: ["M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z", "M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2", "M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2", "M10 6h4", "M10 10h4", "M10 14h4", "M10 18h4"],
  fermer: ["M18 6 6 18", "m6 6 12 12"],
  retour: ["m15 18-6-6 6-6"],
  deconnexion: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9"],
  cloche: ["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0"],
  clavier: ["M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M6 8h.01", "M10 8h.01", "M14 8h.01", "M18 8h.01", "M8 12h.01", "M12 12h.01", "M16 12h.01", "M7 16h10"],
  ajouter: ["M5 12h14", "M12 5v14"],
  fleche: ["M5 12h14", "m12 5 7 7-7 7"],
  ecran: ["M3 4h18v12H3z", "M8 21h8", "M12 17v4"],
  whatsapp: ["M7.9 20A9 9 0 1 0 4 16.1L2 22Z"],
  tarifs: ["M12.59 2.59a2 2 0 0 0-1.41-.59H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l9.41 9.41a2 2 0 0 0 2.83 0l7.17-7.17a2 2 0 0 0 0-2.83z", "M7 7h.01"],
  bateau: ["M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1", "M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76", "M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6", "M12 10v4", "M12 2v3"],
  reservations: ["M8 2v4", "M16 2v4", "M21 14V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8", "M3 10h18", "m16 20 2 2 4-4"],
  messages: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  du: ["M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1", "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"],
  regles: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z", "M14 2v4a2 2 0 0 0 2 2h4", "M10 9H8", "M16 13H8", "M16 17H8"],
  copier: ["M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z", "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"],
  filtrer: ["M3 6h18", "M7 12h10", "M10 18h4"],
  telephone: ["M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"],
  chevron: ["m6 9 6 6 6-6"],
  inverser: ["M8 3 4 7l4 4", "M4 7h16", "m16 21 4-4-4-4", "M20 17H4"],
  actualiser: ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"],
  coche: ["M20 6 9 17l-5-5"],
  alerte: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"],
};
export function icone(nom, taille = 18) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: String(taille), height: String(taille), fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) svg.setAttribute(k, v);
  for (const d of ICONES[nom]) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
