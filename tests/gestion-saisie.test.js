// Saisie en cours (19.11.2026) : Jérémy voyait « Une saisie est en cours : elle sera perdue si vous rechargez maintenant » sans rien avoir en
// cours, et la nouvelle version ne s'installait jamais. Cause : l'outil comparait chaque champ à sa valeur « d'origine » selon le navigateur
// (defaultValue, defaultSelected), qu'il ne tient pas à jour ; une fiche dossier ou client ouverte sans rien toucher comptait comme une saisie,
// et toute liste déroulante aussi. Désormais : un champ visible changé par la personne et pas encore enregistré, rien d'autre.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { signatureChamp, champHorsSaisie, champModifie, ZONES_HORS_SAISIE } from "../src/gestion/js/saisie-calc.mjs";

const source = (f) => fs.readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");

test("un champ que l'outil a rempli lui-même et que personne n'a touché n'est pas une saisie (fiche dossier, fiche client)", () => {
  // Pas d'origine notée : personne n'a fait de geste sur ce champ, quelle que soit sa valeur (montant proposé, nom du client, date du jour).
  assert.equal(champModifie(undefined, signatureChamp({ type: "number", value: "195" })), false);
  assert.equal(champModifie(undefined, signatureChamp({ type: "date", value: "2026-11-19" })), false);
  assert.equal(champModifie(undefined, signatureChamp({ type: "select-one", value: "virement" })), false, "une liste réglée par l'outil");
});

test("un champ touché puis laissé tel quel n'est pas une saisie ; changé, il l'est", () => {
  const origine = signatureChamp({ type: "number", value: "195" });
  assert.equal(champModifie(origine, signatureChamp({ type: "number", value: "195" })), false, "clic dans le montant, rien changé");
  assert.equal(champModifie(origine, signatureChamp({ type: "number", value: "999" })), true, "montant tapé");
  assert.equal(champModifie(origine, signatureChamp({ type: "number", value: "195" })), false, "remis comme avant : plus de saisie");
  const caseO = signatureChamp({ type: "checkbox", checked: false });
  assert.equal(champModifie(caseO, signatureChamp({ type: "checkbox", checked: true })), true, "case cochée");
  assert.equal(signatureChamp({ isContentEditable: true, textContent: "abc" }), "t:abc");
  const multi = { multiple: true, options: [{ value: "a", selected: true }, { value: "b", selected: false }] };
  assert.equal(signatureChamp(multi), "m:a");
});

test("recherche, filtres, tris, onglets, choix de l'entreprise ou de la langue ne sont jamais une saisie", () => {
  assert.equal(champHorsSaisie({ type: "search" }), true, "recherche globale et recherche d'une liste");
  assert.equal(champHorsSaisie({ type: "text", role: "combobox" }), true, "Chercher un client existant");
  for (const id of ["tri-liste", "filtre-b-0", "filtre-recherche", "recherche-client"]) assert.equal(champHorsSaisie({ type: "select-one", id }), true, id);
  assert.equal(champHorsSaisie({ type: "select-one", dansZoneHorsSaisie: true }), true, "menu (entreprise), barre de filtres, onglets, palette");
  for (const z of [".barre-filtres", ".feuille-filtres", ".puces", ".palette-fond", ".menu", ".barre-haut", ".langues", ".combo", "[data-pas-saisie]"]) assert.ok(ZONES_HORS_SAISIE.includes(z), z);
  assert.equal(champHorsSaisie({ type: "text", id: "c-tel" }), false, "le téléphone d'une fiche client reste une saisie");
  assert.equal(champHorsSaisie({ type: "textarea", id: "cc-texte" }), false, "le texte collé d'une confirmation aussi");
});

