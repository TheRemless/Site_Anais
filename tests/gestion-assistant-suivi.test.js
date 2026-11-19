// Suivi de l'assistant IA : coût du jour et du mois, usages, personnes, entreprises, échecs, limite du jour, tendance, qualité des réponses.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { suiviAssistant, partModifiee, jourBangkok, debutLecture, entreprisesSuivies, LIMITE_JOUR, USAGES_SUIVIS } from "../src/gestion/js/assistant-suivi-calc.mjs";
import { LIMITE_JOUR_DEFAUT, USAGES } from "../supabase/functions/assistant/calc.js";

const ZWALD = "e1";
const SECRET = "e2";
const ANAIS = "u1";
const NANI = "u2";
const JOUR = "2026-11-19";
// 10 h à Bangkok le jour donné.
const a = (jour, h = 10) => new Date(Date.parse(`${jour}T${String(h).padStart(2, "0")}:00:00Z`) - 7 * 3600 * 1000).toISOString();
const ligne = (jour, extra = {}) => ({ cree_le: a(jour), user_id: ANAIS, entite_id: SECRET, usage: "lire", statut: "ok", cout_estime_usd: 0.002, ...extra });
const ENTITES = [{ id: ZWALD, nom: "Zwald" }, { id: SECRET, nom: "Secret" }];

test("la limite et les usages suivent ceux de la fonction", () => {
  assert.equal(LIMITE_JOUR, LIMITE_JOUR_DEFAUT);
  for (const u of Object.keys(USAGES)) assert.ok(USAGES_SUIVIS.some(([k]) => k === u), `usage ${u} sans libellé`);
});

test("jour de Bangkok : 23 h à Genève le 18 est déjà le 19 à Bangkok", () => {
  assert.equal(jourBangkok("2026-11-18T18:30:00Z"), "2026-11-19");
  assert.equal(jourBangkok("2026-11-18T16:59:00Z"), "2026-11-18");
  // Le 19 : les 30 jours remontent avant le 1er du mois, on lit depuis le 21 octobre à minuit (Bangkok).
  assert.equal(debutLecture(JOUR), "2026-10-20T17:00:00.000Z");
  // Le 31 : le 1er du mois est le plus ancien.
  assert.equal(debutLecture("2026-12-31"), "2026-11-30T17:00:00.000Z");
});

test("coût du jour et du mois, appels par usage, projection", () => {
  const lignes = [
    ligne(JOUR, { cout_estime_usd: 0.01 }),
    ligne(JOUR, { usage: "itineraire", cout_estime_usd: 0.0005 }),
    ligne("2026-11-02", { usage: "situer", cout_estime_usd: 0.02 }),
    ligne("2026-10-25", { cout_estime_usd: 1 }), // hors du mois, dans les 30 jours
  ];
  const s = suiviAssistant({ lignes, jour: JOUR, entites: ENTITES });
  assert.equal(s.aujourdhui.appels, 2);
  assert.equal(s.aujourdhui.cout, 0.0105);
  assert.equal(s.duMois.appels, 3);
  assert.equal(s.duMois.cout, 0.0305);
  assert.deepEqual(s.usages.map((u) => [u.usage, u.appels]), [["lire", 1], ["itineraire", 1], ["situer", 1]]);
  // 0,0305 $ en 19 jours, sur un mois de 30 jours.
  assert.equal(s.projection, Math.round((0.0305 / 19) * 30 * 1e4) / 1e4);
  assert.equal(s.tendance.length, 30);
  assert.equal(s.tendance[0].jour, "2026-10-21");
  assert.equal(s.tendance.at(-1).jour, JOUR);
  assert.equal(s.tendance.find((t) => t.jour === "2026-10-25").cout, 1);
  assert.equal(s.tendance.reduce((t, x) => t + x.appels, 0), 4);
  assert.equal(suiviAssistant({ lignes, jour: "2026-11-02" }).projection, null);
});

test("échecs : refus de Claude à part, erreurs regroupées, les plus récents d'abord", () => {
  const lignes = [ligne(JOUR, { statut: "refus" }), ligne(JOUR, { statut: "cle_refusee", cout_estime_usd: 0 }), ligne("2026-11-10", { statut: "invalide" }), ligne(JOUR)];
  const s = suiviAssistant({ lignes, jour: JOUR, noms: { [ANAIS]: "Anaïs" }, entites: ENTITES });
  assert.equal(s.duMois.refus, 1);
  assert.equal(s.duMois.erreurs, 2);
  assert.equal(s.duMois.ok, 1);
  assert.equal(s.echecs.length, 3);
  assert.equal(s.echecs.at(-1).statut, "invalide");
  assert.equal(s.echecs[0].personne, "Anaïs");
  assert.equal(s.echecs[0].entreprise, "Secret");
  assert.ok(s.statuts.some((x) => x.statut === "cle_refusee" && x.libelle === "Clé API refusée"));
});

