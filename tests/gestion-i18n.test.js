// tests/gestion-i18n.test.js : langue de l'interface (français / anglais) de l'outil de gestion.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const acorn = require("acorn");

const RACINE = path.join(__dirname, "..", "src", "gestion", "js");
const load = () => import("../src/gestion/js/i18n.mjs");
const loadEn = () => import("../src/gestion/js/i18n-en.mjs");

// Tous les textes écrits dans le code avec tr("…"), N_("…") ou comme formes de pluriel(n, "…", "…").
function clesDuCode() {
  const cles = new Map();
  const noter = (v, fichier, ligne) => {
    if (!cles.has(v)) cles.set(v, []);
    cles.get(v).push(`${fichier}:${ligne}`);
  };
  const texte = (a) => (a.type === "Literal" && typeof a.value === "string" ? a.value : a.type === "TemplateLiteral" && !a.expressions.length ? a.quasis[0].value.cooked : null);
  const visiter = (n, f) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "CallExpression" && n.callee.type === "Identifier") {
      if ((n.callee.name === "tr" || n.callee.name === "N_") && n.arguments.length) {
        const v = texte(n.arguments[0]);
        if (v !== null) noter(v, f, n.arguments[0].loc.start.line);
      }
      if (n.callee.name === "pluriel") {
        for (const a of n.arguments.slice(1, 3)) {
          const v = texte(a);
          if (v !== null) noter(v, f, a.loc.start.line);
        }
      }
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (k === "loc") continue;
      if (Array.isArray(v)) v.forEach((x) => visiter(x, f));
      else if (v && typeof v.type === "string") visiter(v, f);
    }
  };
  const parcourir = (dossier) => {
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, e.name);
      if (e.isDirectory()) {
        if (e.name !== "vendor") parcourir(chemin);
      } else if (e.name.endsWith(".mjs")) {
        const ast = acorn.parse(fs.readFileSync(chemin, "utf8"), { ecmaVersion: "latest", sourceType: "module", locations: true });
        visiter(ast, path.relative(RACINE, chemin));
      }
    }
  };
  parcourir(RACINE);
  return cles;
}

const variables = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("chaque texte de l'interface a sa traduction anglaise", async () => {
  const { EN } = await loadEn();
  const manquants = [...clesDuCode()].filter(([k]) => !(k in EN)).map(([k, ou]) => `${ou[0]} : ${k}`);
  assert.deepEqual(manquants, [], "textes sans traduction anglaise (ajoutez-les dans i18n-en.mjs)");
});

test("aucune traduction orpheline : chaque entrée du dictionnaire sert dans le code", async () => {
  const { EN } = await loadEn();
  const cles = clesDuCode();
  assert.deepEqual(Object.keys(EN).filter((k) => !cles.has(k)), []);
});

test("une traduction garde les mêmes {variables} que le texte français et n'est jamais vide", async () => {
  const { EN } = await loadEn();
  for (const [fr, en] of Object.entries(EN)) {
    assert.ok(en.trim().length > 0, `traduction vide : ${fr}`);
    assert.deepEqual(variables(en), variables(fr), `variables différentes : ${fr}`);
    // les espaces de début et de fin comptent (fragments de phrases)
    assert.equal(/^\s/.test(en), /^\s/.test(fr), `espace initial : ${JSON.stringify(fr)}`);
    assert.equal(/\s$/.test(en), /\s$/.test(fr), `espace final : ${JSON.stringify(fr)}`);
  }
});

test("une traduction ne laisse pas de mots français évidents", async () => {
  const { EN } = await loadEn();
  // Les noms propres et les exemples de saisie restent tels quels ; tout le reste doit être traduit.
  const AUTORISES = new Set(["Gestion", "Wise", "PayPal", "TWINT", "WhatsApp", "Ctrl", "Cmd", "Code", "Date", "Type", "Notes", "Note", "Contact", "Description", "Service", "Net", "Message", "Messages", "Total", "Document", "Documents", "Transfer", "Transfer Voucher", "Rental", "Line", "Wise"]);
  const suspects = Object.entries(EN).filter(([fr, en]) => fr === en && !AUTORISES.has(fr) && /[àâçéèêëîïôùûüÿœ]|\b(le|la|les|des|du|et|pour|avec|sans|une|dans|sur|est|pas)\b/i.test(fr));
  assert.deepEqual(suspects, []);
});

