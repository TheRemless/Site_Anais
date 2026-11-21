// Faux blocage du 21.11.2026 (transfert de Stefan) : « 2 private minivans … 10,000 THB in total (ferry included) » était bloqué
// (« À retirer avant de copier : 10000 ») parce qu'une prestation de Secret sans rapport a un net de 10 000. Le total client (2 × 5 000)
// n'était pas dans les prix de vente. Règle tenue : jamais un net vers le client, mais seuls les nets des services de la demande en cours
// bloquent ; le net d'un autre service avertit (montant_egal_net) ; un total de vente passe. Données fictives, aucun appel réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { executer, memoDepuis, netsPourControle, netsDuControle, dossierPourControle, totauxDeVente, controlerReponse, refDe, retenirLecture, TOUS_LES_SERVICES } from "../supabase/functions/agent/outils.js";
import { lireConversation } from "../supabase/functions/agent/whatsapp-lecture.js";
import { texteDepuisWhatsApp } from "../supabase/functions/agent/whatsapp.js";
import { controleEnvoi, refusEnvoi, memesMontants, lireEnvoi, lireEnvoiVoucher, lireMontantsConfirmes } from "../supabase/functions/whatsapp-envoi/calc.js";
import { bloquantsReponse, resteBloque } from "../src/gestion/js/agent-calc.mjs";
import { libelleAvertissement, envoiIncertain, erreurEnvoi, montantsAConfirmer } from "../src/gestion/js/whatsapp-calc.mjs";
import { avertissementsVisibles } from "../src/gestion/js/espace-unifie-calc.mjs";

const lire = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ENT = "11111111-1111-4111-8111-111111111111";
const P_TRANSFERT = "a1000000-0000-4000-8000-000000000001"; // minivan privé Donsak → Pimalai, 5 000 par minivan
const P_FERRY = "a2000000-0000-4000-8000-000000000002"; // billet de ferry, 400 par personne
const P_YACHT = "a9000000-0000-4000-8000-000000000009"; // yacht privé, sans rapport, net 10 000
const donnees = {
  partenaires: [],
  prestations: [
    { id: P_TRANSFERT, famille: "transfert", groupe: "Donsak Pimalai", libelle: "Minivan privé Donsak Lomprayah Pier → Pimalai Resort (ferry inclus)", libelle_en: "Private minivan Donsak Lomprayah Pier to Pimalai Resort (ferry included)", prix_vente: 5000, unite: "vehicule", actif: true, entite_id: ENT },
    { id: P_FERRY, famille: "transfert", groupe: "Ferry Donsak", libelle: "Ferry Donsak Lipa Noi", libelle_en: "Ferry Donsak Lipa Noi", prix_vente: 400, unite: "pp", actif: true, entite_id: ENT },
    { id: P_YACHT, famille: "excursion", groupe: "Yacht", libelle: "Yacht privé", libelle_en: "Private yacht", prix_vente: 14000, unite: "groupe", actif: true, entite_id: ENT },
  ],
};
// Les nets tels que netsPourControle les lit (clé de service) : le transfert a un net de 4 200, le yacht de 10 000.
const tablesNets = { prestations_nets: [{ prestation_id: P_TRANSFERT, net: 4200 }, { prestation_id: P_YACHT, net: 10000 }], trajets_nets: [] };
const db = { from: (t) => ({ select: () => ({ in: () => ({ range: async () => ({ data: tablesNets[t] || [], error: null }) }) }) }) };
const ctx = { permissions: [], charger: async (n) => donnees[n] || [], reglages: {} };
const ctxSans = ctx;
// La vraie réponse à Stefan (21.11.2026), telle quelle : elle ne cite pas le prix d'un minivan.
const STEFAN = "2 private minivans from Donsak Lomprayah Pier to Pimalai Resort, Koh Lanta, pickup 9:30 am, 10,000 THB in total (ferry included), paid in cash to the driver";
// L'échange WhatsApp joint à l'Assistant (agent/whatsapp.js, texteDepuisWhatsApp) : Nani a donné le prix.
const ECHANGE = [
  { id: "e1", sens: "entrant", texte: "Hello, we need a minivan transfer from Donsak Lomprayah to Koh Lanta on January 2, pickup 9:30, 5 adults and 6 kids", envoye_le: "2026-11-20T03:00:00Z" },
  { id: "e2", sens: "sortant", origine: "app", texte: "2 minivans, 5'000 THB par minivan, ferry compris, 5000x2 = 10'000 THB, cash au chauffeur", envoye_le: "2026-11-20T03:10:00Z" },
  { id: "e3", sens: "entrant", texte: "Perfect, ok for us", envoye_le: "2026-11-20T03:20:00Z" },
  { id: "e4", sens: "sortant", origine: "app", texte: "Which hotel?", envoye_le: "2026-11-20T03:21:00Z" },
  { id: "e5", sens: "entrant", texte: "Pimalai Resort", envoye_le: "2026-11-20T03:30:00Z" },
];
const joint = (messages = ECHANGE) => texteDepuisWhatsApp({ mode: "question", conv: { id: "c1", telephone: "+41790000000" }, messages, question: "Prépare la réponse à Stefan" });

