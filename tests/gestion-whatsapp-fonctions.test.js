// Suivi des conversations WhatsApp dans Gestion (migrations 61 et 62, 20.11.2026, « Lance tout » de Jérémy) : créer ou mettre à jour le dossier
// par l'Assistant, voucher, signal de paiement, promesses en tâches, résumé. Logique pure, démo et branchement.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "../src/gestion/js/whatsapp-suivi-calc.mjs";
import { whatsappDemo } from "../src/gestion/js/demo-whatsapp.mjs";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (f) => fs.readFileSync(path.join(RACINE, "src/gestion/js", f), "utf8");

test("créer ou mettre à jour le dossier : mode, demande transmise à l'Assistant, liaison après validation", () => {
  assert.equal(S.modeDossier({ dossier_id: null }), "creer");
  assert.equal(S.modeDossier({ dossier_id: "d1" }), "maj");
  assert.deepEqual(S.demandeAgent(JSON.stringify({ id: "w1", mode: "creer", entite: "t", pieces: ["o/c/a.jpg", "o/c/a.jpg", 3, "o/c/b.pdf"] })), { whatsapp_conversation_id: "w1", whatsapp_mode: "creer", entite_id: "t", whatsapp_pieces: ["o/c/a.jpg", "o/c/b.pdf"], agent_conversation_id: null });
  assert.deepEqual(S.demandeAgent({ id: "w1", mode: "maj" }), { whatsapp_conversation_id: "w1", whatsapp_mode: "maj", entite_id: null, whatsapp_pieces: [], agent_conversation_id: null }, "sans pièce cochée, aucune");
  assert.equal(S.demandeAgent({ id: "w1", mode: "creer", pieces: Array.from({ length: 9 }, (_, i) => `p${i}`) }).whatsapp_pieces.length, 6, "six au plus");
  for (const v of [null, "", "pas du json", JSON.stringify({ id: "w1", mode: "supprimer" }), JSON.stringify({ mode: "creer" })]) assert.equal(S.demandeAgent(v), null, String(v));
  const dossier = { id: "d9", client_id: "c9" };
  assert.deepEqual(S.liaisonApresDossier({ id: "w", entite_id: "t" }, dossier, "t"), { action: "ecrire", patch: { client_id: "c9", dossier_id: "d9" } });
  assert.deepEqual(S.liaisonApresDossier({ id: "w", entite_id: "t", client_id: "c9" }, dossier, "t"), { action: "ecrire", patch: { dossier_id: "d9" } }, "seulement ce qui est vide");
  assert.deepEqual(S.liaisonApresDossier({ id: "w", entite_id: "t", client_id: "c9", dossier_id: "d9" }, dossier, "t"), { action: "rien", patch: null }, "déjà reliée");
  assert.deepEqual(S.liaisonApresDossier({ id: "w", entite_id: "t", client_id: "c1", dossier_id: null }, dossier, "t"), { action: "demander", patch: { client_id: "c9", dossier_id: "d9" } }, "un autre client : on demande");
  assert.deepEqual(S.liaisonApresDossier({ id: "w", entite_id: "t", client_id: "c9", dossier_id: "d1" }, dossier, "t").action, "demander", "un autre dossier : on demande");
  // 22.11.2026 : un client appartient à Secret et à Taxi. Le dossier se relie sans ranger la conversation dans son entreprise ; rangée dans
  // l'autre entreprise, elle redevient commune (entite_id vide).
  assert.deepEqual(S.liaisonApresDossier({ id: "w", entite_id: null }, { ...dossier, entite_id: "s" }, "t"), { action: "ecrire", patch: { client_id: "c9", dossier_id: "d9" } }, "client à trier : relié, pas rangé");
  assert.equal("entite_id" in S.liaisonApresDossier({ id: "w", entite_id: null }, dossier, "t").patch, false, "jamais rangé chez l'Assistant");
  assert.deepEqual(S.liaisonApresDossier({ id: "w", entite_id: "s", client_id: "c1" }, { ...dossier, entite_id: "t" }, "t"), { action: "ecrire", patch: { entite_id: null, client_id: "c9", dossier_id: "d9" } }, "rangée chez Secret, dossier Taxi : redevient commune et se relie");
  // Un contact qui n'est pas un client garde l'ancienne règle : rangé dans l'entreprise du dossier, rien dans une autre.
  assert.deepEqual(S.liaisonApresDossier({ id: "w", entite_id: null, type_contact: "hotel" }, { ...dossier, entite_id: "s" }, "t"), { action: "ecrire", patch: { entite_id: "s", client_id: "c9", dossier_id: "d9" } });
  assert.equal(S.liaisonApresDossier({ id: "w", entite_id: "s", type_contact: "chauffeur" }, dossier, "t").action, "rien", "autre entreprise");
  assert.equal(S.liaisonApresDossier(null, dossier, "t").action, "rien", "introuvable en base");
  assert.equal(S.liaisonApresDossier({ id: "w", entite_id: "t" }, null, "t").action, "rien");
  for (const r of [S.liaisonApresDossier({ id: "w", entite_id: "t" }, dossier, "t"), S.liaisonApresDossier({ id: "w", entite_id: "t", client_id: "c1" }, dossier, "t")]) assert.ok(!("entite_id" in r.patch), "jamais l'entreprise");
  for (const code of ["whatsapp_introuvable", "dossier_introuvable"]) assert.ok(S.ERREURS_AGENT_WHATSAPP[code], code);
});

