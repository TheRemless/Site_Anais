// Modèle de réponse de prix de l'Assistant (23.11.2026) : quand un client demande un prix, la réponse reprend mot pour mot le texte type de
// l'entreprise marqué « Réponse de prix », variables remplies ; il passe avant « Reply to a request » et avant la voix ; hors modèle, la voix,
// avec une ligne pour Nani ; chaque entreprise garde ses textes. Conversation et données inventées, aucun appel réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appliquerModelePrix, consignesModelesPrix, modelesPrix, remplirModelePrix, USAGE_PRIX, voixCopieModele } from "../supabase/functions/agent/modele-prix.js";
import { OUTILS, executer, memoDepuis, montantsDePrix, normaliserEntree, outilsDuContexte } from "../supabase/functions/agent/outils.js";
import { consignes, voixPour, voixSansSignature } from "../supabase/functions/agent/prompt.js";
import { proposerReglage, lireReglages } from "../supabase/functions/agent/ameliorer.js";
import { tourner } from "../supabase/functions/agent/boucle.js";
import { tempsSimule } from "../supabase/functions/agent/planifier.js";
import { outilsWhatsapp } from "../supabase/functions/whatsapp/proposer.js";
import { messagesDefautPour, MESSAGES_DEFAUT } from "../src/gestion/js/defauts.mjs";
import { USAGES, usagesProposes } from "../src/gestion/js/views/messages.mjs";
import { libelleAvertissement } from "../src/gestion/js/whatsapp-calc.mjs";
import { EN } from "../src/gestion/js/i18n-en.mjs";

// Un modèle inventé, de la même forme que celui de Jérémy (titre, ordre, emoji, sans signature).
const MODELE = {
  id: "perso-demo01",
  pour: "client",
  cle: "prix",
  titre: "Price quote (private transfer)",
  langue: "en",
  corps: "Hello {prenom},\n\nThank you for your message. I am helping our driver with his bookings. 📝🚕\nThe total price for a private transfer for your journey is {total}, all fees included (ferry included).\nPayment can be made by cash to the driver directly.\n\nLet me know if you want to book the transfer 🙏🏼\nThank you ✨",
};
const REPONSE = MESSAGES_DEFAUT.find((m) => m.id === "reponse-en");
const VOIX_TAXI = { en: 'You write for {entreprise}, a private taxi service.\nList each option with a →. End with a short line inviting them to reply here, then "Have a nice day, {entreprise}".', fr: "Tu écris pour {entreprise}.\nElle termine par « N'hésitez pas à me répondre directement ici », puis « Belle journée, {entreprise} »." };
const TAXI = { fonctionnement: "taxi", assistant_voix: VOIX_TAXI, messages: [REPONSE, MODELE] };
const SECRET = { fonctionnement: "excursions", messages: [REPONSE] };
const ZTP = { fonctionnement: "sur_mesure", messages: [REPONSE] };
const rempli = (total, prenom = "") => MODELE.corps.replace("{total}", total).replace(" {prenom}", prenom ? ` ${prenom}` : "");

const ctxDe = (reglages, extra = {}) => ({ charger: async () => [], reglages, simule: tempsSimule, ...extra });
const memoDe = (o = {}) => ({ prix: new Set([2500, 2700]), heures: new Set(), tapes: new Set(), durees: new Set(), estimations: new Map(), signer: false, prestataires: ["Andaman Vans Co"], entreprise: "Taxi Démo", ...o });
const reponse = (e, reglages = TAXI, memo = memoDe()) => executer("proposer_reponse", { titre: "Prix", langue: "en", message: "", modele_prix: "", total: "", prenom: "", hors_modele: "", ...e }, ctxDe(reglages), memo);

// Claude simulé : chaque appel rend la réponse suivante de la liste et garde les paramètres reçus.
function claudeSimule(reponses) {
  const recus = [];
  return {
    recus,
    beta: { messages: { stream(p) { recus.push(structuredClone(p)); const r = reponses[recus.length - 1]; return { async *[Symbol.asyncIterator]() {}, finalMessage: async () => ({ model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 5 }, ...r }) }; } } },
  };
}
// Une réponse dans le style de la voix, comme celle relevée en production le 23.11.2026 (texte inventé).
const DANS_LA_VOIX = "Hello, thank you for your message 😊\n\n→ Krabi Town: 2,500 THB\n\nCould you please send us your hotel name?\n\nHave a nice day, Taxi Démo";

