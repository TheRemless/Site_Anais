// Aperçu d'un devis ou d'une facture sur téléphone : deux onglets « Éditer » et « Aperçu » au lieu d'un aperçu minuscule sous le formulaire,
// avec un zoom au pincement (ou par boutons et double tap) qui garde la feuille entière lisible sans quitter l'écran.
import { h } from "../ui.mjs";
import { tr } from "../i18n.mjs";

const ZOOM_MAX = 3;
const bornes = (z) => Math.min(ZOOM_MAX, Math.max(1, z));

// `racine` : l'élément « .editeur » ; `zoneApercu` : le conteneur de l'aperçu ; `ajuster` : recalcule l'échelle d'après `zoneApercu.zoom`.
// Renvoie le bloc d'onglets et de commandes de zoom à poser avant `racine`.
export function apercuMobile({ racine, zoneApercu, ajuster }) {
  zoneApercu.zoom = 1;
  racine.dataset.vue = "editer";
  const regler = (z, centre) => {
    const avant = zoneApercu.zoom;
    const apres = bornes(z);
    if (apres === avant) return;
    // Le point sous les doigts reste sous les doigts : on garde sa position relative dans la feuille.
    const rx = centre ? (zoneApercu.scrollLeft + centre.x) / zoneApercu.scrollWidth : 0;
    zoneApercu.zoom = apres;
    ajuster();
    if (centre) zoneApercu.scrollLeft = rx * zoneApercu.scrollWidth - centre.x;
    zoneApercu.classList.toggle("zoome", apres > 1);
    plus.disabled = apres >= ZOOM_MAX;
    moins.disabled = apres <= 1;
  };
  const moins = h("button", { class: "secondaire petit", type: "button", "aria-label": tr("Réduire l'aperçu"), onclick: () => regler(zoneApercu.zoom / 1.5) }, "−");
  const plus = h("button", { class: "secondaire petit", type: "button", "aria-label": tr("Agrandir l'aperçu"), onclick: () => regler(zoneApercu.zoom * 1.5) }, "+");
  moins.disabled = true;
  const onglets = h("div", { class: "onglets onglets-editeur", role: "group", "aria-label": tr("Affichage") });
  const montrer = (vue) => {
    racine.dataset.vue = vue;
    commandes.hidden = vue !== "apercu";
    for (const b of onglets.querySelectorAll("button")) b.setAttribute("aria-pressed", b.dataset.vue === vue ? "true" : "false");
    // L'aperçu caché n'a pas de largeur : on le met à l'échelle au moment de l'afficher.
    if (vue === "apercu") ajuster();
    window.scrollTo(0, 0);
  };
  for (const [vue, libelle] of [["editer", tr("Éditer")], ["apercu", tr("Aperçu")]]) onglets.append(h("button", { type: "button", "data-vue": vue, "aria-pressed": vue === "editer" ? "true" : "false", onclick: () => montrer(vue) }, libelle));
  const commandes = h("div", { class: "apercu-zoom", hidden: true }, moins, plus, h("span", { class: "aide" }, tr("Pincez pour agrandir")));

  // Pincement à deux doigts et double tap (agrandir ou revenir à la largeur de l'écran).
  const doigts = new Map();
  let distance = 0;
  let dernierTap = 0;
  zoneApercu.addEventListener("pointerdown", (e) => {
    doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (doigts.size === 2) distance = ecart();
    else {
      const t = Date.now();
      if (t - dernierTap < 300) regler(zoneApercu.zoom > 1 ? 1 : 2, { x: e.clientX - zoneApercu.getBoundingClientRect().left, y: 0 });
      dernierTap = t;
    }
  });
  const ecart = () => {
    const [a, b] = [...doigts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  zoneApercu.addEventListener("pointermove", (e) => {
    if (!doigts.has(e.pointerId)) return;
    doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (doigts.size === 2 && distance > 0) {
      const d = ecart();
      const [a, b] = [...doigts.values()];
      regler(zoneApercu.zoom * (d / distance), { x: (a.x + b.x) / 2 - zoneApercu.getBoundingClientRect().left, y: 0 });
      distance = d;
    }
  });
  const fin = (e) => {
    doigts.delete(e.pointerId);
    distance = 0;
  };
  zoneApercu.addEventListener("pointerup", fin);
  zoneApercu.addEventListener("pointercancel", fin);

  return h("div", { class: "editeur-barre" }, onglets, commandes);
}
