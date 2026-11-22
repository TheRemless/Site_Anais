// Onglet « Assistant » : logique pure de l'écran (flux, fil, liste, cartes vers les écrans de l'outil) et démonstration (cas Jai Tiki).
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentActif, lireMorceau, filDepuis, listeConversations, quand, propositionDepuisCarte, reservationDepuisCarte, reservationModifiee, lignesFrise, titreDepuis } from "../src/gestion/js/agent-calc.mjs";
import { lireCourse, lireComplements, repondreDemo } from "../src/gestion/js/agent-demo.mjs";
import { planifierCourse } from "../src/gestion/js/agent-planifier.mjs";

test("agent allumé par entreprise, indépendamment de l'assistant de lecture", () => {
  assert.equal(agentActif({ agent_ia: true }), true);
  assert.equal(agentActif({ assistant_ia: true }), false);
  assert.equal(agentActif(null), false);
});

test("flux : lignes coupées entre deux morceaux, ligne illisible ignorée", () => {
  let r = lireMorceau("", '{"t":"etape","outil":"x"}\n{"t":"tex');
  assert.deepEqual(r.evenements, [{ t: "etape", outil: "x" }]);
  r = lireMorceau(r.tampon, 'te","delta":"Bonjour"}\npas du json\n');
  assert.deepEqual(r.evenements, [{ t: "texte", delta: "Bonjour" }]);
  assert.equal(r.tampon, "");
});

test("fil : messages, frise depuis le résultat de planifier_course, cartes à leur place, sans réflexion ni appels d'outils", () => {
  const plan = planifierCourse({ date: "2026-11-21", points: [{ lieu: "A" }, { lieu: "B", arrivee_voulue: "16:00" }], trajets: [{ duree_min: 60 }] });
  const messages = [
    { role: "user", contenu: [{ type: "text", text: "Course samedi" }], cree_le: "2026-11-19T10:00:00Z" },
    { role: "assistant", contenu: [{ type: "thinking", thinking: "" }, { type: "tool_use", id: "u1", name: "planifier_course", input: {} }], cree_le: "2026-11-19T10:00:01Z" },
    { role: "user", contenu: [{ type: "tool_result", tool_use_id: "u1", content: JSON.stringify(plan) }], cree_le: "2026-11-19T10:00:02Z" },
    { role: "assistant", contenu: [{ type: "tool_use", id: "u2", name: "proposer_reponse", input: {} }], cree_le: "2026-11-19T10:00:03Z" },
    { role: "user", contenu: [{ type: "tool_result", tool_use_id: "u2", content: "{}" }], cree_le: "2026-11-19T10:00:05Z" },
    { role: "assistant", contenu: [{ type: "text", text: "Pickup à 14:50." }], cree_le: "2026-11-19T10:00:06Z" },
  ];
  const cartes = [{ id: "k", genre: "reponse", cree_le: "2026-11-19T10:00:04Z" }];
  assert.deepEqual(filDepuis(messages, cartes).map((x) => x.genre), ["personne", "planning", "carte", "agent"]);
});

test("liste : ouvertes ou archivées, la plus récente en haut, propositions en attente comptées", () => {
  const c = [
    { id: "a", statut: "ouverte", maj_le: "2026-11-19T08:00:00Z" },
    { id: "b", statut: "ouverte", maj_le: "2026-11-19T09:00:00Z" },
    { id: "c", statut: "archivee", maj_le: "2026-11-19T10:00:00Z" },
  ];
  const l = listeConversations(c, { enAttente: new Map([["a", 2]]) });
  assert.deepEqual(l.map((x) => x.id), ["b", "a"]);
  assert.equal(l[1].attente, 2);
  assert.deepEqual(listeConversations(c, { archives: true }).map((x) => x.id), ["c"]);
  const maintenant = new Date("2026-11-19T12:00:00Z");
  assert.equal(quand("2026-11-19T07:05:00Z", { maintenant }), "14:05");
  assert.equal(quand("2026-11-18T07:05:00Z", { maintenant }), "hier");
  assert.equal(titreDepuis("Course Jai Tiki"), "Course Jai Tiki");
});

test("carte dossier vers la fiche de création : transfert privé hors catalogue sans prix, ligne du catalogue gardée", () => {
  const p = propositionDepuisCarte({ client: { nom: "Claire", hotel: "Hotel Sunset" }, adultes: 2, services: [{ texte: "Course", offre: null, date: "2026-11-21", heure_pickup: "12:30", de: "A", vers: "B", adultes: 2, remarque: "Vol à 20:00" }, { texte: "Ferry", offre: { genre: "trajet", id: "t" }, date: "2026-11-22", heure_pickup: "" }] });
  assert.equal(p.services[0].hors_catalogue, true);
  assert.equal(p.services[0].heure, "12:30");
  assert.deepEqual(p.services[1].offre, { genre: "trajet", id: "t" });
  assert.equal(p.client.adultes, 2);
  assert.equal(p.remarques, "Vol à 20:00");
});

