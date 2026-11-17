// Rappels à l'heure de chaque organisation (organisations.fuseau, étape 3 du SaaS) : mêmes résultats qu'avant pour Bangkok,
// heure locale juste ailleurs, changements d'heure compris.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as F from "../supabase/functions/rappels/calc.js";
import * as G from "../src/gestion/js/rappel-h1-calc.mjs";

const R = (o = {}) => ({ id: "r1", entite_id: "e1", dossier_id: "d1", statut: "confirme", date_service: "2026-11-17", heure_pickup: "08:00", partenaire_id: "p1", libelle: "Tour", ...o });

test("Bangkok reste comme avant : +7 h, sans heure d'été", () => {
  assert.equal(new Date(F.debutService(R())).toISOString(), "2026-11-17T01:00:00.000Z");
  assert.equal(new Date(F.debutService(R({ date_service: "2026-07-01" }), "Asia/Bangkok")).toISOString(), "2026-07-01T01:00:00.000Z");
  assert.equal(F.dateBangkok(new Date("2026-11-09T17:30:00Z")), "2026-11-10");
  assert.equal(F.heureBangkok(new Date("2026-11-09T11:00:00Z")), 18);
});

test("Zurich : heure d'hiver et heure d'été", () => {
  assert.equal(new Date(F.debutService(R(), "Europe/Zurich")).toISOString(), "2026-11-17T07:00:00.000Z");
  assert.equal(new Date(F.debutService(R({ date_service: "2026-07-01" }), "Europe/Zurich")).toISOString(), "2026-07-01T06:00:00.000Z");
  assert.equal(F.heureDans("Europe/Zurich", new Date("2026-11-09T17:00:00Z")), 18);
  assert.equal(F.heureDans("Europe/Zurich", new Date("2026-07-09T16:00:00Z")), 18);
  // Le jour du passage à l'heure d'été (29.03.2026, 02:00 → 03:00) : 08:00 est à UTC+2.
  assert.equal(new Date(F.debutService(R({ date_service: "2026-03-29" }), "Europe/Zurich")).toISOString(), "2026-03-29T06:00:00.000Z");
});

test("New York, en retard sur UTC : la date locale n'est pas celle de Bangkok", () => {
  const t = new Date("2026-11-17T03:00:00Z");
  assert.equal(F.dateDans("America/New_York", t), "2026-11-16");
  assert.equal(F.dateDans("Asia/Bangkok", t), "2026-11-17");
  assert.deepEqual(F.datesH1(t.getTime(), ["America/New_York", "Asia/Bangkok"]), ["2026-11-16", "2026-11-17", "2026-11-18"]);
});

test("fuseau inconnu ou vide : Bangkok", () => {
  assert.equal(F.fuseauValide("Mars/Olympus"), "Asia/Bangkok");
  assert.equal(F.fuseauValide(null), "Asia/Bangkok");
  assert.equal(F.debutService(R(), "Mars/Olympus"), F.debutService(R()));
});

test("le rappel une heure avant suit le fuseau de l'entreprise", () => {
  const maintenant = Date.parse("2026-11-17T06:00:00Z"); // 07:00 à Zurich, 13:00 à Bangkok
  const fuseauDe = (e) => (e === "zurich" ? "Europe/Zurich" : "Asia/Bangkok");
  const liste = F.servicesH1([R({ id: "a", entite_id: "zurich" }), R({ id: "b", entite_id: "bkk" })], maintenant, { fuseauDe });
  assert.deepEqual(liste.map((x) => [x.reservation.id, x.minutes]), [["a", 60]]);
  assert.equal(F.serviceForce(R(), maintenant, { reglages: { fonctionnement: "taxi" }, fuseau: "Europe/Zurich" }).service.minutes, 60);
});

test("l'outil et la fonction calculent le même début, quel que soit le fuseau", () => {
  for (const z of ["Asia/Bangkok", "Europe/Zurich", "America/New_York", "Australia/Sydney"])
    for (const d of ["2026-01-15", "2026-03-29", "2026-07-01", "2026-10-25"]) assert.equal(G.debutService(R({ date_service: d }), z), F.debutService(R({ date_service: d }), z), `${z} ${d}`);
});

test("la fonction passe une fois par organisation, à son heure, et note le suivi de chacune", () => {
  const f = fs.readFileSync(new URL("../supabase/functions/rappels/index.ts", import.meta.url), "utf8");
  assert.match(f, /for \(const \[org, ids\] of parOrganisation\)/);
  assert.match(f, /heureDans\(fuseau, maintenant\)/);
  assert.match(f, /rappels_suivi"\)\.insert\(\{ type: t, cible, \.\.\.res, erreur, duree_ms: Date\.now\(\) - debut, organisation_id: org \}\)/);
  assert.match(f, /executerH1\(db, maintenant, demande, ids, fuseau\)/);
  assert.ok(!/DECALAGE_BANGKOK|dateBangkok\(/.test(f), "plus de décalage fixe dans la fonction");
});
