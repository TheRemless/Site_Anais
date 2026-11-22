// Messages WhatsApp de clients que Telnyx n'a pas transmis (migration 100, fonction « whatsapp ») : webhook du compte WhatsApp, ligne
// « non transmis », client reconnu par son BSUID, repère « Un message du client semble manquer ».
// Dépôt public : toutes les formes d'événements sont inventées (numéros fictifs +447700900…, BSUID inventés, textes neutres).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lireEnveloppe, interpreter, bsuidSur, nonTransmis, empreinte } from "../supabase/functions/whatsapp/calc.js";
import { interpreterWaba as interpreterWabaBrut, valeursMeta, rattrapageAttend, sembleManquer, repereAutorise, ressembleReponse, citationDatable, RATTRAPAGE_ATTENTE_MS, SILENCE_MS, REPERE } from "../supabase/functions/whatsapp/manquants.js";
import { iaPermise } from "../supabase/functions/whatsapp/proposer.js";
import { nomConversation, estNonTransmis, repereManque, conversationManque, libelleType, TEXTE_NON_TRANSMIS, LIBELLE_MANQUE, LIBELLE_NOUVEAU_NUMERO, ancienneConversation } from "../src/gestion/js/whatsapp-calc.mjs";
import { EN } from "../src/gestion/js/i18n-en.mjs";

const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const NANI = "+447700900001";
const CLIENT = "+447700900002";
const BSUID = "GB.10000000000000000002";
const ev = (j) => lireEnveloppe(JSON.stringify(j));
// Le numéro de Nani vient des réglages (whatsapp_reglages.numero) : ici, le numéro fictif.
const interpreterWaba = (e, o = { numero: NANI }) => interpreterWabaBrut(e, o);
const recu = (body, extra = {}) => ({ data: { id: "evt-r1", event_type: "message.received", occurred_at: "2026-11-20T09:59:58.000Z", payload: { direction: "inbound", id: "tx-r1", type: "WHATSAPP", from: { phone_number: CLIENT }, to: NANI, body: { from: CLIENT.slice(1), from_user_id: BSUID, foreign_id: "wamid.R1", timestamp: "1763632798", ...body }, ...extra } } });
const echo = (body) => ({ data: { id: "evt-e1", event_type: "message.echo", occurred_at: "2026-11-20T10:01:00.000Z", payload: { direction: "outbound", origin: "whatsapp_business_app", id: "tx-e1", type: "WHATSAPP", from: { phone_number: NANI }, to: CLIENT, body: { to: CLIENT.slice(1), to_user_id: BSUID, foreign_id: "wamid.E1", timestamp: "1763632860", type: "text", text: { body: "See you tomorrow." }, ...body } } } });
// Value Meta inventée (forme de la référence « messages » de Meta), dans l'enveloppe Telnyx « whatsapp.messages ».
const value = (messages, contacts = [{ profile: { name: "Test Client" }, wa_id: CLIENT.slice(1), user_id: BSUID }]) => ({ messaging_product: "whatsapp", metadata: { display_phone_number: NANI.slice(1), phone_number_id: "100000000000001" }, contacts, messages });
const waba = (payload, id = "evt-w1") => ({ data: { id, event_type: "whatsapp.messages", occurred_at: "2026-11-22T02:00:00.000Z", payload } });
const texte = (id, extra = {}) => ({ from: CLIENT.slice(1), from_user_id: BSUID, id, timestamp: "1763776500", type: "text", text: { body: "Is pickup still at nine?" }, ...extra });
const nonTransmisMeta = (id, code = 131060) => ({ from: CLIENT.slice(1), from_user_id: BSUID, id, timestamp: "1763776500", type: "unsupported", errors: [{ code, title: "Message unavailable", message: "Message unavailable", error_data: { details: "Message unavailable" } }] });

// ---- BSUID --------------------------------------------------------------------------------------------------------------------------
test("BSUID : la forme de Meta (pays, point, chiffres ; compte parent ENT) passe, le reste non", () => {
  assert.equal(bsuidSur("GB.10000000000000000002"), "GB.10000000000000000002");
  assert.equal(bsuidSur(" US.ENT.10000000000000000003 "), "US.ENT.10000000000000000003");
  for (const x of ["", "10000000000000000002", "gb.100", "GB-100", "GB.", "GB.1 0", "GB.1;drop", null, 42, { id: "GB.1" }, `GB.${"1".repeat(129)}`]) assert.equal(bsuidSur(x), null, String(x));
});

