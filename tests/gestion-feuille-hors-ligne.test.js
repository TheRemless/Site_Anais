import test from "node:test";
import assert from "node:assert/strict";
import { construireCopie, lireCopie, AGE_MAX_H } from "../src/gestion/js/feuille-hors-ligne-calc.mjs";

const brut = () => ({
  clients: [{ id: "c1", prenom: "Emma", nom: "Moreau", telephone: "+41791234567", adresse: "Hotel Sunset\nKoh Lanta", email: "secret@x.ch", notes: "note privée" }],
  dossiers: [{ id: "d1", entite_id: "e1", client_id: "c1", annule: false }, { id: "d2", entite_id: "e1", client_id: "c1", annule: true }, { id: "d3", entite_id: "e2", client_id: "c1", annule: false }],
  partenaires: [{ id: "p1", nom: "Longtail démo", contact: { telephones: [{ numero: "+66810000001", whatsapp: true }] } }],
  reservations: [
    { id: "r1", entite_id: "e1", dossier_id: "d1", partenaire_id: "p1", libelle: "4 îles", date_service: "2026-11-13", heure_pickup: "08:00", lieu_pickup: "Hotel Sunset", personnes: { adultes: 2, enfants: 1, bebes: 0 }, statut: "confirme", reference_partenaire: "EX-1", montant_vente: 4800, notes: "interne", details: { net: 3200 }, commission_prevue: 200 },
    { id: "r2", entite_id: "e1", dossier_id: "d1", partenaire_id: "p1", libelle: "Demain", date_service: "2026-11-14", heure_pickup: "09:00", personnes: { adultes: 1 }, statut: "demande" },
    { id: "r3", entite_id: "e1", dossier_id: "d1", partenaire_id: "p1", libelle: "Après-demain", date_service: "2026-11-15", personnes: { adultes: 1 }, statut: "confirme" },
    { id: "r4", entite_id: "e1", dossier_id: "d2", partenaire_id: "p1", libelle: "Dossier annulé", date_service: "2026-11-13", personnes: { adultes: 1 }, statut: "confirme" },
    { id: "r5", entite_id: "e2", dossier_id: "d3", partenaire_id: null, libelle: "Autre entreprise", date_service: "2026-11-13", personnes: { adultes: 3 }, statut: "confirme" },
  ],
});
const entites = [{ id: "e1", nom: "Secret" }, { id: "e2", nom: "Taxi" }];
const copie = () => construireCopie({ brut: brut(), entites, utilisateur: "u1", aujourdhui: "2026-11-13", maintenant: new Date("2026-11-13T01:00:00Z") });

test("copie : aujourd'hui et demain seulement, par entreprise, sans les dossiers annulés ni les autres jours", () => {
  const c = copie();
  assert.equal(c.version, 1);
  assert.deepEqual(c.entreprises.map((e) => e.nom), ["Secret", "Taxi"]);
  const secret = c.entreprises[0];
  assert.deepEqual(secret.jours.map((j) => j.date), ["2026-11-13", "2026-11-14"]);
  assert.deepEqual(secret.jours[0].groupes[0].lignes.map((l) => l.libelle), ["4 îles"], "le dossier annulé et le surlendemain sont absents");
  assert.deepEqual(secret.jours[1].groupes[0].lignes.map((l) => l.libelle), ["Demain"]);
  const g = secret.jours[0].groupes[0];
  assert.equal(g.nom, "Longtail démo");
  assert.equal(g.telephone, "+66810000001");
  assert.deepEqual([g.adultes, g.enfants], [2, 1]);
  assert.deepEqual([g.lignes[0].heure, g.lignes[0].hotel, g.lignes[0].telephone, g.lignes[0].client], ["08:00", "Hotel Sunset", "+41791234567", "Emma Moreau"]);
  assert.equal(c.entreprises[1].jours[0].groupes[0].lignes[0].libelle, "Autre entreprise", "chaque entreprise a ses propres réservations");
});

test("copie : aucun montant, net, commission, note interne, e-mail ni adresse complète ne part sur le téléphone", () => {
  const texte = JSON.stringify(copie());
  for (const interdit of ["montant", "4800", "3200", "net", "commission", "200,", "interne", "secret@x.ch", "note privée", "details"]) assert.ok(!texte.includes(interdit), `« ${interdit} » ne doit pas figurer dans la copie`);
  // Les champs d'une ligne sont ceux de la liste blanche, pas un « tout sauf » : une colonne ajoutée plus tard ne fuit pas.
  const ligne = copie().entreprises[0].jours[0].groupes[0].lignes[0];
  assert.deepEqual(Object.keys(ligne).sort(), ["adultes", "bebes", "chambre", "client", "enfants", "heure", "hotel", "libelle", "reference", "statut", "telephone"]);
});

test("lecture : acceptée si récente et de la même personne ; refusée sinon (autre personne, trop ancienne, illisible, autre version)", () => {
  const c = copie();
  const ok = lireCopie(c, { maintenant: new Date("2026-11-13T05:00:00Z"), utilisateur: "u1" });
  assert.equal(ok.ok, true);
  assert.equal(Math.round(ok.ageH), 4);
  assert.equal(lireCopie(JSON.stringify(c), { maintenant: new Date("2026-11-13T05:00:00Z") }).ok, true, "relue depuis le texte stocké");
  assert.equal(lireCopie(c, { maintenant: new Date("2026-11-13T05:00:00Z"), utilisateur: "u2" }).raison, "autre_personne");
  assert.equal(lireCopie(c, { maintenant: new Date(Date.parse("2026-11-13T01:00:00Z") + (AGE_MAX_H + 1) * 3600000) }).raison, "trop_ancienne");
  assert.equal(lireCopie(c, { maintenant: new Date("2026-11-12T00:00:00Z") }).ok, false, "une date dans le futur est refusée");
  assert.equal(lireCopie("pas du json").raison, "illisible");
  assert.equal(lireCopie({ version: 2, entreprises: [] }).raison, "illisible");
  assert.equal(lireCopie(null).raison, "illisible");
});

test("copie : une base vide donne une copie vide, sans planter", () => {
  const c = construireCopie({ brut: {}, entites: [{ id: "e", nom: "X" }], utilisateur: "u", aujourdhui: "2026-11-13" });
  assert.deepEqual(c.entreprises[0].jours.map((j) => j.groupes), [[], []]);
});
