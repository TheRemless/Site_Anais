// Modèle de réponse de prix de l'Assistant (23.11.2026, relecture de la PR 342 comprise) : la première réponse de prix à un client reprend
// mot pour mot le texte type de l'entreprise marqué « Réponse de prix », variables remplies, et une question en plus part en message séparé ;
// il passe avant « Reply to a request » et avant la voix ; hors des cas couverts, la voix avec une ligne pour Nani ; jamais pour un
// partenaire, un chauffeur ni un prix d'une autre entreprise. Conversation et données inventées, aucun appel réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appliquerModelePrix, phrasesDe, phrasesEnPlus, consignesModelesPrix, formatTotal, modelesPrix, remplirModelePrix, USAGE_PRIX, voixCopieModele } from "../supabase/functions/agent/modele-prix.js";
import { OUTILS, executer, memoDepuis, montantsDePrix, montantsDuTexte, normaliserEntree, outilsDuContexte, prixDejaDonne, prixEcritParNani } from "../supabase/functions/agent/outils.js";
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
const TAXI = { fonctionnement: "taxi", devise: "THB", assistant_voix: VOIX_TAXI, messages: [REPONSE, MODELE] };
const SECRET = { fonctionnement: "excursions", messages: [REPONSE] };
const ZTP = { fonctionnement: "sur_mesure", messages: [REPONSE] };
const rempli = (total, prenom = "") => MODELE.corps.replace("{total}", total).replace(" {prenom}", prenom ? ` ${prenom}` : "");

const ctxDe = (reglages, extra = {}) => ({ charger: async () => [], reglages, simule: tempsSimule, ...extra });
const memoDe = (o = {}) => ({ prix: new Set([2500, 2700]), heures: new Set(), tapes: new Set(), durees: new Set(), estimations: new Map(), internes: new Set(), nani: new Set(), signer: false, prestataires: ["Andaman Vans Co"], entreprise: "Taxi Démo", contact: "", ...o });
const VIDE = { message: "", modele_prix: "", total: "", prenom: "", hors_modele: "", suite: "" };
const reponse = (e, reglages = TAXI, memo = memoDe(), ctx = ctxDe(reglages)) => executer("proposer_reponse", { titre: "Prix", langue: "en", ...VIDE, ...e }, ctx, memo);
const avec = (r, code) => r.carte.avertissements.some((a) => a.startsWith(code));

// Claude simulé : chaque appel rend la réponse suivante de la liste et garde les paramètres reçus.
function claudeSimule(reponses) {
  const recus = [];
  return {
    recus,
    beta: { messages: { stream(p) { recus.push(structuredClone(p)); const r = reponses[recus.length - 1]; return { async *[Symbol.asyncIterator]() {}, finalMessage: async () => ({ model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 5 }, ...r }) }; } } },
  };
}
// Une réponse dans le style de la voix, comme celle relevée en production le 23.11.2026 (texte inventé).
const DANS_LA_VOIX = "Hello, thank you for your message 😊\n\n→ Krabi Town: 2,500 THB\n\nHave a nice day, Taxi Démo";

test("première réponse d'une demande de prix : exactement le modèle rempli, quoi qu'ait écrit l'Assistant", async () => {
  const messages = [{ role: "user", content: [{ type: "text", text: "Le client (Tom) demande : how much is a private transfer from Koh Lanta to Krabi Town?" }] }];
  const claude = claudeSimule([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "proposer_reponse", input: { titre: "Prix Krabi Town", langue: "en", ...VIDE, message: DANS_LA_VOIX, modele_prix: "perso-demo01", total: "2,500 THB", prenom: "Tom" } }] },
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
  assert.deepEqual(Object.keys(outil.input_schema.properties), ["titre", "langue", "message", "modele_prix", "total", "prenom", "hors_modele", "suite"]);
  assert.equal(cartes.length, 1);
  assert.equal(cartes[0].donnees.message, rempli("2,500 THB", "Tom"));
  assert.ok(cartes[0].avertissements.includes("modele_prix_remplace:Price quote (private transfer)"), cartes[0].avertissements.join(" | "));
  assert.ok(!cartes[0].avertissements.some((a) => /^(montant|heure|nom_prestataire|prenom_equipe|signature)/.test(a)), cartes[0].avertissements.join(" | "));
});

