// tests/gestion-fil-defilement.test.js : « l'Assistant et WhatsApp buguent quand il y a des images » (23.11.2026).
// Place réservée des photos, ouverture sur le dernier message, position gardée quand Nani lit plus haut, bouton « Nouveaux messages »,
// liens signés repris d'un rendu à l'autre, démonstration de 18 photos. Le contrôleur de défilement tourne ici sur une zone simulée.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const racine = path.join(__dirname, "..");
const source = (f) => fs.readFileSync(path.join(racine, f), "utf8");
const D = () => import("../src/gestion/js/fil-defilement.mjs");

test("décision à l'arrivée : en bas à l'ouverture, quand on écrit ou si on y était ; sinon position gardée et annonce", async () => {
  const { decisionArrivee } = await D();
  assert.equal(decisionArrivee({ premiere: true, colle: false }), "bas", "ouverture d'une conversation");
  assert.equal(decisionArrivee({ nouveau: false, colle: false }), "garder", "redessin sans message neuf");
  assert.equal(decisionArrivee({ nouveau: false, colle: true }), "garder");
  assert.equal(decisionArrivee({ nouveau: true, colle: true }), "bas", "Nani était en bas : elle voit le message");
  assert.equal(decisionArrivee({ nouveau: true, colle: false }), "annoncer", "Nani lit plus haut : on ne la déplace pas");
  assert.equal(decisionArrivee({ nouveau: true, colle: false, deMoi: true }), "bas", "Nani vient d'envoyer : son message en vue");
});

test("après un défilement : seul un geste de la personne la détache du bas ; un défilement venu d'ailleurs est corrigé", async () => {
  const { apresDefilement, estEnBas, SEUIL_BAS } = await D();
  assert.ok(estEnBas(1000 - SEUIL_BAS, 1000));
  assert.ok(!estEnBas(1000 - SEUIL_BAS - 1, 1000));
  assert.deepEqual(apresDefilement({ position: 400, cible: 1000, colle: true, geste: true }), { colle: false, ecart: 0, corriger: false });
  assert.deepEqual(apresDefilement({ position: 400, cible: 1000, colle: true, geste: false }), { colle: true, ecart: 0, corriger: true }, "le navigateur a bougé la page : on la remet");
  assert.deepEqual(apresDefilement({ position: 400, cible: 1000, colle: false, geste: false }), { colle: false, ecart: 0, corriger: false }, "Nani lit plus haut : rien ne la ramène");
  assert.deepEqual(apresDefilement({ position: 995, cible: 1000, colle: false, geste: true }), { colle: true, ecart: 0, corriger: false }, "revenue en bas : collée de nouveau");
  assert.deepEqual(apresDefilement({ position: 1200, cible: 1000, colle: true, geste: true }), { colle: true, ecart: 200, corriger: false }, "téléphone : sous le dernier message (réponse préparée), l'écart est gardé");
});

test("place réservée : les proportions du média, bornées, sinon un carré ; jamais de taille qui dépend du chargement", async () => {
  const { ratioMedia } = await D();
  assert.equal(ratioMedia({}), 1);
  assert.equal(ratioMedia(null), 1);
  assert.equal(ratioMedia({ largeur: 0, hauteur: 900 }), 1);
  assert.equal(ratioMedia({ largeur: 1200, hauteur: 900 }), 1.3333);
  assert.equal(ratioMedia({ width: 900, height: 1200 }), 0.75, "les noms anglais d'un média sont lus aussi");
  assert.equal(ratioMedia({ largeur: 720, hauteur: 1560 }), 0.5625, "capture d'écran très haute : bornée à 9/16");
  assert.equal(ratioMedia({ largeur: 4000, hauteur: 500 }), 1.7778, "panorama : borné à 16/9");
  const css = source("src/gestion/css/app.css");
  assert.match(css, /\.wa-vignette-boite \{[^}]*aspect-ratio: var\(--ratio, 1\)/, "la boîte prend les proportions avant l'image");
  assert.match(css, /\.wa-vignette-boite img \{[^}]*object-fit: cover/);
  assert.match(css, /\.agent-voucher-apercu \{[^}]*aspect-ratio: 1588 \/ 1900/, "aperçu du voucher de l'Assistant : place d'un voucher dès le départ");
  assert.doesNotMatch(css, /\.agent-voucher-apercu \{[^}]*min-height: 96px/, "plus de boîte de 96 px qui grandit à l'arrivée de l'image");
  assert.match(css, /\.wa-messages, \.agent-messages \{ overflow-anchor: none; \}/);
  assert.match(css, /\.wa-nouveaux, \.agent-nouveaux \{[^}]*min-height: 44px/, "cible tactile de 44 px");
  assert.match(css, /\.visionneuse-fermer \{[^}]*width: 44px; height: 44px/, "Fermer de la photo en grand : 44 px");
});

