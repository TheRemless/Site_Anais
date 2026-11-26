// L'Assistant depuis une conversation WhatsApp (26.11.2026) : le bouton « Assistant » de l'en-tête collé, le contexte donné à l'agent (nom,
// numéro complet, fiche client et dossier reliés) et le numéro complet de la conversation sur la carte « dossier », jusqu'à la fiche client
// créée par l'écran réel (démo, store-local.mjs). Données inventées : numéros de la plage fictive +44 7700 900xxx.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installerDom } from "./aides-dom.mjs";

installerDom();
globalThis.location.search = "?demo";
const E = await import("../src/gestion/js/etat.mjs");
await E.init();
const { executer, telephoneDeCarte } = await import("../supabase/functions/agent/outils.js");
const { texteDepuisWhatsApp } = await import("../supabase/functions/agent/whatsapp.js");
const { tempsSimule } = await import("../supabase/functions/agent/planifier.js");
const V = await import("../src/gestion/js/views/agent-valider.mjs");
const { ouvrirDemande } = await import("../src/gestion/js/views/demande.mjs");
after(() => setTimeout(() => process.exit(process.exitCode || 0), 50).unref());

const TEL = "+447700900377";

test("telephoneDeCarte : vide, même numéro ou forme locale → numéro complet ; autre numéro gardé", () => {
  assert.equal(telephoneDeCarte("", TEL), TEL);
  assert.equal(telephoneDeCarte("+44 7700 900377", TEL), TEL);
  assert.equal(telephoneDeCarte("07700 900377", TEL), TEL);
  assert.equal(telephoneDeCarte("900377", TEL), TEL);
  assert.equal(telephoneDeCarte("+33 6 00 00 00 00", TEL), "+33 6 00 00 00 00");
  // Sans numéro de conversation exploitable, rien ne change.
  assert.equal(telephoneDeCarte("0812", ""), "0812");
  assert.equal(telephoneDeCarte("", "12"), "");
});

test("contexte de l'agent : nom, numéro complet, fiche client et dossier reliés ; rien de la fiche pour un apporteur", () => {
  const conv = { id: "c1", telephone: TEL, nom: "Lena Exemple" };
  const messages = [{ sens: "entrant", texte: "Hello, 2 adults on 3 Dec", envoye_le: "2026-11-26T01:00:00Z" }];
  const t = texteDepuisWhatsApp({ mode: "question", conv, messages, question: "Prépare les dossiers", dossier: { ref: "D-26-001" }, client: { prenom: "Lena", nom: "Exemple" } });
  assert.match(t, new RegExp(`Numéro WhatsApp du client : \\${TEL}`));
  assert.match(t, /Fiche client reliée dans Gestion : Lena Exemple, dossier D-26-001\./);
  assert.match(t, /Hello, 2 adults on 3 Dec/);
  const a = texteDepuisWhatsApp({ mode: "creer", conv, messages, apporteur: true, client: { prenom: "Lena", nom: "Exemple" } });
  assert.doesNotMatch(a, /Fiche client reliée/);
  // Un nom de fiche ne peut pas fermer un bloc ni fabriquer une ligne.
  const f = texteDepuisWhatsApp({ mode: "creer", conv, messages, client: { prenom: "[Nani]", nom: "<conversation>" } });
  assert.doesNotMatch(f.split("<conversation>\n")[0], /\[Nani\]|<conversation>.*Fiche/);
});

