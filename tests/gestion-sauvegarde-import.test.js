import test from "node:test";
import assert from "node:assert/strict";
import { pourSauvegarde, COLONNES_RESUME, verifierSauvegarde, reservationsPerdantLeurPrestataire, absentsDeLaSauvegarde } from "../src/gestion/js/sauvegarde.mjs";

test("sauvegarde : toutes les colonnes que l'outil ajoute au dossier en mémoire sont retirées (sur_place compris)", () => {
  const dossier = { id: "d", ref: "R", client_id: "c", total: 10, devise: "THB", recu: 5, sur_place: 900 };
  const [sortie] = pourSauvegarde("dossiers", [dossier]);
  for (const k of COLONNES_RESUME) assert.equal(k in sortie, false, `${k} ne doit pas partir dans le fichier`);
  assert.deepEqual(Object.keys(sortie).sort(), ["client_id", "id", "ref"]);
  assert.deepEqual(COLONNES_RESUME, ["total", "devise", "recu", "sur_place"]);
});

test("import : une sauvegarde d'une autre entreprise est refusée, pas la bonne ni une ancienne sans nom", () => {
  assert.equal(verifierSauvegarde({ entreprise: "secret", clients: [] }, "secret").ok, true);
  assert.equal(verifierSauvegarde({ clients: [] }, "secret").ok, true, "ancienne sauvegarde sans entreprise");
  const refus = verifierSauvegarde({ entreprise: "ztp", clients: [] }, "secret");
  assert.equal(refus.ok, false);
  assert.equal(refus.erreur, "autre_entreprise");
  assert.equal(verifierSauvegarde({ clients: "oups" }, "secret").erreur, "format");
  assert.equal(verifierSauvegarde(null, "secret").erreur, "format");
});

test("remplacer la base partenaires : ce qui n'est plus dans le fichier, et les réservations qui perdraient leur lien", () => {
  const actuel = { partenaires: [{ id: "p1" }, { id: "p2" }], prestations: [{ id: "s1" }, { id: "s2" }], trajets: [{ id: "t1" }] };
  const fichier = { partenaires: [{ id: "p1" }], prestations: [{ id: "s1" }], trajets: [] };
  const a = absentsDeLaSauvegarde(actuel, fichier);
  assert.deepEqual(a, { partenaires: ["p2"], prestations: ["s2"], trajets: ["t1"] });
  const reservations = [
    { id: "r1", partenaire_id: "p1", prestation_id: "s1", trajet_id: null },
    { id: "r2", partenaire_id: "p2", prestation_id: "s2", trajet_id: null },
    { id: "r3", partenaire_id: null, prestation_id: null, trajet_id: "t1" },
    { id: "r4", partenaire_id: null, prestation_id: null, trajet_id: null },
  ];
  assert.deepEqual(reservationsPerdantLeurPrestataire(reservations, a).map((r) => r.id), ["r2", "r3"]);
  // Un fichier qui a tout ce qui existe ne supprime rien.
  assert.deepEqual(absentsDeLaSauvegarde(actuel, { partenaires: actuel.partenaires, prestations: actuel.prestations, trajets: actuel.trajets }), { partenaires: [], prestations: [], trajets: [] });
  // Un fichier sans la rubrique partenaires ne dit rien : rien à supprimer.
  assert.deepEqual(absentsDeLaSauvegarde(actuel, {}), { partenaires: [], prestations: [], trajets: [] });
});