test("liens signés : repris pendant quatre minutes (même adresse, image en mémoire), puis redemandés ; mémoire bornée", async () => {
  const { cacheLiens } = await D();
  let t = 0;
  const c = cacheLiens({ maintenant: () => t, max: 2 });
  assert.equal(c.lire("a"), null);
  c.garder("a", "https://x/a?token=1");
  c.garder("", "https://x/vide");
  c.garder("b", null);
  assert.equal(c.taille(), 1, "ni clé vide ni lien absent");
  t = 4 * 60 * 1000 - 1;
  assert.equal(c.lire("a"), "https://x/a?token=1");
  t = 4 * 60 * 1000;
  assert.equal(c.lire("a"), null, "expiré avant les cinq minutes de Supabase");
  assert.equal(c.taille(), 0);
  c.garder("1", "l1");
  c.garder("2", "l2");
  c.garder("3", "l3");
  assert.equal(c.taille(), 2);
  assert.equal(c.lire("1"), null, "le plus ancien part d'abord");
});

test("empreinte d'une bulle : la même tant que le message ne change pas", async () => {
  const { empreinteMessage } = await D();
  const m = { id: "m1", texte: "Hi", medias: [{ chemin: "a.jpg" }], statut_envoi: "envoye" };
  assert.equal(empreinteMessage(m), empreinteMessage({ ...m }));
  assert.notEqual(empreinteMessage(m), empreinteMessage({ ...m, statut_envoi: "lu" }), "un statut qui change redessine la bulle");
});

