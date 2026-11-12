// tests/gestion-nouveau-client.test.js : nom repris de la recherche et contrôle d'un nouveau client (nom, indicatif, e-mail).
const test = require("node:test");
const assert = require("node:assert/strict");
const load = () => import("../src/gestion/js/client-calc.mjs");

test("le nom tapé donne un prénom et un nom séparés", async () => {
  const { identiteDepuisSaisie } = await load();
  assert.deepEqual(identiteDepuisSaisie("Anna Keller"), { prenom: "Anna", nom: "Keller" });
  assert.deepEqual(identiteDepuisSaisie("  Anna   Keller-Meyer "), { prenom: "Anna", nom: "Keller-Meyer" });
  assert.deepEqual(identiteDepuisSaisie("Jean Pierre Dupont"), { prenom: "Jean", nom: "Pierre Dupont" });
});

test("un seul mot tapé est le nom, rien tapé ne remplit rien", async () => {
  const { identiteDepuisSaisie } = await load();
  assert.deepEqual(identiteDepuisSaisie("Keller"), { prenom: "", nom: "Keller" });
  assert.deepEqual(identiteDepuisSaisie(""), { prenom: "", nom: "" });
  assert.deepEqual(identiteDepuisSaisie(undefined), { prenom: "", nom: "" });
});

test("le nom est obligatoire", async () => {
  const { verifierNouveauClient } = await load();
  assert.deepEqual(verifierNouveauClient({ nom: "  " }), { ok: false, champ: "nom", raison: "nom_vide" });
});

test("le téléphone d'un nouveau client doit avoir son indicatif, il est normalisé sinon", async () => {
  const { verifierNouveauClient } = await load();
  const sans = verifierNouveauClient({ nom: "Keller", telephone: "079 123 45 67" });
  assert.equal(sans.ok, false);
  assert.equal(sans.champ, "telephone");
  assert.equal(sans.raison, "sans_indicatif");
  const ok = verifierNouveauClient({ nom: "Keller", telephone: "+41 79 123 45 67" });
  assert.equal(ok.ok, true);
  assert.equal(ok.valeurs.telephone, "+41791234567");
  assert.equal(verifierNouveauClient({ nom: "Keller", telephone: "" }).valeurs.telephone, "");
});

test("l'e-mail est facultatif mais doit avoir une forme d'adresse", async () => {
  const { verifierNouveauClient } = await load();
  assert.equal(verifierNouveauClient({ nom: "Keller" }).valeurs.email, "");
  assert.equal(verifierNouveauClient({ nom: "Keller", email: " anna@example.ch " }).valeurs.email, "anna@example.ch");
  for (const mauvais of ["anna", "anna@", "@example.ch", "anna@example", "an na@example.ch"]) {
    const r = verifierNouveauClient({ nom: "Keller", email: mauvais });
    assert.equal(r.ok, false, mauvais);
    assert.equal(r.champ, "email");
  }
});