test("première réponse d'une demande de prix : exactement le modèle rempli, quoi qu'ait écrit l'Assistant", async () => {
  const messages = [{ role: "user", content: [{ type: "text", text: "Le client (Tom) demande : how much is a private transfer from Koh Lanta to Krabi Town?" }] }];
  const claude = claudeSimule([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "proposer_reponse", input: { titre: "Prix Krabi Town", langue: "en", message: DANS_LA_VOIX, modele_prix: "perso-demo01", total: "2,500 THB", prenom: "Tom", hors_modele: "" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Réponse proposée avec le modèle de prix." }] },
  ]);
  const cartes = [];
  const r = await tourner({
    anthropic: claude,
    modele: "claude-opus-5-5",
    systeme: consignes({ entreprise: "Taxi Démo", reglages: TAXI, prenomEquipe: "Nani" }),
    contexte: "c",
    messages,
    ctx: ctxDe(TAXI),
    memo: memoDe(),
    garder: async (role, contenu) => messages.push({ role, content: contenu }),
    garderCarte: async (c) => (cartes.push(c), { id: "c1", ...c }),
    envoyer: async () => {},
    appels: [],
  });
  assert.equal(r.statut, "ok");
  // Dès le premier appel, Claude voit le modèle dans ses consignes et les champs du modèle dans l'outil.
  const systeme = JSON.stringify(claude.recus[0].system);
  assert.ok(systeme.includes("perso-demo01") && systeme.includes("The total price for a private transfer for your journey is {total}"));
  const outil = claude.recus[0].tools.find((o) => o.name === "proposer_reponse");
  assert.deepEqual(Object.keys(outil.input_schema.properties), ["titre", "langue", "message", "modele_prix", "total", "prenom", "hors_modele"]);
  assert.equal(cartes.length, 1);
  assert.equal(cartes[0].donnees.message, rempli("2,500 THB", "Tom"));
  assert.ok(cartes[0].avertissements.includes("modele_prix_remplace:Price quote (private transfer)"), cartes[0].avertissements.join(" | "));
  assert.ok(!cartes[0].avertissements.some((a) => /^(montant|heure|nom_prestataire|prenom_equipe|signature)/.test(a)), cartes[0].avertissements.join(" | "));
});

test("le choix reste stable au deuxième message : même modèle, mot pour mot, nouveau total", async () => {
  const memo = memoDe();
  const un = await reponse({ message: rempli("2,500 THB"), modele_prix: "perso-demo01", total: "2,500 THB" }, TAXI, memo);
  assert.equal(un.carte.donnees.message, rempli("2,500 THB"));
  assert.deepEqual(un.carte.avertissements, ["modele_prix:Price quote (private transfer)"]);
  // Deuxième demande de la même conversation (Ao Nang) : l'Assistant change une phrase et ajoute une ligne, le modèle revient tel quel.
  const brouillon = rempli("2,700 THB").replace("Payment can be made by cash to the driver directly.", "You can pay the driver in cash.") + "\nHave a nice day!";
  const deux = await reponse({ message: brouillon, modele_prix: "perso-demo01", total: "2,700 THB" }, TAXI, memo);
  assert.equal(deux.carte.donnees.message, rempli("2,700 THB"));
  assert.ok(deux.carte.avertissements.includes("modele_prix_remplace:Price quote (private transfer)"));
  // Sans prénom : « Hello, » ; l'ordre et les emoji du modèle sont gardés.
  assert.ok(deux.carte.donnees.message.startsWith("Hello,\n\nThank you for your message."));
  assert.ok(deux.carte.donnees.message.endsWith("Let me know if you want to book the transfer 🙏🏼\nThank you ✨"));
});

test("priorité sur « Reply to a request » : jamais pris comme modèle de prix, et un prix sans choix est refusé", async () => {
  const pris = await reponse({ message: "Hello", modele_prix: "reponse-en", total: "2,500 THB" });
  assert.equal(pris.contenu.erreur, "modele_prix_inconnu");
  assert.match(pris.contenu.conseil, /perso-demo01/);
  // Une réponse qui donne un prix sans dire si le modèle sert : l'outil demande de choisir, rien n'est proposé en silence.
  const sansChoix = await reponse({ message: DANS_LA_VOIX });
  assert.equal(sansChoix.contenu.erreur, "modele_prix_a_choisir");
  assert.match(sansChoix.contenu.conseil, /perso-demo01/);
  // Les consignes : le modèle passe avant la voix et avant « Reply to a request », et il est donné avant la voix.
  const c = consignes({ entreprise: "Taxi Démo", reglages: TAXI, prenomEquipe: "Nani" });
  const section = c.slice(c.indexOf("Réponse au client (proposer_reponse)"));
  assert.match(section, /passe avant la voix et avant tout autre texte type, « Réponse à une demande » \(« Reply to a request »\) compris/);
  assert.ok(section.indexOf("perso-demo01") < section.indexOf("- Voix en anglais"));
  assert.match(section, /Ne propose jamais de changer la voix ou un texte type pour faire respecter un modèle/);
  // « Reply to a request » n'est pas un modèle de prix, même s'il contient {total}.
  assert.deepEqual(modelesPrix(TAXI).map((m) => m.id), ["perso-demo01"]);
});

test("hors modèle : la voix, avec une ligne pour Nani ; une réponse sans prix passe sans rien", async () => {
  const options = "Hello Tom,\n\n→ Krabi Town: 2,500 THB\n→ Ao Nang: 2,700 THB\n\nWhich one would you like?";
  const r = await reponse({ message: options, modele_prix: "aucun", hors_modele: "Le client demande deux destinations." });
  assert.equal(r.carte.donnees.message, options);
  assert.ok(r.carte.avertissements.includes("hors_modele_prix:Le client demande deux destinations."));
  // « aucun » sans raison : refusé, Nani doit savoir pourquoi.
  assert.equal((await reponse({ message: options, modele_prix: "aucun" })).contenu.erreur, "hors_modele_sans_raison");
  // Une réponse qui ne donne aucun prix (question sur l'heure) : rien à choisir, aucun avertissement de modèle.
  const heure = await reponse({ message: "Hello Tom,\n\nWhat time does your flight land?" });
  assert.equal(heure.carte.donnees.message, "Hello Tom,\n\nWhat time does your flight land?");
  assert.ok(!heure.carte.avertissements.some((a) => a.includes("modele")));
  // Un numéro de vol n'est pas un prix.
  assert.deepEqual(montantsDePrix("Flight TG 255 lands at 14:05", new Set()), []);
  // Un modèle dans une autre langue que la réponse : refusé.
  assert.equal((await reponse({ langue: "fr", message: "Bonjour", modele_prix: "perso-demo01", total: "2,500 THB" })).contenu.erreur, "modele_prix_langue");
  // Un total sans chiffre : refusé.
  assert.equal((await reponse({ message: "x", modele_prix: "perso-demo01", total: "à confirmer" })).contenu.erreur, "modele_prix_total");
});

test("chaque entreprise garde ses éléments : le modèle de Taxi ne sert jamais chez Secret ni chez ZTP", async () => {
  for (const [nom, r] of [["Secret Démo", SECRET], ["ZTP Démo", ZTP]]) {
    assert.equal(consignesModelesPrix(r, { entreprise: nom }), "");
    assert.ok(!consignes({ entreprise: nom, reglages: r, prenomEquipe: "Nani" }).includes("perso-demo01"));
    const essai = await reponse({ message: "Hello", modele_prix: "perso-demo01", total: "2,500 THB" }, r);
    assert.equal(essai.contenu.erreur, "modele_prix_inconnu");
    // Sans modèle chez elles, une réponse avec un prix passe comme avant (voix).
    const voix = await reponse({ message: "Hello,\n\nThe transfer is 2,500 THB." }, r);
    assert.equal(voix.carte.donnees.message, "Hello,\n\nThe transfer is 2,500 THB.");
  }
  // Un modèle désactivé ou adressé au partenaire n'est pas un modèle de prix.
  assert.deepEqual(modelesPrix({ messages: [{ ...MODELE, actif: false }, { ...MODELE, id: "x", pour: "partenaire" }] }), []);
});

test("aucun net dans le texte client : le total passe par le même contrôle que toute réponse", async () => {
  // Total égal à un net interne lu pendant l'échange : bloquant à l'écran (montant_interne).
  const net = await reponse({ message: "", modele_prix: "perso-demo01", total: "1,900 THB" }, TAXI, memoDe({ internes: new Set([1900]) }));
  assert.ok(net.carte.avertissements.some((a) => a.startsWith("montant_interne")), net.carte.avertissements.join(" | "));
  // Total qui ne vient d'aucun outil ni de Nani : signalé.
  const invente = await reponse({ message: "", modele_prix: "perso-demo01", total: "3,100 THB" });
  assert.ok(invente.carte.avertissements.includes("montant_non_source:3100"));
  // Un nom de partenaire glissé dans le prénom : signalé comme ailleurs.
  const nom = await reponse({ message: "", modele_prix: "perso-demo01", total: "2,500 THB", prenom: "Andaman Vans Co" });
  assert.ok(nom.carte.avertissements.some((a) => a.startsWith("nom_prestataire")));
  // Une variable que l'outil ne sait pas remplir : refusé plutôt qu'envoyé avec des accolades.
  assert.equal(remplirModelePrix({ corps: "Hi {client}, {total}" }, { total: "2,500 THB" }).erreur, "modele_prix_variable");
});

test("l'Assistant ne propose plus de recopier le modèle dans la voix", async () => {
  const ctx = { reglages: TAXI, permissions: ["reglages.ecrire"] };
  const copie = `${VOIX_TAXI.en}\nFor a price, write: The total price for a private transfer for your journey is {total}, all fees included (ferry included).`;
  const r = await proposerReglage({ titre: "Voix EN : devis", sujet: "voix", champ: "en", cle: "", valeur: copie, libelle: "", langue: "", raison: "" }, ctx);
  assert.equal(r.erreur, "modele_dans_voix");
  assert.ok(voixCopieModele("Quote with {total} only", TAXI));
  // Une autre retouche de la voix reste possible.
  const autre = await proposerReglage({ titre: "Voix EN", sujet: "voix", champ: "en", cle: "", valeur: "Warm and short, plain English.", libelle: "", langue: "", raison: "" }, ctx);
  assert.equal(autre.genre, "reglage");
  // lire_reglages dit l'usage de chaque texte type.
  assert.equal(lireReglages({ sujet: "messages" }, { reglages: TAXI }).resultat.messages.find((m) => m.id === "perso-demo01").usage, "prix");
});

test("signature : retirée de la voix Taxi et de « Reply to a request » chez Secret et Taxi, gardée chez ZTP", () => {
  const v = voixPour(TAXI, "Taxi Démo", "Nani");
  assert.equal(v.en, "You write for Taxi Démo, a private taxi service.\nList each option with a →. End with a short line inviting them to reply here.");
  assert.equal(v.fr, "Tu écris pour Taxi Démo.\nElle termine par « N'hésitez pas à me répondre directement ici ».");
  assert.match(voixPour({ ...ZTP, assistant_voix: VOIX_TAXI }, "ZTP Démo", "Anaïs").en, /Have a nice day, ZTP Démo/);
  assert.equal(voixSansSignature('reply here, then "Have a nice day".'), 'reply here, then "Have a nice day".', "une formule sans nom reste");
  for (const r of [{ fonctionnement: "taxi" }, { fonctionnement: "excursions" }]) {
    const rep = messagesDefautPour(r).find((m) => m.cle === "reponse");
    assert.ok(!rep.corps.includes("{entreprise}"), r.fonctionnement);
    assert.ok(rep.corps.endsWith("Would you like me to book it?"));
  }
  assert.ok(messagesDefautPour(ZTP).find((m) => m.id === "reponse-en").corps.endsWith("{entreprise}"));
});

test("outils et écran : champs du modèle partout, usage « Réponse de prix », textes anglais", () => {
  const schema = OUTILS.find((o) => o.name === "proposer_reponse").input_schema;
  assert.deepEqual(schema.required, ["titre", "langue", "message", "modele_prix", "total", "prenom", "hors_modele"]);
  assert.ok(outilsWhatsapp().find((o) => o.name === "proposer_reponse").input_schema.properties.modele_prix);
  assert.ok(outilsDuContexte({ permissions: [] }).find((o) => o.name === "proposer_reponse").input_schema.properties.hors_modele);
  // Un appel d'avant (sans les champs) reste valide : les champs manquants deviennent vides.
  assert.deepEqual(normaliserEntree("proposer_reponse", { titre: "R", langue: "en", message: "Hello" }), { titre: "R", langue: "en", message: "Hello", modele_prix: "", total: "", prenom: "", hors_modele: "" });
  // L'écran Messages propose l'usage dans les trois métiers.
  assert.equal(USAGE_PRIX, "prix");
  const u = USAGES.find((x) => x.cle === "prix");
  assert.equal(u.pour, "client");
  for (const mode of ["sur_mesure", "excursions", "taxi"]) assert.ok(usagesProposes(mode).some((x) => x.cle === "prix"), mode);
  // Avertissements de la boîte WhatsApp : des informations, rien n'est bloqué.
  for (const code of ["modele_prix:Prix", "modele_prix_remplace:Prix", "hors_modele_prix:Deux destinations"]) assert.equal(libelleAvertissement(code).niveau, "info", code);
  // Les textes ajoutés ont leur anglais.
  for (const k of ["Réponse de prix (Assistant)", "Modèle de prix « {v} » repris mot pour mot.", "La réponse s'écartait du modèle de prix « {v} » : le modèle rempli la remplace.", "Modèle de prix non suivi : {v}", "Modèle de prix « {valeur} » repris mot pour mot.", "La réponse s'écartait du modèle de prix « {valeur} » : le modèle rempli la remplace.", "Modèle de prix non suivi : {valeur}"]) assert.ok(EN[k], k);
  // L'historique enregistré redonne le prix de vente au message suivant (stabilité d'un échange à l'autre).
  const relu = memoDepuis([{ role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: JSON.stringify({ lignes: [{ prix_vente: 2500 }] }) }] }]);
  assert.ok(relu.prix.has(2500));
});
