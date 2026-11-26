// tests/gestion-mobile.test.js : calculs purs des composants mobiles (tri, filtres, pagination, clavier, brouillon, saisies).
const test = require("node:test");
const assert = require("node:assert/strict");
const load = () => import("../src/gestion/js/mobile-calc.mjs");

test("hauteurClavier : mesure ce que le clavier a pris, ignore le zoom et la barre d'adresse", async () => {
  const { hauteurClavier } = await load();
  assert.equal(hauteurClavier(812, { height: 812, offsetTop: 0, scale: 1 }), 0);
  assert.equal(hauteurClavier(812, { height: 520, offsetTop: 0, scale: 1 }), 292);
  // Le décalage du viewport visuel (offsetTop) est une position, pas une perte : la hauteur du clavier n'en dépend pas. Sinon, sur une page
  // courte (nouvelle discussion de l'Assistant), iOS décale la page, la hauteur change, la page change de hauteur, iOS redécale : boucle
  // relevée sur simulateur le 26.11.2026 (714 / 377, décalage 337 puis 125, --clavier 0 puis 212 px, des centaines de fois par seconde).
  assert.equal(hauteurClavier(812, { height: 480, offsetTop: 40, scale: 1 }), 332, "le décalage d'iOS ne change pas la hauteur du clavier");
  assert.equal(hauteurClavier(714, { height: 377, offsetTop: 337, scale: 1 }), 337);
  assert.equal(hauteurClavier(714, { height: 377, offsetTop: 125, scale: 1 }), 337);
  // App installée (PWA) : iOS réduit parfois aussi la fenêtre (innerHeight 409 = la hauteur visible). La référence est la plus grande
  // hauteur vue pour cette largeur (relevé du simulateur, 26.11.2026 : 812 puis 409).
  assert.equal(hauteurClavier(409, { height: 409, offsetTop: 0, scale: 1 }, 812), 403);
  assert.equal(hauteurClavier(812, { height: 812, offsetTop: 0, scale: 1 }, 812), 0);
  assert.equal(hauteurClavier(760, { height: 760, offsetTop: 0, scale: 1 }, 812), 0, "barre d'adresse : pas un clavier");
  assert.equal(hauteurClavier(812, { height: 760, offsetTop: 0, scale: 1 }), 0, "barre d'adresse : pas un clavier");
  assert.equal(hauteurClavier(812, { height: 400, offsetTop: 0, scale: 2 }), 0, "pincement : pas un clavier");
  assert.equal(hauteurClavier(812, null), 0);
});

test("trier : nombres, textes à la française, vides à la fin dans les deux sens, tri stable", async () => {
  const { trier } = await load();
  const lignes = [{ n: "Élodie", m: 10 }, { n: "Zoé", m: null }, { n: "Abel", m: 100 }, { n: "Eve", m: 10 }, { n: "client 10", m: 5 }, { n: "client 9", m: 7 }];
  assert.deepEqual(trier(lignes, (x) => x.m).map((x) => x.n), ["client 10", "client 9", "Élodie", "Eve", "Abel", "Zoé"]);
  assert.deepEqual(trier(lignes, (x) => x.m, true).map((x) => x.n), ["Abel", "Élodie", "Eve", "client 9", "client 10", "Zoé"]);
  assert.deepEqual(trier(lignes, (x) => x.n).map((x) => x.n).slice(0, 4), ["Abel", "client 9", "client 10", "Élodie"], "9 avant 10, É près de E");
  assert.equal(lignes[0].n, "Élodie", "la liste d'origine n'est pas modifiée");
  assert.deepEqual(trier(lignes, null).map((x) => x.n), lignes.map((x) => x.n));
});

test("tranche : cinquante lignes à la fois, puis cinquante de plus", async () => {
  const { tranche } = await load();
  const items = Array.from({ length: 120 }, (_, i) => i);
  assert.deepEqual([tranche(items, 50).visibles.length, tranche(items, 50).reste], [50, 70]);
  assert.deepEqual([tranche(items, 50, 3).visibles.length, tranche(items, 50, 3).reste], [120, 0]);
  assert.deepEqual([tranche(items, 50, 9).visibles.length, tranche(items, 50, 9).total], [120, 120]);
  assert.deepEqual(tranche([], 50), { visibles: [], reste: 0, total: 0 });
});