test("tr : le français rend le texte tel quel, l'anglais sa traduction, avec les variables", async () => {
  const { tr, forcerLangue, manquants } = await load();
  forcerLangue("fr");
  assert.equal(tr("Nouveau dossier"), "Nouveau dossier");
  assert.equal(tr("{nom} (copie)", { nom: "Admin" }), "Admin (copie)");
  forcerLangue("en");
  assert.equal(tr("Nouveau dossier"), "New file");
  assert.equal(tr("{nom} (copie)", { nom: "Admin" }), "Admin (copy)");
  // un texte sans traduction reste lisible (français) et se retrouve dans manquants()
  assert.equal(tr("Texte inventé pour le test"), "Texte inventé pour le test");
  assert.ok(manquants().includes("Texte inventé pour le test"));
  forcerLangue("fr");
});

test("pluriel : zéro est singulier en français et pluriel en anglais", async () => {
  const { pluriel, forcerLangue } = await load();
  forcerLangue("fr");
  assert.equal(pluriel(0, "jour", "jours"), "0 jour");
  assert.equal(pluriel(1, "jour", "jours"), "1 jour");
  assert.equal(pluriel(2, "jour", "jours"), "2 jours");
  assert.equal(pluriel(3, "{n} dossier sélectionné", "{n} dossiers sélectionnés"), "3 dossiers sélectionnés");
  forcerLangue("en");
  assert.equal(pluriel(0, "jour", "jours"), "0 days");
  assert.equal(pluriel(1, "jour", "jours"), "1 day");
  assert.equal(pluriel(2, "jour", "jours"), "2 days");
  assert.equal(pluriel(1, "{n} dossier sélectionné", "{n} dossiers sélectionnés"), "1 file selected");
  assert.equal(pluriel(3, "{n} dossier sélectionné", "{n} dossiers sélectionnés"), "3 files selected");
  forcerLangue("fr");
});

test("mois et dates dans la langue de l'interface, documents inchangés", async () => {
  const { moisLong, moisCourt, dateComplete, forcerLangue } = await load();
  const { nomMois, periodeTexte, libelleStatut } = await import("../src/gestion/js/calc.mjs");
  forcerLangue("fr");
  assert.equal(moisLong("2026-10-15"), "octobre");
  assert.equal(moisCourt("2026-01-01"), "janv.");
  assert.equal(nomMois("2026-03-02"), "mars");
  assert.equal(dateComplete("2026-10-29"), "29 octobre 2026");
  assert.equal(libelleStatut("solde"), "Soldé");
  forcerLangue("en");
  assert.equal(moisLong("2026-10-15"), "October");
  assert.equal(moisCourt("2026-01-01"), "Jan");
  assert.equal(nomMois("2026-03-02"), "March");
  assert.equal(dateComplete("2026-10-29"), "29 October 2026");
  assert.equal(libelleStatut("solde"), "Paid in full");
  // le bandeau d'un document client reste en français quelle que soit la langue de l'interface
  assert.equal(periodeTexte("2026-12-02", "2026-12-12"), "DU 2 AU 12 DÉCEMBRE 2026");
  forcerLangue("fr");
});

test("les statuts, les familles et les rôles de départ se traduisent à l'affichage sans changer leurs valeurs", async () => {
  const { forcerLangue } = await load();
  const { STATUTS } = await import("../src/gestion/js/calc.mjs");
  const { FAMILLES, nomFamille, libelleUnite } = await import("../src/gestion/js/partenaires-calc.mjs");
  const { ROLES_SYSTEME } = await import("../src/gestion/js/defauts.mjs");
  const { tr } = await load();
  forcerLangue("fr");
  assert.equal(STATUTS.acompte, "Acompte reçu");
  assert.equal(nomFamille("excursion"), "Excursions");
  assert.equal(libelleUnite("pp"), "par personne");
  forcerLangue("en");
  assert.equal(STATUTS.acompte, "Acompte reçu", "la valeur de base reste française (exports, base de données)");
  assert.equal(nomFamille("excursion"), "Excursions");
  assert.equal(nomFamille("transfert"), "Transfers");
  assert.equal(libelleUnite("pp"), "per person");
  assert.equal(libelleUnite("pp", false), "par personne", "un document peut imposer sa propre langue");
  assert.deepEqual(ROLES_SYSTEME.map((r) => tr(r.nom)), ["Administrator", "Editor", "Reader"]);
  assert.equal(FAMILLES.length, 6);
  forcerLangue("fr");
});
