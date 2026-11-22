// Relecture finale de la PR 317 (intégration du 22.11.2026) : un test par constat. Le point 2 (deux refus) est dans gestion-refus-envoi.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lienDuTexte } from "../src/gestion/js/point-soir-calc.mjs";

const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("1 : whatsapp-envoi ne solde les propositions ouvertes que pour l'envoi d'une proposition", () => {
  const envoi = lire("supabase/functions/whatsapp-envoi/index.ts");
  const fin = envoi.slice(envoi.indexOf("// Envoi d'une proposition seulement (relecture de la PR 317)"), envoi.indexOf("return json({ ok: true, message_id: messageId"));
  assert.match(fin, /^[^\n]*\n(?:\/\/[^\n]*\n|\s+\/\/[^\n]*\n)*  if \(demande\.proposition_id\) \{\n    const \{ error: errP2 \} = await admin\.from\("whatsapp_propositions"\)\.update\(\{ statut: "traitee"/);
  // Une seule écriture « traitee » par la fonction, et elle est dans ce bloc.
  assert.equal((envoi.match(/statut: "traitee"/g) || []).length, 1);
});

test("3 : le lien wa.me reprend le texte corrigé ; le texte refusé ne part jamais tant qu'il n'a pas changé", () => {
  const refuse = "Hello Ana, pickup at 8:00, 1,200 THB to the driver.";
  const tel = "+447700900611";
  assert.equal(lienDuTexte({ texte: refuse, telephone: tel, refuse }), null, "texte refusé : lien éteint");
  assert.equal(lienDuTexte({ texte: `  ${refuse}  `, telephone: tel, refuse }), null, "mêmes mots, espaces autour : toujours refusé");
  const corrige = "Hello Ana, pickup at 8:00.";
  const lien = lienDuTexte({ texte: corrige, telephone: tel, refuse });
  assert.ok(lien && lien.includes(encodeURIComponent(corrige)), "texte corrigé dans le lien");
  assert.equal(lienDuTexte({ texte: "Hello Ana, Sea Fictif picks you up.", telephone: tel, refuse, noms: ["Sea Fictif"] }), null, "nom de partenaire : lien éteint");
  assert.equal(lienDuTexte({ texte: "", telephone: tel, refuse }), null);
  const vue = lire("src/gestion/js/views/point-soir.mjs");
  assert.match(vue, /if \(code === "fenetre_fermee"\) return remplirGestes\(zone, \{ r, texte: envoye, conversation: null, [^\n]*fen: null, refuse \}\);/);
  assert.match(vue, /lienCourant = lienDuTexte\(\{ texte: edition \? edition\.value\.trim\(\) : texte, telephone, refuse, noms: noms\(\) \}\);/);
  assert.match(vue, /if \(!lienCourant\) return void e\.preventDefault\(\);/);
});

test("4 : « Créer le dossier » masqué pour un Contact personnel (carte Prêt et actions du dossier)", () => {
  const vue = lire("src/gestion/js/views/whatsapp.mjs");
  assert.match(vue, /const creerPret = \(c, prop\) =>\n(?:\s*\/\/[^\n]*\n)*\s+!lectureSeule && reponsesDe\(c\) !== "jamais" && \(clientCommun\(c\)/);
  assert.match(vue, /const assistant = reponsesDe\(c\) !== "jamais" && \(commun/);
});

test("5 : manquesDisponible est gardé d'une lecture à l'autre, à côté de PRET et ETAPES", () => {
  const store = lire("src/gestion/js/store-supabase.mjs");
  const i = store.indexOf("let manquesDisponible = true;");
  assert.ok(i > store.indexOf('const ETAPES = "avancee, etape_manuelle, ia_coupee";') && i < store.indexOf("const lireConversations = async () => {"));
  assert.equal((store.match(/let manquesDisponible/g) || []).length, 1);
});

test("6 : retour-85 refuse de passer tant que les colonnes de la 105 existent", () => {
  const sql = lire("docs/gestion/retour-85-whatsapp-pret.sql");
  assert.match(sql, /-- Appliquer retour-105-whatsapp-etapes\.sql d'abord/);
  const garde = sql.indexOf("raise exception 'retour-85 refusé : appliquer retour-105-whatsapp-etapes.sql d''abord");
  assert.ok(garde > sql.indexOf("begin;") && garde < sql.indexOf("create or replace function whatsapp_reclasser"), "en tête, avant toute écriture");
  assert.match(sql, /column_name in \('avancee', 'etape_manuelle', 'ia_coupee'\)/);
  assert.match(lire("docs/gestion/verif-whatsapp-pret.mjs"), /ok\(gardeRefuse, "retour-85 refuse tant que les colonnes de la 105 existent"\)/);
});

test("7 : verif-hotels-lieux tourne dans la CI", () => {
  assert.ok(fs.existsSync(new URL("../docs/gestion/verif-hotels-lieux.mjs", import.meta.url)));
  assert.match(lire(".github/workflows/ci.yml"), /for f in [^\n]*\bverif-hotels-lieux\b[^\n]*; do/);
});