test("cas 1, question en plus du prix : le modèle mot pour mot, puis la question en message séparé", async () => {
  // Par le champ suite.
  const r = await reponse({ message: rempli("2,500 THB"), modele_prix: "perso-demo01", total: "2,500 THB", suite: "Could you send me the name of your hotel?" });
  assert.equal(r.carte.donnees.message, `${rempli("2,500 THB")}\n\nCould you send me the name of your hotel?`);
  // Oubliée dans suite mais écrite dans le brouillon : elle ne se perd pas.
  const brouillon = "Hello,\n\n→ Krabi Town: 2,500 THB\n\nWhat time does your flight land?\nDo you need a child seat?";
  const q = await reponse({ message: brouillon, modele_prix: "perso-demo01", total: "2,500 THB" });
  assert.equal(q.carte.donnees.message, `${rempli("2,500 THB")}\n\nWhat time does your flight land?\nDo you need a child seat?`);
  // Par phrase, pas par ligne : une information aussi (« We have child seats. »), même collée au prix sur la même ligne.
  const info = await reponse({ message: "Hello, thank you for your message 😊 Krabi Town is 2,500 THB. We have child seats. Is it for tomorrow?\n\nHave a nice day, Taxi Démo", modele_prix: "perso-demo01", total: "2,500 THB" });
  assert.equal(info.carte.donnees.message, `${rempli("2,500 THB")}\n\nWe have child seats.\nIs it for tomorrow?`);
  assert.deepEqual(phrasesDe("Hi Tom. We have child seats! Ok?\n→ Ao Nang"), ["Hi Tom.", "We have child seats!", "Ok?", "Ao Nang"]);
  assert.deepEqual(phrasesEnPlus("Thank you for your message. Kind regards, Taxi Démo", { modele: MODELE.corps, entreprise: "Taxi Démo" }), []);
  // Une question déjà dans suite n'est pas répétée.
  const deux = await reponse({ message: brouillon, modele_prix: "perso-demo01", total: "2,500 THB", suite: "What time does your flight land?" });
  assert.equal(deux.carte.donnees.message.match(/What time does your flight land\?/g).length, 1);
  // La consigne le dit.
  const c = consignes({ entreprise: "Taxi Démo", reglages: TAXI, prenomEquipe: "Nani" });
  assert.match(c, /poser une question \(hôtel, heure de pickup, sièges enfant, bagages\) ou donner une autre information, mets-la dans suite/);
  assert.match(c, /message séparé, après une ligne vide/);
});

test("cas 2, garde-fous : minivan partagé, prix par personne, deux options ou deux montants suivent la voix avec une ligne pour Nani", async () => {
  const partage = "Hello,\n\nThe shared minivan to Krabi Town is 2,500 THB.";
  const p = await reponse({ message: partage, modele_prix: "perso-demo01", total: "2,500 THB" });
  assert.equal(p.carte.donnees.message, partage);
  assert.ok(p.carte.avertissements.includes("hors_modele_prix:prix par personne ou trajet partagé"));
  for (const total of ["2,500 THB per person", "2,500 THB (songthaew)", "2,500 THB, minivan partagé"]) assert.ok(avec(await reponse({ message: "Hello", modele_prix: "perso-demo01", total }), "hors_modele_prix"), total);
  const options = "Hello Tom,\n\n→ Krabi Town: 2,500 THB\n→ Ao Nang: 2,700 THB\n\nWhich one would you like?";
  const o = await reponse({ message: options, modele_prix: "perso-demo01", total: "2,500 THB" });
  assert.equal(o.carte.donnees.message, options);
  assert.ok(o.carte.avertissements.includes("hors_modele_prix:plusieurs prix dans la réponse"));
  const t = await reponse({ message: "Hello", modele_prix: "perso-demo01", total: "2,500 THB or 2,700 THB" });
  assert.ok(t.carte.avertissements.includes("hors_modele_prix:plusieurs montants dans le total"));
  // « aucun » avec sa raison : la voix, et Nani lit pourquoi.
  const aucun = await reponse({ message: options, modele_prix: "aucun", hors_modele: "Le client demande deux destinations." });
  assert.equal(aucun.carte.donnees.message, options);
  assert.ok(aucun.carte.avertissements.includes("hors_modele_prix:Le client demande deux destinations."));
  assert.equal((await reponse({ message: options, modele_prix: "aucun" })).contenu.erreur, "hors_modele_sans_raison");
});

