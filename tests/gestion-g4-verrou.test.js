// tests/gestion-g4-verrou.test.js : ne plus écraser le travail de l'autre (fusion champ par champ) et PostFinance dans les moyens par défaut.
const test = require("node:test");
const assert = require("node:assert/strict");

const calc = () => import("../src/gestion/js/conflit-calc.mjs");

test("PostFinance fait partie des moyens de paiement par défaut, après TWINT", async () => {
  const { MOYENS_DEFAUT } = await import("../src/gestion/js/defauts.mjs");
  const ids = MOYENS_DEFAUT.map((m) => m.id);
  assert.ok(ids.includes("postfinance"));
  assert.equal(ids.indexOf("postfinance"), ids.indexOf("twint") + 1);
  assert.equal(new Set(ids).size, ids.length);
});

const base = { id: "r1", heure_pickup: "", personnes: { adultes: 2, enfants: 0 }, notes: "", lieu_pickup: "Hôtel A", details: { envois: {} }, updated_at: "t1" };

test("deux personnes, deux champs différents : les deux saisies sont gardées sans rien demander", async () => {
  const { fusionner } = await calc();
  // Anaïs a mis l'heure (téléphone), Jérémy a changé les personnes (ordinateur) : le formulaire d'Anaïs réécrit tous les champs.
  const courante = { ...base, personnes: { adultes: 3, enfants: 0 }, updated_at: "t2" };
  const miennes = { heure_pickup: "08:30", personnes: { adultes: 2, enfants: 0 }, notes: "", lieu_pickup: "Hôtel A" };
  const f = fusionner(base, miennes, courante);
  assert.deepEqual(f.conflits, []);
  assert.deepEqual(f.patch, { heure_pickup: "08:30" }, "seul ce qu'elle a changé part, les personnes de Jérémy restent");
});

test("même champ changé des deux côtés : un conflit avec les deux valeurs", async () => {
  const { fusionner } = await calc();
  const courante = { ...base, heure_pickup: "09:00", updated_at: "t2" };
  const f = fusionner(base, { heure_pickup: "08:30", notes: "Bagages" }, courante);
  assert.deepEqual(f.patch, { notes: "Bagages" });
  assert.deepEqual(f.conflits, [{ cle: "heure_pickup", base: "", sienne: "09:00", mienne: "08:30" }]);
});

test("même valeur des deux côtés : ni conflit ni écriture inutile", async () => {
  const { fusionner } = await calc();
  const courante = { ...base, heure_pickup: "08:30", updated_at: "t2" };
  const f = fusionner(base, { heure_pickup: "08:30" }, courante);
  assert.deepEqual(f, { patch: {}, conflits: [] });
});

test("les objets se fusionnent clé par clé : adultes d'un côté, enfants de l'autre", async () => {
  const { fusionner } = await calc();
  const courante = { ...base, personnes: { adultes: 3, enfants: 0 }, updated_at: "t2" };
  const f = fusionner(base, { personnes: { adultes: 2, enfants: 1 } }, courante);
  assert.deepEqual(f.conflits, []);
  assert.deepEqual(f.patch, { personnes: { adultes: 3, enfants: 1 } });
  const dur = fusionner(base, { personnes: { adultes: 4, enfants: 0 } }, courante);
  assert.deepEqual(dur.conflits, [{ cle: "personnes.adultes", base: 2, sienne: 3, mienne: 4 }]);
});

test("details : les envois notés ailleurs ne sont pas perdus quand on change un autre détail", async () => {
  const { fusionner } = await calc();
  const courante = { ...base, details: { envois: { client: "2026-11-12" } }, updated_at: "t2" };
  const f = fusionner(base, { details: { envois: {}, avis_demande_le: "2026-11-12" } }, courante);
  assert.deepEqual(f.conflits, []);
  assert.deepEqual(f.patch, { details: { envois: { client: "2026-11-12" }, avis_demande_le: "2026-11-12" } });
});

