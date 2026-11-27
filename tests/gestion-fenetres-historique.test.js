// tests/gestion-fenetres-historique.test.js : fenêtres (feuilles, menus, confirmations) et retour arrière du navigateur.
// Défaut relevé sur la preview groupée (PR 365) et en production : une feuille restait affichée par-dessus l'écran suivant
// après un retour arrière ou un lien. Puis relecture de la PR 363 : filtre perdu au retour, Avancer cassé, entrée fantôme
// après rechargement, navigation annulée, Échap de la visionneuse.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const load = () => import("../src/gestion/js/fenetres-historique-calc.mjs");
const source = (f) => fs.readFileSync(path.join(__dirname, "..", "src", "gestion", "js", f), "utf8");

// Entrées d'un écran « R » : l'écran (rang 0), une feuille 1 au-dessus.
const ECRAN = { gestionEntree: 3, ecran: "R" };
const FEUILLE = (n, rang = n) => ({ gestionEntree: 3, ecran: "R", feuille: n, rang });

test("retour arrière : la fenêtre du dessus se ferme, l'écran reste", async () => {
  const { fermeturesAuRetour } = await load();
  assert.deepEqual(fermeturesAuRetour([{ n: 1, ecran: "R", modifie: false }], ECRAN), { quitter: [], fermer: [1], demander: null });
  // Rien d'ouvert : rien à fermer, le retour quitte l'écran comme avant.
  assert.deepEqual(fermeturesAuRetour([], ECRAN), { quitter: [], fermer: [], demander: null });
  // Retour vers un autre écran (entrée de la feuille déjà retirée) : la feuille se ferme en quittant l'écran, saisie en brouillon.
  assert.deepEqual(fermeturesAuRetour([{ n: 1, ecran: "R", modifie: true }], { gestionEntree: 2 }), { quitter: [1], fermer: [], demander: null });
});

test("retour arrière : des fenêtres empilées se ferment dans l'ordre, une saisie demande confirmation", async () => {
  const { fermeturesAuRetour } = await load();
  const pile = [{ n: 2, ecran: "R", modifie: false }, { n: 3, ecran: "R", modifie: false }];
  // « Réservation et voucher » (2) puis « Confirmation » (3) : le retour revient sur l'entrée 2, seule la confirmation se ferme.
  assert.deepEqual(fermeturesAuRetour(pile, FEUILLE(2)), { quitter: [], fermer: [3], demander: null });
  // Un saut de deux entrées (history.go(-2)) ferme les deux, celle du dessus d'abord.
  assert.deepEqual(fermeturesAuRetour(pile, ECRAN), { quitter: [], fermer: [3, 2], demander: null });
  // Saisie non enregistrée : confirmation, les fenêtres du dessous restent.
  assert.deepEqual(fermeturesAuRetour([{ n: 5, ecran: "R", modifie: true }, { n: 6, ecran: "R", modifie: false }], ECRAN), { quitter: [], fermer: [6], demander: 5 });
});

test("point 1 : un filtre choisi dans la feuille reste au retour (même écran, adresse réécrite)", async () => {
  const { adresseApresDeplacement, memeEcran } = await load();
  const vue = "https://x/gestion/?demo#/reservations?statut=annule";
  const entree = "https://x/gestion/?demo#/reservations";
  // Retour de la feuille Filtrer vers l'écran : on garde l'adresse filtrée (2 cartes), pas l'ancienne (21 cartes).
  assert.equal(adresseApresDeplacement(FEUILLE(1), ECRAN, vue, entree), vue);
  // Assistant : #/agent/nouvelle réécrit en #/agent/<id> pendant qu'une fenêtre est ouverte, la conversation reste.
  assert.equal(adresseApresDeplacement(FEUILLE(1), ECRAN, "https://x/#/agent/42", "https://x/#/agent/nouvelle"), "https://x/#/agent/42");
  // Autre écran : l'adresse de l'entrée atteinte.
  assert.equal(adresseApresDeplacement(FEUILLE(1), { gestionEntree: 2 }, vue, "https://x/#/dossiers"), "https://x/#/dossiers");
  // Deux écrans sans étiquette (numéros d'entrée réutilisés après un rechargement) ne sont jamais pris pour le même écran.
  assert.equal(memeEcran({ gestionEntree: 3 }, { gestionEntree: 3 }), false);
});