// Comme la boîte WhatsApp et l'Assistant : memoDepuis, puis les nets lus à part, puis le catalogue cherché, puis la réponse.
// `voit` : la personne a le droit de voir les nets (sinon montant_egal_net sort sans sa valeur, revue de la PR 306).
const ctxNets = { ...ctx, permissions: ["partenaires.lire", "partenaires.nets"] };
async function conversation(message, { dossier = new Set(), avant = () => {}, recherche = "donsak pimalai", historique = [], client = false, carte = null, voit = true } = {}) {
  const ctx = voit ? ctxNets : ctxSans;
  const memo = memoDepuis(historique, { entreprise: "Secret Travel & Tour", conversationClient: client });
  memo.nets = (await netsPourControle(db, [ENT])).nets;
  memo.servicesEnCours = dossier;
  avant(memo);
  if (recherche) await executer("chercher_catalogue", { recherche, famille: "tout" }, ctx, memo);
  if (carte) await executer("proposer_dossier", carte, ctx, memo);
  const r = await executer("proposer_reponse", { titre: "Stefan", langue: "en", message, destinataire: "client" }, ctx, memo);
  return { memo, avertissements: r.carte.avertissements };
}
const montantsAv = (a) => a.filter((x) => /^montant_/.test(x));
const CARTE = { titre: "Stefan", client_nom: "Stefan", client_telephone: "", hotel: "Pimalai Resort", langue: "en", adultes: 5, enfants: 6, bebes: 0, services: [{ ref: refDe("P", P_TRANSFERT), texte: "Minivan Donsak → Pimalai", date: "2027-01-02", heure_pickup: "09:30", lieu_pickup: "Donsak Lomprayah Pier", de: "", vers: "", adultes: 5, enfants: 6, prix_saisi: "", vol: "", remarque: "" }] };

test("reproduction exacte : texte de la réponse à Stefan, net de 10 000 sur une autre prestation, échange où Nani écrit « 5000x2 = 10'000 THB »", async () => {
  const { memo, avertissements } = await conversation(STEFAN, { historique: [{ role: "user", content: joint() }], client: true, recherche: "" });
  assert.ok(memo.nani.has(10000) && memo.nani.has(5000), [...memo.nani].join(","));
  // Sourcé par Nani : ni montant_non_source ni blocage. Il reste égal au net d'un autre service : l'avertissement « info » le dit
  // (revue de la PR 306 : tout montant qui n'est pas un prix rendu par un outil).
  assert.deepEqual(montantsAv(avertissements), ["montant_egal_net:10000"], avertissements.join(" | "));
  assert.deepEqual(resteBloque(STEFAN, bloquantsReponse(avertissements)), [], "l'écran ne bloque pas");
});

test("reproduction exacte sans échange joint : la carte de dossier du même échange (5 000 × 2 véhicules) fait du 10 000 un total", async () => {
  const { avertissements } = await conversation(STEFAN, { recherche: "", carte: CARTE });
  assert.deepEqual(montantsAv(avertissements), ["montant_egal_net:10000"], avertissements.join(" | "));
  assert.deepEqual(resteBloque(STEFAN, bloquantsReponse(avertissements)), []);
  // La carte d'un échange précédent ne compte pas : memo.prixCarte n'est jamais relu de l'historique.
  assert.deepEqual(memoDepuis([{ role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: JSON.stringify({ prix: [{ prix: 5000, origine: "catalogue" }] }) }] }]).prixCarte, []);
});

test("reproduction exacte sans échange ni carte : 10 000 donne montant_egal_net en « info », jamais un blocage", async () => {
  const { avertissements } = await conversation(STEFAN, { recherche: "" });
  assert.ok(avertissements.includes("montant_egal_net:10000"), avertissements.join(" | "));
  assert.ok(!avertissements.some((a) => a.startsWith("montant_interne")));
  assert.deepEqual(resteBloque(STEFAN, bloquantsReponse(avertissements)), []);
  // Le catalogue cherché (minivan à 5 000) sans que 5 000 soit dans le texte : pas un total, toujours un avertissement seulement.
  const cherche = await conversation(STEFAN);
  assert.ok(cherche.avertissements.includes("montant_egal_net:10000") && !cherche.avertissements.some((a) => a.startsWith("montant_interne")), cherche.avertissements.join(" | "));
  // Le prix du minivan cité dans le texte : 10 000 devient un total.
  const cite = await conversation(`5,000 THB per minivan, ${STEFAN}`);
  assert.deepEqual(montantsAv(cite.avertissements), ["montant_egal_net:10000"], cite.avertissements.join(" | "));
  // Sans le droit de voir les nets : le code sans la valeur.
  const sans = await conversation(STEFAN, { recherche: "", voit: false });
  assert.ok(sans.avertissements.includes("montant_egal_net") && !sans.avertissements.some((a) => a.startsWith("montant_egal_net:")), sans.avertissements.join(" | "));
});

