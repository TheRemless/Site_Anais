// Espace unifié Secret et Taxi, l'écran (migration 63, PR 3, 20.11.2026) : badge d'entreprise par service, deux dossiers liés pour une carte
// mixte, lien vers le dossier lié, conversations de l'Assistant des deux entreprises, WhatsApp commun en lecture, doublons. Logique pure,
// démo et branchement.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as U from "../src/gestion/js/espace-unifie-calc.mjs";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (f) => fs.readFileSync(path.join(RACINE, "src/gestion/js", f), "utf8");
const SECRET = { id: "s", slug: "secret", nom: "Secret Travel & Tour" };
const TAXI = { id: "t", slug: "taxi", nom: "VIP Taxi Lanta" };
const ZTP = { id: "z", slug: "ztp", nom: "Zwald Travel Planner" };
const ADMIN = ["partenaires.lire", "dossiers.ecrire", "clients.lire", "clients.ecrire", "reglages.ecrire"];

test("espace unifié : Secret et Taxi avec les droits dans les deux, jamais ZTP ni une seule entreprise", () => {
  const tout = () => ADMIN;
  assert.deepEqual(U.espaceUnifie({ entites: [ZTP, SECRET, TAXI], activeId: "s", permissionsDe: tout }).autre, TAXI);
  assert.deepEqual(U.espaceUnifie({ entites: [ZTP, SECRET, TAXI], activeId: "t", permissionsDe: tout }).autre, SECRET);
  assert.equal(U.espaceUnifie({ entites: [ZTP, SECRET, TAXI], activeId: "z", permissionsDe: tout }), null, "ZTP reste à part");
  assert.equal(U.espaceUnifie({ entites: [SECRET], activeId: "s", permissionsDe: tout }), null);
  assert.equal(U.espaceUnifie({ entites: [SECRET, TAXI], activeId: "t", permissionsDe: (id) => (id === "t" ? ["dossiers.ecrire", "vouchers.seul"] : []) }), null, "Mook : rien ne change");
  assert.equal(U.marqueUnifiee({ slug: "excursions" }), "secret", "la démo appelle Secret « excursions »");
});

test("badge par service : carte unifiée, correction d'un tap, entreprise à choisir", () => {
  const donnees = { entreprises: ["secret"], services: [{ libelle: "4 Islands", entite_id: "s", entreprise: "secret" }, { libelle: "Dîner", entite_id: null, entreprise: "", avertissements: ["entreprise_a_choisir"] }] };
  assert.equal(U.carteUnifiee(donnees), true);
  assert.equal(U.carteUnifiee({ services: [{ libelle: "x" }] }), false, "sans entite_id (serveur sans AGENT_UNIFIE) : comportement actuel");
  const corrigee = U.avecCorrections(donnees, { 1: { id: "t", slug: "taxi" } });
  assert.equal(corrigee.services[1].entite_id, "t");
  assert.deepEqual(corrigee.services[1].avertissements, [], "l'avertissement tombe une fois l'entreprise choisie");
  assert.deepEqual(corrigee.entreprises, ["secret", "taxi"]);
  assert.equal(donnees.services[1].entite_id, null, "la carte d'origine ne change pas");
  assert.equal(U.entrepriseSuivante({ entite_id: null }, [SECRET, TAXI]), SECRET);
  assert.equal(U.entrepriseSuivante({ entite_id: "s" }, [SECRET, TAXI]), TAXI);
  assert.equal(U.entrepriseSuivante({ entite_id: "t" }, [SECRET, TAXI]), SECRET, "en boucle");
  const { groupes, sansEntreprise } = U.groupesParEntreprise(donnees.services);
  assert.deepEqual(sansEntreprise, [1]);
  assert.deepEqual([...groupes.keys()], ["s"]);
});

