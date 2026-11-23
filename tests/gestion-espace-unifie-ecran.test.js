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
  assert.match(agent, /const unifie = espaceUnifie\(\{ entites: entitesAccessibles\(\), activeId: etat\.entiteId, permissionsDe, agentActif: \(id\) => agentActif\(reglagesDe\(id\)\) \}\);/);
});

test("WhatsApp commun en lecture : écrire seulement dans l'entreprise qu'on administre", () => {
  assert.equal(U.ecritConversation({ entite_id: "s" }, ["s"]), true);
  assert.equal(U.ecritConversation({ entite_id: "t" }, ["s"]), false, "conversation de Taxi pour une administratrice de Secret : lecture seule");
  assert.equal(U.ecritConversation({ entite_id: null }, ["s"]), true, "à trier : l'une des deux suffit");
  assert.equal(U.ecritConversation({ entite_id: null }, []), false);
  const vue = source("views/whatsapp.mjs");
  assert.match(vue, /tr\("Lecture seule : conversation de \{entreprise\}"/);
  for (const garde of ["if (lectureSeule) return null;", "lectureSeule ? null : h(\"div\", { class: \"wa-prop-suite\" }", "!lectureSeule && reponsesDe(c) !== \"jamais\" && dernier && dernier.sens === \"entrant\"", "if (!peutEcrire(c)) return false;"]) assert.ok(vue.includes(garde), garde);
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
  assert.match(source("views/doublons-unifies.mjs"), /unSensPermis\(p\) \? h\("button", \{ class: "secondaire petit", type: "button", onclick: \(\) => ouvrirFusion\(p, charger\) \}, tr\("Fusionner"\)\) : null/);
  assert.match(source("store-supabase.mjs"), /sb\.rpc\("doublons_clients_partages"\)/);
});

test("Assistant : validation refusée sans rien écrire, écriture dans l'entreprise du dossier visé", () => {
  const agent = source("views/agent.mjs") + source("views/agent-valider.mjs");
  assert.match(agent, /else if \(c\.genre === "dossier" && carteUnifiee\(c\.donnees\)\) r = await validerUnifie\(c, \{ donnees: donneesCarte\(c\), libelleEntreprise \}\);/);
  assert.match(agent, /entreprise_a_choisir: \(\) => tr\("Choisissez Secret ou Taxi"\)/);
  assert.match(agent, /lier: \(a, b\) => lierDossiers\(a, b, modifier\)/, "dossier_lie_id des deux côtés");
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

// ---- Neuvième passe : corrections après la revue indépendante -------------------------------------------------------------------------

const ETAPES = [{ entite_id: "s", services: [{ libelle: "4 Islands" }] }, { entite_id: "t", services: [{ libelle: "Krabi Airport" }] }];

test("1. passe à blanc : un refus à l'étape 2 arrête tout avant la moindre écriture", async () => {
  const creations = [];
  const r = await U.creerDossiersLies({
    etapes: ETAPES,
    essayer: async (e) => (e.entite_id === "t" ? { ok: false, motif: "Indiquez le prix du transfert privé." } : { ok: true }),
    creer: async (e) => (creations.push(e.entite_id), { ok: true, dossier: { id: e.entite_id } }),
    defaire: async () => assert.fail("rien à défaire"),
  });
  assert.deepEqual(r, { ok: false, motif: "Indiquez le prix du transfert privé.", etape: 1, ecrit: false });
  assert.deepEqual(creations, [], "aucun dossier créé");
});

test("1. l'étape 2 échoue quand même : le dossier 1 va à la corbeille, ok:false, la carte reste à valider", async () => {
  const corbeille = [];
  const clients = [];
  const r = await U.creerDossiersLies({
    etapes: ETAPES,
    essayer: async () => ({ ok: true }),
    creer: async (e, i, clientId) => {
      clients.push(clientId);
      if (i === 1) throw new Error("numéro déjà pris");
      return { ok: true, dossier: { id: "d1", entite_id: e.entite_id, client_id: "c1", ref: "EX-1" } };
    },
    defaire: async (crees) => (corbeille.push(...crees.map((d) => d.id)), true),
    lier: async () => assert.fail("pas de lien sans les deux dossiers"),
  });
  assert.equal(r.ok, false);
  assert.equal(r.ecrit, true);
  assert.equal(r.defait, true);
  assert.equal(r.motif, "numéro déjà pris");
  assert.deepEqual(corbeille, ["d1"]);
  assert.deepEqual(clients, ["", "c1"], "le second dossier reprend la fiche du premier");
  // La corbeille refuse : toujours ok:false, et on le dit.
  const r2 = await U.creerDossiersLies({ etapes: ETAPES, essayer: async () => ({ ok: true }), creer: async (e, i) => (i ? { ok: false, motif: "x" } : { ok: true, dossier: { id: "d1" } }), defaire: async () => { throw new Error("droit"); } });
  assert.equal(r2.ok, false);
  assert.equal(r2.defait, false);
  // Jamais ok:true sans tous les dossiers : un dossier absent compte comme un échec.
  const r3 = await U.creerDossiersLies({ etapes: ETAPES, essayer: async () => ({ ok: true }), creer: async (e, i) => (i ? { ok: true } : { ok: true, dossier: { id: "d1" } }), defaire: async () => true });
  assert.equal(r3.ok, false);
  const agent = source("views/agent-valider.mjs");
  assert.match(agent, /essai: true, clientAVenir: i > 0/, "la passe à blanc passe par la fiche habituelle");
  assert.match(agent, /for \(const d of crees\) await dans\(d\.entite_id, \(\) => supprimerLigne\("dossiers", d\.id\)\);/, "la suppression existante, dans l'entreprise du dossier");
  // La vue a sa propre fonction supprimer() (la conversation) : la suppression d'un dossier passe par l'import renommé, jamais par elle.
  assert.match(agent, /supprimer as supprimerLigne/);
  const demande = source("views/demande.mjs");
  assert.ok(demande.indexOf("if (options.essai) {") > demande.indexOf("refExiste(ref)") && demande.indexOf("if (options.essai) {") < demande.indexOf("creation = true;\n    btn.disabled = true;"), "l'essai s'arrête après les contrôles, avant toute écriture");
});

test("1. badge : un service du catalogue garde l'entreprise de son catalogue", () => {
  assert.equal(U.badgeModifiable({ offre: { genre: "prestation", id: "p1" }, entite_id: "t" }), false);
  assert.equal(U.badgeModifiable({ offre: null, entite_id: null }), true);
  assert.match(source("views/agent.mjs"), /c\.statut !== "proposee" \|\| !badgeModifiable\(s\)\) return h\("span"/);
});

test("2 et 3. fenêtre dans l'autre entreprise : retour synchrone à la fermeture, aucun minuteur, rien d'ouvert : retour tout de suite", async () => {
  const fil = [];
  let entite = "s";
  const changer = (id) => (fil.push(id), (entite = id));
  let fermer = null;
  await U.ouvrirDansEntreprise({ id: "t", origine: "s", changer, charger: async () => "module", ouvrir: (m, revenir) => ((fermer = revenir), true) });
  assert.equal(entite, "t", "la fenêtre est ouverte dans Taxi");
  fermer();
  assert.equal(entite, "s", "retour dans le rappel de fermeture, sans attendre");
  fermer();
  assert.deepEqual(fil, ["t", "s"], "un seul retour");
  await U.ouvrirDansEntreprise({ id: "t", origine: "s", changer, ouvrir: () => false });
  assert.equal(entite, "s", "rien d'ouvert : retour immédiat");
  await assert.rejects(U.ouvrirDansEntreprise({ id: "t", origine: "s", changer, charger: async () => { throw new Error("import"); }, ouvrir: () => true }));
  assert.equal(entite, "s", "import en panne : retour quand même");
  const agent = source("views/agent.mjs");
  assert.doesNotMatch(agent, /setTimeout\(revenir/, "plus aucun minuteur");
  assert.doesNotMatch(agent, /entrerPourFenetre/);
  assert.match(agent, /envoyerVoucher\(x, \{ avantNavigation: revenir \}\)/);
  assert.match(agent, /\}\), \{ ferme: revenir \}\);/, "réservation et modification reviennent dans le rappel de fermeture");
  const envoi = source("views/voucher-envoi.mjs");
  assert.ok(envoi.indexOf("if (avantNavigation) avantNavigation();") < envoi.indexOf("if (note) naviguer(location.hash);\n      },"), "le retour passe avant la navigation");
});

test("3. réservation d'un dossier Taxi : écrite avec entite_id = Taxi même si l'import du formulaire est lent", async () => {
  const etat = { entiteId: "s" };
  const ecrites = [];
  const changer = (id) => (etat.entiteId = id);
  // Le formulaire écrit dans l'entreprise active, comme inserer() : entite_id vient de etat.entiteId au moment de l'envoi.
  const formulaire = { envoyer: () => ecrites.push({ dossier_id: "tx1", entite_id: etat.entiteId }) };
  let fermer;
  const ouvert = U.ouvrirDansEntreprise({
    id: "t",
    origine: "s",
    changer,
    charger: () => new Promise((r) => setTimeout(() => r(formulaire), 700)),
    ouvrir: (f, revenir) => {
      fermer = () => revenir();
      setTimeout(() => (f.envoyer(), fermer()), 50);
      return true;
    },
  });
  await new Promise((r) => setTimeout(r, 650));
  assert.equal(etat.entiteId, "t", "pendant l'import lent, on reste dans Taxi (l'ancien minuteur de 600 ms revenait trop tôt)");
  await ouvert;
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(ecrites, [{ dossier_id: "tx1", entite_id: "t" }]);
  assert.equal(etat.entiteId, "s", "retour après la fermeture");
});

test("4. « Vérifier avant » : jamais pour une carte unifiée avec un service sans entreprise, et avec les entreprises corrigées", () => {
  const agent = source("views/agent.mjs");
  assert.match(agent, /const aChoisir = u && \(du\.services \|\| \[\]\)\.some\(\(s\) => !s\.entite_id\);/);
  assert.match(agent, /puis: mixte \|\| ailleurs \|\| aChoisir \? null :/);
  assert.match(agent, /const vue = \{ \.\.\.c, donnees: donneesCarte\(c\) \};\n(?:\s+\/\/[^\n]*\n)?\s+\(await import\("\.\/demande\.mjs"\)\)\.ouvrirDemande\(null, preparation\(vue\)/);
});

test("5. lien des deux côtés ou pas du tout", async () => {
  const ecrit = [];
  const ok = await U.lierDossiers({ id: "a" }, { id: "b" }, async (t, id, v) => ecrit.push([id, v.dossier_lie_id]));
  assert.equal(ok, true);
  assert.deepEqual(ecrit, [["a", "b"], ["b", "a"]]);
  const ecrit2 = [];
  const ko = await U.lierDossiers({ id: "a" }, { id: "b" }, async (t, id, v) => {
    if (id === "b") throw new Error("refus");
    ecrit2.push([id, v.dossier_lie_id]);
  });
  assert.equal(ko, false);
  assert.deepEqual(ecrit2, [["a", "b"], ["a", null]], "le premier lien revient à null");
  const agent = source("views/agent-valider.mjs");
  assert.match(agent, /if \(r\.lies\) toast\(tr\("Deux dossiers liés créés/, "le toast de succès seulement si les deux liens sont posés");
});

test("6. apprentissages : chaque dossier dans son entreprise, avec seulement ses services", () => {
  const c = { id: "carte", genre: "dossier" };
  const donnees = { services: [{ libelle: "Airport", entite_id: "t" }, { libelle: "4 Islands", entite_id: "s" }] };
  assert.deepEqual(U.carteDeLEntreprise(c, donnees, "t").donnees.services.map((s) => s.libelle), ["Airport"]);
  assert.deepEqual(U.carteDeLEntreprise(c, donnees, "s").donnees.services.map((s) => s.libelle), ["4 Islands"]);
  const agent = source("views/agent.mjs");
  assert.match(agent, /await apresValidation\(carteDeLEntreprise\(c, donnees, d\.entite_id\), \{ dossierId: d\.id, entiteId: d\.entite_id, typeLie \}\);/);
  assert.match(agent, /agentNoterApprentissages\(entiteId, c\.id, lignes\)/);
});

test("8. WhatsApp en lecture seule : net et nom de partenaire cachés sans le droit dans l'entreprise de la réponse", () => {
  const codes = ["montant_interne:1200", "nom_prestataire:Lazy Day", "heure_non_source:08:30"];
  assert.deepEqual(U.avertissementsVisibles(codes, []), { visibles: ["heure_non_source:08:30"], masques: 2 });
  assert.deepEqual(U.avertissementsVisibles(codes, ["partenaires.lire"]).visibles, ["nom_prestataire:Lazy Day", "heure_non_source:08:30"]);
  assert.deepEqual(U.avertissementsVisibles(codes, ["partenaires.lire", "partenaires.nets"]).masques, 0);
  const vue = source("views/whatsapp.mjs");
  assert.match(vue, /lectureSeule \? avertissementsVisibles\(p\.avertissements \|\| \[\], permissionsDe\(p\.entite_id \|\| c\.entite_id\)\)/);
  assert.match(vue, /const avs = avertissements\(\{ \.\.\.p, avertissements: filtre\.visibles \}\);/);
});

test("9. liste des conversations : l'Assistant doit être allumé dans l'autre entreprise", () => {
  const tout = () => ADMIN;
  assert.equal(U.espaceUnifie({ entites: [SECRET, TAXI], activeId: "s", permissionsDe: tout, agentActif: (id) => id === "s" }), null);
  assert.deepEqual(U.espaceUnifie({ entites: [SECRET, TAXI], activeId: "s", permissionsDe: tout, agentActif: () => true }).autre, TAXI);
  assert.match(source("views/agent.mjs"), /agentActif: \(id\) => agentActif\(reglagesDe\(id\)\)/);
});

test("10. Fusionner : exactement les conditions de fusionner_clients, selon la fiche gardée", () => {
  const admin = ["clients.lire", "clients.ecrire", "clients.fusionner", "reglages.ecrire", "dossiers.ecrire"];
  const cote = (entite_id, permissions, voitTout = true) => ({ entite_id, permissions, voitTout });
  const sTvers = (s, c) => s === "s" && c === "t";
  assert.equal(U.peutFusionnerPaire({ garder: cote("s", admin), absorbe: cote("t", admin), partage: sTvers }), true);
  assert.equal(U.peutFusionnerPaire({ garder: cote("t", admin), absorbe: cote("s", admin), partage: sTvers }), false, "partage dans le sens choisi");
  assert.equal(U.peutFusionnerPaire({ garder: cote("s", admin), absorbe: cote("t", ["clients.supprimer", "dossiers.ecrire", "reglages.ecrire"]), partage: sTvers }), true, "clients.supprimer et dossiers.ecrire valent clients.fusionner");
  assert.equal(U.peutFusionnerPaire({ garder: cote("s", admin), absorbe: cote("t", ["clients.supprimer", "reglages.ecrire"]), partage: sTvers }), false);
  assert.equal(U.peutFusionnerPaire({ garder: cote("s", admin), absorbe: cote("t", admin, false), partage: sTvers }), false, "voit tout sur la fiche absorbée");
  assert.equal(U.peutFusionnerPaire({ garder: cote("s", admin, false), absorbe: cote("t", admin), partage: sTvers }), false, "voit tout sur la fiche gardée");
  assert.equal(U.peutFusionnerPaire({ garder: cote("s", admin.filter((p) => p !== "clients.ecrire")), absorbe: cote("t", admin), partage: sTvers }), false, "clients.ecrire sur la fiche gardée");
  assert.equal(U.peutFusionnerPaire({ garder: cote("s", admin.filter((p) => p !== "reglages.ecrire")), absorbe: cote("t", admin), partage: sTvers }), false, "administration des deux");
  assert.equal(U.peutFusionnerPaire({ superAdmin: true, garder: cote("s", ["clients.lire", "clients.ecrire"]), absorbe: cote("t", ["clients.fusionner"]), partage: sTvers }), true, "administration générale");
  assert.match(source("views/doublons-unifies.mjs"), /if \(!fusionPermise\(garde, absorbe\)\) return toast/);
});

test("7. démo : le partage réciproque est posé et la fusion du doublon semé marche", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?fusion=${Date.now()}`);
    const store = creer();
    const paires = await store.doublonsClients();
    const d = await store.charger();
    const exc = d.entites.find((e) => e.slug === "excursions");
    const taxi = d.entites.find((e) => e.slug === "taxi");
    assert.ok(U.partageReciproque(d.partages_clients, exc.id, taxi.id), "partage réciproque posé");
    const p = paires[0];
    const [garde, absorbe] = p.entreprise_a === "secret" ? [p.fiche_a, p.fiche_b] : [p.fiche_b, p.fiche_a];
    assert.equal(await store.fusionnerClients({ garder: garde, absorbe, patch: {} }), garde);
    assert.equal((await store.charger()).clients.some((c) => c.id === absorbe), false, "la fiche absorbée a disparu");
    // Un dossier mis à la corbeille (création défaite) ne laisse aucune réservation derrière lui, comme la cascade de la base.
    const avecResa = d.reservations.find((r) => r.dossier_id);
    await store.supprimer("dossiers", avecResa.dossier_id);
    assert.equal((await store.charger()).reservations.some((r) => r.dossier_id === avecResa.dossier_id), false);
  } finally {
    delete globalThis.localStorage;
  }
});
