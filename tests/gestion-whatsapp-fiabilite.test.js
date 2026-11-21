// Boîte WhatsApp, fiabilité (lot 3 des audits du 20.11.2026, migration 64) : envoi rangé avant l'appel (I1), reprise toutes les 5 minutes
// et compteur d'erreurs (I2), statuts d'envoi de Telnyx (I4), modification ou suppression qui ne se perd plus (I5), doublon (I8).
// Logique pure (fonction et écran), démo, et branchement lu dans le code des fonctions Deno.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as F from "../supabase/functions/whatsapp/fiabilite.js";
import * as E from "../src/gestion/js/whatsapp-fiabilite-calc.mjs";
import { corpsTelnyx } from "../supabase/functions/whatsapp-envoi/calc.js";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const lire = (f) => fs.readFileSync(path.join(RACINE, f), "utf8");

// Événement « message.sent » tel que l'exemple WhatsApp de la doc Telnyx (quickstart), réduit.
const statut = (type, status, extra = {}) => ({
  id: "ev-1",
  type,
  survenu_le: "2026-11-20T10:00:05Z",
  payload: { id: "tx-gestion-1", type: "WHATSAPP", direction: "outbound", to: [{ phone_number: "+41790000002", status }], errors: [], ...extra },
});

test("statuts Telnyx : envoyé, remis, lu, échec avec la raison, attente ignorée", () => {
  assert.deepEqual(F.interpreterStatut(statut("message.sent", "sent")), { action: "statut", telnyx_id: "tx-gestion-1", meta_id: null, statut: "envoye", erreur: null, quand: "2026-11-20T10:00:05Z" });
  assert.equal(F.interpreterStatut(statut("message.finalized", "delivered")).statut, "remis");
  assert.equal(F.interpreterStatut(statut("message.read", "read")).statut, "lu");
  assert.equal(F.interpreterStatut(statut("message.read", "delivered")).statut, "lu", "message.read vaut lu, quel que soit l'état du destinataire");
  const echec = F.interpreterStatut(statut("message.finalized", "delivery_failed", { errors: [{ code: "40008", title: "131047 - Re-engagement message", detail: "More than 24 hours" }] }));
  assert.equal(echec.statut, "echec");
  assert.equal(echec.erreur, "40008 131047 - Re-engagement message More than 24 hours");
  for (const s of ["failed", "undeliverable", "sending_failed", "quelque_chose"]) assert.equal(F.interpreterStatut(statut("message.finalized", s)).statut, "echec", `${s} : tout état inconnu est un échec`);
  assert.equal(F.interpreterStatut(statut("message.finalized", "sending_failed")).erreur, "sending_failed", "sans détail, l'état brut");
  for (const s of ["queued", "sending", "delivery_unconfirmed", ""]) assert.deepEqual(F.interpreterStatut(statut("message.sent", s)), { action: "ignorer", raison: "statut_attente" }, s || "vide");
  assert.equal(F.interpreterStatut(statut("message.sent", "sent", { type: "SMS" })).raison, "canal");
  assert.equal(F.interpreterStatut(statut("message.sent", "sent", { direction: "inbound" })).raison, "direction");
  assert.equal(F.interpreterStatut(statut("message.sent", "sent", { id: null })).raison, "statut_sans_id");
  assert.equal(F.interpreterStatut(statut("message.sent", "sent", { id: null, body: { foreign_id: "wamid.9" } })).meta_id, "wamid.9", "le wamid suffit s'il est là");
  assert.equal(F.interpreterStatut({ type: "message.received", payload: {} }), null, "un message reçu n'est pas un statut");
  assert.equal(F.interpreterStatut(statut("message.finalized", "delivery_failed", { errors: [{ code: "1\n2", title: "x".repeat(300) }] })).erreur.length, 200, "raison bornée, sans saut de ligne");
});

test("statuts : jamais de retour en arrière (remis puis « sent » en retard), échec battu par remis ou lu", () => {
  assert.deepEqual(F.statutsRemplacables("envoye"), ["envoi"]);
  assert.deepEqual(F.statutsRemplacables("echec").sort(), ["envoi", "envoye"]);
  assert.deepEqual(F.statutsRemplacables("remis").sort(), ["echec", "envoi", "envoye"]);
  assert.deepEqual(F.statutsRemplacables("lu").sort(), ["echec", "envoi", "envoye", "remis"]);
  assert.deepEqual(F.statutsRemplacables("inconnu"), []);
});

