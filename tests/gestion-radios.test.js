// Boutons radio et cases à cocher (18.11.2026) : la règle des champs de saisie (`input, select, textarea` : largeur 100 %, 44 px de haut)
// s'appliquait aussi aux radios, qui s'étiraient sur toute la ligne (« Utiliser ce client » dans « Coller une confirmation »).
// Une seule remise à leur taille, pour tout Gestion ; ce test l'empêche de disparaître ou d'être contournée.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const css = readFileSync(new URL("../src/gestion/css/app.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
// Les règles « sélecteurs { déclarations } » du premier niveau (hors @media), dans l'ordre du fichier.
const regles = [...css.matchAll(/(^|})\s*([^{}@]+?)\s*\{([^{}]*)\}/g)].map((m) => ({ selecteurs: m[2].split(",").map((s) => s.trim()), decl: m[3] }));
const valeur = (decl, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(decl);
  return m ? m[1].trim() : null;
};

test("radios et cases à cocher : une règle commune leur rend leur taille, après celle des champs de saisie", () => {
  // La règle des champs de saisie ne vise jamais les choix : ni radio ni case à cocher n'en hérite la largeur, la hauteur ou la bordure.
  const champs = regles.findIndex((r) => r.selecteurs.includes("textarea") && r.selecteurs.includes("select"));
  assert.ok(champs >= 0, "règle des champs de saisie");
  assert.equal(valeur(regles[champs].decl, "width"), "100%");
  assert.deepEqual(regles[champs].selecteurs.filter((s) => /^input/.test(s)), ['input:not([type="checkbox"]):not([type="radio"])']);
  const commune = regles.findIndex((r) => r.selecteurs.includes('input[type="checkbox"]') && r.selecteurs.includes('input[type="radio"]'));
  assert.ok(commune > champs, "la remise à la taille des choix vient après la règle des champs");
  const d = regles[commune].decl;
  assert.equal(valeur(d, "width"), "20px");
  assert.equal(valeur(d, "height"), "20px");
  assert.equal(valeur(d, "min-height"), "0");
  assert.equal(valeur(d, "padding"), "0");
  assert.equal(valeur(d, "flex"), "none");
});

test("aucune règle ne rend à un radio ou une case visibles la largeur d'un champ (seuls les choix masqués sous un bouton couvrent leur bouton)", () => {
  for (const r of regles) {
    // Les sélecteurs qui visent un choix : par son type, ou un « input » dans un libellé de choix (« .case input », « .vr-marque input »…).
    const choix = r.selecteurs.filter((s) => /input\[type="(radio|checkbox)"\]/.test(s) || /\.(case|bsite-modele|vr-marque|cc-entreprise|fid-coche|cc-client)\b[^,]*\binput\s*$/.test(s));
    if (!choix.length) continue;
    const largeur = valeur(r.decl, "width");
    if (largeur !== "100%") continue;
    assert.equal(valeur(r.decl, "opacity"), "0", `${r.selecteurs.join(", ")} : un choix visible étiré à 100 %`);
    assert.equal(valeur(r.decl, "position"), "absolute", r.selecteurs.join(", "));
  }
  // Plus de rustine locale qui redéfinit la taille d'un radio (le bandeau du site en avait une, devenue inutile).
  for (const r of regles) {
    if (r.selecteurs.some((s) => /input\[type="radio"\]/.test(s)) && !r.selecteurs.includes('input[type="checkbox"]') && r.selecteurs.join() !== 'input[type="radio"]') {
      assert.equal(valeur(r.decl, "width"), null, `${r.selecteurs.join(", ")} redéfinit la taille d'un radio`);
    }
  }
});

test("chaque radio des écrans a un libellé qui le porte : ligne « case » (cible de 44 px) ou bouton de choix", () => {
  const dossier = new URL("../src/gestion/js/views/", import.meta.url);
  const permis = ["case", "bsite-modele", "vr-marque", "cc-entreprise"];
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".mjs"))) {
    const src = readFileSync(new URL(f, dossier), "utf8");
    for (const m of src.matchAll(/h\("label", \{ class: "([^"]+)"[^)]*?\}, h\("input", \{ type: "radio"/g)) assert.ok(permis.some((p) => m[1].split(/\s+/).includes(p)), `${f} : radio dans un libellé « ${m[1]} »`);
    // Un radio créé hors d'un libellé connu doit être ajouté à cette liste après vérification à l'écran.
    const tous = (src.match(/type: "radio"/g) || []).length;
    const portes = (src.match(/h\("label", \{ class: "[^"]+"[^)]*?\}, h\("input", \{ type: "radio"/g) || []).length;
    if (f === "bandeau-site.mjs") continue; // libellé construit sur plusieurs lignes, classe « bsite-modele » (vérifiée à l'écran)
    assert.equal(portes, tous, `${f} : ${tous - portes} radio(s) hors d'un libellé connu`);
  }
  assert.match(css, /\.case \{[^}]*min-height: 44px/, "la ligne « case » donne la cible tactile de 44 px");
});