test("limite du jour : comptée par personne toutes entreprises confondues, comme la fonction", () => {
  const lignes = [...Array.from({ length: 30 }, () => ligne(JOUR)), ...Array.from({ length: 10 }, () => ligne(JOUR, { entite_id: ZWALD })), ...Array.from({ length: 40 }, () => ligne("2026-11-05", { user_id: NANI })), ligne(JOUR, { user_id: NANI })];
  const s = suiviAssistant({ lignes, jour: JOUR, noms: { [ANAIS]: "Anaïs", [NANI]: "Nani" }, entites: ENTITES, entiteId: SECRET });
  const anais = s.personnes.find((p) => p.user_id === ANAIS);
  assert.equal(anais.aujourdhui, 40);
  assert.equal(anais.limiteAtteinte, true);
  // Vue Secret seule : ses 30 appels chez Secret, mais la limite compte aussi les 10 de Zwald.
  assert.equal(anais.appels, 30);
  const nani = s.personnes.find((p) => p.user_id === NANI);
  assert.equal(nani.limiteAtteinte, false);
  assert.equal(nani.joursLimite, 1);
  assert.equal(s.limiteAtteinte, 1);
  assert.equal(s.personnes[0].user_id, ANAIS);
});

test("par entreprise : filtre sur une entreprise, toutes sinon", () => {
  const lignes = [ligne(JOUR), ligne(JOUR, { entite_id: ZWALD, cout_estime_usd: 0.5 })];
  const toutes = suiviAssistant({ lignes, jour: JOUR, entites: ENTITES });
  assert.deepEqual(toutes.entreprises.map((e) => e.nom), ["Zwald", "Secret"]);
  const zwald = suiviAssistant({ lignes, jour: JOUR, entites: ENTITES, entiteId: ZWALD });
  assert.equal(zwald.duMois.appels, 1);
  assert.equal(zwald.duMois.cout, 0.5);
});

test("un usage ajouté plus tard s'affiche sous son code, après les connus", () => {
  const s = suiviAssistant({ lignes: [ligne(JOUR, { usage: "nouveau_truc" }), ligne(JOUR, { usage: "brochure" })], jour: JOUR });
  assert.deepEqual(s.usages.map((u) => u.libelle), ["Brochure", "nouveau_truc"]);
});

test("part modifiée : 0 sans retouche, au moins 1 dès un mot changé, 100 pour un texte tout autre", () => {
  const brouillon = "Bonjour Marie, le bateau part à 9h00 de Saladan et coûte 900 THB par adulte.";
  assert.equal(partModifiee(brouillon, brouillon), 0);
  assert.equal(partModifiee(brouillon, `  ${brouillon.replaceAll(" ", "  ")}\n`), 0, "les espaces ne comptent pas");
  assert.equal(partModifiee(brouillon, brouillon.replace("9h00", "9h30")), 7); // 1 mot sur 15
  // Réécrite : seul « et » reste en commun.
  assert.equal(partModifiee(brouillon, "Merci, je regarde et je reviens vers vous."), 93);
  assert.equal(partModifiee("a b c", "x y z"), 100);
  assert.equal(partModifiee("", ""), 0);
  assert.equal(partModifiee("", "Bonjour"), 100);
  const long = Array.from({ length: 400 }, (_, i) => `mot${i}`).join(" ");
  assert.equal(partModifiee(long, `${long} merci`), 1);
});

test("qualité : part copiée sans retouche, absente avant la migration 51", () => {
  const lignes = [ligne(JOUR, { usage: "repondre_itineraire" }), ligne(JOUR, { usage: "repondre_itineraire" }), ligne(JOUR, { usage: "repondre_itineraire", statut: "invalide" }), ligne(JOUR)];
  const sans = suiviAssistant({ lignes, jour: JOUR });
  assert.equal(sans.qualite.disponible, false);
  assert.equal(sans.qualite.redigees, 2);
  const r = (part, jour = JOUR) => ({ cree_le: a(jour), user_id: ANAIS, entite_id: SECRET, usage: "repondre_itineraire", part_modifiee: part });
  const s = suiviAssistant({ lignes, retouches: [r(0), r(0), r(20), r(60), r(0, "2026-10-30")], jour: JOUR });
  assert.equal(s.qualite.disponible, true);
  assert.equal(s.qualite.mesurees, 4);
  assert.equal(s.qualite.sansRetouche, 2);
  assert.equal(s.qualite.part, 50);
  assert.equal(s.qualite.moyenne, 20);
  assert.equal(suiviAssistant({ lignes, retouches: [], jour: JOUR }).qualite.part, null);
});

test("entreprises suivies : administratrice qui lit le journal", () => {
  const perms = { e1: ["reglages.ecrire", "journal.voir"], e2: ["journal.voir"], e3: ["reglages.ecrire"] };
  const r = entreprisesSuivies({ entites: [{ id: "e1" }, { id: "e2" }, { id: "e3" }], permissionsDe: (id) => perms[id] });
  assert.deepEqual(r.map((e) => e.id), ["e1"]);
});

test("aucun texte de message ni de réponse ne quitte le navigateur pour la qualité", () => {
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-51-assistant-retouches.sql", import.meta.url), "utf8");
  const table = sql.slice(sql.indexOf("create table"), sql.indexOf(");", sql.indexOf("create table")));
  assert.doesNotMatch(table, /\btext\b(?![^,]*check \(usage)/, "seule la colonne usage est du texte");
  assert.match(table, /part_modifiee smallint not null check \(part_modifiee between 0 and 100\)/);
  const store = fs.readFileSync(new URL("../src/gestion/js/store-supabase.mjs", import.meta.url), "utf8");
  const appel = store.slice(store.indexOf("async noterRetouche"), store.indexOf("},", store.indexOf("async noterRetouche")));
  assert.doesNotMatch(appel, /message|texte|brouillon/i);
});
