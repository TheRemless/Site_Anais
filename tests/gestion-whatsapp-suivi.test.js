// Suivi des conversations WhatsApp (migration 62) : résumé, signal de paiement sans IA, promesses de Nani en tâches.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resumeAFaire, parametresResume, lireResume, signalPaiement, peutEtrePromesse, parametresPromesse, lirePromesse, tachePromesse, lendemain, RESUME_ATTENTE_MS } from "../supabase/functions/whatsapp/suivi.js";

const M = (o) => ({ id: "m", sens: "entrant", type: "text", texte: "Hi", medias: [], envoye_le: "2026-11-20T03:00:00.000Z", ...o });
const serie = (n) => Array.from({ length: n }, (_, i) => M({ id: `m${i}`, envoye_le: `2026-11-20T03:0${i}:00.000Z`, sens: i % 2 ? "sortant" : "entrant" }));

test("résumé : assez de messages, un message plus récent, et pas deux résumés en trois minutes", () => {
  const t = Date.parse("2026-11-20T03:30:00.000Z");
  assert.equal(resumeAFaire({}, serie(3), t), false);
  assert.equal(resumeAFaire({}, serie(4), t), true);
  assert.equal(resumeAFaire({ resume_le: "2026-11-20T03:10:00.000Z" }, serie(4), t), false, "rien de neuf depuis le résumé");
  const plus = [...serie(4), M({ id: "x", envoye_le: "2026-11-20T03:29:00.000Z" })];
  assert.equal(resumeAFaire({ resume_le: "2026-11-20T03:28:00.000Z" }, plus, t), false, "rafale : on attend");
  assert.equal(resumeAFaire({ resume_le: "2026-11-20T03:28:00.000Z" }, plus, t + RESUME_ATTENTE_MS), true);
});

test("résumé : Haiku sans réflexion, numéros masqués, trois lignes lues", () => {
  const p = parametresResume([M({ texte: "Call me +66 81 234 5678" }), ...serie(4)]);
  assert.deepEqual(p.thinking, { type: "disabled" });
  assert.ok(p.max_tokens >= 256);
  assert.match(p.messages[0].content, /\[numéro masqué\]/);
  assert.match(p.messages[0].content, /trois lignes/);
  assert.equal(lireResume({ content: [{ type: "text", text: "- Anna, 2 adultes\n- 4 îles le 22.11\n- prix à confirmer\n- de trop" }] }), "Anna, 2 adultes\n4 îles le 22.11\nprix à confirmer");
  assert.equal(lireResume({ content: [{ type: "thinking", thinking: "" }] }), null);
});

test("paiement : repéré sans IA, seulement dans une conversation reliée à un dossier", () => {
  const conv = { dossier_id: "d1" };
  assert.equal(signalPaiement({}, M({ texte: "I paid" })), null, "sans dossier, rien");
  assert.equal(signalPaiement(conv, M({ texte: "I have transferred the money by Wise" })).motif, "texte");
  assert.equal(signalPaiement(conv, M({ texte: "Virement fait ce matin" })).motif, "texte");
  assert.equal(signalPaiement(conv, M({ texte: null, type: "image", medias: [{ type: "image" }] })), null, "une photo seule, dossier soldé : rien");
  assert.equal(signalPaiement(conv, M({ texte: null, type: "image", medias: [{ type: "image" }] }), { solde: 1500 }).motif, "piece");
  assert.equal(signalPaiement(conv, M({ texte: "See you tomorrow" }), { solde: 1500 }), null);
  assert.equal(signalPaiement(conv, M({ sens: "sortant", texte: "Please pay by Wise" })), null, "un message de Nani n'est jamais une preuve");
  // Aucun appel à Claude dans ce chemin : la capture d'un virement contient un compte.
  const code = fs.readFileSync(new URL("../supabase/functions/whatsapp/suivi.ts", import.meta.url), "utf8");
  const corps = code.slice(code.indexOf("async function paiement"), code.indexOf("async function promesse"));
  assert.doesNotMatch(corps, /anthropic|messages\.create/);
});

test("promesses : repérées, confirmées par Haiku, une tâche datée sans numéro", () => {
  for (const t of ["I will confirm tomorrow morning", "Je vous confirme demain", "Let me check with the boat and get back to you", "je vais vérifier"]) assert.ok(peutEtrePromesse(t), t);
  for (const t of ["See you tomorrow", "Thank you!", "Pickup at 8:30"]) assert.ok(!peutEtrePromesse(t), t);
  const p = parametresPromesse("I will confirm the boat tomorrow, my account 123-4-56789-0", "2026-11-20");
  assert.deepEqual(p.thinking, { type: "disabled" });
  assert.match(p.messages[0].content, /\[numéro masqué\]/);
  const r = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }] });
  assert.deepEqual(lirePromesse(r({ promesse: true, quoi: "confirmer le bateau", echeance: "2026-11-21" }), "2026-11-20"), { quoi: "confirmer le bateau", echeance: "2026-11-21" });
  assert.equal(lirePromesse(r({ promesse: true, quoi: "x", echeance: "2026-11-01" }), "2026-11-20").echeance, "2026-11-21", "une date passée devient demain");
  assert.equal(lirePromesse(r({ promesse: false }), "2026-11-20"), null);
  assert.equal(lirePromesse({ content: [] }, "2026-11-20"), null);
  assert.equal(lendemain("2026-11-30"), "2026-12-01");
  const t = tachePromesse({ conv: { entite_id: "e", dossier_id: null, telephone: "+41790000002", nom: null }, quoi: "confirmer le bateau", echeance: "2026-11-21" });
  assert.deepEqual(t, { entite_id: "e", dossier_id: null, titre: "WhatsApp, …0002 : confirmer le bateau", description: "Promesse faite dans WhatsApp (tâche créée par Gestion).", echeance: "2026-11-21" });
});

test("suivi : branché après chaque nouveau message, hors du traitement de Telnyx", () => {
  const idx = fs.readFileSync(new URL("../supabase/functions/whatsapp/index.ts", import.meta.url), "utf8");
  assert.match(idx, /enFond\(suiviApresMessage\(db, data\.conversation_id, data\.message_id\)\)/);
});