test("carte dossier : un prix tapé par la personne et le lieu de pickup passent à la fiche, jamais un prix du modèle", async () => {
  const { propositionVersDemande } = await import("../src/gestion/js/assistant-calc.mjs");
  const carte = { client: { nom: "Tom" }, adultes: 2, services: [
    { texte: "Course privée", offre: null, date: "2026-11-21", heure_pickup: "13:20", lieu_pickup: "Jai Tiki Retreat", de: "", vers: "Krabi Nakharin", adultes: 2, prix: 3500, origine_prix: "saisi" },
    { texte: "Course sans prix", offre: null, date: "2026-11-21", prix: 9999, origine_prix: "a_fixer" },
  ] };
  const p = propositionDepuisCarte(carte);
  assert.equal(p.services[0].prix_libre, 3500);
  assert.equal(p.services[0].lieu_pickup, "Jai Tiki Retreat");
  assert.equal(p.services[1].prix_libre, null, "un prix qui ne vient pas de la personne ne passe pas");
  const { services } = propositionVersDemande(p, { prestations: [], trajets: [], partenaires: [] });
  assert.equal(services[0].prixLibre, 3500);
  assert.deepEqual(services[0].transfertLibre, { de: "Jai Tiki Retreat", vers: "Krabi Nakharin" });
  assert.equal(services[1].prixLibre, null);
});

test("carte modification : annulation d'un service par le formulaire habituel (statut annulé)", () => {
  const r = { id: "r", statut: "confirme", personnes: { adultes: 2 } };
  assert.equal(reservationModifiee(r, { champ: "annulation", valeur: "annule" }).statut, "annule");
  assert.equal(reservationModifiee(r, { champ: "annulation", valeur: "autre" }).statut, "confirme");
});

