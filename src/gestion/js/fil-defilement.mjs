// Défilement des fils de conversation (WhatsApp, Assistant), 23.11.2026 : « ça bugue de ouf quand il y a des images ».
// À l'ouverture, le fil montre le dernier message, sur bureau comme sur téléphone, et y reste pendant que les images arrivent, tant que la
// personne n'a pas fait défiler elle-même. Si elle lit plus haut, rien ne la déplace : un bouton « Nouveaux messages ↓ » apparaît.
// La partie calcul (sans écran) est testée dans tests/fil-defilement.test.mjs.

// Marge sous laquelle on considère être « en bas » : un doigt qui s'arrête à quelques pixels du dernier message compte.
export const SEUIL_BAS = 80;
// Un défilement compte comme celui de la personne s'il suit de près un geste (doigt, molette, clavier) : l'élan d'iOS dure quelques secondes.
export const DELAI_GESTE_MS = 2500;
// Proportions gardées pour une photo dont on connaît la taille : ni plus haute que 9/16, ni plus large que 16/9.
const RATIO_MIN = 9 / 16;
const RATIO_MAX = 16 / 9;

// ---- Calcul ------------------------------------------------------------------------------------------------------------------------

// La position voulue est-elle atteinte (ou dépassée vers le bas) ?
export const estEnBas = (position, cible, seuil = SEUIL_BAS) => position >= cible - seuil;

// Ce que fait le fil quand l'écran change :
// - « bas » : à l'ouverture, quand la personne vient d'écrire, ou si elle était déjà en bas ;
// - « annoncer » : un message est arrivé alors qu'elle lit plus haut (position gardée, bouton « Nouveaux messages ») ;
// - « garder » : rien de neuf et Nani lit plus haut, la position ne bouge pas.
// Un redessin sans message neuf (statut « lu », réponse préparée, synchronisation) laisse en bas une personne qui y était : sinon le message
// suivant du client ne ferait plus descendre le fil (relecture de la PR 339).
export function decisionArrivee({ premiere = false, nouveau = false, colle = true, deMoi = false } = {}) {
  if (premiere) return "bas";
  if (!nouveau) return colle ? "bas" : "garder";
  if (colle || deMoi) return "bas";
  return "annoncer";
}

// Après un défilement : la personne reste collée en bas, s'en détache (seulement par un geste à elle), ou un défilement venu d'ailleurs
// (mise en page, autre code) est corrigé pour la garder en bas.
// Clavier ouvert (`clavier`, 26.11.2026) : le défilement vient d'iOS, qui montre le champ touché. Il n'est jamais corrigé : le fil et iOS se
// renverraient la page tant que le clavier reste ouvert. La personne reste collée en bas pour la suite.
export function apresDefilement({ position, cible, colle, geste, clavier = false }) {
  if (estEnBas(position, cible)) return { colle: true, ecart: Math.max(0, position - cible), corriger: false };
  if (geste) return { colle: false, ecart: 0, corriger: false };
  return { colle, ecart: 0, corriger: colle && !clavier };
}

// La place d'une photo avant son chargement : les proportions du média (largeur / hauteur) quand elles sont connues, bornées entre 9/16 et
// 16/9, sinon un carré. La boîte a toujours la même taille, image chargée ou non : plus aucun saut quand elle arrive.
export function ratioMedia(media) {
  const m = media || {};
  const l = Number(m.largeur ?? m.width);
  const h = Number(m.hauteur ?? m.height);
  if (!(l > 0 && h > 0)) return 1;
  // Arrondi à quatre décimales : un style stable d'un rendu à l'autre.
  return Math.round(Math.min(RATIO_MAX, Math.max(RATIO_MIN, l / h)) * 10000) / 10000;
}

// Liens signés des photos (cinq minutes chez Supabase) : gardés quatre minutes, pour qu'un redessin réutilise la même adresse (image déjà en
// mémoire, aucun nouvel appel) au lieu d'en demander une par photo à chaque message arrivé.
export function cacheLiens({ duree = 4 * 60 * 1000, maintenant = () => Date.now(), max = 300 } = {}) {
  const liens = new Map();
  return {
    lire(cle) {
      const x = cle ? liens.get(cle) : null;
      if (!x) return null;
      if (x.expire > maintenant()) return x.lien;
      liens.delete(cle);
      return null;
    },
    garder(cle, lien) {
      if (!cle || !lien) return;
      liens.delete(cle);
      liens.set(cle, { lien, expire: maintenant() + duree });
      // Les plus anciens partent d'abord : la mémoire reste bornée.
      while (liens.size > max) liens.delete(liens.keys().next().value);
    },
    taille: () => liens.size,
  };
}