test("compterFiltres : ne compte que les filtres de la feuille éloignés de leur valeur neutre", async () => {
  const { compterFiltres, filtreActif } = await load();
  const defs = [{ cle: "pays", neutre: "" }, { cle: "partenaire", neutre: "tous" }, { cle: "du", neutre: "" }];
  assert.equal(compterFiltres(defs, { pays: "", partenaire: "tous", du: "" }), 0);
  assert.equal(compterFiltres(defs, { pays: "Bali", partenaire: "tous", du: "2026-11-01" }), 2);
  assert.equal(compterFiltres(defs, { pays: "Bali", partenaire: "p1", du: "x" }), 3);
  assert.equal(filtreActif([]), false);
  assert.equal(filtreActif(["a"]), true);
  assert.equal(filtreActif(null), false);
});

test("correspond : tous les mots, sans accents ni casse", async () => {
  const { correspond } = await load();
  assert.equal(correspond("Hélène Marchand HM20261110 Thaïlande", "helene thai"), true);
  assert.equal(correspond("Hélène Marchand", "helene bali"), false);
  assert.equal(correspond("n'importe quoi", "   "), true);
});

test("brouillon : rendu seulement si le nombre de champs est le même", async () => {
  const { lireBrouillon, ecrireBrouillon, aChange } = await load();
  const brut = ecrireBrouillon(["Anna", "", "1"]);
  assert.deepEqual(lireBrouillon(brut, 3), ["Anna", "", "1"]);
  assert.equal(lireBrouillon(brut, 4), null);
  assert.equal(lireBrouillon("pas du json", 3), null);
  assert.equal(lireBrouillon(null, 3), null);
  assert.equal(aChange(["a", ""], ["a", ""]), false);
  assert.equal(aChange(["a", ""], ["a", "x"]), true);
  assert.equal(aChange(["a"], ["a", ""]), false, "un champ apparu vide n'est pas une saisie");
  assert.equal(aChange(["a"], ["a", "x"]), true);
});

test("saisies : le bon clavier iOS pour chaque sens de champ", async () => {
  const { SAISIES } = await load();
  assert.equal(SAISIES.tel.type, "tel");
  assert.equal(SAISIES.email.inputmode, "email");
  assert.equal(SAISIES.montant.inputmode, "decimal");
  assert.equal(SAISIES.entier.inputmode, "numeric");
  assert.equal(SAISIES.date.type, "date");
  assert.equal(SAISIES.recherche.enterkeyhint, "search");
  assert.equal(SAISIES.email.autocapitalize, "none");
  for (const [nom, r] of Object.entries(SAISIES)) assert.ok(r.type, `${nom} a un type`);
});

test("basVisible : distance au bas visible pour placer les barres, 0 sans clavier ou quand iOS a décalé la page", async () => {
  const { basVisible } = await load();
  // Relevés du simulateur (iPhone 17, iOS 26.5) : page courte décalée de 337 px, page qui défile encore, sans clavier, zoom.
  assert.equal(basVisible(714, { height: 377, offsetTop: 337, scale: 1 }), 0);
  assert.equal(basVisible(714, { height: 377, offsetTop: 125, scale: 1 }), 212);
  assert.equal(basVisible(714, { height: 377, offsetTop: 0, scale: 1 }), 337);
  assert.equal(basVisible(714, { height: 714, offsetTop: 0, scale: 1 }), 0);
  assert.equal(basVisible(714, { height: 300, offsetTop: 0, scale: 2 }), 0);
  assert.equal(basVisible(714, null), 0);
  // App installée : fenêtre réduite à 619 et vue décalée de 305 pour 409 visibles (référence 812) : -95, les barres descendent d'autant.
  assert.equal(basVisible(619, { height: 409, offsetTop: 305, scale: 1 }, 812), -95);
});

test("clavier ouvert : la barre des Réglages et les en-têtes de discussion suivent la partie visible (app installée, 26.11.2026)", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "../src/gestion/css/app.css"), "utf8");
  assert.match(css, /html\.clavier \.barre-fixe \{ bottom: calc\(var\(--clavier\) \+ 8px\); \}/);
  assert.match(css, /html\.clavier \.agent-fil-tete, html\.clavier \.wa-fil-tete \{ top: var\(--haut-visible, 0px\); \}/);
  const ui = fs.readFileSync(path.join(__dirname, "../src/gestion/js/ui.mjs"), "utf8");
  assert.match(ui, /--haut-visible/);
  assert.doesNotMatch(ui, /DEBUG-CLAVIER/);
});