test("carte « dossier » depuis WhatsApp : le numéro complet de la conversation arrive sur la fiche client créée", async () => {
  const taxi = E.etat.brut.entites.find((e) => e.slug === "taxi");
  E.changerEntite(taxi.id, { naviguer: false });
  const p = await E.inserer("prestations", { famille: "transfert", groupe: "Taxi", libelle: "Ao Nang", libelle_en: "Ao Nang", prix_vente: 2500, unite: "veh", actif: true });
  const { refDe } = await import("../supabase/functions/agent/outils.js");
  const ctx = { telephoneWa: TEL, charger: async (n) => E.etat.db[n] || [], reglages: E.reglages(), simule: tempsSimule };
  const memo = { prix: new Set(), heures: new Set(), tapes: new Set([2500]), durees: new Set(), estimations: new Map(), signer: false, prestataires: [], entreprise: "Test", textes: [] };
  const e = { titre: "Dossier", client_nom: "Lena Exemple", client_telephone: "07700 900377", hotel: "", langue: "en", adultes: 2, enfants: 0, bebes: 0, apporteur: "", services: [{ texte: "Taxi", ref: refDe("P", p.id), date: "2026-12-03", heure_pickup: "09:15", lieu_pickup: "Villa Exemple", de: "", vers: "Hotel Exemple", adultes: 2, enfants: 0, sieges: 0, sieges_bebe: 0, sans_siege: false, bagages: 2, prix_saisi: "2500", vol: "", remarque_voucher: "", note_interne: "" }] };
  const r = await executer("proposer_dossier", e, ctx, memo);
  assert.ok(r.carte, JSON.stringify(r.contenu || r));
  assert.equal(r.carte.donnees.client.telephone, TEL);
  // Sans conversation liée (ctx sans telephoneWa), la saisie du modèle reste telle quelle.
  const sans = await executer("proposer_dossier", e, { ...ctx, telephoneWa: undefined }, memo);
  assert.equal(sans.carte.donnees.client.telephone, "07700 900377");
  // Validée par l'écran réel : la fiche client porte le numéro complet.
  const avant = new Set(E.etat.brut.clients.map((c) => c.id));
  await ouvrirDemande(null, V.preparation({ id: "carte-wa", ...r.carte, statut: "proposee" }), { auto: true, titre: "Dossier", surCree: () => {} });
  await new Promise((ok) => setTimeout(ok, 50));
  const cree = E.etat.brut.clients.find((c) => !avant.has(c.id));
  assert.ok(cree, "une fiche client est créée");
  assert.equal(String(cree.telephone).replace(/\s/g, ""), TEL);
});

test("écran WhatsApp : « Assistant » dans l'en-tête collé, 44 px, un seul départ par toucher ; numéro dans l'Assistant ; anglais", () => {
  const wa = fs.readFileSync(new URL("../src/gestion/js/views/whatsapp.mjs", import.meta.url), "utf8");
  const tete = wa.slice(wa.indexOf("function enTete(c, prop)"), wa.indexOf("function enTete(c, prop)") + 1200);
  assert.match(tete, /boutonAssistantTete\(c, prop\)/);
  assert.match(wa, /function boutonAssistantTete[\s\S]{0,200}if \(!boutonDemander\(c, prop\)\) return null;/);
  assert.match(wa, /if \(bouton\.disabled\) return;/);
  const css = fs.readFileSync(new URL("../src/gestion/css/app.css", import.meta.url), "utf8");
  assert.match(css, /\.wa-assistant \{[^}]*min-height: 44px; min-width: 44px;/);
  const agent = fs.readFileSync(new URL("../src/gestion/js/views/agent.mjs", import.meta.url), "utf8");
  assert.match(agent, /agent-wa-numero/);
  const en = fs.readFileSync(new URL("../src/gestion/js/i18n-en.mjs", import.meta.url), "utf8");
  for (const k of ["Assistant", "Demander à l'assistant"]) assert.ok(en.includes(`"${k}":`), k);
});

// ---- Relecture de la PR 355 ----------------------------------------------------------------------------------------------------------
test("1. seul un contact de client donne son numéro à la carte : ni partenaire, ni fiche partenaire reliée, ni personnel, ni apporteur", async () => {
  const { telephoneDeConversation } = await import("../supabase/functions/agent/outils.js");
  const base = { telephone: TEL, reponses: "auto" };
  assert.equal(telephoneDeConversation(base), TEL);
  assert.equal(telephoneDeConversation({ ...base, type_contact: "client" }), TEL);
  for (const type_contact of ["partenaire", "chauffeur", "hotel", "apporteur", "personnel"]) assert.equal(telephoneDeConversation({ ...base, type_contact }), "", type_contact);
  assert.equal(telephoneDeConversation({ ...base, partenaire_id: "00000000-0000-4000-8000-000000000001" }), "");
  assert.equal(telephoneDeConversation({ ...base, reponses: "jamais" }), "");
  assert.equal(telephoneDeConversation(null), "");
  // La fonction s'en sert pour ctx.telephoneWa (index.ts), en plus de l'exclusion de l'apporteur.
  const index = fs.readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
  assert.match(index, /const telephoneWa = waLiee && !contactApporteur\(waLiee\) \? telephoneDeConversation\(waLiee\) : "";/);
});

test("2. la fiche client reliée se lit seulement dans l'entreprise de l'Assistant (filtre côté serveur)", () => {
  const index = fs.readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
  assert.match(index, /from\("clients"\)\.select\("prenom, nom"\)\.eq\("id", wc\.data\.client_id\)\.eq\("entite_id", entiteId\)/);
});