// Empreinte d'un message affiché : la bulle déjà à l'écran est reprise telle quelle si rien n'a changé (son image reste chargée).
export const empreinteMessage = (m) => JSON.stringify(m || null);

// ---- Écran ----------------------------------------------------------------------------------------------------------------------

// La zone défile-t-elle elle-même (bureau) ou est-ce la page (téléphone) ?
function zoneDefile(zone) {
  const o = getComputedStyle(zone).overflowY;
  return o === "auto" || o === "scroll";
}

const GESTES = ["wheel", "touchstart", "touchmove", "keydown", "pointerdown"];

// Suivre le défilement d'un fil. `zone` : l'élément des messages. `cibleFenetre` (téléphone, la page défile) : la position voulue de la page,
// par défaut tout en bas. `bouton` : le bouton « Nouveaux messages » à montrer ou cacher.
// En bas, le fil y reste quand la hauteur change (image, carte, police). Plus haut, l'élément lu reste au même endroit de l'écran quand ce qui
// est au-dessus change de hauteur : le repère est tenu ici, de la même façon sur Safari (qui n'a pas d'ancrage natif) et sur Chrome.
export function suivreFil(zone, { cibleFenetre = null, bouton = null } = {}) {
  let colle = true;
  let ecart = 0;
  let geste = 0;
  let arrete = false;
  let repere = null; // { el, decalage } : l'élément lu et sa distance au haut de la vue
  const fenetre = () => !zoneDefile(zone);
  const position = () => (fenetre() ? window.scrollY : zone.scrollTop);
  const hautVue = () => (fenetre() ? 0 : zone.getBoundingClientRect().top);
  const cible = () => {
    if (!fenetre()) return Math.max(0, zone.scrollHeight - zone.clientHeight);
    const bas = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return Math.min(bas, Math.max(0, cibleFenetre ? cibleFenetre() : bas));
  };
  // La position laissée par notre dernier placement : si elle a bougé depuis, quelqu'un (la personne, le navigateur) a défilé.
  let posee = null;
  const aller = (y) => {
    if (fenetre()) window.scrollTo({ top: y, behavior: "instant" });
    else zone.scrollTop = y;
    posee = position();
  };
  const montrerBouton = (v) => {
    if (bouton) bouton.hidden = !v;
  };
  // Le premier élément visible en haut de la vue, et sa distance à ce haut.
  // Recherche par dichotomie (les éléments sont rangés de haut en bas) : quelques lectures de position par défilement, même dans un long fil.
  const premierVisible = (liste, haut) => {
    let bas = 0;
    let fin = liste.length;
    while (bas < fin) {
      const m = (bas + fin) >> 1;
      if (liste[m].getBoundingClientRect().bottom > haut + 1) fin = m;
      else bas = m + 1;
    }
    for (let i = bas; i < liste.length; i++) {
      const r = liste[i].getBoundingClientRect();
      if (liste[i] !== bouton && r.height) return { el: liste[i], decalage: r.top - haut };
    }
    return null;
  };
  const lireRepere = () => {
    const haut = hautVue();
    // Une bulle WhatsApp (data-message) de préférence, sinon un élément du fil (Assistant, ou les cartes sous la dernière bulle).
    const bulles = [...zone.querySelectorAll("[data-message]")];
    return (bulles.length && premierVisible(bulles, haut)) || premierVisible([...zone.children], haut);
  };
  // Remettre l'élément lu à sa place (ce qui est au-dessus a changé de hauteur).
  const tenirRepere = () => {
    if (!repere || !repere.el.isConnected) return;
    const d = repere.el.getBoundingClientRect().top - hautVue() - repere.decalage;
    if (Math.abs(d) > 0.5) aller(position() + d);
  };
  // Relire la position avant de décider : un message du flux peut arriver avant l'événement « scroll » du geste qui vient d'avoir lieu,
  // et ne doit pas ramener en bas une personne qui vient de remonter. Rend vrai s'il faut corriger un défilement venu d'ailleurs.
  const synchroniser = () => {
    const p = position();
    if (posee !== null && Math.abs(p - posee) <= 1) return false;
    posee = p;
    const r = apresDefilement({ position: p, cible: cible(), colle, geste: Date.now() - geste < DELAI_GESTE_MS, clavier: fenetre() && document.documentElement.classList.contains("clavier") });
    colle = r.colle;
    if (colle) (ecart = r.ecart), montrerBouton(false), (repere = null);
    else repere = lireRepere();
    return r.corriger;
  };
  // La zone n'est plus dans la page (autre écran, conversation refaite) : les écouteurs partent avec elle.
  const horsPage = () => {
    if (arrete) return true;
    if (zone.isConnected) return false;
    arreter();
    return true;
  };
  const coller = () => {
    if (arrete || !zone.isConnected) return;
    aller(cible() + ecart);
  };
  const surGeste = () => (geste = Date.now());
  const surDefilement = () => {
    if (horsPage()) return;
    if (synchroniser()) coller();
  };
  // Une image, une carte ou une police qui change la hauteur : en bas, on y reste ; plus haut, l'élément lu ne bouge pas.
  const observe = new Set();
  const ro =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (horsPage()) return;
          synchroniser();
          if (colle) coller();
          else tenirRepere();
        })
      : null;
  const observer = () => {
    if (!ro) return;
    // Les éléments retirés du fil ne sont plus suivis ni retenus en mémoire (la zone de l'Assistant sert à toutes les conversations).
    for (const n of observe) if (n !== zone && n.parentNode !== zone) (observe.delete(n), ro.unobserve(n));
    for (const n of [zone, ...zone.children]) if (!observe.has(n)) (observe.add(n), ro.observe(n));
  };
  function arreter() {
    if (arrete) return;
    arrete = true;
    if (ro) ro.disconnect();
    observe.clear();
    for (const g of GESTES) window.removeEventListener(g, surGeste, { capture: true });
    zone.removeEventListener("scroll", surDefilement);
    window.removeEventListener("scroll", surDefilement);
  }
  observer();
  for (const g of GESTES) window.addEventListener(g, surGeste, { capture: true, passive: true });
  zone.addEventListener("scroll", surDefilement, { passive: true });
  window.addEventListener("scroll", surDefilement, { passive: true });
  // Un saut direct, sans animation : un défilement doux enverrait des positions intermédiaires prises pour un geste vers le haut.
  if (bouton) bouton.addEventListener("click", () => ((colle = true), (ecart = 0), (repere = null), montrerBouton(false), aller(cible())));
  return {
    get colle() {
      if (!arrete && zone.isConnected) synchroniser();
      return colle;
    },
    position,
    // Ce que la personne lit, pour le retrouver après un redessin : la bulle (data-message) ou le rang de l'élément du fil, et sa distance
    // au haut de la vue.
    instantane() {
      const r = lireRepere();
      if (!r) return { position: position() };
      const enfants = [...zone.children];
      const rang = enfants.findIndex((x) => x === r.el || x.contains(r.el));
      return { position: position(), message: r.el.dataset ? r.el.dataset.message || "" : "", rang, decalage: r.decalage };
    },
    // Distance sous la position voulue (téléphone : Nani lit la réponse préparée sous le dernier message).
    get ecart() {
      return ecart;
    },
    // À l'ouverture ou quand la personne vient d'écrire : tout en bas, et on y reste. `ecart` : garder la distance d'avant un redessin.
    bas({ ecart: e = 0 } = {}) {
      colle = true;
      ecart = e;
      repere = null;
      montrerBouton(false);
      observer();
      coller();
    },
    // Un redessin qui garde la lecture (la personne lisait plus haut) : la même bulle, ou le même rang, au même endroit de l'écran.
    garder(inst, { annoncer = false } = {}) {
      colle = false;
      observer();
      const x = inst || {};
      aller(x.position || 0);
      const el = x.message ? [...zone.querySelectorAll("[data-message]")].find((b) => b.dataset.message === x.message) : x.rang >= 0 ? zone.children[x.rang] : null;
      repere = el ? { el, decalage: x.decalage || 0 } : lireRepere();
      tenirRepere();
      if (annoncer) montrerBouton(true);
    },
    // Des éléments ajoutés dans la zone (bulle, carte, image) : observés eux aussi.
    observer,
    arreter,
    get arrete() {
      return arrete;
    },
  };
}