test("message.received : le BSUID part avec le message ; sans numéro, le BSUID suffit ; sans les deux, ignoré", () => {
  const a = interpreter(ev(recu({ type: "text", text: { body: "Hello" } })));
  assert.equal(a.action, "message");
  assert.equal(a.telephone, CLIENT);
  assert.equal(a.bsuid, BSUID);
  assert.equal("bsuid" in a.message, false, "le message garde sa forme (le BSUID est sur l'action)");
  const sansNumero = recu({ type: "text", text: { body: "Hello" }, from: undefined }, { from: { carrier: "", line_type: "" } });
  const b = interpreter(ev(sansNumero));
  assert.equal(b.action, "message");
  assert.equal(b.telephone, null);
  assert.equal(b.bsuid, BSUID);
  const rien = recu({ type: "text", text: { body: "Hello" }, from: undefined, from_user_id: undefined }, { from: {} });
  assert.deepEqual(interpreter(ev(rien)), { action: "ignorer", raison: "numero" });
});

test("message.echo : le BSUID du client est to_user_id ; modification et suppression le gardent aussi", () => {
  assert.equal(interpreter(ev(echo({}))).bsuid, BSUID);
  assert.equal(interpreter(ev(recu({ type: "edit", edit: { original_message_id: "wamid.R0", message: { text: { body: "x" } } } }))).bsuid, BSUID);
  assert.equal(interpreter(ev(recu({ type: "revoke", revoke: { original_message_id: "wamid.R0" } }))).bsuid, BSUID);
});

// ---- Message non transmis ------------------------------------------------------------------------------------------------------------
test("non transmis : unsupported, 131060 ou 131051, et seulement ceux-là", () => {
  assert.equal(nonTransmis({ type: "unsupported" }), true);
  assert.equal(nonTransmis({ type: "text", errors: [{ code: 131060 }] }), true);
  assert.equal(nonTransmis({ type: "text", errors: [{ code: "131051" }] }), true);
  assert.equal(nonTransmis({ type: "text", errors: [{ code: 131047 }] }), false, "fenêtre de 24 h : autre chose");
  assert.equal(nonTransmis({ type: "text" }), false);
  assert.equal(nonTransmis(null), false);
});

test("non transmis par message.received : une ligne sans texte (rien pour l'IA), sans média, avec le wamid", () => {
  const a = interpreter(ev(recu({ type: "unsupported", errors: [{ code: 131060, title: "Message unavailable" }] })));
  assert.equal(a.action, "non_transmis");
  assert.equal(a.message.type, "non_transmis");
  assert.equal(a.message.sens, "entrant");
  assert.equal(a.message.meta_id, "wamid.R1");
  assert.deepEqual(a.message.medias, []);
  assert.equal(a.message.texte, null, "l'écran écrit la ligne ; rien ne part à l'IA ni à la recherche");
  // Un écho de Nani n'est jamais « non transmis » (c'est son propre message).
  assert.equal(interpreter(ev(echo({ type: "unsupported" }))).action, "message");
});

// ---- Webhook du compte WhatsApp ---------------------------------------------------------------------------------------------------
test("WABA : le corps Meta relayé sans enveloppe Telnyx est lu, avec un id stable", () => {
  const meta = { object: "whatsapp_business_account", entry: [{ id: "100000000000009", changes: [{ field: "messages", value: value([texte("wamid.W1")]) }] }] };
  const a = ev(meta);
  const b = ev(meta);
  assert.equal(a.type, "whatsapp.messages");
  assert.equal(a.id, b.id, "même corps, même id (Meta rejoue)");
  assert.match(a.id, /^[A-Za-z0-9._:-]{1,100}$/, "l'id passe la contrainte de whatsapp_evenements");
  assert.notEqual(ev({ ...meta, entry: [{ ...meta.entry[0], id: "100000000000010" }] }).id, a.id);
  assert.equal(empreinte("abc"), empreinte("abc"));
  // La fonction relit pris.brut.data.payload : le corps Meta y est.
  assert.deepEqual(a.brut.data.payload, meta);
  assert.equal(interpreterWaba({ id: a.id, type: a.type, payload: a.brut.data.payload }).actions[0].message.meta_id, "wamid.W1");
  assert.throws(() => ev({ object: "page", entry: [] }), /invalide/);
});

test("WABA : la value Meta est trouvée dans toutes les enveloppes plausibles", () => {
  const v = value([texte("wamid.W1")]);
  for (const p of [v, { value: v }, { field: "messages", value: v }, { changes: [{ field: "messages", value: v }] }, { entry: [{ changes: [{ field: "messages", value: v }] }] }, [{ changes: [{ value: v }] }]]) {
    assert.equal(valeursMeta(p).length, 1, JSON.stringify(p).slice(0, 60));
  }
  assert.equal(valeursMeta({ entry: [{ changes: [{ field: "account_update", value: { event: "X" } }] }] }).length, 0, "autre champ que messages : rien");
  assert.equal(valeursMeta(null).length, 0);
});