// Un petit DOM factice : assez pour exécuter saisie.mjs (sélecteurs simples, parents, visibilité, événements à la capture).
class El {
  constructor(tag, attrs = {}, enfants = []) {
    this.tagName = tag.toUpperCase(); this.nodeType = 1; this.attrs = { ...attrs }; this.enfants = []; this.parent = null; this.rect = true;
    this.value = attrs.value ?? ""; this.checked = !!attrs.checked; this.type = (attrs.type || (tag === "textarea" ? "textarea" : tag === "select" ? "select-one" : tag === "input" ? "text" : "")).toLowerCase();
    this.id = attrs.id || ""; this.className = attrs.class || ""; this.isContentEditable = attrs.contenteditable === "true";
    for (const e of enfants) this.ajouter(e);
  }
  ajouter(e) { e.parent = this; this.enfants.push(e); return e; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n === racine; }
  getClientRects() { return this.rect ? [1] : []; }
  tous() { return this.enfants.flatMap((e) => [e, ...e.tous()]); }
  matches(sel) { return sel.split(/,(?![^\[]*\])/).some((s) => this.un(s.trim())); }
  un(s) {
    const non = s.match(/^(.*):not\((.*)\)$/);
    if (non) return this.un(non[1]) && !this.un(non[2]);
    const m = s.match(/^([a-z]*)(#[\w-]+)?((?:\.[\w-]+)*)(?:\[([\w-]+)(?:='([^']*)')?\])?$/i);
    if (!m) return false;
    const [, tag, id, classes, attr, val] = m;
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    if (id && this.id !== id.slice(1)) return false;
    if (classes && !classes.split(".").filter(Boolean).every((c) => this.className.split(" ").includes(c))) return false;
    if (attr && !(attr in this.attrs && (val === undefined || this.attrs[attr] === val))) return false;
    return !!(tag || id || classes || attr);
  }
  closest(sel) { let n = this; while (n && n.nodeType === 1) { if (n.matches(sel)) return n; n = n.parent; } return null; }
  querySelectorAll(sel) { return this.tous().filter((e) => e.matches(sel)); }
  get control() { return this.attrs.for ? racine.tous().find((e) => e.id === this.attrs.for) : null; }
}
const racine = new El("html");
const ecouteurs = {};
const doc = {
  addEventListener: (t, f) => (ecouteurs[t] = f),
  getElementById: (id) => racine.tous().find((e) => e.id === id) || null,
  querySelectorAll: (sel) => racine.querySelectorAll(sel),
  activeElement: null,
};
const geste = (type, cible) => ecouteurs[type] && ecouteurs[type]({ type, target: cible });

test("saisie.mjs exécuté : fiche ouverte intacte, champ changé, recherche, fenêtre masquée, libellé, écran touché", async () => {
  const { suivreSaisies, champsModifies, curseurDansUnChamp, nouvelEcran, ecranTouche } = await import("../src/gestion/js/saisie.mjs");
  const montant = new El("input", { id: "p-montant", type: "number", value: "195" });
  const liste = new El("select", { id: "p-moyen", value: "virement" });
  const recherche = new El("input", { id: "filtre-recherche", type: "search" });
  const filtre = new El("select", { id: "x1" });
  const caseRappel = new El("input", { id: "rappel", type: "checkbox" });
  const libelle = new El("label", { for: "rappel" });
  const principal = racine.ajouter(new El("div", { id: "principal" }, [montant, liste, new El("div", { class: "barre-filtres" }, [recherche, filtre]), caseRappel, libelle]));
  const texteFenetre = new El("textarea", { id: "cc-texte" });
  const fenetreMasquee = racine.ajouter(new El("div", { class: "modal-fond", hidden: "" }, [new El("textarea", { id: "vieille" })]));
  const fenetre = racine.ajouter(new El("div", { class: "modal-fond" }, [texteFenetre]));
  const entreprise = racine.ajouter(new El("nav", { class: "menu" }, [new El("select", { id: "entite" })]));
  suivreSaisies(doc);
  assert.ok(!("focusin" in ecouteurs), "le focus donné par l'outil ne note rien");
  nouvelEcran();
  assert.deepEqual(champsModifies(doc), [], "fiche ouverte, valeurs posées par l'outil : rien");
  assert.equal(ecranTouche(), false);
  // L'outil change une valeur sans geste de la personne (liste réglée après chargement) : toujours rien.
  liste.value = "especes";
  assert.deepEqual(champsModifies(doc), []);
  // Clic dans le montant sans rien changer : rien. Montant tapé : saisie.
  geste("pointerdown", montant);
  assert.deepEqual(champsModifies(doc), []);
  assert.equal(ecranTouche(), true, "un geste sur l'écran le marque touché");
  montant.value = "999";
  assert.deepEqual(champsModifies(doc).map((c) => c.id), ["p-montant"]);
  montant.value = "195";
  assert.deepEqual(champsModifies(doc), [], "remis comme avant");
  // Recherche et filtre changés par la personne : jamais une saisie.
  geste("keydown", recherche); recherche.value = "Rochat";
  geste("pointerdown", filtre); filtre.value = "payes";
  assert.deepEqual(champsModifies(doc), []);
  // Case cochée par son libellé.
  geste("pointerdown", libelle); caseRappel.checked = true;
  assert.deepEqual(champsModifies(doc).map((c) => c.id), ["rappel"]);
  caseRappel.checked = false;
  // Texte collé dans une fenêtre ouverte : saisie ; fenêtre fermée (retirée) : plus rien.
  geste("beforeinput", texteFenetre); texteFenetre.value = "Name: Test";
  assert.deepEqual(champsModifies(doc).map((c) => c.id), ["cc-texte"]);
  racine.enfants = racine.enfants.filter((e) => e !== fenetre); fenetre.parent = null;
  assert.deepEqual(champsModifies(doc), []);
  // Fenêtre restée dans la page mais masquée : jamais.
  const vieille = fenetreMasquee.enfants[0];
  geste("pointerdown", vieille); vieille.value = "oubli";
  assert.deepEqual(champsModifies(doc), []);
  // Champ hors affichage (bloc replié) : jamais.
  geste("pointerdown", montant); montant.value = "1"; montant.rect = false;
  assert.deepEqual(champsModifies(doc), []);
  montant.rect = true; montant.value = "195";
  // Curseur : dans un champ de l'écran oui (on ne redessine pas sous la frappe), dans le menu non.
  doc.activeElement = recherche; assert.equal(curseurDansUnChamp(doc), true);
  doc.activeElement = entreprise.enfants[0]; assert.equal(curseurDansUnChamp(doc), false);
  // Nouvel écran : plus touché.
  nouvelEcran(); assert.equal(ecranTouche(), false);
  geste("pointerdown", entreprise.enfants[0]); assert.equal(ecranTouche(), false, "le menu ne touche pas l'écran");
  assert.ok(principal.isConnected);
});

test("« Aujourd'hui » de Taxi (Jérémy, 19.11.2026) : la date « Reçue le » préremplie et masquée des commissions à demander n'est pas une saisie", async () => {
  // La carte « Commissions à demander » pose, pour chaque course, une date de réception remplie par l'outil (aujourd'hui) dans un libellé masqué
  // tant que « Déjà reçue » n'est pas cochée. L'ancienne règle comparait à defaultValue (vide) sans regarder la visibilité : l'accueil de Taxi
  // comptait comme une saisie en cours dès qu'une commission était à demander.
  const taxi = fs.readFileSync(new URL("../src/gestion/js/views/taxi-hier.mjs", import.meta.url), "utf8");
  assert.match(taxi, /const date = h\("input", \{ id: `com-le-\$\{r\.id\}`, type: "date", value: \(edition && x\.recueLe\) \|\| ajd/);
  assert.match(taxi, /h\("label", \{ class: "taxi-commission-champ", hidden: !recue\.checked \}/);
  const { champsModifies } = await import("../src/gestion/js/saisie.mjs");
  const date = new El("input", { id: "com-le-r1", type: "date", value: "2026-11-19" });
  const montant = new El("input", { id: "com-r1", type: "text" });
  const recue = new El("input", { id: "com-recue-r1", type: "checkbox" });
  const libelleDate = new El("label", { class: "taxi-commission-champ", hidden: "" }, [date]);
  // L'écran affiché (#principal) ne porte plus que l'accueil de Taxi.
  const ecran = racine.enfants.find((e) => e.id === "principal");
  ecran.enfants = [];
  ecran.ajouter(new El("section", {}, [montant, recue, libelleDate]));
  assert.deepEqual(champsModifies(doc), [], "accueil de Taxi affiché, rien touché");
  // La personne coche « Déjà reçue » (la date apparaît) et laisse la date du jour : toujours rien à perdre… sauf la case cochée.
  geste("pointerdown", recue); recue.checked = true; delete libelleDate.attrs.hidden;
  assert.deepEqual(champsModifies(doc).map((c) => c.id), ["com-recue-r1"]);
  // Elle tape la commission et enregistre : la carte est redessinée (nouveaux champs), plus rien.
  geste("keydown", montant); montant.value = "150";
  assert.deepEqual(champsModifies(doc).map((c) => c.id).sort(), ["com-r1", "com-recue-r1"]);
  ecran.enfants = []; ecran.ajouter(new El("section", {}, [new El("input", { id: "com-r1", type: "text", value: "150" })]));
  assert.deepEqual(champsModifies(doc), [], "après « Enregistrer », la carte redessinée est propre");
});

test("« Aujourd'hui » : cases de « Mes tâches », carte des demandes du site, Appeler et WhatsApp ne sont jamais une saisie au rendu", async () => {
  const { champsModifies } = await import("../src/gestion/js/saisie.mjs");
  const ecran = racine.enfants.find((e) => e.id === "principal");
  ecran.enfants = [];
  ecran.ajouter(new El("section", {}, [new El("input", { id: "t1", type: "checkbox" }), new El("input", { id: "t2", type: "checkbox", checked: true })]));
  ecran.ajouter(new El("section", { class: "dsite-accueil" }, [new El("a", { href: "#/demandes" })]));
  ecran.ajouter(new El("section", {}, [new El("a", { href: "tel:+66" }), new El("a", { href: "https://wa.me/66" })]));
  assert.deepEqual(champsModifies(doc), []);
});

test("app.mjs : une saisie, c'est un champ changé et pas enregistré ; une fenêtre ouverte, un curseur ou un écran de saisie vide ne le sont pas", () => {
  const app = source("app.mjs");
  const fonction = app.slice(app.indexOf("function saisieEnCours()"), app.indexOf("function ecranLibre()"));
  assert.match(fonction, /return champsModifies\(\)\.length > 0;/);
  assert.ok(!/\.modal-fond|activeElement|defaultValue/.test(fonction), "ni la seule présence d'une fenêtre, ni le curseur, ni defaultValue");
  assert.match(fonction, /#principal \[data-occupe\]/, "l'écran « Nouveau voucher » dit lui-même quand il est occupé");
  // Rien à perdre : ni saisie, ni réglages non enregistrés, ni écran de saisie commencé (un service ajouté par un bouton n'est dans aucun champ).
  const rien = app.slice(app.indexOf("function rienAPerdre()"), app.indexOf("function ecranLibre()"));
  assert.match(rien, /if \(saisieEnCours\(\)\) return false;\n\s+if \(etat\.garde && etat\.garde\(\)\) return false;\n\s+return ecranDeLecture\(location\.hash\) \|\| !ecranTouche\(\);/);
  assert.match(app, /if \(!rienAPerdre\(\)\) \{\n\s+const \{ confirmer \}/, "le bouton du bandeau suit la même règle, réglages non enregistrés compris");
  assert.match(app, /principal\.replaceChildren\(noeud\);\n[^\n]*\n\s+nouvelEcran\(\);/, "chaque écran affiché repart intouché");
  // Redessiner reste plus prudent : pas sous une fenêtre ouverte, pas pendant la frappe d'une recherche.
  assert.match(app, /return ecranDeLecture\(location\.hash\) && !saisieEnCours\(\) && !document\.querySelector\("\.modal-fond"\) && !curseurDansUnChamp\(\);/);
  assert.match(app, /suivreSaisies\(\);/);
  // Le rechargement de la nouvelle version suit rienAPerdre : un écran de saisie vide et intouché ne le retient plus.
  const recharger = app.slice(app.indexOf("function rechargerSiSur("), app.indexOf("function signalerVersion("));
  assert.match(recharger, /const saisie = !rienAPerdre\(\);/);
});
