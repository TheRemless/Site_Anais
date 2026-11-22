// Deux défauts signalés par Jérémy le 22.11.2026, après la PR 317. Données fictives, aucun appel réseau.
//   1. « Créer le dossier » (et « Prêt à réserver ») ouvrait une nouvelle discussion de l'Assistant alors qu'une discussion liée à la même
//      conversation WhatsApp était ouverte. Règle : une seule discussion par conversation WhatsApp, le bouton rouvre la plus récente ouverte.
//   2. La carte dossier n'a pas repris le prix écrit par Nani (« 2,500 THB » au milieu d'une phrase) : la conversation d'un nouveau client
//      n'a ni type, ni fiche client, ni dossier, elle n'était donc pas un « client confirmé ». Et `offre` était nul : la ligne de zone
//      « Private Taxi · Krabi Town » du catalogue Taxi ne sortait pas pour « private minivan Koh Lanta Krabi Town ».
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as R from "../src/gestion/js/whatsapp-relie-calc.mjs";
import { demandeAgent } from "../src/gestion/js/whatsapp-suivi-calc.mjs";
import { chercherCatalogue, clientConfirme, clientProbable, clientPourPrixDeNani, etapeClient, executer, memoDepuis, refDe, zonesLanta, MOTIFS_CLIENT, MOTIFS_NON_CLIENT } from "../supabase/functions/agent/outils.js";
import { MOTIFS_A_PREPARER } from "../supabase/functions/whatsapp/proposer.js";
import { texteDepuisWhatsApp } from "../supabase/functions/agent/whatsapp.js";
import { faitsAvancee } from "../supabase/functions/whatsapp/etapes.js";
import { signauxPartenaire, avisApres } from "../supabase/functions/whatsapp/type-contact.js";
import { MOTIFS_TRI_NON_CLIENT } from "../src/gestion/js/whatsapp-etapes-calc.mjs";
import { HISTORIQUE_PLEIN, dernierPrixAccepte, discussionPleine, resumeReport } from "../supabase/functions/agent/discussion-pleine.js";
import { MAX_CONVERSATION_B64, MAX_FICHIERS_CONVERSATION } from "../supabase/functions/agent/fichiers.js";
import { separerResume } from "../src/gestion/js/agent-calc.mjs";

const lire = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const W = "0f000000-0000-4000-8000-000000000001";
const T = Date.parse("2026-11-22T05:00:00Z");

// ---- 1. Une seule discussion par conversation WhatsApp ---------------------------------------------------------------------------
test("une discussion par conversation WhatsApp : « Créer le dossier » rouvre la plus récente ouverte", () => {
  const agent = [
    { id: "a1", whatsapp_conversation_id: W, statut: "ouverte", maj_le: "2026-11-22T04:44:00Z" },
    { id: "a0", whatsapp_conversation_id: W, statut: "ouverte", maj_le: "2026-11-21T10:00:00Z" },
    { id: "a9", whatsapp_conversation_id: W, statut: "archivee", maj_le: "2026-11-22T04:58:00Z" },
  ];
  assert.equal(R.conversationLiee(agent, W).id, "a1", "la plus récente ouverte, jamais l'archivée");
  assert.equal(R.conversationLiee(agent.slice(2), W), null, "seulement archivée : une nouvelle discussion");
  // La demande de l'écran porte la discussion à rouvrir, pour un dossier comme pour une question.
  const d = (o) => JSON.stringify({ id: W, mode: "creer", entite: "t", pieces: [], le: T, ...o });
  assert.equal(demandeAgent(d({ agent: "a1" })).agent_conversation_id, "a1");
  const ouverte = { id: "a1", whatsapp_conversation_id: W };
  assert.deepEqual(R.demandeAOuvrir(d({ agent: "a1" }), { conv: ouverte, entiteId: "t", maintenant: T }).dossier.whatsapp_mode, "creer");
  assert.equal(R.demandeAOuvrir(d({ agent: "a1", mode: "maj" }), { conv: ouverte, entiteId: "t", maintenant: T }).dossier.whatsapp_mode, "maj");
  // Les mêmes contrôles qu'une question : la discussion désignée, liée à la même conversation WhatsApp ; sinon rien ne part.
  assert.equal(R.demandeAOuvrir(d({}), { conv: ouverte, entiteId: "t", maintenant: T }), null, "aucune discussion désignée : pas dans une autre");
  assert.equal(R.demandeAOuvrir(d({ agent: "a1" }), { conv: null, entiteId: "t", maintenant: T }), null, "désignée mais pas ouverte : rien");
  assert.equal(R.demandeAOuvrir(d({ agent: "a1" }), { conv: { id: "a1", whatsapp_conversation_id: "autre" }, entiteId: "t", maintenant: T }), null);
  assert.ok(R.demandeAOuvrir(d({}), { conv: null, entiteId: "t", maintenant: T }).dossier, "sans discussion liée : nouvelle discussion");
});