test("un vrai net du service en cours reste bloquant : rendu par l'outil, ou service du dossier relié", async () => {
  const net = await conversation("Hi Stefan, the private minivan is 4,200 THB.");
  assert.ok(net.avertissements.includes("montant_interne:4200"), net.avertissements.join(" | "));
  assert.deepEqual(resteBloque("Hi Stefan, the private minivan is 4,200 THB.", bloquantsReponse(net.avertissements)), ["4200"]);
  // Le yacht n'a pas été cherché, mais il est au dossier relié : son net bloque.
  const relie = await conversation("Hi Stefan, the yacht is 10,000 THB.", { dossier: new Set([P_YACHT]), recherche: "" });
  assert.ok(relie.avertissements.includes("montant_interne:10000"), relie.avertissements.join(" | "));
  // Un total de vente ne lève jamais un net du service en cours : 2 × 5 000 = 10 000, net du yacht relié, reste bloqué.
  const total = await conversation(STEFAN, { dossier: new Set([P_YACHT]) });
  assert.ok(total.avertissements.includes("montant_interne:10000"), total.avertissements.join(" | "));
  // Dossier illisible : chaque net du catalogue bloque, comme avant.
  const illisible = await conversation(STEFAN, { dossier: new Set([TOUS_LES_SERVICES]) });
  assert.ok(illisible.avertissements.includes("montant_interne:10000"));
});

test("un montant lu chez un partenaire reste bloquant, même égal à un total de vente", async () => {
  const c = { id: "c0000000-0000-4000-8000-000000000001", entite_id: ENT, type_contact: "partenaire", nom: "Van Lomprayah", telephone: "", reponses: "auto" };
  const m = { id: "e0000000-0000-4000-8000-000000000001", conversation_id: c.id, sens: "entrant", texte: "2 vans, 10,000 for both", envoye_le: "2026-11-21T05:00:00Z" };
  const { avertissements } = await conversation(STEFAN, { avant: (memo) => retenirLecture(lireConversation({ conversation: c.id }, { conversation: c, messages: [m] }), memo) });
  assert.ok(avertissements.includes("montant_interne:10000"), avertissements.join(" | "));
  // Une conversation de partenaire jointe à l'Assistant (bloc <conversation>) : pareil ; ses montants ne sont jamais des éléments d'un total.
  const memo = memoDepuis([{ role: "user", content: "<conversation>Partner: net 10,000 for 2 vans</conversation> Reply to Stefan" }], { conversationInterne: true });
  assert.ok(memo.internes.has(10000) && !memo.tapes.has(10000));
});

test("commissions, marges et montants internes rendus par un outil restent bloquants", () => {
  for (const [cle, n] of [["commission", 1000], ["marge", 800], ["net_prevu", 4200]]) {
    const memo = memoDepuis([{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "lire_dossier", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ services: [{ prix_vente: 5000, [cle]: n }] }) }] }]);
    const c = controlerReponse(`Hi Stefan, it is ${n.toLocaleString("en")} THB.`, { internes: memo.internes, ventes: memo.prix, permisPrix: memo.prix, elementsVente: [...memo.prix] });
    assert.ok(c.avertissements.includes(`montant_interne:${n}`), cle);
  }
});