test("WABA : un message normal devient un rattrapage, rangé comme message.received", () => {
  const a = interpreterWaba(ev(waba({ entry: [{ changes: [{ field: "messages", value: value([texte("wamid.W1", { context: { from: NANI.slice(1), id: "wamid.E0" } })]) }] }] })));
  assert.equal(a.action, "lot");
  assert.equal(a.actions.length, 1);
  const r = a.actions[0];
  assert.equal(r.action, "rattrapage");
  assert.equal(r.telephone, CLIENT);
  assert.equal(r.bsuid, BSUID);
  assert.equal(r.entreprise, null, "le numéro de l'entreprise n'est jamais réécrit depuis ce canal");
  assert.equal(r.waba, true);
  assert.equal(r.nom, "Test Client");
  assert.deepEqual(r.message, { evenement_id: "evt-w1", telnyx_id: null, meta_id: "wamid.W1", sens: "entrant", origine: "client", type: "text", texte: "Is pickup still at nine?", medias: [], envoye_le: new Date(1763776500000).toISOString(), repond_a: "wamid.E0" });
});

test("WABA : unsupported ou 131060/131051 donne la ligne « non transmis » ; un statut est ignoré", () => {
  for (const code of [131060, 131051]) {
    const a = interpreterWaba(ev(waba({ value: value([nonTransmisMeta("wamid.W2", code)]) })));
    assert.equal(a.actions[0].action, "non_transmis");
    assert.equal(a.actions[0].message.type, "non_transmis");
    assert.equal(a.actions[0].message.meta_id, "wamid.W2");
    assert.equal(a.actions[0].message.texte, null);
  }
  const statut = interpreterWaba(ev(waba({ value: { messaging_product: "whatsapp", statuses: [{ id: "wamid.S1", status: "delivered" }] } })));
  assert.deepEqual(statut, { action: "ignorer", raison: "waba_statut" });
  assert.deepEqual(interpreterWaba(ev(waba({ quelque: "chose" }))), { action: "ignorer", raison: "waba_vide" });
  assert.equal(interpreterWaba(ev(recu({ type: "text", text: { body: "x" } }))), null, "message.received : pas pour ce canal");
});

test("WABA : client sans numéro (username) reconnu par son BSUID ; plusieurs messages, une clé par message", () => {
  const sans = { ...texte("wamid.W3"), from: undefined };
  const a = interpreterWaba(ev(waba({ value: value([sans, nonTransmisMeta("wamid.W4")], [{ profile: { name: "Test Client", username: "@test" }, user_id: BSUID }]) })));
  assert.equal(a.actions.length, 2);
  assert.equal(a.actions[0].telephone, null);
  assert.equal(a.actions[0].bsuid, BSUID);
  assert.equal(a.actions[0].message.evenement_id, "evt-w1");
  assert.equal(a.actions[1].message.evenement_id, "evt-w1#1");
  // Ni numéro ni BSUID : rien à ranger.
  const rien = interpreterWaba(ev(waba({ value: value([{ id: "wamid.W5", type: "text", text: { body: "x" } }], []) })));
  assert.deepEqual(rien, { action: "ignorer", raison: "waba_vide" });
});

test("WABA : un corps au format Telnyx (body avec foreign_id) est lu aussi, wamid pris dans foreign_id", () => {
  const a = interpreterWaba(ev(waba({ id: "tx-w1", from: { phone_number: CLIENT }, to: NANI, body: { from: CLIENT.slice(1), from_user_id: BSUID, id: "autre", foreign_id: "wamid.W6", timestamp: "1763776500", type: "text", text: { body: "x" } } })));
  assert.equal(a.actions[0].message.meta_id, "wamid.W6");
  assert.equal(a.actions[0].telephone, CLIENT);
});

test("WABA : une modification ou une suppression s'applique, elle n'est jamais rangée comme un nouveau message", () => {
  const edit = { from: CLIENT.slice(1), from_user_id: BSUID, id: "wamid.W7", timestamp: "1763776500", type: "edit", edit: { original_message_id: "wamid.W1", message: { type: "text", text: { body: "Pickup at ten" } } } };
  const revoke = { from: CLIENT.slice(1), from_user_id: BSUID, id: "wamid.W8", timestamp: "1763776500", type: "revoke", revoke: { original_message_id: "wamid.W1" } };
  const a = interpreterWaba(ev(waba({ value: value([edit, revoke, { ...revoke, revoke: {} }]) })));
  assert.deepEqual(a.actions.map((x) => x.action), ["modifier", "supprimer"], "sans id d'origine : rien");
  assert.equal(a.actions[0].original, "wamid.W1");
  assert.equal(a.actions[0].texte, "Pickup at ten");
  assert.equal(a.actions[1].bsuid, BSUID);
});

