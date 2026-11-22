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
import { chercherCatalogue, clientConfirme, clientProbable, clientPourPrixDeNani, executer, memoDepuis, refDe, zonesLanta, MOTIFS_CLIENT } from "../supabase/functions/agent/outils.js";
import { MOTIFS_A_PREPARER } from "../supabase/functions/whatsapp/proposer.js";
import { texteDepuisWhatsApp } from "../supabase/functions/agent/whatsapp.js";

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
  assert.match(f, /if \(!lie\.data \|\| lie\.data\.entite_id !== entiteId \|\| lie\.data\.whatsapp_conversation_id !== waId\) return json\(\{ erreur: "conversation_introuvable" \}, 404\);/);
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

// ---- 2. Le prix écrit par Nani à un nouveau client ---------------------------------------------------------------------------------
const ENT = "22222222-2222-4222-8222-222222222222";
const ZONE = "b1000000-0000-4000-8000-000000000001";
const AEROPORT = "b1000000-0000-4000-8000-000000000002";
const prestations = [
  { id: ZONE, entite_id: ENT, famille: "transfert", groupe: "Private Taxi", libelle: "Krabi Town", libelle_en: "Krabi Town", prix_vente: 2500, unite: "veh", actif: true },
  { id: AEROPORT, entite_id: ENT, famille: "transfert", groupe: "Private Taxi", libelle: "Krabi Airport", libelle_en: "Krabi Airport", prix_vente: 2300, unite: "veh", actif: true },
  { id: "b1000000-0000-4000-8000-000000000003", entite_id: ENT, famille: "transfert", groupe: "Other routes mentioned", libelle: "Krabi Airport to Ao Nang", libelle_en: "Krabi Airport to Ao Nang", prix_vente: 700, unite: "veh", actif: true },
];
const ctx = { permissions: [], charger: async (n) => ({ partenaires: [], prestations, trajets: [] })[n] || [], reglages: {} };
const minute = (n) => `2026-11-22T04:${String(n).padStart(2, "0")}:00Z`;
const MESSAGES = [
  { sens: "entrant", texte: "Good morning, how much is a transfer from Sunny Cove Resort Koh Lanta to Riverside Hotel Krabi on 25 Nov, 11:00, 2 adults?", envoye_le: minute(37) },
  { sens: "sortant", texte: "Hello, thank you for your message. The total price for a private minivan for your journey is 2,500 THB, all fees included (including ferry fee). Let me know if you want to book the transfer", envoye_le: minute(43) },
  { sens: "entrant", texte: "Thank you very much. I'd like to book the transfer.", envoye_le: minute(54) },
];
const NOUVEAU = { id: W, telephone: "+447700900123", nom: "Ella Test", type_contact: null, client_id: null, dossier_id: null, partenaire_id: null, reponses: "auto", tri: { motif: "demande_client", preparer: true, entreprise: "taxi" } };
const carte = (ref = "") => ({ titre: "Ella Test", client_nom: "Ella Test", client_telephone: "+447700900123", hotel: "Sunny Cove Resort", langue: "en", adultes: 2, enfants: 0, bebes: 0, services: [{ ref, texte: "Private minivan Sunny Cove Resort → Riverside Hotel", date: "2026-11-25", heure_pickup: "11:00", lieu_pickup: "Sunny Cove Resort", de: "", vers: "", adultes: 2, enfants: 0, prix_saisi: "2500", vol: "", remarque: "" }] });
async function service(conv, ref = "") {
  const memo = memoDepuis([{ role: "user", content: texteDepuisWhatsApp({ mode: "creer", conv, messages: MESSAGES }) }], { conversationClient: clientPourPrixDeNani(conv), clientProbable: !clientConfirme(conv) && clientProbable(conv), conversationLiee: conv.id });
  return (await executer("proposer_dossier", carte(ref), ctx, memo)).carte.donnees.services[0];
}

test("un nouveau client (sans type, sans fiche, tri « demande_client ») : le prix écrit par Nani est repris, à vérifier", async () => {
  // La cause : sans fiche ni dossier, la conversation n'est pas un client confirmé ; le prix restait « à fixer ».
  assert.equal(clientConfirme(NOUVEAU), false);
  assert.equal(clientProbable(NOUVEAU), true);
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
    assert.equal(clientPourPrixDeNani(c), false, JSON.stringify(o));
    const s = await service(c);
    assert.equal(s.prix, null, JSON.stringify(o));
    assert.ok(s.avertissements.includes("prix_non_tape"), JSON.stringify(o));
  }
  // La fonction lit le tri avec la conversation et passe les deux drapeaux à memoDepuis ; le prix du client non corrigé reste au client confirmé.
  const f = lire("supabase/functions/agent/index.ts");
  assert.match(f, /reponses, type_contact, partenaire_id, nom_source, tri"\)\.eq\("id", waId\)/);
  assert.match(f, /conversationClient: clientPourPrixDeNani\(waLue\), clientProbable: !clientConfirme\(waLue\) && clientProbable\(waLue\)/);
  assert.match(f, /if \(waLue && clientConfirme\(waLue\)\) \{\n\s+const lusWa/);
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