test("une discussion par conversation WhatsApp : écran, Assistant, fonction et démonstration branchés", () => {
  const vue = lire("src/gestion/js/views/whatsapp.mjs");
  // « Créer le dossier », « Mettre à jour le dossier » et « Prêt à réserver » passent tous par versAssistant.
  const versAssistant = vue.slice(vue.indexOf("async function versAssistant"), vue.indexOf("// « Prêt à réserver » (migration 85)"));
  assert.match(versAssistant, /liee = conversationLiee\(await etat\.store\.agentConversations\(entiteId\), c\.id\);/);
  assert.match(versAssistant, /\.\.\.\(liee \? \{ agent: liee\.id \} : \{\}\)/);
  assert.match(versAssistant, /naviguer\(liee \? `#\/agent\/\$\{liee\.id\}` : "#\/agent\/nouvelle"\)/);
  assert.match(vue, /const creerPret = [\s\S]*?\(\) => versAssistant\(c, prop\) : null;/);
  // « Demander à l'assistant » (IA coupée comprise) rouvre la même discussion.
  const demander = vue.slice(vue.indexOf("async function demanderAssistant"), vue.indexOf("// Aller au message"));
  assert.match(demander, /conversationLiee\(await etat\.store\.agentConversations\(entiteId\), c\.id\)/);
  assert.doesNotMatch(vue.slice(vue.indexOf("function boutonDemander"), vue.indexOf("async function demanderAssistant")), /ia_coupee/, "IA coupée : le bouton reste");
  // L'Assistant envoie la demande de dossier dans la discussion ouverte.
  assert.match(lire("src/gestion/js/views/agent.mjs"), /\? \{ entite_id: etat\.entiteId, \.\.\.\(conv \? \{ conversation_id: conv\.id \} : \{\}\), whatsapp_conversation_id: whatsapp\.whatsapp_conversation_id, whatsapp_mode: whatsapp\.whatsapp_mode/);
  // La fonction accepte tous les modes dans une discussion liée, avec le contrôle de liaison existant, et compte les pièces déjà gardées.
  const f = lire("supabase/functions/agent/index.ts");
  assert.match(f, /const waSuite = !!waBrut && !!demande\.conversation_id;/);
  // Constat 6 de la relecture : une discussion archivée est refusée côté serveur aussi.
  assert.match(f, /select\("id, entite_id, whatsapp_conversation_id, statut"\)\.eq\("id", demande\.conversation_id\)/);
  assert.match(f, /if \(!lie\.data \|\| lie\.data\.entite_id !== entiteId \|\| lie\.data\.whatsapp_conversation_id !== waId \|\| lie\.data\.statut === "archivee"\) return json\(\{ erreur: "conversation_introuvable" \}, 404\);/);
  assert.match(f, /controle = conversationId \? null : verifierPieces\(demande\.fichiers\);/);
  assert.match(lire("src/gestion/js/store-local.mjs"), /const suiteWa = !!corps\.whatsapp_conversation_id && !!corps\.conversation_id;/);
});

test("démonstration : « Créer le dossier » dans la discussion déjà liée n'en crée pas une deuxième", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?une=${Date.now()}`);
    const store = creer();
    const d = await store.charger();
    const exc = d.entites.find((e) => e.slug === "excursions");
    for (const e of d.entites) await store.enregistrerReglages(e.id, { ...d.reglages[e.id], agent_ia: true });
    const jade = d.whatsapp_conversations.find((c) => c.nom === "Jade, travel planner");
    const envoyer = (corps) => store.agentEnvoyer({ entite_id: exc.id, ...corps }, () => {});
    const ev = [];
    assert.deepEqual(await store.agentEnvoyer({ entite_id: exc.id, whatsapp_conversation_id: jade.id, whatsapp_mode: "question", whatsapp_pieces: [], texte: "Résume" }, (x) => ev.push(x)), { ok: true });
    const premiere = ev.find((x) => x.t === "conversation").id;
    const liees = async () => (await store.agentConversations(exc.id)).filter((c) => c.whatsapp_conversation_id === jade.id);
    assert.equal((await liees()).length, 1);
    // Créer le dossier, comme l'écran l'envoie maintenant : dans la discussion rouverte.
    assert.deepEqual(await envoyer({ conversation_id: premiere, whatsapp_conversation_id: jade.id, whatsapp_mode: "creer", whatsapp_pieces: [], texte: "" }), { ok: true });
    assert.deepEqual((await liees()).map((c) => c.id), [premiere], "toujours une seule discussion");
    // Une liaison fausse reste refusée.
    const autre = d.whatsapp_conversations.find((c) => c.entite_id === exc.id && c.id !== jade.id && c.reponses !== "jamais");
    assert.equal((await envoyer({ conversation_id: premiere, whatsapp_conversation_id: autre.id, whatsapp_mode: "creer", whatsapp_pieces: [], texte: "" })).erreur, "conversation_introuvable");
  } finally {
    delete globalThis.localStorage;
  }
});

test("compatibilité : avec l'ancienne fonction agent, « Créer le dossier » retombe sur une nouvelle discussion, sans erreur", () => {
  const vue = lire("src/gestion/js/views/agent.mjs");
  // L'ancienne fonction (avant cette PR) n'acceptait la discussion liée que pour une question : un dossier y répondait message_invalide.
  assert.match(vue, /let r = await etat\.store\.agentEnvoyer\(corps, surEvenement\)\.catch\(\(\) => \(\{ erreur: "coupure" \}\)\);/);
  const repli = vue.slice(vue.indexOf('if (r && r.erreur === "message_invalide"'), vue.indexOf("    etape.remove();", vue.indexOf('if (r && r.erreur === "message_invalide"')));
  assert.match(repli, /^if \(r && r\.erreur === "message_invalide" && whatsapp && corps\.conversation_id\) \{/, "seulement un dossier WhatsApp envoyé dans une discussion liée");
  assert.match(repli, /const \{ conversation_id: _liee, \.\.\.sansLiee \} = corps;/);
  assert.match(repli, /conv = null;\n\s+idOuvert = "";/, "la nouvelle discussion prend la place de l'ancienne à l'écran");
  assert.match(repli, /r = await etat\.store\.agentEnvoyer\(sansLiee, surEvenement\)/, "une seule nouvelle tentative, avec le même suivi des événements");
  assert.equal((repli.match(/agentEnvoyer/g) || []).length, 1, "jamais de boucle");
  // L'erreur n'est montrée qu'après le repli : r est la réponse de la seconde tentative.
  assert.ok(vue.indexOf("if (r && r.erreur) {") > vue.indexOf('r = await etat.store.agentEnvoyer(sansLiee, surEvenement)'));
});

// ---- 2. Le prix écrit par Nani à un nouveau client ---------------------------------------------------------------------------------
const ENT = "22222222-2222-4222-8222-222222222222";
const ZONE = "b1000000-0000-4000-8000-000000000001";
const AEROPORT = "c2000000-0000-4000-8000-000000000002"; // un autre début : la référence courte (P-…) prend 8 caractères
const prestations = [
  { id: ZONE, entite_id: ENT, famille: "transfert", groupe: "Private Taxi", libelle: "Krabi Town", libelle_en: "Krabi Town", prix_vente: 2500, unite: "veh", actif: true },
  { id: AEROPORT, entite_id: ENT, famille: "transfert", groupe: "Private Taxi", libelle: "Krabi Airport", libelle_en: "Krabi Airport", prix_vente: 2300, unite: "veh", actif: true },
  { id: "b1000000-0000-4000-8000-000000000003", entite_id: ENT, famille: "transfert", groupe: "Other routes mentioned", libelle: "Krabi Airport to Ao Nang", libelle_en: "Krabi Airport to Ao Nang", prix_vente: 700, unite: "veh", actif: true },
  { id: "b1000000-0000-4000-8000-000000000004", entite_id: ENT, famille: "transfert", groupe: "Private Taxi", libelle: "Minivan to Ao Nang", libelle_en: "Minivan to Ao Nang", prix_vente: 2700, unite: "veh", actif: true },
  { id: "b1000000-0000-4000-8000-000000000005", entite_id: ENT, famille: "transfert", groupe: "Private Taxi", libelle: "Khao Lak", libelle_en: "Khao Lak", prix_vente: 4500, unite: "veh", actif: true },
];
const ctx = { permissions: [], charger: async (n) => ({ partenaires: [], prestations, trajets: [] })[n] || [], reglages: {} };
const minute = (n) => `2026-11-22T04:${String(n).padStart(2, "0")}:00Z`;
const MESSAGES = [
  // Messages inventés, de la même forme que le cas du 22.11.2026 (un prix en bahts au milieu d'une phrase).
  { sens: "entrant", texte: "Hi there, what would a transfer cost from Test Lagoon Resort Koh Lanta to the Fictive Palms Hotel Krabi on 25 Nov at 11:00, 2 adults?", envoye_le: minute(37) },
  { sens: "sortant", texte: "Hi! For this trip our private minivan comes to 2,500 THB in total, ferry ticket included. Just tell me if you would like to go ahead", envoye_le: minute(43) },
  { sens: "entrant", texte: "Great, we would like to book it.", envoye_le: minute(54) },
];
const NOUVEAU = { id: W, telephone: "+447700900123", nom: "Ella Test", type_contact: null, client_id: null, dossier_id: null, partenaire_id: null, reponses: "auto", tri: { motif: "demande_client", preparer: true, entreprise: "taxi" } };
const carte = (ref = "") => ({ titre: "Ella Test", client_nom: "Ella Test", client_telephone: "+447700900123", hotel: "Test Lagoon Resort", langue: "en", adultes: 2, enfants: 0, bebes: 0, services: [{ ref, texte: "Private minivan Test Lagoon Resort → Fictive Palms Hotel", date: "2026-11-25", heure_pickup: "11:00", lieu_pickup: "Test Lagoon Resort", de: "", vers: "", adultes: 2, enfants: 0, prix_saisi: "2500", vol: "", remarque: "" }] });
// Comme la fonction agent : les entreprises où le dossier peut naître (ici Taxi).
async function service(conv, ref = "", entreprises = ["taxi"]) {
  const memo = memoDepuis([{ role: "user", content: texteDepuisWhatsApp({ mode: "creer", conv, messages: MESSAGES }) }], { conversationClient: clientPourPrixDeNani(conv, entreprises), clientProbable: !clientConfirme(conv) && clientProbable(conv, entreprises), conversationLiee: conv.id });
  return (await executer("proposer_dossier", carte(ref), ctx, memo)).carte.donnees.services[0];
}

test("un nouveau client (sans type, sans fiche, tri « demande_client ») : le prix écrit par Nani est repris, à vérifier", async () => {
  // La cause : sans fiche ni dossier, la conversation n'est pas un client confirmé ; le prix restait « à fixer ».
  assert.equal(clientConfirme(NOUVEAU), false);
  assert.equal(clientProbable(NOUVEAU, ["taxi"]), true);
  const s = await service(NOUVEAU);
  assert.deepEqual([s.prix, s.origine_prix], [2500, "saisi"], "« 2,500 THB » au milieu d'une phrase est lu");
  assert.ok(s.avertissements.includes("prix_nani_a_verifier"));
  assert.ok(!s.avertissements.includes("prix_non_tape"));
  // Remonté sur la carte et dit à l'écran, en français et en anglais.
  const c = (await executer("proposer_dossier", carte(), ctx, memoDepuis([{ role: "user", content: texteDepuisWhatsApp({ mode: "creer", conv: NOUVEAU, messages: MESSAGES }) }], { conversationClient: true, clientProbable: true, conversationLiee: W }))).carte;
  assert.ok((c.avertissements || []).includes("prix_nani_a_verifier"));
  assert.match(lire("src/gestion/js/views/agent.mjs"), /prix_nani_a_verifier: N_\("Un prix vient d'un message de Nani/);
  assert.match(lire("src/gestion/js/i18n-en.mjs"), /"A price comes from a message Nani sent to a contact not yet linked to a client record: check it before validating\."/);
  // Un client confirmé (fiche reliée) : repris sans avertissement de plus, comme avant.
  const confirme = await service({ ...NOUVEAU, client_id: "c1" });
  assert.deepEqual([confirme.prix, confirme.origine_prix], [2500, "saisi"]);
  assert.ok(!confirme.avertissements.includes("prix_nani_a_verifier"));
  // La règle suit les motifs pour lesquels la boîte prépare déjà une réponse au client.
  assert.deepEqual(MOTIFS_CLIENT, MOTIFS_A_PREPARER);
});

test("le prix de Nani n'est jamais repris pour un contact non client, ni sans tri de client", async () => {
  const exclus = [
    { tri: null },
    { tri: { motif: "partenaire" } },
    { tri: { motif: "personnel" } },
    { tri: { motif: "non_client" } },
    { tri: { motif: "remerciement" } },
    { type_contact: "partenaire" },
    { type_contact: "chauffeur" },
    { type_contact: "hotel" },
    { type_contact: "apporteur" },
    { partenaire_id: "p1" },
    { reponses: "jamais" },
  ];
  for (const o of exclus) {
    const c = { ...NOUVEAU, ...o };
    assert.equal(clientPourPrixDeNani(c, ["taxi"]), false, JSON.stringify(o));
    const s = await service(c);
    assert.equal(s.prix, null, JSON.stringify(o));
    assert.ok(s.avertissements.includes("prix_non_tape"), JSON.stringify(o));
  }
  // La fonction lit le tri et les étapes avec la conversation, passe les deux drapeaux à memoDepuis ; le prix du client non corrigé reste au
  // client confirmé.
  const f = lire("supabase/functions/agent/index.ts");
  // Constat 7 de la relecture : chaque repli 42703 garde ce que la migration d'avant a ajouté (nom_source jamais perdu).
  assert.match(f, /const COLONNES_WA = \[\n\s+"id, telephone, nom, entite_id, client_id, dossier_id, reponses, type_contact, partenaire_id, nom_source, tri, avancee, type_source, type_avis, type_signaux",\n\s+"id, telephone, nom, entite_id, client_id, dossier_id, reponses, type_contact, partenaire_id, nom_source, tri, avancee",\n\s+"id, telephone, nom, entite_id, client_id, dossier_id, reponses, type_contact, partenaire_id, nom_source",\n\s+"id, telephone, nom, entite_id, client_id, dossier_id, reponses, type_contact, partenaire_id",\n\s+"id, telephone, nom, entite_id, client_id, dossier_id, reponses",\n\];/);
  assert.match(f, /for \(const cols of COLONNES_WA\) \{\n\s+r = await sb\.from\("whatsapp_conversations"\)\.select\(cols\)\.eq\("id", id\)\.maybeSingle\(\);\n\s+if \(!\(r\.error && r\.error\.code === "42703"\)\) break;/);
  assert.match(f, /const wc: any = await lireWa\(waId\);/);
  assert.match(f, /const slugsDossier = unifie \? unifie\.entites\.map\(\(e\) => e\.slug\) : \[ent\.data\?\.slug \|\| ""\];/);
  assert.match(f, /conversationClient: clientPourPrixDeNani\(waLue, slugsDossier\), clientProbable: !clientConfirme\(waLue\) && clientProbable\(waLue, slugsDossier\)/);
  assert.match(f, /if \(waLue && clientConfirme\(waLue\)\) \{\n\s+const lusWa/);
});

test("une étape client (migration 105) suffit : la réservation qui finit sur « remerciement » reprend le prix de Nani", async () => {
  // Les faits tels que la fonction « whatsapp » les garde (etapes.js), puis le client remercie : le tri dit « remerciement ».
  const fin = [...MESSAGES, { sens: "sortant", texte: "Your driver is confirmed", envoye_le: minute(56) }, { sens: "entrant", texte: "Perfect, many thanks!", envoye_le: minute(58) }];
  const avancee = faitsAvancee({ ...NOUVEAU, tri: { motif: "remerciement", entreprise: "taxi" } }, fin, "2026-11-22T05:00:00Z");
  assert.ok(avancee.par.taxi.prix_le && avancee.par.taxi.demande_le, "prix et demande comptés chez Taxi");
  const merci = { ...NOUVEAU, tri: { motif: "remerciement", preparer: false, entreprise: "taxi" }, avancee };
  assert.equal(etapeClient(merci, ["taxi"]), true);
  assert.equal(clientProbable(merci, ["taxi"]), true);
  const s = await service(merci);
  assert.deepEqual([s.prix, s.origine_prix], [2500, "saisi"]);
  assert.ok(s.avertissements.includes("prix_nani_a_verifier"));
  // Relecture de la PR 318 : seule une DEMANDE du contact pour l'entreprise du dossier compte. Un prix de Nani seul, « Prêt à réserver »,
  // une demande d'une autre entreprise ou encore sans entreprise ne suffisent pas ; chez ZTP, rien ne compte.
  const avec = (par, o = {}) => ({ ...merci, avancee: { v: 2, par, ...o } });
  assert.equal(clientProbable(avec({ taxi: { prix_le: minute(43) } }), ["taxi"]), false, "un prix de Nani seul");
  assert.equal(clientProbable(avec({ secret: { demande_le: minute(37) } }), ["taxi"]), false, "une demande chez Secret");
  assert.equal(clientProbable(avec({ secret: { demande_le: minute(37) } }), ["secret", "taxi"]), true, "espace unifié : les deux entreprises");
  assert.equal(clientProbable(avec({ inconnu: { demande_le: minute(37) } }), ["taxi"]), false, "sans entreprise : pas de repli");
  assert.equal(clientProbable(avec({}, { pret: { le: minute(54), entreprise: "taxi" } }), ["taxi"]), false, "Prêt à réserver seul");
  assert.equal(clientProbable(merci, ["ztp"]), false, "ZTP : aucune étape client ne compte");
  assert.equal(clientProbable({ ...NOUVEAU }, ["ztp"]), false, "ZTP : le motif non plus");
  assert.equal(clientProbable({ ...NOUVEAU, tri: { motif: "demande_client", entreprise: "secret" } }, ["taxi"]), false, "motif d'une autre entreprise");
  assert.equal(clientProbable({ ...NOUVEAU, tri: { motif: "demande_client", entreprise: "inconnu" } }, ["taxi"]), false);
  for (const motif of ["remerciement", "autre", "media_seul", "tri_illisible", "ia_coupee"]) assert.equal(clientProbable({ ...NOUVEAU, tri: { motif, entreprise: "taxi" } }, ["taxi"]), false, motif);
  assert.equal(clientProbable({ ...NOUVEAU, tri: null }, ["taxi"]), false, "tri nul");
  // Sans faits, sans demande, Contact personnel : jamais.
  assert.equal(clientProbable({ ...merci, avancee: null }, ["taxi"]), false);
  assert.equal(clientProbable(avec({}), ["taxi"]), false);
  assert.equal(clientProbable({ ...merci, avancee: { v: 2, jamais: true } }, ["taxi"]), false);
  for (const o of [{ type_contact: "partenaire" }, { type_contact: "chauffeur" }, { type_contact: "hotel" }, { type_contact: "apporteur" }, { partenaire_id: "p1" }, { reponses: "jamais" }, { tri: { motif: "partenaire" } }, { tri: { motif: "personnel" } }, { tri: { motif: "publicite" } }, { tri: { motif: "non_client" } }]) {
    const c = { ...merci, ...o };
    assert.equal(clientPourPrixDeNani(c, ["taxi"]), false, JSON.stringify(o));
    assert.equal((await service(c)).prix, null, JSON.stringify(o));
  }
  // La règle partenaire de la #319 (whatsapp/type-contact.js) : appelée avant tout le reste, et dans clientConfirme.
  const o = lire("supabase/functions/agent/outils.js");
  assert.match(o, /import \{ partenaireProbable, prixDeVentePermis \} from "\.\.\/whatsapp\/type-contact\.js";/);
  assert.match(o, /export const clientProbable = \(c, entreprises = \[\]\) => conversationDeClient\(c\) && prixDeVentePermis\(c\) && !partenaireProbable\(c\) &&/);
  assert.match(o, /export const clientConfirme = \(c\) => conversationDeClient\(c\) && prixDeVentePermis\(c\) &&/);
  // Les motifs « pas un client » sont ceux de l'écran des étapes, plus « non_client ».
  assert.deepEqual(MOTIFS_NON_CLIENT, [...MOTIFS_TRI_NON_CLIENT, "non_client"]);
});

// Le cas reproduit par la relecture de la PR 318 : un chauffeur non typé.
const CHAUFFEUR = [
  { sens: "entrant", texte: "net 1,800 THB for the van tomorrow", envoye_le: minute(10) },
  { sens: "sortant", texte: "OK 1,800 THB, pickup 9:00", envoye_le: minute(12) },
  { sens: "entrant", texte: "ok", envoye_le: minute(13) },
];
const BATEAU = [
  { sens: "entrant", texte: "Longtail for 4 pax tomorrow 3,500 THB", envoye_le: minute(20) },
  { sens: "sortant", texte: "OK 3,500 THB, 8:30 at the pier", envoye_le: minute(22) },
  { sens: "entrant", texte: "👍", envoye_le: minute(23) },
];
const contact = (messages, tri) => {
  const c = { ...NOUVEAU, id: "0f000000-0000-4000-8000-000000000099", nom: "", tri };
  return { ...c, avancee: faitsAvancee(c, messages, "2026-11-22T05:00:00Z") };
};
async function serviceDe(conv, messages, prix_saisi, o = {}) {
  const memo = memoDepuis([{ role: "user", content: texteDepuisWhatsApp({ mode: "creer", conv, messages }) }], { conversationClient: clientPourPrixDeNani(conv, ["taxi"]), clientProbable: !clientConfirme(conv) && clientProbable(conv, ["taxi"]), conversationLiee: conv.id });
  Object.assign(memo, o);
  const e = { ...carte(o.ref || ""), services: [{ ...carte().services[0], ref: o.ref || "", prix_saisi }] };
  return (await executer("proposer_dossier", e, ctx, memo)).carte.donnees.services[0];
}

test("constat 1 : un chauffeur ou un bateau non typé n'est jamais un client probable, son net ne devient pas un prix de vente", async () => {
  for (const [messages, prix, motif] of [[CHAUFFEUR, "1800", "autre"], [CHAUFFEUR, "1800", "remerciement"], [CHAUFFEUR, "1800", null], [BATEAU, "3500", "media_seul"], [BATEAU, "3500", "remerciement"]]) {
    const c = contact(messages, motif ? { motif, entreprise: "taxi" } : null);
    // Aucune demande du contact : prix_le seul (et peut-être « prêt ») ne font pas un client.
    assert.ok(!(c.avancee.par.taxi || {}).demande_le && !(c.avancee.par.inconnu || {}).demande_le, `${prix} ${motif} : aucune demande`);
    assert.equal(clientProbable(c, ["taxi"]), false, `${prix} ${motif}`);
    const s = await serviceDe(c, messages, prix);
    assert.deepEqual([s.prix, s.origine_prix], [null, "a_fixer"], `${prix} ${motif}`);
  }
});

test("constat 2 : chez un client seulement probable, un net écrit par le contact reste interne et bloque", async () => {
  // Le tri se trompe et range le chauffeur parmi les demandes de client de Taxi : « net 1,800 » écrit par lui reste interne.
  const c = contact(CHAUFFEUR, { motif: "demande_client", entreprise: "taxi" });
  assert.equal(clientProbable(c, ["taxi"]), true);
  const s = await serviceDe(c, CHAUFFEUR, "1800");
  assert.equal(s.prix, null);
  assert.ok(s.avertissements.includes("prix_egal_net"));
  // Le même bloc chez un client confirmé : les lignes du contact ne comptent pas (règle de la PR 306, inchangée).
  const memo = memoDepuis([{ role: "user", content: texteDepuisWhatsApp({ mode: "creer", conv: c, messages: CHAUFFEUR }) }], { conversationClient: true, clientProbable: true });
  assert.ok(memo.internes.has(1800));
  assert.ok(!memoDepuis([{ role: "user", content: texteDepuisWhatsApp({ mode: "creer", conv: c, messages: CHAUFFEUR }) }], { conversationClient: true }).internes.has(1800));
  // La conversation liée relue par lire_conversation : même règle.
  const o = lire("supabase/functions/agent/outils.js");
  assert.match(o, /if \(memo\.clientProbable === true\) for \(const x of textesDe\(resultat\)\) for \(const n of montantsPresDuNet\(x\)\) memo\.internes\.add\(n\);/);
  assert.match(o, /const jointes = conversationClient && !memo\.clientProbable \? lignesDeNani/);
});

test("constat 3 : le prix repris chez un client probable a un plancher, le net du service", async () => {
  const net = (montant) => ({ nets: [{ prestation_id: ZONE, genre: "adulte", montant }], ref: refDe("P", ZONE) });
  const sous = await serviceDe(NOUVEAU, MESSAGES, "2500", net(2600));
  assert.equal(sous.prix, null);
  assert.ok(sous.avertissements.includes("prix_sous_net"));
  const egal = await serviceDe(NOUVEAU, MESSAGES, "2500", net(2500));
  assert.equal(egal.prix, null, "au niveau du net : refusé aussi");
  const dessus = await serviceDe(NOUVEAU, MESSAGES, "2500", net(1500));
  assert.deepEqual([dessus.prix, dessus.origine_prix], [2500, "saisi"]);
  const illisibles = await serviceDe(NOUVEAU, MESSAGES, "2500", { controleImpossible: true });
  assert.equal(illisibles.prix, null);
  assert.ok(illisibles.avertissements.includes("prix_client_sans_net"));
  // Sans net connu pour ce service (course de Taxi) : repris, à vérifier.
  const sansNet = await serviceDe(NOUVEAU, MESSAGES, "2500", { ref: refDe("P", ZONE) });
  assert.deepEqual([sansNet.prix, sansNet.origine_prix], [2500, "saisi"]);
});

test("un montant non sourcé égal au prix du catalogue du service garde le prix du catalogue", async () => {
  // Sans le prix de Nani (contact exclu), la ligne trouvée au catalogue donne quand même son prix, au lieu de « à fixer ».
  const s = await service({ ...NOUVEAU, tri: null }, refDe("P", ZONE));
  assert.deepEqual([s.prix, s.origine_prix], [2500, "catalogue"]);
  assert.deepEqual(s.offre, { genre: "prestation", id: ZONE });
  // Un montant différent du catalogue et sans source reste refusé.
  const memo = memoDepuis([{ role: "user", content: "Prépare le dossier" }], {});
  const autre = (await executer("proposer_dossier", { ...carte(refDe("P", ZONE)), services: [{ ...carte().services[0], ref: refDe("P", ZONE), prix_saisi: "2000" }] }, ctx, memo)).carte.donnees.services[0];
  assert.equal(autre.prix, null);
  assert.ok(autre.avertissements.includes("prix_non_tape"));
});

// ---- 3. La zone Private Taxi du catalogue Taxi --------------------------------------------------------------------------------------
test("catalogue : la zone « Private Taxi · Krabi Town » sort pour un trajet Koh Lanta → Krabi Town, sans deviner", async () => {
  const refs = async (recherche) => (await chercherCatalogue({ recherche, famille: "transfert" }, ctx)).resultat.lignes.map((l) => l.libelle);
  // La recherche du 22.11.2026 : « minivan » et « Lanta » ne sont pas dans la ligne.
  assert.deepEqual(await refs("private minivan Koh Lanta Krabi Town"), ["Krabi Town"]);
  const r = (await chercherCatalogue({ recherche: "private minivan Koh Lanta Krabi Town", famille: "transfert" }, ctx)).resultat;
  assert.equal(r.lignes[0].depuis_koh_lanta, true);
  assert.equal(r.lignes[0].prix_vente, 2500);
  assert.match(r.conseil, /entre Koh Lanta et la zone de leur libellé/);
  // « Krabi » seul : les deux zones de Krabi, c'est le lieu de l'hôtel qui tranche ; jamais la route « Other routes mentioned ».
  assert.deepEqual((await refs("private taxi Lanta Krabi")).sort(), ["Krabi Airport", "Krabi Town"]);
  // Sans Koh Lanta dans la recherche, rien n'est déduit ; un mot de lieu absent du libellé ne donne rien.
  assert.deepEqual(await refs("minivan Krabi Town"), []);
  assert.deepEqual(await refs("private minivan Koh Lanta Krabi Noi"), []);
  assert.deepEqual(await refs("private taxi Koh Lanta"), [], "Koh Lanta seul ne donne pas toutes les zones");
  assert.deepEqual(zonesLanta(prestations, ["lanta", "town"]).map((p) => p.id), [ZONE]);
});

test("constat 8 : zones Private Taxi en mots entiers, véhicule demandé respecté", async () => {
  const libelles = async (recherche) => (await chercherCatalogue({ recherche, famille: "transfert" }, ctx)).resultat.lignes.map((l) => l.libelle).sort();
  assert.deepEqual(await libelles("car Koh Lanta Ao Nang"), [], "une voiture ne rend jamais « Minivan to … »");
  assert.deepEqual(await libelles("minivan Koh Lanta Ao Nang"), ["Minivan to Ao Nang"]);
  assert.deepEqual(await libelles("private taxi Koh Lanta Ao Nang"), ["Minivan to Ao Nang"], "sans véhicule dit : toutes les zones");
  assert.deepEqual(await libelles("car Koh Lanta Krabi Town"), ["Krabi Town"], "un libellé sans véhicule vaut pour tous");
  assert.deepEqual(await libelles("taxi Koh Lanta ao"), ["Minivan to Ao Nang"], "« ao » ne trouve pas « Khao »");
  assert.deepEqual(await libelles("taxi Koh Lanta Khao Lak"), ["Khao Lak"]);
  assert.deepEqual(zonesLanta(prestations, ["lanta", "kra"]), [], "un morceau de mot ne suffit pas");
});

test("constat 4 : une discussion liée pleine est archivée et remplacée, avec un court résumé", () => {
  // Pleine : historique ou pièces (les limites de la migration 55) ; sinon rien.
  assert.equal(discussionPleine({ messages: HISTORIQUE_PLEIN }), "historique");
  assert.ok(HISTORIQUE_PLEIN < 400, "avant la coupe des 400 messages relus");
  assert.equal(discussionPleine({ messages: 10, fichiers: { nombre: MAX_FICHIERS_CONVERSATION, taille: 0 }, nouveaux: [{ data: "aaaa" }] }), "pieces");
  assert.equal(discussionPleine({ messages: 10, fichiers: { nombre: 1, taille: MAX_CONVERSATION_B64 - 2 }, nouveaux: [{ data: "aaaa" }] }), "pieces");
  assert.equal(discussionPleine({ messages: 10, fichiers: { nombre: MAX_FICHIERS_CONVERSATION, taille: 0 } }), "", "sans pièce dans cet envoi : rien à refuser");
  assert.equal(discussionPleine({ messages: 10, fichiers: { nombre: 1, taille: 10 }, nouveaux: [{ data: "aaaa" }] }), "");
  // Le dernier prix accepté : la carte validée la plus récente, son prix de vente ; jamais une carte écartée ou proposée.
  const cartes = [
    { genre: "dossier", statut: "validee", cree_le: "2026-11-20T10:00:00Z", decide_le: "2026-11-20T10:05:00Z", donnees: { services: [{ libelle: "Private Taxi: Koh Lanta → Krabi Town", prix: 2500, net: 1900 }] } },
    { genre: "reservation", statut: "validee", cree_le: "2026-11-21T09:00:00Z", decide_le: "2026-11-21T09:01:00Z", donnees: { service: { texte: "4 Islands tour", prix: 1800 } } },
    { genre: "dossier", statut: "ecartee", cree_le: "2026-11-22T09:00:00Z", donnees: { services: [{ texte: "x", prix: 9999 }] } },
    { genre: "reponse", statut: "validee", cree_le: "2026-11-22T09:30:00Z", donnees: { message: "2,000 THB" } },
  ];
  assert.deepEqual(dernierPrixAccepte(cartes), { prix: 1800, service: "4 Islands tour" });
  assert.equal(dernierPrixAccepte([]), null);
  const r = resumeReport({ client: { prenom: "Ella", nom: "Test <b>" }, dossiers: [{ ref: "TX-2026-001" }, { ref: "TX-2026-001" }], prix: { prix: 1800, service: "4 Islands tour" }, raison: "pieces" });
  assert.match(r, /^<resume_discussion>\n/);
  assert.match(r, /pleine \(pièces jointes\)/);
  assert.match(r, /- Client : Ella Test b/, "les chevrons sont retirés");
  assert.match(r, /- Dossiers : TX-2026-001\n/);
  assert.match(r, /- Dernier prix accepté : 1 800 THB \(4 Islands tour\)/);
  assert.doesNotMatch(r, /1900|net/i, "jamais un net");
  assert.match(resumeReport({}), /Client : pas encore de fiche\n- Dossiers : aucun\n- Dernier prix accepté : aucun/);
  // L'écran met le résumé à part.
  assert.deepEqual(separerResume(`${r}\n\nSuite`), { resume: r.split("\n").slice(1, -1).join("\n"), reste: "Suite" });
  assert.deepEqual(separerResume("Bonjour"), { resume: "", reste: "Bonjour" });
  // La fonction : seulement une discussion liée où la personne écrit encore ; archivée, remplacée, rouverte si l'échange échoue.
  const f = lire("supabase/functions/agent/index.ts");
  assert.match(f, /if \(conversationId && conv && conv\.whatsapp_conversation_id && waLiee && waLiee\.id === conv\.whatsapp_conversation_id\) \{/);
  assert.match(f, /update\(\{ statut: "archivee" \}\)\.eq\("id", ancien\.id\)/);
  assert.match(f, /insert\(\{ entite_id: entiteId, titre: ancien\.titre, dossier_id: ancien\.dossier_id, whatsapp_conversation_id: ancien\.whatsapp_conversation_id \}\)/);
  assert.match(f, /message = message \? `\$\{resume\}\\n\\n\$\{message\}` : resume;/);
  assert.match(f, /if \(!conversationId \|\| remplace\) await sb\.from\("agent_conversations"\)\.delete\(\)\.eq\("id", conv!\.id\);\n\s+\/\/[^\n]*\n\s+if \(remplace\) await sb\.from\("agent_conversations"\)\.update\(\{ statut: "ouverte" \}\)\.eq\("id", remplace\);/);
  assert.match(f, /\.\.\.\(remplace \? \{ remplace, whatsapp_conversation_id: conv!\.whatsapp_conversation_id \} : \{\}\)/);
  assert.doesNotMatch(f.slice(f.indexOf("let remplace"), f.indexOf("const anciens")), /conversation_pleine/, "jamais d'échec « conversation_pleine » pour une discussion liée");
  // L'écran : la nouvelle discussion prend la place de l'ancienne, marquée archivée.
  const vue = lire("src/gestion/js/views/agent.mjs");
  assert.match(vue, /if \(ev\.t === "conversation" && conv && ev\.remplace && ev\.remplace === conv\.id && ev\.id !== conv\.id\) \{\n\s+conversations = \(conversations \|\| \[\]\)\.map\(\(c\) => \(c\.id === ev\.remplace \? \{ \.\.\.c, statut: "archivee" \} : c\)\);\n\s+conv = null;/);
  assert.match(vue, /const \{ resume, reste \} = separerResume\(it\.texte\);/);
  assert.match(lire("src/gestion/js/i18n-en.mjs"), /"The discussion was full: it is archived and a new one picks up its summary\."/);
});

test("le résumé d'une discussion remplacée n'est que du contexte : jamais un montant tapé ni un prix accepté", async () => {
  // Discussion remplacée, résumé à 2 500, puis le client fidèle demande un autre trajet (Koh Lanta → Krabi Airport, 2 300 au catalogue).
  const resume = resumeReport({ client: { prenom: "Ella", nom: "Test" }, dossiers: [{ ref: "TX-2026-001" }], prix: { prix: 2500, service: "Private Taxi: Koh Lanta → Krabi Town" }, raison: "historique" });
  const AUTRE = [{ sens: "entrant", texte: "Hello again! Could you also arrange a taxi from Koh Lanta to Krabi Airport on 30 Nov at 08:00?", envoye_le: "2026-11-25T03:00:00Z" }];
  const message = `${resume}\n\n${texteDepuisWhatsApp({ mode: "creer", conv: { ...NOUVEAU, client_id: "c1" }, messages: AUTRE })}`;
  const memo = () => memoDepuis([{ role: "user", content: message }], { conversationClient: true, conversationLiee: W });
  assert.ok(!memo().tapes.has(2500), "le prix du résumé n'est pas tapé");
  assert.ok(!memo().nani.has(2500));
  const service = async (o) => (await executer("proposer_dossier", { ...carte(), services: [{ ...carte().services[0], ...o }] }, ctx, memo())).carte.donnees.services[0];
  // Le modèle reprend l'ancien prix : refusé, à fixer.
  const repris = await service({ ref: "", prix_saisi: "2500" });
  assert.deepEqual([repris.prix, repris.origine_prix], [null, "a_fixer"]);
  assert.ok(repris.avertissements.includes("prix_non_tape"));
  // Avec la ligne du catalogue : le prix du catalogue, jamais 2 500.
  const ligne = await service({ ref: refDe("P", AEROPORT), prix_saisi: "2500" });
  assert.notEqual(ligne.prix, 2500);
  assert.equal(ligne.prix, null, "2 500 n'est pas le prix du catalogue : à fixer");
  const catalogue = await service({ ref: refDe("P", AEROPORT), prix_saisi: "" });
  assert.deepEqual([catalogue.prix, catalogue.origine_prix], [2300, "catalogue"]);
  // La réponse au client ne peut pas citer 2 500 non plus.
  const r = await executer("proposer_reponse", { titre: "Prix", langue: "en", message: "Hello Ella, the taxi to Krabi Airport is 2,500 THB." }, ctx, memo());
  assert.ok(r.carte.avertissements.includes("montant_non_source:2500"));
  // Le même montant tapé par la personne hors du résumé compte, lui.
  assert.ok(memoDepuis([{ role: "user", content: `${resume}\n\nLe prix est 2500` }], {}).tapes.has(2500));
  // L'écran : les prix connus pour « Pas bien » ignorent le résumé.
  assert.match(lire("src/gestion/js/views/agent.mjs"), /for \(const phrase of String\(separerResume\(it\.texte\)\.reste\)\.split\(/);
});

test("de bout en bout : le contact « bateau » de la #319, mal trié en demande_client, ne reprend aucun prix", async () => {
  // Le modèle C12 de tests/gestion-whatsapp-type.test.js (messages inventés), avec un prix repris par Nani.
  const t0 = Date.parse("2026-11-21T01:00:00.000Z");
  const lignes = [
    [">", "Hi! Is your boat free on Wednesday?"],
    ["<", "Next Wednesday?"],
    [">", "สวัสดีค่ะ พรุ่งนี้มีเรือว่างไหมคะ ลูกค้าอยากไปดำน้ำทั้งวัน"],
    ["<", "I can propose a price of 12,500 with lunch included."],
    [">", "Ok, I will check with my customers"],
    ["<", "Could you send me the booking for Wednesday please?"],
    [">", "OK 12,500 THB, see you Wednesday 8:30"],
  ];
  const messages = lignes.map(([s, texte], i) => ({ id: `b${i}`, sens: s === ">" ? "sortant" : "entrant", origine: s === ">" ? "app" : "client", type: "text", texte, medias: [], envoye_le: new Date(t0 + i * 60000).toISOString(), supprime_le: null }));
  const base = { id: "0f000000-0000-4000-8000-0000000000b0", telephone: "+447700900456", nom: "", reponses: "auto", type_contact: null, type_source: null, client_id: null, dossier_id: null, partenaire_id: null, type_avis: null };
  // Le tri se trompe : demande_client chez Taxi. Les repères de la #319 et les faits des étapes sont ceux que la fonction « whatsapp » garde.
  const tri = { motif: "demande_client", preparer: true, entreprise: "taxi" };
  const conv = { ...base, tri, avancee: faitsAvancee({ ...base, tri }, messages, "2026-11-22T00:00:00Z"), type_signaux: signauxPartenaire(messages, { conv: base, maintenant: "2026-11-22T00:00:00Z" }) };
  assert.equal(conv.type_signaux.nets, true, "repères nets");
  assert.ok(conv.avancee.par.taxi && conv.avancee.par.taxi.demande_le, "le contact a aussi « demandé » quelque chose : sans la #319, il serait client probable");
  assert.equal(clientProbable(conv, ["taxi"]), false);
  assert.equal(clientPourPrixDeNani(conv, ["taxi"]), false);
  assert.equal(clientConfirme({ ...conv, dossier_id: "d1" }), false, "même relié à un dossier, pas un client confirmé");
  // Le chemin de la fonction agent : memoDepuis puis proposer_dossier, avec le prix écrit par Nani.
  const memo = memoDepuis([{ role: "user", content: texteDepuisWhatsApp({ mode: "creer", conv, messages }) }], { conversationClient: clientPourPrixDeNani(conv, ["taxi"]), clientProbable: !clientConfirme(conv) && clientProbable(conv, ["taxi"]), conversationLiee: conv.id });
  assert.ok(!memo.nani.has(12500));
  const s = (await executer("proposer_dossier", { ...carte(), services: [{ ...carte().services[0], prix_saisi: "12500" }] }, ctx, memo)).carte.donnees.services[0];
  assert.deepEqual([s.prix, s.origine_prix], [null, "a_fixer"]);
  // Sans repères, la seule décision « partenaire » du tri (type_avis) suffit aussi ; un type « client » posé par Nani l'emporte.
  const avis = avisApres(null, { type: "partenaire", raison: "loue un bateau à Nani" }, "2026-11-22T00:00:00Z");
  assert.equal(clientProbable({ ...conv, type_signaux: null, type_avis: avis }, ["taxi"]), false);
  assert.equal(clientProbable({ ...conv, type_signaux: null, type_avis: null }, ["taxi"]), true, "sans la règle de la #319, le tri trompé suffisait");
  assert.equal(clientConfirme({ ...conv, type_contact: "client", type_source: "nani" }), true, "Nani a posé « client » : son choix l'emporte");
  // La fonction lit les colonnes de la migration 110, avec le repli 42703 vers la lecture d'avant.
  const f = lire("supabase/functions/agent/index.ts");
  assert.match(f, /"id, telephone, nom, entite_id, client_id, dossier_id, reponses, type_contact, partenaire_id, nom_source, tri, avancee, type_source, type_avis, type_signaux",\n\s+"id, telephone, nom, entite_id, client_id, dossier_id, reponses, type_contact, partenaire_id, nom_source, tri, avancee",/);
});