test("cas 3, format du total : « 2500 » sans THB, texte long, net refusé, jamais coupé", async () => {
  const sans = await reponse({ message: "Hello,\n\nKrabi Town: 2500", modele_prix: "perso-demo01", total: "2500" });
  assert.equal(sans.carte.donnees.message, rempli("2,500 THB"));
  // Un total bavard : l'unique montant est relu et réécrit, rien n'est coupé.
  const long = await reponse({ message: "", modele_prix: "perso-demo01", total: "2,500 THB for the private minivan from your hotel on Koh Lanta to Krabi Town, ferry tickets and all fees included" });
  assert.equal(long.carte.donnees.message, rempli("2,500 THB"));
  // Un prénom trop long n'est pas coupé : il n'est pas mis.
  const nom = await reponse({ message: "", modele_prix: "perso-demo01", total: "2,500 THB", prenom: "Maximilian-Alexander Sebastian von Musterhausen" });
  assert.equal(nom.carte.donnees.message, rempli("2,500 THB"));
  // Net : un montant interne n'est jamais un total, même sourcé ailleurs.
  const net = await reponse({ message: "", modele_prix: "perso-demo01", total: "1,900 THB" }, TAXI, memoDe({ prix: new Set([1900, 2500]), internes: new Set([1900]) }));
  assert.equal(net.contenu.erreur, "modele_prix_total");
  // Un total sans source (ni outil ni Nani) ou sans chiffre : refusé.
  assert.equal((await reponse({ message: "", modele_prix: "perso-demo01", total: "3,100 THB" })).contenu.erreur, "modele_prix_total");
  assert.equal((await reponse({ message: "", modele_prix: "perso-demo01", total: "à confirmer" })).contenu.erreur, "modele_prix_total");
  // Un montant tapé par Nani compte comme prix de vente.
  const tape = await reponse({ message: "", modele_prix: "perso-demo01", total: "3100" }, TAXI, memoDe({ tapes: new Set([3100]) }));
  assert.equal(tape.carte.donnees.message, rempli("3,100 THB"));
  assert.equal(formatTotal(12500.5, "THB"), "12,500.5 THB");
});

