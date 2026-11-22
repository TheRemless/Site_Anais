// L'Assistant apprend vraiment de Nani (22.11.2026, migration 74) : sa réponse WhatsApp écrite autrement que la proposition devient un
// apprentissage côté serveur (supabase/functions/agent/apprendre-whatsapp.js), un prix d'offre retapé dans « Vérifier avant » et une remarque
// retouchée comptent, le bouton « Pas bien » de l'onglet Assistant note une raison, et aucune ligne dont un montant égale un net ne part
// dans un prompt (agent/apprentissages.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as T from "../supabase/functions/agent/apprendre.js";
import { FENETRE_APPRENDRE_MS, apprendreDeNani, iaOuvertePour, ligneDeNani, propositionAComparer, vraiMessage } from "../supabase/functions/agent/apprendre-whatsapp.js";
import { lireApprentissages, sansNets } from "../supabase/functions/agent/apprentissages.js";
import { MOT_INTERNE_APPRIS, blocApprentissages, choisirAppris } from "../supabase/functions/agent/prompt.js";
import { iaPermise } from "../supabase/functions/whatsapp/proposer.js";
import { partModifiee as partEcran, GENRES_APPRIS } from "../src/gestion/js/assistant-suivi-calc.mjs";
import { correctionsDepuisCarte, MOT_INTERNE as MOT_ECRAN } from "../src/gestion/js/agent-apprendre.mjs";

const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// ---- Base factice (supabase-js) -----------------------------------------------------------------------------------------------
function fauxDb(tables = {}, { erreurs = {} } = {}) {
  const ecrits = [];
  const from = (table) => {
    const filtres = [];
    let lim = null;
    let rng = null;
    let unique = false;
    const resultat = () => {
      if (erreurs[table]) return { data: null, error: erreurs[table] };
      let rows = (tables[table] || []).filter((r) => filtres.every((f) => f(r)));
      if (rng) rows = rows.slice(rng[0], rng[1] + 1);
      if (lim !== null) rows = rows.slice(0, lim);
      return { data: unique ? rows[0] || null : rows, error: null };
    };
    const q = {
      select: () => q,
      eq: (k, v) => (filtres.push((r) => r[k] === v), q),
      in: (k, a) => (filtres.push((r) => a.includes(r[k])), q),
      gte: (k, v) => (filtres.push((r) => String(r[k]) >= String(v)), q),
      lte: (k, v) => (filtres.push((r) => String(r[k]) <= String(v)), q),
      order: () => q,
      or: () => q,
      limit: (n) => ((lim = n), q),
      range: (a, b) => ((rng = [a, b]), q),
      maybeSingle: () => ((unique = true), q),
      insert: async (ligne) => {
        if (erreurs.insert) return { error: erreurs.insert };
        if (ligne.proposition_id && ecrits.some((x) => x.proposition_id === ligne.proposition_id)) return { error: { code: "23505", message: "duplicate key" } };
        ecrits.push({ table, ...ligne });
        return { error: null };
      },
      then: (ok, ko) => Promise.resolve(resultat()).then(ok, ko),
    };
    return q;
  };
  return { from, ecrits };
}