// ---- Contrôleur sur une zone simulée (bureau : la zone défile) ---------------------------------------------------------------------
function zoneSimulee({ hauteur = 3000, vue = 500, enfants = 10 } = {}) {
  const ecouteurs = {};
  const fenetre = {};
  const enfantsSimules = [];
  const zone = {
    scrollTop: 0,
    scrollHeight: hauteur,
    clientHeight: vue,
    isConnected: true,
    children: enfantsSimules,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, bottom: vue, height: vue }),
    addEventListener: (n, f) => (ecouteurs[n] = f),
    removeEventListener: (n) => delete ecouteurs[n],
    defiler(y) {
      this.scrollTop = Math.max(0, Math.min(y, this.scrollHeight - this.clientHeight));
      if (ecouteurs.scroll) ecouteurs.scroll();
    },
  };
  // Des éléments de 300 px, les uns sous les autres ; `grandir(i, n)` agrandit l'élément i (une image au-dessus qui arrive).
  const hauteurs = Array.from({ length: enfants }, () => hauteur / enfants);
  const haut = (i) => hauteurs.slice(0, i).reduce((a, b) => a + b, 0) - zone.scrollTop;
  hauteurs.forEach((_, i) => enfantsSimules.push({ i, isConnected: true, parentNode: zone, contains: (x) => x === enfantsSimules[i], getBoundingClientRect: () => ({ top: haut(i), bottom: haut(i) + hauteurs[i], height: hauteurs[i] }) }));
  zone.grandir = (i, n) => {
    hauteurs[i] += n;
    zone.scrollHeight += n;
  };
  return { zone, fenetre, ecouteurs };
}
function installerGlobaux() {
  const gestes = {};
  let ro = null;
  global.getComputedStyle = () => ({ overflowY: "auto" });
  global.window = { scrollY: 0, innerHeight: 800, addEventListener: (n, f) => (gestes[n] = f), removeEventListener: () => {}, scrollTo: () => {} };
  global.document = { documentElement: { scrollHeight: 800 } };
  global.ResizeObserver = class {
    constructor(f) {
      ro = f;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  return { geste: () => gestes.wheel(), redimension: () => ro && ro([]) };
}

test("contrôleur : ouverture en bas, et le fil y reste pendant que les images arrivent", async () => {
  const { suivreFil } = await D();
  const g = installerGlobaux();
  const { zone } = zoneSimulee();
  const bouton = { hidden: true, addEventListener() {} };
  const ctrl = suivreFil(zone, { bouton });
  ctrl.bas();
  assert.equal(zone.scrollTop, 2500, "le dernier message en vue");
  zone.grandir(2, 280);
  g.redimension();
  assert.equal(zone.scrollTop, 2780, "une image chargée au-dessus : toujours en bas");
  assert.equal(ctrl.colle, true);
  assert.equal(bouton.hidden, true);
});

test("contrôleur : Nani remonte lire, une image arrive au-dessus et un message en bas ; rien ne la déplace", async () => {
  const { suivreFil } = await D();
  const g = installerGlobaux();
  const { zone } = zoneSimulee();
  const bouton = { hidden: true, addEventListener() {} };
  const ctrl = suivreFil(zone, { bouton });
  ctrl.bas();
  // Le geste puis la position, avant même l'événement « scroll » (un message du flux peut passer entre les deux).
  g.geste();
  zone.scrollTop = 1000;
  assert.equal(ctrl.colle, false, "détachée dès le geste, sans attendre l'événement scroll");
  // L'élément 3 (de 900 à 1200) est lu, à -100 px du haut de la vue. Une image arrive dans l'élément 1, au-dessus.
  zone.grandir(1, 280);
  g.redimension();
  assert.equal(zone.scrollTop, 1280, "l'élément lu reste au même endroit de l'écran");
  // Un message arrive en bas : la zone grandit, Nani ne bouge pas.
  zone.grandir(9, 200);
  g.redimension();
  assert.equal(zone.scrollTop, 1280);
  // Redessin de l'écran (instantané puis garder) : même élément, même décalage, bouton affiché.
  const inst = ctrl.instantane();
  assert.equal(inst.rang, 3);
  assert.equal(inst.decalage, -100);
  zone.scrollTop = 0;
  ctrl.garder(inst, { annoncer: true });
  assert.equal(zone.scrollTop, 1280);
  assert.equal(bouton.hidden, false, "« Nouveaux messages ↓ » apparaît");
});

test("contrôleur : un défilement venu d'ailleurs (pas de geste) est corrigé tant que Nani est en bas ; revenue en bas, le bouton part", async () => {
  const { suivreFil } = await D();
  installerGlobaux();
  const { zone } = zoneSimulee();
  const bouton = { hidden: true, addEventListener() {} };
  const ctrl = suivreFil(zone, { bouton });
  ctrl.bas();
  zone.defiler(0);
  assert.equal(zone.scrollTop, 2500, "remis en bas");
  ctrl.garder({ position: 1000, rang: -1 }, { annoncer: true });
  assert.equal(bouton.hidden, false);
  zone.defiler(2490);
  assert.equal(ctrl.colle, true);
  assert.equal(bouton.hidden, true);
});

test("contrôleur : les éléments retirés du fil ne sont plus observés (zone de l'Assistant réutilisée)", async () => {
  const { suivreFil } = await D();
  const g = installerGlobaux();
  const suivis = new Set();
  global.ResizeObserver = class {
    observe(n) {
      suivis.add(n);
    }
    unobserve(n) {
      suivis.delete(n);
    }
    disconnect() {}
  };
  const { zone } = zoneSimulee({ enfants: 3 });
  const ctrl = suivreFil(zone, {});
  assert.equal(suivis.size, 4, "la zone et ses trois éléments");
  const ancien = zone.children.splice(0, 3);
  for (const n of ancien) n.parentNode = null; // retirés du DOM
  zone.children.push({ parentNode: zone, getBoundingClientRect: () => ({ top: 0, bottom: 10, height: 10 }) });
  ctrl.observer();
  assert.equal(suivis.size, 2, "les trois anciens éléments sont oubliés");
  assert.ok(!ancien.some((n) => suivis.has(n)));
  void g;
});

test("écrans : WhatsApp sans « min-width: 900px » pour descendre, bulles reprises, place réservée ; Assistant suivi de la même façon", () => {
  const wa = source("src/gestion/js/views/whatsapp.mjs");
  assert.doesNotMatch(wa, /matchMedia\("\(min-width: 900px\)"\)\.matches\) zone && \(zone\.scrollTop = zone\.scrollHeight\)/, "plus de descente réservée au bureau");
  assert.match(wa, /racine\.apresInsertion = \(\) =>/, "position rendue juste après la mise en place, avant l'affichage");
  assert.match(wa, /reprendreBulles\(ancienneZone, zone\)/, "un message reçu ne recharge pas les photos déjà affichées");
  assert.match(wa, /style: `--ratio: \$\{ratioMedia\(media\)\}`/);
  assert.match(wa, /ouvrirVisionneuse\(/, "la photo s'ouvre par-dessus la conversation");
  assert.match(wa, /if \(agrandissement\) return;/, "un second toucher n'ouvre pas une deuxième photo");
  assert.match(wa, /messages\[messages\.length - 1\]\.origine === "gestion"/, "seul un envoi depuis Gestion ramène en bas une lecture plus haut");
  assert.match(source("src/gestion/js/visionneuse.mjs"), /if \(ouverte\) return ouverte;/);
  assert.doesNotMatch(wa, /zone\.replaceWith\(h\("img"/, "plus de zone d'attente remplacée par une image de taille inconnue");
  const app = source("src/gestion/js/app.mjs");
  assert.match(app, /if \(typeof noeud\.apresInsertion === "function"\) noeud\.apresInsertion\(\);/);
  const ag = source("src/gestion/js/views/agent.mjs");
  assert.match(ag, /suivreFil\(zoneFil, \{ bouton: boutonNouveaux \}\)/);
  assert.doesNotMatch(ag, /zoneFil\.scrollTop = zoneFil\.scrollHeight/, "plus de descente forcée à chaque morceau de réponse");
  assert.match(ag, /descendre\(\{ forcer: true \}\);\n/, "la personne vient d'écrire : en bas");
});

test("démonstration : une conversation de 18 photos dessinées, numéro de fiction, images aux bonnes dimensions", async () => {
  const { conversationPhotos, imagePhotoDemo } = await import("../src/gestion/js/demo-photos.mjs");
  let n = 0;
  const { whatsapp_conversations: [c], whatsapp_messages: m } = conversationPhotos({ secret: { id: "s" }, uid: () => `id${n++}`, organisation: "o", maintenant: Date.parse("2026-11-23T10:00:00Z") });
  const photos = m.filter((x) => x.type === "image");
  assert.equal(photos.length, 18);
  assert.match(c.telephone, /^\+447700900/, "plage réservée à la fiction");
  assert.ok(photos.some((x) => x.medias[0].largeur) && photos.some((x) => !x.medias[0].largeur), "avec et sans dimensions");
  const url = imagePhotoDemo(photos[0].medias[0].chemin);
  assert.match(url, /^data:image\/svg\+xml/);
  assert.match(decodeURIComponent(url), /width="900" height="1200"/);
  assert.equal(imagePhotoDemo("org/conv/msg/1.jpg"), null, "un vrai chemin n'a jamais d'image de démonstration");
  assert.equal(m[m.length - 1].envoye_le, c.dernier_message_le);
});

test("textes anglais : les nouveaux libellés sont traduits", async () => {
  const { EN } = await import("../src/gestion/js/i18n-en.mjs");
  for (const k of ["Nouveaux messages", "Ouvrir l'original", "Photo envoyée par le client", "Fermer", "Photo"]) assert.ok(EN[k], k);
});