test("cas 4, confirmation au deuxième message : le prix est déjà donné, rien n'est imposé", async () => {
  const confirmation = "Hello Tom,\n\nPerfect, your transfer is booked for 2,500 THB. Pickup at 09:00 at your hotel.";
  // Échange précédent : une réponse avec prix déjà proposée dans l'historique.
  const historique = [
    { role: "user", content: [{ type: "text", text: "Le client demande le prix pour Krabi Town" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "proposer_reponse", input: { titre: "Prix", langue: "en", ...VIDE, message: rempli("2,500 THB"), modele_prix: "perso-demo01", total: "2,500 THB" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ carte_affichee: true }) }, { type: "text", text: "Il confirme pour demain 9h" }] },
  ];
  const lu = memoDepuis(historique);
  assert.equal(prixDejaDonne(lu), true);
  const r = await reponse({ message: confirmation, modele_prix: "perso-demo01", total: "2,500 THB" }, TAXI, { ...memoDe(), prixDonne: lu.prixDonne, heures: new Set(["09:00"]) });
  assert.equal(r.carte.donnees.message, confirmation);
  assert.ok(!r.carte.avertissements.some((a) => a.includes("modele")), r.carte.avertissements.join(" | "));
  // Un prix déjà écrit au client par Nani dans la conversation : pareil.
  const nani = await reponse({ message: confirmation }, TAXI, memoDe({ nani: new Set([2500]), heures: new Set(["09:00"]) }));
  assert.equal(nani.carte.donnees.message, confirmation);
  // Dans le même échange : seule la première réponse de prix est contrôlée.
  const memo = memoDe();
  const un = await reponse({ message: "", modele_prix: "perso-demo01", total: "2,500 THB" }, TAXI, memo);
  assert.equal(un.carte.donnees.message, rempli("2,500 THB"));
  const suite = await reponse({ message: "And Ao Nang would be 2,700 THB." }, TAXI, memo);
  assert.equal(suite.carte.donnees.message, "And Ao Nang would be 2,700 THB.");
  // Un numéro de vol dans une réponse déjà proposée n'est pas un prix donné ; un prix avec sa devise, si.
  const vol = (message) => memoDepuis([{ role: "assistant", content: [{ type: "tool_use", id: "v1", name: "proposer_reponse", input: { titre: "R", langue: "en", ...VIDE, message } }] }]);
  assert.equal(prixDejaDonne(vol("Your flight TG 255 lands at 14:05, see you there.")), false);
  assert.equal(prixDejaDonne(vol("Hello, the transfer is 2,500 THB.")), true);
  // WhatsApp : un prix écrit par Nani avec sa devise, client confirmé ou non ; jamais un numéro de vol, un message du client ou effacé.
  assert.equal(prixEcritParNani([{ sens: "sortant", origine: "app", texte: "It's 2,500 THB for the private car" }]), true);
  assert.equal(prixEcritParNani([{ sens: "sortant", origine: "gestion", texte: "Flight TG 255 noted, pickup 09:00" }]), false);
  assert.equal(prixEcritParNani([{ sens: "entrant", origine: "app", texte: "Is 2,500 THB ok?" }]), false);
  assert.equal(prixEcritParNani([{ sens: "sortant", origine: "app", texte: "2,500 THB", supprime_le: "2026-11-23" }]), false);
  // Un appel refusé dans l'historique ne compte pas comme prix donné.
  const refuse = memoDepuis([historique[0], historique[1], { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{}", is_error: true }] }]);
  assert.equal(prixDejaDonne(refuse), false);
  // La consigne parle de la première réponse de prix, plus de « chaque nouveau prix ».
  const c = consignes({ entreprise: "Taxi Démo", reglages: TAXI, prenomEquipe: "Nani" });
  assert.match(c, /Première réponse de prix à un client/);
  assert.doesNotMatch(c, /à chaque nouveau prix demandé/);
});

test("cas 4, partenaires : jamais à un chauffeur, au personnel ni à l'apporteur lui-même ; un prix sans choix n'est qu'une information", async () => {
  const chauffeur = "Hi, tomorrow 09:00 Jai Tiki to Krabi Town, 2,500 THB paid by the guest.";
  for (const contact of ["partenaire", "personnel"]) {
    const r = await reponse({ message: chauffeur, modele_prix: "perso-demo01", total: "2,500 THB" }, TAXI, memoDe({ contact, heures: new Set(["09:00"]) }));
    assert.equal(r.carte.donnees.message, chauffeur, contact);
    assert.ok(!r.carte.avertissements.some((a) => a.includes("modele")), contact);
  }
  // Le drapeau descend jusqu'au memo.
  assert.equal(memoDepuis([], { contact: "partenaire" }).contact, "partenaire");
  // Réponse à l'apporteur lui-même : pas de modèle ; au client d'un apporteur : le modèle.
  const ctxA = ctxDe(TAXI, { apporteur: { id: "x", nom: "Agence Démo" } });
  const versApporteur = await reponse({ message: chauffeur, modele_prix: "perso-demo01", total: "2,500 THB", destinataire: "apporteur" }, TAXI, memoDe({ contact: "apporteur", heures: new Set(["09:00"]) }), ctxA);
  assert.equal(versApporteur.carte.donnees.message, chauffeur);
  // Une conversation d'apporteur : jamais le modèle, même pour un message que l'apporteur relaiera à son client (deuxième relecture).
  for (const destinataire of ["client", ""]) {
    const relais = await reponse({ message: "For your guest: 2,500 THB", modele_prix: "perso-demo01", total: "2,500 THB", destinataire }, TAXI, memoDe({ contact: "apporteur" }), ctxA);
    assert.equal(relais.carte.donnees.message, "For your guest: 2,500 THB", destinataire);
    assert.ok(!relais.carte.avertissements.some((a) => a.includes("modele")), destinataire);
  }
  // Une conversation WhatsApp typée apporteur, sans fiche reliée : pareil.
  const sansFiche = await reponse({ message: "For your guest: 2,500 THB" }, TAXI, memoDe({ contact: "apporteur" }));
  assert.equal(sansFiche.carte.donnees.message, "For your guest: 2,500 THB");
  assert.deepEqual(sansFiche.carte.avertissements, []);
  // Un prix sans choix de modèle : la réponse passe, avec une information pour Nani.
  const sansChoix = await reponse({ message: DANS_LA_VOIX });
  assert.equal(sansChoix.carte.donnees.message.startsWith("Hello, thank you for your message"), true);
  assert.ok(sansChoix.carte.avertissements.includes("modele_prix_a_choisir:Price quote (private transfer)"));
  assert.equal(libelleAvertissement("modele_prix_a_choisir:Prix").niveau, "info");
  // Une question sans prix : rien.
  const heure = await reponse({ message: "Hello Tom,\n\nWhat time does your flight land?" });
  assert.ok(!heure.carte.avertissements.some((a) => a.includes("modele")));
  assert.deepEqual(montantsDePrix("Flight TG 255 lands at 14:05", new Set()), []);
});

test("cas 5, espace unifié : le modèle de Taxi ne s'applique jamais au prix d'une excursion Secret", async () => {
  const T = "00000000-0000-4000-8000-0000000000a3";
  const S = "00000000-0000-4000-8000-0000000000a2";
  const ctx = ctxDe(TAXI, { entites: [{ id: T, slug: "taxi", nom: "Taxi Démo" }, { id: S, slug: "secret", nom: "Secret Démo" }], permissionsPar: { [T]: [], [S]: [] } });
  // Les prix lus au catalogue, avec leur entreprise (relus de l'historique comme pendant l'échange).
  const historique = [
    { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "chercher_catalogue", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: JSON.stringify({ lignes: [{ ref: "P-11111111", entreprise: "Taxi", libelle: "Krabi Town", prix_vente: 2500 }, { ref: "P-22222222", entreprise: "Secret", libelle: "4 Islands tour", prix_vente: 1800 }] }) }] },
  ];
  const lu = memoDepuis(historique);
  assert.deepEqual([...lu.prixParEntreprise.get("Taxi")], [2500]);
  assert.deepEqual([...lu.prixParEntreprise.get("Secret")], [1800]);
  const memo = () => memoDe({ prix: lu.prix, prixParEntreprise: lu.prixParEntreprise });
  const excursion = "Hello,\n\nThe 4 Islands tour is 1,800 THB.";
  const r = await reponse({ message: excursion, modele_prix: "perso-demo01", total: "1,800 THB" }, TAXI, memo(), ctx);
  assert.equal(r.carte.donnees.message, excursion);
  assert.ok(avec(r, "hors_modele_prix:prix hors du catalogue de Taxi Démo"), r.carte.avertissements.join(" | "));
  // Le prix du transfert Taxi : le modèle.
  const taxi = await reponse({ message: "", modele_prix: "perso-demo01", total: "2,500 THB" }, TAXI, memo(), ctx);
  assert.equal(taxi.carte.donnees.message, rempli("2,500 THB"));
});