test("signal de paiement : motif texte ou pièce, rien sans signal", () => {
  assert.equal(S.paiementSignale({ paiement_signale: null }), null);
  assert.equal(S.paiementSignale({}), null);
  assert.deepEqual(S.paiementSignale({ paiement_signale: { message_id: "m", le: "2026-11-20T10:00:00Z", motif: "piece" } }), { motif: "piece", le: "2026-11-20T10:00:00Z", message_id: "m" });
  assert.equal(S.paiementSignale({ paiement_signale: { motif: "bizarre" } }).motif, "texte");
  assert.ok(S.MOTIFS_PAIEMENT.texte && S.MOTIFS_PAIEMENT.piece);
});

test("résumé : trois lignes au plus, sans puces ni lignes vides, une date ou un nombre en tête reste", () => {
  assert.deepEqual(S.lignesResume("- Couple\n\n• Ferry samedi\n3. Paiement à confirmer\nLigne de trop"), ["Couple", "Ferry samedi", "Paiement à confirmer"]);
  assert.deepEqual(S.lignesResume("22.11 : ferry pour Phi Phi\n2 adultes et 1 enfant\n* 2) reste"), ["22.11 : ferry pour Phi Phi", "2 adultes et 1 enfant", "reste"]);
  assert.deepEqual(S.lignesResume("1) Client\n12.5 % d'acompte"), ["Client", "12.5 % d'acompte"]);
  assert.deepEqual(S.lignesResume(null), []);
  assert.equal(S.resumeEnRetard({ resume_le: "2026-11-20T10:00:00Z", dernier_message_le: "2026-11-20T10:05:00Z" }), true);
  assert.equal(S.resumeEnRetard({ resume_le: "2026-11-20T10:06:00Z", dernier_message_le: "2026-11-20T10:05:00Z" }), false);
  assert.equal(S.resumeEnRetard({ resume_le: null, dernier_message_le: "2026-11-20T10:05:00Z" }), false);
});