test("WABA : un contact ambigu n'est jamais pris pour l'expéditeur ; un écho de Nani n'est jamais un message du client", () => {
  const autre = { profile: { name: "Other" }, wa_id: "447700900003", user_id: "GB.10000000000000000003" };
  const sansExpediteur = { id: "wamid.W9", timestamp: "1763776500", type: "text", text: { body: "x" } };
  assert.deepEqual(interpreterWaba(ev(waba({ value: value([sansExpediteur], [autre, { profile: { name: "Test Client" }, wa_id: CLIENT.slice(1), user_id: BSUID }]) }))), { action: "ignorer", raison: "waba_vide" });
  const seulSansNumero = { profile: { name: "Other" }, user_id: "GB.10000000000000000003" };
  assert.equal(interpreterWaba(ev(waba({ value: value([sansExpediteur], [seulSansNumero]) }))).actions[0].bsuid, "GB.10000000000000000003", "un seul contact sans wa_id : c'est lui");
  assert.deepEqual(interpreterWaba(ev(waba({ value: value([sansExpediteur], [autre]) }))), { action: "ignorer", raison: "waba_vide" }, "un seul contact avec un autre wa_id que l'expéditeur : non");
  const avecFrom = interpreterWaba(ev(waba({ value: value([{ ...sansExpediteur, from: "447700900003" }], [autre]) })));
  assert.equal(avecFrom.actions[0].bsuid, "GB.10000000000000000003", "wa_id égal à l'expéditeur : c'est lui");
  const sortant = interpreterWaba(ev(waba({ id: "tx-o1", direction: "outbound", from: { phone_number: NANI }, to: CLIENT, body: { from: NANI.slice(1), to_user_id: BSUID, foreign_id: "wamid.O1", type: "text", text: { body: "x" } } })));
  assert.deepEqual(sortant, { action: "ignorer", raison: "waba_vide" });
});

test("WABA : seulement le numéro de Nani ; un autre numéro du compte, un numéro inconnu ou l'entreprise elle-même : rien", () => {
  const e = ev(waba({ value: value([texte("wamid.N1")]) }));
  assert.equal(interpreterWaba(e).action, "lot");
  assert.deepEqual(interpreterWaba(e, { numero: "+447700900099" }), { action: "ignorer", raison: "waba_autre_numero" });
  assert.deepEqual(interpreterWaba(e, { numero: null }), { action: "ignorer", raison: "waba_autre_numero" }, "numéro de Nani pas encore connu : rien");
  const sansMeta = ev(waba({ value: { ...value([texte("wamid.N2")]), metadata: undefined } }));
  assert.deepEqual(interpreterWaba(sansMeta), { action: "ignorer", raison: "waba_autre_numero" }, "numéro illisible : rien");
  const deNani = interpreterWaba(ev(waba({ value: value([texte("wamid.N3", { from: NANI.slice(1), from_user_id: undefined })], []) })));
  assert.deepEqual(deNani, { action: "ignorer", raison: "waba_vide" }, "l'entreprise ne s'écrit pas à elle-même");
  const telnyx = interpreterWaba(ev(waba({ id: "tx-n4", from: { phone_number: CLIENT }, to: "+447700900099", body: { from: CLIENT.slice(1), from_user_id: BSUID, foreign_id: "wamid.N4", type: "text", text: { body: "x" } } })));
  assert.equal(telnyx.raison, "waba_autre_numero", "format Telnyx : le destinataire fait foi");
  const src = lire("supabase/functions/whatsapp/index.ts");
  assert.match(src, /interpreterWaba\(ev, \{ numero: \(await reglages\(db\)\)\.numero \}\)/);
  assert.match(src, /if \(a\.entreprise && !a\.waba && a\.entreprise !== r\.numero\)/, "whatsapp_reglages.numero jamais réécrit depuis le webhook du compte");
});

test("WABA : un rattrapage attend 2 minutes que message.received arrive le premier", () => {
  const t = Date.UTC(2026, 10, 22, 2, 0, 0);
  assert.equal(rattrapageAttend(new Date(t).toISOString(), t + 30_000), true);
  assert.equal(rattrapageAttend(new Date(t).toISOString(), t + RATTRAPAGE_ATTENTE_MS + 1), false);
  assert.equal(rattrapageAttend(null, t), false, "date inconnue : on range");
});

