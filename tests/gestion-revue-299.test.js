// Revue de sécurité de la PR 299 (l'IA lit aussi les partenaires, migration 69) : ce qu'un partenaire écrit ne passe jamais dans une
// réponse au client. Montants joints jamais « tapés », montants et noms des contacts typés retenus par le contrôle, nets de l'Assistant,
// ton sans contact personnel, « Préparer une réponse » refusé pour un contact personnel, réponse à un partenaire, promesses, historique.
import test from "node:test";
import assert from "node:assert/strict";
import { bloqueMontant } from "./aides-nets.mjs";
import { readFileSync } from "node:fs";
import * as L from "../supabase/functions/agent/whatsapp-lecture.js";
import { controlerReponse, executer, memoDepuis, netsPourControle, proposer, retenirLecture, retenirLectures, retenuDeLecture, sansConversation } from "../supabase/functions/agent/outils.js";
import { nomsContactsTypes } from "../supabase/functions/agent/apporteur.js";
import { CONSIGNE_PARTENAIRE, demandeAgent, promptPreparation } from "../supabase/functions/whatsapp/proposer.js";
import { sansChiffres, tachePromesse } from "../supabase/functions/whatsapp/suivi.js";
import { texteDepuisWhatsApp } from "../supabase/functions/agent/whatsapp.js";
import * as W from "../src/gestion/js/whatsapp-calc.mjs";
import { EN } from "../src/gestion/js/i18n-en.mjs";

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const SECRET = { id: id(), slug: "secret" };
const ENTITES = [SECRET];
const conv = (o = {}) => ({ id: id(), telephone: "+66810000001", nom: "Blue Ocean", entite_id: SECRET.id, reponses: "auto", type_contact: "partenaire", dernier_message_le: "2026-11-21T05:00:00Z", dernier_sens: "entrant", non_lus: 1, dernier_texte: "net 1,350 per pax", attend_depuis: "2026-11-21T05:00:00Z", ...o });
const msg = (c, texte, o = {}) => ({ id: id(), conversation_id: c.id, sens: "entrant", type: "text", texte, medias: [], envoye_le: "2026-11-21T05:00:00Z", ...o });
const repondre = (memo, message) => proposer("proposer_reponse", { titre: "Réponse", message, langue: "en", destinataire: "" }, {}, memo);
const avert = async (memo, message) => (await repondre(memo, message)).avertissements;

// ---- 1. Un net de partenaire n'est jamais « sourcé » par le texte joint ---------------------------------------------------------------
test("point 1 : le bloc <conversation> joint n'est jamais tapé ; seuls le texte de la personne et sa <question> comptent", () => {
  const blue = conv();
  const joint = texteDepuisWhatsApp({ mode: "question", conv: blue, messages: [msg(blue, "Blue Ocean speedboat, net 1,350 per pax")], question: "Le client paie 1 800 ?" });
  assert.match(joint, /<question>\nLe client paie 1 800 \?\n<\/question>/);
  assert.doesNotMatch(sansConversation(joint), /1,350/);
  const memo = memoDepuis([{ role: "user", content: [{ type: "text", text: joint }] }]);
  assert.ok(memo.tapes.has(1800), "la question compte");
  assert.ok(!memo.tapes.has(1350), "le texte joint ne compte pas");
  // Historique compris : un échange joint à un message précédent ne compte pas non plus.
  const hist = memoDepuis([{ role: "user", content: [{ type: "text", text: joint }] }, { role: "assistant", content: [{ type: "text", text: "ok" }] }, { role: "user", content: "Réponds-lui." }]);
  assert.ok(!hist.tapes.has(1350));
  // Un bloc non fermé (texte coupé) ne compte pas davantage.
  assert.ok(!memoDepuis([{ role: "user", content: "a <conversation> net 1,350" }]).tapes.has(1350));
});

