// Bug du 21.11.2026 (capture de Jérémy) : dans une conversation de l'Assistant liée à WhatsApp, « Hello ? » rendait un 400
// « messages.3.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. ».
// Cause : l'API lie la signature d'un bloc de réflexion au préfixe exact qui le précède, et l'historique réécrit des messages déjà envoyés
// (lectures WhatsApp retirées, résultats « interrompu », historique coupé, pièces jointes). Correction : la réflexion des tours terminés
// ne repart pas (prompt.js, sansReflexionPassee) ; celle du tour en cours (boucle d'outils) reste intacte.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sansReflexionPassee, completerOrphelins, historique, debutValide } from "../supabase/functions/agent/prompt.js";
import { retirerLecturesWhatsApp } from "../supabase/functions/agent/whatsapp-lecture.js";
import { historiquePourClaude } from "../supabase/functions/agent/fichiers.js";

const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const reflexion = (sig) => ({ type: "thinking", thinking: "je lis la conversation", signature: sig });

// Les lignes d'agent_messages telles que gardées en base, dans l'ordre : lecture WhatsApp, puis réponse, puis le nouveau message.
const lignes = [
  { role: "user", contenu: [{ type: "text", text: "Qu'y a-t-il à faire avec +14252419921 ?" }] },
  { role: "assistant", contenu: [reflexion("sig-1"), { type: "tool_use", id: "t1", name: "lire_conversation", input: { conversation_id: "x" } }] },
  { role: "user", contenu: [{ type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ messages: [{ texte: "Hi, 2 adults for Koh Rok" }] }) }] },
  { role: "assistant", contenu: [reflexion("sig-2"), { type: "redacted_thinking", data: "abc" }, { type: "text", text: "Le client demande Koh Rok pour 2 adultes." }] },
];

// Le chemin de index.ts, de la base à l'appel.
const versClaude = (l) => sansReflexionPassee(historiquePourClaude(retirerLecturesWhatsApp(completerOrphelins(historique(debutValide(l)))), {}));

test("reproduction : la lecture WhatsApp d'un tour terminé est réécrite, donc aucune réflexion signée ne peut la suivre", () => {
  const sansCorrection = historiquePourClaude(retirerLecturesWhatsApp(completerOrphelins(historique(debutValide(lignes)))), {});
  // Le résultat de l'outil est réécrit (sécurité, PR 295) : c'est ce qui casse la signature de « sig-2 » au message suivant.
  assert.notEqual(JSON.stringify(sansCorrection[2].content[0].content), lignes[2].contenu[0].content);
  assert.ok(JSON.stringify(sansCorrection).includes("sig-2"), "avant la correction, la réflexion signée repartait après le préfixe réécrit");
  const messages = versClaude(lignes);
  messages.push({ role: "user", content: [{ type: "text", text: "Hello ?" }] });
  for (const m of messages) for (const b of Array.isArray(m.content) ? m.content : []) assert.ok(b.type !== "thinking" && b.type !== "redacted_thinking", `réflexion restée : ${m.role}`);
  // La lecture reste retirée (la sécurité n'est pas affaiblie), l'appel d'outil et son résultat restent appariés, le texte reste.
  assert.notEqual(JSON.stringify(messages[2].content[0].content), lignes[2].contenu[0].content);
  assert.equal(messages[1].content[0].type, "tool_use");
  assert.equal(messages[2].content[0].tool_use_id, "t1");
  assert.deepEqual(messages[3].content, [{ type: "text", text: "Le client demande Koh Rok pour 2 adultes." }]);
  assert.equal(messages.length, 5);
});

test("un message réduit à sa réflexion garde un contenu non vide, les autres messages ne changent pas", () => {
  const seul = sansReflexionPassee([{ role: "user", content: "a" }, { role: "assistant", content: [reflexion("s")] }, { role: "assistant", content: "texte" }]);
  assert.deepEqual(seul[1].content, [{ type: "text", text: "…" }]);
  assert.equal(seul[0].content, "a");
  assert.equal(seul[2].content, "texte");
  const sans = [{ role: "assistant", content: [{ type: "text", text: "x" }] }];
  assert.equal(sansReflexionPassee(sans)[0], sans[0], "rien à retirer : même objet");
  assert.deepEqual(sansReflexionPassee(undefined), []);
});

test("la fonction agent retire la réflexion de l'historique avant l'appel, et la boucle garde celle du tour en cours", () => {
  const idx = lire("supabase/functions/agent/index.ts");
  assert.match(idx, /const messages = sansReflexionPassee\(historiquePourClaude\(retirerLecturesWhatsApp\(gardes\), donnees\)\);/);
  // Le tour en cours : la réponse est ajoutée telle quelle (réflexion comprise) après l'appel, et repart à l'identique dans la boucle.
  const boucle = lire("supabase/functions/agent/boucle.js");
  assert.match(boucle, /await garder\("assistant", reponse\.content\);/);
  assert.doesNotMatch(boucle, /sansReflexionPassee/);
  // Pas de paramètre bêta drop_block.
  assert.doesNotMatch(lire("supabase/functions/agent/prompt.js"), /prefix_mismatch_behavior|drop_block/);
});