test("pièces à joindre : photos jpeg, png, webp et PDF copiés seulement, aucune cochée d'office, six au plus", () => {
  const m = (sens, envoye_le, medias, o = {}) => ({ sens, envoye_le, medias, ...o });
  const messages = [
    m("entrant", "2026-11-20T08:00:00Z", [{ type: "image", mime: "image/jpeg", chemin: "o/c/billet.jpg", statut: "copie", taille: 120000, legende: "Ticket" }]),
    m("entrant", "2026-11-20T09:00:00Z", [{ type: "document", mime: "application/pdf", chemin: "o/c/hotel.pdf", statut: "copie", taille: 8 * 1024 * 1024, nom: "hotel.pdf" }]),
    m("entrant", "2026-11-20T09:30:00Z", [{ type: "image", mime: "image/heic", chemin: "o/c/x.heic", statut: "copie", taille: 1000 }]),
    m("entrant", "2026-11-20T09:40:00Z", [{ type: "image", mime: "image/png", chemin: null, statut: "efface", taille: 1000 }]),
    m("entrant", "2026-11-20T09:50:00Z", [{ type: "image", mime: "image/webp", chemin: "o/c/gros.webp", statut: "copie", taille: 6 * 1024 * 1024 }]),
    m("entrant", "2026-11-20T10:00:00Z", [{ type: "image", mime: "image/png", chemin: "o/c/supprimee.png", statut: "copie", taille: 1000 }], { supprime_le: "2026-11-20T10:01:00Z" }),
    m("sortant", "2026-11-20T11:00:00Z", [{ type: "image", mime: "image/png; x=1", chemin: "o/c/plan.png", statut: "copie", taille: 2000 }]),
  ];
  const p = S.piecesProposees(messages);
  assert.deepEqual(p.map((x) => x.chemin), ["o/c/plan.png", "o/c/hotel.pdf", "o/c/billet.jpg"], "les plus récentes d'abord ; ni heic, ni effacée, ni image trop grosse, ni message supprimé");
  assert.equal(p[0].sens, "sortant");
  assert.equal(p[2].legende, "Ticket");
  let cochees = [];
  for (let i = 0; i < 8; i++) cochees = S.basculerPiece(cochees, `p${i}`);
  assert.equal(cochees.length, S.PIECES_MAX);
  assert.deepEqual(S.basculerPiece(cochees, "p0"), ["p1", "p2", "p3", "p4", "p5"], "décocher");
  const vue = source("views/whatsapp.mjs");
  assert.match(vue, /let cochees = \[\];/, "aucune cochée par défaut");
  assert.match(vue, /tr\("Ne cochez jamais une capture de virement, de compte ou de QR de paiement\."\)/);
  assert.match(vue, /onclick: \(\) => fin\(\[\.\.\.cochees\]\) \}, tr\("Continuer"\)/, "Continuer aussi sans pièce");
  assert.match(source("views/agent.mjs"), /whatsapp_pieces: whatsapp\.whatsapp_pieces \|\| \[\]/);
});

test("promesses : tâches « WhatsApp, … » encore à faire, liées par le dossier ou par le prénom", () => {
  const taches = [
    { id: "1", titre: "WhatsApp, Mark : confirmer l'heure", dossier_id: "d1", entite_id: "s", fait: false },
    { id: "2", titre: "WhatsApp, Mark : déjà fait", dossier_id: "d1", entite_id: "s", fait: true },
    { id: "3", titre: "Relancer Mark", dossier_id: "d1", entite_id: "s", fait: false },
    { id: "4", titre: "WhatsApp, Lucia : envoyer le prix", dossier_id: null, entite_id: "s", fait: false },
    { id: "5", titre: "WhatsApp, Lucia : autre entreprise", dossier_id: null, entite_id: "t", fait: false },
  ];
  assert.deepEqual(S.tachesPromesse(taches, { dossier_id: "d1", entite_id: "s", nom: "Mark" }).map((t) => t.id), ["1"]);
  assert.deepEqual(S.tachesPromesse(taches, { dossier_id: null, entite_id: "s", nom: "Lucia Gómez" }).map((t) => t.id), ["4"]);
  assert.deepEqual(S.tachesPromesse(taches, null), []);
});