test("point 1 : scénario Blue Ocean, « net 1,350 per pax » joint, « Hi Tom… 1,350 THB » est bloqué (montant_interne)", async () => {
  const blue = conv();
  const joint = texteDepuisWhatsApp({ mode: "question", conv: blue, messages: [msg(blue, "Blue Ocean speedboat Friday, net 1,350 per pax")], question: "Prépare la réponse pour Tom" });
  const memo = memoDepuis([{ role: "user", content: [{ type: "text", text: joint }] }], { conversationInterne: true });
  assert.ok(memo.internes.has(1350));
  const a = await avert(memo, "Hi Tom, the speedboat on Friday is 1,350 THB per person.");
  assert.ok(bloqueMontant(a, 1350), JSON.stringify(a));
  // Même montant égal au prix de vente d'un service rendu par un outil (avec sa référence) : permis. Un prix sans service ne lève plus
  // rien (revue de la PR 306).
  const vente = memoDepuis([{ role: "user", content: [{ type: "text", text: joint }] }], { conversationInterne: true });
  vente.prix.add(1350);
  vente.prixServices.add(1350);
  assert.ok(!(await avert(vente, "Hi Tom, 1,350 THB per person.")).some((x) => x.startsWith("montant_interne")));
  // La conversation d'un client confirmé : ses montants ne deviennent pas internes, même près de « net » (une ligne « [Client … », revue de
  // la PR 306), mais ne sont pas sourcés non plus. Un contact qui n'est pas un client confirmé : sa ligne compte.
  assert.ok(memoDepuis([{ role: "user", content: [{ type: "text", text: joint }] }]).internes.has(1350));
  const client = memoDepuis([{ role: "user", content: [{ type: "text", text: joint }] }], { conversationClient: true });
  assert.ok(!client.internes.has(1350));
  assert.ok((await avert(client, "Hi Tom, 1,350 THB per person.")).includes("montant_non_source:1350"));
});

// ---- 2. Lectures de la boîte et nets dans l'Assistant -------------------------------------------------------------------------------
test("point 2 : lire_conversation et chercher_conversations d'un partenaire rendent ses montants internes (migration 110 : un chauffeur est un partenaire)", async () => {
  for (const type of ["partenaire"]) {
    const c = conv({ type_contact: type, nom: `Contact ${type}` });
    const ctx = {
      whatsapp: { permis: true, slug: "secret", qui: "Nani", candidats: async () => ({ conversations: [c], entites: ENTITES, trouves: [{ conversation_id: c.id, message_id: id(), extrait: "kids net 950", envoye_le: "2026-11-21T05:00:00Z" }] }), conversation: async () => ({ conversation: c, messages: [msg(c, "net 1,350 per pax, commission 200")], entites: ENTITES }), aFaire: async () => ({ conversations: [] }) },
      maintenant: () => Date.parse("2026-11-21T06:00:00Z"),
    };
    const memo = memoDepuis([]);
    const l = await executer("lire_conversation", { conversation: c.id }, ctx, memo);
    assert.equal(l.contenu.contact, type, "le type du contact est rendu");
    assert.ok(memo.internes.has(1350) && memo.internes.has(200), type);
    const memo2 = memoDepuis([]);
    await executer("chercher_conversations", { texte: "net" }, ctx, memo2);
    assert.ok(memo2.internes.has(950) && memo2.internes.has(1350), `${type} : extraits et dernier message`);
    assert.ok(bloqueMontant((await avert(memo, "Hi Tom, it is 1,350 THB.")), 1350));
  }
  // Un client ou un apporteur : ses montants ne sont pas des nets.
  for (const type of ["client", "apporteur", null]) {
    const c = conv({ type_contact: type });
    const memo = memoDepuis([]);
    retenirLecture(L.lireConversation({ conversation: c.id }, { conversation: c, messages: [msg(c, "budget 1,350")] }), memo);
    assert.ok(!memo.internes.has(1350), String(type));
  }
  // L'historique : une lecture d'un échange précédent (avant son retrait pour Claude) reste retenue.
  const c = conv();
  const res = JSON.stringify(L.lireConversation({ conversation: c.id }, { conversation: c, messages: [msg(c, "net 1,350")] }));
  const gardes = [{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "lire_conversation", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: res }] }];
  const memo = memoDepuis(L.retirerLecturesWhatsApp(gardes));
  assert.ok(!memo.internes.has(1350), "retirée pour Claude");
  retenirLectures(gardes, memo);
  assert.ok(memo.internes.has(1350) && memo.prestataires.includes("Blue Ocean"), "retenue par le contrôle");
});