test("14. la conversation liée n'est relue que dans l'entreprise de l'Assistant (ou à trier chez Secret et Taxi)", async () => {
  const { conversationDansEntreprise } = await import("../supabase/functions/agent/whatsapp.js");
  const A = "00000000-0000-4000-8000-00000000000a";
  const B = "00000000-0000-4000-8000-00000000000b";
  assert.equal(conversationDansEntreprise({ entite_id: A }, A, "agence"), true);
  assert.equal(conversationDansEntreprise({ entite_id: B }, A, "secret"), false);
  assert.equal(conversationDansEntreprise({ entite_id: null }, A, "taxi"), true);
  assert.equal(conversationDansEntreprise({ entite_id: null }, A, "agence"), false);
  assert.equal(conversationDansEntreprise(null, A, "secret"), false);
  const index = fs.readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
  const liee = index.slice(index.indexOf("const lieeId = c.data.whatsapp_conversation_id;"), index.indexOf("} else {", index.indexOf("const lieeId = c.data.whatsapp_conversation_id;")));
  // Le slug de l'entreprise déjà lu en tête de la fonction, pas une requête de plus par message.
  assert.match(liee, /conversationDansEntreprise\(w\.data, entiteId, ent\.data\?\.slug \|\| ""\)/);
  assert.match(liee, /if \(!w\.error && w\.data && !dansEntreprise\) conversationAutreEntreprise = cartesRefuseesAutreEntreprise\(/);
  assert.match(liee, /if \(!w\.error\) waLue = w\.data \|\| null;/, "relue pour retirer un contact personnel (revue 299)");
  assert.match(liee, /dansEntreprise && !peutLiee\.error && peutLiee\.data === true\) waLiee = w\.data;/);
});