test("plan de création : un dossier par entreprise, l'active d'abord, tout vérifié avant d'écrire", () => {
  const services = [{ entite_id: "t", libelle: "Taxi" }, { entite_id: "s", libelle: "Excursion" }, { entite_id: "s", libelle: "Bateau" }];
  const tout = () => ADMIN;
  const p = U.planCreation({ services, activeId: "s", permissionsDe: tout, partagePermis: () => true });
  assert.equal(p.ok, true);
  assert.equal(p.mixte, true);
  assert.deepEqual(p.etapes.map((e) => [e.entite_id, e.services.length]), [["s", 2], ["t", 1]], "la fiche est créée dans l'entreprise active");
  assert.deepEqual(U.planCreation({ services: [{ entite_id: "t" }], activeId: "s", permissionsDe: tout }).etapes.map((e) => e.entite_id), ["t"], "une seule autre entreprise : le dossier se crée chez elle");
  assert.equal(U.planCreation({ services: [...services, { entite_id: null }], activeId: "s", permissionsDe: tout, partagePermis: () => true }).motif, "entreprise_a_choisir");
  assert.equal(U.planCreation({ services, activeId: "s", permissionsDe: (id) => (id === "t" ? ["clients.lire"] : ADMIN), partagePermis: () => true }).motif, "droit_dossier:t", "pas le droit d'écrire chez Taxi : rien n'est créé");
  assert.equal(U.planCreation({ services, activeId: "s", permissionsDe: tout, partagePermis: () => false }).motif, "partage:t", "la fiche ne passerait pas chez Taxi : rien n'est créé");
  assert.equal(U.planCreation({ services, activeId: "s", permissionsDe: (id) => (id === "s" ? ["dossiers.ecrire"] : ADMIN), partagePermis: () => true, nouveauClient: true }).motif, "droit_client:s");
  assert.equal(U.planCreation({ services: [], activeId: "s", permissionsDe: tout }).motif, "aucun_service");
});