test("le net d'un autre service donne un avertissement non bloquant (montant_egal_net)", async () => {
  // 10 000 sans rien qui en fasse un prix ou un total (aucun prix de vente rendu) : avertissement seulement.
  const { avertissements } = await conversation("Hi Stefan, the yacht is 10,000 THB.", { recherche: "" });
  assert.ok(avertissements.includes("montant_egal_net:10000"), avertissements.join(" | "));
  assert.ok(!avertissements.some((a) => a.startsWith("montant_interne")));
  assert.deepEqual(bloquantsReponse(avertissements), { montants: [], noms: [] }, "l'écran ne bloque pas");
  assert.deepEqual(resteBloque("Hi Stefan, the yacht is 10,000 THB.", bloquantsReponse(avertissements)), []);
  const l = libelleAvertissement("montant_egal_net:10000");
  assert.equal(l.niveau, "info");
  assert.match(l.texte, /net d'un autre service/);
  // Vu dans la boîte d'une autre entreprise : seulement avec le droit nets (le chiffre est un net).
  assert.deepEqual(avertissementsVisibles(["montant_egal_net:10000"], ["partenaires.lire"]), { visibles: [], masques: 1 });
  assert.deepEqual(avertissementsVisibles(["montant_egal_net:10000"], ["partenaires.lire", "partenaires.nets"]).masques, 0);
  // La carte de l'Assistant l'affiche, sans bloquer la copie.
  assert.match(lire("src/gestion/js/views/agent.mjs"), /if \(code === "montant_egal_net"\) return valeur \? tr\(/);
});

test("netsDuControle : services rendus et dossier relié bloquent, les autres avertissent, un montant dans les deux bloque", () => {
  const nets = [{ montant: 4200, prestation_id: P_TRANSFERT }, { montant: 10000, prestation_id: P_YACHT }, { montant: 900, trajet_id: "f1000000-0000-4000-8000-000000000001" }, { montant: 10000, prestation_id: P_FERRY }, { montant: 700 }];
  const n = netsDuControle({ nets, refs: new Set([refDe("P", P_TRANSFERT)]), servicesEnCours: new Set([P_FERRY]) });
  assert.deepEqual([...n.bloquants].sort((a, b) => a - b), [700, 4200, 10000]);
  assert.deepEqual([...n.autres], [900]);
  assert.deepEqual([...netsDuControle({}).bloquants], []);
});

test("totaux de vente : prix × quantité, somme des services avec ou sans ferry, bornes de 6 éléments et de 20 par élément", () => {
  const t = (m, e) => [...totauxDeVente(m, e)].sort((a, b) => a - b);
  assert.deepEqual(t([10000, 10800, 9999], [5000, 400]), [10000, 10800], "2 × 5 000 puis 2 × 5 000 + 2 × 400 (ferry)");
  assert.deepEqual(t([100000, 105000], [5000]), [100000], "20 minivans oui, 21 non");
  // Six éléments au plus : 6 063 est la somme des six premiers, 7 127 ne s'obtient qu'avec les sept (quantités comprises).
  assert.deepEqual(t([6063, 7127], [1001, 1002, 1004, 1008, 1016, 1032, 1064]), [6063]);
  assert.deepEqual(t([1234.5], [617.25]), [1234.5], "centimes");
  assert.deepEqual(t([5000], []), []);
  // Pire cas borné : 60 éléments sans diviseur commun, un montant de près de 60 000 : rapide.
  const debut = Date.now();
  totauxDeVente([59999, 12345], Array.from({ length: 80 }, (_, i) => 1001 + i * 37));
  totauxDeVente([600000], Array.from({ length: 80 }, (_, i) => 1001 + i * 37));
  assert.ok(Date.now() - debut < 1500, `${Date.now() - debut} ms`);
});

test("totaux : un composant doit figurer dans le texte ; un montant rond sans composant reste montant_non_source", () => {
  const c = (message, o = {}) => controlerReponse(message, { permisPrix: new Set([1500, 900]), ventes: new Set([1500, 900]), elementsVente: [1500, 900], ...o }).avertissements;
  assert.deepEqual(c("4 adults at 1,500 THB: 6,000 THB in total."), []);
  assert.deepEqual(c("6,000 THB in total."), ["montant_non_source:6000"], "1 500 absent du texte");
  assert.deepEqual(c("1,500 THB per adult, 900 per child: 3,900 THB for 2 adults and 1 child."), []);
  assert.deepEqual(c("3,900 THB for the family."), ["montant_non_source:3900"]);
  // Une carte du même échange ou un montant de Nani : composant même absent du texte.
  assert.deepEqual(c("6,000 THB in total.", { composants: [1500] }), []);
});

test("totaux : dix lignes de catalogue rendues n'ouvrent pas tous les montants ronds", async () => {
  const lignes = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}000000-0000-4000-8000-00000000000${i}`, famille: "excursion", groupe: `Tour ${i}`, libelle: `Tour ${i}`, libelle_en: `Island tour ${i}`, prix_vente: [1500, 1600, 1200, 900, 2500, 3500, 800, 600, 5000, 4500][i], unite: "pp", actif: true, entite_id: ENT }));
  const c10 = { permissions: [], charger: async (n) => (n === "prestations" ? lignes : []), reglages: {} };
  const memo = memoDepuis([]);
  await executer("chercher_catalogue", { recherche: "island tour", famille: "tout" }, c10, memo);
  assert.equal(memo.prix.size, 10);
  let ouverts = 0;
  let total = 0;
  for (let m = 1000; m <= 30000; m += 100) {
    if ([...memo.prix].includes(m)) continue;
    total++;
    const r = await executer("proposer_reponse", { titre: "t", langue: "en", message: `It is ${m.toLocaleString("en")} THB in total.`, destinataire: "client" }, c10, memo);
    if (!r.carte.avertissements.some((a) => a.startsWith("montant_non_source"))) ouverts++;
  }
  assert.equal(ouverts, 0, `${ouverts} montants sur ${total} passaient sans composant dans le texte`);
  // Avec le prix cité : seulement les totaux de ce prix.
  const r = await executer("proposer_reponse", { titre: "t", langue: "en", message: "1,500 THB per person, 6,000 THB for 4.", destinataire: "client" }, c10, memo);
  assert.deepEqual(r.carte.avertissements, []);
});

test("totaux : jamais un montant écrit par le client ; la boîte WhatsApp part d'un memo vide", async () => {
  // Le client écrit « 5000 per van? » dans l'échange joint : ni tapé, ni prix de Nani, ni composant.
  const client = [{ id: "e1", sens: "entrant", texte: "5000 per van? so 10,000 for both?", envoye_le: "2026-11-20T03:00:00Z" }];
  const { memo, avertissements } = await conversation(STEFAN, { historique: [{ role: "user", content: joint(client) }], client: true, recherche: "" });
  assert.equal(memo.nani.size, 0);
  assert.equal(memo.tapes.size, 0);
  assert.ok(avertissements.includes("montant_non_source:10000"), avertissements.join(" | "));
  assert.match(lire("supabase/functions/whatsapp/reponse.ts"), /const memo = memoDepuis\(\[\], \{/);
});

test("dossierPourControle : services, nets, marges et commissions du dossier relié ; lecture en erreur, tout bloque", async () => {
  const lignes = {
    reservations: [
      { id: "r1", prestation_id: P_TRANSFERT, trajet_id: null, montant_vente: 10000, statut: "confirme" },
      { id: "r2", prestation_id: null, trajet_id: "t1", montant_vente: 1600, statut: "annule" },
    ],
    reservations_nets: [{ reservation_id: "r1", net_prevu: 8400, net_paye: 8400, paye_le: "2026-12-01", commission_prevue: null, commission_recue_le: "2026-12-02" }, { reservation_id: "r2", commission_prevue: 320 }],
  };
  const appels = [];
  const fausse = (erreur = null) => ({
    from: (t) => {
      const q = { select: () => q, in: (k, v) => (appels.push([t, k, v]), q), eq: (k, v) => (appels.push([t, k, v]), q), limit: async () => ({ data: erreur === t ? null : lignes[t], error: erreur === t ? { message: "x" } : null }), then: (ok) => ok({ data: erreur === t ? null : lignes[t], error: erreur === t ? { message: "x" } : null }) };
      return q;
    },
  });
  const d = await dossierPourControle(fausse(), "D1", [ENT]);
  assert.deepEqual([...d.services].sort(), [P_TRANSFERT, "t1"].sort());
  // Net prévu et payé (8 400), marge (10 000 − 8 400 = 1 600), commission (320) ; une date n'est pas un montant.
  assert.deepEqual([...d.internes].sort((a, b) => a - b), [320, 1600, 8400]);
  assert.deepEqual(d.ventes, [10000], "le service annulé ne compte pas");
  assert.ok(appels.some(([t, k, v]) => t === "reservations" && k === "dossier_id" && v === "D1") && appels.some(([t, k, v]) => t === "reservations" && k === "entite_id" && v.join() === ENT));
  assert.deepEqual([...(await dossierPourControle(fausse("reservations"), "D1", [ENT])).services], [TOUS_LES_SERVICES]);
  assert.ok((await dossierPourControle(fausse("reservations_nets"), "D1", [ENT])).services.has(TOUS_LES_SERVICES));
  assert.equal((await dossierPourControle(fausse(), null, [ENT])).services.size, 0, "sans dossier relié : rien");
});

test("envoi depuis Gestion : 422 pour un net du dossier relié, 409 pour le net d'un autre service, accepté avec la confirmation exacte", () => {
  const nets = [{ montant: 4200, prestation_id: P_TRANSFERT }, { montant: 10000, prestation_id: P_YACHT }];
  const base = { nets, servicesEnCours: new Set([P_TRANSFERT]), ventes: new Set([5000, 400, 14000]), prestataires: ["Lazy Day"] };
  // Le net du transfert du dossier relié : bloqué, rien ne part.
  const net = controleEnvoi("Hi Stefan, 4,200 THB per van.", base);
  assert.deepEqual(net.a_retirer, ["montant_interne:4200"]);
  assert.deepEqual(refusEnvoi(net, [4200]), { status: 422, corps: { erreur: "contenu_interne", a_retirer: ["montant_interne:4200"] } }, "une confirmation ne lève jamais un net du dossier");
  // Une commission du dossier relié : bloquée aussi.
  assert.deepEqual(controleEnvoi("Hi, 640 THB.", { ...base, internes: new Set([640]) }).a_retirer, ["montant_interne:640"]);
  // Le net du yacht, sans rapport : à confirmer.
  const autre = controleEnvoi("Hi Stefan, the yacht is 10,000 THB.", base);
  assert.deepEqual([autre.a_retirer, autre.a_confirmer, autre.portee], [[], [10000], "autre_service"]);
  assert.deepEqual(refusEnvoi(autre, []), { status: 409, corps: { erreur: "montant_a_confirmer", a_confirmer: [10000], portee: "autre_service" } });
  assert.equal(refusEnvoi(autre, [10000, 5]).status, 409, "liste différente : redemandé");
  assert.equal(refusEnvoi(autre, [10000]), null, "confirmation exacte : accepté");
  // Un total des services du dossier relié (2 × 5 000) n'est pas un prix rendu : égal au net du yacht, il est à confirmer, jamais bloqué.
  assert.deepEqual(controleEnvoi(STEFAN, { ...base, ventesDossier: [5000] }).a_confirmer, [10000]);
  assert.deepEqual(controleEnvoi(STEFAN, { ...base, ventesDossier: [5000] }).a_retirer, []);
  // Un prix de vente du catalogue égal au net d'un autre service : rien à confirmer.
  assert.deepEqual(controleEnvoi("Hi, 14,000 THB.", { ...base, nets: [{ montant: 14000, prestation_id: P_FERRY }] }).a_confirmer, []);
  // Sans dossier relié ni proposition, aucun net n'est celui du service en cours : à confirmer, « net du catalogue ».
  const seul = controleEnvoi("Hi Stefan, 4,200 THB.", { ...base, servicesEnCours: new Set() });
  assert.deepEqual([seul.a_confirmer, seul.portee], [[4200], "catalogue"]);
  assert.equal(refusEnvoi(seul, []).corps.portee, "catalogue");
  // Nom de partenaire : toujours bloqué.
  assert.deepEqual(controleEnvoi("Lazy Day picks you up.", base).a_retirer, ["nom_prestataire:Lazy Day"]);
  assert.ok(memesMontants([10000, 4200], [4200, 10000, 4200]) && !memesMontants([1], [1, 2]));
});

test("revue PR 306, point 2 : sans dossier relié, les nets des services de la proposition restent bloquants (422)", async () => {
  const { elementServices, servicesDeProposition, avertissementsSurs } = await import("../supabase/functions/whatsapp/proposer.js");
  const refs = new Set([refDe("P", P_TRANSFERT)]);
  const nets = [{ montant: 4200, prestation_id: P_TRANSFERT }, { montant: 10000, prestation_id: P_YACHT }];
  // Sonde 9 : envoi sans dossier, net du service de la proposition, liste « confirmée » forgée : refusé quand même.
  const c = controleEnvoi("Minivan 4,200 THB", { nets, refs, servicesEnCours: new Set() });
  assert.deepEqual(c.a_retirer, ["montant_interne:4200"]);
  assert.equal(refusEnvoi(c, [4200]).status, 422);
  // Les références voyagent dans les avertissements de la proposition (sans migration), relues par proposition_id.
  const e = elementServices([refDe("P", P_TRANSFERT), "P-zzzz", refDe("T", P_YACHT), refDe("P", P_TRANSFERT)]);
  assert.equal(e, `services:${refDe("P", P_TRANSFERT)},${refDe("T", P_YACHT)}`);
  assert.deepEqual([...servicesDeProposition(["montant_non_source:1", e])], [refDe("P", P_TRANSFERT), refDe("T", P_YACHT)]);
  assert.equal(elementServices([]), null);
  assert.deepEqual(avertissementsSurs(["services:P-aaaaaaaa", "montant_non_source:1"]), ["montant_non_source:1"], "un élément venu de la carte est retiré");
  assert.equal(elementServices(Array.from({ length: 200 }, (_, i) => `P-${String(i).padStart(8, "0")}`)).split(",").length, 80);
  const rep = lire("supabase/functions/whatsapp/reponse.ts");
  assert.match(rep, /avertissements: \[\.\.\.avertissementsSurs\(c\?\.avertissements\), \.\.\.\[elementServices\(refsVues\)\]\.filter\(Boolean\)\]/);
  assert.match(rep, /refsVues = \[\.\.\.\(memo\.refs \|\| \[\]\)\];/);
  const ci = lire("supabase/functions/whatsapp-envoi/index.ts");
  assert.match(ci, /admin\.from\("whatsapp_propositions"\)\.select\("avertissements"\)\.eq\("id", propositionId\)\.eq\("conversation_id", conv\.id\)\.maybeSingle\(\)/);
  assert.match(ci, /const refs = servicesDeProposition\(prop\.data \? prop\.data\.avertissements : \[\]\);/);
  // L'écran ne montre jamais cet élément.
  const W = await import("../src/gestion/js/whatsapp-calc.mjs");
  assert.deepEqual(W.avertissements({ avertissements: [e, "signature_retiree"] }).map((a) => a.cle), ["signature_retiree"]);
});

test("revue PR 306, points 6 et 7 : un net du dossier n'est levé que par une vente du dossier ; sans droit nets, ni valeur ni liste", () => {
  // Sonde 10 et 10b.
  assert.deepEqual(controleEnvoi("Total 2,000 THB", { internes: new Set([2000]), ventesDossier: [2000] }).a_retirer, []);
  assert.deepEqual(controleEnvoi("Total 2,000 THB", { internes: new Set([2000]), ventes: new Set([2000]) }).a_retirer, ["montant_interne:2000"]);
  // Sans le droit : 409 sans valeur ; la confirmation porte sur tous les montants du texte, exactement.
  const m = controleEnvoi("Hi, the yacht is 10,000 THB, deposit 2,000 THB.", { nets: [{ montant: 10000, prestation_id: P_YACHT }], servicesEnCours: new Set([P_TRANSFERT]), masquer: true });
  assert.deepEqual([m.a_confirmer, m.masque], [[], true]);
  assert.deepEqual(refusEnvoi(m, []).corps, { erreur: "montant_a_confirmer", a_confirmer: [], masque: true, portee: "autre_service" });
  assert.equal(refusEnvoi(m, [10000]).status, 409, "pas tous les montants du texte");
  assert.equal(refusEnvoi(m, [2000, 10000]), null);
  assert.doesNotMatch(JSON.stringify(refusEnvoi(m, [])), /10000/);
  const ci = lire("supabase/functions/whatsapp-envoi/index.ts");
  assert.match(ci, /sb\.rpc\("permissions_dans", \{ e \}\)/);
  assert.match(ci, /const masquer = droits\.some\(\(d: any\) => d\.error \|\| !Array\.isArray\(d\.data\) \|\| !d\.data\.includes\("partenaires\.lire"\) \|\| !d\.data\.includes\("partenaires\.nets"\)\);/);
});

test("revue PR 306, point 5 : nets illisibles, le contrôle se ferme partout", async () => {
  const c = controleEnvoi("Hi, 1,000 THB.", { controleImpossible: true });
  assert.deepEqual(c.a_retirer, ["controle_impossible"]);
  assert.equal(refusEnvoi(c, []).status, 422);
  const W = await import("../src/gestion/js/whatsapp-calc.mjs");
  assert.equal(W.codeEnvoi("contenu_interne", ["controle_impossible"]), "controle_impossible");
  assert.equal(W.envoiIncertain("controle_impossible"), false);
  // Dans l'Assistant et la boîte : avertissement bloquant, la copie reste fermée quel que soit le texte.
  const memo = memoDepuis([]);
  memo.controleImpossible = true;
  const r = await executer("proposer_reponse", { titre: "t", langue: "en", message: "Hello, see you tomorrow.", destinataire: "client" }, ctx, memo);
  assert.ok(r.carte.avertissements.includes("controle_impossible"));
  const b = bloquantsReponse(r.carte.avertissements);
  assert.deepEqual(resteBloque("Hello, see you tomorrow.", b), ["controle_impossible"]);
  assert.match(lire("supabase/functions/whatsapp-envoi/index.ts"), /controleImpossible: lusNets\.erreur \|\| !!prop\.error/);
  assert.match(lire("supabase/functions/whatsapp/reponse.ts"), /memo\.controleImpossible = lusNets\.erreur;/);
});

test("envoi depuis Gestion : montants_confirmes lus dans la demande, le texte et la légende", () => {
  const C = "3f2a1b4c-0000-4000-8000-000000000001";
  assert.deepEqual(lireEnvoi({ conversation_id: C, texte: "Hi", montants_confirmes: [10000, "5000", -3, "x", 10000] }).montants_confirmes, [10000, 5000]);
  assert.deepEqual(lireMontantsConfirmes("10000, 5000"), [10000, 5000]);
  assert.deepEqual(lireMontantsConfirmes(Array.from({ length: 30 }, (_, i) => i + 1)).length, 20);
  assert.deepEqual(lireMontantsConfirmes(null), []);
  const v = lireEnvoiVoucher({ conversation_id: C, reservation_id: C, essai_id: C, legende: "", montants_confirmes: "10000" });
  assert.deepEqual(v.montants_confirmes, [10000]);
  const index = lire("supabase/functions/whatsapp-envoi/index.ts");
  assert.match(index, /montants_confirmes: champ\("montants_confirmes"\)/);
  const ci = index.slice(index.indexOf("async function contenuInterne"));
  assert.match(ci, /netsPourControle\(admin, ids\),\n    dossierPourControle\(admin, conv\.dossier_id \|\| null, ids\),/);
  assert.match(ci, /return controleEnvoi\(texte, \{ nets: lusNets\.nets, refs, servicesEnCours: relie\.services, internes: relie\.internes, ventes, ventesDossier: relie\.ventes, prestataires, masquer, controleImpossible: lusNets\.erreur \|\| !!prop\.error \}\);/);
  assert.match(lire("supabase/functions/whatsapp-envoi/voucher.js"), /refusEnvoi\(await ctx\.contenuInterne\(admin, \{ \.\.\.conv, dossier_id: conv\.dossier_id \|\| d\.data\.id \}, demande\.legende, \{ sb \}\), demande\.montants_confirmes \|\| \[\]\)/);
});

test("écran WhatsApp : le 409 se confirme d'un clic et repart avec la liste attendue ; rien n'est parti entre-temps", async () => {
  const W = await import("../src/gestion/js/whatsapp-calc.mjs");
  assert.equal(envoiIncertain("montant_a_confirmer"), false);
  assert.match(erreurEnvoi("montant_a_confirmer"), /Confirmez-le/);
  assert.deepEqual(montantsAConfirmer({ erreur: "montant_a_confirmer", a_confirmer: [10000, "x"] }), [10000]);
  assert.deepEqual(montantsAConfirmer({ erreur: "contenu_interne", a_confirmer: [10000] }), []);
  // Autre service, catalogue, valeurs masquées : trois textes avec la liste renvoyée.
  const autre = W.aConfirmerEnvoi({ erreur: "montant_a_confirmer", a_confirmer: [10000], portee: "autre_service" });
  assert.match(autre.texte, /net d'un autre service/);
  const cat = W.aConfirmerEnvoi({ erreur: "montant_a_confirmer", a_confirmer: [10000], portee: "catalogue" });
  assert.match(cat.texte, /est aussi un net du catalogue/);
  assert.doesNotMatch(cat.texte, /autre service/);
  const masque = W.aConfirmerEnvoi({ erreur: "montant_a_confirmer", a_confirmer: [], masque: true }, "Yacht 10’000 THB, deposit 2,000");
  assert.deepEqual(masque.renvoi, [10000, 2000]);
  assert.match(masque.texte, /égal à un net interne/);
  const vue = lire("src/gestion/js/views/whatsapp.mjs");
  assert.match(vue, /const question = aConfirmerEnvoi\(r, texte\);/);
  assert.match(vue, /r = await etat\.store\.whatsappEnvoyer\(\{ conversation_id: c\.id, texte, proposition_id: p\.id, montants_confirmes: question\.renvoi \}\);/);
  const voucher = lire("src/gestion/js/views/voucher-whatsapp.mjs");
  assert.match(voucher, /encore\.addEventListener\("click", \(\) => partir\(question\.renvoi\)\);/);
  assert.match(voucher, /montants_confirmes: confirmes, fichier/);
  assert.match(voucher, /envoyer\.addEventListener\("click", \(\) => partir\(\)\);/, "le clic ne passe pas l'événement comme liste");
  const store = lire("src/gestion/js/store-supabase.mjs");
  assert.match(store, /if \(montants_confirmes\.length\) corps\.append\("montants_confirmes", montants_confirmes\.join\(","\)\);/);
  assert.equal((store.match(/a_confirmer: montantsLus\(lu\), masque: !!\(lu && lu\.masque\)/g) || []).length, 2);
});

test("boîte WhatsApp : nets du service en cours = ceux du dossier relié à la conversation", () => {
  const wa = lire("supabase/functions/whatsapp/reponse.ts");
  assert.match(wa, /const lusNets = await netsPourControle\(db, ids\);\n    memo\.nets = lusNets\.nets;\n/);
  assert.match(wa, /const relie = await dossierPourControle\(db, dossier \? dossier\.id : null, \[ent\.id\]\);\n    memo\.servicesEnCours = relie\.services;\n    for \(const n of relie\.internes\) memo\.internes\.add\(n\);/);
  // Le dossier n'est relié que pour un client de l'entreprise (jamais pour un partenaire) : const dossier = … && !partenaire.
  assert.match(wa, /const dossier = conv\.dossier_id && conv\.entite_id === ent\.id && !partenaire \?/);
});