test("démo : résumé, signal de paiement, dossier relié et promesse", () => {
  let n = 0;
  const uid = () => `id${++n}`;
  const entites = [{ id: "e2", slug: "excursions" }, { id: "e3", slug: "taxi" }];
  const dossier = { id: "d1", entite_id: "e2", client_id: "c1" };
  const ajouterJours = (iso, j) => new Date(Date.parse(`${iso}T00:00:00Z`) + j * 86400000).toISOString().slice(0, 10);
  const d = whatsappDemo({ entites, uid, organisation: "org", maintenant: Date.parse("2026-11-20T08:00:00Z"), suivi: { dossier, client: { prenom: "Mark" }, ajd: "2026-11-20", ajouterJours } });
  const c = d.whatsapp_conversations.find((x) => x.dossier_id === "d1");
  assert.ok(c, "une conversation reliée au dossier");
  assert.equal(S.lignesResume(c.resume).length, 3);
  assert.equal(S.paiementSignale(c).motif, "piece");
  assert.equal(S.tachesPromesse(d.taches, c, { prenom: "Mark" }).length, 1);
  assert.ok(d.whatsapp_conversations.some((x) => x.resume && x.dossier_id !== "d1"), "un autre résumé");
});

test("démo : l'Assistant crée le dossier depuis une conversation WhatsApp, signal de paiement remis à vide seulement", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?fonctions=${Date.now()}`);
    const store = creer();
    const brut = await store.charger();
    assert.equal(brut.whatsapp_suivi_disponible, true);
    const reliee = brut.whatsapp_conversations.find((c) => c.paiement_signale);
    assert.ok(reliee && reliee.dossier_id, "la démo a une conversation reliée avec un signal de paiement");
    const r = await store.modifier("whatsapp_conversations", reliee.id, { paiement_signale: { motif: "texte" } });
    assert.ok(r.paiement_signale, "le signal ne s'écrit pas depuis l'outil");
    assert.equal((await store.modifier("whatsapp_conversations", reliee.id, { paiement_signale: null })).paiement_signale, null, "seulement remis à vide");
    // L'Assistant de la démo (allumé pour l'essai) reçoit la conversation à trier de Lucia sans qu'on la range (lot 2, comme la fonction).
    // Une conversation rangée dans une autre entreprise reste refusée.
    const aTrier = brut.whatsapp_conversations.find((c) => !c.entite_id);
    const excursions = brut.entites.find((e) => e.slug === "excursions");
    const reglages = (await store.charger()).reglages[excursions.id];
    await store.enregistrerReglages(excursions.id, { ...reglages, agent_ia: true });
    const autre = brut.whatsapp_conversations.find((c) => c.entite_id && c.entite_id !== excursions.id);
    if (autre) assert.deepEqual(await store.agentEnvoyer({ entite_id: excursions.id, whatsapp_conversation_id: autre.id, whatsapp_mode: "creer", texte: "" }, () => {}), { erreur: "whatsapp_introuvable" }, "rangée ailleurs : refusée");
    await store.modifier("whatsapp_conversations", aTrier.id, { entite_id: excursions.id });
    assert.deepEqual(await store.whatsappConversation(aTrier.id), { id: aTrier.id, entite_id: excursions.id, client_id: null, dossier_id: null }, "relue en base pour la liaison");
    const evenements = [];
    const rep = await store.agentEnvoyer({ entite_id: excursions.id, whatsapp_conversation_id: aTrier.id, whatsapp_mode: "creer", texte: "" }, (ev) => evenements.push(ev));
    assert.deepEqual(rep, { ok: true });
    const conv = evenements.find((e) => e.t === "conversation");
    assert.equal(conv.whatsapp_conversation_id, aTrier.id);
    assert.equal(conv.titre, "Lucia");
    assert.deepEqual(await store.agentEnvoyer({ entite_id: excursions.id, whatsapp_conversation_id: aTrier.id, whatsapp_mode: "maj", texte: "" }, () => {}), { erreur: "dossier_introuvable" });
    assert.deepEqual(await store.agentEnvoyer({ entite_id: excursions.id, whatsapp_conversation_id: "inconnue", whatsapp_mode: "creer", texte: "" }, () => {}), { erreur: "whatsapp_introuvable" });
    const convs = await store.agentConversations(excursions.id);
    assert.equal(convs.find((c) => c.id === conv.id).whatsapp_conversation_id, aTrier.id);
  } finally {
    delete globalThis.localStorage;
  }
});

test("branchement : boutons de l'en-tête, Assistant, voucher, paiement, résumé, tâches, aucune relance de ferry", () => {
  const vue = source("views/whatsapp.mjs");
  assert.match(vue, /relie \? tr\("Mettre à jour le dossier"\) : tr\("Créer le dossier"\)/);
  assert.match(vue, /sessionStorage\.setItem\(CLE_DEMANDE_AGENT, JSON\.stringify\(\{ id: c\.id, mode: modeDossier\(c\), entite: entiteId, pieces, le: Date\.now\(\), \.\.\.\(liee \? \{ agent: liee\.id \} : \{\}\) \}\)\)/);
  assert.match(vue, /const pieces = await choisirPieces\(c\);\n\s+if \(pieces === null\) return;/, "la feuille des pièces avant l'Assistant, fermer annule");
  assert.match(vue, /tr\("Résumé automatique, à vérifier"\)/);
  assert.match(vue, /resumeEnRetard\(c\) \? ` \$\{tr\("\(avant le dernier message\)"\)\}`/);
  assert.match(vue, /naviguer\(liee \? `#\/agent\/\$\{liee\.id\}` : "#\/agent\/nouvelle"\)/);
  assert.match(vue, /entreprisePourAssistant\(\{ conv: c, prop, choix, activeId: etat\.entiteId \}\) \|\| \(await choisirEntreprise\(c, prop\)\)/, "à trier : la question seulement si rien ne permet de choisir");
  assert.match(vue, /envoyerVoucher\(x\)/, "écran d'envoi du voucher habituel");
  assert.match(vue, /naviguer\(`#\/dossier\/\$\{dossier\.id\}\?paiement=1`\)/);
  assert.match(vue, /peut\("paiements\.ecrire"\)/);
  assert.match(vue, /modifier\("whatsapp_conversations", c\.id, \{ paiement_signale: null \}\)/);
  assert.doesNotMatch(vue, /[Ff]err(y|ys) à r|relance/, "plus de relance des ferrys (Jérémy, 20.11.2026)");
  assert.ok(!("ferrysARelancer" in S) && !("messageRelanceFerry" in S));
  assert.match(vue, /tr\("mis à jour à \{heure\}"/);
  assert.match(vue, /tr\("Tâche créée : \{titre\}"/);
  const agent = source("views/agent.mjs");
  assert.match(agent, /whatsapp_conversation_id: whatsapp\.whatsapp_conversation_id, whatsapp_mode: whatsapp\.whatsapp_mode, whatsapp_pieces: whatsapp\.whatsapp_pieces \|\| \[\], texte: ""/);
  assert.match(agent, /if \(depuisWhatsApp\) \{\n\s+depuisWhatsAppEcran = true;\n\s+return void envoyer\(\{ whatsapp: depuisWhatsApp \}\);/);
  assert.match(agent, /if \(dossier && c\.genre === "dossier"\) await relierWhatsApp\(dossier\);/);
  assert.match(agent, /await modifier\("whatsapp_conversations", waId, patch\);/);
  assert.match(agent, /const wc = etat\.store\.whatsappConversation \? await etat\.store\.whatsappConversation\(waId\) : null;/, "relue en base, pas dans etat.brut");
  assert.match(agent, /if \(action === "demander" && !\(await confirmer\(tr\("Remplacer le dossier relié \?/);
  assert.match(source("views/dossier.mjs"), /\[\?&\]paiement=1\(&\|\$\)/, "le dossier ouvre le formulaire de paiement");
  const sb = source("store-supabase.mjs");
  assert.match(sb, /resume, resume_le, paiement_signale, promesse_le/);
  // Migration 133 : relue d'abord avec le verrou de réponse, puis sans lui, puis sans la colonne de la migration 61.
  assert.match(sb, /whatsapp_conversation_id, reponse_par, reponse_le`\);\n\s+if \(error && colonneAbsente\(error, "reponse_par"\)\)[^\n]+\n\s+if \(error && colonneAbsente\(error, "whatsapp_conversation_id"\)\)/, "relu sans la colonne avant la migration 61");
});
