// Une photo en grand, par-dessus l'écran (23.11.2026). Remplace l'onglet ouvert pour chaque photo : sur iPhone (Gestion en application), un
// onglet de Safari s'ouvrait par-dessus et le retour à la conversation se perdait. Fond sombre, photo entière, bouton Fermer de 44 px,
// Échap, un toucher sur le fond ou le bouton retour du téléphone referment. La conversation derrière ne bouge pas.
import { h, icone } from "./ui.mjs";
import { tr } from "./i18n.mjs";

let ouverte = null;

export function ouvrirVisionneuse({ src, alt = "", original = null, ferme: apres = null }) {
  // Une seule photo à la fois : un second toucher (lien encore en chargement) ne rouvre rien. Fermer puis rouvrir mêlerait le retour
  // d'historique de la première à la seconde, qui se refermerait aussitôt.
  if (ouverte) return ouverte;
  const precedent = document.activeElement;
  // La classe de la fenêtre ouverte bloque le défilement de la page (et un redessin pendant que la photo est ouverte, ecranLibre).
  const ajouteClasse = !document.documentElement.classList.contains("modal-ouverte");
  const fermerBouton = h("button", { class: "visionneuse-fermer", type: "button", "aria-label": tr("Fermer"), onclick: () => fermer() }, icone("fermer", 24));
  const image = h("img", { class: "visionneuse-image", src, alt });
  const fond = h(
    "div",
    { class: "modal-fond visionneuse", role: "dialog", "aria-modal": "true", "aria-label": alt || tr("Photo"), onclick: (e) => (e.target === fond || e.target.classList.contains("visionneuse-cadre")) && fermer() },
    h("div", { class: "visionneuse-barre" }, original ? h("a", { class: "visionneuse-original", href: original, target: "_blank", rel: "noopener" }, tr("Ouvrir l'original")) : h("span"), fermerBouton),
    h("div", { class: "visionneuse-cadre" }, image)
  );
  const surTouche = (e) => {
    // Échap ferme la photo seulement : la fenêtre du dessous (écoute en phase de bouillonnement) ne la reçoit pas (relecture de la PR 363).
    if (e.key === "Escape") return void (e.preventDefault(), e.stopPropagation(), fermer());
    // Le focus reste dans la fenêtre.
    if (e.key === "Tab") {
      const f = [...fond.querySelectorAll("a, button")];
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
    }
  };
  // Le bouton retour (Android, geste du bord) ferme la photo au lieu de quitter la conversation : une entrée d'historique sans changer
  // l'adresse. Fermée autrement, l'entrée est retirée.
  let parRetour = false;
  const surRetour = () => ((parRetour = true), fermer());
  function fermer() {
    if (ouverte !== api) return;
    ouverte = null;
    fond.remove();
    document.removeEventListener("keydown", surTouche, true);
    window.removeEventListener("popstate", surRetour);
    if (ajouteClasse && !document.querySelector(".modal-fond")) document.documentElement.classList.remove("modal-ouverte");
    if (!parRetour && history.state && history.state.visionneuse) history.back();
    if (precedent && precedent.focus && document.contains(precedent)) precedent.focus({ preventScroll: true });
    if (apres) apres();
  }
  const api = { fermer };
  ouverte = api;
  document.body.append(fond);
  document.documentElement.classList.add("modal-ouverte");
  document.addEventListener("keydown", surTouche, true);
  try {
    history.pushState({ ...(history.state || {}), visionneuse: true }, "");
    window.addEventListener("popstate", surRetour);
  } catch {
    // historique refusé (rare) : Fermer et Échap suffisent
  }
  fermerBouton.focus({ preventScroll: true });
  return api;
}