// ---- Repérage sans webhook ----------------------------------------------------------------------------------------------------------
test("repère : seulement pour un client, et seulement si la réponse de Nani ressemble à une réponse", () => {
  const t = Date.UTC(2026, 10, 22, 2, 17, 0);
  const iso = (ms) => new Date(ms).toISOString();
  const client = { type_contact: null, partenaire_id: null, reponses: "auto" };
  const longtemps = { sens: "sortant", envoye_le: iso(t - SILENCE_MS - 60_000) };
  const reponse = "Hello, the price for two people is 900 THB.";
  assert.equal(sembleManquer({ conv: client, envoyeLe: iso(t), texte: reponse, precedent: longtemps }), "silence");
  assert.equal(sembleManquer({ conv: { ...client, type_contact: "client" }, envoyeLe: iso(t), texte: reponse, precedent: longtemps }), "silence");
  for (const conv of [{ ...client, type_contact: "partenaire" }, { ...client, type_contact: "chauffeur" }, { ...client, type_contact: "hotel" }, { ...client, type_contact: "apporteur" }, { ...client, partenaire_id: "p1" }, { ...client, reponses: "jamais" }, null]) {
    assert.equal(sembleManquer({ conv, envoyeLe: iso(t), texte: reponse, precedent: longtemps }), null, JSON.stringify(conv));
    assert.equal(sembleManquer({ conv, envoyeLe: iso(t), texte: reponse, precedent: null, citeInconnu: true }), null, "pas même une citation inconnue");
  }
  assert.equal(sembleManquer({ conv: client, envoyeLe: iso(t), texte: "Hello! Would you like to book the transfer?", precedent: longtemps }), null, "une relance");
  assert.equal(sembleManquer({ conv: client, envoyeLe: iso(t), texte: "Hello!", precedent: longtemps }), null, "un bonjour seul");
  assert.equal(sembleManquer({ conv: client, envoyeLe: iso(t), texte: reponse, precedent: { sens: "sortant", envoye_le: iso(t - 5 * 3600_000) } }), null, "5 heures : rien");
  assert.equal(sembleManquer({ conv: client, envoyeLe: iso(t), texte: reponse, precedent: { sens: "entrant", envoye_le: iso(t - 24 * 3600_000) } }), null, "le client a écrit en dernier");
  assert.equal(sembleManquer({ conv: client, envoyeLe: iso(t), texte: "Hello!", precedent: null }), null, "premier message sans réponse : rien");
  assert.equal(sembleManquer({ conv: client, envoyeLe: iso(t), precedent: null, citeInconnu: true }), "cite_inconnu");
  assert.equal(REPERE, "semble_manquer");
  assert.equal(repereAutorise({ type_contact: "client" }), true);
  assert.equal(repereAutorise({ type_contact: "partenaire" }), false);
});

// Tests d'acceptation (22.11.2026) : les trois pertes réelles connues, rejouées avec des phrases inventées de même forme.
test("repère : acceptation, les trois formes de pertes réelles sont repérées", () => {
  const t = Date.UTC(2026, 10, 22, 2, 20, 0);
  const iso = (ms) => new Date(ms).toISOString();
  const client = { type_contact: null, partenaire_id: null, reponses: "auto" };
  // 1. Un prix, plus de 6 heures après son propre message, sans message du client entre les deux.
  assert.equal(sembleManquer({ conv: client, envoyeLe: iso(t), texte: "Hello, the price for 3 people is 1200 THB, do you also need a car seat?", precedent: { sens: "sortant", envoye_le: iso(t - 25 * 3600_000) } }), "silence");
  // 2. Premier message connu : Nani répond « oui, confirmé ».
  assert.equal(sembleManquer({ conv: client, envoyeLe: iso(t), texte: "Hello yes the transfer is confirmed ☀️", precedent: null }), "premier");
  // 3. Premier message connu : Nani répond « how can I help ».
  assert.equal(sembleManquer({ conv: client, envoyeLe: iso(t), texte: "Hi, how can I help you? 🙏", precedent: null }), "premier");
  assert.equal(sembleManquer({ conv: client, envoyeLe: iso(t), texte: "Bonjour, comment puis-je vous aider ?", precedent: null }), "premier");
});

