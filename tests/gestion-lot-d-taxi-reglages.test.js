// tests/gestion-lot-d-taxi-reglages.test.js : lot D de l'audit des parcours du 13.11.2026 (points 7, 8, 11, 12 et 13).
// Moyens de paiement propres à chaque entreprise, tarifs taxi et course d'avant-hier dans la démo, identifiants du sélecteur d'entreprise.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MOYENS_DEFAUT, MOYENS_SUR_PLACE, moyensDefautPour, completerReglages, donneesDemo } from "../src/gestion/js/defauts.mjs";
import { commissionsADemander, commissionsParChauffeur } from "../src/gestion/js/taxi-calc.mjs";

const ajouterJours = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const ids = (liste) => liste.map((m) => m.id);

test("moyens de paiement : Secret et Taxi avec Espèces d'abord, sans TWINT ni PostFinance ; ZTP inchangé", () => {
  assert.deepEqual(ids(MOYENS_DEFAUT), ["virement", "wise", "paypal", "twint", "postfinance", "especes", "autre"], "ZTP ne change pas");
  assert.deepEqual(ids(MOYENS_SUR_PLACE), ["especes", "virement", "wise", "paypal", "autre"]);
  for (const f of ["excursions", "taxi"]) {
    const r = completerReglages({ fonctionnement: f });
    assert.equal(r.listes.moyens[0].id, "especes", `${f} : Espèces, choix par défaut d'un paiement`);
    assert.ok(!ids(r.listes.moyens).some((id) => id === "twint" || id === "postfinance"), `${f} : rien de suisse`);
    assert.deepEqual(ids(moyensDefautPour(f)), ids(MOYENS_SUR_PLACE));
  }
  assert.deepEqual(ids(completerReglages({}).listes.moyens), ids(MOYENS_DEFAUT), "sur mesure par défaut");
  assert.deepEqual(ids(completerReglages({ fonctionnement: "sur_mesure", listes: { pays: ["Thaïlande"] } }).listes.moyens), ids(MOYENS_DEFAUT));
  // Une liste enregistrée dans les réglages reste telle quelle, même en mode excursions (la production se corrige par SQL).
  const enregistree = [{ id: "twint", label: "TWINT" }];
  assert.deepEqual(completerReglages({ fonctionnement: "excursions", listes: { moyens: enregistree } }).listes.moyens, enregistree);
  // Chaque moyen de Secret et Taxi garde un nom pour les statistiques (analyses-sections.mjs lit MOYENS_DEFAUT).
  for (const m of MOYENS_SUR_PLACE) assert.ok(MOYENS_DEFAUT.includes(m));
});

test("démo : chaque entreprise a ses moyens de paiement", () => {
  const d = donneesDemo("2026-11-12", ajouterJours);
  const [agence, tours, taxi] = d.entites;
  assert.ok(ids(d.reglages[agence.id].listes.moyens).includes("twint"), "ZTP garde TWINT");
  for (const e of [tours, taxi]) {
    assert.equal(d.reglages[e.id].listes.moyens[0].id, "especes", e.nom);
    assert.ok(!ids(d.reglages[e.id].listes.moyens).includes("twint"), e.nom);
    assert.ok(!ids(d.reglages[e.id].listes.moyens).includes("postfinance"), e.nom);
  }
});

test("démo Taxi : trois tarifs du catalogue de VIP Taxi Lanta et une course d'avant-hier groupée avec celle d'hier", () => {
  const ajd = "2026-11-12";
  const d = donneesDemo(ajd, ajouterJours);
  const taxi = d.entites[2];
  const tarifs = d.prestations.filter((p) => p.entite_id === taxi.id);
  assert.deepEqual(tarifs.map((p) => [p.libelle, p.prix_vente, p.unite, p.famille]), [["Krabi Airport", 2300, "veh", "transfert"], ["Ao Nang", 2700, "veh", "transfert"], ["Phuket Airport and town", 4500, "veh", "transfert"]]);
  const chauffeurs = d.partenaires.find((p) => p.entite_id === taxi.id);
  assert.ok(tarifs.every((p) => p.partenaire_id === chauffeurs.id), "les tarifs sont ceux des chauffeurs de Taxi, jamais d'un partenaire de Secret");
  const courses = d.reservations.filter((r) => r.entite_id === taxi.id);
  const liste = commissionsADemander(courses, ajd, { netDe: () => null });
  assert.deepEqual(liste.map((x) => x.reservation.date_service), [ajouterJours(ajd, -2), ajouterJours(ajd, -1)], "avant-hier reste dans la carte");
  const groupes = commissionsParChauffeur(liste);
  assert.equal(groupes.length, 1, "un seul chauffeur, donc un seul message");
  assert.equal(groupes[0].aDemander.length, 2);
  // Chaque course de démo a sa ligne sur le document interne de son dossier (prix interne de Taxi).
  for (const r of courses) {
    const doc = d.documents.find((x) => x.dossier_id === r.dossier_id);
    assert.ok(doc && doc.contenu.lignes.some((l) => l.id === r.ligne_id), r.libelle);
  }
});

test("sélecteur d'entreprise : un identifiant par barre, plus jamais deux #entite", () => {
  const src = fs.readFileSync(new URL("../src/gestion/js/app.mjs", import.meta.url), "utf8");
  assert.ok(!/id:\s*"entite"/.test(src), "plus d'identifiant « entite » en double");
  const appels = [...src.matchAll(/selecteurEntite\("(\w+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(appels.sort(), ["haut", "menu", "simple"]);
  assert.equal(new Set(appels).size, appels.length);
});