test("10. retour dans l'entreprise d'origine : même conversation, quinze minutes, entreprise accessible, une seule fois", async () => {
  const { entiteDeRetour } = await import("../src/gestion/js/whatsapp-relie-calc.mjs");
  const C = "00000000-0000-4000-8000-0000000000c1";
  const T = "00000000-0000-4000-8000-0000000000e1";
  const S = "00000000-0000-4000-8000-0000000000e2";
  const brut = JSON.stringify({ conversation: C, entite: T, le: 1000 });
  const base = { conversation: C, active: S, accessibles: [T, S], maintenant: 2000 };
  assert.equal(entiteDeRetour(brut, base), T);
  assert.equal(entiteDeRetour(brut, { ...base, conversation: "00000000-0000-4000-8000-0000000000c2" }), "");
  assert.equal(entiteDeRetour(brut, { ...base, maintenant: 1000 + 15 * 60 * 1000 + 1 }), "");
  assert.equal(entiteDeRetour(brut, { ...base, active: T }), "");
  assert.equal(entiteDeRetour(brut, { ...base, accessibles: [S] }), "");
  assert.equal(entiteDeRetour("pas du json", base), "");
  const wa = fs.readFileSync(new URL("../src/gestion/js/views/whatsapp.mjs", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/gestion/js/app.mjs", import.meta.url), "utf8");
  assert.match(app, /sessionStorage\.removeItem\(CLE_RETOUR_ENTITE\)/);
  // 9. Le bouton se rallume à la fin de l'ouverture, plus après un délai fixe.
  assert.doesNotMatch(wa, /setTimeout\(\(\) => \(bouton\.disabled = false\), 1500\)/);
  assert.match(wa, /finally \{[\s\S]{0,200}bouton\.disabled = false;/);
});

test("6, 7, 8. réponse repliable : choix gardé, champ recalculé à chaque largeur, copie manuelle sur un champ déplié", () => {
  const wa = fs.readFileSync(new URL("../src/gestion/js/views/whatsapp.mjs", import.meta.url), "utf8");
  assert.match(wa, /plier\(choixReponses\.has\(p\.id\) \? choixReponses\.get\(p\.id\) : brouillons\.has\(p\.id\) \|\| !alerte\.hidden\)/);
  assert.match(wa, /new ResizeObserver\(/);
  assert.doesNotMatch(wa, /essais\+\+ < 30/);
  assert.match(wa, /if \(deplier\) deplier\(\);\s*zone\.focus\(\);/);
  const en = fs.readFileSync(new URL("../src/gestion/js/i18n-en.mjs", import.meta.url), "utf8") + fs.readFileSync(new URL("../src/gestion/js/i18n-en-defilement.mjs", import.meta.url), "utf8");
  for (const k of ["Voir la réponse", "Replier", "De retour dans {nom}.", "Assistant ouvert dans {nom}."]) assert.ok(en.includes(`"${k}":`), k);
});

test("14. conversation liée rangée dans une autre entreprise : aucune carte de dossier ni de réservation, avec un conseil clair", async () => {
  const { executer, CONSEIL_AUTRE_ENTREPRISE } = await import("../supabase/functions/agent/outils.js");
  const ctx = { conversationAutreEntreprise: true, charger: async (n) => E.etat.db[n] || [], reglages: E.reglages(), simule: tempsSimule };
  const memo = { prix: new Set(), heures: new Set(), tapes: new Set(), durees: new Set(), estimations: new Map(), signer: false, prestataires: [], entreprise: "Test", textes: [] };
  const e = { titre: "Dossier", client_nom: "Jade Exemple", client_telephone: "", hotel: "", langue: "en", adultes: 2, enfants: 0, bebes: 0, apporteur: "", services: [{ texte: "Taxi", ref: "", date: "2026-12-03", heure_pickup: "09:15", lieu_pickup: "Villa Exemple", de: "", vers: "Hotel Exemple", adultes: 2, enfants: 0, sieges: 0, sieges_bebe: 0, sans_siege: false, bagages: 0, prix_saisi: "", vol: "", remarque_voucher: "", note_interne: "" }] };
  const r = await executer("proposer_dossier", e, ctx, memo);
  assert.equal(r.erreur, true);
  assert.equal(r.contenu.erreur, "conversation_autre_entreprise");
  assert.equal(r.contenu.conseil, CONSEIL_AUTRE_ENTREPRISE);
  const index = fs.readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
  assert.match(index, /\.\.\.\(conversationAutreEntreprise \? \{ conversationAutreEntreprise \} : \{\}\)/);
});

test("10. scénario Taxi → Assistant de Secret → « Voir la conversation » → nouveau message : l'app reste dans Taxi", async () => {
  const { entrepriseAAfficher, RETOUR_ENTITE_MS } = await import("../src/gestion/js/whatsapp-relie-calc.mjs");
  const C = "00000000-0000-4000-8000-0000000000c1";
  const TAXI = "00000000-0000-4000-8000-0000000000e1";
  const SECRET = "00000000-0000-4000-8000-0000000000e2";
  const accessibles = [TAXI, SECRET];
  assert.equal(RETOUR_ENTITE_MS, 15 * 60 * 1000);
  // 1. Dans Taxi, « Assistant » sur une conversation Secret : l'écran range le retour, l'app passe dans Secret.
  let retourBrut = JSON.stringify({ conversation: C, entite: TAXI, le: 1000 });
  let active = SECRET;
  // 2. « Voir la conversation » dans l'Assistant : l'adresse porte l'entreprise de la conversation (Secret).
  let hash = `#/whatsapp?c=${C}&entite=${SECRET}`;
  let r = entrepriseAAfficher({ hash, active, accessibles, retourBrut, maintenant: 2000 });
  assert.equal(r.entite, TAXI, "retour dans Taxi, avant la construction de la coque");
  assert.equal(r.adresse, `#/whatsapp?c=${C}`, "entite quitte l'adresse");
  assert.equal(r.consommer, true);
  active = r.entite;
  hash = r.adresse;
  retourBrut = null;
  // 3. Un nouveau message redessine l'écran (rafraichir → afficher) : rien ne rebascule vers Secret.
  r = entrepriseAAfficher({ hash, active, accessibles, retourBrut, maintenant: 3000 });
  assert.deepEqual(r, { entite: "", adresse: "", consommer: false });
  // Au-delà de quinze minutes, une notification « ?entite=Secret » garde son choix explicite.
  r = entrepriseAAfficher({ hash: `#/whatsapp?c=${C}&entite=${SECRET}`, active: TAXI, accessibles, retourBrut: JSON.stringify({ conversation: C, entite: TAXI, le: 1000 }), maintenant: 1000 + 15 * 60 * 1000 + 1 });
  assert.deepEqual(r, { entite: SECRET, adresse: "", consommer: true });
  // Une autre conversation : la mémoire est effacée, l'entreprise de l'adresse s'applique.
  r = entrepriseAAfficher({ hash: `#/whatsapp?c=00000000-0000-4000-8000-0000000000c2&entite=${SECRET}`, active: TAXI, accessibles, retourBrut: JSON.stringify({ conversation: C, entite: TAXI, le: 1000 }), maintenant: 2000 });
  assert.deepEqual(r, { entite: SECRET, adresse: "", consommer: true });
  // Ailleurs que WhatsApp : la mémoire reste, seule l'adresse compte.
  r = entrepriseAAfficher({ hash: `#/dossiers?entite=${SECRET}`, active: TAXI, accessibles, retourBrut: "x", maintenant: 2000 });
  assert.deepEqual(r, { entite: SECRET, adresse: "", consommer: false });
  // afficher() s'en sert avant la construction de la coque, à la place de l'ancienne lecture de « entite ».
  const app = fs.readFileSync(new URL("../src/gestion/js/app.mjs", import.meta.url), "utf8");
  const i = app.indexOf("entrepriseAAfficher({");
  assert.ok(i > 0 && i < app.indexOf("const cle = `${etat.entiteId}"), "avant le calcul de la coque");
  assert.doesNotMatch(app, /const entiteDemandee = /);
  const wa = fs.readFileSync(new URL("../src/gestion/js/views/whatsapp.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(wa, /entiteDeRetour/, "plus de bascule dans la vue");
});

test("contre-relecture 2, point 1 : conversation liée rangée ailleurs : pas de réponse au client préparée non plus", async () => {
  const { executer, CONSEIL_AUTRE_ENTREPRISE, CARTES_REFUSEES_AUTRE_ENTREPRISE } = await import("../supabase/functions/agent/outils.js");
  assert.deepEqual(CARTES_REFUSEES_AUTRE_ENTREPRISE, ["proposer_dossier", "proposer_reservation", "proposer_reponse"]);
  const ctx = { conversationAutreEntreprise: true, charger: async (n) => E.etat.db[n] || [], reglages: E.reglages(), simule: tempsSimule };
  const memo = { prix: new Set(), heures: new Set(), tapes: new Set(), durees: new Set(), estimations: new Map(), signer: false, prestataires: [], entreprise: "Test", textes: [] };
  const r = await executer("proposer_reponse", { titre: "Réponse", texte: "Hello, your pickup is at 9:00.", langue: "en" }, ctx, memo);
  assert.equal(r.erreur, true, JSON.stringify(r));
  assert.equal(r.contenu.erreur, "conversation_autre_entreprise");
  assert.equal(r.contenu.conseil, CONSEIL_AUTRE_ENTREPRISE);
});

test("contre-relecture 2, point 2 : en espace unifié, seul un apporteur ou un partenaire rangé dans l'autre entreprise bloque les cartes", async () => {
  const { cartesRefuseesAutreEntreprise } = await import("../supabase/functions/agent/whatsapp.js");
  const SECRET = "00000000-0000-4000-8000-0000000000e2";
  const TAXI = "00000000-0000-4000-8000-0000000000e1";
  const ZTP = "00000000-0000-4000-8000-0000000000e3";
  const unifie = { entitesUnifiees: [SECRET, TAXI] };
  // Client rangé chez Secret, Assistant de Taxi en espace unifié : un deuxième dossier reste possible.
  assert.equal(cartesRefuseesAutreEntreprise({ entite_id: SECRET, type_contact: "client" }, unifie), false);
  assert.equal(cartesRefuseesAutreEntreprise({ entite_id: SECRET, type_contact: null }, unifie), false);
  // Apporteur, partenaire ou fiche partenaire reliée : refusé même en espace unifié.
  assert.equal(cartesRefuseesAutreEntreprise({ entite_id: SECRET, type_contact: "apporteur" }, unifie), true);
  assert.equal(cartesRefuseesAutreEntreprise({ entite_id: SECRET, type_contact: "partenaire" }, unifie), true);
  assert.equal(cartesRefuseesAutreEntreprise({ entite_id: SECRET, partenaire_id: "00000000-0000-4000-8000-000000000001" }, unifie), true);
  // Hors espace unifié, ou rangée dans une entreprise hors de la paire : refusé.
  assert.equal(cartesRefuseesAutreEntreprise({ entite_id: SECRET, type_contact: "client" }), true);
  assert.equal(cartesRefuseesAutreEntreprise({ entite_id: ZTP, type_contact: "client" }, unifie), true);
  const index = fs.readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
  assert.match(index, /conversationAutreEntreprise = cartesRefuseesAutreEntreprise\(w\.data, \{ entitesUnifiees: unifie \? unifie\.entites\.map\(\(e\) => e\.id\) : \[\] \}\)/);
});