test("repère : un premier message que Nani lance elle-même ne pose rien", () => {
  const client = { type_contact: null, partenaire_id: null, reponses: "auto" };
  const quand = "2026-11-22T02:20:00.000Z";
  for (const texte of [
    "Thank you again for choosing us. We hope you had a great stay!",
    "Hello, are you interested in booking the boat trip? 😊",
    "Your driver is confirmed for tomorrow, have a safe flight ☀️",
    "Hello my friend, is your boat available on Friday?",
    "Bonjour, je me permets de revenir vers vous au sujet de votre voyage",
    "Special offer this week: 10% discount on island tours",
    "Pickup tomorrow at 8:40 am",
    "Hello!",
  ]) assert.equal(sembleManquer({ conv: client, envoyeLe: quand, texte, precedent: null }), null, texte);
  // La même réponse « oui », mais à un partenaire : rien.
  assert.equal(sembleManquer({ conv: { ...client, type_contact: "partenaire" }, envoyeLe: quand, texte: "Ok yes confirmed", precedent: null }), null);
});

test("repère : ce qui ressemble à une réponse, et ce qui est une relance (phrases inventées)", () => {
  for (const t of ["Yes, see you at 9:30", "Hi Sam, yes it is available", "Sure, no problem", "The total is 2,400 THB", "Pickup at 8 am", "Bonjour, oui c'est noté", "Non, pas ce jour-là", "Confirmed for tomorrow", "C'est possible à 14h"]) assert.equal(ressembleReponse(t), true, t);
  for (const t of ["Hello!", "Hi Sam, would you like to book the boat trip?", "Just checking if you got our message", "Any news about your dates?", "Reminder: your pickup is tomorrow at 9:00", "Coucou, des nouvelles ?", "Thank you for choosing us", ""]) assert.equal(ressembleReponse(t), false, t);
});

test("repère : seul un id Telnyx cité se date ; un wamid inconnu ne pose rien", () => {
  assert.equal(citationDatable("0b4e1a1c-0000-4000-8000-000000000001"), true);
  assert.equal(citationDatable("wamid.HBgLNDQ3NzAwOTAwMDAyFQIAEhgg"), false);
  assert.equal(citationDatable(null), false);
  const src = lire("supabase/functions/whatsapp/index.ts");
  assert.match(src, /if \(m\.repond_a && citationDatable\(m\.repond_a\)\)/);
  assert.match(src, /if \(errV \|\| !repereAutorise\(conv\)\) return;/, "conversation illisible : aucun repère");
  // Un envoi depuis Gestion reçoit son wamid avec le statut : une citation par wamid le retrouve.
  assert.match(src, /update\(\{ meta_id: a\.meta_id \}\)\.eq\("id", m\.id\)\.is\("meta_id", null\)/);
});

// ---- Écran ------------------------------------------------------------------------------------------------------------------------
test("écran : ligne non transmise, repère, nom d'un client sans numéro, textes traduits", () => {
  assert.equal(estNonTransmis({ type: "non_transmis" }), true);
  assert.equal(estNonTransmis({ type: "text" }), false);
  assert.equal(repereManque({ repere: "semble_manquer" }), true);
  assert.equal(repereManque({ repere: null }), false);
  assert.equal(conversationManque({ manque_le: "2026-11-22T02:17:00Z" }), true);
  assert.equal(conversationManque({ manque_le: null }), false);
  assert.equal(nomConversation({ telephone: null, bsuid: BSUID, nom: null }), BSUID);
  assert.equal(nomConversation({ telephone: CLIENT, bsuid: BSUID, nom: null }), "+44 7700900002");
  assert.equal(libelleType("non_transmis"), "Message non transmis");
  assert.equal(LIBELLE_MANQUE, "Un message du client semble manquer");
  assert.equal(LIBELLE_NOUVEAU_NUMERO, "Nouveau numéro pour ce client");
  const ancienne = { id: "c-ancienne" };
  assert.equal(ancienneConversation({ meme_client_que: "c-ancienne" }, [ancienne]), ancienne);
  assert.equal(ancienneConversation({ meme_client_que: null }, [ancienne]), null);
  for (const k of [TEXTE_NON_TRANSMIS, LIBELLE_MANQUE, "Message non transmis", LIBELLE_NOUVEAU_NUMERO, "Voir la conversation de l'ancien numéro"]) assert.ok(EN[k], `traduction de « ${k} »`);
  assert.match(EN[TEXTE_NON_TRANSMIS], /\{heure\}/);
});

