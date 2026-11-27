// L'Assistant apprend vraiment de Nani (22.11.2026, migration 74) : sa réponse WhatsApp écrite autrement que la proposition devient un
// apprentissage côté serveur (supabase/functions/agent/apprendre-whatsapp.js), un prix d'offre retapé dans « Vérifier avant » et une remarque
// retouchée comptent, le bouton « Pas bien » de l'onglet Assistant note une raison, et aucune ligne dont un montant égale un net ne part
// dans un prompt (agent/apprentissages.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as T from "../supabase/functions/agent/apprendre.js";
import { FENETRE_APPRENDRE_MS, apprendreDeNani, clientPourApprendre, iaOuvertePour, ligneDeNani, propositionAComparer, vraiMessage } from "../supabase/functions/agent/apprendre-whatsapp.js";
import { EQUIPE, auteurDe, lireApprentissages, sansNets } from "../supabase/functions/agent/apprentissages.js";
import { clientConfirme } from "../supabase/functions/agent/outils.js";
import { MOT_INTERNE_APPRIS, blocApprentissages, choisirAppris } from "../supabase/functions/agent/prompt.js";
import { iaPermise } from "../supabase/functions/whatsapp/proposer.js";
import { partModifiee as partEcran, GENRES_APPRIS } from "../src/gestion/js/assistant-suivi-calc.mjs";
import { correctionsDepuisCarte, remarqueGardee, MOT_INTERNE as MOT_ECRAN } from "../src/gestion/js/agent-apprendre.mjs";

