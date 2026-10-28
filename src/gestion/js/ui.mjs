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
export function modal(titre, contenu, { large = false } = {}) {
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
      { class: large ? "modal large" : "modal", role: "dialog", "aria-modal": "true", "aria-label": titre },
      h("div", { class: "modal-tete" }, h("h2", null, titre), h("button", { class: "lien", type: "button", onclick: fermer }, "Fermer")),
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
