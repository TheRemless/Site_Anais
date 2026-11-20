// Suivi des conversations WhatsApp dans Gestion (migrations 61 et 62, 20.11.2026, « Lance tout » de Jérémy) : créer ou mettre à jour le dossier
// par l'Assistant, voucher, signal de paiement, ferrys payés d'avance à relancer, promesses en tâches, résumé. Logique pure, démo et branchement.
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
  assert.deepEqual(S.demandeAgent(JSON.stringify({ id: "w1", mode: "creer", entite: "t", pieces: ["o/c/a.jpg", "o/c/a.jpg", 3, "o/c/b.pdf"] })), { whatsapp_conversation_id: "w1", whatsapp_mode: "creer", entite_id: "t", whatsapp_pieces: ["o/c/a.jpg", "o/c/b.pdf"] });
  assert.deepEqual(S.demandeAgent({ id: "w1", mode: "maj" }), { whatsapp_conversation_id: "w1", whatsapp_mode: "maj", entite_id: null, whatsapp_pieces: [] }, "sans pièce cochée, aucune");
  assert.equal(S.demandeAgent({ id: "w1", mode: "creer", pieces: Array.from({ length: 9 }, (_, i) => `p${i}`) }).whatsapp_pieces.length, 6, "six au plus");
  for (const v of [null, "", "pas du json", JSON.stringify({ id: "w1", mode: "supprimer" }), JSON.stringify({ mode: "creer" })]) assert.equal(S.demandeAgent(v), null, String(v));
  const dossier = { id: "d9", client_id: "c9" };
  assert.deepEqual(S.liaisonApresDossier({ id: "w", entite_id: "t" }, dossier, "t"), { action: "ecrire", patch: { client_id: "c9", dossier_id: "d9" } });
  assert.deepEqual(S.liaisonApresDossier({ id: "w", entite_id: "t", client_id: "c9" }, dossier, "t"), { action: "ecrire", patch: { dossier_id: "d9" } }, "seulement ce qui est vide");
  assert.deepEqual(S.liaisonApresDossier({ id: "w", entite_id: "t", client_id: "c9", dossier_id: "d9" }, dossier, "t"), { action: "rien", patch: null }, "déjà reliée");
  assert.deepEqual(S.liaisonApresDossier({ id: "w", entite_id: "t", client_id: "c1", dossier_id: null }, dossier, "t"), { action: "demander", patch: { client_id: "c9", dossier_id: "d9" } }, "un autre client : on demande");
  assert.deepEqual(S.liaisonApresDossier({ id: "w", entite_id: "t", client_id: "c9", dossier_id: "d1" }, dossier, "t").action, "demander", "un autre dossier : on demande");
  assert.equal(S.liaisonApresDossier({ id: "w", entite_id: null }, dossier, "t").action, "rien", "à trier : jamais rangée ici");
  assert.equal(S.liaisonApresDossier({ id: "w", entite_id: "s" }, dossier, "t").action, "rien", "autre entreprise");
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

test("ferrys à relancer : bateau confirmé, à venir, pas payé sur place, dossier non soldé", () => {
  const trajets = [
    { id: "f", mode: "Ferry", de: "Koh Lanta", vers: "Koh Phi Phi" },
    { id: "s", mode: "SPEEDBOAT", de: "Koh Lanta", vers: "Koh Lipe" },
    { id: "v", mode: "Van", de: "Koh Lanta", vers: "Krabi" },
    { id: "l", mode: "private longtail", de: "Saladan", vers: "Koh Rok" },
  ];
  const dossiers = [
    { id: "d1", total: 3000, recu: 1000 },
    { id: "d2", total: 2000, recu: 2000 },
    { id: "d3", total: 1500, recu: 0, annule: true },
    { id: "d4" },
  ];
  const r = (id, o) => ({ id, dossier_id: "d1", trajet_id: "f", statut: "confirme", paye_sur_place: false, date_service: "2026-11-23", ...o });
  const reservations = [
    r("ok"),
    r("speed", { trajet_id: "s", date_service: "2026-11-22" }),
    r("longtail", { trajet_id: "l" }),
    r("van", { trajet_id: "v" }),
    r("passe", { date_service: "2026-11-19" }),
    r("sur_place", { paye_sur_place: true }),
    r("annulee", { statut: "annule" }),
    r("solde", { dossier_id: "d2" }),
    r("dossier_annule", { dossier_id: "d3" }),
    r("sans_total", { dossier_id: "d4" }),
    r("sans_trajet", { trajet_id: null }),
  ];
  const f = S.ferrysARelancer({ reservations, trajets, dossiers, aujourdhui: "2026-11-20" });
  assert.deepEqual(f.map((x) => x.reservation.id), ["speed", "ok", "longtail"], "triés par date ; mode sans tenir compte de la casse");
  for (const m of ["Ferry", "speedboat", "Expressboat", "catamaran", "Big boat", "Longtail"]) assert.ok(S.estBateau({ mode: m }), m);
  assert.equal(S.estBateau({ mode: "Minivan" }), false);
  assert.equal(S.estBateau(null), false);
  const parConv = S.ferrysParConversation([{ id: "w1", dossier_id: "d1" }, { id: "w2", dossier_id: "d2" }, { id: "w3", dossier_id: null }], f);
  assert.deepEqual([...parConv.keys()], ["w1"]);
  assert.equal(parConv.get("w1").length, 3);
});