test("priorité sur « Reply to a request » et isolement : jamais pris comme modèle, jamais chez Secret ni chez ZTP", async () => {
  const pris = await reponse({ message: "Hello", modele_prix: "reponse-en", total: "2,500 THB" });
  assert.equal(pris.contenu.erreur, "modele_prix_inconnu");
  assert.match(pris.contenu.conseil, /perso-demo01/);
  const c = consignes({ entreprise: "Taxi Démo", reglages: TAXI, prenomEquipe: "Nani" });
  const section = c.slice(c.indexOf("Réponse au client (proposer_reponse)"));
  assert.match(section, /passe avant la voix et avant tout autre texte type, « Réponse à une demande » \(« Reply to a request »\) compris/);
  assert.match(section, /jamais à un partenaire, un chauffeur ou un apporteur/);
  assert.ok(section.indexOf("perso-demo01") < section.indexOf("- Voix en anglais"));
  assert.match(section, /Ne propose jamais de changer la voix ou un texte type pour faire respecter un modèle/);
  assert.deepEqual(modelesPrix(TAXI).map((m) => m.id), ["perso-demo01"]);
  for (const [nom, r] of [["Secret Démo", SECRET], ["ZTP Démo", ZTP]]) {
    assert.equal(consignesModelesPrix(r, { entreprise: nom }), "");
    assert.ok(!consignes({ entreprise: nom, reglages: r, prenomEquipe: "Nani" }).includes("perso-demo01"));
    assert.equal((await reponse({ message: "Hello", modele_prix: "perso-demo01", total: "2,500 THB" }, r)).contenu.erreur, "modele_prix_inconnu");
    const voix = await reponse({ message: "Hello,\n\nThe transfer is 2,500 THB." }, r);
    assert.equal(voix.carte.donnees.message, "Hello,\n\nThe transfer is 2,500 THB.");
    assert.deepEqual(voix.carte.avertissements, []);
  }
  // Désactivé, au partenaire ou trop long pour être recopié sans coupure : pas un modèle de prix.
  assert.deepEqual(modelesPrix({ messages: [{ ...MODELE, actif: false }, { ...MODELE, id: "x", pour: "partenaire" }, { ...MODELE, id: "y", corps: "x".repeat(4001) }] }), []);
  assert.equal(remplirModelePrix({ corps: "Hi {client}, {total}" }, { total: "2,500 THB" }).erreur, "modele_prix_variable");
  assert.equal((await reponse({ langue: "fr", message: "Bonjour", modele_prix: "perso-demo01", total: "2,500 THB" })).contenu.erreur, "modele_prix_langue");
});