test("reprise : une cible absente est reprise 30 minutes, puis classée", () => {
  const t = Date.parse("2026-11-20T10:00:00Z");
  assert.equal(F.aReprendre("2026-11-20T09:45:00Z", t), true);
  assert.equal(F.aReprendre("2026-11-20T09:29:00Z", t), false);
  assert.equal(F.aReprendre(null, t), true, "date illisible : on reprend plutôt que perdre");
  assert.equal(F.aReprendre("2026-11-20T09:45:00Z", t, F.STATUT_FENETRE_MS), false, "un statut : 10 minutes");
  assert.equal(F.ATTENTE, "attente: ");
  assert.equal(F.limiteEnvoi(t), "2026-11-20T09:55:00.000Z");
  assert.equal(F.ESSAIS_MAX, 5);
});

test("écran : mêmes seuils que la fonction (30 s à vérifier, 5 min en échec)", () => {
  assert.equal(E.ENVOI_A_VERIFIER_MS, F.ENVOI_A_VERIFIER_MS);
  assert.equal(E.ENVOI_EXPIRE_MS, F.ENVOI_EXPIRE_MS);
});

test("écran : envoi au résultat inconnu, attente, à vérifier puis expiré", () => {
  const t = Date.parse("2026-11-20T10:00:00Z");
  const m = (envoye_le, o = {}) => ({ id: "m", sens: "sortant", origine: "gestion", statut_envoi: "envoi", envoye_le, ...o });
  assert.equal(E.envoiAVerifier(m("2026-11-20T09:59:45Z"), t), "attente");
  assert.equal(E.envoiAVerifier(m("2026-11-20T09:59:20Z"), t), "verifier");
  assert.equal(E.envoiAVerifier(m("2026-11-20T09:54:00Z"), t), "expire");
  assert.equal(E.envoiAVerifier(m("2026-11-20T09:59:59Z", { statut_envoi: "echec", erreur_envoi: "sans_confirmation" }), t), "expire", "passé en échec par la reprise");
  assert.equal(E.envoiAVerifier(m("2026-11-20T09:00:00Z", { statut_envoi: "envoye" }), t), null);
  assert.equal(E.envoiAVerifier(m("2026-11-20T09:00:00Z", { origine: "app" }), t), null, "un message de l'app n'est jamais à vérifier");
  assert.equal(E.envoiAVerifier(m("2026-11-20T09:00:00Z", { statut_envoi: "echec", erreur_envoi: "40008 x" }), t), null, "un refus de WhatsApp n'est pas un doute");
  // Redessin au bon moment : 30 s après l'envoi, puis à 5 min.
  assert.equal(E.prochainChangement([m("2026-11-20T09:59:50Z")], t), 20_250);
  assert.equal(E.prochainChangement([m("2026-11-20T09:59:00Z")], t), 240_250);
  assert.equal(E.prochainChangement([m("2026-11-20T09:50:00Z"), { sens: "entrant" }], t), null);
  // Le plus récent des envois en doute porte la carte.
  const d = E.envoiEnDoute([m("2026-11-20T09:58:00Z", { id: "a" }), m("2026-11-20T09:59:50Z", { id: "b" }), m("2026-11-20T09:59:00Z", { id: "c" })], t);
  assert.equal(d.id, "c");
  assert.equal(E.envoiEnDoute([m("2026-11-20T09:59:55Z")], t), null, "moins de 30 s : pas encore de carte");
});

test("écran : statut discret sous la bulle, erreurs de Meta en clair", () => {
  const t = Date.parse("2026-11-20T10:00:00Z");
  const s = (o) => E.statutEnvoi({ sens: "sortant", origine: "gestion", envoye_le: "2026-11-20T09:00:00Z", ...o }, t);
  assert.equal(s({ statut_envoi: "envoye" }).libelle, "envoyé");
  assert.equal(s({ statut_envoi: "remis" }).libelle, "remis");
  assert.deepEqual(s({ statut_envoi: "lu" }), { cle: "lu", libelle: "lu" });
  assert.equal(s({ statut_envoi: "echec", erreur_envoi: "40008 131047 - Re-engagement message" }).detail, "Plus de 24 h depuis le dernier message du client : WhatsApp refuse un texte libre.");
  assert.equal(s({ statut_envoi: "echec", erreur_envoi: "99999 inconnu" }).detail, null, "une raison inconnue reste telle quelle (affichée brute)");
  assert.equal(s({ statut_envoi: "envoi", envoye_le: "2026-11-20T09:59:50Z" }).cle, "envoi");
  assert.equal(s({ statut_envoi: "envoi", envoye_le: "2026-11-20T09:59:00Z" }).cle, "doute");
  assert.equal(s({ statut_envoi: null, origine: "app" }), null, "message de l'app sans statut : rien");
  assert.equal(E.statutEnvoi({ sens: "entrant", statut_envoi: "lu" }, t), null, "jamais sur un message du client");
});