test("ferry : message de relance anglais, sans signature ni coordonnées bancaires", () => {
  const m = S.messageRelanceFerry({ prenom: "Mark", trajet: { mode: "Ferry", de: "Koh Lanta", vers: "Koh Phi Phi" }, reservation: { date_service: "2026-11-22" } });
  assert.equal(m, "Hi Mark, just a reminder that your ferry from Koh Lanta to Koh Phi Phi on Sunday 22 November is confirmed once payment is received. You can pay in advance by Wise, international bank transfer or in cash at our office. Let me know which you prefer and I'll send you the payment details.");
  assert.match(S.messageRelanceFerry({ trajet: null, reservation: { libelle: "Boat to Lipe", date_service: "" } }), /^Hi, just a reminder that your Boat to Lipe is confirmed/);
  assert.doesNotMatch(m, /IBAN|account|Nani|Secret/i);
  assert.equal(S.prenomPourMessage({ nom: "Mark & Jo" }, { prenom: "Mark" }), "Mark");
  assert.equal(S.prenomPourMessage({ nom: "Lucia Gómez" }), "Lucia");
  assert.equal(S.prenomPourMessage({ nom: "+44 7700" }), "", "un numéro n'est pas un prénom");
  assert.equal(S.dateAnglaise("2026-11-22"), "Sunday 22 November");
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

test("démo : résumé, signal de paiement, ferry à relancer, dossier relié et promesse", () => {
  let n = 0;
  const uid = () => `id${++n}`;
  const entites = [{ id: "e2", slug: "excursions" }, { id: "e3", slug: "taxi" }];
  const dossier = { id: "d1", entite_id: "e2", client_id: "c1" };
  const ajouterJours = (iso, j) => new Date(Date.parse(`${iso}T00:00:00Z`) + j * 86400000).toISOString().slice(0, 10);
  const d = whatsappDemo({ entites, uid, organisation: "org", maintenant: Date.parse("2026-11-20T08:00:00Z"), suivi: { dossier, client: { prenom: "Mark" }, trajet: { id: "t1", mode: "Ferry", de: "Koh Lanta", vers: "Koh Phi Phi" }, ajd: "2026-11-20", ajouterJours } });
  const c = d.whatsapp_conversations.find((x) => x.dossier_id === "d1");
  assert.ok(c, "une conversation reliée au dossier");
  assert.equal(S.lignesResume(c.resume).length, 3);
  assert.equal(S.paiementSignale(c).motif, "piece");
  assert.equal(d.reservations.length, 1);
  const ferrys = S.ferrysARelancer({ reservations: d.reservations, trajets: [{ id: "t1", mode: "Ferry" }], dossiers: [{ ...dossier, total: 3000, recu: 0 }], aujourdhui: "2026-11-20" });
  assert.equal(ferrys.length, 1, "le ferry de la démo est à relancer");
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
    // L'Assistant de la démo (allumé pour l'essai) reçoit la conversation à trier de Lucia, une fois rangée (comme la fonction).
    const aTrier = brut.whatsapp_conversations.find((c) => !c.entite_id);
    const excursions = brut.entites.find((e) => e.slug === "excursions");
    const reglages = (await store.charger()).reglages[excursions.id];
    await store.enregistrerReglages(excursions.id, { ...reglages, agent_ia: true });
    assert.deepEqual(await store.agentEnvoyer({ entite_id: excursions.id, whatsapp_conversation_id: aTrier.id, whatsapp_mode: "creer", texte: "" }, () => {}), { erreur: "whatsapp_introuvable" }, "pas rangée : refusée");
    await store.modifier("whatsapp_conversations", aTrier.id, { entite_id: excursions.id });
    assert.deepEqual(await store.whatsappConversation(aTrier.id), { id: aTrier.id, entite_id: excursions.id, client_id: null, dossier_id: null }, "relue en base pour la liaison");
    const evenements = [];
    const rep = await store.agentEnvoyer({ entite_id: excursions.id, whatsapp_conversation_id: aTrier.id, whatsapp_mode: "creer", texte: "" }, (ev) => evenements.push(ev));
    assert.deepEqual(rep, { ok: true });
    const conv = evenements.find((e) => e.t === "conversation");
    assert.equal(conv.whatsapp_conversation_id, aTrier.id);
    assert.equal(conv.titre, "Dossier depuis WhatsApp");
    assert.deepEqual(await store.agentEnvoyer({ entite_id: excursions.id, whatsapp_conversation_id: aTrier.id, whatsapp_mode: "maj", texte: "" }, () => {}), { erreur: "dossier_introuvable" });
    assert.deepEqual(await store.agentEnvoyer({ entite_id: excursions.id, whatsapp_conversation_id: "inconnue", whatsapp_mode: "creer", texte: "" }, () => {}), { erreur: "whatsapp_introuvable" });
    const convs = await store.agentConversations(excursions.id);
    assert.equal(convs.find((c) => c.id === conv.id).whatsapp_conversation_id, aTrier.id);
  } finally {
    delete globalThis.localStorage;
  }
});

test("branchement : boutons de l'en-tête, Assistant, voucher, paiement, ferrys, résumé, tâches", () => {
  const vue = source("views/whatsapp.mjs");
  assert.match(vue, /dossier \? tr\("Mettre à jour le dossier"\) : tr\("Créer le dossier"\)/);
  assert.match(vue, /sessionStorage\.setItem\(CLE_DEMANDE_AGENT, JSON\.stringify\(\{ id: c\.id, mode: modeDossier\(c\), entite: entiteId, pieces \}\)\)/);
  assert.match(vue, /const pieces = await choisirPieces\(c\);\n\s+if \(pieces === null\) return;/, "la feuille des pièces avant l'Assistant, fermer annule");
  assert.match(vue, /tr\("Résumé automatique, à vérifier"\)/);
  assert.match(vue, /resumeEnRetard\(c\) \? ` \$\{tr\("\(avant le dernier message\)"\)\}`/);
  assert.match(vue, /brouillonsFerry\.set\(f\.reservation\.id, zone\.value\)/, "relance modifiable, gardée par réservation");
  assert.match(vue, /tr\("D'après la règle des bateaux de l'Assistant \(Réglages\)\. Vérifiez avant d'envoyer\."\)/);
  assert.match(vue, /naviguer\("#\/agent\/nouvelle"\)/);
  assert.match(vue, /entreprise = await choisirEntreprise\(c, prop\);/, "à trier : l'entreprise d'abord");
  assert.match(vue, /envoyerVoucher\(x\)/, "écran d'envoi du voucher habituel");
  assert.match(vue, /naviguer\(`#\/dossier\/\$\{dossier\.id\}\?paiement=1`\)/);
  assert.match(vue, /peut\("paiements\.ecrire"\)/);
  assert.match(vue, /modifier\("whatsapp_conversations", c\.id, \{ paiement_signale: null \}\)/);
  assert.match(vue, /tr\("Ferrys à relancer"\)/);
  assert.match(vue, /tr\("mis à jour à \{heure\}"/);
  assert.match(vue, /tr\("Tâche créée : \{titre\}"/);
  const agent = source("views/agent.mjs");
  assert.match(agent, /whatsapp_conversation_id: whatsapp\.whatsapp_conversation_id, whatsapp_mode: whatsapp\.whatsapp_mode, whatsapp_pieces: whatsapp\.whatsapp_pieces \|\| \[\], texte: ""/);
  assert.match(agent, /if \(depuisWhatsApp\) return void envoyer\(\{ whatsapp: depuisWhatsApp \}\);/);
  assert.match(agent, /if \(dossier && c\.genre === "dossier"\) await relierWhatsApp\(dossier\);/);
  assert.match(agent, /await modifier\("whatsapp_conversations", waId, patch\);/);
  assert.match(agent, /const wc = etat\.store\.whatsappConversation \? await etat\.store\.whatsappConversation\(waId\) : null;/, "relue en base, pas dans etat.brut");
  assert.match(agent, /if \(action === "demander" && !\(await confirmer\(tr\("Remplacer le dossier relié \?/);
  assert.match(source("views/dossier.mjs"), /\[\?&\]paiement=1\(&\|\$\)/, "le dossier ouvre le formulaire de paiement");
  const sb = source("store-supabase.mjs");
  assert.match(sb, /resume, resume_le, paiement_signale, promesse_le/);
  assert.match(sb, /whatsapp_conversation_id"\);\n\s+if \(error && colonneAbsente\(error, "whatsapp_conversation_id"\)\)/, "relu sans la colonne avant la migration 61");
});