test("point 1 : l'adresse d'une fenêtre suit les réécritures, un hashchange simulé ne la ferme pas", async () => {
  const { fermeturesAuChangementDEcran } = await load();
  assert.deepEqual(fermeturesAuChangementDEcran([{ n: 1, hash: "#/reservations?statut=annule" }], "#/reservations?statut=annule"), []);
  assert.deepEqual(fermeturesAuChangementDEcran([{ n: 1, hash: "#/whatsapp?c=1" }, { n: 2, hash: "#/whatsapp?c=1" }, { n: 3, hash: "#/dossier/9" }], "#/dossier/9"), [2, 1]);
  const ui = source("ui.mjs");
  assert.match(ui, /if \(location\.hash !== avant\) for \(const f of pileFenetres\) if \(f\.hash === avant\) f\.hash = location\.hash;/);
  assert.match(ui, /if \(!e\.newURL\) return; \/\/ hashchange simulé/);
});

test("point 2 : fermer puis naviguer, Avancer retrouve l'écran suivant (pas de history.back() différé)", async () => {
  const { entreeApresFermeture, pasSuivant } = await load();
  // « Messages types » : le menu se ferme (son entrée devient un fantôme), puis #/messages est ajouté au-dessus.
  const fantome = entreeApresFermeture(FEUILLE(4, 10), 4);
  assert.deepEqual(fantome, { gestionEntree: 3, ecran: "R", rang: 10, fantome: true });
  // Retour depuis #/messages : on arrive sur le fantôme (autre écran) : l'écran Réservations s'affiche, on s'arrête.
  assert.equal(pasSuivant({ gestionEntree: 9 }, fantome, []), null);
  // Retour du fantôme vers l'écran : rien n'a changé, on continue vers l'écran d'avant.
  assert.equal(pasSuivant(fantome, ECRAN, []), "retour");
  // Avancer depuis l'écran : on tombe sur le fantôme, on continue jusqu'à #/messages.
  assert.equal(pasSuivant(ECRAN, fantome, []), "avance");
  // Entre deux entrées vivantes du même écran, aucun pas de plus.
  assert.equal(pasSuivant(FEUILLE(4, 10), ECRAN, [4]), null);
  assert.doesNotMatch(source("ui.mjs"), /setTimeout\([^)]*history\.back/);
});

test("point 2 : les pas automatiques gardent leur sens (pas d'aller-retour entre deux entrées de même rang)", async () => {
  const { pasSuivant, PAS_MAX } = await load();
  // Ancienne entrée de la visionneuse et entrée d'une fenêtre fermée, au même rang : sans le sens gardé, on repartait vers l'avant.
  const vis = { ecran: "R", feuille: 2, rang: 20, visionneuse: true };
  const vide = { ecran: "R", feuille: 2, rang: 20 };
  assert.equal(pasSuivant(vide, vis, [], "retour"), "retour");
  // Un pas déjà en cours traverse aussi une ancienne entrée de photo ; seul le premier pas, celui de la personne, s'arrête en la quittant.
  assert.equal(pasSuivant(vis, vide, [], "retour"), "retour");
  assert.equal(pasSuivant(vis, vide, []), null);
  assert.equal(pasSuivant(vide, ECRAN, [], "retour"), "retour");
  // Arrivé sur un autre écran : on s'arrête.
  assert.equal(pasSuivant(ECRAN, { gestionEntree: 2 }, [], "retour"), null);
  assert.ok(PAS_MAX >= 4 && PAS_MAX <= 20);
  assert.match(source("ui.mjs"), /pasEnCours = pas && fait <= PAS_MAX \?/);
  // Toute entrée ajoutée prend un rang croissant (visionneuse comprise).
  assert.match(source("ui.mjs"), /ajouterNatif\(entreeAjoutee\(etat, \+\+rangHist\), titre, url\)/);
});

