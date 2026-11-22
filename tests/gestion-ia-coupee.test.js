// IA coupée pour une conversation (migration 105), décision du 22.11.2026 : seul l'automatique est coupé, la demande de Nani reste permise.
// Seul « Contact personnel » coupe toute IA (règle du 21.11.2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { iaPermise, triSansAppel, refusDemande } from "../supabase/functions/whatsapp/proposer.js";
import { iaOuvertePour } from "../supabase/functions/agent/apprendre-whatsapp.js";

const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const coupee = { id: "c1", entite_id: "S", telephone: "+447700900611", reponses: "auto", type_contact: "client", ia_coupee: true };
const agents = { S: true, T: true };
const question = [{ id: "m1", sens: "entrant", type: "text", texte: "Hello, how much for a taxi to the pier tomorrow?", envoye_le: "2026-11-22T10:00:00Z" }];

test("IA coupée : l'automatique est coupé (tri, réponse d'office, résumé, promesse, apprentissage)", () => {
  // Tri et réponse préparée d'office : triSansAppel ferme avant tout appel à Claude.
  assert.deepEqual(triSansAppel({ conv: coupee, messages: question }), { preparer: false, motif: "ia_coupee" });
  // Résumé et promesse (suivi.ts) et tri passent par iaOuverte, donc par iaPermise : fermé, même avec les deux assistants allumés.
  assert.equal(iaPermise({ receptionActive: true, conv: coupee, agents }), false);
  assert.equal(iaPermise({ receptionActive: true, conv: { ...coupee, ia_coupee: false }, agents }), true, "témoin : rallumée, l'automatique repart");
  // Apprentissage depuis une réponse de Nani : même règle.
  assert.equal(iaOuvertePour({ receptionActive: true, conv: coupee, agents }), false);
  const rep = lire("supabase/functions/whatsapp/reponse.ts");
  assert.match(rep, /if \(!decision && !\(await iaOuverte\(db, conv\)\)\) decision = \{ preparer: false, motif: "ia_coupee" \};/);
  assert.match(lire("supabase/functions/whatsapp/suivi.ts"), /return await iaOuverte\(db, conv as any\);/);
});

test("IA coupée : la demande de Nani reste permise (« Préparer une réponse », « Demander à l'assistant », « Créer le dossier »)", () => {
  // Serveur : seule la règle refusDemande décide, et elle ne regarde pas ia_coupee.
  assert.equal(refusDemande(coupee), null);
  assert.equal(refusDemande({ ...coupee, reponses: "jamais" }), "contact_personnel", "Contact personnel : toujours refusé");
  assert.equal(refusDemande(null), "droit_manquant");
  const rep = lire("supabase/functions/whatsapp/reponse.ts");
  const demande = rep.slice(rep.indexOf("export async function preparerALaDemande"), rep.indexOf("const t0 = Date.now() + ATTENTE_MS"));
  assert.match(demande, /const refus = refusDemande\(lu\.conv\);/);
  assert.ok(!/ia_coupee/.test(demande.replace(/\/\/[^\n]*/g, "")), "aucun contrôle ia_coupee dans la préparation à la demande");
  // Écran : les trois gestes restent affichés, l'aide dit ce que fait le réglage.
  const vue = lire("src/gestion/js/views/whatsapp.mjs");
  assert.ok(!/!c\.ia_coupee|\|\| c\.ia_coupee/.test(vue));
  const etapes = lire("src/gestion/js/views/whatsapp-etapes.mjs");
  assert.match(etapes, /export const AIDE_IA_COUPEE = N_\("IA coupée pour cette conversation : plus de tri, de résumé ni de réponse préparée d'office\. « Préparer une réponse » et l'Assistant restent possibles à votre demande\."\);/);
});
