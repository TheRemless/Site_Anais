// Étapes des conversations WhatsApp de clients (migration 105, 22.11.2026). Chaque cas reprend le modèle d'une des 48 conversations réelles
// lues le 22.11.2026 (C1 à C48 de docs/gestion/whatsapp-etapes.md). Ce dépôt est public : messages, noms et numéros sont inventés.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { faitsAvancee, entrepriseDesMots } from "../supabase/functions/whatsapp/etapes.js";
import { etatPret } from "../supabase/functions/whatsapp/pret.js";
import * as E from "../src/gestion/js/whatsapp-etapes-calc.mjs";
import { etapeManuelleLocale, faitsDemo } from "../src/gestion/js/demo-etapes.mjs";

const MAINTENANT = Date.parse("2026-11-22T03:00:00.000Z");
const AUJ = "2026-11-22";
let n = 0;
// Une conversation : [sens, texte, minutes avant MAINTENANT].
const conv = (lignes, extra = {}) => {
  const messages = lignes.map(([sens, texte, minutes, type = "text"]) => ({ id: `m${++n}`, sens, type, texte, medias: [], envoye_le: new Date(MAINTENANT - minutes * 60000).toISOString(), supprime_le: null }));
  const c = { id: `c${n}`, telephone: "+10 000 000 001", reponses: "auto", type_contact: null, partenaire_id: null, client_id: null, dossier_id: null, entite_id: null, tri: { motif: "demande_client", entreprise: "inconnu" }, created_at: messages[0] ? messages[0].envoye_le : null, ...extra };
  c.avancee = faitsAvancee(c, messages, new Date(MAINTENANT).toISOString());
  const p = etatPret(c, messages);
  if (p.pret) c.pret_reserver = p;
  return c;
};
const MARQUES = { es: "secret", et: "taxi", ez: null };
const ctx = (o = {}) => ({ dossiers: [], clients: [], reservations: [], marqueDe: (id) => MARQUES[id] || null, maintenant: MAINTENANT, aujourdhui: AUJ, ...o });
const etapes = (c, o) => E.etapesConversation(c, ctx(o)).map((e) => `${e.entreprise || "?"}:${e.etape}${e.manuel ? "*" : ""}`);
const H = 60;

// ---- Messages seuls ---------------------------------------------------------------------------------------------------------------
test("modèle C21 : une demande sans prix : Nouvelle demande (chez l'entreprise du tri si elle est connue)", () => {
  assert.deepEqual(etapes(conv([["entrant", "Hello, we plan our holiday in April, could you help us?", 5 * H]])), ["?:nouvelle"]);
  assert.deepEqual(etapes(conv([["entrant", "Hello, how much for a boat tour on Monday?", 5 * H]], { tri: { motif: "demande_client", entreprise: "secret" } })), ["secret:nouvelle"]);
});

test("modèle C4 : prix de transfert donné il y a 2 h : Taxi · Prix envoyé ; modèle C33 : prix d'excursion : Secret · Prix envoyé", () => {
  assert.deepEqual(etapes(conv([["entrant", "Transfer request: Hotel A to Airport B\nDate: Mon 7 Dec 2026", 4 * H], ["sortant", "The minivan is 1,900 THB, ferry included.", 2 * H]])), ["taxi:prix_envoye"]);
  assert.deepEqual(etapes(conv([["entrant", "Is the island tour available on Sunday?", 4 * H], ["sortant", "The speedboat tour is 1800 THB per person + park fee", 3 * H]])), ["secret:prix_envoye"]);
});

test("à relancer : prix envoyé, aucune réponse du client depuis 48 h, aucun dossier", () => {
  const c = conv([["entrant", "How much is a taxi to the airport?", 60 * H], ["sortant", "The minivan is 1,900 THB.", 50 * H]]);
  assert.deepEqual(etapes(c), ["taxi:a_relancer"]);
  const repondu = conv([["entrant", "How much is a taxi to the airport?", 60 * H], ["sortant", "The minivan is 1,900 THB.", 50 * H], ["entrant", "Thanks, let me check with my wife", 49 * H]]);
  assert.deepEqual(etapes(repondu), ["taxi:prix_envoye"], "le client a répondu après le prix");
  assert.deepEqual(etapes(conv([["entrant", "How much is a taxi to the airport?", 30 * H], ["sortant", "The minivan is 1,900 THB.", 20 * H]])), ["taxi:prix_envoye"], "moins de 48 h");
});

