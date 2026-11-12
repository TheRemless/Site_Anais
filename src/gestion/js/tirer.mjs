// Tirer pour actualiser, dans l'application installée sur l'écran d'accueil. Chargé à la demande par app.mjs, seulement en mode installé
// et sur un écran tactile. La logique du seuil vit dans tirer-calc.mjs (testée) ; ici, les événements du toucher et l'indicateur.
import { h, icone } from "./ui.mjs";
import { tr } from "./i18n.mjs";
import { DEPART, POSITION_ATTENTE, decalage, progression, peutDemarrer, suivre, declenche, etape, bilan } from "./tirer-calc.mjs";

const DUREE_MIN = 600; // l'indicateur ne clignote pas quand la lecture est instantanée
const DUREE_OK = 1100;
const DUREE_ERREUR = 3600;

// Un conteneur défilant sous le doigt qui n'est pas en haut : c'est lui qui doit défiler, pas la page.
function defileSousLeDoigt(cible) {
  for (let e = cible instanceof Element ? cible : null; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    if (e.scrollTop > 0) {
      const o = getComputedStyle(e).overflowY;
      if (o === "auto" || o === "scroll") return true;
    }
  }
  return false;
}

export function installerTirer({ bloque, actualiser }) {
  const icones = h("span", { class: "tirer-icone", "aria-hidden": "true" }, icone("actualiser", 18));
  const texte = h("span", { class: "tirer-texte" });
  const puce = h("div", { class: "tirer", "aria-hidden": "true", hidden: true }, icones, texte);
  // L'indicateur bouge sous le doigt : il reste muet pour les lecteurs d'écran, qui n'entendent que le début et la fin de l'actualisation.
  const annonce = h("div", { class: "visuellement-cache", role: "status" });
  document.body.append(puce, annonce);

  let occupe = false;
  let suivi = null;
  let minuterie = 0;

  const placer = (decal, prog) => {
    puce.style.setProperty("--decal", String(decal));
    puce.style.setProperty("--prog", String(prog));
  };
  const montrer = () => {
    clearTimeout(minuterie);
    puce.hidden = false;
  };
  const retracter = () => {
    puce.classList.add("relache");
    puce.classList.remove("arme", "actualise", "erreur");
    placer(0, 0);
    minuterie = setTimeout(() => (puce.hidden = true), 300);
  };
  let nomIcone = "actualiser";
  const remplacerIcone = (nom) => {
    if (nom === nomIcone) return;
    nomIcone = nom;
    icones.replaceChildren(icone(nom, 18));
  };

  function afficherTirage(etat) {
    montrer();
    remplacerIcone("actualiser");
    puce.classList.remove("relache", "actualise", "erreur");
    puce.classList.toggle("arme", etat.arme);
    texte.textContent = etape(etat) === "relacher" ? tr("Relâcher pour actualiser") : tr("Tirer pour actualiser");
    placer(decalage(etat.dy), progression(etat.dy));
  }

  async function lancer() {
    occupe = true;
    let recharge = false;
    try {
      recharge = await lancerSansGarde();
    } finally {
      if (!recharge) occupe = false; // la page se recharge : plus aucun tirage d'ici là
    }
  }
  async function lancerSansGarde() {
    montrer();
    puce.classList.add("relache", "actualise");
    puce.classList.remove("arme", "erreur");
    remplacerIcone("actualiser");
    texte.textContent = tr("Actualisation…");
    annonce.textContent = tr("Actualisation…");
    placer(POSITION_ATTENTE, 1);
    const debut = Date.now();
    let resultat;
    try {
      resultat = await actualiser();
    } catch (erreur) {
      resultat = { erreur };
    }
    const reste = DUREE_MIN - (Date.now() - debut);
    if (reste > 0) await new Promise((r) => setTimeout(r, reste));
    if (resultat && resultat.rechargement) {
      texte.textContent = tr("Mise à jour de l'outil…");
      annonce.textContent = tr("Mise à jour de l'outil…");
      setTimeout(() => location.reload(), 250);
      return true;
    }
    const b = bilan({ resultat: resultat && resultat.resultat, erreur: resultat && resultat.erreur, horsLigne: navigator.onLine === false, demo: !!(resultat && resultat.demo) });
    puce.classList.remove("actualise");
    let message;
    if (b.type === "erreur") {
      puce.classList.add("erreur");
      remplacerIcone("alerte");
      message = b.cle === "hors_ligne" ? tr("Hors connexion : actualisation impossible.") : tr("Actualisation impossible : {message}", { message: b.message });
    } else if (b.type === "info") {
      remplacerIcone("actualiser");
      message = tr("Une actualisation est déjà en cours.");
    } else {
      remplacerIcone("coche");
      message = tr("À jour");
    }
    texte.textContent = message;
    annonce.textContent = message;
    await new Promise((r) => setTimeout(r, b.type === "erreur" ? DUREE_ERREUR : DUREE_OK));
    retracter();
    return false;
  }

  function terminer(annule = false) {
    document.removeEventListener("touchmove", bouger);
    document.removeEventListener("touchend", lever);
    document.removeEventListener("touchcancel", annuler);
    const etat = suivi && suivi.etat;
    suivi = null;
    if (!etat) return;
    if (etat.phase !== "tire") {
      if (!puce.hidden && !occupe) retracter(); // tirage commencé puis refusé (la page a défilé)
      return;
    }
    if (!annule && declenche(etat)) lancer();
    else retracter();
  }
  const lever = () => terminer(false);
  const annuler = () => terminer(true);

  function bouger(e) {
    if (!suivi) return;
    if (e.touches.length !== 1) return terminer(true);
    const t = e.touches[0];
    const etat = suivre(suivi.etat, t.clientX - suivi.x, t.clientY - suivi.y, window.scrollY);
    suivi.etat = etat;
    if (etat.phase === "refuse") return terminer(true); // défilement normal : on rend la main tout de suite
    if (etat.phase !== "tire") return;
    if (e.cancelable) e.preventDefault(); // pas de rebond de la page pendant le tirage
    afficherTirage(etat);
  }

  document.addEventListener(
    "touchstart",
    (e) => {
      if (suivi) return terminer(true);
      const t = e.touches[0];
      const ok = peutDemarrer({
        scrollY: window.scrollY,
        x: t.clientX,
        y: t.clientY,
        largeur: window.innerWidth,
        touches: e.touches.length,
        bloque: occupe || bloque(),
        defilee: defileSousLeDoigt(e.target),
      });
      if (!ok) return;
      suivi = { x: t.clientX, y: t.clientY, etat: DEPART };
      // Le détecteur de mouvement n'existe que pendant un toucher parti du haut de la page : le défilement ordinaire n'attend jamais notre code.
      document.addEventListener("touchmove", bouger, { passive: false });
      document.addEventListener("touchend", lever);
      document.addEventListener("touchcancel", annuler);
    },
    { passive: true }
  );
}