test("partage réciproque Secret et Taxi : qui lit tous les clients de la source et écrit des dossiers dans la cible ; ZTP reste à l'administration", () => {
  const partages = [{ source_id: "s", cible_id: "t" }, { source_id: "t", cible_id: "s" }, { source_id: "z", cible_id: "s" }];
  assert.equal(U.partageReciproque(partages, "s", "t"), true);
  assert.equal(U.partageReciproque(partages, "z", "s"), false);
  const mook = { permissionsSource: ["clients.lire"], permissionsCible: ["dossiers.ecrire"], voitToutSource: true };
  assert.equal(U.partageClientsPermisUnifie({ ...mook, reciproque: true }), true);
  assert.equal(U.partageClientsPermisUnifie({ ...mook, reciproque: false }), false, "sans réciprocité (ZTP) : l'administration seulement");
  assert.equal(U.partageClientsPermisUnifie({ ...mook, voitToutSource: false, reciproque: true }), false);
  assert.equal(U.partageClientsPermisUnifie({ permissionsSource: [], permissionsCible: [], superAdmin: true }), false, "écrire des dossiers dans la cible reste nécessaire");
  assert.match(source("etat.mjs"), /partageClientsPermisUnifie\(\{ superAdmin: estSuperAdmin\(\)/);
});

test("dossier lié : lien seulement vers un dossier lisible d'une autre entreprise ; envois Secret puis Taxi", () => {
  const dossiers = [{ id: "a", entite_id: "s", ref: "EX-1", dossier_lie_id: "b" }, { id: "b", entite_id: "t", ref: "TX-1", dossier_lie_id: "a" }, { id: "c", entite_id: "s", dossier_lie_id: "invisible" }];
  assert.deepEqual(U.dossierLie(dossiers[0], dossiers, [SECRET, TAXI]), { id: "b", ref: "TX-1", entite_id: "t", entreprise: "Taxi" });
  assert.deepEqual(U.dossierLie(dossiers[1], dossiers, [SECRET, TAXI]).entreprise, "Secret");
  assert.equal(U.dossierLie(dossiers[2], dossiers, [SECRET, TAXI]), null, "pas lisible : pas de lien");
  assert.equal(U.dossierLie({ id: "x" }, dossiers, []), null);
  assert.deepEqual(U.ordreEnvois([dossiers[1], dossiers[0]], [SECRET, TAXI]).map((d) => d.id), ["a", "b"], "voucher Secret, puis Booking confirmation Taxi");
  assert.match(source("views/dossier.mjs"), /href: `#\/dossier\/\$\{l\.id\}\?entite=\$\{l\.entite_id\}`/, "ouvrir le lien bascule l'entreprise active");
});

test("Assistant : conversations des deux entreprises avec leur badge, les plus récentes d'abord", () => {
  const liste = U.conversationsDesDeux([
    { entite: SECRET, conversations: [{ id: "1", maj_le: "2026-11-20T08:00:00Z" }] },
    { entite: TAXI, conversations: [{ id: "2", maj_le: "2026-11-20T09:00:00Z" }] },
  ]);
  assert.deepEqual(liste.map((c) => [c.id, c.entite_id, c.entreprise]), [["2", "t", "Taxi"], ["1", "s", "Secret"]]);
  const agent = source("views/agent.mjs");
  assert.match(agent, /changerEntite\(c\.entite_id, \{ naviguer: false \}\);\n\s+naviguer\(`#\/agent\/\$\{c\.id\}`\);/, "ouvrir une conversation de l'autre entreprise bascule l'entreprise active");
  assert.match(agent, /const unifie = espaceUnifie\(\{ entites: entitesAccessibles\(\), activeId: etat\.entiteId, permissionsDe \}\);/);
});

test("WhatsApp commun en lecture : écrire seulement dans l'entreprise qu'on administre", () => {
  assert.equal(U.ecritConversation({ entite_id: "s" }, ["s"]), true);
  assert.equal(U.ecritConversation({ entite_id: "t" }, ["s"]), false, "conversation de Taxi pour une administratrice de Secret : lecture seule");
  assert.equal(U.ecritConversation({ entite_id: null }, ["s"]), true, "à trier : l'une des deux suffit");
  assert.equal(U.ecritConversation({ entite_id: null }, []), false);
  const vue = source("views/whatsapp.mjs");
  assert.match(vue, /tr\("Lecture seule : conversation de \{entreprise\}"/);
  for (const garde of ["if (lectureSeule) return null;", "lectureSeule ? null : h(\"div\", { class: \"wa-prop-suite\" }", "!lectureSeule && dernier && dernier.sens === \"entrant\"", "if (!peutEcrire(c)) return false;"]) assert.ok(vue.includes(garde), garde);
});

test("doublons Secret et Taxi : même téléphone ou même nom, la plus ancienne d'abord ; fusion réservée à l'administration", () => {
  const clients = [
    { id: "1", entite_id: "s", prenom: "Ben", nom: "Walker", telephone: "+44 7700 900111", created_at: "2026-01-01" },
    { id: "2", entite_id: "t", prenom: "Benjamin", nom: "W", telephone: "07700900111", created_at: "2026-02-01" },
    { id: "3", entite_id: "t", prenom: "Léa", nom: "Moreau", telephone: "", created_at: "2026-03-01" },
    { id: "4", entite_id: "s", prenom: "Lea", nom: "MOREAU", telephone: "", created_at: "2026-04-01" },
    { id: "5", entite_id: "s", prenom: "Ben", nom: "Walker", telephone: "", created_at: "2026-05-01" },
    { id: "6", entite_id: "z", prenom: "Ben", nom: "Walker", telephone: "+44 7700 900111", created_at: "2026-01-02" },
  ];
  const d = U.doublonsLocaux(clients, [SECRET, TAXI, ZTP]);
  assert.deepEqual(d.map((x) => [x.fiche_a, x.fiche_b, x.raison]), [["1", "2", "téléphone"], ["3", "4", "nom"]], "jamais deux fiches d'une même entreprise, jamais ZTP");
  assert.equal(U.voitDoublons([SECRET, TAXI], () => ["clients.lire"], () => true), true);
  assert.equal(U.voitDoublons([SECRET, TAXI], (id) => (id === "s" ? ["clients.lire"] : []), () => true), false);
  assert.equal(U.peutFusionnerEntreprises({ a: ["reglages.ecrire"], b: ["reglages.ecrire"] }), true);
  assert.equal(U.peutFusionnerEntreprises({ a: ["reglages.ecrire"], b: ["clients.fusionner"] }), false);
  assert.equal(U.peutFusionnerEntreprises({ superAdmin: true }), true);
  assert.match(source("views/doublons-unifies.mjs"), /fusion \? h\("button", \{ class: "secondaire petit", type: "button", onclick: \(\) => ouvrirFusion\(p, charger\) \}, tr\("Fusionner"\)\) : null/);
  assert.match(source("store-supabase.mjs"), /sb\.rpc\("doublons_clients_partages"\)/);
});

test("Assistant : validation refusée sans rien écrire, écriture dans l'entreprise du dossier visé", () => {
  const agent = source("views/agent.mjs");
  assert.match(agent, /else if \(c\.genre === "dossier" && carteUnifiee\(c\.donnees\)\) r = await validerUnifie\(c\);/);
  assert.match(agent, /entreprise_a_choisir: \(\) => tr\("Choisissez Secret ou Taxi"\)/);
  assert.match(agent, /await modifier\("dossiers", crees\[0\]\.id, \{ dossier_lie_id: crees\[1\]\.id \}\);\n\s+await modifier\("dossiers", crees\[1\]\.id, \{ dossier_lie_id: crees\[0\]\.id \}\);/, "dossier_lie_id des deux côtés");
  assert.match(agent, /r = await dansEntreprise\(entiteVisee\(c\), \(\) => enregistrerReservation\(/, "service ajouté au dossier de l'autre entreprise");
  assert.match(agent, /if \(!permissionsDe\(id\)\.includes\("dossiers\.ecrire"\)\) return refusDroit\(id\);/);
  assert.match(source("views/demande.mjs"), /let clientId = options\.clientId \|\| "";/, "le second dossier reprend la même fiche");
});

test("démo : carte mixte, dossiers liés, doublons, conversations des deux entreprises, deux dossiers créés et liés", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?unifie=${Date.now()}`);
    const store = creer();
    let d = await store.charger();
    const exc = d.entites.find((e) => e.slug === "excursions");
    const taxi = d.entites.find((e) => e.slug === "taxi");
    const lies = d.dossiers.filter((x) => x.dossier_lie_id);
    assert.equal(lies.length, 2, "deux dossiers liés");
    assert.equal(lies[0].client_id, lies[1].client_id, "même fiche");
    assert.ok((await store.doublonsClients()).length >= 1, "au moins une fiche en double");
    assert.equal((await store.agentConversations(taxi.id)).length, 1, "une conversation de l'Assistant chez Taxi");
    for (const e of [exc, taxi]) await store.enregistrerReglages(e.id, { ...d.reglages[e.id], agent_ia: true });
    const evenements = [];
    assert.deepEqual(await store.agentEnvoyer({ entite_id: exc.id, texte: "Hi! 4 islands on Friday and a taxi from Krabi airport for 2 people", conversation_id: null }, (ev) => evenements.push(ev)), { ok: true });
    const carte = evenements.find((e) => e.t === "carte").carte;
    assert.deepEqual(carte.donnees.entreprises, ["secret", "taxi"]);
    assert.deepEqual(carte.donnees.services.map((s) => s.entite_id), [taxi.id, exc.id, null], "un service sans entreprise : à choisir");
    d = await store.charger();
    assert.ok(U.partageReciproque(d.partages_clients, exc.id, taxi.id), "la carte mixte pose le partage réciproque de la démo");
    // Les deux dossiers d'une carte mixte, sur la même fiche, liés des deux côtés (comme validerUnifie).
    const client = await store.inserer("clients", { entite_id: exc.id, prenom: "Clara", nom: "Martin", telephone: "+447700900966" });
    const d1 = await store.inserer("dossiers", { entite_id: exc.id, ref: "EX-MIXTE", client_id: client.id, annule: false });
    const d2 = await store.inserer("dossiers", { entite_id: taxi.id, ref: "TX-MIXTE", client_id: client.id, annule: false });
    await store.modifier("dossiers", d1.id, { dossier_lie_id: d2.id });
    const r2 = await store.modifier("dossiers", d2.id, { dossier_lie_id: d1.id });
    assert.equal(r2.dossier_lie_id, d1.id);
    // WhatsApp commun : la démo lit les conversations des deux entreprises.
    const ents = new Set(d.whatsapp_conversations.map((c) => c.entite_id).filter(Boolean));
    assert.ok(ents.has(exc.id) && ents.has(taxi.id));
  } finally {
    delete globalThis.localStorage;
  }
});
