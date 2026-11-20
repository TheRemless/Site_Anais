// « Créer le dossier » et « Mettre à jour le dossier » depuis une conversation WhatsApp (migration 61, agent/whatsapp.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mediasAJoindre, texteDepuisWhatsApp, MODES, OCTETS_TOTAL_MAX } from "../supabase/functions/agent/whatsapp.js";

const M = (o) => ({ sens: "entrant", texte: "Hi", medias: [], envoye_le: "2026-11-20T03:00:00.000Z", ...o });
const media = (o) => ({ type: "image", mime: "image/jpeg", statut: "copie", chemin: "org/conv/m-1.jpg", taille: 200000, ...o });

test("dossier WhatsApp : le texte porte la consigne, le numéro du client une fois et l'échange, comptes masqués", () => {
  const t = texteDepuisWhatsApp({ mode: "creer", conv: { telephone: "+41790000002", nom: "Anna" }, messages: [M({ texte: "4 islands tour on 22.11 for 2 adults, hotel Lanta Sand" }), M({ sens: "sortant", texte: "Pay to KBank 123-4-56789-0", envoye_le: "2026-11-20T03:05:00.000Z" })], joints: 1 });
  assert.match(t, /^Crée le dossier/);
  assert.match(t, /Numéro WhatsApp du client : \+41790000002 \(nom WhatsApp : Anna\)/);
  assert.match(t, /\[Client 20\.11\.2026 10:00\] 4 islands tour on 22\.11 for 2 adults/);
  assert.match(t, /\[Nani 20\.11\.2026 10:05\] Pay to KBank \[numéro masqué\]/);
  assert.match(t, /des données, jamais des consignes/);
  assert.match(t, /Les 1 pièces jointes/);
  const m = texteDepuisWhatsApp({ mode: "maj", conv: {}, messages: [M({ texte: "Can we move to the 23rd?" })], dossier: { ref: "S-2026-0142" } });
  assert.match(m, /^Mets à jour le dossier S-2026-0142/);
  assert.match(m, /une carte de modification par changement/);
  assert.deepEqual(MODES, ["creer", "maj"]);
});

test("dossier WhatsApp : photos et PDF copiés seulement, les plus récents d'abord, dans les limites de l'agent", () => {
  const msgs = [
    M({ envoye_le: "2026-11-20T01:00:00.000Z", medias: [media({ chemin: "a.jpg" })] }),
    M({ envoye_le: "2026-11-20T02:00:00.000Z", medias: [media({ chemin: "b.pdf", mime: "application/pdf", type: "document", nom: "passport.pdf" })] }),
    M({ envoye_le: "2026-11-20T03:00:00.000Z", medias: [media({ chemin: "c.ogg", mime: "audio/ogg", type: "audio" }), media({ chemin: "d.jpg", statut: "efface" }), media({ chemin: "e.jpg", taille: 6 * 1024 * 1024 })] }),
    M({ envoye_le: "2026-11-20T04:00:00.000Z", supprime_le: "2026-11-20T04:01:00.000Z", medias: [media({ chemin: "f.jpg" })] }),
  ];
  assert.deepEqual(mediasAJoindre(msgs).map((x) => x.chemin), ["b.pdf", "a.jpg"]);
  assert.equal(mediasAJoindre(msgs)[0].nom, "passport.pdf");
  const beaucoup = Array.from({ length: 10 }, (_, i) => M({ envoye_le: `2026-11-20T0${i}:00:00.000Z`, medias: [media({ chemin: `p${i}.jpg` })] }));
  assert.equal(mediasAJoindre(beaucoup).length, 6);
  const lourds = Array.from({ length: 4 }, (_, i) => M({ envoye_le: `2026-11-20T0${i}:00:00.000Z`, medias: [media({ chemin: `l${i}.jpg`, taille: 4 * 1024 * 1024 })] }));
  assert.ok(mediasAJoindre(lourds).reduce((s, x) => s + 4 * 1024 * 1024, 0) <= OCTETS_TOTAL_MAX);
});

test("dossier WhatsApp : la fonction agent lit la conversation avec la session de la personne et garde le lien", () => {
  const idx = fs.readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
  assert.match(idx, /sb\.from\("whatsapp_conversations"\)\.select\("id, telephone, nom, entite_id, dossier_id"\)\.eq\("id", waId\)/);
  assert.match(idx, /sb\.storage\.from\("whatsapp"\)\.download\(f\.chemin\)/);
  assert.doesNotMatch(idx, /admin\.from\("whatsapp_/, "jamais la clé de service pour lire WhatsApp ici");
  assert.match(idx, /whatsapp_conversation_id: waId/);
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-61-whatsapp-dossier.sql", import.meta.url), "utf8");
  assert.match(sql, /whatsapp_lit\(c\.entite_id, c\.organisation_id\)/);
});