test("modèle C47 : « round trip » en songthaew est un transfert, pas une excursion", () => {
  assert.equal(entrepriseDesMots(["The round trip is 600 THB with a local songthaew."]), "taxi");
  assert.deepEqual(etapes(conv([["entrant", "Price for a trip from our hotel to the old town?", 3 * H], ["sortant", "The round trip is 600 THB with a local songthaew.", 2 * H]])), ["taxi:prix_envoye"]);
});

test("modèles C43, C41 : Prêt à réserver, avec l'entreprise du prix", () => {
  const c = conv([["entrant", "Taxi from the pier to our hotel?", 5 * H], ["sortant", "A songthaew from the pier costs 400 THB. Shall I book it?", 4 * H], ["entrant", "Great, we'll take it!", 3 * H]]);
  assert.deepEqual(etapes(c), ["taxi:pret"]);
  assert.deepEqual(etapes({ ...c, pret_retire_le: new Date(MAINTENANT).toISOString() }), ["taxi:prix_envoye"], "retirée de « Prêt à réserver » par Nani : retour au prix envoyé");
});

test("modèles C17, C46, C48, C45 : refus ou annulation après le prix : plus d'étape", () => {
  assert.deepEqual(etapes(conv([["sortant", "The minivan is 1,900 THB.", 5 * H], ["entrant", "No thanks, we found something else", 4 * H]])), []);
  assert.deepEqual(etapes(conv([["entrant", "How much from the pier?", 5 * H], ["sortant", "Do you still need it?", 4 * H], ["entrant", "We got a lift, no need anymore", 3 * H]])), []);
  assert.deepEqual(etapes(conv([["sortant", "The round trip is 600 THB.", 5 * H], ["entrant", "Please send the taxi", 4 * H], ["sortant", "OK, I'll send you the taxi now", 4 * H - 1], ["entrant", "Change of plan, please cancel it, sorry!", 3 * H]])), []);
  // Une nouvelle demande de prix après le refus repart.
  assert.deepEqual(etapes(conv([["sortant", "The minivan is 1,900 THB.", 50 * H], ["entrant", "No thanks", 49 * H], ["entrant", "Actually how much for Friday?", 3 * H], ["sortant", "The minivan on Friday is 1,900 THB too.", 2 * H]])), ["taxi:prix_envoye"]);
});

test("modèle C16 : un message privé qui dit « disponibles » n'est pas une demande", () => {
  assert.deepEqual(etapes(conv([["sortant", "Bonjour, un cours demain ?", 5 * H], ["entrant", "Nous ne sommes pas disponibles ce week-end, le suivant oui", 4 * H]], { tri: { motif: "remerciement", entreprise: "inconnu" } })), []);
});

// ---- Dossiers ---------------------------------------------------------------------------------------------------------------------
const client = { id: "k1", telephone: "+10000000001" };
const dossier = (o) => ({ id: "d1", entite_id: "et", client_id: "k1", created_at: "2026-11-21T02:00:00.000Z", annule: false, accepte_le: "2026-11-21", ...o });
const resa = (o) => ({ dossier_id: "d1", statut: "confirme", date_service: "2026-11-25", details: {}, ...o });

test("modèle C38 : dossier Taxi confirmé, voucher pas encore envoyé partout : Taxi · Réservé", () => {
  const c = conv([["entrant", "Thanks for the booking", 30 * H]]);
  assert.deepEqual(etapes(c, { clients: [client], dossiers: [dossier()], reservations: [resa(), resa({ details: { envois: { client: "2026-11-21" } } })] }), ["taxi:reserve"]);
});

test("modèles C7, C36 : voucher noté sur chaque réservation, ou confirmation envoyée depuis le téléphone après le dossier : Voucher envoyé", () => {
  const c = conv([["entrant", "Yes please book", 30 * H]]);
  assert.deepEqual(etapes(c, { clients: [client], dossiers: [dossier()], reservations: [resa({ details: { envois: { client: "2026-11-21" } } })] }), ["taxi:voucher_envoye"]);
  const tel = conv([["entrant", "Yes please book", 26 * H], ["sortant", "", 24 * H, "image"], ["sortant", "All set ✨ You can find the attached confirmation, keep it for the driver.", 24 * H - 1]]);
  assert.deepEqual(etapes(tel, { clients: [client], dossiers: [dossier({ created_at: new Date(MAINTENANT - 24 * 3600000 - 2 * 60000).toISOString() })], reservations: [resa()] }), ["taxi:voucher_envoye"]);
});