test("Réglages : résumé de la réception (en erreur, abandonnés, en retard)", () => {
  assert.equal(E.resumeReception(null), null);
  assert.equal(E.resumeReception({ en_erreur: 0, abandonnes: 0, en_retard: 0, envois_a_verifier: 0 }).niveau, "ok");
  const ab = E.resumeReception({ en_erreur: 2, abandonnes: 1, en_retard: 0, envois_a_verifier: 3 });
  assert.deepEqual([ab.niveau, ab.vars.n, ab.relancer, ab.envois], ["alerte", 1, true, 3], "les abandonnés d'abord, avec « Relancer »");
  assert.deepEqual([E.resumeReception({ en_erreur: 2 }).niveau, E.resumeReception({ en_erreur: 2 }).relancer], ["attention", false]);
  assert.equal(E.resumeReception({ en_retard: "4" }).vars.n, 4);
});

test("envoi : webhook_url des statuts dans le corps de Telnyx, seulement une adresse https", () => {
  assert.equal(corpsTelnyx({ de: "+1", vers: "+2", texte: "Hi", webhook: "https://x.supabase.co/functions/v1/whatsapp" }).webhook_url, "https://x.supabase.co/functions/v1/whatsapp");
  assert.equal("webhook_url" in corpsTelnyx({ de: "+1", vers: "+2", texte: "Hi", webhook: "http://x" }), false);
  assert.equal("webhook_url" in corpsTelnyx({ de: "+1", vers: "+2", texte: "Hi" }), false);
});

