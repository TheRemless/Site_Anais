// Relecture indépendante du 22.11.2026 des PR 313 et 316 : un test par point. Messages, noms et numéros inventés (dépôt public).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { faitsAvancee } from "../supabase/functions/whatsapp/etapes.js";
import { etatPret } from "../supabase/functions/whatsapp/pret.js";
import { iaPermise, triSansAppel, entrepriseReponse, clientCommun } from "../supabase/functions/whatsapp/proposer.js";
import * as E from "../src/gestion/js/whatsapp-etapes-calc.mjs";

const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const MAINTENANT = Date.parse("2026-11-22T03:00:00.000Z");
const AUJ = "2026-11-22";
const H = 60;
let n = 0;
const conv = (lignes, extra = {}) => {
  const messages = lignes.map(([sens, texte, minutes, type = "text", o = {}]) => ({ id: `m${++n}`, sens, type, texte, medias: [], envoye_le: new Date(MAINTENANT - minutes * 60000).toISOString(), supprime_le: null, ...o }));
  const c = { id: `c${n}`, telephone: "+10 000 000 001", reponses: "auto", type_contact: null, partenaire_id: null, client_id: null, dossier_id: null, entite_id: null, tri: { motif: "demande_client", entreprise: "inconnu" }, ...extra };
  c.avancee = faitsAvancee(c, messages, new Date(MAINTENANT).toISOString());
  const p = etatPret(c, messages);
  if (p.pret) c.pret_reserver = p;
  return c;
};
const MARQUES = { es: "secret", et: "taxi", ez: null };
const ctx = (o = {}) => ({ dossiers: [], clients: [], reservations: [], marqueDe: (id) => MARQUES[id] || null, maintenant: MAINTENANT, aujourdhui: AUJ, ...o });
const etapes = (c, o) => E.etapesConversation(c, ctx(o)).map((e) => `${e.entreprise || "?"}:${e.etape}${e.manuel ? "*" : ""}`);
const iso = (minutes) => new Date(MAINTENANT - minutes * 60000).toISOString();
const client = { id: "k1", telephone: "+10000000001" };