test("Assistant seule entrée : validation d'un geste par le code habituel, Tout valider, passage à l'entreprise de taxi", async () => {
  const { readFileSync } = await import("node:fs");
  const lire = (f) => readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");
  const agent = lire("views/agent.mjs");
  // Le devis calculé sur la carte passe par donneesCarte (« Calculer le devis », 22.11.2026).
  assert.match(agent, /ouvrirDemande\(null, preparation\(\{ \.\.\.c, donnees: donneesCarte\(c\) \}\), \{ auto: true, titre: c\.titre, surCree: \(\) => \{\} \}\)/, "dossier : la fiche de création, cachée");
  assert.match(agent, /formulaireReservation\(valeurs, /, "service et modification : le formulaire de réservation habituel");
  assert.match(agent, /function toutValider\(btn\)/);
  assert.match(agent, /envoyerVoucher\(x\)/, "voucher et WhatsApp après validation");
  assert.match(agent, /demandeDeTaxi\(t, lireMessage\(t, aujourdhui\(\)\)\)/, "Transfer request : passage à Taxi");
  const fiche = lire("views/demande.mjs");
  assert.match(fiche, /export function ouvrirDemande\(depuisSite = null, depuisItineraire = null, options = \{\}\)/);
  assert.match(fiche, /if \(!depuisSite && !depuisItineraire\) return null;/, "plus de saisie libre");
  assert.match(lire("ui.mjs"), /if \(cache\) fond\.hidden = true;/);
});

test("cartes service et modification vers le formulaire de réservation", () => {
  const r = reservationDepuisCarte({ dossier_id: "d", service: { libelle: "Transfert", date: "2026-11-21", heure_pickup: "12:30", lieu_pickup: "Hôtel", adultes: 2, prix: null, offre: { genre: "trajet", id: "t" } } });
  assert.equal(r.trajet_id, "t");
  assert.equal(r.montant_vente, null);
  const avant = { id: "r", heure_pickup: "09:00", personnes: { adultes: 2 }, notes: "" };
  assert.equal(reservationModifiee(avant, { champ: "heure_pickup", valeur: "08:30" }).heure_pickup, "08:30");
  assert.equal(reservationModifiee(avant, { champ: "adultes", valeur: "3" }).personnes.adultes, 3);
  assert.equal(avant.heure_pickup, "09:00");
});

test("frise : pickup, rendez-vous avec arrivée prévue, attente, fourchette à l'arrivée", () => {
  const plan = planifierCourse({ date: "2026-11-21", points: [{ lieu: "Hôtel" }, { lieu: "Hôpital", arrivee_voulue: "16:00", attente_min: 60 }, { lieu: "Aéroport" }], trajets: [{ duree_min: 160, ferry: true }, { duree_min: 25 }] });
  const l = lignesFrise(plan);
  assert.deepEqual(l.map((x) => x.heure), ["12:30", "16:00", "17:25"]);
  assert.equal(l[1].rendezVous, true);
  assert.equal(l[1].depart, "17:00");
  assert.deepEqual(l[2].fourchette, ["17:25", "17:35"]);
});

test("démo, cas Jai Tiki : lecture de la demande, puis vol, personnes et bagages, cartes sans prix ni signature", async () => {
  const texte = "Client taxi : pickup à Jai Tiki Retreat, Koh Lanta samedi, il doit être au Krabi Nakharin International Hospital vers 16h00, attente d’environ 1 h, puis aéroport de Krabi.";
  const c = lireCourse(texte, "2026-11-19");
  assert.equal(c.pickup, "Jai Tiki Retreat, Koh Lanta");
  assert.equal(c.rdv, "Krabi Nakharin International Hospital");
  assert.equal(c.heureRdv, "16:00");
  assert.equal(c.attente, 60);
  assert.equal(c.date, "2026-11-21");
  // « International Hospital » ne fait pas un vol international.
  assert.equal(lireComplements(texte).international, false);
  const un = await repondreDemo(texte, { aujourdhui: "2026-11-19" });
  const plan = un.evenements.find((e) => e.t === "planning").planning;
  assert.equal(plan.pickup.heure, "12:30");
  assert.ok(!un.evenements.some((e) => e.t === "carte"), "pas de carte tant que le vol et les personnes manquent");
  assert.match(un.evenements.find((e) => e.t === "texte").delta, /l'heure du vol, le nombre de personnes et les bagages/);
  const deux = await repondreDemo("Vol à 20h00. 2 personnes, 3 valises.", { aujourdhui: "2026-11-19", etat: un.etat });
  assert.equal(deux.evenements.find((e) => e.t === "planning").planning.vol.verdict, "tenable");
  const dossier = deux.evenements.find((e) => e.carte && e.carte.genre === "dossier").carte;
  assert.ok(dossier.donnees.services.every((s) => s.prix === null));
  const rep = deux.evenements.find((e) => e.carte && e.carte.genre === "reponse").carte.donnees.message;
  assert.ok(!/Nani|Have a nice day/.test(rep));
  assert.ok(rep.includes("12:30"));
});

test("démo : vol pas tenable, pas de carte ; demande sans course, explication", async () => {
  const un = await repondreDemo("pickup à Jai Tiki Retreat, Koh Lanta samedi, Krabi Nakharin International Hospital vers 16h00, attente d’environ 1 h, puis aéroport de Krabi", { aujourdhui: "2026-11-19" });
  const deux = await repondreDemo("vol à 18h30, 2 personnes, 1 valise", { aujourdhui: "2026-11-19", etat: un.etat });
  assert.equal(deux.evenements.find((e) => e.t === "planning").planning.vol.verdict, "pas_tenable");
  assert.ok(!deux.evenements.some((e) => e.t === "carte"));
  assert.match((await repondreDemo("Bonjour", { aujourdhui: "2026-11-19" })).evenements[0].delta, /démonstration/);
});

test("démo : une durée de la table de l'entreprise passe avant les temps simulés", async () => {
  const lignes = [{ de: "Koh Lanta", vers: "Krabi", mode: "route", duree_min: 120, ferry: true, marge_min: 0, a_verifier: false }];
  const r = await repondreDemo("pickup à Lanta Sand Resort Koh Lanta samedi, Krabi Nakharin International Hospital vers 16h00", { aujourdhui: "2026-11-19", lignes });
  const plan = r.evenements.find((e) => e.t === "planning").planning;
  assert.equal(plan.trajets[0].source, "table");
  assert.equal(plan.trajets[0].route_min, 120);
});

test("pré-remplissage : pages taxi seulement pour l'organisation de Lanta, grilles de pickup sans nom de partenaire", async () => {
  const { readFileSync } = await import("node:fs");
  const { ROUTES_SITE } = await import("../src/gestion/js/temps-site.mjs");
  const site = JSON.parse(readFileSync(new URL("../src/_data/taxiRoutes.json", import.meta.url), "utf8")).routes.filter((r) => typeof r.drive === "string").map((r) => ({ from: r.from, to: r.to, drive: r.drive }));
  assert.deepEqual(ROUTES_SITE, site, "temps-site.mjs suit src/_data/taxiRoutes.json");
});

test("démo : avec la liaison de ferry de la table, le trajet se calcule en trois morceaux et le détail est dit", async () => {
  const { LIAISON_LANTA } = await import("../src/gestion/js/temps-site.mjs");
  const liaisons = [LIAISON_LANTA];
  const r = await repondreDemo("Client taxi : pickup à Jai Tiki Retreat, Koh Lanta samedi, il doit être au Krabi Nakharin International Hospital vers 16h00, puis aéroport de Krabi.", { aujourdhui: "2026-11-19", liaisons });
  const plan = r.evenements.find((e) => e.t === "planning").planning;
  assert.deepEqual(plan.trajets[0].morceaux.map((m) => m.duree_min), [25, 60, 70]);
  // 25 + 60 + 70 de route et de ferry, marge 10 min : 2 h 45 avant 16:00.
  assert.equal(plan.pickup.heure, "13:15");
  assert.match(r.evenements.find((e) => e.t === "texte").delta, /ferry : 1 h/);
});