test("whatsapp-envoi : message rangé avant l'appel, complété après, retiré seulement sur un refus sûr", () => {
  const src = lire("supabase/functions/whatsapp-envoi/index.ts");
  const range = src.indexOf('statut_envoi: "envoi"');
  const appel = src.indexOf('fetch("https://api.telnyx.com/v2/messages/whatsapp"');
  assert.ok(range > 0 && appel > range, "rangé « envoi » avant l'appel à Telnyx");
  assert.match(src, /if \(errR \|\| !messageId\) \{\s+await relacher\(\);[\s\S]{0,200}return json\(\{ erreur: "base" \}, 500\);/, "non rangé : rien ne part et la réponse redevient à faire");
  assert.match(src, /catch \{[\s\S]{0,400}return json\(\{ erreur: "verifier_whatsapp", message_id: messageId \}, 504\);/, "délai dépassé : le message reste dans le fil");
  assert.match(src, /lu\.statut >= 500 \|\| \(lu\.statut >= 200 && lu\.statut < 300\)/, "5xx ou 2xx illisible : doute, rien n'est retiré");
  assert.match(src, /await retirer\(\);\s+console\.error\("whatsapp-envoi : refus Telnyx"/, "refus sûr : message retiré du fil");
  assert.match(src, /update\(\{ telnyx_id: lu\.id, statut_envoi: "envoye"[\s\S]{0,120}\.in\("statut_envoi", \["envoi", "echec"\]\)/, "complété avec l'id Telnyx");
  assert.match(src, /if \(errM\) return json\(\{ erreur: "base" \}, 500\);/, "une lecture en échec n'est pas une fenêtre fermée (M4)");
  assert.match(src, /webhook: `\$\{URL_SB\}\/functions\/v1\/whatsapp`/);
});

test("fonction whatsapp : reprise par le cron, essai compté à la réservation, statuts, modifications vérifiées", () => {
  const src = lire("supabase/functions/whatsapp/index.ts");
  assert.match(src, /if \(!req\.headers\.get\("telnyx-signature-ed25519"\) && req\.headers\.get\("authorization"\)\) \{\s+if \(!\(await appelCron\(req\)\)\) return repondre\(REPONSES\.signature\);/, "sans signature : le jeton du cron, sinon 401");
  assert.match(src, /for \(const nom of \["RAPPELS_SECRET", "SUPABASE_SERVICE_ROLE_KEY"\]\)/);
  assert.match(src, /await memeSecret\(jeton, secret\)/, "comparaison en temps constant");
  assert.match(src, /db\.rpc\("whatsapp_reserver_evenement", \{ p_id: id \}\)/, "réservation par la base, l'essai compté tout de suite");
  assert.doesNotMatch(src, /essais: Math\.min/, "plus d'incrément après coup");
  assert.match(src, /interpreterStatut\(ev\) \|\| interpreter\(ev\)/);
  assert.match(src, /\.eq\("statut_envoi", "envoi"\)\.lt\("envoye_le", limiteEnvoi\(\)\)/, "envois sans confirmation passés en échec après 5 minutes");
  assert.match(src, /if \(!conv\) throw new CibleAbsente\("original_introuvable"\);/, "I5 : conversation absente, repris");
  assert.match(src, /if \(!cible \|\| !cible\.length\) throw new CibleAbsente\("original_introuvable"\);/, "I5 : 0 ligne touchée, repris");
  assert.match(src, /if \(errC\) throw new Error\(errC\.message\);/, "I5 : erreur de lecture levée");
  assert.match(src, /err instanceof CibleAbsente && \(!aReprendre\(pris\.recu_le, Date\.now\(\), err\.fenetre\) \|\| pris\.essais >= ESSAIS_MAX\)/, "classé après sa fenêtre ou au dernier essai");
  assert.match(src, /throw new CibleAbsente\("statut_message_inconnu", STATUT_FENETRE_MS\)/, "un statut inconnu attend 10 minutes, pas 30");
  assert.match(src, /\$\{err instanceof CibleAbsente \? ATTENTE : ""\}/, "attente hors du compteur d'erreurs");
  assert.match(lire("supabase/functions/whatsapp-envoi/index.ts"), /if \(!maj \|\| !maj\.length\) \{[\s\S]{0,300}whatsapp_ranger[\s\S]{0,400}statut_envoi: "envoye"/, "parti mais retiré entre-temps : rangé de nouveau");
  assert.match(src, /m\.statut_envoi === null \? q\.is\("statut_envoi", null\) : q\.in\("statut_envoi", avant\)/, "écriture conditionnelle du statut");
});

test("migration 64 et cron : index anti-doublon, réservation, compteur réservé aux administrateurs, cron sans secret", () => {
  const sql = lire("docs/gestion/migration-64-whatsapp-fiabilite.sql");
  assert.match(sql, /create unique index if not exists whatsapp_messages_evenement on whatsapp_messages \(evenement_id\) where evenement_id is not null;/);
  assert.match(sql, /set pris_le = now\(\), essais = least\(e\.essais \+ 1, 100\)/);
  assert.match(sql, /grant execute on function whatsapp_etat_reception\(\), whatsapp_relancer_evenements\(\), whatsapp_confirmer_envoi\(uuid, boolean\) to authenticated;/);
  assert.match(sql, /revoke all on function whatsapp_ranger\(uuid, text, text, jsonb\), whatsapp_reserver_evenement\(text\)/);
  const cron = lire("docs/gestion/cron-whatsapp-reprise.sql");
  assert.match(cron, /select command into modele from cron\.job where jobname = 'rappels-h1';/, "commande recopiée de rappels-h1");
  assert.doesNotMatch(cron, /Bearer (?!\*\*\*|\[)[A-Za-z0-9]/, "aucun jeton écrit");
  assert.match(cron, /'2-59\/5 \* \* \* \*'/);
});

test("écran : carte « Vérifiez dans WhatsApp », statut sous la bulle, compteur dans Réglages, démo", async () => {
  const vue = lire("src/gestion/js/views/whatsapp.mjs");
  assert.match(vue, /etat\.store\.whatsappConfirmerEnvoi\(c\.id, parti\)/);
  assert.match(vue, /tr\("C'est parti"\)[\s\S]{0,200}tr\("Pas parti"\)/);
  assert.match(vue, /doute \? carteVerifier\(c, doute\) : null,\s+carteProposition\(c, prop, messages\)/);
  assert.match(vue, /minuterieEnvoi = setTimeout/);
  assert.match(lire("src/gestion/js/views/whatsapp-reglages.mjs"), /etat\.store\.whatsappEtatReception\(\)\.then\(remplir/);
  assert.match(lire("src/gestion/js/store-supabase.mjs"), /signal: AbortSignal\.timeout\(40_000\)/, "M19 : délai côté client");
});

test("Assistant I6 : un appel d'outil sans résultat reçoit un résultat « interrompu », la conversation repart", async () => {
  const { completerOrphelins } = await import("../supabase/functions/agent/prompt.js");
  const appel = (id) => ({ type: "tool_use", id, name: "situer_hotels", input: {} });
  const res = (id) => ({ type: "tool_result", tool_use_id: id, content: "{}" });
  const ok = [{ role: "user", content: [{ type: "text", text: "Hotels?" }] }, { role: "assistant", content: [appel("a")] }, { role: "user", content: [res("a")] }];
  assert.deepEqual(completerOrphelins(ok), ok, "rien à réparer : identique");
  // Coupée pendant l'outil, puis la personne écrit : le résultat ouvre son message.
  const r1 = completerOrphelins([{ role: "user", content: [{ type: "text", text: "Hotels?" }] }, { role: "assistant", content: [{ type: "text", text: "…" }, appel("a"), appel("b")] }, { role: "user", content: [res("b"), { type: "text", text: "Encore ?" }] }]);
  assert.equal(r1.length, 3);
  assert.deepEqual(r1[2].content.map((b) => b.type), ["tool_result", "tool_result", "text"], "les tool_result d'abord");
  assert.deepEqual(r1[2].content.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id).sort(), ["a", "b"]);
  assert.equal(r1[2].content.find((b) => b.tool_use_id === "a").is_error, true);
  // Dernier message de l'historique : un message de résultats à part (le nouveau message de la personne suit, l'API fusionne les deux).
  const r2 = completerOrphelins([{ role: "user", content: [{ type: "text", text: "x" }] }, { role: "assistant", content: [appel("z")] }]);
  assert.deepEqual(r2[2], { role: "user", content: [{ type: "tool_result", tool_use_id: "z", content: JSON.stringify({ erreur: "interrompu" }), is_error: true }] });
  // Suivi d'une autre réponse de Claude (deux onglets) : un message de résultats est inséré entre les deux.
  const r3 = completerOrphelins([{ role: "assistant", content: [appel("y")] }, { role: "assistant", content: [{ type: "text", text: "ok" }] }]);
  assert.deepEqual(r3.map((m) => m.role), ["assistant", "user", "assistant"]);
  assert.match(lire("supabase/functions/agent/index.ts"), /const gardesBruts = completerOrphelins\(historique\(debutValide\(/);
});

test("Assistant I7 : une coupure du flux (iPhone en arrière-plan) rend « coupure » et rallume l'écran", () => {
  const store = lire("src/gestion/js/store-supabase.mjs");
  assert.match(store, /try \{\s+lu = await lecteur\.read\(\);\s+\} catch \{\s+return fini \? \{ ok: true \} : \{ erreur: "coupure" \};/, "seule la lecture est protégée");
  const vue = lire("src/gestion/js/views/agent.mjs");
  assert.match(vue, /\}\)\.catch\(\(\) => \(\{ erreur: "coupure" \}\)\);\s+etape\.remove\(\);/, "jamais « L'assistant réfléchit » sans fin");
  assert.match(vue, /if \(\(!conv \|\| r\.erreur !== "coupure"\) && !champ\.value\.trim\(\)\) champ\.value = texte;/, "texte remis après une erreur propre, même dans une conversation existante");
});

test("temps réel I9 et I10 : rechargement après connexion, relecture au retour du canal, canaux refaits après une longue veille", () => {
  const app = lire("src/gestion/js/app.mjs");
  assert.match(app, /if \(etat\.store\.ecouterWhatsApp\) return void location\.reload\(\);/, "I9 : après la connexion, le temps réel se branche");
  assert.match(app, /if \(e === "abonne" && etatPrecedent !== null\) relireWhatsApp\(\{ redessiner: true \}\);/, "I10 : retour à « abonné » = relecture");
  assert.match(lire("src/gestion/js/store-supabase.mjs"), /if \(forcer\) etatCourant = "reconnexion";/, "reconnexion forcée : le retour à « abonné » est annoncé");
  assert.match(app, /etat\.store\.reveillerDirect\(\{ forcer: longue \}\)/);
  assert.match(lire("src/gestion/js/store-supabase.mjs"), /if \(ch && !forcer && !doitReabonner\(ch\.state\)\) return void/, "forcé : refait même « joined »");
});
