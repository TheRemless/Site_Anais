// Assistant et WhatsApp reliés, PR D (décision de Jérémy du 21.11.2026) : une travel planner envoie plusieurs clients dans un même message,
// sans aucun accord. « Prépare les dossiers » sur une conversation d'apporteur donne une carte par client, chacune dans la bonne entreprise,
// au nom du client ; l'apporteur est noté sur chaque dossier avec la fiche de SA propre entreprise, ou rien. Données fictives, aucun appel réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { executer, memoDepuis, normaliserEntree, refDe } from "../supabase/functions/agent/outils.js";
import { modeUnifie } from "../supabase/functions/agent/unifie.js";
import { consignes } from "../supabase/functions/agent/prompt.js";
import { texteDepuisWhatsApp } from "../supabase/functions/agent/whatsapp.js";
import { apporteurDeCarte, blocApporteur, contactApporteur, infoApporteur, refApporteur } from "../supabase/functions/agent/apporteur.js";
import { apporteurDuDossier, entreprisesSansFiche, poseApporteur } from "../src/gestion/js/apporteurs-calc.mjs";
import { echangeWhatsApp, propositionDepuisCarte } from "../src/gestion/js/agent-calc.mjs";
import { liaisonApresDossier } from "../src/gestion/js/whatsapp-suivi-calc.mjs";
import { cartesApporteurDemo, prochainJour } from "../src/gestion/js/agent-whatsapp-demo.mjs";

const source = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const ORG = "00000000-0000-0000-0000-00000000a000";
const SECRET = { id: "5ec00000-0000-4000-8000-000000000001", slug: "secret", nom: "Secret Travel & Tour", organisation_id: ORG };
const TAXI = { id: "7a000000-0000-4000-8000-000000000002", slug: "taxi", nom: "VIP Taxi Lanta", organisation_id: ORG };
const JADE_S = "1ade0000-0000-4000-8000-000000000001";
const JADE_T = "2ade0000-0000-4000-8000-000000000002";
const BATEAU = "aaaaaaaa-0000-4000-8000-000000000001";
const P_SNORKEL = "a1000000-0000-4000-8000-000000000001";
const P_AEROPORT = "a2000000-0000-4000-8000-000000000002";
const jadeSecret = { id: JADE_S, nom: "Jade", categorie: "apporteur", entite_id: SECRET.id, actif: true, contact: { telephones: [{ numero: "+44 7700 900955" }] } };
const jadeTaxi = { id: JADE_T, nom: "Jade", categorie: "apporteur", entite_id: TAXI.id, actif: true, contact: { telephones: [{ numero: "07700 900955" }] } };
const bateau = { id: BATEAU, nom: "Blue Ocean", categorie: "Excursions bateaux", entite_id: SECRET.id, actif: true, contact: { telephones: [{ numero: "+44 7700 900955" }] } };
const conv = { id: "c0000000-0000-4000-8000-000000000001", telephone: "+447700900955", nom: "Jade, travel planner", reponses: "auto", type_contact: "apporteur", partenaire_id: JADE_S, entite_id: SECRET.id };
const donnees = {
  partenaires: [{ id: BATEAU, nom: "Blue Ocean", actif: true, regles: {}, entite_id: SECRET.id }],
  partenaires_prives: [],
  prestations: [
    { id: P_SNORKEL, famille: "excursion", groupe: "Koh Rok", libelle: "Koh Rok snorkelling", libelle_en: "Koh Rok snorkelling", prix_vente: 1800, unite: "pp", partenaire_id: BATEAU, actif: true, entite_id: SECRET.id },
    { id: P_AEROPORT, famille: "transfert", groupe: "Airport", libelle: "Krabi Airport → Lanta", libelle_en: "Krabi Airport transfer", prix_vente: 2500, unite: "", partenaire_id: null, actif: true, entite_id: TAXI.id },
  ],
  prestations_nets: [],
  trajets: [],
  trajets_nets: [],
};
const charger = async (nom) => donnees[nom] || [];
const TOUS = ["partenaires.lire", "partenaires.nets", "dossiers.lire", "dossiers.ecrire"];
const unifie = modeUnifie({ active: SECRET, autre: TAXI, permissions: TOUS, permissionsAutre: TOUS, interrupteur: "1", reglagesAutre: { agent_ia: true } });
const service = (o) => ({ texte: "", ref: "", date: "2026-11-25", heure_pickup: "", lieu_pickup: "Long Beach", de: "", vers: "", adultes: 2, enfants: 0, prix_saisi: "", remarque: "", ...o });
const memo = () => memoDepuis([], { prestataires: ["Blue Ocean"], entreprise: SECRET.nom });