const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// ---- Base factice (supabase-js) -----------------------------------------------------------------------------------------------
function fauxDb(tables = {}, { erreurs = {} } = {}) {
  const ecrits = [];
  // La vue de la migration 74 : les lignes non internes de la table.
  if (tables.agent_apprentissages && !tables.agent_apprentissages_pour_ia) tables = { ...tables, agent_apprentissages_pour_ia: tables.agent_apprentissages.filter((l) => !l.interne) };
  if (erreurs.agent_apprentissages && !erreurs.agent_apprentissages_pour_ia) erreurs = { ...erreurs, agent_apprentissages_pour_ia: erreurs.agent_apprentissages };
  const from = (table) => {
    const filtres = [];
    let lim = null;
    let rng = null;
    let unique = false;
    let tri = null;
    const resultat = () => {
      if (erreurs[table]) return { data: null, error: erreurs[table] };
      let rows = (tables[table] || []).filter((r) => filtres.every((f) => f(r)));
      if (tri) rows = [...rows].sort((a, b) => String(a[tri.k]).localeCompare(String(b[tri.k])) * (tri.asc ? 1 : -1));
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
      order: (k, o = {}) => ((tri = { k, asc: o.ascending !== false }), q),
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
const NANI = "Hello, I am assisting Mr. Fictif with his bookings. The transfer is 1,500 THB, pickup 08:00. Call me on +66 00 000 0000.";

function scene({ conv = {}, messages = null, proposition = {}, reception = true, agent = true, nets = [{ entite_id: SECRET, prestation_id: "x", net: 1200, net_enfant: null }], erreurs = {}, partenaires = [{ id: "pa1", entite_id: SECRET, nom: "Partenaire Fictif Tour" }] } = {}) {
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
  assert.ok(!/Tom|Fictif|000 0000/.test(JSON.stringify(l)), JSON.stringify(l));
  // La seule phrase ajoutée est interne : rien (pas de « Nani a mis rien »).
  assert.equal(T.correctionReponse("Le prix est 2 500 THB.", "Le prix est 2 500 THB, net 1 800 pour nous."), null);
  // Une phrase refusée par `exclure` (montant égal à un net) part, le reste reste.
  const x = T.correctionReponse("Price 1,800 THB.", "Hello, I am assisting Mr. Fictif. Price 1,200 THB.", { exclure: (p) => /1,200/.test(p) });
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
  const r = T.ligneRetour({ reponse: "Hello Tom, the boat is 2,500 THB.\nPartenaire Fictif net 1,000/pax.\nCall +66 00 000 0000 or tom@mail.com.", raison: "Trop long pour Tom, et pas de prix sans source", contexte: "réponse de l'Assistant à : prix pour Tom Martin ?", noms: ["Tom Martin"] });
  assert.equal(r.ligne.genre, "retour");
  assert.ok(!/Tom|tom@|000 0000|1,000/.test(JSON.stringify(r.ligne)), JSON.stringify(r.ligne));
  assert.match(r.ligne.avant, /the boat is 2,500 THB/);
  assert.match(r.ligne.apres, /Trop long pour \{client\}/);
  assert.match(r.ligne.contexte, /prix pour \{client\}/);
  assert.ok(T.ligneRetour({ reponse: "a ".repeat(800), raison: "trop long" }).ligne.avant.length <= T.EXTRAIT_MAX);
});

// ---- Point A : correction de Nani dans WhatsApp -------------------------------------------------------------------------------
test("whatsapp : la règle de l'IA ouverte est celle de iaPermise", () => {
  const agents = { e1: true, e2: false };
  for (const conv of [null, { entite_id: "e1" }, { entite_id: "e2" }, { entite_id: null }, { entite_id: "e1", reponses: "jamais" }, { entite_id: "e2", type_contact: "partenaire" }, { entite_id: "e2", type_contact: "client", partenaire_id: "p1" }, { entite_id: "e1", ia_coupee: true }, { entite_id: "e1", telephone: null }, { entite_id: "e1", telephone: null, type_contact: "client" }])
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
  assert.equal(l.user_id, null, "réponse depuis l'app : aucun auteur connu");
  assert.equal(l.whatsapp_conversation_id, "c1", "la ligne est reliée à sa conversation");
  assert.match(l.apres, /assisting Mr\. \{nom\}/);
  assert.match(l.apres, /1,500 THB/, "un client confirmé garde ses prix (aucun n'est un net)");
  assert.ok(!/Tom|Fictif|000 0000/.test(JSON.stringify(l)), JSON.stringify(l));
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
    { id: "m1", conversation_id: "c1", sens: "sortant", origine: "app", type: "text", texte: "Hello Sarah Lee, your boat with Partenaire Fictif Tour leaves at 8, see you soon.", envoye_le: iso(T0 + 60_000) },
  ] });
  assert.deepEqual(await apprendreDeNani(noms, "c1", "m1"), { note: true });
  assert.ok(!/Sarah|Lee\b|Fictif/.test(noms.ecrits[0].apres), noms.ecrits[0].apres);
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
    [{ conv: { type_contact: "partenaire" } }, "pas_un_client"],
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
  assert.match(envoi, /  if \(demande\.proposition_id\) \{\n[^\n]*traitee_par_quoi: "gestion" \}\)[^\n]*\n[^\n]*propositions non soldées[^\n]*\n    apprendreEnFond\(admin, conv\.id, messageId, \{ auteur: qui\.user\.id \}\);\n  \}\n  return json\(\{ ok: true/);
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
    { id: "4", genre: "retour", contexte: "réponse de l'Assistant", avant: "Partenaire Fictif 1,200 per person.", apres: "Faux", cree_le: "2026-11-20" },
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
  assert.deepEqual(unifie.lignes.map((l) => [l.id, l.entreprise]), [["5", "Secret"], ["2", "Secret"]], "le net de Taxi (800) écarte sa réponse, son pickup n'est pas une réponse");
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
  assert.match(v, /surCree: \(\{ dossier, services, whatsappId \}\) => noterReussite\(c, \{ ok: true, dossier, ecran: services, whatsappId \}\)/);
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
  assert.match(r, /ligneRetour\(\{ reponse, raison, contexte, noms: m\.noms \|\| \[\], entiers: m\.entiers \|\| \[\], sansMontants, masquer, interne \}\)/);
  assert.match(r, /etat\.store\.agentNoterApprentissages\(entiteId, carteId, \[r\.ligne\]\)/);
  const v = lire("src/gestion/js/views/agent.mjs");
  // Bulle : à l'équipe, sans montant, tous les clients et partenaires chargés masqués, jamais la question tapée.
  assert.match(v, /boutonPasBien\(\{ entiteId: entiteDuFil\(\), reponse: it\.texte, contexte: "réponse de l'Assistant à l'équipe", masques: nomsDuFil, prix: prixConnus, sansMontants: true \}\)/);
  assert.match(v, /const nomsDuFil = \(\) => \{\n    const m = nomsAMasquer\(\);\n    return \{ noms: \[\.\.\.m\.noms, \.\.\.\[\.\.\.\(etat\.db\.clients/);
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
  assert.match(m, /\(source = 'outil' and user_id is not null and whatsapp_conversation_id is null and proposition_id is null\)\n  or \(source = 'whatsapp' and whatsapp_conversation_id is not null\)/);
  assert.match(m, /if auth\.uid\(\) is not null then\s+[^\n]*\n\s+new\.user_id := auth\.uid\(\);\s+new\.source := 'outil';\s+new\.proposition_id := null;\s+new\.whatsapp_conversation_id := null;/);
  assert.match(m, /elsif current_user in \('anon', 'authenticated'\) then\s+raise exception 'auteur_inconnu'/);
  assert.match(m, /create unique index if not exists agent_apprentissages_proposition on agent_apprentissages \(proposition_id\)/);
  assert.match(m, /whatsapp_conversation_id uuid references whatsapp_conversations \(id\) on delete cascade/);
  assert.ok(fs.existsSync(new URL("../docs/gestion/retour-74-apprentissages-nani.sql", import.meta.url)));
  assert.match(lire(".github/workflows/ci.yml"), /verif-agent-apprendre-nani/);
  // Branche d'intégration du 22.11.2026 (migrations 85, 100 et 105 à côté) : chaque numéro de migration reste unique, la 74 comprise.
  const numeros = fs.readdirSync(new URL("../docs/gestion/", import.meta.url)).map((f) => /^migration-(\d+)-/.exec(f)?.[1]).filter(Boolean);
  assert.equal(new Set(numeros).size, numeros.length);
  assert.equal(numeros.filter((x) => x === "74").length, 1);
});

// ---- Revue de sécurité de cette PR ---------------------------------------------------------------------------------------------
test("revue : « Pas bien » sur une bulle à l'équipe ne garde aucun montant, une marge chiffrée ou un gain ne passent jamais", () => {
  const bulle = "Vente 10 000 THB pour 4 personnes.\nMarge 6 000 THB.\nOn gagne bien sur ce bateau.\nLe pickup est prévu à 08:00 au Pimalai.";
  const r = T.ligneRetour({ reponse: bulle, raison: "Trop long", contexte: "réponse de l'Assistant à l'équipe", sansMontants: true });
  assert.equal(r.ligne.avant, "On gagne bien sur ce bateau. Le pickup est prévu à 08:00 au Pimalai.");
  assert.ok(!/10 000|6 000/.test(JSON.stringify(r.ligne)));
  assert.ok(T.phraseInterne("Marge 6 000 THB"), "marge chiffrée");
  assert.ok(T.phraseInterne("Le gain est bon"), "gain");
  assert.ok(T.phraseInterne("le partenaire nous reverse 500"), "reverse");
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
  assert.match(lire("supabase/functions/whatsapp/reponse.ts"), /lireApprentissages\(db, \{ active: ent, autre: unifie && autre \? autre : null, pourClient: true, qui: reglagesAssistant\(reglages \|\| \{\}\)\.responsable \|\| "" \}\)/);
});

test("revue : une remarque n'apprend que la ligne ajoutée qui reprend la remarque proposée, jamais les autres notes", () => {
  const modif = { genre: "modification", donnees: { reservation_id: "r1", libelle: "4 îles", champ: "remarque", avant: "", valeur: "Bagages : 2 valises" } };
  const notes = "Client végétarien\nChambre 214, allergie aux arachides\nLe partenaire encaisse 2 500\nBagages : 3 valises et une poussette";
  const l = correctionsDepuisCarte(modif, { reservation: { notes }, notesAvant: "Client végétarien" });
  assert.deepEqual(l.map((x) => [x.genre, x.apres]), [["remarque", "Bagages : 3 valises et une poussette"]]);
  // Aucune ligne ajoutée ne reprend la remarque : rien.
  assert.deepEqual(correctionsDepuisCarte(modif, { reservation: { notes: "Client végétarien\nChambre 214" }, notesAvant: "Client végétarien" }), []);
});

// ---- Relecture de la PR 312 : un test par constat -------------------------------------------------------------------------------
test("constat 1 : un montant dans la raison est rangé au clic (prix de vente gardé, net masqué, inconnu : une question)", () => {
  const ventes = new Set([2500, 1800]);
  const nets = new Set([900, 1800]);
  // Une heure, une durée, une date ou une quantité ne sont pas des montants.
  for (const t of ["Pickup à 15:00, pas 14:30", "Prévoir 15 min de plus", "120 min de route", "Le pickup est à 8h30", "Complet le 22.11.2026", "Pour 2 pax seulement", "Room 214B"]) assert.deepEqual(T.montantsEcrits(t), [], t);
  // Les petits montants avec une devise ou un « k » en sont (relecture : « 85 CHF », « 1.8k »).
  assert.deepEqual(T.montantsEcrits("85 CHF, 1.8k, ฿900, 1 200 THB, 45.5 EUR").map((m) => m.valeur), [85, 1800, 900, 1200, 45.5]);
  // a. Prix de vente connu : gardé tel quel.
  assert.deepEqual(T.rangerMontants("Le bon prix était 2,500", { ventes, nets }), { nets: [], ventes: [2500], inconnus: [] });
  const a = T.ligneRetour({ reponse: "x", raison: "Le bon prix était 2,500", masquer: [] });
  assert.equal(a.ligne.apres, "Le bon prix était 2,500");
  assert.equal(a.ligne.interne, undefined);
  // b. Net connu : masqué, même s'il est aussi un prix de vente (on ferme).
  assert.deepEqual(T.rangerMontants("Le bateau nous coûte 900, le transfert 1,800", { ventes, nets }), { nets: [900, 1800], ventes: [], inconnus: [] });
  const b = T.ligneRetour({ reponse: "x", raison: "Le bateau nous coûte 900, le transfert 1,800", masquer: [900, 1800] });
  assert.equal(b.ligne.apres, "Le bateau nous coûte {montant}, le transfert {montant}");
  // c. Connu nulle part : une question. « prix pour le client » garde la raison, « prix d'achat » rend la ligne interne et masque tout.
  assert.deepEqual(T.rangerMontants("Il fallait dire 3,200", { ventes, nets }), { nets: [], ventes: [], inconnus: [3200] });
  const client = T.ligneRetour({ reponse: "Le bateau est à 2,500.", raison: "Il fallait dire 3,200", masquer: [] });
  assert.equal(client.ligne.apres, "Il fallait dire 3,200");
  const achat = T.ligneRetour({ reponse: "Le bateau est à 2,500.", raison: "Il fallait dire 3,200", interne: true });
  assert.equal(achat.ligne.interne, true);
  assert.equal(achat.ligne.apres, "Il fallait dire {montant}");
  assert.equal(achat.ligne.avant, "Le bateau est à {montant}.");
  // Sans le droit des nets : un montant qui serait un net tombe dans le cas c (question).
  assert.deepEqual(T.rangerMontants("Le bateau nous coûte 900", { ventes, nets: null }), { nets: [], ventes: [], inconnus: [900] });
  // L'écran : la question dans la zone du bouton, libellés traduits.
  const r = lire("src/gestion/js/views/agent-retour.mjs");
  assert.match(r, /const rang = rangerMontants\(anonymiser\(raison, m\.noms \|\| \[\], m\.entiers \|\| \[\]\), prix\(\) \|\| \{\}\);/);
  assert.match(r, /if \(!rang\.inconnus\.length\) return enregistrer\(raison, \{ masquer: rang\.nets, interne: false \}, retour\);/);
  assert.match(r, /zone\.replaceChildren\(question\(rang\.inconnus/);
  assert.match(r, /tr\("prix pour le client"\)/);
  assert.match(r, /tr\("prix d'achat \(interne\)"\)/);
  const en = lire("src/gestion/js/i18n-en.mjs");
  for (const t of ["Ce montant est :", "Ce montant est : {liste}", "Ces montants sont : {liste}", "prix pour le client", "prix d'achat (interne)", "interne"]) assert.ok(en.includes(`"${t}":`), t);
  // Les prix connus : catalogue, cartes, dossier relié, montants tapés (PR 306) ; les nets seulement avec le droit.
  const v = lire("src/gestion/js/views/agent.mjs");
  assert.match(v, /if \(!\(permissionsDe\(ent\) \|\| \[\]\)\.includes\("partenaires\.nets"\)\) return \{ ventes, nets: null \};/);
  assert.match(v, /masques: nomsDuFil, prix: prixConnus, sansMontants: true/);
  assert.match(v, /masques: \(\) => nomsAMasquer\(c\), prix: prixConnus, carteId: c\.id/);
});

test("constat 1 : une ligne interne n'entre dans aucun prompt (vue sans lignes internes, seule source des fonctions)", async () => {
  const lignes = [
    { id: "1", entite_id: SECRET, genre: "retour", contexte: "réponse de l'Assistant à l'équipe", avant: "x", apres: "Coût {montant}", interne: true, cree_le: "2026-11-21" },
    { id: "2", entite_id: SECRET, genre: "retour", contexte: "réponse au client préparée par l'Assistant", avant: "Hello", apres: "Trop long", interne: false, cree_le: "2026-11-20" },
  ];
  const db = fauxDb({ agent_apprentissages: lignes, prestations_nets: [], trajets_nets: [] });
  // Assistant et boîte WhatsApp lisent par lireApprentissages, qui ne lit que la vue.
  assert.deepEqual((await lireApprentissages(db, { active: { id: SECRET } })).lignes.map((l) => l.id), ["2"]);
  assert.deepEqual((await lireApprentissages(db, { active: { id: SECRET }, pourClient: true })).lignes.map((l) => l.id), ["2"]);
  assert.match(lire("supabase/functions/agent/apprentissages.js"), /export const VUE_POUR_IA = "agent_apprentissages_pour_ia";/);
  // Aucun fichier de supabase/functions ne lit encore la table en select direct (l'insert reste permis).
  const fichiers = (d) => fs.readdirSync(new URL(`../${d}`, import.meta.url), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? fichiers(`${d}/${e.name}`) : /\.(?:js|ts|mjs)$/.test(e.name) ? [`${d}/${e.name}`] : []));
  const lectures = [];
  for (const f of fichiers("supabase/functions")) {
    const src = lire(f);
    for (const m of src.matchAll(/from\(\s*["'`]agent_apprentissages["'`]\s*\)\s*\.(\w+)/g)) if (m[1] !== "insert") lectures.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(lectures, []);
  assert.match(lire("supabase/functions/agent/apprendre-whatsapp.js"), /from\("agent_apprentissages"\)\.insert\(/);
  // Les deux prompts passent par lireApprentissages.
  assert.match(lire("supabase/functions/agent/index.ts"), /await lireApprentissages\(sb,/);
  assert.match(lire("supabase/functions/whatsapp/reponse.ts"), /await lireApprentissages\(db,/);
  // La base : colonne, masquage par le déclencheur, vue security_invoker.
  const m = lire("docs/gestion/migration-74-apprentissages-nani.sql");
  assert.match(m, /add column if not exists interne boolean not null default false/);
  assert.match(m, /if new\.interne then\s+new\.contexte := regexp_replace\(new\.contexte, '.+?', '\{montant\}', 'g'\);\s+new\.avant := [^\n]*\n\s+new\.apres := /);
  assert.match(m, /create view agent_apprentissages_pour_ia with \(security_invoker = true\) as[\s\S]{0,240}from agent_apprentissages where not interne;/);
  // L'écran de suivi la montre avec un badge.
  assert.match(lire("src/gestion/js/views/assistant-suivi.mjs"), /l\.interne \? h\("span", \{ class: "as-appris-interne", title: tr\("Jamais relue par l'assistant"\) \}, tr\("interne"\)\)/);
});

test("constat 2 : l'oubli passe par la conversation (cascade), plus par la réponse préparée purgée à 90 jours", async () => {
  const m = lire("docs/gestion/migration-74-apprentissages-nani.sql");
  assert.match(m, /add column if not exists whatsapp_conversation_id uuid references whatsapp_conversations \(id\) on delete cascade/);
  assert.match(m, /delete from agent_apprentissages where whatsapp_conversation_id = new\.id;/);
  assert.match(m, /delete from agent_apprentissages where source = 'whatsapp' and whatsapp_conversation_id is null;/);
  assert.match(m, /raise exception 'conversation_requise'/);
  assert.match(m, /raise exception 'conversation_autre_entreprise'/);
  // La fonction la remplit.
  const db = scene();
  await apprendreDeNani(db, "c1", "m1");
  assert.equal(db.ecrits[0].whatsapp_conversation_id, "c1");
});

test("constat 3 : le nom d'un partenaire se masque en entier, le nom du client mot par mot sans les mots courants", () => {
  // Nom du client qui contient des mots courants : seuls ses vrais mots sont masqués.
  const t = T.anonymiser("The speed boat taxi to Koh Lanta de la plage is ready, Martin", ["Speed Boat Taxi Martin", "Léa de la Rosa"]);
  assert.equal(t, "The speed boat taxi to Koh Lanta de la plage is ready, {client}");
  assert.equal(T.anonymiser("Hello LÉA and Lea", ["Léa"]), "Hello {client} and {client}", "casse et accents");
  assert.equal(T.anonymiser("Al and Bo", ["Al Bo"]), "Al and Bo", "un mot de deux lettres n'est jamais masqué");
  // Partenaire : l'expression entière, insensible à la casse et aux accents ; un mot seul du nom reste.
  assert.equal(T.anonymiser("Partenaire Fictif Tour, PARTENAIRE FICTIF TOUR et Partenaire Fíctif Tour ; Fictif seul, tour du lac", [], ["Partenaire Fictif Tour"]), "{partenaire}, {partenaire} et {partenaire} ; Fictif seul, tour du lac");
  assert.equal(T.anonymiser("Book the Speed Boat Lanta now, the speed boat leaves at 8", [], ["Speed Boat Lanta"]), "Book the {partenaire} now, the speed boat leaves at 8");
  // Côté serveur : partenaires et contacts typés en entier.
  const l = ligneDeNani({ proposition: { texte: "Hello, the boat leaves at 8.", langue: "en" }, message: { texte: "Hello, the speed boat of Partenaire Fictif Tour leaves at 8 from Koh Lanta." }, noms: ["Tom Lanta"], entiers: ["Partenaire Fictif Tour"] });
  assert.equal(l.apres, "Hello, the speed boat of {partenaire} leaves at 8 from Koh Lanta.");
});

test("constat 4 : pour apprendre des montants, il faut un client typé ou une fiche client, pas un dossier seul", async () => {
  const base = { type_contact: null, partenaire_id: null, reponses: "auto", client_id: null, dossier_id: "d1" };
  assert.equal(clientConfirme(base), true, "clientConfirme ne change pas pour ses autres appelants");
  assert.equal(clientPourApprendre(base), false, "un concierge non typé relié à un dossier n'apprend pas de montant");
  assert.equal(clientPourApprendre({ ...base, client_id: "cl1" }), true);
  assert.equal(clientPourApprendre({ ...base, dossier_id: null, type_contact: "client" }), true);
  assert.equal(clientPourApprendre({ ...base, type_contact: "apporteur" }), false);
  const db = scene({ conv: { type_contact: null, dossier_id: "d1" } });
  assert.deepEqual(await apprendreDeNani(db, "c1", "m1"), { note: true });
  assert.ok(!/1,500|THB/.test(db.ecrits[0].apres), db.ecrits[0].apres);
});

test("constat 5 : une remarque apprise est la remarque retouchée (70 % de ses mots), sans montant ni net du dossier", () => {
  const modif = { genre: "modification", donnees: { reservation_id: "r1", libelle: "4 îles", champ: "remarque", avant: "", valeur: "Bagages : 2 grandes valises" } };
  const avec = (notes, opts = {}) => correctionsDepuisCarte(modif, { reservation: { notes }, notesAvant: "Client végétarien" }, opts);
  // Un seul mot commun ne suffit plus.
  assert.equal(remarqueGardee("Bagages : 2 grandes valises", "", "Bagages perdus à l'aéroport, chambre 214"), null);
  assert.deepEqual(avec("Client végétarien\nBagages perdus, chambre 214"), []);
  assert.deepEqual(avec("Client végétarien\nBagages : 3 grandes valises et une poussette").map((x) => x.apres), ["Bagages : 3 grandes valises et une poussette"]);
  // Un montant, ou un nombre égal à un net du dossier : rien.
  assert.deepEqual(avec("Client végétarien\nBagages : 2 grandes valises, supplément 500"), []);
  assert.deepEqual(avec("Client végétarien\nBagages : 80 grandes valises", { nets: new Set([80]) }), []);
  assert.equal(avec("Client végétarien\nBagages : 80 grandes valises").length, 1, "(témoin) sans net égal, la remarque passe");
  const v = lire("src/gestion/js/views/agent.mjs");
  assert.match(v, /correctionsDepuisCarte\(c, vu, \{ \.\.\.nomsAMasquer\(c, idNoms\), nets: idNoms \? netsDuDossier\(idNoms\) : new Set\(\) \}\)/);
});

test("constat 6 : « Pas bien » sur une carte client masque aussi les partenaires, en entier", () => {
  const v = lire("src/gestion/js/views/agent.mjs");
  assert.match(v, /\.\.\.\(etat\.brut\.partenaires \|\| \[\]\)\.map\(\(x\) => x\.nom\),\n[^\n]*\n\s+\.\.\.\(etat\.brut\.whatsapp_conversations \|\| \[\]\)\.filter\(typee\)\.map\(\(x\) => \(\{ nom: x\.nom, personne: true \}\)\),/);
  assert.match(v, /masques: \(\) => nomsAMasquer\(c\), prix: prixConnus, carteId: c\.id \}\)/);
  const r = T.ligneRetour({ reponse: "Hello, your boat with Partenaire Fictif Tour leaves at 8.", raison: "Ne cite pas Partenaire Fictif Tour", contexte: "réponse au client préparée par l'Assistant", entiers: ["Partenaire Fictif Tour"] });
  assert.ok(!/Fictif/.test(JSON.stringify(r.ligne)), JSON.stringify(r.ligne));
});

test("constat 7 : l'auteur réel d'un envoi depuis Gestion, « l'équipe » pour l'app, le nom dit dans le prompt", async () => {
  // Envoi depuis Gestion : la personne passée par whatsapp-envoi.
  const gestion = scene({ messages: [
    { id: "m0", conversation_id: "c1", sens: "entrant", origine: "client", type: "text", texte: "Hi", envoye_le: iso(T0 - 60_000) },
    { id: "m1", conversation_id: "c1", sens: "sortant", origine: "gestion", type: "text", texte: NANI, envoye_le: iso(T0 + 60_000) },
  ] });
  await apprendreDeNani(gestion, "c1", "m1", { auteur: "u-un" });
  assert.equal(gestion.ecrits[0].user_id, "u-un");
  // Depuis l'app : jamais un auteur, même si on en passe un.
  const app = scene();
  await apprendreDeNani(app, "c1", "m1", { auteur: "u-un" });
  assert.equal(app.ecrits[0].user_id, null);
  // Le nom dans le prompt.
  const profils = new Map([["u-un", "Profil Un"], ["u-deux", "Profil Deux"]]);
  assert.equal(auteurDe({ source: "whatsapp", user_id: null }, { profils, qui: "Nani" }), EQUIPE);
  assert.equal(auteurDe({ source: "whatsapp", user_id: "u-deux" }, { profils, qui: "Nani" }), "Profil Deux");
  assert.equal(auteurDe({ source: "outil", user_id: "u-un" }, { profils, qui: "Profil" }), "Profil", "la responsable garde son nom des réglages");
  assert.equal(auteurDe({ source: "outil", user_id: "inconnu" }, { profils, qui: "Nani" }), EQUIPE);
  const b = blocApprentissages([{ id: "1", genre: "reponse", contexte: "réponse WhatsApp en anglais", avant: "Dear client", apres: "Hello", auteur: EQUIPE, cree_le: "2026-11-20" }, { id: "2", genre: "pickup", contexte: "x", avant: "10:00", apres: "09:45", auteur: "Profil Deux", cree_le: "2026-11-20" }], { qui: "Nani" });
  assert.match(b, /l'équipe a mis « Hello »/);
  assert.match(b, /Profil Deux a mis « 09:45 »/);
  assert.doesNotMatch(b, /Nani a mis/);
  assert.match(lire("supabase/functions/whatsapp-envoi/index.ts"), /if \(demande\.proposition_id\) \{\n[\s\S]{0,400}?    apprendreEnFond\(admin, conv\.id, messageId, \{ auteur: qui\.user\.id \}\);\n  \}/);
  assert.match(lire("docs/gestion/migration-74-apprentissages-nani.sql"), /raise exception 'auteur_autre_organisation'/);
});

test("constat 7 : lireApprentissages nomme l'auteur de chaque ligne", async () => {
  const db = fauxDb({
    agent_apprentissages: [
      { id: "1", entite_id: SECRET, genre: "reponse", contexte: "réponse WhatsApp en anglais", avant: "Dear", apres: "Hi", source: "whatsapp", user_id: null, cree_le: "2026-11-20" },
      { id: "2", entite_id: SECRET, genre: "pickup", contexte: "x", avant: "10:00", apres: "09:45", source: "outil", user_id: "u-deux", cree_le: "2026-11-19" },
    ],
    profils: [{ user_id: "u-deux", nom: "Profil Deux" }],
    prestations_nets: [],
    trajets_nets: [],
  });
  const { lignes } = await lireApprentissages(db, { active: { id: SECRET }, qui: "Nani" });
  assert.deepEqual(lignes.map((l) => [l.id, l.auteur]), [["1", EQUIPE], ["2", "Profil Deux"]]);
  assert.ok(lignes.every((l) => !("user_id" in l)), "l'identifiant ne part pas dans le prompt");
});

test("constat 8 : les messages lus sont les plus récents de la fenêtre, remis dans l'ordre", async () => {
  // 250 vieux messages courts de Nani, puis le client réécrit juste avant le message de Nani : il doit être vu.
  const vieux = Array.from({ length: 250 }, (_, i) => ({ id: `v${String(i).padStart(3, "0")}`, conversation_id: "c1", sens: "sortant", origine: "app", type: "text", texte: "ok", envoye_le: iso(T0 + 1000 + i) }));
  const messages = [
    { id: "m0", conversation_id: "c1", sens: "entrant", origine: "client", type: "text", texte: "Hi", envoye_le: iso(T0 - 60_000) },
    ...vieux,
    { id: "mx", conversation_id: "c1", sens: "entrant", origine: "client", type: "text", texte: "And for 4 people?", envoye_le: iso(T0 + 500_000) },
    { id: "m1", conversation_id: "c1", sens: "sortant", origine: "app", type: "text", texte: NANI, envoye_le: iso(T0 + 600_000) },
  ];
  assert.deepEqual(await apprendreDeNani(scene({ messages }), "c1", "m1"), { rien: "rien_a_comparer" });
  assert.match(lire("supabase/functions/agent/apprendre-whatsapp.js"), /\.order\("envoye_le", \{ ascending: false \}\)\.limit\(200\)(?:, "id, sens, origine, type, texte, envoye_le, supprime_le"\))?;[\s\S]{0,120}const messages = \[\.\.\.\(recents \|\| \[\]\)\]\.reverse\(\);/);
});

test("contre-vérification : un contact typé est masqué aussi par son prénom, un nom d'un seul mot courant ne masque rien", () => {
  assert.equal(T.anonymiser("Fictivo will pick you up at 8", [], [{ nom: "Fictivo (driver)", personne: true }]), "{partenaire} will pick you up at 8");
  assert.equal(T.anonymiser("Fictiva will call you", [], [{ nom: "Fictiva 🌺", personne: true }]), "{partenaire} will call you");
  assert.equal(T.anonymiser("Personne will send the voucher", [], [{ nom: "Personne Fictive", personne: true }]), "{partenaire} will send the voucher");
  // Un partenaire avec un suffixe : sa forme nettoyée aussi.
  assert.equal(T.anonymiser("Book Agence Fictive now", [], ["Agence Fictive (Krabi) 🌴"]), "Book {partenaire} now");
  // « Taxi » ou « Lanta » comme nom de contact ne vident pas les exemples.
  assert.equal(T.anonymiser("The taxi from Lanta is ready", [], ["Taxi", { nom: "Lanta", personne: true }]), "The taxi from Lanta is ready");
  // Une remarque gardée n'est pas plus de deux fois plus longue que la remarque proposée.
  assert.equal(remarqueGardee("Vegan", "", "Vegan, diabète type 1, chambre au rez"), null);
});

// ---- Contre-vérification de la relecture (constats A à H) ---------------------------------------------------------------------------
test("contre-vérification A : un net de la raison est reconnu partout (collé, petit, sans devise) et masqué", () => {
  const prix = { ventes: new Set([2500]), nets: new Set([1200, 85]) };
  for (const [raison, attendu] of [
    ["Il fallait 2,500/1,200", "Il fallait 2,500/{montant}"],
    ["Fourchette 2,500-1,200 THB", "Fourchette 2,500-{montant} THB"],
    ["2x1200 pour le groupe", "2x{montant} pour le groupe"],
    ["Le prix 1200B", "Le prix {montant}B"],
    ["net1200 ici", "net{montant} ici"],
    ["Ça nous coûte 85", "Ça nous coûte {montant}"],
  ]) {
    const r = T.rangerMontants(raison, prix);
    assert.ok(r.nets.length > 0, raison);
    assert.equal(T.masquerMontants(raison, r.nets), attendu, raison);
  }
  // « 1  200 » (double espace) : resserré avant le rangement, comme la ligne gardée.
  assert.deepEqual(T.rangerMontants(T.propre("Le prix 1  200"), prix).nets, [1200]);
  assert.match(lire("src/gestion/js/views/agent-retour.mjs"), /const raison = propre\(champ\.value\);/);
  // Un nombre de 100 ou plus collé à « / », « - » ou « x » et connu nulle part : une question.
  assert.deepEqual(T.rangerMontants("2,500/3,300", prix), { nets: [], ventes: [2500], inconnus: [3300] });
  // À la lecture et côté serveur aussi : un nombre brut égal à un net écarte la ligne ou la phrase.
  assert.deepEqual(sansNets([{ id: "1", contexte: "", avant: "x", apres: "2x1200 pour le groupe" }], { nets: [{ montant: 1200 }] }), []);
  const l = ligneDeNani({ proposition: { texte: "Hello, the boat is ready.", langue: "en" }, message: { texte: "Hello, the boat is ready at the pier. Price 2x1200 for you." }, nets: new Set([1200]) });
  assert.ok(!/1200/.test(JSON.stringify(l)), JSON.stringify(l));
});

test("contre-vérification B : un mot seul n'est masqué qu'avec sa majuscule ; un nom marqué « pas une personne » seulement en entier", () => {
  assert.equal(T.anonymiser("Please book the boat, Book will drive", [], [{ nom: "Book (driver)", personne: true }]), "Please book the boat, {partenaire} will drive");
  assert.equal(T.anonymiser("air con ok, Air is here", [], [{ nom: "Air", personne: true }]), "air con ok, {partenaire} is here");
  assert.equal(T.anonymiser("you may pay, May said ok, he will come", ["Will May"]), "you may pay, {client} said ok, he will come");
  // Une expression de plusieurs mots reste insensible à la casse.
  assert.equal(T.anonymiser("AGENCE FICTIVE et agence fictive", [], ["Agence Fictive"]), "{partenaire} et {partenaire}");
  // Un nom marqué « pas une personne » n'est masqué qu'en entier : « Ban Saladan pier » reste.
  assert.equal(T.anonymiser("Ban Saladan pier, Ban Hotel Fictif", [], [{ nom: "Ban Hotel Fictif", personne: false }]), "Ban Saladan pier, {partenaire}");
  // Migration 110 : plus de type « hôtel », un contact typé est toujours une personne (aussi mot par mot).
  assert.match(lire("src/gestion/js/views/agent.mjs"), /\.filter\(typee\)\.map\(\(x\) => \(\{ nom: x\.nom, personne: true \}\)\)/);
  assert.match(lire("supabase/functions/agent/apprendre-whatsapp.js"), /typees\.map\(\(c\) => \(\{ nom: c\.nom\.trim\(\), personne: true \}\)\)/);
  assert.doesNotMatch(lire("src/gestion/js/views/agent.mjs") + lire("supabase/functions/agent/apprendre-whatsapp.js"), /type_contact !== "hotel"/);
});

test("contre-vérification C : un seul choix possible à la question (les trois boutons se désactivent au premier clic)", () => {
  const r = lire("src/gestion/js/views/agent-retour.mjs");
  assert.match(r, /if \(tous\(\)\.some\(\(b\) => b\.disabled\)\) return;\n\s+for \(const b of tous\(\)\) b\.disabled = true;/);
  assert.match(r, /onclick: une\(\(\) => choisir\(false\)\)/);
  assert.match(r, /onclick: une\(\(\) => choisir\(true\)\)/);
  assert.match(r, /onclick: une\(annuler\)/);
});

test("contre-vérification D et G : la base refuse une écriture sur une conversation qui n'est plus un client, purge à part des lignes internes", () => {
  const m = lire("docs/gestion/migration-74-apprentissages-nani.sql");
  assert.match(m, /raise exception 'conversation_pas_client'/);
  assert.match(m, /partition by entite_id, interne order by cree_le desc/);
  assert.match(lire("docs/gestion/retour-74-apprentissages-nani.sql"), /partition by entite_id order by cree_le desc/);
});

test("contre-vérification E : l'en-tête du bloc dit « l'équipe » quand les lignes ne sont pas toutes de la responsable", () => {
  const lignes = [{ id: "1", genre: "pickup", contexte: "x", avant: "10:00", apres: "09:45", auteur: "Profil Deux", cree_le: "2026-11-20" }];
  assert.match(blocApprentissages(lignes, { qui: "Nani" }), /^Corrections récentes de l'équipe sur tes propositions\. Ce sont leurs préférences/);
  assert.match(blocApprentissages([{ ...lignes[0], auteur: "Nani" }], { qui: "Nani" }), /^Corrections récentes de Nani sur tes propositions\. Ce sont ses préférences/);
});

test("contre-vérification F : une année, un numéro de chambre ou de vol ne sont pas des montants", () => {
  for (const t of ["Complet en 2026", "Room 214", "chambre 305", "vol TG 2034", "flight 1234"]) assert.deepEqual(T.montantsEcrits(t), [], t);
  assert.deepEqual(T.montantsEcrits("2026 THB").map((m) => m.valeur), [2026], "avec une devise, c'est un montant");
});

test("contre-vérification H : un prénom composé est masqué aussi par ses parties", () => {
  assert.equal(T.anonymiser("Jean will come, Jean-Pierre too, Pierre also", ["Jean-Pierre Fictif"]), "{client} will come, {client} too, {client} also");
});