test("A : fermer une photo posée sur un fantôme ne quitte pas l'écran", async () => {
  const { entreeAjoutee, pasSuivant } = await load();
  const fantome = { gestionEntree: 3, ecran: "R", rang: 10, fantome: true };
  // La visionneuse recopie l'entrée du dessous : la marque fantôme ne la suit plus.
  const photo = entreeAjoutee({ ...fantome, visionneuse: true }, 11);
  assert.deepEqual(photo, { gestionEntree: 3, ecran: "R", rang: 11, visionneuse: true });
  // Retour ou bouton Fermer de la photo : on arrive sur le fantôme, aucun pas de plus (avant : #/clients → #/dossiers).
  assert.equal(pasSuivant(photo, fantome, [], null, false), null);
  assert.equal(pasSuivant({ ...photo, fantome: true }, fantome, [], null, false), null);
  assert.match(source("visionneuse.mjs"), /const \{ fantome, premiere, \.\.\.dessous \} = history\.state \|\| \{\};\s*history\.pushState\(\{ \.\.\.dessous, visionneuse: true \}, ""\);/);
});

test("C : Avancer sur une ancienne entrée de la visionneuse (photo fermée) continue d'un pas", async () => {
  const { entreeVide, pasSuivant } = await load();
  const photo = { gestionEntree: 3, ecran: "R", rang: 11, visionneuse: true };
  assert.equal(entreeVide(photo, [], false), true);
  // Photo encore ouverte : son entrée est vivante.
  assert.equal(entreeVide(photo, [], true), false);
  assert.equal(pasSuivant(ECRAN, photo, [], null, false), "avance");
  assert.equal(pasSuivant(ECRAN, photo, [], null, true), null);
});

test("D : les fantômes ne s'empilent pas (une entrée ajoutée n'en est jamais un, une fenêtre reprend le fantôme)", async () => {
  const { entreeAjoutee, entreePourOuverture, entreeApresFermeture } = await load();
  assert.equal(entreeAjoutee({ ecran: "R", fantome: true }, 5).fantome, undefined);
  // Ouvrir puis fermer en boucle : la même entrée passe de fenêtre à fantôme, jamais une de plus.
  let etat = ECRAN;
  let ajoutees = 0;
  for (let n = 1; n <= 20; n++) {
    const o = entreePourOuverture(etat, n, [], 100 + n, "x");
    if (!o.remplacer) ajoutees++;
    etat = entreeApresFermeture(o.etat, n);
  }
  assert.equal(ajoutees, 1);
  assert.equal(etat.fantome, true);
});

test("E : aucun pas automatique en arrière depuis la première entrée de Gestion (app installée)", async () => {
  const { pasSuivant, entreeAuDemarrage, entreePourOuverture, entreeAjoutee } = await load();
  const premiere = { ...ECRAN, premiere: true };
  const fantome = { gestionEntree: 3, ecran: "R", rang: 10, fantome: true };
  assert.equal(pasSuivant(fantome, premiere, []), null);
  assert.equal(pasSuivant(fantome, ECRAN, []), "retour");
  // Lancement : la première entrée est marquée ; un rechargement garde la marque, une fenêtre ou une photo ne la recopie pas.
  assert.deepEqual(entreeAuDemarrage(null, true), { premiere: true });
  assert.deepEqual(entreeAuDemarrage({ gestionEntree: 1 }, true), { gestionEntree: 1, premiere: true });
  assert.equal(entreeAuDemarrage(premiere, true), null);
  assert.equal(entreePourOuverture(premiere, 1, [], 2, "x").etat.premiere, undefined);
  assert.equal(entreeAjoutee(premiere, 2).premiere, undefined);
  assert.match(source("ui.mjs"), /const premiere = lancement && \(history\.length === 1 \|\| !document\.referrer\.startsWith\(location\.origin\)\);/);
});