test("modèles C29, C30, C39 : tous les services passés : Terminé ; un nouveau prix après la fin repart des messages", () => {
  const ctxFin = { clients: [client], dossiers: [dossier()], reservations: [resa({ date_service: "2026-11-21" })] };
  assert.deepEqual(etapes(conv([["entrant", "Thank you for everything!", 20 * H]]), ctxFin), ["taxi:termine"]);
  assert.deepEqual(etapes(conv([["entrant", "We are back next month, price for the airport?", 3 * H], ["sortant", "The minivan is 1,900 THB.", 2 * H]]), ctxFin), ["taxi:prix_envoye"]);
});

test("dossier sans accord ni service confirmé : Prix envoyé (devis) ; dossier annulé : ignoré", () => {
  const c = conv([["entrant", "Quote please", 30 * H]]);
  assert.deepEqual(etapes(c, { clients: [client], dossiers: [dossier({ accepte_le: null })], reservations: [resa({ statut: "demande" })] }), ["taxi:prix_envoye"]);
  assert.deepEqual(etapes(c, { clients: [client], dossiers: [dossier({ annule: true })], reservations: [resa()] }), ["?:nouvelle"]);
});

test("Secret et Taxi partagent le numéro : Réservé chez Taxi et Prix envoyé chez Secret, les deux affichés", () => {
  const c = conv([["entrant", "Can we also do a boat tour on Sunday?", 3 * H], ["sortant", "The island tour is 1800 THB per person.", 2 * H]]);
  assert.deepEqual(etapes(c, { clients: [client], dossiers: [dossier()], reservations: [resa()] }), ["secret:prix_envoye", "taxi:reserve"]);
  const ets = E.etapesConversation(c, ctx({ clients: [client], dossiers: [dossier()], reservations: [resa()] }));
  assert.equal(E.aEtape(ets, "reserve"), true);
  assert.equal(E.aEtape(ets, "prix_envoye"), true);
});

test("modèle C5 : ZTP reste à part : un client qui n'a de dossier que chez ZTP n'a pas d'étape, et un dossier ZTP ne compte jamais", () => {
  const c = conv([["entrant", "Bonjour, combien pour l'hôtel que vous nous avez réservé ?", 3 * H]], { tri: { motif: "demande_client", entreprise: "secret" } });
  assert.deepEqual(etapes(c, { clients: [client], dossiers: [dossier({ entite_id: "ez" })] }), []);
  const prix = conv([["sortant", "The minivan is 1,900 THB.", 2 * H]]);
  assert.deepEqual(etapes(prix, { clients: [client], dossiers: [dossier({ entite_id: "ez" })], reservations: [resa()] }), ["taxi:prix_envoye"], "le dossier ZTP n'est pas pris pour un dossier Taxi");
});

test("le dossier relié compte même sans fiche ni numéro identiques ; un autre client, non", () => {
  const c = conv([["entrant", "Thanks", 30 * H]], { dossier_id: "d1" });
  assert.deepEqual(etapes(c, { dossiers: [dossier({ client_id: "k9" })], reservations: [resa()] }), ["taxi:reserve"]);
  assert.deepEqual(etapes(conv([["entrant", "Hello price?", 30 * H]]), { clients: [{ id: "k1", telephone: "+20 999 999 999" }], dossiers: [dossier()], reservations: [resa()] }), ["?:nouvelle"]);
});