test("aucun net ni partenaire dans le texte client : le texte rempli passe par le contrôle de toute réponse", async () => {
  const nom = await reponse({ message: "", modele_prix: "perso-demo01", total: "2,500 THB", prenom: "Andaman Vans Co" });
  assert.ok(avec(nom, "nom_prestataire"));
  const suite = await reponse({ message: "", modele_prix: "perso-demo01", total: "2,500 THB", suite: "Our cost is 1,900 THB." }, TAXI, memoDe({ internes: new Set([1900]) }));
  assert.ok(avec(suite, "montant_interne"), suite.carte.avertissements.join(" | "));
});

test("l'Assistant ne propose plus de recopier le modèle dans la voix", async () => {
  const ctx = { reglages: TAXI, permissions: ["reglages.ecrire"] };
  const copie = `${VOIX_TAXI.en}\nFor a price, write: The total price for a private transfer for your journey is {total}, all fees included (ferry included).`;
  assert.equal((await proposerReglage({ titre: "Voix EN : devis", sujet: "voix", champ: "en", cle: "", valeur: copie, libelle: "", langue: "", raison: "" }, ctx)).erreur, "modele_dans_voix");
  assert.ok(voixCopieModele("Quote with {total} only", TAXI));
  assert.ok(!voixCopieModele("Quote with {total} only", SECRET), "sans modèle, rien n'est refusé");
  const autre = await proposerReglage({ titre: "Voix EN", sujet: "voix", champ: "en", cle: "", valeur: "Warm and short, plain English.", libelle: "", langue: "", raison: "" }, ctx);
  assert.equal(autre.genre, "reglage");
  assert.equal(lireReglages({ sujet: "messages" }, { reglages: TAXI }).resultat.messages.find((m) => m.id === "perso-demo01").usage, "prix");
});