test("point 2 : une fenêtre enchaînée reprend le fantôme, une confirmation s'ajoute au-dessus", async () => {
  const { entreePourOuverture } = await load();
  const fantome = { gestionEntree: 3, ecran: "R", rang: 10, fantome: true };
  assert.deepEqual(entreePourOuverture(fantome, 8, [], 11, "neuve"), { etiquetterEcran: false, remplacer: true, etat: { gestionEntree: 3, ecran: "R", feuille: 8, rang: 11 } });
  assert.deepEqual(entreePourOuverture(FEUILLE(7, 10), 8, [7], 11, "neuve"), { etiquetterEcran: false, remplacer: false, etat: { gestionEntree: 3, ecran: "R", feuille: 8, rang: 11 } });
  // Première fenêtre d'un écran : l'entrée de l'écran reçoit son étiquette.
  assert.deepEqual(entreePourOuverture({ gestionEntree: 3 }, 1, [], 11, "neuve"), { etiquetterEcran: true, remplacer: false, etat: { gestionEntree: 3, ecran: "neuve", feuille: 1, rang: 11 } });
});

test("point 3 : rechargement avec une fenêtre ouverte, l'entrée devient un fantôme", async () => {
  const { entreeAuDemarrage, entreeVide, pasSuivant } = await load();
  const apres = entreeAuDemarrage(FEUILLE(2, 10));
  assert.deepEqual(apres, { gestionEntree: 3, ecran: "R", rang: 10, fantome: true });
  assert.equal(entreeAuDemarrage(ECRAN), null);
  assert.equal(entreeAuDemarrage({ ...FEUILLE(2), visionneuse: true }), null);
  // Un seul retour quitte l'écran.
  assert.equal(pasSuivant(apres, ECRAN, []), "retour");
  // Une entrée de fenêtre fermée (rechargement, ou fermée sous une autre) compte comme vide.
  assert.equal(entreeVide(FEUILLE(2), []), true);
  assert.equal(entreeVide(FEUILLE(2), [2]), false);
  // Entrée de la visionneuse : vivante tant que la photo est ouverte, vide ensuite (point C de la relecture finale).
  assert.equal(entreeVide({ ...FEUILLE(2), visionneuse: true }, [], true), false);
  assert.match(source("ui.mjs"), /const depart = entreeAuDemarrage\(history\.state, premiere\);/);
});

test("point 4 : aucune navigation différée qui pourrait annuler celle de la personne", () => {
  const ui = source("ui.mjs");
  const bloc = ui.slice(ui.indexOf("// ---- Fenêtres et historique"), ui.indexOf("const valeurDe"));
  // Plus de retour programmé après coup : seuls les pas de plus, en réponse immédiate à un retour ou un Avancer.
  assert.ok(bloc.length > 1000);
  assert.doesNotMatch(bloc, /setTimeout\(/);
  assert.match(ui, /if \(pas === "retour"\) history\.back\(\);\s*else history\.forward\(\);/);
});

test("point 5 : Échap sur la visionneuse ferme la photo seulement", () => {
  assert.match(source("visionneuse.mjs"), /if \(e\.key === "Escape"\) return void \(e\.preventDefault\(\), e\.stopPropagation\(\), fermer\(\)\);/);
  // La visionneuse écoute en capture, la fenêtre du dessous en bouillonnement : stopPropagation suffit.
  assert.match(source("visionneuse.mjs"), /document\.addEventListener\("keydown", surTouche, true\)/);
});

test("modal() suit l'historique : une entrée par fenêtre, fantôme à la fermeture, brouillon en quittant l'écran", () => {
  const ui = source("ui.mjs");
  assert.match(ui, /const ecran = entrerHistorique\(n\);\s*placeDansPile = \{ n, ecran, hash: location\.hash,/);
  assert.match(ui, /sortirHistorique\(placeDansPile\.n\)/);
  assert.match(ui, /quitterEcran: \(\) => \(modifie\(\) \? \(garderBrouillon\(\), fermer\(true\)\) : fermer\(\)\)/);
  assert.ok(ui.indexOf("if (cache) return fermer;") < ui.indexOf("const ecran = entrerHistorique(n);"));
});