// ---- Consigne --------------------------------------------------------------------------------------------------------------------
test("consigne : un dossier par client au nom du client, jamais d'accord ni de commission, la référence seule part", () => {
  const info = infoApporteur({ conv, reliee: jadeSecret, candidats: [jadeSecret], entites: unifie.entites });
  assert.equal(info.ref, refApporteur(JADE_S));
  const b = blocApporteur(info, { qui: "Nani", unifie: true });
  for (const m of [/ce contact est un apporteur d'affaires|Ce contact est un apporteur d'affaires/, /Chaque client qu'il envoie est un dossier à part, au nom du client/, /Ne demande jamais d'accord ni de commission/, /une carte proposer_dossier par client, jamais un seul dossier pour tout le monde/, /L'apporteur n'est jamais le client/, /une excursion chez Secret, un taxi chez Taxi/, /Ne parle jamais de l'apporteur au client/, /aucune fiche chez Taxi/]) assert.match(b, m);
  assert.ok(b.includes(`apporteur « ${refApporteur(JADE_S)} »`));
  // Ni le nom ni le numéro de la fiche, ni son identifiant entier.
  assert.doesNotMatch(b, /Jade|7700|900955/);
  assert.ok(!b.includes(JADE_S));
  // Style de Jérémy : pas de virgule avant « et », pas de tiret d'incise.
  assert.doesNotMatch(b, /, et /);
  assert.doesNotMatch(b, / – | — /);
  // Sans fiche : rien à passer. Hors espace unifié : pas de ligne Secret ou Taxi. Aucun apporteur : rien du tout.
  const sans = blocApporteur(infoApporteur({ conv: { ...conv, partenaire_id: null, telephone: "+66 81 000 0000" }, reliee: null, candidats: [jadeSecret], entites: [SECRET] }), { qui: "Nani" });
  assert.match(sans, /Aucune fiche apporteur ne correspond à ce contact : laisse apporteur vide/);
  assert.doesNotMatch(sans, /chez Secret, un taxi/);
  assert.equal(blocApporteur(null), "");
  // Un contact personnel n'est jamais un apporteur pour l'agent ; un client non plus.
  assert.equal(contactApporteur(conv), true);
  assert.equal(contactApporteur({ ...conv, reponses: "jamais" }), false);
  assert.equal(contactApporteur({ ...conv, type_contact: "client" }), false);
  assert.equal(contactApporteur(null), false);
  // La consigne s'ajoute après les consignes habituelles, qui ne changent pas.
  const base = consignes({ entreprise: SECRET.nom, reglages: { fonctionnement: "excursions" }, prenomEquipe: "Nani" });
  assert.doesNotMatch(base, /Apporteur d'affaires/);
});

test("premier message : le numéro est celui de l'apporteur, ses messages marqués « Apporteur », l'écran les montre comme ceux du contact", () => {
  const messages = [{ sens: "entrant", texte: "1) Emma and Paul, snorkelling. 2) Marco, taxi from the airport", envoye_le: "2026-11-21T03:00:00Z" }];
  const t = texteDepuisWhatsApp({ mode: "creer", conv, messages, apporteur: true });
  assert.match(t, /Numéro WhatsApp de l'apporteur, jamais celui d'un client : \+447700900955/);
  assert.doesNotMatch(t, /Numéro WhatsApp du client/);
  assert.match(t, /un dossier par client, au nom du client/);
  assert.match(t, /\[Apporteur 21\.11\.2026 10:00\] 1\) Emma/);
  const e = echangeWhatsApp(t);
  assert.equal(e.messages.length, 1);
  assert.equal(e.messages[0].deClient, true);
  // Sans apporteur, rien ne change.
  const client = texteDepuisWhatsApp({ mode: "creer", conv, messages });
  assert.match(client, /Numéro WhatsApp du client : /);
  assert.match(client, /\[Client 21\.11\.2026 10:00\]/);
  assert.match(client, /Crée le dossier de ce client/);
});

test("fonction agent : type et fiche lus avec la session, repli sans la colonne, jamais partenaires_prives, consigne et contexte posés", () => {
  const ts = source("supabase/functions/agent/index.ts");
  assert.match(ts, /select\("id, telephone, nom, entite_id, dossier_id, reponses, type_contact, partenaire_id"\)\.eq\("id", waId\)/);
  assert.match(ts, /if \(wc\.error && wc\.error\.code === "42703"\) wc = await sb\.from\("whatsapp_conversations"\)\.select\("id, telephone, nom, entite_id, dossier_id, reponses"\)\.eq\("id", waId\)/);
  assert.match(ts, /select\(`\$\{COL_CONV_AGENT\}, whatsapp_conversation_id`\)/, "une conversation déjà liée retrouve son contact");
  assert.match(ts, /c\.error\.code === "42703"\) c = await sb\.from\("agent_conversations"\)\.select\(COL_CONV_AGENT\)/);
  const bloc = ts.slice(ts.indexOf("// Apporteur d'affaires (apporteur.js) :"), ts.indexOf('const anciens = await sb.from("agent_messages")'));
  assert.ok(bloc.length > 400);
  assert.match(bloc, /sb\.from\("partenaires"\)\.select\(COL_FICHE\)\.eq\("id", waLiee!\.partenaire_id\)/);
  assert.match(bloc, /\.eq\("categorie", "apporteur"\)\.in\("entite_id", entitesApp\.map/);
  assert.doesNotMatch(bloc, /partenaires_prives|admin\.from|nets/, "session de la personne, jamais les données privées");
  assert.match(ts, /if \(contactApporteur\(waLiee\)\)/);
  assert.match(ts, /if \(waEcrit\) waLiee = wc\.data;/, "lecture seule : aucune carte, pas d'apporteur");
  assert.match(ts, /const systeme = systemeBase \+ blocApporteur\(apporteur, \{ qui: ra\.responsable \|\| "l'équipe", unifie: !!unifie \}\);/);
  assert.match(ts, /\.\.\.\(apporteur \? \{ apporteur \} : \{\}\)/);
  assert.match(ts, /apporteur: waEcrit && contactApporteur\(wc\.data\), question: waQuestion, lectureSeule: !waEcrit \}\);/);
  // Aucun appel à l'IA en plus : le module est du JS pur.
  assert.doesNotMatch(source("supabase/functions/agent/apporteur.js"), /new Anthropic|messages\.create|fetch\(|partenaires_prives/);
});

// ---- Fiches et contrôle --------------------------------------------------------------------------------------------------------
test("fiches : la reliée dans son entreprise, l'autre par le même numéro ou le même nom, jamais une fiche qui n'est pas apporteur", () => {
  const ids = (i) => Object.fromEntries(i.fiches.map((f) => [f.entreprise, f.id]));
  // Reliée chez Secret, rien chez Taxi.
  let i = infoApporteur({ conv, reliee: jadeSecret, candidats: [jadeSecret, bateau], entites: unifie.entites });
  assert.deepEqual(ids(i), { secret: JADE_S });
  assert.equal(i.nom, "Jade");
  // La fiche de Taxi au même numéro (écrit autrement) ; puis au même nom sans numéro.
  i = infoApporteur({ conv, reliee: jadeSecret, candidats: [jadeSecret, jadeTaxi], entites: unifie.entites });
  assert.deepEqual(ids(i), { secret: JADE_S, taxi: JADE_T });
  i = infoApporteur({ conv, reliee: jadeSecret, candidats: [{ ...jadeTaxi, contact: {} }], entites: unifie.entites });
  assert.deepEqual(ids(i), { secret: JADE_S, taxi: JADE_T });
  // Deux fiches au même numéro chez Taxi : aucune (Nani choisit). Une fiche masquée ou d'une autre catégorie : jamais.
  i = infoApporteur({ conv, reliee: jadeSecret, candidats: [jadeTaxi, { ...jadeTaxi, id: "3ade0000-0000-4000-8000-000000000003", nom: "Jade B" }], entites: unifie.entites });
  assert.deepEqual(ids(i), { secret: JADE_S });
  i = infoApporteur({ conv, reliee: jadeSecret, candidats: [{ ...jadeTaxi, actif: false }, { ...bateau, entite_id: TAXI.id }], entites: unifie.entites });
  assert.deepEqual(ids(i), { secret: JADE_S });
  // Une fiche reliée qui n'est pas un apporteur ne compte pas ; le numéro de la conversation suffit alors.
  i = infoApporteur({ conv, reliee: bateau, candidats: [bateau, jadeTaxi], entites: unifie.entites });
  assert.deepEqual(ids(i), { taxi: JADE_T });
  assert.equal(i.ref, refApporteur(JADE_T));
  // Hors espace unifié : l'entreprise active seule.
  i = infoApporteur({ conv, reliee: jadeSecret, candidats: [jadeTaxi], entites: [SECRET] });
  assert.deepEqual(ids(i), { secret: JADE_S });
  assert.deepEqual(infoApporteur({ conv: { telephone: "" }, entites: [SECRET] }), { nom: "", ref: null, fiches: [], entites: [{ id: SECRET.id, slug: "secret", nom: SECRET.nom }] });
});

test("apporteur de la carte : posé d'office dans le contexte, la référence du modèle confirme seulement, chaque entreprise avec sa fiche", () => {
  const info = infoApporteur({ conv, reliee: jadeSecret, candidats: [jadeSecret], entites: unifie.entites });
  const attendu = { nom: "Jade", fiches: { [SECRET.id]: JADE_S } };
  // Le modèle oublie le champ : l'apporteur du contexte est posé quand même.
  assert.deepEqual(apporteurDeCarte("", info, { entitesCarte: [SECRET.id] }), { apporteur: attendu, resume: { note_chez: ["Secret"], sans_fiche_chez: [] } });
  // Une référence qui n'est pas celle du contact (un partenaire, une autre fiche) : ignorée, avec l'avertissement ; l'apporteur du contexte reste.
  const autre = apporteurDeCarte(refApporteur(BATEAU), info, { entitesCarte: [SECRET.id] });
  assert.deepEqual(autre.apporteur, attendu);
  assert.equal(autre.avertissement, "apporteur_inconnu");
  // Hors contexte (pas de contact apporteur, ou aucune fiche) : rien n'est posé ; une référence donnée reste un avertissement.
  assert.deepEqual(apporteurDeCarte("", null), {});
  assert.deepEqual(apporteurDeCarte(refApporteur(JADE_S), null), { avertissement: "apporteur_inconnu" }, "sans contact apporteur");
  assert.deepEqual(apporteurDeCarte("", infoApporteur({ conv: { telephone: "" }, entites: [SECRET] })), {});
  const r = apporteurDeCarte(refApporteur(JADE_S).toUpperCase(), info, { entitesCarte: [SECRET.id, TAXI.id] });
  assert.deepEqual(r.apporteur, { nom: "Jade", fiches: { [SECRET.id]: JADE_S } });
  assert.deepEqual(r.resume, { note_chez: ["Secret"], sans_fiche_chez: ["Taxi"] });
  // Une fiche est toujours rangée sous sa propre entreprise : celle de Secret ne vaut jamais pour Taxi.
  const deux = apporteurDeCarte(refApporteur(JADE_S), infoApporteur({ conv, reliee: jadeSecret, candidats: [jadeTaxi], entites: unifie.entites }), { entitesCarte: [TAXI.id] });
  assert.deepEqual(deux.apporteur.fiches, { [SECRET.id]: JADE_S, [TAXI.id]: JADE_T });
  assert.deepEqual(deux.resume, { note_chez: ["Taxi"], sans_fiche_chez: [] });
});

// ---- Cartes ------------------------------------------------------------------------------------------------------------------
test("proposer_dossier : une carte par client, la bonne entreprise, l'apporteur noté, rien de la fiche ne repart chez Claude", async () => {
  const apporteur = infoApporteur({ conv, reliee: jadeSecret, candidats: [jadeSecret], entites: unifie.entites });
  const ctx = { permissions: TOUS, ...unifie, charger, reglages: {}, apporteur };
  assert.equal(normaliserEntree("proposer_dossier", { titre: "x", services: [] }, { unifie: true }).apporteur, "", "champ facultatif");
  const emma = await executer("proposer_dossier", { titre: "Emma et Paul", client_nom: "Emma", client_telephone: "+44 7700 900412", hotel: "Long Beach", langue: "en", adultes: 2, enfants: 0, bebes: 0, services: [service({ texte: "Koh Rok", ref: refDe("P", P_SNORKEL) })], apporteur: refApporteur(JADE_S) }, ctx, memo());
  const marco = await executer("proposer_dossier", { titre: "Marco", client_nom: "Marco", client_telephone: "", hotel: "Klong Nin", langue: "en", adultes: 2, enfants: 2, bebes: 0, services: [service({ texte: "Taxi", ref: refDe("P", P_AEROPORT), lieu_pickup: "Krabi Airport" })], apporteur: refApporteur(JADE_S) }, ctx, memo());
  assert.deepEqual(emma.carte.donnees.entreprises, ["secret"]);
  assert.deepEqual(marco.carte.donnees.entreprises, ["taxi"]);
  assert.deepEqual(emma.carte.donnees.apporteur, { nom: "Jade", fiches: { [SECRET.id]: JADE_S } });
  assert.deepEqual(marco.carte.donnees.apporteur, { nom: "Jade", fiches: { [SECRET.id]: JADE_S } });
  assert.equal(emma.carte.donnees.client.telephone, "+44 7700 900412", "le client final, pas l'apporteur");
  assert.ok(!("resume_apporteur" in emma.carte), "le résumé ne s'enregistre pas dans la carte");
  // Ce qui repart chez Claude : les entreprises où l'apporteur est noté, jamais son nom ni sa fiche.
  assert.deepEqual(emma.contenu.apporteur, { note_chez: ["Secret"], sans_fiche_chez: [] });
  assert.deepEqual(marco.contenu.apporteur, { note_chez: [], sans_fiche_chez: ["Taxi"] });
  for (const r of [emma, marco]) {
    const t = JSON.stringify(r.contenu);
    assert.doesNotMatch(t, /Jade/);
    assert.ok(!t.includes(JADE_S) && !t.includes(SECRET.id));
  }
  // Une référence inventée : ignorée avec un avertissement, l'apporteur du contexte est posé quand même.
  const faux = await executer("proposer_dossier", { titre: "x", client_nom: "Léa", services: [service({ texte: "Koh Rok", ref: refDe("P", P_SNORKEL) })], apporteur: "A-12345678" }, ctx, memo());
  assert.deepEqual(faux.carte.donnees.apporteur, { nom: "Jade", fiches: { [SECRET.id]: JADE_S } });
  assert.ok(faux.carte.avertissements.includes("apporteur_inconnu"));
  // Le modèle oublie le champ : posé d'office, chaque entreprise avec sa fiche (Marco chez Taxi : aucune).
  const oubli = await executer("proposer_dossier", { titre: "Marco", client_nom: "Marco", services: [service({ texte: "Taxi", ref: refDe("P", P_AEROPORT) })] }, ctx, memo());
  assert.deepEqual(oubli.carte.donnees.apporteur, { nom: "Jade", fiches: { [SECRET.id]: JADE_S } });
  assert.deepEqual(oubli.contenu.apporteur, { note_chez: [], sans_fiche_chez: ["Taxi"] });
  assert.ok(!(oubli.carte.avertissements || []).includes("apporteur_inconnu"));
  assert.equal(apporteurDuDossier(oubli.carte.donnees.apporteur, TAXI.id, [jadeSecret]), null, "jamais la fiche de Secret sur le dossier de Taxi");
  // Sans contact apporteur, la carte est celle d'avant.
  const avant = await executer("proposer_dossier", { titre: "x", client_nom: "Léa", services: [service({ texte: "Koh Rok", ref: refDe("P", P_SNORKEL) })] }, { permissions: TOUS, charger, reglages: {} }, memo());
  assert.equal(avant.carte.donnees.apporteur, undefined);
  assert.equal(avant.contenu.apporteur, undefined);
  // Hors espace unifié : la fiche de l'entreprise active.
  const simple = await executer("proposer_dossier", { titre: "x", client_nom: "Emma", services: [service({ texte: "Koh Rok", ref: refDe("P", P_SNORKEL) })], apporteur: refApporteur(JADE_S) }, { permissions: TOUS, charger, reglages: {}, apporteur: infoApporteur({ conv, reliee: jadeSecret, entites: [SECRET] }) }, memo());
  assert.deepEqual(simple.carte.donnees.apporteur, { nom: "Jade", fiches: { [SECRET.id]: JADE_S } });
  assert.deepEqual(simple.contenu.apporteur, { note_chez: ["Secret"], sans_fiche_chez: [] });
});

test("validation : chaque dossier reçoit la fiche de sa propre entreprise ou rien, jamais celle d'une autre", () => {
  const partenaires = [jadeSecret, jadeTaxi, bateau];
  const app = { nom: "Jade", fiches: { [SECRET.id]: JADE_S } };
  assert.equal(apporteurDuDossier(app, SECRET.id, partenaires), JADE_S);
  assert.equal(apporteurDuDossier(app, TAXI.id, partenaires), null, "pas de fiche chez Taxi : rien");
  // Une carte trafiquée (fiche de Secret sous la clé de Taxi, ou un partenaire qui n'est pas apporteur) : rien n'est posé.
  assert.equal(apporteurDuDossier({ fiches: { [TAXI.id]: JADE_S } }, TAXI.id, partenaires), null);
  assert.equal(apporteurDuDossier({ fiches: { [SECRET.id]: BATEAU } }, SECRET.id, partenaires), null);
  assert.equal(apporteurDuDossier({ fiches: { [SECRET.id]: JADE_S } }, SECRET.id, []), null, "fiche invisible : rien");
  assert.equal(apporteurDuDossier(null, SECRET.id, partenaires), null);
  // Une carte mixte : deux dossiers liés, chacun avec la sienne.
  const dS = { id: "d1", entite_id: SECRET.id, ref: "S-1" };
  const dT = { id: "d2", entite_id: TAXI.id, ref: "T-1" };
  assert.deepEqual(poseApporteur({ fiches: { [SECRET.id]: JADE_S, [TAXI.id]: JADE_T } }, [dS, dT], partenaires).map((x) => [x.dossier.id, x.apporteur_id]), [["d1", JADE_S], ["d2", JADE_T]]);
  assert.deepEqual(poseApporteur(app, [dS, dT], partenaires).map((x) => [x.dossier.id, x.apporteur_id]), [["d1", JADE_S]]);
  assert.deepEqual(poseApporteur(app, [{ ...dS, apporteur_id: JADE_S }], partenaires), [], "déjà posé : rien à écrire");
  assert.deepEqual(entreprisesSansFiche(app, [SECRET.id, TAXI.id, TAXI.id, null]), [TAXI.id]);
  assert.deepEqual(entreprisesSansFiche(null, [TAXI.id]), []);
  // Le client du dossier vient de la carte : l'apporteur n'entre jamais dans la fiche de création.
  assert.doesNotMatch(JSON.stringify(propositionDepuisCarte({ client: { nom: "Emma" }, services: [{ texte: "Koh Rok" }], apporteur: app })), /Jade|apporteur/);
});

test("écran : « Envoyé par », mention sans fiche, apporteur posé après la création, un refus n'envoie jamais à la corbeille", () => {
  const vue = source("src/gestion/js/views/agent.mjs");
  assert.match(vue, /tr\("Envoyé par \{nom\}", \{ nom: apporteur\.nom \}\)/);
  assert.match(vue, /tr\("Apporteur : pas de fiche chez \{nom\}", \{ nom: libelleEntreprise\(id\) \}\)/);
  assert.match(vue, /if \(d\.apporteur && d\.apporteur\.nom\) corps\.push\(\.\.\.blocApporteurCarte\(d\.apporteur, u \? ids : \[etat\.entiteId\]\)\);/);
  assert.match(vue, /await noterApporteur\(c\.donnees\.apporteur, r\.dossiers \|\| \[dossier\]\);/);
  const fn = vue.slice(vue.indexOf("async function noterApporteur"), vue.indexOf("// « Tout valider » : les cartes en attente"));
  assert.match(fn, /poseApporteur\(apporteur, dossiers, etat\.brut\.partenaires \|\| \[\]\)/);
  assert.match(fn, /await modifier\("dossiers", dossier\.id, \{ apporteur_id \}\)/);
  assert.match(fn, /toast\(tr\("Dossier \{ref\} créé sans apporteur : \{message\}"/);
  assert.doesNotMatch(fn, /supprimer|corbeille|, true\)/, "le dossier reste, message discret");
  // Après la création : la création des dossiers (et leur corbeille en cas d'échec) ne connaît pas l'apporteur.
  const unifie = vue.slice(vue.indexOf("async function validerUnifie"), vue.indexOf("// L'entreprise visée par une carte"));
  assert.doesNotMatch(unifie, /apporteur/);
  const i18n = source("src/gestion/js/i18n-en.mjs");
  for (const k of ["Envoyé par {nom}", "Apporteur : pas de fiche chez {nom}", "Dossier {ref} créé sans apporteur : {message}"]) assert.ok(i18n.includes(`"${k}"`), k);
});

test("conversation WhatsApp d'un apporteur : jamais reliée au client ni au dossier d'un client qu'il envoie", () => {
  const dossier = { id: "d1", entite_id: SECRET.id, client_id: "emma" };
  assert.deepEqual(liaisonApresDossier({ id: "w", entite_id: SECRET.id, client_id: null, dossier_id: null, type_contact: "apporteur" }, dossier, SECRET.id), { action: "rien", patch: null });
  assert.deepEqual(liaisonApresDossier({ id: "w", entite_id: null, client_id: null, dossier_id: null, type_contact: "apporteur" }, dossier, SECRET.id), { action: "ecrire", patch: { entite_id: SECRET.id } }, "à trier : rangée seulement");
  // Un client : comme avant.
  assert.deepEqual(liaisonApresDossier({ id: "w", entite_id: SECRET.id, client_id: null, dossier_id: null }, dossier, SECRET.id), { action: "ecrire", patch: { client_id: "emma", dossier_id: "d1" } });
  assert.match(source("src/gestion/js/store-supabase.mjs"), /lire\("id, entite_id, client_id, dossier_id, type_contact"\)/);
});

test("réponse à l'apporteur lui-même : « Hi Jade » passe vers Jade ; vers Emma, ou un autre partenaire vers Jade, reste bloqué", async () => {
  const { controlerReponse } = await import("../supabase/functions/agent/outils.js");
  const { fichesDuContact, nomsABloquer } = await import("../supabase/functions/agent/apporteur.js");
  const partenaires = [jadeSecret, jadeTaxi, bateau, { id: "4ade0000-0000-4000-8000-000000000004", nom: "Lucie", categorie: "apporteur", entite_id: SECRET.id, contact: { telephones: [{ numero: "+44 7700 900111" }] } }];
  const bloques = (texte, c) => controlerReponse(texte, { signer: true, prestataires: nomsABloquer(partenaires, fichesDuContact(c, partenaires)) }).avertissements.filter((a) => a.startsWith("nom_prestataire"));
  // Vers Jade, dans sa conversation : son nom passe (sa fiche reliée et sa fiche de Taxi, la même personne).
  assert.deepEqual([...fichesDuContact(conv, partenaires)].sort(), [JADE_S, JADE_T].sort());
  assert.deepEqual(bloques("Hi Jade! Both bookings are noted.", conv), []);
  // Vers Emma (une cliente) : le nom de Jade reste bloqué.
  const emma = { id: "c2", telephone: "+447700900412", reponses: "auto", type_contact: "client", partenaire_id: null };
  assert.deepEqual(bloques("Hi Emma, Jade sent you to us.", emma), ["nom_prestataire:Jade"]);
  // Vers Jade, un autre partenaire ou un autre apporteur reste bloqué.
  assert.deepEqual(bloques("Hi Jade, the boat is Blue Ocean.", conv), ["nom_prestataire:Blue Ocean"]);
  assert.deepEqual(bloques("Hi Jade, Lucie sent the same couple.", conv), ["nom_prestataire:Lucie"]);
  // Contact personnel, type effacé, colonne absente (pas de type) ou fiche reliée qui n'est pas un apporteur : rien n'est exempté.
  for (const c of [{ ...conv, reponses: "jamais" }, { ...conv, type_contact: null }, { id: conv.id, telephone: conv.telephone, reponses: "auto" }, { ...conv, partenaire_id: BATEAU }]) assert.deepEqual(bloques("Hi Jade", c), ["nom_prestataire:Jade"]);
  // Les trois chemins s'en servent : la préparation de la boîte, l'envoi et l'agent dans une conversation liée.
  const rep = source("supabase/functions/whatsapp/reponse.ts");
  assert.match(rep, /const exemptes = contactApporteur\(conv\) && conv\.partenaire_id \? fichesDuContact\(conv,/);
  assert.match(rep, /const prestataires = nomsABloquer\(\(await ctx\.charger\("partenaires"\)\) as \{ id: string; nom: string \}\[\], exemptes\);/);
  const envoi = source("supabase/functions/whatsapp-envoi/index.ts");
  assert.match(envoi, /select\("id, organisation_id, telephone, entite_id, reponses, type_contact, partenaire_id"\)/);
  assert.match(envoi, /if \(lue\.error && lue\.error\.code === "42703"\) lue = await sb\.from\("whatsapp_conversations"\)\.select\("id, organisation_id, telephone, entite_id"\)/);
  assert.match(envoi, /const prestataires = nomsABloquer\(pa\.data \|\| \[\], fichesDuContact\(conv, pa\.data \|\| \[\]\)\);/);
  assert.match(source("supabase/functions/agent/index.ts"), /const prestataires = nomsABloquer\(\(await charger\("partenaires"\)\) as \{ id: string; nom: string \}\[\], new Set\(apporteur \?/);
});

test("jamais d'apporteur sur un document du client (reprise de la PR 296)", () => {
  const gabarits = ["document.mjs", "textes-voucher.mjs", "confirmation.mjs", "confirmation-calc.mjs", "views/voucher.mjs", "views/voucher-secret.mjs", "views/voucher-taxi.mjs", "views/voucher-envoi.mjs", "views/document-envoi.mjs", "views/message-client.mjs", "views/messages.mjs", "views/confirmation.mjs", "views/fiduciaire-pdf.mjs", "pdf-simple.mjs", "envoi-voucher-calc.mjs", "fiduciaire-textes.mjs", "views/demande.mjs", "assistant-calc.mjs"];
  for (const f of gabarits) {
    const chemin = `src/gestion/js/${f}`;
    if (!fs.existsSync(new URL(`../${chemin}`, import.meta.url))) continue;
    assert.doesNotMatch(source(chemin), /apporteur|remuneration/i, f);
  }
});

// ---- Démonstration ---------------------------------------------------------------------------------------------------------------
test("démo pure : Emma et Paul chez Secret avec Jade, Marco chez Taxi sans fiche ; hors espace unifié, l'entreprise active", () => {
  const prestations = donnees.prestations;
  const cartes = cartesApporteurDemo({ conv, active: SECRET, secret: SECRET, taxi: TAXI, partenaires: [jadeSecret, bateau], prestations, aujourdhui: "2026-11-21" });
  assert.equal(cartes.length, 2);
  const [emma, marco] = cartes;
  assert.equal(emma.donnees.client.nom, "Emma");
  // Le nom de l'apporteur n'entre dans rien de ce qui part sur le dossier (remarque d'un service, client).
  for (const c of cartes) assert.doesNotMatch(JSON.stringify({ ...c.donnees, apporteur: null }), /Jade/);
  assert.deepEqual(emma.donnees.services.map((s) => s.entreprise), ["secret"]);
  assert.equal(emma.donnees.services[0].offre.id, P_SNORKEL);
  assert.deepEqual(emma.donnees.apporteur, { nom: "Jade", fiches: { [SECRET.id]: JADE_S } });
  assert.equal(marco.donnees.client.nom, "Marco");
  assert.deepEqual(marco.donnees.services.map((s) => s.entreprise), ["taxi"]);
  assert.equal(marco.donnees.services[0].offre.id, P_AEROPORT);
  assert.deepEqual(entreprisesSansFiche(marco.donnees.apporteur, [TAXI.id]), [TAXI.id]);
  assert.equal(apporteurDuDossier(marco.donnees.apporteur, TAXI.id, [jadeSecret]), null);
  assert.equal(prochainJour("2026-11-21", 5), "2026-11-27", "vendredi prochain");
  assert.equal(prochainJour("2026-11-27", 5), "2026-12-04", "jamais le jour même");
  // Hors espace unifié : deux cartes dans l'entreprise active, sans entreprise par service.
  const simples = cartesApporteurDemo({ conv, active: SECRET, partenaires: [jadeSecret], prestations, aujourdhui: "2026-11-21" });
  assert.ok(simples.every((c) => !c.donnees.entreprises && c.donnees.services.every((s) => !("entite_id" in s))));
  // Un client ou un contact personnel : rien.
  assert.equal(cartesApporteurDemo({ conv: { ...conv, type_contact: "client" }, active: SECRET, aujourdhui: "2026-11-21" }), null);
  assert.equal(cartesApporteurDemo({ conv: { ...conv, reponses: "jamais" }, active: SECRET, aujourdhui: "2026-11-21" }), null);
});

test("démo : « Prépare les dossiers » sur Jade donne deux cartes, sans la carte mixte « Sunset dinner » ; l'apporteur se pose sur Secret seulement", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  globalThis.location = { origin: "http://localhost", pathname: "/gestion/", search: "?demo", hash: "" };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?cartes-apporteur=${Date.now()}`);
    const store = creer();
    let d = await store.charger();
    const exc = d.entites.find((e) => e.slug === "excursions");
    const taxi = d.entites.find((e) => e.slug === "taxi");
    for (const e of d.entites) await store.enregistrerReglages(e.id, { ...d.reglages[e.id], agent_ia: true });
    const wa = d.whatsapp_conversations.find((c) => c.nom === "Jade, travel planner");
    const jade = d.partenaires.find((p) => p.id === wa.partenaire_id);
    assert.ok(wa.type_contact === "apporteur" && jade && jade.entite_id === exc.id);
    const envoyer = async (corps) => {
      const ev = [];
      const r = await store.agentEnvoyer({ entite_id: exc.id, ...corps }, (x) => ev.push(x));
      return { r, ev, cartes: ev.filter((x) => x.t === "carte").map((x) => x.carte), texte: ev.filter((x) => x.t === "texte").map((x) => x.delta).join("") };
    };
    // Depuis la conversation : « Demander à l'assistant », puis « Prépare les dossiers ».
    const q = await envoyer({ whatsapp_conversation_id: wa.id, whatsapp_mode: "question", whatsapp_pieces: [], texte: "Résume" });
    const id = q.ev.find((x) => x.t === "conversation").id;
    const p = await envoyer({ conversation_id: id, texte: "Prépare les dossiers" });
    assert.deepEqual(p.r, { ok: true });
    assert.equal(p.cartes.length, 2, "une carte par client");
    assert.doesNotMatch(JSON.stringify(p.cartes), /Sunset dinner|Clara/, "plus de carte mixte générique pour ce cas");
    const [emma, marco] = p.cartes;
    assert.equal(emma.donnees.client.nom, "Emma");
    assert.deepEqual(emma.donnees.services.map((s) => s.entite_id), [exc.id]);
    assert.deepEqual(emma.donnees.apporteur, { nom: "Jade", fiches: { [exc.id]: jade.id } });
    assert.equal(marco.donnees.client.nom, "Marco");
    assert.deepEqual(marco.donnees.services.map((s) => s.entite_id), [taxi.id]);
    assert.deepEqual(entreprisesSansFiche(marco.donnees.apporteur, [taxi.id]), [taxi.id], "« pas de fiche chez Taxi »");
    assert.match(p.texte, /un dossier par client/);
    assert.doesNotMatch(p.texte, /accord|commission/i);
    // « Créer le dossier » depuis WhatsApp donne les mêmes cartes.
    const c = await envoyer({ whatsapp_conversation_id: wa.id, whatsapp_mode: "creer", whatsapp_pieces: [], texte: "" });
    assert.equal(c.cartes.length, 2);

    // Validation (comme l'écran) : un dossier par entreprise, la fiche de sa propre entreprise ou rien ; la base refuse celle d'une autre.
    const nouveau = async (ent) => store.inserer("dossiers", { entite_id: ent.id, client_id: null, ref: "", date_depart: "2026-11-27", date_retour: "", annule: false });
    const dS = await nouveau(exc);
    const dT = await nouveau(taxi);
    d = await store.charger();
    const poses = poseApporteur(emma.donnees.apporteur, [dS], d.partenaires).concat(poseApporteur(marco.donnees.apporteur, [dT], d.partenaires));
    assert.deepEqual(poses.map((x) => [x.dossier.id, x.apporteur_id]), [[dS.id, jade.id]]);
    for (const x of poses) await store.modifier("dossiers", x.dossier.id, { apporteur_id: x.apporteur_id });
    await assert.rejects(store.modifier("dossiers", dT.id, { apporteur_id: jade.id }), /Apporteur introuvable/, "jamais la fiche de Secret sur un dossier de Taxi");
    d = await store.charger();
    assert.equal(d.dossiers.find((x) => x.id === dS.id).apporteur_id, jade.id);
    assert.equal(d.dossiers.find((x) => x.id === dT.id).apporteur_id || null, null);
    // La conversation de Jade n'est reliée à aucun client.
    assert.equal(d.whatsapp_conversations.find((x) => x.id === wa.id).client_id, null);
    assert.equal((await store.whatsappConversation(wa.id)).type_contact, "apporteur");
  } finally {
    delete globalThis.localStorage;
    delete globalThis.location;
  }
});
