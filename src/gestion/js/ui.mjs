// Petits outils d'interface partagés par les écrans.

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

// Fenêtre modale. Renvoie une fonction de fermeture.
// `feuille` : sur téléphone la fenêtre monte depuis le bas, comme une feuille de menu.
export function modal(titre, contenu, { large = false, feuille = false } = {}) {
  const precedent = document.activeElement;
  const fermer = () => {
    fond.remove();
    document.removeEventListener("keydown", touche);
    if (precedent && precedent.focus) precedent.focus();
  };
  const touche = (e) => {
    if (e.key === "Escape") fermer();
  };
  const fond = h(
    "div",
    { class: "modal-fond", onmousedown: (e) => e.target === fond && fermer() },
    h(
      "div",
      { class: ["modal", large && "large", feuille && "feuille"].filter(Boolean).join(" "), role: "dialog", "aria-modal": "true", "aria-label": titre },
      h("div", { class: "modal-tete" }, h("h2", null, titre), h("button", { class: "bouton-icone lien", type: "button", onclick: fermer, "aria-label": "Fermer", title: "Fermer" }, icone("fermer", 20))),
      contenu
    )
  );
  document.body.append(fond);
  document.addEventListener("keydown", touche);
  const premier = fond.querySelector("input, select, textarea, button.principal");
  if (premier) premier.focus();
  return fermer;
}

export function confirmer(message, libelle = "Confirmer", danger = false) {
  return new Promise((resolve) => {
    let ferme;
    const fin = (v) => {
      ferme();
      resolve(v);
    };
    ferme = modal(
      "Confirmation",
      h(
        "div",
        { class: "modal-corps" },
        h("p", null, message),
        h(
          "div",
          { class: "actions" },
          h("button", { type: "button", class: "secondaire", onclick: () => fin(false) }, "Annuler"),
          h("button", { type: "button", class: danger ? "danger" : "principal", onclick: () => fin(true) }, libelle)
        )
      )
    );
  });
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
    if (!fichier || !fichier.type.startsWith("image/")) return reject(new Error("Ce fichier n'est pas une image."));
    if (fichier.size > 5 * 1024 * 1024) return reject(new Error("Image trop lourde (5 Mo maximum)."));
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error("Lecture de l'image impossible."));
    lecteur.onload = () => {
      // Un SVG reste tel quel, il ne pèse presque rien et reste net à l'impression.
      if (fichier.type === "image/svg+xml") return resolve(lecteur.result);
      const img = new Image();
      img.onerror = () => reject(new Error("Image illisible."));
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
  clavier: ["M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M6 8h.01", "M10 8h.01", "M14 8h.01", "M18 8h.01", "M8 12h.01", "M12 12h.01", "M16 12h.01", "M7 16h10"],
  ajouter: ["M5 12h14", "M12 5v14"],
  fleche: ["M5 12h14", "m12 5 7 7-7 7"],
  ecran: ["M3 4h18v12H3z", "M8 21h8", "M12 17v4"],
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