// ---- Contacts exclus --------------------------------------------------------------------------------------------------------------
test("modèles C2, C11, C13, C31, C34 : Contact personnel, partenaire (posé ou déduit), apporteur, fiche partenaire, tri « personnel » : jamais d'étape", () => {
  const lignes = [["entrant", "Price for tomorrow?", 3 * H], ["sortant", "1,900 THB", 2 * H]];
  for (const extra of [{ reponses: "jamais" }, { type_contact: "partenaire" }, { type_contact: "partenaire", type_source: "deduit" }, { type_contact: "apporteur" }, { partenaire_id: "p" }, { tri: { motif: "personnel" } }]) {
    const c = conv(lignes, extra);
    assert.deepEqual(etapes(c), [], JSON.stringify(extra));
    assert.equal(E.conversationClient(c), false);
  }
  // Relecture finale (migration 110) : le motif « partenaire » d'un seul tri ne sort plus des étapes ; seul un type posé ou déduit le fait.
  const unTri = conv(lignes, { tri: { motif: "partenaire" } });
  assert.equal(E.conversationClient(unTri), true);
  assert.notDeepEqual(etapes(unTri), [], "un seul tri « partenaire » : l'étape reste");
  assert.ok(!E.MOTIFS_TRI_NON_CLIENT.includes("partenaire"));
});

test("modèle C1 (cas douteux) : un bateau non typé qui propose un prix ressemble à une demande : Nani le type en partenaire et il sort", () => {
  const lignes = [["sortant", "Is your boat free on Tuesday?", 5 * H], ["entrant", "Yes, I can propose a price of 9000 for the day, ok for you?", 4 * H]];
  assert.deepEqual(etapes(conv(lignes, { tri: { motif: "remerciement", entreprise: "inconnu" } })), ["?:nouvelle"]);
  assert.deepEqual(etapes(conv(lignes, { type_contact: "partenaire" })), []);
});

// ---- Choix manuel -----------------------------------------------------------------------------------------------------------------
test("choix manuel : l'emporte jusqu'au prochain événement qui fait avancer, par entreprise", () => {
  const c = conv([["entrant", "How much is a taxi to the airport?", 60 * H], ["sortant", "The minivan is 1,900 THB.", 50 * H]]);
  const apres = new Date(MAINTENANT - H * 60000).toISOString();
  assert.deepEqual(etapes({ ...c, etape_manuelle: { taxi: { etape: "pret", le: apres } } }), ["taxi:pret*"], "Nani a eu le client au téléphone");
  const avant = new Date(MAINTENANT - 55 * H * 60000).toISOString();
  assert.deepEqual(etapes({ ...c, etape_manuelle: { taxi: { etape: "nouvelle", le: avant } } }), ["taxi:a_relancer"], "le prix envoyé après le choix l'emporte");
  assert.deepEqual(etapes({ ...c, etape_manuelle: { secret: { etape: "prix_envoye", le: apres } } }), ["secret:prix_envoye*", "taxi:a_relancer"], "une entreprise sans étape calculée");
  assert.deepEqual(etapes({ ...c, etape_manuelle: { taxi: { etape: "paye", le: apres } } }), ["taxi:a_relancer"], "une étape inconnue est ignorée");
  assert.deepEqual(E.patchEtapeManuelle({ etape_manuelle: { secret: { etape: "pret", le: "x" } } }, "secret", null), { etape_manuelle: null });
  assert.equal(E.patchEtapeManuelle({}, "ztp", "pret"), null, "ZTP n'est jamais une clé");
  assert.equal(E.patchEtapeManuelle({}, "taxi", "paye"), null);
  assert.deepEqual(Object.keys(E.patchEtapeManuelle({}, "taxi", "reserve").etape_manuelle), ["taxi"]);
});

test("démonstration : même contrôle que la base pour le choix manuel", () => {
  const a = etapeManuelleLocale(null, { taxi: { etape: "reserve", le: "2001-01-01T00:00:00Z" } });
  assert.ok(Date.parse(a.taxi.le) > Date.now() - 60000, "heure du moment");
  const b = etapeManuelleLocale(a, { taxi: { etape: "reserve", le: a.taxi.le } });
  assert.equal(b.taxi.le, a.taxi.le, "renvoyé tel quel : garde son heure");
  assert.notEqual(etapeManuelleLocale(a, { taxi: { etape: "reserve", le: "2030-01-01T00:00:00Z" } }).taxi.le, "2030-01-01T00:00:00Z", "jamais une heure choisie par l'écran");
  assert.equal(etapeManuelleLocale(a, {}), null);
  assert.throws(() => etapeManuelleLocale(null, { ztp: { etape: "reserve" } }));
  assert.throws(() => etapeManuelleLocale(null, { taxi: { etape: "paye" } }));
  const f = faitsDemo({ id: "c", tri: null }, [{ conversation_id: "c", sens: "entrant", texte: "Price?", envoye_le: "2026-11-21T01:00:00Z" }, { conversation_id: "c", sens: "sortant", texte: "It is 400 THB", envoye_le: "2026-11-21T02:00:00Z" }], "taxi");
  assert.equal(f.par.taxi.prix_le, "2026-11-21T02:00:00Z");
});