test("n° 1 : la réponse préparée prend le catalogue de l'entreprise de la demande, pas celui de la conversation", () => {
  const ents = [{ id: "S", slug: "secret" }, { id: "T", slug: "taxi" }];
  assert.equal(entrepriseReponse({ conv: { entite_id: "T", reponses: "auto" }, ents, suggestion: "secret" }).id, "S", "client rangé chez Taxi, demande d'excursion : Secret");
  assert.equal(entrepriseReponse({ conv: { entite_id: "T", reponses: "auto" }, ents, suggestion: null }).id, "T", "sans demande reconnue : l'entreprise de la conversation");
  assert.equal(entrepriseReponse({ conv: { entite_id: null, reponses: "auto" }, ents, suggestion: null, defaut: "secret" }).id, "S");
  assert.equal(entrepriseReponse({ conv: { entite_id: "T", type_contact: "partenaire" }, ents, suggestion: "secret" }).id, "T", "un partenaire rangé : son entreprise");
  const ts = lire("supabase/functions/whatsapp/reponse.ts");
  assert.equal((ts.match(/entrepriseReponse\(\{/g) || []).length, 3, "préparation automatique, à la demande, et réglage de la préparation automatique");
  assert.match(ts, /parametresTri\(messages, \{ aTrier: !conv\.entite_id \|\| clientCommun\(conv\) \}\)/, "le tri donne toujours l'entreprise de la demande d'un client");
});

test("n° 2 : ZTP ne se mélange jamais : un prix en CHF n'est pas un prix de Secret ou de Taxi", () => {
  const c = conv([["entrant", "Bonjour, combien pour l'hôtel du séjour ?", 3 * H], ["sortant", "Le séjour complet est à 2'400 CHF par personne.", 2 * H]], { tri: { motif: "demande_client", entreprise: "secret" } });
  assert.equal(c.avancee.par.secret.prix_le, undefined, "aucun prix de Secret");
  assert.deepEqual(etapes(c, { clients: [client], dossiers: [{ id: "dz", entite_id: "ez", client_id: "k1", created_at: iso(30 * 24 * H) }] }), [], "client ZTP : aucune étape ici");
  // Un « prêt » sur un prix en CHF n'a pas d'entreprise ici.
  const p = conv([["sortant", "The full trip is 2'400 CHF. Shall I book it?", 3 * H], ["entrant", "Yes please book it", 2 * H]]);
  assert.equal(p.avancee.pret && p.avancee.pret.entreprise, "ztp");
  assert.deepEqual(etapes(p), []);
});

test("n° 3 : iaPermise : tri si l'un des deux assistants est allumé ; IA coupée par conversation sans Contact personnel", () => {
  const agents = { S: false, T: true };
  assert.equal(iaPermise({ receptionActive: true, conv: { entite_id: "S", reponses: "auto" }, agents }), true, "client rangé chez Secret, assistant de Taxi allumé");
  assert.equal(iaPermise({ receptionActive: true, conv: { entite_id: "S", reponses: "auto", type_contact: "partenaire" }, agents }), false);
  assert.equal(iaPermise({ receptionActive: true, conv: { entite_id: null, reponses: "auto", ia_coupee: true }, agents: { S: true, T: true } }), false);
  assert.equal(triSansAppel({ conv: { reponses: "auto", ia_coupee: true }, messages: [] }).motif, "ia_coupee");
  assert.equal(clientCommun({ reponses: "auto", ia_coupee: true }), true, "l'IA coupée ne fait pas un Contact personnel");
  // Décision du 22.11.2026 : l'IA coupée ne coupe que l'automatique. Les gestes demandés par Nani restent permis (seul le Contact personnel
  // coupe tout) : « Préparer une réponse » n'est plus refusé, les boutons restent affichés, l'aide le dit.
  const rep = lire("supabase/functions/whatsapp/reponse.ts");
  const demande = rep.slice(rep.indexOf("export async function preparerALaDemande"), rep.indexOf("const t0 = Date.now() + ATTENTE_MS"));
  assert.ok(demande.includes("const refus = refusDemande(lu.conv);"), "Contact personnel refusé par refusDemande (gestion-ia-coupee.test.js)");
  assert.ok(!/ia_coupee === true\) return \{ erreur: "ia_coupee" \}/.test(demande), "« Préparer une réponse » permis à la demande");
  assert.match(rep, /if \(!decision && !\(await iaOuverte\(db, conv\)\)\) decision = \{ preparer: false, motif: "ia_coupee" \};/, "le tri automatique reste coupé");
  const vue = lire("src/gestion/js/views/whatsapp.mjs");
  assert.match(vue, /dernier\.sens === "entrant" && etat\.store\.whatsappPreparer/, "bouton Préparer affiché");
  assert.match(vue, /if \(!demandePermise\(c\)\) return null;/, "« Demander à l'assistant » affiché");
  assert.match(vue, /!lectureSeule && reponsesDe\(c\) !== "jamais" && \(clientCommun\(c\)/, "« Créer le dossier » de la carte affiché (sauf Contact personnel)");
  assert.ok(!/c\.ia_coupee\)? &&|!c\.ia_coupee/.test(vue), "aucun geste à la demande caché par l'IA coupée");
  const etapes = lire("src/gestion/js/views/whatsapp-etapes.mjs");
  assert.match(etapes, /c\.ia_coupee \? h\("p", \{ class: "aide wa-ia-coupee-aide" \}, tr\(AIDE_IA_COUPEE\)\)/);
  assert.match(etapes, /toast\(c\.ia_coupee \? tr\("IA rallumée pour cette conversation\."\) : tr\(AIDE_IA_COUPEE\)\)/);
  assert.match(etapes, /plus de tri, de résumé ni de réponse préparée d'office\. « Préparer une réponse » et l'Assistant restent possibles à votre demande\./);
  assert.match(lire("docs/gestion/migration-105-whatsapp-etapes.sql"), /add column if not exists ia_coupee boolean not null default false/);
});

test("n° 4 : un récapitulatif n'est pas un voucher ; un voucher de Gestion vaut pour son service, à l'heure exacte", () => {
  const recap = conv([["sortant", "Here is your confirmation:\nName: Lena\nDate: Friday\nPick-up time: 9am\nPrice: 400 THB", H]]);
  assert.deepEqual(recap.avancee.vouchers, []);
  const d = { id: "d1", entite_id: "et", client_id: "k1", created_at: iso(30 * H), accepte_le: "2026-11-21", annule: false };
  const r1 = { id: "r1", dossier_id: "d1", statut: "confirme", date_service: "2026-11-25", details: {} };
  const r2 = { ...r1, id: "r2" };
  const gestion = conv([["sortant", "Your voucher", 2 * H, "image", { origine: "gestion", statut_envoi: "envoye", medias: [{ type: "image", statut: "voucher", reservation_id: "r1" }] }]]);
  assert.deepEqual(gestion.avancee.vouchers, [{ le: iso(2 * H), reservation_id: "r1" }], "heure exacte, service connu");
  assert.deepEqual(etapes(gestion, { clients: [client], dossiers: [d], reservations: [r1, r2] }), ["taxi:reserve"], "un service sur deux : pas encore « Voucher envoyé »");
  assert.deepEqual(etapes(gestion, { clients: [client], dossiers: [d], reservations: [r1] }), ["taxi:voucher_envoye"]);
  const echec = conv([["sortant", "Your voucher", 2 * H, "image", { statut_envoi: "echec", medias: [{ type: "image", statut: "voucher", reservation_id: "r1" }] }]]);
  assert.deepEqual(echec.avancee.vouchers, [], "un envoi en échec ne compte pas");
  // Depuis le téléphone : il faut une image ou un PDF avec les mots d'un voucher.
  const tel = conv([["sortant", "", 2 * H, "image"], ["sortant", "Here is your booking confirmation, show it to the driver", 2 * H - 1]]);
  assert.equal(tel.avancee.vouchers.length, 1);
  assert.equal(conv([["sortant", "", 2 * H, "image"], ["sortant", "A photo of the beach for you", 2 * H - 1]]).avancee.vouchers.length, 0, "une photo sans les mots d'un voucher");
  // Rattaché au dossier de son entreprise : le dossier du client créé juste avant.
  const dS = { id: "dS", entite_id: "es", client_id: "k1", created_at: iso(3 * H), accepte_le: "2026-11-22", annule: false };
  const rS = { id: "rS", dossier_id: "dS", statut: "confirme", date_service: "2026-11-26", details: {} };
  assert.deepEqual(etapes(tel, { clients: [client], dossiers: [d, dS], reservations: [r1, rS] }), ["secret:voucher_envoye", "taxi:reserve"]);
});

test("n° 5 : refus et annulation : seulement l'entreprise concernée ; « no need for a child seat » n'est pas un refus ; une demande après un refus repart", () => {
  assert.deepEqual(etapes(conv([["entrant", "How much is a taxi to the airport?", 5 * H], ["sortant", "The minivan is 1,900 THB.", 4 * H], ["entrant", "Perfect, no need for a child seat", 3 * H]])), ["taxi:prix_envoye"]);
  assert.deepEqual(etapes(conv([["sortant", "The minivan is 1,900 THB.", 4 * H], ["entrant", "We don't need a car seat, thanks", 3 * H]])), ["taxi:prix_envoye"]);
  // Refus de l'excursion, le transfert reste.
  const deux = conv([["entrant", "Price for a taxi to the airport and for a boat tour?", 6 * H], ["sortant", "The minivan is 1,900 THB.", 5 * H], ["sortant", "The island tour is 1800 THB per person.", 4 * H], ["entrant", "No thanks for the tour", 3 * H]]);
  assert.deepEqual(etapes(deux), ["taxi:prix_envoye"]);
  // Nouvelle demande après un refus : Nouvelle demande (la DERNIÈRE demande compte).
  const retour = conv([["sortant", "The minivan is 1,900 THB.", 50 * H], ["entrant", "No thanks", 49 * H], ["entrant", "Hello again, could you also do a transfer next month?", 2 * H]]);
  assert.deepEqual(etapes(retour), ["taxi:nouvelle"]);
  // Une conversation sans étape reste visible ailleurs que dans « Toutes » : filtre « Sans étape ».
  assert.equal(E.aEtape([], "aucune"), true);
  assert.equal(E.aEtape([{ etape: "reserve" }], "aucune"), false);
  assert.match(lire("src/gestion/js/views/whatsapp-etapes.mjs"), /const SANS_ETAPE = \{ valeur: "aucune", libelle: N_\("Sans étape"\) \}/);
});

test("n° 6 : un client qui revient (arrivée puis transfert retour) repasse en « Prêt à réserver » malgré le voucher envoyé", () => {
  const d = { id: "d1", entite_id: "et", client_id: "k1", created_at: iso(5 * 24 * H), accepte_le: "2026-11-17", annule: false };
  const r = { id: "r1", dossier_id: "d1", statut: "confirme", date_service: "2026-11-18", details: { envois: { client: "2026-11-17" } } };
  const c = conv([["entrant", "Thanks for the arrival! Now we need the transfer back to the airport on Friday?", 4 * H], ["sortant", "The minivan back is 1,900 THB. Shall I book it?", 3 * H], ["entrant", "Great, we'll take it!", 2 * H]], { dossier_id: "d1", client_id: "k1" });
  assert.deepEqual(etapes(c, { clients: [client], dossiers: [d], reservations: [r] }), ["taxi:pret"]);
  // Sans nouveau prix, le dossier garde la main.
  assert.deepEqual(etapes(conv([["entrant", "Is the driver on time?", 3 * H]], { dossier_id: "d1", client_id: "k1" }), { clients: [client], dossiers: [d], reservations: [r] }), ["taxi:termine"]);
});

test("n° 7 : le choix manuel cède à la réponse du client, à l'acceptation, au voucher ; rechoisir repart de maintenant ; « Sans entreprise » ne reste pas", () => {
  const c = conv([["entrant", "How much is a taxi to the airport?", 10 * H], ["sortant", "The minivan is 1,900 THB.", 9 * H]]);
  const choix = (cle, etape, minutes) => ({ ...c, etape_manuelle: { [cle]: { etape, le: iso(minutes) } } });
  assert.deepEqual(etapes(choix("taxi", "pret", 8 * H)), ["taxi:pret*"]);
  // Réponse du client après le choix : le choix cède.
  const repondu = conv([["entrant", "How much is a taxi to the airport?", 10 * H], ["sortant", "The minivan is 1,900 THB.", 9 * H], ["entrant", "Thanks, we will see", 7 * H]]);
  assert.deepEqual(etapes({ ...repondu, etape_manuelle: { taxi: { etape: "pret", le: iso(8 * H) } } }), ["taxi:prix_envoye"]);
  // Service confirmé (heure de la réservation) après le choix : le choix cède.
  const d = { id: "d1", entite_id: "et", client_id: "k1", created_at: iso(8 * H), annule: false };
  const r = { id: "r1", dossier_id: "d1", statut: "confirme", date_service: "2026-11-25", details: {}, updated_at: iso(H) };
  assert.deepEqual(etapes(choix("taxi", "a_relancer", 5 * H), { clients: [client], dossiers: [d], reservations: [r] }), ["taxi:reserve"]);
  // Voucher à l'heure exacte après le choix : le choix cède.
  const v = conv([["entrant", "Price?", 20 * H], ["sortant", "Your voucher", H, "image", { statut_envoi: "envoye", medias: [{ type: "image", statut: "voucher", reservation_id: "r1" }] }]]);
  assert.deepEqual(etapes({ ...v, etape_manuelle: { taxi: { etape: "reserve", le: iso(2 * H) } } }, { clients: [client], dossiers: [{ ...d, accepte_le: "2026-11-21" }], reservations: [{ ...r, updated_at: iso(12 * H) }] }), ["taxi:voucher_envoye"]);
  // « Sans entreprise » tombe dès qu'une entreprise a une étape.
  assert.deepEqual(etapes({ ...c, etape_manuelle: { aucune: { etape: "pret", le: iso(H) } } }), ["taxi:prix_envoye"]);
  // Rechoisir : l'écran envoie l'heure vide, la base pose l'heure du moment.
  assert.deepEqual(E.patchEtapeManuelle({ etape_manuelle: { taxi: { etape: "pret", le: "x" }, secret: { etape: "reserve", le: "y" } } }, "taxi", "pret"), { etape_manuelle: { taxi: { etape: "pret", le: null }, secret: { etape: "reserve", le: "y" } } });
  assert.match(lire("docs/gestion/migration-105-whatsapp-etapes.sql"), /and valeur->>'le' is not null and old\.etape_manuelle->cle->>'le' = valeur->>'le'/);
});

test("n° 8 : performance : 500 conversations et 2 000 clients, cinq appels par conversation (perf.mjs de la relecture)", () => {
  const tel = (i) => "+4477009" + String(i).padStart(5, "0");
  const C = 2000;
  const N = 500;
  const clients = Array.from({ length: C }, (_, i) => ({ id: "c" + i, telephone: tel(i) }));
  const dossiers = Array.from({ length: C }, (_, i) => ({ id: "d" + i, client_id: "c" + i, entite_id: i % 2 ? "t" : "s", created_at: "2026-11-01T00:00:00Z" }));
  const reservations = dossiers.map((d, i) => ({ id: "r" + i, dossier_id: d.id, statut: "confirme", date_service: "2026-12-01", details: {} }));
  const convs = Array.from({ length: N }, (_, i) => ({ id: "w" + i, telephone: tel(i * 3), reponses: "auto", tri: { motif: "demande_client" }, avancee: { v: 2, par: {} } }));
  const marqueDe = (id) => (id === "s" ? "secret" : id === "t" ? "taxi" : null);
  E.etapesConversation(convs[0], { dossiers, clients, reservations, marqueDe, aujourdhui: AUJ });
  const t0 = performance.now();
  for (let k = 0; k < 5; k++) for (const c of convs) E.etapesConversation(c, { dossiers, clients, reservations, marqueDe, aujourdhui: AUJ });
  const ms = performance.now() - t0;
  console.log(`étapes : ${ms.toFixed(1)} ms pour 500 conversations × 5 appels, 2 000 clients`);
  // Marge pour une machine de CI plus lente ; mesuré en local sous 30 ms.
  assert.ok(ms < 150, `${ms.toFixed(0)} ms`);
  assert.match(lire("src/gestion/js/views/whatsapp-etapes.mjs"), /if \(cache\.brut !== etat\.brut \|\| cache\.jour !== jour\)/, "une fois par rendu");
});

test("n° 9 : contact remis en Client repris tout de suite ; ligne résumé dans le filtre d'étape ; messages « non transmis » ignorés", () => {
  const lignes = [["entrant", "How much is a taxi to the airport?", 5 * H], ["sortant", "The minivan is 1,900 THB.", 4 * H]];
  const chauffeur = conv(lignes, { type_contact: "partenaire", tri: { motif: "non_client" } });
  assert.deepEqual(etapes(chauffeur), []);
  assert.deepEqual(etapes({ ...chauffeur, type_contact: "client" }), ["taxi:prix_envoye"], "remis en Client : le motif « non_client » laissé par le tri n'écarte pas");
  assert.equal(faitsAvancee({ reponses: "auto", type_contact: "partenaire" }, []).jamais, undefined, "les faits sont calculés aussi pour un contact typé");
  assert.match(lire("src/gestion/js/views/whatsapp.mjs"), /filtre === FILTRE_PRET\.valeur \|\| filtre === "etape:pret" \? resumeLignePret\(c\)/);
  const ts = lire("supabase/functions/whatsapp/pret.ts");
  assert.match(ts, /\.neq\("type", "non_transmis"\)/);
  assert.match(ts, /and\(avancee->>jamais\.eq\.true,reponses\.neq\.jamais\)/, "un Contact personnel remis en « auto » est recalculé à la reprise");
  assert.deepEqual(conv([["entrant", "", 3 * H, "non_transmis"], ["sortant", "The minivan is 1,900 THB.", 2 * H]]).avancee.premier_client_le, null);
});