test("point 2 : les nets de l'Assistant sont lus pour le contrôle seulement, jamais rendus ni envoyés chez Claude", async () => {
  // La lecture : prestations_nets et trajets_nets des entreprises données, chaque net avec son service (21.11.2026).
  const appels = [];
  const db = {
    from: (table) => ({
      select: (cols) => ({
        in: (col, ids) => ({
          range: async () => {
            appels.push([table, cols, col, ids]);
            return { data: table === "prestations_nets" ? [{ prestation_id: "p1", net: 1100, net_enfant: 550 }, { prestation_id: "p2", net: null }] : [{ trajet_id: "t1", net_adulte: 1350, net_enfant: 0 }], error: null };
          },
        }),
      }),
    }),
  };
  const { nets: s, erreur } = await netsPourControle(db, ["e1", "e2"]);
  assert.equal(erreur, false);
  assert.deepEqual(s, [{ montant: 1100, prestation_id: "p1", genre: "adulte" }, { montant: 550, prestation_id: "p1", genre: "enfant" }, { montant: 1350, trajet_id: "t1", genre: "adulte" }]);
  assert.deepEqual(appels.map((x) => x[0]).sort(), ["prestations_nets", "trajets_nets"]);
  assert.ok(appels.every((x) => x[2] === "entite_id" && x[3].join() === "e1,e2"));
  assert.equal((await netsPourControle(db, [])).nets.length, 0);
  // Revue de la PR 306 : une lecture en erreur le dit (le contrôle se ferme).
  const enPanne = { from: () => ({ select: () => ({ in: () => ({ range: async () => ({ data: null, error: { message: "x" } }) }) }) }) };
  assert.equal((await netsPourControle(enPanne, ["e1"])).erreur, true);
  // La fonction « agent » : clé de service, entreprises de la conversation (les deux en espace unifié), seulement dans memo.internes.
  const ts = lire("supabase/functions/agent/index.ts");
  assert.equal((ts.match(/netsPourControle\(/g) || []).length, 1);
  // Lus une fois (migration 74 : avant les apprentissages, qu'ils filtrent), puis seulement dans memo.nets.
  assert.match(ts, /const lusNets = await netsPourControle\(admin, idsEntites\);\n  const lus = await lireApprentissages\(sb, \{ dbNets: admin,[^\n]*nets: lusNets, qui: ra\.responsable \|\| "" \}\);/);
  assert.match(ts, /\n  memo\.nets = lusNets\.nets;/);
  assert.match(ts, /memo\.controleImpossible = lusNets\.erreur;/);
  assert.match(ts, /const relie = await dossierPourControle\(admin, conv!\.dossier_id, idsEntites\);/);
  assert.match(ts, /memo\.servicesEnCours = new Set\(\[\.\.\.relie\.services, \.\.\.\(relieWa\?\.services \?\? \[\]\)\]\);/);
  assert.match(ts, /const relieWa = waLue && waLue\.dossier_id && waLue\.dossier_id !== conv!\.dossier_id \? await dossierPourControle\(admin, waLue\.dossier_id, idsEntites\) : null;/);
  assert.match(ts, /const idsEntites = unifie \? unifie\.entites\.map\(\(e\) => e\.id\) : \[entiteId\];/);
  // memo.internes, memo.nets et memo.servicesEnCours ne partent ni dans les consignes, ni dans les messages, ni dans un résultat d'outil,
  // ni vers l'écran.
  const code = ts.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.deepEqual(code.match(/memo\.internes\S*/g), ["memo.internes.add(n);"], "memo.internes n'est que rempli");
  assert.deepEqual(code.match(/memo\.(?:nets|servicesEnCours|controleImpossible|ventesDossier)\S*/g), ["memo.nets", "memo.controleImpossible", "memo.servicesEnCours", "memo.ventesDossier"], "memo.nets et memo.servicesEnCours ne sont que posés");
  assert.doesNotMatch(code, /relie(?:Wa)?\??\.(?!services\b|internes\b|ventes\b)/, "le dossier relié ne sert qu'au contrôle");
  assert.doesNotMatch(code, /internes\s*:|\.\.\.memo\b|JSON\.stringify\(memo/);
  // La boucle ne fait que passer memo à executer.
  assert.equal((lire("supabase/functions/agent/boucle.js").match(/memo/g) || []).length, 2);
  const outils = lire("supabase/functions/agent/outils.js");
  const exec = outils.slice(outils.indexOf("export async function executer"), outils.indexOf("export function memoDepuis"));
  assert.doesNotMatch(exec, /contenu: \{[^}]*internes/);
  // Le contrôle s'en sert : un net d'un service de la demande en cours bloque, sauf égal à un prix de vente rendu ; celui d'un autre
  // service avertit seulement.
  const memo = memoDepuis([]);
  memo.nets = s;
  memo.servicesEnCours = new Set(["p1"]);
  const r = await repondre(memo, "Hi Tom, 1,100 THB per person.");
  assert.ok(bloqueMontant(r.avertissements, 1100));
  const autre = await repondre(memo, "Hi Tom, 1,350 THB per person.");
  assert.ok(!autre.avertissements.some((a) => a.startsWith("montant_interne")) && autre.avertissements.includes("montant_egal_net"), "sans le droit nets, le code sans sa valeur");
  // L'empreinte d'un montant masqué (« montant_interne:#sel:empreinte ») est aléatoire : elle peut contenir « 550 » par hasard. Elle est
  // retirée avant de chercher les nets (relecture de la PR 315 : \b voit aussi 550 dans {"net":550}, [550,1350] et 550.00).
  const sansEmpreinte = (j) => j.replace(/#[0-9a-f]{8,32}:[0-9a-f,]+/g, "#empreinte");
  const FUITE = /\b(?:550|1,?350)\b/;
  const sansEmpreintes = sansEmpreinte(JSON.stringify(r));
  assert.match(sansEmpreintes, /montant_interne:#empreinte/, "l'empreinte est bien celle qui a été retirée");
  assert.doesNotMatch(sansEmpreintes, FUITE, "aucun autre net ne sort");
  // Le contrôle lui-même : une empreinte qui contient 550 passe, une vraie fuite échoue, sous toutes ses formes.
  assert.doesNotMatch(sansEmpreinte('{"avertissements":["montant_interne:#eca6ccc4df28550d:b0c7cd815f825b4f"]}'), FUITE);
  for (const fuite of ['{"net":550,"x":1}', '{"nets":[550,1350]}', '"net 550.00"', '"1,350 THB"']) assert.match(sansEmpreinte(fuite), FUITE, fuite);
});

// ---- 3. Noms lus chez un partenaire -------------------------------------------------------------------------------------------------
test("point 3 : « boat by Blue Ocean » est bloqué alors que la fiche s'appelle « Blue Ocean Co., Ltd » ; « Koh Lanta » ne l'est pas par « Lanta Tour »", () => {
  const b = (texte, noms) => controlerReponse(texte, { signer: true, prestataires: noms }).avertissements.filter((a) => a.startsWith("nom_prestataire"));
  assert.deepEqual(b("Your boat by Blue Ocean leaves at 9", ["Blue Ocean Co., Ltd"]), ["nom_prestataire:Blue Ocean Co., Ltd"]);
  assert.deepEqual(b("Andaman picks you up", ["Andaman Travel Company"]), ["nom_prestataire:Andaman Travel Company"]);
  assert.deepEqual(b("Welcome to Koh Lanta!", ["Lanta Tour", "Koh Lanta Travel"]), [], "un nom court de moins de quatre lettres ou vide ne compte pas");
  assert.deepEqual(b("Lazy Day is great", ["Lazy Day"]), ["nom_prestataire:Lazy Day"], "le nom entier comme avant");
});

test("point 3 : le nom d'une conversation typée lue ou jointe est bloqué ; l'apporteur à qui l'on répond garde le sien", async () => {
  const blue = conv({ nom: "Blue Ocean Speedboat" });
  const jade = conv({ nom: "Jade", type_contact: "apporteur" });
  const lucie = conv({ nom: "Lucie Planner", type_contact: "apporteur" });
  const lek = conv({ nom: "Driver Lek", type_contact: "partenaire" });
  const tom = conv({ nom: "Tom Client", type_contact: "client" });
  const lu = (c) => L.lireConversation({ conversation: c.id }, { conversation: c, messages: [msg(c, "hello")] });
  assert.deepEqual(retenuDeLecture(lu(tom)).noms, [], "un client n'est pas un nom bloqué");
  const memo = memoDepuis([], { prestataires: ["Blue Ocean Co., Ltd"] });
  memo.prestatairesApporteur = [];
  memo.contactLie = jade.id;
  for (const c of [blue, jade, lucie, lek]) retenirLecture(lu(c), memo);
  assert.deepEqual(memo.prestataires.slice(1), ["Blue Ocean Speedboat", "Jade", "Lucie Planner", "Driver Lek"]);
  assert.deepEqual(memo.prestatairesApporteur, ["Blue Ocean Speedboat", "Lucie Planner", "Driver Lek"], "vers Jade, son nom reste permis, pas celui de Lucie");
  assert.ok((await avert(memo, "Hi Tom, Driver Lek will pick you up")).includes("nom_prestataire:Driver Lek"));
  // La fonction « agent » ajoute aussi le nom de la conversation jointe ou liée.
  const ts = lire("supabase/functions/agent/index.ts");
  assert.match(ts, /if \(CONTACTS_NOMMES\.includes\(typeLu\) && waLue && waLue\.nom\) ajouterNoms\(memo, \[\{ conversation: waLue\.id, nom: String\(waLue\.nom\) \}\]\);/);
  assert.match(ts, /\(memo as Record<string, unknown>\)\.contactLie = apporteur && waLiee \? waLiee\.id : null;/);
  assert.ok(ts.indexOf(".contactLie = ") < ts.indexOf("ajouterNoms(memo"), "l'exemption est posée avant les noms");
});

test("point 3 : whatsapp-envoi et la réponse préparée bloquent les noms des conversations typées de l'organisation", async () => {
  const lignes = [{ id: "a", nom: "Blue Ocean", type_contact: "partenaire" }, { id: "b", nom: "Jade", type_contact: "apporteur" }, { id: "c", nom: " ", type_contact: "partenaire" }, { id: "d", nom: "Blue Ocean", type_contact: "partenaire" }];
  let filtre = null;
  // Revue de la PR 300 : aussi les conversations reliées à une fiche partenaire (partenaire_id), sans type nommé.
  const db = (resultat) => ({ from: () => ({ select: () => ({ eq: (k, v) => ({ or: (expr) => ((filtre = [k, v, expr]), { limit: async () => resultat }) }) }) }) });
  assert.deepEqual(await nomsContactsTypes(db({ data: lignes, error: null }), "org"), { noms: ["Blue Ocean", "Jade"], erreur: false });
  assert.deepEqual(filtre, ["organisation_id", "org", "type_contact.in.(partenaire,apporteur),partenaire_id.not.is.null"]);
  assert.deepEqual((await nomsContactsTypes(db({ data: lignes, error: null }), "org", { sauf: "b" })).noms, ["Blue Ocean"], "l'apporteur à qui l'on répond");
  assert.deepEqual(await nomsContactsTypes(db({ data: null, error: { code: "42703" } }), "org"), { noms: [], erreur: false }, "migration 68 absente");
  assert.deepEqual(await nomsContactsTypes(db({ data: null, error: { code: "500" } }), "org"), { noms: [], erreur: true });
  const envoi = lire("supabase/functions/whatsapp-envoi/index.ts");
  assert.match(envoi, /const types = await nomsContactsTypes\(admin, conv\.organisation_id, \{ sauf: contactApporteur\(conv\) \?/);
  assert.match(envoi, /if \(types\.erreur\) return ferme;/, "illisible : rien ne part");
  assert.match(envoi, /const ferme = \{ a_retirer: \["nom_prestataire:lecture_impossible"\]/);
  const rep = lire("supabase/functions/whatsapp/reponse.ts");
  assert.match(rep, /const types = await nomsContactsTypes\(db, conv\.organisation_id, \{ sauf: contactApporteur\(conv\) \? conv\.id : null \}\);/);
});

// ---- 4. Ton de Nani ------------------------------------------------------------------------------------------------------------------
test("point 4 : un contact personnel ne sert jamais d'exemple de ton", () => {
  const rep = lire("supabase/functions/whatsapp/reponse.ts");
  const ton = rep.slice(rep.indexOf("async function tonDeNani"), rep.indexOf("async function echecVisible"));
  assert.match(ton, /\.from\("whatsapp_conversations"\)\.select\("id"\)\.eq\("entite_id", entiteId\)\.neq\("reponses", "jamais"\)/);
  // Les réponses et les réécritures ne se lisent que dans ces conversations-là.
  assert.match(ton, /\.in\("conversation_id", ids\)[\s\S]*\.in\("conversation_id", ids\)/);
});

// ---- 5. « Préparer une réponse » sur un contact personnel ----------------------------------------------------------------------------
test("point 5 : « Préparer une réponse » est refusé pour un contact personnel et le bouton est masqué", async () => {
  const rep = lire("supabase/functions/whatsapp/reponse.ts");
  const demande = rep.slice(rep.indexOf("export async function preparerALaDemande"), rep.indexOf("async function preparationAutoPermise"));
  // Depuis le 22.11.2026, la règle est dans refusDemande (proposer.js) : Contact personnel refusé, IA coupée permise à la demande.
  const { refusDemande } = await import("../supabase/functions/whatsapp/proposer.js");
  assert.equal(refusDemande({ reponses: "jamais" }), "contact_personnel");
  assert.ok(demande.indexOf("const refus = refusDemande(lu.conv);\n  if (refus) return { erreur: refus };") > 0);
  assert.ok(demande.indexOf("refusDemande(lu.conv)") < demande.indexOf("ANTHROPIC_API_KEY") && demande.indexOf("refusDemande(lu.conv)") < demande.indexOf("budgetOuvert("), "avant tout le reste");
  assert.match(lire("supabase/functions/whatsapp-preparer/index.ts"), /contact_personnel: 403/);
  assert.match(lire("src/gestion/js/views/whatsapp.mjs"), /const bouton = !lectureSeule && reponsesDe\(c\) !== "jamais" && dernier/);
  assert.equal(W.erreurPreparer("contact_personnel"), "Contact personnel : rien n'est envoyé à l'IA. Répondez depuis l'app.");
  assert.ok(EN[W.ERREURS_PREPARER.contact_personnel]);
  assert.doesNotMatch(rep, /même pour un contact réglé sur « jamais »/);
  // La démonstration refuse comme la fonction.
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?r299=${Date.now()}`);
    const store = creer();
    const brut = await store.charger();
    const perso = brut.whatsapp_conversations.find((c) => c.reponses === "jamais");
    assert.deepEqual(await store.whatsappPreparer(perso.id, { delai: 1 }), { erreur: "contact_personnel" });
    assert.ok(!(await store.charger()).whatsapp_propositions.some((p) => p.conversation_id === perso.id && p.statut === "en_cours"));
  } finally {
    delete globalThis.localStorage;
  }
});

// ---- 6. Réponse préparée pour un partenaire -------------------------------------------------------------------------------------------
test("point 6 : partenaire : sans client ni dossier, consigne « destinataire partenaire », jamais préparée seule", () => {
  const c = conv({ type_contact: "partenaire", nom: "Lek" });
  const t = demandeAgent({ messages: [msg(c, "Pickup done, net 900")], nomProfil: "Lek", client: { prenom: "Tom" }, dossier: { ref_courte: "D-1", reference: "2026-1" }, contact: "partenaire" });
  assert.match(t, new RegExp(CONSIGNE_PARTENAIRE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(CONSIGNE_PARTENAIRE, "Destinataire partenaire : jamais un prix de vente, un total, un solde ni une marge du client. Un prix écrit plus haut dans cette conversation n'est jamais un prix de vente.");
  assert.doesNotMatch(t, /Tom|D-1|2026-1|lire_dossier avant/, "ni client ni dossier, même passés par erreur");
  assert.match(t, /pas un client/);
  const p = promptPreparation({ entreprise: "Secret", reglages: {}, messages: [msg(c, "hello")], aujourdhui: "2026-11-21", contact: "partenaire" });
  assert.match(p.texte, /un partenaire, pas un client/);
  assert.doesNotMatch(promptPreparation({ entreprise: "Secret", reglages: {}, messages: [msg(c, "hello")], aujourdhui: "2026-11-21" }).texte, /Destinataire partenaire/);
  const rep = lire("supabase/functions/whatsapp/reponse.ts");
  // Migration 110 : posé par Nani ou déduit, ou fiche partenaire (type-contact.js, traiterEnPartenaire) ; jamais sur des repères seuls.
  assert.match(rep, /const versPartenaire = \(conv: Conv\) => traiterEnPartenaire\(conv\);/);
  assert.match(rep, /conv\.entite_id === ent\.id && !partenaire \? \{ clientId: conv\.client_id, dossierId: conv\.dossier_id \} : \{ clientId: null, dossierId: null \}/);
  assert.match(rep, /conv\.client_id && conv\.entite_id === ent\.id && !partenaire \?/);
  assert.match(rep, /conv\.dossier_id && conv\.entite_id === ent\.id && !partenaire \?/);
  const apres = rep.slice(rep.indexOf("export async function apresMessageClient"), rep.indexOf("export async function preparerALaDemande"));
  assert.ok(apres.indexOf("if (versPartenaire(conv)) return;") > 0 && apres.indexOf("if (versPartenaire(conv)) return;") < apres.indexOf("preparationAutoPermise("), "sur demande seulement, même la case cochée");
  assert.match(rep, /if \(partenaire\) for \(const n of montantsInternesDe\(messages\.map\(\(m\) => String\(m\.texte \|\| ""\)\)\)\) memo\.internes\.add\(n\);/);
});

// ---- 7. Promesses ---------------------------------------------------------------------------------------------------------------------
test("point 7 : la promesse faite à un partenaire ne garde aucun chiffre", () => {
  for (const type of ["partenaire"]) {
    const t = tachePromesse({ conv: { entite_id: "e", type_contact: type, nom: "Blue Ocean", telephone: "+66810000001" }, quoi: "confirmer le net de 1,350 THB pour 2 pax", echeance: "2026-11-22" });
    const quoi = t.titre.slice(t.titre.indexOf(" : ") + 3);
    assert.doesNotMatch(quoi, /\d/, type);
    assert.match(quoi, /confirmer le net de/);
  }
  assert.match(tachePromesse({ conv: { entite_id: "e", type_contact: "client", nom: "Tom" }, quoi: "envoyer les 2 billets", echeance: "2026-11-22" }).titre, /2 billets/, "un client garde son texte");
  assert.equal(sansChiffres("1,350 THB"), "revenir vers le contact");
  assert.equal(sansChiffres("confirmer le bateau"), "confirmer le bateau");
});

// ---- 8. Migration 69 ------------------------------------------------------------------------------------------------------------------
test("point 8 : la liste à faire confirmer par Nani est en tête de la migration 69, à côté du comptage", () => {
  const sql = lire("docs/gestion/migration-69-ia-tous-contacts.sql");
  const tete = sql.slice(0, sql.indexOf("begin;"));
  assert.ok(tete.includes("select id, nom, type_contact, reponses, updated_at from whatsapp_conversations where (type_contact in ('partenaire','chauffeur','hotel') and reponses = 'jamais') or (type_contact is null and reponses = 'jamais') order by type_contact nulls last, updated_at desc;"));
  assert.ok(tete.indexOf("group by 1;") < tete.indexOf("order by type_contact nulls last"));
  assert.match(tete, /confirmer par Nani/);
});

// ---- 9. Historique de l'Assistant -----------------------------------------------------------------------------------------------------
test("point 9 : conversation WhatsApp liée passée « jamais » : l'échange joint plus tôt est retiré de l'historique", () => {
  const joint = texteDepuisWhatsApp({ mode: "creer", conv: conv({ type_contact: "client", nom: "Maman" }), messages: [msg(conv(), "secret de famille")] });
  const hist = [
    { role: "user", content: [{ type: "fichier", id: "f" }, { type: "text", text: joint }] },
    { role: "assistant", content: [{ type: "text", text: "Je prépare le dossier." }] },
    { role: "user", content: "Merci" },
    { role: "user", content: joint },
  ];
  const r = L.retirerConversationsJointes(hist);
  assert.deepEqual(r[0].content, [{ type: "fichier", id: "f" }, { type: "text", text: L.RESULTAT_RETIRE }]);
  assert.equal(r[1], hist[1]);
  assert.equal(r[2], hist[2]);
  assert.equal(r[3].content, L.RESULTAT_RETIRE);
  assert.doesNotMatch(JSON.stringify(r), /secret de famille|Maman/);
  assert.match(hist[0].content[1].text, /secret de famille/, "l'entrée n'est pas modifiée");
  const ts = lire("supabase/functions/agent/index.ts");
  assert.match(ts, /const gardes = waLue && waLue\.reponses === "jamais" \? retirerConversationsJointes\(gardesBruts\) : gardesBruts;/);
  assert.match(ts, /if \(!w\.error\) waLue = w\.data \|\| null;/, "la conversation liée est relue même sans droit d'écrire");
  assert.ok(ts.indexOf("const gardes = waLue") < ts.indexOf("const messages = sansReflexionPassee(historiquePourClaude(retirerLecturesWhatsApp(gardes)"), "avant tout envoi");
  assert.ok(ts.indexOf("const gardes = waLue") < ts.indexOf("const premierTexte"), "avant les apprentissages");
});

test("les deux exemplaires du module de lecture restent identiques", () => {
  assert.equal(lire("supabase/functions/agent/whatsapp-lecture.js"), lire("src/gestion/js/agent-whatsapp-lecture.mjs"));
});