test("signature : seule la formule de fin avec {entreprise} est retirée chez Secret et Taxi, gardée chez ZTP", () => {
  const v = voixPour(TAXI, "Taxi Démo", "Nani");
  assert.equal(v.en, "You write for Taxi Démo, a private taxi service.\nList each option with a →. End with a short line inviting them to reply here.");
  assert.equal(v.fr, "Tu écris pour Taxi Démo.\nElle termine par « N'hésitez pas à me répondre directement ici ».");
  assert.match(voixPour({ ...ZTP, assistant_voix: VOIX_TAXI }, "ZTP Démo", "Anaïs").en, /Have a nice day, ZTP Démo/);
  // Hors fin de ligne, sans {entreprise}, ou avec une autre variable : rien n'est retiré.
  for (const t of ['reply here, then "Have a nice day".', 'Write "Thanks, {entreprise}" then "Hi" in the middle, then go on.', 'then "Have a nice day, {prenom}, {entreprise}".', 'then "Hi {entreprise}" and more text']) assert.equal(voixSansSignature(t), t, t);
  for (const r of [{ fonctionnement: "taxi" }, { fonctionnement: "excursions" }]) {
    const rep = messagesDefautPour(r).find((m) => m.cle === "reponse");
    assert.ok(!rep.corps.includes("{entreprise}"), r.fonctionnement);
    assert.ok(rep.corps.endsWith("Would you like me to book it?"));
  }
  assert.ok(messagesDefautPour(ZTP).find((m) => m.id === "reponse-en").corps.endsWith("{entreprise}"));
});

test("outils et écran : champs du modèle partout, usage « Réponse de prix », textes anglais", () => {
  const schema = OUTILS.find((o) => o.name === "proposer_reponse").input_schema;
  assert.deepEqual(schema.required, ["titre", "langue", "message", "modele_prix", "total", "prenom", "hors_modele", "suite"]);
  assert.ok(outilsWhatsapp().find((o) => o.name === "proposer_reponse").input_schema.properties.suite);
  assert.ok(outilsWhatsapp({ unifie: true }).find((o) => o.name === "proposer_reponse").input_schema.properties.modele_prix);
  assert.ok(outilsDuContexte({ permissions: [] }).find((o) => o.name === "proposer_reponse").input_schema.properties.hors_modele);
  // Un appel d'avant (sans les champs) reste valide : les champs manquants deviennent vides.
  assert.deepEqual(normaliserEntree("proposer_reponse", { titre: "R", langue: "en", message: "Hello" }), { titre: "R", langue: "en", ...VIDE, message: "Hello" });
  assert.equal(USAGE_PRIX, "prix");
  assert.equal(USAGES.find((x) => x.cle === "prix").pour, "client");
  for (const mode of ["sur_mesure", "excursions", "taxi"]) assert.ok(usagesProposes(mode).some((x) => x.cle === "prix"), mode);
  for (const code of ["modele_prix:Prix", "modele_prix_remplace:Prix", "hors_modele_prix:Deux destinations", "modele_prix_a_choisir:Prix"]) assert.equal(libelleAvertissement(code).niveau, "info", code);
  for (const k of ["Réponse de prix (Assistant)", "Modèle de prix « {v} » repris mot pour mot.", "La réponse s'écartait du modèle de prix « {v} » : le modèle rempli la remplace.", "Modèle de prix non suivi : {v}", "La réponse donne un prix sans le modèle « {v} » : vérifiez si le modèle convenait.", "Modèle de prix « {valeur} » repris mot pour mot.", "La réponse s'écartait du modèle de prix « {valeur} » : le modèle rempli la remplace.", "Modèle de prix non suivi : {valeur}", "La réponse donne un prix sans le modèle « {valeur} » : vérifiez si le modèle convenait."]) assert.ok(EN[k], k);
  // La boîte WhatsApp pose le drapeau et passe le type du contact (lu dans le code, la fonction Deno ne se lance pas ici).
  const wa = readFileSync(new URL("../supabase/functions/whatsapp/reponse.ts", import.meta.url), "utf8");
  assert.match(wa, /if \(prixEcritParNani\(messages\)\) memo\.prixDonne = true;/);
  assert.match(wa, /contact: partenaire \? "partenaire" : typeof conv\.type_contact === "string" \? conv\.type_contact : ""/);
  // La fonction pure, sans outils : contrôle éteint, rien ne change.
  assert.deepEqual(appliquerModelePrix({ message: "x", modele_prix: "perso-demo01" }, { reglages: TAXI, controle: false }), { message: "x", avertissements: [] });
  assert.deepEqual(montantsDuTexte("2500"), [2500]);
});