test("résolution : garder la sienne ou garder la mienne pour les champs en conflit", async () => {
  const { fusionner, appliquerChoix } = await calc();
  const courante = { ...base, heure_pickup: "09:00", updated_at: "t2" };
  const f = fusionner(base, { heure_pickup: "08:30", notes: "Bagages" }, courante);
  assert.deepEqual(appliquerChoix(f, "sien"), { notes: "Bagages" });
  assert.deepEqual(appliquerChoix(f, "miens"), { notes: "Bagages", heure_pickup: "08:30" });
  const objet = fusionner(base, { personnes: { adultes: 4, enfants: 1 } }, { ...base, personnes: { adultes: 3, enfants: 0 }, updated_at: "t2" });
  assert.deepEqual(appliquerChoix(objet, "miens"), { personnes: { adultes: 4, enfants: 1 } });
  assert.deepEqual(appliquerChoix(objet, "sien"), { personnes: { adultes: 3, enfants: 1 } });
});

test("updated_at et modifie_par ne sont jamais traités comme une saisie", async () => {
  const { fusionner } = await calc();
  const f = fusionner(base, { updated_at: "x", modifie_par: "u", notes: "n" }, { ...base, updated_at: "t2", modifie_par: "v" });
  assert.deepEqual(f, { patch: { notes: "n" }, conflits: [] });
});

// ---- modifierProtege avec un faux magasin qui pose les versions comme la base ----
async function banc(initial) {
  const e = await import("../src/gestion/js/etat.mjs");
  const tables = ["clients", "dossiers", "catalogue", "partenaires", "partenaires_prives", "prestations", "prestations_nets", "trajets", "trajets_nets", "reservations", "reservations_nets", "documents", "paiements", "taches"];
  let n = 1;
  const base = { entites: [{ id: "e", slug: "secret", actif: true, ordre: 1, nom: "S" }], roles: [], profils: [{ user_id: "jeremy", nom: "Jérémy" }, { user_id: "anais", nom: "Anaïs" }], membres: [], reglages: { e: {} }, reglages_maj: {} };
  for (const t of tables) base[t] = [];
  base.reservations = [{ ...initial, entite_id: "e", updated_at: "v1" }];
  const serveur = structuredClone(base);
  const ecritures = [];
  e.etat.moi = { user_id: "anais", super_admin: true, actif: true };
  e.etat.entiteId = "e";
  e.etat.brut = structuredClone(base);
  e.etat.store = {
    mode: "test",
    async charger() { return structuredClone(serveur); },
    async modifier(table, id, patch, avant) {
      const l = serveur[table].find((x) => x.id === id);
      if (avant && l.updated_at !== avant) throw Object.assign(new Error("conflit"), { conflit: true });
      ecritures.push(patch);
      Object.assign(l, patch, { updated_at: `v${++n}`, modifie_par: "jeremy" });
      return structuredClone(l);
    },
  };
  // L'autre personne écrit directement sur le « serveur » (sans que notre état le sache).
  const autre = (patch) => Object.assign(serveur.reservations[0], patch, { updated_at: `v${++n}`, modifie_par: "jeremy" });
  return { e, serveur, autre, ecritures };
}
const r0 = { id: "r1", heure_pickup: "", personnes: { adultes: 2, enfants: 0 }, notes: "" };

test("modifierProtege : personne d'autre n'a écrit, l'écriture passe telle quelle", async () => {
  const { e, serveur } = await banc(r0);
  const base = e.etat.brut.reservations[0];
  const r = await e.modifierProtege("reservations", "r1", { heure_pickup: "08:30" }, { base, arbitrer: async () => assert.fail("pas de question") });
  assert.equal(r.heure_pickup, "08:30");
  assert.equal(serveur.reservations[0].heure_pickup, "08:30");
});