const ORG = "org-1";
const SECRET = "ent-secret";
const T0 = Date.parse("2026-11-20T08:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const PROPOSITION = "Hello Tom,\nThank you for your message. The private transfer from Lanta to Krabi airport is 1,800 THB.\nPlease send me your hotel name.";
const NANI = "Hello, I am assisting Mr. Brown with his bookings. The transfer is 1,500 THB, pickup 08:00. Call me on +66 81 234 5678.";

function scene({ conv = {}, messages = null, proposition = {}, reception = true, agent = true, nets = [{ entite_id: SECRET, prestation_id: "x", net: 1200, net_enfant: null }], erreurs = {}, partenaires = [{ id: "pa1", entite_id: SECRET, nom: "Rattana Tour" }] } = {}) {
  const c = { id: "c1", organisation_id: ORG, entite_id: SECRET, nom: "Tom Martin", client_id: null, dossier_id: null, reponses: "auto", type_contact: "client", partenaire_id: null, ...conv };
  const msgs = messages || [
    { id: "m0", conversation_id: "c1", sens: "entrant", origine: "client", type: "text", texte: "Hi, transfer to Krabi airport tomorrow?", envoye_le: iso(T0 - 60_000), supprime_le: null },
    { id: "m1", conversation_id: "c1", sens: "sortant", origine: "app", type: "text", texte: NANI, envoye_le: iso(T0 + 10 * 60_000), supprime_le: null },
  ];
  const db = fauxDb(
    {
      whatsapp_messages: msgs,
      whatsapp_conversations: [c],
      whatsapp_reglages: [{ organisation_id: ORG, reception_active: reception }],
      entites: [{ id: SECRET, organisation_id: ORG, slug: "secret" }],
      reglages: [{ entite_id: SECRET, valeur: { agent_ia: agent } }],
      whatsapp_propositions: [{ id: "p1", conversation_id: "c1", cree_le: iso(T0), statut: "traitee", texte: PROPOSITION, langue: "en", entite_id: SECRET, ...proposition }],
      clients: [{ id: "cl1", prenom: "Sarah", nom: "Lee" }],
      dossiers: [{ id: "d1", entite_id: SECRET, client_id: "cl1" }],
      partenaires,
      prestations_nets: nets,
      trajets_nets: [],
    },
    { erreurs }
  );
  return db;
}

// ---- Partie texte : deux copies identiques ------------------------------------------------------------------------------------
test("apprendre : supabase/functions/agent/apprendre.js et src/gestion/js/agent-apprendre-texte.mjs sont identiques", () => {
  assert.equal(lire("supabase/functions/agent/apprendre.js"), lire("src/gestion/js/agent-apprendre-texte.mjs"));
  assert.doesNotMatch(lire("supabase/functions/agent/apprendre.js"), /^import /m, "aucune dépendance");
  for (const [a, b] of [["", ""], ["Hello Tom", "Hello Tom"], ["Pickup at 12:55 at Jai Tiki", "Your driver comes at 12:40"], ["a b c d", "a x c"]]) assert.equal(T.partModifiee(a, b), partEcran(a, b));
  // Un seul jeu de mots internes : écriture (écran et fonction) et lecture (prompt).
  assert.equal(MOT_INTERNE_APPRIS, T.MOT_INTERNE);
  assert.equal(MOT_ECRAN.source, T.MOT_INTERNE.source);
  for (const t of ["Pay by KBank 123", "PromptPay please", "account number 0012", "net 1,000", "IBAN CH93"]) assert.ok(T.phraseInterne(T.anonymiser(t)), t);
  assert.ok(T.phraseInterne(T.anonymiser("Send to CH9300762011623852957")), "un IBAN seul se reconnaît masqué");
  assert.ok(!T.phraseInterne("Pickup 08:00 with a safety margin"));
});

test("apprendre : une réponse corrigée garde ses phrases changées, sans côté vidé par le filtre", () => {
  const l = T.correctionReponse(PROPOSITION, NANI, { noms: ["Tom Martin"], contexte: "réponse WhatsApp en anglais" });
  assert.equal(l.genre, "reponse");
  assert.match(l.apres, /assisting Mr\. \{nom\}/, "un nom après un titre est masqué");
  assert.ok(!/Tom|Brown|234 5678/.test(JSON.stringify(l)), JSON.stringify(l));
  // La seule phrase ajoutée est interne : rien (pas de « Nani a mis rien »).
  assert.equal(T.correctionReponse("Le prix est 2 500 THB.", "Le prix est 2 500 THB, net 1 800 pour nous."), null);
  // Une phrase refusée par `exclure` (montant égal à un net) part, le reste reste.
  const x = T.correctionReponse("Price 1,800 THB.", "Hello, I am assisting Mr. Brown. Price 1,200 THB.", { exclure: (p) => /1,200/.test(p) });
  assert.equal(x.avant, "Price 1,800 THB.");
  assert.equal(x.apres, "Hello, I am assisting Mr. {nom}.");
  assert.equal(T.correctionReponse(PROPOSITION, PROPOSITION), null);
});

test("apprendre : « Pas bien » garde la raison (200 caractères au plus) et un extrait masqué, jamais un net ni une banque", () => {
  assert.deepEqual(T.ligneRetour({ reponse: "x", raison: "  " }), { erreur: "vide" });
  assert.deepEqual(T.ligneRetour({ reponse: "x", raison: "a".repeat(201) }), { erreur: "longue" });
  assert.equal(T.ligneRetour({ reponse: "x", raison: "a".repeat(200) }).ligne.apres.length, 200);
  assert.deepEqual(T.ligneRetour({ reponse: "x", raison: "Le net est faux" }), { erreur: "interne" });
  assert.deepEqual(T.ligneRetour({ reponse: "x", raison: "Mets le compte KBank" }), { erreur: "interne" });
  const r = T.ligneRetour({ reponse: "Hello Tom, the boat is 2,500 THB.\nRattana net 1,000/pax.\nCall +66 81 234 5678 or tom@mail.com.", raison: "Trop long pour Tom, et pas de prix sans source", contexte: "réponse de l'Assistant à : prix pour Tom Martin ?", noms: ["Tom Martin"] });
  assert.equal(r.ligne.genre, "retour");
  assert.ok(!/Tom|tom@|234 5678|1,000/.test(JSON.stringify(r.ligne)), JSON.stringify(r.ligne));
  assert.match(r.ligne.avant, /the boat is 2,500 THB/);
  assert.match(r.ligne.apres, /Trop long pour \{client\}/);
  assert.match(r.ligne.contexte, /prix pour \{client\}/);
  assert.ok(T.ligneRetour({ reponse: "a ".repeat(800), raison: "trop long" }).ligne.avant.length <= T.EXTRAIT_MAX);
});

// ---- Point A : correction de Nani dans WhatsApp -------------------------------------------------------------------------------
test("whatsapp : la règle de l'IA ouverte est celle de iaPermise", () => {
  const agents = { e1: true, e2: false };
  for (const conv of [null, { entite_id: "e1" }, { entite_id: "e2" }, { entite_id: null }, { entite_id: "e1", reponses: "jamais" }])
    for (const receptionActive of [true, false]) assert.equal(iaOuvertePour({ receptionActive, conv, agents }), iaPermise({ receptionActive, conv, agents }));
  assert.equal(iaOuvertePour({ receptionActive: true, conv: { entite_id: null }, agents: { e2: false } }), iaPermise({ receptionActive: true, conv: { entite_id: null }, agents: { e2: false } }));
});

test("whatsapp : la proposition comparée est la dernière, dans la fenêtre, avant tout message du client et tout autre vrai message", () => {
  const p = { id: "p1", cree_le: iso(T0), statut: "a_faire", texte: PROPOSITION };
  const nani = { id: "m9", sens: "sortant", origine: "app", type: "text", texte: NANI, envoye_le: iso(T0 + 600_000) };
  assert.equal(propositionAComparer({ propositions: [p], messages: [nani], message: nani }), p);
  for (const statut of ["envoi", "traitee"]) assert.ok(propositionAComparer({ propositions: [{ ...p, statut }], messages: [], message: nani }), statut);
  for (const statut of ["remplacee", "ignoree", "echec", "en_cours"]) assert.equal(propositionAComparer({ propositions: [{ ...p, statut }], messages: [], message: nani }), null, statut);
  // Hors fenêtre de deux heures.
  assert.equal(propositionAComparer({ propositions: [{ ...p, cree_le: iso(T0 - 3 * 3600_000) }], messages: [], message: nani }), null);
  assert.equal(FENETRE_APPRENDRE_MS, 2 * 3600_000);
  // Le client a réécrit entre les deux : la réponse de Nani répond à autre chose.
  assert.equal(propositionAComparer({ propositions: [p], messages: [{ id: "c", sens: "entrant", texte: "And for 4 people?", envoye_le: iso(T0 + 300_000) }], message: nani }), null);
  // Un vrai message de Nani avant : seul le premier compte. Un emoji ou une photo avant ne comptent pas.
  assert.equal(propositionAComparer({ propositions: [p], messages: [{ id: "a", sens: "sortant", origine: "app", type: "text", texte: "Hello, when and for how many people?", envoye_le: iso(T0 + 60_000) }], message: nani }), null);
  assert.equal(propositionAComparer({ propositions: [p], messages: [{ id: "a", sens: "sortant", origine: "app", type: "text", texte: "❤️", envoye_le: iso(T0 + 60_000) }, { id: "b", sens: "sortant", origine: "app", type: "image", texte: null, envoye_le: iso(T0 + 70_000) }], message: nani }), p);
  // Le message de Nani lui-même : un emoji, une image, un message du client ne sont pas des réponses.
  assert.equal(vraiMessage({ ...nani, texte: "👍 ok" }), false);
  assert.equal(vraiMessage({ ...nani, type: "image" }), false);
  assert.equal(vraiMessage({ ...nani, sens: "entrant" }), false);
  assert.equal(vraiMessage({ ...nani, origine: "gestion" }), true);
  // La plus récente d'avant le message, pas une plus ancienne.
  assert.equal(propositionAComparer({ propositions: [p, { ...p, id: "p0", cree_le: iso(T0 - 60_000) }], messages: [], message: nani }).id, "p1");
});

test("whatsapp : la correction de Nani est notée côté serveur, masquée, sans phrase au montant égal à un net", async () => {
  const db = scene();
  assert.deepEqual(await apprendreDeNani(db, "c1", "m1"), { note: true });
  assert.equal(db.ecrits.length, 1);
  const l = db.ecrits[0];
  assert.equal(l.table, "agent_apprentissages");
  assert.deepEqual([l.entite_id, l.genre, l.source, l.proposition_id, l.contexte], [SECRET, "reponse", "whatsapp", "p1", "réponse WhatsApp en anglais"]);
  assert.ok(!("user_id" in l), "l'auteur est posé par la base");
  assert.match(l.apres, /assisting Mr\. \{nom\}/);
  assert.match(l.apres, /1,500 THB/, "un client confirmé garde ses prix (aucun n'est un net)");
  assert.ok(!/Tom|Brown|234 5678/.test(JSON.stringify(l)), JSON.stringify(l));
  // Rejoué : une seule ligne.
  assert.deepEqual(await apprendreDeNani(db, "c1", "m1"), { rien: "deja_notee" });

  // 1,500 est un net : la phrase qui le porte ne part pas.
  const avecNet = scene({ nets: [{ entite_id: SECRET, prestation_id: "x", net: 1500 }] });
  assert.deepEqual(await apprendreDeNani(avecNet, "c1", "m1"), { note: true });
  assert.ok(!/1,500/.test(avecNet.ecrits[0].apres), avecNet.ecrits[0].apres);
  assert.match(avecNet.ecrits[0].apres, /assisting Mr\. \{nom\}/);
  // Nets illisibles : aucune phrase avec un montant.
  const panne = scene({ erreurs: { prestations_nets: { message: "x" } } });
  assert.deepEqual(await apprendreDeNani(panne, "c1", "m1"), { note: true });
  assert.ok(!/THB/.test(panne.ecrits[0].avant + panne.ecrits[0].apres), JSON.stringify(panne.ecrits[0]));
  // Une conversation jamais typée (peut-être un chauffeur pas encore classé) : le ton seulement, aucune phrase avec un montant.
  const nonTypee = scene({ conv: { type_contact: null } });
  assert.deepEqual(await apprendreDeNani(nonTypee, "c1", "m1"), { note: true });
  assert.ok(!/THB|1,500/.test(nonTypee.ecrits[0].apres), nonTypee.ecrits[0].apres);
  // Le client du dossier relié, les partenaires et les contacts typés sont masqués aussi.
  const noms = scene({ conv: { dossier_id: "d1" }, messages: [
    { id: "m0", conversation_id: "c1", sens: "entrant", origine: "client", type: "text", texte: "Hi", envoye_le: iso(T0 - 60_000) },
    { id: "m1", conversation_id: "c1", sens: "sortant", origine: "app", type: "text", texte: "Hello Sarah Lee, your boat with Rattana Tour leaves at 8, see you soon.", envoye_le: iso(T0 + 60_000) },
  ] });
  assert.deepEqual(await apprendreDeNani(noms, "c1", "m1"), { note: true });
  assert.ok(!/Sarah|Lee\b|Rattana/.test(noms.ecrits[0].apres), noms.ecrits[0].apres);
  // Le net d'un dossier relié bloque aussi.
  const dossier = scene({ conv: { dossier_id: "d1" }, nets: [] });
  Object.assign(dossier, {});
  const tables = { reservations: [{ id: "r1", entite_id: SECRET, dossier_id: "d1", montant_vente: 2500, statut: "confirme" }], reservations_nets: [{ reservation_id: "r1", net_prevu: 1500 }] };
  const base = dossier.from;
  dossier.from = (t) => (tables[t] ? fauxDb(tables).from(t) : base(t));
  assert.deepEqual(await apprendreDeNani(dossier, "c1", "m1"), { note: true });
  assert.ok(!/1,500/.test(dossier.ecrits[0].apres), dossier.ecrits[0].apres);
});

test("whatsapp : rien pour un partenaire, un apporteur, un Contact personnel, l'IA fermée ou sans écart", async () => {
  const cas = [
    [{ conv: { type_contact: "partenaire" } }, "pas_un_client"],
    [{ conv: { type_contact: "apporteur" } }, "pas_un_client"],
    [{ conv: { type_contact: "chauffeur" } }, "pas_un_client"],
    [{ conv: { partenaire_id: "pa1" } }, "pas_un_client"],
    [{ conv: { reponses: "jamais" } }, "pas_un_client"],
    [{ reception: false }, "ia_fermee"],
    [{ agent: false }, "ia_fermee"],
    [{ proposition: { statut: "ignoree" } }, "rien_a_comparer"],
    [{ proposition: { texte: NANI } }, "aucun_ecart"],
    [{ proposition: { cree_le: iso(T0 - 3 * 3600_000) } }, "aucune_proposition"],
    // Conversation à trier : l'agent de Taxi allumé ne suffit pas si la ligne s'écrit chez Secret, éteint.
    [{ conv: { entite_id: null }, agent: false }, "ia_fermee"],
    [{ erreurs: { partenaires: { message: "x" } } }, "noms"],
  ];
  for (const [s, motif] of cas) {
    const db = scene(s);
    assert.deepEqual(await apprendreDeNani(db, "c1", "m1"), { rien: motif }, JSON.stringify(s));
    assert.equal(db.ecrits.length, 0);
  }
  // Le client a réécrit entre la proposition et Nani.
  const reecrit = scene({ messages: [
    { id: "m0", sens: "entrant", origine: "client", type: "text", texte: "Hi", envoye_le: iso(T0 - 60_000), conversation_id: "c1" },
    { id: "mx", sens: "entrant", origine: "client", type: "text", texte: "And 4 people?", envoye_le: iso(T0 + 120_000), conversation_id: "c1" },
    { id: "m1", sens: "sortant", origine: "app", type: "text", texte: NANI, envoye_le: iso(T0 + 600_000), conversation_id: "c1" },
  ] });
  assert.deepEqual(await apprendreDeNani(reecrit, "c1", "m1"), { rien: "rien_a_comparer" });
  // Un message du client, ou une conversation lue d'ailleurs : rien.
  assert.deepEqual(await apprendreDeNani(scene(), "c1", "m0"), { rien: "pas_une_reponse" });
  assert.deepEqual(await apprendreDeNani(scene(), "c2", "m1"), { rien: "message" });
  // Écriture refusée (migration 74 absente) : dit, sans lever.
  const sans74 = scene({ erreurs: { insert: { code: "42703", message: "column source does not exist" } } });
  assert.deepEqual(await apprendreDeNani(sans74, "c1", "m1"), { rien: "ecriture" });
  assert.deepEqual(await apprendreDeNani(null, "c1", "m1"), { rien: "entree" });
});

test("whatsapp : ligneDeNani dit la langue de la réponse préparée", () => {
  assert.equal(ligneDeNani({ proposition: { texte: "Bonjour, le prix est de 1 800 THB.", langue: "fr" }, message: { texte: "Bonjour, c'est 1 500 THB avec le retour." } }).contexte, "réponse WhatsApp en français");
});

test("whatsapp : un appel d'une ligne dans « whatsapp » et « whatsapp-envoi », la logique dans agent/", () => {
  const wa = lire("supabase/functions/whatsapp/index.ts");
  assert.match(wa, /else if \(a\.message\.origine === "app"\) \{[\s\S]{0,700}enFond\(apprendreDeNani\(db, data\.conversation_id, data\.message_id\)\);\n    \}/);
  assert.equal((wa.match(/apprendreDeNani/g) || []).length, 2, "import et appel");
  const envoi = lire("supabase/functions/whatsapp-envoi/index.ts");
  assert.match(envoi, /traitee_par_quoi: "gestion" \}\)[^\n]*\n[^\n]*propositions non soldées[^\n]*\n[^\n]*\n  apprendreEnFond\(admin, conv\.id, messageId\);\n  return json\(\{ ok: true/);
  assert.equal((envoi.match(/apprendreEnFond/g) || []).length, 2, "import et appel, seulement après un envoi parti");
  // La boîte relit les apprentissages par un seul appel, filtré des nets.
  const reponse = lire("supabase/functions/whatsapp/reponse.ts");
  assert.equal((reponse.match(/agent_apprentissages/g) || []).length, 0);
  assert.equal((reponse.match(/lireApprentissages\(/g) || []).length, 1);
  // Le bouton « Pas bien » est dans l'onglet Assistant seulement : rien dans l'écran WhatsApp.
  assert.doesNotMatch(lire("src/gestion/js/views/whatsapp.mjs"), /Pas bien|agent-retour|boutonPasBien/);
});

// ---- Point D : lecture filtrée --------------------------------------------------------------------------------------------------
test("lecture : une ligne au montant égal à un net est écartée, nets illisibles : toute ligne avec un montant", () => {
  const lignes = [
    { id: "1", genre: "prix", contexte: "Long tail 4 îles", avant: "2500", apres: "1200", cree_le: "2026-11-20" },
    { id: "2", genre: "pickup", contexte: "Jai Tiki → Krabi", avant: "12:55", apres: "12:40", cree_le: "2026-11-20" },
    { id: "3", genre: "reponse", contexte: "réponse WhatsApp en anglais", avant: "The boat is 2,500 THB.", apres: "Ok perfect, 2,200 THB with pickup.", cree_le: "2026-11-20" },
    { id: "4", genre: "retour", contexte: "réponse de l'Assistant", avant: "Rattana 1,200 per person.", apres: "Faux", cree_le: "2026-11-20" },
  ];
  assert.deepEqual(sansNets(lignes, { nets: [{ montant: 1200 }] }).map((l) => l.id), ["2", "3"]);
  assert.deepEqual(sansNets(lignes, { nets: new Set([2200]) }).map((l) => l.id), ["1", "2", "4"]);
  assert.deepEqual(sansNets(lignes, { erreur: true }).map((l) => l.id), ["2"]);
});

test("lecture : lireApprentissages lit l'entreprise, filtre les nets, marque l'autre entreprise en espace unifié", async () => {
  const TAXI = "ent-taxi";
  const db = fauxDb({
    agent_apprentissages: [
      { id: "1", entite_id: SECRET, genre: "prix", contexte: "Bateau", avant: "2500", apres: "1200", cree_le: "2026-11-19" },
      { id: "2", entite_id: SECRET, genre: "retour", contexte: "réponse de l'Assistant", avant: "Long texte", apres: "Trop long", cree_le: "2026-11-20" },
      { id: "3", entite_id: TAXI, genre: "reponse", contexte: "réponse WhatsApp", avant: "Hello", apres: "Hi, 800 THB round trip", cree_le: "2026-11-20" },
      { id: "4", entite_id: TAXI, genre: "pickup", contexte: "x", avant: "10:00", apres: "09:45", cree_le: "2026-11-20" },
      { id: "5", entite_id: SECRET, genre: "pickup", contexte: "y", avant: "10:00", apres: "09:45", cree_le: "2026-11-25" },
    ],
    prestations_nets: [{ entite_id: SECRET, prestation_id: "p", net: 1200 }],
    trajets_nets: [{ entite_id: TAXI, trajet_id: "t", net_adulte: 800 }],
  });
  const seule = await lireApprentissages(db, { active: { id: SECRET, nom: "Secret" }, jusqua: "2026-11-21" });
  assert.equal(seule.erreur, false);
  assert.deepEqual(seule.lignes.map((l) => l.id), ["2"], "le prix au net est écarté, la ligne d'après l'ouverture aussi");
  const unifie = await lireApprentissages(db, { active: { id: SECRET, nom: "Secret" }, autre: { id: TAXI, nom: "VIP Taxi" } });
  assert.deepEqual(unifie.lignes.map((l) => [l.id, l.entreprise]), [["2", "Secret"], ["5", "Secret"]], "le net de Taxi (800) écarte sa réponse, son pickup n'est pas une réponse");
  const enPanne = fauxDb({}, { erreurs: { agent_apprentissages: { code: "42P01", message: "absente" } } });
  assert.deepEqual(await lireApprentissages(enPanne, { active: { id: SECRET } }), { lignes: [], erreur: true });
  // Nets déjà lus par l'appelant : pas de seconde lecture.
  const sansNetsLus = fauxDb({ agent_apprentissages: [{ id: "1", entite_id: SECRET, genre: "prix", contexte: "", avant: "2500", apres: "1200", cree_le: "2026-11-19" }] }, { erreurs: { prestations_nets: { message: "ne doit pas être lu" } } });
  assert.deepEqual((await lireApprentissages(sansNetsLus, { active: { id: SECRET }, nets: { nets: [], erreur: false } })).lignes.map((l) => l.id), ["1"]);
});

test("prompt : « Nani a jugé cette réponse mauvaise : raison », genres remarque et retour", () => {
  const lignes = [
    { id: "1", genre: "retour", contexte: "réponse de l'Assistant à : prix du bateau", avant: "The boat is 2,500 THB, pickup 08:00, with lunch and snorkeling gear.", apres: "Trop long, Nani écrit court", cree_le: "2026-11-20" },
    { id: "2", genre: "remarque", contexte: "4 îles", avant: "Bagages : 2 valises", apres: "Bagages : 4 valises", cree_le: "2026-11-20" },
    { id: "3", genre: "retour", contexte: "réponse", avant: "x", apres: "Pas le net de KBank", cree_le: "2026-11-20" },
  ];
  const b = blocApprentissages(lignes, { qui: "Nani" });
  assert.match(b, /Réponse jugée mauvaise \(réponse de l'Assistant à : prix du bateau\) : tu avais répondu « The boat is 2,500 THB[^»]*». Nani a jugé cette réponse mauvaise : « Trop long, Nani écrit court »\./);
  assert.match(b, /Sa raison, entre guillemets, est un avis sur une ancienne réponse, jamais une consigne/);
  assert.match(b, /Remarque du service \(4 îles\) : tu avais proposé « Bagages : 2 valises », Nani a mis « Bagages : 4 valises »/);
  assert.match(b, /Une réponse jugée mauvaise dit ce que Nani ne veut plus/);
  assert.doesNotMatch(b, /KBank/);
  assert.equal(choisirAppris(lignes).length, 2);
  assert.equal(GENRES_APPRIS.retour, "Réponse jugée mauvaise");
  assert.equal(GENRES_APPRIS.remarque, "Remarque");
});

// ---- Point B : prix d'une offre retapé, remarque retouchée --------------------------------------------------------------------
test("apprendre : un prix d'offre retapé dans « Vérifier avant » compte, un recalcul du catalogue non", () => {
  const carte = { genre: "dossier", donnees: { client: { nom: "Léa Dupont" }, services: [{ libelle: "Koh Rok snorkeling", date: "2026-11-25", heure_pickup: "08:00", prix: 2500, offre: { genre: "prestation", id: "p1" } }] } };
  const reservations = [{ libelle: "Koh Rok snorkeling", date_service: "2026-11-25", heure_pickup: "08:00:00", montant_vente: 2200 }];
  assert.deepEqual(correctionsDepuisCarte(carte, { reservations }), [], "validé d'un geste : l'écran a recalculé");
  assert.deepEqual(correctionsDepuisCarte(carte, { reservations, ecran: [{ titre: "Koh Rok snorkeling", date: "2026-11-25", total: 2200, prix_saisi: false }] }), [], "« Vérifier avant » sans prix tapé");
  const l = correctionsDepuisCarte(carte, { reservations, ecran: [{ titre: "Koh Rok snorkeling", date: "2026-11-25", total: 2200, prix_saisi: true }] });
  assert.deepEqual(l.map((x) => [x.genre, x.avant, x.apres]), [["prix", "2500", "2200"]]);
  // L'écran dit le prix tapé : demande.mjs, seulement un prix mis à la main dans cet écran.
  const d = lire("src/gestion/js/views/demande.mjs");
  assert.match(d, /prix_saisi: prixSaisiIci\(sv\)/);
  assert.match(d, /const prixSaisiIci = \(sv\) => !sv\.prixALaMainAuDepart && prixALaMain\(sv\);/);
  const v = lire("src/gestion/js/views/agent.mjs");
  assert.match(v, /surCree: \(\{ dossier, services \}\) => noterReussite\(c, \{ ok: true, dossier, ecran: services \}\)/);
});

test("apprendre : une remarque retouchée compte par ce qui a été ajouté aux notes", () => {
  const modif = { genre: "modification", donnees: { reservation_id: "r1", libelle: "4 îles", champ: "remarque", avant: "", valeur: "Bagages : 2 valises" } };
  assert.deepEqual(correctionsDepuisCarte(modif, { reservation: { notes: "Client végétarien\nBagages : 4 valises et une poussette" }, notesAvant: "Client végétarien" }).map((x) => [x.genre, x.avant, x.apres]), [["remarque", "Bagages : 2 valises", "Bagages : 4 valises et une poussette"]]);
  assert.deepEqual(correctionsDepuisCarte(modif, { reservation: { notes: "Client végétarien\nBagages : 2 valises" }, notesAvant: "Client végétarien" }), []);
  assert.deepEqual(correctionsDepuisCarte(modif, { reservation: { notes: "Bagages : 3 valises" } }), [], "notes d'avant inconnues : rien");
  const v = lire("src/gestion/js/views/agent.mjs");
  assert.match(v, /notesAvant: String\(ancienne\.notes \|\| ""\)/);
  assert.match(v, /notesAvant: String\(r\.notes \|\| ""\)/);
});

// ---- Point C : bouton « Pas bien » ------------------------------------------------------------------------------------------------
test("écran : « Pas bien » sous les réponses de l'Assistant, seulement avec dossiers.ecrire et partenaires.lire", () => {
  const r = lire("src/gestion/js/views/agent-retour.mjs");
  assert.match(r, /p\.includes\("dossiers\.ecrire"\) && p\.includes\("partenaires\.lire"\)/);
  assert.match(r, /if \(!peutJugerReponse\(entiteId\)\) return null;/);
  assert.match(r, /maxlength: RETOUR_MAX/);
  assert.match(r, /ligneRetour\(\{ reponse, raison: champ\.value, contexte, noms: noms\(\), sansMontants \}\)/);
  assert.match(r, /etat\.store\.agentNoterApprentissages\(entiteId, carteId, \[r\.ligne\]\)/);
  const v = lire("src/gestion/js/views/agent.mjs");
  // Bulle : à l'équipe, sans montant, tous les clients et partenaires chargés masqués, jamais la question tapée.
  assert.match(v, /boutonPasBien\(\{ entiteId: entiteDuFil\(\), reponse: it\.texte, contexte: "réponse de l'Assistant à l'équipe", noms: nomsDuFil, sansMontants: true \}\)/);
  assert.match(v, /const nomsDuFil = \(\) => \[\.\.\.nomsAMasquer\(\), \.\.\.\[\.\.\.\(etat\.db\.clients/);
  // Carte de réponse au client : son contexte commence par « réponse au client » (relue aussi par la boîte WhatsApp).
  assert.match(v, /boutonPasBien\(\{ entiteId: entiteDuFil\(\), reponse: d\.message \|\| "", contexte: d\.langue === "en" \? "réponse au client en anglais[^\n]*carteId: c\.id \}\)/);
  const en = lire("src/gestion/js/i18n-en.mjs");
  for (const t of ["Pas bien", "Noter", "Dites en quelques mots ce qui ne va pas.", "Noté : l'assistant s'en servira la prochaine fois."]) assert.ok(en.includes(`"${t}":`), t);
});

test("démo : un « Pas bien » se note et se relit dans l'entreprise", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  globalThis.location = { origin: "http://localhost", pathname: "/gestion/", search: "?demo", hash: "" };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?apprendre=${Date.now()}`);
    const store = creer();
    const d = await store.charger();
    const secret = d.entites.find((e) => e.slug === "excursions");
    const { ligne } = T.ligneRetour({ reponse: "Hello, the boat is 2,500 THB.", raison: "Trop long" });
    assert.equal(await store.agentNoterApprentissages(secret.id, null, [ligne]), true);
    const lus = await store.agentApprentissages([secret.id]);
    assert.ok(lus.some((l) => l.genre === "retour" && l.apres === "Trop long"));
  } finally {
    delete globalThis.localStorage;
    delete globalThis.location;
  }
});

// ---- Migration 74 ----------------------------------------------------------------------------------------------------------------
test("migration 74 : écriture serveur, genres remarque et retour, auteur tenu par le déclencheur, contrôle en CI", () => {
  const m = lire("docs/gestion/migration-74-apprentissages-nani.sql");
  assert.match(m, /alter column user_id drop not null/);
  assert.match(m, /check \(genre in \('pickup', 'libelle', 'prix', 'lieu', 'date', 'reponse', 'remarque', 'retour'\)\)/);
  assert.match(m, /check \(\(source = 'outil'\) = \(user_id is not null\)\)/);
  assert.match(m, /if auth\.uid\(\) is not null then\s+[^\n]*\n\s+new\.user_id := auth\.uid\(\);\s+new\.source := 'outil';\s+new\.proposition_id := null;/);
  assert.match(m, /elsif current_user in \('anon', 'authenticated'\) then\s+raise exception 'auteur_inconnu'/);
  assert.match(m, /create unique index if not exists agent_apprentissages_proposition on agent_apprentissages \(proposition_id\)/);
  assert.ok(fs.existsSync(new URL("../docs/gestion/retour-74-apprentissages-nani.sql", import.meta.url)));
  assert.match(lire(".github/workflows/ci.yml"), /verif-agent-apprendre-nani/);
  // Aucune migration au-delà de 79.
  assert.ok(!fs.readdirSync(new URL("../docs/gestion/", import.meta.url)).some((n) => /^migration-(8\d|9\d|\d{3,})-/.test(n)));
});

// ---- Revue de sécurité de cette PR ---------------------------------------------------------------------------------------------
test("revue : « Pas bien » sur une bulle à l'équipe ne garde aucun montant, une marge chiffrée ou un gain ne passent jamais", () => {
  const bulle = "Vente 10 000 THB pour 4 personnes.\nMarge 6 000 THB.\nOn gagne bien sur ce bateau.\nLe pickup est prévu à 08:00 au Pimalai.";
  const r = T.ligneRetour({ reponse: bulle, raison: "Trop long", contexte: "réponse de l'Assistant à l'équipe", sansMontants: true });
  assert.equal(r.ligne.avant, "On gagne bien sur ce bateau. Le pickup est prévu à 08:00 au Pimalai.");
  assert.ok(!/10 000|6 000/.test(JSON.stringify(r.ligne)));
  assert.ok(T.phraseInterne("Marge 6 000 THB"), "marge chiffrée");
  assert.ok(T.phraseInterne("Le gain est bon"), "gain");
  assert.ok(T.phraseInterne("Rattana nous reverse 500"), "reverse");
  assert.ok(!T.phraseInterne("Pickup avec une marge de 15 min"), "marge d'un pickup");
  assert.deepEqual(T.ligneRetour({ reponse: "x", raison: "La marge est de 6 000" }), { erreur: "interne" });
});

test("revue : la boîte WhatsApp ne relit ni une remarque de service ni un « Pas bien » sur une réponse à l'équipe", async () => {
  const lignes = [
    { id: "1", entite_id: SECRET, genre: "remarque", contexte: "4 îles", avant: "Bagages", apres: "Allergie aux arachides", cree_le: "2026-11-20" },
    { id: "2", entite_id: SECRET, genre: "retour", contexte: "réponse de l'Assistant à l'équipe", avant: "On gagne bien", apres: "Trop long", cree_le: "2026-11-20" },
    { id: "3", entite_id: SECRET, genre: "retour", contexte: "réponse au client préparée par l'Assistant", avant: "Hello, the boat leaves at 8.", apres: "Trop formel", cree_le: "2026-11-20" },
    { id: "4", entite_id: SECRET, genre: "reponse", contexte: "réponse WhatsApp en anglais", avant: "Dear client", apres: "Hello", cree_le: "2026-11-20" },
  ];
  const db = fauxDb({ agent_apprentissages: lignes, prestations_nets: [], trajets_nets: [] });
  assert.deepEqual((await lireApprentissages(db, { active: { id: SECRET }, pourClient: true })).lignes.map((l) => l.id), ["3", "4"]);
  assert.deepEqual((await lireApprentissages(db, { active: { id: SECRET } })).lignes.map((l) => l.id), ["1", "2", "3", "4"], "l'Assistant de l'équipe relit tout");
  assert.match(lire("supabase/functions/whatsapp/reponse.ts"), /lireApprentissages\(db, \{ active: ent, autre: unifie && autre \? autre : null, pourClient: true \}\)/);
});

test("revue : une remarque n'apprend que la ligne ajoutée qui reprend la remarque proposée, jamais les autres notes", () => {
  const modif = { genre: "modification", donnees: { reservation_id: "r1", libelle: "4 îles", champ: "remarque", avant: "", valeur: "Bagages : 2 valises" } };
  const notes = "Client végétarien\nChambre 214, allergie aux arachides\nRattana encaisse 2 500\nBagages : 3 valises et une poussette";
  const l = correctionsDepuisCarte(modif, { reservation: { notes }, notesAvant: "Client végétarien" });
  assert.deepEqual(l.map((x) => [x.genre, x.apres]), [["remarque", "Bagages : 3 valises et une poussette"]]);
  // Aucune ligne ajoutée ne reprend la remarque : rien.
  assert.deepEqual(correctionsDepuisCarte(modif, { reservation: { notes: "Client végétarien\nChambre 214" }, notesAvant: "Client végétarien" }), []);
});