test("écran : la ligne et les repères sont branchés, colonnes relues sans la migration", () => {
  const vue = lire("src/gestion/js/views/whatsapp.mjs");
  // Classe wa-bulle : « aller au message » et le défilement du téléphone la trouvent comme une bulle.
  assert.match(vue, /if \(estNonTransmis\(m\)\) return h\("p", \{ class: "wa-bulle entrant wa-non-transmis"/);
  assert.match(vue, /tr\(TEXTE_NON_TRANSMIS, \{ heure: heureBangkok\(m\.envoye_le\) \}\)/);
  assert.match(vue, /repereManque\(m\) \? h\("p", \{ class: "wa-repere-manque" \}, tr\(LIBELLE_MANQUE\)\)/);
  assert.match(vue, /conversationManque\(c\) \? h\("span", \{ class: "wa-conv-manque" \}, tr\(LIBELLE_MANQUE\)\)/);
  assert.match(vue, /c\.meme_client_que \? h\("span", \{ class: "wa-conv-manque" \}, tr\(LIBELLE_NOUVEAU_NUMERO\)\)/);
  assert.match(vue, /noteNouveauNumero\(c\),/);
  const store = lire("src/gestion/js/store-supabase.mjs");
  assert.match(store, /colonneAbsente\(r\.error, "repere"\)/);
  assert.match(store, /\["manque_le", "bsuid", "meme_client_que"\]\.some\(\(c\) => colonneAbsente\(r\.error, c\)\)/);
  const css = lire("src/gestion/css/app.css");
  for (const c of [".wa-non-transmis", ".wa-repere-manque", ".wa-conv-manque"]) assert.ok(css.includes(c), c);
});

// ---- Fonction : aucune IA, aucune notification -------------------------------------------------------------------------------------
test("fonction : la ligne « non transmis » et le repère n'appellent ni l'IA ni le suivi, et n'envoient rien", () => {
  const src = lire("supabase/functions/whatsapp/index.ts");
  const i = src.indexOf('if (a.action === "non_transmis") return;');
  assert.ok(i > 0, "retour avant la réponse préparée");
  assert.ok(i < src.indexOf("enFond(apresMessageClient("), "avant apresMessageClient");
  assert.ok(i < src.indexOf("enFond(suiviApresMessage("), "avant le suivi");
  const reperer = src.slice(src.indexOf("async function reperer("), src.indexOf("async function reperer(") + 2500);
  assert.doesNotMatch(reperer, /apresMessageClient|suiviApresMessage|fetch\(|anthropic|push|notif/i);
  assert.match(reperer, /update\(\{ repere: REPERE \}\)/);
  assert.match(reperer, /rpc\("whatsapp_signaler_manque"/);
  assert.match(src, /interpreterStatut\(ev\) \|\| interpreterWaba\(ev, \{ numero: \(await reglages\(db\)\)\.numero \}\) \|\| interpreter\(ev\)/);
  assert.match(src, /a\.message\.origine === "app" && a\.message\.type !== "reaction" && !data\.remplace\) await reperer\(/, "une réaction ne pose aucun repère");
  assert.match(src, /if \(!\(err instanceof Classe\) && !premiere\) premiere = err;/, "lot : une action classée n'arrête pas les suivantes");
  assert.match(src, /if \(rattrapageAttend\(pris\.recu_le\)\) throw new Patiente\("rattrapage"\);/);
  assert.match(src, /essais: Math\.max\(0, \(Number\(pris\.essais\) \|\| 1\) - 1\)/, "l'attente ne consomme pas d'essai");
  assert.match(src, /m: \{ \.\.\.a\.message, bsuid: a\.bsuid \|\| null \}/);
  assert.match(src, /console\.warn\("enveloppe refusée :"/, "une forme inconnue laisse une trace sans son contenu");
  assert.doesNotMatch(lire("supabase/functions/whatsapp/manquants.js"), /^import (?!\{[^}]*\} from "\.\/calc\.js";)/m, "n'importe que calc.js (pas de réseau, pas d'IA)");
});

test("IA : la ligne « non transmis » n'est lue ni par le tri, ni par la réponse, ni par le suivi, ni par l'Assistant", () => {
  const NT = 'neq("type", "non_transmis")';
  const compte = (f) => lire(f).split(NT).length - 1;
  assert.equal(compte("supabase/functions/whatsapp/reponse.ts"), 3, "tri et réponse (lireConversation), premiers messages du tri (migration 110), ton de Nani");
  assert.equal(compte("supabase/functions/whatsapp/suivi.ts"), 1, "suivi");
  assert.equal(compte("supabase/functions/agent/index.ts"), 3, "Assistant : conversation jointe, lire_conversation, prix du client");
});

test("IA : une conversation connue par son seul BSUID n'a ni tri ni suivi tant qu'elle n'a pas de numéro ou de type", () => {
  const agents = { e1: true };
  assert.equal(iaPermise({ receptionActive: true, conv: { entite_id: "e1", telephone: null, type_contact: null }, agents }), false);
  assert.equal(iaPermise({ receptionActive: true, conv: { entite_id: "e1", telephone: null, type_contact: "client" }, agents }), true, "typée par Nani");
  assert.equal(iaPermise({ receptionActive: true, conv: { entite_id: "e1", telephone: CLIENT, type_contact: null }, agents }), true);
  assert.equal(iaPermise({ receptionActive: true, conv: { entite_id: "e1", telephone: null, type_contact: "client", reponses: "jamais" }, agents }), false, "Contact personnel : jamais");
  const src = lire("supabase/functions/whatsapp/index.ts");
  assert.match(src, /if \(data\?\.nouveau && data\.message_id && !a\.telephone && !\(await iaPourBsuid\(db, data\.conversation_id\)\)\) \{/);
  const i = src.indexOf("!(await iaPourBsuid(");
  assert.ok(i > 0 && i < src.indexOf("enFond(apresMessageClient(") && i < src.indexOf("enFond(suiviApresMessage("), "avant le tri et le suivi");
});

test("fonction : rattrapage débloqué par une ligne « non transmis », ancienne whatsapp_ranger ménagée", () => {
  const src = lire("supabase/functions/whatsapp/index.ts");
  assert.match(src, /if \(deja && deja\.length && deja\[0\]\.type !== "non_transmis"\) return;/);
  assert.match(src, /if \(!a\.telephone && !\(await migration100\(db\)\)\) throw new Patiente\("migration_100"\);/, "jamais de numéro vide vers l'ancienne whatsapp_ranger");
  const i = src.indexOf('throw new Patiente("migration_100")');
  assert.ok(i > 0 && i < src.indexOf('db.rpc("whatsapp_ranger"'), "avant l'appel");
});

// ---- Base -------------------------------------------------------------------------------------------------------------------------
test("migration 100 : BSUID, numéro facultatif, ligne remplacée par le vrai message, droits de la clé de service seulement", () => {
  const sql = lire("docs/gestion/migration-100-whatsapp-manquants.sql");
  assert.match(sql, /alter table whatsapp_conversations alter column telephone drop not null;/);
  assert.match(sql, /check \(telephone is not null or bsuid is not null\)/);
  assert.match(sql, /create unique index if not exists whatsapp_conversations_bsuid on whatsapp_conversations \(organisation_id, bsuid\) where bsuid is not null;/);
  assert.match(sql, /raise exception 'sans_identifiant'/);
  assert.match(sql, /deja\.type = 'non_transmis' and coalesce\(m->>'type', ''\) <> 'non_transmis'/);
  assert.match(sql, /revoke all on function whatsapp_ranger\(uuid, text, text, jsonb\), whatsapp_signaler_manque\(uuid, timestamptz\), whatsapp_rattacher\(uuid, uuid\) from public, anon, authenticated;/);
  assert.match(sql, /manque_le = case when m->>'sens' = 'entrant' then null else manque_le end/, "un message du client, même en retard, efface le repère de la liste");
  assert.match(sql, /add column if not exists meme_client_que uuid references whatsapp_conversations \(id\) on delete set null/);
  assert.ok(fs.existsSync(new URL("../docs/gestion/retour-100-whatsapp-manquants.sql", import.meta.url)));
  assert.match(lire(".github/workflows/ci.yml"), /verif-whatsapp-manquants/);
});

test("dépôt public : aucun numéro plausible dans les fichiers de cette PR", () => {
  const fichiers = ["tests/gestion-whatsapp-manquants.test.js", "supabase/functions/whatsapp/manquants.js", "docs/gestion/migration-100-whatsapp-manquants.sql", "docs/gestion/retour-100-whatsapp-manquants.sql", "docs/gestion/verif-whatsapp-manquants.mjs"];
  for (const f of fichiers) {
    const t = lire(f);
    // Avec « + » : seulement la plage fictive britannique ; sans « + », 11 à 13 chiffres (numéro sans indicatif marqué) : idem, ou un
    // horodatage Unix en millisecondes (17…). Un morceau d'UUID n'est pas un numéro.
    const avecPlus = (t.match(/\+\d[\d ]{8,}\d/g) || []).filter((x) => !/^\+447700900/.test(x.replace(/ /g, "")));
    const nus = (t.match(/(?<![\d.-])\d{11,13}(?![\d-])/g) || []).filter((x) => !/^447700900|^17\d+$/.test(x));
    assert.deepEqual([...avecPlus, ...nus], [], `${f} : seulement des numéros fictifs (+447700900…)`);
  }
});