test("modifierProtege : champs différents, rien n'est perdu et rien n'est demandé", async () => {
  const { e, serveur, autre, ecritures } = await banc(r0);
  const base = e.etat.brut.reservations[0];
  autre({ personnes: { adultes: 3, enfants: 0 } }); // Jérémy, sur l'ordinateur
  const r = await e.modifierProtege("reservations", "r1", { heure_pickup: "08:30", personnes: { adultes: 2, enfants: 0 } }, { base, arbitrer: async () => assert.fail("pas de question") });
  assert.equal(serveur.reservations[0].heure_pickup, "08:30");
  assert.deepEqual(serveur.reservations[0].personnes, { adultes: 3, enfants: 0 }, "les personnes de Jérémy sont restées");
  assert.deepEqual(ecritures, [{ heure_pickup: "08:30" }], "seul le champ d'Anaïs est écrit");
  assert.equal(r.heure_pickup, "08:30");
});

test("modifierProtege : même champ, la fenêtre reçoit les deux valeurs et le nom de l'autre, « miens » gagne", async () => {
  const { e, serveur, autre } = await banc(r0);
  const base = e.etat.brut.reservations[0];
  autre({ heure_pickup: "09:00" });
  let vu = null;
  await e.modifierProtege("reservations", "r1", { heure_pickup: "08:30", notes: "Bagages" }, { base, arbitrer: async (q) => ((vu = q), "miens") });
  assert.equal(vu.par, "Jérémy");
  assert.deepEqual(vu.conflits, [{ cle: "heure_pickup", base: "", sienne: "09:00", mienne: "08:30" }]);
  assert.equal(serveur.reservations[0].heure_pickup, "08:30");
  assert.equal(serveur.reservations[0].notes, "Bagages");
});

test("modifierProtege : « sien » garde l'autre valeur mais écrit le reste ; renoncer n'écrit rien", async () => {
  const { e, serveur, autre } = await banc(r0);
  const base = e.etat.brut.reservations[0];
  autre({ heure_pickup: "09:00" });
  await e.modifierProtege("reservations", "r1", { heure_pickup: "08:30", notes: "Bagages" }, { base, arbitrer: async () => "sien" });
  assert.equal(serveur.reservations[0].heure_pickup, "09:00");
  assert.equal(serveur.reservations[0].notes, "Bagages");
  const b2 = await banc(r0);
  b2.autre({ heure_pickup: "09:00" });
  await assert.rejects(() => b2.e.modifierProtege("reservations", "r1", { heure_pickup: "08:30" }, { base: b2.e.etat.brut.reservations[0], arbitrer: async () => null }), (err) => err.annule === true);
  assert.equal(b2.serveur.reservations[0].heure_pickup, "09:00");
});

test("modifierProtege : une synchronisation entre-temps n'efface pas le conflit (la version vue à l'ouverture sert de référence)", async () => {
  const { e, serveur, autre } = await banc(r0);
  const base = e.etat.brut.reservations[0]; // ouverte à v1
  autre({ personnes: { adultes: 4, enfants: 0 } });
  e.etat.brut.reservations[0] = structuredClone(serveur.reservations[0]); // la synchro apporte la version de l'autre dans l'état
  await e.modifierProtege("reservations", "r1", { heure_pickup: "08:30" }, { base, arbitrer: async () => assert.fail("pas de question") });
  assert.deepEqual(serveur.reservations[0].personnes, { adultes: 4, enfants: 0 });
  assert.equal(serveur.reservations[0].heure_pickup, "08:30");
});

test("modifierProtege : sans version (avant la migration), l'écriture passe comme avant", async () => {
  const { e, serveur } = await banc(r0);
  delete e.etat.brut.reservations[0].updated_at;
  const base = e.etat.brut.reservations[0];
  await e.modifierProtege("reservations", "r1", { notes: "x" }, { base, arbitrer: async () => assert.fail("pas de question") });
  assert.equal(serveur.reservations[0].notes, "x");
});