// ---- Faits ------------------------------------------------------------------------------------------------------------------------
test("faits : des dates et des entreprises seulement, jamais un texte ; dans la contrainte de la migration 105", () => {
  const c = conv([["entrant", "Transfer request: Hotel A to Airport B\nName: Paul Example\nWhatsApp: +10000000000", 4 * H], ["sortant", "The minivan is 1,900 THB.", 3 * H], ["entrant", "Yes please book it", 2 * H], ["sortant", "Here is your confirmation:\nName: Paul Example\nDate: Monday\nPick-up time: 9am\nPrice: 1,900 THB", H]]);
  const s = JSON.stringify(c.avancee);
  assert.ok(!/Paul|Hotel|1,900|0000000/.test(s), s);
  assert.ok(s.length <= 2000);
  assert.equal(c.avancee.par.taxi.prix_le, new Date(MAINTENANT - H * 60000).toISOString(), "le récapitulatif porte aussi le prix : le dernier compte");
  assert.deepEqual(c.avancee.vouchers, [], "un récapitulatif écrit n'est pas un voucher (relecture n° 4)");
  assert.deepEqual(Object.keys(faitsAvancee({ reponses: "jamais" }, [{ sens: "entrant", texte: "Price?", envoye_le: "2026-11-21T01:00:00Z" }])).sort(), ["calcule_le", "jamais", "v"], "Contact personnel : aucun fait lu");
});

// ---- Branchements -----------------------------------------------------------------------------------------------------------------
const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
test("branchements : fonction, écran, stores, CI ; aucun appel à l'IA ; index.ts et calc.js inchangés", () => {
  const ts = lire("supabase/functions/whatsapp/pret.ts");
  assert.match(ts, /faitsAvancee\(conv, messages\)/);
  assert.match(ts, /pretChange\(conv\.avancee, faits\)/);
  assert.doesNotMatch(lire("supabase/functions/whatsapp/etapes.js"), /anthropic|messages\.create|fetch\(/i);
  const vue = lire("src/gestion/js/views/whatsapp.mjs");
  assert.match(vue, /etapesDisponibles\(\) && conversationClient\(c\) \? pastillesEtapes\(c\)/);
  assert.match(vue, /blocEtapes\(c, \{ lectureSeule, rafraichir \}\)/);
  assert.match(lire("src/gestion/js/store-supabase.mjs"), /whatsapp_etapes_disponible: conversations !== null && pretDisponible && etapesDisponible/);
  assert.match(lire("src/gestion/js/store-local.mjs"), /"pret_retire_le", "etape_manuelle", "ia_coupee"(?:, "type_source")?\]\.includes\(k\)/);
  assert.match(lire(".github/workflows/ci.yml"), /verif-whatsapp-etapes/);
  const fichiers = fs.readdirSync(new URL("../supabase/functions/agent/", import.meta.url));
  const agent = fichiers.map((f) => lire(`supabase/functions/agent/${f}`)).join("\n");
  assert.doesNotMatch(agent, /etape_manuelle/, "l'Assistant ne lit pas le choix manuel");
  // 22.11.2026 (PR 318) : l'Assistant lit les faits des étapes seulement pour dire si un contact sans fiche est un client probable
  // (outils.js, etapeClient) ; ils ne vont jamais chez Claude.
  for (const f of fichiers.filter((f) => !["outils.js", "index.ts"].includes(f))) assert.doesNotMatch(lire(`supabase/functions/agent/${f}`), /avancee/, f);
  assert.deepEqual(lire("supabase/functions/agent/index.ts").match(/avancee/g), ["avancee", "avancee"], "seulement dans les deux lectures de la conversation");
  const outils = lire("supabase/functions/agent/outils.js");
  assert.deepEqual(outils.split("\n").filter((l) => /avancee/.test(l) && !/^\s*\/\//.test(l)), ["  const f = c && c.avancee;"], "seulement dans etapeClient");
});
